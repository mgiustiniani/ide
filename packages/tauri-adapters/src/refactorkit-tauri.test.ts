import type {
  SavedSnapshotDefinitionRequest,
  SavedSnapshotSemanticSessionStartRequest,
  SavedSnapshotSemanticSessionStopRequest,
  SavedSnapshotSymbolSearchRequest,
  TypeScriptDiagnosticsCompilerAttestation,
  TypeScriptDiagnosticsRequest,
  TypeScriptDiagnosticsResponseRuntime,
} from "@ide/contracts";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { normalizeRefactorPreview, TauriRefactorKitAdapter } from "./refactorkit-tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const LANGUAGE_VOCABULARY = {
  stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
  evidence: ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
  mutationAuthority: ["managed-stable", "proposal-only", "none"],
  executionMode: ["in-process", "external-process"],
};

const JAVA_RUNTIME = {
  executionMode: "in-process",
  supportsTimeout: false,
  supportsCancellation: false,
  usesWorkspaceOverlay: false,
  recordsProcessProvenance: false,
  limits: {
    requestTimeoutMillis: null,
    maxInputBytes: null,
    maxOutputBytes: null,
    maxProcesses: null,
  },
};

const javaCapabilities = [
  ["changeSignature.addParameter", "experimental", "compiler", "proposal-only"],
  ["changeSignature.removeParameter", "experimental", "compiler", "proposal-only"],
  ["changeSignature.renameParameter", "experimental", "compiler", "proposal-only"],
  ["changeSignature.reorderParameters", "experimental", "compiler", "proposal-only"],
  ["extractMethod", "experimental", "compiler", "proposal-only"],
  ["formatFile", "stable", "structural-parse", "managed-stable"],
  ["inlineConstant", "stable", "compiler", "managed-stable"],
  ["inlineVariable", "stable", "compiler", "managed-stable"],
  ["moveClass", "stable", "compiler", "managed-stable"],
  ["moveSourceRoot", "stable", "structural-parse", "managed-stable"],
  ["organizeImports", "stable", "structural-parse", "managed-stable"],
  ["renameClass", "stable", "compiler", "managed-stable"],
  ["renameMember", "stable", "compiler", "managed-stable"],
  ["safeDelete", "stable", "compiler", "managed-stable"],
].map(([operation, stability, evidence, mutationAuthority]) => ({
  operation,
  stability,
  evidence,
  mutationAuthority,
  backend: "eclipse-jdt-3.44",
  runtime: structuredClone(JAVA_RUNTIME),
  extensions: ["java"],
}));

function treeSitterAdapter(languageId: "javascript" | "typescript", extension: "js" | "ts") {
  const runtime = {
    executionMode: "in-process",
    supportsTimeout: true,
    supportsCancellation: false,
    usesWorkspaceOverlay: false,
    recordsProcessProvenance: false,
    limits: {
      requestTimeoutMillis: 2_000,
      maxInputBytes: 16 * 1024 * 1024,
      maxOutputBytes: null,
      maxProcesses: null,
    },
  };
  const operationMetadata = () => ({
    backend: "tree-sitter-jni-0.25.3",
    runtime: structuredClone(runtime),
    extensions: [extension],
  });
  return {
    languageId,
    extensions: [extension],
    backend: "tree-sitter-jni-0.25.3",
    runtime,
    capabilities: [
      {
        operation: "identifierSearch",
        stability: "stable",
        evidence: "native-ast",
        mutationAuthority: "none",
        ...operationMetadata(),
      },
      {
        operation: "localRename",
        stability: "structural",
        evidence: "lexical",
        mutationAuthority: "proposal-only",
        ...operationMetadata(),
      },
      {
        operation: "outline",
        stability: "stable",
        evidence: "native-ast",
        mutationAuthority: "none",
        ...operationMetadata(),
      },
    ],
  };
}

const GENERAL_REFACTORING_OPERATIONS = [
  "rename-class",
  "rename-member",
  "rename-local-variable",
  "move-class",
  "move-member",
  "change-method-signature",
  "extract-constant",
  "inline-variable",
  "inline-constant",
  "encapsulate-field",
  "safe-delete",
] as const;

// Honest unavailable advertisement: the daemon always serializes generalRefactoring,
// so normalizeCapabilities surfaces an honest unavailable shape when the operation set
// was never advertised (supported false, all feature flags false, stability experimental).
const generalRefactoringUnavailable = {
  supported: false,
  operations: [...GENERAL_REFACTORING_OPERATIONS],
  preview: false,
  apply: false,
  rollback: false,
  discard: false,
  stability: "experimental",
  reason:
    "RefactorKit general Java refactoring is unavailable. The daemon did not advertise the general-refactoring operation set.",
};

// Real-engine capability surface helpers for REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001.
// getCapabilities() invokes the engine command first (get_refactorkit_engine_capabilities)
// and the base command second (get_refactorkit_capabilities), merging generalRefactoring
// from the engine report while preserving the base external-import/language-kernel/methods/
// safety surface. These helpers model the engine wire and the resulting surface.
const ENGINE_OPERATIONAL_SURFACE = [
  "preview",
  "apply",
  "rollback",
  "discard",
  "rename-class",
  "safe-delete",
] as const;

// The engine-derived generalRefactoring advertisement when the engine is discovered and
// advertises operations: preview follows previewReadOnly, rollback follows rollbackAdvertised,
// apply/discard follow supported, and stability is authoritative as "stable".
const engineGeneralRefactoringAdvertised = {
  supported: true,
  operations: [...GENERAL_REFACTORING_OPERATIONS],
  preview: true,
  apply: true,
  rollback: true,
  discard: true,
  stability: "stable",
};

// Honest unavailable surface when the engine is not discovered (or reports no operations):
// supported=false, every feature flag false, stability experimental, reason retained.
const engineGeneralRefactoringUnavailable = {
  supported: false,
  operations: [],
  preview: false,
  apply: false,
  rollback: false,
  discard: false,
  stability: "experimental",
  reason: "The real engine was not discovered through the wrapper PATH.",
};

// Extra engine fields surfaced on TauriRefactorKitEngineCapabilities beside the base
// RefactorKitCapabilities shape, matching the discovered engineCapabilitiesWire().
function engineSurfaceFields(): Record<string, unknown> {
  return {
    engineDiscovered: true,
    enginePath: "/usr/local/bin/refactorkit",
    engineVersion: "0.7.0-SNAPSHOT",
    operationalSurface: [...ENGINE_OPERATIONAL_SURFACE],
    workspaceId: "workspace:authorized",
    managedJavaMutationOperations: [],
  };
}

// Wire for the engine capability report (get_refactorkit_engine_capabilities) when a real
// engine is discovered and advertises the general-refactoring operation set.
function engineCapabilitiesWire(overrides: (record: any) => void = () => undefined): any {
  const record: any = {
    engineDiscovered: true,
    operations: [...GENERAL_REFACTORING_OPERATIONS],
    managedOperations: [],
    operationalSurface: [...ENGINE_OPERATIONAL_SURFACE],
    rollbackAdvertised: true,
    previewReadOnly: true,
    path: "/usr/local/bin/refactorkit",
    version: "0.7.0-SNAPSHOT",
    workspaceId: "workspace:authorized",
    reason: null,
  };
  overrides(record);
  return record;
}

// Wire for the engine capability report when no real engine is discoverable (honest
// unavailable advertisement: supported false, all feature flags false).
function unavailableEngineCapabilitiesWire(): any {
  return {
    engineDiscovered: false,
    operations: [],
    managedOperations: [],
    operationalSurface: [],
    rollbackAdvertised: false,
    previewReadOnly: false,
    path: null,
    version: null,
    workspaceId: "workspace:authorized",
    reason: "The real engine was not discovered through the wrapper PATH.",
  };
}

const actualSchemaV1Capabilities = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.5.0-SNAPSHOT",
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "experimental",
  },
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: [
        {
          languageId: "java",
          extensions: ["java"],
          backend: "eclipse-jdt-3.44",
          runtime: structuredClone(JAVA_RUNTIME),
          capabilities: javaCapabilities,
        },
        treeSitterAdapter("javascript", "js"),
        treeSitterAdapter("typescript", "ts"),
      ],
      vocabulary: LANGUAGE_VOCABULARY,
    },
  },
  generalRefactoring: generalRefactoringUnavailable,
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
};

// Real-engine structural command result (RealEngineCommandResult): the engine
// serializes `command` as a string array (not an object with executable/args) and
// carries engine/engineVersion metadata that the port contract drops. normalizeEngineCommandResult
// reads `command` via legacyStrings, so the wire uses the engine string-array shape.
const rustCommandResult = {
  stdout: "scan complete",
  stderr: "",
  locations: [],
  success: true,
  code: 0,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  command: ["/usr/local/bin/refactorkit", "scan", "/workspace/project"],
};

const DIAGNOSTICS_OPERATION_RUNTIME = {
  executionMode: "external-process" as const,
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: {
    requestTimeoutMillis: 30_000,
    maxInputBytes: 536_870_912,
    maxOutputBytes: 8_388_608,
    maxProcesses: 1,
  },
};

const DIAGNOSTICS_RESPONSE_RUNTIME = {
  ...DIAGNOSTICS_OPERATION_RUNTIME,
  limits: {
    ...DIAGNOSTICS_OPERATION_RUNTIME.limits,
    maxStderrBytes: 65_536,
    compilerHeapMiB: 512,
    maxDiagnostics: 500,
    maxDiagnosticMessageChars: 4_096,
    maxResponseBytes: 2_097_152,
  },
} satisfies TypeScriptDiagnosticsResponseRuntime;

const DIAGNOSTICS_COMPILER_ATTESTATION = {
  toolchainProvider: "typescript-lsp-explicit-v1",
  nodeVersion: "22.23.0",
  typeScriptVersion: "5.9.3",
  compilerSha256: "e".repeat(64),
  toolchainEvidenceSha256: "f".repeat(64),
  process: {
    executableSha256: "1".repeat(64),
    argumentsSha256: "2".repeat(64),
    processId: 42,
  },
} satisfies TypeScriptDiagnosticsCompilerAttestation;

const DIAGNOSTICS_REQUEST = {
  schemaVersion: 2,
  operation: "diagnostics.v2",
  requestId: "desktop-diagnostics:1:1",
  languageId: "typescript",
  workspaceId: "workspace:authorized",
  workspaceGeneration: 7,
  sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
  expectedSnapshotHash: `sha256:${"b".repeat(64)}`,
  semanticLease: "semantic-00000000-0000-4000-8000-000000000001",
  sourceAuthority: {
    kind: "immutable-editor-overlay",
    documents: [
      {
        path: "src/broken.ts",
        version: 9,
        content: 'const amount: number = "wrong";\n',
      },
    ],
  },
} as const satisfies TypeScriptDiagnosticsRequest;

const DIAGNOSTICS_EXACT_RESULT = {
  severity: "error",
  message: "Type 'string' is not assignable to type 'number'.",
  code: "TS2322",
  evidence: "compiler",
  category: "type-resolution",
  location: {
    kind: "range",
    path: "src/broken.ts",
    encoding: "utf-16",
    range: {
      start: { line: 0, character: 6 },
      end: { line: 0, character: 12 },
    },
  },
} as const;

function setDiagnosticsResponseBytes(candidate: Record<string, unknown>): void {
  candidate.responseBytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    candidate.responseBytes = bytes;
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") === bytes) return;
  }
  throw new Error("diagnostics.v2 response byte count did not converge");
}

function diagnosticsResponse(
  status: "ready" | "refused" | "error" = "ready",
): Record<string, unknown> {
  const diagnostics = status === "ready" ? [structuredClone(DIAGNOSTICS_EXACT_RESULT)] : [];
  const candidate: Record<string, unknown> = {
    schemaVersion: 2,
    operation: "diagnostics.v2",
    requestId: DIAGNOSTICS_REQUEST.requestId,
    languageId: "typescript",
    status,
    workspaceId: DIAGNOSTICS_REQUEST.workspaceId,
    workspaceGeneration: DIAGNOSTICS_REQUEST.workspaceGeneration,
    sessionId: DIAGNOSTICS_REQUEST.sessionId,
    provider: { name: "refactorkit", version: "0.7.0-SNAPSHOT", apiVersion: "0.2" },
    backend: "typescript-compiler-exact-v1",
    semanticLease: DIAGNOSTICS_REQUEST.semanticLease,
    projectSnapshotHash: DIAGNOSTICS_REQUEST.expectedSnapshotHash,
    providerSnapshotHash: "c".repeat(64),
    sourceAuthority: {
      kind: "immutable-editor-overlay",
      baseSnapshotHash: DIAGNOSTICS_REQUEST.expectedSnapshotHash,
      overlayHash: "3".repeat(64),
      providerSnapshotHash: "c".repeat(64),
      documents: [{ path: "src/broken.ts", version: 9, contentSha256: "4".repeat(64) }],
    },
    rangeEncoding: "utf-16",
    rangeCapability: "exact-utf16-or-explicit-partial",
    runtime: structuredClone(DIAGNOSTICS_RESPONSE_RUNTIME),
    compilerAttestation:
      status === "refused" ? null : structuredClone(DIAGNOSTICS_COMPILER_ATTESTATION),
    failure:
      status === "ready"
        ? null
        : {
            code:
              status === "refused"
                ? "diagnostics.semanticLeaseStale"
                : "typescript.compilerDiagnosticsTimeout",
            message:
              status === "refused"
                ? "Semantic session lease is stale or belongs to another snapshot"
                : "Exact compiler diagnostics timed out",
          },
    diagnostics,
    diagnosticsTotal: diagnostics.length,
    diagnosticsReturned: diagnostics.length,
    truncated: false,
    responseBytes: 0,
  };
  setDiagnosticsResponseBytes(candidate);
  return candidate;
}

const DIAGNOSTICS_METHOD_FEATURES = {
  requestCorrelation: true,
  semanticLease: true,
  savedDiskAuthority: true,
  immutableEditorOverlay: true,
  exactUtf16Ranges: true,
  structuredReadiness: true,
  compilerAttestation: true,
  boundedResponse: true,
};

function diagnosticsV2Method() {
  return {
    name: "diagnostics.v2",
    stability: "additive-api-0.2",
    requiresProject: true,
    writesWorkspace: false,
    features: { ...DIAGNOSTICS_METHOD_FEATURES },
  };
}

