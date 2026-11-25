import type { JavaProjectDeclarationConfiguration } from "@ide/contracts";
export interface JavaProjectDeclarationDraft {
  key: string;
  id: string;
  root: string;
  release: number;
  roots: string;
  generatedRoots: string;
  dependencies: string;
  output: string;
  separateRuntime: boolean;
  runtimeDependencies: string | null;
  includeTests: boolean;
  testId: string;
  testRoots: string;
  testGeneratedRoots: string;
  testDependencies: string;
  testOutput: string;
  separateTestRuntime: boolean;
  testRuntimeDependencies: string | null;
}
export function newJavaProjectDeclarationDraft(
  index = 0,
  release = 17,
): JavaProjectDeclarationDraft {
  const id = index === 0 ? "app" : `module-${index}`;
  const outputBase = index === 0 ? ".ide/java" : `.ide/java/${id}`;
  return {
    key: id,
    id,
    root: ".",
    release,
    roots: index === 0 ? "." : "",
    generatedRoots: "",
    dependencies: "",
    output: `${outputBase}/classes`,
    separateRuntime: false,
    runtimeDependencies: null,
    includeTests: false,
    testId: "test",
    testRoots: "",
    testGeneratedRoots: "",
    testDependencies: "",
    testOutput: `${outputBase}/test-classes`,
    separateTestRuntime: false,
    testRuntimeDependencies: null,
  };
}
export function javaProjectDeclarationConfiguration(
  draft: JavaProjectDeclarationDraft,
): JavaProjectDeclarationConfiguration {
  const lines = (text: string) =>
    text
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  const generatedSourceRoots = [...new Set(lines(draft.generatedRoots))];
  const sourceRoots = [...new Set([...lines(draft.roots), ...generatedSourceRoots])];
  const generatedTestRoots = [...new Set(lines(draft.testGeneratedRoots))];
  const testSourceRoots = [...new Set([...lines(draft.testRoots), ...generatedTestRoots])];
  const compileClasspath = lines(draft.dependencies);
  const runtimeClasspath = [
    ...new Set([
      draft.output,
      ...lines(
        draft.separateRuntime
          ? (draft.runtimeDependencies ?? draft.dependencies)
          : draft.dependencies,
      ),
    ]),
  ];
  if (!sourceRoots.length) throw new Error("Enter at least one source directory.");
  if (draft.includeTests && !testSourceRoots.length)
    throw new Error("Enter at least one test source directory.");
  return {
    release: draft.release,
    sourceRoots,
    ...(generatedSourceRoots.length ? { generatedSourceRoots } : {}),
    compileClasspath,
    runtimeClasspath,
    outputDirectory: draft.output,
    ...(draft.includeTests
      ? {
          testSourceSet: {
            id: draft.testId.trim(),
            sourceRoots: testSourceRoots,
            ...(generatedTestRoots.length ? { generatedSourceRoots: generatedTestRoots } : {}),
            compileClasspath: [
              ...new Set([draft.output, ...compileClasspath, ...lines(draft.testDependencies)]),
            ],
            runtimeClasspath: [
              ...new Set([
                draft.testOutput,
                ...runtimeClasspath,
                ...lines(
                  draft.separateTestRuntime
                    ? (draft.testRuntimeDependencies ?? draft.testDependencies)
                    : draft.testDependencies,
                ),
              ]),
            ],
            outputDirectory: draft.testOutput,
          },
        }
      : {}),
  };
}
export function JavaProjectDeclarationModuleFields({
  value,
  onChange,
  pending,
  additional = false,
}: {
  value: JavaProjectDeclarationDraft;
  onChange(value: JavaProjectDeclarationDraft): void;
  pending: boolean;
  additional?: boolean;
}) {
  const {
    roots,
    generatedRoots,
    dependencies,
    output,
    release,
    separateRuntime,
    runtimeDependencies,
    separateTestRuntime,
    testRuntimeDependencies,
    includeTests,
    testId,
    testRoots,
    testGeneratedRoots,
    testDependencies,
    testOutput,
  } = value;
  const setRoots = (next: JavaProjectDeclarationDraft["roots"]) =>
    onChange({ ...value, roots: next });
  const setGeneratedRoots = (next: JavaProjectDeclarationDraft["generatedRoots"]) =>
    onChange({ ...value, generatedRoots: next });
  const setDependencies = (next: JavaProjectDeclarationDraft["dependencies"]) =>
    onChange({ ...value, dependencies: next });
  const setOutput = (next: JavaProjectDeclarationDraft["output"]) =>
    onChange({ ...value, output: next });
  const setRelease = (next: JavaProjectDeclarationDraft["release"]) =>
    onChange({ ...value, release: next });
  const setRuntimeDependencies = (next: JavaProjectDeclarationDraft["runtimeDependencies"]) =>
    onChange({ ...value, runtimeDependencies: next });
  const setTestRuntimeDependencies = (
    next: JavaProjectDeclarationDraft["testRuntimeDependencies"],
  ) => onChange({ ...value, testRuntimeDependencies: next });
  const setIncludeTests = (next: JavaProjectDeclarationDraft["includeTests"]) =>
    onChange({ ...value, includeTests: next });
  const setTestId = (next: JavaProjectDeclarationDraft["testId"]) =>
    onChange({ ...value, testId: next });
  const setTestRoots = (next: JavaProjectDeclarationDraft["testRoots"]) =>
    onChange({ ...value, testRoots: next });
  const setTestGeneratedRoots = (next: JavaProjectDeclarationDraft["testGeneratedRoots"]) =>
    onChange({ ...value, testGeneratedRoots: next });
  const setTestDependencies = (next: JavaProjectDeclarationDraft["testDependencies"]) =>
    onChange({ ...value, testDependencies: next });
  const setTestOutput = (next: JavaProjectDeclarationDraft["testOutput"]) =>
    onChange({ ...value, testOutput: next });
  return (
    <>
      {additional && (
        <>
          <label>
            Module name
            <input
              disabled={pending}
              value={value.id}
              onChange={(event) => onChange({ ...value, id: event.target.value })}
            />
          </label>
          <label>
            Module root directory
            <input
              disabled={pending}
              value={value.root}
              onChange={(event) => onChange({ ...value, root: event.target.value })}
            />
          </label>
          <p>
            All paths are relative to the project directory. Place this module's sources and output
            under its root; keep source directories separate from other modules.
          </p>
        </>
      )}
      <label>
        Java release
        <select
          disabled={pending}
          value={release}
          onChange={(event) => setRelease(Number(event.target.value))}
        >
          {[8, 11, 17, 21, 25, 26, 27].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source directories, one per line
        <textarea
          disabled={pending}
          value={roots}
          onChange={(event) => setRoots(event.target.value)}
        />
      </label>
      <p>
        Use project-relative paths. A single dot selects the project directory. Only these roots are
        compiled.
      </p>
      <label>
        Generated source directories, one per line
        <textarea
          disabled={pending}
          value={generatedRoots}
          onChange={(event) => setGeneratedRoots(event.target.value)}
        />
      </label>
      <p>
        Generated directories are included in compilation. Generate their files before
        synchronization; this form does not run generators.
      </p>
      <label>
        {separateRuntime
          ? "Compilation dependencies, one per line"
          : "Dependencies for compilation and execution, one per line"}
        <textarea
          disabled={pending}
          value={dependencies}
          onChange={(event) => setDependencies(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          disabled={pending}
          checked={separateRuntime}
          onChange={(event) => {
            onChange({
              ...value,
              separateRuntime: event.target.checked,
              runtimeDependencies:
                event.target.checked && runtimeDependencies === null
                  ? dependencies
                  : runtimeDependencies,
            });
          }}
        />
        Use separate runtime dependencies
      </label>
      {separateRuntime && (
        <label>
          Runtime dependencies, one per line
          <textarea
            disabled={pending}
            value={runtimeDependencies ?? dependencies}
            onChange={(event) => setRuntimeDependencies(event.target.value)}
          />
        </label>
      )}
      <label>
        Class output directory
        <input
          disabled={pending}
          value={output}
          onChange={(event) => setOutput(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          disabled={pending}
          checked={includeTests}
          onChange={(event) => setIncludeTests(event.target.checked)}
        />
        Include a test source set
      </label>
      {includeTests && (
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <legend>Test sources and dependencies</legend>
          <label>
            Test source-set name
            <input value={testId} onChange={(event) => setTestId(event.target.value)} />
          </label>
          <label>
            Test source directories, one per line
            <textarea value={testRoots} onChange={(event) => setTestRoots(event.target.value)} />
          </label>
          <label>
            Generated test source directories, one per line
            <textarea
              value={testGeneratedRoots}
              onChange={(event) => setTestGeneratedRoots(event.target.value)}
            />
          </label>
          <label>
            {separateTestRuntime
              ? "Additional test compilation dependencies, one per line"
              : "Additional test dependencies, one per line"}
            <textarea
              value={testDependencies}
              onChange={(event) => setTestDependencies(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={separateTestRuntime}
              onChange={(event) => {
                onChange({
                  ...value,
                  separateTestRuntime: event.target.checked,
                  testRuntimeDependencies:
                    event.target.checked && testRuntimeDependencies === null
                      ? testDependencies
                      : testRuntimeDependencies,
                });
              }}
            />
            Use separate test runtime dependencies
          </label>
          {separateTestRuntime && (
            <label>
              Additional test runtime dependencies, one per line
              <textarea
                value={testRuntimeDependencies ?? testDependencies}
                onChange={(event) => setTestRuntimeDependencies(event.target.value)}
              />
            </label>
          )}
          <label>
            Test class output directory
            <input value={testOutput} onChange={(event) => setTestOutput(event.target.value)} />
          </label>
          <p>
            Keep main and test source directories separate. Tests use the same Java release, the
            main class output and its corresponding compile or runtime dependencies. Add your JUnit
            or TestNG libraries as test dependencies. Build the main source set before running
            tests.
          </p>
        </fieldset>
      )}
      <p>
        Each output directory is included in its runtime classpath. Separate runtime lists replace
        compilation dependencies at execution time; test runtime entries extend the main runtime
        classpath. To use another module, include its output directory in the required dependency
        lists and build that module first. Existing declarations are preserved.
      </p>
    </>
  );
}
