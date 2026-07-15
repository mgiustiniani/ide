const STUBS = new Map([
  [
    "@xterm/xterm",
    `export class Terminal {
      loadAddon() {}
      open() {}
      write() {}
      clear() {}
      dispose() {}
      onKey() { return { dispose() {} }; }
    }`,
  ],
  ["@xterm/addon-fit", "export class FitAddon { fit() {} dispose() {} }"],
  [
    "@monaco-editor/react",
    `const mountedPaths = new Set();
    const disposable = () => ({ dispose() {} });
    const model = {
      uri: { toString: () => "inmemory://story/ClipboardImportProof.java" },
      getLineCount: () => 5,
      getLineMaxColumn: () => 80,
      getValue: () => "",
      getPositionAt: () => ({ lineNumber: 1, column: 1 }),
      validatePosition: (position) => position,
    };
    const editor = {
      layout() {},
      getModel: () => model,
      setPosition() {},
      revealPositionInCenter() {},
      focus() {},
    };
    const monaco = {
      editor: { setModelMarkers() {} },
      languages: {
        CompletionItemKind: { Text: 0 },
        registerCompletionItemProvider: disposable,
        registerHoverProvider: disposable,
        registerSignatureHelpProvider: disposable,
      },
      Uri: { parse: (value) => ({ toString: () => value }) },
    };
    export const loader = { config() {} };
    export default function StoryMonacoEditor(props) {
      if (!mountedPaths.has(props.path)) {
        mountedPaths.add(props.path);
        queueMicrotask(() => props.onMount?.(editor, monaco));
      }
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
  export const editor = { setModelMarkers() {} };
  export const languages = {
    CompletionItemKind: { Text: 0 },
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} }),
    registerSignatureHelpProvider: () => ({ dispose() {} }),
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
