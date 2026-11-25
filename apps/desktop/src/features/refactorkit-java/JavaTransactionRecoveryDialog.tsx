import { useEffect, useRef } from "react";
import type { JavaEditorTransaction } from "@ide/contracts";
import type { JavaTransactionRecoveryState } from "./useJavaTransactionRecoveryController";

const labels: Record<JavaEditorTransaction["status"], string> = {
  prepared: "Awaiting application",
  applied: "Applied",
  "undo-prepared": "Restoration prepared",
  undone: "Restored",
  aborted: "Original drafts retained",
  "recovery-required": "Needs inspection",
};
export function JavaTransactionRecoveryDialog({
  state,
  onRefresh,
  onReview,
  onRestore,
  onClose,
}: {
  state: JavaTransactionRecoveryState;
  onRefresh(): void;
  onReview(entry: JavaEditorTransaction): void;
  onRestore(): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  const busy = ["loading", "reviewing", "restoring"].includes(state.phase);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Java draft transactions"
        className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 text-[var(--text-primary)]"
      >
        <h2 className="text-lg font-semibold">Java draft transactions</h2>
        <p className="my-3 text-sm">
          Review the original drafts before restoring a Java refactoring. Current buffers are
          preserved during review. Source content is not saved by restoration.
        </p>
        {state.message && (
          <p role={state.phase === "error" ? "alert" : "status"} className="my-3">
            {state.message}
          </p>
        )}
        {busy && (
          <p role="status">
            {state.phase === "loading"
              ? "Loading durable transactions…"
              : state.phase === "reviewing"
                ? "Inspecting saved paths and preparing restoration…"
                : "Restoring the reviewed original drafts…"}
          </p>
        )}
        {state.phase === "ready" && !state.entries.length && (
          <p>No durable Java draft transactions found in the selected project.</p>
        )}
        <ul className="space-y-3">
          {state.entries.map((entry) => (
            <li
              key={entry.transactionId}
              className="rounded border border-[var(--border-default)] p-3"
            >
              <p className="font-mono text-xs">{entry.transactionId}</p>
              <p>{labels[entry.status]}</p>
              <p className="break-all text-xs">Project JDK: {entry.sdkHome}</p>
              {entry.documents?.map((d) => (
                <p className="break-all text-xs" key={d.originalPath}>
                  {d.originalPath}
                  {d.finalPath !== d.originalPath ? ` → ${d.finalPath}` : ""}
                </p>
              ))}
              <button
                type="button"
                disabled={
                  busy ||
                  !entry.documents?.length ||
                  entry.status === "undone" ||
                  entry.status === "aborted"
                }
                onClick={() => onReview(entry)}
                className="mt-2"
              >
                Review restoration
              </button>
              {!entry.documents?.length && (
                <p className="text-xs">
                  Update RefactorKit to obtain this transaction's complete document inventory.
                </p>
              )}
            </li>
          ))}
        </ul>
        {state.review && (
          <section aria-label="Reviewed original drafts" className="my-4 space-y-4">
            <h3 className="font-semibold">Original drafts to restore</h3>
            {state.review.workspaceEdit.documentChanges
              .filter((change) => change.kind === "rename")
              .map(
                (change, index) =>
                  change.kind === "rename" && (
                    <p className="break-all text-sm" key={`file:${index}`}>
                      Saved file: {change.oldPath} → {change.path}. Its saved content will remain
                      unchanged.
                    </p>
                  ),
              )}
            {state.review.alignments.map((d) => (
              <p className="break-all text-sm" key={d.oldPath}>
                The retained tab at {d.oldPath} will first be associated with the existing saved
                file at {d.path}.
              </p>
            ))}
            {state.review.changes.map((change, index) => (
              <article key={index} className="rounded border border-[var(--border-default)] p-3">
                <p className="break-all">
                  {change.oldPath}
                  {change.path !== change.oldPath ? ` → ${change.path}` : ""}
                </p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <h4>Current draft</h4>
                    <pre className="max-h-72 overflow-auto whitespace-pre">{change.before}</pre>
                  </div>
                  <div>
                    <h4>Original draft</h4>
                    <pre className="max-h-72 overflow-auto whitespace-pre">{change.after}</pre>
                  </div>
                </div>
              </article>
            ))}
            {!state.review.changes.length && (
              <p>
                The drafts already contain their original text. Restoration will reconcile the
                verified saved paths and confirm the transaction.
              </p>
            )}
            <button type="button" disabled={state.phase !== "review"} onClick={onRestore}>
              Restore original drafts
            </button>
          </section>
        )}
        <div className="mt-4 flex gap-4">
          <button type="button" disabled={busy} onClick={onRefresh}>
            Refresh transactions
          </button>
          <button type="button" disabled={state.phase === "restoring"} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
