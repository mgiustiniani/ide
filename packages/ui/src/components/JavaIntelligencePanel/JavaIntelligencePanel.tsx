// ---------------------------------------------------------------------------
// @ide/ui – JavaIntelligencePanel
// Presentation-only managed Java language-service and RefactorKit controls.
// Host applications own discovery, lifecycle management, and tool execution.
// ---------------------------------------------------------------------------

import type {
  JavaNavigationLocation,
  JavaNavigationResult,
  JavaCallHierarchyRequest,
  JavaCallHierarchyResponse,
  JavaReferenceLocation,
  JavaReferencesResponse,
  JavaDefinitionsResponse,
  JavaWorkspaceSymbol,
  JavaWorkspaceSymbolsResponse,
  LanguageServiceCapabilities,
  LanguageServiceState,
  LanguageServiceStatus,
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitLocation,
  RefactorKitStatus,
} from "@ide/contracts";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  /** Persisted host setting for the JDK used to launch JDT LS. */
  serverJdkHomePreference?: string;
  serverJdkHomePreferenceError?: string | null;
  onSaveServerJdkHomePreference?: (home: string) => boolean;
  /** Runs a bounded JDT LS workspace-symbol search for the active workspace. */
  onSearchWorkspaceSymbols?: (query: string) => Promise<JavaWorkspaceSymbolsResponse>;
  /** Incremented by the host to focus the Java symbol query after selecting this activity. */
  focusWorkspaceSymbolSearch?: number;
  /** Incremented by the editor to run JDT LS references after selecting this activity. */
  focusJavaReferencesQuery?: number;
  onCancelWorkspaceSymbolSearch?: () => void;
  onNavigateWorkspaceSymbol?: (symbol: JavaWorkspaceSymbol) => void | Promise<unknown>;
  /** Per-kind saved-snapshot and editor-overlay capability admission. */
  javaPositionCapabilities?: {
    typeDefinition: boolean;
    typeHierarchy: boolean;
    callHierarchy: boolean;
    implementations: boolean;
  };
  isJavaPositionAvailable?: boolean;
  /** Workspace activation and source identity for RefactorKit result lifetime. */
  positionNavigationScope?: string;
  /** Active Java editor cursor for JDT LS operations, independent of RefactorKit admission. */
  isJavaLanguageServicePositionAvailable?: boolean;
  onQueryJavaPosition?: (
    kind: "typeDefinition" | "typeHierarchy" | "callHierarchy" | "implementations",
    direction?: "supertypes" | "subtypes" | "both" | "incoming" | "outgoing",
  ) => Promise<JavaNavigationResult | null>;
  onNavigateJavaPosition?: (
    requestId: string,
    location: JavaNavigationLocation,
  ) => void | Promise<unknown>;
  /** Query the symbol at the current editor cursor with JDT LS references. */
  onQueryJavaReferences?: () => Promise<JavaReferencesResponse>;
  onNavigateJavaReference?: (location: JavaReferenceLocation) => void | Promise<unknown>;
  /** Query definitions for the current synchronized Java buffer using JDT LS. */
  onQueryJavaDefinitions?: (kind?: "definition" | "typeDefinition") => Promise<JavaDefinitionsResponse>;
  javaDefinitionScope?: string;
  onCancelJavaDefinitions?: () => void;
  onNavigateJavaDefinition?: (location: JavaReferenceLocation) => void | Promise<unknown>;
  /** Query callers or callees for the current synchronized Java document using JDT LS. */
  onQueryJavaCallHierarchy?: (
    direction: JavaCallHierarchyRequest["direction"],
  ) => Promise<JavaCallHierarchyResponse>;
  onCancelJavaCallHierarchy?: () => void;
  onNavigateJavaCallHierarchy?: (location: JavaReferenceLocation) => void | Promise<unknown>;
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
  typeDefinition: "Type definition",
  references: "References",
  symbols: "Symbols",
  documentSymbols: "Document outline",
  documentHighlights: "Symbol highlights",
  implementation: "Implementations",
  callHierarchy: "Call hierarchy",
  workspaceSymbols: "Workspace symbol search",
  semanticTokens: "Semantic highlighting",
  inlayHints: "Inlay hints",
  codeActions: "Code actions",
  formatting: "Formatting",
  rangeFormatting: "Range formatting",
  onTypeFormattingTriggers: "Format while typing",
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
        (key) => key === "onTypeFormattingTriggers" ? Boolean(status.capabilities[key]?.length) : status.capabilities[key],
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
          Server Java:{" "}
          <code className="break-all text-[var(--text-primary)]">
            {status?.javaExecutable || "Not detected"}
          </code>
          {status?.javaVersion ? ` · ${status.javaVersion}` : ""}
        </span>
        <span className="min-w-0">
          Project JDK:{" "}
          <code className="break-all text-[var(--text-primary)]">
            {status?.projectJdkHome || "Provider default"}
          </code>
          {status?.projectJdkVersion ? ` · ${status.projectJdkVersion}` : ""}
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

