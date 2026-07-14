import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decideSavedSnapshotDefinitionRequest,
  decideSavedSnapshotSemanticSessionStartRequest,
  decideSavedSnapshotSemanticSessionStopRequest,
  decideSavedSnapshotSymbolSearchRequest,
  normalizeProviderPoint,
  normalizeSavedSnapshotDefinitionResult,
  normalizeSavedSnapshotSemanticSessionStartResult,
  normalizeSavedSnapshotSemanticSessionStopResult,
  normalizeSavedSnapshotSymbolSearchResult,
  type SavedSnapshotDefinitionRequest,
  type SavedSnapshotDefinitionResult,
  type SavedSnapshotDefinitionResultCandidate,
  type SavedSnapshotSemanticSessionStartPolicyInput,
  type SavedSnapshotSemanticSessionStartRequest,
  type SavedSnapshotSemanticSessionStartResult,
  type SavedSnapshotSemanticSessionStartResultCandidate,
  type SavedSnapshotSemanticSessionStopRequest,
  type SavedSnapshotSemanticSessionStopResult,
  type SavedSnapshotSymbolSearchPolicyInput,
  type SavedSnapshotSymbolSearchRequest,
  type SavedSnapshotSymbolSearchResult,
  type SavedSnapshotSymbolSearchResultCandidate,
  type TypeScriptJavaScriptSemanticSession,
} from "../../packages/contracts/src/domain/refactorkit-typescript-symbol-navigation";
import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
  RefactorKitLanguageCapability,
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

const approvedToolchain = {
  userApproved: true,
  nodeExecutable: "/opt/refactorkit-toolchains/node/bin/node",
  languageServerPackageRoot: "/opt/refactorkit-toolchains/typescript-language-server",
  typeScriptPackageRoot: "/opt/refactorkit-toolchains/typescript",
  allowPathNodeDiscovery: false,
  allowWorkspaceLocalToolchain: false,
} as const;

function operation(operation: "workspaceSymbols" | "definition"): RefactorKitLanguageCapability {
  return {
    operation,
    stability: "experimental",
    evidence: "language-server",
    mutationAuthority: "none",
    backend: "typescript-lsp-explicit-v1",
    runtime: structuredClone(runtime),
    extensions: ["ts", "tsx"],
  };
}

