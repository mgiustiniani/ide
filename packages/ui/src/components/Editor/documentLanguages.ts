// ---------------------------------------------------------------------------
// @ide/ui – Document language registration for Monaco
// ---------------------------------------------------------------------------
// Monarch token definitions for AsciiDoc and reStructuredText so the editor
// applies syntax highlighting for markup/documentation files.

import type * as Monaco from "monaco-editor";

export const ASCII_DOC_LANGUAGE_ID = "asciidoc";
export const RST_LANGUAGE_ID = "rst";
export const MARKDOWN_LANGUAGE_ID = "markdown";

/** Map a document kind to the Monaco language id used by the editor pane. */
export function getDocumentEditorLanguage(kind: string): string {
  if (kind === "asciidoc") return ASCII_DOC_LANGUAGE_ID;
  if (kind === "rst") return RST_LANGUAGE_ID;
  if (kind === "markdown") return MARKDOWN_LANGUAGE_ID;
  return "plaintext";
}

/** Register AsciiDoc and reStructuredText basic languages with Monaco. */
export function registerDocumentLanguages(monaco: typeof Monaco): void {
  monaco.languages.register({
    id: ASCII_DOC_LANGUAGE_ID,
    extensions: [".adoc", ".asciidoc"],
    aliases: ["AsciiDoc", "asciidoc"],
  });
  monaco.languages.setMonarchTokensProvider(ASCII_DOC_LANGUAGE_ID, {
    defaultToken: "",
    tokenPostfix: ".adoc",
    tokenizer: {
      root: [
        [/\/\/\/? .*$/, "comment"],
        [/^(=+)\s+.*$/, "type.identifier"],
        [/`[^`]*`/, "emphasis"],
        [/\*\*[^*]*\*\*/, "strong"],
      ],
    },
  });

  monaco.languages.register({
    id: RST_LANGUAGE_ID,
    extensions: [".rst", ".rest"],
    aliases: ["reStructuredText", "rst"],
  });
  monaco.languages.setMonarchTokensProvider(RST_LANGUAGE_ID, {
    defaultToken: "",
    tokenPostfix: ".rst",
    tokenizer: {
      root: [
        [/\.\.\s+.*$/, "comment"],
        [/^(={3,}|-{3,})\s*$/, "type.identifier"],
        [/`[^`]*`/, "emphasis"],
        [/\*\*[^*]*\*\*/, "strong"],
      ],
    },
  });
}
