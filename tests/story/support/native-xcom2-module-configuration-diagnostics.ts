import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { remote } from "webdriverio";

import {
  NativeScenarioEnvironmentLease,
  type NativeScenarioEnvironmentEvidence,
} from "./native-scenario-environment.js";

const REQUIREMENT = "REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001" as const;
const WORKSPACE = "diagnostic-wotc" as const;
const WORKSPACE_ID = "story-diagnostic-wotc" as const;
const FIXED_TIMESTAMP = "2026-07-17T00:00:00Z" as const;
const CONFIGURATION_PATH = ".ide/xcom2.json" as const;
const MODULE_ROOT = "mods/IntentOnly" as const;
const ACTIVITY_NAME = "XCOM 2 Project" as const;
const BUILD_RECIPE_REVIEW_NAME = "Default Build recipe" as const;
const LEGACY_RECOGNITION_LIMITATION =
  "Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution." as const;
const RECIPE_REVIEW_RECOGNITION_LIMITATION =
  "Recognition remains read-only: recipe review provides no Build, Run, Deploy, Cook, Launch, Problems, Logs, language support, or bottom contribution." as const;
const WARNING_TITLE = "XCOM 2 project configuration needs attention" as const;
const CHECKING_TEXT = "Checking XCOM 2 project configuration…" as const;
const SECRET_CANARY = "SCENARIO-OWNER-SECRET-CANARY-7d8ab3d6" as const;
const PUBLIC_CANARY = "CONFIG-SOURCE-MUST-NOT-APPEAR" as const;
const MALFORMED_CONFIGURATION =
  '{"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"],"note":"CONFIG-SOURCE-MUST-NOT-APPEAR"' as const;
const VALID_CONFIGURATION =
  '{"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"]}' as const;
const UNSUPPORTED_CONFIGURATION =
  '{"version":1,"target":"xcom2","moduleRoots":["mods/IntentOnly"]}' as const;
const DESCRIPTORS = [
  "mods/IntentOnly/IntentOnly.x2proj",
  "mods/IntentOnly/IntentOnly.XComMod",
] as const;
const PROJECT_INPUT_PATHS = [CONFIGURATION_PATH, ...DESCRIPTORS] as const;
const WORKSPACE_METADATA_PATH = ".ide/workspace.json" as const;
const BASE_ACTIVITY_NAMES = Object.freeze(["Explorer", "Search", "Docs", "Settings"]);
const ACTIVE_ACTIVITY_NAMES = Object.freeze([
  "Explorer",
  "Search",
  ACTIVITY_NAME,
  "Docs",
  "Settings",
]);
const BASE_BOTTOM_TOOL_NAMES = Object.freeze(["Terminal", "AI Agent"]);
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;

const INVALID_WARNING_FIELDS = Object.freeze({
  "project file label": CONFIGURATION_PATH,
  summary: "The XCOM 2 project configuration is not valid JSON.",
  remediation:
    "Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.",
  "support identifier": "configuration-invalid-json",
});
const UNSUPPORTED_WARNING_FIELDS = Object.freeze({
  "project file label": CONFIGURATION_PATH,
  summary: "This XCOM 2 project target is not supported.",
  remediation: 'Set target to "wotc", then refresh the workspace.',
  "support identifier": "configuration-unsupported-target",
});

type Browser = Awaited<ReturnType<typeof remote>>;
type DriverExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type WarningFields = Record<string, string>;
type TreeEntry = {
  readonly relativePath: string;
  readonly kind: "directory" | "regular-file";
  readonly mode: number;
  readonly size?: number;
  readonly sha256?: string;
};
type FileFingerprint = {
  readonly device: string;
  readonly inode: string;
  readonly mode: number;
  readonly size: string;
  readonly modifiedNanoseconds: string;
  readonly sha256: string;
};
type ProjectInputPath = (typeof PROJECT_INPUT_PATHS)[number];
type ProjectInputSnapshotEntry = {
  readonly relativePath: ProjectInputPath;
  readonly fingerprint: FileFingerprint | null;
};
type OwnerMutation = {
  readonly operation: "external-create" | "external-replace-unsupported" | "external-replace-valid";
  readonly relativePath: ProjectInputPath;
};
type WarningSnapshot = {
  readonly count: number;
  readonly role: string;
  readonly title: string;
  readonly fields: WarningFields;
  readonly controls: string[];
  readonly nestedAlerts: number;
  readonly text: string;
};
type RecognitionSnapshot = {
  readonly shown: boolean;
  readonly fields: Record<string, string>;
  readonly tableHeaders: string[];
  readonly tableRows: Array<{ kind: string; "workspace-relative path": string }>;
  readonly warnings: WarningSnapshot[];
  readonly controls: string[];
  readonly text: string;
};
type UiSnapshot = {
  readonly activityNames: string[];
  readonly bottomNames: string[];
  readonly recognition: RecognitionSnapshot;
  readonly workspaceWarning: WarningSnapshot;
  readonly checking: boolean;
};
type RefreshSnapshot = {
  readonly elapsed: number;
  readonly completed: boolean;
  readonly checking: boolean;
  readonly warningCount: number;
  readonly warningTitle: string;
  readonly warningSupportIdentifier: string;
  readonly activityCount: number;
  readonly configuredDecision: boolean;
  readonly explicitReason: boolean;
};

export interface NativeXcom2ConfigurationDiagnosticsFixtureManifest {
  readonly requirement: typeof REQUIREMENT;
  readonly sourceContentsIncluded: false;
  readonly secretCanaryIncluded: false;
  readonly absolutePathsIncluded: false;
  readonly workspace: typeof WORKSPACE;
  readonly linuxPathCase: "exact";
  readonly symlinks: "none";
  readonly secretCanaryLocation: "isolated-user-state";
  readonly configuration: {
    readonly relativePath: typeof CONFIGURATION_PATH;
    readonly kind: "regular-file";
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly moduleRoot: {
    readonly relativePath: typeof MODULE_ROOT;
    readonly kind: "empty-regular-directory";
  };
}

interface BoundedLeaseEvidence {
  readonly workspaceDistinctFromRunner: true;
  readonly workspaceUniqueAmongRecordedScenarios: true;
  readonly previouslyRecordedScenarioWorkspaces: number;
  readonly environmentRestored: boolean;
  readonly scenarioChildRemoved: boolean;
}

interface NativeXcom2ConfigurationDiagnosticsEvidence {
  readonly requirement: typeof REQUIREMENT;
  readonly sourceContentsIncluded: false;
  readonly secretCanaryIncluded: false;
  readonly absolutePathsIncluded: false;
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
  scenarioEnvironment?: BoundedLeaseEvidence;
  fixtureManifestAttached?: boolean;
  fixtureVerified?: boolean;
  secretCanaryConfined?: boolean;
  viewport?: { readonly width: number; readonly height: number };
  applicationProcessObserved?: boolean;
  workspaceReady?: boolean;
  initialNegativeContributionObserved?: boolean;
  settingsWorkspaceOpened?: boolean;
  invalidWarningMatched?: boolean;
  warningNonColorSemanticsMatched?: boolean;
  prohibitedDisclosureScanMatched?: boolean;
  noWatchRetentionMilliseconds: number[];
  readonly projectInputPaths: readonly ProjectInputPath[];
  ownerMutations: OwnerMutation[];
  applicationOwnedWorkspaceMetadata?: {
    readonly relativePath: typeof WORKSPACE_METADATA_PATH;
    readonly changedDuringLaunch: boolean;
    readonly excludedFromProjectInputMutationClaim: true;
  };
  refreshesInvoked: number;
  firstRefreshTransitionMatched?: boolean;
  configuredActivityMatched?: boolean;
  configuredPanelMatched?: boolean;
  configuredReasonMatched?: boolean;
  configuredRecognitionOnlyExclusionsMatched?: boolean;
  secondRefreshTransitionMatched?: boolean;
  unsupportedWarningMatched?: boolean;
  recognizedActivityMatched?: boolean;
  recognizedPanelMatched?: boolean;
  recognizedEvidenceMatched?: boolean;
  mirroredWarningMatched?: boolean;
  configuredAuthorityRevoked?: boolean;
  recognizedRecognitionOnlyExclusionsMatched?: boolean;
  staleStabilityMilliseconds?: number;
  exactProjectInputFingerprintsMatched?: boolean;
  ownerOnlyMutationAccountingMatched?: boolean;
  applicationProjectWritesExcluded?: boolean;
  responsive?: boolean;
  environmentRestored?: boolean;
  ownedProcessesRemaining?: number;
  disposed?: boolean;
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native XCOM configuration diagnostics Story requires absolute ${name}`);
  }
  return path.normalize(value);
}

function requiredPositiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Native XCOM configuration diagnostics Story requires positive integer ${name}`,
    );
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

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
        reject(new Error("Could not reserve an XCOM configuration diagnostics TCP port"));
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
      // A child may exit between discovery and inspection.
    }
  }
  return undefined;
}

