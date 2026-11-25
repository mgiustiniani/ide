import assert from "node:assert/strict";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeEditorCheckpointJournal } from "./native-editor-checkpoint-journal.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const DISK_COMPARISON_REQUIREMENT = "REQ-IDE-EDITOR-DISK-COMPARISON-001";
const FILE = "disk-proof.txt",
  OTHER = "companion.txt";
const ORIGINAL = "Original disk source",
  DRAFT = "Draft disk caf\u00e9";
const OTHER_DISK = "Original disk companion",
  OTHER_DRAFT = "Other dirty buffer";
const BEFORE_ADOPTION = "Draft before adoption",
  INSPECTED = "External inspected caf\u00e9",
  LATER = "Later external disk writer",
  FINAL = "New edits after adoption";
const ASYNC_DRAFT = "Draft pending asynchronous recovery checkpoint",
  ASYNC_EXTERNAL = "External write during adoption checkpoint",
  ASYNC_EDIT = "Buffer edit after asynchronous adoption",
  ASYNC_SAVED = "Saved after adopting the latest asynchronous revision";
const SAVE_ERROR =
  "The file could not be saved. Check available disk space and write permissions, or compare with disk if another tool changed it.";
const READ_ERROR =
  "Could not compare this buffer with disk. Finish saving, check file access and retry; this provider may not support revision-aware comparison.";

export class NativeEditorDiskComparisonSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #releaseJournalLock?: () => Promise<void>;
  #disk = ORIGINAL;
  #deleted = false;
  #proof = {
    requirement: DISK_COMPARISON_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    cancelledWithoutMutation: false,
    staleAfterSaveRefused: false,
    cancelDidNotAdvanceBaseline: false,
    inspectedSnapshotExplicitlyAdopted: false,
    laterExternalSaveRefused: false,
    freshAdoptionAllowsSave: false,
    asyncRecoveryCheckpointObserved: false,
    externalWriteDuringAdoption: false,
    asyncAdoptionPreservedNewerDisk: false,
    asyncAdoptionSaveRefused: false,
    freshAsyncRevisionAllowsSave: false,
    deletedReadVisible: false,
    deletedSaveRefusedWithoutRecreation: false,
    draftsCheckpointedBeforeTermination: false,
  };

  private async waitForComparisonClosed(timeout: number): Promise<void> {
    await this.browser().waitUntil(async () => {
      try {
        return !(await this.dialog().isExisting());
      } catch (error) {
        // React can remove the dialog between lookup and handle creation.
        // A stale handle does not establish absence: query again on the next poll.
        if (error instanceof Error && (error.name === "stale element reference" ||
            error.message.startsWith("stale element reference:"))) return false;
        throw error;
      }
    }, { timeout, interval: 100, timeoutMsg: "Disk comparison dialog did not close" });
  }

  async prepare(): Promise<void> {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(DISK_COMPARISON_REQUIREMENT);
    await writeFile(this.source(FILE), ORIGINAL, { flag: "wx" });
    await writeFile(this.source(OTHER), OTHER_DISK, { flag: "wx" });
  }
  async launch(): Promise<void> {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
    await this.app().waitForFileExplorer();
    await this.surface().open(FILE, ORIGINAL);
    await this.surface().replace(FILE, DRAFT);
    await this.surface().open(OTHER, OTHER_DISK);
    await this.surface().replace(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, DRAFT);
    await this.assertSources();
  }
  async inspectOriginal(): Promise<void> {
    await this.inspect(DRAFT, ORIGINAL);
  }
  async cancelOriginal(): Promise<void> {
    await this.browser().keys("Escape");
    await this.waitForComparisonClosed(5_000);
    await this.assertBuffers(DRAFT, true);
    await this.assertSources();
    this.#proof.cancelledWithoutMutation = true;
  }
  async saveDuringReview(): Promise<void> {
    assert.equal(await this.dialog().isDisplayed(), true);
    await this.browser().keys(["Control", "s"]);
    await this.surface().assertDirty(FILE, false);
    this.#disk = DRAFT;
    await this.assertSources();
    assert.equal(await this.dialog().isDisplayed(), true);
  }
  async refuseStaleReview(): Promise<void> {
    await this.button("Discard buffer edits and use disk version").click();
    await this.surface().assertAlert(
      "The buffer or its save baseline changed. Compare again; no edits were discarded.",
    );
    await this.assertBuffers(DRAFT, false);
    await this.assertSources();
    assert.equal(await this.dialog().isDisplayed(), true);
    await this.button("Keep editor buffer").click();
    await this.waitForComparisonClosed(5_000);
    this.#proof.staleAfterSaveRefused = true;
  }
  async externalAndCancel(): Promise<void> {
    await this.surface().replace(FILE, BEFORE_ADOPTION);
    await writeFile(this.source(FILE), INSPECTED);
    this.#disk = INSPECTED;
    await this.inspect(BEFORE_ADOPTION, INSPECTED);
    await this.button("Keep editor buffer").click();
    await this.waitForComparisonClosed(5_000);
    await this.assertBuffers(BEFORE_ADOPTION, true);
    await this.assertSources();
  }
  async refuseSaveAfterCancel(): Promise<void> {
    await this.surface().save(FILE);
    await this.surface().assertAlert(SAVE_ERROR);
    await this.assertBuffers(BEFORE_ADOPTION, true);
    await this.assertSources();
    this.#proof.cancelDidNotAdvanceBaseline = true;
  }
  async reviewExternal(): Promise<void> {
    await this.inspect(BEFORE_ADOPTION, INSPECTED);
  }
  async writeLaterExternal(): Promise<void> {
    await writeFile(this.source(FILE), LATER);
    this.#disk = LATER;
    await this.assertSources();
  }
  async adoptInspected(): Promise<void> {
    await this.button("Discard buffer edits and use disk version").click();
    await this.waitForComparisonClosed(10_000);
    await this.assertBuffers(INSPECTED, false);
    await this.assertSources();
    this.#proof.inspectedSnapshotExplicitlyAdopted = true;
  }
  async refuseSaveAfterAdoption(): Promise<void> {
    await this.surface().replace(FILE, FINAL);
    await this.surface().save(FILE);
    await this.surface().assertAlert(SAVE_ERROR);
    await this.assertBuffers(FINAL, true);
    await this.assertSources();
    this.#proof.laterExternalSaveRefused = true;
  }
  async freshAdoptionAndSave(): Promise<void> {
    await this.inspect(FINAL, LATER);
    await this.button("Discard buffer edits and use disk version").click();
    await this.waitForComparisonClosed(10_000);
    await this.surface().assertBuffer(FILE, LATER);
    await this.surface().assertDirty(FILE, false);
    await this.surface().replace(FILE, FINAL);
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    this.#disk = FINAL;
    await this.assertSources();
    await this.assertBuffers(FINAL, false);
    this.#proof.freshAdoptionAllowsSave = true;
  }
  async inspectPendingDraft(): Promise<void> {
    await this.waitForRecoveryReady();
    this.#releaseJournalLock = await this.journal().holdLock();
    await this.surface().replace(FILE, ASYNC_DRAFT);
    await this.inspect(ASYNC_DRAFT, ORIGINAL);
    assert.equal(await this.recoveryStatus(), "Recovery: pending");
  }
  async startAsyncAdoption(): Promise<void> {
    assert.equal(await this.recoveryStatus(), "Recovery: pending");
    await this.button("Discard buffer edits and use disk version").click();
    await this.browser().waitUntil(
      async () => (await this.recoveryStatus()) === "Recovery: saving",
      {
        timeout: 5_000,
        interval: 10,
        timeoutMsg: "disk adoption did not wait for the pending recovery checkpoint",
      },
    );
    this.#proof.asyncRecoveryCheckpointObserved = true;
  }
  async writeDuringAsyncAdoption(): Promise<void> {
    assert.equal(this.#proof.asyncRecoveryCheckpointObserved, true);
    assert.equal(await this.recoveryStatus(), "Recovery: saving");
    assert.equal(await this.dialog().isDisplayed(), true);
    try {
      await writeFile(this.source(FILE), ASYNC_EXTERNAL);
      this.#disk = ASYNC_EXTERNAL;
      this.#proof.externalWriteDuringAdoption = true;
    } finally {
      await this.releaseJournalLock();
    }
    await this.assertSources();
  }
  async assertAsyncAdoption(): Promise<void> {
    await this.waitForComparisonClosed(10_000);
    await this.assertBuffers(ORIGINAL, false);
    await this.assertSources();
    assert.equal(this.#proof.externalWriteDuringAdoption, true);
    this.#proof.asyncAdoptionPreservedNewerDisk = true;
  }
  async refuseAsyncAdoptionSave(): Promise<void> {
    await this.surface().replace(FILE, ASYNC_EDIT);
    await this.surface().save(FILE);
    await this.surface().assertAlert(SAVE_ERROR);
    await this.assertBuffers(ASYNC_EDIT, true);
    await this.assertSources();
    this.#proof.asyncAdoptionSaveRefused = true;
  }
  async freshAsyncAdoptionAndSave(): Promise<void> {
    await this.inspect(ASYNC_EDIT, ASYNC_EXTERNAL);
    await this.button("Discard buffer edits and use disk version").click();
    await this.waitForComparisonClosed(10_000);
    await this.surface().assertBuffer(FILE, ASYNC_EXTERNAL);
    await this.surface().assertDirty(FILE, false);
    await this.surface().replace(FILE, ASYNC_SAVED);
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    this.#disk = ASYNC_SAVED;
    await this.assertSources();
    this.#proof.freshAsyncRevisionAllowsSave = true;
  }
  async discardCompanionAndClose(): Promise<void> {
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().discardUsingDisk(OTHER, OTHER_DISK);
    await this.app().closeNativeWindow();
    await this.assertSources();
  }
  async deleteSource(): Promise<void> {
    await unlink(this.source(FILE));
    this.#deleted = true;
    await this.assertSources();
  }
  async inspectDeleted(): Promise<void> {
    await this.button("Compare with disk").click();
  }
  async assertDeletedRead(): Promise<void> {
    await this.surface().assertAlert(READ_ERROR);
    assert.equal(await this.dialog().isExisting(), false);
    await this.assertBuffers(DRAFT, true);
    await this.assertSources();
    this.#proof.deletedReadVisible = true;
  }
  async saveDeleted(): Promise<void> {
    await this.surface().save(FILE);
  }
  async assertDeletedSave(): Promise<void> {
    await this.surface().assertAlert(SAVE_ERROR);
    await this.assertBuffers(DRAFT, true);
    await this.assertSources();
    this.#proof.deletedSaveRefusedWithoutRecreation = true;
  }
  async checkpointAndTerminate(): Promise<void> {
    await this.browser().waitUntil(
      async () => {
        if (
          (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) !==
          "Recovery: ready"
        )
          return false;
        const entries = await this.journal().entries();
        return (
          entries.some((e) => e.filePath === FILE && e.kind === "draft" && e.content === DRAFT) &&
          entries.some(
            (e) => e.filePath === OTHER && e.kind === "draft" && e.content === OTHER_DRAFT,
          )
        );
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "deleted-source buffers were not durably checkpointed",
      },
    );
    this.#proof.draftsCheckpointedBeforeTermination = true;
    await this.app().forceTerminate();
    await this.assertSources();
  }
  async assertCancelled(): Promise<void> {
    assert.equal(this.#proof.cancelledWithoutMutation, true);
    await this.assertBuffers(DRAFT, true);
    await this.assertSources();
  }
  async assertStale(): Promise<void> {
    assert.equal(this.#proof.staleAfterSaveRefused, true);
    await this.assertBuffers(DRAFT, false);
    await this.assertSources();
  }
  async assertCancelledBaseline(): Promise<void> {
    assert.equal(this.#proof.cancelDidNotAdvanceBaseline, true);
    await this.assertBuffers(BEFORE_ADOPTION, true);
    await this.assertSources();
  }
  async assertAdopted(): Promise<void> {
    assert.equal(this.#proof.inspectedSnapshotExplicitlyAdopted, true);
    await this.assertBuffers(INSPECTED, false);
    await this.assertSources();
  }
  async assertLaterConflict(): Promise<void> {
    assert.equal(this.#proof.laterExternalSaveRefused, true);
    await this.assertBuffers(FINAL, true);
    await this.assertSources();
  }
  async assertAsyncAdoptionSaveRefused(): Promise<void> {
    assert.equal(this.#proof.asyncAdoptionSaveRefused, true);
    await this.assertBuffers(ASYNC_EDIT, true);
    await this.assertSources();
  }
  async assertFreshSave(): Promise<void> {
    assert.equal(
      this.#proof.freshAdoptionAllowsSave || this.#proof.freshAsyncRevisionAllowsSave,
      true,
    );
    const expected = this.#proof.freshAsyncRevisionAllowsSave ? ASYNC_SAVED : FINAL;
    await this.assertBuffers(expected, false);
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
      sourceDeleted: this.#deleted,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return (
      this.#app?.redactedDiagnostics([
        ORIGINAL,
        DRAFT,
        OTHER_DISK,
        OTHER_DRAFT,
        BEFORE_ADOPTION,
        INSPECTED,
        LATER,
        FINAL,
        ASYNC_DRAFT,
        ASYNC_EXTERNAL,
        ASYNC_EDIT,
        ASYNC_SAVED,
      ]) ?? ""
    );
  }
  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.releaseJournalLock();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#app?.dispose();
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
          path.join(
            this.#lease.runnerArtifactPath,
            `editor-disk-comparison-${this.#deleted ? "deleted" : this.#proof.asyncRecoveryCheckpointObserved ? "async-revisions" : "revisions"}-evidence.json`,
          ),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native disk comparison cleanup failed");
  }

  private async releaseJournalLock() {
    const release = this.#releaseJournalLock;
    this.#releaseJournalLock = undefined;
    await release?.();
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
  private dialog() {
    return this.browser().$('[role="dialog"]');
  }
  private button(name: string) {
    return this.browser().$(`button=${name}`);
  }
  private async inspect(buffer: string, disk: string) {
    await this.button("Compare with disk").click();
    await this.dialog().waitForDisplayed({ timeout: 10_000 });
    assert.equal(await this.dialog().getComputedLabel(), "Compare with disk");
    assert.equal(
      await this.dialog().$('[aria-label="Current editor buffer"] pre').getText(),
      buffer,
    );
    assert.equal(
      await this.dialog().$('[aria-label="Inspected disk version"] pre').getText(),
      disk,
    );
    await this.assertSources();
  }
  private async assertBuffers(content: string, dirty: boolean) {
    await this.surface().assertBuffer(FILE, content);
    await this.surface().assertDirty(FILE, dirty);
    await this.surface().assertDirty(OTHER, true);
    // Behind a modal we cannot activate tabs with a real pointer. Exact companion
    // content is rechecked once the modal is gone, not by private editor access.
    if (!(await this.dialog().isExisting())) {
      await this.surface().open(OTHER, OTHER_DRAFT);
      await this.surface().open(FILE, content);
    }
  }
  private async assertSources() {
    if (this.#deleted) await assert.rejects(access(this.source(FILE)), { code: "ENOENT" });
    else assert.deepEqual(await readFile(this.source(FILE)), Buffer.from(this.#disk));
    assert.deepEqual(await readFile(this.source(OTHER)), Buffer.from(OTHER_DISK));
  }
  private async recoveryStatus(): Promise<string> {
    return this.browser().execute(() =>
      document
        .querySelector<HTMLElement>('[aria-label="Recovery checkpoint status"]')
        ?.textContent?.trim() ?? "",
    );
  }
  private async waitForRecoveryReady(): Promise<void> {
    await this.browser().waitUntil(
      async () =>
        (await this.recoveryStatus()) === "Recovery: ready" &&
        (await this.journal().entries()).some(
          (entry) => entry.filePath === FILE && entry.kind === "draft" && entry.content === DRAFT,
        ) &&
        (await this.journal().entries()).some(
          (entry) =>
            entry.filePath === OTHER && entry.kind === "draft" && entry.content === OTHER_DRAFT,
        ),
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "the baseline drafts were not durably checkpointed before the race fixture",
      },
    );
  }
}
