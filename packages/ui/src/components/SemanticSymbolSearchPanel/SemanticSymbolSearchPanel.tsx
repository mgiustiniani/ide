// ---------------------------------------------------------------------------
// @ide/ui – SemanticSymbolSearchPanel
// Provider-neutral, presentation-only workspace symbol search. The host owns
// capability policy, toolchain approval decisions, lifecycle, and navigation.
// ---------------------------------------------------------------------------

import { useId, type FormEvent } from "react";
import { Button } from "../ui/Button";

export type SemanticSearchLanguage = "typescript" | "javascript";
export type SemanticSearchSnapshotState = "saved" | "dirty" | "never-saved";
export type SemanticSearchEvidenceState = "accepted" | "checking" | "unavailable";
export type SemanticSearchAvailability = "available" | "unavailable" | "browser-unavailable";

export interface SemanticSearchToolchainPaths {
  nodeExecutable: string;
  languageServerPackageRoot: string;
  typeScriptPackageRoot: string;
}

export type SemanticSearchToolchainPathField = keyof SemanticSearchToolchainPaths;

export interface SemanticSymbolSearchResult {
  /** Host-owned transient identity. It is passed back but never rendered. */
  opaqueSymbolId: string;
  name: string;
  kind: string;
}

export interface SemanticSymbolSearchPanelProps {
  language: SemanticSearchLanguage;
  query: string;
  toolchainPaths: SemanticSearchToolchainPaths;
  approvedForSession: boolean;
  snapshotState: SemanticSearchSnapshotState;
  evidenceState: SemanticSearchEvidenceState;
  availability: SemanticSearchAvailability;
  availabilityReason?: string | null;
  results: readonly SemanticSymbolSearchResult[];
  /** Maximum rendered rows. Values are clamped to 1–100; the default is 50. */
  resultLimit?: number;
  isBusy: boolean;
  /** Host policy decision; this component does not infer authorization. */
  canSubmit: boolean;
  error?: string | null;
  refusal?: string | null;
  onLanguageChange?: (language: SemanticSearchLanguage) => void;
  onQueryChange?: (query: string) => void;
  onToolchainPathChange?: (field: SemanticSearchToolchainPathField, value: string) => void;
  onApprovalChange?: (approved: boolean) => void;
  onSubmit?: () => void | Promise<void>;
  onCancel?: () => void;
  onStop?: () => void | Promise<void>;
  /** The host resolves the selected result to an exact semantic definition. */
  onResultSelect?: (result: SemanticSymbolSearchResult) => void | Promise<void>;
}

const snapshotLabels: Record<SemanticSearchSnapshotState, string> = {
  saved: "Saved snapshot · All participating buffers match their saved files.",
  dirty: "Search refused · Dirty buffers prevent saved-snapshot search.",
  "never-saved": "Search refused · Never-saved buffers prevent saved-snapshot search.",
};

const evidenceLabels: Record<SemanticSearchEvidenceState, string> = {
  accepted: "Accepted",
  checking: "Checking…",
  unavailable: "Unavailable",
};

const availabilityLabels: Record<SemanticSearchAvailability, string> = {
  available: "Available in desktop host",
  unavailable: "Unavailable",
  "browser-unavailable": "Unavailable in browser",
};

const inputClassName =
  "h-8 w-full rounded-sm border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-60";

function getBoundedResultLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

