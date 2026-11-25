import type { EditorContent, RefactorKitAffectedFile } from "@ide/contracts";
import type { EditorViewModel, FileTreeViewModel } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import type { EditorDocumentCommands } from "./useEditorCommandController";

export interface RefactoringEditorDependencies {
  navigation: {
    reconcileBufferRenames(changes: readonly { oldPath: string; path: string }[]): void;
  };
  editor: Pick<EditorViewModel, "refreshCleanBuffers" | "reconcileMovedCleanBuffer">;
  documents: Pick<EditorDocumentCommands, "queueChange" | "flush" | "notifySaved"> &
    Partial<Pick<EditorDocumentCommands, "closeDocument" | "activate">>;
  fileTree: Pick<FileTreeViewModel, "loadRoot" | "refreshDirectory"> &
    Partial<Pick<FileTreeViewModel, "selectedFilePath" | "selectFile">>;
  refreshProjectModel?(): Promise<void>;
}

/** Read actual post-transformation files; never reconstruct source from a preview or diff. */
export async function reconcileRefactoringEditor(
  dependencies: RefactoringEditorDependencies,
  changes: readonly RefactorKitAffectedFile[],
  isCurrent: () => boolean,
  openPathsToRefresh: readonly string[] = [],
): Promise<string | undefined> {
  if (!isCurrent()) return;
  const paths = [
    ...new Set(
      [
        ...changes.flatMap((file) => (file.previousPath ? [file.path, file.previousPath] : [file.path])),
        ...openPathsToRefresh,
      ],
    ),
  ];
  if (paths.some((path) => !isNormalizedWorkspaceRelativePath(path))) {
    return "RefactorKit returned invalid file paths. Open buffers were retained; compare them with disk before saving.";
  }
  const movedFiles: EditorContent[] = [];
  const movedPaths = new Set<string>();
  const warnings: string[] = [];
  for (const change of changes) {
    if (change.change !== "move" || !change.previousPath || !isCurrent()) continue;
    const closeDocument = dependencies.documents.closeDocument;
    const activate = dependencies.documents.activate;
    if (!closeDocument || !activate) {
      warnings.push(
        `The moved Java tab ${change.previousPath} could not be synchronized at ${change.path}; close and reopen it before continuing.`,
      );
      continue;
    }
    try {
      const moved = await dependencies.editor.reconcileMovedCleanBuffer(
        change.previousPath,
        change.path,
        isCurrent,
      );
      if (!isCurrent()) return;
      if (!moved) continue;
      dependencies.navigation.reconcileBufferRenames([
        { oldPath: change.previousPath, path: change.path },
      ]);
      movedPaths.add(change.previousPath);
      movedPaths.add(change.path);
      if (
        dependencies.fileTree.selectedFilePath === change.previousPath &&
        dependencies.fileTree.selectFile
      )
        dependencies.fileTree.selectFile(change.path);
      try {
        await closeDocument(change.previousPath);
        if (!isCurrent()) return;
        await activate(change.path, moved.content);
        if (!isCurrent()) return;
      } catch {
        if (!isCurrent()) return;
        warnings.push(
          `The moved Java tab ${change.path} was updated, but language synchronization could not be restarted. Reactivate the tab to retry.`,
        );
      }
      movedFiles.push(moved);
    } catch {
      if (!isCurrent()) return;
      warnings.push(
        `The moved Java tab ${change.previousPath} could not be reconciled at ${change.path}; it was retained. Close and reopen it after reviewing the workspace.`,
      );
    }
  }
  if (!isCurrent()) return;
  const { files, warnings: refreshWarnings } = await dependencies.editor.refreshCleanBuffers(
    paths.filter((path) => !movedPaths.has(path)),
    isCurrent,
  );
  if (!isCurrent()) return;
  warnings.push(...refreshWarnings);
  for (const file of [...movedFiles, ...files]) {
    if (!isCurrent()) return;
    try {
      dependencies.documents.queueChange(file.filePath, file.content);
      await dependencies.documents.flush(file.filePath);
      if (!isCurrent()) return;
      await dependencies.documents.notifySaved(file.filePath);
    } catch {
      if (!isCurrent()) return;
      warnings.push(
        `The saved version of ${file.filePath} was loaded, but language synchronization failed. Reactivate the tab to retry.`,
      );
    }
  }
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let count = 0; count < segments.length; count += 1)
      directories.add(segments.slice(0, count).join("/"));
  }
  for (const directory of directories) {
    if (!isCurrent()) return;
    try {
      if (directory === "") await dependencies.fileTree.loadRoot(isCurrent);
      else await dependencies.fileTree.refreshDirectory(directory, isCurrent);
    } catch {
      if (!isCurrent()) return;
      warnings.push(
        "Some file explorer entries could not be refreshed. Refresh the explorer to retry.",
      );
    }
  }
  if (!isCurrent()) return;
  try {
    await dependencies.refreshProjectModel?.();
  } catch {
    if (!isCurrent()) return;
    warnings.push(
      "The Java project view could not be refreshed. Refresh it before navigating from old results.",
    );
  }
  if (!isCurrent()) return;
  return [...new Set(warnings)].join(" ") || undefined;
}
