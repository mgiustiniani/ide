// ---------------------------------------------------------------------------
// @ide/ui – FileTreeFolder
// Folder row with Java-package compaction and source-root presentation.
// ---------------------------------------------------------------------------

import type { FileNode } from "@ide/contracts";
import { Icon } from "../ui/Icon";
import { FileTreeItem } from "./FileTreeItem";
import {
  folderSemantic,
  isJavaPackageSegment,
  javaSourceRootKind,
  presentJavaPackageFolder,
} from "./presentation";

export interface FileTreeFolderProps {
  node: FileNode;
  /** Depth level for indentation. */
  depth: number;
  /** Whether the folder is currently expanded. */
  isOpen: boolean;
  /** Paths controlled as expanded by the tree owner. */
  expandedPaths?: Set<string>;
  /** Path of the currently selected file. */
  selectedFilePath: string | null;
  /** Called to toggle expand/collapse. */
  onToggle: (node: FileNode) => void;
  /** Called when the user selects a file node. */
  onSelect: (node: FileNode) => void;
  /** Internal path names above this node. */
  ancestorNames?: string[];
  /** Internal marker: this node is directly inside a Java package tree. */
  isJavaPackageContext?: boolean;
  selectedDirectoryPath?: string | null;
  focusedDirectoryPath?: string | null;
  onSelectDirectory?: (node: FileNode) => void;
  onFocusDirectory?: (node: FileNode) => void;
  onOpenPasteMenu?: (node: FileNode, row: HTMLElement, point?: { x: number; y: number }) => void;
}

const semanticStyles = {
  folder: {
    icon: "text-[var(--accent-blue)]",
    label: "",
    description: "Folder",
  },
  source: {
    icon: "text-[#38bdf8]",
    label: "text-[#7dd3fc] font-medium",
    description: "Production source folder",
  },
  test: {
    icon: "text-[#4ade80]",
    label: "text-[#86efac] font-medium",
    description: "Test source folder",
  },
} as const;

export function FileTreeFolder({
  node,
  depth,
  isOpen,
  expandedPaths,
  selectedFilePath,
  onToggle,
  onSelect,
  ancestorNames = [],
  isJavaPackageContext = false,
  selectedDirectoryPath = null,
  focusedDirectoryPath = null,
  onSelectDirectory,
  onFocusDirectory,
  onOpenPasteMenu,
}: FileTreeFolderProps): JSX.Element {
  const presentation = presentJavaPackageFolder(node, isJavaPackageContext);
  const realNode = presentation.node;
  const realSegments = [...ancestorNames, ...presentation.segmentNames];
  const semantic = folderSemantic(realSegments);
  const styles = semanticStyles[semantic];
  const indentPadding = depth * 16;
  const hasChildren = Boolean(realNode.children?.length);
  const childCount = realNode.children?.length ?? 0;
  const rowIsOpen = expandedPaths ? expandedPaths.has(realNode.path) : (realNode.isOpen ?? isOpen);
  const isJavaRoot = javaSourceRootKind(realSegments) !== null;
  const childrenAreJavaPackages =
    isJavaRoot || (isJavaPackageContext && presentation.segmentNames.every(isJavaPackageSegment));
  const accessibleKind = presentation.isCompactedPackage ? "Java package" : styles.description;
  const isSelectedDirectory = selectedDirectoryPath === realNode.path;
  const isFocusedDirectory = focusedDirectoryPath === realNode.path;

  return (
    <>
      <div
        className={`file-tree-row glass-hover slide-up ${isSelectedDirectory ? "file-tree-row--active" : ""} ${isFocusedDirectory ? "ring-1 ring-inset ring-[var(--border-focus)]" : ""}`}
        style={{ paddingLeft: `${8 + indentPadding}px` }}
        onClick={() => {
          onSelectDirectory?.(realNode);
          onToggle(realNode);
        }}
        onFocus={() => onFocusDirectory?.(realNode)}
        onContextMenu={(event) => {
          if (!onOpenPasteMenu) return;
          event.preventDefault();
          onSelectDirectory?.(realNode);
          onOpenPasteMenu(realNode, event.currentTarget, { x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
            if (onOpenPasteMenu) {
              event.preventDefault();
              onSelectDirectory?.(realNode);
              onOpenPasteMenu(realNode, event.currentTarget);
            }
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectDirectory?.(realNode);
            onToggle(realNode);
          }
        }}
        role="treeitem"
        tabIndex={0}
        aria-level={depth + 1}
        aria-expanded={rowIsOpen}
        aria-selected={isSelectedDirectory}
        aria-label={`${presentation.label}, ${accessibleKind}`}
        data-path={realNode.path}
        data-folder-semantic={semantic}
        data-compacted-package={presentation.isCompactedPackage || undefined}
        title={realNode.path}
      >
        {depth > 0 && (
          <span className="indent-guides" aria-hidden="true">
            {Array.from({ length: depth }).map((_, i) => (
              <span
                key={i}
                className="indent-guide gradient-indent-guide"
                style={{ left: `${i * 16 + 8}px` }}
              />
            ))}
          </span>
        )}

        <Icon
          type={rowIsOpen ? "chevron-down" : "chevron-right"}
          size={14}
          className="text-[var(--text-muted)] shrink-0 chevron-rotating"
        />
        <Icon
          type={rowIsOpen ? "folder-open" : "folder"}
          size={20}
          className={`${styles.icon} shrink-0 gradient-icon`}
        />
        <span className={`truncate ml-1.5 ${styles.label}`}>{presentation.label}</span>

        {hasChildren && <span className="folder-count-badge ml-1 spring-pop">{childCount}</span>}
      </div>

      <div
        className={`file-tree-children ${rowIsOpen && hasChildren ? "file-tree-children--open" : ""}`}
        data-folder-children={realNode.path}
        role="group"
      >
        {hasChildren && (
          <div className="file-tree-children-inner">
            {realNode.children!.map((child) =>
              child.type === "folder" ? (
                <FileTreeFolder
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  isOpen={expandedPaths?.has(child.path) ?? child.isOpen ?? false}
                  expandedPaths={expandedPaths}
                  selectedFilePath={selectedFilePath}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  ancestorNames={realSegments}
                  isJavaPackageContext={childrenAreJavaPackages}
                  selectedDirectoryPath={selectedDirectoryPath}
                  focusedDirectoryPath={focusedDirectoryPath}
                  onSelectDirectory={onSelectDirectory}
                  onFocusDirectory={onFocusDirectory}
                  onOpenPasteMenu={onOpenPasteMenu}
                />
              ) : (
                <FileTreeItem
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  isActive={selectedFilePath === child.path}
                  onSelect={onSelect}
                />
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
}
