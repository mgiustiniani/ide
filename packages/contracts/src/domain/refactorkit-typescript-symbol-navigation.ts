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
      semanticLease: string;
      startSnapshotHash: string;
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

/** Authority and evidence required before starting one saved-snapshot semantic session. */
export interface SavedSnapshotSemanticSessionStartPolicyInput {
  languageId: string;
  sourceExtension: string;
  workspaceRoot: string;
  workspaceId: string;
  workspaceGeneration: number;
  authorizedWorkspaceRoot: string;
  authorizedWorkspaceId: string;
  currentWorkspaceGeneration: number;
  providerVersion: string;
  backend: string;
  capabilities: RefactorKitCapabilities;
  approvedToolchain: SavedSnapshotExternalToolchainApproval;
  relevantBuffers: RelevantTypeScriptJavaScriptBuffer[];
  javascriptCompatibility: JavaScriptSymbolSearchCompatibility;
}

/** Invocation-ready start request. Session and snapshot identities are minted after invocation. */
export interface SavedSnapshotSemanticSessionStartRequest {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly provider: string;
  readonly providerVersion: string;
  readonly backend: string;
  readonly runtime: Readonly<RefactorKitLanguageAdapterRuntime>;
  readonly extensions: readonly string[];
  readonly toolchain: Readonly<SavedSnapshotExternalToolchain>;
  readonly acceptedSemanticCompleteness: readonly SavedSnapshotSymbolSemanticCompleteness[];
}

export type SavedSnapshotSemanticSessionStartRefusalReason =
  | "invalid-language-id"
  | "invalid-source-extension"
  | "workspace-root-invalid"
  | "workspace-identity-invalid"
  | "workspace-generation-nonpositive"
  | "workspace-generation-stale"
  | "workspace-unauthorized"
  | "capability-absent"
  | "capability-ambiguous"
  | "capability-not-experimental"
  | "capability-not-language-server"
  | "capability-mutation-authority-inappropriate"
  | "capability-backend-mismatch"
  | "capability-runtime-unauthorized"
  | "capability-runtime-mismatch"
  | "capability-extensions-unauthorized"
  | "provider-identity-invalid"
  | "provider-version-unavailable"
  | "provider-version-mismatch"
  | "toolchain-unapproved"
  | "toolchain-discovery-enabled"
  | "toolchain-path-invalid"
  | "toolchain-not-external"
  | "relevant-buffer-path-invalid"
  | "relevant-buffer-unsaved"
  | "relevant-buffer-dirty"
  | "javascript-incompleteness-disclosure-required";

export type SavedSnapshotSemanticSessionStartDecision =
  | { readonly kind: "ready"; readonly request: Readonly<SavedSnapshotSemanticSessionStartRequest> }
  | { readonly kind: "refused"; readonly reason: SavedSnapshotSemanticSessionStartRefusalReason };

/** Exact process fields exposed by the upstream semantic-start response, without raw arguments. */
export interface SavedSnapshotSemanticSessionProcessProvenance {
  readonly serverName: string | null;
  readonly serverVersion: string | null;
  readonly capabilitiesSha256: string;
  readonly executableSha256: string;
  readonly argumentsSha256: string;
  readonly processId: number;
}

/** Untrusted native result enriched with the authority submitted at the invocation boundary. */
export interface SavedSnapshotSemanticSessionStartResultCandidate {
  languageId: TypeScriptJavaScriptLanguageId;
  workspaceRoot: string;
  workspaceId: string;
  workspaceGeneration: number;
  sessionId: string;
  providerProjectSnapshotIdentity: string;
  semanticLease: string;
  startSnapshotHash: string;
  provider: string;
  providerVersion: string;
  backend: string;
  toolchain: TypeScriptJavaScriptSemanticToolchain;
  semanticCompleteness: SavedSnapshotSymbolSemanticCompleteness;
  processProvenance: {
    serverName: string | null;
    serverVersion: string | null;
    capabilitiesSha256: string;
    executableSha256: string;
    argumentsSha256: string;
    processId: number;
  };
}

