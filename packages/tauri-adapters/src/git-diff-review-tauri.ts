// ---------------------------------------------------------------------------
// @ide/tauri-adapters – Tauri git diff-review adapters
// ---------------------------------------------------------------------------
// Desktop implementations of the git diff-review ports behind the
// web-core frontend contracts:
//   TauriWorkspaceChangesAdapter  -> git_status_modified
//   TauriReadOnlyDiffAdapter      -> git_diff_hunks
//   TauriEditorOpenRangeAdapter   -> editor_open_range
//
// ASYNC ADAPTATION NOTICE
// ------------------------
// The web-core ports (WorkspaceChangesPort, ReadOnlyDiffPort,
// EditorOpenRangePort) are async interfaces:
//   listModifiedFiles(): Promise<readonly string[]>
//   produceDiff(filePath): Promise<DiffReviewOutcome>
//   openRange(range): Promise<RangeOpenOutcome>
// Tauri invoke is inherently async (Promise-based), so these adapters are
// true implementations of the async ports — not structural twins. Each
// class carries an `implements` clause and delegates to the native Rust
// command, resolving the port's honest outcome.
//
// These adapters contain no hidden domain policy: each is a thin
// extract -> delegate -> response bridge to the native Rust command.
// ---------------------------------------------------------------------------

import { TauriAdapterError, invokeTauri } from "./errors";
import type {
  DiffRange,
  DiffReviewOutcome,
  EditorOpenRangePort,
  RangeOpenOutcome,
  ReadOnlyDiffPort,
  WorkspaceChangesPort,
} from "@ide/web-core/ports";

/** Native Tauri command names backing the git diff-review ports. */
export const GIT_DIFF_REVIEW_COMMANDS = Object.freeze({
  listModifiedFiles: "git_status_modified",
  produceDiff: "git_diff_hunks",
  openRange: "editor_open_range",
} as const);

/**
 * Desktop adapter for WorkspaceChangesPort.
 *
 * True async implementation of the port: `listModifiedFiles()` delegates
 * to the native `git_status_modified` command and resolves the modified/
 * added tracked paths. See the ASYNC ADAPTATION NOTICE above.
 */
export class TauriWorkspaceChangesAdapter implements WorkspaceChangesPort {
  /** Implements WorkspaceChangesPort.listModifiedFiles(). */
  async listModifiedFiles(): Promise<readonly string[]> {
    return invokeTauri<string[]>(GIT_DIFF_REVIEW_COMMANDS.listModifiedFiles);
  }
}

/**
 * Desktop adapter for ReadOnlyDiffPort.
 *
 * True async implementation of the port: `produceDiff(filePath)` delegates
 * to the native `git_diff_hunks` command and returns the raw
 * `DiffReviewOutcome` unchanged — ok with a read-only hunk-level diff, or
 * unavailable with a reason when the path is not modified/added or git
 * cannot produce hunks. See the ASYNC ADAPTATION NOTICE above.
 */
export class TauriReadOnlyDiffAdapter implements ReadOnlyDiffPort {
  /** Implements ReadOnlyDiffPort.produceDiff(). */
  async produceDiff(filePath: string): Promise<DiffReviewOutcome> {
    return invokeTauri<DiffReviewOutcome>(GIT_DIFF_REVIEW_COMMANDS.produceDiff, { filePath });
  }
}

/** Raw response from the native `editor_open_range` command. */
type NativeOpenRangeResponse = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check: a bare opened range has a string path and numeric lines. */
function isDiffRange(value: unknown): value is DiffRange {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === "string" &&
    typeof value.startLine === "number" &&
    typeof value.endLine === "number"
  );
}

/**
 * Extract the reason from a native unavailable/honest-failure shape.
 *
 * Supports the web-core outcome shape `{ kind: "unavailable", reason }` and
 * Rust enum-variant shapes `{ unavailable: { reason } }` /
 * `{ unavailable: "..." }`. Returns null when the response is not a failure
 * shape, so an ok outcome is never fabricated from an unknown response.
 */
function extractUnavailableReason(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  // Outcome-shaped: { kind: "unavailable", reason }
  if (value.kind === "unavailable" && typeof value.reason === "string") {
    return value.reason;
  }

  // Rust enum-variant shaped: { unavailable: { reason } } | { unavailable: "..." }
  const variant = value.unavailable;
  if (isRecord(variant) && typeof variant.reason === "string") {
    return variant.reason;
  }
  if (typeof variant === "string" && variant.length > 0) {
    return variant;
  }

  return null;
}

/**
 * Desktop adapter for EditorOpenRangePort.
 *
 * True async implementation of the port: `openRange(range)` delegates to
 * the native `editor_open_range` command and wraps the native response as a
 * `RangeOpenOutcome`:
 *
 * - The native command reports the range it ACTUALLY opened as a bare
 *   `DiffRange`; that opened range is wrapped as `{ kind: "ok", opened }`.
 *   The requested identity range is NEVER used as proof of opening.
 * - When the native command reports an unavailable/honest-failure shape, the
 *   reason is returned as `{ kind: "unavailable", reason }`.
 *
 * See the ASYNC ADAPTATION NOTICE above.
 */
export class TauriEditorOpenRangeAdapter implements EditorOpenRangePort {
  /** Implements EditorOpenRangePort.openRange(). */
  async openRange(range: DiffRange): Promise<RangeOpenOutcome> {
    const native = await invokeTauri<NativeOpenRangeResponse>(
      GIT_DIFF_REVIEW_COMMANDS.openRange,
      {
        path: range.path,
        startLine: range.startLine,
        endLine: range.endLine,
      },
    );

    // Success: the native command returned the range it actually opened.
    // Wrap it as the ok outcome; the input `range` is never the opened range.
    if (isDiffRange(native)) {
      return { kind: "ok", opened: native };
    }

    // Honest failure: the native command reported why it could not open.
    const reason = extractUnavailableReason(native);
    if (reason !== null) {
      return { kind: "unavailable", reason };
    }

    // Unexpected native response: never fabricate an ok outcome.
    throw new TauriAdapterError(
      GIT_DIFF_REVIEW_COMMANDS.openRange,
      `unexpected native response; expected an opened DiffRange or an unavailable/failure shape: ${JSON.stringify(native)}`,
    );
  }
}
