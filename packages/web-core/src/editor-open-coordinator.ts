import type { StoreAccessor } from "./state/store-accessor";
import { toGetState } from "./state/store-accessor";

/** State exposed while coordinating one editor-open intent. */
export type EditorOpenState =
  | { status: "idle" }
  | {
      status: "opening";
      intentId: number;
      requestedPath: string;
      startedAt: number;
    }
  | {
      status: "ready";
      intentId: number;
      requestedPath: string;
      activePath: string;
    }
  | {
      status: "error";
      intentId: number;
      requestedPath: string;
      safeMessage: string;
    };

/** The minimal editor behavior needed by {@link EditorOpenCoordinator}. */
export interface EditorOpenTarget {
  openFile(filePath: string): Promise<void>;
  /** Invalidates in-flight opens so their eventual result cannot change editor selection. */
  cancelPendingOpen(): void;
}

/** The minimal editor state inspected after an open. Contents are never retained or published. */
export interface EditorOpenStoreState {
  activeFilePath: string | null;
  contents: Readonly<Record<string, string>>;
}

export type EditorOpenListener = (state: EditorOpenState) => void;

export interface EditorOpenCoordinatorOptions {
  /** Injectable clock source for the opening timestamp. */
  now?: () => number;
}

export const EDITOR_OPEN_ERROR_MESSAGE = "Unable to open this file.";
export const EDITOR_OPEN_INVALID_PATH_MESSAGE =
  "The file path must be a normalized workspace-relative path.";

/**
 * Provider-neutral owner of editor-open intent state and stale-result suppression.
 * File contents and adapter errors are deliberately never retained or published.
 */
export class EditorOpenCoordinator {
  private stateValue: EditorOpenState = { status: "idle" };
  private readonly listeners = new Set<EditorOpenListener>();
  private readonly getEditorState: () => EditorOpenStoreState;
  private readonly now: () => number;
  private nextIntentId = 0;
  private activeIntentId: number | null = null;

  constructor(
    private readonly editor: EditorOpenTarget,
    store: StoreAccessor<EditorOpenStoreState>,
    options: EditorOpenCoordinatorOptions = {},
  ) {
    this.getEditorState = toGetState(store);
    this.now = options.now ?? Date.now;
  }

  get state(): EditorOpenState {
    return this.stateValue;
  }

  /**
   * Open a normalized path relative to the current workspace.
   * The opening state is emitted before `EditorOpenTarget.openFile` is invoked.
   */
  open(requestedPath: string): Promise<void> {
    const intentId = ++this.nextIntentId;
    this.activeIntentId = intentId;

    if (!isNormalizedWorkspaceRelativePath(requestedPath)) {
      // An invalid newer request still supersedes any pending valid request.
      this.editor.cancelPendingOpen();
      this.publish({
        status: "error",
        intentId,
        requestedPath,
        safeMessage: EDITOR_OPEN_INVALID_PATH_MESSAGE,
      });
      return Promise.resolve();
    }

    this.publish({
      status: "opening",
      intentId,
      requestedPath,
      startedAt: this.now(),
    });

    // A synchronous listener may have cancelled or replaced this intent.
    if (!this.isCurrent(intentId)) return Promise.resolve();

    // Supersede target-level work as well as coordinator state so an older
    // provider completion cannot change selection behind this state machine.
    this.editor.cancelPendingOpen();
    return this.completeOpen(intentId, requestedPath);
  }

  /** Invalidate pending work and return to idle without waiting for an adapter. */
  cancel(): void {
    this.activeIntentId = null;
    this.editor.cancelPendingOpen();
    this.publish({ status: "idle" });
  }

  /** Clear all coordinator state for a workspace switch. Intent IDs remain monotonic. */
  reset(): void {
    this.cancel();
  }

  /** Subscribe to state changes, receiving the current state immediately. */
  subscribe(listener: EditorOpenListener): () => void {
    listener(this.stateValue);
    this.listeners.add(listener);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private async completeOpen(intentId: number, requestedPath: string): Promise<void> {
    try {
      await this.editor.openFile(requestedPath);
      if (!this.isCurrent(intentId)) return;

      const editorState = this.getEditorState();
      const activePath = editorState.activeFilePath;
      const hasContentBuffer =
        typeof activePath === "string" &&
        activePath.length > 0 &&
        Object.prototype.hasOwnProperty.call(editorState.contents, activePath) &&
        typeof editorState.contents[activePath] === "string";

      if (!hasContentBuffer) {
        this.publishError(intentId, requestedPath);
        return;
      }

      this.publish({ status: "ready", intentId, requestedPath, activePath });
    } catch {
      if (this.isCurrent(intentId)) this.publishError(intentId, requestedPath);
    }
  }

  private publishError(intentId: number, requestedPath: string): void {
    this.publish({
      status: "error",
      intentId,
      requestedPath,
      safeMessage: EDITOR_OPEN_ERROR_MESSAGE,
    });
  }

  private isCurrent(intentId: number): boolean {
    return this.activeIntentId === intentId;
  }

  private publish(state: EditorOpenState): void {
    this.stateValue = state;
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch {
        // Listener failures are isolated and never logged with potentially sensitive context.
      }
    }
  }
}

/** Validate a portable, already-normalized workspace-relative path. */
export function isNormalizedWorkspaceRelativePath(filePath: string): boolean {
  if (filePath.length === 0 || filePath.trim().length === 0) return false;
  if (filePath.includes("\\") || filePath.includes("\0")) return false;
  if (filePath.startsWith("/") || /^[A-Za-z]:\//u.test(filePath)) return false;

  const segments = filePath.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
