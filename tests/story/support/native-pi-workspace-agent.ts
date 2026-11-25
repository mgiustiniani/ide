import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { remote } from "webdriverio";
import { NativeEditorSurface } from "./native-editor-surface.js";

import {
  NativeScenarioEnvironmentLease,
  type NativeScenarioEnvironmentEvidence,
} from "./native-scenario-environment.js";
import type {
  PiWorkspaceAgentStoryDriver,
  PiWorkspaceAgentWorkspaceId,
} from "./pi-workspace-agent.js";

const execFileAsync = promisify(execFile);
const REQUIREMENT = "REQ-PI-WORKSPACE-AGENT-001" as const;
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 25_000;
const UI_TIMEOUT_MS = 15_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const ERROR_ALERT_OBSERVATION_MS = 750;
const DIAGNOSTIC_LIMIT = 24 * 1024;
const PROVIDER_EVENT_CAP_BYTES = 256 * 1024;
const DESIRED_WIDTH = 1440;
const DESIRED_HEIGHT = 900;
const RESIZED_WIDTH = 1280;
const RESIZED_HEIGHT = 760;
const A_MARKER_FILE = "a-only.ts";
const B_MARKER_FILE = "b-only.ts";
const A_FILE_CONTENT = 'export const nativeWorkspaceIdentity = "workspace-a-modified";\n';
const B_FILE_CONTENT = 'export const nativeWorkspaceIdentity = "workspace-b-modified";\n';
const LITERAL_FILE = ":(glob)caffè -> only.ts ";
const LITERAL_CONTENT = 'export const literalIdentity = "literal-modified";\n';
const COMMANDLESS_PACKAGE = "npm:pi-multi-pass";
const INSTALLED_PACKAGES = Object.freeze([
  "skills/multi-agent",
  "npm:@gotgenes/pi-anthropic-auth",
  "local/pi-llm-wiki-epub",
  "npm:pi-kimi-coder",
  "git:github.com/apmantza/pi-free",
  "npm:opencode-pi",
  COMMANDLESS_PACKAGE,
]);
const CUSTOM_ENVIRONMENT_VARIABLES = [
  "PATH",
  "IDE_PI_STORY_EVIDENCE_DIR",
  "IDE_PI_STORY_STATE_DIR",
  "IDE_PI_STORY_PROVIDER_PATH",
] as const;

// Only holds a selected real Git invocation; successful calls execute the system Git unchanged.
const DELAYED_GIT_SOURCE = String.raw`#!/usr/bin/python3
import json, os, sys, time
control = os.path.join(os.path.dirname(__file__), "git-delay.json")
if "diff" in sys.argv[1:]:
    try:
        with open(control) as source:
            settings = json.load(source)
    except FileNotFoundError:
        settings = None
    if settings and os.getcwd() == settings["root"] and sys.argv[-1] == settings["path"]:
        with open(settings["entered"], "w") as output:
            json.dump({"pid": os.getpid(), "cwd": os.getcwd(), "args": sys.argv[1:]}, output)
        time.sleep(30)
os.execv("/usr/bin/git", ["git", *sys.argv[1:]])
`;

const PROVIDER_SOURCE = String.raw`#!/usr/bin/python3
import base64
import json
import os
import select
import signal
import sys
import termios
import tty

EVENT_CAP = 262144
RPC_INPUT_CAP = 65536
HISTORY_CAP = 4096
PACKAGES = [
    "skills/multi-agent",
    "npm:@gotgenes/pi-anthropic-auth",
    "local/pi-llm-wiki-epub",
    "npm:pi-kimi-coder",
    "git:github.com/apmantza/pi-free",
    "npm:opencode-pi",
    "npm:pi-multi-pass",
]

def required_directory(name):
    value = os.environ.get(name, "")
    if not os.path.isabs(value) or not os.path.isdir(value):
        raise SystemExit(name + " must name an existing absolute directory")
    return os.path.realpath(value)

EVIDENCE_DIR = required_directory("IDE_PI_STORY_EVIDENCE_DIR")
STATE_DIR = required_directory("IDE_PI_STORY_STATE_DIR")
IDE_HOME = required_directory("IDE_HOME")
EVENT_FILE = os.path.join(EVIDENCE_DIR, "pi-provider-events.jsonl")

def append_event(event, **fields):
    try:
        current = os.path.getsize(EVENT_FILE) if os.path.exists(EVENT_FILE) else 0
        if current >= EVENT_CAP:
            return
        record = {
            "event": event,
            "pid": os.getpid(),
            "ppid": os.getppid(),
            "cwd": os.path.realpath(os.getcwd()),
            "args": sys.argv[1:],
            **fields,
        }
        encoded = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        if current + len(encoded) > EVENT_CAP:
            return
        descriptor = os.open(EVENT_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(descriptor, encoded)
        finally:
            os.close(descriptor)
    except Exception:
        pass

def emit_output(data):
    append_event("provider-output", dataBase64=base64.b64encode(data).decode("ascii"), length=len(data))
    os.write(1, data)

def safe_session_name(session_id):
    if not session_id or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_." for character in session_id):
        raise SystemExit("invalid session id")
    return session_id

def session_state_path(session_id):
    return os.path.join(STATE_DIR, safe_session_name(session_id) + ".json")

def read_history(session_id):
    state_path = session_state_path(session_id)
    try:
        with open(state_path, "r", encoding="utf-8") as stream:
            value = json.load(stream)
        return base64.b64decode(value.get("historyBase64", ""), validate=True)[-HISTORY_CAP:]
    except Exception:
        return b""

def write_history(session_id, history):
    state_path = session_state_path(session_id)
    temporary = state_path + "." + str(os.getpid()) + ".tmp"
    value = {
        "sessionId": session_id,
        "historyBase64": base64.b64encode(history[-HISTORY_CAP:]).decode("ascii"),
    }
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, separators=(",", ":"))
        stream.write("\n")
    os.replace(temporary, state_path)

def display_tail(history):
    result = []
    for value in history[-160:]:
        if 32 <= value <= 126:
            result.append(chr(value))
        elif value == 13:
            result.append("<CR>")
        elif value == 10:
            result.append("<LF>")
        elif value == 27:
            result.append("<ESC>")
        else:
            result.append("<" + format(value, "02x") + ">")
    return "".join(result)

def terminal_size():
    try:
        size = os.get_terminal_size(0)
        return {"cols": size.columns, "rows": size.lines}
    except OSError:
        return {"cols": 0, "rows": 0}

def interactive(session_id):
    session_id = safe_session_name(session_id)
    history = read_history(session_id)
    restored = len(history) > 0
    append_event(
        "interactive-start",
        mode="interactive",
        sessionId=session_id,
        statePath=session_state_path(session_id),
        restored=restored,
        terminalSize=terminal_size(),
    )
    emit_output(("\x1b[36mPI_STORY_READY session=" + session_id + " cwd=" + os.path.realpath(os.getcwd()) + "\x1b[0m\r\n").encode("utf-8"))
    if restored:
        emit_output(("\x1b[35mPI_STORY_RESTORED session=" + session_id + " history=" + display_tail(history) + "\x1b[0m\r\n").encode("utf-8"))
    previous = termios.tcgetattr(0)
    tty.setraw(0)
    last_size = terminal_size()
    append_event("terminal-size", mode="interactive", sessionId=session_id, **last_size)
    try:
        while True:
            current_size = terminal_size()
            if current_size != last_size:
                last_size = current_size
                append_event("terminal-size", mode="interactive", sessionId=session_id, **current_size)
            readable, _, _ = select.select([0], [], [], 0.1)
            if not readable:
                continue
            data = os.read(0, 4096)
            if not data:
                append_event("interactive-eof", mode="interactive", sessionId=session_id)
                break
            history = (history + data)[-HISTORY_CAP:]
            write_history(session_id, history)
            append_event(
                "terminal-input",
                mode="interactive",
                sessionId=session_id,
                dataBase64=base64.b64encode(data).decode("ascii"),
                hex=data.hex(),
                length=len(data),
            )
            rendered = ("\x1b[32mPI_STORY_ECHO " + display_tail(history) + "\x1b[0m\r\n").encode("utf-8")
            emit_output(rendered)
    finally:
        termios.tcsetattr(0, termios.TCSANOW, previous)
    append_event("interactive-exit", mode="interactive", sessionId=session_id)
    return 0

def package_list():
    append_event("package-list", mode="package-list", packageNames=PACKAGES)
    lines = ["User packages:"]
    for index, name in enumerate(PACKAGES):
        lines.append("  " + name)
        lines.append("    " + os.path.join(IDE_HOME, "pi-story-packages", str(index)))
    output = ("\n".join(lines) + "\n").encode("utf-8")
    append_event("provider-output", mode="package-list", dataBase64=base64.b64encode(output).decode("ascii"), length=len(output))
    os.write(1, output)
    return 0

def rpc_commands():
    request = sys.stdin.buffer.read(RPC_INPUT_CAP + 1)
    if len(request) > RPC_INPUT_CAP:
        append_event("rpc-rejected", mode="rpc-commands", reason="input-cap")
        return 2
    append_event("rpc-request", mode="rpc-commands", requestBase64=base64.b64encode(request).decode("ascii"), length=len(request))
    commands = [
        {"name": "multi-agent", "description": "Deterministic Story command", "source": "skill", "location": "user", "path": os.path.join(IDE_HOME, "pi-story-commands", "multi-agent", "SKILL.md")},
        {"name": "wiki", "description": "Deterministic Story command", "source": "extension", "location": "user", "path": os.path.join(IDE_HOME, "pi-story-commands", "wiki.ts")},
        {"name": "review", "description": "Deterministic Story command", "source": "prompt", "location": "project", "path": os.path.join(IDE_HOME, "pi-story-commands", "review.md")},
    ]
    response = {"type": "response", "command": "get_commands", "success": True, "data": {"commands": commands}}
    output = (json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    append_event("rpc-response", mode="rpc-commands", commandNames=[item["name"] for item in commands], dataBase64=base64.b64encode(output).decode("ascii"))
    os.write(1, output)
    return 0

def main():
    args = sys.argv[1:]
    append_event("invocation", executable=os.path.realpath(sys.argv[0]))
    if len(args) == 2 and args[0] == "--session-id":
        return interactive(args[1])
    if args == ["list", "--no-approve"]:
        return package_list()
    if args == ["--mode", "rpc", "--no-session", "--no-approve"]:
        return rpc_commands()
    if args == ["--version"]:
        append_event("version", mode="version")
        os.write(1, b"pi-story-provider 1.0.0\n")
        return 0
    append_event("unsupported-invocation", mode="unsupported")
    os.write(2, b"unsupported deterministic Pi Story invocation\n")
    return 64

if __name__ == "__main__":
    raise SystemExit(main())
`;

