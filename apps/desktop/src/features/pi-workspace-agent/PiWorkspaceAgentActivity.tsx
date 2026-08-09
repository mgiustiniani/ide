import type { FileNode, WorkspaceInfo } from "@ide/contracts";
import type { PiWorkspaceAgentPort } from "@ide/web-core/ports";
import { PiWorkspaceAgentScreen } from "@ide/ui";

import { usePiWorkspaceAgentController } from "./usePiWorkspaceAgentController";

export interface PiWorkspaceAgentActivityProps {
  port: PiWorkspaceAgentPort;
  workspace: WorkspaceInfo | null;
  detached?: boolean;
  onOpenWorkspaceFile?: (node: FileNode) => void | Promise<void>;
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
}: PiWorkspaceAgentActivityProps): JSX.Element {
  const controller = usePiWorkspaceAgentController({
    port,
    workspace,
    viewKind: detached ? "detached" : "docked",
  });

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
