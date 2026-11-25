import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { access, chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";
export const GIT_WORKSPACE_REQUIREMENT = "REQ-IDE-GIT-SOURCE-CONTROL-001";
const MAIN = 'class Main { String value = "original"; }\n';
const TARGET = 'class Main { String value = "target branch"; }\n';
const SAVED = 'class Main { String value = "saved change"; }\n';
const NOTES = "saved notes\n",
  DRAFT = NOTES + "unsaved notes\n";
const HISTORY = Array.from(
  { length: 450 },
  (_, index) => `// saved history line ${index + 1}\n`,
).join("");
const SAVED_HISTORY = HISTORY.replace("// saved history line 201\n", "// local history line 201\n");
const MESSAGE = "# Native Java commit\n\nSaved staging only.\n";
export class NativeGitWorkspaceSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #failure?: unknown;
  #initialHead = "";
  #held = false;
  #history = false;
  #deletions = false;
  #branches = false;
  #merges = false;
  #rebases = false;
  #mergeStartHead = "";
  #originalBranch = "";
  #secondary = "";
  #primaryId = "";
  #secondaryId = "";
  #config: Buffer = Buffer.alloc(0);
  #proof = {
    requirement: GIT_WORKSPACE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    packagedApplication: false,
    artifactKind: "release-no-bundle",
    gitExecutable: "",
    gitVersion: "",
    trustRequired: false,
    indexPreservedBeforeAction: false,
    stageAndUnstageVerified: false,
    dirtyStageRefused: false,
    explicitStagedReviewRequired: false,
    commitVerified: false,
    hookExecuted: false,
    historyPresented: false,
    historyPaged: false,
    deletionReviewedWithoutWrites: false,
    mergedBranchDeleted: false,
    forcedBranchDeleted: false,
    deletionNameRequired: false,
    deletionForceRequired: false,
    staleDeletionRefused: false,
    deletionDraftPreserved: false,
    deletionIndexPreserved: false,
    historicalCommitReviewed: false,
    deletedPathHistoryReviewed: false,
    staleHistoryRefused: false,
    historyDraftPreserved: false,
    historyIndexPreserved: false,
    blameCommitted: false,
    blamePaged: false,
    blameUncommitted: false,
    blameStaleRefused: false,
    blameStaleLineRefused: false,
    blameDraftPreserved: false,
    blameExactSavedLineOpened: false,
    blameFullSavedBufferCopied: false,
    blameDirtyLineNavigationDisabled: false,
    draftsPreserved: false,
    configurationPreserved: false,
    trustResetAfterRestart: false,
    indexPreservedOnRestart: false,
    cleanExit: false,
    environmentRestored: false,
    mutationCloseRefused: false,
    mutationWorkspaceSwitchRefused: false,
    workspaceSwitchAfterCommit: false,
    branchCreated: false,
    inactiveBranchRenamed: false,
    currentBranchRenamedWithDraft: false,
    branchRenameCollisionRefused: false,
    dirtyBranchSwitchRefused: false,
    savedBranchSwitchRefused: false,
    cleanBranchBufferRefreshed: false,
    branchSaveBaselineUpdated: false,
    branchRoundTrip: false,
    mergeDirtyRefused: false,
    mergeConflictPresented: false,
    mergeAbortRestored: false,
    mergeResolvedCommitted: false,
    mergeJavaCompiled: false,
    rebaseHistoryReviewed: false,
    rebaseDirtyRefused: false,
    rebaseConflictPresented: false,
    rebaseAbortRestored: false,
    rebaseResolvedContinued: false,
    rebaseJavaCompiled: false,
  };
  private root() {
    assert(this.#lease);
    return this.#lease.paths.workspace;
  }
  private file(name: string) {
    return path.join(this.root(), name);
  }
  private browser() {
    assert(this.#app);
    return this.#app.browser();
  }
  private panel() {
    return this.browser().$('section[aria-label="Git source control"]');
  }
  private surface() {
    assert(this.#app);
    return new NativeEditorSurface(this.#app);
  }
  private async git(args: string[]) {
    const env = { ...process.env };
    for (const name of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_COMMON_DIR",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_PARAMETERS",
    ])
      delete env[name];
    return (
      await promisify(execFile)("/usr/bin/git", args, {
        cwd: this.root(),
        env,
        timeout: 10000,
        maxBuffer: 1048576,
      })
    ).stdout;
  }
  async prepare(held = false, branches = false) {
    this.#branches = branches;
    this.#held = held;
    this.#lease = await NativeScenarioEnvironmentLease.acquire(
      GIT_WORKSPACE_REQUIREMENT,
      held ? { workspaceName: "git-primary" } : {},
    );
    if (held) {
      this.#secondary = path.join(path.dirname(this.root()), "git-secondary");
      const workspaces = [];
      for (const [index, root] of [this.root(), this.#secondary].entries()) {
        await mkdir(path.join(root, ".ide"), { recursive: true });
        const canonical = await realpath(root),
          id = `ws-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
        if (index === 0) this.#primaryId = id;
        else this.#secondaryId = id;
        const name = index === 0 ? "git-primary" : "git-secondary",
          time = "2026-01-01T00:00:00Z";
        await writeFile(
          path.join(root, ".ide/workspace.json"),
          JSON.stringify({ id, name, path: canonical, createdAt: time, updatedAt: time }),
          { flag: "wx" },
        );
        workspaces.push({
          id,
          name,
          rootPath: canonical,
          markerFolder: ".ide",
          createdAt: time,
          lastOpenedAt: time,
        });
      }
      await writeFile(
        path.join(this.#lease.paths.ideHome, "workspaces.json"),
        JSON.stringify({ version: 1, workspaces, currentWorkspaceId: this.#primaryId }),
        { flag: "wx" },
      );
      await writeFile(path.join(this.#secondary, "sentinel.txt"), "untouched secondary source\n", {
        flag: "wx",
      });
    }
    this.#proof.gitExecutable = await realpath("/usr/bin/git");
    this.#proof.gitVersion = (await this.git(["--version"])).trim();
    for (const [name, text] of Object.entries({
      "Main.java": MAIN,
      "History.java": HISTORY,
      "notes.txt": NOTES,
      "literal café -> only.txt": "literal input\n",
      ".gitignore": ".ide/\nhook-ran\n",
    }))
      await writeFile(this.file(name), text, { flag: "wx" });
    await this.git(["-c", "init.templateDir=", "init", "--quiet"]);
    for (const [key, value] of [
      ["user.name", "Fixture Author"],
      ["user.email", "fixture@example.invalid"],
      ["commit.gpgsign", "false"],
      ["core.autocrlf", "false"],
      ["core.hooksPath", ".git/hooks"],
    ])
      await this.git(["config", key!, value!]);
    await this.git([
      "add",
      "--",
      "Main.java",
      "History.java",
      "notes.txt",
      "literal café -> only.txt",
      ".gitignore",
    ]);
    await this.git(["commit", "--quiet", "-m", "Initial private fixture"]);
    this.#initialHead = (await this.git(["rev-parse", "HEAD"])).trim();
    if (branches) {
      this.#originalBranch = (await this.git(["symbolic-ref", "--short", "HEAD"])).trim();
      await this.git(["switch", "--quiet", "-c", "feature/target"]);
      await writeFile(this.file("Main.java"), TARGET);
      await this.git(["add", "--", "Main.java"]);
      await this.git(["commit", "--quiet", "-m", "Target branch fixture"]);
      await this.git(["switch", "--quiet", this.#originalBranch]);
    }
    await writeFile(this.file("Main.java"), SAVED);
    await writeFile(this.file("History.java"), SAVED_HISTORY);
    await writeFile(this.file("unrelated.txt"), "do not stage this file\n", { flag: "wx" });
    const hook = this.file(".git/hooks/pre-commit");
    await mkdir(path.dirname(hook), { recursive: true });
    await writeFile(hook, "#!/bin/sh\nprintf ran > hook-ran\n", { flag: "wx" });
    if (held)
      await writeFile(
        hook,
        '#!/bin/sh\nprintf started > .git/hook-started\nattempt=0\nwhile [ ! -f .git/hook-release ] && [ "$attempt" -lt 200 ]; do\n  sleep 0.1\n  attempt=$((attempt + 1))\ndone\n[ -f .git/hook-release ] || exit 1\nprintf ran > hook-ran\n',
      );
    await chmod(hook, 0o700);
    this.#config = await readFile(this.file(".git/config"));
    await this.#lease.assertConfiguredPathsConfined();
  }
  async prepareMerge() {
    await this.prepare(false, true);
    this.#merges = true;
    await mkdir(this.file(".git/info"), { recursive: true });
    await writeFile(this.file(".git/info/exclude"), "unrelated.txt\n");
    await writeFile(this.file("History.java"), HISTORY);
    await writeFile(this.file("Main.java"), 'class Main { String value = "our branch"; }\n');
    await this.git(["add", "--", "Main.java"]);
    await this.git(["commit", "--quiet", "-m", "Diverging current branch"]);
    this.#mergeStartHead = (await this.git(["rev-parse", "HEAD"])).trim();
    assert.equal(await this.git(["--no-optional-locks", "status", "--porcelain=v1"]), "");
  }
  async prepareRebase() {
    await this.prepareMerge();
    this.#rebases = true;
  }
  async prepareHistory() {
    await this.prepare();
    this.#history = true;
    for (let n = 0; n < 61; n++) {
      await writeFile(this.file("Archived café.java"), `class Archived { int value = ${n}; }\n`);
      await this.git(["add", "--", "Archived café.java"]);
      await this.git([
        "commit",
        "--quiet",
        "-m",
        `Archived Java change ${String(n).padStart(3, "0")}`,
      ]);
    }
    await this.git(["rm", "--", "Archived café.java"]);
    await this.git(["commit", "--quiet", "-m", "Delete archived Java source"]);
  }
  async exerciseHistory() {
    const index = await readFile(this.file(".git/index"));
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    await this.surface().open("Main.java", SAVED);
    await this.openGit();
    assert.equal(await this.panel().$("button=Refresh Git").isEnabled(), false);
    this.#proof.trustRequired = true;
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await this.panel().$("summary=Commit history").click();
    await this.panel().$("button=Browse commit history").click();
    await this.waitIdle();
    const page = () => this.panel().$('[aria-label="Git history page"]');
    assert.equal((await page().$$("li")).length, 50);
    await this.panel().$("button=Older commits").click();
    await this.waitIdle();
    assert.equal((await page().$$("li")).length, 13);
    assert.equal(await this.panel().$("button=Older commits").isEnabled(), false);
    const rootCommit = (await this.git(["rev-list", "--max-parents=0", "HEAD"])).trim();
    await this.panel().$(`button[aria-label="Review commit ${rootCommit}"]`).click();
    await this.waitIdle();
    let patch = await this.panel().$('[aria-label="Git historical commit review"]').getText();
    assert.match(patch, /original/);
    assert.match(patch, /new file mode/);
    this.#proof.historyPaged = true;
    this.#proof.historicalCommitReviewed = true;
    await pasteNativeText(
      this.#app,
      this.panel().$('input[aria-label="Git history path"]'),
      "Archived café.java",
    );
    await this.panel().$("button=Browse commit history").click();
    await this.waitIdle();
    const deletedCommit = (await this.git(["rev-parse", "HEAD"])).trim();
    await this.panel().$(`button[aria-label="Review commit ${deletedCommit}"]`).click();
    await this.waitIdle();
    patch = await this.panel().$('[aria-label="Git historical commit review"]').getText();
    assert.match(patch, /deleted file mode/);
    assert.match(patch, /-class Archived \{ int value = 60;/);
    assert.ok(!patch.includes("notes.txt"));
    this.#proof.deletedPathHistoryReviewed = true;
    await this.panel().$('[aria-label="Git historical commit review"]').scrollIntoView();
    await this.browser().saveScreenshot(
      path.join(this.#lease!.runnerArtifactPath, "git-history-native-review.png"),
    );
    await this.surface().assertDirty("notes.txt", true);
    await this.surface().tab("notes.txt").click();
    await this.surface().focus("notes.txt");
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().tab("Main.java").click();
    await this.surface().focus("Main.java");
    await this.surface().assertBuffer("Main.java", SAVED);
    this.#proof.historyDraftPreserved = true;
    assert.deepEqual(await readFile(this.file(".git/index")), index);
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    this.#proof.historyIndexPreserved = true;
    this.#proof.configurationPreserved = true;
    // A real external commit retires the captured page; the UI must refuse paging it.
    await writeFile(this.file("new-history.txt"), "external history update\n");
    await this.git(["add", "--", "new-history.txt"]);
    await this.git(["commit", "--quiet", "-m", "External history update"]);
    await this.panel().$("button=Older commits").click();
    await this.waitIdle();
    assert.match(await this.panel().getText(), /Git state changed/);
    assert.equal(await this.panel().$('[aria-label="Git commit history"]').isExisting(), false);
    this.#proof.staleHistoryRefused = true;
    await this.surface().tab("notes.txt").click();
    await this.surface().focus("notes.txt");
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    await this.surface().assertDirty("notes.txt", false);
  }
  async prepareDeletion() {
    await this.prepare(false, true);
    this.#deletions = true;
    await this.git(["branch", "feature/merged"]);
  }
  async exerciseDeletion() {
    const index = await readFile(this.file(".git/index"));
    const head = (await this.git(["rev-parse", "HEAD"])).trim();
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    await this.surface().open("Main.java", SAVED);
    await this.openGit();
    assert.equal(await this.panel().$("button=Refresh Git").isEnabled(), false);
    this.#proof.trustRequired = true;
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    const open = async () => {
      const summary=this.panel().$("summary=Delete a local branch");
      if(await summary.parentElement().getAttribute("open")===null) await summary.click();
    };
    const choose = async (name: string) => {
      await open();
      const select = this.panel().$('select[aria-label="Git branch to delete"]');
      await select.waitForEnabled({ timeout: 5000 });
      await select.selectByAttribute("value", name);
      await this.browser().waitUntil(async () => (await select.getValue()) === name, {
        timeout: 5000,
        timeoutMsg: "The branch deletion selector did not retain the selected local branch",
      });
      const review = this.panel().$("button=Review local branch deletion");
      await review.waitForEnabled({ timeout: 5000 });
      await review.click();
      await this.waitIdle();
      await this.panel()
        .$('[aria-label="Git branch deletion review"]')
        .waitForDisplayed({ timeout: 10000 });
    };
    const confirm = () => this.panel().$('input[aria-label="Confirm local branch deletion name"]');
    const remove = () => this.panel().$("button=Delete reviewed local branch");
    await open();
    const options = await this.panel().$('select[aria-label="Git branch to delete"]').$$("option");
    const values: Array<string | null> = [];
    for (const option of options) values.push(await option.getAttribute("value"));
    assert.ok(!values.includes(this.#originalBranch));
    await choose("feature/merged");
    assert.match(
      await this.panel().$('[aria-label="Git branch deletion review"]').getText(),
      /0 commits/,
    );
    assert.equal(await remove().isEnabled(), false);
    await pasteNativeText(this.#app, confirm(), "feature/merged");
    await remove().click();
    await this.waitIdle();
    assert.equal((await this.git(["branch", "--list", "feature/merged"])).trim(), "");
    this.#proof.mergedBranchDeleted = true;
    await choose("feature/target");
    assert.match(
      await this.panel().$('[aria-label="Git branch deletion review"]').getText(),
      /1 commit/,
    );
    assert.deepEqual(await readFile(this.file(".git/index")), index);
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), head);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    this.#proof.deletionReviewedWithoutWrites = true;
    await pasteNativeText(this.#app, confirm(), "wrong-name");
    assert.equal(await remove().isEnabled(), false);
    this.#proof.deletionNameRequired = true;
    await pasteNativeText(this.#app, confirm(), "feature/target");
    assert.equal(await remove().isEnabled(), false);
    this.#proof.deletionForceRequired = true;
    await this.panel().$('input[aria-label="Allow forced local branch deletion"]').click();
    const original = (await this.git(["rev-parse", "refs/heads/feature/target"])).trim();
    const advanced = (
      await this.git([
        "commit-tree",
        `${original}^{tree}`,
        "-p",
        original,
        "-m",
        "External target branch advance",
      ])
    ).trim();
    await this.git(["branch", "-f", "feature/target", advanced]);
    await remove().click();
    await this.waitIdle();
    assert.match(await this.panel().getText(), /Git state changed/);
    assert.equal((await this.git(["rev-parse", "refs/heads/feature/target"])).trim(), advanced);
    this.#proof.staleDeletionRefused = true;
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await open();
    await choose("feature/target");
    assert.match(
      await this.panel().$('[aria-label="Git branch deletion review"]').getText(),
      /2 commits/,
    );
    assert.equal(await confirm().getValue(), "");
    assert.equal(
      await this.panel().$('input[aria-label="Allow forced local branch deletion"]').isSelected(),
      false,
    );
    await pasteNativeText(this.#app, confirm(), "feature/target");
    await this.panel().$('input[aria-label="Allow forced local branch deletion"]').click();
    await this.panel().$('[aria-label="Git branch deletion review"]').scrollIntoView();
    await this.browser().saveScreenshot(
      path.join(this.#lease!.runnerArtifactPath, "git-branch-deletion-review.png"),
    );
    await remove().click();
    await this.waitIdle();
    assert.equal((await this.git(["branch", "--list", "feature/target"])).trim(), "");
    this.#proof.forcedBranchDeleted = true;
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), head);
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    assert.deepEqual(await readFile(this.file(".git/index")), index);
    this.#proof.deletionIndexPreserved = true;
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    this.#proof.configurationPreserved = true;
    await this.surface().tab("notes.txt").click();
    await this.surface().focus("notes.txt");
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    this.#proof.deletionDraftPreserved = true;
    await this.surface().discardUsingDisk("notes.txt", NOTES);
  }
  private async openGit() {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(
      this.#app!,
      palette.$('input[aria-label="Search commands"]'),
      "Open Git Source Control",
    );
    const command = palette.$('[role="option"][aria-label^="Open Git Source Control"]');
    await command.waitForDisplayed({ timeout: 5000 });
    await command.click();
    await palette.waitForExist({ reverse: true, timeout: 5000 });
    await this.panel().waitForDisplayed({ timeout: 5000 });
  }
  private async waitIdle() {
    await this.browser().waitUntil(
      async () => await this.panel().$("button=Refresh Git").isEnabled(),
      { timeout: 35000, timeoutMsg: "Git operation did not finish within its bounded deadline." },
    );
  }
  private async reviewMain() {
    await this.panel().$('button[aria-label="Review saved changes in Main.java"]').click();
    await this.panel().$('[aria-label="Git changes review"]').waitForDisplayed({ timeout: 10000 });
    assert.match(
      await this.panel().$('[aria-label="Git changes review"]').getText(),
      /saved change/,
    );
  }
  private async stageMain() {
    await this.reviewMain();
    const stage = this.panel().$("button=Stage reviewed saved file");
    await stage.waitForEnabled({ timeout: 5000 });
    await stage.click();
    await this.waitIdle();
    await this.panel()
      .$('button[aria-label="Unstage Main.java"]')
      .waitForDisplayed({ timeout: 5000 });
  }
  async exercise() {
    const initialIndex = await readFile(this.file(".git/index"));
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    assert.equal(await this.#app.environmentValue("IDE_WORKSPACE_ROOT"), this.root());
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    await this.surface().open("Main.java", SAVED);
    await this.openGit();
    assert.equal(await this.panel().$("button=Refresh Git").isEnabled(), false);
    assert.deepEqual(await readFile(this.file(".git/index")), initialIndex);
    this.#proof.trustRequired = true;
    this.#proof.indexPreservedBeforeAction = true;
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    assert.ok((await this.panel().getText()).includes(await realpath(this.root())));
    await this.panel()
      .$('button[aria-label="Review saved changes in Main.java"]')
      .waitForDisplayed({ timeout: 5000 });
    await this.stageMain();
    assert.equal(await this.git(["diff", "--cached", "--name-only", "-z"]), "Main.java\0");
    await this.panel().$('button[aria-label="Unstage Main.java"]').click();
    await this.waitIdle();
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    this.#proof.stageAndUnstageVerified = true;
    await this.surface().focus("Main.java");
    await this.surface().replace("Main.java", SAVED + "// unsaved Java draft\n");
    await this.surface().assertDirty("Main.java", true);
    await this.reviewMain();
    assert.equal(await this.panel().$("button=Stage reviewed saved file").isEnabled(), false);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    this.#proof.dirtyStageRefused = true;
    await this.surface().discardUsingDisk("Main.java", SAVED);
    await this.stageMain();
    await pasteNativeText(
      this.#app!,
      this.panel().$('input[aria-label="Git author name"]'),
      "Native Git Fixture",
    );
    await pasteNativeText(
      this.#app!,
      this.panel().$('textarea[aria-label="Git commit message"]'),
      MESSAGE,
    );
    assert.equal(await this.panel().$("button=Commit staged changes").isEnabled(), false);
    this.#proof.explicitStagedReviewRequired = true;
    await this.panel().$("button=Review all staged changes").click();
    await this.waitIdle();
    await this.panel().$("button=Commit staged changes").waitForEnabled({ timeout: 5000 });
    assert.match(
      await this.panel().$('[aria-label="Git changes review"]').getText(),
      /saved change/,
    );
    await this.panel().$("button=Commit staged changes").click();
    await this.waitIdle();
    assert.notEqual((await this.git(["rev-parse", "HEAD"])).trim(), this.#initialHead);
    assert.equal(await this.git(["show", "HEAD:Main.java"]), SAVED);
    assert.equal(await this.git(["show", "HEAD:notes.txt"]), NOTES);
    assert.equal(await this.git(["diff", "--name-only", "HEAD^", "HEAD"]), "Main.java\n");
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    assert.ok(
      !(await this.git(["ls-files", "--cached", "-z"])).split("\0").includes("unrelated.txt"),
    );
    assert.equal(await readFile(this.file("hook-ran"), "utf8"), "ran");
    this.#proof.hookExecuted = true;
    this.#proof.commitVerified = true;
    const history = await this.panel().$('ol[aria-label="Recent Git commits"]').getText();
    assert.ok(history.includes("# Native Java commit"));
    assert.ok(history.includes("Native Git Fixture"));
    this.#proof.historyPresented = true;
    assert.equal(await this.panel().$('textarea[aria-label="Git commit message"]').getValue(), "");
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    this.#proof.configurationPreserved = true;
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    assert.equal(await readFile(this.file("notes.txt"), "utf8"), NOTES);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    this.#proof.draftsPreserved = true;
    await this.exerciseSavedBlame();
  }
  private async exerciseSavedBlame() {
    const index = await readFile(this.file(".git/index"));
    const head = (await this.git(["rev-parse", "HEAD"])).trim();
    await this.panel().$("summary=Saved-source blame").click();
    const input = this.panel().$('input[aria-label="Git blame file"]');
    await pasteNativeText(this.#app!, input, "Main.java");
    await this.panel().$("button=Blame saved file").click();
    await this.waitIdle();
    const row = (line: number) => this.panel().$(`tr[aria-label="Git blame line ${line}"]`);
    await row(1).waitForDisplayed({ timeout: 5000 });
    assert.match(await row(1).getText(), /Native Git Fixture/);
    assert.ok((await row(1).getText()).includes(head.slice(0, 12)));
    assert.ok((await row(1).getText()).includes(SAVED.trim()));
    await this.panel().$("button=Open blamed file").click();
    await this.surface().assertBuffer("Main.java", SAVED);
    await this.surface().assertDirty("Main.java", false);
    this.#proof.blameCommitted = true;
    await pasteNativeText(this.#app!, input, "History.java");
    await this.panel().$("button=Blame saved file").click();
    await this.waitIdle();
    assert.equal((await this.panel().$$('tbody tr[aria-label^="Git blame line "]')).length, 200);
    await this.panel().$("button=Next blame page").click();
    await this.waitIdle();
    await row(201).waitForDisplayed({ timeout: 5000 });
    assert.match(await row(201).getText(), /Uncommitted saved text/);
    assert.match(await row(201).getText(), /local history line 201/);
    assert.match(await row(202).getText(), /Fixture Author/);
    await row(201).$("button=201").click();
    await this.waitIdle();
    await this.surface().input("History.java").waitForDisplayed({ timeout: 5000 });
    assert.equal(await this.surface().tab("History.java").getAttribute("aria-selected"), "true");
    await this.surface().assertDirty("History.java", false);
    await this.browser().waitUntil(
      async () => /\bLn\s+201,\s*Col\s+1\b/.test(await this.browser().execute(() => document.body.innerText)),
      { timeout: 5000, timeoutMsg: "The saved blame line was not revealed at line 201" },
    );
    assert.equal(await readFile(this.file("History.java"), "utf8"), SAVED_HISTORY);
    this.#proof.blameExactSavedLineOpened = true;
    this.#proof.blamePaged = true;
    this.#proof.blameUncommitted = true;
    const beforeStatus = await this.git(["--no-optional-locks", "status", "--porcelain=v1", "-z"]);
    const changed = SAVED_HISTORY.replace(
      "// saved history line 401\n",
      "// other history line 401\n",
    );
    await writeFile(this.file("History.java"), changed);
    assert.equal(
      await this.git(["--no-optional-locks", "status", "--porcelain=v1", "-z"]),
      beforeStatus,
    );
    await row(202).$("button=202").click();
    await this.waitIdle();
    assert.match(await this.panel().$('[role="alert"]').getText(), /The saved file changed/);
    assert.equal(await this.panel().$('table[aria-label="Git blame lines"]').isExisting(), false);
    assert.equal(await input.getValue(), "History.java");
    assert.equal(await readFile(this.file("History.java"), "utf8"), changed);
    this.#proof.blameStaleRefused = true;
    this.#proof.blameStaleLineRefused = true;
    assert.match(await this.browser().execute(() => document.body.innerText), /\bLn\s+201,\s*Col\s+1\b/);
    await this.assertHistoryBufferCopied();
    await this.surface().assertDirty("History.java", false);
    await writeFile(this.file("History.java"), SAVED_HISTORY);
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await this.surface().tab("notes.txt").click();
    await this.panel().$("button=Blame active saved file").click();
    await this.waitIdle();
    assert.equal(await input.getValue(), "notes.txt");
    await row(1).waitForDisplayed({ timeout: 5000 });
    assert.match(await row(1).getText(), /saved notes/);
    assert.doesNotMatch(await row(1).getText(), /unsaved notes/);
    assert.equal((await this.panel().$$('tbody tr[aria-label^="Git blame line "]')).length, 1);
    assert.match(await this.panel().getText(), /annotation shows only its saved text/);
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    assert.deepEqual(await readFile(this.file(".git/index")), index);
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), head);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    assert.equal(await readFile(this.file("notes.txt"), "utf8"), NOTES);
    assert.equal(await row(1).$("button=1").isEnabled(), false);
    this.#proof.blameDirtyLineNavigationDisabled = true;
    this.#proof.blameDraftPreserved = true;
  }
  private async assertHistoryBufferCopied() {
    assert.ok(Buffer.byteLength(SAVED_HISTORY) <= 16 * 1024);
    await this.surface().focus("History.java");
    await this.browser().keys(["Control", "a"]);
    await this.browser().keys(["Control", "c"]);
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      ["-c", "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk, Gdk; value=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(); print(value if value is not None else '',end='')"],
      { env: { ...process.env, GDK_BACKEND: "x11" }, timeout: 5000, maxBuffer: 16 * 1024 },
    );
    assert.ok(stdout === SAVED_HISTORY, "The complete saved History.java buffer differs from its fixture");
    await this.browser().keys(["Control", "Home"]);
    this.#proof.blameFullSavedBufferCopied = true;
  }
  async restart() {
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    const index = await readFile(this.file(".git/index"));
    await this.#app!.closeWindow();
    await this.#app!.dispose();
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.openGit();
    assert.equal(await this.panel().$('input[type="checkbox"]').isSelected(), false);
    assert.equal(await this.panel().$("button=Refresh Git").isEnabled(), false);
    assert.deepEqual(await readFile(this.file(".git/index")), index);
    this.#proof.trustResetAfterRestart = true;
    this.#proof.indexPreservedOnRestart = true;
  }
  async exerciseTransitionGuards() {
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    assert.equal(await this.#app.environmentValue("IDE_WORKSPACE_ROOT"), this.root());
    await this.surface().open("Main.java", SAVED);
    await this.surface().assertDirty("Main.java", false);
    await this.openGit();
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    assert.ok((await this.panel().getText()).includes(await realpath(this.root())));
    await this.stageMain();
    await pasteNativeText(
      this.#app,
      this.panel().$('textarea[aria-label="Git commit message"]'),
      "Guarded native commit",
    );
    await this.panel().$("button=Review all staged changes").click();
    await this.waitIdle();
    await this.panel().$("button=Commit staged changes").waitForEnabled({ timeout: 5000 });
    await this.panel().$("button=Commit staged changes").click();
    await this.browser().waitUntil(
      async () => {
        try {
          await access(this.file(".git/hook-started"));
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 5000, timeoutMsg: "The real pre-commit hook did not start." },
    );
    const block =
      "Wait for the Git operation to finish before switching workspaces or closing the IDE.";
    await this.#app.requestNativeWindowClose();
    await this.surface().assertAlert(block);
    await this.#app.assertRunning();
    this.#proof.mutationCloseRefused = true;
    const secondary = () => this.browser().$('button[role="option"][title^="git-secondary"]');
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await secondary().waitForDisplayed({ timeout: 5000 });
    await secondary().click();
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('.workspace-explorer [role="alert"]').getText()).includes(block),
      { timeout: 5000, timeoutMsg: "Workspace switching did not report the pending Git mutation." },
    );
    assert.equal(await secondary().isEnabled(), true);
    const registry = () =>
      readFile(path.join(this.#lease!.paths.ideHome, "workspaces.json"), "utf8").then(
        (text) => JSON.parse(text) as { currentWorkspaceId: string },
      );
    assert.equal((await registry()).currentWorkspaceId, this.#primaryId);
    await this.surface().assertBuffer("Main.java", SAVED);
    this.#proof.mutationWorkspaceSwitchRefused = true;
    await this.browser().$('[role="tab"][aria-label="Git"]').click();
    await writeFile(this.file(".git/hook-release"), "release\n", { flag: "wx" });
    await this.waitIdle();
    assert.equal((await this.git(["log", "-1", "--format=%s"])).trim(), "Guarded native commit");
    assert.equal(await readFile(this.file("hook-ran"), "utf8"), "ran");
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await secondary().waitForDisplayed({ timeout: 5000 });
    await secondary().click();
    await this.browser().waitUntil(
      async () => (await secondary().getAttribute("aria-selected")) === "true",
      { timeout: 10000, timeoutMsg: "Workspace switching remained blocked after Git completion." },
    );
    assert.equal((await registry()).currentWorkspaceId, this.#secondaryId);
    assert.equal(
      await readFile(path.join(this.#secondary, "sentinel.txt"), "utf8"),
      "untouched secondary source\n",
    );
    this.#proof.workspaceSwitchAfterCommit = true;
  }
  async exerciseBranches() {
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    assert.equal(await this.#app.environmentValue("IDE_WORKSPACE_ROOT"), this.root());
    await this.surface().open("Main.java", SAVED);
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    await this.openGit();
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    assert.ok((await this.panel().getText()).includes(await realpath(this.root())));
    await pasteNativeText(
      this.#app,
      this.panel().$('input[aria-label="New Git branch name"]'),
      "feature/native-created",
    );
    await this.panel().$("button=Create local branch").click();
    await this.waitIdle();
    assert.equal(
      (await this.git(["rev-parse", "refs/heads/feature/native-created"])).trim(),
      this.#initialHead,
    );
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    this.#proof.branchCreated = true;
    const renameSource = this.panel().$('select[aria-label="Git branch to rename"]');
    const renameName = this.panel().$('input[aria-label="Replacement Git branch name"]');
    const renameButton = this.panel().$("button=Rename local branch");
    await renameSource.selectByAttribute("value", "feature/native-created");
    await pasteNativeText(this.#app, renameName, "feature/native-renamed");
    await renameButton.click();
    await this.waitIdle();
    assert.equal(
      (await this.git(["rev-parse", "refs/heads/feature/native-renamed"])).trim(),
      this.#initialHead,
    );
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    assert.equal((await this.git(["branch", "--list", "feature/native-created"])).trim(), "");
    this.#proof.inactiveBranchRenamed = true;
    await renameSource.selectByAttribute("value", this.#originalBranch);
    await pasteNativeText(this.#app, renameName, "feature/target");
    assert.equal(await renameButton.isEnabled(), false);
    this.#proof.branchRenameCollisionRefused = true;
    await pasteNativeText(this.#app, renameName, "feature/current-renamed");
    await renameButton.click();
    await this.waitIdle();
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      "feature/current-renamed",
    );
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    await this.surface().tab("Main.java").click();
    await this.surface().assertBuffer("Main.java", SAVED);
    await this.surface().tab("notes.txt").click();
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    await renameSource.selectByAttribute("value", "feature/current-renamed");
    await pasteNativeText(this.#app, renameName, this.#originalBranch);
    await renameButton.click();
    await this.waitIdle();
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    this.#proof.currentBranchRenamedWithDraft = true;
    const select = this.panel().$('select[aria-label="Target Git branch"]');
    await select.selectByAttribute("value", "feature/target");
    await this.panel().$("button=Switch local branch").click();
    await this.waitIdle();
    assert.match(await this.panel().$('[role="alert"]').getText(), /Save all editor buffers/);
    await this.surface().assertBuffer("notes.txt", DRAFT);
    await this.surface().assertDirty("notes.txt", true);
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    this.#proof.dirtyBranchSwitchRefused = true;
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await this.panel().$("button=Switch local branch").click();
    await this.waitIdle();
    assert.match(await this.panel().$('[role="alert"]').getText(), /Git could not complete/);
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    await this.surface().tab("Main.java").click();
    await this.surface().assertBuffer("Main.java", SAVED);
    assert.equal(await this.git(["stash", "list"]), "");
    this.#proof.savedBranchSwitchRefused = true;
    await this.surface().replace("Main.java", MAIN);
    await this.surface().save("Main.java");
    await this.surface().assertDirty("Main.java", false);
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await this.panel().$("button=Switch local branch").click();
    await this.waitIdle();
    assert.equal((await this.git(["symbolic-ref", "--short", "HEAD"])).trim(), "feature/target");
    assert.equal(await readFile(this.file("Main.java"), "utf8"), TARGET);
    await this.browser().$("button=Compare with disk").click();
    const comparison = this.browser().$('[role="dialog"][aria-modal="true"]');
    await comparison.waitForDisplayed({ timeout: 5000 });
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "git-branch-buffer-comparison.json"),
      JSON.stringify(
        {
          buffer: await comparison.$('[aria-label="Current editor buffer"]').getText(),
          disk: await comparison.$('[aria-label="Inspected disk version"]').getText(),
        },
        null,
        2,
      ),
    );
    assert.match(
      await comparison.$('[aria-label="Current editor buffer"]').getText(),
      /target branch/,
    );
    assert.match(
      await comparison.$('[aria-label="Inspected disk version"]').getText(),
      /target branch/,
    );
    await comparison.$("button=Keep editor buffer").click();
    await this.surface().assertBuffer("Main.java", TARGET);
    await this.surface().assertDirty("Main.java", false);
    this.#proof.cleanBranchBufferRefreshed = true;
    const changed = TARGET + "// explicit save after switch\n";
    await this.surface().replace("Main.java", changed);
    await this.surface().save("Main.java");
    await this.surface().assertDirty("Main.java", false);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), changed);
    this.#proof.branchSaveBaselineUpdated = true;
    await this.surface().replace("Main.java", TARGET);
    await this.surface().save("Main.java");
    await this.surface().assertDirty("Main.java", false);
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await this.panel()
      .$('select[aria-label="Target Git branch"]')
      .selectByAttribute("value", this.#originalBranch);
    await this.panel().$("button=Switch local branch").click();
    await this.waitIdle();
    await this.surface().assertBuffer("Main.java", MAIN);
    assert.equal(
      (await this.git(["symbolic-ref", "--short", "HEAD"])).trim(),
      this.#originalBranch,
    );
    await this.surface().replace("Main.java", SAVED);
    await this.surface().save("Main.java");
    await this.surface().assertDirty("Main.java", false);
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    this.#proof.branchRoundTrip = true;
  }
  async exerciseMerge() {
    const ours = 'class Main { String value = "our branch"; }\n';
    const target = (await this.git(["rev-parse", "refs/heads/feature/target"])).trim();
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.surface().open("Main.java", ours);
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    await this.openGit();
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    const start = async () => {
      await this.panel()
        .$('select[aria-label="Git branch to merge"]')
        .selectByAttribute("value", "feature/target");
      await this.panel().$("button=Start reviewed merge").click();
      await this.waitIdle();
    };
    await start();
    assert.match(await this.panel().$('[role="alert"]').getText(), /Save all editor buffers/);
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), this.#mergeStartHead);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), ours);
    await this.surface().assertBuffer("notes.txt", DRAFT);
    this.#proof.mergeDirtyRefused = true;
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await start();
    assert.equal((await this.git(["rev-parse", "MERGE_HEAD"])).trim(), target);
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), this.#mergeStartHead);
    const conflict = await readFile(this.file("Main.java"), "utf8");
    assert.match(conflict, /<<<<<<< HEAD/);
    assert.match(conflict, /target branch/);
    await this.surface().tab("Main.java").click();
    await this.surface().assertBuffer("Main.java", conflict);
    await this.surface().assertDirty("Main.java", false);
    assert.match(await this.panel().getText(), /Merge in progress/);
    this.#proof.mergeConflictPresented = true;
    await this.surface().replace("Main.java", ours + "// saved resolution to discard explicitly\n");
    await this.surface().save("Main.java");
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    assert.equal(await this.panel().$("button=Abort reviewed merge").isEnabled(), false);
    await this.panel().$('input[aria-label="Discard saved merge resolutions on abort"]').click();
    await this.panel().$("button=Abort reviewed merge").click();
    await this.waitIdle();
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), this.#mergeStartHead);
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    assert.equal(await readFile(this.file("Main.java"), "utf8"), ours);
    await this.surface().assertBuffer("Main.java", ours);
    await this.surface().assertDirty("Main.java", false);
    assert.equal(await this.panel().$("button=Abort reviewed merge").isExisting(), false);
    this.#proof.mergeAbortRestored = true;
    await start();
    await this.surface().replace("Main.java", SAVED);
    await this.surface().save("Main.java");
    await this.panel().$("button=Refresh Git").click();
    await this.waitIdle();
    await this.stageMain();
    await pasteNativeText(
      this.#app,
      this.panel().$('input[aria-label="Git author name"]'),
      "Native Merge Fixture",
    );
    await pasteNativeText(
      this.#app,
      this.panel().$('textarea[aria-label="Git commit message"]'),
      "Explicit resolved Java merge",
    );
    assert.equal(await this.panel().$("button=Commit staged changes").isEnabled(), false);
    await this.panel().$("button=Review all staged changes").click();
    await this.waitIdle();
    await this.panel().$("button=Commit staged changes").click();
    await this.waitIdle();
    const parents = (await this.git(["rev-list", "--parents", "-1", "HEAD"])).trim().split(/\s+/);
    assert.deepEqual(parents.slice(1), [this.#mergeStartHead, target]);
    assert.equal(await this.git(["show", "HEAD:Main.java"]), SAVED);
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    assert.equal(await this.panel().$("button=Abort reviewed merge").isExisting(), false);
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    await this.surface().assertBuffer("Main.java", SAVED);
    await this.surface().assertDirty("Main.java", false);
    this.#proof.mergeResolvedCommitted = true;
    const javaHome = process.env.IDE_JAVA_CONTEXT_TEST_JDK;
    assert(
      javaHome && path.isAbsolute(javaHome),
      "A selected JDK is required for real Java compilation",
    );
    const output = this.file(".ide/merge-compile");
    await mkdir(output, { recursive: true });
    await promisify(execFile)(
      path.join(javaHome, "bin/javac"),
      ["-d", output, this.file("Main.java")],
      { cwd: this.root(), timeout: 15000, maxBuffer: 65536 },
    );
    await access(path.join(output, "Main.class"));
    this.#proof.mergeJavaCompiled = true;
  }
  async exerciseRebase() {
    const ours = 'class Main { String value = "our branch"; }\n';
    const target = (await this.git(["rev-parse", "refs/heads/feature/target"])).trim();
    const originalBranch = (await this.git(["symbolic-ref", "--short", "HEAD"])).trim();
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.surface().open("Main.java", ours);
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    await this.openGit();
    await this.panel().$('input[type="checkbox"]').click();
    const idle = () => this.waitIdle();
    const refresh = async () => {
      await this.panel().$("button=Refresh Git").click();
      await idle();
    };
    await refresh();
    const review = async () => {
      const head = (await this.git(["rev-parse", "HEAD"])).trim();
      const index = await readFile(this.file(".git/index"));
      await this.panel()
        .$('select[aria-label="Git rebase upstream"]')
        .selectByAttribute("value", "feature/target");
      await this.panel().$("button=Review local rebase").click();
      await idle();
      const history = await this.panel()
        .$('section[aria-label="Git rebase history review"]')
        .getText();
      assert.ok(history.includes("Diverging current branch"));
      assert.ok(history.includes(head));
      assert.ok(history.includes(target));
      assert.equal(await this.panel().$("button=Start reviewed rebase").isEnabled(), false);
      assert.deepEqual(await readFile(this.file(".git/index")), index);
      assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), head);
      await this.panel().$('input[aria-label="Acknowledge local history rewrite"]').click();
    };
    await review();
    this.#proof.rebaseHistoryReviewed = true;
    await this.panel().$("button=Start reviewed rebase").click();
    await idle();
    assert.match(await this.panel().$('[role="alert"]').getText(), /Save all editor buffers/);
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), this.#mergeStartHead);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), ours);
    await this.surface().assertBuffer("notes.txt", DRAFT);
    this.#proof.rebaseDirtyRefused = true;
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    await refresh();
    await review();
    const start = async () => {
      await this.panel().$("button=Start reviewed rebase").click();
      await idle();
      assert.match(await this.panel().getText(), /Rebase paused/);
      assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), target);
      const conflict = await readFile(this.file("Main.java"), "utf8");
      assert.match(conflict, /<<<<<<< HEAD/);
      await this.surface().tab("Main.java").click();
      await this.surface().assertBuffer("Main.java", conflict);
      await this.surface().assertDirty("Main.java", false);
    };
    await start();
    this.#proof.rebaseConflictPresented = true;
    await this.surface().replace("Main.java", SAVED);
    await this.surface().save("Main.java");
    await refresh();
    assert.equal(await this.panel().$("button=Abort reviewed rebase").isEnabled(), false);
    await this.panel().$('input[aria-label="Discard saved rebase resolutions on abort"]').click();
    await this.panel().$("button=Abort reviewed rebase").click();
    await idle();
    assert.equal((await this.git(["symbolic-ref", "--short", "HEAD"])).trim(), originalBranch);
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), this.#mergeStartHead);
    assert.equal(await readFile(this.file("Main.java"), "utf8"), ours);
    await this.surface().assertBuffer("Main.java", ours);
    await this.surface().assertDirty("Main.java", false);
    this.#proof.rebaseAbortRestored = true;
    await review();
    await start();
    await this.surface().replace("Main.java", SAVED);
    await this.surface().save("Main.java");
    await refresh();
    await this.stageMain();
    assert.equal(await this.panel().$("button=Continue reviewed rebase").isEnabled(), false);
    await this.panel().$("button=Review all staged changes").click();
    await idle();
    await this.panel().$("button=Continue reviewed rebase").click();
    await idle();
    assert.equal(await this.panel().$("button=Abort reviewed rebase").isExisting(), false);
    assert.equal((await this.git(["symbolic-ref", "--short", "HEAD"])).trim(), originalBranch);
    assert.notEqual((await this.git(["rev-parse", "HEAD"])).trim(), this.#mergeStartHead);
    assert.equal((await this.git(["rev-parse", "HEAD^"])).trim(), target);
    assert.equal((await this.git(["log", "-1", "--format=%s"])).trim(), "Diverging current branch");
    assert.equal((await this.git(["rev-parse", "feature/target"])).trim(), target);
    assert.equal(await this.git(["show", "HEAD:Main.java"]), SAVED);
    await this.surface().assertBuffer("Main.java", SAVED);
    await this.surface().assertDirty("Main.java", false);
    assert.deepEqual(await readFile(this.file(".git/config")), this.#config);
    this.#proof.rebaseResolvedContinued = true;
    const javaHome = process.env.IDE_JAVA_CONTEXT_TEST_JDK;
    assert(javaHome && path.isAbsolute(javaHome));
    const output = this.file(".ide/rebase-compile");
    await mkdir(output, { recursive: true });
    await promisify(execFile)(
      path.join(javaHome, "bin/javac"),
      ["-d", output, this.file("Main.java")],
      { cwd: this.root(), timeout: 15000, maxBuffer: 65536 },
    );
    await access(path.join(output, "Main.class"));
    this.#proof.rebaseJavaCompiled = true;
  }
  async close() {
    await this.#app!.closeWindow();
    this.#proof.cleanExit = true;
    assert.equal(await readFile(this.file("Main.java"), "utf8"), SAVED);
    assert.equal(await readFile(this.file("notes.txt"), "utf8"), NOTES);
    assert.equal(
      await readFile(this.file("History.java"), "utf8"),
      this.#merges ? HISTORY : SAVED_HISTORY,
    );
    assert.equal(await readFile(this.file("unrelated.txt"), "utf8"), "do not stage this file\n");
  }
  evidence() {
    return { ...this.#proof };
  }
  setFailure(error: unknown) {
    this.#failure = error;
  }
  async captureFailure() {
    if (!this.#lease || !this.#app) return;
    try {
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "git-workspace-failure.png"),
      );
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "git-workspace-failure.json"),
        JSON.stringify(
          {
            error: String(this.#failure),
            body: await this.browser().execute(() => document.body.innerText),
          },
          null,
          2,
        ),
      );
    } catch {
      /* Preserve the original failure. */
    }
  }
  async dispose() {
    const artifact = this.#lease?.runnerArtifactPath;
    let failure: unknown;
    try {
      await this.#app?.dispose();
    } catch (error) {
      failure = error;
    }
    try {
      await this.#lease?.dispose();
      this.#proof.environmentRestored = true;
    } catch (error) {
      failure ??= error;
    }
    if (artifact)
      await writeFile(
        path.join(
          artifact,
          this.#deletions
            ? "git-workspace-branch-deletion-native-evidence.json"
            : this.#history
              ? "git-workspace-history-native-evidence.json"
              : this.#rebases
                ? "git-workspace-rebase-native-evidence.json"
                : this.#merges
                  ? "git-workspace-merge-native-evidence.json"
                  : this.#branches
                    ? "git-workspace-branches-native-evidence.json"
                    : this.#held
                      ? "git-workspace-transitions-native-evidence.json"
                      : "git-workspace-native-evidence.json",
        ),
        JSON.stringify(
          { ...this.#proof, failure: this.#failure ? String(this.#failure) : null },
          null,
          2,
        ) + "\n",
      );
    if (failure) throw failure;
  }
}
