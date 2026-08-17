// ---------------------------------------------------------------------------
// @ide/contracts – Document Editing Contracts
// ---------------------------------------------------------------------------
// Source-only helpers for document language detection and the document split
// view mode state machine. Kept pure so the IDE behavior is testable without
// a running UI.

/** Document kinds that get a rendered preview beside the editor. */
export type DocumentKind = "markdown" | "asciidoc" | "rst" | "unknown";

/** View modes for a document split pane. */
export type DocumentViewMode = "split" | "preview-only" | "editor-only";

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const ASCIIDOC_EXTENSIONS = new Set(["adoc", "asciidoc"]);
const RST_EXTENSIONS = new Set(["rst", "rest"]);

/**
 * Detect the document kind from a file path or name.
 * Supports Markdown (`.md`, `.markdown`), AsciiDoc (`.adoc`, `.asciidoc`),
 * reStructuredText (`.rst`, `.rest`), and returns "unknown" otherwise.
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

  if (RST_EXTENSIONS.has(extension)) {
    return "rst";
  }

  return "unknown";
}

/** True when a document kind has a rendered preview pane. */
export function isPreviewableDocumentKind(kind: DocumentKind): boolean {
  return kind === "markdown" || kind === "asciidoc" || kind === "rst";
}

/** True when a value is a document view mode. */
export function isDocumentViewMode(value: unknown): value is DocumentViewMode {
  return value === "split" || value === "preview-only" || value === "editor-only";
}

/**
 * Cycle the document split pane through its three view modes.
 *
 * `split` shows the editor and the preview side by side, `preview-only` hides
 * the editing pane, and `editor-only` hides the preview pane. The cycle is
 * total and deterministic so a toolbar button can toggle through all states.
 */
export function nextDocumentViewMode(mode: DocumentViewMode): DocumentViewMode {
  if (mode === "split") return "preview-only";
  if (mode === "preview-only") return "editor-only";
  return "split";
}

/** All document view modes in cycle order. */
export const DOCUMENT_VIEW_MODES: readonly DocumentViewMode[] = [
  "split",
  "preview-only",
  "editor-only",
];
