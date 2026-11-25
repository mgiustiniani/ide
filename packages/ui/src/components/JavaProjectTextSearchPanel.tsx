import { useEffect, useId, useRef, type FormEvent } from "react";
import type { JavaProjectTextSearchMatch } from "@ide/contracts";

export interface JavaProjectTextSearchPanelProps {
  query: string;
  caseSensitive: boolean;
  matches: readonly JavaProjectTextSearchMatch[];
  scannedFiles: number;
  skippedFiles: number;
  searchedDraftFiles: number;
  skippedDraftFiles: number;
  truncated: boolean;
  hasSearched: boolean;
  isBusy: boolean;
  error?: string | null;
  focusRequest?: number;
  onQueryChange(query: string): void;
  onCaseSensitiveChange(value: boolean): void;
  onSearch(): void | Promise<void>;
  onClear(): void;
  onFocusRequestHandled?(request: number): void;
  onResultSelect?(match: JavaProjectTextSearchMatch): void;
}

export function JavaProjectTextSearchPanel({
  query,
  caseSensitive,
  matches,
  scannedFiles,
  skippedFiles,
  searchedDraftFiles,
  skippedDraftFiles,
  truncated,
  hasSearched,
  isBusy,
  error,
  focusRequest = 0,
  onQueryChange,
  onCaseSensitiveChange,
  onSearch,
  onClear,
  onFocusRequestHandled,
  onResultSelect,
}: JavaProjectTextSearchPanelProps): JSX.Element {
  const queryId = useId();
  const queryInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest <= 0) return;
    queryInput.current?.focus();
    onFocusRequestHandled?.(focusRequest);
  }, [focusRequest, onFocusRequestHandled]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isBusy && query.trim()) void onSearch();
  };
  return (
    <section
      aria-label="Find in Java project"
      className="mt-4 border-t border-[var(--border-default)] pt-3"
    >
      <h4 className="font-medium">Find in Java Project</h4>
      <p className="mt-1 text-[var(--text-secondary)]">
        Searches Java source, build descriptors and text resources, including open unsaved text
        buffers. Build and VCS output directories are skipped; results are bounded.
      </p>
      <form className="mt-2 space-y-2" aria-label="Find in Java project" onSubmit={submit}>
        <label htmlFor={queryId} className="sr-only">
          Text to find
        </label>
        <input
          ref={queryInput}
          id={queryId}
          className="w-full rounded border border-[var(--border-default)] bg-[var(--input-bg)] px-2 py-1 text-[var(--text-primary)]"
          type="search"
          maxLength={256}
          value={query}
          disabled={isBusy}
          placeholder="Text to find in project"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <label className="flex items-center gap-2 text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={caseSensitive}
            disabled={isBusy}
            onChange={(event) => onCaseSensitiveChange(event.target.checked)}
          />
          Match case
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-[var(--highlight-bg)] px-3 py-1 disabled:opacity-50"
            disabled={isBusy || !query.trim()}
          >
            {isBusy ? "Searching…" : "Find"}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border-default)] px-3 py-1 disabled:opacity-50"
            disabled={isBusy || (!matches.length && !query && !error)}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </form>
      {error ? (
        <p className="mt-2 text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {hasSearched ? (
        <p className="mt-2 text-[var(--text-secondary)]" role="status">
          {`${matches.length} ${matches.length === 1 ? "match" : "matches"}; scanned ${scannedFiles} saved project text file${scannedFiles === 1 ? "" : "s"}.`}
          {searchedDraftFiles
            ? ` ${searchedDraftFiles} unsaved text buffer${searchedDraftFiles === 1 ? "" : "s"} also searched.`
            : ""}
          {skippedDraftFiles
            ? ` ${skippedDraftFiles} unsaved text buffer${skippedDraftFiles === 1 ? " was" : "s were"} skipped.`
            : ""}
          {skippedFiles
            ? ` ${skippedFiles} project text file${skippedFiles === 1 ? " was" : "s were"} skipped.`
            : ""}
          {truncated || skippedFiles || skippedDraftFiles
            ? " Results may be incomplete because a work limit was reached, files or buffers were skipped, or a path was excluded or could not be inspected."
            : ""}
        </p>
      ) : null}
      {matches.length ? (
        <ol className="mt-2 max-h-72 space-y-1 overflow-auto" aria-label="Project text matches">
          {matches.map((match, index) => (
            <li key={`${match.path}:${match.line}:${index}`}>
              {onResultSelect ? (
                <button
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left hover:bg-[var(--highlight-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                  aria-label={`Open ${match.path} at line ${match.line}, column ${match.column}`}
                  onClick={() => onResultSelect(match)}
                >
                  <span className="block break-all text-[var(--text-secondary)]">
                    {match.path}:{match.line}:{match.column}
                  </span>
                  <span className="block break-all">{match.snippet}</span>
                </button>
              ) : (
                <div className="px-2 py-1">
                  <span className="block break-all text-[var(--text-secondary)]">
                    {match.path}:{match.line}
                  </span>
                  <span className="block break-all">{match.snippet}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
