import { After, Given, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaAttachSession } from "../support/native-java-attach.js";

const sessions = new WeakMap<StoryWorld, NativeJavaAttachSession>();
Given<StoryWorld>(
  "the native attach GUI has an independently started real JVM listening for JDWP",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error("JDI attachment requires the native GUI target.");
    const session = new NativeJavaAttachSession();
    sessions.set(this, session);
    await session.prepare();
  },
);
const actions: [string, (session: NativeJavaAttachSession) => Promise<void>][] = [
  [
    "the person configures and restores its saved JDI socket endpoint with trust disabled",
    (s) => s.configure(),
  ],
  ["the person edits the attach source without saving it", (s) => s.edit()],
  ["the person trusts the workspace and attaches without source writes", (s) => s.attach()],
  [
    "the attached debugger inspects a field and source frame with a verified local line breakpoint",
    (s) => s.inspect(),
  ],
  [
    "the person refreshes prepared class names from the attached JVM",
    (s) => s.refreshLoadedClasses(),
  ],
  ["the person selects External from the attached JVM class list", (s) => s.selectLoadedClass()],
  ["the person runs the attached JVM to a source cursor in the caller", (s) => s.runToCursor()],
  ["the person filters JDK stepping and exact or subclass exceptions in the attached JVM", (s) => s.filterStepsAndExceptions()],
  [
    "the person builds and reloads a saved method body while the attached JVM stays connected",
    (s) => s.reload(),
  ],
  [
    "the JVM refuses a compiled structural change while preserving the running program",
    (s) => s.refuseSchema(),
  ],
  [
    "the person detaches and the external JVM continues with its source unchanged",
    (s) => s.detach(),
  ],
  [
    "the person attempts a refused connection without fabricating debugger success",
    (s) => s.refuse(),
  ],
  ["the person closes the clean attach IDE and the external JVM remains alive", (s) => s.close()],
];
for (const [name, run] of actions)
  When<StoryWorld>(name, { timeout: 60000 }, async function () {
    const session = sessions.get(this);
    if (!session) throw new Error("Native attach not prepared.");
    await run(session);
  });
After<StoryWorld>({ tags: "@native-java-jdi-attach", timeout: 20000 }, async function () {
  try {
    await sessions.get(this)?.cleanup();
  } finally {
    sessions.delete(this);
  }
});
