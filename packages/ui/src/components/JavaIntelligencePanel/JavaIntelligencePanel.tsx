// ---------------------------------------------------------------------------
// @ide/ui – JavaIntelligencePanel
// Presentation-only managed Java language-service and RefactorKit controls.
// Host applications own discovery, lifecycle management, and tool execution.
// ---------------------------------------------------------------------------

import type {
  LanguageServiceCapabilities,
  LanguageServiceState,
  LanguageServiceStatus,
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitLocation,
  RefactorKitStatus,
} from "@ide/contracts";
import { RefactorKitLanguageLab } from "../RefactorKitLanguageLab";
import { Button } from "../ui/Button";

export type JavaIntelligenceAvailabilityStatus = "checking" | "available" | "unavailable" | "error";
export type JavaIntelligencePresentationMode = "settings" | "project";

export type JavaIntelligenceOperation =
  "scan" | "diagnostics" | "symbols" | "definition" | "references";

/** Provider-neutral, presentation-only state supplied by the host diagnostics controller. */
export type LanguageToolingDiagnosticsPresentation =
  | { readonly state: "checking" }
  | { readonly state: "ready"; readonly diagnosticCount: number }
  | { readonly state: "refused"; readonly message: string }
  | { readonly state: "error"; readonly message: string };

export interface JavaIntelligencePanelProps {
  /** Settings shows global tooling; project (default) includes workspace operations. */
  presentationMode?: JavaIntelligencePresentationMode;
  /** Backward-compatible shorthand for presentationMode. */
  mode?: JavaIntelligencePresentationMode;
  /** Provider-neutral status for the host-managed interactive language service. */
  languageServiceStatus?: LanguageServiceStatus | null;
  isLanguageServiceRefreshing?: boolean;
  onStartLanguageService?: () => void | Promise<void>;
  onStopLanguageService?: () => void | Promise<void>;
  onRestartLanguageService?: () => void | Promise<void>;
  onRefreshLanguageService?: () => void | Promise<void>;
  /** Optional host-owned setup flow. The UI never downloads tooling itself. */
  onSetupLanguageService?: () => void | Promise<void>;
  status?: RefactorKitStatus | null;
  /** Backend-reported RefactorKit capability discovery supplied by the host. */
  capabilities?: RefactorKitCapabilities | null;
  isChecking?: boolean;
  error?: string | null;
  isRunning?: boolean;
  runningOperation?: JavaIntelligenceOperation | null;
  latestOperation?: JavaIntelligenceOperation | null;
  result?: RefactorKitCommandResult | null;
  /** Closed host-owned compiler-diagnostics presentation; diagnostic details remain in Problems. */
  languageToolingDiagnostics?: LanguageToolingDiagnosticsPresentation | null;
  symbol?: string;
  onSymbolChange?: (symbol: string) => void;
  onRefresh?: () => void | Promise<void>;
  onScan?: () => void | Promise<void>;
  /** Existing legacy Java command callback. */
  onDiagnostics?: () => void | Promise<void>;
  /** Requests host-owned compiler diagnostics without defining request policy in the UI. */
  onRequestLanguageToolingDiagnostics?: () => void | Promise<void>;
  onSymbols?: () => void | Promise<void>;
  onDefinition?: (symbol: string) => void | Promise<void>;
  onReferences?: (symbol: string) => void | Promise<void>;
  /** Called when an actionable structured result location is selected. */
  onNavigateLocation?: (location: RefactorKitLocation) => void;
}

const operationLabels: Record<JavaIntelligenceOperation, string> = {
  scan: "Scan",
  diagnostics: "Diagnostics",
  symbols: "Symbols",
  definition: "Definition",
  references: "References",
};

const statusStyles: Record<JavaIntelligenceAvailabilityStatus, string> = {
  checking: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  unavailable: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
};

const statusLabels: Record<JavaIntelligenceAvailabilityStatus, string> = {
  checking: "Checking availability…",
  available: "Available",
  unavailable: "Unavailable",
  error: "Availability check failed",
};

