import { useCallback, useEffect, useRef, useState } from "react";
import type { JavaExecutionSnapshot } from "@ide/contracts";
import {
  clearJavaCoverageHistory,
  loadJavaCoverageHistory,
  saveJavaCoverageHistory,
  type JavaCoverageHistoryEntry,
} from "./javaCoverageHistory";
export type { JavaCoverageHistoryEntry } from "./javaCoverageHistory";
// Native execution IDs restart with each application process. History must retain both runs.
const applicationHistoryId = crypto.randomUUID();

/** Keep bounded measurement summaries; historical entries never grant source navigation. */
export function useJavaCoverageHistory(
  workspaceId: string | null,
  generation: number,
  snapshot: JavaExecutionSnapshot | null,
  configurationName: string | null,
) {
  const owner = useRef({ workspaceId, generation });
  owner.current = { workspaceId, generation };
  const observedSnapshot = useRef(snapshot);
  observedSnapshot.current = snapshot;
  const clearedSession = useRef<{
    workspaceId: string | null;
    generation: number;
    sessionId: string;
  } | null>(null);
  const [history, setHistory] = useState<{
    workspaceId: string | null;
    generation: number;
    entries: JavaCoverageHistoryEntry[];
    error: string | null;
    dirty: boolean;
  }>(() => ({
    workspaceId,
    generation,
    dirty: false,
    ...(workspaceId ? loadJavaCoverageHistory(workspaceId) : { entries: [], error: null }),
  }));
  useEffect(() => {
    setHistory((previous) => {
      const base =
        previous.workspaceId === workspaceId && previous.generation === generation
          ? previous
          : {
              workspaceId,
              generation,
              dirty: false,
              ...(workspaceId
                ? loadJavaCoverageHistory(workspaceId)
                : { entries: [], error: null }),
            };
      const entries = base.entries;
      const coverage = snapshot?.coverage;
      if (
        !snapshot ||
        snapshot.workspaceId !== workspaceId ||
        snapshot.generation !== generation ||
        (clearedSession.current?.workspaceId === workspaceId &&
          clearedSession.current.generation === generation &&
          clearedSession.current.sessionId === snapshot.sessionId) ||
        (snapshot.state !== "succeeded" && snapshot.state !== "failed") ||
        (snapshot.operation !== "coverage" && snapshot.operation !== "integration-coverage") ||
        !coverage ||
        (coverage.status !== "ready" && coverage.status !== "partial") ||
        entries.some((entry) => entry.id === `${applicationHistoryId}:${snapshot.sessionId}`)
      ) {
        return base;
      }
      const entry: JavaCoverageHistoryEntry = {
        id: `${applicationHistoryId}:${snapshot.sessionId}`,
        sessionId: snapshot.sessionId,
        completedAt: new Date().toISOString(),
        configurationName,
        operation: snapshot.operation,
        executionState: snapshot.state,
        projectPath: coverage.projectPath,
        buildTool: coverage.buildTool,
        ...(coverage.testSelection ? { testSelection: structuredClone(coverage.testSelection) } : {}),
        status: coverage.status,
        counters: structuredClone(coverage.counters),
        reports: coverage.reports,
        files: coverage.files.length,
        tests: snapshot.testResults?.summary.total ?? null,
      };
      return { ...base, dirty: true, entries: [entry, ...entries].slice(0, 10) };
    });
  }, [workspaceId, generation, snapshot, configurationName]);
  useEffect(() => {
    if (
      !workspaceId ||
      history.workspaceId !== workspaceId ||
      history.generation !== generation ||
      !history.dirty
    )
      return;
    const error = saveJavaCoverageHistory(workspaceId, history.entries);
    setHistory((previous) =>
      previous.entries === history.entries && previous.error !== error
        ? { ...previous, error }
        : previous,
    );
  }, [
    workspaceId,
    generation,
    history.entries,
    history.dirty,
    history.workspaceId,
    history.generation,
  ]);
  const clear = useCallback(() => {
    if (
      !workspaceId ||
      owner.current.workspaceId !== workspaceId ||
      owner.current.generation !== generation
    )
      return;
    const error = clearJavaCoverageHistory(workspaceId);
    const observed = observedSnapshot.current;
    clearedSession.current =
      observed && ["succeeded", "failed"].includes(observed.state)
        ? { workspaceId, generation, sessionId: observed.sessionId }
        : null;
    setHistory({ workspaceId, generation, entries: [], error, dirty: false });
  }, [workspaceId, generation]);
  const current = history.workspaceId === workspaceId && history.generation === generation;
  return { entries: current ? history.entries : [], error: current ? history.error : null, clear };
}
