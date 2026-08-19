/**
 * Read-only-diff port for REQ-IDE-GIT-DIFF-REVIEW-001.
 *
 * Produces a read-only, hunk-level diff of one modified working-tree file.
 * The contract outcome types are re-exported from workspace-changes-port so
 * consumers can type against this module without extra imports.
 */

import {
  createReadOnlyGitDiffSource,
  resolveWorkspaceRoot,
} from "../services/workspace-root";
import type { DiffReviewOutcome } from "./workspace-changes-port";

export type { DiffHunk, DiffRange, DiffReviewOutcome, HunkLevelDiff } from "./workspace-changes-port";

/** Port: produce a read-only hunk-level diff for one path. */
export interface ReadOnlyDiffPort {
  produceDiff(filePath: string): DiffReviewOutcome;
}

/**
 * Default reference implementation.
 *
 * Delegates to the shared read-only git source for the resolved workspace
 * root: `git diff --no-ext-diff --unified=3 -- <path>` is executed and the
 * unified hunks are parsed (old/new starts are always >= 1). It returns ok
 * with `readOnly: true`; it returns an honest unavailable outcome when git
 * fails, the path is not modified/added, or no hunk-level change is produced.
 */
const defaultReadOnlyDiffPort: ReadOnlyDiffPort = {
  produceDiff(filePath: string): DiffReviewOutcome {
    return createReadOnlyGitDiffSource(resolveWorkspaceRoot()).produceDiff(filePath);
  },
};

export default defaultReadOnlyDiffPort;
