import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  JavaProjectTextSearchMatch,
  JavaWorkspaceSymbol,
  JavaWorkspaceSymbolsResponse,
  LanguageRange,
  WorkspaceFileSearchResult,
} from "@ide/contracts";
import type { CommandPaletteCommand } from "@ide/ui";
import type { JavaProjectTextSearchSnapshot } from "../refactorkit-java-project-model/useJavaProjectTextSearchController";

type SearchTarget =
  | { readonly kind: "range"; readonly range: LanguageRange }
  | { readonly kind: "point"; readonly line: number; readonly column: number };

export type SearchEverywhereTarget = SearchTarget;

type SearchEntry = {
  readonly id: string;
  readonly category: "Command" | "File" | "Java symbol" | "Project text";
  readonly label: string;
  readonly detail: string;
  readonly run: () => void | Promise<void>;
};

interface SearchState {
  files: WorkspaceFileSearchResult | null;
  symbols: JavaWorkspaceSymbolsResponse | null;
  text: JavaProjectTextSearchSnapshot | null;
  errors: { source: string; message: string }[];
  loading: boolean;
  query: string | null;
  workspaceGeneration: number | null;
}

const emptyState: SearchState = {
  files: null,
  symbols: null,
  text: null,
  errors: [],
  loading: false,
  query: null,
  workspaceGeneration: null,
};
const RESULT_LIMIT_PER_SOURCE = 50;

function isTextEntryTarget(target: HTMLElement | null): boolean {
  return Boolean(
    target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"),
  );
}

export interface SearchEverywhereDialogProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly workspaceGeneration: number;
  readonly commands: readonly CommandPaletteCommand[];
  readonly javaSymbolSearchAvailable: boolean;
  readonly searchFiles: (
    query: string,
    workspaceGeneration: number,
  ) => Promise<WorkspaceFileSearchResult>;
  readonly searchJavaSymbols: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<JavaWorkspaceSymbolsResponse>;
  readonly searchProjectText: (
    query: string,
    workspaceGeneration: number,
  ) => Promise<JavaProjectTextSearchSnapshot | null>;
  readonly onOpenFile: (path: string, workspaceGeneration: number) => Promise<void>;
  readonly onNavigate: (
    path: string,
    target: SearchTarget,
    workspaceGeneration: number,
  ) => Promise<void>;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

