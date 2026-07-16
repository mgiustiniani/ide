#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cucumberEntry = path.join(repositoryRoot, "node_modules/@cucumber/cucumber/bin/cucumber.js");
const defaultApplicationPath = path.join(
  repositoryRoot,
  "apps/desktop/src-tauri/target/release/ide-desktop",
);
const defaultArtifactRoot = path.join(repositoryRoot, "test-results/native-desktop-story");
export const NATIVE_DESKTOP_BUILD_TIMEOUT_MS = 600_000;
export const NATIVE_DESKTOP_OUTER_TIMEOUT_MS = 90_000;
export const NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS = 2_000;
export const NATIVE_DESKTOP_DESIRED_WEBVIEW_WIDTH = 1440;
export const NATIVE_DESKTOP_DESIRED_WEBVIEW_HEIGHT = 900;
const PROCESS_STOP_TIMEOUT_MS = 2_000;
const NATIVE_JAVA_IMPORT_TAG = "@REQ-REFACTORKIT-JAVA-IMPORT-002";
const NATIVE_JAVA_IMPORT_PYTHON_PATH = "/usr/bin/python3";
const NATIVE_JAVA_IMPORT_GTK_PREFLIGHT =
  "import gi; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk";

const supportedProfiles = new Set([
  "implementedDesktopTauriWebdriver",
  "desktopTauriWebdriver",
  "desktopFileOpenNativeGui",
  "refactorKitJavaImportNativeGui",
  "desktopLayoutNativeGui",
]);

const executablePrerequisites = [
  {
    name: "tauri-driver",
    variable: "TAURI_DRIVER_PATH",
    command: "tauri-driver",
    exposedAs: "IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH",
  },
  {
    name: "WebKitWebDriver",
    variable: "WEBKIT_WEBDRIVER_PATH",
    command: "WebKitWebDriver",
    exposedAs: "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  },
  {
    name: "xvfb-run",
    variable: "XVFB_RUN_PATH",
    command: "xvfb-run",
    exposedAs: "IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH",
  },
  {
    name: "D-Bus session launcher",
    variable: "DBUS_RUN_SESSION_PATH",
    command: "dbus-run-session",
    exposedAs: "IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH",
  },
];

export class NativeDesktopStoryError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
  }
}

export class NativeDesktopStoryPrerequisiteError extends NativeDesktopStoryError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "NATIVE_DESKTOP_STORY_PREREQUISITE" });
  }
}

export class NativeDesktopStoryTimeoutError extends NativeDesktopStoryError {
  constructor(message) {
    super(message, { code: "NATIVE_DESKTOP_STORY_TIMEOUT" });
  }
}

export class NativeDesktopStoryAbortedError extends NativeDesktopStoryError {
  constructor(message) {
    super(message, { code: "NATIVE_DESKTOP_STORY_ABORTED" });
  }
}

export class NativeDesktopStoryExecutionError extends NativeDesktopStoryError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "NATIVE_DESKTOP_STORY_EXECUTION" });
  }
}

function commandLabel(command, arguments_) {
  return [command, ...arguments_].map((value) => JSON.stringify(value)).join(" ");
}

function pathEntries(environment) {
  return (environment.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

async function assertExecutable(absolutePath, name) {
  if (!path.isAbsolute(absolutePath)) {
    throw new NativeDesktopStoryPrerequisiteError(
      `${name} must resolve to an absolute path, received ${absolutePath}`,
    );
  }

  try {
    await access(absolutePath, fsConstants.X_OK);
  } catch (error) {
    throw new NativeDesktopStoryPrerequisiteError(
      `${name} is unavailable or not executable at ${absolutePath}`,
      { cause: error },
    );
  }
}

async function resolveExecutable(prerequisite, environment) {
  const configured = environment[prerequisite.variable];
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new NativeDesktopStoryPrerequisiteError(
        `${prerequisite.variable} must be absolute, received ${configured}`,
      );
    }
    const absolutePath = path.normalize(configured);
    await assertExecutable(absolutePath, prerequisite.name);
    return absolutePath;
  }

  for (const directory of pathEntries(environment)) {
    const candidate = path.join(directory, prerequisite.command);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue until every explicit PATH entry has been checked.
    }
  }

  throw new NativeDesktopStoryPrerequisiteError(
    `${prerequisite.name} was not found; set ${prerequisite.variable} to its absolute executable path`,
  );
}

