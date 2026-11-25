import type {
  WorkspaceTerminalCapabilities,
  WorkspaceTerminalContext,
  WorkspaceTerminalSession,
  WorkspaceTerminalSnapshot,
  WorkspaceTerminalStart,
  WorkspaceTerminalWriteResult,
} from "@ide/contracts";
import type { WorkspaceTerminalPort } from "@ide/web-core/ports";
import { invokeTauri } from "./errors";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid terminal response.");
  return value as Record<string, unknown>;
}
function correlated(value: unknown, request: WorkspaceTerminalContext & { sessionId?: string }) {
  const data = object(value);
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.clientId !== request.clientId ||
    (request.sessionId !== undefined && data.sessionId !== request.sessionId)
  )
    throw new Error("Stale terminal response.");
  return data;
}
function integer(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}
function nullableText(value: unknown, max: number) {
  return value === null || (typeof value === "string" && value.length <= max);
}
function snapshot(
  value: unknown,
  request: WorkspaceTerminalContext & { sessionId?: string },
): WorkspaceTerminalSnapshot {
  const data = correlated(value, request);
  if (
    typeof data.sessionId !== "string" ||
    !data.sessionId ||
    data.sessionId.length > 128 ||
    !["running", "exited", "stopped", "failed"].includes(String(data.state)) ||
    !integer(data.pid, 1, 2_147_483_647) ||
    typeof data.shell !== "string" ||
    !data.shell ||
    data.shell.length > 4096 ||
    typeof data.cwd !== "string" ||
    !data.cwd ||
    data.cwd.length > 4096 ||
    !integer(data.cols, 2, 1000) ||
    !integer(data.rows, 1, 1000) ||
    typeof data.dataBase64 !== "string" ||
    data.dataBase64.length > 87_384 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.dataBase64) ||
    !integer(data.firstCursor, 0, Number.MAX_SAFE_INTEGER) ||
    !integer(data.nextCursor, Number(data.firstCursor), Number.MAX_SAFE_INTEGER) ||
    !integer(data.endCursor, Number(data.nextCursor), Number.MAX_SAFE_INTEGER) ||
    typeof data.reset !== "boolean" ||
    !(data.exitCode === null || integer(data.exitCode, 0, 4_294_967_295)) ||
    !nullableText(data.error, 4096)
  )
    throw new Error("Invalid terminal snapshot.");
  const length = atob(data.dataBase64).length;
  if (data.nextCursor - data.firstCursor !== length || length > 65_536)
    throw new Error("Invalid terminal output range.");
  return { ...data, cursor: data.nextCursor } as unknown as WorkspaceTerminalSnapshot;
}
function nativeSession(request: WorkspaceTerminalSession) {
  return {
    context: {
      workspaceId: request.workspaceId,
      generation: request.generation,
      clientId: request.clientId,
    },
    sessionId: request.sessionId,
    cursor: request.cursor,
  };
}
export class TauriTerminalAdapter implements WorkspaceTerminalPort {
  async capabilities(request: WorkspaceTerminalContext): Promise<WorkspaceTerminalCapabilities> {
    const data = correlated(
      await invokeTauri("get_workspace_terminal_capabilities", { request }),
      request,
    );
    if (
      typeof data.available !== "boolean" ||
      !nullableText(data.defaultShell, 4096) ||
      !nullableText(data.reason, 4096) ||
      (data.available && (typeof data.defaultShell !== "string" || !data.defaultShell))
    )
      throw new Error("Invalid terminal capabilities.");
    return data as unknown as WorkspaceTerminalCapabilities;
  }
  async start(request: WorkspaceTerminalStart) {
    const { workspaceId, generation, clientId, ...settings } = request;
    return snapshot(
      await invokeTauri("start_workspace_terminal", {
        request: {
          context: { workspaceId, generation, clientId },
          ...settings,
          shell: settings.shell ?? null,
        },
      }),
      request,
    );
  }
  async read(request: WorkspaceTerminalSession) {
    return snapshot(
      await invokeTauri("read_workspace_terminal", { request: nativeSession(request) }),
      request,
    );
  }
  async write(
    request: WorkspaceTerminalSession & { dataBase64: string },
  ): Promise<WorkspaceTerminalWriteResult> {
    const data = correlated(
      await invokeTauri("write_workspace_terminal", {
        request: { session: nativeSession(request), dataBase64: request.dataBase64 },
      }),
      request,
    );
    const count = atob(request.dataBase64).length;
    if (!integer(data.acceptedBytes, 0, count))
      throw new Error("Invalid terminal input acknowledgement.");
    return data as unknown as WorkspaceTerminalWriteResult;
  }
  async resize(request: WorkspaceTerminalSession & { cols: number; rows: number }) {
    return snapshot(
      await invokeTauri("resize_workspace_terminal", {
        request: { session: nativeSession(request), cols: request.cols, rows: request.rows },
      }),
      request,
    );
  }
  async stop(request: WorkspaceTerminalSession) {
    return snapshot(
      await invokeTauri("stop_workspace_terminal", { request: nativeSession(request) }),
      request,
    );
  }
  async close(request: WorkspaceTerminalSession) {
    await invokeTauri("close_workspace_terminal", { request: nativeSession(request) });
  }
}
