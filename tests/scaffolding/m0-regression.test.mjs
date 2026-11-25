import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  regressionPlan,
  runRegression,
  runRegressionCommand,
} from "../../scripts/run-m0-regression.mjs";

const step = (name, args, timeoutMs = 5_000) => ({
  name,
  command: process.execPath,
  arguments: ["-e", args],
  timeoutMs,
});
async function fixture(action) {
  const directory = await mkdtemp(path.join(tmpdir(), "ide-m0-runner-"));
  await chmod(directory, 0o700);
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("M0 regression plans are fixed, sequential and keep native partial checks separate", () => {
  const core = regressionPlan("core"),
    native = regressionPlan("native");
  assert.deepEqual(
    core.map((s) => s.name),
    ["docs", "boundaries", "bdd-types", "lint", "unit", "spec", "scaffolding", "rust", "web-build"],
  );
  assert.deepEqual(
    native.map((s) => s.profile),
    [
      "desktopFileOpenNativeGui",
      "desktopStartupResponsivenessNativeGui",
      "editorRecoveryNativeGui",
      "editorCloseGuardsNativeGui",
      "javaExecutionNativeGui",
      "java26PreviewImportNativeGui",
      "javaBuildToolsNativeGui",
      "javaFailsafeReactorNativeGui",
      "javaDebuggerNativeGui",
      "javaJdiDebuggerNativeGui",
      "javaConditionalDebuggerNativeGui",
      "javaTestJvmNativeGui",
      "javaTestDiscoveryNativeGui",
      "javaTestNgDiscoveryNativeGui",
      "editorDiskComparisonNativeGui",
      "editorRecoveryHistoryNativeGui",
      "editorRecoveryFailuresNativeGui",
      "editorRecoveryCapacityCorruptionNativeGui",
      "editorStorageFullNativeGui",
      "editorExternalChangesNativeGui",
    ],
  );
  assert.deepEqual(regressionPlan("all"), [...core, ...native]);
  for (const s of [...core, ...native])
    assert.ok(Number.isSafeInteger(s.timeoutMs) && s.timeoutMs > 0);
  for (const s of native)
    assert.deepEqual(s.arguments, ["scripts/run-native-desktop-story.mjs", "--profile", s.profile]);
  assert.throws(() => regressionPlan("invented"));
});

test("M0 command-line plan performs no build or test and rejects unsupported arguments", () => {
  const planned = spawnSync(
    process.execPath,
    ["scripts/run-m0-regression.mjs", "--suite", "native", "--plan"],
    { encoding: "utf8" },
  );
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(JSON.parse(planned.stdout).steps.length, 20);
  const invalid = spawnSync(
    process.execPath,
    ["scripts/run-m0-regression.mjs", "--skip-failures"],
    { encoding: "utf8" },
  );
  assert.notEqual(invalid.status, 0);
});

test("M0 results capture real exit codes and stop before running later checks", async () =>
  fixture(async (directory) => {
    const result = await runRegression({
      suite: "core",
      artifactRoot: directory,
      steps: [
        step("ok", "console.log('first')"),
        step("fail", "process.exit(7)"),
        step("never", "throw Error('must not execute')"),
      ],
    });
    assert.equal(result.passed, false);
    assert.deepEqual(
      result.checks.map((s) => s.exitCode),
      [0, 7],
    );
    assert.deepEqual(result.notRun, ["never"]);
    const report = JSON.parse(
      await readFile(path.join(result.artifactPath, "result.json"), "utf8"),
    );
    assert.equal(report.passed, false);
    assert.equal(report.checks[1].exitCode, 7);
    assert.equal(
      (await readFile(path.join(result.artifactPath, "ok.stdout.log"), "utf8")).trim(),
      "first",
    );
  }));

test("M0 bounded commands mark timeout rather than inventing a successful exit", async () =>
  fixture(async (directory) => {
    const result = await runRegressionCommand(step("slow", "setInterval(() => {}, 1000)", 100), {
      cwd: process.cwd(),
      artifactPath: directory,
      stopTimeoutMs: 100,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.passed, false);
    assert.notEqual(result.exitCode, 0);
  }));

test("M0 cancellation and launch errors remain failed outcomes", async () =>
  fixture(async (directory) => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runRegressionCommand(step("abort", "process.exit(0)"), {
      cwd: process.cwd(),
      artifactPath: directory,
      signal: controller.signal,
    });
    assert.equal(cancelled.aborted, true);
    assert.equal(cancelled.passed, false);
    const missing = await runRegressionCommand(
      { ...step("missing", ""), command: path.join(directory, "absent") },
      { cwd: process.cwd(), artifactPath: directory },
    );
    assert.equal(missing.launchError, true);
    assert.equal(missing.exitCode, null);
    assert.equal(missing.passed, false);
  }));
