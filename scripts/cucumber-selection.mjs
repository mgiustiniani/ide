import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

/** Test-process snapshot of unchanged profiles, using Cucumber's own dry-run runtime. */
export function discoverCucumberSelections({
  repositoryRoot,
  profiles,
  config = "cucumber.js",
  timeoutMs = 60_000 + profiles.length * 250,
}) {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), "ide-cucumber-batch-"));
  const requestPath = path.join(outputDirectory, "request.json"),
    outputPath = path.join(outputDirectory, "result.json");
  try {
    writeFileSync(requestPath, JSON.stringify({ repositoryRoot, profiles, config }));
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./discover-cucumber-profile-batch.mjs", import.meta.url)),
        requestPath,
        outputPath,
      ],
      { cwd: repositoryRoot, stdio: ["ignore", "ignore", "inherit"], timeout: timeoutMs },
    );
    if (result.status !== 0)
      throw new Error(
        `Cucumber batch discovery failed: ${result.error?.message ?? `exit code ${result.status ?? "unknown"}`}`,
        { cause: result.error },
      );
    const raw = JSON.parse(readFileSync(outputPath, "utf8"));
    return new Map(
      profiles.map((profile) => [
        profile,
        raw[profile].features
          ? parseCucumberJsonSelection(raw[profile].features)
          : Object.freeze(
              raw[profile].selection.map((s) =>
                Object.freeze({
                  ...s,
                  tags: Object.freeze(s.tags),
                  unmatchedSteps: Object.freeze(s.unmatchedSteps),
                }),
              ),
            ),
      ]),
    );
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

/** Discover Cucumber's selected scenarios and authored steps without running their bodies. */
export function discoverCucumberSelection({
  repositoryRoot,
  profile,
  config = "cucumber.js",
  cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js"),
  timeoutMs = 30_000,
}) {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), "ide-cucumber-selection-"));
  const reportPath = path.join(outputDirectory, "selection.json");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cucumberEntry,
        "--config",
        config,
        "--profile",
        profile,
        "--dry-run",
        "--format",
        `json:${reportPath}`,
      ],
      {
        cwd: repositoryRoot,
        stdio: ["ignore", "ignore", "inherit"],
        timeout: timeoutMs,
      },
    );

    if (result.status !== 0) {
      const reason = result.error?.message ?? `exit code ${result.status ?? "unknown"}`;
      throw new Error(`Cucumber profile ${profile} discovery failed: ${reason}`, {
        cause: result.error,
      });
    }

    return parseCucumberJsonSelection(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cucumber profile ")) throw error;
    throw new Error(`Cucumber profile ${profile} returned invalid JSON discovery output`, {
      cause: error,
    });
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

export function parseCucumberJsonSelection(features) {
  if (!Array.isArray(features)) throw new TypeError("Cucumber JSON selection must be an array");
  const scenarios = [];
  for (const feature of features) {
    for (const element of feature.elements ?? []) {
      if (element.type !== "scenario") continue;
      const steps = (element.steps ?? []).filter((step) => typeof step.name === "string");
      const unmatchedSteps = steps.filter((step) => !step.match?.location);
      scenarios.push(
        Object.freeze({
          id: `${feature.uri}:${element.line}:${scenarios.length}`,
          uri: feature.uri,
          line: element.line,
          name: element.name,
          tags: Object.freeze((element.tags ?? []).map(({ name }) => name).sort()),
          authoredStepCount: steps.length,
          unmatchedSteps: Object.freeze(unmatchedSteps.map(({ name, line }) => ({ name, line }))),
        }),
      );
    }
  }
  return Object.freeze(scenarios);
}
