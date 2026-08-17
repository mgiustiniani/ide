// ---------------------------------------------------------------------------
// @ide/ui – Document split pane
// ---------------------------------------------------------------------------
// Splits the editor and the rendered preview for markup/documentation files.
// A toolbar button cycles view modes: split (editor + preview), preview-only
// (hide the editor), and editor-only (hide the preview).

import React from "react";
import { Editor } from "../Editor/Editor";
import { DocumentPreviewPanel } from "../DocumentPreviewPanel/DocumentPreviewPanel";
import "./DocumentSplitPane.css";

export type DocumentSplitViewMode = "split" | "preview-only" | "editor-only";

export interface DocumentSplitPaneProps {
  kind: "markdown" | "asciidoc" | "rst";
  content: string;
  filePath: string;
  onChange: (value: string) => void;
  viewMode: DocumentSplitViewMode;
  onViewModeChange: (mode: DocumentSplitViewMode) => void;
}

export function DocumentSplitPane(props: DocumentSplitPaneProps): JSX.Element {
  const { kind, content, filePath, onChange, viewMode, onViewModeChange } = props;

  const toggleLabel =
    viewMode === "split"
      ? "Hide the preview pane (show editor only)"
      : viewMode === "preview-only"
        ? "Show the editor pane again (split view)"
        : "Show the preview pane again (split view)";

  return (
    <section
      className={`document-split-pane document-split-pane--${viewMode}`}
      data-view-mode={viewMode}
    >
      <header className="document-split-pane__toolbar">
        <button
          type="button"
          className="document-split-pane__toggle"
          data-testid="document-split-toggle"
          aria-label={toggleLabel}
          onClick={() => onViewModeChange(nextViewMode(viewMode))}
        >
          {viewMode === "split" ? "Editor + Preview" : viewMode === "preview-only" ? "Preview" : "Editor"}
        </button>
      </header>
      <div className="document-split-pane__body">
        {viewMode !== "preview-only" ? (
          <div className="document-split-pane__editor" data-testid="document-split-editor">
            <Editor content={content} filePath={filePath} language={languageForKind(kind)} onChange={onChange} />
          </div>
        ) : null}
        {viewMode !== "editor-only" ? (
          <div className="document-split-pane__preview" data-testid="document-split-preview">
            <DocumentPreviewPanel content={content} filePath={filePath} kind={kind} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function nextViewMode(mode: DocumentSplitViewMode): DocumentSplitViewMode {
  if (mode === "split") return "preview-only";
  if (mode === "preview-only") return "editor-only";
  return "split";
}

function languageForKind(kind: string): string {
  if (kind === "markdown") return "markdown";
  if (kind === "asciidoc") return "asciidoc";
  if (kind === "rst") return "rst";
  return "plaintext";
}
