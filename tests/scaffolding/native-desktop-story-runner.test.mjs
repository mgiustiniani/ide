import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertAuthoredSelection } from "./cucumber-selection.mjs";
import { discoverCucumberSelection, discoverCucumberSelections } from "../../scripts/cucumber-selection.mjs";
import * as cucumberProfiles from "../../cucumber.js";

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
  reuseNativeAppImage,
  runNativeDesktopStory,
  runOwnedProcess,
} from "../../scripts/run-native-desktop-story.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js");

// This suite never changes checked-in features or Cucumber configuration. Run the
// Cucumber batch discovery once, then reuse each frozen profile result for the
// subsequent count, tag and authored-step assertions in this test process.
// Fixture-specific discovery and actual runner invocations remain fresh.
const repositorySelections = new Map();
let batchSelections;
function repositorySelection(profile) {
  let selection = repositorySelections.get(profile);
  if (!selection) {
    batchSelections ??= discoverCucumberSelections({repositoryRoot,profiles:Object.keys(cucumberProfiles)});
    selection = discoverNativeDesktopSelection(profile,{discover:()=>batchSelections.get(profile)});
    repositorySelections.set(profile, selection);
  }
  return selection;
}

function selectedScenarios(profile, config = "cucumber.js") {
  return discoverCucumberSelection({ repositoryRoot, profile, config, cucumberEntry }).map(
    (scenario) => ({ ...scenario, tags: [...scenario.tags] }),
  );
}

