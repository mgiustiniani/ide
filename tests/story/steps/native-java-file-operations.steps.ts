import { After, Given, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaFileOperationsSession } from "../support/native-java-file-operations.js";

const sessions = new WeakMap<StoryWorld, NativeJavaFileOperationsSession>();
Given<StoryWorld>(
  "a real RefactorKit Java file-operation workspace for {string}",
  { timeout: 20000 },
  async function (operation: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error("Java file operations require the native GUI target.");
    const session = new NativeJavaFileOperationsSession();
    sessions.set(this, session);
    await session.prepare(operation);
  },
);
const actions: [string, (session: NativeJavaFileOperationsSession) => Promise<void>][] = [
  [
    "the person opens the Java source and its editor context action refuses unsaved edits",
    (s) => s.launchAndRefuseDirty(),
  ],
  [
    "the person saves the Java source and reviews its exact file operation without writing",
    (s) => s.preview(),
  ],
  [
    "the person applies the reviewed file operation and the resulting Java source compiles with unchanged behavior",
    (s) => s.applyAndCompile(),
  ],
  [
    "the person rolls the file operation back and observes the original source on disk and in the editor",
    (s) => s.rollback(),
  ],
  [
    "the person closes the clean file-operation IDE with unrelated files preserved",
    (s) => s.close(),
  ],
];
for (const [text, run] of actions)
  When<StoryWorld>(text, { timeout: 60000 }, async function () {
    const session = sessions.get(this);
    if (!session) throw new Error("Java file operation not prepared.");
    await run(session);
  });
After<StoryWorld>({ tags: "@native-java-file-operations", timeout: 20000 }, async function () {
  try {
    await sessions.get(this)?.cleanup();
  } finally {
    sessions.delete(this);
  }
});