function genericMethod(name: string) {
  return {
    name,
    stability: "beta-contract",
    requiresProject: true,
    writesWorkspace: false,
    features: { retained: true },
  };
}

function diagnosticsV2Capabilities() {
  return {
    ...structuredClone(actualSchemaV1Capabilities),
    providerVersion: "0.7.0-SNAPSHOT",
    methods: [
      genericMethod("symbol.definition"),
      diagnosticsV2Method(),
      genericMethod("symbol.references"),
    ],
    languageKernel: {
      available: true,
      schema: {
        schemaVersion: 1,
        adapters: [
          {
            languageId: "typescript",
            extensions: ["ts", "tsx"],
            backend: "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
            runtime: structuredClone(DIAGNOSTICS_OPERATION_RUNTIME),
            capabilities: [
              {
                operation: "diagnostics",
                stability: "experimental",
                evidence: "compiler",
                mutationAuthority: "none",
                backend: "typescript-compiler-exact-v1",
                runtime: structuredClone(DIAGNOSTICS_OPERATION_RUNTIME),
                extensions: ["ts", "tsx"],
                diagnosticSnapshotModes: ["immutable-editor-overlay", "saved-disk"],
                diagnosticRangeCapability: "exact-utf16-or-explicit-partial",
              },
            ],
          },
        ],
        vocabulary: {
          ...LANGUAGE_VOCABULARY,
          diagnosticSnapshotMode: ["saved-disk", "immutable-editor-overlay"],
          diagnosticRangeCapability: ["exact-utf16-or-explicit-partial"],
        },
      },
    },
  };
}

const SEMANTIC_SESSION_ID = `refactorkit-semantic-session-v1:${"a".repeat(64)}`;
const SNAPSHOT_IDENTITY = `sha256:${"b".repeat(64)}`;
const SEMANTIC_LEASE = `semantic-${"a".repeat(36)}`;
const PRIVATE_NATIVE_DETAIL = "private-native-toolchain-detail-sentinel";

function semanticRuntime() {
  return {
    executionMode: "external-process" as const,
    supportsTimeout: true,
    supportsCancellation: true,
    usesWorkspaceOverlay: true,
    recordsProcessProvenance: true,
    limits: {
      requestTimeoutMillis: 30_000,
      maxInputBytes: 16 * 1024 * 1024,
      maxOutputBytes: 4 * 1024 * 1024,
      maxProcesses: 1,
    },
  };
}

function semanticSessionStartRequest(): SavedSnapshotSemanticSessionStartRequest {
  return {
    languageId: "typescript",
    workspaceRoot: "/workspace/project",
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    provider: "refactorkit",
    providerVersion: "0.5.0-SNAPSHOT",
    backend: "typescript-language-server-4.3.4",
    runtime: semanticRuntime(),
    extensions: ["ts", "tsx"],
    toolchain: {
      nodeExecutable: "/opt/refactorkit/node/bin/node",
      languageServerPackageRoot: "/opt/refactorkit/typescript-language-server",
      typeScriptPackageRoot: "/opt/refactorkit/typescript",
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    },
    acceptedSemanticCompleteness: ["full-typescript"],
  };
}

function semanticSessionStartResponse() {
  const request = semanticSessionStartRequest();
  return {
    languageId: request.languageId,
    workspaceRoot: request.workspaceRoot,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: SEMANTIC_SESSION_ID,
    providerProjectSnapshotIdentity: SNAPSHOT_IDENTITY,
    semanticLease: SEMANTIC_LEASE,
    startSnapshotHash: SNAPSHOT_IDENTITY,
    provider: request.provider,
    providerVersion: request.providerVersion,
    backend: request.backend,
    toolchain: {
      backend: request.backend,
      runtime: structuredClone(request.runtime),
      extensions: [...request.extensions],
      nodeExecutable: request.toolchain.nodeExecutable,
      languageServerPackageRoot: request.toolchain.languageServerPackageRoot,
      typeScriptPackageRoot: request.toolchain.typeScriptPackageRoot,
    },
    semanticCompleteness: "full-typescript",
    processProvenance: {
      serverName: "typescript-language-server",
      serverVersion: "4.3.4",
      capabilitiesSha256: "c".repeat(64),
      executableSha256: "d".repeat(64),
      argumentsSha256: "e".repeat(64),
      processId: 4242,
    },
  };
}

function semanticSessionStopRequest(): SavedSnapshotSemanticSessionStopRequest {
  return {
    languageId: "typescript",
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    sessionId: SEMANTIC_SESSION_ID,
  };
}

function semanticSessionStopResponse() {
  return { ...semanticSessionStopRequest(), stopped: true };
}

function opaqueSymbolId(index = 1): string {
  return `lsp-symbol-v1:${index.toString(16).padStart(64, "0")}`;
}

function savedSnapshotSearchRequest(): SavedSnapshotSymbolSearchRequest {
  return {
    languageId: "typescript",
    query: "Widget",
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    sessionId: SEMANTIC_SESSION_ID,
    semanticLease: SEMANTIC_LEASE,
    snapshotIdentity: SNAPSHOT_IDENTITY,
    providerVersion: "0.5.0-SNAPSHOT",
    backend: "typescript-language-server-4.3.4",
    toolchain: {
      nodeExecutable: "/opt/refactorkit/node/bin/node",
      languageServerPackageRoot: "/opt/refactorkit/typescript-language-server",
      typeScriptPackageRoot: "/opt/refactorkit/typescript",
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    },
  };
}

function savedSnapshotSearchResponse(symbolCount = 2) {
  const request = savedSnapshotSearchRequest();
  return {
    languageId: request.languageId,
    query: request.query,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
    completeness: {
      resultCompleteness: "unknown",
      truncation: "unknown",
      semanticCompleteness: "full-typescript",
      experimentalDisclosure: "shown",
    },
    symbols: Array.from({ length: symbolCount }, (_, index) => ({
      id: opaqueSymbolId(index + 1),
      name: `Widget${index + 1}`,
      kind: "class",
    })),
  };
}

function savedSnapshotDefinitionRequest(): SavedSnapshotDefinitionRequest {
  const search = savedSnapshotSearchRequest();
  return {
    languageId: search.languageId,
    symbolId: opaqueSymbolId(1),
    workspaceId: search.workspaceId,
    workspaceGeneration: search.workspaceGeneration,
    sessionId: search.sessionId,
    semanticLease: SEMANTIC_LEASE,
    snapshotIdentity: search.snapshotIdentity,
    providerVersion: search.providerVersion,
    backend: search.backend,
  };
}

function savedSnapshotDefinitionResponse() {
  const request = savedSnapshotDefinitionRequest();
  return {
    languageId: request.languageId,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
    selectedSymbol: { id: request.symbolId, name: "Widget1", kind: "class" },
    file: "src/Widget.ts",
    point: { line: 12, character: 7 },
  };
}

describe("TauriRefactorKitAdapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("normalizes the Rust status shape and omits null optional values", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce({
      available: false,
      path: null,
      version: null,
      lastError: "refactorkit was not found on PATH",
      backendOnly: true,
    });

    await expect(adapter.getStatus()).resolves.toEqual({
      available: false,
      lastError: "refactorkit was not found on PATH",
    });
    expect(invokeMock).toHaveBeenCalledWith("get_refactorkit_status", undefined);
  });

  it("normalizes a Rust command result to the port contract", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(rustCommandResult);

    await expect(adapter.scan()).resolves.toEqual({
      stdout: "scan complete",
      stderr: "",
      locations: [],
      success: true,
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      command: ["/usr/local/bin/refactorkit", "scan", "/workspace/project"],
    });
    expect(invokeMock).toHaveBeenCalledWith("run_refactorkit_engine_scan", undefined);
  });

  it("normalizes multiple locations, preserves paths, and omits an absent column", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce({
      ...rustCommandResult,
      locations: [
        { path: "src/main/java/com/example/Service.java", line: 17, column: 9 },
        { path: "src/./test/java/com/example/ServiceTest.java", line: 41 },
      ],
    });

    await expect(adapter.references("com.example.Service")).resolves.toMatchObject({
      locations: [
        { path: "src/main/java/com/example/Service.java", line: 17, column: 9 },
        { path: "src/./test/java/com/example/ServiceTest.java", line: 41 },
      ],
    });
  });

  it("accepts an empty locations list", async () => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(rustCommandResult);

    await expect(adapter.symbols()).resolves.toMatchObject({ locations: [] });
  });

  it("forwards the exact schema-v2 diagnostics request inside only { request } and accepts ready", async () => {
    const adapter = new TauriRefactorKitAdapter();
    const candidate = diagnosticsResponse();
    invokeMock.mockResolvedValueOnce(candidate);

    const result = await adapter.diagnostics(DIAGNOSTICS_REQUEST);

    expect(result).toEqual(candidate);
    expect(result).not.toBe(candidate);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready diagnostics");
    expect(result.diagnostics).toEqual([DIAGNOSTICS_EXACT_RESULT]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, argumentsValue] = invokeMock.mock.calls[0]!;
    expect(command).toBe("run_refactorkit_diagnostics");
    expect(Reflect.ownKeys(argumentsValue as object)).toEqual(["request"]);
    expect((argumentsValue as { request: unknown }).request).toBe(DIAGNOSTICS_REQUEST);
  });

  it.each(["refused", "error"] as const)(
    "accepts one correlated structured diagnostics %s response without fallback output",
    async (status) => {
      const candidate = diagnosticsResponse(status);
      invokeMock.mockResolvedValueOnce(candidate);

      const result = await new TauriRefactorKitAdapter().diagnostics(DIAGNOSTICS_REQUEST);

      expect(result).toEqual(candidate);
      expect(result.status).toBe(status);
      expect(result.failure).not.toBeNull();
      expect(result.diagnostics).toEqual([]);
      expect(result).not.toHaveProperty("stdout");
      expect(invokeMock).toHaveBeenCalledWith("run_refactorkit_diagnostics", {
        request: DIAGNOSTICS_REQUEST,
      });
    },
  );

  it.each([
    [
      "malformed response runtime",
      "response-schema-invalid",
      (value: Record<string, unknown>) => {
        delete value.runtime;
      },
      true,
    ],
    [
      "extra legacy output field",
      "response-schema-invalid",
      (value: Record<string, unknown>) => {
        value.stdout = "legacy fallback output";
      },
      true,
    ],
    [
      "stale request correlation",
      "response-correlation-mismatch",
      (value: Record<string, unknown>) => {
        value.requestId = "desktop-diagnostics:stale";
      },
      true,
    ],
    [
      "unaccepted backend",
      "response-backend-mismatch",
      (value: Record<string, unknown>) => {
        value.backend = "typescript-language-server";
      },
      true,
    ],
    [
      "malformed compiler attestation",
      "response-status-invalid",
      (value: Record<string, unknown>) => {
        (value.compilerAttestation as Record<string, unknown>).compilerSha256 = "not-a-sha256";
      },
      true,
    ],
    [
      "response beyond advertised bounds",
      "response-bounds-exceeded",
      (value: Record<string, unknown>) => {
        value.responseBytes = DIAGNOSTICS_RESPONSE_RUNTIME.limits.maxResponseBytes + 1;
      },
      false,
    ],
    [
      "reversed exact UTF-16 range",
      "response-diagnostic-invalid",
      (value: Record<string, unknown>) => {
        const diagnostic = (value.diagnostics as Record<string, unknown>[])[0]!;
        const location = diagnostic.location as Record<string, unknown>;
        const range = location.range as Record<string, unknown>;
        (range.end as Record<string, unknown>).character = 5;
      },
      true,
    ],
  ] as const)(
    "rejects and redacts a diagnostics response with %s",
    async (_case, reason, mutate, recount) => {
      const candidate = diagnosticsResponse();
      mutate(candidate);
      if (recount) setDiagnosticsResponseBytes(candidate);
      invokeMock.mockResolvedValueOnce(candidate);

      const error = await new TauriRefactorKitAdapter()
        .diagnostics(DIAGNOSTICS_REQUEST)
        .catch((value: unknown) => value);

      expect(error).toMatchObject({
        name: "TauriRefactorKitDiagnosticsResponseError",
        command: "run_refactorkit_diagnostics",
        code: "REFACTORKIT_TYPESCRIPT_DIAGNOSTICS_RESPONSE_REJECTED",
        reason,
        cause: undefined,
      });
      expect(error).not.toHaveProperty("response");
      expect(JSON.stringify(error)).not.toContain("legacy fallback output");
      expect(invokeMock).toHaveBeenCalledWith("run_refactorkit_diagnostics", {
        request: DIAGNOSTICS_REQUEST,
      });
    },
  );

  it.each([
    {
      name: "definition",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.definition(symbol),
      command: "run_refactorkit_engine_definition",
      action: "definition",
    },
    {
      name: "references",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.references(symbol),
      command: "run_refactorkit_engine_references",
      action: "references",
    },
  ])(
    "invokes the fixed $name engine command with the symbol and normalizes its result",
    async ({ invokeAdapter, command, action }) => {
      const adapter = new TauriRefactorKitAdapter();
      const symbol = "com.example.Service#execute(java.lang.String)";
      invokeMock.mockResolvedValueOnce({
        ...rustCommandResult,
        stdout: `${action} result`,
        command: ["/usr/local/bin/refactorkit", action, "--symbol", symbol, "/workspace/project"],
      });

      await expect(invokeAdapter(adapter, symbol)).resolves.toEqual({
        stdout: `${action} result`,
        stderr: "",
        locations: [],
        success: true,
        code: 0,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        command: ["/usr/local/bin/refactorkit", action, "--symbol", symbol, "/workspace/project"],
      });
      expect(invokeMock).toHaveBeenCalledWith(command, { symbol });
    },
  );

  it.each([
    {
      name: "definition",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.definition(symbol),
      command: "run_refactorkit_engine_definition",
    },
    {
      name: "references",
      invokeAdapter: (adapter: TauriRefactorKitAdapter, symbol: string) =>
        adapter.references(symbol),
      command: "run_refactorkit_engine_references",
    },
  ])(
    "propagates $name backend rejections with command context",
    async ({ invokeAdapter, command }) => {
      const adapter = new TauriRefactorKitAdapter();
      const symbol = "com.example.Service#execute";
      const rejection = { error: "symbol was not found" };
      invokeMock.mockRejectedValueOnce(rejection);

      await expect(invokeAdapter(adapter, symbol)).rejects.toMatchObject({
        name: "TauriAdapterError",
        command,
        cause: rejection,
      } satisfies Partial<TauriAdapterError>);
      expect(invokeMock).toHaveBeenCalledWith(command, { symbol });
    },
  );

  it.each([
    {
      name: "non-object status",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.getStatus(),
      payload: null,
      command: "get_refactorkit_status",
    },
    {
      name: "non-boolean availability",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.getStatus(),
      payload: { available: "yes" },
      command: "get_refactorkit_status",
    },
    {
      name: "fractional exit code",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, code: 0.5 },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "missing locations list",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: undefined },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "non-array locations list",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: {} },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "empty location path",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: "", line: 1 }] },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "non-string location path",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: 42, line: 1 }] },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "zero location line",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: "Main.java", line: 0 }] },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "fractional location line",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: { ...rustCommandResult, locations: [{ path: "Main.java", line: 1.5 }] },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "zero location column",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: {
        ...rustCommandResult,
        locations: [{ path: "Main.java", line: 1, column: 0 }],
      },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "fractional location column",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: {
        ...rustCommandResult,
        locations: [{ path: "Main.java", line: 1, column: 2.5 }],
      },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "null location column",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.scan(),
      payload: {
        ...rustCommandResult,
        locations: [{ path: "Main.java", line: 1, column: null }],
      },
      command: "run_refactorkit_engine_scan",
    },
    {
      name: "object command metadata",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.symbols(),
      payload: {
        ...rustCommandResult,
        command: {
          executable: "/usr/local/bin/refactorkit",
          args: ["symbols", "/workspace/project"],
        },
      },
      command: "run_refactorkit_engine_symbols",
    },
    {
      name: "non-string command argument",
      invokeAdapter: (adapter: TauriRefactorKitAdapter) => adapter.symbols(),
      payload: {
        ...rustCommandResult,
        command: ["refactorkit", "symbols", 42],
      },
      command: "run_refactorkit_engine_symbols",
    },
  ])("rejects malformed payloads: $name", async ({ invokeAdapter, payload, command }) => {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(payload);

    await expect(invokeAdapter(adapter)).rejects.toMatchObject({
      name: "TauriAdapterError",
      command,
      cause: payload,
    } satisfies Partial<TauriAdapterError>);
  });
});

