import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaLibraryNavigationSession } from "../support/native-java-library-navigation.js";

const sessions = new WeakMap<StoryWorld, NativeJavaLibraryNavigationSession>();
const session = (world: StoryWorld) => {
  const s = sessions.get(world);
  if (!s) throw new Error("Library navigation scenario not prepared.");
  return s;
};
Given<StoryWorld>(
  /^the native library navigation GUI has an isolated (Maven|Gradle) dependency, selected JDK and (saved|editor) Java source$/,
  { timeout: 30000 },
  async function (tool: string, authority: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error("Library qualification requires a real native release/no-bundle GUI.");
    const s = new NativeJavaLibraryNavigationSession();
    sessions.set(this, s);
    await s.prepare(tool.toLowerCase() as "maven" | "gradle", authority as "saved" | "editor");
  },
);
Given<StoryWorld>(
  /^the native library navigation GUI has an isolated (Maven|Gradle) modular dependency, selected JDK and saved Java source$/,
  { timeout: 30000 },
  async function (tool: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error("Library qualification requires a real native release/no-bundle GUI.");
    const s = new NativeJavaLibraryNavigationSession();
    sessions.set(this, s);
    await s.prepare(tool.toLowerCase() as "maven" | "gradle", "saved", true);
  },
);
Given<StoryWorld>(
  "the native JDK source GUI has a selected JDK 25 and an isolated Maven project",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error("JDK source qualification requires a real native release/no-bundle GUI.");
    const s = new NativeJavaLibraryNavigationSession();
    sessions.set(this, s);
    await s.prepare("platform", "saved");
  },
);
Given<StoryWorld>(
  "the native JDK 21 source GUI has no selected JDK source archive",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error("JDK source qualification requires a real native release/no-bundle GUI.");
    const s = new NativeJavaLibraryNavigationSession();
    sessions.set(this, s);
    await s.prepare("platform-unavailable", "saved");
  },
);
Given<StoryWorld>(
  "the native JDK 21 source GUI has no selected JDK source archive and an unsaved Java edit",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error("JDK source qualification requires a real native release/no-bundle GUI.");
    const s = new NativeJavaLibraryNavigationSession();
    sessions.set(this, s);
    await s.prepare("platform-unavailable", "editor");
  },
);
When<StoryWorld>(
  "the person synchronizes the Java project with an unrelated text draft open",
  { timeout: 180000 },
  async function () {
    await session(this).launchAndSynchronize();
  },
);
When<StoryWorld>(
  "the person requests outgoing call hierarchy from the Java caller method",
  { timeout: 30000 },
  async function () {
    await session(this).requestClasspathCallHierarchy();
  },
);
Then<StoryWorld>(
  "the native call hierarchy preserves both exact dependency overloads and opens only workspace call sites",
  { timeout: 30000 },
  async function () {
    await session(this).assertClasspathCallHierarchy();
  },
);
When<StoryWorld>(
  "the person requests F12 at the selected JDK method",
  { timeout: 30000 },
  async function () {
    await session(this).definition();
  },
);
When<StoryWorld>(
  "the person requests F12 at the overloaded external library call",
  { timeout: 30000 },
  async function () {
    await session(this).definition();
  },
);
Then<StoryWorld>(
  "the native library document selects the exact name and blocks typing and saving",
  { timeout: 30000 },
  async function () {
    await session(this).assertDefinitionAndProtection();
  },
);
Then<StoryWorld>(
  "the JDK source tab selects the exact declaration and blocks typing and saving",
  { timeout: 30000 },
  async function () {
    await session(this).assertDefinitionAndProtection();
  },
);
Then<StoryWorld>(
  "the editor reports the missing JDK source and opens no source tab",
  { timeout: 30000 },
  async function () {
    await session(this).assertDefinitionAndProtection();
  },
);
When<StoryWorld>(
  "the person opens the owning source from the Java toolbar",
  { timeout: 30000 },
  async function () {
    await session(this).openOwningSource();
  },
);
Then<StoryWorld>(
  "the owning library snapshot preserves the current Java frame and unrelated draft",
  { timeout: 30000 },
  async function () {
    await session(this).assertOwningSource();
  },
);
Then<StoryWorld>(
  "the selected JDK source snapshot remains read-only and preserves the unrelated draft",
  { timeout: 30000 },
  async function () {
    await session(this).assertOwningSource();
  },
);
Then<StoryWorld>(
  "the editor keeps the JDK source unavailable and preserves the unrelated draft",
  { timeout: 30000 },
  async function () {
    await session(this).assertOwningSource();
  },
);
When<StoryWorld>(
  "the person discards the text draft and closes the library navigation IDE",
  { timeout: 90000 },
  async function () {
    await session(this).closeAndVerify();
  },
);
When<StoryWorld>(
  "the person discards both editor and text drafts and closes the library navigation IDE",
  { timeout: 90000 },
  async function () {
    await session(this).closeAndVerify();
  },
);
Then<StoryWorld>(
  "the editor keeps the JDK source unavailable and preserves the Java editor frame and text draft",
  { timeout: 30000 },
  async function () {
    await session(this).assertOwningSource();
  },
);
Then<StoryWorld>(
  "the library navigation IDE exits with all source and dependency inputs unchanged",
  function () {
    if (!session(this).evidence().cleanExit)
      throw new Error("Native library navigation did not exit cleanly.");
  },
);
After<StoryWorld>(
  {
    tags: "@REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001 or @native-java-platform-source or @native-java-platform-unavailable",
    timeout: 60000,
  },
  async function ({ result }) {
    const s = sessions.get(this);
    if (!s) return;
    try {
      if (result?.status !== "PASSED") await s.captureFailure(result?.message);
      await this.attach(JSON.stringify(s.evidence(), null, 2), "application/json");
    } finally {
      await s.dispose();
      sessions.delete(this);
    }
  },
);
