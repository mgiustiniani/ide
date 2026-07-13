// ---------------------------------------------------------------------------
// @ide/ui – FileTree
// Main file‑tree component: renders recursive folder/file list from
// FileNode[] props, handles expand/collapse, file selection callback.
// ---------------------------------------------------------------------------

import type { FileNode } from "@ide/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileTreeFolder } from "./FileTreeFolder";
import { FileTreeItem } from "./FileTreeItem";

export interface FileTreeProps {
  /** Root‑level nodes to display. */
  nodes: FileNode[];
  /** Currently expanded folder paths. */
  expandedPaths: Set<string>;
  /** Currently selected file path. */
  selectedFilePath: string | null;
  /** Called when the user selects a file node. */
  onSelect: (node: FileNode) => void;
  /** Called when a folder is toggled open/closed. */
  onToggle: (node: FileNode) => void;
  /** Controlled path of the selected directory. */
  selectedDirectoryPath?: string | null;
  /** Controlled path of the directory that owns keyboard focus. */
  focusedDirectoryPath?: string | null;
  /** Called in addition to onToggle when a directory row is selected. */
  onSelectDirectory?: (node: FileNode) => void;
  /** Called when a directory row receives focus. */
  onFocusDirectory?: (node: FileNode) => void;
  /** Requests the host workflow for a selected directory; the UI never reads the clipboard. */
  onPasteJavaClass?: (directoryNode: FileNode) => void;
}

interface DirectoryMenuState {
  node: FileNode;
  x: number;
  y: number;
  returnFocus: HTMLElement;
}

function findDirectory(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === "folder" && node.path === path) return node;
    const nested = node.children ? findDirectory(node.children, path) : null;
    if (nested) return nested;
  }
  return null;
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function FileTree({
  nodes,
  expandedPaths,
  selectedFilePath,
  onSelect,
  onToggle,
  selectedDirectoryPath = null,
  focusedDirectoryPath = null,
  onSelectDirectory,
  onFocusDirectory,
  onPasteJavaClass,
}: FileTreeProps): JSX.Element {
  const [menu, setMenu] = useState<DirectoryMenuState | null>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const selectedDirectory = useMemo(
    () => (selectedDirectoryPath ? findDirectory(nodes, selectedDirectoryPath) : null),
    [nodes, selectedDirectoryPath],
  );

  useEffect(() => {
    if (menu) menuItemRef.current?.focus();
  }, [menu]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-[var(--text-muted)]">
        No files yet
      </div>
    );
  }

  return (
    <div
      className="relative select-none overflow-y-auto h-full"
      role="tree"
      aria-label="File Explorer"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "v" &&
          selectedDirectory &&
          onPasteJavaClass &&
          !isEditablePasteTarget(event.target)
        ) {
          event.preventDefault();
          onPasteJavaClass(selectedDirectory);
        }
      }}
      onPointerDownCapture={(event) => {
        if (
          menu &&
          !(event.target instanceof Node && event.target.parentElement?.closest('[role="menu"]'))
        ) {
          setMenu(null);
        }
      }}
    >
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FileTreeFolder
            key={node.id}
            node={node}
            depth={0}
            isOpen={expandedPaths.has(node.path)}
            expandedPaths={expandedPaths}
            selectedFilePath={selectedFilePath}
            onToggle={onToggle}
            onSelect={onSelect}
            selectedDirectoryPath={selectedDirectoryPath}
            focusedDirectoryPath={focusedDirectoryPath}
            onSelectDirectory={onSelectDirectory}
            onFocusDirectory={onFocusDirectory}
            onOpenPasteMenu={
              onPasteJavaClass
                ? (directoryNode, row, point) => {
                    setMenu({
                      node: directoryNode,
                      x: point?.x ?? row.getBoundingClientRect().left + 20,
                      y: point?.y ?? row.getBoundingClientRect().bottom,
                      returnFocus: row,
                    });
                  }
                : undefined
            }
          />
        ) : (
          <FileTreeItem
            key={node.id}
            node={node}
            depth={0}
            isActive={selectedFilePath === node.path}
            onSelect={onSelect}
          />
        ),
      )}
      {menu && onPasteJavaClass && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onPointerDown={() => setMenu(null)}
          />
          <div
            role="menu"
            aria-label={`Actions for ${menu.node.name}`}
            className="fixed z-50 min-w-56 rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] p-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                const returnFocus = menu.returnFocus;
                setMenu(null);
                returnFocus.focus();
              }
            }}
          >
            <button
              ref={menuItemRef}
              type="button"
              role="menuitem"
              className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus:bg-[var(--highlight-bg)]"
              onClick={() => {
                onPasteJavaClass(menu.node);
                setMenu(null);
              }}
            >
              Paste Java Class from Clipboard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