describe("TauriRefactorKitAdapter managed external import protocol", () => {
  const previewRequest = {
    code: "package incoming; public class Widget {}",
    targetDirectory: "src/main/java/example",
    sourceKind: "clipboard" as const,
    sourceUrl: null,
    licensePolicy: "warn" as const,
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    selectionGeneration: 9,
    requestId: "request-1",
  };

  const plan = {
    planId: "plan-1",
    status: "ready",
    summary: "Import Widget",
    confidence: 0.85,
    riskLevel: "medium",
    evidence: [
      { kind: "source-root", summary: "Maven source root", path: "pom.xml", detail: "main" },
    ],
    affectedFiles: [
      { change: "create", path: "src/main/java/example/Widget.java", primary: true },
      { change: "edit", path: "pom.xml", primary: false },
    ],
    placement: { packageName: "example", sourceRoot: "src/main/java", moduleName: null },
    packageChanges: [
      { fromPackage: null, toPackage: null },
      { path: "src/main/java/example/Widget.java", fromPackage: "incoming", toPackage: "example" },
    ],
    renderedDiff: "--- /dev/null\n+++ b/src/main/java/example/Widget.java",
    structuredDiff: [
      {
        path: "src/main/java/example/Widget.java",
        change: "create",
        hunks: [
          { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ["+package example;"] },
        ],
      },
    ],
    warnings: ["Review generated package"],
    diagnosticsAfterPreview: [
      { severity: "warning", message: "Review", path: "pom.xml", line: 1, column: 1 },
    ],
    provenance: {
      sourceKind: "clipboard",
      sourceUrl: null,
      detectedLicense: "Apache-2.0",
      licensePolicy: "warn",
      notices: ["Retain copyright notice"],
    },
    unresolvedDependencies: ["org.example:widget:1.0"],
    conflicts: [
      { kind: "existing-file", summary: "Existing type", path: "src/main/java/example/Old.java" },
    ],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    provider: "refactorkit",
    providerVersion: "2.0.0",
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    selectionGeneration: 9,
    requestId: "request-1",
  };

  beforeEach(() => invokeMock.mockReset());

  it("normalizes current managed capabilities as authoritative true flags", async () => {
    const capabilities = {
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.5.0-SNAPSHOT",
      javaImportExternalClass: {
        supported: true,
        targetDirectory: true,
        preview: true,
        apply: true,
        rollback: true,
        stability: "experimental",
      },
      generalRefactoring: generalRefactoringUnavailable,
      javaContextRefactoring: {
        schemaVersion: 1,
        operations: ["moveClass", "changeSignature.addParameter", "batchCleanup"],
        requiresExplicitContext: true,
        sourceAuthority: "saved-snapshot",
        rollbackAuthority: true,
        renderedDiff: true,
        operationCapabilities: [
          {
            operation: "moveClass",
            targetModuleSelection: {
              schemaVersion: "java-move-class-target-module-v1",
              argument: "targetModuleId",
              identity: "module-id-within-source-provider",
              requiresAvailableContext: true,
              sourceSetKind: "main",
              requiresUniqueNonGeneratedRoot: true,
            },
          },
          {
            operation: "safeDelete",
            referenceAnalysis: {
              schemaVersion: "java-safe-delete-reference-analysis-v1",
              scope: "workspace-text-v1",
              resultField: "referenceAnalysis",
              statusValues: ["complete", "incomplete"],
              managedApplyAuthority: "none",
              completeProject: false,
            },
          },
          {
            operation: "changeSignature.addParameter",
            features: { thisMethodReferenceMigration: true },
          },
          {
            operation: "batchCleanup",
            features: { formatterProfile: true },
          },
        ],
      },
    };
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);
    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toEqual({
      ...capabilities,
      generalRefactoring: engineGeneralRefactoringAdvertised,
      ...engineSurfaceFields(),
    });
    expect(invokeMock.mock.calls[1]).toEqual(["get_refactorkit_capabilities", undefined]);
    expect(invokeMock.mock.calls[0]).toEqual(["get_refactorkit_engine_capabilities", undefined]);
  });

  it("drops a malformed move-class destination-module attestation", async () => {
    const capabilities = {
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.8.0",
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
      generalRefactoring: generalRefactoringUnavailable,
      javaContextRefactoring: {
        schemaVersion: 1,
        operations: ["moveClass"],
        requiresExplicitContext: true,
        sourceAuthority: "saved-snapshot",
        rollbackAuthority: true,
        operationCapabilities: [
          {
            operation: "moveClass",
            targetModuleSelection: {
              schemaVersion: "java-move-class-target-module-v1",
              argument: "targetPath",
              identity: "module-id-within-source-provider",
              requiresAvailableContext: true,
              sourceSetKind: "main",
              requiresUniqueNonGeneratedRoot: true,
            },
          },
        ],
      },
    };
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.javaContextRefactoring).not.toHaveProperty("operationCapabilities");
  });

  it("normalizes actual schema-v1 Java, JavaScript, and TypeScript discovery with exact safety flags", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toEqual({
      ...actualSchemaV1Capabilities,
      generalRefactoring: engineGeneralRefactoringAdvertised,
      ...engineSurfaceFields(),
    });
    expect(invokeMock.mock.calls).toEqual([
      ["get_refactorkit_engine_capabilities", undefined],
      ["get_refactorkit_capabilities", undefined],
    ]);
  });

  it("retains ordered method metadata while independently cloning methods and feature maps", async () => {
    const response = diagnosticsV2Capabilities();
    const sourceMethods = response.methods;
    const sourceDiagnostics = sourceMethods[1]!;
    const sourceFeatures = sourceDiagnostics.features as Record<string, boolean>;
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.methods).toEqual(sourceMethods);
    expect(normalized.methods?.map(({ name }) => name)).toEqual([
      "symbol.definition",
      "diagnostics.v2",
      "symbol.references",
    ]);
    expect(normalized.methods).not.toBe(sourceMethods);
    expect(normalized.methods?.[1]).not.toBe(sourceDiagnostics);
    expect(normalized.methods?.[1]?.features).not.toBe(sourceFeatures);
    sourceFeatures.requestCorrelation = false;
    sourceMethods.reverse();
    expect(normalized.methods?.map(({ name }) => name)).toEqual([
      "symbol.definition",
      "diagnostics.v2",
      "symbol.references",
    ]);
    expect(normalized.methods?.[1]?.features?.requestCorrelation).toBe(true);
  });

  it.each([
    [
      "malformed method entry",
      (value: any) => {
        value.methods[0] = "symbol.definition";
      },
    ],
    [
      "duplicate method name",
      (value: any) => {
        value.methods.push(genericMethod("symbol.definition"));
      },
    ],
    [
      "unsafe diagnostics workspace write",
      (value: any) => {
        value.methods[1].writesWorkspace = true;
      },
    ],
    [
      "diagnostics method contradicted by unavailable language metadata",
      (value: any) => {
        value.languageKernel = { available: false, schema: null, reason: "unavailable" };
      },
    ],
  ])("rejects and redacts %s", async (_case, mutate) => {
    const response = diagnosticsV2Capabilities() as any;
    mutate(response);
    response.privateDetail = PRIVATE_NATIVE_DETAIL;
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(String(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
  });

  it("retains diagnostics snapshot modes and range capability in operation and vocabulary metadata", async () => {
    const response = diagnosticsV2Capabilities();
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const normalized = (await new TauriRefactorKitAdapter().getCapabilities()) as any;
    const capability = normalized.languageKernel.schema.adapters[0].capabilities[0];

    expect(capability).toMatchObject({
      operation: "diagnostics",
      diagnosticSnapshotModes: ["immutable-editor-overlay", "saved-disk"],
      diagnosticRangeCapability: "exact-utf16-or-explicit-partial",
    });
    expect(normalized.languageKernel.schema.vocabulary).toMatchObject({
      diagnosticSnapshotMode: ["saved-disk", "immutable-editor-overlay"],
      diagnosticRangeCapability: ["exact-utf16-or-explicit-partial"],
    });
    expect(capability.diagnosticSnapshotModes).not.toBe(
      response.languageKernel.schema.adapters[0]!.capabilities[0]!.diagnosticSnapshotModes,
    );
    expect(normalized.languageKernel.schema.vocabulary.diagnosticSnapshotMode).not.toBe(
      response.languageKernel.schema.vocabulary.diagnosticSnapshotMode,
    );
  });

  it.each([
    [
      "incomplete diagnostic vocabulary",
      (value: any) => {
        delete value.languageKernel.schema.vocabulary.diagnosticRangeCapability;
      },
    ],
    [
      "reordered diagnostic snapshot vocabulary",
      (value: any) => {
        value.languageKernel.schema.vocabulary.diagnosticSnapshotMode.reverse();
      },
    ],
    [
      "missing diagnostics snapshot modes",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].diagnosticSnapshotModes;
      },
    ],
    [
      "duplicate diagnostics snapshot mode",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].diagnosticSnapshotModes = [
          "immutable-editor-overlay",
          "immutable-editor-overlay",
        ];
      },
    ],
    [
      "unsafe diagnostics snapshot-mode order",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].diagnosticSnapshotModes.reverse();
      },
    ],
    [
      "missing diagnostics range capability",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].diagnosticRangeCapability;
      },
    ],
    [
      "unknown diagnostics range capability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].diagnosticRangeCapability =
          "best-effort-utf8";
      },
    ],
  ])("rejects invalid language-kernel diagnostics metadata: %s", async (_case, mutate) => {
    const response = diagnosticsV2Capabilities() as any;
    mutate(response);
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(error).not.toHaveProperty("response");
  });

  it("normalizes an arbitrary adapter exactly without language-specific inference", async () => {
    const providerNeutralCapabilities = {
      ...actualSchemaV1Capabilities,
      languageKernel: {
        available: true as const,
        schema: {
          schemaVersion: 1 as const,
          adapters: [
            {
              languageId: "kotlin",
              extensions: ["kt", "kts"],
              backend: "custom-language-kernel-v7",
              runtime: {
                executionMode: "external-process",
                supportsTimeout: true,
                supportsCancellation: true,
                usesWorkspaceOverlay: true,
                recordsProcessProvenance: true,
                limits: {
                  requestTimeoutMillis: 7_500,
                  maxInputBytes: 4_096,
                  maxOutputBytes: 8_192,
                  maxProcesses: 2,
                },
              },
              capabilities: [
                {
                  operation: "inspectModule",
                  stability: "refused",
                  evidence: "none",
                  mutationAuthority: "none",
                  backend: "custom-language-kernel-v7",
                  runtime: {
                    executionMode: "external-process",
                    supportsTimeout: true,
                    supportsCancellation: true,
                    usesWorkspaceOverlay: true,
                    recordsProcessProvenance: true,
                    limits: {
                      requestTimeoutMillis: 7_500,
                      maxInputBytes: 4_096,
                      maxOutputBytes: 8_192,
                      maxProcesses: 2,
                    },
                  },
                  extensions: ["kt", "kts"],
                },
                {
                  operation: "renameModule",
                  stability: "experimental",
                  evidence: "language-server",
                  mutationAuthority: "proposal-only",
                  backend: "kotlin-analysis-server-v2",
                  runtime: {
                    executionMode: "in-process",
                    supportsTimeout: false,
                    supportsCancellation: false,
                    usesWorkspaceOverlay: false,
                    recordsProcessProvenance: false,
                    limits: {
                      requestTimeoutMillis: null,
                      maxInputBytes: 2_048,
                      maxOutputBytes: null,
                      maxProcesses: null,
                    },
                  },
                  extensions: ["kt"],
                },
              ],
            },
          ],
          vocabulary: LANGUAGE_VOCABULARY,
        },
      },
      safety: {
        previewBeforeApply: false,
        snapshotValidation: true,
        transactionRollback: false,
        workspaceScopedWrites: true,
      },
    };
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(structuredClone(providerNeutralCapabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized).toEqual({
      ...providerNeutralCapabilities,
      generalRefactoring: engineGeneralRefactoringAdvertised,
      ...engineSurfaceFields(),
    });
    expect(normalized.languageKernel?.available).toBe(true);
    if (!normalized.languageKernel?.available)
      throw new Error("expected available language kernel");
    const kotlinAdapter = normalized.languageKernel.schema.adapters[0];
    const renameCapability = kotlinAdapter.capabilities[1];
    expect(renameCapability).toMatchObject({
      backend: "kotlin-analysis-server-v2",
      runtime: {
        executionMode: "in-process",
        limits: { maxInputBytes: 2_048 },
      },
      extensions: ["kt"],
    });
    expect(renameCapability.backend).not.toBe(kotlinAdapter.backend);
    expect(renameCapability.runtime).not.toEqual(kotlinAdapter.runtime);
    expect(renameCapability.extensions).not.toEqual(kotlinAdapter.extensions);
    expect(invokeMock.mock.calls).toEqual([
      ["get_refactorkit_engine_capabilities", undefined],
      ["get_refactorkit_capabilities", undefined],
    ]);
  });

  it("clones operation runtime limits and extensions instead of retaining wire references", async () => {
    const response = structuredClone(actualSchemaV1Capabilities);
    const sourceCapability = response.languageKernel.schema.adapters[0].capabilities[0];
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    if (!normalized.languageKernel?.available)
      throw new Error("expected available language kernel");
    const normalizedCapability = normalized.languageKernel.schema.adapters[0].capabilities[0];

    expect(normalizedCapability.runtime).not.toBe(sourceCapability.runtime);
    expect(normalizedCapability.runtime.limits).not.toBe(sourceCapability.runtime.limits);
    expect(normalizedCapability.extensions).not.toBe(sourceCapability.extensions);

    sourceCapability.runtime.limits.requestTimeoutMillis = 1;
    (sourceCapability.extensions as string[]).push("jav");
    expect(normalizedCapability.runtime.limits.requestTimeoutMillis).toBeNull();
    expect(normalizedCapability.extensions).toEqual(["java"]);
  });

  it("normalizes explicit language-kernel unavailability and keeps legacy metadata absent", async () => {
    const unavailable = {
      ...actualSchemaV1Capabilities,
      languageKernel: {
        available: false,
        schema: null,
        reason: "RefactorKit language-kernel capability metadata is unavailable.",
      },
    };
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(unavailable);
    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toEqual({
      ...unavailable,
      generalRefactoring: engineGeneralRefactoringAdvertised,
      ...engineSurfaceFields(),
    });

    const legacy = {
      api: "refactorkit",
      apiVersion: "unknown",
      provider: "refactorkit",
      providerVersion: null,
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
      generalRefactoring: generalRefactoringUnavailable,
    };
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(legacy);
    const normalizedLegacy = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalizedLegacy).toEqual({
      ...legacy,
      generalRefactoring: engineGeneralRefactoringAdvertised,
      ...engineSurfaceFields(),
    });
    expect(normalizedLegacy).not.toHaveProperty("methods");
    expect(normalizedLegacy).not.toHaveProperty("languageKernel");
    expect(normalizedLegacy).not.toHaveProperty("safety");
  });

  it("surfaces the real-engine general refactoring advertisement as authoritative", async () => {
    // generalRefactoring is engine-derived: the engine report drives supported/preview/apply/
    // rollback/discard while the base daemon surface is preserved alongside engine fields.
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));
    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized.generalRefactoring).toEqual(engineGeneralRefactoringAdvertised);
    expect(normalized).toMatchObject(engineSurfaceFields());
    expect(normalized.javaImportExternalClass).toEqual(
      actualSchemaV1Capabilities.javaImportExternalClass,
    );
    expect(invokeMock.mock.calls[0]).toEqual(["get_refactorkit_engine_capabilities", undefined]);
    expect(invokeMock.mock.calls[1]).toEqual(["get_refactorkit_capabilities", undefined]);
  });

  it("surfaces an honest unavailable general refactoring capability when the real engine is not discovered", async () => {
    const capabilities = structuredClone(actualSchemaV1Capabilities) as any;
    delete capabilities.generalRefactoring;
    invokeMock.mockResolvedValueOnce(unavailableEngineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);
    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized.generalRefactoring).toEqual(engineGeneralRefactoringUnavailable);
    expect(invokeMock.mock.calls[0]).toEqual(["get_refactorkit_engine_capabilities", undefined]);
    expect(invokeMock.mock.calls[1]).toEqual(["get_refactorkit_capabilities", undefined]);
  });

  it("preserves a provider's supported subset without adding other operations", async () => {
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((value) => {
        value.operations = ["format-file"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));
    const capabilities = await new TauriRefactorKitAdapter().getCapabilities();
    expect(capabilities.generalRefactoring).toMatchObject({
      supported: true,
      preview: true,
      operations: ["format-file"],
    });
  });

  it.each([
    [
      "invalid operation string",
      (value: any) => {
        value.generalRefactoring.operations = ["rename-class", "bogus-operation"];
      },
    ],
    [
      "duplicate operation",
      (value: any) => {
        value.generalRefactoring.operations = ["rename-class", "rename-class"];
      },
    ],
    [
      "empty operation set when supported",
      (value: any) => {
        value.generalRefactoring.supported = true;
        value.generalRefactoring.operations = [];
      },
    ],
    [
      "bad stability",
      (value: any) => {
        value.generalRefactoring.stability = "unstable";
      },
    ],
    [
      "non-boolean feature flag",
      (value: any) => {
        value.generalRefactoring.preview = "yes";
      },
    ],
  ])("rejects invalid general refactoring capability metadata: %s", async (_case, mutate) => {
    const response = structuredClone(actualSchemaV1Capabilities) as any;
    mutate(response);
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);
    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(error).not.toHaveProperty("response");
  });

  it("preserves explicit false capability flags from an old installation", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce({
      api: "refactorkit",
      apiVersion: "unknown",
      provider: "refactorkit",
      providerVersion: null,
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "experimental",
      },
    });
    await expect(new TauriRefactorKitAdapter().getCapabilities()).resolves.toMatchObject({
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
      },
    });
  });

  it.each([
    [
      "missing backend",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].backend;
      },
    ],
    [
      "missing runtime",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].runtime;
      },
    ],
    [
      "missing extensions",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].extensions;
      },
    ],
    [
      "extra operation field",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].inferred = true;
      },
    ],
    [
      "wrong backend type",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = 7;
      },
    ],
    [
      "wrong runtime type",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime = "in-process";
      },
    ],
    [
      "wrong extensions type",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = "java";
      },
    ],
    [
      "empty backend",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = "";
      },
    ],
    [
      "control character in backend",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = "jdt\u0000private";
      },
    ],
    [
      "UTF-8 backend bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].backend = "é".repeat(129);
      },
    ],
    [
      "non-canonical extension",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = [".java"];
      },
    ],
    [
      "duplicate extension",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = ["java", "java"];
      },
    ],
    [
      "empty extensions",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = [];
      },
    ],
    [
      "operation extension bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].extensions = Array.from(
          { length: 65 },
          (_, index) => `x${index}`,
        );
      },
    ],
    [
      "missing runtime field",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].runtime.supportsCancellation;
      },
    ],
    [
      "extra runtime field",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.threadCount = 1;
      },
    ],
    [
      "wrong runtime boolean",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.supportsCancellation = "no";
      },
    ],
    [
      "missing runtime limit",
      (value: any) => {
        delete value.languageKernel.schema.adapters[0].capabilities[0].runtime.limits.maxInputBytes;
      },
    ],
    [
      "extra runtime limit",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.limits.maxThreads = 1;
      },
    ],
    [
      "wrong runtime limit",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.limits.maxInputBytes =
          "4096";
      },
    ],
    [
      "incoherent in-process provenance",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].runtime.recordsProcessProvenance = true;
      },
    ],
    [
      "incoherent timeout limit",
      (value: any) => {
        value.languageKernel.schema.adapters[1].capabilities[0].runtime.limits.requestTimeoutMillis =
          null;
      },
    ],
  ])("rejects strict operation metadata: %s", async (_name, mutate) => {
    const response = structuredClone(actualSchemaV1Capabilities) as any;
    const source = "private operation metadata must stay redacted";
    mutate(response);
    response.source = source;
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(String(error)).not.toContain(source);
    expect(JSON.stringify(error)).not.toContain(source);
  });

  it.each([
    [
      "adapter bound",
      (value: any) =>
        value.languageKernel.schema.adapters.push(
          ...Array.from({ length: 62 }, (_, index) => ({
            ...structuredClone(value.languageKernel.schema.adapters[0]),
            languageId: `extra-${index}`,
            extensions: [`x${index}`],
          })),
        ),
    ],
    [
      "extension bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].extensions = Array.from(
          { length: 65 },
          (_, index) => `x${index}`,
        );
      },
    ],
    [
      "capability bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities = Array.from(
          { length: 513 },
          (_, index) => ({
            operation: `operation-${index}`,
            stability: "stable",
            evidence: "compiler",
            mutationAuthority: "none",
            backend: "eclipse-jdt-3.44",
            runtime: structuredClone(JAVA_RUNTIME),
            extensions: ["java"],
          }),
        );
      },
    ],
    [
      "UTF-8 backend bound",
      (value: any) => {
        value.languageKernel.schema.adapters[0].backend = "é".repeat(129);
      },
    ],
    [
      "non-canonical language ID",
      (value: any) => {
        value.languageKernel.schema.adapters[0].languageId = "TypeScript";
      },
    ],
    [
      "duplicate language ID",
      (value: any) => {
        value.languageKernel.schema.adapters[1].languageId = "java";
      },
    ],
    [
      "non-canonical extension",
      (value: any) => {
        value.languageKernel.schema.adapters[0].extensions = [".java"];
      },
    ],
    [
      "duplicate extension within an adapter",
      (value: any) => {
        value.languageKernel.schema.adapters[0].extensions = ["java", "java"];
      },
    ],
    [
      "ambiguous extension across adapters",
      (value: any) => {
        value.languageKernel.schema.adapters[1].extensions = ["java"];
      },
    ],
    [
      "duplicate operation",
      (value: any) =>
        value.languageKernel.schema.adapters[1].capabilities.push(
          structuredClone(value.languageKernel.schema.adapters[1].capabilities[0]),
        ),
    ],
    [
      "wrong schema version",
      (value: any) => {
        value.languageKernel.schema.schemaVersion = 2;
      },
    ],
    [
      "reordered vocabulary",
      (value: any) => {
        value.languageKernel.schema.vocabulary.stability.reverse();
      },
    ],
    [
      "unknown stability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].stability = "beta";
      },
    ],
    [
      "unknown evidence",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].evidence = "guess";
      },
    ],
    [
      "unknown mutation authority",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].mutationAuthority = "direct";
      },
    ],
    [
      "managed-stable experimental capability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[0].mutationAuthority =
          "managed-stable";
      },
    ],
    [
      "managed-stable lexical capability",
      (value: any) => {
        value.languageKernel.schema.adapters[0].capabilities[5].evidence = "lexical";
      },
    ],
    [
      "unknown execution mode",
      (value: any) => {
        value.languageKernel.schema.adapters[0].runtime.executionMode = "worker";
      },
    ],
    [
      "in-process process provenance",
      (value: any) => {
        value.languageKernel.schema.adapters[0].runtime.recordsProcessProvenance = true;
      },
    ],
    [
      "in-process workspace overlay",
      (value: any) => {
        value.languageKernel.schema.adapters[0].runtime.usesWorkspaceOverlay = true;
      },
    ],
    [
      "timeout without timeout limit",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.requestTimeoutMillis = null;
      },
    ],
    [
      "timeout above bound",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.requestTimeoutMillis = 300_001;
      },
    ],
    [
      "input bytes above bound",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.maxInputBytes = 4 * 1024 ** 3 + 1;
      },
    ],
    [
      "processes above bound",
      (value: any) => {
        value.languageKernel.schema.adapters[1].runtime.limits.maxProcesses = 65;
      },
    ],
    [
      "unavailable schema attached",
      (value: any) => {
        value.languageKernel = {
          available: false,
          schema: value.languageKernel.schema,
          reason: "unavailable",
        };
      },
    ],
    [
      "safety flag missing",
      (value: any) => {
        delete value.safety.snapshotValidation;
      },
    ],
    [
      "safety flag not boolean",
      (value: any) => {
        value.safety.transactionRollback = "yes";
      },
    ],
    [
      "extra safety claim",
      (value: any) => {
        value.safety.diagnosticsGate = true;
      },
    ],
    [
      "extra adapter field",
      (value: any) => {
        value.languageKernel.schema.adapters[0].semanticCommands = ["rename"];
      },
    ],
  ])("fails closed with a redacted language-kernel protocol error: %s", async (_name, mutate) => {
    const response = structuredClone(actualSchemaV1Capabilities) as any;
    const source = "private backend source must stay redacted";
    mutate(response);
    response.source = source;
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
      cause: undefined,
    });
    expect(error).not.toHaveProperty("response");
    expect(error).not.toHaveProperty("source");
    expect(String(error)).not.toContain(source);
    expect(JSON.stringify(error)).not.toContain(source);
  });

  it("rejects incomplete capability mappings with a redacted protocol error", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce({
      api: "refactorkit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.5.0-SNAPSHOT",
      javaImportExternalClass: {
        supported: true,
        targetDirectory: true,
        preview: true,
        apply: true,
        // rollback is deliberately absent
        stability: "experimental",
        backendSource: previewRequest.code,
      },
    });
    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ command: "get_refactorkit_capabilities", cause: undefined });
    expect(JSON.stringify(error)).not.toContain(previewRequest.code);
  });

  it.each(["ready", "refused", "stale", "error"])("normalizes a future %s plan", async (status) => {
    const response = {
      ...plan,
      status,
      refusalReasons: status === "ready" ? [] : [`${status} reason`],
      applyEligibility: {
        eligible: status === "ready",
        blockers: status === "ready" ? [] : ["blocked"],
      },
      staleness: {
        stale: status === "stale",
        reasons: status === "stale" ? ["workspace changed"] : [],
      },
    };
    invokeMock.mockResolvedValueOnce(response);
    await expect(
      new TauriRefactorKitAdapter().previewExternalJavaImport(previewRequest),
    ).resolves.toEqual(response);
    expect(invokeMock).toHaveBeenCalledWith("preview_refactorkit_external_java_import", {
      request: previewRequest,
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.targetPackage");
  });

  it("sends exact apply, discard, and rollback requests without source fields", async () => {
    const adapter = new TauriRefactorKitAdapter();
    const applyRequest = {
      planId: "plan-1",
      workspaceId: "workspace:1",
      workspaceGeneration: 7,
      selectionGeneration: 9,
      requestId: "apply-1",
      approval: {
        approvalId: "approval-1",
        approvedPlanId: "plan-1",
        approvedAt: "2026-07-12T12:34:56.123Z",
      },
    };
    const applyResult = {
      transactionId: "transaction-1",
      planId: "plan-1",
      changedFiles: plan.affectedFiles,
      primaryFile: "src/main/java/example/Widget.java",
      diagnostics: [],
      provider: "refactorkit",
      providerVersion: "2.0.0",
    };
    invokeMock.mockResolvedValueOnce(applyResult);
    await expect(adapter.applyPlan(applyRequest)).resolves.toEqual(applyResult);
    expect(invokeMock).toHaveBeenLastCalledWith("apply_refactorkit_plan", {
      request: applyRequest,
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.code");
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("request.source");

    const discardRequest = {
      planId: "plan-2",
      workspaceId: "workspace:1",
      workspaceGeneration: 7,
      selectionGeneration: 9,
      requestId: "discard-1",
    };
    invokeMock.mockResolvedValueOnce({ planId: "plan-2", discarded: true });
    await expect(adapter.discardPlan(discardRequest)).resolves.toEqual({
      planId: "plan-2",
      discarded: true,
    });
    expect(invokeMock).toHaveBeenLastCalledWith("discard_refactorkit_plan", {
      request: discardRequest,
    });

    const rollbackRequest = {
      transactionId: "transaction-1",
      workspaceId: "workspace:1",
      workspaceGeneration: 7,
      requestId: "rollback-1",
    };
    const rollbackResult = {
      transactionId: "transaction-1",
      rolledBack: true,
      changedFiles: plan.affectedFiles,
      diagnostics: [],
    };
    invokeMock.mockResolvedValueOnce(rollbackResult);
    await expect(adapter.rollbackTransaction(rollbackRequest)).resolves.toEqual(rollbackResult);
    expect(invokeMock).toHaveBeenLastCalledWith("rollback_refactorkit_transaction", {
      request: rollbackRequest,
    });
    expect(invokeMock.mock.calls[2]?.[1]).not.toHaveProperty("request.force");
    for (const [, args] of invokeMock.mock.calls.slice(0, 3)) {
      expect(args).not.toHaveProperty("request.source");
      expect(args).not.toHaveProperty("request.code");
      expect(args).not.toHaveProperty("request.targetPackage");
    }
  });

  it("defensively rejects a mismatched discard result without retaining its payload", async () => {
    invokeMock.mockResolvedValueOnce({
      planId: "other-plan",
      discarded: true,
      source: previewRequest.code,
    });
    const error = await new TauriRefactorKitAdapter()
      .discardPlan({
        planId: "plan-1",
        workspaceId: "workspace:1",
        workspaceGeneration: 7,
        selectionGeneration: 9,
        requestId: "discard-1",
      })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ command: "discard_refactorkit_plan", cause: undefined });
    expect(String(error)).not.toContain(previewRequest.code);
  });

  it.each([
    ["traversal", { affectedFiles: [{ change: "create", path: "../Secret.java", primary: true }] }],
    [
      "absolute path",
      { affectedFiles: [{ change: "create", path: "/tmp/Secret.java", primary: true }] },
    ],
    ["bad confidence", { confidence: 1.1 }],
    [
      "zero diagnostic line",
      { diagnosticsAfterPreview: [{ severity: "error", message: "bad", line: 0 }] },
    ],
    ["oversized diff", { renderedDiff: "x".repeat(2 * 1024 * 1024 + 1) }],
  ])("rejects malformed future plan: %s", async (_name, override) => {
    const secret = "class BackendSecret {}";
    const response = { ...plan, ...override, backendSource: secret };
    invokeMock.mockResolvedValueOnce(response);
    const error = await new TauriRefactorKitAdapter()
      .previewExternalJavaImport(previewRequest)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "preview_refactorkit_external_java_import",
      cause: undefined,
    });
    expect(String(error)).not.toContain(secret);
  });

  it.each([
    [
      "preview refused",
      "preview_refactorkit_external_java_import",
      "REFACTORKIT_PREVIEW_REFUSED",
      "request rejected",
    ],
    [
      "preview failure",
      "preview_refactorkit_external_java_import",
      "REFACTORKIT_PREVIEW_FAILED",
      "session failed",
    ],
    [
      "apply stale",
      "apply_refactorkit_plan",
      "REFACTORKIT_APPLY_STALE",
      "plan is stale or unknown",
    ],
    ["apply refused", "apply_refactorkit_plan", "REFACTORKIT_APPLY_REFUSED", "approval rejected"],
    ["apply failure", "apply_refactorkit_plan", "REFACTORKIT_APPLY_FAILED", "session failed"],
    ["discard failure", "discard_refactorkit_plan", "REFACTORKIT_DISCARD_FAILED", "session failed"],
    [
      "rollback conflict",
      "rollback_refactorkit_transaction",
      "REFACTORKIT_ROLLBACK_CONFLICT",
      "rollback conflict",
    ],
    [
      "rollback failure",
      "rollback_refactorkit_transaction",
      "REFACTORKIT_ROLLBACK_FAILED",
      "session failed",
    ],
  ])("redacts a source-echoing %s", async (_name, command, code, nativeMessage) => {
    invokeMock.mockRejectedValueOnce(`${nativeMessage}: ${previewRequest.code}`);
    const adapter = new TauriRefactorKitAdapter();
    const requestByCommand: Record<string, () => Promise<unknown>> = {
      preview_refactorkit_external_java_import: () =>
        adapter.previewExternalJavaImport(previewRequest),
      apply_refactorkit_plan: () =>
        adapter.applyPlan({
          planId: "plan-1",
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
          selectionGeneration: 9,
          requestId: "apply-1",
          approval: {
            approvalId: "approval-1",
            approvedPlanId: "plan-1",
            approvedAt: "2026-07-12T12:34:56Z",
          },
        }),
      discard_refactorkit_plan: () =>
        adapter.discardPlan({
          planId: "plan-1",
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
          selectionGeneration: 9,
          requestId: "discard-1",
        }),
      rollback_refactorkit_transaction: () =>
        adapter.rollbackTransaction({
          transactionId: "transaction-1",
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
          requestId: "rollback-1",
        }),
    };
    const error = await requestByCommand[command]().catch((value: unknown) => value);
    expect(error).toMatchObject({ code, command, cause: undefined });
    expect(String(error)).not.toContain(previewRequest.code);
    expect(JSON.stringify(error)).not.toContain(previewRequest.code);
  });

  it("maps a capability command failure to a static error without attaching or logging private detail", async () => {
    const privateValues = [
      previewRequest.code,
      "private-diagnostic-sentinel",
      "private-response-payload-sentinel",
      "private-response-id-sentinel",
      "private-native-detail-sentinel",
    ];
    const loggingSpies = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
    ];
    invokeMock.mockRejectedValueOnce({
      message: `unsupported: ${privateValues.at(-1)}`,
      source: privateValues[0],
      diagnostics: [privateValues[1]],
      response: { payload: privateValues[2], id: privateValues[3] },
    });

    try {
      const error = await new TauriRefactorKitAdapter()
        .getCapabilities()
        .catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "REFACTORKIT_UPDATE_REQUIRED", cause: undefined });
      expect(error).not.toHaveProperty("response");
      expect(String(error)).toContain("updated managed backend");
      for (const privateValue of privateValues) {
        expect(String(error)).not.toContain(privateValue);
        expect(JSON.stringify(error)).not.toContain(privateValue);
      }
      for (const loggingSpy of loggingSpies) expect(loggingSpy).not.toHaveBeenCalled();
    } finally {
      for (const loggingSpy of loggingSpies) loggingSpy.mockRestore();
    }
  });
});

