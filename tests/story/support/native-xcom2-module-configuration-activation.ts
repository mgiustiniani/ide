import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { remote } from "webdriverio";

import {
  NativeScenarioEnvironmentLease,
  type NativeScenarioEnvironmentEvidence,
} from "./native-scenario-environment.js";

const REQUIREMENT = "REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001" as const;
const GENERIC_WORKSPACE = "plain-notes" as const;
const CONFIGURED_WORKSPACE = "configured-wotc" as const;
const WORKSPACE_NAMES = [GENERIC_WORKSPACE, CONFIGURED_WORKSPACE] as const;
const WORKSPACE_ROLES = Object.freeze({
  [GENERIC_WORKSPACE]: "generic workspace",
  [CONFIGURED_WORKSPACE]: "explicitly configured module",
});
const GENERIC_FILES = Object.freeze(["README.md", "notes/reference.txt"]);
const CONFIGURATION_PATH = ".ide/xcom2.json" as const;
const CONFIGURATION_CONTENTS =
  '{"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"]}' as const;
const CONFIGURATION_SIZE = 63 as const;
const CONFIGURATION_SHA256 =
  "53d92f8cd91d90f49a98a133b5de3ef3862b5472805248780d561e2c9b765dfb" as const;
const MODULE_ROOT = "mods/IntentOnly" as const;
const ACTIVITY_NAME = "XCOM 2 Project" as const;
const BASE_ACTIVITY_NAMES = Object.freeze(["Explorer", "Search", "Docs", "Settings"]);
const CONFIGURED_ACTIVITY_NAMES = Object.freeze([
  "Explorer",
  "Search",
  ACTIVITY_NAME,
  "Docs",
  "Settings",
]);
const BASE_BOTTOM_TOOL_NAMES = Object.freeze(["Terminal", "AI Agent"]);
const FIXED_TIMESTAMP = "2026-07-17T00:00:00Z";
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;

type WorkspaceName = (typeof WORKSPACE_NAMES)[number];
type Browser = Awaited<ReturnType<typeof remote>>;
type DriverExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type RecognitionSnapshot = {
  readonly shown: boolean;
  readonly fields: Record<string, string>;
  readonly reasonHeaders: string[];
  readonly reasonRows: Array<{ kind: string; "workspace-relative path": string }>;
  readonly evidenceHeaders: string[];
  readonly evidenceRows: Array<{ kind: string; "workspace-relative path": string }>;
  readonly alerts: string[];
  readonly interactiveControls: string[];
  readonly text: string;
};
type ConfigurationFingerprint = {
  readonly device: string;
  readonly inode: string;
  readonly mode: number;
  readonly size: string;
  readonly modifiedNanoseconds: string;
  readonly sha256: string;
};
type RefreshSnapshot = {
  readonly elapsed: number;
  readonly completed: boolean;
  readonly activityPresent: boolean;
  readonly recognitionPresent: boolean;
};

export interface NativeXcom2ConfigurationFixtureManifest {
  readonly requirement: typeof REQUIREMENT;
  readonly sourceContentsIncluded: false;
  readonly configurationContentsIncluded: false;
  readonly linuxPathCase: "exact";
  readonly symlinks: "none";
  readonly registry: "IDE_HOME/workspaces.json";
  readonly initialWorkspace: typeof GENERIC_WORKSPACE;
  readonly workspaces: readonly {
    readonly workspace: WorkspaceName;
    readonly role: string;
    readonly canonicalRootWithinScenarioSandbox: true;
    readonly marker: ".ide/workspace.json";
  }[];
  readonly entries: readonly {
    readonly workspace: WorkspaceName;
    readonly relativePath: string;
    readonly kind: "regular-file" | "regular-directory";
    readonly size?: number;
    readonly sha256?: string;
  }[];
}

interface NativeXcom2ConfigurationEvidence {
  readonly requirement: typeof REQUIREMENT;
  readonly boundary: {
    readonly target: "desktop/tauri-webdriver";
    readonly platform: "Linux X11";
    readonly filesystem: "actual scenario-owned sandbox filesystem";
    readonly dom: "production Tauri WebKit DOM";
    readonly artifactKind: "release-no-bundle";
    readonly packagedApplication: false;
    readonly nativeGui: true;
    readonly e2e: true;
    readonly hiddenProductHooks: false;
    readonly claimsExcluded: readonly string[];
  };
  scenarioEnvironment?: Readonly<NativeScenarioEnvironmentEvidence>;
  fixtureManifestAttached?: boolean;
  registryVerified?: boolean;
  fixtureManifestVerified?: boolean;
  configuration?: { readonly relativePath: string; readonly size: number; readonly sha256: string };
  configuredRootsConfined?: boolean;
  conventionEvidenceExcluded?: string[];
  applicationProcessObserved?: boolean;
  viewport?: { readonly width: number; readonly height: number };
  readyWorkspaces: string[];
  negativeContributionChecks: Array<{
    readonly phase: string;
    readonly activityNames: readonly string[];
    readonly bottomToolNames: readonly string[];
    readonly recognitionPanelShown: false;
  }>;
  settingsSwitches: string[];
  configuredActivityObservation?: {
    readonly expected: 1;
    readonly observed: number;
    readonly accessibleNames: readonly string[];
    readonly bottomToolNames: readonly string[];
  };
  activityKeyboardFocusable?: boolean;
  activityOpenedWithKeyboard?: boolean;
  recognitionFieldsMatched?: boolean;
  activationReasonsMatched?: boolean;
  noConfigurationOrScanIssue?: boolean;
  recognitionOnlyExclusionsMatched?: boolean;
  ownerConfigurationActions: string[];
  noWatcherRetentionMilliseconds?: number;
  noConfigurationWatchOrPollObserved?: boolean;
  refreshesInvoked: number;
  synchronousRefreshRevocationObserved?: boolean;
  lateStaleReappearanceExcludedForMilliseconds?: number;
  restoredActivationMatched?: boolean;
  synchronousWorkspaceRemovalObserved?: boolean;
  synchronousRemovalObserved?: boolean;
  configurationBytesUnchanged?: boolean;
  ownerOnlyConfigurationMutationObserved?: boolean;
  responsive?: boolean;
  sandboxConfined?: boolean;
  environmentRestored?: boolean;
  ownedProcessesRemaining?: number;
  disposed?: boolean;
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native configured XCOM Story requires absolute ${name}`);
  }
  return path.normalize(value);
}

function requiredPositiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Native configured XCOM Story requires positive integer ${name}`);
  }
  return value;
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
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
        reject(new Error("Could not reserve a configured XCOM Story TCP port"));
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

function workspaceId(name: WorkspaceName): string {
  return `story-${name}`;
}

