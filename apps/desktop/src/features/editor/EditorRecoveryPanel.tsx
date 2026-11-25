import { useState } from "react";
import type { EditorRecoveryEntry } from "@ide/contracts";
import type { EditorRecoveryController } from "./useEditorRecoveryController";
import { EditorTextComparisonDialog } from "./EditorDiskComparisonDialog";

export function EditorRecoveryPanel({
  controller,
  activeFilePath,
  onClose,
}: {
  controller: EditorRecoveryController;
  activeFilePath: string | null;
  onClose(): void;
}) {
  const [removing, setRemoving] = useState<EditorRecoveryEntry | null>(null);
  const [restoring, setRestoring] = useState(false);
  const visible = controller.entries.filter(
    (entry) =>
      (entry.kind === "draft" && !entry.currentSession) || entry.filePath === activeFilePath,
  );
  return (
    <section
      aria-label="Recovery and local history"
      className="max-h-[45vh] overflow-auto border-b border-[var(--border-default)] bg-[var(--surface-panel)] p-3 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2>Recovery and local history</h2>
        <button type="button" onClick={onClose}>
          Close recovery panel
        </button>
      </div>
      <p>
        Private, unencrypted checkpoints, not a backup of every keystroke or external edit.
        Restoring changes only the editor buffer; saving remains explicit. Older history is bounded;
        pending recovery drafts are not silently evicted.
      </p>
      <p role="status">Checkpoint status: {controller.status}</p>
      {controller.error && <p role="alert">{controller.error}</p>}
      <div className="flex gap-3 py-2">
        <button
          type="button"
          onClick={() => {
            void controller.flush();
          }}
        >
          Checkpoint now
        </button>
        <button
          type="button"
          onClick={() => {
            void controller.refresh();
          }}
        >
          Refresh checkpoints
        </button>
      </div>
      {visible.length === 0 ? (
        <p>No previous-session drafts or checkpoints for the active file.</p>
      ) : (
        <ul>
          {visible.map((entry) => (
            <li
              key={entry.id}
              data-checkpoint-id={entry.id}
              className="my-2 flex flex-wrap items-center gap-3"
            >
              <span className="break-all">{entry.filePath}</span>
              <span>
                {entry.kind === "draft"
                  ? entry.currentSession
                    ? "Current draft"
                    : "Recoverable draft"
                  : "Local history"}{" "}
                — {new Date(entry.capturedAt).toLocaleString()} — {entry.byteLength} bytes
              </span>
              <button
                type="button"
                onClick={() => {
                  void controller.prepareReview(entry);
                }}
              >
                Review {entry.filePath}
              </button>
              <button
                type="button"
                disabled={entry.kind === "draft" && entry.currentSession}
                onClick={() => setRemoving(entry)}
              >
                Remove checkpoint
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <div role="group" aria-label="Confirm checkpoint removal">
          <p>
            Permanently remove the checkpoint for {removing.filePath}? This cannot be undone; source
            files and buffers are unchanged.
          </p>
          <button type="button" onClick={() => setRemoving(null)}>
            Keep checkpoint
          </button>
          <button
            type="button"
            onClick={() => {
              const entry = removing;
              setRemoving(null);
              void controller.remove(entry);
            }}
          >
            Confirm permanent removal
          </button>
        </div>
      )}
      {controller.review && (
        <EditorTextComparisonDialog
          title="Review recovered buffer"
          filePath={controller.review.snapshot.filePath}
          before={
            controller.review.replacement?.before ??
            "File unavailable; no buffer replacement is permitted."
          }
          after={controller.review.snapshot.content}
          selectedLabel="Recovery checkpoint"
          description="Replacing the reviewed buffer discards its current edits and marks the recovered version unsaved. It does not write the source file or change its save revision. The checkpoint remains available until explicitly removed. You can select and copy checkpoint text if its source file is missing."
          confirmLabel="Replace reviewed buffer with recovered version"
          disabled={restoring || !controller.review.replacement}
          onCancel={controller.cancelReview}
          onConfirm={() => {
            setRestoring(true);
            void controller.restore().finally(() => setRestoring(false));
          }}
        />
      )}
    </section>
  );
}
