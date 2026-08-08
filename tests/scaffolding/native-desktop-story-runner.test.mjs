import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
  NATIVE_DESKTOP_DESIRED_WEBVIEW_HEIGHT,
  NATIVE_DESKTOP_DESIRED_WEBVIEW_WIDTH,
  NATIVE_DESKTOP_OUTER_TIMEOUT_MS,
  NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
  NativeDesktopStoryAbortedError,
  NativeDesktopStoryExecutionError,
  NativeDesktopStoryPrerequisiteError,
  NativeDesktopStoryTimeoutError,
  buildNativeDesktopApplication,
  cleanupNativeDesktopSandboxProcesses,
  createNativeDesktopRuntimeEnvironment,
  createNativeDesktopSandbox,
  discoverNativeDesktopSelection,
  findNativeDesktopSandboxProcesses,
  nativeDesktopBuildCommand,
  nativeDesktopLaunchCommand,
  preflightNativeJavaImportPython,
  profileSelectsScenarios,
  resolveNativeDesktopPrerequisites,
  runNativeDesktopStory,
  runOwnedProcess,
} from "../../scripts/run-native-desktop-story.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js");

function selectedScenarios(profile, config = "cucumber.js") {
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
      "message",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr ?? `Cucumber profile discovery failed: ${profile}`,
  );

  const scenariosByPickleId = new Map();
  const selectedPickleIds = new Set();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const envelope = JSON.parse(line);
    if (envelope.pickle) {
      scenariosByPickleId.set(envelope.pickle.id, {
        name: envelope.pickle.name,
        tags: envelope.pickle.tags.map(({ name }) => name),
      });
    }
    if (envelope.testCase) selectedPickleIds.add(envelope.testCase.pickleId);
  }
  return [...selectedPickleIds].map((pickleId) => {
    const scenario = scenariosByPickleId.get(pickleId);
    assert.ok(scenario, `${profile} selected unknown Cucumber pickle ${pickleId}`);
    return scenario;
  });
}

function selectedScenarioCount(profile, config = "cucumber.js") {
  return selectedScenarios(profile, config).length;
}

function dryRunSummary(profile) {
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
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? result.stderr ?? `Cucumber dry-run failed: ${profile}`,
  );
  return result.stdout;
}

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
    assert.equal(NATIVE_DESKTOP_DESIRED_WEBVIEW_WIDTH, 1440);
    assert.equal(NATIVE_DESKTOP_DESIRED_WEBVIEW_HEIGHT, 900);
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

