import assert from "node:assert/strict";
import { access, readFile, stat, open } from "node:fs/promises";
import { constants as fsConstants, readFileSync, readdirSync } from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGING_TIMEOUT_MS = 15 * 60 * 1000;
const LAUNCH_GRACE_MS = 10_000;
const WINDOW_READY_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 20_000;
const SURVIVOR_SCAN_GRACE_MS = 2_000;

export interface IdePackagingStoryDriver {
  start(): Promise<void>;
  runPackagingCommand(command: string): Promise<void>;
  assertCommandExitedZeroAndProducedArtifact(): Promise<void>;
  assertArtifactExists(fixedPath: string): Promise<void>;
  assertProductNameAndVersion(productName: string, version: string): Promise<void>;
  assertExecutableAndSelfContained(): Promise<void>;
  launchArtifact(): Promise<void>;
  assertIdeStartsAndWindowReady(): Promise<void>;
  closeIdeWindow(): Promise<void>;
  assertCleanExit(): Promise<void>;
  assertZeroSurvivingProcesses(): Promise<void>;
  evidence(): Readonly<Record<string, unknown>>;
  dispose(): Promise<void>;
}

interface BuildRecord {
  command: string;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

interface LaunchRecord {
  pid: number;
  child: ChildProcess;
  cmdline: string;
  env: Record<string, string>;
  launchTime: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnShell(
  command: string,
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        // process group already gone
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }, PACKAGING_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code, signal });
    });
  });
}

function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | string | null }> {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      resolvePromise({ code: null, signal: "timeout" });
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
}

function processCmdlines(): Array<{ pid: number; cmdline: string }> {
  const out: Array<{ pid: number; cmdline: string }> = [];
  try {
    const entries = readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue;
      }
      try {
        const cmdline = readFileSync(join("/proc", entry, "cmdline"), "utf8").replace(/\0/g, " ");
        out.push({ pid: Number(entry), cmdline });
      } catch {
        // process exited during scan
      }
    }
  } catch {
    // /proc unavailable
  }
  return out;
}

function ownedProcessPids(rootPid: number): Set<number> {
  const owned = new Set<number>([rootPid]);
  const ppidOf = new Map<number, number>();
  try {
    const entries = readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue;
      }
      const pid = Number(entry);
      try {
        // /proc/<pid>/stat is "pid (comm) state ppid ..."; comm may contain
        // spaces and parentheses, so parse after the last ')' where the third
        // whitespace-separated field is the parent PID.
        const stat = readFileSync(join("/proc", entry, "stat"), "utf8");
        const after = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
        const ppid = Number(after[1]);
        if (!Number.isNaN(ppid)) {
          ppidOf.set(pid, ppid);
        }
      } catch {
        // process exited during scan
      }
    }
  } catch {
    // /proc unavailable
  }
  // Breadth-first walk over ppid chains starting at rootPid. The AppImage
  // runtime spawns the real ide-desktop as a child, so the real native window's
  // _NET_WM_PID is a descendant of the launched AppImage PID, not the PID
  // itself.
  const queue: number[] = [rootPid];
  while (queue.length) {
    const parent = queue.pop()!;
    for (const [pid, ppid] of ppidOf.entries()) {
      if (ppid === parent && !owned.has(pid)) {
        owned.add(pid);
        queue.push(pid);
      }
    }
  }
  return owned;
}

export function findIdePackagingSurvivors(
  artifactPath: string | null,
  processes: ReadonlyArray<{ pid: number; cmdline: string }> = processCmdlines(),
): Array<{ pid: number; cmdline: string }> {
  if (!artifactPath) {
    return [];
  }
  const artifactName = basename(artifactPath);
  if (!artifactName) {
    return [];
  }
  const markers = [artifactPath, artifactName, "ide-desktop"];
  const survivors: Array<{ pid: number; cmdline: string }> = [];
  for (const proc of processes) {
    if (proc.pid === process.pid) {
      continue;
    }
    for (const marker of markers) {
      if (proc.cmdline.includes(marker)) {
        survivors.push(proc);
        break;
      }
    }
  }
  return survivors;
}

export class IdePackagingStorySession implements IdePackagingStoryDriver {
  private build: BuildRecord | null = null;
  private artifactPath: string | null = null;
  private launch: LaunchRecord | null = null;
  private windowId: number | null = null;
  private windowReadyEvidence: string | null = null;
  private closeMethod: string | null = null;
  private exitInfo: { code: number | null; signal: string | null } | null = null;
  private evidenceRecord: Record<string, unknown> = {};

  async start(): Promise<void> {
    this.evidenceRecord = {
      startedAt: new Date().toISOString(),
    };
  }

