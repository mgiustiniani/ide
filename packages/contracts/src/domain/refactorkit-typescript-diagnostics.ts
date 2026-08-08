import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
  RefactorKitLanguageCapabilityEvidence,
} from "../refactorkit";

export const TYPESCRIPT_DIAGNOSTICS_SCHEMA_VERSION = 2 as const;
export const TYPESCRIPT_DIAGNOSTICS_OPERATION = "diagnostics.v2" as const;
export const TYPESCRIPT_DIAGNOSTICS_COMPILER_BACKEND = "typescript-compiler-exact-v1" as const;
export const TYPESCRIPT_DIAGNOSTICS_PROVIDER_VERSION = "0.7.0-SNAPSHOT" as const;

/** The semantic toolchain evidence that was qualified for one live language session. */
export interface TypeScriptDiagnosticsToolchainEvidence {
  evidence: RefactorKitLanguageCapabilityEvidence;
  backend: string;
  runtime: RefactorKitLanguageAdapterRuntime;
  extensions: string[];
}

export type TypeScriptDiagnosticsSemanticSession =
  | {
      state: "unavailable";
      reason: string;
    }
  | {
      state: "ready";
      qualification: "qualified" | "unqualified";
      languageId: string;
      workspaceId: string;
      workspaceGeneration: number;
      sessionId: string;
      semanticLease: string;
      snapshotHash: string | null;
      providerVersion: string;
      toolchain: TypeScriptDiagnosticsToolchainEvidence;
    };

export interface TypeScriptDiagnosticsOverlayDocumentRequest {
  readonly path: string;
  readonly version: number;
  readonly content: string;
}

/** Immutable editor content submitted instead of allowing the provider to discover mutable files. */
export interface TypeScriptDiagnosticsSourceAuthorityRequest {
  readonly kind: "immutable-editor-overlay";
  readonly documents: readonly Readonly<TypeScriptDiagnosticsOverlayDocumentRequest>[];
}

/** All current authority and discovery evidence needed before crossing an invocation port. */
export interface TypeScriptDiagnosticsPolicyInput {
  languageId: string;
  sourceExtension: string;
  requestId: string;
  workspaceId: string;
  workspaceGeneration: number;
  authorizedWorkspaceId: string;
  authorizedWorkspaceGeneration: number;
  snapshotHash: string;
  sourceAuthority: TypeScriptDiagnosticsSourceAuthorityRequest;
  capabilities: RefactorKitCapabilities;
  semanticSession: TypeScriptDiagnosticsSemanticSession;
}

/** Strict schema-v2 request passed to the diagnostics invocation boundary after readiness succeeds. */
export interface TypeScriptDiagnosticsRequest {
  readonly schemaVersion: typeof TYPESCRIPT_DIAGNOSTICS_SCHEMA_VERSION;
  readonly operation: typeof TYPESCRIPT_DIAGNOSTICS_OPERATION;
  readonly requestId: string;
  readonly languageId: "typescript";
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly expectedSnapshotHash: string;
  readonly semanticLease: string;
  readonly sourceAuthority: Readonly<TypeScriptDiagnosticsSourceAuthorityRequest>;
}

export type TypeScriptDiagnosticsRefusalReason =
  | "invalid-language-id"
  | "invalid-request-id"
  | "invalid-workspace-id"
  | "workspace-generation-nonpositive"
  | "workspace-generation-stale"
  | "workspace-unauthorized"
  | "snapshot-identity-absent"
  | "source-authority-invalid"
  | "source-authority-bounds-exceeded"
  | "capability-absent"
  | "capability-ambiguous"
  | "capability-proposal-inappropriate"
  | "capability-mutation-authority-inappropriate"
  | "capability-stability-inappropriate"
  | "capability-evidence-unqualified"
  | "capability-backend-unauthorized"
  | "capability-runtime-unauthorized"
  | "capability-extensions-unauthorized"
  | "semantic-toolchain-unavailable"
  | "semantic-toolchain-unqualified"
  | "invalid-session-id"
  | "semantic-session-lease-invalid"
  | "semantic-session-authority-mismatch"
  | "semantic-session-hash-unbound"
  | "semantic-session-snapshot-mismatch"
  | "provider-version-unavailable"
  | "provider-version-mismatch"
  | "semantic-toolchain-mismatch";

export type TypeScriptDiagnosticsDecision =
  | { readonly kind: "ready"; readonly request: Readonly<TypeScriptDiagnosticsRequest> }
  | { readonly kind: "refused"; readonly reason: TypeScriptDiagnosticsRefusalReason };

export interface TypeScriptDiagnosticsResponseRuntimeLimits {
  readonly requestTimeoutMillis: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxProcesses: number;
  readonly maxStderrBytes: number;
  readonly compilerHeapMiB: number;
  readonly maxDiagnostics: number;
  readonly maxDiagnosticMessageChars: number;
  readonly maxResponseBytes: number;
}

