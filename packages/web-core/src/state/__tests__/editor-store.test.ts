// ---------------------------------------------------------------------------
// @ide/web-core – Editor Store Unit Tests
// ---------------------------------------------------------------------------
// Tests the editor Zustand store: open file, close file, set content,
// switch tab, dirty flag, cursor position.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { createEditorStore } from "../editor-store";
import type { OpenFile, CursorPosition, EditorStoreSlice } from "../editor-store";

// ── Helpers ─────────────────────────────────────────────────────────────

const makeOpenFile = (path: string): OpenFile => ({
  filePath: path,
  name: path.split("/").pop() ?? path,
  language: "typescript",
  openedAt: Date.now(),
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("EditorStore", () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
  });

  describe("initial state", () => {
    it("should start with empty openFiles and no active file", () => {
      const state: EditorStoreSlice = store.getState();
      expect(state.openFiles).toEqual([]);
      expect(state.tabs).toEqual([]);
      expect(state.activeFilePath).toBeNull();
      expect(state.contents).toEqual({});
      expect(state.cursorPositions).toEqual({});
      expect(state.isLoading).toBe(false);
    });
  });

  describe("openFile", () => {
    it("should add a file to openFiles and create a tab", () => {
      const file = makeOpenFile("src/main.ts");
      store.getState().openFile(file);

      const state = store.getState();
      expect(state.openFiles).toHaveLength(1);
      expect(state.openFiles[0].filePath).toBe("src/main.ts");
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].filePath).toBe("src/main.ts");
      expect(state.tabs[0].isActive).toBe(true);
      expect(state.activeFilePath).toBe("src/main.ts");
    });

    it("should activate existing file without duplicating", () => {
      const file = makeOpenFile("src/main.ts");
      store.getState().openFile(file);
      store.getState().openFile(makeOpenFile("src/utils.ts"));
      store.getState().openFile(file); // re-open – activates existing tab

      const state = store.getState();
      expect(state.openFiles).toHaveLength(2);
      expect(state.activeFilePath).toBe("src/main.ts");
      // The existing main.ts tab stays in place and becomes active
      expect(state.tabs[0].isActive).toBe(true);
      expect(state.tabs[1].isActive).toBe(false);
    });

    it("should set the new tab as active and deactivate others", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().openFile(makeOpenFile("b.ts"));

      const state = store.getState();
      expect(state.tabs[0].isActive).toBe(false);
      expect(state.tabs[1].isActive).toBe(true);
      expect(state.activeFilePath).toBe("b.ts");
    });
  });

  describe("closeFile", () => {
    it("should remove the file and tab", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().openFile(makeOpenFile("b.ts"));
      store.getState().closeFile("a.ts");

      const state = store.getState();
      expect(state.openFiles).toHaveLength(1);
      expect(state.openFiles[0].filePath).toBe("b.ts");
      expect(state.tabs).toHaveLength(1);
    });

    it("should switch active file when closing the active one", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().openFile(makeOpenFile("b.ts"));
      store.getState().closeFile("b.ts");

      const state = store.getState();
      expect(state.activeFilePath).toBe("a.ts");
      expect(state.tabs[0].isActive).toBe(true);
    });

    it("should set activeFilePath to null when closing the last file", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().closeFile("a.ts");

      expect(store.getState().activeFilePath).toBeNull();
      expect(store.getState().openFiles).toHaveLength(0);
    });

    it("should remove content and cursor position for the closed file", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().setContent("a.ts", "hello");
      store.getState().setCursorPosition("a.ts", { line: 1, column: 5 });
      store.getState().closeFile("a.ts");

      const state = store.getState();
      expect(state.contents["a.ts"]).toBeUndefined();
      expect(state.cursorPositions["a.ts"]).toBeUndefined();
    });
  });

  describe("setActiveFile", () => {
    it("should switch the active file", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().openFile(makeOpenFile("b.ts"));
      store.getState().setActiveFile("a.ts");

      expect(store.getState().activeFilePath).toBe("a.ts");
      expect(store.getState().tabs[0].isActive).toBe(true);
      expect(store.getState().tabs[1].isActive).toBe(false);
    });
  });

  describe("setContent", () => {
    it("should update the content buffer for a file", () => {
      store.getState().setContent("a.ts", "new content");
      expect(store.getState().contents["a.ts"]).toBe("new content");
    });

    it("should merge with existing contents", () => {
      store.getState().setContent("a.ts", "content a");
      store.getState().setContent("b.ts", "content b");

      const state = store.getState();
      expect(state.contents["a.ts"]).toBe("content a");
      expect(state.contents["b.ts"]).toBe("content b");
    });
  });

  describe("setDirty", () => {
    it("should mark a tab as dirty", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().setDirty("a.ts", true);

      expect(store.getState().tabs[0].isDirty).toBe(true);
    });

    it("should clear dirty flag", () => {
      store.getState().openFile(makeOpenFile("a.ts"));
      store.getState().setDirty("a.ts", true);
      store.getState().setDirty("a.ts", false);

      expect(store.getState().tabs[0].isDirty).toBe(false);
    });
  });

  describe("setCursorPosition", () => {
    it("should store cursor position for a file", () => {
      const pos: CursorPosition = { line: 10, column: 5 };
      store.getState().setCursorPosition("a.ts", pos);

      expect(store.getState().cursorPositions["a.ts"]).toEqual(pos);
    });

    it("should replace existing cursor position", () => {
      store.getState().setCursorPosition("a.ts", { line: 1, column: 1 });
      store.getState().setCursorPosition("a.ts", { line: 5, column: 10 });

      expect(store.getState().cursorPositions["a.ts"]).toEqual({ line: 5, column: 10 });
    });
  });

  describe("setOpenFiles", () => {
    it("should replace open files and tabs", () => {
      const files = [makeOpenFile("a.ts"), makeOpenFile("b.ts")];
      store.getState().setOpenFiles(files);

      const state = store.getState();
      expect(state.openFiles).toHaveLength(2);
      expect(state.tabs).toHaveLength(2);
      expect(state.activeFilePath).toBe("a.ts");
      expect(state.tabs[0].isActive).toBe(true);
      expect(state.tabs[1].isActive).toBe(false);
    });

    it("should handle empty array", () => {
      store.getState().setOpenFiles([]);

      expect(store.getState().openFiles).toHaveLength(0);
      expect(store.getState().tabs).toHaveLength(0);
      expect(store.getState().activeFilePath).toBeNull();
    });
  });

  describe("setLoading", () => {
    it("should update loading flag", () => {
      store.getState().setLoading(false);
      expect(store.getState().isLoading).toBe(false);
      store.getState().setLoading(true);
      expect(store.getState().isLoading).toBe(true);
    });
  });
});
