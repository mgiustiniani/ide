const STUBS = new Map([
  [
    "@xterm/xterm",
    `export class Terminal {
      options = {};
      loadAddon() {}
      open() {}
      write() {}
      reset() {}
      clear() {}
      dispose() {}
      attachCustomKeyEventHandler() {}
      onData() { return { dispose() {} }; }
      onResize() { return { dispose() {} }; }
      onKey() { return { dispose() {} }; }
    }`,
  ],
  ["@xterm/addon-fit", "export class FitAddon { fit() {} dispose() {} }"],
  [
    "@monaco-editor/react",
    `const disposable = () => ({ dispose() {} });
    let currentEditor;
    let currentModel;
    const monaco = {
      editor: {
        setModelMarkers(_model, owner, markers) {
          globalThis.__IDE_STORY_MONACO_MARKER_OBSERVER__?.(owner, markers);
        },
        createModel(value, _language, uri) {
          return {
            uri,
            getValue: () => value,
            getLineCount: () => Math.max(1, value.split("\\n").length),
            getLineMaxColumn: (line) => (value.split("\\n")[line - 1]?.length ?? 0) + 1,
            isDisposed: () => false,
            dispose() {},
          };
        },
        getModels: () => (currentModel ? [currentModel] : []),
        getEditors: () => (currentEditor ? [currentEditor] : []),
        onDidCreateEditor: disposable,
        registerEditorOpener: disposable,
        registerCommand: disposable,
        OverviewRulerLane: { Right: 1 },
        TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 0 },
        MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 },
        EditorOption: { readOnly: 1, domReadOnly: 2 },
      },
      languages: {
        CompletionItemKind: { Text: 0 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
        InlayHintKind: { Type: 1, Parameter: 2 },
        registerCompletionItemProvider: disposable,
        registerHoverProvider: disposable,
        registerSignatureHelpProvider: disposable,
        registerDefinitionProvider: disposable,
        registerImplementationProvider: disposable,
        registerReferenceProvider: disposable,
        registerDocumentHighlightProvider: disposable,
        registerCodeActionProvider: disposable,
        registerDocumentFormattingEditProvider: disposable,
        registerDocumentRangeFormattingEditProvider: disposable,
        registerDocumentSemanticTokensProvider: disposable,
        registerDocumentSymbolProvider: disposable,
        registerInlayHintsProvider: disposable,
        registerRenameProvider: disposable,
        register() {},
        setMonarchTokensProvider() {},
      },
      Uri: { parse: (value) => ({ toString: () => value }) },
      KeyMod: { CtrlCmd: 2048, Alt: 512, Shift: 1024 },
      KeyCode: { KeyR: 31, KeyO: 45, F2: 60, F6: 64, F9: 67, F12: 70 },
    };
    export const loader = { config() {} };
    export default function StoryMonacoEditor(props) {
      const model = {
        uri: { toString: () => props.path },
        getLineCount: () => Math.max(1, props.value.split("\\n").length),
        getLineMaxColumn: (line) => (props.value.split("\\n")[line - 1]?.length ?? 0) + 1,
        getValue: () => props.value,
        getVersionId: () => 1,
        getPositionAt: () => ({ lineNumber: 1, column: 1 }),
        validatePosition: (position) => position,
        isDisposed: () => false,
        dispose() {},
      };
      const editor = {
        layout() {},
        getModel: () => model,
        onDidChangeModel: disposable,
        onDidChangeModelContent: disposable,
        onDidChangeCursorPosition: disposable,
        onDidScrollChange: disposable,
        onDidDispose: disposable,
        setPosition() {},
        getPosition: () => null,
        getSelection: () => null,
        saveViewState: () => null,
        restoreViewState() {},
        revealPositionInCenter() {},
        revealLineInCenterIfOutsideViewport() {},
        getDomNode: () => null,
        getOption: () => false,
        updateOptions() {},
        addAction: disposable,
        createDecorationsCollection: () => ({ set() {}, clear() {} }),
        onMouseDown: disposable,
        executeEdits: () => true,
        pushUndoStop() {},
        trigger() {},
        focus() {},
      };
      currentEditor = editor;
      currentModel = model;
      globalThis.React.useEffect(() => {
        props.onMount?.(editor, monaco);
      }, [props.path]);
      return globalThis.React.createElement("textarea", {
        "aria-label": props.options?.ariaLabel ?? "Story Monaco editor",
        "data-testid": "story-monaco-editor",
        readOnly: true,
        value: props.value,
      });
    }`,
  ],
]);

const MONACO_API = `
  export const editor = {
    defineTheme() {},
    setModelMarkers(_model, owner, markers) {
      globalThis.__IDE_STORY_MONACO_MARKER_OBSERVER__?.(owner, markers);
    },
  };
  export const languages = {
    CompletionItemKind: { Text: 0 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
    InlayHintKind: { Type: 1, Parameter: 2 },
    register() {},
    setMonarchTokensProvider() {},
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} }),
    registerSignatureHelpProvider: () => ({ dispose() {} }),
    registerDefinitionProvider: () => ({ dispose() {} }),
    registerImplementationProvider: () => ({ dispose() {} }),
    registerReferenceProvider: () => ({ dispose() {} }),
    registerDocumentHighlightProvider: () => ({ dispose() {} }),
    registerCodeActionProvider: () => ({ dispose() {} }),
    registerDocumentFormattingEditProvider: () => ({ dispose() {} }),
    registerDocumentRangeFormattingEditProvider: () => ({ dispose() {} }),
    registerDocumentSemanticTokensProvider: () => ({ dispose() {} }),
    registerDocumentSymbolProvider: () => ({ dispose() {} }),
    registerInlayHintsProvider: () => ({ dispose() {} }),
    registerRenameProvider: () => ({ dispose() {} }),
  };
  export const Uri = { parse: (value) => ({ toString: () => value }) };
`;

export async function resolve(specifier, context, nextResolve) {
  let source = STUBS.get(specifier);
  if (source === undefined && specifier.startsWith("monaco-editor/")) {
    source =
      specifier.includes("?worker") || specifier.endsWith(".worker")
        ? "export default class StoryMonacoWorker {}"
        : specifier.includes("editor.api")
          ? MONACO_API
          : "export {};";
  }
  if (source !== undefined) {
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(source)}`,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  }
  return nextLoad(url, context);
}
