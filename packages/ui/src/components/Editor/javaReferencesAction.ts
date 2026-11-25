import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

export function registerJavaReferencesAction(options: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  onFindReferences(filePath: string, position: { line: number; column: number }): void;
}): Monaco.IDisposable {
  const { api, editor, model, filePath, onFindReferences } = options;
  let disposed = false;
  const registration = editor.addAction({
    id: "ide.java.find-references-jdtls",
    label: "Find References with JDT LS",
    keybindings: [api.KeyMod.CtrlCmd | api.KeyMod.Alt | api.KeyCode.KeyR],
    keybindingContext: "editorTextFocus",
    precondition: "editorLangId == java && !editorReadonly",
    contextMenuGroupId: "1_modification",
    contextMenuOrder: 8,
    run() {
      if (disposed || model.isDisposed() || editor.getModel() !== model) return;
      const position = editor.getPosition();
      if (!position) return;
      onFindReferences(filePath, { line: position.lineNumber, column: position.column });
    },
  });
  return {
    dispose() {
      disposed = true;
      registration.dispose();
    },
  };
}
