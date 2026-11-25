import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTerminalPort } from "../ports/workspace-terminal-port";
import type { WorkspaceTerminalSnapshot } from "@ide/contracts";
import { WorkspaceTerminalController } from "./WorkspaceTerminalController";
const bytes = (text: string) => btoa(text);
function snapshot(
  context: any,
  extra: Partial<WorkspaceTerminalSnapshot> = {},
): WorkspaceTerminalSnapshot {
  return {
    ...context,
    sessionId: "pty-1",
    cursor: 0,
    state: "running",
    pid: 42,
    shell: "/bin/bash",
    cwd: "/workspace",
    cols: 80,
    rows: 24,
    dataBase64: "",
    firstCursor: 0,
    nextCursor: 0,
    endCursor: 0,
    reset: false,
    exitCode: null,
    error: null,
    ...extra,
  };
}
function setup() {
  const port: WorkspaceTerminalPort = {
    capabilities: vi.fn(async (context) => ({
      ...context,
      available: true,
      defaultShell: "/bin/bash",
      reason: null,
    })),
    start: vi.fn(async (request) => snapshot(request)),
    read: vi.fn(async (request) =>
      snapshot(request, {
        firstCursor: request.cursor,
        nextCursor: request.cursor,
        endCursor: request.cursor,
      }),
    ),
    write: vi.fn(async (request) => ({
      ...request,
      acceptedBytes: atob(request.dataBase64).length,
    })),
    resize: vi.fn(async (request) => snapshot(request, { cols: request.cols, rows: request.rows })),
    stop: vi.fn(async (request) =>
      snapshot(request, {
        state: "stopped",
        firstCursor: request.cursor,
        nextCursor: request.cursor,
        endCursor: request.cursor,
      }),
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new WorkspaceTerminalController(port);
  controller.setContext({ workspaceId: "one", generation: 1 });
  return { controller, port };
}
const tick = () => vi.advanceTimersByTimeAsync(0);
let controllers: WorkspaceTerminalController[];
beforeEach(() => {
  vi.useFakeTimers();
  controllers = [];
});
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  vi.useRealTimers();
});
async function running() {
  const item = setup();
  controllers.push(item.controller);
  await tick();
  item.controller.trust(true);
  await item.controller.start(".");
  return item;
}
describe("interactive workspace terminal transport", () => {
  it("requires trust and native capabilities, then retains a real session when no view subscribes", async () => {
    const { controller, port } = setup();
    controllers.push(controller);
    await tick();
    await controller.start(".");
    expect(port.start).not.toHaveBeenCalled();
    controller.trust(true);
    await controller.start("nested", "/bin/zsh");
    expect(port.start).toHaveBeenCalledWith(
      expect.objectContaining({ trusted: true, cwd: "nested", shell: "/bin/zsh" }),
    );
    vi.mocked(port.read).mockImplementation(async (request) =>
      snapshot(request, {
        dataBase64: bytes("real output"),
        firstCursor: request.cursor,
        nextCursor: request.cursor + 11,
        endCursor: request.cursor + 11,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    let replay: any;
    controller.getState().sessions[0].feed.subscribe((event) => {
      replay = event;
    })();
    expect(new TextDecoder().decode(replay.data)).toBe("real output");
    expect(port.close).not.toHaveBeenCalled();
  });
  it("forwards Ctrl+C and paste in order, retries only unaccepted bytes and rejects oversized paste", async () => {
    const { controller, port } = await running();
    const submitted: string[] = [];
    vi.mocked(port.write).mockImplementation(async (request) => {
      const data = atob(request.dataBase64);
      submitted.push(data);
      return {
        ...request,
        acceptedBytes: submitted.length === 1 ? 0 : submitted.length === 2 ? 2 : data.length,
      };
    });
    controller.input("paste\r\u0003");
    await tick();
    await vi.advanceTimersByTimeAsync(20);
    expect(submitted).toEqual(["paste\r\u0003", "paste\r\u0003", "ste\r\u0003"]);
    controller.input("a".repeat(65_537));
    expect(controller.getState().error).toContain("64 KiB");
    expect(submitted).toHaveLength(3);
  });
  it("drops an old read and unsent input after Stop while draining final output exactly once", async () => {
    const { controller, port } = await running();
    let finishRead!: (value: WorkspaceTerminalSnapshot) => void;
    vi.mocked(port.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    vi.mocked(port.write).mockImplementation(async (request) => ({ ...request, acceptedBytes: 0 }));
    controller.input("pending");
    await tick();
    await vi.advanceTimersByTimeAsync(100);
    const context = controller.getState().sessions[0].snapshot;
    vi.mocked(port.stop).mockResolvedValue(
      snapshot(context, {
        state: "stopped",
        dataBase64: bytes("done"),
        nextCursor: 4,
        endCursor: 4,
      }),
    );
    await controller.stop();
    finishRead(snapshot(context, { dataBase64: bytes("stale"), nextCursor: 5, endCursor: 5 }));
    await tick();
    vi.mocked(port.read).mockImplementation(async (request) =>
      snapshot(request, {
        state: "stopped",
        dataBase64: bytes("done"),
        firstCursor: 0,
        nextCursor: 4,
        endCursor: 4,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    let replay: any;
    controller.getState().sessions[0].feed.subscribe((event) => {
      replay = event;
    })();
    expect(new TextDecoder().decode(replay.data)).toBe("done");
    expect(controller.getState().sessions[0].snapshot.state).toBe("stopped");
    const count = vi.mocked(port.write).mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    expect(port.write).toHaveBeenCalledTimes(count);
  });
  it("closes a Start response belonging to a replaced workspace and resets trust", async () => {
    const { controller, port } = setup();
    controllers.push(controller);
    await tick();
    controller.trust(true);
    let resolve!: (value: WorkspaceTerminalSnapshot) => void;
    vi.mocked(port.start).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const request = controller.start(".");
    const old = vi.mocked(port.start).mock.calls[0][0];
    controller.setContext({ workspaceId: "two", generation: 2 });
    resolve(snapshot(old));
    await request;
    expect(port.close).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "one", generation: 1, sessionId: "pty-1" }),
    );
    expect(controller.getState().trusted).toBe(false);
    expect(controller.getState().sessions).toHaveLength(0);
  });
  it("serializes resize and applies the latest dimensions after an in-flight resize", async () => {
    const { controller, port } = await running();
    let finish!: (value: WorkspaceTerminalSnapshot) => void;
    vi.mocked(port.resize).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = controller.resize(90, 25);
    await tick();
    await controller.resize(103, 31);
    await controller.resize(110, 33);
    expect(port.resize).toHaveBeenCalledTimes(1);
    finish(snapshot(controller.getState().sessions[0].snapshot, { cols: 90, rows: 25 }));
    await first;
    expect(port.resize).toHaveBeenCalledTimes(2);
    expect(vi.mocked(port.resize).mock.calls[1][0]).toEqual(
      expect.objectContaining({ cols: 110, rows: 33 }),
    );
    expect(controller.getState().sessions[0].snapshot.cols).toBe(110);
  });
  it("reports native refusal and does not mark the session stopped when Stop fails", async () => {
    const { controller, port } = await running();
    vi.mocked(port.stop).mockRejectedValue(new Error("owned process still running"));
    await controller.stop();
    expect(controller.getState().sessions[0].snapshot.state).toBe("running");
    expect(controller.getState().sessions[0].busy).toBe(false);
    expect(controller.getState().error).toBe("owned process still running");
  });
  it("bounds the replay transcript and applies a native output gap as a reset", async () => {
    const { controller, port } = await running();
    vi.mocked(port.read).mockImplementation(async (request) =>
      snapshot(request, {
        dataBase64: bytes("x".repeat(65_536)),
        firstCursor: request.cursor,
        nextCursor: request.cursor + 65_536,
        endCursor: request.cursor + 65_536,
      }),
    );
    await vi.advanceTimersByTimeAsync(1800);
    let replay: any;
    controller.getState().sessions[0].feed.subscribe((event) => {
      replay = event;
    })();
    expect(replay.data.length).toBe(1_048_576);
    vi.mocked(port.read).mockImplementationOnce(async (request) =>
      snapshot(request, {
        reset: true,
        dataBase64: bytes("after gap"),
        firstCursor: request.cursor + 100,
        nextCursor: request.cursor + 109,
        endCursor: request.cursor + 109,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    controller.getState().sessions[0].feed.subscribe((event) => {
      replay = event;
    })();
    expect(new TextDecoder().decode(replay.data)).toBe("after gap");
  });
});
