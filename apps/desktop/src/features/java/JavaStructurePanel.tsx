import { useEffect, useMemo, useRef, useState } from "react";
import type { JavaStructureEntry } from "./useJavaStructure";
import { useJavaStructure, type JavaStructureDependencies } from "./useJavaStructure";

/** Filter display data while retaining the ancestors of matching declarations. */
function filtered(entries: JavaStructureEntry[], query: string): JavaStructureEntry[] {
  if (!query) return entries;
  const result: JavaStructureEntry[] = [];
  for (const entry of entries) {
    const children = filtered(entry.children, query);
    if (
      `${entry.symbol.name} ${entry.symbol.detail ?? ""} ${entry.symbol.kind}`
        .toLocaleLowerCase()
        .includes(query)
    )
      result.push(entry);
    else if (children.length) result.push({ ...entry, children });
  }
  return result;
}

const nameOrder = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Reorder siblings for display without changing provider identities or ranges. */
function sortedByName(entries: JavaStructureEntry[]): JavaStructureEntry[] {
  return entries
    .map((entry) => ({ ...entry, children: sortedByName(entry.children) }))
    .sort((a, b) => nameOrder.compare(a.symbol.name, b.symbol.name));
}

export function JavaStructurePanel(props: JavaStructureDependencies) {
  const structure = useJavaStructure(props);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"source" | "name">("source");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [navigationError, setNavigationError] = useState(false);
  const navigationView = useMemo(
    () => ({
      current: true,
      workspaceId: props.workspaceId,
      generation: props.generation,
      filePath: structure.filePath,
      entries: structure.entries,
    }),
    [props.workspaceId, props.generation, structure.filePath, structure.entries],
  );
  const navigationViewRef = useRef(navigationView);
  navigationViewRef.current = navigationView;
  useEffect(() => {
    navigationView.current = true;
    return () => {
      navigationView.current = false;
    };
  }, [navigationView]);
  useEffect(() => {
    setQuery("");
    setCollapsed(new Set());
    setNavigationError(false);
  }, [props.workspaceId, props.generation, structure.filePath]);
  // IDs refer to a provider response, so a refreshed outline starts expanded.
  useEffect(() => {
    setCollapsed(new Set());
    setNavigationError(false);
  }, [structure.entries]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const entries = useMemo(
    () => {
      const matches = filtered(structure.entries, normalizedQuery);
      return sortOrder === "name" ? sortedByName(matches) : matches;
    },
    [structure.entries, normalizedQuery, sortOrder],
  );
  const originals = useMemo(() => {
    const byId = new Map<string, JavaStructureEntry>();
    const visit = (entries: JavaStructureEntry[]) => {
      for (const entry of entries) {
        byId.set(entry.id, entry);
        visit(entry.children);
      }
    };
    visit(structure.entries);
    return byId;
  }, [structure.entries]);
  const renderEntries = (entries: JavaStructureEntry[], nested = false) => (
    <ul
      aria-label={nested ? undefined : "Java declarations"}
      className={nested ? "ml-3 border-l border-[var(--border-default)] pl-2" : "space-y-1"}
    >
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="flex items-start gap-1">
            {entry.children.length > 0 ? (
              <button
                type="button"
                aria-label={`${collapsed.has(entry.id) ? "Expand" : "Collapse"} ${entry.symbol.name}`}
                aria-expanded={normalizedQuery ? true : !collapsed.has(entry.id)}
                className="rounded px-1 focus-visible:outline"
                disabled={Boolean(normalizedQuery)}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  })
                }
              >
                {!normalizedQuery && collapsed.has(entry.id) ? "▸" : "▾"}
              </button>
            ) : (
              <span className="w-4" aria-hidden="true" />
            )}
            <button
              type="button"
              aria-label={`Open ${entry.symbol.kind} ${entry.symbol.name}`}
              title={entry.symbol.detail}
              className="min-w-0 flex-1 rounded px-1 text-left hover:bg-[var(--highlight-bg)] focus-visible:outline"
              onClick={() => {
                const original = originals.get(entry.id);
                if (original)
                  void structure.navigate(original).then((opened) => {
                    if (navigationView.current && navigationViewRef.current === navigationView)
                      setNavigationError(!opened);
                  });
              }}
            >
              <span className="mr-2 text-xs text-[var(--text-secondary)]">{entry.symbol.kind}</span>
              <span className={entry.symbol.deprecated ? "line-through" : ""}>
                {entry.symbol.name}
              </span>
              {entry.symbol.detail ? (
                <span className="ml-2 text-xs text-[var(--text-secondary)]">
                  {entry.symbol.detail}
                </span>
              ) : null}
            </button>
          </div>
          {entry.children.length > 0 && (normalizedQuery || !collapsed.has(entry.id))
            ? renderEntries(entry.children, true)
            : null}
        </li>
      ))}
    </ul>
  );
  return (
    <section
      aria-label="Java file structure"
      aria-busy={structure.busy}
      className="flex h-full min-h-0 flex-col gap-2 p-3 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Java Structure</h2>
        <button
          type="button"
          onClick={structure.refresh}
          disabled={!structure.available || structure.busy}
        >
          Refresh structure
        </button>
      </div>
      <p className="break-all text-xs text-[var(--text-secondary)]">
        {structure.filePath ?? "No Java source selected"}
      </p>
      {!structure.available ? (
        <p role="status">{structure.unavailableReason}</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs">
            Filter declarations
            <input
              type="search"
              aria-label="Filter Java declarations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={256}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            Order
            <select
              aria-label="Java declaration order"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value === "name" ? "name" : "source")}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-2 py-1"
            >
              <option value="source">Source order</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setCollapsed(new Set())}>
              Expand all
            </button>
            <button
              type="button"
              disabled={Boolean(normalizedQuery)}
              onClick={() => setCollapsed(new Set(originals.keys()))}
            >
              Collapse all
            </button>
          </div>
          {structure.busy ? <p role="status">Loading Java structure…</p> : null}
          {structure.error ? <p role="alert">{structure.error}</p> : null}
          {navigationError ? (
            <p role="alert">
              The declaration changed or could not be opened. Refresh the structure.
            </p>
          ) : null}
          {structure.partial ? (
            <p role="status">This outline is partial; some declarations are not displayed.</p>
          ) : null}
          {!structure.busy && !structure.error && entries.length === 0 ? (
            <p role="status">
              {normalizedQuery
                ? "No declarations match the filter."
                : "No declarations were reported for this source."}
            </p>
          ) : null}
          <div className="min-h-0 overflow-auto">
            {entries.length > 0 ? renderEntries(entries) : null}
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            JDT LS document symbols · {sortOrder === "name" ? "name order" : "source order"} · current editor buffer
          </p>
        </>
      )}
    </section>
  );
}
