import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeEditorDiskComparisonSession } from "../support/native-editor-disk-comparison.js";
import {
  NativeEditorHistorySession,
  type NativeHistoryMode,
} from "../support/native-editor-history.js";
import type { StoryWorld } from "../support/world.js";

const comparisons = new WeakMap<StoryWorld, NativeEditorDiskComparisonSession>();
const histories = new WeakMap<StoryWorld, NativeEditorHistorySession>();
function requireNative(world: StoryWorld) {
  if (
    world.targetProfile.name !== "desktop" ||
    world.targetProfile.driver !== "tauri-webdriver" ||
    world.targetEvidence?.nativeGui !== true ||
    world.targetEvidence.e2e !== true ||
    world.targetEvidence.packagedApplication !== false ||
    world.targetEvidence.artifactKind !== "release-no-bundle"
  )
    throw new Error("editor acceptance requires real release/no-bundle native GUI evidence");
}
function comparison(world: StoryWorld) {
  const value = comparisons.get(world);
  if (!value) throw new Error("native comparison fixture not prepared");
  return value;
}
function history(world: StoryWorld) {
  const value = histories.get(world);
  if (!value) throw new Error("native history fixture not prepared");
  return value;
}
Given<StoryWorld>(
  "the disk-comparison GUI has two isolated deterministic source files",
  async function () {
    requireNative(this);
    if (comparisons.has(this)) throw new Error("native comparison fixture already prepared");
    const value = new NativeEditorDiskComparisonSession();
    comparisons.set(this, value);
    await value.prepare();
  },
);
const historyFixtures: Array<[string, NativeHistoryMode]> = [
  ["the retention GUI has an isolated workspace with two deterministic source files", "retention"],
  ["the history GUI has an isolated workspace with two deterministic source files", "history"],
  [
    "the missing-source recovery GUI has an isolated workspace with deterministic sources",
    "missing",
  ],
  [
    "the storage-failure recovery GUI has an isolated workspace with deterministic sources",
    "storage-failure",
  ],
];
for (const [text, mode] of historyFixtures)
  Given<StoryWorld>(text, async function () {
    requireNative(this);
    if (histories.has(this)) throw new Error("native history fixture already prepared");
    const value = new NativeEditorHistorySession(mode);
    histories.set(this, value);
    await value.prepare();
  });
