import { describe, expect, it } from "vitest";
import { normalizeJavaCoverage } from "./java-coverage";
import { coverage } from "./java-coverage.test-fixtures";
describe("measured coverage boundary", () => {
  it("admits fresh measurements even when tests fail, without deriving coverage from their outcome", () => {
    expect(normalizeJavaCoverage(coverage(), "failed")).toEqual(coverage());
  });
  it("preserves bounded native test selection facts and rejects inconsistent summaries", () => {
    const data = coverage();
    const selection = {
      sourceSet: "integrationTest",
      selectorCount: 4,
      selectors: ["ExampleTest#first", "ExampleTest#second", "OtherTest"],
    };
    expect(normalizeJavaCoverage({ ...data, testSelection: selection }, "succeeded").testSelection)
      .toEqual(selection);
    for (const testSelection of [
      { ...selection, selectorCount: 2 },
      { ...selection, selectorCount: 257 },
      { ...selection, selectors: ["ExampleTest#first\n", "OtherTest", "MoreTest"] },
      { ...selection, sourceSet: "a".repeat(513) },
    ]) expect(() => normalizeJavaCoverage({ ...data, testSelection }, "succeeded")).toThrow();
  });
  it("refuses malformed totals, source lines, paths, duplicate scopes and mismatched lifecycle", () => {
    const valid = coverage();
    for (const data of [
      { ...valid, provider: "guessed" },
      { ...valid, reports: 0 },
      { ...valid, projectPath: "../outside" },
      { ...valid, status: "collecting" },
      { ...valid, files: [valid.files[0], valid.files[0]] },
      { ...valid, files: [{ ...valid.files[0], name: "../Choice.java" }] },
      { ...valid, counters: { ...valid.counters, lines: { missed: 0, covered: 0 } } },
      { ...valid, files: [{ ...valid.files[0], lines: [...valid.files[0].lines].reverse() }] },
      {
        ...valid,
        files: [{ ...valid.files[0], lines: [{ ...valid.files[0].lines[0], number: 0 }] }],
      },
      { ...valid, status: "partial", message: null },
    ])
      expect(() => normalizeJavaCoverage(data, "succeeded")).toThrow("coverage results");
    expect(() => normalizeJavaCoverage(valid, "running")).toThrow();
  });
  it("requires empty measurements for stopped/unavailable or still collecting sessions", () => {
    const zero = { missed: 0, covered: 0 };
    const data = {
      ...coverage(),
      files: [],
      reports: 0,
      counters: { instructions: zero, branches: zero, lines: zero },
    };
    expect(normalizeJavaCoverage({ ...data, status: "collecting" }, "running").status).toBe(
      "collecting",
    );
    expect(
      normalizeJavaCoverage({ ...data, status: "unavailable", message: "Stopped." }, "stopped")
        .status,
    ).toBe("unavailable");
  });
});
