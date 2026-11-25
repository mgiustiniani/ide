import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OpenFile } from "@ide/contracts";
import type { EditorPort } from "@ide/web-core/ports";
import { createEditorStore } from "@ide/web-core/state";
import { EditorViewModel } from "@ide/web-core/view-models";
import { useEditorCommandController } from "./useEditorCommandController";

const MAIN = "Main.java";
const OTHER = "Other.java";
const OLD_DRAFT = "original request café draft";
const NEW_DRAFT = "reopened buffer café draft";
const COMPANION = "unrelated dirty companion";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function harness() {
  const store = createEditorStore();
  const sources = new Map([
    [MAIN, "original source"],
    [OTHER, "original companion"],
  ]);
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath) => ({
      filePath,
      content: sources.get(filePath)!,
      language: "java",
    })),
    saveContent: vi.fn(async (filePath, text) => {
      sources.set(filePath, text);
      // Ordinary saved metadata need not reuse the original OpenFile objects.
      return store.getState().openFiles.map((file) => ({ ...file }));
    }),
    getOpenFiles: vi.fn(async () => []),
    closeFile: vi.fn((filePath) =>
      store.getState().openFiles.filter((file) => file.filePath !== filePath),
    ),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile(MAIN);
  await editor.openFile(OTHER);
  editor.updateContent(OTHER, COMPANION);
  editor.switchActiveFile(MAIN);
  editor.updateContent(MAIN, OLD_DRAFT);
  const documents = {
    queueChange: vi.fn(),
    flush: vi.fn(async (): Promise<void> => undefined),
    notifySaved: vi.fn(async (): Promise<void> => undefined),
    closeDocument: vi.fn(async (): Promise<void> => undefined),
    activate: vi.fn(async () => undefined),
  };
  const checkpoint = vi.fn(async (): Promise<void> => undefined);
  const desktop = { activateTab: vi.fn(), fileClosed: vi.fn() };
  const hook = renderHook(() =>
    useEditorCommandController({
      activeFilePath: MAIN,
      activeContent: OLD_DRAFT,
      hasJavaContext: false,
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      getEditorState: store.getState,
      editor,
      desktopEditor: desktop,
      documents,
      checkpointBeforeSave: checkpoint,
    }),
  );
  return { store, sources, port, editor, documents, checkpoint, desktop, hook };
}
type Harness = Awaited<ReturnType<typeof harness>>;

// Reuse the exact OpenFile object/timestamp: neither is a buffer lifetime.
function reopen(h: Harness, path: string, text: string, dirty = true) {
  const file = h.store.getState().openFiles.find((candidate) => candidate.filePath === path)!;
  h.store.getState().closeFile(path);
  h.store.getState().openFile(file);
  h.store.getState().setContent(path, text);
  if (dirty) h.editor.updateContent(path, text);
}
function retained(h: Harness, text = NEW_DRAFT, dirty = true) {
  expect(h.store.getState().contents[MAIN]).toBe(text);
  expect(h.store.getState().tabs.find((tab) => tab.filePath === MAIN)?.isDirty).toBe(dirty);
  expect(h.store.getState().contents[OTHER]).toBe(COMPANION);
  expect(h.store.getState().tabs.find((tab) => tab.filePath === OTHER)?.isDirty).toBe(true);
  expect(h.store.getState().activeFilePath).toBe(MAIN);
}

