import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EditorBufferReplacement,
  EditorRecoveryDraft,
  EditorRecoveryEntry,
  EditorRecoverySession,
  EditorRecoverySnapshot,
} from "@ide/contracts";
import type { EditorRecoveryPort } from "@ide/web-core/ports";
import type { EditorStoreSlice } from "@ide/web-core/state";
import type { EditorDocumentCommands } from "./useEditorCommandController";

export interface EditorRecoveryDependencies {
  port: EditorRecoveryPort;
  workspaceId: string | null;
  generation: number;
  ready?: boolean;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  store: { getState(): EditorStoreSlice; subscribe(listener: () => void): () => void };
  editor: {
    prepareBufferReplacement(filePath: string, content: string): EditorBufferReplacement;
    replaceBuffer(replacement: EditorBufferReplacement): void;
  };
  documents: Pick<EditorDocumentCommands, "flush" | "activate">;
  openFile(filePath: string): Promise<boolean>;
}
const same = (a: readonly EditorRecoveryDraft[], b: readonly EditorRecoveryDraft[]) =>
  a.length === b.length &&
  a.every(
    (draft, index) =>
      draft.filePath === b[index]?.filePath &&
      draft.content === b[index]?.content &&
      draft.language === b[index]?.language,
  );
const CHECKPOINT_ERROR =
  "Recovery storage is unavailable or full. The newest edits may not have a durable checkpoint; retry after checking storage.";
const INVENTORY_ERROR =
  "Recovery entries could not be loaded. Existing checkpoints were not discarded.";
