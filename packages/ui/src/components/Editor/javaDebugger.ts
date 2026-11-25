import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEditorDebugger } from "./Editor";

/** Render verified source bindings and revoke decorations immediately when the model changes. */
export function registerJavaDebugger({
  api,
  editor,
  model,
  filePath,
  debugger: debugging,
  getCurrentDebugger,
  onStatus,
}: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  debugger: JavaEditorDebugger;
  getCurrentDebugger(): JavaEditorDebugger | undefined;
  onStatus?(status: "loading" | "ready" | "unavailable"): void;
}): Monaco.IDisposable & { refresh(): void } {
  const decorations = editor.createDecorationsCollection();
  let disposed = false;
  let sequence = 0;
  let approvedVersion: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let refreshNeeded = false;
  let toggling = false;
  const current = (version: number) =>
    !disposed &&
    getCurrentDebugger() === debugging &&
    editor.getModel() === model &&
    !model.isDisposed() &&
    model.getVersionId() === version;
  const document = () => ({
    path: filePath,
    text: model.getValue(),
    version: model.getVersionId(),
  });
  const refresh = async () => {
    if (inFlight) {
      refreshNeeded = true;
      return;
    }
    inFlight = true;
    const captured = document(),
      request = ++sequence;
    approvedVersion = undefined;
    decorations.clear();
    onStatus?.("loading");
    try {
      const view = await debugging.source(captured);
      if (
        !current(captured.version) ||
        request !== sequence ||
        view.documentPath !== filePath ||
        view.documentVersion !== captured.version
      )
        return;
      const points: Monaco.editor.IModelDeltaDecoration[] = [];
      for (const point of view.breakpoints) {
        if (point.line > model.getLineCount()) continue;
        points.push({
          range: new api.Range(point.line, 1, point.line, 1),
          options: {
            glyphMarginClassName:
              point.enabled === false
                ? "java-debug-breakpoint-disabled"
                : point.verified
                  ? "java-debug-breakpoint-verified"
                  : "java-debug-breakpoint-pending",
            glyphMarginHoverMessage: {
              value: `Java source breakpoint: ${point.enabled === false ? "disabled" : point.verified ? "verified" : "pending"}`,
            },
            stickiness: api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        });
      }
      if (view.executionLine !== null && view.executionLine <= model.getLineCount()) {
        points.push({
          range: new api.Range(view.executionLine, 1, view.executionLine, 1),
          options: {
            isWholeLine: true,
            className: "java-debug-execution-line",
            glyphMarginClassName: "java-debug-execution-glyph",
            glyphMarginHoverMessage: { value: "Selected suspended Java frame" },
            stickiness: api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        });
      }
      approvedVersion = captured.version;
      decorations.set(points);
      onStatus?.("ready");
      if (view.executionLine !== null && view.executionLine <= model.getLineCount())
        editor.revealLineInCenterIfOutsideViewport(view.executionLine);
    } catch {
      if (current(captured.version) && request === sequence) onStatus?.("unavailable");
      /* The application owns the visible provider/source refusal. */
    } finally {
      inFlight = false;
      if (refreshNeeded && !disposed) {
        refreshNeeded = false;
        void refresh();
      }
    }
  };
  const toggle = async (line: number | undefined) => {
    if (
      toggling ||
      !line ||
      !approvedVersion ||
      !current(approvedVersion) ||
      line > model.getLineCount()
    )
      return;
    toggling = true;
    const captured = document();
    try {
      await debugging.toggleBreakpoint(captured, line);
      if (current(captured.version)) await refresh();
    } catch {
      if (current(captured.version)) {
        approvedVersion = undefined;
        decorations.clear();
        onStatus?.("unavailable");
      }
      /* Refusals are presented by the application controller. */
    } finally {
      toggling = false;
    }
  };
  const content = editor.onDidChangeModelContent(() => {
    ++sequence;
    approvedVersion = undefined;
    decorations.clear();
    onStatus?.("loading");
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!disposed) void refresh();
    }, 100);
  });
  const mouse = editor.onMouseDown((event) => {
    if (
      event.target.type === api.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
      event.event.leftButton
    )
      void toggle(event.target.position?.lineNumber);
  });
  const action = editor.addAction({
    id: "ide.java.debugger.toggleSourceBreakpoint",
    label: "Toggle Java source breakpoint",
    keybindings: [api.KeyCode.F9],
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.5,
    run: () => toggle(editor.getPosition()?.lineNumber),
  });
  const runToCursorAction =
    debugging.mode === "live" && debugging.canRunToCursor
      ? editor.addAction({
          id: "ide.java.debugger.runToCursor",
          label: "Run Java to Cursor",
          contextMenuGroupId: "navigation",
          contextMenuOrder: 1.6,
          run: async () => {
            const line = editor.getPosition()?.lineNumber;
            if (
              toggling ||
              !line ||
              !approvedVersion ||
              !current(approvedVersion) ||
              line > model.getLineCount()
            )
              return;
            toggling = true;
            try {
              await debugging.runToCursor(document(), line);
            } catch {
              if (current(model.getVersionId())) onStatus?.("unavailable");
              /* Refusals are presented by the application controller. */
            } finally {
              toggling = false;
            }
          },
        })
      : undefined;
  void refresh();
  return {
    refresh() {
      if (!disposed) void refresh();
    },
    dispose() {
      disposed = true;
      ++sequence;
      clearTimeout(timer);
      content.dispose();
      mouse.dispose();
      action.dispose();
      runToCursorAction?.dispose();
      decorations.clear();
    },
  };
}