const diagnosticsStateStyles: Record<LanguageToolingDiagnosticsPresentation["state"], string> = {
  checking: statusStyles.checking,
  ready: statusStyles.available,
  refused: statusStyles.unavailable,
  error: statusStyles.error,
};

const diagnosticsStateLabels: Record<LanguageToolingDiagnosticsPresentation["state"], string> = {
  checking: "Checking",
  ready: "Ready",
  refused: "Refused",
  error: "Error",
};

const MAX_DIAGNOSTICS_MESSAGE_LENGTH = 240;

function safeDiagnosticsMessage(message: string, fallback: string): string {
  const sanitized = message
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b(?:file|https?):\/\/\S+/giu, "[redacted resource]")
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s/\\]+[/\\])+[^\s,;)]*/gu, "[redacted path]")
    .replace(/\b[a-f0-9]{64}\b/giu, "[redacted identifier]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const text = sanitized || fallback;
  const characters = Array.from(text);
  return characters.length <= MAX_DIAGNOSTICS_MESSAGE_LENGTH
    ? text
    : `${characters.slice(0, MAX_DIAGNOSTICS_MESSAGE_LENGTH - 1).join("")}…`;
}

const lifecycleStyles: Record<LanguageServiceState, string> = {
  unavailable: statusStyles.unavailable,
  stopped: "border-slate-500/40 bg-slate-500/10 text-slate-200",
  starting: statusStyles.checking,
  indexing: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  ready: statusStyles.available,
  degraded: statusStyles.unavailable,
  failed: statusStyles.error,
  stopping: "border-slate-500/40 bg-slate-500/10 text-slate-200",
};

const capabilityLabels: Record<keyof LanguageServiceCapabilities, string> = {
  documentSync: "Document sync",
  diagnostics: "Diagnostics",
  completion: "Completion",
  hover: "Hover",
  signature: "Signature help",
  definition: "Definition",
  references: "References",
  symbols: "Symbols",
  codeActions: "Code actions",
  formatting: "Formatting",
  rename: "Rename",
  hierarchy: "Hierarchy",
};

function BooleanValue({ value }: { value: boolean }): JSX.Element {
  return <span>{value ? "Yes" : "No"}</span>;
}

interface LanguageServiceSectionProps {
  status?: LanguageServiceStatus | null;
  refreshing: boolean;
  onStart?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onRestart?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onSetup?: () => void | Promise<void>;
}

