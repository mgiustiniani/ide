import type { JavaDiscoveredTest, JavaTestDiscovery } from "@ide/contracts";
import { useMemo, useState } from "react";
import { useJavaTestSourceRequest, type OpenJavaTestSource } from "./useJavaTestSourceAction";

export function JavaTestDiscoveryPanel({
  discovery,
  disabled,
  run,
  cover,
  debug,
  openTestSource,
}: {
  discovery: JavaTestDiscovery;
  disabled: boolean;
  run: (id: string) => void;
  cover?: (id: string) => void;
  debug?: (id: string) => void;
  openTestSource?: OpenJavaTestSource;
}) {
  const { openingTestId, sourceError, openSource } = useJavaTestSourceRequest<
    JavaDiscoveredTest,
    JavaTestDiscovery
  >(discovery, openTestSource);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const indexed = useMemo(
    () =>
      discovery.tests.map((test) => ({
        test,
        text: [test.label, test.className, test.methodName ?? "", ...(test.displayNames ?? [])]
          .join("\n")
          .toLowerCase(),
      })),
    [discovery.tests],
  );
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return indexed.filter(
      ({ test, text }) =>
        (kind === "all" || test.kind === kind) && (!needle || text.includes(needle)),
    );
  }, [indexed, search, kind]);
  const start = Math.min(page, Math.max(0, Math.ceil(matches.length / 100) - 1)) * 100;
  return (
    <section aria-label="Discovered Java tests" className="flex flex-col gap-2">
      <h3 className="font-semibold">Discovered tests</h3>
      <p role="status">
        Discovery: {discovery.status}.{" "}
        {discovery.tests.filter((test) => test.kind === "class").length} classes,{" "}
        {discovery.tests.filter((test) => test.kind === "method").length} method-name groups.
      </p>
      <p>
        {discovery.scope === "test-task"
          ? "Gradle's configured test task in dry-run mode."
          : discovery.buildTool === "jdk"
            ? "JUnit Platform engines, JUnit 4 and TestNG on the manually supplied classpath. A selection runs through its matching test framework."
            : "JUnit and TestNG runners on Maven's compiled test classpath; Surefire include/exclude patterns, groups, suite XML, engine settings and argLine are not applied."}{" "}
        Discovery compiles code and may initialize custom runners. Test bodies are not run.
      </p>
      <p>
        A selection uses this session's project, JDK and test settings after saving current edits.
        Discover again to use changed settings. A method-name group runs every matching overload and
        parameterized invocation. Individual invocations and dynamic cases cannot be selected
        separately here.
      </p>
      {discovery.message && (
        <p role={discovery.status === "unavailable" ? "alert" : "status"}>{discovery.message}</p>
      )}
      {sourceError && <p role="status">{sourceError}</p>}
      {discovery.tests.length > 0 && (
        <>
          <label>
            Search discovered tests
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
            Discovered test kind
            <select
              value={kind}
              className="w-full rounded border bg-[var(--surface-editor)] p-1"
              onChange={(event) => {
                setKind(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">Classes and method-name groups</option>
              <option value="class">Classes</option>
              <option value="method">Method-name groups</option>
            </select>
          </label>
          <p role="status">
            {matches.length
              ? `Showing ${start + 1}–${Math.min(start + 100, matches.length)} of ${matches.length} matching selections.`
              : "No matching discovered tests."}{" "}
            Filters change this view only. Run and coverage use the selected class or method-name
            group with the settings from this discovery.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={start === 0}
              onClick={() => setPage(Math.max(0, start / 100 - 1))}
            >
              Previous discovered tests
            </button>
            <button
              type="button"
              disabled={start + 100 >= matches.length}
              onClick={() => setPage(start / 100 + 1)}
            >
              Next discovered tests
            </button>
          </div>
          <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
            {matches.slice(start, start + 100).map(({ test }) => (
              <li
                key={test.id}
                className={`flex items-center gap-2 ${test.kind === "method" ? "pl-4" : "font-semibold"}`}
              >
                <span className="min-w-0 break-all">
                  <span>{test.label}</span>
                  {test.kind === "method" && (
                    <span className="block text-xs">Method-name group</span>
                  )}
                  {test.displayNames && (
                    <details className="text-xs">
                      <summary>Discovered display names ({test.displayNameCount})</summary>
                      <ul>
                        {test.displayNames.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                      {test.displayNameCount! > test.displayNames.length && (
                        <p>
                          Showing the first {test.displayNames.length} names. These are discovery
                          labels, not an execution count.
                        </p>
                      )}
                    </details>
                  )}
                  {test.label !==
                    `${test.className}${test.methodName ? `#${test.methodName}` : ""}` && (
                    <span className="block text-xs font-normal text-[var(--text-secondary)]">
                      {test.className}
                      {test.methodName ? `#${test.methodName}` : ""}
                    </span>
                  )}
                </span>
                {openTestSource && test.kind === "class" && (
                  <button
                    type="button"
                    className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40"
                    disabled={openingTestId !== null}
                    aria-label={`Open test class ${test.className}`}
                    onClick={() => void openSource(test)}
                  >
                    {openingTestId === test.id ? "Opening test class…" : "Open test class"}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40"
                  disabled={disabled || discovery.status !== "ready"}
                  aria-label={`Run ${test.kind === "method" ? "method group" : "class"} ${test.className}${test.methodName ? `#${test.methodName}` : ""}`}
                  onClick={() => run(test.id)}
                >
                  Run {test.kind === "method" ? "method group" : "class"}
                </button>
                {debug && (
                  <button
                    type="button"
                    className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40"
                    disabled={disabled || discovery.status !== "ready"}
                    aria-label={`Debug ${test.kind === "method" ? "method group" : "class"} ${test.className}${test.methodName ? `#${test.methodName}` : ""}`}
                    onClick={() => debug(test.id)}
                  >
                    Debug {test.kind === "method" ? "method group" : "class"}
                  </button>
                )}
                {cover && (
                  <button
                    type="button"
                    className="rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40"
                    disabled={disabled || discovery.status !== "ready"}
                    aria-label={`Cover ${test.kind === "method" ? "method group" : "class"} ${test.className}${test.methodName ? `#${test.methodName}` : ""}`}
                    onClick={() => cover(test.id)}
                  >
                    Run with coverage
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
