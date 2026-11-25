import type { EditorPort } from "@ide/web-core";
import { createEditorStore, EditorViewModel } from "@ide/web-core";
import { describe, expect, it, vi } from "vitest";
import { DesktopEditorController } from "./useDesktopEditorController";
import { reconcileRefactoringEditor } from "./reconcileRefactoringEditor";

async function harness() {
  const store = createEditorStore();
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({
      filePath,
      content: "before",
      language: "java" as const,
    })),
    getOpenFiles: vi.fn(async () => []),
    closeFile: vi.fn(() => []),
    saveContent: vi.fn(async () => []),
    inspectContent: vi.fn(async (filePath) => ({
      filePath,
      content: "actual saved contents",
      language: "java" as const,
      revision: "revision",
      changedSinceRead: true,
    })),
    acceptDiskSnapshot: vi.fn(),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile("src/A.java");
  const documents = {
    queueChange: vi.fn(),
    flush: vi.fn(async (): Promise<void> => undefined),
    notifySaved: vi.fn(async (): Promise<void> => undefined),
    closeDocument: vi.fn(async (): Promise<void> => undefined),
    activate: vi.fn(async (): Promise<void> => undefined),
  };
  const fileTree = {
    loadRoot: vi.fn(async () => undefined),
    refreshDirectory: vi.fn(async () => undefined),
    selectedFilePath: "src/A.java" as string | null,
    selectFile: vi.fn((path: string) => {
      fileTree.selectedFilePath = path;
    }),
  };
  const navigation = new DesktopEditorController({
    editorViewModel: editor,
    fileTreeViewModel: {
      ...fileTree,
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
  await navigation.openPath("src/A.java");
  const release = editor.beginExternalWrite();
  const refreshProjectModel = vi.fn(async () => undefined);
  return {
    store,
    port,
    release,
    navigation,
    dependencies: { editor, navigation, documents, fileTree, refreshProjectModel },
  };
}

const changes = [{ path: "src/A.java", change: "edit" as const, primary: true }];

describe("post-refactoring editor reconciliation", () => {
  it("reloads actual disk text, synchronizes the document and refreshes the affected directories and project view", async () => {
    const h = await harness();
    const message = await reconcileRefactoringEditor(h.dependencies, changes, () => true);
    expect(message).toBeUndefined();
    expect(h.store.getState().contents["src/A.java"]).toBe("actual saved contents");
    expect(h.dependencies.documents.queueChange).toHaveBeenCalledWith(
      "src/A.java",
      "actual saved contents",
    );
    expect(h.dependencies.documents.flush).toHaveBeenCalledWith("src/A.java");
    expect(h.dependencies.documents.notifySaved).toHaveBeenCalledWith("src/A.java");
    expect(h.dependencies.fileTree.loadRoot).toHaveBeenCalledOnce();
    expect(h.dependencies.fileTree.refreshDirectory).toHaveBeenCalledWith(
      "src",
      expect.any(Function),
    );
    expect(h.dependencies.refreshProjectModel).toHaveBeenCalledOnce();
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(() => h.dependencies.editor.updateContent("src/A.java", "racing edit")).toThrow(
      "transformation",
    );
    h.release();
  });

  it("keeps the successful disk refresh visible when language synchronization fails", async () => {
    const h = await harness();
    h.dependencies.documents.flush.mockRejectedValueOnce(new Error("language unavailable"));
    const message = await reconcileRefactoringEditor(h.dependencies, changes, () => true);
    expect(message).toContain("language synchronization failed");
    expect(h.store.getState().contents["src/A.java"]).toBe("actual saved contents");
    expect(h.dependencies.documents.notifySaved).not.toHaveBeenCalled();
    expect(h.dependencies.fileTree.loadRoot).toHaveBeenCalledOnce();
    h.release();
  });

  it("moves an open tab and restarts its Java document at the provider-reported destination", async () => {
    const h = await harness();
    vi.mocked(h.port.loadContent).mockResolvedValueOnce({
      filePath: "src/Renamed.java",
      content: "class Renamed {}",
      language: "java",
    });
    const message = await reconcileRefactoringEditor(
      h.dependencies,
      [
        {
          path: "src/Renamed.java",
          previousPath: "src/A.java",
          change: "move",
          primary: true,
        },
      ],
      () => true,
    );

    expect(message).toBeUndefined();
    expect(h.store.getState().activeFilePath).toBe("src/Renamed.java");
    expect(h.navigation.presentation(h.store.getState()).readyActiveFilePath).toBe(
      "src/Renamed.java",
    );
    expect(h.store.getState().contents).toEqual({ "src/Renamed.java": "class Renamed {}" });
    expect(h.dependencies.documents.closeDocument).toHaveBeenCalledWith("src/A.java");
    expect(h.dependencies.fileTree.selectFile).toHaveBeenCalledWith("src/Renamed.java");
    expect(h.dependencies.documents.activate).toHaveBeenCalledWith(
      "src/Renamed.java",
      "class Renamed {}",
    );
    expect(h.dependencies.documents.queueChange).toHaveBeenCalledWith(
      "src/Renamed.java",
      "class Renamed {}",
    );
    expect(h.port.inspectContent).not.toHaveBeenCalled();
    expect(h.port.closeFile).toHaveBeenCalledWith("src/A.java");
    h.release();
  });

  it("stops subsequent collaborators when the workspace changes during document synchronization", async () => {
    const h = await harness();
    let current = true;
    h.dependencies.documents.flush.mockImplementationOnce(async () => {
      current = false;
    });
    await reconcileRefactoringEditor(h.dependencies, changes, () => current);
    expect(h.dependencies.documents.notifySaved).not.toHaveBeenCalled();
    expect(h.dependencies.fileTree.loadRoot).not.toHaveBeenCalled();
    expect(h.dependencies.refreshProjectModel).not.toHaveBeenCalled();
    h.release();
  });

  it("retains a visible language warning for a close failure while the workspace is still current", async () => {
    const h = await harness();
    h.dependencies.documents.closeDocument.mockRejectedValueOnce(new Error("language unavailable"));
    const message = await reconcileRefactoringEditor(h.dependencies, [{ path: "src/Renamed.java", previousPath: "src/A.java", change: "move", primary: true }], () => true);
    expect(message).toContain("language synchronization could not be restarted");
    expect(h.dependencies.refreshProjectModel).toHaveBeenCalledOnce();
    expect(h.store.getState().activeFilePath).toBe("src/Renamed.java");
    h.release();
  });

  it.each(["resolve", "reject"])("does not activate a moved document after its previous close settles %s in a retired workspace", async (outcome) => {
    const h = await harness();
    let current = true;
    let resolve!: () => void, reject!: (error: Error) => void;
    h.dependencies.documents.closeDocument.mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    const refresh = vi.spyOn(h.dependencies.editor, "refreshCleanBuffers");
    const reconciling = reconcileRefactoringEditor(h.dependencies, [{ path: "src/Renamed.java", previousPath: "src/A.java", change: "move", primary: true }], () => current);
    await vi.waitFor(() => expect(h.dependencies.documents.closeDocument).toHaveBeenCalledOnce());
    current = false;
    if (outcome === "resolve") resolve(); else reject(new Error("retired close"));
    await expect(reconciling).resolves.toBeUndefined();
    expect(h.dependencies.documents.activate).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(h.dependencies.documents.queueChange).not.toHaveBeenCalled();
    expect(h.dependencies.documents.notifySaved).not.toHaveBeenCalled();
    expect(h.dependencies.fileTree.loadRoot).not.toHaveBeenCalled();
    expect(h.dependencies.refreshProjectModel).not.toHaveBeenCalled();
    h.release();
  });
  it.each(["resolve", "reject"])("does not refresh later buffers after moved-document activation settles %s in a retired workspace", async (outcome) => {
    const h = await harness();
    let current = true;
    let resolve!: () => void, reject!: (error: Error) => void;
    h.dependencies.documents.activate.mockReturnValueOnce(new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    const refresh = vi.spyOn(h.dependencies.editor, "refreshCleanBuffers");
    const reconciling = reconcileRefactoringEditor(h.dependencies, [{ path: "src/Renamed.java", previousPath: "src/A.java", change: "move", primary: true }], () => current);
    await vi.waitFor(() => expect(h.dependencies.documents.activate).toHaveBeenCalledOnce());
    current = false;
    if (outcome === "resolve") resolve(); else reject(new Error("retired activation"));
    await expect(reconciling).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    expect(h.dependencies.documents.queueChange).not.toHaveBeenCalled();
    expect(h.dependencies.documents.notifySaved).not.toHaveBeenCalled();
    expect(h.dependencies.fileTree.loadRoot).not.toHaveBeenCalled();
    expect(h.dependencies.refreshProjectModel).not.toHaveBeenCalled();
    h.release();
  });

  it("refuses invalid provider paths without inspecting files or updating views", async () => {
    const h = await harness();
    const message = await reconcileRefactoringEditor(
      h.dependencies,
      [{ ...changes[0], path: "../outside.java" }],
      () => true,
    );
    expect(message).toContain("invalid file paths");
    expect(h.port.inspectContent).not.toHaveBeenCalled();
    expect(h.dependencies.fileTree.loadRoot).not.toHaveBeenCalled();
    h.release();
  });
});
