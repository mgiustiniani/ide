// ---------------------------------------------------------------------------
// @ide/web-core – LanguageSessionPort
// ---------------------------------------------------------------------------
// Provider-neutral lifecycle and event boundary for a managed language service.
// Concrete adapters own tool discovery, processes, transport and initialization.

import type {
  LanguageServiceEventListener,
  LanguageServiceStatus,
  LanguageServiceUnsubscribe,
  LanguageSessionTarget,
  RestartLanguageSessionRequest,
  StartLanguageSessionRequest,
  StopLanguageSessionRequest,
} from "@ide/contracts";

export interface LanguageSessionPort {
  /** Return the latest status for an authorized workspace session. */
  getStatus(target: LanguageSessionTarget): Promise<LanguageServiceStatus>;

  /** Start and initialize a new workspace-scoped session. */
  start(request: StartLanguageSessionRequest): Promise<LanguageServiceStatus>;

  /** Stop the specified session generation. */
  stop(request: StopLanguageSessionRequest): Promise<LanguageServiceStatus>;

  /** Replace the specified generation with a newly initialized session. */
  restart(request: RestartLanguageSessionRequest): Promise<LanguageServiceStatus>;

  /**
   * Subscribe to status, progress and diagnostics for one workspace.
   * The returned function must detach the listener and be safe to call more than once.
   */
  subscribe(
    workspaceId: string,
    listener: LanguageServiceEventListener,
  ): LanguageServiceUnsubscribe;
}
