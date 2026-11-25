import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import {
  NativeEditorCheckpointJournal,
  type NativeJournalEntry,
} from "./native-editor-checkpoint-journal.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export type NativeHistoryMode = "history" | "missing" | "storage-failure" | "retention";
const FILE = "history-proof.txt",
  OTHER = "companion.txt";
const DISK = "History source on disk",
  FIRST = "First checkpoint caf\u00e9",
  SECOND = "Second retained checkpoint",
  CURRENT = "Current dirty history buffer";
const OTHER_DISK = "History companion source",
  OTHER_DRAFT = "Companion history edits";
const STORAGE_ERROR =
  "Recovery storage is unavailable or full. The newest edits may not have a durable checkpoint; retry after checking storage.";
const MISSING_ERROR =
  "The source file cannot be opened. The checkpoint is retained for copying; automatic file recreation is not supported.";

/** Checkpoints are produced by keyboard editing and the production controller. */
export class NativeEditorHistorySession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #launches: NativeDesktopApplication[] = [];
  #firstId = "";
  #secondId = "";
  #disk = DISK;
  #retentionProof: Record<string, boolean | number> = {};
  #sourceMissing = false;
  #blockedPath?: string;
  #retainedBytes?: Buffer;
  #proof = {
    requirement: "REQ-IDE-EDITOR-RECOVERY-001",
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    firstCheckpointAcknowledged: false,
    historyVersionsSelectedExactly: false,
    currentDraftRemovalDisabled: false,
    restoreKeptUnrelatedDirtyBuffer: false,
    restoreRetainedCheckpoint: false,
    removalCancelledWithoutMutation: false,
    removalDeletedOnlySelectedEntry: false,
    missingSourceNotRecreated: false,
    missingRestoreDisabled: false,
    checkpointCopiedThroughNativeClipboard: false,
    storageFailureVisible: false,
    sourceSavedDespiteStorageFailure: false,
    retainedJournalBytesPreserved: false,
    retryRecoveredStorage: false,
  };
  constructor(readonly mode: NativeHistoryMode) {}

  async prepare(): Promise<void> {
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-EDITOR-RECOVERY-001");
    await writeFile(this.source(FILE), DISK, { flag: "wx" });
    await writeFile(this.source(OTHER), OTHER_DISK, { flag: "wx" });
  }
  async launch(): Promise<void> {
    this.#app = new NativeDesktopApplication();
    this.#launches.push(this.#app);
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
    await this.app().waitForFileExplorer();
    await this.surface().open(
      this.#sourceMissing ? OTHER : FILE,
      this.#sourceMissing ? OTHER_DISK : DISK,
    );
  }
  async createFirstCheckpoint(): Promise<void> {
    await this.surface().replace(FILE, FIRST);
    await this.openPanel();
    await this.button("Checkpoint now").click();
    const entry = await this.awaitEntry(FIRST, "draft");
    this.#firstId = entry.id;
    this.#proof.firstCheckpointAcknowledged = true;
    await this.closePanel();
    await this.assertSources();
  }
  async createRetentionCompanion(): Promise<void> {
    assert.equal(this.mode, "retention");
    await this.surface().open(OTHER, OTHER_DISK);
    await this.surface().replace(OTHER, OTHER_DRAFT);
    await this.openPanel();
    await this.button("Checkpoint now").click();
    await this.awaitEntry(OTHER_DRAFT, "draft", OTHER);
    for (let version = 1; version <= 2; version += 1)
      await this.appendRetentionCheckpoint(OTHER, OTHER_DRAFT + ".".repeat(version));
    await this.closePanel();
    await this.surface().open(FILE, FIRST);
    await this.openPanel();
  }
  async rotateHistory(): Promise<void> {
    assert.equal(this.mode, "retention");
    for (let version = 1; version <= 102; version += 1) {
      await this.appendRetentionCheckpoint(FILE, FIRST + ".".repeat(version));
      this.#retentionProof.sourceVersionsAcknowledged = version;
    }
  }
  private async appendRetentionCheckpoint(file: string, content: string): Promise<void> {
    await this.surface().focus(file);
    await this.browser().keys(["Control", "End"]);
    await this.browser().keys(".");
    await this.surface().assertBuffer(file, content);
    await this.button("Checkpoint now").scrollIntoView();
    await this.button("Checkpoint now").click();
    await this.awaitEntry(content, "draft", file);
  }
  async assertRetentionInventory(): Promise<void> {
    const entries = await this.journal().entries();
    const histories = entries.filter((entry) => entry.kind === "history");
    assert.equal(histories.length, 100);
    assert.deepEqual(
      histories.map((entry) => `${entry.filePath}:${entry.content}`).sort(),
      Array.from({ length: 100 }, (_, index) => `${FILE}:${FIRST + ".".repeat(index + 2)}`).sort(),
    );
    assert.deepEqual(
      entries
        .filter((entry) => entry.kind === "draft")
        .map((entry) => `${entry.filePath}:${entry.content}`)
        .sort(),
      [`${FILE}:${FIRST + ".".repeat(102)}`, `${OTHER}:${OTHER_DRAFT}..`].sort(),
    );
    assert.equal(
      entries.some((entry) => entry.id === this.#firstId),
      false,
    );
    // Compare the production inventory with the durable journal, not just a count label.
    await this.button("Refresh checkpoints").click();
    await this.browser().waitUntil(
      async () => {
        const ids = await this.panel().$$("li[data-checkpoint-id]").getElements();
        return ids.length === 101;
      },
      { timeout: 10_000 },
    );
    for (const entry of entries.filter((entry) => entry.filePath === FILE)) {
      const row = this.panel().$(`li[data-checkpoint-id="${entry.id}"]`);
      assert.equal(await row.isExisting(), true);
      assert.equal(await row.$("button=Remove checkpoint").isEnabled(), entry.kind !== "draft");
    }
    this.#retentionProof.exactNewestHundredHistoriesRetained = true;
    this.#retentionProof.otherFileHistoriesEvictedBeforeNewerSourceHistory = true;
    this.#retentionProof.bothCurrentDraftsRetained = true;
    this.#retentionProof.inventoryMatchesDurableEntries = true;
    await this.assertRetentionBuffers(FIRST + ".".repeat(102));
  }
  async reviewRetainedVersions(): Promise<void> {
    for (const version of [2, 101]) {
      const content = FIRST + ".".repeat(version);
      const entry = (await this.journal().entries()).find((e) => e.content === content);
      assert.ok(entry);
      await this.panel().$(`li[data-checkpoint-id="${entry.id}"]`).scrollIntoView();
      await this.review(content, "Local history", FIRST + ".".repeat(102));
      await this.button("Keep editor buffer").click();
      await this.dialog().waitForExist({ reverse: true, timeout: 5_000 });
    }
    this.#retentionProof.oldestAndNewestRetainedVersionsReviewedExactly = true;
    await this.assertRetentionBuffers(FIRST + ".".repeat(102));
  }
  async restoreLatestRetainedVersion(): Promise<void> {
    const content = FIRST + ".".repeat(101);
    const entry = (await this.journal().entries()).find((e) => e.content === content);
    assert.ok(entry);
    await this.panel().$(`li[data-checkpoint-id="${entry.id}"]`).scrollIntoView();
    await this.review(content, "Local history", FIRST + ".".repeat(102));
    await this.button("Replace reviewed buffer with recovered version").click();
    await this.dialog().waitForExist({ reverse: true, timeout: 10_000 });
    await this.awaitEntry(content, "draft");
    await this.assertRetentionBuffers(content);
    this.#retentionProof.restoreAfterRotationPreservedCompanionAndSources = true;
  }
  async assertRetentionRestored(): Promise<void> {
    assert.equal(this.#retentionProof.restoreAfterRotationPreservedCompanionAndSources, true);
    await this.assertRetentionBuffers(FIRST + ".".repeat(101));
  }
  private async assertRetentionBuffers(content: string): Promise<void> {
    await this.closePanel();
    await this.surface().assertBuffer(FILE, content);
    await this.surface().assertDirty(FILE, true);
    await this.surface().open(OTHER, OTHER_DRAFT + "..");
    await this.surface().assertDirty(OTHER, true);
    await this.surface().open(FILE, content);
    await this.openPanel();
    await this.assertSources();
  }
  async createHistory(): Promise<void> {
    await this.surface().replace(FILE, SECOND);
    await this.openPanel();
    await this.button("Checkpoint now").click();
    this.#secondId = (await this.awaitEntry(SECOND, "draft")).id;
    assert.equal(
      (await this.journal().entries()).find((e) => e.id === this.#firstId)?.kind,
      "history",
    );
    await this.closePanel();
    await this.surface().replace(FILE, CURRENT);
    await this.surface().open(OTHER, OTHER_DISK);
    await this.surface().replace(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, CURRENT);
    await this.openPanel();
    await this.button("Checkpoint now").click();
    await this.awaitEntry(CURRENT, "draft");
    const currentRow = await this.row(CURRENT, "Current draft");
    assert.equal(await currentRow.$("button=Remove checkpoint").isEnabled(), false);
    this.#proof.currentDraftRemovalDisabled = true;
    await this.assertSources();
  }
  async reviewBothHistoryVersions(): Promise<void> {
    for (const text of [FIRST, SECOND]) {
      await this.review(text, "Local history", CURRENT);
      await this.button("Keep editor buffer").click();
      await this.dialog().waitForExist({ reverse: true, timeout: 5_000 });
      await this.assertBuffers(CURRENT, true);
    }
    this.#proof.historyVersionsSelectedExactly = true;
  }
  async restoreFirst(): Promise<void> {
    await this.review(FIRST, "Local history", CURRENT);
    await this.button("Replace reviewed buffer with recovered version").click();
    await this.dialog().waitForExist({ reverse: true, timeout: 10_000 });
    await this.assertBuffers(FIRST, true);
    await this.awaitEntry(FIRST, "draft");
    assert.equal(
      (await this.journal().entries()).find((e) => e.id === this.#firstId)?.content,
      FIRST,
    );
    this.#proof.restoreRetainedCheckpoint = true;
    this.#proof.restoreKeptUnrelatedDirtyBuffer = true;
    await this.assertSources();
  }
  async cancelRemoval(): Promise<void> {
    const before = await this.journal().bytes();
    const row = await this.row(SECOND, "Local history");
    await row.$("button=Remove checkpoint").click();
    await this.removal().waitForDisplayed({ timeout: 5_000 });
    assert.equal(
      (await this.journal().entries()).some((e) => e.id === this.#secondId),
      true,
    );
    await this.removal().$("button=Keep checkpoint").click();
    await this.removal().waitForExist({ reverse: true, timeout: 5_000 });
    assert.deepEqual(await this.journal().bytes(), before);
    await this.assertBuffers(FIRST, true);
    await this.assertSources();
    this.#proof.removalCancelledWithoutMutation = true;
  }
  async confirmRemoval(): Promise<void> {
    const idsBefore = (await this.journal().entries()).map((e) => e.id).sort();
    await (await this.row(SECOND, "Local history")).$("button=Remove checkpoint").click();
    await this.removal().waitForDisplayed({ timeout: 5_000 });
    await this.removal().$("button=Confirm permanent removal").click();
    await this.browser().waitUntil(
      async () => !(await this.journal().entries()).some((e) => e.id === this.#secondId),
      { timeout: 5_000, interval: 100 },
    );
    await this.button("Refresh checkpoints").click();
    await this.panel()
      .$(`li[data-checkpoint-id="${this.#secondId}"]`)
      .waitForExist({ reverse: true, timeout: 5_000 });
    assert.deepEqual(
      (await this.journal().entries()).map((e) => e.id).sort(),
      idsBefore.filter((id) => id !== this.#secondId),
    );
    await this.assertBuffers(FIRST, true);
    await this.assertSources();
    this.#proof.removalDeletedOnlySelectedEntry = true;
  }
  async discardAndClose(): Promise<void> {
    await this.closePanel();
    await this.surface().discardUsingDisk(FILE, DISK);
    await this.surface().open(OTHER, OTHER_DRAFT + (this.mode === "retention" ? ".." : ""));
    await this.surface().discardUsingDisk(OTHER, OTHER_DISK);
    await this.app().closeNativeWindow();
    await this.assertSources();
  }
  async terminateAndDeleteSource(): Promise<void> {
    assert.equal(this.#proof.firstCheckpointAcknowledged, true);
    await this.app().forceTerminate();
    await this.app().dispose();
    await unlink(this.source(FILE));
    this.#sourceMissing = true;
    await this.assertSources();
  }
  async reviewMissingSource(): Promise<void> {
    await this.openPanel();
    await this.review(
      FIRST,
      "Recoverable draft",
      "File unavailable; no buffer replacement is permitted.",
    );
    assert.equal(
      await this.button("Replace reviewed buffer with recovered version").isEnabled(),
      false,
    );
    await this.surface().assertAlert(MISSING_ERROR);
    await this.assertSources();
    assert.equal(
      (await this.journal().entries()).find((e) => e.id === this.#firstId)?.content,
      FIRST,
    );
    this.#proof.missingRestoreDisabled = true;
    this.#proof.missingSourceNotRecreated = true;
  }
  async copyMissingCheckpoint(): Promise<void> {
    // Measure the text only; selection and copying are native mouse/key actions.
    const points = await this.browser().execute(() => {
      const pre = document.querySelector('[role="dialog"] [aria-label="Recovery checkpoint"] pre');
      if (!pre) throw new Error("checkpoint preview unavailable");
      const range = document.createRange();
      range.selectNodeContents(pre);
      const text = range.getBoundingClientRect(),
        box = pre.getBoundingClientRect();
      return {
        start: { x: Math.floor(text.left), y: Math.floor(text.top + text.height / 2) },
        end: {
          x: Math.ceil(Math.min(text.right + 2, box.right - 2)),
          y: Math.floor(text.top + text.height / 2),
        },
      };
    });
    await this.browser()
      .action("pointer")
      .move({ ...points.start, origin: "viewport" })
      .down({ button: 0 })
      .move({ ...points.end, origin: "viewport", duration: 250 })
      .up({ button: 0 })
      .perform();
    assert.equal(await this.browser().execute(() => window.getSelection()?.toString()), FIRST);
    await this.browser().keys(["Control", "c"]);
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      [
        "-c",
        "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk, Gdk; value=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(); print(value if value is not None else '',end='')",
      ],
      { timeout: 3_000, maxBuffer: 4096, encoding: "utf8" },
    );
    assert.equal(stdout, FIRST);
    this.#proof.checkpointCopiedThroughNativeClipboard = true;
    await this.assertSources();
  }
  async cancelMissingAndClose(): Promise<void> {
    await this.button("Keep editor buffer").click();
    await this.dialog().waitForExist({ reverse: true, timeout: 5_000 });
    await this.closePanel();
    await this.app().closeNativeWindow();
    await this.assertSources();
  }
  async blockJournal(): Promise<void> {
    assert.equal(this.#proof.firstCheckpointAcknowledged, true);
    const file = await this.journal().path();
    this.#retainedBytes = await this.journal().bytes();
    await rename(file, `${file}.retained`);
    this.#blockedPath = file;
    await mkdir(file, { mode: 0o700 });
    await this.assertRetainedBytes();
  }
  async checkpointWhileBlocked(): Promise<void> {
    await this.surface().replace(FILE, SECOND);
    await this.openPanel();
    await this.button("Checkpoint now").click();
  }
  async assertStorageFailure(): Promise<void> {
    await this.surface().assertAlert(STORAGE_ERROR);
    await this.waitStatus("Recovery: error");
    await this.surface().assertBuffer(FILE, SECOND);
    await this.surface().assertDirty(FILE, true);
    await this.assertSources();
    await this.assertRetainedBytes();
    this.#proof.storageFailureVisible = true;
  }
  async saveWhileBlocked(): Promise<void> {
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    this.#disk = SECOND;
    await this.assertSources();
    await this.waitStatus("Recovery: error");
    await this.surface().assertAlert(STORAGE_ERROR);
    await this.assertRetainedBytes();
    this.#proof.sourceSavedDespiteStorageFailure = true;
  }
  async unblockAndRetry(): Promise<void> {
    assert.ok(this.#blockedPath);
    await rmdir(this.#blockedPath);
    await rename(`${this.#blockedPath}.retained`, this.#blockedPath);
    this.#blockedPath = undefined;
    await this.button("Refresh checkpoints").click();
    await this.button("Checkpoint now").click();
    await this.awaitEntry(FIRST, "history");
    await this.waitStatus("Recovery: ready");
    assert.equal(
      (await this.journal().entries()).find((e) => e.id === this.#firstId)?.content,
      FIRST,
    );
    assert.equal(await (await this.row(FIRST, "Local history")).isExisting(), true);
    const alerts = await this.panel().$$('[role="alert"]').getElements();
    assert.equal(alerts.length, 0);
    this.#proof.retryRecoveredStorage = true;
    await this.assertSources();
  }
  async closeAfterRetry(): Promise<void> {
    await this.closePanel();
    await this.app().closeNativeWindow();
    await this.assertSources();
  }
  async assertFirstAcknowledged(): Promise<void> {
    assert.equal(this.#proof.firstCheckpointAcknowledged, true);
    assert.equal(
      (await this.journal().entries()).find((entry) => entry.id === this.#firstId)?.content,
      FIRST,
    );
    await this.assertSources();
  }
  async assertHistoryInventory(): Promise<void> {
    assert.equal(this.#proof.currentDraftRemovalDisabled, true);
    await this.row(FIRST, "Local history");
    await this.row(SECOND, "Local history");
    await this.assertBuffers(CURRENT, true);
    await this.assertSources();
  }
  async assertHistoryCancelled(): Promise<void> {
    assert.equal(this.#proof.historyVersionsSelectedExactly, true);
    await this.assertBuffers(CURRENT, true);
    await this.assertSources();
  }
  async assertHistoryRestored(): Promise<void> {
    assert.equal(this.#proof.restoreRetainedCheckpoint, true);
    await this.assertBuffers(FIRST, true);
    await this.assertFirstAcknowledged();
  }
  async assertRemovalCancelled(): Promise<void> {
    assert.equal(this.#proof.removalCancelledWithoutMutation, true);
    assert.equal(
      (await this.journal().entries()).some((entry) => entry.id === this.#secondId),
      true,
    );
    await this.assertBuffers(FIRST, true);
    await this.assertSources();
  }
  async assertOnlySelectedRemoved(): Promise<void> {
    assert.equal(this.#proof.removalDeletedOnlySelectedEntry, true);
    assert.equal(
      (await this.journal().entries()).some((entry) => entry.id === this.#secondId),
      false,
    );
    await this.assertFirstAcknowledged();
    await this.assertBuffers(FIRST, true);
  }
  async assertMissingReview(): Promise<void> {
    assert.equal(this.#proof.missingRestoreDisabled, true);
    assert.equal(
      await this.button("Replace reviewed buffer with recovered version").isEnabled(),
      false,
    );
    await this.assertFirstAcknowledged();
  }
  async assertMissingCopy(): Promise<void> {
    assert.equal(this.#proof.checkpointCopiedThroughNativeClipboard, true);
    await this.assertFirstAcknowledged();
    await this.assertSources();
  }
  async assertSaveDuringFailure(): Promise<void> {
    assert.equal(this.#proof.sourceSavedDespiteStorageFailure, true);
    await this.surface().assertBuffer(FILE, SECOND);
    await this.surface().assertDirty(FILE, false);
    await this.assertRetainedBytes();
    await this.assertSources();
  }
  async assertRetried(): Promise<void> {
    assert.equal(this.#proof.retryRecoveredStorage, true);
    await this.waitStatus("Recovery: ready");
    await this.assertFirstAcknowledged();
    await this.assertSources();
  }
  async assertFinal(): Promise<void> {
    await this.app().assertExited();
    await this.assertSources();
    await this.#lease!.assertConfiguredPathsConfined();
  }
  evidence() {
    return {
      ...this.#proof,
      mode: this.mode,
      retention: this.#retentionProof,
      launches: this.#launches.map((app) => app.evidence()),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return this.#launches
      .map((app) =>
        app.redactedDiagnostics([DISK, FIRST, SECOND, CURRENT, OTHER_DISK, OTHER_DRAFT]),
      )
      .filter(Boolean)
      .join("\n");
  }
  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const app of this.#launches) {
      try {
        await app.dispose();
      } catch (error) {
        errors.push(error);
      }
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
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native history scenario cleanup failed");
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
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
  private dialog() {
    return this.browser().$('[role="dialog"]');
  }
  private removal() {
    return this.browser().$('[aria-label="Confirm checkpoint removal"]');
  }
  private button(name: string) {
    return this.browser().$(`button=${name}`);
  }
  private async openPanel() {
    await this.button("Recovery and history").click();
    await this.panel().waitForDisplayed({ timeout: 5_000 });
  }
  private async closePanel() {
    await this.button("Close recovery panel").click();
    await this.panel().waitForExist({ reverse: true, timeout: 5_000 });
  }
  private async waitStatus(status: string) {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) === status,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `native checkpoint status did not reach ${status}`,
      },
    );
  }
  private async awaitEntry(
    content: string,
    kind: "draft" | "history",
    file = FILE,
  ): Promise<NativeJournalEntry> {
    let found: NativeJournalEntry | undefined;
    await this.browser().waitUntil(
      async () => {
        if (
          (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) !==
          "Recovery: ready"
        )
          return false;
        try {
          found = (await this.journal().entries()).find(
            (e) => e.filePath === file && e.content === content && e.kind === kind,
          );
          return !!found;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "expected native checkpoint was not acknowledged",
      },
    );
    assert.ok(found);
    return found;
  }
  private async row(content: string, kind: string) {
    const entries = await this.journal().entries();
    const expectedKind = kind === "Local history" ? "history" : "draft";
    const knownId =
      content === FIRST && kind !== "Current draft"
        ? this.#firstId
        : content === SECOND
          ? this.#secondId
          : "";
    const matching = entries.filter(
      (entry) =>
        entry.filePath === FILE &&
        entry.content === content &&
        entry.kind === expectedKind &&
        (!knownId || entry.id === knownId),
    );
    assert.equal(matching.length, 1, "expected issued checkpoint identity is not unique");
    const row = this.panel().$(`li[data-checkpoint-id="${matching[0].id}"]`);
    await row.waitForDisplayed({ timeout: 10_000, interval: 100 });
    const text = await row.getText();
    assert.ok(
      text.includes(FILE) &&
        text.includes(kind) &&
        text.includes(`${Buffer.byteLength(content)} bytes`),
    );
    return row;
  }
  private async review(content: string, kind: string, before: string) {
    await (await this.row(content, kind)).$(`button=Review ${FILE}`).click();
    await this.dialog().waitForDisplayed({ timeout: 10_000 });
    assert.equal(await this.dialog().getComputedLabel(), "Review recovered buffer");
    assert.equal(
      await this.dialog().$('[aria-label="Current editor buffer"] pre').getText(),
      before,
    );
    assert.equal(
      await this.dialog().$('[aria-label="Recovery checkpoint"] pre').getText(),
      content,
    );
    await this.assertSources();
  }
  private async assertBuffers(content: string, dirty: boolean) {
    await this.surface().assertBuffer(FILE, content);
    await this.surface().assertDirty(FILE, dirty);
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().assertDirty(OTHER, true);
    await this.surface().open(FILE, content);
  }
  private async assertRetainedBytes() {
    assert.ok(this.#blockedPath && this.#retainedBytes);
    assert.ok((await lstat(this.#blockedPath)).isDirectory());
    assert.deepEqual(await readFile(`${this.#blockedPath}.retained`), this.#retainedBytes);
    this.#proof.retainedJournalBytesPreserved = true;
  }
  private async assertSources() {
    if (this.#sourceMissing) await assert.rejects(access(this.source(FILE)), { code: "ENOENT" });
    else assert.deepEqual(await readFile(this.source(FILE)), Buffer.from(this.#disk));
    assert.deepEqual(await readFile(this.source(OTHER)), Buffer.from(OTHER_DISK));
  }
}
