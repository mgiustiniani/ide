import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
  RefactorKitLanguageCapability,
} from "../refactorkit";

export type TypeScriptJavaScriptLanguageId = "typescript" | "javascript";

export interface SavedSnapshotExternalToolchain {
  nodeExecutable: string;
  languageServerPackageRoot: string;
  typeScriptPackageRoot: string;
  allowPathNodeDiscovery: boolean;
  allowWorkspaceLocalToolchain: boolean;
}

export interface SavedSnapshotExternalToolchainApproval extends SavedSnapshotExternalToolchain {
  userApproved: boolean;
}

export interface TypeScriptJavaScriptSemanticToolchain {
  backend: string;
  runtime: RefactorKitLanguageAdapterRuntime;
  extensions: string[];
  nodeExecutable: string;
  languageServerPackageRoot: string;
  typeScriptPackageRoot: string;
}

export type TypeScriptJavaScriptSemanticSession =
  | { state: "unavailable"; reason: string }
  | {
      state: "active";
      languageId: TypeScriptJavaScriptLanguageId;
      workspaceId: string;
      workspaceGeneration: number;
      sessionId: string;
      snapshot: { state: "saved"; identity: string } | { state: "unsaved" };
      providerVersion: string;
      toolchain: TypeScriptJavaScriptSemanticToolchain;
    };

export interface RelevantTypeScriptJavaScriptBuffer {
  path: string;
  savedState: "saved" | "never-saved";
  dirty: boolean;
}

export interface JavaScriptSymbolSearchCompatibility {
  semantics: "not-dynamic-or-mixed" | "dynamic-or-mixed";
  incompletenessDisclosure: "not-shown" | "shown";
}

/** Current authority and evidence required before a symbol-search invocation boundary. */
export interface SavedSnapshotSymbolSearchPolicyInput {
  languageId: string;
  sourceExtension: string;
  workspaceRoot: string;
  workspaceId: string;
  workspaceGeneration: number;
  authorizedWorkspaceId: string;
  authorizedWorkspaceGeneration: number;
  currentSavedSnapshotIdentity: string;
  query: string;
  capabilities: RefactorKitCapabilities;
  semanticSession: TypeScriptJavaScriptSemanticSession;
  approvedToolchain: SavedSnapshotExternalToolchainApproval;
  relevantBuffers: RelevantTypeScriptJavaScriptBuffer[];
  javascriptCompatibility: JavaScriptSymbolSearchCompatibility;
  fallback: "none" | "structural-identifiers" | "other";
}

/** Provider-neutral, invocation-ready search request. No provider name grants authority. */
export interface SavedSnapshotSymbolSearchRequest {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly query: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly snapshotIdentity: string;
  readonly providerVersion: string;
  readonly backend: string;
  readonly toolchain: Readonly<SavedSnapshotExternalToolchain>;
}

export type SavedSnapshotSymbolSearchRefusalReason =
  | "invalid-language-id"
  | "invalid-source-extension"
  | "workspace-root-invalid"
  | "workspace-identity-invalid"
  | "workspace-generation-nonpositive"
  | "workspace-generation-stale"
  | "workspace-unauthorized"
  | "snapshot-identity-invalid"
  | "query-empty"
  | "query-too-long"
  | "query-invalid"
  | "fallback-prohibited"
  | "capability-absent"
  | "capability-ambiguous"
  | "capability-not-experimental"
  | "capability-not-language-server"
  | "capability-mutation-authority-inappropriate"
  | "capability-backend-mismatch"
  | "capability-runtime-unauthorized"
  | "capability-runtime-mismatch"
  | "capability-extensions-unauthorized"
  | "provider-version-unavailable"
  | "toolchain-unapproved"
  | "toolchain-discovery-enabled"
  | "toolchain-path-invalid"
  | "toolchain-not-external"
  | "semantic-session-inactive"
  | "session-identity-invalid"
  | "semantic-session-authority-mismatch"
  | "semantic-session-snapshot-unsaved"
  | "semantic-session-snapshot-mismatch"
  | "semantic-session-provider-mismatch"
  | "semantic-session-toolchain-mismatch"
  | "relevant-buffer-path-invalid"
  | "relevant-buffer-unsaved"
  | "relevant-buffer-dirty"
  | "javascript-incompleteness-disclosure-required";

