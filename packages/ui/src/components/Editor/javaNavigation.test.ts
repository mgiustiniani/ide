import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { describe, expect, it, vi } from "vitest";
import type {
  JavaDefinitionsRequest,
  JavaDefinitionsResponse,
  JavaNavigationRequest,
  JavaNavigationResult,
  JavaReferencesRequest,
  JavaReferencesResponse,
  JavaReferenceLocation,
} from "@ide/contracts";
import type { JavaEditorNavigation, JavaEditorSemantics } from "./Editor";
import {
  registerJavaImplementationNavigation,
  registerJavaNavigationProviders,
} from "./javaNavigation";

const text = 'class Main { String s = "😀"; Helper helper; }';
const target = "class Helper {}";
const referenceSource = Array.from({ length: 16 }, (_, line) =>
  line === 9 ? "    Helper first;" : line === 14 ? "        Helper second;" : "",
).join("\n");
function ready(request: JavaNavigationRequest): JavaNavigationResult {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    kind: request.kind,
    documentPath: request.document.path,
    documentVersion: request.document.version,
    status: "ready",
    locations: [
      {
        path: "Helper.java",
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
      },
    ],
    sourceFiles: [{ path: "Helper.java", text: target }],
    items: [],
    returned: 1,
    total: 1,
    truncated: false,
    complete: true,
    warningCount: 0,
    snapshotHash: "a".repeat(64),
    sourceHash: "b".repeat(64),
    indexGeneration: 3,
    provider: {
      name: "RefactorKit",
      version: "0.7.0",
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
  };
}
function harness(
  withDependencySource = false,
  withDependencyDefinition = false,
  withImplementations = false,
  withDefinitionFallback = false,
  withReferencesFallback = false,
) {
  let version = 7;
  let current: JavaEditorNavigation | undefined;
  let definition!: Monaco.languages.DefinitionProvider;
  let typeDefinition!: Monaco.languages.TypeDefinitionProvider;
  let references!: Monaco.languages.ReferenceProvider;
  let opener!: Monaco.editor.ICodeEditorOpener;
  let implementationOpener!: Monaco.editor.ICodeEditorOpener;
  let implementationProvider!: Monaco.languages.ImplementationProvider;
  let editorCreated!: (editor: Monaco.editor.ICodeEditor) => void;
  let mouseDown!: (event: Monaco.editor.IEditorMouseEvent) => void;
  const editorListenerDispose = vi.fn();
  const mouseDownDispose = vi.fn();
  const modifiedClickCancellationDispose = vi.fn();
  const disposers = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  let openerRegistrationCount = 0;
  const model = {
    uri: { toString: () => "file:///workspace/Main.java" },
    getVersionId: () => version,
    getValue: vi.fn(() => text),
    isDisposed: () => false,
  } as unknown as Monaco.editor.ITextModel;
  const previews: { text: string; uri: Monaco.Uri; dispose: ReturnType<typeof vi.fn> }[] = [];
  const createModel = vi.fn((content: string, _language: string, uri: Monaco.Uri) => {
    const dispose = vi.fn();
    previews.push({ text: content, uri, dispose });
    return {
      dispose,
      validatePosition: (position: Monaco.IPosition) => position,
    } as unknown as Monaco.editor.ITextModel;
  });
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  }
  const peek = vi.fn(async () => undefined);
  const shortcutDispose = vi.fn();
  const navigationBodyAttributes = new Map<string, string>([
    ["data-native-java-navigation-diagnostics", ""],
  ]);
  const navigationBody = {
    hasAttribute: (name: string) => navigationBodyAttributes.has(name),
    getAttribute: (name: string) => navigationBodyAttributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => navigationBodyAttributes.set(name, value),
    removeAttribute: (name: string) => navigationBodyAttributes.delete(name),
  } as unknown as HTMLElement;
  const addAction = vi.fn((_action: Monaco.editor.IActionDescriptor) => ({
    dispose: shortcutDispose,
  }));
  const editorAttributes = new Map<string, string>();
  const editorNode = {
    hasAttribute: (name: string) => editorAttributes.has(name),
    getAttribute: (name: string) => editorAttributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => editorAttributes.set(name, value),
    removeAttribute: (name: string) => editorAttributes.delete(name),
    ownerDocument: { body: navigationBody },
  } as unknown as HTMLElement;
  const editor = {
    addAction,
    trigger: peek,
    getModel: () => model,
    getPosition: () => point,
    getDomNode: () => editorNode,
    onMouseDown: (listener: (event: Monaco.editor.IEditorMouseEvent) => void) => {
      mouseDown = listener;
      return { dispose: mouseDownDispose };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const api = {
    CancellationTokenSource: class {
      token = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: vi.fn() }),
      };
      dispose = modifiedClickCancellationDispose;
    },
    KeyMod: { Shift: 1024 },
    KeyCode: { F12: 70 },
    Uri: {
      from: (parts: { scheme: string; authority: string; path: string; query: string }) => ({
        toString: () => `${parts.scheme}://${parts.authority}${parts.path}?${parts.query}`,
      }),
    },
    Range,
    editor: {
      MouseTargetType: { CONTENT_TEXT: 6 },
      createModel,
      EditorOption: { readOnly: 0, domReadOnly: 1 },
      getEditors: () => [],
      onDidCreateEditor: (listener: (editor: Monaco.editor.ICodeEditor) => void) => {
        editorCreated = listener;
        return { dispose: editorListenerDispose };
      },
      registerEditorOpener: (provider: Monaco.editor.ICodeEditorOpener) => {
        const isImplementationOpener = withImplementations && openerRegistrationCount === 0;
        openerRegistrationCount++;
        if (isImplementationOpener) implementationOpener = provider;
        else opener = provider;
        return { dispose: disposers[openerRegistrationCount + 1] };
      },
    },
    languages: {
      registerDefinitionProvider: (
        _language: string,
        provider: Monaco.languages.DefinitionProvider,
      ) => {
        definition = provider;
        return { dispose: disposers[0] };
      },
      registerTypeDefinitionProvider: (
        _language: string,
        provider: Monaco.languages.TypeDefinitionProvider,
      ) => {
        typeDefinition = provider;
        return { dispose: vi.fn() };
      },
      registerReferenceProvider: (
        _language: string,
        provider: Monaco.languages.ReferenceProvider,
      ) => {
        references = provider;
        return { dispose: disposers[1] };
      },
      registerImplementationProvider: (
        _language: string,
        provider: Monaco.languages.ImplementationProvider,
      ) => {
        implementationProvider = provider;
        return { dispose: vi.fn() };
      },
    },
  } as unknown as typeof Monaco;
  const navigation: JavaEditorNavigation = {
    context: { workspaceId: "one", generation: 2 },
    typeDefinitionAvailable: true,
    query: vi.fn(async (request) => ready(request)),
    cancel: vi.fn(),
    openLocation: vi.fn(async () => true),
    navigateToImplementation: vi.fn(async (_location, canReveal) => canReveal(true)),
    ...(withReferencesFallback
      ? { readSource: vi.fn(async (_path: string, isCurrent: () => boolean) => isCurrent() ? referenceSource : null) }
      : {}),
  };
  const navigationStatus = vi.fn();
  const semanticContext = {
    workspaceId: "one",
    generation: 2,
    document: { path: "Main.java", uri: "file:///workspace/Main.java", version: 7 },
  };
  const semantics = withImplementations || withDefinitionFallback || withReferencesFallback
    ? ({
        context: semanticContext,
        ...(withImplementations
          ? {
              implementations: vi.fn(async (request) => ({
                ok: true as const,
                requestId: request.requestId,
                result: {
                  workspaceId: request.workspaceId,
                  generation: request.generation,
                  document: { ...request.document },
                  provider: "jdt-ls",
                  providerVersion: "1.61.0",
                  locations: [
                    {
                      path: "src/HelperImpl.java",
                      range: {
                        start: { line: 3, character: 6 },
                        end: { line: 3, character: 16 },
                      },
                    },
                  ],
                  isTruncated: false,
                },
              })),
            }
          : {}),
        ...(withDefinitionFallback
          ? {
              definitions: vi.fn(async (request) => ({
                ok: true as const,
                requestId: request.requestId,
                result: {
                  workspaceId: request.workspaceId,
                  generation: request.generation,
                  document: { ...request.document },
                  provider: "jdt-ls",
                  providerVersion: "1.61.0",
                  locations: [
                    {
                      path: "src/Helper.java",
                      range: {
                        start: { line: 4, character: 2 },
                        end: { line: 4, character: 8 },
                      },
                    },
                  ],
                  isTruncated: false,
                },
              })),
            }
          : {}),
        ...(withReferencesFallback
          ? {
              references: vi.fn(async (request) => ({
                ok: true as const,
                requestId: request.requestId,
                result: {
                  workspaceId: request.workspaceId,
                  generation: request.generation,
                  document: { ...request.document },
                  provider: "jdt-ls",
                  providerVersion: "1.61.0",
                  locations: [
                    {
                      path: "src/Caller.java",
                      range: {
                        start: { line: 9, character: 4 },
                        end: { line: 9, character: 10 },
                      },
                    },
                    {
                      path: "src/OtherCaller.java",
                      range: {
                        start: { line: 14, character: 8 },
                        end: { line: 14, character: 14 },
                      },
                    },
                  ],
                  isTruncated: false,
                },
              })),
            }
          : {}),
        cancel: vi.fn(),
      } as unknown as JavaEditorSemantics)
    : undefined;
  let currentSemantics = semantics;
  const navigateJavaDefinition = vi.fn(
    async (_location: JavaReferenceLocation, isCurrent: (afterOpen: boolean) => boolean) =>
      isCurrent(false) && isCurrent(true),
  );
  const openDependencySource = vi.fn(async () => undefined);
  if (withDependencySource) navigation.openDependencySource = openDependencySource;
  const definitionTarget = {
    requestId: "",
    resourceUri: `refactorkit-java-source://${"a".repeat(64)}/external%2FLibrary.java`,
    title: "Library.java",
    content: "class Library {}",
    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
    declarationRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 16 } },
  };
  const queryDependencyDefinition = vi.fn(async (request: JavaNavigationRequest) => ({
    ...definitionTarget,
    requestId: request.requestId,
  }));
  const openDependencyDefinition = vi.fn(async () => true);
  if (withDependencyDefinition) {
    navigation.queryDependencyDefinition = queryDependencyDefinition;
    navigation.openDependencyDefinition = openDependencyDefinition;
  }
  current = navigation;
  const implementationRegistration = semantics
    ? registerJavaImplementationNavigation({
        api,
        model,
        filePath: "Main.java",
        navigation,
        getCurrentNavigation: () => current,
        getCurrentSemantics: () => currentSemantics,
      })
    : undefined;
  const navigationRegistration = registerJavaNavigationProviders({
    api,
    editor,
    model,
    filePath: "Main.java",
    navigation,
    getCurrentNavigation: () => current,
    getCurrentSemantics: () => currentSemantics,
    onNavigationStatus: navigationStatus,
    getNavigateJavaDefinition: () =>
      withDefinitionFallback || withReferencesFallback ? navigateJavaDefinition : undefined,
  });
  const registration = {
    dispose() {
      navigationRegistration.dispose();
      implementationRegistration?.dispose();
    },
  };
  const cancelListeners = new Set<() => void>();
  const tokenDispose = vi.fn();
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      cancelListeners.add(listener);
      return {
        dispose: () => {
          tokenDispose();
          cancelListeners.delete(listener);
        },
      };
    },
  } as unknown as Monaco.CancellationToken;
  const point = { lineNumber: 1, column: text.indexOf("Helper") + 1 } as Monaco.Position;
  return {
    model,
    navigation,
    navigationStatus,
    navigationHistory: () =>
      JSON.parse(navigationBodyAttributes.get("data-java-definition-result-history") ?? "[]") as {
        requestId: string;
        status: string;
        refusalCode?: string;
      }[],
    navigateJavaDefinition,
    editorNode,
    registration,
    previews,
    createModel,
    disposers,
    tokenDispose,
    point,
    token,
    definition: () => definition.provideDefinition(model, point, token),
    typeDefinition: () => typeDefinition.provideTypeDefinition(model, point, token),
    references: (includeDeclaration: boolean) =>
      references.provideReferences(model, point, { includeDeclaration }, token),
    open: (uri: Monaco.Uri, selection: Monaco.IPosition = { lineNumber: 1, column: 7 }) =>
      opener.openCodeEditor({} as Monaco.editor.ICodeEditor, uri, selection),
    cancel: () => {
      for (const listener of [...cancelListeners]) listener();
    },
    changeVersion: () => {
      version++;
    },
    changeContext: () => {
      current = { ...navigation, context: { ...navigation.context, generation: 3 } };
    },
    setNavigation(value: JavaEditorNavigation) {
      current = value;
    },
    editorCreated: (editor: Monaco.editor.ICodeEditor) => editorCreated(editor),
    modifiedClick: (event: Monaco.editor.IEditorMouseEvent) => mouseDown(event),
    modifiedClickCancellationDispose,
    mouseDownDispose,
    editorListenerDispose,
    addAction,
    peek,
    shortcutDispose,
    openDependencySource,
    queryDependencyDefinition,
    openDependencyDefinition,
    definitionTarget,
    semantics,
    implementationProvider: () => implementationProvider,
    implementationOpener: () => implementationOpener,
    setSemantics(value: JavaEditorSemantics | undefined) {
      currentSemantics = value;
    },
  };
}

