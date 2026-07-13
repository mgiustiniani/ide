import type { EditorTab, FileNode, OpenFile } from "@ide/contracts";
import {
  EDITOR_OPEN_ERROR_MESSAGE,
  EditorOpenCoordinator,
  isNormalizedWorkspaceRelativePath,
  type EditorOpenState,
  type EditorOpenStoreState,
} from "@ide/web-core/editor-open-coordinator";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type EditorDiagnostic = {
  filePath: string;
  message: string;
};

export interface DesktopEditorStoreState extends EditorOpenStoreState {
  contents: Record<string, string>;
  openFiles: OpenFile[];
  tabs: EditorTab[];
}

export interface DesktopEditorViewModel {
  openFile(filePath: string): Promise<void>;
  cancelPendingOpen(): void;
  restoreSession(): Promise<void>;
  switchActiveFile(filePath: string): void;
}

export interface DesktopFileTreeViewModel {
  selectFile(filePath: string): void;
  createFile(parentPath: string, name: string): Promise<string>;
  subscribeToFileSelection(): () => void;
}

export type DesktopEditorWorkspaceContext = {
  generation: number;
  workspaceId: string | null;
  isSwitching: boolean;
  isMetadataLoading: boolean;
};

export interface DesktopEditorControllerDependencies {
  editorViewModel: DesktopEditorViewModel;
  fileTreeViewModel: DesktopFileTreeViewModel;
  getEditorState: () => DesktopEditorStoreState;
  getWorkspaceContext: () => DesktopEditorWorkspaceContext;
  clearFileTreeSelection: () => void;
  resetEditorBuffers: () => void;
}

export type DesktopEditorPresentation = {
  openState: EditorOpenState;
  diagnostic: EditorDiagnostic | null;
  readyActiveFilePath: string | null;
  activeContent: string;
  activeLanguage: string;
  openingFilePath: string | null;
  editorFilePath: string;
  isEditorLoading: boolean;
  isEmpty: boolean;
};

const WORKSPACE_SWITCH_CREATE_MESSAGE =
  "Wait for the workspace switch to finish before creating a file.";
const WORKSPACE_CHANGED_CREATE_MESSAGE = "The workspace changed while the file was being created.";
const NO_WORKSPACE_CREATE_MESSAGE = "No active workspace is available.";
const SAFE_DIAGNOSTIC_PATH = "Selected file";

function hasReadyBuffer(state: DesktopEditorStoreState, filePath: string): boolean {
  return (
    state.activeFilePath === filePath &&
    state.tabs.some((tab) => tab.filePath === filePath) &&
    Object.prototype.hasOwnProperty.call(state.contents, filePath) &&
    typeof state.contents[filePath] === "string"
  );
}

function diagnosticFor(state: EditorOpenState): EditorDiagnostic | null {
  if (state.status !== "error") return null;
  return {
    filePath: isNormalizedWorkspaceRelativePath(state.requestedPath)
      ? state.requestedPath
      : SAFE_DIAGNOSTIC_PATH,
    message: state.safeMessage,
  };
}

/**
 * Desktop application-layer orchestration around the provider-neutral open coordinator.
 * It contains no native imports and keeps adapter failures out of presentation state.
 */
export class DesktopEditorController {
  readonly coordinator: EditorOpenCoordinator;
  private restoreSequence = 0;

  constructor(private readonly dependencies: DesktopEditorControllerDependencies) {
    this.coordinator = new EditorOpenCoordinator(
      dependencies.editorViewModel,
      dependencies.getEditorState,
    );
  }

  get state(): EditorOpenState {
    return this.coordinator.state;
  }

  subscribe(listener: (state: EditorOpenState) => void): () => void {
    return this.coordinator.subscribe(listener);
  }

  async selectTreeFile(node: FileNode): Promise<boolean> {
    if (node.type !== "file") return false;
    return this.openPath(node.path);
  }

  async openPath(filePath: string): Promise<boolean> {
    this.dependencies.fileTreeViewModel.selectFile(filePath);
    const pending = this.coordinator.open(filePath);
    const startedState = this.coordinator.state;
    await pending;
    const settledState = this.coordinator.state;

    return (
      startedState.status === "opening" &&
      settledState.status === "ready" &&
      settledState.intentId === startedState.intentId
    );
  }

