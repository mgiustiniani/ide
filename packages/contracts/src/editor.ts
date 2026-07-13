// ---------------------------------------------------------------------------
// @ide/contracts – Editor Types
// ---------------------------------------------------------------------------
// Shared types for the code editor domain.

/** A file currently open in the editor. */
export interface OpenFile {
  /** Absolute or relative path of the file. */
  filePath: string;
  /** Display name (e.g. "main.ts"). */
  name: string;
  /** Language identifier for syntax highlighting. */
  language: Language;
  /** Timestamp when the file was opened. */
  openedAt: number;
}

/** A single tab in the editor tab bar. */
export interface EditorTab {
  /** The open file this tab represents. */
  filePath: string;
  /** Whether the file has unsaved changes. */
  isDirty: boolean;
  /** Whether this tab is the active (focused) tab. */
  isActive: boolean;
}

/** The overall state of the editor panel. */
export interface EditorState {
  /** All currently open files. */
  openFiles: OpenFile[];
  /** Ordered list of tabs (first = active if isActive). */
  tabs: EditorTab[];
  /** Path of the currently active file. */
  activeFilePath: string | null;
  /** Cursor position for the active file. */
  cursorPosition: CursorPosition | null;
  /** Whether the editor is loading content. */
  isLoading: boolean;
}

/** Content of a single open file. */
export interface EditorContent {
  filePath: string;
  content: string;
  /** The detected or assigned language. */
  language: Language;
}

/** Position of the cursor in the editor. */
export interface CursorPosition {
  /** 1‑based line number. */
  line: number;
  /** 1‑based column number. */
  column: number;
}

/** Programming / markup language identifier. */
export type Language =
  | 'typescript'
  | 'javascript'
  | 'rust'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'toml'
  | 'shell'
  | string;
