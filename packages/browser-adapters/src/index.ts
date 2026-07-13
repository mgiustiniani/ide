// ---------------------------------------------------------------------------
// @ide/browser-adapters
// Browser-safe adapter implementations for the IDE webapp.
// No Tauri dependency: uses localStorage when available and an in-memory
// fallback when browser storage is unavailable or rejects writes.
// ---------------------------------------------------------------------------

import type {
  FileNode,
  FileSelectionEvent,
  OpenFile,
  EditorContent,
  TerminalOutput,
  Language,
} from '@ide/contracts';
import type {
  FileTreePort,
  EditorPort,
  TerminalPort,
} from '@ide/web-core/ports';
import { BrowserClipboardAdapter } from './clipboard-browser';
import { BrowserLanguageSessionAdapter } from './language-session-browser';
import { BrowserRefactorKitAdapter } from './refactorkit-browser';
import { BrowserXcom2SetupAdapter } from './xcom2-setup-browser';
import { BrowserXcom2SetupMonitorAdapter } from './xcom2-setup-monitor-browser';

export {
  BrowserClipboardAdapter,
  BrowserClipboardReadDeniedError,
  BrowserClipboardUnavailableError,
} from './clipboard-browser';
export {
  BrowserLanguageSessionAdapter,
  BrowserLanguageSessionUnavailableError,
} from './language-session-browser';
export {
  BrowserRefactorKitAdapter,
  BrowserRefactorKitUnavailableError,
} from './refactorkit-browser';
export {
  BrowserXcom2SetupAdapter,
  BrowserXcom2SetupUnavailableError,
} from './xcom2-setup-browser';
export type { BrowserXcom2SetupOperation } from './xcom2-setup-browser';
export { BrowserXcom2SetupMonitorAdapter } from './xcom2-setup-monitor-browser';

// ── Storage helpers ─────────────────────────────────────────────────────

export const BROWSER_STORAGE_KEYS = {
  fileTree: 'ide_web_file_tree',
  fileContents: 'ide_web_file_contents',
  openFiles: 'ide_web_open_files',
} as const;

const volatileStorage = new Map<string, string>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readRaw(key: string): string | null {
  if (volatileStorage.has(key)) {
    return volatileStorage.get(key) ?? null;
  }

  const local = storage();
  if (!local) return null;

  try {
    return local.getItem(key);
  } catch {
    return null;
  }
}

function readJSON<T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => value is T,
): T {
  const raw = readRaw(key);
  if (raw === null) return cloneJSON(fallback);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) return cloneJSON(fallback);
    return parsed as T;
  } catch {
    return cloneJSON(fallback);
  }
}

function writeJSON(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  const local = storage();

  if (!local) {
    volatileStorage.set(key, serialized);
    return;
  }

  try {
    local.setItem(key, serialized);
    volatileStorage.delete(key);
  } catch {
    // Keep the adapter usable when localStorage is disabled, full, or blocked.
    volatileStorage.set(key, serialized);
  }
}

// ── Default file tree ───────────────────────────────────────────────────

const DEFAULT_ROOT_NODES: FileNode[] = [
  {
    id: 'folder-src',
    name: 'src',
    path: 'src',
    type: 'folder',
    isOpen: true,
    children: [
      {
        id: 'file-main.tsx',
        name: 'main.tsx',
        path: 'src/main.tsx',
        type: 'file',
      },
      {
        id: 'file-App.tsx',
        name: 'App.tsx',
        path: 'src/App.tsx',
        type: 'file',
      },
    ],
  },
  {
    id: 'folder-packages',
    name: 'packages',
    path: 'packages',
    type: 'folder',
    isOpen: false,
    children: [
      {
        id: 'file-index.ts',
        name: 'index.ts',
        path: 'packages/index.ts',
        type: 'file',
      },
    ],
  },
  {
    id: 'folder-public',
    name: 'public',
    path: 'public',
    type: 'folder',
    isOpen: false,
    children: [
      {
        id: 'file-index.html',
        name: 'index.html',
        path: 'public/index.html',
        type: 'file',
      },
    ],
  },
];

const DEFAULT_FILE_CONTENTS: Record<string, string> = {
  'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
  'src/App.tsx': `import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="app">
      <h1>Hello from IDE</h1>
      <button onClick={() => setCount((c) => c + 1)}>
        Clicked {count} times
      </button>
    </div>
  );
}`,
  'packages/index.ts': `export const VERSION = '0.1.0';`,
  'public/index.html': `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>IDE</title></head>
  <body><div id="root"></div></body>
</html>`,
};

// ── Validation helpers ─────────────────────────────────────────────────