/** Correlated active session. It claims language-server evidence, never compiler attestation. */
export interface SavedSnapshotSemanticSessionStartResult {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly providerProjectSnapshotIdentity: string;
  readonly semanticLease: string;
  readonly startSnapshotHash: string;
  readonly provider: string;
  readonly providerVersion: string;
  readonly backend: string;
  readonly toolchain: Readonly<TypeScriptJavaScriptSemanticToolchain>;
  readonly semanticCompleteness: SavedSnapshotSymbolSemanticCompleteness;
  readonly processProvenance: Readonly<SavedSnapshotSemanticSessionProcessProvenance>;
}

export interface SavedSnapshotSemanticSessionStartResultNormalizationInput {
  request: Readonly<SavedSnapshotSemanticSessionStartRequest>;
  candidate: SavedSnapshotSemanticSessionStartResultCandidate;
}

export type SavedSnapshotSemanticSessionStartResultRefusalReason =
  | "semantic-session-start-authority-mismatch"
  | "semantic-session-start-provider-mismatch"
  | "semantic-session-start-backend-mismatch"
  | "semantic-session-start-toolchain-mismatch"
  | "semantic-session-identity-invalid"
  | "provider-project-snapshot-identity-invalid"
  | "semantic-session-completeness-mismatch"
  | "semantic-session-process-provenance-invalid"
  | "compiler-attestation-unavailable";

export type SavedSnapshotSemanticSessionStartResultNormalizationDecision =
  | { readonly kind: "ready"; readonly result: Readonly<SavedSnapshotSemanticSessionStartResult> }
  | {
      readonly kind: "refused";
      readonly reason: SavedSnapshotSemanticSessionStartResultRefusalReason;
    };

export interface SavedSnapshotSemanticSessionStopPolicyInput {
  session: Readonly<SavedSnapshotSemanticSessionStartResult>;
  currentWorkspaceId: string;
  currentWorkspaceGeneration: number;
}

export interface SavedSnapshotSemanticSessionStopRequest {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
}

export type SavedSnapshotSemanticSessionStopDecision =
  | { readonly kind: "ready"; readonly request: Readonly<SavedSnapshotSemanticSessionStopRequest> }
  | {
      readonly kind: "refused";
      readonly reason:
        "semantic-session-identity-invalid" | "semantic-session-stop-authority-mismatch";
    };

export interface SavedSnapshotSemanticSessionStopResultCandidate {
  languageId: TypeScriptJavaScriptLanguageId;
  workspaceId: string;
  workspaceGeneration: number;
  sessionId: string;
  stopped: boolean;
}

export interface SavedSnapshotSemanticSessionStopResult {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly stopped: boolean;
}

export interface SavedSnapshotSemanticSessionStopResultNormalizationInput {
  request: Readonly<SavedSnapshotSemanticSessionStopRequest>;
  candidate: SavedSnapshotSemanticSessionStopResultCandidate;
}

export type SavedSnapshotSemanticSessionStopResultNormalizationDecision =
  | { readonly kind: "ready"; readonly result: Readonly<SavedSnapshotSemanticSessionStopResult> }
  | {
      readonly kind: "refused";
      readonly reason:
        "semantic-session-stop-result-mismatch" | "semantic-session-stop-result-invalid";
    };

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
  readonly semanticLease: string;
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
  | "semantic-session-lease-invalid"
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

export type SavedSnapshotSymbolSemanticCompleteness =
  "full-typescript" | "checked-javascript" | "dynamic-javascript" | "mixed-javascript";

/** Provider result bounds are unknown independently of the language's semantic completeness. */
export interface SavedSnapshotSymbolSearchCompleteness {
  resultCompleteness: "unknown";
  truncation: "unknown";
  semanticCompleteness: SavedSnapshotSymbolSemanticCompleteness;
  experimentalDisclosure: "shown" | "not-shown";
}

/** Untrusted provider result accepted only as input to the pure normalization decision. */
export interface SavedSnapshotSymbolSearchResultCandidate {
  languageId: TypeScriptJavaScriptLanguageId;
  query: string;
  workspaceId: string;
  workspaceGeneration: number;
  sessionId: string;
  snapshotIdentity: string;
  providerVersion: string;
  backend: string;
  completeness: SavedSnapshotSymbolSearchCompleteness;
  symbols: SavedSnapshotWorkspaceSymbol[];
}

