import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monacoHarness = vi.hoisted(() => ({
  shouldMount: true,
  resizeCallbacks: new Set<() => void>(),
  intersectionCallbacks: new Set<(visible: boolean) => void>(),
  layout: vi.fn(),
  focus: vi.fn(() => {
    monacoHarness.currentPosition = { lineNumber: 1, column: 1 };
  }),
  currentPosition: { lineNumber: 1, column: 1 },
  setPosition: vi.fn((position: { lineNumber: number; column: number }) => {
    monacoHarness.currentPosition = position;
    monacoHarness.cursorChangeListeners.forEach((listener) => listener({ source: "api" }));
  }),
  setSelection: vi.fn((selection: { endLineNumber: number; endColumn: number }) => {
    monacoHarness.currentPosition = {
      lineNumber: selection.endLineNumber,
      column: selection.endColumn,
    };
    monacoHarness.cursorChangeListeners.forEach((listener) => listener({ source: "api" }));
  }),
  revealPositionInCenter: vi.fn(),
  saveViewState: vi.fn(() => ({
    position: { ...monacoHarness.currentPosition },
  })),
  restoreViewState: vi.fn((state: { position: { lineNumber: number; column: number } }) => {
    monacoHarness.currentPosition = { ...state.position };
    monacoHarness.cursorChangeListeners.forEach((listener) => listener({ source: "api" }));
  }),
  validatePosition: vi.fn((position: { lineNumber: number; column: number }) => position),
  setModelMarkers: vi.fn(),
  deferModelChange: false,
  normalizeModelUri: false,
  modelChangeListeners: new Set<() => void>(),
  cursorChangeListeners: new Set<(event: { source: string }) => void>(),
  deferModelContentSync: false,
  skipControlledValueSync: false,
  rejectEditorEdits: false,
  modelContentChangeListeners: new Set<() => void>(),
  navigationRegistration: vi.fn((_request: { filePath: string; model: unknown }) => ({
    dispose: vi.fn(),
  })),
  typingRegistration: vi.fn(() => ({ dispose: vi.fn() })),
  models: new Map<
    string,
    {
      content: string;
      uri: { toString(): string };
      getValue: () => string;
      onDidChangeContent: (listener: () => void) => { dispose(): void };
      getFullModelRange: () => unknown;
      getLineCount: () => number;
      getLineMaxColumn: (line: number) => number;
      validatePosition: (position: { lineNumber: number; column: number }) => {
        lineNumber: number;
        column: number;
      };
      isDisposed: () => boolean;
      pushEditOperations?: (selections: unknown, edits: { text: string }[]) => unknown;
    }
  >(),
  activeModel: null as null | {
    content: string;
    uri: { toString(): string };
    getValue: () => string;
    onDidChangeContent: (listener: () => void) => { dispose(): void };
    getFullModelRange: () => unknown;
    getLineCount: () => number;
    getLineMaxColumn: (line: number) => number;
    validatePosition: (position: { lineNumber: number; column: number }) => {
      lineNumber: number;
      column: number;
    };
  },
}));

vi.mock("../../monaco/bootstrap", () => ({ configureLocalMonaco: vi.fn() }));
vi.mock("../Editor/javaNavigation", () => ({
  registerJavaNavigationProviders: monacoHarness.navigationRegistration,
  registerJavaImplementationNavigation: vi.fn(() => ({ dispose: vi.fn() })),
}));
vi.mock("../Editor/javaSemantics", () => ({
  registerJavaSemanticProviders: vi.fn(() => ({ dispose: vi.fn() })),
  registerJavaOnTypeFormattingProvider: monacoHarness.typingRegistration,
}));
vi.mock("@monaco-editor/react", async () => {
  const ReactModule = await import("react");
  function MockMonacoEditor(props: Record<string, unknown>) {
    const path = String(props.path);
    let model = monacoHarness.models.get(path);
    if (!model) {
      model = {
        uri: {
          toString: () => (monacoHarness.normalizeModelUri ? path.replaceAll("%2F", "/") : path),
        },
        content: String(props.value ?? ""),
        getValue: () => model!.content,
        onDidChangeContent: (listener: () => void) => {
          monacoHarness.modelContentChangeListeners.add(listener);
          return { dispose: () => monacoHarness.modelContentChangeListeners.delete(listener) };
        },
        getFullModelRange: () => ({}),
        getLineCount: () => Math.max(1, model!.content.split("\n").length),
        getLineMaxColumn: (line: number) => (model!.content.split("\n")[line - 1]?.length ?? 0) + 1,
        validatePosition: monacoHarness.validatePosition,
        isDisposed: () => false,
        pushEditOperations: (_selections: unknown, edits: { text: string }[]) => {
          model!.content = edits[0]?.text ?? model!.content;
          monacoHarness.modelContentChangeListeners.forEach((listener) => listener());
        },
      };
      monacoHarness.models.set(path, model);
    }
    if (!monacoHarness.deferModelContentSync && !monacoHarness.skipControlledValueSync)
      model.content = String(props.value ?? "");
    if (!monacoHarness.deferModelChange || !monacoHarness.activeModel)
      monacoHarness.activeModel = model;
    ReactModule.useEffect(() => {
      if (monacoHarness.shouldMount) {
        (props.onMount as ((editor: unknown, api: unknown) => void) | undefined)?.(
          {
            layout: monacoHarness.layout,
            focus: monacoHarness.focus,
            setPosition: monacoHarness.setPosition,
            setSelection: monacoHarness.setSelection,
            getPosition: () => monacoHarness.currentPosition,
            saveViewState: monacoHarness.saveViewState,
            restoreViewState: monacoHarness.restoreViewState,
            revealPositionInCenter: monacoHarness.revealPositionInCenter,
            getModel: () => monacoHarness.activeModel,
            getSelections: () => [],
            executeEdits: (_source: string, edits: { text: string }[]) => {
              if (monacoHarness.rejectEditorEdits) return false;
              const model = monacoHarness.activeModel;
              if (!model || monacoHarness.deferModelContentSync) return true;
              model.content = edits[0]?.text ?? model.content;
              monacoHarness.modelContentChangeListeners.forEach((listener) => listener());
              return true;
            },
            pushUndoStop: vi.fn(),
            onDidChangeModel: (listener: () => void) => {
              monacoHarness.modelChangeListeners.add(listener);
              return { dispose: () => monacoHarness.modelChangeListeners.delete(listener) };
            },
            onDidChangeCursorPosition: (listener: (event: { source: string }) => void) => {
              monacoHarness.cursorChangeListeners.add(listener);
              return { dispose: () => monacoHarness.cursorChangeListeners.delete(listener) };
            },
            onDidScrollChange: () => ({ dispose: vi.fn() }),
          },
          {
            editor: { setModelMarkers: monacoHarness.setModelMarkers },
            languages: {
              registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
            },
            Uri: {
              parse: (uri: string) => ({
                toString: () =>
                  monacoHarness.normalizeModelUri ? uri.replaceAll("%2F", "/") : uri,
              }),
            },
          },
        );
      }
    }, []);
    return ReactModule.createElement("textarea", {
      "data-testid": "monaco-mock",
      "data-language": props.language,
      "data-read-only": String((props.options as { readOnly?: boolean }).readOnly),
      "data-keep-model": String(props.keepCurrentModel),
      "data-dom-read-only": String((props.options as { domReadOnly?: boolean }).domReadOnly),
      "data-tab-size": String((props.options as { tabSize?: number }).tabSize),
      "data-insert-spaces": String((props.options as { insertSpaces?: boolean }).insertSpaces),
      "data-format-on-type": String((props.options as { formatOnType?: boolean }).formatOnType),
      "data-path": props.path,
      value: props.value as string,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
        (props.onChange as ((value: string) => void) | undefined)?.(event.currentTarget.value),
    });
  }
  return {
    default: MockMonacoEditor,
    loader: { config: vi.fn() },
  };
});

