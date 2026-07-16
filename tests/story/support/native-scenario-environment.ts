import assert from "node:assert/strict";
import { appendFile, chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";

const ENVIRONMENT_VARIABLES = [
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
] as const;

const LEASE_EVIDENCE_FILE = "native-scenario-environment-leases.jsonl";

type EnvironmentVariable = (typeof ENVIRONMENT_VARIABLES)[number];
type Requirement =
  "REQ-LAYOUT-DESKTOP-001" | "REQ-DESKTOP-FILE-OPEN-001" | "REQ-XCOM2-MODULE-ACTIVATION-001";

interface NativeScenarioEnvironmentOptions {
  readonly workspaceName?: string;
}

interface RecordedLeaseEvent {
  readonly event: "acquired" | "environment-restored" | "released";
  readonly requirement: Requirement;
  readonly scenario: string;
  readonly root: string;
  readonly workspace: string;
}

export interface NativeScenarioEnvironmentPaths {
  readonly root: string;
  readonly home: string;
  readonly xdgConfig: string;
  readonly xdgCache: string;
  readonly xdgData: string;
  readonly xdgState: string;
  readonly xdgRuntime: string;
  readonly ideHome: string;
  readonly workspace: string;
  readonly temporary: string;
  readonly evidence: string;
}

export interface NativeScenarioEnvironmentEvidence {
  readonly scenario: string;
  readonly scenarioRoot: string;
  readonly workspaceRoot: string;
  readonly runnerWorkspaceRoot: string;
  readonly leaseEvidencePath: string;
  readonly workspaceDistinctFromRunner: true;
  readonly workspaceUniqueAmongRecordedScenarios: true;
  readonly previouslyRecordedScenarioWorkspaces: number;
  environmentRestored: boolean;
  scenarioChildRemoved: boolean;
}

let activeLeaseRoot: string | undefined;

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native scenario environment requires absolute ${name}`);
  }
  return path.normalize(value);
}

async function recordedEvents(filePath: string): Promise<readonly RecordedLeaseEvent[]> {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RecordedLeaseEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class NativeScenarioEnvironmentLease {
  readonly requirement: Requirement;
  readonly runnerSandbox: string;
  readonly scenarioRoot: string;
  readonly runnerWorkspace: string;
  readonly runnerArtifactPath: string;
  readonly paths: NativeScenarioEnvironmentPaths;
  readonly #originalEnvironment: ReadonlyMap<EnvironmentVariable, string | undefined>;
  readonly #leaseEvidencePath: string;
  readonly #evidence: NativeScenarioEnvironmentEvidence;
  #environmentRestored = false;
  #released = false;

  private constructor(
    requirement: Requirement,
    runnerSandbox: string,
    scenarioRoot: string,
    runnerWorkspace: string,
    runnerArtifactPath: string,
    paths: NativeScenarioEnvironmentPaths,
    originalEnvironment: ReadonlyMap<EnvironmentVariable, string | undefined>,
    previouslyRecordedScenarioWorkspaces: number,
  ) {
    this.requirement = requirement;
    this.runnerSandbox = runnerSandbox;
    this.scenarioRoot = scenarioRoot;
    this.runnerWorkspace = runnerWorkspace;
    this.runnerArtifactPath = runnerArtifactPath;
    this.paths = paths;
    this.#originalEnvironment = originalEnvironment;
    this.#leaseEvidencePath = path.join(runnerArtifactPath, LEASE_EVIDENCE_FILE);
    this.#evidence = {
      scenario: path.basename(paths.root),
      scenarioRoot: paths.root,
      workspaceRoot: paths.workspace,
      runnerWorkspaceRoot: runnerWorkspace,
      leaseEvidencePath: this.#leaseEvidencePath,
      workspaceDistinctFromRunner: true,
      workspaceUniqueAmongRecordedScenarios: true,
      previouslyRecordedScenarioWorkspaces,
      environmentRestored: false,
      scenarioChildRemoved: false,
    };
  }

  static async acquire(
    requirement: Requirement,
    options: NativeScenarioEnvironmentOptions = {},
  ): Promise<NativeScenarioEnvironmentLease> {
    assert.equal(
      activeLeaseRoot,
      undefined,
      `native scenario lease was not released: ${activeLeaseRoot}`,
    );
    const runnerSandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
    const scenarioRoot = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SCENARIO_ROOT");
    const runnerWorkspace = requiredAbsoluteEnvironment("IDE_WORKSPACE_ROOT");
    const runnerArtifactPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_ARTIFACT_PATH");
    assert.ok(
      isContained(runnerSandbox, scenarioRoot),
      "scenario lease root escaped runner sandbox",
    );
    assert.ok(
      isContained(runnerSandbox, runnerWorkspace),
      "runner workspace escaped runner sandbox",
    );
    assert.ok(
      isContained(runnerSandbox, runnerArtifactPath),
      "runner evidence escaped runner sandbox",
    );

    const [canonicalSandbox, canonicalScenarioRoot, canonicalRunnerArtifactPath] =
      await Promise.all([
        realpath(runnerSandbox),
        realpath(scenarioRoot),
        realpath(runnerArtifactPath),
      ]);
    assert.ok(isContained(canonicalSandbox, canonicalScenarioRoot));
    assert.ok(isContained(canonicalSandbox, canonicalRunnerArtifactPath));

    const prefix = `${requirement.toLowerCase()}-`;
    const root = await mkdtemp(path.join(canonicalScenarioRoot, prefix));
    const workspaceName = options.workspaceName;
    if (workspaceName !== undefined) {
      assert.match(workspaceName, /^[a-z0-9][a-z0-9-]*$/u);
      assert.equal(path.basename(workspaceName), workspaceName);
    }
    const paths: NativeScenarioEnvironmentPaths = {
      root,
      home: path.join(root, "home"),
      xdgConfig: path.join(root, "xdg/config"),
      xdgCache: path.join(root, "xdg/cache"),
      xdgData: path.join(root, "xdg/data"),
      xdgState: path.join(root, "xdg/state"),
      xdgRuntime: path.join(root, "xdg/runtime"),
      ideHome: path.join(root, "ide-home"),
      workspace:
        workspaceName === undefined
          ? path.join(root, "workspace")
          : path.join(root, "workspaces", workspaceName),
      temporary: path.join(root, "tmp"),
      evidence: path.join(root, "evidence"),
    };

    let lease: NativeScenarioEnvironmentLease | undefined;
    try {
      assert.equal(path.dirname(await realpath(root)), canonicalScenarioRoot);
      for (const directory of Object.values(paths)) {
        assert.ok(isContained(root, directory), `${directory} escaped native scenario lease`);
        if (directory !== root) await mkdir(directory, { recursive: true });
      }
      await chmod(paths.xdgRuntime, 0o700);
      for (const directory of Object.values(paths)) {
        assert.ok(isContained(await realpath(root), await realpath(directory)));
      }
      assert.notEqual(paths.workspace, runnerWorkspace);

      const leaseEvidencePath = path.join(canonicalRunnerArtifactPath, LEASE_EVIDENCE_FILE);
      const previousAcquisitions = (await recordedEvents(leaseEvidencePath)).filter(
        ({ event }) => event === "acquired",
      );
      assert.equal(
        previousAcquisitions.some(
          (event) => event.root === paths.root || event.workspace === paths.workspace,
        ),
        false,
        "native scenarios must use distinct canonical roots and workspaces",
      );

      const originalEnvironment = new Map<EnvironmentVariable, string | undefined>();
      for (const name of ENVIRONMENT_VARIABLES) originalEnvironment.set(name, process.env[name]);
      lease = new NativeScenarioEnvironmentLease(
        requirement,
        runnerSandbox,
        scenarioRoot,
        runnerWorkspace,
        runnerArtifactPath,
        paths,
        originalEnvironment,
        previousAcquisitions.length,
      );
      lease.setEnvironment();
      activeLeaseRoot = paths.root;
      await lease.record("acquired");
      return lease;
    } catch (error) {
      if (lease) await lease.dispose();
      else await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      throw error;
    }
  }

  evidence(): Readonly<NativeScenarioEnvironmentEvidence> {
    return { ...this.#evidence };
  }

  configuredPath(name: EnvironmentVariable): string {
    const configured: Record<EnvironmentVariable, string> = {
      HOME: this.paths.home,
      XDG_CONFIG_HOME: this.paths.xdgConfig,
      XDG_CACHE_HOME: this.paths.xdgCache,
      XDG_DATA_HOME: this.paths.xdgData,
      XDG_STATE_HOME: this.paths.xdgState,
      XDG_RUNTIME_DIR: this.paths.xdgRuntime,
      IDE_HOME: this.paths.ideHome,
      IDE_WORKSPACE_ROOT: this.paths.workspace,
      TMPDIR: this.paths.temporary,
      TEMP: this.paths.temporary,
      TMP: this.paths.temporary,
      IDE_STORY_NATIVE_GUI_ARTIFACT_PATH: this.paths.evidence,
    };
    return configured[name];
  }

  async assertConfiguredPathsConfined(): Promise<void> {
    const canonicalRoot = await realpath(this.paths.root);
    for (const name of ENVIRONMENT_VARIABLES) {
      const configuredPath = this.configuredPath(name);
      assert.ok(isContained(this.paths.root, configuredPath), `${name} escaped scenario root`);
      assert.ok(
        isContained(canonicalRoot, await realpath(configuredPath)),
        `${name} escaped scenario root through a symbolic link`,
      );
    }
  }

  async restoreEnvironment(): Promise<void> {
    if (this.#environmentRestored) return;
    for (const name of ENVIRONMENT_VARIABLES) {
      const original = this.#originalEnvironment.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    for (const name of ENVIRONMENT_VARIABLES) {
      assert.equal(
        process.env[name],
        this.#originalEnvironment.get(name),
        `${name} was not restored`,
      );
    }
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.runnerWorkspace);
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_ARTIFACT_PATH, this.runnerArtifactPath);
    this.#environmentRestored = true;
    this.#evidence.environmentRestored = true;
    if (activeLeaseRoot === this.paths.root) activeLeaseRoot = undefined;
    await this.record("environment-restored");
  }

  async dispose(): Promise<void> {
    if (this.#released) return;
    try {
      await this.restoreEnvironment();
      await rm(this.paths.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      await assert.rejects(realpath(this.paths.root), { code: "ENOENT" });
      this.#evidence.scenarioChildRemoved = true;
      await this.record("released");
    } finally {
      if (activeLeaseRoot === this.paths.root) activeLeaseRoot = undefined;
      this.#released = true;
    }
  }

  private setEnvironment(): void {
    for (const name of ENVIRONMENT_VARIABLES) process.env[name] = this.configuredPath(name);
    assert.equal(process.env.IDE_WORKSPACE_ROOT, this.paths.workspace);
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_ARTIFACT_PATH, this.paths.evidence);
  }

  private async record(event: RecordedLeaseEvent["event"]): Promise<void> {
    const entry: RecordedLeaseEvent = {
      event,
      requirement: this.requirement,
      scenario: path.basename(this.paths.root),
      root: this.paths.root,
      workspace: this.paths.workspace,
    };
    await appendFile(this.#leaseEvidencePath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
