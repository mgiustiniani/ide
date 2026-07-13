import type { ApplyRefactorKitPlanResult, FileNode, RefactorKitPatchPlan } from "@ide/contracts";
import {
  PasteExternalJavaClass,
  type ClipboardPort,
  type PasteExternalJavaClassSelection,
  type PasteExternalJavaClassState,
  type RefactorKitPort,
} from "@ide/web-core";
import { useCallback, useEffect, useRef, useState } from "react";

export type RefactorKitImportDialogState = {
  status: "loading" | "unavailable" | "refused" | "preview" | "applying" | "applied" | "error";
  targetDirectory: string;
  selection: PasteExternalJavaClassSelection;
  plan: RefactorKitPatchPlan | null;
  result: ApplyRefactorKitPlanResult | null;
  message?: string;
};

export const REFACTOR_KIT_IMPORT_UNAVAILABLE =
  "Update RefactorKit to a version that supports path-driven external Java import.";

export interface RefactorKitImportFileTree {
  refreshDirectory(path: string): Promise<void>;
  loadRoot(): Promise<void>;
}

export interface UseRefactorKitImportControllerDependencies {
  clipboard: ClipboardPort;
  refactorKit: RefactorKitPort;
  fileTree: RefactorKitImportFileTree;
  workspaceId: string | null;
  /** Uses the application workspace authority when supplied; standalone consumers keep a local generation. */
  getWorkspaceGeneration?: () => number;
  openResultFile(node: FileNode): Promise<unknown>;
}

export interface RefactorKitImportController {
  selectedDirectoryPath: string | null;
  focusedDirectoryPath: string | null;
  dialog: RefactorKitImportDialogState | null;
  successMessage: string | null;
  selectDirectory(node: FileNode): void;
  focusDirectory(node: FileNode): void;
  previewFromClipboard(directoryNode: FileNode): Promise<void>;
  applyDisplayedPlan(displayedPlan: RefactorKitPatchPlan): Promise<void>;
  cancel(): void;
  resetWorkspace(): void;
  getSelectedDirectoryPath(): string | null;
}

function parentDirectory(path: string): string | null {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? null : path.slice(0, separator);
}

/**
 * Desktop application orchestration for the capability-gated RefactorKit import flow.
 * Pure preview/apply policy remains in PasteExternalJavaClass; native access is injected.
 */
