/**
 * Editor-open-range port for REQ-IDE-GIT-DIFF-REVIEW-001.
 *
 * Opens a diff range in the editor. The default implementation is a pure
 * read-only mapping: the requested range is returned unchanged. No working
 * tree is ever mutated and no AI/model call happens here.
 */

import type { DiffRange } from "./workspace-changes-port";

export type { DiffRange } from "./workspace-changes-port";

/** Port: open a file at a diff line range. */
export interface EditorOpenRangePort {
  openRange(range: DiffRange): DiffRange;
}

/**
 * Default reference implementation.
 *
 * Pure mapping: the exact requested range is returned unchanged. This is the
 * honest, read-only behavior of a reference editor driver; platform editor
 * adapters (browser/Tauri) live behind this port and may translate the range
 * into their own editor API.
 */
const defaultEditorOpenRangePort: EditorOpenRangePort = {
  openRange(range: DiffRange): DiffRange {
    return range;
  },
};

export default defaultEditorOpenRangePort;
