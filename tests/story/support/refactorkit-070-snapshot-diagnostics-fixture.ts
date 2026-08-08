import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { act, renderHook } from "@testing-library/react";

import { createTauriAdapters } from "../../../apps/desktop/src/adapters/index.js";
import {
  useRefactorKitStatusController,
  type RefactorKitStatusController,
} from "../../../apps/desktop/src/features/refactorkit-status/useRefactorKitStatusController.js";
import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapter,
} from "../../../packages/contracts/src/refactorkit.js";
import type { RefactorKitPort } from "../../../packages/web-core/src/ports/refactorkit-port.js";

interface StoryDom {
  readonly window: Window & typeof globalThis;
}

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  readonly JSDOM: new (html: string, options: { url: string }) => StoryDom;
};

const OPERATION = "diagnostics.v2" as const;
const SCHEMA_VERSION = 2 as const;
const PROVIDER_VERSION = "0.7.0-SNAPSHOT" as const;
const COMPILER_BACKEND = "typescript-compiler-exact-v1" as const;
const MAX_RESPONSE_BYTES = 2_097_152;

const AUTHORITY = {
  workspaceId: "workspace:authorized",
  workspaceGeneration: 1,
  sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
  semanticLease: "semantic-00000000-0000-4000-8000-000000000001",
  projectSnapshotHash: "b".repeat(64),
  providerSnapshotHash: "c".repeat(64),
} as const;

const DIAGNOSTICS_RUNTIME = {
  executionMode: "external-process",
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
} as const;

const DIAGNOSTICS_V2_METHOD = {
  name: OPERATION,
  stability: "additive-api-0.2",
  requiresProject: true,
  writesWorkspace: false,
  features: {
    requestCorrelation: true,
    semanticLease: true,
    savedDiskAuthority: true,
    immutableEditorOverlay: true,
    exactUtf16Ranges: true,
    structuredReadiness: true,
    compilerAttestation: true,
    boundedResponse: true,
  },
} as const;

const DIAGNOSTICS_CAPABILITY = {
  operation: "diagnostics",
  stability: "experimental",
  evidence: "compiler",
  mutationAuthority: "none",
  backend: COMPILER_BACKEND,
  runtime: DIAGNOSTICS_RUNTIME,
  diagnosticSnapshotModes: ["immutable-editor-overlay", "saved-disk"],
  diagnosticRangeCapability: "exact-utf16-or-explicit-partial",
} as const;

const LANGUAGE_VOCABULARY = {
  stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
  evidence: ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
  mutationAuthority: ["managed-stable", "proposal-only", "none"],
  executionMode: ["in-process", "external-process"],
  diagnosticSnapshotMode: ["saved-disk", "immutable-editor-overlay"],
  diagnosticRangeCapability: ["exact-utf16-or-explicit-partial"],
} as const;

function diagnosticsAdapter(languageId: "javascript" | "typescript") {
  const extensions = languageId === "typescript" ? ["ts", "tsx"] : ["js", "jsx"];
  return {
    languageId,
    extensions,
    backend: "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
    runtime: {
      executionMode: "external-process",
      supportsTimeout: true,
      supportsCancellation: true,
      usesWorkspaceOverlay: true,
      recordsProcessProvenance: true,
      limits: {
        requestTimeoutMillis: 10_000,
        maxInputBytes: 8 * 1024 * 1024,
        maxOutputBytes: 64 * 1024 * 1024,
        maxProcesses: 8,
      },
    },
    capabilities: [{ ...DIAGNOSTICS_CAPABILITY, extensions }],
  } as const;
}

/** Exact scenario-owned extraction of the source-built provider advertisement. */
const SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT = {
  name: "refactorkit",
  version: PROVIDER_VERSION,
  apiVersion: "0.2",
  protocol: "json-rpc-2.0",
  transport: "stdio",
  methods: [DIAGNOSTICS_V2_METHOD],
  languageKernel: {
    schemaVersion: 1,
    adapters: [diagnosticsAdapter("javascript"), diagnosticsAdapter("typescript")],
    vocabulary: LANGUAGE_VOCABULARY,
  },
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
} as const;

