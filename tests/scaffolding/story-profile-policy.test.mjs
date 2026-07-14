import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as cucumberProfiles from "../../cucumber.js";
import { evaluateDeclaredStoryRouting, scenarioKey } from "../../scripts/story-profile-policy.mjs";
import { runProfileCommand } from "../../scripts/run-implemented-story-aggregate.mjs";

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
    evidence: { kind: "tauri-harness", nativeGui: false, e2e: false },
  });
  assert.equal(
    cucumberProfiles.implementedDesktopTauriHarness.tags,
    "@implemented-not-e2e-validated and @desktop and not @web",
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

test("zero runnable selections are successful", () => {
  const result = evaluateDeclaredStoryRouting([]);

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedWeb, []);
  assert.deepEqual(result.expectedDesktopTauriHarness, []);
  assert.deepEqual(result.unsupportedValidatedDesktop, []);
});

test("declared routing includes web and Tauri harness evidence but excludes parked statuses", () => {
  const web = scenario("validated web", ["@implemented-and-validated", "@web"]);
  const harness = scenario("desktop harness", ["@implemented-not-e2e-validated", "@desktop"]);
  const notImplemented = scenario("parked", ["@not-implemented", "@desktop"]);
  const partial = scenario("partial", ["@partial", "@desktop"]);

  const result = evaluateDeclaredStoryRouting([web, harness, notImplemented, partial]);

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedWeb.map(scenarioKey), [scenarioKey(web)]);
  assert.deepEqual(result.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(harness)]);
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

test("validated desktop remains unsupported without native GUI E2E evidence", () => {
  const desktop = scenario("validated desktop", ["@implemented-and-validated", "@desktop"]);
  const result = evaluateDeclaredStoryRouting([desktop]);

  assert.deepEqual(result.unsupportedValidatedDesktop.map(scenarioKey), [scenarioKey(desktop)]);
  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 validated desktop is @implemented-and-validated @desktop but no packaged native GUI/E2E profile exists",
  ]);
});

test("interrupting an aggregate profile command terminates its process", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "story-aggregate-cleanup-"));
  const pidPath = path.join(directory, "pid");
  const controller = new AbortController();
  let pid;

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
  } finally {
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
