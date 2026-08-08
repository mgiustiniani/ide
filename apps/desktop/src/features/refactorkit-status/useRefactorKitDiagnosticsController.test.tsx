import type {
  RefactorKitCapabilities,
  RefactorKitStatus,
  SavedSnapshotSemanticSessionStartResult,
  TypeScriptDiagnosticsRequest,
  TypeScriptDiagnosticsResponse,
  WorkspaceInfo,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useRefactorKitDiagnosticsController,
  type TypeScriptDiagnosticsEditorDocument,
  type UseRefactorKitDiagnosticsControllerDependencies,
} from "./useRefactorKitDiagnosticsController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const runtime = {
  executionMode: "external-process",
  supportsTimeout: true,
  supportsCancellation: true,
  usesWorkspaceOverlay: true,
  recordsProcessProvenance: true,
  limits: {
    requestTimeoutMillis: 30_000,
    maxInputBytes: 8_388_608,
    maxOutputBytes: 8_388_608,
    maxProcesses: 1,
  },
} as const;

const capabilities: RefactorKitCapabilities = {
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
          backend: "composite-language-adapter",
          runtime: structuredClone(runtime),
          capabilities: [
            {
              operation: "diagnostics",
              stability: "experimental",
              evidence: "compiler",
              mutationAuthority: "none",
              backend: "typescript-compiler-exact-v1",
              runtime: structuredClone(runtime),
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

const status: RefactorKitStatus = {
  available: true,
  version: "0.7.0-SNAPSHOT",
};

const workspace: WorkspaceInfo = {
  id: "workspace:authorized",
  name: "Authorized",
  rootPath: "/workspace/authorized",
};

const session: SavedSnapshotSemanticSessionStartResult = {
  languageId: "typescript",
  workspaceRoot: workspace.rootPath,
  workspaceId: workspace.id,
  workspaceGeneration: 7,
  sessionId: `refactorkit-semantic-session-v1:${"a".repeat(64)}`,
  providerProjectSnapshotIdentity: `sha256:${"b".repeat(64)}`,
  semanticLease: "semantic-00000000-0000-4000-8000-000000000007",
  startSnapshotHash: `sha256:${"c".repeat(64)}`,
  provider: "refactorkit",
  providerVersion: "0.7.0-SNAPSHOT",
  backend: "language-server-backend",
  toolchain: {
    backend: "language-server-backend",
    runtime: structuredClone(runtime),
    extensions: ["ts", "tsx"],
    nodeExecutable: "/toolchain/node",
    languageServerPackageRoot: "/toolchain/language-server",
    typeScriptPackageRoot: "/toolchain/typescript",
  },
  semanticCompleteness: "full-typescript",
  processProvenance: {
    serverName: "typescript-language-server",
    serverVersion: "1.0.0",
    capabilitiesSha256: "d".repeat(64),
    executableSha256: "e".repeat(64),
    argumentsSha256: "f".repeat(64),
    processId: 42,
  },
};

function response(
  request: TypeScriptDiagnosticsRequest,
  options: {
    status?: "ready" | "refused" | "error";
    message?: string;
    diagnosticMessage?: string;
  } = {},
): TypeScriptDiagnosticsResponse {
  const responseStatus = options.status ?? "ready";
  const diagnostics =
    responseStatus === "ready"
      ? [
          {
            severity: "error" as const,
            message: options.diagnosticMessage ?? "Type mismatch",
            code: "TS2322",
            evidence: "compiler" as const,
            category: "type-resolution",
            location: {
              kind: "range" as const,
              path: request.sourceAuthority.documents[0]!.path,
              encoding: "utf-16" as const,
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 12 },
              },
            },
          },
        ]
      : [];
  return {
    schemaVersion: 2,
    operation: "diagnostics.v2",
    requestId: request.requestId,
    languageId: "typescript",
    status: responseStatus,
    workspaceId: request.workspaceId,
    workspaceGeneration: request.workspaceGeneration,
    sessionId: request.sessionId,
    provider: { name: "refactorkit", version: "0.7.0-SNAPSHOT", apiVersion: "0.2" },
    backend: "typescript-compiler-exact-v1",
    semanticLease: request.semanticLease,
    projectSnapshotHash: request.expectedSnapshotHash,
    providerSnapshotHash: "1".repeat(64),
    sourceAuthority: {
      kind: "immutable-editor-overlay",
      baseSnapshotHash: request.expectedSnapshotHash,
      overlayHash: "2".repeat(64),
      providerSnapshotHash: "1".repeat(64),
      documents: request.sourceAuthority.documents.map((document) => ({
        path: document.path,
        version: document.version,
        contentSha256: "3".repeat(64),
      })),
    },
    rangeEncoding: "utf-16",
    rangeCapability: "exact-utf16-or-explicit-partial",
    runtime: {
      ...runtime,
      limits: {
        ...runtime.limits,
        maxStderrBytes: 65_536,
        compilerHeapMiB: 512,
        maxDiagnostics: 500,
        maxDiagnosticMessageChars: 4_096,
        maxResponseBytes: 2_097_152,
      },
    },
    compilerAttestation:
      responseStatus === "refused"
        ? null
        : {
            toolchainProvider: "accepted-toolchain",
            nodeVersion: "22.0.0",
            typeScriptVersion: "5.9.3",
            compilerSha256: "4".repeat(64),
            toolchainEvidenceSha256: "5".repeat(64),
            process: {
              executableSha256: "6".repeat(64),
              argumentsSha256: "7".repeat(64),
              processId: 42,
            },
          },
    failure:
      responseStatus === "ready"
        ? null
        : { code: `diagnostics.${responseStatus}`, message: options.message ?? responseStatus },
    diagnostics,
    diagnosticsTotal: diagnostics.length,
    diagnosticsReturned: diagnostics.length,
    truncated: false,
    responseBytes: 1,
  } as TypeScriptDiagnosticsResponse;
}

function setup() {
  let document: Readonly<TypeScriptDiagnosticsEditorDocument> | null = {
    path: "src/broken.ts",
    version: 9,
    content: 'const amount: number = "wrong";\n',
  };
  let acceptedSession: Readonly<SavedSnapshotSemanticSessionStartResult> | null = session;
  let context = {
    generation: 7,
    workspaceId: workspace.id,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const diagnostics = vi.fn<RefactorKitPort["diagnostics"]>(async (request) => response(request));
  const refactorKit = { diagnostics } as unknown as RefactorKitPort;
  const dependencies = (): UseRefactorKitDiagnosticsControllerDependencies => ({
    refactorKit,
    status,
    capabilities,
    isCheckingCapabilities: false,
    workspaceInfo: workspace,
    workspaceGeneration: 7,
    acceptedSession,
    getWorkspaceContext: () => context,
    getCurrentDocument: () => document,
  });
  const controller = renderHook(() => useRefactorKitDiagnosticsController(dependencies()));
  return {
    controller,
    diagnostics,
    dependencies,
    setDocument(value: Readonly<TypeScriptDiagnosticsEditorDocument> | null) {
      document = value;
      controller.rerender();
    },
    setAcceptedSession(value: Readonly<SavedSnapshotSemanticSessionStartResult> | null) {
      acceptedSession = value;
      controller.rerender();
    },
    setContext(value: typeof context) {
      context = value;
      controller.rerender();
    },
  };
}

describe("useRefactorKitDiagnosticsController", () => {
  it("refuses before transport when no current accepted semantic session exists", async () => {
    const fixture = setup();
    fixture.setAcceptedSession(null);

    await act(() => fixture.controller.result.current.request());

    expect(fixture.diagnostics).not.toHaveBeenCalled();
    expect(fixture.controller.result.current.presentation).toEqual({
      state: "refused",
      message:
        "Compiler diagnostics require a current authorized TypeScript snapshot and qualified semantic session.",
    });
  });

  it("publishes one ready response atomically with exact Problems and Monaco fields", async () => {
    const gate = deferred<TypeScriptDiagnosticsResponse>();
    const fixture = setup();
    fixture.diagnostics.mockImplementationOnce(() => gate.promise);

    let request!: Promise<void>;
    act(() => {
      request = fixture.controller.result.current.request();
    });
    expect(fixture.controller.result.current.presentation).toEqual({ state: "checking" });
    const submitted = fixture.diagnostics.mock.calls[0]![0];
    expect(submitted).toMatchObject({
      schemaVersion: 2,
      operation: "diagnostics.v2",
      workspaceId: workspace.id,
      workspaceGeneration: 7,
      sessionId: session.sessionId,
      expectedSnapshotHash: session.startSnapshotHash,
      semanticLease: session.semanticLease,
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
    });

    gate.resolve(response(submitted));
    await act(async () => request);

    expect(fixture.controller.result.current.presentation).toEqual({
      state: "ready",
      diagnosticCount: 1,
    });
    expect(fixture.controller.result.current.activeDiagnosticDocument).toEqual({
      workspaceId: workspace.id,
      path: "src/broken.ts",
      uri: "file:///workspace/authorized/src/broken.ts",
    });
    expect(fixture.controller.result.current.activeDiagnostics).toEqual([
      {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
        severity: "error",
        message: "Type mismatch",
        code: "TS2322",
        source: "compiler",
      },
    ]);
    expect(fixture.controller.result.current.problemItems[0]).toMatchObject({
      provider: "refactorkit",
      filePath: "src/broken.ts",
      severity: "error",
      message: "Type mismatch",
      code: "TS2322",
      source: "compiler",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
    });
  });

  it("preserves prior diagnostics on refused and error responses and bounds safe messages", async () => {
    const fixture = setup();
    await act(() => fixture.controller.result.current.request());
    const priorProblems = fixture.controller.result.current.problemItems;

    fixture.diagnostics.mockImplementationOnce(async (request) =>
      response(request, {
        status: "refused",
        message: `${"x".repeat(220)} /private/workspace/secret.ts ${"a".repeat(64)}`,
      }),
    );
    await act(() => fixture.controller.result.current.request());

    expect(fixture.controller.result.current.presentation?.state).toBe("refused");
    const refusedMessage = (
      fixture.controller.result.current.presentation as {
        message: string;
      }
    ).message;
    expect(Array.from(refusedMessage).length).toBeLessThanOrEqual(180);
    expect(refusedMessage).not.toContain("secret.ts");
    expect(refusedMessage).not.toContain("a".repeat(64));
    expect(fixture.controller.result.current.problemItems).toBe(priorProblems);

    fixture.diagnostics.mockRejectedValueOnce(new Error("/private/source/Secret.ts"));
    await act(() => fixture.controller.result.current.request());
    expect(fixture.controller.result.current.presentation).toEqual({
      state: "error",
      message: "Compiler diagnostics could not be completed for the current source snapshot.",
    });
    expect(fixture.controller.result.current.problemItems).toBe(priorProblems);
  });

  it("rejects a mismatched typed completion before it can replace prior diagnostics", async () => {
    const fixture = setup();
    await act(() => fixture.controller.result.current.request());
    const priorProblems = fixture.controller.result.current.problemItems;

    fixture.diagnostics.mockImplementationOnce(async (request) => ({
      ...response(request, { diagnosticMessage: "Mismatched diagnostic" }),
      requestId: "diagnostics:other-request",
    }));
    await act(() => fixture.controller.result.current.request());

    expect(fixture.controller.result.current.presentation).toEqual({
      state: "error",
      message: "Compiler diagnostics could not be completed for the current source snapshot.",
    });
    expect(fixture.controller.result.current.problemItems).toBe(priorProblems);
  });

  it("prevents older and source-stale completions from replacing current diagnostics", async () => {
    const staleGate = deferred<TypeScriptDiagnosticsResponse>();
    const currentGate = deferred<TypeScriptDiagnosticsResponse>();
    const fixture = setup();
    fixture.diagnostics
      .mockImplementationOnce(() => staleGate.promise)
      .mockImplementationOnce(() => currentGate.promise);

    let staleRequest!: Promise<void>;
    act(() => {
      staleRequest = fixture.controller.result.current.request();
    });
    const staleSubmitted = fixture.diagnostics.mock.calls[0]![0];

    let currentRequest!: Promise<void>;
    act(() => {
      currentRequest = fixture.controller.result.current.request();
    });
    const currentSubmitted = fixture.diagnostics.mock.calls[1]![0];
    currentGate.resolve(response(currentSubmitted, { diagnosticMessage: "Current diagnostic" }));
    await act(async () => currentRequest);
    expect(fixture.controller.result.current.problemItems[0]?.message).toBe("Current diagnostic");

    staleGate.resolve(response(staleSubmitted, { diagnosticMessage: "Stale diagnostic" }));
    await act(async () => staleRequest);
    expect(fixture.controller.result.current.problemItems[0]?.message).toBe("Current diagnostic");

    const sourceGate = deferred<TypeScriptDiagnosticsResponse>();
    fixture.diagnostics.mockImplementationOnce(() => sourceGate.promise);
    let sourceRequest!: Promise<void>;
    act(() => {
      sourceRequest = fixture.controller.result.current.request();
    });
    const sourceSubmitted = fixture.diagnostics.mock.calls[2]![0];
    fixture.setDocument({
      path: "src/broken.ts",
      version: 10,
      content: "const amount: number = 1;\n",
    });
    await waitFor(() =>
      expect(fixture.controller.result.current.presentation?.state).toBe("refused"),
    );
    sourceGate.resolve(response(sourceSubmitted, { diagnosticMessage: "Source-stale diagnostic" }));
    await act(async () => sourceRequest);
    expect(fixture.controller.result.current.problemItems[0]?.message).toBe("Current diagnostic");
  });

  it("clears diagnostics only when workspace authority changes", async () => {
    const fixture = setup();
    await act(() => fixture.controller.result.current.request());
    expect(fixture.controller.result.current.problemItems).toHaveLength(1);

    fixture.setContext({
      generation: 8,
      workspaceId: "workspace:replacement",
      isSwitching: true,
      isMetadataLoading: false,
    });

    await waitFor(() => expect(fixture.controller.result.current.problemItems).toHaveLength(0));
    expect(fixture.controller.result.current.presentation).toBeNull();
  });
});
