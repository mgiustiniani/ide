import type {
  PiWorkspaceAgentAttachment,
  PiWorkspaceAgentProcessState,
  PiWorkspaceAgentSessionSnapshot,
  PiWorkspaceAgentSessionSummary,
} from "@ide/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen.mockImplementation(
    async (eventName: string, listener: (event: { payload: unknown }) => void) => {
      mocks.eventListeners.set(eventName, listener);
      return vi.fn(() => mocks.eventListeners.delete(eventName));
    },
  ),
}));

import {
  PI_WORKSPACE_AGENT_COMMANDS,
  PI_WORKSPACE_AGENT_EVENTS,
  TauriPiWorkspaceAgentAdapter,
} from "./pi-workspace-agent-tauri";

function session(
  workspaceId = "workspace-a",
  state: PiWorkspaceAgentProcessState = "running",
): PiWorkspaceAgentSessionSnapshot {
  return {
    workspaceId,
    workspaceName: workspaceId === "workspace-a" ? "Workspace A" : "Workspace B",
    rootPath: `/workspace/${workspaceId}`,
    sessionId: `ide-${workspaceId}`,
    processState: state,
    processGeneration: 1,
    processId: 42,
    startedAt: "2026-08-09T00:00:00.000Z",
    lastActivityAt: "2026-08-09T00:00:01.000Z",
    attachedViewCount: 1,
  };
}

function sessionSummary(workspaceId = "workspace-b"): PiWorkspaceAgentSessionSummary {
  return {
    workspaceId,
    workspaceName: workspaceId === "workspace-a" ? "Workspace A" : "Workspace B",
    sessionId: `ide-${workspaceId}`,
    processState: "running",
    processGeneration: 1,
    lastActivityAt: "2026-08-09T00:00:01.000Z",
    attachedViewCount: 0,
  };
}

function attachment(
  workspaceId = "workspace-a",
  sessions: PiWorkspaceAgentSessionSummary[] = [],
): PiWorkspaceAgentAttachment {
  return {
    protocolVersion: 1,
    session: session(workspaceId),
    transcriptBase64: "G1szMW1QaVxu",
    transcriptSequence: 3,
    transcriptTruncated: false,
    activities: [
      {
        sequence: 1,
        eventType: "attached",
        timestamp: "2026-08-09T00:00:01.000Z",
        detail: "View attached; process lifetime remains native",
        viewId: "docked:view-1",
      },
    ],
    sessions,
  };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockClear();
  mocks.eventListeners.clear();
});

