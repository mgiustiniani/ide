import { useEffect, useMemo, useSyncExternalStore, useCallback } from "react";
import type { WorkspaceTerminalPort } from "@ide/web-core/ports";
import { WorkspaceTerminalController } from "@ide/web-core/terminal/WorkspaceTerminalController";
export function useTerminalController({
  port,
  workspaceId,
  generation,
  ready,
}: {
  port: WorkspaceTerminalPort;
  workspaceId: string | null;
  generation: number;
  ready: boolean;
}) {
  const controller = useMemo(() => new WorkspaceTerminalController(port), [port]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  useEffect(() => {
    controller.setContext(ready && workspaceId ? { workspaceId, generation } : null);
    return () => controller.dispose();
  }, [controller, workspaceId, generation, ready]);
  const resetWorkspace = useCallback(() => controller.setContext(null), [controller]);
  return { state, controller, resetWorkspace };
}
