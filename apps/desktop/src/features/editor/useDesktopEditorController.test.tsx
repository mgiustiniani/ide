import type { FileNode } from "@ide/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopEditorController,
  type DesktopEditorStoreState,
  type DesktopEditorWorkspaceContext,
  useDesktopEditorController,
} from "./useDesktopEditorController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const fileNode = (path: string): FileNode => ({
  id: path,
  name: path.split("/").pop() ?? path,
  path,
  type: "file",
});

function createHarness() {
  const state: DesktopEditorStoreState = {
    activeFilePath: null,
    contents: {},
    tabs: [],
    openFiles: [],
  };
  const workspace: DesktopEditorWorkspaceContext = {
    generation: 1,
    workspaceId: "workspace-one",
    isSwitching: false,
    isMetadataLoading: false,
  };
  const loads = new Map<string, ReturnType<typeof deferred<void>>>();
  let openIntent = 0;
  let discardedThrough = 0;
  const editorViewModel = {
    openFile: vi.fn(async (path: string) => {
      const intent = ++openIntent;
      const load = loads.get(path);
      if (load) await load.promise;
      if (intent <= discardedThrough) return;
      state.activeFilePath = path;
      state.contents[path] = `content for ${path}`;
      state.tabs = [{ filePath: path, isDirty: false, isActive: true }];
      state.openFiles = [
        {
          filePath: path,
          name: path.split("/").pop() ?? path,
          language: path.endsWith(".java") ? "java" : "typescript",
          openedAt: 1,
        },
      ];
    }),
    cancelPendingOpen: vi.fn(() => {
      discardedThrough = openIntent;
      openIntent += 1;
    }),
    restoreSession: vi.fn(async () => undefined),
    switchActiveFile: vi.fn((path: string) => {
      state.activeFilePath = path;
    }),
  };
  const fileTreeViewModel = {
    selectFile: vi.fn(),
    createFile: vi.fn(async (parentPath: string, name: string) =>
      parentPath ? `${parentPath}/${name}` : name,
    ),
    subscribeToFileSelection: vi.fn(() => vi.fn()),
  };
  const clearFileTreeSelection = vi.fn();
  const resetEditorBuffers = vi.fn(() => {
    state.activeFilePath = null;
    state.contents = {};
    state.tabs = [];
    state.openFiles = [];
  });
  const controller = new DesktopEditorController({
    editorViewModel,
    fileTreeViewModel,
    getEditorState: () => state,
    getWorkspaceContext: () => workspace,
    clearFileTreeSelection,
    resetEditorBuffers,
  });
  return {
    controller,
    state,
    workspace,
    loads,
    editorViewModel,
    fileTreeViewModel,
    clearFileTreeSelection,
    resetEditorBuffers,
  };
}

