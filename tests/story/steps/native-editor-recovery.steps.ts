import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeEditorRecoverySession } from "../support/native-editor-recovery.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeEditorRecoverySession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native recovery scenario has not been prepared");
  return value;
}
Given<StoryWorld>(
  "the recovery GUI uses an isolated workspace with two deterministic source files and private user storage",
  async function () {
    if (
      this.targetProfile.name !== "desktop" ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    ) {
      throw new Error("native recovery requires explicit real release/no-bundle GUI evidence");
    }
    if (sessions.has(this)) throw new Error("native recovery scenario already prepared");
    const value = new NativeEditorRecoverySession();
    sessions.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the production recovery IDE is launched through the native driver",
  { timeout: 40_000 },
  async function () {
    await session(this).launch();
  },
);
When<StoryWorld>(
  "the person replaces the recovery buffer through the keyboard without saving",
  { timeout: 20_000 },
  async function () {
    await session(this).editUnsavedDraft();
  },
);
Then<StoryWorld>(
  "the automatic recovery checkpoint is acknowledged while both source files remain unchanged",
  { timeout: 15_000 },
  async function () {
    await session(this).awaitAutomaticCheckpoint();
  },
);
When<StoryWorld>(
  "the owned recovery IDE is forcibly terminated without closing or saving",
  { timeout: 15_000 },
  async function () {
    await session(this).terminate();
  },
);
When<StoryWorld>(
  "the recovery IDE is relaunched with the same workspace and user storage",
  { timeout: 40_000 },
  async function () {
    await session(this).launch();
  },
);
Then<StoryWorld>(
  "its previous-session draft is visible without automatically replacing the disk buffer",
  { timeout: 15_000 },
  async function () {
    await session(this).exposeRecoverableDraft();
  },
);
When<StoryWorld>(
  "the person makes the companion buffer dirty without saving",
  { timeout: 25_000 },
  async function () {
    await session(this).editUnrelatedBuffer();
  },
);
When<StoryWorld>(
  "the person reviews the previous-session recovery checkpoint",
  { timeout: 15_000 },
  async function () {
    await session(this).review();
  },
);
When<StoryWorld>(
  "the person reviews the previous-session recovery checkpoint again",
  { timeout: 15_000 },
  async function () {
    await session(this).review();
  },
);
When<StoryWorld>("the person cancels the recovery review", { timeout: 10_000 }, async function () {
  await session(this).cancel();
});
Then<StoryWorld>(
  "cancelling has retained the original buffer, dirty companion and both disk sources",
  { timeout: 10_000 },
  async function () {
    await session(this).assertCancellation();
  },
);
When<StoryWorld>("an external writer changes the source after that review", async function () {
  await session(this).changeDiskAfterReview();
});
When<StoryWorld>(
  "the person explicitly restores the reviewed recovery checkpoint",
  { timeout: 25_000 },
  async function () {
    await session(this).restore();
  },
);
Then<StoryWorld>(
  "the recovered buffer is dirty, the companion edits survive and the original checkpoint is retained",
  { timeout: 10_000 },
  async function () {
    await session(this).assertRestored();
  },
);
When<StoryWorld>(
  "the person tries to save the recovered buffer over the later external revision",
  { timeout: 15_000 },
  async function () {
    await session(this).refuseConflictingSave();
  },
);
Then<StoryWorld>(
  "Save is visibly refused and the later disk revision is preserved",
  { timeout: 10_000 },
  async function () {
    await session(this).assertSaveRefused();
  },
);
When<StoryWorld>(
  "the person explicitly discards both dirty buffers through disk comparison and closes the recovered IDE",
  { timeout: 30_000 },
  async function () {
    await session(this).discardAndClose();
  },
);
Then<StoryWorld>(
  "the recovered IDE exits without changing source files or escaping its isolated storage",
  { timeout: 10_000 },
  async function () {
    await session(this).assertClosed();
  },
);

After<StoryWorld>({ tags: "@REQ-IDE-EDITOR-RECOVERY-001", timeout: 20_000 }, async function () {
  const value = sessions.get(this);
  if (!value) return;
  sessions.delete(this);
  try {
    await value.dispose();
  } finally {
    await this.attach(JSON.stringify(value.evidence()), "application/json");
    const diagnostics = value.diagnostics();
    if (diagnostics) await this.attach(diagnostics, "text/plain");
  }
});
