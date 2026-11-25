import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenFile, EditorDiskStatus, EditorDiskInspectionContext } from "@ide/contracts";
import type { EditorPort } from "@ide/web-core/ports";
import { useEditorExternalChangeMonitor } from "./useEditorExternalChangeMonitor";

function harness(
  inspect: NonNullable<EditorPort["inspectDiskStatus"]> = vi.fn(async (): Promise<EditorDiskStatus | null> => ({
    filePath: "Main.java",
    status: "unchanged",
  })),
) {
  const file: OpenFile = {
    filePath: "Main.java",
    name: "Main.java",
    language: "java",
    openedAt: 1,
  };
  let files: readonly OpenFile[] = [file];
  const context = {
    workspaceId: "one",
    generation: 1,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const props: Parameters<typeof useEditorExternalChangeMonitor>[0] = {
    port: { inspectDiskStatus: inspect },
    activeFile: file as OpenFile | null,
    openFiles: files,
    workspaceId: "one",
    generation: 1,
    enabled: true,
    getContext: () => context,
    getOpenFiles: () => files,
  };
  const hook = renderHook(useEditorExternalChangeMonitor, { initialProps: props });
  return {
    hook,
    props,
    inspect,
    context,
    setActive: (value: OpenFile | null) => {
      files = value ? [value] : [];
    },
    setFiles: (value: readonly OpenFile[]) => { files = value; },
  };
}
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("passive open-file external change monitoring", () => {
  it("checks one rotating background tab after the active file and retains notices across selection", async () => {
    vi.useFakeTimers();
    const inspect = vi.fn(async (_context: EditorDiskInspectionContext, filePath: string) => ({
      filePath, status: filePath === "Main.java" ? "unchanged" : "changed",
    } as EditorDiskStatus));
    const h = harness(inspect);
    await settle();
    inspect.mockClear();
    const other = { ...h.props.activeFile!, filePath: "Other.java" };
    const third = { ...other, filePath: "Third.java" };
    const openFiles = [h.props.activeFile!, other, third];
    h.setFiles(openFiles);
    h.hook.rerender({ ...h.props, openFiles });
    await settle();
    expect(inspect.mock.calls.map((call) => call[1])).toEqual(["Main.java", "Other.java"]);
    expect(h.hook.result.current.issue).toBeNull();
    expect(h.hook.result.current.issues).toEqual([{ filePath: "Other.java", status: "changed" }]);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(inspect.mock.calls.map((call) => call[1])).toEqual([
      "Main.java", "Other.java", "Main.java", "Third.java",
    ]);
    h.hook.rerender({ ...h.props, openFiles, activeFile: other });
    expect(h.hook.result.current.issue).toEqual({ filePath: "Other.java", status: "changed" });
    expect(h.hook.result.current.issues).toHaveLength(2);
    await settle();
  });
  it("never overlaps inspections and drops a closed background tab's late result", async () => {
    vi.useFakeTimers();
    const h = harness();
    await settle();
    let release!: (value: EditorDiskStatus) => void;
    const other = { ...h.props.activeFile!, filePath: "Other.java" };
    const openFiles = [h.props.activeFile!, other];
    const inspect = vi.fn((_context: EditorDiskInspectionContext, filePath: string): Promise<EditorDiskStatus> =>
      filePath === "Main.java" ? Promise.resolve({ filePath, status: "unchanged" })
        : new Promise<EditorDiskStatus>((resolve) => { release = resolve; }));
    h.setFiles(openFiles);
    h.hook.rerender({ ...h.props, port: { inspectDiskStatus: inspect }, openFiles });
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(inspect).toHaveBeenCalledTimes(2);
    // Store changes precede React rendering. A new lifetime of the same path must not inherit this result.
    h.setFiles([h.props.activeFile!, { ...other, openedAt: 2 }]);
    await act(async () => { release({ filePath: "Other.java", status: "missing" }); });
    expect(h.hook.result.current.issues).toEqual([]);
  });
  it("contains background failures, continues rotation and removes notices for closed tabs", async () => {
    vi.useFakeTimers();
    const h = harness();
    await settle();
    const other = { ...h.props.activeFile!, filePath: "Other.java" };
    const third = { ...other, filePath: "Third.java" };
    const openFiles = [h.props.activeFile!, other, third];
    const port = { inspectDiskStatus: vi.fn(async (_context: EditorDiskInspectionContext, filePath: string): Promise<EditorDiskStatus> => {
      if (filePath === "Other.java") throw new Error("private error");
      return { filePath, status: filePath === "Main.java" ? "unchanged" : "missing" };
    }) };
    h.setFiles(openFiles);
    h.hook.rerender({ ...h.props, port, openFiles });
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(h.hook.result.current.issues).toEqual([
      { filePath: "Other.java", status: "unavailable" },
      { filePath: "Third.java", status: "missing" },
    ]);
    h.setFiles([h.props.activeFile!]);
    h.hook.rerender({ ...h.props, port, openFiles: [h.props.activeFile!] });
    await settle();
    expect(h.hook.result.current.issues).toEqual([]);
  });
  it("retires all background notices when the workspace changes or monitoring is disabled", async () => {
    const h = harness(vi.fn(async (_context: EditorDiskInspectionContext, filePath: string): Promise<EditorDiskStatus> => ({ filePath, status: "changed" })));
    await settle();
    expect(h.hook.result.current.issues).toHaveLength(1);
    h.context.generation = 2;
    h.hook.rerender({ ...h.props, generation: 2 });
    expect(h.hook.result.current.issues).toEqual([]);
    await settle();
    expect(h.hook.result.current.issues).toHaveLength(1);
    h.hook.rerender({ ...h.props, generation: 2, enabled: false });
    expect(h.hook.result.current.issues).toEqual([]);
  });
  it("reports changed and missing disk states without changing any buffer or save baseline", async () => {
    vi.useFakeTimers();
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({ filePath: "Main.java", status: "changed" })
      .mockResolvedValueOnce({ filePath: "Main.java", status: "missing" });
    const h = harness(inspect);
    await settle();
    expect(h.hook.result.current.issue).toEqual({ filePath: "Main.java", status: "changed" });
    expect(inspect).toHaveBeenCalledWith({ workspaceId: "one", generation: 1 }, "Main.java");
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(h.hook.result.current.issue?.status).toBe("missing");
  });
  it("clears an issue only after a subsequent unchanged revision check", async () => {
    vi.useFakeTimers();
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce({ filePath: "Main.java", status: "changed" })
        .mockResolvedValue({ filePath: "Main.java", status: "unchanged" }),
    );
    await settle();
    expect(h.hook.result.current.issue).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(h.hook.result.current.issue).toBeNull();
    expect(h.hook.result.current.status).toBe("ready");
  });
  it("serializes focus and timer probes while a native inspection is pending", async () => {
    vi.useFakeTimers();
    let release!: (value: EditorDiskStatus | null) => void;
    const h = harness(
      vi.fn(
        () =>
          new Promise<EditorDiskStatus | null>((resolve) => {
            release = resolve;
          }),
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(h.inspect).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ filePath: "Main.java", status: "unchanged" });
    });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(h.inspect).toHaveBeenCalledTimes(2);
  });
  it("does not display an old workspace response even before the new context renders", async () => {
    let release!: (value: EditorDiskStatus | null) => void;
    const h = harness(
      vi.fn(
        () =>
          new Promise<EditorDiskStatus | null>((resolve) => {
            release = resolve;
          }),
      ),
    );
    await settle();
    h.context.generation = 2;
    await act(async () => {
      release({ filePath: "Main.java", status: "changed" });
    });
    expect(h.hook.result.current.issue).toBeNull();
  });
  it("rejects late results after closing and reopening the same path", async () => {
    let release!: (value: EditorDiskStatus | null) => void;
    const h = harness(
      vi.fn(
        () =>
          new Promise<EditorDiskStatus | null>((resolve) => {
            release = resolve;
          }),
      ),
    );
    await settle();
    h.setActive({ ...h.props.activeFile!, openedAt: 2 });
    await act(async () => {
      release({ filePath: "Main.java", status: "changed" });
    });
    expect(h.hook.result.current.issue).toBeNull();
  });
  it("clears the old notice immediately when another file is selected", async () => {
    vi.useFakeTimers();
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce({ filePath: "Main.java", status: "changed" })
        .mockResolvedValue({ filePath: "Other.java", status: "unchanged" }),
    );
    await settle();
    const next = { ...h.props.activeFile!, filePath: "Other.java" };
    h.setActive(next);
    h.hook.rerender({ ...h.props, activeFile: next });
    await settle();
    expect(h.hook.result.current.issue).toBeNull();
  });
  it("reports safe unavailable status after provider failure and never exposes exception text", async () => {
    const h = harness(vi.fn().mockRejectedValue(new Error("secret /private/Source.java")));
    await settle();
    expect(h.hook.result.current.issue).toEqual({ filePath: "Main.java", status: "unavailable" });
    expect(JSON.stringify(h.hook.result.current)).not.toContain("secret");
  });
  it("ignores an adapter result invalidated by a save rather than announcing an external write", async () => {
    const h = harness(vi.fn().mockResolvedValue(null));
    await settle();
    expect(h.hook.result.current.issue).toBeNull();
  });
  it("stops timers and focus subscriptions after unmount", async () => {
    vi.useFakeTimers();
    const h = harness();
    await settle();
    h.hook.unmount();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(h.inspect).toHaveBeenCalledTimes(1);
  });
  it("suspends disk work in a hidden document and rechecks when it becomes visible", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const h = harness();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(h.inspect).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(h.inspect).toHaveBeenCalledTimes(1);
  });
  it("does not inspect during workspace metadata loading or after monitoring is disabled", async () => {
    vi.useFakeTimers();
    const h = harness();
    await settle();
    h.context.isMetadataLoading = true;
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(h.inspect).toHaveBeenCalledTimes(1);
    h.context.isMetadataLoading = false;
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(h.inspect).toHaveBeenCalledTimes(2);
    h.hook.rerender({ ...h.props, enabled: false });
    await settle();
    expect(h.hook.result.current.status).toBe("idle");
    expect(h.hook.result.current.issue).toBeNull();
  });
  it("honestly marks a provider without inspection unavailable without a fabricated disk warning", async () => {
    const h = harness();
    h.hook.rerender({ ...h.props, port: {} });
    await settle();
    expect(h.hook.result.current.status).toBe("unavailable");
    expect(h.hook.result.current.issue).toBeNull();
  });
});
