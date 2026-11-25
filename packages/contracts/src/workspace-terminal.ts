/** Interactive terminal transport uses bytes; the shell owns prompts and line editing. */
export interface WorkspaceTerminalContext {
  workspaceId: string;
  generation: number;
  clientId: string;
}
export interface WorkspaceTerminalCapabilities extends WorkspaceTerminalContext {
  available: boolean;
  defaultShell: string | null;
  reason: string | null;
}
export interface WorkspaceTerminalStart extends WorkspaceTerminalContext {
  trusted: boolean;
  cwd: string;
  shell?: string;
  cols: number;
  rows: number;
}
export interface WorkspaceTerminalSession extends WorkspaceTerminalContext {
  sessionId: string;
  cursor: number;
}
export interface WorkspaceTerminalSnapshot extends WorkspaceTerminalSession {
  state: "running" | "exited" | "stopped" | "failed";
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  dataBase64: string;
  firstCursor: number;
  nextCursor: number;
  endCursor: number;
  reset: boolean;
  exitCode: number | null;
  error: string | null;
}
export interface WorkspaceTerminalWriteResult extends WorkspaceTerminalContext {
  sessionId: string;
  acceptedBytes: number;
}
export interface RawTerminalFeedEvent {
  kind: "reset" | "data";
  data: Uint8Array;
}
export interface RawTerminalFeed {
  subscribe(listener: (event: RawTerminalFeedEvent) => void): () => void;
}
