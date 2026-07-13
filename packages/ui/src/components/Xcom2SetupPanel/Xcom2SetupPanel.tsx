// ---------------------------------------------------------------------------
// @ide/ui – Xcom2SetupPanel
// Presentation-only view of the host-provided, redacted Steam monitor snapshot.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import type {
  SteamByteCount,
  Xcom2ProductLifecycle,
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupPlan,
  Xcom2SetupTransactionDetail,
  Xcom2SetupTransactionEvent,
  Xcom2SetupTransactionSummary,
  Xcom2SteamProductIdentifier,
  Xcom2SteamProductStatus,
} from "@ide/contracts";
import { XCOM2_FEATURE_DESCRIPTOR, XCOM2_STEAM_PRODUCTS, isSteamByteCount } from "@ide/contracts";
import { Button } from "../ui/Button";

export interface Xcom2SetupPanelProps {
  /** Latest export-safe snapshot supplied by the host. */
  snapshot?: Xcom2SetupMonitorSnapshot | null;
  isLoading?: boolean;
  error?: string | null;
  /** The host decides when its cached snapshot is stale. */
  isStale?: boolean;
  onRefresh?: () => void | Promise<void>;
  /** Export-safe dry-run plan generated from the latest snapshot. */
  plan?: Xcom2SetupPlan | null;
  /** Host-owned dry-run planning flow; it never applies setup. */
  onPlanSetup?: () => void | Promise<void>;
  /** Native-owned transaction detail. All targets and operations must already be redacted. */
  currentTransaction?: Xcom2SetupTransactionDetail | null;
  transactions?: readonly Xcom2SetupTransactionSummary[];
  isTransactionLoading?: boolean;
  transactionError?: string | null;
  transactionProgressEvent?: Xcom2SetupTransactionEvent | null;
  onPrepare?: () => void | Promise<void>;
  /** The second argument must be the exact native-reviewed digest. */
  onApply?: (transactionId: string, approvalDigest: string) => void | Promise<void>;
  /** Optional host-owned clipboard integration for the complete approval digest. */
  onCopyDigest?: (approvalDigest: string) => void | Promise<void>;
  onCancel?: (transactionId: string) => void | Promise<void>;
  onRollback?: (transactionId: string) => void | Promise<void>;
  onRecover?: (transactionId: string) => void | Promise<void>;
  onRefreshHistory?: () => void | Promise<void>;
}

const lifecycleStyles: Record<Xcom2ProductLifecycle, string> = {
  "not-found": "border-slate-500/40 bg-slate-500/10 text-[var(--text-secondary)]",
  queued: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  downloading: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  staging: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  paused: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  verifying: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  installed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  incomplete: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  unknown: "border-slate-500/40 bg-slate-500/10 text-[var(--text-secondary)]",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatXcom2ByteCount(value: SteamByteCount | undefined): string {
  if (!isSteamByteCount(value)) return "Unknown";
  const bytes = BigInt(value);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let divisor = 1n;
  let unit = 0;
  while (unit < units.length - 1 && bytes >= divisor * 1024n) {
    divisor *= 1024n;
    unit += 1;
  }
  if (unit === 0) return `${bytes.toString()} B`;
  const tenths = (bytes * 10n) / divisor;
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return `${whole.toString()}${decimal === 0n ? "" : `.${decimal.toString()}`} ${units[unit]}`;
}

interface ProgressRowProps {
  label: "Download" | "Staging";
  completed?: SteamByteCount;
  total?: SteamByteCount;
  percentage?: number;
  completedWord: "downloaded" | "staged";
  productName: string;
}

function ProgressRow({
  label,
  completed,
  total,
  percentage,
  completedWord,
  productName,
}: ProgressRowProps): JSX.Element {
  const knownPercentage = typeof percentage === "number" && Number.isFinite(percentage);
  const safePercentage = knownPercentage ? Math.max(0, Math.min(100, percentage)) : 0;
  const valueText = knownPercentage ? `${safePercentage}%` : "Progress unknown";

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap justify-between gap-x-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-[var(--text-secondary)]">{valueText}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${productName} ${label.toLowerCase()} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={knownPercentage ? safePercentage : undefined}
        aria-valuetext={valueText}
        className="h-2 overflow-hidden rounded-full bg-[var(--surface-background)] ring-1 ring-inset ring-[var(--border-default)]"
      >
        <div className="h-full bg-[var(--accent-blue)]" style={{ width: `${safePercentage}%` }} />
      </div>
      <p className="text-[0.72rem] text-[var(--text-secondary)]">
        {formatXcom2ByteCount(completed)} {completedWord} / {formatXcom2ByteCount(total)} total
      </p>
    </div>
  );
}

