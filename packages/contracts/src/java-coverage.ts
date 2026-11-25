/** Measured JaCoCo counters; a zero denominator has no coverage percentage. */
export interface JavaCoverageCounter {
  missed: number;
  covered: number;
}
export interface JavaCoverageCounters {
  instructions: JavaCoverageCounter;
  branches: JavaCoverageCounter;
  lines: JavaCoverageCounter;
}
export interface JavaCoverageLine {
  number: number;
  missedInstructions: number;
  coveredInstructions: number;
  missedBranches: number;
  coveredBranches: number;
}
export interface JavaCoverageFile {
  id: string;
  reportPath: string;
  /** Workspace-relative Gradle module root that produced this report, when known. */
  moduleRoot?: string | null;
  packageName: string;
  name: string;
  counters: JavaCoverageCounters;
  lines: JavaCoverageLine[];
}
export interface JavaCoverageTestSelection {
  sourceSet: string | null;
  selectorCount: number;
  /** Up to three selectors from the actual invocation, in build-tool order. */
  selectors: string[];
}

export function isJavaCoverageTestSelection(value: unknown): value is JavaCoverageTestSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selection = value as Partial<JavaCoverageTestSelection>;
  const { selectorCount, selectors, sourceSet } = selection;
  const text = (input: unknown) => typeof input === "string" && input.length > 0 &&
    !/[\x00-\x1f\x7f]/.test(input) && new TextEncoder().encode(input).length <= 512;
  return Object.keys(selection).sort().join(",") === "selectorCount,selectors,sourceSet" &&
    typeof selectorCount === "number" && Number.isSafeInteger(selectorCount) &&
    selectorCount >= 0 && selectorCount <= 256 &&
    Array.isArray(selectors) && selectors.length === Math.min(selectorCount, 3) && selectors.every(text) &&
    (sourceSet === null || text(sourceSet));
}

export interface JavaCoverageResults {
  status: "collecting" | "ready" | "partial" | "unavailable";
  provider: "jacoco";
  version: string;
  projectPath: string;
  buildTool: "maven" | "gradle";
  testSelection?: JavaCoverageTestSelection;
  counters: JavaCoverageCounters;
  files: JavaCoverageFile[];
  reports: number;
  message: string | null;
}