function isWorkspaceName(value: string): value is WorkspaceName {
  return (WORKSPACE_NAMES as readonly string[]).includes(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Native Story driver for explicit configuration activation. Existing
 * runner-neutral shared steps dispatch through the Story-world boundary; all
 * runtime state is owned here and no production hook or fake backend is used.
 */
export class NativeXcom2ModuleConfigurationActivationSession {
  readonly #runnerSandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #desiredWidth = requiredPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH");
  readonly #desiredHeight = requiredPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT");
  readonly #evidence: NativeXcom2ConfigurationEvidence = {
    requirement: REQUIREMENT,
    boundary: {
      target: "desktop/tauri-webdriver",
      platform: "Linux X11",
      filesystem: "actual scenario-owned sandbox filesystem",
      dom: "production Tauri WebKit DOM",
      artifactKind: "release-no-bundle",
      packagedApplication: false,
      nativeGui: true,
      e2e: true,
      hiddenProductHooks: false,
      claimsExcluded: [
        "application package",
        "Wayland",
        "other operating systems",
        "DPI behavior",
        "proprietary content",
        "module-content parsing",
        "external roots",
        "configuration watcher or polling",
        "build capability",
        "language capability",
      ],
    },
    readyWorkspaces: [],
    negativeContributionChecks: [],
    settingsSwitches: [],
    ownerConfigurationActions: [],
    refreshesInvoked: 0,
  };
  readonly #workspaceRoots = new Map<WorkspaceName, string>();
  #lease?: NativeScenarioEnvironmentLease;
  #manifest?: NativeXcom2ConfigurationFixtureManifest;
  #configurationBytes?: Buffer;
  #initialConfigurationFingerprint?: ConfigurationFingerprint;
  #restoredConfigurationFingerprint?: ConfigurationFingerprint;
  #expectedRecognitionFields?: Record<string, string>;
  #expectedReasonRows?: Array<{ kind: string; "workspace-relative path": string }>;
  #preRemovalRecognitionSnapshot?: RecognitionSnapshot;
  #lastRefreshSnapshots?: readonly RefreshSnapshot[];
  #genericFilesCreated = false;
  #moduleRootCreated = false;
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Browser;
  #applicationProcessId?: number;
  #sessionDeleted = false;
  #disposed = false;

  async allocateScenario(
    rows: readonly { workspace: string; "initial role": string }[],
  ): Promise<void> {
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(process.env.GDK_BACKEND, "x11");
    assert.equal(process.env.WAYLAND_DISPLAY, undefined);
    assert.deepEqual(
      rows,
      WORKSPACE_NAMES.map((workspace) => ({
        workspace,
        "initial role": WORKSPACE_ROLES[workspace],
      })),
    );
    assert.equal(this.#lease, undefined, "configured XCOM scenario already allocated");

    const lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT, {
      workspaceName: GENERIC_WORKSPACE,
    });
    this.#lease = lease;
    assert.equal(lease.runnerSandbox, this.#runnerSandbox);
    await lease.assertConfiguredPathsConfined();

    const workspacesDirectory = path.dirname(lease.paths.workspace);
    for (const name of WORKSPACE_NAMES) {
      const root =
        name === GENERIC_WORKSPACE ? lease.paths.workspace : path.join(workspacesDirectory, name);
      assert.ok(isContained(lease.paths.root, root));
      await mkdir(path.join(root, ".ide"), { recursive: true });
      const canonicalRoot = await realpath(root);
      assert.ok(isContained(await realpath(lease.paths.root), canonicalRoot));
      assert.equal(path.basename(canonicalRoot), name);
      this.#workspaceRoots.set(name, canonicalRoot);
      const marker = {
        id: workspaceId(name),
        path: canonicalRoot,
        name,
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
      };
      await writeFile(
        path.join(canonicalRoot, ".ide/workspace.json"),
        `${JSON.stringify(marker, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }

    const registry = {
      version: 1,
      workspaces: WORKSPACE_NAMES.map((name) => ({
        id: workspaceId(name),
        name,
        rootPath: this.workspaceRoot(name),
        markerFolder: ".ide",
        createdAt: FIXED_TIMESTAMP,
        lastOpenedAt: FIXED_TIMESTAMP,
      })),
      currentWorkspaceId: workspaceId(GENERIC_WORKSPACE),
    };
    const registryPath = path.join(lease.paths.ideHome, "workspaces.json");
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    const registryMetadata = await lstat(registryPath);
    assert.equal(registryMetadata.isFile(), true);
    assert.equal(registryMetadata.isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(await readFile(registryPath, "utf8")), registry);
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.workspaceRoot(GENERIC_WORKSPACE));
    this.#evidence.registryVerified = true;
  }

  async createWorkspaceFixtures(
    workspace: string,
    relativePaths: readonly string[],
  ): Promise<void> {
    assert.equal(workspace, GENERIC_WORKSPACE);
    assert.deepEqual(relativePaths, GENERIC_FILES);
    assert.equal(this.#genericFilesCreated, false);
    const root = this.workspaceRoot(GENERIC_WORKSPACE);
    for (const relativePath of relativePaths) {
      assert.equal(path.posix.normalize(relativePath), relativePath);
      const candidate = path.join(root, ...relativePath.split("/"));
      assert.ok(isContained(root, candidate));
      await mkdir(path.dirname(candidate), { recursive: true });
      await writeFile(candidate, "", { encoding: "utf8", flag: "wx" });
      const metadata = await lstat(candidate);
      assert.equal(metadata.isFile(), true);
      assert.equal(metadata.isSymbolicLink(), false);
      assert.equal(metadata.size, 0);
    }
    this.#genericFilesCreated = true;
  }

  async assertGenericContainsNoConventionEvidence(
    workspace: string,
    configurationPath: string,
  ): Promise<void> {
    assert.equal(workspace, GENERIC_WORKSPACE);
    assert.equal(configurationPath, CONFIGURATION_PATH);
    assert.equal(this.#genericFilesCreated, true);
    const root = this.workspaceRoot(GENERIC_WORKSPACE);
    await assert.rejects(lstat(path.join(root, CONFIGURATION_PATH)), { code: "ENOENT" });
    assert.deepEqual(await this.nonMarkerEntries(root), [
      { path: "README.md", kind: "file" },
      { path: "notes", kind: "directory" },
      { path: "notes/reference.txt", kind: "file" },
    ]);
    this.#evidence.conventionEvidenceExcluded = [GENERIC_WORKSPACE];
  }

  async assertConfiguredContainsNoConventionEvidence(workspace: string): Promise<void> {
    assert.equal(workspace, CONFIGURED_WORKSPACE);
    assert.deepEqual(await this.nonMarkerEntries(this.workspaceRoot(CONFIGURED_WORKSPACE)), []);
    this.#evidence.conventionEvidenceExcluded = [
      ...(this.#evidence.conventionEvidenceExcluded ?? []),
      CONFIGURED_WORKSPACE,
    ];
  }

  async createEmptyModuleRoot(relativePath: string): Promise<void> {
    assert.equal(relativePath, MODULE_ROOT);
    const root = this.workspaceRoot(CONFIGURED_WORKSPACE);
    const moduleRoot = path.join(root, ...relativePath.split("/"));
    assert.ok(isContained(root, moduleRoot));
    await mkdir(moduleRoot, { recursive: true });
    const metadata = await lstat(moduleRoot);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.deepEqual(await readdir(moduleRoot), []);
    this.#moduleRootCreated = true;
  }

  async createExactConfiguration(
    relativePath: string,
    encodingBits: number,
    contents: string,
  ): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    assert.equal(encodingBits, 8);
    assert.equal(contents, CONFIGURATION_CONTENTS);
    assert.equal(this.#moduleRootCreated, true);
    const bytes = Buffer.from(contents, "utf8");
    assert.equal(bytes.toString("utf8"), CONFIGURATION_CONTENTS);
    assert.equal(bytes.byteLength, CONFIGURATION_SIZE);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), CONFIGURATION_SHA256);
    const configurationPath = this.configurationPath();
    await writeFile(configurationPath, bytes, { flag: "wx" });
    const fingerprint = await this.configurationFingerprint();
    assert.equal(fingerprint.size, String(CONFIGURATION_SIZE));
    assert.equal(fingerprint.sha256, CONFIGURATION_SHA256);
    this.#configurationBytes = bytes;
    this.#initialConfigurationFingerprint = fingerprint;
    this.#evidence.ownerConfigurationActions.push("initial-fixture-create");
    this.#evidence.configuration = {
      relativePath: CONFIGURATION_PATH,
      size: bytes.byteLength,
      sha256: fingerprint.sha256,
    };
  }

  async assertConfiguredRootConfined(workspace: string): Promise<void> {
    assert.equal(workspace, CONFIGURED_WORKSPACE);
    assert.ok(this.#configurationBytes, "exact configuration bytes are unavailable");
    await this.assertWorkspaceTreeExact();
    await this.assertConfiguredDirectoriesConfined();

    this.#manifest = {
      requirement: REQUIREMENT,
      sourceContentsIncluded: false,
      configurationContentsIncluded: false,
      linuxPathCase: "exact",
      symlinks: "none",
      registry: "IDE_HOME/workspaces.json",
      initialWorkspace: GENERIC_WORKSPACE,
      workspaces: WORKSPACE_NAMES.map((name) => ({
        workspace: name,
        role: WORKSPACE_ROLES[name],
        canonicalRootWithinScenarioSandbox: true,
        marker: ".ide/workspace.json",
      })),
      entries: [
        ...GENERIC_FILES.map((relativePath) => ({
          workspace: GENERIC_WORKSPACE,
          relativePath,
          kind: "regular-file" as const,
          size: 0,
          sha256: EMPTY_SHA256,
        })),
        {
          workspace: CONFIGURED_WORKSPACE,
          relativePath: MODULE_ROOT,
          kind: "regular-directory" as const,
        },
        {
          workspace: CONFIGURED_WORKSPACE,
          relativePath: CONFIGURATION_PATH,
          kind: "regular-file" as const,
          size: this.#configurationBytes.byteLength,
          sha256: createHash("sha256").update(this.#configurationBytes).digest("hex"),
        },
      ],
    };
    await writeFile(
      path.join(this.lease().paths.evidence, "xcom2-configuration-fixture-manifest.json"),
      `${JSON.stringify(this.#manifest, null, 2)}\n`,
      "utf8",
    );
    this.#evidence.fixtureManifestVerified = true;
    this.#evidence.configuredRootsConfined = true;
    this.#evidence.sandboxConfined = true;
  }

  configurationFixtureManifest(): Readonly<NativeXcom2ConfigurationFixtureManifest> {
    if (!this.#manifest) throw new Error("configured XCOM fixture manifest is unavailable");
    return this.#manifest;
  }

  markFixtureManifestAttached(): void {
    assert.ok(this.#manifest);
    this.#evidence.fixtureManifestAttached = true;
  }

  async launch(initialWorkspace: string): Promise<void> {
    assert.equal(initialWorkspace, GENERIC_WORKSPACE);
    assert.equal(this.#evidence.fixtureManifestVerified, true);
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.workspaceRoot(GENERIC_WORKSPACE));
    assert.equal(this.#driver, undefined, "configured XCOM session already launched");
    assert.equal(this.#desiredWidth, 1440);
    assert.equal(this.#desiredHeight, 900);
    await this.assertConfigurationFingerprint(this.#initialConfigurationFingerprint);
    await Promise.all([
      access(this.#tauriDriverPath, fsConstants.X_OK),
      access(this.#webKitWebDriverPath, fsConstants.X_OK),
      access(this.#applicationPath, fsConstants.X_OK),
    ]);
    assert.equal((await stat(this.#applicationPath)).isFile(), true);

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
    const capture = (chunk: Buffer): void => {
      this.#driverDiagnostic = `${this.#driverDiagnostic}${chunk.toString("utf8")}`.slice(
        -DIAGNOSTIC_LIMIT,
      );
    };
    driver.stdout?.on("data", capture);
    driver.stderr?.on("data", capture);
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
        "WebdriverIO configured XCOM session start",
      );
      this.#applicationProcessId = await this.waitForApplicationProcess();
      this.#evidence.applicationProcessObserved = true;
      await this.browser().setWindowSize(this.#desiredWidth, this.#desiredHeight);
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  async assertViewport(): Promise<void> {
    await this.browser().waitUntil(
      async () => {
        const viewport = await this.documentViewport();
        return viewport.width === this.#desiredWidth && viewport.height === this.#desiredHeight;
      },
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "production WebKit DOM viewport did not become exactly 1440x900",
      },
    );
    const viewport = await this.documentViewport();
    assert.deepEqual(viewport, { width: 1440, height: 900 });
    this.#evidence.viewport = viewport;
  }

  async waitForWorkspaceReady(seconds: number, expectedWorkspace: string): Promise<void> {
    assert.equal(seconds, 15);
    assert.ok(isWorkspaceName(expectedWorkspace));
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute((workspaceName) => {
          const header = document.querySelector("#root > div > header");
          const headerReady = (header?.textContent ?? "").includes(`Workspace: ${workspaceName}`);
          const explorer = document.querySelector('[role="tree"][aria-label="File Explorer"]');
          const workspaceExplorer = document.querySelector(".workspace-explorer");
          const explorerIdle =
            workspaceExplorer === null || workspaceExplorer.getAttribute("aria-busy") !== "true";
          return headerReady && explorer !== null && explorerIdle;
        }, expectedWorkspace),
      {
        timeout: seconds * 1_000,
        interval: 50,
        timeoutMsg: `${expectedWorkspace} did not become ready within ${seconds}s`,
      },
    );
    this.#evidence.readyWorkspaces.push(expectedWorkspace);
  }

  async assertNoConfiguredContributions(activityName: string, phase?: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const [activityNames, bottomToolNames, panel] = await Promise.all([
      this.activityNames(),
      this.bottomContributionNames(),
      this.recognitionSnapshot(),
    ]);
    assert.deepEqual(activityNames, BASE_ACTIVITY_NAMES);
    assert.deepEqual(bottomToolNames, BASE_BOTTOM_TOOL_NAMES);
    assert.equal(panel.shown, false);
    this.#evidence.negativeContributionChecks.push({
      phase: phase ?? "workspace",
      activityNames: [...activityNames],
      bottomToolNames: [...bottomToolNames],
      recognitionPanelShown: false,
    });
  }

  async switchWorkspace(workspace: string): Promise<void> {
    assert.equal(workspace, CONFIGURED_WORKSPACE);
    await this.openWorkspaceSettings();
    const dialog = await this.settingsDialog();
    const switchButton = await dialog.$(`[aria-label="Switch to ${workspace}"]`);
    await switchButton.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await switchButton.isEnabled(), true);
    await switchButton.click();
    this.#evidence.settingsSwitches.push(workspace);
  }

  async assertExactlyOneActivityWithin(seconds: number, activityName: string): Promise<void> {
    assert.equal(seconds, 15);
    assert.equal(activityName, ACTIVITY_NAME);
    const deadline = Date.now() + seconds * 1_000;
    let names: readonly string[] = [];
    while (Date.now() < deadline) {
      names = await this.activityNames();
      if (names.filter((name) => name === activityName).length !== 0) break;
      await wait(50);
    }
    names = await this.activityNames();
    const bottomToolNames = await this.bottomContributionNames();
    const count = names.filter((name) => name === activityName).length;
    this.#evidence.configuredActivityObservation = {
      expected: 1,
      observed: count,
      accessibleNames: [...names],
      bottomToolNames: [...bottomToolNames],
    };
    await this.assertConfigurationFingerprint(this.#initialConfigurationFingerprint);
    const diagnostic = await this.publicUiDiagnostic();
    assert.equal(
      count,
      1,
      `Expected exactly one accessible ${activityName} activity after exact configured-workspace activation; observed ${count}. The generic and configured workspace fixtures and real Settings switch completed first. Public UI: ${JSON.stringify(diagnostic)}`,
    );
    assert.deepEqual(names, CONFIGURED_ACTIVITY_NAMES);
    assert.deepEqual(bottomToolNames, BASE_BOTTOM_TOOL_NAMES);
    await this.closeSettingsIfOpen();
  }

  async assertActivityKeyboardFocusable(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const controls = await this.activityControlsNamed(activityName);
    assert.equal(controls.length, 1);
    const control = controls[0]!;
    assert.equal(await control.getTagName(), "button");
    assert.equal(await control.getAttribute("type"), "button");
    assert.equal(await control.getAttribute("disabled"), null);
    assert.equal(await control.getAttribute("aria-disabled"), null);
    assert.equal(await control.getComputedLabel(), activityName);
    assert.equal(await control.getAttribute("tabindex"), "-1");
    const prepared = await this.browser().execute(() => {
      const active = document.querySelector<HTMLElement>(
        'nav[aria-label="Primary activity"] [role="tab"][aria-selected="true"]',
      );
      active?.focus();
      return {
        label: active?.getAttribute("aria-label") ?? "",
        focused: document.activeElement === active,
        tabIndex: active?.tabIndex ?? -999,
      };
    });
    assert.deepEqual(prepared, { label: "Explorer", focused: true, tabIndex: 0 });
    await this.browser().keys(["End"]);
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute((name) => {
          const candidate = document.activeElement as HTMLElement | null;
          return (
            candidate?.getAttribute("role") === "tab" &&
            candidate.getAttribute("aria-label") === name &&
            candidate.getAttribute("aria-selected") === "true" &&
            candidate.tabIndex === 0
          );
        }, activityName),
      { timeout: 5_000, interval: 50, timeoutMsg: `${activityName} was not keyboard-reachable` },
    );
    assert.equal((await this.recognitionSnapshot()).shown, true);
    this.#evidence.activityKeyboardFocusable = true;
  }

  async openActivityWithKeyboard(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    assert.equal(this.#evidence.activityKeyboardFocusable, true);
    await this.browser().keys(["Enter"]);
    await this.browser().waitUntil(async () => (await this.recognitionSnapshot()).shown, {
      timeout: 5_000,
      interval: 50,
      timeoutMsg: `${activityName} recognition panel did not open from the keyboard`,
    });
    this.#evidence.activityOpenedWithKeyboard = true;
  }

  async assertRecognitionFields(
    expectedRows: readonly { field: string; value: string }[],
  ): Promise<void> {
    assert.equal(expectedRows.length, 7);
    assert.equal(new Set(expectedRows.map(({ field }) => field)).size, 7);
    const expected = Object.fromEntries(expectedRows.map(({ field, value }) => [field, value]));
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.fields, expected);
    this.#expectedRecognitionFields = expected;
    this.#evidence.recognitionFieldsMatched = true;
  }

  async assertOrderedActivationReasons(
    expectedRows: readonly { kind: string; "workspace-relative path": string }[],
  ): Promise<void> {
    assert.deepEqual(expectedRows, [
      { kind: "explicit-configuration", "workspace-relative path": CONFIGURATION_PATH },
    ]);
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.reasonHeaders, ["kind", "workspace-relative path"]);
    assert.deepEqual(snapshot.reasonRows, expectedRows);
    this.#expectedReasonRows = [...expectedRows];
    this.#evidence.activationReasonsMatched = true;
  }

  async assertNoConfigurationOrScanIssue(): Promise<void> {
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.alerts, []);
    assert.doesNotMatch(
      snapshot.text,
      /configuration (?:error|issue)|invalid configuration|permission[- ]denied|depth[- ]limit|entry[- ]limit|symlink[- ]rejected|scan failed/iu,
    );
    this.#evidence.noConfigurationOrScanIssue = true;
  }

  async assertConfigurationRecognitionOnlyExclusions(): Promise<void> {
    const [activityNames, bottomNames, snapshot] = await Promise.all([
      this.activityNames(),
      this.bottomContributionNames(),
      this.recognitionSnapshot(),
    ]);
    assert.deepEqual(activityNames, CONFIGURED_ACTIVITY_NAMES);
    assert.deepEqual(bottomNames, BASE_BOTTOM_TOOL_NAMES);
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.interactiveControls, []);
    assert.equal(
      snapshot.fields.limitation,
      "Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution.",
    );
    assert.equal(
      activityNames.some((name) => /build|problems|logs/iu.test(name)),
      false,
    );
    assert.equal(
      bottomNames.some((name) => /xcom|build|problems|logs/iu.test(name)),
      false,
    );
    this.#evidence.recognitionOnlyExclusionsMatched = true;
  }

  async removeConfigurationExternally(relativePath: string): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    await this.assertConfigurationFingerprint(this.#initialConfigurationFingerprint);
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.fields, this.#expectedRecognitionFields);
    assert.deepEqual(snapshot.reasonRows, this.#expectedReasonRows);
    assert.deepEqual(snapshot.alerts, []);
    assert.deepEqual(snapshot.interactiveControls, []);
    this.#preRemovalRecognitionSnapshot = snapshot;
    await rm(this.configurationPath());
    await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
    this.#evidence.ownerConfigurationActions.push("external-remove");
  }

  async assertOneSecondRetention(): Promise<void> {
    await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
    const expected = this.#preRemovalRecognitionSnapshot;
    assert.ok(expected, "the exact open pre-removal recognition panel was not captured");
    assert.deepEqual(await this.recognitionSnapshot(), expected);
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const [names, bottomNames, snapshot] = await Promise.all([
        this.activityNames(),
        this.bottomContributionNames(),
        this.recognitionSnapshot(),
      ]);
      assert.deepEqual(names, CONFIGURED_ACTIVITY_NAMES);
      assert.deepEqual(bottomNames, BASE_BOTTOM_TOOL_NAMES);
      assert.deepEqual(snapshot, expected);
      await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
      await wait(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    this.#evidence.noWatcherRetentionMilliseconds = 1_000;
  }

  assertNoConfigurationWatchOrPollRefresh(): void {
    assert.equal(this.#evidence.noWatcherRetentionMilliseconds, 1_000);
    this.#evidence.noConfigurationWatchOrPollObserved = true;
  }

  async invokeWorkspaceRefresh(controlName: string): Promise<void> {
    assert.equal(controlName, "Workspace Refresh");
    await this.openWorkspaceSettings();
    const result = (await bounded(
      this.browser().executeAsync((activityName, done) => {
        const normalized = (value: string | null | undefined): string =>
          (value ?? "").replace(/\s+/gu, " ").trim();
        const snapshots: RefreshSnapshot[] = [];
        const startedAt = performance.now();
        const activityControl = (): HTMLElement | null =>
          [
            ...document.querySelectorAll<HTMLElement>(
              'nav[aria-label="Primary activity"] [role="tab"]',
            ),
          ].find((candidate) => candidate.getAttribute("aria-label") === activityName) ?? null;
        const recognitionPanel = (): HTMLElement | null => {
          const control = activityControl();
          return (
            [
              ...document.querySelectorAll<HTMLElement>(
                '[role="tabpanel"], [role="region"], section[aria-labelledby]',
              ),
            ].find(
              (candidate) =>
                candidate.getAttribute("aria-label") === activityName ||
                (control?.id && candidate.getAttribute("aria-labelledby") === control.id),
            ) ?? null
          );
        };
        const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
        const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
          (candidate) => normalized(candidate.textContent) === "Refresh workspace",
        );
        if (!button) {
          done({ error: "actual Refresh workspace Settings control is missing", snapshots });
          return;
        }
        let sawPending = false;
        const sample = (): void => {
          sawPending ||= button.disabled;
          const completed = [
            ...(dialog?.querySelectorAll<HTMLElement>('[role="status"]') ?? []),
          ].some(
            (candidate) => normalized(candidate.textContent) === "Workspace metadata refreshed.",
          );
          snapshots.push({
            elapsed: Math.round(performance.now() - startedAt),
            completed,
            activityPresent: activityControl() !== null,
            recognitionPresent: recognitionPanel() !== null,
          });
        };
        sample();
        const observer = new MutationObserver(sample);
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        button.click();
        const interval = window.setInterval(() => {
          sample();
          const latest = snapshots.at(-1)!;
          if (sawPending && latest.completed && !button.disabled) {
            window.clearTimeout(deadline);
            window.clearInterval(interval);
            observer.disconnect();
            done({ snapshots });
          }
        }, 20);
        const deadline = window.setTimeout(() => {
          window.clearInterval(interval);
          observer.disconnect();
          sample();
          done({ error: "Workspace Refresh did not report completion within 15000ms", snapshots });
        }, 15_000);
      }, ACTIVITY_NAME),
      17_000,
      "actual Workspace Refresh observation",
    )) as { readonly error?: string; readonly snapshots: readonly RefreshSnapshot[] };
    assert.equal(result.error, undefined, result.error);
    assert.ok(result.snapshots.length > 1);
    const first = result.snapshots[0]!;
    if (this.#evidence.refreshesInvoked === 0) {
      assert.deepEqual(
        { activityPresent: first.activityPresent, recognitionPresent: first.recognitionPresent },
        { activityPresent: true, recognitionPresent: true },
      );
      await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
    } else {
      assert.equal(this.#evidence.refreshesInvoked, 1);
      assert.deepEqual(
        { activityPresent: first.activityPresent, recognitionPresent: first.recognitionPresent },
        { activityPresent: false, recognitionPresent: false },
      );
      await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    }
    this.#lastRefreshSnapshots = result.snapshots;
    this.#evidence.refreshesInvoked += 1;
  }

  assertSynchronousRefreshRevocation(): void {
    const snapshots = this.#lastRefreshSnapshots;
    assert.ok(snapshots && snapshots.length > 1, "Workspace Refresh evidence is unavailable");
    assert.equal(
      snapshots.some(
        (snapshot) =>
          snapshot.completed && (snapshot.activityPresent || snapshot.recognitionPresent),
      ),
      false,
      `Workspace Refresh reported completion before configured contribution revocation: ${JSON.stringify(snapshots.slice(-20))}`,
    );
    const final = snapshots.at(-1)!;
    assert.deepEqual(
      {
        completed: final.completed,
        activityPresent: final.activityPresent,
        recognitionPresent: final.recognitionPresent,
      },
      { completed: true, activityPresent: false, recognitionPresent: false },
    );
    this.#evidence.synchronousRefreshRevocationObserved = true;
  }

  async assertNoLateStaleReappearance(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [names, bottomNames, snapshot] = await Promise.all([
        this.activityNames(),
        this.bottomContributionNames(),
        this.recognitionSnapshot(),
      ]);
      assert.equal(names.includes(activityName), false);
      assert.equal(snapshot.shown, false);
      assert.equal(
        bottomNames.some((name) => /xcom/iu.test(name)),
        false,
      );
      await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
      await wait(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    this.#evidence.lateStaleReappearanceExcludedForMilliseconds = 5_000;
  }

  async restoreConfigurationExternally(relativePath: string, encodingBits: number): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    assert.equal(encodingBits, 8);
    const bytes = this.configurationBytes();
    await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
    await writeFile(this.configurationPath(), bytes, { flag: "wx" });
    this.#restoredConfigurationFingerprint = await this.configurationFingerprint();
    assert.equal(
      this.#restoredConfigurationFingerprint.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    this.#evidence.ownerConfigurationActions.push("external-restore");
  }

  async assertRestoredActivation(seconds: number, activityName: string): Promise<void> {
    assert.equal(seconds, 15);
    assert.equal(activityName, ACTIVITY_NAME);
    assert.equal(this.#evidence.refreshesInvoked, 2);
    await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    const deadline = Date.now() + seconds * 1_000;
    while (Date.now() < deadline) {
      if ((await this.activityNames()).filter((name) => name === activityName).length === 1) break;
      await wait(50);
    }
    const names = await this.activityNames();
    assert.equal(names.filter((name) => name === activityName).length, 1);
    assert.deepEqual(names, CONFIGURED_ACTIVITY_NAMES);
    await this.closeSettingsIfOpen();
    await this.assertActivityKeyboardFocusable(activityName);
    await this.openActivityWithKeyboard(activityName);
    const snapshot = await this.recognitionSnapshot();
    assert.deepEqual(snapshot.fields, this.#expectedRecognitionFields);
    assert.deepEqual(snapshot.reasonHeaders, ["kind", "workspace-relative path"]);
    assert.deepEqual(snapshot.reasonRows, this.#expectedReasonRows);
    await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    this.#evidence.restoredActivationMatched = true;
  }

  async switchBackToGeneric(workspace: string): Promise<void> {
    assert.equal(workspace, GENERIC_WORKSPACE);
    await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    assert.deepEqual(await this.activityNames(), CONFIGURED_ACTIVITY_NAMES);
    const openPanel = await this.recognitionSnapshot();
    assert.equal(openPanel.shown, true);
    assert.deepEqual(openPanel.fields, this.#expectedRecognitionFields);
    assert.deepEqual(openPanel.reasonRows, this.#expectedReasonRows);
    await this.openWorkspaceSettings();
    const result = (await bounded(
      this.browser().executeAsync(
        (workspaceName, activityName, done) => {
          const startedAt = performance.now();
          const snapshots: Array<{
            elapsed: number;
            genericPresented: boolean;
            activityPresent: boolean;
            recognitionPresent: boolean;
          }> = [];
          const activityControl = (): HTMLElement | null =>
            [
              ...document.querySelectorAll<HTMLElement>(
                'nav[aria-label="Primary activity"] [role="tab"]',
              ),
            ].find((candidate) => candidate.getAttribute("aria-label") === activityName) ?? null;
          const recognitionPanel = (): HTMLElement | null => {
            const control = activityControl();
            return (
              [
                ...document.querySelectorAll<HTMLElement>(
                  '[role="tabpanel"], [role="region"], section[aria-labelledby]',
                ),
              ].find(
                (candidate) =>
                  candidate.getAttribute("aria-label") === activityName ||
                  (control?.id && candidate.getAttribute("aria-labelledby") === control.id),
              ) ?? null
            );
          };
          const sample = (): void => {
            const header = document.querySelector("#root > div > header");
            snapshots.push({
              elapsed: Math.round(performance.now() - startedAt),
              genericPresented: (header?.textContent ?? "").includes(`Workspace: ${workspaceName}`),
              activityPresent: activityControl() !== null,
              recognitionPresent: recognitionPanel() !== null,
            });
          };
          const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
          const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
            (candidate) => candidate.getAttribute("aria-label") === `Switch to ${workspaceName}`,
          );
          if (!button) {
            done({
              error: `real Settings switch control for ${workspaceName} is missing`,
              snapshots,
            });
            return;
          }
          sample();
          const observer = new MutationObserver(sample);
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          button.click();
          const interval = window.setInterval(() => {
            sample();
            const latest = snapshots.at(-1)!;
            if (latest.genericPresented && !latest.activityPresent && !latest.recognitionPresent) {
              window.clearTimeout(deadline);
              window.clearInterval(interval);
              observer.disconnect();
              done({ snapshots });
            }
          }, 20);
          const deadline = window.setTimeout(() => {
            window.clearInterval(interval);
            observer.disconnect();
            sample();
            done({ error: "generic workspace switch observation exceeded 15000ms", snapshots });
          }, 15_000);
        },
        workspace,
        ACTIVITY_NAME,
      ),
      17_000,
      "configured XCOM workspace-switch revocation observation",
    )) as {
      readonly error?: string;
      readonly snapshots: Array<{
        readonly elapsed: number;
        readonly genericPresented: boolean;
        readonly activityPresent: boolean;
        readonly recognitionPresent: boolean;
      }>;
    };
    assert.equal(result.error, undefined, result.error);
    assert.ok(result.snapshots.length > 1);
    assert.deepEqual(result.snapshots[0], {
      elapsed: result.snapshots[0]!.elapsed,
      genericPresented: false,
      activityPresent: true,
      recognitionPresent: true,
    });
    assert.equal(
      result.snapshots.some(
        (snapshot) =>
          snapshot.genericPresented && (snapshot.activityPresent || snapshot.recognitionPresent),
      ),
      false,
    );
    const final = result.snapshots.at(-1)!;
    assert.deepEqual(
      {
        genericPresented: final.genericPresented,
        activityPresent: final.activityPresent,
        recognitionPresent: final.recognitionPresent,
      },
      { genericPresented: true, activityPresent: false, recognitionPresent: false },
    );
    this.#evidence.settingsSwitches.push(workspace);
    this.#evidence.synchronousWorkspaceRemovalObserved = true;
    this.#evidence.synchronousRemovalObserved = true;
  }

  async assertNoGenericBottomContribution(): Promise<void> {
    await this.assertNoConfiguredContributions(ACTIVITY_NAME, "generic-after-return");
  }

  async assertConfigurationBytesUnchanged(relativePath: string): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    assert.deepEqual(await readFile(this.configurationPath()), this.configurationBytes());
    this.#evidence.configurationBytesUnchanged = true;
  }

  async assertOwnerOnlyConfigurationMutation(relativePath: string): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    assert.deepEqual(this.#evidence.ownerConfigurationActions, [
      "initial-fixture-create",
      "external-remove",
      "external-restore",
    ]);
    await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    assert.equal(this.#evidence.configurationBytesUnchanged, true);
    this.#evidence.ownerOnlyConfigurationMutationObserved = true;
  }

  async assertConfiguredDirectoriesRemainConfined(workspace: string): Promise<void> {
    assert.equal(workspace, CONFIGURED_WORKSPACE);
    await this.assertConfiguredDirectoriesConfined();
    await this.assertConfigurationFingerprint(this.#restoredConfigurationFingerprint);
    await this.assertWorkspaceTreeExact();
    this.#evidence.configuredRootsConfined = true;
    this.#evidence.sandboxConfined = true;
  }

  evidence(): Readonly<NativeXcom2ConfigurationEvidence> {
    return {
      ...this.#evidence,
      readyWorkspaces: [...this.#evidence.readyWorkspaces],
      negativeContributionChecks: this.#evidence.negativeContributionChecks.map((entry) => ({
        ...entry,
        activityNames: [...entry.activityNames],
        bottomToolNames: [...entry.bottomToolNames],
      })),
      settingsSwitches: [...this.#evidence.settingsSwitches],
      ownerConfigurationActions: [...this.#evidence.ownerConfigurationActions],
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  redactedDiagnostics(): string {
    let diagnostic = this.#driverDiagnostic;
    if (this.#lease) diagnostic = diagnostic.replaceAll(this.#lease.paths.root, "<SCENARIO>");
    return diagnostic
      .replaceAll(this.#runnerSandbox, "<RUNNER_SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>")
      .replace(/\b(password|token|secret)=\S+/giu, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'"]+\/?)+/gu, "<PATH>")
      .slice(-DIAGNOSTIC_LIMIT);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    try {
      const browser = this.#browser;
      this.#browser = undefined;
      if (browser && !this.#sessionDeleted) {
        try {
          const response = await bounded(
            browser.execute(() => ({
              readyState: document.readyState,
              width: document.documentElement.clientWidth,
              height: document.documentElement.clientHeight,
            })),
            1_000,
            "final configured XCOM DOM responsiveness query",
          );
          if (response.readyState === "complete" && response.width > 0 && response.height > 0) {
            this.#evidence.responsive = true;
          }
        } catch {
          // The production window can already be closed during cleanup.
        }
        try {
          await bounded(browser.deleteSession(), 2_000, "configured XCOM WebDriver cleanup");
          this.#sessionDeleted = true;
        } catch {
          // Continue to owned-process cleanup.
        }
      }

      const driver = this.#driver;
      const driverExit = this.#driverExit;
      this.#driver = undefined;
      this.#driverExit = undefined;
      if (driver && driverExit) {
        if (driver.exitCode === null && driver.signalCode === null) driver.kill("SIGTERM");
        await Promise.race([driverExit.catch(() => undefined), wait(2_000)]);
        if (driver.exitCode === null && driver.signalCode === null) driver.kill("SIGKILL");
        await Promise.race([driverExit.catch(() => undefined), wait(1_000)]);
      }

      const applicationProcessId = this.#applicationProcessId;
      if (applicationProcessId && (await processExists(applicationProcessId))) {
        try {
          process.kill(applicationProcessId, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
        while ((await processExists(applicationProcessId)) && Date.now() < deadline) await wait(50);
        if (await processExists(applicationProcessId)) {
          try {
            process.kill(applicationProcessId, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
      }
      let remaining = 0;
      for (const processId of [driver?.pid, applicationProcessId]) {
        if (processId !== undefined && (await processExists(processId))) remaining += 1;
      }
      this.#evidence.ownedProcessesRemaining = remaining;
      assert.equal(remaining, 0, "owned configured XCOM processes survived cleanup");
    } finally {
      const lease = this.#lease;
      if (lease) {
        await lease.restoreEnvironment();
        this.#evidence.environmentRestored = true;
        await lease.dispose();
      }
      this.#disposed = true;
      this.#evidence.disposed = true;
    }
  }

  private browser(): Browser {
    if (!this.#browser) throw new Error("configured XCOM WebdriverIO session is unavailable");
    return this.#browser;
  }

  private lease(): NativeScenarioEnvironmentLease {
    if (!this.#lease) throw new Error("configured XCOM scenario lease is unavailable");
    return this.#lease;
  }

  private workspaceRoot(name: string): string {
    assert.ok(isWorkspaceName(name), `unexpected configured XCOM workspace: ${name}`);
    const root = this.#workspaceRoots.get(name);
    if (!root) throw new Error(`configured XCOM workspace root is unavailable: ${name}`);
    return root;
  }

  private configurationPath(): string {
    return path.join(this.workspaceRoot(CONFIGURED_WORKSPACE), CONFIGURATION_PATH);
  }

  private configurationBytes(): Buffer {
    if (!this.#configurationBytes) throw new Error("exact configuration bytes are unavailable");
    return this.#configurationBytes;
  }

  private async configurationFingerprint(): Promise<ConfigurationFingerprint> {
    const metadata = await lstat(this.configurationPath(), { bigint: true });
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.equal(metadata.size, BigInt(CONFIGURATION_SIZE));
    const bytes = await readFile(this.configurationPath());
    assert.equal(bytes.byteLength, CONFIGURATION_SIZE);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), CONFIGURATION_SHA256);
    return {
      device: metadata.dev.toString(),
      inode: metadata.ino.toString(),
      mode: Number(metadata.mode),
      size: metadata.size.toString(),
      modifiedNanoseconds: metadata.mtimeNs.toString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  private async assertConfigurationFingerprint(
    expected: ConfigurationFingerprint | undefined,
  ): Promise<void> {
    assert.ok(expected, "expected configuration fingerprint is unavailable");
    assert.deepEqual(await this.configurationFingerprint(), expected);
    const bytes = await readFile(this.configurationPath());
    assert.equal(bytes.byteLength, CONFIGURATION_SIZE);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), CONFIGURATION_SHA256);
    assert.deepEqual(bytes, this.configurationBytes());
  }

  private async nonMarkerEntries(
    root: string,
  ): Promise<Array<{ path: string; kind: "file" | "directory" }>> {
    const entries: Array<{ path: string; kind: "file" | "directory" }> = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        const relativePath = path.relative(root, candidate).split(path.sep).join("/");
        if (relativePath === ".ide/workspace.json") continue;
        if (relativePath === ".ide" && (await readdir(candidate)).length === 1) continue;
        const metadata = await lstat(candidate);
        assert.equal(metadata.isSymbolicLink(), false);
        assert.ok(isContained(root, await realpath(candidate)));
        if (metadata.isDirectory()) {
          entries.push({ path: relativePath, kind: "directory" });
          pending.push(candidate);
        } else {
          assert.equal(metadata.isFile(), true);
          entries.push({ path: relativePath, kind: "file" });
        }
      }
    }
    return entries.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  }

  private async assertWorkspaceTreeExact(): Promise<void> {
    assert.deepEqual(await this.nonMarkerEntries(this.workspaceRoot(GENERIC_WORKSPACE)), [
      { path: "README.md", kind: "file" },
      { path: "notes", kind: "directory" },
      { path: "notes/reference.txt", kind: "file" },
    ]);
    assert.deepEqual(await this.nonMarkerEntries(this.workspaceRoot(CONFIGURED_WORKSPACE)), [
      { path: ".ide", kind: "directory" },
      { path: CONFIGURATION_PATH, kind: "file" },
      { path: "mods", kind: "directory" },
      { path: MODULE_ROOT, kind: "directory" },
    ]);
    assert.deepEqual(
      await readdir(path.join(this.workspaceRoot(CONFIGURED_WORKSPACE), MODULE_ROOT)),
      [],
    );
    for (const root of this.#workspaceRoots.values()) {
      for (const evidencePattern of [
        /\.x2proj$/iu,
        /\.xcommod$/iu,
        /xcomengine\.ini$/iu,
        /\.uc$/iu,
      ]) {
        assert.equal(
          (await this.nonMarkerEntries(root)).some((entry) => evidencePattern.test(entry.path)),
          false,
        );
      }
    }
  }

  private async assertConfiguredDirectoriesConfined(): Promise<void> {
    const workspace = this.workspaceRoot(CONFIGURED_WORKSPACE);
    const canonicalWorkspace = await realpath(workspace);
    const canonicalScenario = await realpath(this.lease().paths.root);
    for (const directory of [
      workspace,
      path.join(workspace, "mods"),
      path.join(workspace, MODULE_ROOT),
    ]) {
      const metadata = await lstat(directory);
      assert.equal(metadata.isDirectory(), true);
      assert.equal(metadata.isSymbolicLink(), false);
      const canonical = await realpath(directory);
      assert.ok(isContained(canonicalWorkspace, canonical));
      assert.ok(isContained(canonicalScenario, canonical));
    }
    const configuration = await lstat(this.configurationPath());
    assert.equal(configuration.isFile(), true);
    assert.equal(configuration.isSymbolicLink(), false);
  }

  private async documentViewport(): Promise<{ width: number; height: number }> {
    return await this.browser().execute(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
  }

  private async activityControlsNamed(name: string) {
    const controls = await this.browser().$$('nav[aria-label="Primary activity"] [role="tab"]');
    const matches = [];
    for (const control of controls) {
      if ((await control.getComputedLabel()) === name) matches.push(control);
    }
    return matches;
  }

  private async activityNames(): Promise<readonly string[]> {
    const controls = await this.browser()
      .$$('nav[aria-label="Primary activity"] [role="tab"]')
      .getElements();
    const names: string[] = [];
    for (const control of controls) names.push(await control.getComputedLabel());
    return names;
  }

  private async bottomContributionNames(): Promise<readonly string[]> {
    const controls = await this.browser().$$('.ide-bottom-panel [role="tab"]').getElements();
    const names: string[] = [];
    for (const control of controls) {
      names.push(normalizeText((await control.getComputedLabel()) || (await control.getText())));
    }
    return names;
  }

  private async recognitionSnapshot(): Promise<RecognitionSnapshot> {
    return await this.browser().execute((activityName) => {
      const normalized = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/gu, " ").trim();
      const activity = [
        ...document.querySelectorAll<HTMLElement>(
          'nav[aria-label="Primary activity"] [role="tab"]',
        ),
      ].find((candidate) => candidate.getAttribute("aria-label") === activityName);
      const panel = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="tabpanel"], [role="region"], section[aria-labelledby]',
        ),
      ].find(
        (candidate) =>
          candidate.getAttribute("aria-label") === activityName ||
          (activity?.id && candidate.getAttribute("aria-labelledby") === activity.id),
      );
      if (!panel) {
        return {
          shown: false,
          fields: {},
          reasonHeaders: [],
          reasonRows: [],
          evidenceHeaders: [],
          evidenceRows: [],
          alerts: [],
          interactiveControls: [],
          text: "",
        };
      }
      const fields: Record<string, string> = {};
      for (const term of panel.querySelectorAll<HTMLElement>("dt")) {
        const key = normalized(term.textContent).toLowerCase();
        if (key) fields[key] = normalized(term.nextElementSibling?.textContent);
      }
      let reasonHeaders: string[] = [];
      let reasonRows: Array<{ kind: string; "workspace-relative path": string }> = [];
      for (const table of panel.querySelectorAll<HTMLTableElement>("table")) {
        const headers = [...table.querySelectorAll<HTMLElement>("thead th")].map((header) =>
          normalized(header.textContent).toLowerCase(),
        );
        if (headers.join("|") !== "kind|workspace-relative path") continue;
        reasonHeaders = headers;
        reasonRows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((row) => {
          const cells = [...row.querySelectorAll<HTMLElement>("th, td")].map((cell) =>
            normalized(cell.textContent),
          );
          return { kind: cells[0] ?? "", "workspace-relative path": cells[1] ?? "" };
        });
        break;
      }
      return {
        shown: true,
        fields,
        reasonHeaders,
        reasonRows,
        evidenceHeaders: reasonHeaders,
        evidenceRows: reasonRows,
        alerts: [...panel.querySelectorAll<HTMLElement>('[role="alert"]')].map((element) =>
          normalized(element.textContent),
        ),
        interactiveControls: [
          ...panel.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
          ),
        ].map(
          (element) =>
            element.getAttribute("aria-label") ||
            normalized(element.textContent) ||
            element.tagName,
        ),
        text: normalized(panel.textContent),
      };
    }, ACTIVITY_NAME);
  }

  private async settingsDialog() {
    const dialog = await this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await dialog.getComputedLabel(), "Settings");
    return dialog;
  }

  private async openWorkspaceSettings(): Promise<void> {
    const existing = await this.browser().$('[role="dialog"]');
    if (!(await existing.isExisting())) {
      const header = await this.browser().$("#root > div > header");
      const buttons = await header.$$("button");
      let settingsClicked = false;
      for (const button of buttons) {
        if (normalizeText(await button.getText()) !== "Settings") continue;
        await button.click();
        settingsClicked = true;
        break;
      }
      assert.equal(settingsClicked, true, "real Settings button is missing");
    }
    await this.settingsDialog();
    const selected = await this.browser().execute(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const tabs = [...(dialog?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
      const tab = tabs.find(
        (candidate) => candidate.querySelector("span")?.textContent?.trim() === "Workspace",
      );
      tab?.click();
      return tab !== undefined;
    });
    assert.equal(selected, true, "real Settings Workspace tab is missing");
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute(() =>
          [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [role="tab"]')].some(
            (candidate) =>
              candidate.querySelector("span")?.textContent?.trim() === "Workspace" &&
              candidate.getAttribute("aria-selected") === "true",
          ),
        ),
      { timeout: 5_000, interval: 50 },
    );
  }

  private async closeSettingsIfOpen(): Promise<void> {
    const dialog = await this.browser().$('[role="dialog"]');
    if (!(await dialog.isExisting())) return;
    const close = await dialog.$('[aria-label="Close settings"]');
    await close.click();
    await this.browser().waitUntil(async () => !(await dialog.isExisting()), {
      timeout: 5_000,
      interval: 50,
    });
  }

  private async publicUiDiagnostic(): Promise<Record<string, unknown>> {
    return {
      workspaceHeader: await this.browser().execute(
        () =>
          document
            .querySelector("#root > div > header")
            ?.textContent?.replace(/\s+/gu, " ")
            .trim() ?? "",
      ),
      activityNames: await this.activityNames(),
      bottomContributionNames: await this.bottomContributionNames(),
      settingsOpen: await this.browser().$('[role="dialog"]').isExisting(),
      recognitionPanelShown: (await this.recognitionSnapshot()).shown,
      configuration: this.#evidence.configuration,
    };
  }

  private async waitForDriver(port: number): Promise<void> {
    const deadline = Date.now() + DRIVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const exited = this.#driverExit
        ? await Promise.race([
            this.#driverExit.then((result) => result),
            wait(0).then(() => undefined),
          ])
        : undefined;
      if (exited)
        throw new Error(`tauri-driver exited before readiness: ${JSON.stringify(exited)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/status`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return;
      } catch {
        // Retry until the bounded readiness deadline.
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
    throw new Error("release/no-bundle executable process was not observed under tauri-driver");
  }
}