/** Immutable provider result correlated to the exact authorized saved-snapshot search. */
export interface SavedSnapshotSymbolSearchResult {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly query: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly snapshotIdentity: string;
  readonly providerVersion: string;
  readonly backend: string;
  readonly completeness: Readonly<SavedSnapshotSymbolSearchCompleteness>;
  readonly symbols: readonly Readonly<SavedSnapshotWorkspaceSymbol>[];
}

export interface SavedSnapshotSymbolSearchResultNormalizationInput {
  request: Readonly<SavedSnapshotSymbolSearchRequest>;
  candidate: SavedSnapshotSymbolSearchResultCandidate;
}

export type SavedSnapshotSymbolSearchResultRefusalReason =
  | "search-result-authority-mismatch"
  | "search-result-session-mismatch"
  | "search-result-snapshot-mismatch"
  | "search-result-provider-mismatch"
  | "search-result-completeness-invalid"
  | "semantic-completeness-mismatch"
  | "experimental-disclosure-required"
  | "symbol-identity-invalid"
  | "symbol-metadata-invalid";

export type SavedSnapshotSymbolSearchResultNormalizationDecision =
  | { readonly kind: "ready"; readonly result: Readonly<SavedSnapshotSymbolSearchResult> }
  | { readonly kind: "refused"; readonly reason: SavedSnapshotSymbolSearchResultRefusalReason };

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
  readonly semanticLease: string;
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

/** Untrusted point-only provider output; range and attestation claims are explicitly rejected. */
export interface SavedSnapshotDefinitionResultCandidate {
  languageId: TypeScriptJavaScriptLanguageId;
  workspaceId: string;
  workspaceGeneration: number;
  sessionId: string;
  snapshotIdentity: string;
  providerVersion: string;
  backend: string;
  selectedSymbol: SavedSnapshotWorkspaceSymbol;
  file: string;
  point: ProviderPoint;
}

/** Immutable provider definition correlated to the selected current search result. */
export interface SavedSnapshotDefinitionResult {
  readonly languageId: TypeScriptJavaScriptLanguageId;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly snapshotIdentity: string;
  readonly providerVersion: string;
  readonly backend: string;
  readonly selectedSymbol: Readonly<SavedSnapshotWorkspaceSymbol>;
  readonly file: string;
  readonly point: Readonly<ProviderPoint>;
}

export interface SavedSnapshotDefinitionResultNormalizationInput {
  request: Readonly<SavedSnapshotDefinitionRequest>;
  currentSearchResult: Readonly<SavedSnapshotSymbolSearchResult>;
  selectedSymbol: Readonly<SavedSnapshotWorkspaceSymbol>;
  candidate: SavedSnapshotDefinitionResultCandidate;
}

export type SavedSnapshotDefinitionResultRefusalReason =
  | "definition-result-authority-mismatch"
  | "stale-search-selection"
  | "opaque-symbol-id-mismatch"
  | "selected-symbol-metadata-mismatch"
  | "definition-file-invalid"
  | "invalid-provider-point"
  | "fabricated-definition-range"
  | "fabricated-definition-attestation";

export type SavedSnapshotDefinitionResultNormalizationDecision =
  | { readonly kind: "ready"; readonly result: Readonly<SavedSnapshotDefinitionResult> }
  | { readonly kind: "refused"; readonly reason: SavedSnapshotDefinitionResultRefusalReason };

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
const OPAQUE_SEMANTIC_SESSION_ID = /^refactorkit-semantic-session-v1:[a-f0-9]{64}$/u;
const OPAQUE_SEMANTIC_LEASE = /^semantic-[a-f0-9-]{36}$/u;
const SHA256_IDENTITY = /^sha256:[a-f0-9]{64}$/u;
const SHA256_DIGEST = /^[a-f0-9]{64}$/u;