export interface TypeScriptDiagnosticsResponseRuntime {
  readonly executionMode: "in-process" | "external-process";
  readonly supportsTimeout: boolean;
  readonly supportsCancellation: boolean;
  readonly usesWorkspaceOverlay: boolean;
  readonly recordsProcessProvenance: boolean;
  readonly limits: Readonly<TypeScriptDiagnosticsResponseRuntimeLimits>;
}

export interface TypeScriptDiagnosticsCompilerProcessIdentity {
  readonly executableSha256: string;
  readonly argumentsSha256: string;
  readonly processId: number;
}

/** Exact compiler and process identity accepted for the approved source-built snapshot. */
export interface TypeScriptDiagnosticsCompilerAttestation {
  readonly toolchainProvider: string;
  readonly nodeVersion: string;
  readonly typeScriptVersion: string;
  readonly compilerSha256: string;
  readonly toolchainEvidenceSha256: string;
  readonly process: Readonly<TypeScriptDiagnosticsCompilerProcessIdentity>;
}

export interface TypeScriptDiagnosticsPoint {
  readonly line: number;
  readonly character: number;
}

export interface TypeScriptDiagnosticsRange {
  readonly start: Readonly<TypeScriptDiagnosticsPoint>;
  readonly end: Readonly<TypeScriptDiagnosticsPoint>;
}

export interface TypeScriptCompilerDiagnostic {
  readonly severity: "error" | "warning" | "information" | "hint";
  readonly message: string;
  readonly code: string;
  readonly evidence: "compiler";
  readonly category: string;
  readonly location: {
    readonly kind: "range";
    readonly path: string;
    readonly encoding: "utf-16";
    readonly range: Readonly<TypeScriptDiagnosticsRange>;
  };
}

export interface TypeScriptDiagnosticsSourceAuthorityResponse {
  readonly kind: "immutable-editor-overlay";
  readonly baseSnapshotHash: string;
  readonly overlayHash: string;
  readonly providerSnapshotHash: string;
  readonly documents: readonly {
    readonly path: string;
    readonly version: number;
    readonly contentSha256: string;
  }[];
}

export interface TypeScriptDiagnosticsFailure {
  readonly code: string;
  readonly message: string;
}

interface TypeScriptDiagnosticsResponseAuthority {
  readonly schemaVersion: typeof TYPESCRIPT_DIAGNOSTICS_SCHEMA_VERSION;
  readonly operation: typeof TYPESCRIPT_DIAGNOSTICS_OPERATION;
  readonly requestId: string;
  readonly languageId: "typescript";
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly provider: {
    readonly name: "refactorkit";
    readonly version: typeof TYPESCRIPT_DIAGNOSTICS_PROVIDER_VERSION;
    readonly apiVersion: "0.2";
  };
  readonly backend: typeof TYPESCRIPT_DIAGNOSTICS_COMPILER_BACKEND;
  readonly semanticLease: string;
  readonly projectSnapshotHash: string;
  readonly providerSnapshotHash: string;
  readonly sourceAuthority: Readonly<TypeScriptDiagnosticsSourceAuthorityResponse>;
  readonly rangeEncoding: "utf-16";
  readonly rangeCapability: "exact-utf16-or-explicit-partial";
  readonly runtime: Readonly<TypeScriptDiagnosticsResponseRuntime>;
  readonly diagnosticsTotal: number;
  readonly diagnosticsReturned: number;
  readonly truncated: false;
  readonly responseBytes: number;
}

export interface TypeScriptDiagnosticsReadyResponse extends TypeScriptDiagnosticsResponseAuthority {
  readonly status: "ready";
  readonly compilerAttestation: Readonly<TypeScriptDiagnosticsCompilerAttestation>;
  readonly failure: null;
  readonly diagnostics: readonly Readonly<TypeScriptCompilerDiagnostic>[];
}

export interface TypeScriptDiagnosticsRefusedResponse extends TypeScriptDiagnosticsResponseAuthority {
  readonly status: "refused";
  readonly compilerAttestation: null;
  readonly failure: Readonly<TypeScriptDiagnosticsFailure>;
  readonly diagnostics: readonly [];
}

export interface TypeScriptDiagnosticsErrorResponse extends TypeScriptDiagnosticsResponseAuthority {
  readonly status: "error";
  readonly compilerAttestation: Readonly<TypeScriptDiagnosticsCompilerAttestation>;
  readonly failure: Readonly<TypeScriptDiagnosticsFailure>;
  readonly diagnostics: readonly [];
}

/** Closed status union: only ready may carry diagnostics. */
export type TypeScriptDiagnosticsResponse =
  | TypeScriptDiagnosticsReadyResponse
  | TypeScriptDiagnosticsRefusedResponse
  | TypeScriptDiagnosticsErrorResponse;

export interface TypeScriptDiagnosticsResponseNormalizationInput {
  readonly request: Readonly<TypeScriptDiagnosticsRequest>;
  readonly candidate: unknown;
  readonly advertisedRuntime: Readonly<TypeScriptDiagnosticsResponseRuntime>;
  readonly acceptedCompilerAttestation: Readonly<TypeScriptDiagnosticsCompilerAttestation>;
}

