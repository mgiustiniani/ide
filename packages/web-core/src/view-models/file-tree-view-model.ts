// ---------------------------------------------------------------------------
// @ide/web-core – File Tree View‑Model
// ---------------------------------------------------------------------------
// Wraps the file‑tree store and the FileTreePort to provide a clean,
// framework‑agnostic view‑model for UI components.

import type { FileTreeStoreSlice } from "../state/file-tree-store";
import type { StoreAccessor } from "../state/store-accessor";
import { toGetState } from "../state/store-accessor";
import type { FileTreePort } from "../ports/file-tree-port";
import type { FileNode } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "../editor-open-coordinator";

export class FileTreeViewModel {
  private readonly getState: () => FileTreeStoreSlice;

  constructor(
    store: StoreAccessor<FileTreeStoreSlice>,
    private readonly port: FileTreePort,
  ) {
    this.getState = toGetState(store);
  }

  // ── State accessors ────────────────────────────────────────────────

  get rootNodes(): FileNode[] {
    return this.getState().rootNodes;
  }

  get selectedFilePath(): string | null {
    return this.getState().selectedFilePath;
  }

  get isLoading(): boolean {
    return this.getState().isLoading;
  }

  isExpanded(path: string): boolean {
    return this.getState().expandedPaths.has(path);
  }

  // ── Actions ────────────────────────────────────────────────────────

  /** Load the root tree from the port and update the store. */
  async loadRoot(isCurrent: () => boolean = () => true): Promise<void> {
    if (!isCurrent()) return;
    this.getState().setLoading(true);
    try {
      const nodes = await this.hydrateExpandedFolders(await this.port.getRoot(), isCurrent);
      if (isCurrent()) this.getState().setRootNodes(nodes);
    } finally {
      if (isCurrent()) this.getState().setLoading(false);
    }
  }

  /**
   * Reload one non-root directory without changing global loading, expansion,
   * or selection state. Call loadRoot explicitly when a root refresh is needed.
   */
  async refreshDirectory(path: string, isCurrent: () => boolean = () => true): Promise<void> {
    if (!isCurrent()) return;
    const children = await this.hydrateExpandedFolders(
      await this.port.getChildren(path),
      isCurrent,
    );
    if (isCurrent()) this.getState().setChildren(path, children);
  }

  /** Materialize and expand one directory path using the existing lazy tree. */
  async revealFolder(path: string, isCurrent: () => boolean): Promise<FileNode | null> {
    if (!isNormalizedWorkspaceRelativePath(path) || path.includes(":") || !isCurrent()) return null;
    const ancestors: string[] = [];
    let visibleNodes = this.rootNodes;
    let prefix = "";
    let folder: FileNode | undefined;
    for (const segment of path.split("/")) {
      const parent = prefix;
      prefix = parent ? `${parent}/${segment}` : segment;
      folder = visibleNodes.find((node) => node.type === "folder" && node.path === prefix);
      if (!folder) {
        visibleNodes = parent
          ? await this.hydrateExpandedFolders(await this.port.getChildren(parent), isCurrent)
          : await this.hydrateExpandedFolders(await this.port.getRoot(), isCurrent);
        if (!isCurrent()) return null;
        folder = visibleNodes.find((node) => node.type === "folder" && node.path === prefix);
        if (!folder) return null;
        this.replaceChildren(parent, visibleNodes);
      }
      ancestors.push(prefix);
      visibleNodes = folder.children ?? [];
    }
    await this.refreshDirectory(path, isCurrent);
    if (!isCurrent()) return null;
    for (const ancestor of ancestors) {
      if (!this.isExpanded(ancestor)) this.getState().toggleExpand(ancestor);
    }
    return folder ?? null;
  }

  /** A bounded native listing can end at an expanded folder; reload its children. */
  private async hydrateExpandedFolders(
    nodes: FileNode[],
    isCurrent: () => boolean,
  ): Promise<FileNode[]> {
    const hydrated: FileNode[] = [];
    for (const node of nodes) {
      if (!isCurrent()) return nodes;
      if (node.type !== "folder" || !this.isExpanded(node.path)) {
        hydrated.push(node);
        continue;
      }
      const children = node.children?.length
        ? node.children
        : await this.port.getChildren(node.path);
      hydrated.push({ ...node, children: await this.hydrateExpandedFolders(children, isCurrent) });
    }
    return hydrated;
  }

  /** Toggle a folder – load children on first expansion. */
  async toggleFolder(path: string): Promise<void> {
    const wasExpanded = this.isExpanded(path);
    this.getState().toggleExpand(path);

    if (!wasExpanded) {
      // Load children on expand.
      try {
        const children = await this.port.getChildren(path);
        this.getState().setChildren(path, children);
      } catch {
        // If loading fails, revert expand if it is still expanded.
        if (this.isExpanded(path)) {
          this.getState().toggleExpand(path);
        }
      }
    }
  }

  /** Select a file and notify the port. */
  selectFile(filePath: string): void {
    this.getState().setSelectedFilePath(filePath);
    // Port subscription handled by the adapter; we just update store state.
  }

  /** Create a new file under the given parent folder. */
  async createFile(
    parentPath: string,
    name: string,
    isCurrent: () => boolean = () => true,
    relativeDirectory?: string,
  ): Promise<string> {
    if (relativeDirectory && relativeDirectory.split("/").some((part) => !part || part === "." || part === ".." || /[\\:\0]/u.test(part))) {
      throw new Error("Use a relative directory beneath the selected parent.");
    }
    const fullPath = this.joinPath(parentPath, relativeDirectory ? `${relativeDirectory}/${name}` : name);
    const updatedSiblings = relativeDirectory
      ? await this.port.createFile(fullPath, parentPath || ".")
      : await this.port.createFile(fullPath);
    if (isCurrent()) this.replaceChildren(parentPath, updatedSiblings);
    return fullPath;
  }

  /** Create a new folder under the given parent folder. */
  async createFolder(
    parentPath: string,
    name: string,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const fullPath = this.joinPath(parentPath, name);
    const updatedSiblings = await this.port.createFolder(fullPath);
    if (isCurrent()) this.replaceChildren(parentPath, updatedSiblings);
  }

  /** Delete a node. */
  async delete(path: string): Promise<void> {
    const updatedSiblings = await this.port.delete(path);
    const parentPath = this.parentPath(path);

    this.replaceChildren(parentPath, updatedSiblings);

    // Clear selection if the deleted file or one of its descendants was selected.
    const selected = this.getState().selectedFilePath;
    if (selected === path || selected?.startsWith(`${path}/`)) {
      this.getState().setSelectedFilePath(null);
    }
  }

  /** Rename a node. */
  async rename(path: string, newName: string): Promise<void> {
    const updatedSiblings = await this.port.rename(path, newName);
    this.replaceChildren(this.parentPath(path), updatedSiblings);
  }

  /** Subscribe to external file‑selection events from the port. */
  subscribeToFileSelection(): () => void {
    return this.port.onFileSelect((event) => {
      this.getState().setSelectedFilePath(event.filePath);
    });
  }

  private replaceChildren(parentPath: string, nodes: FileNode[]): void {
    if (parentPath) {
      this.getState().setChildren(parentPath, nodes);
    } else {
      this.getState().setRootNodes(nodes);
    }
  }

  private joinPath(parentPath: string, name: string): string {
    return parentPath ? `${parentPath}/${name}` : name;
  }

  private parentPath(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
  }
}
