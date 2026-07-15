#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, chmod, mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
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
const PROCESS_STOP_TIMEOUT_MS = 2_000;

const supportedProfiles = new Set([
  "implementedDesktopTauriWebdriver",
  "desktopTauriWebdriver",
  "desktopFileOpenNativeGui",
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

export async function resolveNativeDesktopPrerequisites(
  environment = process.env,
  { applicationPath = defaultApplicationPath } = {},
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
    IDE_WORKSPACE_ROOT: paths.workspace,
    TMPDIR: paths.temporary,
    TEMP: paths.temporary,
    TMP: paths.temporary,
    GDK_BACKEND: "x11",
    IDE_STORY_NATIVE_GUI_TARGET: "desktop/tauri-webdriver",
    IDE_STORY_NATIVE_GUI_SANDBOX_PATH: root,
    IDE_STORY_NATIVE_GUI_ARTIFACT_PATH: paths.artifacts,
  };
  delete sandboxEnvironment.DISPLAY;
  delete sandboxEnvironment.WAYLAND_DISPLAY;
  delete sandboxEnvironment.DBUS_SESSION_BUS_ADDRESS;

  return Object.freeze({ root, paths: Object.freeze(paths), environment: sandboxEnvironment });
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

export function profileSelectsScenarios(profile) {
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

  return result.stdout.split("\n").some((line) => {
    if (!line.trim()) return false;
    return Boolean(JSON.parse(line).testCase);
  });
}

export function nativeDesktopLaunchCommand(prerequisites, profile) {
  return {
    command: prerequisites.IDE_STORY_NATIVE_GUI_DBUS_RUN_SESSION_PATH,
    arguments: [
      "--",
      prerequisites.IDE_STORY_NATIVE_GUI_XVFB_RUN_PATH,
      "--auto-servernum",
      "--server-args=-screen 0 1440x900x24",
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
    selectsScenarios = profileSelectsScenarios,
    buildApplication = buildNativeDesktopApplication,
    resolvePrerequisites = resolveNativeDesktopPrerequisites,
    createSandbox = createNativeDesktopSandbox,
    run = runOwnedProcess,
    applicationPath = defaultApplicationPath,
    buildTimeoutMs = NATIVE_DESKTOP_BUILD_TIMEOUT_MS,
  } = {},
) {
  if (!selectsScenarios(profile)) {
    console.log(
      `Native desktop Story profile ${profile}: SKIP (no runnable scenarios; parked statuses are excluded).`,
    );
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
  });
  const sandbox = await createSandbox({ environment });
  const runtimeEnvironment = { ...sandbox.environment, ...prerequisites, NO_COLOR: "1" };
  runtimeEnvironment.PATH = [
    path.dirname(prerequisites.IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH),
    path.dirname(prerequisites.IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH),
    runtimeEnvironment.PATH ?? "",
  ].join(path.delimiter);

  const manifest = {
    target: "desktop/tauri-webdriver",
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
  try {
    await run(launch.command, launch.arguments, {
      signal,
      environment: runtimeEnvironment,
      timeoutMs: NATIVE_DESKTOP_OUTER_TIMEOUT_MS,
      stdio: ["ignore", stdout.fd, stderr.fd],
    });
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }
  return { skipped: false, sandbox, application };
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
