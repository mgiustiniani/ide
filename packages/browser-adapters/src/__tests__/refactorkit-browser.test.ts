import type {
  ApplyRefactorKitPlanRequest,
  DiscardRefactorKitPlanRequest,
  PreviewExternalJavaImportRequest,
  RefactorApplyRequest,
  RefactorPreviewRequest,
  RefactorRollbackRequest,
  RollbackRefactorKitTransactionRequest,
  SavedSnapshotDefinitionRequest,
  SavedSnapshotDefinitionResult,
  SavedSnapshotExternalToolchain,
  SavedSnapshotSemanticSessionStartRequest,
  SavedSnapshotSemanticSessionStartResult,
  SavedSnapshotSemanticSessionStopRequest,
  SavedSnapshotSemanticSessionStopResult,
  SavedSnapshotSymbolSearchRequest,
  SavedSnapshotSymbolSearchResult,
  TypeScriptDiagnosticsRequest,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserRefactorKitAdapter,
  BrowserRefactorKitUnavailableError,
  createBrowserAdapters,
} from "../index";

const UNAVAILABLE_REASON =
  "Local RefactorKit daemon access is desktop-only and unavailable in browser clients.";

const SYMBOL_ID = "symbol-secret-7d94";
const SOURCE_ID = "source-secret-18af";
const PLAN_ID = "plan-secret-a251";
const TRANSACTION_ID = "transaction-secret-64ce";
const REQUEST_ID = "request-secret-099b";
const WORKSPACE_ID = "workspace-secret-b012";
const SEMANTIC_SESSION_ID = "semantic-session-secret-9c31";
const SEMANTIC_LEASE = `semantic-${"a".repeat(36)}`;
const SNAPSHOT_ID = "snapshot-secret-a742";
const START_SNAPSHOT_HASH = `sha256:${"b".repeat(64)}`;
const SYMBOL_QUERY = "symbol-query-secret-ec17";
const WORKSPACE_ROOT = "/workspace/secret-project";
const TARGET_IDENTITY = "target-identity-secret-3f18";
const TARGET_PATH = "/workspace/secret-refactoring-target.java";
const PROVIDER = "provider-secret-92d1";
const PROVIDER_VERSION = "provider-version-secret-8f20";
const BACKEND = "backend-secret-1e43";
const NODE_EXECUTABLE = "/private/toolchains/node-secret/bin/node";
const LANGUAGE_SERVER_ROOT = "/private/toolchains/language-server-secret";
const TYPESCRIPT_ROOT = "/private/toolchains/typescript-secret";
const FORBIDDEN_IDENTIFIERS = [
  SYMBOL_ID,
  SOURCE_ID,
  PLAN_ID,
  TRANSACTION_ID,
  REQUEST_ID,
  WORKSPACE_ID,
  SEMANTIC_SESSION_ID,
  SEMANTIC_LEASE,
  SNAPSHOT_ID,
  START_SNAPSHOT_HASH,
  SYMBOL_QUERY,
  WORKSPACE_ROOT,
  TARGET_IDENTITY,
  TARGET_PATH,
  PROVIDER,
  PROVIDER_VERSION,
  BACKEND,
  NODE_EXECUTABLE,
  LANGUAGE_SERVER_ROOT,
  TYPESCRIPT_ROOT,
] as const;

const previewRequest: PreviewExternalJavaImportRequest = {
  code: SOURCE_ID,
  targetDirectory: "src/main/java",
  sourceKind: "clipboard",
  sourceUrl: null,
  licensePolicy: "warn",
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  selectionGeneration: 12,
  requestId: REQUEST_ID,
};

const applyRequest: ApplyRefactorKitPlanRequest = {
  planId: PLAN_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  selectionGeneration: 12,
  requestId: REQUEST_ID,
  approval: {
    approvalId: "approval-secret-c751",
    approvedPlanId: PLAN_ID,
    approvedAt: "2026-07-13T12:00:00.000Z",
  },
};

