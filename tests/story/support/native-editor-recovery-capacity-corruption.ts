import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeEditorCheckpointJournal } from "./native-editor-checkpoint-journal.js";
import {
  NativeEditorLargeBuffer,
  NATIVE_RECOVERY_CAPACITY_SOURCE,
  NATIVE_RECOVERY_OVERSIZED_BUFFER,
} from "./native-editor-large-buffer.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export type RecoveryFaultMode = "capacity" | "corruption";
const FILE = "capacity-proof.txt",
  OTHER = "companion.txt";
const DISK = "Original corruption source",
  FIRST = "Acknowledged recovery café",
  NEXT = "Saved despite corrupt journal";
const OTHER_DISK = "Original fault companion",
  OTHER_DRAFT = "Other fault edits";
const CHECKPOINT_ERROR =
  "Recovery storage is unavailable or full. The newest edits may not have a durable checkpoint; retry after checking storage.";
const INVENTORY_ERROR =
  "Recovery entries could not be loaded. Existing checkpoints were not discarded.";

/** Native GUI acceptance; valid journals are always issued by production editing/checkpoint commands. */
export class NativeEditorRecoveryFaultSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #launches: NativeDesktopApplication[] = [];
  #sourceDisk: string;
  #firstId = "";
  #validBytes?: Buffer;
  #corruptBytes?: Buffer;
  #corruptPath?: string;
  #corruptCopies: string[] = [];
  #proof: Record<string, boolean | string | number> = {};
  constructor(readonly mode: RecoveryFaultMode) {
    this.#sourceDisk = mode === "capacity" ? NATIVE_RECOVERY_CAPACITY_SOURCE : DISK;
  }
  async prepare() {
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-EDITOR-RECOVERY-001");
    await writeFile(this.source(FILE), this.#sourceDisk, { flag: "wx" });
    await writeFile(this.source(OTHER), OTHER_DISK, { flag: "wx" });
  }
  private async launch() {
    this.#app = new NativeDesktopApplication();
    this.#launches.push(this.#app);
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
    await this.app().waitForFileExplorer();
    if (this.mode === "capacity") await this.large().open(FILE, NATIVE_RECOVERY_CAPACITY_SOURCE);
    else await this.surface().open(FILE, this.#sourceDisk);
  }
  async acknowledge() {
    await this.launch();
    if (this.mode === "capacity") {
      await this.large().replace(FILE, FIRST);
      await this.large().open(OTHER, OTHER_DISK);
      await this.large().replace(OTHER, OTHER_DRAFT);
      await this.large().open(FILE, FIRST);
    } else {
      await this.surface().replace(FILE, FIRST);
    }
    await this.openPanel();
    await this.button("Checkpoint now").click();
    await this.awaitEntry(FILE, FIRST, "draft");
    const first = (await this.journal().entries()).find(
      (e) => e.filePath === FILE && e.content === FIRST && e.kind === "draft",
    );
    assert.ok(first);
    this.#firstId = first.id;
    if (this.mode === "capacity") await this.awaitEntry(OTHER, OTHER_DRAFT, "draft");
    this.#validBytes = await this.journal().bytes();
    await this.closePanel();
    await this.assertSources();
    this.#proof.originalCheckpointIssued = true;
  }
  async assertAcknowledged() {
    assert.equal(this.#proof.originalCheckpointIssued, true);
    assert.equal(
      (await this.journal().entries()).find((e) => e.id === this.#firstId)?.content,
      FIRST,
    );
    await this.assertSources();
  }
  async undoAndExceed() {
    assert.equal(this.mode, "capacity");
    await this.surface().focus(FILE);
    let restored = false;
    let undoRequests = 0;
    // Monaco groups typing around word boundaries. Undo those real groups;
    // observe only the visible prefix here, then prove the full result via native copy.
    for (; undoRequests < 8; undoRequests += 1) {
      await this.browser().keys(["Control", "z"]);
      restored = await this.browser().execute(() =>
        (document.querySelector(".monaco-editor .view-lines .view-line")?.textContent ?? "")
          .slice(0, 64)
          .startsWith("é".repeat(32)),
      );
      if (restored) break;
    }
    assert.ok(restored, "bounded native Undo did not restore the original source prefix");
    this.#proof.nativeUndoRequests = undoRequests + 1;
    await this.browser().keys(["Control", "End"]);
    await this.browser().keys("!");
    await this.large().assertCopied(FILE, NATIVE_RECOVERY_OVERSIZED_BUFFER);
    await this.surface().assertDirty(FILE, true);
    await this.surface().assertDirty(OTHER, true);
    await this.assertSources();
    this.#proof.oversizedUtf8Bytes = Buffer.byteLength(NATIVE_RECOVERY_OVERSIZED_BUFFER);
    this.#proof.oversizedCharacterCount = NATIVE_RECOVERY_OVERSIZED_BUFFER.length;
    this.#proof.largeBufferVerifiedThroughNativeCopy = true;
    // Any legitimate intermediate typing checkpoint precedes this comparison.
    // The issued original entry must survive; no oversized draft may be admitted.
    assert.equal(
      (await this.journal().entries()).find((e) => e.id === this.#firstId)?.content,
      FIRST,
    );
    this.#validBytes = await this.journal().bytes();
  }
  async checkpoint() {
    await this.openPanel();
    await this.button("Checkpoint now").click();
  }
  async assertCapacityFailure() {
    await this.waitStatus("error");
    await this.surface().assertAlert(CHECKPOINT_ERROR);
    await this.large().assertCopied(FILE, NATIVE_RECOVERY_OVERSIZED_BUFFER);
    await this.surface().assertDirty(FILE, true);
    await this.surface().assertDirty(OTHER, true);
    await this.large().open(OTHER, OTHER_DRAFT);
    await this.large().open(FILE, NATIVE_RECOVERY_OVERSIZED_BUFFER);
    assert.ok(this.#validBytes);
    assert.deepEqual(await this.journal().bytes(), this.#validBytes);
    await this.assertSources();
    this.#proof.failedAdmissionPreservedJournalAndDrafts = true;
  }
  async refreshOversized() {
    await this.button("Refresh checkpoints").click();
  }
  async assertCapacityRefresh() {
    // Wait beyond an ordinary checkpoint interval: a successful inventory read is not a durable write.
    await this.browser().pause(900);
    await this.assertCapacityFailure();
    assert.equal(
      await this.panel().$(`li[data-checkpoint-id="${this.#firstId}"]`).isExisting(),
      true,
    );
    this.#proof.refreshDidNotHideWriteFailure = true;
  }
  async saveCapacity() {
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    this.#sourceDisk = NATIVE_RECOVERY_OVERSIZED_BUFFER;
  }
  async assertCapacitySave() {
    await this.assertSources();
    await this.large().assertCopied(FILE, NATIVE_RECOVERY_OVERSIZED_BUFFER);
    await this.surface().assertDirty(FILE, false);
    await this.surface().assertDirty(OTHER, true);
    this.#proof.explicitSourceSaveSucceeded = true;
  }
  async assertCapacityRetry() {
    await this.awaitEntry(FILE, FIRST, "history");
    await this.awaitEntry(OTHER, OTHER_DRAFT, "draft");
    const entries = await this.journal().entries();
    assert.equal(entries.find((e) => e.id === this.#firstId)?.content, FIRST);
    assert.equal(
      entries.some((e) => e.filePath === FILE && e.content === NATIVE_RECOVERY_OVERSIZED_BUFFER),
      false,
    );
    assert.equal(
      await this.panel().$(`li[data-checkpoint-id="${this.#firstId}"]`).isExisting(),
      true,
    );
    this.#proof.retryKeptEarlierHistory = true;
    await this.assertSources();
  }
  async terminateAndCorrupt() {
    assert.equal(this.mode, "corruption");
    await this.app().forceTerminate();
    await this.app().dispose();
    await this.truncateJournal();
    await this.assertSources();
  }
  private async truncateJournal() {
    assert.ok(this.#validBytes);
    const file = await this.journal().path();
    assert.deepEqual(await this.journal().bytes(), this.#validBytes);
    await rename(file, `${file}.retained`);
    this.#corruptBytes = this.#validBytes.subarray(0, Math.floor(this.#validBytes.length / 2));
    assert.throws(() => JSON.parse(this.#corruptBytes!.toString("utf8")));
    await writeFile(file, this.#corruptBytes, { flag: "wx", mode: 0o600 });
    this.#corruptPath = file;
    await this.assertCorruptionRetained();
  }
  async relaunchCorrupt() {
    await this.launch();
    await this.openPanel();
  }
  async assertCorruptStartup() {
    await this.waitStatus("error");
    await this.surface().assertAlert(INVENTORY_ERROR);
    await this.surface().assertBuffer(FILE, DISK);
    await this.surface().assertDirty(FILE, false);
    assert.equal(
      await this.panel().$(`li[data-checkpoint-id="${this.#firstId}"]`).isExisting(),
      false,
    );
    await this.assertCorruptionRetained();
    await this.assertSources();
    this.#proof.restartDidNotResetCorruptStorageOrRestore = true;
  }
  private async repairJournal() {
    assert.ok(this.#corruptPath);
    await this.assertCorruptionRetained();
    const copy = `${this.#corruptPath}.corrupt-${this.#corruptCopies.length + 1}`;
    await rename(this.#corruptPath, copy);
    this.#corruptCopies.push(copy);
    await rename(`${this.#corruptPath}.retained`, this.#corruptPath);
    this.#corruptPath = undefined;
    assert.deepEqual(await this.journal().bytes(), this.#validBytes);
  }
  async repairAndRetry() {
    await this.repairJournal();
    await this.button("Checkpoint now").click();
  }
  async assertNoopRetry() {
    await this.waitStatus("ready");
    await this.panel()
      .$(`li[data-checkpoint-id="${this.#firstId}"]`)
      .waitForExist({ timeout: 5_000 });
    const entry = (await this.journal().entries()).find((e) => e.id === this.#firstId);
    assert.equal(entry?.content, FIRST);
    assert.equal(entry?.kind, "draft");
    assert.deepEqual(await this.journal().bytes(), this.#validBytes);
    await this.surface().assertBuffer(FILE, DISK);
    await this.surface().assertDirty(FILE, false);
    assert.equal((await this.panel().$$('[role="alert"]').getElements()).length, 0);
    await this.assertSources();
    this.#proof.noopRetryRevalidatedWithoutJournalOrSourceWrite = true;
  }
  async corruptAgainAndEdit() {
    await this.truncateJournal();
    await this.closePanel();
    await this.surface().replace(FILE, NEXT);
    await this.surface().open(OTHER, OTHER_DISK);
    await this.surface().replace(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, NEXT);
  }
  async assertCorruptCheckpointFailure() {
    await this.waitStatus("error");
    await this.surface().assertAlert(CHECKPOINT_ERROR);
    await this.assertCorruptDrafts();
    await this.assertCorruptionRetained();
    await this.assertSources();
    this.#proof.corruptCheckpointPreservedDraftsAndBytes = true;
  }
  async saveCorruptSource() {
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    this.#sourceDisk = NEXT;
    await this.button("Checkpoint now").click();
  }
  async assertCorruptSave() {
    await this.waitStatus("error");
    await this.surface().assertAlert(CHECKPOINT_ERROR);
    await this.surface().assertBuffer(FILE, NEXT);
    await this.surface().assertDirty(FILE, false);
    await this.surface().assertDirty(OTHER, true);
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, NEXT);
    await this.assertSources();
    await this.assertCorruptionRetained();
    this.#proof.sourceSaveDidNotResetCorruptJournal = true;
  }
  async assertCorruptRetryAndReview() {
    await this.awaitEntry(OTHER, OTHER_DRAFT, "draft");
    await this.waitStatus("ready");
    const original = (await this.journal().entries()).find((e) => e.id === this.#firstId);
    assert.equal(original?.content, FIRST);
    assert.equal(original?.kind, "draft");
    const row = this.panel().$(`li[data-checkpoint-id="${this.#firstId}"]`);
    await row.waitForExist({ timeout: 5_000 });
    assert.ok((await row.getText()).includes("Recoverable draft"));
    await row.$(`button=Review ${FILE}`).click();
    const dialog = this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await dialog.getComputedLabel(), "Review recovered buffer");
    assert.equal(await dialog.$('[aria-label="Current editor buffer"] pre').getText(), NEXT);
    assert.equal(await dialog.$('[aria-label="Recovery checkpoint"] pre').getText(), FIRST);
    await this.button("Keep editor buffer").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(FILE, NEXT);
    await this.surface().assertDirty(FILE, false);
    await this.assertSources();
    this.#proof.repairedJournalKeptIssuedDraftAndReviewCancelled = true;
  }
  async discardCompanionAndClose() {
    await this.closePanel();
    if (this.mode === "capacity") {
      await this.large().open(OTHER, OTHER_DRAFT);
      await this.button("Compare with disk").click();
      const dialog = this.browser().$('[role="dialog"]');
      await dialog.waitForDisplayed({ timeout: 5_000 });
      assert.equal(
        await dialog.$('[aria-label="Inspected disk version"] pre').getText(),
        OTHER_DISK,
      );
      await this.button("Discard buffer edits and use disk version").click();
      await dialog.waitForExist({ reverse: true, timeout: 10_000 });
      await this.large().assertCopied(OTHER, OTHER_DISK);
      await this.surface().assertDirty(OTHER, false);
    } else {
      await this.surface().open(OTHER, OTHER_DRAFT);
      await this.surface().discardUsingDisk(OTHER, OTHER_DISK);
    }
    await this.app().closeNativeWindow();
  }
  async assertFinal() {
    await this.app().assertExited();
    await this.assertSources();
    await this.#lease!.assertConfiguredPathsConfined();
    for (const copy of this.#corruptCopies)
      assert.deepEqual(await readFile(copy), this.#corruptBytes);
    this.#proof.cleanNativeCloseAndConfinedStorage = true;
  }
  async dispose() {
    const errors: unknown[] = [];
    for (const app of [...this.#launches].reverse())
      try {
        await app.dispose();
      } catch (error) {
        errors.push(error);
      }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#lease)
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, `editor-recovery-${this.mode}-evidence.json`),
          JSON.stringify(
            {
              requirement: "REQ-IDE-EDITOR-RECOVERY-001",
              nativeGui: true,
              e2e: true,
              packagedApplication: false,
              artifactKind: "release-no-bundle",
              mode: this.mode,
              ...this.#proof,
              launches: this.#launches.map((app) => app.evidence()),
              scenarioEnvironment: this.#lease.evidence(),
            },
            null,
            2,
          ),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native recovery fault cleanup failed");
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private large() {
    return new NativeEditorLargeBuffer(this.app());
  }
  private browser() {
    return this.app().browser();
  }
  private source(file: string) {
    assert.ok(this.#lease && [FILE, OTHER].includes(file));
    return path.join(this.#lease.paths.workspace, file);
  }
  private journal() {
    assert.ok(this.#lease);
    return new NativeEditorCheckpointJournal(this.#lease);
  }
  private panel() {
    return this.browser().$('[aria-label="Recovery and local history"]');
  }
  private button(label: string) {
    return this.browser().$(`button=${label}`);
  }
  private async openPanel() {
    if (!(await this.panel().isExisting())) await this.button("Recovery and history").click();
    await this.panel().waitForDisplayed({ timeout: 5_000 });
  }
  private async closePanel() {
    if (await this.panel().isExisting()) await this.button("Close recovery panel").click();
  }
  private async waitStatus(status: string) {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) ===
        `Recovery: ${status}`,
      {
        timeout: 6_000,
        interval: 100,
        timeoutMsg: `recovery fault fixture did not reach ${status}`,
      },
    );
  }
  private async awaitEntry(file: string, content: string, kind: string) {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) ===
          "Recovery: ready" &&
        (await this.journal().entries()).some(
          (e) => e.filePath === file && e.content === content && e.kind === kind,
        ),
      {
        timeout: 6_000,
        interval: 100,
        timeoutMsg: "the real journal did not acknowledge the expected bounded recovery entry",
      },
    );
  }
  private async assertSources() {
    const actual = await readFile(this.source(FILE));
    assert.ok(
      actual.equals(Buffer.from(this.#sourceDisk)),
      `source bytes differ: ${actual.length} observed bytes`,
    );
    assert.deepEqual(await readFile(this.source(OTHER)), Buffer.from(OTHER_DISK));
  }
  private async assertCorruptionRetained() {
    assert.ok(this.#corruptPath && this.#validBytes && this.#corruptBytes);
    assert.deepEqual(await this.journal().bytes(), this.#corruptBytes);
    assert.deepEqual(await readFile(`${this.#corruptPath}.retained`), this.#validBytes);
  }
  private async assertCorruptDrafts() {
    await this.surface().assertBuffer(FILE, NEXT);
    await this.surface().assertDirty(FILE, true);
    await this.surface().assertDirty(OTHER, true);
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, NEXT);
  }
}
