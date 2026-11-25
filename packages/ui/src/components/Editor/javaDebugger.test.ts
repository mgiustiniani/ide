import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaDebuggerSourceView } from "@ide/contracts";
import { describe, expect, it, vi } from "vitest";
import type { JavaEditorDebugger } from "./Editor";
import { registerJavaDebugger } from "./javaDebugger";

function harness() {
  let version = 3,
    text = "class Main {\n int n = 7;\n}",
    changed!: () => void;
  let mouse!: (event: Monaco.editor.IEditorMouseEvent) => void;
  const actions = new Map<string, Monaco.editor.IActionDescriptor>();
  const collection = { clear: vi.fn(), set: vi.fn() };
  const model = {
    getVersionId: () => version,
    getValue: () => text,
    getLineCount: () => 3,
    isDisposed: () => false,
  } as unknown as Monaco.editor.ITextModel;
  let currentModel = model;
  const editor = {
    getModel: () => currentModel,
    getPosition: () => ({ lineNumber: 2, column: 1 }),
    createDecorationsCollection: () => collection,
    revealLineInCenterIfOutsideViewport: vi.fn(),
    onDidChangeModelContent: (fn: () => void) => {
      changed = fn;
      return { dispose: vi.fn() };
    },
    onMouseDown: (fn: typeof mouse) => {
      mouse = fn;
      return { dispose: vi.fn() };
    },
    addAction: (descriptor: Monaco.editor.IActionDescriptor) => {
      actions.set(descriptor.id, descriptor);
      return { dispose: vi.fn() };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  }
  const api = {
    Range,
    KeyCode: { F9: 67 },
    editor: {
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
  } as unknown as typeof Monaco;
  const view: JavaDebuggerSourceView = {
    workspaceId: "one",
    generation: 1,
    sessionId: "debug",
    requestId: "source",
    documentPath: "Main.java",
    documentVersion: version,
    sourcePath: "Main.java",
    stopId: "stop-1",
    frameId: "frame-1",
    executionLine: 2,
    breakpoints: [{ line: 2, verified: true }],
  };
  const debugging: JavaEditorDebugger = {
    context: { workspaceId: "one", generation: 1, sessionId: "debug" },
    mode: "live",
    canRunToCursor: true,
    source: vi.fn(async () => view),
    toggleBreakpoint: vi.fn(async () => {}),
    runToCursor: vi.fn(async () => {}),
  };
  let current: JavaEditorDebugger | undefined = debugging;
  const register = () =>
    registerJavaDebugger({
      api,
      editor,
      model,
      filePath: "Main.java",
      debugger: debugging,
      getCurrentDebugger: () => current,
    });
  return {
    register,
    debugging,
    view,
    editor,
    collection,
    mouse: (type = 2) =>
      mouse({
        target: { type, position: { lineNumber: 2, column: 1 } },
        event: { leftButton: true },
      } as Monaco.editor.IEditorMouseEvent),
    shortcut: () => actions.get("ide.java.debugger.toggleSourceBreakpoint")!.run(editor),
    runToCursor: () => actions.get("ide.java.debugger.runToCursor")!.run(editor),
    action: (id: string) => actions.get(id),
    retire: () => {
      current = undefined;
    },
    replaceModel: () => {
      currentModel = {} as Monaco.editor.ITextModel;
    },
    edit: () => {
      version++;
      text += "\n// draft";
      changed();
    },
  };
}
describe("Java debugger Monaco source binding", () => {
  it("serializes inspections and keeps only the latest edited model while a provider is slow", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let resolve!: (view: JavaDebuggerSourceView) => void;
      vi.mocked(h.debugging.source)
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValue({ ...h.view, documentVersion: 4 });
      const registration = h.register();
      h.edit();
      await vi.advanceTimersByTimeAsync(100);
      expect(h.debugging.source).toHaveBeenCalledTimes(1);
      resolve(h.view);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(h.debugging.source).toHaveBeenCalledTimes(2);
      expect(h.debugging.source).toHaveBeenLastCalledWith(expect.objectContaining({ version: 4 }));
      registration.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("renders provider lines and routes real gutter/F9 actions with exact model text", async () => {
    const h = harness(),
      registration = h.register();
    await vi.waitFor(() => expect(h.collection.set).toHaveBeenCalled());
    expect(
      h.collection.set.mock.calls[0][0].map(
        (point: Monaco.editor.IModelDeltaDecoration) => point.options.glyphMarginClassName,
      ),
    ).toEqual(["java-debug-breakpoint-verified", "java-debug-execution-glyph"]);
    expect(h.editor.revealLineInCenterIfOutsideViewport).toHaveBeenCalledWith(2);
    h.mouse(3);
    expect(h.debugging.toggleBreakpoint).not.toHaveBeenCalled();
    h.mouse();
    await vi.waitFor(() => expect(h.debugging.toggleBreakpoint).toHaveBeenCalledTimes(1));
    await h.shortcut();
    expect(h.debugging.toggleBreakpoint).toHaveBeenLastCalledWith(
      { path: "Main.java", version: 3, text: "class Main {\n int n = 7;\n}" },
      2,
    );
    registration.dispose();
  });
  it("offers Run Java to Cursor in the editor menu and binds it to the approved line", async () => {
    const h = harness(),
      registration = h.register();
    await vi.waitFor(() => expect(h.collection.set).toHaveBeenCalled());
    expect(h.action("ide.java.debugger.runToCursor")?.label).toBe("Run Java to Cursor");
    await h.runToCursor();
    expect(h.debugging.runToCursor).toHaveBeenCalledWith(
      { path: "Main.java", version: 3, text: "class Main {\n int n = 7;\n}" },
      2,
    );
    registration.dispose();
  });
  it("clears decorations immediately on typing and refuses a click against the old binding", async () => {
    const h = harness(),
      registration = h.register();
    await vi.waitFor(() => expect(h.collection.set).toHaveBeenCalled());
    h.collection.clear.mockClear();
    h.edit();
    expect(h.collection.clear).toHaveBeenCalledTimes(1);
    h.mouse();
    await h.shortcut();
    expect(h.debugging.toggleBreakpoint).not.toHaveBeenCalled();
    registration.dispose();
  });
  it.each(["retired", "model", "disposed"])(
    "rejects delayed source markers after %s retirement",
    async (kind) => {
      const h = harness();
      let resolve!: (view: JavaDebuggerSourceView) => void;
      vi.mocked(h.debugging.source).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const registration = h.register();
      if (kind === "retired") h.retire();
      else if (kind === "model") h.replaceModel();
      else registration.dispose();
      resolve(h.view);
      await Promise.resolve();
      await Promise.resolve();
      expect(h.collection.set).not.toHaveBeenCalled();
      h.mouse();
      expect(h.debugging.toggleBreakpoint).not.toHaveBeenCalled();
      registration.dispose();
    },
  );
});
