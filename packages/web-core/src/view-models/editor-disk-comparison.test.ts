import { describe, expect, it, vi } from "vitest";
import type { EditorDiskSnapshot, OpenFile } from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";

function harness() {
  const store = createEditorStore();
  const files: OpenFile[] = [];
  const snapshot: EditorDiskSnapshot = Object.freeze({
    filePath: "Main.java",
    content: "external",
    language: "java",
    revision: "b".repeat(64),
    changedSinceRead: true,
  });
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => {
      files.push({ filePath, name: filePath, language: "java", openedAt: files.length });
      return { filePath, content: "original", language: "java" };
    }),
    saveContent: vi.fn(async () => [...files]),
    getOpenFiles: vi.fn(async () => [...files]),
    closeFile: vi.fn(async (filePath) => files.filter((file) => file.filePath !== filePath)),
    inspectContent: vi.fn(async () => snapshot),
    acceptDiskSnapshot: vi.fn(),
  };
  const editor = new EditorViewModel(store.getState, port);
  return { store, port, editor, snapshot };
}

describe("EditorViewModel disk comparison", () => {
  it("compares without changing the buffer, dirty state or save baseline", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    h.editor.updateContent("Main.java", "local edits");
    const comparison = await h.editor.compareWithDisk("Main.java");
    expect(comparison.bufferContent).toBe("local edits");
    expect(comparison.diskSnapshot.content).toBe("external");
    expect(h.store.getState().contents["Main.java"]).toBe("local edits");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });

  it("adopts only an explicitly selected snapshot and retains unrelated dirty buffers", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    h.editor.updateContent("Main.java", "local edits");
    await h.editor.openFile("Other.java");
    h.editor.updateContent("Other.java", "keep these edits");
    const capture = h.editor.captureEditorBuffers();
    const comparison = await h.editor.compareWithDisk("Main.java");
    h.editor.useDiskVersion(comparison);
    expect(capture.isDocumentCurrent("Main.java")).toBe(false);
    expect(capture.isDocumentCurrent("Other.java")).toBe(true);
    expect(h.port.acceptDiskSnapshot).toHaveBeenCalledWith(h.snapshot);
    expect(h.store.getState().contents["Main.java"]).toBe("external");
    expect(h.store.getState().tabs.find((tab) => tab.filePath === "Main.java")?.isDirty).toBe(
      false,
    );
    expect(h.store.getState().contents["Other.java"]).toBe("keep these edits");
    expect(h.store.getState().tabs.find((tab) => tab.filePath === "Other.java")?.isDirty).toBe(
      true,
    );
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(() => h.editor.useDiskVersion(comparison)).toThrow(/changed|stale/i);
  });

  it("refuses a comparison after edits, including content changed and changed back", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    h.editor.updateContent("Main.java", "local");
    const comparison = await h.editor.compareWithDisk("Main.java");
    h.editor.updateContent("Main.java", "new edit");
    h.editor.updateContent("Main.java", "local");
    expect(() => h.editor.useDiskVersion(comparison)).toThrow(/changed|stale/i);
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });

  it("refuses when the buffer changes during the disk read", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    let resolve!: (snapshot: EditorDiskSnapshot) => void;
    vi.mocked(h.port.inspectContent!).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = h.editor.compareWithDisk("Main.java");
    h.editor.updateContent("Main.java", "new edit");
    resolve(h.snapshot);
    await expect(pending).rejects.toThrow(/changed|stale/i);
    expect(h.store.getState().contents["Main.java"]).toBe("new edit");
  });

  it("refuses after a workspace invalidation or closing and reopening the same path", async () => {
    for (const invalidate of ["workspace", "reopen"]) {
      const h = harness();
      await h.editor.openFile("Main.java");
      const comparison = await h.editor.compareWithDisk("Main.java");
      if (invalidate === "workspace") h.editor.invalidateWorkspaceOperations();
      else {
        await h.editor.closeFile("Main.java");
        await h.editor.openFile("Main.java");
      }
      expect(() => h.editor.useDiskVersion(comparison)).toThrow(/changed|stale/i);
      expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    }
  });

  it("refuses replacement during a pending save", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    h.editor.updateContent("Main.java", "local");
    const comparison = await h.editor.compareWithDisk("Main.java");
    let resolve!: (files: OpenFile[]) => void;
    vi.mocked(h.port.saveContent).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const saving = h.editor.saveFile("Main.java");
    expect(() => h.editor.useDiskVersion(comparison)).toThrow(/save|changed|stale/i);
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    resolve([...h.store.getState().openFiles]);
    await saving;
  });

  it("does not change the buffer when revision adoption fails", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    h.editor.updateContent("Main.java", "local");
    const comparison = await h.editor.compareWithDisk("Main.java");
    vi.mocked(h.port.acceptDiskSnapshot!).mockImplementationOnce(() => {
      throw new Error("stale revision");
    });
    expect(() => h.editor.useDiskVersion(comparison)).toThrow("stale revision");
    expect(h.store.getState().contents["Main.java"]).toBe("local");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });

  it("rejects unavailable inspection and fabricated comparisons", async () => {
    const h = harness();
    await h.editor.openFile("Main.java");
    expect(() =>
      h.editor.useDiskVersion({
        filePath: "Main.java",
        bufferContent: "original",
        diskSnapshot: h.snapshot,
      }),
    ).toThrow(/changed|stale/i);
    delete h.port.inspectContent;
    await expect(h.editor.compareWithDisk("Main.java")).rejects.toThrow(/unavailable/i);
  });
});