export type SavedSnapshotSymbolSearchDecision =
  | { readonly kind: "ready"; readonly request: Readonly<SavedSnapshotSymbolSearchRequest> }
  | { readonly kind: "refused"; readonly reason: SavedSnapshotSymbolSearchRefusalReason };

export interface SavedSnapshotWorkspaceSymbol {
  id: string;
  name: string;
  kind: string;
}

/** Untrusted provider result metadata retained only while its search result is current. */
export interface SavedSnapshotSymbolSearchResult {
  languageId: TypeScriptJavaScriptLanguageId;
  query: string;
  workspaceId: string;
  workspaceGeneration: number;
  sessionId: string;
  snapshotIdentity: string;
  providerVersion: string;
  backend: string;
  symbols: SavedSnapshotWorkspaceSymbol[];
}

export interface SavedSnapshotDefinitionPolicyInput {
  authorization: SavedSnapshotSymbolSearchPolicyInput;
  currentSearchResult: SavedSnapshotSymbolSearchResult;
  selectedSymbolId: string;
}

/** The symbol ID is opaque and is copied verbatim; this model exposes no parsing operation. */
export interface SavedSnapshotDefinitionRequest {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly symbolId: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly snapshotIdentity: string;
  readonly providerVersion: string;
  readonly backend: string;
}

export type SavedSnapshotDefinitionRefusalReason =
  | SavedSnapshotSymbolSearchRefusalReason
  | "search-result-authority-mismatch"
  | "search-result-session-mismatch"
  | "search-result-snapshot-mismatch"
  | "search-result-provider-mismatch"
  | "symbol-identity-invalid"
  | "symbol-not-in-current-result";

export type SavedSnapshotDefinitionDecision =
  | { readonly kind: "ready"; readonly request: Readonly<SavedSnapshotDefinitionRequest> }
  | { readonly kind: "refused"; readonly reason: SavedSnapshotDefinitionRefusalReason };

/** LSP-compatible provider points are zero-based and count `character` in UTF-16 code units. */
export interface ProviderPoint {
  line: number;
  character: number;
}

/** Existing editor coordinates are one-based; no text or offset interpretation occurs here. */
export interface EditorPoint {
  readonly lineNumber: number;
  readonly column: number;
}

export type ProviderPointNormalizationDecision =
  | { readonly kind: "ready"; readonly point: Readonly<EditorPoint> }
  | { readonly kind: "refused"; readonly reason: "invalid-provider-point" };

