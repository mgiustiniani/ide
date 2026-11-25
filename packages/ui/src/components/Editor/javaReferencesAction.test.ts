import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { describe, expect, it, vi } from "vitest";
import { registerJavaReferencesAction } from "./javaReferencesAction";

function harness() {
  const descriptors: Monaco.editor.IActionDescriptor[] = [];
  const dispose = vi.fn();
  let activeModel: Monaco.editor.ITextModel | null = null;
  let position: Monaco.Position | null = { lineNumber: 6, column: 15 } as Monaco.Position;
  const model = { isDisposed: () => false } as unknown as Monaco.editor.ITextModel;
  activeModel = model;
  const editor = {
    getModel: () => activeModel,
    getPosition: () => position,
    addAction(action: Monaco.editor.IActionDescriptor) {
      descriptors.push(action);
      return { dispose };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const onFindReferences = vi.fn();
  const registration = registerJavaReferencesAction({
    api: {
      KeyMod: { CtrlCmd: 2048, Alt: 512 },
      KeyCode: { KeyR: 31 },
    } as unknown as typeof Monaco,
    editor,
    model,
    filePath: "src/example/Main.java",
    onFindReferences,
  });
  return {
    descriptors,
    dispose,
    editor,
    model,
    onFindReferences,
    registration,
    retireModel() {
      activeModel = null;
    },
    removePosition() {
      position = null;
    },
  };
}

describe("Monaco Java JDT LS references action", () => {
  it("offers a separately named JDT LS query from the editor and context menu", () => {
    const h = harness();
    const [action] = h.descriptors;
    expect(action?.id).toBe("ide.java.find-references-jdtls");
    expect(action?.label).toBe("Find References with JDT LS");
    expect(action?.keybindings).toEqual([2048 | 512 | 31]);
    expect(action?.keybindingContext).toBe("editorTextFocus");
    expect(action?.contextMenuGroupId).toBe("1_modification");
    action?.run(h.editor);
    expect(h.onFindReferences).toHaveBeenCalledWith("src/example/Main.java", {
      line: 6,
      column: 15,
    });
  });

  it("ignores stale editor models and missing cursor positions", () => {
    const h = harness();
    const [action] = h.descriptors;
    h.retireModel();
    action?.run(h.editor);
    h.removePosition();
    action?.run(h.editor);
    expect(h.onFindReferences).not.toHaveBeenCalled();
  });

  it("disposes the Monaco action and ignores a retained callback", () => {
    const h = harness();
    const [action] = h.descriptors;
    h.registration.dispose();
    action?.run(h.editor);
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.onFindReferences).not.toHaveBeenCalled();
  });
});
