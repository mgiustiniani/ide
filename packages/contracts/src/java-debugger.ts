/** Runtime mirrors supplied by JDI. Identifiers are opaque and valid only at the current stop. */
export interface JavaDebuggerVariable {
  name: string;
  type: string;
  value: string;
  valueTruncated: boolean;
  reference: string | null;
  childCount: number;
}
/** A prepared type reported by the current JVM. It does not identify a workspace class file. */
export interface JavaLoadedClass {
  className: string;
  /** Number of loaded definitions with this name across class loaders. */
  classLoaderCount: number;
}
/** Empty conditions match every occurrence; zero hit count stops on every match. */
export interface JavaBreakpointOptions {
  condition?: string;
  hitCount?: number;
  /** Nonempty messages turn the breakpoint into a logpoint that resumes without suspending. */
  logMessage?: string;
}
export interface JavaDebuggerState {
  /** Present only when the helper supports session-local muting of line breakpoints and logpoints. */
  breakpointsMuted?: boolean;
  /** Actual capability of the connected JVM; absence does not advertise HotSwap. */
  canReloadClasses?: boolean;
  /** JDI permits removing the selected frame and its younger frames, with a visible Java caller. */
  canDropFrame?: boolean;
  status: "running" | "suspended" | "terminated";
  stopId: string | null;
  reason: "entry" | "breakpoint" | "step" | "pause" | "exception" | "frame-drop" | null;
  exceptionMode: "none" | "caught" | "uncaught" | "all";
  exceptionClassName?: string;
  exceptionIncludeSubclasses?: boolean;
  selectedThreadId: string | null;
  selectedFrameId: string | null;
  threads: { id: string; name: string; status: number; suspended: boolean }[];
  frames: {
    id: string;
    className: string;
    methodName: string;
    sourcePath: string | null;
    line: number | null;
    obsolete?: boolean;
  }[];
  variables: JavaDebuggerVariable[];
  variablePage: {
    reference: string;
    start: number;
    total: number;
    variables: JavaDebuggerVariable[];
  } | null;
  breakpoints: {
    className: string | null;
    sourcePath: string | null;
    line: number;
    verified: boolean;
    message: string | null;
    condition?: string;
    hitCount?: number;
    hits?: number;
    logMessage?: string;
  }[];
  watches: { expression: string; variable: JavaDebuggerVariable | null; error: string | null }[];
  evaluation: {
    stopId: string;
    frameId: string;
    expression: string;
    variable: JavaDebuggerVariable | null;
    error: string | null;
  } | null;
  threadsTruncated: boolean;
  framesTruncated: boolean;
  variablesTruncated: boolean;
  /** Bounded names explicitly requested from the current JVM. */
  loadedClasses?: JavaLoadedClass[];
  loadedClassesTruncated?: boolean;
  message: string | null;
  error: string | null;
}
/** Already compiled workspace files. Compilation and source saves remain explicit operations. */
export interface JavaClassReloadRequest {
  workspaceId: string;
  generation: number;
  sessionId: string;
  trusted: boolean;
  stopId: string | null;
  classes: { className: string; classFile: string; expectedSha256?: string }[];
}
/** A build-tool/JDK compilation that runs alongside the captured JDI session. */
export interface JavaClassReloadBuildRequest {
  workspaceId: string;
  generation: number;
  sessionId: string;
  trusted: boolean;
}
export interface JavaClassReloadBuildResult {
  workspaceId: string;
  generation: number;
  sessionId: string;
  state: "succeeded" | "failed";
  exitCode: number;
  output: string;
  outputTruncated: boolean;
  /** Optional for older native providers. This is a file comparison, not JVM provenance. */
  classChanges?: JavaCompiledClassChanges;
}
export interface JavaCompiledClassChanges {
  status: "ready" | "unavailable";
  stopId: string | null;
  classes: { className: string; classFile: string; expectedSha256: string }[];
  message: string;
}
export interface JavaClassReloadResult {
  requestId: string;
  status: "queued" | "applied" | "failed";
  classes: string[];
  error: string | null;
}
export type JavaDebuggerAction =
  | { type: "muteBreakpoints"; muted: boolean }
  | { type: "dropFrame"; stopId: string; frameId: string }
  | { type: "listLoadedClasses" }
  | { type: "continue"; stopId: string }
  | { type: "step"; stopId: string; kind: "into" | "over" | "out"; exclusionFilters?: string[] }
  | { type: "pause" }
  | { type: "selectThread"; stopId: string; threadId: string }
  | { type: "selectFrame"; stopId: string; frameId: string }
  | { type: "variables"; stopId: string; reference: string; start: number }
  | ({ type: "setBreakpoint"; className: string; line: number } & JavaBreakpointOptions)
  | { type: "clearBreakpoint"; className: string; line: number }
  | { type: "watch" | "removeWatch"; stopId: string; expression: string }
  | { type: "evaluate"; stopId: string; expression: string }
  | { type: "setLocalValue"; stopId: string; frameId: string; assignment: string }
  | { type: "exceptions"; mode: "none" | "caught" | "uncaught" | "all"; className?: string; includeSubclasses?: boolean };
export interface JavaDebuggerActionRequest {
  workspaceId: string;
  generation: number;
  sessionId: string;
  action: JavaDebuggerAction;
}

/** Exact active editor text is checked against the source captured before compilation. */
export interface JavaDebuggerSourceRequest {
  workspaceId: string;
  generation: number;
  sessionId: string;
  requestId: string;
  document: { path: string; text: string; version: number };
  stopId: string | null;
  frameId: string | null;
}
export interface JavaDebuggerSourceView {
  workspaceId: string;
  generation: number;
  sessionId: string;
  requestId: string;
  documentPath: string;
  documentVersion: number;
  stopId: string | null;
  frameId: string | null;
  sourcePath: string;
  executionLine: number | null;
  breakpoints: { line: number; verified: boolean }[];
}
export interface JavaSourceBreakpointRequest extends JavaBreakpointOptions {
  source: JavaDebuggerSourceRequest;
  line: number;
}

/** One-shot source breakpoint request; the debugger removes it at the next stop. */
export interface JavaRunToCursorRequest {
  source: JavaDebuggerSourceRequest;
  line: number;
}

/** A person's source-line choice, bound to the exact UTF-8 editor text. Verification belongs to JDI. */
export interface JavaSavedSourceBreakpoint extends JavaBreakpointOptions {
  sourcePath: string;
  line: number;
  fingerprint: string;
}
