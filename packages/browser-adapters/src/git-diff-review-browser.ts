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
  EditorOpenRangeDriver,
  EditorOpenRangePort,
  RangeOpenOutcome,
  ReadOnlyDiffPort,
  WorkspaceChangesPort,
} from "@ide/web-core/ports";

/** Platform reason documented by every browser git diff-review adapter. */
export const GIT_STATUS_DESKTOP_ONLY_REASON =
  "git status is desktop-only; browser clients have no working-tree access";

/** Honest browser boundary: the web client has no working-tree git access. */
export class BrowserWorkspaceChangesAdapter implements WorkspaceChangesPort {
  async listModifiedFiles(): Promise<readonly string[]> {
    // Platform reason: git status is desktop-only; browser clients have no
    // working-tree access, so there is never a modified-files list to show.
    return [];
  }
}

/** Honest browser boundary: diffs are never fabricated; always unavailable. */
export class BrowserReadOnlyDiffAdapter implements ReadOnlyDiffPort {
  async produceDiff(_filePath: string): Promise<DiffReviewOutcome> {
    return {
      kind: "unavailable",
      reason: GIT_STATUS_DESKTOP_ONLY_REASON,
    };
  }
}

/**
 * Honest browser boundary for opening a diff range.
 *
 * Delegates to an injected platform editor driver and returns the driver's
 * honest outcome. When no driver is provided, the browser client has no
 * editor to open ranges in, so the outcome is `unavailable` with a clear
 * reason. It NEVER returns the identity range as proof of opening.
 */
export class BrowserEditorOpenRangeAdapter implements EditorOpenRangePort {
  constructor(private readonly driver?: EditorOpenRangeDriver) {}

  async openRange(range: DiffRange): Promise<RangeOpenOutcome> {
    if (this.driver === undefined) {
      return {
        kind: "unavailable",
        reason: "no editor-open-range driver is injected; browser clients have no editor to open ranges in",
      };
    }
    return this.driver.openRange(range);
  }
}
