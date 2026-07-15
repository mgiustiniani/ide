import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspaceRoot = join(import.meta.dirname, "../../../../..");
const uiRoot = join(workspaceRoot, "packages/ui");
const webRoot = join(workspaceRoot, "apps/web");
const viteEntrypoint = join(webRoot, "node_modules/vite/bin/vite.js");
const viteConfig = join(webRoot, "vite.config.ts");
const browserCandidates = [
  chromium.executablePath(),
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

let browser: Browser;
let page: Page;
let server: ChildProcess;
let fixtureRoot: string;
let origin: string;

interface LayoutGeometry {
  readonly viewportWidth: number;
  readonly documentClientWidth: number;
  readonly documentScrollWidth: number;
  readonly workspaceClientWidth: number;
  readonly workspaceScrollWidth: number;
  readonly editorRowClientWidth: number;
  readonly editorRowScrollWidth: number;
  readonly editorWidth: number;
  readonly rightSidebarWidth: number;
  readonly editorRowRight: number;
  readonly rightSidebarRight: number;
}

describe("PanelLayout responsive right sidebar", () => {
  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(uiRoot, ".panel-layout-browser-"));
    await writeBrowserFixture(fixtureRoot);

    const port = await findAvailableLoopbackPort();
    origin = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      [
        viteEntrypoint,
        fixtureRoot,
        "--config",
        viteConfig,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
        "--clearScreen",
        "false",
      ],
      {
        cwd: webRoot,
        detached: process.platform !== "win32",
        env: { ...process.env, NO_COLOR: "1" },
        stdio: "ignore",
      },
    );
    await waitForServer(server, origin);

    browser = await launchAvailableChromium();
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  }, 30_000);

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stopServer(server);
    if (fixtureRoot) await rm(fixtureRoot, { force: true, recursive: true });
  });

  it.each([420, 320])(
    "retains a requested %ipx right-sidebar width when the editor row has room",
    async (requestedWidth) => {
      await openComposition(1280, requestedWidth);

      const geometry = await measureLayout();

      expect(geometry.rightSidebarWidth).toBeCloseTo(requestedWidth, 0);
      expect(geometry.editorWidth).toBeGreaterThan(0);
      expect(geometry.rightSidebarRight).toBeLessThanOrEqual(geometry.editorRowRight + 1);
    },
  );

  it.each([700, 480])(
    "keeps the editor and right sidebar positive without horizontal overflow at %ipx",
    async (viewportWidth) => {
      await openComposition(viewportWidth, 420);

      const geometry = await measureLayout();

      expect(geometry.editorWidth).toBeGreaterThan(0);
      expect(geometry.rightSidebarWidth).toBeGreaterThan(0);
      expect(geometry.rightSidebarRight).toBeLessThanOrEqual(geometry.editorRowRight + 1);
      expect(geometry.editorRowScrollWidth).toBeLessThanOrEqual(geometry.editorRowClientWidth);
      expect(geometry.workspaceScrollWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);
      expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth);
      expect(geometry.documentClientWidth).toBe(geometry.viewportWidth);
    },
  );
});

async function openComposition(viewportWidth: number, requestedWidth: number): Promise<void> {
  await page.setViewportSize({ width: viewportWidth, height: 720 });
  await page.goto(`${origin}/?rightWidth=${requestedWidth}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-panel-layout-ready]").waitFor({ state: "visible" });
}

async function measureLayout(): Promise<LayoutGeometry> {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(".ide-workspace");
    const editorRow = document.querySelector<HTMLElement>(".ide-editor-row");
    const editor = document.querySelector<HTMLElement>(".ide-main-editor-pane");
    const rightSidebar = document.querySelector<HTMLElement>(".ide-right-sidebar-pane");
    if (!workspace || !editorRow || !editor || !rightSidebar) {
      throw new Error("PanelLayout browser fixture is missing a required region");
    }

    const editorBounds = editor.getBoundingClientRect();
    const editorRowBounds = editorRow.getBoundingClientRect();
    const rightSidebarBounds = rightSidebar.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      workspaceClientWidth: workspace.clientWidth,
      workspaceScrollWidth: workspace.scrollWidth,
      editorRowClientWidth: editorRow.clientWidth,
      editorRowScrollWidth: editorRow.scrollWidth,
      editorWidth: editorBounds.width,
      rightSidebarWidth: rightSidebarBounds.width,
      editorRowRight: editorRowBounds.right,
      rightSidebarRight: rightSidebarBounds.right,
    };
  });
}

async function findAvailableLoopbackPort(): Promise<number> {
  const reservation = createNetServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve a loopback port for the PanelLayout browser fixture");
  }
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForServer(processHandle: ChildProcess, serverOrigin: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error("PanelLayout browser fixture server exited before readiness");
    }
    try {
      const response = await fetch(serverOrigin, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        await response.body?.cancel();
        return;
      }
    } catch {
      // Keep polling until the bounded startup deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("PanelLayout browser fixture server did not become ready");
}

async function stopServer(processHandle?: ChildProcess): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null)
    return;
  const exit = new Promise<void>((resolve) => processHandle.once("exit", () => resolve()));
  if (process.platform === "win32") processHandle.kill("SIGTERM");
  else if (processHandle.pid) process.kill(-processHandle.pid, "SIGTERM");
  await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    if (process.platform === "win32") processHandle.kill("SIGKILL");
    else if (processHandle.pid) process.kill(-processHandle.pid, "SIGKILL");
  }
}

async function launchAvailableChromium(): Promise<Browser> {
  const failures: string[] = [];
  for (const executablePath of browserCandidates) {
    try {
      await access(executablePath, fsConstants.X_OK);
      return await chromium.launch({ executablePath, headless: true, timeout: 15_000 });
    } catch (error) {
      failures.push(error instanceof Error ? error.message.split("\n", 1)[0] : String(error));
    }
  }
  throw new Error(`No compatible Chromium executable was available: ${failures.join("; ")}`);
}

async function writeBrowserFixture(root: string): Promise<void> {
  const panelLayoutUrl = `/@fs/${join(uiRoot, "src/components/PanelLayout/PanelLayout.tsx")}`;
  const globalsUrl = `/@fs/${join(uiRoot, "src/styles/globals.css")}`;
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html class="dark"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    join(root, "main.tsx"),
    `import React from "react";
import ReactDOM from "react-dom/client";
import { PanelLayout } from ${JSON.stringify(panelLayoutUrl)};
import ${JSON.stringify(globalsUrl)};

const requestedWidth = Number(new URLSearchParams(window.location.search).get("rightWidth")) || 420;
const layout = {
  visibility: {
    leftSidebar: { visible: true, active: false },
    mainArea: { visible: true, active: true },
    bottomPanel: { visible: true, active: false },
  },
  sizes: { leftSidebarWidth: 280, bottomPanelHeight: 250 },
  minSizes: { leftSidebarWidth: 160, bottomPanelHeight: 80 },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div data-panel-layout-ready style={{ height: "100vh", width: "100vw" }}>
    <PanelLayout
      leftSidebar={<div>Files</div>}
      mainContent={<div>Editor</div>}
      bottomContent={<div>Terminal</div>}
      rightSidebarContent={<div>Agent</div>}
      rightSidebarWidth={requestedWidth}
      layout={layout}
      onResizeLeft={() => undefined}
      onResizeBottom={() => undefined}
      statusBarLeft={<span>Ready</span>}
    />
  </div>,
);
`,
  );
}
