/**
 * Editor-open-range port for REQ-IDE-GIT-DIFF-REVIEW-002.
 *
 * Opens a diff range in the editor. The port delegates to an injected
 * platform editor driver and resolves an honest outcome: `ok` with the range
 * actually opened, or `unavailable` with a reason when no driver can open
 * the range. The port NEVER returns the identity range as proof of opening.
 */

import type { DiffRange } from "./workspace-changes-port";

export type { DiffRange } from "./workspace-changes-port";

/** Honest outcome of an editor range-open request. */
export type RangeOpenOutcome =
  | { readonly kind: "ok"; readonly opened: DiffRange }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Injected seam: the platform editor driver that actually opens ranges. */
export interface EditorOpenRangeDriver {
  openRange(range: DiffRange): RangeOpenOutcome;
}

/** Port: open a diff range in the editor. Promise-based for async platform adapters. */
export interface EditorOpenRangePort {
  openRange(range: DiffRange): Promise<RangeOpenOutcome>;
}

/**
 * Default port implementation.
 *
 * Delegates to the injected editor driver (constructor param) and resolves
 * the driver's honest outcome. When no driver is provided, opening resolves
 * as unavailable with a clear reason — never an identity shortcut.
 */
export class DefaultEditorOpenRangePort implements EditorOpenRangePort {
  constructor(private readonly driver?: EditorOpenRangeDriver) {}

  async openRange(range: DiffRange): Promise<RangeOpenOutcome> {
    if (this.driver === undefined) {
      return {
        kind: "unavailable",
        reason: "no editor-open-range driver is injected; no range was opened",
      };
    }
    return this.driver.openRange(range);
  }
}

/**
 * Default export for the story harness: an un-driven port that is honest.
 * Consumers that need real opening must inject an {@link EditorOpenRangeDriver}.
 */
const defaultEditorOpenRangePort: EditorOpenRangePort = new DefaultEditorOpenRangePort();

export default defaultEditorOpenRangePort;
