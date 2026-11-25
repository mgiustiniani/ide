// ---------------------------------------------------------------------------
// @ide/web-core – EditorPort
// ---------------------------------------------------------------------------
// Port interface for reading / writing file content and managing open files.
// Concrete adapters implement this interface.

import type {
  OpenFile,
  EditorContent,
  EditorDiskSnapshot,
  EditorDiskInspectionContext,
  EditorDiskStatus,
} from "@ide/contracts";

export interface EditorPort {
  /** Inspect an unopened transaction source against its journal revision without adopting a save baseline. */
  inspectSourceRevision?(
    context: EditorDiskInspectionContext,
    filePath: string,
    revision: string,
  ): Promise<EditorDiskStatus>;
  /** Move save baselines and open-file metadata after a native, unchanged-saved-byte rename. */
  adoptRenamedFile?(oldPath: string, path: string, revision: string): Promise<void>;
  /** Load the content of the file at `filePath`. Returns content + detected language. */
  loadContent(filePath: string): Promise<EditorContent>;

  /** Read preview text without registering a tab or creating/changing a save baseline. */
  readPreviewContent?(filePath: string): Promise<Readonly<EditorContent>>;

  /** Save `content` to the file at `filePath`. Returns the updated OpenFile list. */
  saveContent(filePath: string, content: string): Promise<OpenFile[]>;

  /** Read without updating the save revision or writing any content; absent means unavailable. */
  inspectContent?(filePath: string): Promise<EditorDiskSnapshot>;

  /** Bounded revision-only detection. Never advances save baselines; null means invalidated in flight. */
  inspectDiskStatus?(
    context: EditorDiskInspectionContext,
    filePath: string,
  ): Promise<EditorDiskStatus | null>;

  /** Adopt an issued, still-current snapshot revision synchronously; never writes to disk. */
  acceptDiskSnapshot?(snapshot: EditorDiskSnapshot): void;

  /** Return the list of currently open files (persisted session, if any). */
  getOpenFiles(): Promise<OpenFile[]>;

  /**
   * Close provider session metadata, never source content. In-memory adapters commit
   * synchronously so the selected UI buffer can close in the same JavaScript turn.
   * Returned inventory does not authorize removing other UI buffers.
   */
  closeFile(filePath: string): OpenFile[] | Promise<OpenFile[]>;
}
