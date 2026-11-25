import { useEffect, useMemo, useRef, useState } from "react";
import type {
  JavaEffectiveProjectContext,
  JavaProjectModule,
  MavenModuleRenameDiscardRequest,
  MavenModuleRenameApplyRequest,
  MavenModuleRenameApplyResult,
  MavenModuleRenameRollbackRequest,
  RefactorKitAffectedFile,
  MavenModuleRenamePreview,
  MavenModuleRenamePreviewRequest,
  RefactorKitCapabilities,
} from "@ide/contracts";
import { mavenModuleRenameApplyOffered, mavenModuleRenamePreviewOffered } from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";

interface WorkspaceContext {
  workspaceId: string | null;
  generation: number;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}

export interface MavenModuleRenamePreviewProps {
  context: JavaEffectiveProjectContext | null;
  workspaceId: string | null;
  generation: number;
  isWriting: boolean;
  capabilities: RefactorKitCapabilities | null;
  port: RefactorKitPort;
  getWorkspaceContext(): WorkspaceContext;
  beginWorkspaceWrite(): () => void;
  reconcileChanges(
    changes: readonly RefactorKitAffectedFile[],
    isCurrent: () => boolean,
  ): Promise<string | undefined>;
  onSourceChanged(): void;
  transactionState: MavenModuleRenameTransactionState;
}

export interface MavenModuleRenameTransaction {
  transactionId: string;
  workspaceId: string;
  workspaceGeneration: number;
}

export interface MavenModuleRenameTransactionState {
  transaction: MavenModuleRenameTransaction | null;
  setTransaction(transaction: MavenModuleRenameTransaction | null): void;
}

interface MavenModuleRenameNotice {
  message: string;
  details?: string;
  workspaceId: string;
  workspaceGeneration: number;
}

function mavenModules(context: JavaEffectiveProjectContext | null): JavaProjectModule[] {
  if (!context) return [];
  const availableProviders = new Set(
    context.providers
      .filter(
        (provider) =>
          provider.providerId === "maven-effective-v1" && provider.status === "available",
      )
      .map((provider) => provider.providerId),
  );
  if (!availableProviders.has("maven-effective-v1")) return [];
  return context.modules.filter((module) => module.providerId === "maven-effective-v1");
}

function projectModuleDirectory(moduleRoot: string): string | null {
  if (!moduleRoot || moduleRoot.includes("\\") || moduleRoot.includes(":")) return null;
  const pieces = moduleRoot.split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")) return null;
  return moduleRoot;
}

function requestId(sequence: number): string {
  return `maven-module-rename-${Date.now()}-${sequence}`;
}

