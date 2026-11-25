import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeEditorCloseGuardsSession } from "../support/native-editor-close-guards.js";
import { NativeJavaExecutionSession } from "../support/native-java-execution.js";
import { NativeJavaJdkTestNgSession } from "../support/native-java-jdk-testng.js";
import type { StoryWorld } from "../support/world.js";

const guards = new WeakMap<StoryWorld, NativeEditorCloseGuardsSession>();
const java = new WeakMap<StoryWorld, NativeJavaExecutionSession>();
const jdkTestNg = new WeakMap<StoryWorld, NativeJavaJdkTestNgSession>();
function requireNative(world: StoryWorld, allowPackaged = false) {
  if (
    world.targetProfile.name !== "desktop" ||
    world.targetProfile.driver !== "tauri-webdriver" ||
    world.targetEvidence?.nativeGui !== true ||
    world.targetEvidence.e2e !== true ||
    (allowPackaged
      ? !matchesNativeArtifactEvidence(world.targetEvidence)
      : world.targetEvidence.packagedApplication !== false ||
        world.targetEvidence.artifactKind !== "release-no-bundle")
  )
    throw new Error("qualification requires matching native desktop artifact evidence");
}
function guard(world: StoryWorld) {
  const value = guards.get(world);
  if (!value) throw new Error("native guard scenario not prepared");
  return value;
}
function execution(world: StoryWorld) {
  const value = java.get(world);
  if (!value) throw new Error("native Java scenario not prepared");
  return value;
}
function plainJdkTestNg(world: StoryWorld) {
  const value = jdkTestNg.get(world);
  if (!value) throw new Error("plain-JDK TestNG scenario not prepared");
  return value;
}
Given<StoryWorld>(
  "the close-guard GUI has two isolated registered workspaces and deterministic source files",
  async function () {
    requireNative(this);
    if (guards.has(this)) throw new Error("guard scenario already prepared");
    const value = new NativeEditorCloseGuardsSession();
    guards.set(this, value);
    await value.prepare();
  },
);
Given<StoryWorld>(
  "the native Java execution GUI has an isolated workspace with a deterministic main class",
  async function () {
    requireNative(this, true);
    if (java.has(this)) throw new Error("Java scenario already prepared");
    const value = new NativeJavaExecutionSession();
    java.set(this, value);
    await value.prepare();
  },
);
Given<StoryWorld>(
  "the native Java profiling GUI has an isolated workspace and a controllable real JFR tool",
  async function () {
    requireNative(this, true);
    if (java.has(this)) throw new Error("Java scenario already prepared");
    const value = new NativeJavaExecutionSession();
    java.set(this, value);
    await value.prepare(true);
  },
);
Given<StoryWorld>(
  "the native plain-JDK TestNG GUI has an isolated real project",
  async function () {
    requireNative(this, true);
    if (jdkTestNg.has(this)) throw new Error("plain-JDK TestNG scenario already prepared");
    const value = new NativeJavaJdkTestNgSession();
    jdkTestNg.set(this, value);
    await value.prepare();
  },
);

