// ---------------------------------------------------------------------------
// @ide/contracts – Workspace-bound native Pi Agent transport
// ---------------------------------------------------------------------------
// These closed JSON shapes describe PTY transport and read-only accessory data.
// They intentionally contain no Pi chat message, tool call, model, or history shape.

export const PI_WORKSPACE_AGENT_PROTOCOL_VERSION = 1 as const;
export const PI_WORKSPACE_AGENT_TRANSCRIPT_CAP_BYTES = 1_048_576 as const;

export type PiWorkspaceAgentProcessState = "starting" | "running" | "exited" | "stopped" | "failed";

export interface PiWorkspaceAgentSessionSnapshot {
  workspaceId: string;
  workspaceName: string;
  rootPath: string;
  sessionId: string;
  processState: PiWorkspaceAgentProcessState;
  processGeneration: number;
  processId?: number;
  exitCode?: number;
  startedAt?: string;
  lastActivityAt: string;
  attachedViewCount: number;
  lastError?: string;
}

export interface PiWorkspaceAgentActivity {
  sequence: number;
  eventType: string;
  timestamp: string;
  detail: string;
  viewId?: string;
}

export interface PiWorkspaceAgentAttachment {
  protocolVersion: typeof PI_WORKSPACE_AGENT_PROTOCOL_VERSION;
  session: PiWorkspaceAgentSessionSnapshot;
  /** Bounded raw PTY transcript encoded for the JSON bridge. */
  transcriptBase64: string;
  transcriptSequence: number;
  transcriptTruncated: boolean;
  activities: PiWorkspaceAgentActivity[];
  /** Process/session metadata only; Pi conversation history is deliberately absent. */
  sessions: PiWorkspaceAgentSessionSnapshot[];
}

export interface PiWorkspaceAgentOutputEvent {
  protocolVersion: typeof PI_WORKSPACE_AGENT_PROTOCOL_VERSION;
  workspaceId: string;
  processGeneration: number;
  sequence: number;
  /** One raw PTY output chunk encoded for the JSON/event bridge. */
  dataBase64: string;
}

export interface PiWorkspaceAgentStatusEvent {
  protocolVersion: typeof PI_WORKSPACE_AGENT_PROTOCOL_VERSION;
  session: PiWorkspaceAgentSessionSnapshot;
}

export type PiWorkspaceAgentResourceKind = "package" | "command";
export type PiWorkspaceAgentResourceScope = "user" | "project" | "effective";

export interface PiWorkspaceAgentResource {
  kind: PiWorkspaceAgentResourceKind;
  name: string;
  scope: PiWorkspaceAgentResourceScope;
  source?: string;
  path?: string;
  description?: string;
}

export interface PiWorkspaceAgentChange {
  path: string;
  status: string;
}

export interface PiWorkspaceAgentAccessories {
  protocolVersion: typeof PI_WORKSPACE_AGENT_PROTOCOL_VERSION;
  workspaceId: string;
  changes: PiWorkspaceAgentChange[];
  resources: PiWorkspaceAgentResource[];
  warnings: string[];
}

export interface PiWorkspaceAgentDetachedBinding {
  protocolVersion: typeof PI_WORKSPACE_AGENT_PROTOCOL_VERSION;
  workspaceId: string;
  workspaceName: string;
}

export interface AttachPiWorkspaceAgentRequest {
  workspaceId: string;
  workspaceName: string;
  viewId: string;
  cols: number;
  rows: number;
}

export interface DetachPiWorkspaceAgentRequest {
  workspaceId: string;
  viewId: string;
}

export interface ResizePiWorkspaceAgentRequest {
  workspaceId: string;
  cols: number;
  rows: number;
}