interface OperationPair {
  adapterExtensions: readonly string[];
  workspaceSymbols: RefactorKitLanguageCapability;
  definition: RefactorKitLanguageCapability;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const SOURCE_EXTENSION = /^[a-z0-9]+$/u;
const OPAQUE_SYMBOL_ID = /^lsp-symbol-v1:[a-f0-9]{64}$/u;

/**
 * Authorizes exactly one matched workspaceSymbols/definition pair for the current saved provider
 * snapshot. The decision is pure and never discovers tools, invokes providers, or falls back.
 */
export function decideSavedSnapshotSymbolSearchRequest(
  input: SavedSnapshotSymbolSearchPolicyInput,
): SavedSnapshotSymbolSearchDecision {
  if (input.languageId !== "typescript" && input.languageId !== "javascript") {
    return searchRefused("invalid-language-id");
  }
  if (!SOURCE_EXTENSION.test(input.sourceExtension)) {
    return searchRefused("invalid-source-extension");
  }
  if (!validAbsolutePath(input.workspaceRoot)) return searchRefused("workspace-root-invalid");
  if (!validIdentity(input.workspaceId) || !validIdentity(input.authorizedWorkspaceId)) {
    return searchRefused("workspace-identity-invalid");
  }
  if (!positiveInteger(input.workspaceGeneration)) {
    return searchRefused("workspace-generation-nonpositive");
  }
  if (input.workspaceId !== input.authorizedWorkspaceId) {
    return searchRefused("workspace-unauthorized");
  }
  if (
    !positiveInteger(input.authorizedWorkspaceGeneration) ||
    input.workspaceGeneration !== input.authorizedWorkspaceGeneration
  ) {
    return searchRefused("workspace-generation-stale");
  }
  if (!validIdentity(input.currentSavedSnapshotIdentity)) {
    return searchRefused("snapshot-identity-invalid");
  }

  const query = input.query.trim();
  if (query.length === 0) return searchRefused("query-empty");
  if (query.length > 1024) return searchRefused("query-too-long");
  if (CONTROL_CHARACTERS.test(query)) return searchRefused("query-invalid");
  if (input.fallback !== "none") return searchRefused("fallback-prohibited");

  const pairDecision = selectOperationPair(input.capabilities, input.languageId);
  if (pairDecision.kind === "refused") return pairDecision;
  const pair = pairDecision.pair;
  const operations = [pair.workspaceSymbols, pair.definition] as const;

  if (operations.some(({ stability }) => stability !== "experimental")) {
    return searchRefused("capability-not-experimental");
  }
  if (operations.some(({ evidence }) => evidence !== "language-server")) {
    return searchRefused("capability-not-language-server");
  }
  if (operations.some(({ mutationAuthority }) => mutationAuthority !== "none")) {
    return searchRefused("capability-mutation-authority-inappropriate");
  }
  if (
    !validMetadata(pair.workspaceSymbols.backend) ||
    pair.workspaceSymbols.backend !== pair.definition.backend
  ) {
    return searchRefused("capability-backend-mismatch");
  }
  if (operations.some(({ runtime }) => !qualifiedRuntime(runtime))) {
    return searchRefused("capability-runtime-unauthorized");
  }
  if (!runtimeEquals(pair.workspaceSymbols.runtime, pair.definition.runtime)) {
    return searchRefused("capability-runtime-mismatch");
  }
  if (
    !pair.adapterExtensions.includes(input.sourceExtension) ||
    operations.some(({ extensions }) => !validExtensions(extensions)) ||
    operations.some(({ extensions }) => !extensions.includes(input.sourceExtension)) ||
    !stringSetEquals(pair.workspaceSymbols.extensions, pair.definition.extensions)
  ) {
    return searchRefused("capability-extensions-unauthorized");
  }

  const providerVersion = input.capabilities.providerVersion;
  if (!providerVersion || !validMetadata(providerVersion)) {
    return searchRefused("provider-version-unavailable");
  }

  const toolchainDecision = validateApprovedToolchain(input.approvedToolchain, input.workspaceRoot);
  if (toolchainDecision) return searchRefused(toolchainDecision);

  const session = input.semanticSession;
  if (session.state !== "active") return searchRefused("semantic-session-inactive");
  if (!validIdentity(session.sessionId)) return searchRefused("session-identity-invalid");
  if (
    session.languageId !== input.languageId ||
    session.workspaceId !== input.workspaceId ||
    session.workspaceGeneration !== input.workspaceGeneration
  ) {
    return searchRefused("semantic-session-authority-mismatch");
  }
  if (session.snapshot.state !== "saved") {
    return searchRefused("semantic-session-snapshot-unsaved");
  }
  if (
    !validIdentity(session.snapshot.identity) ||
    session.snapshot.identity !== input.currentSavedSnapshotIdentity
  ) {
    return searchRefused("semantic-session-snapshot-mismatch");
  }
  if (!validMetadata(session.providerVersion) || session.providerVersion !== providerVersion) {
    return searchRefused("semantic-session-provider-mismatch");
  }
  if (
    session.toolchain.backend !== pair.workspaceSymbols.backend ||
    !runtimeEquals(session.toolchain.runtime, pair.workspaceSymbols.runtime) ||
    !stringSetEquals(session.toolchain.extensions, pair.workspaceSymbols.extensions) ||
    session.toolchain.nodeExecutable !== input.approvedToolchain.nodeExecutable ||
    session.toolchain.languageServerPackageRoot !==
      input.approvedToolchain.languageServerPackageRoot ||
    session.toolchain.typeScriptPackageRoot !== input.approvedToolchain.typeScriptPackageRoot
  ) {
    return searchRefused("semantic-session-toolchain-mismatch");
  }

  for (const buffer of input.relevantBuffers) {
    if (!validAbsolutePath(buffer.path) || !isWithin(buffer.path, input.workspaceRoot)) {
      return searchRefused("relevant-buffer-path-invalid");
    }
    if (buffer.savedState !== "saved") return searchRefused("relevant-buffer-unsaved");
    if (buffer.dirty) return searchRefused("relevant-buffer-dirty");
  }

  if (
    input.languageId === "javascript" &&
    input.javascriptCompatibility.semantics === "dynamic-or-mixed" &&
    input.javascriptCompatibility.incompletenessDisclosure !== "shown"
  ) {
    return searchRefused("javascript-incompleteness-disclosure-required");
  }

  const toolchain: Readonly<SavedSnapshotExternalToolchain> = Object.freeze({
    nodeExecutable: input.approvedToolchain.nodeExecutable,
    languageServerPackageRoot: input.approvedToolchain.languageServerPackageRoot,
    typeScriptPackageRoot: input.approvedToolchain.typeScriptPackageRoot,
    allowPathNodeDiscovery: false,
    allowWorkspaceLocalToolchain: false,
  });
  const request: Readonly<SavedSnapshotSymbolSearchRequest> = Object.freeze({
    languageId: input.languageId,
    query,
    workspaceId: input.workspaceId,
    workspaceGeneration: input.workspaceGeneration,
    sessionId: session.sessionId,
    snapshotIdentity: input.currentSavedSnapshotIdentity,
    providerVersion,
    backend: pair.workspaceSymbols.backend,
    toolchain,
  });
  return Object.freeze({ kind: "ready", request });
}

/** Re-authorizes current evidence, then copies one current-result opaque identity verbatim. */
export function decideSavedSnapshotDefinitionRequest(
  input: SavedSnapshotDefinitionPolicyInput,
): SavedSnapshotDefinitionDecision {
  const authorization = decideSavedSnapshotSymbolSearchRequest(input.authorization);
  if (authorization.kind === "refused") return authorization;

  const request = authorization.request;
  const result = input.currentSearchResult;
  if (
    result.languageId !== request.languageId ||
    result.query !== request.query ||
    result.workspaceId !== request.workspaceId ||
    result.workspaceGeneration !== request.workspaceGeneration
  ) {
    return definitionRefused("search-result-authority-mismatch");
  }
  if (result.sessionId !== request.sessionId) {
    return definitionRefused("search-result-session-mismatch");
  }
  if (result.snapshotIdentity !== request.snapshotIdentity) {
    return definitionRefused("search-result-snapshot-mismatch");
  }
  if (result.providerVersion !== request.providerVersion || result.backend !== request.backend) {
    return definitionRefused("search-result-provider-mismatch");
  }
  if (!OPAQUE_SYMBOL_ID.test(input.selectedSymbolId)) {
    return definitionRefused("symbol-identity-invalid");
  }
  if (!result.symbols.some(({ id }) => id === input.selectedSymbolId)) {
    return definitionRefused("symbol-not-in-current-result");
  }

  const definitionRequest: Readonly<SavedSnapshotDefinitionRequest> = Object.freeze({
    languageId: request.languageId,
    symbolId: input.selectedSymbolId,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
  });
  return Object.freeze({ kind: "ready", request: definitionRequest });
}

export function normalizeProviderPoint(
  providerPoint: ProviderPoint,
): ProviderPointNormalizationDecision {
  if (
    !Number.isSafeInteger(providerPoint.line) ||
    providerPoint.line < 0 ||
    !Number.isSafeInteger(providerPoint.character) ||
    providerPoint.character < 0 ||
    !Number.isSafeInteger(providerPoint.line + 1) ||
    !Number.isSafeInteger(providerPoint.character + 1)
  ) {
    return Object.freeze({ kind: "refused", reason: "invalid-provider-point" });
  }
  const point: Readonly<EditorPoint> = Object.freeze({
    lineNumber: providerPoint.line + 1,
    column: providerPoint.character + 1,
  });
  return Object.freeze({ kind: "ready", point });
}

function selectOperationPair(
  capabilities: RefactorKitCapabilities,
  languageId: TypeScriptJavaScriptLanguageId,
):
  | { kind: "ready"; pair: OperationPair }
  | { kind: "refused"; reason: "capability-absent" | "capability-ambiguous" } {
  const kernel = capabilities.languageKernel;
  if (!kernel?.available) return searchRefused("capability-absent");

  const adapters = kernel.schema.adapters.filter((adapter) => adapter.languageId === languageId);
  const workspaceSymbols = adapters.flatMap((adapter) =>
    adapter.capabilities
      .filter((capability) => capability.operation === "workspaceSymbols")
      .map((capability) => ({ adapter, capability })),
  );
  const definitions = adapters.flatMap((adapter) =>
    adapter.capabilities
      .filter((capability) => capability.operation === "definition")
      .map((capability) => ({ adapter, capability })),
  );
  if (workspaceSymbols.length === 0 || definitions.length === 0) {
    return searchRefused("capability-absent");
  }
  if (workspaceSymbols.length !== 1 || definitions.length !== 1) {
    return searchRefused("capability-ambiguous");
  }
  if (workspaceSymbols[0]!.adapter !== definitions[0]!.adapter) {
    return searchRefused("capability-absent");
  }
  return {
    kind: "ready",
    pair: {
      adapterExtensions: workspaceSymbols[0]!.adapter.extensions,
      workspaceSymbols: workspaceSymbols[0]!.capability,
      definition: definitions[0]!.capability,
    },
  };
}

function validateApprovedToolchain(
  toolchain: SavedSnapshotExternalToolchainApproval,
  workspaceRoot: string,
):
  | "toolchain-unapproved"
  | "toolchain-discovery-enabled"
  | "toolchain-path-invalid"
  | "toolchain-not-external"
  | undefined {
  if (toolchain.userApproved !== true) return "toolchain-unapproved";
  if (toolchain.allowPathNodeDiscovery || toolchain.allowWorkspaceLocalToolchain) {
    return "toolchain-discovery-enabled";
  }
  const paths = [
    toolchain.nodeExecutable,
    toolchain.languageServerPackageRoot,
    toolchain.typeScriptPackageRoot,
  ];
  if (paths.some((path) => !validAbsolutePath(path))) return "toolchain-path-invalid";
  if (paths.some((path) => isWithin(path, workspaceRoot))) return "toolchain-not-external";
  return undefined;
}

function searchRefused<T extends SavedSnapshotSymbolSearchRefusalReason>(
  reason: T,
): { readonly kind: "refused"; readonly reason: T } {
  return Object.freeze({ kind: "refused", reason });
}

function definitionRefused(
  reason: SavedSnapshotDefinitionRefusalReason,
): SavedSnapshotDefinitionDecision {
  return Object.freeze({ kind: "refused", reason });
}

function validIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function validMetadata(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function validExtensions(extensions: readonly string[]): boolean {
  return extensions.length > 0 && extensions.every((extension) => SOURCE_EXTENSION.test(extension));
}

function validAbsolutePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  const absolute =
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    /^\/\/[^/]+\/[^/]+/u.test(normalized);
  if (!absolute) return false;
  const pathWithoutRoot = normalized.replace(/^(?:[A-Za-z]:)?\/+/, "");
  const segments = pathWithoutRoot.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isWithin(candidate: string, root: string): boolean {
  const candidatePath = comparablePath(candidate);
  const rootPath = comparablePath(root);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function comparablePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return /^[A-Za-z]:\//u.test(normalized) ? normalized.toLowerCase() : normalized;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function qualifiedRuntime(runtime: RefactorKitLanguageAdapterRuntime): boolean {
  return (
    runtime.executionMode === "external-process" &&
    runtime.supportsTimeout &&
    runtime.supportsCancellation &&
    runtime.usesWorkspaceOverlay &&
    runtime.recordsProcessProvenance &&
    positiveInteger(runtime.limits.requestTimeoutMillis ?? 0) &&
    positiveInteger(runtime.limits.maxInputBytes ?? 0) &&
    positiveInteger(runtime.limits.maxOutputBytes ?? 0) &&
    positiveInteger(runtime.limits.maxProcesses ?? 0)
  );
}

function runtimeEquals(
  left: RefactorKitLanguageAdapterRuntime,
  right: RefactorKitLanguageAdapterRuntime,
): boolean {
  return (
    left.executionMode === right.executionMode &&
    left.supportsTimeout === right.supportsTimeout &&
    left.supportsCancellation === right.supportsCancellation &&
    left.usesWorkspaceOverlay === right.usesWorkspaceOverlay &&
    left.recordsProcessProvenance === right.recordsProcessProvenance &&
    left.limits.requestTimeoutMillis === right.limits.requestTimeoutMillis &&
    left.limits.maxInputBytes === right.limits.maxInputBytes &&
    left.limits.maxOutputBytes === right.limits.maxOutputBytes &&
    left.limits.maxProcesses === right.limits.maxProcesses
  );
}

function stringSetEquals(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}
