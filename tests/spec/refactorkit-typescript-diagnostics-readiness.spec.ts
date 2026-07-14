import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decideTypeScriptDiagnosticsRequest,
  type TypeScriptDiagnosticsPolicyInput,
  type TypeScriptDiagnosticsRequest,
  type TypeScriptDiagnosticsSemanticSession,
} from "../../packages/contracts/src/domain/refactorkit-typescript-diagnostics";
import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
} from "../../packages/contracts/src/refactorkit";

const runtime = Object.freeze({
  executionMode: "external-process",
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: Object.freeze({
    requestTimeoutMillis: 10_000,
    maxInputBytes: 8 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
    maxProcesses: 8,
  }),
}) satisfies RefactorKitLanguageAdapterRuntime;

function capabilities(): RefactorKitCapabilities {
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "an-arbitrary-provider-name",
    providerVersion: "0.6.2",
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
            backend: "composite-adapter-description",
            runtime: structuredClone(runtime),
            capabilities: [
              {
                operation: "diagnostics",
                stability: "experimental",
                evidence: "compiler",
                mutationAuthority: "none",
                backend: "typescript-semantic-diagnostics-v1",
                runtime: structuredClone(runtime),
                extensions: ["ts", "tsx"],
              },
            ],
          },
        ],
        vocabulary: {
          stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
          evidence: ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
          mutationAuthority: ["managed-stable", "proposal-only", "none"],
          executionMode: ["in-process", "external-process"],
        },
      },
    },
  };
}

function readySession(): TypeScriptDiagnosticsSemanticSession {
  return {
    state: "ready",
    qualification: "qualified",
    languageId: "typescript",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    sessionId: "typescript-session:7",
    snapshotHash: "sha256:current-source-snapshot",
    providerVersion: "0.6.2",
    toolchain: {
      evidence: "compiler",
      backend: "typescript-semantic-diagnostics-v1",
      runtime: structuredClone(runtime),
      extensions: ["ts", "tsx"],
    },
  };
}

function input(): TypeScriptDiagnosticsPolicyInput {
  return {
    languageId: "typescript",
    sourceExtension: "ts",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    authorizedWorkspaceId: "workspace:authorized",
    authorizedWorkspaceGeneration: 7,
    snapshotHash: "sha256:current-source-snapshot",
    capabilities: capabilities(),
    semanticSession: readySession(),
  };
}

function mutate(
  change: (value: TypeScriptDiagnosticsPolicyInput) => void,
): TypeScriptDiagnosticsPolicyInput {
  const value = structuredClone(input());
  change(value);
  return value;
}