  async runPackagingCommand(command: string): Promise<void> {
    if (this.build) {
      return;
    }
    const normalized =
      command.trim() || "pnpm --filter @ide/desktop tauri build --bundles appimage --ci";
    const startedAt = Date.now();
    const result = await spawnShell(normalized);
    this.build = {
      command: normalized,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      signal: result.signal,
      durationMs: Date.now() - startedAt,
    };
  }

  async assertCommandExitedZeroAndProducedArtifact(): Promise<void> {
    assert(this.build, "the packaging command was not run");
    const build = this.build;
    if (build.code !== 0 || build.signal) {
      assert.fail(
        [
          `the packaging command did not exit successfully (exit ${build.code}${build.signal ? ` signal=${build.signal}` : ""}, ${build.durationMs}ms)`,
          `command: ${build.command}`,
          "--- stdout (tail) ---",
          build.stdout.slice(-2000),
          "--- stderr (tail) ---",
          build.stderr.slice(-2000),
        ].join("\n"),
      );
    }
    await this.assertArtifactExists(
      "apps/desktop/src-tauri/target/release/bundle/appimage/IDE_0.1.0_amd64.AppImage",
    );
  }

  async assertArtifactExists(fixedPath: string): Promise<void> {
    const artifactPath = resolve(PROJECT_ROOT, fixedPath);
    let stats;
    try {
      await access(artifactPath, fsConstants.R_OK);
      stats = await stat(artifactPath);
    } catch {
      assert.fail(
        [
          `no release AppImage artifact was produced at the fixed path ${artifactPath}`,
          `the packaging command exited ${this.build?.code ?? "not run"}${this.build?.signal ? ` signal=${this.build.signal}` : ""}`,
          "the bundle configuration in tauri.conf.json is not present yet",
        ].join("\n"),
      );
    }
    assert(stats.isFile(), `the fixed path ${artifactPath} is not a regular file`);
    this.artifactPath = artifactPath;
  }

  async assertProductNameAndVersion(productName: string, version: string): Promise<void> {
    assert(this.artifactPath, "the AppImage artifact was not asserted");
    const artifactBasename = basename(this.artifactPath);
    assert.ok(
      artifactBasename.startsWith(`${productName}_`) && artifactBasename.endsWith(".AppImage"),
      `the AppImage artifact basename ${artifactBasename} does not carry the fixed product name ${productName}`,
    );
    assert.ok(
      artifactBasename.includes(`_${version}_`),
      `the AppImage artifact basename ${artifactBasename} does not carry the fixed version ${version}`,
    );
    const confPath = join(PROJECT_ROOT, "apps/desktop/src-tauri/tauri.conf.json");
    const conf = JSON.parse(await readFile(confPath, "utf8"));
    assert.strictEqual(
      conf.productName,
      productName,
      `tauri.conf.json productName ${JSON.stringify(conf.productName)} does not match the fixed product name ${productName}`,
    );
    assert.strictEqual(
      conf.version,
      version,
      `tauri.conf.json version ${JSON.stringify(conf.version)} does not match the fixed version ${version}`,
    );
  }

  async assertExecutableAndSelfContained(): Promise<void> {
    assert(this.artifactPath, "the AppImage artifact was not asserted");
    const stats = await stat(this.artifactPath);
    assert(stats.size > 0, "the AppImage artifact is empty");
    assert(
      (stats.mode & 0o111) !== 0,
      `the AppImage artifact is not executable (mode ${stats.mode.toString(8)})`,
    );
    const handle = await open(this.artifactPath, "r");
    try {
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      assert.strictEqual(
        head.subarray(0, 4).toString("hex"),
        "7f454c46",
        "the artifact is not an ELF executable",
      );
      // AC-004 strict: the frozen artifact is a type-2 AppImage (AI\x02).
      // Assert the exact type-2 magic; do not accept type-1 (AI\xff).
      assert.strictEqual(
        head[8],
        0x41,
        "the artifact does not carry the AppImage magic 'A' (AI\\x02)",
      );
      assert.strictEqual(
        head[9],
        0x49,
        "the artifact does not carry the AppImage magic 'I' (AI\\x02)",
      );
      assert.strictEqual(
        head[10],
        0x02,
        `the artifact is not a type-2 AppImage (AI\\x02): got byte ${head[10]} (${head[10] === 0xff ? "type-1 AI\\xff" : "unknown"})`,
      );
    } finally {
      await handle.close();
    }
  }