function selectedScenarioCount(profile, config = "cucumber.js") {
  return selectedScenarios(profile, config).length;
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
    assert.equal(launch.command, environment.XVFB_RUN_PATH);
    assert.deepEqual(launch.arguments.slice(0, 6), [
      "--auto-servernum",
      "--server-args=-screen 0 1440x900x24",
      "--",
      environment.DBUS_RUN_SESSION_PATH,
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

test("Wayland chooses the private compositor launcher and resolves its tools without Xvfb", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-wayland-prerequisites-"));
  try {
    const environment = {
      PATH: "",
      TAURI_DRIVER_PATH: await executable(directory, "tauri-driver"),
      WEBKIT_WEBDRIVER_PATH: await executable(directory, "WebKitWebDriver"),
      DBUS_RUN_SESSION_PATH: await executable(directory, "dbus-run-session"),
      KWIN_WAYLAND_PATH: await executable(directory, "kwin_wayland"),
      QDBUS6_PATH: await executable(directory, "qdbus6"),
    };
    const resolved = await resolveNativeDesktopPrerequisites(environment, {
      applicationPath: await executable(directory, "IDE.AppImage"),
      displayBackend: "wayland",
    });
    assert.equal(resolved.IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH, undefined);
    assert.equal(resolved.IDE_STORY_NATIVE_GUI_KWIN_WAYLAND_PATH, environment.KWIN_WAYLAND_PATH);
    assert.equal(resolved.IDE_STORY_NATIVE_GUI_QDBUS6_PATH, environment.QDBUS6_PATH);
    const launch = nativeDesktopLaunchCommand(resolved, "javaCursorNavigationAppImageNativeGui", "wayland");
    assert.equal(launch.command, environment.DBUS_RUN_SESSION_PATH);
    assert.deepEqual(launch.arguments.slice(0, 2), ["--", "/bin/bash"]);
    assert.equal(path.basename(launch.arguments[2]), "run-native-wayland-session.sh");
    assert.deepEqual(launch.arguments.slice(-2), ["--profile", "javaCursorNavigationAppImageNativeGui"]);
    assert.equal(resolved.IDE_STORY_NATIVE_GUI_WL_COPY_PATH, undefined);
    const debuggerOptions = {
      applicationPath: resolved.IDE_STORY_NATIVE_GUI_APPLICATION_PATH,
      displayBackend: "wayland",
      requiresWaylandClipboard: true,
    };
    await assert.rejects(resolveNativeDesktopPrerequisites(environment, debuggerOptions), /WL_COPY_PATH/);
    const writer = await executable(directory, "wl-copy");
    const reader = await executable(directory, "wl-paste");
    const debuggerTools = await resolveNativeDesktopPrerequisites({
      ...environment, WL_COPY_PATH: writer, WL_PASTE_PATH: reader,
    }, debuggerOptions);
    assert.equal(debuggerTools.IDE_STORY_NATIVE_GUI_WL_COPY_PATH, writer);
    assert.equal(debuggerTools.IDE_STORY_NATIVE_GUI_WL_PASTE_PATH, reader);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("reusing an AppImage requires the packaged artifact and bytes recorded by the runner", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-replay-"));
  try {
    const applicationPath = path.join(directory, "IDE.AppImage");
    const manifestPath = path.join(directory, "runtime-paths.json");
    const content = "recorded AppImage";
    await writeFile(applicationPath, content, { mode: 0o755 });
    const sha256 = createHash("sha256").update(content).digest("hex");
    const manifest = {
      executables: { IDE_STORY_NATIVE_GUI_APPLICATION_PATH: applicationPath },
      evidence: { artifactKind: "appimage", packagedApplication: true, applicationSha256: sha256 },
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.deepEqual(await reuseNativeAppImage(manifestPath), {
      path: applicationPath, sha256,
      command: { executable: "reuse AppImage", arguments: [manifestPath] },
      timeoutMs: 0,
    });
    await writeFile(applicationPath, "a different AppImage at the same path");
    await assert.rejects(reuseNativeAppImage(manifestPath), /no longer matches/);
    manifest.evidence.artifactKind = "release-no-bundle";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(reuseNativeAppImage(manifestPath), /must identify a packaged AppImage/);
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

test("AppImage native execution records packaged evidence and enables extraction mode", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-appimage-"));
  const applicationPath = path.join(artifactRoot, "IDE_0.1.0_amd64.AppImage");
  const applicationSha256 = "b".repeat(64);
  const prerequisites = {
    IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: process.execPath,
    IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: process.execPath,
    IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: process.execPath,
    IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: process.execPath,
    IDE_STORY_NATIVE_GUI_APPLICATION_PATH: applicationPath,
  };
  try {
    const application = {
      path: applicationPath,
      sha256: applicationSha256,
      command: {
        executable: "pnpm",
        arguments: ["--filter", "@ide/desktop", "tauri", "build", "--bundles", "appimage", "--ci"],
      },
      timeoutMs: NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
    };
    const result = await runNativeDesktopStory("javaLanguageIntelligenceAppImageNativeGui", {
      environment: { PATH: process.env.PATH },
      applicationPath,
      artifactKind: "appimage",
      selectsScenarios: () => true,
      buildApplication: async () => application,
      resolvePrerequisites: async (_environment, options) => {
        assert.deepEqual(options, {
          applicationPath,
          requiresNativeJavaImport: false,
        });
        return prerequisites;
      },
      createSandbox: async (options) => createNativeDesktopSandbox({ ...options, artifactRoot }),
      run: async (_command, _arguments, options) => {
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION, "1");
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_ARTIFACT_KIND, "appimage");
        assert.equal(options.environment.APPIMAGE_EXTRACT_AND_RUN, "1");
      },
      cleanupSandboxProcesses: async (sandboxPath) => ({
        sandboxPath,
        detectedProcessIds: [],
        termSignaledProcessIds: [],
        killSignaledProcessIds: [],
        survivorProcessIds: [],
      }),
    });

    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.evidence.packagedApplication, true);
    assert.equal(manifest.evidence.artifactKind, "appimage");
    assert.equal(manifest.evidence.applicationSha256, applicationSha256);
    assert.deepEqual(manifest.build, {
      command: application.command,
      timeoutMs: NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("Java GUI profiles requiring long execution receive an extended runtime budget", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-java-code-actions-timeout-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  try {
    for (const profile of [
      "javaCodeActionsNativeGui",
      "javaCoverageNativeGui",
      "javaTestDiscoveryNativeGui",
      "javaTryCatchCodeActionNativeGui",
      "javaSemanticTypeRenameNativeGui",
      "javaParameterRenameNativeGui",
      "javaProjectTestTemplatesGradleNativeGui",
      "javaProjectCoverageNativeGui",
      "javaProjectTestRerunNativeGui",
      "javaDebuggerNativeGui",
      "javaGradleDiagnosticsNativeGui",
      "javaGradleCompactSourceNativeGui",
      "javaEntryPointsNativeGui",
      "javaDeclaredProjectNativeGui",
      "javaDeclaredProjectTestsNativeGui",
      "javaEditorDiagnosticsNativeGui",
      "java26EditorDiagnosticsNativeGui",
      "java26TestSourceEditorDiagnosticsNativeGui",
      "javaGradleEditorDiagnosticsNativeGui",
      "javaMultiModuleEditorDiagnosticsNativeGui",
      "javaTestSourceEditorDiagnosticsNativeGui",
      "javaMetadataOnlyEditorDiagnosticsNativeGui",
      "javaExternalSourceEditorDiagnosticsNativeGui",
      "javaApplicationInputNativeGui",
      "javaProjectWorkingDirectoryNativeGui",
      "javaProjectDebuggerNativeGui",
      "javaJdiDebuggerNativeGui",
      "javaGradleBatchCleanupNativeGui",
      "javaBatchCleanupNativeGui",
      "javaProjectContextNativeGui",
      "java26ProjectContextNativeGui",
      "java26MavenContextNativeGui",
      "java26GradleContextNativeGui",
      "java27ProjectContextNativeGui",
      "java27GradleContextNativeGui",
      "java27MavenContextNativeGui",
      "javaGradleJpmsV5NativeGui",
      "javaMavenJpmsV5NativeGui",
      "javaGradlePreviewNativeGui",
      "javaGradleModuleCreateNativeGui",
      "javaBuildToolsNativeGui",
      "javaSourceFileCreationNativeGui",
      "javaMavenFailsafeContextNativeGui",
      "javaSelectedTestDebuggerNativeGui",
      "javaFailedTestDebuggerNativeGui",
      "javaFrameworkTestDebuggerNativeGui",
      "javaCursorParameterReorderNativeGui",
      "javaCursorParameterRenameNativeGui",
      "javaPublicParameterReorderRefusalNativeGui",
      "javaCursorParameterAdditionNativeGui",
      "javaCursorParameterRemovalNativeGui",
      "javaMakePublicNativeGui",
      "javaRefactorKitLspNativeGui",
      "javaCursorParameterTypeChangeNativeGui",
    ]) {
      const result = await runNativeDesktopStory(profile, {
        environment: {
          ...process.env,
          IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE: "1",
          IDE_REFACTORKIT_LSP: process.execPath,
        },
        selectsScenarios: () => true,
        buildApplication: async () => ({ path: applicationPath }),
        resolvePrerequisites: async () => ({
          IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_APPLICATION_PATH: applicationPath,
        }),
        createSandbox: async (options) => createNativeDesktopSandbox({ ...options, artifactRoot }),
        run: async (_command, _arguments, options) => {
          assert.equal(
            options.timeoutMs,
              (profile === "javaGradleCompactSourceNativeGui" || profile === "java26ProjectContextNativeGui" || profile === "javaSelectedTestDebuggerNativeGui" || profile === "javaFailedTestDebuggerNativeGui" || profile === "javaFrameworkTestDebuggerNativeGui" || profile === "javaGradleCompositeExecutionNativeGui")
              ? 360_000
              : profile === "javaEntryPointsNativeGui" ||
              profile === "javaDeclaredProjectNativeGui" ||
              profile === "javaDeclaredProjectTestsNativeGui" ||
              profile === "javaEditorDiagnosticsNativeGui" ||
              profile === "java26EditorDiagnosticsNativeGui" ||
              profile === "java26TestSourceEditorDiagnosticsNativeGui" ||
              profile === "javaGradleEditorDiagnosticsNativeGui" ||
              profile === "javaMultiModuleEditorDiagnosticsNativeGui" ||
              profile === "javaTestSourceEditorDiagnosticsNativeGui" ||
              profile === "javaMetadataOnlyEditorDiagnosticsNativeGui" ||
              profile === "javaExternalSourceEditorDiagnosticsNativeGui" ||
              profile === "javaApplicationInputNativeGui" ||
              profile === "javaProjectWorkingDirectoryNativeGui" ||
              profile === "javaGradleBatchCleanupNativeGui" ||
              profile === "javaMoveMemberNativeGui" ||
              profile === "java26GradleContextNativeGui" ||
              profile === "javaGradlePreviewNativeGui" ||
              profile === "javaGradleJpmsV5NativeGui" ||
              profile === "javaMavenJpmsV5NativeGui" ||
              profile === "javaGradleModuleCreateNativeGui" ||
              profile === "java27GradleContextNativeGui" ||
              profile === "java27MavenContextNativeGui"
              ? 240_000
              : 180_000,
          );
          if (profile === "javaRefactorKitLspNativeGui") {
            assert.equal(options.environment.IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE, "1");
            assert.equal(options.environment.IDE_REFACTORKIT_LSP, process.execPath);
          }
        },
        cleanupSandboxProcesses: async (sandboxPath) => ({
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        }),
      });
      assert.equal(result.skipped, false);
    }

    for (const profile of ["javaProjectModelSourceRootRefactoringNativeGui", "editorRecoveryHistoryNativeGui"]) {
    const sourceRoot = await runNativeDesktopStory(
      profile,
      {
        selectsScenarios: () => true,
        buildApplication: async () => ({ path: applicationPath }),
        resolvePrerequisites: async () => ({
          IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_APPLICATION_PATH: applicationPath,
        }),
        createSandbox: async (options) => createNativeDesktopSandbox({ ...options, artifactRoot }),
        run: async (_command, _arguments, options) => {
          assert.equal(options.timeoutMs, 240_000);
        },
        cleanupSandboxProcesses: async (sandboxPath) => ({
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        }),
      },
    );
    assert.equal(sourceRoot.skipped, false);
    }

    const gradlePackageMove = await runNativeDesktopStory(
      "javaGradleProjectModelPackageMoveNativeGui",
      {
        selectsScenarios: () => true,
        buildApplication: async () => ({ path: applicationPath }),
        resolvePrerequisites: async () => ({
          IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH: process.execPath,
          IDE_STORY_NATIVE_GUI_APPLICATION_PATH: applicationPath,
        }),
        createSandbox: async (options) => createNativeDesktopSandbox({ ...options, artifactRoot }),
        run: async (_command, _arguments, options) => {
          assert.equal(options.timeoutMs, 240_000);
        },
        cleanupSandboxProcesses: async (sandboxPath) => ({
          sandboxPath,
          detectedProcessIds: [],
          termSignaledProcessIds: [],
          killSignaledProcessIds: [],
          survivorProcessIds: [],
        }),
      },
    );
    assert.equal(gradlePackageMove.skipped, false);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("RefactorKit LSP GUI profile requires an explicit source-built server override", async () => {
  await assert.rejects(
    runNativeDesktopStory("javaRefactorKitLspNativeGui", {
      environment: { PATH: process.env.PATH ?? "" },
      selectsScenarios: () => true,
      buildApplication: async () => assert.fail("the missing LSP override must fail before build"),
    }),
    /IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE=1/u,
  );
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

test("focused Pi workspace Agent route fresh-builds into an isolated lease and leaves launch to Story", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "native-story-pi-workspace-agent-"));
  const applicationPath = await executable(artifactRoot, "ide-desktop");
  const calls = [];
  try {
    const application = {
      path: applicationPath,
      sha256: "9".repeat(64),
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
    };

    const result = await runNativeDesktopStory("piWorkspaceAgentNativeGui", {
      environment: untrustedEnvironment,
      applicationPath,
      buildApplication: async (options) => {
        calls.push("fresh-release-no-bundle-build");
        assert.equal(options.environment, untrustedEnvironment);
        assert.equal(options.applicationPath, applicationPath);
        assert.equal(options.timeoutMs, NATIVE_DESKTOP_BUILD_TIMEOUT_MS);
        return application;
      },
      resolvePrerequisites: async (_environment, options) => {
        calls.push("absolute-native-prerequisites");
        assert.deepEqual(options, {
          applicationPath,
          requiresNativeJavaImport: false,
        });
        assert.ok(Object.values(prerequisites).every(path.isAbsolute));
        return prerequisites;
      },
      createSandbox: async (options) => {
        calls.push("empty-isolated-environment-lease");
        return createNativeDesktopSandbox({ ...options, artifactRoot });
      },
      run: async (command, arguments_, options) => {
        calls.push("Story-owned-launch-boundary");
        assert.equal(command, prerequisites.IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH);
        assert.ok(path.isAbsolute(command));
        assert.deepEqual(arguments_.slice(-2), ["--profile", "piWorkspaceAgentNativeGui"]);
        assert.equal(
          arguments_.some((argument) => /tauri-harness|deterministic|package/iu.test(argument)),
          false,
        );
        assert.equal(options.timeoutMs, NATIVE_DESKTOP_OUTER_TIMEOUT_MS);
        assert.equal(options.environment.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
        assert.ok(
          Object.values(prerequisites).every(
            (executablePath) => path.isAbsolute(executablePath) && executablePath.length > 1,
          ),
        );

        const leaseRoot = options.environment.IDE_STORY_NATIVE_GUI_SCENARIO_ROOT;
        const sandboxRoot = options.environment.IDE_STORY_NATIVE_GUI_SANDBOX_PATH;
        assert.notEqual(leaseRoot, options.environment.IDE_WORKSPACE_ROOT);
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
            path.relative(sandboxRoot, options.environment[variable]).startsWith(".."),
            false,
            variable,
          );
        }
        assert.deepEqual(await readdir(leaseRoot), []);
        assert.deepEqual(await readdir(options.environment.IDE_WORKSPACE_ROOT), []);
        assert.deepEqual(await readdir(options.environment.IDE_HOME), []);
      },
      cleanupSandboxProcesses: async (sandboxPath) => {
        calls.push("bounded-timeout-process-cleanup");
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
      "absolute-native-prerequisites",
      "empty-isolated-environment-lease",
      "Story-owned-launch-boundary",
      "bounded-timeout-process-cleanup",
    ]);
    assert.equal(result.skipped, false);
    assert.deepEqual(await readdir(result.sandbox.paths.scenarioRoot), []);

    const manifest = JSON.parse(
      await readFile(path.join(result.sandbox.paths.artifacts, "runtime-paths.json"), "utf8"),
    );
    assert.equal(manifest.target, "desktop/tauri-webdriver");
    assert.equal(manifest.profile, "piWorkspaceAgentNativeGui");
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
    assert.ok(manifest.selectedScenarios[0].tags.includes("@REQ-PI-WORKSPACE-AGENT-001"));
    assert.ok(manifest.selectedScenarios[0].tags.includes("@implemented-and-validated"));
    assert.ok(manifest.selectedScenarios[0].tags.includes("@native-gui"));
    assert.equal(
      manifest.selectedScenarios[0].tags.includes("@implemented-not-e2e-validated"),
      false,
    );
    assert.ok(Object.values(manifest.executables).every(path.isAbsolute));

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

test("runtime PATH includes explicitly configured build tools and owned executables", () => {
  const sandboxEnvironment = {
    PATH: "/home/developer/.local/bin:/usr/local/bin",
    IDE_REFACTORKIT_DAEMON: "/home/developer/.local/bin/refactorkit",
    IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
    IDE_JAVA_CONTEXT_TEST_GRADLE: "/tools/gradle/bin/gradle",
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
    [
      "/owned/tauri/bin",
      "/owned/webkit/bin",
      "/usr/bin",
      "/owned/application",
      "/tools/gradle/bin",
      "/bin",
    ].join(path.delimiter),
  );
  assert.equal(runtime.IDE_REFACTORKIT_DAEMON, undefined);
  assert.equal(runtime.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, undefined);
  assert.equal(sandboxEnvironment.PATH, "/home/developer/.local/bin:/usr/local/bin");
  assert.equal(sandboxEnvironment.IDE_REFACTORKIT_DAEMON, "/home/developer/.local/bin/refactorkit");
  assert.equal(Object.isFrozen(runtime), true);
});

test("Java 27 Maven and Gradle native profiles isolate the matching context story", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  for (const [profile, scenarioName, requirementTag, authoredStepCount, commandName] of [
    [
      "java27MavenContextNativeGui",
      "Build, run, test and debug Maven Java 27 with the selected full JDK",
      "@native-java27-maven-context",
      11,
      "java27-maven-context",
    ],
    [
      "java27GradleContextNativeGui",
      "Synchronize Gradle Java 27 context with the selected full JDK",
      "@native-java27-gradle-context",
      33,
      "java27-gradle-context",
    ],
  ]) {
    const selection = repositorySelection(profile);
    assert.equal(selection.scenarios.length, 1, `${profile} should select one scenario`);
    assert.equal(selection.scenarios[0].name, scenarioName);
    assert.equal(selection.scenarios[0].authoredStepCount, authoredStepCount);
    assert.ok(selection.scenarios[0].tags.includes(requirementTag));
    assert.equal(
      packageJson.scripts[`test:story:req-ide-java-project-context-native-001:${commandName}`],
      `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
    );
  }
});

test("native runner profiles select promoted and focused native scenarios", () => {
  for (const [profile, count] of [
    ["desktopFileOpenNativeGui", 2],
    ["editorRecoveryNativeGui", 1],
    ["editorCloseGuardsNativeGui", 2],
    ["javaExecutionNativeGui", 1],
    ["javaLanguageIntelligenceCoreNativeGui", 1],
    ["gitWorkspaceNativeGui", 5],
    ["gitHistoryNativeGui", 1],
    ["gitBranchDeletionNativeGui", 1],
    ["javaProjectContextGitBranchNativeGui", 1],
    ["javaGradleProjectContextGitBranchNativeGui", 1],
    ["javaProjectContextGitRebaseNativeGui", 1],
    ["javaGradleProjectContextGitRebaseNativeGui", 1],
    ["java26PreviewImportNativeGui", 1],
    ["javaPreviewCompatibilityNativeGui", 1],
    ["java27PreviewImportNativeGui", 1],
    ["javaJdtlsRuntimePreferenceNativeGui", 1],
    ["javaClassChangeReviewNativeGui", 1],
    ["javaDropFrameNativeGui", 1],
    ["javaRestartExecutionNativeGui", 1],
    ["javaExecutionCommandsNativeGui", 1],
    ["javaLanguageIntelligenceAppImageNativeGui", 2],
    ["javaExceptionBreakpointsNativeGui", 1],
    ["javaOrganizeImportsNativeGui", 1],
    ["javaProjectScaffoldNativeGui", 2],
    ["java26ScaffoldNativeGui", 1],
    ["java26ProjectContextNativeGui", 2],
    ["java26MavenContextNativeGui", 1],
    ["java26GradleContextNativeGui", 1],
    ["java27ProjectContextNativeGui", 2],
    ["java27GradleContextNativeGui", 1],
    ["java27MavenContextNativeGui", 1],
    ["javaProjectTextSearchNativeGui", 1],
    ["javaGradleCompositeExecutionNativeGui", 2],
    ["implementedDesktopTauriWebdriver", 16],
    ["javaDatabaseNativeGui", 5],
    ["refactorKitJavaImportNativeGui", 1],
    ["desktopLayoutNativeGui", 1],
    ["piWorkspaceAgentNativeGui", 1],
    ["xcom2MachineSettingsMissingSteamNativeGui", 1],
    ["xcom2ModuleActivationNativeGui", 1],
    ["xcom2ModuleConfigurationActivationNativeGui", 1],
    ["xcom2ModuleConfigurationDiagnosticsNativeGui", 1],
  ]) {
    const selection = repositorySelection(profile);
    assert.equal(selection.hasScenarios, true, `${profile}: has selected scenarios`);
    assert.equal(selection.scenarios.length, count, `${profile}: selected scenario count`);
  }
  assert.equal(profileSelectsScenarios("desktopFileOpenNativeGui"), true);

  const databaseSelection = repositorySelection("javaDatabaseNativeGui");
  assert.equal(databaseSelection.scenarios.length, 5);
  assertAuthoredSelection("javaDatabaseNativeGui", 5, 37, databaseSelection.scenarios);
  assert.ok(databaseSelection.scenarios[0].tags.includes("@REQ-IDE-JAVA-DATABASE-001"));
  assert.ok(databaseSelection.scenarios[0].tags.includes("@partial"));

  const exceptionSelection = repositorySelection("javaExceptionBreakpointsNativeGui");
  assert.equal(exceptionSelection.hasScenarios, true);
  assert.equal(exceptionSelection.includesNativeJavaImport, false);
  assert.equal(exceptionSelection.scenarios.length, 1);
  assertAuthoredSelection("javaExceptionBreakpointsNativeGui", 1, 3, exceptionSelection.scenarios);
  assert.ok(exceptionSelection.scenarios[0].tags.includes("@native-java-exception-breakpoints"));
  assert.ok(exceptionSelection.scenarios[0].tags.includes("@REQ-IDE-JAVA-EXECUTION-NATIVE-001"));

  for (const [profile, requirement] of [
    ["editorCloseGuardsNativeGui", "@REQ-IDE-EDITOR-CLOSE-GUARDS-001"],
    ["javaExecutionNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001"],
  ]) {
    const focused = repositorySelection(profile);
    assert.equal(focused.hasScenarios, true);
    assert.equal(focused.includesNativeJavaImport, false);
    const guard = profile === "editorCloseGuardsNativeGui";
    assert.equal(focused.scenarios.length, guard ? 2 : 1);
    assertAuthoredSelection(profile, guard ? 2 : 1, guard ? 25 : 16, focused.scenarios);
    assert.ok(focused.scenarios[0].tags.includes(requirement));
    assert.ok(focused.scenarios[0].tags.includes("@partial"));
  }
  for (const [profile, requirement, scenarios, steps] of [
    ["javaCursorNavigationNativeGui", "@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001", 1, 30],
    ["javaCursorNavigationAppImageNativeGui", "@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001", 1, 30],
    ["javaCodeActionsNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 6, 94],
    ["javaJavadocNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 2, 30],
    ["javaOnTypeFormattingNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 1, 11],
    ["javaOrganizeImportsNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 1, 9],
    ["javaFormatterProfileNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 1, 18],
    ["javaLocalRenameNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 1, 9],
    ["javaParameterRenameNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 1, 9],
    ["javaCrossFileRenameNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 2, 19],
    ["javaSemanticTypeRenameNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 2, 20],
    ["javaMultiDocumentCodeActionNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 2, 21],
    ["javaTryCatchCodeActionNativeGui", "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001", 1, 9],
    ["javaProjectContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 31],
    ["javaReferenceBackendNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 9],
    ["javaReferenceBackendAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 9],
    ["javaCompactSourceNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 21],
    ["javaGradleCompactSourceNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 21],
    ["javaNamedModuleSourceCreationNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 22],
    ["java26ProjectContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 20],
    ["java26MavenContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 10],
    ["java26GradleContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 10],
    ["java27ProjectContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 44],
    ["java27GradleContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 33],
    ["javaCoverageNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 2, 24],
    ["javaCoverageAppImageNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 2, 24],
    ["javaFlightRecorderAppImageNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 1, 11],
    ["java27MavenContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 11],
    ["javaGradleJpmsV5NativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 13],
    ["javaMavenJpmsV5NativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 12],
    ["javaGradlePreviewNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 8],
    ["javaMavenFailsafeContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 32],
    ["javaSelectedTestDebuggerNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 16],
    ["javaFailedTestDebuggerNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 4, 32],
    ["javaFrameworkTestDebuggerNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 3, 24],
    ["javaProjectWorkingDirectoryNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 18],
    ["javaProjectWorkingDirectoryAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 18],
    ["javaGradleDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 6, 24],
    ["javaGradleDiagnosticsAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 6, 24],
    ["javaMavenPreparationAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 3, 9],
    ["javaMavenModuleCreateNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaGradleModuleCreateNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 12],
    ["javaProjectTestTemplatesNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 7],
    ["javaProjectScaffoldNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 21],
    ["javaSpringBootStarterAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 6],
    ["javaSpringBootGradleStarterAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 12],
    ["java26ScaffoldNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 6],
    ["javaProjectTextSearchNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 9],
    ["javaEntryPointsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 3, 32],
    ["javaDeclaredProjectNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 3, 26],
    ["javaDeclaredProjectTestsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 18],
    ["javaEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 16],
    ["java26EditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 16],
    ["java26TestSourceEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 18],
    ["javaGradleEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 16],
    ["javaMultiModuleEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 18],
    ["javaTestSourceEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 18],
    ["javaMetadataOnlyEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 5],
    ["javaExternalSourceEditorDiagnosticsNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 12],
    ["javaProjectExecutionNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 12],
    ["javaProjectWrapperNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 15],
    ["javaProjectCustomOutputNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 21],
    ["javaProjectDebuggerNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 31],
    ["javaConditionalDebuggerAppImageNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 1, 10],
    ["javaProjectDebuggerAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 31],
    ["javaReferenceDevelopmentAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 18],
    ["javaProjectModelSourceRootRefactoringAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 12],
    ["javaGradleProjectExecutionNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 12],
    ["javaGradleCompositeExecutionNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 47],
    ["javaGradleCustomSourceSetNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 29],
    ["javaGradleKotlinDslNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 8],
    ["javaProjectDiscoveryNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 22],
    ["javaProjectCoverageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 5, 36],
    ["javaMavenTestJvmSelectionAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 1, 13],
    ["javaProjectCoverageAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 6, 45],
    [
      "javaProjectGradleMultimoduleCoverageNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      1,
      9,
    ],
    ["javaProjectTestRerunNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 2, 32],
    ["javaProjectTestWorkflowsAppImageNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", 11, 104],
    ["httpClientNativeGui", "@REQ-IDE-HTTP-CLIENT-001", 4, 20],
    ["httpOAuthAuthorizationNativeGui", "@REQ-IDE-HTTP-CLIENT-001", 1, 7],
    ["httpRequestFilesNativeGui", "@REQ-IDE-HTTP-CLIENT-001", 1, 5],
    ["javaBatchCleanupNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaGradleBatchCleanupNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractDelegateAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 10],
    ["javaSdkRefactoringNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 8, 51],
    ["javaSdkFormatterProfileNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractMethodNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractVariableNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractParameterNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractFieldNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaCursorParameterReorderNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 15],
    ["javaCursorParameterRenameNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    [
      "javaPublicParameterReorderRefusalNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      1,
      6,
    ],
    ["javaCursorParameterAdditionNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 12],
    ["javaCursorParameterRemovalNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaCursorParameterTypeChangeNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractInterfaceNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaMakePublicNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 3, 18],
    ["javaRefactorKitLspNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaExtractSuperclassNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaMoveMemberNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 12],
    ["javaPullUpMemberNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaPushDownMemberNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaInlineVariableNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    [
      "javaProjectModelSourceRootRefactoringNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      2,
      12,
    ],
    ["javaDraftRefactoringNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaDraftRefactoringAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 6, 39],
    ["javaGradleDraftRecoveryAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaMethodRefactoringAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 12, 75],
    ["javaExtractExpressionAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 5, 30],
    ["javaMemberRefactoringAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 7, 42],
    ["javaJpqlReviewAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaJpqlOpaqueResourceAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaJpqlManagedAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 2, 10],
    ["javaJpqlNamedQueryAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 3, 18],
    ["javaGradleExtractMethodAppImageNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaDraftImportsRenameNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 1, 6],
    ["javaDraftRecoveryNativeGui", "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001", 4, 27],
    ["javaBuildToolsNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 3, 64],
    ["javaFailsafeReactorNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 2, 24],
    ["javaApplicationInputNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 9, 45],
    ["javaWorkingDirectoryNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 1, 5],
    ["javaTestJvmNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 3, 43],
    ["javaTestDiscoveryNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 5, 60],
    ["javaMavenAggregatorDiscoveryAppImageNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 1, 12],
    ["javaTestNgDiscoveryNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 2, 20],
    ["javaJupiterTestExecutionNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 2, 22],
    ["javaPlainJdkTestNgNativeGui", "@REQ-IDE-JAVA-EXECUTION-NATIVE-001", 2, 27],
    ["editorDiskComparisonNativeGui", "@REQ-IDE-EDITOR-DISK-COMPARISON-001", 3, 43],
    ["editorRecoveryHistoryNativeGui", "@REQ-IDE-EDITOR-RECOVERY-001", 2, 27],
    ["editorRecoveryFailuresNativeGui", "@REQ-IDE-EDITOR-RECOVERY-001", 2, 23],
  ]) {
    const selected = repositorySelection(profile);
    assert.equal(selected.hasScenarios, true);
    assert.equal(selected.includesNativeJavaImport, false);
    assert.equal(selected.scenarios.length, scenarios, `${profile}: selected scenario count`);
    assertAuthoredSelection(profile, scenarios, steps, selected.scenarios);
    for (const scenario of selected.scenarios) {
      assert.ok(scenario.tags.includes(requirement));
      assert.ok(scenario.tags.includes("@partial"));
    }
  }
  const recoverySelection = repositorySelection("editorRecoveryNativeGui");
  assert.equal(recoverySelection.hasScenarios, true);
  assert.equal(recoverySelection.includesNativeJavaImport, false);
  assert.equal(recoverySelection.scenarios.length, 1);
  assertAuthoredSelection("editorRecoveryNativeGui", 1, 19, recoverySelection.scenarios);
  assert.ok(recoverySelection.scenarios[0].tags.includes("@REQ-IDE-EDITOR-RECOVERY-001"));
  assert.ok(recoverySelection.scenarios[0].tags.includes("@partial"));

  const piWorkspaceAgentSelection = repositorySelection("piWorkspaceAgentNativeGui");
  assert.equal(piWorkspaceAgentSelection.hasScenarios, true);
  assert.equal(piWorkspaceAgentSelection.includesNativeJavaImport, false);
  assert.equal(piWorkspaceAgentSelection.scenarios.length, 1);
  assertAuthoredSelection("piWorkspaceAgentNativeGui", 1, 34, piWorkspaceAgentSelection.scenarios);
  assert.ok(piWorkspaceAgentSelection.scenarios[0].tags.includes("@REQ-PI-WORKSPACE-AGENT-001"));
  assert.ok(piWorkspaceAgentSelection.scenarios[0].tags.includes("@implemented-and-validated"));
  assert.equal(
    piWorkspaceAgentSelection.scenarios[0].tags.includes("@implemented-not-e2e-validated"),
    false,
  );

  const missingSteamSelection = repositorySelection(
    "xcom2MachineSettingsMissingSteamNativeGui",
  );
  assert.equal(missingSteamSelection.hasScenarios, true);
  assert.equal(missingSteamSelection.includesNativeJavaImport, false);
  assert.equal(missingSteamSelection.scenarios.length, 1);
  assertAuthoredSelection(
    "xcom2MachineSettingsMissingSteamNativeGui",
    1,
    21,
    missingSteamSelection.scenarios,
  );
  assert.ok(
    missingSteamSelection.scenarios[0].tags.includes(
      "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001",
    ),
  );
  assert.ok(missingSteamSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const diagnosticSelection = repositorySelection(
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

  const configurationSelection = repositorySelection(
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

  const xcomSelection = repositorySelection("xcom2ModuleActivationNativeGui");
  assert.equal(xcomSelection.hasScenarios, true);
  assert.equal(xcomSelection.includesNativeJavaImport, false);
  assert.equal(xcomSelection.scenarios.length, 1);
  assert.ok(xcomSelection.scenarios[0].tags.includes("@REQ-XCOM2-MODULE-ACTIVATION-001"));
  assert.ok(xcomSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const layoutSelection = repositorySelection("desktopLayoutNativeGui");
  assert.equal(layoutSelection.hasScenarios, true);
  assert.equal(layoutSelection.includesNativeJavaImport, false);
  assert.equal(layoutSelection.scenarios.length, 1);
  assert.ok(layoutSelection.scenarios[0].tags.includes("@REQ-LAYOUT-DESKTOP-001"));
  assert.ok(layoutSelection.scenarios[0].tags.includes("@implemented-and-validated"));

  const selection = repositorySelection("refactorKitJavaImportNativeGui");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.includesNativeJavaImport, true);
  assert.equal(selection.scenarios.length, 1);
  assert.ok(selection.scenarios[0].tags.includes("@REQ-REFACTORKIT-JAVA-IMPORT-002"));
  assert.ok(selection.scenarios[0].tags.includes("@implemented-and-validated"));
});

test("implemented desktop discovery selects the exact harness and native requirements", () => {
  const selection = repositorySelection("implementedDesktopTauriWebdriver");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.includesNativeJavaImport, true);
  assert.equal(selection.scenarios.length, 16);
  assertAuthoredSelection("implementedDesktopTauriWebdriver", 16, 297, selection.scenarios);
  assert.deepEqual(
    selection.scenarios.flatMap(({ tags }) => tags.filter((tag) => tag.startsWith("@REQ-"))).sort(),
    [
      "@REQ-DESKTOP-FILE-OPEN-001",
      "@REQ-DESKTOP-FILE-OPEN-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
      "@REQ-LAYOUT-DESKTOP-001",
      "@REQ-PI-WORKSPACE-AGENT-001",
      "@REQ-REFACTORKIT-JAVA-IMPORT-002",
      "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001",
      "@REQ-XCOM2-MODULE-ACTIVATION-001",
      "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001",
      "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
    ],
  );
  assert.ok(selection.scenarios.every(({ tags }) => tags.includes("@implemented-and-validated")));

  const harnessSelection = selectedScenarios("implementedDesktopTauriHarness");
  assert.deepEqual(
    harnessSelection.flatMap(({ tags }) => tags.filter((tag) => tag.startsWith("@REQ-"))).sort(),
    [
      "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
      "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
      "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
      "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
      "@REQ-REFACTORKIT-JAVA-IMPORT-001",
      "@REQ-REFACTORKIT-TS-001",
      "@REQ-REFACTORKIT-TS-002",
      "@REQ-XCOM2-MACHINE-SETTINGS-001",
      "@REQ-XCOM2-PROJECT-BUILD-RECIPE-001",
      "@REQ-XCOM2-PROJECT-FOUNDRY-001",
      "@REQ-XCOM2-PROJECT-FOUNDRY-002",
      "@REQ-XCOM2-PROJECT-FOUNDRY-003",
      "@REQ-XCOM2-PROJECT-FOUNDRY-004",
    ],
  );
  assertAuthoredSelection("implementedDesktopTauriHarness", 13, 347, harnessSelection);
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

test("CLI cancellation converts SIGTERM to an abort signal before exiting", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "native-story-cli-signal-"));
  const ready = path.join(directory, "ready");
  const runner = new URL("../../scripts/run-native-desktop-story.mjs", import.meta.url);
  const script = `
    import { writeFileSync } from "node:fs";
    import { withNativeDesktopCancellation } from ${JSON.stringify(runner.href)};
    await withNativeDesktopCancellation((signal) => new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
      writeFileSync(${JSON.stringify(ready)}, "ready");
      setTimeout(() => process.exit(2), 5000).unref();
      const keepAlive = setInterval(() => {}, 1000);
      signal.addEventListener("abort", () => clearInterval(keepAlive), { once: true });
    }));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: "ignore",
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    await waitForFile(ready);
    assert.ok(child.kill("SIGTERM"));
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
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


test("Move Member native profile binds the supported and refused method scenarios", () => {
  const selection = repositorySelection("javaMoveMemberNativeGui");
  assert.equal(selection.scenarios.length, 2);
  assertAuthoredSelection("javaMoveMemberNativeGui", 2, 12, selection.scenarios);
  for (const scenario of selection.scenarios) {
    assert.ok(scenario.tags.includes("@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001"));
    assert.ok(scenario.tags.includes("@native-java-move-member"));
    assert.ok(scenario.tags.includes("@partial"));
  }
});


test("selected test debugger profile binds Maven and Gradle native scenarios", () => {
  for (const profile of ["javaSelectedTestDebuggerNativeGui", "javaSelectedTestDebuggerAppImageNativeGui"]) {
    const selection = repositorySelection(profile);
    assertAuthoredSelection(profile, 2, 16, selection.scenarios);
    for (const scenario of selection.scenarios) {
      assert.ok(scenario.tags.includes("@native-java-selected-test-debugger"));
      assert.ok(scenario.tags.includes("@partial"));
    }
  }
});

test("failed test debugger profile binds Maven and Gradle native scenarios", () => {
  const selection = repositorySelection("javaFailedTestDebuggerNativeGui");
  assertAuthoredSelection("javaFailedTestDebuggerNativeGui", 4, 32, selection.scenarios);
  for (const scenario of selection.scenarios) {
    assert.ok(scenario.tags.includes("@native-java-failed-test-debugger"));
    assert.ok(scenario.tags.includes("@partial"));
  }
});

test("framework test debugger profile binds Jupiter and TestNG native scenarios", () => {
  const selection = repositorySelection("javaFrameworkTestDebuggerNativeGui");
  assertAuthoredSelection("javaFrameworkTestDebuggerNativeGui", 3, 24, selection.scenarios);
  for (const scenario of selection.scenarios) {
    assert.ok(scenario.tags.includes("@native-java-framework-test-debugger"));
    assert.ok(scenario.tags.includes("@partial"));
  }
});


test("Add Parameter native profile binds the existing method and acknowledged hierarchy scenarios", () => {
  const selection = repositorySelection("javaCursorParameterAdditionNativeGui");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.scenarios.length, 2);
  assertAuthoredSelection("javaCursorParameterAdditionNativeGui", 2, 12, selection.scenarios);
  assert.ok(selection.scenarios.some(scenario => scenario.tags.includes("@native-java-signature-hierarchy")));
});


test("Signature hierarchy native profile binds all three additional signature operations", () => {
  const selection = repositorySelection("javaSignatureHierarchyNativeGui");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.scenarios.length, 3);
  assertAuthoredSelection("javaSignatureHierarchyNativeGui", 3, 18, selection.scenarios);
  for (const scenario of selection.scenarios) assert.ok(scenario.tags.includes("@native-java-signature-hierarchy-variants"));
});


test("Static method-reference native profile binds explicit migration and exact rollback", () => {
  const selection = repositorySelection("javaFunctionalReferencesNativeGui");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.scenarios.length, 1);
  assertAuthoredSelection("javaFunctionalReferencesNativeGui", 1, 6, selection.scenarios);
  assert.ok(selection.scenarios[0].tags.includes("@native-java-functional-reference-signature"));
  const packaged = repositorySelection("javaFunctionalReferencesAppImageNativeGui");
  assertAuthoredSelection("javaFunctionalReferencesAppImageNativeGui", 2, 12, packaged.scenarios);
  assert.ok(packaged.scenarios.some(({ tags }) => tags.includes("@native-java-bound-reference-signature")));
});


test("Constructor selection refusal native profile preserves source and withholds a plan", () => {
  const selection = repositorySelection("javaConstructorSelectionNativeGui");
  assert.equal(selection.hasScenarios, true);
  assert.equal(selection.scenarios.length, 1);
  assertAuthoredSelection("javaConstructorSelectionNativeGui", 1, 6, selection.scenarios);
  assert.ok(selection.scenarios[0].tags.includes("@native-java-constructor-selection-refusal"));
});

test("Constructor signature native profiles bind five operations and exact rollback", () => {
  for (const [profile, count] of [["javaConstructorSignatureNativeGui", 3], ["javaConstructorSignatureVariantsNativeGui", 2]]) {
    const selection = repositorySelection(profile);
    assert.equal(selection.hasScenarios, true);
    assertAuthoredSelection(profile, count, count * 6, selection.scenarios);
  }
});

test("Constructor reference native profile binds explicit adaptation and exact rollback", () => {
  const selection = repositorySelection("javaConstructorReferencesNativeGui");
  assert.equal(selection.hasScenarios, true);
  assertAuthoredSelection("javaConstructorReferencesNativeGui", 1, 6, selection.scenarios);
});

test("Constructor delegation native profiles bind five operations and exact rollback", () => {
  for (const [profile, count] of [["javaConstructorDelegationNativeGui", 3], ["javaConstructorDelegationVariantsNativeGui", 2]]) {
    const selection = repositorySelection(profile);
    assert.equal(selection.hasScenarios, true);
    assertAuthoredSelection(profile, count, count * 6, selection.scenarios);
  }
});

test("Java Project command native profiles preserve drafts through real synchronization", () => {
  for (const tool of ["Maven", "Gradle"]) {
    const profile = `javaProject${tool}CommandsNativeGui`;
    const selection = repositorySelection(profile);
    assert.equal(selection.hasScenarios, true);
    assertAuthoredSelection(profile, 1, 5, selection.scenarios);
  }
});

test("Field type native profile binds a managed private repair and public-field refusal", () => {
  const selection = repositorySelection("javaFieldTypeNativeGui");
  assert.equal(selection.hasScenarios, true);
  assertAuthoredSelection("javaFieldTypeNativeGui", 2, 12, selection.scenarios);
});

test("module rename native profiles bind Maven and the Gradle cases for both settings DSLs", () => {
  for (const dsl of ["Groovy", "Kotlin"]) {
    const profile = `javaGradleModuleRename${dsl}NativeGui`;
    const selection = repositorySelection(profile);
    assert.equal(selection.hasScenarios, true);
    assertAuthoredSelection(profile, 2, 12, selection.scenarios);
  }
  const appImageProfile = "javaModuleRenameAppImageNativeGui";
  const packaged = repositorySelection(appImageProfile);
  assertAuthoredSelection(appImageProfile, 7, 45, packaged.scenarios);
  const inboundProfile = "javaGradleModuleRenameInboundAppImageNativeGui";
  assertAuthoredSelection(inboundProfile, 3, 18, repositorySelection(inboundProfile).scenarios);
  const applicationProfile = "javaGradleApplicationModuleRenameAppImageNativeGui";
  assertAuthoredSelection(applicationProfile, 2, 12, repositorySelection(applicationProfile).scenarios);
});

test("Java language responsiveness profile selects the real delayed-transport scenario", () => {
  const selected = repositorySelection("javaLanguageResponsivenessNativeGui");
  assert.equal(selected.includesNativeJavaImport, false);
  assertAuthoredSelection("javaLanguageResponsivenessNativeGui", 1, 6, selected.scenarios);
  assert.ok(selected.scenarios[0].tags.includes("@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001"));
  assert.ok(selected.scenarios[0].tags.includes("@partial"));
  assert.equal(selected.scenarios[0].unmatchedSteps.length, 0);
});

test("Editor storage-full profile binds real source and recovery exhaustion", async () => {
  const selection = repositorySelection("editorStorageFullNativeGui");
  assertAuthoredSelection("editorStorageFullNativeGui", 2, 10, selection.scenarios);
  for (const scenario of selection.scenarios) {
    assert.ok(scenario.tags.includes("@native-editor-storage-full"));
    assert.equal(scenario.unmatchedSteps.length, 0);
  }
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:story:req-ide-editor-recovery-001:storage-full:native"],
    "node scripts/run-native-desktop-story.mjs --profile editorStorageFullNativeGui");
});

test("OAuth browser profile selects explicit consent and refusal coverage", async () => {
  const selection = repositorySelection("httpOAuthAuthorizationNativeGui");
  assertAuthoredSelection("httpOAuthAuthorizationNativeGui", 1, 7, selection.scenarios);
  assert.ok(selection.scenarios[0].tags.includes("@partial"));
  assert.equal(selection.scenarios[0].unmatchedSteps.length, 0);
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:story:req-ide-http-client-001:oauth-browser"],
    "node scripts/run-native-desktop-story.mjs --profile httpOAuthAuthorizationNativeGui");
});

test("OAuth browser fixture requires an explicit executable before building", async () => {
  let built = false;
  await assert.rejects(runNativeDesktopStory("httpOAuthAuthorizationNativeGui", {
    environment: {},
    selectsScenarios: () => true,
    buildApplication: async () => { built = true; throw new Error("unexpected build"); },
  }), NativeDesktopStoryPrerequisiteError);
  assert.equal(built, false);
});

test("Git history native profile selects paginated read-only history without broadening base Git acceptance", () => {
  const selected=repositorySelection("gitHistoryNativeGui").scenarios;
  assertAuthoredSelection("gitHistoryNativeGui",1,5,selected);
  assert.ok(selected[0].tags.includes("@native-git-history"));
  assert.ok(!repositorySelection("gitWorkspaceNativeGui").scenarios.some(s=>s.tags.includes("@native-git-history")));
});

test("Git branch deletion profile binds explicit review, stale refusal and forced confirmation",()=>{
 const scenarios=repositorySelection("gitBranchDeletionNativeGui").scenarios;
 assertAuthoredSelection("gitBranchDeletionNativeGui",1,5,scenarios);
 assert.ok(scenarios[0].tags.includes("@native-git-branch-deletion"));
 assert.ok(!repositorySelection("gitWorkspaceNativeGui").scenarios.some(s=>s.tags.includes("@native-git-branch-deletion")));
});

 test("Java reference backend profile selects the integrated native workflow", () => {
 const scenarios=repositorySelection("javaReferenceBackendNativeGui").scenarios;
 assertAuthoredSelection("javaReferenceBackendNativeGui",1,9,scenarios);
 assert.ok(scenarios[0].tags.includes("@native-java-reference-backend"));
 assert.ok(!repositorySelection("javaProjectContextNativeGui").scenarios.some(s=>s.tags.includes("@native-java-reference-backend")));
 });

 test("estimated JDBC plans have a focused native profile while the original database cases retain their scope",()=>{
 const selected=repositorySelection("javaDatabasePlansNativeGui").scenarios;
 assertAuthoredSelection("javaDatabasePlansNativeGui",1,7,selected);
 assert.ok(selected[0].tags.includes("@native-java-database-plans"));
 assert.ok(!repositorySelection("javaDatabaseNativeGui").scenarios.some(s=>s.tags.includes("@native-java-database-plans")));
 });

 test("compact Java source creation, provider discovery and execution have a focused native profile",()=>{
 const selected=repositorySelection("javaCompactSourceNativeGui").scenarios;
 assertAuthoredSelection("javaCompactSourceNativeGui",1,21,selected);
 assert.ok(selected[0].tags.includes("@native-java-compact-source"));
 const gradle=repositorySelection("javaGradleCompactSourceNativeGui").scenarios;
 assertAuthoredSelection("javaGradleCompactSourceNativeGui",1,21,gradle);
 assert.ok(gradle[0].tags.includes("@native-java-compact-source-gradle"));
 assert.ok(!selected[0].tags.includes("@native-java-compact-source-gradle"));
 assert.ok(!repositorySelection("javaProjectContextNativeGui").scenarios.some(s=>s.tags.includes("@native-java-compact-source")));
 });