export type TypeScriptDiagnosticsResponseRejectionReason =
  | "response-schema-invalid"
  | "response-correlation-mismatch"
  | "response-provider-mismatch"
  | "response-backend-mismatch"
  | "response-runtime-mismatch"
  | "response-attestation-mismatch"
  | "response-source-authority-mismatch"
  | "response-diagnostic-invalid"
  | "response-incomplete"
  | "response-bounds-exceeded"
  | "response-status-invalid";

export type TypeScriptDiagnosticsResponseNormalizationDecision =
  | { readonly kind: "accepted"; readonly response: Readonly<TypeScriptDiagnosticsResponse> }
  | { readonly kind: "rejected"; readonly reason: TypeScriptDiagnosticsResponseRejectionReason };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const SOURCE_EXTENSION = /^[a-z0-9]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMANTIC_LEASE = /^semantic-[a-f0-9-]{36}$/u;
const TYPESCRIPT_CODE = /^TS[0-9]{1,7}$/u;
const RESPONSE_FIELDS = [
  "schemaVersion",
  "operation",
  "requestId",
  "languageId",
  "status",
  "workspaceId",
  "workspaceGeneration",
  "sessionId",
  "provider",
  "backend",
  "semanticLease",
  "projectSnapshotHash",
  "providerSnapshotHash",
  "sourceAuthority",
  "rangeEncoding",
  "rangeCapability",
  "runtime",
  "compilerAttestation",
  "failure",
  "diagnostics",
  "diagnosticsTotal",
  "diagnosticsReturned",
  "truncated",
  "responseBytes",
] as const;

/**
 * Deterministically decides whether exact advertised operation and live-session evidence permit
 * TypeScript diagnostics. This function never invokes a tool, discovers a toolchain, or falls back.
 */
export function decideTypeScriptDiagnosticsRequest(
  input: TypeScriptDiagnosticsPolicyInput,
): TypeScriptDiagnosticsDecision {
  if (input.languageId !== "typescript") return refused("invalid-language-id");
  if (!validOpaqueRequestId(input.requestId)) return refused("invalid-request-id");
  if (!validIdentity(input.workspaceId) || !validIdentity(input.authorizedWorkspaceId)) {
    return refused("invalid-workspace-id");
  }
  if (!positiveGeneration(input.workspaceGeneration)) {
    return refused("workspace-generation-nonpositive");
  }
  if (input.workspaceId !== input.authorizedWorkspaceId) return refused("workspace-unauthorized");
  if (
    !positiveGeneration(input.authorizedWorkspaceGeneration) ||
    input.workspaceGeneration !== input.authorizedWorkspaceGeneration
  ) {
    return refused("workspace-generation-stale");
  }
  if (!validIdentity(input.snapshotHash)) return refused("snapshot-identity-absent");
  if (!SOURCE_EXTENSION.test(input.sourceExtension)) {
    return refused("capability-extensions-unauthorized");
  }

  const languageKernel = input.capabilities.languageKernel;
  if (!languageKernel?.available) return refused("capability-absent");

  const candidates = languageKernel.schema.adapters.flatMap((adapter) =>
    adapter.languageId === input.languageId
      ? adapter.capabilities
          .filter((capability) => capability.operation === "diagnostics")
          .map((capability) => ({ adapter, capability }))
      : [],
  );
  if (candidates.length === 0) return refused("capability-absent");
  if (candidates.length !== 1) return refused("capability-ambiguous");

  const selected = candidates[0]!;
  const capability = selected.capability;
  if (capability.mutationAuthority === "proposal-only") {
    return refused("capability-proposal-inappropriate");
  }
  if (capability.mutationAuthority !== "none") {
    return refused("capability-mutation-authority-inappropriate");
  }
  if (capability.stability !== "stable" && capability.stability !== "experimental") {
    return refused("capability-stability-inappropriate");
  }
  if (capability.evidence !== "compiler") {
    return refused("capability-evidence-unqualified");
  }
  if (capability.backend !== TYPESCRIPT_DIAGNOSTICS_COMPILER_BACKEND) {
    return refused("capability-backend-unauthorized");
  }
  if (!qualifiedRuntime(capability.runtime)) return refused("capability-runtime-unauthorized");
  if (
    !selected.adapter.extensions.includes(input.sourceExtension) ||
    !capability.extensions.includes(input.sourceExtension)
  ) {
    return refused("capability-extensions-unauthorized");
  }

  const authorityReason = validateSourceAuthority(input.sourceAuthority, capability.runtime);
  if (authorityReason) return refused(authorityReason);

  const session = input.semanticSession;
  if (session.state === "unavailable") return refused("semantic-toolchain-unavailable");
  if (session.qualification !== "qualified") return refused("semantic-toolchain-unqualified");
  if (!validIdentity(session.sessionId)) return refused("invalid-session-id");
  if (!SEMANTIC_LEASE.test(session.semanticLease)) {
    return refused("semantic-session-lease-invalid");
  }
  if (
    session.languageId !== input.languageId ||
    session.workspaceId !== input.workspaceId ||
    session.workspaceGeneration !== input.workspaceGeneration
  ) {
    return refused("semantic-session-authority-mismatch");
  }
  if (!session.snapshotHash || !validIdentity(session.snapshotHash)) {
    return refused("semantic-session-hash-unbound");
  }
  if (session.snapshotHash !== input.snapshotHash) {
    return refused("semantic-session-snapshot-mismatch");
  }

  const providerVersion = input.capabilities.providerVersion;
  if (!providerVersion || !validMetadata(providerVersion)) {
    return refused("provider-version-unavailable");
  }
  if (providerVersion !== TYPESCRIPT_DIAGNOSTICS_PROVIDER_VERSION) {
    return refused("provider-version-mismatch");
  }
  if (!validMetadata(session.providerVersion) || session.providerVersion !== providerVersion) {
    return refused("provider-version-mismatch");
  }
  if (
    session.toolchain.evidence !== capability.evidence ||
    session.toolchain.backend !== capability.backend ||
    !runtimeEquals(session.toolchain.runtime, capability.runtime) ||
    !stringArrayEquals(session.toolchain.extensions, capability.extensions)
  ) {
    return refused("semantic-toolchain-mismatch");
  }

  const request: Readonly<TypeScriptDiagnosticsRequest> = Object.freeze({
    schemaVersion: TYPESCRIPT_DIAGNOSTICS_SCHEMA_VERSION,
    operation: TYPESCRIPT_DIAGNOSTICS_OPERATION,
    requestId: input.requestId,
    languageId: "typescript",
    workspaceId: input.workspaceId,
    workspaceGeneration: input.workspaceGeneration,
    sessionId: session.sessionId,
    expectedSnapshotHash: input.snapshotHash,
    semanticLease: session.semanticLease,
    sourceAuthority: freezeSourceAuthorityRequest(input.sourceAuthority),
  });
  return Object.freeze({ kind: "ready", request });
}

