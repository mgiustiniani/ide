import type { WorkspaceFileSearchResult } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { useEffect, useState } from "react";

export type JavaCleanupFileSearchPort = (query: string, generation: number) => Promise<WorkspaceFileSearchResult>;

/** File discovery only; RefactorKit checks whether a selected file belongs to its project. */
export function JavaCleanupFileSearch({ search, generation, projectPath, selectedPaths, onSelect, onClose }: {
  search: JavaCleanupFileSearchPort;
  generation: number;
  projectPath: string;
  selectedPaths: readonly string[];
  onSelect(path: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{
    query: string;
    search: JavaCleanupFileSearchPort;
    result?: WorkspaceFileSearchResult;
    error?: string;
  }>();
  const term = query.trim();
  useEffect(() => {
    if (!term) return;
    let current = true;
    const timer = setTimeout(() => {
      void search(term, generation).then(
        (result) => { if (current) setResponse({ query: term, search, result }); },
        (error: unknown) => {
          if (current) setResponse({ query: term, search, error: error instanceof Error ? error.message : "File search failed. Try again." });
        },
      );
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [term, search, generation]);
  const current = response?.query === term && response.search === search ? response : undefined;
  const paths = [...new Set(current?.result?.files.map((file) => file.path) ?? [])].filter((path) =>
    isNormalizedWorkspaceRelativePath(path) && !/[\u0000-\u001f\u007f]/u.test(path) && path.endsWith(".java") &&
    (!projectPath || path.startsWith(`${projectPath}/`)) && !selectedPaths.includes(path),
  );
  return (
    <section aria-label="Find Java cleanup file" className="space-y-2 rounded border border-[var(--border-default)] p-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); onClose(); }
      }}>
      <label className="block">Find Java file
        <input autoFocus aria-label="Java cleanup file search" value={query}
          className="block w-full rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1 text-[var(--text-primary)]"
          onChange={(event) => { setResponse(undefined); setQuery(event.target.value); }} />
      </label>
      <p className="text-xs text-[var(--text-secondary)]">Search saved files in this project. RefactorKit checks the selected files during review.</p>
      {term && !current ? <p role="status">Searching Java files…</p> : null}
      {current?.error ? <p role="alert">{current.error}</p> : null}
      {current?.result ? <>
        {current.result.partial ? <p role="status">Some directories could not be searched.</p> : null}
        {current.result.truncated ? <p role="status">Results are limited. Refine the search to find other files.</p> : null}
        {paths.length === 0 ? <p role="status">No additional Java files found.</p> : (
          <ul aria-label="Java cleanup file matches" className="max-h-48 overflow-auto">
            {paths.map((path) => <li key={path}><button type="button" className="break-all text-left" onClick={() => onSelect(path)}>{path}</button></li>)}
          </ul>
        )}
      </> : null}
      <button type="button" onClick={onClose}>Close file search</button>
    </section>
  );
}
