import { After, Given, Then, When } from "@cucumber/cucumber";
import {
  NativeEditorRecoveryFaultSession,
  type RecoveryFaultMode,
} from "../support/native-editor-recovery-capacity-corruption.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeEditorRecoveryFaultSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native recovery fault fixture not prepared");
  return value;
}
for (const [text, mode] of [
  [
    "the capacity recovery GUI has a source of exactly one MiB UTF-8 and an isolated companion",
    "capacity",
  ],
  [
    "the corruption recovery GUI has isolated deterministic sources and private storage",
    "corruption",
  ],
] as const)
  Given<StoryWorld>(text, async function () {
    if (
      this.targetProfile.name !== "desktop" ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error(
        "recovery capacity/corruption acceptance requires real release/no-bundle native GUI evidence",
      );
    if (sessions.has(this)) throw new Error("native recovery fault fixture already prepared");
    const value = new NativeEditorRecoveryFaultSession(mode as RecoveryFaultMode);
    sessions.set(this, value);
    await value.prepare();
  });
type Step = readonly [string, (s: NativeEditorRecoveryFaultSession) => Promise<void>, number?];
const actions: Step[] = [
  [
    "the production capacity IDE creates two small acknowledged drafts through keyboard editing",
    (s) => s.acknowledge(),
    40_000,
  ],
  [
    "the production corruption IDE acknowledges a small unsaved source checkpoint",
    (s) => s.acknowledge(),
    40_000,
  ],
  [
    "the person undoes the source edit and types one extra byte at the end",
    (s) => s.undoAndExceed(),
  ],
  ["the person requests a checkpoint of that oversized recovery buffer", (s) => s.checkpoint()],
  [
    "the person refreshes checkpoint inventory without shrinking the oversized buffer",
    (s) => s.refreshOversized(),
  ],
  ["the person explicitly saves the oversized source buffer", (s) => s.saveCapacity()],
  ["the person explicitly checkpoints the remaining valid companion draft", (s) => s.checkpoint()],
  [
    "the person explicitly discards the capacity companion draft and closes the clean IDE through X11",
    (s) => s.discardCompanionAndClose(),
  ],
  [
    "the owned corruption IDE is terminated and the issued journal is truncated with its valid bytes retained",
    (s) => s.terminateAndCorrupt(),
  ],
  [
    "the corruption IDE is relaunched with the same isolated workspace and storage",
    (s) => s.relaunchCorrupt(),
    40_000,
  ],
  [
    "the valid journal is externally repaired and the person retries checkpointing with no dirty buffers",
    (s) => s.repairAndRetry(),
  ],
  [
    "the journal is truncated again and the person edits both source and companion buffers",
    (s) => s.corruptAgainAndEdit(),
  ],
  ["the person requests a checkpoint while the journal is corrupt", (s) => s.checkpoint()],
  [
    "the person explicitly saves the source while recovery storage remains corrupt",
    (s) => s.saveCorruptSource(),
  ],
  [
    "the valid journal is externally repaired and the person retries the remaining dirty checkpoint",
    (s) => s.repairAndRetry(),
  ],
  [
    "the person explicitly discards the corruption companion draft and closes the clean IDE through X11",
    (s) => s.discardCompanionAndClose(),
  ],
];
const assertions: Step[] = [
  [
    "both checkpoints are acknowledged while the original source bytes are unchanged",
    (s) => s.assertAcknowledged(),
  ],
  [
    "recovery visibly refuses while the exact oversized buffer, companion draft and previous journal bytes survive",
    (s) => s.assertCapacityFailure(),
  ],
  [
    "refresh does not hide the failed checkpoint or claim the newest edits are durable",
    (s) => s.assertCapacityRefresh(),
  ],
  [
    "ordinary Save writes those exact bytes and clears only that source buffer's dirty state",
    (s) => s.assertCapacitySave(),
  ],
  [
    "recovery becomes ready and the original small source checkpoint is retained as history",
    (s) => s.assertCapacityRetry(),
  ],
  ["the capacity IDE exits with only the explicit source Save on disk", (s) => s.assertFinal()],
  [
    "the issued checkpoint is acknowledged without changing either source file",
    (s) => s.assertAcknowledged(),
  ],
  [
    "startup reports unreadable recovery storage without restoring a buffer or replacing the truncated journal",
    (s) => s.assertCorruptStartup(),
  ],
  [
    "the retry revalidates storage and presents the original recoverable draft without a source write",
    (s) => s.assertNoopRetry(),
  ],
  [
    "the corrupt journal, valid retained bytes and both dirty buffers survive the visible failure",
    (s) => s.assertCorruptCheckpointFailure(),
  ],
  [
    "the source Save succeeds while the journal remains untouched and the companion stays dirty",
    (s) => s.assertCorruptSave(),
  ],
  [
    "recovery becomes ready with the original issued draft retained and its review does not replace the saved source",
    (s) => s.assertCorruptRetryAndReview(),
  ],
  [
    "the corruption IDE exits with only the deliberate source Save and external journal repair",
    (s) => s.assertFinal(),
  ],
];
for (const [text, action, timeout = 20_000] of actions)
  When<StoryWorld>(text, { timeout }, async function () {
    await action(session(this));
  });
for (const [text, action, timeout = 20_000] of assertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await action(session(this));
  });
After<StoryWorld>(
  {
    tags: "@REQ-IDE-EDITOR-RECOVERY-001 and @native-recovery-capacity-corruption",
    timeout: 20_000,
  },
  async function () {
    const value = sessions.get(this);
    sessions.delete(this);
    await value?.dispose();
  },
);
