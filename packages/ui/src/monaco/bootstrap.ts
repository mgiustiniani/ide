import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
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
