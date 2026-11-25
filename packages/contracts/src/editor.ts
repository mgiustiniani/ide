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
  /** A proposed new source file that exists only in the editor until its first save. */
  isNew?: boolean;
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

/** Existing Eclipse formatter profile selected for a workspace. */
export interface JavaFormatterProfile {
  /** Workspace-relative path to an Eclipse formatter profile XML file. */
  path: string;
  /** Exact profile name stored in the XML file. */
  profileName: string;
}

/** Workspace-scoped indentation and optional Eclipse formatter profile. */
export interface WorkspaceEditorPreferences {
  tabSize: number;
  insertSpaces: boolean;
  javaFormatterProfile?: JavaFormatterProfile;
  /** Opt in to server-provided Java formatting after typing; disabled when omitted. */
  formatJavaOnType?: boolean;
}

export const DEFAULT_WORKSPACE_EDITOR_PREFERENCES: Readonly<WorkspaceEditorPreferences> =
  Object.freeze({ tabSize: 2, insertSpaces: true });

/** Content of a single open file. */
export interface EditorContent {
  filePath: string;
  content: string;
  /** The detected or assigned language. */
  language: Language;
}

/** Correlation for a read-only, current-workspace disk revision check. */
export interface EditorDiskInspectionContext {
  readonly workspaceId: string;
  readonly generation: number;
}

/** Detection only: no content, replacement token or mutation authority. */
export interface EditorDiskStatus {
  readonly filePath: string;
  readonly status: "unchanged" | "changed" | "missing" | "unavailable";
}

/** Immutable disk read; inspection must not advance the adapter's save baseline. */
export interface EditorDiskSnapshot extends Readonly<EditorContent> {
  readonly revision: string;
  readonly changedSinceRead: boolean;
}

/** A read-only comparison; replacing the buffer requires separate explicit confirmation. */
export interface EditorDiskComparison {
  readonly filePath: string;
  readonly bufferContent: string;
  readonly diskSnapshot: EditorDiskSnapshot;
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
  | "typescript"
  | "javascript"
  | "rust"
  | "css"
  | "html"
  | "json"
  | "markdown"
  | "asciidoc"
  | "rst"
  | "yaml"
  | "toml"
  | "shell"
  | string;
