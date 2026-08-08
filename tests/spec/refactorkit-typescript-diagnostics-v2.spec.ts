import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decideTypeScriptDiagnosticsRequest,
  normalizeTypeScriptDiagnosticsResponse,
  type TypeScriptDiagnosticsCompilerAttestation,
  type TypeScriptDiagnosticsPolicyInput,
  type TypeScriptDiagnosticsReadyResponse,
  type TypeScriptDiagnosticsRequest,
  type TypeScriptDiagnosticsResponseRuntime,
  type TypeScriptDiagnosticsSourceAuthorityRequest,
} from "../../packages/contracts/src/domain/refactorkit-typescript-diagnostics";
import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
} from "../../packages/contracts/src/refactorkit";

const operationRuntime = Object.freeze({
  executionMode: "external-process",
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: Object.freeze({
    requestTimeoutMillis: 30_000,
    maxInputBytes: 536_870_912,
    maxOutputBytes: 8_388_608,
    maxProcesses: 1,
  }),
}) satisfies RefactorKitLanguageAdapterRuntime;

const responseRuntime = Object.freeze({
  ...operationRuntime,
  limits: Object.freeze({
    ...operationRuntime.limits,
    maxStderrBytes: 65_536,
    compilerHeapMiB: 512,
    maxDiagnostics: 500,
    maxDiagnosticMessageChars: 4_096,
    maxResponseBytes: 2_097_152,
  }),
}) satisfies TypeScriptDiagnosticsResponseRuntime;

const sourceAuthority = Object.freeze({
  kind: "immutable-editor-overlay",
  documents: Object.freeze([
    Object.freeze({
      path: "src/broken.ts",
      version: 9,
      content: 'const amount: number = "wrong";\n',
    }),
  ]),
}) satisfies TypeScriptDiagnosticsSourceAuthorityRequest;

const compilerAttestation = Object.freeze({
  toolchainProvider: "typescript-lsp-explicit-v1",
  nodeVersion: "22.23.0",
  typeScriptVersion: "5.9.3",
  compilerSha256: "e".repeat(64),
  toolchainEvidenceSha256: "f".repeat(64),
  process: Object.freeze({
    executableSha256: "1".repeat(64),
    argumentsSha256: "2".repeat(64),
    processId: 42,
  }),
}) satisfies TypeScriptDiagnosticsCompilerAttestation;

function capabilities(): RefactorKitCapabilities {
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.7.0-SNAPSHOT",
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: "experimental",
    },
    languageKernel: {
      available: true,
      schema: {
        schemaVersion: 1,
        adapters: [
          {
            languageId: "typescript",
            extensions: ["ts", "tsx"],
            backend: "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
            runtime: structuredClone(operationRuntime),
            capabilities: [
              {
                operation: "diagnostics",
                stability: "experimental",
                evidence: "compiler",
                mutationAuthority: "none",
                backend: "typescript-compiler-exact-v1",
                runtime: structuredClone(operationRuntime),
                extensions: ["ts", "tsx"],
              },
            ],
          },
        ],
        vocabulary: {
          stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
          evidence: [
            "compiler",
            "language-server",
            "native-ast",
            "structural-parse",
            "lexical",
            "none",
          ],
          mutationAuthority: ["managed-stable", "proposal-only", "none"],
          executionMode: ["in-process", "external-process"],
        },
      },
    },
  };
}

function policyInput(): TypeScriptDiagnosticsPolicyInput {
  return {
    languageId: "typescript",
    sourceExtension: "ts",
    requestId: "desktop-diagnostics-1",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    authorizedWorkspaceId: "workspace:authorized",
    authorizedWorkspaceGeneration: 7,
    snapshotHash: "b".repeat(64),
    sourceAuthority: structuredClone(sourceAuthority),
    capabilities: capabilities(),
    semanticSession: {
      state: "ready",
      qualification: "qualified",
      languageId: "typescript",
      workspaceId: "workspace:authorized",
      workspaceGeneration: 7,
      sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
      semanticLease: "semantic-00000000-0000-4000-8000-000000000001",
      snapshotHash: "b".repeat(64),
      providerVersion: "0.7.0-SNAPSHOT",
      toolchain: {
        evidence: "compiler",
        backend: "typescript-compiler-exact-v1",
        runtime: structuredClone(operationRuntime),
        extensions: ["ts", "tsx"],
      },
    },
  };
}

function request(): Readonly<TypeScriptDiagnosticsRequest> {
  const decision = decideTypeScriptDiagnosticsRequest(policyInput());
  if (decision.kind !== "ready") throw new Error(`Expected ready, got ${decision.reason}`);
  return decision.request;
}