/**
 * Validates an untrusted diagnostics.v2 payload as one closed, complete and correlated status.
 * Any legacy stdout/fallback shape, partial payload, or unverifiable value is rejected.
 */
export function normalizeTypeScriptDiagnosticsResponse(
  input: TypeScriptDiagnosticsResponseNormalizationInput,
): TypeScriptDiagnosticsResponseNormalizationDecision {
  const candidate = input.candidate;
  if (!exactRecord(candidate, RESPONSE_FIELDS) || !validResponseScalarTypes(candidate)) {
    return rejected("response-schema-invalid");
  }

  const request = input.request;
  if (
    candidate.schemaVersion !== request.schemaVersion ||
    candidate.operation !== request.operation ||
    candidate.requestId !== request.requestId ||
    candidate.languageId !== request.languageId ||
    candidate.workspaceId !== request.workspaceId ||
    candidate.workspaceGeneration !== request.workspaceGeneration ||
    candidate.sessionId !== request.sessionId ||
    candidate.semanticLease !== request.semanticLease ||
    candidate.projectSnapshotHash !== request.expectedSnapshotHash
  ) {
    return rejected("response-correlation-mismatch");
  }

  if (!validProvider(candidate.provider)) return rejected("response-schema-invalid");
  if (
    candidate.provider.name !== "refactorkit" ||
    candidate.provider.version !== TYPESCRIPT_DIAGNOSTICS_PROVIDER_VERSION ||
    candidate.provider.apiVersion !== "0.2"
  ) {
    return rejected("response-provider-mismatch");
  }
  if (candidate.backend !== TYPESCRIPT_DIAGNOSTICS_COMPILER_BACKEND) {
    return rejected("response-backend-mismatch");
  }

  if (!validResponseRuntime(candidate.runtime)) return rejected("response-schema-invalid");
  if (!responseRuntimeEquals(candidate.runtime, input.advertisedRuntime)) {
    return rejected("response-runtime-mismatch");
  }
  if (!qualifiedAcceptedRuntime(input.advertisedRuntime)) {
    return rejected("response-runtime-mismatch");
  }

  if (!validSourceAuthorityResponse(candidate.sourceAuthority)) {
    return rejected("response-schema-invalid");
  }
  if (
    !sourceAuthorityCorrelates(
      request.sourceAuthority,
      request.expectedSnapshotHash,
      candidate.providerSnapshotHash,
      candidate.sourceAuthority,
    )
  ) {
    return rejected("response-source-authority-mismatch");
  }
  if (
    candidate.rangeEncoding !== "utf-16" ||
    candidate.rangeCapability !== "exact-utf16-or-explicit-partial"
  ) {
    return rejected("response-schema-invalid");
  }

  if (!Array.isArray(candidate.diagnostics)) return rejected("response-schema-invalid");
  if (
    candidate.truncated !== false ||
    candidate.diagnosticsTotal !== candidate.diagnostics.length ||
    candidate.diagnosticsReturned !== candidate.diagnostics.length
  ) {
    return rejected("response-incomplete");
  }
  const responseBytes = candidate.responseBytes as number;
  if (
    candidate.diagnostics.length > input.advertisedRuntime.limits.maxDiagnostics ||
    responseBytes > input.advertisedRuntime.limits.maxResponseBytes ||
    responseBytes > input.advertisedRuntime.limits.maxOutputBytes
  ) {
    return rejected("response-bounds-exceeded");
  }

  let encodedBytes: number;
  try {
    encodedBytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
  } catch {
    return rejected("response-schema-invalid");
  }
  if (responseBytes !== encodedBytes) {
    return rejected("response-bounds-exceeded");
  }

  if (candidate.status === "ready") {
    if (candidate.failure !== null || !validCompilerAttestation(candidate.compilerAttestation)) {
      return rejected("response-status-invalid");
    }
    if (!attestationEquals(candidate.compilerAttestation, input.acceptedCompilerAttestation)) {
      return rejected("response-attestation-mismatch");
    }
    if (
      candidate.diagnostics.some(
        (diagnostic) =>
          !validCompilerDiagnostic(
            diagnostic,
            request.sourceAuthority,
            input.advertisedRuntime.limits.maxDiagnosticMessageChars,
          ),
      )
    ) {
      return rejected("response-diagnostic-invalid");
    }
    return acceptedReadyResponse(candidate);
  }

  if (candidate.status === "refused") {
    if (
      candidate.compilerAttestation !== null ||
      !validFailure(candidate.failure) ||
      candidate.diagnostics.length !== 0
    ) {
      return rejected("response-status-invalid");
    }
    return acceptedRefusedResponse(candidate);
  }

  if (candidate.status === "error") {
    if (
      !validFailure(candidate.failure) ||
      !validCompilerAttestation(candidate.compilerAttestation) ||
      candidate.diagnostics.length !== 0
    ) {
      return rejected("response-status-invalid");
    }
    if (!attestationEquals(candidate.compilerAttestation, input.acceptedCompilerAttestation)) {
      return rejected("response-attestation-mismatch");
    }
    return acceptedErrorResponse(candidate);
  }

  return rejected("response-schema-invalid");
}

