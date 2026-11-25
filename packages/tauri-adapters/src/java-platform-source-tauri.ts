import type {
  JavaDependencySourceDeclaration,
  JavaPlatformSourceAssociation,
  JavaPlatformSourceDeclarationRequest,
  JavaPlatformSourceDeclarationResult,
  JavaPlatformSourceReadRequest,
  JavaPlatformSourceRequest,
  JavaPlatformSourceResult,
  LanguageRange,
} from "@ide/contracts";
import type { JavaPlatformSourcePort } from "@ide/web-core";
import { invokeTauri } from "./errors";
import { validateJavaSourceRequest } from "./java-dependency-source-tauri";
import { normalizeJavaEditorOverlayAttestation } from "./java-navigation-tauri";

const INVALID = "The SDK source response is stale or has an invalid provider contract.";
type Operation = "lookup" | "read" | "declaration";
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown, max = 4096, empty = false): value is string =>
  typeof value === "string" &&
  (empty || value.length > 0) &&
  value.length <= max &&
  !value.includes("\0");
const absolute = (value: unknown): value is string =>
  text(value) && /^(?:\/|[A-Za-z]:[\\/])/.test(value);
const relative = (value: unknown): value is string =>
  text(value) &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function range(value: unknown): LanguageRange {
  const raw = object(value),
    start = object(raw.start),
    end = object(raw.end);
  if (
    ![start.line, start.character, end.line, end.character].every(
      (part) =>
        Number.isSafeInteger(part) && (part as number) >= 0 && (part as number) <= 2147483647,
    ) ||
    (start.line as number) > (end.line as number) ||
    (start.line === end.line && (start.character as number) >= (end.character as number))
  )
    throw new Error(INVALID);
  return {
    start: { line: start.line as number, character: start.character as number },
    end: { line: end.line as number, character: end.character as number },
  };
}
function declaration(value: unknown): JavaDependencySourceDeclaration {
  const raw = object(value),
    nameRange = range(raw.nameRange),
    declarationRange = range(raw.declarationRange);
  const before = (a: LanguageRange["start"], b: LanguageRange["start"]) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character);
  if (
    raw.evidence !== "JDT_SOURCE_BINDING" ||
    !text(raw.bindingKey, 16384) ||
    !before(declarationRange.start, nameRange.start) ||
    !before(nameRange.end, declarationRange.end)
  )
    throw new Error(INVALID);
  return {
    evidence: "JDT_SOURCE_BINDING",
    bindingKey: raw.bindingKey,
    nameRange,
    declarationRange,
  };
}
function association(value: unknown, expectedIdentity: string): JavaPlatformSourceAssociation {
  const raw = object(value),
    origin = object(raw.binaryOrigin),
    identity = object(raw.jvmIdentity);
  if (
    raw.readOnly !== true ||
    raw.resourceKind !== "java-platform-source" ||
    ![
      raw.associationHash,
      raw.platformIdentitySha256,
      raw.sourceArchiveSha256,
      raw.sourceSha256,
      origin.classSha256,
      origin.moduleImageSha256,
    ].every(hash) ||
    raw.platformIdentitySha256 !== expectedIdentity ||
    ![raw.providerId, raw.moduleId, raw.sourceSetId, raw.platformModule].every((v) => text(v)) ||
    ![raw.sdkHome, raw.sourceArchivePath, origin.moduleImagePath].every(absolute) ||
    !Number.isSafeInteger(raw.effectiveRelease) ||
    (raw.effectiveRelease as number) < 8 ||
    (raw.effectiveRelease as number) > 27 ||
    raw.platformRelease !== raw.effectiveRelease ||
    !relative(raw.sourceEntry) ||
    !relative(origin.classEntry) ||
    !text(raw.sourceFile, 4096) ||
    raw.sourceFile.includes("/") ||
    raw.sourceFile.includes("\\") ||
    !raw.sourceFile.endsWith(".java") ||
    origin.kind !== "CURRENT_JRT_IMAGE" ||
    !text(origin.uri, 8192) ||
    !text(raw.resourceUri, 8192) ||
    !["TYPE", "CALLABLE", "FIELD"].includes(String(identity.kind)) ||
    !text(identity.ownerBinaryName) ||
    !text(identity.memberName, 1024, true) ||
    !text(identity.descriptor, 16384)
  )
    throw new Error(INVALID);
  const classEntry = `${identity.ownerBinaryName.replaceAll(".", "/")}.class`;
  const packagePath = identity.ownerBinaryName.includes(".")
    ? identity.ownerBinaryName
        .slice(0, identity.ownerBinaryName.lastIndexOf("."))
        .replaceAll(".", "/") + "/"
    : "";
  if (
    origin.classEntry !== classEntry ||
    raw.sourceEntry !== `${raw.platformModule}/${packagePath}${raw.sourceFile}`
  )
    throw new Error(INVALID);
  try {
    const uri = new URL(raw.resourceUri),
      binary = new URL(origin.uri);
    if (
      uri.protocol !== "refactorkit-java-platform-source:" ||
      uri.hostname !== raw.associationHash ||
      uri.username ||
      uri.password ||
      uri.port ||
      uri.search ||
      uri.hash ||
      decodeURIComponent(uri.pathname.slice(1)) !== raw.sourceEntry ||
      binary.protocol !== "jrt:" ||
      binary.host ||
      binary.search ||
      binary.hash ||
      decodeURIComponent(binary.pathname) !== `/${raw.platformModule}/${classEntry}`
    )
      throw new Error(INVALID);
  } catch {
    throw new Error(INVALID);
  }
  return {
    associationHash: raw.associationHash as string,
    resourceUri: raw.resourceUri,
    readOnly: true,
    resourceKind: "java-platform-source",
    providerId: raw.providerId as string,
    moduleId: raw.moduleId as string,
    sourceSetId: raw.sourceSetId as string,
    sdkHome: raw.sdkHome as string,
    effectiveRelease: raw.effectiveRelease as number,
    platformRelease: raw.platformRelease as number,
    platformIdentitySha256: expectedIdentity,
    platformModule: raw.platformModule as string,
    binaryOrigin: {
      kind: "CURRENT_JRT_IMAGE",
      uri: origin.uri,
      classEntry,
      classSha256: origin.classSha256 as string,
      moduleImagePath: origin.moduleImagePath as string,
      moduleImageSha256: origin.moduleImageSha256 as string,
    },
    sourceArchivePath: raw.sourceArchivePath as string,
    sourceArchiveSha256: raw.sourceArchiveSha256 as string,
    sourceEntry: raw.sourceEntry,
    sourceSha256: raw.sourceSha256 as string,
    sourceFile: raw.sourceFile,
    jvmIdentity: {
      kind: identity.kind as "TYPE" | "CALLABLE" | "FIELD",
      ownerBinaryName: identity.ownerBinaryName,
      memberName: identity.memberName,
      descriptor: identity.descriptor,
    },
  };
}