test("native Java import preflight uses only absolute /usr/bin/python3 and PyGObject GTK3", () => {
  let invocation;
  const pythonPath = preflightNativeJavaImportPython({
    run: (command, arguments_, options) => {
      invocation = { command, arguments_, options };
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(pythonPath, "/usr/bin/python3");
  assert.equal(invocation.command, "/usr/bin/python3");
  assert.deepEqual(invocation.arguments_.slice(0, 1), ["-c"]);
  assert.match(invocation.arguments_[1], /require_version\('Gtk', '3\.0'\)/);
  assert.match(invocation.arguments_[1], /from gi\.repository import Gtk/);
  assert.equal(invocation.options.timeout, 10_000);
});

test("PyGObject GTK3 preflight is conditional on selected native Java import scenarios", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-python-preflight-"));
  try {
    const environment = {
      PATH: "",
      TAURI_DRIVER_PATH: await executable(directory, "tauri-driver"),
      WEBKIT_WEBDRIVER_PATH: await executable(directory, "WebKitWebDriver"),
      XVFB_RUN_PATH: await executable(directory, "xvfb-run"),
      DBUS_RUN_SESSION_PATH: await executable(directory, "dbus-run-session"),
      IDE_DESKTOP_APPLICATION_PATH: await executable(directory, "ide-desktop"),
    };
    let calls = 0;
    const withoutJava = await resolveNativeDesktopPrerequisites(environment, {
      applicationPath: environment.IDE_DESKTOP_APPLICATION_PATH,
      preflightPython: () => {
        calls += 1;
        return "/usr/bin/python3";
      },
    });
    assert.equal(calls, 0);
    assert.equal(withoutJava.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);

    const withJava = await resolveNativeDesktopPrerequisites(environment, {
      applicationPath: environment.IDE_DESKTOP_APPLICATION_PATH,
      requiresNativeJavaImport: true,
      preflightPython: () => {
        calls += 1;
        return "/usr/bin/python3";
      },
    });
    assert.equal(calls, 1);
    assert.equal(withJava.IDE_STORY_NATIVE_GUI_PYTHON_PATH, "/usr/bin/python3");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native Java import preflight reports a typed failure without trying another Python", () => {
  assert.throws(
    () =>
      preflightNativeJavaImportPython({
        run: () => ({ status: 1, stdout: "", stderr: "ModuleNotFoundError: No module named gi" }),
      }),
    (error) =>
      error instanceof NativeDesktopStoryPrerequisiteError &&
      /\/usr\/bin\/python3 with PyGObject GTK3/.test(error.message) &&
      /No module named gi/.test(error.message),
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
      environment: {
        PATH: `/untrusted/global${path.delimiter}${process.env.PATH}`,
        IDE_REFACTORKIT_DAEMON: "/untrusted/refactorkit",
        IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      },
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
        assert.equal(options.requiresNativeJavaImport, false);
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("sandbox");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (_command, _arguments, options) => {
        calls.push("run");
        assert.equal(options.environment.IDE_REFACTORKIT_DAEMON, undefined);
        assert.equal(options.environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);
        assert.doesNotMatch(options.environment.PATH, /untrusted\/global/);
        assert.equal(options.timeoutMs, NATIVE_DESKTOP_OUTER_TIMEOUT_MS);
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("cleanup");
        return {
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        };
      },
    });

    assert.deepEqual(calls, ["select", "build", "prerequisites", "sandbox", "run", "cleanup"]);
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
    assert.deepEqual(manifest.desiredWebViewViewport, { width: 1440, height: 900 });
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(result.sandbox.paths.artifacts, "post-run-process-cleanup.json"),
          "utf8",
        ),
      ).survivorProcessIds,
      [],
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("synthetic parked zero-selection native profile skips without build or launch", async () => {
  const profile = "parkedNativeGuiFixture";
  assert.equal(selectedScenarioCount(profile, "tests/scaffolding/fixtures/parked-cucumber.js"), 0);

  const calls = [];
  const result = await runNativeDesktopStory(profile, {
    selectsScenarios: (selectedProfile) => {
      assert.equal(selectedProfile, profile);
      return false;
    },
    buildApplication: async () => calls.push("build"),
    resolvePrerequisites: async () => calls.push("prerequisites"),
    createSandbox: async () => calls.push("sandbox"),
    run: async () => calls.push("run"),
  });

  assert.deepEqual(result, { skipped: true });
  assert.deepEqual(calls, []);
});

test("focused Java import selection requests conditional Python/GTK preflight after fresh build", async () => {
  const preflightBoundary = new NativeDesktopStoryPrerequisiteError("stop after preflight routing");
  const calls = [];
  await assert.rejects(
    runNativeDesktopStory("refactorKitJavaImportNativeGui", {
      selectsScenarios: () => ({
        hasScenarios: true,
        includesNativeJavaImport: true,
        scenarios: [],
      }),
      buildApplication: async () => {
        calls.push("build");
        return { path: "/tmp/fresh-ide-desktop" };
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("preflight");
        assert.equal(options.applicationPath, "/tmp/fresh-ide-desktop");
        assert.equal(options.requiresNativeJavaImport, true);
        throw preflightBoundary;
      },
      createSandbox: async () => calls.push("sandbox"),
      run: async () => calls.push("run"),
    }),
    (error) => error === preflightBoundary,
  );
  assert.deepEqual(calls, ["build", "preflight"]);
});

test("focused desktop layout fresh-builds in isolated state without Java Python preflight and cleans up", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-layout-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const calls = [];
  try {
    const application = {
      path: applicationPath,
      sha256: "b".repeat(64),
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

    const result = await runNativeDesktopStory("desktopLayoutNativeGui", {
      environment: { PATH: process.env.PATH },
      buildApplication: async () => {
        calls.push("fresh-build");
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("prerequisites-without-java-python");
        assert.equal(options.applicationPath, applicationPath);
        assert.equal(options.requiresNativeJavaImport, false);
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("isolated-sandbox");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (_command, arguments_, options) => {
        calls.push("native-run");
        assert.deepEqual(arguments_.slice(-2), ["--profile", "desktopLayoutNativeGui"]);
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH, "1440");
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT, "900");
        assert.equal(path.relative(artifactRoot, options.environment.HOME).startsWith(".."), false);
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("cleanup");
        return {
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        };
      },
    });

    assert.deepEqual(calls, [
      "fresh-build",
      "prerequisites-without-java-python",
      "isolated-sandbox",
      "native-run",
      "cleanup",
    ]);
    assert.equal(result.skipped, false);
    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.deepEqual(manifest.desiredWebViewViewport, { width: 1440, height: 900 });
    assert.equal(manifest.selectedScenarios.length, 1);
    assert.ok(manifest.selectedScenarios[0].tags.includes("@REQ-LAYOUT-DESKTOP-001"));
    assert.equal(manifest.executables.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("focused missing-Steam machine Settings fresh-builds with empty native-only state", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-xcom-missing-steam-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const calls = [];
  try {
    const application = {
      path: applicationPath,
      sha256: "f".repeat(64),
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

    const result = await runNativeDesktopStory("xcom2MachineSettingsMissingSteamNativeGui", {
      environment: {
        PATH: process.env.PATH,
        IDE_REFACTORKIT_DAEMON: "/untrusted/refactorkit",
        IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      },
      buildApplication: async () => {
        calls.push("fresh-release-no-bundle-build");
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("common-native-prerequisites-only");
        assert.deepEqual(options, {
          applicationPath,
          requiresNativeJavaImport: false,
        });
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("empty-isolated-native-state");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (_command, arguments_, options) => {
        calls.push("native-run");
        assert.deepEqual(arguments_.slice(-2), [
          "--profile",
          "xcom2MachineSettingsMissingSteamNativeGui",
        ]);
        assert.equal(
          arguments_.some((argument) => /tauri-harness|package|bundle/iu.test(argument)),
          false,
        );
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH, "1440");
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT, "900");
        assert.equal(options.environment.GDK_BACKEND, "x11");
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
        assert.equal(options.environment.IDE_REFACTORKIT_DAEMON, undefined);
        assert.equal(options.environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);

        for (const variable of [
          "HOME",
          "XDG_CONFIG_HOME",
          "XDG_CACHE_HOME",
          "XDG_DATA_HOME",
          "XDG_STATE_HOME",
          "XDG_RUNTIME_DIR",
          "IDE_HOME",
          "IDE_WORKSPACE_ROOT",
        ]) {
          assert.equal(
            path
              .relative(
                options.environment.IDE_STORY_NATIVE_GUI_SANDBOX_PATH,
                options.environment[variable],
              )
              .startsWith(".."),
            false,
            variable,
          );
          assert.deepEqual(await readdir(options.environment[variable]), [], variable);
        }
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("bounded-process-cleanup");
        return {
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        };
      },
    });

    assert.deepEqual(calls, [
      "fresh-release-no-bundle-build",
      "common-native-prerequisites-only",
      "empty-isolated-native-state",
      "native-run",
      "bounded-process-cleanup",
    ]);
    assert.equal(result.skipped, false);

    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.target, "desktop/tauri-webdriver");
    assert.equal(manifest.profile, "xcom2MachineSettingsMissingSteamNativeGui");
    assert.deepEqual(manifest.evidence, {
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
      applicationSha256: application.sha256,
    });
    assert.equal(manifest.selectedScenarios.length, 1);
    assert.ok(
      manifest.selectedScenarios[0].tags.includes("@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001"),
    );
    assert.ok(manifest.selectedScenarios[0].tags.includes("@implemented-and-validated"));
    assert.equal(manifest.executables.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("focused XCOM activation fresh-builds with empty isolated state, no Java preflight, and cleanup", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-xcom-activation-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const calls = [];
  try {
    const application = {
      path: applicationPath,
      sha256: "c".repeat(64),
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
    const untrustedEnvironment = {
      PATH: process.env.PATH,
      HOME: "/untrusted/home",
      XDG_CONFIG_HOME: "/untrusted/xdg/config",
      XDG_CACHE_HOME: "/untrusted/xdg/cache",
      XDG_DATA_HOME: "/untrusted/xdg/data",
      XDG_STATE_HOME: "/untrusted/xdg/state",
      XDG_RUNTIME_DIR: "/untrusted/xdg/runtime",
      IDE_HOME: "/untrusted/ide-home",
      IDE_WORKSPACE_ROOT: "/untrusted/workspace",
      TMPDIR: "/untrusted/tmp",
      TEMP: "/untrusted/tmp",
      TMP: "/untrusted/tmp",
      IDE_REFACTORKIT_DAEMON: "/untrusted/refactorkit",
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_STORY_NATIVE_GUI_PYTHON_PATH: "/untrusted/python",
    };

    const result = await runNativeDesktopStory("xcom2ModuleActivationNativeGui", {
      environment: untrustedEnvironment,
      buildApplication: async () => {
        calls.push("fresh-build");
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("common-native-preflight");
        assert.deepEqual(options, {
          applicationPath,
          requiresNativeJavaImport: false,
        });
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("empty-isolated-sandbox");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (_command, arguments_, options) => {
        calls.push("native-run");
        assert.deepEqual(arguments_.slice(-2), ["--profile", "xcom2ModuleActivationNativeGui"]);
        const isolatedVariables = [
          "HOME",
          "XDG_CONFIG_HOME",
          "XDG_CACHE_HOME",
          "XDG_DATA_HOME",
          "XDG_STATE_HOME",
          "XDG_RUNTIME_DIR",
          "IDE_HOME",
          "IDE_STORY_NATIVE_GUI_SCENARIO_ROOT",
          "IDE_WORKSPACE_ROOT",
          "TMPDIR",
          "TEMP",
          "TMP",
        ];
        for (const variable of isolatedVariables) {
          assert.equal(
            path
              .relative(
                options.environment.IDE_STORY_NATIVE_GUI_SANDBOX_PATH,
                options.environment[variable],
              )
              .startsWith(".."),
            false,
            variable,
          );
        }
        assert.deepEqual(await readdir(options.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT), []);
        assert.deepEqual(await readdir(options.environment.IDE_WORKSPACE_ROOT), []);
        assert.equal(options.environment.IDE_REFACTORKIT_DAEMON, undefined);
        assert.equal(options.environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("cleanup");
        return {
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        };
      },
    });

    assert.deepEqual(calls, [
      "fresh-build",
      "common-native-preflight",
      "empty-isolated-sandbox",
      "native-run",
      "cleanup",
    ]);
    assert.equal(result.skipped, false);
    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.target, "desktop/tauri-webdriver");
    assert.equal(manifest.profile, "xcom2ModuleActivationNativeGui");
    assert.deepEqual(manifest.evidence, {
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
      applicationSha256: application.sha256,
    });
    assert.equal(manifest.selectedScenarios.length, 1);
    assert.ok(manifest.selectedScenarios[0].tags.includes("@REQ-XCOM2-MODULE-ACTIVATION-001"));
    assert.ok(manifest.selectedScenarios[0].tags.includes("@implemented-and-validated"));
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(result.sandbox.paths.artifacts, "post-run-process-cleanup.json"),
          "utf8",
        ),
      ).survivorProcessIds,
      [],
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("focused XCOM configuration activation isolates Story-created fixtures without Java or fake-backend preflight", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-xcom-config-activation-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const calls = [];
  let storyRegistryPath;
  let storyConfigurationPath;
  try {
    const application = {
      path: applicationPath,
      sha256: "d".repeat(64),
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
    const untrustedEnvironment = {
      PATH: process.env.PATH,
      HOME: "/untrusted/home",
      XDG_CONFIG_HOME: "/untrusted/xdg/config",
      XDG_CACHE_HOME: "/untrusted/xdg/cache",
      XDG_DATA_HOME: "/untrusted/xdg/data",
      XDG_STATE_HOME: "/untrusted/xdg/state",
      XDG_RUNTIME_DIR: "/untrusted/xdg/runtime",
      IDE_HOME: "/untrusted/ide-home",
      IDE_WORKSPACE_ROOT: "/untrusted/workspace",
      TMPDIR: "/untrusted/tmp",
      TEMP: "/untrusted/tmp",
      TMP: "/untrusted/tmp",
      IDE_REFACTORKIT_DAEMON: "/untrusted/refactorkit",
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_STORY_NATIVE_GUI_PYTHON_PATH: "/untrusted/python",
    };

    const result = await runNativeDesktopStory("xcom2ModuleConfigurationActivationNativeGui", {
      environment: untrustedEnvironment,
      buildApplication: async () => {
        calls.push("fresh-release-no-bundle-build");
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("common-native-preflight-only");
        assert.deepEqual(options, {
          applicationPath,
          requiresNativeJavaImport: false,
        });
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("empty-isolated-runner-state");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (_command, arguments_, options) => {
        calls.push("Story-creates-registry-and-config-fixtures");
        assert.deepEqual(arguments_.slice(-2), [
          "--profile",
          "xcom2ModuleConfigurationActivationNativeGui",
        ]);
        assert.equal(
          arguments_.some((argument) => /tauri-harness|fake-backend/iu.test(argument)),
          false,
        );
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
        for (const variable of [
          "HOME",
          "XDG_CONFIG_HOME",
          "XDG_CACHE_HOME",
          "XDG_DATA_HOME",
          "XDG_STATE_HOME",
          "XDG_RUNTIME_DIR",
          "IDE_HOME",
          "IDE_STORY_NATIVE_GUI_SCENARIO_ROOT",
          "IDE_WORKSPACE_ROOT",
          "TMPDIR",
          "TEMP",
          "TMP",
        ]) {
          assert.equal(
            path
              .relative(
                options.environment.IDE_STORY_NATIVE_GUI_SANDBOX_PATH,
                options.environment[variable],
              )
              .startsWith(".."),
            false,
            variable,
          );
        }
        assert.deepEqual(await readdir(options.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT), []);
        assert.deepEqual(await readdir(options.environment.IDE_WORKSPACE_ROOT), []);
        assert.deepEqual(await readdir(options.environment.IDE_HOME), []);
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
        assert.equal(options.environment.IDE_REFACTORKIT_DAEMON, undefined);
        assert.equal(options.environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);

        const storyRoot = path.join(
          options.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT,
          "req-xcom2-module-configuration-activation-001-story-created",
        );
        const storyIdeHome = path.join(storyRoot, "ide-home");
        const configuredWorkspace = path.join(storyRoot, "workspaces/configured-wotc");
        storyRegistryPath = path.join(storyIdeHome, "workspaces.json");
        storyConfigurationPath = path.join(configuredWorkspace, ".ide/xcom2.json");
        await mkdir(path.dirname(storyConfigurationPath), { recursive: true });
        await mkdir(storyIdeHome, { recursive: true });
        await writeFile(storyRegistryPath, '{"version":1,"workspaces":[]}\n', {
          encoding: "utf8",
          flag: "wx",
        });
        await writeFile(
          storyConfigurationPath,
          '{"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"]}',
          { encoding: "utf8", flag: "wx" },
        );
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("bounded-process-cleanup");
        return {
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        };
      },
    });

    assert.deepEqual(calls, [
      "fresh-release-no-bundle-build",
      "common-native-preflight-only",
      "empty-isolated-runner-state",
      "Story-creates-registry-and-config-fixtures",
      "bounded-process-cleanup",
    ]);
    assert.equal(result.skipped, false);
    assert.equal(await readFile(storyRegistryPath, "utf8"), '{"version":1,"workspaces":[]}\n');
    assert.equal(
      await readFile(storyConfigurationPath, "utf8"),
      '{"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"]}',
    );

    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.target, "desktop/tauri-webdriver");
    assert.equal(manifest.profile, "xcom2ModuleConfigurationActivationNativeGui");
    assert.deepEqual(manifest.evidence, {
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
      applicationSha256: application.sha256,
    });
    assert.deepEqual(manifest.build.command, application.command);
    assert.equal(manifest.selectedScenarios.length, 1);
    assert.ok(
      manifest.selectedScenarios[0].tags.includes("@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001"),
    );
    assert.ok(manifest.selectedScenarios[0].tags.includes("@implemented-and-validated"));
    assert.equal(manifest.executables.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(result.sandbox.paths.artifacts, "post-run-process-cleanup.json"),
          "utf8",
        ),
      ).survivorProcessIds,
      [],
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("focused XCOM configuration diagnostics leaves fixtures to Story and records exact no-package cleanup evidence", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-xcom-config-diagnostics-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const calls = [];
  let storyFixturePath;
  try {
    const application = {
      path: applicationPath,
      sha256: "e".repeat(64),
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
    const untrustedEnvironment = {
      PATH: process.env.PATH,
      HOME: "/untrusted/home",
      XDG_CONFIG_HOME: "/untrusted/xdg/config",
      XDG_CACHE_HOME: "/untrusted/xdg/cache",
      XDG_DATA_HOME: "/untrusted/xdg/data",
      XDG_STATE_HOME: "/untrusted/xdg/state",
      XDG_RUNTIME_DIR: "/untrusted/xdg/runtime",
      IDE_HOME: "/untrusted/ide-home",
      IDE_WORKSPACE_ROOT: "/untrusted/workspace",
      TMPDIR: "/untrusted/tmp",
      TEMP: "/untrusted/tmp",
      TMP: "/untrusted/tmp",
      IDE_REFACTORKIT_DAEMON: "/untrusted/refactorkit",
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_STORY_NATIVE_GUI_PYTHON_PATH: "/untrusted/python",
    };

    const result = await runNativeDesktopStory("xcom2ModuleConfigurationDiagnosticsNativeGui", {
      environment: untrustedEnvironment,
      buildApplication: async () => {
        calls.push("fresh-release-no-bundle-build");
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("common-native-prerequisites-only");
        assert.deepEqual(options, {
          applicationPath,
          requiresNativeJavaImport: false,
        });
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("empty-isolated-runner-state");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (_command, arguments_, options) => {
        calls.push("Story-owns-diagnostic-fixture");
        assert.deepEqual(arguments_.slice(-2), [
          "--profile",
          "xcom2ModuleConfigurationDiagnosticsNativeGui",
        ]);
        assert.equal(
          arguments_.some((argument) =>
            /tauri-harness|fake-backend|preflight|package/iu.test(argument),
          ),
          false,
        );
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
        for (const variable of [
          "HOME",
          "XDG_CONFIG_HOME",
          "XDG_CACHE_HOME",
          "XDG_DATA_HOME",
          "XDG_STATE_HOME",
          "XDG_RUNTIME_DIR",
          "IDE_HOME",
          "IDE_STORY_NATIVE_GUI_SCENARIO_ROOT",
          "IDE_WORKSPACE_ROOT",
          "TMPDIR",
          "TEMP",
          "TMP",
        ]) {
          assert.equal(
            path
              .relative(
                options.environment.IDE_STORY_NATIVE_GUI_SANDBOX_PATH,
                options.environment[variable],
              )
              .startsWith(".."),
            false,
            variable,
          );
        }
        assert.deepEqual(await readdir(options.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT), []);
        assert.deepEqual(await readdir(options.environment.IDE_WORKSPACE_ROOT), []);
        assert.deepEqual(await readdir(options.environment.IDE_HOME), []);
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
        assert.equal(options.environment.IDE_REFACTORKIT_DAEMON, undefined);
        assert.equal(options.environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);

        storyFixturePath = path.join(
          options.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT,
          "req-xcom2-module-configuration-diagnostics-001-story-owned",
          "fixture-owner",
        );
        await mkdir(path.dirname(storyFixturePath), { recursive: true });
        await writeFile(storyFixturePath, "Story-owned fixture boundary\n", {
          encoding: "utf8",
          flag: "wx",
        });
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("bounded-process-cleanup");
        return {
          sandboxPath,
          termTimeoutMs: NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
          killTimeoutMs: NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        };
      },
    });

    assert.deepEqual(calls, [
      "fresh-release-no-bundle-build",
      "common-native-prerequisites-only",
      "empty-isolated-runner-state",
      "Story-owns-diagnostic-fixture",
      "bounded-process-cleanup",
    ]);
    assert.equal(result.skipped, false);
    assert.equal(await readFile(storyFixturePath, "utf8"), "Story-owned fixture boundary\n");

    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.target, "desktop/tauri-webdriver");
    assert.equal(manifest.profile, "xcom2ModuleConfigurationDiagnosticsNativeGui");
    assert.deepEqual(manifest.evidence, {
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
      applicationSha256: application.sha256,
    });
    assert.deepEqual(manifest.build, {
      command: application.command,
      timeoutMs: NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
    });
    assert.equal(manifest.selectedScenarios.length, 1);
    assert.ok(
      manifest.selectedScenarios[0].tags.includes(
        "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
      ),
    );
    assert.ok(manifest.selectedScenarios[0].tags.includes("@implemented-and-validated"));
    assert.equal(manifest.executables.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);

    const cleanup = JSON.parse(
      await readFile(
        path.join(result.sandbox.paths.artifacts, "post-run-process-cleanup.json"),
        "utf8",
      ),
    );
    assert.deepEqual(cleanup, {
      sandboxPath: result.sandbox.root,
      termTimeoutMs: NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
      killTimeoutMs: NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
      detectedProcessIds: [],
      termSignaledProcessIds: [],
      killSignaledProcessIds: [],
      survivorProcessIds: [],
    });
    assert.deepEqual(result.cleanup, cleanup);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
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
    const inheritedEnvironment = {
      PATH: process.env.PATH,
      HOME: "/must-not-leak",
      IDE_REFACTORKIT_DAEMON: "/untrusted/global/refactorkit",
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_STORY_NATIVE_GUI_PYTHON_PATH: "/untrusted/global/python",
    };
    const sandbox = await createNativeDesktopSandbox({
      artifactRoot,
      environment: inheritedEnvironment,
    });
    const containedVariables = [
      "HOME",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "XDG_RUNTIME_DIR",
      "IDE_HOME",
      "IDE_STORY_NATIVE_GUI_SCENARIO_ROOT",
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
    assert.equal(sandbox.environment.IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH, "1440");
    assert.equal(sandbox.environment.IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT, "900");
    assert.equal(
      sandbox.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT,
      sandbox.paths.scenarioRoot,
    );
    assert.equal(sandbox.environment.IDE_REFACTORKIT_DAEMON, undefined);
    assert.equal(sandbox.environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);
    assert.equal(sandbox.environment.IDE_STORY_NATIVE_GUI_PYTHON_PATH, undefined);
    assert.equal(inheritedEnvironment.IDE_REFACTORKIT_DAEMON, "/untrusted/global/refactorkit");
    assert.equal(inheritedEnvironment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, "1");
    assert.equal(Object.isFrozen(sandbox.environment), true);
    assert.equal("DISPLAY" in sandbox.environment, false);
    assert.equal("WAYLAND_DISPLAY" in sandbox.environment, false);
    assert.equal("DBUS_SESSION_BUS_ADDRESS" in sandbox.environment, false);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("per-scenario lease root is empty, distinct from legacy file-open workspace, and confined", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-scenario-root-"));
  try {
    const sandbox = await createNativeDesktopSandbox({ artifactRoot, environment: {} });
    assert.notEqual(sandbox.paths.scenarioRoot, sandbox.paths.workspace);
    assert.equal(path.relative(sandbox.root, sandbox.paths.scenarioRoot).startsWith(".."), false);
    assert.deepEqual(await readdir(sandbox.paths.scenarioRoot), []);
    assert.equal(
      sandbox.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT,
      sandbox.paths.scenarioRoot,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("runtime sanitation leaves the caller environment available for scenario restoration", () => {
  const inherited = {
    PATH: "/global/bin",
    IDE_REFACTORKIT_DAEMON: "/global/refactorkit",
    IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
  };
  const snapshot = { ...inherited };
  createNativeDesktopRuntimeEnvironment(inherited, {
    IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: "/owned/bin/tauri-driver",
    IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: "/owned/bin/WebKitWebDriver",
    IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: "/usr/bin/xvfb-run",
    IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: "/usr/bin/dbus-run-session",
    IDE_STORY_NATIVE_GUI_APPLICATION_PATH: "/owned/application/ide-desktop",
  });
  assert.deepEqual(inherited, snapshot);
});

test("runtime PATH is closed to owned executable directories plus /usr/bin and /bin", () => {
  const sandboxEnvironment = {
    PATH: "/home/developer/.local/bin:/usr/local/bin",
    IDE_REFACTORKIT_DAEMON: "/home/developer/.local/bin/refactorkit",
    IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
  };
  const prerequisites = {
    IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: "/owned/tauri/bin/tauri-driver",
    IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: "/owned/webkit/bin/WebKitWebDriver",
    IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: "/usr/bin/xvfb-run",
    IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: "/usr/bin/dbus-run-session",
    IDE_STORY_NATIVE_GUI_APPLICATION_PATH: "/owned/application/ide-desktop",
  };

  const runtime = createNativeDesktopRuntimeEnvironment(sandboxEnvironment, prerequisites);

  assert.equal(
    runtime.PATH,
    ["/owned/tauri/bin", "/owned/webkit/bin", "/usr/bin", "/owned/application", "/bin"].join(
      path.delimiter,
    ),
  );
  assert.equal(runtime.IDE_REFACTORKIT_DAEMON, undefined);
  assert.equal(runtime.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);
  assert.equal(sandboxEnvironment.PATH, "/home/developer/.local/bin:/usr/local/bin");
  assert.equal(sandboxEnvironment.IDE_REFACTORKIT_DAEMON, "/home/developer/.local/bin/refactorkit");
  assert.equal(Object.isFrozen(runtime), true);
});

test("native runner profiles select promoted and focused native scenarios", () => {
  assert.equal(selectedScenarioCount("desktopFileOpenNativeGui"), 1);
  assert.equal(selectedScenarioCount("implementedDesktopTauriWebdriver"), 7);
  assert.equal(selectedScenarioCount("refactorKitJavaImportNativeGui"), 1);
  assert.equal(selectedScenarioCount("desktopLayoutNativeGui"), 1);
  assert.equal(selectedScenarioCount("xcom2MachineSettingsMissingSteamNativeGui"), 1);
  assert.equal(selectedScenarioCount("xcom2ModuleActivationNativeGui"), 1);
  assert.equal(selectedScenarioCount("xcom2ModuleConfigurationActivationNativeGui"), 1);
  assert.equal(selectedScenarioCount("xcom2ModuleConfigurationDiagnosticsNativeGui"), 1);
  assert.equal(profileSelectsScenarios("desktopFileOpenNativeGui"), true);
  assert.equal(profileSelectsScenarios("implementedDesktopTauriWebdriver"), true);
  assert.equal(profileSelectsScenarios("refactorKitJavaImportNativeGui"), true);
  assert.equal(profileSelectsScenarios("desktopLayoutNativeGui"), true);
  assert.equal(profileSelectsScenarios("xcom2MachineSettingsMissingSteamNativeGui"), true);
  assert.equal(profileSelectsScenarios("xcom2ModuleActivationNativeGui"), true);
  assert.equal(profileSelectsScenarios("xcom2ModuleConfigurationActivationNativeGui"), true);
  assert.equal(profileSelectsScenarios("xcom2ModuleConfigurationDiagnosticsNativeGui"), true);

  const missingSteamSelection = discoverNativeDesktopSelection(
    "xcom2MachineSettingsMissingSteamNativeGui",
  );
  assert.equal(missingSteamSelection.hasScenarios, true);
  assert.equal(missingSteamSelection.includesNativeJavaImport, false);
  assert.equal(missingSteamSelection.scenarios.length, 1);
  assert.match(
    dryRunSummary("xcom2MachineSettingsMissingSteamNativeGui"),
    /1 scenario \(1 skipped\)[\s\S]*22 steps \(22 skipped\)/,
  );
  assert.ok(
    missingSteamSelection.scenarios[0].tags.includes(
      "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001",
    ),
  );
  assert.ok(missingSteamSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const diagnosticSelection = discoverNativeDesktopSelection(
    "xcom2ModuleConfigurationDiagnosticsNativeGui",
  );
  assert.equal(diagnosticSelection.hasScenarios, true);
  assert.equal(diagnosticSelection.includesNativeJavaImport, false);
  assert.equal(diagnosticSelection.scenarios.length, 1);
  assert.ok(
    diagnosticSelection.scenarios[0].tags.includes(
      "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
    ),
  );
  assert.ok(diagnosticSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const configurationSelection = discoverNativeDesktopSelection(
    "xcom2ModuleConfigurationActivationNativeGui",
  );
  assert.equal(configurationSelection.hasScenarios, true);
  assert.equal(configurationSelection.includesNativeJavaImport, false);
  assert.equal(configurationSelection.scenarios.length, 1);
  assert.ok(
    configurationSelection.scenarios[0].tags.includes(
      "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001",
    ),
  );
  assert.ok(configurationSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const xcomSelection = discoverNativeDesktopSelection("xcom2ModuleActivationNativeGui");
  assert.equal(xcomSelection.hasScenarios, true);
  assert.equal(xcomSelection.includesNativeJavaImport, false);
  assert.equal(xcomSelection.scenarios.length, 1);
  assert.ok(xcomSelection.scenarios[0].tags.includes("@REQ-XCOM2-MODULE-ACTIVATION-001"));
  assert.ok(xcomSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const layoutSelection = discoverNativeDesktopSelection("desktopLayoutNativeGui");
  assert.equal(layoutSelection.hasScenarios, true);
  assert.equal(layoutSelection.includesNativeJavaImport, false);
  assert.equal(layoutSelection.scenarios.length, 1);
  assert.ok(layoutSelection.scenarios[0].tags.includes("@REQ-LAYOUT-DESKTOP-001"));
  assert.ok(layoutSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const selection = discoverNativeDesktopSelection("refactorKitJavaImportNativeGui");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.includesNativeJavaImport, true);
  assert.equal(selection.scenarios.length, 1);
  assert.ok(selection.scenarios[0].tags.includes("@REQ-REFACTORKIT-JAVA-IMPORT-002"));
  assert.ok(selection.scenarios[0].tags.includes("@implemented-and-validated"));
});

test("implemented desktop discovery selects the exact harness and native requirements", () => {
  const selection = discoverNativeDesktopSelection("implementedDesktopTauriWebdriver");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.includesNativeJavaImport, true);
  assert.equal(selection.scenarios.length, 7);
  assert.match(
    dryRunSummary("implementedDesktopTauriWebdriver"),
    /7 scenarios \(7 skipped\)[\s\S]*198 steps \(198 skipped\)/,
  );
  assert.deepEqual(
    selection.scenarios.flatMap(({ tags }) => tags.filter((tag) => tag.startsWith("@REQ-"))).sort(),
    [
      "@REQ-DESKTOP-FILE-OPEN-001",
      "@REQ-LAYOUT-DESKTOP-001",
      "@REQ-REFACTORKIT-JAVA-IMPORT-002",
      "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001",
      "@REQ-XCOM2-MODULE-ACTIVATION-001",
      "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001",
      "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
    ],
  );
  assert.ok(selection.scenarios.every(({ tags }) => tags.includes("@implemented-and-validated")));

  assert.deepEqual(
    selectedScenarios("implementedDesktopTauriHarness")
      .flatMap(({ tags }) => tags.filter((tag) => tag.startsWith("@REQ-")))
      .sort(),
    [
      "@REQ-REFACTORKIT-JAVA-IMPORT-001",
      "@REQ-REFACTORKIT-TS-001",
      "@REQ-REFACTORKIT-TS-002",
      "@REQ-XCOM2-MACHINE-SETTINGS-001",
      "@REQ-XCOM2-PROJECT-FOUNDRY-001",
      "@REQ-XCOM2-PROJECT-FOUNDRY-002",
      "@REQ-XCOM2-PROJECT-FOUNDRY-003",
      "@REQ-XCOM2-PROJECT-FOUNDRY-004",
    ],
  );
  assert.match(
    dryRunSummary("implementedDesktopTauriHarness"),
    /8 scenarios \(8 skipped\)[\s\S]*301 steps \(301 skipped\)/,
  );
});

test("process scanning matches only the exact native sandbox environment value", async () => {
  const procRoot = await mkdtemp(path.join(tmpdir(), "native-story-proc-"));
  const sandboxPath = "/tmp/native-story-exact-sandbox";
  try {
    const environments = new Map([
      [100, `A=1\0IDE_STORY_NATIVE_GUI_SANDBOX_PATH=${sandboxPath}\0`],
      [101, `A=1\0OTHER_PATH=${sandboxPath}\0`],
      [102, `IDE_STORY_NATIVE_GUI_SANDBOX_PATH=${sandboxPath}-other\0`],
      [103, "A=1\0"],
    ]);
    for (const [processId, environment] of environments) {
      const directory = path.join(procRoot, String(processId));
      await mkdir(directory);
      await writeFile(path.join(directory, "environ"), environment, "utf8");
    }

    assert.deepEqual(
      await findNativeDesktopSandboxProcesses(sandboxPath, {
        procRoot,
        excludeProcessIds: [],
      }),
      [100],
    );
  } finally {
    await rm(procRoot, { recursive: true, force: true });
  }
});

test("post-run cleanup TERM/KILLs detached exact-sandbox processes without unrelated kills", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-detached-cleanup-"));
  const sandboxPath = path.join(directory, "sandbox");
  const script =
    "import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
  let owned;
  let unrelated;
  try {
    owned = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, path.join(directory, "owned")],
      {
        detached: true,
        env: { ...process.env, IDE_STORY_NATIVE_GUI_SANDBOX_PATH: sandboxPath },
        stdio: "ignore",
      },
    );
    unrelated = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, path.join(directory, "unrelated")],
      {
        detached: true,
        env: { ...process.env, IDE_STORY_NATIVE_GUI_SANDBOX_PATH: `${sandboxPath}-unrelated` },
        stdio: "ignore",
      },
    );
    const ownedProcessId = Number(await waitForFile(path.join(directory, "owned")));
    const unrelatedProcessId = Number(await waitForFile(path.join(directory, "unrelated")));

    const evidence = await cleanupNativeDesktopSandboxProcesses(sandboxPath, {
      termTimeoutMs: 25,
      killTimeoutMs: 500,
      pollIntervalMs: 10,
    });

    assert.ok(evidence.detectedProcessIds.includes(ownedProcessId));
    assert.ok(evidence.termSignaledProcessIds.includes(ownedProcessId));
    assert.ok(evidence.killSignaledProcessIds.includes(ownedProcessId));
    assert.deepEqual(evidence.survivorProcessIds, []);
    await assertProcessGone(ownedProcessId);
    assert.doesNotThrow(() => process.kill(unrelatedProcessId, 0));
    assert.equal(evidence.detectedProcessIds.includes(unrelatedProcessId), false);
  } finally {
    for (const child of [owned, unrelated]) {
      if (!child?.pid) continue;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        assert.equal(error.code, "ESRCH");
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("sandbox cleanup records bounded TERM and KILL phases", async () => {
  let remaining = [200, 201];
  const signals = [];
  const evidence = await cleanupNativeDesktopSandboxProcesses("/tmp/bounded-native-sandbox", {
    findProcesses: async () => remaining,
    sendSignal: (processId, signal) => {
      signals.push([processId, signal]);
      if (signal === "SIGKILL")
        remaining = remaining.filter((candidate) => candidate !== processId);
    },
    termTimeoutMs: 1,
    killTimeoutMs: 50,
    pollIntervalMs: 1,
  });

  assert.deepEqual(signals.slice(0, 2), [
    [200, "SIGTERM"],
    [201, "SIGTERM"],
  ]);
  assert.ok(signals.some(([processId, signal]) => processId === 200 && signal === "SIGKILL"));
  assert.ok(signals.some(([processId, signal]) => processId === 201 && signal === "SIGKILL"));
  assert.deepEqual(evidence.detectedProcessIds, [200, 201]);
  assert.deepEqual(evidence.survivorProcessIds, []);
  assert.equal(evidence.termTimeoutMs, 1);
  assert.equal(evidence.killTimeoutMs, 50);
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