const rollbackRequest: RollbackRefactorKitTransactionRequest = {
  transactionId: TRANSACTION_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  requestId: REQUEST_ID,
};

const discardRequest: DiscardRefactorKitPlanRequest = {
  planId: PLAN_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  selectionGeneration: 12,
  requestId: REQUEST_ID,
};

const previewRefactoringRequest: RefactorPreviewRequest = {
  operation: "rename-class",
  target: {
    kind: "class",
    path: TARGET_PATH,
    identity: TARGET_IDENTITY,
  },
  authority: {
    workspaceId: WORKSPACE_ID,
    workspaceGeneration: 11,
  },
  selectionGeneration: 12,
  requestId: REQUEST_ID,
};

const applyRefactoringRequest: RefactorApplyRequest = {
  planId: PLAN_ID,
  operation: "rename-class",
  target: {
    kind: "class",
    path: TARGET_PATH,
    identity: TARGET_IDENTITY,
  },
  authority: {
    workspaceId: WORKSPACE_ID,
    workspaceGeneration: 11,
  },
  selectionGeneration: 12,
  requestId: REQUEST_ID,
  approval: {
    approvalId: "approval-secret-c751",
    approvedPlanId: PLAN_ID,
    approvedAt: "2026-07-13T12:00:00.000Z",
  },
};

const rollbackRefactoringRequest: RefactorRollbackRequest = {
  transactionId: TRANSACTION_ID,
  operation: "rename-class",
  authority: {
    workspaceId: WORKSPACE_ID,
    workspaceGeneration: 11,
  },
  requestId: REQUEST_ID,
};

const semanticToolchain = {
  nodeExecutable: NODE_EXECUTABLE,
  languageServerPackageRoot: LANGUAGE_SERVER_ROOT,
  typeScriptPackageRoot: TYPESCRIPT_ROOT,
  allowPathNodeDiscovery: false,
  allowWorkspaceLocalToolchain: false,
} satisfies SavedSnapshotExternalToolchain;

const semanticSessionStartRequest = {
  languageId: "typescript",
  workspaceRoot: WORKSPACE_ROOT,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  provider: PROVIDER,
  providerVersion: PROVIDER_VERSION,
  backend: BACKEND,
  runtime: {
    executionMode: "external-process",
    supportsTimeout: true,
    supportsCancellation: true,
    usesWorkspaceOverlay: false,
    recordsProcessProvenance: true,
    limits: {
      requestTimeoutMillis: 5_000,
      maxInputBytes: 1_000_000,
      maxOutputBytes: 1_000_000,
      maxProcesses: 1,
    },
  },
  extensions: ["ts", "tsx"],
  toolchain: semanticToolchain,
  acceptedSemanticCompleteness: ["full-typescript"],
} satisfies SavedSnapshotSemanticSessionStartRequest;

const semanticSessionStopRequest = {
  languageId: "typescript",
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  sessionId: SEMANTIC_SESSION_ID,
} satisfies SavedSnapshotSemanticSessionStopRequest;

const diagnosticsRequest = {
  schemaVersion: 2,
  operation: "diagnostics.v2",
  requestId: REQUEST_ID,
  languageId: "typescript",
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  sessionId: SEMANTIC_SESSION_ID,
  expectedSnapshotHash: START_SNAPSHOT_HASH,
  semanticLease: SEMANTIC_LEASE,
  sourceAuthority: {
    kind: "immutable-editor-overlay",
    documents: [{ path: "src/secret.ts", version: 3, content: SOURCE_ID }],
  },
} as const satisfies TypeScriptDiagnosticsRequest;

const symbolSearchRequest = {
  languageId: "typescript",
  query: SYMBOL_QUERY,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  sessionId: SEMANTIC_SESSION_ID,
  semanticLease: SEMANTIC_LEASE,
  snapshotIdentity: SNAPSHOT_ID,
  providerVersion: semanticSessionStartRequest.providerVersion,
  backend: semanticSessionStartRequest.backend,
  toolchain: semanticToolchain,
} satisfies SavedSnapshotSymbolSearchRequest;

