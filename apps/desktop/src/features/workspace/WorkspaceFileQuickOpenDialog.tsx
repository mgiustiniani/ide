import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { WorkspaceFileSearchResult } from "@ide/contracts";

export interface WorkspaceFileQuickOpenDialogProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly workspaceGeneration: number;
  readonly search: (
    query: string,
    workspaceGeneration: number,
  ) => Promise<WorkspaceFileSearchResult>;
  readonly onOpenFile: (path: string, workspaceGeneration: number) => Promise<void>;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

export function WorkspaceFileQuickOpenDialog({
  enabled,
  open,
  workspaceGeneration,
  search,
  onOpenFile,
  onOpen,
  onClose,
}: WorkspaceFileQuickOpenDialogProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const requestSequenceRef = useRef(0);
  const callbacksRef = useRef({ enabled, open, onOpen, onClose });
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WorkspaceFileSearchResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  callbacksRef.current = { enabled, open, onOpen, onClose };

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLocaleLowerCase() !== "p" ||
        !callbacksRef.current.enabled
      )
        return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const inQuickOpen = Boolean(target?.closest("[data-workspace-file-quick-open]"));
      const inEditor = Boolean(target?.closest(".monaco-editor"));
      if (
        !inQuickOpen &&
        !inEditor &&
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;

      event.preventDefault();
      if (callbacksRef.current.open) callbacksRef.current.onClose();
      else callbacksRef.current.onOpen();
    };
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setResult(null);
    setSelectedIndex(0);
    setOpeningPath(null);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => previousFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    const request = ++requestSequenceRef.current;
    if (!open || normalizedQuery.length === 0) {
      setResult(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);
    const timeout = window.setTimeout(() => {
      void search(normalizedQuery, workspaceGeneration).then(
        (response) => {
          if (request !== requestSequenceRef.current || !callbacksRef.current.open) return;
          setResult(response);
          setSelectedIndex(0);
          setLoading(false);
        },
        (failure: unknown) => {
          if (request !== requestSequenceRef.current || !callbacksRef.current.open) return;
          setError(failure instanceof Error ? failure.message : "Workspace file search failed.");
          setResult(null);
          setLoading(false);
        },
      );
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [open, query, search, workspaceGeneration]);

  if (!open) return null;

  const files = result?.files ?? [];
  const openSelectedFile = async (path: string) => {
    if (!result || openingPath) return;
    setOpeningPath(path);
    setError(null);
    try {
      await onOpenFile(path, workspaceGeneration);
      callbacksRef.current.onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The file could not be opened.");
      setOpeningPath(null);
    }
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && files.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % files.length);
    } else if (event.key === "ArrowUp" && files.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + files.length) % files.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = files[selectedIndex];
      if (selected) void openSelectedFile(selected.path);
    } else if (event.key === "Escape") {
      event.preventDefault();
      callbacksRef.current.onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 px-4 pt-[12vh]"
      data-workspace-file-quick-open
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) callbacksRef.current.onClose();
      }}
    >
      <section
        aria-label="Go to File"
        aria-modal="true"
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-2xl"
        role="dialog"
      >
        <input
          aria-label="Search workspace files"
          aria-activedescendant={
            files[selectedIndex] ? `workspace-file-quick-open-option-${selectedIndex}` : undefined
          }
          autoComplete="off"
          className="w-full border-b border-[var(--border-default)] bg-[var(--surface-background)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
            setResult(null);
            setError(null);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Type a file name or path…"
          ref={inputRef}
          role="combobox"
          aria-controls="workspace-file-quick-open-results"
          aria-expanded={files.length > 0}
          value={query}
        />
        <div
          aria-label="Workspace files"
          className="max-h-[55vh] overflow-y-auto p-1"
          id="workspace-file-quick-open-results"
          role="listbox"
        >
          {files.map((file, index) => (
            <button
              aria-selected={index === selectedIndex}
              aria-label={`${file.name}, ${file.path}`}
              className={`flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm ${index === selectedIndex ? "bg-[var(--highlight-bg)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)]"}`}
              disabled={openingPath !== null}
              data-path={file.path}
              id={`workspace-file-quick-open-option-${index}`}
              key={file.path}
              onClick={() => void openSelectedFile(file.path)}
              onMouseEnter={() => setSelectedIndex(index)}
              role="option"
              type="button"
            >
              <span className="min-w-0 truncate font-medium">{file.name}</span>
              <span className="min-w-0 truncate text-xs text-[var(--text-muted)]">{file.path}</span>
            </button>
          ))}
          {loading ? (
            <p className="px-3 py-5 text-center text-sm text-[var(--text-muted)]" role="status">
              Searching workspace files…
            </p>
          ) : null}
          {query.trim() && !loading && files.length === 0 && !error ? (
            <p className="px-3 py-5 text-center text-sm text-[var(--text-muted)]">
              No files match “{query.trim()}”.
            </p>
          ) : null}
          {!query.trim() ? (
            <p className="px-3 py-5 text-center text-sm text-[var(--text-muted)]">
              Search file names and workspace-relative paths.
            </p>
          ) : null}
        </div>
        {result?.partial || result?.truncated ? (
          <p className="border-t border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {result.partial
              ? "Some folders could not be searched."
              : "Search reached its workspace limit; narrow the query for more results."}
          </p>
        ) : null}
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
