// ---------------------------------------------------------------------------
// @ide/tauri-adapters – TauriEditorAdapter
// ---------------------------------------------------------------------------
// Implements EditorPort by invoking Tauri Rust commands:
//   read_file, write_file
// ---------------------------------------------------------------------------

import { TauriAdapterError, invokeTauri } from './errors';
import type { OpenFile, EditorContent, Language } from '@ide/contracts';
import type { EditorPort } from '@ide/web-core/ports';

/**
 * Extension-to-language mapping for when the Rust side doesn't return
 * a recognized language or for fallback detection.
 */
const EXTENSION_LANG_MAP: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  css: 'css',
  html: 'html',
  json: 'json',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'shell',
};

function detectLanguage(filePath: string): Language {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_LANG_MAP[ext] ?? 'plaintext';
}

export interface TauriEditorAdapterOptions {
  readTimeoutMs?: number;
}

const DEFAULT_READ_TIMEOUT_MS = 10_000;

export class TauriEditorAdapter implements EditorPort {
  private readonly readTimeoutMs: number;

  constructor(options: TauriEditorAdapterOptions = {}) {
    const configuredTimeout = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this.readTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_READ_TIMEOUT_MS;
  }

  /** Load the content of the file at `filePath`. */
  async loadContent(filePath: string): Promise<EditorContent> {
    // Rust command signature is `read_file(path: String)`, so the Tauri
    // argument key must stay exactly `path`.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TauriAdapterError('read_file', 'File read timed out'));
      }, this.readTimeoutMs);
    });

    let result: Record<string, unknown>;
    try {
      result = await Promise.race([
        invokeTauri<Record<string, unknown>>('read_file', { path: filePath }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (typeof result.content !== 'string') {
      throw new TauriAdapterError('read_file', 'Invalid read_file response: missing string content');
    }

    const content = result.content;
    const language = typeof result.language === 'string' && result.language.length > 0
      ? result.language
      : detectLanguage(filePath);

    const openFiles = await this.getOpenFiles();
    if (!openFiles.some((file) => file.filePath === filePath)) {
      openFiles.push({
        filePath,
        name: filePath.split('/').pop() ?? filePath,
        language: language as Language,
        openedAt: Date.now(),
      });
      this._openFiles = openFiles;
    }

    return {
      filePath,
      content,
      language: language as Language,
    };
  }

  /** Save `content` to the file at `filePath`. Returns the updated OpenFile list. */
  async saveContent(filePath: string, content: string): Promise<OpenFile[]> {
    await invokeTauri<Record<string, unknown>>('write_file', {
      path: filePath,
      content,
    });

    // After saving, return the current open-files list.
    // The Rust side doesn't maintain an open-files session, so we
    // reconstruct from a simple in-memory array.
    const openFiles = await this.getOpenFiles();
    const fileName = filePath.split('/').pop() ?? filePath;
    const language = detectLanguage(filePath);

    const existing = openFiles.findIndex((f) => f.filePath === filePath);
    if (existing >= 0) {
      openFiles[existing] = {
        filePath,
        name: fileName,
        language,
        openedAt: openFiles[existing].openedAt,
      };
    } else {
      openFiles.push({
        filePath,
        name: fileName,
        language,
        openedAt: Date.now(),
      });
    }

    this._openFiles = openFiles;
    return openFiles;
  }

  /** In-memory list of open files (not persisted to Rust). */
  private _openFiles: OpenFile[] = [];

  /** Return the list of currently open files. */
  async getOpenFiles(): Promise<OpenFile[]> {
    return this._openFiles;
  }

  /** Close the file at `filePath`. Returns the updated OpenFile list. */
  async closeFile(filePath: string): Promise<OpenFile[]> {
    this._openFiles = this._openFiles.filter(
      (f) => f.filePath !== filePath,
    );
    return this._openFiles;
  }
}
