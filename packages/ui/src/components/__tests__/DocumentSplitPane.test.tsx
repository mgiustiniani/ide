// ---------------------------------------------------------------------------
// @ide/ui – DocumentSplitPane Component Tests
// ---------------------------------------------------------------------------
// Verifies that the split pane keeps the editor pane and preview pane visible
// according to the requested view mode. Monaco itself stays inert in jsdom
// (no visible geometry), so the editor pane is asserted through the stable
// test ids added to DocumentSplitPane plus the Editor renderer stack.
// ---------------------------------------------------------------------------

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentSplitPane } from "../DocumentSplitPane/DocumentSplitPane";

const rstContent = [
  "Title",
  "=====",
  "",
  "A paragraph with *emphasis*.",
  "",
  "Section",
  "-------",
].join("\n");

function renderSplitPane(viewMode: "split" | "preview-only" | "editor-only") {
  const onChange = vi.fn();
  const onViewModeChange = vi.fn();

  const view = render(
    <DocumentSplitPane
      kind="rst"
      content={rstContent}
      filePath="notes.rst"
      onChange={onChange}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
    />,
  );

  return { onChange, onViewModeChange, view };
}

describe("DocumentSplitPane", () => {
  it("shows both the editor pane and the preview pane in split mode", () => {
    renderSplitPane("split");

    expect(screen.getByTestId("document-split-toggle")).toBeDefined();
    expect(screen.getByTestId("document-split-editor")).toBeDefined();
    expect(screen.getByTestId("document-split-preview")).toBeDefined();

    // The Editor component actually rendered its renderer stack/placeholder.
    expect(screen.getByTestId("editor-renderer-stack")).toBeDefined();
    expect(screen.getByTestId("editor-opening-placeholder")).toBeDefined();

    // The preview renders the reStructuredText document.
    expect(screen.getByRole("region", { name: "Document preview" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeDefined();
  });

  it("hides the editor pane in preview-only mode", () => {
    renderSplitPane("preview-only");

    expect(screen.getByTestId("document-split-toggle")).toBeDefined();
    expect(screen.queryByTestId("document-split-editor")).toBeNull();
    expect(screen.queryByTestId("editor-renderer-stack")).toBeNull();
    expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull();

    expect(screen.getByTestId("document-split-preview")).toBeDefined();
    expect(screen.getByRole("region", { name: "Document preview" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeDefined();
  });

  it("hides the preview pane in editor-only mode", () => {
    renderSplitPane("editor-only");

    expect(screen.getByTestId("document-split-toggle")).toBeDefined();
    expect(screen.getByTestId("document-split-editor")).toBeDefined();
    expect(screen.getByTestId("editor-renderer-stack")).toBeDefined();

    expect(screen.queryByTestId("document-split-preview")).toBeNull();
    expect(screen.queryByRole("region", { name: "Document preview" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: "Title" })).toBeNull();
  });
});