function capabilities(): RefactorKitCapabilities {
  return {
    api: "semantic-tools",
    apiVersion: "1",
    provider: "an-arbitrary-provider-name",
    providerVersion: "7.4.1",
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
            backend: "provider-composite-description",
            runtime: structuredClone(runtime),
            capabilities: [operation("workspaceSymbols"), operation("definition")],
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

function activeSession(): Extract<TypeScriptJavaScriptSemanticSession, { state: "active" }> {
  return {
    state: "active",
    languageId: "typescript",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    sessionId: "typescript-session:7",
    snapshot: { state: "saved", identity: "snapshot:provider-current" },
    providerVersion: "7.4.1",
    toolchain: {
      backend: "typescript-lsp-explicit-v1",
      runtime: structuredClone(runtime),
      extensions: ["ts", "tsx"],
      nodeExecutable: approvedToolchain.nodeExecutable,
      languageServerPackageRoot: approvedToolchain.languageServerPackageRoot,
      typeScriptPackageRoot: approvedToolchain.typeScriptPackageRoot,
    },
  };
}

function input(): SavedSnapshotSymbolSearchPolicyInput {
  return {
    languageId: "typescript",
    sourceExtension: "ts",
    workspaceRoot: "/workspace/authorized",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    authorizedWorkspaceId: "workspace:authorized",
    authorizedWorkspaceGeneration: 7,
    currentSavedSnapshotIdentity: "snapshot:provider-current",
    query: "  Service  ",
    capabilities: capabilities(),
    semanticSession: activeSession(),
    approvedToolchain: structuredClone(approvedToolchain),
    relevantBuffers: [
      { path: "/workspace/authorized/src/service.ts", savedState: "saved", dirty: false },
    ],
    javascriptCompatibility: {
      semantics: "not-dynamic-or-mixed",
      incompletenessDisclosure: "not-shown",
    },
    fallback: "none",
  };
}

function mutate(
  change: (value: SavedSnapshotSymbolSearchPolicyInput) => void,
): SavedSnapshotSymbolSearchPolicyInput {
  const value = structuredClone(input());
  change(value);
  return value;
}

function currentResult(): SavedSnapshotSymbolSearchResultCandidate {
  return {
    languageId: "typescript",
    query: "Service",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    sessionId: "typescript-session:7",
    snapshotIdentity: "snapshot:provider-current",
    providerVersion: "7.4.1",
    backend: "typescript-lsp-explicit-v1",
    completeness: {
      resultCompleteness: "unknown",
      truncation: "unknown",
      semanticCompleteness: "full-typescript",
      experimentalDisclosure: "shown",
    },
    symbols: [
      {
        id: `lsp-symbol-v1:${"a".repeat(64)}`,
        name: "Service",
        kind: "class",
      },
    ],
  };
}

function firstCapability(value: SavedSnapshotSymbolSearchPolicyInput, index = 0) {
  const kernel = value.capabilities.languageKernel;
  if (!kernel?.available) throw new Error("Expected available test capability");
  return kernel.schema.adapters[0]!.capabilities[index]!;
}

function startInput(): SavedSnapshotSemanticSessionStartPolicyInput {
  return {
    languageId: "typescript",
    sourceExtension: "ts",
    workspaceRoot: "/workspace/authorized",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    authorizedWorkspaceRoot: "/workspace/authorized",
    authorizedWorkspaceId: "workspace:authorized",
    currentWorkspaceGeneration: 7,
    providerVersion: "7.4.1",
    backend: "typescript-lsp-explicit-v1",
    capabilities: capabilities(),
    approvedToolchain: structuredClone(approvedToolchain),
    relevantBuffers: [
      { path: "/workspace/authorized/src/service.ts", savedState: "saved", dirty: false },
    ],
    javascriptCompatibility: {
      semantics: "not-dynamic-or-mixed",
      incompletenessDisclosure: "not-shown",
    },
  };
}

function startCandidate(): SavedSnapshotSemanticSessionStartResultCandidate {
  return {
    languageId: "typescript",
    workspaceRoot: "/workspace/authorized",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    sessionId: `refactorkit-semantic-session-v1:${"d".repeat(64)}`,
    providerProjectSnapshotIdentity: `sha256:${"c".repeat(64)}`,
    provider: "an-arbitrary-provider-name",
    providerVersion: "7.4.1",
    backend: "typescript-lsp-explicit-v1",
    toolchain: {
      backend: "typescript-lsp-explicit-v1",
      runtime: structuredClone(runtime),
      extensions: ["ts", "tsx"],
      nodeExecutable: approvedToolchain.nodeExecutable,
      languageServerPackageRoot: approvedToolchain.languageServerPackageRoot,
      typeScriptPackageRoot: approvedToolchain.typeScriptPackageRoot,
    },
    semanticCompleteness: "full-typescript",
    processProvenance: {
      serverName: "typescript-language-server",
      serverVersion: "4.3.4",
      capabilitiesSha256: "1".repeat(64),
      executableSha256: "2".repeat(64),
      argumentsSha256: "3".repeat(64),
      processId: 42,
    },
  };
}

function startSession(): SavedSnapshotSemanticSessionStartResult {
  const start = decideSavedSnapshotSemanticSessionStartRequest(startInput());
  if (start.kind !== "ready") throw new Error("Expected start authorization");
  const normalized = normalizeSavedSnapshotSemanticSessionStartResult({
    request: start.request,
    candidate: startCandidate(),
  });
  if (normalized.kind !== "ready") throw new Error("Expected normalized start result");
  return normalized.result;
}

describe("@REQ-REFACTORKIT-TS-002 saved-snapshot semantic-session lifecycle", () => {
  it("creates an immutable qualified start request without a caller-invented session or snapshot identity", () => {
    const decision = decideSavedSnapshotSemanticSessionStartRequest(startInput());

    expect(decision).toEqual({
      kind: "ready",
      request: {
        languageId: "typescript",
        workspaceRoot: "/workspace/authorized",
        workspaceId: "workspace:authorized",
        workspaceGeneration: 7,
        provider: "an-arbitrary-provider-name",
        providerVersion: "7.4.1",
        backend: "typescript-lsp-explicit-v1",
        runtime,
        extensions: ["ts", "tsx"],
        toolchain: {
          nodeExecutable: approvedToolchain.nodeExecutable,
          languageServerPackageRoot: approvedToolchain.languageServerPackageRoot,
          typeScriptPackageRoot: approvedToolchain.typeScriptPackageRoot,
          allowPathNodeDiscovery: false,
          allowWorkspaceLocalToolchain: false,
        },
        acceptedSemanticCompleteness: ["full-typescript"],
      },
    });
    if (decision.kind !== "ready") throw new Error("Expected start authorization");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.request)).toBe(true);
    expect(Object.isFrozen(decision.request.runtime)).toBe(true);
    expect(Object.isFrozen(decision.request.runtime.limits)).toBe(true);
    expect(Object.isFrozen(decision.request.extensions)).toBe(true);
    expect(Object.isFrozen(decision.request.toolchain)).toBe(true);
    expectTypeOf(decision.request).toEqualTypeOf<
      Readonly<SavedSnapshotSemanticSessionStartRequest>
    >();
    expectTypeOf(decision.request).not.toHaveProperty("sessionId");
    expectTypeOf(decision.request).not.toHaveProperty("snapshotIdentity");
    expect(decision.request).not.toHaveProperty("sessionId");
    expect(decision.request).not.toHaveProperty("snapshotIdentity");
  });

  it("requires explicit disclosure before starting JavaScript that may be semantically incomplete", () => {
    const value = startInput();
    value.languageId = "javascript";
    value.sourceExtension = "js";
    value.javascriptCompatibility = {
      semantics: "dynamic-or-mixed",
      incompletenessDisclosure: "shown",
    };
    const kernel = value.capabilities.languageKernel;
    if (!kernel?.available) throw new Error("Expected available test capability");
    kernel.schema.adapters[0]!.languageId = "javascript";
    kernel.schema.adapters[0]!.extensions = ["js", "jsx"];
    for (const capability of kernel.schema.adapters[0]!.capabilities) {
      capability.extensions = ["js", "jsx"];
    }

    const decision = decideSavedSnapshotSemanticSessionStartRequest(value);
    expect(decision.kind).toBe("ready");
    if (decision.kind !== "ready") throw new Error("Expected JavaScript start authorization");
    expect(decision.request.acceptedSemanticCompleteness).toEqual([
      "dynamic-javascript",
      "mixed-javascript",
    ]);

    value.javascriptCompatibility.incompletenessDisclosure = "not-shown";
    expect(decideSavedSnapshotSemanticSessionStartRequest(value)).toEqual({
      kind: "refused",
      reason: "javascript-incompleteness-disclosure-required",
    });
  });

  it.each([
    [
      "unsupported language",
      "invalid-language-id",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.languageId = "java";
      },
    ],
    [
      "unauthorized root",
      "workspace-unauthorized",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.authorizedWorkspaceRoot = "/workspace/other";
      },
    ],
    [
      "unauthorized workspace identity",
      "workspace-unauthorized",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.authorizedWorkspaceId = "workspace:other";
      },
    ],
    [
      "stale generation",
      "workspace-generation-stale",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.currentWorkspaceGeneration = 8;
      },
    ],
    [
      "nonpositive generation",
      "workspace-generation-nonpositive",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.workspaceGeneration = 0;
      },
    ],
    [
      "provider version mismatch",
      "provider-version-mismatch",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.providerVersion = "7.4.0";
      },
    ],
    [
      "backend mismatch",
      "capability-backend-mismatch",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.backend = "another-backend";
      },
    ],
    [
      "missing definition operation",
      "capability-absent",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        const kernel = value.capabilities.languageKernel;
        if (kernel?.available) kernel.schema.adapters[0]!.capabilities.pop();
      },
    ],
    [
      "non-experimental operation",
      "capability-not-experimental",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        const kernel = value.capabilities.languageKernel;
        if (kernel?.available) kernel.schema.adapters[0]!.capabilities[0]!.stability = "stable";
      },
    ],
    [
      "toolchain without approval",
      "toolchain-unapproved",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.approvedToolchain.userApproved = false;
      },
    ],
    [
      "relative toolchain root",
      "toolchain-path-invalid",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.approvedToolchain.languageServerPackageRoot = "tools/typescript-language-server";
      },
    ],
    [
      "workspace-local toolchain",
      "toolchain-not-external",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.approvedToolchain.typeScriptPackageRoot =
          "/workspace/authorized/node_modules/typescript";
      },
    ],
    [
      "PATH discovery",
      "toolchain-discovery-enabled",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.approvedToolchain.allowPathNodeDiscovery = true;
      },
    ],
    [
      "workspace-local discovery",
      "toolchain-discovery-enabled",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.approvedToolchain.allowWorkspaceLocalToolchain = true;
      },
    ],
    [
      "never-saved relevant buffer",
      "relevant-buffer-unsaved",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.relevantBuffers[0]!.savedState = "never-saved";
      },
    ],
    [
      "dirty relevant buffer",
      "relevant-buffer-dirty",
      (value: SavedSnapshotSemanticSessionStartPolicyInput) => {
        value.relevantBuffers[0]!.dirty = true;
      },
    ],
  ] as const)("refuses semantic-session start for %s", (_case, reason, change) => {
    const value = structuredClone(startInput());
    change(value);
    expect(decideSavedSnapshotSemanticSessionStartRequest(value)).toEqual({
      kind: "refused",
      reason,
    });
  });

  it("normalizes the Rust-minted session, saved provider snapshot, semantic completeness, and exposed process provenance", () => {
    const start = decideSavedSnapshotSemanticSessionStartRequest(startInput());
    if (start.kind !== "ready") throw new Error("Expected start authorization");

    const decision = normalizeSavedSnapshotSemanticSessionStartResult({
      request: start.request,
      candidate: startCandidate(),
    });

    expect(decision).toEqual({ kind: "ready", result: startCandidate() });
    if (decision.kind !== "ready") throw new Error("Expected normalized start result");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.result)).toBe(true);
    expect(Object.isFrozen(decision.result.toolchain)).toBe(true);
    expect(Object.isFrozen(decision.result.toolchain.runtime)).toBe(true);
    expect(Object.isFrozen(decision.result.toolchain.runtime.limits)).toBe(true);
    expect(Object.isFrozen(decision.result.toolchain.extensions)).toBe(true);
    expect(Object.isFrozen(decision.result.processProvenance)).toBe(true);
    expectTypeOf(decision.result).toEqualTypeOf<
      Readonly<SavedSnapshotSemanticSessionStartResult>
    >();
    expectTypeOf(decision.result).not.toHaveProperty("compilerAttestation");
    expect(decision.result).not.toHaveProperty("compilerAttestation");
  });

  it.each([
    [
      "authority mismatch",
      "semantic-session-start-authority-mismatch",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.workspaceGeneration = 6;
      },
    ],
    [
      "provider mismatch",
      "semantic-session-start-provider-mismatch",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.providerVersion = "7.4.0";
      },
    ],
    [
      "backend mismatch",
      "semantic-session-start-backend-mismatch",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.backend = "another-backend";
      },
    ],
    [
      "toolchain mismatch",
      "semantic-session-start-toolchain-mismatch",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.toolchain.nodeExecutable = "/opt/other/node";
      },
    ],
    [
      "unsafe session identity",
      "semantic-session-identity-invalid",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.sessionId = "caller-session:7";
      },
    ],
    [
      "missing provider snapshot hash",
      "provider-project-snapshot-identity-invalid",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.providerProjectSnapshotIdentity = "sha256:";
      },
    ],
    [
      "semantic completeness mismatch",
      "semantic-session-completeness-mismatch",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.semanticCompleteness = "dynamic-javascript";
      },
    ],
    [
      "missing capability hash",
      "semantic-session-process-provenance-invalid",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.processProvenance.capabilitiesSha256 = "";
      },
    ],
    [
      "missing executable hash",
      "semantic-session-process-provenance-invalid",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.processProvenance.executableSha256 = "";
      },
    ],
    [
      "missing argument hash",
      "semantic-session-process-provenance-invalid",
      (candidate: SavedSnapshotSemanticSessionStartResultCandidate) => {
        candidate.processProvenance.argumentsSha256 = "";
      },
    ],
  ] as const)("refuses a start result with %s", (_case, reason, change) => {
    const start = decideSavedSnapshotSemanticSessionStartRequest(startInput());
    if (start.kind !== "ready") throw new Error("Expected start authorization");
    const candidate = structuredClone(startCandidate());
    change(candidate);
    expect(
      normalizeSavedSnapshotSemanticSessionStartResult({ request: start.request, candidate }),
    ).toEqual({ kind: "refused", reason });
  });

  it("refuses a start result that fabricates compiler attestation", () => {
    const start = decideSavedSnapshotSemanticSessionStartRequest(startInput());
    if (start.kind !== "ready") throw new Error("Expected start authorization");
    const candidate = startCandidate();
    Object.assign(candidate, { compilerAttestation: { compilerSha256: "4".repeat(64) } });

    expect(
      normalizeSavedSnapshotSemanticSessionStartResult({ request: start.request, candidate }),
    ).toEqual({ kind: "refused", reason: "compiler-attestation-unavailable" });
  });

  it("creates an immutable stop request bound to the minted session and current workspace generation", () => {
    const decision = decideSavedSnapshotSemanticSessionStopRequest({
      session: startSession(),
      currentWorkspaceId: "workspace:authorized",
      currentWorkspaceGeneration: 7,
    });

    expect(decision).toEqual({
      kind: "ready",
      request: {
        languageId: "typescript",
        workspaceId: "workspace:authorized",
        workspaceGeneration: 7,
        sessionId: `refactorkit-semantic-session-v1:${"d".repeat(64)}`,
      },
    });
    if (decision.kind !== "ready") throw new Error("Expected stop authorization");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.request)).toBe(true);
    expectTypeOf(decision.request).toEqualTypeOf<
      Readonly<SavedSnapshotSemanticSessionStopRequest>
    >();
  });

  it("refuses a stale caller from stopping a replacement workspace generation", () => {
    expect(
      decideSavedSnapshotSemanticSessionStopRequest({
        session: startSession(),
        currentWorkspaceId: "workspace:authorized",
        currentWorkspaceGeneration: 8,
      }),
    ).toEqual({ kind: "refused", reason: "semantic-session-stop-authority-mismatch" });
  });

  it("normalizes an immutable idempotent stop result only for the requested minted session", () => {
    const stop = decideSavedSnapshotSemanticSessionStopRequest({
      session: startSession(),
      currentWorkspaceId: "workspace:authorized",
      currentWorkspaceGeneration: 7,
    });
    if (stop.kind !== "ready") throw new Error("Expected stop authorization");
    const candidate = { ...stop.request, stopped: true };

    const decision = normalizeSavedSnapshotSemanticSessionStopResult({
      request: stop.request,
      candidate,
    });

    expect(decision).toEqual({ kind: "ready", result: candidate });
    if (decision.kind !== "ready") throw new Error("Expected normalized stop result");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.result)).toBe(true);
    expectTypeOf(decision.result).toEqualTypeOf<Readonly<SavedSnapshotSemanticSessionStopResult>>();

    expect(
      normalizeSavedSnapshotSemanticSessionStopResult({
        request: stop.request,
        candidate: { ...candidate, sessionId: `refactorkit-semantic-session-v1:${"e".repeat(64)}` },
      }),
    ).toEqual({ kind: "refused", reason: "semantic-session-stop-result-mismatch" });
  });
});

