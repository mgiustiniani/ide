// ---------------------------------------------------------------------------
// @ide/ui – FileTreeItem
// Single file‑node row: extension‑detected icon, name, click handler,
// active state highlight, indent guide lines (VS‑Code style).
// ---------------------------------------------------------------------------

import type { FileNode } from "@ide/contracts";
import { Icon } from "../ui/Icon";
import type { IconType } from "../ui/Icon";

export interface FileTreeItemProps {
  node: FileNode;
  /** Depth level for indentation (0 = root). */
  depth: number;
  /** Whether this file is the currently selected item. */
  isActive: boolean;
  /** Called when the user clicks this file. */
  onSelect: (node: FileNode) => void;
}

/**
 * Map a file extension to an icon type and colour class.
 * Falls back to a generic "file" icon.
 */
export function iconForFile(name: string): { type: IconType; colorClass: string } {
  if (name.toLowerCase() === "pom.xml") {
    return { type: "maven", colorClass: "text-[#f97316]" };
  }

  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "tsx":
      return { type: "react", colorClass: "text-[#149eca]" };
    case "ts":
      return { type: "typescript", colorClass: "text-[#3178c6]" };
    case "js":
    case "jsx":
      return { type: "javascript", colorClass: "text-[#f7df1e]" };
    case "json":
      return { type: "json", colorClass: "text-[#8bc34a]" };
    case "css":
    case "scss":
    case "less":
      return { type: "css", colorClass: "text-[#2965f1]" };
    case "html":
    case "htm":
      return { type: "html", colorClass: "text-[#e44d26]" };
    case "md":
    case "mdx":
      return { type: "markdown", colorClass: "text-[#6a6a6a]" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return { type: "image", colorClass: "text-[#9b59b6]" };
    default:
      return { type: "file", colorClass: "text-[var(--text-muted)]" };
  }
}

export function FileTreeItem({ node, depth, isActive, onSelect }: FileTreeItemProps): JSX.Element {
  const indentPadding = depth * 16;
  const { type: iconType, colorClass } = iconForFile(node.name);

  return (
    <div
      className={`file-tree-row ${isActive ? "file-tree-row--active" : ""} glass-hover slide-up`}
      style={{ paddingLeft: `${8 + indentPadding}px` }}
      onClick={() => onSelect(node)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node);
        }
      }}
      role="treeitem"
      tabIndex={0}
      aria-level={depth + 1}
      aria-selected={isActive}
      data-path={node.path}
      title={node.path}
    >
      {/* Indent guide lines (VS‑Code style) */}
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

      <span className="w-3.5 shrink-0" aria-hidden="true" />
      <Icon type={iconType} size={20} className={`shrink-0 gradient-icon ${colorClass}`} />
      <span className="truncate ml-1.5">{node.name}</span>
    </div>
  );
}
