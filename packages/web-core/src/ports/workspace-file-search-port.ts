import type { WorkspaceFileSearchResult } from "@ide/contracts";

/** Bounded, generation-bound file lookup for the native workspace. */
export interface WorkspaceFileSearchPort {
  searchFiles(query: string): Promise<WorkspaceFileSearchResult>;
}
