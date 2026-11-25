import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

export function registerJavaDefinitionAction(options: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  onGoToDefinition(
    filePath: string,
    position: { line: number; column: number },
  ): void | Promise<void>;
}): Monaco.IDisposable {
  const { api, editor, model, filePath, onGoToDefinition } = options;
  let disposed = false;
  const registration = editor.addAction({
    id: "ide.java.go-to-definition-jdtls",
    label: "Go to Definition with JDT LS",
    keybindings: [api.KeyMod.CtrlCmd | api.KeyMod.Alt | api.KeyCode.KeyJ],
    keybindingContext: "editorTextFocus",
    precondition: "editorLangId == java && !editorReadonly",
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.35,
    run() {
      if (disposed || model.isDisposed() || editor.getModel() !== model) return;
      const position = editor.getPosition();
      if (!position) return;
      void onGoToDefinition(filePath, {
        line: position.lineNumber,
        column: position.column,
      });
    },
  });
  return {
    dispose() {
      disposed = true;
      registration.dispose();
    },
  };
}
