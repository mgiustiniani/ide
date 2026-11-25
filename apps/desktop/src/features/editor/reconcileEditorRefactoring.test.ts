import { describe, expect, it, vi } from "vitest";
import { createEditorStore } from "@ide/web-core/state";
import { DesktopEditorController } from "./useDesktopEditorController";
import { reconcileEditorRefactoring } from "./reconcileEditorRefactoring";

function harness() {
  return {
    editor: { reconcileBufferRenames: vi.fn() },
    documents: {
      closeDocument: vi.fn(async () => {}),
      activate: vi.fn(async () => {}),
      queueChange: vi.fn(),
      flush: vi.fn(async () => {}),
    },
    fileTree: { loadRoot: vi.fn(async () => {}), refreshDirectory: vi.fn(async () => {}) },
  };
}
const rename = {
  oldPath: "src/A.java",
  path: "src/B.java",
  before: "old draft",
  after: "new draft",
  isDirty: true,
};

function navigationHarness() {
  const store = createEditorStore();
  const viewModel = {
    openFile: vi.fn(async (filePath: string) => {
      store
        .getState()
        .openFile({ filePath, name: filePath.split("/").at(-1)!, language: "java", openedAt: 1 });
      store.getState().setContent(filePath, "old draft");
    }),
    cancelPendingOpen: vi.fn(),
    invalidateWorkspaceOperations: vi.fn(),
    restoreSession: vi.fn(async () => {}),
    switchActiveFile: (path: string) => store.getState().setActiveFile(path),
  };
  const selection = vi.fn();
  const controller = new DesktopEditorController({
    editorViewModel: viewModel,
    fileTreeViewModel: {
      selectFile: selection,
      createFile: vi.fn(),
      createFolder: vi.fn(),
      subscribeToFileSelection: () => () => {},
    },
    getEditorState: store.getState,
    getWorkspaceContext: () => ({
      workspaceId: "one",
      generation: 1,
      isSwitching: false,
      isMetadataLoading: false,
    }),
    clearFileTreeSelection: vi.fn(),
    resetEditorBuffers: vi.fn(),
  });
  return { store, controller, viewModel, selection, views: { ...harness(), editor: controller } };
}

