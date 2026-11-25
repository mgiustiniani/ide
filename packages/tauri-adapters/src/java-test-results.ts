import { isConcreteJavaTestFilter, isJavaRuntimeIdentifier } from "@ide/contracts";
import type { JavaTestCaseResult, JavaTestResults } from "@ide/contracts";

const states = ["passed", "failed", "error", "skipped", "flaky"] as const;
function invalid(): never {
  throw new Error("Invalid or oversized Java test results.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function bounded(value: unknown, bytes: number, empty = true): value is string {
  return (
    typeof value === "string" &&
    (empty || value.length > 0) &&
    !value.includes("\0") &&
    new TextEncoder().encode(value).length <= bytes
  );
}
function relative(value: unknown, directory = false): value is string {
  return (
    bounded(value, 4096, directory) &&
    !value.includes("\\") &&
    !value.includes(":") &&
    ((directory && value === "") ||
      value.split("/").every((part) => part !== "" && part !== "." && part !== ".."))
  );
}
export function normalizeJavaTestResults(value: unknown, executionState: string): JavaTestResults {
  const data = object(value);
  if (
    !bounded(JSON.stringify(data), 8 * 1024 * 1024) ||
    !["collecting", "ready", "partial", "unavailable"].includes(String(data.status)) ||
    !["jdk", "maven", "gradle"].includes(String(data.buildTool)) ||
    !relative(data.projectPath, true) ||
    !Array.isArray(data.suites) ||
    data.suites.length > 2048 ||
    !Number.isSafeInteger(data.unchangedReports) ||
    Number(data.unchangedReports) < 0 ||
    Number(data.unchangedReports) > 512 ||
    typeof data.canRerunFailed !== "boolean" ||
    !(data.message === null || bounded(data.message, 4096, false)) ||
    !(data.rerunReason === null || bounded(data.rerunReason, 4096, false))
  )
    return invalid();
  const summary = object(data.summary);
  const observed: Record<JavaTestCaseResult["state"] | "total", number> = {
    total: 0,
    passed: 0,
    failed: 0,
    error: 0,
    skipped: 0,
    flaky: 0,
  };
  const ids = new Set<string>();
  for (const item of data.suites) {
    const suite = object(item);
    if (
      !relative(suite.reportPath) ||
      !bounded(suite.name, 4096, false) ||
      !Array.isArray(suite.cases)
    )
      return invalid();
    for (const item of suite.cases) {
      const test = object(item);
      if (
        !bounded(test.id, 128, false) ||
        ids.has(test.id) ||
        !bounded(test.name, 4096, false) ||
        !bounded(test.className, 512) ||
        !states.includes(test.state as (typeof states)[number]) ||
        !bounded(test.detail, 16384) ||
        typeof test.detailTruncated !== "boolean" ||
        !(
          test.durationMs === null ||
          (typeof test.durationMs === "number" &&
            Number.isFinite(test.durationMs) &&
            test.durationMs >= 0 &&
            test.durationMs <= 1e12)
        )
      )
        return invalid();
      if (test.methodSource !== undefined) {
        const source = object(test.methodSource);
        if (data.status !== "ready" || data.buildTool !== "gradle" || test.state === "flaky" ||
            !bounded(source.className, 512, false) || !bounded(source.methodName, 512, false) ||
            !isConcreteJavaTestFilter(source.className) || source.className.includes("#") ||
            !isJavaRuntimeIdentifier(source.methodName)) return invalid();
        if (source.declaringClassName !== undefined &&
            (!bounded(source.declaringClassName, 512, false) ||
             !isConcreteJavaTestFilter(source.declaringClassName) || source.declaringClassName.includes("#"))) return invalid();
        for (const field of ["testOrigin", "declaringOrigin"] as const) {
          if (source[field] === undefined) continue;
          const origin = object(source[field]);
          if (!relative(origin.path) || !["directory", "archive"].includes(String(origin.kind)) ||
              Object.keys(origin).some((key) => key !== "path" && key !== "kind") ||
              (field === "declaringOrigin" && source.declaringClassName === undefined)) return invalid();
        }
      }
      ids.add(test.id);
      observed.total++;
      observed[test.state as JavaTestCaseResult["state"]]++;
      if (observed.total > 10000) return invalid();
    }
  }
  for (const key of ["total", ...states] as const)
    if (summary[key] !== observed[key]) return invalid();
  if (
    ((data.status === "collecting" || data.status === "unavailable") &&
      (observed.total !== 0 || data.suites.length !== 0)) ||
    ((data.status === "ready" || data.status === "partial") &&
      (observed.total === 0 || !["succeeded", "failed"].includes(executionState))) ||
    (data.status === "collecting" && !["starting", "running"].includes(executionState)) ||
    (data.status !== "ready" && data.canRerunFailed) ||
    (data.canRerunFailed &&
      (observed.failed + observed.error === 0 || data.rerunReason !== null)) ||
    ((data.status === "partial" || data.status === "unavailable") && data.message === null)
  )
    return invalid();
  if (data.rerunSelections !== undefined) {
    if (!Array.isArray(data.rerunSelections) || data.rerunSelections.length > 256 ||
        (data.canRerunFailed ? data.rerunSelections.length === 0 : data.rerunSelections.length !== 0)) return invalid();
    const failedClasses = new Set((data.suites as JavaTestResults["suites"]).flatMap((suite) =>
      suite.cases.filter((test) => test.state === "failed" || test.state === "error").map((test) => test.className)));
    const seen = new Set<string>(), wholeClasses = new Set<string>();
    for (const value of data.rerunSelections) {
      const selection = object(value);
      if (!bounded(selection.className, 512, false) || !failedClasses.has(selection.className) ||
          !(selection.methodName === null || bounded(selection.methodName, 512, false))) return invalid();
      const filter = `${selection.className}${selection.methodName === null ? "" : `#${selection.methodName}`}`;
      if (!isConcreteJavaTestFilter(filter) || seen.has(filter)) return invalid();
      seen.add(filter);
      if (selection.methodName === null) wholeClasses.add(selection.className);
    }
    if (data.rerunSelections.some((value) => {
      const selection = object(value);
      return selection.methodName !== null && wholeClasses.has(String(selection.className));
    })) return invalid();
  }
  return data as unknown as JavaTestResults;
}
