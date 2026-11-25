import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EditorRecoveryEntry,
  EditorRecoverySession,
  EditorRecoverySnapshot,
} from "@ide/contracts";
import type { EditorRecoveryPort } from "@ide/web-core/ports";
import { createEditorStore } from "@ide/web-core/state";
import { EditorViewModel } from "@ide/web-core";
import { useEditorRecoveryController } from "./useEditorRecoveryController";

const entry: EditorRecoverySnapshot = {
  id: "b".repeat(32),
  filePath: "Main.java",
  content: "recover me",
  language: "java",
  kind: "draft",
  capturedAt: 1,
  byteLength: 10,
  currentSession: false,
};
async function harness(
  options: {
    unreadableInventory?: boolean;
    inventory?: Promise<readonly EditorRecoveryEntry[]>;
  } = {},
) {
  const store = createEditorStore();
  const file = { filePath: "Main.java", name: "Main.java", language: "java", openedAt: 1 };
  const editorPort = {
    loadContent: vi.fn(async () => ({
      filePath: file.filePath,
      content: "disk",
      language: "java",
    })),
    getOpenFiles: vi.fn(async () => [file]),
    saveContent: vi.fn(async () => [file]),
    closeFile: vi.fn(async () => []),
  };
  const editor = new EditorViewModel(store.getState, editorPort);
  await editor.openFile(file.filePath);
  const context = { workspaceId: "one", generation: 1, isSwitching: false };
  const session: EditorRecoverySession = {
    workspaceId: "one",
    generation: 1,
    sessionId: "a".repeat(32),
  };
  const port: EditorRecoveryPort = {
    start: vi.fn(async (c) => ({ ...session, ...c })),
    checkpoint: vi.fn(async () => undefined),
    list: vi.fn(async () => {
      if (options.unreadableInventory) throw new Error("private corrupt journal");
      if (options.inventory) return options.inventory;
      return [{ ...entry, content: undefined } as unknown as EditorRecoveryEntry];
    }),
    read: vi.fn(async () => entry),
    remove: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  const documents = {
    flush: vi.fn(async (): Promise<void> => undefined),
    activate: vi.fn(async (): Promise<void> => undefined),
  };
  const props = {
    port,
    store,
    editor,
    documents,
    workspaceId: "one",
    generation: 1,
    ready: true,
    getContext: () => context,
    openFile: vi.fn(async () => true),
  };
  const hook = renderHook(useEditorRecoveryController, { initialProps: props });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { store, editor, editorPort, context, port, props, hook, documents };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("editor recovery orchestration", () => {
  it("checkpoints continuously typed buffers on a fixed delay without saving source", async () => {
    const h = await harness();
    vi.useFakeTimers();
    act(() => h.editor.updateContent("Main.java", "first"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => h.editor.updateContent("Main.java", "latest"));
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(h.port.checkpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: "one" }),
      [{ filePath: "Main.java", content: "latest", language: "java" }],
    );
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.hook.result.current.status).toBe("ready");
  });
  it("flushes immediately before a save, including a quick edit before the timer", async () => {
    const h = await harness();
    act(() => h.editor.updateContent("Main.java", "fast edit"));
    await act(() => h.hook.result.current.flush());
    expect(h.port.checkpoint).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ content: "fast edit" }),
    ]);
  });
  it("retains edits arriving during a checkpoint and serializes subsequent flushes", async () => {
    const h = await harness();
    let release!: () => void;
    vi.mocked(h.port.checkpoint).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    act(() => h.editor.updateContent("Main.java", "first"));
    let first!: Promise<void>;
    act(() => {
      first = h.hook.result.current.flush();
    });
    act(() => h.editor.updateContent("Main.java", "second"));
    await act(async () => {
      release();
      await first;
      await h.hook.result.current.flush();
    });
    expect(h.port.checkpoint).toHaveBeenNthCalledWith(2, expect.anything(), [
      expect.objectContaining({ content: "second" }),
    ]);
    expect(h.store.getState().contents["Main.java"]).toBe("second");
  });
  it("reviews and explicitly restores as unsaved without deleting the only recovery copy", async () => {
    const h = await harness();
    await act(() => h.hook.result.current.prepareReview(entry));
    expect(h.store.getState().contents["Main.java"]).toBe("disk");
    await act(() => h.hook.result.current.restore());
    expect(h.store.getState().contents["Main.java"]).toBe("recover me");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
    expect(h.documents.activate).toHaveBeenCalledWith("Main.java", "recover me");
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
    expect(h.port.remove).not.toHaveBeenCalled();
  });
  it("rejects restoring a stale review and keeps newer local edits", async () => {
    const h = await harness();
    await act(() => h.hook.result.current.prepareReview(entry));
    act(() => h.editor.updateContent("Main.java", "newer"));
    await act(() => h.hook.result.current.restore());
    expect(h.store.getState().contents["Main.java"]).toBe("newer");
    expect(h.hook.result.current.error).toContain("reviewed buffer changed");
    expect(h.documents.activate).not.toHaveBeenCalled();
  });
  it("retains missing-file checkpoints for copying rather than fabricating a source file", async () => {
    const h = await harness();
    h.props.openFile.mockResolvedValueOnce(false);
    await act(() => h.hook.result.current.prepareReview(entry));
    expect(h.hook.result.current.review?.snapshot.content).toBe("recover me");
    expect(h.hook.result.current.review?.replacement).toBeNull();
    await act(() => h.hook.result.current.restore());
    expect(h.store.getState().contents["Main.java"]).toBe("disk");
  });
  it("keeps failures visible without claiming a successful checkpoint or logging source", async () => {
    const h = await harness();
    vi.mocked(h.port.checkpoint).mockRejectedValueOnce(new Error("/secret/path private-content"));
    act(() => h.editor.updateContent("Main.java", "local"));
    await act(() => h.hook.result.current.flush());
    expect(h.hook.result.current.status).toBe("error");
    expect(h.hook.result.current.error).not.toContain("private-content");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });
  it("does not claim ready before the initial journal inventory has been read", async () => {
    let release!: (entries: readonly EditorRecoveryEntry[]) => void;
    const inventory = new Promise<readonly EditorRecoveryEntry[]>((done) => {
      release = done;
    });
    const h = await harness({ inventory });
    expect(h.hook.result.current.status).toBe("loading");
    await act(async () => {
      release([]);
      await inventory;
    });
    expect(h.hook.result.current.status).toBe("ready");
    expect(h.port.checkpoint).not.toHaveBeenCalled();
  });
  it("revalidates repaired storage on an explicit no-op checkpoint retry without writing sources or the journal", async () => {
    const h = await harness({ unreadableInventory: true });
    expect(h.hook.result.current.status).toBe("error");
    vi.mocked(h.port.list).mockResolvedValue([
      { ...entry, content: undefined } as unknown as EditorRecoveryEntry,
    ]);
    const reads = vi.mocked(h.port.list).mock.calls.length;
    await act(() => h.hook.result.current.flush());
    expect(h.port.list).toHaveBeenCalledTimes(reads + 1);
    expect(h.hook.result.current.status).toBe("ready");
    expect(h.hook.result.current.error).toBeNull();
    expect(h.hook.result.current.entries[0].id).toBe(entry.id);
    expect(h.port.checkpoint).not.toHaveBeenCalled();
    expect(h.editorPort.saveContent).not.toHaveBeenCalled();
  });
  it("does not hide a failed draft checkpoint just because inventory refresh succeeds", async () => {
    const h = await harness();
    act(() => h.editor.updateContent("Main.java", "acknowledged"));
    await act(() => h.hook.result.current.flush());
    vi.mocked(h.port.checkpoint).mockRejectedValueOnce(new Error("capacity exceeded"));
    act(() => h.editor.updateContent("Main.java", "new unacknowledged draft"));
    await act(() => h.hook.result.current.flush());
    const failure = h.hook.result.current.error;
    await act(() => h.hook.result.current.refresh());
    expect(h.hook.result.current.status).toBe("error");
    expect(h.hook.result.current.error).toBe(failure);
    expect(h.hook.result.current.error).not.toBeNull();
    expect(h.store.getState().contents["Main.java"]).toBe("new unacknowledged draft");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });
  it("reports inventory corruption even if the current buffer was already acknowledged, then refreshes after repair", async () => {
    const h = await harness();
    act(() => h.editor.updateContent("Main.java", "acknowledged"));
    await act(() => h.hook.result.current.flush());
    vi.mocked(h.port.list).mockRejectedValueOnce(new Error("corrupt"));
    await act(() => h.hook.result.current.refresh());
    expect(h.hook.result.current.status).toBe("error");
    expect(h.hook.result.current.error).toContain("could not be loaded");
    await act(() => h.hook.result.current.refresh());
    expect(h.hook.result.current.status).toBe("ready");
    expect(h.hook.result.current.error).toBeNull();
    expect(h.port.checkpoint).toHaveBeenCalledTimes(1);
  });
  it("does not let a concurrent successful inventory read claim a pending checkpoint succeeded", async () => {
    const h = await harness();
    let reject!: (error: Error) => void;
    vi.mocked(h.port.checkpoint).mockReturnValueOnce(
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
    );
    act(() => h.editor.updateContent("Main.java", "pending draft"));
    let pending!: Promise<void>;
    act(() => {
      pending = h.hook.result.current.flush();
    });
    await act(() => h.hook.result.current.refresh());
    expect(h.hook.result.current.status).toBe("saving");
    await act(async () => {
      reject(new Error("capacity exceeded"));
      await pending;
    });
    expect(h.hook.result.current.status).toBe("error");
    expect(h.store.getState().tabs[0].isDirty).toBe(true);
  });
  it("ignores a late review after switching workspace generation", async () => {
    const h = await harness();
    let release!: (snapshot: EditorRecoverySnapshot) => void;
    vi.mocked(h.port.read).mockReturnValueOnce(
      new Promise((done) => {
        release = done;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = h.hook.result.current.prepareReview(entry);
    });
    h.context.generation = 2;
    h.hook.rerender({ ...h.props, generation: 2 });
    await act(async () => {
      release(entry);
      await pending;
    });
    expect(h.hook.result.current.review).toBeNull();
    expect(h.props.openFile).not.toHaveBeenCalled();
  });
});