function refused(reason: TypeScriptDiagnosticsRefusalReason): TypeScriptDiagnosticsDecision {
  return Object.freeze({ kind: "refused", reason });
}

function rejected(
  reason: TypeScriptDiagnosticsResponseRejectionReason,
): TypeScriptDiagnosticsResponseNormalizationDecision {
  return Object.freeze({ kind: "rejected", reason });
}

function acceptedReadyResponse(
  candidate: Record<string, unknown>,
): TypeScriptDiagnosticsResponseNormalizationDecision {
  const common = freezeResponseAuthority(candidate);
  const response: Readonly<TypeScriptDiagnosticsReadyResponse> = Object.freeze({
    ...common,
    status: "ready",
    compilerAttestation: freezeCompilerAttestation(
      candidate.compilerAttestation as unknown as TypeScriptDiagnosticsCompilerAttestation,
    ),
    failure: null,
    diagnostics: freezeDiagnostics(candidate.diagnostics as TypeScriptCompilerDiagnostic[]),
  });
  return Object.freeze({ kind: "accepted", response });
}

function acceptedRefusedResponse(
  candidate: Record<string, unknown>,
): TypeScriptDiagnosticsResponseNormalizationDecision {
  const response: Readonly<TypeScriptDiagnosticsRefusedResponse> = Object.freeze({
    ...freezeResponseAuthority(candidate),
    status: "refused",
    compilerAttestation: null,
    failure: freezeFailure(candidate.failure as TypeScriptDiagnosticsFailure),
    diagnostics: Object.freeze([] as const),
  });
  return Object.freeze({ kind: "accepted", response });
}

function acceptedErrorResponse(
  candidate: Record<string, unknown>,
): TypeScriptDiagnosticsResponseNormalizationDecision {
  const response: Readonly<TypeScriptDiagnosticsErrorResponse> = Object.freeze({
    ...freezeResponseAuthority(candidate),
    status: "error",
    compilerAttestation: freezeCompilerAttestation(
      candidate.compilerAttestation as unknown as TypeScriptDiagnosticsCompilerAttestation,
    ),
    failure: freezeFailure(candidate.failure as TypeScriptDiagnosticsFailure),
    diagnostics: Object.freeze([] as const),
  });
  return Object.freeze({ kind: "accepted", response });
}