  async createFile(parentPath: string, name: string): Promise<string> {
    const startedWorkspace = this.dependencies.getWorkspaceContext();
    if (startedWorkspace.isSwitching || startedWorkspace.isMetadataLoading) {
      throw new Error(WORKSPACE_SWITCH_CREATE_MESSAGE);
    }
    if (!startedWorkspace.workspaceId) throw new Error(NO_WORKSPACE_CREATE_MESSAGE);

    const createdPath = await this.dependencies.fileTreeViewModel.createFile(parentPath, name);
    this.assertWorkspaceUnchanged(startedWorkspace);

    const opened = await this.openPath(createdPath);
    this.assertWorkspaceUnchanged(startedWorkspace);
    if (!opened) {
      const current = this.coordinator.state;
      throw new Error(current.status === "error" ? current.safeMessage : EDITOR_OPEN_ERROR_MESSAGE);
    }
    return createdPath;
  }

  /** Restore persisted tabs, then re-assert a newer user open if restore clobbered it. */
  async restoreSession(): Promise<void> {
    const restoreSequence = ++this.restoreSequence;
    const workspaceGeneration = this.dependencies.getWorkspaceContext().generation;

    try {
      await this.dependencies.editorViewModel.restoreSession();
    } catch {
      return;
    }

    if (
      restoreSequence !== this.restoreSequence ||
      workspaceGeneration !== this.dependencies.getWorkspaceContext().generation
    ) {
      return;
    }

    const current = this.coordinator.state;
    if (
      current.status === "ready" &&
      !hasReadyBuffer(this.dependencies.getEditorState(), current.activePath)
    ) {
      await this.openPath(current.requestedPath);
    }
  }

  activateTab(filePath: string): void {
    this.coordinator.cancel();
    this.dependencies.editorViewModel.switchActiveFile(filePath);
    this.dependencies.fileTreeViewModel.selectFile(filePath);
  }

  fileClosed(filePath: string): void {
    const current = this.coordinator.state;
    if (
      (current.status === "opening" || current.status === "error") &&
      current.requestedPath === filePath
    ) {
      this.cancel();
    } else if (current.status === "ready" && current.activePath === filePath) {
      this.cancel();
    }
  }

  cancel(): void {
    this.restoreSequence += 1;
    this.coordinator.cancel();
  }

  resetWorkspace(): void {
    this.restoreSequence += 1;
    this.coordinator.reset();
    this.dependencies.clearFileTreeSelection();
    this.dependencies.resetEditorBuffers();
  }

  presentation(editorState: DesktopEditorStoreState): DesktopEditorPresentation {
    const openState = this.coordinator.state;
    const diagnostic = diagnosticFor(openState);
    const openingFilePath = openState.status === "opening" ? openState.requestedPath : null;

    let readyActiveFilePath: string | null = null;
    if (openState.status === "ready" && hasReadyBuffer(editorState, openState.activePath)) {
      readyActiveFilePath = openState.activePath;
    } else if (openState.status === "idle") {
      const activePath = editorState.activeFilePath;
      if (activePath && hasReadyBuffer(editorState, activePath)) readyActiveFilePath = activePath;
    }

    const activeContent = readyActiveFilePath
      ? (editorState.contents[readyActiveFilePath] ?? "")
      : "";
    const activeLanguage = readyActiveFilePath
      ? (editorState.openFiles.find((file) => file.filePath === readyActiveFilePath)?.language ??
        "plaintext")
      : "plaintext";
    const editorFilePath = readyActiveFilePath ?? openingFilePath ?? "";

    return {
      openState,
      diagnostic,
      readyActiveFilePath,
      activeContent,
      activeLanguage,
      openingFilePath,
      editorFilePath,
      isEditorLoading: openingFilePath !== null,
      isEmpty: readyActiveFilePath === null && openingFilePath === null,
    };
  }

  private assertWorkspaceUnchanged(startedWorkspace: DesktopEditorWorkspaceContext): void {
    const current = this.dependencies.getWorkspaceContext();
    if (
      current.generation !== startedWorkspace.generation ||
      current.workspaceId !== startedWorkspace.workspaceId ||
      current.isSwitching
    ) {
      throw new Error(WORKSPACE_CHANGED_CREATE_MESSAGE);
    }
  }
}

