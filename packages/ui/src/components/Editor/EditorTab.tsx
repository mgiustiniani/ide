// ---------------------------------------------------------------------------
// @ide/ui – EditorTab
// Single tab component: file name, close button, active indicator,
// dirty dot, VS‑Code style accent border on active tab.
// ---------------------------------------------------------------------------

import type { EditorTab as EditorTabType } from "@ide/contracts";
import { Icon } from "../ui/Icon";

export interface EditorTabProps {
  tab: EditorTabType;
  /** Called when the user clicks the tab to activate it. */
  onActivate: (filePath: string) => void;
  /** Called when the user clicks the close button. */
  onClose: (filePath: string) => void;
}

export function EditorTab({ tab, onActivate, onClose }: EditorTabProps): JSX.Element {
  const tabClass = tab.isActive ? "editor-tab editor-tab--active" : "editor-tab";

  return (
    <div
      className={tabClass}
      onClick={() => onActivate(tab.filePath)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(tab.filePath);
        }
      }}
      role="tab"
      tabIndex={0}
      aria-selected={tab.isActive}
      data-path={tab.filePath}
      title={tab.filePath}
    >
      {/* File icon based on extension */}
      <Icon type={fileIconType(tab.filePath)} size={14} className="shrink-0" />

      <span className="truncate max-w-[160px]">{tab.filePath.split("/").pop()}</span>

      {tab.isDirty && (
        <span
          className="inline-block h-2 w-2 rounded-full bg-[var(--accent-yellow)] ml-1"
          aria-label="Unsaved changes"
        />
      )}

      <button
        className="editor-tab-close ml-1"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.filePath);
        }}
        aria-label={`Close ${tab.filePath}`}
      >
        <Icon type="close" size={10} />
      </button>
    </div>
  );
}

/** Derive a file-type icon from the tab's file path extension. */
function fileIconType(filePath: string): IconType {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "tsx":
      return "react";
    case "ts":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return "image";
    default:
      return "file";
  }
}

// Import needed for the function above
import type { IconType } from "../ui/Icon";