export function normalizeJavaPlatformSource(
  value: unknown,
  request:
    | JavaPlatformSourceRequest
    | JavaPlatformSourceReadRequest
    | JavaPlatformSourceDeclarationRequest,
  operation: Operation,
): JavaPlatformSourceResult | JavaPlatformSourceDeclarationResult {
  const raw = object(value);
  if (
    raw.workspaceId !== request.workspaceId ||
    raw.generation !== request.generation ||
    raw.requestId !== request.requestId ||
    raw.documentPath !== request.document.path ||
    raw.documentVersion !== request.document.version ||
    raw.operation !== operation
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
  if (["unavailable", "ambiguous", "refused"].includes(String(raw.status))) {
    const reason = object(raw.reason);
    if (
      !text(reason.code, 256) ||
      !text(reason.message) ||
      raw.association !== undefined ||
      raw.content !== undefined ||
      raw.declaration !== undefined
    )
      throw new Error(INVALID);
    return {
      ...correlation,
      status: raw.status as "unavailable" | "ambiguous" | "refused",
      reason: { code: reason.code, message: reason.message },
    };
  }
  if (
    raw.status !== "available" ||
    raw.schemaVersion !==
      (operation === "declaration"
        ? "java-platform-source-declaration-v1"
        : "java-platform-source-v1") ||
    raw.snapshotHash !== request.projectContext.snapshotHash ||
    raw.contextHash !== request.projectContext.contextHash ||
    !Array.isArray(raw.sdkIdentities) ||
    raw.sdkIdentities.length === 0 ||
    raw.sdkIdentities.length > 256
  )
    throw new Error(INVALID);
  const sdkIdentities = raw.sdkIdentities.map((value) => {
    const sdk = object(value);
    if (
      !Number.isSafeInteger(sdk.release) ||
      (sdk.release as number) < 8 ||
      (sdk.release as number) > 27 ||
      !hash(sdk.identitySha256) ||
      !absolute(sdk.sdkHome)
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
  const authority = object(raw.sourceAuthority);
  const editorOverlay = request.editorOverlay
    ? normalizeJavaEditorOverlayAttestation(
        { ...authority, providerSnapshotHash: raw.providerSnapshotHash },
        request.editorOverlay.documents,
        request.projectContext.snapshotHash,
        request.editorOverlay.expectedOverlayHash,
      )
    : undefined;
  if (
    request.editorOverlay
      ? authority.kind !== "immutable-editor-overlay"
      : authority.kind !== "saved-snapshot" ||
        authority.baseSnapshotHash !== request.projectContext.snapshotHash ||
        raw.providerSnapshotHash !== undefined ||
        authority.documents !== undefined ||
        authority.overlayHash !== undefined
  )
    throw new Error(INVALID);
  const a = association(raw.association, request.expectedPlatformIdentitySha256);
  if (
    sdkIdentities.filter(
      (sdk) =>
        sdk.identitySha256 === a.platformIdentitySha256 &&
        sdk.release === a.effectiveRelease &&
        sdk.sdkHome === a.sdkHome,
    ).length !== 1 ||
    ("expectedAssociationHash" in request &&
      request.expectedAssociationHash !== undefined &&
      request.expectedAssociationHash !== a.associationHash)
  )
    throw new Error(INVALID);
  const proof = {
    ...correlation,
    status: "available" as const,
    snapshotHash: request.projectContext.snapshotHash,
    contextHash: request.projectContext.contextHash,
    sdkIdentities,
    association: a,
    ...(editorOverlay ? { editorOverlay } : {}),
  };
  if (operation === "declaration")
    return {
      ...proof,
      operation: "declaration",
      schemaVersion: "java-platform-source-declaration-v1",
      declaration: declaration(raw.declaration),
    };
  if (
    operation === "read" &&
    (!("expectedAssociationHash" in request) ||
      request.expectedAssociationHash !== a.associationHash ||
      typeof raw.content !== "string" ||
      new TextEncoder().encode(raw.content).length > 524288)
  )
    throw new Error(INVALID);
  if (operation === "lookup" && raw.content !== undefined) throw new Error(INVALID);
  return {
    ...proof,
    operation,
    schemaVersion: "java-platform-source-v1",
    ...(operation === "read" ? { content: raw.content as string } : {}),
  };
}

function parameters(request: JavaPlatformSourceRequest, operation: Operation) {
  validateJavaSourceRequest(request);
  const associationHash =
    "expectedAssociationHash" in request ? request.expectedAssociationHash : undefined;
  if (
    !hash(request.expectedPlatformIdentitySha256) ||
    !request.projectContext.platformIdentities.includes(request.expectedPlatformIdentitySha256) ||
    (operation === "read" && !hash(associationHash)) ||
    (operation === "lookup" && associationHash !== undefined) ||
    (associationHash !== undefined && !hash(associationHash))
  )
    throw new Error(INVALID);
  const { expectedPlatformIdentitySha256, ...cursor } = structuredClone(request);
  return { request: cursor, expectedPlatformIdentitySha256 };
}

export class TauriJavaPlatformSourceAdapter implements JavaPlatformSourcePort {
  async lookup(request: JavaPlatformSourceRequest): Promise<JavaPlatformSourceResult> {
    return normalizeJavaPlatformSource(
      await invokeTauri("lookup_java_platform_source", parameters(request, "lookup")),
      request,
      "lookup",
    ) as JavaPlatformSourceResult;
  }
  async read(request: JavaPlatformSourceReadRequest): Promise<JavaPlatformSourceResult> {
    return normalizeJavaPlatformSource(
      await invokeTauri("read_java_platform_source", parameters(request, "read")),
      request,
      "read",
    ) as JavaPlatformSourceResult;
  }
  async declaration(
    request: JavaPlatformSourceDeclarationRequest,
  ): Promise<JavaPlatformSourceDeclarationResult> {
    return normalizeJavaPlatformSource(
      await invokeTauri(
        "resolve_java_platform_source_declaration",
        parameters(request, "declaration"),
      ),
      request,
      "declaration",
    ) as JavaPlatformSourceDeclarationResult;
  }
}
