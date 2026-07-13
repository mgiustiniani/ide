// ---------------------------------------------------------------------------
// @ide/web-core – Editor View‑Model
// ---------------------------------------------------------------------------
// Wraps the editor store and EditorPort to provide a clean view‑model
// for UI components.

import type { EditorStoreSlice } from "../state/editor-store";
import type { StoreAccessor } from "../state/store-accessor";
import { toGetState } from "../state/store-accessor";
import type { EditorPort } from "../ports/editor-port";
import type { OpenFile, EditorTab, CursorPosition } from "@ide/contracts";

export class EditorViewModel {
  private readonly getState: () => EditorStoreSlice;
  private openIntent = 0;
  private discardOpenIntentsThrough = 0;
  private pendingLoads = 0;

  constructor(
    store: StoreAccessor<EditorStoreSlice>,
    private readonly port: EditorPort,
  ) {
    this.getState = toGetState(store);
  }

  // ── State accessors ────────────────────────────────────────────────

  get openFiles(): OpenFile[] {
    return this.getState().openFiles;
  }

  get tabs(): EditorTab[] {
    return this.getState().tabs;
  }

  get activeFilePath(): string | null {
    return this.getState().activeFilePath;
  }

  get isLoading(): boolean {
    return this.getState().isLoading;
  }

  /** Get the content of the active file, or empty string. */
  get activeFileContent(): string {
    const state = this.getState();
    const path = state.activeFilePath;
    return path ? (state.contents[path] ?? "") : "";
  }

  /** Get cursor position for a given file (or null). */
  cursorPosition(filePath: string): CursorPosition | null {
    return this.getState().cursorPositions[filePath] ?? null;
  }

  // ── Actions ────────────────────────────────────────────────────────

  /** Open a file – loads content from the port and updates the store. */
  async openFile(filePath: string): Promise<void> {
    const intent = ++this.openIntent;
    const state = this.getState();
    const existing = state.openFiles.find((file) => file.filePath === filePath);

    if (existing && Object.prototype.hasOwnProperty.call(state.contents, filePath)) {
      state.setActiveFile(filePath);
      return;
    }

    this.beginLoading();
    try {
      const content = await this.port.loadContent(filePath);

      // Explicit cancellation/reset discards the result entirely. A newer open intent
      // may still retain this buffer, but must never take ownership of selection.
      if (intent <= this.discardOpenIntentsThrough) return;

      if (existing) {
        const targetPath = this.applyLoadedOpenFile(filePath, content);
        if (targetPath && intent === this.openIntent) {
          this.getState().setActiveFile(targetPath);
        }
        return;
      }

      const openFile: OpenFile = {
        filePath: content.filePath,
        name: content.filePath.split("/").pop() ?? content.filePath,
        language: content.language,
        openedAt: Date.now(),
      };

      if (intent === this.openIntent) {
        this.getState().openFile(openFile);
      } else {
        const current = this.getState();
        const alreadyOpen = current.openFiles.some((file) => file.filePath === content.filePath);
        if (!alreadyOpen && current.activeFilePath !== null) {
          current.setOpenFiles([...current.openFiles, openFile], current.activeFilePath);
        }
      }
      this.getState().setContent(content.filePath, content.content);
      this.getState().setDirty(content.filePath, false);
    } finally {
      this.endLoading();
    }
  }

  private applyLoadedOpenFile(
    requestedPath: string,
    content: Awaited<ReturnType<EditorPort["loadContent"]>>,
  ): string | null {
    const state = this.getState();
    const requestedFile = state.openFiles.find((file) => file.filePath === requestedPath);

    // The tab may have been closed while its content was loading.
    if (!requestedFile) return null;

    const canonicalPath = content.filePath;
    const canonicalName = canonicalPath.split("/").pop() ?? canonicalPath;
    const canonicalAlreadyOpen = state.openFiles.some(
      (file) => file.filePath === canonicalPath && file.filePath !== requestedPath,
    );
    const updatedFiles = canonicalAlreadyOpen
      ? state.openFiles
          .filter((file) => file.filePath !== requestedPath)
          .map((file) =>
            file.filePath === canonicalPath
              ? { ...file, name: canonicalName, language: content.language }
              : file,
          )
      : state.openFiles.map((file) =>
          file.filePath === requestedPath
            ? {
                ...file,
                filePath: canonicalPath,
                name: canonicalName,
                language: content.language,
              }
            : file,
        );
    const activePath =
      state.activeFilePath === requestedPath ? canonicalPath : state.activeFilePath;

    state.setOpenFiles(updatedFiles, activePath);
    this.getState().setContent(canonicalPath, content.content);
    this.getState().setDirty(canonicalPath, false);
    return canonicalPath;
  }

  private beginLoading(): void {
    this.pendingLoads += 1;
    this.getState().setLoading(true);
  }

  private endLoading(): void {
    this.pendingLoads -= 1;
    if (this.pendingLoads === 0) {
      this.getState().setLoading(false);
    }
  }

  /** Save the content of the given file through the port. */
  async saveFile(filePath: string): Promise<void> {
    const state = this.getState();
    const content = state.contents[filePath];
    if (content === undefined) return;

    const updatedFiles = await this.port.saveContent(filePath, content);
    this.getState().setOpenFiles(updatedFiles, this.getState().activeFilePath);
    this.getState().setDirty(filePath, false);
  }

  /** Close a file and remove it from the store. */
  async closeFile(filePath: string): Promise<void> {
    const updatedFiles = await this.port.closeFile(filePath);
    this.getState().closeFile(filePath);
    this.getState().setOpenFiles(updatedFiles, this.getState().activeFilePath);
  }

  /** Update the content buffer for a file (typed by user). */
  updateContent(filePath: string, content: string): void {
    this.getState().setContent(filePath, content);
    this.getState().setDirty(filePath, true);
  }

  /** Update cursor position. */
  updateCursorPosition(filePath: string, position: CursorPosition): void {
    this.getState().setCursorPosition(filePath, position);
  }

  /** Discard all currently pending open results without cancelling provider I/O. */
  cancelPendingOpen(): void {
    this.discardOpenIntentsThrough = this.openIntent;
    this.openIntent += 1;
  }

  /** Switch active file. */
  switchActiveFile(filePath: string): void {
    this.openIntent += 1;
    this.getState().setActiveFile(filePath);
  }

  /** Load persisted open files from the port on startup. */
  async restoreSession(): Promise<void> {
    this.beginLoading();
    try {
      const files = await this.port.getOpenFiles();
      this.getState().setOpenFiles(files);

      const active = this.getState().activeFilePath;
      if (active) {
        const content = await this.port.loadContent(active);
        this.getState().setContent(content.filePath, content.content);
        this.getState().setDirty(content.filePath, false);
      }
    } finally {
      this.endLoading();
    }
  }
}
