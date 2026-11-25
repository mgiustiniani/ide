import type { RefactorPreviewRequest, RefactorPreviewResult } from "@ide/contracts";
import { isJavaProjectOperationContext } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";

const INVALID = "Invalid or stale Java draft preview.";
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Use the same native session as immutable Java queries; no saved-source fallback. */
export function javaEditorPreviewWire(request: RefactorPreviewRequest) {
  const overlay = request.editorOverlay;
  const paths = new Set<string>();
  if (
    (request.editorMutationMode !== undefined &&
      request.editorMutationMode !== "durable-editor-owned") ||
    !request.projectContext ||
    !isJavaProjectOperationContext(request.projectContext) ||
    !overlay ||
    !Array.isArray(overlay.documents) ||
    !overlay.documents.length ||
    overlay.documents.length > 128 ||
    overlay.documents.some(
      (d) =>
        !isNormalizedWorkspaceRelativePath(d.path) ||
        !d.path.endsWith(".java") ||
        paths.has(d.path) ||
        (paths.add(d.path), false) ||
        !Number.isSafeInteger(d.version) ||
        d.version <= 0 ||
        d.version > 2147483647 ||
        typeof d.text !== "string" ||
        new TextEncoder().encode(d.text).length > 1024 * 1024,
    ) ||
    overlay.documents.reduce((n, d) => n + new TextEncoder().encode(d.text).length, 0) >
      8 * 1024 * 1024 ||
    !Number.isSafeInteger(overlay.position.line) ||
    overlay.position.line < 0 ||
    !Number.isSafeInteger(overlay.position.character) ||
    overlay.position.character < 0
  )
    throw new Error(INVALID);
  const document = overlay.documents.find((d) => d.path === request.target.path);
  if (!document) throw new Error("Open the Java source before reviewing its draft.");
  return {
    workspaceId: request.authority.workspaceId,
    generation: request.authority.workspaceGeneration,
    requestId: request.requestId,
    kind: "mutationSelection",
    projectContext: structuredClone(request.projectContext),
    editorOverlay: { documents: structuredClone(overlay.documents) },
    document: structuredClone(document),
    position: { ...overlay.position },
    includeDeclaration: true,
    limit: 1,
    editorRefactoring: {
      ...(request.editorMutationMode ? { mutationMode: request.editorMutationMode } : {}),
      operation: request.operation,
      target: { ...request.target },
      changeIntent: request.changeIntent,
      ...(request.formatterProfile
        ? { formatterProfile: structuredClone(request.formatterProfile) }
        : {}),
      selectionGeneration: request.selectionGeneration,
    },
  };
}

export function normalizeJavaEditorPreviewAuthority(
  value: unknown,
): NonNullable<RefactorPreviewResult["editorPreview"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  const data = value as Record<string, unknown>;
  if (data.mutationMode != null && data.mutationMode !== "durable-editor-owned")
    throw new Error(INVALID);
  for (const key of [
    "planHash",
    "baseSnapshotHash",
    "providerSnapshotHash",
    "expectedProviderSnapshotHash",
    "overlayHash",
  ])
    if (!hash(data[key])) throw new Error(INVALID);
  if (data.selectionHash != null && !hash(data.selectionHash)) throw new Error(INVALID);
  if (
    data.symbolId != null &&
    (typeof data.symbolId !== "string" ||
      !data.symbolId ||
      data.symbolId.length > 4096 ||
      data.symbolId.includes("\0"))
  )
    throw new Error(INVALID);
  const paths = new Set<string>();
  if (!Array.isArray(data.documents) || !data.documents.length || data.documents.length > 128)
    throw new Error(INVALID);
  const documents = data.documents.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(INVALID);
    const d = item as Record<string, unknown>;
    if (
      typeof d.path !== "string" ||
      !isNormalizedWorkspaceRelativePath(d.path) ||
      paths.has(d.path) ||
      typeof d.version !== "number" ||
      !Number.isSafeInteger(d.version) ||
      d.version <= 0 ||
      d.version > 2147483647 ||
      !hash(d.contentSha256)
    )
      throw new Error(INVALID);
    paths.add(d.path);
    return { path: d.path, version: d.version, contentSha256: d.contentSha256 };
  });
  return {
    ...(typeof data.symbolId === "string" ? { symbolId: data.symbolId } : {}),
    planHash: data.planHash as string,
    baseSnapshotHash: data.baseSnapshotHash as string,
    providerSnapshotHash: data.providerSnapshotHash as string,
    expectedProviderSnapshotHash: data.expectedProviderSnapshotHash as string,
    overlayHash: data.overlayHash as string,
    documents,
    ...(data.mutationMode === "durable-editor-owned"
      ? { mutationMode: "durable-editor-owned" as const }
      : {}),
    ...(data.selectionHash != null ? { selectionHash: data.selectionHash as string } : {}),
  };
}

export async function verifyJavaEditorPreview(
  result: RefactorPreviewResult,
  request: RefactorPreviewRequest,
) {
  const receipt = result.editorPreview,
    documents = request.editorOverlay?.documents;
  if (
    !receipt ||
    !documents ||
    receipt.baseSnapshotHash !== request.projectContext?.snapshotHash ||
    (request.editorMutationMode
      ? receipt.mutationMode !== request.editorMutationMode
      : result.applyEligibility.eligible || receipt.mutationMode !== undefined) ||
    receipt.documents.length !== documents.length ||
    (!["format-file", "organize-imports"].includes(request.operation) && !receipt.selectionHash)
  )
    throw new Error(INVALID);
  for (const document of documents) {
    const contentHash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.text)),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (
      !receipt.documents.some(
        (d) =>
          d.path === document.path &&
          d.version === document.version &&
          d.contentSha256 === contentHash,
      )
    )
      throw new Error(INVALID);
  }
}
