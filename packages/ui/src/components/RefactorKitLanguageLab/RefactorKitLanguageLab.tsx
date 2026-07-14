// ---------------------------------------------------------------------------
// @ide/ui – RefactorKitLanguageLab
// Provider-neutral presentation of daemon-advertised language capabilities.
// ---------------------------------------------------------------------------

import { useId } from "react";
import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapter,
  RefactorKitLanguageCapability,
  RefactorKitStatus,
} from "@ide/contracts";

export interface RefactorKitLanguageLabProps {
  /** Exact capability discovery result supplied by the host. */
  capabilities?: RefactorKitCapabilities | null;
  /** Local daemon availability supplied by the host; never inferred from discovery. */
  daemonStatus?: RefactorKitStatus | null;
}

interface AdvertisedCapability {
  adapter: RefactorKitLanguageAdapter;
  capability: RefactorKitLanguageCapability;
}

function ExactBoolean({ value }: { value: boolean }): JSX.Element {
  return <code className="text-[var(--text-primary)]">{value ? "true" : "false"}</code>;
}

function ExactNullableNumber({ value }: { value: number | null }): JSX.Element {
  return <code className="text-[var(--text-primary)]">{value === null ? "null" : value}</code>;
}

function ReadinessValue(): JSX.Element {
  return <dd className="font-medium text-amber-100">Unknown / not reported</dd>;
}

