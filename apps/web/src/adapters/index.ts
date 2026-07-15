// ---------------------------------------------------------------------------
// apps/web/src/adapters/index.ts
// Browser-safe adapter implementations for the IDE webapp.
// No Tauri dependency – uses localStorage and in-memory simulated state.
// ---------------------------------------------------------------------------

import type {
  FileNode,
  FileSelectionEvent,
  OpenFile,
  EditorContent,
  TerminalOutput,
  Language,
} from "@ide/contracts";
import type { FileTreePort } from "@ide/web-core/ports";
import type { EditorPort } from "@ide/web-core/ports";
import type { TerminalPort } from "@ide/web-core/ports";

// ── Helpers ────────────────────────────────────────────────────────────

const LS_KEY_FILE_TREE = "ide_web_file_tree";
const LS_KEY_FILE_CONTENTS = "ide_web_file_contents";
const LS_KEY_OPEN_FILES = "ide_web_open_files";

/**
 * Read JSON from localStorage with a safe fallback.
 */
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Write JSON to localStorage.
 */
function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Default file tree ──────────────────────────────────────────────────

const DEFAULT_ROOT_NODES: FileNode[] = [
  {
    id: "folder-src",
    name: "src",
    path: "src",
    type: "folder",
    isOpen: true,
    children: [
      {
        id: "file-main.tsx",
        name: "main.tsx",
        path: "src/main.tsx",
        type: "file",
      },
      {
        id: "file-App.tsx",
        name: "App.tsx",
        path: "src/App.tsx",
        type: "file",
      },
    ],
  },
  {
    id: "folder-packages",
    name: "packages",
    path: "packages",
    type: "folder",
    isOpen: false,
    children: [
      {
        id: "file-index.ts",
        name: "index.ts",
        path: "packages/index.ts",
        type: "file",
      },
    ],
  },
  {
    id: "folder-public",
    name: "public",
    path: "public",
    type: "folder",
    isOpen: false,
    children: [
      {
        id: "file-index.html",
        name: "index.html",
        path: "public/index.html",
        type: "file",
      },
    ],
  },
];

