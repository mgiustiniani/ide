import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEditorLaunch } from "./Editor";

/** The editor supplies an immutable source identity; the application/provider choose launch candidates. */
export function registerJavaLaunch(options: {
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  filePath: string;
  launch: JavaEditorLaunch;
  getCurrentLaunch(): JavaEditorLaunch | undefined;
  onStatus(message: string | null): void;
}): Monaco.IDisposable {
  const { editor, model, launch } = options;
  let disposed = false;
  const registrations = (["run", "debug"] as const).flatMap((operation, index) =>
    (["file", "cursor"] as const).map((mode, modeIndex) =>
      editor.addAction({
        id: `ide.java.${operation}-main-from-${mode}`,
        label: `${operation === "run" ? "Run" : "Debug"} main ${mode === "file" ? "from this file" : "at cursor"}…`,
        precondition: "editorLangId == java && !editorReadonly",
        contextMenuGroupId: "1_execution",
        contextMenuOrder: 1 + index + modeIndex / 2,
        async run() {
          if (disposed) return;
          if (model.isDisposed() || editor.getModel() !== model) {
            options.onStatus("This Java source launch action is unavailable or stale.");
            return;
          }
          const version = model.getVersionId();
          const cursor = mode === "cursor" ? editor.getPosition() : null;
          if (mode === "cursor" && !cursor) return;
          const current = () => {
            const active = options.getCurrentLaunch();
            return (
              !disposed &&
              !model.isDisposed() &&
              editor.getModel() === model &&
              model.getVersionId() === version &&
              (!cursor ||
                (editor.getPosition()?.lineNumber === cursor.lineNumber &&
                  editor.getPosition()?.column === cursor.column)) &&
              active?.available === true &&
              active.context.workspaceId === launch.context.workspaceId &&
              active.context.generation === launch.context.generation
            );
          };
          if (!current()) {
            options.onStatus("This Java source launch action is unavailable or stale.");
            return;
          }
          options.onStatus(null);
          try {
            await options.getCurrentLaunch()!.run(
              {
                path: options.filePath,
                text: model.getValue(),
                version,
                ...(cursor
                  ? { position: { line: cursor.lineNumber - 1, character: cursor.column - 1 } }
                  : {}),
              },
              current,
              operation,
            );
          } catch (error) {
            if (current())
              options.onStatus(
                error instanceof Error ? error.message : "The Java source could not be launched.",
              );
          }
        },
      }),
    ),
  );
  return {
    dispose() {
      disposed = true;
      registrations.forEach((registration) => registration.dispose());
    },
  };
}