export interface UseDesktopEditorControllerDependencies extends DesktopEditorControllerDependencies {
  editorState: DesktopEditorStoreState;
  /** Desktop composition restores persisted workspace state only after root authorization. */
  deferSessionRestore?: boolean;
}

export type UseDesktopEditorControllerResult = DesktopEditorPresentation & {
  selectTreeFile(node: FileNode): Promise<boolean>;
  openFileProgrammatically(node: FileNode, rejectOnError?: boolean): Promise<boolean>;
  createFile(parentPath: string, name: string): Promise<string>;
  activateTab(filePath: string): void;
  fileClosed(filePath: string): void;
  cancel(): void;
  resetWorkspace(): void;
  restoreWorkspace(): Promise<void>;
};

export function useDesktopEditorController(
  dependencies: UseDesktopEditorControllerDependencies,
): UseDesktopEditorControllerResult {
  const workspaceContextRef = useRef(dependencies.getWorkspaceContext);
  workspaceContextRef.current = dependencies.getWorkspaceContext;
  const flushOpeningRef = useRef(false);
  const [controller] = useState(
    () =>
      new DesktopEditorController({
        editorViewModel: dependencies.editorViewModel,
        fileTreeViewModel: dependencies.fileTreeViewModel,
        getEditorState: dependencies.getEditorState,
        getWorkspaceContext: () => workspaceContextRef.current(),
        clearFileTreeSelection: dependencies.clearFileTreeSelection,
        resetEditorBuffers: dependencies.resetEditorBuffers,
      }),
  );
  const [openState, setOpenState] = useState<EditorOpenState>(controller.state);
  const [, setRestoreRevision] = useState(0);
  const mountedRef = useRef(true);

  const restoreWorkspace = useCallback(async (): Promise<void> => {
    await controller.restoreSession();
    if (mountedRef.current) setRestoreRevision((revision) => revision + 1);
  }, [controller]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribeOpen = controller.subscribe((state) => {
      if (flushOpeningRef.current && state.status === "opening") {
        flushOpeningRef.current = false;
        flushSync(() => setOpenState(state));
      } else {
        setOpenState(state);
      }
    });
    const unsubscribeSelection = dependencies.fileTreeViewModel.subscribeToFileSelection();
    if (!dependencies.deferSessionRestore) void restoreWorkspace();

    return () => {
      mountedRef.current = false;
      unsubscribeOpen();
      unsubscribeSelection();
      controller.cancel();
    };
  }, [
    controller,
    dependencies.deferSessionRestore,
    dependencies.fileTreeViewModel,
    restoreWorkspace,
  ]);

  const selectTreeFile = useCallback(
    (node: FileNode): Promise<boolean> => {
      if (node.type !== "file") return Promise.resolve(false);
      flushOpeningRef.current = true;
      const pending = controller.selectTreeFile(node);
      flushOpeningRef.current = false;
      return pending;
    },
    [controller],
  );

  const openFileProgrammatically = useCallback(
    async (node: FileNode, rejectOnError = false): Promise<boolean> => {
      if (node.type !== "file") return false;
      const opened = await controller.openPath(node.path);
      if (!opened && rejectOnError) {
        const current = controller.state;
        throw new Error(
          current.status === "error" ? current.safeMessage : EDITOR_OPEN_ERROR_MESSAGE,
        );
      }
      return opened;
    },
    [controller],
  );

  const createFile = useCallback(
    (parentPath: string, name: string) => controller.createFile(parentPath, name),
    [controller],
  );
  const activateTab = useCallback(
    (filePath: string) => controller.activateTab(filePath),
    [controller],
  );
  const fileClosed = useCallback(
    (filePath: string) => controller.fileClosed(filePath),
    [controller],
  );
  const cancel = useCallback(() => controller.cancel(), [controller]);
  const resetWorkspace = useCallback(() => controller.resetWorkspace(), [controller]);

  // openState is read to make coordinator publications observable before deriving from its instance.
  void openState;
  return {
    ...controller.presentation(dependencies.editorState),
    selectTreeFile,
    openFileProgrammatically,
    createFile,
    activateTab,
    fileClosed,
    cancel,
    resetWorkspace,
    restoreWorkspace,
  };
}
