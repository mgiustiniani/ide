import { After, Given, Status, Then, When } from "@cucumber/cucumber";
import { NativeStartupResponsivenessSession } from "../support/native-startup-responsiveness.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeStartupResponsivenessSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("startup scenario not prepared");
  return value;
}
Given<StoryWorld>(
  "an isolated startup workspace and a delayed launcher for the real installed RefactorKit CLI",
  async function () {
    if (
      this.targetProfile.name !== "desktop" ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error("startup acceptance requires a real native release GUI");
    const value = new NativeStartupResponsivenessSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the production startup IDE launches with that provider",
  { timeout: 40_000 },
  async function () {
    await session(this).launch();
  },
);
Then<StoryWorld>(
  "the File Explorer and recovery become ready while the provider probe remains pending",
  { timeout: 25_000 },
  async function () {
    await session(this).assertReadyDuringProbe();
  },
);
When<StoryWorld>(
  "the person opens the startup source through the File Explorer",
  { timeout: 25_000 },
  async function () {
    await session(this).openSource();
  },
);
Then<StoryWorld>(
  "Monaco presents its exact saved content without modifying source",
  async function () {
    await session(this).assertSource();
  },
);
Then<StoryWorld>(
  "the provider eventually reports the real CLI version",
  { timeout: 20_000 },
  async function () {
    await session(this).assertRealVersion();
  },
);
When<StoryWorld>(
  "the person closes the clean startup IDE through the native window protocol",
  async function () {
    await session(this).close();
  },
);
Then<StoryWorld>(
  "startup state remains confined and the scenario is released without forced termination",
  async function () {
    await session(this).assertFinal();
  },
);
After<StoryWorld>(
  { tags: "@REQ-IDE-STARTUP-RESPONSIVENESS-NATIVE-001", timeout: 20_000 },
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