function EvidenceList({
  label,
  values,
  empty,
}: {
  label: string;
  values: readonly string[];
  empty: string;
}): JSX.Element {
  return (
    <div>
      <dt className="font-medium text-[var(--text-primary)]">{label}</dt>
      <dd>
        {values.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {values.map((value, index) => (
              <li key={`${value}-${index}`}>{value}</li>
            ))}
          </ul>
        ) : (
          <span>{empty}</span>
        )}
      </dd>
    </div>
  );
}

function MissingProductCard({ product }: { product: Xcom2SteamProductIdentifier }): JSX.Element {
  return (
    <article
      className="min-w-0 rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
      aria-labelledby={`xcom2-product-${product.appId}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <div>
          <h3 id={`xcom2-product-${product.appId}`} className="text-sm font-semibold">
            {product.name}
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Steam AppID {product.appId} ·{" "}
            {product.role === "required" ? "Required" : "Related / optional evidence"}
          </p>
        </div>
        <span
          role="status"
          aria-label={`${product.name} lifecycle: Not Found`}
          className={`rounded-full border px-2 py-0.5 text-xs ${lifecycleStyles["not-found"]}`}
        >
          Not Found
        </span>
      </header>
      <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">
        No status was reported for this product in the current snapshot.
      </p>
    </article>
  );
}

function ProductCard({ status }: { status: Xcom2SteamProductStatus }): JSX.Element {
  const { product } = status;
  return (
    <article
      className="min-w-0 rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
      aria-labelledby={`xcom2-product-${product.appId}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <div className="min-w-0">
          <h3 id={`xcom2-product-${product.appId}`} className="text-sm font-semibold">
            {product.name}
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Steam AppID {product.appId} ·{" "}
            {product.role === "required" ? "Required" : "Related / optional evidence"}
          </p>
        </div>
        <span
          role="status"
          aria-label={`${product.name} lifecycle: ${titleCase(status.lifecycle)}`}
          className={`rounded-full border px-2 py-0.5 text-xs ${lifecycleStyles[status.lifecycle]}`}
        >
          {titleCase(status.lifecycle)}
        </span>
      </header>

      <div className="grid gap-3 border-b border-[var(--border-default)] p-3 sm:grid-cols-2">
        <ProgressRow
          label="Download"
          productName={product.name}
          completed={status.bytesDownloaded}
          total={status.bytesToDownload}
          percentage={status.downloadPercentage}
          completedWord="downloaded"
        />
        <ProgressRow
          label="Staging"
          productName={product.name}
          completed={status.bytesStaged}
          total={status.bytesToStage}
          percentage={status.stagingPercentage}
          completedWord="staged"
        />
      </div>

      <dl className="grid gap-x-4 gap-y-1 border-b border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-[var(--text-primary)]">StateFlags: </dt>
          <dd className="inline font-mono">{status.stateFlags ?? "Not reported"}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--text-primary)]">Size on disk: </dt>
          <dd className="inline">{formatXcom2ByteCount(status.sizeOnDisk)}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--text-primary)]">
            Install directory present:{" "}
          </dt>
          <dd className="inline">{status.installDirectoryPresent ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--text-primary)]">
            Download directory present:{" "}
          </dt>
          <dd className="inline">{status.downloadDirectoryPresent ? "Yes" : "No"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline font-medium text-[var(--text-primary)]">Last update: </dt>
          <dd className="inline">
            <time dateTime={status.manifestLastModifiedAt}>
              {status.manifestLastModifiedAt ?? "No manifest found"}
            </time>
          </dd>
        </div>
        {status.manifestProvenance ? (
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-[var(--text-primary)]">Manifest provenance: </dt>
            <dd className="inline">
              {status.manifestProvenance.displayPath ?? "Redacted Steam app manifest"} (path
              redacted)
            </dd>
          </div>
        ) : null}
      </dl>

      <dl className="grid gap-3 px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-3">
        <EvidenceList
          label={`Completeness: ${status.complete ? "Complete" : "Incomplete"}`}
          values={status.completionReasons}
          empty="No completeness evidence reported"
        />
        <EvidenceList
          label={`Stability: ${status.stable ? "Stable" : "Unstable"}`}
          values={status.stabilityReasons}
          empty="No stability evidence reported"
        />
        <EvidenceList
          label={`Mutation: ${status.mutationBlocked ? "Blocked" : "Not blocked by product evidence"}`}
          values={status.mutationBlockedReasons}
          empty="No product blockers reported"
        />
      </dl>
    </article>
  );
}

