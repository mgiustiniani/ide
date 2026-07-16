import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { remote } from "webdriverio";

import {
  NATIVE_JAVA_IMPORT_FIRST_PLAN,
  NATIVE_JAVA_IMPORT_FIXTURE,
  NATIVE_JAVA_IMPORT_PRIMARY_FILE,
  NATIVE_JAVA_IMPORT_SECOND_PLAN,
  NATIVE_JAVA_IMPORT_TARGET_DIRECTORY,
  NATIVE_JAVA_IMPORT_TRANSACTION,
  nativeClipboardOwnerScript,
  nativeRefactorKitDaemonScript,
} from "../fixtures/native-refactorkit-java-import-fixtures.js";

const PYTHON_PATH = "/usr/bin/python3";
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const PREVIEW_DEADLINE_MS = 20_000;
const APPLY_DEADLINE_MS = 20_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;
const OVERRIDDEN_ENVIRONMENT = [
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
  "IDE_REFACTORKIT_DAEMON",
  "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE",
] as const;

interface DriverExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface TranscriptEvent {
  readonly id: number;
  readonly method: string;
  readonly plan?: string;
  readonly target?: string;
  readonly length?: number;
  readonly sha256?: string;
  readonly params?: Readonly<{ planId: string }>;
  readonly change?: "create";
  readonly primary?: boolean;
  readonly writeCount?: number;
}

interface WorkspaceTreeEntry {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly length?: number;
  readonly sha256?: string;
}

interface FixtureState {
  readonly pid: number;
  readonly status: string;
  readonly sequence?: number;
  readonly writeCount?: number;
  readonly length?: number;
  readonly sha256?: string;
}

interface NativeJavaImportEvidence {
  readonly requirement: "REQ-REFACTORKIT-JAVA-IMPORT-002";
  readonly target: "desktop/tauri-webdriver";
  readonly nativeGui: true;
  readonly e2e: true;
  readonly artifactKind: "release-no-bundle";
  scenario?: string;
  fixtureLength?: number;
  fixtureSha256?: string;
  applicationSha256?: string;
  transcriptSha256?: string;
  firstPlan?: string;
  secondPlan?: string;
  transaction?: string;
  nativePreviews?: number;
  daemonWrites?: number;
  workspaceEntriesBeforeApply?: number;
  workspaceEntriesAfterApply?: number;
  selectedTab?: string;
  monacoContentMatched?: boolean;
  applicationExited?: boolean;
  daemonExited?: boolean;
  clipboardOwnerExited?: boolean;
  driverExited?: boolean;
  configuredPathsAndMarkedProcessesConfined?: boolean;
  environmentRestored?: boolean;
}

interface ScenarioPaths {
  readonly root: string;
  readonly home: string;
  readonly xdgConfig: string;
  readonly xdgCache: string;
  readonly xdgData: string;
  readonly xdgState: string;
  readonly xdgRuntime: string;
  readonly ideHome: string;
  readonly temporary: string;
  readonly workspace: string;
  readonly daemon: string;
  readonly daemonExecutable: string;
  readonly daemonState: string;
  readonly transcript: string;
  readonly clipboard: string;
  readonly clipboardExecutable: string;
  readonly clipboardState: string;
  readonly evidence: string;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value))
    throw new Error(`Native Java-import Story requires ${name}`);
  return path.normalize(value);
}

function cssAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function freeTcpPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a native Java-import Story port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function processExists(processId: number): Promise<boolean> {
  try {
    await access(`/proc/${processId}`, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function childProcessIds(processId: number): Promise<number[]> {
  try {
    return (await readFile(`/proc/${processId}/task/${processId}/children`, "utf8"))
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

async function descendants(processId: number): Promise<number[]> {
  const result: number[] = [];
  const pending = [processId];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const child of await childProcessIds(current)) {
      result.push(child);
      pending.push(child);
    }
  }
  return result;
}

async function findExecutableDescendant(
  processId: number,
  executablePath: string,
): Promise<number | undefined> {
  for (const descendant of await descendants(processId)) {
    try {
      if ((await readlink(`/proc/${descendant}/exe`)) === executablePath) return descendant;
    } catch {
      // Processes may exit between discovery and inspection.
    }
  }
  return undefined;
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function terminateProcess(child: ChildProcess | undefined): Promise<DriverExit | undefined> {
  if (!child) return undefined;
  const exit = new Promise<DriverExit>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  let result = await Promise.race([exit, wait(2_000).then(() => undefined)]);
  if (!result && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  result = await Promise.race([exit, wait(1_000).then(() => undefined)]);
  return result;
}

export class NativeRefactorKitJavaImportSession {
  readonly #runnerSandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #scenarioRoot = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SCENARIO_ROOT");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #pythonPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_PYTHON_PATH");
  readonly #originalEnvironment = new Map<string, string | undefined>();
  readonly #evidence: NativeJavaImportEvidence = {
    requirement: "REQ-REFACTORKIT-JAVA-IMPORT-002",
    target: "desktop/tauri-webdriver",
    nativeGui: true,
    e2e: true,
    artifactKind: "release-no-bundle",
  };
  #paths?: ScenarioPaths;
  #clipboardOwner?: ChildProcess;
  #clipboardExit?: Promise<DriverExit>;
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Awaited<ReturnType<typeof remote>>;
  #applicationProcessId?: number;
  #daemonProcessId?: number;
  #clipboardProcessId?: number;
  #driverProcessId?: number;
  #previewCountBeforeLastAction?: number;
  #workspaceTreeBeforeApply?: readonly WorkspaceTreeEntry[];
  readonly #sandboxMarkedProcessIds = new Set<number>();
  #previewDeadline?: number;
  #applyDeadline?: number;
  #environmentRestored = false;
  #disposed = false;

  async allocateScenarioSandbox(): Promise<void> {
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(this.#pythonPath, PYTHON_PATH);
    assert.ok(isContained(this.#runnerSandbox, this.#scenarioRoot));
    const root = await mkdtemp(path.join(this.#scenarioRoot, "req-refactorkit-java-import-002-"));
    const paths: ScenarioPaths = {
      root,
      home: path.join(root, "home"),
      xdgConfig: path.join(root, "xdg/config"),
      xdgCache: path.join(root, "xdg/cache"),
      xdgData: path.join(root, "xdg/data"),
      xdgState: path.join(root, "xdg/state"),
      xdgRuntime: path.join(root, "xdg/runtime"),
      ideHome: path.join(root, "ide-home"),
      temporary: path.join(root, "tmp"),
      workspace: path.join(root, "workspace"),
      daemon: path.join(root, "daemon"),
      daemonExecutable: path.join(root, "daemon/refactorkit-daemon"),
      daemonState: path.join(root, "daemon/state.json"),
      transcript: path.join(root, "transcript/daemon.jsonl"),
      clipboard: path.join(root, "clipboard"),
      clipboardExecutable: path.join(root, "clipboard/x11-owner"),
      clipboardState: path.join(root, "clipboard/state.json"),
      evidence: path.join(root, "evidence"),
    };
    for (const directory of [
      paths.home,
      paths.xdgConfig,
      paths.xdgCache,
      paths.xdgData,
      paths.xdgState,
      paths.xdgRuntime,
      paths.ideHome,
      paths.temporary,
      paths.workspace,
      paths.daemon,
      path.dirname(paths.transcript),
      paths.clipboard,
      paths.evidence,
    ]) {
      assert.ok(isContained(root, directory));
      await mkdir(directory, { recursive: true });
    }
    await chmod(paths.xdgRuntime, 0o700);
    this.#paths = paths;
    this.#evidence.scenario = path.basename(root);

    for (const name of OVERRIDDEN_ENVIRONMENT) {
      this.#originalEnvironment.set(name, process.env[name]);
    }
    const overrides: Record<(typeof OVERRIDDEN_ENVIRONMENT)[number], string> = {
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
      IDE_STORY_NATIVE_GUI_ARTIFACT_PATH: paths.evidence,
      IDE_REFACTORKIT_DAEMON: paths.daemonExecutable,
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
    };
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;

    assert.ok(isContained(this.#runnerSandbox, await realpath(root)));
    assert.deepEqual((await readdir(paths.workspace)).sort(), []);
  }

  async createWorkspace(packageDirectory: string): Promise<void> {
    assert.equal(packageDirectory, NATIVE_JAVA_IMPORT_TARGET_DIRECTORY);
    const paths = this.paths();
    await mkdir(path.join(paths.workspace, packageDirectory), { recursive: true });
    await writeFile(
      path.join(paths.workspace, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><artifactId>native-story</artifactId></project>\n",
      { encoding: "utf8", flag: "wx" },
    );
  }

  async assertPathAbsent(relativePath: string): Promise<void> {
    assert.equal(relativePath, NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    await assert.rejects(stat(path.join(this.paths().workspace, relativePath)), { code: "ENOENT" });
  }

  async startClipboardOwner(source: string): Promise<void> {
    assert.equal(source, NATIVE_JAVA_IMPORT_FIXTURE);
    assert.equal(this.#clipboardOwner, undefined, "clipboard owner already started");
    const paths = this.paths();
    await writeFile(
      paths.clipboardExecutable,
      nativeClipboardOwnerScript({ fixture: source, statePath: paths.clipboardState }),
      { encoding: "utf8", flag: "wx" },
    );
    await chmod(paths.clipboardExecutable, 0o700);
    const child = spawn(this.#pythonPath, [paths.clipboardExecutable], {
      cwd: paths.clipboard,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.#clipboardOwner = child;
    child.stderr?.on("data", (chunk: Buffer) => this.captureDiagnostic(chunk));
    this.#clipboardExit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const state = await this.waitForState(paths.clipboardState, ({ status }) => status === "owned");
    assert.equal(state.pid, child.pid);
    this.#clipboardProcessId = state.pid;
    await this.assertSandboxMarkedProcess(state.pid);
    assert.equal(state.length, Buffer.byteLength(source));
    assert.equal(state.sha256, createHash("sha256").update(source).digest("hex"));
    this.#evidence.fixtureLength = state.length;
    this.#evidence.fixtureSha256 = state.sha256;
  }

  async createDaemonFixture(): Promise<void> {
    const paths = this.paths();
    await writeFile(
      paths.daemonExecutable,
      nativeRefactorKitDaemonScript({
        fixture: NATIVE_JAVA_IMPORT_FIXTURE,
        workspacePath: paths.workspace,
        transcriptPath: paths.transcript,
        statePath: paths.daemonState,
      }),
      { encoding: "utf8", flag: "wx" },
    );
    await chmod(paths.daemonExecutable, 0o700);
    await access(paths.daemonExecutable, fsConstants.X_OK);
  }

  assertCapabilities(
    expectations: readonly { declaration: string; conformantContract: string }[],
  ): void {
    assert.deepEqual(expectations, [
      { declaration: "API version", conformantContract: "0.2" },
      {
        declaration: "java.importExternalClass",
        conformantContract: "targetDirectory, preview, apply, discard, and rollback",
      },
      { declaration: "refactor.apply", conformantContract: "available" },
      { declaration: "refactor.discard", conformantContract: "available" },
      { declaration: "patch.rollback", conformantContract: "available" },
    ]);
  }

  assertGuardedDaemonOverride(allowName: string, daemonName: string): void {
    assert.equal(allowName, "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE=1");
    assert.equal(daemonName, "IDE_REFACTORKIT_DAEMON");
    assert.equal(process.env.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE, "1");
    assert.equal(process.env.IDE_REFACTORKIT_DAEMON, this.paths().daemonExecutable);
    assert.ok(path.isAbsolute(this.paths().daemonExecutable));
  }

  async assertNoGlobalDaemonDiscovery(): Promise<void> {
    for (const executable of ["refactorkit", "refactorkit-daemon"]) {
      for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
        const candidate = path.join(directory, executable);
        try {
          await access(candidate, fsConstants.X_OK);
          assert.fail(`global ${executable} is discoverable at an executable PATH entry`);
        } catch (error) {
          if (error instanceof assert.AssertionError) throw error;
        }
      }
      await assert.rejects(
        access(
          path.join(this.paths().home, ".local/share/refactorkit/bin", executable),
          fsConstants.X_OK,
        ),
      );
    }
  }

  async launch(): Promise<void> {
    assert.equal(this.#driver, undefined, "native Java-import session already launched");
    await Promise.all([
      access(this.#tauriDriverPath, fsConstants.X_OK),
      access(this.#webKitWebDriverPath, fsConstants.X_OK),
      access(this.#applicationPath, fsConstants.X_OK),
      access(this.paths().daemonExecutable, fsConstants.X_OK),
    ]);
    const [port, nativePort] = await Promise.all([freeTcpPort(), freeTcpPort()]);
    assert.notEqual(port, nativePort);
    const driver = spawn(
      this.#tauriDriverPath,
      [
        "--port",
        String(port),
        "--native-port",
        String(nativePort),
        "--native-host",
        "127.0.0.1",
        "--native-driver",
        this.#webKitWebDriverPath,
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.#driver = driver;
    assert.ok(driver.pid, "tauri-driver process ID is unavailable");
    this.#driverProcessId = driver.pid;
    await this.assertSandboxMarkedProcess(driver.pid);
    driver.stdout?.on("data", (chunk: Buffer) => this.captureDiagnostic(chunk));
    driver.stderr?.on("data", (chunk: Buffer) => this.captureDiagnostic(chunk));
    this.#driverExit = new Promise((resolve, reject) => {
      driver.once("error", reject);
      driver.once("exit", (code, signal) => resolve({ code, signal }));
    });

    try {
      await this.waitForDriver(port);
      this.#browser = await bounded(
        remote({
          hostname: "127.0.0.1",
          port,
          path: "/",
          logLevel: "silent",
          connectionRetryCount: 0,
          connectionRetryTimeout: SESSION_START_TIMEOUT_MS,
          capabilities: {
            "tauri:options": { application: this.#applicationPath },
          } as Parameters<typeof remote>[0]["capabilities"],
        }),
        SESSION_START_TIMEOUT_MS,
        "WebdriverIO native Java-import session start",
      );
      this.#applicationProcessId = await this.waitForApplicationProcess();
      await this.assertSandboxMarkedProcess(this.#applicationProcessId);
      this.#evidence.applicationSha256 = await sha256File(this.#applicationPath);
      const explorer = await this.browser().$('[role="tree"][aria-label="File Explorer"]');
      await explorer.waitForDisplayed({ timeout: 15_000, interval: 100 });
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  async expandToDirectory(relativePath: string): Promise<void> {
    assert.equal(relativePath, NATIVE_JAVA_IMPORT_TARGET_DIRECTORY);
    const segments = relativePath.split("/");
    for (let length = 1; length <= segments.length; length += 1) {
      const candidatePath = segments.slice(0, length).join("/");
      const candidate = await this.directoryItem(candidatePath);
      if (!(await candidate.isExisting())) continue;
      await candidate.waitForDisplayed({ timeout: 10_000, interval: 50 });
      if (
        candidatePath !== relativePath &&
        (await candidate.getAttribute("aria-expanded")) !== "true"
      ) {
        await candidate.click();
        await this.browser().waitUntil(
          async () =>
            (await candidate.getAttribute("aria-expanded")) === "true" ||
            (await this.directoryItem(relativePath)).isExisting(),
          { timeout: 10_000, interval: 50 },
        );
      }
    }
    const target = await this.directoryItem(relativePath);
    await target.waitForDisplayed({ timeout: 15_000, interval: 50 });
    assert.equal(await target.getAttribute("data-path"), relativePath);
    assert.equal(await target.getAttribute("role"), "treeitem");
  }

  async openContextMenuAndChoose(label: string): Promise<void> {
    assert.equal(label, "Paste Java Class from Clipboard");
    const transcriptBeforeAction = await this.transcriptIfPresent();
    this.#previewCountBeforeLastAction = transcriptBeforeAction.filter(
      ({ method }) => method === "java.importExternalClass",
    ).length;
    this.#previewDeadline = Date.now() + PREVIEW_DEADLINE_MS;
    const directory = await this.directoryItem(NATIVE_JAVA_IMPORT_TARGET_DIRECTORY);
    await directory.click({ button: "right" });
    const menu = await this.browser().$('[role="menu"]');
    await menu.waitForDisplayed({ timeout: this.remainingPreviewTime(), interval: 50 });
    const item = await menu.$('[role="menuitem"]');
    assert.equal(await item.getText(), label);
    await item.click();
    const dialog = await this.reviewDialog();
    await dialog.waitForDisplayed({ timeout: this.remainingPreviewTime(), interval: 50 });
  }

  async assertNativePreviewAfterAction(previewNumber: 1 | 2): Promise<void> {
    const transcript = await this.transcript();
    const previews = transcript.filter(({ method }) => method === "java.importExternalClass");
    assert.equal(this.#previewCountBeforeLastAction, previewNumber - 1);
    assert.equal(previews.length, previewNumber);
    assert.equal(previews.length - this.#previewCountBeforeLastAction, 1);
    assert.equal(new Set(previews.map(({ id }) => id)).size, previews.length);
    for (const preview of previews) {
      assert.equal(preview.length, Buffer.byteLength(NATIVE_JAVA_IMPORT_FIXTURE));
      assert.equal(preview.sha256, this.#evidence.fixtureSha256);
    }
    const clipboard = await this.readState(this.paths().clipboardState);
    assert.equal(clipboard.status, "owned");
    assert.equal(clipboard.length, Buffer.byteLength(NATIVE_JAVA_IMPORT_FIXTURE));
    assert.equal(clipboard.sha256, this.#evidence.fixtureSha256);
    const daemon = await this.readState(this.paths().daemonState);
    this.#daemonProcessId = daemon.pid;
    this.#evidence.nativePreviews = previewNumber;
  }

  async assertExactPreview(previewNumber: 1 | 2): Promise<void> {
    const transcript = await this.transcript();
    const previews = transcript.filter(({ method }) => method === "java.importExternalClass");
    assert.equal(previews.length, previewNumber);
    const preview = previews[previewNumber - 1]!;
    assert.equal(preview.method, "java.importExternalClass");
    assert.equal(
      preview.plan,
      previewNumber === 1 ? NATIVE_JAVA_IMPORT_FIRST_PLAN : NATIVE_JAVA_IMPORT_SECOND_PLAN,
    );
    assert.equal(preview.target, NATIVE_JAVA_IMPORT_TARGET_DIRECTORY);
    assert.equal(preview.length, Buffer.byteLength(NATIVE_JAVA_IMPORT_FIXTURE));
    assert.equal(preview.sha256, this.#evidence.fixtureSha256);
  }

  async assertFirstReview(
    expectations: readonly { evidence: string; reviewedValue: string }[],
  ): Promise<void> {
    assert.deepEqual(expectations, [
      { evidence: "target", reviewedValue: NATIVE_JAVA_IMPORT_TARGET_DIRECTORY },
      {
        evidence: "affected primary file",
        reviewedValue: `create ${NATIVE_JAVA_IMPORT_PRIMARY_FILE}`,
      },
      {
        evidence: "provenance and license",
        reviewedValue: "clipboard source, no source URL, unknown license, warn policy",
      },
      { evidence: "risk", reviewedValue: "high" },
    ]);
    const review = await this.browser().execute(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return null;
      const section = (title: string): HTMLElement | null =>
        [...dialog.querySelectorAll<HTMLElement>("h3")]
          .find((heading) => heading.textContent?.trim() === title)
          ?.closest<HTMLElement>("section") ?? null;
      const definitions = (owner: HTMLElement | null): Record<string, string> => {
        const values: Record<string, string> = {};
        for (const term of owner?.querySelectorAll<HTMLElement>("dt") ?? []) {
          values[term.textContent?.trim() ?? ""] =
            term.nextElementSibling?.textContent?.trim() ?? "";
        }
        return values;
      };
      const affected = section("Affected files")?.querySelector("li");
      return {
        modal: dialog.getAttribute("aria-modal"),
        selected: definitions(section("Selected target")),
        plan: definitions(section("Plan and placement")),
        affectedChange: affected?.querySelector("span")?.textContent?.trim().toLowerCase(),
        affectedPath: affected?.querySelector("code")?.textContent?.trim(),
        affectedPrimary: affected?.querySelector("strong")?.textContent?.trim(),
        risk: definitions(section("Evidence and risk")),
        provenance: definitions(section("Provenance and license")),
      };
    });
    assert.ok(review);
    assert.equal(review.modal, "true");
    assert.equal(review.selected["Target directory"], NATIVE_JAVA_IMPORT_TARGET_DIRECTORY);
    assert.equal(review.plan.Plan, NATIVE_JAVA_IMPORT_FIRST_PLAN);
    assert.equal(review.affectedChange, "create");
    assert.equal(review.affectedPath, NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    assert.equal(review.affectedPrimary, "Primary file");
    assert.equal(review.risk.Risk, "high");
    assert.deepEqual(review.provenance, {
      Source: "Clipboard",
      "Source URL": "None provided",
      "Detected license": "unknown",
      "License policy": "warn",
    });
    this.#evidence.firstPlan = NATIVE_JAVA_IMPORT_FIRST_PLAN;
  }

  async cancelReview(label: string): Promise<void> {
    assert.equal(label, "Cancel");
    const button = await this.reviewDialog().then((dialog) => dialog.$("button=Cancel"));
    await button.click();
    await this.browser().waitUntil(async () => !(await (await this.reviewDialog()).isExisting()), {
      timeout: this.remainingPreviewTime(),
      interval: 50,
    });
  }

  async assertFirstDiscard(): Promise<void> {
    const transcript = await this.waitForTranscriptLength(6);
    assert.deepEqual(
      transcript.map(({ method }) => method),
      [
        "server.capabilities",
        "project.open",
        "server.capabilities",
        "project.open",
        "java.importExternalClass",
        "refactor.discard",
      ],
    );
    assert.equal(transcript[5]?.plan, NATIVE_JAVA_IMPORT_FIRST_PLAN);
  }

  async assertFirstPlanDidNotApply(): Promise<void> {
    const transcript = await this.transcript();
    assert.equal(
      transcript.some(({ method }) => method === "refactor.apply"),
      false,
    );
    assert.equal((await this.readState(this.paths().daemonState)).writeCount, 0);
    await this.assertPathAbsent(NATIVE_JAVA_IMPORT_PRIMARY_FILE);
  }

  async repeatContextMenuAction(): Promise<void> {
    await this.openContextMenuAndChoose("Paste Java Class from Clipboard");
  }

  async assertFreshSecondPlan(): Promise<void> {
    await this.assertExactPreview(2);
    const transcript = await this.transcript();
    const previews = transcript.filter(({ method }) => method === "java.importExternalClass");
    assert.equal(previews[0]?.plan, NATIVE_JAVA_IMPORT_FIRST_PLAN);
    assert.equal(previews[1]?.plan, NATIVE_JAVA_IMPORT_SECOND_PLAN);
    assert.notEqual(previews[0]?.plan, previews[1]?.plan);
    const reviewPlan = await this.browser().execute(() => {
      const terms = [...document.querySelectorAll<HTMLElement>('[role="dialog"] dt')];
      return terms.find(({ textContent }) => textContent?.trim() === "Plan")?.nextElementSibling
        ?.textContent;
    });
    assert.equal(reviewPlan?.trim(), NATIVE_JAVA_IMPORT_SECOND_PLAN);
    this.#evidence.secondPlan = NATIVE_JAVA_IMPORT_SECOND_PLAN;
  }

  async assertAcknowledgementGate(): Promise<void> {
    const dialog = await this.reviewDialog();
    const apply = await dialog.$("button=Apply Import");
    const acknowledgement = await dialog.$('input[type="checkbox"]');
    assert.equal(await apply.isEnabled(), false);
    assert.equal(await acknowledgement.isSelected(), false);
    assert.equal(
      (await acknowledgement.parentElement().getText()).replace(/\s+/gu, " ").trim(),
      "I acknowledge the unknown or high-risk license and provenance information for this plan.",
    );
  }

  async acknowledgeAndApply(label: string): Promise<void> {
    assert.equal(label, "Apply Import");
    this.#applyDeadline = Date.now() + APPLY_DEADLINE_MS;
    const dialog = await this.reviewDialog();
    const acknowledgement = await dialog.$('input[type="checkbox"]');
    const apply = await dialog.$("button=Apply Import");
    await acknowledgement.click();
    assert.equal(await apply.isEnabled(), true);
    await this.assertPathAbsent(NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    this.#workspaceTreeBeforeApply = await this.canonicalWorkspaceTree();
    this.#evidence.workspaceEntriesBeforeApply = this.#workspaceTreeBeforeApply.length;
    await apply.click();
    await this.waitForTranscriptLength(8, this.remainingApplyTime());
    await this.browser().waitUntil(
      async () => {
        try {
          return (
            (await readFile(
              path.join(this.paths().workspace, NATIVE_JAVA_IMPORT_PRIMARY_FILE),
              "utf8",
            )) === NATIVE_JAVA_IMPORT_FIXTURE
          );
        } catch {
          return false;
        }
      },
      { timeout: this.remainingApplyTime(), interval: 50 },
    );
  }

  async assertDistinctFreshReviewedPlanApplied(): Promise<void> {
    assert.equal(this.#evidence.firstPlan, NATIVE_JAVA_IMPORT_FIRST_PLAN);
    assert.equal(this.#evidence.secondPlan, NATIVE_JAVA_IMPORT_SECOND_PLAN);
    assert.notEqual(this.#evidence.firstPlan, this.#evidence.secondPlan);
    const applies = (await this.transcript()).filter(({ method }) => method === "refactor.apply");
    assert.equal(applies.length, 1);
    assert.equal(applies[0]?.plan, this.#evidence.secondPlan);
    assert.notEqual(applies[0]?.plan, this.#evidence.firstPlan);
  }

  async assertExactApplyPlanIdParams(): Promise<void> {
    const applies = (await this.transcript()).filter(({ method }) => method === "refactor.apply");
    assert.equal(applies.length, 1);
    assert.deepEqual(applies[0]?.params, { planId: NATIVE_JAVA_IMPORT_SECOND_PLAN });
    const serializedParams = JSON.stringify(applies[0]?.params);
    assert.equal(serializedParams.includes(NATIVE_JAVA_IMPORT_FIXTURE), false);
    for (const forbidden of [
      "code",
      "patch",
      "target",
      "targetDirectory",
      "targetPackage",
      "sourceKind",
    ]) {
      assert.equal(
        serializedParams.includes(`\"${forbidden}\"`),
        false,
        `Apply params leaked ${forbidden}`,
      );
    }
  }

  async assertSingleReportedTargetCreation(relativePath: string): Promise<void> {
    assert.equal(relativePath, NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    assert.equal(
      await readFile(path.join(this.paths().workspace, relativePath), "utf8"),
      NATIVE_JAVA_IMPORT_FIXTURE,
    );
    const state = await this.readState(this.paths().daemonState);
    assert.equal(state.writeCount, 1);
    const transcript = await this.transcript();
    const creations = transcript.filter(
      ({ method, change }) => method === "refactor.apply" && change === "create",
    );
    assert.deepEqual(creations, [
      {
        id: 6,
        method: "refactor.apply",
        plan: NATIVE_JAVA_IMPORT_SECOND_PLAN,
        target: NATIVE_JAVA_IMPORT_PRIMARY_FILE,
        length: Buffer.byteLength(NATIVE_JAVA_IMPORT_FIXTURE),
        sha256: this.#evidence.fixtureSha256,
        params: { planId: NATIVE_JAVA_IMPORT_SECOND_PLAN },
        change: "create",
        primary: true,
        writeCount: 1,
      },
    ]);
    const reportedFiles = await this.browser().execute(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const affectedFiles = [...(dialog?.querySelectorAll<HTMLElement>("h3") ?? [])]
        .find(({ textContent }) => textContent?.trim() === "Affected files")
        ?.closest<HTMLElement>("section");
      return [...(affectedFiles?.querySelectorAll<HTMLElement>("li") ?? [])].map((item) => ({
        change: item.querySelector("span")?.textContent?.trim().toLowerCase(),
        path: item.querySelector("code")?.textContent?.trim(),
        primary: item.querySelector("strong")?.textContent?.trim(),
      }));
    });
    assert.deepEqual(reportedFiles, [
      {
        change: "create",
        path: NATIVE_JAVA_IMPORT_PRIMARY_FILE,
        primary: "Primary file",
      },
    ]);
    await this.browser().waitUntil(
      async () =>
        (await this.browser().execute(
          (transactionId) =>
            [...document.querySelectorAll<HTMLElement>('[role="dialog"] code')].filter(
              ({ textContent }) => textContent?.trim() === transactionId,
            ).length,
          NATIVE_JAVA_IMPORT_TRANSACTION,
        )) === 1,
      { timeout: this.remainingApplyTime(), interval: 50 },
    );
    this.#evidence.transaction = NATIVE_JAVA_IMPORT_TRANSACTION;
    this.#evidence.daemonWrites = 1;
  }

  async assertWorkspaceTreeGainedOnlyReportedTarget(): Promise<void> {
    assert.ok(this.#workspaceTreeBeforeApply, "workspace tree was not captured before Apply");
    const afterApply = await this.canonicalWorkspaceTree();
    const expectedTarget: WorkspaceTreeEntry = {
      path: NATIVE_JAVA_IMPORT_PRIMARY_FILE,
      kind: "file",
      length: Buffer.byteLength(NATIVE_JAVA_IMPORT_FIXTURE),
      sha256: this.#evidence.fixtureSha256,
    };
    assert.equal(
      this.#workspaceTreeBeforeApply.some(
        ({ path: entryPath }) => entryPath === expectedTarget.path,
      ),
      false,
    );
    assert.deepEqual(
      afterApply,
      [...this.#workspaceTreeBeforeApply, expectedTarget].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    );
    this.#evidence.workspaceEntriesAfterApply = afterApply.length;
  }

  async assertRefreshedFileExplorer(relativePath: string): Promise<void> {
    assert.equal(relativePath, NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    const item = await this.browser().$(
      `[role="treeitem"][data-path="${cssAttribute(relativePath)}"]`,
    );
    await item.waitForExist({ timeout: this.remainingApplyTime(), interval: 50 });
    assert.equal(await item.getAttribute("data-path"), relativePath);
  }

  async assertSelectedTab(fileName: string): Promise<void> {
    assert.equal(fileName, path.basename(NATIVE_JAVA_IMPORT_PRIMARY_FILE));
    const tab = await this.browser().$(
      `[role="tab"][data-path="${cssAttribute(NATIVE_JAVA_IMPORT_PRIMARY_FILE)}"]`,
    );
    await this.browser().waitUntil(
      async () => (await tab.isDisplayed()) && (await tab.getAttribute("aria-selected")) === "true",
      { timeout: this.remainingApplyTime(), interval: 50 },
    );
    assert.equal(
      await tab.getComputedLabel(),
      `${fileName} Close ${NATIVE_JAVA_IMPORT_PRIMARY_FILE}`,
    );
    const visibleLabels = await this.browser().execute(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="tab"][aria-selected="true"][data-path] > span',
        ),
      ]
        .map(({ textContent }) => textContent?.trim() ?? "")
        .filter(Boolean),
    );
    assert.deepEqual(visibleLabels, [fileName]);
    assert.equal(await tab.getAttribute("title"), NATIVE_JAVA_IMPORT_PRIMARY_FILE);
    this.#evidence.selectedTab = fileName;
  }

  async assertRealMonacoContent(): Promise<void> {
    const editor = await this.browser().$(
      `[role="textbox"][aria-label^="Code editor for ${cssAttribute(NATIVE_JAVA_IMPORT_PRIMARY_FILE)}"]`,
    );
    await editor.waitForDisplayed({ timeout: this.remainingApplyTime(), interval: 50 });
    await this.browser().waitUntil(
      async () => {
        const inputValue = await editor.getValue();
        const renderedValue = await this.browser().execute(() =>
          [...document.querySelectorAll(".monaco-editor .view-lines .view-line")]
            .map((line) => line.textContent ?? "")
            .join("\n")
            .replaceAll("\u00a0", " "),
        );
        return (
          inputValue === NATIVE_JAVA_IMPORT_FIXTURE || renderedValue === NATIVE_JAVA_IMPORT_FIXTURE
        );
      },
      { timeout: this.remainingApplyTime(), interval: 50 },
    );
    assert.equal(
      await this.browser().$('[data-testid="story-monaco-editor"]').isExisting(),
      false,
      "native Story must not use the mocked Monaco textarea",
    );
    assert.equal(
      await this.browser().$('[data-testid="monaco-code-editor-host"]').isExisting(),
      true,
    );
    this.#evidence.monacoContentMatched = true;
  }

  async assertSourceFreeTranscript(): Promise<void> {
    const transcriptText = await readFile(this.paths().transcript, "utf8");
    assert.equal(transcriptText.includes(NATIVE_JAVA_IMPORT_FIXTURE), false);
    for (const sourceFragment of [
      "package example.imports;",
      "public final class ClipboardImportProof",
      "REQUIREMENT =",
    ]) {
      assert.equal(transcriptText.includes(sourceFragment), false);
    }
    const transcript = await this.transcript();
    assert.deepEqual(
      transcript.map(({ method }) => method),
      [
        "server.capabilities",
        "project.open",
        "server.capabilities",
        "project.open",
        "java.importExternalClass",
        "refactor.discard",
        "java.importExternalClass",
        "refactor.apply",
      ],
    );
    assert.equal(transcript[4]?.plan, NATIVE_JAVA_IMPORT_FIRST_PLAN);
    assert.equal(transcript[5]?.plan, NATIVE_JAVA_IMPORT_FIRST_PLAN);
    assert.equal(transcript[6]?.plan, NATIVE_JAVA_IMPORT_SECOND_PLAN);
    assert.equal(transcript[7]?.plan, NATIVE_JAVA_IMPORT_SECOND_PLAN);
    this.#evidence.transcriptSha256 = createHash("sha256").update(transcriptText).digest("hex");
  }

  async closeWindowAndReleaseClipboard(): Promise<void> {
    const browser = this.browser();
    assert.ok((await bounded(browser.getWindowHandles(), 2_000, "window handle query")).length > 0);
    try {
      await bounded(browser.closeWindow(), 5_000, "native window close");
    } catch (error) {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "All window handles were removed, causing WebdriverIO to close the session.",
      );
    }
    const applicationProcessId = this.#applicationProcessId;
    assert.ok(applicationProcessId);
    await this.waitForProcessExit(applicationProcessId, "release application");
    this.#evidence.applicationExited = true;

    const daemonState = await this.readState(this.paths().daemonState);
    assert.equal(daemonState.pid, this.#daemonProcessId);
    await this.waitForProcessExit(daemonState.pid, "deterministic daemon");
    this.#evidence.daemonExited = true;

    const clipboard = this.#clipboardOwner;
    const clipboardExit = this.#clipboardExit;
    assert.ok(clipboard && clipboardExit);
    clipboard.kill("SIGTERM");
    const clipboardResult = await bounded(
      clipboardExit,
      PROCESS_EXIT_TIMEOUT_MS,
      "clipboard owner exit",
    );
    assert.deepEqual(clipboardResult, { code: 0, signal: null });
    const stopped = await this.readState(this.paths().clipboardState);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.sha256, this.#evidence.fixtureSha256);
    this.#evidence.clipboardOwnerExited = true;

    try {
      await bounded(browser.deleteSession(), 2_000, "WebdriverIO session cleanup");
    } catch {
      // Closing the only native window may already delete the session.
    }
    this.#browser = undefined;
    const driverResult = await terminateProcess(this.#driver);
    assert.ok(driverResult, "tauri-driver exit was not observed");
    this.#driver = undefined;
    this.#evidence.driverExited = true;
    this.restoreEnvironment();
  }

  async assertProcessesExited(): Promise<void> {
    assert.equal(this.#evidence.applicationExited, true);
    assert.equal(this.#evidence.daemonExited, true);
    assert.equal(this.#evidence.clipboardOwnerExited, true);
    assert.equal(this.#evidence.driverExited, true);
    const processIds = [
      this.#applicationProcessId,
      this.#daemonProcessId,
      this.#clipboardProcessId,
      this.#driverProcessId,
    ];
    assert.equal(
      processIds.every((processId) => processId !== undefined),
      true,
    );
    for (const processId of processIds) {
      if (processId !== undefined) assert.equal(await processExists(processId), false);
    }
  }

  async assertConfiguredPathAndProcessConfinement(): Promise<void> {
    const paths = this.paths();
    const canonicalRunner = await realpath(this.#runnerSandbox);
    const canonicalScenario = await realpath(paths.root);
    assert.ok(isContained(canonicalRunner, canonicalScenario));
    const configuredRoots = [
      paths.home,
      paths.xdgConfig,
      paths.xdgCache,
      paths.xdgData,
      paths.xdgState,
      paths.xdgRuntime,
      paths.ideHome,
      paths.workspace,
      paths.daemon,
      path.dirname(paths.transcript),
      paths.clipboard,
      paths.evidence,
    ];
    for (const configuredRoot of configuredRoots) {
      assert.ok(isContained(paths.root, configuredRoot), configuredRoot);
      assert.ok(isContained(canonicalScenario, await realpath(configuredRoot)), configuredRoot);
      await this.assertNoSymlinks(configuredRoot);
    }
    assert.deepEqual(
      [...this.#sandboxMarkedProcessIds].sort((left, right) => left - right),
      [this.#applicationProcessId, this.#clipboardProcessId, this.#driverProcessId].sort(
        (left, right) => (left ?? 0) - (right ?? 0),
      ),
    );
    assert.equal(
      await readFile(path.join(paths.workspace, NATIVE_JAVA_IMPORT_PRIMARY_FILE), "utf8"),
      NATIVE_JAVA_IMPORT_FIXTURE,
    );
    assert.equal(
      await readFile(path.join(paths.workspace, "pom.xml"), "utf8"),
      "<project><modelVersion>4.0.0</modelVersion><artifactId>native-story</artifactId></project>\n",
    );
    assert.deepEqual((await readdir(path.join(paths.workspace, ".ide"))).sort(), [
      "workspace.json",
    ]);
    assert.equal(this.#environmentRestored, true);
    this.#evidence.configuredPathsAndMarkedProcessesConfined = true;
    await writeFile(
      path.join(paths.evidence, "redacted-evidence.json"),
      `${JSON.stringify(this.#evidence, null, 2)}\n`,
      "utf8",
    );
  }

  async assertNoRefactorKitState(relativePath: string): Promise<void> {
    assert.equal(relativePath, ".refactorkit/workspace.lock");
    await assert.rejects(stat(path.join(this.paths().workspace, ".refactorkit")), {
      code: "ENOENT",
    });
  }

  evidence(): Readonly<NativeJavaImportEvidence> {
    return { ...this.#evidence };
  }

  redactedDiagnostics(): string {
    const paths = this.#paths;
    let diagnostic = this.#driverDiagnostic;
    if (paths) diagnostic = diagnostic.replaceAll(paths.root, "<SCENARIO>");
    return diagnostic
      .replaceAll(this.#runnerSandbox, "<RUNNER_SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>")
      .replaceAll(NATIVE_JAVA_IMPORT_FIXTURE, "<FIXTURE_CONTENT>")
      .replace(/\b(password|token|secret)=\S+/giu, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'"]+\/?)+/gu, "<PATH>")
      .slice(-DIAGNOSTIC_LIMIT);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      const browser = this.#browser;
      this.#browser = undefined;
      if (browser) {
        try {
          await bounded(browser.deleteSession(), 2_000, "WebdriverIO failure cleanup");
        } catch {
          // Continue with process-owned cleanup.
        }
      }
      const applicationProcessId = this.#applicationProcessId;
      if (applicationProcessId && (await processExists(applicationProcessId))) {
        try {
          process.kill(applicationProcessId, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        await wait(250);
        if (await processExists(applicationProcessId))
          process.kill(applicationProcessId, "SIGKILL");
      }
      if (this.#paths) {
        try {
          const daemonState = await this.readState(this.#paths.daemonState);
          if (await processExists(daemonState.pid)) {
            process.kill(daemonState.pid, "SIGTERM");
            await wait(250);
            if (await processExists(daemonState.pid)) process.kill(daemonState.pid, "SIGKILL");
          }
        } catch {
          // Daemon may not have started.
        }
      }
      await terminateProcess(this.#clipboardOwner);
      await terminateProcess(this.#driver);
    } finally {
      this.restoreEnvironment();
    }
  }

  private paths(): ScenarioPaths {
    if (!this.#paths) throw new Error("native Java-import scenario sandbox has not been allocated");
    return this.#paths;
  }

  private browser(): Awaited<ReturnType<typeof remote>> {
    if (!this.#browser) throw new Error("native Java-import WebdriverIO session is unavailable");
    return this.#browser;
  }

  private async directoryItem(relativePath: string) {
    return await this.browser().$(`[role="treeitem"][data-path="${cssAttribute(relativePath)}"]`);
  }

  private async reviewDialog() {
    return await this.browser().$('[role="dialog"][aria-modal="true"]');
  }

  private captureDiagnostic(chunk: Buffer): void {
    this.#driverDiagnostic = `${this.#driverDiagnostic}${chunk.toString("utf8")}`.slice(
      -DIAGNOSTIC_LIMIT,
    );
  }

  private remainingPreviewTime(): number {
    const remaining = (this.#previewDeadline ?? 0) - Date.now();
    assert.ok(remaining > 0, "shared native preview deadline expired");
    return remaining;
  }

  private remainingApplyTime(): number {
    const remaining = (this.#applyDeadline ?? 0) - Date.now();
    assert.ok(remaining > 0, "shared native Apply deadline expired");
    return remaining;
  }

  private async transcript(): Promise<TranscriptEvent[]> {
    const text = await readFile(this.paths().transcript, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const value = JSON.parse(line) as TranscriptEvent;
        const allowed = new Set([
          "id",
          "method",
          "plan",
          "target",
          "length",
          "sha256",
          "params",
          "change",
          "primary",
          "writeCount",
        ]);
        assert.equal(
          Object.keys(value).every((key) => allowed.has(key)),
          true,
        );
        assert.equal(Number.isInteger(value.id), true);
        assert.equal(typeof value.method, "string");
        if (value.params !== undefined) {
          assert.deepEqual(Object.keys(value.params), ["planId"]);
          assert.equal(typeof value.params.planId, "string");
        }
        return value;
      });
  }

  private async transcriptIfPresent(): Promise<TranscriptEvent[]> {
    try {
      return await this.transcript();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async canonicalWorkspaceTree(): Promise<readonly WorkspaceTreeEntry[]> {
    const canonicalWorkspace = await realpath(this.paths().workspace);
    const entries: WorkspaceTreeEntry[] = [];
    const pending = [canonicalWorkspace];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      const children = await readdir(directory, { withFileTypes: true });
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        const candidate = path.join(directory, child.name);
        const metadata = await lstat(candidate);
        assert.equal(
          metadata.isSymbolicLink(),
          false,
          `workspace entry is a symlink: ${child.name}`,
        );
        const canonicalCandidate = await realpath(candidate);
        assert.ok(isContained(canonicalWorkspace, canonicalCandidate), canonicalCandidate);
        const relativePath = path.relative(canonicalWorkspace, canonicalCandidate);
        if (metadata.isDirectory()) {
          entries.push({ path: relativePath, kind: "directory" });
          pending.push(canonicalCandidate);
        } else {
          assert.equal(metadata.isFile(), true, `workspace entry is not a file: ${relativePath}`);
          entries.push({
            path: relativePath,
            kind: "file",
            length: metadata.size,
            sha256: await sha256File(canonicalCandidate),
          });
        }
      }
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async assertSandboxMarkedProcess(processId: number): Promise<void> {
    const environment = (await readFile(`/proc/${processId}/environ`, "utf8")).split("\0");
    assert.equal(
      environment.includes(`IDE_STORY_NATIVE_GUI_SANDBOX_PATH=${this.#runnerSandbox}`),
      true,
    );
    assert.equal(
      environment.includes(`IDE_STORY_NATIVE_GUI_ARTIFACT_PATH=${this.paths().evidence}`),
      true,
    );
    assert.ok(isContained(this.paths().root, this.paths().evidence));
    this.#sandboxMarkedProcessIds.add(processId);
  }

  private async waitForTranscriptLength(
    length: number,
    timeoutMs?: number,
  ): Promise<TranscriptEvent[]> {
    const deadline = Date.now() + (timeoutMs ?? this.remainingPreviewTime());
    while (Date.now() < deadline) {
      try {
        const transcript = await this.transcript();
        if (transcript.length >= length) return transcript;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await wait(25);
    }
    throw new Error(`daemon transcript did not reach ${length} events before the shared deadline`);
  }

  private async readState(filePath: string): Promise<FixtureState> {
    return JSON.parse(await readFile(filePath, "utf8")) as FixtureState;
  }

  private async waitForState(
    filePath: string,
    predicate: (state: FixtureState) => boolean,
  ): Promise<FixtureState> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        const state = await this.readState(filePath);
        if (predicate(state)) return state;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await wait(25);
    }
    throw new Error(`fixture state did not become ready: ${path.basename(filePath)}`);
  }

  private async waitForProcessExit(processId: number, label: string): Promise<void> {
    const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
    while (await processExists(processId)) {
      if (Date.now() >= deadline) throw new Error(`${label} ${processId} did not exit`);
      await wait(50);
    }
  }

  private restoreEnvironment(): void {
    if (this.#environmentRestored) return;
    for (const name of OVERRIDDEN_ENVIRONMENT) {
      const original = this.#originalEnvironment.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    this.#environmentRestored = true;
    this.#evidence.environmentRestored = true;
  }

  private async assertNoSymlinks(root: string): Promise<void> {
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        const metadata = await lstat(candidate);
        assert.equal(
          metadata.isSymbolicLink(),
          false,
          `scenario effect is a symbolic link: ${entry.name}`,
        );
        assert.ok(isContained(root, candidate));
        if (entry.isDirectory()) pending.push(candidate);
      }
    }
  }

  private async waitForDriver(port: number): Promise<void> {
    const deadline = Date.now() + DRIVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const exited = this.#driverExit
        ? await Promise.race([this.#driverExit, wait(0).then(() => undefined)])
        : undefined;
      if (exited)
        throw new Error(`tauri-driver exited before readiness: ${JSON.stringify(exited)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/status`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return;
      } catch {
        // Retry to the bounded readiness deadline.
      }
      await wait(50);
    }
    throw new Error(`tauri-driver did not become ready within ${DRIVER_START_TIMEOUT_MS}ms`);
  }

  private async waitForApplicationProcess(): Promise<number> {
    const driverProcessId = this.#driver?.pid;
    assert.ok(driverProcessId, "tauri-driver process ID is unavailable");
    const deadline = Date.now() + SESSION_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const processId = await findExecutableDescendant(driverProcessId, this.#applicationPath);
      if (processId !== undefined) return processId;
      await wait(50);
    }
    throw new Error("release/no-bundle application was not observed under tauri-driver");
  }
}
