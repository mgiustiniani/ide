import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { registerDocumentLanguages } from "../components/Editor/documentLanguages";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
// Provider registration alone does not install Monaco's keyboard, peek and Ctrl-click actions.
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition";
import "monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu";
// Java LSP providers need their Monaco UI contributions as well as registration:
// otherwise completion, hover, and signature-help responses have nowhere to render.
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions";
import "monaco-editor/esm/vs/editor/contrib/codeAction/browser/codeActionContributions";
import "monaco-editor/esm/vs/editor/contrib/rename/browser/rename";
import "monaco-editor/esm/vs/editor/contrib/semanticTokens/browser/documentSemanticTokens";
import "monaco-editor/esm/vs/editor/contrib/semanticTokens/browser/viewportSemanticTokens";
import "monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsContribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type MonacoWorkerEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
};

type MonacoWorkerGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoWorkerEnvironment;
};

let configured = false;

/** Configure Monaco to use only workers and modules bundled with the application. */
export function configureLocalMonaco(): typeof monaco {
  if (configured) {
    return monaco;
  }

  loader.config({ monaco });

  // Register AsciiDoc/reStructuredText Monarch tokenizers on the esm editor.api
  // namespace. The esm namespace is a subset of the full monaco-editor types, so
  // cast through never to keep the call compiling.
  registerDocumentLanguages(monaco as never);

  monaco.editor.defineTheme("ide-java-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "class", foreground: "4ec9b0" },
      { token: "interface", foreground: "4ec9b0" },
      { token: "enum", foreground: "b8d7a3" },
      { token: "method", foreground: "dcdcaa" },
      { token: "function", foreground: "dcdcaa" },
      { token: "parameter", foreground: "9cdcfe" },
      { token: "variable", foreground: "9cdcfe" },
      { token: "property", foreground: "9cdcfe" },
      { token: "typeParameter", foreground: "4ec9b0" },
      { token: "annotation", foreground: "dcdcaa" },
      { token: "*.static", foreground: "d4d4d4", fontStyle: "italic" },
      { token: "*.deprecated", foreground: "858585", fontStyle: "strikethrough" },
    ],
    colors: {},
  });
  monaco.editor.defineTheme("ide-java-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "class", foreground: "267f99" },
      { token: "interface", foreground: "267f99" },
      { token: "enum", foreground: "098658" },
      { token: "method", foreground: "795e26" },
      { token: "function", foreground: "795e26" },
      { token: "parameter", foreground: "001080" },
      { token: "variable", foreground: "001080" },
      { token: "property", foreground: "001080" },
      { token: "typeParameter", foreground: "267f99" },
      { token: "annotation", foreground: "795e26" },
      { token: "*.static", foreground: "001080", fontStyle: "italic" },
      { token: "*.deprecated", foreground: "858585", fontStyle: "strikethrough" },
    ],
    colors: {},
  });

  const workerGlobal = globalThis as MonacoWorkerGlobal;
  workerGlobal.MonacoEnvironment = {
    ...workerGlobal.MonacoEnvironment,
    getWorker(_moduleId, label) {
      switch (label) {
        case "json":
          return new JsonWorker();
        case "css":
        case "scss":
        case "less":
          return new CssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new HtmlWorker();
        case "typescript":
        case "javascript":
          return new TypeScriptWorker();
        default:
          return new EditorWorker();
      }
    },
  };

  configured = true;
  return monaco;
}
