import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorDiskSnapshot, OpenFile } from "@ide/contracts";
import { EditorViewModel } from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";
import type { EditorPort } from "@ide/web-core/ports";
import { useEditorDiskComparisonController } from "./useEditorDiskComparisonController";

async function harness(checkpointBeforeDiscard?: () => Promise<void>) {
  const store = createEditorStore();
  const file: OpenFile = {
    filePath: "Main.java",
    name: "Main.java",
    language: "java",
    openedAt: 1,
  };
  const diskSnapshot: EditorDiskSnapshot = Object.freeze({
    filePath: file.filePath,
    content: "external",
    language: "java",
    revision: "b".repeat(64),
    changedSinceRead: true,
  });
  const port: EditorPort = {
    loadContent: vi.fn(async (filePath: string) => ({
      filePath,
      content: "original",
      language: "java",
    })),
    getOpenFiles: vi.fn(async () => [file]),
    saveContent: vi.fn(async () => [file]),
    closeFile: vi.fn(async () => []),
    inspectContent: vi.fn(async () => diskSnapshot),
    acceptDiskSnapshot: vi.fn(),
  };
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile(file.filePath);
  editor.updateContent(file.filePath, "local edits");
  const synchronizeDocument = vi.fn(async (): Promise<void> => undefined);
  const reportError = vi.fn();
  const props = {
    editor,
    synchronizeDocument,
    activeFilePath: file.filePath as string | null,
    workspaceId: "one",
    workspaceGeneration: 1,
    reportError,
    checkpointBeforeDiscard,
  };
  const hook = renderHook(useEditorDiskComparisonController, { initialProps: props });
  return { hook, store, editor, port, synchronizeDocument, props, reportError };
}

