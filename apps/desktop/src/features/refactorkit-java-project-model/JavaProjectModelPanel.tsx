import type { JavaProjectModelController } from "./useJavaProjectModelController";

/**
 * Desktop-only read-only presentation of the RefactorKit engine project model.
 * Shows the availability state (available/unavailable/error) and a read-only
 * packages/classes/symbols structure listing. No click->open navigation in this
 * slice; the model is presented exactly as produced by the RefactorKit engine.
 */
export function JavaProjectModelPanel({
  controller,
}: {
  controller: JavaProjectModelController;
}): JSX.Element {
  const {
    availability,
    availabilityReason,
    isBusy,
    error,
    projectRoot,
    model,
    totalSymbolCount,
    presentedSymbolsTruncated,
    refresh,
  } = controller;
  const badge =
    availability === "available"
      ? "Available"
      : availability === "error"
        ? "Error"
        : "Unavailable";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              availability === "available"
                ? "bg-green-950/40 text-green-100"
                : availability === "error"
                  ? "bg-red-950/40 text-red-100"
                  : "bg-[var(--highlight-bg)] text-[var(--text-secondary)]"
            }`}
          >
            {badge}
          </span>
          {projectRoot ? (
            <span className="max-w-[16rem] truncate text-xs text-[var(--text-muted)]" title={projectRoot}>
              {projectRoot}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          disabled={isBusy}
          onClick={() => {
            void refresh();
          }}
        >
          {isBusy ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div role="alert" className="border-b border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}
      {availability === "unavailable" && availabilityReason ? (
        <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">{availabilityReason}</div>
      ) : null}

      {availability === "available" && model ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Packages ({model.packages.length})
            </h3>
            <ul className="space-y-1 text-xs">
              {model.packages.length === 0 ? (
                <li className="text-[var(--text-muted)]">No packages reported.</li>
              ) : (
                model.packages.map((pkg) => (
                  <li key={pkg.name} className="flex items-center justify-between gap-3">
                    <span>{pkg.name}</span>
                    <span className="text-[var(--text-muted)]">
                      {pkg.classCount} class{pkg.classCount === 1 ? "" : "es"} · {pkg.symbolCount}{" "}
                      symbol{pkg.symbolCount === 1 ? "" : "s"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Classes ({model.classes.length})
            </h3>
            <ul className="space-y-1 text-xs">
              {model.classes.length === 0 ? (
                <li className="text-[var(--text-muted)]">No classes reported.</li>
              ) : (
                model.classes.map((klass) => (
                  <li key={`${klass.qualifiedName}-${klass.path}:${klass.line}`}>
                    <span className="font-medium">{klass.name}</span>{" "}
                    <span className="text-[var(--text-muted)]">
                      {klass.kind.toLowerCase()} · {klass.qualifiedName}
                    </span>
                    <span className="ml-2 text-[var(--text-muted)]">
                      {klass.path}:{klass.line}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {presentedSymbolsTruncated
                ? `Symbols (${model.symbols.length} of ${totalSymbolCount})`
                : `Symbols (${model.symbols.length})`}
            </h3>
            {presentedSymbolsTruncated ? (
              <p
                data-testid="java-project-model-symbols-truncation"
                className="text-xs text-[var(--text-muted)]"
              >
                Showing {model.symbols.length} of {totalSymbolCount} symbols — the engine result is
                larger than the bounded symbol list shown here.
              </p>
            ) : null}
            <ul className="space-y-1 text-xs">
              {model.symbols.length === 0 ? (
                <li className="text-[var(--text-muted)]">No symbols reported.</li>
              ) : (
                model.symbols.map((symbol) => (
                  <li key={`${symbol.qualifiedName}-${symbol.path}:${symbol.line}`}>
                    <span className="text-[var(--text-muted)]">{symbol.kind.toLowerCase()}</span>{" "}
                    <span>{symbol.qualifiedName}</span>
                    <span className="ml-2 text-[var(--text-muted)]">
                      {symbol.path}:{symbol.line}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
