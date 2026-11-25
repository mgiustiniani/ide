import type {
  JavaApplicationInputRequest,
  JavaApplicationInputResult,
  JavaDebugCommandRequest,
  JavaDebuggerActionRequest,
  JavaClassReloadBuildRequest,
  JavaClassReloadBuildResult,
  JavaClassReloadRequest,
  JavaDebuggerSourceRequest,
  JavaDebuggerSourceView,
  JavaRunToCursorRequest,
  JavaSourceBreakpointRequest,
  JavaExecutionCapabilities,
  JavaExecutionCapabilityRequest,
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

export interface JavaExecutionPort {
  sendApplicationInput?(request: JavaApplicationInputRequest): Promise<JavaApplicationInputResult>;
  getCapabilities(context: JavaExecutionCapabilityRequest): Promise<JavaExecutionCapabilities>;
  start(request: JavaExecutionRequest): Promise<JavaExecutionSnapshot>;
  snapshot(request: JavaExecutionSessionRequest): Promise<JavaExecutionSnapshot>;
  stop(request: JavaExecutionSessionRequest): Promise<JavaExecutionSnapshot>;
  restart?(request: JavaExecutionRestartRequest): Promise<JavaExecutionSnapshot>;
  analyzeFlightRecording?(
    request: JavaFlightRecordingAnalysisRequest,
  ): Promise<JavaFlightRecordingSummary>;
  readFlightRecordingTimeline?(
    request: JavaFlightRecordingTimelineRequest,
  ): Promise<JavaFlightRecordingTimeline>;
  rerunFailed(request: JavaTestRerunRequest): Promise<JavaExecutionSnapshot>;
  debugCommand(request: JavaDebugCommandRequest): Promise<void>;
  debugAction?(request: JavaDebuggerActionRequest): Promise<void>;
  reloadClasses?(request: JavaClassReloadRequest): Promise<void>;
  buildForClassReload?(request: JavaClassReloadBuildRequest): Promise<JavaClassReloadBuildResult>;
  debugSource?(request: JavaDebuggerSourceRequest): Promise<JavaDebuggerSourceView>;
  toggleSourceBreakpoint?(request: JavaSourceBreakpointRequest): Promise<void>;
  runToCursor?(request: JavaRunToCursorRequest): Promise<void>;
}
