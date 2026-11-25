// ---------------------------------------------------------------------------
// @ide/tauri-adapters – TauriFileTreeAdapter
// ---------------------------------------------------------------------------
// Implements FileTreePort by invoking Tauri Rust commands:
//   list_directory, create_file, create_directory, delete_path, rename_path
// ---------------------------------------------------------------------------

import { invokeTauri } from "./errors";
import type { FileNode, FileSelectionEvent, WorkspaceFileSearchResult } from "@ide/contracts";
import type { FileTreePort, WorkspaceFileSearchPort } from "@ide/web-core/ports";

/**
 * Parses a raw FileEntry from Rust into the contract FileNode shape.
 * The Rust side returns camelCase fields: name, path, type ("file"|"directory"), children.
 */
function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/g, "") : path;
}

function normalizeNodePath(path: string): string {
  const normalized = normalizePathSeparators(path).replace(/^\.\//, "");
  return stripTrailingSlash(normalized);
}

function joinNodePath(parentPath: string, childPath: string): string {
  const parent = normalizeNodePath(parentPath);
  const child = normalizeNodePath(childPath);

  if (!parent || parent === ".") {
    return child;
  }

  if (!child || child === ".") {
    return parent;
  }

  return `${parent}/${child}`;
}

function relativePathInside(parentPath: string, childPath: string): string | null {
  const parent = stripTrailingSlash(normalizePathSeparators(parentPath));
  const child = stripTrailingSlash(normalizePathSeparators(childPath));

  if (child === parent) {
    return "";
  }

  const prefix = `${parent}/`;
  return child.startsWith(prefix) ? child.slice(prefix.length) : null;
}

function entryPath(entry: Record<string, unknown>): string | null {
  return typeof entry.path === "string" && entry.path.length > 0 ? entry.path : null;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function deriveNodePath(
  entry: Record<string, unknown>,
  parentNodePath: string,
  parentEntryPath: string | null,
  rootEntryPath: string | null,
): string {
  const name = entry.name as string;
  const rawEntryPath = entryPath(entry);

  if (rawEntryPath && rootEntryPath) {
    const relativeToRoot = relativePathInside(rootEntryPath, rawEntryPath);
    if (relativeToRoot !== null) {
      return normalizeNodePath(relativeToRoot);
    }
  }

  if (rawEntryPath && parentEntryPath) {
    const relativeToParent = relativePathInside(parentEntryPath, rawEntryPath);
    if (relativeToParent !== null) {
      return joinNodePath(parentNodePath, relativeToParent);
    }
  }

  if (rawEntryPath && !isAbsolutePath(rawEntryPath)) {
    return normalizeNodePath(rawEntryPath);
  }

  // Fall back to the old name-based construction only when Rust did not give
  // us a usable path. This keeps clicks aligned with the path checked by the
  // Rust workspace guard instead of accidentally inventing a sibling path.
  return joinNodePath(parentNodePath, name);
}

function nodeIdFromPath(path: string): string {
  return `node-${path.replace(/[\/\.]/g, "-")}`;
}

function normalizeWorkspaceFileSearchResult(
  value: unknown,
  expectedGeneration: number,
): WorkspaceFileSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace file search response.");
  }
  const data = value as Record<string, unknown>;
  if (
    data.workspaceGeneration !== expectedGeneration ||
    !Array.isArray(data.files) ||
    data.files.length > 200 ||
    typeof data.truncated !== "boolean" ||
    typeof data.partial !== "boolean"
  )
    throw new Error("Invalid or stale workspace file search response.");

  const seen = new Set<string>();
  const files = data.files.map((entry): { name: string; path: string } => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid workspace file search result.");
    }
    const file = entry as Record<string, unknown>;
    if (
      typeof file.name !== "string" ||
      file.name.length === 0 ||
      file.name.length > 512 ||
      typeof file.path !== "string" ||
      file.path.length === 0 ||
      file.path.length > 4096 ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.includes("\0") ||
      file.path
        .split("/")
        .some((segment) => segment === "" || segment === "." || segment === "..") ||
      file.path.split("/").at(-1) !== file.name ||
      seen.has(file.path)
    )
      throw new Error("Invalid workspace file search result.");
    seen.add(file.path);
    return { name: file.name, path: file.path };
  });

  return {
    files,
    truncated: data.truncated,
    partial: data.partial,
  };
}

function fileEntryToNode(
  entry: Record<string, unknown>,
  parentNodePath: string,
  parentEntryPath: string | null,
  rootEntryPath: string | null,
): FileNode {
  const name = entry.name as string;
  const entryType = entry.type as string;
  const nodePath = deriveNodePath(entry, parentNodePath, parentEntryPath, rootEntryPath);
  const rawEntryPath = entryPath(entry);

  const node: FileNode = {
    id: nodeIdFromPath(nodePath),
    name,
    path: nodePath,
    type: entryType === "directory" ? "folder" : "file",
  };

  if (entryType === "directory" && Array.isArray(entry.children)) {
    node.children = (entry.children as Array<Record<string, unknown>>).map((child) =>
      fileEntryToNode(child, nodePath, rawEntryPath, rootEntryPath),
    );
    node.isOpen = false;
  }

  return node;
}

export class TauriFileTreeAdapter implements FileTreePort, WorkspaceFileSearchPort {
  private workspaceRootPath: string | null = null;
  private workspaceGeneration: number | null = null;

