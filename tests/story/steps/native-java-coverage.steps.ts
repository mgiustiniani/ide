import { After, Given, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { NativeJavaCoverageSession } from "../support/native-java-coverage.js";
const sessions = new WeakMap<StoryWorld, NativeJavaCoverageSession>();
Given<StoryWorld>(
  "the native {word} coverage GUI has an isolated branching Java project",
  async function (tool: string) {
    if (
      !["maven", "gradle"].includes(tool) ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error("Coverage requires selected real native GUI evidence.");
    const session = new NativeJavaCoverageSession(tool as "maven" | "gradle");
    sessions.set(this, session);
    await session.prepare();
  },
);
const actions: [string, (s: NativeJavaCoverageSession) => Promise<void>][] = [
  [
    "the person configures the selected project and literal test JVM options before trusting coverage",
    (s) => s.launch(),
  ],
  [
    "the person runs one test with coverage and sees one of two measured branches",
    (s) => s.first(),
  ],
  [
    "the person edits the test without saving and coverage presents its saved failure and measurements",
    (s) => s.failure(),
  ],
  [
    "the person repairs the test and reruns failures with coverage despite changed form selections",
    (s) => s.rerun(),
  ],
  [
    "the person repeats the captured coverage session with its original threshold and test selection",
    (s) => s.repeat(),
  ],
  ["the person runs both tests and sees both branches covered", (s) => s.all()],
  [
    "the person filters the reported tests without changing the completed result or rerun selection",
    (s) => s.filterReportedTests(),
  ],
  [
    "the person compares the complete coverage measurement with the earlier single-test run",
    (s) => s.compareHistory(),
  ],
  [
    "the person stops a running coverage JVM and no complete current measurement remains visible",
    (s) => s.stop(),
  ],
  ["the person closes the clean coverage IDE with unchanged project descriptors", (s) => s.close()],
  [
    "the person reopens the IDE, compares saved coverage and clears its saved history",
    (s) => s.reopenAndClearHistory(),
  ],
];
for (const [text, run] of actions)
  When<StoryWorld>(text, { timeout: 90000 }, async function () {
    const session = sessions.get(this);
    if (!session) throw new Error("Coverage not prepared.");
    await run(session);
  });
After<StoryWorld>({ tags: "@native-java-coverage", timeout: 20000 }, async function () {
  try {
    await sessions.get(this)?.cleanup();
  } finally {
    sessions.delete(this);
  }
});
