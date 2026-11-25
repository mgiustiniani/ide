import type { EditorDiskComparison } from "@ide/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export interface EditorDiskComparisonCommands {
  compareWithDisk(filePath: string): Promise<EditorDiskComparison>;
  useDiskVersion(comparison: EditorDiskComparison): void;
}

export interface EditorDiskComparisonDependencies {
  editor: EditorDiskComparisonCommands;
  synchronizeDocument(path: string): Promise<void>;
  activeFilePath: string | null;
  workspaceId: string | null;
  workspaceGeneration: number;
  reportError(message: string | null): void;
  checkpointBeforeDiscard?(): Promise<void>;
}

/** Read-only inspection and explicit buffer replacement, never a forced disk save. */
export function useEditorDiskComparisonController(dependencies: EditorDiskComparisonDependencies) {
  const {
    editor,
    synchronizeDocument,
    activeFilePath,
    workspaceId,
    workspaceGeneration,
    reportError,
    checkpointBeforeDiscard,
  } = dependencies;
  const [comparison, setComparison] = useState<EditorDiskComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const alive = useRef(true);
  const pendingDiscard = useRef(false);
  const comparisonAuthority = useRef(comparison);
  comparisonAuthority.current = comparison;
  const context = useRef({ workspaceId, workspaceGeneration, activeFilePath, editor });
  context.current = { workspaceId, workspaceGeneration, activeFilePath, editor };
  const matches = useCallback(
    (request: number) =>
      alive.current &&
      request === sequence.current &&
      context.current.editor === editor &&
      context.current.workspaceId === workspaceId &&
      context.current.workspaceGeneration === workspaceGeneration &&
      context.current.activeFilePath === activeFilePath,
    [workspaceId, workspaceGeneration, activeFilePath, editor],
  );

  const cancel = useCallback(() => {
    sequence.current += 1;
    comparisonAuthority.current = null;
    pendingDiscard.current = false;
    setComparison(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    cancel();
    return () => {
      alive.current = false;
      sequence.current += 1;
    };
  }, [cancel, workspaceId, workspaceGeneration, activeFilePath, editor]);

  const compare = useCallback(async () => {
    if (!activeFilePath || pendingDiscard.current || !matches(sequence.current)) return;
    const request = ++sequence.current;
    comparisonAuthority.current = null;
    setComparison(null);
    setBusy(true);
    reportError(null);
    try {
      const result = await editor.compareWithDisk(activeFilePath);
      if (matches(request)) setComparison(result);
    } catch {
      if (matches(request))
        reportError(
          "Could not compare this buffer with disk. Finish saving, check file access and retry; this provider may not support revision-aware comparison.",
        );
    } finally {
      if (matches(request)) setBusy(false);
    }
  }, [activeFilePath, editor, matches, reportError]);

  const useDiskVersion = useCallback(async () => {
    if (!comparison || busy || pendingDiscard.current ||
        comparisonAuthority.current !== comparison || !matches(sequence.current)) return;
    pendingDiscard.current = true;
    const request = ++sequence.current;
    setBusy(true);
    reportError(null);
    let replaced = false;
    try {
      await checkpointBeforeDiscard?.();
      if (!matches(request)) return;
      editor.useDiskVersion(comparison);
      replaced = true;
      comparisonAuthority.current = null;
      setComparison(null);
      pendingDiscard.current = false;
      setBusy(false);
      await synchronizeDocument(comparison.filePath);
    } catch {
      if (matches(request)) {
        reportError(
          replaced
            ? "The disk version was loaded, but language synchronization failed. Reactivate the tab to retry."
            : "The buffer or its save baseline changed. Compare again; no edits were discarded.",
        );
      }
    } finally {
      if (!replaced && matches(request)) {
        pendingDiscard.current = false;
        setBusy(false);
      }
    }
  }, [comparison, busy, editor, synchronizeDocument, matches, reportError, checkpointBeforeDiscard]);

  return { comparison, busy, compare, useDiskVersion, cancel };
}
