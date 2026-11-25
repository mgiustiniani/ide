import { After, Given, Status, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeWorkspaceTerminalSession } from "../support/native-workspace-terminal.js";
const sessions = new WeakMap<StoryWorld, NativeWorkspaceTerminalSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("Native terminal scenario was not prepared.");
  return value;
}
Given<StoryWorld>(
  "the native workspace terminal has an isolated Java source and two working directories",
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error("Terminal acceptance requires a real native GUI.");
    const value = new NativeWorkspaceTerminalSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
const actions: [string, (session: NativeWorkspaceTerminalSession) => Promise<void>][] = [
  ["the production desktop opens its integrated terminal", (s) => s.launch()],
  ["the person starts a shell and compiles Java through the terminal keyboard", (s) => s.compile()],
  ["the person hides the terminal, returns and resizes its native window", (s) => s.hideResize()],
  [
    "the person interrupts a Java program that has run for more than ten seconds",
    (s) => s.interrupt(),
  ],
  ["the person uses Commands to create, clear and stop selected terminal sessions", (s) => s.twoSessions()],
  [
    "the person reloads the interface with a running terminal and then closes a fresh active session",
    (s) => s.reloadClose(),
  ],
];
const assertions: [string, (session: NativeWorkspaceTerminalSession) => Promise<void>][] = [
  ["no shell starts before the person trusts workspace shell execution", (s) => s.untrusted()],
  [
    "the real terminal output and saved files prove Java execution and retained shell state",
    (s) => s.javaResult(),
  ],
  ["the same shell remains attached and its real PTY dimensions change", (s) => s.resized()],
  ["Ctrl+C ends that JVM and the same shell accepts another command", (s) => s.interrupted()],
  [
    "Stop preserves the other session and terminates the selected shell and its background job",
    (s) => s.selectedStopped(),
  ],
  [
    "renderer reload revokes the old terminal and normal application close terminates the final owned jobs",
    (s) => s.final(),
  ],
];
for (const [text, run] of actions)
  When<StoryWorld>(text, { timeout: 40_000 }, async function () {
    await run(session(this));
  });
for (const [text, run] of assertions)
  Then<StoryWorld>(text, { timeout: 15_000 }, async function () {
    await run(session(this));
  });
After<StoryWorld>(
  { tags: "@native-workspace-terminal", timeout: 20_000 },
  async function ({ result }) {
    const value = sessions.get(this);
    try {
      if (result?.status === Status.FAILED) await value?.captureFailure(result.message);
      await value?.cleanup();
    } finally {
      sessions.delete(this);
    }
  },
);
