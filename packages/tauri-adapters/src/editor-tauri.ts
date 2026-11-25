// ---------------------------------------------------------------------------
// @ide/tauri-adapters – TauriEditorAdapter
// ---------------------------------------------------------------------------
// Implements EditorPort by invoking Tauri Rust commands:
//   read_file, write_file
// ---------------------------------------------------------------------------

import { TauriAdapterError, invokeTauri } from "./errors";
import type {
  OpenFile,
  EditorContent,
  EditorDiskSnapshot,
  EditorDiskInspectionContext,
  EditorDiskStatus,
  Language,
} from "@ide/contracts";
import type { EditorPort } from "@ide/web-core/ports";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { inspectEditorSourceRevision } from "./editor-source-revision";

/**
 * Extension-to-language mapping for when the Rust side doesn't return
 * a recognized language or for fallback detection.
 */
const EXTENSION_LANG_MAP: Record<string, Language> = {
  java: "java",
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

export interface TauriEditorAdapterOptions {
  readTimeoutMs?: number;
}

const DEFAULT_READ_TIMEOUT_MS = 10_000;

export class TauriEditorAdapter implements EditorPort {
  async inspectSourceRevision(
    context: EditorDiskInspectionContext,
    filePath: string,
    revision: string,
  ): Promise<EditorDiskStatus> {
    if (this.pendingWrites.has(filePath)) return { filePath, status: "unavailable" };
    const result = await inspectEditorSourceRevision(
      context,
      filePath,
      revision,
      this.readTimeoutMs,
    );
    return this.pendingWrites.has(filePath) ? { filePath, status: "unavailable" } : result;
  }
  async adoptRenamedFile(oldPath: string, path: string, revision: string): Promise<void> {
    const previousRevision = this.revisions.get(oldPath);
    if (
      oldPath === path ||
      !isNormalizedWorkspaceRelativePath(oldPath) ||
      !isNormalizedWorkspaceRelativePath(path) ||
      this.revisions.has(path) ||
      this._openFiles.some((file) => file.filePath === path) ||
      !/^[a-f0-9]{64}$/.test(revision) ||
      !previousRevision ||
      this.blockedRenames.has(oldPath) ||
      this.pendingWrites.has(oldPath) ||
      this.pendingWrites.has(path)
    ) {
      if (isNormalizedWorkspaceRelativePath(path)) this.blockedRenames.add(path);
      throw new Error("The saved-source revision changed during the editor rename.");
    }
    // Transfer the existing CAS baseline before the read. Even a failed recheck
    // cannot authorize overwriting independently changed destination bytes.
    this.revisions.set(path, previousRevision);
    this.revisions.delete(oldPath);
    this.inspectionEpochs.delete(oldPath);
    this.inspectionEpochs.set(path, {});
    this._openFiles = this._openFiles.map((f) =>
      f.filePath === oldPath ? { ...f, filePath: path, name: path.split("/").at(-1)! } : f,
    );
    if (previousRevision !== revision) {
      this.blockedRenames.add(path);
      throw new Error(
        "The source save baseline changed before the rename; compare with disk before saving.",
      );
    }
    const current = await this.readFileData(path);
    if (current.revision !== revision)
      throw new Error("The renamed saved source changed; inspect transaction recovery.");
  }
  private readonly readTimeoutMs: number;
  private readonly revisions = new Map<string, string>();
  private readonly snapshots = new WeakMap<EditorDiskSnapshot, string>();
  private readonly inspectionEpochs = new Map<string, object>();
  private readonly pendingWrites = new Set<string>();
  private readonly blockedRenames = new Set<string>();

  constructor(options: TauriEditorAdapterOptions = {}) {
    const configuredTimeout = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this.readTimeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_READ_TIMEOUT_MS;
  }

  private async readFileData(filePath: string): Promise<Record<string, unknown>> {
    // Rust command signature is `read_file(path: String)`, so the Tauri
    // argument key must stay exactly `path`.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TauriAdapterError("read_file", "File read timed out"));
      }, this.readTimeoutMs);
    });

    let result: Record<string, unknown>;
    try {
      result = await Promise.race([
        invokeTauri<Record<string, unknown>>("read_file", { path: filePath }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (typeof result.content !== "string") {
      throw new TauriAdapterError(
        "read_file",
        "Invalid read_file response: missing string content",
      );
    }

    return result;
  }

  async readPreviewContent(filePath: string): Promise<Readonly<EditorContent>> {
    if (!isNormalizedWorkspaceRelativePath(filePath))
      throw new TauriAdapterError("read_file", "Invalid workspace preview path");
    const result = await this.readFileData(filePath);
    return Object.freeze({
      filePath,
      content: result.content as string,
      language:
        typeof result.language === "string" && result.language.length > 0
          ? result.language
          : detectLanguage(filePath),
    });
  }

  /** Load the content of the file at `filePath`. */
  async loadContent(filePath: string): Promise<EditorContent> {
    this.inspectionEpochs.set(filePath, {});
    const result = await this.readFileData(filePath);
    const content = result.content as string;
    if (typeof result.revision === "string" && /^[a-f0-9]{64}$/.test(result.revision)) {
      this.revisions.set(filePath, result.revision);
      this.blockedRenames.delete(filePath);
      if (typeof result.path === "string") this.revisions.set(result.path, result.revision);
    }
    const language =
      typeof result.language === "string" && result.language.length > 0
        ? result.language
        : detectLanguage(filePath);

    const openFiles = await this.getOpenFiles();
    if (!openFiles.some((file) => file.filePath === filePath)) {
      openFiles.push({
        filePath,
        name: filePath.split("/").pop() ?? filePath,
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

  /** Inspection never updates the revision that protects the existing buffer's saves. */
  async inspectContent(filePath: string): Promise<EditorDiskSnapshot> {
    const baseline = this.revisions.get(filePath);
    if (!baseline) {
      throw new TauriAdapterError(
        "read_file",
        "Disk comparison is unavailable without a read revision",
      );
    }
    const result = await this.readFileData(filePath);
    if (typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision)) {
      throw new TauriAdapterError("read_file", "Invalid disk snapshot revision");
    }
    if (this.revisions.get(filePath) !== baseline) {
      throw new TauriAdapterError(
        "read_file",
        "The save baseline changed while reading the disk snapshot",
      );
    }
    const snapshot: EditorDiskSnapshot = Object.freeze({
      filePath,
      content: result.content as string,
      language:
        typeof result.language === "string" && result.language.length > 0
          ? result.language
          : detectLanguage(filePath),
      revision: result.revision,
      changedSinceRead: result.revision !== baseline,
    });
    this.snapshots.set(snapshot, baseline);
    return snapshot;
  }

  /** Revision-only polling cannot adopt a baseline or expose source content. */
  async inspectDiskStatus(
    context: EditorDiskInspectionContext,
    filePath: string,
  ): Promise<EditorDiskStatus | null> {
    const command = "inspect_editor_disk_status";
    if (
      !context ||
      typeof context.workspaceId !== "string" ||
      !context.workspaceId.trim() ||
      context.workspaceId.length > 256 ||
      context.workspaceId.includes("\u0000") ||
      !Number.isSafeInteger(context.generation) ||
      context.generation < 1 ||
      typeof filePath !== "string" ||
      filePath.length > 4096 ||
      !filePath ||
      filePath.includes("\\") ||
      filePath.includes(":") ||
      filePath.includes("\u0000") ||
      filePath.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new TauriAdapterError(command, "Invalid disk inspection context or path");
    }
    const revision = this.revisions.get(filePath);
    const epoch = this.inspectionEpochs.get(filePath);
    if (this.pendingWrites.has(filePath)) return null;
    if (!revision || !epoch) return { filePath, status: "unavailable" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new TauriAdapterError(command, "Disk inspection timed out")),
        this.readTimeoutMs,
      );
    });
    let result: unknown;
    try {
      result = await Promise.race([
        invokeTauri(command, { request: { ...context, filePath, expectedRevision: revision } }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (
      this.inspectionEpochs.get(filePath) !== epoch ||
      this.revisions.get(filePath) !== revision ||
      this.pendingWrites.has(filePath)
    )
      return null;
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new TauriAdapterError(command, "Invalid disk status response");
    const response = result as Record<string, unknown>;
    if (
      Object.keys(response).sort().join(",") !== "filePath,generation,status,workspaceId" ||
      response.workspaceId !== context.workspaceId ||
      response.generation !== context.generation ||
      response.filePath !== filePath ||
      !["unchanged", "changed", "missing", "unavailable"].includes(response.status as string)
    ) {
      throw new TauriAdapterError(command, "Invalid disk status response");
    }
    return { filePath, status: response.status as EditorDiskStatus["status"] };
  }

  acceptDiskSnapshot(snapshot: EditorDiskSnapshot): void {
    const baseline = this.snapshots.get(snapshot);
    if (
      !baseline ||
      this.revisions.get(snapshot.filePath) !== baseline ||
      !this._openFiles.some((file) => file.filePath === snapshot.filePath)
    ) {
      throw new TauriAdapterError("read_file", "The disk snapshot is stale or unrecognized");
    }
    this.snapshots.delete(snapshot);
    this.revisions.set(snapshot.filePath, snapshot.revision);
    this.blockedRenames.delete(snapshot.filePath);
    this.inspectionEpochs.set(snapshot.filePath, {});
  }

  /** Save `content` to the file at `filePath`. Returns the updated OpenFile list. */
  async saveContent(filePath: string, content: string): Promise<OpenFile[]> {
    if (this.blockedRenames.has(filePath))
      throw new TauriAdapterError(
        "write_file",
        "The rename has no acknowledged save baseline. Compare with disk or reopen the file before saving.",
      );
    const expectedRevision = this.revisions.get(filePath);
    this.inspectionEpochs.set(filePath, {});
    this.pendingWrites.add(filePath);
    let result: Record<string, unknown>;
    try {
      result = await invokeTauri<Record<string, unknown>>("write_file", {
        path: filePath,
        content,
        ...(expectedRevision ? { expectedRevision } : {}),
      });
    } finally {
      this.pendingWrites.delete(filePath);
    }
    if (typeof result.revision === "string" && /^[a-f0-9]{64}$/.test(result.revision)) {
      this.revisions.set(filePath, result.revision);
    } else {
      this.revisions.delete(filePath);
    }

    // After saving, return the current open-files list.
    // The Rust side doesn't maintain an open-files session, so we
    // reconstruct from a simple in-memory array.
    const openFiles = await this.getOpenFiles();
    const fileName = filePath.split("/").pop() ?? filePath;
    const language =
      openFiles.find((file) => file.filePath === filePath)?.language ?? detectLanguage(filePath);

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
    return this.getOpenFiles();
  }

  /** In-memory list of open files (not persisted to Rust). */
  private _openFiles: OpenFile[] = [];

  /** Return a snapshot so consumers cannot mutate the adapter-owned session. */
  async getOpenFiles(): Promise<OpenFile[]> {
    return this._openFiles.map((file) => ({ ...file }));
  }

  /** Close the file at `filePath`. Returns the updated OpenFile list. */
  closeFile(filePath: string): OpenFile[] {
    this.revisions.delete(filePath);
    this.inspectionEpochs.delete(filePath);
    this._openFiles = this._openFiles.filter((f) => f.filePath !== filePath);
    return this._openFiles.map((file) => ({ ...file }));
  }
}
