import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeEditorSaveCloseRaceSession } from "../support/native-editor-save-close-race.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeEditorSaveCloseRaceSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Save/Close race was not prepared");
  return value;
}
Given<StoryWorld>(
  "the native Save-close race has isolated original and companion source files",
  async function () {
    if (
      this.targetProfile.name !== "desktop" ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error("Save/Close race qualification requires a real native desktop application");
    const value = new NativeEditorSaveCloseRaceSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the production IDE opens and acknowledges both keyboard-edited race buffers",
  { timeout: 40000 },
  async function () {
    await session(this).launchAndEdit();
  },
);
When<StoryWorld>(
  "the person requests tab close while a real Linux file lease holds source I\\/O",
  async function () {
    await session(this).requestBlockedClose();
  },
);
When<StoryWorld>(
  "the person types newer buffer edits before releasing the held source I\\/O",
  async function () {
    await session(this).editDuringSave();
  },
);
Then<StoryWorld>(
  "the pending close writes only its captured source and retains newer dirty edits and the companion",
  async function () {
    await session(this).assertRetained();
  },
);
When<StoryWorld>("the person explicitly saves the retained newer race buffer", async function () {
  await session(this).saveLatest();
});
Then<StoryWorld>(
  "the source contains the newer edits and the companion source is still unchanged",
  async function () {
    await session(this).assertSaved();
  },
);
When<StoryWorld>(
  "the person explicitly discards the companion draft and closes the clean race IDE through X11",
  async function () {
    await session(this).close();
  },
);
Then<StoryWorld>(
  "the owned race IDE exits with only the explicit saves and confined storage",
  async function () {
    await session(this).assertFinal();
  },
);
After<StoryWorld>({ tags: "@native-editor-save-close-race", timeout: 20000 }, async function () {
  const value = sessions.get(this);
  sessions.delete(this);
  if (!value) return;
  try {
    await value.dispose();
  } finally {
    await this.attach(JSON.stringify(value.evidence()), "application/json");
    const diagnostic = value.diagnostics();
    if (diagnostic) await this.attach(diagnostic, "text/plain");
  }
});
