import { useMemo, useRef } from "react";
import type { JavaLspRefactoringCapabilities, RefactorKitCapabilities } from "@ide/contracts";
import {
  javaContextRefactoringOffered,
  javaEditorRefactoringPreviewOffered,
  javaMutationSelectionOffered,
} from "@ide/contracts";
import type { JavaEditorFileActions } from "@ide/ui";
import type { EditorViewModel } from "@ide/web-core";
import type { JavaRefactoringController } from "./useJavaRefactoringController";

export function useJavaFileActions(dependencies: {
  workspaceId: string | null;
  generation: number;
  rootPath: string | null;
  capabilities: RefactorKitCapabilities | null;
  lspCapabilities?: JavaLspRefactoringCapabilities | null;
  sdkSelected?: boolean;
  projectContextAvailable?: boolean;
  javaWorkspaceSymbolsAvailable?: boolean;
  getCursorPosition(path: string): { line: number; column: number } | null;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  getEditorState(): { activeFilePath: string | null; contents: Record<string, string> };
  editor: Pick<EditorViewModel, "reviewSavedBuffers">;
  refactoring: Pick<JavaRefactoringController, "open" | "isWriting">;
  reviewLsp?(
    operation: "lsp-change-visibility" | "lsp-extract-parameter" | "lsp-extract-superclass",
    document: { path: string; text: string; version?: number },
    cursor?: { line: number; column: number },
    selection?: { start: number; end: number },
  ): void;
}): JavaEditorFileActions | undefined {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const general = dependencies.capabilities?.generalRefactoring;
  const operations = (["format-file", "organize-imports"] as const).filter((operation) => {
    if (
      dependencies.sdkSelected &&
      dependencies.projectContextAvailable &&
      javaContextRefactoringOffered(dependencies.capabilities, operation, "preview")
    )
      return true;
    return Boolean(general?.supported && general.preview && general.operations.includes(operation));
  });
  const cursorOperations = (["rename-class", "rename-member"] as const).filter(
    (operation) =>
      dependencies.sdkSelected &&
      dependencies.projectContextAvailable &&
      javaEditorRefactoringPreviewOffered(dependencies.capabilities, operation),
  );
  const savedCursorOperations = (
    [
      "add-method-parameter",
      "remove-method-parameter",
      "change-method-signature",
      "reorder-method-parameters",
      "change-method-parameter-type",
      "make-static",
      "make-public",
      "change-field-type",
      "inline-method",
      "introduce-parameter-object",
      "extract-delegate",
      "extract-interface",
      "extract-superclass",
      "pull-up-member",
      "push-down-member",
      "move-member",
    ] as const
  ).filter(
    (operation) =>
      dependencies.sdkSelected &&
      dependencies.projectContextAvailable &&
      (operation !== "move-member" || dependencies.javaWorkspaceSymbolsAvailable === true) &&
      javaMutationSelectionOffered(dependencies.capabilities) &&
      javaContextRefactoringOffered(dependencies.capabilities, operation, "preview"),
  );
  const selectionOperations = (
    [
      "extract-constant",
      "extract-variable",
      "extract-method",
      "extract-parameter",
      "extract-field",
      "inline-variable",
      "inline-constant",
    ] as const
  ).filter(
    (operation) =>
      dependencies.sdkSelected &&
      dependencies.projectContextAvailable &&
      javaContextRefactoringOffered(dependencies.capabilities, operation, "preview"),
  );
  const lspOperations = [
    ...(dependencies.lspCapabilities?.changeVisibility ? ["lsp-change-visibility" as const] : []),
    ...(dependencies.lspCapabilities?.extractParameter ? ["lsp-extract-parameter" as const] : []),
    ...(dependencies.lspCapabilities?.extractSuperclass ? ["lsp-extract-superclass" as const] : []),
  ].filter(() => dependencies.sdkSelected);
  const key = [
    ...operations,
    ...cursorOperations,
    ...savedCursorOperations,
    ...selectionOperations,
    ...lspOperations,
  ].join(",");
  const { workspaceId, generation, rootPath } = dependencies;
  return useMemo(() => {
    if (!workspaceId || !rootPath || !key) return undefined;
    const context = { workspaceId, generation };
    const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
    return {
      context,
      operations: key.split(",") as (
        | "format-file"
        | "organize-imports"
        | "rename-class"
        | "rename-member"
        | "add-method-parameter"
        | "remove-method-parameter"
        | "change-method-signature"
        | "reorder-method-parameters"
        | "change-method-parameter-type"
        | "make-static"
        | "make-public"
        | "change-field-type"
        | "inline-variable"
        | "inline-method"
        | "introduce-parameter-object"
        | "extract-delegate"
        | "inline-constant"
        | "extract-constant"
        | "extract-variable"
        | "extract-method"
        | "extract-parameter"
        | "extract-field"
        | "extract-interface"
        | "extract-superclass"
        | "pull-up-member"
        | "push-down-member"
        | "move-member"
        | "lsp-change-visibility"
        | "lsp-extract-parameter"
        | "lsp-extract-superclass"
      )[],
      review(operation, document, cursor, selection) {
        const current = latest.current,
          workspace = current.getContext(),
          editor = current.getEditorState();
        if (
          workspace.isSwitching ||
          workspace.workspaceId !== context.workspaceId ||
          workspace.generation !== context.generation ||
          current.rootPath !== rootPath ||
          current.refactoring.isWriting ||
          editor.activeFilePath !== document.path ||
          editor.contents[document.path] !== document.text ||
          !document.path.endsWith(".java")
        )
          throw new Error("The Java file action is obsolete or unavailable.");
        let path = document.path.replace(/\\/g, "/");
        if (path.startsWith(root + "/")) path = path.slice(root.length + 1);
        if (
          !path ||
          path.startsWith("/") ||
          /^[A-Za-z]:/.test(path) ||
          path.split("/").some((part) => !part || part === "." || part === "..")
        )
          throw new Error("The Java file must be inside the current workspace.");
        if (operation === "inline-variable" || operation === "inline-constant") {
          if (
            !current.sdkSelected ||
            !current.projectContextAvailable ||
            !javaContextRefactoringOffered(current.capabilities, operation, "preview") ||
            !selection ||
            !Number.isSafeInteger(selection.start) ||
            !Number.isSafeInteger(selection.end) ||
            selection.start < 0 ||
            selection.end <= selection.start ||
            selection.end > document.text.length
          )
            throw new Error("Select a Java identifier in the synchronized project before review.");
          const name = document.text.slice(selection.start, selection.end);
          const splitsSurrogatePair = (offset: number) =>
            offset > 0 &&
            offset < document.text.length &&
            document.text.charCodeAt(offset - 1) >= 0xd800 &&
            document.text.charCodeAt(offset - 1) <= 0xdbff &&
            document.text.charCodeAt(offset) >= 0xdc00 &&
            document.text.charCodeAt(offset) <= 0xdfff;
          if (splitsSurrogatePair(selection.start) || splitsSurrogatePair(selection.end))
            throw new Error("The selected range splits a Unicode character.");
          current.editor.reviewSavedBuffers();
          current.refactoring.open(
            operation,
            {
              kind: operation === "inline-variable" ? "local-binding" : "member",
              path,
              identity: name,
              selection: { ...selection },
            },
            undefined,
            undefined,
            { path: document.path, text: document.text },
          );
          return;
        }
        if (
          operation === "extract-constant" ||
          operation === "extract-variable" ||
          operation === "extract-method" ||
          operation === "extract-parameter" ||
          operation === "extract-field"
        ) {
          if (
            !current.sdkSelected ||
            !current.projectContextAvailable ||
            !javaContextRefactoringOffered(current.capabilities, operation, "preview") ||
            !selection ||
            !Number.isSafeInteger(selection.start) ||
            !Number.isSafeInteger(selection.end) ||
            selection.start < 0 ||
            selection.end <= selection.start ||
            selection.end > document.text.length
          )
            throw new Error(
              operation === "extract-method"
                ? "Select Java statements in the synchronized project before reviewing Extract Method."
                : "Select a Java expression in the synchronized project before review.",
            );
          const splitsSurrogatePair = (offset: number) =>
            offset > 0 &&
            offset < document.text.length &&
            document.text.charCodeAt(offset - 1) >= 0xd800 &&
            document.text.charCodeAt(offset - 1) <= 0xdbff &&
            document.text.charCodeAt(offset) >= 0xdc00 &&
            document.text.charCodeAt(offset) <= 0xdfff;
          if (splitsSurrogatePair(selection.start) || splitsSurrogatePair(selection.end))
            throw new Error("The selected range splits a Unicode character.");
          current.editor.reviewSavedBuffers();
          current.refactoring.open(
            operation,
            { kind: "file", path, identity: path, selection: { ...selection } },
            undefined,
            operation === "extract-method"
              ? { operation, methodName: "" }
              : { operation, name: "" },
            { path: document.path, text: document.text },
          );
          return;
        }
        const cursorAction =
          operation === "rename-class" ||
          operation === "rename-member" ||
          operation === "add-method-parameter" ||
          operation === "remove-method-parameter" ||
          operation === "change-method-signature" ||
          operation === "reorder-method-parameters" ||
          operation === "change-method-parameter-type" ||
          operation === "inline-method" ||
          operation === "introduce-parameter-object" ||
          operation === "extract-delegate" ||
          operation === "extract-interface" ||
          operation === "extract-superclass" ||
          operation === "pull-up-member" ||
          operation === "push-down-member" ||
          operation === "move-member";
        const cursorMutation =
          cursorAction || operation === "make-static" || (operation === "make-public" || operation === "change-field-type");
        if (cursorMutation) {
          const currentCursor = current.getCursorPosition(document.path);
          if (
            !current.sdkSelected ||
            !current.projectContextAvailable ||
            !cursor ||
            !Number.isInteger(cursor.line) ||
            !Number.isInteger(cursor.column) ||
            cursor.line < 1 ||
            cursor.column < 1 ||
            !currentCursor ||
            currentCursor.line !== cursor.line ||
            currentCursor.column !== cursor.column ||
            (operation === "move-member" && !current.javaWorkspaceSymbolsAvailable) ||
            (operation === "add-method-parameter" ||
            operation === "remove-method-parameter" ||
            operation === "change-method-signature" ||
            operation === "reorder-method-parameters" ||
            operation === "change-method-parameter-type" ||
            operation === "inline-method" ||
            operation === "introduce-parameter-object" ||
            operation === "extract-delegate" ||
            operation === "make-static" ||
            (operation === "make-public" || operation === "change-field-type") ||
            operation === "extract-interface" ||
            operation === "extract-superclass" ||
            operation === "pull-up-member" ||
            operation === "push-down-member" ||
            operation === "move-member"
              ? !javaMutationSelectionOffered(current.capabilities) ||
                !javaContextRefactoringOffered(current.capabilities, operation, "preview")
              : !javaEditorRefactoringPreviewOffered(current.capabilities, operation))
          )
            throw new Error("RefactorKit cursor selection is unavailable or obsolete.");
        }
        const capability = current.capabilities?.generalRefactoring;
        const currentProjectContextRoute = Boolean(
          current.sdkSelected &&
          current.projectContextAvailable &&
          javaContextRefactoringOffered(current.capabilities, operation, "preview"),
        );
        if (
          !cursorMutation &&
          (currentProjectContextRoute
            ? !javaContextRefactoringOffered(current.capabilities, operation, "preview")
            : !capability?.supported ||
              !capability.preview ||
              !capability.operations.includes(operation))
        )
          throw new Error("RefactorKit does not advertise this Java file operation.");
        if (
          operation === "add-method-parameter" ||
          operation === "remove-method-parameter" ||
          operation === "change-method-signature" ||
          operation === "reorder-method-parameters" ||
          operation === "change-method-parameter-type" ||
          operation === "inline-method" ||
          operation === "introduce-parameter-object" ||
          operation === "extract-delegate" ||
          operation === "make-static" ||
          (operation === "make-public" || operation === "change-field-type") ||
          operation === "extract-interface" ||
          operation === "extract-superclass" ||
          operation === "pull-up-member" ||
          operation === "push-down-member" ||
          operation === "move-member"
        )
          current.editor.reviewSavedBuffers();
        else if (!cursorMutation && !currentProjectContextRoute)
          current.editor.reviewSavedBuffers();
        if (cursorMutation) {
          const selectionOffset =
            (operation === "rename-member" &&
              javaMutationSelectionOffered(current.capabilities) &&
              currentProjectContextRoute) ||
            operation === "add-method-parameter" ||
            operation === "remove-method-parameter" ||
            operation === "change-method-signature" ||
            operation === "reorder-method-parameters" ||
            operation === "change-method-parameter-type" ||
            operation === "inline-method" ||
            operation === "introduce-parameter-object" ||
            operation === "extract-delegate" ||
            operation === "make-static" ||
            (operation === "make-public" || operation === "change-field-type") ||
            operation === "extract-interface" ||
            operation === "extract-superclass" ||
            operation === "pull-up-member" ||
            operation === "push-down-member" ||
            operation === "move-member"
              ? offsetAt(document.text, cursor!.line, cursor!.column)
              : undefined;
          const target = {
            kind:
              operation === "rename-class" ||
              operation === "extract-interface" ||
              operation === "extract-superclass"
                ? ("class" as const)
                : ("member" as const),
            path,
            identity: "@cursor",
            ...(selectionOffset !== undefined
              ? { selection: { start: selectionOffset, end: selectionOffset } }
              : {}),
          };
          const editorCursor = { path, line: cursor!.line, column: cursor!.column };
          if (operation === "extract-interface")
            current.refactoring.open(operation, target, editorCursor, {
              operation,
              interfaceName: "",
              methodName: "",
            });
          else if (operation === "extract-superclass")
            current.refactoring.open(operation, target, editorCursor, {
              operation,
              superclassName: "",
              methodName: "",
            });
          else if (operation === "pull-up-member")
            current.refactoring.open(operation, target, editorCursor, {
              operation,
              targetType: "",
            });
          else if (operation === "push-down-member")
            current.refactoring.open(operation, target, editorCursor, {
              operation,
              targetType: "",
            });
          else if (operation === "move-member")
            current.refactoring.open(operation, target, editorCursor, {
              operation,
              targetType: "",
              targetPath: "",
              targetPosition: { line: 0, character: 0 },
            });
          else current.refactoring.open(operation, target, editorCursor);
        } else current.refactoring.open(operation, { kind: "file", path, identity: path });
      },
      reviewLsp: dependencies.reviewLsp,
    };
  }, [workspaceId, generation, rootPath, key, dependencies.reviewLsp]);
}

function offsetAt(text: string, line: number, column: number): number {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1)
    throw new Error("The Java cursor position is invalid.");
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line) {
    const nextLf = text.indexOf("\n", offset);
    if (nextLf < 0) throw new Error("The Java cursor position is outside the saved source.");
    offset = nextLf + 1;
    currentLine += 1;
  }
  const lineEnd = text.indexOf("\n", offset);
  const max =
    (lineEnd < 0 ? text.length : lineEnd) -
    (lineEnd > offset && text[lineEnd - 1] === "\r" ? 1 : 0);
  const point = offset + column - 1;
  if (point > max) throw new Error("The Java cursor position is outside the saved source.");
  return point;
}
