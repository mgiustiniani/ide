import type {
  JavaEditorWorkspaceEdit,
  JavaLspRefactoringPreview,
  JavaLspRefactoringPreviewRequest,
} from "@ide/contracts";
import type { EditorViewModel, JavaLspRefactoringPort } from "@ide/web-core";
import { useState } from "react";
import { stageEditorTransaction } from "@ide/web-core/view-models/editor-transaction";

export type JavaLspEditorOperation =
  "lsp-change-visibility" | "lsp-extract-parameter" | "lsp-extract-superclass";
type Cursor = { line: number; column: number };
export type JavaLspRefactoringIntent = {
  operation: JavaLspEditorOperation;
  document: { path: string; text: string };
  cursor?: Cursor;
  selection?: { start: number; end: number };
};

function sameDocuments(
  left: readonly { path: string; text: string; version: number }[],
  right: readonly { path: string; text: string; version: number }[],
) {
  return (
    left.length === right.length &&
    left.every((document, index) => {
      const other = right[index];
      return (
        document.path === other.path &&
        document.text === other.text &&
        document.version === other.version
      );
    })
  );
}

function positionAt(text: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new Error("The Java selection is obsolete.");
  const lines = text.slice(0, offset).split("\n");
  const last = lines.at(-1) ?? "";
  if (last.endsWith("\r")) throw new Error("The Java selection ends inside a line ending.");
  return { line: lines.length - 1, character: last.length };
}

function cursorPosition(cursor: Cursor | undefined) {
  if (
    !cursor ||
    !Number.isSafeInteger(cursor.line) ||
    !Number.isSafeInteger(cursor.column) ||
    cursor.line < 1 ||
    cursor.column < 1
  )
    throw new Error("Place the cursor on the Java declaration before previewing.");
  return { line: cursor.line - 1, character: cursor.column - 1 };
}

