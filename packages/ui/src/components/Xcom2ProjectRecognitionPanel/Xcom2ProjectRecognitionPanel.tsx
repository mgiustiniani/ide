// ---------------------------------------------------------------------------
// @ide/ui – Xcom2ProjectRecognitionPanel
// Read-only presentation of host-supplied XCOM 2 project recognition evidence.
// ---------------------------------------------------------------------------

import { useId } from "react";
import {
  XCOM2_MODULE_CONFIGURATION_PATH,
  type Xcom2ModuleActivationDecision,
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleScanIssue,
  type Xcom2ProjectActivationDecision,
  type Xcom2ProjectActivationSnapshot,
  type Xcom2ProjectConfigurationReason,
} from "@ide/contracts";

export const XCOM2_PROJECT_RECOGNITION_LIMITATION =
  "Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution.";

export interface Xcom2ProjectRecognitionPanelProps {
  /** Legacy convention-recognition snapshot retained for additive desktop migration. */
  readonly snapshot: Readonly<Xcom2ModuleActivationSnapshot>;
  /** Legacy active module decisions retained for additive desktop migration. */
  readonly activeDecisions: readonly Readonly<Xcom2ModuleActivationDecision>[];
  /** Joint project-activation snapshot supplied by a migrated host. */
  readonly projectSnapshot?: Readonly<Xcom2ProjectActivationSnapshot> | null;
  /** Convention-recognition snapshot correlated with the project snapshot. */
  readonly recognitionSnapshot?: Readonly<Xcom2ModuleActivationSnapshot> | null;
  /** Active project decisions, in deterministic host-supplied display order. */
  readonly activeProjectDecisions?: readonly Readonly<Xcom2ProjectActivationDecision>[];
}

interface EvidenceRow {
  readonly kind: string;
  readonly relativePath: string;
}

const MODULE_CLASS_NAME =
  "overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-header)]";
const DETAILS_CLASS_NAME =
  "grid gap-x-4 gap-y-2 border-b border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2";

