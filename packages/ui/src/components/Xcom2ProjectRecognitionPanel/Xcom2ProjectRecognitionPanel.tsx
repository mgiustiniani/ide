// ---------------------------------------------------------------------------
// @ide/ui – Xcom2ProjectRecognitionPanel
// Read-only presentation of host-supplied XCOM 2 project recognition evidence.
// ---------------------------------------------------------------------------

import { useId } from "react";
import type {
  Xcom2ModuleActivationDecision,
  Xcom2ModuleActivationSnapshot,
  Xcom2ModuleScanIssue,
} from "@ide/contracts";

export const XCOM2_PROJECT_RECOGNITION_LIMITATION =
  "Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution.";

export interface Xcom2ProjectRecognitionPanelProps {
  /** Correlated activation snapshot supplied by the host. */
  readonly snapshot: Readonly<Xcom2ModuleActivationSnapshot>;
  /** Active module decisions selected by the host, in deterministic display order. */
  readonly activeDecisions: readonly Readonly<Xcom2ModuleActivationDecision>[];
}

function ScanIssueAlert({ issue }: { issue: Readonly<Xcom2ModuleScanIssue> }): JSX.Element {
  return (
    <p
      role="alert"
      className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
    >
      <strong>{issue.kind}</strong>: {issue.relativePath}
    </p>
  );
}

export function Xcom2ProjectRecognitionPanel({
  snapshot,
  activeDecisions,
}: Xcom2ProjectRecognitionPanelProps): JSX.Element {
  const headingId = useId();

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
        {activeDecisions.map((decision) => (
          <section
            key={decision.moduleRoot}
            aria-label={`Recognized module ${decision.moduleRoot}`}
            className="overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
          >
            <dl className="grid gap-x-4 gap-y-2 border-b border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
              <div>
                <dt className="font-medium text-[var(--text-primary)]">module root</dt>
                <dd className="font-mono">{decision.moduleRoot}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">state</dt>
                <dd>{decision.state}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">confidence</dt>
                <dd>{decision.confidence}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">completeness</dt>
                <dd>{snapshot.completeness}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-[var(--text-primary)]">limitation</dt>
                <dd>{XCOM2_PROJECT_RECOGNITION_LIMITATION}</dd>
              </div>
            </dl>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Recognition evidence for {decision.moduleRoot}
                </caption>
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
                  {decision.reasons.map((reason, index) => (
                    <tr key={`${reason.evidenceKind}:${reason.relativePath}:${index}`}>
                      <td className="px-3 py-2">{reason.evidenceKind}</td>
                      <td className="px-3 py-2 font-mono">{reason.relativePath}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {snapshot.issues.map((issue, index) => (
          <ScanIssueAlert key={`${issue.kind}:${issue.relativePath}:${index}`} issue={issue} />
        ))}
      </div>
    </section>
  );
}
