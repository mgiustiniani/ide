import type {
  RefactorKitCapabilities,
  RefactorKitLanguageAdapterRuntime,
  SavedSnapshotDefinitionRequest,
  SavedSnapshotDefinitionResult,
  SavedSnapshotSemanticSessionStartRequest,
  SavedSnapshotSemanticSessionStartResult,
  SavedSnapshotSemanticSessionStopRequest,
  SavedSnapshotSemanticSessionStopResult,
  SavedSnapshotSymbolSearchRequest,
  SavedSnapshotSymbolSearchResult,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useRefactorKitSymbolNavigationController,
  type SemanticNavigationEditorBuffer,
  type SemanticNavigationWorkspaceContext,
  type UseRefactorKitSymbolNavigationControllerDependencies,
} from "./useRefactorKitSymbolNavigationController";

const SESSION_ID = `refactorkit-semantic-session-v1:${"a".repeat(64)}`;
const SNAPSHOT_IDENTITY = `sha256:${"b".repeat(64)}`;
const SYMBOL_ID = `lsp-symbol-v1:${"c".repeat(64)}`;
const WORKSPACE = {
  id: "workspace:semantic",
  name: "Semantic Workspace",
  rootPath: "/workspace/project",
};
const TOOLCHAIN_PATHS = {
  nodeExecutable: "/opt/refactorkit/node/bin/node",
  languageServerPackageRoot: "/opt/refactorkit/typescript-language-server",
  typeScriptPackageRoot: "/opt/refactorkit/typescript",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runtime(): RefactorKitLanguageAdapterRuntime {
  return {
    executionMode: "external-process",
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

function capabilities(): RefactorKitCapabilities {
  const semanticRuntime = runtime();
  const adapter = (languageId: "typescript" | "javascript", extensions: string[]) => ({
    languageId,
    extensions,
    backend: "typescript-language-server-4.3.4",
    runtime: semanticRuntime,
    capabilities: ["workspaceSymbols", "definition"].map((operation) => ({
      operation,
      stability: "experimental" as const,
      evidence: "language-server" as const,
      mutationAuthority: "none" as const,
      backend: "typescript-language-server-4.3.4",
      runtime: semanticRuntime,
      extensions,
    })),
  });
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
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
          adapter("typescript", ["ts", "tsx", "mts", "cts"]),
          adapter("javascript", ["js", "jsx", "mjs", "cjs"]),
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

function startResult(
  request: SavedSnapshotSemanticSessionStartRequest,
  overrides: Partial<SavedSnapshotSemanticSessionStartResult> = {},
): SavedSnapshotSemanticSessionStartResult {
  return {
    languageId: request.languageId,
    workspaceRoot: request.workspaceRoot,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: SESSION_ID,
    providerProjectSnapshotIdentity: SNAPSHOT_IDENTITY,
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
    semanticCompleteness:
      request.languageId === "typescript" ? "full-typescript" : "mixed-javascript",
    processProvenance: {
      serverName: "typescript-language-server",
      serverVersion: "4.3.4",
      capabilitiesSha256: "d".repeat(64),
      executableSha256: "e".repeat(64),
      argumentsSha256: "f".repeat(64),
      processId: 4242,
    },
    ...overrides,
  };
}

function searchResult(
  request: SavedSnapshotSymbolSearchRequest,
  overrides: Partial<SavedSnapshotSymbolSearchResult> = {},
): SavedSnapshotSymbolSearchResult {
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
      semanticCompleteness:
        request.languageId === "typescript" ? "full-typescript" : "mixed-javascript",
      experimentalDisclosure: "shown",
    },
    symbols: [{ id: SYMBOL_ID, name: "SecretWidget", kind: "class" }],
    ...overrides,
  };
}

function definitionResult(
  request: SavedSnapshotDefinitionRequest,
  overrides: Partial<SavedSnapshotDefinitionResult> = {},
): SavedSnapshotDefinitionResult {
  return {
    languageId: request.languageId,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    snapshotIdentity: request.snapshotIdentity,
    providerVersion: request.providerVersion,
    backend: request.backend,
    selectedSymbol: { id: request.symbolId, name: "SecretWidget", kind: "class" },
    file: "private/SecretWidget.ts",
    point: { line: 12, character: 7 },
    ...overrides,
  };
}

function stopResult(
  request: SavedSnapshotSemanticSessionStopRequest,
): SavedSnapshotSemanticSessionStopResult {
  return { ...request, stopped: true };
}

interface HarnessOptions {
  buffers?: SemanticNavigationEditorBuffer[];
  start?: (
    request: SavedSnapshotSemanticSessionStartRequest,
  ) => Promise<SavedSnapshotSemanticSessionStartResult>;
  search?: (request: SavedSnapshotSymbolSearchRequest) => Promise<SavedSnapshotSymbolSearchResult>;
  definition?: (request: SavedSnapshotDefinitionRequest) => Promise<SavedSnapshotDefinitionResult>;
  stop?: (
    request: SavedSnapshotSemanticSessionStopRequest,
  ) => Promise<SavedSnapshotSemanticSessionStopResult>;
}

function createHarness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const context: SemanticNavigationWorkspaceContext = {
    generation: 7,
    workspaceId: WORKSPACE.id,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const buffers =
    options.buffers ??
    ([
      {
        path: "src/current.ts",
        languageId: "typescript",
        savedState: "saved",
        dirty: false,
      },
    ] satisfies SemanticNavigationEditorBuffer[]);
  const startSavedSnapshotSemanticSession = vi.fn(
    options.start ??
      (async (request: SavedSnapshotSemanticSessionStartRequest) => {
        order.push("start");
        return startResult(request);
      }),
  );
  const searchSavedSnapshotSymbols = vi.fn(
    options.search ??
      (async (request: SavedSnapshotSymbolSearchRequest) => {
        order.push("search");
        return searchResult(request);
      }),
  );
  const resolveSavedSnapshotDefinition = vi.fn(
    options.definition ??
      (async (request: SavedSnapshotDefinitionRequest) => {
        order.push("definition");
        return definitionResult(request);
      }),
  );
  const stopSavedSnapshotSemanticSession = vi.fn(
    options.stop ??
      (async (request: SavedSnapshotSemanticSessionStopRequest) => {
        order.push("stop");
        return stopResult(request);
      }),
  );
  const legacySymbols = vi.fn();
  const legacyDefinition = vi.fn();
  const legacyReferences = vi.fn();
  const navigateToPoint = vi.fn(async () => {
    order.push("navigate");
  });
  const refactorKit = {
    startSavedSnapshotSemanticSession,
    searchSavedSnapshotSymbols,
    resolveSavedSnapshotDefinition,
    stopSavedSnapshotSemanticSession,
    symbols: legacySymbols,
    definition: legacyDefinition,
    references: legacyReferences,
  } as unknown as RefactorKitPort;
  const dependencies: UseRefactorKitSymbolNavigationControllerDependencies = {
    refactorKit,
    status: { available: true },
    capabilities: capabilities(),
    isCheckingCapabilities: false,
    workspaceInfo: WORKSPACE,
    workspaceGeneration: 7,
    getWorkspaceContext: () => ({ ...context }),
    getRelevantBuffers: () => buffers.map((buffer) => ({ ...buffer })),
    navigateToPoint,
  };
  const hook = renderHook(() => useRefactorKitSymbolNavigationController(dependencies));
  return {
    ...hook,
    context,
    buffers,
    dependencies,
    order,
    mocks: {
      startSavedSnapshotSemanticSession,
      searchSavedSnapshotSymbols,
      resolveSavedSnapshotDefinition,
      stopSavedSnapshotSemanticSession,
      legacySymbols,
      legacyDefinition,
      legacyReferences,
      navigateToPoint,
    },
  };
}

async function configureApprovedSearch(
  harness: ReturnType<typeof createHarness>,
  language: "typescript" | "javascript" = "typescript",
  query = "SecretWidget",
) {
  act(() => {
    harness.result.current.setLanguage(language);
    harness.result.current.setToolchainPath("nodeExecutable", TOOLCHAIN_PATHS.nodeExecutable);
    harness.result.current.setToolchainPath(
      "languageServerPackageRoot",
      TOOLCHAIN_PATHS.languageServerPackageRoot,
    );
    harness.result.current.setToolchainPath(
      "typeScriptPackageRoot",
      TOOLCHAIN_PATHS.typeScriptPackageRoot,
    );
    harness.result.current.setQuery(query);
    harness.result.current.setApprovedForSession(true);
  });
  await act(async () => Promise.resolve());
}

async function submitSuccessfully(harness: ReturnType<typeof createHarness>) {
  await configureApprovedSearch(harness);
  await act(() => harness.result.current.submit());
  expect(harness.result.current.results).toHaveLength(1);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRefactorKitSymbolNavigationController", () => {
  it("runs approved start → search → definition → exact point reveal → stop without discovery or fallback", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const harness = createHarness();

    await submitSuccessfully(harness);

    const startRequest = harness.mocks.startSavedSnapshotSemanticSession.mock.calls[0]![0];
    expect(startRequest.toolchain).toEqual({
      ...TOOLCHAIN_PATHS,
      allowPathNodeDiscovery: false,
      allowWorkspaceLocalToolchain: false,
    });
    expect(startRequest.acceptedSemanticCompleteness).toEqual(["full-typescript"]);
    expect(startRequest).not.toHaveProperty("fallback");
    expect(startRequest).not.toHaveProperty("userApproved");

    const searchRequest = harness.mocks.searchSavedSnapshotSymbols.mock.calls[0]![0];
    expect(searchRequest).toMatchObject({
      query: "SecretWidget",
      sessionId: SESSION_ID,
      snapshotIdentity: SNAPSHOT_IDENTITY,
      toolchain: {
        ...TOOLCHAIN_PATHS,
        allowPathNodeDiscovery: false,
        allowWorkspaceLocalToolchain: false,
      },
    });
    expect(searchRequest).not.toHaveProperty("fallback");
    expect(harness.result.current.results).toEqual([
      { opaqueSymbolId: SYMBOL_ID, name: "SecretWidget", kind: "class" },
    ]);
    expect(JSON.stringify(harness.result.current.results)).not.toContain("private/SecretWidget.ts");
    expect(JSON.stringify(harness.result.current.results)).not.toContain(SNAPSHOT_IDENTITY);
    expect(JSON.stringify(harness.result.current.results)).not.toContain(SESSION_ID);

    await act(() => harness.result.current.selectResult(harness.result.current.results[0]!));

    expect(harness.mocks.resolveSavedSnapshotDefinition).toHaveBeenCalledWith({
      languageId: "typescript",
      symbolId: SYMBOL_ID,
      workspaceId: WORKSPACE.id,
      workspaceGeneration: 7,
      sessionId: SESSION_ID,
      snapshotIdentity: SNAPSHOT_IDENTITY,
      providerVersion: "0.6.2",
      backend: "typescript-language-server-4.3.4",
    });
    expect(harness.mocks.navigateToPoint).toHaveBeenCalledWith("private/SecretWidget.ts", {
      lineNumber: 13,
      column: 8,
    });

    await act(() => harness.result.current.stop());

    expect(harness.order).toEqual(["start", "search", "definition", "navigate", "stop"]);
    expect(harness.mocks.stopSavedSnapshotSemanticSession).toHaveBeenCalledWith({
      languageId: "typescript",
      workspaceId: WORKSPACE.id,
      workspaceGeneration: 7,
      sessionId: SESSION_ID,
    });
    expect(harness.mocks.legacySymbols).not.toHaveBeenCalled();
    expect(harness.mocks.legacyDefinition).not.toHaveBeenCalled();
    expect(harness.mocks.legacyReferences).not.toHaveBeenCalled();
    expect(localStorageWrite).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("requires explicit per-session approval before any provider invocation", async () => {
    const harness = createHarness();
    act(() => {
      harness.result.current.setToolchainPath("nodeExecutable", TOOLCHAIN_PATHS.nodeExecutable);
      harness.result.current.setToolchainPath(
        "languageServerPackageRoot",
        TOOLCHAIN_PATHS.languageServerPackageRoot,
      );
      harness.result.current.setToolchainPath(
        "typeScriptPackageRoot",
        TOOLCHAIN_PATHS.typeScriptPackageRoot,
      );
      harness.result.current.setQuery("SecretWidget");
    });

    await act(() => harness.result.current.submit());

    expect(harness.result.current.refusal).toBe(
      "Explicitly approve the external toolchain paths for this session.",
    );
    expect(harness.mocks.startSavedSnapshotSemanticSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      state: "dirty",
      buffer: {
        path: "src/current.ts",
        languageId: "typescript",
        savedState: "saved",
        dirty: true,
      },
    },
    {
      state: "never-saved",
      buffer: {
        path: "src/new.ts",
        languageId: "typescript",
        savedState: "never-saved",
        dirty: false,
      },
    },
  ] as const)(
    "refuses a $state participating buffer before invocation",
    async ({ state, buffer }) => {
      const harness = createHarness({ buffers: [{ ...buffer }] });
      await configureApprovedSearch(harness);

      expect(harness.result.current.snapshotState).toBe(state);
      expect(harness.result.current.canSubmit).toBe(false);
      await act(() => harness.result.current.submit());

      expect(harness.mocks.startSavedSnapshotSemanticSession).not.toHaveBeenCalled();
      expect(harness.mocks.searchSavedSnapshotSymbols).not.toHaveBeenCalled();
    },
  );

  it("discloses dynamic or mixed JavaScript incompleteness in both lifecycle stages", async () => {
    const harness = createHarness({
      buffers: [
        {
          path: "src/current.js",
          languageId: "javascript",
          savedState: "saved",
          dirty: false,
        },
      ],
    });
    await configureApprovedSearch(harness, "javascript", "dynamicWidget");
    await act(() => harness.result.current.submit());

    expect(harness.mocks.startSavedSnapshotSemanticSession).toHaveBeenCalledWith(
      expect.objectContaining({
        languageId: "javascript",
        acceptedSemanticCompleteness: ["dynamic-javascript", "mixed-javascript"],
      }),
    );
    expect(harness.mocks.searchSavedSnapshotSymbols).toHaveBeenCalledWith(
      expect.objectContaining({ languageId: "javascript", query: "dynamicWidget" }),
    );
    expect(harness.result.current.results).toHaveLength(1);
  });

  it("suppresses a superseded start request and stops its late authorized session", async () => {
    const pendingStart = deferred<SavedSnapshotSemanticSessionStartResult>();
    let capturedRequest: SavedSnapshotSemanticSessionStartRequest | null = null;
    const harness = createHarness({
      start: async (request) => {
        capturedRequest = request;
        return pendingStart.promise;
      },
    });
    await configureApprovedSearch(harness);

    let submit!: Promise<void>;
    act(() => {
      submit = harness.result.current.submit();
    });
    await waitFor(() => expect(capturedRequest).not.toBeNull());
    act(() => harness.result.current.setQuery("replacement"));
    pendingStart.resolve(startResult(capturedRequest!));
    await act(async () => submit);

    expect(harness.mocks.searchSavedSnapshotSymbols).not.toHaveBeenCalled();
    expect(harness.mocks.stopSavedSnapshotSemanticSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
    expect(harness.result.current.results).toEqual([]);
  });

  it("suppresses a search completion from a stale workspace generation", async () => {
    const pendingSearch = deferred<SavedSnapshotSymbolSearchResult>();
    let capturedRequest: SavedSnapshotSymbolSearchRequest | null = null;
    const harness = createHarness({
      search: async (request) => {
        capturedRequest = request;
        return pendingSearch.promise;
      },
    });
    await configureApprovedSearch(harness);

    let submit!: Promise<void>;
    act(() => {
      submit = harness.result.current.submit();
    });
    await waitFor(() => expect(capturedRequest).not.toBeNull());
    harness.context.generation = 8;
    pendingSearch.resolve(searchResult(capturedRequest!));
    await act(async () => submit);

    expect(harness.result.current.results).toEqual([]);
    expect(harness.mocks.resolveSavedSnapshotDefinition).not.toHaveBeenCalled();
  });

  it.each([
    ["session", { sessionId: `refactorkit-semantic-session-v1:${"1".repeat(64)}` }],
    ["snapshot", { snapshotIdentity: `sha256:${"2".repeat(64)}` }],
  ] as const)("suppresses a mismatched $0 search result", async (_kind, overrides) => {
    const harness = createHarness({
      search: async (request) => searchResult(request, overrides),
    });
    await configureApprovedSearch(harness);
    await act(() => harness.result.current.submit());

    expect(harness.result.current.results).toEqual([]);
    expect(harness.result.current.refusal).toBe(
      "The selected result is stale. Run the search again.",
    );
    expect(harness.mocks.resolveSavedSnapshotDefinition).not.toHaveBeenCalled();
  });

  it("stops an authorized session before starting a replacement", async () => {
    let startCount = 0;
    const order: string[] = [];
    const harness = createHarness({
      start: async (request) => {
        startCount += 1;
        order.push(`start:${startCount}`);
        return startResult(request);
      },
      search: async (request) => {
        order.push(`search:${startCount}`);
        return searchResult(request);
      },
      stop: async (request) => {
        order.push(`stop:${startCount}`);
        return stopResult(request);
      },
    });
    await configureApprovedSearch(harness);
    await act(() => harness.result.current.submit());
    await act(() => harness.result.current.submit());

    expect(order).toEqual(["start:1", "search:1", "stop:1", "start:2", "search:2"]);
  });

  it.each(["cancel", "unmount"] as const)(
    "stops the authorized session during $0 cleanup",
    async (action) => {
      const harness = createHarness();
      await submitSuccessfully(harness);

      if (action === "cancel") act(() => harness.result.current.cancel());
      else harness.unmount();

      await waitFor(() =>
        expect(harness.mocks.stopSavedSnapshotSemanticSession).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: SESSION_ID }),
        ),
      );
      expect(
        harness.mocks.stopSavedSnapshotSemanticSession.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        harness.mocks.startSavedSnapshotSemanticSession.mock.invocationCallOrder[0]!,
      );
    },
  );

  it("makes workspace switching wait for the authorized session stop", async () => {
    const pendingStop = deferred<SavedSnapshotSemanticSessionStopResult>();
    let stopRequest: SavedSnapshotSemanticSessionStopRequest | null = null;
    const harness = createHarness({
      stop: async (request) => {
        stopRequest = request;
        return pendingStop.promise;
      },
    });
    await submitSuccessfully(harness);

    let reset!: Promise<void>;
    act(() => {
      reset = harness.result.current.workspaceCollaborator.resetWorkspace(8);
    });
    await waitFor(() => expect(stopRequest).not.toBeNull());
    let settled = false;
    void reset.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pendingStop.resolve(stopResult(stopRequest!));
    await act(async () => reset);
    expect(settled).toBe(true);
    expect(harness.result.current.hasActiveSession).toBe(false);
  });

  it.each([
    {
      stage: "search",
      options: (privateDetail: string): HarnessOptions => ({
        start: async () => {
          throw new Error(privateDetail);
        },
      }),
      expected: "Semantic symbol search could not be completed.",
    },
    {
      stage: "definition",
      options: (privateDetail: string): HarnessOptions => ({
        definition: async () => {
          throw new Error(privateDetail);
        },
      }),
      expected: "The semantic definition could not be opened.",
    },
  ])(
    "uses a bounded generic $stage error without persisting, logging, or disclosing native details",
    async ({ stage, options, expected }) => {
      const privateDetail = `/private/provider/${"secret".repeat(60)}`;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const storageWrite = vi.spyOn(Storage.prototype, "setItem");
      const harness = createHarness(options(privateDetail));
      await configureApprovedSearch(harness);
      await act(() => harness.result.current.submit());
      if (stage === "definition") {
        await act(() => harness.result.current.selectResult(harness.result.current.results[0]!));
      }

      expect(harness.result.current.error).toBe(expected);
      expect(harness.result.current.error!.length).toBeLessThanOrEqual(180);
      expect(harness.result.current.error).not.toContain("private");
      expect(harness.result.current.error).not.toContain("secret");
      expect(storageWrite).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    },
  );
});