  async launchArtifact(): Promise<void> {
    assert(this.artifactPath, "the AppImage artifact was not asserted");
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
    const child = spawn(this.artifactPath, {
      cwd: dirname(this.artifactPath),
      env,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    this.launch = {
      pid: child.pid!,
      child,
      cmdline: this.artifactPath,
      env,
      launchTime: Date.now(),
    };
    await sleep(LAUNCH_GRACE_MS);
  }

  private async detectNativeWindow(appPid: number): Promise<number | null> {
    try {
      const displayEnv = this.launch?.env.DISPLAY;
      if (!displayEnv) {
        return null;
      }
      // Owned PIDs: the launched AppImage runtime PID plus every descendant in
      // its /proc ppid chain. The real ide-desktop is a child of the AppImage
      // runtime, so its _NET_WM_PID is an owned child PID.
      const ownedPids = ownedProcessPids(appPid);
      const clientList = execFileSync("xprop", ["-root", "_NET_CLIENT_LIST"], {
        env: { ...process.env, DISPLAY: displayEnv },
        encoding: "utf8",
      });
      const ids = clientList.match(/0x[0-9a-f]+/gi) ?? [];
      for (const id of ids) {
        try {
          const info = execFileSync(
            "xprop",
            ["-id", id, "_NET_WM_PID", "_NET_WM_NAME", "WM_NAME", "WM_CLASS"],
            {
              env: { ...process.env, DISPLAY: displayEnv },
              encoding: "utf8",
            },
          );
          // xprop prints an optional type annotation between the property name
          // and '=', e.g. _NET_WM_PID(CARDINAL) = 145751 or
          // WM_CLASS(STRING) = "ide-desktop", "Ide-desktop". Allow an optional
          // (...) suffix so the regexes match the real xprop output.
          const pidMatch = info.match(/_NET_WM_PID(?:\s*\([^)]*\))?\s*=\s*(\d+)/);
          const wmNameMatch = info.match(/_NET_WM_NAME(?:\s*\([^)]*\))?\s*=\s*"(.*)"/);
          const wmClassMatch = info.match(/WM_CLASS(?:\s*\([^)]*\))?\s*=\s*"(.*)"/);
          const wmName = wmNameMatch ? wmNameMatch[1] : null;
          const wmClass = wmClassMatch ? wmClassMatch[1] : null;
          const pid = pidMatch ? Number(pidMatch[1]) : null;
          const ownedPid = pid !== null && ownedPids.has(pid);
          const ideDesktopClass =
            wmClass !== null && (wmClass.includes("ide-desktop") || wmClass.includes("IDE"));
          // AC-005 strict: acceptance requires a native window whose exact
          // WM_NAME is "IDE" (matches the independent probe). Keep detection
          // robust by also accepting windows that carry an owned descendant
          // PID or an ide-desktop/IDE WM_CLASS, but never accept a window that
          // does not carry the exact IDE window name.
          const exactIdeName = wmName !== null && wmName.trim() === "IDE";
          if (exactIdeName && (pid === appPid || ownedPid || ideDesktopClass)) {
            return parseInt(id, 16);
          }
        } catch {
          // window vanished during scan
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async assertIdeStartsAndWindowReady(): Promise<void> {
    assert(this.launch, "the AppImage was not launched");
    const appPid = this.launch.pid;
    const deadline = Date.now() + WINDOW_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!isAlive(appPid)) {
        const exit = await waitForExit(this.launch.child, 0);
        assert.fail(
          `the IDE desktop exited before its window became ready (pid ${appPid}, code=${exit.code}, signal=${exit.signal})`,
        );
      }
      const windowId = await this.detectNativeWindow(appPid);
      if (windowId) {
        this.windowId = windowId;
        this.windowReadyEvidence = "x11-window";
        return;
      }
      await sleep(1000);
    }
    // AC-005 strict: the native IDE window must actually be detected. The
    // process-alive-and-display-connection path is not an acceptance path.
    assert.fail(
      `the IDE desktop started (pid ${appPid}) but no native X11 window with the exact WM_NAME "IDE" was detected within ${WINDOW_READY_TIMEOUT_MS}ms`,
    );
  }

  async closeIdeWindow(): Promise<void> {
    assert(this.launch, "the AppImage was not launched");
    assert(
      this.windowId,
      "no native IDE window was detected; AC-006 requires the person to close the detected IDE window via WM_DELETE",
    );
    const appPid = this.launch.pid;
    // AC-006 strict: the "person closes the IDE window" step must exercise the
    // X11 WM_DELETE close. A SIGTERM fallback is not an acceptance path.
    const closed = await this.tryX11CloseWindow(this.windowId);
    assert(
      closed,
      `the X11 WM_DELETE close of window 0x${this.windowId.toString(16)} failed (pid ${appPid})`,
    );
    this.closeMethod = "wm_delete_window";
  }

  private async tryX11CloseWindow(windowId: number): Promise<boolean> {
    try {
      const displayEnv = this.launch?.env.DISPLAY;
      if (!displayEnv) {
        return false;
      }
      const script = [
        "import ctypes, sys",
        "X = ctypes.CDLL('libX11.so.6')",
        "X.XOpenDisplay.restype = ctypes.c_void_p",
        "X.XOpenDisplay.argtypes = [ctypes.c_char_p]",
        "d = X.XOpenDisplay(None)",
        "if not d: sys.exit(3)",
        "X.XInternAtom.restype = ctypes.c_ulong",
        "X.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]",
        "wm_protocols = X.XInternAtom(d, b'WM_PROTOCOLS', False)",
        "wm_delete = X.XInternAtom(d, b'WM_DELETE_WINDOW', False)",
        "win = int(sys.argv[1])",
        "class Ev(ctypes.Structure):",
        "  _fields_ = [('type', ctypes.c_int), ('serial', ctypes.c_ulong), ('send_event', ctypes.c_int), ('display', ctypes.c_void_p), ('window', ctypes.c_ulong), ('message_type', ctypes.c_ulong), ('format', ctypes.c_int), ('data', ctypes.c_long * 5)]",
        "ev = Ev()",
        "ev.type = 33  # ClientMessage (X11/X.h)",
        "ev.serial = 0",
        "ev.send_event = 1  # True: synthetic event so the client can identify it",
        "ev.display = d",
        "ev.window = win",
        "ev.message_type = wm_protocols",
        "ev.format = 32",
        "ev.data[0] = wm_delete",
        "ev.data[1] = 0",
        "X.XSendEvent.restype = ctypes.c_int",
        "X.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.c_void_p]",
        "st = X.XSendEvent(d, win, 0, 0, ctypes.byref(ev))",
        // Set argtypes for XFlush too: without them ctypes truncates the
        // display pointer to c_int on x86_64 and XFlush segfaults, so the close
        // never reliably returns success.
        "X.XFlush.argtypes = [ctypes.c_void_p]",
        "X.XFlush(d)",
        "sys.exit(0 if st else 4)",
      ].join("\n");
      execFileSync("python3", ["-c", script, String(windowId)], {
        env: { ...process.env, DISPLAY: displayEnv },
        encoding: "utf8",
      });
      return true;
    } catch {
      return false;
    }
  }

  async assertCleanExit(): Promise<void> {
    assert(this.launch, "the AppImage was not launched");
    const exit = await waitForExit(this.launch.child, CLOSE_TIMEOUT_MS);
    this.exitInfo = { code: exit.code, signal: exit.signal };
    // AC-006 strict: the WM_DELETE close must terminate the packaged app with
    // exit code 0. A SIGTERM-terminated process is not an acceptance path.
    assert.strictEqual(
      exit.code,
      0,
      `the packaged IDE desktop did not exit cleanly after the WM_DELETE close (method=${this.closeMethod}, code=${exit.code}, signal=${exit.signal})`,
    );
  }

  async assertZeroSurvivingProcesses(): Promise<void> {
    assert(this.launch, "the AppImage was not launched");
    await sleep(SURVIVOR_SCAN_GRACE_MS);
    assert(this.artifactPath, "the AppImage artifact was not asserted");
    const survivors = findIdePackagingSurvivors(this.artifactPath);
    assert.strictEqual(
      survivors.length,
      0,
      `IDE desktop processes still survive after exit: ${survivors.map((s) => `pid ${s.pid} (${s.cmdline})`).join(", ")}`,
    );
  }

  evidence(): Readonly<Record<string, unknown>> {
    return {
      ...this.evidenceRecord,
      packaging: this.build
        ? {
            command: this.build.command,
            exitCode: this.build.code,
            signal: this.build.signal,
            durationMs: this.build.durationMs,
            stderrTail: this.build.stderr.slice(-2000),
            stdoutTail: this.build.stdout.slice(-2000),
          }
        : null,
      artifactPath: this.artifactPath,
      launch: this.launch
        ? { pid: this.launch.pid, cmdline: this.launch.cmdline, launchTime: this.launch.launchTime }
        : null,
      windowReady: { windowId: this.windowId, evidence: this.windowReadyEvidence },
      close: { method: this.closeMethod },
      cleanExit: this.exitInfo,
    };
  }

  async dispose(): Promise<void> {
    if (!this.launch) {
      return;
    }
    // The launched AppImage is an explicitly detached child, so its PID is the
    // process-group ID owned by this scenario. Never kill processes discovered
    // through command-line substring scans: an absent artifact path previously
    // produced an empty marker, which matched every process in /proc.
    try {
      process.kill(-this.launch.pid, "SIGKILL");
    } catch {
      // owned process group already gone
    }
    try {
      this.launch.child.kill("SIGKILL");
    } catch {
      // owned child already gone
    }
  }
}
