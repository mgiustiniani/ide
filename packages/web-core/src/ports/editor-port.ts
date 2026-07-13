// ---------------------------------------------------------------------------
// @ide/web-core – EditorPort
// ---------------------------------------------------------------------------
// Port interface for reading / writing file content and managing open files.
// Concrete adapters implement this interface.

import type { OpenFile, EditorContent } from '@ide/contracts';

export interface EditorPort {
  /** Load the content of the file at `filePath`. Returns content + detected language. */
  loadContent(filePath: string): Promise<EditorContent>;

  /** Save `content` to the file at `filePath`. Returns the updated OpenFile list. */
  saveContent(filePath: string, content: string): Promise<OpenFile[]>;

  /** Return the list of currently open files (persisted session, if any). */
  getOpenFiles(): Promise<OpenFile[]>;

  /** Close the file at `filePath`. Returns the updated OpenFile list. */
  closeFile(filePath: string): Promise<OpenFile[]>;
}
