import { After, Given, Status, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { NativeJavaDebuggerSession } from "../support/native-java-debugger.js";

const sessions = new WeakMap<StoryWorld, NativeJavaDebuggerSession>();
async function prepare(
  world: StoryWorld,
  finish: string,
  mode: "jdb" | "jdi",
  loadSavedBreakpoint = true,
) {
  if (
    world.targetProfile.name !== "desktop" ||
    world.targetProfile.driver !== "tauri-webdriver" ||
    world.targetEvidence?.nativeGui !== true ||
    world.targetEvidence.e2e !== true ||
    !matchesNativeArtifactEvidence(world.targetEvidence)
  )
    throw new Error("debugger acceptance requires matching native desktop artifact evidence");
  if (finish !== "complete" && finish !== "stop" && finish !== "busy")
    throw new Error("unknown debugger finish");
  const value = new NativeJavaDebuggerSession(finish, mode, loadSavedBreakpoint);
  sessions.set(world, value);
  await value.prepare();
}
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native debugger scenario not prepared");
  return value;
}
Given<StoryWorld>(
  "the native debugger GUI has an isolated main class and a {word} finish",
  async function (finish: string) {
    await prepare(this, finish, "jdb");
  },
);
Given<StoryWorld>(
  "the native JDI debugger GUI has an isolated main class and a {word} finish",
  async function (finish: string) {
    await prepare(this, finish, "jdi");
  },
);
Given<StoryWorld>(
  "the native JDI debugger GUI has an isolated main class for Run to Cursor",
  async function () {
    await prepare(this, "complete", "jdi", false);
  },
);
const actions: [string, (session: NativeJavaDebuggerSession) => Promise<void>][] = [
  [
    "the person saves the Java draft through configured Build and Run commands and runs it again with Ctrl F5",
    (s) => s.buildAndRunConfiguredCommands(),
  ],
  [
    "the person starts, steps, restarts, stops and reruns the configured Java debugger with function keys",
    (s) => s.debugWithConfiguredFunctionKeys(),
  ],
  ["the production debugger IDE opens the source and literal launch settings", (s) => s.launch()],
  [
    "the person edits the main class and trusts the workspace before requesting Debug",
    (s) => s.editAndDebug(),
  ],
  [
    "the person sets a source-line breakpoint and requests Continue",
    (s) => s.breakpointAndContinue(),
  ],
  [
    "the person confirms the saved source breakpoint is loaded and requests Continue",
    (s) => s.breakpointAndContinue(),
  ],
  ["the person revokes and restores trust, mutes line breakpoints and runs the suspended JDI session to a cursor line in Monaco", (s) => s.runToCursor()],
  ["the person requests stack, locals, threads and expression evaluation", (s) => s.inspect()],
  ["the person inspects JDI threads, frames, fields, arrays and watches", (s) => s.inspect()],
  [
    "the person evaluates read-only string, numeric, computed-index, array-type, primitive-cast and conditional expressions once",
    (s) =>
      s.evaluateOnce([
        {
          expression: '"" + holder.text.length() + holder.marker',
          type: "java.lang.String",
          value: '"5!"',
        },
        { expression: "0x1_0 + 0b10", type: "int", value: "18" },
        { expression: "holder.values[base + 26]", type: "int", value: "33" },
        { expression: "holder.values instanceof int[]", type: "boolean", value: "true" },
        { expression: "holder.values instanceof java.lang.Object[]", type: "boolean", value: "false" },
        { expression: "(byte) holder.number", type: "byte", value: "7" },
        {
          expression: "holder.number > 5 ? holder.text.length() : holder.values[44]",
          type: "int",
          value: "5",
        },
        {
          expression: "holder.number < 5 ? holder.values[44] : holder.text.length()",
          type: "int",
          value: "5",
        },
        { expression: "true ? false ? 1 : 2 : 3", type: "int", value: "2" },
        { expression: "false ? 1 : true ? 2 : 3", type: "int", value: "2" },
        { expression: "true || holder.number < 0 ? 1 : 0", type: "int", value: "1" },
      ]),
  ],
  [
    "the person steps into and over to a local, changes it explicitly, then steps out and clears the breakpoint",
    (s) => s.stepAndClear(),
  ],
  [
    "the person steps into, over and out of the method and clears the breakpoint",
    (s) => s.stepAndClear(),
  ],
  ["the person finishes the configured debugger session", (s) => s.finishDebugging()],
  [
    "the person restarts the live debugger then reruns its captured settings after changing the form",
    (s) => s.restartAndRerunCapturedSession(),
  ],
  [
    "the person drops the selected method frame and reenters it with its changed argument",
    (s) => s.dropFrameAndReenter(),
  ],
  [
    "the person builds and reviews a changed compiled class before confirming reload",
    (s) => s.buildReviewAndReloadChangedClass(),
  ],
  [
    "the person completes or pauses and stops the configured JDI session",
    (s) => s.finishDebugging(),
  ],
  ["the person closes the clean debugger IDE through the native window protocol", (s) => s.close()],
];
const assertions: [string, (session: NativeJavaDebuggerSession) => Promise<void>][] = [
  [
    "the configured Java commands save the source and execute the actual application",
    (s) => s.assertConfiguredRunCommands(),
  ],
  ["Debug is disabled before trust and no execution artifacts exist", (s) => s.assertUntrusted()],
  [
    "the edited source is saved and the real debugger starts with application code suspended",
    (s) => s.assertSavedAndSuspended(),
  ],
  [
    "the owned real JVM stops at the breakpoint with the captured launch settings",
    (s) => s.assertBreakpointAndSettings(),
  ],
  [
    "the debugger console presents the actual main frame, local value, threads and evaluation",
    (s) => s.assertInspection(),
  ],
  [
    "the structured JDI view presents actual locals, object fields and both array pages without executing methods",
    (s) => s.assertInspection(),
  ],
  [
    "Run to Cursor stops at the selected source line and removes its temporary breakpoint",
    (s) => s.assertRunToCursor(),
  ],
  [
    "the structured JDI view returns typed values and leaves the persistent watch set unchanged",
    async (s) => {
      if (!s.structuredOneTimeEvaluationPassed())
        throw new Error(
          "one-time JDI expressions did not return typed values without adding watches",
        );
    },
  ],
  [
    "the debugger console proves callee stepping and return without running the next source statement",
    (s) => s.assertStepping(),
  ],
  [
    "the structured JDI view proves the local change, frame selection, callee stepping and return before the next source statement",
    (s) => s.assertStepping(),
  ],
  [
    "the debugger and debuggee exit with the expected completion or Stop result",
    (s) => s.assertFinished(),
  ],
  [
    "the debugger IDE exits with only the explicit source save and confined storage",
    (s) => s.assertFinal(),
  ],
];
for (const [text, run] of actions)
  When<StoryWorld>(text, { timeout: 40_000 }, async function () {
    await run(session(this));
  });
for (const [text, run] of assertions)
  Then<StoryWorld>(text, { timeout: text.includes("application code suspended") ? 45_000 : 30_000 }, async function () {
    await run(session(this));
  });
After<StoryWorld>(
  {
    tags: "@native-java-debugger or @native-java-jdi-debugger or @native-java-run-to-cursor or @native-java-class-change-review or @native-java-drop-frame or @native-java-restart-session or @native-java-execution-commands",
    timeout: 20_000,
  },
  async function ({ result }) {
    const value = sessions.get(this);
    try {
      if (value && result?.status === Status.FAILED) await value.captureFailure(result.message);
      await value?.cleanup();
    } finally {
      sessions.delete(this);
    }
  },
);
