import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
  NATIVE_DESKTOP_OUTER_TIMEOUT_MS,
  NativeDesktopStoryAbortedError,
  NativeDesktopStoryExecutionError,
  NativeDesktopStoryPrerequisiteError,
  NativeDesktopStoryTimeoutError,
  buildNativeDesktopApplication,
  createNativeDesktopSandbox,
  nativeDesktopBuildCommand,
  nativeDesktopLaunchCommand,
  profileSelectsScenarios,
  resolveNativeDesktopPrerequisites,
  runNativeDesktopStory,
  runOwnedProcess,
} from "../../scripts/run-native-desktop-story.mjs";

async function executable(directory, name) {
  const executablePath = path.join(directory, name);
  await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(executablePath, 0o755);
  return executablePath;
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function assertProcessGone(processId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(processId, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
  }
  assert.fail(`process ${processId} survived owned process-group cleanup`);
}

async function ownedProcessFixture(directory, options) {
  const parentPidPath = path.join(directory, `${options.label}-parent.pid`);
  const descendantPidPath = path.join(directory, `${options.label}-descendant.pid`);
  const script = `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));
    const descendant = spawn(process.execPath, ["--input-type=module", "--eval", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `;
  const running = runOwnedProcess(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: "ignore",
    stopTimeoutMs: 25,
    ...options.runOptions,
  });
  const parentPid = Number(await waitForFile(parentPidPath));
  const descendantPid = Number(await waitForFile(descendantPidPath));
  return { running, parentPid, descendantPid };
}

test("preflight resolves every native executable and release/no-bundle binary to an absolute path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-prerequisites-"));
  try {
    const environment = {
      PATH: "",
      TAURI_DRIVER_PATH: await executable(directory, "tauri-driver"),
      WEBKIT_WEBDRIVER_PATH: await executable(directory, "WebKitWebDriver"),
      XVFB_RUN_PATH: await executable(directory, "xvfb-run"),
      DBUS_RUN_SESSION_PATH: await executable(directory, "dbus-run-session"),
      IDE_DESKTOP_APPLICATION_PATH: await executable(directory, "ide-desktop"),
    };

    const resolved = await resolveNativeDesktopPrerequisites(environment, {
      applicationPath: environment.IDE_DESKTOP_APPLICATION_PATH,
    });
    assert.deepEqual(resolved, {
      IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: environment.TAURI_DRIVER_PATH,
      IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: environment.WEBKIT_WEBDRIVER_PATH,
      IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: environment.XVFB_RUN_PATH,
      IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: environment.DBUS_RUN_SESSION_PATH,
      IDE_STORY_NATIVE_GUI_APPLICATION_PATH: environment.IDE_DESKTOP_APPLICATION_PATH,
    });
    assert.ok(Object.values(resolved).every(path.isAbsolute));

    const launch = nativeDesktopLaunchCommand(resolved, "desktopFileOpenNativeGui");
    assert.equal(launch.command, environment.DBUS_RUN_SESSION_PATH);
    assert.deepEqual(launch.arguments.slice(0, 6), [
      "--",
      environment.XVFB_RUN_PATH,
      "--auto-servernum",
      "--server-args=-screen 0 1440x900x24",
      "--",
      process.execPath,
    ]);
    assert.deepEqual(launch.arguments.slice(-2), ["--profile", "desktopFileOpenNativeGui"]);
    assert.equal(NATIVE_DESKTOP_BUILD_TIMEOUT_MS, 600_000);
    assert.equal(NATIVE_DESKTOP_OUTER_TIMEOUT_MS, 90_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a missing native prerequisite fails with a typed error before execution", async () => {
  await assert.rejects(
    resolveNativeDesktopPrerequisites({ PATH: "" }),
    (error) =>
      error instanceof NativeDesktopStoryPrerequisiteError &&
      error.code === "NATIVE_DESKTOP_STORY_PREREQUISITE" &&
      /TAURI_DRIVER_PATH/.test(error.message),
  );
});

