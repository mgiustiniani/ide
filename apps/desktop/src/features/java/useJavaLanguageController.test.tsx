import type {
  JavaCompletionResponse,
  LanguageServiceEvent,
  LanguageServiceStatus,
  WorkspaceInfo,
} from "@ide/contracts";
import type {
  DocumentSyncPort,
  JavaIntelligencePort,
  LanguageSessionPort,
} from "@ide/web-core/ports";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useJavaLanguageController,
  type JavaLanguageEditorState,
  type ReadyJavaEditorDocument,
} from "./useJavaLanguageController";

const workspace: WorkspaceInfo = {
  id: "workspace-one",
  name: "Workspace One",
  rootPath: "/workspace/one",
};

function readyStatus(generation = 3): LanguageServiceStatus {
  return {
    state: "ready",
    provider: "jdt-ls",
    workspaceId: workspace.id,
    generation,
    capabilities: {
      documentSync: true,
      diagnostics: true,
      completion: true,
      hover: true,
      signature: true,
      definition: false,
      references: false,
      symbols: false,
      codeActions: false,
      formatting: false,
      rename: false,
      hierarchy: false,
    },
    checkedAt: "2026-07-13T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createHarness(initialStatus = readyStatus()) {
  let status = initialStatus;
  const listeners = new Set<(event: LanguageServiceEvent) => void>();
  const unsubscribe = vi.fn();
  const languageSession: LanguageSessionPort = {
    getStatus: vi.fn(async () => status),
    start: vi.fn(async () => {
      status = readyStatus(status.generation + 1);
      return status;
    }),
    stop: vi.fn(async ({ workspaceId }) => ({
      ...status,
      workspaceId,
      state: "stopped" as const,
    })),
    restart: vi.fn(async () => {
      status = readyStatus(status.generation + 1);
      return status;
    }),
    subscribe: vi.fn((_workspaceId, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    }),
  };
  const documentSync: DocumentSyncPort = {
    didOpen: vi.fn().mockResolvedValue(undefined),
    didChange: vi.fn().mockResolvedValue(undefined),
    didSave: vi.fn().mockResolvedValue(undefined),
    didClose: vi.fn().mockResolvedValue(undefined),
  };
  const unavailable = (request: { requestId: string }) =>
    Promise.resolve({
      ok: false as const,
      requestId: request.requestId,
      error: { kind: "provider-error" as const, summary: "provider failed" },
    });
  const javaIntelligence: JavaIntelligencePort = {
    completion: vi.fn(unavailable),
    hover: vi.fn(unavailable),
    signatureHelp: vi.fn(unavailable),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  const editor: JavaLanguageEditorState = { activeFilePath: null, contents: {} };
  let readyActiveDocument: ReadyJavaEditorDocument | null = null;

  return {
    languageSession,
    documentSync,
    javaIntelligence,
    editor,
    unsubscribe,
    emit(event: LanguageServiceEvent) {
      for (const listener of listeners) listener(event);
    },
    setStatus(next: LanguageServiceStatus) {
      status = next;
    },
    get readyActiveDocument() {
      return readyActiveDocument;
    },
    setReady(path: string | null, text = "") {
      editor.activeFilePath = path;
      editor.contents = path ? { ...editor.contents, [path]: text } : {};
      readyActiveDocument = path ? { path, text } : null;
    },
  };
}

function renderController(harness: ReturnType<typeof createHarness>) {
  return renderHook(() =>
    useJavaLanguageController({
      languageSession: harness.languageSession,
      documentSync: harness.documentSync,
      javaIntelligence: harness.javaIntelligence,
      workspaceInfo: workspace,
      workspaceGeneration: 0,
      getEditorState: () => harness.editor,
      readyActiveDocument: harness.readyActiveDocument,
    }),
  );
}

async function attachAndLoad(controller: ReturnType<typeof renderController>) {
  act(() => controller.result.current.attach(workspace, 0));
  await act(() => controller.result.current.load());
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useJavaLanguageController", () => {
  it("owns didOpen/change/save/close with optimistic monotonic versions", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);

    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    expect(harness.documentSync.didOpen).toHaveBeenCalledWith({
      document: expect.objectContaining({ path: "src/Main.java", version: 1, languageId: "java" }),
    });

    act(() => {
      harness.editor.contents["src/Main.java"] = "class Main { int value; }";
      controller.result.current.queueChange("src/Main.java", "class Main { int first; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int value; }");
    });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(harness.documentSync.didChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(harness.documentSync.didChange).mock.calls[0][0].document.version).toBe(3);

    await act(() => controller.result.current.notifySaved("src/Main.java"));
    expect(harness.documentSync.didSave).toHaveBeenCalledWith({
      document: expect.objectContaining({ path: "src/Main.java", version: 3 }),
    });
    await act(() => controller.result.current.closeDocument("src/Main.java"));
    expect(harness.documentSync.didClose).toHaveBeenCalledWith({
      document: expect.objectContaining({ path: "src/Main.java", version: 3 }),
    });
  });

  it("guards status generations and publishes only current exact-document diagnostics", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));

    act(() => {
      harness.emit({ type: "status", status: readyStatus(2) });
      harness.emit({
        type: "diagnostics",
        workspaceId: workspace.id,
        generation: 2,
        provider: "jdt-ls",
        document: {
          workspaceId: workspace.id,
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 1,
        },
        diagnostics: [],
      });
      harness.emit({
        type: "diagnostics",
        workspaceId: workspace.id,
        generation: 3,
        provider: "jdt-ls",
        document: {
          workspaceId: workspace.id,
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 2,
        },
        diagnostics: [
          {
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
            severity: "error",
            message: "current problem",
          },
        ],
      });
    });

    expect(controller.result.current.status?.generation).toBe(3);
    expect(controller.result.current.activeDiagnostics).toHaveLength(1);
    expect(controller.result.current.problemItems[0].message).toBe("current problem");

    act(() =>
      harness.emit({
        type: "diagnostics",
        workspaceId: workspace.id,
        generation: 3,
        provider: "jdt-ls",
        document: {
          workspaceId: workspace.id,
          path: "src/Main.java",
          uri: "file:///workspace/one/src/Main.java",
          version: 1,
        },
        diagnostics: [],
      }),
    );
    expect(controller.result.current.activeDiagnostics).toHaveLength(1);
  });

  it("flushes before semantics, redacts extra fields, rejects stale results, and cancels", async () => {
    const order: string[] = [];
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    const response = deferred<JavaCompletionResponse>();
    vi.mocked(harness.javaIntelligence.completion).mockImplementation(async () => {
      order.push("completion");
      return response.promise;
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));

    act(() => {
      harness.setReady("src/Main.java", "class Main { int value; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int value; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics;
    expect(semantics?.context?.document.version).toBe(2);
    const request = {
      ...semantics!.context!,
      document: { ...semantics!.context!.document },
      position: { line: 0, character: 5 },
      requestId: "completion-request",
      cancellationId: "completion-cancel",
      trigger: { kind: "invoked" as const },
      source: "must-not-cross-boundary",
    };
    let resultPromise!: Promise<JavaCompletionResponse>;
    act(() => {
      resultPromise = semantics!.completion(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.completion).toHaveBeenCalledOnce());
    expect(order).toEqual(["change", "completion"]);
    expect(vi.mocked(harness.javaIntelligence.completion).mock.calls[0][0]).not.toHaveProperty(
      "source",
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: false,
      requestId: request.requestId,
      error: { kind: "provider-error", summary: "late response" },
    });
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ kind: "stale-version" }),
      }),
    );

    act(() => controller.result.current.javaSemantics?.cancel("exact-cancellation-id"));
    expect(harness.javaIntelligence.cancel).toHaveBeenCalledWith("exact-cancellation-id");
  });

  it("closes before restart and deterministically detaches on workspace switch", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));

    await act(() => controller.result.current.restart());
    expect(harness.documentSync.didClose).toHaveBeenCalledTimes(1);
    expect(harness.languageSession.restart).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: workspace.id, generation: 3 }),
    );
    expect(controller.result.current.status?.generation).toBe(4);

    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    await act(() => controller.result.current.detach(1));
    expect(harness.documentSync.didClose).toHaveBeenCalledTimes(2);
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.languageSession.stop).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: workspace.id, generation: 4 }),
    );
    expect(controller.result.current.status).toBeNull();
    expect(controller.result.current.javaSemantics).toBeUndefined();
  });
});