type Browser = Awaited<ReturnType<typeof remote>>;
type DriverExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type ProviderEvent = Readonly<Record<string, unknown>> & {
  readonly event: string;
  readonly pid: number;
  readonly cwd: string;
  readonly args: readonly string[];
};

interface WorkspaceFixture {
  readonly id: PiWorkspaceAgentWorkspaceId;
  readonly name: "workspace-a" | "workspace-b";
  readonly root: string;
  readonly fileName: typeof A_MARKER_FILE | typeof B_MARKER_FILE;
  readonly content: string;
}

type PiAgentErrorAlertCheckpoint =
  | "stable-agent-attach-a"
  | "raw-transport-a"
  | "workspace-switch-b"
  | "workspace-return-a"
  | "detached-attach-a"
  | "docked-reopen-a"
  | "restart-a";

interface PiAgentErrorAlertDomSnapshot {
  readonly text: string;
  readonly outerHtml: string;
  readonly ariaLive: string | null;
  readonly className: string;
}

interface NativePiEvidence {
  readonly requirement: typeof REQUIREMENT;
  readonly declaredStatus: "implemented-and-validated";
  readonly target: "desktop/tauri-webdriver";
  readonly kind: "tauri-webdriver";
  readonly artifactKind: "release-no-bundle";
  readonly nativeGui: true;
  readonly e2e: true;
  readonly packagedApplication: false;
  scenarioEnvironment?: Readonly<NativeScenarioEnvironmentEvidence>;
  artifactDirectory?: string;
  application?: {
    readonly executable: string;
    readonly processId: number;
    readonly mainWindowHandle: string;
    detachedWindowHandle?: string;
  };
  provider?: {
    readonly executable: string;
    readonly sha256: string;
    readonly mode: number;
    readonly pathFirstEntry: string;
    readonly eventFile: string;
    readonly stateDirectory: string;
    readonly eventCapBytes: number;
    readonly installedPackages: readonly string[];
    readonly commandlessPackage: string;
  };
  workspaces?: readonly {
    readonly id: PiWorkspaceAgentWorkspaceId;
    readonly root: string;
    readonly file: string;
  }[];
  processes: Partial<Record<PiWorkspaceAgentWorkspaceId, readonly number[]>>;
  ui: {
    registryAndFiles: boolean;
    rawTerminal: boolean;
    accessories: boolean;
    resources: boolean;
    sessionsRootless: boolean;
    workspaceSwitches: boolean;
    editorOpened: boolean;
    detachedWindow: boolean;
    stopConfirmation: boolean;
    restartHistory: boolean;
  };
  gitReview?: {
    readonly literalPathOpened: true;
    readonly editorResponsiveWhileGitPending: true;
    readonly timeoutVisible: true;
    readonly timedOutProcessExited: true;
    readonly dirtyBufferPreserved: true;
    readonly diskAndIndexPreserved: true;
    readonly undoRedoTracksSavedText: true;
  };
  rawTransport?: {
    readonly keyboard: true;
    readonly paste: true;
    readonly shiftEnter: true;
    readonly altEnter: true;
    readonly ansiOutput: true;
    readonly resize: true;
    readonly terminalDomTextExposed: boolean;
  };
  isolation?: {
    readonly aMarkerAbsentFromB: true;
    readonly bMarkerAbsentFromA: true;
    readonly rootsDistinct: true;
  };
  screenshots: string[];
  cleanup?: {
    applicationExited: boolean;
    driverExited: boolean;
    providerSurvivorProcessIds: number[];
    environmentRestored: boolean;
    scenarioChildRemoved: boolean;
  };
  readonly limits: readonly string[];
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native Pi Agent Story requires absolute ${name}`);
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
        reject(new Error("Could not reserve a native Pi Agent Story TCP port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function processRunning(processId: number): Promise<boolean> {
  try {
    const value = await readFile(`/proc/${processId}/stat`, "utf8");
    const close = value.lastIndexOf(")");
    return close >= 0 && value.slice(close + 2, close + 3) !== "Z";
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
      // A process may exit between discovery and inspection.
    }
  }
  return undefined;
}

async function stopProcess(processId: number): Promise<void> {
  if (!(await processRunning(processId))) return;
  try {
    process.kill(processId, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 1_000;
  while ((await processRunning(processId)) && Date.now() < deadline) await wait(25);
  if (!(await processRunning(processId))) return;
  try {
    process.kill(processId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function decodedEventData(event: ProviderEvent): Buffer {
  const value = event.dataBase64;
  return typeof value === "string" ? Buffer.from(value, "base64") : Buffer.alloc(0);
}

/**
 * Linux release/no-bundle Story driver. It controls the production Tauri WebViews only;
 * the deterministic executable substitutes Pi/provider behavior, never IDE/controller/IPC/PTY state.
 */
export class NativePiWorkspaceAgentStorySession implements PiWorkspaceAgentStoryDriver {
  readonly #sandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #evidence: NativePiEvidence = {
    requirement: REQUIREMENT,
    declaredStatus: "implemented-and-validated",
    target: "desktop/tauri-webdriver",
    kind: "tauri-webdriver",
    artifactKind: "release-no-bundle",
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    processes: {},
    ui: {
      registryAndFiles: false,
      rawTerminal: false,
      accessories: false,
      resources: false,
      sessionsRootless: false,
      workspaceSwitches: false,
      editorOpened: false,
      detachedWindow: false,
      stopConfirmation: false,
      restartHistory: false,
    },
    screenshots: [],
    limits: [
      "deterministic Pi test provider",
      "release/no-bundle Tauri executable",
      "Linux X11 WebKit target",
      "not an application package or installer",
      "not a real external Pi provider",
      "not cross-platform evidence",
      "not manual accessibility or IME evidence",
    ],
  };
  readonly #originalEnvironment = new Map<string, string | undefined>();
  #lease?: NativeScenarioEnvironmentLease;
  #workspaces = new Map<PiWorkspaceAgentWorkspaceId, WorkspaceFixture>();
  #artifactDirectory?: string;
  #providerDirectory?: string;
  #providerPath?: string;
  #providerEventFile?: string;
  #providerStateDirectory?: string;
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Browser;
  #applicationProcessId?: number;
  #mainWindowHandle?: string;
  #detachedWindowHandle?: string;
  #activeWorkspaceId: PiWorkspaceAgentWorkspaceId = "workspace-a";
  #processIds = new Map<PiWorkspaceAgentWorkspaceId, number[]>();
  #markers = new Map<PiWorkspaceAgentWorkspaceId, string[]>();
  #dockedAgentRect?: { x: number; y: number; width: number; height: number };
  #terminalDomTextExposed = false;
  #sessionDeleted = false;
  #disposed = false;

  async start(): Promise<void> {
    assert.equal(process.platform, "linux", "native Pi Agent Story is Linux-targeted");
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(this.#lease, undefined, "native Pi Agent Story session already started");
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT, {
      workspaceName: "workspace-a",
    });
    try {
      await this.#lease.assertConfiguredPathsConfined();
      await this.#prepareScenario();
      await this.#launchApplication();
      await this.#waitForWorkspace("workspace-a");
      await this.#writeEvidence();
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  evidence(): Readonly<Record<string, unknown>> {
    return {
      ...this.#evidence,
      scenarioEnvironment: this.#lease?.evidence() ?? this.#evidence.scenarioEnvironment,
      processes: Object.fromEntries(
        [...this.#processIds].map(([workspaceId, processIds]) => [workspaceId, [...processIds]]),
      ),
      screenshots: [...this.#evidence.screenshots],
    };
  }

  redactedDiagnostics(): string {
    return this.#driverDiagnostic
      .replaceAll(this.#sandbox, "<SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>")
      .replace(/\b(password|token|secret)=\S+/giu, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'"]+\/?)+/gu, "<PATH>")
      .slice(-DIAGNOSTIC_LIMIT);
  }

  async assertRegistryAndFiles(): Promise<void> {
    const browser = this.browser();
    await this.#switchToMainWindow();
    await this.#clickActivity("Files");
    const list = await browser.$('[role="listbox"][aria-label="Registered workspaces"]');
    await list.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    const options = Array.from(await list.$$('[role="option"]').getElements());
    const optionTitles = await Promise.all(
      options.map(async (option) => await option.getAttribute("title")),
    );
    assert.equal(optionTitles.length, 2);
    assert.ok(optionTitles.some((title) => title?.startsWith("workspace-a\n")));
    assert.ok(optionTitles.some((title) => title?.startsWith("workspace-b\n")));
    await this.#assertFileVisible("workspace-a");

    const registry = JSON.parse(
      await readFile(path.join(this.lease().paths.ideHome, "workspaces.json"), "utf8"),
    ) as {
      currentWorkspaceId: string;
      workspaces: Array<{ id: string; rootPath: string }>;
    };
    assert.equal(registry.currentWorkspaceId, "workspace-a");
    assert.deepEqual(registry.workspaces.map(({ id }) => id).sort(), [
      "workspace-a",
      "workspace-b",
    ]);
    for (const workspace of this.#workspaces.values()) {
      assert.equal(
        registry.workspaces.find(({ id }) => id === workspace.id)?.rootPath,
        workspace.root,
      );
    }
    this.#evidence.ui.registryAndFiles = true;
  }

  async assertFixedPiPtyAvailable(): Promise<void> {
    const providerPath = this.providerPath();
    const provider = await stat(providerPath);
    assert.equal(provider.isFile(), true);
    assert.equal(provider.mode & 0o777, 0o700);
    assert.equal(process.env.PATH?.split(path.delimiter)[0], path.dirname(providerPath));
    assert.equal(await realpath(providerPath), providerPath);
    const manifest = JSON.parse(
      await readFile(path.join(this.artifactDirectory(), "provider-manifest.json"), "utf8"),
    ) as { executable: string; pathFirstEntry: string; sha256: string };
    assert.equal(manifest.executable, providerPath);
    assert.equal(manifest.pathFirstEntry, path.dirname(providerPath));
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/u);
  }

  async selectAgent(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    assert.equal(this.#activeWorkspaceId, workspaceId);
    await this.#switchToMainWindow();
    await this.#clickActivity("Agent");
    await this.#waitForAgent(workspaceId, "Running");
    const starts = await this.#waitForInteractiveStarts(workspaceId, 1);
    const processId = Number(starts.at(-1)?.pid);
    assert.ok(Number.isInteger(processId) && processId > 1);
    this.#recordProcessId(workspaceId, processId);
    await this.#capture(`agent-${workspaceId}`);
  }

  async assertAttachedToExactRoot(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    const workspace = this.workspace(workspaceId);
    const screen = await this.#agentScreen(workspaceId);
    assert.equal(await screen.getAttribute("data-workspace-id"), workspaceId);
    assert.match(await this.#domText(screen), new RegExp(`Running · ide-${workspaceId}`, "u"));
    const start = (await this.#interactiveStarts(workspaceId)).at(-1);
    assert.ok(start, `missing native Pi start for ${workspaceId}`);
    assert.equal(start.cwd, workspace.root);
    assert.equal(start.sessionId, `ide-${workspaceId}`);
    assert.equal(await processRunning(Number(start.pid)), true);
    await this.#assertNoUnexpectedPiAgentErrorAlert(
      workspaceId === "workspace-a" ? "stable-agent-attach-a" : "workspace-switch-b",
    );
  }

  async assertRawTransport(): Promise<void> {
    assert.equal(this.#activeWorkspaceId, "workspace-a");
    await this.#clickAgentTab("Pi");
    const host = await this.#terminalHost();
    const before = await host.getSize();
    assert.ok(before.width > 0 && before.height > 0);
    await this.#focusTerminal();
    await this.browser().keys("RAW-KEYBOARD-A");
    await this.#pasteIntoTerminal("|RAW-PASTE-A|");
    await this.#dispatchModifiedEnter("shift");
    await this.#dispatchModifiedEnter("alt");
    await this.browser().keys(["Enter"]);

    await this.#waitForRawBytes("workspace-a", Buffer.from("RAW-KEYBOARD-A"));
    await this.#waitForRawBytes("workspace-a", Buffer.from("|RAW-PASTE-A|"));
    await this.#waitForRawBytes("workspace-a", Buffer.from("\u001b[13;2u"));
    await this.#waitForRawBytes("workspace-a", Buffer.from("\u001b[13;3u"));

    const sizesBefore = await this.#terminalSizes("workspace-a");
    await this.browser().setWindowSize(RESIZED_WIDTH, RESIZED_HEIGHT);
    await this.browser().waitUntil(
      async () => {
        const next = await host.getSize();
        return next.width !== before.width || next.height !== before.height;
      },
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "xterm host did not resize with its Tauri window",
      },
    );
    await this.browser().waitUntil(
      async () => (await this.#terminalSizes("workspace-a")).length > sizesBefore.length,
      { timeout: 5_000, interval: 50, timeoutMsg: "native PTY did not observe smaller xterm size" },
    );
    const resizedSizeCount = (await this.#terminalSizes("workspace-a")).length;
    await this.browser().setWindowSize(DESIRED_WIDTH, DESIRED_HEIGHT);
    await this.browser().waitUntil(
      async () => (await this.#terminalSizes("workspace-a")).length > resizedSizeCount,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "native PTY did not observe restored xterm size",
      },
    );
    const sizes = await this.#terminalSizes("workspace-a");
    assert.ok(
      new Set(sizes.map(({ cols, rows }) => `${cols}x${rows}`)).size > 1,
      "native PTY size evidence did not change",
    );

    const output = (await this.#providerEvents()).filter(
      (event) =>
        event.event === "provider-output" && event.cwd === this.workspace("workspace-a").root,
    );
    assert.ok(output.some((event) => decodedEventData(event).includes(Buffer.from("\u001b[36m"))));
    const terminalText = await this.#terminalText();
    this.#terminalDomTextExposed = terminalText.length > 0;
    if (terminalText.length > 0) assert.match(terminalText, /PI_STORY_(?:READY|ECHO)/u);
    await this.#capture("raw-transport-a");
    await this.#assertNoUnexpectedPiAgentErrorAlert("raw-transport-a");
    this.#evidence.ui.rawTerminal = true;
    this.#evidence.rawTransport = {
      keyboard: true,
      paste: true,
      shiftEnter: true,
      altEnter: true,
      ansiOutput: true,
      resize: true,
      terminalDomTextExposed: this.#terminalDomTextExposed,
    };
  }

  async assertPiOwnsConversation(): Promise<void> {
    const screen = await this.#agentScreen(this.#activeWorkspaceId);
    const text = await this.#domText(screen);
    assert.match(text, /Native Pi TUI · view attachment only/u);
    assert.doesNotMatch(text, /Send prompt|Choose model|Trust tool|Compact history/iu);
    const textInputs = await screen.$$(
      'input:not([type="hidden"]), textarea:not(.xterm-helper-textarea)',
    );
    assert.equal(textInputs.length, 0, "Agent screen exposed a synthetic non-xterm prompt");
    const interactive = await this.#interactiveStarts(this.#activeWorkspaceId);
    assert.deepEqual(interactive.at(-1)?.args, ["--session-id", `ide-${this.#activeWorkspaceId}`]);
  }