const exactDiagnostic = Object.freeze({
  severity: "error",
  message: "Type 'string' is not assignable to type 'number'.",
  code: "TS2322",
  evidence: "compiler",
  category: "type-resolution",
  location: Object.freeze({
    kind: "range",
    path: "src/broken.ts",
    encoding: "utf-16",
    range: Object.freeze({
      start: Object.freeze({ line: 0, character: 6 }),
      end: Object.freeze({ line: 0, character: 12 }),
    }),
  }),
});

function response(status: "ready" | "refused" | "error" = "ready"): Record<string, unknown> {
  const currentRequest = request();
  const diagnostics = status === "ready" ? [structuredClone(exactDiagnostic)] : [];
  const candidate: Record<string, unknown> = {
    schemaVersion: 2,
    operation: "diagnostics.v2",
    requestId: currentRequest.requestId,
    languageId: "typescript",
    status,
    workspaceId: currentRequest.workspaceId,
    workspaceGeneration: currentRequest.workspaceGeneration,
    sessionId: currentRequest.sessionId,
    provider: { name: "refactorkit", version: "0.7.0-SNAPSHOT", apiVersion: "0.2" },
    backend: "typescript-compiler-exact-v1",
    semanticLease: currentRequest.semanticLease,
    projectSnapshotHash: currentRequest.expectedSnapshotHash,
    providerSnapshotHash: "c".repeat(64),
    sourceAuthority: {
      kind: "immutable-editor-overlay",
      baseSnapshotHash: currentRequest.expectedSnapshotHash,
      overlayHash: "3".repeat(64),
      providerSnapshotHash: "c".repeat(64),
      documents: [{ path: "src/broken.ts", version: 9, contentSha256: "4".repeat(64) }],
    },
    rangeEncoding: "utf-16",
    rangeCapability: "exact-utf16-or-explicit-partial",
    runtime: structuredClone(responseRuntime),
    compilerAttestation: status === "refused" ? null : structuredClone(compilerAttestation),
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
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    candidate.responseBytes = bytes;
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") === bytes) return candidate;
  }
  throw new Error("response byte count did not converge");
}

function normalize(candidate: unknown, exactRequest = request()) {
  return normalizeTypeScriptDiagnosticsResponse({
    request: exactRequest,
    candidate,
    advertisedRuntime: responseRuntime,
    acceptedCompilerAttestation: compilerAttestation,
  });
}

function mutateResponse(change: (candidate: Record<string, unknown>) => void) {
  const candidate = response();
  change(candidate);
  if ("responseBytes" in candidate) {
    candidate.responseBytes = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
      candidate.responseBytes = bytes;
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") === bytes) break;
    }
  }
  return candidate;
}

