import type {
  JavaCallHierarchySourceNavigation,
  JavaEditorOverlayAttestation,
  JavaMethodBindingIdentity,
  JavaNavigationContext,
  JavaNavigationItem,
  JavaNavigationLocation,
  JavaNavigationRequest,
  JavaNavigationResult,
  JavaProjectOperationContext,
  JavaProjectContextAttestation,
} from "@ide/contracts";
import { isJavaProjectOperationContext } from "@ide/contracts";
import type { JavaNavigationPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";

const INVALID = "Invalid or uncorrelated Java navigation response.";
const MAX_JAVA_NAVIGATION_LOCATIONS = 10_000;
const MAX_JAVA_TYPE_HIERARCHY_ITEMS = 200;
const MAX_JAVA_CALL_HIERARCHY_ITEMS = 500;
const MAX_JAVA_IMPLEMENTATION_ITEMS = 200;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function refusalCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  );
}
function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    !value.includes(":") &&
    isNormalizedWorkspaceRelativePath(value)
  );
}
/** Decode the shared immutable editor proof without granting edit or filesystem authority. */
export function normalizeJavaEditorOverlayAttestation(
  value: unknown,
  expected: { path: string; text: string; version: number }[],
  baseSnapshotHash: string,
  expectedOverlayHash?: string,
): JavaEditorOverlayAttestation {
  const proof = object(value);
  if (
    proof.baseSnapshotHash !== baseSnapshotHash ||
    !hash(proof.providerSnapshotHash) ||
    !hash(proof.overlayHash) ||
    (expectedOverlayHash !== undefined && proof.overlayHash !== expectedOverlayHash) ||
    !Array.isArray(proof.documents) ||
    proof.documents.length !== expected.length ||
    expected.length === 0 ||
    expected.length > 128
  )
    throw new Error(INVALID);
  const documents = proof.documents.map((item) => {
    const document = object(item);
    if (
      !path(document.path) ||
      !integer(document.version) ||
      document.version === 0 ||
      !hash(document.contentSha256) ||
      !expected.some(
        (original) => original.path === document.path && original.version === document.version,
      )
    )
      throw new Error(INVALID);
    return {
      path: document.path,
      version: document.version,
      contentSha256: document.contentSha256,
    };
  });
  if (new Set(documents.map((document) => document.path)).size !== documents.length)
    throw new Error(INVALID);
  return {
    baseSnapshotHash,
    providerSnapshotHash: proof.providerSnapshotHash,
    overlayHash: proof.overlayHash,
    documents,
  };
}

export function isValidJavaQueryProjectContext(value: JavaProjectOperationContext): boolean {
  return (
    isJavaProjectOperationContext(value) &&
    (value.projectPath === "" || path(value.projectPath)) &&
    [value.sdkHome, value.mavenRepository].every(
      (text) => typeof text === "string" && text.length <= 4096 && !text.includes("\0"),
    ) &&
    Boolean(value.sdkHome) &&
    hash(value.snapshotHash) &&
    hash(value.contextHash) &&
    Array.isArray(value.platformIdentities) &&
    value.platformIdentities.length > 0 &&
    value.platformIdentities.length <= 256 &&
    value.platformIdentities.every(hash) &&
    [value.activeMavenProfiles, value.inactiveMavenProfiles].every(
      (profiles) =>
        Array.isArray(profiles) &&
        profiles.length <= 64 &&
        profiles.every(
          (profile) =>
            typeof profile === "string" &&
            profile.length > 0 &&
            profile.length <= 256 &&
            !profile.includes("\0"),
        ),
    )
  );
}
function position(value: unknown, text?: string) {
  const point = object(value);
  if (!integer(point.line) || !integer(point.character)) throw new Error(INVALID);
  if (text !== undefined) {
    const line = text.split("\n")[point.line]?.replace(/\r$/, "");
    if (
      line === undefined ||
      point.character > line.length ||
      (point.character > 0 &&
        /[\uD800-\uDBFF]/.test(line[point.character - 1]) &&
        /[\uDC00-\uDFFF]/.test(line[point.character] ?? ""))
    )
      throw new Error(INVALID);
  }
  return { line: point.line, character: point.character };
}

