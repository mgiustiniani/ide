import type { JavaCompilerDiagnosticsProviderId, JavaEditorDiagnosticsRequest, JavaEditorDiagnosticsResult } from "@ide/contracts";
import type { JavaEditorDiagnosticsPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";
import {
  isValidJavaQueryProjectContext,
  normalizeJavaEditorOverlayAttestation,
} from "./java-navigation-tauri";

const INVALID = "Invalid or uncorrelated Java compiler diagnostics.";
const JDT_BACKEND = "eclipse-jdt-3.44-bindings-v1";
const SDK_BACKEND = "jdk25-javac-compiler-errors-v1";
const SDK26_BACKEND = "jdk26-javac-compiler-errors-v1";
function compilerIdentity(provider: Record<string, unknown>, contextSchemaVersion: string): provider is Record<string, unknown> & {
  id?: JavaCompilerDiagnosticsProviderId;
  backend: string;
} {
  return ((provider.id === undefined || provider.id === "java-jdt-bindings-v1") && provider.backend === JDT_BACKEND)
    || (provider.id === "java-sdk-compiler-diagnostics-v1" && provider.backend === SDK_BACKEND)
    || (provider.id === "java-sdk-compiler-diagnostics-v1" && provider.backend === SDK26_BACKEND && contextSchemaVersion === "java-project-context-v7")
    || (provider.id === "java-sdk-and-jdt-compiler-diagnostics-v1" && provider.backend === `${SDK_BACKEND}+${JDT_BACKEND}`);
}
function compilerCode(code: string, backend: string): boolean {
  const jdt = code === "java.jdt.syntax" || code === "java.jdt.typeResolution";
  const sdk = /^java\.javac\.compiler\.err\.[a-zA-Z0-9_.]+$/u.test(code);
  return backend === JDT_BACKEND ? jdt : backend === SDK_BACKEND || backend === SDK26_BACKEND ? sdk : jdt || sdk;
}
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(INVALID);
  return v as Record<string, unknown>;
}
function path(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= 4096 &&
    !v.includes(":") &&
    isNormalizedWorkspaceRelativePath(v) &&
    v.endsWith(".java")
  );
}
function validate(request: JavaEditorDiagnosticsRequest): void {
  const documents = request.editorOverlay?.documents;
  if (
    !text(request.workspaceId, 512) ||
    !integer(request.generation) ||
    request.generation === 0 ||
    !text(request.requestId, 128) ||
    /[\u0000-\u001f\u007f]/.test(request.requestId) ||
    !integer(request.limit) ||
    request.limit < 1 ||
    request.limit > 500 ||
    !isValidJavaQueryProjectContext(request.projectContext) ||
    !request.projectContext.contextSchemaVersion ||
    !Array.isArray(documents) ||
    documents.length < 1 ||
    documents.length > 128 ||
    new Set(documents.map((d) => d.path)).size !== documents.length ||
    documents.some(
      (d) =>
        !path(d.path) ||
        !integer(d.version) ||
        d.version < 1 ||
        d.version > 2_147_483_647 ||
        typeof d.text !== "string" ||
        new TextEncoder().encode(d.text).length > 1024 * 1024,
    ) ||
    documents.reduce((bytes, d) => bytes + new TextEncoder().encode(d.text).length, 0) >
      8 * 1024 * 1024 ||
    !documents.some(
      (d) =>
        d.path === request.document.path &&
        d.version === request.document.version &&
        d.text === request.document.text,
    )
  )
    throw new Error(INVALID);
}
function point(value: unknown, source: string) {
  const p = object(value);
  if (!integer(p.line) || !integer(p.character)) throw new Error(INVALID);
  const line = source.split("\n")[p.line]?.replace(/\r$/, "");
  if (
    line === undefined ||
    p.character > line.length ||
    (p.character > 0 &&
      /[\uD800-\uDBFF]/.test(line[p.character - 1]) &&
      /[\uDC00-\uDFFF]/.test(line[p.character] ?? ""))
  )
    throw new Error(INVALID);
  return { line: p.line, character: p.character };
}