describe("TauriRefactorKitAdapter general refactoring capability-before-offer gate", () => {
  it.each(["java-project-context-v6", "java-project-context-v7"] as const)(
    "normalizes saved-plan attestations for %s",
    (contextSchemaVersion) => {
      const projectContext = {
        projectPath: "",
        contextHash: "b".repeat(64),
        contextSchemaVersion,
        platformIdentities: ["c".repeat(64)],
      };
      const result = normalizeRefactorPreview("preview_refactorkit_engine_refactoring", {
        planId: "plan-v7",
        operation: "rename-class",
        target: {
          kind: "class",
          path: "src/main/java/example/Widget.java",
          identity: "example.Widget",
        },
        status: "ready",
        summary: "Rename Widget",
        confidence: 1,
        riskLevel: "low",
        risks: [],
        evidence: [],
        affectedFiles: [],
        renderedDiff: "",
        structuredDiff: [],
        warnings: [],
        diagnosticsAfterPreview: [],
        conflicts: [],
        refusalReasons: [],
        applyEligibility: { eligible: true, blockers: [] },
        staleness: { stale: false, reasons: [] },
        grantsApplyAuthority: false,
        authority: { workspaceId: "workspace:1", workspaceGeneration: 7 },
        selectionGeneration: 9,
        requestId: "preview-v7",
        provider: "refactorkit",
        providerVersion: "0.8.0",
        projectContext,
      });

      expect(result.projectContext).toEqual(projectContext);
    },
  );

  it("preserves incomplete typed JPQL references and rejects managed Apply eligibility", async () => {
    const request = {
      ...previewRefactorRequest,
      operation: "rename-member" as const,
      target: {
        kind: "member" as const,
        path: "maven/src/main/java/com/example/User.java",
        identity: "com.example.User#amount",
      },
      changeIntent: { operation: "rename-member" as const, newName: "total" },
      projectContext: {
        projectPath: "maven",
        sdkHome: "/jdk",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        contextSchemaVersion: "java-project-context-v1" as const,
        snapshotHash: "a".repeat(64),
        contextHash: "b".repeat(64),
        platformIdentities: ["c".repeat(64)],
      },
    };
    const capabilities = advertisedCapabilities();
    capabilities.javaContextRefactoring = {
      schemaVersion: 1,
      operations: ["renameMember"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
    };
    capabilities.methods = [
      {
        name: "project.context",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "refactor.preview", stability: "stable", requiresProject: true, writesWorkspace: false },
      { name: "refactor.apply", stability: "stable", requiresProject: true, writesWorkspace: true },
    ];
    const response = {
      planId: "plan-jpql-1",
      operation: "rename-member",
      target: request.target,
      status: "ready",
      summary: "Rename User.amount and the detected JPQL property paths",
      confidence: 0.95,
      riskLevel: "high",
      risks: [],
      evidence: [],
      affectedFiles: [
        { change: "edit", path: "maven/src/main/java/com/example/User.java", primary: true },
        {
          change: "edit",
          path: "maven/src/main/java/com/example/UserRepository.java",
          primary: false,
        },
      ],
      renderedDiff: "--- a/UserRepository.java\n+++ b/UserRepository.java\n",
      structuredDiff: [],
      warnings: [],
      diagnosticsAfterPreview: [],
      conflicts: [],
      refusalReasons: [],
      applyEligibility: {
        eligible: false,
        blockers: ["The provider reports incomplete typed reference analysis; managed Apply is unavailable."],
      },
      staleness: { stale: false, reasons: [] },
      grantsApplyAuthority: false,
      authority: request.authority,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
      provider: "refactorkit-java",
      providerVersion: "0.7.0",
      diffTruncated: false,
      diffTruncationReasons: [],
      projectContext: {
        projectPath: "maven",
        contextHash: request.projectContext.contextHash,
        contextSchemaVersion: "java-project-context-v1",
        platformIdentities: request.projectContext.platformIdentities,
      },
      referenceAnalysis: {
        schemaVersion: "refactorkit-reference-analysis-v1",
        scope: "java-spring-data-jpql-static-property-path-v1",
        completeness: "INCOMPLETE",
        completeProject: false,
        managedWriteAuthority: "none",
        warnings: ["Only direct static Spring Data @Query JPQL property paths are inspected."],
        references: [
          {
            languageId: "java",
            kind: "framework.entity-property",
            targetOwner: "com.example.User",
            targetMember: "amount",
            resourceKind: "java.annotation-string",
            provenance: "spring-data.query-jpql",
            completeness: "COMPLETE",
            location: {
              path: "maven/src/main/java/com/example/UserRepository.java",
              range: {
                start: { line: 2, character: 74 },
                end: { line: 2, character: 80 },
              },
            },
          },
        ],
      },
    };

    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);
    invokeMock.mockResolvedValueOnce(response);
    const result = await new TauriRefactorKitAdapter().previewRefactoring(request);
    expect(result.referenceAnalysis).toMatchObject({
      schemaVersion: "refactorkit-reference-analysis-v1",
      completeness: "INCOMPLETE",
      completeProject: false,
      managedWriteAuthority: "none",
      references: [
        {
          kind: "framework.entity-property",
          targetMember: "amount",
          provenance: "spring-data.query-jpql",
        },
      ],
    });
    expect(result.applyEligibility.eligible).toBe(false);

    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);
    invokeMock.mockResolvedValueOnce({
      ...response,
      applyEligibility: { eligible: true, blockers: [] },
    });
    await expect(new TauriRefactorKitAdapter().previewRefactoring(request)).rejects.toThrow(
      "incomplete typed reference analysis cannot advertise managed Apply",
    );

    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);
    invokeMock.mockResolvedValueOnce({
      ...response,
      applyEligibility: { eligible: true, blockers: [] },
      referenceAnalysis: {
        ...response.referenceAnalysis,
        completeProject: true,
        completeness: "COMPLETE",
        managedWriteAuthority: "managed-stable",
        references: [{ ...response.referenceAnalysis.references[0], completeness: "UNRESOLVED" }],
      },
    });
    await expect(new TauriRefactorKitAdapter().previewRefactoring(request)).rejects.toThrow(
      "incomplete typed reference analysis cannot advertise managed Apply",
    );
  });

  const previewRefactorRequest = {
    operation: "rename-class" as const,
    target: {
      kind: "class" as const,
      path: "src/main/java/example/Widget.java",
      identity: "example.Widget",
    },
    authority: { workspaceId: "workspace:1", workspaceGeneration: 7 },
    selectionGeneration: 9,
    requestId: "preview-r1",
    // RQR-RFK-ENGINE-001: rename-class requires an operation-specific changeIntent;
    // the wire carries it in camelCase (never an empty change descriptor).
    changeIntent: { operation: "rename-class", newName: "WidgetV2" } as const,
  };
  const applyRefactorRequest = {
    planId: "plan-g-1",
    operation: "rename-class" as const,
    target: {
      kind: "class" as const,
      path: "src/main/java/example/Widget.java",
      identity: "example.Widget",
    },
    authority: { workspaceId: "workspace:1", workspaceGeneration: 7 },
    selectionGeneration: 9,
    requestId: "apply-r1",
    approval: {
      approvalId: "approval-g-1",
      approvedPlanId: "plan-g-1",
      approvedAt: "2026-07-12T12:34:56.123Z",
    },
    // RQR-RFK-ENGINE-001: rename-class requires an operation-specific changeIntent;
    // the wire carries it in camelCase (never an empty change descriptor).
    changeIntent: { operation: "rename-class", newName: "WidgetV2" } as const,
  };
  const rollbackRefactorRequest = {
    transactionId: "transaction-g-1",
    operation: "rename-class" as const,
    authority: { workspaceId: "workspace:1", workspaceGeneration: 7 },
    requestId: "rollback-r1",
  };
  const discardRefactorRequest = {
    planId: "plan-g-2",
    workspaceId: "workspace:1",
    workspaceGeneration: 7,
    selectionGeneration: 9,
    requestId: "discard-r1",
  };

  const gatingCommands = [
    {
      name: "previewRefactoring",
      command: "preview_refactorkit_engine_refactoring",
      feature: "preview" as const,
      operation: "rename-class" as const,
      engineFeatureOff: () =>
        engineCapabilitiesWire((record) => {
          record.previewReadOnly = false;
        }),
      invoke: (adapter: TauriRefactorKitAdapter) =>
        adapter.previewRefactoring(previewRefactorRequest),
      wire: {
        operation: "rename-class",
        target: previewRefactorRequest.target,
        changeIntent: { operation: "rename-class", newName: "WidgetV2" },
        authority: previewRefactorRequest.authority,
        selectionGeneration: 9,
        requestId: "preview-r1",
      },
      result: {
        planId: "plan-g-1",
        operation: "rename-class",
        target: {
          kind: "class",
          path: "src/main/java/example/Widget.java",
          identity: "example.Widget",
        },
        status: "ready",
        summary: "Rename Widget to WidgetV2",
        confidence: 0.9,
        riskLevel: "low",
        risks: [],
        evidence: [{ kind: "semantic", summary: "target resolved" }],
        affectedFiles: [
          { change: "edit", path: "src/main/java/example/Widget.java", primary: true },
        ],
        renderedDiff: "--- a/Widget.java\n+++ b/Widget.java",
        structuredDiff: [
          {
            path: "src/main/java/example/Widget.java",
            change: "edit",
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ["-class Widget", "+class WidgetV2"],
              },
            ],
          },
        ],
        warnings: [],
        diagnosticsAfterPreview: [],
        conflicts: [],
        refusalReasons: [],
        applyEligibility: { eligible: true, blockers: [] },
        staleness: { stale: false, reasons: [] },
        grantsApplyAuthority: false,
        authority: { workspaceId: "workspace:1", workspaceGeneration: 7 },
        selectionGeneration: 9,
        requestId: "preview-r1",
        provider: "refactorkit",
        providerVersion: "0.5.0-SNAPSHOT",
      },
    },
    {
      name: "applyRefactoring",
      command: "apply_refactorkit_engine_refactoring",
      feature: "apply" as const,
      operation: "rename-class" as const,
      engineFeatureOff: () => unavailableEngineCapabilitiesWire(),
      invoke: (adapter: TauriRefactorKitAdapter) => adapter.applyRefactoring(applyRefactorRequest),
      wire: {
        planId: "plan-g-1",
        operation: "rename-class",
        target: applyRefactorRequest.target,
        changeIntent: { operation: "rename-class", newName: "WidgetV2" },
        authority: applyRefactorRequest.authority,
        selectionGeneration: 9,
        requestId: "apply-r1",
        approval: {
          approvalId: "approval-g-1",
          approvedPlanId: "plan-g-1",
          approvedAt: "2026-07-12T12:34:56.123Z",
        },
      },
      result: {
        planId: "plan-g-1",
        operation: "rename-class",
        outcome: "applied",
        changedFiles: [
          { change: "edit", path: "src/main/java/example/Widget.java", primary: true },
        ],
        primaryFile: "src/main/java/example/Widget.java",
        diagnostics: [],
        transactionId: "transaction-g-1",
        provider: "refactorkit",
        providerVersion: "0.5.0-SNAPSHOT",
      },
    },
    {
      name: "rollbackRefactoring",
      command: "rollback_refactorkit_engine_refactoring",
      feature: "rollback" as const,
      operation: "rename-class" as const,
      engineFeatureOff: () =>
        engineCapabilitiesWire((record) => {
          record.rollbackAdvertised = false;
        }),
      invoke: (adapter: TauriRefactorKitAdapter) =>
        adapter.rollbackRefactoring(rollbackRefactorRequest),
      wire: {
        transactionId: "transaction-g-1",
        operation: "rename-class",
        authority: rollbackRefactorRequest.authority,
        requestId: "rollback-r1",
      },
      result: {
        transactionId: "transaction-g-1",
        rolledBack: true,
        changedFiles: [
          { change: "edit", path: "src/main/java/example/Widget.java", primary: true },
        ],
        conflicts: [],
        diagnostics: [],
      },
    },
    {
      name: "discardRefactoring",
      command: "discard_refactorkit_engine_refactoring",
      feature: "discard" as const,
      operation: undefined as string | undefined,
      engineFeatureOff: () => unavailableEngineCapabilitiesWire(),
      invoke: (adapter: TauriRefactorKitAdapter) =>
        adapter.discardRefactoring(discardRefactorRequest),
      wire: {
        planId: "plan-g-2",
        authority: {
          workspaceId: "workspace:1",
          workspaceGeneration: 7,
        },
        selectionGeneration: 9,
        requestId: "discard-r1",
      },
      result: { planId: "plan-g-2", discarded: true },
    },
  ];

  beforeEach(() => invokeMock.mockReset());

  function advertisedCapabilities(overrides: (general: any) => void = () => undefined): any {
    const capabilities = structuredClone(actualSchemaV1Capabilities) as any;
    const general = capabilities.generalRefactoring;
    general.supported = true;
    general.operations = [...GENERAL_REFACTORING_OPERATIONS];
    general.preview = true;
    general.apply = true;
    general.rollback = true;
    general.discard = true;
    overrides(general);
    return capabilities;
  }

  it.each(["format-file", "organize-imports"] as const)(
    "refuses %s when an older engine advertises only semantic operations",
    async (operation) => {
      invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
      invokeMock.mockResolvedValueOnce(advertisedCapabilities());
      const error = await new TauriRefactorKitAdapter()
        .previewRefactoring({
          operation,
          target: {
            kind: "file",
            path: "src/main/java/example/Widget.java",
            identity: "src/main/java/example/Widget.java",
          },
          authority: previewRefactorRequest.authority,
          selectionGeneration: 9,
          requestId: "file-preview-unavailable",
        })
        .catch((value: unknown) => value);
      expect(error).toMatchObject({
        name: "TauriAdapterError",
        command: "preview_refactorkit_engine_refactoring",
        cause: undefined,
      });
      expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
        "get_refactorkit_engine_capabilities",
        "get_refactorkit_capabilities",
      ]);
    },
  );

  it.each(gatingCommands)(
    "refuses $name and does not invoke $command when general refactoring is unsupported",
    async ({ command, invoke }) => {
      // getCapabilities() fetches the engine report first; when the engine is not
      // discovered the merged generalRefactoring is honestly unsupported and the gate
      // throws before any refactoring command is invoked.
      invokeMock.mockResolvedValueOnce(unavailableEngineCapabilitiesWire());
      invokeMock.mockResolvedValueOnce(advertisedCapabilities());
      const error = await invoke(new TauriRefactorKitAdapter()).catch((value: unknown) => value);
      expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: undefined });
      expect(invokeMock).not.toHaveBeenCalledWith(command, expect.anything());
    },
  );

  it.each(gatingCommands)(
    "refuses $name when its $feature feature flag is not advertised",
    async ({ command, invoke, engineFeatureOff }) => {
      // The feature flag is engine-derived: preview follows previewReadOnly, rollback
      // follows rollbackAdvertised, and apply/discard follow supported. Each command's
      // engineFeatureOff wire makes its own feature honest-unavailable.
      invokeMock.mockResolvedValueOnce(engineFeatureOff());
      invokeMock.mockResolvedValueOnce(advertisedCapabilities());
      const error = await invoke(new TauriRefactorKitAdapter()).catch((value: unknown) => value);
      expect(error).toMatchObject({ name: "TauriAdapterError", command, cause: undefined });
      expect(invokeMock).not.toHaveBeenCalledWith(command, expect.anything());
    },
  );

  it.each(gatingCommands)(
    "invokes $command after the advertised general refactoring capability passes the gate",
    async ({ command, wire, result, invoke }) => {
      invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
      invokeMock.mockResolvedValueOnce(advertisedCapabilities());
      invokeMock.mockResolvedValueOnce(result);
      await expect(invoke(new TauriRefactorKitAdapter())).resolves.toEqual(result);
      expect(invokeMock.mock.calls[0]).toEqual(["get_refactorkit_engine_capabilities", undefined]);
      expect(invokeMock.mock.calls[1]).toEqual(["get_refactorkit_capabilities", undefined]);
      expect(invokeMock.mock.calls[2]).toEqual([command, { request: wire }]);
    },
  );

  it("explains a saved-context preview attestation failure without exposing provider details", async () => {
    const privatePath = "/private/workspace/project";
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      `RefactorKit did not return a managed plan for the selected saved Java context: ${privatePath}`,
    );

    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(previewRefactorRequest)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriRefactorKitManagedCommandError",
      code: "REFACTORKIT_PREVIEW_CONTEXT_UNATTESTED",
      command: "preview_refactorkit_engine_refactoring",
      cause: undefined,
    });
    expect(String(error)).toContain("current saved Java project context");
    expect(String(error)).not.toContain(privatePath);
  });

  it("sends Remove Parameter through the advertised saved-project route with explicit intent", async () => {
    const capabilities = structuredClone(actualSchemaV1Capabilities) as any;
    capabilities.javaContextRefactoring = {
      schemaVersion: 1,
      operations: ["changeSignature.removeParameter"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    };
    capabilities.methods = [
      {
        name: "project.context",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      {
        name: "intelligence.query",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
      },
      {
        name: "refactor.preview",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: false,
      },
      {
        name: "refactor.apply",
        stability: "stable",
        requiresProject: true,
        writesWorkspace: true,
      },
    ];
    const javaAdapter = capabilities.languageKernel.schema.adapters.find(
      (adapter: any) => adapter.languageId === "java",
    );
    const removeParameter = javaAdapter.capabilities.find(
      (entry: any) => entry.operation === "changeSignature.removeParameter",
    );
    Object.assign(removeParameter, {
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    });
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(capabilities);
    invokeMock.mockRejectedValueOnce(
      "[tauri:preview_refactorkit_engine_refactoring] RefactorKit refused this Java operation. The selected parameter is used in the method body. No source changes were made.",
    );

    const request = {
      ...previewRefactorRequest,
      operation: "remove-method-parameter" as const,
      target: {
        kind: "member" as const,
        path: "src/main/java/example/Widget.java",
        identity: "@cursor",
        selection: { start: 17, end: 17 },
      },
      changeIntent: { operation: "remove-method-parameter" as const, parameterName: "unused" },
      projectContext: {
        projectPath: "",
        sdkHome: "/jdk",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        contextSchemaVersion: "java-project-context-v1" as const,
        snapshotHash: "a".repeat(64),
        contextHash: "b".repeat(64),
        platformIdentities: ["c".repeat(64)],
      },
    };
    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(request)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "REFACTORKIT_PREVIEW_REFUSED",
      command: "preview_refactorkit_engine_refactoring",
    });
    expect(invokeMock.mock.calls[2]).toEqual([
      "preview_refactorkit_engine_refactoring",
      {
        request: {
          operation: "remove-method-parameter",
          target: request.target,
          authority: request.authority,
          selectionGeneration: request.selectionGeneration,
          requestId: request.requestId,
          changeIntent: request.changeIntent,
          projectContext: request.projectContext,
        },
      },
    ]);
    expect(String(error)).toContain("used in the method body");
    expect(String(error)).toContain("No source changes were made");
  });

  it("explains a stale Java project snapshot and asks for synchronization", async () => {
    const privatePath = "/private/workspace/project";
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      `Project inputs changed; synchronize and preview again: ${privatePath}`,
    );

    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(previewRefactorRequest)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriRefactorKitManagedCommandError",
      code: "REFACTORKIT_PREVIEW_STALE_CONTEXT",
      command: "preview_refactorkit_engine_refactoring",
      cause: undefined,
    });
    expect(String(error)).toContain("Synchronize the project and preview again");
    expect(String(error)).not.toContain(privatePath);
  });

  it("preserves the safe constructor-selection limitation without implying a new plan", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      "[tauri:preview_refactorkit_engine_refactoring] RefactorKit refused this Java operation. The provider does not support constructor targets through this saved-cursor route. No refactoring plan was created. No source changes were made.",
    );
    const error = await new TauriRefactorKitAdapter().previewRefactoring(previewRefactorRequest).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "REFACTORKIT_PREVIEW_REFUSED", cause: undefined });
    expect(String(error)).toContain("does not support constructor targets through this saved-cursor route");
    expect(String(error)).toContain("No refactoring plan was created");
  });

  it("shows a bounded safe provider reason for a refused Java preview", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      "[tauri:preview_refactorkit_engine_refactoring] RefactorKit refused this Java operation. changeSignature.reorderParameters refuses public method or protected method until external-consumer risk and hierarchy evidence are complete. No source changes were made.",
    );

    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(previewRefactorRequest)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriRefactorKitManagedCommandError",
      code: "REFACTORKIT_PREVIEW_REFUSED",
      command: "preview_refactorkit_engine_refactoring",
      cause: undefined,
    });
    expect(String(error)).toContain("public method or protected method");
    expect(String(error)).toContain("external-consumer risk and hierarchy evidence");
    expect(String(error)).toContain("No source changes were made");
  });

  it("shows a safe provider refusal reason when the daemon includes its JSON-RPC code", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      "[tauri:preview_refactorkit_engine_refactoring] RefactorKit refused this Java operation (JSON-RPC error -32013). The selected statements have unsupported control flow. No source changes were made.",
    );

    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(previewRefactorRequest)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriRefactorKitManagedCommandError",
      code: "REFACTORKIT_PREVIEW_REFUSED",
      command: "preview_refactorkit_engine_refactoring",
      cause: undefined,
    });
    expect(String(error)).toContain("unsupported control flow");
    expect(String(error)).toContain("No source changes were made");
  });

  it("continues to parse provider refusals from daemons using the retry suffix", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      "[tauri:preview_refactorkit_engine_refactoring] RefactorKit refused this Java operation. Provider cannot prove the requested binding. Synchronize and review a new plan.",
    );

    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(previewRefactorRequest)
      .catch((value: unknown) => value);

    expect(String(error)).toContain("Provider cannot prove the requested binding");
    expect(String(error)).toContain("No source changes were made");
  });

  it("does not show path-bearing Java preview refusal details", async () => {
    const privatePath = "/private/workspace/project";
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(advertisedCapabilities());
    invokeMock.mockRejectedValueOnce(
      `RefactorKit refused this Java operation. The target is in ${privatePath}. Synchronize and review a new plan.`,
    );

    const error = await new TauriRefactorKitAdapter()
      .previewRefactoring(previewRefactorRequest)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "REFACTORKIT_PREVIEW_REFUSED",
      command: "preview_refactorkit_engine_refactoring",
    });
    expect(String(error)).not.toContain(privatePath);
    expect(error).toHaveProperty(
      "message",
      "RefactorKit refused to preview this real-engine Java refactoring. No source changes were made.",
    );
  });

  it("refuses Apply when aggregate support remains true but the exact operation is proposal-only", async () => {
    const base = structuredClone(actualSchemaV1Capabilities) as any;
    const renameClass = base.languageKernel.schema.adapters[0].capabilities.find(
      (capability: { operation: string }) => capability.operation === "renameClass",
    );
    renameClass.stability = "experimental";
    renameClass.mutationAuthority = "proposal-only";
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(base);

    const error = await new TauriRefactorKitAdapter()
      .applyRefactoring(applyRefactorRequest)
      .catch((value: unknown) => value);

    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "apply_refactorkit_engine_refactoring",
      cause: undefined,
    });
    expect(String(error)).toContain("managed mutation authority");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "apply_refactorkit_engine_refactoring",
      expect.anything(),
    );
  });
});

