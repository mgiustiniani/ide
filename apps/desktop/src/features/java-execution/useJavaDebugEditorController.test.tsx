import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JavaDebuggerSourceView, JavaExecutionSnapshot } from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core";
import { debuggerState } from "../../../../../packages/tauri-adapters/src/java-debugger-state.test-fixtures";
import { useJavaDebugEditorController } from "./useJavaDebugEditorController";
import type { JavaSourceBreakpoints } from "./useJavaSourceBreakpoints";

const document = { path: "Main.java", text: "class Main {}", version: 1 };
function harness() {
  let lifetime = Symbol(),
    workspace = { workspaceId: "one", generation: 1, isSwitching: false };
  const editorState: { activeFilePath: string; contents: Record<string, string> } = {
    activeFilePath: "Main.java",
    contents: { "Main.java": document.text },
  };
  const snapshot: JavaExecutionSnapshot = {
    workspaceId: "one",
    generation: 1,
    sessionId: "debug",
    operation: "debug",
    state: "running",
    output: "",
    outputTruncated: false,
    exitCode: null,
    debuggerState: debuggerState(),
  };
  const port = {
    debugSource: vi.fn(async (request) => ({
      ...request,
      documentPath: request.document.path,
      documentVersion: request.document.version,
      sourcePath: "Main.java",
      executionLine: 8,
      breakpoints: [],
    })),
    toggleSourceBreakpoint: vi.fn(async () => {}),
    runToCursor: vi.fn(async () => {}),
  } as unknown as JavaExecutionPort;
  const dependencies = {
    port,
    snapshot,
    workspaceId: "one",
    generation: 1,
    getContext: () => workspace,
    getEditorState: () => editorState,
    editor: { bufferLifetime: () => lifetime },
  };
  return {
    dependencies,
    port,
    editorState,
    retire: (kind: string) => {
      if (kind === "workspace") workspace = { ...workspace, generation: 2 };
      if (kind === "buffer") lifetime = Symbol();
      if (kind === "typing") editorState.contents[document.path] += " draft";
      if (kind === "stop") dependencies.snapshot = { ...snapshot, state: "stopped" };
      if (kind === "frame")
        dependencies.snapshot = {
          ...snapshot,
          debuggerState: { ...debuggerState(), selectedFrameId: "another-frame" },
        };
    },
  };
}
describe("Java debugger editor controller", () => {
  it("binds source inspection to an attached JDI frame without claiming bytecode provenance", async () => {
    const h = harness();
    const dependencies = {
      ...h.dependencies,
      snapshot: { ...h.dependencies.snapshot, operation: "attach" as const },
    };
    const hook = renderHook(() => useJavaDebugEditorController(dependencies));
    expect(hook.result.current.debugging?.mode).toBe("live");
    await act(async () => {
      await hook.result.current.debugging!.source(document);
    });
    expect(h.port.debugSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "debug",
        document,
        stopId: "stop-1",
        frameId: "stop-1:1:0",
      }),
    );
    hook.unmount();
  });
  it.each(["queued", "applied", "failed"] as const)(
    "retires source presentation after a %s compiled class reload",
    async (status) => {
      const h = harness();
      const hook = renderHook((dependencies) => useJavaDebugEditorController(dependencies), {
        initialProps: h.dependencies,
      });
      const before = hook.result.current.debugging;
      expect(before).toBeDefined();
      hook.rerender({
        ...h.dependencies,
        snapshot: {
          ...h.dependencies.snapshot,
          classReload: {
            requestId: "reload-1",
            status,
            classes: ["Main"],
            error: status === "failed" ? "JVM refused changes" : null,
          },
        },
      });
      expect(hook.result.current.debugging).toBeUndefined();
      await expect(before!.source(document)).rejects.toThrow("obsolete");
      expect(h.port.debugSource).not.toHaveBeenCalled();
      hook.unmount();
    },
  );
  it("restores disabled saved logpoint settings when its margin breakpoint is enabled live", async () => {
    const h = harness();
    const options = { condition: "i >= 2", hitCount: 3, logMessage: "i={i}" };
    const save = vi.fn(async () => {});
    const inspect = vi.fn(async () => ({
      sourcePath: "Main.java",
      changed: false,
      points: [{ sourcePath: "Main.java", line: 8, enabled: false, ...options }],
    }));
    const hook = renderHook(() =>
      useJavaDebugEditorController({
        ...h.dependencies,
        breakpoints: { points: [], inspect, set: save } as unknown as JavaSourceBreakpoints,
      }),
    );
    await act(async () => {
      await hook.result.current.debugging!.source(document);
      await hook.result.current.debugging!.toggleBreakpoint(document, 8);
    });
    expect(h.port.toggleSourceBreakpoint).toHaveBeenCalledWith({
      source: expect.objectContaining({ document }),
      line: 8,
      ...options,
    });
    expect(save).toHaveBeenCalledWith(document, 8, true, expect.any(Function), true, options);
  });
  it("starts one-shot Run to Cursor only from the current suspended source binding", async () => {
    const h = harness();
    const hook = renderHook(() => useJavaDebugEditorController(h.dependencies));
    await act(async () => {
      await hook.result.current.debugging!.source(document);
      await hook.result.current.debugging!.runToCursor(document, 1);
    });
    expect(h.port.runToCursor).toHaveBeenCalledWith({
      source: expect.objectContaining({
        workspaceId: "one",
        generation: 1,
        sessionId: "debug",
        document,
        stopId: "stop-1",
        frameId: "stop-1:1:0",
      }),
      line: 1,
    });
    hook.unmount();
  });
  it("refuses Run to Cursor when the line already has a breakpoint or source changed", async () => {
    const occupied = harness();
    vi.mocked(occupied.port.debugSource!).mockResolvedValue({
      workspaceId: "one",
      generation: 1,
      sessionId: "debug",
      requestId: "source-1",
      documentPath: document.path,
      documentVersion: document.version,
      stopId: "stop-1",
      frameId: "stop-1:1:0",
      sourcePath: "Main.java",
      executionLine: 1,
      breakpoints: [{ line: 1, verified: true }],
    });
    const hook = renderHook(() => useJavaDebugEditorController(occupied.dependencies));
    await act(async () => {
      await hook.result.current.debugging!.source(document);
      await expect(hook.result.current.debugging!.runToCursor(document, 1)).rejects.toThrow(
        "breakpoint already exists",
      );
    });
    expect(occupied.port.runToCursor).not.toHaveBeenCalled();
    hook.unmount();

    const changed = harness();
    const changedHook = renderHook(() => useJavaDebugEditorController(changed.dependencies));
    await act(async () => {
      await changedHook.result.current.debugging!.source(document);
      changed.retire("typing");
      await expect(changedHook.result.current.debugging!.runToCursor(document, 1)).rejects.toThrow(
        "obsolete",
      );
    });
    expect(changed.port.runToCursor).not.toHaveBeenCalled();
    changedHook.unmount();
  });
  it.each(["workspace", "buffer", "typing", "stop", "frame"])(
    "refuses a saved condition resolved after its live %s binding changes",
    async (kind) => {
      const h = harness();
      let resolve!: (value: unknown) => void;
      const save = vi.fn(async () => {});
      const inspect = vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const dependencies = {
        ...h.dependencies,
        breakpoints: { points: [], inspect, set: save } as unknown as JavaSourceBreakpoints,
      };
      const hook = renderHook(() => useJavaDebugEditorController(dependencies));
      await act(() => hook.result.current.debugging!.source(document));
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current
          .debugging!.toggleBreakpoint(document, 8)
          .catch((cause) => cause);
      });
      h.retire(kind);
      dependencies.snapshot = h.dependencies.snapshot;
      hook.rerender();
      await act(async () => {
        resolve({ points: [{ line: 8, condition: "i >= 2", hitCount: 3 }] });
        expect(await pending).toBeInstanceOf(Error);
      });
      expect(h.port.toggleSourceBreakpoint).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(hook.result.current.message).toBeNull();
    },
  );
  it("saves an accepted breakpoint even when its runtime acknowledgement arrives before the command returns", async () => {
    const h = harness();
    const save = vi.fn(async (_document, _line, _present, current) => {
      expect(current()).toBe(true);
    });
    const dependencies = {
      ...h.dependencies,
      breakpoints: { points: [], set: save } as unknown as JavaSourceBreakpoints,
    };
    let resolve!: () => void;
    vi.mocked(h.port.toggleSourceBreakpoint!).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useJavaDebugEditorController(dependencies));
    await act(() => hook.result.current.debugging!.source(document));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.debugging!.toggleBreakpoint(document, 8);
    });
    dependencies.snapshot = {
      ...dependencies.snapshot,
      debuggerState: {
        ...debuggerState(),
        breakpoints: [
          { className: null, sourcePath: "Main.java", line: 8, verified: true, message: null },
        ],
      },
    };
    hook.rerender();
    await act(async () => {
      resolve();
      await pending;
    });
    expect(save).toHaveBeenCalledWith(document, 8, true, expect.any(Function), true, {});
  });
  it("requires a new source inspection after the approved buffer is replaced", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaDebugEditorController(h.dependencies));
    const captured = hook.result.current.debugging!;
    await act(async () => {
      await captured.source(document);
    });
    h.retire("buffer");
    await expect(captured.toggleBreakpoint(document, 8)).rejects.toThrow("obsolete");
    expect(h.port.toggleSourceBreakpoint).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.debugging!.source(document);
      await hook.result.current.debugging!.toggleBreakpoint(document, 8);
    });
    expect(h.port.toggleSourceBreakpoint).toHaveBeenCalledTimes(1);
  });
  it("binds source actions to the selected suspension and exact editor document", async () => {
    const h = harness(),
      hook = renderHook(() => useJavaDebugEditorController(h.dependencies));
    await act(async () => {
      await hook.result.current.debugging!.source(document);
      await hook.result.current.debugging!.toggleBreakpoint(document, 8);
    });
    expect(h.port.toggleSourceBreakpoint).toHaveBeenCalledWith({
      source: expect.objectContaining({
        workspaceId: "one",
        generation: 1,
        sessionId: "debug",
        stopId: "stop-1",
        frameId: "stop-1:1:0",
        document,
      }),
      line: 8,
    });
  });
  it.each(["workspace", "buffer", "typing", "stop", "frame"])(
    "refuses captured source actions and delayed errors after %s changes",
    async (kind) => {
      const h = harness();
      let reject!: (cause: Error) => void;
      vi.mocked(h.port.debugSource!).mockImplementation(
        () =>
          new Promise<JavaDebuggerSourceView>((_done, fail) => {
            reject = fail;
          }),
      );
      const hook = renderHook(() => useJavaDebugEditorController(h.dependencies)),
        captured = hook.result.current.debugging!;
      let pending!: Promise<unknown>;
      act(() => {
        pending = captured.source(document).catch((cause) => cause);
      });
      h.retire(kind);
      hook.rerender();
      await act(async () => {
        reject(new Error("old source failure"));
        await pending;
      });
      expect(hook.result.current.message).toBeNull();
      await expect(captured.toggleBreakpoint(document, 8)).rejects.toThrow("obsolete");
      expect(h.port.toggleSourceBreakpoint).not.toHaveBeenCalled();
    },
  );
});
