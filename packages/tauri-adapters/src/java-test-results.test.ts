import { describe, expect, it } from "vitest";
import { normalizeJavaTestResults } from "./java-test-results";
import { reports } from "./java-test-results.test-fixtures";

describe("native structured Java test result validation", () => {
  it("accepts fresh JUnit results from a plain-JDK execution", () => {
    expect(normalizeJavaTestResults({ ...reports(), buildTool: "jdk" }, "succeeded").buildTool).toBe(
      "jdk",
    );
  });
  it("retains reported failures independently from the build tool exit state", () => {
    for (const state of ["failed", "succeeded"])
      expect(normalizeJavaTestResults(reports(), state)).toEqual(reports());
  });
  it.each([
    { summary: { ...reports().summary, total: 3 } },
    { status: "imaginary" },
    { status: "collecting" },
    { projectPath: "../external" },
    { buildTool: "RefactorKit" },
    { unchangedReports: -1 },
    { canRerunFailed: "yes" },
    { status: "partial", message: null, canRerunFailed: false },
    { suites: [{ ...reports().suites[0], reportPath: "/tmp/TEST-X.xml" }] },
    {
      suites: [
        {
          ...reports().suites[0],
          cases: [reports().suites[0].cases[0], reports().suites[0].cases[0]],
        },
      ],
    },
    {
      suites: [
        {
          ...reports().suites[0],
          cases: [
            { ...reports().suites[0].cases[0], durationMs: NaN },
            reports().suites[0].cases[1],
          ],
        },
      ],
    },
    {
      suites: [
        {
          ...reports().suites[0],
          cases: [
            { ...reports().suites[0].cases[0], detail: "😀".repeat(4097) },
            reports().suites[0].cases[1],
          ],
        },
      ],
    },
    {
      suites: [
        {
          ...reports().suites[0],
          cases: [
            { ...reports().suites[0].cases[0], state: "unknown" },
            reports().suites[0].cases[1],
          ],
        },
      ],
    },
  ])("rejects invalid counts, identity, paths and bounded data", (override) => {
    expect(() => normalizeJavaTestResults({ ...reports(), ...override }, "failed")).toThrow(
      "Invalid",
    );
  });
  it("exposes partial evidence and unavailable old reports without authorizing rerun", () => {
    const partial = {
      ...reports(),
      status: "partial",
      message: "A report was malformed.",
      canRerunFailed: false,
      rerunReason: "Incomplete results.",
    };
    expect(normalizeJavaTestResults(partial, "failed")).toEqual(partial);
    expect(() =>
      normalizeJavaTestResults({ ...partial, canRerunFailed: true }, "failed"),
    ).toThrow();
    const unavailable = {
      ...reports(),
      status: "unavailable",
      suites: [],
      summary: { total: 0, passed: 0, failed: 0, error: 0, skipped: 0, flaky: 0 },
      message: "No fresh cases.",
      unchangedReports: 1,
      canRerunFailed: false,
      rerunReason: "Fresh results required.",
    };
    expect(normalizeJavaTestResults(unavailable, "failed")).toEqual(unavailable);
    expect(() => normalizeJavaTestResults({ ...reports() }, "running")).toThrow();
  });
});

it("validates explicit failed-method and whole-class selections without deriving method identities", () => {
  const base = reports();
  const className = base.suites[0].cases.find((test) => test.state === "failed" || test.state === "error")!.className;
  for (const methodName of [null, "fails"]) {
    const value = { ...base, rerunSelections: [{ className, methodName }] };
    expect(normalizeJavaTestResults(value, "failed").rerunSelections).toEqual(value.rerunSelections);
  }
  for (const selections of [[], [{ className: "OtherTest", methodName: null }], [{ className, methodName: "fails()" }], [{ className, methodName: null }, { className, methodName: "fails" }], [{ className, methodName: "fails" }, { className, methodName: "fails" }], Array.from({ length: 257 }, () => ({ className, methodName: "fails" }))]) {
    expect(() => normalizeJavaTestResults({ ...base, rerunSelections: selections }, "failed")).toThrow();
  }
});

it("accepts optional runner method identities and refuses malformed or unsupported provenance", () => {
  const base = { ...reports(), buildTool: "gradle" };
  const withSource = (methodSource: unknown) => ({ ...base, suites: base.suites.map((suite) => ({
    ...suite, cases: suite.cases.map((test) => ({ ...test, methodSource })),
  })) });
  const source = { className: "fixture.Base$Nested", methodName: "actualMethod", declaringClassName: "fixture.Parent" };
  expect(normalizeJavaTestResults(withSource(source), "failed").suites[0].cases[0].methodSource).toEqual(source);
  expect(normalizeJavaTestResults(base, "failed").suites[0].cases[0].methodSource).toBeUndefined();
  const origins = {
    ...source,
    testOrigin: { path: "app/build/classes/java/test", kind: "directory" },
    declaringOrigin: { path: "base/build/libs/base.jar", kind: "archive" },
  };
  expect(normalizeJavaTestResults(withSource(origins), "failed").suites[0].cases[0].methodSource).toEqual(origins);
  for (const origin of [null, [], {}, { path: "", kind: "directory" },
    { path: "/tmp/external.jar", kind: "archive" }, { path: "../base.jar", kind: "archive" },
    { path: "base/./classes", kind: "directory" }, { path: "base\\classes", kind: "directory" },
    { path: "C:/classes", kind: "directory" }, { path: "base/classes", kind: "source" },
    { path: "base/classes", kind: "directory", moduleId: ":base" }]) {
    for (const field of ["testOrigin", "declaringOrigin"]) {
      expect(() => normalizeJavaTestResults(withSource({ ...source, [field]: origin }), "failed")).toThrow();
    }
  }
  expect(() => normalizeJavaTestResults(withSource({ ...origins, declaringClassName: undefined }), "failed")).toThrow();
  for (const invalid of [null, [], {}, { ...source, declaringClassName: null }, { ...source, declaringClassName: "Parent#method" }, { ...source, declaringClassName: "" }, { ...source, className: "../Other" },
    { ...source, className: "Owner#method" }, { ...source, methodName: "display()" },
    { ...source, methodName: "Owner.method" }, { ...source, methodName: "x".repeat(513) }]) {
    expect(() => normalizeJavaTestResults(withSource(invalid), "failed")).toThrow();
  }
  expect(() => normalizeJavaTestResults({ ...withSource(source), buildTool: "maven" }, "failed")).toThrow();
  expect(() => normalizeJavaTestResults({ ...withSource(source), status: "partial", canRerunFailed: false, message: "Incomplete" }, "failed")).toThrow();
});
