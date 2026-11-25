import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  JavaExecutionSnapshot,
  JavaFlightRecordingSummary,
  JavaFlightRecordingTimeline,
} from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";
import { useJavaExecutionController } from "./useJavaExecutionController";
import { javaConfigurationsStorageKey } from "./javaLaunchConfigurations";
import { debuggerState } from "../../../../../packages/tauri-adapters/src/java-debugger-state.test-fixtures";
import { coverage } from "../../../../../packages/tauri-adapters/src/java-coverage.test-fixtures";

function port(): JavaExecutionPort {
  return {
    getCapabilities: vi.fn(async (context) => ({
      ...context,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      reason: null,
    })),
    start: vi.fn(async (request) => ({
      workspaceId: request.workspaceId,
      generation: request.generation,
      sessionId: "java-one",
      operation: request.operation,
      state: "succeeded" as const,
      exitCode: 0,
      output: "real boundary output",
      outputTruncated: false,
    })),
    snapshot: vi.fn(),
    stop: vi.fn(),
    rerunFailed: vi.fn(),
    debugCommand: vi.fn(async () => undefined),
    debugAction: vi.fn(async () => undefined),
  };
}
const props = { workspaceId: "one", generation: 1, enabled: true };
it.each(["capability", "port"])("refuses input-enabled Run before saving when the %s is unavailable", async (missing) => {
  const native = port();
  if (missing !== "port") native.sendApplicationInput = vi.fn();
  vi.mocked(native.getCapabilities).mockResolvedValue({ ...props, available: true, projectKind: "jdk",
    jdk: true, maven: false, gradle: false, debugger: true, applicationInput: missing !== "capability", reason: null });
  const prepare = vi.fn(async () => undefined);
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
  await waitFor(() => expect(hook.result.current.capabilities?.available).toBe(true));
  act(() => {
    hook.result.current.setTrusted(true);
    hook.result.current.updateConfiguration({ ...hook.result.current.configuration, mainClass: "Main", applicationInput: true });
  });
  await act(async () => hook.result.current.start("run"));
  expect(prepare).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(hook.result.current.error).toMatch(/does not advertise application input/);
});
function failedSnapshot(): JavaExecutionSnapshot {
  return {
    ...props,
    sessionId: "java-one",
    operation: "test",
    state: "failed",
    output: "JUnit failed",
    outputTruncated: false,
    exitCode: 1,
    testResults: {
      status: "ready",
      projectPath: "service",
      buildTool: "maven",
      unchangedReports: 0,
      message: null,
      canRerunFailed: true,
      rerunReason: null,
      summary: { total: 1, passed: 0, failed: 1, error: 0, skipped: 0, flaky: 0 },
      suites: [
        {
          name: "T",
          reportPath: "service/target/surefire-reports/TEST-T.xml",
          cases: [
            {
              id: "one",
              name: "fails",
              className: "T",
              state: "failed",
              durationMs: 1,
              detail: "AssertionError",
              detailTruncated: false,
            },
          ],
        },
      ],
    },
  };
}
beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("Java execution controller", () => {
  it.each((["gradle", "maven"] as const).flatMap((tool) =>
    (["saved", "draft", "changed settings"] as const).map((state) => [tool, state] as const)))(
    "prepares %s only after trust and a stable saved workspace (%s)",
    async (tool, state) => {
      const native = port();
      const prepare = vi.fn(async () => undefined);
      const settings = {
        projectPath: "nested project",
        sdkHome: "/project/jdk",
        mavenRepository: "/cache/selected Maven repository",
        activeMavenProfiles: ["quality"],
        inactiveMavenProfiles: ["skip-check"],
        gradle: {
          executable: "/project/gradlew",
          userHome: "/cache/wanted",
          gradleRuntimeHome: "/gradle/jdk",
          projectProperties: { profile: "developer" },
        },
      };
      let current = settings;
      const verify = vi.fn();
      const reviewSavedBuffers = vi.fn(() => {
        if (state === "draft") throw new Error("Save the open draft first.");
        return verify;
      });
      const projectContext = {
        settings, context: null,
        getSettings: () => current,
        refresh: vi.fn(),
        retire: vi.fn(),
        pauseMonitoring: vi.fn(async () => {
          if (state === "changed settings") {
            current = tool === "maven" ? { ...settings, mavenRepository: "/different/repository" } :
              { ...settings, gradle: { ...settings.gradle, userHome: "/different/cache" } };
          }
        }),
      };
      const hook = renderHook(() => useJavaExecutionController({
        ...props, port: native, prepare, reviewSavedBuffers, projectContext,
      }));
      const operation = `prepare-${tool}` as const;
      await act(() => hook.result.current.start(operation));
      expect(native.start).not.toHaveBeenCalled();
      expect(reviewSavedBuffers).not.toHaveBeenCalled();
      act(() => {
        hook.result.current.updateConfiguration({
          buildTool: "maven", mainClass: "example.Main", classPath: [],
          projectModule: { moduleId: "other", sourceSetId: "main" },
        });
        hook.result.current.setTrusted(true);
      });
      await act(() => hook.result.current.start(operation));
      expect(prepare).not.toHaveBeenCalled();
      expect(projectContext.refresh).not.toHaveBeenCalled();
      expect(hook.result.current.configuration.projectModule?.moduleId).toBe("other");
      if (state !== "saved") {
        expect(native.start).not.toHaveBeenCalled();
        expect(projectContext.retire).not.toHaveBeenCalled();
        expect(hook.result.current.error).toMatch(state === "draft" ? /Save the open draft/ : /settings changed/);
        return;
      }
      expect(verify).toHaveBeenCalledOnce();
      expect(projectContext.retire).toHaveBeenCalledOnce();
      expect(native.start).toHaveBeenCalledWith({
        workspaceId: props.workspaceId, generation: props.generation, operation,
        trusted: true,
        ...(tool === "gradle" ? { gradlePreparation: settings.gradle } : {
          mavenPreparation: {
            mavenRepository: settings.mavenRepository,
            activeMavenProfiles: settings.activeMavenProfiles,
            inactiveMavenProfiles: settings.inactiveMavenProfiles,
          },
        }),
        configuration: { buildTool: tool, mainClass: "", classPath: [],
          projectPath: settings.projectPath, jdkHome: settings.sdkHome },
      });
    },
  );

  it.each(["summary", "timeline"] as const)("retires pending JFR %s when a captured run is repeated", async (phase) => {
    const native = port();
    vi.mocked(native.getCapabilities).mockResolvedValue({ ...props, available: true, projectKind: "jdk", jdk: true, maven: false, gradle: false, debugger: true, flightRecorder: true, restartExecution: true, reason: null });
    const profile = (id: string) => `.ide/flight-recordings/${id}/recording.jfr`;
    const completed = (id: string): JavaExecutionSnapshot => ({ ...props, sessionId: id, operation: "run", state: "succeeded", output: "finished", outputTruncated: false, exitCode: 0, profilePath: profile(id) });
    const summary = (id: string): JavaFlightRecordingSummary => ({ ...props, sessionId: id, profilePath: profile(id), recordingVersion: "2.1", chunks: 1, startTime: "2026-11-12 12:00:00 (UTC)", duration: "1 s", events: [{ name: "jdk.GarbageCollection", count: 1, sizeBytes: 40 }] });
    const timeline = (id: string): JavaFlightRecordingTimeline => ({ ...props, sessionId: id, profilePath: profile(id), eventType: "jdk.GarbageCollection", eventCount: 1, truncated: false, events: [{ startTime: "2026-11-12T12:00:00Z", duration: null, threadName: null, payload: [], payloadTruncated: false, stackFrames: [], stackTraceTruncated: false }] });
    vi.mocked(native.start).mockResolvedValue(completed("jfr-one"));
    native.restart = vi.fn(async () => completed("jfr-two"));
    native.analyzeFlightRecording = vi.fn(async (request) => summary(request.sessionId));
    native.readFlightRecordingTimeline = vi.fn(async (request) => timeline(request.sessionId));
    let resolveOld!: () => void;
    if (phase === "summary") vi.mocked(native.analyzeFlightRecording).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = () => resolve(summary("jfr-one")); }));
    else vi.mocked(native.readFlightRecordingTimeline).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = () => resolve(timeline("jfr-one")); }));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare: async () => {} }));
    await waitFor(() => expect(hook.result.current.capabilities?.restartExecution).toBe(true));
    act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ buildTool: "jdk", mainClass: "Main", classPath: [] }); });
    await act(() => hook.result.current.start("run", true));
    if (phase === "timeline") await act(() => hook.result.current.analyzeFlightRecording());
    let old!: Promise<void>;
    act(() => { old = phase === "summary" ? hook.result.current.analyzeFlightRecording() : hook.result.current.readFlightRecordingTimeline("jdk.GarbageCollection"); });
    await act(() => hook.result.current.restart());
    expect(hook.result.current.flightRecordingAnalysisPending).toBe(false);
    expect(hook.result.current.flightRecordingTimelinePending).toBe(false);
    expect(hook.result.current.flightRecordingSummary).toBeNull();
    expect(hook.result.current.flightRecordingTimeline).toBeNull();
    await act(() => hook.result.current.analyzeFlightRecording());
    await act(() => hook.result.current.readFlightRecordingTimeline("jdk.GarbageCollection"));
    await act(async () => { resolveOld(); await old; });
    expect(hook.result.current.flightRecordingSummary?.sessionId).toBe("jfr-two");
    expect(hook.result.current.flightRecordingTimeline?.sessionId).toBe("jfr-two");
  });
  it.each(["workspace", "stop"])("stops the replacement when %s changes during native restart", async (change) => {
    const native = port();
    vi.mocked(native.getCapabilities).mockResolvedValue({ ...props, available: true, projectKind: "jdk", jdk: true, maven: false, gradle: false, debugger: true, restartExecution: true, reason: null });
    let release!: (snapshot: JavaExecutionSnapshot) => void;
    native.restart = vi.fn(() => new Promise<JavaExecutionSnapshot>((resolve) => { release = resolve; }));
    vi.mocked(native.stop).mockImplementation(async (request) => ({ ...request, operation: "run", state: "stopped", output: "", outputTruncated: false, exitCode: null }));
    const hook = renderHook((owner) => useJavaExecutionController({ ...owner, port: native, prepare: async () => {} }), { initialProps: props });
    await waitFor(() => expect(hook.result.current.capabilities).not.toBeNull());
    act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ mainClass: "Main", buildTool: "jdk", classPath: [] }); });
    await act(() => hook.result.current.start("run"));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.restart(); });
    await waitFor(() => expect(native.restart).toHaveBeenCalled());
    if (change === "workspace") hook.rerender({ ...props, generation: 2 });
    else await act(() => hook.result.current.stop());
    await act(async () => {
      release({ workspaceId: "one", generation: 1, sessionId: "java-two", operation: "run", state: "running", exitCode: null, output: "", outputTruncated: false });
      await pending;
    });
    expect(native.stop).toHaveBeenLastCalledWith({ workspaceId: "one", generation: 1, sessionId: "java-two" });
    if (change === "workspace") expect(hook.result.current.snapshot).toBeNull();
    else expect(hook.result.current.snapshot).toMatchObject({ sessionId: "java-two", state: "stopped" });
  });
  it.each(["run", "test", "integration-test"] as const)("repeats the captured %s session after saving and ignores later launch-form drafts", async (operation) => {
    const native = port(), prepare = vi.fn(async () => {});
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
      ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, reason: null, restartExecution: true,
    }));
    native.restart = vi.fn(async (): Promise<JavaExecutionSnapshot> => ({ ...props, sessionId: "java-two", operation, state: "succeeded", exitCode: 0, output: "restarted", outputTruncated: false }));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    await waitFor(() => expect(hook.result.current.capabilities?.restartExecution).toBe(true));
    act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ mainClass: "Main", buildTool: "maven", classPath: [] }); });
    await act(() => hook.result.current.start(operation));
    expect(hook.result.current.canRestart).toBe(true);
    act(() => hook.result.current.updateConfiguration({ mainClass: "DoesNotExist", jdkHome: "/invalid", buildTool: "jdk", classPath: [] }));
    await act(() => hook.result.current.restart());
    expect(prepare).toHaveBeenNthCalledWith(2, operation);
    expect(native.restart).toHaveBeenCalledWith({ workspaceId: "one", generation: 1, sessionId: "java-one", trusted: true, sourceBreakpoints: [] });
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(hook.result.current.snapshot?.sessionId).toBe("java-two");
  });
  it.each(["trust", "workspace", "breakpoints", "stop"])("refuses restart when %s changes while saving", async (change) => {
    const native = port();
    vi.mocked(native.getCapabilities).mockResolvedValue({ ...props, available: true, projectKind: "jdk", jdk: true, maven: false, gradle: false, debugger: true, restartExecution: true, reason: null });
    native.restart = vi.fn();
    let release!: () => void;
    const prepare = vi.fn(async () => {});
    let points: import("@ide/contracts").JavaSavedSourceBreakpoint[] = [];
    const hook = renderHook((owner) => useJavaExecutionController({ ...owner, port: native, prepare, getSourceBreakpoints: () => points }), { initialProps: props });
    await waitFor(() => expect(hook.result.current.capabilities).not.toBeNull());
    act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ mainClass: "Main", buildTool: "jdk", debuggerMode: "jdi", classPath: [] }); });
    await act(() => hook.result.current.start("debug"));
    prepare.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.restart(); });
    if (change === "trust") act(() => hook.result.current.setTrusted(false));
    if (change === "workspace") hook.rerender({ ...props, generation: 2 });
    if (change === "breakpoints") points = [{ sourcePath: "Main.java", line: 1, fingerprint: "a".repeat(64) }];
    if (change === "stop") {
      vi.mocked(native.stop).mockResolvedValue({ ...hook.result.current.snapshot!, state: "stopped" });
      await act(() => hook.result.current.stop());
    }
    await act(async () => { release(); await pending; });
    expect(native.restart).not.toHaveBeenCalled();
  });
  it("starts an opt-in JFR profile only with the selected JDK capability", async () => {
    const native = port();
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
      ...context,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      flightRecorder: true,
      reason: null,
    }));
    const hook = renderHook(() =>
      useJavaExecutionController({ ...props, port: native, prepare: async () => {} }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.flightRecorder).toBe(true));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "example.Main",
        classPath: [],
      });
    });
    await act(() => hook.result.current.start("run", true));
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "run", profile: true }),
    );
  });
  it("drops JFR analysis returned after the workspace session changes", async () => {
    const native = port();
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
      ...context,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      flightRecorder: true,
      reason: null,
    }));
    const profilePath = ".ide/flight-recordings/session/recording.jfr";
    const completed: JavaExecutionSnapshot = {
      ...props,
      sessionId: "jfr-one",
      operation: "run",
      state: "succeeded",
      output: "finished",
      outputTruncated: false,
      exitCode: 0,
      profilePath,
    };
    vi.mocked(native.start).mockResolvedValue(completed);
    let resolveAnalysis!: (summary: JavaFlightRecordingSummary) => void;
    native.analyzeFlightRecording = vi.fn(
      () =>
        new Promise<JavaFlightRecordingSummary>((resolve) => {
          resolveAnalysis = resolve;
        }),
    );
    const hook = renderHook(
      (context) =>
        useJavaExecutionController({
          ...context,
          port: native,
          prepare: async () => undefined,
        }),
      { initialProps: props },
    );
    await waitFor(() => expect(hook.result.current.capabilities?.flightRecorder).toBe(true));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "Main",
        classPath: [],
      });
    });
    await act(async () => {
      await hook.result.current.start("run", true);
    });
    expect(hook.result.current.trusted).toBe(true);
    expect(hook.result.current.snapshot?.sessionId).toBe("jfr-one");
    expect(hook.result.current.canAnalyzeFlightRecording).toBe(true);
    let analysis!: Promise<void>;
    await act(async () => {
      analysis = hook.result.current.analyzeFlightRecording();
      await Promise.resolve();
    });
    expect(native.analyzeFlightRecording).toHaveBeenCalledOnce();
    hook.rerender({ ...props, workspaceId: "two", generation: 2 });
    await waitFor(() => expect(hook.result.current.snapshot).toBeNull());
    await act(async () => {
      resolveAnalysis({
        workspaceId: "one",
        generation: 1,
        sessionId: "jfr-one",
        profilePath,
        recordingVersion: "2.1",
        chunks: 1,
        startTime: "2026-10-18 12:00:00 (UTC)",
        duration: "1 s",
        events: [],
      });
      await analysis;
    });
    expect(hook.result.current.flightRecordingSummary).toBeNull();
  });
  it("reads a selected event type from the current trusted JFR session", async () => {
    const native = port();
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
      ...context,
      available: true,
      projectKind: "jdk",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      flightRecorder: true,
      reason: null,
    }));
    const profilePath = ".ide/flight-recordings/session/recording.jfr";
    vi.mocked(native.start).mockResolvedValue({
      ...props,
      sessionId: "jfr-events",
      operation: "run",
      state: "succeeded",
      output: "finished",
      outputTruncated: false,
      exitCode: 0,
      profilePath,
    });
    const summary: JavaFlightRecordingSummary = {
      ...props,
      sessionId: "jfr-events",
      profilePath,
      recordingVersion: "2.1",
      chunks: 1,
      startTime: "2026-10-20 12:00:00 (UTC)",
      duration: "1 s",
      events: [{ name: "jdk.GarbageCollection", count: 1, sizeBytes: 40 }],
    };
    const timeline: JavaFlightRecordingTimeline = {
      ...props,
      sessionId: "jfr-events",
      profilePath,
      eventType: "jdk.GarbageCollection",
      eventCount: 1,
      truncated: false,
      events: [
        {
          startTime: "2026-10-20T12:00:00.000+02:00",
          duration: "PT0.007S",
          threadName: "VM Thread",
          payload: [{ name: "cause", value: '"System.gc()"' }],
          payloadTruncated: false,
          stackFrames: [],
          stackTraceTruncated: false,
        },
      ],
    };
    native.analyzeFlightRecording = vi.fn(async () => summary);
    native.readFlightRecordingTimeline = vi.fn(async () => timeline);
    const hook = renderHook(() =>
      useJavaExecutionController({ ...props, port: native, prepare: async () => undefined }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.flightRecorder).toBe(true));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "Main",
        classPath: [],
      });
    });
    await act(async () => hook.result.current.start("run", true));
    await act(async () => hook.result.current.analyzeFlightRecording());
    await act(async () => hook.result.current.readFlightRecordingTimeline("jdk.GarbageCollection"));
    expect(native.readFlightRecordingTimeline).toHaveBeenCalledWith({
      workspaceId: props.workspaceId,
      generation: props.generation,
      sessionId: "jfr-events",
      trusted: true,
      eventType: "jdk.GarbageCollection",
    });
    expect(hook.result.current.flightRecordingTimeline).toEqual(timeline);
  });
  it("attaches without saving dirty buffers or consuming saved source breakpoints", async () => {
    const native = port();
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
      ...context,
      available: false,
      projectKind: "maven",
      jdk: true,
      maven: false,
      gradle: false,
      debugger: false,
      structuredDebugger: true,
      attachDebugger: true,
      reason: null,
    }));
    const live: JavaExecutionSnapshot = {
      ...props,
      sessionId: "external-one",
      operation: "attach",
      state: "running",
      exitCode: null,
      output: "",
      outputTruncated: false,
      debuggerState: debuggerState(),
    };
    vi.mocked(native.start).mockResolvedValue(live);
    vi.mocked(native.snapshot).mockResolvedValue(live);
    const prepare = vi.fn(async () => {
      throw new Error("A dirty editor must not be saved by Attach");
    });
    const points = vi.fn(() => [{ sourcePath: "Main.java", line: 2, fingerprint: "a".repeat(64) }]);
    const hook = renderHook(() =>
      useJavaExecutionController({ ...props, port: native, prepare, getSourceBreakpoints: points }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.attachDebugger).toBe(true));
    act(() =>
      hook.result.current.updateConfiguration({
        buildTool: "maven",
        mainClass: "",
        classPath: [],
        debuggerMode: "jdi",
        debuggerAttach: { host: "localhost", port: "5006" },
      }),
    );
    await act(() => hook.result.current.start("attach"));
    expect(native.start).not.toHaveBeenCalled();
    act(() => hook.result.current.setTrusted(true));
    await act(() => hook.result.current.start("attach"));
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "attach",
        trusted: true,
        configuration: expect.objectContaining({
          debuggerAttach: { host: "localhost", port: "5006" },
        }),
      }),
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(points).not.toHaveBeenCalled();
    expect(vi.mocked(native.start).mock.calls[0][0].sourceBreakpoints).toBeUndefined();
    await act(() =>
      hook.result.current.debugAction({ type: "watch", stopId: "stop-1", expression: "value" }),
    );
    expect(native.debugAction).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "external-one",
        action: { type: "watch", stopId: "stop-1", expression: "value" },
      }),
    );
    // Command-palette and function-key steps use the controller directly, bypassing the panel.
    act(() => hook.result.current.setStepFilterText("java.*\njdk.*"));
    await act(() => hook.result.current.debugAction({ type: "step", stopId: "stop-1", kind: "into" }));
    expect(native.debugAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { type: "step", stopId: "stop-1", kind: "into", exclusionFilters: ["java.*", "jdk.*"] },
    }));
    act(() => hook.result.current.setStepFilterText(Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i).repeat(400)).join("\n")));
    const calls = vi.mocked(native.debugAction!).mock.calls.length;
    await act(() => hook.result.current.debugAction({ type: "step", stopId: "stop-1", kind: "over" }));
    expect(native.debugAction).toHaveBeenCalledTimes(calls);
    expect(hook.result.current.error).toContain("Correct the step exclusion patterns");
    await act(() => hook.result.current.debugAction({ type: "continue", stopId: "stop-1" }));
    expect(native.debugAction).toHaveBeenCalledTimes(calls + 1);
    hook.unmount();
  });

  it("requires an explicit attachment advertisement from the current provider", async () => {
    const native = port(),
      prepare = vi.fn(async () => {});
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    await waitFor(() => expect(hook.result.current.capabilities).not.toBeNull());
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "",
        classPath: [],
        debuggerMode: "jdi",
      });
    });
    await act(() => hook.result.current.start("attach"));
    expect(hook.result.current.error).toContain("does not advertise");
    expect(native.start).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each(["captured", "changed", "jdb"] as const)(
    "prepares saved source breakpoints safely when %s",
    async (mode) => {
      const native = port(),
        point = { sourcePath: "Main.java", line: 2, fingerprint: "a".repeat(64) };
      let points = [point];
      const prepare = vi.fn(async () => {
        if (mode === "changed") points = [];
      });
      const hook = renderHook(() =>
        useJavaExecutionController({
          ...props,
          port: native,
          prepare,
          getSourceBreakpoints: () => points,
        }),
      );
      act(() => {
        hook.result.current.setTrusted(true);
        hook.result.current.updateConfiguration({
          buildTool: "jdk",
          mainClass: "Main",
          classPath: [],
          debuggerMode: mode === "jdb" ? "jdb" : "jdi",
        });
      });
      await act(() => hook.result.current.start("debug"));
      if (mode === "captured")
        expect(native.start).toHaveBeenCalledWith(
          expect.objectContaining({ operation: "debug", sourceBreakpoints: [point] }),
        );
      else expect(native.start).not.toHaveBeenCalled();
      if (mode === "changed")
        expect(hook.result.current.error).toContain("changed while preparing");
      if (mode === "jdb") {
        expect(hook.result.current.error).toContain("Structured Java debugger");
        expect(prepare).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["workspace", "unmount", "stopped"] as const)(
    "retires structured debugger callbacks after %s",
    async (retirement) => {
      const native = port();
      const live: JavaExecutionSnapshot = {
        ...failedSnapshot(),
        operation: "debug",
        state: "running",
        exitCode: null,
        testResults: undefined,
        debuggerState: debuggerState(),
      };
      vi.mocked(native.start).mockResolvedValue(live);
      vi.mocked(native.snapshot).mockImplementation(() => new Promise(() => {}));
      vi.mocked(native.stop).mockResolvedValue({
        ...live,
        state: "stopped",
        debuggerState: undefined,
      });
      const hook = renderHook(
        (context) =>
          useJavaExecutionController({ ...context, port: native, prepare: async () => {} }),
        { initialProps: props },
      );
      act(() => hook.result.current.setTrusted(true));
      await act(() => hook.result.current.start("debug"));
      const captured = hook.result.current.debugAction;
      const capturedStepFilterSetter = hook.result.current.setStepFilterText;
      if (retirement === "workspace")
        hook.rerender({ ...props, workspaceId: "two", generation: 2 });
      else if (retirement === "unmount") hook.unmount();
      else await act(() => hook.result.current.stop());
      act(() => capturedStepFilterSetter("java.*"));
      expect(hook.result.current.stepFilterText).toBe("");
      await act(() => captured({ type: "continue", stopId: "stop-1" }));
      expect(native.debugAction).not.toHaveBeenCalled();
    },
  );
  it("keeps polling with Java Run hidden and rejects errors and actions from a previous stop", async () => {
    const native = port();
    const live: JavaExecutionSnapshot = {
      ...failedSnapshot(),
      operation: "debug",
      state: "running",
      exitCode: null,
      testResults: undefined,
      debuggerState: debuggerState(),
    };
    let observed = live;
    let reject!: (error: Error) => void;
    vi.mocked(native.start).mockResolvedValue(live);
    vi.mocked(native.snapshot).mockImplementation(async () => observed);
    vi.mocked(native.debugAction!).mockImplementation(
      () =>
        new Promise((_, refuse) => {
          reject = refuse;
        }),
    );
    const hook = renderHook(
      (context) =>
        useJavaExecutionController({ ...context, port: native, prepare: async () => {} }),
      { initialProps: props },
    );
    act(() => hook.result.current.setTrusted(true));
    await act(() => hook.result.current.start("debug"));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.debugAction({
        type: "selectFrame",
        stopId: "stop-1",
        frameId: "stop-1:1:1",
      });
    });
    hook.rerender({ ...props, enabled: false });
    observed = { ...live, debuggerState: { ...debuggerState(), stopId: "stop-2" } };
    await waitFor(() => expect(hook.result.current.snapshot?.debuggerState?.stopId).toBe("stop-2"));
    await act(async () => {
      reject(new Error("old frame unavailable"));
      await pending;
    });
    expect(hook.result.current.error).toBeNull();
    await act(() => hook.result.current.debugAction({ type: "continue", stopId: "stop-1" }));
    expect(native.debugAction).toHaveBeenCalledTimes(1);
  });
  it.each(["workspace", "unmount", "stopped"] as const)(
    "refuses a captured debugger callback after %s retirement",
    async (retirement) => {
      const native = port();
      const live: JavaExecutionSnapshot = {
        ...failedSnapshot(),
        operation: "debug",
        state: "running",
        exitCode: null,
        testResults: undefined,
      };
      vi.mocked(native.start).mockResolvedValue(live);
      vi.mocked(native.snapshot).mockImplementation(() => new Promise(() => {}));
      vi.mocked(native.stop).mockResolvedValue({ ...live, state: "stopped" });
      const hook = renderHook(
        (context) =>
          useJavaExecutionController({ ...context, port: native, prepare: async () => {} }),
        { initialProps: props },
      );
      act(() => hook.result.current.setTrusted(true));
      await act(() => hook.result.current.start("debug"));
      const captured = hook.result.current.debugCommand;
      if (retirement === "workspace")
        hook.rerender({ ...props, workspaceId: "two", generation: 2 });
      else if (retirement === "unmount") hook.unmount();
      else await act(() => hook.result.current.stop());
      await act(() => captured("cont"));
      expect(native.debugCommand).not.toHaveBeenCalled();
    },
  );
  it("does not report an old debugger command rejection in a replacement session", async () => {
    const native = port();
    const live: JavaExecutionSnapshot = {
      ...failedSnapshot(),
      operation: "debug",
      state: "running",
      exitCode: null,
      testResults: undefined,
    };
    vi.mocked(native.start)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({ ...live, sessionId: "java-two" });
    vi.mocked(native.snapshot).mockImplementation(() => new Promise(() => {}));
    vi.mocked(native.stop).mockResolvedValue({ ...live, state: "stopped" });
    let reject!: (error: Error) => void;
    vi.mocked(native.debugCommand).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const hook = renderHook(() =>
      useJavaExecutionController({ ...props, port: native, prepare: async () => {} }),
    );
    act(() => hook.result.current.setTrusted(true));
    await act(() => hook.result.current.start("debug"));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.debugCommand("where");
    });
    await act(() => hook.result.current.stop());
    await act(() => hook.result.current.start("debug"));
    await act(async () => {
      reject(new Error("retired debugger"));
      await pending;
    });
    expect(hook.result.current.snapshot?.sessionId).toBe("java-two");
    expect(hook.result.current.error).toBeNull();
  });

  it("retires a discovered selection when the workspace changes during source saving", async () => {
    const native = port(),
      prepare = vi.fn(async (): Promise<void> => undefined);
    vi.mocked(native.start).mockResolvedValueOnce({
      ...failedSnapshot(),
      operation: "discover",
      state: "succeeded",
      exitCode: 0,
      testResults: undefined,
      testDiscovery: {
        status: "ready",
        projectPath: "module",
        buildTool: "maven",
        scope: "engines",
        message: null,
        tests: [
          {
            id: "selected",
            kind: "method",
            className: "Test",
            methodName: "selected",
            label: "selected",
          },
        ],
      },
    });
    const hook = renderHook(
      (current) => useJavaExecutionController({ ...current, port: native, prepare }),
      { initialProps: props },
    );
    act(() => hook.result.current.setTrusted(true));
    await act(() => hook.result.current.start("discover"));
    let finish!: () => void;
    prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.runDiscovered("selected");
    });
    hook.rerender({ ...props, generation: 2 });
    await act(async () => {
      finish();
      await pending;
    });
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(hook.result.current.snapshot).toBeNull();
    expect(hook.result.current.trusted).toBe(false);
  });
  it("saves before discovery and delegates a captured selection despite later incomplete settings", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    vi.mocked(native.start).mockResolvedValueOnce({
      ...failedSnapshot(),
      operation: "discover",
      state: "succeeded",
      exitCode: 0,
      testResults: undefined,
      testDiscovery: {
        status: "ready",
        projectPath: "module",
        buildTool: "maven",
        scope: "engines",
        message: null,
        tests: [
          {
            id: "selected",
            kind: "method",
            className: "Test",
            methodName: "selected",
            label: "selected",
          },
        ],
      },
    }).mockResolvedValueOnce({
      ...failedSnapshot(),
      sessionId: "selected-coverage",
      operation: "coverage",
      state: "succeeded",
      exitCode: 0,
      coverage: coverage(),
    });
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.renameConfiguration("Discovered tests");
      hook.result.current.updateConfiguration({
        buildTool: "maven",
        mainClass: "",
        classPath: [],
        testJvmOptions: ["-Xmx96m"],
      });
    });
    await act(() => hook.result.current.start("discover"));
    expect(prepare).toHaveBeenCalledTimes(1);
    act(() => {
      hook.result.current.createConfiguration(true);
      hook.result.current.renameConfiguration("Other tests");
      hook.result.current.updateConfiguration({
        ...hook.result.current.configuration,
        testJvmOptions: [""],
      });
    });
    await act(() => hook.result.current.runDiscovered("unknown"));
    expect(native.start).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.updateCoverageThresholds({ lines: "101", branches: "", instructions: "" }));
    await act(() => hook.result.current.runDiscovered("selected", true));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(hook.result.current.error).toMatch(/0 to 100/);
    act(() => hook.result.current.updateCoverageThresholds({ lines: "", branches: "75", instructions: "" }));
    await act(() => hook.result.current.runDiscovered("selected", true));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(native.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: "coverage",
        testSelection: { discoverySessionId: "java-one", testId: "selected" },
        trusted: true,
      }),
    );
    expect(hook.result.current.sessionConfigurationName).toBe("Discovered tests");
    expect(hook.result.current.coverageHistory[0]).toMatchObject({
      sessionId: "selected-coverage",
      configurationName: "Discovered tests",
    });
    expect(hook.result.current.coverageThresholdCheck?.settings.branches).toBe("75");
  });
  it("refuses discovery with incomplete test JVM settings before saving", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({
        buildTool: "maven",
        mainClass: "",
        classPath: [],
        testJvmOptions: [""],
      });
    });
    await act(() => hook.result.current.start("discover"));
    expect(prepare).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/JVM option/);
  });
  it("retains incomplete test JVM drafts, refuses testing before Save and permits application execution", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    const settings = {
      buildTool: "maven" as const,
      mainClass: "Main",
      classPath: [],
      testJvmOptions: [""],
    };
    localStorage.setItem("ide.java.launch.one", JSON.stringify(settings));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    expect(hook.result.current.configuration.testJvmOptions).toEqual([""]);
    act(() => hook.result.current.setTrusted(true));
    await act(async () => hook.result.current.start("test"));
    expect(prepare).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/Empty rows/);
    await act(async () => hook.result.current.start("run"));
    expect(prepare).toHaveBeenCalledOnce();
    act(() =>
      hook.result.current.updateConfiguration({
        ...settings,
        testJvmOptions: ["-Xmx96m", "-Dliteral=😀"],
      }),
    );
    await act(async () => hook.result.current.start("test"));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "test",
        configuration: expect.objectContaining({ testJvmOptions: ["-Xmx96m", "-Dliteral=😀"] }),
      }),
    );
  });
  it("restores incomplete JVM option drafts and refuses them before source-save preparation", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    const settings = {
      buildTool: "jdk" as const,
      mainClass: "Main",
      classPath: [],
      jvmOptions: [""],
    };
    localStorage.setItem("ide.java.launch.one", JSON.stringify(settings));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    expect(hook.result.current.configuration.jvmOptions).toEqual([""]);
    act(() => hook.result.current.setTrusted(true));
    await act(async () => hook.result.current.start("run"));
    expect(prepare).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/Empty rows/);
    await act(async () => hook.result.current.start("build"));
    expect(prepare).toHaveBeenCalledOnce();
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "build", configuration: settings }),
    );
    act(() =>
      hook.result.current.updateConfiguration({
        ...settings,
        jvmOptions: ["-Xmx96m", "-Dnote=literal 😀"],
      }),
    );
    await act(async () => hook.result.current.start("debug"));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "debug",
        configuration: expect.objectContaining({ jvmOptions: ["-Xmx96m", "-Dnote=literal 😀"] }),
      }),
    );
  });
  it("restores an incomplete settings draft without granting execution or trust", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    const settings = {
      buildTool: "jdk" as const,
      mainClass: "Main",
      classPath: [],
      jdkHome: "/unfinished",
      environment: [{ name: "", value: "draft" }],
    };
    localStorage.setItem("ide.java.launch.one", JSON.stringify(settings));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    expect(hook.result.current.configuration).toEqual(settings);
    expect(hook.result.current.trusted).toBe(false);
    act(() => hook.result.current.setTrusted(true));
    await act(async () => {
      await hook.result.current.start("run");
    });
    expect(native.start).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/environment names/);
  });
  it("persists and sends literal arguments, environment and JDK selection while refusing invalid settings before saving", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    const settings = {
      buildTool: "jdk" as const,
      mainClass: "Main",
      classPath: [],
      jdkHome: "/opt/jdk-21",
      programArguments: ["", "two words", "both'\"quotes\n😀"],
      jvmOptions: ["-Xmx96m", "-Dproperty=literal"],
      environment: [{ name: "MODE", value: "literal = spaced" }],
    };
    localStorage.setItem("ide.java.launch.one", JSON.stringify(settings));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    expect(hook.result.current.configuration).toEqual(settings);
    await waitFor(() =>
      expect(native.getCapabilities).toHaveBeenCalledWith({
        workspaceId: "one",
        generation: 1,
        projectPath: "",
        jdkHome: "/opt/jdk-21",
      }),
    );
    act(() => hook.result.current.setTrusted(true));
    await act(async () => {
      await hook.result.current.start("run");
    });
    expect(native.start).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      operation: "run",
      configuration: settings,
      trusted: true,
    });
    act(() =>
      hook.result.current.updateConfiguration({
        ...settings,
        environment: [{ name: "JAVA_HOME", value: "/other" }],
      }),
    );
    await act(async () => {
      await hook.result.current.start("run");
    });
    expect(native.start).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(hook.result.current.error).toMatch(/JDK directory/);
    expect(
      JSON.parse(localStorage.getItem(javaConfigurationsStorageKey("one"))!).configurations[0]
        .configuration.programArguments,
    ).toEqual(settings.programArguments);
  });
  it("pins saved coverage thresholds to the executed configuration and preserves the tool outcome", async () => {
    const native = port();
    vi.mocked(native.start).mockImplementation(async (request) => ({
      ...failedSnapshot(), operation: request.operation, sessionId: "threshold-run", state: "succeeded", exitCode: 0, coverage: coverage(),
    }));
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare: vi.fn(async () => undefined) }));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateCoverageThresholds({ lines: "", branches: "75", instructions: "" });
    });
    await act(async () => hook.result.current.start("coverage"));
    expect(hook.result.current.coverageThresholdCheck?.status).toBe("failed");
    expect(hook.result.current.snapshot).toMatchObject({ state: "succeeded", exitCode: 0 });
    act(() => hook.result.current.updateCoverageThresholds({ lines: "", branches: "40", instructions: "" }));
    expect(hook.result.current.coverageThresholdCheck?.settings.branches).toBe("75");
    expect(hook.result.current.coverageThresholdCheck?.status).toBe("failed");
    act(() => hook.result.current.createConfiguration(true));
    expect(hook.result.current.coverageThresholds.branches).toBe("40");
    const saved = JSON.parse(localStorage.getItem(javaConfigurationsStorageKey("one"))!);
    expect(saved.configurations[0].coverageThresholds.branches).toBe("40");
    await act(async () => hook.result.current.start("coverage"));
    expect(hook.result.current.coverageThresholdCheck?.status).toBe("passed");
    expect(vi.mocked(native.start).mock.calls[0][0].configuration).not.toHaveProperty("coverageThresholds");
    hook.unmount();
    const restored = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare: vi.fn(async () => undefined) }));
    await waitFor(() => expect(restored.result.current.capabilities).not.toBeNull());
    expect(restored.result.current.coverageThresholds.branches).toBe("40");
    expect(restored.result.current.coverageThresholdCheck).toBeNull();
  });
  it("refuses invalid coverage thresholds before saving sources, while build actions remain available", async () => {
    const native = port(), prepare = vi.fn(async () => undefined);
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateCoverageThresholds({ lines: "101", branches: "", instructions: "" });
    });
    await act(async () => hook.result.current.start("coverage"));
    expect(hook.result.current.error).toMatch(/0 to 100/);
    expect(prepare).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
    await act(async () => hook.result.current.start("build"));
    expect(native.start).toHaveBeenCalledOnce();
    expect(hook.result.current.coverageThresholdCheck).toBeNull();
  });
  it.each(["rerunFailed", "restart"] as const)("retains original coverage thresholds when using %s after configuration changes", async (action) => {
    const native = port();
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
      ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, reason: null, restartExecution: true,
    }));
    vi.mocked(native.start).mockResolvedValue({ ...failedSnapshot(), operation: "coverage", coverage: coverage() });
    const result: JavaExecutionSnapshot = { ...failedSnapshot(), operation: "coverage", sessionId: "rerun", state: "succeeded", exitCode: 0, coverage: coverage() };
    vi.mocked(native.rerunFailed).mockResolvedValue(result);
    native.restart = vi.fn(async () => result);
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare: vi.fn(async () => undefined) }));
    await waitFor(() => expect(hook.result.current.capabilities?.restartExecution).toBe(true));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateCoverageThresholds({ lines: "", branches: "75", instructions: "" });
    });
    await act(async () => hook.result.current.start("coverage"));
    act(() => hook.result.current.updateCoverageThresholds({ lines: "", branches: "40", instructions: "" }));
    await act(async () => hook.result.current[action]());
    expect(native[action]).toHaveBeenCalledOnce();
    expect(hook.result.current.coverageThresholdCheck?.settings.branches).toBe("75");
    expect(hook.result.current.coverageThresholdCheck?.status).toBe("failed");
  });
  it.each(["test", "coverage", "integration-coverage"] as const)(
    "saves edits and reruns the captured %s session despite new form settings",
    async (operation) => {
      const native = port(),
        prepare = vi.fn(async () => undefined);
      vi.mocked(native.start).mockResolvedValueOnce({
        ...failedSnapshot(),
        operation,
        coverage: ["coverage", "integration-coverage"].includes(operation) ? coverage() : undefined,
      });
      vi.mocked(native.rerunFailed).mockResolvedValueOnce({
        ...failedSnapshot(),
        operation,
        sessionId: "java-two",
        state: "starting",
        exitCode: null,
        testResults: undefined,
      });
      const hook = renderHook(() =>
        useJavaExecutionController({ ...props, port: native, prepare }),
      );
      act(() => hook.result.current.setTrusted(true));
      await act(async () => {
        await hook.result.current.start(operation);
      });
      act(() =>
        hook.result.current.updateConfiguration({
          buildTool: "gradle",
          mainClass: "Other",
          classPath: [],
          projectPath: "elsewhere",
        }),
      );
      await act(async () => {
        await hook.result.current.rerunFailed();
      });
      expect(native.rerunFailed).toHaveBeenCalledWith({
        workspaceId: "one",
        generation: 1,
        sessionId: "java-one",
        trusted: true,
      });
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(prepare.mock.invocationCallOrder[1]).toBeLessThan(
        vi.mocked(native.rerunFailed).mock.invocationCallOrder[0],
      );
      expect(hook.result.current.snapshot?.sessionId).toBe("java-two");
      expect(hook.result.current.snapshot?.operation).toBe(operation);
      expect(native.start).toHaveBeenCalledOnce();
    },
  );
  it("refuses failed-test reruns after trust is withdrawn or report evidence is incomplete", async () => {
    const native = port(),
      prepare = vi.fn(async () => undefined);
    vi.mocked(native.start).mockResolvedValueOnce(failedSnapshot());
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    act(() => hook.result.current.setTrusted(true));
    await act(async () => {
      await hook.result.current.start("test");
    });
    act(() => hook.result.current.setTrusted(false));
    await act(async () => {
      await hook.result.current.rerunFailed();
    });
    expect(hook.result.current.error).toMatch(/trust/);
    expect(native.rerunFailed).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledOnce();
    act(() => hook.result.current.setTrusted(true));
    vi.mocked(native.start).mockResolvedValueOnce({
      ...failedSnapshot(),
      testResults: {
        ...failedSnapshot().testResults!,
        status: "partial",
        canRerunFailed: false,
        message: "Incomplete.",
      },
    });
    await act(async () => {
      await hook.result.current.start("test");
      await hook.result.current.rerunFailed();
    });
    expect(native.rerunFailed).not.toHaveBeenCalled();
  });
  it("drops a rerun while saving if the workspace changes", async () => {
    const native = port();
    let finish!: () => void;
    const prepare = vi.fn(async (): Promise<void> => undefined);
    vi.mocked(native.start).mockResolvedValueOnce(failedSnapshot());
    const hook = renderHook(
      (current) => useJavaExecutionController({ ...current, port: native, prepare }),
      { initialProps: props },
    );
    act(() => hook.result.current.setTrusted(true));
    await act(async () => {
      await hook.result.current.start("test");
    });
    prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.rerunFailed();
    });
    hook.rerender({ ...props, generation: 2 });
    await act(async () => {
      finish();
      await pending;
    });
    expect(native.rerunFailed).not.toHaveBeenCalled();
    expect(hook.result.current.snapshot).toBeNull();
  });
  it("does not launch after unmount during saving and stops a native result arriving after unmount", async () => {
    for (const held of ["prepare", "native"]) {
      const native = port();
      let finish!: () => void;
      const prepare = vi.fn(async (): Promise<void> => undefined);
      if (held === "prepare")
        prepare.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
      else
        vi.mocked(native.start).mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return failedSnapshot();
        });
      vi.mocked(native.stop).mockResolvedValue({
        ...failedSnapshot(),
        state: "stopped",
        exitCode: null,
        testResults: undefined,
      });
      const hook = renderHook(() =>
        useJavaExecutionController({ ...props, port: native, prepare }),
      );
      act(() => hook.result.current.setTrusted(true));
      let pending!: Promise<void>;
      await act(async () => {
        pending = hook.result.current.start("test");
      });
      hook.unmount();
      await act(async () => {
        finish();
        await pending;
      });
      if (held === "prepare") expect(native.start).not.toHaveBeenCalled();
      else
        expect(native.stop).toHaveBeenCalledWith({
          workspaceId: "one",
          generation: 1,
          sessionId: "java-one",
        });
    }
  });
  it("does no capability work while the Java activity is closed", () => {
    const native = port();
    renderHook(() =>
      useJavaExecutionController({
        ...props,
        enabled: false,
        port: native,
        prepare: async () => undefined,
      }),
    );
    expect(native.getCapabilities).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });
  it("requires trust before invoking any native executor", async () => {
    const native = port();
    const prepare = vi.fn(async () => undefined);
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    await act(async () => {
      await hook.result.current.start("build");
    });
    expect(hook.result.current.error).toMatch(/trust/);
    expect(prepare).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });
  it("saves buffers before sending a correlated request and presents only returned output", async () => {
    const native = port();
    const prepare = vi.fn(async () => undefined);
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "Main",
        classPath: [],
      });
    });
    await act(async () => {
      await hook.result.current.start("run");
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(native.start).toHaveBeenCalledWith({
      workspaceId: "one",
      generation: 1,
      operation: "run",
      trusted: true,
      configuration: { buildTool: "jdk", mainClass: "Main", classPath: [] },
    });
    expect(hook.result.current.snapshot?.output).toBe("real boundary output");
    expect(hook.result.current.pending).toBe(false);
  });
  it("does not invoke execution after a failed save", async () => {
    const native = port();
    const hook = renderHook(() =>
      useJavaExecutionController({
        ...props,
        port: native,
        prepare: async () => {
          throw new Error("External file conflict");
        },
      }),
    );
    act(() => hook.result.current.setTrusted(true));
    await act(async () => {
      await hook.result.current.start("build");
    });
    expect(hook.result.current.error).toBe("External file conflict");
    expect(native.start).not.toHaveBeenCalled();
  });
  it("discards results and revokes trust when the workspace changes", async () => {
    const native = port();
    let finish!: (value: JavaExecutionSnapshot) => void;
    vi.mocked(native.start).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(
      (current) =>
        useJavaExecutionController({ ...current, port: native, prepare: async () => undefined }),
      { initialProps: props },
    );
    act(() => hook.result.current.setTrusted(true));
    let running!: Promise<void>;
    await act(async () => {
      running = hook.result.current.start("run");
    });
    hook.rerender({ ...props, workspaceId: "two", generation: 2 });
    await act(async () => {
      finish({
        workspaceId: "one",
        generation: 1,
        sessionId: "java-one",
        operation: "run",
        state: "succeeded",
        exitCode: 0,
        output: "old",
        outputTruncated: false,
      });
      await running;
    });
    expect(hook.result.current.snapshot).toBe(null);
    expect(hook.result.current.trusted).toBe(false);
  });
  it("restores launch settings independently for each workspace", async () => {
    const native = port();
    localStorage.setItem(
      "ide.java.launch.one",
      JSON.stringify({ buildTool: "maven", mainClass: "example.Main", classPath: ["lib/a.jar"] }),
    );
    const hook = renderHook(
      (current) =>
        useJavaExecutionController({ ...current, port: native, prepare: async () => undefined }),
      { initialProps: props },
    );
    expect(hook.result.current.configuration.mainClass).toBe("example.Main");
    hook.rerender({ ...props, workspaceId: "two", generation: 2 });
    expect(hook.result.current.configuration.mainClass).toBe("");
    await waitFor(() => expect(hook.result.current.capabilities?.workspaceId).toBe("two"));
  });
  it("probes the selected module, ignores an obsolete probe and persists the test selection", async () => {
    const native = port();
    let finishRoot!: (value: Awaited<ReturnType<JavaExecutionPort["getCapabilities"]>>) => void;
    vi.mocked(native.getCapabilities).mockImplementation((context) =>
      context.projectPath === ""
        ? new Promise((resolve) => {
            finishRoot = resolve;
          })
        : Promise.resolve({
            ...context,
            available: true,
            projectKind: "maven",
            jdk: true,
            maven: true,
            gradle: false,
            debugger: false,
            reason: null,
          }),
    );
    const hook = renderHook(() =>
      useJavaExecutionController({
        ...props,
        port: native,
        prepare: async () => undefined,
      }),
    );
    act(() =>
      hook.result.current.updateConfiguration({
        buildTool: "auto",
        mainClass: "example.Main",
        classPath: [],
        projectPath: "modules/service",
        testFilter: "example.MainTest#computes",
      }),
    );
    await waitFor(() => expect(hook.result.current.capabilities?.projectKind).toBe("maven"));
    await act(async () =>
      finishRoot({
        ...props,
        projectPath: "",
        available: true,
        projectKind: "jdk",
        jdk: true,
        maven: false,
        gradle: false,
        debugger: true,
        reason: null,
      }),
    );
    expect(hook.result.current.capabilities?.projectPath).toBe("modules/service");
    expect(
      JSON.parse(localStorage.getItem(javaConfigurationsStorageKey("one"))!).configurations[0]
        .configuration,
    ).toMatchObject({
      projectPath: "modules/service",
      testFilter: "example.MainTest#computes",
    });
    act(() => hook.result.current.setTrusted(true));
    await act(async () => hook.result.current.start("test"));
    expect(native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          projectPath: "modules/service",
          testFilter: "example.MainTest#computes",
        }),
      }),
    );
  });
  it.each([
    null,
    { buildTool: "jdk", mainClass: "Main", classPath: [], projectPath: 4 },
    { buildTool: "jdk", mainClass: "Main", classPath: [], testFilter: [] },
  ])("ignores malformed stored project or test settings", async (value) => {
    localStorage.setItem("ide.java.launch.one", JSON.stringify(value));
    const native = port();
    const hook = renderHook(() =>
      useJavaExecutionController({
        ...props,
        port: native,
        prepare: async () => undefined,
      }),
    );
    expect(hook.result.current.configuration).toEqual({
      buildTool: "auto",
      mainClass: "",
      classPath: [],
    });
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
  });
});