/** Authorizes one explicit external semantic-session start without minting identities. */
export function decideSavedSnapshotSemanticSessionStartRequest(
  input: SavedSnapshotSemanticSessionStartPolicyInput,
): SavedSnapshotSemanticSessionStartDecision {
  if (input.languageId !== "typescript" && input.languageId !== "javascript") {
    return startRefused("invalid-language-id");
  }
  if (!SOURCE_EXTENSION.test(input.sourceExtension)) {
    return startRefused("invalid-source-extension");
  }
  if (
    !validAbsolutePath(input.workspaceRoot) ||
    !validAbsolutePath(input.authorizedWorkspaceRoot)
  ) {
    return startRefused("workspace-root-invalid");
  }
  if (!validIdentity(input.workspaceId) || !validIdentity(input.authorizedWorkspaceId)) {
    return startRefused("workspace-identity-invalid");
  }
  if (!positiveInteger(input.workspaceGeneration)) {
    return startRefused("workspace-generation-nonpositive");
  }
  if (
    comparablePath(input.workspaceRoot) !== comparablePath(input.authorizedWorkspaceRoot) ||
    input.workspaceId !== input.authorizedWorkspaceId
  ) {
    return startRefused("workspace-unauthorized");
  }
  if (
    !positiveInteger(input.currentWorkspaceGeneration) ||
    input.workspaceGeneration !== input.currentWorkspaceGeneration
  ) {
    return startRefused("workspace-generation-stale");
  }

  const pairDecision = selectOperationPair(input.capabilities, input.languageId);
  if (pairDecision.kind === "refused") return startRefused(pairDecision.reason);
  const pair = pairDecision.pair;
  const operations = [pair.workspaceSymbols, pair.definition] as const;
  if (operations.some(({ stability }) => stability !== "experimental")) {
    return startRefused("capability-not-experimental");
  }
  if (operations.some(({ evidence }) => evidence !== "language-server")) {
    return startRefused("capability-not-language-server");
  }
  if (operations.some(({ mutationAuthority }) => mutationAuthority !== "none")) {
    return startRefused("capability-mutation-authority-inappropriate");
  }
  if (
    !validMetadata(input.backend) ||
    pair.workspaceSymbols.backend !== input.backend ||
    pair.definition.backend !== input.backend
  ) {
    return startRefused("capability-backend-mismatch");
  }
  if (operations.some(({ runtime }) => !qualifiedRuntime(runtime))) {
    return startRefused("capability-runtime-unauthorized");
  }
  if (!runtimeEquals(pair.workspaceSymbols.runtime, pair.definition.runtime)) {
    return startRefused("capability-runtime-mismatch");
  }
  if (
    !pair.adapterExtensions.includes(input.sourceExtension) ||
    operations.some(({ extensions }) => !validExtensions(extensions)) ||
    operations.some(({ extensions }) => !extensions.includes(input.sourceExtension)) ||
    !stringSetEquals(pair.workspaceSymbols.extensions, pair.definition.extensions)
  ) {
    return startRefused("capability-extensions-unauthorized");
  }

  if (!validMetadata(input.capabilities.provider)) {
    return startRefused("provider-identity-invalid");
  }
  if (!input.capabilities.providerVersion || !validMetadata(input.capabilities.providerVersion)) {
    return startRefused("provider-version-unavailable");
  }
  if (
    !validMetadata(input.providerVersion) ||
    input.providerVersion !== input.capabilities.providerVersion
  ) {
    return startRefused("provider-version-mismatch");
  }

  const toolchainDecision = validateApprovedToolchain(input.approvedToolchain, input.workspaceRoot);
  if (toolchainDecision) return startRefused(toolchainDecision);
  for (const buffer of input.relevantBuffers) {
    if (!validAbsolutePath(buffer.path) || !isWithin(buffer.path, input.workspaceRoot)) {
      return startRefused("relevant-buffer-path-invalid");
    }
    if (buffer.savedState !== "saved") return startRefused("relevant-buffer-unsaved");
    if (buffer.dirty) return startRefused("relevant-buffer-dirty");
  }
  if (
    input.languageId === "javascript" &&
    input.javascriptCompatibility.semantics === "dynamic-or-mixed" &&
    input.javascriptCompatibility.incompletenessDisclosure !== "shown"
  ) {
    return startRefused("javascript-incompleteness-disclosure-required");
  }

  const runtime = freezeRuntime(pair.workspaceSymbols.runtime);
  const extensions = Object.freeze([...pair.workspaceSymbols.extensions]);
  const toolchain: Readonly<SavedSnapshotExternalToolchain> = Object.freeze({
    nodeExecutable: input.approvedToolchain.nodeExecutable,
    languageServerPackageRoot: input.approvedToolchain.languageServerPackageRoot,
    typeScriptPackageRoot: input.approvedToolchain.typeScriptPackageRoot,
    allowPathNodeDiscovery: false,
    allowWorkspaceLocalToolchain: false,
  });
  const acceptedSemanticCompleteness = Object.freeze(
    input.languageId === "typescript"
      ? (["full-typescript"] as const)
      : input.javascriptCompatibility.semantics === "not-dynamic-or-mixed"
        ? (["checked-javascript"] as const)
        : (["dynamic-javascript", "mixed-javascript"] as const),
  );
  const request: Readonly<SavedSnapshotSemanticSessionStartRequest> = Object.freeze({
    languageId: input.languageId,
    workspaceRoot: input.workspaceRoot,
    workspaceId: input.workspaceId,
    workspaceGeneration: input.workspaceGeneration,
    provider: input.capabilities.provider,
    providerVersion: input.providerVersion,
    backend: input.backend,
    runtime,
    extensions,
    toolchain,
    acceptedSemanticCompleteness,
  });
  return Object.freeze({ kind: "ready", request });
}

