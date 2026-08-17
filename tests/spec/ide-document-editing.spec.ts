import { describe, expect, it } from "vitest";
import { detectDocumentKind, isPreviewableDocumentKind, isDocumentViewMode, nextDocumentViewMode, DOCUMENT_VIEW_MODES } from "../../packages/contracts/src/document";

describe("document kind detection", () => {
  it("detects rst from .rst and .rest", () => {
    expect(detectDocumentKind("guide.rst")).toBe("rst");
    expect(detectDocumentKind("docs/guide.rest")).toBe("rst");
  });

  it("detects asciidoc from .adoc and .asciidoc", () => {
    expect(detectDocumentKind("manual.adoc")).toBe("asciidoc");
    expect(detectDocumentKind("manual.asciidoc")).toBe("asciidoc");
  });

  it("keeps markdown detection", () => {
    expect(detectDocumentKind("README.md")).toBe("markdown");
    expect(detectDocumentKind("README.markdown")).toBe("markdown");
  });

  it("returns unknown for other extensions", () => {
    expect(detectDocumentKind("src/main.ts")).toBe("unknown");
    expect(detectDocumentKind("no-extension")).toBe("unknown");
  });

  it("marks markdown/asciidoc/rst as previewable", () => {
    expect(isPreviewableDocumentKind("markdown")).toBe(true);
    expect(isPreviewableDocumentKind("asciidoc")).toBe(true);
    expect(isPreviewableDocumentKind("rst")).toBe(true);
    expect(isPreviewableDocumentKind("unknown")).toBe(false);
  });
});

describe("document view mode state machine", () => {
  it("cycles split -> preview-only -> editor-only -> split", () => {
    expect(nextDocumentViewMode("split")).toBe("preview-only");
    expect(nextDocumentViewMode("preview-only")).toBe("editor-only");
    expect(nextDocumentViewMode("editor-only")).toBe("split");
  });

  it("is total over DOCUMENT_VIEW_MODES", () => {
    for (const mode of DOCUMENT_VIEW_MODES) {
      expect(isDocumentViewMode(nextDocumentViewMode(mode))).toBe(true);
    }
  });

  it("rejects unknown modes", () => {
    expect(isDocumentViewMode("side-by-side")).toBe(false);
    expect(isDocumentViewMode(null)).toBe(false);
  });
});
