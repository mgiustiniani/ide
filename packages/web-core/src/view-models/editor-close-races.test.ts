import { describe, expect, it, vi } from "vitest";
import type { OpenFile } from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function harness() {
  const store = createEditorStore();
  const close = deferred<OpenFile[]>();
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({
      filePath,
      content: `original ${filePath}`,
      language: "java",
    })),
    saveContent: vi.fn(async () => [...store.getState().openFiles]),
    getOpenFiles: vi.fn(async () => []),
    closeFile: vi.fn(() => close.promise),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile("Main.java");
  await editor.openFile("Other.java");
  editor.updateContent("Other.java", "unrelated café draft");
  editor.switchActiveFile("Main.java");
  return { store, port, editor, close };
}
function retained(h: Awaited<ReturnType<typeof harness>>, text: string, dirty: boolean) {
  expect(h.store.getState().contents["Main.java"]).toBe(text);
  expect(h.store.getState().tabs.find((tab) => tab.filePath === "Main.java")?.isDirty).toBe(dirty);
  expect(h.store.getState().contents["Other.java"]).toBe("unrelated café draft");
  expect(h.store.getState().tabs.find((tab) => tab.filePath === "Other.java")?.isDirty).toBe(true);
  expect(h.port.saveContent).not.toHaveBeenCalled();
}

describe("EditorViewModel asynchronous close admission", () => {
  it("retains an edit arriving while the provider close is pending", async () => {
    const h = await harness();
    const closing = h.editor.closeFile("Main.java");
    h.editor.updateContent("Main.java", "edit during close");
    h.close.resolve(h.store.getState().openFiles.filter((file) => file.filePath !== "Main.java"));
    await expect(closing).rejects.toThrow(/changed|stale/i);
    retained(h, "edit during close", true);
  });
  it("refuses a changed-and-changed-back dirty buffer rather than comparing text alone", async () => {
    const h = await harness();
    h.editor.updateContent("Main.java", "reviewed draft");
    const closing = h.editor.closeFile("Main.java");
    h.editor.updateContent("Main.java", "intermediate draft");
    h.editor.updateContent("Main.java", "reviewed draft");
    h.close.resolve([]);
    await expect(closing).rejects.toThrow(/changed|stale/i);
    retained(h, "reviewed draft", true);
  });
  it("cannot close a same-path buffer belonging to a later workspace generation", async () => {
    const h = await harness();
    const closing = h.editor.closeFile("Main.java");
    h.editor.invalidateWorkspaceOperations();
    h.store.getState().closeFile("Main.java");
    await h.editor.openFile("Main.java");
    h.editor.updateContent("Main.java", "new workspace draft");
    h.close.resolve([]);
    await expect(closing).rejects.toThrow(/changed|stale/i);
    retained(h, "new workspace draft", true);
  });
  it("cannot close a clean same-path buffer reopened within the same generation", async () => {
    const h = await harness();
    const closing = h.editor.closeFile("Main.java");
    h.store.getState().closeFile("Main.java");
    await h.editor.openFile("Main.java");
    h.close.resolve([]);
    await expect(closing).rejects.toThrow(/changed|stale/i);
    retained(h, "original Main.java", false);
  });
  it("removes only the selected lifetime, not new tabs omitted by a stale provider inventory", async () => {
    const h = await harness();
    const inventory = h.store.getState().openFiles.filter((file) => file.filePath !== "Main.java");
    const closing = h.editor.closeFile("Main.java");
    await h.editor.openFile("New.java");
    h.editor.updateContent("New.java", "new dirty buffer");
    h.close.resolve(inventory);
    await closing;
    expect(h.store.getState().openFiles.map((file) => file.filePath)).toEqual([
      "Other.java",
      "New.java",
    ]);
    expect(h.store.getState().activeFilePath).toBe("New.java");
    expect(h.store.getState().contents["New.java"]).toBe("new dirty buffer");
    expect(h.store.getState().tabs.every((tab) => tab.isDirty)).toBe(true);
    expect(h.store.getState().contents["Main.java"]).toBeUndefined();
  });
  it("does not revoke provider revisions or remove buffers while a source save is pending", async () => {
    const h = await harness();
    const saved = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(saved.promise);
    h.editor.updateContent("Main.java", "source being saved");
    const saving = h.editor.saveFile("Main.java");
    await expect(h.editor.closeFile("Main.java")).rejects.toThrow(/changed|saving|closing/i);
    expect(h.port.closeFile).not.toHaveBeenCalled();
    expect(h.store.getState().contents["Main.java"]).toBe("source being saved");
    saved.resolve([...h.store.getState().openFiles]);
    await saving;
    expect(h.store.getState().tabs).toHaveLength(2);
    expect(h.store.getState().tabs.find((tab) => tab.filePath === "Other.java")?.isDirty).toBe(
      true,
    );
  });

  it("retains the exact buffers and selection when provider close fails", async () => {
    const h = await harness();
    const contents = h.store.getState().contents;
    h.close.reject(new Error("provider close failed"));
    await expect(h.editor.closeFile("Main.java")).rejects.toThrow("provider close failed");
    expect(h.store.getState().contents).toBe(contents);
    expect(h.store.getState().activeFilePath).toBe("Main.java");
    retained(h, "original Main.java", false);
  });
  it("commits an in-memory synchronous provider close without an unnecessary await gap", async () => {
    const h = await harness();
    h.port.closeFile = vi.fn(() => []);
    const closing = h.editor.closeFile("Main.java");
    expect(h.store.getState().tabs.map((tab) => tab.filePath)).toEqual(["Other.java"]);
    expect(h.store.getState().contents["Other.java"]).toBe("unrelated café draft");
    await closing;
  });
  it("does not let an asynchronous save inventory drop a companion opened while saving", async () => {
    const h = await harness();
    const saved = deferred<OpenFile[]>();
    const main = h.store.getState().openFiles.find((file) => file.filePath === "Main.java")!;
    vi.mocked(h.port.saveContent).mockReturnValueOnce(saved.promise);
    h.editor.updateContent("Main.java", "saved main");
    const saving = h.editor.saveFile("Main.java");
    await h.editor.openFile("New.java");
    h.editor.updateContent("New.java", "new unsaved companion");
    saved.resolve([main]);
    await saving;
    expect(h.store.getState().tabs.map((tab) => tab.filePath)).toEqual([
      "Main.java",
      "Other.java",
      "New.java",
    ]);
    expect(
      h.store
        .getState()
        .tabs.filter((tab) => tab.isDirty)
        .map((tab) => tab.filePath),
    ).toEqual(["Other.java", "New.java"]);
    expect(h.store.getState().contents["New.java"]).toBe("new unsaved companion");
    expect(h.store.getState().activeFilePath).toBe("New.java");
  });
});
