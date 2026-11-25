import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { describe, expect, it, vi } from "vitest";
import type { JavaEditorFileActions } from "./Editor";
import { registerJavaFileActions } from "./javaFileActions";

function harness(
  operations: JavaEditorFileActions["operations"] = ["format-file", "organize-imports"],
  source = "class Sample {}",
  selectedText: string | null = "1 + 2",
) {
  const descriptors: Monaco.editor.IActionDescriptor[] = [];
  const offsetAt = (lineNumber: number, column: number) =>
    source
      .split("\n")
      .slice(0, lineNumber - 1)
      .reduce((offset, line) => offset + line.length + 1, 0) +
    column -
    1;
  const positionAt = (offset: number) => {
    const before = source.slice(0, offset);
    const lineNumber = before.split("\n").length;
    return { lineNumber, column: offset - before.lastIndexOf("\n") };
  };
  const model = {
    isDisposed: () => false,
    getValue: () => source,
    getVersionId: () => 3,
    getOffsetAt: (position: { lineNumber: number; column: number }) =>
      offsetAt(position.lineNumber, position.column),
  } as unknown as Monaco.editor.ITextModel;
  let currentModel: Monaco.editor.ITextModel | null = model;
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const editor = {
    getModel: () => currentModel,
    getPosition: () => ({ lineNumber: 2, column: 4 }),
    getSelection: () => {
      if (selectedText === null) return null;
      const start = source.indexOf(selectedText);
      return {
        isEmpty: () => false,
        getStartPosition: () => positionAt(start),
        getEndPosition: () => positionAt(start + selectedText.length),
      };
    },
    addAction(action: Monaco.editor.IActionDescriptor) {
      descriptors.push(action);
      const dispose = vi.fn();
      disposals.push(dispose);
      return { dispose };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const actions: JavaEditorFileActions = {
    context: { workspaceId: "one", generation: 1 },
    operations,
    review: vi.fn(),
    reviewLsp: vi.fn(),
  };
  let current: JavaEditorFileActions | undefined = actions;
  const onStatus = vi.fn();
  const registration = registerJavaFileActions({
    api: {
      KeyMod: { Shift: 1024, Alt: 512 },
      KeyCode: { KeyF: 36, KeyO: 45, F2: 60, F6: 64 },
    } as unknown as typeof Monaco,
    editor,
    model,
    filePath: "src/main/java/Sample.java",
    actions,
    getCurrentActions: () => current,
    onStatus,
  });
  return {
    actions,
    descriptors,
    disposals,
    onStatus,
    registration,
    editor,
    retire(kind: string) {
      if (kind === "model") currentModel = null;
      if (kind === "workspace")
        current = { ...actions, context: { workspaceId: "two", generation: 1 } };
      if (kind === "generation")
        current = { ...actions, context: { workspaceId: "one", generation: 2 } };
      if (kind === "provider") current = { ...actions, operations: [] };
      if (kind === "disposed") registration.dispose();
    },
  };
}
describe("Monaco Java file review actions", () => {
  it("offers a distinct reviewed formatting proposal without shadowing Monaco's formatter shortcut", () => {
    const h = harness();
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review Java formatting",
      "Review Java imports",
    ]);
    h.descriptors[0].run(h.editor);
    expect(h.actions.review).toHaveBeenCalledWith("format-file", {
      path: "src/main/java/Sample.java",
      text: "class Sample {}",
      version: 3,
    });
    expect(h.descriptors[0].keybindings).toBeUndefined();
    h.registration.dispose();
    expect(h.disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
  it("offers Make Public from the saved Java cursor", () => {
    const source = "class Sample { private final int isolated() { return 42; } }";
    const h = harness(["make-public"], source, null);
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review making the Java method public",
    ]);
    h.descriptors[0].run(h.editor);
    expect(h.actions.review).toHaveBeenCalledWith(
      "make-public",
      { path: "src/main/java/Sample.java", text: source, version: 3 },
      { line: 2, column: 4 },
    );
  });
  it("offers Move Member from the saved Java cursor", () => {
    const source =
      "package fixture; class Source { static int value() { return 42; } } class Destination {}";
    const h = harness(["move-member"], source, null);
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review Java Move Member at cursor",
    ]);
    h.descriptors[0].run(h.editor);
    expect(h.actions.review).toHaveBeenCalledWith(
      "move-member",
      { path: "src/main/java/Sample.java", text: source, version: 3 },
      { line: 2, column: 4 },
    );
  });
  it("routes client-managed Extract Parameter through the selected expression", () => {
    const source = "class Sample { int value = 1 + 2; }";
    const h = harness(["lsp-extract-parameter"], source, "1 + 2");
    expect(h.descriptors.map((action) => action.label)).toEqual(["Review Java Extract Parameter"]);
    h.descriptors[0].run(h.editor);
    expect(h.actions.reviewLsp).toHaveBeenCalledWith(
      "lsp-extract-parameter",
      { path: "src/main/java/Sample.java", text: source, version: 3 },
      undefined,
      { start: source.indexOf("1 + 2"), end: source.indexOf("1 + 2") + 5 },
    );
    expect(h.actions.review).not.toHaveBeenCalled();
  });

  it.each(["lsp-change-visibility", "lsp-extract-superclass"] as const)(
    "routes %s through the client-managed preview at the current cursor",
    (operation) => {
      const h = harness([operation], "class Sample { private int value() { return 1; } }", null);
      h.descriptors[0].run(h.editor);
      expect(h.actions.reviewLsp).toHaveBeenCalledWith(
        operation,
        {
          path: "src/main/java/Sample.java",
          text: "class Sample { private int value() { return 1; } }",
          version: 3,
        },
        { line: 2, column: 4 },
      );
      expect(h.actions.review).not.toHaveBeenCalled();
    },
  );
  it.each(["model", "workspace", "generation", "provider", "disposed"])(
    "ignores a retained action after %s retirement",
    (kind) => {
      const h = harness();
      h.retire(kind);
      h.descriptors[1].run(h.editor);
      expect(h.actions.review).not.toHaveBeenCalled();
      if (["workspace", "generation", "provider"].includes(kind))
        expect(h.onStatus).toHaveBeenCalledWith(
          "This Java file action is stale or no longer available.",
        );
      else expect(h.onStatus).not.toHaveBeenCalled();
    },
  );
  it("reports dirty-buffer refusal without calling another mutation path", () => {
    const h = harness();
    vi.mocked(h.actions.review).mockImplementation(() => {
      throw new Error("Save all unsaved buffers before refactoring.");
    });
    h.descriptors[0].run(h.editor);
    expect(h.onStatus).toHaveBeenCalledWith("Save all unsaved buffers before refactoring.");
  });
  it("passes Monaco's exact cursor position to review-only rename actions", () => {
    const h = harness(["rename-class", "rename-member"]);
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review type rename at cursor",
      "Review member rename at cursor",
    ]);
    h.descriptors[0].run(h.editor);
    expect(h.actions.review).toHaveBeenCalledWith(
      "rename-class",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
    expect(h.descriptors[0].keybindings).toEqual([1024 | 64]);
    expect(h.descriptors[0].keybindingContext).toBe("editorTextFocus");
    h.descriptors[1].run(h.editor);
    expect(h.actions.review).toHaveBeenLastCalledWith(
      "rename-member",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
    expect(h.descriptors[1].keybindings).toEqual([60]);
    expect(h.descriptors[1].keybindingContext).toBe("editorTextFocus");
  });

  it("passes Monaco's exact cursor position to saved-source parameter reordering", () => {
    const h = harness(["reorder-method-parameters"]);
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review Java method parameter order",
    ]);

    h.descriptors[0].run(h.editor);

    expect(h.actions.review).toHaveBeenCalledWith(
      "reorder-method-parameters",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
  });

  it("offers parameter rename from the saved Java cursor", () => {
    const h = harness(["change-method-signature"]);
    expect(h.descriptors.map((action) => action.label)).toEqual(["Review Java Parameter Rename"]);

    h.descriptors[0].run(h.editor);

    expect(h.actions.review).toHaveBeenCalledWith(
      "change-method-signature",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
  });

  it("passes Monaco's exact cursor position to saved-source parameter removal", () => {
    const h = harness(["remove-method-parameter"]);
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review removing a Java method parameter",
    ]);

    h.descriptors[0].run(h.editor);

    expect(h.actions.review).toHaveBeenCalledWith(
      "remove-method-parameter",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
  });

  it("passes Monaco's exact cursor position to saved-source parameter type changes", () => {
    const h = harness(["change-method-parameter-type"]);
    expect(h.descriptors.map((action) => action.label)).toEqual(["Review Java parameter type"]);

    h.descriptors[0].run(h.editor);

    expect(h.actions.review).toHaveBeenCalledWith(
      "change-method-parameter-type",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
  });

  it("passes Monaco's exact cursor position to Extract Interface", () => {
    const h = harness(["extract-interface"]);
    expect(h.descriptors.map((action) => action.label)).toEqual([
      "Review Java interface extraction at cursor",
    ]);

    h.descriptors[0].run(h.editor);

    expect(h.actions.review).toHaveBeenCalledWith(
      "extract-interface",
      { path: "src/main/java/Sample.java", text: "class Sample {}", version: 3 },
      { line: 2, column: 4 },
    );
  });

  it.each([
    "extract-constant",
    "extract-variable",
    "extract-method",
    "extract-parameter",
    "extract-field",
  ] as const)("passes the exact selected range for %s", (operation) => {
    const method = operation === "extract-method";
    const source = method
      ? "class Sample {\n  void run() {\n    int total = 1;\n  }\n}"
      : "class Sample { int value() { return 1 + 2; } }";
    const selectedText = method ? "int total = 1;" : "1 + 2";
    const h = harness([operation], source, selectedText);
    const action = h.descriptors[0];
    action.run(h.editor);
    const start = source.indexOf(selectedText);
    expect(h.actions.review).toHaveBeenCalledWith(
      operation,
      { path: "src/main/java/Sample.java", text: source, version: 3 },
      undefined,
      { start, end: start + selectedText.length },
    );
  });

  it("asks for a complete local declaration line before reviewing Extract Method", () => {
    const h = harness(["extract-method"], "class Sample {}", null);
    h.descriptors[0].run(h.editor);
    expect(h.actions.review).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenCalledWith(
      "Select Java statements before reviewing Extract Method.",
    );
  });
});
