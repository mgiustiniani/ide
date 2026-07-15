// ---------------------------------------------------------------------------
// @ide/web-core – FileTreePort
// ---------------------------------------------------------------------------
// Port interface for file‑system operations on the file tree.
// Concrete adapters (e.g. Tauri, mock, web) implement this interface.

import type { FileNode, FileSelectionEvent } from "@ide/contracts";

export interface FileTreePort {
  /** Retrieve the root‑level nodes of the project. */
  getRoot(): Promise<FileNode[]>;

  /** Return the children of the folder at the given `path`. */
  getChildren(path: string): Promise<FileNode[]>;

  /** Create a new file at `path`. Returns the updated parent node list. */
  createFile(path: string): Promise<FileNode[]>;

  /** Create a new folder at `path`. Returns the updated parent node list. */
  createFolder(path: string): Promise<FileNode[]>;

  /** Delete the node at `path`. Returns the updated parent node list. */
  delete(path: string): Promise<FileNode[]>;

  /** Rename a node from `path` to `newName`. Returns the updated parent node list. */
  rename(path: string, newName: string): Promise<FileNode[]>;

  /** Subscribe to file selection events. Returns an unsubscribe function. */
  onFileSelect(callback: (event: FileSelectionEvent) => void): () => void;
}
