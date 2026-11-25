import { isJavaBinaryName, isJavaRuntimeIdentifier } from "./java-names";
import type { JavaCoverageResults } from "./java-coverage";
import type { JavaGradleSettings, JavaProjectContextSettings, JavaProjectOperationContext } from "./java-project-context";
import type { JavaClassReloadResult } from "./java-debugger";
import type { JavaDebuggerState, JavaSavedSourceBreakpoint } from "./java-debugger";
/** Java execution is provided by the installed JDK/build tools, not RefactorKit. */
export type JavaBuildTool = "auto" | "jdk" | "maven" | "gradle";
export type JavaPlainJdkTestFramework = "junit" | "testng";
export type JavaExecutionOperation =
  | "clean"
  | "rebuild"
  | "build"
  | "prepare-gradle"
  | "prepare-maven"
  | "run"
  | "test"
  | "integration-test"
  | "integration-coverage"
  | "coverage"
  | "debug"
  | "debug-test"
  | "debug-integration-test"
  | "attach"
  | "discover";
/** A test execution whose JVM is controlled by the structured debugger. */
export function isJavaTestDebugOperation(
  operation: string | undefined,
): operation is "debug-test" | "debug-integration-test" {
  return operation === "debug-test" || operation === "debug-integration-test";
}
export function isConcreteJavaTestFilter(value: string | undefined): boolean {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > 512) return false;
  const parts = value.split("#");
  return (
    parts.length <= 2 &&
    isJavaBinaryName(parts[0]) &&
    (parts.length === 1 || isJavaRuntimeIdentifier(parts[1]))
  );
}
export function isJavaDebuggingOperation(operation: string | undefined): boolean {
  return operation === "debug" || operation === "attach" || isJavaTestDebugOperation(operation);
}
export function isJavaRepeatableExecutionOperation(operation: string): boolean {
  return operation === "run" || operation === "debug" || isJavaTestDebugOperation(operation) ||
    operation === "test" || operation === "integration-test" ||
    operation === "coverage" || operation === "integration-coverage";
}
export type JavaExecutionState = "starting" | "running" | "succeeded" | "failed" | "stopped";