function ServerJdkHomePreference({
  value,
  error,
  onSave,
}: {
  value: string;
  error?: string | null;
  onSave: (home: string) => boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(onSave(draft));
  };

  return (
    <section
      className="border-b border-[var(--border-default)] px-3 py-2"
      aria-labelledby="jdt-runtime-jdk-heading"
    >
      <form className="space-y-1.5" onSubmit={submit}>
        <div>
          <h4
            id="jdt-runtime-jdk-heading"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
          >
            JDT LS runtime JDK
          </h4>
          <p className="mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
            Select the full JDK home used to launch Eclipse JDT LS. This is independent of the
            project JDK. Leave empty to discover a runtime from the environment and PATH.
          </p>
        </div>
        <label className="block text-xs" htmlFor="jdt-runtime-jdk-home">
          JDK home directory
        </label>
        <div className="flex flex-wrap gap-1.5">
          <input
            id="jdt-runtime-jdk-home"
            className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 py-1 text-xs text-[var(--text-primary)]"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setSaved(false);
            }}
            aria-describedby="jdt-runtime-jdk-help"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={draft === value && !error}>
            Save runtime JDK
          </Button>
        </div>
        <p id="jdt-runtime-jdk-help" className="text-[0.68rem] text-[var(--text-secondary)]">
          Saving updates the preference; an active service applies it when restarted.
        </p>
        {error ? (
          <p role="alert" className="text-xs text-red-200">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="text-xs text-emerald-200">
            Runtime JDK preference saved.
          </p>
        ) : null}
      </form>
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
  serverJdkHomePreference = "",
  serverJdkHomePreferenceError,
  onSaveServerJdkHomePreference,
  onSearchWorkspaceSymbols,
  focusWorkspaceSymbolSearch = 0,
  focusJavaReferencesQuery = 0,
  onCancelWorkspaceSymbolSearch,
  onNavigateWorkspaceSymbol,
  javaPositionCapabilities,
  isJavaPositionAvailable = false,
  positionNavigationScope,
  isJavaLanguageServicePositionAvailable = isJavaPositionAvailable,
  onQueryJavaPosition,
  onNavigateJavaPosition,
  onQueryJavaReferences,
  onNavigateJavaReference,
  onQueryJavaDefinitions,
  javaDefinitionScope,
  onCancelJavaDefinitions,
  onNavigateJavaDefinition,
  onQueryJavaCallHierarchy,
  onCancelJavaCallHierarchy,
  onNavigateJavaCallHierarchy,
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
  const [workspaceSymbolQuery, setWorkspaceSymbolQuery] = useState("");
  const [workspaceSymbols, setWorkspaceSymbols] = useState<JavaWorkspaceSymbol[] | null>(null);
  const [workspaceSymbolsTruncated, setWorkspaceSymbolsTruncated] = useState(false);
  const [workspaceSymbolError, setWorkspaceSymbolError] = useState<string | null>(null);
  const [workspaceSymbolSearchBusy, setWorkspaceSymbolSearchBusy] = useState(false);
  const workspaceSymbolSearchSequence = useRef(0);
  const workspaceSymbolInput = useRef<HTMLInputElement>(null);
  const [positionNavigationResult, setPositionNavigationResult] = useState<Extract<
    JavaNavigationResult,
    { status: "ready" }
  > | null>(null);
  const [positionNavigationError, setPositionNavigationError] = useState<string | null>(null);
  const [positionNavigationBusy, setPositionNavigationBusy] = useState(false);
  const positionNavigationSequence = useRef(0);
  const [javaReferences, setJavaReferences] = useState<JavaReferencesResponse | null>(null);
  const [javaReferencesError, setJavaReferencesError] = useState<string | null>(null);
  const [javaReferencesBusy, setJavaReferencesBusy] = useState(false);
  const javaReferencesSequence = useRef(0);
  const [javaDefinitionKind, setJavaDefinitionKind] = useState<"definition" | "typeDefinition">("definition");
  const [javaDefinitions, setJavaDefinitions] = useState<JavaDefinitionsResponse | null>(null);
  const [javaDefinitionsError, setJavaDefinitionsError] = useState<string | null>(null);
  const [javaDefinitionsBusy, setJavaDefinitionsBusy] = useState(false);
  const javaDefinitionsSequence = useRef(0);
  const [javaCallHierarchy, setJavaCallHierarchy] = useState<JavaCallHierarchyResponse | null>(
    null,
  );
  const [javaCallHierarchyError, setJavaCallHierarchyError] = useState<string | null>(null);
  const [javaCallHierarchyBusy, setJavaCallHierarchyBusy] = useState(false);
  const javaCallHierarchySequence = useRef(0);
  const lastAutoQueryJavaReferences = useRef(0);
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
  const canSearchWorkspaceSymbols = Boolean(
    onSearchWorkspaceSymbols &&
    languageServiceStatus?.capabilities.workspaceSymbols &&
    ["ready", "indexing", "degraded"].includes(languageServiceStatus.state),
  );

  useEffect(() => {
    positionNavigationSequence.current += 1;
    setPositionNavigationBusy(false);
    setPositionNavigationResult(null);
    setPositionNavigationError(null);
    return () => {
      positionNavigationSequence.current += 1;
    };
  }, [positionNavigationScope]);

  useEffect(
    () => () => {
      workspaceSymbolSearchSequence.current += 1;
      javaReferencesSequence.current += 1;
      javaCallHierarchySequence.current += 1;
      onCancelWorkspaceSymbolSearch?.();
      onCancelJavaCallHierarchy?.();
    },
    [onCancelJavaCallHierarchy, onCancelWorkspaceSymbolSearch],
  );

  useEffect(() => {
    setJavaDefinitionsBusy(false);
    setJavaDefinitions(null);
    setJavaDefinitionsError(null);
    return () => {
      javaDefinitionsSequence.current += 1;
      onCancelJavaDefinitions?.();
    };
  }, [javaDefinitionScope, onCancelJavaDefinitions]);

  useEffect(() => {
    if (focusWorkspaceSymbolSearch > 0 && !isSettingsMode) {
      workspaceSymbolInput.current?.focus();
      workspaceSymbolInput.current?.select();
    }
  }, [focusWorkspaceSymbolSearch, isSettingsMode]);

  const searchWorkspaceSymbols = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = workspaceSymbolQuery.trim();
    if (!query || !onSearchWorkspaceSymbols || !canSearchWorkspaceSymbols) return;
    const sequence = ++workspaceSymbolSearchSequence.current;
    setWorkspaceSymbolSearchBusy(true);
    setWorkspaceSymbolError(null);
    setWorkspaceSymbols(null);
    setWorkspaceSymbolsTruncated(false);
    try {
      const response = await onSearchWorkspaceSymbols(query);
      if (workspaceSymbolSearchSequence.current !== sequence) return;
      if (!response.ok) {
        setWorkspaceSymbolError(
          safeDiagnosticsMessage(
            response.error.summary ?? "Workspace symbol search failed",
            "Workspace symbol search failed",
          ),
        );
        return;
      }
      setWorkspaceSymbols(response.result.symbols);
      setWorkspaceSymbolsTruncated(response.result.isTruncated);
    } catch {
      if (workspaceSymbolSearchSequence.current === sequence)
        setWorkspaceSymbolError("Java workspace-symbol search failed.");
    } finally {
      if (workspaceSymbolSearchSequence.current === sequence) setWorkspaceSymbolSearchBusy(false);
    }
  };

  const queryJavaPosition = async (
    kind: "typeDefinition" | "typeHierarchy" | "callHierarchy" | "implementations",
    direction?: "supertypes" | "subtypes" | "both" | "incoming" | "outgoing",
  ) => {
    if (globalThis.document.body.hasAttribute("data-native-java-navigation-diagnostics")) {
      globalThis.document.body.setAttribute(
        "data-java-position-panel-action",
        JSON.stringify({
          kind,
          direction: direction ?? null,
          hasQueryHandler: Boolean(onQueryJavaPosition),
          isJavaPositionAvailable,
          hasCapability: Boolean(javaPositionCapabilities?.[kind]),
        }),
      );
    }
    if (!onQueryJavaPosition || !isJavaPositionAvailable) return;
    const sequence = ++positionNavigationSequence.current;
    setPositionNavigationBusy(true);
    setPositionNavigationError(null);
    setPositionNavigationResult(null);
    try {
      const response = await onQueryJavaPosition(kind, direction);
      if (positionNavigationSequence.current !== sequence) return;
      if (!response) {
        setPositionNavigationError("Open a Java source file and place the cursor on a symbol.");
      } else if (response.status !== "ready") {
        setPositionNavigationError(
          safeDiagnosticsMessage(response.message, "Java navigation is unavailable."),
        );
      } else {
        setPositionNavigationResult(response);
      }
    } catch {
      if (positionNavigationSequence.current === sequence)
        setPositionNavigationError("Java navigation failed.");
    } finally {
      if (positionNavigationSequence.current === sequence) setPositionNavigationBusy(false);
    }
  };

  const queryJavaReferences = useCallback(async () => {
    if (!onQueryJavaReferences || !isJavaLanguageServicePositionAvailable) return;
    const sequence = ++javaReferencesSequence.current;
    setJavaReferencesBusy(true);
    setJavaReferencesError(null);
    setJavaReferences(null);
    try {
      const response = await onQueryJavaReferences();
      if (javaReferencesSequence.current !== sequence) return;
      if (!response.ok) {
        setJavaReferencesError(
          safeDiagnosticsMessage(
            response.error.summary ?? "Java references are unavailable.",
            "Java references are unavailable.",
          ),
        );
      } else {
        setJavaReferences(response);
      }
    } catch {
      if (javaReferencesSequence.current === sequence)
        setJavaReferencesError("JDT LS reference search failed.");
    } finally {
      if (javaReferencesSequence.current === sequence) setJavaReferencesBusy(false);
    }
  }, [isJavaLanguageServicePositionAvailable, onQueryJavaReferences]);

  const canQueryJavaReferences = Boolean(
    onQueryJavaReferences &&
    languageServiceStatus?.capabilities.references &&
    ["ready", "indexing", "degraded"].includes(languageServiceStatus.state),
  );

  const queryJavaDefinitions = async (kind: "definition" | "typeDefinition") => {
    if (
      !onQueryJavaDefinitions ||
      !isJavaLanguageServicePositionAvailable ||
      !canQueryJavaDefinitions(kind)
    )
      return;
    const label = kind === "typeDefinition" ? "type definition" : "definition";
    const sequence = ++javaDefinitionsSequence.current;
    setJavaDefinitionKind(kind);
    setJavaDefinitionsBusy(true);
    setJavaDefinitionsError(null);
    setJavaDefinitions(null);
    try {
      const response = await onQueryJavaDefinitions(kind);
      if (javaDefinitionsSequence.current !== sequence) return;
      if (!response.ok) {
        setJavaDefinitionsError(
          safeDiagnosticsMessage(
            response.error.summary ?? `JDT LS ${label} is unavailable.`,
            `JDT LS ${label} is unavailable.`,
          ),
        );
      } else {
        setJavaDefinitions(response);
      }
    } catch {
      if (javaDefinitionsSequence.current === sequence)
        setJavaDefinitionsError(`JDT LS ${label} query failed.`);
    } finally {
      if (javaDefinitionsSequence.current === sequence) setJavaDefinitionsBusy(false);
    }
  };

  const canQueryJavaDefinitions = (kind: "definition" | "typeDefinition") => Boolean(
    onQueryJavaDefinitions &&
    languageServiceStatus?.capabilities[kind] &&
    ["ready", "indexing", "degraded"].includes(languageServiceStatus.state),
  );

  const queryJavaCallHierarchy = async (direction: JavaCallHierarchyRequest["direction"]) => {
    if (
      !onQueryJavaCallHierarchy ||
      !isJavaLanguageServicePositionAvailable ||
      !canQueryJavaCallHierarchy
    )
      return;
    const sequence = ++javaCallHierarchySequence.current;
    setJavaCallHierarchyBusy(true);
    setJavaCallHierarchyError(null);
    setJavaCallHierarchy(null);
    try {
      const response = await onQueryJavaCallHierarchy(direction);
      if (javaCallHierarchySequence.current !== sequence) return;
      if (!response.ok) {
        setJavaCallHierarchyError(
          safeDiagnosticsMessage(
            response.error.summary ?? "JDT LS call hierarchy is unavailable.",
            "JDT LS call hierarchy is unavailable.",
          ),
        );
      } else {
        setJavaCallHierarchy(response);
      }
    } catch {
      if (javaCallHierarchySequence.current === sequence)
        setJavaCallHierarchyError("JDT LS call hierarchy failed.");
    } finally {
      if (javaCallHierarchySequence.current === sequence) setJavaCallHierarchyBusy(false);
    }
  };

  const canQueryJavaCallHierarchy = Boolean(
    onQueryJavaCallHierarchy &&
    languageServiceStatus?.capabilities.callHierarchy &&
    ["ready", "indexing", "degraded"].includes(languageServiceStatus.state),
  );

  useEffect(() => {
    if (
      focusJavaReferencesQuery <= 0 ||
      focusJavaReferencesQuery === lastAutoQueryJavaReferences.current ||
      isSettingsMode ||
      !isJavaLanguageServicePositionAvailable ||
      !canQueryJavaReferences
    )
      return;
    lastAutoQueryJavaReferences.current = focusJavaReferencesQuery;
    void queryJavaReferences();
  }, [
    canQueryJavaReferences,
    focusJavaReferencesQuery,
    isJavaLanguageServicePositionAvailable,
    isSettingsMode,
    queryJavaReferences,
  ]);

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

        {isSettingsMode && onSaveServerJdkHomePreference ? (
          <ServerJdkHomePreference
            value={serverJdkHomePreference}
            error={serverJdkHomePreferenceError}
            onSave={onSaveServerJdkHomePreference}
          />
        ) : null}

        {!isSettingsMode ? (
          <section
            className="rounded border border-[var(--border-default)] bg-[var(--surface-header)] p-3"
            aria-labelledby="java-workspace-symbol-search-heading"
          >
            <h3
              id="java-workspace-symbol-search-heading"
              className="text-xs font-semibold uppercase tracking-wide"
            >
              Search Java workspace symbols
            </h3>
            <p className="mb-2 mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
              Find classes, methods, fields, and other declarations indexed by JDT LS. Press
              Ctrl/⌘+T from anywhere to focus this search.
            </p>
            <form
              className="flex items-end gap-1.5"
              aria-label="Search Java workspace symbols"
              onSubmit={(event) => void searchWorkspaceSymbols(event)}
            >
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="java-workspace-symbol-query"
                  className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Name or query
                </label>
                <input
                  id="java-workspace-symbol-query"
                  ref={workspaceSymbolInput}
                  type="search"
                  value={workspaceSymbolQuery}
                  onChange={(event) => setWorkspaceSymbolQuery(event.target.value)}
                  maxLength={256}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="OrderService, findById…"
                  className="h-7 w-full rounded-sm border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--border-focus)] focus:outline-none"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={
                  !workspaceSymbolQuery.trim() ||
                  !canSearchWorkspaceSymbols ||
                  workspaceSymbolSearchBusy
                }
              >
                {workspaceSymbolSearchBusy ? "Searching…" : "Search"}
              </Button>
            </form>
            {workspaceSymbolError ? (
              <p role="alert" className="mt-2 text-xs text-red-200">
                {workspaceSymbolError}
              </p>
            ) : null}
            {workspaceSymbols !== null ? (
              <div className="mt-2" aria-live="polite">
                {workspaceSymbolsTruncated ? (
                  <p className="mb-1 text-[0.68rem] text-amber-200">
                    Showing the first {workspaceSymbols.length} matches. Refine the query for more.
                  </p>
                ) : null}
                {workspaceSymbols.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">No Java symbols found.</p>
                ) : (
                  <ul
                    className="max-h-56 space-y-1 overflow-auto"
                    aria-label="Java workspace symbol results"
                  >
                    {workspaceSymbols.map((symbol, index) => (
                      <li
                        key={
                          symbol.path +
                          ":" +
                          symbol.range.start.line +
                          ":" +
                          symbol.name +
                          ":" +
                          index
                        }
                      >
                        <button
                          type="button"
                          onClick={() => void onNavigateWorkspaceSymbol?.(symbol)}
                          className="flex w-full min-w-0 flex-col rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                          aria-label={
                            "Open " +
                            symbol.kind +
                            " " +
                            symbol.name +
                            " in " +
                            symbol.path +
                            " at line " +
                            (symbol.range.start.line + 1)
                          }
                        >
                          <span className="truncate font-medium text-[var(--text-primary)]">
                            {symbol.name}
                            {symbol.deprecated ? " · deprecated" : ""}
                            {symbol.containerName ? " · " + symbol.containerName : ""}
                          </span>
                          <span className="truncate text-[0.68rem] text-[var(--text-secondary)]">
                            {symbol.path}:{symbol.range.start.line + 1}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        {!isSettingsMode ? (
          <section
            className="rounded border border-[var(--border-default)] bg-[var(--surface-header)] p-3"
            aria-labelledby="java-position-navigation-heading"
          >
            <h3
              id="java-position-navigation-heading"
              className="text-xs font-semibold uppercase tracking-wide"
            >
              Type, call and implementation navigation
            </h3>
            <p className="mb-2 mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
              Resolve the symbol under the Java editor cursor with RefactorKit's Java bindings.
              Implementations use a separate RefactorKit query; JDT LS Go to Implementation remains
              available from the editor.
            </p>
            <p className="mb-2 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
              Type results cover workspace source. Call results include direct method and
              constructor calls only; dynamic dispatch and method references are not included.
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Java position navigation queries"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaPositionAvailable ||
                  positionNavigationBusy ||
                  !javaPositionCapabilities?.implementations
                }
                onClick={() => void queryJavaPosition("implementations")}
              >
                Implementations (RefactorKit)
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaPositionAvailable ||
                  positionNavigationBusy ||
                  !javaPositionCapabilities?.typeDefinition
                }
                onClick={() => void queryJavaPosition("typeDefinition")}
              >
                Type definition
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaPositionAvailable ||
                  positionNavigationBusy ||
                  !javaPositionCapabilities?.typeHierarchy
                }
                onClick={() => void queryJavaPosition("typeHierarchy", "supertypes")}
              >
                Supertypes
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaPositionAvailable ||
                  positionNavigationBusy ||
                  !javaPositionCapabilities?.typeHierarchy
                }
                onClick={() => void queryJavaPosition("typeHierarchy", "subtypes")}
              >
                Subtypes
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaPositionAvailable ||
                  positionNavigationBusy ||
                  !javaPositionCapabilities?.callHierarchy
                }
                onClick={() => void queryJavaPosition("callHierarchy", "incoming")}
              >
                Callers
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaPositionAvailable ||
                  positionNavigationBusy ||
                  !javaPositionCapabilities?.callHierarchy
                }
                onClick={() => void queryJavaPosition("callHierarchy", "outgoing")}
              >
                Calls made
              </Button>
            </div>
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !isJavaLanguageServicePositionAvailable ||
                  javaReferencesBusy ||
                  !canQueryJavaReferences
                }
                onClick={() => void queryJavaReferences()}
              >
                Find references with JDT LS
              </Button>
            </div>
            {javaReferencesBusy ? (
              <p className="mt-2 text-xs text-[var(--text-secondary)]" role="status">
                Resolving Java references…
              </p>
            ) : null}
            {javaReferencesError ? (
              <p className="mt-2 text-xs text-red-200" role="alert">
                {javaReferencesError}
              </p>
            ) : null}
            {javaReferences?.ok ? (
              <div className="mt-2" aria-live="polite">
                <p className="text-[0.68rem] text-[var(--text-secondary)]">
                  {javaReferences.result.locations.length} reference
                  {javaReferences.result.locations.length === 1 ? "" : "s"} from JDT LS
                  {javaReferences.result.isTruncated ? " · more results omitted" : ""}
                </p>
                {javaReferences.result.isTruncated ? (
                  <p className="mt-1 text-[0.68rem] text-amber-200">
                    This result is partial; narrow the search to a more specific symbol.
                  </p>
                ) : null}
                {javaReferences.result.locations.length ? (
                  <ul
                    className="mt-1 max-h-48 space-y-1 overflow-auto"
                    aria-label="Java references"
                  >
                    {javaReferences.result.locations.map((location, index) => (
                      <li
                        key={`${location.path}:${location.range.start.line}:${location.range.start.character}:${index}`}
                      >
                        <button
                          type="button"
                          className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                          onClick={() => void onNavigateJavaReference?.(location)}
                          aria-label={`Open Java reference in ${location.path} at line ${location.range.start.line + 1}`}
                        >
                          {location.path}:{location.range.start.line + 1}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    No workspace references were found.
                  </p>
                )}
              </div>
            ) : null}
            {positionNavigationBusy ? (
              <p className="mt-2 text-xs text-[var(--text-secondary)]" role="status">
                Resolving Java navigation…
              </p>
            ) : null}
            {positionNavigationError ? (
              <p className="mt-2 text-xs text-red-200" role="alert">
                {positionNavigationError}
              </p>
            ) : null}
            {positionNavigationResult ? (
              <div className="mt-2" aria-live="polite">
                <p className="text-[0.68rem] text-[var(--text-secondary)]">
                  {positionNavigationResult.rootName
                    ? `${positionNavigationResult.rootName}${positionNavigationResult.targetKind ? ` (${positionNavigationResult.targetKind})` : ""}: `
                    : "Java navigation: "}
                  {positionNavigationResult.returned} of {positionNavigationResult.total} results
                  {positionNavigationResult.truncated ? " · more results omitted" : ""}
                </p>
                {positionNavigationResult.kind === "callHierarchy" ? (
                  <p className="mt-1 text-[0.68rem] text-amber-200">
                    Call hierarchy covers direct invocations and remains partial; dynamic dispatch,
                    method references, and unresolved targets may be omitted.
                  </p>
                ) : null}
                {!positionNavigationResult.complete ? (
                  <p className="mt-1 text-[0.68rem] text-amber-200">
                    This result is partial
                    {positionNavigationResult.warningCount
                      ? ` (${positionNavigationResult.warningCount} provider warnings)`
                      : ""}
                    .
                  </p>
                ) : null}
                {positionNavigationResult.kind === "typeDefinition" ? (
                  <ul className="mt-1 space-y-1" aria-label="Java type definition results">
                    {positionNavigationResult.locations.map((location, index) => (
                      <li key={`${location.path}:${location.range.start.line}:${index}`}>
                        <button
                          type="button"
                          className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                          onClick={() =>
                            void onNavigateJavaPosition?.(
                              positionNavigationResult.requestId,
                              location,
                            )
                          }
                          aria-label={`Open type definition in ${location.path} at line ${location.range.start.line + 1}`}
                        >
                          {location.path}:{location.range.start.line + 1}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : positionNavigationResult.items.length ? (
                  <ul
                    className="mt-1 max-h-48 space-y-1 overflow-auto"
                    aria-label={
                      positionNavigationResult.kind === "implementations"
                        ? "Java implementation results"
                        : "Java hierarchy results"
                    }
                  >
                    {positionNavigationResult.items.map((item, index) => (
                      <li
                        key={`${item.methodIdentity?.bindingKey ?? item.label}:${item.location?.path ?? "classpath"}:${index}`}
                      >
                        {item.location ? (
                          <button
                            type="button"
                            className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                            onClick={() =>
                              void onNavigateJavaPosition?.(
                                positionNavigationResult.requestId,
                                item.location!,
                              )
                            }
                          >
                            {item.relation === "concreteType"
                              ? "Concrete type: "
                              : item.relation === "concreteMethod"
                                ? "Concrete method: "
                                : item.relation
                                  ? `${item.relation}: `
                                  : "Method: "}
                            {item.label} · {item.location.path}:{item.location.range.start.line + 1}
                          </button>
                        ) : (
                          <p className="px-2 py-1 text-xs text-[var(--text-secondary)]">
                            {item.sourceNavigation?.status === "unavailable"
                              ? "Resolved classpath method (source unavailable): "
                              : "Method: "}
                            {item.methodIdentity?.qualifiedName ?? item.label}
                            {item.methodIdentity?.jvmIdentity?.descriptor
                              ? ` · ${item.methodIdentity.jvmIdentity.descriptor}`
                              : ""}
                          </p>
                        )}
                        {item.callSites?.map((location, siteIndex) => (
                          <button
                            key={`${location.path}:${location.range.start.line}:${siteIndex}`}
                            type="button"
                            className="ml-3 block w-[calc(100%-0.75rem)] truncate rounded px-2 py-1 text-left text-[0.68rem] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                            onClick={() =>
                              void onNavigateJavaPosition?.(
                                positionNavigationResult.requestId,
                                location,
                              )
                            }
                            aria-label={`Open call site for ${item.label} in ${location.path} at line ${location.range.start.line + 1}`}
                          >
                            Call site · {location.path}:{location.range.start.line + 1}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {positionNavigationResult.kind === "implementations"
                      ? "No workspace implementations were found."
                      : "No related Java types or calls were found."}
                  </p>
                )}
              </div>
            ) : null}
            <div className="mt-3 border-t border-[var(--border-default)] pt-3">
              <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                JDT LS definitions · current buffer
              </h4>
              <p className="mb-2 mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
                Resolve the symbol at the cursor from the active synchronized document. Results are
                limited to Java source files in this workspace.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(["definition", "typeDefinition"] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!isJavaLanguageServicePositionAvailable || javaDefinitionsBusy || !canQueryJavaDefinitions(kind)}
                    onClick={() => void queryJavaDefinitions(kind)}
                  >
                    {kind === "typeDefinition" ? "JDT LS type definition" : "JDT LS definition"}
                  </Button>
                ))}
              </div>
              {javaDefinitionsBusy ? (
                <p className="mt-2 text-xs text-[var(--text-secondary)]" role="status">
                  Resolving JDT LS {javaDefinitionKind === "typeDefinition" ? "type definition" : "definition"}…
                </p>
              ) : null}
              {javaDefinitionsError ? (
                <p className="mt-2 text-xs text-red-200" role="alert">
                  {javaDefinitionsError}
                </p>
              ) : null}
              {javaDefinitions?.ok ? (
                <div className="mt-2" aria-live="polite">
                  <p className="text-[0.68rem] text-[var(--text-secondary)]">
                    {javaDefinitionKind === "typeDefinition" ? "Type definitions" : "Definitions"}: {javaDefinitions.result.locations.length} result
                    {javaDefinitions.result.locations.length === 1 ? "" : "s"} from JDT LS
                    {javaDefinitions.result.isTruncated ? " · more results omitted" : ""}
                  </p>
                  {javaDefinitions.result.locations.length ? (
                    <ul
                      className="mt-1 max-h-48 space-y-1 overflow-auto"
                      aria-label={javaDefinitionKind === "typeDefinition" ? "JDT LS type definitions" : "JDT LS definitions"}
                    >
                      {javaDefinitions.result.locations.map((location, index) => (
                        <li key={`${location.path}:${location.range.start.line}:${index}`}>
                          <button
                            type="button"
                            className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                            onClick={() => void onNavigateJavaDefinition?.(location)}
                            aria-label={`Open JDT LS ${javaDefinitionKind === "typeDefinition" ? "type definition" : "definition"} in ${location.path} at line ${location.range.start.line + 1}`}
                          >
                            {location.path}:{location.range.start.line + 1}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      JDT LS found no definition in workspace Java source.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <div className="mt-3 border-t border-[var(--border-default)] pt-3">
              <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                JDT LS call hierarchy · current buffer
              </h4>
              <p className="mb-2 mt-1 text-[0.68rem] leading-4 text-[var(--text-secondary)]">
                Uses the active synchronized document. Results are limited to Java source files in
                this workspace; completeness depends on the JDT LS project model.
              </p>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="JDT LS call hierarchy queries"
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    !isJavaLanguageServicePositionAvailable ||
                    javaCallHierarchyBusy ||
                    !canQueryJavaCallHierarchy
                  }
                  onClick={() => void queryJavaCallHierarchy("incoming")}
                >
                  JDT LS callers
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    !isJavaLanguageServicePositionAvailable ||
                    javaCallHierarchyBusy ||
                    !canQueryJavaCallHierarchy
                  }
                  onClick={() => void queryJavaCallHierarchy("outgoing")}
                >
                  JDT LS calls made
                </Button>
              </div>
              {javaCallHierarchyBusy ? (
                <p className="mt-2 text-xs text-[var(--text-secondary)]" role="status">
                  Resolving JDT LS call hierarchy…
                </p>
              ) : null}
              {javaCallHierarchyError ? (
                <p className="mt-2 text-xs text-red-200" role="alert">
                  {javaCallHierarchyError}
                </p>
              ) : null}
              {javaCallHierarchy?.ok ? (
                <div className="mt-2" aria-live="polite">
                  <p className="text-[0.68rem] text-[var(--text-secondary)]">
                    {javaCallHierarchy.result.direction === "incoming" ? "Callers" : "Calls made"}:{" "}
                    {javaCallHierarchy.result.entries.length} result
                    {javaCallHierarchy.result.entries.length === 1 ? "" : "s"} from JDT LS
                    {javaCallHierarchy.result.isTruncated ? " · more results omitted" : ""}
                  </p>
                  {javaCallHierarchy.result.isTruncated ? (
                    <p className="mt-1 text-[0.68rem] text-amber-200">
                      This result is partial; narrow the query or inspect the provider project
                      model.
                    </p>
                  ) : null}
                  {javaCallHierarchy.result.entries.length ? (
                    <ul
                      className="mt-1 max-h-56 space-y-1 overflow-auto"
                      aria-label="JDT LS call hierarchy results"
                    >
                      {javaCallHierarchy.result.entries.map((entry, index) => (
                        <li
                          key={`${entry.location.path}:${entry.location.range.start.line}:${entry.name}:${index}`}
                        >
                          <button
                            type="button"
                            className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                            onClick={() => void onNavigateJavaCallHierarchy?.(entry.location)}
                            aria-label={`Open Java method ${entry.name} in ${entry.location.path} at line ${entry.location.range.start.line + 1}`}
                          >
                            {entry.name}
                            {entry.detail ? ` · ${entry.detail}` : ` · ${entry.kind}`} ·{" "}
                            {entry.location.path}:{entry.location.range.start.line + 1}
                          </button>
                          {entry.callSites.map((location, siteIndex) => (
                            <button
                              key={`${location.path}:${location.range.start.line}:${siteIndex}`}
                              type="button"
                              className="ml-3 block w-[calc(100%-0.75rem)] truncate rounded px-2 py-1 text-left text-[0.68rem] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-hover)] focus:outline-none"
                              onClick={() => void onNavigateJavaCallHierarchy?.(location)}
                              aria-label={`Open JDT LS call site in ${location.path} at line ${location.range.start.line + 1}`}
                            >
                              Call site · {location.path}:{location.range.start.line + 1}
                            </button>
                          ))}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      JDT LS found no workspace callers or callees for this symbol.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

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
