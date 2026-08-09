import type { PiWorkspaceAgentDetachedBinding, WorkspaceInfo } from "@ide/contracts";
import { TauriPiWorkspaceAgentAdapter } from "@ide/tauri-adapters";
import type { PiWorkspaceAgentPort } from "@ide/web-core/ports";
import { useEffect, useMemo, useState } from "react";

import { PiWorkspaceAgentActivity } from "./features/pi-workspace-agent/PiWorkspaceAgentActivity";

export interface DetachedPiAgentAppProps {
  port?: PiWorkspaceAgentPort;
}

/** Minimal renderer for the fixed workspace-pinned detached Agent window. */
export function DetachedPiAgentApp({ port }: DetachedPiAgentAppProps): JSX.Element {
  const resolvedPort = useMemo<PiWorkspaceAgentPort>(
    () => port ?? new TauriPiWorkspaceAgentAdapter(),
    [port],
  );
  const [binding, setBinding] = useState<PiWorkspaceAgentDetachedBinding | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void resolvedPort
      .getDetachedBinding()
      .then((next) => {
        if (!disposed) setBinding(next);
      })
      .catch((failure: unknown) => {
        if (!disposed) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      });
    return () => {
      disposed = true;
    };
  }, [resolvedPort]);

  const workspace = useMemo<WorkspaceInfo | null>(
    () =>
      binding
        ? {
            id: binding.workspaceId,
            name: binding.workspaceName,
            // Native attachment resolves the already-authorized backend-owned root.
            rootPath: "",
          }
        : null,
    [binding],
  );

  return (
    <div className="h-full w-full overflow-hidden bg-[var(--surface-background)] dark">
      {error ? (
        <div className="flex h-full items-center justify-center p-6" role="alert">
          <div className="max-w-lg rounded border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
            <h1 className="font-semibold">Detached Pi Agent unavailable</h1>
            <p className="mt-2">{error}</p>
          </div>
        </div>
      ) : workspace ? (
        <PiWorkspaceAgentActivity port={resolvedPort} workspace={workspace} detached />
      ) : (
        <div
          className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]"
          role="status"
        >
          Attaching to the workspace-pinned Pi Agent…
        </div>
      )}
    </div>
  );
}