describe("DesktopEditorController", () => {
  it("publishes opening before the adapter call and settles ready with derived content", async () => {
    const h = createHarness();
    const load = deferred<void>();
    h.loads.set("src/main.ts", load);
    const states: string[] = [];
    h.controller.subscribe((state) => states.push(state.status));
    h.editorViewModel.openFile.mockImplementationOnce(async (path: string) => {
      expect(h.controller.state).toMatchObject({ status: "opening", requestedPath: path });
      await load.promise;
      h.state.activeFilePath = path;
      h.state.contents[path] = "ready content";
      h.state.tabs = [{ filePath: path, isDirty: false, isActive: true }];
      h.state.openFiles = [
        { filePath: path, name: "main.ts", language: "typescript", openedAt: 1 },
      ];
    });

    const pending = h.controller.selectTreeFile(fileNode("src/main.ts"));
    expect(states).toEqual(["idle", "opening"]);
    expect(h.fileTreeViewModel.selectFile).toHaveBeenCalledWith("src/main.ts");
    load.resolve();
    await expect(pending).resolves.toBe(true);

    expect(h.controller.presentation(h.state)).toMatchObject({
      readyActiveFilePath: "src/main.ts",
      activeContent: "ready content",
      activeLanguage: "typescript",
      isEditorLoading: false,
      diagnostic: null,
    });
  });

  it("settles a provider rejection to a sanitized error and empty presentation", async () => {
    const h = createHarness();
    h.editorViewModel.openFile.mockRejectedValueOnce(
      new Error("secret source at /private/workspace/Main.java"),
    );

    await expect(h.controller.openPath("src/Main.java")).resolves.toBe(false);

    const presentation = h.controller.presentation(h.state);
    expect(presentation.isEmpty).toBe(true);
    expect(presentation.isEditorLoading).toBe(false);
    expect(presentation.diagnostic).toEqual({
      filePath: "src/Main.java",
      message: "Unable to open this file.",
    });
    expect(JSON.stringify(presentation)).not.toContain("secret source");
    expect(JSON.stringify(presentation)).not.toContain("/private/workspace");
  });

  it("keeps rapid clicks on the newest intent and ignores stale completion", async () => {
    const h = createHarness();
    const a = deferred<void>();
    const b = deferred<void>();
    h.loads.set("a.ts", a);
    h.loads.set("b.ts", b);

    const openA = h.controller.openPath("a.ts");
    const openB = h.controller.openPath("b.ts");
    b.resolve();
    await expect(openB).resolves.toBe(true);
    a.resolve();
    await expect(openA).resolves.toBe(false);

    expect(h.controller.presentation(h.state).readyActiveFilePath).toBe("b.ts");
  });

  it("reconciles a ready user intent after delayed restore clobbers selection", async () => {
    const h = createHarness();
    const restore = deferred<void>();
    h.editorViewModel.restoreSession.mockImplementationOnce(async () => {
      await restore.promise;
      h.state.activeFilePath = null;
    });

    const restoring = h.controller.restoreSession();
    await h.controller.openPath("src/user.ts");
    expect(h.editorViewModel.openFile).toHaveBeenCalledTimes(1);
    restore.resolve();
    await restoring;

    expect(h.editorViewModel.openFile).toHaveBeenCalledTimes(2);
    expect(h.editorViewModel.openFile).toHaveBeenLastCalledWith("src/user.ts");
    expect(h.controller.presentation(h.state).readyActiveFilePath).toBe("src/user.ts");
  });

  it("cancels stale work and clears tree selection on workspace reset", async () => {
    const h = createHarness();
    const oldLoad = deferred<void>();
    h.loads.set("old.ts", oldLoad);
    const pending = h.controller.openPath("old.ts");

    h.workspace.generation += 1;
    h.workspace.workspaceId = "workspace-two";
    h.controller.resetWorkspace();
    oldLoad.resolve();
    await pending;

    expect(h.controller.state).toEqual({ status: "idle" });
    expect(h.clearFileTreeSelection).toHaveBeenCalledOnce();
    expect(h.state.activeFilePath).toBeNull();
  });

  it("creates through FileTreeViewModel and opens the exact returned path", async () => {
    const h = createHarness();
    h.fileTreeViewModel.createFile.mockResolvedValueOnce("backend/exact-created.ts");

    await expect(h.controller.createFile("src", "created.ts")).resolves.toBe(
      "backend/exact-created.ts",
    );

    expect(h.fileTreeViewModel.createFile).toHaveBeenCalledWith("src", "created.ts");
    expect(h.fileTreeViewModel.selectFile).toHaveBeenCalledWith("backend/exact-created.ts");
    expect(h.editorViewModel.openFile).toHaveBeenCalledWith("backend/exact-created.ts");
  });

  it("derives restored tabs while idle and an honest no-document state", () => {
    const h = createHarness();
    expect(h.controller.presentation(h.state)).toMatchObject({ isEmpty: true, editorFilePath: "" });

    h.state.activeFilePath = "restored.ts";
    h.state.contents["restored.ts"] = "restored";
    h.state.tabs = [{ filePath: "restored.ts", isDirty: false, isActive: true }];
    h.state.openFiles = [
      { filePath: "restored.ts", name: "restored.ts", language: "typescript", openedAt: 1 },
    ];

    expect(h.controller.presentation(h.state)).toMatchObject({
      isEmpty: false,
      readyActiveFilePath: "restored.ts",
      activeContent: "restored",
    });
  });
});

describe("useDesktopEditorController", () => {
  it("flushes a direct-click opening publication before calling the adapter", async () => {
    const h = createHarness();
    const load = deferred<void>();
    h.loads.set("sync.ts", load);
    h.editorViewModel.openFile.mockImplementationOnce(async (path: string) => {
      expect(screen.getByTestId("state").textContent).toBe("opening:sync.ts");
      await load.promise;
      h.state.activeFilePath = path;
      h.state.contents[path] = "done";
      h.state.tabs = [{ filePath: path, isDirty: false, isActive: true }];
      h.state.openFiles = [
        { filePath: path, name: path, language: "typescript", openedAt: 1 },
      ];
    });

    function Harness() {
      const editor = useDesktopEditorController({
        editorViewModel: h.editorViewModel,
        fileTreeViewModel: h.fileTreeViewModel,
        getEditorState: () => h.state,
        getWorkspaceContext: () => h.workspace,
        clearFileTreeSelection: h.clearFileTreeSelection,
        resetEditorBuffers: h.resetEditorBuffers,
        editorState: h.state,
      });
      return (
        <>
          <button type="button" onClick={() => void editor.selectTreeFile(fileNode("sync.ts"))}>
            Open
          </button>
          <div data-testid="state">
            {editor.openState.status}:{editor.editorFilePath}
          </div>
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("state").textContent).toBe("opening:sync.ts");

    await act(async () => load.resolve());
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("ready:sync.ts"));
  });
});
