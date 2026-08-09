import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  AttachPiWorkspaceAgentRequest,
  DetachPiWorkspaceAgentRequest,
  PiWorkspaceAgentAccessories,
  PiWorkspaceAgentAttachment,
  PiWorkspaceAgentOutputEvent,
  PiWorkspaceAgentSessionSnapshot,
  PiWorkspaceAgentStatusEvent,
  ResizePiWorkspaceAgentRequest,
  WorkspaceInfo,
} from "@ide/contracts";
import type { PiWorkspaceAgentPort } from "@ide/web-core/ports";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePiWorkspaceAgentController } from "./usePiWorkspaceAgentController";

const WORKSPACE_A: WorkspaceInfo = {
  id: "workspace-a",
  name: "Workspace A",
  rootPath: "/workspace/a",
};
const WORKSPACE_B: WorkspaceInfo = {
  id: "workspace-b",
  name: "Workspace B",
  rootPath: "/workspace/b",
};

function encode(value: string): string {
  return btoa(value);
}

class FakePiWorkspaceAgentPort implements PiWorkspaceAgentPort {
  readonly sessions = new Map<string, PiWorkspaceAgentSessionSnapshot>();
  readonly transcripts = new Map<string, string>([
    ["workspace-a", "A-initial\r\n"],
    ["workspace-b", "B-initial\r\n"],
  ]);
  readonly outputListeners = new Set<(event: PiWorkspaceAgentOutputEvent) => void>();
  readonly statusListeners = new Set<(event: PiWorkspaceAgentStatusEvent) => void>();
  readonly attach = vi.fn(async (request: AttachPiWorkspaceAgentRequest) => {
    const current = this.ensureSession(request.workspaceId, request.workspaceName);
    return this.attachment(current);
  });
  readonly detach = vi.fn(async (_request: DetachPiWorkspaceAgentRequest) => undefined);
  readonly write = vi.fn(async (_workspaceId: string, _data: Uint8Array) => undefined);
  readonly resize = vi.fn(async (_request: ResizePiWorkspaceAgentRequest) => undefined);
  readonly start = vi.fn(async (workspaceId: string) => {
    const current = this.ensureSession(workspaceId, workspaceId);
    current.processState = "running";
    current.processGeneration += 1;
    return this.attachment(current);
  });
  readonly stop = vi.fn(async (workspaceId: string, confirmed: true) => {
    expect(confirmed).toBe(true);
    const current = this.ensureSession(workspaceId, workspaceId);
    current.processState = "stopped";
    delete current.processId;
    return this.attachment(current);
  });
  readonly snapshot = vi.fn(async (workspaceId: string) =>
    this.attachment(this.ensureSession(workspaceId, workspaceId)),
  );
  readonly accessories = vi.fn(
    async (workspaceId: string): Promise<PiWorkspaceAgentAccessories> => ({
      protocolVersion: 1,
      workspaceId,
      changes: [],
      resources: [],
      warnings: [],
    }),
  );
  readonly openDetached = vi.fn(async (workspaceId: string) => ({
    protocolVersion: 1 as const,
    workspaceId,
    workspaceName: this.ensureSession(workspaceId, workspaceId).workspaceName,
  }));
  readonly getDetachedBinding = vi.fn(async () => ({
    protocolVersion: 1 as const,
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
  }));

