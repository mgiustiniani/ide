import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriJavaExecutionAdapter } from "./java-execution-tauri";
import { BrowserJavaExecutionAdapter } from "../../browser-adapters/src/java-execution-browser";
import { reports } from "./java-test-results.test-fixtures";
import { debuggerState } from "./java-debugger-state.test-fixtures";
import { coverage } from "./java-coverage.test-fixtures";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const native = vi.mocked(invoke);
const context = { workspaceId: "one", generation: 1 };
const request = {
  ...context,
  operation: "build" as const,
  trusted: true,
  configuration: { buildTool: "jdk" as const, mainClass: "Main", classPath: [] },
};
const result = {
  ...context,
  sessionId: "java-1",
  operation: "build",
  state: "succeeded",
  output: "compiled",
  outputTruncated: false,
  exitCode: 0,
};
beforeEach(() => native.mockReset());
describe("Java execution adapters", () => {
  it("validates compiler locations at the correlated snapshot boundary and accepts older snapshots", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const item = { path: "core/src/Main.java", line: 4, reportedColumn: null, severity: "error", message: "cannot find symbol" };
    native.mockResolvedValue({ ...result, compilerDiagnostics: { items: [item], truncated: false } });
    expect((await adapter.start(request)).compilerDiagnostics?.items).toEqual([item]);
    native.mockResolvedValue({ ...result, compilerDiagnostics: { items: [{ ...item, path: "../Main.java" }], truncated: false } });
    await expect(adapter.start(request)).rejects.toThrow("compiler locations");
    native.mockResolvedValue(result);
    expect((await adapter.start(request)).compilerDiagnostics).toBeUndefined();
  });
  it("correlates capability checks with the configured Gradle executable", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const request = { ...context, gradleExecutable: "/tools/gradle" };
    const capabilities = { ...request, available: true, projectKind: "gradle", jdk: true,
      maven: false, gradle: true, debugger: true, reason: null };
    native.mockResolvedValue(capabilities);
    await expect(adapter.getCapabilities(request)).resolves.toEqual(capabilities);
    expect(native).toHaveBeenLastCalledWith("get_java_execution_capabilities", { request });
    native.mockResolvedValue({ ...capabilities, gradleExecutable: "/other/gradle" });
    await expect(adapter.getCapabilities(request)).rejects.toThrow();
    native.mockResolvedValue({ ...capabilities, gradleExecutable: undefined });
    await expect(adapter.getCapabilities(request)).rejects.toThrow();
  });
  it("validates application input acknowledgements, partial writes and EOF independently of debugger commands", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const input = { ...context, sessionId: "java-1", sequence: 1, dataBase64: btoa("abc") };
    const response = { ...context, sessionId: input.sessionId, sequence: 1, acceptedBytes: 1,
      input: { state: "open", acceptedBytes: 1, nextSequence: 2, reason: null } };
    native.mockResolvedValue(response);
    expect(await adapter.sendApplicationInput(input)).toEqual(response);
    expect(native).toHaveBeenLastCalledWith("send_java_application_input", { request: input });
    for (const invalid of [{ sequence: 2 }, { sessionId: "other" }, { acceptedBytes: 4 },
      { acceptedBytes: -1 }, { input: { ...response.input, nextSequence: 1 } },
      { input: { ...response.input, acceptedBytes: Number.MAX_SAFE_INTEGER + 1 } }]) {
      native.mockResolvedValue({ ...response, ...invalid });
      await expect(adapter.sendApplicationInput(input)).rejects.toThrow();
    }
    const eof = { ...input, dataBase64: null };
    native.mockResolvedValue(response);
    await expect(adapter.sendApplicationInput(eof)).rejects.toThrow();
    native.mockResolvedValue({ ...response, acceptedBytes: 0, input: { ...response.input, state: "closed" } });
    await expect(adapter.sendApplicationInput(eof)).resolves.toMatchObject({ acceptedBytes: 0 });
    native.mockClear();
    for (const dataBase64 of ["", "@@", btoa("x".repeat(4097))])
      await expect(adapter.sendApplicationInput({ ...input, dataBase64 })).rejects.toThrow();
    expect(native).not.toHaveBeenCalled();
  });
  it("rejects application input state on unrelated operations and malformed snapshots", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const input = { state: "waiting", acceptedBytes: 0, nextSequence: 1, reason: null };
    native.mockResolvedValue({ ...result, applicationInput: input });
    await expect(adapter.start(request)).rejects.toThrow(/another Java operation/);
    native.mockResolvedValue({ ...result, operation: "run", applicationInput: input });
    await expect(adapter.start({ ...request, operation: "run" })).resolves.toMatchObject({ applicationInput: input });
    for (const invalid of [{ state: "ready" }, { nextSequence: 0 }, { acceptedBytes: -1 }, { reason: 3 }]) {
      native.mockResolvedValue({ ...result, operation: "run", applicationInput: { ...input, ...invalid } });
      await expect(adapter.start({ ...request, operation: "run" })).rejects.toThrow();
    }
  });
  it.each(["debug", "test", "integration-test", "coverage", "integration-coverage"] as const)("correlates repeat execution with a new owned %s session", async (operation) => {
    const adapter = new TauriJavaExecutionAdapter();
    const restart = { ...context, sessionId: "java-old", trusted: true, sourceBreakpoints: [] };
    const next = {
      ...result,
      operation,
      sessionId: "java-new",
      ...(operation === "coverage" || operation === "integration-coverage" ? { coverage: coverage() } : {}),
    };
    native.mockResolvedValue(next);
    expect(await adapter.restart(restart)).toEqual(next);
    expect(native).toHaveBeenLastCalledWith("restart_java_execution", { request: restart });
    for (const changed of [
      { sessionId: "java-old" },
      { operation: "attach" },
      { workspaceId: "other" },
    ]) {
      native.mockResolvedValue({ ...next, ...changed });
      await expect(adapter.restart(restart)).rejects.toThrow();
    }
  });
  it("validates the workspace-relative output of an opt-in JFR run", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const run = {
      ...result,
      operation: "run",
      profilePath: ".ide/flight-recordings/0123456789abcdef/recording.jfr",
    };
    native.mockResolvedValue(run);
    expect((await adapter.start({ ...request, operation: "run", profile: true })).profilePath).toBe(
      run.profilePath,
    );
    native.mockResolvedValue({ ...run, profilePath: "../outside.jfr" });
    await expect(adapter.snapshot({ ...context, sessionId: run.sessionId })).rejects.toThrow(
      "Flight Recorder output path",
    );
  });
  it("correlates and validates the selected JDK Flight Recorder event summary", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const request = { ...context, sessionId: "jfr-1", trusted: true };
    const summary = {
      ...context,
      sessionId: request.sessionId,
      profilePath: ".ide/flight-recordings/session/recording.jfr",
      recordingVersion: "2.1",
      chunks: 1,
      startTime: "2026-10-18 12:00:00 (UTC)",
      duration: "1 s",
      events: [{ name: "jdk.ExecutionSample", count: 9, sizeBytes: 108 }],
    };
    native.mockResolvedValue(summary);
    expect(await adapter.analyzeFlightRecording(request)).toEqual(summary);
    expect(native).toHaveBeenCalledWith("analyze_java_flight_recording", { request });
    for (const invalid of [
      { ...summary, sessionId: "stale-session" },
      { ...summary, profilePath: "../outside.jfr" },
      { ...summary, events: [{ name: "../../outside", count: 1, sizeBytes: 1 }] },
      {
        ...summary,
        events: [{ name: "jdk.Event", count: Number.MAX_SAFE_INTEGER + 1, sizeBytes: 1 }],
      },
      { ...summary, events: [{ name: "jdk.Event", count: 1, sizeBytes: -1 }] },
    ]) {
      native.mockResolvedValue(invalid);
      await expect(adapter.analyzeFlightRecording(request)).rejects.toThrow();
    }
  });
  it("correlates and bounds selected Flight Recorder timeline events", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const request = {
      ...context,
      sessionId: "jfr-1",
      trusted: true,
      eventType: "jdk.GarbageCollection",
    };
    const timeline = {
      ...context,
      sessionId: request.sessionId,
      profilePath: ".ide/flight-recordings/session/recording.jfr",
      eventType: request.eventType,
      eventCount: 1,
      truncated: false,
      events: [
        {
          startTime: "2026-10-20T12:00:00.000+02:00",
          duration: "PT0.007S",
          threadName: "VM Thread",
          payload: [{ name: "cause", value: '"System.gc()"' }],
          payloadTruncated: false,
          stackFrames: [
            {
              className: "example.Main",
              methodName: "main",
              lineNumber: 12,
              frameType: "Interpreted",
            },
          ],
          stackTraceTruncated: false,
        },
      ],
    };
    native.mockResolvedValue(timeline);
    expect(await adapter.readFlightRecordingTimeline(request)).toEqual(timeline);
    expect(native).toHaveBeenCalledWith("read_java_flight_recording_timeline", { request });
    for (const invalid of [
      { ...timeline, sessionId: "stale-session" },
      { ...timeline, eventType: "jdk.Other" },
      { ...timeline, profilePath: "../outside.jfr" },
      { ...timeline, eventCount: 0 },
      { ...timeline, events: [{ ...timeline.events[0], threadName: "x".repeat(513) }] },
      {
        ...timeline,
        events: [{ ...timeline.events[0], payload: [{ name: "large", value: "x".repeat(257) }] }],
      },
      {
        ...timeline,
        events: [
          {
            ...timeline.events[0],
            payload: Array.from({ length: 17 }, (_, i) => ({ name: `f${i}`, value: "1" })),
          },
        ],
      },
      { ...timeline, events: [{ ...timeline.events[0], payloadTruncated: "false" }] },
      {
        ...timeline,
        events: [
          {
            ...timeline.events[0],
            stackFrames: Array.from({ length: 33 }, () => timeline.events[0].stackFrames[0]),
          },
        ],
      },
      {
        ...timeline,
        events: [
          {
            ...timeline.events[0],
            stackFrames: [{ ...timeline.events[0].stackFrames[0], lineNumber: "12" }],
          },
        ],
      },
      { ...timeline, events: [{ ...timeline.events[0], stackTraceTruncated: 0 }] },
      { ...timeline, truncated: true },
      { ...timeline, events: [{ ...timeline.events[0], startTime: "" }] },
    ]) {
      native.mockResolvedValue(invalid);
      await expect(adapter.readFlightRecordingTimeline(request)).rejects.toThrow();
    }
  });
  it("runs a class-reload build beside the exact active debugger session", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const request = { ...context, sessionId: "java-1", trusted: true };
    const result = {
      ...request,
      state: "succeeded",
      exitCode: 0,
      output: "Build successful",
      outputTruncated: false,
    };
    native.mockResolvedValue(result);
    expect(await adapter.buildForClassReload(request)).toEqual(result);
    expect(native).toHaveBeenCalledWith("build_java_for_class_reload", { request });

    native.mockResolvedValue({ ...result, sessionId: "stale-session" });
    await expect(adapter.buildForClassReload(request)).rejects.toThrow(
      "Stale Java execution response",
    );
    native.mockResolvedValue({ ...result, state: "failed", exitCode: 0 });
    await expect(adapter.buildForClassReload(request)).rejects.toThrow(
      "Invalid Java class-reload build result",
    );
  });
  it("validates changed-class selections and refuses missing hashes, escaped paths and fabricated build success", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const request = { workspaceId: "one", generation: 1, sessionId: "debug", trusted: true };
    const selected = {
      className: "pkg.Main",
      classFile: "app/target/classes/pkg/Main.class",
      expectedSha256: "a".repeat(64),
    };
    const changes = {
      status: "ready",
      stopId: "stop-1",
      classes: [selected],
      message: "Compared existing files.",
    };
    const result = {
      ...request,
      state: "succeeded",
      exitCode: 0,
      output: "compiled",
      outputTruncated: false,
      classChanges: changes,
    };
    native.mockResolvedValue(result);
    expect(await adapter.buildForClassReload(request)).toEqual(result);
    for (const malformed of [
      { ...changes, stopId: null },
      { ...changes, classes: [{ ...selected, expectedSha256: undefined }] },
      { ...changes, classes: [{ ...selected, classFile: "../outside.class" }] },
      { ...changes, classes: [selected, selected] },
      { ...changes, status: "unavailable" },
    ]) {
      native.mockResolvedValue({ ...result, classChanges: malformed });
      await expect(adapter.buildForClassReload(request)).rejects.toThrow(
        /compiled-class comparison/,
      );
    }
    native.mockResolvedValue({ ...result, state: "failed", exitCode: 1 });
    await expect(adapter.buildForClassReload(request)).rejects.toThrow(/compiled-class comparison/);
  });
  it("routes synchronized project authority separately from persisted launch settings", async () => {
    const projectContext = {
      context: {
        projectPath: "maven",
        sdkHome: "/sdk",
        mavenRepository: "/repository",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        snapshotHash: "a".repeat(64),
        contextHash: "b".repeat(64),
        platformIdentities: ["c".repeat(64)],
      },
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
    };
    native.mockResolvedValueOnce(result);
    await new TauriJavaExecutionAdapter().start({ ...request, projectContext });
    expect(native).toHaveBeenCalledWith("start_java_project_execution", {
      request: { execution: request, projectContext },
    });
  });
  it("validates class reload results independently of task success and forwards the exact compiled selection", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const connected = {
      ...result,
      operation: "attach",
      state: "running",
      exitCode: null,
      debuggerState: { ...debuggerState(), canReloadClasses: true },
    };
    const accepted = {
      requestId: "reload-7",
      status: "applied",
      classes: ["example.Main"],
      error: null,
    };
    native.mockResolvedValue({ ...connected, classReload: accepted });
    expect((await adapter.snapshot({ ...context, sessionId: "java-1" })).classReload).toEqual(
      accepted,
    );
    for (const changed of [
      { status: "queued", error: "fake error" },
      { status: "failed", error: null },
      { requestId: "wrong" },
      { classes: [] },
      { classes: ["A", "A"] },
    ]) {
      native.mockResolvedValue({ ...connected, classReload: { ...accepted, ...changed } });
      await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow(
        "Invalid Java class reload",
      );
    }
    native.mockResolvedValue({
      ...connected,
      operation: "run",
      debuggerState: undefined,
      classReload: accepted,
    });
    await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow(
      "another Java operation",
    );
    native.mockResolvedValue({
      ...connected,
      debuggerState: { ...debuggerState(), canReloadClasses: "yes" },
    });
    await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow(
      "debugger state",
    );
    const reload = {
      ...context,
      sessionId: "java-1",
      trusted: true,
      stopId: "stop-1",
      classes: [{ className: "example.Main", classFile: "target/classes/example/Main.class" }],
    };
    native.mockResolvedValue(undefined);
    await adapter.reloadClasses(reload);
    expect(native).toHaveBeenLastCalledWith("reload_java_classes", { request: reload });
  });
  it("accepts typed JDI attachment state while keeping coverage and tests out of that session", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const value = {
      ...result,
      operation: "attach",
      state: "running",
      exitCode: null,
      debuggerState: debuggerState(),
    };
    native.mockResolvedValue(value);
    expect((await adapter.snapshot({ ...context, sessionId: "java-1" })).operation).toBe("attach");
    for (const changed of [{ coverage: coverage() }, { testResults: reports() }]) {
      native.mockResolvedValue({ ...value, ...changed });
      await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow(
        "another Java operation",
      );
    }
    native.mockResolvedValue({
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
    });
    expect((await adapter.getCapabilities(context)).attachDebugger).toBe(true);
    native.mockResolvedValue({
      ...context,
      available: false,
      projectKind: "maven",
      jdk: false,
      maven: false,
      gradle: false,
      debugger: false,
      structuredDebugger: false,
      attachDebugger: true,
      reason: null,
    });
    await expect(adapter.getCapabilities(context)).rejects.toThrow("capabilities");
  });
  it("binds coverage and fresh JUnit results to coverage operations and preserves coverage reruns", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    native.mockResolvedValue({ ...result, operation: "coverage", coverage: coverage() });
    expect((await adapter.start({ ...request, operation: "coverage" })).coverage?.status).toBe(
      "ready",
    );
    expect(
      (await adapter.rerunFailed({ ...context, sessionId: "old", trusted: true })).operation,
    ).toBe("coverage");
    native.mockResolvedValue({
      ...result,
      operation: "integration-coverage",
      coverage: coverage(),
      testResults: reports(),
    });
    const integration = await adapter.start({ ...request, operation: "integration-coverage" });
    expect(integration.coverage?.status).toBe("ready");
    expect(integration.testResults?.summary.total).toBe(reports().summary.total);
    native.mockResolvedValue({
      ...result,
      operation: "integration-coverage",
      coverage: coverage(),
    });
    expect(
      (await adapter.rerunFailed({ ...context, sessionId: "old", trusted: true })).operation,
    ).toBe("integration-coverage");
    native.mockResolvedValue({ ...result, coverage: coverage() });
    await expect(adapter.start(request)).rejects.toThrow("another Java operation");
    native.mockResolvedValue({ ...result, operation: "coverage" });
    await expect(adapter.start({ ...request, operation: "coverage" })).rejects.toThrow(
      "coverage results",
    );
  });
  it("correlates debugger source views and refuses malformed or retired locations", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const source = {
      ...context,
      sessionId: "java-1",
      requestId: "source-1",
      document: { path: "Main.java", text: "class Main {}", version: 1 },
      stopId: "stop-1",
      frameId: "frame-1",
    };
    const view = {
      ...context,
      sessionId: source.sessionId,
      requestId: source.requestId,
      documentPath: source.document.path,
      documentVersion: 1,
      stopId: source.stopId,
      frameId: source.frameId,
      sourcePath: "src/main/java/Main.java",
      executionLine: 1,
      breakpoints: [{ line: 1, verified: true }],
    };
    native.mockResolvedValue(view);
    expect(await adapter.debugSource(source)).toEqual(view);
    await adapter.toggleSourceBreakpoint({ source, line: 1 });
    expect(native).toHaveBeenLastCalledWith("toggle_java_source_breakpoint", {
      request: { source, line: 1 },
    });
    await adapter.runToCursor({ source, line: 2 });
    expect(native).toHaveBeenLastCalledWith("run_java_to_cursor", {
      request: { source, line: 2 },
    });
    for (const changed of [
      { requestId: "old" },
      { documentVersion: 2 },
      { stopId: "stop-2" },
      { frameId: "frame-2" },
      { sourcePath: "../Main.java" },
      { executionLine: 0 },
      { breakpoints: [{ line: 0, verified: true }] },
    ]) {
      native.mockResolvedValue({ ...view, ...changed });
      await expect(adapter.debugSource(source)).rejects.toThrow("source binding");
    }
    await expect(new BrowserJavaExecutionAdapter().debugSource(source)).rejects.toThrow(
      "native desktop",
    );
    await expect(
      new BrowserJavaExecutionAdapter().runToCursor({ source, line: 1 }),
    ).rejects.toThrow("native desktop");
  });
  it("binds JDI data to debug sessions and forwards typed stop-bound actions", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const snapshot = {
      ...result,
      operation: "debug",
      state: "running",
      exitCode: null,
      debuggerState: debuggerState(),
    };
    native.mockResolvedValue(snapshot);
    expect(
      (await adapter.snapshot({ ...context, sessionId: "java-1" })).debuggerState?.variables[0]
        .value,
    ).toBe("42");
    native.mockResolvedValue({ ...snapshot, operation: "run" });
    await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow();
    const action = {
      ...context,
      sessionId: "java-1",
      action: { type: "continue" as const, stopId: "stop-1" },
    };
    native.mockResolvedValue(undefined);
    await adapter.debugAction(action);
    expect(native).toHaveBeenLastCalledWith("send_java_debug_action", { request: action });
    await expect(new BrowserJavaExecutionAdapter().debugAction(action)).rejects.toThrow(
      /native desktop/,
    );
  });
  it("requires discovery data for discovery sessions and keeps it separate from test execution", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const discovered = {
      ...result,
      operation: "discover",
      testDiscovery: {
        status: "ready",
        projectPath: "",
        buildTool: "maven",
        scope: "engines",
        message: null,
        tests: [],
      },
    };
    native.mockResolvedValue(discovered);
    await expect(adapter.start({ ...request, operation: "discover" })).resolves.toEqual(discovered);
    for (const invalid of [
      { ...discovered, testDiscovery: undefined },
      { ...discovered, operation: "test" },
      { ...discovered, testResults: reports() },
    ]) {
      native.mockResolvedValue(invalid);
      await expect(adapter.snapshot({ ...context, sessionId: result.sessionId })).rejects.toThrow();
    }
  });
  it("admits a test configuration failure with the tool's actual successful exit and refuses inconsistent errors", async () => {
    const adapter = new TauriJavaExecutionAdapter();
    const failed = {
      ...result,
      operation: "test",
      state: "failed",
      testJvmOptionsError: "Requested test settings were ignored.",
    };
    native.mockResolvedValue(failed);
    expect(await adapter.snapshot({ ...context, sessionId: result.sessionId })).toEqual(failed);
    for (const invalid of [
      { ...failed, state: "succeeded" },
      { ...failed, operation: "run" },
      { ...failed, testJvmOptionsError: "" },
      { ...failed, testJvmOptionsError: "x".repeat(4097) },
      { ...failed, testJvmOptionsError: "bad\0" },
    ]) {
      native.mockResolvedValue(invalid);
      await expect(adapter.snapshot({ ...context, sessionId: result.sessionId })).rejects.toThrow();
    }
  });
  it("correlates the JDK selection and refuses malformed resolved JDK paths", async () => {
    const selected = { ...context, jdkHome: "/opt/jdk-21" };
    const capability = {
      ...selected,
      effectiveJdkHome: "/opt/jdk-21",
      projectKind: "jdk",
      available: true,
      jdk: true,
      maven: false,
      gradle: false,
      debugger: true,
      reason: null,
    };
    const adapter = new TauriJavaExecutionAdapter();
    native.mockResolvedValue(capability);
    expect((await adapter.getCapabilities(selected)).effectiveJdkHome).toBe("/opt/jdk-21");
    native.mockResolvedValue({ ...capability, jdkHome: "/other" });
    await expect(adapter.getCapabilities(selected)).rejects.toThrow();
    native.mockResolvedValue({ ...capability, effectiveJdkHome: "bad\0path" });
    await expect(adapter.getCapabilities(selected)).rejects.toThrow();
  });
  it("delegates execution without inventing a result", async () => {
    native.mockResolvedValue(result);
    await expect(new TauriJavaExecutionAdapter().start(request)).resolves.toEqual(result);
    expect(native).toHaveBeenCalledWith("start_java_execution", { request });
  });
  it.each([
    { ...result, workspaceId: "other" },
    { ...result, generation: 2 },
    { ...result, operation: "debug" },
    { ...result, exitCode: 1 },
    { ...result, state: "imaginary" },
    { ...result, output: "x".repeat(65537) },
    { ...result, outputTruncated: undefined },
  ])("rejects stale, inconsistent and oversized responses", async (value) => {
    native.mockResolvedValue(value);
    await expect(new TauriJavaExecutionAdapter().start(request)).rejects.toThrow();
  });
  it("rejects a response from another session", async () => {
    native.mockResolvedValue(result);
    await expect(
      new TauriJavaExecutionAdapter().snapshot({ ...context, sessionId: "java-2" }),
    ).rejects.toThrow();
  });
  it("binds structured reports to test snapshots and reruns into a new session", async () => {
    const completed = {
      ...result,
      operation: "test",
      state: "failed",
      exitCode: 1,
      testResults: reports(),
    };
    native.mockResolvedValue(completed);
    const adapter = new TauriJavaExecutionAdapter();
    expect(
      (await adapter.snapshot({ ...context, sessionId: "java-1" })).testResults?.summary.failed,
    ).toBe(1);
    native.mockResolvedValue({ ...completed, operation: "build" });
    await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow();
    const rerun = { ...context, sessionId: "java-1", trusted: true };
    native.mockResolvedValue({ ...completed, sessionId: "java-2" });
    expect((await adapter.rerunFailed(rerun)).sessionId).toBe("java-2");
    expect(native).toHaveBeenLastCalledWith("rerun_java_failed_tests", { request: rerun });
    native.mockResolvedValue(completed);
    await expect(adapter.rerunFailed(rerun)).rejects.toThrow();
    await expect(new BrowserJavaExecutionAdapter().rerunFailed(rerun)).rejects.toThrow(
      /native desktop/,
    );
  });
  it("reports the local browser capability as unavailable", async () => {
    const browser = new BrowserJavaExecutionAdapter();
    expect((await browser.getCapabilities(context)).available).toBe(false);
    await expect(browser.start(request)).rejects.toThrow(/native desktop/);
    expect(native).not.toHaveBeenCalled();
  });
  it("correlates capability discovery to the requested project directory", async () => {
    const moduleContext = { ...context, projectPath: "modules/service" };
    const capability = {
      ...moduleContext,
      available: true,
      projectKind: "maven",
      jdk: true,
      maven: true,
      gradle: false,
      debugger: false,
      reason: null,
    };
    native.mockResolvedValue(capability);
    await expect(new TauriJavaExecutionAdapter().getCapabilities(moduleContext)).resolves.toEqual(
      capability,
    );
    expect(native).toHaveBeenCalledWith("get_java_execution_capabilities", {
      request: moduleContext,
    });
    native.mockResolvedValue({ ...capability, projectPath: "modules/other" });
    await expect(new TauriJavaExecutionAdapter().getCapabilities(moduleContext)).rejects.toThrow();
  });
});