describe("@REQ-REFACTORKIT-TS-002 saved-snapshot symbol navigation policy", () => {
  it("authorizes the paired experimental semantic operations and creates an immutable provider-neutral search request", () => {
    const value = input();
    value.capabilities.provider = "a-provider-name-that-must-not-grant-authority";

    const decision = decideSavedSnapshotSymbolSearchRequest(value);

    expect(decision).toEqual({
      kind: "ready",
      request: {
        languageId: "typescript",
        query: "Service",
        workspaceId: "workspace:authorized",
        workspaceGeneration: 7,
        sessionId: "typescript-session:7",
        snapshotIdentity: "snapshot:provider-current",
        providerVersion: "7.4.1",
        backend: "typescript-lsp-explicit-v1",
        toolchain: {
          nodeExecutable: approvedToolchain.nodeExecutable,
          languageServerPackageRoot: approvedToolchain.languageServerPackageRoot,
          typeScriptPackageRoot: approvedToolchain.typeScriptPackageRoot,
          allowPathNodeDiscovery: false,
          allowWorkspaceLocalToolchain: false,
        },
      },
    });
    if (decision.kind !== "ready") throw new Error("Expected search authorization");

    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.request)).toBe(true);
    expect(Object.isFrozen(decision.request.toolchain)).toBe(true);
    expectTypeOf(decision.request).toEqualTypeOf<Readonly<SavedSnapshotSymbolSearchRequest>>();
  });

  it("authorizes dynamic or mixed JavaScript only with explicit incompleteness disclosure", () => {
    const value = input();
    value.languageId = "javascript";
    value.sourceExtension = "js";
    value.semanticSession = {
      ...activeSession(),
      languageId: "javascript",
      toolchain: { ...activeSession().toolchain, extensions: ["js", "jsx"] },
    };
    const kernel = value.capabilities.languageKernel;
    if (!kernel?.available) throw new Error("Expected available test capability");
    kernel.schema.adapters[0]!.languageId = "javascript";
    kernel.schema.adapters[0]!.extensions = ["js", "jsx"];
    for (const capability of kernel.schema.adapters[0]!.capabilities) {
      capability.extensions = ["js", "jsx"];
    }
    value.javascriptCompatibility = {
      semantics: "dynamic-or-mixed",
      incompletenessDisclosure: "shown",
    };

    expect(decideSavedSnapshotSymbolSearchRequest(value).kind).toBe("ready");

    value.javascriptCompatibility.incompletenessDisclosure = "not-shown";
    expect(decideSavedSnapshotSymbolSearchRequest(value)).toEqual({
      kind: "refused",
      reason: "javascript-incompleteness-disclosure-required",
    });
  });

  it.each([
    [
      "an unsupported language",
      "invalid-language-id",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.languageId = "java";
      },
    ],
    [
      "an invalid source extension",
      "invalid-source-extension",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.sourceExtension = ".ts";
      },
    ],
    [
      "a missing operation",
      "capability-absent",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        const kernel = value.capabilities.languageKernel;
        if (kernel?.available) kernel.schema.adapters[0]!.capabilities.pop();
      },
    ],
    [
      "an ambiguous operation pair",
      "capability-ambiguous",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        const kernel = value.capabilities.languageKernel;
        if (kernel?.available) {
          kernel.schema.adapters.push(structuredClone(kernel.schema.adapters[0]!));
        }
      },
    ],
    [
      "stable rather than experimental authority",
      "capability-not-experimental",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        firstCapability(value).stability = "stable";
      },
    ],
    [
      "structural rather than language-server evidence",
      "capability-not-language-server",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        firstCapability(value).evidence = "structural-parse";
      },
    ],
    [
      "mutation authority",
      "capability-mutation-authority-inappropriate",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        firstCapability(value).mutationAuthority = "proposal-only";
      },
    ],
    [
      "operation backend disagreement",
      "capability-backend-mismatch",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        firstCapability(value, 1).backend = "another-backend";
      },
    ],
    [
      "an operation runtime without cancellation",
      "capability-runtime-unauthorized",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        firstCapability(value).runtime.supportsCancellation = false;
      },
    ],
    [
      "operation runtime disagreement",
      "capability-runtime-mismatch",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        firstCapability(value, 1).runtime.limits.maxProcesses = 4;
      },
    ],
    [
      "an extension not advertised by every authority",
      "capability-extensions-unauthorized",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.sourceExtension = "mts";
      },
    ],
    [
      "missing provider-version evidence",
      "provider-version-unavailable",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.capabilities.providerVersion = null;
      },
    ],
    [
      "toolchain approval withheld",
      "toolchain-unapproved",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.approvedToolchain.userApproved = false;
      },
    ],
    [
      "a relative external toolchain path",
      "toolchain-path-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.approvedToolchain.nodeExecutable = "node/bin/node";
      },
    ],
    [
      "a workspace-local toolchain path",
      "toolchain-not-external",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.approvedToolchain.typeScriptPackageRoot =
          "/workspace/authorized/node_modules/typescript";
      },
    ],
    [
      "PATH discovery",
      "toolchain-discovery-enabled",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.approvedToolchain.allowPathNodeDiscovery = true;
      },
    ],
    [
      "workspace-local discovery",
      "toolchain-discovery-enabled",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.approvedToolchain.allowWorkspaceLocalToolchain = true;
      },
    ],
    [
      "an invalid workspace root",
      "workspace-root-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.workspaceRoot = "relative/workspace";
      },
    ],
    [
      "an invalid workspace identity",
      "workspace-identity-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.workspaceId = " workspace:authorized";
      },
    ],
    [
      "an unauthorized workspace",
      "workspace-unauthorized",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.authorizedWorkspaceId = "workspace:other";
      },
    ],
    [
      "a stale workspace generation",
      "workspace-generation-stale",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.authorizedWorkspaceGeneration = 8;
      },
    ],
    [
      "a nonpositive workspace generation",
      "workspace-generation-nonpositive",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.workspaceGeneration = 0;
      },
    ],
    [
      "an invalid current snapshot identity",
      "snapshot-identity-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.currentSavedSnapshotIdentity = " ";
      },
    ],
    [
      "an inactive semantic session",
      "semantic-session-inactive",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.semanticSession = { state: "unavailable", reason: "stopped" };
      },
    ],
    [
      "an invalid semantic session identity",
      "session-identity-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        if (value.semanticSession.state === "active") value.semanticSession.sessionId = " ";
      },
    ],
    [
      "a stale semantic session",
      "semantic-session-authority-mismatch",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        if (value.semanticSession.state === "active") {
          value.semanticSession.sessionId = "typescript-session:old";
          value.semanticSession.workspaceGeneration = 6;
        }
      },
    ],
    [
      "a stale provider snapshot",
      "semantic-session-snapshot-mismatch",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        if (value.semanticSession.state === "active") {
          value.semanticSession.snapshot = { state: "saved", identity: "snapshot:old" };
        }
      },
    ],
    [
      "an unsaved provider snapshot",
      "semantic-session-snapshot-unsaved",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        if (value.semanticSession.state === "active") {
          value.semanticSession.snapshot = { state: "unsaved" };
        }
      },
    ],
    [
      "a semantic session from another provider version",
      "semantic-session-provider-mismatch",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        if (value.semanticSession.state === "active") {
          value.semanticSession.providerVersion = "7.4.0";
        }
      },
    ],
    [
      "a session using another approved-toolchain identity",
      "semantic-session-toolchain-mismatch",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        if (value.semanticSession.state === "active") {
          value.semanticSession.toolchain.nodeExecutable = "/opt/other/node";
        }
      },
    ],
    [
      "an external relevant-buffer path",
      "relevant-buffer-path-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.relevantBuffers[0]!.path = "/other/service.ts";
      },
    ],
    [
      "a never-saved relevant buffer",
      "relevant-buffer-unsaved",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.relevantBuffers[0]!.savedState = "never-saved";
      },
    ],
    [
      "a dirty relevant buffer",
      "relevant-buffer-dirty",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.relevantBuffers[0]!.dirty = true;
      },
    ],
    [
      "an empty trimmed query",
      "query-empty",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.query = " \t ";
      },
    ],
    [
      "a query over 1024 UTF-16 code units",
      "query-too-long",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.query = "😀".repeat(513);
      },
    ],
    [
      "a query containing control characters",
      "query-invalid",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.query = "Ser\u0000vice";
      },
    ],
    [
      "a structural fallback",
      "fallback-prohibited",
      (value: SavedSnapshotSymbolSearchPolicyInput) => {
        value.fallback = "structural-identifiers";
      },
    ],
  ] as const)("refuses before search invocation for %s", (_case, reason, change) => {
    expect(decideSavedSnapshotSymbolSearchRequest(mutate(change))).toEqual({
      kind: "refused",
      reason,
    });
  });

  it("creates an immutable definition request only for an opaque identity selected from the current result", () => {
    const result = currentResult();
    const selectedSymbolId = result.symbols[0]!.id;

    const decision = decideSavedSnapshotDefinitionRequest({
      authorization: input(),
      currentSearchResult: result,
      selectedSymbolId,
    });

    expect(decision).toEqual({
      kind: "ready",
      request: {
        languageId: "typescript",
        symbolId: selectedSymbolId,
        workspaceId: "workspace:authorized",
        workspaceGeneration: 7,
        sessionId: "typescript-session:7",
        snapshotIdentity: "snapshot:provider-current",
        providerVersion: "7.4.1",
        backend: "typescript-lsp-explicit-v1",
      },
    });
    if (decision.kind !== "ready") throw new Error("Expected definition authorization");
    expect(decision.request.symbolId).toBe(selectedSymbolId);
    expect(Object.isFrozen(decision.request)).toBe(true);
    expectTypeOf(decision.request).toEqualTypeOf<Readonly<SavedSnapshotDefinitionRequest>>();
  });

  it.each([
    [
      "a stale result generation",
      "search-result-authority-mismatch",
      (result: SavedSnapshotSymbolSearchResultCandidate) => {
        result.workspaceGeneration = 6;
      },
    ],
    [
      "a stale result session",
      "search-result-session-mismatch",
      (result: SavedSnapshotSymbolSearchResultCandidate) => {
        result.sessionId = "typescript-session:old";
      },
    ],
    [
      "a stale result snapshot",
      "search-result-snapshot-mismatch",
      (result: SavedSnapshotSymbolSearchResultCandidate) => {
        result.snapshotIdentity = "snapshot:old";
      },
    ],
    [
      "another provider snapshot backend",
      "search-result-provider-mismatch",
      (result: SavedSnapshotSymbolSearchResultCandidate) => {
        result.backend = "another-backend";
      },
    ],
    [
      "an invalid opaque identity",
      "symbol-identity-invalid",
      (result: SavedSnapshotSymbolSearchResultCandidate) => {
        result.symbols[0]!.id = "src/service.ts#Service";
      },
    ],
  ] as const)("refuses definition lookup for %s", (_case, reason, change) => {
    const result = structuredClone(currentResult());
    change(result);
    expect(
      decideSavedSnapshotDefinitionRequest({
        authorization: input(),
        currentSearchResult: result,
        selectedSymbolId: result.symbols[0]!.id,
      }),
    ).toEqual({ kind: "refused", reason });
  });

  it("refuses an opaque identity that was not selected from the current result", () => {
    expect(
      decideSavedSnapshotDefinitionRequest({
        authorization: input(),
        currentSearchResult: currentResult(),
        selectedSymbolId: `lsp-symbol-v1:${"b".repeat(64)}`,
      }),
    ).toEqual({ kind: "refused", reason: "symbol-not-in-current-result" });
  });

  it("normalizes correlated provider search results with explicit unknown and semantic completeness", () => {
    const authorization = decideSavedSnapshotSymbolSearchRequest(input());
    if (authorization.kind !== "ready") throw new Error("Expected search authorization");

    const decision = normalizeSavedSnapshotSymbolSearchResult({
      request: authorization.request,
      candidate: currentResult(),
    });

    expect(decision).toEqual({ kind: "ready", result: currentResult() });
    if (decision.kind !== "ready") throw new Error("Expected a normalized search result");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.result)).toBe(true);
    expect(Object.isFrozen(decision.result.completeness)).toBe(true);
    expect(Object.isFrozen(decision.result.symbols)).toBe(true);
    expect(Object.isFrozen(decision.result.symbols[0])).toBe(true);
    expectTypeOf(decision.result).toEqualTypeOf<Readonly<SavedSnapshotSymbolSearchResult>>();
  });

  it.each([
    [
      "mismatched authority",
      "search-result-authority-mismatch",
      (candidate: SavedSnapshotSymbolSearchResultCandidate) => {
        candidate.workspaceGeneration = 6;
      },
    ],
    [
      "missing experimental disclosure",
      "experimental-disclosure-required",
      (candidate: SavedSnapshotSymbolSearchResultCandidate) => {
        candidate.completeness.experimentalDisclosure = "not-shown";
      },
    ],
    [
      "JavaScript semantics presented for TypeScript",
      "semantic-completeness-mismatch",
      (candidate: SavedSnapshotSymbolSearchResultCandidate) => {
        candidate.completeness.semanticCompleteness = "checked-javascript";
      },
    ],
  ] as const)("refuses provider search results with %s", (_case, reason, change) => {
    const authorization = decideSavedSnapshotSymbolSearchRequest(input());
    if (authorization.kind !== "ready") throw new Error("Expected search authorization");
    const candidate = structuredClone(currentResult());
    change(candidate);

    expect(
      normalizeSavedSnapshotSymbolSearchResult({ request: authorization.request, candidate }),
    ).toEqual({ kind: "refused", reason });
  });

  it("normalizes one correlated saved-snapshot definition point without inventing a range or attestation", () => {
    const searchAuthorization = decideSavedSnapshotSymbolSearchRequest(input());
    if (searchAuthorization.kind !== "ready") throw new Error("Expected search authorization");
    const searchDecision = normalizeSavedSnapshotSymbolSearchResult({
      request: searchAuthorization.request,
      candidate: currentResult(),
    });
    if (searchDecision.kind !== "ready") throw new Error("Expected a normalized search result");
    const selectedSymbol = searchDecision.result.symbols[0]!;
    const definitionAuthorization = decideSavedSnapshotDefinitionRequest({
      authorization: input(),
      currentSearchResult: searchDecision.result,
      selectedSymbolId: selectedSymbol.id,
    });
    if (definitionAuthorization.kind !== "ready") {
      throw new Error("Expected definition authorization");
    }
    const candidate: SavedSnapshotDefinitionResultCandidate = {
      languageId: "typescript",
      workspaceId: "workspace:authorized",
      workspaceGeneration: 7,
      sessionId: "typescript-session:7",
      snapshotIdentity: "snapshot:provider-current",
      providerVersion: "7.4.1",
      backend: "typescript-lsp-explicit-v1",
      selectedSymbol: { ...selectedSymbol },
      file: "src/service.ts",
      point: { line: 2, character: 13 },
    };

    const decision = normalizeSavedSnapshotDefinitionResult({
      request: definitionAuthorization.request,
      currentSearchResult: searchDecision.result,
      selectedSymbol,
      candidate,
    });

    expect(decision).toEqual({ kind: "ready", result: candidate });
    if (decision.kind !== "ready") throw new Error("Expected a normalized definition result");
    expect(Object.isFrozen(decision.result)).toBe(true);
    expect(Object.isFrozen(decision.result.selectedSymbol)).toBe(true);
    expect(Object.isFrozen(decision.result.point)).toBe(true);
    expectTypeOf(decision.result).toEqualTypeOf<Readonly<SavedSnapshotDefinitionResult>>();
    expectTypeOf(decision.result).not.toHaveProperty("end");
    expectTypeOf(decision.result).not.toHaveProperty("attestation");
  });

  it.each([
    [
      "provider authority mismatch",
      "definition-result-authority-mismatch",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        candidate.backend = "another-backend";
      },
    ],
    [
      "opaque symbol ID mismatch",
      "opaque-symbol-id-mismatch",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        candidate.selectedSymbol.id = `lsp-symbol-v1:${"b".repeat(64)}`;
      },
    ],
    [
      "an absolute file",
      "definition-file-invalid",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        candidate.file = "/workspace/authorized/src/service.ts";
      },
    ],
    [
      "an escaping file",
      "definition-file-invalid",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        candidate.file = "src/../../outside.ts";
      },
    ],
    [
      "an invalid provider point",
      "invalid-provider-point",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        candidate.point.character = -1;
      },
    ],
    [
      "a fabricated end range",
      "fabricated-definition-range",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        Object.assign(candidate, { end: { line: 2, character: 20 } });
      },
    ],
    [
      "fabricated attestation",
      "fabricated-definition-attestation",
      (candidate: SavedSnapshotDefinitionResultCandidate) => {
        Object.assign(candidate, { attestation: "exact-provider-definition" });
      },
    ],
  ] as const)("refuses a correlated definition result with %s", (_case, reason, change) => {
    const searchAuthorization = decideSavedSnapshotSymbolSearchRequest(input());
    if (searchAuthorization.kind !== "ready") throw new Error("Expected search authorization");
    const searchDecision = normalizeSavedSnapshotSymbolSearchResult({
      request: searchAuthorization.request,
      candidate: currentResult(),
    });
    if (searchDecision.kind !== "ready") throw new Error("Expected a normalized search result");
    const selectedSymbol = searchDecision.result.symbols[0]!;
    const definitionAuthorization = decideSavedSnapshotDefinitionRequest({
      authorization: input(),
      currentSearchResult: searchDecision.result,
      selectedSymbolId: selectedSymbol.id,
    });
    if (definitionAuthorization.kind !== "ready") {
      throw new Error("Expected definition authorization");
    }
    const candidate: SavedSnapshotDefinitionResultCandidate = {
      languageId: "typescript",
      workspaceId: "workspace:authorized",
      workspaceGeneration: 7,
      sessionId: "typescript-session:7",
      snapshotIdentity: "snapshot:provider-current",
      providerVersion: "7.4.1",
      backend: "typescript-lsp-explicit-v1",
      selectedSymbol: { ...selectedSymbol },
      file: "src/service.ts",
      point: { line: 2, character: 13 },
    };
    change(candidate);

    expect(
      normalizeSavedSnapshotDefinitionResult({
        request: definitionAuthorization.request,
        currentSearchResult: searchDecision.result,
        selectedSymbol,
        candidate,
      }),
    ).toEqual({ kind: "refused", reason });
  });

  it("refuses a stale selection no longer present in the current search result", () => {
    const searchAuthorization = decideSavedSnapshotSymbolSearchRequest(input());
    if (searchAuthorization.kind !== "ready") throw new Error("Expected search authorization");
    const current = currentResult();
    const selectedSymbol = { ...current.symbols[0]! };
    current.symbols = [];
    const searchDecision = normalizeSavedSnapshotSymbolSearchResult({
      request: searchAuthorization.request,
      candidate: current,
    });
    if (searchDecision.kind !== "ready") throw new Error("Expected a normalized search result");
    const definitionAuthorization = decideSavedSnapshotDefinitionRequest({
      authorization: input(),
      currentSearchResult: currentResult(),
      selectedSymbolId: selectedSymbol.id,
    });
    if (definitionAuthorization.kind !== "ready") {
      throw new Error("Expected definition authorization");
    }

    expect(
      normalizeSavedSnapshotDefinitionResult({
        request: definitionAuthorization.request,
        currentSearchResult: searchDecision.result,
        selectedSymbol,
        candidate: {
          languageId: "typescript",
          workspaceId: "workspace:authorized",
          workspaceGeneration: 7,
          sessionId: "typescript-session:7",
          snapshotIdentity: "snapshot:provider-current",
          providerVersion: "7.4.1",
          backend: "typescript-lsp-explicit-v1",
          selectedSymbol,
          file: "src/service.ts",
          point: { line: 2, character: 13 },
        },
      }),
    ).toEqual({ kind: "refused", reason: "stale-search-selection" });
  });

  it("normalizes a provider's zero-based UTF-16 point to a frozen one-based editor point", () => {
    expect(normalizeProviderPoint({ line: 2, character: 13 })).toEqual({
      kind: "ready",
      point: { lineNumber: 3, column: 14 },
    });
    const decision = normalizeProviderPoint({ line: 0, character: 0 });
    if (decision.kind !== "ready") throw new Error("Expected a normalized point");
    expect(Object.isFrozen(decision.point)).toBe(true);

    expect(normalizeProviderPoint({ line: -1, character: 0 })).toEqual({
      kind: "refused",
      reason: "invalid-provider-point",
    });
    expect(normalizeProviderPoint({ line: 0, character: Number.MAX_SAFE_INTEGER })).toEqual({
      kind: "refused",
      reason: "invalid-provider-point",
    });
  });
});