/** Decode and hash-check actual native output against the captured editor inventory. */
export async function normalizeJavaEditorDiagnostics(
  value: unknown,
  request: JavaEditorDiagnosticsRequest,
): Promise<JavaEditorDiagnosticsResult> {
  validate(request);
  const d = object(value);
  if (
    d.workspaceId !== request.workspaceId ||
    d.generation !== request.generation ||
    d.requestId !== request.requestId ||
    d.kind !== "diagnostics" ||
    d.documentPath !== request.document.path ||
    d.documentVersion !== request.document.version
  )
    throw new Error(INVALID);
  const correlation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    kind: "diagnostics" as const,
    documentPath: request.document.path,
    documentVersion: request.document.version,
  };
  if (d.status === "unavailable" || d.status === "refused") {
    if (
      !text(d.message, 4096) ||
      (d.projectContextRetired !== undefined && d.projectContextRetired !== true) ||
      (d.refusalCode !== undefined &&
        (!text(d.refusalCode, 128) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d.refusalCode))) ||
      d.items !== undefined ||
      d.complete !== undefined
    )
      throw new Error(INVALID);
    return {
      ...correlation,
      status: d.status,
      message:
        d.refusalCode === "java.context.sourceRootProvenanceIncomplete"
          ? "Java compiler checks are unavailable because RefactorKit has not supplied verified source folder information."
          : d.message,
      ...(d.refusalCode ? { refusalCode: d.refusalCode as string } : {}),
      ...(d.projectContextRetired === true ? { projectContextRetired: true as const } : {}),
    };
  }
  const context = object(d.projectContext),
    provider = object(d.provider);
  if (
    d.status !== "ready" ||
    d.coverage !== "compiler-errors" ||
    d.complete !== true ||
    d.snapshotHash !== request.projectContext.snapshotHash ||
    !integer(d.indexGeneration) ||
    d.indexGeneration < 1 ||
    context.projectPath !== request.projectContext.projectPath ||
    context.contextHash !== request.projectContext.contextHash ||
    context.contextSchemaVersion !== request.projectContext.contextSchemaVersion ||
    JSON.stringify(context.platformIdentities) !==
      JSON.stringify(request.projectContext.platformIdentities) ||
    provider.name !== "RefactorKit" ||
    !text(provider.version, 128) ||
    !compilerIdentity(provider, request.projectContext.contextSchemaVersion) ||
    (provider.backend !== JDT_BACKEND &&
      !/^java-project-context-v[2-7]$/u.test(request.projectContext.contextSchemaVersion ?? "")) ||
    provider.evidence !== "compiler" ||
    !Array.isArray(d.items) ||
    d.items.length > request.limit ||
    d.total !== d.items.length ||
    !integer(d.analyzedSourceCount) ||
    d.analyzedSourceCount < request.editorOverlay.documents.length ||
    d.analyzedSourceCount > 10000 ||
    !hash(d.snapshotHash)
  )
    throw new Error(INVALID);
  const editorOverlay = normalizeJavaEditorOverlayAttestation(
    d.editorOverlay,
    request.editorOverlay.documents,
    request.projectContext.snapshotHash,
  );
  await Promise.all(
    request.editorOverlay.documents.map(async (document) => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.text));
      const digest = [...new Uint8Array(bytes)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (editorOverlay.documents.find((d) => d.path === document.path)?.contentSha256 !== digest)
        throw new Error(INVALID);
    }),
  );
  if (!Array.isArray(d.sourceFiles) || d.sourceFiles.length > Math.min(500, d.items.length))
    throw new Error(INVALID);
  const sourceFiles = d.sourceFiles.map((value) => {
    const file = object(value);
    if (
      !path(file.path) ||
      typeof file.text !== "string" ||
      !hash(file.contentSha256) ||
      new TextEncoder().encode(file.text).length > 1024 * 1024
    )
      throw new Error(INVALID);
    const captured = request.editorOverlay.documents.find((d) => d.path === file.path);
    if (captured && captured.text !== file.text) throw new Error(INVALID);
    return { path: file.path, text: file.text, contentSha256: file.contentSha256 };
  });
  if (
    new Set(sourceFiles.map((file) => file.path)).size !== sourceFiles.length ||
    sourceFiles.reduce((sum, file) => sum + new TextEncoder().encode(file.text).length, 0) >
      8 * 1024 * 1024
  )
    throw new Error(INVALID);
  await Promise.all(
    sourceFiles.map(async (file) => {
      const digest = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.text)),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (file.contentSha256 !== digest) throw new Error(INVALID);
    }),
  );
  const items = d.items.map((value) => {
    const item = object(value),
      location = object(item.location),
      range = object(location.range);
    const document = sourceFiles.find((d) => d.path === location.path);
    if (
      !document ||
      !text(item.code, 256) ||
      !compilerCode(item.code, provider.backend) ||
      !text(item.message, 16_384) ||
      item.severity !== "error"
    )
      throw new Error(INVALID);
    const start = point(range.start, document.text),
      end = point(range.end, document.text);
    if (end.line < start.line || (end.line === start.line && end.character < start.character))
      throw new Error(INVALID);
    return {
      severity: "error" as const,
      code: item.code,
      message: item.message,
      location: { path: document.path, range: { start, end } },
    };
  });
  if (sourceFiles.some((file) => !items.some((item) => item.location.path === file.path)))
    throw new Error(INVALID);
  return {
    ...correlation,
    status: "ready",
    coverage: "compiler-errors",
    complete: true,
    analyzedSourceCount: d.analyzedSourceCount,
    sourceFiles,
    total: items.length,
    items,
    snapshotHash: d.snapshotHash,
    indexGeneration: d.indexGeneration,
    provider: {
      name: "RefactorKit",
      version: provider.version,
      ...(provider.id !== undefined ? { id: provider.id } : {}),
      backend: provider.backend,
      evidence: "compiler",
    },
    projectContext: {
      projectPath: request.projectContext.projectPath,
      contextHash: request.projectContext.contextHash,
      contextSchemaVersion: request.projectContext.contextSchemaVersion,
      platformIdentities: [...request.projectContext.platformIdentities],
    },
    editorOverlay,
  };
}

export class TauriJavaEditorDiagnosticsAdapter implements JavaEditorDiagnosticsPort {
  #active = new Map<string, { workspaceId: string; generation: number }>();
  async query(input: JavaEditorDiagnosticsRequest): Promise<JavaEditorDiagnosticsResult> {
    const request = structuredClone(input);
    validate(request);
    if (this.#active.has(request.requestId)) throw new Error(INVALID);
    const context = { workspaceId: request.workspaceId, generation: request.generation };
    this.#active.set(request.requestId, context);
    try {
      return await normalizeJavaEditorDiagnostics(
        await invokeTauri("query_refactorkit_java_editor_diagnostics", { request }),
        request,
      );
    } finally {
      if (this.#active.get(request.requestId) === context) this.#active.delete(request.requestId);
    }
  }
  async cancel(requestId: string): Promise<void> {
    const context = this.#active.get(requestId);
    if (context)
      await invokeTauri("cancel_refactorkit_java_navigation_query", { context, requestId });
  }
}
