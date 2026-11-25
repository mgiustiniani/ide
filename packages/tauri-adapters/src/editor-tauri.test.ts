import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriEditorAdapter } from "./editor-tauri";
import { EditorViewModel } from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe("TauriEditorAdapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.useRealTimers();
  });

  it("inspects unopened transaction paths without creating or changing save baselines", async () => {
    const adapter = new TauriEditorAdapter(),
      context = {
        workspaceId: "workspace",
        generation: 1,
        approvedPlanHash: "provider-plan",
        transactionId: "provider-transaction",
      },
      revision = "a".repeat(64);
    invokeMock.mockResolvedValueOnce({
      workspaceId: context.workspaceId,
      generation: context.generation,
      filePath: "A.java",
      status: "unchanged",
    });
    await expect(adapter.inspectSourceRevision(context, "A.java", revision)).resolves.toEqual({
      filePath: "A.java",
      status: "unchanged",
    });
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("inspect_editor_disk_status", {
      request: {
        workspaceId: context.workspaceId,
        generation: context.generation,
        filePath: "A.java",
        expectedRevision: revision,
      },
    });
    invokeMock.mockRejectedValueOnce(new Error("fixture save rejected"));
    await expect(adapter.saveContent("A.java", "draft")).rejects.toThrow("fixture save rejected");
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", { path: "A.java", content: "draft" });
    expect(await adapter.getOpenFiles()).toEqual([]);
  });

  it("rejects uncorrelated transaction source status and unsafe journal paths", async () => {
    const adapter = new TauriEditorAdapter(),
      context = { workspaceId: "workspace", generation: 1 };
    invokeMock.mockResolvedValueOnce({
      ...context,
      generation: 2,
      filePath: "A.java",
      status: "unchanged",
    });
    await expect(adapter.inspectSourceRevision(context, "A.java", "a".repeat(64))).rejects.toThrow(
      "Invalid",
    );
    await expect(
      adapter.inspectSourceRevision(context, "../A.java", "a".repeat(64)),
    ).rejects.toThrow("Invalid");
    expect(invokeMock).toHaveBeenCalledOnce();
  });

  it("retries temporary disk-worker contention with the same journaled source authority", async () => {
    const adapter = new TauriEditorAdapter();
    const context = { workspaceId: "workspace", generation: 1 };
    invokeMock.mockRejectedValueOnce("Disk inspection is busy; retry");
    invokeMock.mockResolvedValueOnce({ ...context, filePath: "A.java", status: "unchanged" });

    await expect(adapter.inspectSourceRevision(context, "A.java", "a".repeat(64))).resolves.toEqual({
      filePath: "A.java", status: "unchanged",
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1]).toEqual(invokeMock.mock.calls[0]);
  });

  it("stops retrying a busy recovery inspection at its original deadline", async () => {
    vi.useFakeTimers();
    const adapter = new TauriEditorAdapter({ readTimeoutMs: 60 });
    const context = { workspaceId: "workspace", generation: 1 };
    invokeMock.mockRejectedValue("Disk inspection is busy; retry");
    const result = expect(adapter.inspectSourceRevision(context, "A.java", "a".repeat(64)))
      .rejects.toThrow("Transaction source inspection timed out");
    await vi.advanceTimersByTimeAsync(200);
    await result;
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("adopts a guarded rename and its inverse without loading draft text or saving", async () => {
    const revision = "a".repeat(64),
      adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValue({ content: "saved original", language: "java", revision });
    await adapter.loadContent("A.java");
    await adapter.adoptRenamedFile("A.java", "B.java", revision);
    expect(await adapter.getOpenFiles()).toMatchObject([{ filePath: "B.java", name: "B.java" }]);
    await adapter.adoptRenamedFile("B.java", "A.java", revision);
    expect(await adapter.getOpenFiles()).toMatchObject([{ filePath: "A.java" }]);
    expect(invokeMock.mock.calls.every(([command]) => command === "read_file")).toBe(true);
    invokeMock.mockResolvedValueOnce({ success: true, revision: "b".repeat(64) });
    await adapter.saveContent("A.java", "retained draft");
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "A.java",
      content: "retained draft",
      expectedRevision: revision,
    });
  });

  it("retains the original save guard when renamed saved bytes change during verification", async () => {
    const revision = "a".repeat(64),
      adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", language: "java", revision });
    await adapter.loadContent("A.java");
    invokeMock.mockResolvedValueOnce({
      content: "external",
      language: "java",
      revision: "b".repeat(64),
    });
    await expect(adapter.adoptRenamedFile("A.java", "B.java", revision)).rejects.toThrow("changed");
    invokeMock.mockRejectedValueOnce("revision conflict");
    await expect(adapter.saveContent("B.java", "draft")).rejects.toThrow("revision conflict");
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "B.java",
      content: "draft",
      expectedRevision: revision,
    });
    await expect(adapter.adoptRenamedFile("B.java", "C.java", "b".repeat(64))).rejects.toThrow(
      "baseline changed",
    );
  });

  it("blocks saves after a rename lacks a baseline instead of issuing an unconditional write", async () => {
    const adapter = new TauriEditorAdapter();
    await expect(
      adapter.adoptRenamedFile("Missing.java", "B.java", "a".repeat(64)),
    ).rejects.toThrow();
    await expect(adapter.saveContent("B.java", "draft")).rejects.toThrow("save baseline");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("retains a stale source baseline at the new URI and blocks writes until an explicit disk comparison", async () => {
    const adapter = new TauriEditorAdapter(),
      originalRevision = "a".repeat(64),
      actualRevision = "b".repeat(64);
    invokeMock.mockResolvedValueOnce({
      content: "old saved",
      language: "java",
      revision: originalRevision,
    });
    await adapter.loadContent("A.java");
    await expect(adapter.adoptRenamedFile("A.java", "B.java", actualRevision)).rejects.toThrow(
      "baseline changed",
    );
    await expect(adapter.saveContent("B.java", "draft")).rejects.toThrow("save baseline");
    expect(invokeMock).toHaveBeenCalledOnce();
    invokeMock.mockResolvedValueOnce({
      content: "independent saved",
      language: "java",
      revision: actualRevision,
    });
    const snapshot = await adapter.inspectContent("B.java");
    expect(snapshot.changedSinceRead).toBe(true);
    adapter.acceptDiskSnapshot(snapshot);
    invokeMock.mockResolvedValueOnce({ success: true, revision: "c".repeat(64) });
    await adapter.saveContent("B.java", "explicitly reviewed");
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "B.java",
      content: "explicitly reviewed",
      expectedRevision: actualRevision,
    });
  });

  it("refuses adopting an existing buffer or a path outside the workspace", async () => {
    const revision = "a".repeat(64),
      adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValue({ content: "original", language: "java", revision });
    await adapter.loadContent("A.java");
    await adapter.loadContent("B.java");
    await expect(adapter.adoptRenamedFile("A.java", "B.java", revision)).rejects.toThrow();
    await expect(adapter.adoptRenamedFile("A.java", "../C.java", revision)).rejects.toThrow();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(await adapter.getOpenFiles()).toMatchObject([
      { filePath: "A.java" },
      { filePath: "B.java" },
    ]);
  });

  it("normalizes the exact native read_file response", async () => {
    invokeMock.mockResolvedValueOnce({
      path: "/native/root/README.md",
      content: "# Fixture",
      language: "markdown",
    });

    await expect(new TauriEditorAdapter().loadContent("README.md")).resolves.toEqual({
      filePath: "README.md",
      content: "# Fixture",
      language: "markdown",
    });
    expect(invokeMock).toHaveBeenCalledWith("read_file", { path: "README.md" });
  });

  it("protects getOpenFiles state from array and nested object mutations", async () => {
    invokeMock.mockResolvedValueOnce({
      content: "export const value = 1;",
      language: "typescript",
    });
    const adapter = new TauriEditorAdapter();
    await adapter.loadContent("src/value.ts");
    const expectedState = await adapter.getOpenFiles();
    const snapshot = await adapter.getOpenFiles();

    snapshot[0].name = "externally-mutated.ts";
    snapshot.push({
      filePath: "src/injected.ts",
      name: "injected.ts",
      language: "typescript",
      openedAt: 0,
    });

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].name).toBe("externally-mutated.ts");
    await expect(adapter.getOpenFiles()).resolves.toEqual(expectedState);
  });

  it("protects saveContent state from returned array and nested object mutations", async () => {
    invokeMock.mockResolvedValueOnce({ success: true });
    const adapter = new TauriEditorAdapter();
    const snapshot = await adapter.saveContent("src/saved.ts", "const saved = true;");
    const expectedState = snapshot.map((file) => ({ ...file }));

    snapshot[0].name = "externally-mutated.ts";
    snapshot.push({
      filePath: "src/injected.ts",
      name: "injected.ts",
      language: "typescript",
      openedAt: 0,
    });

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].name).toBe("externally-mutated.ts");
    await expect(adapter.getOpenFiles()).resolves.toEqual(expectedState);
  });

  it("protects closeFile state from returned array and nested object mutations", async () => {
    invokeMock.mockResolvedValue({ success: true });
    const adapter = new TauriEditorAdapter();
    await adapter.saveContent("src/closed.ts", "const closed = true;");
    await adapter.saveContent("src/remaining.ts", "const remaining = true;");
    const snapshot = await adapter.closeFile("src/closed.ts");
    const expectedState = snapshot.map((file) => ({ ...file }));

    snapshot[0].name = "externally-mutated.ts";
    snapshot.pop();

    expect(snapshot).toEqual([]);
    await expect(adapter.getOpenFiles()).resolves.toEqual(expectedState);
  });

  it("closes native session metadata and the selected buffer in one turn without source IPC", async () => {
    const adapter = new TauriEditorAdapter();
    const store = createEditorStore();
    const editor = new EditorViewModel(store.getState, adapter);
    invokeMock.mockResolvedValue({
      content: "original",
      language: "java",
      revision: "a".repeat(64),
    });
    await editor.openFile("Main.java");
    await editor.openFile("Other.java");
    editor.updateContent("Other.java", "retained companion");
    const closing = editor.closeFile("Main.java");
    expect(store.getState().contents["Main.java"]).toBeUndefined();
    expect(store.getState().contents["Other.java"]).toBe("retained companion");
    expect(store.getState().tabs).toMatchObject([{ filePath: "Other.java", isDirty: true }]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    await closing;
    await expect(adapter.getOpenFiles()).resolves.toMatchObject([{ filePath: "Other.java" }]);
    await expect(
      adapter.inspectDiskStatus({ workspaceId: "one", generation: 1 }, "Main.java"),
    ).resolves.toEqual({ filePath: "Main.java", status: "unavailable" });
  });

  it("sends the read revision on save and preserves the Java language", async () => {
    const oldRevision = "a".repeat(64);
    const newRevision = "b".repeat(64);
    invokeMock.mockResolvedValueOnce({
      path: "Main.java",
      content: "old",
      language: "java",
      revision: oldRevision,
    });
    invokeMock.mockResolvedValueOnce({ success: true, revision: newRevision });
    invokeMock.mockResolvedValueOnce({ success: true, revision: "c".repeat(64) });
    const adapter = new TauriEditorAdapter();
    await adapter.loadContent("Main.java");
    const files = await adapter.saveContent("Main.java", "new");
    expect(files[0].language).toBe("java");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "write_file", {
      path: "Main.java",
      content: "new",
      expectedRevision: oldRevision,
    });
    await adapter.saveContent("Main.java", "newer");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "write_file", {
      path: "Main.java",
      content: "newer",
      expectedRevision: newRevision,
    });
  });

  it("inspection does not advance the revision used for subsequent saves", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockResolvedValueOnce({ content: "external", revision: "b".repeat(64) });
    const snapshot = await adapter.inspectContent("Main.java");
    expect(snapshot.changedSinceRead).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    invokeMock.mockRejectedValueOnce("File changed externally");
    await expect(adapter.saveContent("Main.java", "local")).rejects.toThrow();
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "Main.java",
      content: "local",
      expectedRevision: "a".repeat(64),
    });
  });

  it("reads unopened preview text without registering a tab or creating a save baseline", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "class Preview {}", revision: "a".repeat(64) });
    const preview = await adapter.readPreviewContent("Preview.java");
    expect(preview).toEqual({
      filePath: "Preview.java", content: "class Preview {}", language: "java",
    });
    expect(Object.isFrozen(preview)).toBe(true);
    expect(await adapter.getOpenFiles()).toEqual([]);
    await expect(adapter.inspectContent("Preview.java")).rejects.toThrow("without a read revision");
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("read_file", { path: "Preview.java" });
  });

  it("keeps an existing save baseline when reading newer preview text", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockResolvedValueOnce({ content: "external", revision: "b".repeat(64) });
    await expect(adapter.readPreviewContent("Main.java")).resolves.toMatchObject({ content: "external" });
    invokeMock.mockRejectedValueOnce("File changed externally");
    await expect(adapter.saveContent("Main.java", "local draft")).rejects.toThrow();
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "Main.java", content: "local draft", expectedRevision: "a".repeat(64),
    });
  });

  it("rejects escaping preview paths before native IO", async () => {
    const adapter = new TauriEditorAdapter();
    await expect(adapter.readPreviewContent("../Main.java")).rejects.toThrow("Invalid workspace preview path");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("adopts only an issued snapshot and uses its revision without writing", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockResolvedValueOnce({ content: "external", revision: "b".repeat(64) });
    const snapshot = await adapter.inspectContent("Main.java");
    expect(() => adapter.acceptDiskSnapshot({ ...snapshot })).toThrow();
    adapter.acceptDiskSnapshot(snapshot);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(() => adapter.acceptDiskSnapshot(snapshot)).toThrow();
    invokeMock.mockResolvedValueOnce({ revision: "c".repeat(64) });
    await adapter.saveContent("Main.java", "new local");
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "Main.java",
      content: "new local",
      expectedRevision: "b".repeat(64),
    });
  });

  it("refuses snapshot adoption when a save has changed its baseline", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockResolvedValueOnce({ content: "external", revision: "b".repeat(64) });
    const snapshot = await adapter.inspectContent("Main.java");
    invokeMock.mockResolvedValueOnce({ revision: "c".repeat(64) });
    await adapter.saveContent("Main.java", "saved");
    expect(() => adapter.acceptDiskSnapshot(snapshot)).toThrow();
  });

  it("requires revision support and refuses invalid disk revisions", async () => {
    const adapter = new TauriEditorAdapter();
    await expect(adapter.inspectContent("Main.java")).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockResolvedValueOnce({ content: "external", revision: "not-a-revision" });
    await expect(adapter.inspectContent("Main.java")).rejects.toThrow();
  });

  it("checks a correlated disk revision without reading source into the renderer or advancing saves", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockResolvedValueOnce({
      workspaceId: "one",
      generation: 7,
      filePath: "Main.java",
      status: "changed",
    });
    await expect(
      adapter.inspectDiskStatus({ workspaceId: "one", generation: 7 }, "Main.java"),
    ).resolves.toEqual({ filePath: "Main.java", status: "changed" });
    expect(invokeMock).toHaveBeenLastCalledWith("inspect_editor_disk_status", {
      request: {
        workspaceId: "one",
        generation: 7,
        filePath: "Main.java",
        expectedRevision: "a".repeat(64),
      },
    });
    invokeMock.mockResolvedValueOnce({ revision: "b".repeat(64) });
    await adapter.saveContent("Main.java", "local");
    expect(invokeMock).toHaveBeenLastCalledWith("write_file", {
      path: "Main.java",
      content: "local",
      expectedRevision: "a".repeat(64),
    });
  });

  it("ignores a pending disk status invalidated by a save or same-path reopen, even with an equal digest", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    let release!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = adapter.inspectDiskStatus({ workspaceId: "one", generation: 1 }, "Main.java");
    invokeMock.mockResolvedValueOnce({ revision: "a".repeat(64) });
    await adapter.saveContent("Main.java", "original");
    release({ workspaceId: "one", generation: 1, filePath: "Main.java", status: "changed" });
    await expect(pending).resolves.toBeNull();
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const reopened = adapter.inspectDiskStatus({ workspaceId: "one", generation: 1 }, "Main.java");
    await adapter.closeFile("Main.java");
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    release({ workspaceId: "one", generation: 1, filePath: "Main.java", status: "changed" });
    await expect(reopened).resolves.toBeNull();
  });

  it("refuses uncorrelated, open-ended or malformed native disk status responses", async () => {
    const adapter = new TauriEditorAdapter();
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    const valid = { workspaceId: "one", generation: 1, filePath: "Main.java", status: "changed" };
    for (const invalid of [
      null,
      [],
      { ...valid, workspaceId: "other" },
      { ...valid, generation: 2 },
      { ...valid, filePath: "Other.java" },
      { ...valid, status: "reloaded" },
      { ...valid, content: "secret" },
    ]) {
      invokeMock.mockResolvedValueOnce(invalid);
      await expect(
        adapter.inspectDiskStatus({ workspaceId: "one", generation: 1 }, "Main.java"),
      ).rejects.toThrow("Invalid disk status response");
    }
  });

  it("requires a revision and safe workspace-relative inspection input before invoking native code", async () => {
    const adapter = new TauriEditorAdapter();
    await expect(
      adapter.inspectDiskStatus({ workspaceId: "one", generation: 1 }, "Main.java"),
    ).resolves.toEqual({ filePath: "Main.java", status: "unavailable" });
    for (const filePath of ["../escape", "/private/source", "a/../source", "a\\\\source", ""]) {
      await expect(
        adapter.inspectDiskStatus({ workspaceId: "one", generation: 1 }, filePath),
      ).rejects.toThrow();
    }
    await expect(
      adapter.inspectDiskStatus({ workspaceId: "one", generation: -1 }, "Main.java"),
    ).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("bounds a never-resolving disk inspection", async () => {
    vi.useFakeTimers();
    const adapter = new TauriEditorAdapter({ readTimeoutMs: 25 });
    invokeMock.mockResolvedValueOnce({ content: "original", revision: "a".repeat(64) });
    await adapter.loadContent("Main.java");
    invokeMock.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = adapter
      .inspectDiskStatus({ workspaceId: "one", generation: 1 }, "Main.java")
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({
      command: "inspect_editor_disk_status",
      message: "[tauri:inspect_editor_disk_status] Disk inspection timed out",
    });
    vi.useRealTimers();
  });

  it("bounds a never-resolving read_file invoke and redacts source and paths", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementationOnce(() => new Promise(() => undefined));
    const secretPath = "/home/user/private/workspace/Secret.java";
    const pending = new TauriEditorAdapter({ readTimeoutMs: 25 })
      .loadContent(secretPath)
      .catch((value: unknown) => value);

    await vi.advanceTimersByTimeAsync(25);
    const error = await pending;

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "read_file",
      message: "[tauri:read_file] File read timed out",
    });
    expect(String(error)).not.toContain(secretPath);
    expect(error).toHaveProperty("cause", undefined);
  });
});
