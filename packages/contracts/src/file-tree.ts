// ---------------------------------------------------------------------------
// @ide/contracts – File Tree Types
// ---------------------------------------------------------------------------
// Shared types describing the file tree domain model used across ports,
// stores, and view models.

/** The type of a node in the file tree. */
export type FileNodeType = "file" | "folder";

/** A single node within the file tree. */
export interface FileNode {
  /** Unique identifier within the tree. */
  id: string;
  /** Display name (e.g. "main.ts") */
  name: string;
  /** Full path relative to the project root (e.g. "src/main.ts") */
  path: string;
  /** Whether this node is a file or a folder. */
  type: FileNodeType;
  /** Child nodes – only present for folders when they have been expanded. */
  children?: FileNode[];
  /** Whether the folder is currently expanded in the UI (ignored for files). */
  isOpen?: boolean;
}

/** The overall state of the file tree panel. */
export interface FileTreeState {
  /** Root-level nodes. */
  rootNodes: FileNode[];
  /** Set of folder paths that are currently expanded. */
  expandedPaths: Set<string>;
  /** Currently selected / highlighted file path, or null. */
  selectedFilePath: string | null;
  /** Whether the tree is still loading its initial data. */
  isLoading: boolean;
}

/** Event emitted when the user selects a file in the tree. */
export interface FileSelectionEvent {
  /** The path of the file that was selected. */
  filePath: string;
  /** The node data of the selected file (read-only snapshot). */
  node: Readonly<FileNode>;
}
