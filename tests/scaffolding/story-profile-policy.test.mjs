import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as cucumberProfiles from "../../cucumber.js";
import { evaluateDeclaredStoryRouting, scenarioKey } from "../../scripts/story-profile-policy.mjs";
import {
  runImplementedStoryAggregate,
  runProfileCommand,
} from "../../scripts/run-implemented-story-aggregate.mjs";

const scenario = (name, tags) => ({
  uri: "features/scaffolding.feature",
  line: 1,
  name,
  tags: new Set(tags),
});

function selectedScenarios(profile) {
  const cucumberEntry = path.join(process.cwd(), "node_modules/@cucumber/cucumber/bin/cucumber.js");
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
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr ?? `Cucumber profile discovery failed: ${profile}`,
  );

  const pickles = new Map();
  const selectedPickleIds = new Set();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const envelope = JSON.parse(line);
    if (envelope.pickle) {
      pickles.set(envelope.pickle.id, {
        uri: envelope.pickle.uri,
        line: envelope.pickle.location.line,
        name: envelope.pickle.name,
        tags: new Set(envelope.pickle.tags.map(({ name }) => name)),
      });
    }
    if (envelope.testCase) selectedPickleIds.add(envelope.testCase.pickleId);
  }
  return [...selectedPickleIds].map((pickleId) => {
    const selected = pickles.get(pickleId);
    assert.ok(selected, `${profile} selected unknown Cucumber pickle ${pickleId}`);
    return selected;
  });
}

function requirementIds(selected) {
  return [...selected.tags].filter((tag) => tag.startsWith("@REQ-")).sort();
}

function dryRunSummary(profile) {
  const cucumberEntry = path.join(process.cwd(), "node_modules/@cucumber/cucumber/bin/cucumber.js");
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
      "summary",
    ],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr ?? `Cucumber dry-run failed: ${profile}`,
  );
  return result.stdout;
}

test("profiles keep default and focused routing while declaring exact aggregate evidence", () => {
  assert.deepEqual(cucumberProfiles.default.worldParameters, {
    target: { name: "unselected", driver: "unselected" },
  });
  assert.equal(cucumberProfiles.default.tags, undefined);

  assert.deepEqual(cucumberProfiles.implementedWeb.worldParameters, {
    target: { name: "web", driver: "playwright" },
  });
  assert.equal(
    cucumberProfiles.implementedWeb.tags,
    "@implemented-and-validated and @web and not @desktop",
  );

  assert.deepEqual(cucumberProfiles.implementedDesktopTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.implementedDesktopTauriHarness.tags,
    "@implemented-not-e2e-validated and @desktop and not @web",
  );

  const nativeGuiEvidence = {
    target: { name: "desktop", driver: "tauri-webdriver" },
    evidence: {
      kind: "tauri-webdriver",
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
    },
  };
  assert.deepEqual(
    cucumberProfiles.implementedDesktopTauriWebdriver.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.implementedDesktopTauriWebdriver.tags,
    "@implemented-and-validated and @desktop and @native-gui and not @web",
  );
  assert.deepEqual(cucumberProfiles.desktopTauriWebdriver.worldParameters, nativeGuiEvidence);
  assert.deepEqual(cucumberProfiles.desktopFileOpenNativeGui.worldParameters, nativeGuiEvidence);
  assert.equal(
    cucumberProfiles.desktopFileOpenNativeGui.tags,
    "@REQ-DESKTOP-FILE-OPEN-001 and @implemented-and-validated and @desktop and @native-gui and not @web",
  );
  assert.deepEqual(
    cucumberProfiles.refactorKitJavaImportNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.refactorKitJavaImportNativeGui.tags,
    "@REQ-REFACTORKIT-JAVA-IMPORT-002 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(cucumberProfiles.refactorKitJavaImportNativeGui.tags, /implemented|partial/);
  assert.deepEqual(cucumberProfiles.desktopLayoutNativeGui.worldParameters, nativeGuiEvidence);
  assert.equal(
    cucumberProfiles.desktopLayoutNativeGui.tags,
    "@REQ-LAYOUT-DESKTOP-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(cucumberProfiles.desktopLayoutNativeGui.tags, /implemented|partial/);

  assert.deepEqual(cucumberProfiles.xcom2MachineSettingsTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-001",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(cucumberProfiles.xcom2ProjectFoundryTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-001",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-002",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.worldParameters,
    {
      target: { name: "desktop", driver: "tauri" },
      evidence: {
        kind: "tauri-harness",
        nativeGui: false,
        e2e: false,
        packagedApplication: false,
      },
    },
  );
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-003",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.worldParameters,
    {
      target: { name: "desktop", driver: "tauri" },
      evidence: {
        kind: "tauri-harness",
        nativeGui: false,
        e2e: false,
        packagedApplication: false,
      },
    },
  );
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-004",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ModuleActivationNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2ModuleActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ModuleActivationNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(cucumberProfiles.implementedDesktop.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
  });
  assert.equal(
    cucumberProfiles.implementedDesktop.tags,
    "@implemented-and-validated and @desktop and not @web",
  );

  assert.deepEqual(cucumberProfiles.desktop.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
  });
  assert.equal(cucumberProfiles.desktop.tags, "@desktop and not @web");
});

