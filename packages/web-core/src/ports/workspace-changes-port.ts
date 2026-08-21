/**
 * Workspace-changes port for REQ-IDE-GIT-DIFF-REVIEW-001.
 *
 * Lists the modified/added tracked paths of the resolved workspace root.
 * The shared hunk-level diff-review contract types also live here so the
 * read-only-diff and editor-open-range ports can import them.
 *
 * All port operations are Promise-based so browser, desktop (Tauri), and
 * test adapters can implement them with async native/platform calls.
 */

import {
  createReadOnlyGitDiffSource,
  resolveWorkspaceRoot,
} from "../services/workspace-root";

/** One contiguous line range inside a file. */
export interface DiffRange {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** One unified-diff hunk: header counts plus the raw hunk body lines. */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly text: string;
}

/** A read-only, hunk-level diff of one working-tree file. */
export interface HunkLevelDiff {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  readonly range: DiffRange;
  readonly readOnly: true;
}

/** Honest outcome of a diff-review request: ok with hunks, or unavailable. */
export type DiffReviewOutcome =
  | { readonly kind: "ok"; readonly diff: HunkLevelDiff }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Port: which modified/added tracked files exist in the workspace. */
export interface WorkspaceChangesPort {
  listModifiedFiles(): Promise<readonly string[]>;
}

/**
 * Default reference implementation.
 *
 * Delegates to the shared read-only git source for the resolved workspace
 * root: a real `git status --porcelain=v1` scan is executed and the parsed
 * modified/added tracked paths are resolved asynchronously. When git is
 * absent or the workspace is not a repository, the honest result is an
 * empty list.
 */
const defaultWorkspaceChangesPort: WorkspaceChangesPort = {
  async listModifiedFiles(): Promise<readonly string[]> {
    return createReadOnlyGitDiffSource(resolveWorkspaceRoot()).listModifiedFiles();
  },
};

export default defaultWorkspaceChangesPort;
