import assert from "node:assert/strict";
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

test("desktop layout remains on the harness until promotion then joins native selection", () => {
  const beforePromotion = scenario("desktop layout", [
    "@REQ-LAYOUT-DESKTOP-001",
    "@implemented-not-e2e-validated",
    "@desktop",
    "@native-gui",
  ]);
  const afterPromotion = scenario("desktop layout", [
    "@REQ-LAYOUT-DESKTOP-001",
    "@implemented-and-validated",
    "@desktop",
    "@native-gui",
  ]);

  const before = evaluateDeclaredStoryRouting([beforePromotion]);
  assert.deepEqual(before.failures, []);
  assert.deepEqual(before.expectedDesktopTauriHarness.map(scenarioKey), [
    scenarioKey(beforePromotion),
  ]);
  assert.deepEqual(before.expectedDesktopTauriWebdriver, []);

  const after = evaluateDeclaredStoryRouting([afterPromotion]);
  assert.deepEqual(after.failures, []);
  assert.deepEqual(after.expectedDesktopTauriHarness, []);
  assert.deepEqual(after.expectedDesktopTauriWebdriver.map(scenarioKey), [
    scenarioKey(afterPromotion),
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
