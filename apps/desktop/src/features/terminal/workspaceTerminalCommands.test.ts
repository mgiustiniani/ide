import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceTerminalSnapshot } from "@ide/contracts";
import type { WorkspaceTerminalPort } from "@ide/web-core/ports";
import { WorkspaceTerminalController } from "@ide/web-core/terminal/WorkspaceTerminalController";
import { workspaceTerminalCommands } from "./workspaceTerminalCommands";

const controllers: WorkspaceTerminalController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
async function setup() {
  let sequence = 0;
  const snapshot = (request: { workspaceId: string; generation: number; clientId: string; sessionId?: string }): WorkspaceTerminalSnapshot => ({
    ...request, sessionId: request.sessionId ?? `pty-${++sequence}`, state: "running", pid: 42,
    shell: "/bin/bash", cwd: "/workspace", cols: 80, rows: 24, cursor: 0, dataBase64: "",
    firstCursor: 0, nextCursor: 0, endCursor: 0, reset: false, exitCode: null, error: null,
  });
  const port: WorkspaceTerminalPort = {
    capabilities: vi.fn(async context => ({ ...context, available: true, defaultShell: "/bin/bash", reason: null })),
    start: vi.fn(async request => snapshot(request)),
    read: vi.fn(async request => snapshot(request)),
    write: vi.fn(), resize: vi.fn(),
    stop: vi.fn(async request => ({ ...snapshot(request), state: "stopped" as const, exitCode: 0 })),
    close: vi.fn(async () => {}),
  };
  const controller = new WorkspaceTerminalController(port);
  controllers.push(controller);
  controller.setContext({ workspaceId: "one", generation: 1 });
  await vi.waitFor(() => expect(controller.getState().pending).toBe(false));
  const open = vi.fn();
  const commands = () => workspaceTerminalCommands(controller, open);
  const run = (id: string) => commands().find(command => command.id === id)!.run();
  return { port, controller, open, commands, run };
}
it("opens the terminal without granting trust or starting a shell", async () => {
  const h = await setup();
  expect(h.commands().map(c => c.id)).toEqual(["terminal.open"]);
  await h.run("terminal.open");
  expect(h.open).toHaveBeenCalledOnce();
  expect(h.port.start).not.toHaveBeenCalled();
  expect(h.controller.getState().trusted).toBe(false);
});
it("starts the default shell at the root and stops/closes the selected real controller session", async () => {
  const h = await setup();
  h.controller.trust(true);
  await h.run("terminal.new");
  expect(h.port.start).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "one", generation: 1, cwd: ".", shell: undefined, trusted: true }));
  h.controller.trust(false);
  await h.run("terminal.stop");
  expect(h.port.stop).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "pty-1" }));
  expect(h.commands().some(c => c.id === "terminal.stop")).toBe(false);
  await h.run("terminal.close");
  expect(h.port.close).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "pty-1" }));
  expect(h.controller.getState().sessions).toHaveLength(0);
});
it.each(["workspace", "trust"] as const)("refuses a captured Start after %s changes", async change => {
  const h = await setup();
  h.controller.trust(true);
  const command = h.commands().find(c => c.id === "terminal.new")!;
  if (change === "workspace") h.controller.setContext({ workspaceId: "two", generation: 2 });
  else h.controller.trust(false);
  await command.run();
  expect(h.port.start).not.toHaveBeenCalled();
});
it("does not stop a different terminal after the selection changes", async () => {
  const h = await setup();
  h.controller.trust(true);
  await h.run("terminal.new");
  const stop = h.commands().find(c => c.id === "terminal.stop")!;
  await h.run("terminal.new");
  await stop.run();
  expect(h.port.stop).not.toHaveBeenCalled();
  expect(h.controller.getState().activeSessionId).toBe("pty-2");
});
it("clears only display data and keeps the shell running", async () => {
  const h = await setup();
  h.controller.trust(true);
  await h.run("terminal.new");
  const events = vi.fn();
  const unsubscribe = h.controller.getState().sessions[0].feed.subscribe(events);
  events.mockClear();
  await h.run("terminal.clear");
  expect(events).toHaveBeenCalledWith({ kind: "reset", data: new Uint8Array() });
  expect(h.controller.getState().sessions[0].snapshot.state).toBe("running");
  expect(h.port.stop).not.toHaveBeenCalled();
  expect(h.port.close).not.toHaveBeenCalled();
  unsubscribe();
});