function safeDisplay(value: string): string {
  return value
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s/\\]+[\/\\])+[^\s,;)]*/g, "[redacted path]")
    .replace(/file:\/\/\S+/gi, "[redacted path]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[redacted hash]");
}

function shortHash(digest: string | undefined): string {
  if (!digest) return "Not recorded";
  return digest.length > 16 ? `${digest.slice(0, 8)}…${digest.slice(-8)}` : digest;
}

function sdkScopeCounts(operations: Xcom2SetupTransactionDetail["operations"]): {
  day0Patches: number;
  sourceControlPatch: number;
  tleQuarantines: number;
  cookedPcConsoleSymlinks: number;
  total: number;
  exact: boolean;
} {
  const configPatches = operations.filter(
    (operation) => operation.kind === "atomic-text-config-patch",
  ).length;
  // Native exposes the three audited patches as one operation kind. The fixed,
  // versioned scope assigns two to Day0 and one to SourceControl/GameAssetDatabase.
  const day0Patches = configPatches === 3 ? 2 : 0;
  const sourceControlPatch = configPatches === 3 ? 1 : 0;
  const tleQuarantines = operations.filter(
    (operation) => operation.kind === "quarantine-restore-file",
  ).length;
  const cookedPcConsoleSymlinks = operations.filter(
    (operation) => operation.kind === "create-restore-symlink",
  ).length;
  const total = operations.length;

  return {
    day0Patches,
    sourceControlPatch,
    tleQuarantines,
    cookedPcConsoleSymlinks,
    total,
    exact:
      total === 15 &&
      configPatches === 3 &&
      day0Patches === 2 &&
      sourceControlPatch === 1 &&
      tleQuarantines === 11 &&
      cookedPcConsoleSymlinks === 1,
  };
}