function freezeResponseAuthority(
  candidate: Record<string, unknown>,
): TypeScriptDiagnosticsResponseAuthority {
  const provider = candidate.provider as {
    name: "refactorkit";
    version: "0.7.0-SNAPSHOT";
    apiVersion: "0.2";
  };
  return {
    schemaVersion: 2,
    operation: "diagnostics.v2",
    requestId: candidate.requestId as string,
    languageId: "typescript",
    workspaceId: candidate.workspaceId as string,
    workspaceGeneration: candidate.workspaceGeneration as number,
    sessionId: candidate.sessionId as string,
    provider: Object.freeze({ ...provider }),
    backend: "typescript-compiler-exact-v1",
    semanticLease: candidate.semanticLease as string,
    projectSnapshotHash: candidate.projectSnapshotHash as string,
    providerSnapshotHash: candidate.providerSnapshotHash as string,
    sourceAuthority: freezeSourceAuthorityResponse(
      candidate.sourceAuthority as unknown as TypeScriptDiagnosticsSourceAuthorityResponse,
    ),
    rangeEncoding: "utf-16",
    rangeCapability: "exact-utf16-or-explicit-partial",
    runtime: freezeResponseRuntime(
      candidate.runtime as unknown as TypeScriptDiagnosticsResponseRuntime,
    ),
    diagnosticsTotal: candidate.diagnosticsTotal as number,
    diagnosticsReturned: candidate.diagnosticsReturned as number,
    truncated: false,
    responseBytes: candidate.responseBytes as number,
  };
}

function validResponseScalarTypes(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate.schemaVersion === "number" &&
    typeof candidate.operation === "string" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.languageId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.workspaceGeneration === "number" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.backend === "string" &&
    typeof candidate.semanticLease === "string" &&
    typeof candidate.projectSnapshotHash === "string" &&
    typeof candidate.providerSnapshotHash === "string" &&
    typeof candidate.rangeEncoding === "string" &&
    typeof candidate.rangeCapability === "string" &&
    typeof candidate.diagnosticsTotal === "number" &&
    typeof candidate.diagnosticsReturned === "number" &&
    typeof candidate.truncated === "boolean" &&
    typeof candidate.responseBytes === "number" &&
    safeNonnegativeInteger(candidate.diagnosticsTotal) &&
    safeNonnegativeInteger(candidate.diagnosticsReturned) &&
    safeNonnegativeInteger(candidate.responseBytes)
  );
}

function validateSourceAuthority(
  authority: TypeScriptDiagnosticsSourceAuthorityRequest,
  runtime: RefactorKitLanguageAdapterRuntime,
): "source-authority-invalid" | "source-authority-bounds-exceeded" | undefined {
  if (
    !exactRecord(authority, ["kind", "documents"]) ||
    authority.kind !== "immutable-editor-overlay" ||
    !Array.isArray(authority.documents) ||
    authority.documents.length === 0 ||
    authority.documents.length > 10_000
  ) {
    return "source-authority-invalid";
  }
  const paths = new Set<string>();
  let contentBytes = 0;
  for (const document of authority.documents) {
    if (
      !exactRecord(document, ["path", "version", "content"]) ||
      typeof document.path !== "string" ||
      typeof document.version !== "number" ||
      typeof document.content !== "string" ||
      !validWorkspaceRelativePath(document.path) ||
      !safeNonnegativeInteger(document.version) ||
      paths.has(document.path)
    ) {
      return "source-authority-invalid";
    }
    paths.add(document.path);
    contentBytes += new TextEncoder().encode(document.content).byteLength;
    if (contentBytes > (runtime.limits.maxInputBytes ?? 0)) {
      return "source-authority-bounds-exceeded";
    }
  }
  return undefined;
}

function freezeSourceAuthorityRequest(
  authority: TypeScriptDiagnosticsSourceAuthorityRequest,
): Readonly<TypeScriptDiagnosticsSourceAuthorityRequest> {
  const documents = Object.freeze(
    authority.documents.map((document) =>
      Object.freeze({ path: document.path, version: document.version, content: document.content }),
    ),
  );
  return Object.freeze({ kind: "immutable-editor-overlay", documents });
}

function validProvider(value: unknown): value is {
  name: string;
  version: string;
  apiVersion: string;
} {
  return (
    exactRecord(value, ["name", "version", "apiVersion"]) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    typeof value.apiVersion === "string"
  );
}

function validResponseRuntime(value: unknown): value is TypeScriptDiagnosticsResponseRuntime {
  if (
    !exactRecord(value, [
      "executionMode",
      "supportsTimeout",
      "supportsCancellation",
      "usesWorkspaceOverlay",
      "recordsProcessProvenance",
      "limits",
    ]) ||
    (value.executionMode !== "in-process" && value.executionMode !== "external-process") ||
    typeof value.supportsTimeout !== "boolean" ||
    typeof value.supportsCancellation !== "boolean" ||
    typeof value.usesWorkspaceOverlay !== "boolean" ||
    typeof value.recordsProcessProvenance !== "boolean" ||
    !exactRecord(value.limits, [
      "requestTimeoutMillis",
      "maxInputBytes",
      "maxOutputBytes",
      "maxProcesses",
      "maxStderrBytes",
      "compilerHeapMiB",
      "maxDiagnostics",
      "maxDiagnosticMessageChars",
      "maxResponseBytes",
    ])
  ) {
    return false;
  }
  return Object.values(value.limits).every(positiveLimit);
}

function qualifiedAcceptedRuntime(runtime: TypeScriptDiagnosticsResponseRuntime): boolean {
  return (
    validResponseRuntime(runtime) &&
    runtime.supportsTimeout &&
    runtime.supportsCancellation &&
    runtime.usesWorkspaceOverlay &&
    runtime.recordsProcessProvenance &&
    runtime.limits.maxResponseBytes <= runtime.limits.maxOutputBytes
  );
}

