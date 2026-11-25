import type {
  JavaLspRefactoringCapabilities,
  JavaLspRefactoringDocumentChange,
  JavaLspRefactoringPreview,
  JavaLspRefactoringPreviewRequest,
} from "@ide/contracts";
import type { JavaLspRefactoringPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri, TauriAdapterError } from "./errors";

const CAPABILITIES = "get_refactorkit_lsp_capabilities";
const PREVIEW = "preview_refactorkit_lsp_java_refactoring";
const INVALID = "Invalid or uncorrelated RefactorKit Java LSP response.";
const MAX_BYTES = 8 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}

function string(value: unknown, max: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value) ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error(INVALID);
  return value;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max)
    throw new Error(INVALID);
  return value as number;
}

function workspacePath(value: unknown): string {
  const path = string(value, 4096);
  if (!isNormalizedWorkspaceRelativePath(path) || !path.toLowerCase().endsWith(".java"))
    throw new Error(INVALID);
  return path;
}

function projectPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (value && !isNormalizedWorkspaceRelativePath(value)) return null;
  return value;
}

function normalizeCapabilities(value: unknown): JavaLspRefactoringCapabilities {
  const raw = record(value);
  if (
    typeof raw.available !== "boolean" ||
    typeof raw.changeVisibility !== "boolean" ||
    typeof raw.extractParameter !== "boolean" ||
    typeof raw.extractSuperclass !== "boolean" ||
    (raw.serverVersion !== null && typeof raw.serverVersion !== "string") ||
    (raw.detail !== null && typeof raw.detail !== "string") ||
    raw.available !== (raw.changeVisibility || raw.extractParameter || raw.extractSuperclass)
  )
    throw new Error(INVALID);
  return {
    available: raw.available,
    serverVersion: raw.serverVersion,
    changeVisibility: raw.changeVisibility,
    extractParameter: raw.extractParameter,
    extractSuperclass: raw.extractSuperclass,
    detail: raw.detail,
  };
}

function position(value: unknown) {
  const raw = record(value);
  return { line: integer(raw.line), character: integer(raw.character) };
}

function textEdit(value: unknown) {
  const raw = record(value);
  const range = record(raw.range);
  const edit = {
    range: { start: position(range.start), end: position(range.end) },
    newText: string(raw.newText, MAX_BYTES, true),
  };
  if (
    edit.range.start.line > edit.range.end.line ||
    (edit.range.start.line === edit.range.end.line &&
      edit.range.start.character > edit.range.end.character)
  )
    throw new Error(INVALID);
  return edit;
}

function preview(
  value: unknown,
  request: JavaLspRefactoringPreviewRequest,
): JavaLspRefactoringPreview {
  const raw = record(value);
  if (
    raw.operation !== request.operation ||
    typeof raw.workspaceEdit !== "object" ||
    raw.workspaceEdit === null ||
    typeof raw.summary !== "string" ||
    !raw.summary ||
    raw.summary.length > 240 ||
    typeof raw.providerVersion !== "string" ||
    !raw.providerVersion ||
    raw.providerVersion.length > 128
  )
    throw new Error(INVALID);
  const workspaceEdit = record(raw.workspaceEdit);
  if (
    !Array.isArray(workspaceEdit.documentChanges) ||
    workspaceEdit.documentChanges.length < 1 ||
    workspaceEdit.documentChanges.length > 2
  )
    throw new Error(INVALID);
  const source = request.documents.find((document) => document.path === request.file);
  if (!source) throw new Error(INVALID);
  const changes: JavaLspRefactoringDocumentChange[] = workspaceEdit.documentChanges.map((item) => {
    const change = record(item);
    if (change.kind === "create") {
      const path = workspacePath(change.path);
      if (
        request.operation !== "extractSuperclass" ||
        path === request.file ||
        parentPath(path) !== parentPath(request.file)
      )
        throw new Error(INVALID);
      const text = string(change.text, MAX_BYTES, true);
      if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error(INVALID);
      return { kind: "create", path, text };
    }
    if (
      change.kind !== "edit" ||
      change.path !== request.file ||
      change.version !== source.version ||
      !Array.isArray(change.edits) ||
      change.edits.length < 1 ||
      change.edits.length > 8
    )
      throw new Error(INVALID);
    return {
      kind: "edit",
      path: request.file,
      version: source.version,
      edits: change.edits.map(textEdit),
    };
  });
  const sourceEdit = changes.filter((change) => change.kind === "edit");
  const create = changes.filter((change) => change.kind === "create");
  const editCount = sourceEdit.reduce((count, change) => count + change.edits.length, 0);
  if (
    (request.operation === "changeVisibility" && (changes.length !== 1 || editCount !== 1)) ||
    (request.operation === "extractParameter" && (changes.length !== 1 || editCount !== 3)) ||
    (request.operation === "extractSuperclass" &&
      (changes.length !== 2 || create.length !== 1 || editCount !== 2))
  )
    throw new Error(INVALID);
  return {
    operation: request.operation,
    summary: raw.summary,
    providerVersion: raw.providerVersion,
    workspaceEdit: { documentChanges: changes },
  };
}

function parentPath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

export class TauriJavaLspRefactoringAdapter implements JavaLspRefactoringPort {
  async getCapabilities(authority: { workspaceId: string; generation: number; sdkHome: string }) {
    if (
      !authority.workspaceId ||
      authority.workspaceId.length > 256 ||
      !Number.isSafeInteger(authority.generation) ||
      authority.generation <= 0 ||
      typeof authority.sdkHome !== "string" ||
      !authority.sdkHome ||
      authority.sdkHome.length > 4096
    )
      throw new TauriAdapterError(CAPABILITIES, "The workspace identity is invalid.");
    try {
      return normalizeCapabilities(await invokeTauri<unknown>(CAPABILITIES, authority));
    } catch (cause) {
      if (cause instanceof TauriAdapterError) throw cause;
      throw new TauriAdapterError(CAPABILITIES, INVALID, cause);
    }
  }

  async preview(request: JavaLspRefactoringPreviewRequest) {
    const source = request.documents.find((document) => document.path === request.file);
    if (
      !request.workspaceId ||
      request.workspaceId.length > 256 ||
      !Number.isSafeInteger(request.generation) ||
      request.generation <= 0 ||
      projectPath(request.projectPath) === null ||
      typeof request.sdkHome !== "string" ||
      !request.sdkHome ||
      request.sdkHome.length > 4096 ||
      !workspacePath(request.file) ||
      !source ||
      !Array.isArray(request.documents) ||
      request.documents.length < 1 ||
      request.documents.length > 256 ||
      request.documents.some(
        (document) =>
          !workspacePath(document.path) ||
          !Number.isSafeInteger(document.version) ||
          document.version < 1 ||
          document.version > 2147483647 ||
          typeof document.text !== "string",
      )
    )
      throw new TauriAdapterError(PREVIEW, "The Java refactoring request is invalid.");
    const bytes = request.documents.reduce(
      (size, document) => size + new TextEncoder().encode(document.text).length,
      0,
    );
    if (
      bytes > 32 * 1024 * 1024 ||
      request.documents.some(
        (document) => new TextEncoder().encode(document.text).length > MAX_BYTES,
      )
    )
      throw new TauriAdapterError(
        PREVIEW,
        "The Java editor buffers exceed the RefactorKit request limit.",
      );
    try {
      return preview(await invokeTauri<unknown>(PREVIEW, { request }), request);
    } catch (cause) {
      if (cause instanceof TauriAdapterError) throw cause;
      throw new TauriAdapterError(PREVIEW, INVALID, cause);
    }
  }
}