const definitionRequest = {
  languageId: "typescript",
  symbolId: SYMBOL_ID,
  workspaceId: WORKSPACE_ID,
  workspaceGeneration: 11,
  sessionId: SEMANTIC_SESSION_ID,
  semanticLease: SEMANTIC_LEASE,
  snapshotIdentity: SNAPSHOT_ID,
  providerVersion: semanticSessionStartRequest.providerVersion,
  backend: semanticSessionStartRequest.backend,
} satisfies SavedSnapshotDefinitionRequest;

async function expectStaticUnavailable(rejection: Promise<unknown>): Promise<void> {
  let caught: unknown;

  try {
    await rejection;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(BrowserRefactorKitUnavailableError);
  const error = caught as BrowserRefactorKitUnavailableError;
  expect(error.name).toBe("BrowserRefactorKitUnavailableError");
  expect(error.code).toBe("BROWSER_REFACTORKIT_UNAVAILABLE");
  expect(error.message).toBe(UNAVAILABLE_REASON);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    expect(error.message).not.toContain(identifier);
  }
}

describe("BrowserRefactorKitAdapter", () => {
  it("reports an honest unavailable status and language-kernel capability status", async () => {
    const adapter = new BrowserRefactorKitAdapter();

    await expect(adapter.getStatus()).resolves.toEqual({
      available: false,
      lastError: UNAVAILABLE_REASON,
    });
    await expect(adapter.getCapabilities()).resolves.toEqual({
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
      languageKernel: {
        available: false,
        schema: null,
        reason: UNAVAILABLE_REASON,
      },
    });
  });

  it("is included in the browser adapter factory", () => {
    expect(createBrowserAdapters().refactorKitAdapter).toBeInstanceOf(BrowserRefactorKitAdapter);
  });

  it.each([
    ["scan", (adapter: BrowserRefactorKitAdapter) => adapter.scan()],
    [
      "diagnostics",
      (adapter: BrowserRefactorKitAdapter) => adapter.diagnostics(diagnosticsRequest),
    ],
    ["symbols", (adapter: BrowserRefactorKitAdapter) => adapter.symbols()],
    ["definition", (adapter: BrowserRefactorKitAdapter) => adapter.definition(SYMBOL_ID)],
    ["references", (adapter: BrowserRefactorKitAdapter) => adapter.references(SYMBOL_ID)],
    [
      "startSavedSnapshotSemanticSession",
      (adapter: BrowserRefactorKitAdapter) =>
        adapter.startSavedSnapshotSemanticSession(semanticSessionStartRequest),
    ],
    [
      "stopSavedSnapshotSemanticSession",
      (adapter: BrowserRefactorKitAdapter) =>
        adapter.stopSavedSnapshotSemanticSession(semanticSessionStopRequest),
    ],
    [
      "searchSavedSnapshotSymbols",
      (adapter: BrowserRefactorKitAdapter) =>
        adapter.searchSavedSnapshotSymbols(symbolSearchRequest),
    ],
    [
      "resolveSavedSnapshotDefinition",
      (adapter: BrowserRefactorKitAdapter) =>
        adapter.resolveSavedSnapshotDefinition(definitionRequest),
    ],
    [
      "previewExternalJavaImport",
      (adapter: BrowserRefactorKitAdapter) => adapter.previewExternalJavaImport(previewRequest),
    ],
    ["applyPlan", (adapter: BrowserRefactorKitAdapter) => adapter.applyPlan(applyRequest)],
    [
      "rollbackTransaction",
      (adapter: BrowserRefactorKitAdapter) => adapter.rollbackTransaction(rollbackRequest),
    ],
    ["discardPlan", (adapter: BrowserRefactorKitAdapter) => adapter.discardPlan(discardRequest)],
    [
      "previewRefactoring",
      (adapter: BrowserRefactorKitAdapter) => adapter.previewRefactoring(previewRefactoringRequest),
    ],
    [
      "applyRefactoring",
      (adapter: BrowserRefactorKitAdapter) => adapter.applyRefactoring(applyRefactoringRequest),
    ],
    [
      "rollbackRefactoring",
      (adapter: BrowserRefactorKitAdapter) =>
        adapter.rollbackRefactoring(rollbackRefactoringRequest),
    ],
    [
      "discardRefactoring",
      (adapter: BrowserRefactorKitAdapter) => adapter.discardRefactoring(discardRequest),
    ],
  ] as const)(
    "rejects %s with one typed static error that redacts supplied identifiers",
    async (_name, operation) => {
      await expectStaticUnavailable(operation(new BrowserRefactorKitAdapter()));
    },
  );

  it("rejects diagnostics and semantic operations without mutating requests, persistence, fetch, or XHR", async () => {
    const adapter = new BrowserRefactorKitAdapter();
    const requests = [
      diagnosticsRequest,
      semanticSessionStartRequest,
      semanticSessionStopRequest,
      symbolSearchRequest,
      definitionRequest,
    ];
    const requestSnapshots = structuredClone(requests);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    const storageSetItemSpy = vi.spyOn(Storage.prototype, "setItem");

    try {
      await expectStaticUnavailable(adapter.diagnostics(diagnosticsRequest));
      await expectStaticUnavailable(
        adapter.startSavedSnapshotSemanticSession(semanticSessionStartRequest),
      );
      await expectStaticUnavailable(
        adapter.stopSavedSnapshotSemanticSession(semanticSessionStopRequest),
      );
      await expectStaticUnavailable(adapter.searchSavedSnapshotSymbols(symbolSearchRequest));
      await expectStaticUnavailable(adapter.resolveSavedSnapshotDefinition(definitionRequest));

      expect(requests).toEqual(requestSnapshots);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy).not.toHaveBeenCalled();
      expect(storageSetItemSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      xhrOpenSpy.mockRestore();
      storageSetItemSpy.mockRestore();
    }
  });
});

