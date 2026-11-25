import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeEditorExternalChangesSession } from "../support/native-editor-external-changes.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeEditorExternalChangesSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native external-change fixture not prepared");
  return value;
}
Given<StoryWorld>(
  "the external-change GUI has two isolated deterministic source files",
  async function () {
    if (
      this.targetProfile.name !== "desktop" ||
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    ) {
      throw new Error(
        "external-change acceptance requires real release/no-bundle native GUI evidence",
      );
    }
    if (sessions.has(this)) throw new Error("native external-change fixture already prepared");
    const value = new NativeEditorExternalChangesSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
type Step = readonly [
  string,
  (value: NativeEditorExternalChangesSession) => Promise<void>,
  number?,
];
const actions: Step[] = [
  ["the external-change IDE opens and the person edits both buffers", (s) => s.launch(), 40_000],
  [
    "an external writer changes the inactive open source without changing its byte length",
    (s) => s.externalWrite(),
  ],
  ["the person reviews and cancels the warned disk version", (s) => s.compareAndCancel()],
  ["the person requests Save without adopting that version", (s) => s.saveConflicting()],
  ["the person explicitly adopts the warned disk version", (s) => s.adopt()],
  ["the person edits the adopted buffer and explicitly saves it", (s) => s.editAndSave()],
  ["an external writer deletes the active monitored source", (s) => s.delete()],
  [
    "the person edits and requests Save for the missing monitored source",
    (s) => s.editAndSaveMissing(),
  ],
  [
    "an external writer deliberately recreates the source and the person explicitly discards both drafts and closes through X11",
    (s) => s.recreateDiscardAndClose(),
  ],
];
const assertions: Step[] = [
  [
    "an automatic disk-change warning appears without replacing either draft or writing a source",
    (s) => s.assertPassiveWrite(),
  ],
  ["Save refuses and the warning has not advanced the save baseline", (s) => s.assertConflict()],
  [
    "only that buffer becomes clean and its external-change warning clears",
    (s) => s.assertAdopted(),
  ],
  [
    "the saved bytes match the new edits without a false external-change warning",
    (s) => s.assertOwnSave(),
  ],
  [
    "an automatic missing-file warning appears without recreating it or changing the buffer",
    (s) => s.assertMissing(),
  ],
  [
    "the missing-source Save refuses and both drafts remain intact",
    (s) => s.assertMissingConflict(),
  ],
  [
    "the monitored IDE exits with only the explicit save and deliberate fixture writes on disk",
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
  { tags: "@REQ-IDE-EDITOR-EXTERNAL-CHANGES-001", timeout: 20_000 },
  async function () {
    const value = sessions.get(this);
    sessions.delete(this);
    await value?.dispose();
  },
);
