import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, readlink, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { remote } from "webdriverio";

import {
  NativeScenarioEnvironmentLease,
  type NativeScenarioEnvironmentEvidence,
} from "./native-scenario-environment.js";

export const NATIVE_OPEN_PROOF_FILE = "native-open-proof.ts";
export const NATIVE_OPEN_PROOF_CONTENT =
  'export const nativeOpenProof = "REQ-DESKTOP-FILE-OPEN-001";';

const DRIVER_START_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 20_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;

interface DriverExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface NativeEvidence {
  target: "desktop/tauri-webdriver";
  artifactKind: "release-no-bundle";
  nativeGui: true;
  e2e: true;
  fixture?: string;
  applicationProcessObserved?: boolean;
  fileExplorerReady?: boolean;
  accessibleFileItem?: string;
  selectedPath?: string;
  selectedPathSource?: string;
  activeEditorTab?: string;
  monacoContentMatched?: boolean;
  responsive?: boolean;
  windowClosed?: boolean;
  executableExited?: boolean;
  sandboxConfined?: boolean;
  scenarioEnvironment?: Readonly<NativeScenarioEnvironmentEvidence>;
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
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`Native desktop Story requires absolute ${name}`);
  }
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
        reject(new Error("Could not reserve a native desktop Story TCP port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
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
    const children = await readFile(`/proc/${processId}/task/${processId}/children`, "utf8");
    return children.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
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

export class NativeDesktopFileOpenSession {
  readonly #sandbox = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_SANDBOX_PATH");
  readonly #tauriDriverPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_TAURI_DRIVER_PATH");
  readonly #webKitWebDriverPath = requiredAbsoluteEnvironment(
    "IDE_STORY_NATIVE_GUI_WEBKIT_WEBDRIVER_PATH",
  );
  readonly #applicationPath = requiredAbsoluteEnvironment("IDE_STORY_NATIVE_GUI_APPLICATION_PATH");
  readonly #evidence: NativeEvidence = {
    target: "desktop/tauri-webdriver",
    artifactKind: "release-no-bundle",
    nativeGui: true,
    e2e: true,
  };
  #lease?: NativeScenarioEnvironmentLease;
  #fixtureName?: string;
  #fixtureContent?: string;
  #driver?: ChildProcess;
  #driverExit?: Promise<DriverExit>;
  #driverDiagnostic = "";
  #browser?: Awaited<ReturnType<typeof remote>>;
  #applicationProcessId?: number;
  #clickDeadline?: number;
  #sessionDeleted = false;

  async assertSandboxReady(): Promise<void> {
    assert.equal(
      process.env.IDE_STORY_NATIVE_GUI_TARGET,
      "desktop/tauri-webdriver",
      "native GUI target must come from the owned runner",
    );
    assert.equal(this.#lease, undefined, "native file-open scenario environment already allocated");
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-DESKTOP-FILE-OPEN-001");
    assert.equal(this.#lease.runnerSandbox, this.#sandbox);
    await this.#lease.assertConfiguredPathsConfined();
    assert.deepEqual(
      await readdir(this.workspace()),
      [],
      "the authorized workspace must start empty",
    );
  }

  async createFixture(fileName: string): Promise<void> {
    assert.equal(fileName, NATIVE_OPEN_PROOF_FILE);
    assert.match(fileName, /^[A-Za-z0-9._-]+$/, "fixture must be a root basename");
    assert.equal(this.#fixtureName, undefined, "native file-open fixture already exists");
    const fixturePath = path.join(this.workspace(), fileName);
    assert.ok(isContained(this.workspace(), fixturePath));
    await writeFile(fixturePath, "", { encoding: "utf8", flag: "wx" });
    this.#fixtureName = fileName;
    this.#evidence.fixture = fileName;
  }

  async setExactFixtureContent(content: string): Promise<void> {
    assert.equal(content, NATIVE_OPEN_PROOF_CONTENT);
    const fixturePath = this.fixturePath();
    await writeFile(fixturePath, content, { encoding: "utf8", flag: "w" });
    assert.equal(await readFile(fixturePath, "utf8"), content);
    this.#fixtureContent = content;
  }

  async launch(): Promise<void> {
    assert.equal(this.#fixtureContent, NATIVE_OPEN_PROOF_CONTENT, "fixture content is not ready");
    assert.equal(this.#driver, undefined, "native desktop session already launched");
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
      await this.#waitForDriver(port);
      this.#browser = await Promise.race([
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
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("WebdriverIO wry session start exceeded 20000ms")),
            SESSION_START_TIMEOUT_MS,
          ),
        ),
      ]);
      this.#applicationProcessId = await this.#waitForApplicationProcess();
      this.#evidence.applicationProcessObserved = true;
    } catch (error) {
      await this.dispose();
      throw new Error(`${String(error)}\n${this.redactedDiagnostics()}`);
    }
  }

  async waitForFileExplorer(): Promise<void> {
    const explorer = await this.browser().$('[role="tree"][aria-label="File Explorer"]');
    await explorer.waitForDisplayed({ timeout: 15_000, interval: 100 });
    assert.equal(await explorer.getAttribute("role"), "tree");
    assert.equal(await explorer.getAttribute("aria-label"), "File Explorer");
    this.#evidence.fileExplorerReady = true;
  }

  async assertAccessibleFileItem(fileName: string): Promise<void> {
    assert.equal(fileName, this.#fixtureName);
    const item = await this.fileItem(fileName);
    await item.waitForDisplayed({ timeout: 15_000, interval: 100 });
    assert.equal(await item.getAttribute("role"), "treeitem");
    assert.equal(await item.getComputedLabel(), fileName);
    this.#evidence.accessibleFileItem = fileName;
  }

  async clickFileItem(): Promise<void> {
    const item = await this.fileItem(this.requiredFixtureName());
    this.#clickDeadline = Date.now() + 15_000;
    await item.click();
  }

  async assertSelectedPathWithin(seconds: number, fileName: string): Promise<void> {
    this.assertSharedDeadline(seconds, fileName);
    const item = await this.fileItem(fileName);
    await this.browser().waitUntil(
      async () => (await item.getAttribute("aria-selected")) === "true",
      {
        timeout: this.remainingClickTime(),
        interval: 50,
        timeoutMsg: `${fileName} did not expose selected file-tree state within ${seconds}s`,
      },
    );
    const selectedSourcePath = await item.getAttribute("data-path");
    if (selectedSourcePath === null) throw new Error("selected file item has no data-path");
    const selectedPath = path.resolve(this.workspace(), selectedSourcePath);
    assert.equal(selectedPath, this.fixturePath());
    this.#evidence.selectedPath = selectedPath;
    this.#evidence.selectedPathSource = selectedSourcePath;
  }

  async assertActiveTabWithin(seconds: number, fileName: string): Promise<void> {
    this.assertSharedDeadline(seconds, fileName);
    const selector = `[role="tab"][data-path="${cssAttribute(fileName)}"]`;
    const tab = await this.browser().$(selector);
    let observedTabs = "[]";
    try {
      await this.browser().waitUntil(
        async () => {
          const tabs = await this.browser().$$('[role="tab"]').getElements();
          observedTabs = JSON.stringify(
            await Promise.all(
              tabs.slice(0, 20).map(async (candidate) => ({
                path: await candidate.getAttribute("data-path"),
                selected: await candidate.getAttribute("aria-selected"),
                label: (await candidate.getComputedLabel()).slice(0, 100),
              })),
            ),
          ).slice(0, 4_096);
          return (await tab.isDisplayed()) && (await tab.getAttribute("aria-selected")) === "true";
        },
        {
          timeout: this.remainingClickTime(),
          interval: 50,
          timeoutMsg: `${fileName} did not become the selected editor tab within ${seconds}s`,
        },
      );
    } catch (error) {
      const alerts = await this.browser().$$('[role="alert"]').getElements();
      const alertDiagnostics = JSON.stringify(
        await Promise.all(
          alerts.slice(0, 10).map(async (alert) => (await alert.getText()).slice(0, 200)),
        ),
      ).slice(0, 2_048);
      const openingPlaceholder = await this.browser()
        .$('[data-testid="editor-opening-placeholder"]')
        .isExisting();
      const failurePlaceholder = await this.browser()
        .$('[data-testid="editor-failure-placeholder"]')
        .isExisting();
      throw new Error(
        `${String(error)}; bounded tab diagnostics: ${observedTabs}; alerts: ${alertDiagnostics}; opening: ${openingPlaceholder}; failure: ${failurePlaceholder}`,
      );
    }
    assert.equal(await tab.getAttribute("data-path"), fileName);
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    assert.equal(await tab.getComputedLabel(), `${fileName} Close ${fileName}`);
    const declaredAccessibleName =
      (await tab.getAttribute("aria-label")) ?? (await tab.getAttribute("title"));
    assert.equal(declaredAccessibleName, fileName);
    this.#evidence.activeEditorTab = fileName;
  }

  async assertMonacoContentWithin(seconds: number, fileName: string): Promise<void> {
    this.assertSharedDeadline(seconds, fileName);
    const label = `Code editor for ${fileName}`;
    const editor = await this.browser().$(`[role="textbox"][aria-label^="${cssAttribute(label)}"]`);
    await editor.waitForDisplayed({ timeout: this.remainingClickTime(), interval: 50 });
    await this.browser().waitUntil(
      async () => {
        const inputValue = await editor.getValue();
        const renderedValue = await this.browser().execute(() =>
          Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"))
            .map((line) => line.textContent ?? "")
            .join("\n")
            .replaceAll("\u00a0", " "),
        );
        return inputValue === this.#fixtureContent || renderedValue === this.#fixtureContent;
      },
      {
        timeout: this.remainingClickTime(),
        interval: 50,
        timeoutMsg: `${fileName} did not expose its exact logical Monaco content within ${seconds}s`,
      },
    );
    const editorLabel = await editor.getAttribute("aria-label");
    assert.ok(editorLabel?.startsWith(label));
    this.#evidence.monacoContentMatched = true;
  }

  async assertNoOpeningOrFailure(): Promise<void> {
    assert.equal(
      await this.browser().$('[data-testid="editor-opening-placeholder"]').isExisting(),
      false,
    );
    assert.equal(
      await this.browser().$('[data-testid="editor-failure-placeholder"]').isExisting(),
      false,
    );
    const alerts = await this.browser().$$('[role="alert"]');
    for (const alert of alerts) {
      const text = await alert.getText();
      assert.doesNotMatch(text, /Problema apertura file|Editor could not be opened/i);
    }
  }

  async assertResponsive(): Promise<void> {
    const response = await Promise.race([
      this.browser().execute(() => ({
        readyState: document.readyState,
        visible: document.visibilityState === "visible",
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      })),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("native window responsiveness check exceeded 2000ms")),
          2_000,
        ),
      ),
    ]);
    assert.equal(response.readyState, "complete");
    assert.equal(response.visible, true);
    assert.ok(response.width > 0 && response.height > 0);
    this.#evidence.responsive = true;
  }

  async closeNativeWindow(): Promise<void> {
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
    this.#evidence.windowClosed = true;
  }

  async assertExecutableExited(): Promise<void> {
    try {
      assert.equal(this.#evidence.windowClosed, true, "native window has not been closed");
      const processId = this.#applicationProcessId;
      assert.ok(processId, "release executable process was not observed");
      const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
      while (await processExists(processId)) {
        if (Date.now() >= deadline) {
          assert.fail(
            `release executable process ${processId} did not exit after its window closed`,
          );
        }
        await wait(50);
      }
      this.#evidence.executableExited = true;
    } finally {
      await this.#lease?.restoreEnvironment();
    }
  }

  async assertSandboxConfinement(): Promise<void> {
    await this.assertExecutableExited();
    assert.deepEqual(await readdir(this.workspace()), [".ide", this.requiredFixtureName()]);
    assert.equal(await readFile(this.fixturePath(), "utf8"), this.#fixtureContent);
    const workspaceStateDirectory = path.join(this.workspace(), ".ide");
    assert.ok(isContained(this.#sandbox, await realpath(workspaceStateDirectory)));
    assert.deepEqual(await readdir(workspaceStateDirectory), ["workspace.json"]);
    const workspaceMetadataValue: unknown = JSON.parse(
      await readFile(path.join(workspaceStateDirectory, "workspace.json"), "utf8"),
    );
    assert.ok(
      typeof workspaceMetadataValue === "object" && workspaceMetadataValue !== null,
      "workspace metadata must be an object",
    );
    const workspaceMetadata = workspaceMetadataValue as Record<string, unknown>;
    assert.deepEqual(Object.keys(workspaceMetadata).sort(), [
      "createdAt",
      "id",
      "name",
      "path",
      "updatedAt",
    ]);
    assert.match(String(workspaceMetadata.id), /^ws-[0-9a-f]{16}$/);
    assert.equal(workspaceMetadata.path, this.workspace());
    assert.equal(workspaceMetadata.name, path.basename(this.workspace()));
    assert.match(String(workspaceMetadata.createdAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(workspaceMetadata.updatedAt, workspaceMetadata.createdAt);
    const application = await stat(this.#applicationPath);
    assert.equal(application.isFile(), true);
    const lease = this.lease();
    await lease.assertConfiguredPathsConfined();
    assert.equal(lease.evidence().environmentRestored, true);
    this.#evidence.sandboxConfined = true;
  }

  evidence(): Readonly<NativeEvidence> {
    return { ...this.#evidence, scenarioEnvironment: this.#lease?.evidence() };
  }

  redactedDiagnostics(): string {
    const redacted = this.#driverDiagnostic
      .replaceAll(this.#sandbox, "<SANDBOX>")
      .replaceAll(this.#applicationPath, "<APPLICATION>")
      .replaceAll(this.#fixtureContent ?? "\u0000", "<FIXTURE_CONTENT>")
      .replace(/\b(password|token|secret)=\S+/gi, "$1=<REDACTED>")
      .replace(/\/(?:[^\s:'\"]+\/?)+/g, "<PATH>");
    return redacted.slice(-DIAGNOSTIC_LIMIT);
  }

  async dispose(): Promise<void> {
    try {
      const browser = this.#browser;
      this.#browser = undefined;
      if (browser && !this.#sessionDeleted) {
        try {
          await bounded(browser.deleteSession(), 2_000, "WebdriverIO session cleanup");
          this.#sessionDeleted = true;
        } catch {
          // Cleanup continues with the owned driver process.
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
    } finally {
      await this.#lease?.dispose();
    }
  }

  private browser(): Awaited<ReturnType<typeof remote>> {
    if (!this.#browser) throw new Error("native WebdriverIO wry session has not been launched");
    return this.#browser;
  }

  private lease(): NativeScenarioEnvironmentLease {
    if (!this.#lease) throw new Error("native file-open scenario environment is unavailable");
    return this.#lease;
  }

  private workspace(): string {
    return this.lease().paths.workspace;
  }

  private requiredFixtureName(): string {
    if (!this.#fixtureName) throw new Error("native desktop fixture has not been declared");
    return this.#fixtureName;
  }

  private fixturePath(): string {
    return path.join(this.workspace(), this.requiredFixtureName());
  }

  private fileItem(fileName: string): ReturnType<Awaited<ReturnType<typeof remote>>["$"]> {
    return this.browser().$(`[role="treeitem"][data-path="${cssAttribute(fileName)}"]`);
  }

  private assertSharedDeadline(seconds: number, fileName: string): void {
    assert.equal(seconds, 15);
    assert.equal(fileName, this.requiredFixtureName());
    assert.ok(this.#clickDeadline, "file item has not been clicked");
  }

  private remainingClickTime(): number {
    const remaining = (this.#clickDeadline ?? 0) - Date.now();
    assert.ok(remaining > 0, "the shared 15-second file-open deadline has expired");
    return remaining;
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
      if (exited) {
        throw new Error(`tauri-driver exited before readiness: ${JSON.stringify(exited)}`);
      }
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
}