describe("TauriPiWorkspaceAgentAdapter", () => {
  it("attaches with exact workspace identity, view identity, and PTY geometry", async () => {
    mocks.invoke.mockResolvedValueOnce(attachment());
    const adapter = new TauriPiWorkspaceAgentAdapter();

    await expect(
      adapter.attach({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        viewId: "docked:view-1",
        cols: 72,
        rows: 38,
      }),
    ).resolves.toMatchObject({
      session: { workspaceId: "workspace-a", sessionId: "ide-workspace-a" },
      transcriptSequence: 3,
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(PI_WORKSPACE_AGENT_COMMANDS.attach, {
      workspaceId: "workspace-a",
      workspaceName: "Workspace A",
      viewId: "docked:view-1",
      cols: 72,
      rows: 38,
    });
  });

  it("encodes raw terminal bytes without interpreting a command line", async () => {
    mocks.invoke.mockResolvedValueOnce(undefined);
    const adapter = new TauriPiWorkspaceAgentAdapter();

    await adapter.write("workspace-a", new Uint8Array([0x1b, 0x0d, 0x00, 0xff]));

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(PI_WORKSPACE_AGENT_COMMANDS.write, {
      workspaceId: "workspace-a",
      dataBase64: "Gw0A/w==",
    });
  });

  it("normalizes workspace-keyed output and status events", async () => {
    const adapter = new TauriPiWorkspaceAgentAdapter();
    const output = vi.fn();
    const status = vi.fn();
    const unsubscribeOutput = await adapter.subscribeOutput(output);
    const unsubscribeStatus = await adapter.subscribeStatus(status);

    mocks.eventListeners.get(PI_WORKSPACE_AGENT_EVENTS.output)?.({
      payload: {
        protocolVersion: 1,
        workspaceId: "workspace-a",
        processGeneration: 4,
        sequence: 9,
        dataBase64: "QQ==",
      },
    });
    mocks.eventListeners.get(PI_WORKSPACE_AGENT_EVENTS.status)?.({
      payload: { protocolVersion: 1, session: session("workspace-a") },
    });

    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-a", sequence: 9, dataBase64: "QQ==" }),
    );
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ workspaceId: "workspace-a" }) }),
    );
    unsubscribeOutput();
    unsubscribeStatus();
    expect(mocks.eventListeners).toHaveLength(0);
  });

  it("rejects malformed protocol responses instead of inventing a session", async () => {
    mocks.invoke.mockResolvedValueOnce({ ...attachment(), protocolVersion: 2 });
    const adapter = new TauriPiWorkspaceAgentAdapter();

    await expect(
      adapter.attach({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        viewId: "docked:view-1",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("unsupported protocolVersion");
  });

  it("accepts exact seven-field rootless retained-session summaries", async () => {
    const retainedSession = sessionSummary();
    mocks.invoke.mockResolvedValueOnce(attachment("workspace-a", [retainedSession]));
    const adapter = new TauriPiWorkspaceAgentAdapter();

    const result = await adapter.snapshot("workspace-a");

    expect(result.sessions).toStrictEqual([retainedSession]);
  });

  it.each([
    { field: "rootPath", value: "/workspace/workspace-b" },
    { field: "processId", value: 42 },
    { field: "lastError", value: "native process failed" },
  ])(
    "rejects retained-session summaries containing forbidden full-snapshot field $field",
    async ({ field, value }) => {
      mocks.invoke.mockResolvedValueOnce({
        ...attachment(),
        sessions: [{ ...sessionSummary(), [field]: value }],
      });
      const adapter = new TauriPiWorkspaceAgentAdapter();

      await expect(adapter.snapshot("workspace-a")).rejects.toThrow(field);
    },
  );

  it("keeps packages with no slash command in accessory resources", async () => {
    mocks.invoke.mockResolvedValueOnce({
      protocolVersion: 1,
      workspaceId: "workspace-a",
      changes: [{ path: "src/App.tsx", status: "modified" }],
      resources: [
        {
          kind: "package",
          name: "npm:no-command-package",
          scope: "user",
          path: "/home/user/.pi/agent/npm/node_modules/no-command-package",
        },
        {
          kind: "command",
          name: "skill:multi-agent",
          scope: "effective",
          source: "skill",
        },
      ],
      warnings: [],
    });
    const adapter = new TauriPiWorkspaceAgentAdapter();

    const result = await adapter.accessories("workspace-a");

    expect(result.resources).toContainEqual(
      expect.objectContaining({ kind: "package", name: "npm:no-command-package" }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(PI_WORKSPACE_AGENT_COMMANDS.accessories, {
      workspaceId: "workspace-a",
    });
  });

  it("sends explicit confirmation for Stop Pi and no stop command for detach", async () => {
    mocks.invoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...attachment(), session: session("workspace-a", "stopped") });
    const adapter = new TauriPiWorkspaceAgentAdapter();

    await adapter.detach({ workspaceId: "workspace-a", viewId: "docked:view-1" });
    await adapter.stop("workspace-a", true);

    expect(mocks.invoke.mock.calls).toEqual([
      [PI_WORKSPACE_AGENT_COMMANDS.detach, { workspaceId: "workspace-a", viewId: "docked:view-1" }],
      [PI_WORKSPACE_AGENT_COMMANDS.stop, { workspaceId: "workspace-a", confirmed: true }],
    ]);
  });
});
