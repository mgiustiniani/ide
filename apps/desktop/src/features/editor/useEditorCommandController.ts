import type { EditorTab } from "@ide/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export interface EditorCommandStoreState {
  activeFilePath: string | null;
  tabs: EditorTab[];
  contents: Record<string, string>;
}

export interface EditorCommandViewModel {
  bufferLifetime(filePath: string): symbol | undefined;
  updateContent(filePath: string, value: string): void;
  saveFile(filePath: string): Promise<void>;
  closeFile(filePath: string): Promise<void>;
}

export interface EditorDocumentCommands {
  queueChange(filePath: string, value: string): void;
  flush(filePath: string): Promise<void>;
  notifySaved(filePath: string): Promise<void>;
  closeDocument(filePath: string): Promise<void>;
  activate(filePath: string, text: string): Promise<unknown>;
}

export interface EditorWorkspaceDocumentChange {
  readonly filePath: string;
  readonly before: string;
  readonly after: string;
}

export interface DesktopEditorCommands {
  activateTab(filePath: string): void;
  fileClosed(filePath: string): void;
}

export interface SaveAllOptions {
  /** Persist Java buffers without waiting for an initializing language server. */
  deferJavaLanguageServiceSync?: boolean;
}

export interface UseEditorCommandControllerDependencies {
  activeFilePath: string | null;
  activeContent: string;
  activeReadOnly?: boolean;
  hasJavaContext: boolean;
  workspaceId: string | null;
  workspaceGeneration?: number;
  getEditorState: () => EditorCommandStoreState;
  editor: EditorCommandViewModel;
  desktopEditor: DesktopEditorCommands;
  documents: EditorDocumentCommands;
  checkpointBeforeSave?(): Promise<void>;
  /** Refresh the tree after the first save of a client-managed CreateFile draft. */
  afterNewFileSaved?(filePath: string): Promise<void>;
}

const BUFFER_CHANGED_MESSAGE =
  "The tab was closed or reopened; retry the command on the current buffer.";

function bindBuffer(editor: EditorCommandViewModel, filePath: string) {
  const lifetime = editor.bufferLifetime(filePath);
  const isCurrent = () => lifetime !== undefined && editor.bufferLifetime(filePath) === lifetime;
  return {
    isCurrent,
    requireCurrent() {
      if (!isCurrent()) throw new Error(BUFFER_CHANGED_MESSAGE);
    },
  };
}

