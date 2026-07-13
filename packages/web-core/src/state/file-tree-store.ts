// ---------------------------------------------------------------------------
// @ide/web-core – File Tree Store (Zustand)
// ---------------------------------------------------------------------------
// Manages the file tree UI state: root nodes, expanded folders, selection.

import { create } from 'zustand';
import type { FileNode } from '@ide/contracts';

/** Slice of the store exposed to consumers. */
export interface FileTreeStoreSlice {
  /** Root‑level file tree nodes. */
  rootNodes: FileNode[];
  /** Set of expanded folder paths. */
  expandedPaths: Set<string>;
  /** Currently selected file path (or null). */
  selectedFilePath: string | null;
  /** Whether the tree is loading. */
  isLoading: boolean;

  // ── Actions ────────────────────────────────────────────────────────

  /** Replace the root nodes (e.g. after initial load or refresh). */
  setRootNodes(nodes: FileNode[]): void;
  /** Add or replace children for a given folder path. */
  setChildren(parentPath: string, children: FileNode[]): void;
  /** Toggle the expanded state of a folder. */
  toggleExpand(path: string): void;
  /** Set the currently selected file. */
  setSelectedFilePath(path: string | null): void;
  /** Update the loading flag. */
  setLoading(loading: boolean): void;
  /** Insert a node into the children array of a given parent. */
  insertNode(parentPath: string, node: FileNode): void;
  /** Remove a node (by path) from the tree. */
  removeNode(path: string): void;
}

export type FileTreeStore = FileTreeStoreSlice;

export type { FileNode } from '@ide/contracts';

function collectOpenPaths(nodes: FileNode[]): Set<string> {
  const expanded = new Set<string>();

  const visit = (nodeList: FileNode[]) => {
    for (const node of nodeList) {
      if (node.type === 'folder' && node.isOpen) {
        expanded.add(node.path);
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return expanded;
}

function applyExpandedState(
  nodes: FileNode[],
  expandedPaths: Set<string>,
): FileNode[] {
  return nodes.map((node) => {
    if (node.type !== 'folder') return node;

    const next: FileNode = {
      ...node,
      ...(node.children
        ? { children: applyExpandedState(node.children, expandedPaths) }
        : {}),
    };

    if (expandedPaths.has(node.path) || node.isOpen !== undefined) {
      next.isOpen = expandedPaths.has(node.path);
    }

    return next;
  });
}

function removeExpandedPath(expandedPaths: Set<string>, path: string): Set<string> {
  const next = new Set(expandedPaths);
  for (const expandedPath of expandedPaths) {
    if (expandedPath === path || expandedPath.startsWith(`${path}/`)) {
      next.delete(expandedPath);
    }
  }
  return next;
}

export function createFileTreeStore() {
  return create<FileTreeStoreSlice>((set) => ({
    rootNodes: [],
    expandedPaths: new Set<string>(),
    selectedFilePath: null,
    isLoading: true,

    setRootNodes(nodes: FileNode[]) {
      set((state) => {
        const expandedPaths = new Set([
          ...state.expandedPaths,
          ...collectOpenPaths(nodes),
        ]);

        return {
          expandedPaths,
          rootNodes: applyExpandedState(nodes, expandedPaths),
        };
      });
    },

    setChildren(parentPath: string, children: FileNode[]) {
      set((state) => {
        const expandedPaths = new Set([
          ...state.expandedPaths,
          ...collectOpenPaths(children),
        ]);
        const nextChildren = applyExpandedState(children, expandedPaths);

        const updateNode = (nodes: FileNode[]): FileNode[] => {
          let changed = false;
          const updated = nodes.map((node) => {
            if (node.type === 'folder' && node.path === parentPath) {
              changed = true;
              return {
                ...node,
                isOpen: expandedPaths.has(node.path),
                children: nextChildren,
              };
            }
            if (node.children) {
              const children = updateNode(node.children);
              if (children !== node.children) {
                changed = true;
                return { ...node, children };
              }
            }
            return node;
          });

          return changed ? updated : nodes;
        };

        return { expandedPaths, rootNodes: updateNode(state.rootNodes) };
      });
    },

    toggleExpand(path: string) {
      set((state) => {
        const expandedPaths = new Set(state.expandedPaths);
        if (expandedPaths.has(path)) {
          expandedPaths.delete(path);
        } else {
          expandedPaths.add(path);
        }

        return {
          expandedPaths,
          rootNodes: applyExpandedState(state.rootNodes, expandedPaths),
        };
      });
    },

    setSelectedFilePath(path: string | null) {
      set({ selectedFilePath: path });
    },

    setLoading(loading: boolean) {
      set({ isLoading: loading });
    },

    insertNode(parentPath: string, node: FileNode) {
      set((state) => {
        const expandedPaths = new Set([
          ...state.expandedPaths,
          ...collectOpenPaths([node]),
        ]);
        const nextNode = applyExpandedState([node], expandedPaths)[0];

        if (!parentPath) {
          return {
            expandedPaths,
            rootNodes: [...state.rootNodes, nextNode],
          };
        }

        const insert = (nodes: FileNode[]): FileNode[] =>
          nodes.map((currentNode) => {
            if (currentNode.type === 'folder' && currentNode.path === parentPath) {
              return {
                ...currentNode,
                isOpen: expandedPaths.has(currentNode.path),
                children: [...(currentNode.children ?? []), nextNode],
              };
            }
            if (currentNode.children) {
              return { ...currentNode, children: insert(currentNode.children) };
            }
            return currentNode;
          });

        return { expandedPaths, rootNodes: insert(state.rootNodes) };
      });
    },

    removeNode(path: string) {
      set((state) => {
        const expandedPaths = removeExpandedPath(state.expandedPaths, path);

        const prune = (nodes: FileNode[]): FileNode[] =>
          nodes
            .filter((node) => node.path !== path)
            .map((node) =>
              node.children ? { ...node, children: prune(node.children) } : node,
            );

        return {
          expandedPaths,
          rootNodes: applyExpandedState(prune(state.rootNodes), expandedPaths),
        };
      });
    },
  }));
}