describe("TauriRefactorKitAdapter Java symbol-navigation advertisement", () => {
  beforeEach(() => invokeMock.mockReset());

  it("preserves daemon method capabilities alongside the real-engine report", async () => {
    const base = structuredClone(actualSchemaV1Capabilities) as any;
    base.methods = [
      {
        name: "project.context.v5",
        stability: "beta-contract",
        requiresProject: true,
        writesWorkspace: false,
        features: {
          typedSchemaV5: true,
          providerQualifiedSourceAssociation: true,
        },
      },
    ];
    base.javaContextRefactoring = {
      schemaVersion: 1,
      operations: ["extract-method"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
    };
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(base);

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.methods).toEqual(base.methods);
    expect(normalized.javaContextRefactoring).toEqual({
      ...base.javaContextRefactoring,
      renderedDiff: false,
    });
    expect(normalized.languageKernel).toEqual(base.languageKernel);
    expect(normalized.safety).toEqual(base.safety);
  });

  it("advertises the real-engine Java definition/references capability as authoritative", async () => {
    // A discovered engine that advertises definition/references yields an authoritative
    // Java-navigation surface while remaining honestly unavailable for general refactoring.
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.operations = ["definition", "references"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized.javaNavigation).toEqual({
      supported: true,
      operations: ["definition", "references"],
      stability: "experimental",
    });
    expect(normalized.generalRefactoring).toEqual({
      supported: false,
      operations: [],
      preview: false,
      apply: false,
      rollback: false,
      discard: false,
      stability: "experimental",
    });
    expect(invokeMock.mock.calls[0]).toEqual(["get_refactorkit_engine_capabilities", undefined]);
    expect(invokeMock.mock.calls[1]).toEqual(["get_refactorkit_capabilities", undefined]);
  });

  it("keeps general-refactoring and Java-navigation surfaces distinct", async () => {
    // A nav-only engine (definition/references but no refactoring operations) is honestly
    // unavailable for general refactoring; the two capability surfaces stay distinct.
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.operations = ["definition", "references"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized.javaNavigation).toEqual({
      supported: true,
      operations: ["definition", "references"],
      stability: "experimental",
    });
    expect(normalized.generalRefactoring).toEqual({
      supported: false,
      operations: [],
      preview: false,
      apply: false,
      rollback: false,
      discard: false,
      stability: "experimental",
    });
  });

  it("omits the Java-navigation advertisement when no navigation operations are advertised", async () => {
    // The default engine wire advertises only the general-refactoring operation set, so
    // no javaNavigation capability is attached and general refactoring stays authoritative.
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized).not.toHaveProperty("javaNavigation");
    expect(normalized.generalRefactoring).toEqual(engineGeneralRefactoringAdvertised);
  });

  it("surfaces an honest unavailable advertisement when the real engine is not discovered", async () => {
    invokeMock.mockResolvedValueOnce(unavailableEngineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();
    expect(normalized).not.toHaveProperty("javaNavigation");
    expect(normalized.generalRefactoring).toEqual(engineGeneralRefactoringUnavailable);
  });

  it("preserves the real engine's per-operation managed mutation authority", async () => {
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.operations = [
          ...record.operations,
          "pull-up-member",
          "push-down-member",
          "format-file",
          "organize-imports",
        ];
        record.managedOperations = [
          "move-member",
          "pull-up-member",
          "push-down-member",
          "format-file",
          "organize-imports",
        ];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.managedJavaMutationOperations).toEqual([
      "move-member",
      "pull-up-member",
      "push-down-member",
      "format-file",
      "organize-imports",
    ]);
    expect(normalized.generalRefactoring?.operations).toContain("format-file");
    expect(normalized.generalRefactoring?.operations).toContain("pull-up-member");
    expect(normalized.generalRefactoring?.operations).toContain("push-down-member");
  });

  it("accepts the Encapsulate Field operation advertised by the native engine command", async () => {
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.operations = ["encapsulate-field"];
        record.managedOperations = ["encapsulate-field"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.generalRefactoring).toMatchObject({
      supported: true,
      operations: ["encapsulate-field"],
      preview: true,
      apply: true,
      rollback: true,
    });
    expect(normalized.managedJavaMutationOperations).toEqual(["encapsulate-field"]);
  });

  it("preserves the explicit safe-delete project reference analysis scope", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce({
      ...structuredClone(actualSchemaV1Capabilities),
      safeDeleteReferenceAnalysis: "complete-project",
    });

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.safeDeleteReferenceAnalysis).toBe("complete-project");
  });

  it("rejects unknown safe-delete reference analysis scopes", async () => {
    invokeMock.mockResolvedValueOnce(engineCapabilitiesWire());
    invokeMock.mockResolvedValueOnce({
      ...structuredClone(actualSchemaV1Capabilities),
      safeDeleteReferenceAnalysis: "java-sources-only",
    });

    await expect(new TauriRefactorKitAdapter().getCapabilities()).rejects.toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_capabilities",
    });
  });

  it("accepts extract parameter and extract field in the real engine capability report", async () => {
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.operations = [...record.operations, "extract-parameter", "extract-field"];
        record.managedOperations = ["extract-parameter", "extract-field"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const normalized = await new TauriRefactorKitAdapter().getCapabilities();

    expect(normalized.engineDiscovered).toBe(true);
    expect(normalized.generalRefactoring?.operations).toContain("extract-parameter");
    expect(normalized.generalRefactoring?.operations).toContain("extract-field");
    expect(normalized.managedJavaMutationOperations).toEqual([
      "extract-parameter",
      "extract-field",
    ]);
  });

  it("rejects managed mutation authority for an operation the engine did not advertise", async () => {
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.managedOperations = ["format-file"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    await expect(new TauriRefactorKitAdapter().getCapabilities()).rejects.toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_engine_capabilities",
    });
  });

  it("rejects an invalid engine operation string", async () => {
    // validateEngineOperation accepts only the canonical refactoring and navigation
    // operation sets; an unknown operation rejects the engine capability report.
    invokeMock.mockResolvedValueOnce(
      engineCapabilitiesWire((record) => {
        record.operations = ["definition", "bogus-operation"];
      }),
    );
    invokeMock.mockResolvedValueOnce(structuredClone(actualSchemaV1Capabilities));

    const error = await new TauriRefactorKitAdapter()
      .getCapabilities()
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "get_refactorkit_engine_capabilities",
      cause: undefined,
    });
    expect(error).not.toHaveProperty("response");
  });
});

