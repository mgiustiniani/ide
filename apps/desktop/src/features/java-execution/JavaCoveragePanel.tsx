import { useState } from "react";
import type {
  JavaCoverageCounter,
  JavaCoverageCounters,
  JavaCoverageResults,
} from "@ide/contracts";

function percentage(counter: JavaCoverageCounter): string {
  const total = counter.missed + counter.covered;
  return total === 0 ? "—" : `${((100 * counter.covered) / total).toFixed(1)}%`;
}
function Summary({ counters }: { counters: JavaCoverageCounters }) {
  return (
    <dl className="flex flex-wrap gap-4">
      {(["lines", "branches", "instructions"] as const).map((kind) => (
        <div key={kind}>
          <dt>{kind[0].toUpperCase() + kind.slice(1)}</dt>
          <dd>
            {percentage(counters[kind])} ({counters[kind].covered} /{" "}
            {counters[kind].missed + counters[kind].covered})
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function JavaCoveragePanel({
  results,
  sourcePaths = new Map(),
  onOpenSource,
}: {
  results: JavaCoverageResults;
  sourcePaths?: ReadonlyMap<string, string>;
  onOpenSource?(filePath: string, line: number): void;
}) {
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const file = results.files.find((file) => file.id === selected) ?? results.files[0];
  const start = file && page * 200 < file.lines.length ? page * 200 : 0;
  return (
    <section
      aria-label="Java test coverage"
      className="flex flex-col gap-2 rounded border border-[var(--border-default)] p-2"
    >
      <h3 className="font-semibold">Test coverage</h3>
      <p role="status">
        JaCoCo: {results.status}
        {results.reports ? ` · ${results.reports} execution report(s)` : ""}.
      </p>
      {results.message && (
        <p role={results.status === "unavailable" ? "alert" : "status"}>{results.message}</p>
      )}
      {["ready", "partial"].includes(results.status) && (
        <>
          <Summary counters={results.counters} />
          <p className="text-xs">
            Production code measured by this test execution. A dash means no executable code or
            branches were reported. Partly executed lines count as covered; branch coverage shows
            untested choices. These results describe compiled code from the execution.
          </p>
          {file && (
            <>
              <label>
                Measured source file
                <select
                  className="w-full rounded border bg-[var(--surface-editor)] p-1"
                  value={file.id}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setPage(0);
                  }}
                >
                  {results.files.map((file) => (
                    <option
                      key={file.id}
                      value={file.id}
                    >
                      {file.packageName ? `${file.packageName}/` : ""}
                      {file.name} · {file.reportPath}
                    </option>
                  ))}
                </select>
              </label>
              {sourcePaths.has(file.id) && onOpenSource ? (
                <button
                  type="button"
                  className="self-start underline"
                  onClick={() =>
                    onOpenSource(sourcePaths.get(file.id)!, file.lines[0]?.number ?? 1)
                  }
                >
                  Open measured source
                </button>
              ) : (
                <p role="status">
                  Source navigation needs one unique main source file that was open during this run
                  in synchronized Java Project.
                </p>
              )}
              <Summary counters={file.counters} />
              {file.lines.length > 0 ? (
                <>
                  <p>
                    Lines {start + 1}–{Math.min(start + 200, file.lines.length)} of{" "}
                    {file.lines.length} measured lines.
                  </p>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-xs">
                      <caption>Line measurements for {file.name}</caption>
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>Instructions covered / total</th>
                          <th>Branches covered / total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {file.lines.slice(start, start + 200).map((line) => (
                          <tr key={line.number}>
                            <td>
                              {sourcePaths.has(file.id) && onOpenSource ? (
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() =>
                                    onOpenSource(sourcePaths.get(file.id)!, line.number)
                                  }
                                >
                                  {line.number}
                                </button>
                              ) : (
                                line.number
                              )}
                            </td>
                            <td>
                              {line.coveredInstructions} /{" "}
                              {line.coveredInstructions + line.missedInstructions}
                            </td>
                            <td>
                              {line.coveredBranches + line.missedBranches === 0
                                ? "—"
                                : `${line.coveredBranches} / ${line.coveredBranches + line.missedBranches}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={start === 0}
                      onClick={() => setPage(Math.max(0, Math.floor(start / 200) - 1))}
                    >
                      Previous lines
                    </button>
                    <button
                      disabled={start + 200 >= file.lines.length}
                      onClick={() => setPage(Math.floor(start / 200) + 1)}
                    >
                      Next lines
                    </button>
                  </div>
                </>
              ) : (
                <p>No line debug information was reported for this file.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