Given<StoryWorld>(
  "the native plain-JDK TestNG GUI has Unicode class and method names",
  async function () {
    requireNative(this, true);
    const value = new NativeJavaJdkTestNgSession(true);
    jdkTestNg.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the person runs and debugs the Unicode main class",
  { timeout: 90_000 },
  async function () {
    await plainJdkTestNg(this).runAndDebugUnicodeMain();
  },
);

type Step<T> = readonly [string, (session: T) => Promise<void>, number?];
const guardActions: Step<NativeEditorCloseGuardsSession>[] = [
  ["the production close-guard IDE opens the primary workspace", (s) => s.launch(), 40_000],
  ["the person edits both guard buffers without saving", (s) => s.makeDirty()],
  ["an external writer changes the guard source", (s) => s.changeSourceExternally()],
  ["the person closes the conflicting guard tab", (s) => s.closeConflictingTab()],
  [
    "the person selects the other workspace while guard buffers are dirty",
    (s) => s.switchWhileDirty(),
  ],
  ["the person requests the owned native window close through X11", (s) => s.requestDirtyClose()],
  [
    "the person closes the other guard tab with a current save revision",
    (s) => s.closeSavableTab(),
  ],
  [
    "the person explicitly adopts the guard disk version and switches to the other workspace",
    (s) => s.resolveAndSwitch(),
  ],
  ["the person closes the clean guard IDE through the same X11 protocol", (s) => s.closeCleanly()],
];
const guardAssertions: Step<NativeEditorCloseGuardsSession>[] = [
  [
    "the tab refusal preserves both dirty buffers and the external revision",
    (s) => s.assertTabRefused(),
  ],
  [
    "the workspace refusal retains the current workspace and source buffers",
    (s) => s.assertSwitchRefused(),
  ],
  [
    "the native close refusal leaves the IDE responsive with both dirty buffers",
    (s) => s.assertNativeCloseRefused(),
  ],
  [
    "that tab is saved before closing and the conflicting buffer is retained",
    (s) => s.assertSavedTabClosed(),
  ],
  [
    "the resolved workspace transition retains the destination source unchanged",
    (s) => s.assertSwitched(),
  ],
  [
    "the clean IDE exits with only the explicit tab save and external write on disk",
    (s) => s.assertFinal(),
  ],
];
const javaActions: Step<NativeJavaExecutionSession>[] = [
  [
    "the production Java IDE opens Main.java and selects Java Run from the command palette",
    (s) => s.launch(),
    40_000,
  ],
  [
    "the person edits the main class through the keyboard without saving",
    (s) => s.editBeforeBuild(),
  ],
  ["the person confirms Java workspace trust and requests Build", (s) => s.trustAndBuild()],
  [
    "the person confirms Java workspace trust and requests Run with JFR from Commands",
    (s) => s.trustAndRunWithJfr("commands"),
  ],
  [
    "the person confirms Java workspace trust and requests Run with JFR",
    (s) => s.trustAndRunWithJfr(),
  ],
  [
    "the person reruns the captured profiling session and restarts its active JVM with an edited source",
    (s) => s.repeatAndRestartJfrRun(),
  ],
  ["the person requests Run for the configured main class", (s) => s.runMain()],
  [
    "the person reruns Java while summary and timeline reads are each held before the real JFR tool",
    (s) => s.rerunWhileJfrReadsAreHeld(),
    45_000,
  ],
  ["the person introduces invalid Java syntax and requests Build", (s) => s.breakCompilation()],
  ["the person repairs the main class and starts a long-running Java task", (s) => s.runLongTask()],
  ["the person presses Stop in the Java Run activity", (s) => s.stopTask()],
  ["the person closes the clean Java IDE through the native window protocol", (s) => s.close()],
];
const javaAssertions: Step<NativeJavaExecutionSession>[] = [
  [
    "Java Run remains responsive and new recordings remain analyzable across the held reads",
    (s) => s.assertHeldJfrReadResponsiveness(),
  ],
  [
    "Java execution actions are disabled before the person confirms workspace trust",
    (s) => s.assertUntrusted(),
  ],
  [
    "the edited source is saved and the real compiler produces a successful class file",
    (s) => s.assertBuild(),
  ],
  [
    "the Java console and workspace output file prove execution of the edited main class",
    (s) => s.assertRun(),
  ],
  [
    "the Java console and saved JFR recording prove execution, expose readable metadata, and show a bounded event timeline with selected event fields and sampled stack traces",
    (s) => s.assertJfrRun(),
  ],
  [
    "the new JFR recording identifies the replacement JVM and the original recording remains unchanged",
    (s) => s.assertRestartedJfrRecording(),
  ],
  [
    "the native Java console reports a compiler failure and opens its source line without overwriting an unsaved draft",
    (s) => s.assertCompileFailure(),
  ],
  ["an owned real JVM is running and Stop is enabled", (s) => s.assertLongRunning()],
  ["the Java task is stopped and its observed JVM has exited", (s) => s.assertStopped()],
  [
    "the Java IDE exits without further source changes or escaped user storage",
    (s) => s.assertFinal(),
  ],
];
for (const [text, run, timeout = 30_000] of guardActions)
  When<StoryWorld>(text, { timeout }, async function () {
    await run(guard(this));
  });
for (const [text, run, timeout = 30_000] of guardAssertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await run(guard(this));
  });