export function normalizeJavaNavigation(
  value: unknown,
  request: JavaNavigationRequest,
): JavaNavigationResult {
  const data = object(value);
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.requestId !== request.requestId ||
    data.kind !== request.kind ||
    data.documentPath !== request.document.path ||
    data.documentVersion !== request.document.version
  )
    throw new Error(INVALID);
  const correlation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    kind: request.kind,
    documentPath: request.document.path,
    documentVersion: request.document.version,
  };
  if (data.status === "refused" || data.status === "unavailable") {
    if (
      typeof data.message !== "string" ||
      !data.message ||
      data.message.length > 1024 ||
      (data.refusalCode !== undefined && !refusalCode(data.refusalCode)) ||
      (data.projectContextRetired !== undefined &&
        (data.projectContextRetired !== true || !request.projectContext))
    )
      throw new Error(INVALID);
    return {
      ...correlation,
      status: data.status,
      message: data.message,
      ...(data.refusalCode !== undefined ? { refusalCode: data.refusalCode } : {}),
      ...(data.projectContextRetired === true ? { projectContextRetired: true } : {}),
    };
  }
  if (
    data.status !== "ready" ||
    !hash(data.snapshotHash) ||
    !hash(data.sourceHash) ||
    !integer(data.indexGeneration) ||
    data.indexGeneration === 0 ||
    !integer(data.total) ||
    !integer(data.returned) ||
    !integer(data.warningCount) ||
    typeof data.truncated !== "boolean" ||
    typeof data.complete !== "boolean" ||
    !Array.isArray(data.locations) ||
    data.locations.length > MAX_JAVA_NAVIGATION_LOCATIONS ||
    ((request.kind === "definition" || request.kind === "typeDefinition") &&
      data.locations.length > 1) ||
    data.total < data.returned ||
    data.truncated !== data.total > data.returned ||
    !Array.isArray(data.sourceFiles) ||
    data.sourceFiles.length > data.locations.length ||
    !Array.isArray(data.items) ||
    data.items.length > request.limit
  )
    throw new Error(INVALID);
  const provider = object(data.provider);
  let editorOverlay: Extract<JavaNavigationResult, { status: "ready" }>["editorOverlay"];
  if (request.editorOverlay) {
    if (!request.projectContext) throw new Error(INVALID);
    editorOverlay = normalizeJavaEditorOverlayAttestation(
      data.editorOverlay,
      request.editorOverlay.documents,
      request.projectContext.snapshotHash,
    );
  } else if (data.editorOverlay !== undefined) throw new Error(INVALID);
  let projectContext: JavaProjectContextAttestation | undefined;
  if (request.projectContext) {
    const actual = object(data.projectContext);
    if (
      !isValidJavaQueryProjectContext(request.projectContext) ||
      data.snapshotHash !== request.projectContext.snapshotHash ||
      actual.projectPath !== request.projectContext.projectPath ||
      actual.contextHash !== request.projectContext.contextHash ||
      actual.contextSchemaVersion !==
        (request.projectContext.contextSchemaVersion ?? "java-project-context-v1") ||
      !Array.isArray(actual.platformIdentities) ||
      JSON.stringify(actual.platformIdentities) !==
        JSON.stringify(request.projectContext.platformIdentities)
    )
      throw new Error(INVALID);
    projectContext = {
      projectPath: request.projectContext.projectPath,
      contextHash: request.projectContext.contextHash,
      contextSchemaVersion:
        request.projectContext.contextSchemaVersion ?? "java-project-context-v1",
      platformIdentities: [...request.projectContext.platformIdentities],
    };
  } else if (data.projectContext !== undefined) throw new Error(INVALID);
  if (
    provider.name !== "RefactorKit" ||
    provider.backend !== "eclipse-jdt-3.44-bindings-v1" ||
    provider.evidence !== "compiler" ||
    typeof provider.version !== "string" ||
    !provider.version ||
    provider.version.length > 128
  )
    throw new Error(INVALID);
  const files = new Map<string, string>();
  let bytes = 0;
  for (const item of data.sourceFiles) {
    const file = object(item);
    if (!path(file.path) || typeof file.text !== "string" || files.has(file.path))
      throw new Error(INVALID);
    const overlay = request.editorOverlay?.documents.find(
      (document) => document.path === file.path,
    );
    if (overlay && file.text !== overlay.text) throw new Error(INVALID);
    const size = new TextEncoder().encode(file.text).length;
    bytes += size;
    if (size > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new Error(INVALID);
    files.set(file.path, file.text);
  }
  const normalizeLocation = (item: unknown): JavaNavigationLocation => {
    const location = object(item);
    if (!path(location.path) || !files.has(location.path)) throw new Error(INVALID);
    const range = object(location.range);
    const start = position(range.start, files.get(location.path));
    const end = position(range.end, files.get(location.path));
    if (end.line < start.line || (end.line === start.line && end.character < start.character))
      throw new Error(INVALID);
    return { path: location.path, range: { start, end } };
  };
  const locations: JavaNavigationLocation[] = data.locations.map(normalizeLocation);
  if ([...files.keys()].some((file) => !locations.some((location) => location.path === file)))
    throw new Error(INVALID);
  const returnedLocation = (candidate: JavaNavigationLocation) =>
    locations.some(
      (location) =>
        location.path === candidate.path &&
        JSON.stringify(location.range) === JSON.stringify(candidate.range),
    );
  const normalizeMethodIdentity = (value: unknown): JavaMethodBindingIdentity => {
    const identity = object(value);
    if (
      identity.schemaVersion !== "java-method-binding-identity-v1" ||
      !boundedText(identity.name, 1024) ||
      !boundedText(identity.qualifiedName, 4096) ||
      !boundedText(identity.bindingKey, 8192) ||
      !(identity.jvmIdentity === null || typeof identity.jvmIdentity === "object")
    )
      throw new Error(INVALID);
    let jvmIdentity: JavaMethodBindingIdentity["jvmIdentity"];
    if (identity.jvmIdentity === null) jvmIdentity = null;
    else {
      const jvm = object(identity.jvmIdentity);
      if (
        !["type", "callable", "field"].includes(String(jvm.kind)) ||
        !boundedText(jvm.ownerBinaryName, 1024) ||
        !boundedText(jvm.memberName, 1024) ||
        !boundedText(jvm.descriptor, 4096)
      )
        throw new Error(INVALID);
      jvmIdentity = {
        kind: jvm.kind as NonNullable<JavaMethodBindingIdentity["jvmIdentity"]>["kind"],
        ownerBinaryName: jvm.ownerBinaryName,
        memberName: jvm.memberName,
        descriptor: jvm.descriptor,
      };
    }
    return {
      schemaVersion: "java-method-binding-identity-v1",
      name: identity.name,
      qualifiedName: identity.qualifiedName,
      bindingKey: identity.bindingKey,
      jvmIdentity,
    };
  };
  const items: JavaNavigationItem[] = data.items.map((value) => {
    const item = object(value);
    if (typeof item.label !== "string" || !item.label || item.label.length > 1024)
      throw new Error(INVALID);
    if (request.kind === "typeHierarchy") {
      if (!["supertype", "subtype"].includes(String(item.relation)) || item.callSites !== undefined)
        throw new Error(INVALID);
      const location = normalizeLocation(item.location);
      if (!returnedLocation(location)) throw new Error(INVALID);
      return {
        label: item.label,
        relation: item.relation as "supertype" | "subtype",
        location,
      };
    }
    if (request.kind === "callHierarchy") {
      if (!Array.isArray(item.callSites) || item.relation !== undefined) throw new Error(INVALID);
      const location = item.location === undefined ? undefined : normalizeLocation(item.location);
      if (location && !returnedLocation(location)) throw new Error(INVALID);
      const callSites = item.callSites.map(normalizeLocation);
      if (callSites.some((callSite) => !returnedLocation(callSite))) throw new Error(INVALID);
      const methodIdentity =
        item.methodIdentity === undefined ? undefined : normalizeMethodIdentity(item.methodIdentity);
      let sourceNavigation: JavaCallHierarchySourceNavigation | undefined;
      if (item.sourceNavigation !== undefined) {
        const source = object(item.sourceNavigation);
        if (source.status === "available") {
          const sourceLocation = normalizeLocation(source.location);
          if (
            !location ||
            source.reason !== undefined ||
            !returnedLocation(sourceLocation) ||
            sourceLocation.path !== location.path ||
            JSON.stringify(sourceLocation.range) !== JSON.stringify(location.range)
          )
            throw new Error(INVALID);
          sourceNavigation = { status: "available", location: sourceLocation };
        } else if (source.status === "unavailable") {
          if (
            source.reason !== "classpathSourceUnavailable" ||
            source.location !== null ||
            location ||
            !methodIdentity
          )
            throw new Error(INVALID);
          sourceNavigation = {
            status: "unavailable",
            reason: "classpathSourceUnavailable",
            location: null,
          };
        } else throw new Error(INVALID);
      } else if (!location) throw new Error(INVALID);
      if (data.targetScope !== undefined && (!methodIdentity || !sourceNavigation))
        throw new Error(INVALID);
      return {
        label: methodIdentity?.qualifiedName ?? item.label,
        ...(location ? { location } : {}),
        callSites,
        ...(methodIdentity ? { methodIdentity } : {}),
        ...(sourceNavigation ? { sourceNavigation } : {}),
      };
    }
    if (request.kind === "implementations") {
      if (
        !["concreteType", "concreteMethod"].includes(String(item.relation)) ||
        item.callSites !== undefined
      )
        throw new Error(INVALID);
      const location = normalizeLocation(item.location);
      if (!returnedLocation(location)) throw new Error(INVALID);
      return {
        label: item.label,
        relation: item.relation as "concreteType" | "concreteMethod",
        location,
      };
    }
    throw new Error(INVALID);
  });
  let direction: Extract<JavaNavigationResult, { status: "ready" }>["direction"];
  let rootName: string | undefined;
  let targetKind: Extract<JavaNavigationResult, { status: "ready" }>["targetKind"];
  let scope: Extract<JavaNavigationResult, { status: "ready" }>["scope"];
  let targetScope: Extract<JavaNavigationResult, { status: "ready" }>["targetScope"];
  if (
    request.kind === "typeHierarchy" ||
    request.kind === "callHierarchy" ||
    request.kind === "implementations"
  ) {
    const expectedDirections =
      request.kind === "typeHierarchy"
        ? ["supertypes", "subtypes", "both"]
        : request.kind === "callHierarchy"
          ? ["incoming", "outgoing"]
          : [];
    if (
      typeof data.rootName !== "string" ||
      !data.rootName ||
      data.rootName.length > 1024 ||
      (request.kind === "typeHierarchy" && data.scope !== "workspace-source") ||
      (request.kind === "callHierarchy" && data.scope !== "workspace-direct-invocations") ||
      (request.kind === "callHierarchy" &&
        data.targetScope !== undefined &&
        data.targetScope !== "workspace-source+resolved-classpath") ||
      (request.kind !== "callHierarchy" && data.targetScope !== undefined) ||
      (request.kind === "implementations" &&
        (data.scope !== "workspace-source" ||
          !["type", "method"].includes(String(data.targetKind)) ||
          data.items.some((value) => {
            const relation = object(value).relation;
            return relation !== (data.targetKind === "type" ? "concreteType" : "concreteMethod");
          }))) ||
      (request.kind !== "implementations" &&
        (typeof data.direction !== "string" ||
          !expectedDirections.includes(data.direction) ||
          data.direction !== request.direction ||
          data.targetKind !== undefined)) ||
      (request.kind === "implementations" &&
        (data.direction !== undefined || request.direction !== undefined)) ||
      data.returned !== items.length ||
      (request.kind !== "callHierarchy" && data.locations.length < items.length)
    )
      throw new Error(INVALID);
    if (request.kind !== "implementations")
      direction = data.direction as NonNullable<typeof direction>;
    rootName = data.rootName;
    if (request.kind === "implementations")
      targetKind = data.targetKind as NonNullable<typeof targetKind>;
    scope = data.scope as NonNullable<typeof scope>;
    if (request.kind === "callHierarchy" && data.targetScope !== undefined)
      targetScope = data.targetScope as NonNullable<typeof targetScope>;
  } else {
    if (
      data.items.length !== 0 ||
      request.direction !== undefined ||
      data.direction !== undefined ||
      data.returned !== locations.length
    )
      throw new Error(INVALID);
    if (request.kind === "typeDefinition") {
      if (typeof data.rootName !== "string" || !data.rootName || data.scope !== "workspace-source")
        throw new Error(INVALID);
      rootName = data.rootName;
      scope = "workspace-source";
    } else if (
      data.rootName !== undefined ||
      data.scope !== undefined ||
      data.targetKind !== undefined
    )
      throw new Error(INVALID);
  }
  return {
    ...correlation,
    status: "ready",
    locations,
    items,
    returned: data.returned,
    ...(direction ? { direction } : {}),
    ...(rootName ? { rootName } : {}),
    ...(targetKind ? { targetKind } : {}),
    ...(scope ? { scope } : {}),
    ...(targetScope ? { targetScope } : {}),
    sourceFiles: [...files].map(([filePath, text]) => ({ path: filePath, text })),
    snapshotHash: data.snapshotHash,
    ...(projectContext ? { projectContext } : {}),
    ...(editorOverlay ? { editorOverlay } : {}),
    sourceHash: data.sourceHash,
    indexGeneration: data.indexGeneration,
    total: data.total,
    truncated: data.truncated,
    complete: data.complete,
    warningCount: data.warningCount,
    provider: {
      name: "RefactorKit",
      version: provider.version,
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
  };
}

function recordJavaNavigationResponseShape(value: unknown, request: JavaNavigationRequest): void {
  if (
    typeof document === "undefined" ||
    !document.body?.hasAttribute("data-native-java-navigation-diagnostics")
  )
    return;
  try {
    const data =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const locations = Array.isArray(data.locations) ? data.locations : [];
    const sourceFiles = Array.isArray(data.sourceFiles) ? data.sourceFiles : [];
    const items = Array.isArray(data.items) ? data.items : [];
    const safePath = (candidate: unknown) => (path(candidate) ? candidate : "<invalid>");
    const project =
      data.projectContext &&
      typeof data.projectContext === "object" &&
      !Array.isArray(data.projectContext)
        ? (data.projectContext as Record<string, unknown>)
        : {};
    const provider =
      data.provider && typeof data.provider === "object" && !Array.isArray(data.provider)
        ? (data.provider as Record<string, unknown>)
        : {};
    const requestProject = request.projectContext;
    document.body.setAttribute(
      "data-java-navigation-provider-response-shape",
      JSON.stringify({
        requestId: data.requestId === request.requestId ? request.requestId : "<uncorrelated>",
        kind: data.kind,
        status: data.status,
        documentPath: safePath(data.documentPath),
        documentVersion: data.documentVersion,
        snapshotHashMatches: data.snapshotHash === requestProject?.snapshotHash,
        projectContext: {
          projectPath: safePath(project.projectPath),
          contextHashMatches: project.contextHash === requestProject?.contextHash,
          schemaVersion: project.contextSchemaVersion,
          platformIdentitiesMatch:
            JSON.stringify(project.platformIdentities) ===
            JSON.stringify(requestProject?.platformIdentities),
        },
        provider: {
          name: provider.name,
          version: provider.version,
          backend: provider.backend,
          evidence: provider.evidence,
        },
        rootName: data.rootName,
        targetKind: data.targetKind,
        scope: data.scope,
        direction: data.direction,
        total: data.total,
        returned: data.returned,
        complete: data.complete,
        truncated: data.truncated,
        warningCount: data.warningCount,
        locations: {
          count: locations.length,
          firstPaths: locations
            .slice(0, 20)
            .map((entry) =>
              safePath(
                entry && typeof entry === "object" ? (entry as Record<string, unknown>).path : null,
              ),
            ),
        },
        sourceFiles: {
          count: sourceFiles.length,
          firstPaths: sourceFiles
            .slice(0, 20)
            .map((entry) =>
              safePath(
                entry && typeof entry === "object" ? (entry as Record<string, unknown>).path : null,
              ),
            ),
        },
        items: items.slice(0, 200).map((entry) => {
          const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          const location =
            item.location && typeof item.location === "object"
              ? (item.location as Record<string, unknown>)
              : {};
          return {
            label: typeof item.label === "string" ? item.label.slice(0, 256) : null,
            relation: item.relation,
            locationPath: safePath(location.path),
          };
        }),
      }),
    );
  } catch {
    // Diagnostics must never change the navigation result or refusal.
  }
}

export class TauriJavaNavigationAdapter implements JavaNavigationPort {
  #activeRequests = new Map<
    string,
    { context: { workspaceId: string; generation: number }; identity: symbol }
  >();

  async stop(context: JavaNavigationContext): Promise<void> {
    if (!context.workspaceId || !integer(context.generation) || context.generation === 0)
      throw new Error("Invalid Java navigation context.");
    await invokeTauri("stop_refactorkit_java_navigation", { context });
  }

  async cancel(requestId: string): Promise<void> {
    const active = this.#activeRequests.get(requestId);
    if (!active) return;
    await invokeTauri("cancel_refactorkit_java_navigation_query", {
      context: active.context,
      requestId,
    });
  }

  async query(request: JavaNavigationRequest): Promise<JavaNavigationResult> {
    if (
      !path(request.document.path) ||
      !request.document.path.endsWith(".java") ||
      !integer(request.generation) ||
      request.generation === 0 ||
      !integer(request.document.version) ||
      request.document.version === 0 ||
      !integer(request.limit) ||
      request.limit === 0 ||
      request.limit > 1000 ||
      ((request.kind === "definition" || request.kind === "typeDefinition") &&
        request.limit !== 1) ||
      (request.kind === "typeHierarchy" && request.limit > MAX_JAVA_TYPE_HIERARCHY_ITEMS) ||
      (request.kind === "callHierarchy" && request.limit > MAX_JAVA_CALL_HIERARCHY_ITEMS) ||
      (request.kind === "implementations" && request.limit > MAX_JAVA_IMPLEMENTATION_ITEMS) ||
      !request.requestId ||
      request.requestId.length > 128 ||
      /[\u0000-\u001F\u007F]/.test(request.requestId) ||
      typeof request.document.text !== "string" ||
      new TextEncoder().encode(request.document.text).length > 1024 * 1024 ||
      typeof request.includeDeclaration !== "boolean" ||
      ![
        "definition",
        "references",
        "typeDefinition",
        "typeHierarchy",
        "callHierarchy",
        "implementations",
      ].includes(request.kind) ||
      (request.kind === "typeHierarchy" &&
        !["supertypes", "subtypes", "both"].includes(request.direction ?? "")) ||
      (request.kind === "callHierarchy" &&
        !["incoming", "outgoing"].includes(request.direction ?? "")) ||
      (request.kind !== "typeHierarchy" &&
        request.kind !== "callHierarchy" &&
        request.direction !== undefined) ||
      (request.projectContext !== undefined && !isValidJavaQueryProjectContext(request.projectContext))
    )
      throw new Error("Invalid Java navigation request.");
    position(request.position, request.document.text);
    if (request.editorOverlay) {
      const documents = request.editorOverlay.documents;
      if (
        !request.projectContext ||
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
            !path(document.path) ||
            !document.path.endsWith(".java") ||
            !integer(document.version) ||
            document.version === 0 ||
            typeof document.text !== "string" ||
            new TextEncoder().encode(document.text).length > 1024 * 1024,
        ) ||
        documents.reduce(
          (bytes, document) => bytes + new TextEncoder().encode(document.text).length,
          0,
        ) >
          8 * 1024 * 1024
      )
        throw new Error("Invalid immutable Java editor overlay.");
    }
    if (this.#activeRequests.has(request.requestId))
      throw new Error("Invalid or duplicate Java navigation request.");
    const active = {
      context: { workspaceId: request.workspaceId, generation: request.generation },
      identity: Symbol(request.requestId),
    };
    this.#activeRequests.set(request.requestId, active);
    try {
      const response = await invokeTauri("query_refactorkit_java_navigation", { request });
      recordJavaNavigationResponseShape(response, request);
      return normalizeJavaNavigation(response, request);
    } finally {
      if (this.#activeRequests.get(request.requestId) === active)
        this.#activeRequests.delete(request.requestId);
    }
  }
}
