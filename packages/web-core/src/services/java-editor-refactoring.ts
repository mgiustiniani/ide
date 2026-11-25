import type {
  JavaEditorTransaction,
  JavaEditorTransactionRequest,
  JavaEditorTransactionResult,
} from "@ide/contracts";
import type { RefactorKitPort } from "../ports/refactorkit-port";
import type { EditorViewModel } from "../view-models/editor-view-model";
import { stageEditorTransaction } from "../view-models/editor-transaction";

export interface JavaEditorRefactoringOutcome {
  transaction: JavaEditorTransaction;
  changes: ReturnType<typeof stageEditorTransaction>["changes"];
}

export class JavaEditorTransactionError extends Error {
  constructor(
    message: string,
    public readonly transaction: JavaEditorTransaction | undefined,
    public readonly buffersCommitted: boolean,
    public readonly phase: JavaEditorTransactionRequest["phase"],
    cause?: unknown,
    public readonly changes: JavaEditorRefactoringOutcome["changes"] = [],
  ) {
    super(message, { cause });
    this.name = "JavaEditorTransactionError";
  }
}

/** Complete provider preparation, guarded saved-byte moves and atomic buffer edits before acknowledging success. */
export async function executeJavaEditorRefactoring(options: {
  action: "apply" | "undo" | "recover";
  authority: Omit<JavaEditorTransactionRequest, "phase" | "documents">;
  port: Pick<RefactorKitPort, "editorTransaction">;
  beginBuffers(): ReturnType<EditorViewModel["beginEditorTransaction"]>;
  assertCurrent(): void;
  restoredBuffers?: readonly { path: string; text: string; isDirty: boolean }[];
  documentLineage?: readonly { originalPath: string; finalPath: string }[];
  reviewedWorkspaceEdit?: import("@ide/contracts").JavaEditorWorkspaceEdit;
}): Promise<JavaEditorRefactoringOutcome> {
  const invoke = options.port.editorTransaction?.bind(options.port);
  if (!invoke) throw new Error("Durable Java editor transactions are unavailable.");
  options.assertCurrent();
  const authority = structuredClone(options.authority);
  const action = options.action;
  const authorityForPhase = (phase: JavaEditorTransactionRequest["phase"]) => {
    const request = { ...authority, phase };
    if (phase !== "prepare" && phase !== "confirm") {
      delete request.formatterProfile;
      delete request.formatterProfileSha256;
    }
    return request;
  };
  const buffers = options.beginBuffers();
  const prefix = authority.projectContext.projectPath
    ? `${authority.projectContext.projectPath}/`
    : "";
  const capture = (
    documents: readonly { path: string; text: string; version: number }[],
    paths?: ReadonlySet<string>,
  ) =>
    documents
      .filter(
        (d) =>
          d.path.endsWith(".java") && d.path.startsWith(prefix) && (!paths || paths.has(d.path)),
      )
      .map(({ path, text, version }) => ({ path, text, version }));
  let phase: JavaEditorTransactionRequest["phase"] =
    action === "apply" ? "prepare" : action === "undo" ? "undo.prepare" : "recover";
  let current: JavaEditorTransaction | undefined;
  let committed = false;
  let changes: JavaEditorRefactoringOutcome["changes"] = [];
  const requireTransaction = (result: JavaEditorTransactionResult) => {
    if (
      result.kind !== "transaction" ||
      result.transaction.approvedPlanHash !== authority.approvedPlanHash ||
      result.transaction.baseSnapshotHash !== authority.projectContext.snapshotHash ||
      result.transaction.contextHash !== authority.projectContext.contextHash ||
      result.transaction.planId !== authority.planId ||
      (authority.transactionId !== undefined &&
        result.transaction.transactionId !== authority.transactionId)
    )
      throw new Error("The editor transaction did not acknowledge its approved Java authority.");
    return result.transaction;
  };
  try {
    let ownedPaths: Set<string> | undefined;
    if (options.documentLineage) {
      ownedPaths = new Set<string>();
      for (const lineage of options.documentLineage) {
        const candidates = [
          ...new Set(
            action === "apply"
              ? [lineage.originalPath]
              : action === "undo"
                ? [lineage.finalPath]
                : [lineage.originalPath, lineage.finalPath],
          ),
        ];
        const open = candidates.filter((path) => buffers.documents.some((d) => d.path === path));
        if (open.length !== 1 || ownedPaths.has(open[0]))
          throw new Error(
            "Reopen each transaction document at its current path before restoring its draft.",
          );
        ownedPaths.add(open[0]);
      }
      if (!ownedPaths.size) throw new Error("The editor transaction has no captured documents.");
    }
    const documents = capture(buffers.documents, ownedPaths);
    current = requireTransaction(
      await invoke(structuredClone({ ...authorityForPhase(phase), documents })),
    );
    options.assertCurrent();
    if (action === "recover" && current.status === "aborted" && !current.workspaceEdit)
      return { transaction: current, changes: [] };
    if (current.status === "recovery-required")
      throw new Error(
        `Recovery requires inspection: ${current.refusalCode ?? "unknown source or editor state"}.`,
      );
    if (
      current.status !== (action === "apply" ? "prepared" : "undo-prepared") ||
      !current.workspaceEdit
    )
      throw new Error("RefactorKit did not prepare the requested editor transformation.");
    if (
      options.reviewedWorkspaceEdit &&
      JSON.stringify(current.workspaceEdit) !== JSON.stringify(options.reviewedWorkspaceEdit)
    )
      throw new Error(
        "The recovery proposal changed after review; review it again before restoring drafts.",
      );
    // Validate the provider's URI/version ownership before staging against all open tabs.
    const scoped = stageEditorTransaction(
      buffers.documents.filter((d) => documents.some((owned) => owned.path === d.path)),
      current.workspaceEdit,
    );
    const staged = buffers.stage(
      current.workspaceEdit,
      action !== "apply" ? options.restoredBuffers : undefined,
    );
    const transformedDocuments = capture(
      staged.documents,
      new Set(scoped.documents.map((d) => d.path)),
    );
    const sizes = transformedDocuments.map((d) => new TextEncoder().encode(d.text).length);
    if (
      sizes.some((size) => size > 1024 * 1024) ||
      sizes.reduce((total, size) => total + size, 0) > 8 * 1024 * 1024
    )
      throw new Error("The transformed Java buffers exceed the transaction limit.");
    authority.transactionId = current.transactionId;
    phase = "apply-files";
    const files = await invoke(structuredClone({ ...authorityForPhase(phase), documents }));
    options.assertCurrent();
    const renames = staged.changes.filter((d) => d.oldPath !== d.path);
    if (
      files.kind !== "files-applied" ||
      files.transactionId !== current.transactionId ||
      files.diskSources.length !== renames.length ||
      renames.some(
        (c) =>
          files.diskSources.filter(
            (d) =>
              d.oldPath === c.oldPath && d.path === c.path && /^[a-f0-9]{64}$/.test(d.revision),
          ).length !== 1,
      )
    )
      throw new Error(
        "Saved-source rename acknowledgement is missing or differs from the prepared proposal.",
      );
    changes = staged.changes;
    buffers.commit(staged);
    committed = true;
    await buffers.adoptSavedRenames(files.diskSources);
    options.assertCurrent();
    phase = action === "apply" ? "confirm" : "undo.confirm";
    current = requireTransaction(
      await invoke(
        structuredClone({ ...authorityForPhase(phase), documents: transformedDocuments }),
      ),
    );
    options.assertCurrent();
    if (current.status !== (action === "apply" ? "applied" : "undone") || current.workspaceEdit)
      throw new Error(
        "The editor transformation has no confirmed outcome; inspect durable recovery.",
      );
    return { transaction: current, changes: staged.changes };
  } catch (cause) {
    throw new JavaEditorTransactionError(
      cause instanceof Error ? cause.message : "The editor transaction outcome requires recovery.",
      current,
      committed || buffers.committed,
      phase,
      cause,
      committed || buffers.committed ? changes : [],
    );
  } finally {
    buffers.release();
  }
}
