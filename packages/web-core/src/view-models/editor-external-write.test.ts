import { describe, expect, it, vi } from "vitest";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";
import { EditorOpenCoordinator } from "../editor-open-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function harness() {
  const store = createEditorStore();
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({
      filePath,
      content: "original",
      language: "java" as const,
    })),
    saveContent: vi.fn(async () => store.getState().openFiles),
    closeFile: vi.fn(() => []),
    getOpenFiles: vi.fn(async () => []),
    inspectContent: vi.fn(async (filePath) => ({
      filePath,
      content: "external",
      language: "java" as const,
      revision: "revision",
      changedSinceRead: true,
    })),
    acceptDiskSnapshot: vi.fn(),
  };
  return { store, port, editor: new EditorViewModel(store.getState, port) };
}

describe("EditorViewModel external workspace writes", () => {
  it("ordinary open cancellation preserves buffer reviews and cannot release an active write", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    const verify = h.editor.reviewSavedBuffers();
    h.editor.cancelPendingOpen();
    expect(verify).not.toThrow();
    const release = h.editor.beginExternalWrite();
    const coordinator = new EditorOpenCoordinator(h.editor, h.store.getState);
    await coordinator.open("B.java");
    expect(coordinator.state.status).toBe("error");
    expect(h.port.loadContent).toHaveBeenCalledTimes(1);
    expect(() => h.editor.updateContent("A.java", "new text")).toThrow("transformation");
    await expect(h.editor.saveFile("A.java")).rejects.toThrow("transformation");
    release();
    expect(verify).not.toThrow();
    expect(h.store.getState().contents["A.java"]).toBe("original");
  });
  it("loads actual changed bytes into clean buffers and adopts their revision only under the write guard", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    await h.editor.openFile("B.java");
    const release = h.editor.beginExternalWrite();
    const result = await h.editor.refreshCleanBuffers(
      ["A.java", "A.java", "NotOpen.java"],
      () => true,
    );
    expect(result.files.map((file) => file.filePath)).toEqual(["A.java"]);
    expect(result.warnings).toEqual([]);
    expect(h.store.getState().contents).toMatchObject({
      "A.java": "external",
      "B.java": "original",
    });
    expect(h.store.getState().tabs.every((tab) => !tab.isDirty)).toBe(true);
    expect(h.port.inspectContent).toHaveBeenCalledOnce();
    expect(h.port.acceptDiskSnapshot).toHaveBeenCalledOnce();
    expect(h.port.saveContent).not.toHaveBeenCalled();
    release();
    await expect(h.editor.refreshCleanBuffers(["A.java"], () => true)).rejects.toThrow(
      "active workspace write",
    );
  });

  it("retains an unreadable or moved buffer and exposes a reconciliation warning", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    vi.mocked(h.port.inspectContent!).mockRejectedValueOnce(new Error("missing"));
    const release = h.editor.beginExternalWrite();
    const result = await h.editor.refreshCleanBuffers(["A.java"], () => true);
    expect(result.files).toEqual([]);
    expect(result.warnings[0]).toContain("retained");
    expect(h.store.getState().contents["A.java"]).toBe("original");
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    release();
  });

  it("moves a clean tab to the actual transformed file and closes the old save baseline", async () => {
    const h = harness();
    await h.editor.openFile("src/Old.java");
    h.store.getState().setCursorPosition("src/Old.java", { line: 4, column: 2 });
    const oldLifetime = h.editor.bufferLifetime("src/Old.java");
    const release = h.editor.beginExternalWrite();
    vi.mocked(h.port.loadContent).mockResolvedValueOnce({
      filePath: "src/New.java",
      content: "class New {}",
      language: "java",
    });

    const moved = await h.editor.reconcileMovedCleanBuffer(
      "src/Old.java",
      "src/New.java",
      () => true,
    );

    expect(moved).toEqual({
      filePath: "src/New.java",
      content: "class New {}",
      language: "java",
    });
    expect(h.port.closeFile).toHaveBeenCalledWith("src/Old.java");
    expect(h.store.getState().tabs).toEqual([
      { filePath: "src/New.java", isDirty: false, isActive: true },
    ]);
    expect(h.store.getState().contents).toEqual({ "src/New.java": "class New {}" });
    expect(h.store.getState().activeFilePath).toBe("src/New.java");
    expect(h.store.getState().cursorPositions["src/New.java"]).toEqual({ line: 4, column: 2 });
    expect(h.editor.bufferLifetime("src/New.java")).not.toBe(oldLifetime);
    expect(h.editor.bufferLifetime("src/Old.java")).toBeUndefined();
    release();
    h.editor.updateContent("src/New.java", "class New { void changed() {} }");
    await h.editor.saveFile("src/New.java");
    expect(h.port.saveContent).toHaveBeenCalledWith(
      "src/New.java",
      "class New { void changed() {} }",
    );
  });

  it("refuses a moved tab when the destination is already open", async () => {
    const h = harness();
    await h.editor.openFile("src/Old.java");
    await h.editor.openFile("src/New.java");
    const release = h.editor.beginExternalWrite();

    await expect(
      h.editor.reconcileMovedCleanBuffer("src/Old.java", "src/New.java", () => true),
    ).rejects.toThrow("already open");
    expect(h.port.loadContent).toHaveBeenCalledTimes(2);
    expect(h.port.closeFile).not.toHaveBeenCalled();
    expect(h.store.getState().tabs.map((tab) => tab.filePath)).toEqual([
      "src/Old.java",
      "src/New.java",
    ]);
    release();
  });

  it("does not rebind a moved tab after its workspace becomes stale during the read", async () => {
    const h = harness();
    await h.editor.openFile("src/Old.java");
    const pending = deferred<Awaited<ReturnType<EditorPort["loadContent"]>>>();
    vi.mocked(h.port.loadContent).mockReturnValueOnce(pending.promise);
    const release = h.editor.beginExternalWrite();
    let current = true;
    const reconciling = h.editor.reconcileMovedCleanBuffer(
      "src/Old.java",
      "src/New.java",
      () => current,
    );
    current = false;
    pending.resolve({ filePath: "src/New.java", content: "new", language: "java" });

    await expect(reconciling).resolves.toBeUndefined();
    expect(h.store.getState().tabs.map((tab) => tab.filePath)).toEqual(["src/Old.java"]);
    expect(h.port.closeFile).not.toHaveBeenCalled();
    release();
  });

  it("does not retry adapter cleanup or publish moved contents after an asynchronous close fails in a retired workspace", async () => {
    const h = harness();
    await h.editor.openFile("src/Old.java");
    const release = h.editor.beginExternalWrite();
    vi.mocked(h.port.loadContent).mockResolvedValueOnce({ filePath: "src/New.java", content: "new contents", language: "java" });
    let reject!: (error: Error) => void;
    vi.mocked(h.port.closeFile).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const reconciling = h.editor.reconcileMovedCleanBuffer("src/Old.java", "src/New.java", () => true);
    await vi.waitFor(() => expect(h.port.closeFile).toHaveBeenCalledOnce());
    h.editor.invalidateWorkspaceOperations();
    reject(new Error("close completed after workspace retirement"));
    await expect(reconciling).resolves.toBeUndefined();
    expect(h.port.closeFile).toHaveBeenCalledTimes(1);
    expect(h.port.saveContent).not.toHaveBeenCalled();
    release();
  });

  it("does not adopt a late disk read into a closed and reopened buffer", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    const pending = deferred<Awaited<ReturnType<NonNullable<EditorPort["inspectContent"]>>>>();
    vi.mocked(h.port.inspectContent!).mockReturnValueOnce(pending.promise);
    const release = h.editor.beginExternalWrite();
    const refreshing = h.editor.refreshCleanBuffers(["A.java"], () => true);
    await h.editor.closeFile("A.java");
    // Native opens are held during a write, but externally restored inventory
    // still cannot acquire authority from a retired buffer's disk read.
    const state = h.store.getState();
    state.openFile({ filePath: "A.java", name: "A.java", language: "java", openedAt: 2 });
    state.setContent("A.java", "original");
    pending.resolve({
      filePath: "A.java",
      content: "external",
      language: "java",
      revision: "revision",
      changedSinceRead: true,
    });
    const result = await refreshing;
    expect(result.warnings[0]).toContain("retained");
    expect(h.store.getState().contents["A.java"]).toBe("original");
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    release();
  });

  it("does not adopt a disk read completed after workspace invalidation", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    const pending = deferred<Awaited<ReturnType<NonNullable<EditorPort["inspectContent"]>>>>();
    vi.mocked(h.port.inspectContent!).mockReturnValueOnce(pending.promise);
    const release = h.editor.beginExternalWrite();
    const refreshing = h.editor.refreshCleanBuffers(["A.java"], () => true);
    h.editor.invalidateWorkspaceOperations();
    pending.resolve({
      filePath: "A.java",
      content: "external",
      language: "java",
      revision: "revision",
      changedSinceRead: true,
    });
    expect((await refreshing).files).toEqual([]);
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.store.getState().contents["A.java"]).toBe("original");
    release();
  });

  it("refuses dirty buffers and pending saves without saving or discarding their text", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    h.editor.updateContent("A.java", "unsaved");
    expect(() => h.editor.reviewSavedBuffers()).toThrow("Save all");
    expect(() => h.editor.beginExternalWrite()).toThrow("Save all");
    expect(h.store.getState().contents["A.java"]).toBe("unsaved");
    expect(h.port.saveContent).not.toHaveBeenCalled();
    const pending = deferred<Awaited<ReturnType<EditorPort["saveContent"]>>>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(pending.promise);
    const saving = h.editor.saveFile("A.java");
    expect(() => h.editor.beginExternalWrite()).toThrow("Save all");
    pending.resolve(h.store.getState().openFiles);
    await saving;
    const release = h.editor.beginExternalWrite();
    release();
  });

  it("refuses a pending file load even when there are no dirty tabs", async () => {
    const h = harness();
    const pending = deferred<Awaited<ReturnType<EditorPort["loadContent"]>>>();
    vi.mocked(h.port.loadContent).mockReturnValueOnce(pending.promise);
    const loading = h.editor.openFile("A.java");
    expect(() => h.editor.reviewSavedBuffers()).toThrow("Save all");
    pending.resolve({ filePath: "A.java", content: "original", language: "java" });
    await loading;
    expect(() => h.editor.reviewSavedBuffers()()).not.toThrow();
  });

  it("rejects edits restored to identical saved text and close/reopen after review", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    const review = h.editor.reviewSavedBuffers();
    h.editor.updateContent("A.java", "edit");
    h.editor.updateContent("A.java", "original");
    await h.editor.saveFile("A.java");
    expect(review).toThrow("changed after the review");
    const reopenReview = h.editor.reviewSavedBuffers();
    await h.editor.closeFile("A.java");
    await h.editor.openFile("A.java");
    expect(reopenReview).toThrow("changed after the review");
  });

  it("prevents edits, saves, disk replacement and recovery until release", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    const comparison = await h.editor.compareWithDisk("A.java");
    const recovery = h.editor.prepareBufferReplacement("A.java", "recovery");
    const release = h.editor.beginExternalWrite();
    expect(() => h.editor.updateContent("A.java", "edit")).toThrow("transformation");
    await expect(h.editor.saveFile("A.java")).rejects.toThrow("transformation");
    expect(() => h.editor.useDiskVersion(comparison)).toThrow("transformation");
    expect(() => h.editor.replaceBuffer(recovery)).toThrow("transformation");
    expect(() => h.editor.beginExternalWrite()).toThrow("transformation");
    expect(h.store.getState().contents["A.java"]).toBe("original");
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    release();
    h.editor.replaceBuffer(recovery);
    expect(h.store.getState().contents["A.java"]).toBe("recovery");
  });

  it("invalidates workspace reviews and does not release a new write with an old token", async () => {
    const h = harness();
    await h.editor.openFile("A.java");
    const review = h.editor.reviewSavedBuffers();
    const oldRelease = h.editor.beginExternalWrite();
    h.editor.invalidateWorkspaceOperations();
    expect(review).toThrow("changed after the review");
    const newRelease = h.editor.beginExternalWrite();
    oldRelease();
    expect(() => h.editor.updateContent("A.java", "edit")).toThrow("transformation");
    newRelease();
    h.editor.updateContent("A.java", "edit");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });
});
