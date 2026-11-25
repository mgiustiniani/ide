import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorContent, OpenFile } from "@ide/contracts";
import type { EditorPort } from "../ports/editor-port";
import { createEditorStore } from "../state/editor-store";
import { EditorViewModel } from "./editor-view-model";

function openFile(filePath: string, language = "typescript"): OpenFile {
  return {
    filePath,
    name: filePath.split("/").pop() ?? filePath,
    language,
    openedAt: 1,
  };
}

function content(
  filePath: string,
  value = `content of ${filePath}`,
  language = "typescript",
): EditorContent {
  return { filePath, content: value, language };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPort(): EditorPort {
  return {
    loadContent: vi.fn(async (filePath) => content(filePath)),
    saveContent: vi.fn(async () => []),
    getOpenFiles: vi.fn(async () => []),
    closeFile: vi.fn(async () => []),
  };
}

describe("background source loading", () => {
  it("preserves active selection and dirty buffers while opening an affected source", async () => {
    const store = createEditorStore();
    const port = createPort();
    const editor = new EditorViewModel(store.getState, port);
    await editor.openFile("Main.java");
    editor.updateContent("Main.java", "unsaved main");
    expect(await editor.openFileInBackground("Use.java", () => true)).toBe(true);
    expect(store.getState().activeFilePath).toBe("Main.java");
    expect(store.getState().contents).toMatchObject({
      "Main.java": "unsaved main",
      "Use.java": "content of Use.java",
    });
    expect(store.getState().tabs.map((tab) => [tab.filePath, tab.isDirty])).toEqual([
      ["Main.java", true],
      ["Use.java", false],
    ]);
    expect(port.saveContent).not.toHaveBeenCalled();
  });

  it.each(["workspace", "foreground", "authority"])(
    "discards a late background read after %s retirement",
    async (reason) => {
      const store = createEditorStore();
      const port = createPort();
      const editor = new EditorViewModel(store.getState, port);
      await editor.openFile("Main.java");
      const pending = deferred<EditorContent>();
      vi.mocked(port.loadContent).mockReturnValueOnce(pending.promise);
      let current = true;
      const opening = editor.openFileInBackground("Use.java", () => current);
      if (reason === "workspace") editor.invalidateWorkspaceOperations();
      if (reason === "foreground") editor.switchActiveFile("Main.java");
      if (reason === "authority") current = false;
      pending.resolve(content("Use.java"));
      expect(await opening).toBe(false);
      expect(store.getState().contents["Use.java"]).toBeUndefined();
      expect(store.getState().openFiles.map((file) => file.filePath)).toEqual(["Main.java"]);
    },
  );

  it("never reloads an existing unsaved affected source", async () => {
    const store = createEditorStore();
    const port = createPort();
    const editor = new EditorViewModel(store.getState, port);
    await editor.openFile("Use.java");
    editor.updateContent("Use.java", "unsaved use");
    await editor.openFile("Main.java");
    vi.mocked(port.loadContent).mockClear();
    expect(await editor.openFileInBackground("Use.java", () => true)).toBe(true);
    expect(port.loadContent).not.toHaveBeenCalled();
    expect(store.getState().contents["Use.java"]).toBe("unsaved use");
    expect(store.getState().activeFilePath).toBe("Main.java");
  });
});

describe("EditorViewModel saveFile", () => {
  it("keeps edits made during a pending save dirty", async () => {
    const store = createEditorStore();
    const port = createPort();
    const file = openFile("Main.java", "java");
    store.getState().openFile(file);
    const pending = deferred<OpenFile[]>();
    vi.mocked(port.saveContent).mockReturnValue(pending.promise);
    const editor = new EditorViewModel(store.getState, port);
    editor.updateContent(file.filePath, "first");
    const saving = editor.saveFile(file.filePath);
    editor.updateContent(file.filePath, "second");
    pending.resolve([file]);
    await saving;
    expect(store.getState().contents[file.filePath]).toBe("second");
    expect(store.getState().tabs[0].isDirty).toBe(true);
  });

  it("serializes saves of the same file in invocation order", async () => {
    const store = createEditorStore();
    const port = createPort();
    const file = openFile("Main.java", "java");
    store.getState().openFile(file);
    const pending = deferred<OpenFile[]>();
    vi.mocked(port.saveContent).mockReturnValueOnce(pending.promise).mockResolvedValue([file]);
    const editor = new EditorViewModel(store.getState, port);
    editor.updateContent(file.filePath, "first");
    const first = editor.saveFile(file.filePath);
    await Promise.resolve();
    editor.updateContent(file.filePath, "second");
    const second = editor.saveFile(file.filePath);
    await Promise.resolve();
    expect(port.saveContent).toHaveBeenCalledTimes(1);
    pending.resolve([file]);
    await Promise.all([first, second]);
    expect(port.saveContent).toHaveBeenNthCalledWith(2, file.filePath, "second");
    expect(store.getState().tabs[0].isDirty).toBe(false);
  });

  it("does not resurrect a tab after workspace invalidation", async () => {
    const store = createEditorStore();
    const port = createPort();
    const file = openFile("Main.java", "java");
    store.getState().openFile(file);
    const pending = deferred<OpenFile[]>();
    vi.mocked(port.saveContent).mockReturnValue(pending.promise);
    const editor = new EditorViewModel(store.getState, port);
    editor.updateContent(file.filePath, "first");
    const saving = editor.saveFile(file.filePath);
    await Promise.resolve();
    editor.invalidateWorkspaceOperations();
    store.getState().closeFile(file.filePath);
    pending.resolve([file]);
    await saving;
    expect(store.getState().openFiles).toEqual([]);
  });
});

describe("EditorViewModel openFile", () => {
  let store: ReturnType<typeof createEditorStore>;
  let port: EditorPort;
  let viewModel: EditorViewModel;

  beforeEach(() => {
    store = createEditorStore();
    port = createPort();
    viewModel = new EditorViewModel(store.getState, port);
  });

  it("lazy loads and activates a restored non-active file without changing tab order", async () => {
    const files = [openFile("active.ts"), openFile("restored.ts")];
    vi.mocked(port.getOpenFiles).mockResolvedValue(files);
    vi.mocked(port.loadContent).mockImplementation(async (filePath) => content(filePath));

    await viewModel.restoreSession();
    store.getState().setDirty("active.ts", true);
    store.getState().setDirty("restored.ts", true);
    await viewModel.openFile("restored.ts");

    expect(port.loadContent).toHaveBeenNthCalledWith(1, "active.ts");
    expect(port.loadContent).toHaveBeenNthCalledWith(2, "restored.ts");
    expect(store.getState().contents["restored.ts"]).toBe("content of restored.ts");
    expect(store.getState().activeFilePath).toBe("restored.ts");
    expect(store.getState().openFiles).toEqual(files);
    expect(store.getState().tabs.map((tab) => tab.filePath)).toEqual(["active.ts", "restored.ts"]);
    expect(store.getState().tabs.map((tab) => tab.isDirty)).toEqual([true, false]);
  });

  it("stores an empty restored file as a loaded buffer", async () => {
    store.getState().setOpenFiles([openFile("active.ts"), openFile("empty.ts")]);
    vi.mocked(port.loadContent).mockResolvedValue(content("empty.ts", ""));

    await viewModel.openFile("empty.ts");
    await viewModel.openFile("empty.ts");

    expect(port.loadContent).toHaveBeenCalledOnce();
    expect(Object.prototype.hasOwnProperty.call(store.getState().contents, "empty.ts")).toBe(true);
    expect(store.getState().contents["empty.ts"]).toBe("");
    expect(store.getState().activeFilePath).toBe("empty.ts");
  });

  it("activates an already buffered file without performing I/O", async () => {
    store.getState().setOpenFiles([openFile("a.ts"), openFile("b.ts")]);
    store.getState().setContent("b.ts", "");

    await viewModel.openFile("b.ts");

    expect(port.loadContent).not.toHaveBeenCalled();
    expect(store.getState().activeFilePath).toBe("b.ts");
  });

  it("preserves prior state and does not create a fake buffer when loading fails", async () => {
    store.getState().setOpenFiles([openFile("active.ts"), openFile("broken.ts")]);
    store.getState().setContent("active.ts", "keep me");
    const filesBefore = store.getState().openFiles;
    const tabsBefore = store.getState().tabs;
    vi.mocked(port.loadContent).mockRejectedValue(new Error("read failed"));

    await expect(viewModel.openFile("broken.ts")).rejects.toThrow("read failed");

    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().activeFilePath).toBe("active.ts");
    expect(store.getState().openFiles).toBe(filesBefore);
    expect(store.getState().tabs).toBe(tabsBefore);
    expect(Object.prototype.hasOwnProperty.call(store.getState().contents, "broken.ts")).toBe(
      false,
    );
  });

  it("does not let a slower earlier load steal a newer active selection", async () => {
    store.getState().setOpenFiles([openFile("current.ts"), openFile("a.ts"), openFile("b.ts")]);
    store.getState().setContent("current.ts", "current");
    const a = deferred<EditorContent>();
    const b = deferred<EditorContent>();
    vi.mocked(port.loadContent).mockImplementation((filePath) =>
      filePath === "a.ts" ? a.promise : b.promise,
    );

    const openA = viewModel.openFile("a.ts");
    const openB = viewModel.openFile("b.ts");
    b.resolve(content("b.ts"));
    await openB;

    expect(store.getState().activeFilePath).toBe("b.ts");
    expect(store.getState().isLoading).toBe(true);

    a.resolve(content("a.ts"));
    await openA;

    expect(store.getState().activeFilePath).toBe("b.ts");
    expect(store.getState().contents["a.ts"]).toBe("content of a.ts");
    expect(store.getState().isLoading).toBe(false);
  });

  it("uses the authorized canonical returned path and language in place", async () => {
    store.getState().setOpenFiles([openFile("active.ts"), openFile("alias/file.ts", "text")]);
    vi.mocked(port.loadContent).mockResolvedValue(
      content("/workspace/file.ts", "canonical content", "javascript"),
    );

    await viewModel.openFile("alias/file.ts");

    expect(store.getState().openFiles.map((file) => file.filePath)).toEqual([
      "active.ts",
      "/workspace/file.ts",
    ]);
    expect(store.getState().openFiles[1]).toMatchObject({
      filePath: "/workspace/file.ts",
      name: "file.ts",
      language: "javascript",
      openedAt: 1,
    });
    expect(store.getState().tabs.map((tab) => tab.filePath)).toEqual([
      "active.ts",
      "/workspace/file.ts",
    ]);
    expect(store.getState().contents["/workspace/file.ts"]).toBe("canonical content");
    expect(store.getState().activeFilePath).toBe("/workspace/file.ts");
  });
});
