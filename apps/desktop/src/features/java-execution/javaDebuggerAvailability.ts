import type { JavaDebuggerState } from "@ide/contracts";

/** Runtime admission shared by debugger controls and configured Java commands. */
export function javaDebuggerAvailability(state: JavaDebuggerState | undefined, active: boolean) {
  const suspended = active && state?.status === "suspended" && Boolean(state.stopId);
  const ready = active && Boolean(state) && state?.status !== "terminated";
  const canStep =
    suspended && Boolean(state?.selectedFrameId) && state?.selectedFrameId === state?.frames[0]?.id;
  return { suspended, ready, canStep, canPause: active && state?.status === "running" };
}