test("focused XCOM machine Settings profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2MachineSettingsTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MACHINE-SETTINGS-001"]);
  assert.equal(selected[0].uri, "features/xcom2/machine-settings-runtime.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-001",
  );
});

test("focused XCOM machine Settings command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-machine-settings-001"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2MachineSettingsTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.worldParameters.evidence.artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-001"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assert.match(
    dryRunSummary("xcom2ProjectFoundryTauriHarness"),
    /1 scenario \(1 skipped\)[\s\S]*58 steps \(58 skipped\)/,
  );
});

test("focused XCOM Project Foundry command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-001"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryTauriHarness.worldParameters.evidence.artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry Apply profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryApplyTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-002"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assert.match(
    dryRunSummary("xcom2ProjectFoundryApplyTauriHarness"),
    /1 scenario \(1 skipped\)[\s\S]*39 steps \(39 skipped\)/,
  );
});

test("focused XCOM Project Foundry Apply command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-002"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryApplyTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.worldParameters.evidence.artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry destination-conflict profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryDestinationConflictTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-003"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assert.match(
    dryRunSummary("xcom2ProjectFoundryDestinationConflictTauriHarness"),
    /1 scenario \(1 skipped\)[\s\S]*53 steps \(53 skipped\)/,
  );
});

test("focused XCOM Project Foundry destination-conflict command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-003"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryDestinationConflictTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.worldParameters.evidence
      .artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry verified-cleanup profile selects only its parked harness requirement", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryVerifiedCleanupTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-004"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@not-implemented"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assert.match(
    dryRunSummary("xcom2ProjectFoundryVerifiedCleanupTauriHarness"),
    /1 scenario \(1 skipped\)[\s\S]*66 steps \(66 skipped\)/,
  );
});

test("focused XCOM Project Foundry verified-cleanup command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-004"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryVerifiedCleanupTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.worldParameters.evidence
      .artifactKind,
    undefined,
  );
});

test("focused missing-Steam XCOM machine Settings profile is native-only and status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2MachineSettingsMissingSteamNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001"]);
  assert.equal(selected[0].uri, "features/xcom2/machine-settings-missing-steam.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@native-gui"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001 and @desktop and @native-gui and not @web",
  );
});

test("focused XCOM module activation profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2ModuleActivationNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MODULE-ACTIVATION-001"]);
  assert.equal(selected[0].uri, "features/xcom2/module-activation.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.equal(
    cucumberProfiles.xcom2ModuleActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
});

test("focused XCOM module configuration activation profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2ModuleConfigurationActivationNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001"]);
  assert.equal(selected[0].uri, "features/xcom2/module-configuration-activation.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
});

test("focused XCOM module configuration diagnostics profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2ModuleConfigurationDiagnosticsNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), [
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
  ]);
  assert.equal(selected[0].uri, "features/xcom2/module-configuration-diagnostics.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 and @desktop and @native-gui and not @web",
  );
});

test("focused native package commands make no harness or package claim", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const commands = new Map([
    [
      "test:story:req-refactorkit-java-import-002",
      "node scripts/run-native-desktop-story.mjs --profile refactorKitJavaImportNativeGui",
    ],
    [
      "test:story:req-layout-desktop-001:native",
      "node scripts/run-native-desktop-story.mjs --profile desktopLayoutNativeGui",
    ],
    [
      "test:story:req-xcom2-machine-settings-missing-steam-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2MachineSettingsMissingSteamNativeGui",
    ],
    [
      "test:story:req-xcom2-module-activation-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2ModuleActivationNativeGui",
    ],
    [
      "test:story:req-xcom2-module-configuration-activation-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2ModuleConfigurationActivationNativeGui",
    ],
    [
      "test:story:req-xcom2-module-configuration-diagnostics-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2ModuleConfigurationDiagnosticsNativeGui",
    ],
  ]);

  for (const [name, expected] of commands) {
    const command = manifest.scripts[name];
    assert.equal(command, expected);
    assert.doesNotMatch(command, /tauri-harness|package|bundle/);
  }
});