function TransactionPanel({
  transaction,
  transactions = [],
  loading = false,
  error,
  progress,
  onPrepare,
  onApply,
  onCopyDigest,
  onCancel,
  onRollback,
  onRecover,
  onRefreshHistory,
}: {
  transaction?: Xcom2SetupTransactionDetail | null;
  transactions?: readonly Xcom2SetupTransactionSummary[];
  loading?: boolean;
  error?: string | null;
  progress?: Xcom2SetupTransactionEvent | null;
  onPrepare?: () => void | Promise<void>;
  onApply?: (transactionId: string, digest: string) => void | Promise<void>;
  onCopyDigest?: (digest: string) => void | Promise<void>;
  onCancel?: (transactionId: string) => void | Promise<void>;
  onRollback?: (transactionId: string) => void | Promise<void>;
  onRecover?: (transactionId: string) => void | Promise<void>;
  onRefreshHistory?: () => void | Promise<void>;
}): JSX.Element {
  const binding = transaction?.reviewedOperationDigest?.digest;
  const [acknowledgedBinding, setAcknowledgedBinding] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [restoreReview, setRestoreReview] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);

  useEffect(() => {
    setAcknowledgedBinding(null);
    setCopyStatus(null);
    setRestoreReview(false);
    setRestoreConfirmed(false);
  }, [transaction?.transactionId, binding]);

  const blockers = transaction?.applyAvailability.blockers ?? [];
  const scope = sdkScopeCounts(transaction?.operations ?? []);
  const hasExactApprovalDigest = typeof binding === "string" && /^[0-9a-f]{64}$/i.test(binding);
  const showApply = Boolean(
    transaction &&
    ["waiting-for-download", "planned", "awaiting-approval"].includes(transaction.state) &&
    onApply,
  );
  const canApply = Boolean(
    transaction?.state === "awaiting-approval" &&
    showApply &&
    transaction?.executable &&
    transaction.applyAvailability.allowed &&
    blockers.length === 0 &&
    scope.exact &&
    hasExactApprovalDigest,
  );
  const canCancel = Boolean(
    transaction &&
    ["waiting-for-download", "awaiting-approval", "applying", "rolling-back"].includes(
      transaction.state,
    ) &&
    onCancel,
  );
  const canRestore = Boolean(
    transaction?.rollbackAvailable &&
    ["applied", "partial", "recovery-required", "rollback-conflict"].includes(transaction.state) &&
    onRollback,
  );
  const canRecover = Boolean(
    transaction && ["partial", "recovery-required"].includes(transaction.state) && onRecover,
  );
  const originalStateCaptured = Boolean(
    transaction &&
    scope.exact &&
    transaction.operations.every(
      (operation) =>
        operation.kind === "create-restore-symlink" || operation.originalHash !== undefined,
    ),
  );
  const baselineLabels = Array.from(
    new Set(transaction?.operations.map((operation) => operation.target.redactedLabel) ?? []),
  );
  const bindingKey =
    transaction && hasExactApprovalDigest ? `${transaction.transactionId}:${binding}` : null;
  const acknowledged = bindingKey !== null && acknowledgedBinding === bindingKey;

  const copyDigest = async (): Promise<void> => {
    if (!binding || !onCopyDigest) return;
    try {
      await onCopyDigest(binding);
      setCopyStatus("Approval digest copied.");
    } catch {
      setCopyStatus(
        "Unable to copy the approval digest. Select the complete visible digest instead.",
      );
    }
  };

  return (
    <section
      className="rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
      aria-labelledby="xcom2-transaction-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <div>
          <h3
            id="xcom2-transaction-heading"
            className="text-xs font-semibold uppercase tracking-wide"
          >
            Repeatable SDK setup transaction
          </h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Native preparation audits one reversible SDK write set. It never performs downloads,
            installs, package-manager work, or user-only setup.
          </p>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Transaction preparation and history"
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!onPrepare || loading}
            onClick={() => void onPrepare?.()}
          >
            {transaction?.state === "rolled-back" ? "Prepare Again" : "Prepare SDK Setup"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!onRefreshHistory || loading}
            onClick={() => void onRefreshHistory?.()}
          >
            Refresh history
          </Button>
        </div>
      </div>

      {loading ? (
        <p
          role="status"
          aria-live="polite"
          className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs"
        >
          Loading transaction state…
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {safeDisplay(error)}
        </p>
      ) : null}
      {progress ? (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs"
        >
          <strong>{titleCase(progress.state)}</strong>
          {typeof progress.completedOperations === "number" &&
          typeof progress.totalOperations === "number"
            ? ` · ${progress.completedOperations} of ${progress.totalOperations} operations`
            : ""}
          {progress.message ? ` · ${safeDisplay(progress.message)}` : ""}
        </div>
      ) : null}

      {transaction ? (
        <div className="space-y-3 p-3">
          <dl className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-medium text-[var(--text-primary)]">State</dt>
              <dd>{titleCase(transaction.state)}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--text-primary)]">Transaction</dt>
              <dd className="font-mono">{safeDisplay(transaction.transactionId)}</dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--text-primary)]">Workspace / generation</dt>
              <dd>
                {safeDisplay(transaction.workspaceId)} / {transaction.workspaceGeneration}
              </dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <dt className="font-medium text-[var(--text-primary)]">Reviewed digest</dt>
              <dd className="break-all font-mono">
                {binding ? `sha256:${binding}` : "Not recorded"}
              </dd>
            </div>
          </dl>

          <section
            className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] p-3 text-xs"
            aria-labelledby="xcom2-sdk-scope-heading"
          >
            <h4 id="xcom2-sdk-scope-heading" className="font-semibold text-[var(--text-primary)]">
              Exact SDK transaction scope · {scope.total} reversible operations
            </h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--text-secondary)]">
              <li>{scope.day0Patches} Day0 configuration patches</li>
              <li>
                {scope.sourceControlPatch} SourceControl / GameAssetDatabase configuration patch
              </li>
              <li>{scope.tleQuarantines} TLE file quarantines</li>
              <li>{scope.cookedPcConsoleSymlinks} CookedPCConsole symlink creation</li>
            </ul>
            <p className="mt-2 text-amber-200">
              Excluded: Protontricks, Steam shortcut creation, Proton prefix setup, installers,
              package-manager commands, downloads, and every other user-action step.
            </p>
            {!scope.exact ? (
              <p role="alert" className="mt-1 text-red-200">
                Apply blocked: native evidence does not describe the required 15-operation SDK
                scope.
              </p>
            ) : null}
          </section>

          <section
            className="rounded border border-[var(--border-default)] px-3 py-2 text-xs"
            aria-labelledby="xcom2-vanilla-baseline-heading"
          >
            <h4 id="xcom2-vanilla-baseline-heading" className="font-semibold">
              Vanilla SDK baseline
            </h4>
            <dl className="mt-1 grid gap-1 text-[var(--text-secondary)] sm:grid-cols-2">
              <div>
                <dt className="font-medium text-[var(--text-primary)]">Steam build evidence</dt>
                <dd>
                  {baselineLabels.length > 0
                    ? baselineLabels.map(safeDisplay).join("; ")
                    : "No safe build evidence supplied by the contract"}
                  . Fingerprints remain redacted.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">Original state</dt>
                <dd>
                  {originalStateCaptured ? "Captured in the native journal" : "Not fully captured"}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-[var(--text-muted)]">
              Exact bytes, full hashes, file modes, and path inventory remain native-only and
              redacted from this UI.
            </p>
          </section>

          {transaction.state === "applied" ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-semibold text-amber-100">SDK setup is applied.</p>
              <p className="mt-1 text-amber-200">
                Restore Vanilla SDK is the supported way to return this transaction to its captured
                baseline.
              </p>
            </div>
          ) : null}

          {binding ? (
            <div className="space-y-1 rounded border border-blue-500/30 bg-blue-500/10 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="xcom2-approval-digest"
                  className="font-medium text-[var(--text-primary)]"
                >
                  Complete approval digest (SHA-256)
                </label>
                {onCopyDigest ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={loading}
                    onClick={() => void copyDigest()}
                  >
                    Copy Digest
                  </Button>
                ) : null}
              </div>
              <output
                id="xcom2-approval-digest"
                aria-label="Complete approval digest"
                className="block select-all break-all rounded border border-[var(--border-default)] bg-[var(--surface-background)] p-2 font-mono text-[var(--text-primary)]"
              >
                {binding}
              </output>
              {!hasExactApprovalDigest ? (
                <p role="alert" className="text-amber-200">
                  Apply requires the complete 64-character SHA-256 approval digest.
                </p>
              ) : null}
              {copyStatus ? (
                <p role="status" aria-live="polite">
                  {copyStatus}
                </p>
              ) : null}
            </div>
          ) : null}

          {blockers.length > 0 ? (
            <div
              role="note"
              className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <strong>Apply blocked by native state:</strong> {blockers.map(safeDisplay).join("; ")}
            </div>
          ) : null}
          {transaction.externalActions.length > 0 ? (
            <div className="rounded border border-amber-500/30 px-3 py-2 text-xs">
              <p className="font-medium text-amber-200">
                External downloads and grants (never applied by this transaction)
              </p>
              <ul className="mt-1 list-disc pl-4 text-[var(--text-secondary)]">
                {transaction.externalActions.map((action) => (
                  <li key={action.actionId}>
                    {safeDisplay(action.title)} · {titleCase(action.status)} —{" "}
                    {safeDisplay(action.guidance)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded border border-[var(--border-default)]">
            <table className="w-full min-w-[42rem] text-left text-xs">
              <caption className="sr-only">Native reviewed operations</caption>
              <thead className="bg-[var(--surface-background)] text-[var(--text-secondary)]">
                <tr>
                  <th className="p-2">Operation</th>
                  <th className="p-2">Target</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Pre-hash</th>
                  <th className="p-2">Post-hash</th>
                  <th className="p-2">Rollback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {transaction.operations.map((operation) => (
                  <tr key={operation.operationId}>
                    <td className="p-2">
                      <span className="font-medium">{titleCase(operation.kind)}</span>
                      <br />
                      <span className="text-[var(--text-secondary)]">
                        {safeDisplay(operation.summary)}
                      </span>
                    </td>
                    <td className="p-2">{safeDisplay(operation.target.redactedLabel)}</td>
                    <td className="p-2">{titleCase(operation.status)}</td>
                    <td className="p-2 font-mono">{shortHash(operation.originalHash?.digest)}</td>
                    <td className="p-2 font-mono">{shortHash(operation.resultHash?.digest)}</td>
                    <td className="p-2">{titleCase(operation.rollbackSupport)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {transaction.conflictReasons.length > 0 ? (
            <div
              role="alert"
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            >
              <strong>Conflicts:</strong> {transaction.conflictReasons.map(safeDisplay).join("; ")}
            </div>
          ) : null}
          {transaction.recoveryGuidance.length > 0 ? (
            <div
              role="note"
              className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs"
            >
              <strong>Recovery guidance:</strong>{" "}
              {transaction.recoveryGuidance.map(safeDisplay).join("; ")}
            </div>
          ) : null}
          {transaction.state === "rolled-back" ? (
            <p
              role="status"
              className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
            >
              Vanilla SDK baseline restored: captured config bytes and modes, all 11 quarantined TLE
              files, and the original CookedPCConsole state. Choose Prepare Again to run a fresh
              native audit and create a new transaction.
            </p>
          ) : null}

          {canApply && bindingKey ? (
            <label className="flex items-start gap-2 rounded border border-blue-500/30 bg-blue-500/10 p-2 text-xs">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) =>
                  setAcknowledgedBinding(event.target.checked ? bindingKey : null)
                }
              />
              <span>
                I reviewed transaction <code>{safeDisplay(transaction.transactionId)}</code>, the
                complete approval digest <code>{binding}</code>, and grant this transaction one SDK
                write only. The grant cannot be reused by another transaction or for excluded
                external actions.
              </span>
            </label>
          ) : null}
          {canRestore ? (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
              Restore Vanilla SDK restores the captured vanilla configuration bytes and modes,
              restores all 11 quarantined TLE files, and removes only the CookedPCConsole symlink
              created by this transaction. External edits cause a conflict and are not overwritten.
              There is no force option.
            </p>
          ) : null}
          {canRestore && restoreReview ? (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={restoreConfirmed}
                onChange={(event) => setRestoreConfirmed(event.target.checked)}
              />{" "}
              I understand restoration stops on external edits and will not overwrite them.
            </label>
          ) : null}

          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Current transaction actions"
          >
            {showApply ? (
              <Button
                type="button"
                size="sm"
                disabled={!canApply || !acknowledged || loading}
                title={
                  !canApply
                    ? "Native audit, executable evidence, and exact scope must permit apply"
                    : undefined
                }
                onClick={() => binding && void onApply?.(transaction.transactionId, binding)}
              >
                Apply SDK Setup
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={loading}
                onClick={() => void onCancel?.(transaction.transactionId)}
              >
                Cancel transaction
              </Button>
            ) : null}
            {canRestore && !restoreReview ? (
              <Button
                type="button"
                size="sm"
                disabled={loading}
                onClick={() => setRestoreReview(true)}
              >
                Restore Vanilla SDK
              </Button>
            ) : null}
            {canRestore && restoreReview ? (
              <Button
                type="button"
                size="sm"
                disabled={!restoreConfirmed || loading}
                onClick={() => void onRollback?.(transaction.transactionId)}
              >
                Confirm Restore Vanilla SDK
              </Button>
            ) : null}
            {canRecover ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={loading}
                onClick={() => void onRecover?.(transaction.transactionId)}
              >
                Recover transaction
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="p-3 text-xs text-[var(--text-secondary)]">
          No native transaction is selected. Prepare SDK Setup runs the native audit first and may
          return a blocked, non-executable transaction. It never offers a force path.
        </p>
      )}

      <div className="border-t border-[var(--border-default)] px-3 py-2">
        <h4 className="text-xs font-semibold">Transaction history</h4>
        {transactions.length > 0 ? (
          <ol
            className="mt-1 max-h-32 space-y-1 overflow-auto text-xs text-[var(--text-secondary)]"
            aria-label="Setup transaction history"
          >
            {transactions.map((item) => (
              <li key={item.transactionId} className="flex flex-wrap justify-between gap-2">
                <span className="font-mono">{safeDisplay(item.transactionId)}</span>
                <span>
                  {titleCase(item.state)} · generation {item.workspaceGeneration}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-xs text-[var(--text-muted)]">No transaction history loaded.</p>
        )}
      </div>
    </section>
  );
}

const orderedProducts = [
  XCOM2_STEAM_PRODUCTS.game,
  XCOM2_STEAM_PRODUCTS.wotcDevelopmentTools,
  XCOM2_STEAM_PRODUCTS.vanillaDevelopmentTools,
];

export function Xcom2SetupPanel({
  snapshot,
  plan,
  isLoading = false,
  error,
  isStale = false,
  onRefresh,
  onPlanSetup,
  currentTransaction,
  transactions,
  isTransactionLoading,
  transactionError,
  transactionProgressEvent,
  onPrepare,
  onApply,
  onCopyDigest,
  onCancel,
  onRollback,
  onRecover,
  onRefreshHistory,
}: Xcom2SetupPanelProps): JSX.Element {
  const canPlan = Boolean(snapshot && onPlanSetup);
  const noSteamData = Boolean(
    snapshot && (snapshot.overallState === "not-found" || snapshot.products.length === 0),
  );
  const mutationBlocked =
    !snapshot || snapshot.overallState !== "ready" || snapshot.blockers.length > 0;
  const liveMessage = !snapshot
    ? "Setup state unavailable until Steam data is loaded."
    : mutationBlocked
      ? `Setup mutation blocked${snapshot.blockers.length > 0 ? `: ${snapshot.blockers.join("; ")}` : ` while setup is ${titleCase(snapshot.overallState)}`}.`
      : "Downloads are complete. Planning availability comes only from the snapshot; applying setup remains unavailable.";

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-panel)] text-[var(--text-primary)]"
      aria-labelledby="xcom2-setup-heading"
    >
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="xcom2-setup-heading" className="text-sm font-semibold">
                XCOM 2 WOTC Setup
              </h2>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.68rem] font-medium text-amber-300">
                Built-in · Experimental
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Feature ID <code>{XCOM2_FEATURE_DESCRIPTOR.id}</code> · Extension install and remove
              lifecycle is not available yet.
            </p>
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="XCOM 2 setup monitor actions"
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!onRefresh || isLoading}
              onClick={() => void onRefresh?.()}
            >
              Refresh now
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!onPlanSetup || !canPlan || isLoading}
              onClick={() => void onPlanSetup?.()}
              title={!canPlan ? "The current snapshot does not allow setup planning" : undefined}
            >
              Plan Setup
            </Button>
          </div>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-auto p-2"
        tabIndex={0}
        aria-label="XCOM 2 setup monitor details"
      >
        <div className="space-y-2">
          {isLoading ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs"
            >
              Loading Steam setup status…
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              <strong>Unable to load Steam setup status:</strong> {error}
            </div>
          ) : null}
          {isStale && snapshot ? (
            <div
              role="note"
              className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
            >
              <strong>Stale data:</strong> This snapshot may no longer reflect current Steam
              download activity. Refresh now.
            </div>
          ) : null}
          {noSteamData ? (
            <div
              role="note"
              className="rounded border border-slate-500/30 bg-slate-500/10 px-3 py-2 text-xs"
            >
              <strong>Steam products not found.</strong> Steam may be unavailable, or no monitored
              app manifests were discovered.
            </div>
          ) : null}

          <section
            className="rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
            aria-labelledby="xcom2-aggregate-heading"
          >
            <div className="border-b border-[var(--border-default)] px-3 py-2">
              <h3
                id="xcom2-aggregate-heading"
                className="text-xs font-semibold uppercase tracking-wide"
              >
                Aggregate setup state
              </h3>
              <p role="status" aria-live="polite" className="mt-1 text-xs">
                {liveMessage}
              </p>
            </div>
            <dl className="grid gap-x-4 gap-y-1 px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="font-medium text-[var(--text-primary)]">Overall state</dt>
                <dd>{snapshot ? titleCase(snapshot.overallState) : "Unavailable"}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">Can plan setup</dt>
                <dd>{canPlan ? "True · dry-run" : "False"}</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">Can apply setup</dt>
                <dd>False · monitor snapshot is read-only</dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--text-primary)]">Last checked</dt>
                <dd>
                  <time dateTime={snapshot?.checkedAt}>{snapshot?.checkedAt ?? "Not checked"}</time>
                </dd>
              </div>
            </dl>
            {snapshot && (snapshot.blockers.length > 0 || snapshot.warnings.length > 0) ? (
              <div className="grid gap-3 border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
                <EvidenceList
                  label="Setup blockers"
                  values={snapshot.blockers}
                  empty="No blockers reported"
                />
                <EvidenceList
                  label="Warnings"
                  values={snapshot.warnings}
                  empty="No warnings reported"
                />
              </div>
            ) : null}
            {snapshot?.steamRoot ? (
              <p className="border-t border-[var(--border-default)] px-3 py-2 text-[0.72rem] text-[var(--text-secondary)]">
                Steam discovery provenance:{" "}
                {snapshot.steamRoot.displayRoot ?? titleCase(snapshot.steamRoot.source)} (path
                redacted)
              </p>
            ) : null}
          </section>

          {plan ? (
            <section
              className="rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
              aria-labelledby="xcom2-plan-heading"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
                <div>
                  <h3
                    id="xcom2-plan-heading"
                    className="text-xs font-semibold uppercase tracking-wide"
                  >
                    Operational setup plan
                  </h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {titleCase(plan.state)} · dry-run only · {plan.steps.length} ordered steps
                  </p>
                </div>
                <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">
                  No mutations
                </span>
              </div>
              {plan.blockers.length > 0 ? (
                <div
                  role="note"
                  className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                >
                  <strong>Plan blockers:</strong> {plan.blockers.join("; ")}
                </div>
              ) : null}
              <ol
                className="divide-y divide-[var(--border-default)]"
                aria-label="Operational setup steps"
              >
                {plan.steps.map((step, index) => (
                  <li
                    key={step.id}
                    className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
                  >
                    <span className="font-mono text-[var(--text-muted)]">{index + 1}.</span>
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--text-primary)]">{step.title}</p>
                      <p className="text-[var(--text-secondary)]">{step.summary}</p>
                      {step.blockers.length > 0 ? (
                        <p className="mt-1 text-amber-300">{step.blockers.join("; ")}</p>
                      ) : null}
                    </div>
                    <span className="self-start rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[0.68rem] text-[var(--text-secondary)]">
                      {titleCase(step.disposition)}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="border-t border-[var(--border-default)] px-3 py-2 text-[0.68rem] text-[var(--text-muted)]">
                Plan source: workspace generation {plan.workspaceGeneration} · snapshot{" "}
                {plan.sourceCheckedAt}
              </p>
            </section>
          ) : null}

          <TransactionPanel
            transaction={currentTransaction}
            transactions={transactions}
            loading={isTransactionLoading}
            error={transactionError}
            progress={transactionProgressEvent}
            onPrepare={onPrepare}
            onApply={onApply}
            onCopyDigest={onCopyDigest}
            onCancel={onCancel}
            onRollback={onRollback}
            onRecover={onRecover}
            onRefreshHistory={onRefreshHistory}
          />

          <div className="grid gap-2 xl:grid-cols-2" aria-label="Monitored Steam products">
            {orderedProducts.map((product) => {
              const status = snapshot?.products.find(
                (item) => item.product.appId === product.appId,
              );
              return status ? (
                <ProductCard key={product.appId} status={status} />
              ) : (
                <MissingProductCard key={product.appId} product={product} />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