function responseRuntimeEquals(
  left: TypeScriptDiagnosticsResponseRuntime,
  right: TypeScriptDiagnosticsResponseRuntime,
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
    left.limits.maxProcesses === right.limits.maxProcesses &&
    left.limits.maxStderrBytes === right.limits.maxStderrBytes &&
    left.limits.compilerHeapMiB === right.limits.compilerHeapMiB &&
    left.limits.maxDiagnostics === right.limits.maxDiagnostics &&
    left.limits.maxDiagnosticMessageChars === right.limits.maxDiagnosticMessageChars &&
    left.limits.maxResponseBytes === right.limits.maxResponseBytes
  );
}

function validCompilerAttestation(
  value: unknown,
): value is TypeScriptDiagnosticsCompilerAttestation {
  return (
    exactRecord(value, [
      "toolchainProvider",
      "nodeVersion",
      "typeScriptVersion",
      "compilerSha256",
      "toolchainEvidenceSha256",
      "process",
    ]) &&
    typeof value.toolchainProvider === "string" &&
    typeof value.nodeVersion === "string" &&
    typeof value.typeScriptVersion === "string" &&
    typeof value.compilerSha256 === "string" &&
    typeof value.toolchainEvidenceSha256 === "string" &&
    validMetadata(value.toolchainProvider) &&
    validMetadata(value.nodeVersion) &&
    validMetadata(value.typeScriptVersion) &&
    SHA256.test(value.compilerSha256) &&
    SHA256.test(value.toolchainEvidenceSha256) &&
    exactRecord(value.process, ["executableSha256", "argumentsSha256", "processId"]) &&
    typeof value.process.executableSha256 === "string" &&
    typeof value.process.argumentsSha256 === "string" &&
    typeof value.process.processId === "number" &&
    SHA256.test(value.process.executableSha256) &&
    SHA256.test(value.process.argumentsSha256) &&
    positiveGeneration(value.process.processId)
  );
}

function attestationEquals(
  left: TypeScriptDiagnosticsCompilerAttestation,
  right: TypeScriptDiagnosticsCompilerAttestation,
): boolean {
  return (
    left.toolchainProvider === right.toolchainProvider &&
    left.nodeVersion === right.nodeVersion &&
    left.typeScriptVersion === right.typeScriptVersion &&
    left.compilerSha256 === right.compilerSha256 &&
    left.toolchainEvidenceSha256 === right.toolchainEvidenceSha256 &&
    left.process.executableSha256 === right.process.executableSha256 &&
    left.process.argumentsSha256 === right.process.argumentsSha256 &&
    left.process.processId === right.process.processId
  );
}

function validSourceAuthorityResponse(
  value: unknown,
): value is TypeScriptDiagnosticsSourceAuthorityResponse {
  if (
    !exactRecord(value, [
      "kind",
      "baseSnapshotHash",
      "overlayHash",
      "providerSnapshotHash",
      "documents",
    ]) ||
    value.kind !== "immutable-editor-overlay" ||
    typeof value.baseSnapshotHash !== "string" ||
    typeof value.overlayHash !== "string" ||
    typeof value.providerSnapshotHash !== "string" ||
    !validIdentity(value.baseSnapshotHash) ||
    !SHA256.test(value.overlayHash) ||
    !SHA256.test(value.providerSnapshotHash) ||
    !Array.isArray(value.documents)
  ) {
    return false;
  }
  return value.documents.every(
    (document) =>
      exactRecord(document, ["path", "version", "contentSha256"]) &&
      typeof document.path === "string" &&
      typeof document.version === "number" &&
      typeof document.contentSha256 === "string" &&
      validWorkspaceRelativePath(document.path) &&
      safeNonnegativeInteger(document.version) &&
      SHA256.test(document.contentSha256),
  );
}

function sourceAuthorityCorrelates(
  request: Readonly<TypeScriptDiagnosticsSourceAuthorityRequest>,
  expectedSnapshotHash: string,
  providerSnapshotHash: unknown,
  response: TypeScriptDiagnosticsSourceAuthorityResponse,
): boolean {
  return (
    typeof providerSnapshotHash === "string" &&
    SHA256.test(providerSnapshotHash) &&
    response.baseSnapshotHash === expectedSnapshotHash &&
    response.providerSnapshotHash === providerSnapshotHash &&
    response.documents.length === request.documents.length &&
    response.documents.every(
      (document, index) =>
        document.path === request.documents[index]?.path &&
        document.version === request.documents[index]?.version,
    )
  );
}

