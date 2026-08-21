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
  detached = false,
  onOpenWorkspaceFile,
  onOpenRange,
}: PiWorkspaceAgentActivityProps): JSX.Element {
  const controller = usePiWorkspaceAgentController({
    port,
    workspace,
    viewKind: detached ? "detached" : "docked",
  });

  // Real desktop git diff-review service composed from the three async
  // Tauri adapters (git_status_modified / git_diff_hunks / editor_open_range).
  const service = useMemo(
    () =>
      new ChangesReviewService(
        new TauriWorkspaceChangesAdapter(),
        new TauriReadOnlyDiffAdapter(),
        new TauriEditorOpenRangeAdapter(),
      ),
    [],
  );

  const [reviews, setReviews] = useState<
    ReadonlyMap<string, DiffReviewOutcome> | undefined
  >(undefined);

  // Fetch a read-only hunk-level diff review for each changed path whenever
  // the accessory changes list changes. Skip any outcome that is neither ok
  // nor unavailable (never fabricate a review).
  useEffect(() => {
    const changes = controller.accessories?.changes;
    if (!changes || changes.length === 0) {
      setReviews(undefined);
      return undefined;
    }
    let disposed = false;
    void (async () => {
      const next = new Map<string, DiffReviewOutcome>();
      for (const change of changes) {
        const outcome = await service.produceReview(change.path);
        if (outcome.kind !== "ok" && outcome.kind !== "unavailable") {
          continue;
        }
        next.set(change.path, outcome);
      }
      if (!disposed) {
        setReviews(next);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [controller.accessories?.changes, service]);

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
