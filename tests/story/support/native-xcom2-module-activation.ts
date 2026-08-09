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

const REQUIREMENT = "REQ-XCOM2-MODULE-ACTIVATION-001" as const;
const GENERIC_WORKSPACE = "xcom-reference-notes" as const;
const AMBIGUOUS_WORKSPACE = "ambiguous-wotc" as const;
const CREDIBLE_WORKSPACE = "credible-wotc" as const;
const ACTIVITY_NAME = "XCOM 2 Project" as const;
const BUILD_RECIPE_REVIEW_NAME = "Default Build recipe" as const;
const LEGACY_RECOGNITION_LIMITATION =
  "Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution." as const;
const RECIPE_REVIEW_RECOGNITION_LIMITATION =
  "Recognition remains read-only: recipe review provides no Build, Run, Deploy, Cook, Launch, Problems, Logs, language support, or bottom contribution." as const;
const WORKSPACE_NAMES = [GENERIC_WORKSPACE, AMBIGUOUS_WORKSPACE, CREDIBLE_WORKSPACE] as const;
const WORKSPACE_FIXTURES = Object.freeze({
  [GENERIC_WORKSPACE]: Object.freeze(["README.md", "notes/reference.txt"]),
  [AMBIGUOUS_WORKSPACE]: Object.freeze(["mods/Maybe/Config/XComEngine.ini"]),
  [CREDIBLE_WORKSPACE]: Object.freeze([
    "mods/CovertOps/CovertOps.x2proj",
    "mods/CovertOps/CovertOps.XComMod",
    "mods/CovertOps/Config/XComEngine.ini",
    "mods/CovertOps/Src/CovertOps/Classes/X2DownloadableContentInfo_CovertOps.uc",
  ]),
});
const WORKSPACE_ROLES = Object.freeze({
  [GENERIC_WORKSPACE]: "generic workspace",
  [AMBIGUOUS_WORKSPACE]: "one-kind ambiguous XCOM evidence",
  [CREDIBLE_WORKSPACE]: "corroborated XCOM module evidence",
});
const BASE_ACTIVITY_NAMES = Object.freeze(["Files", "Search", "Agent", "Docs", "Settings"]);
const CREDIBLE_ACTIVITY_NAMES = Object.freeze([
  "Files",
  "Search",
  "Agent",
  ACTIVITY_NAME,
  "Docs",
  "Settings",
]);
const BASE_BOTTOM_TOOL_NAMES = Object.freeze(["Terminal"]);
const FIXTURE_SHA256 = createHash("sha256").update("").digest("hex");
const FIXED_TIMESTAMP = "2026-07-16T00:00:00Z";
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;

type WorkspaceName = (typeof WORKSPACE_NAMES)[number];
type Browser = Awaited<ReturnType<typeof remote>>;
type DriverExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

interface FixtureManifestEntry {
  readonly relativePath: string;
  readonly kind: "regular-file";
  readonly size: 0;
  readonly sha256: string;
}

interface FixtureManifestWorkspace {
  readonly workspace: WorkspaceName;
  readonly role: string;
  readonly canonicalRootWithinScenarioSandbox: true;
  readonly marker: ".ide/workspace.json";
  readonly fixtures: readonly FixtureManifestEntry[];
}

export interface NativeXcom2FixtureManifest {
  readonly requirement: typeof REQUIREMENT;
  readonly sourceContentsIncluded: false;
  readonly linuxPathCase: "exact";
  readonly symlinks: "none";
  readonly registry: "IDE_HOME/workspaces.json";
  readonly initialWorkspace: typeof GENERIC_WORKSPACE;
  readonly workspaces: readonly FixtureManifestWorkspace[];
}

interface NegativeContributionObservation {
  readonly phase: string;
  readonly activityNames: readonly string[];
  readonly bottomToolNames: readonly string[];
  readonly recognitionPanelShown: false;
}