  async interact(workspaceId: PiWorkspaceAgentWorkspaceId, marker: string): Promise<void> {
    assert.equal(this.#activeWorkspaceId, workspaceId);
    assert.match(marker, /^[AB]-DISTINCTIVE$/u);
    await this.#clickAgentTab("Pi");
    await this.#pasteIntoTerminal(marker);
    await this.browser().keys(["Enter"]);
    await this.#waitForRawBytes(workspaceId, Buffer.from(marker));
    const markers = this.#markers.get(workspaceId) ?? [];
    markers.push(marker);
    this.#markers.set(workspaceId, markers);
    const text = await this.#terminalText();
    if (text.length > 0) assert.ok(this.#logicalTerminalText(text).includes(marker));
    await this.#capture(`interaction-${workspaceId}`);
  }

  async assertTranscript(workspaceId: PiWorkspaceAgentWorkspaceId, marker: string): Promise<void> {
    const history = await this.#providerHistory(workspaceId);
    assert.ok(
      history.includes(Buffer.from(marker)),
      `${workspaceId} provider history lost ${marker}`,
    );
    const output = (await this.#providerEvents())
      .filter(
        (event) =>
          event.event === "provider-output" && event.cwd === this.workspace(workspaceId).root,
      )
      .map(decodedEventData);
    assert.ok(output.some((data) => data.includes(Buffer.from(marker))));
    if (this.#activeWorkspaceId === workspaceId) {
      await this.#clickAgentTab("Pi");
      const text = await this.#terminalText();
      if (text.length > 0) assert.ok(this.#logicalTerminalText(text).includes(marker));
      await this.#capture(`transcript-${workspaceId}`);
    }
  }

  async assertCompositeAccessories(): Promise<void> {
    const screen = await this.#agentScreen(this.#activeWorkspaceId);
    for (const label of ["Pi", "Changes", "Activity", "Resources", "Sessions"]) {
      const tab = await screen.$(`[role="tab"]=${label}`);
      await tab.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    }

    await this.#clickAgentTab("Changes");
    const changes = await this.#agentPanel("changes");
    await this.browser().waitUntil(async () => (await this.#domText(changes)).includes("only.ts"), {
      timeout: UI_TIMEOUT_MS,
      interval: 50,
      timeoutMsg: "production Changes accessory did not expose the workspace fixture",
    });
    const fixture = this.workspace(this.#activeWorkspaceId);
    const review = await changes.$(`[aria-label="Read-only diff for ${fixture.fileName}"]`);
    await review.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    const patch = await this.#domText(review);
    assert.ok(patch.includes(`${fixture.id}-baseline`), "real Git old content missing");
    assert.ok(patch.includes(`${fixture.id}-modified`), "real Git new content missing");
    const openRange = await review.$('button[aria-label^="Open range "]');
    await openRange.click();
    const tab = await this.browser().$(`[role="tab"][data-path="${fixture.fileName}"]`);
    await this.browser().waitUntil(async () => (await tab.getAttribute("aria-selected")) === "true", {
      timeout: UI_TIMEOUT_MS, interval: 50, timeoutMsg: "Git hunk did not open its source in the editor",
    });
    assert.equal(await readFile(path.join(fixture.root, fixture.fileName), "utf8"), fixture.content);
    await this.#assertBoundedGitReview();
    await this.#clickAgentTab("Activity");
    const activity = await this.#agentPanel("activity");
    await this.browser().waitUntil(
      async () => /started|attached/iu.test(await this.#domText(activity)),
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: "production Activity accessory did not expose PTY attachment lifecycle",
      },
    );
    await this.#clickAgentTab("Resources");
    await this.#waitForInstalledPackages();
    await this.#clickAgentTab("Sessions");
    const sessions = await this.#agentPanel("sessions");
    await this.browser().waitUntil(
      async () => (await this.#domText(sessions)).includes(`ide-${this.#activeWorkspaceId}`),
      { timeout: UI_TIMEOUT_MS, interval: 50, timeoutMsg: "Sessions accessory remained empty" },
    );
    await this.#clickAgentTab("Pi");
    this.#evidence.ui.accessories = true;
  }

  async #assertBoundedGitReview(): Promise<void> {
    assert.equal(this.#activeWorkspaceId, "workspace-a");
    const browser = this.browser(), fixture = this.workspace("workspace-a");
    const surface = new NativeEditorSurface(this);
    const indexPath = path.join(fixture.root, ".git/index");
    const indexBefore = await readFile(indexPath);
    const changes = await this.#agentPanel("changes");
    const literalReview = await changes.$(`[aria-label="Read-only diff for ${cssAttribute(LITERAL_FILE)}"]`);
    await literalReview.waitForDisplayed({ timeout: UI_TIMEOUT_MS });
    assert.match(await this.#domText(literalReview), /literal-baseline/u);
    assert.match(await this.#domText(literalReview), /literal-modified/u);
    assert.doesNotMatch(await this.#domText(literalReview), /workspace-a-modified/u);
    await literalReview.$('button[aria-label^="Open range "]').click();
    const literalTab = await browser.$(`[role="tab"][data-path="${cssAttribute(LITERAL_FILE)}"]`);
    await browser.waitUntil(async () => (await literalTab.getAttribute("aria-selected")) === "true", { timeout: 3000 });

    const entered = path.join(this.#artifactDirectory!, "git-delay-entered.json");
    const control = path.join(this.#providerDirectory!, "git-delay.json");
    await writeFile(control, JSON.stringify({ root: fixture.root, path: fixture.fileName, entered }));
    let delayedPid: number | undefined;
    let dirtyContent = "";
    try {
      await browser.$('button[aria-label="Refresh Agent accessory metadata"]').click();
      await browser.waitUntil(async () => { try { await access(entered); return true; } catch { return false; } }, { timeout: 3000 });
      const invocation = JSON.parse(await readFile(entered, "utf8")) as { pid: number; cwd: string; args: string[] };
      assert.equal(invocation.cwd, fixture.root);
      assert.equal(invocation.args.at(-1), fixture.fileName);
      delayedPid = invocation.pid;
      const tab = await browser.$(`[role="tab"][data-path="${fixture.fileName}"]`);
      await tab.click();
      await browser.waitUntil(async () => (await tab.getAttribute("aria-selected")) === "true", { timeout: 2000 });
      assert.equal(await processRunning(delayedPid), true, "Git completed before the responsiveness observation");
      await surface.focus(fixture.fileName);
      await browser.keys(["Control", "End"]);
      await browser.keys("// Git review dirty draft");
      await tab.$('[aria-label="Unsaved changes"]').waitForExist({ timeout: 2000 });
      dirtyContent = await surface.renderedText({ file: fixture.fileName });
      assert.match(dirtyContent, /Git review dirty draft/u);
      await browser.waitUntil(async () => /Diff review unavailable:.*timed out/u.test(await this.#domText(changes)), { timeout: 6500 });
      await browser.waitUntil(async () => !(await processRunning(delayedPid!)), { timeout: 2000 });
      assert.equal(await readFile(path.join(fixture.root, fixture.fileName), "utf8"), fixture.content);
    } finally {
      await rm(control, { force: true });
      if (delayedPid && await processRunning(delayedPid)) await stopProcess(delayedPid);
    }
    await browser.$('button[aria-label="Refresh Agent accessory metadata"]').click();
    const review = await changes.$(`[aria-label="Read-only diff for ${fixture.fileName}"]`);
    await review.waitForDisplayed({ timeout: UI_TIMEOUT_MS });
    await review.$('button[aria-label^="Open range "]').click();
    const editor = await browser.$(`[role="textbox"][aria-label="Code editor for ${fixture.fileName}"]`);
    await editor.waitForDisplayed({ timeout: 3000 });
    await surface.assertBuffer(fixture.fileName, dirtyContent);
    await surface.assertDirty(fixture.fileName, true);
    await surface.focus(fixture.fileName);
    let undoCount = 0;
    for (; undoCount < 32;) {
      await browser.keys(["Control", "z"]);
      undoCount += 1;
      if (await surface.renderedText({ file: fixture.fileName }) === fixture.content) break;
      await surface.assertDirty(fixture.fileName, true);
    }
    await surface.assertBuffer(fixture.fileName, fixture.content);
    await surface.assertDirty(fixture.fileName, false);
    for (let index = 0; index < undoCount; index += 1) await browser.keys(["Control", "y"]);
    await surface.assertBuffer(fixture.fileName, dirtyContent);
    await surface.assertDirty(fixture.fileName, true);
    assert.equal(await readFile(path.join(fixture.root, fixture.fileName), "utf8"), fixture.content);
    await surface.discardUsingDisk(fixture.fileName, fixture.content, { expectedBuffer: dirtyContent });
    assert.equal(await readFile(path.join(fixture.root, fixture.fileName), "utf8"), fixture.content);
    await surface.assertBuffer(fixture.fileName, fixture.content);
    assert.equal(await readFile(path.join(fixture.root, LITERAL_FILE), "utf8"), LITERAL_CONTENT);
    assert.deepEqual(await readFile(indexPath), indexBefore);
    this.#evidence.gitReview = { literalPathOpened: true, editorResponsiveWhileGitPending: true, timeoutVisible: true, timedOutProcessExited: true, dirtyBufferPreserved: true, diskAndIndexPreserved: true, undoRedoTracksSavedText: true };
    await this.#capture("bounded-git-review-and-dirty-buffer");
  }

  async assertInstalledPackages(): Promise<void> {
    await this.#clickAgentTab("Resources");
    const panel = await this.#waitForInstalledPackages();
    const text = await this.#domText(panel);
    for (const packageName of INSTALLED_PACKAGES)
      assert.match(text, new RegExp(this.#escape(packageName), "u"));
    assert.match(text, /7 packages · 3 commands/u);
    const items = Array.from(
      await panel.$$('ol[aria-label="Installed Pi packages and commands"] > li').getElements(),
    );
    const itemTexts = await Promise.all(items.map(async (item) => await this.#domText(item)));
    const commandless = itemTexts.filter((item) => item.includes(COMMANDLESS_PACKAGE));
    assert.equal(commandless.length, 1);
    assert.match(commandless[0] ?? "", /package · user/u);
    assert.doesNotMatch(commandless[0] ?? "", /command ·/u);

    const events = await this.#providerEvents();
    const packageEvents = events.filter((event) => event.event === "package-list");
    assert.ok(packageEvents.length > 0);
    assert.ok(
      packageEvents.some(
        (event) => JSON.stringify(event.packageNames) === JSON.stringify(INSTALLED_PACKAGES),
      ),
    );
    const rpcRequests = events.filter((event) => event.event === "rpc-request");
    assert.ok(rpcRequests.length > 0);
    for (const event of rpcRequests) {
      assert.deepEqual(event.args, ["--mode", "rpc", "--no-session", "--no-approve"]);
      assert.equal(
        decodedEventData({ ...event, dataBase64: event.requestBase64 } as ProviderEvent).toString(
          "utf8",
        ),
        '{"type":"get_commands"}\n',
      );
    }
    this.#evidence.ui.resources = true;
  }

  async assertSessionMetadataOnly(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    await this.#clickAgentTab("Sessions");
    const panel = await this.#agentPanel("sessions");
    await this.browser().waitUntil(
      async () => (await this.#domText(panel)).includes(`ide-${workspaceId}`),
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: `missing ${workspaceId} session summary`,
      },
    );
    const text = await this.#domText(panel);
    assert.match(text, new RegExp(`ide-${workspaceId}`, "u"));
    assert.doesNotMatch(text, new RegExp(this.#escape(this.workspace(workspaceId).root), "u"));
    for (const marker of ["A-DISTINCTIVE", "B-DISTINCTIVE", "PI_STORY_ECHO"]) {
      assert.doesNotMatch(text, new RegExp(marker, "u"));
    }
    const sessionItems = await panel
      .$$('ol[aria-label="Workspace Pi sessions"] > li')
      .getElements();
    assert.ok(sessionItems.length >= 1 && sessionItems.length <= 2);
    this.#evidence.ui.sessionsRootless = true;
  }

  async switchTo(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    await this.#switchWorkspaceThroughExplorer(workspaceId);
    await this.#clickActivity("Agent");
    await this.#waitForAgent(workspaceId, "Running");
    const starts = await this.#waitForInteractiveStarts(workspaceId, 1);
    this.#recordProcessId(workspaceId, Number(starts.at(-1)?.pid));
    this.#evidence.ui.workspaceSwitches = true;
    await this.#capture(`switched-${workspaceId}`);
  }

  async assertDetachedWithoutTermination(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    const processId = await this.processId(workspaceId);
    assert.equal(await processRunning(processId), true);
    const events = await this.#providerEvents();
    assert.equal(
      events.some(
        (event) =>
          event.pid === processId &&
          (event.event === "interactive-eof" || event.event === "interactive-exit"),
      ),
      false,
    );
  }

  async assertNoLeak(
    from: PiWorkspaceAgentWorkspaceId,
    to: PiWorkspaceAgentWorkspaceId,
    marker: string,
  ): Promise<void> {
    const fromBytes = await this.#rawInput(from);
    const toBytes = await this.#rawInput(to);
    assert.ok(fromBytes.includes(Buffer.from(marker)), `${from} does not contain ${marker}`);
    assert.equal(toBytes.includes(Buffer.from(marker)), false, `${marker} crossed into ${to}`);
    assert.notEqual(this.workspace(from).root, this.workspace(to).root);
    if (this.#activeWorkspaceId === to) {
      await this.#clickAgentTab("Pi");
      const text = await this.#terminalText();
      if (text.length > 0) assert.equal(this.#logicalTerminalText(text).includes(marker), false);
    }
    const aBytes = await this.#rawInput("workspace-a");
    const bBytes = await this.#rawInput("workspace-b");
    if (
      aBytes.includes(Buffer.from("A-DISTINCTIVE")) &&
      bBytes.includes(Buffer.from("B-DISTINCTIVE"))
    ) {
      assert.equal(aBytes.includes(Buffer.from("B-DISTINCTIVE")), false);
      assert.equal(bBytes.includes(Buffer.from("A-DISTINCTIVE")), false);
      this.#evidence.isolation = {
        aMarkerAbsentFromB: true,
        bMarkerAbsentFromA: true,
        rootsDistinct: true,
      };
    }
  }

  async returnToAAfterB(markerB: string): Promise<void> {
    await this.interact("workspace-b", markerB);
    await this.#switchWorkspaceThroughExplorer("workspace-a");
    await this.#clickActivity("Agent");
    await this.#waitForAgent("workspace-a", "Running");
    this.#activeWorkspaceId = "workspace-a";
    await this.#assertNoUnexpectedPiAgentErrorAlert("workspace-return-a");
    await this.#capture("returned-workspace-a");
  }

  async assertReattachedA(originalPid: number): Promise<void> {
    assert.equal(await this.processId("workspace-a"), originalPid);
    assert.equal(await processRunning(originalPid), true);
    assert.equal((await this.#interactiveStarts("workspace-a")).length, 1);
    const screen = await this.#agentScreen("workspace-a");
    assert.match(await this.#domText(screen), /Running · ide-workspace-a/u);
  }

  async processId(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<number> {
    const processIds = this.#processIds.get(workspaceId) ?? [];
    const processId = processIds.at(-1);
    assert.ok(processId, `missing ${workspaceId} Pi process ID`);
    return processId;
  }

  async openAFile(): Promise<void> {
    assert.equal(this.#activeWorkspaceId, "workspace-a");
    await this.#clickActivity("Files");
    const item = await this.#fileItem(A_MARKER_FILE);
    await item.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    await item.click();
  }

  async assertExistingEditorOpenedAFile(): Promise<void> {
    const browser = this.browser();
    const tab = await browser.$(`[role="tab"][data-path="${A_MARKER_FILE}"]`);
    await browser.waitUntil(
      async () => (await tab.isDisplayed()) && (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: "existing editor did not open A fixture",
      },
    );
    const editor = await browser.$(
      `[role="textbox"][aria-label^="Code editor for ${A_MARKER_FILE}"]`,
    );
    await editor.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    let observedValue = "";
    let observedRendered = "";
    try {
      await browser.waitUntil(
        async () => {
          observedValue = await editor.getValue();
          observedRendered = await browser.execute(() =>
            Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"))
              .map((line) => line.textContent ?? "")
              .join("\n")
              .replaceAll("\u00a0", " "),
          );
          return observedValue === A_FILE_CONTENT || observedRendered === A_FILE_CONTENT;
        },
        {
          timeout: UI_TIMEOUT_MS,
          interval: 50,
          timeoutMsg: "Monaco did not expose A fixture content",
        },
      );
    } catch (error) {
      await this.#capture("monaco-content-failure");
      throw new Error(
        `${String(error)}; input=${JSON.stringify(observedValue)} rendered=${JSON.stringify(observedRendered)} filesystem=${JSON.stringify(await readFile(path.join(this.workspace("workspace-a").root, A_MARKER_FILE), "utf8"))}`,
      );
    }
    assert.equal(
      (await browser.$$('[role="tree"][aria-label="File Explorer"]').getElements()).length,
      1,
    );
    assert.equal((await browser.$$('main[aria-label="Editor area"]').getElements()).length, 1);
    this.#evidence.ui.editorOpened = true;
    await this.#capture("existing-editor-a-file");
  }

  async detachA(): Promise<void> {
    await this.#clickActivity("Agent");
    await this.#waitForAgent("workspace-a", "Running");
    const dockedSize = await (await this.#agentScreen("workspace-a")).getSize();
    this.#dockedAgentRect = { x: 0, y: 0, ...dockedSize };
    const handlesBefore = await this.browser().getWindowHandles();
    assert.deepEqual(handlesBefore, [this.mainWindowHandle()]);
    const button = await this.#button(`Detach Pi Agent for ${this.workspace("workspace-a").name}`);
    await button.click();
    await this.browser().waitUntil(
      async () => (await this.browser().getWindowHandles()).length === 2,
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: "production detached Pi Agent window was not created",
      },
    );
    const handles = await this.browser().getWindowHandles();
    const detached = handles.find((handle) => handle !== this.mainWindowHandle());
    assert.ok(detached, "detached window handle is missing");
    this.#detachedWindowHandle = detached;
    if (this.#evidence.application) this.#evidence.application.detachedWindowHandle = detached;
  }

  async assertDetachedPinnedToA(): Promise<void> {
    const detached = this.detachedWindowHandle();
    await this.browser().switchToWindow(detached);
    const screen = await this.#agentScreen("workspace-a");
    await this.browser().waitUntil(
      async () => /Running · ide-workspace-a/u.test(await this.#domText(screen)),
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: "detached production controller did not attach to workspace A",
      },
    );
    const viewport = await this.browser().execute(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
    const docked = this.#dockedAgentRect;
    assert.ok(docked, "docked Agent geometry is unavailable");
    assert.ok(viewport.width * viewport.height > docked.width * docked.height);
    assert.deepEqual(
      (await this.browser().getWindowHandles()).sort(),
      [this.mainWindowHandle(), detached].sort(),
    );
    assert.equal(await this.processId("workspace-a"), this.#processIds.get("workspace-a")?.[0]);
    await this.#assertNoUnexpectedPiAgentErrorAlert("detached-attach-a");
    this.#evidence.ui.detachedWindow = true;
    await this.#capture("detached-pinned-workspace-a");
  }

  async closeDetachedAndReopenDocked(): Promise<void> {
    const detached = this.detachedWindowHandle();
    assert.equal(await this.browser().getWindowHandle(), detached);
    await bounded(this.browser().closeWindow(), 5_000, "detached Tauri window close");
    await this.browser().waitUntil(
      async () => (await this.browser().getWindowHandles()).length === 1,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "detached Tauri window handle survived close",
      },
    );
    assert.deepEqual(await this.browser().getWindowHandles(), [this.mainWindowHandle()]);
    await this.#switchToMainWindow();
    await this.#clickActivity("Files");
    await this.#clickActivity("Agent");
    await this.#waitForAgent("workspace-a", "Running");
    await this.#assertNoUnexpectedPiAgentErrorAlert("docked-reopen-a");
    await this.#capture("docked-reopened-after-detached-close");
  }

  async assertRunningAfterDetachedClose(originalPid: number): Promise<void> {
    assert.equal(await this.processId("workspace-a"), originalPid);
    assert.equal(await processRunning(originalPid), true);
    assert.equal((await this.#interactiveStarts("workspace-a")).length, 1);
    assert.match(
      await this.#domText(await this.#agentScreen("workspace-a")),
      /Running · ide-workspace-a/u,
    );
  }

  async requestStopA(): Promise<void> {
    assert.equal(this.#activeWorkspaceId, "workspace-a");
    const button = await this.#button("Stop Pi");
    await button.click();
  }

  async assertNamedStopConfirmation(): Promise<void> {
    const dialog = await this.browser().$(
      '[role="dialog"][aria-labelledby="pi-stop-confirm-title"]',
    );
    await dialog.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    const text = await this.#domText(dialog);
    assert.match(text, /Stop Pi for workspace-a\?/u);
    assert.match(text, /terminates the live Pi process for this workspace/u);
    this.#evidence.ui.stopConfirmation = true;
  }

  async cancelStop(): Promise<void> {
    const processId = await this.processId("workspace-a");
    const dialog = await this.browser().$(
      '[role="dialog"][aria-labelledby="pi-stop-confirm-title"]',
    );
    const cancel = await dialog.$("button=Cancel");
    await cancel.click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000, interval: 50 });
    assert.equal(await processRunning(processId), true);
    assert.match(
      await this.#domText(await this.#agentScreen("workspace-a")),
      /Running · ide-workspace-a/u,
    );
  }

  async confirmStopA(): Promise<void> {
    const processId = await this.processId("workspace-a");
    await (await this.#button("Stop Pi")).click();
    const dialog = await this.browser().$(
      '[role="dialog"][aria-labelledby="pi-stop-confirm-title"]',
    );
    await dialog.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    await (await dialog.$("button=Stop Pi")).click();
    await this.#waitForAgent("workspace-a", "Stopped");
    const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
    while ((await processRunning(processId)) && Date.now() < deadline) await wait(50);
    assert.equal(await processRunning(processId), false);
  }

  async assertOnlyAStopped(): Promise<void> {
    const aProcess = this.#processIds.get("workspace-a")?.[0];
    const bProcess = this.#processIds.get("workspace-b")?.[0];
    assert.ok(aProcess && bProcess);
    assert.equal(await processRunning(aProcess), false);
    assert.equal(await processRunning(bProcess), true);
    const screen = await this.#agentScreen("workspace-a");
    assert.match(await this.#domText(screen), /Stopped · ide-workspace-a/u);
  }

  async restartA(): Promise<void> {
    await this.#clickAgentTab("Pi");
    const button = await this.#button("Restart Pi");
    await button.click();
    await this.#waitForAgent("workspace-a", "Running");
    const starts = await this.#waitForInteractiveStarts("workspace-a", 2);
    const restartedPid = Number(starts.at(-1)?.pid);
    assert.notEqual(restartedPid, this.#processIds.get("workspace-a")?.[0]);
    this.#recordProcessId("workspace-a", restartedPid);
    await this.#assertNoUnexpectedPiAgentErrorAlert("restart-a");
  }

  async assertRestoredDeterministicSession(): Promise<void> {
    const screenText = await this.#domText(await this.#agentScreen("workspace-a"));
    assert.match(screenText, /Running · ide-workspace-a/u);
    const starts = await this.#interactiveStarts("workspace-a");
    assert.equal(starts.length, 2);
    assert.ok(starts.every((event) => event.sessionId === "ide-workspace-a"));
    assert.equal(starts[1]?.restored, true);
    const history = await this.#providerHistory("workspace-a");
    assert.ok(history.includes(Buffer.from("A-DISTINCTIVE")));
    const restoredOutput = (await this.#providerEvents())
      .filter((event) => event.event === "provider-output" && event.pid === starts[1]?.pid)
      .map(decodedEventData);
    assert.ok(restoredOutput.some((data) => data.includes(Buffer.from("PI_STORY_RESTORED"))));
    await this.#clickAgentTab("Pi");
    const text = await this.#terminalText();
    if (text.length > 0)
      assert.match(this.#logicalTerminalText(text), /PI_STORY_(?:RESTORED|ECHO)/u);
    this.#evidence.ui.restartHistory = true;
    await this.#capture("workspace-a-restarted-history");
  }

  async assertNoParallelAuthorities(): Promise<void> {
    assert.ok(Object.values(this.#evidence.ui).every(Boolean));
    const screen = await this.#agentScreen("workspace-a");
    assert.equal((await this.browser().$$('section[data-workspace-id="workspace-a"]')).length, 1);
    assert.equal(
      (await screen.$$('textarea:not(.xterm-helper-textarea), input:not([type="hidden"])')).length,
      0,
    );
    assert.doesNotMatch(
      await this.#domText(screen),
      /Send prompt|Message history|Tool approval|Model picker/iu,
    );

    const events = await this.#providerEvents();
    assert.equal(
      events.some((event) => event.event === "unsupported-invocation"),
      false,
    );
    const allowedRoots = new Set([...this.#workspaces.values()].map(({ root }) => root));
    const sessionRoots = new Map(
      [...this.#workspaces.values()].map(({ id, root }) => [`ide-${id}`, root]),
    );
    for (const event of events) {
      const versionProbe = event.args.length === 1 && event.args[0] === "--version";
      if (versionProbe) {
        assert.ok(
          event.event === "invocation" || event.event === "version",
          `unexpected fixed-executable probe event: ${event.event}`,
        );
        continue;
      }
      assert.ok(allowedRoots.has(event.cwd), `provider invocation escaped A/B roots: ${event.cwd}`);
      if (event.event === "interactive-start") {
        const sessionId = String(event.sessionId);
        assert.deepEqual(event.args, ["--session-id", sessionId]);
        assert.equal(event.cwd, sessionRoots.get(sessionId));
      }
      if (event.event === "package-list") assert.deepEqual(event.args, ["list", "--no-approve"]);
      if (event.event === "rpc-request") {
        assert.deepEqual(event.args, ["--mode", "rpc", "--no-session", "--no-approve"]);
      }
    }
    const aBytes = await this.#rawInput("workspace-a");
    const bBytes = await this.#rawInput("workspace-b");
    assert.ok(aBytes.includes(Buffer.from("A-DISTINCTIVE")));
    assert.ok(bBytes.includes(Buffer.from("B-DISTINCTIVE")));
    assert.equal(aBytes.includes(Buffer.from("B-DISTINCTIVE")), false);
    assert.equal(bBytes.includes(Buffer.from("A-DISTINCTIVE")), false);
    this.#evidence.isolation = {
      aMarkerAbsentFromB: true,
      bMarkerAbsentFromA: true,
      rootsDistinct: true,
    };
    await this.#writeEvidence();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    let applicationExited = this.#applicationProcessId === undefined;
    let driverExited = this.#driver === undefined;
    let providerSurvivors: number[] = [];
    let environmentRestored = false;
    let scenarioChildRemoved = false;
    try {
      const browser = this.#browser;
      this.#browser = undefined;
      if (browser && !this.#sessionDeleted) {
        try {
          await bounded(browser.deleteSession(), 2_500, "native Pi WebDriver session cleanup");
          this.#sessionDeleted = true;
        } catch {
          // Continue with owned native process cleanup.
        }
      }

      const applicationProcessId = this.#applicationProcessId;
      if (applicationProcessId) {
        const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
        while ((await processRunning(applicationProcessId)) && Date.now() < deadline)
          await wait(50);
        if (await processRunning(applicationProcessId)) await stopProcess(applicationProcessId);
        applicationExited = !(await processRunning(applicationProcessId));
      }

      const knownProviderProcessIds = [...new Set([...this.#processIds.values()].flat())];
      for (const processId of knownProviderProcessIds) await stopProcess(processId);
      providerSurvivors = [];
      for (const processId of knownProviderProcessIds) {
        if (await processRunning(processId)) providerSurvivors.push(processId);
      }

      const driver = this.#driver;
      const driverExit = this.#driverExit;
      this.#driver = undefined;
      this.#driverExit = undefined;
      if (driver && driverExit) {
        const signalDriver = (signal: NodeJS.Signals): void => {
          try {
            if (process.platform !== "win32" && driver.pid) process.kill(-driver.pid, signal);
            else driver.kill(signal);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        };
        // The owned WebKit driver can retain the parent's diagnostic pipes after
        // tauri-driver exits. Stop its isolated group and release both readers.
        signalDriver("SIGTERM");
        await Promise.race([driverExit.catch(() => undefined), wait(1_500)]);
        signalDriver("SIGKILL");
        await Promise.race([driverExit.catch(() => undefined), wait(500)]);
        driver.stdout?.destroy();
        driver.stderr?.destroy();
        driverExited = driver.exitCode !== null || driver.signalCode !== null;
      }
    } finally {
      this.#restoreCustomEnvironment();
      if (this.#lease) {
        await this.#lease.restoreEnvironment();
        environmentRestored = true;
      }
      this.#evidence.cleanup = {
        applicationExited,
        driverExited,
        providerSurvivorProcessIds: providerSurvivors,
        environmentRestored,
        scenarioChildRemoved: false,
      };
      await this.#writeEvidence().catch(() => undefined);
      if (this.#lease) {
        await this.#lease.dispose();
        scenarioChildRemoved = this.#lease.evidence().scenarioChildRemoved;
      }
      this.#evidence.cleanup = {
        applicationExited,
        driverExited,
        providerSurvivorProcessIds: providerSurvivors,
        environmentRestored,
        scenarioChildRemoved,
      };
      await this.#writeEvidence().catch(() => undefined);
    }
    assert.equal(applicationExited, true, "release/no-bundle application survived Story cleanup");
    assert.equal(driverExited, true, "tauri-driver survived Story cleanup");
    assert.deepEqual(providerSurvivors, [], "deterministic Pi processes survived Story cleanup");
    assert.equal(environmentRestored, true);
    assert.equal(scenarioChildRemoved, true);
  }

  async #prepareScenario(): Promise<void> {
    const lease = this.lease();
    assert.equal(lease.runnerSandbox, this.#sandbox);
    const workspaceA = await realpath(lease.paths.workspace);
    const workspaceB = path.join(lease.paths.root, "workspaces", "workspace-b");
    await mkdir(workspaceB, { recursive: true });
    const canonicalB = await realpath(workspaceB);
    assert.ok(isContained(lease.paths.root, workspaceA));
    assert.ok(isContained(lease.paths.root, canonicalB));
    assert.notEqual(workspaceA, canonicalB);

    const fixtures: WorkspaceFixture[] = [
      {
        id: "workspace-a",
        name: "workspace-a",
        root: workspaceA,
        fileName: A_MARKER_FILE,
        content: A_FILE_CONTENT,
      },
      {
        id: "workspace-b",
        name: "workspace-b",
        root: canonicalB,
        fileName: B_MARKER_FILE,
        content: B_FILE_CONTENT,
      },
    ];
    for (const fixture of fixtures) {
      await writeFile(
        path.join(fixture.root, fixture.fileName),
        `export const nativeWorkspaceIdentity = "${fixture.id}-baseline";\n`,
        { encoding: "utf8", flag: "wx" },
      );
      await this.#git(fixture.root, ["init", "--quiet"]);
      await this.#git(fixture.root, ["config", "user.name", "Pi Story"]);
      await this.#git(fixture.root, ["config", "user.email", "pi-story@example.invalid"]);
      if (fixture.id === "workspace-a") {
        await writeFile(path.join(fixture.root, LITERAL_FILE), 'export const literalIdentity = "literal-baseline";\n', "utf8");
        await this.#git(fixture.root, ["--literal-pathspecs", "add", "--", LITERAL_FILE]);
      }
      await this.#git(fixture.root, ["add", "--", fixture.fileName]);
      await this.#git(fixture.root, ["commit", "--quiet", "-m", "fixture baseline"]);
      await writeFile(path.join(fixture.root, fixture.fileName), fixture.content, "utf8");
      if (fixture.id === "workspace-a") await writeFile(path.join(fixture.root, LITERAL_FILE), LITERAL_CONTENT, "utf8");
      await mkdir(path.join(fixture.root, ".ide"), { recursive: true });
      const timestamp = "2026-08-09T00:00:00Z";
      await writeFile(
        path.join(fixture.root, ".ide/workspace.json"),
        `${JSON.stringify(
          {
            id: fixture.id,
            path: fixture.root,
            name: fixture.name,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      this.#workspaces.set(fixture.id, fixture);
    }

    await writeFile(
      path.join(lease.paths.ideHome, "workspaces.json"),
      `${JSON.stringify(
        {
          version: 1,
          workspaces: fixtures.map((fixture) => ({
            id: fixture.id,
            name: fixture.name,
            rootPath: fixture.root,
            markerFolder: ".ide",
            createdAt: "2026-08-09T00:00:00Z",
            lastOpenedAt: "2026-08-09T00:00:00Z",
          })),
          currentWorkspaceId: "workspace-a",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    this.#artifactDirectory = path.join(
      lease.runnerArtifactPath,
      "req-pi-workspace-agent-001",
      path.basename(lease.paths.root),
    );
    this.#providerDirectory = path.join(lease.paths.root, "runtime-bin");
    this.#providerStateDirectory = path.join(lease.paths.ideHome, "pi-story-provider-state");
    await Promise.all([
      mkdir(this.#artifactDirectory, { recursive: true }),
      mkdir(this.#providerDirectory, { recursive: true }),
      mkdir(this.#providerStateDirectory, { recursive: true }),
    ]);
    this.#providerPath = path.join(this.#providerDirectory, "pi");
    this.#providerEventFile = path.join(this.#artifactDirectory, "pi-provider-events.jsonl");
    await writeFile(this.#providerPath, PROVIDER_SOURCE, { encoding: "utf8", mode: 0o700 });
    await chmod(this.#providerPath, 0o700);
    await writeFile(path.join(this.#providerDirectory, "git"), DELAYED_GIT_SOURCE, { mode: 0o700 });
    const providerStat = await stat(this.#providerPath);
    const sha256 = createHash("sha256")
      .update(await readFile(this.#providerPath))
      .digest("hex");

    for (const name of CUSTOM_ENVIRONMENT_VARIABLES) {
      this.#originalEnvironment.set(name, process.env[name]);
    }
    process.env.PATH = `${this.#providerDirectory}${path.delimiter}${process.env.PATH ?? ""}`;
    process.env.IDE_PI_STORY_EVIDENCE_DIR = this.#artifactDirectory;
    process.env.IDE_PI_STORY_STATE_DIR = this.#providerStateDirectory;
    process.env.IDE_PI_STORY_PROVIDER_PATH = this.#providerPath;
    assert.equal(process.env.PATH.split(path.delimiter)[0], this.#providerDirectory);

    this.#evidence.scenarioEnvironment = lease.evidence();
    this.#evidence.artifactDirectory = this.#artifactDirectory;
    this.#evidence.provider = {
      executable: this.#providerPath,
      sha256,
      mode: providerStat.mode & 0o777,
      pathFirstEntry: this.#providerDirectory,
      eventFile: this.#providerEventFile,
      stateDirectory: this.#providerStateDirectory,
      eventCapBytes: PROVIDER_EVENT_CAP_BYTES,
      installedPackages: INSTALLED_PACKAGES,
      commandlessPackage: COMMANDLESS_PACKAGE,
    };
    this.#evidence.workspaces = fixtures.map(({ id, root, fileName }) => ({
      id,
      root,
      file: path.join(root, fileName),
    }));
    await writeFile(
      path.join(this.#artifactDirectory, "provider-manifest.json"),
      `${JSON.stringify(this.#evidence.provider, null, 2)}\n`,
      "utf8",
    );
  }

  async #launchApplication(): Promise<void> {
    await Promise.all([
      access(this.#tauriDriverPath, fsConstants.X_OK),
      access(this.#webKitWebDriverPath, fsConstants.X_OK),
      access(this.#applicationPath, fsConstants.X_OK),
      access(this.providerPath(), fsConstants.X_OK),
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
      { detached: process.platform !== "win32", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
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

    await this.#waitForDriver(port);
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
      "WebdriverIO native Pi Agent session start",
    );
    this.#applicationProcessId = await this.#waitForApplicationProcess();
    const handles = await this.browser().getWindowHandles();
    assert.equal(handles.length, 1);
    this.#mainWindowHandle = handles[0];
    assert.ok(this.#mainWindowHandle);
    await this.browser().setWindowSize(DESIRED_WIDTH, DESIRED_HEIGHT);
    this.#evidence.application = {
      executable: this.#applicationPath,
      processId: this.#applicationProcessId,
      mainWindowHandle: this.#mainWindowHandle,
    };
  }

  async #waitForWorkspace(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    const workspace = this.workspace(workspaceId);
    const shell = await this.browser().$(".ide-shell");
    await shell.waitForDisplayed({ timeout: SESSION_START_TIMEOUT_MS, interval: 50 });
    const workspaceSelector = `header span[title="${cssAttribute(workspace.root)}"]`;
    try {
      await this.browser().waitUntil(
        async () => {
          const label = await this.browser().$(workspaceSelector);
          return (
            (await label.isExisting()) &&
            String(await label.getProperty("textContent")).trim() === `Workspace: ${workspace.name}`
          );
        },
        {
          timeout: SESSION_START_TIMEOUT_MS,
          interval: 50,
          timeoutMsg: `${workspaceId} did not become the production active workspace`,
        },
      );
    } catch (error) {
      const bodyText = (await this.browser().$("body").getText()).slice(0, 12_000);
      const pageSource = (await this.browser().getPageSource()).slice(0, 256_000);
      await Promise.all([
        writeFile(path.join(this.artifactDirectory(), "workspace-wait-body.txt"), bodyText, "utf8"),
        writeFile(
          path.join(this.artifactDirectory(), "workspace-wait-page-source.html"),
          pageSource,
          "utf8",
        ),
        this.#capture("workspace-wait-failure"),
      ]);
      throw new Error(`${String(error)}; bounded WebView text: ${bodyText}`);
    }
    const workspaceLabel = await this.browser().$(workspaceSelector);
    assert.equal(await workspaceLabel.isExisting(), true);
    this.#activeWorkspaceId = workspaceId;
  }

  async #switchWorkspaceThroughExplorer(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    assert.notEqual(this.#activeWorkspaceId, workspaceId);
    await this.#switchToMainWindow();
    await this.#clickActivity("Files");
    const list = await this.browser().$('[role="listbox"][aria-label="Registered workspaces"]');
    await list.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    const options = Array.from(await list.$$('[role="option"]').getElements());
    let target: WebdriverIO.Element | undefined;
    for (const option of options) {
      if (
        (await option.getAttribute("title"))?.startsWith(`${this.workspace(workspaceId).name}\n`)
      ) {
        target = option;
        break;
      }
    }
    assert.ok(target, `Workspace Explorer does not contain ${workspaceId}`);
    assert.equal(await target.getAttribute("aria-selected"), "false");
    await target.click();
    await this.#waitForWorkspace(workspaceId);
    await this.#assertFileVisible(workspaceId);
    const registry = JSON.parse(
      await readFile(path.join(this.lease().paths.ideHome, "workspaces.json"), "utf8"),
    ) as { currentWorkspaceId: string };
    assert.equal(registry.currentWorkspaceId, workspaceId);
  }

  async #clickActivity(label: "Files" | "Agent"): Promise<void> {
    const tab = await this.browser().$(
      `nav[aria-label="Primary activity"] [role="tab"][aria-label="${label}"]`,
    );
    await tab.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: `${label} activity did not become selected`,
      },
    );
  }

  async #waitForAgent(
    workspaceId: PiWorkspaceAgentWorkspaceId,
    state: "Running" | "Stopped",
  ): Promise<void> {
    const screen = await this.#agentScreen(workspaceId);
    await this.browser().waitUntil(
      async () => {
        const text = await this.#domText(screen);
        return (
          text.includes(`Agent · ${this.workspace(workspaceId).name}`) &&
          text.includes(`${state} · ide-${workspaceId}`)
        );
      },
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: `${workspaceId} Agent did not reach ${state}`,
      },
    );
    if (state === "Running") await this.#terminalHost();
  }

  async #agentScreen(workspaceId: PiWorkspaceAgentWorkspaceId) {
    const screen = await this.browser().$(
      `section[data-workspace-id="${cssAttribute(workspaceId)}"][aria-label="Pi Agent for ${cssAttribute(this.workspace(workspaceId).name)}"]`,
    );
    await screen.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    return screen;
  }

  async #terminalHost() {
    const host = await this.browser().$('[data-pi-native-terminal="true"]');
    await host.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    await this.browser().waitUntil(
      async () => (await host.$(".xterm-helper-textarea")).isExisting(),
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: "production xterm helper textarea did not mount",
      },
    );
    return host;
  }

  async #focusTerminal(): Promise<void> {
    await this.#terminalHost();
    const focused = await this.browser().execute(() => {
      const host = document.querySelector('[data-pi-native-terminal="true"]');
      const textarea = host?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
      textarea?.focus();
      return document.activeElement === textarea;
    });
    assert.equal(focused, true);
  }

  async #pasteIntoTerminal(text: string): Promise<void> {
    await this.#focusTerminal();
    const dispatched = await this.browser().execute((value) => {
      const host = document.querySelector('[data-pi-native-terminal="true"]');
      const textarea = host?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
      if (!textarea) return false;
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData(type: string) {
            return type === "text" || type === "text/plain" ? value : "";
          },
        },
      });
      textarea.dispatchEvent(event);
      return true;
    }, text);
    assert.equal(dispatched, true);
  }

  async #dispatchModifiedEnter(modifier: "shift" | "alt"): Promise<void> {
    await this.#focusTerminal();
    const result = await this.browser().execute((kind) => {
      const host = document.querySelector('[data-pi-native-terminal="true"]');
      const textarea = host?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
      if (!textarea) return { found: false, dispatchReturned: false };
      return {
        found: true,
        dispatchReturned: textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true,
            shiftKey: kind === "shift",
            altKey: kind === "alt",
          }),
        ),
      };
    }, modifier);
    assert.equal(result.found, true);
    assert.equal(typeof result.dispatchReturned, "boolean");
  }

  #logicalTerminalText(value: string): string {
    return value.replace(/\s+/gu, "");
  }

  async #terminalText(): Promise<string> {
    const value = await this.browser().execute(() => {
      const host = document.querySelector('[data-pi-native-terminal="true"]');
      if (!host) return "";
      const rows = Array.from(host.querySelectorAll(".xterm-rows > div"))
        .map((row) => row.textContent ?? "")
        .join("\n");
      const accessibility = Array.from(host.querySelectorAll(".xterm-accessibility-tree > div"))
        .map((row) => row.textContent ?? "")
        .join("\n");
      return `${rows}\n${accessibility}`.trim();
    });
    return String(value).replaceAll("\u00a0", " ");
  }

  async #clickAgentTab(label: "Pi" | "Changes" | "Activity" | "Resources" | "Sessions") {
    const screen = await this.#agentScreen(this.#activeWorkspaceId);
    const tab = await screen.$(`[role="tab"]=${label}`);
    await tab.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: `${label} Agent tab did not become selected`,
      },
    );
    return tab;
  }

  async #domText(element: WebdriverIO.Element | ReturnType<Browser["$"]>): Promise<string> {
    const resolved = (await element) as WebdriverIO.Element;
    return String(await resolved.getProperty("textContent"))
      .replaceAll("\u00a0", " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  async #assertNoUnexpectedPiAgentErrorAlert(
    checkpoint: PiAgentErrorAlertCheckpoint,
  ): Promise<void> {
    const workspaceId = this.#activeWorkspaceId;
    await this.#agentScreen(workspaceId);
    const deadline = Date.now() + ERROR_ALERT_OBSERVATION_MS;
    let visibleAlerts: PiAgentErrorAlertDomSnapshot[] = [];
    do {
      visibleAlerts = (await this.browser().execute((expectedWorkspaceId) => {
        const screen = Array.from(
          document.querySelectorAll<HTMLElement>("section[data-workspace-id]"),
        ).find((candidate) => candidate.dataset.workspaceId === expectedWorkspaceId);
        if (!screen) return [];
        return Array.from(screen.querySelectorAll<HTMLElement>('[role="alert"]'))
          .filter(
            (alert) => !alert.closest('[role="dialog"][aria-labelledby="pi-stop-confirm-title"]'),
          )
          .filter((alert) => {
            const style = window.getComputedStyle(alert);
            const bounds = alert.getBoundingClientRect();
            return (
              !alert.closest("[hidden]") &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0" &&
              bounds.width > 0 &&
              bounds.height > 0
            );
          })
          .map((alert) => ({
            text: (alert.textContent ?? "").replaceAll("\u00a0", " ").replace(/\s+/gu, " ").trim(),
            outerHtml: alert.outerHTML.slice(0, 16 * 1024),
            ariaLive: alert.getAttribute("aria-live"),
            className: alert.className,
          }));
      }, workspaceId)) as PiAgentErrorAlertDomSnapshot[];
      if (visibleAlerts.length > 0) break;
      await wait(50);
    } while (Date.now() < deadline);
    if (visibleAlerts.length === 0) return;

    let screenshotPath: string | undefined;
    let screenshotFailure: string | undefined;
    try {
      await this.#capture(`qg-003-unexpected-alert-${checkpoint}`);
      screenshotPath = this.#evidence.screenshots.at(-1);
    } catch (error) {
      screenshotFailure = error instanceof Error ? error.message : String(error);
    }
    const domArtifactPath = path.join(
      this.artifactDirectory(),
      `qg-003-unexpected-alert-${checkpoint}.json`,
    );
    await writeFile(
      domArtifactPath,
      `${JSON.stringify(
        {
          requirement: REQUIREMENT,
          qualityGate: "QG-003",
          checkpoint,
          workspaceId,
          windowHandle: await this.browser().getWindowHandle(),
          selector: 'section[data-workspace-id] [role="alert"]',
          excludedStopConfirmation: '[role="dialog"][aria-labelledby="pi-stop-confirm-title"]',
          visibleAlerts,
          screenshotPath,
          screenshotFailure,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    throw new Error(
      `[QG-003] Unexpected Pi Agent error alert after ${checkpoint}: ${visibleAlerts
        .map(({ text }) => JSON.stringify(text || "<empty alert>"))
        .join(" | ")}; real WebView DOM artifact: ${domArtifactPath}`,
    );
  }

  async #agentPanel(id: "changes" | "activity" | "resources" | "sessions") {
    const panel = await this.browser().$(`#pi-agent-${id}-panel`);
    await panel.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    return panel;
  }

  async #waitForInstalledPackages() {
    const panel = await this.#agentPanel("resources");
    await this.browser().waitUntil(
      async () => {
        const text = await this.#domText(panel);
        return INSTALLED_PACKAGES.every((packageName) => text.includes(packageName));
      },
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: "Resources did not expose all seven deterministic installed packages",
      },
    );
    return panel;
  }

  async #assertFileVisible(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<void> {
    const workspace = this.workspace(workspaceId);
    const tree = await this.browser().$('[role="tree"][aria-label="File Explorer"]');
    await tree.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    const item = await this.#fileItem(workspace.fileName);
    await item.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 50 });
    assert.equal(await item.getAttribute("data-path"), workspace.fileName);
  }

  async #fileItem(fileName: string) {
    return await this.browser().$(`[role="treeitem"][data-path="${cssAttribute(fileName)}"]`);
  }

  async #button(textOrLabel: string) {
    const screen = await this.#agentScreen(this.#activeWorkspaceId);
    const buttons = await screen.$$("button");
    for (const button of buttons) {
      const label = await button.getAttribute("aria-label");
      const text = await button.getText();
      if (label === textOrLabel || text === textOrLabel) return button;
    }
    throw new Error(`Agent button not found: ${textOrLabel}`);
  }

  async #providerEvents(): Promise<ProviderEvent[]> {
    const eventFile = this.providerEventFile();
    let content = "";
    try {
      content = await readFile(eventFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const complete = content.endsWith("\n")
      ? content
      : content.slice(0, content.lastIndexOf("\n") + 1);
    return complete
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProviderEvent);
  }

  async #interactiveStarts(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<ProviderEvent[]> {
    return (await this.#providerEvents()).filter(
      (event) =>
        event.event === "interactive-start" &&
        event.cwd === this.workspace(workspaceId).root &&
        event.sessionId === `ide-${workspaceId}`,
    );
  }

  async #waitForInteractiveStarts(
    workspaceId: PiWorkspaceAgentWorkspaceId,
    count: number,
  ): Promise<ProviderEvent[]> {
    let result: ProviderEvent[] = [];
    await this.browser().waitUntil(
      async () => {
        result = await this.#interactiveStarts(workspaceId);
        return result.length >= count;
      },
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: `deterministic Pi did not start ${count} time(s) for ${workspaceId}`,
      },
    );
    return result;
  }

  async #rawInput(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<Buffer> {
    return Buffer.concat(
      (await this.#providerEvents())
        .filter(
          (event) =>
            event.event === "terminal-input" && event.cwd === this.workspace(workspaceId).root,
        )
        .map(decodedEventData),
    );
  }

  async #waitForRawBytes(
    workspaceId: PiWorkspaceAgentWorkspaceId,
    expected: Buffer,
  ): Promise<void> {
    await this.browser().waitUntil(
      async () => (await this.#rawInput(workspaceId)).includes(expected),
      {
        timeout: UI_TIMEOUT_MS,
        interval: 50,
        timeoutMsg: `${workspaceId} PTY did not receive ${expected.toString("hex")}`,
      },
    );
  }

  async #terminalSizes(
    workspaceId: PiWorkspaceAgentWorkspaceId,
  ): Promise<Array<{ cols: number; rows: number }>> {
    return (await this.#providerEvents())
      .filter(
        (event) =>
          event.event === "terminal-size" && event.cwd === this.workspace(workspaceId).root,
      )
      .map((event) => ({ cols: Number(event.cols), rows: Number(event.rows) }));
  }

  async #providerHistory(workspaceId: PiWorkspaceAgentWorkspaceId): Promise<Buffer> {
    const state = JSON.parse(
      await readFile(path.join(this.providerStateDirectory(), `ide-${workspaceId}.json`), "utf8"),
    ) as { sessionId: string; historyBase64: string };
    assert.equal(state.sessionId, `ide-${workspaceId}`);
    return Buffer.from(state.historyBase64, "base64");
  }

  #recordProcessId(workspaceId: PiWorkspaceAgentWorkspaceId, processId: number): void {
    assert.ok(Number.isInteger(processId) && processId > 1);
    const values = this.#processIds.get(workspaceId) ?? [];
    if (!values.includes(processId)) values.push(processId);
    this.#processIds.set(workspaceId, values);
    this.#evidence.processes[workspaceId] = [...values];
  }

  async #capture(name: string): Promise<void> {
    const filePath = path.join(
      this.artifactDirectory(),
      `${String(this.#evidence.screenshots.length + 1).padStart(2, "0")}-${name}.png`,
    );
    await this.browser().saveScreenshot(filePath);
    this.#evidence.screenshots.push(filePath);
  }

  async #writeEvidence(): Promise<void> {
    if (!this.#artifactDirectory) return;
    await writeFile(
      path.join(this.#artifactDirectory, "native-pi-story-evidence.json"),
      `${JSON.stringify(this.evidence(), null, 2)}\n`,
      "utf8",
    );
  }

  async #git(root: string, arguments_: string[]): Promise<void> {
    await execFileAsync("git", ["-C", root, ...arguments_], {
      cwd: root,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
  }

  #restoreCustomEnvironment(): void {
    for (const name of CUSTOM_ENVIRONMENT_VARIABLES) {
      const original = this.#originalEnvironment.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }

  async #switchToMainWindow(): Promise<void> {
    const main = this.mainWindowHandle();
    if ((await this.browser().getWindowHandle()) !== main)
      await this.browser().switchToWindow(main);
  }

  async #waitForDriver(port: number): Promise<void> {
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

  async #waitForApplicationProcess(): Promise<number> {
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

  workspace(id: PiWorkspaceAgentWorkspaceId): WorkspaceFixture {
    const workspace = this.#workspaces.get(id);
    assert.ok(workspace, `missing native Story workspace ${id}`);
    return workspace;
  }

  browser(): Browser {
    if (!this.#browser) throw new Error("native Pi Agent WebDriver session is unavailable");
    return this.#browser;
  }

  lease(): NativeScenarioEnvironmentLease {
    if (!this.#lease) throw new Error("native Pi Agent scenario lease is unavailable");
    return this.#lease;
  }

  providerPath(): string {
    if (!this.#providerPath) throw new Error("native Pi provider path is unavailable");
    return this.#providerPath;
  }

  providerEventFile(): string {
    if (!this.#providerEventFile) throw new Error("native Pi provider event file is unavailable");
    return this.#providerEventFile;
  }

  providerStateDirectory(): string {
    if (!this.#providerStateDirectory) throw new Error("native Pi provider state is unavailable");
    return this.#providerStateDirectory;
  }

  artifactDirectory(): string {
    if (!this.#artifactDirectory) throw new Error("native Pi artifact directory is unavailable");
    return this.#artifactDirectory;
  }

  mainWindowHandle(): string {
    if (!this.#mainWindowHandle) throw new Error("main Tauri window handle is unavailable");
    return this.#mainWindowHandle;
  }

  detachedWindowHandle(): string {
    if (!this.#detachedWindowHandle) throw new Error("detached Tauri window handle is unavailable");
    return this.#detachedWindowHandle;
  }

  #escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
}
