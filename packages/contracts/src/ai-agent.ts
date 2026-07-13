// ---------------------------------------------------------------------------
// @ide/contracts – AI Agent Types
// ---------------------------------------------------------------------------
// Source-only contracts for optional model-backed agent adapters. Browser/core
// code must not import Pi SDKs or runtime implementations directly; concrete
// adapters/backends own those integrations behind ports.

/** Supported AI agent provider identifiers. */
export type AiAgentProvider = 'pi';

/** Pi agent adapter integration modes. Only RPC via `pi --mode rpc` is configurable today; CLI/SDK are future/legacy literals kept for compatibility. */
export type PiAgentIntegration = 'rpc' | 'cli' | 'sdk';

/** Canonical Pi agent provider identifier. */
export const PI_AGENT_PROVIDER: AiAgentProvider = 'pi';

/** Preferred Pi integration: process-isolated RPC via `pi --mode rpc`. */
export const PI_AGENT_PREFERRED_INTEGRATION: PiAgentIntegration = 'rpc';

/** Default fallback integrations. Empty because the app supports RPC-only integration today. */
export const PI_AGENT_FALLBACK_INTEGRATIONS = [] as const satisfies readonly PiAgentIntegration[];

/** Source category for Pi Agent commands returned by RPC command discovery. */
export type AiAgentCommandSource = 'skill' | 'prompt' | 'extension';

/** Discoverable Pi Agent command/skill advertised by the adapter/backend. */
export interface AiAgentCommand {
  /** Command or skill name, for example the `name` in `/skill:name ...`. */
  name: string;
  /** Optional human-readable summary. */
  description?: string;
  /** Origin of the command in Pi Agent. */
  source: AiAgentCommandSource;
  /** Optional display location, such as a skill pack or extension label. */
  location?: string;
  /** Optional filesystem or registry path reported by the backend. */
  path?: string;
}

/** Settings controlled by the app Settings UI for the optional Pi agent integration. */
export interface PiAgentSettings {
  /** Whether Pi agent integration is enabled for the current profile/workspace. */
  enabled: boolean;
  /** Agent provider selected by these settings. */
  provider: AiAgentProvider;
  /** Preferred integration mode. Defaults to process-isolated RPC via `pi --mode rpc`; CLI/SDK are not user-configurable today. */
  preferredIntegration: PiAgentIntegration;
  /** Reserved fallback integrations. Defaults empty so CLI/SDK are not privileged or shown today. */
  fallbackIntegrations: readonly PiAgentIntegration[];
  /** Optional model/profile identifier interpreted by the adapter/backend. */
  model?: string;
  /** Legacy/future CLI executable path; not configurable while the app is RPC-only. */
  cliPath?: string;
  /** Optional RPC endpoint/connection name when RPC is selected by an adapter. */
  rpcEndpoint?: string;
  /** Adapter-specific settings that remain behind the contract boundary. */
  metadata?: Record<string, unknown>;
}

/** Partial Settings UI update payload; adapters return a normalized full settings object. */
export type PiAgentSettingsUpdate = Partial<Omit<PiAgentSettings, 'provider'>> & {
  provider?: AiAgentProvider;
};

/** Default disabled Pi agent settings for first-run profiles. */
export const DEFAULT_PI_AGENT_SETTINGS = {
  enabled: false,
  provider: PI_AGENT_PROVIDER,
  preferredIntegration: PI_AGENT_PREFERRED_INTEGRATION,
  fallbackIntegrations: PI_AGENT_FALLBACK_INTEGRATIONS,
} as const satisfies PiAgentSettings;

/** High-level availability state reported by the concrete Pi adapter/backend. */
export type PiAgentAvailability =
  | 'disabled'
  | 'available'
  | 'not-installed'
  | 'installing'
  | 'unavailable'
  | 'error';