describe("editor disk comparison controller", () => {
  it("offers a read-only comparison and cancel preserves local edits", async () => {
    const h = await harness();
    await act(() => h.hook.result.current.compare());
    expect(h.hook.result.current.comparison?.bufferContent).toBe("local edits");
    act(() => h.hook.result.current.cancel());
    expect(h.hook.result.current.comparison).toBeNull();
    expect(h.store.getState().contents["Main.java"]).toBe("local edits");
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });

  it("replaces after explicit confirmation and synchronizes language text without saving", async () => {
    const h = await harness();
    await act(() => h.hook.result.current.compare());
    await act(() => h.hook.result.current.useDiskVersion());
    expect(h.store.getState().contents["Main.java"]).toBe("external");
    expect(h.store.getState().tabs[0].isDirty).toBe(false);
    expect(h.synchronizeDocument).toHaveBeenCalledExactlyOnceWith("Main.java");
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(h.hook.result.current.comparison).toBeNull();
  });

  it("adopts the disk version and closes the comparison during language synchronization", async () => {
    const h = await harness();
    let release!: () => void;
    h.synchronizeDocument.mockImplementationOnce(() => new Promise<void>((done) => {
      release = done;
    }));
    await act(() => h.hook.result.current.compare());
    let pending!: Promise<void>;
    await act(async () => { pending = h.hook.result.current.useDiskVersion(); });

    expect(h.store.getState().contents["Main.java"]).toBe("external");
    expect(h.hook.result.current.comparison).toBeNull();
    expect(h.hook.result.current.busy).toBe(false);
    await act(() => h.hook.result.current.compare());
    await act(async () => { release(); await pending; });
    expect(h.hook.result.current.comparison?.bufferContent).toBe("external");
    expect(h.port.saveContent).not.toHaveBeenCalled();
  });

  it("ignores late disk reads from another workspace or selected tab", async () => {
    for (const next of [{ workspaceGeneration: 2 }, { activeFilePath: "Other.java" }]) {
      const h = await harness();
      let release!: () => void;
      vi.mocked(h.port.inspectContent!).mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          filePath: "Main.java",
          content: "external",
          language: "java",
          revision: "b".repeat(64),
          changedSinceRead: true,
        };
      });
      let pending!: Promise<void>;
      act(() => {
        pending = h.hook.result.current.compare();
      });
      h.hook.rerender({ ...h.props, ...next });
      await act(async () => {
        release();
        await pending;
      });
      expect(h.hook.result.current.comparison).toBeNull();
      expect(h.hook.result.current.busy).toBe(false);
      expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    }
  });

  it("cancels pending confirmation without discarding the buffer", async () => {
    let release!: () => void;
    const h = await harness(() => new Promise<void>((done) => { release = done; }));
    await act(() => h.hook.result.current.compare());
    let pending!: Promise<void>;
    act(() => {
      pending = h.hook.result.current.useDiskVersion();
    });
    act(() => h.hook.result.current.cancel());
    await act(async () => {
      release();
      await pending;
    });
    expect(h.store.getState().contents["Main.java"]).toBe("local edits");
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
  });

  it("retains exact edits and companion drafts made during asynchronous discard checkpointing", async () => {
    let release!: () => void;
    const h = await harness(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    await h.editor.openFile("Other.java");
    h.editor.updateContent("Other.java", "companion draft");
    h.editor.switchActiveFile("Main.java");
    await act(() => h.hook.result.current.compare());
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.hook.result.current.useDiskVersion();
      await Promise.resolve();
    });
    h.editor.updateContent("Main.java", "latest draft after confirmation");
    await act(async () => {
      release();
      await pending;
    });
    expect(h.store.getState().contents["Main.java"]).toBe("latest draft after confirmation");
    expect(h.store.getState().contents["Other.java"]).toBe("companion draft");
    expect(h.store.getState().tabs.every((tab) => tab.isDirty)).toBe(true);
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(h.synchronizeDocument).not.toHaveBeenCalled();
    expect(h.hook.result.current.busy).toBe(false);
    expect(h.reportError).toHaveBeenLastCalledWith(
      expect.stringContaining("no edits were discarded"),
    );
    await act(() => h.hook.result.current.compare());
    // A fresh review can be cancelled; the refused confirmation did not acknowledge edits.
    act(() => h.hook.result.current.cancel());
    expect(h.store.getState().contents["Main.java"]).toBe("latest draft after confirmation");
  });

  it("does not adopt a comparison after a save completed during discard checkpointing", async () => {
    let release!: () => void;
    const h = await harness(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    await act(() => h.hook.result.current.compare());
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.hook.result.current.useDiskVersion();
      await Promise.resolve();
    });
    await h.editor.saveFile("Main.java");
    await act(async () => {
      release();
      await pending;
    });
    expect(h.store.getState().contents["Main.java"]).toBe("local edits");
    expect(h.store.getState().tabs[0].isDirty).toBe(false);
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.synchronizeDocument).not.toHaveBeenCalled();
  });

  it("drops old confirmation completions after selection, workspace, cancellation or unmount", async () => {
    for (const transition of ["selection", "workspace", "cancel", "unmount"]) {
      let release!: () => void;
      const h = await harness(
        () =>
          new Promise<void>((done) => {
            release = done;
          }),
      );
      await act(() => h.hook.result.current.compare());
      let pending!: Promise<void>;
      await act(async () => {
        pending = h.hook.result.current.useDiskVersion();
        await Promise.resolve();
      });
      if (transition === "selection") h.hook.rerender({ ...h.props, activeFilePath: "Other.java" });
      else if (transition === "workspace") h.hook.rerender({ ...h.props, workspaceGeneration: 2 });
      else if (transition === "cancel") act(() => h.hook.result.current.cancel());
      else h.hook.unmount();
      await act(async () => {
        release();
        await pending;
      });
      expect(h.store.getState().contents["Main.java"]).toBe("local edits");
      expect(h.store.getState().tabs[0].isDirty).toBe(true);
      expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
      expect(h.synchronizeDocument).not.toHaveBeenCalled();
      expect(h.reportError.mock.calls.every((call) => call[0] === null)).toBe(true);
    }
  });

  it("reports read errors without displaying provider paths or source content", async () => {
    const h = await harness();
    vi.mocked(h.port.inspectContent!).mockRejectedValueOnce(
      new Error("secret-token /private/source.java"),
    );
    await act(() => h.hook.result.current.compare());
    expect(h.reportError).toHaveBeenLastCalledWith(expect.stringContaining("Could not compare"));
    expect(h.reportError.mock.calls.at(-1)?.[0]).not.toContain("secret-token");
    expect(h.hook.result.current.busy).toBe(false);
  });

  it("distinguishes a language synchronization failure after successful replacement", async () => {
    const h = await harness();
    await act(() => h.hook.result.current.compare());
    h.synchronizeDocument.mockRejectedValueOnce(new Error("unavailable language server"));
    await act(() => h.hook.result.current.useDiskVersion());
    expect(h.store.getState().contents["Main.java"]).toBe("external");
    expect(h.reportError).toHaveBeenLastCalledWith(
      expect.stringContaining("disk version was loaded"),
    );
    expect(h.hook.result.current.comparison).toBeNull();
  });
});

