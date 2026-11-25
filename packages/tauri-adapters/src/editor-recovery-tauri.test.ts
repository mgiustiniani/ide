import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriEditorRecoveryAdapter } from "./editor-recovery-tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mock = vi.mocked(invoke);
const session = { workspaceId: "workspace", generation: 1, sessionId: "a".repeat(32) };
const metadata = {
  id: "b".repeat(32),
  filePath: "Main.java",
  language: "java",
  kind: "draft",
  capturedAt: 1,
  byteLength: 2,
  currentSession: false,
};
beforeEach(() => mock.mockReset());
describe("Tauri editor recovery port", () => {
  it("uses correlated sessions and native-only private checkpoints", async () => {
    const adapter = new TauriEditorRecoveryAdapter();
    mock.mockResolvedValueOnce(session).mockResolvedValueOnce(session);
    expect(await adapter.start({ workspaceId: "workspace", generation: 1 })).toEqual(session);
    const drafts = [{ filePath: "Main.java", content: "α", language: "java" }];
    await adapter.checkpoint(session, drafts);
    expect(mock).toHaveBeenLastCalledWith("checkpoint_editor_recovery", {
      request: { session, drafts },
    });
    expect(mock.mock.calls.some(([command]) => command === "write_file")).toBe(false);
  });
  it("validates metadata separately from bounded source snapshots", async () => {
    const adapter = new TauriEditorRecoveryAdapter();
    mock.mockResolvedValueOnce({ ...session, entries: [metadata] });
    expect(await adapter.list(session)).toEqual([metadata]);
    mock.mockResolvedValueOnce({ ...session, entry: { ...metadata, content: "α" } });
    expect((await adapter.read(session, metadata.id)).content).toBe("α");
  });
  it("rejects mismatched workspace, generation, session and entry identities", async () => {
    const adapter = new TauriEditorRecoveryAdapter();
    for (const changed of [
      { workspaceId: "other" },
      { generation: 2 },
      { sessionId: "c".repeat(32) },
    ]) {
      mock.mockResolvedValueOnce({ ...session, ...changed, entries: [] });
      await expect(adapter.list(session)).rejects.toThrow(/Stale/);
    }
    mock.mockResolvedValueOnce({
      ...session,
      entry: { ...metadata, id: "c".repeat(32), content: "α" },
    });
    await expect(adapter.read(session, metadata.id)).rejects.toThrow(/Mismatched/);
  });
  it("rejects traversal, duplicate entries, unsolicited content and byte-length mismatches", async () => {
    const adapter = new TauriEditorRecoveryAdapter();
    for (const entries of [
      [{ ...metadata, filePath: "../escape" }],
      [metadata, metadata],
      [{ ...metadata, content: "α" }],
    ]) {
      mock.mockResolvedValueOnce({ ...session, entries });
      await expect(adapter.list(session)).rejects.toThrow();
    }
    mock.mockResolvedValueOnce({ ...session, entry: { ...metadata, content: "longer" } });
    await expect(adapter.read(session, metadata.id)).rejects.toThrow();
  });
  it("admits exactly one MiB UTF-8 but refuses one extra byte without invoking or changing a session", async () => {
    const adapter = new TauriEditorRecoveryAdapter();
    const content = "é".repeat(512 * 1024);
    expect(new TextEncoder().encode(content)).toHaveLength(1024 * 1024);
    mock.mockResolvedValueOnce(session);
    await adapter.checkpoint(session, [{ filePath: "limit.txt", language: "plaintext", content }]);
    expect(mock).toHaveBeenCalledTimes(1);
    await expect(
      adapter.checkpoint(session, [
        { filePath: "limit.txt", language: "plaintext", content: content + "!" },
      ]),
    ).rejects.toThrow(/capacity/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized outgoing drafts before native IPC", async () => {
    await expect(
      new TauriEditorRecoveryAdapter().checkpoint(session, [
        { filePath: "Main.java", language: "java", content: "α".repeat(600000) },
      ]),
    ).rejects.toThrow(/capacity/);
    expect(mock).not.toHaveBeenCalled();
  });
});