function LanguageServiceSection({
  status,
  refreshing,
  onStart,
  onStop,
  onRestart,
  onRefresh,
  onSetup,
}: LanguageServiceSectionProps): JSX.Element {
  const state = status?.state ?? "unavailable";
  const transitioning = state === "starting" || state === "indexing" || state === "stopping";
  const canStart = state === "stopped" || state === "failed";
  const canStop =
    state === "starting" || state === "indexing" || state === "ready" || state === "degraded";
  const canRestart =
    state === "indexing" || state === "ready" || state === "degraded" || state === "failed";
  const trueCapabilities = status
    ? (Object.keys(status.capabilities) as Array<keyof LanguageServiceCapabilities>).filter(
        (key) => status.capabilities[key],
      )
    : [];

  return (
    <section
      className="rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
      aria-labelledby="jdt-language-service-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <div className="min-w-0">
          <h3
            id="jdt-language-service-heading"
            className="text-xs font-semibold uppercase tracking-wide"
          >
            Java Language Service · Eclipse JDT LS
          </h3>
          <p className="text-[0.68rem] text-[var(--text-secondary)]">
            Java-specific managed lifecycle and setup
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize ${lifecycleStyles[state]}`}
          role="status"
          aria-label="Eclipse JDT LS lifecycle status"
          aria-live="polite"
        >
          {(transitioning || refreshing) && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden="true" />
          )}
          {refreshing ? "Refreshing…" : state}
        </span>
      </header>

      {state === "unavailable" ? (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
          <p>
            <strong className="text-amber-200">JDT LS is not installed or configured.</strong> It is
            external download-on-demand tooling and is not bundled with the IDE.
          </p>
          {onSetup ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void onSetup()}
            >
              Install / Setup Eclipse JDT LS
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-x-5 gap-y-1 border-b border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2 lg:grid-cols-3">
        <span>
          Provider:{" "}
          <strong className="text-[var(--text-primary)]">
            {status?.provider || "Eclipse JDT LS"}
            {status?.providerVersion ? ` ${status.providerVersion}` : ""}
          </strong>
        </span>
        <span className="min-w-0">
          Server:{" "}
          <code className="break-all text-[var(--text-primary)]">
            {status?.serverPath || "Not detected"}
          </code>
          {status?.serverVersion ? ` · ${status.serverVersion}` : ""}
        </span>
        <span className="min-w-0">
          Java:{" "}
          <code className="break-all text-[var(--text-primary)]">
            {status?.javaExecutable || "Not detected"}
          </code>
          {status?.javaVersion ? ` · ${status.javaVersion}` : ""}
        </span>
        <span>
          Workspace:{" "}
          <strong className="text-[var(--text-primary)]">{status?.workspaceId || "Unknown"}</strong>
        </span>
        <span>
          Generation:{" "}
          <strong className="text-[var(--text-primary)]">{status?.generation ?? "Unknown"}</strong>
        </span>
        <span>
          Checked:{" "}
          <time className="text-[var(--text-primary)]" dateTime={status?.checkedAt}>
            {status?.checkedAt || "Not checked"}
          </time>
        </span>
      </div>

      {status?.progress || status?.lastError ? (
        <div className="space-y-1 border-b border-[var(--border-default)] px-3 py-2 text-xs">
          {status.progress ? (
            <p role="status" className="text-[var(--text-secondary)]">
              {status.progress.indexing ? "Indexing" : "Progress"}
              {status.progress.percentage === undefined
                ? ""
                : ` · ${status.progress.percentage}%`}:{" "}
              <span className="text-[var(--text-primary)]">
                {status.progress.message || "In progress"}
              </span>
            </p>
          ) : null}
          {status.lastError ? (
            <p role="alert" className="text-red-200">
              {status.lastError}
            </p>
          ) : null}
        </div>
      ) : null}

      {status && !status.capabilities.documentSync ? (
        <div
          role="note"
          className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100"
        >
          <strong>Interactive semantics inactive:</strong> document sync is unavailable. Editor
          document sync and semantic request integration are required before these features
          activate.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div>
          <p className="mb-1 text-[0.68rem] text-[var(--text-secondary)]">
            Backend-reported capability flags; IDE integration is not implied.
          </p>
          <div
            className="flex flex-wrap gap-1"
            aria-label="Backend-reported language service capability flags"
          >
            {trueCapabilities.map((capability) => (
              <span
                key={capability}
                className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[0.68rem] text-emerald-200"
              >
                {capabilityLabels[capability]}
              </span>
            ))}
            {status && trueCapabilities.length === 0 ? (
              <span className="text-xs text-[var(--text-secondary)]">
                No backend capability flags reported
              </span>
            ) : null}
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Eclipse JDT LS lifecycle actions"
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!onStart || !canStart}
            onClick={() => void onStart?.()}
          >
            Start
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!onStop || !canStop}
            onClick={() => void onStop?.()}
          >
            Stop
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!onRestart || !canRestart}
            onClick={() => void onRestart?.()}
          >
            Restart
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!onRefresh || refreshing || state === "starting" || state === "stopping"}
            onClick={() => void onRefresh?.()}
          >
            Refresh
          </Button>
        </div>
      </div>
    </section>
  );
}

interface LanguageToolingDiagnosticsSectionProps {
  presentation?: LanguageToolingDiagnosticsPresentation | null;
  onRequest?: () => void | Promise<void>;
}

function LanguageToolingDiagnosticsSection({
  presentation,
  onRequest,
}: LanguageToolingDiagnosticsSectionProps): JSX.Element | null {
  if (!presentation && !onRequest) return null;

  const checking = presentation?.state === "checking";
  let summary: string | null = null;
  if (presentation?.state === "checking") {
    summary = "Checking compiler diagnostics for the current authorized source snapshot.";
  } else if (presentation?.state === "ready") {
    const count = presentation.diagnosticCount;
    summary =
      count === 0
        ? "No compiler diagnostics were reported for the current source snapshot."
        : `${count} compiler ${count === 1 ? "diagnostic is" : "diagnostics are"} available in Problems and editor markers.`;
  } else if (presentation?.state === "refused") {
    summary = `Request refused. ${safeDiagnosticsMessage(
      presentation.message,
      "No safe refusal detail was provided.",
    )}`;
  } else if (presentation?.state === "error") {
    summary = `Diagnostics request failed. ${safeDiagnosticsMessage(
      presentation.message,
      "No safe error detail was provided.",
    )}`;
  }

  return (
    <section
      className="border-b border-[var(--border-default)] px-3 py-2"
      aria-labelledby="language-tooling-diagnostics-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4
            id="language-tooling-diagnostics-heading"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
          >
            Compiler diagnostics
          </h4>
          <p
            id="language-tooling-diagnostics-description"
            className="mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]"
          >
            Requests are host-managed. Diagnostic details remain in Problems and editor markers.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!onRequest || checking}
          onClick={() => void onRequest?.()}
          aria-describedby="language-tooling-diagnostics-description"
        >
          {checking ? "Checking diagnostics…" : "Request diagnostics"}
        </Button>
      </div>

      {presentation && summary ? (
        <div
          className={`mt-2 flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${diagnosticsStateStyles[presentation.state]}`}
          role={presentation.state === "error" ? "alert" : "status"}
          aria-label={`Compiler diagnostics status: ${diagnosticsStateLabels[presentation.state]}`}
          aria-live={presentation.state === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          data-diagnostics-state={presentation.state}
        >
          {checking ? (
            <span
              className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-current"
              aria-hidden="true"
            />
          ) : null}
          <p className="min-w-0 break-words">
            <strong>{diagnosticsStateLabels[presentation.state]}.</strong> {summary}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function JavaIntelligencePanel({
  presentationMode,
  mode,
  languageServiceStatus,
  isLanguageServiceRefreshing = false,
  onStartLanguageService,
  onStopLanguageService,
  onRestartLanguageService,
  onRefreshLanguageService,
  onSetupLanguageService,
  status,
  capabilities,
  isChecking = false,
  error,
  isRunning = false,
  runningOperation,
  latestOperation,
  result,
  languageToolingDiagnostics,
  symbol = "",
  onSymbolChange,
  onRefresh,
  onScan,
  onDiagnostics,
  onRequestLanguageToolingDiagnostics,
  onSymbols,
  onDefinition,
  onReferences,
  onNavigateLocation,
}: JavaIntelligencePanelProps): JSX.Element {
  const resolvedMode = presentationMode ?? mode ?? "project";
  const isSettingsMode = resolvedMode === "settings";
  const availabilityError = error || status?.lastError;
  const availabilityStatus: JavaIntelligenceAvailabilityStatus = isChecking
    ? "checking"
    : availabilityError
      ? "error"
      : status?.available
        ? "available"
        : "unavailable";
  const isAvailable = availabilityStatus === "available";
  const disableRefresh = isChecking || isRunning;
  const disableOperations = !isAvailable || isRunning;
  const trimmedSymbol = symbol.trim();
  const disableLookups = disableOperations || trimmedSymbol.length === 0;
  const runningLabel = runningOperation ? operationLabels[runningOperation] : "Operation";

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-panel)] text-[var(--text-primary)]"
      aria-label={isSettingsMode ? "Language tooling" : "Java intelligence"}
    >
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2">
        <h2 className="text-sm font-semibold">
          {isSettingsMode ? "Language Tooling" : "Java Intelligence"}
        </h2>
        <p className="text-xs text-[var(--text-secondary)]">
          {isSettingsMode
            ? "Inspect provider-neutral RefactorKit language discovery and manage Java-specific Eclipse JDT LS tooling."
            : "Java-specific managed language-service lifecycle and deterministic workspace inspection"}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <LanguageServiceSection
          status={languageServiceStatus}
          refreshing={isLanguageServiceRefreshing}
          onStart={onStartLanguageService}
          onStop={onStopLanguageService}
          onRestart={onRestartLanguageService}
          onRefresh={onRefreshLanguageService}
          onSetup={onSetupLanguageService}
        />

        <section
          className="rounded border border-[var(--border-default)] bg-[var(--surface-header)]"
          aria-labelledby="refactorkit-heading"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
            <div>
              <h3
                id="refactorkit-heading"
                className="text-xs font-semibold uppercase tracking-wide"
              >
                RefactorKit
              </h3>
              <p className="text-[0.68rem] text-[var(--text-secondary)]">
                {isSettingsMode
                  ? "Global daemon availability and language capability discovery"
                  : "Daemon availability, language capability discovery, and legacy Java commands"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${statusStyles[availabilityStatus]}`}
                role="status"
                aria-label="RefactorKit availability status"
                aria-live="polite"
              >
                {(isChecking || isRunning) && (
                  <span
                    className="h-2 w-2 animate-pulse rounded-full bg-current"
                    aria-hidden="true"
                  />
                )}
                {isRunning ? `${runningLabel} running…` : statusLabels[availabilityStatus]}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!onRefresh || disableRefresh}
                onClick={() => void onRefresh?.()}
                aria-label="Refresh RefactorKit availability"
              >
                Refresh
              </Button>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
            <span>
              Version:{" "}
              <strong className="font-medium text-[var(--text-primary)]">
                {status?.version || "Unknown"}
              </strong>
            </span>
            <span className="min-w-0">
              Path:{" "}
              <code className="break-all font-mono text-[var(--text-primary)]">
                {status?.path || "Not detected"}
              </code>
            </span>
          </div>

          {availabilityError ? (
            <div
              role="alert"
              className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            >
              {availabilityError}
            </div>
          ) : null}

          <RefactorKitLanguageLab capabilities={capabilities} daemonStatus={status} />

          <LanguageToolingDiagnosticsSection
            presentation={languageToolingDiagnostics}
            onRequest={onRequestLanguageToolingDiagnostics}
          />

          {!isSettingsMode ? (
            <>
              <div
                className="border-b border-[var(--border-default)] px-3 py-2"
                aria-labelledby="java-workspace-controls-heading"
              >
                <h4
                  id="java-workspace-controls-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                >
                  Java workspace controls · Legacy deterministic commands
                </h4>
                <p className="mb-2 mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
                  These Java-only controls remain separate because their host commands already
                  exist. Language Lab discovery does not enable them.
                </p>
                <div
                  className="flex flex-wrap items-end gap-1.5"
                  role="group"
                  aria-label="Java workspace intelligence actions"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!onScan || disableOperations}
                    onClick={() => void onScan?.()}
                  >
                    Scan
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!onDiagnostics || disableOperations}
                    onClick={() => void onDiagnostics?.()}
                  >
                    Diagnostics
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!onSymbols || disableOperations}
                    onClick={() => void onSymbols?.()}
                  >
                    Symbols
                  </Button>
                  <div className="ml-1 flex min-w-64 flex-1 flex-wrap items-end gap-1.5">
                    <div className="min-w-52 flex-1">
                      <label
                        htmlFor="java-symbol-selector"
                        className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
                      >
                        Symbol selector
                      </label>
                      <input
                        id="java-symbol-selector"
                        type="text"
                        value={symbol}
                        onChange={(event) => onSymbolChange?.(event.target.value)}
                        aria-describedby="java-symbol-selector-help"
                        placeholder="com.acme.Order#findById(java.lang.String)"
                        autoComplete="off"
                        spellCheck={false}
                        className="h-6 w-full rounded-sm border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--border-focus)] focus:outline-none"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!onDefinition || disableLookups}
                      onClick={() => void onDefinition?.(trimmedSymbol)}
                    >
                      Definition
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!onReferences || disableLookups}
                      onClick={() => void onReferences?.(trimmedSymbol)}
                    >
                      References
                    </Button>
                  </div>
                </div>
                <p
                  id="java-symbol-selector-help"
                  className="mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]"
                >
                  Enter a fully qualified class or member, for example com.acme.Order or
                  com.acme.Order#findById(java.lang.String).
                </p>
              </div>

              <div className="min-h-56 p-3">
                {result ? (
                  <section
                    className="flex min-h-52 flex-col"
                    aria-labelledby="java-intelligence-result-heading"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3
                        id="java-intelligence-result-heading"
                        className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                      >
                        Latest result
                        {latestOperation ? ` · ${operationLabels[latestOperation]}` : ""}
                      </h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${result.success ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}
                      >
                        {result.success ? "Success" : "Failed"}
                      </span>
                    </div>
                    <dl
                      className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]"
                      aria-label="Operation result details"
                    >
                      <div className="flex gap-1">
                        <dt>Success:</dt>
                        <dd className="text-[var(--text-primary)]">
                          <BooleanValue value={result.success} />
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Exit code:</dt>
                        <dd className="font-mono text-[var(--text-primary)]">{result.code}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Timeout:</dt>
                        <dd className="text-[var(--text-primary)]">
                          <BooleanValue value={result.timedOut} />
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Truncated:</dt>
                        <dd className="text-[var(--text-primary)]">
                          <BooleanValue value={result.stdoutTruncated || result.stderrTruncated} />
                        </dd>
                      </div>
                    </dl>
                    <div
                      className="min-h-36 flex-1 overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-2 font-mono text-xs leading-5"
                      aria-label="RefactorKit operation output"
                      tabIndex={0}
                    >
                      {result.locations.length > 0 ? (
                        <section
                          className="mb-3 font-sans"
                          aria-labelledby="refactorkit-locations-heading"
                        >
                          <h4
                            id="refactorkit-locations-heading"
                            className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                          >
                            Locations
                          </h4>
                          <ul className="mt-1 space-y-1">
                            {result.locations.map((location, index) => {
                              const label = `${location.path}:${location.line}${location.column === undefined ? "" : `:${location.column}`}`;
                              return (
                                <li key={`${label}-${index}`}>
                                  {onNavigateLocation ? (
                                    <button
                                      type="button"
                                      className="w-full rounded px-2 py-1 text-left font-mono text-xs text-blue-300 hover:bg-blue-500/10 hover:text-blue-200 focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
                                      onClick={() => onNavigateLocation(location)}
                                    >
                                      {label}
                                    </button>
                                  ) : (
                                    <span className="block px-2 py-1 font-mono text-xs text-[var(--text-primary)]">
                                      {label}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      ) : null}
                      {result.stdout ? (
                        <div>
                          <h4 className="font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                            stdout
                          </h4>
                          <pre className="whitespace-pre-wrap break-words text-[var(--text-primary)]">
                            {result.stdout}
                          </pre>
                        </div>
                      ) : null}
                      {result.stderr ? (
                        <div
                          className={result.stdout ? "mt-3" : undefined}
                          role={result.success ? undefined : "alert"}
                        >
                          <h4 className="font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-red-300">
                            stderr
                          </h4>
                          <pre className="whitespace-pre-wrap break-words text-red-200">
                            {result.stderr}
                          </pre>
                        </div>
                      ) : null}
                      {!result.stdout && !result.stderr ? (
                        <p className="font-sans text-[var(--text-secondary)]">
                          The operation produced no output.
                        </p>
                      ) : null}
                    </div>
                  </section>
                ) : (
                  <div className="flex min-h-48 items-center justify-center rounded border border-dashed border-[var(--border-default)] bg-[var(--surface-editor)] px-6 text-center">
                    <div className="max-w-lg">
                      <h3 className="text-sm font-medium">Deterministic Java intelligence</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        Scan the current workspace, inspect diagnostics, or find symbols with
                        RefactorKit. Results from the latest operation will appear here.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]" role="note">
              RefactorKit availability is global. Scans, diagnostics, symbol queries, results, and
              navigation are contributed by detected or configured Java modules.
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
