import { isJavaBinaryName } from "@ide/contracts";
import { isJavaDebuggingOperation, isJavaRepeatableExecutionOperation, isJavaTestDebugOperation } from "@ide/contracts";
import type {
  JavaApplicationInputRequest,
  JavaApplicationInputResult,
  JavaDebugCommandRequest,
  JavaDebuggerActionRequest,
  JavaClassReloadRequest,
  JavaClassReloadBuildRequest,
  JavaClassReloadBuildResult,
  JavaDebuggerSourceRequest,
  JavaDebuggerSourceView,
  JavaRunToCursorRequest,
  JavaSourceBreakpointRequest,
  JavaExecutionCapabilities,
  JavaExecutionCapabilityRequest,
  JavaExecutionContext,
  JavaExecutionRequest,
  JavaExecutionSessionRequest,
  JavaExecutionSnapshot,
  JavaExecutionRestartRequest,
  JavaFlightRecordingAnalysisRequest,
  JavaFlightRecordingTimeline,
  JavaFlightRecordingTimelineRequest,
  JavaFlightRecordingSummary,
  JavaTestRerunRequest,
} from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";
import { invokeTauri } from "./errors";
import { normalizeJavaTestResults } from "./java-test-results";
import { normalizeJavaTestDiscovery } from "./java-test-discovery";
import { normalizeJavaDebuggerState } from "./java-debugger-state";
import { normalizeJavaClassReload } from "./java-class-reload";
import { normalizeJavaCoverage } from "./java-coverage";
import { normalizeJavaCompilerDiagnostics } from "./java-compiler-diagnostics";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Java execution response.");
  return value as Record<string, unknown>;
}
function correlated(value: unknown, context: JavaExecutionContext) {
  const data = object(value);
  if (data.workspaceId !== context.workspaceId || data.generation !== context.generation) {
    throw new Error("Stale Java execution response.");
  }
  return data;
}
function applicationInputState(value: unknown) {
  const data = object(value);
  if (!["waiting", "open", "closed", "unavailable"].includes(String(data.state)) ||
      !Number.isSafeInteger(data.acceptedBytes) || Number(data.acceptedBytes) < 0 ||
      !Number.isSafeInteger(data.nextSequence) || Number(data.nextSequence) < 1 ||
      !(data.reason === null || (typeof data.reason === "string" && data.reason.length <= 4096 && !data.reason.includes("\0"))))
    throw new Error("Invalid application input state.");
  return data;
}
function validFlightRecordingPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 4096 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
function flightRecordingSummary(
  value: unknown,
  request: JavaFlightRecordingAnalysisRequest,
): JavaFlightRecordingSummary {
  const data = correlated(value, request);
  if (
    data.sessionId !== request.sessionId ||
    !validFlightRecordingPath(data.profilePath) ||
    typeof data.recordingVersion !== "string" ||
    data.recordingVersion.length === 0 ||
    data.recordingVersion.length > 64 ||
    typeof data.startTime !== "string" ||
    data.startTime.length === 0 ||
    data.startTime.length > 128 ||
    typeof data.duration !== "string" ||
    data.duration.length === 0 ||
    data.duration.length > 128 ||
    !Number.isInteger(data.chunks) ||
    Number(data.chunks) < 0 ||
    Number(data.chunks) > 0xffffffff ||
    !Array.isArray(data.events) ||
    data.events.length > 512
  )
    throw new Error("Invalid Java Flight Recorder summary.");
  const names = new Set<string>();
  for (const item of data.events) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      item.name.length > 512 ||
      !/^[A-Za-z0-9_.$]+$/.test(item.name) ||
      names.has(item.name) ||
      !Number.isSafeInteger(item.count) ||
      Number(item.count) < 0 ||
      !Number.isSafeInteger(item.sizeBytes) ||
      Number(item.sizeBytes) < 0
    )
      throw new Error("Invalid Java Flight Recorder event summary.");
    names.add(item.name);
  }
  return data as unknown as JavaFlightRecordingSummary;
}
function flightRecordingTimeline(
  value: unknown,
  request: JavaFlightRecordingTimelineRequest,
): JavaFlightRecordingTimeline {
  const data = correlated(value, request);
  if (
    data.sessionId !== request.sessionId ||
    !validFlightRecordingPath(data.profilePath) ||
    data.eventType !== request.eventType ||
    !/^[A-Za-z0-9_.$]+$/.test(request.eventType) ||
    !Number.isSafeInteger(data.eventCount) ||
    Number(data.eventCount) < 0 ||
    Number(data.eventCount) > 200_000 ||
    typeof data.truncated !== "boolean" ||
    !Array.isArray(data.events) ||
    data.events.length > 1_000 ||
    (data.truncated
      ? Number(data.eventCount) <= data.events.length
      : Number(data.eventCount) !== data.events.length)
  )
    throw new Error("Invalid Java Flight Recorder timeline.");
  for (const event of data.events) {
    if (
      !event ||
      typeof event !== "object" ||
      typeof event.startTime !== "string" ||
      event.startTime.length === 0 ||
      event.startTime.length > 128 ||
      !(
        event.duration === null ||
        (typeof event.duration === "string" && event.duration.length <= 128)
      ) ||
      !(
        event.threadName === null ||
        (typeof event.threadName === "string" && event.threadName.length <= 512)
      ) ||
      typeof event.payloadTruncated !== "boolean" ||
      !Array.isArray(event.payload) ||
      event.payload.length > 16 ||
      typeof event.stackTraceTruncated !== "boolean" ||
      !Array.isArray(event.stackFrames) ||
      event.stackFrames.length > 32
    )
      throw new Error("Invalid Java Flight Recorder timeline event.");
    let payloadLength = 0;
    for (const field of event.payload) {
      if (
        !field ||
        typeof field !== "object" ||
        typeof field.name !== "string" ||
        field.name.length === 0 ||
        field.name.length > 128 ||
        typeof field.value !== "string" ||
        field.value.length > 256
      )
        throw new Error("Invalid Java Flight Recorder event payload.");
      payloadLength += field.name.length + field.value.length;
    }
    if (payloadLength > 4 * 1024) throw new Error("Oversized Java Flight Recorder event payload.");
    for (const frame of event.stackFrames) {
      if (
        !frame ||
        typeof frame !== "object" ||
        !(
          frame.className === null ||
          (typeof frame.className === "string" && frame.className.length <= 512)
        ) ||
        !(
          frame.methodName === null ||
          (typeof frame.methodName === "string" && frame.methodName.length <= 512)
        ) ||
        !(frame.lineNumber === null || Number.isSafeInteger(frame.lineNumber)) ||
        !(
          frame.frameType === null ||
          (typeof frame.frameType === "string" && frame.frameType.length <= 64)
        )
      )
        throw new Error("Invalid Java Flight Recorder stack frame.");
    }
  }
  return data as unknown as JavaFlightRecordingTimeline;
}
function snapshot(
  value: unknown,
  request: JavaExecutionContext & { sessionId?: string },
): JavaExecutionSnapshot {
  const data = correlated(value, request);
  if (
    typeof data.sessionId !== "string" ||
    data.sessionId.length === 0 ||
    data.sessionId.length > 128 ||
    (request.sessionId !== undefined && data.sessionId !== request.sessionId) ||
    ![
      "clean",
      "rebuild",
      "build",
      "run",
      "test",
      "integration-test",
      "debug-test",
      "debug-integration-test",
      "integration-coverage",
      "coverage",
      "debug",
      "attach",
      "discover",
      "prepare-gradle",
      "prepare-maven",
    ].includes(String(data.operation)) ||
    !["starting", "running", "succeeded", "failed", "stopped"].includes(String(data.state)) ||
    typeof data.output !== "string" ||
    new TextEncoder().encode(data.output).length > 65536 ||
    typeof data.outputTruncated !== "boolean" ||
    !(
      data.exitCode === null ||
      (Number.isSafeInteger(data.exitCode) && Number(data.exitCode) >= 0)
    ) ||
    (data.state === "succeeded" && data.exitCode !== 0)
  )
    throw new Error("Invalid Java execution snapshot.");
  if (data.compilerDiagnostics !== undefined) normalizeJavaCompilerDiagnostics(data.compilerDiagnostics);
  if (
    data.profilePath !== undefined &&
    (data.operation !== "run" || !validFlightRecordingPath(data.profilePath))
  )
    throw new Error("Invalid Java Flight Recorder output path.");
  if (
    data.testJvmOptionsError !== undefined &&
    (!["test", "integration-test", "integration-coverage", "coverage", "debug-test", "debug-integration-test"].includes(
      String(data.operation),
    ) ||
      data.state !== "failed" ||
      typeof data.testJvmOptionsError !== "string" ||
      data.testJvmOptionsError.length === 0 ||
      data.testJvmOptionsError.includes("\0") ||
      new TextEncoder().encode(data.testJvmOptionsError).length > 4096)
  )
    throw new Error("Invalid Java test JVM configuration failure.");
  if (data.testResults !== undefined) {
    if (
      !["test", "integration-test", "integration-coverage", "coverage", "debug-test", "debug-integration-test"].includes(
        String(data.operation),
      )
    )
      throw new Error("Test results belong to another Java operation.");
    normalizeJavaTestResults(data.testResults, String(data.state));
  }
  if (data.canDebugFailedTests !== undefined &&
      (typeof data.canDebugFailedTests !== "boolean" || (data.canDebugFailedTests &&
        (!["test", "coverage", "integration-test", "integration-coverage"].includes(String(data.operation)) ||
         !["succeeded", "failed"].includes(String(data.state)) ||
         !(data.testResults as JavaExecutionSnapshot["testResults"])?.canRerunFailed))))
    throw new Error("Invalid failed-test debugging capability.");

  if (["coverage", "integration-coverage"].includes(String(data.operation)))
    normalizeJavaCoverage(data.coverage, String(data.state));
  else if (data.coverage !== undefined)
    throw new Error("Coverage belongs to another Java operation.");
  if (data.operation === "discover")
    normalizeJavaTestDiscovery(data.testDiscovery, String(data.state));
  else if (data.testDiscovery !== undefined)
    throw new Error("Discovery results belong to another Java operation.");
  if (data.debuggerState !== undefined) {
    if (!isJavaDebuggingOperation(String(data.operation)))
      throw new Error("Debugger state belongs to another Java operation.");
    const debuggerState = normalizeJavaDebuggerState(data.debuggerState, String(data.state));
    if (isJavaTestDebugOperation(String(data.operation)) && debuggerState.canReloadClasses === true)
      throw new Error("Test debugging does not support class reloading.");
  }
  if (data.classReload !== undefined) {
    if (!["debug", "attach"].includes(String(data.operation)))
      throw new Error("Class reload belongs to another Java operation.");
    normalizeJavaClassReload(data.classReload, String(data.state));
  }
  if (data.applicationInput !== undefined) {
    if (!["run", "debug"].includes(String(data.operation)))
      throw new Error("Application input belongs to another Java operation.");
    applicationInputState(data.applicationInput);
  }
  return data as unknown as JavaExecutionSnapshot;
}
export class TauriJavaExecutionAdapter implements JavaExecutionPort {
  async sendApplicationInput(request: JavaApplicationInputRequest): Promise<JavaApplicationInputResult> {
    if (!Number.isSafeInteger(request.sequence) || request.sequence < 1 || request.sequence >= Number.MAX_SAFE_INTEGER ||
        !(request.dataBase64 === null || (typeof request.dataBase64 === "string" &&
          request.dataBase64.length > 0 && request.dataBase64.length <= 5464 &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.dataBase64))))
      throw new Error("Invalid application input request.");
    const bytes = request.dataBase64 === null ? 0 : atob(request.dataBase64).length;
    if (bytes > 4096) throw new Error("Application input chunk is too large.");
    const data = correlated(await invokeTauri("send_java_application_input", { request }), request);
    const input = applicationInputState(data.input);
    if (data.sessionId !== request.sessionId || data.sequence !== request.sequence ||
        !Number.isSafeInteger(data.acceptedBytes) || Number(data.acceptedBytes) < 0 || Number(data.acceptedBytes) > bytes ||
        input.nextSequence !== request.sequence + 1 || Number(input.acceptedBytes) < Number(data.acceptedBytes) ||
        (request.dataBase64 === null && input.state !== "closed"))
      throw new Error("Invalid application input acknowledgement.");
    return data as unknown as JavaApplicationInputResult;
  }
  async getCapabilities(
    context: JavaExecutionCapabilityRequest,
  ): Promise<JavaExecutionCapabilities> {
    const data = correlated(
      await invokeTauri("get_java_execution_capabilities", { request: context }),
      context,
    );
    if (
      (context.projectPath !== undefined && data.projectPath !== context.projectPath) ||
      (context.jdkHome !== undefined && data.jdkHome !== context.jdkHome) ||
      (context.gradleExecutable !== undefined && data.gradleExecutable !== context.gradleExecutable) ||
      (data.gradleExecutable !== undefined && (typeof data.gradleExecutable !== "string" || data.gradleExecutable.length > 4096 || data.gradleExecutable.includes("\0"))) ||
      !(
        data.effectiveJdkHome === undefined ||
        data.effectiveJdkHome === null ||
        (typeof data.effectiveJdkHome === "string" &&
          data.effectiveJdkHome.length > 0 &&
          data.effectiveJdkHome.length <= 4096 &&
          !data.effectiveJdkHome.includes("\0"))
      ) ||
      !["jdk", "maven", "gradle"].includes(String(data.projectKind)) ||
      ![data.available, data.jdk, data.maven, data.gradle, data.debugger].every(
        (value) => typeof value === "boolean",
      ) ||
      (data.cleanProject !== undefined && typeof data.cleanProject !== "boolean") ||
      (data.rebuildProject !== undefined && typeof data.rebuildProject !== "boolean") ||
      (data.flightRecorder !== undefined && typeof data.flightRecorder !== "boolean") ||
      (data.structuredDebugger !== undefined && typeof data.structuredDebugger !== "boolean") ||
      (data.attachDebugger !== undefined && typeof data.attachDebugger !== "boolean") ||
      (data.debugTests !== undefined && typeof data.debugTests !== "boolean") ||
      (data.debugIntegrationTests !== undefined && typeof data.debugIntegrationTests !== "boolean") ||
      ((data.debugTests === true || data.debugIntegrationTests === true) && (data.structuredDebugger !== true || data.jdk !== true)) ||
      (data.restartExecution !== undefined && typeof data.restartExecution !== "boolean") ||
      (data.applicationInput !== undefined && (typeof data.applicationInput !== "boolean" || (data.applicationInput && data.jdk !== true))) ||
      (data.attachDebugger === true && (data.structuredDebugger !== true || data.jdk !== true)) ||
      !(data.reason === null || typeof data.reason === "string")
    )
      throw new Error("Invalid Java tool capabilities.");
    return data as unknown as JavaExecutionCapabilities;
  }
  async start(request: JavaExecutionRequest) {
    const { projectContext, ...execution } = request;
    const { projectModule, ...configuration } = execution.configuration;
    if (projectModule && !projectContext && !request.testSelection)
      throw new Error("Synchronize the selected Java module before execution.");
    execution.configuration = configuration;
    const result = snapshot(
      await invokeTauri(projectContext ? "start_java_project_execution" : "start_java_execution", {
        request: projectContext ? { execution, projectContext } : execution,
      }),
      request,
    );
    if (result.operation !== request.operation) throw new Error("Mismatched Java operation.");
    return result;
  }
  async snapshot(request: JavaExecutionSessionRequest) {
    return snapshot(await invokeTauri("get_java_execution_snapshot", { request }), request);
  }
  async analyzeFlightRecording(request: JavaFlightRecordingAnalysisRequest) {
    return flightRecordingSummary(
      await invokeTauri("analyze_java_flight_recording", { request }),
      request,
    );
  }
  async readFlightRecordingTimeline(request: JavaFlightRecordingTimelineRequest) {
    return flightRecordingTimeline(
      await invokeTauri("read_java_flight_recording_timeline", { request }),
      request,
    );
  }
  async stop(request: JavaExecutionSessionRequest) {
    return snapshot(await invokeTauri("stop_java_execution", { request }), request);
  }
  async rerunFailed(request: JavaTestRerunRequest) {
    const result = snapshot(await invokeTauri("rerun_java_failed_tests", { request }), {
      workspaceId: request.workspaceId,
      generation: request.generation,
    });
    if (
      !["test", "integration-test", "integration-coverage", "coverage", "debug-test", "debug-integration-test"].includes(
        result.operation,
      ) ||
      (request.debug === true && !isJavaTestDebugOperation(result.operation)) ||
      result.sessionId === request.sessionId
    )
      throw new Error("Invalid Java test rerun session.");
    return result;
  }
  async restart(request: JavaExecutionRestartRequest) {
    const result = snapshot(await invokeTauri("restart_java_execution", { request }), {
      workspaceId: request.workspaceId,
      generation: request.generation,
    });
    if (!isJavaRepeatableExecutionOperation(result.operation) || result.sessionId === request.sessionId)
      throw new Error("Invalid restarted Java session.");
    return result;
  }
  async debugCommand(request: JavaDebugCommandRequest): Promise<void> {
    await invokeTauri("send_java_debug_command", { request });
  }
  async debugAction(request: JavaDebuggerActionRequest): Promise<void> {
    await invokeTauri("send_java_debug_action", { request });
  }
  async reloadClasses(request: JavaClassReloadRequest): Promise<void> {
    await invokeTauri("reload_java_classes", { request });
  }
  async buildForClassReload(
    request: JavaClassReloadBuildRequest,
  ): Promise<JavaClassReloadBuildResult> {
    const data = correlated(await invokeTauri("build_java_for_class_reload", { request }), request);
    if (data.sessionId !== request.sessionId) throw new Error("Stale Java execution response.");
    if (
      !["succeeded", "failed"].includes(String(data.state)) ||
      !Number.isSafeInteger(data.exitCode) ||
      Number(data.exitCode) < 0 ||
      typeof data.output !== "string" ||
      new TextEncoder().encode(data.output).length > 65536 ||
      typeof data.outputTruncated !== "boolean" ||
      (data.state === "succeeded" && data.exitCode !== 0) ||
      (data.state === "failed" && data.exitCode === 0)
    )
      throw new Error("Invalid Java class-reload build result.");
    if (data.classChanges !== undefined) {
      const changes = object(data.classChanges);
      if (
        !changes ||
        !["ready", "unavailable"].includes(String(changes.status)) ||
        (data.state !== "succeeded" && changes.status === "ready") ||
        typeof changes.message !== "string" ||
        changes.message.length > 4096 ||
        (changes.status === "ready"
          ? typeof changes.stopId !== "string" || !changes.stopId || changes.stopId.length > 128
          : changes.stopId !== null) ||
        !Array.isArray(changes.classes) ||
        changes.classes.length > 32 ||
        (changes.status === "unavailable" && changes.classes.length !== 0)
      ) {
        throw new Error("Invalid compiled-class comparison.");
      }
      const names = new Set<string>(),
        paths = new Set<string>();
      for (const raw of changes.classes) {
        const item = object(raw);
        if (
          !item ||
          typeof item.className !== "string" ||
          item.className.length > 512 ||
          !isJavaBinaryName(item.className) ||
          typeof item.classFile !== "string" ||
          item.classFile.length > 1024 ||
          !item.classFile.endsWith(".class") ||
          /[\\:\u0000-\u001f]/.test(item.classFile) ||
          item.classFile.split("/").some((part) => !part || part === "." || part === "..") ||
          typeof item.expectedSha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(item.expectedSha256) ||
          names.has(item.className) ||
          paths.has(item.classFile)
        ) {
          throw new Error("Invalid compiled-class comparison selection.");
        }
        names.add(item.className);
        paths.add(item.classFile);
      }
    }
    return data as unknown as JavaClassReloadBuildResult;
  }
  async debugSource(request: JavaDebuggerSourceRequest): Promise<JavaDebuggerSourceView> {
    const value = correlated(await invokeTauri("get_java_debug_source", { request }), request);
    if (
      value.sessionId !== request.sessionId ||
      value.requestId !== request.requestId ||
      value.documentPath !== request.document.path ||
      value.documentVersion !== request.document.version ||
      value.stopId !== request.stopId ||
      value.frameId !== request.frameId ||
      typeof value.sourcePath !== "string" ||
      value.sourcePath.length === 0 ||
      new TextEncoder().encode(value.sourcePath).length > 1024 ||
      value.sourcePath.includes("\\") ||
      value.sourcePath.startsWith("/") ||
      value.sourcePath
        .split("/")
        .some((part) => !part || part === "." || part === ".." || /[\0\n\r]/.test(part)) ||
      !(
        value.executionLine === null ||
        (Number.isSafeInteger(value.executionLine) && Number(value.executionLine) > 0)
      ) ||
      !Array.isArray(value.breakpoints) ||
      value.breakpoints.length > 128 ||
      value.breakpoints.some(
        (point) =>
          !point ||
          !Number.isSafeInteger(point.line) ||
          point.line <= 0 ||
          typeof point.verified !== "boolean",
      )
    )
      throw new Error("Invalid or stale Java debugger source binding.");
    return value as unknown as JavaDebuggerSourceView;
  }
  async toggleSourceBreakpoint(request: JavaSourceBreakpointRequest): Promise<void> {
    await invokeTauri("toggle_java_source_breakpoint", { request });
  }
  async runToCursor(request: JavaRunToCursorRequest): Promise<void> {
    await invokeTauri("run_java_to_cursor", { request });
  }
}
