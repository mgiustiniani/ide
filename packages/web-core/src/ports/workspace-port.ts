// ---------------------------------------------------------------------------
// @ide/web-core – WorkspacePort
// ---------------------------------------------------------------------------
// Port interface for workspace metadata and user workspace registry access.
// Concrete adapters implement this interface.

import type { WorkspaceInfo, WorkspaceRegistry } from "@ide/contracts";

export interface WorkspacePort {
  /** Ensure the current workspace has a `.ide` marker and is registered for the user. */
  ensureCurrentWorkspace(): Promise<WorkspaceInfo>;

  /** Return the user-level workspace registry known to the adapter. */
  listWorkspaces(): Promise<WorkspaceRegistry>;

  /** Switch the active workspace by registered workspace ID. */
  switchWorkspace(workspaceId: string): Promise<WorkspaceInfo>;
}
