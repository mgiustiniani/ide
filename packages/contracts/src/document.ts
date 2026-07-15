// ---------------------------------------------------------------------------
// @ide/contracts – Document Reader Helpers
// ---------------------------------------------------------------------------
// Source-only helper utilities for document-type detection.

/** Document kinds supported by the document reader. */
export type DocumentKind = "markdown" | "asciidoc" | "unknown";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const ASCIIDOC_EXTENSIONS = new Set(["adoc", "asciidoc"]);

/**
 * Detect the document kind from a file path or name.
 * Supports Markdown (`.md`, `.markdown`) and AsciiDoc (`.adoc`, `.asciidoc`).
 */
export function detectDocumentKind(filePath: string): DocumentKind {
  const normalizedPath = filePath.split(/[?#]/, 1)[0]?.trim().toLowerCase() ?? "";
  const fileName = normalizedPath.split(/[\\/]/).pop() ?? "";
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "";

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }

  if (ASCIIDOC_EXTENSIONS.has(extension)) {
    return "asciidoc";
  }

  return "unknown";
}
