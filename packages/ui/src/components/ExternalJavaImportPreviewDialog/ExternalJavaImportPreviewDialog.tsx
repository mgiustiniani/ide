import type {
  ApplyRefactorKitPlanResult,
  RefactorKitPatchPlan,
  RefactorKitPlanDiagnostic,
} from "@ide/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/Button";

export type ExternalJavaImportPreviewStatus =
  "loading" | "unavailable" | "refused" | "preview" | "applying" | "applied" | "error";

export interface ExternalJavaImportPreviewDialogProps {
  status: ExternalJavaImportPreviewStatus;
  selectedTargetDirectory: string;
  plan?: RefactorKitPatchPlan | null;
  result?: ApplyRefactorKitPlanResult | null;
  unavailableReason?: string;
  errorMessage?: string;
  onCancel: () => void;
  /** Receives the exact backend plan currently displayed and acknowledged. */
  onApply: (plan: RefactorKitPatchPlan) => void;
}

function TextList({ items, empty }: { items: readonly string[]; empty?: string }): JSX.Element {
  if (items.length === 0)
    return <p className="text-xs text-[var(--text-muted)]">{empty ?? "None"}</p>;
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {title}
      </h3>
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

function isUnknownLicense(plan: RefactorKitPatchPlan): boolean {
  const license = plan.provenance.detectedLicense?.trim().toLowerCase();
  return !license || license === "unknown" || license === "unlicensed";
}

export function ExternalJavaImportPreviewDialog({
  status,
  selectedTargetDirectory,
  plan = null,
  result = null,
  unavailableReason,
  errorMessage,
  onCancel,
  onApply,
}: ExternalJavaImportPreviewDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [licenseAcknowledged, setLicenseAcknowledged] = useState(false);

  useEffect(() => {
    setLicenseAcknowledged(false);
  }, [plan?.planId]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const needsLicenseAcknowledgement = Boolean(
    plan && (isUnknownLicense(plan) || plan.riskLevel === "high" || plan.riskLevel === "unknown"),
  );
  const canApply = Boolean(
    status === "preview" &&
    plan?.status === "ready" &&
    plan.applyEligibility.eligible &&
    !plan.staleness.stale &&
    plan.applyEligibility.blockers.length === 0 &&
    (!needsLicenseAcknowledgement || licenseAcknowledged),
  );
  const backendBlockingReasons = plan
    ? [...plan.refusalReasons, ...plan.staleness.reasons, ...plan.applyEligibility.blockers]
    : [];
  const bannerReasons = backendBlockingReasons.filter(
    (reason, index) => reason !== errorMessage && backendBlockingReasons.indexOf(reason) === index,
  );

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
          } else if (event.key === "Tab") {
            const focusable = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ) ?? [],
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="border-b border-[var(--border-default)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            Paste Java Class from Clipboard
          </h2>
          <p id={descriptionId} className="mt-1 text-xs text-[var(--text-secondary)]">
            Review RefactorKit evidence before applying workspace changes.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <Section title="Selected target">
            <dl className="grid gap-1 text-xs sm:grid-cols-[10rem_1fr]">
              <dt>Target directory</dt>
              <dd className="break-all font-mono">{selectedTargetDirectory}</dd>
            </dl>
          </Section>

          {status === "loading" && (
            <Notice tone="info">Generating a safe RefactorKit preview…</Notice>
          )}
          {status === "unavailable" && (
            <Notice tone="warning">RefactorKit import is unavailable. {unavailableReason}</Notice>
          )}
          {status === "applying" && (
            <Notice tone="info">Applying the approved import transaction…</Notice>
          )}
          {status === "error" && (
            <Notice tone="error">
              <p>{errorMessage ?? "The import could not be completed."}</p>
              {bannerReasons.length > 0 && (
                <div className="mt-2">
                  <TextList items={bannerReasons} />
                </div>
              )}
            </Notice>
          )}
          {status === "refused" && (
            <Notice tone="error">
              <p>RefactorKit refused this import. No changes can be applied.</p>
              {errorMessage && <p className="mt-1">{errorMessage}</p>}
              {bannerReasons.length > 0 && (
                <div className="mt-2">
                  <TextList items={bannerReasons} />
                </div>
              )}
            </Notice>
          )}
          {status === "applied" && (
            <Notice tone="success">
              Import applied successfully. Transaction:{" "}
              <code className="font-mono">{result?.transactionId ?? "Unavailable"}</code>
            </Notice>
          )}

          {plan && (
            <>
              <Section title="Plan and placement">
                <p className="text-sm">{plan.summary}</p>
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                  <dt>Plan</dt>
                  <dd className="font-mono">{plan.planId}</dd>
                  <dt>Status</dt>
                  <dd>{plan.status}</dd>
                  <dt>Module</dt>
                  <dd>{plan.placement.moduleName ?? "Not returned"}</dd>
                  <dt>Source root</dt>
                  <dd className="font-mono">{plan.placement.sourceRoot ?? "Not returned"}</dd>
                  <dt>Package</dt>
                  <dd className="font-mono">
                    {plan.placement.packageName ?? "Default package / not returned"}
                  </dd>
                  <dt>Provider</dt>
                  <dd>
                    {plan.provider}
                    {plan.providerVersion ? ` ${plan.providerVersion}` : ""}
                  </dd>
                </dl>
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

              <Section title="Package changes">
                {plan.packageChanges.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">None</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {plan.packageChanges.map((change) => (
                      <li key={change.path}>
                        <code>{change.path}</code>: <code>{change.fromPackage ?? "(none)"}</code> →{" "}
                        <code>{change.toPackage ?? "(none)"}</code>
                      </li>
                    ))}
                  </ul>
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

              <Section title="Evidence and risk">
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                  <dt>Confidence</dt>
                  <dd>{plan.confidence}</dd>
                  <dt>Risk</dt>
                  <dd>{plan.riskLevel}</dd>
                </dl>
                {plan.evidence.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No evidence returned</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {plan.evidence.map((item, index) => (
                      <li key={`${index}-${item.kind}`}>
                        <strong>
                          {item.kind}: {item.summary}
                        </strong>
                        {item.path && (
                          <div>
                            <code>{item.path}</code>
                          </div>
                        )}
                        {item.detail && <p>{item.detail}</p>}
                      </li>
                    ))}
                  </ul>
                )}
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

              <Section title="Provenance and license">
                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                  <dt>Source</dt>
                  <dd>Clipboard</dd>
                  <dt>Source URL</dt>
                  <dd>{plan.provenance.sourceUrl ?? "None provided"}</dd>
                  <dt>Detected license</dt>
                  <dd>{plan.provenance.detectedLicense ?? "Unknown"}</dd>
                  <dt>License policy</dt>
                  <dd>{plan.provenance.licensePolicy}</dd>
                </dl>
                <h4 className="text-xs font-semibold">Notices</h4>
                <TextList items={plan.provenance.notices} empty="No notices returned" />
                {needsLicenseAcknowledgement && (
                  <label className="flex items-start gap-2 rounded border border-[var(--accent-yellow)] p-2 text-xs">
                    <input
                      type="checkbox"
                      checked={licenseAcknowledged}
                      onChange={(event) => setLicenseAcknowledged(event.target.checked)}
                    />
                    <span>
                      I acknowledge the unknown or high-risk license and provenance information for
                      this plan.
                    </span>
                  </label>
                )}
              </Section>

              <Section title="Unresolved dependencies">
                <TextList items={plan.unresolvedDependencies} />
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
              <Section title="Staleness">
                <p className="text-xs">Stale: {plan.staleness.stale ? "Yes" : "No"}</p>
                <TextList items={plan.staleness.reasons} />
              </Section>
              <Section title="Apply blockers">
                <p className="text-xs">
                  Backend eligible: {plan.applyEligibility.eligible ? "Yes" : "No"}
                </p>
                <TextList items={plan.applyEligibility.blockers} />
              </Section>
            </>
          )}

          {status === "applied" && result && !plan && (
            <Section title="Applied transaction">
              <p className="text-xs">
                Transaction ID: <code>{result.transactionId}</code>
              </p>
              <p className="text-xs">
                Primary file: <code>{result.primaryFile ?? "None returned"}</code>
              </p>
              <Diagnostics diagnostics={result.diagnostics} />
            </Section>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canApply}
            isLoading={status === "applying"}
            onClick={() => {
              if (canApply && plan) onApply(plan);
            }}
          >
            Apply Import
          </Button>
        </footer>
      </div>
    </div>
  );
}