describe("Monaco Java binding navigation", () => {
  it("uses refreshed callbacks for new queries and cancels pending queries through their owner", async () => {
    const h = harness();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => {
      await waiting;
      return ready(request);
    });
    const pending = h.definition();
    const replacement = {
      ...h.navigation,
      query: vi.fn(async (request: JavaNavigationRequest) => ready(request)),
      cancel: vi.fn(),
    };
    h.setNavigation(replacement);
    await h.definition();
    expect(replacement.query).toHaveBeenCalledOnce();
    h.registration.dispose();
    expect(h.navigation.cancel).toHaveBeenCalledWith(
      vi.mocked(h.navigation.query).mock.calls[0][0].requestId,
    );
    expect(replacement.cancel).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toBeNull();
  });

  it("records definition provider invocations on the editor DOM for native verification", async () => {
    const h = harness();

    await h.definition();

    expect(h.editorNode.getAttribute("data-java-definition-provider-call-count")).toBe("1");
  });

  it("renders a Kotlin definition preview in Kotlin and opens its workspace source", async () => {
    const h = harness();
    const path = "app/src/main/kotlin/example/Greeter.kt";
    const source = "object Greeter";
    const start = { line: 0, character: 7 };
    const range = { start, end: { line: 0, character: 14 } };
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      sourceFiles: [{ path, text: source }],
      locations: [{ path, range }],
    }));

    const [definition] = (await h.definition()) as Monaco.languages.Location[];
    expect(h.createModel).toHaveBeenCalledWith(source, "kotlin", definition.uri);
    expect(await h.open(definition.uri, { lineNumber: 1, column: 8 })).toBe(true);
    expect(h.navigation.openLocation).toHaveBeenCalledWith(
      vi.mocked(h.navigation.query).mock.calls[0][0].requestId,
      { path, range: { start, end: start } },
    );
  });

  it("opens the resolved Java workspace definition on a native Ctrl-click", async () => {
    const h = harness();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    h.modifiedClick({
      event: {
        leftButton: true,
        ctrlKey: true,
        metaKey: false,
        preventDefault,
        stopPropagation,
      } as unknown as Monaco.IMouseEvent,
      target: {
        type: 6,
        position: h.point,
      } as unknown as Monaco.editor.IMouseTarget,
    });

    await vi.waitFor(() => expect(h.navigation.openLocation).toHaveBeenCalledOnce());
    expect(h.navigation.query).toHaveBeenCalledWith(
      expect.objectContaining({
        document: { path: "Main.java", text, version: 7 },
        position: { line: 0, character: text.indexOf("Helper") },
        kind: "definition",
        includeDeclaration: true,
      }),
    );
    expect(h.navigation.openLocation).toHaveBeenCalledWith(
      expect.stringContaining("java-position-"),
      {
        path: "Helper.java",
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 12 },
        },
      },
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    h.registration.dispose();
    expect(h.mouseDownDispose).toHaveBeenCalledOnce();
  });

  it("opens a dependency definition on a native modified click", async () => {
    const h = harness(false, true);
    vi.mocked(h.navigation.query).mockImplementation(async (request) => ({
      ...ready(request),
      locations: [],
      sourceFiles: [],
      total: 0,
    }));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    h.modifiedClick({
      event: {
        leftButton: true,
        ctrlKey: false,
        metaKey: true,
        preventDefault,
        stopPropagation,
      } as unknown as Monaco.IMouseEvent,
      target: {
        type: 6,
        position: h.point,
      } as unknown as Monaco.editor.IMouseTarget,
    });

    await vi.waitFor(() => expect(h.openDependencyDefinition).toHaveBeenCalledOnce());
    expect(h.queryDependencyDefinition).toHaveBeenCalledOnce();
    expect(h.openDependencyDefinition).toHaveBeenCalledWith(
      expect.stringContaining("java-position-"),
      h.definitionTarget.range,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    h.registration.dispose();
  });

  it.each(["Ctrl", "Command"])("opens the guarded JDT LS fallback on %s-click", async (modifier) => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    h.modifiedClick({
      event: {
        leftButton: true, ctrlKey: modifier === "Ctrl", metaKey: modifier === "Command",
        preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as Monaco.IMouseEvent,
      target: { type: 6, position: h.point } as unknown as Monaco.editor.IMouseTarget,
    });
    await vi.waitFor(() => expect(h.modifiedClickCancellationDispose).toHaveBeenCalledOnce());
    expect(h.navigateJavaDefinition).toHaveBeenCalledExactlyOnceWith(
      { path: "src/Helper.java", range: {
        start: { line: 4, character: 2 }, end: { line: 4, character: 8 },
      } }, expect.any(Function),
    );
    expect(h.navigation.openLocation).not.toHaveBeenCalled();
    h.registration.dispose();
  });

  it.each(["source edit", "workspace switch"])("discards a late modified-click fallback after %s", async (change) => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const definitions = vi.mocked(h.semantics!.definitions!);
    const implementation = definitions.getMockImplementation()!;
    definitions.mockImplementationOnce(async (request) => {
      await waiting;
      return implementation(request);
    });
    h.modifiedClick({
      event: {
        leftButton: true, ctrlKey: true, metaKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as Monaco.IMouseEvent,
      target: { type: 6, position: h.point } as unknown as Monaco.editor.IMouseTarget,
    });
    await vi.waitFor(() => expect(definitions).toHaveBeenCalledOnce());
    if (change === "source edit") h.changeVersion();
    else h.changeContext();
    release();
    await vi.waitFor(() => expect(h.modifiedClickCancellationDispose).toHaveBeenCalledOnce());
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
    expect(h.navigation.openLocation).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(null);
    h.registration.dispose();
  });

  it("uses the exact library range only after workspace resolution has no target, with a separately owned preview model", async () => {
    const h = harness(false, true);
    vi.mocked(h.navigation.query).mockImplementation(async (r) => ({
      ...ready(r),
      locations: [],
      sourceFiles: [],
      total: 0,
    }));
    const result = (await h.definition()) as Monaco.languages.Location[];
    expect(h.queryDependencyDefinition).toHaveBeenCalledTimes(1);
    expect(result[0].range).toMatchObject({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: 14,
    });
    expect(result[0].uri.toString()).not.toBe(h.definitionTarget.resourceUri);
    expect(h.previews[0].text).toBe(h.definitionTarget.content);
    await h.open(result[0].uri);
    expect(h.openDependencyDefinition).toHaveBeenCalledWith(
      expect.stringContaining("java-position-"),
      h.definitionTarget.range,
    );
    await h.references(true);
    expect(h.queryDependencyDefinition).toHaveBeenCalledTimes(1);
    h.registration.dispose();
    expect(h.previews[0].dispose).toHaveBeenCalledTimes(1);
  });
  it("keeps workspace definitions independent of the dependency declaration provider", async () => {
    const h = harness(false, true);
    await h.definition();
    expect(h.queryDependencyDefinition).not.toHaveBeenCalled();
    h.registration.dispose();
  });
  it.each([false, true])("explains an empty JDT LS result with dependency lookup enabled=%s", async (dependencies) => {
    const h = harness(false, dependencies, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), locations: [], sourceFiles: [], returned: 0, total: 0,
    }));
    if (h.navigation.queryDependencyDefinition)
      vi.mocked(h.navigation.queryDependencyDefinition).mockResolvedValueOnce(null);
    const definitions = vi.mocked(h.semantics!.definitions!);
    const resolve = definitions.getMockImplementation()!;
    definitions.mockImplementationOnce(async (request) => {
      const response = await resolve(request);
      if (!response.ok) throw new Error("The JDT LS fixture must return a successful response.");
      return { ...response, result: { ...response.result, locations: [] } };
    });
    expect(await h.definition()).toBeNull();
    expect(h.queryDependencyDefinition).toHaveBeenCalledTimes(dependencies ? 1 : 0);
    expect(definitions).toHaveBeenCalledOnce();
    expect(h.navigationStatus).toHaveBeenLastCalledWith("JDT LS found no workspace definition.");
    expect(h.createModel).not.toHaveBeenCalled();
    h.registration.dispose();
  });
  it("reports a definition miss when neither dependency lookup nor JDT LS can supply a target", async () => {
    const h = harness(false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), locations: [], sourceFiles: [], returned: 0, total: 0,
    }));
    vi.mocked(h.navigation.queryDependencyDefinition!).mockResolvedValueOnce(null);
    expect(await h.definition()).toBeNull();
    expect(h.navigationStatus).toHaveBeenLastCalledWith("No Java definition was found.");
    expect(h.createModel).not.toHaveBeenCalled();
    h.registration.dispose();
  });
  it("shows the retired context reason before looking up a dependency or calling JDT LS", async () => {
    const h = harness(false, true, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "unavailable",
      message: "The selected Java project context has been retired.",
      projectContextRetired: true,
    }));
    expect(await h.definition()).toBeNull();
    expect(h.navigationStatus).toHaveBeenLastCalledWith("The selected Java project context has been retired.");
    expect(h.queryDependencyDefinition).not.toHaveBeenCalled();
    expect(h.semantics?.definitions).not.toHaveBeenCalled();
    expect(h.createModel).not.toHaveBeenCalled();
    h.registration.dispose();
  });
  it("opens a dependency source using the current UTF-16 cursor and rejects a retired workspace action", async () => {
    const h = harness(true);
    const action = h.addAction.mock.calls.find(
      ([item]) => item.id === "ide.java.openDependencySource",
    )![0];
    await action.run({} as Monaco.editor.ICodeEditor);
    expect(h.openDependencySource).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "one",
        generation: 2,
        document: { path: "Main.java", text, version: 7 },
        position: { line: 0, character: text.indexOf("Helper") },
      }),
    );
    h.changeContext();
    await action.run({} as Monaco.editor.ICodeEditor);
    expect(h.openDependencySource).toHaveBeenCalledTimes(1);
    h.registration.dispose();
  });
  it("binds Shift F12 to the complete reference preview rather than Monaco's compact jump", async () => {
    const h = harness();
    const action = h.addAction.mock.calls[0][0];
    expect(action.keybindings).toEqual([1024 | 70]);
    await action.run({} as Monaco.editor.ICodeEditor);
    expect(h.peek).toHaveBeenCalledOnce();
    expect(h.peek).toHaveBeenCalledWith(
      "java-navigation",
      "editor.action.referenceSearch.trigger",
      {},
    );
    h.registration.dispose();
    expect(h.shortcutDispose).toHaveBeenCalledOnce();
  });
  it("queries current Java implementations and rejects opening the result after the source changes", async () => {
    const h = harness(false, false, true);
    const locations = (await h
      .implementationProvider()
      .provideImplementation(h.model, h.point, h.token)) as Monaco.languages.Location[];
    expect(h.semantics?.implementations).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "one",
        generation: 2,
        document: { path: "Main.java", uri: "file:///workspace/Main.java", version: 7 },
        position: { line: 0, character: text.indexOf("Helper") },
      }),
    );
    expect(locations).toHaveLength(1);
    expect(locations[0]?.range).toMatchObject({
      startLineNumber: 4,
      startColumn: 7,
      endLineNumber: 4,
      endColumn: 17,
    });
    h.setSemantics({
      ...h.semantics!,
      context: {
        ...h.semantics!.context!,
        document: {
          path: "src/HelperImpl.java",
          uri: "file:///workspace/src/HelperImpl.java",
          version: 1,
        },
      },
    });
    vi.mocked(h.navigation.navigateToImplementation!).mockImplementation(
      async (_location, canReveal) => {
        h.registration.dispose();
        return canReveal(true);
      },
    );
    expect(
      await h
        .implementationOpener()
        .openCodeEditor({} as Monaco.editor.ICodeEditor, locations[0]!.uri, {
          lineNumber: 9,
          column: 11,
        }),
    ).toBe(true);
    expect(h.navigation.navigateToImplementation).toHaveBeenCalledOnce();
    expect(h.navigation.navigateToImplementation).toHaveBeenCalledWith(
      {
        path: "src/HelperImpl.java",
        range: {
          start: { line: 3, character: 6 },
          end: { line: 3, character: 16 },
        },
      },
      expect.any(Function),
    );
    h.changeVersion();
    expect(
      await h
        .implementationOpener()
        .openCodeEditor({} as Monaco.editor.ICodeEditor, locations[0]!.uri, {
          lineNumber: 4,
          column: 7,
        }),
    ).toBe(false);
    expect(h.navigation.navigateToImplementation).toHaveBeenCalledOnce();
    h.registration.dispose();
  });
  it("uses the language-service generation independently from the workspace navigation generation", async () => {
    const h = harness(false, false, true);
    h.setSemantics({
      ...h.semantics!,
      context: { ...h.semantics!.context!, generation: 19 },
    });

    const locations = (await h
      .implementationProvider()
      .provideImplementation(h.model, h.point, h.token)) as Monaco.languages.Location[];

    expect(h.semantics?.implementations).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "one", generation: 19 }),
    );
    expect(locations).toHaveLength(1);
    h.registration.dispose();
  });
  it.each(["RefactorKit", "JDT LS"])("makes owned %s preview editors read-only through public Monaco APIs", async (provider) => {
    const h = harness(false, false, false, false, provider === "JDT LS");
    if (provider === "JDT LS")
      vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
        ...ready(request), status: "refused", message: "Source analysis unavailable.",
        refusalCode: "java.context.sourceAnalysisUnqualified",
      }));
    const modelUri: { current?: Monaco.Uri } = {};
    let modelChanged!: () => void;
    const updateOptions = vi.fn();
    const changeDispose = vi.fn(),
      closeDispose = vi.fn();
    h.editorCreated({
      getModel: () => (modelUri.current ? { uri: modelUri.current } : null),
      getOption: () => false,
      updateOptions,
      onDidChangeModel: (listener: () => void) => {
        modelChanged = listener;
        return { dispose: changeDispose };
      },
      onDidDispose: () => ({ dispose: closeDispose }),
    } as unknown as Monaco.editor.ICodeEditor);
    expect(updateOptions).not.toHaveBeenCalled();
    await h.references(true);
    modelUri.current = h.previews[0].uri;
    modelChanged();
    expect(updateOptions).toHaveBeenLastCalledWith({ readOnly: true, domReadOnly: true });
    h.registration.dispose();
    expect(updateOptions).toHaveBeenLastCalledWith({ readOnly: false, domReadOnly: false });
    expect(changeDispose).toHaveBeenCalledOnce();
    expect(closeDispose).toHaveBeenCalledOnce();
    expect(h.editorListenerDispose).toHaveBeenCalledOnce();
  });
  it("preserves UTF-16 cursor columns and provides immutable source models for definition previews", async () => {
    const h = harness();
    const locations = (await h.definition()) as Monaco.languages.Location[];
    expect(h.navigation.query).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "definition",
        position: { line: 0, character: text.indexOf("Helper") },
        limit: 1,
        document: { path: "Main.java", text, version: 7 },
      }),
    );
    expect(h.previews[0].text).toBe(target);
    expect(locations[0]).toMatchObject({
      range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 13 },
    });
    expect(locations[0].uri.toString()).toMatch(/^refactorkit-java:\/\/navigation\/Helper.java\?/);
    expect(locations[0].uri.toString()).toContain(
      "workspace=one&generation=2&request=java-position-",
    );
    expect(h.model.getValue()).toBe(text);
    expect(await h.open(locations[0].uri)).toBe(true);
    expect(h.navigation.openLocation).toHaveBeenCalledWith(expect.any(String), {
      path: "Helper.java",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
      },
    });
    h.registration.dispose();
    expect(h.previews[0].dispose).toHaveBeenCalledOnce();
    expect(h.tokenDispose).toHaveBeenCalledOnce();
    for (const dispose of h.disposers.slice(0, 3)) expect(dispose).toHaveBeenCalledOnce();
  });

  it("opens the resolved type from Monaco and stops querying when type definition is unavailable", async () => {
    const h = harness();
    const locations = (await h.typeDefinition()) as Monaco.languages.Location[];
    expect(h.navigation.query).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "typeDefinition",
        position: { line: 0, character: text.indexOf("Helper") },
        limit: 1,
        document: { path: "Main.java", text, version: 7 },
      }),
    );
    expect(await h.open(locations[0].uri)).toBe(true);
    expect(h.navigation.openLocation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ path: "Helper.java" }),
    );
    h.setNavigation({ ...h.navigation, typeDefinitionAvailable: false });
    expect(await h.typeDefinition()).toBeNull();
    expect(h.navigation.query).toHaveBeenCalledOnce();
    h.registration.dispose();
  });

  it("uses the correlated JDT LS type query after the typed source-analysis refusal", async () => {
    const h = harness(false, false, false, true);
    const typeDefinitions = vi.fn(h.semantics!.definitions!);
    h.setSemantics({ ...h.semantics!, typeDefinitions });
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    const locations = await h.typeDefinition();
    expect(locations).toHaveLength(1);
    expect(typeDefinitions).toHaveBeenCalledOnce();
    expect(await h.open((locations as Monaco.languages.Location[])[0]!.uri)).toBe(true);

    h.setNavigation({ ...h.navigation, typeDefinitionAvailable: false });
    expect(await h.typeDefinition()).toHaveLength(1);
    expect(typeDefinitions).toHaveBeenCalledTimes(2);
    expect(h.navigation.query).toHaveBeenCalledOnce();
    h.registration.dispose();
  });

  it("forwards Monaco's reference declaration preference and bounds retained previews", async () => {
    const h = harness();
    await h.references(false);
    expect(h.navigation.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "references", includeDeclaration: false, limit: 1000 }),
    );
    await h.references(true);
    await h.references(true);
    expect(h.previews).toHaveLength(3);
    expect(h.previews[0].dispose).toHaveBeenCalledOnce();
    expect(await h.open(h.previews[0].uri)).toBe(false);
    expect(h.previews[1].dispose).not.toHaveBeenCalled();
    h.registration.dispose();
    expect(h.previews[1].dispose).toHaveBeenCalledOnce();
    expect(h.previews[2].dispose).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "model edit", "workspace", "dispose"])(
    "suppresses a late response after %s",
    async (change) => {
      const h = harness();
      let resolve!: () => void;
      vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => {
        await new Promise<void>((done) => {
          resolve = done;
        });
        return ready(request);
      });
      const pending = h.definition();
      if (change === "cancel") h.cancel();
      else if (change === "model edit") h.changeVersion();
      else if (change === "workspace") h.changeContext();
      else h.registration.dispose();
      resolve();
      expect(await pending).toBeNull();
      expect(h.createModel).not.toHaveBeenCalled();
      expect(h.navigation.cancel).toHaveBeenCalledWith(expect.any(String));
      expect(h.tokenDispose).toHaveBeenCalledOnce();
    },
  );

  it("cleans up partially created preview models if Monaco rejects model creation", async () => {
    const h = harness();
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => {
      const result = ready(request);
      if (result.status !== "ready") throw new Error("invalid fixture");
      return {
        ...result,
        total: 2,
        sourceFiles: [...result.sourceFiles, { path: "Other.java", text: "class Other {}" }],
        locations: [...result.locations, { ...result.locations[0], path: "Other.java" }],
      };
    });
    h.createModel
      .mockImplementationOnce((content, _language, uri) => {
        const dispose = vi.fn();
        h.previews.push({ text: content, uri, dispose });
        return { dispose } as unknown as Monaco.editor.ITextModel;
      })
      .mockImplementationOnce(() => {
        throw new Error("model creation failed");
      });
    await expect(h.references(true)).rejects.toThrow("model creation failed");
    expect(h.previews[0].dispose).toHaveBeenCalledOnce();
    expect(h.tokenDispose).toHaveBeenCalledOnce();
    expect(await h.open(h.previews[0].uri)).toBe(false);
  });

  it("shows the provider refusal reason without supplying a definition location", async () => {
    const h = harness();
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
    }));
    expect(await h.definition()).toBeNull();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(
      "Java source analysis is unavailable for this project context.",
    );
    expect(h.createModel).not.toHaveBeenCalled();
  });

  it("uses a correlated JDT LS definition when RefactorKit refuses semantic analysis", async () => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));

    const locations = await h.definition();
    expect(locations).toHaveLength(1);
    if (!Array.isArray(locations)) throw new Error("JDT LS fallback did not return a location list.");
    const fallback = locations?.[0];
    expect(fallback?.uri.toString()).toContain("ide-java-jdtls-definition://");
    expect(fallback && (await h.open(fallback.uri))).toBe(true);
    expect(h.semantics?.definitions).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "one",
        generation: 2,
        document: {
          path: "Main.java",
          uri: "file:///workspace/Main.java",
          version: 7,
        },
        position: { line: 0, character: text.indexOf("Helper") },
      }),
    );
    expect(h.navigateJavaDefinition).toHaveBeenCalledWith(
      {
        path: "src/Helper.java",
        range: {
          start: { line: 4, character: 2 },
          end: { line: 4, character: 8 },
        },
      },
      expect.any(Function),
    );
    expect(h.navigation.openLocation).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(null);
    expect(h.navigationHistory().at(-1)).toMatchObject({
      status: "refused",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
  });

  it("does not bypass an unrelated RefactorKit refusal with JDT LS", async () => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "The selected Java project context could not be validated.",
      refusalCode: "java.project.contextRejected",
    }));

    expect(await h.definition()).toBeNull();
    expect(h.semantics?.definitions).not.toHaveBeenCalled();
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(
      "The selected Java project context could not be validated.",
    );
  });

  it("does not use the JDT LS fallback after RefactorKit retires project context", async () => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "The selected Java project context has been retired.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
      projectContextRetired: true,
    }));

    expect(await h.definition()).toBeNull();
    expect(h.semantics?.definitions).not.toHaveBeenCalled();
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(
      "The selected Java project context has been retired.",
    );
  });

  it("uses correlated JDT LS references only for RefactorKit's unqualified source refusal", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));

    const locations = (await h.references(false)) as Monaco.languages.Location[];
    expect(h.semantics?.references).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "one",
        generation: 2,
        document: {
          path: "Main.java",
          uri: "file:///workspace/Main.java",
          version: 7,
        },
        position: { line: 0, character: text.indexOf("Helper") },
        includeDeclaration: false,
      }),
    );
    expect(locations).toHaveLength(2);
    expect(locations[0]?.uri.toString()).toContain("ide-java-jdtls-reference://");
    expect(await h.open(locations[1]!.uri, { lineNumber: 15, column: 9 })).toBe(true);
    expect(h.navigateJavaDefinition).toHaveBeenCalledWith(
      {
        path: "src/OtherCaller.java",
        range: {
          start: { line: 14, character: 8 },
          end: { line: 14, character: 14 },
        },
      },
      expect.any(Function),
    );
    expect(h.navigationStatus).toHaveBeenLastCalledWith(null);
    const history = JSON.parse(
      h.editorNode.getAttribute("data-java-reference-result-history") ?? "[]",
    ) as { status: string; refusalCode?: string }[];
    expect(history.at(-1)).toMatchObject({
      status: "refused",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    h.registration.dispose();
  });

  it("reports when JDT LS marks the fallback reference set as partial", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    vi.mocked(h.semantics!.references).mockImplementationOnce(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: request.workspaceId,
        generation: request.generation,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        locations: [
          {
            path: "src/Caller.java",
            range: {
              start: { line: 9, character: 4 },
              end: { line: 9, character: 10 },
            },
          },
        ],
        isTruncated: true,
      },
    }));

    expect(await h.references(true)).toHaveLength(1);
    expect(h.navigationStatus).toHaveBeenLastCalledWith(
      "JDT LS returned a partial set of Java references.",
    );
    h.registration.dispose();
  });

  it("shares one immutable preview for references in the same file and opens the selected occurrence", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    const references = vi.mocked(h.semantics!.references);
    const implementation = references.getMockImplementation()!;
    references.mockImplementationOnce(async (request) => {
      const result = await implementation(request);
      if (!result.ok) throw new Error("Invalid reference fixture");
      result.result.locations[1]!.path = result.result.locations[0]!.path;
      return result;
    });
    const locations = (await h.references(true)) as Monaco.languages.Location[];
    expect(locations[0]!.uri.toString()).toBe(locations[1]!.uri.toString());
    expect(h.createModel).toHaveBeenCalledExactlyOnceWith(referenceSource, "java", locations[0]!.uri);
    expect(h.navigation.readSource).toHaveBeenCalledTimes(1);
    expect(await h.open(locations[1]!.uri, { lineNumber: 15, column: 9 })).toBe(true);
    expect(h.navigateJavaDefinition).toHaveBeenLastCalledWith(
      { path: "src/Caller.java", range: {
        start: { line: 14, character: 8 }, end: { line: 14, character: 14 },
      } }, expect.any(Function),
    );
    h.registration.dispose();
    expect(h.previews[0]!.dispose).toHaveBeenCalledOnce();
  });

  it("rejects a reference after target text changes and preserves the current buffer", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    const locations = (await h.references(true)) as Monaco.languages.Location[];
    vi.mocked(h.navigation.readSource!).mockResolvedValue("class Changed {}");
    expect(await h.open(locations[0]!.uri, { lineNumber: 10, column: 5 })).toBe(false);
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
    expect(h.model.getValue()).toBe(text);
    h.registration.dispose();
  });

  it("does not present invented preview text when source inspection is unavailable", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    vi.mocked(h.navigation.readSource!).mockResolvedValue(null);
    expect(await h.references(true)).toBeNull();
    expect(h.createModel).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("Workspace source is unavailable"),
    );
    h.registration.dispose();
  });

  it("refuses reference ranges outside the current preview text", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    vi.mocked(h.navigation.readSource!).mockResolvedValue("class Shortened {}");
    expect(await h.references(true)).toBeNull();
    expect(h.createModel).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("reference range no longer matches"),
    );
    h.registration.dispose();
  });

  it("disposes partial JDT LS previews when model creation fails", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request), status: "refused", message: "Source analysis unavailable.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    const createModel = h.createModel.getMockImplementation()!;
    h.createModel.mockImplementationOnce(createModel).mockImplementationOnce(() => {
      throw new Error("Model creation failed");
    });
    expect(await h.references(true)).toBeNull();
    expect(h.previews[0]!.dispose).toHaveBeenCalledOnce();
    expect(await h.open(h.previews[0]!.uri)).toBe(false);
    h.registration.dispose();
    expect(h.previews[0]!.dispose).toHaveBeenCalledOnce();
  });

  it("does not use JDT LS references for unrelated or retired RefactorKit refusals", async () => {
    const refusals: { refusalCode: string; projectContextRetired?: true }[] = [
      { refusalCode: "java.project.contextRejected" },
      {
        refusalCode: "java.context.sourceAnalysisUnqualified",
        projectContextRetired: true,
      },
    ];
    for (const refusal of refusals) {
      const h = harness(false, false, false, false, true);
      vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
        ...ready(request),
        status: "refused",
        message: "The selected Java project context cannot be used.",
        ...refusal,
      }));

      expect(await h.references(true)).toBeNull();
      expect(h.semantics?.references).not.toHaveBeenCalled();
      expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
      expect(h.navigationStatus).toHaveBeenLastCalledWith(
        "The selected Java project context cannot be used.",
      );
      h.registration.dispose();
    }
  });

  it("refuses to open a JDT LS reference after its source buffer changes", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));

    const locations = (await h.references(true)) as Monaco.languages.Location[];
    h.changeVersion();
    expect(await h.open(locations[0]!.uri)).toBe(false);
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
    h.registration.dispose();
  });

  it("cancels a pending JDT LS reference fallback and discards its late response", async () => {
    const h = harness(false, false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    let resolve!: (response: JavaReferencesResponse) => void;
    let fallbackRequest: JavaReferencesRequest | null = null;
    vi.mocked(h.semantics!.references).mockImplementationOnce(
      (request) =>
        new Promise((done) => {
          fallbackRequest = request;
          resolve = done;
        }),
    );

    const pending = h.references(true);
    await vi.waitFor(() => expect(h.semantics!.references).toHaveBeenCalledOnce());
    h.cancel();
    const request = fallbackRequest as JavaReferencesRequest | null;
    if (!request) throw new Error("JDT LS reference fallback did not start.");
    resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: request.workspaceId,
        generation: request.generation,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        locations: [],
        isTruncated: false,
      },
    });

    expect(await pending).toBeNull();
    expect(h.semantics!.cancel).toHaveBeenCalledWith(request.cancellationId);
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
  });

  it("refuses to open a JDT LS fallback after the source buffer changes", async () => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));

    const locations = await h.definition();
    expect(locations).toHaveLength(1);
    if (!Array.isArray(locations)) throw new Error("JDT LS fallback did not return a location list.");
    h.changeVersion();
    expect(await h.open(locations[0]!.uri)).toBe(false);
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
  });

  it("cancels the JDT LS fallback and suppresses a late definition", async () => {
    const h = harness(false, false, false, true);
    vi.mocked(h.navigation.query).mockImplementationOnce(async (request) => ({
      ...ready(request),
      status: "refused",
      message: "Java source analysis is unavailable for this project context.",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    }));
    const definitions = vi.mocked(h.semantics!.definitions!);
    let resolve!: (response: JavaDefinitionsResponse) => void;
    let fallbackRequest: JavaDefinitionsRequest | null = null;
    definitions.mockImplementationOnce(
      (request) =>
        new Promise((done) => {
          fallbackRequest = request;
          resolve = done;
        }),
    );

    const pending = h.definition();
    await vi.waitFor(() => expect(definitions).toHaveBeenCalledOnce());
    h.cancel();
    const request = fallbackRequest as JavaDefinitionsRequest | null;
    if (!request) throw new Error("JDT LS definition fallback did not start.");
    resolve({
      ok: true,
      requestId: request.requestId,
      result: {
        workspaceId: request.workspaceId,
        generation: request.generation,
        document: { ...request.document },
        provider: "jdt-ls",
        providerVersion: "1.61.0",
        locations: [
          {
            path: "src/Helper.java",
            range: {
              start: { line: 4, character: 2 },
              end: { line: 4, character: 8 },
            },
          },
        ],
        isTruncated: false,
      },
    });

    expect(await pending).toBeNull();
    expect(h.semantics?.cancel).toHaveBeenCalledWith(request.cancellationId);
    expect(h.navigateJavaDefinition).not.toHaveBeenCalled();
    expect(h.navigationStatus).toHaveBeenLastCalledWith(null);
  });
});
