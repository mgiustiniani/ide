// ---------------------------------------------------------------------------
// @ide/web-core – AiAgentPort
// ---------------------------------------------------------------------------
// Boundary for optional AI agent integration. The app currently supports only Pi
// RPC via `pi --mode rpc`; CLI/SDK are future/legacy details and not configurable here.

import type {
  AiAgentCommand,
  AiAgentResponse,
  PiAgentInstallResult,
  PiAgentRun,
  PiAgentRunTrace,
  PiAgentSessionMessages,
  PiAgentSettings,
  PiAgentSettingsUpdate,
  PiAgentStatus,
} from "@ide/contracts";

export interface AiAgentPort {
  /** Return current Pi agent availability/status from the adapter/backend. */
  getStatus(): Promise<PiAgentStatus>;

  /** Return normalized Settings UI values for the optional RPC-only Pi integration. */
  getSettings(): Promise<PiAgentSettings>;

  /**
   * List Pi Agent commands/skills through the RPC `get_commands` command.
   * Skills are invokable by sending a prompt shaped as `/skill:name ...`.
   */
  listCommands(): Promise<AiAgentCommand[]>;

  /** Persist Settings UI changes and return normalized settings. */
  updateSettings(settings: PiAgentSettingsUpdate): Promise<PiAgentSettings>;

  /** Install or bootstrap the optional Pi agent through the adapter/backend. */
  installPiAgent(): Promise<PiAgentInstallResult>;

  /** List persisted Pi-compatible agent run traces from the workspace. */
  listAgentRuns(limit?: number): Promise<PiAgentRun[]>;

  /** Load the persisted Pi event stream for one agent run. */
  getAgentRunTrace(runId: string): Promise<PiAgentRunTrace>;

  /** Restore persisted Pi session messages for the current workspace/session. */
  getSessionMessages(): Promise<PiAgentSessionMessages>;

  /** Send a prompt when the RPC AI integration is enabled and available. */
  sendPrompt?(prompt: string): Promise<AiAgentResponse>;
}