  async subscribeOutput(listener: (event: PiWorkspaceAgentOutputEvent) => void) {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  async subscribeStatus(listener: (event: PiWorkspaceAgentStatusEvent) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  emitOutput(workspaceId: string, text: string, sequence: number): void {
    const session = this.ensureSession(workspaceId, workspaceId);
    const event: PiWorkspaceAgentOutputEvent = {
      protocolVersion: 1,
      workspaceId,
      processGeneration: session.processGeneration,
      sequence,
      dataBase64: encode(text),
    };
    for (const listener of this.outputListeners) listener(event);
  }

  private ensureSession(
    workspaceId: string,
    workspaceName: string,
  ): PiWorkspaceAgentSessionSnapshot {
    const existing = this.sessions.get(workspaceId);
    if (existing) return existing;
    const session: PiWorkspaceAgentSessionSnapshot = {
      workspaceId,
      workspaceName,
      rootPath: workspaceId === "workspace-a" ? "/workspace/a" : "/workspace/b",
      sessionId: `ide-${workspaceId}`,
      processState: "running",
      processGeneration: 1,
      processId: workspaceId === "workspace-a" ? 101 : 202,
      startedAt: "2026-08-09T00:00:00.000Z",
      lastActivityAt: "2026-08-09T00:00:00.000Z",
      attachedViewCount: 1,
    };
    this.sessions.set(workspaceId, session);
    return session;
  }

  private attachment(current: PiWorkspaceAgentSessionSnapshot): PiWorkspaceAgentAttachment {
    return {
      protocolVersion: 1,
      session: { ...current },
      transcriptBase64: encode(this.transcripts.get(current.workspaceId) ?? ""),
      transcriptSequence: 1,
      transcriptTruncated: false,
      activities: [],
      sessions: [...this.sessions.values()].map((session) => ({ ...session })),
    };
  }
}

describe("usePiWorkspaceAgentController", () => {
  let port: FakePiWorkspaceAgentPort;

  beforeEach(() => {
    port = new FakePiWorkspaceAgentPort();
  });

  it("isolates output while switching A to B to A and only detaches renderers", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ workspace }) => usePiWorkspaceAgentController({ port, workspace, viewKind: "docked" }),
      { initialProps: { workspace: WORKSPACE_A } },
    );
    const feedEvents: Array<{ workspaceId: string; text: string }> = [];
    const unsubscribeFeed = result.current.terminalFeed.subscribe((event) => {
      feedEvents.push({
        workspaceId: event.workspaceId,
        text: new TextDecoder().decode(event.data),
      });
    });

    await waitFor(() => expect(result.current.session?.workspaceId).toBe("workspace-a"));
    act(() => port.emitOutput("workspace-a", "A-live", 2));
    expect(feedEvents.at(-1)).toEqual({ workspaceId: "workspace-a", text: "A-live" });
    const processA = result.current.session?.processId;

    rerender({ workspace: WORKSPACE_B });
    await waitFor(() => expect(result.current.session?.workspaceId).toBe("workspace-b"));
    act(() => {
      port.emitOutput("workspace-a", "A-must-not-leak", 3);
      port.emitOutput("workspace-b", "B-live", 2);
    });
    expect(feedEvents.at(-1)).toEqual({ workspaceId: "workspace-b", text: "B-live" });
    expect(feedEvents.map((event) => event.text)).not.toContain("A-must-not-leak");

    rerender({ workspace: WORKSPACE_A });
    await waitFor(() => expect(result.current.session?.workspaceId).toBe("workspace-a"));
    expect(result.current.session?.processId).toBe(processA);
    expect(result.current.session?.sessionId).toBe("ide-workspace-a");
    expect(feedEvents.at(-1)).toEqual({ workspaceId: "workspace-a", text: "A-initial\r\n" });

    unmount();
    unsubscribeFeed();
    await waitFor(() => expect(port.detach).toHaveBeenCalledTimes(3));
    expect(port.stop).not.toHaveBeenCalled();
    expect(port.detach.mock.calls.map(([request]) => request.workspaceId)).toEqual([
      "workspace-a",
      "workspace-b",
      "workspace-a",
    ]);
  });

  it("forwards raw modified Enter bytes and requires the controller's explicit stop action", async () => {
    const { result } = renderHook(() =>
      usePiWorkspaceAgentController({ port, workspace: WORKSPACE_A, viewKind: "docked" }),
    );
    await waitFor(() => expect(result.current.session?.processState).toBe("running"));

    act(() => result.current.write("\u001b[13;2u"));
    await waitFor(() => expect(port.write).toHaveBeenCalledOnce());
    expect(port.write.mock.calls[0]?.[0]).toBe("workspace-a");
    expect([...port.write.mock.calls[0]![1]]).toEqual([
      ...new TextEncoder().encode("\u001b[13;2u"),
    ]);

    await act(async () => result.current.openDetached());
    expect(port.openDetached).toHaveBeenCalledWith("workspace-a");
    expect(port.stop).not.toHaveBeenCalled();

    await act(async () => result.current.stop());
    expect(port.stop).toHaveBeenCalledExactlyOnceWith("workspace-a", true);
    expect(result.current.session?.processState).toBe("stopped");
  });
});
