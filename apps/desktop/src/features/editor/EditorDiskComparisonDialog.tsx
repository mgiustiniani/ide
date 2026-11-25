import type { EditorDiskComparison } from "@ide/contracts";
import { useEffect, useId, useRef } from "react";

export interface EditorDiskComparisonDialogProps {
  comparison: EditorDiskComparison;
  busy: boolean;
  onCancel(): void;
  onUseDiskVersion(): void;
}

export function EditorDiskComparisonDialog({
  comparison,
  busy,
  onCancel,
  onUseDiskVersion,
}: EditorDiskComparisonDialogProps) {
  return (
    <EditorTextComparisonDialog
      title="Compare with disk"
      filePath={comparison.filePath}
      before={comparison.bufferContent}
      after={comparison.diskSnapshot.content}
      selectedLabel="Inspected disk version"
      description={`${comparison.diskSnapshot.changedSinceRead ? "The disk file changed since it was loaded or saved. " : "No external disk change was detected. "}Inspection has not saved or discarded any edits. Using the inspected disk version replaces this buffer and discards its unsaved edits; other buffers remain unchanged.`}
      confirmLabel="Discard buffer edits and use disk version"
      disabled={busy}
      onCancel={onCancel}
      onConfirm={onUseDiskVersion}
    />
  );
}

export function EditorTextComparisonDialog({
  title,
  filePath,
  before,
  after,
  selectedLabel,
  description,
  confirmLabel,
  disabled,
  onCancel,
  onConfirm,
}: {
  title: string;
  filePath: string;
  before: string;
  after: string;
  selectedLabel: string;
  description: string;
  confirmLabel: string;
  disabled: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[90vh] w-[90vw] overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4 text-[var(--text-primary)] shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Tab") {
            const focusable = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>("*") ?? [],
            ).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="break-all">{filePath}</p>
        <p id={descriptionId}>{description}</p>
        <div className="my-3 grid grid-cols-2 gap-3">
          <section aria-label="Current editor buffer">
            <h3>Current editor buffer</h3>
            <pre tabIndex={0} className="max-h-[50vh] overflow-auto whitespace-pre border p-2">
              {before}
            </pre>
          </section>
          <section aria-label={selectedLabel}>
            <h3>{selectedLabel}</h3>
            <pre tabIndex={0} className="max-h-[50vh] overflow-auto whitespace-pre border p-2">
              {after}
            </pre>
          </section>
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel}>
            Keep editor buffer
          </button>
          <button type="button" disabled={disabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