class MockIntersectionObserver {
  private readonly callback: (visible: boolean) => void;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = (visible) =>
      callback(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    monacoHarness.intersectionCallbacks.add(this.callback);
  }
  observe(): void {}
  disconnect(): void {
    monacoHarness.intersectionCallbacks.delete(this.callback);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(): void {}
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

class MockResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    monacoHarness.resizeCallbacks.add(callback);
  }
  observe(): void {}
  disconnect(): void {
    monacoHarness.resizeCallbacks.delete(this.callback);
  }
}

vi.mocked(ResizeObserver).mockImplementation(
  (callback) =>
    new MockResizeObserver(() => callback([], {} as ResizeObserver)) as unknown as ResizeObserver,
);

import { Editor, type JavaEditorSemantics } from "../Editor/Editor";
import { getMonacoLanguage, getMonacoModelPath } from "../Editor/monacoLanguage";
import { configureLocalMonaco } from "../../monaco/bootstrap";

async function giveMonacoHostPositiveSize(width = 900, height = 600): Promise<void> {
  const host = screen.getByTestId("editor-monaco-layer");
  Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
  host.getBoundingClientRect = () => ({
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  await act(async () => {
    monacoHarness.resizeCallbacks.forEach((callback) => callback());
    await Promise.resolve();
  });
}

const baseProps = {
  content: "private source",
  language: "typescript" as const,
  onChange: vi.fn(),
  filePath: "src/private.ts",
};

function expectNoEditor(): void {
  expect(screen.queryByTestId("editor-renderer-stack")).toBeNull();
  expect(screen.queryByTestId("editor-monaco-layer")).toBeNull();
  expect(screen.queryByTestId("monaco-mock")).toBeNull();
  expect(screen.queryByTestId("native-code-editor")).toBeNull();
}

describe("Editor", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    monacoHarness.shouldMount = true;
    monacoHarness.resizeCallbacks.clear();
    monacoHarness.intersectionCallbacks.clear();
    monacoHarness.layout.mockClear();
    monacoHarness.focus.mockClear();
    monacoHarness.setPosition.mockClear();
    monacoHarness.setSelection.mockClear();
    monacoHarness.revealPositionInCenter.mockClear();
    monacoHarness.saveViewState.mockClear();
    monacoHarness.restoreViewState.mockClear();
    monacoHarness.setModelMarkers.mockClear();
    monacoHarness.currentPosition = { lineNumber: 1, column: 1 };
    monacoHarness.deferModelChange = false;
    monacoHarness.normalizeModelUri = false;
    monacoHarness.modelChangeListeners.clear();
    monacoHarness.cursorChangeListeners.clear();
    monacoHarness.deferModelContentSync = false;
    monacoHarness.skipControlledValueSync = false;
    monacoHarness.rejectEditorEdits = false;
    monacoHarness.modelContentChangeListeners.clear();
    monacoHarness.navigationRegistration.mockClear();
    monacoHarness.typingRegistration.mockClear();
    monacoHarness.models.clear();
    monacoHarness.activeModel = null;
    vi.unstubAllGlobals();
  });

  it("shows the fileless welcome without initializing any editor", () => {
    vi.mocked(configureLocalMonaco).mockClear();
    render(<Editor {...baseProps} content="" filePath="" />);
    expect(screen.getByRole("heading", { name: "No document open" })).toBeDefined();
    expectNoEditor();
    expect(configureLocalMonaco).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Monaco" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Native" })).toBeNull();
  });

  it("applies workspace indentation preferences to the active Monaco model", async () => {
    const { rerender } = render(
      <Editor
        {...baseProps}
        language="java"
        filePath="Main.java"
        workspaceEditorPreferences={{ tabSize: 4, insertSpaces: false }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    await waitFor(() => {
      expect(screen.getByTestId("monaco-mock").getAttribute("data-tab-size")).toBe("4");
      expect(screen.getByTestId("monaco-mock").getAttribute("data-insert-spaces")).toBe("false");
    });

    rerender(
      <Editor
        {...baseProps}
        language="java"
        filePath="Main.java"
        workspaceEditorPreferences={{ tabSize: 8, insertSpaces: true }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("monaco-mock").getAttribute("data-tab-size")).toBe("8");
      expect(screen.getByTestId("monaco-mock").getAttribute("data-insert-spaces")).toBe("true");
    });
  });

  it("retains typing formatting through synchronization and withdraws it with the capability", async () => {
    const semantics = { context: { workspaceId: "one", generation: 2,
      document: { path: "Main.java", uri: "file:///Main.java", version: 1 } },
      onTypeFormattingTriggers: [";"], documentText: baseProps.content } as unknown as JavaEditorSemantics;
    const props = { ...baseProps, language: "java" as const, filePath: "Main.java",
      workspaceEditorPreferences: { tabSize: 2, insertSpaces: true, formatJavaOnType: true } };
    const view = render(<Editor {...props} javaSemantics={semantics} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();
    await waitFor(() => expect(monacoHarness.typingRegistration).toHaveBeenCalledOnce());
    const registration = monacoHarness.typingRegistration.mock.results[0]!.value;
    expect(screen.getByTestId("monaco-mock").getAttribute("data-format-on-type")).toBe("true");
    view.rerender(<Editor {...props} content={`${props.content};`} javaSemantics={undefined} />);
    expect(screen.getByTestId("monaco-mock").getAttribute("data-format-on-type")).toBe("true");
    expect(registration.dispose).not.toHaveBeenCalled();
    view.rerender(<Editor {...props} javaSemantics={{ ...semantics, context: { ...semantics.context!,
      document: { ...semantics.context!.document, version: 2 } } }} />);
    expect(monacoHarness.typingRegistration).toHaveBeenCalledOnce();
    expect(registration.dispose).not.toHaveBeenCalled();
    view.rerender(<Editor {...props} javaSemantics={{ ...semantics, onTypeFormattingTriggers: [] }} />);
    expect(screen.getByTestId("monaco-mock").getAttribute("data-format-on-type")).toBe("false");
    expect(registration.dispose).toHaveBeenCalledOnce();
  });

  it("registers Java navigation only after Monaco activates the corresponding tab model", async () => {
    const javaNavigation = {
      context: { workspaceId: "one", generation: 1 },
      query: vi.fn(),
      openLocation: vi.fn(),
      cancel: vi.fn(),
    };
    const props = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      javaNavigation,
    };
    const { rerender } = render(<Editor {...props} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();
    await waitFor(() =>
      expect(monacoHarness.navigationRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: "Main.java", model: monacoHarness.activeModel }),
      ),
    );
    const first = monacoHarness.navigationRegistration.mock.results[0].value;
    monacoHarness.deferModelChange = true;
    monacoHarness.navigationRegistration.mockClear();
    rerender(<Editor {...props} filePath="Helper.java" content="class Helper {}" />);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(monacoHarness.navigationRegistration).not.toHaveBeenCalled();
    await act(async () => {
      monacoHarness.activeModel = monacoHarness.models.get(getMonacoModelPath("Helper.java"))!;
      monacoHarness.modelChangeListeners.forEach((listener) => listener());
    });
    expect(monacoHarness.navigationRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "Helper.java", model: monacoHarness.activeModel }),
    );
  });

  it("preserves the Java caret when semantic sync replaces the temporary model URI", async () => {
    const javaNavigation = {
      context: { workspaceId: "one", generation: 1 },
      query: vi.fn(),
      openLocation: vi.fn(),
      cancel: vi.fn(),
    };
    const props = {
      ...baseProps,
      language: "java" as const,
      filePath: "src/Main.java",
      content: "package example;\nclass Main {}",
      javaNavigation,
    };
    const { rerender } = render(<Editor {...props} />);
    await giveMonacoHostPositiveSize();

    await act(async () => {
      monacoHarness.setPosition({ lineNumber: 2, column: 8 });
    });
    const savedView = monacoHarness.saveViewState.mock.results.at(-1)?.value;
    expect(savedView).toEqual({ position: { lineNumber: 2, column: 8 } });

    rerender(
      <Editor
        {...props}
        javaSemantics={
          {
            context: {
              workspaceId: "one",
              generation: 1,
              document: {
                path: props.filePath,
                uri: "file:///workspace/src/Main.java",
                version: 1,
              },
            },
          } as never
        }
      />,
    );

    await waitFor(() => expect(monacoHarness.restoreViewState).toHaveBeenCalledWith(savedView));
    expect(monacoHarness.currentPosition).toEqual({ lineNumber: 2, column: 8 });
  });

  it("synchronizes accepted workspace content while Monaco rejects editor edits in read-only mode", async () => {
    const props = {
      ...baseProps,
      filePath: "Main.java",
      language: "java" as const,
      content: "class Before {}",
      readOnly: true,
    };
    const { rerender } = render(<Editor {...props} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();
    await waitFor(() => expect(monacoHarness.activeModel?.getValue()).toBe(props.content));
    monacoHarness.skipControlledValueSync = true;
    monacoHarness.rejectEditorEdits = true;
    rerender(<Editor {...props} content="class After {}" />);
    await waitFor(() => expect(monacoHarness.activeModel?.getValue()).toBe("class After {}"));
    await act(async () => {
      monacoHarness.activeModel!.content = "stale reattached model";
      monacoHarness.modelChangeListeners.forEach((listener) => listener());
    });
    expect(monacoHarness.activeModel?.getValue()).toBe("class After {}");
  });

  it("waits for the target Monaco model before applying a reveal after a file switch", async () => {
    const initial = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      content: "class Main {}",
    };
    const { rerender } = render(<Editor {...initial} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    monacoHarness.deferModelChange = true;
    rerender(
      <Editor
        {...initial}
        filePath="Helper.java"
        content="class Helper {\n  void run() {}\n}"
        revealRequest={{ filePath: "Helper.java", line: 2, column: 8, requestId: "helper" }}
      />,
    );

    expect(monacoHarness.activeModel?.uri.toString()).toBe(getMonacoModelPath("Main.java"));
    expect(monacoHarness.setPosition).not.toHaveBeenCalled();
    expect(monacoHarness.revealPositionInCenter).not.toHaveBeenCalled();

    await act(async () => {
      monacoHarness.activeModel = monacoHarness.models.get(getMonacoModelPath("Helper.java"))!;
      monacoHarness.modelChangeListeners.forEach((listener) => listener());
    });

    await waitFor(() =>
      expect(monacoHarness.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 8 }),
    );
    expect(monacoHarness.revealPositionInCenter).toHaveBeenCalledWith({
      lineNumber: 2,
      column: 8,
    });
    expect(monacoHarness.focus).toHaveBeenCalledOnce();
  });

  it("waits for target buffer synchronization before revealing and acknowledging a location", async () => {
    const initial = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      content: "class Main {}",
    };
    const { rerender } = render(<Editor {...initial} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    const helperPath = getMonacoModelPath("Helper.java");
    const helperContent = "class Helper {\n  void run() {}\n}";
    let helperModelValue = "class Helper {}";
    const helperModel = {
      content: helperModelValue,
      uri: { toString: () => helperPath },
      getValue: () => helperModelValue,
      onDidChangeContent: (listener: () => void) => {
        monacoHarness.modelContentChangeListeners.add(listener);
        return { dispose: () => monacoHarness.modelContentChangeListeners.delete(listener) };
      },
      getFullModelRange: () => ({}),
      getLineCount: () => Math.max(1, helperModelValue.split("\n").length),
      getLineMaxColumn: (line: number) => (helperModelValue.split("\n")[line - 1]?.length ?? 0) + 1,
      validatePosition: monacoHarness.validatePosition,
      isDisposed: () => false,
    };
    monacoHarness.models.set(helperPath, helperModel);
    monacoHarness.activeModel = helperModel;
    monacoHarness.deferModelChange = true;
    monacoHarness.deferModelContentSync = true;
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const onRevealHandled = vi.fn();
    rerender(
      <Editor
        {...initial}
        filePath="Helper.java"
        content={helperContent}
        revealRequest={{ filePath: "Helper.java", line: 2, column: 8, requestId: "synced" }}
        onRevealHandled={onRevealHandled}
      />,
    );

    for (let attempt = 0; attempt < 10; attempt++) {
      const callback = scheduledFrames.shift();
      if (!callback) break;
      await act(async () => callback(0));
    }
    expect(monacoHarness.setPosition).not.toHaveBeenCalled();
    expect(onRevealHandled).not.toHaveBeenCalled();

    await act(async () => {
      helperModelValue = helperContent;
      helperModel.content = helperContent;
      monacoHarness.modelContentChangeListeners.forEach((listener) => listener());
    });
    for (let attempt = 0; attempt < 30 && onRevealHandled.mock.calls.length === 0; attempt++) {
      const callback = scheduledFrames.shift();
      if (!callback) break;
      await act(async () => callback(0));
    }

    expect(monacoHarness.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 8 });
    expect(onRevealHandled).toHaveBeenCalledWith("synced");
  });

  it("applies a reveal after saved view state restoration when the target model is already attached", async () => {
    const initial = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      content: "class Main {}",
    };
    const { rerender } = render(<Editor {...initial} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    const helperPath = getMonacoModelPath("Helper.java");
    const helperContent = "class Helper {\n  void run() {}\n}";
    const helperModel = {
      content: helperContent,
      uri: { toString: () => helperPath },
      getValue: () => helperContent,
      onDidChangeContent: (listener: () => void) => {
        monacoHarness.modelContentChangeListeners.add(listener);
        return { dispose: () => monacoHarness.modelContentChangeListeners.delete(listener) };
      },
      getFullModelRange: () => ({}),
      getLineCount: () => 3,
      getLineMaxColumn: (line: number) => (helperContent.split("\n")[line - 1]?.length ?? 0) + 1,
      validatePosition: monacoHarness.validatePosition,
      isDisposed: () => false,
    };
    monacoHarness.models.set(helperPath, helperModel);
    monacoHarness.activeModel = helperModel;
    monacoHarness.deferModelChange = true;

    const scheduledReveals: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledReveals.push(callback);
      return scheduledReveals.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    rerender(
      <Editor
        {...initial}
        filePath="Helper.java"
        content={helperContent}
        revealRequest={{ filePath: "Helper.java", line: 2, column: 8, requestId: "helper-ready" }}
      />,
    );

    expect(scheduledReveals.length).toBeGreaterThan(0);
    expect(monacoHarness.setPosition).not.toHaveBeenCalled();

    // The wrapper may restore the target document's saved caret before the frame.
    monacoHarness.currentPosition = { lineNumber: 1, column: 1 };
    for (const reveal of scheduledReveals) await act(async () => reveal(0));

    expect(monacoHarness.setPosition).toHaveBeenLastCalledWith({ lineNumber: 2, column: 8 });
    expect(monacoHarness.currentPosition).toEqual({ lineNumber: 2, column: 8 });
  });

  it("applies a file-switch reveal after Monaco restores the target view state", async () => {
    const initial = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      content: "class Main {}",
    };
    const { rerender } = render(<Editor {...initial} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    const scheduledReveals: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledReveals.push(callback);
      return scheduledReveals.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    monacoHarness.deferModelChange = true;
    rerender(
      <Editor
        {...initial}
        filePath="Helper.java"
        content="class Helper {\n  void run() {}\n}"
        revealRequest={{ filePath: "Helper.java", line: 2, column: 8, requestId: "helper" }}
      />,
    );

    await act(async () => {
      monacoHarness.activeModel = monacoHarness.models.get(getMonacoModelPath("Helper.java"))!;
      monacoHarness.modelChangeListeners.forEach((listener) => listener());
      // The Monaco React wrapper restores the target file's saved caret after
      // the model-change event returns.
      monacoHarness.setPosition({ lineNumber: 1, column: 1 });
    });
    expect(monacoHarness.setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });
    expect(scheduledReveals.length).toBeGreaterThan(0);

    for (
      let attempt = 0;
      attempt < 10 &&
      !monacoHarness.setPosition.mock.calls.some(
        ([position]) => position.lineNumber === 2 && position.column === 8,
      );
      attempt++
    ) {
      const callback = scheduledReveals.shift();
      if (!callback) break;
      await act(async () => callback(0));
    }
    expect(monacoHarness.setPosition).toHaveBeenLastCalledWith({ lineNumber: 2, column: 8 });
    expect(monacoHarness.revealPositionInCenter).toHaveBeenLastCalledWith({
      lineNumber: 2,
      column: 8,
    });
    expect(monacoHarness.currentPosition).toEqual({ lineNumber: 2, column: 8 });
  });

  it("reapplies a reveal if Monaco restores the saved caret after the first successful frame", async () => {
    const initial = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      content: "class Main {\n  void run() {}\n}",
    };
    const { rerender } = render(<Editor {...initial} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameId += 1;
      scheduledFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduledFrames.delete(id));
    const onRevealHandled = vi.fn();
    rerender(
      <Editor
        {...initial}
        revealRequest={{ filePath: "Main.java", line: 2, column: 8, requestId: "late-restore" }}
        onRevealHandled={onRevealHandled}
      />,
    );

    const runNextFrame = async () => {
      const entry = scheduledFrames.entries().next().value as
        [number, FrameRequestCallback] | undefined;
      if (!entry) return false;
      scheduledFrames.delete(entry[0]);
      await act(async () => entry[1](0));
      return true;
    };
    await runNextFrame();
    expect(monacoHarness.currentPosition).toEqual({ lineNumber: 2, column: 8 });
    monacoHarness.currentPosition = { lineNumber: 1, column: 1 };
    await act(async () => {
      monacoHarness.cursorChangeListeners.forEach((listener) => listener({ source: "api" }));
    });

    for (let attempt = 0; attempt < 20 && onRevealHandled.mock.calls.length === 0; attempt++)
      if (!(await runNextFrame())) break;

    expect(monacoHarness.currentPosition).toEqual({ lineNumber: 2, column: 8 });
    expect(onRevealHandled).toHaveBeenCalledWith("late-restore");
  });

  it("retries a reveal when Monaco restores the saved caret over the first position request", async () => {
    const initial = {
      ...baseProps,
      language: "java" as const,
      filePath: "Main.java",
      content: "class Main {\n  void run() {}\n}",
    };
    const { rerender } = render(<Editor {...initial} />);
    await waitFor(() => expect(screen.getByTestId("editor-monaco-layer")).toBeDefined());
    await giveMonacoHostPositiveSize();

    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    monacoHarness.setPosition.mockImplementationOnce(() => {
      monacoHarness.currentPosition = { lineNumber: 1, column: 1 };
    });
    rerender(
      <Editor
        {...initial}
        revealRequest={{ filePath: "Main.java", line: 2, column: 8, requestId: "retry" }}
      />,
    );

    const host = screen.getByTestId("monaco-code-editor-host");
    for (
      let attempt = 0;
      attempt < 30 && host.getAttribute("data-reveal-handled-request-id") !== "retry";
      attempt++
    ) {
      const callback = scheduledFrames.shift();
      if (!callback) break;
      await act(async () => callback(0));
    }

    expect(monacoHarness.setPosition).toHaveBeenCalledTimes(2);
    expect(monacoHarness.currentPosition).toEqual({ lineNumber: 2, column: 8 });
    expect(host.getAttribute("data-reveal-handled-request-id")).toBe("retry");
    expect(host.getAttribute("data-editor-cursor-line")).toBe("2");
  });

  it("submits a trimmed valid filename with Enter", async () => {
    const onCreateNewFile = vi.fn();
    render(
      <Editor
        {...baseProps}
        content=""
        filePath=""
        onCreateNewFile={onCreateNewFile}
        createFileTargetLabel="Project root"
      />,
    );
    const input = screen.getByLabelText("Create a new file");
    fireEvent.change(input, { target: { value: "  index.ts  " } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onCreateNewFile).toHaveBeenCalledWith("index.ts"));
    expect(screen.getByText("Location: Project root")).toBeDefined();
  });

  it.each(["", ".", "..", "src/file.ts", "src\\file.ts", `bad${String.fromCharCode(1)}name`])(
    "blocks invalid filename %j",
    async (name) => {
      const onCreateNewFile = vi.fn();
      render(<Editor {...baseProps} content="" filePath="" onCreateNewFile={onCreateNewFile} />);
      const input = screen.getByLabelText("Create a new file");
      fireEvent.change(input, { target: { value: name } });
      fireEvent.submit(input.closest("form")!);
      expect(await screen.findByRole("alert")).toBeDefined();
      expect(onCreateNewFile).not.toHaveBeenCalled();
      cleanup();
    },
  );

  it("shows a neutral loading placeholder with filename, tabs, and no source or editor", () => {
    render(
      <Editor
        {...baseProps}
        isLoading
        tabs={[{ filePath: "src/private.ts", isActive: true, isDirty: false }]}
      />,
    );
    const placeholder = screen.getByTestId("editor-opening-placeholder");
    expect(placeholder.textContent).toContain("private.ts");
    expect(placeholder.textContent).toContain("Opening editor…");
    expect(placeholder.textContent).not.toContain(baseProps.content);
    expect(screen.getByRole("tablist")).toBeDefined();
    expectNoEditor();
  });

  it("keeps source out of the cold-load placeholder and replaces it when Monaco is ready", async () => {
    render(<Editor {...baseProps} />);
    const placeholder = screen.getByTestId("editor-opening-placeholder");
    expect(placeholder.textContent).not.toContain(baseProps.content);
    expect(screen.queryByTestId("native-code-editor")).toBeNull();
    await giveMonacoHostPositiveSize(840, 520);
    expect(await screen.findByTestId("monaco-mock")).toBeDefined();
    expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull();
    expect(monacoHarness.layout).toHaveBeenCalledWith({ width: 840, height: 520 });
  });

  it("requalifies the mounted Monaco view when switching and returning to an existing buffer", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Editor {...baseProps} onChange={onChange} />);
    await giveMonacoHostPositiveSize(840, 520);
    await waitFor(() => expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull());
    const mountedView = screen.getByTestId("monaco-mock");
    const firstModel = monacoHarness.models.get(getMonacoModelPath(baseProps.filePath));

    rerender(
      <Editor
        {...baseProps}
        filePath="src/MainTest.java"
        language="java"
        content="retained test buffer"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull());
    expect(screen.getByTestId("monaco-mock")).toBe(mountedView);
    expect(screen.getByTestId("editor-monaco-layer").getAttribute("aria-hidden")).toBe("false");
    expect((mountedView as HTMLTextAreaElement).value).toBe("retained test buffer");

    rerender(<Editor {...baseProps} onChange={onChange} />);
    await waitFor(() => expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull());
    expect(monacoHarness.models.get(getMonacoModelPath(baseProps.filePath))).toBe(firstModel);
    expect((mountedView as HTMLTextAreaElement).value).toBe(baseProps.content);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not declare a switched buffer ready when its new layout fails", async () => {
    const { rerender } = render(<Editor {...baseProps} />);
    await giveMonacoHostPositiveSize();
    await waitFor(() => expect(screen.queryByTestId("editor-opening-placeholder")).toBeNull());
    monacoHarness.layout.mockImplementationOnce(() => {
      throw new Error("layout refused");
    });
    rerender(<Editor {...baseProps} filePath="src/MainTest.java" content="retained buffer" />);
    expect(await screen.findByTestId("editor-failure-placeholder")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry Monaco" })).toBeDefined();
    expect(screen.queryByTestId("editor-monaco-layer")).toBeNull();
  });

  it("activates Monaco when the measurable pending host is visually transparent", async () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if ((element as HTMLElement).classList?.contains("editor-monaco-layer")) {
        return { display: "block", opacity: "0", visibility: "hidden" } as CSSStyleDeclaration;
      }
      return nativeGetComputedStyle(element);
    });

    render(<Editor {...baseProps} />);
    expect(screen.getByTestId("editor-opening-placeholder").textContent).not.toContain(
      baseProps.content,
    );
    await giveMonacoHostPositiveSize(760, 440);

    expect(await screen.findByTestId("monaco-mock")).toBeDefined();
    expect(
      screen.getByTestId("editor-monaco-layer").classList.contains("editor-monaco-layer--ready"),
    ).toBe(true);
  });

  it("does not activate Monaco inside a display-hidden ancestor", async () => {
    let ancestorHidden = true;
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if (ancestorHidden && (element as HTMLElement).classList?.contains("editor-content")) {
        return { display: "none", visibility: "visible" } as CSSStyleDeclaration;
      }
      return nativeGetComputedStyle(element);
    });

    render(<Editor {...baseProps} />);
    await giveMonacoHostPositiveSize(760, 440);
    expect(screen.queryByTestId("monaco-mock")).toBeNull();

    ancestorHidden = false;
    await act(async () => {
      monacoHarness.resizeCallbacks.forEach((callback) => callback());
      await Promise.resolve();
    });
    expect(await screen.findByTestId("monaco-mock")).toBeDefined();
  });

  it("handles a same-file loading transition with the inert placeholder", async () => {
    const { rerender } = render(<Editor {...baseProps} />);
    await giveMonacoHostPositiveSize();
    expect(await screen.findByTestId("monaco-mock")).toBeDefined();

    rerender(<Editor {...baseProps} isLoading />);
    expect(screen.getByTestId("editor-opening-placeholder").textContent).not.toContain(
      baseProps.content,
    );
    expectNoEditor();

    rerender(<Editor {...baseProps} content="new private source" />);
    expect(screen.getByTestId("editor-opening-placeholder").textContent).not.toContain(
      "new private source",
    );
    await giveMonacoHostPositiveSize(700, 400);
    expect(await screen.findByTestId("monaco-mock")).toBeDefined();
  });

  it("keeps Monaco pending while hidden and recovers on host visibility", async () => {
    vi.useFakeTimers();
    render(<Editor {...baseProps} />);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByTestId("editor-opening-placeholder")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry Monaco" })).toBeNull();
    await giveMonacoHostPositiveSize(700, 400);
    expect(screen.getByTestId("monaco-mock")).toBeDefined();
  });

  it("remeasures on visibility and focus and cleans lifecycle observers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const { unmount } = render(<Editor {...baseProps} />);
    const host = screen.getByTestId("editor-monaco-layer");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 700 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 400 });
    host.getBoundingClientRect = () => ({
      bottom: 400,
      height: 400,
      left: 0,
      right: 700,
      top: 0,
      width: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      vi.runAllTimers();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("monaco-mock")).toBeDefined();
    unmount();
    expect(monacoHarness.resizeCallbacks.size).toBe(0);
    expect(monacoHarness.intersectionCallbacks.size).toBe(0);
  });

  it("propagates Monaco edits and preserves model language mapping", async () => {
    const onChange = vi.fn();
    render(<Editor {...baseProps} onChange={onChange} />);
    await giveMonacoHostPositiveSize();
    fireEvent.change(screen.getByTestId("monaco-mock"), { target: { value: "new" } });
    expect(onChange).toHaveBeenCalledWith("new");
    expect(getMonacoModelPath("src\\Main.java")).toBe("file:///src/Main.java");
    const uri = `refactorkit-java-source://${"a".repeat(64)}/external%2FLibrary.java`;
    expect(getMonacoModelPath(uri)).toBe(uri);
    const platformUri = `refactorkit-java-platform-source://${"b".repeat(64)}/java.base%2Fjava%2Flang%2FString.java`;
    expect(getMonacoModelPath(platformUri)).toBe(platformUri);
    expect(getMonacoLanguage("java", "Main.java")).toBe("java");
    expect(getMonacoLanguage("unknown" as never, "LICENSE")).toBe("plaintext");
  });

  it("holds typing while a workspace transformation runs and enables it when the write finishes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Editor {...baseProps} readOnly onChange={onChange} />);
    await giveMonacoHostPositiveSize();
    expect(screen.getByTestId("monaco-mock").getAttribute("data-read-only")).toBe("true");
    fireEvent.change(screen.getByTestId("monaco-mock"), { target: { value: "racing edit" } });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Editor {...baseProps} readOnly={false} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("monaco-mock"), { target: { value: "after write" } });
    expect(onChange).toHaveBeenCalledWith("after write");
  });

  it("keeps the library URI and blocks editing without retaining its Monaco model after leaving the view", async () => {
    const uri = `refactorkit-java-source://${"a".repeat(64)}/external%2FLibrary.java`;
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor
        {...baseProps}
        filePath={uri}
        language="java"
        content="class Library {}"
        readOnly
        onChange={onChange}
        tabs={[{ filePath: uri, isActive: true, isDirty: false }]}
        tabLabels={{ [uri]: "Library.java (read-only)" }}
      />,
    );
    await giveMonacoHostPositiveSize();
    const library = screen.getByTestId("monaco-mock");
    expect(library.getAttribute("data-path")).toBe(uri);
    expect(library.getAttribute("data-read-only")).toBe("true");
    expect(library.getAttribute("data-dom-read-only")).toBe("true");
    expect(library.getAttribute("data-keep-model")).toBe("false");
    expect(screen.getByText("Library.java (read-only)")).toBeDefined();
    fireEvent.change(library, { target: { value: "forbidden library edit" } });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Editor {...baseProps} onChange={onChange} />);
    await waitFor(() =>
      expect(screen.getByTestId("monaco-mock").getAttribute("data-read-only")).toBe("false"),
    );
    expect(screen.getByTestId("monaco-mock").getAttribute("data-keep-model")).toBe("true");
    fireEvent.change(screen.getByTestId("monaco-mock"), { target: { value: "workspace edit" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("workspace edit");
  });

  it("opens JDK source as a separate read-only Monaco model", async () => {
    const uri = `refactorkit-java-platform-source://${"b".repeat(64)}/java.base%2Fjava%2Flang%2FString.java`;
    const onChange = vi.fn();
    const { rerender } = render(
      <Editor
        {...baseProps}
        filePath={uri}
        language="java"
        content="package java.lang; public final class String {}"
        readOnly
        onChange={onChange}
        tabs={[{ filePath: uri, isActive: true, isDirty: false }]}
        tabLabels={{ [uri]: "String.java (read-only)" }}
      />,
    );
    await giveMonacoHostPositiveSize();
    const platform = screen.getByTestId("monaco-mock");
    expect(platform.getAttribute("data-path")).toBe(uri);
    expect(platform.getAttribute("data-read-only")).toBe("true");
    expect(platform.getAttribute("data-keep-model")).toBe("false");
    expect(screen.getByText("String.java (read-only)")).toBeDefined();
    fireEvent.change(platform, { target: { value: "class Modified {}" } });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Editor {...baseProps} onChange={onChange} />);
    await waitFor(() =>
      expect(screen.getByTestId("monaco-mock").getAttribute("data-read-only")).toBe("false"),
    );
    expect(screen.getByTestId("monaco-mock").getAttribute("data-path")).toBe(
      getMonacoModelPath(baseProps.filePath),
    );
  });

  it("preserves reveal requests and diagnostic markers", async () => {
    render(
      <Editor
        {...baseProps}
        filePath="src/Main.java"
        language="java"
        content={"abc\ndef"}
        revealRequest={{ filePath: "src/Main.java", line: 2, column: 2, requestId: 1 }}
        documentIdentity={{ path: "src/Main.java" }}
        diagnosticOwner="refactorkit-java-compiler"
        diagnostics={[
          {
            severity: "error",
            message: "Broken",
            range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
          },
        ]}
      />,
    );
    await giveMonacoHostPositiveSize();
    await waitFor(() =>
      expect(monacoHarness.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 2 }),
    );
    expect(monacoHarness.revealPositionInCenter).toHaveBeenCalled();
    expect(monacoHarness.setModelMarkers).toHaveBeenCalledWith(
      monacoHarness.models.get("file:///src/Main.java"),
      "refactorkit-java-compiler",
      [expect.objectContaining({ severity: 8, startLineNumber: 1, startColumn: 2 })],
    );
  });

  it("selects the validated UTF-16 name range in a read-only library document", async () => {
    const uri = `refactorkit-java-source://${"a".repeat(64)}/Library.java`;
    render(
      <Editor
        {...baseProps}
        filePath={uri}
        readOnly
        content="class Library {}"
        revealRequest={{
          filePath: uri,
          line: 1,
          column: 7,
          requestId: "exact",
          selection: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
        }}
      />,
    );
    await giveMonacoHostPositiveSize();
    await waitFor(() =>
      expect(monacoHarness.setSelection).toHaveBeenCalledWith({
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 14,
      }),
    );
    expect(monacoHarness.setPosition).not.toHaveBeenCalled();
  });

  it("matches read-only source models after Monaco normalizes encoded path separators", async () => {
    monacoHarness.normalizeModelUri = true;
    const uri = `refactorkit-java-source://${"a".repeat(64)}/external%2FLibrary.java`;
    render(
      <Editor
        {...baseProps}
        filePath={uri}
        readOnly
        content="package external; public class Library {}"
        revealRequest={{
          filePath: uri,
          line: 1,
          column: 32,
          requestId: "normalized-source-uri",
          selection: { start: { line: 0, character: 31 }, end: { line: 0, character: 38 } },
        }}
      />,
    );
    await giveMonacoHostPositiveSize();
    await waitFor(() => expect(monacoHarness.setSelection).toHaveBeenCalledOnce());
    expect(monacoHarness.setSelection).toHaveBeenCalledWith({
      startLineNumber: 1,
      startColumn: 32,
      endLineNumber: 1,
      endColumn: 39,
    });
  });

  it("does not repeat reveal or marker registration for equivalent request and document identities", async () => {
    const diagnostics = [
      {
        severity: "error" as const,
        message: "Broken",
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
      },
    ];
    const editorProps = {
      ...baseProps,
      filePath: "src/Main.java",
      language: "java" as const,
      content: "abc\ndef",
      diagnosticOwner: "jdtls",
      diagnostics,
    };
    const { rerender } = render(
      <Editor
        {...editorProps}
        revealRequest={{ filePath: "src/Main.java", line: 2, column: 2, requestId: 1 }}
        documentIdentity={{
          workspaceId: "workspace-1",
          path: "src/Main.java",
          uri: "file:///src/Main.java",
        }}
      />,
    );
    await giveMonacoHostPositiveSize();
    await waitFor(() => expect(monacoHarness.setPosition).toHaveBeenCalledTimes(1));

    rerender(
      <Editor
        {...editorProps}
        revealRequest={{ filePath: "src/Main.java", line: 2, column: 2, requestId: 1 }}
        documentIdentity={{
          workspaceId: "workspace-1",
          path: "src/Main.java",
          uri: "file:///src/Main.java",
        }}
      />,
    );

    expect(monacoHarness.setPosition).toHaveBeenCalledTimes(1);
    expect(monacoHarness.setModelMarkers).toHaveBeenCalledTimes(1);

    rerender(
      <Editor
        {...editorProps}
        revealRequest={{ filePath: "src/Main.java", line: 1, column: 3, requestId: 2 }}
        documentIdentity={{
          workspaceId: "workspace-1",
          path: "src/Main.java",
          uri: "file:///src/Main.java",
        }}
      />,
    );

    await waitFor(() => expect(monacoHarness.setPosition).toHaveBeenCalledTimes(2));
    expect(monacoHarness.setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 3 });
    expect(monacoHarness.setModelMarkers).toHaveBeenCalledTimes(1);
  });
});
