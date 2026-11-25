import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { startupProbeOptions, runStartupProbe } from "../../scripts/probe-native-startup.mjs";

test("startup probe admits only bounded diagnostic profiles and rejects options before building", () => {
  assert.deepEqual(startupProbeOptions([]), {
    profile: "desktopFileOpenNativeGui",
    attempts: 10,
    help: false,
  });
  assert.equal(startupProbeOptions(["--attempts", "24"]).attempts, 24);
  for (const args of [
    ["--attempts", "0"],
    ["--attempts", "25"],
    ["--profile", "invented"],
    ["--skip-failures"],
    ["--attempts"],
  ])
    assert.throws(() => startupProbeOptions(args));
  const help = spawnSync(process.execPath, ["scripts/probe-native-startup.mjs", "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /diagnostic|Diagnostic/);
});
test("startup probe builds once, runs sequentially, stops at the real failure and privately records unrun attempts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-startup-probe-"));
  try {
    const calls = [];
    let buildCount = 0;
    let failedArtifactPath;
    const result = await runStartupProbe({
      attempts: 4,
      artifactRoot: root,
      build: async () => {
        buildCount++;
        return { path: "/fixture/ide", sha256: "known" };
      },
      run: async (profile, options) => {
        calls.push(profile);
        assert.equal((await options.buildApplication()).sha256, "known");
        if (calls.length === 2) {
          failedArtifactPath = (await options.createSandbox({ environment: {} })).root;
          throw Object.assign(new Error("actual startup failure"), {
            code: "NATIVE_DESKTOP_STORY_EXECUTION",
          });
        }
        return { sandbox: { root: "/fixture/run-1" } };
      },
    });
    assert.equal(buildCount, 1);
    assert.deepEqual(calls, ["desktopFileOpenNativeGui", "desktopFileOpenNativeGui"]);
    assert.equal(result.passed, false);
    assert.equal(result.kind, "startup-diagnostic");
    assert.equal(result.reusedSingleFreshBuild, true);
    assert.deepEqual(result.notRun, [3, 4]);
    assert.deepEqual(
      result.observations.map((entry) => entry.passed),
      [true, false],
    );
    assert.equal(result.observations[1].errorCode, "NATIVE_DESKTOP_STORY_EXECUTION");
    assert.equal(result.observations[1].artifactPath, failedArtifactPath);
    assert.equal((await stat(failedArtifactPath)).mode & 0o777, 0o700);
    const file = path.join(result.artifactPath, "result.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).notRun, [3, 4]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build failure and cancellation never convert unrun native attempts to passes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-startup-abort-"));
  try {
    const failure = await runStartupProbe({
      attempts: 2,
      artifactRoot: root,
      build: async () => {
        throw new Error("actual build refusal");
      },
      run: async () => {
        assert.fail("must not launch after failed build");
      },
    });
    assert.equal(failure.passed, false);
    assert.equal(failure.buildFailure.reason, "actual build refusal");
    assert.deepEqual(failure.notRun, [1, 2]);
    assert.deepEqual(failure.observations, []);
    const controller = new AbortController();
    const aborted = await runStartupProbe({
      attempts: 2,
      artifactRoot: root,
      signal: controller.signal,
      build: async () => ({ sha256: "known" }),
      run: async () => {
        controller.abort();
        return { sandbox: { root: "/fixture/completed" } };
      },
    });
    assert.equal(aborted.passed, false);
    assert.equal(aborted.aborted, true);
    assert.deepEqual(
      aborted.observations.map((entry) => entry.passed),
      [true],
    );
    assert.deepEqual(aborted.notRun, [2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
