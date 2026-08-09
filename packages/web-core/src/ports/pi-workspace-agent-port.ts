import type {
  AttachPiWorkspaceAgentRequest,
  DetachPiWorkspaceAgentRequest,
  PiWorkspaceAgentAccessories,
  PiWorkspaceAgentAttachment,
  PiWorkspaceAgentDetachedBinding,
  PiWorkspaceAgentOutputEvent,
  PiWorkspaceAgentStatusEvent,
  ResizePiWorkspaceAgentRequest,
} from "@ide/contracts";

export type PiWorkspaceAgentUnsubscribe = () => void;

/**
 * Native boundary for one backend-owned interactive Pi PTY per IDE workspace.
 *
 * This port transports raw terminal bytes and accessory metadata only. It must
 * never grow chat/message/tool/model/history methods; those remain native Pi TUI
 * responsibilities inside the PTY.
 */
export interface PiWorkspaceAgentPort {
  attach(request: AttachPiWorkspaceAgentRequest): Promise<PiWorkspaceAgentAttachment>;
  detach(request: DetachPiWorkspaceAgentRequest): Promise<void>;
  write(workspaceId: string, data: Uint8Array): Promise<void>;
  resize(request: ResizePiWorkspaceAgentRequest): Promise<void>;
  start(workspaceId: string, cols: number, rows: number): Promise<PiWorkspaceAgentAttachment>;
  stop(workspaceId: string, confirmed: true): Promise<PiWorkspaceAgentAttachment>;
  snapshot(workspaceId: string): Promise<PiWorkspaceAgentAttachment>;
  accessories(workspaceId: string): Promise<PiWorkspaceAgentAccessories>;
  openDetached(workspaceId: string): Promise<PiWorkspaceAgentDetachedBinding>;
  getDetachedBinding(): Promise<PiWorkspaceAgentDetachedBinding>;
  subscribeOutput(
    listener: (event: PiWorkspaceAgentOutputEvent) => void,
  ): Promise<PiWorkspaceAgentUnsubscribe>;
  subscribeStatus(
    listener: (event: PiWorkspaceAgentStatusEvent) => void,
  ): Promise<PiWorkspaceAgentUnsubscribe>;
}
