import type { EditorTab } from "@ide/contracts";
import { useCallback, useEffect } from "react";

export interface EditorCommandStoreState {
  activeFilePath: string | null;
  tabs: EditorTab[];
  contents: Record<string, string>;
}

export interface EditorCommandViewModel {
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

export interface DesktopEditorCommands {
  activateTab(filePath: string): void;
  fileClosed(filePath: string): void;
}

export interface UseEditorCommandControllerDependencies {
  activeFilePath: string | null;
  activeContent: string;
  hasJavaContext: boolean;
  workspaceId: string | null;
  getEditorState: () => EditorCommandStoreState;
  editor: EditorCommandViewModel;
  desktopEditor: DesktopEditorCommands;
  documents: EditorDocumentCommands;
}

/** Coordinates editor buffers, language documents, tab lifecycle, and the save shortcut. */
export function useEditorCommandController({
  activeFilePath,
  activeContent,
  hasJavaContext,
  workspaceId,
  getEditorState,
  editor,
  desktopEditor,
  documents,
}: UseEditorCommandControllerDependencies) {
  const { queueChange, flush, notifySaved, closeDocument, activate } = documents;
  const { activateTab: activateDesktopTab, fileClosed } = desktopEditor;

  const changeContent = useCallback(
    (value: string): void => {
      if (!activeFilePath) return;
      editor.updateContent(activeFilePath, value);
      queueChange(activeFilePath, value);
    },
    [activeFilePath, editor, queueChange],
  );

  const saveActiveFile = useCallback(async (): Promise<void> => {
    const state = getEditorState();
    const filePath = state.activeFilePath;
    if (!filePath) return;

    const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
    if (!tab?.isDirty) return;

    try {
      await flush(filePath);
      await editor.saveFile(filePath);
      await notifySaved(filePath);
    } catch (error) {
      console.error("[EditorCommands] Active file save failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }, [editor, flush, getEditorState, notifySaved]);

  const closeTab = useCallback(
    async (filePath: string): Promise<void> => {
      const tab = getEditorState().tabs.find((candidate) => candidate.filePath === filePath);

      try {
        await flush(filePath);
        if (tab?.isDirty) {
          await editor.saveFile(filePath);
          await notifySaved(filePath);
        }
        await closeDocument(filePath);
        await editor.closeFile(filePath);
        fileClosed(filePath);
      } catch (error) {
        console.error("[EditorCommands] Tab close failed", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    },
    [closeDocument, editor, fileClosed, flush, getEditorState, notifySaved],
  );

  const activateTab = useCallback(
    (filePath: string): void => {
      activateDesktopTab(filePath);
      const text = getEditorState().contents[filePath];
      if (text !== undefined) void activate(filePath, text);
    },
    [activate, activateDesktopTab, getEditorState],
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

  return { changeContent, saveActiveFile, closeTab, activateTab };
}
