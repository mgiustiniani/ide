// ---------------------------------------------------------------------------
// @ide/web-core – Editor View‑Model
// ---------------------------------------------------------------------------
// Wraps the editor store and EditorPort to provide a clean view‑model
// for UI components.

import type { EditorStoreSlice } from "../state/editor-store";
import type { StoreAccessor } from "../state/store-accessor";
import { toGetState } from "../state/store-accessor";
import type { EditorPort } from "../ports/editor-port";
import { stageEditorTransaction } from "./editor-transaction";
import { isNormalizedWorkspaceRelativePath } from "../editor-open-coordinator";
import type {
  OpenFile,
  EditorContent,
  EditorTab,
  CursorPosition,
  EditorDiskComparison,
  EditorBufferReplacement,
} from "@ide/contracts";

export class EditorViewModel {
  private readonly getState: () => EditorStoreSlice;
  private openIntent = 0;
  private discardOpenIntentsThrough = 0;
  private pendingLoads = 0;
  private saveGeneration = 0;
  private readonly pendingSaves = new Map<string, Promise<void>>();
  private readonly bufferVersions = new Map<string, number>();
  private externalWrite: symbol | null = null;
  private editorTransactionToken: symbol | null = null;
  private readonly replacements = new WeakMap<
    EditorBufferReplacement,
    { generation: number; version: number; dirty: boolean; lifetime: symbol }
  >();
  private readonly comparisons = new WeakMap<
    EditorDiskComparison,
    {
      generation: number;
      version: number;
      dirty: boolean;
      lifetime: symbol;
    }
  >();

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

  /** Stable across edits/saves; replaced by close/reopen, even at the same path. */
  bufferLifetime(filePath: string): symbol | undefined {
    return this.getState().bufferLifetimes.get(filePath);
  }

  /** RefactorKit operates on saved sources; dirty buffers and pending I/O cannot authorize a review. */
  reviewSavedBuffers({ allowNewBuffers = false }: { allowNewBuffers?: boolean } = {}): () => void {
    this.requireSavedBuffers();
    const capture = this.captureEditorBuffers({ allowNewBuffers });
    return () => {
      this.requireSavedBuffers();
      capture.verify();
    };
  }

  /** Inspect journal source evidence without opening a buffer or changing its save baseline. */
  async inspectSourceRevision(
    context: import("@ide/contracts").EditorDiskInspectionContext,
    filePath: string,
    revision: string,
  ) {
    if (!this.port.inspectSourceRevision)
      throw new Error("Transaction source inspection is unavailable.");
    return this.port.inspectSourceRevision(context, filePath, revision);
  }

  /** Capture immutable buffer text and reject edits, replacement or pending file I/O. */
  captureEditorBuffers({ allowNewBuffers = false }: { allowNewBuffers?: boolean } = {}) {
    this.requireReadyBuffers();
    const generation = this.saveGeneration;
    const buffers = this.getState().tabs.map(({ filePath }) => ({
      filePath,
      lifetime: this.bufferLifetime(filePath),
      version: this.bufferVersions.get(filePath) ?? 0,
      content: this.getState().contents[filePath],
      isDirty: this.getState().tabs.find((tab) => tab.filePath === filePath)?.isDirty === true,
      ...(this.getState().tabs.find((tab) => tab.filePath === filePath)?.isNew
        ? { isNew: true as const }
        : {}),
    }));
    const matchesBuffer = (buffer: (typeof buffers)[number], state: ReturnType<typeof this.getState>) =>
      state.tabs.some((tab) => tab.filePath === buffer.filePath) &&
      this.bufferLifetime(buffer.filePath) === buffer.lifetime &&
      (this.bufferVersions.get(buffer.filePath) ?? 0) === buffer.version &&
      state.contents[buffer.filePath] === buffer.content;
    const verify = () => {
      this.requireReadyBuffers();
      const state = this.getState();
      if (
        generation !== this.saveGeneration ||
        (!allowNewBuffers && buffers.length !== state.tabs.length) ||
        buffers.some((buffer) => !matchesBuffer(buffer, state))
      )
        throw new Error("Editor buffers changed after the review; repeat the operation.");
    };
    return {
      documents: buffers.map((buffer) => ({
        path: buffer.filePath,
        text: buffer.content,
        version: buffer.version + 1,
        isDirty: buffer.isDirty,
        ...(buffer.isNew ? { isNew: true as const } : {}),
      })),
      verify,
      isDocumentCurrent: (filePath: string) => {
        const buffer = buffers.find((candidate) => candidate.filePath === filePath);
        return buffer !== undefined &&
          generation === this.saveGeneration &&
          this.externalWrite === null &&
          !this.pendingSaves.has(filePath) &&
          matchesBuffer(buffer, this.getState());
      },
    };
  }