/** Correlates only the upstream-exposed LSP/process evidence to the qualified start request. */
export function normalizeSavedSnapshotSemanticSessionStartResult(
  input: SavedSnapshotSemanticSessionStartResultNormalizationInput,
): SavedSnapshotSemanticSessionStartResultNormalizationDecision {
  const { request, candidate } = input;
  if (
    candidate.languageId !== request.languageId ||
    comparablePath(candidate.workspaceRoot) !== comparablePath(request.workspaceRoot) ||
    candidate.workspaceId !== request.workspaceId ||
    candidate.workspaceGeneration !== request.workspaceGeneration
  ) {
    return startResultRefused("semantic-session-start-authority-mismatch");
  }
  if (
    candidate.provider !== request.provider ||
    candidate.providerVersion !== request.providerVersion
  ) {
    return startResultRefused("semantic-session-start-provider-mismatch");
  }
  if (candidate.backend !== request.backend || candidate.toolchain.backend !== request.backend) {
    return startResultRefused("semantic-session-start-backend-mismatch");
  }
  if (
    !runtimeEquals(candidate.toolchain.runtime, request.runtime) ||
    !stringSetEquals(candidate.toolchain.extensions, request.extensions) ||
    candidate.toolchain.nodeExecutable !== request.toolchain.nodeExecutable ||
    candidate.toolchain.languageServerPackageRoot !== request.toolchain.languageServerPackageRoot ||
    candidate.toolchain.typeScriptPackageRoot !== request.toolchain.typeScriptPackageRoot
  ) {
    return startResultRefused("semantic-session-start-toolchain-mismatch");
  }
  if (!OPAQUE_SEMANTIC_SESSION_ID.test(candidate.sessionId)) {
    return startResultRefused("semantic-session-identity-invalid");
  }
  if (!SHA256_IDENTITY.test(candidate.providerProjectSnapshotIdentity)) {
    return startResultRefused("provider-project-snapshot-identity-invalid");
  }
  if (!request.acceptedSemanticCompleteness.includes(candidate.semanticCompleteness)) {
    return startResultRefused("semantic-session-completeness-mismatch");
  }
  if (!validStartProcessProvenance(candidate.processProvenance)) {
    return startResultRefused("semantic-session-process-provenance-invalid");
  }
  if (hasOwn(candidate, "compilerAttestation") || hasOwn(candidate, "compilerSha256")) {
    return startResultRefused("compiler-attestation-unavailable");
  }

  const toolchainExtensions: string[] = [...request.extensions];
  Object.freeze(toolchainExtensions);
  const toolchain: Readonly<TypeScriptJavaScriptSemanticToolchain> = Object.freeze({
    backend: request.backend,
    runtime: freezeRuntime(request.runtime),
    extensions: toolchainExtensions,
    nodeExecutable: request.toolchain.nodeExecutable,
    languageServerPackageRoot: request.toolchain.languageServerPackageRoot,
    typeScriptPackageRoot: request.toolchain.typeScriptPackageRoot,
  });
  const processProvenance: Readonly<SavedSnapshotSemanticSessionProcessProvenance> = Object.freeze({
    serverName: candidate.processProvenance.serverName,
    serverVersion: candidate.processProvenance.serverVersion,
    capabilitiesSha256: candidate.processProvenance.capabilitiesSha256,
    executableSha256: candidate.processProvenance.executableSha256,
    argumentsSha256: candidate.processProvenance.argumentsSha256,
    processId: candidate.processProvenance.processId,
  });
  const result: Readonly<SavedSnapshotSemanticSessionStartResult> = Object.freeze({
    languageId: request.languageId,
    workspaceRoot: request.workspaceRoot,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: candidate.sessionId,
    providerProjectSnapshotIdentity: candidate.providerProjectSnapshotIdentity,
    semanticLease: candidate.semanticLease,
    startSnapshotHash: candidate.startSnapshotHash,
    provider: request.provider,
    providerVersion: request.providerVersion,
    backend: request.backend,
    toolchain,
    semanticCompleteness: candidate.semanticCompleteness,
    processProvenance,
  });
  return Object.freeze({ kind: "ready", result });
}

