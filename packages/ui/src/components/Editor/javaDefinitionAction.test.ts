import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { describe, expect, it, vi } from "vitest";

import { registerJavaDefinitionAction } from "./javaDefinitionAction";

describe("registerJavaDefinitionAction", () => {
  it("registers a separate JDT LS definition action and forwards the current cursor", () => {
    let action!: Monaco.editor.IActionDescriptor;
    const disposeAction = vi.fn();
    const model = { isDisposed: () => false } as unknown as Monaco.editor.ITextModel;
    const editor = {
      addAction: vi.fn((candidate: Monaco.editor.IActionDescriptor) => {
        action = candidate;
        return { dispose: disposeAction };
      }),
      getModel: () => model,
      getPosition: () => ({ lineNumber: 9, column: 14 }),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const api = {
      KeyMod: { CtrlCmd: 2048, Alt: 512 },
      KeyCode: { KeyJ: 40 },
    } as unknown as typeof Monaco;
    const onGoToDefinition = vi.fn();

    const registration = registerJavaDefinitionAction({
      api,
      editor,
      model,
      filePath: "src/Main.java",
      onGoToDefinition,
    });

    expect(action.id).toBe("ide.java.go-to-definition-jdtls");
    expect(action.label).toBe("Go to Definition with JDT LS");
    expect(action.precondition).toBe("editorLangId == java && !editorReadonly");
    expect(action.keybindings).toEqual([2048 | 512 | 40]);
    action.run(editor, "keyboard");
    expect(onGoToDefinition).toHaveBeenCalledWith("src/Main.java", { line: 9, column: 14 });

    registration.dispose();
    expect(disposeAction).toHaveBeenCalledOnce();
  });

  it("ignores disposed, replaced and positionless editor models", () => {
    const model = { isDisposed: () => false } as unknown as Monaco.editor.ITextModel;
    const replacedModel = {} as Monaco.editor.ITextModel;
    let action!: Monaco.editor.IActionDescriptor;
    const onGoToDefinition = vi.fn();
    const editor = {
      addAction: vi.fn((candidate: Monaco.editor.IActionDescriptor) => {
        action = candidate;
        return { dispose: vi.fn() };
      }),
      getModel: () => replacedModel,
      getPosition: () => ({ lineNumber: 1, column: 1 }),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const api = {
      KeyMod: { CtrlCmd: 2048, Alt: 512 },
      KeyCode: { KeyJ: 40 },
    } as unknown as typeof Monaco;
    const registration = registerJavaDefinitionAction({
      api,
      editor,
      model,
      filePath: "src/Main.java",
      onGoToDefinition,
    });

    action.run(editor, "keyboard");
    expect(onGoToDefinition).not.toHaveBeenCalled();

    (editor as unknown as { getModel: () => Monaco.editor.ITextModel }).getModel = () => model;
    (editor as unknown as { getPosition: () => null }).getPosition = () => null;
    action.run(editor, "keyboard");
    expect(onGoToDefinition).not.toHaveBeenCalled();

    registration.dispose();
    action.run(editor, "keyboard");
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });
});
