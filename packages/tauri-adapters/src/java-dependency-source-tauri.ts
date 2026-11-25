import type {
  JavaDependencySourceRequest,
  JavaDependencySourceReadRequest,
  JavaDependencySourceResult,
  JavaDependencySourceAssociation,
  JavaDependencySourceDeclarationRequest,
  JavaDependencySourceDeclarationResult,
  JavaDependencySourceDeclaration,
  LanguageRange,
} from "@ide/contracts";
import { isJavaProjectOperationContext } from "@ide/contracts";
import type { JavaDependencySourcePort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";
import { normalizeJavaEditorOverlayAttestation } from "./java-navigation-tauri";

const INVALID = "Invalid or uncorrelated Java dependency source response.";
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max = 4096, empty = false): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  (empty || value.length > 0) &&
  !/[\u0000-\u001f\u007f]/.test(value);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function sourceUri(value: unknown): value is string {
  if (!text(value, 8192)) return false;
  try {
    return new URL(value).protocol === "refactorkit-java-source:";
  } catch {
    return false;
  }
}
function association(value: unknown): JavaDependencySourceAssociation {
  const a = object(value),
    identity = object(a.jvmIdentity),
    provenance = object(a.provenance);
  if (
    a.readOnly !== true ||
    !sourceUri(a.resourceUri) ||
    ![a.associationHash, a.binarySha256, a.sourceArchiveSha256, a.sourceSha256].every(hash) ||
    ![a.providerId, a.moduleId, a.sourceSetId, a.binaryPath, a.sourceArchivePath].every((value) =>
      text(value),
    ) ||
    !text(a.sourceEntry) ||
    !isNormalizedWorkspaceRelativePath(a.sourceEntry) ||
    !a.sourceEntry.endsWith(".java") ||
    !["TYPE", "CALLABLE", "FIELD"].includes(String(identity.kind)) ||
    !text(identity.ownerBinaryName) ||
    !text(identity.memberName, 1024, true) ||
    !text(identity.descriptor, 16384, true) ||
    ![provenance.kind, provenance.componentId, provenance.sourceFile].every((value) =>
      text(value),
    ) ||
    a.sourceEntry.split("/").at(-1) !== provenance.sourceFile
  )
    throw new Error(INVALID);
  return structuredClone(a) as unknown as JavaDependencySourceAssociation;
}

export function normalizeJavaDependencySource(
  value: unknown,
  request: JavaDependencySourceRequest | JavaDependencySourceReadRequest,
  operation: "lookup" | "read",
): JavaDependencySourceResult {
  return normalizeSourceResponse(value, request, operation) as JavaDependencySourceResult;
}

export function normalizeJavaDependencySourceDeclaration(
  value: unknown,
  request: JavaDependencySourceDeclarationRequest,
): JavaDependencySourceDeclarationResult {
  return normalizeSourceResponse(
    value,
    request,
    "declaration",
  ) as JavaDependencySourceDeclarationResult;
}

function range(value: unknown): LanguageRange {
  const data = object(value);
  const start = object(data.start),
    end = object(data.end);
  if (
    ![start.line, start.character, end.line, end.character].every(
      (n) => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 2147483647,
    ) ||
    (end.line as number) < (start.line as number) ||
    (end.line === start.line && (end.character as number) <= (start.character as number))
  )
    throw new Error(INVALID);
  return {
    start: { line: start.line as number, character: start.character as number },
    end: { line: end.line as number, character: end.character as number },
  };
}
function declaration(value: unknown): JavaDependencySourceDeclaration {
  const d = object(value),
    nameRange = range(d.nameRange),
    declarationRange = range(d.declarationRange);
  const before = (a: LanguageRange["start"], b: LanguageRange["start"]) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character);
  if (
    d.evidence !== "JDT_SOURCE_BINDING" ||
    !text(d.bindingKey, 16384) ||
    !before(declarationRange.start, nameRange.start) ||
    !before(nameRange.end, declarationRange.end)
  )
    throw new Error(INVALID);
  return { nameRange, declarationRange, evidence: "JDT_SOURCE_BINDING", bindingKey: d.bindingKey };
}

