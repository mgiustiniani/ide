// ---------------------------------------------------------------------------
// @ide/web-core – Editor Store (Zustand)
// ---------------------------------------------------------------------------
// Manages the editor UI state: open files, active tab, content buffers,
// cursor positions.

import { create } from "zustand";
import type { OpenFile, EditorTab, CursorPosition } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "../editor-open-coordinator";

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
  /** Last acknowledged saved text for each open buffer; never persisted. */
  lastSavedContents: Record<string, string>;
  /** Cursor positions keyed by file path. */
  cursorPositions: Record<string, CursorPosition>;
  /** Process-local identities for open buffer lifetimes; never persisted or sent to providers. */
  bufferLifetimes: ReadonlyMap<string, symbol>;
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
  /** Publish a user edit and its dirty state atomically; pending saves keep it dirty. */
  editContent(filePath: string, content: string, options?: { forceDirty?: boolean }): void;
  /** Record a successful read/adoption/save only for its original buffer lifetime. */
  acknowledgeSavedContent(
    filePath: string,
    content: string,
    lifetime: symbol,
    options?: { savePending?: boolean },
  ): void;
  /** Retire saved-text knowledge at a workspace lifecycle boundary. */
  clearSavedContents(): void;
  /** Mark a tab as dirty / clean. */
  setDirty(filePath: string, dirty: boolean): void;
  /** Mark a client-managed CreateFile draft as persisted after its first save. */
  setNewFile(filePath: string, isNew: boolean): void;
  /** Update cursor position for a file. */
  setCursorPosition(filePath: string, position: CursorPosition): void;
  /** Replace the open files list while preserving valid dirty/active tab state. */
  setOpenFiles(files: OpenFile[], activeFilePath?: string | null): void;
  /** Update loading flag. */
  setLoading(loading: boolean): void;
  /** Commit validated buffer content/path changes as one observable state update. */
  applyBufferChanges(
    changes: readonly {
      oldPath: string;
      path: string;
      before: string;
      after: string;
      isDirty: boolean;
      created?: true;
    }[],
  ): void;
  /** Adopt an externally transformed, clean source at its new path. */
  reconcileCleanRename(oldPath: string, file: OpenFile, content: string): void;
}

export type EditorStore = EditorStoreSlice;

export type { OpenFile, EditorTab, CursorPosition } from "@ide/contracts";

