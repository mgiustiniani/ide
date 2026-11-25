// ---------------------------------------------------------------------------
// @ide/browser-adapters – persistence regression tests
// ---------------------------------------------------------------------------
// Covers browser-storage fixes for delete, recursive folder rename, and
// localStorage write fallback behavior.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode, OpenFile } from "@ide/contracts";
import { EditorViewModel } from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";

async function loadAdapters() {
  return import("../index");
}

function readStoredJSON<T>(key: string): T {
  const raw = globalThis.localStorage.getItem(key);
  expect(raw).not.toBeNull();
  return JSON.parse(raw as string) as T;
}

function seedJSON(key: string, value: unknown): void {
  globalThis.localStorage.setItem(key, JSON.stringify(value));
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  globalThis.localStorage.clear();
});

describe("BrowserFileTreeAdapter persistence", () => {
  it("persists deletes to the tree, file contents, and open files", async () => {
    const { BROWSER_STORAGE_KEYS, BrowserFileTreeAdapter } = await loadAdapters();
    const nodes: FileNode[] = [
      {
        id: "folder-src",
        name: "src",
        path: "src",
        type: "folder",
        children: [
          { id: "file-keep", name: "keep.ts", path: "src/keep.ts", type: "file" },
          { id: "file-delete", name: "delete.ts", path: "src/delete.ts", type: "file" },
        ],
      },
    ];
    const openFiles: OpenFile[] = [
      { filePath: "src/keep.ts", name: "keep.ts", language: "typescript", openedAt: 1 },
      { filePath: "src/delete.ts", name: "delete.ts", language: "typescript", openedAt: 2 },
    ];

    seedJSON(BROWSER_STORAGE_KEYS.fileTree, nodes);
    seedJSON(BROWSER_STORAGE_KEYS.fileContents, {
      "src/keep.ts": "keep",
      "src/delete.ts": "delete me",
    });
    seedJSON(BROWSER_STORAGE_KEYS.openFiles, openFiles);

    await new BrowserFileTreeAdapter().delete("src/delete.ts");

    const storedTree = readStoredJSON<FileNode[]>(BROWSER_STORAGE_KEYS.fileTree);
    expect(storedTree[0].children?.map((node) => node.path)).toEqual(["src/keep.ts"]);

    const storedContents = readStoredJSON<Record<string, string>>(
      BROWSER_STORAGE_KEYS.fileContents,
    );
    expect(storedContents).toEqual({ "src/keep.ts": "keep" });

    const storedOpenFiles = readStoredJSON<OpenFile[]>(BROWSER_STORAGE_KEYS.openFiles);
    expect(storedOpenFiles.map((file) => file.filePath)).toEqual(["src/keep.ts"]);
  });

  it("renames folders recursively across tree, contents, and open files", async () => {
    const { BROWSER_STORAGE_KEYS, BrowserFileTreeAdapter } = await loadAdapters();
    const nodes: FileNode[] = [
      {
        id: "folder-src",
        name: "src",
        path: "src",
        type: "folder",
        children: [
          {
            id: "folder-components",
            name: "components",
            path: "src/components",
            type: "folder",
            children: [
              {
                id: "file-button",
                name: "Button.tsx",
                path: "src/components/Button.tsx",
                type: "file",
              },
            ],
          },
        ],
      },
    ];
    const openFiles: OpenFile[] = [
      {
        filePath: "src/components/Button.tsx",
        name: "Button.tsx",
        language: "typescript",
        openedAt: 1,
      },
    ];

    seedJSON(BROWSER_STORAGE_KEYS.fileTree, nodes);
    seedJSON(BROWSER_STORAGE_KEYS.fileContents, {
      "src/components/Button.tsx": "export function Button() {}",
    });
    seedJSON(BROWSER_STORAGE_KEYS.openFiles, openFiles);

    await new BrowserFileTreeAdapter().rename("src/components", "ui");

    const storedTree = readStoredJSON<FileNode[]>(BROWSER_STORAGE_KEYS.fileTree);
    const renamedFolder = storedTree[0].children?.[0];
    expect(renamedFolder?.path).toBe("src/ui");
    expect(renamedFolder?.children?.[0].path).toBe("src/ui/Button.tsx");

    const storedContents = readStoredJSON<Record<string, string>>(
      BROWSER_STORAGE_KEYS.fileContents,
    );
    expect(storedContents).toEqual({
      "src/ui/Button.tsx": "export function Button() {}",
    });

    const storedOpenFiles = readStoredJSON<OpenFile[]>(BROWSER_STORAGE_KEYS.openFiles);
    expect(storedOpenFiles[0]).toMatchObject({
      filePath: "src/ui/Button.tsx",
      name: "Button.tsx",
      language: "typescript",
    });
  });
});

describe("BrowserEditorAdapter localStorage fallback", () => {
  it("closes session metadata synchronously without writing source content or losing a companion draft", async () => {
    const { BrowserEditorAdapter, BROWSER_STORAGE_KEYS } = await loadAdapters();
    const files: OpenFile[] = [
      { filePath: "main.txt", name: "main.txt", language: "plaintext", openedAt: 1 },
      { filePath: "other.txt", name: "other.txt", language: "plaintext", openedAt: 2 },
    ];
    const sources = { "main.txt": "main source", "other.txt": "other source" };
    seedJSON(BROWSER_STORAGE_KEYS.openFiles, files);
    seedJSON(BROWSER_STORAGE_KEYS.fileContents, sources);
    const store = createEditorStore();
    const editor = new EditorViewModel(store.getState, new BrowserEditorAdapter());
    await editor.openFile("main.txt");
    await editor.openFile("other.txt");
    editor.updateContent("other.txt", "companion draft");
    const closing = editor.closeFile("main.txt");
    expect(store.getState().tabs).toMatchObject([{ filePath: "other.txt", isDirty: true }]);
    expect(store.getState().contents["other.txt"]).toBe("companion draft");
    expect(readStoredJSON(BROWSER_STORAGE_KEYS.fileContents)).toEqual(sources);
    expect(
      readStoredJSON<OpenFile[]>(BROWSER_STORAGE_KEYS.openFiles).map((file) => file.filePath),
    ).toEqual(["other.txt"]);
    await closing;
  });

  it("keeps working when localStorage rejects writes", async () => {
    const throwBlocked = () => {
      throw new Error("localStorage blocked");
    };
    const setItemSpy = vi
      .spyOn(globalThis.localStorage, "setItem")
      .mockImplementation(throwBlocked);
    const prototypeSetItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(throwBlocked);

    const { BrowserEditorAdapter } = await loadAdapters();
    const adapter = new BrowserEditorAdapter();

    const openFiles = await adapter.saveContent("notes/todo.md", "# todo");
    const content = await adapter.loadContent("notes/todo.md");

    expect(setItemSpy.mock.calls.length + prototypeSetItemSpy.mock.calls.length).toBeGreaterThan(0);
    expect(content.content).toBe("# todo");
    expect(openFiles.map((file) => file.filePath)).toEqual(["notes/todo.md"]);
    await expect(adapter.getOpenFiles()).resolves.toMatchObject([
      { filePath: "notes/todo.md", name: "todo.md", language: "markdown" },
    ]);
  });
});
