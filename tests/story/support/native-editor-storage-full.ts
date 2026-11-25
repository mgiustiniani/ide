import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeEditorCheckpointJournal } from "./native-editor-checkpoint-journal.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

const ORIGINAL = "class Main { int value = 1; }\n";
const FIRST = "class Main { int value = 2; }\n";
const SECOND = "class Main { int value = 3; }\n";
const SAVE_ERROR = "The file could not be saved. Check available disk space and write permissions, or compare with disk if another tool changed it.";
const RECOVERY_ERROR = "Recovery storage is unavailable or full. The newest edits may not have a durable checkpoint; retry after checking storage.";
type Mode = "source" | "recovery";
interface Snapshot { id: string; errno?: number; error?: string; totalBytes: number; freeBytes: number; files: Record<string, string> }

export class NativeEditorStorageFullSession {
  #lease!: NativeScenarioEnvironmentLease;
  #app!: NativeDesktopApplication;
  #surface!: NativeEditorSurface;
  #control = "";
  #file = "";
  #proof: Record<string, unknown> = {};
  #failure: unknown;
  constructor(readonly mode: Mode) {}
  async prepare() {
    assert.equal(process.platform, "linux");
    await access("/usr/bin/bwrap");
    this.#lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-EDITOR-RECOVERY-001");
    const root = this.mode === "source" ? path.join(this.#lease.paths.workspace, "limited") : path.join(this.#lease.paths.ideHome, "editor-recovery");
    this.#file = this.mode === "source" ? "limited/Main.java" : "Main.java";
    if (this.mode === "recovery") await writeFile(path.join(this.#lease.paths.workspace, this.#file), ORIGINAL, { flag: "wx" });
    await mkdir(root, { recursive: true });
    this.#control = path.join(this.#lease.paths.evidence, "storage-control");
    await mkdir(this.#control);
    const config = path.join(this.#control, "config.json");
    await writeFile(config, JSON.stringify({ root, scenario: this.#lease.paths.root, control: this.#control,
      seedFiles: this.mode === "source" ? { "Main.java": ORIGINAL } : {} }), { flag: "wx" });
    this.#app = new NativeDesktopApplication(["/usr/bin/python3", path.resolve("tests/story/support/native-bounded-storage-driver.py"), config]);
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#lease.assertConfiguredPathsConfined();
  }
  private browser() { return this.#app.browser(); }
  private async probe(operation: "inspect" | "fill" | "free"): Promise<Snapshot> {
    const id = randomUUID();
    const temporary = path.join(this.#control, "request.tmp");
    await writeFile(temporary, JSON.stringify({ id, operation }));
    await rename(temporary, path.join(this.#control, "request.json"));
    let result: Snapshot | undefined;
    await this.browser().waitUntil(async () => {
      try {
        const response = JSON.parse(await readFile(path.join(this.#control, "response.json"), "utf8")) as Snapshot;
        if (response.id !== id) return false;
        result = response; return true;
      } catch { return false; }
    }, { timeout: 8_000, interval: 30, timeoutMsg: "The private filesystem probe did not answer" });
    assert.ok(result); assert.equal(result.error, undefined); assert.equal(result.totalBytes, 1048576);
    return result;
  }
  private journal(snapshot: Snapshot) {
    const text = Object.entries(snapshot.files).find(([name]) => name.endsWith("/journal.json"))?.[1];
    assert.ok(text);
    return { text, entries: (JSON.parse(text) as { entries: { id: string; content: string; kind: string }[] }).entries };
  }
  private async checkpoint() {
    const panel = this.browser().$('[aria-label="Recovery and local history"]');
    if (!(await panel.isExisting())) await this.browser().$("button=Recovery and history").click();
    await panel.waitForDisplayed({ timeout: 5_000 });
    await this.browser().$("button=Checkpoint now").click();
  }
  async exercise() {
    await this.#app.launch(); await this.#app.waitForFileExplorer();
    const ready = JSON.parse(await readFile(path.join(this.#control, "ready.json"), "utf8")) as { totalBytes: number };
    assert.equal(ready.totalBytes, 1048576);
    if (this.mode === "source") {
      const folder = this.browser().$('[role="treeitem"][data-path="limited"]');
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    await this.#surface.open(this.#file, ORIGINAL);
    await this.#surface.replace(this.#file, FIRST);
    await this.checkpoint();
    let firstId = "", initialJournal = "";
    await this.browser().waitUntil(async () => {
      try {
        const entries = this.mode === "source"
          ? await new NativeEditorCheckpointJournal(this.#lease).entries()
          : this.journal(await this.probe("inspect")).entries;
        const entry = entries.find(entry => entry.content === FIRST && entry.kind === "draft");
        if (!entry) return false;
        firstId = entry.id;
        if (this.mode === "recovery") initialJournal = this.journal(await this.probe("inspect")).text;
        return true;
      } catch { return false; }
    }, { timeout: 8_000, interval: 100, timeoutMsg: "The first real recovery checkpoint was not acknowledged" });
    const full = await this.probe("fill");
    assert.equal(full.errno, 28); assert.equal(full.freeBytes, 0);
    this.#proof.actualEnospc = full.errno; this.#proof.filesystemBytes = full.totalBytes;
    if (this.mode === "source") {
      await this.#surface.save(this.#file);
      await this.#surface.assertAlert(SAVE_ERROR);
      await this.#surface.assertBuffer(this.#file, FIRST); await this.#surface.assertDirty(this.#file, true);
      const inspected = await this.probe("inspect");
      assert.equal(inspected.files["Main.java"], ORIGINAL);
      assert.ok(!Object.keys(inspected.files).some(name => name.startsWith(".ide-save-")));
      assert.equal((await new NativeEditorCheckpointJournal(this.#lease).entries()).find(entry => entry.id === firstId)?.content, FIRST);
      this.#proof.failedSourceSavePreservedDiskBufferCheckpoint = true;
      await this.probe("free"); await this.#surface.save(this.#file);
      await this.#surface.assertDirty(this.#file, false);
      assert.equal((await this.probe("inspect")).files["Main.java"], FIRST);
      this.#proof.sourceSaveRetrySucceeded = true;
    } else {
      await this.#surface.replace(this.#file, SECOND); await this.checkpoint();
      await this.#surface.assertAlert(RECOVERY_ERROR);
      await this.#surface.assertBuffer(this.#file, SECOND); await this.#surface.assertDirty(this.#file, true);
      const inspected = await this.probe("inspect");
      assert.equal(this.journal(inspected).text, initialJournal);
      assert.ok(!Object.keys(inspected.files).some(name => name.endsWith(".tmp")));
      assert.equal(await readFile(path.join(this.#lease.paths.workspace, this.#file), "utf8"), ORIGINAL);
      this.#proof.failedCheckpointPreservedPreviousJournalAndNewestBuffer = true;
      await this.#surface.save(this.#file); await this.#surface.assertDirty(this.#file, false);
      assert.equal(await readFile(path.join(this.#lease.paths.workspace, this.#file), "utf8"), SECOND);
      assert.equal(this.journal(await this.probe("inspect")).text, initialJournal);
      this.#proof.explicitSourceSaveWhileRecoveryFullSucceeded = true;
      await this.probe("free"); await this.checkpoint();
      await this.browser().waitUntil(async () => {
        const entries = this.journal(await this.probe("inspect")).entries;
        return entries.some(entry => entry.id === firstId && entry.content === FIRST && entry.kind === "history") && !entries.some(entry => entry.kind === "draft");
      }, { timeout: 8_000, interval: 100 });
      this.#proof.checkpointRetryPreservedEarlierHistory = true;
    }
    await this.#surface.replace(this.#file, ORIGINAL); await this.#surface.save(this.#file);
    await this.#surface.assertDirty(this.#file, false);
    if (this.mode === "source") assert.equal((await this.probe("inspect")).files["Main.java"], ORIGINAL);
    else assert.equal(await readFile(path.join(this.#lease.paths.workspace, this.#file), "utf8"), ORIGINAL);
    this.#proof.originalSourceRestoredThroughEditor = true;
  }
  assertBehavior() { assert.equal(this.#proof.actualEnospc, 28); assert.equal(this.#proof.originalSourceRestoredThroughEditor, true); }
  async close() {
    await this.#app.closeNativeWindow(); await this.#app.assertExited();
    this.#proof.cleanExit = true;
  }
  async dispose(error?: unknown) {
    this.#failure = error;
    if (error) {
      try { await this.browser().saveScreenshot(path.join(this.#lease.runnerArtifactPath, `storage-full-${this.mode}-failure.png`)); } catch { /* Preserve the original failure. */ }
    }
    try { await this.#app?.dispose(); }
    finally {
      await this.#lease?.dispose();
      if (this.#lease) await writeFile(path.join(this.#lease.runnerArtifactPath, `storage-full-${this.mode}-evidence.json`), JSON.stringify({ mode: this.mode, ...this.#proof, application: this.#app?.evidence(), lease: this.#lease.evidence(), failure: this.#failure ? String(this.#failure) : null }, null, 2));
    }
  }
}
