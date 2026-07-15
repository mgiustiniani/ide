// ---------------------------------------------------------------------------
// apps/web – App Integration Tests
// ---------------------------------------------------------------------------
// Tests the App component rendering with mocked dependencies.
// Uses vi.mock to intercept the adapters import before vite resolves it.
// ---------------------------------------------------------------------------

import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const testHarness = vi.hoisted(() => {
  const harness: any = {};

  const rootNodes = () => [
    {
      id: "folder-src",
      name: "src",
      path: "src",
      type: "folder",
      isOpen: true,
      children: [
        { id: "file-main.tsx", name: "main.tsx", path: "src/main.tsx", type: "file" },
        { id: "file-App.tsx", name: "App.tsx", path: "src/App.tsx", type: "file" },
      ],
    },
    {
      id: "folder-packages",
      name: "packages",
      path: "packages",
      type: "folder",
      isOpen: false,
      children: [
        { id: "file-index.ts", name: "index.ts", path: "packages/index.ts", type: "file" },
      ],
    },
    {
      id: "folder-public",
      name: "public",
      path: "public",
      type: "folder",
      isOpen: false,
      children: [
        { id: "file-index.html", name: "index.html", path: "public/index.html", type: "file" },
      ],
    },
  ];

  harness.reset = () => {
    harness.getRoot = vi.fn(() => Promise.resolve(rootNodes()));
    harness.createFile = vi.fn((filePath: string) =>
      Promise.resolve([
        ...rootNodes(),
        { id: filePath, name: filePath.split("/").pop() ?? filePath, path: filePath, type: "file" },
      ]),
    );
    harness.getOpenFiles = vi.fn(() => Promise.resolve([]));
    harness.loadContent = vi.fn((filePath: string) =>
      Promise.resolve({
        filePath,
        content:
          filePath === "src/main.tsx"
            ? 'const main = "visible after click";'
            : `content for ${filePath}`,
        language:
          filePath.endsWith(".tsx") || filePath.endsWith(".ts") ? "typescript" : "plaintext",
      }),
    );
    harness.languageStatus = {
      state: "unavailable",
      provider: "external",
      workspaceId: "standalone-web-workspace",
      generation: 0,
      capabilities: {
        documentSync: false,
        diagnostics: false,
        completion: false,
        hover: false,
        signature: false,
        definition: false,
        references: false,
        symbols: false,
        codeActions: false,
        formatting: false,
        rename: false,
        hierarchy: false,
      },
      lastError:
        "Managed local JDK and JDT LS process management is desktop-only; browser clients must use an external language service.",
      checkedAt: "2026-07-11T00:00:00.000Z",
    };
    harness.getLanguageStatus = vi.fn(() => Promise.resolve(harness.languageStatus));
    harness.startLanguageService = vi.fn(() => Promise.reject(new Error("desktop-only")));
    harness.restartLanguageService = vi.fn(() => Promise.reject(new Error("desktop-only")));
    harness.stopLanguageService = vi.fn(() => Promise.resolve(harness.languageStatus));
    harness.unsubscribeLanguageService = vi.fn();
    harness.subscribeLanguageService = vi.fn(
      (_workspaceId: string, listener: (event: any) => void) => {
        listener({ type: "status", status: harness.languageStatus });
        return harness.unsubscribeLanguageService;
      },
    );
    harness.getXcom2Snapshot = vi.fn();
    harness.refreshXcom2Snapshot = vi.fn();
    harness.subscribeXcom2 = vi.fn();
  };

  harness.createDeferredOpenFilesRestore = (files: any[] = []) => {
    let resolve!: () => void;
    const promise = new Promise<any[]>((res) => {
      resolve = () => res(files);
    });
    harness.getOpenFiles.mockImplementationOnce(() => promise);
    return { promise, resolve };
  };

  harness.reset();
  return harness;
});

