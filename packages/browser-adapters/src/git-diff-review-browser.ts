// ---------------------------------------------------------------------------
// packages/browser-adapters/src/git-diff-review-browser.ts
// Browser-safe adapters for REQ-IDE-GIT-DIFF-REVIEW-001.
//
// The web-only browser client CANNOT run git: it has no working-tree access.
// These adapters are an honest boundary (anti-fake) — they never fabricate a
// diff, an opened range, or a hard-coded "ok" response. Browser diff
// implementations stay behind the frontend ports and never import
// @tauri-apps/api.
// ---------------------------------------------------------------------------

import type {
  DiffRange,
  DiffReviewOutcome,
  EditorOpenRangePort,
  ReadOnlyDiffPort,
  WorkspaceChangesPort,
} from "@ide/web-core/ports";

/** Platform reason documented by every browser git diff-review adapter. */
export const GIT_STATUS_DESKTOP_ONLY_REASON =
  "git status is desktop-only; browser clients have no working-tree access";

/** Honest browser boundary: the web client has no working-tree git access. */
export class BrowserWorkspaceChangesAdapter implements WorkspaceChangesPort {
  listModifiedFiles(): readonly string[] {
    // Platform reason: git status is desktop-only; browser clients have no
    // working-tree access, so there is never a modified-files list to show.
    return [];
  }
}

/** Honest browser boundary: diffs are never fabricated; always unavailable. */
export class BrowserReadOnlyDiffAdapter implements ReadOnlyDiffPort {
  produceDiff(_filePath: string): DiffReviewOutcome {
    return {
      kind: "unavailable",
      reason: GIT_STATUS_DESKTOP_ONLY_REASON,
    };
  }
}

/** Pure read-only mapping: the exact requested range is returned unchanged. */
export class BrowserEditorOpenRangeAdapter implements EditorOpenRangePort {
  openRange(range: DiffRange): DiffRange {
    return range;
  }
}
