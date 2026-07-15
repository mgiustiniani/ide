// ---------------------------------------------------------------------------
// @ide/web-core – Editor Store (Zustand)
// ---------------------------------------------------------------------------
// Manages the editor UI state: open files, active tab, content buffers,
// cursor positions.

import { create } from "zustand";
import type { OpenFile, EditorTab, CursorPosition } from "@ide/contracts";

/** Slice of the store exposed to consumers. */
export interface EditorStoreSlice {
  /** All currently open files. */
  openFiles: OpenFile[];
  /** Ordered tab list (first = active if isActive). */
  tabs: EditorTab[];
  /** Path of the active file. */
  activeFilePath: string | null;
  /** In‑memory content buffers keyed by file path. */
  contents: Record<string, string>;
  /** Cursor positions keyed by file path. */
  cursorPositions: Record<string, CursorPosition>;
  /** Whether the editor is loading. */
  isLoading: boolean;

  // ── Actions ────────────────────────────────────────────────────────

  /** Open a file – adds to openFiles and tabs, sets as active. */
  openFile(file: OpenFile): void;
  /** Close the file at `filePath` – removes from tabs / openFiles. */
  closeFile(filePath: string): void;
  /** Set the active tab to a different open file. */
  setActiveFile(filePath: string): void;
  /** Update the content buffer for a file. */
  setContent(filePath: string, content: string): void;
  /** Mark a tab as dirty / clean. */
  setDirty(filePath: string, dirty: boolean): void;
  /** Update cursor position for a file. */
  setCursorPosition(filePath: string, position: CursorPosition): void;
  /** Replace the open files list while preserving valid dirty/active tab state. */
  setOpenFiles(files: OpenFile[], activeFilePath?: string | null): void;
  /** Update loading flag. */
  setLoading(loading: boolean): void;
}

export type EditorStore = EditorStoreSlice;

export type { OpenFile, EditorTab, CursorPosition } from "@ide/contracts";

export function createEditorStore() {
  return create<EditorStoreSlice>((set) => ({
    openFiles: [],
    tabs: [],
    activeFilePath: null,
    contents: {},
    cursorPositions: {},
    // Start idle so the editor can render its welcome view before any restore/open work.
    isLoading: false,

    openFile(file: OpenFile) {
      set((state) => {
        // Don't re‑open an already open file – just activate it.
        const alreadyOpen = state.openFiles.some((openFile) => openFile.filePath === file.filePath);
        if (alreadyOpen) {
          return {
            activeFilePath: file.filePath,
            tabs: state.tabs.map((tab) => ({
              ...tab,
              isActive: tab.filePath === file.filePath,
            })),
          };
        }

        const newTab: EditorTab = {
          filePath: file.filePath,
          isDirty: false,
          isActive: true,
        };

        return {
          openFiles: [...state.openFiles, file],
          tabs: [...state.tabs.map((tab) => ({ ...tab, isActive: false })), newTab],
          activeFilePath: file.filePath,
        };
      });
    },

    closeFile(filePath: string) {
      set((state) => {
        const remainingFiles = state.openFiles.filter((file) => file.filePath !== filePath);
        const remainingTabs = state.tabs.filter((tab) => tab.filePath !== filePath);

        // If we closed the active file, activate the next tab or null.
        let newActive = state.activeFilePath;
        if (newActive === filePath) {
          newActive = remainingTabs.length > 0 ? remainingTabs[0].filePath : null;
        }

        const { [filePath]: _content, ...restContents } = state.contents;
        const { [filePath]: _position, ...restPositions } = state.cursorPositions;

        return {
          openFiles: remainingFiles,
          tabs: remainingTabs.map((tab) => ({
            ...tab,
            isActive: tab.filePath === newActive,
          })),
          activeFilePath: newActive,
          contents: restContents,
          cursorPositions: restPositions,
        };
      });
    },

    setActiveFile(filePath: string) {
      set((state) => {
        const exists = state.tabs.some((tab) => tab.filePath === filePath);
        if (!exists) return state;

        return {
          activeFilePath: filePath,
          tabs: state.tabs.map((tab) => ({
            ...tab,
            isActive: tab.filePath === filePath,
          })),
        };
      });
    },

    setContent(filePath: string, content: string) {
      set((state) => ({
        contents: { ...state.contents, [filePath]: content },
      }));
    },

    setDirty(filePath: string, dirty: boolean) {
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.filePath === filePath ? { ...tab, isDirty: dirty } : tab,
        ),
      }));
    },

    setCursorPosition(filePath: string, position: CursorPosition) {
      set((state) => ({
        cursorPositions: { ...state.cursorPositions, [filePath]: position },
      }));
    },

    setOpenFiles(files: OpenFile[], activeFilePath?: string | null) {
      set((state) => {
        const filePaths = new Set(files.map((file) => file.filePath));
        const requestedActive = activeFilePath ?? state.activeFilePath;
        const nextActive =
          requestedActive && filePaths.has(requestedActive)
            ? requestedActive
            : (files[0]?.filePath ?? null);

        const dirtyByPath = new Map(state.tabs.map((tab) => [tab.filePath, tab.isDirty] as const));

        return {
          openFiles: files,
          tabs: files.map((file) => ({
            filePath: file.filePath,
            isDirty: dirtyByPath.get(file.filePath) ?? false,
            isActive: file.filePath === nextActive,
          })),
          activeFilePath: nextActive,
        };
      });
    },

    setLoading(loading: boolean) {
      set({ isLoading: loading });
    },
  }));
}
