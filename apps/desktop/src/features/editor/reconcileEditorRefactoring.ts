import type { FileTreeViewModel, JavaEditorRefactoringOutcome } from "@ide/web-core";

/** Synchronize committed draft changes without rereading saved sources or sending didSave. */
export async function reconcileEditorRefactoring(
  dependencies: {
    editor: { reconcileBufferRenames(changes: readonly { oldPath: string; path: string }[]): void };
    documents: {
      closeDocument(path: string): Promise<void>;
      activate(path: string, text: string): Promise<void>;
      queueChange(path: string, text: string): void;
      flush(path: string): Promise<void>;
    };
    fileTree: Pick<FileTreeViewModel, "loadRoot" | "refreshDirectory">;
  },
  changes: JavaEditorRefactoringOutcome["changes"],
  isCurrent: () => boolean,
): Promise<string | undefined> {
  if (!isCurrent()) return;
  dependencies.editor.reconcileBufferRenames(changes);
  const warnings: string[] = [];
  const directories = new Set<string>();
  for (const change of changes) {
    if (!isCurrent()) return;
    try {
      if (change.oldPath !== change.path) {
        await dependencies.documents.closeDocument(change.oldPath);
        if (!isCurrent()) return;
        await dependencies.documents.activate(change.path, change.after);
      } else {
        dependencies.documents.queueChange(change.path, change.after);
        await dependencies.documents.flush(change.path);
      }
    } catch {
      warnings.push(
        "Language synchronization failed for a transformed draft. Reactivate its tab to retry.",
      );
    }
    if (change.oldPath !== change.path)
      for (const path of [change.oldPath, change.path]) {
        const parts = path.split("/");
        for (let count = 0; count < parts.length; count++)
          directories.add(parts.slice(0, count).join("/"));
      }
  }
  for (const directory of directories) {
    if (!isCurrent()) return;
    try {
      if (directory) await dependencies.fileTree.refreshDirectory(directory, isCurrent);
      else await dependencies.fileTree.loadRoot(isCurrent);
    } catch {
      warnings.push("Some explorer entries could not be refreshed. Refresh the explorer to retry.");
    }
  }
  return isCurrent() ? [...new Set(warnings)].join(" ") || undefined : undefined;
}