export function MavenModuleRenamePreview({
  context,
  workspaceId,
  generation,
  isWriting,
  capabilities,
  port,
  getWorkspaceContext,
  beginWorkspaceWrite,
  reconcileChanges,
  onSourceChanged,
  transactionState,
}: MavenModuleRenamePreviewProps): JSX.Element | null {
  const supportsNestedMove = mavenModuleRenamePreviewOffered(capabilities, true);
  const modules = useMemo(
    () => mavenModules(context).filter(
      (module) => projectModuleDirectory(module.root) !== null && (supportsNestedMove || !module.root.includes("/")),
    ),
    [context, supportsNestedMove],
  );
  const [open, setOpen] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [newModuleDir, setNewModuleDir] = useState("");
  const [newArtifactId, setNewArtifactId] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<MavenModuleRenameNotice | null>(null);
  const [preview, setPreview] = useState<MavenModuleRenamePreview | null>(null);
  const { transaction: retainedTransaction, setTransaction } = transactionState;
  const transaction =
    retainedTransaction?.workspaceId === workspaceId && retainedTransaction.workspaceGeneration === generation
      ? retainedTransaction
      : null;
  const sequence = useRef(0);
  const mutationInFlight = useRef(false);
  const activeRequest = useRef<MavenModuleRenamePreviewRequest | null>(null);
  const currentPreview = useRef<MavenModuleRenamePreview | null>(null);
  const currentContext = useRef(context);
  currentContext.current = context;
  currentPreview.current = preview;

  const selectedModule =
    modules.find((module) => module.id === selectedModuleId) ?? modules[0] ?? null;
  const oldModuleDir = selectedModule ? projectModuleDirectory(selectedModule.root) : null;
  const canOfferPreview = Boolean(
    mavenModuleRenamePreviewOffered(capabilities) && modules.length > 0 && workspaceId,
  );
  const canApply = mavenModuleRenameApplyOffered(capabilities);
  const visibleOperationNotice =
    operationNotice?.workspaceId === workspaceId &&
    operationNotice.workspaceGeneration === generation
      ? operationNotice.message
      : null;

  const isCurrent = (request: MavenModuleRenamePreviewRequest): boolean => {
    const active = getWorkspaceContext();
    return (
      active.workspaceId === request.workspaceId &&
      active.generation === request.workspaceGeneration &&
      currentContext.current?.snapshotHash === request.expectedSnapshotHash &&
      currentContext.current.contextHash === request.expectedContextHash &&
      !active.isSwitching &&
      !active.isMetadataLoading
    );
  };

  const discardPreview = async (
    current: MavenModuleRenamePreview | null,
    request: MavenModuleRenamePreviewRequest | null,
  ) => {
    if (!current || !request) return;
    const discard: MavenModuleRenameDiscardRequest = {
      planId: current.planId,
      workspaceId: request.workspaceId,
      workspaceGeneration: request.workspaceGeneration,
      selectionGeneration: request.selectionGeneration,
      requestId: request.requestId,
    };
    try {
      await port.discardMavenModuleRenamePreview(discard);
    } catch {
      // Workspace changes retire the daemon session and its plans. A rejected
      // best-effort discard must not keep an obsolete preview visible.
    }
  };

  useEffect(() => {
    setPreview(null);
    if (!mutationInFlight.current) {
      setError(null);
      setOpen(false);
      setBusy(false);
    }
    activeRequest.current = null;
    return () => {
      void discardPreview(currentPreview.current, activeRequest.current);
      currentPreview.current = null;
    };
    // The workspace and provider snapshot own every displayed preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, generation, context?.snapshotHash, context?.contextHash]);

  if (!workspaceId || (!canOfferPreview && !transaction && !error && !visibleOperationNotice))
    return null;

  const close = () => {
    const current = currentPreview.current;
    const request = activeRequest.current;
    currentPreview.current = null;
    activeRequest.current = null;
    setPreview(null);
    setError(null);
    setOperationNotice(null);
    setBusy(false);
    setOpen(false);
    void discardPreview(current, request);
  };

  const previewRename = async () => {
    if (!selectedModule || !oldModuleDir || !workspaceId || !newModuleDir.trim()) return;
    if (!supportsNestedMove && newModuleDir.includes("/")) {
      setError("This RefactorKit runtime supports Maven module renames between direct children of the reactor root.");
      return;
    }
    const active = getWorkspaceContext();
    if (
      active.workspaceId !== workspaceId ||
      active.generation !== generation ||
      active.isSwitching ||
      active.isMetadataLoading
    ) {
      setError("The workspace changed. Synchronize the active project before previewing a rename.");
      return;
    }
    const sequenceNumber = ++sequence.current;
    const request: MavenModuleRenamePreviewRequest = {
      oldModuleDir,
      newModuleDir: newModuleDir.trim(),
      ...(newArtifactId.trim() ? { newArtifactId: newArtifactId.trim() } : {}),
      expectedSnapshotHash: context?.snapshotHash ?? "",
      expectedContextHash: context?.contextHash ?? "",
      workspaceId,
      workspaceGeneration: generation,
      selectionGeneration: sequenceNumber,
      requestId: requestId(sequenceNumber),
    };
    const priorPreview = currentPreview.current;
    const priorRequest = activeRequest.current;
    currentPreview.current = null;
    activeRequest.current = request;
    setPreview(null);
    setBusy(true);
    setError(null);
    setOperationNotice(null);
    await discardPreview(priorPreview, priorRequest);
    try {
      const result = await port.previewMavenModuleRename(request);
      if (!isCurrent(request) || activeRequest.current?.requestId !== request.requestId) {
        await discardPreview(result, request);
        return;
      }
      if (
        result.planId.length === 0 ||
        result.operation !== "java.renameMavenModule" ||
        result.status !== "preview"
      ) {
        await discardPreview(result, request);
        setError("RefactorKit returned a preview that does not match this Maven module request.");
        return;
      }
      currentPreview.current = result;
      setPreview(result);
    } catch (cause) {
      if (isCurrent(request))
        setError(
          cause instanceof Error
            ? cause.message
            : "The Maven module rename preview could not be completed.",
        );
    } finally {
      if (activeRequest.current?.requestId === request.requestId) setBusy(false);
    }
  };

  const isWorkspaceCurrent = (owner: { workspaceId: string; workspaceGeneration: number }) => {
    const active = getWorkspaceContext();
    return (
      active.workspaceId === owner.workspaceId &&
      active.generation === owner.workspaceGeneration &&
      !active.isSwitching &&
      !active.isMetadataLoading
    );
  };

  const applyRename = async () => {
    const current = currentPreview.current;
    const request = activeRequest.current;
    if (!current || !request || !canApply || current.diffTruncated) return;
    if (!isCurrent(request)) {
      setError(
        "The synchronized Maven project changed. Discard this preview and create a new one.",
      );
      return;
    }
    let release: (() => void) | undefined;
    let applyStarted = false;
    try {
      release = beginWorkspaceWrite();
      mutationInFlight.current = true;
      setBusy(true);
      setError(null);
      setOperationNotice(null);
      const applyRequest: MavenModuleRenameApplyRequest = {
        planId: current.planId,
        workspaceId: request.workspaceId,
        workspaceGeneration: request.workspaceGeneration,
        selectionGeneration: request.selectionGeneration,
        requestId: request.requestId,
        approval: {
          approvalId: `desktop-maven-module-rename-approval-${request.requestId}`,
          approvedPlanId: current.planId,
          approvedAt: new Date().toISOString(),
        },
      };
      applyStarted = true;
      const result: MavenModuleRenameApplyResult = await port.applyMavenModuleRename(applyRequest);
      if (
        result.planId !== current.planId ||
        !result.transactionId ||
        !/^[a-f0-9]{64}$/u.test(result.snapshotHash)
      )
        throw new Error("RefactorKit returned an Apply result for another Maven module plan.");
      if (!isWorkspaceCurrent(request))
        throw new Error(
          "The workspace changed after Maven module rename Apply; inspect the project.",
        );
      setTransaction({
        transactionId: result.transactionId,
        workspaceId: request.workspaceId,
        workspaceGeneration: request.workspaceGeneration,
      });
      currentPreview.current = null;
      activeRequest.current = null;
      setPreview(null);
      setOpen(false);
      onSourceChanged();
      const reconciliation = await reconcileChanges(result.changedFiles, () =>
        isWorkspaceCurrent(request),
      );
      if (reconciliation && isWorkspaceCurrent(request))
        setOperationNotice({
          message: reconciliation,
          workspaceId: request.workspaceId,
          workspaceGeneration: request.workspaceGeneration,
        });
    } catch (cause) {
      if (applyStarted) {
        currentPreview.current = null;
        activeRequest.current = null;
        setPreview(null);
        setOpen(false);
        onSourceChanged();
      }
      const message =
        cause instanceof Error
          ? cause.message
          : "The Maven module rename could not be applied. Inspect the project before retrying.";
      if (applyStarted && isWorkspaceCurrent(request))
        setOperationNotice({
          message:
            "Maven module rename Apply failed or could not be confirmed. Inspect the project before retrying.",
          details: message,
          workspaceId: request.workspaceId,
          workspaceGeneration: request.workspaceGeneration,
        });
      else if (isWorkspaceCurrent(request)) setError(message);
    } finally {
      release?.();
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const rollbackRename = async () => {
    const current = transaction;
    if (!current || !isWorkspaceCurrent(current)) {
      setError("The Maven module rename transaction belongs to another workspace revision.");
      return;
    }
    let release: (() => void) | undefined;
    try {
      release = beginWorkspaceWrite();
      mutationInFlight.current = true;
      setBusy(true);
      setError(null);
      setOperationNotice(null);
      const request: MavenModuleRenameRollbackRequest = {
        transactionId: current.transactionId,
        workspaceId: current.workspaceId,
        workspaceGeneration: current.workspaceGeneration,
        requestId: requestId(++sequence.current),
      };
      const result = await port.rollbackMavenModuleRename(request);
      if (result.transactionId !== current.transactionId || !result.rolledBack)
        throw new Error("RefactorKit did not confirm rollback of this Maven module rename.");
      if (!isWorkspaceCurrent(current))
        throw new Error("The workspace changed during Maven module rename rollback.");
      setTransaction(null);
      onSourceChanged();
      const reconciliation = await reconcileChanges(result.changedFiles, () =>
        isWorkspaceCurrent(current),
      );
      if (reconciliation && isWorkspaceCurrent(current))
        setOperationNotice({
          message: reconciliation,
          workspaceId: current.workspaceId,
          workspaceGeneration: current.workspaceGeneration,
        });
    } catch (cause) {
      if (isWorkspaceCurrent(current))
        setOperationNotice({
          message:
            cause instanceof Error
              ? cause.message
              : "The Maven module rename could not be rolled back. Inspect the project before continuing.",
          workspaceId: current.workspaceId,
          workspaceGeneration: current.workspaceGeneration,
        });
    } finally {
      release?.();
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {error && !open ? (
        <p role="alert" className="mb-2 text-sm text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}
      {visibleOperationNotice ? (
        <div role="alert" className="mb-2 text-sm text-[var(--accent-red)]">
          <p>{visibleOperationNotice}</p>
          {operationNotice?.details && (
            <details className="mt-1 text-xs text-[var(--text-secondary)]">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-background)] p-2 font-mono">
                {operationNotice.details}
              </pre>
            </details>
          )}
        </div>
      ) : null}
      {canOfferPreview ? (
        <button
          type="button"
          className="rounded border border-[var(--border-default)] px-2 py-1 underline disabled:opacity-50"
          disabled={isWriting || isBusy || !oldModuleDir}
          onClick={() => {
            setOpen(true);
            setError(null);
            setOperationNotice(null);
          }}
        >
          Review Maven module rename
        </button>
      ) : null}
      {transaction ? (
        <div className="mt-2 flex items-center gap-2 text-sm" role="status">
          <span>Maven module rename applied. Rollback remains available for this transaction.</span>
          <button
            type="button"
            className="rounded border border-[var(--border-default)] px-2 py-1 underline disabled:opacity-50"
            disabled={isWriting || isBusy}
            onClick={() => void rollbackRename()}
          >
            {isBusy ? "Working…" : "Rollback Maven rename"}
          </button>
        </div>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Maven module rename preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <section className="max-h-[85vh] w-full max-w-4xl space-y-3 overflow-auto rounded border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 text-[var(--text-primary)] shadow-xl">
            <h3 className="text-base font-semibold">Maven module rename preview</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              RefactorKit analyzes saved project files. This preview does not modify the workspace.
              The provider marks this operation experimental. Apply requires all editor buffers to
              be saved.
            </p>
            <label className="block text-sm">
              Module
              <select
                className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--input-bg)] px-2 py-1"
                value={selectedModule?.id ?? ""}
                disabled={isBusy || preview !== null}
                onChange={(event) => {
                  setSelectedModuleId(event.target.value);
                  currentPreview.current = null;
                  activeRequest.current = null;
                  setPreview(null);
                }}
              >
                {modules.map((module, index) => (
                  <option key={`${module.id}:${index}`} value={module.id}>
                    {module.name} · {module.root || "Project root"}
                  </option>
                ))}
              </select>
            </label>
            <p className="break-all text-xs text-[var(--text-muted)]">
              Current directory: {oldModuleDir ?? "This root module cannot be renamed here."}
            </p>
            <label className="block text-sm">
              New module directory, relative to the selected Java project
              <input
                className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--input-bg)] px-2 py-1"
                value={newModuleDir}
                disabled={isBusy || preview !== null}
                placeholder="catalog-domain"
                onChange={(event) => setNewModuleDir(event.target.value)}
              />
            </label>
            {supportsNestedMove ? (
              <p className="text-xs text-[var(--text-muted)]">
                For a nested move, use an existing parent directory and leave the artifact ID empty to keep the Maven coordinates.
              </p>
            ) : null}
            <label className="block text-sm">
              New Maven artifact ID (optional)
              <input
                className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--input-bg)] px-2 py-1"
                value={newArtifactId}
                disabled={isBusy || preview !== null}
                placeholder="catalog-domain"
                onChange={(event) => setNewArtifactId(event.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-[var(--accent-red)]">
                {error}
              </p>
            ) : null}
            {preview ? (
              <div className="space-y-3" aria-label="Reviewed Maven module rename plan">
                <p className="text-sm">{preview.summary}</p>
                <div>
                  <h4 className="font-medium">Affected files</h4>
                  <ul className="list-disc break-all pl-5 text-xs">
                    {preview.affectedFiles.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </div>
                {preview.diffTruncated ? (
                  <p role="status" className="text-sm text-[var(--accent-yellow)]">
                    The rendered diff is incomplete and cannot be used as a complete review.
                    {preview.diffTruncationReasons.length
                      ? ` ${preview.diffTruncationReasons.join(", ")}`
                      : ""}
                  </p>
                ) : null}
                <pre className="max-h-80 overflow-auto rounded border border-[var(--border-default)] p-2 text-xs">
                  {preview.renderedDiff || "The provider returned no text diff."}
                </pre>
                <p className="break-all text-xs text-[var(--text-muted)]">
                  RefactorKit {preview.providerVersion} · snapshot {preview.snapshotHash}
                </p>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-[var(--border-default)] px-3 py-1"
                disabled={isBusy}
                onClick={close}
              >
                Close and discard preview
              </button>
              {!preview ? (
                <button
                  type="button"
                  className="rounded border border-[var(--border-default)] px-3 py-1 disabled:opacity-50"
                  disabled={isBusy || isWriting || !oldModuleDir || !newModuleDir.trim()}
                  onClick={() => void previewRename()}
                >
                  {isBusy ? "Previewing…" : "Preview rename"}
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded border border-[var(--border-default)] px-3 py-1 disabled:opacity-50"
                  disabled={
                    isBusy ||
                    isWriting ||
                    !canApply ||
                    preview.diffTruncated ||
                    transaction !== null
                  }
                  onClick={() => void applyRename()}
                >
                  {isBusy ? "Applying…" : "Apply reviewed rename"}
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
