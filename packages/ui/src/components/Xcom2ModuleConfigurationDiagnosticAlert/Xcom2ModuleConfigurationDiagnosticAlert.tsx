import type { Xcom2ModuleConfigurationDiagnosticPresentation } from "@ide/contracts";

/** Complete, provider-neutral presentation for one XCOM 2 project configuration stop. */
export function Xcom2ModuleConfigurationDiagnosticAlert({
  title,
  projectFileLabel,
  summary,
  remediation,
  supportIdentifier,
}: Readonly<Xcom2ModuleConfigurationDiagnosticPresentation>): JSX.Element {
  return (
    <section
      aria-atomic="true"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-100"
      role="alert"
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-3 grid gap-3 text-sm">
        <div>
          <dt className="font-medium text-amber-100">Project file</dt>
          <dd className="mt-0.5 text-amber-100/90">
            <code className="rounded bg-black/20 px-1 py-0.5 font-mono text-xs">
              {projectFileLabel}
            </code>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-amber-100">Summary</dt>
          <dd className="mt-0.5 text-amber-100/90">{summary}</dd>
        </div>
        <div>
          <dt className="font-medium text-amber-100">Remediation</dt>
          <dd className="mt-0.5 text-amber-100/90">{remediation}</dd>
        </div>
        <div>
          <dt className="font-medium text-amber-100">Support identifier</dt>
          <dd className="mt-0.5 text-amber-100/90">
            <code className="rounded bg-black/20 px-1 py-0.5 font-mono text-xs">
              {supportIdentifier}
            </code>
          </dd>
        </div>
      </dl>
    </section>
  );
}