describe("synchronized project execution", () => {
  async function setupProject(restartExecution = false) {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    let settings = {
      projectPath: "maven",
      sdkHome: "/jdk-21",
      mavenRepository: "/repository",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    } as import("@ide/contracts").JavaProjectContextSettings;
    const response = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "fresh-launch",
    });
    response.context.snapshotHash = "d".repeat(64);
    response.context.contextHash = "e".repeat(64);
    const native = port(),
      prepare = vi.fn(async () => undefined),
      refresh = vi.fn(async () => response.context);
    if (restartExecution) {
      vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({
        ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, reason: null, restartExecution,
      }));
    }
    let projectContextValue: typeof response.context | null = response.context;
    const project = {
      settings,
      get context() {
        return projectContextValue;
      },
      getSettings: () => settings,
      refresh,
      pauseMonitoring: vi.fn(async () => undefined),
      retire: vi.fn(() => {
        projectContextValue = null;
      }),
    };
    const { createEditorStore } = await import("@ide/web-core");
    const { EditorViewModel } = await import("@ide/web-core");
    const store = createEditorStore();
    const editor = new EditorViewModel(store.getState, {
      loadContent: async (filePath) => ({ filePath, content: "saved", language: "java" }),
      saveContent: async () => store.getState().openFiles,
      getOpenFiles: async () => [],
      closeFile: async () => [],
    });
    await editor.openFile("Runner.java");
    const reviewSavedBuffers = vi.fn(() => editor.reviewSavedBuffers());
    const hook = renderHook(
      (p) =>
        useJavaExecutionController({
          ...p,
          port: native,
          prepare,
          projectContext: project,
          reviewSavedBuffers,
          captureCoverageSources: () => {
            const capture = editor.captureEditorBuffers({ allowNewBuffers: true });
            return {
              filePaths: capture.documents.map((document) => document.path),
              verify: capture.verify,
              isDocumentCurrent: capture.isDocumentCurrent,
            };
          },
        }),
      { initialProps: props },
    );
    act(() => {
      hook.result.current.updateConfiguration({
        buildTool: "jdk",
        mainClass: "pkg.Runner",
        classPath: [],
        jdkHome: "/old-jdk",
        projectModule: { moduleId: "app", sourceSetId: "main" },
      });
      hook.result.current.setTrusted(true);
    });
    await waitFor(() => expect(hook.result.current.capabilities?.jdk).toBe(true));
    return {
      hook,
      native,
      prepare,
      refresh,
      response,
      project,
      settings,
      editor,
      reviewSavedBuffers,
      setSettings: (value: typeof settings) => {
        settings = value;
      },
    };
  }
  it("refreshes tool capabilities when the synchronized project's selected Gradle executable changes", async () => {
    const h = await setupProject();
    for (const executable of ["/selected/gradle", "/another/gradle"]) {
      const settings = { ...h.settings, gradle: { executable, userHome: "/gradle-cache", projectProperties: {} } };
      h.project.settings = settings;
      h.setSettings(settings);
      h.hook.rerender(props);
      await waitFor(() => expect(h.native.getCapabilities).toHaveBeenLastCalledWith(
        expect.objectContaining({ gradleExecutable: executable }),
      ));
    }
  });
  it("saves before refreshing metadata and uses fresh authority without persisting it", async () => {
    const h = await setupProject();
    const events: string[] = [];
    h.reviewSavedBuffers.mockImplementation(() => {
      events.push("review");
      return () => events.push("verify");
    });
    h.project.pauseMonitoring.mockImplementation(async () => {
      events.push("pause-monitoring");
    });
    h.prepare.mockImplementation(async () => {
      events.push("save");
    });
    h.refresh.mockImplementation(async () => {
      events.push("context");
      return h.response.context;
    });
    await act(() => h.hook.result.current.start("run"));
    expect(events).toEqual([
      "pause-monitoring",
      "save",
      "review",
      "verify",
      "context",
      "verify",
    ]);
    expect(h.refresh).toHaveBeenCalledWith(
      h.settings,
      expect.objectContaining({ providerId: "maven-effective-v1", moduleId: "app" }),
      { afterSavedBufferReview: true },
    );
    expect(h.native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          buildTool: "auto",
          jdkHome: "/jdk-21",
          projectPath: "maven",
        }),
        projectContext: expect.objectContaining({
          providerId: "maven-effective-v1",
          moduleId: "app",
          sourceSetId: "main",
          context: expect.objectContaining({
            snapshotHash: "d".repeat(64),
            contextHash: "e".repeat(64),
          }),
        }),
      }),
    );
    const stored = localStorage.getItem(javaConfigurationsStorageKey("one"))!;
    expect(stored).toContain("projectModule");
    expect(stored).not.toContain("snapshotHash");
    expect(stored).not.toContain("contextHash");
  });
  it("requests complete JPMS facts before a named-module Run or Debug", async () => {
    const h = await setupProject();
    act(() =>
      h.hook.result.current.updateConfiguration({
        ...h.hook.result.current.configuration,
        launchAsModule: true,
      }),
    );
    await act(() => h.hook.result.current.start("run"));
    expect(h.refresh).toHaveBeenCalledWith(
      h.settings,
      expect.objectContaining({ providerId: "maven-effective-v1", moduleId: "app" }),
      { afterSavedBufferReview: true, requiredFacts: ["jpms"] },
    );
    expect(h.native.start).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: expect.objectContaining({ launchAsModule: true }) }),
    );
  });
  it("keeps the exact launch snapshot available for debugger output suggestions until JDI ends", async () => {
    const h = await setupProject();
    const running: JavaExecutionSnapshot = {
      ...props,
      sessionId: "debug-module",
      operation: "debug",
      state: "running",
      exitCode: null,
      output: "debugger attached",
      outputTruncated: false,
      debuggerState: debuggerState(),
    };
    let finish!: (value: JavaExecutionSnapshot) => void;
    vi.mocked(h.native.start).mockResolvedValue(running);
    vi.mocked(h.native.snapshot).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );

    await act(() => h.hook.result.current.start("debug"));
    expect(h.project.context).toBeNull();
    expect(h.hook.result.current.projectContext?.settings).toEqual(h.settings);
    expect(h.hook.result.current.projectContext?.context).toBe(h.response.context);

    const completed = { ...running, state: "succeeded" as const, exitCode: 0 };
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => {
      finish(completed);
    });
    await waitFor(() => expect(h.hook.result.current.snapshot?.state).toBe("succeeded"));
    expect(h.hook.result.current.projectContext?.context).toBeNull();
  });
  it.each([false, true])("binds coverage to current sources and retires stale results after repeat (%s)", async (repeat) => {
    const h = await setupProject(repeat);
    const measured = coverage();
    measured.projectPath = "maven/app";
    const complete: JavaExecutionSnapshot = {
      ...props,
      sessionId: "coverage-module",
      operation: "coverage",
      state: "succeeded",
      exitCode: 0,
      output: "coverage complete",
      outputTruncated: false,
      coverage: measured,
    };
    vi.mocked(h.native.start).mockResolvedValue(complete);
    await act(() => h.hook.result.current.start("coverage"));
    expect(h.hook.result.current.coverageProjectContext).toMatchObject({
      workspaceId: "one",
      generation: 1,
      sessionId: "coverage-module",
      sourceFilesCurrent: true,
      sourcePaths: ["Runner.java"],
      settings: { projectPath: "maven" },
      context: { contextHash: "e".repeat(64) },
    });
    const reviewed = h.hook.result.current.coverageProjectContext!;
    expect(reviewed.isDocumentCurrent?.("Runner.java")).toBe(true);
    await act(() => h.editor.openFile("Unrelated.java"));
    act(() => h.editor.updateContent("Unrelated.java", "unrelated edit"));
    expect(reviewed.isDocumentCurrent?.("Runner.java")).toBe(true);
    await act(() => h.editor.updateContent("Unrelated.java", "saved"));
    await act(() => h.editor.closeFile("Unrelated.java"));
    act(() => {
      h.editor.updateContent("Runner.java", "edited");
      h.editor.updateContent("Runner.java", "saved");
    });
    expect(reviewed.isDocumentCurrent?.("Runner.java")).toBe(false);

    const running: JavaExecutionSnapshot = {
      ...complete,
      sessionId: "coverage-running",
      state: "running",
      coverage: undefined,
    };
    const captureCompletion: JavaExecutionSnapshot = { ...complete, sessionId: "coverage-running" };
    vi.mocked(h.native.start).mockResolvedValue(running);
    vi.mocked(h.native.snapshot).mockResolvedValue(captureCompletion);
    if (repeat) {
      h.native.restart = vi.fn(async () => running);
      await act(() => h.hook.result.current.restart());
      expect(h.native.restart).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "coverage-module" }));
      expect(h.native.start).toHaveBeenCalledOnce();
    } else {
      await act(() => h.hook.result.current.start("coverage"));
    }
    expect(h.hook.result.current.coverageProjectContext).toMatchObject({
      sessionId: "coverage-running", sourceFilesCurrent: true, sourcePaths: ["Runner.java"],
    });
    act(() => h.editor.updateContent("Runner.java", "changed during coverage"));
    await waitFor(() => expect(h.hook.result.current.snapshot?.state).toBe("succeeded"));
    expect(h.hook.result.current.coverageProjectContext).toMatchObject({
      sessionId: "coverage-running",
      sourceFilesCurrent: false,
    });
  });
  it("retains synchronized project settings across failed-test reruns and refuses a later SDK change", async () => {
    const h = await setupProject();
    vi.mocked(h.native.start).mockResolvedValue({ ...failedSnapshot(), state: "starting", exitCode: null, testResults: undefined });
    vi.mocked(h.native.snapshot).mockResolvedValue(failedSnapshot());
    vi.mocked(h.native.rerunFailed).mockResolvedValue({ ...failedSnapshot(), sessionId: "second-failure" });
    await act(() => h.hook.result.current.start("test"));
    await waitFor(() => expect(h.hook.result.current.snapshot?.state).toBe("failed"));
    expect(h.native.start).toHaveBeenCalledOnce();
    h.project.pauseMonitoring.mockClear();
    await act(() => h.hook.result.current.rerunFailed());
    expect(h.native.rerunFailed).toHaveBeenCalledOnce();
    expect(h.project.pauseMonitoring).toHaveBeenCalledOnce();
    expect(h.hook.result.current.snapshot?.sessionId).toBe("second-failure");
    h.setSettings({ ...h.settings, sdkHome: "/changed-sdk" });
    await act(() => h.hook.result.current.rerunFailed());
    expect(h.native.rerunFailed).toHaveBeenCalledOnce();
    expect(h.hook.result.current.error).toContain("project settings changed");
  });
  it.each(["monitoring", "refresh", "verification"] as const)(
    "refuses synchronized launch when trust is withdrawn during %s", async phase => {
      const h = await setupProject();
      if (phase === "monitoring") h.project.pauseMonitoring.mockImplementationOnce(async () => {
        h.hook.result.current.setTrusted(false);
      });
      if (phase === "refresh") h.refresh.mockImplementationOnce(async () => {
        h.hook.result.current.setTrusted(false);
        return h.response.context;
      });
      if (phase === "verification") h.reviewSavedBuffers.mockImplementationOnce(() => () => {
        h.hook.result.current.setTrusted(false);
      });
      await act(async () => h.hook.result.current.start("run"));
      expect(h.native.start).not.toHaveBeenCalled();
      if (phase === "monitoring") {
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.refresh).not.toHaveBeenCalled();
      }
      expect(h.project.retire).not.toHaveBeenCalled();
      expect(h.hook.result.current.error).toMatch(/trust/);
    },
  );
  it("does not save or acquire metadata without explicit execution trust", async () => {
    const h = await setupProject();
    act(() => h.hook.result.current.setTrusted(false));
    await act(() => h.hook.result.current.start("run"));
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.native.start).not.toHaveBeenCalled();
  });
  it("refuses a project JDK change while saving before acquiring launch metadata", async () => {
    const h = await setupProject();
    h.prepare.mockImplementation(async () => {
      h.setSettings({ ...h.settings, sdkHome: "/jdk-25" });
    });
    await act(() => h.hook.result.current.start("debug"));
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.native.start).not.toHaveBeenCalled();
    expect(h.hook.result.current.error).toContain("changed while saving");
  });
  it("refuses partial metadata rather than using the manual classpath", async () => {
    const h = await setupProject();
    h.response.context.status = "partial";
    await act(() => h.hook.result.current.start("run"));
    expect(h.native.start).not.toHaveBeenCalled();
    expect(h.hook.result.current.error).toContain("effective Java project context");
  });
  it("refuses a module removed by fresh project metadata", async () => {
    const h = await setupProject();
    h.response.context.modules = [];
    await act(() => h.hook.result.current.start("test"));
    expect(h.native.start).not.toHaveBeenCalled();
    expect(h.hook.result.current.error).toContain("no longer exists");
  });
  it.each([false, true])(
    "refuses editor changes during project metadata acquisition even if restored (%s)",
    async (restore) => {
      const h = await setupProject();
      h.refresh.mockImplementation(async () => {
        h.editor.updateContent("Runner.java", "new draft");
        if (restore) {
          h.editor.updateContent("Runner.java", "saved");
          await h.editor.saveFile("Runner.java");
        }
        return h.response.context;
      });
      await act(() => h.hook.result.current.start("run"));
      expect(h.native.start).not.toHaveBeenCalled();
      expect(h.hook.result.current.error).toBeTruthy();
      expect(h.editor.openFiles).toHaveLength(1);
    },
  );
  it("suppresses a delayed launch context after workspace replacement", async () => {
    const h = await setupProject();
    let release!: (value: import("@ide/contracts").JavaEffectiveProjectContext) => void;
    h.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.hook.result.current.start("run");
    });
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    await act(async () => h.hook.rerender({ ...props, workspaceId: "two", generation: 2 }));
    await act(async () => {
      release(h.response.context);
      await pending;
    });
    expect(h.native.start).not.toHaveBeenCalled();
    expect(h.hook.result.current.snapshot).toBeNull();
  });
});

