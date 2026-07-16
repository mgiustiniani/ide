import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, readlink, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { remote } from "webdriverio";

import {
  assertLayoutSnapshotSettled,
  assertPersistentToggle,
  LayoutGeometryAssertions,
  type ApplicationContentLayoutStorySession,
  type KeyboardResizeObservation,
  type LayoutSnapshot,
  type SeparatorSemantics,
} from "./application-content-layout.js";
import { captureApplicationLayoutFromDocument } from "./layout-dom-capture.js";

const DESKTOP_HEADER_SELECTOR = "#root > div > header";
const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const PANEL_TRANSITION_MS = 250;
const SETTLED_SAMPLE_MS = 75;
const DIAGNOSTIC_LIMIT = 16 * 1024;
const STATE_PATH_VARIABLES = [
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

type Browser = Awaited<ReturnType<typeof remote>>;
type DriverExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

interface NativeLayoutEvidence {
  readonly requirement: "REQ-LAYOUT-DESKTOP-001";
  readonly target: "desktop/tauri-webdriver";
  readonly kind: "tauri-webdriver";
  readonly artifactKind: "release-no-bundle";
  readonly nativeGui: true;
  readonly e2e: true;
  readonly packagedApplication: false;
  viewport?: { readonly width: number; readonly height: number };
  applicationProcessObserved?: boolean;
  applicationHeaderMeasured?: boolean;
  windowClosed?: boolean;
  executableExited?: boolean;
  sandboxPathsConfined?: boolean;
}

function requiredAbsoluteEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native layout Story requires absolute ${name}`);
  }
  return path.normalize(value);
}

function requiredPositiveIntegerEnvironment(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Native layout Story requires positive integer ${name}`);
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
        reject(new Error("Could not reserve a native layout Story TCP port"));
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

