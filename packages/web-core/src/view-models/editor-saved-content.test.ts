import { describe, expect, it, vi } from "vitest";
import type { OpenFile } from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";

const path = "Main.java";
const metadata: OpenFile = { filePath: path, name: path, language: "java", openedAt: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function harness(source = "class Main {}\n") {
  const store = createEditorStore();
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({ filePath, content: source, language: "java" })),
    saveContent: vi.fn(async () => [metadata]),
    closeFile: vi.fn(() => []),
    getOpenFiles: vi.fn(async () => [metadata]),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile(path);
  const dirty = (file = path) =>
    store.getState().tabs.find((tab) => tab.filePath === file)?.isDirty;
  return { store, port, editor, dirty };
}

describe("dirty state relative to acknowledged saved text", () => {
  it.each(["", "class Main {}\n", "// café 😀\r\nclass Main {}\r\n"])(
    "clears on Undo to exact saved text %j, and becomes dirty on Redo",
    async (source) => {
      const h = await harness(source);
      h.editor.updateContent(path, source + "// draft");
      expect(h.dirty()).toBe(true);
      h.editor.updateContent(path, source);
      expect(h.dirty()).toBe(false);
      h.editor.updateContent(path, source + "// draft");
      expect(h.dirty()).toBe(true);
      expect(h.port.loadContent).toHaveBeenCalledTimes(1);
      expect(h.port.saveContent).not.toHaveBeenCalled();
    },
  );

  it("compares with the latest completed Save, not the initial read", async () => {
    const h = await harness("original");
    h.editor.updateContent(path, "saved later");
    await h.editor.saveFile(path);
    h.editor.updateContent(path, "original");
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "saved later");
    expect(h.dirty()).toBe(false);
  });

  it("keeps edits during Save dirty and adopts only its acknowledged captured text", async () => {
    const h = await harness("original"),
      saving = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(saving.promise);
    h.editor.updateContent(path, "captured save");
    const operation = h.editor.saveFile(path);
    h.editor.updateContent(path, "original");
    expect(h.dirty()).toBe(true);
    saving.resolve([metadata]);
    await operation;
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "captured save");
    expect(h.dirty()).toBe(false);
    h.editor.updateContent(path, "original");
    expect(h.dirty()).toBe(true);
  });

  it("keeps the draft dirty while a later queued Save can still replace disk content", async () => {
    const h = await harness("original"),
      first = deferred<OpenFile[]>(),
      second = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    h.editor.updateContent(path, "first saved");
    const savingFirst = h.editor.saveFile(path);
    h.editor.updateContent(path, "second saved");
    const savingSecond = h.editor.saveFile(path);
    h.editor.updateContent(path, "first saved");
    first.resolve([metadata]);
    await savingFirst;
    expect(h.dirty()).toBe(true);
    second.resolve([metadata]);
    await savingSecond;
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "second saved");
    expect(h.dirty()).toBe(false);
  });

  it("does not promote rejected Save content to a saved baseline", async () => {
    const h = await harness("original");
    vi.mocked(h.port.saveContent).mockRejectedValueOnce(new Error("save refused"));
    h.editor.updateContent(path, "rejected");
    await expect(h.editor.saveFile(path)).rejects.toThrow("save refused");
    h.editor.updateContent(path, "original");
    expect(h.dirty()).toBe(false);
    h.editor.updateContent(path, "rejected");
    expect(h.dirty()).toBe(true);
  });

  it("does not carry a saved baseline through close/reopen or an old Save reply", async () => {
    const h = await harness("old read"),
      pending = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(pending.promise);
    h.editor.updateContent(path, "old save");
    const saving = h.editor.saveFile(path);
    h.store.getState().closeFile(path);
    vi.mocked(h.port.loadContent).mockResolvedValueOnce({
      filePath: path,
      content: "fresh read",
      language: "java",
    });
    await h.editor.openFile(path);
    pending.resolve([metadata]);
    await saving;
    h.editor.updateContent(path, "old save");
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "fresh read");
    expect(h.dirty()).toBe(false);
  });

  it("retires saved-text authority at a workspace boundary", async () => {
    const h = await harness("old workspace");
    h.editor.invalidateWorkspaceOperations();
    h.editor.updateContent(path, "old workspace");
    expect(h.dirty()).toBe(true);
    h.store.getState().setOpenFiles([]);
    vi.mocked(h.port.loadContent).mockResolvedValueOnce({
      filePath: path,
      content: "new workspace",
      language: "java",
    });
    await h.editor.openFile(path);
    h.editor.updateContent(path, "draft");
    h.editor.updateContent(path, "new workspace");
    expect(h.dirty()).toBe(false);
  });

  it("keeps a new empty draft dirty until its first acknowledged Save", async () => {
    const h = await harness();
    const created = { ...metadata, filePath: "New.java", name: "New.java" };
    h.store.getState().openFile(created);
    h.store.getState().setNewFile(created.filePath, true);
    h.editor.updateContent(created.filePath, "");
    expect(h.dirty(created.filePath)).toBe(true);
    await h.editor.saveFile(created.filePath);
    h.editor.updateContent(created.filePath, "draft");
    h.editor.updateContent(created.filePath, "");
    expect(h.dirty(created.filePath)).toBe(false);
  });

  it("moves the saved baseline with a renamed dirty buffer", async () => {
    const h = await harness("saved source");
    h.store
      .getState()
      .applyBufferChanges([
        {
          oldPath: path,
          path: "Renamed.java",
          before: "saved source",
          after: "transformed draft",
          isDirty: true,
        },
      ]);
    h.editor.updateContent("Renamed.java", "saved source");
    expect(h.dirty("Renamed.java")).toBe(false);
    h.editor.updateContent("Renamed.java", "transformed draft");
    expect(h.dirty("Renamed.java")).toBe(true);
  });

  it("keeps CreateFile transaction results dirty without saved-source authority", async () => {
    const h = await harness();
    h.store
      .getState()
      .applyBufferChanges([
        {
          oldPath: "Created.java",
          path: "Created.java",
          before: "",
          after: "class Created {}",
          isDirty: true,
          created: true,
        },
      ]);
    h.editor.updateContent("Created.java", "");
    expect(h.dirty("Created.java")).toBe(true);
  });

  it("changes saved-text authority only when a disk comparison is explicitly adopted", async () => {
    const h = await harness("original");
    h.port.inspectContent = vi.fn(async () => ({
      filePath: path,
      content: "external",
      language: "java",
      revision: "b".repeat(64),
      changedSinceRead: true,
    }));
    h.port.acceptDiskSnapshot = vi.fn();
    await h.editor.compareWithDisk(path);
    h.editor.updateContent(path, "external");
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "original");
    expect(h.dirty()).toBe(false);
    h.editor.useDiskVersion(await h.editor.compareWithDisk(path));
    h.editor.updateContent(path, "original");
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "external");
    expect(h.dirty()).toBe(false);
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });

  it("does not let a saved-metadata notification reauthorize a retired workspace", async () => {
    const h = await harness("original");
    vi.mocked(h.port.saveContent).mockResolvedValueOnce([{ ...metadata, name: "saved metadata" }]);
    let retired = false;
    const unsubscribe = h.store.subscribe((state) => {
      if (!retired && state.openFiles[0]?.name === "saved metadata") {
        retired = true;
        h.editor.invalidateWorkspaceOperations();
      }
    });
    h.editor.updateContent(path, "saved later");
    await h.editor.saveFile(path);
    unsubscribe();
    expect(retired).toBe(true);
    h.editor.updateContent(path, "saved later");
    expect(h.dirty()).toBe(true);
  });

  it("keeps each saved source associated with its buffer during a two-file path swap", async () => {
    const h = await harness("saved Main");
    vi.mocked(h.port.loadContent).mockResolvedValueOnce({
      filePath: "Other.java",
      content: "saved Other",
      language: "java",
    });
    await h.editor.openFile("Other.java");
    h.store.getState().applyBufferChanges([
      {
        oldPath: path,
        path: "Other.java",
        before: "saved Main",
        after: "Main draft",
        isDirty: true,
      },
      { oldPath: "Other.java", path, before: "saved Other", after: "Other draft", isDirty: true },
    ]);
    h.editor.updateContent("Other.java", "saved Main");
    expect(h.dirty("Other.java")).toBe(false);
    h.editor.updateContent(path, "saved Main");
    expect(h.dirty()).toBe(true);
    h.editor.updateContent(path, "saved Other");
    expect(h.dirty()).toBe(false);
  });

  it("retires saved text when restored inventory removes a buffer", async () => {
    const h = await harness("old source");
    h.store.getState().setOpenFiles([]);
    h.store.getState().setOpenFiles([metadata]);
    h.editor.updateContent(path, "old source");
    expect(h.dirty()).toBe(true);
    expect(h.store.getState().lastSavedContents).toEqual({});
  });

  it("publishes edited content and its dirty state together", async () => {
    const h = await harness("original");
    const unsafe: string[] = [];
    const unsubscribe = h.store.subscribe((state) => {
      if (state.contents[path] === "draft" && state.tabs[0]?.isDirty === false)
        unsafe.push("new text published as clean");
    });
    h.editor.updateContent(path, "draft");
    unsubscribe();
    expect(unsafe).toEqual([]);
  });
});