export function JavaLspRefactoringDialog(props: {
  intent: JavaLspRefactoringIntent;
  authority: { workspaceId: string; generation: number; projectPath: string; sdkHome: string };
  port: JavaLspRefactoringPort;
  editor: Pick<EditorViewModel, "captureEditorBuffers" | "beginEditorTransaction">;
  getContext(): {
    workspaceId: string | null;
    generation: number;
    isSwitching: boolean;
    projectPath: string;
  };
  onCancel(): void;
  onApplied(): void;
}) {
  const [parameterName, setParameterName] = useState("value");
  const [superclassName, setSuperclassName] = useState("");
  const [methodName, setMethodName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    preview: JavaLspRefactoringPreview;
    projectPath: string;
    sdkHome: string;
    sourceDocuments: { path: string; text: string; version: number }[];
    changes: ReturnType<typeof stageEditorTransaction>["changes"];
  } | null>(null);
  const current = () => {
    const context = props.getContext();
    return (
      !context.isSwitching &&
      context.workspaceId === props.authority.workspaceId &&
      context.generation === props.authority.generation &&
      context.projectPath === props.authority.projectPath
    );
  };

  const request = (
    documents: { path: string; text: string; version: number }[],
    sdkHome: string,
  ): JavaLspRefactoringPreviewRequest => {
    const base = {
      workspaceId: props.authority.workspaceId,
      generation: props.authority.generation,
      projectPath: props.authority.projectPath,
      sdkHome,
      file: props.intent.document.path,
      documents,
    };
    if (props.intent.operation === "lsp-change-visibility")
      return {
        ...base,
        operation: "changeVisibility",
        position: cursorPosition(props.intent.cursor),
        visibility: "public",
      };
    if (props.intent.operation === "lsp-extract-parameter") {
      const selection = props.intent.selection;
      if (!selection || selection.end <= selection.start)
        throw new Error("Select a Java expression before previewing Extract Parameter.");
      const source = documents.find((document) => document.path === props.intent.document.path);
      if (!source || source.text !== props.intent.document.text)
        throw new Error("The Java selection changed; repeat the operation from the editor.");
      return {
        ...base,
        operation: "extractParameter",
        range: {
          start: positionAt(source.text, selection.start),
          end: positionAt(source.text, selection.end),
        },
        name: parameterName.trim(),
      };
    }
    const source = documents.find((document) => document.path === props.intent.document.path);
    if (!source || source.text !== props.intent.document.text)
      throw new Error("The Java cursor changed; repeat the operation from the editor.");
    return {
      ...base,
      operation: "extractSuperclass",
      position: cursorPosition(props.intent.cursor),
      superclassName: superclassName.trim(),
      methodName: methodName.trim(),
    };
  };

  const preview = async () => {
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      if (!current()) throw new Error("The Java workspace changed; reopen this operation.");
      const projectPath = props.authority.projectPath;
      const sdkHome = props.authority.sdkHome;
      const capture = props.editor.captureEditorBuffers();
      const source = capture.documents.find(
        (document) => document.path === props.intent.document.path,
      );
      if (!source || source.text !== props.intent.document.text)
        throw new Error("The Java source changed; repeat the operation from the editor.");
      const requestDocuments = capture.documents
        .filter(
          (document) =>
            document.path.toLowerCase().endsWith(".java") &&
            !("isNew" in document && document.isNew),
        )
        .map(({ path, text, version }) => ({ path, text, version }));
      if (!requestDocuments.some((document) => document.path === props.intent.document.path))
        throw new Error(
          "Save the selected Java source before requesting a RefactorKit LSP preview.",
        );
      const proposal = await props.port.preview(request(requestDocuments, sdkHome));
      capture.verify();
      if (
        !current() ||
        props.authority.projectPath !== projectPath ||
        props.authority.sdkHome !== sdkHome
      )
        throw new Error(
          "The Java workspace, project root, or project JDK changed while RefactorKit was preparing the preview.",
        );
      const staged = stageEditorTransaction(
        capture.documents,
        proposal.workspaceEdit as JavaEditorWorkspaceEdit,
      );
      if (!staged.changes.length)
        throw new Error("RefactorKit returned no editor changes to review.");
      setReview({
        preview: proposal,
        projectPath,
        sdkHome,
        sourceDocuments: capture.documents,
        changes: staged.changes,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "RefactorKit could not preview this Java refactoring.",
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    let transaction: ReturnType<EditorViewModel["beginEditorTransaction"]> | undefined;
    try {
      if (
        !current() ||
        review.projectPath !== props.authority.projectPath ||
        review.sdkHome !== props.authority.sdkHome
      )
        throw new Error(
          "The workspace, project root, or project JDK changed after review; preview the refactoring again.",
        );
      transaction = props.editor.beginEditorTransaction();
      if (!sameDocuments(transaction.documents, review.sourceDocuments))
        throw new Error("Editor buffers changed after review; preview the refactoring again.");
      const staged = transaction.stage(review.preview.workspaceEdit as JavaEditorWorkspaceEdit);
      if (!staged.changes.length)
        throw new Error("The reviewed Java edit is no longer applicable.");
      transaction.commit(staged);
      props.onApplied();
    } catch (cause) {
      if (transaction?.committed) props.onApplied();
      else {
        setReview(null);
        setError(
          cause instanceof Error ? cause.message : "The reviewed Java edit could not be applied.",
        );
      }
    } finally {
      transaction?.release();
      setBusy(false);
    }
  };

  const inputChanged = (change: () => void) => {
    change();
    setReview(null);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
    >
      <section
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg border border-slate-600 bg-slate-950 p-5 text-slate-100 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="java-lsp-refactoring-title"
      >
        <h2 id="java-lsp-refactoring-title" className="text-lg font-semibold">
          Review RefactorKit Java refactoring
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Preview changes are kept in editor buffers. Saving remains a separate editor action.
        </p>
        {props.intent.operation === "lsp-change-visibility" ? (
          <p className="mt-4 text-sm">Promote the selected method to public.</p>
        ) : null}
        {props.intent.operation === "lsp-extract-parameter" ? (
          <label className="mt-4 block text-sm">
            Parameter name
            <input
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 p-2"
              value={parameterName}
              disabled={busy || !!review}
              onChange={(event) => inputChanged(() => setParameterName(event.target.value))}
              maxLength={128}
            />
          </label>
        ) : null}
        {props.intent.operation === "lsp-extract-superclass" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Superclass name
              <input
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 p-2"
                value={superclassName}
                disabled={busy || !!review}
                onChange={(event) => inputChanged(() => setSuperclassName(event.target.value))}
                maxLength={128}
              />
            </label>
            <label className="text-sm">
              Method name to move
              <input
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-900 p-2"
                value={methodName}
                disabled={busy || !!review}
                onChange={(event) => inputChanged(() => setMethodName(event.target.value))}
                maxLength={128}
              />
            </label>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded border border-red-500/50 bg-red-950/40 p-2 text-sm"
          >
            {error}
          </p>
        ) : null}
        {review ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm">
              {review.preview.summary} · RefactorKit {review.preview.providerVersion}
            </p>
            {review.changes.map((change) => (
              <details key={change.path} open className="rounded border border-slate-700 p-3">
                <summary className="cursor-pointer font-medium">
                  {change.created ? `Create ${change.path}` : change.path}
                </summary>
                {change.created ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs">
                    {change.after}
                  </pre>
                ) : (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-slate-400">Before</h3>
                      <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs">
                        {change.before}
                      </pre>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-slate-400">After</h3>
                      <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs">
                        {change.after}
                      </pre>
                    </div>
                  </div>
                )}
              </details>
            ))}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-2 text-sm"
            disabled={busy}
            onClick={props.onCancel}
          >
            Cancel
          </button>
          {!review ? (
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={busy}
              onClick={() => void preview()}
            >
              {busy ? "Preparing preview…" : "Preview changes"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="rounded border border-slate-600 px-3 py-2 text-sm"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Edit request
              </button>
              <button
                type="button"
                className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={busy}
                onClick={apply}
              >
                {busy ? "Applying…" : "Apply to editor buffers"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
