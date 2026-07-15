import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TauriAdapterError } from "./errors";
import { TauriLanguageSessionAdapter } from "./language-session-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const nativeCapabilities = {
  documentSync: true,
  diagnostics: true,
  completion: true,
  hover: true,
  definition: true,
  references: false,
  documentSymbols: true,
  workspaceSymbols: false,
  rename: true,
  codeActions: true,
  formatting: false,
  signatureHelp: true,
};

function nativeStatus(overrides: Record<string, unknown> = {}) {
  return {
    provider: "jdtls",
    available: true,
    lifecycle: "initialized",
    generation: 7,
    workspaceId: "workspace-1",
    workspaceRoot: "/workspace/project",
    jdtlsHome: "/tools/jdtls",
    jdtlsVersion: "1.42.0",
    javaExecutable: "/jdk/bin/java",
    javaVersion: "21.0.5",
    capabilities: nativeCapabilities,
    detail: null,
    ...overrides,
  };
}

function emptyBatch(latestSequence = 0) {
  return { events: [], latestSequence, droppedBeforeSequence: null };
}

async function firstPoll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("TauriLanguageSessionAdapter lifecycle", () => {
  beforeEach(() => invokeMock.mockReset());

  it("maps status/start/stop/restart to the exact no-argument Rust commands", async () => {
    invokeMock.mockResolvedValue(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter();

    await adapter.getStatus({ workspaceId: "workspace-1" });
    await adapter.start({ workspaceId: "workspace-1", requestId: "ignored-at-native-edge" });
    await adapter.stop({ workspaceId: "workspace-1", generation: 7 });
    await adapter.restart({ workspaceId: "workspace-1", generation: 7 });

    expect(invokeMock.mock.calls).toEqual([
      ["get_java_language_service_status", undefined],
      ["start_java_language_service", undefined],
      ["stop_java_language_service", undefined],
      ["restart_java_language_service", undefined],
    ]);
  });

  it("normalizes provider, tool, JDK, generation, timestamp, and confirmed capabilities", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const status = await new TauriLanguageSessionAdapter().getStatus({
      workspaceId: "workspace-1",
    });

    expect(status).toMatchObject({
      state: "ready",
      provider: "jdt-ls",
      providerVersion: "1.42.0",
      serverPath: "/tools/jdtls",
      serverVersion: "1.42.0",
      javaExecutable: "/jdk/bin/java",
      javaVersion: "21.0.5",
      workspaceId: "workspace-1",
      generation: 7,
      capabilities: {
        documentSync: true,
        diagnostics: true,
        completion: true,
        hover: true,
        signature: true,
        definition: true,
        references: false,
        symbols: true,
        codeActions: true,
        formatting: false,
        rename: true,
        hierarchy: false,
      },
    });
    expect(new Date(status.checkedAt).toISOString()).toBe(status.checkedAt);
    expect(status).not.toHaveProperty("workspaceRoot");
  });

  it("uses native document-sync and diagnostics flags after initialization", async () => {
    invokeMock.mockResolvedValueOnce(
      nativeStatus({
        capabilities: { ...nativeCapabilities, documentSync: false, diagnostics: false },
      }),
    );
    const status = await new TauriLanguageSessionAdapter().getStatus({
      workspaceId: "workspace-1",
    });
    expect(status.capabilities.documentSync).toBe(false);
    expect(status.capabilities.diagnostics).toBe(false);
  });

  it("keeps every capability false before initialization and maps discovery failure to unavailable", async () => {
    invokeMock.mockResolvedValueOnce(
      nativeStatus({
        available: false,
        lifecycle: "stopped",
        generation: 0,
        capabilities: null,
        detail: "JDK not found",
        jdtlsVersion: null,
      }),
    );
    const status = await new TauriLanguageSessionAdapter().getStatus({
      workspaceId: "workspace-1",
    });
    expect(status.state).toBe("unavailable");
    expect(Object.values(status.capabilities)).toEqual(Array(12).fill(false));
    expect(status.lastError).toBe("JDK not found");
  });

  it.each([
    ["invalid generation", { generation: -1 }],
    ["wrong workspace", { workspaceId: "other" }],
    ["unknown lifecycle", { lifecycle: "running" }],
    ["malformed capability", { capabilities: { ...nativeCapabilities, hover: "yes" } }],
    ["malformed JDK field", { javaExecutable: 42 }],
  ])("rejects %s without leaking an untyped response", async (_name, overrides) => {
    invokeMock.mockResolvedValueOnce(nativeStatus(overrides));
    await expect(
      new TauriLanguageSessionAdapter().getStatus({ workspaceId: "workspace-1" }),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });
});

describe("TauriLanguageSessionAdapter document synchronization", () => {
  beforeEach(() => invokeMock.mockReset());

  async function readyAdapter(): Promise<TauriLanguageSessionAdapter> {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter();
    await adapter.getStatus({ workspaceId: "workspace-1" });
    invokeMock.mockReset();
    return adapter;
  }

  const openDocument = {
    workspaceId: "workspace-1",
    path: "src/Main.java",
    uri: "file:///workspace/project/src/Main.java",
    version: 0,
    languageId: "java",
    text: "class Main {}",
  };

  it("maps open/change/save/close to exact native command payloads without forwarding request metadata", async () => {
    const adapter = await readyAdapter();
    invokeMock.mockResolvedValue(undefined);

    await adapter.didOpen({ document: openDocument, requestId: "open-request" });
    const changed = { ...openDocument, version: 1, text: "class Main { int n; }" };
    await adapter.didChange({ document: changed, cancellationId: "cancel-id" });
    await adapter.didSave({ document: changed, requestId: "save-request" });
    await adapter.didClose({
      document: {
        workspaceId: changed.workspaceId,
        path: changed.path,
        uri: changed.uri,
        version: changed.version,
      },
      requestId: "close-request",
    });

    expect(invokeMock.mock.calls).toEqual([
      ["open_java_language_document", { document: { ...openDocument, generation: 7 } }],
      ["change_java_language_document", { document: { ...changed, generation: 7 } }],
      ["save_java_language_document", { document: { ...changed, generation: 7 } }],
      [
        "close_java_language_document",
        {
          document: {
            workspaceId: changed.workspaceId,
            generation: 7,
            path: changed.path,
            uri: changed.uri,
            version: changed.version,
          },
        },
      ],
    ]);
  });

  it("propagates backend rejection without leaking source text and permits retry", async () => {
    const adapter = await readyAdapter();
    invokeMock
      .mockRejectedValueOnce(`backend rejected: ${openDocument.text}`)
      .mockResolvedValueOnce(undefined);

    let rejection: unknown;
    try {
      await adapter.didOpen({ document: openDocument });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(TauriAdapterError);
    expect((rejection as Error).message).toContain("backend rejected");
    expect((rejection as Error).message).not.toContain(openDocument.text);
    expect((rejection as TauriAdapterError).cause).toBeUndefined();
    await expect(adapter.didOpen({ document: openDocument })).resolves.toBeUndefined();
  });

  it("preflights Java paths/language, safe monotonic versions, and UTF-8 text bounds", async () => {
    const adapter = await readyAdapter();
    await expect(
      adapter.didOpen({ document: { ...openDocument, languageId: "kotlin" } }),
    ).rejects.toThrow("Java language");
    await expect(
      adapter.didOpen({ document: { ...openDocument, path: "../Main.java" } }),
    ).rejects.toThrow("workspace-relative");
    await expect(
      adapter.didOpen({ document: { ...openDocument, version: Number.MAX_SAFE_INTEGER + 1 } }),
    ).rejects.toThrow("safe integer");
    await expect(
      adapter.didOpen({ document: { ...openDocument, text: "é".repeat(1_048_577) } }),
    ).rejects.toThrow("byte limit");
    expect(invokeMock).not.toHaveBeenCalled();

    invokeMock.mockResolvedValue(undefined);
    await adapter.didOpen({ document: openDocument });
    await expect(
      adapter.didChange({ document: { ...openDocument, version: 0, text: "changed" } }),
    ).rejects.toThrow("strictly increasing");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("TauriLanguageSessionAdapter polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("uses one shared bounded loop, a monotonic cursor, and stops after the final unsubscribe", async () => {
    invokeMock
      .mockResolvedValueOnce({
        events: [
          {
            sequence: 1,
            generation: 1,
            kind: "progress",
            payload: { indexing: true, percentage: 25 },
          },
        ],
        latestSequence: 1,
      })
      .mockResolvedValueOnce(emptyBatch(1));
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50, pollLimit: 17 });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = adapter.subscribe("workspace-1", first);
    const unsubscribeSecond = adapter.subscribe("workspace-1", second);

    await firstPoll();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith("poll_java_language_service_events", {
      afterSequence: 0,
      limit: 17,
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    unsubscribeFirst();
    await vi.advanceTimersByTimeAsync(50);
    expect(invokeMock).toHaveBeenLastCalledWith("poll_java_language_service_events", {
      afterSequence: 1,
      limit: 17,
    });
    unsubscribeSecond();
    unsubscribeSecond();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("never delivers an event after unsubscribe, including an in-flight poll", async () => {
    let resolvePoll!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const listener = vi.fn();
    const unsubscribe = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 }).subscribe(
      "workspace-1",
      listener,
    );
    await firstPoll();
    unsubscribe();
    resolvePoll({
      events: [{ sequence: 1, generation: 1, kind: "progress", payload: { indexing: true } }],
      latestSequence: 1,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not overlap polls and backs off after failures before recovering", async () => {
    let rejectFirst!: (reason: unknown) => void;
    invokeMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(emptyBatch());
    const listener = vi.fn();
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50, maxBackoffMs: 500 });
    const unsubscribe = adapter.subscribe("workspace-1", listener);

    await firstPoll();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    rejectFirst("temporary native failure");
    await Promise.resolve();
    await Promise.resolve();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      type: "status",
      status: { state: "failed", lastError: expect.stringContaining("temporary native failure") },
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("uses the hidden visibility interval rather than busy-looping", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { visibilityState: "hidden" },
    });
    invokeMock.mockResolvedValue(emptyBatch());
    const adapter = new TauriLanguageSessionAdapter({
      pollIntervalMs: 50,
      hiddenPollIntervalMs: 500,
    });
    const unsubscribe = adapter.subscribe("workspace-1", vi.fn());
    await firstPoll();
    await vi.advanceTimersByTimeAsync(499);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    unsubscribe();
    Reflect.deleteProperty(globalThis, "document");
  });

  it("rejects malformed batches safely, surfaces an adapter status, and keeps polling", async () => {
    invokeMock
      .mockResolvedValueOnce({ events: "bad", latestSequence: 4 })
      .mockResolvedValueOnce(emptyBatch());
    const listener = vi.fn();
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    const unsubscribe = adapter.subscribe("workspace-1", listener);
    await firstPoll();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        status: expect.objectContaining({
          lastError: expect.stringContaining("invalid events array"),
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("drops stale-generation events while preserving generation and sequence for current events", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus()).mockResolvedValueOnce({
      events: [
        { sequence: 8, generation: 6, kind: "progress", payload: { indexing: true } },
        {
          sequence: 9,
          generation: 7,
          kind: "progress",
          payload: { indexing: true, message: "Indexing", percentage: 50 },
        },
      ],
      latestSequence: 9,
    });
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);
    await firstPoll();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "progress",
      workspaceId: "workspace-1",
      generation: 7,
      provider: "jdt-ls",
      progress: { indexing: true, message: "Indexing", percentage: 50 },
    });
    unsubscribe();
  });

  it("accepts empty diagnostics as a clear and drops stale diagnostic generations", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus()).mockResolvedValueOnce({
      events: [
        {
          sequence: 1,
          generation: 6,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-1",
            generation: 6,
            params: { uri: "file:///workspace/project/src/Main.java", version: 2, diagnostics: [] },
          },
        },
        {
          sequence: 2,
          generation: 7,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-1",
            generation: 7,
            params: { uri: "file:///workspace/project/src/Main.java", version: 3, diagnostics: [] },
          },
        },
      ],
      latestSequence: 2,
    });
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);
    await firstPoll();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "diagnostics",
      workspaceId: "workspace-1",
      generation: 7,
      provider: "jdt-ls",
      document: {
        workspaceId: "workspace-1",
        path: "src/Main.java",
        uri: "file:///workspace/project/src/Main.java",
        version: 3,
      },
      diagnostics: [],
    });
    unsubscribe();
  });

  it("receipt-associates real-shaped omitted-version errors and empty clears with the open document version", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    invokeMock.mockResolvedValueOnce(undefined);
    await adapter.didOpen({
      document: {
        workspaceId: "workspace-1",
        path: "src/Main.java",
        uri: "file:///workspace/project/src/Main.java",
        version: 4,
        languageId: "java",
        text: "class Main {}",
      },
    });
    invokeMock
      .mockResolvedValueOnce({
        events: [
          {
            sequence: 1,
            generation: 7,
            kind: "diagnostics",
            payload: {
              method: "textDocument/publishDiagnostics",
              workspaceId: "workspace-1",
              generation: 7,
              params: {
                uri: "file:///workspace/project/src/Main.java",
                diagnostics: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    severity: 1,
                    message: "Broken",
                    source: "java",
                  },
                ],
              },
            },
          },
        ],
        latestSequence: 1,
      })
      .mockResolvedValueOnce({
        events: [
          {
            sequence: 2,
            generation: 7,
            kind: "diagnostics",
            payload: {
              method: "textDocument/publishDiagnostics",
              workspaceId: "workspace-1",
              generation: 7,
              params: { uri: "file:///workspace/project/src/Main.java", diagnostics: [] },
            },
          },
        ],
        latestSequence: 2,
      });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);

    await firstPoll();
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "diagnostics",
        document: expect.objectContaining({ path: "src/Main.java", version: 4 }),
        diagnostics: [
          expect.objectContaining({
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: "Broken",
          }),
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "diagnostics",
        document: expect.objectContaining({ path: "src/Main.java", version: 4 }),
        diagnostics: [],
      }),
    );
    unsubscribe();
  });

  it("drops omitted-version diagnostics for unopened or different paths and rejects a wrong workspace", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus()).mockResolvedValueOnce({
      events: [
        {
          sequence: 1,
          generation: 7,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-1",
            generation: 7,
            params: { uri: "file:///workspace/project/src/Unopened.java", diagnostics: [] },
          },
        },
        {
          sequence: 2,
          generation: 7,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-other",
            generation: 7,
            params: { uri: "file:///workspace/project/src/Main.java", diagnostics: [] },
          },
        },
      ],
      latestSequence: 2,
    });
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);

    await firstPoll();
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: "diagnostics" }));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        status: expect.objectContaining({
          lastError: expect.stringContaining("workspace or generation mismatch"),
        }),
      }),
    );
    unsubscribe();
  });

  it("preserves an explicit diagnostics version independently of the synchronized version", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    invokeMock.mockResolvedValueOnce(undefined);
    await adapter.didOpen({
      document: {
        workspaceId: "workspace-1",
        path: "src/Main.java",
        uri: "file:///workspace/project/src/Main.java",
        version: 4,
        languageId: "java",
        text: "class Main {}",
      },
    });
    invokeMock.mockResolvedValueOnce({
      events: [
        {
          sequence: 1,
          generation: 7,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-1",
            generation: 7,
            params: { uri: "file:///workspace/project/src/Main.java", version: 2, diagnostics: [] },
          },
        },
      ],
      latestSequence: 1,
    });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);

    await firstPoll();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "diagnostics",
        document: expect.objectContaining({ version: 2 }),
      }),
    );
    unsubscribe();
  });

  it("cannot associate an omitted-version event once close is pending", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    const document = {
      workspaceId: "workspace-1",
      path: "src/Main.java",
      uri: "file:///workspace/project/src/Main.java",
      version: 4,
      languageId: "java" as const,
      text: "class Main {}",
    };
    invokeMock.mockResolvedValueOnce(undefined);
    await adapter.didOpen({ document });
    let resolveClose!: () => void;
    invokeMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve;
          }),
      )
      .mockResolvedValueOnce({
        events: [
          {
            sequence: 1,
            generation: 7,
            kind: "diagnostics",
            payload: {
              workspaceId: "workspace-1",
              generation: 7,
              params: {
                uri: document.uri,
                diagnostics: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    severity: 1,
                    message: "Late",
                  },
                ],
              },
            },
          },
        ],
        latestSequence: 1,
      });

    const close = adapter.didClose({ document });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);
    await firstPoll();
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: "diagnostics" }));
    resolveClose();
    await close;
    unsubscribe();
  });

  it("drops omitted-version diagnostics after a generation cleanup", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    invokeMock.mockResolvedValueOnce(undefined);
    await adapter.didOpen({
      document: {
        workspaceId: "workspace-1",
        path: "src/Main.java",
        uri: "file:///workspace/project/src/Main.java",
        version: 4,
        languageId: "java",
        text: "class Main {}",
      },
    });
    invokeMock.mockResolvedValueOnce(nativeStatus({ generation: 8 }));
    await adapter.restart({ workspaceId: "workspace-1", generation: 7 });
    invokeMock.mockResolvedValueOnce({
      events: [
        {
          sequence: 1,
          generation: 8,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-1",
            generation: 8,
            params: { uri: "file:///workspace/project/src/Main.java", diagnostics: [] },
          },
        },
      ],
      latestSequence: 1,
    });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);

    await firstPoll();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not let a pending old-generation open restore omitted-version association", async () => {
    invokeMock.mockResolvedValueOnce(nativeStatus());
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    let resolveOpen!: () => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const open = adapter.didOpen({
      document: {
        workspaceId: "workspace-1",
        path: "src/Main.java",
        uri: "file:///workspace/project/src/Main.java",
        version: 4,
        languageId: "java",
        text: "class Main {}",
      },
    });
    invokeMock.mockResolvedValueOnce(nativeStatus({ generation: 8 }));
    await adapter.restart({ workspaceId: "workspace-1", generation: 7 });
    resolveOpen();
    await open;
    invokeMock.mockResolvedValueOnce({
      events: [
        {
          sequence: 1,
          generation: 8,
          kind: "diagnostics",
          payload: {
            workspaceId: "workspace-1",
            generation: 8,
            params: { uri: "file:///workspace/project/src/Main.java", diagnostics: [] },
          },
        },
      ],
      latestSequence: 1,
    });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);

    await firstPoll();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("normalizes diagnostics inside the workspace and rejects malformed provider payloads without killing the loop", async () => {
    invokeMock
      .mockResolvedValueOnce(nativeStatus())
      .mockResolvedValueOnce({
        events: [
          { sequence: 1, generation: 7, kind: "notification", payload: {} },
          {
            sequence: 2,
            generation: 7,
            kind: "diagnostics",
            payload: {
              method: "textDocument/publishDiagnostics",
              workspaceId: "workspace-1",
              generation: 7,
              params: {
                uri: "file:///workspace/project/src/Main.java",
                version: 3,
                diagnostics: [
                  {
                    range: { start: { line: 0, character: 0 }, end: { line: 1, character: 5 } },
                    severity: 1,
                    message: "Broken",
                    code: "E1",
                    source: "java",
                  },
                ],
              },
            },
          },
          {
            sequence: 3,
            generation: 7,
            kind: "diagnostics",
            payload: {
              workspaceId: "workspace-1",
              generation: 7,
              params: { uri: "file:///outside/Secret.java", version: 1, diagnostics: [] },
            },
          },
          {
            sequence: 4,
            generation: 7,
            kind: "diagnostics",
            payload: {
              workspaceId: "workspace-1",
              generation: 7,
              params: {
                uri: "file:///workspace/project/src/Main.java",
                version: 4,
                diagnostics: [
                  {
                    range: { start: { line: 2, character: 0 }, end: { line: 1, character: 0 } },
                    severity: 1,
                    message: "Malformed range",
                  },
                ],
              },
            },
          },
        ],
        latestSequence: 4,
      })
      .mockResolvedValueOnce(emptyBatch(4));
    const adapter = new TauriLanguageSessionAdapter({ pollIntervalMs: 50 });
    await adapter.getStatus({ workspaceId: "workspace-1" });
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe("workspace-1", listener);
    await firstPoll();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "diagnostics",
        generation: 7,
        document: {
          workspaceId: "workspace-1",
          path: "src/Main.java",
          uri: "file:///workspace/project/src/Main.java",
          version: 3,
        },
        diagnostics: [
          expect.objectContaining({
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 5 } },
            severity: "error",
            message: "Broken",
            code: "E1",
          }),
        ],
      }),
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        status: expect.objectContaining({
          state: "degraded",
          lastError: expect.stringContaining("outside the workspace"),
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        status: expect.objectContaining({
          lastError: expect.stringContaining("reversed diagnostic.range"),
        }),
      }),
    );
    expect(invokeMock).toHaveBeenLastCalledWith("poll_java_language_service_events", {
      afterSequence: 4,
      limit: 100,
    });
    unsubscribe();
  });
});