describe("@REQ-REFACTORKIT-TS-001 TypeScript diagnostics readiness", () => {
  it("authorizes one exact advertised semantic operation and creates an immutable current-snapshot request", () => {
    const decision = decideTypeScriptDiagnosticsRequest(input());

    expect(decision).toEqual({
      kind: "ready",
      request: {
        languageId: "typescript",
        workspaceId: "workspace:authorized",
        workspaceGeneration: 7,
        sessionId: "typescript-session:7",
        snapshotHash: "sha256:current-source-snapshot",
        providerVersion: "0.6.2",
        backend: "typescript-semantic-diagnostics-v1",
      },
    });
    if (decision.kind !== "ready") throw new Error("Expected diagnostics readiness");

    expect(Object.isFrozen(decision.request)).toBe(true);
    expectTypeOf(decision.request).toEqualTypeOf<Readonly<TypeScriptDiagnosticsRequest>>();
  });

  it("does not infer readiness from the provider name", () => {
    const value = input();
    value.capabilities.provider = "contains-typescript-compiler-ready";

    expect(decideTypeScriptDiagnosticsRequest(value).kind).toBe("ready");

    value.capabilities.languageKernel = {
      available: false,
      schema: null,
      reason: "semantic toolchain discovery unavailable",
    };
    expect(decideTypeScriptDiagnosticsRequest(value)).toEqual({
      kind: "refused",
      reason: "capability-absent",
    });
  });

  it.each([
    ["a non-TypeScript language", "invalid-language-id", (value: TypeScriptDiagnosticsPolicyInput) => { value.languageId = "javascript"; }],
    ["a blank workspace identifier", "invalid-workspace-id", (value: TypeScriptDiagnosticsPolicyInput) => { value.workspaceId = "  "; }],
    ["a nonpositive generation", "workspace-generation-nonpositive", (value: TypeScriptDiagnosticsPolicyInput) => { value.workspaceGeneration = 0; }],
    ["a stale generation", "workspace-generation-stale", (value: TypeScriptDiagnosticsPolicyInput) => { value.authorizedWorkspaceGeneration = 8; }],
    ["an unauthorized workspace", "workspace-unauthorized", (value: TypeScriptDiagnosticsPolicyInput) => { value.authorizedWorkspaceId = "workspace:other"; }],
    ["an absent snapshot identity", "snapshot-identity-absent", (value: TypeScriptDiagnosticsPolicyInput) => { value.snapshotHash = " "; }],
    ["an unavailable language kernel", "capability-absent", (value: TypeScriptDiagnosticsPolicyInput) => { value.capabilities.languageKernel = { available: false, schema: null, reason: "unavailable" }; }],
    ["an absent diagnostics operation", "capability-absent", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities = []; }],
    ["an ambiguous diagnostics operation", "capability-ambiguous", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities.push(structuredClone(kernel.schema.adapters[0]!.capabilities[0]!)); }],
    ["proposal-only diagnostic authority", "capability-proposal-inappropriate", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities[0]!.mutationAuthority = "proposal-only"; }],
    ["refused operation stability", "capability-stability-inappropriate", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities[0]!.stability = "refused"; }],
    ["nonsemantic operation evidence", "capability-evidence-unqualified", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities[0]!.evidence = "structural-parse"; }],
    ["a blank operation backend", "capability-backend-unauthorized", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities[0]!.backend = ""; }],
    ["a runtime without workspace overlays", "capability-runtime-unauthorized", (value: TypeScriptDiagnosticsPolicyInput) => { const kernel = value.capabilities.languageKernel; if (kernel?.available) kernel.schema.adapters[0]!.capabilities[0]!.runtime.usesWorkspaceOverlay = false; }],
    ["an extension not owned by the operation", "capability-extensions-unauthorized", (value: TypeScriptDiagnosticsPolicyInput) => { value.sourceExtension = "mts"; }],
    ["an unavailable semantic session", "semantic-toolchain-unavailable", (value: TypeScriptDiagnosticsPolicyInput) => { value.semanticSession = { state: "unavailable", reason: "not started" }; }],
    ["an unqualified semantic session", "semantic-toolchain-unqualified", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.qualification = "unqualified"; }],
    ["a blank session identifier", "invalid-session-id", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.sessionId = ""; }],
    ["session authority from another generation", "semantic-session-authority-mismatch", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.workspaceGeneration = 6; }],
    ["a hash-unbound semantic session", "semantic-session-hash-unbound", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.snapshotHash = null; }],
    ["a session bound to an older snapshot", "semantic-session-snapshot-mismatch", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.snapshotHash = "sha256:older-snapshot"; }],
    ["absent diagnostic provider version evidence", "provider-version-unavailable", (value: TypeScriptDiagnosticsPolicyInput) => { value.capabilities.providerVersion = null; }],
    ["provider version evidence from another session", "provider-version-mismatch", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.providerVersion = "0.6.1"; }],
    ["a toolchain backend other than the advertised operation backend", "semantic-toolchain-mismatch", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.toolchain.backend = "another-backend"; }],
    ["runtime evidence other than the advertised operation runtime", "semantic-toolchain-mismatch", (value: TypeScriptDiagnosticsPolicyInput) => { const session = value.semanticSession; if (session.state === "ready") session.toolchain.runtime.limits.maxInputBytes = 4 * 1024 * 1024; }],
  ] as const)("refuses before invocation for %s", (_case, reason, change) => {
    expect(decideTypeScriptDiagnosticsRequest(mutate(change))).toEqual({
      kind: "refused",
      reason,
    });
  });
});