// Mock the browser-adapters package used by App at module scope.
vi.mock("@ide/browser-adapters", () => ({
  createBrowserAdapters: () => ({
    fileTreeAdapter: {
      getRoot: testHarness.getRoot,
      getChildren: () => Promise.resolve([]),
      createFile: testHarness.createFile,
      createFolder: () => Promise.resolve([]),
      delete: () => Promise.resolve([]),
      rename: () => Promise.resolve([]),
      onFileSelect: () => () => {},
      selectFile: () => {},
    },
    editorAdapter: {
      loadContent: testHarness.loadContent,
      saveContent: () => Promise.resolve([]),
      getOpenFiles: testHarness.getOpenFiles,
      closeFile: () => Promise.resolve([]),
    },
    terminalAdapter: {
      executeCommand: () => Promise.resolve(),
      resize: () => Promise.resolve(),
      onOutput:
        (_cb: (output: { text: string; type: string; timestamp: number }) => void) => () => {},
      onExit: () => () => {},
      startSession: () => {},
      stopSession: () => {},
    },
    languageSessionAdapter: {
      getStatus: testHarness.getLanguageStatus,
      start: testHarness.startLanguageService,
      stop: testHarness.stopLanguageService,
      restart: testHarness.restartLanguageService,
      subscribe: testHarness.subscribeLanguageService,
    },
    xcom2SetupMonitorAdapter: {
      getSnapshot: testHarness.getXcom2Snapshot,
      refresh: testHarness.refreshXcom2Snapshot,
      subscribe: testHarness.subscribeXcom2,
    },
  }),
}));

async function renderApp() {
  const { App } = await import("../App");
  await act(async () => {
    render(React.createElement(App));
    await Promise.resolve();
  });
}