function normalizeSourceResponse(
  value: unknown,
  request:
    | JavaDependencySourceRequest
    | JavaDependencySourceReadRequest
    | JavaDependencySourceDeclarationRequest,
  operation: "lookup" | "read" | "declaration",
): JavaDependencySourceResult | JavaDependencySourceDeclarationResult {
  const data = object(value);
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.requestId !== request.requestId ||
    data.documentPath !== request.document.path ||
    data.documentVersion !== request.document.version ||
    data.operation !== operation
  )
    throw new Error(INVALID);
  const correlation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    documentPath: request.document.path,
    documentVersion: request.document.version,
    operation,
  };
  if (["unavailable", "ambiguous", "refused"].includes(String(data.status))) {
    const reason = object(data.reason);
    if (!text(reason.code, 256) || !text(reason.message, 4096)) throw new Error(INVALID);
    let candidates: { binaryPath: string }[] | undefined;
    if (data.status === "ambiguous" && Array.isArray(data.candidates)) {
      if (data.candidates.length < 2 || data.candidates.length > 128) throw new Error(INVALID);
      candidates = data.candidates.map((candidate) => {
        const item = object(candidate);
        if (!text(item.binaryPath)) throw new Error(INVALID);
        return { binaryPath: item.binaryPath };
      });
    } else if (
      data.status === "ambiguous" &&
      !(operation === "declaration" && reason.code === "java.sources.declarationAmbiguous")
    ) {
      throw new Error(INVALID);
    }
    return {
      ...correlation,
      status: data.status as "unavailable" | "ambiguous" | "refused",
      reason: { code: reason.code, message: reason.message },
      ...(candidates ? { candidates } : {}),
    } as JavaDependencySourceResult | JavaDependencySourceDeclarationResult;
  }
  if (
    data.status !== "available" ||
    data.schemaVersion !==
      (operation === "declaration"
        ? request.editorOverlay
          ? "java-editor-dependency-source-declaration-v1"
          : "java-dependency-source-declaration-v1"
        : request.editorOverlay
          ? "java-editor-dependency-source-v1"
          : "java-dependency-source-v1") ||
    data.snapshotHash !== request.projectContext.snapshotHash ||
    data.contextHash !== request.projectContext.contextHash ||
    !Array.isArray(data.sdkIdentities) ||
    data.sdkIdentities.length !== request.projectContext.platformIdentities.length
  )
    throw new Error(INVALID);
  const editorOverlay = request.editorOverlay
    ? normalizeJavaEditorOverlayAttestation(
        data.editorOverlay,
        request.editorOverlay.documents,
        request.projectContext.snapshotHash,
        request.editorOverlay.expectedOverlayHash,
      )
    : undefined;
  if (!request.editorOverlay && data.editorOverlay !== undefined) throw new Error(INVALID);
  const sdkIdentities = data.sdkIdentities.map((value) => {
    const sdk = object(value);
    if (
      !Number.isSafeInteger(sdk.release) ||
      (sdk.release as number) < 8 ||
      (sdk.release as number) > 27 ||
      !hash(sdk.identitySha256) ||
      !text(sdk.sdkHome)
    )
      throw new Error(INVALID);
    return {
      release: sdk.release as number,
      identitySha256: sdk.identitySha256,
      sdkHome: sdk.sdkHome,
    };
  });
  if (
    JSON.stringify(sdkIdentities.map((sdk) => sdk.identitySha256)) !==
    JSON.stringify(request.projectContext.platformIdentities)
  )
    throw new Error(INVALID);
  const a = association(data.association);
  if (
    operation === "declaration" &&
    "expectedAssociationHash" in request &&
    request.expectedAssociationHash !== undefined &&
    request.expectedAssociationHash !== a.associationHash
  )
    throw new Error(INVALID);
  if (
    operation === "read" &&
    (!("expectedAssociationHash" in request) ||
      request.expectedAssociationHash !== a.associationHash ||
      typeof data.content !== "string" ||
      new TextEncoder().encode(data.content).length > 131072)
  )
    throw new Error(INVALID);
  const available = {
    ...correlation,
    status: "available" as const,
    snapshotHash: data.snapshotHash,
    contextHash: data.contextHash,
    sdkIdentities,
    association: a,
    ...(editorOverlay ? { editorOverlay } : {}),
    ...(text(data.providerVersion, 128) ? { providerVersion: data.providerVersion } : {}),
  };
  return operation === "declaration"
    ? {
        ...available,
        operation,
        schemaVersion: request.editorOverlay
          ? "java-editor-dependency-source-declaration-v1"
          : "java-dependency-source-declaration-v1",
        declaration: declaration(data.declaration),
      }
    : {
        ...available,
        operation,
        schemaVersion: request.editorOverlay
          ? "java-editor-dependency-source-v1"
          : "java-dependency-source-v1",
        ...(operation === "read" ? { content: data.content as string } : {}),
      };
}