const DEFAULT_FILE_CONTENTS: Record<string, string> = {
  "src/main.tsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
  "src/App.tsx": `import { useState } from 'react';

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
  "packages/index.ts": `export const VERSION = '0.1.0';`,
  "public/index.html": `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>IDE</title></head>
  <body><div id="root"></div></body>
</html>`,
};

// ── Language detection ─────────────────────────────────────────────────

const EXTENSION_LANG_MAP: Record<string, Language> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  rs: "rust",
  css: "css",
  html: "html",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "shell",
};

function detectLanguage(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANG_MAP[ext] ?? "plaintext";
}

// ── BrowserFileTreeAdapter ─────────────────────────────────────────────

export class BrowserFileTreeAdapter implements FileTreePort {
  /**
   * Retrieve the root-level nodes from localStorage, falling back to defaults.
   */
  async getRoot(): Promise<FileNode[]> {
    const nodes = readJSON<FileNode[]>(LS_KEY_FILE_TREE, DEFAULT_ROOT_NODES);
    return nodes;
  }

  /**
   * Return the children of the folder at the given path.
   */
  async getChildren(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = path.split("/").filter(Boolean);

    let current: FileNode[] = nodes;
    for (const seg of segments) {
      const found = current.find((n) => n.type === "folder" && n.name === seg);
      if (!found || !found.children) return [];
      current = found.children;
    }

    return current;
  }

  /**
   * Create a new file at `path`. Returns the updated parent node list.
   */
  async createFile(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = path.split("/").filter(Boolean);
    const fileName = segments.pop()!;

    const parentPath = segments.join("/");
    const parent = parentPath ? this.findFolder(nodes, parentPath) : { children: nodes };

    if (!parent) return nodes;

    const newNode: FileNode = {
      id: `file-${path.replace(/\//g, "-")}`,
      name: fileName,
      path,
      type: "file",
    };

    parent.children!.push(newNode);
    writeJSON(LS_KEY_FILE_TREE, nodes);
    return parent.children!;
  }

  /**
   * Create a new folder at `path`. Returns the updated parent node list.
   */
  async createFolder(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = path.split("/").filter(Boolean);
    const folderName = segments.pop()!;

    const parentPath = segments.join("/");
    const parent = parentPath ? this.findFolder(nodes, parentPath) : { children: nodes };

    if (!parent) return nodes;

    const newNode: FileNode = {
      id: `folder-${path.replace(/\//g, "-")}`,
      name: folderName,
      path,
      type: "folder",
      isOpen: false,
      children: [],
    };

    parent.children!.push(newNode);
    writeJSON(LS_KEY_FILE_TREE, nodes);
    return parent.children!;
  }

  /**
   * Delete the node at `path`. Returns the updated parent node list.
   */
  async delete(path: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = path.split("/").filter(Boolean);
    const targetName = segments.pop()!;

    const parentPath = segments.join("/");
    const parent = parentPath ? this.findFolder(nodes, parentPath) : { children: nodes };

    if (!parent) return nodes;

    parent.children = parent.children!.filter((n) => n.name !== targetName);
    writeJSON(LS_KEY_FILE_TREE, nodes);

    // Also clean up cached content.
    const contents = readJSON<Record<string, string>>(LS_KEY_FILE_CONTENTS, {});
    delete contents[path];
    writeJSON(LS_KEY_FILE_CONTENTS, contents);

    return parent.children!;
  }

  /**
   * Rename a node from `path` to `newName`. Returns the updated parent node list.
   */
  async rename(path: string, newName: string): Promise<FileNode[]> {
    const nodes = await this.getRoot();
    const segments = path.split("/").filter(Boolean);
    const oldName = segments.pop()!;

    const parentPath = segments.join("/");
    const parent = parentPath ? this.findFolder(nodes, parentPath) : { children: nodes };

    if (!parent) return nodes;

    const node = parent.children!.find((n) => n.name === oldName);
    if (node) {
      node.name = newName;
      node.path = parentPath ? `${parentPath}/${newName}` : newName;

      // Move cached content if the node is a file.
      if (node.type === "file") {
        const contents = readJSON<Record<string, string>>(LS_KEY_FILE_CONTENTS, {});
        if (path in contents) {
          contents[node.path] = contents[path];
          delete contents[path];
          writeJSON(LS_KEY_FILE_CONTENTS, contents);
        }
      }
    }

    writeJSON(LS_KEY_FILE_TREE, nodes);
    return parent.children!;
  }

  /**
   * Subscribe to file selection events.
   * Browser adapter: fires events synchronously when selectFile is called externally.
   * For simplicity, we store a single callback.
   */
  private selectionCallback: ((event: FileSelectionEvent) => void) | null = null;

  onFileSelect(callback: (event: FileSelectionEvent) => void): () => void {
    this.selectionCallback = callback;
    return () => {
      this.selectionCallback = null;
    };
  }

  /**
   * Programmatically trigger a file selection event (used by view model).
   */
  selectFile(path: string, node: FileNode): void {
    this.selectionCallback?.({ filePath: path, node });
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private findFolder(nodes: FileNode[], path: string): { children: FileNode[] } | null {
    const segments = path.split("/").filter(Boolean);
    let current: FileNode[] = nodes;
    for (const seg of segments) {
      const found = current.find((n) => n.type === "folder" && n.name === seg);
      if (!found) return null;
      current = found.children ?? [];
    }
    return { children: current };
  }
}

// ── BrowserEditorAdapter ───────────────────────────────────────────────

export class BrowserEditorAdapter implements EditorPort {
  /**
   * Load the content of the file at `filePath`.
   * Reads from localStorage, falling back to the default contents.
   */
  async loadContent(filePath: string): Promise<EditorContent> {
    const contents = readJSON<Record<string, string>>(LS_KEY_FILE_CONTENTS, DEFAULT_FILE_CONTENTS);

    const content = contents[filePath] ?? "";
    const language = detectLanguage(filePath);

    return { filePath, content, language };
  }

  /**
   * Save `content` to the file at `filePath`.
   * Also updates the open-files list in localStorage.
   */
  async saveContent(filePath: string, content: string): Promise<OpenFile[]> {
    // Persist content.
    const contents = readJSON<Record<string, string>>(LS_KEY_FILE_CONTENTS, DEFAULT_FILE_CONTENTS);
    contents[filePath] = content;
    writeJSON(LS_KEY_FILE_CONTENTS, contents);

    // Update open-files list.
    const openFiles = await this.getOpenFiles();
    const existing = openFiles.findIndex((f) => f.filePath === filePath);
    const fileName = filePath.split("/").pop() ?? filePath;
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

    writeJSON(LS_KEY_OPEN_FILES, openFiles);
    return openFiles;
  }

  /**
   * Return the list of currently open files from localStorage.
   */
  async getOpenFiles(): Promise<OpenFile[]> {
    return readJSON<OpenFile[]>(LS_KEY_OPEN_FILES, []);
  }

  /**
   * Close the file at `filePath`. Returns the updated OpenFile list.
   */
  async closeFile(filePath: string): Promise<OpenFile[]> {
    const openFiles = await this.getOpenFiles();
    const filtered = openFiles.filter((f) => f.filePath !== filePath);
    writeJSON(LS_KEY_OPEN_FILES, filtered);
    return filtered;
  }
}

// ── BrowserTerminalAdapter ─────────────────────────────────────────────

export class BrowserTerminalAdapter implements TerminalPort {
  /** Callback for new output lines. */
  private outputCallbacks: Array<(output: TerminalOutput) => void> = [];

  /** Callback for session exit events. */
  private exitCallbacks: Array<(code: number | null) => void> = [];

  /** Simulated terminal dimensions. */
  private _cols = 80;
  private _rows = 24;

  /**
   * Execute a single command: echoes the input and a simulated result.
   */
  async executeCommand(command: string): Promise<void> {
    const trimmed = command.trim();

    // Echo input.
    this.emitOutput({ text: `$ ${trimmed}`, type: "input", timestamp: Date.now() });

    if (!trimmed) {
      return;
    }

    // Simulate a few well-known commands.
    if (trimmed === "clear" || trimmed === "cls") {
      // Clear is handled by the view model; we just emit a system marker.
      this.emitOutput({
        text: "",
        type: "system",
        timestamp: Date.now(),
      });
      return;
    }

    if (trimmed === "exit") {
      this.emitOutput({
        text: "Session terminated.",
        type: "system",
        timestamp: Date.now(),
      });
      this.emitExit(0);
      return;
    }

    if (trimmed === "ls" || trimmed.startsWith("ls ")) {
      this.emitOutput({
        text: "README.md  src/  packages/  public/",
        type: "stdout",
        timestamp: Date.now(),
      });
      return;
    }

    if (trimmed === "pwd") {
      this.emitOutput({
        text: "/home/user/project",
        type: "stdout",
        timestamp: Date.now(),
      });
      return;
    }

    if (trimmed === "echo hello") {
      this.emitOutput({
        text: "hello",
        type: "stdout",
        timestamp: Date.now(),
      });
      return;
    }

    // Generic fallback.
    this.emitOutput({
      text: `[simulated] Command not implemented: ${trimmed}`,
      type: "stderr",
      timestamp: Date.now(),
    });
  }

  /**
   * Resize the terminal emulator dimensions.
   */
  async resize(cols: number, rows: number): Promise<void> {
    this._cols = cols;
    this._rows = rows;
  }

  /**
   * Subscribe to new output lines.
   */
  onOutput(callback: (output: TerminalOutput) => void): () => void {
    this.outputCallbacks.push(callback);
    return () => {
      const idx = this.outputCallbacks.indexOf(callback);
      if (idx >= 0) this.outputCallbacks.splice(idx, 1);
    };
  }

  /**
   * Subscribe to session exit events.
   */
  onExit(callback: (code: number | null) => void): () => void {
    this.exitCallbacks.push(callback);
    return () => {
      const idx = this.exitCallbacks.indexOf(callback);
      if (idx >= 0) this.exitCallbacks.splice(idx, 1);
    };
  }

  /**
   * Start a simulated shell session.
   */
  startSession(): void {
    this.emitOutput({
      text: "Welcome to IDE Terminal (simulated)",
      type: "system",
      timestamp: Date.now(),
    });
    this.emitOutput({
      text: 'Type "exit" to close the session.',
      type: "system",
      timestamp: Date.now(),
    });
  }

  /**
   * Stop the simulated shell session.
   */
  stopSession(): void {
    this.emitOutput({
      text: "Session ended.",
      type: "system",
      timestamp: Date.now(),
    });
  }

  // ── Emit helpers ───────────────────────────────────────────────────

  private emitOutput(output: TerminalOutput): void {
    for (const cb of this.outputCallbacks) {
      cb(output);
    }
  }

  private emitExit(code: number | null): void {
    for (const cb of this.exitCallbacks) {
      cb(code);
    }
  }
}

// ── createBrowserAdapters ──────────────────────────────────────────────

/**
 * Factory function that returns a tuple of all browser-safe adapters.
 * Useful for dependency-injection setups in the webapp bootstrap.
 */
export function createBrowserAdapters(): {
  fileTreeAdapter: BrowserFileTreeAdapter;
  editorAdapter: BrowserEditorAdapter;
  terminalAdapter: BrowserTerminalAdapter;
} {
  return {
    fileTreeAdapter: new BrowserFileTreeAdapter(),
    editorAdapter: new BrowserEditorAdapter(),
    terminalAdapter: new BrowserTerminalAdapter(),
  };
}
