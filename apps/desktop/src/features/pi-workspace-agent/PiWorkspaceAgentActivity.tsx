import type { FileNode, WorkspaceInfo } from "@ide/contracts";
import type { PiWorkspaceAgentPort } from "@ide/web-core/ports";
import { PiWorkspaceAgentScreen } from "@ide/ui";
import {
  TauriEditorOpenRangeAdapter,
  TauriReadOnlyDiffAdapter,
  TauriWorkspaceChangesAdapter,
} from "@ide/tauri-adapters";
import { ChangesReviewService } from "@ide/web-core";
import type { DiffReviewOutcome } from "@ide/web-core/ports";
import { useEffect, useMemo, useState } from "react";

import { usePiWorkspaceAgentController } from "./usePiWorkspaceAgentController";

export interface PiWorkspaceAgentActivityProps {
  port: PiWorkspaceAgentPort;
  workspace: WorkspaceInfo | null;
  workspaceGeneration?: number;
  detached?: boolean;
  onOpenWorkspaceFile?: (node: FileNode) => void | Promise<void>;
  onOpenRange?: (path: string, startLine: number, endLine: number) => void | Promise<void>;
}

function fileNode(path: string): FileNode {
  const segments = path.split("/").filter(Boolean);
  return {
    id: path,
    name: segments.at(-1) ?? path,
    path,
    type: "file",
  };
}

export function PiWorkspaceAgentActivity({
  port,
  workspace,
  workspaceGeneration = 0,
  detached = false,
  onOpenWorkspaceFile,
  onOpenRange,
}: PiWorkspaceAgentActivityProps): JSX.Element {
  const controller = usePiWorkspaceAgentController({
    port,
    workspace,
    viewKind: detached ? "detached" : "docked",
  });

  const scope = useMemo(
    () => ({
      workspaceId: workspace?.id,
      rootPath: workspace?.rootPath,
      generation: workspaceGeneration,
    }),
    [workspace?.id, workspace?.rootPath, workspaceGeneration],
  );
  const service = useMemo(
    () =>
      new ChangesReviewService(
        new TauriWorkspaceChangesAdapter(scope.rootPath),
        new TauriReadOnlyDiffAdapter(scope.rootPath),
        new TauriEditorOpenRangeAdapter(scope.rootPath),
      ),
    [scope],
  );
  const [reviewState, setReviewState] = useState<{
    scope: typeof scope;
    reviews: ReadonlyMap<string, DiffReviewOutcome>;
  }>();
  const reviews = reviewState?.scope === scope ? reviewState.reviews : undefined;

  // Fetch a read-only hunk-level diff review for each changed path whenever
  // the accessory changes list changes. Skip any outcome that is neither ok
  // nor unavailable (never fabricate a review).
  useEffect(() => {
    setReviewState(undefined);
    const changes = controller.accessories?.changes;
    if (
      !scope.workspaceId ||
      controller.accessories?.workspaceId !== scope.workspaceId ||
      !changes ||
      changes.length === 0
    ) {
      setReviewState(undefined);
      return undefined;
    }
    let disposed = false;
    void (async () => {
      const next = new Map<string, DiffReviewOutcome>();
      for (const change of changes) {
        if (disposed) return;
        let outcome: DiffReviewOutcome;
        try {
          outcome = await service.produceReview(change.path);
        } catch {
          outcome = {
            kind: "unavailable",
            reason: "Git changes are unavailable. Refresh and try again.",
          };
        }
        if (disposed) return;
        if (outcome.kind !== "ok" && outcome.kind !== "unavailable") {
          continue;
        }
        next.set(change.path, outcome);
      }
      if (!disposed) {
        setReviewState({ scope, reviews: next });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [controller.accessories?.changes, controller.accessories?.workspaceId, scope, service]);

  if (!workspace) {
    return (
      <section
        className="flex h-full items-center justify-center p-4 text-center text-xs text-[var(--text-secondary)]"
        aria-label="Pi Agent unavailable"
      >
        Select an authorized workspace before opening Pi Agent.
      </section>
    );
  }

  return (
    <PiWorkspaceAgentScreen
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      attachment={controller.attachment}
      accessories={controller.accessories}
      terminalFeed={controller.terminalFeed}
      isAttaching={controller.isAttaching}
      isAccessoryLoading={controller.isAccessoryLoading}
      error={controller.error}
      accessoryError={controller.accessoryError}
      detached={detached}
      onData={controller.write}
      onResize={controller.resize}
      onRefresh={controller.refresh}
      onRefreshAccessories={controller.refreshAccessories}
      onStart={controller.start}
      onStop={controller.stop}
      onDetach={
        detached
          ? undefined
          : async () => {
              await controller.openDetached();
            }
      }
      reviews={reviews}
      onOpenRange={onOpenRange}
      onOpenChangedFile={
        onOpenWorkspaceFile
          ? async (path) => {
              await onOpenWorkspaceFile(fileNode(path));
            }
          : undefined
      }
    />
  );
}