test("zero runnable selections are successful", () => {
  const result = evaluateDeclaredStoryRouting([]);

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedWeb, []);
  assert.deepEqual(result.expectedDesktopTauriHarness, []);
  assert.deepEqual(result.expectedDesktopTauriWebdriver, []);
  assert.deepEqual(result.unsupportedValidatedDesktop, []);
});

test("declared routing separates web, harness, and native GUI evidence while excluding parked statuses", () => {
  const web = scenario("validated web", ["@implemented-and-validated", "@web"]);
  const harness = scenario("desktop harness", ["@implemented-not-e2e-validated", "@desktop"]);
  const nativeGui = scenario("native desktop", [
    "@implemented-and-validated",
    "@desktop",
    "@native-gui",
  ]);
  const notImplemented = scenario("parked", ["@not-implemented", "@desktop", "@native-gui"]);
  const partial = scenario("partial", ["@partial", "@desktop", "@native-gui"]);

  const result = evaluateDeclaredStoryRouting([web, harness, nativeGui, notImplemented, partial]);

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedWeb.map(scenarioKey), [scenarioKey(web)]);
  assert.deepEqual(result.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(harness)]);
  assert.deepEqual(result.expectedDesktopTauriWebdriver.map(scenarioKey), [scenarioKey(nativeGui)]);
});

test("promoted XCOM Project Foundry routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("promoted XCOM Project Foundry Apply routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryApplyTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("promoted XCOM Project Foundry destination conflict routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryDestinationConflictTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("parked XCOM Project Foundry verified cleanup can promote only to deterministic harness evidence", () => {
  const [parked] = selectedScenarios("xcom2ProjectFoundryVerifiedCleanupTauriHarness");

  const before = evaluateDeclaredStoryRouting([parked]);
  assert.deepEqual(before.failures, []);
  assert.deepEqual(before.expectedWeb, []);
  assert.deepEqual(before.expectedDesktopTauriHarness, []);
  assert.deepEqual(before.expectedDesktopTauriWebdriver, []);

  const promoted = {
    ...parked,
    tags: new Set(
      [...parked.tags, "@implemented-not-e2e-validated"].filter(
        (tag) => tag !== "@not-implemented",
      ),
    ),
  };
  const after = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(after.failures, []);
  assert.deepEqual(after.expectedWeb, []);
  assert.deepEqual(after.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(after.expectedDesktopTauriWebdriver, []);
});

test("declared routes and partial versus non-implemented inventory stay exact", () => {
  const declared = selectedScenarios("declaredDiscovery");
  const validated = declared.filter(({ tags }) => tags.has("@implemented-and-validated"));
  const harnessOnly = declared.filter(({ tags }) => tags.has("@implemented-not-e2e-validated"));
  const partial = declared.filter(({ tags }) => tags.has("@partial"));
  const notImplemented = declared.filter(({ tags }) => tags.has("@not-implemented"));
  const web = selectedScenarios("implementedWeb");
  const harness = selectedScenarios("implementedDesktopTauriHarness");
  const nativeGui = selectedScenarios("implementedDesktopTauriWebdriver");
  const routing = evaluateDeclaredStoryRouting(declared);
  const currentNativeRequirements = [
    "@REQ-DESKTOP-FILE-OPEN-001",
    "@REQ-LAYOUT-DESKTOP-001",
    "@REQ-REFACTORKIT-JAVA-IMPORT-002",
    "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001",
    "@REQ-XCOM2-MODULE-ACTIVATION-001",
    "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001",
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
  ];

  assert.deepEqual(web.flatMap(requirementIds).sort(), ["@REQ-LAYOUT-WEB-001", "@REQ-WEB-001"]);
  assert.deepEqual(harness.flatMap(requirementIds).sort(), [
    "@REQ-REFACTORKIT-JAVA-IMPORT-001",
    "@REQ-XCOM2-MACHINE-SETTINGS-001",
    "@REQ-XCOM2-PROJECT-FOUNDRY-001",
    "@REQ-XCOM2-PROJECT-FOUNDRY-002",
    "@REQ-XCOM2-PROJECT-FOUNDRY-003",
  ]);
  assert.deepEqual(nativeGui.flatMap(requirementIds).sort(), currentNativeRequirements);
  assert.deepEqual(partial.flatMap(requirementIds), []);
  assert.deepEqual(notImplemented.flatMap(requirementIds).sort(), [
    "@REQ-REFACTORKIT-TS-001",
    "@REQ-REFACTORKIT-TS-002",
    "@REQ-XCOM2-PROJECT-FOUNDRY-004",
  ]);
  assert.equal(declared.length, 17);
  assert.equal(validated.length, 9);
  assert.equal(harnessOnly.length, 5);
  assert.equal(partial.length, 0);
  assert.equal(notImplemented.length, 3);
  assert.equal(web.length, 2);
  assert.equal(harness.length, 5);
  assert.equal(nativeGui.length, 7);
  assert.match(
    dryRunSummary("implementedWeb"),
    /2 scenarios \(2 skipped\)[\s\S]*16 steps \(16 skipped\)/,
  );
  assert.match(
    dryRunSummary("implementedDesktopTauriHarness"),
    /5 scenarios \(5 skipped\)[\s\S]*199 steps \(199 skipped\)/,
  );
  assert.match(
    dryRunSummary("implementedDesktopTauriWebdriver"),
    /7 scenarios \(7 skipped\)[\s\S]*198 steps \(198 skipped\)/,
  );
  assert.deepEqual(routing.failures, []);
  assert.equal(routing.expectedWeb.length, 2);
  assert.equal(routing.expectedDesktopTauriHarness.length, 5);
  assert.equal(routing.expectedDesktopTauriWebdriver.length, 7);
  assert.deepEqual(
    routing.expectedDesktopTauriWebdriver.flatMap(requirementIds).sort(),
    currentNativeRequirements,
  );
});

test("promoted desktop layout routes only to native GUI evidence", () => {
  const desktopLayout = scenario("desktop layout", [
    "@REQ-LAYOUT-DESKTOP-001",
    "@implemented-and-validated",
    "@desktop",
    "@native-gui",
  ]);

  const result = evaluateDeclaredStoryRouting([desktopLayout]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedDesktopTauriHarness, []);
  assert.deepEqual(result.expectedDesktopTauriWebdriver.map(scenarioKey), [
    scenarioKey(desktopLayout),
  ]);
});

test("missing and multiple statuses are rejected", () => {
  const result = evaluateDeclaredStoryRouting([
    scenario("missing status", ["@web"]),
    scenario("multiple statuses", ["@implemented-and-validated", "@partial", "@web"]),
  ]);

  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 missing status must declare exactly one Story status tag; received 0",
    "features/scaffolding.feature:1 multiple statuses must declare exactly one Story status tag; received 2",
  ]);
});

