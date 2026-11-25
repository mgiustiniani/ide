import type {
  WorkspaceTerminalCapabilities,
  WorkspaceTerminalContext,
  WorkspaceTerminalSession,
  WorkspaceTerminalSnapshot,
  WorkspaceTerminalStart,
  WorkspaceTerminalWriteResult,
} from "@ide/contracts";
export interface WorkspaceTerminalPort {
  capabilities(context: WorkspaceTerminalContext): Promise<WorkspaceTerminalCapabilities>;
  start(request: WorkspaceTerminalStart): Promise<WorkspaceTerminalSnapshot>;
  read(request: WorkspaceTerminalSession): Promise<WorkspaceTerminalSnapshot>;
  write(
    request: WorkspaceTerminalSession & { dataBase64: string },
  ): Promise<WorkspaceTerminalWriteResult>;
  resize(
    request: WorkspaceTerminalSession & { cols: number; rows: number },
  ): Promise<WorkspaceTerminalSnapshot>;
  stop(request: WorkspaceTerminalSession): Promise<WorkspaceTerminalSnapshot>;
  close(request: WorkspaceTerminalSession): Promise<void>;
}
