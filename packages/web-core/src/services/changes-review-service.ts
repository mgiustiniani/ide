/**
 * Changes-review service for REQ-IDE-GIT-DIFF-REVIEW-001.
 *
 * Production application service that composes the workspace-changes,
 * read-only-diff, and editor-open-range ports. It delegates to the injected
 * ports and resolves their honest outcomes; it never fabricates a diff, a
 * modified-files list, or an opened range.
 */

import { DiffReviewOutcome } from "../ports/workspace-changes-port";
import { ReadOnlyDiffPort } from "../ports/read-only-diff-port";
import { EditorOpenRangePort, RangeOpenOutcome } from "../ports/editor-open-range-port";
import type { DiffRange, WorkspaceChangesPort } from "../ports/workspace-changes-port";

/** Application service: review modified working-tree files and open diff ranges. */
export class ChangesReviewService {
  constructor(
    private readonly changesPort: WorkspaceChangesPort,
    private readonly diffPort: ReadOnlyDiffPort,
    private readonly editorPort: EditorOpenRangePort,
  ) {}

  /** Delegate: which modified/added tracked files exist in the workspace. */
  async listModifiedFiles(): Promise<readonly string[]> {
    return this.changesPort.listModifiedFiles();
  }

  /** Delegate: produce a read-only hunk-level diff review for one path. */
  async produceReview(filePath: string): Promise<DiffReviewOutcome> {
    return this.diffPort.produceDiff(filePath);
  }

  /** Delegate: open a diff range in the editor. */
  async activateRange(range: DiffRange): Promise<RangeOpenOutcome> {
    return this.editorPort.openRange(range);
  }
}