async function findMainFileTreeItem(): Promise<HTMLElement> {
  await screen.findByText("src");
  await waitFor(() => {
    expect(document.querySelector('[role="treeitem"][data-path="src/main.tsx"]')).not.toBeNull();
  });

  return document.querySelector('[role="treeitem"][data-path="src/main.tsx"]') as HTMLElement;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("App", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    testHarness.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("should render the App component without crashing", async () => {
    await renderApp();
    expect(await screen.findByText("Explorer")).toBeDefined();
  });

  it("should render the file tree area with Explorer label", async () => {
    await renderApp();
    expect(await screen.findByText("Explorer")).toBeDefined();
  });

  it("should render with dark theme class", async () => {
    await renderApp();
    const rootDiv = document.querySelector(".dark");
    expect(rootDiv).toBeDefined();
    await screen.findByText("No document open");
  });

  it("should show root file tree folders", async () => {
    await renderApp();
    expect(await screen.findByText("src")).toBeDefined();
    expect(await screen.findByText("packages")).toBeDefined();
    expect(await screen.findByText("public")).toBeDefined();
  });

  it("renders Terminal as the only generic web bottom tool with core metadata", async () => {
    await renderApp();

    const terminalTab = screen.getByRole("tab", { name: "Terminal" });
    expect(terminalTab.getAttribute("title")).toBe("Integrated terminal");
    expect(terminalTab.getAttribute("data-scope")).toBe("core");
    expect(terminalTab.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Java" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "XCOM 2" })).toBeNull();
    await screen.findByText("No document open");
  });

  it("does not poll or subscribe to Java or XCOM providers during generic web startup", async () => {
    await renderApp();
    await screen.findByText("No document open");

    expect(testHarness.subscribeLanguageService).not.toHaveBeenCalled();
    expect(testHarness.getLanguageStatus).not.toHaveBeenCalled();
    expect(testHarness.startLanguageService).not.toHaveBeenCalled();
    expect(testHarness.stopLanguageService).not.toHaveBeenCalled();
    expect(testHarness.restartLanguageService).not.toHaveBeenCalled();
    expect(testHarness.subscribeXcom2).not.toHaveBeenCalled();
    expect(testHarness.getXcom2Snapshot).not.toHaveBeenCalled();
    expect(testHarness.refreshXcom2Snapshot).not.toHaveBeenCalled();
  });

  it("contains no Tauri API imports or native invoke calls in the web composition", () => {
    const appPath = process.cwd().endsWith("/apps/web")
      ? resolve(process.cwd(), "src/App.tsx")
      : resolve(process.cwd(), "apps/web/src/App.tsx");
    const source = readFileSync(appPath, "utf8");

    expect(source).not.toContain(["@tauri", "-apps/api"].join(""));
    expect(source).not.toMatch(/\binvoke\s*\(/);
    expect(source).not.toMatch(/\bresult\s*=\s*\{/);
  });

  it("should show the editor welcome state after empty session restore", async () => {
    await renderApp();
    expect(await screen.findByText("No document open")).toBeDefined();
    expect(screen.getByText("Location: Workspace root")).toBeDefined();
    expect(screen.getByText("No recent files")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Browse…" })).toBeNull();
    expect(screen.queryByText("Opening editor…")).toBeNull();
  });

  it("creates a file at the workspace root and opens the exact returned path", async () => {
    await renderApp();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a new file" }), {
      target: { value: "created.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));

    await waitFor(() => {
      expect(testHarness.createFile).toHaveBeenCalledOnce();
      expect(testHarness.createFile).toHaveBeenCalledWith("created.ts");
      expect(testHarness.loadContent).toHaveBeenCalledWith("created.ts");
      expect(screen.getByTestId("editor-opening-placeholder").textContent).toContain("created.ts");
    });
    expect(screen.queryByText("No document open")).toBeNull();
    expect(screen.queryByRole("button", { name: "Native" })).toBeNull();
  });

  it("keeps creation errors in the empty-editor form without opening an editor", async () => {
    testHarness.createFile.mockRejectedValueOnce(new Error("Root is read-only"));
    await renderApp();

    fireEvent.change(screen.getByRole("textbox", { name: "Create a new file" }), {
      target: { value: "blocked.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create File" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Root is read-only");
    expect(screen.getByText("No document open")).toBeDefined();
    expect(
      (screen.getByRole("textbox", { name: "Create a new file" }) as HTMLInputElement).value,
    ).toBe("blocked.ts");
    expect(testHarness.loadContent).not.toHaveBeenCalledWith("blocked.ts");
    expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull();
    expect(screen.queryByRole("button", { name: "Native" })).toBeNull();
  });

  it("should show clicked file-tree item content in the editor", async () => {
    await renderApp();

    fireEvent.click(await findMainFileTreeItem());

    await waitFor(() => {
      expect(testHarness.loadContent).toHaveBeenCalledWith("src/main.tsx");
      expect(screen.getByTestId("editor-opening-placeholder").textContent).toContain("main.tsx");
      expect(screen.getByTestId("editor-opening-placeholder").textContent).not.toContain(
        'const main = "visible after click";',
      );
    });
    expect(screen.queryByText("No document open")).toBeNull();
  });

  it("should keep clicked file content visible after delayed restoreSession clears active file", async () => {
    const deferredRestore = testHarness.createDeferredOpenFilesRestore([]);
    await renderApp();

    fireEvent.click(await findMainFileTreeItem());

    await waitFor(() => {
      expect(testHarness.loadContent).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("editor-opening-placeholder").textContent).toContain("main.tsx");
    });

    await act(async () => {
      deferredRestore.resolve();
      await deferredRestore.promise;
    });

    await waitFor(() => {
      expect(testHarness.loadContent).toHaveBeenCalledTimes(2);
      expect(testHarness.loadContent).toHaveBeenLastCalledWith("src/main.tsx");
      expect(screen.getByTestId("editor-opening-placeholder").textContent).toContain("main.tsx");
    });
    expect(screen.queryByText("No document open")).toBeNull();
  });
});