type Step<T> = readonly [string, (session: T) => Promise<void>, number?];
const comparisonActions: Step<NativeEditorDiskComparisonSession>[] = [
  [
    "the production disk-comparison IDE opens and the person makes both buffers dirty",
    (s) => s.launch(),
    40_000,
  ],
  ["the person inspects the original disk source beside the draft", (s) => s.inspectOriginal()],
  [
    "the person reviews a disk snapshot while a new draft checkpoint is pending",
    (s) => s.inspectPendingDraft(),
  ],
  ["the person starts adopting the inspected disk snapshot", (s) => s.startAsyncAdoption()],
  [
    "an external writer updates the source while adoption awaits the recovery checkpoint",
    (s) => s.writeDuringAsyncAdoption(),
  ],
  [
    "the person edits the adopted buffer and attempts Save over the newer disk revision",
    (s) => s.refuseAsyncAdoptionSave(),
  ],
  [
    "the person adopts the latest disk revision and saves a new edit",
    (s) => s.freshAsyncAdoptionAndSave(),
  ],
  ["the person cancels disk inspection with Escape", (s) => s.cancelOriginal()],
  [
    "the person saves through the keyboard while that disk review remains open",
    (s) => s.saveDuringReview(),
  ],
  ["the person attempts to adopt the obsolete pre-save disk review", (s) => s.refuseStaleReview()],
  [
    "the person edits again, an external writer changes the source, and the person cancels the new inspection",
    (s) => s.externalAndCancel(),
  ],
  [
    "the person attempts Save after that cancelled external-disk inspection",
    (s) => s.refuseSaveAfterCancel(),
  ],
  ["the person reviews the external disk source again", (s) => s.reviewExternal()],
  [
    "a later external writer changes the source after the disk review",
    (s) => s.writeLaterExternal(),
  ],
  ["the person explicitly adopts only the inspected disk snapshot", (s) => s.adoptInspected()],
  [
    "the person edits the adopted buffer and attempts Save over the later revision",
    (s) => s.refuseSaveAfterAdoption(),
  ],
  [
    "the person freshly compares and adopts the latest disk version before editing and saving again",
    (s) => s.freshAdoptionAndSave(),
  ],
  [
    "the person explicitly discards the companion draft and closes the clean comparison IDE through X11",
    (s) => s.discardCompanionAndClose(),
  ],
  ["an external writer deletes the open comparison source", (s) => s.deleteSource()],
  ["the person requests disk inspection of the deleted source", (s) => s.inspectDeleted()],
  ["the person requests Save for the deleted comparison source", (s) => s.saveDeleted()],
  [
    "both deleted-source scenario drafts are acknowledged as checkpoints before the owned IDE is terminated",
    (s) => s.checkpointAndTerminate(),
  ],
];
const comparisonAssertions: Step<NativeEditorDiskComparisonSession>[] = [
  [
    "cancelling disk inspection has retained both drafts and both source files",
    (s) => s.assertCancelled(),
  ],
  [
    "the stale comparison refusal retains the explicitly saved buffer instead of loading its old disk text",
    (s) => s.assertStale(),
  ],
  [
    "cancelled inspection has not advanced the save baseline or overwritten the external revision",
    (s) => s.assertCancelledBaseline(),
  ],
  [
    "the inspected text is a clean buffer but the later disk write and companion draft remain intact",
    (s) => s.assertAdopted(),
  ],
  [
    "adoption loads only the inspected snapshot and leaves the later disk write untouched",
    (s) => s.assertAsyncAdoption(),
  ],
  [
    "the later external revision is preserved and the new buffer edits remain dirty",
    (s) => s.assertLaterConflict(),
  ],
  [
    "the later external write is preserved and the new buffer edits remain dirty",
    (s) => s.assertAsyncAdoptionSaveRefused(),
  ],
  [
    "the subsequent ordinary Save succeeds against that newly adopted revision",
    (s) => s.assertFreshSave(),
  ],
  [
    "the comparison IDE exits with only the deliberate external writes and explicit saves on disk",
    (s) => s.assertFinal(),
  ],
  [
    "disk inspection reports unavailable while the deleted-source draft and companion edits survive",
    (s) => s.assertDeletedRead(),
  ],
  [
    "Save reports failure without recreating the source or clearing either dirty buffer",
    (s) => s.assertDeletedSave(),
  ],
  [
    "the terminated comparison IDE has not recreated the deleted source or changed the companion file",
    (s) => s.assertFinal(),
  ],
];
const historyActions: Step<NativeEditorHistorySession>[] = [
  [
    "the person checkpoints three companion versions and returns to the source",
    (s) => s.createRetentionCompanion(),
  ],
  [
    "the person types and acknowledges 102 successive source versions without saving",
    (s) => s.rotateHistory(),
    240_000,
  ],
  [
    "the person reviews and cancels the oldest and newest retained source histories",
    (s) => s.reviewRetainedVersions(),
  ],
  [
    "the person restores the newest retained source history after rotation",
    (s) => s.restoreLatestRetainedVersion(),
  ],
  ["the production history IDE opens its source file", (s) => s.launch(), 40_000],
  [
    "the person edits and explicitly checkpoints the first history version",
    (s) => s.createFirstCheckpoint(),
  ],
  [
    "the person checkpoints a second version and leaves newer source and companion edits dirty",
    (s) => s.createHistory(),
  ],
  [
    "the person reviews and cancels each of the two older history versions",
    (s) => s.reviewBothHistoryVersions(),
  ],
  ["the person explicitly restores the first local-history version", (s) => s.restoreFirst()],
  [
    "the person requests removal of the second history checkpoint but cancels confirmation",
    (s) => s.cancelRemoval(),
  ],
  [
    "the person separately confirms permanent removal of the second history checkpoint",
    (s) => s.confirmRemoval(),
  ],
  [
    "the person explicitly discards both history scenario drafts and closes the clean IDE through X11",
    (s) => s.discardAndClose(),
  ],
  [
    "the owned history IDE is terminated and an external writer deletes that checkpoint's source file",
    (s) => s.terminateAndDeleteSource(),
  ],
  [
    "the missing-source history IDE is relaunched with the same workspace and private storage",
    (s) => s.launch(),
    40_000,
  ],
  ["the person reviews the missing source's recoverable draft", (s) => s.reviewMissingSource()],
  [
    "the person selects and copies the missing-source checkpoint through native pointer and keyboard actions",
    (s) => s.copyMissingCheckpoint(),
  ],
  [
    "the person cancels the missing-source review and closes the clean IDE through X11",
    (s) => s.cancelMissingAndClose(),
  ],
  [
    "the native journal pathname is temporarily obstructed while its valid bytes are retained",
    (s) => s.blockJournal(),
  ],
  [
    "the person makes a newer edit and requests a checkpoint while storage is obstructed",
    (s) => s.checkpointWhileBlocked(),
  ],
  [
    "the person requests ordinary Save while recovery storage remains obstructed",
    (s) => s.saveWhileBlocked(),
  ],
  [
    "the journal pathname is repaired and the person explicitly retries checkpointing",
    (s) => s.unblockAndRetry(),
  ],
  ["the person closes the clean storage-retry IDE through X11", (s) => s.closeAfterRetry()],
];
const historyAssertions: Step<NativeEditorHistorySession>[] = [
  [
    "exactly the newest 100 histories and both current drafts remain in native storage and the inventory",
    (s) => s.assertRetentionInventory(),
  ],
  [
    "restoration after rotation preserves the companion draft and both saved sources",
    (s) => s.assertRetentionRestored(),
  ],
  [
    "the first history checkpoint is acknowledged without a source save",
    (s) => s.assertFirstAcknowledged(),
  ],
  [
    "both older histories are selectable and removal of the current draft is disabled",
    (s) => s.assertHistoryInventory(),
  ],
  [
    "the exact selected texts were presented without replacing either current dirty buffer",
    (s) => s.assertHistoryCancelled(),
  ],
  [
    "history restoration changes only the reviewed buffer and retains its checkpoint and unrelated edits",
    (s) => s.assertHistoryRestored(),
  ],
  [
    "cancelled history removal preserves the journal, source bytes and dirty buffers",
    (s) => s.assertRemovalCancelled(),
  ],
  [
    "only that selected checkpoint disappears from native storage and the visible inventory",
    (s) => s.assertOnlySelectedRemoved(),
  ],
  ["the history IDE exits with both original source files unchanged", (s) => s.assertFinal()],
  [
    "the missing-source review retains its checkpoint text and disables automatic buffer replacement",
    (s) => s.assertMissingReview(),
  ],
  [
    "the native clipboard contains the exact checkpoint while the source remains absent",
    (s) => s.assertMissingCopy(),
  ],
  [
    "the missing-source IDE exits without recreating the file or changing its companion",
    (s) => s.assertFinal(),
  ],
  [
    "a visible recovery failure retains the dirty buffer, unchanged source and previous journal bytes",
    (s) => s.assertStorageFailure(),
  ],
  [
    "the source Save succeeds without hiding the recovery failure or changing the retained journal",
    (s) => s.assertSaveDuringFailure(),
  ],
  [
    "recovery becomes ready again and its earlier acknowledged checkpoint remains selectable",
    (s) => s.assertRetried(),
  ],
  [
    "the storage-retry IDE exits with only the explicit source Save on disk",
    (s) => s.assertFinal(),
  ],
];
for (const [text, run, timeout = 30_000] of comparisonActions)
  When<StoryWorld>(text, { timeout }, async function () {
    await run(comparison(this));
  });
for (const [text, run, timeout = 30_000] of comparisonAssertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await run(comparison(this));
  });
for (const [text, run, timeout = 30_000] of historyActions)
  When<StoryWorld>(text, { timeout }, async function () {
    await run(history(this));
  });
for (const [text, run, timeout = 30_000] of historyAssertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await run(history(this));
  });

After<StoryWorld>(
  {
    tags: "@REQ-IDE-EDITOR-DISK-COMPARISON-001 or @native-recovery-history or @native-recovery-failures",
    timeout: 20_000,
  },
  async function () {
    const value = comparisons.get(this) ?? histories.get(this);
    if (!value) return;
    comparisons.delete(this);
    histories.delete(this);
    try {
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostic = value.diagnostics();
      if (diagnostic) await this.attach(diagnostic, "text/plain");
    }
  },
);
