import { describe, expect, it } from "vitest";
import type { JavaExecutionSnapshot } from "@ide/contracts";
import { coverage } from "../../../../../packages/tauri-adapters/src/java-coverage.test-fixtures";
import {
  checkCoverageThresholds,
  coverageThresholdError,
  emptyCoverageThresholds,
  validCoverageThresholdSettings,
} from "./javaCoverageThresholds";
const settings = { ...emptyCoverageThresholds, branches: "75" };
function snapshot(): JavaExecutionSnapshot {
  return {
    workspaceId: "one",
    generation: 1,
    sessionId: "run",
    operation: "coverage",
    state: "succeeded",
    output: "",
    outputTruncated: false,
    exitCode: 0,
    coverage: coverage(),
  };
}
describe("Java coverage threshold checks", () => {
  it("evaluates unrounded counts, keeping the actual build-tool state and exit code", () => {
    const value = snapshot();
    expect(checkCoverageThresholds(value, settings)?.status).toBe("failed");
    expect(checkCoverageThresholds(value, { ...settings, branches: "50" })?.status).toBe("passed");
    value.coverage!.counters.branches = { covered: 99999, missed: 1 };
    expect(checkCoverageThresholds(value, { ...settings, branches: "100" })?.status).toBe("failed");
    expect(value.state).toBe("succeeded");
    expect(value.exitCode).toBe(0);
  });
  it("does not pass partial, missing, stopped or zero-denominator measurements, including a zero threshold", () => {
    const value = snapshot();
    value.coverage!.status = "partial";
    expect(checkCoverageThresholds(value, settings)?.status).toBe("unavailable");
    value.coverage = undefined;
    expect(checkCoverageThresholds(value, settings)?.status).toBe("unavailable");
    value.coverage = coverage();
    value.state = "stopped";
    expect(checkCoverageThresholds(value, settings)?.status).toBe("unavailable");
    value.state = "succeeded";
    value.coverage.counters.branches = { covered: 0, missed: 0 };
    expect(checkCoverageThresholds(value, { ...settings, branches: "0" })?.status).toBe(
      "unavailable",
    );
  });
  it("distinguishes pending, disabled and non-coverage operations", () => {
    expect(checkCoverageThresholds({ ...snapshot(), state: "running" }, settings)?.status).toBe(
      "pending",
    );
    expect(checkCoverageThresholds(snapshot(), emptyCoverageThresholds)).toBeNull();
    expect(checkCoverageThresholds({ ...snapshot(), operation: "test" }, settings)).toBeNull();
  });
  it("evaluates measurements from failed tests without declaring the tests successful", () => {
    const value = { ...snapshot(), state: "failed" as const, exitCode: 1 };
    expect(checkCoverageThresholds(value, { ...settings, branches: "50" })?.status).toBe("passed");
    expect(value.state).toBe("failed");
  });
  it("allows bounded saved numeric drafts but rejects invalid complete thresholds", () => {
    expect(validCoverageThresholdSettings({ ...settings, lines: "85." })).toBe(true);
    for (const value of ["85.", ".", "101", "Infinity", "-1", "1e2", "99.999"]) {
      expect(coverageThresholdError({ ...settings, lines: value })).toBeTruthy();
    }
    expect(
      coverageThresholdError({ lines: "0", branches: "100.00", instructions: "99.99" }),
    ).toBeNull();
    expect(validCoverageThresholdSettings({ ...settings, unexpected: "1" })).toBe(false);
  });
});
