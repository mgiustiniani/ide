import type { JavaDatabaseConnectionResult } from "@ide/contracts";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { sqlSchemaSuggestions, type SqlSchemaSuggestion } from "./sqlSchemaSuggestions";

export function SqlSchemaSuggestionsDialog({
  metadata,
  onSelect,
  onClose,
}: {
  metadata: JavaDatabaseConnectionResult;
  onSelect(suggestion: SqlSchemaSuggestion): void;
  onClose(): void;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();
  const result = useMemo(() => sqlSchemaSuggestions(metadata, filter), [metadata, filter]);
  useEffect(() => {
    search.current?.focus();
  }, []);
  const index = Math.min(selected, Math.max(0, result.items.length - 1));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="SQL schema suggestions"
        className="max-h-[85vh] w-[min(42rem,90vw)] overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4 text-[var(--text-primary)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSelected(
              (index + (event.key === "ArrowDown" ? 1 : -1) + result.items.length) %
                Math.max(1, result.items.length),
            );
          } else if (event.key === "Enter" && event.target === search.current) {
            event.preventDefault();
            const item = result.items[index];
            if (item) onSelect(item);
          } else if (event.key === "Tab") {
            const nodes = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>("input,button") ?? [],
            );
            const first = nodes[0],
              last = nodes.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h3 className="font-semibold">SQL schema suggestions</h3>
        <p className="my-2 text-xs">
          Inserts a driver-quoted identifier at the captured SQL selection. Nothing is executed.
        </p>
        <input
          ref={search}
          aria-label="Search database schema"
          role="combobox"
          aria-expanded="true"
          aria-controls={id}
          aria-activedescendant={result.items[index] ? `${id}-${index}` : undefined}
          value={filter}
          maxLength={512}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelected(0);
          }}
          className="w-full rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-2"
        />
        {!result.available ? (
          <p role="status">
            This driver or host does not provide supported identifier quoting. Schema insertion is
            unavailable.
          </p>
        ) : null}
        {result.partial ? (
          <p role="status">Schema metadata is partial; some tables or columns are missing.</p>
        ) : null}
        {result.omitted ? (
          <p role="status">Other catalogs and names at metadata limits are omitted.</p>
        ) : null}
        <p className="my-2 text-xs">
          From the last schema inspection. Refresh after schema or catalog changes. Columns are
          inserted without a table prefix; aliases and query scope are not resolved.
        </p>
        <ul
          id={id}
          role="listbox"
          aria-label="Database identifiers"
          className="my-2 max-h-64 overflow-auto"
        >
          {result.items.map((item, position) => (
            <li
              key={item.key}
              id={`${id}-${position}`}
              role="option"
              aria-selected={position === index}
            >
              <button
                type="button"
                className="w-full p-2 text-left hover:bg-[var(--surface-primary)]"
                aria-label={`Insert ${item.kind} ${item.label}`}
                onClick={() => onSelect(item)}
              >
                <span>{item.label}</span>
                <span className="ml-2 text-xs">
                  {item.kind} · {item.detail}
                </span>
                <code className="block text-xs">{item.insertText}</code>
              </button>
            </li>
          ))}
        </ul>
        {result.available && !result.total ? (
          <p role="status">No matching identifiers in this schema snapshot.</p>
        ) : null}
        {result.total > result.items.length ? (
          <p role="status">
            Showing {result.items.length} of {result.total} matches. Refine the search.
          </p>
        ) : null}
        <button type="button" onClick={onClose}>
          Cancel suggestions
        </button>
      </div>
    </div>,
    document.body,
  );
}