/** Prevents stale callers from stopping a replacement session generation. */
export function decideSavedSnapshotSemanticSessionStopRequest(
  input: SavedSnapshotSemanticSessionStopPolicyInput,
): SavedSnapshotSemanticSessionStopDecision {
  const { session } = input;
  if (!OPAQUE_SEMANTIC_SESSION_ID.test(session.sessionId)) {
    return Object.freeze({ kind: "refused", reason: "semantic-session-identity-invalid" });
  }
  if (
    !validIdentity(input.currentWorkspaceId) ||
    !positiveInteger(input.currentWorkspaceGeneration) ||
    session.workspaceId !== input.currentWorkspaceId ||
    session.workspaceGeneration !== input.currentWorkspaceGeneration
  ) {
    return Object.freeze({ kind: "refused", reason: "semantic-session-stop-authority-mismatch" });
  }
  const request: Readonly<SavedSnapshotSemanticSessionStopRequest> = Object.freeze({
    languageId: session.languageId,
    workspaceId: session.workspaceId,
    workspaceGeneration: session.workspaceGeneration,
    sessionId: session.sessionId,
  });
  return Object.freeze({ kind: "ready", request });
}

export function normalizeSavedSnapshotSemanticSessionStopResult(
  input: SavedSnapshotSemanticSessionStopResultNormalizationInput,
): SavedSnapshotSemanticSessionStopResultNormalizationDecision {
  const { request, candidate } = input;
  if (
    candidate.languageId !== request.languageId ||
    candidate.workspaceId !== request.workspaceId ||
    candidate.workspaceGeneration !== request.workspaceGeneration ||
    candidate.sessionId !== request.sessionId
  ) {
    return Object.freeze({ kind: "refused", reason: "semantic-session-stop-result-mismatch" });
  }
  if (
    typeof candidate.stopped !== "boolean" ||
    !OPAQUE_SEMANTIC_SESSION_ID.test(candidate.sessionId)
  ) {
    return Object.freeze({ kind: "refused", reason: "semantic-session-stop-result-invalid" });
  }
  const result: Readonly<SavedSnapshotSemanticSessionStopResult> = Object.freeze({
    languageId: request.languageId,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    stopped: candidate.stopped,
  });
  return Object.freeze({ kind: "ready", result });
}

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
  if (!OPAQUE_SEMANTIC_LEASE.test(session.semanticLease)) {
    return searchRefused("semantic-session-lease-invalid");
  }
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
    semanticLease: session.semanticLease,
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
    semanticLease: request.semanticLease,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
  });
  return Object.freeze({ kind: "ready", request: definitionRequest });
}

