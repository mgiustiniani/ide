import { After, Given, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { NativeJavaConditionalDebuggerSession } from "../support/native-java-conditional-debugger.js";
const sessions = new WeakMap<StoryWorld, NativeJavaConditionalDebuggerSession>();
Given<StoryWorld>(
  "the native conditional debugger has an isolated looping Java program",
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error("Conditional debugger qualification requires a real native GUI.");
    const session = new NativeJavaConditionalDebuggerSession();
    sessions.set(this, session);
    await session.prepare();
  },
);
const actions: [string, (s: NativeJavaConditionalDebuggerSession) => Promise<void>][] = [
  [
    "the person saves a source condition and matching-hit count then reloads and restarts the clean IDE",
    (s) => s.launchAndSave(),
  ],
  [
    "the person starts Debug and the saved breakpoint stops at its third matching occurrence",
    (s) => s.savedHit(),
  ],
  [
    "the person continues and the one-shot source condition lets the remaining loop complete",
    (s) => s.finishSaved(),
  ],
  [
    "the person starts a fresh debugger and a runtime condition stops at its second match",
    (s) => s.runtimeHit(),
  ],
  [
    "an invalid condition leaves the old settings intact and a missing field suspends with a visible error",
    (s) => s.errors(),
  ],
  [
    "the person repairs the condition and observes two later matches before clearing it and completing",
    (s) => s.repairAndFinish(),
  ],
  [
    "the person runs a logpoint that interpolates live values and lets the JVM complete",
    (s) => s.logpoint(),
  ],
  [
    "the person enables a disabled saved logpoint from the editor during Debug and its settings survive completion and reload",
    (s) => s.enableSavedLogpointLive(),
  ],
  [
    "the person verifies caught and uncaught exception breakpoints with JDI",
    (s) => s.exceptionBreakpoints(),
  ],
  [
    "the person closes the clean conditional IDE after both observed JVM processes have exited",
    (s) => s.close(),
  ],
];
for (const [text, run] of actions)
  When<StoryWorld>(text, { timeout: 60000 }, async function () {
    const session = sessions.get(this);
    if (!session) throw new Error("Conditional debugger not prepared.");
    await run(session);
  });
After<StoryWorld>(
  {
    tags: "@native-java-conditional-debugger or @native-java-exception-breakpoints",
    timeout: 20000,
  },
  async function () {
    try {
      await sessions.get(this)?.cleanup();
    } finally {
      sessions.delete(this);
    }
  },
);