it("debugs a concrete test with JDI and saved breakpoints without changing application debugger settings", async () => {
  const native = port();
  vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({ ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, structuredDebugger: true, debugTests: true, reason: null }));
  const prepare = vi.fn(async () => {});
  const points = [{ sourcePath: "src/test/java/FixtureTest.java", line: 5, fingerprint: "a".repeat(64) }];
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare, getSourceBreakpoints: () => points }));
  act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ ...hook.result.current.configuration, buildTool: "maven", testFilter: "FixtureTest#selected", debuggerMode: "jdb" }); });
  await waitFor(() => expect(hook.result.current.capabilities?.debugTests).toBe(true));
  await act(() => hook.result.current.start("debug-test"));
  expect(prepare).toHaveBeenCalledWith("debug-test");
  expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ operation: "debug-test", configuration: expect.objectContaining({ testFilter: "FixtureTest#selected", debuggerMode: "jdi" }), sourceBreakpoints: points }));
  expect(hook.result.current.configuration.debuggerMode).toBe("jdb");
});

it.each(["unadvertised", "wildcard", "changed-breakpoint"])("refuses %s test debugging before native launch", async (refusal) => {
  const native = port();
  vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({ ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, structuredDebugger: true, ...(refusal !== "unadvertised" ? { debugTests: true } : {}), reason: null }));
  let line = 5;
  const prepare = vi.fn(async () => { if (refusal === "changed-breakpoint") line++; });
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare, getSourceBreakpoints: () => [{ sourcePath: "FixtureTest.java", line, fingerprint: "a".repeat(64) }] }));
  act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ ...hook.result.current.configuration, buildTool: "maven", testFilter: refusal === "wildcard" ? "FixtureTest#*" : "FixtureTest#selected" }); });
  await waitFor(() => expect(hook.result.current.capabilities?.structuredDebugger).toBe(true));
  await act(() => hook.result.current.start("debug-test"));
  expect(native.start).not.toHaveBeenCalled();
  expect(hook.result.current.error).toMatch(refusal === "unadvertised" ? /advertise test debugging/ : refusal === "wildcard" ? /one concrete test/ : /breakpoints changed/);
  if (refusal !== "changed-breakpoint") expect(prepare).not.toHaveBeenCalled();
});