/**
 * Current production native normalization. It deliberately does not invent the
 * diagnostics.v2 method or diagnostic-specific metadata that production drops.
 */
const CURRENT_IDE_CAPABILITIES = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: PROVIDER_VERSION,
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
      adapters: SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.languageKernel.adapters.map(
        (adapter) => ({
          ...adapter,
          capabilities: adapter.capabilities.map(
            ({
              diagnosticSnapshotModes: _snapshotModes,
              diagnosticRangeCapability: _range,
              ...capability
            }) => capability,
          ),
        }),
      ),
      vocabulary: {
        stability: LANGUAGE_VOCABULARY.stability,
        evidence: LANGUAGE_VOCABULARY.evidence,
        mutationAuthority: LANGUAGE_VOCABULARY.mutationAuthority,
        executionMode: LANGUAGE_VOCABULARY.executionMode,
      },
    },
  },
  safety: SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.safety,
} as const;

const READY_REFACTORKIT_STATUS = {
  available: true,
  path: "/opt/refactorkit/refactorkit-daemon",
  version: PROVIDER_VERSION,
  checkedAt: "2026-08-08T00:00:00.000Z",
} as const;

const ACCEPTED_SNAPSHOT_EVIDENCE = {
  source: {
    commit: "db25c9af2d62c8e9e90f93792a6c6593e6e13698",
    tree: "0ee693d519f9c2bf9159bebbbc37857a56112d97",
    treeAlgorithm: "git-tree-oid-sha1-v1",
    gitObjectType: "tree",
    clean: true,
    detached: true,
  },
  build: {
    command: ["./gradlew", "--no-daemon", "clean", ":modules:refactorkit-daemon:installDist"],
    javaMajor: 21,
    cleanBefore: true,
    cleanAfter: true,
    daemonSha256: "57d90a47dbd8d39cb40e545158d098e7c8addd7aa19c5c2a610783721055e6b4",
    attestationSha256: "c551e2de8051eb7e4023025c2a68123fe3e936e6042cc4c012b64fd8266cb0ed",
  },
  process: {
    controlledNode: true,
    compilerBackend: COMPILER_BACKEND,
    packageScriptCanaryMarkerAbsent: true,
    prohibitedInvocationCount: 0,
  },
  workspaceAudit: {
    scope:
      "sampled non-directory path/content bytes; excludes metadata, empty directories, transient between-checkpoint writes, and syscall-complete claims",
    beforeFingerprint: "d".repeat(64),
    afterFingerprint: "d".repeat(64),
    workspaceLockAbsentAtChecks: true,
  },
} as const;

const COMPILER_ATTESTATION = {
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
} as const;

const SOURCE_AUTHORITY_REQUEST = {
  kind: "immutable-editor-overlay",
  documents: [
    {
      path: "src/broken.ts",
      version: 9,
      content: 'const amount: number = "wrong";\n',
    },
  ],
} as const;

const SOURCE_AUTHORITY_RESPONSE = {
  kind: "immutable-editor-overlay",
  baseSnapshotHash: AUTHORITY.projectSnapshotHash,
  overlayHash: "3".repeat(64),
  providerSnapshotHash: AUTHORITY.providerSnapshotHash,
  documents: [
    {
      path: "src/broken.ts",
      version: 9,
      contentSha256: "4".repeat(64),
    },
  ],
} as const;

const DIAGNOSTICS_REQUEST = {
  schemaVersion: SCHEMA_VERSION,
  operation: OPERATION,
  requestId: "desktop-diagnostics-1",
  languageId: "typescript",
  workspaceId: AUTHORITY.workspaceId,
  workspaceGeneration: AUTHORITY.workspaceGeneration,
  sessionId: AUTHORITY.sessionId,
  expectedSnapshotHash: AUTHORITY.projectSnapshotHash,
  semanticLease: AUTHORITY.semanticLease,
  sourceAuthority: SOURCE_AUTHORITY_REQUEST,
} as const;

const REFUSED_REQUEST = {
  ...DIAGNOSTICS_REQUEST,
  requestId: "desktop-diagnostics-refused",
  semanticLease: "semantic-00000000-0000-4000-8000-000000000000",
} as const;