export class NativeApplicationContentLayoutSession implements ApplicationContentLayoutStorySession {
  readonly #sandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #desiredWidth = requiredPositiveIntegerEnvironment(
    "IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH",
  );
  readonly #desiredHeight = requiredPositiveIntegerEnvironment(
    "IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT",
  );
  readonly #geometry = new LayoutGeometryAssertions();
  readonly #nativeEvidence: NativeLayoutEvidence = {
    requirement: "REQ-LAYOUT-DESKTOP-001",
    target: "desktop/tauri-webdriver",
    kind: "tauri-webdriver",
    artifactKind: "release-no-bundle",
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
  };
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Browser;
  #applicationProcessId?: number;
  #sessionDeleted = false;
  #disposed = false;

  async launch(): Promise<void> {
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(this.#desiredWidth, 1440, "clarified native layout viewport width");
    assert.equal(this.#desiredHeight, 900, "clarified native layout viewport height");
    assert.equal(this.#driver, undefined, "native layout session already launched");
    await this.#assertSandboxPathsConfined();
    await Promise.all([
      access(this.#tauriDriverPath, fsConstants.X_OK),
      access(this.#webKitWebDriverPath, fsConstants.X_OK),
      access(this.#applicationPath, fsConstants.X_OK),
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
    const captureDiagnostic = (chunk: Buffer): void => {
      this.#driverDiagnostic = `${this.#driverDiagnostic}${chunk.toString("utf8")}`.slice(
        -DIAGNOSTIC_LIMIT,
      );
    };
    driver.stdout?.on("data", captureDiagnostic);
    driver.stderr?.on("data", captureDiagnostic);
    this.#driverExit = new Promise((resolve, reject) => {
      driver.once("error", reject);
      driver.once("exit", (code, signal) => resolve({ code, signal }));
    });

    try {
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
        "WebdriverIO native layout session start",
      );
      this.#applicationProcessId = await this.#waitForApplicationProcess();
      this.#nativeEvidence.applicationProcessObserved = true;
      await this.browser().setWindowSize(this.#desiredWidth, this.#desiredHeight);
      await this.browser().waitUntil(
        async () => {
          const viewport = await this.#documentViewport();
          return viewport.width === this.#desiredWidth && viewport.height === this.#desiredHeight;
        },
        {
          timeout: 5_000,
          interval: 50,
          timeoutMsg: `native document client size did not become ${this.#desiredWidth}x${this.#desiredHeight}`,
        },
      );
      const viewport = await this.#documentViewport();
      assert.deepEqual(viewport, { width: 1440, height: 900 });
      this.#nativeEvidence.viewport = viewport;
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  async assertApplicationRegionsAvailable(): Promise<void> {
    const browser = this.browser();
    const shell = await browser.$(".ide-shell");
    await shell.waitForDisplayed({ timeout: 15_000, interval: 100 });
    for (const selector of [
      DESKTOP_HEADER_SELECTOR,
      ".ide-workspace",
      ".activity-rail",
      ".ide-sidebar",
      ".ide-content-column",
      ".ide-main-editor-pane",
      ".ide-bottom-panel:not([hidden])",
      ".ide-shell > .statusbar",
      '[role="separator"][aria-label="Resize file explorer"]',
      '[role="separator"][aria-label="Resize bottom panel"]',
    ]) {
      await (await browser.$(selector)).waitForDisplayed({ timeout: 15_000, interval: 100 });
    }
    assert.deepEqual(await this.#documentViewport(), { width: 1440, height: 900 });
    this.#nativeEvidence.applicationHeaderMeasured = true;
  }

  async exercisePanelChanges(): Promise<void> {
    throw new Error("The native desktop layout session requires the clarified desktop action step");
  }

  async exerciseDesktopPanelChanges(): Promise<void> {
    this.#geometry.reset(true);
    this.#geometry.addSnapshot(await this.#captureSettled("expanded"));
    await this.#resizeWithKeyboard("left sidebar", "ArrowRight");
    this.#geometry.addSnapshot(await this.#captureSettled("left-sidebar-keyboard-resized"));
    await this.#resizeWithKeyboard("bottom panel", "ArrowUp");
    this.#geometry.addSnapshot(await this.#captureSettled("bottom-panel-keyboard-resized"));

    await this.#clickToggle("Collapse sidebar", "true");
    await this.#waitForAbsent('[role="separator"][aria-label="Resize file explorer"]');
    const sidebarCollapsed = await this.#captureSettled("left-sidebar-collapsed");
    this.#geometry.addSnapshot(sidebarCollapsed);
    assertPersistentToggle(sidebarCollapsed, "sidebar", false);

    await this.#clickToggle("Expand sidebar", "false");
    await this.#waitForDisplayed('[role="separator"][aria-label="Resize file explorer"]');
    const sidebarReexpanded = await this.#captureSettled("left-sidebar-re-expanded");
    this.#geometry.addSnapshot(sidebarReexpanded);
    assertPersistentToggle(sidebarReexpanded, "sidebar", true);

    await this.#clickToggle("Collapse bottom panel", "true");
    await this.#waitForAbsent('[role="separator"][aria-label="Resize bottom panel"]');
    const bottomCollapsed = await this.#captureSettled("bottom-panel-collapsed");
    this.#geometry.addSnapshot(bottomCollapsed);
    assertPersistentToggle(bottomCollapsed, "bottom panel", false);

    await this.#clickToggle("Expand bottom panel", "false");
    await this.#waitForDisplayed('[role="separator"][aria-label="Resize bottom panel"]');
    const bottomReexpanded = await this.#captureSettled("bottom-panel-re-expanded");
    this.#geometry.addSnapshot(bottomReexpanded);
    assertPersistentToggle(bottomReexpanded, "bottom panel", true);

    await this.#closeWindowAndAssertExit();
  }

  assertFullHeightNavigation(): void {
    this.#geometry.assertFullHeightNavigation();
  }
  assertEditorSideBottomPanel(): void {
    this.#geometry.assertEditorSideBottomPanel();
  }
  assertChromeAndStatusBarSeparate(): void {
    this.#geometry.assertChromeAndStatusBarSeparate();
  }
  assertChromeAndStatusBarStable(): void {
    this.#geometry.assertChromeAndStatusBarStable();
  }
  assertKeyboardResizeAndAccessibility(): void {
    this.#geometry.assertKeyboardResizeAndAccessibility();
  }

  evidence(): Readonly<Record<string, unknown>> {
    return { ...this.#nativeEvidence, ...this.#geometry.evidence() };
  }

  redactedDiagnostics(): string {
    return this.#driverDiagnostic
      .replaceAll(this.#sandbox, "<SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>")
      .replace(/\b(password|token|secret)=\S+/giu, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'"]+\/?)+/gu, "<PATH>")
      .slice(-DIAGNOSTIC_LIMIT);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const browser = this.#browser;
    this.#browser = undefined;
    if (browser && !this.#sessionDeleted) {
      try {
        await bounded(browser.deleteSession(), 2_000, "native layout WebDriver cleanup");
        this.#sessionDeleted = true;
      } catch {
        // Continue with process-owned cleanup.
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
      await wait(250);
      if (await processExists(applicationProcessId)) {
        try {
          process.kill(applicationProcessId, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }
  }

  private browser(): Browser {
    if (!this.#browser) throw new Error("native layout WebdriverIO session is unavailable");
    return this.#browser;
  }

  async #resizeWithKeyboard(
    separatorName: KeyboardResizeObservation["separator"],
    key: "ArrowRight" | "ArrowUp",
  ): Promise<void> {
    const selector =
      separatorName === "left sidebar"
        ? '[role="separator"][aria-label="Resize file explorer"]'
        : '[role="separator"][aria-label="Resize bottom panel"]';
    const separator = await this.browser().$(selector);
    const before = await this.#separatorSemantics(selector);
    const extentBefore = await this.#panelExtent(separatorName);
    await this.browser().execute((candidateSelector) => {
      document.querySelector<HTMLElement>(candidateSelector)?.focus();
    }, selector);
    assert.equal(
      await this.browser().execute(
        (candidateSelector) => document.activeElement === document.querySelector(candidateSelector),
        selector,
      ),
      true,
      `${separatorName} separator did not receive keyboard focus`,
    );
    await this.browser().keys([key]);
    await this.browser().waitUntil(
      async () => Number(await separator.getAttribute("aria-valuenow")) === before.valueNow + 10,
      { timeout: 5_000, interval: 25 },
    );
    await wait(PANEL_TRANSITION_MS);
    this.#geometry.addKeyboardResize({
      separator: separatorName,
      before,
      after: await this.#separatorSemantics(selector),
      extentBefore,
      extentAfter: await this.#panelExtent(separatorName),
    });
  }

  async #clickToggle(label: string, expanded: "true" | "false"): Promise<void> {
    const selector = `button[aria-label="${label}"]`;
    const toggle = await this.browser().$(selector);
    assert.equal(await toggle.isExisting(), true, `Required accessible ${label} toggle is missing`);
    assert.equal(await toggle.isDisplayed(), true, `${label} toggle is not displayed`);
    assert.equal(await toggle.getAttribute("aria-expanded"), expanded);
    await toggle.click();
  }

  async #separatorSemantics(selector: string): Promise<SeparatorSemantics> {
    const separator = await this.browser().$(selector);
    assert.equal(await separator.isExisting(), true, `Required separator is absent: ${selector}`);
    return {
      label: await separator.getAttribute("aria-label"),
      orientation: await separator.getAttribute("aria-orientation"),
      valueMin: Number(await separator.getAttribute("aria-valuemin")),
      valueNow: Number(await separator.getAttribute("aria-valuenow")),
      tabIndex: Number(await separator.getAttribute("tabindex")),
    };
  }

  async #panelExtent(separatorName: KeyboardResizeObservation["separator"]): Promise<number> {
    const selector = separatorName === "left sidebar" ? ".ide-sidebar" : ".ide-bottom-panel";
    return await this.browser().execute(
      (candidateSelector, dimension) => {
        const element = document.querySelector<HTMLElement>(candidateSelector);
        if (!element) throw new Error(`Could not measure ${candidateSelector}`);
        const bounds = element.getBoundingClientRect();
        return dimension === "width" ? bounds.width : bounds.height;
      },
      selector,
      separatorName === "left sidebar" ? "width" : "height",
    );
  }

  async #captureSettled(change: string): Promise<LayoutSnapshot> {
    await wait(PANEL_TRANSITION_MS);
    const first = await this.#capture(change);
    await wait(SETTLED_SAMPLE_MS);
    const second = await this.#capture(change);
    assertLayoutSnapshotSettled(first, second);
    return second;
  }

  async #capture(change: string): Promise<LayoutSnapshot> {
    return await this.browser().execute(captureApplicationLayoutFromDocument, {
      change,
      headerSelector: DESKTOP_HEADER_SELECTOR,
    });
  }

  async #documentViewport(): Promise<{ width: number; height: number }> {
    return await this.browser().execute(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
  }

  async #waitForDisplayed(selector: string): Promise<void> {
    await (await this.browser().$(selector)).waitForDisplayed({ timeout: 5_000, interval: 25 });
  }

  async #waitForAbsent(selector: string): Promise<void> {
    await this.browser().waitUntil(
      async () => !(await (await this.browser().$(selector)).isExisting()),
      {
        timeout: 5_000,
        interval: 25,
        timeoutMsg: `${selector} remained present`,
      },
    );
  }

  async #closeWindowAndAssertExit(): Promise<void> {
    const browser = this.browser();
    assert.ok((await bounded(browser.getWindowHandles(), 2_000, "window handle query")).length > 0);
    try {
      await bounded(browser.closeWindow(), 5_000, "native layout window close");
    } catch (error) {
      assert.equal(
        error instanceof Error ? error.message : String(error),
        "All window handles were removed, causing WebdriverIO to close the session.",
      );
    }
    this.#nativeEvidence.windowClosed = true;
    const processId = this.#applicationProcessId;
    assert.ok(processId, "release executable process was not observed");
    const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
    while (await processExists(processId)) {
      if (Date.now() >= deadline) {
        assert.fail(`release executable process ${processId} did not exit after its window closed`);
      }
      await wait(50);
    }
    this.#nativeEvidence.executableExited = true;
  }

  async #assertSandboxPathsConfined(): Promise<void> {
    const canonicalSandbox = await realpath(this.#sandbox);
    for (const variable of STATE_PATH_VARIABLES) {
      const configuredPath = requiredAbsoluteEnvironment(variable);
      assert.ok(isContained(this.#sandbox, configuredPath), `${variable} escaped the sandbox`);
      assert.ok(
        isContained(canonicalSandbox, await realpath(configuredPath)),
        `${variable} escaped through a symbolic link`,
      );
    }
    this.#nativeEvidence.sandboxPathsConfined = true;
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
        // Retry to the bounded readiness deadline.
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
}