/** Coordinates editor buffers, language documents, tab lifecycle, and the save shortcut. */
export function useEditorCommandController({
  activeFilePath,
  activeContent,
  activeReadOnly = false,
  hasJavaContext,
  workspaceId,
  workspaceGeneration = 0,
  getEditorState,
  editor,
  desktopEditor,
  documents,
  checkpointBeforeSave,
  afterNewFileSaved,
}: UseEditorCommandControllerDependencies) {
  const [error, setError] = useState<string | null>(null);
  const currentWorkspace = useRef({ workspaceId, workspaceGeneration });
  const currentReadOnly = useRef(activeReadOnly);
  currentReadOnly.current = activeReadOnly;
  currentWorkspace.current = { workspaceId, workspaceGeneration };
  const lifecycle = useRef({ active: true, epoch: 0 });
  useEffect(() => {
    lifecycle.current.active = true;
    lifecycle.current.epoch += 1;
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.epoch += 1;
    };
  }, []);
  const createRequestGuard = useCallback(() => {
    const epoch = lifecycle.current.epoch;
    return () =>
      lifecycle.current.active &&
      lifecycle.current.epoch === epoch &&
      currentWorkspace.current.workspaceId === workspaceId &&
      currentWorkspace.current.workspaceGeneration === workspaceGeneration;
  }, [workspaceId, workspaceGeneration]);
  const { queueChange, flush, notifySaved, closeDocument, activate } = documents;
  const { activateTab: activateDesktopTab, fileClosed } = desktopEditor;
  const notifyFileSaved = useCallback(
    async (filePath: string, isNewFile: boolean) => {
      await notifySaved(filePath);
      if (isNewFile) await afterNewFileSaved?.(filePath).catch(() => undefined);
    },
    [afterNewFileSaved, notifySaved],
  );
  const scheduleJavaLanguageServiceSync = useCallback(
    (filePath: string, matches: () => boolean) => {
      void notifySaved(filePath).catch((failure: unknown) => {
        if (matches())
          setError("The saved Java file could not be synchronized with the language service.");
        console.error("[EditorCommands] Saved Java file synchronization failed", {
          errorType: failure instanceof Error ? failure.name : typeof failure,
        });
      });
    },
    [notifySaved],
  );

  const changeContent = useCallback(
    (value: string): void => {
      const matches = createRequestGuard();
      if (currentReadOnly.current || !activeFilePath || !matches()) return;
      try {
        editor.updateContent(activeFilePath, value);
        queueChange(activeFilePath, value);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "The editor could not accept this change.",
        );
      }
    },
    [activeFilePath, editor, queueChange, createRequestGuard],
  );

  const changeOpenDocumentContents = useCallback(
    (changes: readonly EditorWorkspaceDocumentChange[]): boolean => {
      const matches = createRequestGuard();
      if (currentReadOnly.current || !matches() || changes.length === 0) return false;
      const state = getEditorState();
      const uniquePaths = new Set(changes.map(({ filePath }) => filePath));
      if (
        uniquePaths.size !== changes.length ||
        !changes.every(({ filePath, before, after }) => {
          const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
          return (
            Boolean(tab) &&
            editor.bufferLifetime(filePath) !== undefined &&
            state.contents[filePath] === before &&
            before !== after
          );
        })
      )
        return false;
      try {
        for (const { filePath, after } of changes) editor.updateContent(filePath, after);
        for (const { filePath, after } of changes) queueChange(filePath, after);
        return matches();
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The editor could not accept the workspace changes.",
        );
        return false;
      }
    },
    [createRequestGuard, editor, getEditorState, queueChange],
  );

  const saveActiveFile = useCallback(async (): Promise<void> => {
    const matches = createRequestGuard();
    if (currentReadOnly.current || !matches()) return;
    const state = getEditorState();
    const filePath = state.activeFilePath;
    if (!filePath) return;

    const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
    if (!tab?.isDirty) return;
    const isNewFile = tab.isNew === true;
    const buffer = bindBuffer(editor, filePath);
    if (!buffer.isCurrent()) return;
    const deferLanguageServiceSync = /\.java$/i.test(filePath);

    setError(null);
    try {
      if (!deferLanguageServiceSync) await flush(filePath);
      if (currentReadOnly.current || !matches()) return;
      buffer.requireCurrent();
      await checkpointBeforeSave?.();
      if (currentReadOnly.current || !matches()) return;
      buffer.requireCurrent();
      await editor.saveFile(filePath);
      if (!matches()) return;
      buffer.requireCurrent();
      const saved = getEditorState().tabs.find((candidate) => candidate.filePath === filePath);
      if (saved && !saved.isDirty) {
        if (deferLanguageServiceSync) {
          if (isNewFile) await afterNewFileSaved?.(filePath).catch(() => undefined);
          scheduleJavaLanguageServiceSync(filePath, matches);
        } else {
          await notifyFileSaved(filePath, isNewFile);
        }
      }
    } catch (error) {
      if (matches())
        setError(
          error instanceof Error && error.message === BUFFER_CHANGED_MESSAGE
            ? BUFFER_CHANGED_MESSAGE
            : "The file could not be saved. Check available disk space and write permissions, or compare with disk if another tool changed it.",
        );
      console.error("[EditorCommands] Active file save failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }, [
    editor,
    flush,
    getEditorState,
    notifyFileSaved,
    afterNewFileSaved,
    scheduleJavaLanguageServiceSync,
    createRequestGuard,
    checkpointBeforeSave,
  ]);

  const closeTab = useCallback(
    async (filePath: string): Promise<void> => {
      const matches = createRequestGuard();
      if (!matches()) return;
      const buffer = bindBuffer(editor, filePath);
      if (!buffer.isCurrent()) return;
      let closingDocument = false;
      try {
        await flush(filePath);
        if (!matches()) return;
        buffer.requireCurrent();
        const isNewFile =
          getEditorState().tabs.find((candidate) => candidate.filePath === filePath)?.isNew ===
          true;
        if (getEditorState().tabs.find((candidate) => candidate.filePath === filePath)?.isDirty) {
          await checkpointBeforeSave?.();
          if (!matches()) return;
          buffer.requireCurrent();
          await editor.saveFile(filePath);
          if (!matches()) return;
          buffer.requireCurrent();
          if (getEditorState().tabs.find((candidate) => candidate.filePath === filePath)?.isDirty) {
            throw new Error("The file changed while saving; save it again before closing.");
          }
          await notifyFileSaved(filePath, isNewFile);
        }
        if (!matches()) return;
        buffer.requireCurrent();
        closingDocument = true;
        await closeDocument(filePath);
        if (!matches()) return;
        buffer.requireCurrent();
        if (getEditorState().tabs.find((candidate) => candidate.filePath === filePath)?.isDirty) {
          throw new Error("The file changed while saving; save it again before closing.");
        }
        await editor.closeFile(filePath);
        if (!matches()) return;
        // Absence is the intended successful close; a new lifetime is not ours to notify.
        if (editor.bufferLifetime(filePath) !== undefined) buffer.requireCurrent();
        fileClosed(filePath);
      } catch (error) {
        if (matches()) {
          const state = getEditorState();
          const text = state.contents[filePath];
          if (
            closingDocument &&
            buffer.isCurrent() &&
            text !== undefined &&
            state.tabs.some((tab) => tab.filePath === filePath)
          ) {
            try {
              await activate(filePath, text);
            } catch {
              /* Preserve the original close refusal and its retained source buffer. */
            }
          }
          if (matches())
            setError(
              error instanceof Error &&
                [
                  "The file changed while saving; save it again before closing.",
                  "The file changed while closing; save it again before closing.",
                  BUFFER_CHANGED_MESSAGE,
                ].includes(error.message)
                ? error.message
                : "The tab could not be closed. Save the file or resolve its disk conflict first.",
            );
        }
        console.error("[EditorCommands] Tab close failed", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    },
    [
      closeDocument,
      editor,
      fileClosed,
      flush,
      getEditorState,
      notifyFileSaved,
      activate,
      createRequestGuard,
      checkpointBeforeSave,
    ],
  );

  const activateTab = useCallback(
    (filePath: string): void => {
      const matches = createRequestGuard();
      if (!matches()) return;
      activateDesktopTab(filePath);
      const text = getEditorState().contents[filePath];
      if (text !== undefined) void activate(filePath, text);
    },
    [activate, activateDesktopTab, getEditorState, createRequestGuard],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveActiveFile]);

  useEffect(() => {
    if (hasJavaContext && activeFilePath) {
      void activate(activeFilePath, activeContent);
    }
  }, [activate, activeContent, activeFilePath, hasJavaContext, workspaceId]);

  const saveAll = useCallback(async (options: SaveAllOptions = {}): Promise<void> => {
    const matches = createRequestGuard();
    if (!matches()) throw new Error("The workspace changed while saving.");
    setError(null);
    const buffers = getEditorState().tabs.map((tab) => ({
      tab,
      binding: bindBuffer(editor, tab.filePath),
    }));
    for (const { tab, binding } of buffers) {
      if (!matches()) throw new Error("The workspace changed while saving.");
      binding.requireCurrent();
      if (!tab.isDirty) continue;
      const deferJavaLanguageServiceSync =
        options.deferJavaLanguageServiceSync && /\.java$/i.test(tab.filePath);
      if (!deferJavaLanguageServiceSync) await flush(tab.filePath);
      if (!matches()) throw new Error("The workspace changed while saving.");
      binding.requireCurrent();
      await checkpointBeforeSave?.();
      if (!matches()) throw new Error("The workspace changed while saving.");
      binding.requireCurrent();
      await editor.saveFile(tab.filePath);
      if (!matches()) throw new Error("The workspace changed while saving.");
      binding.requireCurrent();
      const saved = getEditorState().tabs.find((candidate) => candidate.filePath === tab.filePath);
      if (saved && !saved.isDirty) {
        if (deferJavaLanguageServiceSync) {
          if (tab.isNew) await afterNewFileSaved?.(tab.filePath).catch(() => undefined);
          scheduleJavaLanguageServiceSync(tab.filePath, matches);
        } else {
          await notifyFileSaved(tab.filePath, tab.isNew === true);
        }
      }
    }
    if (!matches()) throw new Error("The workspace changed while saving.");
    for (const { binding } of buffers) binding.requireCurrent();
    if (getEditorState().tabs.some((tab) => tab.isDirty)) {
      throw new Error(
        "Files changed while saving; finish editing and save before starting a Java task.",
      );
    }
  }, [
    editor,
    flush,
    getEditorState,
    notifyFileSaved,
    afterNewFileSaved,
    scheduleJavaLanguageServiceSync,
    createRequestGuard,
    checkpointBeforeSave,
  ]);

  return {
    changeContent,
    changeOpenDocumentContents,
    saveActiveFile,
    saveAll,
    closeTab,
    activateTab,
    error,
    reportError: setError,
  };
}