export function validateJavaSourceRequest(request: JavaDependencySourceRequest): void {
  if (
    !text(request.workspaceId, 128) ||
    !text(request.requestId, 128) ||
    !Number.isSafeInteger(request.generation) ||
    request.generation <= 0 ||
    !Number.isSafeInteger(request.document.version) ||
    request.document.version <= 0 ||
    !isNormalizedWorkspaceRelativePath(request.document.path) ||
    !request.document.path.endsWith(".java") ||
    new TextEncoder().encode(request.document.text).length > 1048576 ||
    !isJavaProjectOperationContext(request.projectContext) ||
    !request.projectContext.sdkHome ||
    !hash(request.projectContext.snapshotHash) ||
    !hash(request.projectContext.contextHash)
  )
    throw new Error(INVALID);
  if (request.editorOverlay) {
    const { documents, expectedOverlayHash } = request.editorOverlay;
    if (
      !hash(expectedOverlayHash) ||
      !Array.isArray(documents) ||
      documents.length === 0 ||
      documents.length > 128 ||
      new Set(documents.map((document) => document.path)).size !== documents.length ||
      !documents.some(
        (document) =>
          document.path === request.document.path && document.text === request.document.text,
      ) ||
      documents.some(
        (document) =>
          !isNormalizedWorkspaceRelativePath(document.path) ||
          !document.path.endsWith(".java") ||
          !Number.isSafeInteger(document.version) ||
          document.version <= 0 ||
          document.version > 2147483647 ||
          typeof document.text !== "string",
      ) ||
      documents.reduce(
        (bytes, document) => bytes + new TextEncoder().encode(document.text).length,
        0,
      ) > 786432
    )
      throw new Error(INVALID);
  }
  const line = request.document.text.split("\n")[request.position.line]?.replace(/\r$/, "");
  if (
    !Number.isSafeInteger(request.position.line) ||
    request.position.line < 0 ||
    !Number.isSafeInteger(request.position.character) ||
    request.position.character < 0 ||
    line === undefined ||
    request.position.character > line.length ||
    (request.position.character > 0 &&
      /[\uD800-\uDBFF]/.test(line[request.position.character - 1]) &&
      /[\uDC00-\uDFFF]/.test(line[request.position.character] ?? ""))
  )
    throw new Error(INVALID);
}

export class TauriJavaDependencySourceAdapter implements JavaDependencySourcePort {
  async declaration(
    request: JavaDependencySourceDeclarationRequest,
  ): Promise<JavaDependencySourceDeclarationResult> {
    validateJavaSourceRequest(request);
    if (request.expectedAssociationHash !== undefined && !hash(request.expectedAssociationHash))
      throw new Error(INVALID);
    return normalizeJavaDependencySourceDeclaration(
      await invokeTauri("resolve_java_dependency_source_declaration", {
        request: structuredClone(request),
      }),
      request,
    );
  }
  async lookup(request: JavaDependencySourceRequest): Promise<JavaDependencySourceResult> {
    validateJavaSourceRequest(request);
    return normalizeJavaDependencySource(
      await invokeTauri("lookup_java_dependency_source", { request: structuredClone(request) }),
      request,
      "lookup",
    );
  }
  async read(request: JavaDependencySourceReadRequest): Promise<JavaDependencySourceResult> {
    validateJavaSourceRequest(request);
    if (!hash(request.expectedAssociationHash)) throw new Error(INVALID);
    return normalizeJavaDependencySource(
      await invokeTauri("read_java_dependency_source", { request: structuredClone(request) }),
      request,
      "read",
    );
  }
}