function RuntimeMetadata({
  runtime,
  ownerLabel,
  heading = "Runtime metadata",
}: {
  runtime: RefactorKitLanguageAdapter["runtime"];
  ownerLabel: string;
  heading?: string;
}): JSX.Element {
  return (
    <section className="mt-2" aria-label={`${ownerLabel} runtime metadata`}>
      <h6 className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {heading}
      </h6>
      <dl className="mt-1 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-2">
        <div className="flex min-w-0 gap-1">
          <dt>executionMode:</dt>
          <dd>
            <code className="text-[var(--text-primary)]">{runtime.executionMode}</code>
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>supportsTimeout:</dt>
          <dd>
            <ExactBoolean value={runtime.supportsTimeout} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>supportsCancellation:</dt>
          <dd>
            <ExactBoolean value={runtime.supportsCancellation} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>usesWorkspaceOverlay:</dt>
          <dd>
            <ExactBoolean value={runtime.usesWorkspaceOverlay} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>recordsProcessProvenance:</dt>
          <dd>
            <ExactBoolean value={runtime.recordsProcessProvenance} />
          </dd>
        </div>
      </dl>

      <h6 className="mt-2 text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Resource limits
      </h6>
      <dl className="mt-1 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-2">
        <div className="flex min-w-0 gap-1">
          <dt>requestTimeoutMillis:</dt>
          <dd>
            <ExactNullableNumber value={runtime.limits.requestTimeoutMillis} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>maxInputBytes:</dt>
          <dd>
            <ExactNullableNumber value={runtime.limits.maxInputBytes} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>maxOutputBytes:</dt>
          <dd>
            <ExactNullableNumber value={runtime.limits.maxOutputBytes} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>maxProcesses:</dt>
          <dd>
            <ExactNullableNumber value={runtime.limits.maxProcesses} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function AdapterOperations({ adapter }: { adapter: RefactorKitLanguageAdapter }): JSX.Element {
  return (
    <section className="mt-2" aria-label={`${adapter.languageId} advertised operations`}>
      <h6 className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Advertised operations · {adapter.capabilities.length}
      </h6>
      {adapter.capabilities.length > 0 ? (
        <ol className="mt-1 grid gap-1">
          {adapter.capabilities.map((capability, capabilityIndex) => (
            <li key={`${capability.operation}:${capabilityIndex}`}>
              <article
                className="rounded border border-slate-500/40 bg-slate-500/10 px-2 py-1 text-[0.68rem] text-slate-200"
                aria-label={`Operation ${capabilityIndex + 1}: ${capability.operation}`}
              >
                <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                  <div className="flex min-w-0 gap-1">
                    <dt>operation:</dt>
                    <dd className="min-w-0 break-all">
                      <code className="font-semibold text-[var(--text-primary)]">
                        {capability.operation}
                      </code>
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-1">
                    <dt>stability:</dt>
                    <dd>
                      <code className="text-[var(--text-primary)]">{capability.stability}</code>
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-1">
                    <dt>evidence:</dt>
                    <dd>
                      <code className="text-[var(--text-primary)]">{capability.evidence}</code>
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-1">
                    <dt>mutationAuthority:</dt>
                    <dd>
                      <code className="text-[var(--text-primary)]">
                        {capability.mutationAuthority}
                      </code>
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-1">
                    <dt>backend:</dt>
                    <dd className="min-w-0 break-all">
                      <code className="text-[var(--text-primary)]">{capability.backend}</code>
                    </dd>
                  </div>
                </dl>
                <RuntimeMetadata
                  runtime={capability.runtime}
                  ownerLabel={`${capability.operation} operation`}
                  heading="Operation runtime metadata"
                />
                <dl className="mt-2 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                  <div className="flex min-w-0 gap-1">
                    <dt>extensions:</dt>
                    <dd className="min-w-0 break-all">
                      <code className="text-[var(--text-primary)]">
                        [{capability.extensions.join(", ")}]
                      </code>
                    </dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-[0.68rem] font-medium text-amber-100">No operations advertised.</p>
      )}
    </section>
  );
}

function AdapterCard({
  adapter,
  ordinal,
}: {
  adapter: RefactorKitLanguageAdapter;
  ordinal: number;
}): JSX.Element {
  return (
    <li className="min-w-0 rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-2">
      <article aria-label={`Advertised language adapter ${ordinal}: ${adapter.languageId}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h6 className="text-xs font-semibold text-[var(--text-primary)]">
            {ordinal}. <code>{adapter.languageId}</code>
          </h6>
          <span className="text-[0.68rem] text-[var(--text-secondary)]">
            {adapter.capabilities.length}{" "}
            {adapter.capabilities.length === 1 ? "operation" : "operations"}
          </span>
        </div>
        <dl className="mt-1 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-2">
          <div className="flex min-w-0 gap-1">
            <dt>backend:</dt>
            <dd className="min-w-0 break-all">
              <code className="text-[var(--text-primary)]">{adapter.backend}</code>
            </dd>
          </div>
          <div className="flex min-w-0 gap-1">
            <dt>extensions:</dt>
            <dd className="min-w-0 break-all">
              <code className="text-[var(--text-primary)]">
                {adapter.extensions.length > 0 ? `[${adapter.extensions.join(", ")}]` : "[]"}
              </code>
            </dd>
          </div>
        </dl>
        <RuntimeMetadata runtime={adapter.runtime} ownerLabel={`${adapter.languageId} adapter`} />
        <AdapterOperations adapter={adapter} />
      </article>
    </li>
  );
}

export function RefactorKitLanguageLab({
  capabilities,
  daemonStatus,
}: RefactorKitLanguageLabProps): JSX.Element {
  const headingId = useId();
  const packagedHeadingId = useId();
  const readinessHeadingId = useId();
  const languageKernel = capabilities?.languageKernel;
  const schema = languageKernel?.available ? languageKernel.schema : null;
  const advertisedCapabilities: AdvertisedCapability[] =
    schema?.adapters.flatMap((adapter) =>
      adapter.capabilities.map((capability) => ({ adapter, capability })),
    ) ?? [];
  const refusedCapabilities = advertisedCapabilities.filter(
    ({ capability }) => capability.stability === "refused",
  );
  const proposalOnlyCapabilities = advertisedCapabilities.filter(
    ({ capability }) => capability.mutationAuthority === "proposal-only",
  );
  const adaptersWithoutCapabilities =
    schema?.adapters.filter((adapter) => adapter.capabilities.length === 0) ?? [];
  const discoveryLabel = languageKernel
    ? languageKernel.available
      ? `Schema v${languageKernel.schema.schemaVersion}`
      : "Unavailable"
    : "Not reported";
  const unavailableReason =
    languageKernel && !languageKernel.available
      ? languageKernel.reason
      : "No daemon-advertised language capability discovery was supplied.";

  return (
    <section
      className="border-b border-[var(--border-default)] px-3 py-2"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id={headingId}
          className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
        >
          RefactorKit Language Lab
        </h4>
        <span
          className={`rounded-full border px-2 py-0.5 text-[0.68rem] ${
            schema
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
          role="status"
          aria-label="RefactorKit language capability discovery status"
        >
          {discoveryLabel}
        </span>
      </div>

      <section
        className="mt-2 rounded border border-[var(--border-default)] p-2"
        aria-labelledby={packagedHeadingId}
      >
        <h5 id={packagedHeadingId} className="text-xs font-semibold text-[var(--text-primary)]">
          Packaged / discovered capability
        </h5>
        <p className="mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
          Exact validated daemon metadata in deterministic canonical order. It describes packaged or
          discovered capability, not readiness in the current workspace.
        </p>

        {capabilities ? (
          <dl
            className="mt-2 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-4"
            aria-label="RefactorKit capability provider metadata"
          >
            <div className="flex min-w-0 gap-1">
              <dt>api:</dt>
              <dd className="min-w-0 break-all">
                <code className="text-[var(--text-primary)]">{capabilities.api}</code>
              </dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt>apiVersion:</dt>
              <dd className="min-w-0 break-all">
                <code className="text-[var(--text-primary)]">{capabilities.apiVersion}</code>
              </dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt>provider:</dt>
              <dd className="min-w-0 break-all">
                <code className="text-[var(--text-primary)]">{capabilities.provider}</code>
              </dd>
            </div>
            <div className="flex min-w-0 gap-1">
              <dt>providerVersion:</dt>
              <dd className="min-w-0 break-all">
                <code className="text-[var(--text-primary)]">
                  {capabilities.providerVersion ?? "null"}
                </code>
              </dd>
            </div>
          </dl>
        ) : null}

        {schema ? (
          <>
            <div
              className="mt-2 flex flex-wrap gap-1"
              aria-label="Advertised language capability summary"
            >
              <span className="rounded border border-slate-500/40 px-1.5 py-0.5 text-[0.68rem] text-slate-200">
                {schema.adapters.length} adapter{schema.adapters.length === 1 ? "" : "s"}
              </span>
              <span className="rounded border border-slate-500/40 px-1.5 py-0.5 text-[0.68rem] text-slate-200">
                {advertisedCapabilities.length} operation
                {advertisedCapabilities.length === 1 ? "" : "s"}
              </span>
              <span className="rounded border border-slate-500/40 px-1.5 py-0.5 text-[0.68rem] text-slate-200">
                {refusedCapabilities.length} refused
              </span>
              <span className="rounded border border-slate-500/40 px-1.5 py-0.5 text-[0.68rem] text-slate-200">
                {adaptersWithoutCapabilities.length} empty adapter
                {adaptersWithoutCapabilities.length === 1 ? "" : "s"}
              </span>
              <span className="rounded border border-slate-500/40 px-1.5 py-0.5 text-[0.68rem] text-slate-200">
                {proposalOnlyCapabilities.length} proposal-only
              </span>
            </div>

            {schema.adapters.length > 0 ? (
              <ol
                className="mt-2 grid gap-2 lg:grid-cols-2"
                aria-label="Daemon-advertised language adapters in canonical order"
              >
                {schema.adapters.map((adapter, adapterIndex) => (
                  <AdapterCard
                    key={`${adapter.languageId}:${adapterIndex}`}
                    adapter={adapter}
                    ordinal={adapterIndex + 1}
                  />
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-xs font-medium text-amber-100">
                No language adapters were advertised.
              </p>
            )}

            {refusedCapabilities.length > 0 ? (
              <div
                className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs leading-5 text-amber-100"
                role="note"
              >
                <strong>Explicitly refused capabilities:</strong>{" "}
                {refusedCapabilities
                  .map(({ adapter, capability }) => `${adapter.languageId}:${capability.operation}`)
                  .join(", ")}
              </div>
            ) : null}

            {adaptersWithoutCapabilities.length > 0 ? (
              <div
                className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs leading-5 text-amber-100"
                role="note"
              >
                <strong>Adapters with no advertised capabilities:</strong>{" "}
                {adaptersWithoutCapabilities.map((adapter) => adapter.languageId).join(", ")}
              </div>
            ) : null}

            {proposalOnlyCapabilities.length > 0 ? (
              <div
                className="mt-2 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-xs leading-5 text-violet-100"
                role="note"
              >
                <strong>Proposal-only mutation warning:</strong>{" "}
                {proposalOnlyCapabilities
                  .map(({ adapter, capability }) => `${adapter.languageId}:${capability.operation}`)
                  .join(", ")}
                . Proposal-only capability is not managed write authority.
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs leading-5 text-amber-100">{unavailableReason}</p>
        )}

        {capabilities?.safety ? (
          <section className="mt-2" aria-label="Daemon-advertised RefactorKit safety flags">
            <h6 className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Exact daemon safety flags
            </h6>
            <dl className="mt-1 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-2">
              <div className="flex gap-1">
                <dt>previewBeforeApply:</dt>
                <dd>
                  <ExactBoolean value={capabilities.safety.previewBeforeApply} />
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>snapshotValidation:</dt>
                <dd>
                  <ExactBoolean value={capabilities.safety.snapshotValidation} />
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>transactionRollback:</dt>
                <dd>
                  <ExactBoolean value={capabilities.safety.transactionRollback} />
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>workspaceScopedWrites:</dt>
                <dd>
                  <ExactBoolean value={capabilities.safety.workspaceScopedWrites} />
                </dd>
              </div>
            </dl>
          </section>
        ) : (
          <p className="mt-2 text-[0.68rem] leading-4 text-[var(--text-secondary)]" role="note">
            Daemon safety flags were not supplied; no safety behavior is inferred.
          </p>
        )}
      </section>

      <section
        className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2"
        aria-labelledby={readinessHeadingId}
      >
        <h5 id={readinessHeadingId} className="text-xs font-semibold text-amber-100">
          Current workspace / toolchain / session readiness
        </h5>
        <p className="mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
          Schema v1 does not report per-adapter toolchain, workspace, or session readiness.
          Operation backend, runtime configuration, extensions, versions, and successful discovery
          are metadata, not readiness signals.
        </p>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-2">
          <div className="flex gap-1">
            <dt>Local daemon availability:</dt>
            <dd className="font-medium text-[var(--text-primary)]">
              {daemonStatus
                ? daemonStatus.available
                  ? "Available"
                  : "Unavailable"
                : "Unknown / not reported"}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Capability discovery:</dt>
            <dd className="font-medium text-[var(--text-primary)]">
              {languageKernel
                ? languageKernel.available
                  ? "Successful"
                  : "Unavailable"
                : "Unknown / not reported"}
            </dd>
          </div>
        </dl>

        {schema && schema.adapters.length > 0 ? (
          <ol className="mt-2 grid gap-1" aria-label="Per-adapter readiness reported by schema v1">
            {schema.adapters.map((adapter, adapterIndex) => (
              <li
                key={`${adapter.languageId}:${adapterIndex}`}
                className="rounded border border-amber-500/20 px-2 py-1.5"
              >
                <p className="text-[0.68rem] font-semibold text-[var(--text-primary)]">
                  {adapterIndex + 1}. <code>{adapter.languageId}</code>
                </p>
                <dl className="mt-1 grid gap-x-4 gap-y-1 text-[0.68rem] text-[var(--text-secondary)] sm:grid-cols-3">
                  <div className="flex gap-1">
                    <dt>Toolchain:</dt>
                    <ReadinessValue />
                  </div>
                  <div className="flex gap-1">
                    <dt>Workspace:</dt>
                    <ReadinessValue />
                  </div>
                  <div className="flex gap-1">
                    <dt>Session:</dt>
                    <ReadinessValue />
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-[0.68rem] font-medium text-amber-100">
            Per-adapter toolchain, workspace, and session readiness: Unknown / not reported.
          </p>
        )}
      </section>

      <p
        className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs leading-5 text-red-100"
        role="note"
      >
        <strong>Protocol gap / refusal:</strong> Discovery operations only report metadata. They do
        not authorize writes and do not imply callable IDE or daemon operation methods. No language
        operation is exposed from this lab.
      </p>
    </section>
  );
}