it.each(["ready", "changed-breakpoint", "withdrawn-trust", "unsaved-buffer"] as const)(
  "uses current saved breakpoints and checks %s before rerunning a captured debug-test failure",
  async (condition) => {
    const native = port();
    vi.mocked(native.getCapabilities).mockImplementation(async (context) => ({ ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, structuredDebugger: true, debugTests: true, reason: null }));
    vi.mocked(native.start).mockResolvedValue({ ...failedSnapshot(), operation: "debug-test" });
    vi.mocked(native.rerunFailed).mockResolvedValue({ ...failedSnapshot(), operation: "debug-test", sessionId: "repaired", state: "starting", exitCode: null, testResults: undefined });
    let fingerprint = "a".repeat(64);
    const points = () => [{ sourcePath: "FixtureTest.java", line: 8, fingerprint }];
    const prepare = vi.fn(async () => {});
    const verify = vi.fn(() => { if (condition === "unsaved-buffer") throw new Error("Unsaved edits remain."); });
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare, getSourceBreakpoints: points, reviewSavedBuffers: () => verify }));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({ ...hook.result.current.configuration, buildTool: "maven", testFilter: "FixtureTest", debuggerMode: "jdb" });
    });
    await waitFor(() => expect(hook.result.current.capabilities?.debugTests).toBe(true));
    await act(() => hook.result.current.start("debug-test"));
    fingerprint = "b".repeat(64);
    act(() => hook.result.current.updateConfiguration({ ...hook.result.current.configuration, jdkHome: "/changed", testFilter: "OtherTest" }));
    prepare.mockImplementation(async () => {
      if (condition === "changed-breakpoint") fingerprint = "c".repeat(64);
      if (condition === "withdrawn-trust") hook.result.current.setTrusted(false);
    });
    await act(() => hook.result.current.rerunFailed());
    if (condition === "ready") {
      expect(native.rerunFailed).toHaveBeenCalledWith({ workspaceId: "one", generation: 1, sessionId: "java-one", trusted: true, sourceBreakpoints: points() });
      expect(hook.result.current.snapshot?.sessionId).toBe("repaired");
      expect(verify).toHaveBeenCalled();
    } else {
      expect(native.rerunFailed).not.toHaveBeenCalled();
      expect(hook.result.current.error).toMatch(condition === "changed-breakpoint" ? /breakpoints changed/ : condition === "withdrawn-trust" ? /trust was withdrawn/ : /Unsaved edits/);
    }
  },
);