describe("draft refactoring view reconciliation", () => {
  it("keeps an atomically renamed active buffer visible after editor Apply and Undo", async () => {
    const h = navigationHarness();
    await h.controller.openPath(rename.oldPath);
    expect(h.controller.presentation(h.store.getState()).readyActiveFilePath).toBe(rename.oldPath);
    h.store.getState().applyBufferChanges([rename]);
    await reconcileEditorRefactoring(h.views, [rename], () => true);
    expect(h.controller.presentation(h.store.getState())).toMatchObject({
      readyActiveFilePath: rename.path,
      activeContent: rename.after,
      isEmpty: false,
    });
    expect(h.selection).toHaveBeenLastCalledWith(rename.path);
    const undo = {
      oldPath: rename.path,
      path: rename.oldPath,
      before: rename.after,
      after: rename.before,
      isDirty: false,
    };
    h.store.getState().applyBufferChanges([undo]);
    await reconcileEditorRefactoring(h.views, [undo], () => true);
    expect(h.controller.presentation(h.store.getState())).toMatchObject({
      readyActiveFilePath: rename.oldPath,
      activeContent: rename.before,
      isEmpty: false,
    });
  });

  it("preserves a newer pending file-open intent while reconciling committed paths", async () => {
    const h = navigationHarness();
    await h.controller.openPath(rename.oldPath);
    h.store.getState().applyBufferChanges([rename]);
    let finish!: () => void;
    const load = new Promise<void>((resolve) => {
      finish = resolve;
    });
    h.viewModel.openFile.mockImplementationOnce(async (filePath: string) => {
      await load;
      h.store.getState().openFile({ filePath, name: "C.java", language: "java", openedAt: 2 });
      h.store.getState().setContent(filePath, "class C {}");
    });
    const pending = h.controller.openPath("src/C.java");
    const cancelledBefore = h.viewModel.cancelPendingOpen.mock.calls.length;
    await reconcileEditorRefactoring(h.views, [rename], () => true);
    expect(h.controller.state).toMatchObject({ status: "opening", requestedPath: "src/C.java" });
    expect(h.viewModel.cancelPendingOpen.mock.calls.length).toBe(cancelledBefore);
    finish();
    await pending;
    expect(h.controller.presentation(h.store.getState()).readyActiveFilePath).toBe("src/C.java");
  });

  it("keeps a newer failed navigation visible instead of masking it with the renamed draft", async () => {
    const h = navigationHarness();
    await h.controller.openPath(rename.oldPath);
    h.store.getState().applyBufferChanges([rename]);
    h.viewModel.openFile.mockRejectedValueOnce(new Error("unavailable"));
    await h.controller.openPath("src/C.java");
    await reconcileEditorRefactoring(h.views, [rename], () => true);
    expect(h.controller.state).toMatchObject({ status: "error", requestedPath: "src/C.java" });
    expect(h.controller.presentation(h.store.getState()).readyActiveFilePath).toBeNull();
    expect(h.store.getState().contents[rename.path]).toBe(rename.after);
  });

  it("leaves a different completed navigation and unrelated drafts selected", async () => {
    const h = navigationHarness();
    await h.controller.openPath(rename.oldPath);
    h.store.getState().applyBufferChanges([rename]);
    await h.controller.openPath("src/C.java");
    await reconcileEditorRefactoring(h.views, [rename], () => true);
    expect(h.controller.state).toMatchObject({ status: "ready", activePath: "src/C.java" });
    expect(h.controller.presentation(h.store.getState()).readyActiveFilePath).toBe("src/C.java");
    expect(h.store.getState().contents[rename.path]).toBe(rename.after);
    expect(h.selection).toHaveBeenLastCalledWith("src/C.java");
  });

  it("does not reconcile editor paths after workspace retirement", async () => {
    const h = harness();
    await reconcileEditorRefactoring(h, [rename], () => false);
    expect(h.editor.reconcileBufferRenames).not.toHaveBeenCalled();
    expect(h.documents.closeDocument).not.toHaveBeenCalled();
  });

  it("opens the renamed language document with the committed draft and refreshes explorer ancestors", async () => {
    const h = harness(),
      current = () => true;
    await expect(reconcileEditorRefactoring(h, [rename], current)).resolves.toBeUndefined();
    expect(h.documents.closeDocument).toHaveBeenCalledWith("src/A.java");
    expect(h.documents.activate).toHaveBeenCalledWith("src/B.java", "new draft");
    expect(h.documents.queueChange).not.toHaveBeenCalled();
    expect(h.fileTree.loadRoot).toHaveBeenCalledWith(current);
    expect(h.fileTree.refreshDirectory).toHaveBeenCalledWith("src", current);
  });

  it("flushes changed draft text while preserving an explicit language synchronization failure", async () => {
    const h = harness();
    h.documents.flush.mockRejectedValueOnce(new Error("session unavailable"));
    const warning = await reconcileEditorRefactoring(
      h,
      [{ ...rename, oldPath: rename.path }],
      () => true,
    );
    expect(h.documents.queueChange).toHaveBeenCalledWith("src/B.java", "new draft");
    expect(warning).toContain("Language synchronization failed");
    expect(h.fileTree.loadRoot).not.toHaveBeenCalled();
  });

  it("stops after workspace retirement during an awaited document close", async () => {
    const h = harness();
    let current = true;
    h.documents.closeDocument.mockImplementation(async () => {
      current = false;
    });
    await reconcileEditorRefactoring(h, [rename], () => current);
    expect(h.documents.activate).not.toHaveBeenCalled();
    expect(h.fileTree.loadRoot).not.toHaveBeenCalled();
  });
});