interface NativeXcom2Evidence {
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
    readonly claimsExcluded: readonly string[];
  };
  scenarioEnvironment?: Readonly<NativeScenarioEnvironmentEvidence>;
  fixtureManifestAttached?: boolean;
  fixturesVerified?: boolean;
  registryVerified?: boolean;
  applicationProcessObserved?: boolean;
  viewport?: { readonly width: number; readonly height: number };
  readyWorkspaces: string[];
  negativeContributionChecks: NegativeContributionObservation[];
  settingsSwitches: string[];
  machineSetupRemainedMachineScoped?: boolean;
  credibleActivityObservation?: {
    readonly expected: 1;
    readonly observed: number;
    readonly accessibleNames: readonly string[];
    readonly bottomToolNames: readonly string[];
  };
  activityKeyboardFocusable?: boolean;
  activityOpenedWithKeyboard?: boolean;
  recognitionFieldsMatched?: boolean;
  recognitionEvidenceMatched?: boolean;
  noScanIssue?: boolean;
  recognitionOnlyExclusionsMatched?: boolean;
  synchronousRemovalObserved?: boolean;
  lateReappearanceExcludedForMilliseconds?: number;
  responsive?: boolean;
  sandboxConfined?: boolean;
  environmentRestored?: boolean;
  ownedProcessesRemaining?: number;
  disposed?: boolean;
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native XCOM module activation Story requires absolute ${name}`);
  }
  return path.normalize(value);
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
        reject(new Error("Could not reserve a native XCOM Story TCP port"));
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
      // A process can exit between process-tree discovery and inspection.
    }
  }
  return undefined;
}

function isWorkspaceName(value: string): value is WorkspaceName {
  return (WORKSPACE_NAMES as readonly string[]).includes(value);
}

function workspaceId(name: WorkspaceName): string {
  return `story-${name}`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export class NativeXcom2ModuleActivationSession {
  readonly #runnerSandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #desiredWidth = Number(
    requiredAbsoluteOrPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH"),
  );
  readonly #desiredHeight = Number(
    requiredAbsoluteOrPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT"),
  );
  readonly #evidence: NativeXcom2Evidence = {
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
      claimsExcluded: [
        "application package",
        "Wayland",
        "other operating systems",
        "DPI behavior",
        "proprietary project compatibility",
        "content parsing",
        "external roots",
        "explicit configuration or manual confirmation",
        "machine setup correctness",
        "build capability",
        "language capability",
      ],
    },
    readyWorkspaces: [],
    negativeContributionChecks: [],
    settingsSwitches: [],
  };
  readonly #workspaceRoots = new Map<WorkspaceName, string>();
  readonly #declaredFixtures = new Map<WorkspaceName, readonly string[]>();
  #lease?: NativeScenarioEnvironmentLease;
  #manifest?: NativeXcom2FixtureManifest;
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
    assert.equal(this.#lease, undefined, "native XCOM scenario environment already allocated");
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
    assert.deepEqual(JSON.parse(await readFile(registryPath, "utf8")), registry);
    const registryMetadata = await lstat(registryPath);
    assert.equal(registryMetadata.isFile(), true);
    assert.equal(registryMetadata.isSymbolicLink(), false);
    for (const name of WORKSPACE_NAMES) {
      assert.deepEqual(
        JSON.parse(
          await readFile(path.join(this.workspaceRoot(name), ".ide/workspace.json"), "utf8"),
        ),
        {
          id: workspaceId(name),
          path: this.workspaceRoot(name),
          name,
          createdAt: FIXED_TIMESTAMP,
          updatedAt: FIXED_TIMESTAMP,
        },
      );
    }
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.workspaceRoot(GENERIC_WORKSPACE));
    this.#evidence.registryVerified = true;
  }

  async createWorkspaceFixtures(
    workspace: string,
    relativePaths: readonly string[],
  ): Promise<void> {
    assert.ok(isWorkspaceName(workspace), `unexpected workspace fixture: ${workspace}`);
    assert.deepEqual(relativePaths, WORKSPACE_FIXTURES[workspace]);
    assert.equal(
      this.#declaredFixtures.has(workspace),
      false,
      `${workspace} fixture already created`,
    );
    const root = this.workspaceRoot(workspace);
    for (const relativePath of relativePaths) {
      assert.equal(path.posix.normalize(relativePath), relativePath);
      assert.equal(path.isAbsolute(relativePath), false);
      const fixturePath = path.join(root, ...relativePath.split("/"));
      assert.ok(isContained(root, fixturePath));
      await mkdir(path.dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, "", { encoding: "utf8", flag: "wx" });
      const metadata = await lstat(fixturePath);
      assert.equal(metadata.isFile(), true);
      assert.equal(metadata.isSymbolicLink(), false);
      assert.equal(metadata.size, 0);
    }
    this.#declaredFixtures.set(workspace, Object.freeze([...relativePaths]));
    assert.deepEqual(await this.fixtureFilePaths(root), [...relativePaths].sort());
  }

  async verifyExactCaseNoSymlinks(): Promise<void> {
    assert.deepEqual([...this.#declaredFixtures.keys()], [...WORKSPACE_NAMES]);
    const canonicalScenarioRoot = await realpath(this.lease().paths.root);
    for (const name of WORKSPACE_NAMES) {
      const root = this.workspaceRoot(name);
      assert.ok(isContained(canonicalScenarioRoot, await realpath(root)));
      const pending = [root];
      while (pending.length > 0) {
        const directory = pending.pop()!;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const candidate = path.join(directory, entry.name);
          const metadata = await lstat(candidate);
          assert.equal(
            metadata.isSymbolicLink(),
            false,
            `${name}/${path.relative(root, candidate)}`,
          );
          assert.ok(isContained(root, await realpath(candidate)));
          if (metadata.isDirectory()) pending.push(candidate);
          else assert.equal(metadata.isFile(), true, `${candidate} must be a regular file`);
        }
      }
      assert.deepEqual(await this.fixtureFilePaths(root), [...WORKSPACE_FIXTURES[name]].sort());
      assert.deepEqual(
        await this.fixtureDirectoryPaths(root),
        this.expectedFixtureDirectories(WORKSPACE_FIXTURES[name]),
      );
      assert.deepEqual(await readdir(path.join(root, ".ide")), ["workspace.json"]);
      const markerMetadata = await lstat(path.join(root, ".ide/workspace.json"));
      assert.equal(markerMetadata.isFile(), true);
      assert.equal(markerMetadata.isSymbolicLink(), false);
    }

    this.#manifest = {
      requirement: REQUIREMENT,
      sourceContentsIncluded: false,
      linuxPathCase: "exact",
      symlinks: "none",
      registry: "IDE_HOME/workspaces.json",
      initialWorkspace: GENERIC_WORKSPACE,
      workspaces: WORKSPACE_NAMES.map((workspace) => ({
        workspace,
        role: WORKSPACE_ROLES[workspace],
        canonicalRootWithinScenarioSandbox: true,
        marker: ".ide/workspace.json",
        fixtures: WORKSPACE_FIXTURES[workspace].map((relativePath) => ({
          relativePath,
          kind: "regular-file",
          size: 0,
          sha256: FIXTURE_SHA256,
        })),
      })),
    };
    await writeFile(
      path.join(this.lease().paths.evidence, "xcom2-source-free-fixture-manifest.json"),
      `${JSON.stringify(this.#manifest, null, 2)}\n`,
      "utf8",
    );
    this.#evidence.fixturesVerified = true;
    this.#evidence.sandboxConfined = true;
  }

  markFixtureManifestAttached(): void {
    assert.ok(this.#manifest, "source-free fixture manifest is unavailable");
    this.#evidence.fixtureManifestAttached = true;
  }

  fixtureManifest(): Readonly<NativeXcom2FixtureManifest> {
    if (!this.#manifest) throw new Error("source-free XCOM fixture manifest is unavailable");
    return this.#manifest;
  }

  async launch(initialWorkspace: string): Promise<void> {
    assert.equal(initialWorkspace, GENERIC_WORKSPACE);
    assert.equal(this.#evidence.fixturesVerified, true, "fixtures were not verified");
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.workspaceRoot(GENERIC_WORKSPACE));
    assert.equal(this.#driver, undefined, "native XCOM session already launched");
    assert.equal(this.#desiredWidth, 1440);
    assert.equal(this.#desiredHeight, 900);
    await Promise.all([
      access(this.#tauriDriverPath, fsConstants.X_OK),
      access(this.#webKitWebDriverPath, fsConstants.X_OK),
      access(this.#applicationPath, fsConstants.X_OK),
    ]);
    const application = await stat(this.#applicationPath);
    assert.equal(application.isFile(), true);

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
        "WebdriverIO native XCOM session start",
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

  async waitForWorkspaceReady(seconds: number, expectedWorkspace: WorkspaceName): Promise<void> {
    assert.equal(seconds, 15);
    const timeout = seconds * 1_000;
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
        timeout,
        interval: 50,
        timeoutMsg: `${expectedWorkspace} did not become ready within ${seconds}s`,
      },
    );
    this.#evidence.readyWorkspaces.push(expectedWorkspace);
  }

  async assertNoXcomContributions(activityName: string, phase?: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const activityNames = await this.activityNames();
    const bottomNames = await this.bottomContributionNames();
    const recognitionPanelShown = (await this.recognitionSnapshot()).shown;
    assert.deepEqual(
      activityNames,
      BASE_ACTIVITY_NAMES,
      `${phase ?? "workspace"} exposed an unexpected activity`,
    );
    assert.deepEqual(
      bottomNames,
      BASE_BOTTOM_TOOL_NAMES,
      `${phase ?? "workspace"} exposed an unexpected bottom tool`,
    );
    assert.equal(recognitionPanelShown, false, `${phase ?? "workspace"} retained recognition UI`);
    this.#evidence.negativeContributionChecks.push({
      phase: phase ?? "workspace",
      activityNames: [...activityNames],
      bottomToolNames: [...bottomNames],
      recognitionPanelShown: false,
    });
  }

  async switchWorkspace(workspace: string): Promise<void> {
    assert.ok(isWorkspaceName(workspace));
    assert.notEqual(
      workspace,
      GENERIC_WORKSPACE,
      "use switchBackToGeneric for the final transition",
    );
    await this.openWorkspaceSettings();
    const dialog = await this.settingsDialog();
    const switchButton = await dialog.$(`[aria-label="Switch to ${workspace}"]`);
    await switchButton.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await switchButton.isEnabled(), true);
    await switchButton.click();
    this.#evidence.settingsSwitches.push(workspace);
  }

  async assertMachineSetupRemainsMachineScoped(): Promise<void> {
    const dialog = await this.settingsDialog();
    await this.clickSettingsSection("XCOM 2");
    const heading = await dialog.$("h2=XCOM 2 WOTC Setup");
    await heading.waitForDisplayed({ timeout: 10_000, interval: 50 });
    assert.equal(await heading.getComputedLabel(), "XCOM 2 WOTC Setup");
    const details = await dialog.$('[aria-label="XCOM 2 setup monitor details"]');
    assert.equal(await details.isExisting(), true);
    await this.assertNoXcomContributions(ACTIVITY_NAME, "ambiguous-machine-settings");
    this.#evidence.machineSetupRemainedMachineScoped = true;
  }

  async assertExactlyOneActivityWithin(seconds: number, activityName: string): Promise<void> {
    assert.equal(seconds, 15);
    assert.equal(activityName, ACTIVITY_NAME);
    const deadline = Date.now() + seconds * 1_000;
    let names: readonly string[] = [];
    while (Date.now() < deadline) {
      names = await this.activityNames();
      const count = names.filter((name) => name === activityName).length;
      if (count === 1) break;
      if (count > 1) break;
      await wait(50);
    }
    names = await this.activityNames();
    const bottomToolNames = await this.bottomContributionNames();
    const count = names.filter((name) => name === activityName).length;
    this.#evidence.credibleActivityObservation = {
      expected: 1,
      observed: count,
      accessibleNames: names,
      bottomToolNames,
    };
    const diagnostic = await this.publicUiDiagnostic();
    assert.equal(
      count,
      1,
      `Expected exactly one accessible activity entry named ${activityName} after credible workspace activation; observed ${count}. Public UI: ${JSON.stringify(diagnostic)}`,
    );
    assert.deepEqual(names, CREDIBLE_ACTIVITY_NAMES);
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
    const activeControlPrepared = await this.browser().execute(() => {
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
    assert.deepEqual(activeControlPrepared, { label: "Files", focused: true, tabIndex: 0 });
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
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `${activityName} was not reached through the real roving-tab keyboard model`,
      },
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
    assert.equal(expectedRows.length, 5);
    assert.equal(new Set(expectedRows.map(({ field }) => field)).size, 5);
    const expected = Object.fromEntries(expectedRows.map(({ field, value }) => [field, value]));
    assert.equal(expected.limitation, LEGACY_RECOGNITION_LIMITATION);
    expected.limitation = RECIPE_REVIEW_RECOGNITION_LIMITATION;
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.fields, expected);
    this.#evidence.recognitionFieldsMatched = true;
  }

  async assertOrderedEvidence(
    expectedRows: readonly { kind: string; "workspace-relative path": string }[],
  ): Promise<void> {
    assert.equal(expectedRows.length, 4);
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.evidenceHeaders, ["kind", "workspace-relative path"]);
    assert.deepEqual(snapshot.evidenceRows, expectedRows);
    this.#evidence.recognitionEvidenceMatched = true;
  }

  async assertNoScanIssue(): Promise<void> {
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.alerts, []);
    assert.doesNotMatch(
      snapshot.text,
      /permission[- ]denied|depth[- ]limit|entry[- ]limit|symlink[- ]rejected|scan failed/iu,
    );
    this.#evidence.noScanIssue = true;
  }

  async assertRecognitionOnlyExclusions(): Promise<void> {
    const activityNames = await this.activityNames();
    const bottomNames = await this.bottomContributionNames();
    assert.deepEqual(activityNames, CREDIBLE_ACTIVITY_NAMES);
    assert.deepEqual(bottomNames, BASE_BOTTOM_TOOL_NAMES);
    const snapshot = await this.recognitionSnapshot();
    assert.deepEqual(
      snapshot.interactiveControls,
      [BUILD_RECIPE_REVIEW_NAME],
      "recognition panel must expose only the accessible metadata-review control and no execution control",
    );
    assert.equal(snapshot.fields.limitation, RECIPE_REVIEW_RECOGNITION_LIMITATION);
    this.#evidence.recognitionOnlyExclusionsMatched = true;
  }

  async switchBackToGeneric(workspace: string): Promise<void> {
    assert.equal(workspace, GENERIC_WORKSPACE);
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
          const activityControl = (): HTMLElement | null => {
            const nav = document.querySelector('nav[aria-label="Primary activity"]');
            return (
              [...(nav?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
                (element) => element.getAttribute("aria-label") === activityName,
              ) ?? null
            );
          };
          const recognitionPanel = (): HTMLElement | null => {
            const control = activityControl();
            if (!control) return null;
            return (
              [
                ...document.querySelectorAll<HTMLElement>('[role="tabpanel"], [role="region"]'),
              ].find(
                (element) =>
                  element.getAttribute("aria-label") === activityName ||
                  (control.id !== "" && element.getAttribute("aria-labelledby") === control.id),
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
          const deadline = window.setTimeout(() => {
            observer.disconnect();
            window.clearInterval(interval);
            sample();
            done({ error: "generic workspace switch observation exceeded 15000ms", snapshots });
          }, 15_000);
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
        },
        workspace,
        ACTIVITY_NAME,
      ),
      17_000,
      "synchronous XCOM contribution removal observation",
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
    assert.equal(
      result.snapshots.some(
        (snapshot) =>
          snapshot.genericPresented && (snapshot.activityPresent || snapshot.recognitionPresent),
      ),
      false,
      `generic content was presented before XCOM contributions were removed: ${JSON.stringify(result.snapshots.slice(-20))}`,
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
    this.#evidence.synchronousRemovalObserved = true;
  }

  async assertNoGenericBottomContribution(): Promise<void> {
    const activityNames = await this.activityNames();
    const bottomNames = await this.bottomContributionNames();
    assert.deepEqual(activityNames, BASE_ACTIVITY_NAMES);
    assert.deepEqual(bottomNames, BASE_BOTTOM_TOOL_NAMES);
    assert.equal((await this.recognitionSnapshot()).shown, false);
    this.#evidence.negativeContributionChecks.push({
      phase: "generic-after-return-bottom",
      activityNames: [...activityNames],
      bottomToolNames: [...bottomNames],
      recognitionPanelShown: false,
    });
  }

  async assertNoLateReappearance(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [activityNames, bottomNames, snapshot] = await Promise.all([
        this.activityNames(),
        this.bottomContributionNames(),
        this.recognitionSnapshot(),
      ]);
      assert.equal(activityNames.includes(activityName), false);
      assert.equal(snapshot.shown, false);
      assert.equal(
        bottomNames.some((name) => /xcom/iu.test(name)),
        false,
      );
      await wait(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    const response = await bounded(
      this.browser().execute(() => ({
        readyState: document.readyState,
        visible: document.visibilityState === "visible",
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      })),
      2_000,
      "native XCOM responsiveness check",
    );
    assert.deepEqual(response, {
      readyState: "complete",
      visible: true,
      width: 1440,
      height: 900,
    });
    await this.assertFilesystemStillConfined();
    this.#evidence.lateReappearanceExcludedForMilliseconds = 5_000;
    this.#evidence.responsive = true;
  }

  evidence(): Readonly<NativeXcom2Evidence> {
    return {
      ...this.#evidence,
      readyWorkspaces: [...this.#evidence.readyWorkspaces],
      negativeContributionChecks: this.#evidence.negativeContributionChecks.map((observation) => ({
        ...observation,
        activityNames: [...observation.activityNames],
        bottomToolNames: [...observation.bottomToolNames],
      })),
      settingsSwitches: [...this.#evidence.settingsSwitches],
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  redactedDiagnostics(): string {
    let diagnostic = this.#driverDiagnostic;
    const lease = this.#lease;
    if (lease) diagnostic = diagnostic.replaceAll(lease.paths.root, "<SCENARIO>");
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
            "final public DOM responsiveness query",
          );
          if (response.readyState === "complete" && response.width > 0 && response.height > 0) {
            this.#evidence.responsive = true;
          }
        } catch {
          // The window may already be gone after a completed scenario.
        }
        try {
          await bounded(browser.deleteSession(), 2_000, "native XCOM WebDriver cleanup");
          this.#sessionDeleted = true;
        } catch {
          // Continue with owned process cleanup.
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
      const remaining = [driver?.pid, applicationProcessId].filter(
        (processId): processId is number => processId !== undefined,
      );
      let remainingCount = 0;
      for (const processId of remaining) if (await processExists(processId)) remainingCount += 1;
      this.#evidence.ownedProcessesRemaining = remainingCount;
      assert.equal(remainingCount, 0, "owned native XCOM processes survived session cleanup");
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
    if (!this.#browser) throw new Error("native XCOM WebdriverIO session is unavailable");
    return this.#browser;
  }

  private lease(): NativeScenarioEnvironmentLease {
    if (!this.#lease) throw new Error("native XCOM scenario environment is unavailable");
    return this.#lease;
  }

  private workspaceRoot(name: WorkspaceName): string {
    const root = this.#workspaceRoots.get(name);
    if (!root) throw new Error(`workspace root is unavailable: ${name}`);
    return root;
  }

  private async fixtureFilePaths(root: string): Promise<string[]> {
    const files: string[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (directory === root && entry.name === ".ide") continue;
        const candidate = path.join(directory, entry.name);
        const metadata = await lstat(candidate);
        assert.equal(metadata.isSymbolicLink(), false, `${candidate} must not be a symlink`);
        assert.ok(isContained(root, await realpath(candidate)));
        if (metadata.isDirectory()) pending.push(candidate);
        else {
          assert.equal(metadata.isFile(), true, `${candidate} must be a regular file`);
          files.push(path.relative(root, candidate).split(path.sep).join("/"));
        }
      }
    }
    return files.sort();
  }

  private async fixtureDirectoryPaths(root: string): Promise<string[]> {
    const directories: string[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (directory === root && entry.name === ".ide") continue;
        const candidate = path.join(directory, entry.name);
        const metadata = await lstat(candidate);
        assert.equal(metadata.isSymbolicLink(), false, `${candidate} must not be a symlink`);
        if (!metadata.isDirectory()) continue;
        assert.ok(isContained(root, await realpath(candidate)));
        directories.push(path.relative(root, candidate).split(path.sep).join("/"));
        pending.push(candidate);
      }
    }
    return directories.sort();
  }

  private expectedFixtureDirectories(relativePaths: readonly string[]): string[] {
    const directories = new Set<string>();
    for (const relativePath of relativePaths) {
      let directory = path.posix.dirname(relativePath);
      while (directory !== ".") {
        directories.add(directory);
        directory = path.posix.dirname(directory);
      }
    }
    return [...directories].sort();
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
      const settings = await this.findElementWithText(header, "button", "Settings");
      await settings.waitForDisplayed({ timeout: 5_000, interval: 50 });
      await settings.click();
    }
    await this.settingsDialog();
    await this.clickSettingsSection("Workspace");
  }

  private async clickSettingsSection(name: "Workspace" | "XCOM 2"): Promise<void> {
    const selected = await this.browser().execute((sectionName) => {
      const dialog = document.querySelector('[role="dialog"]');
      const tabs = [...(dialog?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
      const tab = tabs.find(
        (candidate) => candidate.querySelector("span")?.textContent?.trim() === sectionName,
      );
      if (!tab) {
        return {
          found: false,
          labels: tabs.map((candidate) =>
            [...candidate.querySelectorAll("span")]
              .map((span) => span.textContent?.trim() ?? "")
              .filter(Boolean),
          ),
        };
      }
      tab.click();
      return { found: true, labels: [] };
    }, name);
    assert.equal(
      selected.found,
      true,
      `Could not find the real Settings ${name} tab; public labels: ${JSON.stringify(selected.labels)}`,
    );
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute((sectionName) => {
          const dialog = document.querySelector('[role="dialog"]');
          return [...(dialog?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].some(
            (candidate) =>
              candidate.querySelector("span")?.textContent?.trim() === sectionName &&
              candidate.getAttribute("aria-selected") === "true",
          );
        }, name),
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

  private async findElementWithText(
    owner: Awaited<ReturnType<Browser["$"]>>,
    selector: string,
    text: string,
  ) {
    const elements = await owner.$$(selector);
    for (const element of elements) {
      const candidateText = normalizeText(await element.getText());
      if (candidateText === text || candidateText.startsWith(`${text} `)) return element;
    }
    throw new Error(`Could not find ${selector} with exact text ${text}`);
  }

  private async recognitionSnapshot(): Promise<{
    shown: boolean;
    fields: Record<string, string>;
    evidenceHeaders: string[];
    evidenceRows: Array<{ kind: string; "workspace-relative path": string }>;
    alerts: string[];
    interactiveControls: string[];
    text: string;
  }> {
    return await this.browser().execute((activityName) => {
      const normalized = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/gu, " ").trim();
      const nav = document.querySelector('nav[aria-label="Primary activity"]');
      const activity = [...(nav?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
        (element) => element.getAttribute("aria-label") === activityName,
      );
      const candidates = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="tabpanel"], [role="region"], section[aria-labelledby]',
        ),
      ];
      const panel = candidates.find(
        (element) =>
          element.getAttribute("aria-label") === activityName ||
          (activity?.id && element.getAttribute("aria-labelledby") === activity.id),
      );
      if (!panel) {
        return {
          shown: false,
          fields: {},
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
      let evidenceHeaders: string[] = [];
      let evidenceRows: Array<{ kind: string; "workspace-relative path": string }> = [];
      for (const table of panel.querySelectorAll<HTMLTableElement>("table")) {
        const headers = [...table.querySelectorAll<HTMLElement>("thead th")].map((header) =>
          normalized(header.textContent).toLowerCase(),
        );
        if (headers.join("|") !== "kind|workspace-relative path") continue;
        evidenceHeaders = headers;
        evidenceRows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((row) => {
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
        evidenceHeaders,
        evidenceRows,
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
    };
  }

  private async assertFilesystemStillConfined(): Promise<void> {
    const lease = this.lease();
    await lease.assertConfiguredPathsConfined();
    const canonicalScenarioRoot = await realpath(lease.paths.root);
    const persistedWorkspaces = [];
    for (const name of WORKSPACE_NAMES) {
      const root = this.workspaceRoot(name);
      assert.ok(isContained(canonicalScenarioRoot, await realpath(root)));
      const markerPath = path.join(root, ".ide/workspace.json");
      const markerMetadata = await lstat(markerPath);
      assert.equal(markerMetadata.isFile(), true);
      assert.equal(markerMetadata.isSymbolicLink(), false);
      const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
        id: string;
        path: string;
        name: string;
        createdAt: string;
        updatedAt: string;
      };
      assert.deepEqual(Object.keys(marker), ["id", "path", "name", "createdAt", "updatedAt"]);
      assert.deepEqual(
        { id: marker.id, path: marker.path, name: marker.name, createdAt: marker.createdAt },
        {
          id: workspaceId(name),
          path: root,
          name,
          createdAt: FIXED_TIMESTAMP,
        },
      );
      assert.doesNotThrow(() => new Date(marker.updatedAt).toISOString());
      persistedWorkspaces.push({
        id: marker.id,
        name: marker.name,
        rootPath: marker.path,
        markerFolder: ".ide",
        createdAt: marker.createdAt,
        lastOpenedAt: marker.updatedAt,
      });
      assert.deepEqual(await readdir(path.join(root, ".ide")), ["workspace.json"]);
      assert.deepEqual(await this.fixtureFilePaths(root), [...WORKSPACE_FIXTURES[name]].sort());
      assert.deepEqual(
        await this.fixtureDirectoryPaths(root),
        this.expectedFixtureDirectories(WORKSPACE_FIXTURES[name]),
      );
    }
    persistedWorkspaces.sort(
      (left, right) =>
        left.name.toLowerCase().localeCompare(right.name.toLowerCase()) ||
        left.rootPath.localeCompare(right.rootPath),
    );
    const registryPath = path.join(lease.paths.ideHome, "workspaces.json");
    const registryMetadata = await lstat(registryPath);
    assert.equal(registryMetadata.isFile(), true);
    assert.equal(registryMetadata.isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(await readFile(registryPath, "utf8")), {
      version: 1,
      workspaces: persistedWorkspaces,
      currentWorkspaceId: workspaceId(GENERIC_WORKSPACE),
    });
    this.#evidence.registryVerified = true;
    this.#evidence.sandboxConfined = true;
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

function requiredAbsoluteOrPositiveInteger(name: string): string {
  const value = process.env[name];
  if (!value || !Number.isInteger(Number(value)) || Number(value) <= 0) {
    throw new Error(`Native XCOM module activation Story requires positive integer ${name}`);
  }
  return value;
}
