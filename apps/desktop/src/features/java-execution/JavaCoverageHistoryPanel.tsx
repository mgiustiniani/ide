import { useState } from "react";
import type { JavaCoverageHistoryEntry } from "./useJavaCoverageHistory";

const kinds = ["lines", "branches", "instructions"] as const;
function percent(counter: { covered: number; missed: number }): number | null {
  const total = counter.covered + counter.missed;
  return total === 0 ? null : (100 * counter.covered) / total;
}
function label(entry: JavaCoverageHistoryEntry): string {
  const selection = entry.testSelection;
  let scope = "Test selection unavailable";
  if (selection) {
    const remaining = selection.selectorCount - selection.selectors.length;
    scope = selection.selectors.length ? selection.selectors.join(", ") : "No IDE test filter";
    if (remaining > 0) scope += ` (+${remaining} more)`;
    if (selection.sourceSet) scope = `${selection.sourceSet} · ${scope}`;
  }
  return `${new Date(entry.completedAt).toLocaleString()} · ${entry.configurationName ?? "Configuration"} · ${entry.buildTool} · ${entry.projectPath || "."} · ${entry.operation} · ${scope} · ${entry.executionState} · ${entry.status}`;
}
export function JavaCoverageHistoryPanel({
  entries,
  onClear,
}: {
  entries: readonly JavaCoverageHistoryEntry[];
  onClear?(): void;
}) {
  const [currentId, setCurrentId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const current = entries.find((entry) => entry.id === currentId) ?? entries[0];
  if (!current)
    return (
      <section aria-label="Java coverage history">
        <p>No saved coverage measurements.</p>
        {onClear && (
          <button type="button" onClick={onClear}>
            Clear saved coverage history
          </button>
        )}
      </section>
    );
  const candidates =
    current.status === "ready"
      ? entries.filter(
          (entry) =>
            entry.id !== current.id &&
            entry.status === "ready" &&
            entry.buildTool === current.buildTool &&
            entry.projectPath === current.projectPath &&
            entry.operation === current.operation,
        )
      : [];
  const baseline = candidates.find((entry) => entry.id === baselineId);
  const selectClass = "w-full rounded border bg-[var(--surface-editor)] p-1";
  return (
    <section
      aria-label="Java coverage history"
      className="flex min-w-0 flex-col gap-2 rounded border p-2"
    >
      <h3 className="font-semibold">Coverage history</h3>
      <p className="text-xs">
        The last ten completed measurements, saved locally for this workspace. Historical
        measurements do not enable source navigation or restore an execution session.
      </p>
      {onClear && (
        <button type="button" className="self-start underline" onClick={onClear}>
          Clear saved coverage history
        </button>
      )}
      <label>
        Coverage measurement
        <select
          className={selectClass}
          value={current.id}
          onChange={(event) => {
            setCurrentId(event.target.value);
            setBaselineId("");
          }}
        >
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {label(entry)}
            </option>
          ))}
        </select>
      </label>
      <p>
        {current.reports} report(s) · {current.files} source file(s) ·{" "}
        {current.tests === null ? "Test count unavailable" : `${current.tests} test(s)`}
      </p>
      {current.status === "partial" ? (
        <p role="status">This measurement is partial; comparison is unavailable.</p>
      ) : (
        <label>
          Compare coverage with
          <select
            className={selectClass}
            value={baseline?.id ?? ""}
            onChange={(event) => setBaselineId(event.target.value)}
          >
            <option value="">No comparison</option>
            {candidates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {label(entry)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption>
            Coverage measurement{baseline ? " and change from baseline" : " summary"}
          </caption>
          <thead>
            <tr>
              <th>Counter</th>
              <th>Covered / total</th>
              <th>Coverage</th>
              {baseline && (
                <>
                  <th>Baseline covered / total</th>
                  <th>Baseline coverage</th>
                  <th>Change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => {
              const counter = current.counters[kind];
              const value = percent(counter);
              const before = baseline ? percent(baseline.counters[kind]) : null;
              const delta = value !== null && before !== null ? value - before : null;
              return (
                <tr key={kind}>
                  <th scope="row">{kind}</th>
                  <td>
                    {counter.covered} / {counter.covered + counter.missed}
                  </td>
                  <td>{value === null ? "—" : `${value.toFixed(1)}%`}</td>
                  {baseline && (
                    <>
                      <td>
                        {baseline.counters[kind].covered} /{" "}
                        {baseline.counters[kind].covered + baseline.counters[kind].missed}
                      </td>
                      <td>{before === null ? "—" : `${before.toFixed(1)}%`}</td>
                      <td>
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {baseline && (
        <p className="text-xs">
          Change is measured in percentage points. Comparisons use the same project directory, build
          tool and coverage operation. Test selection, module selection, compiler inputs and
          measured code can differ; a percentage change alone does not establish a regression.
          Baseline: {baseline.reports} report(s), {baseline.files} source file(s),{" "}
          {baseline.tests === null ? "test count unavailable" : `${baseline.tests} test(s)`}.
        </p>
      )}
    </section>
  );
}
