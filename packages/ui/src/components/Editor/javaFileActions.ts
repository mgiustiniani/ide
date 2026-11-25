import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEditorFileActions } from "./Editor";

export function registerJavaFileActions(options: {
  api: typeof Monaco;
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  actions: JavaEditorFileActions;
  getCurrentActions(): JavaEditorFileActions | undefined;
  onStatus(message: string | null): void;
}): Monaco.IDisposable {
  let disposed = false;
  const { api, editor, model, actions } = options;
  const registrations = (
    [
      ["format-file", "Review Java formatting", undefined],
      [
        "organize-imports",
        "Review Java imports",
        api.KeyMod.Shift | api.KeyMod.Alt | api.KeyCode.KeyO,
      ],
      ["rename-class", "Review type rename at cursor", api.KeyMod.Shift | api.KeyCode.F6],
      ["rename-member", "Review member rename at cursor", api.KeyCode.F2],
      ["add-method-parameter", "Review adding a Java method parameter", undefined],
      ["remove-method-parameter", "Review removing a Java method parameter", undefined],
      ["change-method-signature", "Review Java Parameter Rename", undefined],
      ["reorder-method-parameters", "Review Java method parameter order", undefined],
      ["make-static", "Review making the Java method static", undefined],
      ["make-public", "Review making the Java method public", undefined],
      ["change-field-type", "Review Java field type", undefined],
      ["change-method-parameter-type", "Review Java parameter type", undefined],
      ["inline-variable", "Review inlining the selected Java local", undefined],
      ["inline-method", "Review Java Inline Method at cursor", undefined],
      ["introduce-parameter-object", "Review Java Introduce Parameter Object at cursor", undefined],
      ["extract-delegate", "Review Java Extract Delegate at cursor", undefined],
      ["inline-constant", "Review inlining the selected Java constant", undefined],
      ["extract-constant", "Review Java constant extraction", undefined],
      ["extract-variable", "Review Java variable extraction", undefined],
      ["extract-method", "Review Java method extraction", undefined],
      ["extract-parameter", "Review Java parameter extraction", undefined],
      ["extract-field", "Review Java field extraction", undefined],
      ["extract-interface", "Review Java interface extraction at cursor", undefined],
      ["extract-superclass", "Review Java superclass extraction at cursor", undefined],
      ["move-member", "Review Java Move Member at cursor", undefined],
      ["lsp-change-visibility", "Review Java visibility change at cursor", undefined],
      ["lsp-extract-parameter", "Review Java Extract Parameter", undefined],
      ["lsp-extract-superclass", "Review Java Extract Superclass at cursor", undefined],
    ] as const
  )
    .filter(([operation]) => actions.operations.includes(operation))
    .map(([operation, label, keybinding], index) =>
      editor.addAction({
        id: `ide.java.${operation}`,
        label,
        ...(keybinding ? { keybindings: [keybinding], keybindingContext: "editorTextFocus" } : {}),
        precondition: "editorLangId == java && !editorReadonly",
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 2 + index,
        run() {
          const current = options.getCurrentActions();
          if (disposed || model.isDisposed() || editor.getModel() !== model) return;
          if (
            !current ||
            current.context.workspaceId !== actions.context.workspaceId ||
            current.context.generation !== actions.context.generation ||
            !current.operations.includes(operation)
          ) {
            options.onStatus("This Java file action is stale or no longer available.");
            return;
          }
          try {
            const document = {
              path: options.filePath,
              text: model.getValue(),
              version: model.getVersionId(),
            };
            if (
              operation === "lsp-change-visibility" ||
              operation === "lsp-extract-superclass" ||
              operation === "lsp-extract-parameter"
            ) {
              if (!current.reviewLsp) {
                options.onStatus("RefactorKit's client-managed Java preview is unavailable.");
                return;
              }
              const position = editor.getPosition();
              if (operation === "lsp-extract-parameter") {
                const selection = editor.getSelection();
                if (!selection || selection.isEmpty()) {
                  options.onStatus("Select a Java expression before reviewing Extract Parameter.");
                  return;
                }
                current.reviewLsp(operation, document, undefined, {
                  start: model.getOffsetAt(selection.getStartPosition()),
                  end: model.getOffsetAt(selection.getEndPosition()),
                });
              } else {
                current.reviewLsp(
                  operation,
                  document,
                  position ? { line: position.lineNumber, column: position.column } : undefined,
                );
              }
              options.onStatus(null);
              return;
            }
            if (
              operation === "rename-class" ||
              operation === "rename-member" ||
              operation === "add-method-parameter" ||
              operation === "remove-method-parameter" ||
              operation === "change-method-signature" ||
              operation === "reorder-method-parameters" ||
              operation === "make-static" ||
              (operation === "make-public" || operation === "change-field-type") ||
              operation === "inline-method" ||
              operation === "introduce-parameter-object" ||
              operation === "extract-delegate" ||
              operation === "change-method-parameter-type" ||
              operation === "extract-interface" ||
              operation === "extract-superclass" ||
              operation === "move-member"
            ) {
              const position = editor.getPosition();
              current.review(
                operation,
                document,
                position ? { line: position.lineNumber, column: position.column } : undefined,
              );
            } else if (
              operation === "extract-constant" ||
              operation === "extract-variable" ||
              operation === "extract-method" ||
              operation === "extract-parameter" ||
              operation === "extract-field" ||
              operation === "inline-variable" ||
              operation === "inline-constant"
            ) {
              const selection = editor.getSelection();
              if (!selection || selection.isEmpty()) {
                options.onStatus(
                  operation === "inline-variable" || operation === "inline-constant"
                    ? "Select the Java identifier to inline."
                    : operation === "extract-method"
                      ? "Select Java statements before reviewing Extract Method."
                      : "Select a Java expression before reviewing extraction.",
                );
                return;
              }
              current.review(operation, document, undefined, {
                start: model.getOffsetAt(selection.getStartPosition()),
                end: model.getOffsetAt(selection.getEndPosition()),
              });
            } else current.review(operation, document);
            options.onStatus(null);
          } catch (cause) {
            options.onStatus(
              cause instanceof Error ? cause.message : "Java file review is unavailable.",
            );
          }
        },
      }),
    );
  return {
    dispose() {
      disposed = true;
      registrations.forEach((registration) => registration.dispose());
    },
  };
}
