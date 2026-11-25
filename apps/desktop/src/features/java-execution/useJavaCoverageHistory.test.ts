import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JavaExecutionSnapshot } from "@ide/contracts";
import { coverage } from "../../../../../packages/tauri-adapters/src/java-coverage.test-fixtures";
import { useJavaCoverageHistory } from "./useJavaCoverageHistory";
import { saveJavaCoverageHistory } from "./javaCoverageHistory";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

function snapshot(sessionId = "run-1"): JavaExecutionSnapshot {
  return {
    workspaceId: "one",
    generation: 1,
    sessionId,
    operation: "coverage",
    state: "succeeded",
    output: "",
    outputTruncated: false,
    exitCode: 0,
    coverage: coverage(),
  };
}
describe("Java coverage history", () => {
  it("retains a new run when a previous application used the same native execution ID", () => {
    const first = renderHook(() => useJavaCoverageHistory("one", 1, snapshot(), null));
    const old = { ...first.result.current.entries[0], id: "previous-application:run-1" };
    first.unmount();
    expect(saveJavaCoverageHistory("one", [old])).toBeNull();
    const next = renderHook(() =>
      useJavaCoverageHistory("one", 2, { ...snapshot(), generation: 2 }, null),
    );
    expect(next.result.current.entries).toHaveLength(2);
    expect(new Set(next.result.current.entries.map((entry) => entry.id)).size).toBe(2);
    expect(next.result.current.entries.map((entry) => entry.sessionId)).toEqual(["run-1", "run-1"]);
  });
  it("does not recreate a cleared measurement from a repeated terminal snapshot", () => {
    const view = renderHook(({ value }) => useJavaCoverageHistory("one", 1, value, null), {
      initialProps: { value: snapshot() },
    });
    act(() => view.result.current.clear());
    view.rerender({ value: snapshot() });
    expect(view.result.current.entries).toHaveLength(0);
    view.rerender({ value: snapshot("next-run") });
    expect(view.result.current.entries).toHaveLength(1);
  });
  it("restores after remount and clears saved data without readding the displayed run", () => {
    const first = renderHook(() => useJavaCoverageHistory("one", 1, snapshot(), "Tests"));
    expect(first.result.current.entries).toHaveLength(1);
    first.unmount();
    const restored = renderHook(() => useJavaCoverageHistory("one", 2, null, null));
    expect(restored.result.current.entries).toHaveLength(1);
    act(() => restored.result.current.clear());
    expect(restored.result.current.entries).toHaveLength(0);
    restored.unmount();
    const empty = renderHook(() => useJavaCoverageHistory("one", 3, null, null));
    expect(empty.result.current.entries).toHaveLength(0);
  });
  it("keeps measured data in memory when saving fails", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Quota");
    });
    const { result } = renderHook(() => useJavaCoverageHistory("one", 1, snapshot(), null));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.error).toMatch(/could not be saved/);
  });
  it("ignores a clear callback retained from another workspace", () => {
    const view = renderHook(
      ({ id, value }: { id: string; value: JavaExecutionSnapshot | null }) =>
        useJavaCoverageHistory(id, 1, value, null),
      { initialProps: { id: "one", value: snapshot() as JavaExecutionSnapshot | null } },
    );
    const clearOld = view.result.current.clear;
    view.rerender({ id: "two", value: null });
    act(() => clearOld());
    view.rerender({ id: "one", value: null });
    expect(view.result.current.entries).toHaveLength(1);
  });
  it("records a completed measurement once and isolates counters from later mutation", () => {
    const value = snapshot();
    const view = renderHook(({ value }) => useJavaCoverageHistory("one", 1, value, "Unit tests"), {
      initialProps: { value },
    });
    expect(view.result.current.entries).toHaveLength(1);
    value.coverage!.counters.lines.covered = 99;
    view.rerender({ value: { ...value } });
    expect(view.result.current.entries).toHaveLength(1);
    expect(view.result.current.entries[0].counters.lines.covered).toBe(1);
    expect(view.result.current.entries[0].configurationName).toBe("Unit tests");
  });
  it("does not record running, stopped or unavailable measurements", () => {
    for (const state of ["starting", "running", "stopped"] as const) {
      const { result, unmount } = renderHook(() =>
        useJavaCoverageHistory("one", 1, { ...snapshot(), state }, null),
      );
      expect(result.current.entries).toHaveLength(0);
      unmount();
    }
    const value = snapshot();
    value.coverage!.status = "unavailable";
    const { result } = renderHook(() => useJavaCoverageHistory("one", 1, value, null));
    expect(result.current.entries).toHaveLength(0);
  });
  it("retains partial measurements and measurements from failed tests without reporting success", () => {
    const value = snapshot();
    value.state = "failed";
    value.coverage!.status = "partial";
    const { result } = renderHook(() => useJavaCoverageHistory("one", 1, value, null));
    expect(result.current.entries[0]).toMatchObject({
      status: "partial",
      executionState: "failed",
    });
  });
  it("keeps the latest ten sessions and retains them while the next run starts", () => {
    const view = renderHook(
      ({ value }: { value: JavaExecutionSnapshot | null }) =>
        useJavaCoverageHistory("one", 1, value, null),
      { initialProps: { value: snapshot("run-0") as JavaExecutionSnapshot | null } },
    );
    for (let index = 1; index <= 12; index++) view.rerender({ value: snapshot(`run-${index}`) });
    expect(view.result.current.entries).toHaveLength(10);
    expect(view.result.current.entries[0].sessionId).toBe("run-12");
    expect(view.result.current.entries.at(-1)?.sessionId).toBe("run-3");
    view.rerender({ value: null });
    expect(view.result.current.entries).toHaveLength(10);
  });
  it("restores only the selected workspace history and refuses late old snapshots", () => {
    const view = renderHook(
      ({ workspaceId, generation, value }) =>
        useJavaCoverageHistory(workspaceId, generation, value, null),
      { initialProps: { workspaceId: "one", generation: 1, value: snapshot() } },
    );
    view.rerender({ workspaceId: "two", generation: 2, value: snapshot() });
    expect(view.result.current.entries).toHaveLength(0);
    view.rerender({
      workspaceId: "two",
      generation: 2,
      value: { ...snapshot("two-run"), workspaceId: "two", generation: 2 },
    });
    expect(view.result.current.entries).toHaveLength(1);
    view.rerender({
      workspaceId: "two",
      generation: 3,
      value: { ...snapshot("two-run"), workspaceId: "two", generation: 2 },
    });
    expect(view.result.current.entries).toHaveLength(1);
    expect(view.result.current.entries[0].sessionId).toBe("two-run");
  });
});