it.each(["test", "coverage", "integration-test", "integration-coverage"] as const)(
  "debugs failed selections from the captured %s session with current saved breakpoints",
  async (operation) => {
    const native = port();
    const prepare = vi.fn(async () => {});
    const points = [{ sourcePath: "FixtureTest.java", line: 8, fingerprint: "b".repeat(64) }];
    const target = operation.startsWith("integration-") ? "debug-integration-test" : "debug-test";
    vi.mocked(native.start).mockResolvedValue({ ...failedSnapshot(), operation, canDebugFailedTests: true });
    vi.mocked(native.rerunFailed).mockResolvedValue({ ...failedSnapshot(), operation: target, sessionId: "debug-failures", state: "starting", exitCode: null, testResults: undefined });
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare, getSourceBreakpoints: () => points }));
    act(() => {
      hook.result.current.setTrusted(true);
      if (operation.startsWith("integration-")) hook.result.current.updateConfiguration({ ...hook.result.current.configuration, buildTool: "maven" });
    });
    await act(() => hook.result.current.start(operation));
    act(() => hook.result.current.updateConfiguration({ ...hook.result.current.configuration, jdkHome: "/current-other-jdk", projectPath: "other", testFilter: "Other#mustNotRun" }));
    await act(() => hook.result.current.rerunFailed(true));
    expect(prepare).toHaveBeenLastCalledWith(target);
    expect(native.rerunFailed).toHaveBeenCalledWith({ workspaceId: "one", generation: 1, sessionId: "java-one", trusted: true, debug: true, sourceBreakpoints: points });
    expect(hook.result.current.snapshot?.operation).toBe(target);
    expect(hook.result.current.snapshot?.sessionId).toBe("debug-failures");
    expect(hook.result.current.coverageProjectContext).toBeNull();
    expect(hook.result.current.configuration.jdkHome).toBe("/current-other-jdk");
  },
);
it("withholds debugging failed tests without the captured native capability", async () => {
  const native = port(), prepare = vi.fn(async () => {});
  vi.mocked(native.start).mockResolvedValue(failedSnapshot());
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
  act(() => hook.result.current.setTrusted(true));
  await act(() => hook.result.current.start("test"));
  await act(() => hook.result.current.rerunFailed(true));
  expect(native.rerunFailed).not.toHaveBeenCalled();
  expect(prepare).toHaveBeenCalledOnce();
});
it("stops a newly returned session with the wrong debug-test operation", async () => {
  const native = port();
  vi.mocked(native.start).mockResolvedValue({ ...failedSnapshot(), canDebugFailedTests: true });
  vi.mocked(native.rerunFailed).mockResolvedValue({ ...failedSnapshot(), sessionId: "unexpected", operation: "debug-integration-test" });
  vi.mocked(native.stop).mockResolvedValue({ ...failedSnapshot(), sessionId: "unexpected", operation: "debug-integration-test", state: "stopped" });
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare: async () => {} }));
  act(() => hook.result.current.setTrusted(true));
  await act(() => hook.result.current.start("test"));
  await act(() => hook.result.current.rerunFailed(true));
  expect(native.stop).toHaveBeenCalledWith({ workspaceId: "one", generation: 1, sessionId: "unexpected" });
  expect(hook.result.current.error).toContain("Invalid repeated Java test operation");
});

