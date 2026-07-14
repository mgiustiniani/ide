import { describe, expect, expectTypeOf, it } from "vitest";

import {
  decideSavedSnapshotDefinitionRequest,
  decideSavedSnapshotSymbolSearchRequest,
  normalizeProviderPoint,
  type SavedSnapshotDefinitionRequest,
  type SavedSnapshotSymbolSearchPolicyInput,
  type SavedSnapshotSymbolSearchRequest,
  type SavedSnapshotSymbolSearchResult,
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

function currentResult(): SavedSnapshotSymbolSearchResult {
  return {
    languageId: "typescript",
    query: "Service",
    workspaceId: "workspace:authorized",
    workspaceGeneration: 7,
    sessionId: "typescript-session:7",
    snapshotIdentity: "snapshot:provider-current",
    providerVersion: "7.4.1",
    backend: "typescript-lsp-explicit-v1",
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
      (result: SavedSnapshotSymbolSearchResult) => {
        result.workspaceGeneration = 6;
      },
    ],
    [
      "a stale result session",
      "search-result-session-mismatch",
      (result: SavedSnapshotSymbolSearchResult) => {
        result.sessionId = "typescript-session:old";
      },
    ],
    [
      "a stale result snapshot",
      "search-result-snapshot-mismatch",
      (result: SavedSnapshotSymbolSearchResult) => {
        result.snapshotIdentity = "snapshot:old";
      },
    ],
    [
      "another provider snapshot backend",
      "search-result-provider-mismatch",
      (result: SavedSnapshotSymbolSearchResult) => {
        result.backend = "another-backend";
      },
    ],
    [
      "an invalid opaque identity",
      "symbol-identity-invalid",
      (result: SavedSnapshotSymbolSearchResult) => {
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