describe("@REQ-REFACTORKIT-TS-001 diagnostics.v2 strict contract", () => {
  it("reuses qualified readiness to create the immutable correlated schema-v2 request", () => {
    const decision = decideTypeScriptDiagnosticsRequest(policyInput());

    expect(decision).toEqual({
      kind: "ready",
      request: {
        schemaVersion: 2,
        operation: "diagnostics.v2",
        requestId: "desktop-diagnostics-1",
        languageId: "typescript",
        workspaceId: "workspace:authorized",
        workspaceGeneration: 7,
        sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
        expectedSnapshotHash: "b".repeat(64),
        semanticLease: "semantic-00000000-0000-4000-8000-000000000001",
        sourceAuthority,
      },
    });
    if (decision.kind !== "ready") throw new Error("Expected diagnostics readiness");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.request)).toBe(true);
    expect(Object.isFrozen(decision.request.sourceAuthority)).toBe(true);
    expect(Object.isFrozen(decision.request.sourceAuthority.documents)).toBe(true);
    expect(Object.isFrozen(decision.request.sourceAuthority.documents[0])).toBe(true);
    expectTypeOf(decision.request).toEqualTypeOf<Readonly<TypeScriptDiagnosticsRequest>>();
  });

  it.each([
    ["blank", "", "invalid-request-id"],
    ["control-bearing", "diagnostics\u0000request", "invalid-request-id"],
    ["overlong", "x".repeat(129), "invalid-request-id"],
  ] as const)("refuses a %s opaque request identity", (_case, requestId, reason) => {
    const value = policyInput();
    value.requestId = requestId;
    expect(decideTypeScriptDiagnosticsRequest(value)).toEqual({ kind: "refused", reason });
  });

  it("fails closed before invocation on an invalid semantic lease or malformed source authority", () => {
    const staleLease = policyInput();
    if (staleLease.semanticSession.state !== "ready") throw new Error("Expected ready session");
    staleLease.semanticSession.semanticLease = "stale-lease";
    expect(decideTypeScriptDiagnosticsRequest(staleLease)).toEqual({
      kind: "refused",
      reason: "semantic-session-lease-invalid",
    });

    const missingDocumentField = policyInput();
    missingDocumentField.sourceAuthority = {
      kind: "immutable-editor-overlay",
      documents: [{ path: "src/broken.ts", version: 9 }],
    } as unknown as TypeScriptDiagnosticsSourceAuthorityRequest;
    expect(decideTypeScriptDiagnosticsRequest(missingDocumentField)).toEqual({
      kind: "refused",
      reason: "source-authority-invalid",
    });

    const extraDocumentField = policyInput();
    extraDocumentField.sourceAuthority = {
      kind: "immutable-editor-overlay",
      documents: [{ path: "src/broken.ts", version: 9, content: "", fallback: true }],
    } as unknown as TypeScriptDiagnosticsSourceAuthorityRequest;
    expect(decideTypeScriptDiagnosticsRequest(extraDocumentField)).toEqual({
      kind: "refused",
      reason: "source-authority-invalid",
    });
  });

  it("accepts one complete ready result with exact compiler attestation and UTF-16 diagnostics", () => {
    const decision = normalize(response());

    expect(decision.kind).toBe("accepted");
    if (decision.kind !== "accepted" || decision.response.status !== "ready") {
      throw new Error("Expected accepted ready diagnostics");
    }
    expect(decision.response.diagnostics).toEqual([exactDiagnostic]);
    expect(decision.response.backend).toBe("typescript-compiler-exact-v1");
    expect(decision.response.compilerAttestation).toEqual(compilerAttestation);
    expect(Object.isFrozen(decision.response)).toBe(true);
    expect(Object.isFrozen(decision.response.diagnostics)).toBe(true);
    expect(Object.isFrozen(decision.response.diagnostics[0]?.location.range.start)).toBe(true);
    expectTypeOf(decision.response).toEqualTypeOf<Readonly<TypeScriptDiagnosticsReadyResponse>>();
  });

  it.each(["refused", "error"] as const)(
    "accepts a correlated structured %s response only without diagnostics",
    (status) => {
      const decision = normalize(response(status));
      expect(decision.kind).toBe("accepted");
      if (decision.kind !== "accepted") throw new Error("Expected accepted terminal response");
      expect(decision.response.status).toBe(status);
      expect(decision.response.failure).not.toBeNull();
      expect(decision.response.diagnostics).toEqual([]);
    },
  );

  it.each([
    ["schema version", (value: Record<string, unknown>): void => void (value.schemaVersion = 1)],
    ["operation", (value: Record<string, unknown>): void => void (value.operation = "diagnostics")],
    [
      "request identity",
      (value: Record<string, unknown>): void => void (value.requestId = "stale-request"),
    ],
    [
      "workspace",
      (value: Record<string, unknown>): void => void (value.workspaceId = "workspace:other"),
    ],
    ["generation", (value: Record<string, unknown>): void => void (value.workspaceGeneration = 6)],
    ["session", (value: Record<string, unknown>): void => void (value.sessionId = "stale-session")],
    [
      "snapshot",
      (value: Record<string, unknown>): void => void (value.projectSnapshotHash = "d".repeat(64)),
    ],
    [
      "semantic lease",
      (value: Record<string, unknown>): void =>
        void (value.semanticLease = "semantic-00000000-0000-4000-8000-000000000002"),
    ],
  ] as const)("rejects a stale or mismatched %s", (_case, change) => {
    expect(normalize(mutateResponse(change))).toEqual({
      kind: "rejected",
      reason: "response-correlation-mismatch",
    });
  });

  it("rejects mismatched provider-snapshot and source-document authority", () => {
    expect(
      normalize(
        mutateResponse((value) => {
          const authority = value.sourceAuthority as Record<string, unknown>;
          authority.providerSnapshotHash = "9".repeat(64);
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "response-source-authority-mismatch" });

    expect(
      normalize(
        mutateResponse((value) => {
          const authority = value.sourceAuthority as { documents: Record<string, unknown>[] };
          authority.documents[0]!.version = 8;
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "response-source-authority-mismatch" });
  });

  it("rejects an unaccepted compiler backend or toolchain identity", () => {
    expect(
      normalize(mutateResponse((value) => (value.backend = "typescript-language-server"))),
    ).toEqual({ kind: "rejected", reason: "response-backend-mismatch" });

    expect(
      normalize(
        mutateResponse((value) => {
          const attestation = value.compilerAttestation as Record<string, unknown>;
          attestation.compilerSha256 = "9".repeat(64);
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "response-attestation-mismatch" });
  });

  it.each([
    [
      "negative point",
      (value: Record<string, unknown>) => {
        const diagnostic = (value.diagnostics as Record<string, unknown>[])[0]!;
        const location = diagnostic.location as Record<string, unknown>;
        const range = location.range as Record<string, unknown>;
        (range.start as Record<string, unknown>).character = -1;
      },
    ],
    [
      "fractional point",
      (value: Record<string, unknown>) => {
        const diagnostic = (value.diagnostics as Record<string, unknown>[])[0]!;
        const location = diagnostic.location as Record<string, unknown>;
        const range = location.range as Record<string, unknown>;
        (range.end as Record<string, unknown>).line = 0.5;
      },
    ],
    [
      "reversed range",
      (value: Record<string, unknown>) => {
        const diagnostic = (value.diagnostics as Record<string, unknown>[])[0]!;
        const location = diagnostic.location as Record<string, unknown>;
        const range = location.range as Record<string, unknown>;
        (range.end as Record<string, unknown>).character = 5;
      },
    ],
    [
      "wrong encoding",
      (value: Record<string, unknown>) => {
        const diagnostic = (value.diagnostics as Record<string, unknown>[])[0]!;
        (diagnostic.location as Record<string, unknown>).encoding = "utf-8";
      },
    ],
  ] as const)("fails closed on an unsafe exact range: %s", (_case, change) => {
    expect(normalize(mutateResponse(change))).toEqual({
      kind: "rejected",
      reason: "response-diagnostic-invalid",
    });
  });

  it("rejects unstable diagnostic severity, code, evidence, message, or file representation", () => {
    const changes = [
      (diagnostic: Record<string, unknown>): void => void (diagnostic.severity = "fatal"),
      (diagnostic: Record<string, unknown>): void => void (diagnostic.code = 2322),
      (diagnostic: Record<string, unknown>): void => void (diagnostic.evidence = "fallback"),
      (diagnostic: Record<string, unknown>): void => void (diagnostic.message = ""),
      (diagnostic: Record<string, unknown>): void => {
        (diagnostic.location as Record<string, unknown>).path = "src/other.ts";
      },
    ];
    for (const change of changes) {
      expect(
        normalize(
          mutateResponse((value) => change((value.diagnostics as Record<string, unknown>[])[0]!)),
        ),
      ).toEqual({ kind: "rejected", reason: "response-diagnostic-invalid" });
    }
  });

  it("rejects truncated, count-incomplete, oversized, or runtime-mismatched responses", () => {
    expect(normalize(mutateResponse((value) => (value.truncated = true)))).toEqual({
      kind: "rejected",
      reason: "response-incomplete",
    });
    expect(normalize(mutateResponse((value) => (value.diagnosticsTotal = 2)))).toEqual({
      kind: "rejected",
      reason: "response-incomplete",
    });
    expect(
      normalize(
        mutateResponse((value) => {
          const runtime = value.runtime as { limits: Record<string, unknown> };
          runtime.limits.maxDiagnostics = 1_000;
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "response-runtime-mismatch" });
    const oversized = response();
    oversized.responseBytes = 2_097_153;
    expect(normalize(oversized)).toEqual({
      kind: "rejected",
      reason: "response-bounds-exceeded",
    });
  });

  it("fails closed on extra, missing, or wrongly typed fields at every contract boundary", () => {
    expect(normalize(mutateResponse((value) => (value.stdout = "fallback")))).toEqual({
      kind: "rejected",
      reason: "response-schema-invalid",
    });
    expect(
      normalize(
        mutateResponse((value) => {
          delete value.providerSnapshotHash;
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "response-schema-invalid" });
    expect(normalize(mutateResponse((value) => (value.status = 1)))).toEqual({
      kind: "rejected",
      reason: "response-schema-invalid",
    });
    expect(normalize(mutateResponse((value) => (value.status = "checking")))).toEqual({
      kind: "rejected",
      reason: "response-schema-invalid",
    });
    expect(
      normalize(
        mutateResponse((value) => {
          const provider = value.provider as Record<string, unknown>;
          provider.unadvertised = true;
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "response-schema-invalid" });
  });

  it("rejects diagnostics attached to refused or error statuses", () => {
    for (const status of ["refused", "error"] as const) {
      const candidate = response(status);
      candidate.diagnostics = [structuredClone(exactDiagnostic)];
      candidate.diagnosticsTotal = 1;
      candidate.diagnosticsReturned = 1;
      candidate.responseBytes = 0;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
        candidate.responseBytes = bytes;
        if (Buffer.byteLength(JSON.stringify(candidate), "utf8") === bytes) break;
      }
      expect(normalize(candidate)).toEqual({
        kind: "rejected",
        reason: "response-status-invalid",
      });
    }
  });
});