  /** Lock dirty buffers while an editor-owned provider transaction is prepared and acknowledged. */
  beginEditorTransaction() {
    const captured = this.captureEditorBuffers();
    const capture = {
      documents: Object.freeze(captured.documents.map((d) => Object.freeze({ ...d }))),
    };
    const token = Symbol("editor-transaction");
    this.externalWrite = token;
    this.editorTransactionToken = token;
    const generation = this.saveGeneration;
    const lifetimes = new Map(capture.documents.map((d) => [d.path, this.bufferLifetime(d.path)]));
    const issued = new WeakSet<ReturnType<typeof stageEditorTransaction>>();
    const verify = () => {
      if (this.externalWrite !== token || this.saveGeneration !== generation)
        throw new Error("The editor transaction was retired.");
      const state = this.getState();
      if (
        state.tabs.length !== capture.documents.length ||
        capture.documents.some(
          (d) =>
            this.bufferLifetime(d.path) !== lifetimes.get(d.path) ||
            state.contents[d.path] !== d.text ||
            (this.bufferVersions.get(d.path) ?? 0) + 1 !== d.version,
        )
      )
        throw new Error("Editor buffers changed before the transaction committed.");
    };
    let committed = false;
    return {
      get committed() {
        return committed;
      },
      documents: capture.documents,
      stage: (
        edit: import("@ide/contracts").JavaEditorWorkspaceEdit,
        restoredBuffers?: readonly { path: string; text: string; isDirty: boolean }[],
      ) => {
        verify();
        const staged = stageEditorTransaction(capture.documents, edit, restoredBuffers);
        issued.add(staged);
        return staged;
      },
      commit: (staged: ReturnType<typeof stageEditorTransaction>) => {
        verify();
        if (committed || !issued.has(staged))
          throw new Error("The editor transaction is unrecognized or already committed.");
        const previous = new Map(this.bufferVersions);
        for (const d of staged.versions) {
          this.bufferVersions.delete(d.oldPath);
          this.bufferVersions.set(d.path, d.version - 1);
        }
        try {
          this.getState().applyBufferChanges(staged.changes);
          committed = true;
        } catch (error) {
          // Store validation fails before publication. A throwing subscriber can
          // instead observe a committed store; retain its corresponding versions.
          if (staged.changes.every((d) => this.getState().contents[d.path] === d.after)) {
            committed = true;
          } else {
            this.bufferVersions.clear();
            for (const [path, version] of previous) this.bufferVersions.set(path, version);
          }
          throw error;
        }
      },
      release: () => {
        if (this.externalWrite === token) this.externalWrite = null;
        if (this.editorTransactionToken === token) this.editorTransactionToken = null;
      },
      adoptSavedRenames: async (
        sources: readonly { oldPath: string; path: string; revision: string }[],
      ) => {
        if (this.externalWrite !== token || this.saveGeneration !== generation)
          throw new Error("The editor transaction was retired.");
        for (const source of sources) {
          if (!this.port.adoptRenamedFile)
            throw new Error("Editor rename baseline reconciliation is unavailable.");
          await this.port.adoptRenamedFile(source.oldPath, source.path, source.revision);
        }
      },
    };
  }

  /** Hold source saves and buffer mutations until an external workspace write settles. */
  beginExternalWrite(): () => void {
    this.requireSavedBuffers();
    const token = Symbol("external-workspace-write");
    this.externalWrite = token;
    return () => {
      if (this.externalWrite === token) this.externalWrite = null;
    };
  }