export interface JavaExecutionContext {
  workspaceId: string;
  generation: number;
}
export interface JavaExecutionCapabilityRequest extends JavaExecutionContext {
  /** Synchronized project's selected Gradle executable; wrapper selection retains priority. */
  gradleExecutable?: string;
  /** Workspace-relative project/module directory; omitted or empty means the workspace root. */
  projectPath?: string;
  /** Optional absolute full-JDK directory; empty means the IDE's default JDK selection. */
  jdkHome?: string;
}
export interface JavaEnvironmentVariable {
  name: string;
  value: string;
}
export interface JavaDebuggerAttachTarget {
  host: string;
  /** Decimal port text permits an incomplete saved form; Attach requires 1–65535. */
  port: string;
}
export interface JavaLaunchConfiguration {
  buildTool: JavaBuildTool;
  mainClass: string;
  /** Workspace-contained directories/JARs for plain-JDK compilation/Run and jdb; build-tool Run uses project dependencies. */
  classPath: string[];
  /** Launch a synchronized project source set as its provider-attested named JPMS module. */
  launchAsModule?: boolean;
  /** Select provider-owned module/source-set metadata; authority is acquired anew for execution.
   * providerId is optional only when restoring a legacy saved configuration; ambiguous legacy
   * selections must be resolved in the module picker before execution.
   */
  projectModule?: { providerId?: string; moduleId: string; sourceSetId: string };
  /** Directory containing the project's build descriptor, inside the authorized workspace. */
  projectPath?: string;
  /** Application Run/Debug working directory, workspace-relative; empty uses the selected project. */
  workingDirectory?: string;
  /** Opt-in application System.in for Run/Debug; independent of debugger commands. */
  applicationInput?: boolean;
  /** Build-tool test selection: class name or class#method, with optional wildcards. */
  testFilter?: string;
  /** Plain-JDK test runner; Maven and Gradle always use their project-configured test runner. */
  testFramework?: JavaPlainJdkTestFramework;
  /** Optional report directories relative to the workspace; otherwise use build-tool conventions. */
  testReportPaths?: string[];
  /** Literal application arguments for Run/Debug, preserving order, empty values and whitespace. */
  programArguments?: string[];
  /** Literal application JVM options for Run/Debug, before the IDE-owned main class/classpath. */
  jvmOptions?: string[];
  /** Literal options for build-tool test JVMs; independent of application Run/Debug options. */
  testJvmOptions?: string[];
  /** Child-tool environment overrides; JAVA_HOME and IDE_JAVA_HOME use jdkHome instead. */
  environment?: JavaEnvironmentVariable[];
  /** Optional absolute full-JDK directory. Build-tool project toolchains remain build-tool-owned. */
  jdkHome?: string;
  /** JDK console debugger by default; JDI supplies typed runtime inspection. */
  debuggerMode?: "jdb" | "jdi";
  /** JDWP socket endpoint of an existing JVM; Attach neither builds nor launches that application. */
  debuggerAttach?: JavaDebuggerAttachTarget;
}
export interface JavaExecutionCapabilities extends JavaExecutionContext {
  /** Delegate output cleanup to Maven or Gradle; absence does not advertise Clean. */
  cleanProject?: boolean;
  /** Run clean and compilation together through the selected Maven/Gradle build. */
  rebuildProject?: boolean;
  gradleExecutable?: string;
  projectPath?: string;
  jdkHome?: string;
  effectiveJdkHome?: string | null;
  available: boolean;
  projectKind: Exclude<JavaBuildTool, "auto">;
  jdk: boolean;
  maven: boolean;
  gradle: boolean;
  debugger: boolean;
  /** Selected JDK supports the built-in Java Flight Recorder profile configuration. */
  flightRecorder?: boolean;
  structuredDebugger?: boolean;
  /** Explicit advertisement for connecting the structured debugger to an external JVM. */
  attachDebugger?: boolean;
  /** Explicit support for a debugger-owned connection to a build-tool or JDK test JVM. */
  debugTests?: boolean;
  debugIntegrationTests?: boolean;
  /** Restart the owned Run/Debug session with its captured launch settings. */
  restartExecution?: boolean;
  /** Full selected JDK can build the IDE-owned application input agent. */
  applicationInput?: boolean;
  reason: string | null;
}
export interface JavaExecutionRequest extends JavaExecutionContext {
  operation: JavaExecutionOperation;
  configuration: JavaLaunchConfiguration;
  trusted: boolean;
  /** Explicit dependency preparation uses the selected Gradle settings before synchronization. */
  gradlePreparation?: JavaGradleSettings;
  /** Explicit reactor verification before synchronization. */
  mavenPreparation?: Pick<JavaProjectContextSettings, "mavenRepository" | "activeMavenProfiles" | "inactiveMavenProfiles">;
  /** Start a Java Flight Recorder profile for an application Run and save it in the project. */
  profile?: boolean;
  /** Ephemeral synchronized project authority; persisted launch settings never grant it. */
  projectContext?: JavaExecutionProjectSelection;
  /** Enabled saved source breakpoints, installed before application code starts in JDI mode. */
  sourceBreakpoints?: JavaSavedSourceBreakpoint[];
  /** Run a selection from the still-current completed discovery session, using its settings. */
  testSelection?: { discoverySessionId: string; testId: string };
}
export interface JavaExecutionProjectSelection {
  context: JavaProjectOperationContext;
  providerId: string;
  moduleId: string;
  sourceSetId: string;
}
export interface JavaDiscoveredTest {
  id: string;
  kind: "class" | "method";
  className: string;
  /** Method-name selections include every matching overload and invocation. */
  methodName: string | null;
  label: string;
  /** Bounded distinct runner display names sharing this method-name selection. */
  displayNames?: string[];
  displayNameCount?: number;
}
export interface JavaTestDiscovery {
  status: "collecting" | "ready" | "partial" | "unavailable";
  projectPath: string;
  buildTool: "jdk" | "maven" | "gradle";
  /** Maven compiled test classpath discovery or Gradle's configured default test task dry-run. */
  scope: "engines" | "test-task";
  tests: JavaDiscoveredTest[];
  message: string | null;
}
export interface JavaExecutionSessionRequest extends JavaExecutionContext {
  sessionId: string;
}
export interface JavaExecutionRestartRequest extends JavaExecutionSessionRequest {
  trusted: boolean;
  /** Current explicitly bound source choices; no stale fingerprint is refreshed implicitly. */
  sourceBreakpoints: JavaSavedSourceBreakpoint[];
}
export interface JavaFlightRecordingAnalysisRequest extends JavaExecutionSessionRequest {
  trusted: boolean;
}
export interface JavaFlightRecordingTimelineRequest extends JavaExecutionSessionRequest {
  trusted: boolean;
  eventType: string;
}
export interface JavaFlightRecordingEventType {
  name: string;
  count: number;
  sizeBytes: number;
}
export interface JavaFlightRecordingEvent {
  startTime: string;
  duration: string | null;
  threadName: string | null;
  /** Bounded non-metadata values for this recorded event. */
  payload: JavaFlightRecordingEventField[];
  payloadTruncated: boolean;
  /** Bounded sampled stack frames. Empty when this event has no recorded stack trace. */
  stackFrames: JavaFlightRecordingStackFrame[];
  stackTraceTruncated: boolean;
}
export interface JavaFlightRecordingEventField {
  name: string;
  /** JSON-encoded value, shortened when it exceeds the per-field output bound. */
  value: string;
}
export interface JavaFlightRecordingStackFrame {
  className: string | null;
  methodName: string | null;
  lineNumber: number | null;
  frameType: string | null;
}
export interface JavaFlightRecordingTimeline {
  workspaceId: string;
  generation: number;
  sessionId: string;
  profilePath: string;
  eventType: string;
  eventCount: number;
  truncated: boolean;
  events: JavaFlightRecordingEvent[];
}
export interface JavaFlightRecordingSummary {
  workspaceId: string;
  generation: number;
  sessionId: string;
  profilePath: string;
  recordingVersion: string;
  chunks: number;
  startTime: string;
  duration: string;
  events: JavaFlightRecordingEventType[];
}
export interface JavaTestRerunRequest extends JavaExecutionSessionRequest {
  trusted: boolean;
  /** Debug the failed selections using the captured test configuration. */
  debug?: boolean;
  /** Current saved breakpoints for a captured test-debug session. */
  sourceBreakpoints?: JavaSavedSourceBreakpoint[];
}
/** Workspace-relative compiled classpath entry; source ownership comes from the project provider. */
export interface JavaTestClassOrigin {
  path: string;
  kind: "directory" | "archive";
}
export interface JavaTestCaseResult {
  id: string;
  name: string;
  className: string;
  state: "passed" | "failed" | "error" | "skipped" | "flaky";
  durationMs: number | null;
  detail: string;
  detailTruncated: boolean;
  /** Runner method identity; its class can be the executing subclass for inherited tests. */
  methodSource?: {
    className: string;
    methodName: string;
    /** Unambiguous compiled declaration reported by inspection with the test task’s JDK. */
    declaringClassName?: string;
    /** Code source of the executing test class, when inspected with the test JDK. */
    testOrigin?: JavaTestClassOrigin;
    /** Code source of the unambiguous compiled declaring class. */
    declaringOrigin?: JavaTestClassOrigin;
  };
}
export interface JavaTestSuiteResult {
  reportPath: string;
  /** Workspace-relative Maven module corroborated for a custom report. Empty denotes the workspace root. */
  mavenReportModulePath?: string;
  name: string;
  cases: JavaTestCaseResult[];
}
export interface JavaTestRerunSelection {
  className: string;
  /** null means the whole class, including its previously passing methods. */
  methodName: string | null;
}
export interface JavaTestResults {
  status: "collecting" | "ready" | "partial" | "unavailable";
  projectPath: string;
  buildTool: "jdk" | "maven" | "gradle";
  suites: JavaTestSuiteResult[];
  summary: Record<JavaTestCaseResult["state"] | "total", number>;
  /** Unchanged reports are omitted rather than attributed to this execution. */
  unchangedReports: number;
  message: string | null;
  canRerunFailed: boolean;
  /** Actual selections derived by the native report reader; absent on older runtimes. */
  rerunSelections?: JavaTestRerunSelection[];
  rerunReason: string | null;
}
export interface JavaDebugCommandRequest extends JavaExecutionSessionRequest {
  command: string;
}
export interface JavaExecutionSnapshot extends JavaExecutionSessionRequest {
  /** Compiler-style locations reported by tool output; not a complete semantic diagnostic set. */
  compilerDiagnostics?: {
    items: JavaCompilerDiagnostic[];
    truncated: boolean;
  };
  applicationInput?: JavaApplicationInputState;
  /** Explicit native admission for debugging failures from this completed test session. */
  canDebugFailedTests?: boolean;
  operation: JavaExecutionOperation;
  state: JavaExecutionState;
  output: string;
  outputTruncated: boolean;
  exitCode: number | null;
  testResults?: JavaTestResults;
  coverage?: JavaCoverageResults;
  /** Requested test JVM settings could not be confirmed; exitCode still records the tool's exit. */
  testJvmOptionsError?: string;
  testDiscovery?: JavaTestDiscovery;
  debuggerState?: JavaDebuggerState;
  classReload?: JavaClassReloadResult;
  /** Workspace-relative JFR output, published when the application starts and kept if written. */
  profilePath?: string;
}
export interface JavaCompilerDiagnostic {
  /** Existing workspace-relative source path resolved in the native invocation directory. */
  path: string;
  line: number;
  /** Tool column is informational; navigation opens the line without assuming its column units. */
  reportedColumn: number | null;
  severity: "error" | "warning";
  message: string;
}
export interface JavaApplicationInputState {
  state: "waiting" | "open" | "closed" | "unavailable";
  /** Bytes accepted by the transport, which does not prove application consumption. */
  acceptedBytes: number;
  nextSequence: number;
  reason: string | null;
}
export interface JavaApplicationInputRequest extends JavaExecutionSessionRequest {
  /** Positive sequence; an exact retry returns the previous acknowledgement without writing. */
  sequence: number;
  /** Up to 4096 raw bytes, encoded as base64. Null sends EOF. */
  dataBase64: string | null;
}
export interface JavaApplicationInputResult extends JavaExecutionSessionRequest {
  sequence: number;
  acceptedBytes: number;
  input: JavaApplicationInputState;
}
