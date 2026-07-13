import type { FileNode } from "@ide/contracts";
import { useCallback } from "react";

export interface FileExplorerTreeCommands {
  toggleFolder(filePath: string): Promise<void>;
}

export interface FileExplorerEditorCommands {
  createFile(parentPath: string, name: string): Promise<string>;
}

export interface UseFileExplorerControllerDependencies {
  fileTree: FileExplorerTreeCommands;
  editor: FileExplorerEditorCommands;
  getSelectedDirectoryPath: () => string | null;
}

/** Coordinates explorer folder expansion and empty-editor file creation. */
export function useFileExplorerController({
  fileTree,
  editor,
  getSelectedDirectoryPath,
}: UseFileExplorerControllerDependencies) {
  const toggleFolder = useCallback(
    async (node: FileNode): Promise<void> => {
      if (node.type === "folder") await fileTree.toggleFolder(node.path);
    },
    [fileTree],
  );

  const createFile = useCallback(
    async (name: string): Promise<void> => {
      const parentPath = getSelectedDirectoryPath() ?? "";
      try {
        await editor.createFile(parentPath, name);
      } catch (error) {
        console.error("[App] Empty-editor file creation failed", {
          target: parentPath ? "<selected-directory>" : "<workspace-root>",
          errorType: error instanceof Error ? error.name : typeof error,
        });
        throw error;
      }
    },
    [editor, getSelectedDirectoryPath],
  );

  return { toggleFolder, createFile };
}