const INVALID_NAME_PATTERN = /[\\/\0-\x1F\x7F]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNode(value: unknown): value is FileNode {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.path !== 'string') return false;
  if (value.type !== 'file' && value.type !== 'folder') return false;
  if (value.children !== undefined && !isFileNodeArray(value.children)) return false;
  if (value.isOpen !== undefined && typeof value.isOpen !== 'boolean') return false;
  return true;
}

function isFileNodeArray(value: unknown): value is FileNode[] {
  return Array.isArray(value) && value.every(isFileNode);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isOpenFile(value: unknown): value is OpenFile {
  if (!isRecord(value)) return false;
  return (
    typeof value.filePath === 'string' &&
    typeof value.name === 'string' &&
    typeof value.language === 'string' &&
    typeof value.openedAt === 'number'
  );
}

function isOpenFileArray(value: unknown): value is OpenFile[] {
  return Array.isArray(value) && value.every(isOpenFile);
}

function validateNodeName(name: string): void {
  if (name.trim() !== name || name.length === 0) {
    throw new Error('File or folder name cannot be empty or padded with whitespace.');
  }

  if (name === '.' || name === '..' || INVALID_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid file or folder name: ${name}`);
  }
}

function parsePath(path: string): string[] {
  if (path.trim() !== path || path.length === 0 || path.startsWith('/') || path.endsWith('/')) {
    throw new Error(`Invalid path: ${path}`);
  }

  if (path.includes('\\') || path.includes('//')) {
    throw new Error(`Invalid path: ${path}`);
  }

  const segments = path.split('/');
  for (const segment of segments) {
    validateNodeName(segment);
  }

  return segments;
}

function parentPathForSegments(segments: string[]): string {
  return segments.slice(0, -1).join('/');
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) return `${newPrefix}${path.slice(oldPrefix.length)}`;
  return path;
}

// ── Language detection ─────────────────────────────────────────────────

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

// ── BrowserFileTreeAdapter ─────────────────────────────────────────────

export class BrowserFileTreeAdapter implements FileTreePort {
  private selectionCallback: ((event: FileSelectionEvent) => void) | null = null;

  async getRoot(): Promise<FileNode[]> {
    return readJSON<FileNode[]>(
      BROWSER_STORAGE_KEYS.fileTree,
      DEFAULT_ROOT_NODES,
      isFileNodeArray,
    );
  }

  async getChildren(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const folder = this.findFolder(nodes, parsePath(path));
    return folder?.children ?? [];
  }

  async createFile(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = parsePath(path);
    const fileName = segments.at(-1)!;
    const parent = this.findParentChildren(nodes, segments);

    this.assertParent(parent, path);
    this.assertUniqueName(parent.children, fileName);

    parent.children.push({
      id: `file-${path.replace(/\//g, '-')}`,
      name: fileName,
      path,
      type: 'file',
    });

    writeJSON(BROWSER_STORAGE_KEYS.fileTree, nodes);
    return parent.children;
  }

  async createFolder(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = parsePath(path);
    const folderName = segments.at(-1)!;
    const parent = this.findParentChildren(nodes, segments);

    this.assertParent(parent, path);
    this.assertUniqueName(parent.children, folderName);

    parent.children.push({
      id: `folder-${path.replace(/\//g, '-')}`,
      name: folderName,
      path,
      type: 'folder',
      isOpen: false,
      children: [],
    });

    writeJSON(BROWSER_STORAGE_KEYS.fileTree, nodes);
    return parent.children;
  }

  async delete(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = parsePath(path);
    const targetName = segments.at(-1)!;
    const parent = this.findParentChildren(nodes, segments);

    this.assertParent(parent, path);

    const index = parent.children.findIndex((node) => node.name === targetName);
    if (index === -1) return parent.children;

    parent.children.splice(index, 1);
    writeJSON(BROWSER_STORAGE_KEYS.fileTree, nodes);
    this.deletePersistedContent(path);
    this.deletePersistedOpenFiles(path);

    return parent.children;
  }

  async rename(path: string, newName: string): Promise<FileNode[]> {
    validateNodeName(newName);

    const nodes = await this.getRoot();
    const segments = parsePath(path);
    const oldName = segments.at(-1)!;
    const parentPath = parentPathForSegments(segments);
    const parent = this.findParentChildren(nodes, segments);

    this.assertParent(parent, path);

    const node = parent.children.find((candidate) => candidate.name === oldName);
    if (!node) return parent.children;

    if (newName !== oldName) {
      this.assertUniqueName(parent.children, newName);
    }

    const oldPath = node.path;
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    node.name = newName;
    this.updateNodePathRecursive(node, oldPath, newPath);
    writeJSON(BROWSER_STORAGE_KEYS.fileTree, nodes);
    this.renamePersistedContent(oldPath, newPath);
    this.renamePersistedOpenFiles(oldPath, newPath);

    return parent.children;
  }

  onFileSelect(callback: (event: FileSelectionEvent) => void): () => void {
    this.selectionCallback = callback;
    return () => {
      this.selectionCallback = null;
    };
  }

  selectFile(path: string, node: FileNode): void {
    this.selectionCallback?.({ filePath: path, node });
  }

  private findParentChildren(
    nodes: FileNode[],
    segments: string[],
  ): { children: FileNode[] } | null {
    const parentSegments = segments.slice(0, -1);
    if (parentSegments.length === 0) return { children: nodes };

    const folder = this.findFolder(nodes, parentSegments);
    if (!folder) return null;
    folder.children ??= [];
    return { children: folder.children };
  }

  private findFolder(nodes: FileNode[], segments: string[]): FileNode | null {
    let current = nodes;
    let folder: FileNode | null = null;

    for (const segment of segments) {
      folder = current.find(
        (node) => node.type === 'folder' && node.name === segment,
      ) ?? null;
      if (!folder) return null;
      current = folder.children ?? [];
    }

    return folder;
  }

  private assertParent(
    parent: { children: FileNode[] } | null,
    path: string,
  ): asserts parent is { children: FileNode[] } {
    if (!parent) {
      throw new Error(`Parent folder does not exist for path: ${path}`);
    }
  }

  private assertUniqueName(siblings: FileNode[], name: string): void {
    if (siblings.some((node) => node.name === name)) {
      throw new Error(`A file or folder named "${name}" already exists.`);
    }
  }

  private updateNodePathRecursive(node: FileNode, oldPath: string, newPath: string): void {
    node.path = replacePathPrefix(node.path, oldPath, newPath);

    for (const child of node.children ?? []) {
      this.updateNodePathRecursive(child, oldPath, newPath);
    }
  }

  private deletePersistedContent(path: string): void {
    const contents = readJSON<Record<string, string>>(
      BROWSER_STORAGE_KEYS.fileContents,
      DEFAULT_FILE_CONTENTS,
      isStringRecord,
    );

    for (const key of Object.keys(contents)) {
      if (key === path || key.startsWith(`${path}/`)) {
        delete contents[key];
      }
    }

    writeJSON(BROWSER_STORAGE_KEYS.fileContents, contents);
  }

  private deletePersistedOpenFiles(path: string): void {
    const openFiles = readJSON<OpenFile[]>(
      BROWSER_STORAGE_KEYS.openFiles,
      [],
      isOpenFileArray,
    ).filter((file) => file.filePath !== path && !file.filePath.startsWith(`${path}/`));

    writeJSON(BROWSER_STORAGE_KEYS.openFiles, openFiles);
  }

  private renamePersistedContent(oldPath: string, newPath: string): void {
    const contents = readJSON<Record<string, string>>(
      BROWSER_STORAGE_KEYS.fileContents,
      DEFAULT_FILE_CONTENTS,
      isStringRecord,
    );
    const renamed: Record<string, string> = {};

    for (const [key, value] of Object.entries(contents)) {
      renamed[replacePathPrefix(key, oldPath, newPath)] = value;
    }

    writeJSON(BROWSER_STORAGE_KEYS.fileContents, renamed);
  }

  private renamePersistedOpenFiles(oldPath: string, newPath: string): void {
    const openFiles = readJSON<OpenFile[]>(
      BROWSER_STORAGE_KEYS.openFiles,
      [],
      isOpenFileArray,
    ).map((file) => {
      const filePath = replacePathPrefix(file.filePath, oldPath, newPath);
      return {
        ...file,
        filePath,
        name: filePath.split('/').pop() ?? file.name,
        language: detectLanguage(filePath),
      };
    });

    writeJSON(BROWSER_STORAGE_KEYS.openFiles, openFiles);
  }
}

// ── BrowserEditorAdapter ───────────────────────────────────────────────

export class BrowserEditorAdapter implements EditorPort {
  async loadContent(filePath: string): Promise<EditorContent> {
    const contents = readJSON<Record<string, string>>(
      BROWSER_STORAGE_KEYS.fileContents,
      DEFAULT_FILE_CONTENTS,
      isStringRecord,
    );

    return {
      filePath,
      content: contents[filePath] ?? '',
      language: detectLanguage(filePath),
    };
  }

  async saveContent(filePath: string, content: string): Promise<OpenFile[]> {
    parsePath(filePath);

    const contents = readJSON<Record<string, string>>(
      BROWSER_STORAGE_KEYS.fileContents,
      DEFAULT_FILE_CONTENTS,
      isStringRecord,
    );
    contents[filePath] = content;
    writeJSON(BROWSER_STORAGE_KEYS.fileContents, contents);

    const openFiles = await this.getOpenFiles();
    const existing = openFiles.findIndex((file) => file.filePath === filePath);
    const fileName = filePath.split('/').pop() ?? filePath;
    const language = detectLanguage(filePath);

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

    writeJSON(BROWSER_STORAGE_KEYS.openFiles, openFiles);
    return openFiles;
  }

  async getOpenFiles(): Promise<OpenFile[]> {
    return readJSON<OpenFile[]>(
      BROWSER_STORAGE_KEYS.openFiles,
      [],
      isOpenFileArray,
    );
  }

  async closeFile(filePath: string): Promise<OpenFile[]> {
    const openFiles = (await this.getOpenFiles()).filter(
      (file) => file.filePath !== filePath,
    );
    writeJSON(BROWSER_STORAGE_KEYS.openFiles, openFiles);
    return openFiles;
  }
}

// ── BrowserTerminalAdapter ─────────────────────────────────────────────

export class BrowserTerminalAdapter implements TerminalPort {
  private outputCallbacks: Array<(output: TerminalOutput) => void> = [];
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private _cols = 80;
  private _rows = 24;

  async executeCommand(command: string): Promise<void> {
    const trimmed = command.trim();

    this.emitOutput({ text: `$ ${trimmed}`, type: 'input', timestamp: Date.now() });

    if (!trimmed) return;

    if (trimmed === 'clear' || trimmed === 'cls') {
      this.emitOutput({ text: '', type: 'system', timestamp: Date.now() });
      return;
    }

    if (trimmed === 'exit') {
      this.emitOutput({ text: 'Session terminated.', type: 'system', timestamp: Date.now() });
      this.emitExit(0);
      return;
    }

    if (trimmed === 'ls' || trimmed.startsWith('ls ')) {
      this.emitOutput({ text: 'README.md  src/  packages/  public/', type: 'stdout', timestamp: Date.now() });
      return;
    }

    if (trimmed === 'pwd') {
      this.emitOutput({ text: '/home/user/project', type: 'stdout', timestamp: Date.now() });
      return;
    }

    if (trimmed === 'echo hello') {
      this.emitOutput({ text: 'hello', type: 'stdout', timestamp: Date.now() });
      return;
    }

    this.emitOutput({
      text: `[simulated] Command not implemented: ${trimmed}`,
      type: 'stderr',
      timestamp: Date.now(),
    });
  }

  async resize(cols: number, rows: number): Promise<void> {
    this._cols = cols;
    this._rows = rows;
  }

  onOutput(callback: (output: TerminalOutput) => void): () => void {
    this.outputCallbacks.push(callback);
    return () => {
      const index = this.outputCallbacks.indexOf(callback);
      if (index >= 0) this.outputCallbacks.splice(index, 1);
    };
  }

  onExit(callback: (code: number | null) => void): () => void {
    this.exitCallbacks.push(callback);
    return () => {
      const index = this.exitCallbacks.indexOf(callback);
      if (index >= 0) this.exitCallbacks.splice(index, 1);
    };
  }

  startSession(): void {
    this.emitOutput({ text: 'Welcome to IDE Terminal (simulated)', type: 'system', timestamp: Date.now() });
    this.emitOutput({ text: 'Type "exit" to close the session.', type: 'system', timestamp: Date.now() });
  }

  stopSession(): void {
    this.emitOutput({ text: 'Session ended.', type: 'system', timestamp: Date.now() });
  }

  private emitOutput(output: TerminalOutput): void {
    for (const callback of this.outputCallbacks) {
      callback(output);
    }
  }

  private emitExit(code: number | null): void {
    for (const callback of this.exitCallbacks) {
      callback(code);
    }
  }
}

// ── createBrowserAdapters ──────────────────────────────────────────────

export interface BrowserAdapters {
  fileTreeAdapter: BrowserFileTreeAdapter;
  editorAdapter: BrowserEditorAdapter;
  terminalAdapter: BrowserTerminalAdapter;
  clipboardAdapter: BrowserClipboardAdapter;
  languageSessionAdapter: BrowserLanguageSessionAdapter;
  refactorKitAdapter: BrowserRefactorKitAdapter;
  xcom2SetupAdapter: BrowserXcom2SetupAdapter;
  xcom2SetupMonitorAdapter: BrowserXcom2SetupMonitorAdapter;
}

export function createBrowserAdapters(): BrowserAdapters {
  return {
    fileTreeAdapter: new BrowserFileTreeAdapter(),
    editorAdapter: new BrowserEditorAdapter(),
    terminalAdapter: new BrowserTerminalAdapter(),
    clipboardAdapter: new BrowserClipboardAdapter(),
    languageSessionAdapter: new BrowserLanguageSessionAdapter(),
    refactorKitAdapter: new BrowserRefactorKitAdapter(),
    xcom2SetupAdapter: new BrowserXcom2SetupAdapter(),
    xcom2SetupMonitorAdapter: new BrowserXcom2SetupMonitorAdapter(),
  };
}
