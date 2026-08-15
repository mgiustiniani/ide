#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import * as cucumberProfiles from "../cucumber.js";
import { evaluateDeclaredStoryRouting, scenarioKey } from "./story-profile-policy.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js");
const desktopStatusOnly = process.argv.slice(2).includes("--desktop-status");

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
      killSignal: "SIGTERM",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  );

  if (result.error || result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const outcome = result.error?.message ?? `exit code ${result.status ?? "unknown"}`;
    throw new Error(`Cucumber profile ${profile} discovery failed with ${outcome}`);
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

  return [...selectedPickleIds].map((pickleId) => {
    const scenario = scenariosByPickleId.get(pickleId);
    if (!scenario) throw new Error(`${profile} selected unknown Cucumber pickle ${pickleId}`);
    return scenario;
  });
}

function assertWorldParameters(profileName, expected, failures) {
  const actual = cucumberProfiles[profileName]?.worldParameters;
  if (!isDeepStrictEqual(actual, expected)) {
    failures.push(
      `${profileName} world parameters must be ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
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
  const declared = discover("declaredDiscovery");
  const validated = discover("implementedDiscovery");
  const web = discover("implementedWeb");
  const validatedDesktop = discover("implementedDesktop");
  const desktopTauriHarness = discover("implementedDesktopTauriHarness");
  const desktopTauriWebdriver = discover("implementedDesktopTauriWebdriver");
  const idePackagingTauriHarness = discover("idePackagingTauriHarness");
  const javaImportNativeGui = discover("refactorKitJavaImportNativeGui");
  const desktopLayoutNativeGui = discover("desktopLayoutNativeGui");
  const piWorkspaceAgentNativeGui = discover("piWorkspaceAgentNativeGui");
  const xcom2MachineSettingsMissingSteamNativeGui = discover(
    "xcom2MachineSettingsMissingSteamNativeGui",
  );
  const xcom2ModuleActivationNativeGui = discover("xcom2ModuleActivationNativeGui");
  const xcom2ModuleConfigurationActivationNativeGui = discover(
    "xcom2ModuleConfigurationActivationNativeGui",
  );
  const xcom2ModuleConfigurationDiagnosticsNativeGui = discover(
    "xcom2ModuleConfigurationDiagnosticsNativeGui",
  );
  const routing = evaluateDeclaredStoryRouting(declared);
  const expectedValidated = declared.filter(({ tags }) => tags.has("@implemented-and-validated"));
  const failures = [...routing.failures];
  const unselected = { target: { name: "unselected", driver: "unselected" } };
  const webPlaywright = { target: { name: "web", driver: "playwright" } };
  const desktopTauri = { target: { name: "desktop", driver: "tauri" } };
  const desktopTauriHarnessEvidence = {
    ...desktopTauri,
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  };
  const desktopTauriWebdriverEvidence = {
    target: { name: "desktop", driver: "tauri-webdriver" },
    evidence: {
      kind: "tauri-webdriver",
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
    },
  };

  const idePackagingTauriHarnessEvidence = {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: true,
      e2e: true,
      packagedApplication: true,
    },
  };

  assertWorldParameters("default", unselected, failures);
  assertWorldParameters("declaredDiscovery", unselected, failures);
  assertWorldParameters("implementedDiscovery", unselected, failures);
  assertWorldParameters("implementedWeb", webPlaywright, failures);
  assertWorldParameters("implementedDesktop", desktopTauri, failures);
  assertWorldParameters("implementedDesktopTauriHarness", desktopTauriHarnessEvidence, failures);
  assertWorldParameters(
    "implementedDesktopTauriWebdriver",
    desktopTauriWebdriverEvidence,
    failures,
  );
  assertWorldParameters("idePackagingTauriHarness", idePackagingTauriHarnessEvidence, failures);
  assertWorldParameters("desktopTauriWebdriver", desktopTauriWebdriverEvidence, failures);
  assertWorldParameters("desktopFileOpenNativeGui", desktopTauriWebdriverEvidence, failures);
  assertWorldParameters("refactorKitJavaImportNativeGui", desktopTauriWebdriverEvidence, failures);
  assertWorldParameters("desktopLayoutNativeGui", desktopTauriWebdriverEvidence, failures);
  assertWorldParameters("piWorkspaceAgentNativeGui", desktopTauriWebdriverEvidence, failures);
  assertWorldParameters(
    "xcom2MachineSettingsMissingSteamNativeGui",
    desktopTauriWebdriverEvidence,
    failures,
  );
  assertWorldParameters("xcom2ModuleActivationNativeGui", desktopTauriWebdriverEvidence, failures);
  assertWorldParameters(
    "xcom2ModuleConfigurationActivationNativeGui",
    desktopTauriWebdriverEvidence,
    failures,
  );
  assertWorldParameters(
    "xcom2ModuleConfigurationDiagnosticsNativeGui",
    desktopTauriWebdriverEvidence,
    failures,
  );
  assertWorldParameters("desktop", desktopTauri, failures);

  compareProfileSelection("implementedDiscovery", validated, expectedValidated, failures);
  compareProfileSelection("implementedWeb", web, routing.expectedWeb, failures);
  compareProfileSelection(
    "implementedDesktop",
    validatedDesktop,
    [...routing.expectedDesktopTauriWebdriver, ...routing.expectedIdePackagingTauriHarness, ...routing.unsupportedValidatedDesktop],
    failures,
  );
  compareProfileSelection(
    "implementedDesktopTauriHarness",
    desktopTauriHarness,
    routing.expectedDesktopTauriHarness,
    failures,
  );
  compareProfileSelection(
    "implementedDesktopTauriWebdriver",
    desktopTauriWebdriver,
    routing.expectedDesktopTauriWebdriver,
    failures,
  );
  compareProfileSelection(
    "idePackagingTauriHarness",
    idePackagingTauriHarness,
    routing.expectedIdePackagingTauriHarness,
    failures,
  );
  compareProfileSelection(
    "refactorKitJavaImportNativeGui",
    javaImportNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-REFACTORKIT-JAVA-IMPORT-002")),
    failures,
  );
  compareProfileSelection(
    "desktopLayoutNativeGui",
    desktopLayoutNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-LAYOUT-DESKTOP-001")),
    failures,
  );
  compareProfileSelection(
    "piWorkspaceAgentNativeGui",
    piWorkspaceAgentNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-PI-WORKSPACE-AGENT-001")),
    failures,
  );
  compareProfileSelection(
    "xcom2MachineSettingsMissingSteamNativeGui",
    xcom2MachineSettingsMissingSteamNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001")),
    failures,
  );
  compareProfileSelection(
    "xcom2ModuleActivationNativeGui",
    xcom2ModuleActivationNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-XCOM2-MODULE-ACTIVATION-001")),
    failures,
  );
  compareProfileSelection(
    "xcom2ModuleConfigurationActivationNativeGui",
    xcom2ModuleConfigurationActivationNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001")),
    failures,
  );
  compareProfileSelection(
    "xcom2ModuleConfigurationDiagnosticsNativeGui",
    xcom2ModuleConfigurationDiagnosticsNativeGui,
    declared.filter(({ tags }) => tags.has("@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001")),
    failures,
  );

  console.log(
    `Declared Story routes: ${web.length} web/playwright E2E, ${desktopTauriHarness.length} desktop/tauri-harness (not native GUI/E2E), ${desktopTauriWebdriver.length} desktop/tauri-webdriver native GUI E2E, ${idePackagingTauriHarness.length} desktop/tauri-harness AppImage-packaging E2E, ${routing.unsupportedValidatedDesktop.length} unsupported validated desktop, ${failures.length} routing failure(s).`,
  );

  if (failures.length > 0) {
    console.error("Declared Story profile assertions: FAIL");
    for (const failure of failures) console.error(`- ${failure}`);
    if (routing.unsupportedValidatedDesktop.length > 0) {
      printScenarios(
        "Unsupported @implemented-and-validated desktop scenarios:",
        routing.unsupportedValidatedDesktop,
      );
    }
    process.exit(1);
  }

  if (desktopStatusOnly) {
    console.log(
      `Implemented-and-validated desktop Story status: ${desktopTauriWebdriver.length} scenario(s) routed to explicit desktop/tauri-webdriver release-no-bundle native GUI E2E evidence.`,
    );
  } else {
    console.log("Declared Story profile assertions: PASS");
  }
} catch (error) {
  console.error("Declared Story profile assertions: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
