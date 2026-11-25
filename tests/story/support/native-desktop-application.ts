import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { access, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { remote } from "webdriverio";
import { nativeFileExplorerDisplayed } from "./native-file-explorer-readiness.js";
import { signalDriverProcessGroup } from "./native-driver-process.js";
import {
  nativeStartupDomObservation,
  recordNativeStartupObservation,
} from "./native-startup-observation.js";
import {
  captureOwnedApplication,
  signalOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";

export const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
export async function bounded<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function requiredPath(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value))
    throw new Error(`Native desktop acceptance requires absolute ${name}`);
  return path.normalize(value);
}
async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
async function children(pid: number): Promise<number[]> {
  try {
    return (await readFile(`/proc/${pid}/task/${pid}/children`, "utf8"))
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}
async function appImageDesktopDescendant(
  appImagePid: number,
  appImagePath: string,
): Promise<{ pid: number; executable: string } | undefined> {
  const pending = await children(appImagePid);
  const visited = new Set<number>();
  while (pending.length) {
    const child = pending.shift()!;
    if (visited.has(child)) continue;
    visited.add(child);
    try {
      const [name, executable, environment] = await Promise.all([
        readFile(`/proc/${child}/comm`, "utf8"),
        readlink(`/proc/${child}/exe`),
        readFile(`/proc/${child}/environ`, "utf8"),
      ]);
      const appImage = environment
        .split("\0")
        .find((variable) => variable.startsWith("APPIMAGE="))
        ?.slice("APPIMAGE=".length);
      if (name.trim() === "ide-desktop" && appImage && path.resolve(appImage) === appImagePath)
        return { pid: child, executable };
    } catch {
      /* The AppImage may replace or exit a child while it is discovered. */
    }
    pending.push(...(await children(child)));
  }
  return undefined;
}

async function ownedApplicationDescendant(
  pid: number,
  executable: string,
): Promise<{ pid: number; executable: string } | undefined> {
  const appImage = path.extname(executable).toLowerCase() === ".appimage";
  const pending = await children(pid);
  const visited = new Set<number>();
  while (pending.length) {
    const child = pending.shift()!;
    if (visited.has(child)) continue;
    visited.add(child);
    try {
      if ((await readlink(`/proc/${child}/exe`)) === executable) {
        if (!appImage) return { pid: child, executable };
        const desktop = await appImageDesktopDescendant(child, executable);
        if (desktop) return desktop;
      }
    } catch {
      /* The driver or AppImage may exit during bounded discovery. */
    }
    pending.push(...(await children(child)));
  }
  return undefined;
}

/** An owned Linux release/no-bundle GUI process. No mocked IPC or private editor APIs. */
export class NativeDesktopApplication {
  readonly #applicationPath = requiredPath("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #driverPath = requiredPath("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitPath = requiredPath("IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH");
  readonly #sandbox = requiredPath("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #workspace = requiredPath("IDE_WORKSPACE_ROOT");
  readonly #ideHome = requiredPath("IDE_HOME");
  #driver?: ChildProcess;
  #driverExit?: Promise<unknown>;
  #browser?: Awaited<ReturnType<typeof remote>>;
  #identity?: OwnedApplicationIdentity;
  #diagnostics = "";
  #closed = false;
  #forced = false;
  #nativeCloseRequests = 0;

  constructor(private readonly driverCommandPrefix: readonly string[] = []) {}

  browser(): Awaited<ReturnType<typeof remote>> {
    assert.ok(this.#browser, "native browser session is unavailable");
    return this.#browser;
  }
  evidence() {
    return {
      applicationObserved: this.#identity !== undefined,
      forcedTermination: this.#forced,
      windowClosed: this.#closed,
      nativeCloseRequests: this.#nativeCloseRequests,
    };
  }
  async environmentValue(
    name:
      | "BROWSER"
      | "XDG_CURRENT_DESKTOP"
      | "IDE_STORY_OAUTH_BROWSER_ROOT"
      | "HOME"
      | "LC_ALL"
      | "PATH"
      | "IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE"
      | "IDE_REFACTORKIT_DAEMON"
      | "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE"
      | "IDE_REFACTORKIT_ENGINE"
      | "IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE"
      | "IDE_REFACTORKIT_LSP"
      | "IDE_JDTLS_HOME"
      | "IDE_JDTLS_JAVA_HOME"
      | "IDE_JAVA_HOME"
      | "JAVA_HOME"
      | "IDE_JAVA_CONTEXT_TRACE"
      | "IDE_JAVA_CONTEXT_TRACE_PATH"
      | "IDE_WORKSPACE_ROOT",
  ) {
    assert.ok(this.#identity, "owned application has not been observed");
    const variables = (await readFile(`/proc/${this.#identity.pid}/environ`, "utf8")).split("\0");
    return variables.find((variable) => variable.startsWith(`${name}=`))?.slice(name.length + 1);
  }
  redactedDiagnostics(contents: readonly string[] = []): string {
    let text = this.#diagnostics
      .replaceAll(this.#sandbox, "<SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>");
    for (const content of contents) text = text.replaceAll(content, "<FIXTURE_CONTENT>");
    return text
      .replace(/\b(password|token|secret)=\S+/gi, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'\"]+\/?)+/g, "<PATH>")
      .slice(-16 * 1024);
  }
  async launch(extraEnvironment: Record<string, string> = {}): Promise<void> {
    assert.equal(this.#driver, undefined, "native application already launched");
    await Promise.all(
      [
        this.#applicationPath,
        this.#driverPath,
        this.#webKitPath,
        ...this.driverCommandPrefix.slice(0, 1),
      ].map((file) => access(file, constants.X_OK)),
    );
    const executable = await realpath(this.#applicationPath);
    const [driverPort, nativePort] = await Promise.all([port(), port()]);
    assert.notEqual(driverPort, nativePort);
    const driver = spawn(
      this.driverCommandPrefix[0] ?? this.#driverPath,
      [
        ...this.driverCommandPrefix.slice(1),
        ...(this.driverCommandPrefix.length ? [this.#driverPath] : []),
        "--port",
        String(driverPort),
        "--native-port",
        String(nativePort),
        "--native-host",
        "127.0.0.1",
        "--native-driver",
        this.#webKitPath,
      ],
      {
        detached: process.platform !== "win32",
        env: { ...process.env, ...extraEnvironment },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.#driver = driver;
    const capture = (chunk: Buffer) => {
      this.#diagnostics = (this.#diagnostics + chunk.toString("utf8")).slice(-16 * 1024);
    };
    driver.stdout?.on("data", capture);
    driver.stderr?.on("data", capture);
    this.#driverExit = new Promise((resolve) => {
      driver.once("error", resolve);
      driver.once("exit", resolve);
    });
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      assert.equal(driver.exitCode, null, "tauri-driver exited before readiness");
      try {
        if (
          (
            await fetch(`http://127.0.0.1:${driverPort}/status`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {
        /* bounded startup retry */
      }
      await delay(50);
    }
    const diagnostics = ready ? "" : this.redactedDiagnostics();
    assert.ok(
      ready,
      `tauri-driver did not become ready within 10000ms${diagnostics ? `\n${diagnostics}` : ""}`,
    );
    this.#browser = await bounded(
      remote({
        hostname: "127.0.0.1",
        port: driverPort,
        path: "/",
        logLevel: "silent",
        connectionRetryCount: 0,
        connectionRetryTimeout: 20_000,
        capabilities: { "tauri:options": { application: this.#applicationPath } } as Parameters<
          typeof remote
        >[0]["capabilities"],
      }),
      20_000,
      "native GUI session startup",
    ).catch((error: unknown) => {
      const diagnostics = this.redactedDiagnostics();
      if (!diagnostics) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason}\n${diagnostics}`, { cause: error });
    });
    const processDeadline = Date.now() + 5_000;
    while (Date.now() < processDeadline) {
      const application = await ownedApplicationDescendant(driver.pid!, executable);
      if (application !== undefined) {
        this.#identity = await captureOwnedApplication(application.pid, {
          executable: application.executable,
          sandbox: this.#sandbox,
          workspace: this.#workspace,
          ideHome: this.#ideHome,
        });
        return;
      }
      await delay(50);
    }
    throw new Error("owned production application was not observed under tauri-driver");
  }
  async waitForFileExplorer(rowSelector?: string): Promise<void> {
    try {
      await this.browser().waitUntil(() => nativeFileExplorerDisplayed(this.browser(), rowSelector), {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: rowSelector
          ? `File Explorer did not display ${rowSelector} within 15000ms`
          : "File Explorer was not displayed within 15000ms",
      });
    } catch (error) {
      const startup = await this.recordStartup("timeout");
      this.#diagnostics += `\nStartup DOM: ${JSON.stringify(startup)}`;
      // Keep the original WebDriver failure, including its deadline and type.
      try {
        if (error instanceof Error)
          error.message += `\nStartup observation: ${JSON.stringify(startup)}`;
      } catch {
        /* Artifact retention must not mask the original failure. */
      }
      throw error;
    }
    await this.recordStartup("ready");
  }
  private recordStartup(outcome: "ready" | "timeout" | "close-timeout") {
    return recordNativeStartupObservation({
      sandbox: this.#sandbox,
      outcome,
      applicationPid: this.#identity?.pid,
      capture: () => this.browser().execute(nativeStartupDomObservation),
    });
  }
  async assertRunning(): Promise<void> {
    assert.ok(this.#identity, "owned process identity unavailable");
    const observed = await captureOwnedApplication(this.#identity.pid, this.#identity);
    assert.equal(
      observed.startTime,
      this.#identity.startTime,
      "owned application identity changed",
    );
    assert.ok(
      (await bounded(this.browser().getWindowHandles(), 2_000, "native window handles")).length > 0,
    );
  }
  /** Drive the owned native export chooser with X11 keys, confined to this test sandbox. */
  async chooseSqlResultExport(destination: string | null, replaceExisting = false) {
    return this.chooseOwnedExport(destination, replaceExisting, "sql");
  }
  async chooseHttpCollectionExport(destination: string | null, replaceExisting = false) {
    return this.chooseOwnedExport(destination, replaceExisting, "http");
  }
  private async chooseOwnedExport(destination: string | null, replaceExisting: boolean, kind: "http" | "sql") {
    await this.assertRunning();
    if (destination !== null) {
      const relative = path.relative(this.#sandbox, destination);
      assert.ok(
        path.isAbsolute(destination) &&
          !path.isAbsolute(relative) &&
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`),
      );
    }
    const script = fileURLToPath(new URL("./native-x11-save-dialog.py", import.meta.url));
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      [
        script,
        String(this.#identity!.pid),
        destination ?? "--cancel",
        replaceExisting ? "replace" : "new",
        kind,
      ],
      {
        encoding: "utf8",
        timeout: 18000,
        maxBuffer: 8192,
        env: { ...process.env, GDK_BACKEND: "x11" },
      },
    );
    const proof = JSON.parse(stdout);
    assert.equal(proof.ownerPid, this.#identity!.pid);
    assert.equal(proof.title, kind === "sql" ? "Export captured SQL result (plain text)" : "Export HTTP collections (plain text)");
    assert.equal(proof.cancelled, destination === null);
    return proof as {
      ownerPid: number;
      title: string;
      cancelled: boolean;
      replaceConfirmed: boolean;
    };
  }
  async requestNativeWindowClose(): Promise<void> {
    await this.assertRunning();
    if (process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland") {
      await this.requestKwinWindowClose();
      this.#nativeCloseRequests += 1;
      return;
    }
    const script = fileURLToPath(new URL("./native-x11-close.py", import.meta.url));
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      [script, String(this.#identity!.pid)],
      { encoding: "utf8", timeout: 3_000, maxBuffer: 16 * 1024 },
    );
    const result = JSON.parse(stdout) as { windowId: number; closeRequested: boolean };
    assert.ok(Number.isSafeInteger(result.windowId) && result.windowId > 0);
    assert.equal(result.closeRequested, true);
    this.#nativeCloseRequests += 1;
  }
  private async requestKwinWindowClose(): Promise<void> {
    const pid = this.#identity!.pid;
    const socket = requiredPath("WAYLAND_DISPLAY");
    const environment = (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0");
    assert.ok(environment.includes(`WAYLAND_DISPLAY=${socket}`));
    assert.ok(!environment.some((value) => value.startsWith("DISPLAY=") || value === "GDK_BACKEND=x11"));
    const name = `ide-close-${randomUUID()}`;
    const script = path.join(requiredPath("IDE_STORY_NATIVE_GUI_ARTIFACT_PATH"), `${name}.js`);
    await writeFile(script, `
      const windows = workspace.windowList().filter((window) => window.pid === ${pid} && window.closeable);
      if (windows.length !== 1) throw new Error("Expected one closeable IDE window for the owned process");
      windows[0].closeWindow();
    `, { flag: "wx" });
    const qdbus = requiredPath("IDE_STORY_NATIVE_GUI_QDBUS6_PATH");
    const call = (...args: string[]) => promisify(execFile)(qdbus, ["org.kde.KWin", ...args], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024,
    });
    const { stdout } = await call("/Scripting", "org.kde.kwin.Scripting.loadScript", script, name);
    const scriptId = stdout.trim();
    assert.match(scriptId, /^\d+$/u);
    try {
      await call(`/Scripting/Script${scriptId}`, "run");
    } finally {
      await call("/Scripting", "org.kde.kwin.Scripting.unloadScript", name);
    }
  }
  async closeNativeWindow(): Promise<void> {
    await this.requestNativeWindowClose();
    try {
      await this.assertExited();
    } catch (error) {
      const observation = await this.recordStartup("close-timeout");
      this.#diagnostics += `\nClose DOM: ${JSON.stringify(observation)}`;
      throw error;
    }
    this.#closed = true;
  }
  async forceTerminate(expectedPid?: number): Promise<void> {
    assert.ok(this.#identity, "owned application has not been observed");
    if (expectedPid !== undefined) assert.equal(this.#identity.pid, expectedPid);
    await signalOwnedApplication(this.#identity, "SIGKILL");
    await this.assertExited();
    this.#forced = true;
  }
  async closeWindow(): Promise<void> {
    assert.ok(
      (await bounded(this.browser().getWindowHandles(), 2_000, "native window handles")).length > 0,
    );
    try {
      await bounded(this.browser().closeWindow(), 5_000, "native window close");
    } catch (error) {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "All window handles were removed, causing WebdriverIO to close the session.",
      );
    }
    await this.assertExited();
    this.#closed = true;
  }
  async assertExited(): Promise<void> {
    assert.ok(this.#identity, "owned process identity unavailable");
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await access(`/proc/${this.#identity.pid}`, constants.F_OK);
      } catch {
        return;
      }
      await delay(50);
    }
    let processState = "unavailable";
    let childPids: number[] = [];
    let childDetails: string[] = [];
    try {
      const stat = await readFile(`/proc/${this.#identity.pid}/stat`, "utf8");
      processState =
        stat
          .slice(stat.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/)[0] ?? "unknown";
      childPids = await children(this.#identity.pid);
      childDetails = await Promise.all(
        childPids.map(async (pid) => {
          try {
            const [name, childStat] = await Promise.all([
              readFile(`/proc/${pid}/comm`, "utf8"),
              readFile(`/proc/${pid}/stat`, "utf8"),
            ]);
            const state = childStat
              .slice(childStat.lastIndexOf(")") + 2)
              .trim()
              .split(/\s+/)[0];
            return `${pid}:${name.trim()}:${state ?? "unknown"}`;
          } catch {
            return `${pid}:exited`;
          }
        }),
      );
    } catch {
      /* Preserve the timeout and report the last observable process state. */
    }
    throw new Error(
      `owned application did not exit within 15000ms (state=${processState}, children=${childDetails.length ? childDetails.join(",") : childPids.join(",")})`,
    );
  }
  async dispose(): Promise<void> {
    const browser = this.#browser;
    this.#browser = undefined;
    if (browser) {
      try {
        await bounded(browser.deleteSession(), 2_000, "native GUI session cleanup");
      } catch {
        /* driver cleanup continues after a crash */
      }
    }
    const driver = this.#driver;
    this.#driver = undefined;
    if (driver && this.#driverExit) {
      if (driver.exitCode === null && driver.signalCode === null)
        signalDriverProcessGroup(driver, "SIGTERM");
      await Promise.race([this.#driverExit, delay(2_000)]);
      signalDriverProcessGroup(driver, "SIGKILL");
      await Promise.race([this.#driverExit, delay(1_000)]);
    }
    if (this.#identity) {
      try {
        await signalOwnedApplication(this.#identity, "SIGKILL");
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          (error as NodeJS.ErrnoException).code !== "ESRCH"
        )
          throw error;
      }
    }
  }
}
