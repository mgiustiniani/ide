import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

const LOOPBACK_HOST = "127.0.0.1";
const SERVER_START_TIMEOUT_MS = 15_000;
const SERVER_REQUEST_TIMEOUT_MS = 1_000;
const SERVER_POLL_INTERVAL_MS = 100;
const NAVIGATION_TIMEOUT_MS = 15_000;
const UI_TIMEOUT_MS = 10_000;
const PROCESS_STOP_TIMEOUT_MS = 2_000;
const MAX_SERVER_LOG_CHARACTERS = 8_192;

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_APP_ROOT = resolve(PROJECT_ROOT, "apps/web");
const VITE_ENTRYPOINT = resolve(WEB_APP_ROOT, "node_modules/vite/bin/vite.js");
const SYSTEM_CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
] as const;

export type BrowserSource = "playwright-cache" | "system-chromium";

export interface WebStoryEvidence {
  readonly target: "web/playwright";
  readonly serverOrigin: string;
  readonly browserSource: BrowserSource;
  readonly browserVersion: string;
  readonly headless: true;
}

interface BrowserCandidate {
  readonly source: BrowserSource;
  readonly executablePath: string;
}

class BoundedServerLog {
  #text = "";

  append(chunk: Buffer | string): void {
    const sanitized = String(chunk)
      .replaceAll(PROJECT_ROOT, "<project>/")
      .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
    this.#text = `${this.#text}${sanitized}`.slice(-MAX_SERVER_LOG_CHARACTERS);
  }

  sourceFreeSummary(): string {
    return `Captured ${this.#text.length} characters of bounded server diagnostics; contents withheld`;
  }
}

export class StandaloneWebApp {
  #server?: ChildProcess;
  #serverExit?: Promise<void>;
  #serverError?: Error;
  #browser?: Browser;
  #context?: BrowserContext;
  #page?: Page;
  #origin?: string;
  #evidence?: WebStoryEvidence;
  readonly #serverLog = new BoundedServerLog();

  async start(): Promise<void> {
    if (this.#server || this.#browser) {
      throw new Error("The standalone web Story application has already been started");
    }

    await access(VITE_ENTRYPOINT, fsConstants.R_OK);
    const port = await findAvailableLoopbackPort();
    this.#origin = `http://${LOOPBACK_HOST}:${port}`;

    try {
      this.#startServer(port);
      await this.#waitForServer();

      const launched = await launchAvailableChromium();
      this.#browser = launched.browser;
      this.#context = await this.#browser.newContext({ viewport: { width: 1280, height: 720 } });
      this.#page = await this.#context.newPage();
      this.#page.setDefaultTimeout(UI_TIMEOUT_MS);
      this.#page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      await this.#page.goto(this.#origin, {
        timeout: NAVIGATION_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      });