export function preflightNativeJavaImportPython({
  pythonPath = NATIVE_JAVA_IMPORT_PYTHON_PATH,
  run = spawnSync,
} = {}) {
  if (pythonPath !== NATIVE_JAVA_IMPORT_PYTHON_PATH) {
    throw new NativeDesktopStoryPrerequisiteError(
      `Native Java import Python must be ${NATIVE_JAVA_IMPORT_PYTHON_PATH}`,
    );
  }

  const result = run(pythonPath, ["-c", NATIVE_JAVA_IMPORT_GTK_PREFLIGHT], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = `${result.stderr ?? result.stdout ?? ""}`.trim().slice(-2_000);
    throw new NativeDesktopStoryPrerequisiteError(
      `Native Java import requires ${pythonPath} with PyGObject GTK3${diagnostic ? `: ${diagnostic}` : ""}`,
      { cause: result.error },
    );
  }
  return pythonPath;
}

export async function resolveNativeDesktopPrerequisites(
  environment = process.env,
  {
    applicationPath = defaultApplicationPath,
    requiresNativeJavaImport = false,
    preflightPython = preflightNativeJavaImportPython,
  } = {},
) {
  if (process.platform !== "linux") {
    throw new NativeDesktopStoryPrerequisiteError(
      `desktop/tauri-webdriver scaffolding requires Linux X11, received ${process.platform}`,
    );
  }

  const resolved = {};
  for (const prerequisite of executablePrerequisites) {
    resolved[prerequisite.exposedAs] = await resolveExecutable(prerequisite, environment);
  }

  const application = path.normalize(applicationPath);
  const configuredApplication = environment.IDE_DESKTOP_APPLICATION_PATH;
  if (configuredApplication && path.normalize(configuredApplication) !== application) {
    throw new NativeDesktopStoryPrerequisiteError(
      `IDE_DESKTOP_APPLICATION_PATH cannot override the freshly built application at ${application}`,
    );
  }
  await assertExecutable(application, "fresh release/no-bundle Tauri application");
  resolved.IDE_STORY_NATIVE_GUI_APPLICATION_PATH = application;

  if (requiresNativeJavaImport) {
    await assertExecutable(NATIVE_JAVA_IMPORT_PYTHON_PATH, "native Java import Python");
    const pythonPath = await preflightPython();
    if (pythonPath !== NATIVE_JAVA_IMPORT_PYTHON_PATH) {
      throw new NativeDesktopStoryPrerequisiteError(
        `Native Java import Python preflight must return ${NATIVE_JAVA_IMPORT_PYTHON_PATH}`,
      );
    }
    resolved.IDE_STORY_NATIVE_GUI_PYTHON_PATH = pythonPath;
  }

  return Object.freeze(resolved);
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new NativeDesktopStoryExecutionError(`${label} escapes native GUI Story sandbox ${root}`);
}

