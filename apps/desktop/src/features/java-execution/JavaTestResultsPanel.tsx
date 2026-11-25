import React, { useMemo, useState } from "react";
import type { JavaTestCaseResult, JavaTestResults } from "@ide/contracts";
import { useJavaTestSourceRequest } from "./useJavaTestSourceAction";

export function JavaTestResultsPanel({
  results,
  canRerun,
  rerun,
  canDebugFailed = false,
  debugFailed,
  openTestSource,
}: {
  results: JavaTestResults;
  canRerun: boolean;
  rerun(): void;
  canDebugFailed?: boolean;
  debugFailed?(): void;
  openTestSource?(test: JavaTestCaseResult, results: JavaTestResults, isCurrent: () => boolean): Promise<void>;
}) {
  const { summary } = results;
  const { openingTestId, sourceError, openSource } = useJavaTestSourceRequest(results, openTestSource);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [order, setOrder] = useState("failures");
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () =>
      results.suites.flatMap((suite, suiteIndex) =>
        suite.cases.map((test) => ({
          suite,
          suiteIndex,
          test,
          searchText: [suite.name, suite.reportPath, test.className, test.name, test.methodSource?.className, test.methodSource?.methodName, test.methodSource?.declaringClassName, test.detail]
            .join("\n")
            .toLowerCase(),
        })),
      ),
    [results],
  );
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = rows.filter(
      ({ test, searchText }) =>
        (!needle || searchText.includes(needle)) &&
        (outcome === "all" ||
          (outcome === "failures"
            ? ["failed", "error"].includes(test.state)
            : test.state === outcome)),
    );
    if (order === "failures")
      matched.sort(
        (left, right) =>
          Number(!["failed", "error"].includes(left.test.state)) -
          Number(!["failed", "error"].includes(right.test.state)),
      );
    else if (order === "duration")
      matched.sort((left, right) => (right.test.durationMs ?? -1) - (left.test.durationMs ?? -1));
    return matched;
  }, [rows, search, outcome, order]);
  const start = Math.min(page, Math.max(0, Math.ceil(matches.length / 100) - 1)) * 100;
  const displayedSuites: {
    suite: JavaTestResults["suites"][number];
    suiteIndex: number;
    cases: JavaTestCaseResult[];
  }[] = [];
  for (const row of matches.slice(start, start + 100)) {
    const group = displayedSuites.at(-1);
    if (group?.suiteIndex === row.suiteIndex) group.cases.push(row.test);
    else displayedSuites.push({ suite: row.suite, suiteIndex: row.suiteIndex, cases: [row.test] });
  }

  return (
    <section
      aria-label="Java test results"
      className="flex flex-col gap-2 rounded border border-[var(--border-default)] p-2"
    >
      <h3 className="font-semibold">Test results</h3>
      {results.message && <p role="status">{results.message}</p>}
      {(results.status === "ready" || results.status === "partial") && (
        <>
          <p role="status">
            {summary.total} reported tests: {summary.passed} passed, {summary.failed} failed,{" "}
            {summary.error} errors, {summary.skipped} skipped, {summary.flaky} passed after retry.
          </p>
          <button
            type="button"
            className="rounded border px-2 py-1 disabled:opacity-40"
            disabled={!canRerun || !results.canRerunFailed}
            title={
              results.rerunReason ?? "Run the failed selections from this completed test session."
            }
            onClick={rerun}
          >
            Rerun failed tests
          </button>
          {debugFailed && <button type="button" className="rounded border px-2 py-1 disabled:opacity-40"
            disabled={!canDebugFailed} onClick={debugFailed}
            title="Debug failures using this session's JDK and test settings; requires one concrete failed test class and JDI. For Maven, failed tests must belong to one module.">
            Debug failed tests
          </button>}
          {results.rerunSelections && results.rerunSelections.length > 0 && (
            <div aria-label="Java failed-test selections" className="text-xs">
              <p>Selections from this completed report:</p>
              <ul>{results.rerunSelections.slice(0, 10).map((selection) => (
                <li key={`${selection.className}#${selection.methodName ?? ""}`}>
                  {selection.className}{selection.methodName === null ? " — whole class" : `#${selection.methodName}`}
                </li>
              ))}</ul>
              {results.rerunSelections.length > 10 && <p>{results.rerunSelections.length - 10} additional selections.</p>}
              {results.rerunSelections.some((selection) => selection.methodName === null) && (
                <p role="status">The report does not identify every failed method. Whole-class selections also run the previously passing or skipped tests in those classes.</p>
              )}
            </div>
          )}
          <p className="text-xs">
            Rerun uses this session’s project and build settings after saving your edits. A method selection runs all matching overloads and invocations. Tests with
            descriptive or parameterized names rerun their whole class.
          </p>
          {results.rerunReason && summary.failed + summary.error > 0 && (
            <p role="status">{results.rerunReason}</p>
          )}
          {sourceError && <p role="status">{sourceError}</p>}
          <label>
            Search reported tests
            <input
              type="search"
              maxLength={256}
              value={search}
              className="w-full rounded border bg-[var(--surface-editor)] p-1"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Show test outcomes
            <select
              value={outcome}
              className="w-full rounded border bg-[var(--surface-editor)] p-1"
              onChange={(event) => {
                setOutcome(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">All outcomes</option>
              <option value="failures">Failures and errors</option>
              <option value="failed">Failed</option>
              <option value="error">Errors</option>
              <option value="passed">Passed</option>
              <option value="skipped">Skipped</option>
              <option value="flaky">Passed after retry</option>
            </select>
          </label>
          <label>
            Order reported tests
            <select
              value={order}
              className="w-full rounded border bg-[var(--surface-editor)] p-1"
              onChange={(event) => {
                setOrder(event.target.value);
                setPage(0);
              }}
            >
              <option value="failures">Failures first</option>
              <option value="report">Report order</option>
              <option value="duration">Longest duration first</option>
            </select>
          </label>
          <p role="status">
            {matches.length
              ? `Showing ${start + 1}–${Math.min(start + 100, matches.length)} of ${matches.length} matching tests.`
              : "No matching reported tests."}{" "}
            Filters change this view only; rerun still uses the completed session&apos;s failed
            tests.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={start === 0}
              onClick={() => setPage(Math.max(0, start / 100 - 1))}
            >
              Previous tests
            </button>
            <button
              type="button"
              disabled={start + 100 >= matches.length}
              onClick={() => setPage(start / 100 + 1)}
            >
              Next tests
            </button>
          </div>
          {displayedSuites.map(({ suite, suiteIndex, cases }, index) => (
            <details
              key={`${suite.reportPath}:${suiteIndex}:${index}`}
              open={
                cases.some((test) => test.state === "failed" || test.state === "error") ||
                !!search.trim() ||
                outcome !== "all"
              }
            >
              <summary>
                {suite.name} ({cases.length} shown / {suite.cases.length} reported)
              </summary>
              <p className="text-xs break-all">{suite.reportPath}</p>
              <ul className="flex flex-col gap-1">
                {cases.map((test) => (
                  <li key={test.id}>
                    <details open={test.state === "failed" || test.state === "error"}>
                      <summary className="break-all">
                        {test.state}: {test.className ? `${test.className} · ` : ""}
                        {test.name}
                        {test.durationMs === null ? "" : ` (${Math.round(test.durationMs)} ms)`}
                        {test.methodSource && (
                          <span aria-label={`Runner method for ${test.name}`} className="block text-xs break-all">
                            Method: {test.methodSource.className}#{test.methodSource.methodName}
                          </span>
                        )}
                        {test.methodSource?.declaringClassName && test.methodSource.declaringClassName !== test.methodSource.className && (
                          <span aria-label="Test method declaring class" className="block text-xs break-all">
                            Declared in: {test.methodSource.declaringClassName}
                          </span>
                        )}
                      </summary>
                      {openTestSource && test.className && (
                        <button
                          type="button"
                          aria-label={`Open source for ${test.className} test ${test.name}`}
                          className="rounded border px-2 py-1 disabled:opacity-40"
                          disabled={openingTestId !== null}
                          onClick={() => void openSource(test)}
                        >
                          {openingTestId === test.id ? "Opening test source…" : "Open test source"}
                        </button>
                      )}
                      {test.detail && (
                        <pre
                          aria-label={`Test detail for ${test.name}`}
                          className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-[var(--surface-editor)] p-2 text-xs"
                        >
                          {test.detail}
                        </pre>
                      )}
                      {test.detailTruncated && (
                        <p role="status">Test detail was truncated to 16 KiB.</p>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
