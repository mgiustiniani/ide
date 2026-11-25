import type { KeyboardEvent } from "react";
import {
  DIAGNOSTIC_SEVERITY_ORDER,
  countDiagnostics,
  type DiagnosticCounts,
  type DiagnosticRange,
  type DiagnosticSeverity,
} from "../diagnostics";

export interface ProblemItem {
  /** Stable identity supplied by the host when available. */
  id?: string;
  provider: string;
  /** Workspace-relative document path. */
  filePath: string;
  severity: DiagnosticSeverity;
  /** Zero-based, end-exclusive source range. */
  range: DiagnosticRange;
  message: string;
  code?: string | number;
  source?: string;
}

export interface ProblemGroup {
  provider: string;
  filePath: string;
  severity: DiagnosticSeverity;
  items: ProblemItem[];
}

export interface ProblemsPanelProps {
  items: readonly ProblemItem[];
  onNavigate?: (documentPath: string, range: DiagnosticRange) => void;
  /** Allows the host to revalidate a provider-owned problem before opening it. */
  onNavigateProblem?: (item: ProblemItem) => void;
  emptyMessage?: string;
  /** A provider availability limitation, without an invented source location. */
  notice?: string;
  /** Optional accessible name when more than one Problems panel is present. */
  ariaLabel?: string;
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function sortProblems(items: readonly ProblemItem[]): ProblemItem[] {
  return [...items].sort(
    (left, right) =>
      DIAGNOSTIC_SEVERITY_ORDER[left.severity] - DIAGNOSTIC_SEVERITY_ORDER[right.severity] ||
      left.filePath.localeCompare(right.filePath) ||
      finiteCoordinate(left.range.start.line) - finiteCoordinate(right.range.start.line) ||
      finiteCoordinate(left.range.start.character) -
        finiteCoordinate(right.range.start.character) ||
      left.provider.localeCompare(right.provider) ||
      left.message.localeCompare(right.message),
  );
}

export function groupProblems(items: readonly ProblemItem[]): ProblemGroup[] {
  const groups: ProblemGroup[] = [];
  for (const item of sortProblems(items)) {
    const previous = groups[groups.length - 1];
    if (
      previous?.provider === item.provider &&
      previous.filePath === item.filePath &&
      previous.severity === item.severity
    ) {
      previous.items.push(item);
    } else {
      groups.push({
        provider: item.provider,
        filePath: item.filePath,
        severity: item.severity,
        items: [item],
      });
    }
  }
  return groups;
}

export function getProblemCounts(items: readonly ProblemItem[]): DiagnosticCounts {
  return countDiagnostics(items);
}

function severitySymbol(severity: DiagnosticSeverity): string {
  if (severity === "error") return "×";
  if (severity === "warning") return "⚠";
  if (severity === "info" || severity === "information") return "i";
  return "·";
}

function activateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, action: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export function ProblemsPanel({
  items,
  onNavigate,
  onNavigateProblem,
  emptyMessage = "No problems detected.",
  notice,
  ariaLabel = "Problems",
}: ProblemsPanelProps): JSX.Element {
  const counts = getProblemCounts(items);
  const groups = groupProblems(items);

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--surface-panel)] text-[var(--text-primary)]"
      aria-label={ariaLabel}
    >
      <header className="flex min-h-8 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-default)] px-3 py-1 text-xs">
        <strong>
          {counts.total} {counts.total === 1 ? "problem" : "problems"}
        </strong>
        {(["error", "warning", "info", "hint"] as const).map((severity) => (
          <span
            key={severity}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--input-bg)] px-1.5 py-0.5"
            data-severity={severity}
            aria-label={`${counts[severity]} ${severity}${counts[severity] === 1 ? "" : "s"}`}
          >
            <span aria-hidden="true">{severitySymbol(severity)}</span>
            {counts[severity]}
          </span>
        ))}
      </header>

      {notice ? <p role="alert" className="px-3 py-2 text-sm">{notice}</p> : null}
      {groups.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--text-muted)]"
          role="status"
        >
          {notice ? "This provider cannot report diagnostics for this file." : emptyMessage}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" data-testid="problems-scroll-region">
          <ul className="m-0 list-none p-0" role="tree" aria-label={`${ariaLabel} list`}>
            {groups.map((group, groupIndex) => (
              <li
                key={`${group.severity}-${group.filePath}-${group.provider}-${groupIndex}`}
                role="none"
              >
                <div className="sticky top-0 z-[1] flex items-center gap-2 border-y border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-1 text-xs">
                  <span className="font-medium">{group.filePath}</span>
                  <span className="text-[var(--text-muted)]">{group.provider}</span>
                  <span className="ml-auto" data-severity={group.severity}>
                    {group.items.length}
                  </span>
                </div>
                <ul className="m-0 list-none p-0" role="group">
                  {group.items.map((item, itemIndex) => {
                    const navigate = (): void => {
                      if (onNavigateProblem) onNavigateProblem(item);
                      else onNavigate?.(item.filePath, item.range);
                    };
                    const line = finiteCoordinate(item.range.start.line) + 1;
                    const column = finiteCoordinate(item.range.start.character) + 1;
                    return (
                      <li key={item.id ?? `${item.message}-${itemIndex}`} role="none">
                        <button
                          type="button"
                          role="treeitem"
                          className="flex w-full min-w-0 items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--highlight-bg)] focus-visible:bg-[var(--highlight-bg)]"
                          aria-label={`${item.severity}: ${item.message}, ${item.filePath}, line ${line}, column ${column}, provider ${item.provider}`}
                          data-severity={item.severity}
                          onClick={navigate}
                          onKeyDown={(event) => activateWithKeyboard(event, navigate)}
                        >
                          <span aria-hidden="true" className="w-3 shrink-0 text-center">
                            {severitySymbol(item.severity)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="break-words">{item.message}</span>
                            <span className="ml-2 text-[var(--text-muted)]">
                              {item.source
                                ? `${item.source}${item.code !== undefined ? `(${String(item.code)})` : ""} · `
                                : item.code !== undefined
                                  ? `${String(item.code)} · `
                                  : ""}
                              {line}:{column}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