it("refuses retained compare and discard callbacks before touching documents or disk after retirement", async () => {
  for (const retirement of ["workspace", "tab", "owner", "unmount"] as const) {
    const h = await harness();
    await act(() => h.hook.result.current.compare());
    const old = h.hook.result.current;
    vi.mocked(h.port.inspectContent!).mockClear();
    if (retirement === "unmount") h.hook.unmount();
    else h.hook.rerender({ ...h.props, ...(retirement === "workspace" ? { workspaceGeneration: 2 } : retirement === "owner" ? { editor: new EditorViewModel(h.store.getState, h.port) } : { activeFilePath: "Other.java" }) });
    await act(async () => { await old.compare(); await old.useDiskVersion(); });
    expect(h.port.inspectContent).not.toHaveBeenCalled();
    expect(h.synchronizeDocument).not.toHaveBeenCalled();
    expect(h.port.acceptDiskSnapshot).not.toHaveBeenCalled();
    expect(h.store.getState().contents["Main.java"]).toBe("local edits");
  }
});

it("refuses confirmation from an earlier comparison and admits only one pending discard", async () => {
  let release!: () => void;
  const checkpoint = vi.fn(async (): Promise<void> => undefined);
  const h = await harness(checkpoint);
  await act(() => h.hook.result.current.compare());
  const earlier = h.hook.result.current.useDiskVersion;
  await act(() => h.hook.result.current.compare());
  await act(() => earlier());
  expect(h.synchronizeDocument).not.toHaveBeenCalled();
  checkpoint.mockImplementation(() => new Promise<void>((done) => { release = done; }));
  const current = h.hook.result.current.useDiskVersion;
  let first!: Promise<void>, duplicate!: Promise<void>;
  await act(async () => { first = current(); duplicate = current(); await Promise.resolve(); });
  expect(h.synchronizeDocument).not.toHaveBeenCalled();
  expect(checkpoint).toHaveBeenCalledTimes(1);
  await act(async () => { release(); await first; await duplicate; });
  expect(h.port.acceptDiskSnapshot).toHaveBeenCalledTimes(1);
  expect(h.synchronizeDocument).toHaveBeenCalledExactlyOnceWith("Main.java");
});

it("retires the previous confirmation synchronously when a new read starts", async () => {
  const h = await harness();
  await act(() => h.hook.result.current.compare());
  const old = h.hook.result.current;
  let release!: () => void;
  const snapshot = await h.port.inspectContent!("Main.java");
  vi.mocked(h.port.inspectContent!).mockImplementationOnce(() => new Promise((done) => { release = () => done(snapshot); }));
  let reading!: Promise<void>;
  await act(async () => { reading = old.compare(); await old.useDiskVersion(); });
  expect(h.synchronizeDocument).not.toHaveBeenCalled();
  await act(async () => { release(); await reading; });
  expect(h.hook.result.current.comparison).not.toBeNull();
});