export function normalizeSavedSnapshotSymbolSearchResult(
  input: SavedSnapshotSymbolSearchResultNormalizationInput,
): SavedSnapshotSymbolSearchResultNormalizationDecision {
  const { request, candidate } = input;
  if (
    candidate.languageId !== request.languageId ||
    candidate.query !== request.query ||
    candidate.workspaceId !== request.workspaceId ||
    candidate.workspaceGeneration !== request.workspaceGeneration
  ) {
    return searchResultRefused("search-result-authority-mismatch");
  }
  if (candidate.sessionId !== request.sessionId) {
    return searchResultRefused("search-result-session-mismatch");
  }
  if (candidate.snapshotIdentity !== request.snapshotIdentity) {
    return searchResultRefused("search-result-snapshot-mismatch");
  }
  if (
    candidate.providerVersion !== request.providerVersion ||
    candidate.backend !== request.backend
  ) {
    return searchResultRefused("search-result-provider-mismatch");
  }
  if (
    candidate.completeness.resultCompleteness !== "unknown" ||
    candidate.completeness.truncation !== "unknown"
  ) {
    return searchResultRefused("search-result-completeness-invalid");
  }
  if (!semanticCompletenessMatches(candidate.languageId, candidate.completeness)) {
    return searchResultRefused("semantic-completeness-mismatch");
  }
  if (candidate.completeness.experimentalDisclosure !== "shown") {
    return searchResultRefused("experimental-disclosure-required");
  }
  if (candidate.symbols.some(({ id }) => !OPAQUE_SYMBOL_ID.test(id))) {
    return searchResultRefused("symbol-identity-invalid");
  }
  if (candidate.symbols.some(({ name, kind }) => !validMetadata(name) || !validMetadata(kind))) {
    return searchResultRefused("symbol-metadata-invalid");
  }

  const completeness: Readonly<SavedSnapshotSymbolSearchCompleteness> = Object.freeze({
    resultCompleteness: "unknown",
    truncation: "unknown",
    semanticCompleteness: candidate.completeness.semanticCompleteness,
    experimentalDisclosure: "shown",
  });
  const symbols = Object.freeze(
    candidate.symbols.map((symbol) =>
      Object.freeze({ id: symbol.id, name: symbol.name, kind: symbol.kind }),
    ),
  );
  const result: Readonly<SavedSnapshotSymbolSearchResult> = Object.freeze({
    languageId: request.languageId,
    query: request.query,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
    completeness,
    symbols,
  });
  return Object.freeze({ kind: "ready", result });
}

export function normalizeSavedSnapshotDefinitionResult(
  input: SavedSnapshotDefinitionResultNormalizationInput,
): SavedSnapshotDefinitionResultNormalizationDecision {
  const { request, currentSearchResult, selectedSymbol, candidate } = input;
  if (
    candidate.languageId !== request.languageId ||
    candidate.workspaceId !== request.workspaceId ||
    candidate.workspaceGeneration !== request.workspaceGeneration ||
    candidate.sessionId !== request.sessionId ||
    candidate.snapshotIdentity !== request.snapshotIdentity ||
    candidate.providerVersion !== request.providerVersion ||
    candidate.backend !== request.backend
  ) {
    return definitionResultRefused("definition-result-authority-mismatch");
  }
  if (
    currentSearchResult.languageId !== request.languageId ||
    currentSearchResult.workspaceId !== request.workspaceId ||
    currentSearchResult.workspaceGeneration !== request.workspaceGeneration ||
    currentSearchResult.sessionId !== request.sessionId ||
    currentSearchResult.snapshotIdentity !== request.snapshotIdentity ||
    currentSearchResult.providerVersion !== request.providerVersion ||
    currentSearchResult.backend !== request.backend ||
    !currentSearchResult.symbols.some(
      (symbol) =>
        symbol.id === selectedSymbol.id &&
        symbol.name === selectedSymbol.name &&
        symbol.kind === selectedSymbol.kind,
    )
  ) {
    return definitionResultRefused("stale-search-selection");
  }
  if (
    !OPAQUE_SYMBOL_ID.test(selectedSymbol.id) ||
    request.symbolId !== selectedSymbol.id ||
    candidate.selectedSymbol.id !== selectedSymbol.id
  ) {
    return definitionResultRefused("opaque-symbol-id-mismatch");
  }
  if (
    candidate.selectedSymbol.name !== selectedSymbol.name ||
    candidate.selectedSymbol.kind !== selectedSymbol.kind
  ) {
    return definitionResultRefused("selected-symbol-metadata-mismatch");
  }
  if (!validWorkspaceRelativePath(candidate.file)) {
    return definitionResultRefused("definition-file-invalid");
  }
  if (
    !validProviderPoint(candidate.point) ||
    !Number.isSafeInteger(candidate.point.line + 1) ||
    !Number.isSafeInteger(candidate.point.character + 1)
  ) {
    return definitionResultRefused("invalid-provider-point");
  }
  if (hasOwn(candidate, "end") || hasOwn(candidate, "range")) {
    return definitionResultRefused("fabricated-definition-range");
  }
  if (hasOwn(candidate, "attestation")) {
    return definitionResultRefused("fabricated-definition-attestation");
  }

  const normalizedSymbol: Readonly<SavedSnapshotWorkspaceSymbol> = Object.freeze({
    id: selectedSymbol.id,
    name: selectedSymbol.name,
    kind: selectedSymbol.kind,
  });
  const point: Readonly<ProviderPoint> = Object.freeze({
    line: candidate.point.line,
    character: candidate.point.character,
  });
  const result: Readonly<SavedSnapshotDefinitionResult> = Object.freeze({
    languageId: request.languageId,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
    selectedSymbol: normalizedSymbol,
    file: candidate.file,
    point,
  });
  return Object.freeze({ kind: "ready", result });
}

