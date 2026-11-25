import type {
  JavaCoverageCounter,
  JavaCoverageCounters,
  JavaCoverageResults,
} from "@ide/contracts";
import { isJavaCoverageTestSelection } from "@ide/contracts";

function invalid(): never {
  throw new Error("Invalid or oversized Java coverage results.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" &&
  (empty || value.length > 0) &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  new TextEncoder().encode(value).length <= max;
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000;
const relative = (value: unknown, empty = false): value is string =>
  text(value, 4096, empty) &&
  !value.includes("\\") &&
  ((empty && value === "") || value.split("/").every((p) => p !== "" && p !== "." && p !== ".."));
function counters(value: unknown): JavaCoverageCounters {
  const data = object(value);
  for (const key of ["instructions", "branches", "lines"]) {
    const counter = object(data[key]);
    if (!count(counter.missed) || !count(counter.covered)) return invalid();
  }
  return data as unknown as JavaCoverageCounters;
}
const total = (c: JavaCoverageCounter) => c.missed + c.covered;

export function normalizeJavaCoverage(value: unknown, state: string): JavaCoverageResults {
  const data = object(value);
  if (
    new TextEncoder().encode(JSON.stringify(data)).length > 32 * 1024 * 1024 ||
    !["collecting", "ready", "partial", "unavailable"].includes(String(data.status)) ||
    data.provider !== "jacoco" ||
    data.version !== "0.8.15" ||
    !["maven", "gradle"].includes(String(data.buildTool)) ||
    !relative(data.projectPath, true) ||
    (data.testSelection !== undefined && !isJavaCoverageTestSelection(data.testSelection)) ||
    !Array.isArray(data.files) ||
    data.files.length > 2000 ||
    !count(data.reports) ||
    data.reports > 128 ||
    !(data.message === null || text(data.message, 4096))
  )
    return invalid();
  const measured = counters(data.counters);
  const ids = new Set<string>();
  const reportIds = new Set<string>();
  const sums: JavaCoverageCounters = {
    instructions: { missed: 0, covered: 0 },
    branches: { missed: 0, covered: 0 },
    lines: { missed: 0, covered: 0 },
  };
  let lines = 0;
  for (const item of data.files) {
    const file = object(item);
    if (
      !relative(file.reportPath) ||
      !(file.moduleRoot === undefined || file.moduleRoot === null || relative(file.moduleRoot, true)) ||
      !relative(file.packageName, true) ||
      !text(file.name, 1024) ||
      file.name.includes("/") ||
      file.name.includes("\\") ||
      file.id !== `${file.reportPath}:${file.packageName}/${file.name}` ||
      ids.has(String(file.id)) ||
      !Array.isArray(file.lines)
    )
      return invalid();
    ids.add(String(file.id));
    reportIds.add(file.reportPath);
    const measuredFile = counters(file.counters);
    let last = 0,
      covered = 0;
    for (const item of file.lines) {
      const line = object(item);
      if (
        !count(line.number) ||
        line.number <= last ||
        ![
          line.missedInstructions,
          line.coveredInstructions,
          line.missedBranches,
          line.coveredBranches,
        ].every(count) ||
        Number(line.missedInstructions) + Number(line.coveredInstructions) === 0
      )
        return invalid();
      last = line.number;
      covered += Number(line.coveredInstructions) > 0 ? 1 : 0;
    }
    lines += file.lines.length;
    if (
      lines > 100000 ||
      measuredFile.lines.covered !== covered ||
      measuredFile.lines.missed !== file.lines.length - covered
    )
      return invalid();
    for (const kind of ["instructions", "branches", "lines"] as const)
      for (const key of ["covered", "missed"] as const) sums[kind][key] += measuredFile[kind][key];
  }
  for (const kind of ["instructions", "branches", "lines"] as const)
    for (const key of ["covered", "missed"] as const)
      if (sums[kind][key] > measured[kind][key]) return invalid();
  const available = data.status === "ready" || data.status === "partial";
  if (
    reportIds.size > data.reports ||
    (available &&
      (data.reports === 0 ||
        total(measured.instructions) === 0 ||
        !["succeeded", "failed"].includes(state))) ||
    (!available &&
      (data.reports !== 0 ||
        data.files.length !== 0 ||
        Object.values(measured).some((c) => total(c) !== 0))) ||
    (data.status === "collecting" && !["starting", "running"].includes(state)) ||
    (data.status === "partial" && state !== "failed") ||
    (["partial", "unavailable"].includes(String(data.status)) && data.message === null)
  )
    return invalid();
  return data as unknown as JavaCoverageResults;
}