const ERROR_REQUEST = {
  ...DIAGNOSTICS_REQUEST,
  requestId: "desktop-diagnostics-error",
} as const;

type DiagnosticsRequest =
  typeof DIAGNOSTICS_REQUEST | typeof REFUSED_REQUEST | typeof ERROR_REQUEST;
type DiagnosticsStatus = "ready" | "refused" | "error";

interface DiagnosticsEnvelope {
  readonly schemaVersion: 2;
  readonly operation: typeof OPERATION;
  readonly requestId: string;
  readonly languageId: "typescript";
  readonly status: DiagnosticsStatus;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sessionId: string;
  readonly provider: {
    readonly name: "refactorkit";
    readonly version: typeof PROVIDER_VERSION;
    readonly apiVersion: "0.2";
  };
  readonly backend: typeof COMPILER_BACKEND;
  readonly semanticLease: string;
  readonly projectSnapshotHash: string;
  readonly providerSnapshotHash: string;
  readonly sourceAuthority: typeof SOURCE_AUTHORITY_RESPONSE;
  readonly rangeEncoding: "utf-16";
  readonly rangeCapability: "exact-utf16-or-explicit-partial";
  readonly runtime: typeof DIAGNOSTICS_RESPONSE_RUNTIME;
  readonly compilerAttestation: typeof COMPILER_ATTESTATION | null;
  readonly failure: { readonly code: string; readonly message: string } | null;
  readonly diagnostics: readonly unknown[];
  readonly diagnosticsTotal: number;
  readonly diagnosticsReturned: number;
  readonly truncated: boolean;
  readonly responseBytes: number;
}

const DIAGNOSTICS_RESPONSE_RUNTIME = {
  ...DIAGNOSTICS_RUNTIME,
  limits: {
    ...DIAGNOSTICS_RUNTIME.limits,
    maxStderrBytes: 65_536,
    compilerHeapMiB: 512,
    maxDiagnostics: 500,
    maxDiagnosticMessageChars: 4_096,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  },
} as const;

function withResponseBytes<T extends Omit<DiagnosticsEnvelope, "responseBytes">>(
  value: T,
): DiagnosticsEnvelope {
  let result = { ...value, responseBytes: 0 } as DiagnosticsEnvelope;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const responseBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    const updated = { ...result, responseBytes } as DiagnosticsEnvelope;
    if (Buffer.byteLength(JSON.stringify(updated), "utf8") === responseBytes) return updated;
    result = updated;
  }
  throw new Error("The diagnostics.v2 fixture response byte count did not converge");
}

function envelope(
  requestId: string,
  status: DiagnosticsStatus,
  options: {
    readonly compilerAttestation: typeof COMPILER_ATTESTATION | null;
    readonly failure: DiagnosticsEnvelope["failure"];
    readonly diagnostics?: readonly unknown[];
    readonly semanticLease?: string;
  },
): DiagnosticsEnvelope {
  const diagnostics = options.diagnostics ?? [];
  return withResponseBytes({
    schemaVersion: SCHEMA_VERSION,
    operation: OPERATION,
    requestId,
    languageId: "typescript",
    status,
    workspaceId: AUTHORITY.workspaceId,
    workspaceGeneration: AUTHORITY.workspaceGeneration,
    sessionId: AUTHORITY.sessionId,
    provider: { name: "refactorkit", version: PROVIDER_VERSION, apiVersion: "0.2" },
    backend: COMPILER_BACKEND,
    semanticLease: options.semanticLease ?? AUTHORITY.semanticLease,
    projectSnapshotHash: AUTHORITY.projectSnapshotHash,
    providerSnapshotHash: AUTHORITY.providerSnapshotHash,
    sourceAuthority: SOURCE_AUTHORITY_RESPONSE,
    rangeEncoding: "utf-16",
    rangeCapability: "exact-utf16-or-explicit-partial",
    runtime: DIAGNOSTICS_RESPONSE_RUNTIME,
    compilerAttestation: options.compilerAttestation,
    failure: options.failure,
    diagnostics,
    diagnosticsTotal: diagnostics.length,
    diagnosticsReturned: diagnostics.length,
    truncated: false,
  });
}

