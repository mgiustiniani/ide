import type { JavaCoverageResults, JavaExecutionSnapshot } from "@ide/contracts";

export const coverageCounterKinds = ["lines", "branches", "instructions"] as const;
export type JavaCoverageThresholdSettings = Record<(typeof coverageCounterKinds)[number], string>;
export const emptyCoverageThresholds: JavaCoverageThresholdSettings = {
  lines: "",
  branches: "",
  instructions: "",
};
export function validCoverageThresholdSettings(
  value: unknown,
): value is JavaCoverageThresholdSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "branches,instructions,lines" &&
    coverageCounterKinds.every(
      (kind) => typeof record[kind] === "string" && /^\d{0,3}(?:\.\d{0,2})?$/.test(record[kind]),
    )
  );
}
export function coverageThresholdError(settings: JavaCoverageThresholdSettings): string | null {
  if (!validCoverageThresholdSettings(settings))
    return "Enter coverage percentages from 0 to 100, with at most two decimal places.";
  return coverageCounterKinds.some(
    (kind) =>
      settings[kind] !== "" &&
      (!/^\d{1,3}(?:\.\d{1,2})?$/.test(settings[kind]) || Number(settings[kind]) > 100),
  )
    ? "Enter coverage percentages from 0 to 100, with at most two decimal places."
    : null;
}
export interface JavaCoverageThresholdCheck {
  status: "pending" | "passed" | "failed" | "unavailable";
  settings: JavaCoverageThresholdSettings;
  counters: JavaCoverageResults["counters"] | null;
  message: string;
}
export function checkCoverageThresholds(
  snapshot: JavaExecutionSnapshot,
  settings: JavaCoverageThresholdSettings,
): JavaCoverageThresholdCheck | null {
  if (
    !["coverage", "integration-coverage"].includes(snapshot.operation) ||
    coverageCounterKinds.every((kind) => settings[kind] === "")
  )
    return null;
  const invalid = coverageThresholdError(settings);
  if (invalid) return { status: "unavailable", settings, counters: null, message: invalid };
  if (["starting", "running"].includes(snapshot.state)) {
    return {
      status: "pending",
      settings,
      counters: null,
      message: "Waiting for this execution's complete coverage report.",
    };
  }
  if (snapshot.state === "stopped" || snapshot.coverage?.status !== "ready") {
    return {
      status: "unavailable",
      settings,
      counters: null,
      message: "Complete coverage is unavailable; the thresholds cannot pass.",
    };
  }
  const counters = snapshot.coverage.counters;
  const measured = coverageCounterKinds.filter((kind) => settings[kind] !== "");
  if (measured.some((kind) => counters[kind].covered + counters[kind].missed === 0)) {
    return {
      status: "unavailable",
      settings,
      counters,
      message: "A required counter has no measured code; the thresholds cannot pass.",
    };
  }
  const passed = measured.every((kind) => {
    const { covered, missed } = counters[kind];
    return (100 * covered) / (covered + missed) >= Number(settings[kind]);
  });
  return {
    status: passed ? "passed" : "failed",
    settings,
    counters,
    message: passed
      ? "All configured coverage thresholds were reached."
      : "At least one configured coverage threshold was not reached.",
  };
}
