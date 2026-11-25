import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriTerminalAdapter } from "./terminal-tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const native = vi.mocked(invoke);
const context = { workspaceId: "one", generation: 1, clientId: "renderer-one" };
const request = { ...context, sessionId: "pty-1", cursor: 0 };
const result = {
  ...context,
  sessionId: "pty-1",
  state: "running",
  pid: 42,
  shell: "/bin/bash",
  cwd: "/workspace",
  cols: 80,
  rows: 24,
  dataBase64: btoa("raw\u001b"),
  firstCursor: 0,
  nextCursor: 4,
  endCursor: 4,
  reset: false,
  exitCode: null,
  error: null,
};
beforeEach(() => native.mockReset());
describe("native PTY adapter", () => {
  it("uses closed nested native requests and preserves raw output/control bytes", async () => {
    native.mockResolvedValue(result);
    const adapter = new TauriTerminalAdapter();
    expect((await adapter.read(request)).dataBase64).toBe(result.dataBase64);
    expect(native).toHaveBeenCalledWith("read_workspace_terminal", {
      request: { context, sessionId: "pty-1", cursor: 0 },
    });
    native.mockResolvedValue({ ...context, sessionId: "pty-1", acceptedBytes: 0 });
    expect((await adapter.write({ ...request, dataBase64: btoa("\u0003") })).acceptedBytes).toBe(0);
  });
  it.each([
    { workspaceId: "two" },
    { generation: 2 },
    { clientId: "old-renderer" },
    { sessionId: "other" },
    { state: "success" },
    { pid: 0 },
    { nextCursor: 5 },
    { dataBase64: "bad$" },
    { endCursor: 3 },
    { exitCode: -1 },
    { cols: 0 },
  ])("rejects malformed or stale snapshots %j", async (patch) => {
    native.mockResolvedValue({ ...result, ...patch });
    await expect(new TauriTerminalAdapter().read(request)).rejects.toThrow();
  });
  it("refuses a missing provider and never supplies a fallback exit status", async () => {
    native.mockRejectedValue(new Error("provider missing"));
    await expect(
      new TauriTerminalAdapter().start({ ...context, trusted: true, cwd: ".", cols: 80, rows: 24 }),
    ).rejects.toThrow();
    native.mockResolvedValue({ ...context, sessionId: "pty-1" });
    await expect(
      new TauriTerminalAdapter().write({ ...request, dataBase64: btoa("x") }),
    ).rejects.toThrow("acknowledgement");
  });
});