function capture(store: EditorRecoveryDependencies["store"]): EditorRecoveryDraft[] {
  const state = store.getState();
  return state.tabs
    .filter((tab) => tab.isDirty && typeof state.contents[tab.filePath] === "string")
    .map((tab) => ({
      filePath: tab.filePath,
      content: state.contents[tab.filePath],
      language:
        state.openFiles.find((file) => file.filePath === tab.filePath)?.language ?? "plaintext",
    }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/** Acknowledged, throttled private checkpoints; it never automatically restores or saves files. */
export function useEditorRecoveryController(dependencies: EditorRecoveryDependencies) {
  const { port, workspaceId, generation, store } = dependencies;
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const [status, setStatus] = useState<"loading" | "pending" | "saving" | "ready" | "error">(
    "loading",
  );
  const [entries, setEntries] = useState<readonly EditorRecoveryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    snapshot: EditorRecoverySnapshot;
    replacement: EditorBufferReplacement | null;
  } | null>(null);
  const session = useRef<EditorRecoverySession | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const reviewSequence = useRef(0);
  const current = useCallback((binding: EditorRecoverySession) => {
    const context = latest.current.getContext();
    return (
      session.current === binding &&
      context.workspaceId === binding.workspaceId &&
      context.generation === binding.generation &&
      !context.isSwitching
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let binding: EditorRecoverySession | null = null;
    let writing: Promise<void> | null = null;
    let acknowledged: EditorRecoveryDraft[] = [];
    let checkpointFailed = false;
    let inventoryFailed = false;
    const matches = () => !cancelled && binding !== null && current(binding);
    setStatus("loading");
    setEntries([]);
    setReview(null);
    setError(null);
    session.current = null;
    reviewSequence.current += 1;

    const settle = () => {
      if (!matches() || writing) return;
      const durable = same(capture(store), acknowledged);
      if (checkpointFailed && !durable) {
        setStatus("error");
        setError(CHECKPOINT_ERROR);
      } else if (inventoryFailed) {
        setStatus("error");
        setError(INVENTORY_ERROR);
      } else {
        checkpointFailed = false;
        setError(null);
        setStatus(durable ? "ready" : "pending");
        if (!durable) schedule();
      }
    };
    const refresh = async () => {
      if (!matches() || !binding) return;
      try {
        const inventory = await port.list(binding);
        if (matches()) {
          inventoryFailed = false;
          setEntries(inventory);
        }
      } catch {
        if (matches()) inventoryFailed = true;
      }
      settle();
    };
    const persist = async (): Promise<void> => {
      if (writing) {
        await writing;
        return persist();
      }
      if (!matches() || !binding) return;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      const drafts = capture(store);
      if (same(drafts, acknowledged)) {
        // A repaired journal must be revalidated even when there is nothing new to write.
        if (checkpointFailed || inventoryFailed) await refresh();
        return;
      }
      const owner = binding;
      setStatus("saving");
      setError(null);
      writing = (async () => {
        try {
          await port.checkpoint(owner, drafts);
          if (!matches()) return;
          acknowledged = drafts;
          checkpointFailed = false;
          await refresh();
        } catch {
          if (matches()) checkpointFailed = true;
        }
      })();
      await writing;
      writing = null;
      settle();
    };
    const schedule = () => {
      if (!matches() || same(capture(store), acknowledged)) return;
      setStatus("pending");
      // Fixed delay, not restart-on-each-keystroke: continuous typing is checkpointed too.
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          void persist();
        }, 750);
    };
    flushRef.current = persist;
    refreshRef.current = refresh;
    const unsubscribe = store.subscribe(schedule);
    if (workspaceId) {
      void port
        .start({ workspaceId, generation })
        .then(async (started) => {
          binding = started;
          if (cancelled) {
            await port.stop(started).catch(() => undefined);
            return;
          }
          session.current = started;
          await refresh();
          if (matches()) schedule();
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("error");
            setError(
              "Recovery is unavailable for this workspace. Current edits have not been checkpointed.",
            );
          }
        });
    }
    return () => {
      cancelled = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      reviewSequence.current += 1;
      if (session.current === binding) session.current = null;
      if (binding) void port.stop(binding).catch(() => undefined);
    };
  }, [port, workspaceId, generation, store, current]);

  const flush = useCallback(async () => {
    await flushRef.current();
  }, []);
  const refresh = useCallback(async () => {
    await refreshRef.current();
  }, []);

  useEffect(() => {
    if (dependencies.ready !== false) {
      void refresh().then(() => {
        void flush();
      });
    }
  }, [dependencies.ready, workspaceId, generation, refresh, flush]);

  const prepareReview = useCallback(
    async (entry: EditorRecoveryEntry) => {
      const binding = session.current;
      const request = ++reviewSequence.current;
      if (!binding || !current(binding)) return;
      setError(null);
      setReview(null);
      try {
        const snapshot = await port.read(binding, entry.id);
        if (!current(binding) || request !== reviewSequence.current) return;
        const opened = await latest.current.openFile(snapshot.filePath);
        if (!current(binding) || request !== reviewSequence.current) return;
        const replacement = opened
          ? latest.current.editor.prepareBufferReplacement(snapshot.filePath, snapshot.content)
          : null;
        setReview({ snapshot, replacement });
        if (!opened)
          setError(
            "The source file cannot be opened. The checkpoint is retained for copying; automatic file recreation is not supported.",
          );
      } catch {
        if (current(binding) && request === reviewSequence.current)
          setError(
            "The checkpoint could not be reviewed. Check file access and finish pending saves; no edits were replaced.",
          );
      }
    },
    [port, current],
  );
  const cancelReview = useCallback(() => {
    reviewSequence.current += 1;
    setReview(null);
  }, []);
  const restore = useCallback(async () => {
    const binding = session.current;
    const request = ++reviewSequence.current;
    if (!binding || !current(binding) || !review?.replacement) return;
    let replaced = false;
    try {
      await latest.current.documents.flush(review.replacement.filePath);
      if (!current(binding) || request !== reviewSequence.current) return;
      await flush();
      if (!current(binding) || request !== reviewSequence.current) return;
      latest.current.editor.replaceBuffer(review.replacement);
      replaced = true;
      setReview(null);
      await latest.current.documents.activate(
        review.replacement.filePath,
        review.replacement.after,
      );
      // Preserve the old checkpoint until a separate explicit removal; a crash cannot erase it here.
      if (current(binding)) await flush();
    } catch {
      if (current(binding))
        setError(
          replaced
            ? "The buffer was recovered, but language synchronization failed. It remains unsaved; reactivate the tab."
            : "The reviewed buffer changed. Review again; no edits were replaced.",
        );
    }
  }, [review, current, flush]);
  const remove = useCallback(
    async (entry: EditorRecoveryEntry) => {
      const binding = session.current;
      if (!binding || !current(binding) || (entry.kind === "draft" && entry.currentSession)) return;
      try {
        await port.remove(binding, entry.id);
        if (current(binding)) await refresh();
      } catch {
        if (current(binding))
          setError("The checkpoint could not be removed. It was not reported as discarded.");
      }
    },
    [port, current, refresh],
  );

  return {
    status,
    error,
    entries,
    review,
    flush,
    refresh,
    prepareReview,
    cancelReview,
    restore,
    remove,
  };
}
export type EditorRecoveryController = ReturnType<typeof useEditorRecoveryController>;