export function createEditorStore() {
  return create<EditorStoreSlice>((set) => ({
    openFiles: [],
    tabs: [],
    activeFilePath: null,
    contents: {},
    lastSavedContents: {},
    cursorPositions: {},
    bufferLifetimes: new Map(),
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
          bufferLifetimes: new Map(state.bufferLifetimes).set(file.filePath, Symbol()),
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
        const { [filePath]: _saved, ...lastSavedContents } = state.lastSavedContents;
        const bufferLifetimes = new Map(state.bufferLifetimes);
        bufferLifetimes.delete(filePath);

        return {
          openFiles: remainingFiles,
          bufferLifetimes,
          tabs: remainingTabs.map((tab) => ({
            ...tab,
            isActive: tab.filePath === newActive,
          })),
          activeFilePath: newActive,
          contents: restContents,
          lastSavedContents,
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

    editContent(filePath, content, { forceDirty = false } = {}) {
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
        if (!tab) return state;
        const isDirty =
          forceDirty || tab.isNew === true || state.lastSavedContents[filePath] !== content;
        return {
          contents: { ...state.contents, [filePath]: content },
          tabs: state.tabs.map((candidate) =>
            candidate.filePath === filePath ? { ...candidate, isDirty } : candidate,
          ),
        };
      });
    },

    acknowledgeSavedContent(filePath, content, lifetime, { savePending = false } = {}) {
      set((state) => {
        if (
          state.bufferLifetimes.get(filePath) !== lifetime ||
          !state.tabs.some((tab) => tab.filePath === filePath)
        )
          return state;
        return {
          lastSavedContents: { ...state.lastSavedContents, [filePath]: content },
          tabs: state.tabs.map((tab) =>
            tab.filePath === filePath
              ? {
                  ...tab,
                  isDirty: savePending || state.contents[filePath] !== content,
                  isNew: undefined,
                }
              : tab,
          ),
        };
      });
    },

    clearSavedContents() {
      set({ lastSavedContents: {} });
    },

    setDirty(filePath: string, dirty: boolean) {
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.filePath === filePath ? { ...tab, isDirty: dirty } : tab,
        ),
      }));
    },

    setNewFile(filePath: string, isNew: boolean) {
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.filePath === filePath
            ? { ...tab, ...(isNew ? { isNew: true } : { isNew: undefined }) }
            : tab,
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
        const newByPath = new Map(state.tabs.map((tab) => [tab.filePath, tab.isNew] as const));

        return {
          openFiles: files,
          bufferLifetimes: new Map(
            files.map((file) => [
              file.filePath,
              state.bufferLifetimes.get(file.filePath) ?? Symbol(),
            ]),
          ),
          contents: Object.fromEntries(
            Object.entries(state.contents).filter(([filePath]) => filePaths.has(filePath)),
          ),
          lastSavedContents: Object.fromEntries(
            Object.entries(state.lastSavedContents).filter(([filePath]) => filePaths.has(filePath)),
          ),
          cursorPositions: Object.fromEntries(
            Object.entries(state.cursorPositions).filter(([filePath]) => filePaths.has(filePath)),
          ),
          tabs: files.map((file) => ({
            filePath: file.filePath,
            isDirty: dirtyByPath.get(file.filePath) ?? false,
            isActive: file.filePath === nextActive,
            ...(newByPath.get(file.filePath) ? { isNew: true } : {}),
          })),
          activeFilePath: nextActive,
        };
      });
    },

    applyBufferChanges(changes) {
      set((state) => {
        const oldPaths = new Set(changes.map((c) => c.oldPath)),
          paths = new Set(changes.map((c) => c.path));
        if (
          oldPaths.size !== changes.length ||
          paths.size !== changes.length ||
          changes.some(
            (c) =>
              (c.created
                ? !isNormalizedWorkspaceRelativePath(c.path) ||
                  !c.path.toLowerCase().endsWith(".java") ||
                  state.tabs.some((t) => t.filePath === c.path) ||
                  state.openFiles.some((f) => f.filePath === c.path) ||
                  state.contents[c.path] !== undefined ||
                  c.before !== ""
                : !state.tabs.some((t) => t.filePath === c.oldPath) ||
                  state.contents[c.oldPath] !== c.before) ||
              (c.oldPath !== c.path &&
                state.tabs.some((t) => t.filePath === c.path) &&
                !oldPaths.has(c.path)),
          )
        )
          throw new Error("The editor buffers changed before the transaction could commit.");
        const mapped = new Map(changes.map((c) => [c.oldPath, c]));
        const contents = { ...state.contents },
          lastSavedContents = { ...state.lastSavedContents },
          cursorPositions = { ...state.cursorPositions },
          bufferLifetimes = new Map(state.bufferLifetimes);
        for (const c of changes) {
          delete contents[c.oldPath];
          delete lastSavedContents[c.oldPath];
          delete cursorPositions[c.oldPath];
          bufferLifetimes.delete(c.oldPath);
        }
        for (const c of changes) {
          contents[c.path] = c.after;
          if (!c.created) {
            const saved = state.lastSavedContents[c.oldPath];
            if (!c.isDirty) lastSavedContents[c.path] = c.after;
            else if (saved !== undefined) lastSavedContents[c.path] = saved;
          }
          cursorPositions[c.path] = state.cursorPositions[c.oldPath] ?? { line: 1, column: 1 };
          bufferLifetimes.set(
            c.path,
            !c.created && c.oldPath === c.path ? state.bufferLifetimes.get(c.oldPath)! : Symbol(),
          );
        }
        const activeFilePath = mapped.get(state.activeFilePath ?? "")?.path ?? state.activeFilePath;
        const created = changes.filter((change) => change.created);
        const nextActiveFilePath = created.at(-1)?.path ?? activeFilePath;
        const createdFiles: OpenFile[] = created.map((change) => ({
          filePath: change.path,
          name: change.path.split("/").at(-1) ?? change.path,
          language: "java",
          openedAt: Date.now(),
        }));
        return {
          contents,
          lastSavedContents,
          cursorPositions,
          bufferLifetimes,
          activeFilePath: nextActiveFilePath,
          openFiles: [
            ...state.openFiles.map((f) => {
              const c = mapped.get(f.filePath);
              return c ? { ...f, filePath: c.path, name: c.path.split("/").at(-1)! } : f;
            }),
            ...createdFiles,
          ],
          tabs: [
            ...state.tabs.map((t) => {
              const c = mapped.get(t.filePath);
              return c
                ? {
                    ...t,
                    filePath: c.path,
                    isDirty: c.isDirty,
                    isActive: c.path === nextActiveFilePath,
                  }
                : { ...t, isActive: t.filePath === nextActiveFilePath };
            }),
            ...created.map((change) => ({
              filePath: change.path,
              isDirty: true,
              isActive: change.path === nextActiveFilePath,
              isNew: true,
            })),
          ],
        };
      });
    },
    reconcileCleanRename(oldPath, file, content) {
      set((state) => {
        const tab = state.tabs.find((candidate) => candidate.filePath === oldPath);
        const source = state.openFiles.find((candidate) => candidate.filePath === oldPath);
        if (
          !tab ||
          !source ||
          tab.isDirty ||
          state.contents[oldPath] === undefined ||
          state.tabs.some((candidate) => candidate.filePath === file.filePath) ||
          state.openFiles.some((candidate) => candidate.filePath === file.filePath)
        )
          throw new Error(
            "The clean editor tab changed before the moved file could be reconciled.",
          );

        const contents = { ...state.contents, [file.filePath]: content };
        const lastSavedContents = { ...state.lastSavedContents, [file.filePath]: content };
        delete lastSavedContents[oldPath];
        delete contents[oldPath];
        const cursorPositions = { ...state.cursorPositions };
        if (cursorPositions[oldPath]) cursorPositions[file.filePath] = cursorPositions[oldPath];
        delete cursorPositions[oldPath];
        const bufferLifetimes = new Map(state.bufferLifetimes);
        bufferLifetimes.delete(oldPath);
        bufferLifetimes.set(file.filePath, Symbol());
        const activeFilePath =
          state.activeFilePath === oldPath ? file.filePath : state.activeFilePath;

        return {
          openFiles: state.openFiles.map((candidate) =>
            candidate.filePath === oldPath ? file : candidate,
          ),
          tabs: state.tabs.map((candidate) =>
            candidate.filePath === oldPath
              ? {
                  ...candidate,
                  filePath: file.filePath,
                  isDirty: false,
                  isActive: activeFilePath === file.filePath,
                }
              : candidate,
          ),
          activeFilePath,
          contents,
          lastSavedContents,
          cursorPositions,
          bufferLifetimes,
        };
      });
    },
    setLoading(loading: boolean) {
      set({ isLoading: loading });
    },
  }));
}
