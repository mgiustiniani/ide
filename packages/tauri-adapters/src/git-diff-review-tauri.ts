// ---------------------------------------------------------------------------
// @ide/tauri-adapters – Tauri git diff-review adapters
// ---------------------------------------------------------------------------
// Desktop implementations for REQ-IDE-GIT-DIFF-REVIEW-001 behind the
// web-core ports:
//   TauriWorkspaceChangesAdapter  -> git_status_modified
//   TauriReadOnlyDiffAdapter      -> git_diff_hunks
//   TauriEditorOpenRangeAdapter   -> editor_open_range
//
// ASYNC ADAPTATION NOTICE
// ------------------------
// The web-core ports (WorkspaceChangesPort, ReadOnlyDiffPort,
// EditorOpenRangePort) are SYNC interfaces:
//   listModifiedFiles(): readonly string[]
//   produceDiff(filePath): DiffReviewOutcome
//   openRange(range): DiffRange
// Tauri invoke is inherently async (Promise-based), so these adapters
// intentionally satisfy the port shapes STRUCTURALLY with async methods
// (Promise returns) instead of `implements`. Web-core is deliberately kept
// sync: it stays browser-drivable and platform-neutral, and each platform
// adapter (browser: sync, Tauri: async) owns its own timing semantics.
// Consumers must await these Tauri adapters.
//
// These adapters contain no hidden domain policy: each is a thin
// extract -> delegate -> response bridge to the native Rust command.
// ---------------------------------------------------------------------------

import { invokeTauri } from "./errors";
import type { DiffRange, DiffReviewOutcome } from "@ide/web-core/ports";

/** Tauri command names backing the git diff-review ports. */
export const GIT_DIFF_REVIEW_COMMANDS = Object.freeze({
  listModifiedFiles: "git_status_modified",
  produceDiff: "git_diff_hunks",
  openRange: "editor_open_range",
} as const);

/**
 * Desktop adapter for WorkspaceChangesPort.
 *
 * Structural async implementation of the sync port: `listModifiedFiles()`
 * delegates to the native `git_status_modified` command, which scans the
 * resolved workspace root (`git status --porcelain=v1`) and returns the
 * modified/added tracked paths. See the ASYNC ADAPTATION NOTICE above.
 */
export class TauriWorkspaceChangesAdapter {
  /** Structural async twin of WorkspaceChangesPort.listModifiedFiles(). */
  async listModifiedFiles(): Promise<readonly string[]> {
    return invokeTauri<string[]>(GIT_DIFF_REVIEW_COMMANDS.listModifiedFiles);
  }
}

/**
 * Desktop adapter for ReadOnlyDiffPort.
 *
 * Structural async implementation of the sync port: `produceDiff(filePath)`
 * delegates to the native `git_diff_hunks` command, which returns an honest
 * `DiffReviewOutcome` — `ok` with a read-only hunk-level diff, or
 * `unavailable` with a reason when the path is not modified/added or git
 * cannot produce hunks. No diff is ever fabricated.
 */
export class TauriReadOnlyDiffAdapter {
  /** Structural async twin of ReadOnlyDiffPort.produceDiff(). */
  async produceDiff(filePath: string): Promise<DiffReviewOutcome> {
    return invokeTauri<DiffReviewOutcome>(GIT_DIFF_REVIEW_COMMANDS.produceDiff, { filePath });
  }
}

/**
 * Desktop adapter for EditorOpenRangePort.
 *
 * Structural async implementation of the sync port: `openRange(range)`
 * delegates to the native `editor_open_range` command, which opens the file
 * at the requested line range in the desktop editor and returns the range
 * actually opened. The working tree is never mutated.
 */
export class TauriEditorOpenRangeAdapter {
  /** Structural async twin of EditorOpenRangePort.openRange(). */
  async openRange(range: DiffRange): Promise<DiffRange> {
    return invokeTauri<DiffRange>(GIT_DIFF_REVIEW_COMMANDS.openRange, {
      path: range.path,
      startLine: range.startLine,
      endLine: range.endLine,
    });
  }
}
