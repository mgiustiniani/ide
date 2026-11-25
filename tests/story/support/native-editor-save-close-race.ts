import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorCheckpointJournal } from "./native-editor-checkpoint-journal.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { NativeSourceFileLease } from "./native-source-file-lease.js";

const FILE = "close-race.txt",
  OTHER = "companion.txt";
const ORIGINAL = "Original close race source",
  DRAFT = "Unsaved close race café source";
const APPEND = " + later edit",
  LATEST = DRAFT + APPEND;
const COMPANION = "Original close race companion",
  OTHER_DRAFT = "Unrelated close race café draft";

/** Linux acceptance with a real filesystem lease and ordinary native Save; no replacement IPC. */
export class NativeEditorSaveCloseRaceSession {
  #environment?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #sourceLease?: NativeSourceFileLease;
  #proof = {
    requirement: "REQ-IDE-EDITOR-CLOSE-GUARDS-001",
    nativeGui: true,
    e2e: true,
    artifactKind: "release-no-bundle",
    packagedApplication: false,
    acknowledgedDraftsBeforeClose: false,
    realSourceIoBlocked: false,
    closePointerRequestCompleted: false,
    keyboardEditBeforeLeaseRelease: false,
    capturedSourceSavedWithoutClosingNewEdits: false,
    companionPreserved: false,
    explicitRetrySavedLatest: false,
    cleanNativeClose: false,
  };
  async prepare() {
    this.#environment = await NativeScenarioEnvironmentLease.acquire(
      "REQ-IDE-EDITOR-CLOSE-GUARDS-001",
    );
    await writeFile(this.source(FILE), ORIGINAL, { flag: "wx" });
    await writeFile(this.source(OTHER), COMPANION, { flag: "wx" });
  }
  async launchAndEdit() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
    await this.app().waitForFileExplorer();
    await this.surface().open(OTHER, COMPANION);
    await this.surface().replace(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, ORIGINAL);
    await this.surface().replace(FILE, DRAFT);
    const journal = new NativeEditorCheckpointJournal(this.#environment!);
    await this.browser().waitUntil(
      async () => {
        if (
          (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) !==
          "Recovery: ready"
        )
          return false;
        const entries = await journal.entries();
        return [
          [FILE, DRAFT],
          [OTHER, OTHER_DRAFT],
        ].every(([filePath, text]) =>
          entries.some(
            (entry) =>
              entry.kind === "draft" && entry.filePath === filePath && entry.content === text,
          ),
        );
      },
      {
        timeout: 10000,
        interval: 100,
        timeoutMsg: "issued dirty checkpoints were not ready before the close race",
      },
    );
    assert.equal(await readFile(this.source(FILE), "utf8"), ORIGINAL);
    assert.equal(await readFile(this.source(OTHER), "utf8"), COMPANION);
    this.#proof.acknowledgedDraftsBeforeClose = true;
  }
  async requestBlockedClose() {
    assert.equal(this.#proof.acknowledgedDraftsBeforeClose, true);
    this.#sourceLease = await NativeSourceFileLease.acquire(
      this.#environment!.paths.workspace,
      FILE,
    );
    assert.equal(
      this.#sourceLease.evidence().originalSha256,
      createHash("sha256").update(ORIGINAL).digest("hex"),
    );
    await this.browser().$(`[aria-label="Close ${FILE}"]`).click();
    this.#proof.closePointerRequestCompleted = true;
    await this.#sourceLease.waitForBreak();
    await this.surface().assertDirty(FILE, true);
    this.#proof.realSourceIoBlocked = true;
  }
  async editDuringSave() {
    assert.equal(this.#proof.realSourceIoBlocked, true);
    try {
      await this.surface().focus(FILE);
      await this.browser().keys(["Control", "End"]);
      try {
        await this.browser().performActions([
          { type: "key", id: "native-close-race-typing", actions: textKeySequence(APPEND) },
        ]);
      } finally {
        await this.browser().releaseActions();
      }
      await this.surface().assertBuffer(FILE, LATEST);
      await this.surface().assertDirty(FILE, true);
      assert.equal(this.#sourceLease!.evidence().released, false);
      this.#proof.keyboardEditBeforeLeaseRelease = true;
    } finally {
      await this.#sourceLease!.release();
    }
  }
  async assertRetained() {
    await this.surface().assertAlert(
      "The file changed while saving; save it again before closing.",
    );
    await this.surface().assertBuffer(FILE, LATEST);
    await this.surface().assertDirty(FILE, true);
    await this.browser().waitUntil(
      async () => (await readFile(this.source(FILE), "utf8")) === DRAFT,
      {
        timeout: 5000,
        interval: 50,
        timeoutMsg: "the held native Save did not write exactly its captured source",
      },
    );
    // The old captured text on disk and newer dirty text in the retained tab
    // independently establish that typing happened after Save captured its input.
    this.#proof.capturedSourceSavedWithoutClosingNewEdits = true;
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().assertDirty(OTHER, true);
    assert.equal(await readFile(this.source(OTHER), "utf8"), COMPANION);
    await this.surface().open(FILE, LATEST);
    this.#proof.companionPreserved = true;
  }
  async saveLatest() {
    assert.equal(this.#proof.capturedSourceSavedWithoutClosingNewEdits, true);
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
  }
  async assertSaved() {
    assert.equal(await readFile(this.source(FILE), "utf8"), LATEST);
    assert.equal(await readFile(this.source(OTHER), "utf8"), COMPANION);
    await this.surface().assertBuffer(FILE, LATEST);
    await this.surface().assertDirty(OTHER, true);
    this.#proof.explicitRetrySavedLatest = true;
  }
  async close() {
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().discardUsingDisk(OTHER, COMPANION);
    await this.app().closeNativeWindow();
    this.#proof.cleanNativeClose = true;
  }
  async assertFinal() {
    await this.app().assertExited();
    assert.equal(await readFile(this.source(FILE), "utf8"), LATEST);
    assert.equal(await readFile(this.source(OTHER), "utf8"), COMPANION);
    await this.#environment!.assertConfiguredPathsConfined();
    assert.equal(this.#proof.cleanNativeClose, true);
  }
  evidence() {
    return {
      ...this.#proof,
      sourceLease: this.#sourceLease?.evidence(),
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#environment?.evidence(),
    };
  }
  diagnostics() {
    return this.#app?.redactedDiagnostics([ORIGINAL, DRAFT, LATEST, COMPANION, OTHER_DRAFT]) ?? "";
  }
  async dispose() {
    const errors: unknown[] = [];
    // Release real source I/O before stopping the owned application or deleting fixtures.
    try {
      await this.#sourceLease?.release();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#app?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#environment?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#environment)
        await writeFile(
          path.join(this.#environment.runnerArtifactPath, "editor-save-close-race-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
          { flag: "wx", mode: 0o600 },
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Save/Close race cleanup failed");
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
    assert.ok(this.#environment && [FILE, OTHER].includes(file));
    return path.join(this.#environment.paths.workspace, file);
  }
}