const EXACT_DIAGNOSTIC = {
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

const READY_RESPONSE = envelope(DIAGNOSTICS_REQUEST.requestId, "ready", {
  compilerAttestation: COMPILER_ATTESTATION,
  failure: null,
  diagnostics: [EXACT_DIAGNOSTIC],
});

const REFUSED_RESPONSE = envelope("desktop-diagnostics-refused", "refused", {
  compilerAttestation: null,
  failure: {
    code: "diagnostics.semanticLeaseStale",
    message: "Semantic session lease is stale or belongs to another snapshot",
  },
  semanticLease: "semantic-00000000-0000-4000-8000-000000000000",
});

const ERROR_RESPONSE = envelope("desktop-diagnostics-error", "error", {
  compilerAttestation: COMPILER_ATTESTATION,
  failure: {
    code: "typescript.compilerDiagnosticsTimeout",
    message: "Exact compiler diagnostics timed out",
  },
});

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface RefactorKitStatusControllerHarness {
  readonly result: { readonly current: RefactorKitStatusController };
  unmount(): void;
}

interface FixtureInvocation {
  readonly command: string;
  readonly args?: Record<string, unknown>;
}

const REQUEST_FIELDS = [
  "schemaVersion",
  "operation",
  "requestId",
  "languageId",
  "workspaceId",
  "workspaceGeneration",
  "sessionId",
  "expectedSnapshotHash",
  "semanticLease",
  "sourceAuthority",
] as const;

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

function assertExactFields(value: object, expected: readonly string[], label: string): void {
  const actual = Reflect.ownKeys(value);
  assert.equal(
    actual.every((key) => typeof key === "string"),
    true,
    `${label} has symbol keys`,
  );
  assert.deepEqual(
    actual.map(String).sort(),
    [...expected].sort(),
    `${label} is not a strict closed shape`,
  );
}

/**
 * Deterministic desktop/Tauri-harness boundary for REQ-REFACTORKIT-TS-001 only.
 * It deliberately shares no semantic symbol-navigation state or operation.
 */
export class RefactorKit070SnapshotDiagnosticsFixture {
  readonly #adapter: RefactorKitPort;
  readonly #invocations: FixtureInvocation[] = [];
  readonly #globalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  readonly #dom: StoryDom;
  readonly #statusController: RefactorKitStatusControllerHarness;
  #capabilities?: RefactorKitCapabilities;
  #diagnostics?: DiagnosticsEnvelope;
  #refusedDiagnostics?: DiagnosticsEnvelope;
  #errorDiagnostics?: DiagnosticsEnvelope;
  #disposed = false;

  constructor() {
    this.#dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://desktop.story.invalid",
    });
    for (const [name, value] of [
      ["window", this.#dom.window],
      ["document", this.#dom.window.document],
      ["navigator", this.#dom.window.navigator],
    ] as const) {
      this.#globalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }

    const internals: TauriInternals = {
      invoke: async (command, args) => {
        this.#invocations.push(args === undefined ? { command } : { command, args });
        if (command === "get_refactorkit_status") return structuredClone(READY_REFACTORKIT_STATUS);
        if (command === "get_refactorkit_capabilities") {
          return structuredClone(CURRENT_IDE_CAPABILITIES);
        }
        if (command === "run_refactorkit_diagnostics") {
          const request = args?.request;
          if (request === null || typeof request !== "object" || Array.isArray(request)) {
            assert.deepEqual(
              args,
              { request: DIAGNOSTICS_REQUEST },
              "The production diagnostics adapter invoked the legacy uncorrelated boundary; expected one strict schema-v2 diagnostics.v2 request",
            );
          }
          assert.ok(request !== null && typeof request === "object" && !Array.isArray(request));
          assertExactFields(request, REQUEST_FIELDS, "diagnostics.v2 Tauri request");
          const requestId = (request as { readonly requestId?: unknown }).requestId;
          if (requestId === DIAGNOSTICS_REQUEST.requestId) {
            assert.deepEqual(request, DIAGNOSTICS_REQUEST);
            return structuredClone(READY_RESPONSE);
          }
          if (requestId === REFUSED_REQUEST.requestId) {
            assert.deepEqual(request, REFUSED_REQUEST);
            return structuredClone(REFUSED_RESPONSE);
          }
          if (requestId === ERROR_REQUEST.requestId) {
            assert.deepEqual(request, ERROR_REQUEST);
            return structuredClone(ERROR_RESPONSE);
          }
          assert.fail(`The diagnostics.v2 fixture received unknown requestId ${String(requestId)}`);
        }
        throw new Error(
          `The RefactorKit 0.7.0-SNAPSHOT diagnostics fixture does not implement Tauri command ${command}`,
        );
      },
    };
    Object.defineProperty(this.#dom.window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: internals,
    });

    this.#adapter = createTauriAdapters().refactorKitAdapter;
    this.#statusController = renderHook(() =>
      useRefactorKitStatusController({
        refactorKit: this.#adapter,
        deferWorkspaceActivation: true,
      }),
    );
  }

  async discoverDiagnosticsV2Capabilities(): Promise<void> {
    assertExactFields(
      SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT,
      [
        "name",
        "version",
        "apiVersion",
        "protocol",
        "transport",
        "methods",
        "languageKernel",
        "safety",
      ],
      "source-built server.capabilities",
    );
    assert.deepEqual(SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.methods, [DIAGNOSTICS_V2_METHOD]);
    assert.deepEqual(
      SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.languageKernel.adapters.map(
        ({ languageId, capabilities }) => [languageId, capabilities[0]],
      ),
      [
        ["javascript", { ...DIAGNOSTICS_CAPABILITY, extensions: ["js", "jsx"] }],
        ["typescript", { ...DIAGNOSTICS_CAPABILITY, extensions: ["ts", "tsx"] }],
      ],
    );

    await act(async () => {
      await this.#statusController.result.current.workspaceCollaborator.load(
        AUTHORITY.workspaceGeneration,
      );
    });
    assert.equal(this.#statusController.result.current.isChecking, false);
    assert.equal(this.#statusController.result.current.error, null);
    assert.deepEqual(this.#statusController.result.current.status, READY_REFACTORKIT_STATUS);
    this.#capabilities = this.#statusController.result.current.capabilities ?? undefined;
    assert.ok(this.#capabilities, "Production capability discovery returned no capabilities");
  }

  assertAcceptedSnapshotEvidenceBound(): void {
    assertExactFields(
      ACCEPTED_SNAPSHOT_EVIDENCE,
      ["source", "build", "process", "workspaceAudit"],
      "snapshot evidence",
    );
    assert.deepEqual(ACCEPTED_SNAPSHOT_EVIDENCE.source, {
      commit: "db25c9af2d62c8e9e90f93792a6c6593e6e13698",
      tree: "0ee693d519f9c2bf9159bebbbc37857a56112d97",
      treeAlgorithm: "git-tree-oid-sha1-v1",
      gitObjectType: "tree",
      clean: true,
      detached: true,
    });
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.build.cleanBefore, true);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.build.cleanAfter, true);
    assert.match(ACCEPTED_SNAPSHOT_EVIDENCE.build.daemonSha256, /^[a-f0-9]{64}$/u);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.compilerBackend, COMPILER_BACKEND);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.prohibitedInvocationCount, 0);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.packageScriptCanaryMarkerAbsent, true);
    assert.equal(
      ACCEPTED_SNAPSHOT_EVIDENCE.workspaceAudit.beforeFingerprint,
      ACCEPTED_SNAPSHOT_EVIDENCE.workspaceAudit.afterFingerprint,
    );
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.workspaceAudit.workspaceLockAbsentAtChecks, true);
  }

  async requestCurrentSnapshotDiagnostics(): Promise<void> {
    assertExactFields(DIAGNOSTICS_REQUEST, REQUEST_FIELDS, "diagnostics.v2 request");
    this.#diagnostics = await this.#invokeDiagnostics(DIAGNOSTICS_REQUEST);
  }

  assertDiagnosticsV2CapabilityMetadataPreserved(): void {
    const capabilities = this.#requireCapabilities() as RefactorKitCapabilities & {
      readonly methods?: readonly unknown[];
    };
    assert.deepEqual(
      capabilities.methods,
      [DIAGNOSTICS_V2_METHOD],
      "The IDE did not retain the diagnostics.v2 method capability metadata",
    );
    assert.equal(capabilities.languageKernel?.available, true);
    if (!capabilities.languageKernel?.available) return;
    for (const advertised of SOURCE_BUILT_DIAGNOSTICS_V2_ADVERTISEMENT.languageKernel.adapters) {
      const observed = capabilities.languageKernel.schema.adapters.find(
        (adapter: RefactorKitLanguageAdapter) => adapter.languageId === advertised.languageId,
      ) as
        | (RefactorKitLanguageAdapter & {
            readonly capabilities: readonly (Record<string, unknown> & { operation: string })[];
          })
        | undefined;
      assert.ok(observed, `The IDE omitted the ${advertised.languageId} diagnostics adapter`);
      assert.deepEqual(
        observed.capabilities.find(({ operation }) => operation === "diagnostics"),
        advertised.capabilities[0],
        `The IDE did not retain all diagnostics.v2 metadata for ${advertised.languageId}`,
      );
    }
  }

  assertSchemaAndCorrelation(): void {
    const response = this.#requireDiagnostics();
    assertExactFields(response, RESPONSE_FIELDS, "diagnostics.v2 ready response");
    assert.equal(response.schemaVersion, DIAGNOSTICS_REQUEST.schemaVersion);
    assert.equal(response.operation, DIAGNOSTICS_REQUEST.operation);
    assert.equal(response.requestId, DIAGNOSTICS_REQUEST.requestId);
  }

  async assertStructuredStatusGate(): Promise<void> {
    this.#refusedDiagnostics = await this.#invokeDiagnostics(REFUSED_REQUEST);
    this.#errorDiagnostics = await this.#invokeDiagnostics(ERROR_REQUEST);
    const ready = this.#requireDiagnostics();
    const refused = this.#requireRefusedDiagnostics();
    const error = this.#requireErrorDiagnostics();
    this.#assertEnvelope(ready, "ready");
    this.#assertEnvelope(refused, "refused");
    this.#assertEnvelope(error, "error");
    assert.equal(ready.failure, null);
    assert.equal(ready.compilerAttestation !== null, true);
    assert.equal(refused.compilerAttestation, null);
    assert.deepEqual(refused.diagnostics, []);
    assert.deepEqual(error.diagnostics, []);
  }

  assertExactCompilerBackendAndAttestation(): void {
    const response = this.#requireDiagnostics();
    assert.equal(response.backend, DIAGNOSTICS_CAPABILITY.backend);
    assert.deepEqual(response.compilerAttestation, COMPILER_ATTESTATION);
    assert.match(response.compilerAttestation?.compilerSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(response.compilerAttestation?.toolchainEvidenceSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(response.compilerAttestation?.process.executableSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(response.compilerAttestation?.process.argumentsSha256 ?? "", /^[a-f0-9]{64}$/u);
  }

  assertExactCompilerDiagnosticAndUtf16Range(): void {
    const response = this.#requireDiagnostics();
    assert.deepEqual(response.diagnostics, [EXACT_DIAGNOSTIC]);
    assert.equal(response.rangeEncoding, "utf-16");
    assert.equal(response.rangeCapability, "exact-utf16-or-explicit-partial");
  }

  assertAuthorityCorrelated(): void {
    const response = this.#requireDiagnostics();
    assert.deepEqual(
      {
        workspaceId: response.workspaceId,
        workspaceGeneration: response.workspaceGeneration,
        sessionId: response.sessionId,
        semanticLease: response.semanticLease,
        projectSnapshotHash: response.projectSnapshotHash,
        providerSnapshotHash: response.providerSnapshotHash,
        sourceAuthority: response.sourceAuthority,
      },
      {
        ...AUTHORITY,
        sourceAuthority: SOURCE_AUTHORITY_RESPONSE,
      },
    );
  }

  assertStaleAuthorityRejected(): void {
    const refused = this.#requireRefusedDiagnostics();
    assert.equal(refused.status, "refused");
    assert.equal(refused.failure?.code, "diagnostics.semanticLeaseStale");
    assert.deepEqual(refused.diagnostics, []);
    assert.notEqual(refused.semanticLease, AUTHORITY.semanticLease);
  }

  assertCompleteBoundedResponse(): void {
    const response = this.#requireDiagnostics();
    assert.deepEqual(response.runtime, DIAGNOSTICS_RESPONSE_RUNTIME);
    assert.equal(response.truncated, false);
    assert.equal(response.diagnosticsReturned, response.diagnosticsTotal);
    assert.equal(response.diagnosticsReturned, response.diagnostics.length);
    assert.equal(response.responseBytes, Buffer.byteLength(JSON.stringify(response), "utf8"));
    assert.ok(response.responseBytes <= response.runtime.limits.maxResponseBytes);
  }

  assertStructuredDiagnosticsAvailableForExistingSurfaces(): void {
    assert.fail(
      "Production has no RefactorKit diagnostics application projection into the existing Problems and Monaco surfaces",
    );
  }

  assertLanguageToolingStatesPresentedHonestly(): void {
    assert.fail(
      "Production has no RefactorKit diagnostics controller state for checking, ready, refused, and error presentation in Language Tooling",
    );
  }

  assertReadOnlyExecution(): void {
    assert.equal(DIAGNOSTICS_V2_METHOD.writesWorkspace, false);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.prohibitedInvocationCount, 0);
    assert.equal(ACCEPTED_SNAPSHOT_EVIDENCE.process.packageScriptCanaryMarkerAbsent, true);
    assert.equal(
      this.#invocations.some(({ command }) => /(?:apply|write|script|terminal)/iu.test(command)),
      false,
    );
  }

  assertNoFallbackOutput(): void {
    const response = this.#requireDiagnostics() as DiagnosticsEnvelope & {
      readonly stdout?: unknown;
      readonly fallback?: unknown;
    };
    assert.equal(response.stdout, undefined);
    assert.equal(response.fallback, undefined);
    assertExactFields(response, RESPONSE_FIELDS, "diagnostics.v2 response without fallback");
  }

  assertNoTypeScriptSpecificPanel(): void {
    assert.equal(
      this.#dom.window.document.querySelector(
        '[aria-label*="TypeScript" i][aria-label*="diagnostic" i], [data-typescript-diagnostics-panel]',
      ),
      null,
    );
    assert.equal(
      this.#invocations.some(({ command }) =>
        /typescript.*panel|panel.*typescript/iu.test(command),
      ),
      false,
    );
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#statusController.unmount();
    this.#dom.window.close();
    for (const [name, descriptor] of [...this.#globalDescriptors].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }

  #assertEnvelope(response: DiagnosticsEnvelope, status: DiagnosticsStatus): void {
    assertExactFields(response, RESPONSE_FIELDS, `diagnostics.v2 ${status} response`);
    assert.equal(response.schemaVersion, SCHEMA_VERSION);
    assert.equal(response.operation, OPERATION);
    assert.equal(response.status, status);
    assert.equal(response.responseBytes, Buffer.byteLength(JSON.stringify(response), "utf8"));
    assert.ok(response.responseBytes <= MAX_RESPONSE_BYTES);
  }

  async #invokeDiagnostics(request: DiagnosticsRequest): Promise<DiagnosticsEnvelope> {
    const diagnostics = this.#adapter.diagnostics as unknown as (
      exactRequest: DiagnosticsRequest,
    ) => Promise<unknown>;
    return (await diagnostics.call(this.#adapter, structuredClone(request))) as DiagnosticsEnvelope;
  }

  #requireCapabilities(): RefactorKitCapabilities {
    assert.ok(this.#capabilities, "RefactorKit capabilities were not discovered");
    return this.#capabilities;
  }

  #requireDiagnostics(): DiagnosticsEnvelope {
    assert.ok(this.#diagnostics, "No production diagnostics.v2 response was accepted");
    return this.#diagnostics;
  }

  #requireRefusedDiagnostics(): DiagnosticsEnvelope {
    assert.ok(
      this.#refusedDiagnostics,
      "No production diagnostics.v2 refused response was accepted",
    );
    return this.#refusedDiagnostics;
  }

  #requireErrorDiagnostics(): DiagnosticsEnvelope {
    assert.ok(this.#errorDiagnostics, "No production diagnostics.v2 error response was accepted");
    return this.#errorDiagnostics;
  }
}
