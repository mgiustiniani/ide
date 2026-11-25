import { isJavaCoverageTestSelection } from "@ide/contracts";
import type { JavaCoverageCounters, JavaCoverageTestSelection } from "@ide/contracts";

export interface JavaCoverageHistoryEntry {
  id: string;
  sessionId: string;
  completedAt: string;
  configurationName: string | null;
  operation: "coverage" | "integration-coverage";
  executionState: "succeeded" | "failed";
  projectPath: string;
  buildTool: "maven" | "gradle";
  testSelection?: JavaCoverageTestSelection;
  status: "ready" | "partial";
  counters: JavaCoverageCounters;
  reports: number;
  files: number;
  tests: number | null;
}
export const MAX_COVERAGE_HISTORY_BYTES = 128 * 1024;
export function javaCoverageHistoryKey(workspaceId: string): string {
  return `ide.java.coverage-history.v1.${workspaceId}`;
}
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  !value.includes("\0") &&
  new TextEncoder().encode(value).length <= limit;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
function validEntry(value: unknown): value is JavaCoverageHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as JavaCoverageHistoryEntry;
  if (
    Object.keys(item).filter((key) => key !== "testSelection").sort().join(",") !==
      "buildTool,completedAt,configurationName,counters,executionState,files,id,operation,projectPath,reports,sessionId,status,tests" ||
    (item.testSelection !== undefined && !isJavaCoverageTestSelection(item.testSelection)) ||
    !text(item.id, 512) ||
    !item.id ||
    !text(item.sessionId, 256) ||
    !item.sessionId ||
    !text(item.completedAt, 32) ||
    !Number.isFinite(Date.parse(item.completedAt)) ||
    new Date(item.completedAt).toISOString() !== item.completedAt ||
    (item.configurationName !== null && !text(item.configurationName, 256)) ||
    !["coverage", "integration-coverage"].includes(item.operation) ||
    !["succeeded", "failed"].includes(item.executionState) ||
    !["maven", "gradle"].includes(item.buildTool) ||
    !["ready", "partial"].includes(item.status) ||
    !text(item.projectPath, 4096) ||
    !integer(item.reports, 128) ||
    !integer(item.files, 2000) ||
    (item.tests !== null && !integer(item.tests)) ||
    !item.counters ||
    Object.keys(item.counters).sort().join(",") !== "branches,instructions,lines"
  )
    return false;
  return (["lines", "branches", "instructions"] as const).every((kind) => {
    const counter = item.counters[kind];
    return (
      counter &&
      Object.keys(counter).sort().join(",") === "covered,missed" &&
      integer(counter.covered) &&
      integer(counter.missed) &&
      integer(counter.covered + counter.missed)
    );
  });
}
function parseHistory(raw: string): JavaCoverageHistoryEntry[] {
  if (new TextEncoder().encode(raw).length > MAX_COVERAGE_HISTORY_BYTES)
    throw new Error("Oversized history");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid history");
  const stored = value as { version?: unknown; entries?: unknown };
  if (
    Object.keys(stored).sort().join(",") !== "entries,version" ||
    stored.version !== 1 ||
    !Array.isArray(stored.entries) ||
    stored.entries.length > 10 ||
    !stored.entries.every(validEntry) ||
    new Set(stored.entries.map((entry) => entry.id)).size !== stored.entries.length
  )
    throw new Error("Invalid history");
  return stored.entries;
}
export function loadJavaCoverageHistory(workspaceId: string): {
  entries: JavaCoverageHistoryEntry[];
  error: string | null;
} {
  try {
    const raw = localStorage.getItem(javaCoverageHistoryKey(workspaceId));
    return { entries: raw === null ? [] : parseHistory(raw), error: null };
  } catch {
    return {
      entries: [],
      error:
        "Saved coverage history could not be restored. New measurements remain available for this session.",
    };
  }
}
export function saveJavaCoverageHistory(
  workspaceId: string,
  entries: readonly JavaCoverageHistoryEntry[],
): string | null {
  try {
    const raw = JSON.stringify({ version: 1, entries });
    parseHistory(raw);
    localStorage.setItem(javaCoverageHistoryKey(workspaceId), raw);
    return null;
  } catch {
    return "Coverage history could not be saved. These measurements remain available for this session.";
  }
}
export function clearJavaCoverageHistory(workspaceId: string): string | null {
  try {
    localStorage.removeItem(javaCoverageHistoryKey(workspaceId));
    return null;
  } catch {
    return "Saved coverage history could not be cleared. It may return when this workspace is reopened.";
  }
}