type SemanticNavigationPort = Pick<
  RefactorKitPort,
  | "startSavedSnapshotSemanticSession"
  | "stopSavedSnapshotSemanticSession"
  | "searchSavedSnapshotSymbols"
  | "resolveSavedSnapshotDefinition"
>;

const semanticSessionStartResult = {
  languageId: semanticSessionStartRequest.languageId,
  workspaceRoot: semanticSessionStartRequest.workspaceRoot,
  workspaceId: semanticSessionStartRequest.workspaceId,
  workspaceGeneration: semanticSessionStartRequest.workspaceGeneration,
  sessionId: SEMANTIC_SESSION_ID,
  providerProjectSnapshotIdentity: SNAPSHOT_ID,
  semanticLease: SEMANTIC_LEASE,
  startSnapshotHash: START_SNAPSHOT_HASH,
  provider: semanticSessionStartRequest.provider,
  providerVersion: semanticSessionStartRequest.providerVersion,
  backend: semanticSessionStartRequest.backend,
  toolchain: {
    backend: semanticSessionStartRequest.backend,
    runtime: semanticSessionStartRequest.runtime,
    extensions: [...semanticSessionStartRequest.extensions],
    nodeExecutable: NODE_EXECUTABLE,
    languageServerPackageRoot: LANGUAGE_SERVER_ROOT,
    typeScriptPackageRoot: TYPESCRIPT_ROOT,
  },
  semanticCompleteness: "full-typescript",
  processProvenance: {
    serverName: "typescript-language-server",
    serverVersion: "4.3.3",
    capabilitiesSha256: "capabilities-digest",
    executableSha256: "executable-digest",
    argumentsSha256: "arguments-digest",
    processId: 42,
  },
} satisfies SavedSnapshotSemanticSessionStartResult;