for (const [text, run, timeout = 30_000] of javaActions)
  When<StoryWorld>(text, { timeout }, async function () {
    await run(execution(this));
  });
for (const [text, run, timeout = 30_000] of javaAssertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await run(execution(this));
  });

type PlainJdkTestNgStep = readonly [
  string,
  (session: NativeJavaJdkTestNgSession) => Promise<void>,
  number?,
];
const plainJdkTestNgActions: readonly PlainJdkTestNgStep[] = [
  [
    "the production plain-JDK IDE opens the TestNG fixture and Java Run activity",
    (s) => s.launch(),
    40_000,
  ],
  ["the person trusts the workspace and runs the full TestNG suite", (s) => s.trustAndRunSuite()],
  [
    "the person repairs the TestNG failure and reruns only the failed method",
    (s) => s.repairAndRerunFailure(),
  ],
  ["the person requests plain-JDK TestNG discovery", (s) => s.discoverTests()],
  [
    "the person changes current settings and runs a discovered TestNG method",
    (s) => s.changeCurrentSettingsAndRunCapturedMethod(),
  ],
  [
    "the person closes the clean plain-JDK TestNG IDE through the native X11 protocol",
    (s) => s.close(),
  ],
];
const plainJdkTestNgAssertions: readonly PlainJdkTestNgStep[] = [
  [
    "plain-JDK TestNG actions remain disabled until workspace trust is given",
    (s) => s.assertUntrusted(),
  ],
  [
    "the native TestNG results show one pass and one failure with fresh XML",
    (s) => s.assertFailedSuite(),
  ],
  ["the captured TestNG rerun reports one passing method", (s) => s.assertRerunPassed()],
  ["discovery leaves test bodies untouched", (s) => s.assertDiscoveryDidNotRunBodies()],
  [
    "the captured TestNG method runs and reports its own fresh result",
    (s) => s.assertCapturedMethodPassed(),
  ],
  ["the plain-JDK TestNG IDE exits with confined reports and dependencies", (s) => s.assertFinal()],
];
for (const [text, run, timeout = 30_000] of plainJdkTestNgActions)
  When<StoryWorld>(text, { timeout }, async function () {
    await run(plainJdkTestNg(this));
  });
for (const [text, run, timeout = 30_000] of plainJdkTestNgAssertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await run(plainJdkTestNg(this));
  });

After<StoryWorld>(
  {
    tags: "(@REQ-IDE-EDITOR-CLOSE-GUARDS-001 and not @native-editor-save-close-race) or @native-java-jdk or @native-java-jfr",
    timeout: 20_000,
  },
  async function () {
    const value = guards.get(this) ?? java.get(this);
    if (!value) return;
    guards.delete(this);
    java.delete(this);
    try {
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostic = value.diagnostics();
      if (diagnostic) await this.attach(diagnostic, "text/plain");
    }
  },
);

After<StoryWorld>({ tags: "@native-java-plain-jdk-testng", timeout: 30_000 }, async function () {
  const value = jdkTestNg.get(this);
  if (!value) return;
  jdkTestNg.delete(this);
  try {
    await value.dispose();
  } finally {
    await this.attach(JSON.stringify(value.evidence()), "application/json");
    const diagnostic = value.diagnostics();
    if (diagnostic) await this.attach(diagnostic, "text/plain");
  }
});