export function SemanticSymbolSearchPanel({
  language,
  query,
  toolchainPaths,
  approvedForSession,
  snapshotState,
  evidenceState,
  availability,
  availabilityReason,
  results,
  resultLimit,
  isBusy,
  canSubmit,
  error,
  refusal,
  onLanguageChange,
  onQueryChange,
  onToolchainPathChange,
  onApprovalChange,
  onSubmit,
  onCancel,
  onStop,
  onResultSelect,
}: SemanticSymbolSearchPanelProps): JSX.Element {
  const idPrefix = useId();
  const languageId = `${idPrefix}-language`;
  const queryId = `${idPrefix}-query`;
  const nodePathId = `${idPrefix}-node-path`;
  const languageServerPathId = `${idPrefix}-language-server-path`;
  const typeScriptPathId = `${idPrefix}-typescript-path`;
  const approvalId = `${idPrefix}-approval`;
  const approvalHelpId = `${idPrefix}-approval-help`;
  const boundedResults = results.slice(0, getBoundedResultLimit(resultLimit));
  const submitDisabled = isBusy || !canSubmit || !onSubmit;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!submitDisabled) void onSubmit?.();
  };

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col bg-[var(--surface-panel)] text-[var(--text-primary)]"
      aria-label="Semantic symbol search"
    >
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2">
        <h2 className="text-sm font-semibold">Workspace Symbols</h2>
        <p className="text-xs leading-5 text-[var(--text-secondary)]">
          Search a host-authorized saved snapshot and delegate definition resolution when a result
          is selected.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <p
            className="rounded border border-[var(--border-default)] bg-[var(--surface-header)] px-2 py-1.5 text-xs"
            role="status"
            aria-label="Semantic search availability"
          >
            <span className="font-medium">Availability:</span> {availabilityLabels[availability]}
          </p>
          <p
            className="rounded border border-[var(--border-default)] bg-[var(--surface-header)] px-2 py-1.5 text-xs"
            role="status"
            aria-label="Experimental language-server evidence"
          >
            <span className="font-medium">Experimental language-server evidence:</span>{" "}
            {evidenceLabels[evidenceState]}
          </p>
        </div>

        {availabilityReason ? (
          <p
            className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs leading-5 text-amber-100"
            role="note"
          >
            {availabilityReason}
          </p>
        ) : null}

        <p
          className={`mb-3 rounded border px-2 py-1.5 text-xs leading-5 ${
            snapshotState === "saved"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : "border-amber-500/30 bg-amber-500/10 text-amber-100"
          }`}
          role="status"
          aria-label="Saved-snapshot status"
        >
          {snapshotLabels[snapshotState]}
        </p>

        <form
          className="space-y-3 rounded border border-[var(--border-default)] bg-[var(--surface-header)] p-3"
          aria-label="Workspace symbol search"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(9rem,0.35fr)_minmax(12rem,1fr)]">
            <div>
              <label htmlFor={languageId} className="mb-1 block text-xs font-medium">
                Language
              </label>
              <select
                id={languageId}
                className={inputClassName}
                value={language}
                disabled={isBusy}
                onChange={(event) =>
                  onLanguageChange?.(event.target.value as SemanticSearchLanguage)
                }
              >
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
              </select>
            </div>
            <div>
              <label htmlFor={queryId} className="mb-1 block text-xs font-medium">
                Symbol query
              </label>
              <input
                id={queryId}
                className={inputClassName}
                type="text"
                value={query}
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onQueryChange?.(event.target.value)}
              />
            </div>
          </div>

          <fieldset className="space-y-2 rounded border border-[var(--border-default)] p-2">
            <legend className="px-1 text-xs font-semibold">Explicit external toolchain</legend>
            <div>
              <label htmlFor={nodePathId} className="mb-1 block text-xs font-medium">
                External Node executable path
              </label>
              <input
                id={nodePathId}
                className={`${inputClassName} font-mono`}
                type="text"
                value={toolchainPaths.nodeExecutable}
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onToolchainPathChange?.("nodeExecutable", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor={languageServerPathId} className="mb-1 block text-xs font-medium">
                External typescript-language-server package path
              </label>
              <input
                id={languageServerPathId}
                className={`${inputClassName} font-mono`}
                type="text"
                value={toolchainPaths.languageServerPackageRoot}
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  onToolchainPathChange?.("languageServerPackageRoot", event.target.value)
                }
              />
            </div>
            <div>
              <label htmlFor={typeScriptPathId} className="mb-1 block text-xs font-medium">
                External TypeScript package path
              </label>
              <input
                id={typeScriptPathId}
                className={`${inputClassName} font-mono`}
                type="text"
                value={toolchainPaths.typeScriptPackageRoot}
                disabled={isBusy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  onToolchainPathChange?.("typeScriptPackageRoot", event.target.value)
                }
              />
            </div>
          </fieldset>

          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-5 text-amber-100">
            <label htmlFor={approvalId} className="flex items-start gap-2 font-medium">
              <input
                id={approvalId}
                className="mt-1"
                type="checkbox"
                checked={approvedForSession}
                disabled={isBusy}
                aria-describedby={approvalHelpId}
                onChange={(event) => onApprovalChange?.(event.target.checked)}
              />
              <span>Approve these external toolchain paths for this session</span>
            </label>
            <p id={approvalHelpId} className="mt-1 pl-6 text-[var(--text-secondary)]">
              PATH discovery and workspace-local toolchain discovery are disabled. Approval applies
              only to this session; this panel does not persist paths.
            </p>
          </div>

          <p
            className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs leading-5 text-amber-100"
            role="note"
          >
            JavaScript results may be incomplete for dynamic or mixed JavaScript.
          </p>

          {error ? (
            <p
              className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-100"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {refusal ? (
            <p
              className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100"
              role="alert"
            >
              {refusal}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              className="text-xs text-[var(--text-secondary)]"
              role="status"
              aria-label="Semantic search progress"
              aria-live="polite"
            >
              {isBusy ? "Searching workspace symbols…" : "Ready to search"}
            </p>
            <div className="flex gap-2">
              {isBusy ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={!onStop}
                  onClick={() => void onStop?.()}
                >
                  Stop search
                </Button>
              ) : onCancel ? (
                <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" size="sm" disabled={submitDisabled}>
                Search workspace symbols
              </Button>
            </div>
          </div>
        </form>

        <section className="mt-3" aria-labelledby={`${idPrefix}-results-heading`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3
              id={`${idPrefix}-results-heading`}
              className="text-xs font-semibold uppercase tracking-wide"
            >
              Results
            </h3>
            {results.length > boundedResults.length ? (
              <p className="text-xs text-[var(--text-secondary)]">
                Showing {boundedResults.length} of {results.length} results.
              </p>
            ) : null}
          </div>

          {boundedResults.length > 0 ? (
            <ul className="space-y-1" aria-label="Semantic symbol results">
              {boundedResults.map((result) => (
                <li key={result.opaqueSymbolId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2 text-left hover:bg-[var(--highlight-bg)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy || !onResultSelect}
                    aria-label={`Resolve definition for ${result.name}, ${result.kind}`}
                    onClick={() => void onResultSelect?.(result)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{result.name}</span>
                      <span className="block text-xs text-[var(--text-secondary)]">
                        {result.kind}
                      </span>
                    </span>
                    <span className="shrink-0 rounded border border-[var(--border-default)] px-2 py-0.5 text-[0.68rem] text-[var(--text-secondary)]">
                      Completeness unknown
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="rounded border border-dashed border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-6 text-center text-xs text-[var(--text-secondary)]"
              role="status"
            >
              No semantic symbol results.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