function boundedLeaseEvidence(
  evidence: Readonly<NativeScenarioEnvironmentEvidence>,
): BoundedLeaseEvidence {
  return {
    workspaceDistinctFromRunner: evidence.workspaceDistinctFromRunner,
    workspaceUniqueAmongRecordedScenarios: evidence.workspaceUniqueAmongRecordedScenarios,
    previouslyRecordedScenarioWorkspaces: evidence.previouslyRecordedScenarioWorkspaces,
    environmentRestored: evidence.environmentRestored,
    scenarioChildRemoved: evidence.scenarioChildRemoved,
  };
}

/**
 * Story-owned native driver for the safe configuration diagnostic flow. It uses
 * only the public WebKit DOM and scenario-owned filesystem; no production test
 * hook, fake backend, native transcript, or configuration source is attached.
 */
export class NativeXcom2ModuleConfigurationDiagnosticsSession {
  readonly #runnerSandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #desiredWidth = requiredPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH");
  readonly #desiredHeight = requiredPositiveInteger("IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT");
  readonly #evidence: NativeXcom2ConfigurationDiagnosticsEvidence = {
    requirement: REQUIREMENT,
    sourceContentsIncluded: false,
    secretCanaryIncluded: false,
    absolutePathsIncluded: false,
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
        "Git synchronization",
        "configuration or evidence watcher",
        "Wayland",
        "other operating systems",
        "other DPI behavior",
        "proprietary content",
        "module-content parsing",
        "external roots",
        "machine correctness",
        "process execution",
        "contextual XCOM tools",
      ],
    },
    noWatchRetentionMilliseconds: [],
    projectInputPaths: PROJECT_INPUT_PATHS,
    ownerMutations: [],
    refreshesInvoked: 0,
  };
  #lease?: NativeScenarioEnvironmentLease;
  #manifest?: NativeXcom2ConfigurationDiagnosticsFixtureManifest;
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Browser;
  #applicationProcessId?: number;
  #sessionDeleted = false;
  #disposed = false;
  #malformedFingerprint?: FileFingerprint;
  #validFingerprint?: FileFingerprint;
  #unsupportedFingerprint?: FileFingerprint;
  readonly #descriptorFingerprints = new Map<(typeof DESCRIPTORS)[number], FileFingerprint>();
  #preLaunchWorkspaceMarkerFingerprint?: FileFingerprint;
  #lastVerifiedProjectInputs?: ProjectInputSnapshotEntry[];
  #invalidWarning?: WarningSnapshot;
  #unsupportedWarning?: WarningSnapshot;
  #configuredRecognition?: RecognitionSnapshot;
  #recognizedRecognition?: RecognitionSnapshot;
  #expectedRecognitionFields?: Record<string, string>;
  #expectedActivationReasons?: Array<{ kind: string; "workspace-relative path": string }>;
  #expectedEvidenceRows?: Array<{ kind: string; "workspace-relative path": string }>;
  #refreshSnapshots?: RefreshSnapshot[];
  #prohibitedDisclosureLabels?: readonly string[];
  #retentionPhase: "invalid" | "configured" | undefined;

  async allocateScenario(workspaceName: string): Promise<void> {
    assert.equal(workspaceName, WORKSPACE);
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(process.env.GDK_BACKEND, "x11");
    assert.equal(process.env.WAYLAND_DISPLAY, undefined);
    assert.equal(this.#lease, undefined, "diagnostic XCOM scenario already allocated");

    const lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT, {
      workspaceName: WORKSPACE,
    });
    this.#lease = lease;
    assert.equal(lease.runnerSandbox, this.#runnerSandbox);
    await lease.assertConfiguredPathsConfined();
    const workspace = await realpath(lease.paths.workspace);
    assert.ok(isContained(await realpath(lease.paths.root), workspace));
    assert.equal(path.basename(workspace), WORKSPACE);

    await mkdir(path.join(workspace, ".ide"), { recursive: true });
    const marker = {
      id: WORKSPACE_ID,
      path: workspace,
      name: WORKSPACE,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    };
    await writeFile(
      path.join(workspace, ".ide/workspace.json"),
      `${JSON.stringify(marker, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    const registry = {
      version: 1,
      workspaces: [
        {
          id: WORKSPACE_ID,
          name: WORKSPACE,
          rootPath: workspace,
          markerFolder: ".ide",
          createdAt: FIXED_TIMESTAMP,
          lastOpenedAt: FIXED_TIMESTAMP,
        },
      ],
      currentWorkspaceId: WORKSPACE_ID,
    };
    await writeFile(
      path.join(lease.paths.ideHome, "workspaces.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    assert.equal(process.env.IDE_WORKSPACE_ROOT, workspace);
  }

  async createSecretCanaryInIsolatedUserState(): Promise<void> {
    const lease = this.lease();
    const secretPath = path.join(lease.paths.xdgState, "story-owner-secret-canary.txt");
    assert.ok(isContained(lease.paths.root, secretPath));
    assert.equal(isContained(lease.paths.workspace, secretPath), false);
    await writeFile(secretPath, SECRET_CANARY, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(secretPath, 0o600);
    const metadata = await lstat(secretPath);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(await readFile(secretPath, "utf8"), SECRET_CANARY);
    assert.equal(await this.workspaceContainsBytes(Buffer.from(SECRET_CANARY)), false);
    this.#evidence.secretCanaryConfined = true;
  }

  async assertWorkspaceContainsNoConventionEvidence(): Promise<void> {
    assert.equal(this.#evidence.secretCanaryConfined, true);
    assert.deepEqual(
      (await this.workspaceTree()).map(({ relativePath, kind }) => ({ relativePath, kind })),
      [
        { relativePath: ".ide", kind: "directory" },
        { relativePath: ".ide/workspace.json", kind: "regular-file" },
      ],
    );
    await assert.rejects(lstat(this.configurationPath()), { code: "ENOENT" });
    await this.assertNoConventionEvidenceInTree();
  }

  async createEmptyModuleRoot(relativePath: string): Promise<void> {
    assert.equal(relativePath, MODULE_ROOT);
    const root = this.workspaceRoot();
    const moduleRoot = path.join(root, ...relativePath.split("/"));
    assert.ok(isContained(root, moduleRoot));
    await mkdir(moduleRoot, { recursive: true });
    const metadata = await lstat(moduleRoot);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.deepEqual(await readdir(moduleRoot), []);
  }

  async createMalformedConfiguration(
    relativePath: string,
    encodingBits: number,
    contents: string,
  ): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    assert.equal(encodingBits, 8);
    assert.equal(contents, MALFORMED_CONFIGURATION);
    const bytes = Buffer.from(contents, "utf8");
    assert.equal(bytes.toString("utf8"), MALFORMED_CONFIGURATION);
    await writeFile(this.configurationPath(), bytes, { flag: "wx" });
    this.#malformedFingerprint = await this.fileFingerprint(
      this.configurationPath(),
      bytes.byteLength,
      sha256(bytes),
    );
  }

  async assertProjectPathsConfined(): Promise<void> {
    const root = this.workspaceRoot();
    const canonicalRoot = await realpath(root);
    for (const relativePath of [
      ".ide",
      ".ide/workspace.json",
      CONFIGURATION_PATH,
      "mods",
      MODULE_ROOT,
    ]) {
      const candidate = path.join(root, ...relativePath.split("/"));
      const metadata = await lstat(candidate);
      assert.equal(metadata.isSymbolicLink(), false);
      assert.ok(isContained(canonicalRoot, await realpath(candidate)));
      assert.equal(path.relative(root, candidate).split(path.sep).join("/"), relativePath);
    }
    assert.deepEqual(await readdir(path.join(root, MODULE_ROOT)), []);
    await this.assertNoConventionEvidenceInTree();
    await this.assertFingerprint(this.#malformedFingerprint, Buffer.from(MALFORMED_CONFIGURATION));
    assert.equal(await this.workspaceContainsBytes(Buffer.from(SECRET_CANARY)), false);

    const bytes = Buffer.from(MALFORMED_CONFIGURATION);
    this.#manifest = {
      requirement: REQUIREMENT,
      sourceContentsIncluded: false,
      secretCanaryIncluded: false,
      absolutePathsIncluded: false,
      workspace: WORKSPACE,
      linuxPathCase: "exact",
      symlinks: "none",
      secretCanaryLocation: "isolated-user-state",
      configuration: {
        relativePath: CONFIGURATION_PATH,
        kind: "regular-file",
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      },
      moduleRoot: { relativePath: MODULE_ROOT, kind: "empty-regular-directory" },
    };
    await writeFile(
      path.join(this.lease().paths.evidence, "xcom2-configuration-diagnostics-fixture.json"),
      `${JSON.stringify(this.#manifest, null, 2)}\n`,
      "utf8",
    );
    this.#evidence.fixtureVerified = true;
  }

  fixtureManifest(): Readonly<NativeXcom2ConfigurationDiagnosticsFixtureManifest> {
    if (!this.#manifest) throw new Error("diagnostic fixture manifest is unavailable");
    return this.#manifest;
  }

  markFixtureManifestAttached(): void {
    assert.ok(this.#manifest);
    this.#evidence.fixtureManifestAttached = true;
  }

  async launch(initialWorkspace: string): Promise<void> {
    assert.equal(initialWorkspace, WORKSPACE);
    assert.equal(this.#evidence.fixtureVerified, true);
    assert.equal(this.#desiredWidth, 1440);
    assert.equal(this.#desiredHeight, 900);
    assert.equal(this.#driver, undefined, "diagnostic XCOM session already launched");
    await this.assertFingerprint(this.#malformedFingerprint, Buffer.from(MALFORMED_CONFIGURATION));
    this.#lastVerifiedProjectInputs = await this.projectInputSnapshot();
    this.#preLaunchWorkspaceMarkerFingerprint = await this.observedFileFingerprint(
      this.workspacePath(WORKSPACE_METADATA_PATH),
    );
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
        "WebdriverIO XCOM configuration diagnostics session start",
      );
      this.#applicationProcessId = await this.waitForApplicationProcess();
      this.#evidence.applicationProcessObserved = true;
      await this.browser().setWindowSize(this.#desiredWidth, this.#desiredHeight);
      await this.assertProjectInputsUnchanged();
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  async assertViewport(): Promise<void> {
    await this.browser().waitUntil(
      async () => {
        const viewport = await this.browser().execute(() => ({
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        }));
        return viewport.width === 1440 && viewport.height === 900;
      },
      { timeout: 5_000, interval: 50, timeoutMsg: "WebKit DOM viewport is not exactly 1440x900" },
    );
    const viewport = await this.browser().execute(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
    assert.deepEqual(viewport, { width: 1440, height: 900 });
    this.#evidence.viewport = viewport;
  }

  async waitForWorkspaceReady(seconds: number, expectedWorkspace = WORKSPACE): Promise<void> {
    assert.equal(seconds, 15);
    assert.equal(expectedWorkspace, WORKSPACE);
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute((workspaceName) => {
          const header = document.querySelector("#root > div > header");
          const explorer = document.querySelector('[role="tree"][aria-label="File Explorer"]');
          const workspaceExplorer = document.querySelector(".workspace-explorer");
          return (
            (header?.textContent ?? "").includes(`Workspace: ${workspaceName}`) &&
            explorer !== null &&
            (workspaceExplorer === null || workspaceExplorer.getAttribute("aria-busy") !== "true")
          );
        }, expectedWorkspace),
      {
        timeout: seconds * 1_000,
        interval: 50,
        timeoutMsg: `${expectedWorkspace} did not become ready within ${seconds}s`,
      },
    );
    await this.assertFingerprint(this.#malformedFingerprint, Buffer.from(MALFORMED_CONFIGURATION));
    await this.assertProjectInputsUnchanged();
    const readyMarkerFingerprint = await this.waitForWorkspaceMarkerToSettle();
    assert.ok(
      this.#preLaunchWorkspaceMarkerFingerprint,
      "pre-launch workspace marker fingerprint is unavailable",
    );
    this.#evidence.applicationOwnedWorkspaceMetadata = {
      relativePath: WORKSPACE_METADATA_PATH,
      changedDuringLaunch: !isDeepStrictEqual(
        readyMarkerFingerprint,
        this.#preLaunchWorkspaceMarkerFingerprint,
      ),
      excludedFromProjectInputMutationClaim: true,
    };
    this.#evidence.workspaceReady = true;
  }

  async assertNoConfiguredContributions(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const snapshot = await this.uiSnapshot();
    assert.deepEqual(snapshot.activityNames, BASE_ACTIVITY_NAMES);
    assert.deepEqual(snapshot.bottomNames, BASE_BOTTOM_TOOL_NAMES);
    assert.equal(snapshot.recognition.shown, false);
    await this.assertProjectInputsUnchanged();
    this.#evidence.initialNegativeContributionObserved = true;
  }

  async openWorkspaceSettings(sectionName: string): Promise<void> {
    assert.equal(sectionName, "Workspace");
    await this.openWorkspaceSettingsInternal();
    this.#evidence.settingsWorkspaceOpened = true;
  }

  async assertCurrentWorkspaceWarning(
    currentWorkspaceLabel: string,
    role: string,
    title: string,
    timeoutSeconds = 0,
  ): Promise<void> {
    assert.equal(currentWorkspaceLabel, "Current workspace");
    assert.equal(role, "alert");
    assert.equal(title, WARNING_TITLE);
    const deadline = Date.now() + timeoutSeconds * 1_000;
    let snapshot = await this.workspaceWarningSnapshot();
    while (
      timeoutSeconds > 0 &&
      (snapshot.count !== 1 || snapshot.title !== title) &&
      Date.now() < deadline
    ) {
      await wait(50);
      snapshot = await this.workspaceWarningSnapshot();
    }
    assert.equal(
      snapshot.count,
      1,
      `MISSING_UI_CAPABILITY: Settings > Workspace > Current workspace has no atomic XCOM configuration warning; observed ${JSON.stringify(snapshot)}`,
    );
    assert.equal(snapshot.role, role);
    assert.equal(snapshot.title, title);
    assert.equal(snapshot.nestedAlerts, 0);
    this.#unsupportedWarning =
      this.#evidence.refreshesInvoked >= 2 ? snapshot : this.#unsupportedWarning;
  }

  async assertWarningFields(
    expectedRows: readonly { field: string; value: string }[],
  ): Promise<void> {
    assert.equal(expectedRows.length, 4);
    const expected = Object.fromEntries(expectedRows.map(({ field, value }) => [field, value]));
    const expectedKnown =
      this.#evidence.refreshesInvoked >= 2 ? UNSUPPORTED_WARNING_FIELDS : INVALID_WARNING_FIELDS;
    assert.deepEqual(expected, expectedKnown);
    const snapshot = await this.workspaceWarningSnapshot();
    assert.deepEqual(snapshot.fields, expected);
    if (this.#evidence.refreshesInvoked >= 2) {
      this.#unsupportedWarning = snapshot;
      this.#evidence.unsupportedWarningMatched = true;
    } else {
      this.#invalidWarning = snapshot;
      this.#evidence.invalidWarningMatched = true;
    }
  }

  async assertWarningNonColorAndReadOnly(): Promise<void> {
    const snapshot = await this.workspaceWarningSnapshot();
    assert.equal(snapshot.count, 1);
    assert.equal(snapshot.role, "alert");
    assert.equal(snapshot.title, WARNING_TITLE);
    assert.deepEqual(snapshot.fields, INVALID_WARNING_FIELDS);
    assert.deepEqual(snapshot.controls, []);
    assert.equal(snapshot.text.includes(WARNING_TITLE), true);
    for (const value of Object.values(INVALID_WARNING_FIELDS)) {
      assert.equal(snapshot.text.includes(value), true);
    }
    this.#evidence.warningNonColorSemanticsMatched = true;
  }

  async assertNoProhibitedWarningDisclosures(labels: readonly string[]): Promise<void> {
    assert.deepEqual(labels, [
      PUBLIC_CANARY,
      "the actual absolute scenario sandbox root",
      "configuration bytes or submitted module roots",
      "parser, provider, or native-command details",
      "the scenario-owner secret canary or raw causes",
    ]);
    this.#prohibitedDisclosureLabels = [...labels];
    await this.assertScopedWarningDisclosures("settings");
    this.#evidence.prohibitedDisclosureScanMatched = true;
  }

  async replaceConfigurationExternally(
    relativePath: string,
    encodingBits: number,
    contents: string,
    kind: "valid" | "unsupported",
  ): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    assert.equal(encodingBits, 8);
    const expectedContents = kind === "valid" ? VALID_CONFIGURATION : UNSUPPORTED_CONFIGURATION;
    assert.equal(contents, expectedContents);
    if (kind === "valid") {
      await this.assertFingerprint(
        this.#malformedFingerprint,
        Buffer.from(MALFORMED_CONFIGURATION),
      );
      assert.deepEqual(await this.workspaceWarningSnapshot(), this.#invalidWarning);
    } else {
      await this.assertFingerprint(this.#validFingerprint, Buffer.from(VALID_CONFIGURATION));
      assert.deepEqual(await this.recognitionSnapshot(), this.#configuredRecognition);
    }
    await this.assertProjectInputsUnchanged();
    const before = this.#lastVerifiedProjectInputs!;
    const bytes = Buffer.from(contents, "utf8");
    const temporaryPath = path.join(
      this.lease().paths.temporary,
      `owner-configuration-${kind}-${process.pid}.json`,
    );
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    assert.equal((await lstat(temporaryPath)).isFile(), true);
    assert.equal((await lstat(temporaryPath)).dev, (await lstat(this.workspaceRoot())).dev);
    await rename(temporaryPath, this.configurationPath());
    const fingerprint = await this.fileFingerprint(
      this.configurationPath(),
      bytes.byteLength,
      sha256(bytes),
    );
    if (kind === "valid") this.#validFingerprint = fingerprint;
    else this.#unsupportedFingerprint = fingerprint;
    const after = await this.projectInputSnapshot();
    this.assertOnlyExpectedProjectInputChanges(before, after, [CONFIGURATION_PATH]);
    this.#lastVerifiedProjectInputs = after;
    this.#evidence.ownerMutations.push({
      operation: kind === "valid" ? "external-replace-valid" : "external-replace-unsupported",
      relativePath: CONFIGURATION_PATH,
    });
  }

  async assertInvalidWarningRetainedForOneSecond(): Promise<void> {
    const expected = this.#invalidWarning;
    assert.ok(expected, "the exact invalid-JSON warning was not captured");
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      assert.deepEqual(await this.workspaceWarningSnapshot(), expected);
      await this.assertFingerprint(this.#validFingerprint, Buffer.from(VALID_CONFIGURATION));
      await this.assertProjectInputsUnchanged();
      const ui = await this.uiSnapshot();
      assert.deepEqual(ui.activityNames, BASE_ACTIVITY_NAMES);
      assert.deepEqual(ui.bottomNames, BASE_BOTTOM_TOOL_NAMES);
      assert.equal(ui.recognition.shown, false);
      await wait(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    this.#retentionPhase = "invalid";
    this.#evidence.noWatchRetentionMilliseconds.push(1_000);
  }

  assertNoConfigurationWatchOrPollRefresh(): void {
    assert.equal(this.#retentionPhase, "invalid");
    assert.equal(this.#evidence.noWatchRetentionMilliseconds.at(-1), 1_000);
  }

  async invokeWorkspaceRefresh(controlName: string): Promise<void> {
    assert.equal(controlName, "Workspace Refresh");
    await this.openWorkspaceSettingsInternal();
    const result = (await bounded(
      this.browser().executeAsync(
        (activityName, warningTitle, checkingText, done) => {
          const normalize = (value: string | null | undefined): string =>
            (value ?? "").replace(/\s+/gu, " ").trim();
          const snapshots: RefreshSnapshot[] = [];
          const started = performance.now();
          const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
          const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
            (candidate) => normalize(candidate.textContent) === "Refresh workspace",
          );
          if (!button) {
            done({ error: "actual Refresh workspace Settings control is missing", snapshots });
            return;
          }
          const currentSection = [...(dialog?.querySelectorAll<HTMLElement>("section") ?? [])].find(
            (candidate) =>
              [...candidate.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].some(
                (heading) => normalize(heading.textContent) === "Current workspace",
              ),
          );
          let sawPending = false;
          let sawCompletionCleared = false;
          const sample = (): void => {
            sawPending ||= button.disabled;
            const warnings = [
              ...(currentSection?.querySelectorAll<HTMLElement>('[role="alert"]') ?? []),
            ];
            const warning = warnings.find((candidate) =>
              normalize(candidate.textContent).includes(warningTitle),
            );
            const support = warning
              ? [...warning.querySelectorAll<HTMLElement>("dt")].find((term) =>
                  /support identifier/iu.test(normalize(term.textContent)),
                )?.nextElementSibling
              : null;
            const activity = [
              ...document.querySelectorAll<HTMLElement>(
                'nav[aria-label="Primary activity"] [role="tab"]',
              ),
            ].filter((candidate) => candidate.getAttribute("aria-label") === activityName);
            const panel = [
              ...document.querySelectorAll<HTMLElement>(
                '[role="tabpanel"], [role="region"], section[aria-labelledby]',
              ),
            ].find(
              (candidate) =>
                candidate.getAttribute("aria-label") === activityName ||
                (activity[0]?.id && candidate.getAttribute("aria-labelledby") === activity[0].id),
            );
            const configuredDecision = [...(panel?.querySelectorAll<HTMLElement>("dt") ?? [])].some(
              (term) =>
                normalize(term.textContent).toLowerCase() === "source" &&
                normalize(term.nextElementSibling?.textContent).toLowerCase() === "configured",
            );
            const explicitReason = [
              ...(panel?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []),
            ].some(
              (row) =>
                normalize(row.querySelector<HTMLElement>("th,td")?.textContent) ===
                "explicit-configuration",
            );
            const completionCopyPresent = [
              ...(dialog?.querySelectorAll<HTMLElement>('[role="status"]') ?? []),
            ].some((candidate) => normalize(candidate.textContent) === "Workspace refreshed.");
            sawCompletionCleared ||= !completionCopyPresent;
            const completed = sawPending && sawCompletionCleared && completionCopyPresent;
            snapshots.push({
              elapsed: Math.round(performance.now() - started),
              completed,
              checking: normalize(currentSection?.textContent).includes(checkingText),
              warningCount: warnings.length,
              warningTitle: normalize(warning?.textContent).includes(warningTitle)
                ? warningTitle
                : "",
              warningSupportIdentifier: normalize(support?.textContent),
              activityCount: activity.length,
              configuredDecision,
              explicitReason,
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
            if (sawPending && snapshots.at(-1)?.completed && !button.disabled) {
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
            done({
              error: "Workspace Refresh did not report completion within 15000ms",
              snapshots,
            });
          }, 15_000);
        },
        ACTIVITY_NAME,
        WARNING_TITLE,
        CHECKING_TEXT,
      ),
      17_000,
      "actual diagnostic Workspace Refresh observation",
    )) as { readonly error?: string; readonly snapshots: RefreshSnapshot[] };
    assert.equal(result.error, undefined, result.error);
    assert.ok(result.snapshots.length > 1);
    this.#refreshSnapshots = result.snapshots;
    this.#evidence.refreshesInvoked += 1;
    await this.assertProjectInputsUnchanged();
  }

  assertFirstRefreshTransition(checkingText: string): void {
    assert.equal(checkingText, CHECKING_TEXT);
    assert.equal(this.#evidence.refreshesInvoked, 1);
    const snapshots = this.requireRefreshSnapshots();
    const first = snapshots[0]!;
    assert.equal(first.warningCount, 1);
    assert.equal(first.warningTitle, WARNING_TITLE);
    assert.equal(first.warningSupportIdentifier, INVALID_WARNING_FIELDS["support identifier"]);
    assert.equal(
      snapshots.some(
        (snapshot) => !snapshot.completed && snapshot.warningCount === 0 && snapshot.checking,
      ),
      true,
      `invalid warning was not synchronously replaced by the neutral checking state: ${JSON.stringify(snapshots.slice(-30))}`,
    );
    assert.equal(
      snapshots.some((snapshot) => snapshot.completed && snapshot.checking),
      false,
    );
    this.#evidence.firstRefreshTransitionMatched = true;
  }

  async assertCheckingClearedWithoutWarnings(seconds: number): Promise<void> {
    assert.equal(seconds, 15);
    await this.browser().waitUntil(
      async () => {
        const snapshot = await this.uiSnapshot();
        return !snapshot.checking && snapshot.workspaceWarning.count === 0;
      },
      {
        timeout: seconds * 1_000,
        interval: 50,
        timeoutMsg: "checking state or warning did not clear",
      },
    );
    const snapshot = await this.uiSnapshot();
    assert.equal(snapshot.checking, false);
    assert.equal(snapshot.workspaceWarning.count, 0);
    assert.equal(snapshot.recognition.warnings.length, 0);
    await this.assertFingerprint(this.#validFingerprint, Buffer.from(VALID_CONFIGURATION));
    await this.assertProjectInputsUnchanged();
  }

  async assertExactlyOneActivityWithin(seconds: number, activityName: string): Promise<void> {
    assert.equal(seconds, 15);
    assert.equal(activityName, ACTIVITY_NAME);
    await this.browser().waitUntil(
      async () => (await this.activityNames()).filter((name) => name === activityName).length === 1,
      { timeout: seconds * 1_000, interval: 50, timeoutMsg: `${activityName} did not appear` },
    );
    const names = await this.activityNames();
    assert.deepEqual(names, ACTIVE_ACTIVITY_NAMES);
    const controls = await this.activityControlsNamed(activityName);
    assert.equal(controls.length, 1);
    assert.equal(await controls[0]!.getTagName(), "button");
    assert.equal(await controls[0]!.getComputedLabel(), activityName);
    assert.equal(await controls[0]!.getAttribute("disabled"), null);
    await this.closeSettingsIfOpen();
    this.#evidence.configuredActivityMatched = this.#evidence.refreshesInvoked === 1;
  }

  async assertActivityKeyboardFocusable(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const controls = await this.activityControlsNamed(activityName);
    assert.equal(controls.length, 1);
    const control = controls[0]!;
    assert.equal(await control.getTagName(), "button");
    assert.equal(await control.getAttribute("type"), "button");
    assert.equal(await control.getComputedLabel(), activityName);
    const prepared = await this.browser().execute(() => {
      const active = document.querySelector<HTMLElement>(
        'nav[aria-label="Primary activity"] [role="tab"][aria-selected="true"]',
      );
      active?.focus();
      return {
        label: active?.getAttribute("aria-label") ?? "",
        focused: document.activeElement === active,
      };
    });
    assert.equal(prepared.label.length > 0, true);
    assert.equal(prepared.focused, true);
    await this.browser().keys(["End"]);
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute((name) => {
          const active = document.activeElement as HTMLElement | null;
          return (
            active?.getAttribute("role") === "tab" &&
            active.getAttribute("aria-label") === name &&
            active.getAttribute("aria-selected") === "true" &&
            active.tabIndex === 0
          );
        }, activityName),
      { timeout: 5_000, interval: 50, timeoutMsg: `${activityName} is not keyboard-focusable` },
    );
  }

  async openActivityWithKeyboard(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    await this.assertActivityKeyboardFocusable(activityName);
    await this.browser().keys(["Enter"]);
    await this.browser().waitUntil(async () => (await this.recognitionSnapshot()).shown, {
      timeout: 5_000,
      interval: 50,
      timeoutMsg: `${activityName} recognition panel did not open from the keyboard`,
    });
  }

  async assertRecognitionFields(
    expectedRows: readonly { field: string; value: string }[],
  ): Promise<void> {
    const expected = Object.fromEntries(expectedRows.map(({ field, value }) => [field, value]));
    assert.equal(new Set(expectedRows.map(({ field }) => field)).size, expectedRows.length);
    assert.equal(expected.limitation, LEGACY_RECOGNITION_LIMITATION);
    expected.limitation = RECIPE_REVIEW_RECOGNITION_LIMITATION;
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.shown, true);
    assert.deepEqual(snapshot.fields, expected);
    this.#expectedRecognitionFields = expected;
    if (this.#evidence.refreshesInvoked === 1) {
      assert.equal(expectedRows.length, 7);
      this.#configuredRecognition = snapshot;
      this.#evidence.configuredPanelMatched = true;
    } else {
      assert.equal(expectedRows.length, 5);
      this.#recognizedRecognition = snapshot;
      this.#evidence.recognizedPanelMatched = true;
    }
  }

  async assertOrderedActivationReasons(
    expectedRows: readonly { kind: string; "workspace-relative path": string }[],
  ): Promise<void> {
    assert.deepEqual(expectedRows, [
      { kind: "explicit-configuration", "workspace-relative path": CONFIGURATION_PATH },
    ]);
    const snapshot = await this.recognitionSnapshot();
    assert.deepEqual(snapshot.tableHeaders, ["kind", "workspace-relative path"]);
    assert.deepEqual(snapshot.tableRows, expectedRows);
    this.#expectedActivationReasons = [...expectedRows];
    this.#configuredRecognition = snapshot;
    this.#evidence.configuredReasonMatched = true;
  }

  async assertConfiguredRecognitionOnlyExclusions(): Promise<void> {
    const snapshot = await this.recognitionSnapshot();
    assert.deepEqual(snapshot.fields, this.#expectedRecognitionFields);
    assert.deepEqual(snapshot.tableRows, this.#expectedActivationReasons);
    assert.deepEqual(
      snapshot.controls,
      [BUILD_RECIPE_REVIEW_NAME],
      "configured diagnostics must expose only the accessible metadata-review control and no execution control",
    );
    await this.assertRecognitionOnlyChrome(snapshot);
    this.#configuredRecognition = snapshot;
    this.#evidence.configuredRecognitionOnlyExclusionsMatched = true;
  }

  async createDescriptorsExternally(
    rows: readonly { "workspace-relative path": string; "exact byte length": string }[],
  ): Promise<void> {
    assert.deepEqual(
      rows,
      DESCRIPTORS.map((relativePath) => ({
        "workspace-relative path": relativePath,
        "exact byte length": "0",
      })),
    );
    for (const relativePath of DESCRIPTORS) {
      await this.assertProjectInputsUnchanged();
      const before = this.#lastVerifiedProjectInputs!;
      const candidate = this.workspacePath(relativePath);
      await writeFile(candidate, Buffer.alloc(0), { flag: "wx" });
      const metadata = await lstat(candidate);
      assert.equal(metadata.isFile(), true);
      assert.equal(metadata.isSymbolicLink(), false);
      assert.equal(metadata.size, 0);
      this.#descriptorFingerprints.set(
        relativePath,
        await this.fileFingerprint(candidate, 0, sha256("")),
      );
      const after = await this.projectInputSnapshot();
      this.assertOnlyExpectedProjectInputChanges(before, after, [relativePath]);
      this.#lastVerifiedProjectInputs = after;
      this.#evidence.ownerMutations.push({
        operation: "external-create",
        relativePath,
      });
    }
  }

  async assertConfiguredPanelRetainedForOneSecond(): Promise<void> {
    const expected = this.#configuredRecognition;
    assert.ok(expected, "configured recognition panel was not captured");
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const ui = await this.uiSnapshot();
      assert.deepEqual(ui.activityNames, ACTIVE_ACTIVITY_NAMES);
      assert.deepEqual(ui.bottomNames, BASE_BOTTOM_TOOL_NAMES);
      assert.deepEqual(ui.recognition, expected);
      assert.equal(ui.workspaceWarning.count, 0);
      await this.assertFingerprint(
        this.#unsupportedFingerprint,
        Buffer.from(UNSUPPORTED_CONFIGURATION),
      );
      await this.assertDescriptorFilesExact();
      await this.assertProjectInputsUnchanged();
      await wait(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    this.#retentionPhase = "configured";
    this.#evidence.noWatchRetentionMilliseconds.push(1_000);
  }

  async assertNoConfigurationOrScanWarning(): Promise<void> {
    const ui = await this.uiSnapshot();
    assert.equal(ui.workspaceWarning.count, 0);
    assert.deepEqual(ui.recognition.warnings, []);
    assert.doesNotMatch(
      ui.recognition.text,
      /scan (?:issue|failed)|configuration needs attention/iu,
    );
  }

  assertNoConfigurationOrEvidenceWatchOrPollRefresh(): void {
    assert.equal(this.#retentionPhase, "configured");
    assert.equal(this.#evidence.noWatchRetentionMilliseconds.at(-1), 1_000);
  }

  async returnToWorkspaceSettingsAndRefresh(controlName: string): Promise<void> {
    assert.equal(this.#retentionPhase, "configured");
    await this.invokeWorkspaceRefresh(controlName);
  }

  assertSecondRefreshTransition(checkingText: string): void {
    assert.equal(checkingText, CHECKING_TEXT);
    assert.equal(this.#evidence.refreshesInvoked, 2);
    const snapshots = this.requireRefreshSnapshots();
    const first = snapshots[0]!;
    assert.equal(first.configuredDecision, true);
    assert.equal(first.explicitReason, true);
    assert.equal(
      snapshots.some(
        (snapshot) =>
          !snapshot.completed &&
          !snapshot.configuredDecision &&
          !snapshot.explicitReason &&
          snapshot.checking,
      ),
      true,
      `configured authority was not synchronously revoked into checking: ${JSON.stringify(snapshots.slice(-30))}`,
    );
    assert.equal(
      snapshots.some(
        (snapshot) =>
          snapshot.completed && (snapshot.configuredDecision || snapshot.explicitReason),
      ),
      false,
    );
    this.#evidence.secondRefreshTransitionMatched = true;
  }

  async assertCheckingCleared(): Promise<void> {
    const ui = await this.uiSnapshot();
    assert.equal(ui.checking, false);
  }

  async assertRecognizedActivityOnly(activityName: string): Promise<void> {
    assert.equal(activityName, ACTIVITY_NAME);
    const names = await this.activityNames();
    assert.deepEqual(names, ACTIVE_ACTIVITY_NAMES);
    assert.equal(names.filter((name) => name === activityName).length, 1);
    const controls = await this.activityControlsNamed(activityName);
    assert.equal(controls.length, 1);
    assert.equal(await controls[0]!.getComputedLabel(), activityName);
    assert.equal(await controls[0]!.getAttribute("disabled"), null);
    const warning = await this.workspaceWarningSnapshot();
    assert.deepEqual(warning.fields, UNSUPPORTED_WARNING_FIELDS);
    await this.closeSettingsIfOpen();
    this.#evidence.recognizedActivityMatched = true;
  }

  async assertOrderedEvidence(
    expectedRows: readonly { kind: string; "workspace-relative path": string }[],
  ): Promise<void> {
    assert.deepEqual(expectedRows, [
      { kind: "x2proj", "workspace-relative path": DESCRIPTORS[0]! },
      { kind: "xcommod", "workspace-relative path": DESCRIPTORS[1]! },
    ]);
    const snapshot = await this.recognitionSnapshot();
    assert.deepEqual(snapshot.tableHeaders, ["kind", "workspace-relative path"]);
    assert.deepEqual(snapshot.tableRows, expectedRows);
    this.#expectedEvidenceRows = [...expectedRows];
    this.#recognizedRecognition = snapshot;
    this.#evidence.recognizedEvidenceMatched = true;
  }

  async assertMirroredUnsupportedWarning(role: string): Promise<void> {
    assert.equal(role, "alert");
    const settingsWarning = this.#unsupportedWarning;
    assert.ok(settingsWarning, "unsupported-target Settings warning was not captured");
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.warnings.length, 1);
    const mirrored = snapshot.warnings[0]!;
    assert.equal(mirrored.role, role);
    assert.equal(mirrored.title, settingsWarning.title);
    assert.deepEqual(mirrored.fields, settingsWarning.fields);
    assert.deepEqual(mirrored.controls, []);
    assert.equal(mirrored.nestedAlerts, 0);
    await this.assertScopedWarningDisclosures("mirrored");
    this.#recognizedRecognition = snapshot;
    this.#evidence.mirroredWarningMatched = true;
  }

  async assertNoConfiguredAuthority(): Promise<void> {
    const snapshot = await this.recognitionSnapshot();
    assert.equal(snapshot.fields.source, undefined);
    assert.equal(snapshot.fields["activation confidence"], undefined);
    assert.deepEqual(snapshot.tableRows, this.#expectedEvidenceRows);
    assert.equal(
      snapshot.tableRows.some(({ kind }) => /explicit|configuration/iu.test(kind)),
      false,
    );
    this.#recognizedRecognition = snapshot;
    this.#evidence.configuredAuthorityRevoked = true;
  }

  async assertRecognizedRecognitionOnlyExclusions(): Promise<void> {
    const snapshot = await this.recognitionSnapshot();
    assert.deepEqual(snapshot.fields, this.#expectedRecognitionFields);
    assert.deepEqual(snapshot.tableRows, this.#expectedEvidenceRows);
    assert.equal(snapshot.warnings.length, 1);
    assert.deepEqual(
      snapshot.controls,
      [BUILD_RECIPE_REVIEW_NAME],
      "recognized diagnostics must expose only the accessible metadata-review control and no execution control",
    );
    await this.assertRecognitionOnlyChrome(snapshot);
    this.#recognizedRecognition = snapshot;
    this.#evidence.recognizedRecognitionOnlyExclusionsMatched = true;
  }

  async assertFiveSecondStability(): Promise<void> {
    const expected = this.#recognizedRecognition;
    assert.ok(expected, "recognized diagnostic panel was not captured");
    const expectedWarning = this.#unsupportedWarning;
    assert.ok(expectedWarning, "unsupported-target warning was not captured");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const ui = await this.uiSnapshot();
      assert.deepEqual(ui.activityNames, ACTIVE_ACTIVITY_NAMES);
      assert.deepEqual(ui.bottomNames, BASE_BOTTOM_TOOL_NAMES);
      assert.deepEqual(ui.recognition, expected);
      await this.assertFingerprint(
        this.#unsupportedFingerprint,
        Buffer.from(UNSUPPORTED_CONFIGURATION),
      );
      await this.assertDescriptorFilesExact();
      await this.assertProjectInputsUnchanged();
      await wait(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    this.#evidence.staleStabilityMilliseconds = 5_000;
  }

  async assertNoLateStaleConfiguredState(): Promise<void> {
    assert.equal(this.#evidence.staleStabilityMilliseconds, 5_000);
    const ui = await this.uiSnapshot();
    assert.equal(ui.activityNames.filter((name) => name === ACTIVITY_NAME).length, 1);
    assert.equal(ui.recognition.fields.source, undefined);
    assert.equal(ui.recognition.fields["activation confidence"], undefined);
    assert.equal(
      ui.recognition.tableRows.some(({ kind }) => /explicit|configuration/iu.test(kind)),
      false,
    );
    assert.equal(
      ui.bottomNames.some((name) => /xcom/iu.test(name)),
      false,
    );
  }

  async assertUnsupportedConfigurationBytes(relativePath: string): Promise<void> {
    assert.equal(relativePath, CONFIGURATION_PATH);
    await this.assertFingerprint(
      this.#unsupportedFingerprint,
      Buffer.from(UNSUPPORTED_CONFIGURATION),
    );
  }

  async assertDescriptorFilesRemainExact(): Promise<void> {
    await this.assertDescriptorFilesExact();
  }

  async assertOwnerOnlyMutationAccounting(): Promise<void> {
    assert.deepEqual(this.#evidence.projectInputPaths, PROJECT_INPUT_PATHS);
    assert.deepEqual(this.#evidence.ownerMutations, [
      { operation: "external-replace-valid", relativePath: CONFIGURATION_PATH },
      { operation: "external-replace-unsupported", relativePath: CONFIGURATION_PATH },
      { operation: "external-create", relativePath: DESCRIPTORS[0] },
      { operation: "external-create", relativePath: DESCRIPTORS[1] },
    ]);
    assert.deepEqual(this.#evidence.applicationOwnedWorkspaceMetadata, {
      relativePath: WORKSPACE_METADATA_PATH,
      changedDuringLaunch: true,
      excludedFromProjectInputMutationClaim: true,
    });
    await this.assertProjectInputsUnchanged();
    await this.assertFingerprint(
      this.#unsupportedFingerprint,
      Buffer.from(UNSUPPORTED_CONFIGURATION),
    );
    await this.assertDescriptorFilesExact();
    this.#evidence.exactProjectInputFingerprintsMatched = true;
    this.#evidence.ownerOnlyMutationAccountingMatched = true;
  }

  async assertApplicationNeverMutatedProjectFiles(): Promise<void> {
    assert.equal(this.#evidence.ownerOnlyMutationAccountingMatched, true);
    await this.assertFingerprint(
      this.#unsupportedFingerprint,
      Buffer.from(UNSUPPORTED_CONFIGURATION),
    );
    await this.assertDescriptorFilesExact();
    await this.assertProjectInputsUnchanged();
    this.#evidence.applicationProjectWritesExcluded = true;
  }

  evidence(): Readonly<NativeXcom2ConfigurationDiagnosticsEvidence> {
    return {
      ...this.#evidence,
      boundary: {
        ...this.#evidence.boundary,
        claimsExcluded: [...this.#evidence.boundary.claimsExcluded],
      },
      noWatchRetentionMilliseconds: [...this.#evidence.noWatchRetentionMilliseconds],
      projectInputPaths: [...this.#evidence.projectInputPaths],
      ownerMutations: this.#evidence.ownerMutations.map((mutation) => ({ ...mutation })),
      scenarioEnvironment: this.#lease
        ? boundedLeaseEvidence(this.#lease.evidence())
        : this.#evidence.scenarioEnvironment,
    };
  }

  redactedDiagnostics(): string {
    let diagnostic = this.#driverDiagnostic;
    if (this.#lease) {
      diagnostic = diagnostic
        .replaceAll(this.#lease.paths.root, "<SCENARIO>")
        .replaceAll(SECRET_CANARY, "<SECRET_CANARY>")
        .replaceAll(PUBLIC_CANARY, "<PUBLIC_CANARY>")
        .replaceAll(MALFORMED_CONFIGURATION, "<CONFIGURATION_BYTES>")
        .replaceAll(VALID_CONFIGURATION, "<CONFIGURATION_BYTES>")
        .replaceAll(UNSUPPORTED_CONFIGURATION, "<CONFIGURATION_BYTES>");
    }
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
            "final XCOM configuration diagnostics DOM query",
          );
          if (response.readyState === "complete" && response.width > 0 && response.height > 0) {
            this.#evidence.responsive = true;
          }
        } catch {
          // The production window can already be closed during cleanup.
        }
        try {
          await bounded(browser.deleteSession(), 2_000, "XCOM diagnostics WebDriver cleanup");
          this.#sessionDeleted = true;
        } catch {
          // Continue to bounded process cleanup.
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
      assert.equal(remaining, 0, "owned XCOM diagnostics processes survived cleanup");
    } finally {
      const lease = this.#lease;
      if (lease) {
        await lease.restoreEnvironment();
        this.#evidence.environmentRestored = true;
        await lease.dispose();
        this.#evidence.scenarioEnvironment = boundedLeaseEvidence(lease.evidence());
      }
      this.#disposed = true;
      this.#evidence.disposed = true;
    }
  }

  private browser(): Browser {
    if (!this.#browser)
      throw new Error("XCOM configuration diagnostics WebdriverIO is unavailable");
    return this.#browser;
  }

  private lease(): NativeScenarioEnvironmentLease {
    if (!this.#lease) throw new Error("XCOM configuration diagnostics lease is unavailable");
    return this.#lease;
  }

  private workspaceRoot(): string {
    return this.lease().paths.workspace;
  }

  private workspacePath(relativePath: string): string {
    assert.equal(path.posix.normalize(relativePath), relativePath);
    assert.equal(path.posix.isAbsolute(relativePath), false);
    const candidate = path.join(this.workspaceRoot(), ...relativePath.split("/"));
    assert.ok(isContained(this.workspaceRoot(), candidate));
    return candidate;
  }

  private configurationPath(): string {
    return this.workspacePath(CONFIGURATION_PATH);
  }

  private async workspaceTree(): Promise<TreeEntry[]> {
    const root = this.workspaceRoot();
    const result: TreeEntry[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name);
        const relativePath = path.relative(root, candidate).split(path.sep).join("/");
        const metadata = await lstat(candidate);
        assert.equal(metadata.isSymbolicLink(), false, `${relativePath} became a symbolic link`);
        assert.ok(isContained(await realpath(root), await realpath(candidate)));
        if (metadata.isDirectory()) {
          result.push({
            relativePath,
            kind: "directory",
            mode: metadata.mode & 0o777,
          });
          pending.push(candidate);
        } else {
          assert.equal(metadata.isFile(), true, `${relativePath} is not a regular file`);
          const bytes = await readFile(candidate);
          result.push({
            relativePath,
            kind: "regular-file",
            mode: metadata.mode & 0o777,
            size: bytes.byteLength,
            sha256: sha256(bytes),
          });
        }
      }
    }
    return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  }

  private async projectInputSnapshot(): Promise<ProjectInputSnapshotEntry[]> {
    const snapshot: ProjectInputSnapshotEntry[] = [];
    for (const relativePath of PROJECT_INPUT_PATHS) {
      try {
        snapshot.push({
          relativePath,
          fingerprint: await this.observedFileFingerprint(this.workspacePath(relativePath)),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        snapshot.push({ relativePath, fingerprint: null });
      }
    }
    return snapshot;
  }

  private async assertProjectInputsUnchanged(): Promise<void> {
    assert.ok(this.#lastVerifiedProjectInputs, "post-launch project-input baseline is unavailable");
    const current = await this.projectInputSnapshot();
    assert.deepEqual(current, this.#lastVerifiedProjectInputs);
    this.#lastVerifiedProjectInputs = current;
  }

  private async waitForWorkspaceMarkerToSettle(): Promise<FileFingerprint> {
    const markerPath = this.workspacePath(WORKSPACE_METADATA_PATH);
    const deadline = Date.now() + 5_000;
    let candidate = await this.observedFileFingerprint(markerPath);
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      await wait(50);
      const next = await this.observedFileFingerprint(markerPath);
      if (!isDeepStrictEqual(next, candidate)) {
        candidate = next;
        stableSince = Date.now();
        continue;
      }
      if (Date.now() - stableSince >= 250) return candidate;
    }
    throw new Error("application-owned workspace metadata did not settle within 5000ms");
  }

  private assertOnlyExpectedProjectInputChanges(
    before: readonly ProjectInputSnapshotEntry[],
    after: readonly ProjectInputSnapshotEntry[],
    expectedPaths: readonly ProjectInputPath[],
  ): void {
    const beforeByPath = new Map(before.map((entry) => [entry.relativePath, entry.fingerprint]));
    const afterByPath = new Map(after.map((entry) => [entry.relativePath, entry.fingerprint]));
    const changed = PROJECT_INPUT_PATHS.filter(
      (relativePath) =>
        !isDeepStrictEqual(beforeByPath.get(relativePath), afterByPath.get(relativePath)),
    ).sort();
    assert.deepEqual(changed, [...expectedPaths].sort());
  }

  private async workspaceContainsBytes(needle: Buffer): Promise<boolean> {
    for (const entry of await this.workspaceTree()) {
      if (entry.kind !== "regular-file") continue;
      if ((await readFile(this.workspacePath(entry.relativePath))).includes(needle)) return true;
    }
    return false;
  }

  private async assertNoConventionEvidenceInTree(): Promise<void> {
    const entries = await this.workspaceTree();
    for (const pattern of [/\.x2proj$/u, /\.xcommod$/u, /xcomengine\.ini$/u, /\.uc$/u]) {
      assert.equal(
        entries.some(({ relativePath }) => pattern.test(relativePath)),
        false,
      );
    }
  }

  private async observedFileFingerprint(filePath: string): Promise<FileFingerprint> {
    const metadata = await lstat(filePath, { bigint: true });
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    const bytes = await readFile(filePath);
    return {
      device: metadata.dev.toString(),
      inode: metadata.ino.toString(),
      mode: Number(metadata.mode),
      size: metadata.size.toString(),
      modifiedNanoseconds: metadata.mtimeNs.toString(),
      sha256: sha256(bytes),
    };
  }

  private async fileFingerprint(
    filePath: string,
    expectedSize: number,
    expectedSha256: string,
  ): Promise<FileFingerprint> {
    const fingerprint = await this.observedFileFingerprint(filePath);
    assert.equal(fingerprint.size, String(expectedSize));
    assert.equal(fingerprint.sha256, expectedSha256);
    return fingerprint;
  }

  private async assertFingerprint(
    expected: FileFingerprint | undefined,
    expectedBytes: Buffer,
  ): Promise<void> {
    assert.ok(expected, "expected project-file fingerprint is unavailable");
    assert.deepEqual(
      await this.fileFingerprint(
        this.configurationPath(),
        expectedBytes.byteLength,
        sha256(expectedBytes),
      ),
      expected,
    );
    assert.deepEqual(await readFile(this.configurationPath()), expectedBytes);
  }

  private async assertDescriptorFilesExact(): Promise<void> {
    for (const relativePath of DESCRIPTORS) {
      const candidate = this.workspacePath(relativePath);
      const expectedFingerprint = this.#descriptorFingerprints.get(relativePath);
      assert.ok(expectedFingerprint, `expected ${relativePath} fingerprint is unavailable`);
      assert.deepEqual(await this.fileFingerprint(candidate, 0, sha256("")), expectedFingerprint);
      assert.deepEqual(await readFile(candidate), Buffer.alloc(0));
      assert.ok(isContained(await realpath(this.workspaceRoot()), await realpath(candidate)));
    }
  }

  private async openWorkspaceSettingsInternal(): Promise<void> {
    const existing = await this.browser().$('[role="dialog"]');
    if (!(await existing.isExisting())) {
      const header = await this.browser().$("#root > div > header");
      const buttons = await header.$$("button");
      let clicked = false;
      for (const button of buttons) {
        if (normalizeText(await button.getText()) !== "Settings") continue;
        await button.click();
        clicked = true;
        break;
      }
      assert.equal(clicked, true, "real Settings button is missing");
    }
    const dialog = await this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await dialog.getComputedLabel(), "Settings");
    const selected = await this.browser().execute(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/gu, " ").trim();
      const tab = [...(dialog?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].find(
        (candidate) => normalize(candidate.querySelector("span")?.textContent) === "Workspace",
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
      { timeout: 5_000, interval: 50, timeoutMsg: "Settings Workspace tab was not selected" },
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

  private async assertScopedWarningDisclosures(
    requiredSurface: "settings" | "mirrored",
  ): Promise<void> {
    assert.deepEqual(this.#prohibitedDisclosureLabels, [
      PUBLIC_CANARY,
      "the actual absolute scenario sandbox root",
      "configuration bytes or submitted module roots",
      "parser, provider, or native-command details",
      "the scenario-owner secret canary or raw causes",
    ]);
    const markups = await this.browser().execute(
      (activityName, warningTitle) => {
        const normalize = (value: string | null | undefined): string =>
          (value ?? "").replace(/\s+/gu, " ").trim();
        const matchingWarnings = (container: ParentNode | null | undefined): string[] =>
          [...(container?.querySelectorAll<HTMLElement>('[role="alert"]') ?? [])]
            .filter((warning) => normalize(warning.textContent).includes(warningTitle))
            .map((warning) => warning.outerHTML);
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        const currentWorkspace = [...(dialog?.querySelectorAll<HTMLElement>("section") ?? [])].find(
          (candidate) =>
            [...candidate.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].some(
              (heading) => normalize(heading.textContent) === "Current workspace",
            ),
        );
        const activity = [
          ...document.querySelectorAll<HTMLElement>(
            'nav[aria-label="Primary activity"] [role="tab"]',
          ),
        ].find((candidate) => candidate.getAttribute("aria-label") === activityName);
        const recognitionPanel = [
          ...document.querySelectorAll<HTMLElement>(
            '[role="tabpanel"], [role="region"], section[aria-labelledby]',
          ),
        ].find(
          (candidate) =>
            candidate.getAttribute("aria-label") === activityName ||
            (activity?.id && candidate.getAttribute("aria-labelledby") === activity.id),
        );
        return {
          settings: matchingWarnings(currentWorkspace),
          mirrored: matchingWarnings(recognitionPanel),
        };
      },
      ACTIVITY_NAME,
      WARNING_TITLE,
    );
    assert.equal(markups[requiredSurface].length, 1);
    const scopedWarningMarkup = [...markups.settings, ...markups.mirrored];
    assert.ok(scopedWarningMarkup.length > 0);
    const lease = this.lease();
    const prohibitedValues = [
      { label: "public canary", value: PUBLIC_CANARY },
      { label: "secret canary", value: SECRET_CANARY },
      { label: "scenario sandbox root", value: lease.paths.root },
      { label: "malformed configuration bytes", value: MALFORMED_CONFIGURATION },
      { label: "valid configuration bytes", value: VALID_CONFIGURATION },
      { label: "unsupported configuration bytes", value: UNSUPPORTED_CONFIGURATION },
      { label: "submitted module root", value: MODULE_ROOT },
      { label: "configuration native command", value: "read_xcom2_module_configuration" },
      { label: "scan native command", value: "scan_xcom2_modules" },
      { label: "configuration read identifier", value: "configurationReadId" },
      { label: "activation generation", value: "activationGeneration" },
      { label: "raw parser cause", value: "SyntaxError" },
    ];
    for (const markup of scopedWarningMarkup) {
      for (const prohibited of prohibitedValues) {
        assert.equal(
          markup.includes(prohibited.value),
          false,
          `${requiredSurface} diagnostic warning disclosed ${prohibited.label}`,
        );
      }
    }
  }

  private async workspaceWarningSnapshot(): Promise<WarningSnapshot> {
    return await this.browser().execute((warningTitle) => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/gu, " ").trim();
      const empty = (): WarningSnapshot => ({
        count: 0,
        role: "",
        title: "",
        fields: {},
        controls: [],
        nestedAlerts: 0,
        text: "",
      });
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const section = [...(dialog?.querySelectorAll<HTMLElement>("section") ?? [])].find(
        (candidate) =>
          [...candidate.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].some(
            (heading) => normalize(heading.textContent) === "Current workspace",
          ),
      );
      if (!section) return empty();
      const alerts = [...section.querySelectorAll<HTMLElement>('[role="alert"]')];
      const warning = alerts.find((candidate) =>
        normalize(candidate.textContent).includes(warningTitle),
      );
      if (!warning) return { ...empty(), count: alerts.length };
      const fields: Record<string, string> = {};
      for (const term of warning.querySelectorAll<HTMLElement>("dt")) {
        let key = normalize(term.textContent).toLowerCase();
        if (key === "project file") key = "project file label";
        fields[key] = normalize(term.nextElementSibling?.textContent);
      }
      const title =
        [...warning.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,strong")]
          .map((element) => normalize(element.textContent))
          .find((value) => value === warningTitle) ?? "";
      return {
        count: alerts.length,
        role: warning.getAttribute("role") ?? "",
        title,
        fields,
        controls: [
          ...warning.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,textarea,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
          ),
        ].map(
          (element) =>
            element.getAttribute("aria-label") || normalize(element.textContent) || element.tagName,
        ),
        nestedAlerts: warning.querySelectorAll('[role="alert"]').length,
        text: normalize(warning.textContent),
      };
    }, WARNING_TITLE);
  }

  private async recognitionSnapshot(): Promise<RecognitionSnapshot> {
    return await this.browser().execute(
      (activityName, warningTitle) => {
        const normalize = (value: string | null | undefined): string =>
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
            tableHeaders: [],
            tableRows: [],
            warnings: [],
            controls: [],
            text: "",
          };
        }
        const fields: Record<string, string> = {};
        for (const term of panel.querySelectorAll<HTMLElement>("dt")) {
          if (term.closest('[role="alert"]')) continue;
          fields[normalize(term.textContent).toLowerCase()] = normalize(
            term.nextElementSibling?.textContent,
          );
        }
        let tableHeaders: string[] = [];
        let tableRows: Array<{ kind: string; "workspace-relative path": string }> = [];
        for (const table of panel.querySelectorAll<HTMLTableElement>("table")) {
          const headers = [...table.querySelectorAll<HTMLElement>("thead th")].map((header) =>
            normalize(header.textContent).toLowerCase(),
          );
          if (headers.join("|") !== "kind|workspace-relative path") continue;
          tableHeaders = headers;
          tableRows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((row) => {
            const cells = [...row.querySelectorAll<HTMLElement>("th,td")].map((cell) =>
              normalize(cell.textContent),
            );
            return { kind: cells[0] ?? "", "workspace-relative path": cells[1] ?? "" };
          });
          break;
        }
        const warningSnapshots: WarningSnapshot[] = [
          ...panel.querySelectorAll<HTMLElement>('[role="alert"]'),
        ].map((warning) => {
          const warningFields: Record<string, string> = {};
          for (const term of warning.querySelectorAll<HTMLElement>("dt")) {
            let key = normalize(term.textContent).toLowerCase();
            if (key === "project file") key = "project file label";
            warningFields[key] = normalize(term.nextElementSibling?.textContent);
          }
          const title =
            [...warning.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,strong")]
              .map((element) => normalize(element.textContent))
              .find((value) => value === warningTitle) ?? "";
          return {
            count: 1,
            role: warning.getAttribute("role") ?? "",
            title,
            fields: warningFields,
            controls: [
              ...warning.querySelectorAll<HTMLElement>(
                'button,a[href],input,select,textarea,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
              ),
            ].map(
              (element) =>
                element.getAttribute("aria-label") ||
                normalize(element.textContent) ||
                element.tagName,
            ),
            nestedAlerts: warning.querySelectorAll('[role="alert"]').length,
            text: normalize(warning.textContent),
          };
        });
        return {
          shown: true,
          fields,
          tableHeaders,
          tableRows,
          warnings: warningSnapshots,
          controls: [
            ...panel.querySelectorAll<HTMLElement>(
              'button,a[href],input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
            ),
          ].map(
            (element) =>
              element.getAttribute("aria-label") ||
              normalize(element.textContent) ||
              element.tagName,
          ),
          text: normalize(panel.textContent),
        };
      },
      ACTIVITY_NAME,
      WARNING_TITLE,
    );
  }

  private async uiSnapshot(): Promise<UiSnapshot> {
    const [activityNames, bottomNames, recognition, workspaceWarning, checking] = await Promise.all(
      [
        this.activityNames(),
        this.bottomContributionNames(),
        this.recognitionSnapshot(),
        this.workspaceWarningSnapshot(),
        this.browser().execute((checkingText) => {
          const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
          const normalize = (value: string | null | undefined): string =>
            (value ?? "").replace(/\s+/gu, " ").trim();
          const section = [...(dialog?.querySelectorAll<HTMLElement>("section") ?? [])].find(
            (candidate) =>
              [...candidate.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].some(
                (heading) => normalize(heading.textContent) === "Current workspace",
              ),
          );
          return normalize(section?.textContent).includes(checkingText);
        }, CHECKING_TEXT),
      ],
    );
    return {
      activityNames: [...activityNames],
      bottomNames: [...bottomNames],
      recognition,
      workspaceWarning,
      checking,
    };
  }

  private async activityControlsNamed(name: string) {
    const controls = await this.browser().$$('nav[aria-label="Primary activity"] [role="tab"]');
    const matches = [];
    for (const control of controls)
      if ((await control.getComputedLabel()) === name) matches.push(control);
    return matches;
  }

  private async activityNames(): Promise<string[]> {
    const controls = await this.browser()
      .$$('nav[aria-label="Primary activity"] [role="tab"]')
      .getElements();
    const names: string[] = [];
    for (const control of controls) names.push(await control.getComputedLabel());
    return names;
  }

  private async bottomContributionNames(): Promise<string[]> {
    const controls = await this.browser().$$('.ide-bottom-panel [role="tab"]').getElements();
    const names: string[] = [];
    for (const control of controls) {
      names.push(normalizeText((await control.getComputedLabel()) || (await control.getText())));
    }
    return names;
  }

  private async assertRecognitionOnlyChrome(snapshot: RecognitionSnapshot): Promise<void> {
    assert.equal(snapshot.fields.limitation, RECIPE_REVIEW_RECOGNITION_LIMITATION);
    assert.deepEqual(await this.activityNames(), ACTIVE_ACTIVITY_NAMES);
    const bottomNames = await this.bottomContributionNames();
    assert.deepEqual(bottomNames, BASE_BOTTOM_TOOL_NAMES);
    assert.equal(
      bottomNames.some((name) => /xcom|build|problems|logs/iu.test(name)),
      false,
    );
    assert.equal(
      (await this.activityNames()).some((name) => /build|problems|logs/iu.test(name)),
      false,
    );
  }

  private requireRefreshSnapshots(): readonly RefreshSnapshot[] {
    assert.ok(
      this.#refreshSnapshots && this.#refreshSnapshots.length > 1,
      "refresh evidence unavailable",
    );
    return this.#refreshSnapshots;
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