it("accepts test results and JDI state in a correlated debug-test session without granting HotSwap", async () => {
  const adapter = new TauriJavaExecutionAdapter();
  native.mockResolvedValue({ ...result, operation: "debug-test", state: "running", exitCode: null, debuggerState: { ...debuggerState(), canReloadClasses: false } });
  expect((await adapter.snapshot({ ...context, sessionId: "java-1" })).operation).toBe("debug-test");
  native.mockResolvedValue({ ...result, operation: "debug-test", testResults: reports() });
  expect((await adapter.snapshot({ ...context, sessionId: "java-1" })).testResults).toBeDefined();
  native.mockResolvedValue({ ...result, operation: "debug-test", state: "running", exitCode: null, debuggerState: { ...debuggerState(), canReloadClasses: false }, classReload: { unsupported: true } });
  await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow("another Java operation");
});


it("rejects a test debugger state that claims unavailable class-reload authority", async () => {
  const adapter = new TauriJavaExecutionAdapter();
  native.mockResolvedValue({ ...result, operation: "debug-test", state: "running", exitCode: null, debuggerState: { ...debuggerState(), canReloadClasses: true } });
  await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow("does not support class reloading");
});

it("validates the captured failed-test debugging capability and requires a debug response", async () => {
  const adapter = new TauriJavaExecutionAdapter();
  const failed = { ...result, operation: "test", state: "failed", exitCode: 1, testResults: reports(), canDebugFailedTests: true };
  native.mockResolvedValue(failed);
  expect((await adapter.snapshot({ ...context, sessionId: "java-1" })).canDebugFailedTests).toBe(true);
  for (const changed of [{ canDebugFailedTests: "yes" }, { operation: "debug-test" }, { state: "running" }, { testResults: undefined }]) {
    native.mockResolvedValue({ ...failed, ...changed });
    await expect(adapter.snapshot({ ...context, sessionId: "java-1" })).rejects.toThrow();
  }
  const request = { ...context, sessionId: "java-1", trusted: true, debug: true, sourceBreakpoints: [{ sourcePath: "FixtureTest.java", line: 8, fingerprint: "b".repeat(64) }] };
  native.mockResolvedValue({ ...failed, sessionId: "java-2", canDebugFailedTests: false });
  await expect(adapter.rerunFailed(request)).rejects.toThrow("rerun session");
  native.mockResolvedValue({ ...result, sessionId: "java-2", operation: "debug-test", state: "starting", exitCode: null });
  expect((await adapter.rerunFailed(request)).operation).toBe("debug-test");
  expect(native).toHaveBeenLastCalledWith("rerun_java_failed_tests", { request });
});

it.each(["clean", "rebuild"] as const)("retains %s and rejects malformed capability flags", async (operation) => {
  const adapter = new TauriJavaExecutionAdapter();
  native.mockResolvedValue({ ...result, operation });
  expect((await adapter.start({ ...request, operation, configuration: { ...request.configuration, buildTool: "maven" } })).operation).toBe(operation);
  native.mockResolvedValue({ ...context, available: true, projectKind: "maven", jdk: true, maven: true, gradle: false, debugger: true, reason: null, [operation === "clean" ? "cleanProject" : "rebuildProject"]: "true" });
  await expect(adapter.getCapabilities(context)).rejects.toThrow();
});
