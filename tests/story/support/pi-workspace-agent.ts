import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const REQUIREMENT = "REQ-PI-WORKSPACE-AGENT-001" as const;
const INSTALLED_PACKAGE_FIXTURE = [
  "skills/multi-agent",
  "npm:@gotgenes/pi-anthropic-auth",
  "local/pi-llm-wiki-epub",
  "npm:pi-kimi-coder",
  "git:github.com/apmantza/pi-free",
  "npm:opencode-pi",
  "npm:pi-multi-pass",
] as const;

interface WorkspaceModel {
  readonly id: "workspace-a" | "workspace-b";
  readonly name: "Workspace A" | "Workspace B";
  readonly root: string;
  readonly file: string;
}

interface ProcessModel {
  readonly workspaceId: WorkspaceModel["id"];
  readonly root: string;
  readonly sessionId: string;
  readonly pid: number;
  state: "running" | "stopped";
  transcript: string;
}

interface VerificationResult {
  readonly command: "cargo" | "pnpm";
  readonly status: "passed";
  readonly proof: string;
}

async function runVerification(
  command: "cargo" | "pnpm",
  args: readonly string[],
  proof: string,
): Promise<VerificationResult> {
  try {
    await execFileAsync(command, [...args], {
      cwd: PROJECT_ROOT,
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return { command, status: "passed", proof };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${proof} verification failed: ${detail}`);
  }
}

/**
 * Non-E2E Story harness. It drives one deterministic A/B/A state model while
 * requiring the focused production UI/controller/adapter tests and the real
 * portable-PTY Rust lifecycle test to pass before any scenario assertion.
 */
export class PiWorkspaceAgentStorySession {
  #sandbox?: string;
  #workspaces = new Map<WorkspaceModel["id"], WorkspaceModel>();
  #processes = new Map<WorkspaceModel["id"], ProcessModel>();
  #activeWorkspaceId: WorkspaceModel["id"] = "workspace-a";
  #attachedWorkspaceId?: WorkspaceModel["id"];
  #detachedWorkspaceId?: WorkspaceModel["id"];
  #detachedClosed = false;
  #openedFile?: string;
  #stopConfirmationWorkspaceId?: WorkspaceModel["id"];
  #verification: VerificationResult[] = [];
  #sources = new Map<string, string>();
  #nextPid = 700;

  async start(): Promise<void> {
    this.#sandbox = await mkdtemp(join(tmpdir(), "ide-pi-agent-story-"));
    for (const [id, name, file] of [
      ["workspace-a", "Workspace A", "a-only.ts"],
      ["workspace-b", "Workspace B", "b-only.ts"],
    ] as const) {
      const root = join(this.#sandbox, id);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, file), `export const identity = "${id}";\n`, "utf8");
      this.#workspaces.set(id, { id, name, root, file });
    }

    const [native, renderer] = await Promise.all([
      runVerification(
        "cargo",
        [
          "test",
          "--manifest-path",
          "apps/desktop/src-tauri/Cargo.toml",
          "commands::pi_workspace_agent::tests::workspace_a_b_a_sessions_are_isolated_and_detach_does_not_stop_them",
          "--",
          "--exact",
        ],
        "portable PTY A/B isolation and detach lifecycle",
      ),
      runVerification(
        "pnpm",
        [
          "vitest",
          "run",
          "--config",
          "vitest.config.ts",
          "packages/tauri-adapters/src/pi-workspace-agent-tauri.test.ts",
          "apps/desktop/src/features/pi-workspace-agent/usePiWorkspaceAgentController.test.tsx",
          "packages/ui/src/components/PiWorkspaceAgentScreen/PiWorkspaceAgentScreen.test.tsx",
          "packages/ui/src/components/PiWorkspaceAgentScreen/PiNativeTerminal.test.tsx",
          "--reporter=dot",
        ],
        "raw renderer transport, accessory screen, confirmation, and adapter boundary",
      ),
    ]);
    this.#verification = [native, renderer];

    for (const path of [
      "apps/desktop/src/App.tsx",
      "apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs",
      "apps/desktop/src/features/pi-workspace-agent/usePiWorkspaceAgentController.ts",
      "packages/contracts/src/pi-workspace-agent.ts",
      "packages/web-core/src/ports/pi-workspace-agent-port.ts",
      "packages/ui/src/components/PiWorkspaceAgentScreen/PiNativeTerminal.tsx",
      "packages/ui/src/components/PiWorkspaceAgentScreen/PiWorkspaceAgentScreen.tsx",
      "apps/desktop/src-tauri/capabilities/default.json",
    ]) {
      this.#sources.set(path, await readFile(join(PROJECT_ROOT, path), "utf8"));
    }
  }

  evidence(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      requirement: REQUIREMENT,
      evidenceKind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
      verifications: this.#verification,
      workspaces: [...this.#workspaces.values()].map(({ id, name, file }) => ({ id, name, file })),
      sessionIds: [...this.#processes.values()].map(({ workspaceId, sessionId }) => ({
        workspaceId,
        sessionId,
      })),
      packageFixtureCount: INSTALLED_PACKAGE_FIXTURE.length,
    });
  }

  async dispose(): Promise<void> {
    if (this.#sandbox) await rm(this.#sandbox, { recursive: true, force: true });
    this.#sandbox = undefined;
  }

  assertRegistryAndFiles(): void {
    assert.deepEqual([...this.#workspaces.keys()], ["workspace-a", "workspace-b"]);
    assert.notEqual(this.workspace("workspace-a").root, this.workspace("workspace-b").root);
    assert.notEqual(this.workspace("workspace-a").file, this.workspace("workspace-b").file);
  }

  assertFixedPiPtyAvailable(): void {
    assert.equal(this.#verification.length, 2);
    assert.match(
      this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs"),
      /native_pty_system\(\)/u,
    );
    assert.match(
      this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs"),
      /find_pi_executable\(\)/u,
    );
    assert.match(
      this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs"),
      /command\.arg\("--session-id"\)/u,
    );
  }

  selectAgent(workspaceId: WorkspaceModel["id"]): void {
    assert.equal(this.#activeWorkspaceId, workspaceId);
    this.#attachedWorkspaceId = workspaceId;
    this.ensureProcess(workspaceId);
  }

  assertAttachedToExactRoot(workspaceId: WorkspaceModel["id"]): void {
    assert.equal(this.#attachedWorkspaceId, workspaceId);
    const process = this.process(workspaceId);
    assert.equal(process.root, this.workspace(workspaceId).root);
    assert.equal(process.state, "running");
  }

  assertRawTransport(): void {
    const terminal = this.source(
      "packages/ui/src/components/PiWorkspaceAgentScreen/PiNativeTerminal.tsx",
    );
    assert.match(terminal, /terminal\.onData/u);
    assert.match(terminal, /SHIFT_ENTER = "\\u001b\[13;2u"/u);
    assert.match(terminal, /ALT_ENTER = "\\u001b\[13;3u"/u);
    assert.match(terminal, /terminal\.onResize/u);
    assert.doesNotMatch(terminal, /onCommand|promptRef|inputBuffer/u);
  }

  assertPiOwnsConversation(): void {
    const port = this.source("packages/web-core/src/ports/pi-workspace-agent-port.ts");
    assert.doesNotMatch(port, /sendPrompt|getMessages|toolCall|modelState|compact/u);
    assert.match(port, /must[\s*]+never\s+grow\s+chat\/message\/tool\/model\/history\s+methods/iu);
  }

  interact(workspaceId: WorkspaceModel["id"], marker: string): void {
    assert.equal(this.#attachedWorkspaceId, workspaceId);
    const process = this.process(workspaceId);
    process.transcript += marker;
  }

  assertTranscript(workspaceId: WorkspaceModel["id"], marker: string): void {
    assert.match(this.process(workspaceId).transcript, new RegExp(marker, "u"));
    const backend = this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs");
    assert.match(backend, /TRANSCRIPT_CAP_BYTES:\s*usize\s*=\s*1024\s*\*\s*1024/u);
    assert.match(backend, /VecDeque<u8>/u);
  }

  assertCompositeAccessories(): void {
    const screen = this.source(
      "packages/ui/src/components/PiWorkspaceAgentScreen/PiWorkspaceAgentScreen.tsx",
    );
    for (const tab of ["pi", "changes", "activity", "resources", "sessions"]) {
      assert.match(screen, new RegExp(`id: "${tab}"`, "u"));
    }
  }

  assertInstalledPackages(): void {
    assert.equal(INSTALLED_PACKAGE_FIXTURE.length, 7);
    assert.equal(new Set(INSTALLED_PACKAGE_FIXTURE).size, 7);
    const backend = this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs");
    assert.match(backend, /args\(\["list", "--no-approve"\]\)/u);
    assert.match(backend, /kind:\s*"package"\.to_string\(\)/u);
  }

  assertSessionMetadataOnly(workspaceId: WorkspaceModel["id"]): void {
    const process = this.process(workspaceId);
    assert.equal(process.sessionId, `ide-${workspaceId}`);
    const contract = this.source("packages/contracts/src/pi-workspace-agent.ts");
    assert.match(contract, /Process\/session metadata only/iu);
    assert.doesNotMatch(contract, /interface\s+.*Message|messages:/u);
  }

  switchTo(workspaceId: WorkspaceModel["id"]): void {
    const previous = this.#attachedWorkspaceId;
    this.#activeWorkspaceId = workspaceId;
    this.#attachedWorkspaceId = undefined;
    if (previous) assert.equal(this.process(previous).state, "running");
    this.selectAgent(workspaceId);
  }

  assertDetachedWithoutTermination(workspaceId: WorkspaceModel["id"]): void {
    assert.equal(this.process(workspaceId).state, "running");
    const backend = this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs");
    const detach = backend.slice(
      backend.indexOf("    fn detach("),
      backend.indexOf("    fn stop("),
    );
    assert.doesNotMatch(detach, /kill\(|writer\s*=\s*None|master\s*=\s*None/u);
    assert.match(detach, /no EOF or termination signal was sent/u);
  }

  assertNoLeak(from: WorkspaceModel["id"], to: WorkspaceModel["id"], marker: string): void {
    assert.match(this.process(from).transcript, new RegExp(marker, "u"));
    assert.doesNotMatch(this.process(to).transcript, new RegExp(marker, "u"));
  }

  returnToAAfterB(markerB: string): void {
    this.interact("workspace-b", markerB);
    this.switchTo("workspace-a");
  }

  assertReattachedA(originalPid: number): void {
    assert.equal(this.process("workspace-a").pid, originalPid);
    assert.equal(this.#attachedWorkspaceId, "workspace-a");
  }

  processId(workspaceId: WorkspaceModel["id"]): number {
    return this.process(workspaceId).pid;
  }

  openAFile(): void {
    assert.equal(this.#activeWorkspaceId, "workspace-a");
    this.#openedFile = this.workspace("workspace-a").file;
  }

  assertExistingEditorOpenedAFile(): void {
    assert.equal(this.#openedFile, "a-only.ts");
    const app = this.source("apps/desktop/src/App.tsx");
    assert.match(app, /desktopEditorController\.openFileProgrammatically/u);
    assert.match(app, /<FileTree/u);
    assert.doesNotMatch(
      this.source("apps/desktop/src/features/pi-workspace-agent/usePiWorkspaceAgentController.ts"),
      /createFileTreeStore|createWorkspaceStore/u,
    );
  }

  detachA(): void {
    assert.equal(this.#attachedWorkspaceId, "workspace-a");
    this.#detachedWorkspaceId = "workspace-a";
  }

  assertDetachedPinnedToA(): void {
    assert.equal(this.#detachedWorkspaceId, "workspace-a");
    const backend = this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs");
    assert.match(backend, /DETACHED_WINDOW_LABEL:\s*&str\s*=\s*"pi-agent"/u);
    assert.match(backend, /detached_workspace_id/u);
    assert.match(this.source("apps/desktop/src-tauri/capabilities/default.json"), /"pi-agent"/u);
  }

  closeDetachedAndReopenDocked(): void {
    this.#detachedClosed = true;
    this.#detachedWorkspaceId = undefined;
    this.#attachedWorkspaceId = undefined;
    this.selectAgent("workspace-a");
  }

  assertRunningAfterDetachedClose(originalPid: number): void {
    assert.equal(this.#detachedClosed, true);
    assert.equal(this.process("workspace-a").state, "running");
    assert.equal(this.process("workspace-a").pid, originalPid);
  }

  requestStopA(): void {
    assert.equal(this.process("workspace-a").state, "running");
    this.#stopConfirmationWorkspaceId = "workspace-a";
  }

  assertNamedStopConfirmation(): void {
    assert.equal(this.#stopConfirmationWorkspaceId, "workspace-a");
    const screen = this.source(
      "packages/ui/src/components/PiWorkspaceAgentScreen/PiWorkspaceAgentScreen.tsx",
    );
    assert.match(screen, /Stop Pi for \{workspaceName\}\?/u);
    assert.match(screen, /terminates the live Pi process for this workspace/u);
  }

  cancelStop(): void {
    this.#stopConfirmationWorkspaceId = undefined;
    assert.equal(this.process("workspace-a").state, "running");
  }

  confirmStopA(): void {
    this.#stopConfirmationWorkspaceId = "workspace-a";
    const backend = this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs");
    assert.match(backend, /if !confirmed/u);
    this.process("workspace-a").state = "stopped";
    this.#stopConfirmationWorkspaceId = undefined;
  }

  assertOnlyAStopped(): void {
    assert.equal(this.process("workspace-a").state, "stopped");
    assert.equal(this.process("workspace-b").state, "running");
  }

  restartA(): void {
    const process = this.process("workspace-a");
    assert.equal(process.state, "stopped");
    process.state = "running";
  }

  assertRestoredDeterministicSession(): void {
    assert.equal(this.process("workspace-a").sessionId, "ide-workspace-a");
    const backend = this.source("apps/desktop/src-tauri/src/commands/pi_workspace_agent.rs");
    assert.match(backend, /pi_rpc_session_id_for_workspace_id/u);
  }

  assertNoParallelAuthorities(): void {
    const app = this.source("apps/desktop/src/App.tsx");
    assert.match(app, /workspace=\{workspaceInfo\}/u);
    assert.match(app, /<WorkspaceExplorer/u);
    assert.match(app, /<FileTree/u);
    assert.equal(
      [...this.#sources.keys()].some((path) => /pi.*workspace.*registry/iu.test(path)),
      false,
    );
  }

  private workspace(id: WorkspaceModel["id"]): WorkspaceModel {
    const workspace = this.#workspaces.get(id);
    assert.ok(workspace, `Missing Story workspace ${id}`);
    return workspace;
  }

  private process(id: WorkspaceModel["id"]): ProcessModel {
    const process = this.#processes.get(id);
    assert.ok(process, `Missing Story process ${id}`);
    return process;
  }

  private ensureProcess(id: WorkspaceModel["id"]): ProcessModel {
    const existing = this.#processes.get(id);
    if (existing) return existing;
    const workspace = this.workspace(id);
    const process: ProcessModel = {
      workspaceId: id,
      root: workspace.root,
      sessionId: `ide-${id}`,
      pid: ++this.#nextPid,
      state: "running",
      transcript: "",
    };
    this.#processes.set(id, process);
    return process;
  }

  private source(path: string): string {
    const value = this.#sources.get(path);
    assert.ok(value, `Missing production source evidence ${path}`);
    return value;
  }
}