      this.#evidence = {
        target: "web/playwright",
        serverOrigin: this.#origin,
        browserSource: launched.source,
        browserVersion: this.#browser.version(),
        headless: true,
      };
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async waitUntilReady(): Promise<void> {
    const page = this.#requirePage();
    await page.getByText("No document open", { exact: true }).waitFor({
      state: "visible",
      timeout: UI_TIMEOUT_MS,
    });
    await this.#toolWindowTabs().getByRole("tab", { name: "Terminal", exact: true }).waitFor({
      state: "visible",
      timeout: UI_TIMEOUT_MS,
    });
  }

  async offeredToolNames(): Promise<string[]> {
    const names = await this.#toolWindowTabs().getByRole("tab").allTextContents();
    return names.map((name) => name.trim()).filter((name) => name.length > 0);
  }

  async integratedTerminalIsVisible(): Promise<boolean> {
    const page = this.#requirePage();
    const terminalTab = this.#toolWindowTabs().getByRole("tab", {
      name: "Terminal",
      exact: true,
    });
    return (
      (await terminalTab.isVisible()) &&
      (await terminalTab.getAttribute("title")) === "Integrated terminal" &&
      (await page.getByText("Session active", { exact: true }).isVisible())
    );
  }

  evidence(): WebStoryEvidence {
    if (!this.#evidence) {
      throw new Error("Web Story evidence is unavailable before browser navigation");
    }
    return this.#evidence;
  }

  page(): Page {
    return this.#requirePage();
  }

  async dispose(): Promise<void> {
    const context = this.#context;
    const browser = this.#browser;
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    this.#evidence = undefined;

    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await this.#stopServer();
  }

  #startServer(port: number): void {
    const server = spawn(
      process.execPath,
      [
        VITE_ENTRYPOINT,
        "--host",
        LOOPBACK_HOST,
        "--port",
        String(port),
        "--strictPort",
        "--clearScreen",
        "false",
      ],
      {
        cwd: WEB_APP_ROOT,
        detached: process.platform !== "win32",
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    server.stdout?.on("data", (chunk: Buffer) => this.#serverLog.append(chunk));
    server.stderr?.on("data", (chunk: Buffer) => this.#serverLog.append(chunk));
    this.#server = server;
    this.#serverExit = new Promise((resolveExit) => {
      server.once("error", (error) => {
        this.#serverError = error;
        this.#serverLog.append(error.message);
        resolveExit();
      });
      server.once("exit", () => resolveExit());
    });
  }

  async #waitForServer(): Promise<void> {
    const origin = this.#requireOrigin();
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (
        this.#serverError ||
        this.#server?.exitCode !== null ||
        this.#server?.signalCode !== null
      ) {
        throw new Error(
          `The standalone web server exited before readiness. ${this.#serverLog.sourceFreeSummary()}`,
        );
      }

      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(SERVER_REQUEST_TIMEOUT_MS),
        });
        if (response.ok) {
          await response.body?.cancel();
          return;
        }
      } catch {
        // The bounded poll continues while Vite starts listening.
      }

      await delay(SERVER_POLL_INTERVAL_MS);
    }

    throw new Error(
      `The standalone web server did not become ready. ${this.#serverLog.sourceFreeSummary()}`,
    );
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    const serverExit = this.#serverExit;
    this.#server = undefined;
    this.#serverExit = undefined;
    this.#serverError = undefined;
    this.#origin = undefined;

    if (!server || server.exitCode !== null || server.signalCode !== null) {
      return;
    }

    signalProcessTree(server, "SIGTERM");
    await Promise.race([serverExit ?? Promise.resolve(), delay(PROCESS_STOP_TIMEOUT_MS)]);

    if (server.exitCode === null && server.signalCode === null) {
      signalProcessTree(server, "SIGKILL");
      await Promise.race([serverExit ?? Promise.resolve(), delay(PROCESS_STOP_TIMEOUT_MS)]);
    }
  }

  #toolWindowTabs() {
    return this.#requirePage().getByRole("tablist", { name: "Tool windows", exact: true });
  }

  #requirePage(): Page {
    if (!this.#page) {
      throw new Error("The standalone web Story browser page has not been started");
    }
    return this.#page;
  }

  #requireOrigin(): string {
    if (!this.#origin) {
      throw new Error("The standalone web Story server has not been started");
    }
    return this.#origin;
  }
}

async function findAvailableLoopbackPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    reservation.once("error", rejectListen);
    reservation.listen(0, LOOPBACK_HOST, resolveListen);
  });

  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve an available loopback port for the standalone web server");
  }

  await new Promise<void>((resolveClose, rejectClose) => {
    reservation.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

export async function launchAvailableChromium(): Promise<{
  readonly browser: Browser;
  readonly source: BrowserSource;
}> {
  const candidates: BrowserCandidate[] = [
    { source: "playwright-cache", executablePath: chromium.executablePath() },
    ...SYSTEM_CHROMIUM_CANDIDATES.map((executablePath) => ({
      source: "system-chromium" as const,
      executablePath,
    })),
  ];
  const launchFailures: string[] = [];

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate.executablePath))) {
      continue;
    }

    try {
      const browser = await chromium.launch({
        executablePath: candidate.executablePath,
        headless: true,
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      return { browser, source: candidate.source };
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
      launchFailures.push(`${candidate.source}: ${message.replaceAll(PROJECT_ROOT, "<project>/")}`);
    }
  }

  const detail = launchFailures.length > 0 ? ` ${launchFailures.join("; ")}` : "";
  throw new Error(`No compatible Chromium executable was available for the web Story.${detail}`);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function signalProcessTree(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  const pid = processHandle.pid;
  if (!pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      processHandle.kill(signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
