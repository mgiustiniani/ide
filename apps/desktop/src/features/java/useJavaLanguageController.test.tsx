import type {
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaFormattingResponse,
  JavaCodeActionsResponse,
  JavaCodeActionApplyRequest,
  JavaRenameResponse,
  JavaDocumentHighlightsResponse,
  JavaDocumentSymbolsResponse,
  JavaDefinitionsResponse,
  JavaReferencesResponse,
  JavaSemanticTokensResponse,
  JavaWorkspaceSymbolsResponse,
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
    gradleImportEnabled: false,
    gradleSettingsConfigured: false,
    projectPath: "",
    mavenRepository: "",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    capabilities: {
      documentSync: true,
      diagnostics: true,
      completion: true,
      hover: true,
      signature: true,
      definition: false,
      references: false,
      symbols: false,
      documentSymbols: true,
      documentHighlights: true,
      implementation: true,
      workspaceSymbols: true,
      semanticTokens: false,
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
    start: vi.fn(
      async ({
        projectJdkHome,
        serverJdkHome,
        gradleImportEnabled,
        gradle,
        projectPath,
        mavenRepository,
        activeMavenProfiles,
        inactiveMavenProfiles,
        javaFormatterProfile,
      }) => {
        status = {
          ...readyStatus(status.generation + 1),
          projectJdkHome,
          serverJdkHome,
          gradleImportEnabled,
          gradleSettingsConfigured: gradle !== undefined,
          projectPath,
          mavenRepository,
          activeMavenProfiles,
          inactiveMavenProfiles,
          javaFormatterProfile,
        };
        return status;
      },
    ),
    stop: vi.fn(async ({ workspaceId }) => ({
      ...status,
      workspaceId,
      state: "stopped" as const,
    })),
    restart: vi.fn(
      async ({
        projectJdkHome,
        serverJdkHome,
        gradleImportEnabled,
        gradle,
        projectPath,
        mavenRepository,
        activeMavenProfiles,
        inactiveMavenProfiles,
        javaFormatterProfile,
      }) => {
        status = {
          ...readyStatus(status.generation + 1),
          projectJdkHome,
          serverJdkHome,
          gradleImportEnabled,
          gradleSettingsConfigured: gradle !== undefined,
          projectPath,
          mavenRepository,
          activeMavenProfiles,
          inactiveMavenProfiles,
          javaFormatterProfile,
        };
        return status;
      },
    ),
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
    revalidate: vi.fn().mockResolvedValue(undefined),
    didSaveWorkspaceFile: vi.fn().mockResolvedValue(undefined),
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
    documentSymbols: vi.fn(unavailable),
    documentHighlights: vi.fn(unavailable),
    implementations: vi.fn(unavailable),
    definitions: vi.fn(unavailable),
    references: vi.fn(unavailable),
    semanticTokens: vi.fn(unavailable),
    formatDocument: vi.fn(unavailable),
    formatRange: vi.fn(unavailable),
    workspaceSymbols: vi.fn(unavailable),
    codeActions: vi.fn(unavailable),
    rename: vi.fn(unavailable),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  const editor: JavaLanguageEditorState = { activeFilePath: null, contents: {} };
  let readyActiveDocument: ReadyJavaEditorDocument | null = null;

  return {
    projectJdkHome: undefined as string | undefined,
    serverJdkHome: undefined as string | undefined,
    gradleImportEnabled: false,
    gradle: undefined as
      | {
          executable: string;
          userHome: string;
          gradleRuntimeHome?: string;
          projectProperties: Record<string, string>;
        }
      | undefined,
    projectPath: "",
    mavenRepository: "",
    activeMavenProfiles: [] as string[],
    inactiveMavenProfiles: [] as string[],
    javaFormatterProfile: undefined as { path: string; profileName: string } | undefined,
    languageSession,
    documentSync,
    javaIntelligence,
    applySemanticWorkspaceEdit: vi.fn(async () => true),
    openSemanticDocument: vi.fn(async (path: string, isCurrent: () => boolean) => {
      if (!isCurrent()) return false;
      editor.contents[path] = "class Use { Main main; }";
      return true;
    }),
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
      applySemanticWorkspaceEdit: harness.applySemanticWorkspaceEdit,
      openSemanticDocument: harness.openSemanticDocument,
      workspaceInfo: workspace,
      workspaceGeneration: 0,
      getEditorState: () => harness.editor,
      readyActiveDocument: harness.readyActiveDocument,
      projectJdkHome: harness.projectJdkHome,
      serverJdkHome: harness.serverJdkHome,
      gradleImportEnabled: harness.gradleImportEnabled,
      gradle: harness.gradle,
      projectPath: harness.projectPath,
      mavenRepository: harness.mavenRepository,
      activeMavenProfiles: harness.activeMavenProfiles,
      inactiveMavenProfiles: harness.inactiveMavenProfiles,
      javaFormatterProfile: harness.javaFormatterProfile,
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
  it("opens Java buffers that were already open when the language service starts", async () => {
    const stopped = {
      ...readyStatus(2),
      state: "stopped" as const,
      capabilities: { ...readyStatus(2).capabilities, documentSync: false, diagnostics: false },
    };
    const harness = createHarness(stopped);
    const source = 'class Main { String greet() { return "hello"; } }';
    harness.setReady("src/Main.java", source);
    const controller = renderController(harness);
    await attachAndLoad(controller);

    await act(() => controller.result.current.start());

    expect(harness.languageSession.start).toHaveBeenCalledOnce();
    expect(harness.documentSync.didOpen).toHaveBeenCalledWith({
      document: expect.objectContaining({
        path: "src/Main.java",
        languageId: "java",
        text: source,
        version: 1,
      }),
    });
    expect(controller.result.current.javaSemantics?.context?.document.path).toBe("src/Main.java");
  });

  it("starts an existing provider with the selected project JDK before opening a draft", async () => {
    const harness = createHarness();
    harness.projectJdkHome = "/jdk-25";
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    expect(harness.languageSession.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        projectJdkHome: "/jdk-25",
      }),
    );
    expect(controller.result.current.status?.projectJdkHome).toBe("/jdk-25");
    expect(harness.documentSync.didOpen).toHaveBeenCalledWith({
      document: expect.objectContaining({
        text: "class Main { int draft; }",
        version: 1,
      }),
    });
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("restarts JDT LS with the selected runtime JDK and reopens unsaved buffers", async () => {
    const harness = createHarness();
    const source = "class Main { int unsaved; }";
    harness.setReady("src/Main.java", source);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", source));
    vi.mocked(harness.languageSession.start).mockClear();

    act(() => {
      harness.serverJdkHome = "/jdk-25";
      controller.rerender();
    });

    await waitFor(() => expect(harness.languageSession.start).toHaveBeenCalledOnce());
    expect(harness.languageSession.start).toHaveBeenCalledWith(
      expect.objectContaining({ serverJdkHome: "/jdk-25" }),
    );
    expect(controller.result.current.status?.serverJdkHome).toBe("/jdk-25");
    expect(harness.documentSync.didClose).toHaveBeenCalledOnce();
    expect(harness.documentSync.didOpen).toHaveBeenLastCalledWith({
      document: expect.objectContaining({ text: source, version: 1 }),
    });
  });

  it("synchronizes an explicitly replaced buffer into an already open Java document", async () => {
    const harness = createHarness();
    const original = "class Main { int draft; }";
    const restored = "class Main { int saved; }";
    harness.setReady("src/Main.java", original);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", original));

    await act(() => controller.result.current.activate("src/Main.java", restored));

    expect(harness.documentSync.didOpen).toHaveBeenCalledOnce();
    expect(harness.documentSync.didChange).toHaveBeenCalledWith({
      document: expect.objectContaining({
        path: "src/Main.java",
        text: restored,
        version: 2,
      }),
    });
  });

  it("restarts JDT LS when Gradle import is authorized and reopens unsaved buffers", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );

    act(() => {
      harness.gradleImportEnabled = true;
      controller.rerender();
    });
    await waitFor(() => expect(harness.languageSession.start).toHaveBeenCalledOnce());

    expect(harness.languageSession.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        gradleImportEnabled: true,
      }),
    );
    expect(controller.result.current.status?.gradleImportEnabled).toBe(true);
    expect(harness.documentSync.didClose).toHaveBeenCalledOnce();
    expect(harness.documentSync.didOpen).toHaveBeenLastCalledWith({
      document: expect.objectContaining({
        text: "class Main { int draft; }",
        version: 1,
      }),
    });
  });

  it("clears Gradle settings retained by a session after the controller remounts", async () => {
    const previousSessionStatus = readyStatus();
    previousSessionStatus.gradleSettingsConfigured = true;
    const harness = createHarness(previousSessionStatus);
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);

    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));

    expect(harness.languageSession.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        gradleImportEnabled: false,
      }),
    );
    expect(vi.mocked(harness.languageSession.start).mock.calls[0]?.[0]).not.toHaveProperty(
      "gradle",
    );
    expect(controller.result.current.status?.gradleSettingsConfigured).toBe(false);
  });

  it("restarts JDT LS and forwards selected Gradle settings when they change", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await attachAndLoad(controller);
    vi.mocked(harness.languageSession.start).mockClear();

    const gradle = {
      executable: "/tools/gradle/bin/gradle",
      userHome: "/cache/gradle",
      gradleRuntimeHome: "/opt/jdks/temurin-21",
      projectProperties: { release: "25", feature: "classfile" },
    };
    act(() => {
      harness.gradle = gradle;
      controller.rerender();
    });

    await waitFor(() => expect(harness.languageSession.start).toHaveBeenCalledOnce());
    expect(harness.languageSession.start).toHaveBeenCalledWith(expect.objectContaining({ gradle }));
  });

  it("restarts JDT LS when Maven profiles change and reopens unsaved buffers", async () => {
    const harness = createHarness();
    harness.projectPath = "services/api";
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    await waitFor(() => expect(controller.result.current.status?.projectPath).toBe("services/api"));
    vi.mocked(harness.languageSession.start).mockClear();

    act(() => {
      harness.activeMavenProfiles = ["alternate"];
      harness.inactiveMavenProfiles = ["legacy"];
      harness.mavenRepository = "/repository-cache";
      controller.rerender();
    });
    await waitFor(() =>
      expect(harness.languageSession.start).toHaveBeenLastCalledWith(
        expect.objectContaining({ activeMavenProfiles: ["alternate"] }),
      ),
    );
    expect(harness.languageSession.start).toHaveBeenCalledOnce();

    expect(harness.languageSession.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        projectPath: "services/api",
        mavenRepository: "/repository-cache",
        activeMavenProfiles: ["alternate"],
        inactiveMavenProfiles: ["legacy"],
      }),
    );
    expect(controller.result.current.status).toMatchObject({
      projectPath: "services/api",
      mavenRepository: "/repository-cache",
      activeMavenProfiles: ["alternate"],
      inactiveMavenProfiles: ["legacy"],
    });
    expect(harness.documentSync.didClose).toHaveBeenCalledOnce();
    expect(harness.documentSync.didOpen).toHaveBeenLastCalledWith({
      document: expect.objectContaining({
        text: "class Main { int draft; }",
        version: 1,
      }),
    });
  });

  it("restarts JDT LS when the Maven local repository changes", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await attachAndLoad(controller);
    vi.mocked(harness.languageSession.start).mockClear();

    act(() => {
      harness.mavenRepository = "/repository/cache";
      controller.rerender();
    });

    await waitFor(() =>
      expect(harness.languageSession.start).toHaveBeenLastCalledWith(
        expect.objectContaining({ mavenRepository: "/repository/cache" }),
      ),
    );
    expect(harness.languageSession.start).toHaveBeenCalledOnce();
    expect(controller.result.current.status).toMatchObject({
      mavenRepository: "/repository/cache",
    });
  });

  it("restarts JDT LS with an Eclipse formatter profile and reopens unsaved buffers", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    vi.mocked(harness.languageSession.start).mockClear();

    const javaFormatterProfile = { path: "config/format.xml", profileName: "Team Java" };
    act(() => {
      harness.javaFormatterProfile = javaFormatterProfile;
      controller.rerender();
    });

    await waitFor(() =>
      expect(harness.languageSession.start).toHaveBeenCalledWith(
        expect.objectContaining({ javaFormatterProfile }),
      ),
    );
    expect(controller.result.current.status).toMatchObject({ javaFormatterProfile });
    expect(harness.documentSync.didClose).toHaveBeenCalledOnce();
    expect(harness.documentSync.didOpen).toHaveBeenLastCalledWith({
      document: expect.objectContaining({
        text: "class Main { int draft; }",
        version: 1,
      }),
    });
  });

  it("retires old SDK semantics and resynchronizes the latest unsaved text after replacement", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ ...readyStatus(), projectJdkHome: "/jdk-21" });
    harness.projectJdkHome = "/jdk-21";
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    const oldSemantics = controller.result.current.javaSemantics!;
    const response = deferred<Awaited<ReturnType<JavaIntelligencePort["completion"]>>>();
    vi.mocked(harness.javaIntelligence.completion).mockReturnValueOnce(response.promise);
    const request: JavaCompletionRequest = {
      workspaceId: workspace.id,
      generation: 3,
      requestId: "old-sdk-completion",
      cancellationId: "old-sdk-completion-cancel",
      document: {
        path: "src/Main.java",
        uri: "file:///workspace/one/src/Main.java",
        version: 1,
      },
      position: { line: 0, character: 12 },
    };
    let pending!: ReturnType<typeof oldSemantics.completion>;
    await act(async () => {
      pending = oldSemantics.completion(request);
    });
    await act(async () => {
      harness.projectJdkHome = "/jdk-25";
      controller.rerender();
    });
    expect(controller.result.current.javaSemantics).toBeUndefined();
    expect(harness.documentSync.didClose).toHaveBeenCalledOnce();
    act(() => {
      harness.emit({ type: "status", status: { ...readyStatus(9), projectJdkHome: "/jdk-21" } });
      harness.setReady("src/Main.java", "class Main { int latestDraft; }");
      controller.rerender();
    });
    response.resolve({
      ok: false,
      requestId: request.requestId,
      error: { kind: "provider-error", summary: "old SDK" },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "stale-version" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(controller.result.current.status).toMatchObject({
      generation: 4,
      projectJdkHome: "/jdk-25",
    });
    expect(harness.documentSync.didOpen).toHaveBeenLastCalledWith({
      document: expect.objectContaining({
        text: "class Main { int latestDraft; }",
        version: 1,
      }),
    });
    expect(harness.editor.contents["src/Main.java"]).toBe("class Main { int latestDraft; }");
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("does not apply a delayed JDK change after detaching its workspace", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ ...readyStatus(), projectJdkHome: "/jdk-21" });
    harness.projectJdkHome = "/jdk-21";
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    act(() => {
      harness.projectJdkHome = "/jdk-25";
      controller.rerender();
    });
    await act(() => controller.result.current.detach(1));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(harness.languageSession.start).not.toHaveBeenCalled();
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("lets an explicit JDT LS restart supersede the pending settings restart", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ ...readyStatus(), projectJdkHome: "/jdk-21" });
    harness.projectJdkHome = "/jdk-21";
    const controller = renderController(harness);
    await attachAndLoad(controller);
    act(() => {
      harness.projectJdkHome = "/jdk-25";
      controller.rerender();
    });

    await act(() => controller.result.current.restart());
    await act(() => vi.advanceTimersByTimeAsync(400));

    expect(harness.languageSession.restart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ projectJdkHome: "/jdk-25" }),
    );
    expect(harness.languageSession.start).not.toHaveBeenCalled();
    expect(controller.result.current.status?.projectJdkHome).toBe("/jdk-25");
  });

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

  it("opens the latest editor text after a pending language session startup", async () => {
    const path = "src/Main.java";
    const original = "class Main {}";
    const draft = "class Main { int draft; }";
    const harness = createHarness();
    harness.setReady(path, original);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    const pendingStatus = deferred<LanguageServiceStatus>();
    vi.mocked(harness.languageSession.getStatus).mockReturnValueOnce(pendingStatus.promise);

    await act(async () => {
      const opening = controller.result.current.activate(path, original);
      harness.setReady(path, draft);
      controller.result.current.queueChange(path, draft);
      pendingStatus.resolve(readyStatus());
      await opening;
    });

    expect(harness.documentSync.didOpen).toHaveBeenCalledExactlyOnceWith({
      document: expect.objectContaining({ path, text: draft, version: 1 }),
    });
  });

  it("synchronizes a replaced buffer after a pending document open", async () => {
    const path = "src/Main.java";
    const draft = "class Main { int draft; }";
    const disk = "class Main {}";
    const harness = createHarness();
    harness.setReady(path, draft);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    const acknowledgement = deferred<void>();
    vi.mocked(harness.documentSync.didOpen).mockReturnValueOnce(acknowledgement.promise);
    let opening!: Promise<void>;

    await act(async () => { opening = controller.result.current.activate(path, draft); });
    expect(harness.documentSync.didOpen).toHaveBeenCalledOnce();
    await act(async () => {
      harness.setReady(path, disk);
      const synchronizing = controller.result.current.synchronizeEditorDocument(path);
      acknowledgement.resolve(undefined);
      await Promise.all([opening, synchronizing]);
    });

    expect(harness.documentSync.didOpen).toHaveBeenCalledOnce();
    expect(harness.documentSync.didChange).toHaveBeenCalledExactlyOnceWith({
      document: expect.objectContaining({ path, text: disk, version: 2 }),
    });
  });

  it.each(["first session status", "start from stopped"] as const)(
    "joins the pending Java document open after %s",
    async (transition) => {
      const path = "src/Main.java";
      const original = "class Main {}";
      const edited = "class Main { int count; }";
      const harness = createHarness(
        transition === "first session status" ? readyStatus() : { ...readyStatus(), state: "stopped" },
      );
      harness.setReady(path, original);
      const controller = renderController(harness);
      if (transition === "first session status") {
        act(() => controller.result.current.attach(workspace, 0));
      } else {
        await attachAndLoad(controller);
      }
      const acknowledgement = deferred<void>();
      vi.mocked(harness.documentSync.didOpen).mockReturnValueOnce(acknowledgement.promise);
      let opening!: Promise<void>;

      await act(async () => { opening = controller.result.current.activate(path, original); });
      expect(harness.documentSync.didOpen).toHaveBeenCalledOnce();
      await act(async () => {
        harness.setReady(path, edited);
        controller.result.current.queueChange(path, edited);
        const activating = controller.result.current.activate(path, edited);
        await Promise.resolve();
        acknowledgement.resolve(undefined);
        await Promise.all([opening, activating]);
        await controller.result.current.flush(path);
      });

      expect(harness.documentSync.didOpen).toHaveBeenCalledOnce();
      expect(harness.documentSync.didChange).toHaveBeenCalledExactlyOnceWith({
        document: expect.objectContaining({ path, text: edited, version: 2 }),
      });
      expect(harness.documentSync.didClose).not.toHaveBeenCalled();
    },
  );

  it("keeps an opening document when the same stopped generation is reported again", async () => {
    const path = "src/Main.java";
    const text = "class Main {}";
    const stopped = { ...readyStatus(), state: "stopped" as const };
    const harness = createHarness(stopped);
    harness.setReady(path, text);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    const pendingStart = deferred<LanguageServiceStatus>();
    vi.mocked(harness.languageSession.start).mockReturnValueOnce(pendingStart.promise);
    let opening!: Promise<void>;
    await act(async () => { opening = controller.result.current.activate(path, text); });
    expect(harness.languageSession.start).toHaveBeenCalledOnce();
    await act(() => controller.result.current.load());
    await act(async () => {
      pendingStart.resolve(readyStatus(stopped.generation + 1));
      await opening;
    });
    expect(harness.documentSync.didOpen).toHaveBeenCalledExactlyOnceWith({
      document: expect.objectContaining({ path, text, version: 1 }),
    });
  });

  it("guards status generations and publishes only current exact-document diagnostics", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    await act(async () => {
      harness.setReady("src/Main.java", "class Main { int value; }");
      controller.result.current.queueChange("src/Main.java", harness.editor.contents["src/Main.java"]);
      await controller.result.current.flush("src/Main.java");
    });

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

  it("retires diagnostics on an optimistic edit and rejects late or future versions", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    const event = (version: number, message: string): LanguageServiceEvent => ({
      type: "diagnostics", workspaceId: workspace.id, generation: 3, provider: "jdt-ls",
      document: { workspaceId: workspace.id, path: "src/Main.java", uri: "file:///workspace/one/src/Main.java", version },
      diagnostics: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } }, severity: "error", message }],
    });
    act(() => harness.emit(event(1, "old draft")));
    expect(controller.result.current.problemItems).toHaveLength(1);
    act(() => {
      harness.setReady("src/Main.java", "class Main { int repaired; }");
      controller.result.current.queueChange("src/Main.java", harness.editor.contents["src/Main.java"]);
    });
    expect(controller.result.current.problemItems).toEqual([]);
    act(() => { harness.emit(event(1, "late old draft")); harness.emit(event(99, "future draft")); });
    expect(controller.result.current.activeDiagnostics).toEqual([]);
    expect(controller.result.current.problemItems).toEqual([]);
    await act(() => controller.result.current.flush("src/Main.java"));
    act(() => harness.emit(event(2, "current draft")));
    expect(controller.result.current.problemItems[0].message).toBe("current draft");
    act(() => harness.emit({ ...event(2, ""), diagnostics: [] } as LanguageServiceEvent));
    expect(controller.result.current.problemItems).toEqual([]);
  });

  it("keeps diagnostic unavailability bound to the current document version and refreshes without saving", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    const event: LanguageServiceEvent = {
      type: "diagnostics", workspaceId: workspace.id, generation: 3, provider: "jdt-ls",
      document: { workspaceId: workspace.id, path: "src/Main.java", uri: "file:///workspace/one/src/Main.java", version: 1 },
      diagnostics: [], unavailableReason: "Java 26 preview requires a compatible compiler.",
    };
    act(() => harness.emit(event));
    expect(controller.result.current.diagnosticUnavailableMessage).toContain("Java 26 preview");
    expect(controller.result.current.problemItems).toEqual([]);
    vi.mocked(harness.documentSync.revalidate!).mockClear();
    await act(() => controller.result.current.refresh());
    expect(harness.documentSync.revalidate).toHaveBeenCalledExactlyOnceWith({ document: event.document });
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
    act(() => harness.emit({ ...event, unavailableReason: undefined }));
    expect(controller.result.current.diagnosticUnavailableMessage).toBeUndefined();
    act(() => harness.emit({ ...event, document: { ...event.document, version: 0 } }));
    expect(controller.result.current.diagnosticUnavailableMessage).toBeUndefined();
  });

  it("notifies saved configuration without saving Java drafts and reports notification failure accurately", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main { int draft; }"));
    await act(() => controller.result.current.flush(".settings/org.eclipse.jdt.core.prefs"));
    expect(harness.documentSync.didSaveWorkspaceFile).not.toHaveBeenCalled();
    await act(() => controller.result.current.notifySaved(".settings/org.eclipse.jdt.core.prefs"));
    expect(harness.documentSync.didSaveWorkspaceFile).toHaveBeenCalledExactlyOnceWith({ document: {
      workspaceId: workspace.id, path: ".settings/org.eclipse.jdt.core.prefs", uri: "file:///workspace/one/.settings/org.eclipse.jdt.core.prefs",
    } });
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
    vi.mocked(harness.documentSync.didSaveWorkspaceFile!).mockRejectedValueOnce(new Error("provider stopped"));
    await act(() => controller.result.current.notifySaved("pom.xml"));
    expect(controller.result.current.error).toContain("The file was saved, but");
    act(() => harness.emit({ type: "status", status: { ...readyStatus(3), state: "stopped" } }));
    await act(() => controller.result.current.notifySaved("pom.xml"));
    expect(harness.documentSync.didSaveWorkspaceFile).toHaveBeenCalledTimes(2);
  });

  it("validates only the newest acknowledged document after coalesced changes", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    const first = deferred<void>();
    vi.mocked(harness.documentSync.revalidate!).mockClear();
    vi.mocked(harness.documentSync.didChange).mockReturnValueOnce(first.promise);
    let flushing!: Promise<void>;
    await act(async () => {
      controller.result.current.queueChange("src/Main.java", "class Main { int first; }");
      flushing = controller.result.current.flush("src/Main.java");
    });
    expect(harness.documentSync.didChange).toHaveBeenCalledOnce();
    act(() => controller.result.current.queueChange("src/Main.java", "class Main { int newest; }"));
    await act(async () => { first.resolve(); await flushing; });
    expect(harness.documentSync.didChange).toHaveBeenCalledTimes(2);
    expect(harness.documentSync.revalidate).toHaveBeenCalledExactlyOnceWith({
      document: { workspaceId: workspace.id, path: "src/Main.java", uri: "file:///workspace/one/src/Main.java", version: 3 },
    });
  });

  it("closes an acknowledged document after diagnostic validation fails without resending its version", async () => {
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    vi.mocked(harness.documentSync.revalidate!).mockRejectedValueOnce(new Error("validation unavailable"));
    await act(async () => {
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      await expect(controller.result.current.flush("src/Main.java")).rejects.toThrow("validation unavailable");
    });
    await act(() => controller.result.current.closeDocument("src/Main.java"));
    expect(harness.documentSync.didChange).toHaveBeenCalledOnce();
    expect(harness.documentSync.didClose).toHaveBeenCalledExactlyOnceWith({
      document: expect.objectContaining({ path: "src/Main.java", version: 2 }),
    });
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

  it("flushes the current draft before requesting its document outline and rejects late symbols", async () => {
    const order: string[] = [];
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main {}");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    const response = deferred<JavaDocumentSymbolsResponse>();
    vi.mocked(harness.javaIntelligence.documentSymbols).mockImplementation(async () => {
      order.push("symbols");
      return response.promise;
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));

    act(() => {
      harness.setReady("src/Main.java", "class Main { int draft; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      requestId: "outline-request",
      cancellationId: "outline-cancel",
    };
    let resultPromise!: Promise<JavaDocumentSymbolsResponse>;
    act(() => {
      resultPromise = semantics.documentSymbols(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.documentSymbols).toHaveBeenCalledOnce());
    expect(order).toEqual(["change", "symbols"]);

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.42.0",
        symbols: [],
        isTruncated: false,
      },
    });
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { kind: "stale-version" },
    });
  });

  it("flushes the current draft before requesting symbol highlights and rejects late occurrences", async () => {
    const order: string[] = [];
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main { int value; }");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    const response = deferred<JavaDocumentHighlightsResponse>();
    vi.mocked(harness.javaIntelligence.documentHighlights).mockImplementation(async () => {
      order.push("highlights");
      return response.promise;
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", "class Main { int value; }"),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int draft; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 18 },
      requestId: "document-highlights-request",
      cancellationId: "document-highlights-cancel",
    };
    let pending!: Promise<JavaDocumentHighlightsResponse>;
    act(() => {
      pending = semantics.documentHighlights(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.documentHighlights).toHaveBeenCalledOnce());
    expect(order).toEqual(["change", "highlights"]);

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        highlights: [],
        isTruncated: false,
      },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "stale-version" } });
  });

  it("flushes the current draft before workspace reference search and rejects stale replies", async () => {
    const order: string[] = [];
    const initial = readyStatus();
    const harness = createHarness({
      ...initial,
      capabilities: { ...initial.capabilities, references: true },
    });
    harness.setReady("src/Main.java", "class Main { int value; }");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    const response = deferred<JavaReferencesResponse>();
    vi.mocked(harness.javaIntelligence.references).mockImplementation(async (request) => {
      order.push("references");
      expect(request.includeDeclaration).toBe(true);
      return response.promise;
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", "class Main { int value; }"),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int draft; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 18 },
      requestId: "java-references-request",
      cancellationId: "java-references-cancel",
      includeDeclaration: true,
    };
    let pending!: Promise<JavaReferencesResponse>;
    act(() => {
      pending = semantics.references(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.references).toHaveBeenCalledOnce());
    expect(order).toEqual(["change", "references"]);
    expect(harness.javaIntelligence.references).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        generation: 3,
        document: expect.objectContaining({ version: 2 }),
        includeDeclaration: true,
      }),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.62.0",
        locations: [],
        isTruncated: false,
      },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { kind: "stale-version" },
    });
  });

  it("flushes the active Java draft before JDT LS definition and rejects stale replies", async () => {
    const order: string[] = [];
    const initial = readyStatus();
    const harness = createHarness({
      ...initial,
      capabilities: { ...initial.capabilities, definition: true },
    });
    harness.setReady("src/Main.java", "class Main { int value; }");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    const response = deferred<JavaDefinitionsResponse>();
    vi.mocked(harness.javaIntelligence.definitions!).mockImplementation(async (_request) => {
      order.push("definition");
      return response.promise;
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", "class Main { int value; }"),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int draft; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 18 },
      requestId: "java-definitions-request",
      cancellationId: "java-definitions-cancel",
    };
    let pending!: Promise<JavaDefinitionsResponse>;
    act(() => {
      pending = semantics.definitions!(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.definitions).toHaveBeenCalledOnce());
    expect(order).toEqual(["change", "definition"]);
    expect(harness.javaIntelligence.definitions).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        generation: 3,
        document: expect.objectContaining({ version: 2 }),
        position: request.position,
      }),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.62.0",
        locations: [],
        isTruncated: false,
      },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { kind: "stale-version" },
    });
  });

  it("flushes the active Java draft before requesting semantic tokens", async () => {
    const order: string[] = [];
    const initial = readyStatus();
    const harness = createHarness({
      ...initial,
      capabilities: { ...initial.capabilities, semanticTokens: true },
    });
    harness.setReady("src/Main.java", "class Main {}");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    vi.mocked(harness.javaIntelligence.semanticTokens).mockImplementation(async (request) => {
      order.push("tokens");
      return {
        ok: true,
        requestId: request.requestId,
        result: {
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          provider: "jdt-ls",
          providerVersion: "1.61.0",
          tokens: [],
          isTruncated: false,
        },
      };
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", "class Main {}"));
    act(() => {
      harness.setReady("src/Main.java", "class Main { int draft; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    let pending!: Promise<JavaSemanticTokensResponse>;
    act(() => {
      pending = controller.result.current.javaSemantics!.semanticTokens({
        ...controller.result.current.javaSemantics!.context!,
        document: { ...controller.result.current.javaSemantics!.context!.document },
        requestId: "semantic-tokens-request",
        cancellationId: "semantic-tokens-cancel",
      });
    });
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(order).toEqual(["change", "tokens"]);
    expect(harness.javaIntelligence.semanticTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        generation: 3,
        document: expect.objectContaining({ version: expect.any(Number) }),
      }),
    );
  });

  it("flushes open Java drafts before workspace search and rejects results after a buffer changes", async () => {
    const order: string[] = [];
    const harness = createHarness();
    harness.setReady("src/Main.java", "class Main { int value; }");
    vi.mocked(harness.documentSync.didChange).mockImplementation(async () => {
      order.push("change");
    });
    const response = deferred<JavaWorkspaceSymbolsResponse>();
    vi.mocked(harness.javaIntelligence.workspaceSymbols).mockImplementation(async () => {
      order.push("workspace-symbols");
      return response.promise;
    });
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", "class Main { int value; }"),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int unsavedOrder; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int unsavedOrder; }");
      controller.rerender();
    });
    let pending!: Promise<JavaWorkspaceSymbolsResponse>;
    act(() => {
      pending = controller.result.current.searchWorkspaceSymbols("  unsavedOrder  ");
    });
    await waitFor(() => expect(harness.javaIntelligence.workspaceSymbols).toHaveBeenCalledOnce());
    expect(order).toEqual(["change", "workspace-symbols"]);
    expect(harness.javaIntelligence.workspaceSymbols).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace.id,
        generation: 3,
        query: "unsavedOrder",
      }),
    );

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newerOrder; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newerOrder; }");
      controller.rerender();
    });
    const request = vi.mocked(harness.javaIntelligence.workspaceSymbols).mock.calls[0]![0];
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        symbols: [],
        isTruncated: false,
      },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { kind: "stale-version" },
    });
  });

  it("cancels only the workspace-symbol request owned by its abort signal", async () => {
    const harness = createHarness();
    const firstResponse = deferred<JavaWorkspaceSymbolsResponse>();
    const secondResponse = deferred<JavaWorkspaceSymbolsResponse>();
    vi.mocked(harness.javaIntelligence.workspaceSymbols)
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const controller = renderController(harness);
    await attachAndLoad(controller);

    const firstAbort = new AbortController();
    let firstPending!: Promise<JavaWorkspaceSymbolsResponse>;
    act(() => {
      firstPending = controller.result.current.searchWorkspaceSymbols("Widget", firstAbort.signal);
    });
    await waitFor(() => expect(harness.javaIntelligence.workspaceSymbols).toHaveBeenCalledOnce());
    const firstRequest = vi.mocked(harness.javaIntelligence.workspaceSymbols).mock.calls[0]![0];

    let secondPending!: Promise<JavaWorkspaceSymbolsResponse>;
    act(() => {
      secondPending = controller.result.current.searchWorkspaceSymbols("Gadget");
    });
    await waitFor(() => expect(harness.javaIntelligence.workspaceSymbols).toHaveBeenCalledTimes(2));
    const secondRequest = vi.mocked(harness.javaIntelligence.workspaceSymbols).mock.calls[1]![0];
    expect(harness.javaIntelligence.cancel).toHaveBeenCalledTimes(1);
    expect(harness.javaIntelligence.cancel).toHaveBeenCalledWith(firstRequest.cancellationId);

    act(() => firstAbort.abort());
    expect(harness.javaIntelligence.cancel).toHaveBeenCalledTimes(1);

    firstResponse.resolve({
      ok: true,
      requestId: firstRequest.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        symbols: [],
        isTruncated: false,
      },
    });
    secondResponse.resolve({
      ok: true,
      requestId: secondRequest.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        symbols: [],
        isTruncated: false,
      },
    });
    await expect(firstPending).resolves.toMatchObject({
      ok: false,
      error: { kind: "stale-version" },
    });
    await expect(secondPending).resolves.toMatchObject({ ok: true });
  });

  it("formats the exact synchronized Java draft without saving it", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, formatting: true },
    });
    harness.setReady("src/Main.java", "class Main { int draft; }");
    vi.mocked(harness.javaIntelligence.formatDocument).mockImplementation(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: request.workspaceId,
        generation: request.generation,
        document: request.document,
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        edits: [
          {
            range: { start: { line: 0, character: 12 }, end: { line: 0, character: 16 } },
            newText: "int\n  ",
          },
        ],
      },
    }));
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    act(() => {
      harness.setReady("src/Main.java", "class Main {int draft;}");
      controller.result.current.queueChange("src/Main.java", "class Main {int draft;}");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    expect(semantics.formattingEnabled).toBe(true);
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      options: { tabSize: 2, insertSpaces: false },
      requestId: "format-document-request",
      cancellationId: "format-document-cancel",
    };

    const result = await semantics.formatDocument!(request);

    expect(harness.javaIntelligence.formatDocument).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({
      ok: true,
      requestId: request.requestId,
      result: { document: request.document, edits: [{ newText: "int\n  " }] },
    });
    expect(harness.documentSync.didChange).toHaveBeenCalledWith({
      document: expect.objectContaining({ text: "class Main {int draft;}" }),
    });
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("flushes the typed buffer and refuses on-type formatting after capability withdrawal", async () => {
    const status = { ...readyStatus(), capabilities: { ...readyStatus().capabilities, onTypeFormattingTriggers: [";"] } };
    const harness = createHarness(status);
    harness.setReady("src/Main.java", "class Main {int typed=1;}");
    const response = deferred<JavaFormattingResponse>();
    harness.javaIntelligence.formatOnType = vi.fn(() => response.promise);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]));
    const semantics = controller.result.current.javaSemantics!;
    expect(semantics.documentText).toBe("class Main {int typed=1;}");
    const request = { ...semantics.context!, document: { ...semantics.context!.document },
      position: { line: 0, character: 24 }, character: ";", options: { tabSize: 4, insertSpaces: true },
      requestId: "typed-format", cancellationId: "typed-format-cancel" };
    const pending = semantics.formatOnType!(request);
    await waitFor(() => expect(harness.javaIntelligence.formatOnType).toHaveBeenCalledWith(request));
    act(() => harness.emit({ type: "status", status: { ...status, capabilities: { ...status.capabilities, onTypeFormattingTriggers: [] } } }));
    response.resolve({ ok: true, requestId: request.requestId, result: { workspaceId: request.workspaceId,
      generation: request.generation, document: request.document, provider: "jdtls", providerVersion: "1.61.0",
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: " " }] } });
    expect(await pending).toMatchObject({ ok: false, error: { kind: "stale-version" } });
    const refused = await controller.result.current.javaSemantics!.formatOnType!({ ...request, requestId: "after-withdraw" });
    expect(refused).toMatchObject({ ok: false });
    expect(harness.javaIntelligence.formatOnType).toHaveBeenCalledOnce();
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("discards a formatter response after its Java document changes", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, formatting: true },
    });
    harness.setReady("src/Main.java", "class Main { int draft; }");
    const response = deferred<JavaFormattingResponse>();
    vi.mocked(harness.javaIntelligence.formatDocument).mockReturnValueOnce(response.promise);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    act(() => {
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      options: { tabSize: 4, insertSpaces: true },
      requestId: "format-stale-request",
      cancellationId: "format-stale-cancel",
    };
    let pending!: Promise<JavaFormattingResponse>;
    act(() => {
      pending = semantics.formatDocument!(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.formatDocument).toHaveBeenCalledOnce());

    act(() => {
      harness.setReady("src/Main.java", "class Main { int newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { int newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdtls",
        providerVersion: "1.61.0",
        edits: [],
      },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "stale-version" } });
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("formats only the selected range in the synchronized Java draft", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, rangeFormatting: true },
    });
    harness.setReady("src/Main.java", "class Main { int draft; }");
    vi.mocked(harness.javaIntelligence.formatRange).mockImplementation(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: request.workspaceId,
        generation: request.generation,
        document: request.document,
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        edits: [
          {
            range: { start: { line: 0, character: 12 }, end: { line: 0, character: 16 } },
            newText: "int\n  ",
          },
        ],
      },
    }));
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    act(() => {
      controller.result.current.queueChange("src/Main.java", "class Main { int draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    expect(semantics.rangeFormattingEnabled).toBe(true);
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      range: {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 22 },
      },
      options: { tabSize: 2, insertSpaces: false },
      requestId: "format-range-request",
      cancellationId: "format-range-cancel",
    };

    const result = await semantics.formatRange!(request);

    expect(harness.javaIntelligence.formatRange).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({
      ok: true,
      requestId: request.requestId,
      result: { document: request.document, edits: [{ newText: "int\n  " }] },
    });
    expect(harness.documentSync.didChange).toHaveBeenCalledWith({
      document: expect.objectContaining({ text: "class Main { int draft; }" }),
    });
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
  });

  it("flushes the current draft before code actions and rejects edits from an obsolete version", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, codeActions: true },
    });
    harness.setReady("src/Main.java", "class Main { List<String> values; }");
    const response = deferred<JavaCodeActionsResponse>();
    vi.mocked(harness.javaIntelligence.codeActions).mockReturnValueOnce(response.promise);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    act(() => {
      harness.setReady("src/Main.java", "class Main { List<String> draft; }");
      controller.result.current.queueChange("src/Main.java", "class Main { List<String> draft; }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 13 },
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 17 },
      },
      diagnostics: [
        {
          range: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } },
          severity: 1 as const,
          message: "List cannot be resolved",
        },
      ],
      requestId: "quick-fix-request",
      cancellationId: "quick-fix-cancel",
    };
    let pending!: Promise<JavaCodeActionsResponse>;
    act(() => {
      pending = semantics.codeActions(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.codeActions).toHaveBeenCalledOnce());
    expect(harness.javaIntelligence.codeActions).toHaveBeenCalledWith(request);
    act(() => {
      harness.setReady("src/Main.java", "class Main { List<String> newer; }");
      controller.result.current.queueChange("src/Main.java", "class Main { List<String> newer; }");
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdtls",
        providerVersion: "1.61.0",
        actions: [],
        isTruncated: false,
      },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "stale-version" } });
  });

  it.each([
    "apply",
    "refresh-failed",
    "changed-source",
    "changed-plan",
    "cancel",
    "edit",
    "workspace",
    "late-edit",
    "wrong-version",
  ])("applies a selected closed-source quick fix only after fresh proof: %s", async (outcome) => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, codeActions: true },
    });
    const source = "class Main { Use use; }";
    harness.setReady("src/Main.java", source);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", source));
    const semantics = controller.result.current.javaSemantics!;
    const action = {
      title: "Create method in Use",
      kind: "quickfix",
      edits: [],
      documentsToOpen: ["src/Use.java"],
      editPlanSha256: "1".repeat(64),
      sourceDocuments: [{ path: "src/Use.java", contentSha256: "2".repeat(64) }],
    };
    const request: JavaCodeActionApplyRequest = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 13 },
      range: { start: { line: 0, character: 13 }, end: { line: 0, character: 16 } },
      diagnostics: [],
      requestId: "closed-action",
      cancellationId: "closed-action-cancel",
      action,
    };
    const meta = {
      workspaceId: workspace.id,
      generation: 3,
      document: request.document,
      provider: "jdtls" as const,
      providerVersion: "1.61.0",
      isTruncated: false,
    };
    vi.mocked(harness.javaIntelligence.codeActions).mockResolvedValueOnce({
      ok: true,
      requestId: request.requestId,
      result: { ...meta, actions: [action] },
    });
    await act(async () => {
      await semantics.codeActions(request);
    });
    expect(harness.openSemanticDocument).not.toHaveBeenCalled();
    expect(harness.applySemanticWorkspaceEdit).not.toHaveBeenCalled();
    const fresh: JavaCodeActionsResponse = {
      ok: true,
      requestId: request.requestId,
      result: {
        ...meta,
        actions: [
          {
            title: action.title,
            kind: action.kind,
            edits: [],
            editPlanSha256: (outcome === "changed-plan" ? "3" : "1").repeat(64),
            sourceDocuments: [
              {
                path: "src/Use.java",
                contentSha256: (outcome === "changed-source" ? "3" : "2").repeat(64),
              },
            ],
            additionalEdits: [
              {
                document: {
                  workspaceId: workspace.id,
                  path: "src/Use.java",
                  uri: "file:///workspace/one/src/Use.java",
                  version: outcome === "wrong-version" ? 2 : 1,
                },
                edit: {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "// fresh generated method\n",
                },
              },
            ],
          },
        ],
      },
    };
    const waiting = deferred<boolean>();
    const refreshing = deferred<JavaCodeActionsResponse>();
    const heldOpen = ["cancel", "edit", "workspace"].includes(outcome);
    if (heldOpen) harness.openSemanticDocument.mockReturnValueOnce(waiting.promise);
    vi.mocked(harness.javaIntelligence.codeActions).mockImplementationOnce(async () => {
      expect(harness.documentSync.didOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            path: "src/Use.java",
            text: "class Use { Main main; }",
          }),
        }),
      );
      return outcome === "late-edit" ? refreshing.promise : fresh;
    });
    if (outcome === "refresh-failed")
      vi.mocked(harness.documentSync.revalidate!).mockImplementation(async ({ document }) => {
        if (document.version > 1) throw new Error("privateFixtureSecret");
      });
    if (outcome === "apply" || outcome === "refresh-failed")
      harness.applySemanticWorkspaceEdit.mockImplementationOnce(async () => {
        harness.editor.contents["src/Use.java"] = "class Use { void added() {} }";
        return true;
      });
    let applying!: Promise<boolean>;
    await act(async () => {
      applying = semantics.applyCodeAction!(request);
    });
    if (heldOpen) {
      await waitFor(() => expect(harness.openSemanticDocument).toHaveBeenCalledOnce());
      if (outcome === "cancel") semantics.cancel(request.cancellationId);
      if (outcome === "edit") {
        harness.setReady("src/Main.java", source + " // edited");
        await act(() =>
          controller.result.current.queueChange("src/Main.java", source + " // edited"),
        );
      }
      if (outcome === "workspace") await act(() => controller.result.current.detach(1));
      waiting.resolve(true);
    }
    if (outcome === "late-edit") {
      await waitFor(() => expect(harness.javaIntelligence.codeActions).toHaveBeenCalledTimes(2));
      harness.editor.contents["src/Use.java"] += " // typed";
      await act(() =>
        controller.result.current.queueChange(
          "src/Use.java",
          harness.editor.contents["src/Use.java"],
        ),
      );
      refreshing.resolve(fresh);
    }
    let result!: boolean;
    await act(async () => {
      result = await applying;
    });
    expect(result).toBe(outcome === "apply" || outcome === "refresh-failed");
    if (result)
      expect(harness.applySemanticWorkspaceEdit).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            document: expect.objectContaining({ path: "src/Use.java", version: 1 }),
          }),
        ],
        expect.any(Map),
      );
    else expect(harness.applySemanticWorkspaceEdit).not.toHaveBeenCalled();
    if (outcome === "apply") {
      await act(() => controller.result.current.flush("src/Use.java"));
      expect(harness.documentSync.didChange).toHaveBeenCalledWith({
        document: expect.objectContaining({
          path: "src/Use.java",
          text: "class Use { void added() {} }",
          version: 2,
        }),
      });
      expect(harness.documentSync.revalidate).toHaveBeenCalledWith({
        document: expect.objectContaining({ path: "src/Main.java", version: 1 }),
      });
      expect(harness.documentSync.revalidate).toHaveBeenCalledWith({
        document: expect.objectContaining({ path: "src/Use.java", version: 2 }),
      });
      expect(vi.mocked(harness.documentSync.didChange).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(harness.documentSync.revalidate!).mock.invocationCallOrder.at(-1)!,
      );
    }
    if (outcome === "refresh-failed") {
      expect(controller.result.current.error).toContain("draft edits were applied");
      expect(controller.result.current.error).not.toContain("privateFixtureSecret");
      expect(harness.editor.contents["src/Use.java"]).toBe("class Use { void added() {} }");
      expect(harness.applySemanticWorkspaceEdit).toHaveBeenCalledOnce();
    }
    expect(harness.documentSync.didSave).not.toHaveBeenCalled();
    expect(harness.editor.activeFilePath).toBe("src/Main.java");
  });

  it("flushes before semantic rename and refuses a reply after the document changes", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, rename: true },
    });
    harness.setReady("src/Main.java", "class Main { int value; void run(){ value++; } }");
    const response = deferred<JavaRenameResponse>();
    vi.mocked(harness.javaIntelligence.rename).mockReturnValueOnce(response.promise);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() =>
      controller.result.current.activate("src/Main.java", harness.editor.contents["src/Main.java"]),
    );
    const companionDraft = "class Use { Main value; }";
    act(() => harness.setReady("src/Use.java", companionDraft));
    await act(() => controller.result.current.activate("src/Use.java", companionDraft));
    act(() => {
      controller.result.current.queueChange("src/Use.java", "class Use { Main renamed; }");
      harness.setReady("src/Use.java", "class Use { Main renamed; }");
      harness.setReady("src/Main.java", "class Main { int value; void run(){ value++; } }");
      controller.rerender();
    });
    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 17 },
      newName: "renamedValue",
      requestId: "rename-request",
      cancellationId: "rename-cancel",
    };
    let pending!: Promise<JavaRenameResponse>;
    act(() => {
      pending = semantics.rename!(request);
    });
    await waitFor(() => expect(harness.javaIntelligence.rename).toHaveBeenCalledOnce());
    expect(harness.javaIntelligence.rename).toHaveBeenCalledWith(request);
    expect(harness.documentSync.didChange).toHaveBeenCalledWith({
      document: expect.objectContaining({
        path: "src/Use.java",
        text: "class Use { Main renamed; }",
        version: 2,
      }),
    });

    act(() => {
      harness.setReady(
        "src/Main.java",
        "class Main { int newerValue; void run(){ newerValue++; } }",
      );
      controller.result.current.queueChange(
        "src/Main.java",
        "class Main { int newerValue; void run(){ newerValue++; } }",
      );
      controller.rerender();
    });
    response.resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        documentEdits: [],
      },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "stale-version" } });
    expect(harness.applySemanticWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("commits a current semantic rename through the editor transaction callback", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, rename: true },
    });
    const source = "class Main { int value; void run(){ value++; } }";
    harness.setReady("src/Main.java", source);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", source));

    const semantics = controller.result.current.javaSemantics!;
    const request = {
      ...semantics.context!,
      document: { ...semantics.context!.document },
      position: { line: 0, character: 17 },
      newName: "renamedValue",
      requestId: "rename-commit-request",
      cancellationId: "rename-commit-cancel",
    };
    vi.mocked(harness.javaIntelligence.rename).mockResolvedValueOnce({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: workspace.id,
        generation: 3,
        document: request.document,
        provider: "jdtls",
        providerVersion: "1.61.0",
        documentEdits: [
          {
            document: request.document,
            edits: [
              {
                range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } },
                newText: "renamedValue",
              },
            ],
          },
        ],
      },
    });

    let response!: JavaRenameResponse;
    await act(async () => {
      response = await semantics.rename!(request);
    });

    expect(harness.applySemanticWorkspaceEdit).toHaveBeenCalledWith(
      response.ok ? response.result.documentEdits : [],
      expect.any(Map),
    );
    expect(response).toMatchObject({ ok: true, result: { appliedToEditor: true } });
  });

  it("keeps active semantic providers alive while synchronizing a background reference", async () => {
    const harness = createHarness({
      ...readyStatus(),
      capabilities: { ...readyStatus().capabilities, rename: true },
    });
    const source = "class Main { int value; }";
    harness.setReady("src/Main.java", source);
    const controller = renderController(harness);
    await attachAndLoad(controller);
    await act(() => controller.result.current.activate("src/Main.java", source));
    const previous = controller.result.current.javaSemantics;
    harness.editor.contents["src/Use.java"] = "class Use { Main main; }";
    await act(() =>
      controller.result.current.activate("src/Use.java", harness.editor.contents["src/Use.java"]),
    );
    expect(controller.result.current.javaSemantics).toBe(previous);
    harness.setReady("src/Main.java", source + " // edited");
    await act(() => controller.result.current.queueChange("src/Main.java", source + " // edited"));
    controller.rerender();
    expect(controller.result.current.javaSemantics).not.toBe(previous);
  });

  it.each(["apply", "cancel", "edit", "repeat"])(
    "handles closed-file rename %s without applying the discovery response",
    async (outcome) => {
      const harness = createHarness({
        ...readyStatus(),
        capabilities: { ...readyStatus().capabilities, rename: true },
      });
      const source = "class Main { int value; }";
      harness.setReady("src/Main.java", source);
      const controller = renderController(harness);
      await attachAndLoad(controller);
      await act(() => controller.result.current.activate("src/Main.java", source));
      const semantics = controller.result.current.javaSemantics!;
      const request = {
        ...semantics.context!,
        document: { ...semantics.context!.document },
        position: { line: 0, character: 17 },
        newName: "renamedValue",
        requestId: "closed-rename",
        cancellationId: "closed-rename-cancel",
      };
      const meta = {
        workspaceId: workspace.id,
        generation: 3,
        document: request.document,
        provider: "jdtls" as const,
        providerVersion: "1.61.0",
      };
      const discovery: JavaRenameResponse = {
        ok: true,
        requestId: request.requestId,
        result: { ...meta, documentEdits: [], documentsToOpen: ["src/Use.java"] },
      };
      vi.mocked(harness.javaIntelligence.rename).mockResolvedValueOnce(discovery);
      vi.mocked(harness.javaIntelligence.rename).mockImplementationOnce(async () => {
        expect(harness.documentSync.didOpen).toHaveBeenCalledWith(
          expect.objectContaining({
            document: expect.objectContaining({
              path: "src/Use.java",
              text: "class Use { Main main; }",
            }),
          }),
        );
        if (outcome === "repeat") return discovery;
        return {
          ok: true,
          requestId: request.requestId,
          result: {
            ...meta,
            documentEdits: [
              {
                document: request.document,
                edits: [
                  {
                    range: { start: { line: 0, character: 17 }, end: { line: 0, character: 22 } },
                    newText: "renamedValue",
                  },
                ],
              },
              {
                document: {
                  path: "src/Use.java",
                  uri: "file:///workspace/one/src/Use.java",
                  version: 1,
                },
                edits: [
                  {
                    range: { start: { line: 0, character: 12 }, end: { line: 0, character: 16 } },
                    newText: "Renamed",
                  },
                ],
              },
            ],
          },
        };
      });
      const pending = deferred<boolean>();
      if (outcome === "cancel" || outcome === "edit")
        harness.openSemanticDocument.mockReturnValueOnce(pending.promise);
      let result!: JavaRenameResponse;
      let running!: Promise<JavaRenameResponse>;
      await act(async () => {
        running = semantics.rename!(request);
      });
      if (outcome === "cancel" || outcome === "edit") {
        await waitFor(() => expect(harness.openSemanticDocument).toHaveBeenCalledOnce());
        if (outcome === "cancel") semantics.cancel!(request.cancellationId);
        else {
          harness.setReady("src/Main.java", source + " // edited");
          await act(() =>
            controller.result.current.queueChange("src/Main.java", source + " // edited"),
          );
        }
        pending.resolve(true);
      }
      await act(async () => {
        result = await running;
      });
      expect(harness.editor.activeFilePath).toBe("src/Main.java");
      if (outcome === "apply") {
        expect(result).toMatchObject({ ok: true, result: { appliedToEditor: true } });
        expect(harness.applySemanticWorkspaceEdit).toHaveBeenCalledOnce();
        expect(harness.applySemanticWorkspaceEdit).toHaveBeenCalledWith(
          expect.objectContaining({ length: 2 }),
          expect.any(Map),
        );
        expect(harness.javaIntelligence.rename).toHaveBeenCalledTimes(2);
      } else {
        expect(result.ok).toBe(false);
        expect(harness.applySemanticWorkspaceEdit).not.toHaveBeenCalled();
        expect(harness.javaIntelligence.rename).toHaveBeenCalledTimes(outcome === "repeat" ? 2 : 1);
      }
    },
  );

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