export async function createNativeDesktopSandbox({
  artifactRoot = process.env.NATIVE_GUI_ARTIFACT_ROOT ?? defaultArtifactRoot,
  environment = process.env,
} = {}) {
  const absoluteArtifactRoot = path.resolve(artifactRoot);
  await mkdir(absoluteArtifactRoot, { recursive: true });
  const root = await mkdtemp(path.join(absoluteArtifactRoot, "run-"));
  const paths = {
    root,
    artifacts: path.join(root, "artifacts"),
    home: path.join(root, "home"),
    xdgConfig: path.join(root, "xdg/config"),
    xdgCache: path.join(root, "xdg/cache"),
    xdgData: path.join(root, "xdg/data"),
    xdgState: path.join(root, "xdg/state"),
    xdgRuntime: path.join(root, "xdg/runtime"),
    ideHome: path.join(root, "ide-home"),
    scenarioRoot: path.join(root, "scenarios"),
    workspace: path.join(root, "workspace"),
    temporary: path.join(root, "tmp"),
  };

  for (const [label, directory] of Object.entries(paths)) {
    assertContained(root, directory, label);
    if (label !== "root") await mkdir(directory, { recursive: true });
  }
  await chmod(paths.xdgRuntime, 0o700);

  const sandboxEnvironment = {
    ...environment,
    HOME: paths.home,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    XDG_RUNTIME_DIR: paths.xdgRuntime,
    IDE_HOME: paths.ideHome,
    IDE_STORY_NATIVE_GUI_SCENARIO_ROOT: paths.scenarioRoot,
    IDE_WORKSPACE_ROOT: paths.workspace,
    TMPDIR: paths.temporary,
    TEMP: paths.temporary,
    TMP: paths.temporary,
    GDK_BACKEND: "x11",
    IDE_STORY_NATIVE_GUI_TARGET: "desktop/tauri-webdriver",
    IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH: String(NATIVE_DESKTOP_DESIRED_WEBVIEW_WIDTH),
    IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT: String(NATIVE_DESKTOP_DESIRED_WEBVIEW_HEIGHT),
    IDE_STORY_NATIVE_GUI_SANDBOX_PATH: root,
    IDE_STORY_NATIVE_GUI_ARTIFACT_PATH: paths.artifacts,
  };
  delete sandboxEnvironment.DISPLAY;
  delete sandboxEnvironment.WAYLAND_DISPLAY;
  delete sandboxEnvironment.DBUS_SESSION_BUS_ADDRESS;
  delete sandboxEnvironment.IDE_REFACTORKIT_DAEMON;
  delete sandboxEnvironment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE;

  return Object.freeze({
    root,
    paths: Object.freeze(paths),
    environment: Object.freeze(sandboxEnvironment),
  });
}

export function createNativeDesktopRuntimeEnvironment(sandboxEnvironment, prerequisites) {
  const ownedExecutableDirectories = [
    prerequisites.IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH,
    prerequisites.IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH,
    prerequisites.IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH,
    prerequisites.IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH,
    prerequisites.IDE_STORY_NATIVE_GUI_APPLICATION_PATH,
  ].map((executablePath) => path.dirname(executablePath));
  const runtimePath = [...new Set([...ownedExecutableDirectories, "/usr/bin", "/bin"])].join(
    path.delimiter,
  );
  const runtimeEnvironment = {
    ...sandboxEnvironment,
    ...prerequisites,
    PATH: runtimePath,
    NO_COLOR: "1",
  };
  delete runtimeEnvironment.IDE_REFACTORKIT_DAEMON;
  delete runtimeEnvironment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE;
  return Object.freeze(runtimeEnvironment);
}

export async function findNativeDesktopSandboxProcesses(
  sandboxPath,
  { procRoot = "/proc", excludeProcessIds = [process.pid] } = {},
) {
  if (!path.isAbsolute(sandboxPath)) {
    throw new NativeDesktopStoryExecutionError(
      `Native desktop Story cleanup requires an absolute sandbox path: ${sandboxPath}`,
    );
  }
  const marker = `IDE_STORY_NATIVE_GUI_SANDBOX_PATH=${sandboxPath}`;
  const excluded = new Set(excludeProcessIds);
  let entries;
  try {
    entries = await readdir(procRoot, { withFileTypes: true });
  } catch (error) {
    throw new NativeDesktopStoryExecutionError(
      `Native desktop Story could not scan process environments under ${procRoot}`,
      { cause: error },
    );
  }

  const matches = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(async (entry) => {
        const processId = Number(entry.name);
        if (excluded.has(processId)) return undefined;
        try {
          const environment = await readFile(path.join(procRoot, entry.name, "environ"), "utf8");
          return environment.split("\0").includes(marker) ? processId : undefined;
        } catch {
          return undefined;
        }
      }),
  );
  return matches.filter((processId) => processId !== undefined).sort((left, right) => left - right);
}

