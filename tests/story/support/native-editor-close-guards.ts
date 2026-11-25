import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

export const CLOSE_GUARDS_REQUIREMENT = "REQ-IDE-EDITOR-CLOSE-GUARDS-001";
const FILE = "guard-proof.txt",
  OTHER = "companion.txt";
const ORIGINAL = "Original guard source",
  DRAFT = "Unsaved guard caf\u00e9 source",
  EXTERNAL = "External guard revision";
const OTHER_ORIGINAL = "Original guard companion",
  OTHER_DRAFT = "Unsaved guard companion";
const DESTINATION_SOURCE = "Untouched destination sentinel";
const TIME = "2026-01-01T00:00:00Z";

export class NativeEditorCloseGuardsSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #secondary = "";
  #primaryId = "";
  #secondaryId = "";
  #external = false;
  #otherSaved = false;
  #proof = {
    requirement: CLOSE_GUARDS_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    artifactKind: "release-no-bundle",
    packagedApplication: false,
    dirtyTabConflictRetained: false,
    dirtyWorkspaceSwitchRefused: false,
    dirtyNativeCloseRefused: false,
    saveBeforeTabClose: false,
    cleanWorkspaceSwitchAccepted: false,
    nativeCleanCloseAccepted: false,
  };

  async prepare(): Promise<void> {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(CLOSE_GUARDS_REQUIREMENT, {
      workspaceName: "guard-primary",
    });
    this.#secondary = path.join(path.dirname(this.#lease.paths.workspace), "guard-secondary");
    const workspaces = [];
    for (const [index, root] of [this.#lease.paths.workspace, this.#secondary].entries()) {
      await mkdir(path.join(root, ".ide"), { recursive: true });
      const canonical = await realpath(root);
      const id = `ws-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
      if (index === 0) this.#primaryId = id;
      else this.#secondaryId = id;
      const name = path.basename(root);
      await writeFile(
        path.join(root, ".ide/workspace.json"),
        JSON.stringify({ id, name, path: canonical, createdAt: TIME, updatedAt: TIME }),
        { flag: "wx" },
      );
      workspaces.push({
        id,
        name,
        rootPath: canonical,
        markerFolder: ".ide",
        createdAt: TIME,
        lastOpenedAt: TIME,
      });
    }
    await writeFile(
      path.join(this.#lease.paths.ideHome, "workspaces.json"),
      JSON.stringify({ version: 1, workspaces, currentWorkspaceId: this.#primaryId }),
      { flag: "wx" },
    );
    await writeFile(this.source(FILE), ORIGINAL, { flag: "wx" });
    await writeFile(this.source(OTHER), OTHER_ORIGINAL, { flag: "wx" });
    await writeFile(path.join(this.#secondary, "sentinel.txt"), DESTINATION_SOURCE, { flag: "wx" });
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launch(): Promise<void> {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.surface().open(FILE, ORIGINAL);
  }
  async makeDirty(): Promise<void> {
    await this.surface().replace(FILE, DRAFT);
    await this.surface().open(OTHER, OTHER_ORIGINAL);
    await this.surface().replace(OTHER, OTHER_DRAFT);
    await this.surface().open(FILE, DRAFT);
    await this.assertSources();
  }
  async changeSourceExternally(): Promise<void> {
    await writeFile(this.source(FILE), EXTERNAL);
    this.#external = true;
  }
  async closeConflictingTab(): Promise<void> {
    await this.browser().$(`[aria-label="Close ${FILE}"]`).click();
  }
  async assertTabRefused(): Promise<void> {
    await this.surface().assertAlert(
      "The tab could not be closed. Save the file or resolve its disk conflict first.",
    );
    await this.assertDirtyPreserved();
    this.#proof.dirtyTabConflictRetained = true;
  }
  async switchWhileDirty(): Promise<void> {
    await this.secondaryOption().click();
  }
  async assertSwitchRefused(): Promise<void> {
    await this.surface().assertAlert("Save modified files before switching workspaces.");
    await this.assertRegistry(this.#primaryId);
    await this.assertDirtyPreserved();
    assert.equal(await this.primaryOption().getAttribute("aria-selected"), "true");
    this.#proof.dirtyWorkspaceSwitchRefused = true;
  }
  async requestDirtyClose(): Promise<void> {
    await this.app().requestNativeWindowClose();
  }
  async assertNativeCloseRefused(): Promise<void> {
    await this.surface().assertAlert("Save modified files before closing the IDE.");
    await this.app().assertRunning();
    await this.assertDirtyPreserved();
    this.#proof.dirtyNativeCloseRefused = true;
  }
  async closeSavableTab(): Promise<void> {
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.browser().$(`[aria-label="Close ${OTHER}"]`).click();
    await this.surface().tab(OTHER).waitForExist({ reverse: true, timeout: 10_000 });
    this.#otherSaved = true;
    await this.assertSources();
    await this.surface().assertBuffer(FILE, DRAFT);
    await this.surface().assertDirty(FILE, true);
    this.#proof.saveBeforeTabClose = true;
  }
  async assertSavedTabClosed(): Promise<void> {
    assert.equal(this.#proof.saveBeforeTabClose, true);
    assert.equal(await this.surface().tab(OTHER).isExisting(), false);
    await this.surface().assertBuffer(FILE, DRAFT);
    await this.surface().assertDirty(FILE, true);
    await this.assertSources();
  }
  async assertSwitched(): Promise<void> {
    assert.equal(this.#proof.cleanWorkspaceSwitchAccepted, true);
    await this.assertRegistry(this.#secondaryId);
    await this.assertSources();
    assert.equal(await this.secondaryOption().getAttribute("aria-selected"), "true");
  }
  async resolveAndSwitch(): Promise<void> {
    await this.surface().discardUsingDisk(FILE, EXTERNAL);
    await this.secondaryOption().click();
    await this.browser().waitUntil(
      async () => (await this.secondaryOption().getAttribute("aria-selected")) === "true",
      { timeout: 15_000, interval: 100 },
    );
    await this.browser()
      .$('[role="treeitem"][data-path="sentinel.txt"]')
      .waitForDisplayed({ timeout: 15_000 });
    await this.assertRegistry(this.#secondaryId);
    assert.equal(await this.surface().tab(FILE).isExisting(), false);
    assert.equal(await this.surface().tab(OTHER).isExisting(), false);
    await this.assertSources();
    this.#proof.cleanWorkspaceSwitchAccepted = true;
  }
  async closeCleanly(): Promise<void> {
    await this.app().closeNativeWindow();
    this.#proof.nativeCleanCloseAccepted = true;
  }
  async assertFinal(): Promise<void> {
    await this.app().assertExited();
    await this.assertSources();
    await this.assertRegistry(this.#secondaryId);
    await this.#lease!.assertConfiguredPathsConfined();
    assert.equal(this.#proof.nativeCleanCloseAccepted, true);
  }
  evidence() {
    return {
      ...this.#proof,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return (
      this.#app?.redactedDiagnostics([
        ORIGINAL,
        DRAFT,
        EXTERNAL,
        OTHER_ORIGINAL,
        OTHER_DRAFT,
        DESTINATION_SOURCE,
      ]) ?? ""
    );
  }
  async dispose(): Promise<void> {
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
          path.join(this.#lease.runnerArtifactPath, "editor-close-guards-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "native close guard scenario cleanup failed");
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
  private primaryOption() {
    return this.browser().$('button[role="option"][title^="guard-primary"]');
  }
  private secondaryOption() {
    return this.browser().$('button[role="option"][title^="guard-secondary"]');
  }
  private async assertRegistry(id: string) {
    assert.equal(
      JSON.parse(await readFile(path.join(this.#lease!.paths.ideHome, "workspaces.json"), "utf8"))
        .currentWorkspaceId,
      id,
    );
  }
  private async assertDirtyPreserved() {
    await this.surface().assertBuffer(FILE, DRAFT);
    await this.surface().assertDirty(FILE, true);
    await this.surface().open(OTHER, OTHER_DRAFT);
    await this.surface().assertDirty(OTHER, true);
    await this.surface().open(FILE, DRAFT);
    await this.assertSources();
  }
  private async assertSources() {
    assert.deepEqual(
      await readFile(this.source(FILE)),
      Buffer.from(this.#external ? EXTERNAL : ORIGINAL),
    );
    assert.deepEqual(
      await readFile(this.source(OTHER)),
      Buffer.from(this.#otherSaved ? OTHER_DRAFT : OTHER_ORIGINAL),
    );
    assert.deepEqual(
      await readFile(path.join(this.#secondary, "sentinel.txt")),
      Buffer.from(DESTINATION_SOURCE),
    );
  }
}