const semanticSessionStopResult = {
  ...semanticSessionStopRequest,
  stopped: true,
} satisfies SavedSnapshotSemanticSessionStopResult;

const symbolSearchResult = {
  languageId: symbolSearchRequest.languageId,
  query: symbolSearchRequest.query,
  workspaceId: symbolSearchRequest.workspaceId,
  workspaceGeneration: symbolSearchRequest.workspaceGeneration,
  sessionId: symbolSearchRequest.sessionId,
  snapshotIdentity: symbolSearchRequest.snapshotIdentity,
  providerVersion: symbolSearchRequest.providerVersion,
  backend: symbolSearchRequest.backend,
  completeness: {
    resultCompleteness: "unknown",
    truncation: "unknown",
    semanticCompleteness: "full-typescript",
    experimentalDisclosure: "shown",
  },
  symbols: [{ id: SYMBOL_ID, name: "SecretSymbol", kind: "class" }],
} satisfies SavedSnapshotSymbolSearchResult;

const definitionResult = {
  languageId: definitionRequest.languageId,
  workspaceId: definitionRequest.workspaceId,
  workspaceGeneration: definitionRequest.workspaceGeneration,
  sessionId: definitionRequest.sessionId,
  snapshotIdentity: definitionRequest.snapshotIdentity,
  providerVersion: definitionRequest.providerVersion,
  backend: definitionRequest.backend,
  selectedSymbol: symbolSearchResult.symbols[0],
  file: "src/secret-definition.ts",
  point: { line: 7, character: 11 },
} satisfies SavedSnapshotDefinitionResult;

describe("RefactorKitPort semantic navigation signatures", () => {
  it("passes exact lifecycle, search, and definition requests through a typed port", async () => {
    const startSavedSnapshotSemanticSession = vi
      .fn<SemanticNavigationPort["startSavedSnapshotSemanticSession"]>()
      .mockResolvedValue(semanticSessionStartResult);
    const stopSavedSnapshotSemanticSession = vi
      .fn<SemanticNavigationPort["stopSavedSnapshotSemanticSession"]>()
      .mockResolvedValue(semanticSessionStopResult);
    const searchSavedSnapshotSymbols = vi
      .fn<SemanticNavigationPort["searchSavedSnapshotSymbols"]>()
      .mockResolvedValue(symbolSearchResult);
    const resolveSavedSnapshotDefinition = vi
      .fn<SemanticNavigationPort["resolveSavedSnapshotDefinition"]>()
      .mockResolvedValue(definitionResult);
    const port = {
      startSavedSnapshotSemanticSession,
      stopSavedSnapshotSemanticSession,
      searchSavedSnapshotSymbols,
      resolveSavedSnapshotDefinition,
    } satisfies SemanticNavigationPort;

    await expect(port.startSavedSnapshotSemanticSession(semanticSessionStartRequest)).resolves.toBe(
      semanticSessionStartResult,
    );
    await expect(port.stopSavedSnapshotSemanticSession(semanticSessionStopRequest)).resolves.toBe(
      semanticSessionStopResult,
    );
    await expect(port.searchSavedSnapshotSymbols(symbolSearchRequest)).resolves.toBe(
      symbolSearchResult,
    );
    await expect(port.resolveSavedSnapshotDefinition(definitionRequest)).resolves.toBe(
      definitionResult,
    );

    expect(startSavedSnapshotSemanticSession).toHaveBeenCalledWith(semanticSessionStartRequest);
    expect(stopSavedSnapshotSemanticSession).toHaveBeenCalledWith(semanticSessionStopRequest);
    expect(searchSavedSnapshotSymbols).toHaveBeenCalledWith(symbolSearchRequest);
    expect(resolveSavedSnapshotDefinition).toHaveBeenCalledWith(definitionRequest);
  });
});