export function useRefactorKitImportController(
  dependencies: UseRefactorKitImportControllerDependencies,
): RefactorKitImportController {
  const workspaceIdRef = useRef(dependencies.workspaceId);
  workspaceIdRef.current = dependencies.workspaceId;
  const openResultFileRef = useRef(dependencies.openResultFile);
  openResultFileRef.current = dependencies.openResultFile;
  const workspaceGenerationAuthorityRef = useRef(dependencies.getWorkspaceGeneration);
  workspaceGenerationAuthorityRef.current = dependencies.getWorkspaceGeneration;

  const [workflow] = useState(
    () => new PasteExternalJavaClass(dependencies.clipboard, dependencies.refactorKit),
  );
  const localWorkspaceGenerationRef = useRef(1);
  const currentWorkspaceGeneration = useCallback(
    () => workspaceGenerationAuthorityRef.current?.() ?? localWorkspaceGenerationRef.current,
    [],
  );
  const selectionGenerationRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const operationRef = useRef(0);
  const selectedDirectoryPathRef = useRef<string | null>(null);

  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState<string | null>(null);
  const [focusedDirectoryPath, setFocusedDirectoryPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RefactorKitImportDialogState | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const invalidate = useCallback(
    (closeDialog: boolean) => {
      operationRef.current += 1;
      workflow.cancel();
      if (closeDialog) setDialog(null);
    },
    [workflow],
  );

  const selectDirectory = useCallback(
    (node: FileNode) => {
      if (node.type !== "folder" || selectedDirectoryPathRef.current === node.path) return;
      selectedDirectoryPathRef.current = node.path;
      selectionGenerationRef.current += 1;
      setSelectedDirectoryPath(node.path);
      invalidate(true);
    },
    [invalidate],
  );

  const focusDirectory = useCallback((node: FileNode) => {
    if (node.type === "folder") setFocusedDirectoryPath(node.path);
  }, []);

  const previewFromClipboard = useCallback(
    async (directoryNode: FileNode): Promise<void> => {
      if (directoryNode.type !== "folder") return;

      if (selectedDirectoryPathRef.current !== directoryNode.path) {
        selectedDirectoryPathRef.current = directoryNode.path;
        selectionGenerationRef.current += 1;
        setSelectedDirectoryPath(directoryNode.path);
        invalidate(true);
      }

      const workspaceId = workspaceIdRef.current;
      if (!workspaceId || selectedDirectoryPathRef.current !== directoryNode.path) return;

      const selection: PasteExternalJavaClassSelection = {
        targetDirectory: directoryNode.path,
        workspaceId,
        workspaceGeneration: currentWorkspaceGeneration(),
        selectionGeneration: selectionGenerationRef.current,
        requestId: `desktop-paste-java-${++requestSequenceRef.current}`,
      };
      const operation = ++operationRef.current;
      setSuccessMessage(null);
      setDialog({
        status: "loading",
        targetDirectory: directoryNode.path,
        selection,
        plan: null,
        result: null,
      });

      const state: PasteExternalJavaClassState = await workflow.preview(selection);
      const workspaceGenerationChanged =
        currentWorkspaceGeneration() !== selection.workspaceGeneration;
      if (
        operationRef.current !== operation ||
        selectedDirectoryPathRef.current !== selection.targetDirectory ||
        selectionGenerationRef.current !== selection.selectionGeneration ||
        workspaceGenerationChanged
      ) {
        if (operationRef.current === operation && workspaceGenerationChanged) {
          invalidate(true);
        }
        return;
      }

      if (state.status === "preview") {
        setDialog({
          status: "preview",
          targetDirectory: selection.targetDirectory,
          selection,
          plan: state.plan,
          result: null,
        });
      } else if (state.status === "refused") {
        setDialog({
          status: state.kind === "plan-error" ? "error" : "refused",
          targetDirectory: selection.targetDirectory,
          selection,
          plan: state.plan ?? null,
          result: null,
          message: state.reasons.join(" "),
        });
      } else {
        setDialog({
          status: "unavailable",
          targetDirectory: selection.targetDirectory,
          selection,
          plan: null,
          result: null,
          message: REFACTOR_KIT_IMPORT_UNAVAILABLE,
        });
      }
    },
    [currentWorkspaceGeneration, invalidate, workflow],
  );

  const applyDisplayedPlan = useCallback(
    async (displayedPlan: RefactorKitPatchPlan): Promise<void> => {
      const currentDialog = dialog;
      if (
        !currentDialog ||
        currentDialog.status !== "preview" ||
        currentDialog.plan?.status !== "ready" ||
        displayedPlan.planId !== currentDialog.plan.planId ||
        selectedDirectoryPathRef.current !== currentDialog.selection.targetDirectory ||
        selectionGenerationRef.current !== currentDialog.selection.selectionGeneration ||
        currentWorkspaceGeneration() !== currentDialog.selection.workspaceGeneration
      ) {
        return;
      }

      const operation = ++operationRef.current;
      setDialog({ ...currentDialog, status: "applying" });
      const state = await workflow.apply({
        workspaceId: currentDialog.selection.workspaceId,
        workspaceGeneration: currentDialog.selection.workspaceGeneration,
        selectionGeneration: currentDialog.selection.selectionGeneration,
        requestId: currentDialog.selection.requestId,
        approval: {
          approvalId: `desktop-approval-${currentDialog.selection.requestId}`,
          approvedPlanId: currentDialog.plan.planId,
          approvedAt: new Date().toISOString(),
        },
      });

      const workspaceGenerationChanged =
        currentWorkspaceGeneration() !== currentDialog.selection.workspaceGeneration;
      if (
        operationRef.current !== operation ||
        selectedDirectoryPathRef.current !== currentDialog.selection.targetDirectory ||
        selectionGenerationRef.current !== currentDialog.selection.selectionGeneration ||
        workspaceGenerationChanged
      ) {
        if (operationRef.current === operation && workspaceGenerationChanged) {
          invalidate(true);
        }
        return;
      }

      if (state.status !== "applied") {
        setDialog({
          ...currentDialog,
          status: state.status === "refused" && state.kind === "plan-error" ? "error" : "refused",
          plan: state.status === "refused" ? (state.plan ?? null) : null,
          message: state.status === "refused" ? state.reasons.join(" ") : undefined,
        });
        return;
      }

      setDialog({ ...currentDialog, status: "applied", result: state.result });
      setSuccessMessage(
        `Java import applied successfully. Transaction ${state.result.transactionId}.`,
      );

      const parentPaths = new Set<string>();
      let requiresRootRefresh = false;
      for (const file of state.result.changedFiles) {
        for (const path of [file.path, file.previousPath]) {
          if (!path) continue;
          const parent = parentDirectory(path);
          if (parent === null || parent.length === 0) requiresRootRefresh = true;
          else parentPaths.add(parent);
        }
      }
      try {
        await Promise.all(
          [...parentPaths].map((path) => dependencies.fileTree.refreshDirectory(path)),
        );
        if (requiresRootRefresh) await dependencies.fileTree.loadRoot();
      } catch {
        await dependencies.fileTree.loadRoot().catch(() => undefined);
      }

      if (operationRef.current !== operation) return;
      const primaryFile =
        state.result.primaryFile ??
        state.result.changedFiles.find((file) => file.primary)?.path ??
        null;
      if (primaryFile) {
        await openResultFileRef.current({
          id: primaryFile,
          name: primaryFile,
          path: primaryFile,
          type: "file",
        });
      }
    },
    [currentWorkspaceGeneration, dependencies.fileTree, dialog, invalidate, workflow],
  );

  const cancel = useCallback(() => invalidate(true), [invalidate]);

  const resetWorkspace = useCallback(() => {
    invalidate(true);
    if (!workspaceGenerationAuthorityRef.current) {
      localWorkspaceGenerationRef.current += 1;
    }
    selectionGenerationRef.current += 1;
    selectedDirectoryPathRef.current = null;
    setSelectedDirectoryPath(null);
    setFocusedDirectoryPath(null);
    setSuccessMessage(null);
  }, [invalidate]);

  const getSelectedDirectoryPath = useCallback(() => selectedDirectoryPathRef.current, []);

  useEffect(
    () => () => {
      invalidate(false);
    },
    [invalidate],
  );

  return {
    selectedDirectoryPath,
    focusedDirectoryPath,
    dialog,
    successMessage,
    selectDirectory,
    focusDirectory,
    previewFromClipboard,
    applyDisplayedPlan,
    cancel,
    resetWorkspace,
    getSelectedDirectoryPath,
  };
}
