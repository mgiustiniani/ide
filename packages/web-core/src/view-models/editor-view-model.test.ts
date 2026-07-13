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
