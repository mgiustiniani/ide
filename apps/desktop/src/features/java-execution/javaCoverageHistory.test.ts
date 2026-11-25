import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearJavaCoverageHistory,
  javaCoverageHistoryKey,
  loadJavaCoverageHistory,
  MAX_COVERAGE_HISTORY_BYTES,
  saveJavaCoverageHistory,
  type JavaCoverageHistoryEntry,
} from "./javaCoverageHistory";
function entry(): JavaCoverageHistoryEntry {
  return {
    id: "first-app:run",
    sessionId: "run",
    completedAt: "2026-11-12T12:00:00.000Z",
    configurationName: "Tests",
    operation: "coverage",
    executionState: "succeeded",
    projectPath: "app",
    buildTool: "maven",
    status: "ready",
    counters: {
      lines: { covered: 1, missed: 2 },
      branches: { covered: 1, missed: 1 },
      instructions: { covered: 3, missed: 2 },
    },
    reports: 1,
    files: 1,
    tests: 2,
  };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("Saved Java coverage summaries", () => {
  it("round-trips bounded summaries only under their workspace key", () => {
    const selected = {
      ...entry(),
      id: "selected-run",
      testSelection: { sourceSet: null, selectorCount: 1, selectors: ["ExampleTest#first"] },
    };
    const entries = [selected, entry()];
    expect(saveJavaCoverageHistory("one", entries)).toBeNull();
    expect(loadJavaCoverageHistory("one")).toEqual({ entries, error: null });
    expect(loadJavaCoverageHistory("two")).toEqual({ entries: [], error: null });
    expect(clearJavaCoverageHistory("one")).toBeNull();
    expect(loadJavaCoverageHistory("one").entries).toEqual([]);
  });
  it("rejects unknown versions, duplicate sessions and more than ten entries", () => {
    for (const value of [
      { version: 2, entries: [entry()] },
      { version: 1, entries: [entry(), entry()] },
      {
        version: 1,
        entries: Array.from({ length: 11 }, (_, index) => ({
          ...entry(),
          sessionId: String(index),
        })),
      },
    ]) {
      localStorage.setItem(javaCoverageHistoryKey("one"), JSON.stringify(value));
      expect(loadJavaCoverageHistory("one").error).toBeTruthy();
      expect(loadJavaCoverageHistory("one").entries).toEqual([]);
    }
  });
  it("refuses malformed counters, incomplete runs and extra authority fields", () => {
    for (const invalid of [
      { ...entry(), sourcePaths: ["app/Main.java"] },
      { ...entry(), testSelection: { sourceSet: null, selectorCount: 0, selectors: ["ExampleTest"] } },
      { ...entry(), executionState: "running" },
      { ...entry(), operation: "debug" },
      { ...entry(), reports: 129 },
      { ...entry(), files: 2001 },
      { ...entry(), completedAt: "invalid" },
      { ...entry(), counters: { ...entry().counters, lines: { covered: -1, missed: 0 } } },
      {
        ...entry(),
        counters: { ...entry().counters, lines: { covered: Number.MAX_SAFE_INTEGER, missed: 1 } },
      },
    ]) {
      localStorage.setItem(
        javaCoverageHistoryKey("one"),
        JSON.stringify({ version: 1, entries: [invalid] }),
      );
      expect(loadJavaCoverageHistory("one").error).toBeTruthy();
      expect(loadJavaCoverageHistory("one").entries).toEqual([]);
    }
  });
  it("bounds raw storage and reports unavailable storage without fabricating measurements", () => {
    localStorage.setItem(javaCoverageHistoryKey("one"), " ".repeat(MAX_COVERAGE_HISTORY_BYTES + 1));
    expect(loadJavaCoverageHistory("one").error).toBeTruthy();
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(loadJavaCoverageHistory("one")).toMatchObject({
      entries: [],
      error: expect.any(String),
    });
  });
  it("reports save and clear failures", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Quota");
    });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(saveJavaCoverageHistory("one", [entry()])).toMatch(/could not be saved/);
    expect(clearJavaCoverageHistory("one")).toMatch(/could not be cleared/);
  });
});