function signalSandboxProcess(processId, signal) {
  try {
    process.kill(processId, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export async function cleanupNativeDesktopSandboxProcesses(
  sandboxPath,
  {
    findProcesses = findNativeDesktopSandboxProcesses,
    sendSignal = signalSandboxProcess,
    termTimeoutMs = NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
    killTimeoutMs = NATIVE_DESKTOP_SANDBOX_STOP_TIMEOUT_MS,
    pollIntervalMs = 25,
  } = {},
) {
  const detected = new Set();
  const termSignaled = new Set();
  const killSignaled = new Set();

  const scan = async () => {
    const processIds = await findProcesses(sandboxPath);
    for (const processId of processIds) detected.add(processId);
    return processIds;
  };
  const signalNew = async (signal, signaled) => {
    const processIds = await scan();
    for (const processId of processIds) {
      if (signaled.has(processId)) continue;
      sendSignal(processId, signal);
      signaled.add(processId);
    }
    return processIds;
  };
  const waitForEmpty = async (timeoutMs, signal, signaled) => {
    const deadline = Date.now() + timeoutMs;
    let remaining = await signalNew(signal, signaled);
    while (remaining.length > 0 && Date.now() < deadline) {
      await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
      remaining = await signalNew(signal, signaled);
    }
    return remaining;
  };

  let remaining = await waitForEmpty(termTimeoutMs, "SIGTERM", termSignaled);
  if (remaining.length > 0) {
    remaining = await waitForEmpty(killTimeoutMs, "SIGKILL", killSignaled);
  }
  const survivors = await scan();
  return Object.freeze({
    sandboxPath,
    termTimeoutMs,
    killTimeoutMs,
    detectedProcessIds: Object.freeze([...detected].sort((left, right) => left - right)),
    termSignaledProcessIds: Object.freeze([...termSignaled].sort((left, right) => left - right)),
    killSignaledProcessIds: Object.freeze([...killSignaled].sort((left, right) => left - right)),
    survivorProcessIds: Object.freeze(survivors),
  });
}

function signalProcessGroup(processId, signal) {
  if (!processId) return;
  try {
    if (process.platform === "win32") process.kill(processId, signal);
    else process.kill(-processId, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runOwnedProcess(
  command,
  arguments_,
  {
    cwd = repositoryRoot,
    environment = process.env,
    signal,
    timeoutMs = NATIVE_DESKTOP_OUTER_TIMEOUT_MS,
    stopTimeoutMs = PROCESS_STOP_TIMEOUT_MS,
    stdio = "inherit",
  } = {},
) {
  if (signal?.aborted) {
    throw new NativeDesktopStoryAbortedError(
      `Native desktop Story command aborted before start: ${commandLabel(command, arguments_)}`,
    );
  }

  const child = spawn(command, arguments_, {
    cwd,
    detached: process.platform !== "win32",
    env: environment,
    stdio,
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  let stopReason;
  let stopPromise;
  const stop = (reason) => {
    if (stopPromise) return stopPromise;
    stopReason = reason;
    stopPromise = (async () => {
      signalProcessGroup(child.pid, "SIGTERM");
      await Promise.race([exit.catch(() => undefined), wait(stopTimeoutMs)]);
      signalProcessGroup(child.pid, "SIGKILL");
    })();
    return stopPromise;
  };
  const abort = () => void stop("aborted");
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => void stop("timeout"), timeoutMs);
  timeout.unref();

  try {
    const result = await exit;
    await stopPromise;
    if (stopReason === "timeout") {
      throw new NativeDesktopStoryTimeoutError(
        `Native desktop Story command exceeded ${timeoutMs}ms: ${commandLabel(command, arguments_)}`,
      );
    }
    if (stopReason === "aborted") {
      throw new NativeDesktopStoryAbortedError(
        `Native desktop Story command aborted: ${commandLabel(command, arguments_)}`,
      );
    }
    if (result.code !== 0) {
      const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
      throw new NativeDesktopStoryExecutionError(
        `Native desktop Story command failed with ${outcome}: ${commandLabel(command, arguments_)}`,
      );
    }
  } catch (error) {
    await stop(stopReason ?? "execution-error");
    if (error instanceof NativeDesktopStoryError) throw error;
    throw new NativeDesktopStoryExecutionError(
      `Native desktop Story command could not run: ${commandLabel(command, arguments_)}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    signalProcessGroup(child.pid, "SIGKILL");
  }
}

export function nativeDesktopBuildCommand() {
  return {
    command: "pnpm",
    arguments: ["--filter", "@ide/desktop", "tauri", "build", "--no-bundle", "--ci"],
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function buildNativeDesktopApplication({
  signal,
  environment = process.env,
  applicationPath = defaultApplicationPath,
  timeoutMs = NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
  run = runOwnedProcess,
  buildCommand = nativeDesktopBuildCommand(),
} = {}) {
  await run(buildCommand.command, buildCommand.arguments, {
    cwd: repositoryRoot,
    signal,
    environment,
    timeoutMs,
    stdio: "inherit",
  });

  const absoluteApplicationPath = path.normalize(applicationPath);
  await assertExecutable(absoluteApplicationPath, "fresh release/no-bundle Tauri application");
  return Object.freeze({
    path: absoluteApplicationPath,
    sha256: await sha256File(absoluteApplicationPath),
    command: Object.freeze({
      executable: buildCommand.command,
      arguments: Object.freeze([...buildCommand.arguments]),
    }),
    timeoutMs,
  });
}

export function discoverNativeDesktopSelection(profile) {
  if (!supportedProfiles.has(profile)) {
    throw new NativeDesktopStoryExecutionError(
      `Unsupported native desktop Story profile: ${profile}`,
    );
  }

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
      timeout: 30_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new NativeDesktopStoryExecutionError(
      `Native desktop Story profile discovery failed: ${profile}`,
      { cause: result.error },
    );
  }

  const pickles = new Map();
  const selectedPickleIds = new Set();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const envelope = JSON.parse(line);
    if (envelope.pickle) {
      pickles.set(envelope.pickle.id, {
        id: envelope.pickle.id,
        uri: envelope.pickle.uri,
        line: envelope.pickle.location.line,
        name: envelope.pickle.name,
        tags: Object.freeze(envelope.pickle.tags.map(({ name }) => name).sort()),
      });
    }
    if (envelope.testCase) selectedPickleIds.add(envelope.testCase.pickleId);
  }
  const scenarios = [...selectedPickleIds].map((pickleId) => {
    const scenario = pickles.get(pickleId);
    if (!scenario) {
      throw new NativeDesktopStoryExecutionError(
        `Native desktop Story profile ${profile} selected unknown Cucumber pickle ${pickleId}`,
      );
    }
    return Object.freeze(scenario);
  });
  return Object.freeze({
    profile,
    hasScenarios: scenarios.length > 0,
    includesNativeJavaImport: scenarios.some(({ tags }) => tags.includes(NATIVE_JAVA_IMPORT_TAG)),
    scenarios: Object.freeze(scenarios),
  });
}

export function profileSelectsScenarios(profile) {
  return discoverNativeDesktopSelection(profile).hasScenarios;
}

export function nativeDesktopLaunchCommand(prerequisites, profile) {
  return {
    command: prerequisites.IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH,
    arguments: [
      "--",
      prerequisites.IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH,
      "--auto-servernum",
      `--server-args=-screen 0 ${NATIVE_DESKTOP_DESIRED_WEBVIEW_WIDTH}x${NATIVE_DESKTOP_DESIRED_WEBVIEW_HEIGHT}x24`,
      "--",
      process.execPath,
      "--import",
      "tsx",
      cucumberEntry,
      "--config",
      "cucumber.js",
      "--profile",
      profile,
    ],
  };
}

export async function runNativeDesktopStory(
  profile,
  {
    signal,
    environment = process.env,
    selectsScenarios = discoverNativeDesktopSelection,
    buildApplication = buildNativeDesktopApplication,
    resolvePrerequisites = resolveNativeDesktopPrerequisites,
    createSandbox = createNativeDesktopSandbox,
    createRuntimeEnvironment = createNativeDesktopRuntimeEnvironment,
    cleanupSandboxProcesses = cleanupNativeDesktopSandboxProcesses,
    run = runOwnedProcess,
    applicationPath = defaultApplicationPath,
    buildTimeoutMs = NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
  } = {},
) {
  const discovered = selectsScenarios(profile);
  const selection =
    typeof discovered === "boolean"
      ? {
          profile,
          hasScenarios: discovered,
          includesNativeJavaImport: discovered && profile === "refactorKitJavaImportNativeGui",
          scenarios: [],
        }
      : discovered;
  if (!selection.hasScenarios) {
    console.log(`Native desktop Story profile ${profile}: SKIP (no scenarios selected).`);
    return { skipped: true };
  }

  const application = await buildApplication({
    signal,
    environment,
    applicationPath,
    timeoutMs: buildTimeoutMs,
  });
  const prerequisites = await resolvePrerequisites(environment, {
    applicationPath: application.path,
    requiresNativeJavaImport: selection.includesNativeJavaImport,
  });
  const sandbox = await createSandbox({ environment });
  const runtimeEnvironment = createRuntimeEnvironment(sandbox.environment, prerequisites);

  const manifest = {
    target: "desktop/tauri-webdriver",
    profile,
    selectedScenarios: selection.scenarios,
    evidence: {
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
      applicationSha256: application.sha256,
    },
    build: {
      command: application.command,
      timeoutMs: application.timeoutMs,
    },
    desiredWebViewViewport: {
      width: NATIVE_DESKTOP_DESIRED_WEBVIEW_WIDTH,
      height: NATIVE_DESKTOP_DESIRED_WEBVIEW_HEIGHT,
    },
    sandbox: sandbox.paths,
    executables: prerequisites,
  };
  await writeFile(
    path.join(sandbox.paths.artifacts, "runtime-paths.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const stdout = await open(path.join(sandbox.paths.artifacts, "stdout.log"), "w");
  const stderr = await open(path.join(sandbox.paths.artifacts, "stderr.log"), "w");
  const launch = nativeDesktopLaunchCommand(prerequisites, profile);

  console.log(`Native desktop Story sandbox: ${sandbox.root}`);
  console.log(`Native desktop Story diagnostics: ${sandbox.paths.artifacts}`);
  let executionError;
  try {
    await run(launch.command, launch.arguments, {
      signal,
      environment: runtimeEnvironment,
      timeoutMs: NATIVE_DESKTOP_OUTER_TIMEOUT_MS,
      stdio: ["ignore", stdout.fd, stderr.fd],
    });
  } catch (error) {
    executionError = error;
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }

  let cleanup;
  try {
    cleanup = await cleanupSandboxProcesses(sandbox.root);
  } catch (error) {
    if (executionError) {
      throw new AggregateError(
        [executionError, error],
        "Native desktop Story execution and sandbox process cleanup both failed",
      );
    }
    throw error;
  }
  await writeFile(
    path.join(sandbox.paths.artifacts, "post-run-process-cleanup.json"),
    `${JSON.stringify(cleanup, null, 2)}\n`,
    "utf8",
  );
  if (cleanup.survivorProcessIds.length > 0) {
    const cleanupError = new NativeDesktopStoryExecutionError(
      `Native desktop Story sandbox processes survived bounded cleanup: ${cleanup.survivorProcessIds.join(", ")}`,
    );
    if (executionError) {
      throw new AggregateError(
        [executionError, cleanupError],
        "Native desktop Story execution failed and sandbox processes survived cleanup",
      );
    }
    throw cleanupError;
  }
  if (executionError) throw executionError;
  return { skipped: false, sandbox, application, cleanup };
}

function selectedProfile(arguments_) {
  const profileIndex = arguments_.indexOf("--profile");
  if (profileIndex === -1 || !arguments_[profileIndex + 1]) {
    throw new NativeDesktopStoryExecutionError(
      "Native desktop Story runner requires --profile followed by an explicit profile name",
    );
  }
  const profile = arguments_[profileIndex + 1];
  if (!supportedProfiles.has(profile)) {
    throw new NativeDesktopStoryExecutionError(
      `Unsupported native desktop Story profile: ${profile}`,
    );
  }
  return profile;
}

async function main() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    await runNativeDesktopStory(selectedProfile(process.argv.slice(2)), {
      signal: controller.signal,
    });
  } catch (error) {
    const code = error instanceof NativeDesktopStoryError ? ` [${error.code}]` : "";
    console.error(`Native desktop Story runner failed${code}:`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