function validCompilerDiagnostic(
  value: unknown,
  authority: Readonly<TypeScriptDiagnosticsSourceAuthorityRequest>,
  maxMessageCharacters: number,
): value is TypeScriptCompilerDiagnostic {
  if (
    !exactRecord(value, ["severity", "message", "code", "evidence", "category", "location"]) ||
    !["error", "warning", "information", "hint"].includes(value.severity as string) ||
    typeof value.message !== "string" ||
    typeof value.code !== "string" ||
    value.evidence !== "compiler" ||
    typeof value.category !== "string" ||
    !validMessage(value.message, maxMessageCharacters) ||
    !TYPESCRIPT_CODE.test(value.code) ||
    !validMetadata(value.category)
  ) {
    return false;
  }
  const location = value.location;
  if (
    !exactRecord(location, ["kind", "path", "encoding", "range"]) ||
    location.kind !== "range" ||
    typeof location.path !== "string" ||
    location.encoding !== "utf-16" ||
    !authority.documents.some(({ path }) => path === location.path) ||
    !exactRecord(location.range, ["start", "end"]) ||
    !validPoint(location.range.start) ||
    !validPoint(location.range.end)
  ) {
    return false;
  }
  const start = location.range.start;
  const end = location.range.end;
  return end.line > start.line || (end.line === start.line && end.character >= start.character);
}

function validPoint(value: unknown): value is TypeScriptDiagnosticsPoint {
  return (
    exactRecord(value, ["line", "character"]) &&
    typeof value.line === "number" &&
    typeof value.character === "number" &&
    safeNonnegativeInteger(value.line) &&
    safeNonnegativeInteger(value.character)
  );
}

function validFailure(value: unknown): value is TypeScriptDiagnosticsFailure {
  return (
    exactRecord(value, ["code", "message"]) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    validMetadata(value.code) &&
    validMessage(value.message, 4096)
  );
}

function freezeResponseRuntime(
  runtime: TypeScriptDiagnosticsResponseRuntime,
): Readonly<TypeScriptDiagnosticsResponseRuntime> {
  return Object.freeze({
    executionMode: runtime.executionMode,
    supportsTimeout: runtime.supportsTimeout,
    supportsCancellation: runtime.supportsCancellation,
    usesWorkspaceOverlay: runtime.usesWorkspaceOverlay,
    recordsProcessProvenance: runtime.recordsProcessProvenance,
    limits: Object.freeze({ ...runtime.limits }),
  });
}

function freezeCompilerAttestation(
  attestation: TypeScriptDiagnosticsCompilerAttestation,
): Readonly<TypeScriptDiagnosticsCompilerAttestation> {
  return Object.freeze({
    toolchainProvider: attestation.toolchainProvider,
    nodeVersion: attestation.nodeVersion,
    typeScriptVersion: attestation.typeScriptVersion,
    compilerSha256: attestation.compilerSha256,
    toolchainEvidenceSha256: attestation.toolchainEvidenceSha256,
    process: Object.freeze({ ...attestation.process }),
  });
}

function freezeSourceAuthorityResponse(
  authority: TypeScriptDiagnosticsSourceAuthorityResponse,
): Readonly<TypeScriptDiagnosticsSourceAuthorityResponse> {
  return Object.freeze({
    kind: "immutable-editor-overlay",
    baseSnapshotHash: authority.baseSnapshotHash,
    overlayHash: authority.overlayHash,
    providerSnapshotHash: authority.providerSnapshotHash,
    documents: Object.freeze(authority.documents.map((document) => Object.freeze({ ...document }))),
  });
}

function freezeDiagnostics(
  diagnostics: TypeScriptCompilerDiagnostic[],
): readonly Readonly<TypeScriptCompilerDiagnostic>[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      Object.freeze({
        severity: diagnostic.severity,
        message: diagnostic.message,
        code: diagnostic.code,
        evidence: "compiler" as const,
        category: diagnostic.category,
        location: Object.freeze({
          kind: "range" as const,
          path: diagnostic.location.path,
          encoding: "utf-16" as const,
          range: Object.freeze({
            start: Object.freeze({ ...diagnostic.location.range.start }),
            end: Object.freeze({ ...diagnostic.location.range.end }),
          }),
        }),
      }),
    ),
  );
}

function freezeFailure(
  failure: TypeScriptDiagnosticsFailure,
): Readonly<TypeScriptDiagnosticsFailure> {
  return Object.freeze({ code: failure.code, message: failure.message });
}

function validOpaqueRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value)
  );
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

function validMessage(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && !CONTROL_CHARACTERS.test(value);
}

function validWorkspaceRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !CONTROL_CHARACTERS.test(value) &&
    !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  );
}

function positiveGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeNonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function qualifiedRuntime(runtime: RefactorKitLanguageAdapterRuntime): boolean {
  return (
    runtime.supportsTimeout &&
    runtime.supportsCancellation &&
    runtime.usesWorkspaceOverlay &&
    runtime.recordsProcessProvenance &&
    positiveLimit(runtime.limits.requestTimeoutMillis) &&
    positiveLimit(runtime.limits.maxInputBytes) &&
    positiveLimit(runtime.limits.maxOutputBytes) &&
    positiveLimit(runtime.limits.maxProcesses)
  );
}

function positiveLimit(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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

function stringArrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && keys.includes(key))
  );
}
