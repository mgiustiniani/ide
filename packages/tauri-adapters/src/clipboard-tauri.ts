import { invoke } from '@tauri-apps/api/core';
import type { ClipboardPort } from '@ide/web-core/ports';

const COMMAND = 'read_clipboard_text';

/** A deliberately redacted error: native failures can include clipboard contents. */
export class TauriClipboardReadError extends Error {
  readonly code = 'TAURI_CLIPBOARD_READ_FAILED';

  constructor() {
    super('Clipboard text could not be read.');
    this.name = 'TauriClipboardReadError';
  }
}

/** Reads the clipboard only in response to an explicit port call. */
export class TauriClipboardAdapter implements ClipboardPort {
  async readText(): Promise<string> {
    try {
      const value = await invoke<unknown>(COMMAND);
      if (typeof value !== 'string') throw new TauriClipboardReadError();
      return value;
    } catch {
      // Never retain or expose native rejection details: they may contain clipboard text.
      throw new TauriClipboardReadError();
    }
  }
}
