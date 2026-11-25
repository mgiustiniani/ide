import type {
  JavaEditorTransaction,
  JavaEditorTransactionRequest,
  JavaEditorWorkspaceEdit,
} from "@ide/contracts";
import type { RefactorKitPort } from "../ports/refactorkit-port";
import type { EditorViewModel } from "../view-models/editor-view-model";
import { stageEditorTransaction } from "../view-models/editor-transaction";
import {
  executeJavaEditorRefactoring,
  JavaEditorTransactionError,
  type JavaEditorRefactoringOutcome,
} from "./java-editor-refactoring";

type Editor = Pick<
  EditorViewModel,
  "captureEditorBuffers" | "beginEditorTransaction" | "openFile" | "inspectSourceRevision"
>;
type Authority = Omit<JavaEditorTransactionRequest, "phase" | "documents">;
export interface JavaEditorRecoveryReview {
  transaction: JavaEditorTransaction;
  authority: Authority;
  workspaceEdit: JavaEditorWorkspaceEdit;
  changes: JavaEditorRefactoringOutcome["changes"];
  alignments: readonly { oldPath: string; path: string; revision: string }[];
  restoredBuffers: readonly { path: string; text: string; isDirty: boolean }[];
  documentLineage: readonly { originalPath: string; finalPath: string }[];
  verify(): void;
}
const issued = new WeakSet<JavaEditorRecoveryReview>();
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function digest(text: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function physicalPath(
  editor: Editor,
  authority: Authority,
  document: NonNullable<JavaEditorTransaction["documents"]>[number],
) {
  const paths = [...new Set([document.originalPath, document.finalPath])];
  const present: string[] = [];
  for (const path of paths) {
    const status = await editor.inspectSourceRevision(
      authority,
      path,
      document.originalSavedContentSha256,
    );
    if (status.status === "unchanged") present.push(path);
    else if (status.status !== "missing")
      throw new Error(
        "A transaction source changed or cannot be inspected. No draft can be restored from this review.",
      );
  }
  if (present.length !== 1)
    throw new Error(
      "Transaction source paths are missing or ambiguous. Inspect the original and approved paths before recovering.",
    );
  return present[0];
}

/** Reopen missing clean companions, preserve existing drafts, and obtain a provider-owned inverse for explicit review. */
export async function reviewJavaEditorRecovery(options: {
  transaction: JavaEditorTransaction;
  projectContext: JavaEditorTransactionRequest["projectContext"];
  workspaceId: string;
  generation: number;
  editor: Editor;
  port: Pick<RefactorKitPort, "editorTransaction">;
  assertCurrent(): void;
}): Promise<
  JavaEditorRecoveryReview | { transaction: JavaEditorTransaction; alreadyRestored: true }
> {
  const entry = structuredClone(options.transaction);
  if (!entry.documents?.length || entry.documents.length > 128)
    throw new Error(
      "The provider has no complete document inventory for this transaction. Update RefactorKit before recovering it.",
    );
  if (!options.port.editorTransaction) throw new Error("Java transaction recovery is unavailable.");
  const authority: Authority = {
    workspaceId: options.workspaceId,
    generation: options.generation,
    projectContext: {
      ...structuredClone(options.projectContext),
      snapshotHash: entry.baseSnapshotHash,
      contextHash: entry.contextHash,
    },
    transactionId: entry.transactionId,
    approvedPlanHash: entry.approvedPlanHash,
    planId: entry.planId,
  };
  options.assertCurrent();
  const initial = options.editor.captureEditorBuffers({ allowNewBuffers: true });
  const locations = new Map<string, string>();
  for (const document of entry.documents) {
    const actual = await physicalPath(options.editor, authority, document);
    options.assertCurrent();
    initial.verify();
    locations.set(document.originalPath, actual);
    const open = options.editor
      .captureEditorBuffers()
      .documents.filter((d) => d.path === document.originalPath || d.path === document.finalPath);
    if (open.length > 1)
      throw new Error(
        "Both transaction paths are open. Close the unrelated destination before reviewing recovery.",
      );
    if (!open.length) {
      await options.editor.openFile(actual);
      options.assertCurrent();
      initial.verify();
    }
  }
  const captured = options.editor.captureEditorBuffers();
  const alignments: { oldPath: string; path: string; revision: string }[] = [];
  for (const document of entry.documents) {
    const actual = locations.get(document.originalPath)!;
    const open = captured.documents.filter(
      (d) => d.path === document.originalPath || d.path === document.finalPath,
    );
    if (open.length !== 1)
      throw new Error("The transaction buffer lineage changed; review recovery again.");
    if (open[0].path !== actual)
      alignments.push({
        oldPath: open[0].path,
        path: actual,
        revision: document.originalSavedContentSha256,
      });
  }
  const alignmentEdit: JavaEditorWorkspaceEdit = {
    documentChanges: alignments.map((d) => ({ kind: "rename", oldPath: d.oldPath, path: d.path })),
  };
  const aligned = stageEditorTransaction(captured.documents, alignmentEdit);
  const documents = aligned.documents.filter((d) => [...locations.values()].includes(d.path));
  const result = await options.port.editorTransaction({
    ...structuredClone(authority),
    phase: "recover",
    documents: documents.map((d) => ({ ...d })),
  });
  options.assertCurrent();
  captured.verify();
  if (
    result.kind !== "transaction" ||
    result.transaction.transactionId !== entry.transactionId ||
    result.transaction.planId !== entry.planId ||
    result.transaction.approvedPlanHash !== entry.approvedPlanHash ||
    result.transaction.contextHash !== entry.contextHash ||
    result.transaction.baseSnapshotHash !== entry.baseSnapshotHash
  )
    throw new Error("Recovery did not acknowledge the original transaction authority.");
  const transaction = result.transaction;
  if (transaction.status === "aborted" && !transaction.workspaceEdit && !alignments.length)
    return { transaction, alreadyRestored: true };
  if (transaction.status !== "undo-prepared" || !transaction.workspaceEdit)
    throw new Error(
      `Recovery was refused without changes: ${transaction.refusalCode ?? transaction.status}.`,
    );
  stageEditorTransaction(
    documents.map((d) => ({ ...d, isDirty: true })),
    transaction.workspaceEdit,
  );
  const combined: JavaEditorWorkspaceEdit = {
    documentChanges: [
      ...alignmentEdit.documentChanges,
      ...transaction.workspaceEdit.documentChanges,
    ],
  };
  const proposed = stageEditorTransaction(captured.documents, combined);
  const restoredBuffers = [];
  for (const document of entry.documents) {
    const restored = proposed.documents.find((d) => d.path === document.originalPath);
    if (!restored) throw new Error("Recovery does not restore the original transaction paths.");
    restoredBuffers.push({
      path: restored.path,
      text: restored.text,
      isDirty: (await digest(restored.text)) !== document.originalSavedContentSha256,
    });
  }
  options.assertCurrent();
  captured.verify();
  const review: JavaEditorRecoveryReview = freeze({
    transaction: structuredClone(transaction),
    authority,
    workspaceEdit: structuredClone(transaction.workspaceEdit),
    alignments,
    restoredBuffers,
    changes: stageEditorTransaction(captured.documents, combined, restoredBuffers).changes,
    documentLineage: entry.documents.map((d) => ({
      originalPath: d.originalPath,
      finalPath: d.finalPath,
    })),
    verify: () => {
      options.assertCurrent();
      captured.verify();
    },
  });
  issued.add(review);
  return review;
}

/** Explicit restoration: align retained buffers with verified existing files, then apply the reviewed provider inverse. */
export async function restoreJavaEditorRecovery(options: {
  review: JavaEditorRecoveryReview;
  editor: Editor;
  port: Pick<RefactorKitPort, "editorTransaction">;
  assertCurrent(): void;
}): Promise<JavaEditorRefactoringOutcome> {
  const { review } = options;
  if (!issued.has(review))
    throw new Error("Review this recovery proposal before restoring drafts.");
  review.verify();
  options.assertCurrent();
  issued.delete(review);
  let alignedChanges: JavaEditorRefactoringOutcome["changes"] = [];
  if (review.alignments.length) {
    const guard = options.editor.beginEditorTransaction();
    try {
      for (const source of review.alignments) {
        const present = await options.editor.inspectSourceRevision(
          review.authority,
          source.path,
          source.revision,
        );
        const absent = await options.editor.inspectSourceRevision(
          review.authority,
          source.oldPath,
          source.revision,
        );
        options.assertCurrent();
        if (present.status !== "unchanged" || absent.status !== "missing")
          throw new Error("The saved rename lineage changed after recovery review.");
      }
      const staged = guard.stage({
        documentChanges: review.alignments.map((d) => ({
          kind: "rename",
          oldPath: d.oldPath,
          path: d.path,
        })),
      });
      alignedChanges = staged.changes;
      guard.commit(staged);
      await guard.adoptSavedRenames(review.alignments);
    } catch (cause) {
      throw new JavaEditorTransactionError(
        cause instanceof Error ? cause.message : "Recovery path alignment failed.",
        review.transaction,
        guard.committed,
        "recover",
        cause,
        guard.committed ? alignedChanges : [],
      );
    } finally {
      guard.release();
    }
  }
  try {
    const outcome = await executeJavaEditorRefactoring({
      action: "recover",
      authority: review.authority,
      port: options.port,
      beginBuffers: () => options.editor.beginEditorTransaction(),
      assertCurrent: options.assertCurrent,
      documentLineage: review.documentLineage,
      restoredBuffers: review.restoredBuffers,
      reviewedWorkspaceEdit: review.workspaceEdit,
    });
    return { ...outcome, changes: [...alignedChanges, ...outcome.changes] };
  } catch (error) {
    if (error instanceof JavaEditorTransactionError && alignedChanges.length)
      throw new JavaEditorTransactionError(
        error.message,
        error.transaction,
        true,
        error.phase,
        error,
        [...alignedChanges, ...error.changes],
      );
    throw error;
  }
}
