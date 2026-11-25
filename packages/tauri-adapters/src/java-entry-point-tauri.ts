import type {
  JavaClassicEntryPoint,
  JavaEntryPointDiscoveryV1,
  JavaEntryPointRequest,
  JavaEntryPointResult,
  JavaProjectContextAuthority,
} from "@ide/contracts";
import type { JavaEntryPointPort } from "@ide/web-core/ports";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";
import {
  fail,
  object,
  text,
  integer,
  boolean,
  hash,
  texts,
  range,
  enclosingSelection,
} from "./java-entry-point-shapes";
import { normalizeJavaEntryPointDiscoveryV2 } from "./java-entry-point-v2";

function candidate(value: unknown, request: JavaEntryPointRequest): JavaClassicEntryPoint {
  const item = object(value),
    source = object(item.source);
  const path = text(source.path, 4096);
  const entryPointId = text(item.entryPointId, 75);
  if (
    !/^java-entry:[a-f0-9]{64}$/.test(entryPointId) ||
    !isNormalizedWorkspaceRelativePath(path) ||
    path.includes(":") ||
    !path.endsWith(".java") ||
    (request.path !== undefined && path !== request.path) ||
    (request.projectContext.projectPath &&
      !path.startsWith(`${request.projectContext.projectPath}/`)) ||
    item.descriptor !== "([Ljava/lang/String;)V" ||
    item.invocation !== "static" ||
    item.inherited !== false
  )
    fail();
  const binaryName = text(item.binaryName, 1024),
    declaringBinaryName = text(item.declaringBinaryName, 1024);
  if (binaryName !== declaringBinaryName || /[\s/;\[\\]/u.test(binaryName)) fail();
  return {
    entryPointId,
    binaryName,
    declaringBinaryName,
    descriptor: "([Ljava/lang/String;)V",
    invocation: "static",
    inherited: false,
    generated: boolean(item.generated),
    sourceLevel: integer(item.sourceLevel, 1),
    targetLevel: integer(item.targetLevel, 1),
    source: { path, range: range(source.range) },
  };
}
function discovery(value: unknown, request: JavaEntryPointRequest): JavaEntryPointDiscoveryV1 {
  const item = object(value),
    scope = object(item.scope),
    coverage = object(item.coverage);
  const context = request.projectContext;
  if (
    item.schemaVersion !== "java-entry-points-v1" ||
    item.status !== "ready" ||
    item.kind !== "entryPoints" ||
    item.requestId !== request.requestId ||
    item.snapshotHash !== context.snapshotHash ||
    item.contextHash !== context.contextHash ||
    item.contextSchemaVersion !== context.contextSchemaVersion ||
    item.providerId !== "java-jdt-bindings-v1" ||
    item.backend !== "eclipse-jdt-3.44-bindings-v1" ||
    item.evidence !== "compiler" ||
    item.launchProfile !== "classic-declared-v1" ||
    item.complete !== false ||
    Object.keys(scope).length !== 3 ||
    scope.providerId !== request.scope.providerId ||
    scope.moduleId !== request.scope.moduleId ||
    scope.sourceSetId !== request.scope.sourceSetId
  )
    fail();
  hash(item.snapshotHash);
  hash(item.contextHash);
  const platformIdentities = texts(item.platformIdentities, 256);
  platformIdentities.forEach(hash);
  if (JSON.stringify(platformIdentities) !== JSON.stringify(context.platformIdentities)) fail();
  const qualifiedProfiles = texts(coverage.qualifiedProfiles, 16),
    unqualifiedProfiles = texts(coverage.unqualifiedProfiles, 16);
  if (
    qualifiedProfiles.length !== 1 ||
    qualifiedProfiles[0] !== "classic-declared-v1" ||
    !["inherited-v1", "java25-v1", "compact-preview-v1"].every((p) =>
      unqualifiedProfiles.includes(p),
    )
  )
    fail();
  if (
    !Array.isArray(item.candidates) ||
    item.candidates.length > request.limit ||
    item.candidates.length > 200
  )
    fail();
  const candidates = item.candidates.map((c) => candidate(c, request));
  if (
    new Set(candidates.map((c) => c.entryPointId)).size !== candidates.length ||
    new Set(candidates.map((c) => c.binaryName)).size !== candidates.length
  )
    fail();
  const selection = enclosingSelection(item, request, candidates);
  const returnedCount = integer(item.returnedCount),
    observedEligibleLowerBound = integer(item.observedEligibleLowerBound);
  const totalEligibleCount =
    item.totalEligibleCount === null ? null : integer(item.totalEligibleCount);
  const truncated = boolean(item.truncated),
    scopeAnalysisComplete = boolean(item.scopeAnalysisComplete);
  if (
    returnedCount !== candidates.length ||
    observedEligibleLowerBound < returnedCount ||
    (totalEligibleCount !== null &&
      (totalEligibleCount < observedEligibleLowerBound ||
        (!truncated && scopeAnalysisComplete && totalEligibleCount !== returnedCount)))
  )
    fail();
  return {
    schemaVersion: "java-entry-points-v1",
    status: "ready",
    kind: "entryPoints",
    requestId: request.requestId,
    snapshotHash: context.snapshotHash,
    contextHash: context.contextHash,
    contextSchemaVersion: context.contextSchemaVersion!,
    indexGeneration: integer(item.indexGeneration, 1),
    providerId: "java-jdt-bindings-v1",
    backend: "eclipse-jdt-3.44-bindings-v1",
    evidence: "compiler",
    provenanceHash: hash(item.provenanceHash),
    scope: { ...request.scope },
    platformIdentities,
    launcherRelease: integer(item.launcherRelease, 1),
    launchProfile: "classic-declared-v1",
    scopeAnalysisComplete,
    complete: false,
    coverage: { qualifiedProfiles, unqualifiedProfiles },
    ...(selection ? { selection } : {}),
    candidates,
    returnedCount,
    totalEligibleCount,
    observedEligibleLowerBound,
    truncated,
  };
}
export function normalizeJavaEntryPointResult(
  value: unknown,
  request: JavaEntryPointRequest,
): JavaEntryPointResult {
  if ((request.entryPointSchemaVersion !== undefined && request.entryPointSchemaVersion !== "java-entry-points-v2") ||
    (request.entryPointSchemaVersion === undefined && request.launchProfile !== undefined && request.launchProfile !== "classic-declared-v1") ||
    (request.entryPointSchemaVersion === "java-entry-points-v2" && !["inherited-v1", "java25-v1"].includes(request.launchProfile ?? ""))) fail();
  const item = object(value);
  if (
    item.workspaceId !== request.workspaceId ||
    item.generation !== request.generation ||
    item.requestId !== request.requestId ||
    !["ready", "unavailable", "refused", "cancelled"].includes(item.status as string)
  )
    fail();
  const result: JavaEntryPointResult = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    status: item.status as JavaEntryPointResult["status"],
    message: text(item.message, 4096),
  };
  if (result.status === "ready") {
    if (request.entryPointSchemaVersion === "java-entry-points-v2")
      result.discovery = normalizeJavaEntryPointDiscoveryV2(item.discovery, request);
    else {
      if (request.launchProfile && request.launchProfile !== "classic-declared-v1") fail();
      result.discovery = discovery(item.discovery, request);
    }
  } else if (item.discovery !== null && item.discovery !== undefined) fail();
  return result;
}
export class TauriJavaEntryPointAdapter implements JavaEntryPointPort {
  async query(request: JavaEntryPointRequest): Promise<JavaEntryPointResult> {
    return normalizeJavaEntryPointResult(
      await invokeTauri<unknown>("query_refactorkit_java_entry_points", { request }),
      request,
    );
  }
  async cancel(authority: JavaProjectContextAuthority, requestId: string): Promise<void> {
    await invokeTauri<void>("cancel_refactorkit_java_entry_points", {
      workspaceId: authority.workspaceId,
      generation: authority.generation,
      requestId,
    });
  }
}
