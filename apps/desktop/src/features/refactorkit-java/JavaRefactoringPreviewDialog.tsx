import type {
  RefactorApplyResult,
  RefactorKitPlanDiagnostic,
  RefactorPreviewResult,
  RefactoringOperation,
  RefactoringTarget,
} from "@ide/contracts";
import { useEffect, useId, useRef } from "react";
import type { JavaRefactoringDialogState } from "./useJavaRefactoringController";
import {
  JAVA_REFACTORING_OPERATION_NOT_OFFERED,
  JAVA_REFACTORING_UNAVAILABLE,
} from "./useJavaRefactoringController";

const OPERATIONS: readonly RefactoringOperation[] = [
  "rename-class",
  "rename-member",
  "rename-local-variable",
  "move-class",
  "change-method-signature",
  "safe-delete",
];

const TARGET_KINDS: readonly RefactoringTarget["kind"][] = ["class", "member", "local-binding"];

function TextList({ items, empty }: { items: readonly string[]; empty?: string }): JSX.Element {
  if (items.length === 0) return <p className="text-xs text-[var(--text-muted)]">{empty ?? "None"}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function Diagnostics({
  diagnostics,
}: {
  diagnostics: readonly RefactorKitPlanDiagnostic[];
}): JSX.Element {
  return (
    <TextList
      empty="No diagnostics"
      items={diagnostics.map((item) => {
        const location = item.path
          ? ` — ${item.path}${item.line === undefined ? "" : `:${item.line}${item.column === undefined ? "" : `:${item.column}`}`}`
          : "";
        return `${item.severity.toUpperCase()}${item.code ? ` ${item.code}` : ""}: ${item.message}${location}`;
      })}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="space-y-2 rounded border border-[var(--border-default)] p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{title}</h3>
      {children}
    </section>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "success" | "warning" | "error";
  children: React.ReactNode;
}): JSX.Element {
  const colors = {
    info: "border-[var(--accent-blue)]",
    success: "border-[var(--accent-green)]",
    warning: "border-[var(--accent-yellow)]",
    error: "border-[var(--accent-red)]",
  } as const;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded border-l-4 bg-[var(--surface-panel)] p-3 text-sm ${colors[tone]}`}
    >
      {children}
    </div>
  );
}

export interface JavaRefactoringPreviewDialogProps {
  dialog: JavaRefactoringDialogState;
  rollbackAdvertised: boolean;
  onSetOperation(operation: RefactoringOperation): void;
  onSetTarget(target: RefactoringTarget): void;
  onPreview(): void;
  onApply(plan: RefactorPreviewResult): void;
  onRollback(result: RefactorApplyResult): void;
  onDiscard(): void;
  onCancel(): void;
}

function canApply(plan: RefactorPreviewResult): boolean {
  return Boolean(
    plan.status === "ready" &&
      plan.applyEligibility.eligible &&
      plan.applyEligibility.blockers.length === 0 &&
      !plan.staleness.stale,
  );
}

/**
 * Minimal desktop dialog for the capability-gated general Java refactoring flow.
 * The reviewed preview is presented read-only and grants no apply authority; Apply
 * binds to the exact reviewed plan and Rollback is offered only when advertised and
 * transaction-bound. No native API is imported here.
 */
export function JavaRefactoringPreviewDialog({
  dialog,
  rollbackAdvertised,
  onSetOperation,
  onSetTarget,
  onPreview,
  onApply,
  onRollback,
  onDiscard,
  onCancel,
}: JavaRefactoringPreviewDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const status = dialog.status;
  const plan = dialog.plan;
  const result = dialog.result;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const bannerReasons =
    plan?.status === "ready"
      ? [...plan.refusalReasons, ...plan.staleness.reasons, ...plan.applyEligibility.blockers].filter(
          (reason, index) =>
            reason !== dialog.message &&
            [...plan.refusalReasons, ...plan.staleness.reasons, ...plan.applyEligibility.blockers].indexOf(reason) === index,
        )
      : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <header className="border-b border-[var(--border-default)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">Java Refactor</h2>
          <p id={descriptionId} className="mt-1 text-xs text-[var(--text-secondary)]">
            Review the read-only RefactorKit preview before granting apply authority.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <Section title="Operation and target">
            <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[9rem_1fr]">
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Operation</span>
                <select
                  disabled={status !== "idle"}
                  value={dialog.operation}
                  onChange={(event) => onSetOperation(event.target.value as RefactoringOperation)}
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                >
                  {OPERATIONS.map((operation) => (
                    <option key={operation} value={operation}>
                      {operation}
                    </option>
                  ))}
                </select>
              </label>
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Target kind</span>
                <select
                  disabled={status !== "idle"}
                  value={dialog.target.kind}
                  onChange={(event) =>
                    onSetTarget({
                      ...dialog.target,
                      kind: event.target.value as RefactoringTarget["kind"],
                    })
                  }
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                >
                  {TARGET_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Source path</span>
                <input
                  disabled={status !== "idle"}
                  value={dialog.target.path}
                  onChange={(event) => onSetTarget({ ...dialog.target, path: event.target.value })}
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                  placeholder="src/main/java/example/A.java"
                />
              </label>
              <label className="contents">
                <span className="text-[var(--text-secondary)]">Element identity</span>
                <input
                  disabled={status !== "idle"}
                  value={dialog.target.identity}
                  onChange={(event) =>
                    onSetTarget({ ...dialog.target, identity: event.target.value })
                  }
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
                  placeholder="example.A"
                />
              </label>
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
              <dt>Workspace</dt>
              <dd className="font-mono">{dialog.selection?.workspaceId ?? "Not authorized"}</dd>
              <dt>Workspace generation</dt>
              <dd className="font-mono">{dialog.selection?.workspaceGeneration ?? "—"}</dd>
            </dl>
          </Section>

          {status === "loading" && <Notice tone="info">Generating a read-only RefactorKit preview…</Notice>}
          {status === "unavailable" && (
            <Notice tone="warning">
              RefactorKit general Java refactoring is unavailable. {dialog.message}
            </Notice>
          )}
          {status === "refused" && (
            <Notice tone="error">
              <p>RefactorKit refused this refactoring. No changes can be applied.</p>
              {dialog.message && <p className="mt-1">{dialog.message}</p>}
            </Notice>
          )}
          {status === "applying" && (
            <Notice tone="info">Applying the approved refactoring transaction…</Notice>
          )}
          {status === "error" && (
            <Notice tone="error">
              <p>{dialog.message ?? "The refactoring could not be completed."}</p>
              {bannerReasons.length > 0 && <div className="mt-2"><TextList items={bannerReasons} /></div>}
            </Notice>
          )}
          {status === "applied" && (
            <Notice tone="success">
              Refactoring applied successfully. Transaction:{" "}
              <code className="font-mono">{result?.transactionId ?? "Unavailable"}</code>
            </Notice>
          )}
          {status === "rolled-back" && (
            <Notice tone="success">
              Refactoring rolled back. Transaction:{" "}
              <code className="font-mono">{dialog.rollback?.transactionId ?? "Unavailable"}</code>
            </Notice>
          )}

          {plan && (
            <>
              <Section title="Plan and evidence">
                <p className="text-sm">{plan.summary}</p>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                  <dt>Plan</dt>
                  <dd className="font-mono">{plan.planId}</dd>
                  <dt>Status</dt>
                  <dd>{plan.status}</dd>
                  <dt>Confidence</dt>
                  <dd>{plan.confidence}</dd>
                  <dt>Risk</dt>
                  <dd>{plan.riskLevel}</dd>
                  <dt>Provider</dt>
                  <dd>
                    {plan.provider}
                    {plan.providerVersion ? ` ${plan.providerVersion}` : ""}
                  </dd>
                </dl>
                <p className="text-xs text-[var(--text-muted)]">
                  Preview is read-only and grants no apply authority.
                </p>
              </Section>

              <Section title="Affected files">
                {plan.affectedFiles.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No affected files returned</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {plan.affectedFiles.map((file) => (
                      <li key={`${file.change}-${file.path}`} className="flex flex-wrap gap-2">
                        <span className="uppercase">{file.change}</span>
                        <code className="break-all">{file.path}</code>
                        {file.previousPath && (
                          <span>
                            from <code>{file.previousPath}</code>
                          </span>
                        )}
                        {file.primary && (
                          <strong className="rounded bg-[var(--badge-bg)] px-1 text-[var(--badge-text)]">
                            Primary file
                          </strong>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {result?.primaryFile && (
                  <p className="text-xs">
                    Applied primary file: <code>{result.primaryFile}</code>
                  </p>
                )}
              </Section>

              <Section title="Diff">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-background)] p-3 text-xs">
                  {plan.renderedDiff || "No rendered diff returned"}
                </pre>
                {plan.structuredDiff.map((diff) => (
                  <div key={`${diff.change}-${diff.path}`} className="space-y-1">
                    <p className="text-xs font-medium">
                      {diff.change.toUpperCase()} <code>{diff.path}</code>
                    </p>
                    {diff.hunks.map((hunk, index) => (
                      <pre
                        key={`${index}-${hunk.oldStart}-${hunk.newStart}`}
                        className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-background)] p-2 text-xs"
                      >{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`}</pre>
                    ))}
                  </div>
                ))}
              </Section>

              <Section title="Risks">
                <TextList items={plan.risks} empty="No explicit risks returned" />
              </Section>
              <Section title="Warnings">
                <TextList items={plan.warnings} empty="No warnings returned" />
              </Section>
              <Section title="Diagnostics">
                <Diagnostics diagnostics={plan.diagnosticsAfterPreview} />
                {result && (
                  <>
                    <h4 className="text-xs font-semibold">After apply</h4>
                    <Diagnostics diagnostics={result.diagnostics} />
                  </>
                )}
              </Section>
              <Section title="Conflicts">
                <TextList
                  items={plan.conflicts.map(
                    (item) => `${item.kind}: ${item.summary}${item.path ? ` — ${item.path}` : ""}`,
                  )}
                />
              </Section>
              <Section title="Refusal reasons">
                <TextList items={plan.refusalReasons} />
              </Section>
              <Section title="Apply eligibility">
                <p className="text-xs">
                  Backend eligible: {plan.applyEligibility.eligible ? "Yes" : "No"}
                </p>
                <TextList items={plan.applyEligibility.blockers} />
              </Section>
              <Section title="Staleness">
                <p className="text-xs">Stale: {plan.staleness.stale ? "Yes" : "No"}</p>
                <TextList items={plan.staleness.reasons} />
              </Section>
            </>
          )}

          {status === "applied" && result && !plan && (
            <Section title="Applied transaction">
              <p className="text-xs">
                Transaction ID: <code>{result.transactionId ?? "None returned"}</code>
              </p>
              <p className="text-xs">
                Primary file: <code>{result.primaryFile ?? "None returned"}</code>
              </p>
              <Diagnostics diagnostics={result.diagnostics} />
            </Section>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button
            type="button"
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={status !== "idle"}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={onPreview}
          >
            Preview
          </button>
          <button
            type="button"
            disabled={status !== "preview" || !plan || !canApply(plan)}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={() => {
              if (status === "preview" && plan && canApply(plan)) onApply(plan);
            }}
          >
            Apply
          </button>
          <button
            type="button"
            disabled={status !== "applied" || !result?.transactionId || !rollbackAdvertised}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={() => {
              if (status === "applied" && result) onRollback(result);
            }}
          >
            Rollback
          </button>
          <button
            type="button"
            disabled={status !== "preview" && status !== "loading" && status !== "applying"}
            className="rounded-sm bg-[var(--surface-background)] px-3 py-1 text-xs text-[var(--text-primary)] border border-[var(--border-default)]"
            onClick={onDiscard}
          >
            Discard
          </button>
          {status === "applied" && !rollbackAdvertised && (
            <span className="flex items-center text-xs text-[var(--text-muted)]">
              Rollback unavailable: {JAVA_REFACTORING_UNAVAILABLE}
            </span>
          )}
          {status === "refused" && dialog.message === JAVA_REFACTORING_OPERATION_NOT_OFFERED && (
            <span className="flex items-center text-xs text-[var(--text-muted)]">
              Operation not offered: {JAVA_REFACTORING_OPERATION_NOT_OFFERED}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
