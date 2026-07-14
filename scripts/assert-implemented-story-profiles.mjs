#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import * as cucumberProfiles from "../cucumber.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js");
const desktopStatusOnly = process.argv.slice(2).includes("--desktop-status");

function scenarioKey(scenario) {
  return `${scenario.uri}:${scenario.line} ${scenario.name}`;
}

function discover(profile) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      cucumberEntry,
      "--config",
      "cucumber.js",
      "--profile",
      profile,
      "--dry-run",
      "--format",
      "message",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(
      `Cucumber profile ${profile} discovery failed with exit code ${result.status ?? "unknown"}`,
    );
  }

  const scenariosByPickleId = new Map();
  const selectedPickleIds = new Set();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const envelope = JSON.parse(line);
    if (envelope.pickle) {
      scenariosByPickleId.set(envelope.pickle.id, {
        uri: envelope.pickle.uri,
        line: envelope.pickle.location.line,
        name: envelope.pickle.name,
        tags: new Set(envelope.pickle.tags.map(({ name }) => name)),
      });
    }
    if (envelope.testCase) selectedPickleIds.add(envelope.testCase.pickleId);
  }
  return [...selectedPickleIds].map((pickleId) => scenariosByPickleId.get(pickleId));
}

function assertProfileTarget(profileName, expectedName, expectedDriver, failures) {
  const target = cucumberProfiles[profileName]?.worldParameters?.target;
  if (target?.name !== expectedName || target?.driver !== expectedDriver) {
    failures.push(
      `${profileName} must use ${expectedName}/${expectedDriver}, received ${target?.name ?? "missing"}/${target?.driver ?? "missing"}`,
    );
  }
}

function compareProfileSelection(profileName, actual, expected, failures) {
  const actualKeys = new Set(actual.map(scenarioKey));
  const expectedKeys = new Set(expected.map(scenarioKey));

  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) failures.push(`${profileName} does not select ${key}`);
  }
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) failures.push(`${profileName} unexpectedly selects ${key}`);
  }
}

function printScenarios(heading, scenarios) {
  console.error(heading);
  for (const scenario of scenarios) console.error(`- ${scenarioKey(scenario)}`);
}

try {
  const implemented = discover("implementedDiscovery");
  const web = discover("implementedWeb");
  const desktop = discover("implementedDesktop");
  const expectedWeb = implemented.filter(({ tags }) => tags.has("@web") && !tags.has("@desktop"));
  const expectedDesktop = implemented.filter(
    ({ tags }) => tags.has("@desktop") && !tags.has("@web"),
  );
  const invalidTargets = implemented.filter(({ tags }) => {
    const targetCount = Number(tags.has("@web")) + Number(tags.has("@desktop"));
    return targetCount !== 1;
  });
  const failures = [];

  assertProfileTarget("implementedDiscovery", "unselected", "unselected", failures);
  assertProfileTarget("implementedWeb", "web", "playwright", failures);
  assertProfileTarget("implementedDesktop", "desktop", "tauri", failures);
  compareProfileSelection("implementedWeb", web, expectedWeb, failures);
  compareProfileSelection("implementedDesktop", desktop, expectedDesktop, failures);

  if (invalidTargets.length > 0) {
    failures.push(
      "implemented scenarios must select exactly one supported target tag: @web or @desktop",
    );
  }

  console.log(
    `Implemented Story profiles: ${web.length} web/playwright, ${desktop.length} desktop/tauri, ${invalidTargets.length} invalid target selection.`,
  );

  if (failures.length > 0) {
    console.error("Implemented Story profile assertions: FAIL");
    for (const failure of failures) console.error(`- ${failure}`);
    if (invalidTargets.length > 0) printScenarios("Invalid implemented scenarios:", invalidTargets);
    process.exit(1);
  }

  if (desktop.length > 0) {
    console.error("Implemented desktop Story status: UNSUPPORTED");
    console.error(
      "Desktop/tauri Story execution is not supported yet; implemented desktop scenarios cannot be included in the aggregate command.",
    );
    printScenarios("Unsupported implemented desktop scenarios:", desktop);
    process.exit(1);
  }

  if (desktopStatusOnly) {
    console.log(
      "Implemented desktop Story status: UNSUPPORTED (no implemented desktop scenarios selected).",
    );
  } else {
    console.log("Implemented Story profile assertions: PASS");
  }
} catch (error) {
  console.error("Implemented Story profile assertions: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
