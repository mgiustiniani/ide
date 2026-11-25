import { useEffect, useRef, useState } from "react";
import type { EditorDiskStatus, OpenFile } from "@ide/contracts";
import type { EditorPort } from "@ide/web-core/ports";

interface Props {
  port: Pick<EditorPort, "inspectDiskStatus">;
  activeFile: OpenFile | null;
  openFiles: readonly OpenFile[];
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  getContext(): {
    workspaceId: string | null;
    generation: number;
    isSwitching: boolean;
    isMetadataLoading: boolean;
  };
  getOpenFiles(): readonly OpenFile[];
}
interface MonitorState {
  status: "checking" | "ready" | "unavailable" | "idle";
  issue: EditorDiskStatus | null;
  issues: readonly EditorDiskStatus[];
}
interface Observations {
  workspaceId: string | null;
  generation: number;
  files: ReadonlyMap<OpenFile, EditorDiskStatus>;
}
const POLL_MS = 2_000;

/** Detection only. Explicit comparison/adoption and revision-checked saves own all changes. */
export function useEditorExternalChangeMonitor(props: Props): MonitorState {
  const latest = useRef(props);
  latest.current = props;
  const inFlight = useRef<Promise<unknown> | null>(null);
  const backgroundIndex = useRef(0);
  const [observations, setObservations] = useState<Observations>({
    workspaceId: null, generation: 0, files: new Map(),
  });
  const { port, activeFile, openFiles, workspaceId, generation, enabled } = props;

  useEffect(() => {
    // Keep observations across tab selection, but never across a workspace or a tab lifetime.
    setObservations((previous) => ({
      workspaceId, generation,
      files: new Map(
        previous.workspaceId === workspaceId && previous.generation === generation && enabled
          ? [...previous.files].filter(([file]) => openFiles.includes(file))
          : [],
      ),
    }));
    if (!enabled || !openFiles.length || !workspaceId || !port.inspectDiskStatus) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = (file?: OpenFile) => {
      const current = latest.current;
      const context = current.getContext();
      return (
        !disposed &&
        current.enabled &&
        context.workspaceId === workspaceId &&
        context.generation === generation &&
        !context.isSwitching &&
        !context.isMetadataLoading &&
        (!file || (current.openFiles.includes(file) && current.getOpenFiles().includes(file)))
      );
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (!disposed) timer = setTimeout(probe, POLL_MS);
    };
    const inspect = async (file: OpenFile) => {
      if (!isCurrent(file) || document.visibilityState === "hidden") return;
      let result: EditorDiskStatus | null;
      try {
        result = await port.inspectDiskStatus!({ workspaceId, generation }, file.filePath);
        if (result && result.filePath !== file.filePath) throw new Error("Uncorrelated disk status");
      } catch {
        result = { filePath: file.filePath, status: "unavailable" };
      }
      if (!isCurrent(file) || !result) return;
      const observation = result;
      setObservations((previous) => {
        const files = new Map(
          previous.workspaceId === workspaceId && previous.generation === generation
            ? previous.files : [],
        );
        files.set(file, observation);
        return { workspaceId, generation, files };
      });
    };
    const probe = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (!isCurrent() || document.visibilityState === "hidden" || inFlight.current) {
        schedule();
        return;
      }
      // At most two inspections per cycle, serialized: active file, then one rotating background tab.
      const background = openFiles.filter((file) => file !== activeFile);
      const next = background.length ? background[backgroundIndex.current++ % background.length] : null;
      const request = Promise.resolve().then(async () => {
        if (activeFile) await inspect(activeFile);
        if (next) await inspect(next);
      });
      inFlight.current = request;
      void request.finally(() => {
        if (inFlight.current === request) inFlight.current = null;
        if (!disposed) schedule();
      });
    };
    probe();
    window.addEventListener("focus", probe);
    document.addEventListener("visibilitychange", probe);
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("focus", probe);
      document.removeEventListener("visibilitychange", probe);
    };
  }, [port, activeFile, openFiles, workspaceId, generation, enabled]);

  const current = enabled && workspaceId && observations.workspaceId === workspaceId &&
    observations.generation === generation;
  const result = current && activeFile ? observations.files.get(activeFile) : undefined;
  return {
    status: !enabled || !openFiles.length || !workspaceId ? "idle"
      : !port.inspectDiskStatus ? "unavailable"
      : result ? (result.status === "unavailable" ? "unavailable" : "ready") : "checking",
    issue: port.inspectDiskStatus && result && result.status !== "unchanged" ? result : null,
    issues: current && port.inspectDiskStatus ? openFiles.flatMap((file) => {
      const value = observations.files.get(file);
      return value && value.status !== "unchanged" ? [value] : [];
    }) : [],
  };
}