export function normalizeProviderPoint(
  providerPoint: ProviderPoint,
): ProviderPointNormalizationDecision {
  if (
    !validProviderPoint(providerPoint) ||
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

function startRefused<T extends SavedSnapshotSemanticSessionStartRefusalReason>(
  reason: T,
): { readonly kind: "refused"; readonly reason: T } {
  return Object.freeze({ kind: "refused", reason });
}

function startResultRefused(
  reason: SavedSnapshotSemanticSessionStartResultRefusalReason,
): SavedSnapshotSemanticSessionStartResultNormalizationDecision {
  return Object.freeze({ kind: "refused", reason });
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

function searchResultRefused(
  reason: SavedSnapshotSymbolSearchResultRefusalReason,
): SavedSnapshotSymbolSearchResultNormalizationDecision {
  return Object.freeze({ kind: "refused", reason });
}

function definitionResultRefused(
  reason: SavedSnapshotDefinitionResultRefusalReason,
): SavedSnapshotDefinitionResultNormalizationDecision {
  return Object.freeze({ kind: "refused", reason });
}

function semanticCompletenessMatches(
  languageId: TypeScriptJavaScriptLanguageId,
  completeness: SavedSnapshotSymbolSearchCompleteness,
): boolean {
  return languageId === "typescript"
    ? completeness.semanticCompleteness === "full-typescript"
    : completeness.semanticCompleteness === "checked-javascript" ||
        completeness.semanticCompleteness === "dynamic-javascript" ||
        completeness.semanticCompleteness === "mixed-javascript";
}

function validProviderPoint(point: ProviderPoint): boolean {
  return (
    Number.isSafeInteger(point.line) &&
    point.line >= 0 &&
    Number.isSafeInteger(point.character) &&
    point.character >= 0
  );
}

function validStartProcessProvenance(
  provenance: SavedSnapshotSemanticSessionStartResultCandidate["processProvenance"],
): boolean {
  return (
    (provenance.serverName === null || validMetadata(provenance.serverName)) &&
    (provenance.serverVersion === null || validMetadata(provenance.serverVersion)) &&
    SHA256_DIGEST.test(provenance.capabilitiesSha256) &&
    SHA256_DIGEST.test(provenance.executableSha256) &&
    SHA256_DIGEST.test(provenance.argumentsSha256) &&
    positiveInteger(provenance.processId)
  );
}

function validWorkspaceRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    value.trim() !== value ||
    CONTROL_CHARACTERS.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function freezeRuntime(
  runtime: RefactorKitLanguageAdapterRuntime,
): Readonly<RefactorKitLanguageAdapterRuntime> {
  return Object.freeze({
    executionMode: runtime.executionMode,
    supportsTimeout: runtime.supportsTimeout,
    supportsCancellation: runtime.supportsCancellation,
    usesWorkspaceOverlay: runtime.usesWorkspaceOverlay,
    recordsProcessProvenance: runtime.recordsProcessProvenance,
    limits: Object.freeze({
      requestTimeoutMillis: runtime.limits.requestTimeoutMillis,
      maxInputBytes: runtime.limits.maxInputBytes,
      maxOutputBytes: runtime.limits.maxOutputBytes,
      maxProcesses: runtime.limits.maxProcesses,
    }),
  });
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