  /** Reload still-clean open files after a provider write, retaining buffers that cannot be reconciled. */
  async refreshCleanBuffers(
    filePaths: readonly string[],
    isCurrent: () => boolean,
  ): Promise<{ files: EditorContent[]; warnings: string[] }> {
    const token = this.externalWrite;
    const generation = this.saveGeneration;
    if (token === null)
      throw new Error("Refreshing transformed files requires an active workspace write.");
    const current = () =>
      token === this.externalWrite && generation === this.saveGeneration && isCurrent();
    const files: EditorContent[] = [];
    const warnings: string[] = [];
    for (const filePath of new Set(filePaths)) {
      if (!current()) break;
      const tab = this.getState().tabs.find((candidate) => candidate.filePath === filePath);
      if (!tab) continue;
      if (tab.isDirty) {
        warnings.push(
          `Unsaved edits in ${filePath} were retained; compare with disk before saving.`,
        );
        continue;
      }
      try {
        const comparison = await this.compareWithDisk(filePath);
        if (!current()) break;
        this.adoptDiskComparison(comparison);
        files.push(comparison.diskSnapshot);
      } catch {
        if (!current()) break;
        warnings.push(
          `Could not reload ${filePath}; its buffer was retained. Compare with disk or reopen a moved file before saving.`,
        );
      }
    }
    return { files, warnings };
  }

  /** Move an open clean tab to the actual post-refactoring file and its fresh save baseline. */
  async reconcileMovedCleanBuffer(
    oldPath: string,
    path: string,
    isCurrent: () => boolean,
  ): Promise<EditorContent | undefined> {
    const token = this.externalWrite;
    const generation = this.saveGeneration;
    const current = () =>
      token !== null &&
      token === this.externalWrite &&
      generation === this.saveGeneration &&
      isCurrent();
    if (!current()) return;
    if (
      !isNormalizedWorkspaceRelativePath(oldPath) ||
      !isNormalizedWorkspaceRelativePath(path) ||
      oldPath === path
    )
      throw new Error("RefactorKit returned invalid moved-file paths.");

    const initial = this.getState();
    const initialTab = initial.tabs.find((candidate) => candidate.filePath === oldPath);
    if (!initialTab) return;
    const initialFile = initial.openFiles.find((candidate) => candidate.filePath === oldPath);
    const initialContent = initial.contents[oldPath];
    const lifetime = this.bufferLifetime(oldPath);
    if (
      !initialFile ||
      initialContent === undefined ||
      lifetime === undefined ||
      initialTab.isDirty
    )
      throw new Error("The moved Java tab is not a clean, current buffer.");
    if (
      initial.tabs.some((candidate) => candidate.filePath === path) ||
      initial.openFiles.some((candidate) => candidate.filePath === path)
    )
      throw new Error("The moved file destination is already open.");

    let loaded: EditorContent | undefined;
    let committed = false;
    try {
      loaded = await this.port.loadContent(path);
      if (!current()) return;
      if (loaded.filePath !== path)
        throw new Error("The moved-file read returned a different path.");

      const beforeClose = this.getState();
      if (
        !beforeClose.tabs.some(
          (candidate) => candidate.filePath === oldPath && !candidate.isDirty,
        ) ||
        this.bufferLifetime(oldPath) !== lifetime ||
        beforeClose.contents[oldPath] !== initialContent ||
        beforeClose.tabs.some((candidate) => candidate.filePath === path)
      )
        throw new Error("The moved Java tab changed while its new file was being read.");

      const state = this.getState();
      const file = state.openFiles.find((candidate) => candidate.filePath === oldPath);
      if (
        !file ||
        !state.tabs.some((candidate) => candidate.filePath === oldPath && !candidate.isDirty) ||
        this.bufferLifetime(oldPath) !== lifetime ||
        state.contents[oldPath] !== initialContent ||
        state.tabs.some((candidate) => candidate.filePath === path)
      )
        throw new Error("The moved Java tab changed before reconciliation completed.");

      state.reconcileCleanRename(
        oldPath,
        {
          filePath: path,
          name: path.split("/").at(-1) ?? path,
          language: loaded.language,
          openedAt: file.openedAt,
        },
        loaded.content,
      );
      committed = true;
      this.bufferVersions.delete(oldPath);
      this.bumpBufferVersion(path);
      const closing = this.port.closeFile(oldPath);
      if (!Array.isArray(closing)) await closing;
      if (!current()) return;
      return loaded;
    } catch (error) {
      if (!current()) return;
      const state = this.getState();
      const committedInStore =
        loaded !== undefined &&
        state.tabs.some((candidate) => candidate.filePath === path) &&
        !state.tabs.some((candidate) => candidate.filePath === oldPath) &&
        state.contents[path] === loaded.content;
      if (committedInStore) {
        if (!committed) {
          this.bufferVersions.delete(oldPath);
          this.bumpBufferVersion(path);
        }
        try {
          const closing = this.port.closeFile(oldPath);
          if (!Array.isArray(closing)) await closing;
        } catch {
          // The old path is no longer an editor tab, so stale adapter metadata cannot authorize a save.
        }
        return loaded;
      }
      if (loaded && current()) {
        try {
          const closing = this.port.closeFile(path);
          if (!Array.isArray(closing)) await closing;
        } catch {
          // A failed cleanup leaves the old tab guarded by its stale save revision.
        }
      }
      throw error;
    }
  }