  private expectedWorkspaceRoot(): string {
    if (!this.workspaceRootPath) {
      throw new Error("The file tree must load its workspace before changing files.");
    }
    return this.workspaceRootPath;
  }

  private expectedWorkspaceGeneration(): number {
    if (this.workspaceGeneration === null) {
      throw new Error("The file tree must load its workspace before changing files.");
    }
    return this.workspaceGeneration;
  }

  /** Retrieve the root-level nodes from the project directory. */
  async getRoot(): Promise<FileNode[]> {
    this.workspaceRootPath = null;
    this.workspaceGeneration = null;
    // Use the current working directory as the root. The Rust command
    // list_directory expects a path; we send "." for the project root.
    const result = await invokeTauri<Record<string, unknown>>("list_directory", {
      path: ".",
    });

    const entry = result as Record<string, unknown>;
    const children = entry.children as Array<Record<string, unknown>> | undefined;
    this.workspaceRootPath = entryPath(entry);
    this.workspaceGeneration =
      typeof entry.workspaceGeneration === "number" &&
      Number.isSafeInteger(entry.workspaceGeneration) &&
      entry.workspaceGeneration >= 0
        ? entry.workspaceGeneration
        : null;

    if (!Array.isArray(children)) {
      return [];
    }

    return children.map((child) =>
      fileEntryToNode(child, "", this.workspaceRootPath, this.workspaceRootPath),
    );
  }

  /** Return the children of the folder at the given path. */
  async getChildren(path: string): Promise<FileNode[]> {
    const result = await invokeTauri<Record<string, unknown>>("list_directory", {
      path,
    });

    const entry = result as Record<string, unknown>;
    const children = entry.children as Array<Record<string, unknown>> | undefined;

    if (!Array.isArray(children)) {
      return [];
    }

    return children.map((child) =>
      fileEntryToNode(child, path, entryPath(entry), this.workspaceRootPath),
    );
  }

  async searchFiles(query: string): Promise<WorkspaceFileSearchResult> {
    const workspaceRoot = this.expectedWorkspaceRoot();
    const currentGeneration = this.expectedWorkspaceGeneration();
    if (query.trim().length === 0) {
      return {
        files: [],
        truncated: false,
        partial: false,
      };
    }

    const result = await invokeTauri<unknown>("search_workspace_files", {
      query,
      expectedWorkspaceRoot: workspaceRoot,
      expectedWorkspaceGeneration: currentGeneration,
    });
    return normalizeWorkspaceFileSearchResult(result, currentGeneration);
  }

  /** Create a new file at `path`. Returns the updated parent node list. */
  async createFile(path: string, createParentDirectoriesUnder?: string): Promise<FileNode[]> {
    await invokeTauri<Record<string, unknown>>("create_file", {
      path,
      ...(createParentDirectoriesUnder !== undefined ? { createParentDirectoriesUnder } : {}),
      expectedWorkspaceRoot: this.expectedWorkspaceRoot(),
      expectedWorkspaceGeneration: this.expectedWorkspaceGeneration(),
    });

    // Nested creation refreshes the existing anchor, including newly created folders.
    const parentPath = createParentDirectoriesUnder ?? path.split("/").slice(0, -1).join("/");
    return this.getChildren(parentPath || ".");
  }

  /** Create a new folder at `path`. Returns the updated parent node list. */
  async createFolder(path: string): Promise<FileNode[]> {
    await invokeTauri<Record<string, unknown>>("create_directory", {
      path,
      expectedWorkspaceRoot: this.expectedWorkspaceRoot(),
      expectedWorkspaceGeneration: this.expectedWorkspaceGeneration(),
    });

    const parentPath = path.split("/").slice(0, -1).join("/");
    return this.getChildren(parentPath || ".");
  }

  /** Delete the node at `path`. Returns the updated parent node list. */
  async delete(path: string): Promise<FileNode[]> {
    await invokeTauri<Record<string, unknown>>("delete_path", {
      path,
      expectedWorkspaceRoot: this.expectedWorkspaceRoot(),
      expectedWorkspaceGeneration: this.expectedWorkspaceGeneration(),
    });

    const parentPath = path.split("/").slice(0, -1).join("/");
    return this.getChildren(parentPath || ".");
  }

  /** Rename a node from `path` to `newName`. Returns the updated parent node list. */
  async rename(path: string, newName: string): Promise<FileNode[]> {
    await invokeTauri<Record<string, unknown>>("rename_path", {
      path,
      newName,
      expectedWorkspaceRoot: this.expectedWorkspaceRoot(),
      expectedWorkspaceGeneration: this.expectedWorkspaceGeneration(),
    });

    const parentPath = path.split("/").slice(0, -1).join("/");
    return this.getChildren(parentPath || ".");
  }

  /** Subscribe to file selection events. Returns an unsubscribe function. */
  private selectionCallback: ((event: FileSelectionEvent) => void) | null = null;

  onFileSelect(callback: (event: FileSelectionEvent) => void): () => void {
    this.selectionCallback = callback;
    return () => {
      this.selectionCallback = null;
    };
  }

  /**
   * Programmatically trigger a file selection event.
   * Called by the view model when the user selects a file.
   */
  selectFile(path: string, node: FileNode): void {
    this.selectionCallback?.({ filePath: path, node });
  }
}