/** Runtime status for the optional Pi agent integration. */
export interface PiAgentStatus {
  /** Agent provider represented by this status. */
  provider: AiAgentProvider;
  /** Whether integration is enabled in settings. */
  enabled: boolean;
  /** Whether the agent can currently handle prompts. */
  available: boolean;
  /** Human/machine-readable availability classification. */
  availability: PiAgentAvailability;
  /** Preferred integration from settings. */
  preferredIntegration: PiAgentIntegration;
  /** Actual integration selected by the adapter, when available. */
  activeIntegration?: PiAgentIntegration;
  /** Reserved fallback integrations available to the adapter; empty in the current RPC-only integration. */
  fallbackIntegrations?: readonly PiAgentIntegration[];
  /** Detected Pi agent version, when known. */
  version?: string;
  /** Last adapter/backend error message, when any. */
  lastError?: string;
  /** ISO-8601 timestamp for when status was checked. */
  checkedAt?: string;
  /** Adapter-specific diagnostics that remain behind the contract boundary. */
  metadata?: Record<string, unknown>;
}

/** Installation outcomes for adapter/backends that can install or bootstrap Pi. */
export type PiAgentInstallOutcome =
  | 'installed'
  | 'already-installed'
  | 'failed'
  | 'cancelled'
  | 'unsupported';

/** Result returned by an adapter/backend after attempting Pi agent installation. */
export interface PiAgentInstallResult {
  /** Agent provider targeted by the installation request. */
  provider: AiAgentProvider;
  /** Whether the installation request completed successfully. */
  success: boolean;
  /** Normalized installation outcome. */
  outcome: PiAgentInstallOutcome;
  /** Integration mode installed or verified, when known. */
  integration?: PiAgentIntegration;
  /** Installed/detected Pi agent version, when known. */
  version?: string;
  /** User-facing result message. */
  message?: string;
  /** Adapter-specific metadata/log summary that remains behind the contract boundary. */
  metadata?: Record<string, unknown>;
}

/** Minimal response returned by an AI agent prompt call. */
export interface AiAgentResponse {
  /** User-facing response text produced by the agent. */
  text: string;
  /** Provider that produced the response. */
  provider?: AiAgentProvider;
  /** Integration mode used by the adapter/backend, when known. */
  integration?: PiAgentIntegration;
  /** Optional adapter/provider model identifier. */
  model?: string;
  /** Optional provider-specific metadata kept behind the contract boundary. */
  metadata?: Record<string, unknown>;
}

/** Pi/Agent message object restored from persisted session state. */
export interface PiAgentSessionMessage {
  role?: string;
  content?: unknown;
  [field: string]: unknown;
}

/** Persisted Pi/Agent session messages for the current workspace/session. */
export interface PiAgentSessionMessages {
  provider?: AiAgentProvider;
  integration?: PiAgentIntegration;
  workspaceId: string;
  sessionId: string;
  messages: PiAgentSessionMessage[];
  metadata?: Record<string, unknown>;
}

/** Multi-agent trace metadata attached to native Pi event records. */
export interface PiMultiAgentTraceEnvelope {
  schemaVersion: 'pi-multi-agent-trace-v1';
  runId: string;
  traceId: string;
  workspaceId: string;
  workflow?: string | null;
  agentId: string;
  parentAgentId?: string | null;
  timestamp: string;
  sequence: number;
  previousHash: string;
  hash?: string;
}

/** Generic persisted Pi event, optionally annotated with multi-agent trace metadata. */
export interface PiAgentTraceEvent {
  type: string;
  multiAgent?: PiMultiAgentTraceEnvelope;
  [field: string]: unknown;
}

/** File change summary detected while processing a persisted Pi agent run. */
export interface PiAgentFileChange {
  path: string;
  status: string;
}

/** Summary of a persisted Pi agent run trace. */
export interface PiAgentRun {
  runId: string;
  traceId?: string;
  agentId?: string;
  parentAgentId?: string | null;
  workflow?: string | null;
  workspaceId?: string;
  startedAt?: string;
  sealedAt?: string;
  complete?: boolean;
  eventCount?: number;
  changedFiles?: PiAgentFileChange[];
}

/** Full persisted Pi agent run trace. */
export interface PiAgentRunTrace {
  runId: string;
  events: PiAgentTraceEvent[];
}
