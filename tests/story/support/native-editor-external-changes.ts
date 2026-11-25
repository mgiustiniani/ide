import assert from "node:assert/strict";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const EXTERNAL_CHANGES_REQUIREMENT = "REQ-IDE-EDITOR-EXTERNAL-CHANGES-001";
const FILE = "monitor-proof.txt",
  OTHER = "companion.txt";
const ORIGINAL = "Original disk source",
  EXTERNAL = "External disk change",
  DRAFT = "Monitor draft caf\u00e9";
const OTHER_DISK = "Original companion",
  OTHER_DRAFT = "Companion monitor edits";
const SAVED = "Explicitly saved monitor edits",
  MISSING_DRAFT = "Draft after deletion";
const SAVE_ERROR =
  "The file could not be saved. Check available disk space and write permissions, or compare with disk if another tool changed it.";

export class NativeEditorExternalChangesSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #disk: string | null = ORIGINAL;
  #proof = {
    requirement: EXTERNAL_CHANGES_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    passiveWriteDetected: false,
    backgroundWriteDetected: false,
    backgroundNoticeSelectedFile: false,
    inspectionDidNotAdoptBaseline: false,
    explicitAdoptionClearedWarning: false,
    ownSaveDidNotWarn: false,
    passiveDeletionDetected: false,
    missingSaveRefused: false,
  };
  async prepare() {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(EXTERNAL_CHANGES_REQUIREMENT);
    await writeFile(this.source(FILE), ORIGINAL, { flag: "wx" });
    await writeFile(this.source(OTHER), OTHER_DISK, { flag: "wx" });
  }
  async launch() {
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
  async externalWrite() {
    await this.surface().open(OTHER, OTHER_DRAFT);
    assert.equal(Buffer.byteLength(ORIGINAL), Buffer.byteLength(EXTERNAL));
    await writeFile(this.source(FILE), EXTERNAL);
    this.#disk = EXTERNAL;
  }
  async assertPassiveWrite() {
    const notice = this.browser().$('[aria-label="Other open files changed on disk"]');
    await notice.waitForDisplayed({ timeout: 6_000 });
    assert.ok((await notice.getText()).includes(FILE));
    await this.surface().assertBuffer(OTHER, OTHER_DRAFT);
    await this.surface().assertDirty(FILE, true);
    await this.surface().assertDirty(OTHER, true);
    await this.assertSources();
    this.#proof.backgroundWriteDetected = true;
    await notice.$(`button=${FILE}`).click();
    await this.surface().assertBuffer(FILE, DRAFT);
    this.#proof.backgroundNoticeSelectedFile = true;
    await this.warning("This file changed on disk.");
    await this.assertDrafts(DRAFT, true);
    await this.assertSources();
    this.#proof.passiveWriteDetected = true;
  }
  async compareAndCancel() {
    await this.browser().$("button=Compare with disk").click();
    const dialog = this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await dialog.$('[aria-label="Current editor buffer"] pre').getText(), DRAFT);
    assert.equal(await dialog.$('[aria-label="Inspected disk version"] pre').getText(), EXTERNAL);
    await this.browser().keys("Escape");
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
  }
  async saveConflicting() {
    await this.surface().save(FILE);
  }
  async assertConflict() {
    await this.surface().assertAlert(SAVE_ERROR);
    await this.assertDrafts(DRAFT, true);
    await this.assertSources();
    await this.warning("This file changed on disk.");
    this.#proof.inspectionDidNotAdoptBaseline = true;
  }
  async adopt() {
    await this.surface().discardUsingDisk(FILE, EXTERNAL);
  }
  async assertAdopted() {
    await this.assertDrafts(EXTERNAL, false);
    await this.assertSources();
    await this.noWarning();
    this.#proof.explicitAdoptionClearedWarning = true;
  }
  async editAndSave() {
    await this.surface().replace(FILE, SAVED);
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    this.#disk = SAVED;
  }
  async assertOwnSave() {
    await this.assertDrafts(SAVED, false);
    await this.assertSources();
    await this.noWarning();
    this.#proof.ownSaveDidNotWarn = true;
  }
  async delete() {
    await unlink(this.source(FILE));
    this.#disk = null;
  }
  async assertMissing() {
    await this.warning("This file is missing on disk.");
    await this.assertDrafts(SAVED, false);
    await this.assertSources();
    this.#proof.passiveDeletionDetected = true;
  }
  async editAndSaveMissing() {
    await this.surface().replace(FILE, MISSING_DRAFT);
    await this.surface().save(FILE);
  }
  async assertMissingConflict() {
    await this.surface().assertAlert(SAVE_ERROR);
    await this.assertDrafts(MISSING_DRAFT, true);
    await this.assertSources();
    this.#proof.missingSaveRefused = true;
  }
  async recreateDiscardAndClose() {
    await writeFile(this.source(FILE), EXTERNAL, { flag: "wx" });
    this.#disk = EXTERNAL;
    await this.surface().discardUsingDisk(FILE, EXTERNAL);
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().discardUsingDisk(OTHER, OTHER_DISK);
    await this.app().closeNativeWindow();
  }
  async assertFinal() {
    await this.app().assertExited();
    await this.assertSources();
    await this.#lease!.assertConfiguredPathsConfined();
  }
  async dispose() {
    const errors: unknown[] = [];
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
          path.join(this.#lease.runnerArtifactPath, "editor-external-changes-evidence.json"),
          JSON.stringify(
            {
              ...this.#proof,
              application: this.#app?.evidence(),
              scenarioEnvironment: this.#lease.evidence(),
            },
            null,
            2,
          ),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native external-change cleanup failed");
  }
  private app() {
    assert.ok(this.#app);
    return this.#app;
  }
  private browser() {
    return this.app().browser();
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private source(file: string) {
    assert.ok(this.#lease && [FILE, OTHER].includes(file));
    return path.join(this.#lease.paths.workspace, file);
  }
  private async warning(prefix: string) {
    await this.browser().waitUntil(
      async () => {
        const notice = this.browser().$('[aria-label="External file change"]');
        return (await notice.isExisting()) && (await notice.getText()).startsWith(prefix);
      },
      {
        timeout: 6_000,
        interval: 100,
        timeoutMsg: "passive external-file warning was not presented",
      },
    );
    assert.equal(await this.browser().$('[role="dialog"]').isExisting(), false);
  }
  private async noWarning() {
    await this.browser()
      .$('[aria-label="External file change"]')
      .waitForExist({ reverse: true, timeout: 6_000 });
    // Observe a complete polling interval too; immediate clearing alone could hide a false later notice.
    await this.browser().pause(2_200);
    assert.equal(await this.browser().$('[aria-label="External file change"]').isExisting(), false);
  }
  private async assertDrafts(content: string, dirty: boolean) {
    await this.surface().assertBuffer(FILE, content);
    await this.surface().assertDirty(FILE, dirty);
    await this.surface().assertDirty(OTHER, true);
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, content);
  }
  private async assertSources() {
    if (this.#disk === null) await assert.rejects(access(this.source(FILE)), { code: "ENOENT" });
    else assert.deepEqual(await readFile(this.source(FILE)), Buffer.from(this.#disk));
    assert.deepEqual(await readFile(this.source(OTHER)), Buffer.from(OTHER_DISK));
  }
}
