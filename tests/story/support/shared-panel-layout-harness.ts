import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { ApplicationContentLayoutSession } from "./application-content-layout.js";
import { launchAvailableChromium } from "./standalone-web-app.js";

const LOOPBACK_HOST = "127.0.0.1";
const SERVER_START_TIMEOUT_MS = 15_000;
const SERVER_REQUEST_TIMEOUT_MS = 1_000;
const SERVER_POLL_INTERVAL_MS = 100;
const PROCESS_STOP_TIMEOUT_MS = 2_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const UI_TIMEOUT_MS = 10_000;
const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_ROOT = fileURLToPath(new URL("./layout-harness/", import.meta.url));
const WEB_APP_ROOT = fileURLToPath(new URL("../../../apps/web/", import.meta.url));
const VITE_ENTRYPOINT = fileURLToPath(
  new URL("../../../apps/web/node_modules/vite/bin/vite.js", import.meta.url),
);
const WEB_VITE_CONFIG = fileURLToPath(new URL("../../../apps/web/vite.config.ts", import.meta.url));

export interface DesktopPanelLayoutHarnessEvidence {
  readonly target: "desktop/tauri-harness";
  readonly kind: "tauri-harness";
  readonly nativeGui: false;
  readonly e2e: false;
  readonly packagedApplication: false;
  readonly rendering: "real @ide/ui PanelLayout contract in headless Chromium";
  readonly browserVersion: string;
}

export class SharedPanelLayoutHarness {
  #server?: ChildProcess;
  #serverExit?: Promise<void>;
  #serverError?: Error;
  #browser?: Browser;
  #context?: BrowserContext;
  #page?: Page;
  #origin?: string;
  #evidence?: DesktopPanelLayoutHarnessEvidence;

  async start(): Promise<void> {
    if (this.#server || this.#browser) {
      throw new Error("The shared PanelLayout desktop harness has already been started");
    }

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
      await this.#page.goto(this.#origin, { waitUntil: "domcontentloaded" });
      await this.#page.locator("[data-story-layout-ready]").waitFor({ state: "visible" });

      this.#evidence = {
        target: "desktop/tauri-harness",
        kind: "tauri-harness",
        nativeGui: false,
        e2e: false,
        packagedApplication: false,
        rendering: "real @ide/ui PanelLayout contract in headless Chromium",
        browserVersion: this.#browser.version(),
      };
    } catch (error) {
      await this.dispose();
      throw new Error(
        `The deterministic desktop PanelLayout harness could not start from ${PROJECT_ROOT}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  layoutSession(): ApplicationContentLayoutSession {
    if (!this.#page || !this.#evidence) {
      throw new Error("The shared PanelLayout desktop harness has not completed navigation");
    }
    return new ApplicationContentLayoutSession(
      this.#page,
      this.#evidence,
      "[data-story-top-level-chrome]",
    );
  }

  evidence(): DesktopPanelLayoutHarnessEvidence {
    if (!this.#evidence) {
      throw new Error("Desktop PanelLayout harness evidence is unavailable before navigation");
    }
    return this.#evidence;
  }

  async dispose(): Promise<void> {
    const page = this.#page;
    const context = this.#context;
    const browser = this.#browser;
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    this.#evidence = undefined;

    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await this.#stopServer();
  }

  #startServer(port: number): void {
    const server = spawn(
      process.execPath,
      [
        VITE_ENTRYPOINT,
        HARNESS_ROOT,
        "--config",
        WEB_VITE_CONFIG,
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
        stdio: "ignore",
      },
    );
    this.#server = server;
    this.#serverExit = new Promise((resolveExit) => {
      server.once("error", (error) => {
        this.#serverError = error;
        resolveExit();
      });
      server.once("exit", () => resolveExit());
    });
  }

  async #waitForServer(): Promise<void> {
    const origin = this.#origin;
    if (!origin) throw new Error("The desktop PanelLayout harness origin is unavailable");
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (
        this.#serverError ||
        this.#server?.exitCode !== null ||
        this.#server?.signalCode !== null
      ) {
        throw this.#serverError ?? new Error("The desktop PanelLayout Vite server exited early");
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
        // Poll until Vite listens or the bounded startup deadline expires.
      }
      await delay(SERVER_POLL_INTERVAL_MS);
    }
    throw new Error("The desktop PanelLayout Vite server did not become ready");
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    const serverExit = this.#serverExit;
    this.#server = undefined;
    this.#serverExit = undefined;
    this.#serverError = undefined;
    this.#origin = undefined;

    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    signalProcessTree(server, "SIGTERM");
    await Promise.race([serverExit ?? Promise.resolve(), delay(PROCESS_STOP_TIMEOUT_MS)]);
    if (server.exitCode === null && server.signalCode === null) {
      signalProcessTree(server, "SIGKILL");
      await Promise.race([serverExit ?? Promise.resolve(), delay(PROCESS_STOP_TIMEOUT_MS)]);
    }
  }
}

async function findAvailableLoopbackPort(): Promise<number> {
  const reservation = createNetServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    reservation.once("error", rejectListen);
    reservation.listen(0, LOOPBACK_HOST, resolveListen);
  });

  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve a loopback port for the desktop PanelLayout harness");
  }

  await new Promise<void>((resolveClose, rejectClose) => {
    reservation.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

function signalProcessTree(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  const pid = processHandle.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") processHandle.kill(signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
