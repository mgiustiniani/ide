import type { EditorProps } from "./Editor";

const LANGUAGE_ALIASES: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  kotlin: "kotlin",
  kt: "kotlin",
  kts: "kotlin",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  python: "python",
  py: "python",
  shell: "shell",
  ini: "ini",
  adoc: "asciidoc",
  asciidoc: "asciidoc",
  css: "css",
  htm: "html",
  html: "html",
  java: "java",
  javascript: "javascript",
  javascriptreact: "javascript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  less: "less",
  markdown: "markdown",
  md: "markdown",
  plaintext: "plaintext",
  rest: "rst",
  rs: "rust",
  rst: "rst",
  rust: "rust",
  scss: "scss",
  text: "plaintext",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  typescriptreact: "typescript",
};

const EXTENSION_LANGUAGES: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  h: "cpp",
  hpp: "cpp",
  kt: "kotlin",
  kts: "kotlin",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  py: "python",
  sh: "shell",
  bash: "shell",
  properties: "ini",
  ini: "ini",
  adoc: "asciidoc",
  asciidoc: "asciidoc",
  css: "css",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  less: "less",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  rest: "rst",
  rs: "rust",
  rst: "rst",
  scss: "scss",
  text: "plaintext",
  txt: "plaintext",
  ts: "typescript",
  tsx: "typescript",
};

/** Resolve app/contract language names and common file extensions to Monaco IDs. */
export function getMonacoLanguage(language: EditorProps["language"], filePath: string): string {
  const declared = LANGUAGE_ALIASES[String(language || "").toLowerCase()];
  const extension = filePath.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (declared && declared !== "plaintext") return declared;
  return EXTENSION_LANGUAGES[extension] ?? declared ?? "plaintext";
}

/** A stable local URI gives every file its own Monaco model without network access. */
export function getMonacoModelPath(filePath: string): string {
  if (/^(?:file|refactorkit-java-source|refactorkit-java-platform-source):\/\//i.test(filePath))
    return filePath;
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return encodeURI(`file:///${normalized || "__untitled__"}`);
}