describe("TauriRefactorKitAdapter saved-snapshot semantic lifecycle boundary", () => {
  beforeEach(() => invokeMock.mockReset());

  it("sends the exact start envelope without caller-minted identities and returns an immutable clone", async () => {
    const adapter = new TauriRefactorKitAdapter();
    const request = semanticSessionStartRequest();
    const nativeResponse = semanticSessionStartResponse();
    invokeMock.mockResolvedValueOnce(nativeResponse);

    const pending = adapter.startSavedSnapshotSemanticSession(request);
    (request.runtime.limits as { maxInputBytes: number }).maxInputBytes = 1;
    (request.extensions as string[]).push("js");
    (request.toolchain as { nodeExecutable: string }).nodeExecutable = "/mutated/node";
    const result = await pending;

    expect(invokeMock.mock.calls).toEqual([
      [
        "start_refactorkit_saved_snapshot_semantic_session",
        { request: semanticSessionStartRequest() },
      ],
    ]);
    const wireRequest = (
      invokeMock.mock.calls[0]?.[1] as { request: SavedSnapshotSemanticSessionStartRequest }
    ).request;
    expect(wireRequest).not.toBe(request);
    expect(wireRequest.runtime).not.toBe(request.runtime);
    expect(wireRequest.runtime.limits).not.toBe(request.runtime.limits);
    expect(wireRequest.extensions).not.toBe(request.extensions);
    expect(wireRequest.toolchain).not.toBe(request.toolchain);
    expect(wireRequest).not.toHaveProperty("sessionId");
    expect(wireRequest).not.toHaveProperty("snapshotIdentity");
    expect(wireRequest).not.toHaveProperty("providerProjectSnapshotIdentity");
    expect(wireRequest.toolchain).toMatchObject({
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    });

    expect(result).toEqual(semanticSessionStartResponse());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.toolchain)).toBe(true);
    expect(Object.isFrozen(result.toolchain.runtime)).toBe(true);
    expect(Object.isFrozen(result.toolchain.runtime.limits)).toBe(true);
    expect(Object.isFrozen(result.toolchain.extensions)).toBe(true);
    expect(Object.isFrozen(result.processProvenance)).toBe(true);

    nativeResponse.toolchain.runtime.limits.maxInputBytes = 2;
    nativeResponse.toolchain.extensions.push("js");
    nativeResponse.processProvenance.processId = 9;
    expect(result.toolchain.runtime.limits.maxInputBytes).toBe(16 * 1024 * 1024);
    expect(result.toolchain.extensions).toEqual(["ts", "tsx"]);
    expect(result.processProvenance.processId).toBe(4242);
  });

  it.each([
    ["caller session identity", (request: any) => (request.sessionId = SEMANTIC_SESSION_ID)],
    ["caller snapshot identity", (request: any) => (request.snapshotIdentity = SNAPSHOT_IDENTITY)],
    ["PATH discovery", (request: any) => (request.toolchain.allowPathNodeDiscovery = true)],
    [
      "workspace-local discovery",
      (request: any) => (request.toolchain.allowWorkspaceLocalToolchain = true),
    ],
    [
      "workspace-local node",
      (request: any) =>
        (request.toolchain.nodeExecutable = "/workspace/project/node_modules/.bin/node"),
    ],
    ["relative node", (request: any) => (request.toolchain.nodeExecutable = "node")],
    ["extra runtime field", (request: any) => (request.runtime.internalHandle = 7)],
    ["extra request field", (request: any) => (request.internalDetail = PRIVATE_NATIVE_DETAIL)],
  ])("rejects an invalid start request before invoke: %s", async (_name, mutate) => {
    const request = semanticSessionStartRequest() as any;
    mutate(request);

    const error = await new TauriRefactorKitAdapter()
      .startSavedSnapshotSemanticSession(request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriRefactorKitSemanticSessionError",
      command: "start_refactorkit_saved_snapshot_semantic_session",
      code: "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["authority mismatch", (response: any) => (response.workspaceGeneration = 8)],
    ["non-opaque session", (response: any) => (response.sessionId = "session-from-caller")],
    [
      "non-digest snapshot",
      (response: any) => (response.providerProjectSnapshotIdentity = "snapshot"),
    ],
    [
      "workspace-local returned toolchain",
      (response: any) =>
        (response.toolchain.typeScriptPackageRoot = "/workspace/project/node_modules/typescript"),
    ],
    ["fabricated compiler attestation", (response: any) => (response.compilerAttestation = "yes")],
    ["extra internal field", (response: any) => (response.internalDetail = PRIVATE_NATIVE_DETAIL)],
  ])("rejects and redacts an invalid start response: %s", async (_name, mutate) => {
    const response = semanticSessionStartResponse() as any;
    mutate(response);
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .startSavedSnapshotSemanticSession(semanticSessionStartRequest())
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      command: "start_refactorkit_saved_snapshot_semantic_session",
      code: "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
      cause: undefined,
    });
    expect(String(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
  });

  it("redacts native start failures without retaining request, toolchain, or internal detail", async () => {
    const request = semanticSessionStartRequest();
    invokeMock.mockRejectedValueOnce({
      message: `${PRIVATE_NATIVE_DETAIL}: ${request.workspaceRoot}`,
      toolchain: request.toolchain,
      request,
    });

    const error = await new TauriRefactorKitAdapter()
      .startSavedSnapshotSemanticSession(request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      command: "start_refactorkit_saved_snapshot_semantic_session",
      code: "REFACTORKIT_SEMANTIC_SESSION_START_FAILED",
      cause: undefined,
    });
    expect(error).not.toHaveProperty("request");
    expect(error).not.toHaveProperty("toolchain");
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(JSON.stringify(error)).not.toContain(request.workspaceRoot);
  });

  it("sends the exact stop envelope and accepts only a correlated immutable result", async () => {
    const request = semanticSessionStopRequest();
    const nativeResponse = semanticSessionStopResponse();
    invokeMock.mockResolvedValueOnce(nativeResponse);

    const pending = new TauriRefactorKitAdapter().stopSavedSnapshotSemanticSession(request);
    (request as { workspaceId: string }).workspaceId = "mutated-workspace";
    const result = await pending;

    expect(invokeMock.mock.calls).toEqual([
      [
        "stop_refactorkit_saved_snapshot_semantic_session",
        { request: semanticSessionStopRequest() },
      ],
    ]);
    expect(result).toEqual(semanticSessionStopResponse());
    expect(Object.isFrozen(result)).toBe(true);
    nativeResponse.sessionId = `refactorkit-semantic-session-v1:${"f".repeat(64)}`;
    expect(result.sessionId).toBe(SEMANTIC_SESSION_ID);
  });

  it.each([
    ["extra field", (request: any) => (request.force = true)],
    ["non-opaque identity", (request: any) => (request.sessionId = "session-1")],
    ["zero generation", (request: any) => (request.workspaceGeneration = 0)],
  ])("rejects an invalid stop request before invoke: %s", async (_name, mutate) => {
    const request = semanticSessionStopRequest() as any;
    mutate(request);

    await expect(
      new TauriRefactorKitAdapter().stopSavedSnapshotSemanticSession(request),
    ).rejects.toMatchObject({
      command: "stop_refactorkit_saved_snapshot_semantic_session",
      code: "REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED",
      cause: undefined,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["workspace authority", (response: any) => (response.workspaceId = "workspace:other")],
    [
      "session correlation",
      (response: any) => (response.sessionId = `refactorkit-semantic-session-v1:${"f".repeat(64)}`),
    ],
    ["fabricated field", (response: any) => (response.internalDetail = PRIVATE_NATIVE_DETAIL)],
    ["malformed stopped flag", (response: any) => (response.stopped = "yes")],
  ])("rejects and redacts an invalid stop response: %s", async (_name, mutate) => {
    const response = semanticSessionStopResponse() as any;
    mutate(response);
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .stopSavedSnapshotSemanticSession(semanticSessionStopRequest())
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      command: "stop_refactorkit_saved_snapshot_semantic_session",
      code: "REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
  });

  it("redacts native stop failures without retaining session or internal detail", async () => {
    const request = semanticSessionStopRequest();
    invokeMock.mockRejectedValueOnce({ message: PRIVATE_NATIVE_DETAIL, request });

    const error = await new TauriRefactorKitAdapter()
      .stopSavedSnapshotSemanticSession(request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      command: "stop_refactorkit_saved_snapshot_semantic_session",
      code: "REFACTORKIT_SEMANTIC_SESSION_STOP_FAILED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(JSON.stringify(error)).not.toContain(request.sessionId);
  });
});

describe("TauriRefactorKitAdapter saved-snapshot symbol search boundary", () => {
  beforeEach(() => invokeMock.mockReset());

  it("sends one exact no-discovery envelope, accepts exactly 200 symbols, and isolates mutations", async () => {
    const adapter = new TauriRefactorKitAdapter();
    const request = savedSnapshotSearchRequest();
    const nativeResponse = savedSnapshotSearchResponse(200);
    invokeMock.mockResolvedValueOnce(nativeResponse);

    const pending = adapter.searchSavedSnapshotSymbols(request);
    (request as { query: string }).query = "mutated";
    (request.toolchain as { nodeExecutable: string }).nodeExecutable = "/mutated/node";
    const result = await pending;

    expect(invokeMock.mock.calls).toEqual([
      ["search_refactorkit_saved_snapshot_symbols", { request: savedSnapshotSearchRequest() }],
    ]);
    const wireRequest = (
      invokeMock.mock.calls[0]?.[1] as { request: SavedSnapshotSymbolSearchRequest }
    ).request;
    expect(wireRequest).not.toBe(request);
    expect(wireRequest.toolchain).not.toBe(request.toolchain);
    expect(wireRequest.toolchain).toMatchObject({
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    });
    expect(result.symbols).toHaveLength(200);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.completeness)).toBe(true);
    expect(Object.isFrozen(result.symbols)).toBe(true);
    expect(Object.isFrozen(result.symbols[0])).toBe(true);

    nativeResponse.symbols[0]!.name = "mutated native name";
    nativeResponse.completeness.experimentalDisclosure = "not-shown";
    expect(result.symbols[0]?.name).toBe("Widget1");
    expect(result.completeness.experimentalDisclosure).toBe("shown");
  });

  it.each([
    ["empty query", (request: any) => (request.query = "")],
    ["extra field", (request: any) => (request.limit = 200)],
    ["PATH discovery", (request: any) => (request.toolchain.allowPathNodeDiscovery = true)],
    [
      "workspace-local discovery",
      (request: any) => (request.toolchain.allowWorkspaceLocalToolchain = true),
    ],
    ["relative toolchain", (request: any) => (request.toolchain.nodeExecutable = "node")],
    ["fabricated session identity", (request: any) => (request.sessionId = "caller-session")],
    [
      "fabricated snapshot identity",
      (request: any) => (request.snapshotIdentity = "caller-snapshot"),
    ],
  ])("rejects an invalid search request before invoke: %s", async (_name, mutate) => {
    const request = savedSnapshotSearchRequest() as any;
    mutate(request);

    const error = await new TauriRefactorKitAdapter()
      .searchSavedSnapshotSymbols(request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "TauriAdapterError",
      command: "search_refactorkit_saved_snapshot_symbols",
      cause: undefined,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "201st result",
      (response: any) =>
        response.symbols.push({ id: opaqueSymbolId(201), name: "Overflow", kind: "class" }),
    ],
    [
      "false completeness claim",
      (response: any) => (response.completeness.resultCompleteness = "complete"),
    ],
    [
      "false truncation claim",
      (response: any) => (response.completeness.truncation = "not-truncated"),
    ],
    [
      "semantic completeness mismatch",
      (response: any) => (response.completeness.semanticCompleteness = "checked-javascript"),
    ],
    [
      "missing disclosure",
      (response: any) => (response.completeness.experimentalDisclosure = "not-shown"),
    ],
    ["request authority mismatch", (response: any) => (response.query = "Other")],
    [
      "session mismatch",
      (response: any) => (response.sessionId = `refactorkit-semantic-session-v1:${"f".repeat(64)}`),
    ],
    [
      "snapshot mismatch",
      (response: any) => (response.snapshotIdentity = `sha256:${"f".repeat(64)}`),
    ],
    ["provider mismatch", (response: any) => (response.providerVersion = "other")],
    ["non-opaque symbol", (response: any) => (response.symbols[0].id = "src/Widget.ts#Widget")],
    [
      "duplicate opaque symbol",
      (response: any) => (response.symbols[1].id = response.symbols[0].id),
    ],
    ["extra symbol field", (response: any) => (response.symbols[0].file = "src/Widget.ts")],
    ["extra response field", (response: any) => (response.internalDetail = PRIVATE_NATIVE_DETAIL)],
  ])("rejects malformed, uncorrelated, or fabricated search output: %s", async (_name, mutate) => {
    const response = savedSnapshotSearchResponse(_name === "201st result" ? 200 : 2) as any;
    mutate(response);
    invokeMock.mockResolvedValueOnce(response);

    const error = await new TauriRefactorKitAdapter()
      .searchSavedSnapshotSymbols(savedSnapshotSearchRequest())
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      command: "search_refactorkit_saved_snapshot_symbols",
      code: "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
  });

  it("redacts search transport failures including request, toolchain, and native detail", async () => {
    const request = savedSnapshotSearchRequest();
    invokeMock.mockRejectedValueOnce({
      message: PRIVATE_NATIVE_DETAIL,
      request,
      executable: request.toolchain.nodeExecutable,
    });

    const error = await new TauriRefactorKitAdapter()
      .searchSavedSnapshotSymbols(request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      command: "search_refactorkit_saved_snapshot_symbols",
      code: "REFACTORKIT_SYMBOL_SEARCH_FAILED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(JSON.stringify(error)).not.toContain(request.toolchain.nodeExecutable);
  });
});

