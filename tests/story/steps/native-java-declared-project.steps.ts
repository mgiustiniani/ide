import { After, Given, When, Then } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaDeclaredProjectSession } from "../support/native-java-declared-project.js";
const sessions = new WeakMap<StoryWorld, NativeJavaDeclaredProjectSession>();
Given<StoryWorld>(
  "the plain Java GUI has explicit sources and a dependency JAR",
  { timeout: 30_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true
    )
      throw new Error("Declared Java acceptance requires the real native application");
    const value = new NativeJavaDeclaredProjectSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
for (const [phrase, operation] of [
  [
    "the plain Java form has declared separate test roots and dependencies",
    "verifyTestsDeclaredThroughForm",
  ],
  ["the person runs one declared test method and reviews fresh results", "runDeclaredTest"],
  [
    "the person discovers declared tests without execution and runs a captured method",
    "discoverAndRunDeclaredTest",
  ],
  ["the person creates a plain Java declaration through the project form", "createDeclaration"],
  ["the person synchronizes and selects the declared JDK source set", "synchronizeAndChoose"],
  ["Build compiles only the declared sources into the chosen output directory", "build"],
  ["the person builds each declared module in dependency order", "build"],
  ["the person runs the declared main from the source file action", "runFileMain"],
  [
    "the person debugs the declared main at the cursor through a source breakpoint",
    "debugCursorMain",
  ],
  ["the person closes the plain Java IDE", "close"],
  ["the plain Java inputs are preserved and the IDE exits cleanly", "assertFinal"],
] as const) {
  const define = operation === "build" || operation === "assertFinal" ? Then : When;
  define<StoryWorld>(phrase, { timeout: 90_000 }, async function () {
    const value = sessions.get(this);
    if (!value) throw new Error("Missing declared Java GUI session");
    try {
      await value[operation]();
    } catch (error) {
      await value.captureFailure(error);
      throw error;
    }
  });
}
Given<StoryWorld>(
  "the plain Java {word} GUI has explicit sources and framework libraries",
  { timeout: 30_000 },
  async function (framework: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true
    )
      throw new Error("Declared Java tests require the real native application");
    const value = new NativeJavaDeclaredProjectSession();
    sessions.set(this, value);
    if (!["JUnit", "TestNG"].includes(framework))
      throw new Error("Unsupported declared Java framework fixture");
    await value.prepare(true, framework === "TestNG" ? "testng" : "junit");
  },
);
After<StoryWorld>({ tags: "@native-java-declared-project", timeout: 20_000 }, async function () {
  const value = sessions.get(this);
  if (!value) return;
  sessions.delete(this);
  try {
    await value.dispose();
  } finally {
    await this.attach(JSON.stringify(value.evidence()), "application/json");
  }
});