function Definition({
  term,
  value,
  wide = false,
  monospaced = false,
}: {
  readonly term: string;
  readonly value: string;
  readonly wide?: boolean;
  readonly monospaced?: boolean;
}): JSX.Element {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="font-medium text-[var(--text-primary)]">{term}</dt>
      <dd className={monospaced ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}

function EvidenceTable({
  caption,
  rows,
}: {
  readonly caption: string;
  readonly rows: readonly Readonly<EvidenceRow>[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--surface-background)] text-[var(--text-secondary)]">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              kind
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              workspace-relative path
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-default)]">
          {rows.map((row, index) => (
            <tr key={`${row.kind}:${row.relativePath}:${index}`}>
              <td className="px-3 py-2">{row.kind}</td>
              <td className="px-3 py-2 font-mono">{row.relativePath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegacyRecognitionDecision({
  moduleRoot,
  state,
  confidence,
  completeness,
  reasons,
}: {
  readonly moduleRoot: string;
  readonly state: "active" | "needs-confirmation";
  readonly confidence: Xcom2ModuleActivationSnapshot["confidence"];
  readonly completeness: Xcom2ModuleActivationSnapshot["completeness"];
  readonly reasons: readonly Readonly<EvidenceRow>[];
}): JSX.Element {
  return (
    <section aria-label={`Recognized module ${moduleRoot}`} className={MODULE_CLASS_NAME}>
      <dl className={DETAILS_CLASS_NAME}>
        <Definition term="module root" value={moduleRoot} monospaced />
        <Definition term="state" value={state} />
        <Definition term="confidence" value={confidence} />
        <Definition term="completeness" value={completeness} />
        <Definition term="limitation" value={XCOM2_PROJECT_RECOGNITION_LIMITATION} wide />
      </dl>
      <EvidenceTable caption={`Recognition evidence for ${moduleRoot}`} rows={reasons} />
    </section>
  );
}

function LegacyDecisionPanel({
  decision,
  snapshot,
}: {
  readonly decision: Readonly<Xcom2ModuleActivationDecision>;
  readonly snapshot: Readonly<Xcom2ModuleActivationSnapshot>;
}): JSX.Element {
  return (
    <LegacyRecognitionDecision
      moduleRoot={decision.moduleRoot}
      state={decision.state}
      confidence={decision.confidence}
      completeness={snapshot.completeness}
      reasons={decision.reasons.map(({ evidenceKind, relativePath }) => ({
        kind: evidenceKind,
        relativePath,
      }))}
    />
  );
}

function ProjectDecisionPanel({
  decision,
  recognitionSnapshot,
}: {
  readonly decision: Readonly<Xcom2ProjectActivationDecision>;
  readonly recognitionSnapshot: Readonly<Xcom2ModuleActivationSnapshot>;
}): JSX.Element {
  const configurationReasons: Array<Readonly<Xcom2ProjectConfigurationReason>> = [];
  const recognitionReasons: EvidenceRow[] = [];
  decision.reasons.forEach((reason) => {
    if (reason.kind === "configuration") configurationReasons.push(reason);
    else {
      recognitionReasons.push({
        kind: reason.evidenceKind,
        relativePath: reason.relativePath,
      });
    }
  });

  if (decision.source === "recognized") {
    return (
      <LegacyRecognitionDecision
        moduleRoot={decision.moduleRoot}
        state={decision.state}
        confidence={decision.recognitionConfidence}
        completeness={recognitionSnapshot.completeness}
        reasons={recognitionReasons}
      />
    );
  }

  const rows: readonly Readonly<EvidenceRow>[] = [
    ...configurationReasons.map(() => ({
      kind: "explicit-configuration",
      relativePath: XCOM2_MODULE_CONFIGURATION_PATH,
    })),
    ...recognitionReasons,
  ];
  const regionPrefix =
    decision.source === "configured" ? "Configured" : "Configured and recognized";

  return (
    <section
      aria-label={`${regionPrefix} module ${decision.moduleRoot}`}
      className={MODULE_CLASS_NAME}
    >
      <dl className={DETAILS_CLASS_NAME}>
        <Definition term="target" value={configurationReasons[0]?.target ?? "wotc"} />
        <Definition term="module root" value={decision.moduleRoot} monospaced />
        <Definition term="state" value={decision.state} />
        <Definition term="source" value={decision.source} />
        <Definition term="activation confidence" value={decision.activationConfidence} />
        <Definition term="recognition confidence" value={decision.recognitionConfidence} />
        <Definition term="limitation" value={XCOM2_PROJECT_RECOGNITION_LIMITATION} wide />
      </dl>
      <EvidenceTable caption={`Activation reasons for ${decision.moduleRoot}`} rows={rows} />
    </section>
  );
}

function Alert({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <p
      role="alert"
      className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
    >
      {children}
    </p>
  );
}

function ScanIssueAlert({ issue }: { issue: Readonly<Xcom2ModuleScanIssue> }): JSX.Element {
  return (
    <Alert>
      <strong>{issue.kind}</strong>: {issue.relativePath}
    </Alert>
  );
}

export function Xcom2ProjectRecognitionPanel({
  snapshot,
  activeDecisions,
  projectSnapshot,
  recognitionSnapshot,
  activeProjectDecisions,
}: Xcom2ProjectRecognitionPanelProps): JSX.Element {
  const headingId = useId();
  const projectMode = activeProjectDecisions !== undefined;
  const effectiveRecognitionSnapshot = recognitionSnapshot ?? snapshot;
  const issues = projectMode ? effectiveRecognitionSnapshot.issues : snapshot.issues;

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-panel)] text-[var(--text-primary)]"
      aria-labelledby={headingId}
    >
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2">
        <h2 id={headingId} className="text-sm font-semibold">
          XCOM 2 Project
        </h2>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {projectMode
          ? activeProjectDecisions.map((decision) => (
              <ProjectDecisionPanel
                key={decision.moduleRoot}
                decision={decision}
                recognitionSnapshot={effectiveRecognitionSnapshot}
              />
            ))
          : activeDecisions.map((decision) => (
              <LegacyDecisionPanel
                key={decision.moduleRoot}
                decision={decision}
                snapshot={snapshot}
              />
            ))}

        {projectMode && projectSnapshot?.diagnostic ? (
          <Alert>
            <strong>configuration</strong>: {projectSnapshot.diagnostic.code}
          </Alert>
        ) : null}

        {issues.map((issue, index) => (
          <ScanIssueAlert key={`${issue.kind}:${issue.relativePath}:${index}`} issue={issue} />
        ))}
      </div>
    </section>
  );
}