it.each((["clean", "rebuild"] as const).flatMap((operation) =>
  (["supported", "legacy", "jdk"] as const).map((mode) => ({ operation, mode }))))("checks $operation admission before saving: $mode", async ({ operation, mode }) => {
  const native = port();
  vi.mocked(native.getCapabilities).mockResolvedValue({ ...props, available: true, projectKind: mode === "jdk" ? "jdk" : "maven",
    jdk: true, maven: true, gradle: false, debugger: true, cleanProject: operation === "rebuild" || mode !== "legacy" ? true : undefined, rebuildProject: mode === "legacy" ? undefined : true, reason: null });
  const prepare = vi.fn(async () => {});
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
  await waitFor(() => expect(hook.result.current.capabilities).not.toBeNull());
  act(() => { hook.result.current.setTrusted(true); hook.result.current.updateConfiguration({ ...hook.result.current.configuration, buildTool: mode === "jdk" ? "jdk" : "maven" }); });
  await act(() => hook.result.current.start(operation));
  if (mode === "supported") {
    expect(prepare).toHaveBeenCalledWith(operation);
    expect(native.start).toHaveBeenCalledWith(expect.objectContaining({ operation }));
  } else {
    expect(prepare).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
    expect(hook.result.current.error).toContain(mode === "legacy" ? "does not advertise" : "requires a Maven or Gradle");
  }
});