test("missing and multiple targets are rejected", () => {
  const result = evaluateDeclaredStoryRouting([
    scenario("missing target", ["@implemented-and-validated"]),
    scenario("multiple targets", ["@implemented-and-validated", "@web", "@desktop"]),
  ]);

  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 missing target must declare exactly one Story target tag; received 0",
    "features/scaffolding.feature:1 multiple targets must declare exactly one Story target tag; received 2",
  ]);
});

test("validated desktop is rejected unless it opts into native GUI E2E evidence", () => {
  const desktop = scenario("validated desktop", ["@implemented-and-validated", "@desktop"]);
  const result = evaluateDeclaredStoryRouting([desktop]);

  assert.deepEqual(result.unsupportedValidatedDesktop.map(scenarioKey), [scenarioKey(desktop)]);
  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 validated desktop is @implemented-and-validated @desktop but does not declare @native-gui for desktop/tauri-webdriver evidence",
  ]);
});

test("implemented aggregate keeps web and harness routes and adds the bounded native runner", async () => {
  const invocations = [];
  await runImplementedStoryAggregate({
    run: async (command, arguments_, options) => {
      invocations.push({ command, arguments_, options });
    },
  });

  assert.equal(invocations.length, 4);
  assert.ok(invocations[1].arguments_.includes("implementedWeb"));
  assert.ok(invocations[2].arguments_.includes("implementedDesktopTauriHarness"));
  assert.deepEqual(invocations[3].arguments_, [
    "scripts/run-native-desktop-story.mjs",
    "--profile",
    "implementedDesktopTauriWebdriver",
  ]);
});

test("interrupting an aggregate profile command terminates its process", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "story-aggregate-cleanup-"));
  const pidPath = path.join(directory, "pid");
  const controller = new AbortController();
  let pid;

  let testFailure;
  try {
    const running = runProfileCommand(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { writeFileSync } from "node:fs"; process.on("SIGTERM", () => {}); writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`,
      ],
      { signal: controller.signal, stdio: "ignore", stopTimeoutMs: 25 },
    );

    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        pid = Number(await readFile(pidPath, "utf8"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(Number.isInteger(pid) && pid > 0, "the child process must publish its PID");

    controller.abort();
    await assert.rejects(running, /aborted/);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } catch (error) {
    testFailure = error;
  }

  const cleanupFailures = [];
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") cleanupFailures.push(error);
    }
  }
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupFailures.push(error);
  }

  const failures = testFailure ? [testFailure, ...cleanupFailures] : cleanupFailures;
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Story aggregate assertion and cleanup failures");
  }
});
