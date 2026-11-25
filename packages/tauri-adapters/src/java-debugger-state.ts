import { isJavaBinaryName } from "@ide/contracts";
import type { JavaDebuggerState, JavaDebuggerVariable } from "@ide/contracts";

function invalid(): never {
  throw new Error("Invalid structured Java debugger state.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number, nullable = false): boolean {
  return (
    (nullable && value === null) ||
    (typeof value === "string" &&
      new TextEncoder().encode(value).length <= limit &&
      !value.includes("\0"))
  );
}
function natural(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) invalid();
  return value;
}
function variable(value: unknown): JavaDebuggerVariable {
  const item = object(value);
  if (
    !text(item.name, 2048) ||
    !text(item.type, 2048) ||
    !text(item.value, 2048) ||
    typeof item.valueTruncated !== "boolean" ||
    !text(item.reference, 128, true) ||
    !natural(item.childCount)
  )
    invalid();
  return item as unknown as JavaDebuggerVariable;
}
export function normalizeJavaDebuggerState(
  value: unknown,
  executionState: string,
): JavaDebuggerState {
  const state = object(value);
  if (
    (state.canReloadClasses !== undefined && typeof state.canReloadClasses !== "boolean") ||
    (state.canDropFrame !== undefined && typeof state.canDropFrame !== "boolean") ||
    (state.breakpointsMuted !== undefined && typeof state.breakpointsMuted !== "boolean") ||
    !["running", "suspended", "terminated"].includes(String(state.status)) ||
    !["none", "caught", "uncaught", "all"].includes(String(state.exceptionMode)) ||
    (state.exceptionClassName !== undefined && state.exceptionClassName !== "" && !isJavaBinaryName(state.exceptionClassName)) ||
    (state.exceptionIncludeSubclasses !== undefined && typeof state.exceptionIncludeSubclasses !== "boolean") ||
    ![null, "entry", "breakpoint", "step", "pause", "exception", "frame-drop"].includes(
      state.reason as string | null,
    ) ||
    !text(state.stopId, 128, true) ||
    !text(state.selectedThreadId, 128, true) ||
    !text(state.selectedFrameId, 128, true) ||
    !text(state.message, 4096, true) ||
    !text(state.error, 4096, true) ||
    ![state.threadsTruncated, state.framesTruncated, state.variablesTruncated].every(
      (value) => typeof value === "boolean",
    )
  )
    invalid();
  if (
    (state.status === "suspended") !==
      (typeof state.stopId === "string" && state.stopId.length > 0) ||
    (["succeeded", "failed", "stopped"].includes(executionState) && state.status !== "terminated")
  )
    invalid();
  const threads = array(state.threads, 128).map((value) => {
    const thread = object(value);
    if (
      !text(thread.id, 128) ||
      !thread.id ||
      !text(thread.name, 2048) ||
      !Number.isSafeInteger(thread.status) ||
      typeof thread.suspended !== "boolean"
    )
      invalid();
    return thread;
  });
  const frames = array(state.frames, 128).map((value) => {
    const frame = object(value);
    if (
      !text(frame.id, 128) ||
      !frame.id ||
      !text(frame.className, 2048) ||
      !text(frame.methodName, 2048) ||
      !text(frame.sourcePath, 16384, true) ||
      (frame.obsolete !== undefined && typeof frame.obsolete !== "boolean") ||
      !(frame.line === null || (natural(frame.line) && frame.line > 0))
    )
      invalid();
    return frame;
  });
  const variables = array(state.variables, 128).map(variable);
  if (state.loadedClasses !== undefined) {
    let previousClassName: string | undefined;
    for (const value of array(state.loadedClasses, 2000)) {
      const item = object(value);
      if (
        !text(item.className, 2048) ||
        !isJavaBinaryName(item.className) ||
        !natural(item.classLoaderCount) ||
        item.classLoaderCount < 1 ||
        (previousClassName !== undefined && previousClassName >= String(item.className))
      )
        invalid();
      previousClassName = String(item.className);
    }
  }
  if (
    state.loadedClassesTruncated !== undefined &&
    typeof state.loadedClassesTruncated !== "boolean"
  )
    invalid();
  if (
    new Set(threads.map((thread) => thread.id)).size !== threads.length ||
    new Set(frames.map((frame) => frame.id)).size !== frames.length ||
    (state.selectedThreadId !== null &&
      !threads.some((thread) => thread.id === state.selectedThreadId && thread.suspended)) ||
    (state.selectedFrameId !== null && !frames.some((frame) => frame.id === state.selectedFrameId))
  )
    invalid();
  if (state.evaluation !== null) {
    const evaluation = object(state.evaluation);
    if (
      !text(evaluation.stopId, 128) ||
      !text(evaluation.frameId, 128) ||
      !text(evaluation.expression, 512) ||
      /[\r\n]/.test(String(evaluation.expression)) ||
      !text(evaluation.error, 4096, true) ||
      (evaluation.variable === null) === (evaluation.error === null) ||
      state.status !== "suspended" ||
      evaluation.stopId !== state.stopId ||
      evaluation.frameId !== state.selectedFrameId
    )
      invalid();
    if (evaluation.variable !== null) variable(evaluation.variable);
  }
  array(state.breakpoints, 128).forEach((value) => {
    const breakpoint = object(value);
    if (
      !text(breakpoint.className, 2048, true) ||
      !text(breakpoint.sourcePath, 4096, true) ||
      (breakpoint.className === null) === (breakpoint.sourcePath === null) ||
      !natural(breakpoint.line) ||
      breakpoint.line < 1 ||
      typeof breakpoint.verified !== "boolean" ||
      !text(breakpoint.message, 4096, true) ||
      (breakpoint.condition !== undefined &&
        (!text(breakpoint.condition, 512) || /[\r\n]/.test(String(breakpoint.condition)))) ||
      (breakpoint.hitCount !== undefined &&
        (!natural(breakpoint.hitCount) || breakpoint.hitCount > 1_000_000_000)) ||
      (breakpoint.logMessage !== undefined &&
        (!text(breakpoint.logMessage, 512) || /[\r\n]/.test(String(breakpoint.logMessage)))) ||
      (breakpoint.hits !== undefined &&
        (!natural(breakpoint.hits) ||
          breakpoint.hits > 1_000_000_000 ||
          (Number(breakpoint.hitCount) > 0 && breakpoint.hits > Number(breakpoint.hitCount))))
    )
      invalid();
  });
  array(state.watches, 32).forEach((value) => {
    const watch = object(value);
    if (
      !text(watch.expression, 512) ||
      /[\r\n]/.test(String(watch.expression)) ||
      !text(watch.error, 4096, true) ||
      (watch.variable === null) === (watch.error === null)
    )
      invalid();
    if (watch.variable !== null) variable(watch.variable);
  });
  if (state.variablePage !== null) {
    const page = object(state.variablePage);
    if (
      !text(page.reference, 128) ||
      !page.reference ||
      !natural(page.start) ||
      !natural(page.total) ||
      page.start > page.total
    )
      invalid();
    const values = array(page.variables, 32).map(variable);
    if (page.start + values.length > page.total) invalid();
  }
  if (
    state.canDropFrame === true &&
    (state.status !== "suspended" ||
      frames.findIndex((frame) => frame.id === state.selectedFrameId) < 0 ||
      frames.findIndex((frame) => frame.id === state.selectedFrameId) + 1 >= frames.length)
  )
    invalid();
  if (
    state.status !== "suspended" &&
    (frames.length ||
      variables.length ||
      state.variablePage !== null ||
      state.selectedFrameId !== null ||
      state.selectedThreadId !== null)
  )
    invalid();
  return state as unknown as JavaDebuggerState;
}