describe("editor commands bound to the original buffer lifetime", () => {
  it("does not save a reopened buffer after a deferred checkpoint", async () => {
    const h = await harness();
    const pause = deferred<void>();
    h.checkpoint.mockReturnValueOnce(pause.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.hook.result.current.saveActiveFile();
      await Promise.resolve();
    });
    act(() => reopen(h, MAIN, NEW_DRAFT));
    await act(async () => {
      pause.resolve();
      await pending;
    });
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(h.documents.notifySaved).not.toHaveBeenCalled();
    expect(h.sources.get(MAIN)).toBe("original source");
    retained(h);
    expect(h.hook.result.current.error).toContain("closed or reopened");
  });

  it.each([
    ["flush", false],
    ["flush", true],
    ["checkpoint", false],
    ["checkpoint", true],
    ["saved", false],
    ["saved", true],
    ["document-close", false],
    ["document-close", true],
  ] as const)(
    "does not close/reactivate a reopened buffer during %s (dirty=%s)",
    async (stage, dirty) => {
      const h = await harness();
      const pause = deferred<void>();
      const operation =
        stage === "flush"
          ? h.documents.flush
          : stage === "checkpoint"
            ? h.checkpoint
            : stage === "saved"
              ? h.documents.notifySaved
              : h.documents.closeDocument;
      operation.mockReturnValueOnce(pause.promise);
      let pending!: Promise<void>;
      await act(async () => {
        pending = h.hook.result.current.closeTab(MAIN);
        for (let index = 0; index < 8; index++) await Promise.resolve();
      });
      expect(operation).toHaveBeenCalledOnce();
      const savedBeforeReopen = vi.mocked(h.port.saveContent).mock.calls.length;
      act(() => reopen(h, MAIN, NEW_DRAFT, dirty));
      await act(async () => {
        pause.resolve();
        await pending;
      });
      expect(h.port.closeFile).not.toHaveBeenCalled();
      expect(h.port.saveContent).toHaveBeenCalledTimes(savedBeforeReopen);
      expect(h.desktop.fileClosed).not.toHaveBeenCalled();
      expect(h.documents.activate).not.toHaveBeenCalled();
      retained(h, NEW_DRAFT, dirty);
      expect(h.hook.result.current.error).toContain("closed or reopened");
    },
  );

  it("does not save a reopened companion from the old save-all inventory", async () => {
    const h = await harness();
    const pause = deferred<void>();
    h.documents.flush.mockReturnValueOnce(pause.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = h.hook.result.current.saveAll();
    });
    act(() => {
      reopen(h, OTHER, "new companion lifetime");
      h.editor.switchActiveFile(MAIN);
    });
    await act(async () => {
      pause.resolve();
      await expect(pending).rejects.toThrow("closed or reopened");
    });
    expect(h.port.saveContent).toHaveBeenCalledTimes(1);
    expect(h.port.saveContent).toHaveBeenCalledWith(MAIN, OLD_DRAFT);
    expect(h.sources.get(OTHER)).toBe("original companion");
    expect(h.store.getState().contents[OTHER]).toBe("new companion lifetime");
    expect(h.store.getState().tabs.find((tab) => tab.filePath === OTHER)?.isDirty).toBe(true);
    expect(h.documents.notifySaved).not.toHaveBeenCalledWith(OTHER);
  });

  it("does not acknowledge a reopened identical dirty buffer when an old Save completes", async () => {
    const h = await harness();
    const saved = deferred<OpenFile[]>();
    vi.mocked(h.port.saveContent).mockReturnValueOnce(saved.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.hook.result.current.saveActiveFile();
      for (let index = 0; index < 8; index++) await Promise.resolve();
    });
    expect(h.port.saveContent).toHaveBeenCalledOnce();
    act(() => reopen(h, MAIN, OLD_DRAFT));
    const reopened = h.store.getState().openFiles;
    await act(async () => {
      saved.resolve(reopened.map((file) => ({ ...file, name: "old returned metadata" })));
      await pending;
    });
    expect(h.store.getState().openFiles).toBe(reopened);
    expect(h.documents.notifySaved).not.toHaveBeenCalled();
    retained(h, OLD_DRAFT);
  });

  it("does not report an old close into a buffer reopened before desktop notification", async () => {
    const h = await harness();
    const file = h.store.getState().openFiles.find((candidate) => candidate.filePath === MAIN)!;
    vi.mocked(h.port.closeFile).mockImplementationOnce(() => {
      // Observed after the real view model removes the old buffer, before the
      // controller's awaited continuation. This is not a source write.
      queueMicrotask(() => {
        h.store.getState().openFile(file);
        h.editor.updateContent(MAIN, NEW_DRAFT);
      });
      return [];
    });
    await act(() => h.hook.result.current.closeTab(MAIN));
    expect(h.port.closeFile).toHaveBeenCalledOnce();
    expect(h.desktop.fileClosed).not.toHaveBeenCalled();
    retained(h);
  });

  it("still saves current edits arriving during preparation and closes after cloned metadata", async () => {
    const h = await harness();
    const pause = deferred<void>();
    h.checkpoint.mockReturnValueOnce(pause.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.hook.result.current.closeTab(MAIN);
      await Promise.resolve();
    });
    act(() => h.editor.updateContent(MAIN, "latest same-lifetime edits"));
    await act(async () => {
      pause.resolve();
      await pending;
    });
    expect(h.port.saveContent).toHaveBeenCalledOnce();
    expect(h.port.saveContent).toHaveBeenCalledWith(MAIN, "latest same-lifetime edits");
    expect(h.sources.get(MAIN)).toBe("latest same-lifetime edits");
    expect(h.desktop.fileClosed).toHaveBeenCalledWith(MAIN);
    expect(h.store.getState().tabs.map((tab) => tab.filePath)).toEqual([OTHER]);
    expect(h.store.getState().contents[OTHER]).toBe(COMPANION);
  });
});
