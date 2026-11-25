import { describe, expect, it, vi } from "vitest";
import type { OpenFile } from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";

const file: OpenFile = { filePath: "Main.java", name: "Main.java", language: "java", openedAt: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const store = createEditorStore();
  store.getState().openFile(file);
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({ filePath, content: "source", language: "java" })),
    getOpenFiles: vi.fn(async () => []),
    saveContent: vi.fn(async () => [{ ...file }]),
    closeFile: vi.fn(() => []),
  };
  const editor = new EditorViewModel(store.getState, port);
  editor.updateContent(file.filePath, "draft");
  return { store, port, editor };
}

describe("editor buffer lifetime ownership", () => {
  it("changes identity after close/reopen even with the same metadata object and timestamp", () => {
    const h = harness();
    const original = h.editor.bufferLifetime(file.filePath);
    expect(typeof original).toBe("symbol");
    h.store.getState().closeFile(file.filePath);
    expect(h.editor.bufferLifetime(file.filePath)).toBeUndefined();
    h.store.getState().openFile(file);
    expect(h.editor.bufferLifetime(file.filePath)).not.toBe(original);
  });

  it("preserves lifetime across typing, activation, ordinary Save and metadata refresh", async () => {
    const h = harness();
    const lifetime = h.editor.bufferLifetime(file.filePath);
    h.editor.updateContent(file.filePath, "new draft");
    h.store.getState().openFile(file);
    h.store.getState().setOpenFiles([{ ...file, language: "kotlin" }]);
    h.editor.switchActiveFile(file.filePath);
    await h.editor.saveFile(file.filePath);
    expect(h.editor.bufferLifetime(file.filePath)).toBe(lifetime);
    expect(h.port.saveContent).toHaveBeenCalledWith(file.filePath, "new draft");
    expect(h.store.getState().tabs[0].isDirty).toBe(false);
  });

  it("retires removed inventory lifetimes and content without reviving them when the path is re-added", () => {
    const h = harness();
    const lifetime = h.editor.bufferLifetime(file.filePath);
    h.store.getState().setCursorPosition(file.filePath, { line: 2, column: 3 });
    h.store.getState().setOpenFiles([]);
    h.store.getState().setOpenFiles([file]);
    expect(h.editor.bufferLifetime(file.filePath)).not.toBe(lifetime);
    expect(h.store.getState().contents[file.filePath]).toBeUndefined();
    expect(h.store.getState().cursorPositions[file.filePath]).toBeUndefined();
    expect(h.store.getState().bufferLifetimes.size).toBe(1);
  });

  it("keeps companion lifetimes, exact dirty content and cursor positions during selected metadata replacement", () => {
    const h = harness();
    const other = { ...file, filePath: "Other.java" };
    h.store.getState().openFile(other);
    h.editor.updateContent(other.filePath, "other café draft");
    h.store.getState().setCursorPosition(other.filePath, { line: 4, column: 5 });
    const companion = h.editor.bufferLifetime(other.filePath);
    h.store.getState().setOpenFiles([{ ...file }, { ...other }], other.filePath);
    expect(h.editor.bufferLifetime(other.filePath)).toBe(companion);
    expect(h.store.getState().contents[other.filePath]).toBe("other café draft");
    expect(h.store.getState().cursorPositions[other.filePath]).toEqual({ line: 4, column: 5 });
    expect(h.store.getState().tabs.every((tab) => tab.isDirty)).toBe(true);
    expect(h.store.getState().activeFilePath).toBe(other.filePath);
  });

  it("does not adopt old save metadata or clear dirty state on a reopened identical buffer", async () => {
    const h = harness();
    const pause = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(pause.promise);
    const saving = h.editor.saveFile(file.filePath);
    h.store.getState().closeFile(file.filePath);
    h.store.getState().openFile(file);
    h.editor.updateContent(file.filePath, "draft");
    const reopened = h.store.getState().openFiles;
    pause.resolve([{ ...file, name: "stale save metadata" }]);
    await saving;
    expect(h.store.getState().openFiles).toBe(reopened);
    expect(h.store.getState().contents[file.filePath]).toBe("draft");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });

  it("does not issue queued writes from an old lifetime after close/reopen; a fresh Save remains explicit", async () => {
    const h = harness();
    const pause = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(pause.promise);
    const first = h.editor.saveFile(file.filePath);
    h.editor.updateContent(file.filePath, "second old-lifetime draft");
    const queued = h.editor.saveFile(file.filePath);
    h.store.getState().closeFile(file.filePath);
    h.store.getState().openFile(file);
    h.editor.updateContent(file.filePath, "new lifetime café draft");
    pause.resolve([file]);
    await Promise.all([first, queued]);
    expect(h.port.saveContent).toHaveBeenCalledTimes(1);
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    await h.editor.saveFile(file.filePath);
    expect(h.port.saveContent).toHaveBeenCalledTimes(2);
    expect(h.port.saveContent).toHaveBeenLastCalledWith(file.filePath, "new lifetime café draft");
    expect(h.store.getState().tabs[0].isDirty).toBe(false);
  });

  it("refuses an issued disk comparison after identical same-path reuse", async () => {
    const h = harness();
    h.port.inspectContent = vi.fn(async () => ({
      filePath: file.filePath,
      content: "disk text",
      language: file.language,
      changedSinceRead: true,
      revision: "a".repeat(64),
    }));
    h.port.acceptDiskSnapshot = vi.fn();
    const comparison = await h.editor.compareWithDisk(file.filePath);
    h.store.getState().closeFile(file.filePath);
    h.store.getState().openFile(file);
    h.store.getState().setContent(file.filePath, "draft");
    h.store.getState().setDirty(file.filePath, true);
    expect(() => h.editor.useDiskVersion(comparison)).toThrow("stale");
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.store.getState().contents[file.filePath]).toBe("draft");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });

  it("refuses a reviewed recovery replacement after identical same-path reuse", () => {
    const h = harness();
    const replacement = h.editor.prepareBufferReplacement(file.filePath, "recovered text");
    h.store.getState().closeFile(file.filePath);
    h.store.getState().openFile(file);
    h.store.getState().setContent(file.filePath, "draft");
    h.store.getState().setDirty(file.filePath, true);
    expect(() => h.editor.replaceBuffer(replacement)).toThrow("reviewed buffer changed");
    expect(h.store.getState().contents[file.filePath]).toBe("draft");
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });

  it("does not save orphaned content with no open lifetime", async () => {
    const h = harness();
    h.store.getState().closeFile(file.filePath);
    h.store.getState().setContent(file.filePath, "orphan");
    await h.editor.saveFile(file.filePath);
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });
});