  private requireSavedBuffers(): void {
    this.requireNoExternalWrite();
    if (
      this.pendingSaves.size > 0 ||
      this.pendingLoads > 0 ||
      this.getState().tabs.some((tab) => tab.isDirty)
    ) {
      throw new Error("Save all editor buffers and wait for file operations before refactoring.");
    }
  }

  private requireReadyBuffers(): void {
    this.requireNoExternalWrite();
    if (this.pendingSaves.size > 0 || this.pendingLoads > 0)
      throw new Error("Wait for editor file operations before reviewing buffers.");
  }

  private requireNoExternalWrite(): void {
    if (this.externalWrite !== null)
      throw new Error(
        "A workspace transformation is still running; wait before editing or saving.",
      );
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

  /** Load an affected source as a background tab without replacing any existing draft. */
  async openFileInBackground(filePath: string, isCurrent: () => boolean): Promise<boolean> {
    this.requireNoExternalWrite();
    if (!isNormalizedWorkspaceRelativePath(filePath) || !isCurrent()) return false;
    const intent = this.openIntent;
    const initial = this.getState();
    if (!initial.activeFilePath) return false;
    if (Object.prototype.hasOwnProperty.call(initial.contents, filePath)) return true;
    const lifetime = initial.bufferLifetimes.get(filePath);
    const content = await this.port.loadContent(filePath);
    if (!isCurrent() || intent !== this.openIntent || content.filePath !== filePath) return false;
    this.requireNoExternalWrite();
    const current = this.getState();
    if (!current.activeFilePath) return false;
    // A concurrent open may already have loaded and edited this source.
    if (Object.prototype.hasOwnProperty.call(current.contents, filePath)) return true;
    if (current.bufferLifetimes.get(filePath) !== lifetime) return false;
    if (!current.openFiles.some((file) => file.filePath === filePath)) {
      current.setOpenFiles(
        [
          ...current.openFiles,
          {
            filePath,
            name: filePath.split("/").pop() ?? filePath,
            language: content.language,
            openedAt: Date.now(),
          },
        ],
        current.activeFilePath,
      );
    }
    this.bumpBufferVersion(filePath);
    this.adoptSavedContent(filePath, content.content);
    return true;
  }

  /** Open a file – loads content from the port and updates the store. */
  async openFile(filePath: string): Promise<void> {
    this.requireNoExternalWrite();
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
      this.bumpBufferVersion(content.filePath);
      this.adoptSavedContent(content.filePath, content.content);
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
    this.bumpBufferVersion(canonicalPath);
    this.adoptSavedContent(canonicalPath, content.content);
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
    this.requireNoExternalWrite();
    const state = this.getState();
    const content = state.contents[filePath];
    const lifetime = this.bufferLifetime(filePath);
    if (content === undefined || lifetime === undefined) return;

    const generation = this.saveGeneration;
    const preceding = this.pendingSaves.get(filePath);
    const saveCapturedContent = async (): Promise<void> => {
      if (preceding) await preceding.catch(() => undefined);
      if (generation !== this.saveGeneration || this.bufferLifetime(filePath) !== lifetime) return;
      const updatedFiles = await this.port.saveContent(filePath, content);
      const current = this.getState();
      if (generation !== this.saveGeneration || this.bufferLifetime(filePath) !== lifetime) return;
      // A provider inventory is not authority to drop or resurrect unrelated buffers.
      const savedMetadata = updatedFiles.find((file) => file.filePath === filePath);
      if (savedMetadata) {
        current.setOpenFiles(
          current.openFiles.map((file) => (file.filePath === filePath ? savedMetadata : file)),
          current.activeFilePath,
        );
      }
      if (generation === this.saveGeneration && this.bufferLifetime(filePath) === lifetime)
        this.getState().acknowledgeSavedContent(filePath, content, lifetime, {
          savePending: this.pendingSaves.get(filePath) !== saving,
        });
    };
    // Successful acknowledgment follows await, after this invocation has been registered.
    const saving = saveCapturedContent();
    this.pendingSaves.set(filePath, saving);
    try {
      await saving;
    } finally {
      if (this.pendingSaves.get(filePath) === saving) this.pendingSaves.delete(filePath);
    }
  }

  /** Read-only comparison, bound to the current buffer lifetime and workspace. */
  async compareWithDisk(filePath: string): Promise<EditorDiskComparison> {
    if (!this.port.inspectContent || !this.port.acceptDiskSnapshot) {
      throw new Error("Disk comparison is unavailable for this provider.");
    }
    const state = this.getState();
    const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
    const bufferContent = state.contents[filePath];
    const lifetime = this.bufferLifetime(filePath);
    if (
      !tab ||
      lifetime === undefined ||
      bufferContent === undefined ||
      this.pendingSaves.has(filePath)
    ) {
      throw new Error("The buffer is unavailable or a save is pending.");
    }
    const binding = {
      generation: this.saveGeneration,
      version: this.bufferVersions.get(filePath) ?? 0,
      dirty: tab.isDirty,
      lifetime,
    };
    const diskSnapshot = Object.freeze(await this.port.inspectContent(filePath));
    const comparison = Object.freeze({ filePath, bufferContent, diskSnapshot });
    this.comparisons.set(comparison, binding);
    this.requireCurrentComparison(comparison);
    if (diskSnapshot.filePath !== filePath) {
      this.comparisons.delete(comparison);
      throw new Error("The disk snapshot belongs to another file.");
    }
    return comparison;
  }

  /** Explicitly discard only the inspected buffer version; this does not write a file. */
  useDiskVersion(comparison: EditorDiskComparison): void {
    this.requireNoExternalWrite();
    this.adoptDiskComparison(comparison);
  }

  private adoptDiskComparison(comparison: EditorDiskComparison): void {
    this.requireCurrentComparison(comparison);
    if (!this.port.acceptDiskSnapshot) throw new Error("Disk comparison is unavailable.");
    this.port.acceptDiskSnapshot(comparison.diskSnapshot);
    this.comparisons.delete(comparison);
    this.bumpBufferVersion(comparison.filePath);
    this.adoptSavedContent(comparison.filePath, comparison.diskSnapshot.content);
  }

  private requireCurrentComparison(comparison: EditorDiskComparison): void {
    const binding = this.comparisons.get(comparison);
    const state = this.getState();
    const tab = state.tabs.find((candidate) => candidate.filePath === comparison.filePath);
    if (
      !binding ||
      !tab ||
      binding.generation !== this.saveGeneration ||
      binding.lifetime !== this.bufferLifetime(comparison.filePath) ||
      binding.version !== (this.bufferVersions.get(comparison.filePath) ?? 0) ||
      state.contents[comparison.filePath] !== comparison.bufferContent ||
      tab.isDirty !== binding.dirty ||
      this.pendingSaves.has(comparison.filePath)
    ) {
      throw new Error(
        "The buffer changed or the comparison is stale; compare again after saving finishes.",
      );
    }
  }

  /** Prepare an explicit before/after review without reading or writing source files. */
  prepareBufferReplacement(filePath: string, after: string): EditorBufferReplacement {
    const state = this.getState();
    const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
    const lifetime = this.bufferLifetime(filePath);
    if (
      !tab ||
      lifetime === undefined ||
      state.contents[filePath] === undefined ||
      this.pendingSaves.has(filePath)
    ) {
      throw new Error("The buffer is unavailable or a save is pending.");
    }
    const replacement = Object.freeze({ filePath, before: state.contents[filePath], after });
    this.replacements.set(replacement, {
      generation: this.saveGeneration,
      version: this.bufferVersions.get(filePath) ?? 0,
      dirty: tab.isDirty,
      lifetime,
    });
    return replacement;
  }

  /** Restore reviewed text into a dirty buffer; the normal disk-save revision is untouched. */
  replaceBuffer(replacement: EditorBufferReplacement): void {
    this.requireNoExternalWrite();
    const binding = this.replacements.get(replacement);
    const state = this.getState();
    const tab = state.tabs.find((candidate) => candidate.filePath === replacement.filePath);
    if (
      !binding ||
      !tab ||
      binding.generation !== this.saveGeneration ||
      binding.lifetime !== this.bufferLifetime(replacement.filePath) ||
      binding.version !== (this.bufferVersions.get(replacement.filePath) ?? 0) ||
      state.contents[replacement.filePath] !== replacement.before ||
      tab.isDirty !== binding.dirty ||
      this.pendingSaves.has(replacement.filePath)
    ) {
      throw new Error("The reviewed buffer changed; prepare recovery again.");
    }
    this.replacements.delete(replacement);
    this.bumpBufferVersion(replacement.filePath);
    this.getState().editContent(replacement.filePath, replacement.after, { forceDirty: true });
  }

  private adoptSavedContent(filePath: string, content: string): void {
    const lifetime = this.bufferLifetime(filePath);
    const generation = this.saveGeneration;
    this.getState().setContent(filePath, content);
    if (lifetime !== undefined && generation === this.saveGeneration)
      this.getState().acknowledgeSavedContent(filePath, content, lifetime);
  }

  private bumpBufferVersion(filePath: string): void {
    this.bufferVersions.set(filePath, (this.bufferVersions.get(filePath) ?? 0) + 1);
  }

  /** Close only the selected, still-current buffer lifetime; never write source content. */
  async closeFile(filePath: string): Promise<void> {
    if (this.editorTransactionToken !== null) this.requireNoExternalWrite();
    const state = this.getState();
    const file = state.openFiles.find((candidate) => candidate.filePath === filePath);
    if (!file) return;
    const changed = () =>
      new Error("The file changed while closing; save it again before closing.");
    if (this.pendingSaves.has(filePath)) throw changed();
    this.bumpBufferVersion(filePath);
    const generation = this.saveGeneration;
    const lifetime = this.bufferLifetime(filePath);
    const version = this.bufferVersions.get(filePath);
    const content = state.contents[filePath];
    const dirty = state.tabs.find((tab) => tab.filePath === filePath)?.isDirty;
    const closing = this.port.closeFile(filePath);
    // Do not yield between the shipped adapters' synchronous metadata close and
    // buffer removal. Async providers still cannot own later UI lifetimes.
    if (!Array.isArray(closing)) await closing;
    const current = this.getState();
    if (
      generation !== this.saveGeneration ||
      lifetime !== this.bufferLifetime(filePath) ||
      version !== this.bufferVersions.get(filePath) ||
      current.openFiles.find((candidate) => candidate.filePath === filePath) !== file ||
      current.contents[filePath] !== content ||
      current.tabs.find((tab) => tab.filePath === filePath)?.isDirty !== dirty ||
      this.pendingSaves.has(filePath)
    )
      throw changed();
    current.closeFile(filePath);
  }

  /** Update the content buffer for a file (typed by user). */
  updateContent(filePath: string, content: string): void {
    this.requireNoExternalWrite();
    this.bumpBufferVersion(filePath);
    this.getState().editContent(filePath, content, {
      forceDirty: this.pendingSaves.has(filePath),
    });
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

  /** Retire source-operation authority only at an actual workspace lifecycle boundary. */
  invalidateWorkspaceOperations(): void {
    this.externalWrite = null;
    this.editorTransactionToken = null;
    this.saveGeneration += 1;
    this.bufferVersions.clear();
    this.getState().clearSavedContents();
    this.cancelPendingOpen();
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
        this.bumpBufferVersion(content.filePath);
        this.adoptSavedContent(content.filePath, content.content);
      }
    } finally {
      this.endLoading();
    }
  }
}
