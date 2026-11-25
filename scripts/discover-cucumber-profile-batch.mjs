// One isolated discovery worker. Scenario bodies and hooks are never executed.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfiguration, runCucumber } from "@cucumber/cucumber/api";
import { discoverCucumberSelection } from "./cucumber-selection.mjs";
const requestPath = process.argv[2];
const outputPath = process.argv[3];
const request = JSON.parse(await readFile(requestPath, "utf8"));
const results = {};
let support;
let coordinates;
for (const [index, profile] of request.profiles.entries()) {
  const reportPath = path.join(path.dirname(requestPath), `profile-${index}.json`);
  const { runConfiguration } = await loadConfiguration(
    {
      file: request.config,
      profiles: [profile],
      provided: { dryRun: true, format: [`json:${reportPath}`], publish: false },
    },
    { cwd: request.repositoryRoot },
  );
  const { requirePaths, importPaths } = runConfiguration.support;
  // Cucumber derives implicit support paths from the feature paths. Explicit
  // support globs resolve from the repository root for every feature selection.
  const implicitSupportPaths = !requirePaths.length && !importPaths.length
    ? runConfiguration.sources.paths
    : [];
  const key = JSON.stringify([runConfiguration.support, implicitSupportPaths]);
  if (support && key !== coordinates) {
    results[profile] = { selection: discoverCucumberSelection({ ...request, profile }) };
    continue;
  }
  const result = await runCucumber(
    { ...runConfiguration, ...(support ? { support } : {}) },
    { cwd: request.repositoryRoot },
  );
  if (!result.success) throw new Error(`Cucumber profile ${profile} discovery failed`);
  support = result.support;
  coordinates = key;
  results[profile] = { features: JSON.parse(await readFile(reportPath, "utf8")) };
}
await writeFile(outputPath, JSON.stringify(results));