export function SearchEverywhereDialog({
  enabled,
  open,
  workspaceGeneration,
  commands,
  javaSymbolSearchAvailable,
  searchFiles,
  searchJavaSymbols,
  searchProjectText,
  onOpenFile,
  onNavigate,
  onOpen,
  onClose,
}: SearchEverywhereDialogProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const requestSequenceRef = useRef(0);
  const callbacksRef = useRef({
    enabled,
    open,
    workspaceGeneration,
    searchFiles,
    searchJavaSymbols,
    searchProjectText,
    onOpenFile,
    onNavigate,
    onOpen,
    onClose,
  });
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchState>(emptyState);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runningEntry, setRunningEntry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  callbacksRef.current = {
    enabled,
    open,
    workspaceGeneration,
    searchFiles,
    searchJavaSymbols,
    searchProjectText,
    onOpenFile,
    onNavigate,
    onOpen,
    onClose,
  };

  useEffect(() => {
    if (open && !enabled) callbacksRef.current.onClose();
  }, [enabled, open]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        !event.shiftKey ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLocaleLowerCase() !== "e" ||
        !callbacksRef.current.enabled
      )
        return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const inSearchEverywhere = Boolean(target?.closest("[data-search-everywhere]"));
      const inEditor = Boolean(target?.closest(".monaco-editor"));
      if (isTextEntryTarget(target) && !inSearchEverywhere && !inEditor) return;

      event.preventDefault();
      if (callbacksRef.current.open) callbacksRef.current.onClose();
      else callbacksRef.current.onOpen();
    };
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, []);

  useEffect(() => {
    if (!open || !enabled) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setResult(emptyState);
    setSelectedIndex(0);
    setRunningEntry(null);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => previousFocusRef.current?.focus();
  }, [enabled, open]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    const request = ++requestSequenceRef.current;
    if (!open || !enabled || normalizedQuery.length === 0) {
      setResult(emptyState);
      return;
    }

    let active = true;
    const javaSymbolSearchAbort = new AbortController();
    setResult({ ...emptyState, loading: true, query: normalizedQuery, workspaceGeneration });
    setError(null);
    const timeout = window.setTimeout(() => {
      const services = callbacksRef.current;
      const searches: Promise<Partial<SearchState>>[] = [
        Promise.resolve()
          .then(() => services.searchFiles(normalizedQuery, workspaceGeneration))
          .then(
            (files) => ({ files }),
            (failure: unknown) => ({
              errors: [
                {
                  source: "Files",
                  message: failure instanceof Error ? failure.message : "File search failed.",
                },
              ],
            }),
          ),
        Promise.resolve()
          .then(() => services.searchProjectText(normalizedQuery, workspaceGeneration))
          .then(
            (text) =>
              text
                ? text.error
                  ? { text, errors: [{ source: "Project text", message: text.error }] }
                  : { text }
                : {
                    errors: [
                      { source: "Project text", message: "The search result became stale." },
                    ],
                  },
            (failure: unknown) => ({
              errors: [
                {
                  source: "Project text",
                  message:
                    failure instanceof Error ? failure.message : "Project text search failed.",
                },
              ],
            }),
          ),
      ];
      if (javaSymbolSearchAvailable) {
        searches.push(
          Promise.resolve()
            .then(() =>
              javaSymbolSearchAbort.signal.aborted
                ? null
                : services.searchJavaSymbols(normalizedQuery, javaSymbolSearchAbort.signal),
            )
            .then(
              (symbols) =>
                !symbols
                  ? {}
                  : symbols.ok
                    ? { symbols }
                    : {
                        symbols,
                        errors: [
                          {
                            source: "Java symbols",
                            message: symbols.error.summary ?? "Java symbol search failed.",
                          },
                        ],
                      },
              (failure: unknown) =>
                javaSymbolSearchAbort.signal.aborted
                  ? {}
                  : {
                      errors: [
                        {
                          source: "Java symbols",
                          message:
                            failure instanceof Error
                              ? failure.message
                              : "Java symbol search failed.",
                        },
                      ],
                    },
            ),
        );
      }
      void Promise.all(searches).then((responses) => {
        if (!active || request !== requestSequenceRef.current || !callbacksRef.current.open) return;
        const latest = callbacksRef.current;
        if (latest.workspaceGeneration !== workspaceGeneration || !latest.enabled) return;
        setResult({
          files: responses.find((response) => response.files)?.files ?? null,
          symbols: responses.find((response) => response.symbols)?.symbols ?? null,
          text: responses.find((response) => response.text)?.text ?? null,
          errors: responses.flatMap((response) => response.errors ?? []),
          loading: false,
          query: normalizedQuery,
          workspaceGeneration,
        });
        setSelectedIndex(0);
      });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      javaSymbolSearchAbort.abort();
    };
  }, [enabled, javaSymbolSearchAvailable, open, query, workspaceGeneration]);

  const currentResult =
    result.query === query.trim() && result.workspaceGeneration === workspaceGeneration
      ? result
      : emptyState;
  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const matches = commands
      .filter((command) => command.id !== "workbench.search-everywhere")
      .filter((command) =>
        [command.label, command.category, command.description, command.shortcut]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle),
      )
      .slice(0, RESULT_LIMIT_PER_SOURCE)
      .map<SearchEntry>((command) => ({
        id: `command:${command.id}`,
        category: "Command",
        label: command.label,
        detail: [command.category, command.description, command.shortcut]
          .filter(Boolean)
          .join(" · "),
        run: command.run,
      }));
    const files = (currentResult.files?.files ?? [])
      .slice(0, RESULT_LIMIT_PER_SOURCE)
      .map<SearchEntry>((file) => ({
        id: `file:${file.path}`,
        category: "File",
        label: file.name,
        detail: file.path,
        run: () => callbacksRef.current.onOpenFile(file.path, workspaceGeneration),
      }));
    const symbols = (currentResult.symbols?.ok ? currentResult.symbols.result.symbols : [])
      .slice(0, RESULT_LIMIT_PER_SOURCE)
      .map<SearchEntry>((symbol: JavaWorkspaceSymbol) => ({
        id: `symbol:${symbol.path}:${symbol.range.start.line}:${symbol.name}`,
        category: "Java symbol",
        label: symbol.name,
        detail: [symbol.containerName, symbol.path, `line ${symbol.range.start.line + 1}`]
          .filter(Boolean)
          .join(" · "),
        run: () =>
          callbacksRef.current.onNavigate(
            symbol.path,
            { kind: "range", range: symbol.range },
            workspaceGeneration,
          ),
      }));
    const textMatches = (currentResult.text?.matches ?? [])
      .slice(0, RESULT_LIMIT_PER_SOURCE)
      .map<SearchEntry>((match: JavaProjectTextSearchMatch) => ({
        id: `text:${match.path}:${match.line}:${match.column}`,
        category: "Project text",
        label: match.snippet,
        detail: `${match.path} · line ${match.line}`,
        run: () =>
          callbacksRef.current.onNavigate(
            match.path,
            { kind: "point", line: match.line, column: match.column },
            workspaceGeneration,
          ),
      }));
    return [...matches, ...files, ...symbols, ...textMatches].slice(0, RESULT_LIMIT_PER_SOURCE * 4);
  }, [commands, currentResult, query, workspaceGeneration]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingCommandCount = normalizedQuery
    ? commands.filter(
        (command) =>
          command.id !== "workbench.search-everywhere" &&
          [command.label, command.category, command.description, command.shortcut]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      ).length
    : 0;
  const sourceResultLimitReached =
    matchingCommandCount > RESULT_LIMIT_PER_SOURCE ||
    (currentResult.files?.files.length ?? 0) > RESULT_LIMIT_PER_SOURCE ||
    (currentResult.symbols?.ok
      ? currentResult.symbols.result.symbols.length > RESULT_LIMIT_PER_SOURCE
      : false) ||
    (currentResult.text?.matches.length ?? 0) > RESULT_LIMIT_PER_SOURCE;

  if (!open || !enabled) return null;

  const execute = async (entry: SearchEntry) => {
    if (runningEntry) return;
    setRunningEntry(entry.id);
    setError(null);
    try {
      await entry.run();
      callbacksRef.current.onClose();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The search result could not be opened.",
      );
      setRunningEntry(null);
    }
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && entries.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % entries.length);
    } else if (event.key === "ArrowUp" && entries.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = entries[selectedIndex];
      if (selected) void execute(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      callbacksRef.current.onClose();
    }
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      callbacksRef.current.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "input:not([disabled]), button:not([disabled])",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/55 px-4 pt-[12vh]"
      data-search-everywhere
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) callbacksRef.current.onClose();
      }}
    >
      <section
        aria-label="Search Everywhere"
        aria-modal="true"
        className="w-full max-w-3xl overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-2xl"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <input
          aria-activedescendant={
            entries[selectedIndex] ? `search-everywhere-option-${selectedIndex}` : undefined
          }
          aria-controls="search-everywhere-results"
          aria-expanded={entries.length > 0}
          aria-label="Search commands, files, Java symbols, and project text"
          autoComplete="off"
          className="w-full border-b border-[var(--border-default)] bg-[var(--surface-background)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
            setResult(emptyState);
            setError(null);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Search commands, files, Java symbols, and project text…"
          ref={inputRef}
          role="combobox"
          value={query}
        />
        <div
          aria-label="Search results"
          className="max-h-[55vh] overflow-y-auto p-1"
          id="search-everywhere-results"
          role="listbox"
        >
          {entries.map((entry, index) => (
            <button
              aria-selected={index === selectedIndex}
              aria-label={`${entry.category}: ${entry.label}${entry.detail ? `, ${entry.detail}` : ""}`}
              className={`flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm ${index === selectedIndex ? "bg-[var(--highlight-bg)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)]"}`}
              disabled={runningEntry !== null}
              id={`search-everywhere-option-${index}`}
              key={entry.id}
              onClick={() => void execute(entry)}
              onMouseEnter={() => setSelectedIndex(index)}
              role="option"
              type="button"
            >
              <span className="min-w-0 truncate font-medium">{entry.label}</span>
              <span className="flex min-w-0 shrink-0 items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>{entry.category}</span>
                <span className="max-w-[34rem] truncate">{entry.detail}</span>
              </span>
            </button>
          ))}
          {currentResult.loading ? (
            <p className="px-3 py-5 text-center text-sm text-[var(--text-muted)]" role="status">
              Searching available commands, files, and project indexes…
            </p>
          ) : null}
          {query.trim() &&
          !currentResult.loading &&
          entries.length === 0 &&
          currentResult.errors.length === 0 ? (
            <p className="px-3 py-5 text-center text-sm text-[var(--text-muted)]">
              No results match “{query.trim()}”.
            </p>
          ) : null}
          {!query.trim() ? (
            <p className="px-3 py-5 text-center text-sm text-[var(--text-muted)]">
              Search available commands, workspace files, Java declarations, and project text.
            </p>
          ) : null}
        </div>
        {currentResult.files?.partial || currentResult.files?.truncated ? (
          <p className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
            File search was partial or reached its workspace limit; narrow the query for more
            results.
          </p>
        ) : null}
        {currentResult.symbols?.ok && currentResult.symbols.result.isTruncated ? (
          <p className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Java symbol search reached its result limit; narrow the query for more results.
          </p>
        ) : null}
        {currentResult.text?.truncated ? (
          <p className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Project text search reached its result limit; narrow the query for more results.
          </p>
        ) : null}
        {sourceResultLimitReached ? (
          <p className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
            Some sources returned more than 50 results. Narrow the query to see other matches.
          </p>
        ) : null}
        {currentResult.errors.map(({ source, message }) => (
          <p
            className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]"
            key={source}
            role="status"
          >
            {source} search unavailable: {message}
          </p>
        ))}
        {error ? (
          <p
            className="border-t border-[var(--border-default)] px-3 py-2 text-sm text-rose-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <p className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
          ↑/↓ to select · Enter to open · Esc to close
        </p>
      </section>
    </div>
  );
}
