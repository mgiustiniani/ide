import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const RECOVERY_REQUIREMENT = "REQ-IDE-EDITOR-RECOVERY-001";
const FILE = "recovery-proof.txt";
const OTHER_FILE = "companion.txt";
const DISK = "Original recovery source";
const DRAFT = "Unsaved recovery caf\u00e9 version";
const OTHER_DISK = "Original companion source";
const OTHER_DRAFT = "Unrelated dirty companion";
const EXTERNAL = "External writer after recovery review";
const css = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

interface JournalEntry {
  id: string;
  filePath: string;
  kind: string;
  content: string;
}
interface Journal {
  version: number;
  entries: JournalEntry[];
}

/** Real GUI interactions, real application termination/restart, and read-only storage evidence. */
export class NativeEditorRecoverySession {
  #lease?: NativeScenarioEnvironmentLease;
  #application?: NativeDesktopApplication;
  readonly #launches: NativeDesktopApplication[] = [];
  #checkpointId?: string;
  #externalWritten = false;
  #evidence = {
    requirement: RECOVERY_REQUIREMENT,
    target: "desktop/tauri-webdriver",
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    automaticCheckpointAcknowledged: false,
    restartUsedSameStorage: false,
    cancelPreservedBuffer: false,
    unrelatedDirtyBufferPreserved: false,
    explicitRestoreDirty: false,
    laterSaveConflictPreservedDisk: false,
    originalCheckpointRetained: false,
    cleanCloseAfterExplicitDiscard: false,
  };

  async prepare(): Promise<void> {
    assert.equal(process.env.IDE_STORY_NATIVE_GUI_TARGET, "desktop/tauri-webdriver");
    assert.equal(this.#lease, undefined);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(RECOVERY_REQUIREMENT);
    await this.#lease.assertConfiguredPathsConfined();
    assert.deepEqual(await readdir(this.workspace()), []);
    await writeFile(this.source(FILE), DISK, { flag: "wx" });
    await writeFile(this.source(OTHER_FILE), OTHER_DISK, { flag: "wx" });
  }
  async launch(): Promise<void> {
    assert.ok(this.#lease);
    assert.equal(this.#application, undefined);
    const application = new NativeDesktopApplication();
    this.#application = application;
    this.#launches.push(application);
    await application.launch();
    await application.waitForFileExplorer();
    await this.openFile(FILE, DISK);
    await this.assertDirty(FILE, false);
    if (this.#launches.length === 2) this.#evidence.restartUsedSameStorage = true;
  }
  async editUnsavedDraft(): Promise<void> {
    await this.typeBuffer(FILE, DRAFT);
  }
  async awaitAutomaticCheckpoint(): Promise<void> {
    await this.browser().waitUntil(
      async () => {
        if (
          (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()) !==
          "Recovery: ready"
        )
          return false;
        try {
          const entry = (await this.journal()).entries.find(
            (e) => e.filePath === FILE && e.kind === "draft" && e.content === DRAFT,
          );
          if (!entry) return false;
          this.#checkpointId = entry.id;
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "automatic recovery checkpoint was not durably acknowledged",
      },
    );
    assert.match(this.#checkpointId!, /^[0-9a-f]{32}$/);
    await this.assertSources();
    this.#evidence.automaticCheckpointAcknowledged = true;
  }
  async terminate(): Promise<void> {
    assert.equal(this.#evidence.automaticCheckpointAcknowledged, true);
    await this.app().forceTerminate();
    await this.app().dispose();
    this.#application = undefined;
    assert.equal(
      (await this.journal()).entries.find((e) => e.id === this.#checkpointId)?.content,
      DRAFT,
    );
    await this.assertSources();
  }
  async exposeRecoverableDraft(): Promise<void> {
    assert.equal(this.#launches.length, 2);
    await this.button("Recovery and history").click();
    await this.browser()
      .$('[aria-label="Recovery and local history"]')
      .waitForDisplayed({ timeout: 10_000 });
    await this.reviewButton().waitForDisplayed({ timeout: 10_000, interval: 100 });
    const item = await this.reviewButton().parentElement();
    assert.match(await item.getText(), /Recoverable draft/);
    await this.assertBuffer(FILE, DISK);
    await this.assertDirty(FILE, false);
    await this.assertSources();
  }
  async editUnrelatedBuffer(): Promise<void> {
    await this.openFile(OTHER_FILE, OTHER_DISK);
    await this.typeBuffer(OTHER_FILE, OTHER_DRAFT);
    await this.openFile(FILE, DISK);
  }
  async review(): Promise<void> {
    await this.reviewButton().click();
    const dialog = this.browser().$('[role="dialog"]');
    await dialog.waitForDisplayed({ timeout: 10_000, interval: 100 });
    assert.equal(await dialog.getComputedLabel(), "Review recovered buffer");
    assert.equal(await dialog.$('[aria-label="Current editor buffer"] pre').getText(), DISK);
    assert.equal(await dialog.$('[aria-label="Recovery checkpoint"] pre').getText(), DRAFT);
    assert.equal(
      await this.button("Replace reviewed buffer with recovered version").isEnabled(),
      true,
    );
    await this.assertSources();
  }
  async cancel(): Promise<void> {
    await this.button("Keep editor buffer").click();
    await this.browser().$('[role="dialog"]').waitForExist({ reverse: true, timeout: 5_000 });
    await this.assertBuffer(FILE, DISK);
    await this.assertDirty(FILE, false);
    await this.assertDirty(OTHER_FILE, true);
    await this.assertSources();
    this.#evidence.cancelPreservedBuffer = true;
  }
  async changeDiskAfterReview(): Promise<void> {
    assert.equal(await this.browser().$('[role="dialog"]').isDisplayed(), true);
    await writeFile(this.source(FILE), EXTERNAL);
    this.#externalWritten = true;
    await this.assertSources();
  }
  async restore(): Promise<void> {
    await this.button("Replace reviewed buffer with recovered version").click();
    await this.browser().$('[role="dialog"]').waitForExist({ reverse: true, timeout: 10_000 });
    await this.assertBuffer(FILE, DRAFT);
    await this.assertDirty(FILE, true);
    await this.assertDirty(OTHER_FILE, true);
    await this.openFile(OTHER_FILE, OTHER_DRAFT);
    await this.assertDirty(OTHER_FILE, true);
    await this.openFile(FILE, DRAFT);
    this.#evidence.unrelatedDirtyBufferPreserved = true;
    this.#evidence.explicitRestoreDirty = true;
    assert.equal(
      (await this.journal()).entries.find((e) => e.id === this.#checkpointId)?.content,
      DRAFT,
    );
    this.#evidence.originalCheckpointRetained = true;
    await this.assertSources();
  }
  async refuseConflictingSave(): Promise<void> {
    await this.focusEditor(FILE);
    await this.browser().keys(["Control", "s"]);
    await this.browser().waitUntil(
      async () => {
        const alerts = await this.browser().$$('[role="alert"]').getElements();
        const texts = await alerts.map((el) => el.getText());
        return texts.includes(
          "The file could not be saved. Check available disk space and write permissions, or compare with disk if another tool changed it.",
        );
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "revision-conflicting recovery Save was not visibly refused",
      },
    );
    await this.assertBuffer(FILE, DRAFT);
    await this.assertDirty(FILE, true);
    await this.assertSources();
    this.#evidence.laterSaveConflictPreservedDisk = true;
  }
  async assertCancellation(): Promise<void> {
    assert.equal(this.#evidence.cancelPreservedBuffer, true);
    await this.assertBuffer(FILE, DISK);
    await this.assertDirty(FILE, false);
    await this.assertDirty(OTHER_FILE, true);
    await this.assertSources();
  }
  async assertRestored(): Promise<void> {
    assert.equal(this.#evidence.originalCheckpointRetained, true);
    await this.assertBuffer(FILE, DRAFT);
    await this.assertDirty(FILE, true);
    await this.assertDirty(OTHER_FILE, true);
    await this.assertSources();
    assert.equal(
      (await this.journal()).entries.find((e) => e.id === this.#checkpointId)?.content,
      DRAFT,
    );
  }
  async assertSaveRefused(): Promise<void> {
    assert.equal(this.#evidence.laterSaveConflictPreservedDisk, true);
    await this.assertBuffer(FILE, DRAFT);
    await this.assertDirty(FILE, true);
    await this.assertSources();
  }
  async assertClosed(): Promise<void> {
    assert.equal(this.#evidence.cleanCloseAfterExplicitDiscard, true);
    await this.app().assertExited();
    await this.assertSources();
    await this.#lease!.assertConfiguredPathsConfined();
    assert.equal(
      (await this.journal()).entries.find((e) => e.id === this.#checkpointId)?.content,
      DRAFT,
    );
  }
  async discardAndClose(): Promise<void> {
    await this.button("Close recovery panel").click();
    for (const [file, content, disk] of [
      [FILE, DRAFT, EXTERNAL],
      [OTHER_FILE, OTHER_DRAFT, OTHER_DISK],
    ]) {
      await this.openFile(file, content);
      await this.button("Compare with disk").click();
      const dialog = this.browser().$('[role="dialog"]');
      await dialog.waitForDisplayed({ timeout: 10_000 });
      assert.equal(await dialog.getComputedLabel(), "Compare with disk");
      assert.equal(await dialog.$('[aria-label="Inspected disk version"] pre').getText(), disk);
      await this.button("Discard buffer edits and use disk version").click();
      await dialog.waitForExist({ reverse: true, timeout: 10_000 });
      await this.assertBuffer(file, disk);
      await this.assertDirty(file, false);
    }
    await this.assertSources();
    await this.app().closeWindow();
    this.#evidence.cleanCloseAfterExplicitDiscard = true;
    assert.deepEqual((await readdir(this.workspace())).sort(), [".ide", OTHER_FILE, FILE].sort());
    assert.deepEqual(await readdir(path.join(this.workspace(), ".ide")), ["workspace.json"]);
    await this.#lease!.assertConfiguredPathsConfined();
  }
  evidence() {
    return {
      ...this.#evidence,
      launches: this.#launches.map((app) => app.evidence()),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics(): string {
    return this.#launches
      .map((app) => app.redactedDiagnostics([DISK, DRAFT, OTHER_DISK, OTHER_DRAFT, EXTERNAL]))
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
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "editor-recovery-evidence.json"),
        `${JSON.stringify(this.evidence(), null, 2)}\n`,
      );
    if (errors.length) throw new AggregateError(errors, "native recovery scenario cleanup failed");
  }

  private app() {
    assert.ok(this.#application, "recovery GUI application not launched");
    return this.#application;
  }
  private browser() {
    return this.app().browser();
  }
  private workspace() {
    assert.ok(this.#lease);
    return this.#lease.paths.workspace;
  }
  private source(file: string) {
    assert.ok([FILE, OTHER_FILE].includes(file));
    return path.join(this.workspace(), file);
  }
  private button(name: string) {
    return this.browser().$(`button=${name}`);
  }
  private reviewButton() {
    return this.button(`Review ${FILE}`);
  }
  private editor(file: string) {
    return this.browser().$(`[role="textbox"][aria-label^="${css(`Code editor for ${file}`)}"]`);
  }
  private tab(file: string) {
    return this.browser().$(`[role="tab"][data-path="${css(file)}"]`);
  }
  private async openFile(file: string, expected: string): Promise<void> {
    const item = this.browser().$(`[role="treeitem"][data-path="${css(file)}"]`);
    await item.waitForDisplayed({ timeout: 15_000, interval: 100 });
    await item.click();
    await this.tab(file).waitForDisplayed({ timeout: 15_000, interval: 100 });
    await this.assertBuffer(file, expected);
    assert.equal(await this.tab(file).getAttribute("aria-selected"), "true");
  }
  private async assertBuffer(file: string, expected: string): Promise<void> {
    await this.editor(file).waitForDisplayed({ timeout: 15_000, interval: 50 });
    await this.browser().waitUntil(
      async () =>
        (await this.browser().execute(() =>
          Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"))
            .map((line) => line.textContent ?? "")
            .join("\n")
            .replaceAll("\u00a0", " "),
        )) === expected,
      {
        timeout: 15_000,
        interval: 50,
        timeoutMsg: `exact rendered buffer for ${file} did not match`,
      },
    );
  }
  private async assertDirty(file: string, dirty: boolean): Promise<void> {
    await this.browser().waitUntil(
      async () => (await this.tab(file).$('[aria-label="Unsaved changes"]').isExisting()) === dirty,
      { timeout: 5_000, interval: 50, timeoutMsg: `${file} dirty state mismatch` },
    );
  }
  private async focusEditor(file: string): Promise<void> {
    // Monaco's accessible textarea is an input proxy under its rendered lines.
    // A real user clicks the visible text surface, not that intercepted proxy.
    await this.browser().$(".monaco-editor .view-lines .view-line").click();
    await this.browser().waitUntil(async () => this.editor(file).isFocused(), {
      timeout: 2_000,
      interval: 50,
      timeoutMsg: "visible Monaco click did not focus its accessible input",
    });
  }
  private async typeBuffer(file: string, content: string): Promise<void> {
    await this.focusEditor(file);
    await this.browser().keys(["Control", "a"]);
    await this.browser().keys(content);
    await this.assertBuffer(file, content);
    await this.assertDirty(file, true);
    await this.assertSources();
  }
  private async assertSources(): Promise<void> {
    assert.deepEqual(
      await readFile(this.source(FILE)),
      Buffer.from(this.#externalWritten ? EXTERNAL : DISK, "utf8"),
    );
    assert.deepEqual(await readFile(this.source(OTHER_FILE)), Buffer.from(OTHER_DISK, "utf8"));
  }
  private async journal(): Promise<Journal> {
    const key = createHash("sha256")
      .update(await realpath(this.workspace()), "utf8")
      .digest("hex");
    const directory = path.join(this.#lease!.paths.ideHome, "editor-recovery", key);
    const file = path.join(directory, "journal.json");
    const meta = await lstat(file);
    assert.equal(meta.isSymbolicLink(), false);
    assert.equal(meta.isFile(), true);
    assert.ok(meta.size < 64 * 1024);
    assert.equal(meta.mode & 0o777, 0o600);
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    const value = JSON.parse(await readFile(file, "utf8")) as Journal;
    assert.equal(value.version, 1);
    assert.ok(Array.isArray(value.entries));
    return value;
  }
}