it.each((["build", "clean", "rebuild", "run"] as const).flatMap(operation =>
  (["captured", "saving"] as const).map(phase => ({ operation, phase }))))(
  "refuses $operation when trust is withdrawn during $phase", async ({ operation, phase }) => {
    const native = port();
    vi.mocked(native.getCapabilities).mockResolvedValue({ ...props, available: true,
      projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true,
      cleanProject: true, rebuildProject: true, reason: null });
    const prepare = vi.fn(async () => {});
    const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
    await waitFor(() => expect(hook.result.current.capabilities?.maven).toBe(true));
    act(() => {
      hook.result.current.setTrusted(true);
      hook.result.current.updateConfiguration({ ...hook.result.current.configuration, buildTool: "maven", mainClass: "Main" });
    });
    const start = hook.result.current.start;
    if (phase === "captured") act(() => hook.result.current.setTrusted(false));
    else prepare.mockImplementationOnce(async () => { hook.result.current.setTrusted(false); });
    await act(async () => start(operation));
    expect(native.start).not.toHaveBeenCalled();
    if (phase === "captured") expect(prepare).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/trust/);
  },
);

it.each(["captured", "saving"] as const)("refuses discovered tests after trust withdrawal during %s", async phase => {
  const native = port();
  vi.mocked(native.start).mockResolvedValueOnce({ ...failedSnapshot(), operation: "discover",
    state: "succeeded", exitCode: 0, testResults: undefined,
    testDiscovery: { status: "ready", projectPath: "module", buildTool: "maven", scope: "engines", message: null,
      tests: [{ id: "selected", kind: "method", className: "Test", methodName: "selected", label: "selected" }] } });
  const prepare = vi.fn(async () => {});
  const hook = renderHook(() => useJavaExecutionController({ ...props, port: native, prepare }));
  act(() => hook.result.current.setTrusted(true));
  await act(async () => hook.result.current.start("discover"));
  const run = hook.result.current.runDiscovered;
  if (phase === "captured") act(() => hook.result.current.setTrusted(false));
  else prepare.mockImplementationOnce(async () => { hook.result.current.setTrusted(false); });
  await act(async () => run("selected"));
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledTimes(phase === "captured" ? 1 : 2);
  expect(hook.result.current.error).toMatch(/trust/);
});