test("native build command is direct, production release/no-bundle, and non-recursive", () => {
  const build = nativeDesktopBuildCommand();
  assert.deepEqual(build, {
    command: "pnpm",
    arguments: ["--filter", "@ide/desktop", "tauri", "build", "--no-bundle", "--ci"],
  });
  assert.equal(
    build.arguments.some((argument) => argument.includes("run-native-desktop-story")),
    false,
  );
  assert.equal(
    build.arguments.some((argument) => argument.startsWith("test:story")),
    false,
  );
});

test("native build uses its own timeout and records the executable SHA-256", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-build-"));
  const applicationPath = path.join(directory, "ide-desktop");
  const applicationContent = "fresh release application\n";
  const invocations = [];
  try {
    const result = await buildNativeDesktopApplication({
      applicationPath,
      run: async (command, arguments_, options) => {
        invocations.push({ command, arguments_, options });
        await writeFile(applicationPath, applicationContent, "utf8");
        await chmod(applicationPath, 0o755);
      },
    });

    assert.equal(invocations.length, 1);
    assert.deepEqual(
      { command: invocations[0].command, arguments: invocations[0].arguments_ },
      nativeDesktopBuildCommand(),
    );
    assert.equal(invocations[0].options.timeoutMs, NATIVE_DESKTOP_BUILD_TIMEOUT_MS);
    assert.equal(result.path, applicationPath);
    assert.equal(result.sha256, createHash("sha256").update(applicationContent).digest("hex"));
    assert.equal(result.timeoutMs, NATIVE_DESKTOP_BUILD_TIMEOUT_MS);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a successful build without the expected executable fails before native launch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-missing-build-"));
  try {
    await assert.rejects(
      buildNativeDesktopApplication({
        applicationPath: path.join(directory, "missing-ide-desktop"),
        run: async () => {},
      }),
      (error) =>
        error instanceof NativeDesktopStoryPrerequisiteError &&
        /fresh release\/no-bundle Tauri application/.test(error.message),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selected native execution builds and records evidence before launching the isolated runner", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-order-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const applicationSha256 = "a".repeat(64);
  const calls = [];
  try {
    const application = {
      path: applicationPath,
      sha256: applicationSha256,
      command: {
        executable: "pnpm",
        arguments: ["--filter", "@ide/desktop", "tauri", "build", "--no-bundle", "--ci"],
      },
      timeoutMs: NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
    };
    const prerequisites = {
      IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: process.execPath,
      IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: process.execPath,
      IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: process.execPath,
      IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: process.execPath,
      IDE_STORY_NATIVE_GUI_APPLICATION_PATH: applicationPath,
    };

    const result = await runNativeDesktopStory("desktopFileOpenNativeGui", {
      environment: { PATH: process.env.PATH },
      selectsScenarios: () => {
        calls.push("select");
        return true;
      },
      buildApplication: async () => {
        calls.push("build");
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("prerequisites");
        assert.equal(options.applicationPath, applicationPath);
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("sandbox");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async () => {
        calls.push("run");
      },
    });

    assert.deepEqual(calls, ["select", "build", "prerequisites", "sandbox", "run"]);
    assert.equal(result.skipped, false);
    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.evidence.packagedApplication, false);
    assert.equal(manifest.evidence.artifactKind, "release-no-bundle");
    assert.equal(manifest.evidence.applicationSha256, applicationSha256);
    assert.deepEqual(manifest.build, {
      command: application.command,
      timeoutMs: NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("parked zero-selection native profile skips without build or launch", async () => {
  const calls = [];
  const result = await runNativeDesktopStory("desktopFileOpenNativeGui", {
    selectsScenarios: () => false,
    buildApplication: async () => calls.push("build"),
    resolvePrerequisites: async () => calls.push("prerequisites"),
    createSandbox: async () => calls.push("sandbox"),
    run: async () => calls.push("run"),
  });

  assert.deepEqual(result, { skipped: true });
  assert.deepEqual(calls, []);
});

test("selected native profile propagates build failure and build timeout without launch", async () => {
  const failures = [
    new NativeDesktopStoryExecutionError("fake build failure"),
    new NativeDesktopStoryTimeoutError("fake build timeout"),
  ];

  for (const failure of failures) {
    let launched = false;
    await assert.rejects(
      runNativeDesktopStory("desktopFileOpenNativeGui", {
        selectsScenarios: () => true,
        buildApplication: async () => {
          throw failure;
        },
        run: async () => {
          launched = true;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(launched, false);
  }
});

test("sandbox contains HOME, XDG, IDE, workspace, temp, and diagnostic state", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-sandbox-"));
  try {
    const sandbox = await createNativeDesktopSandbox({
      artifactRoot,
      environment: { PATH: process.env.PATH, HOME: "/must-not-leak" },
    });
    const containedVariables = [
      "HOME",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "XDG_RUNTIME_DIR",
      "IDE_HOME",
      "IDE_WORKSPACE_ROOT",
      "TMPDIR",
      "TEMP",
      "TMP",
      "IDE_STORY_NATIVE_GUI_ARTIFACT_PATH",
    ];
    for (const variable of containedVariables) {
      const value = sandbox.environment[variable];
      assert.ok(path.isAbsolute(value), `${variable} must be absolute`);
      assert.equal(path.relative(sandbox.root, value).startsWith(".."), false, variable);
    }
    assert.equal(sandbox.environment.GDK_BACKEND, "x11");
    assert.equal(sandbox.environment.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal("DISPLAY" in sandbox.environment, false);
    assert.equal("WAYLAND_DISPLAY" in sandbox.environment, false);
    assert.equal("DBUS_SESSION_BUS_ADDRESS" in sandbox.environment, false);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("the focused native file-open profile excludes its parked scenario", () => {
  assert.equal(profileSelectsScenarios("desktopFileOpenNativeGui"), false);
  assert.equal(profileSelectsScenarios("implementedDesktopTauriWebdriver"), false);
});

test("abort signal cleans up the fake build process group before binary verification", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-build-signal-"));
  const controller = new AbortController();
  const parentPidPath = path.join(directory, "build-parent.pid");
  const descendantPidPath = path.join(directory, "build-descendant.pid");
  const script = `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));
    const descendant = spawn(process.execPath, ["--input-type=module", "--eval", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `;

  try {
    const running = buildNativeDesktopApplication({
      signal: controller.signal,
      applicationPath: path.join(directory, "never-built"),
      buildCommand: {
        command: process.execPath,
        arguments: ["--input-type=module", "--eval", script],
      },
      run: (command, arguments_, options) =>
        runOwnedProcess(command, arguments_, { ...options, stopTimeoutMs: 25 }),
    });
    const parentPid = Number(await waitForFile(parentPidPath));
    const descendantPid = Number(await waitForFile(descendantPidPath));

    controller.abort();
    await assert.rejects(
      running,
      (error) =>
        error instanceof NativeDesktopStoryAbortedError &&
        error.code === "NATIVE_DESKTOP_STORY_ABORTED",
    );
    await assertProcessGone(parentPid);
    await assertProcessGone(descendantPid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("outer timeout terminates the owned process group", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-timeout-"));
  try {
    const fixture = await ownedProcessFixture(directory, {
      label: "timeout",
      runOptions: { timeoutMs: 100 },
    });
    await assert.rejects(
      fixture.running,
      (error) =>
        error instanceof NativeDesktopStoryTimeoutError &&
        error.code === "NATIVE_DESKTOP_STORY_TIMEOUT",
    );
    await assertProcessGone(fixture.parentPid);
    await assertProcessGone(fixture.descendantPid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("abort signal terminates the owned process group", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-signal-"));
  const controller = new AbortController();
  try {
    const fixture = await ownedProcessFixture(directory, {
      label: "signal",
      runOptions: { timeoutMs: 5_000, signal: controller.signal },
    });
    controller.abort();
    await assert.rejects(
      fixture.running,
      (error) =>
        error instanceof NativeDesktopStoryAbortedError &&
        error.code === "NATIVE_DESKTOP_STORY_ABORTED",
    );
    await assertProcessGone(fixture.parentPid);
    await assertProcessGone(fixture.descendantPid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