describe("TauriRefactorKitAdapter saved-snapshot definition boundary", () => {
  beforeEach(() => invokeMock.mockReset());

  async function adapterWithCurrentSearch(): Promise<TauriRefactorKitAdapter> {
    const adapter = new TauriRefactorKitAdapter();
    invokeMock.mockResolvedValueOnce(savedSnapshotSearchResponse());
    await adapter.searchSavedSnapshotSymbols(savedSnapshotSearchRequest());
    invokeMock.mockClear();
    return adapter;
  }

  it("sends the exact definition envelope and returns an immutable normalized location", async () => {
    const adapter = await adapterWithCurrentSearch();
    const request = savedSnapshotDefinitionRequest();
    const nativeResponse = savedSnapshotDefinitionResponse();
    invokeMock.mockResolvedValueOnce(nativeResponse);

    const pending = adapter.resolveSavedSnapshotDefinition(request);
    (request as { workspaceId: string }).workspaceId = "mutated-workspace";
    const result = await pending;

    expect(invokeMock.mock.calls).toEqual([
      [
        "resolve_refactorkit_saved_snapshot_definition",
        { request: savedSnapshotDefinitionRequest() },
      ],
    ]);
    expect(result).toEqual(savedSnapshotDefinitionResponse());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selectedSymbol)).toBe(true);
    expect(Object.isFrozen(result.point)).toBe(true);

    nativeResponse.selectedSymbol.name = "mutated native name";
    nativeResponse.point.line = 999;
    expect(result.selectedSymbol.name).toBe("Widget1");
    expect(result.point).toEqual({ line: 12, character: 7 });
  });

  it.each([
    ["non-opaque symbol", (request: any) => (request.symbolId = "src/Widget.ts#Widget")],
    ["symbol outside current result", (request: any) => (request.symbolId = opaqueSymbolId(99))],
    ["workspace authority mismatch", (request: any) => (request.workspaceId = "workspace:other")],
    [
      "session authority mismatch",
      (request: any) => (request.sessionId = `refactorkit-semantic-session-v1:${"f".repeat(64)}`),
    ],
    [
      "snapshot authority mismatch",
      (request: any) => (request.snapshotIdentity = `sha256:${"f".repeat(64)}`),
    ],
    ["extra range", (request: any) => (request.range = { start: 0, end: 1 })],
  ])(
    "rejects invalid or unauthorized definition input before invoke: %s",
    async (_name, mutate) => {
      const adapter = await adapterWithCurrentSearch();
      const request = savedSnapshotDefinitionRequest() as any;
      mutate(request);

      const error = await adapter.resolveSavedSnapshotDefinition(request).catch((value) => value);
      expect(error).toMatchObject({
        name: "TauriAdapterError",
        command: "resolve_refactorkit_saved_snapshot_definition",
        cause: undefined,
      });
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["authority mismatch", (response: any) => (response.workspaceGeneration = 8)],
    [
      "selected opaque ID mismatch",
      (response: any) => (response.selectedSymbol.id = opaqueSymbolId(2)),
    ],
    ["selected metadata mismatch", (response: any) => (response.selectedSymbol.name = "Other")],
    ["absolute file", (response: any) => (response.file = "/workspace/project/src/Widget.ts")],
    ["traversal file", (response: any) => (response.file = "src/../Secret.ts")],
    ["backslash file", (response: any) => (response.file = "src\\Widget.ts")],
    ["negative line", (response: any) => (response.point.line = -1)],
    ["fractional character", (response: any) => (response.point.character = 1.5)],
    ["overflowing line", (response: any) => (response.point.line = Number.MAX_SAFE_INTEGER)],
    [
      "fabricated range",
      (response: any) => (response.range = { start: response.point, end: response.point }),
    ],
    ["fabricated attestation", (response: any) => (response.attestation = "compiler")],
    ["extra internal detail", (response: any) => (response.internalDetail = PRIVATE_NATIVE_DETAIL)],
  ])("rejects unsafe, uncorrelated, or fabricated definition output: %s", async (_name, mutate) => {
    const adapter = await adapterWithCurrentSearch();
    const response = savedSnapshotDefinitionResponse() as any;
    mutate(response);
    invokeMock.mockResolvedValueOnce(response);

    const error = await adapter
      .resolveSavedSnapshotDefinition(savedSnapshotDefinitionRequest())
      .catch((value) => value);
    expect(error).toMatchObject({
      command: "resolve_refactorkit_saved_snapshot_definition",
      code: "REFACTORKIT_DEFINITION_RESPONSE_REJECTED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
  });

  it("redacts definition transport failures without retaining request or internal details", async () => {
    const adapter = await adapterWithCurrentSearch();
    const request = savedSnapshotDefinitionRequest();
    invokeMock.mockRejectedValueOnce({ message: PRIVATE_NATIVE_DETAIL, request });

    const error = await adapter.resolveSavedSnapshotDefinition(request).catch((value) => value);
    expect(error).toMatchObject({
      command: "resolve_refactorkit_saved_snapshot_definition",
      code: "REFACTORKIT_DEFINITION_FAILED",
      cause: undefined,
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE_NATIVE_DETAIL);
    expect(JSON.stringify(error)).not.toContain(request.symbolId);
  });

  it("invalidates the correlated current search after a successful stop", async () => {
    const adapter = await adapterWithCurrentSearch();
    invokeMock.mockResolvedValueOnce(semanticSessionStopResponse());
    await expect(
      adapter.stopSavedSnapshotSemanticSession(semanticSessionStopRequest()),
    ).resolves.toEqual(semanticSessionStopResponse());
    invokeMock.mockClear();

    await expect(
      adapter.resolveSavedSnapshotDefinition(savedSnapshotDefinitionRequest()),
    ).rejects.toMatchObject({
      command: "resolve_refactorkit_saved_snapshot_definition",
      cause: undefined,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
