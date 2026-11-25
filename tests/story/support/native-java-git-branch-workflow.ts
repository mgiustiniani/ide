import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { NativeDesktopApplication } from "./native-desktop-application.js";
import { pasteNativeText, readNativeCopiedText } from "./native-text-input.js";
import type { NativeEditorSurface } from "./native-editor-surface.js";

const TARGET = "fixture/extra-module";
const ORIGINAL = "fixture-original";
const MERGE_REVIEW = "fixture/merge-review";
const REBASE_REVIEW = "fixture/rebase-review";
const LOCAL_REBASE_COMMENT = "// Local Java change for reviewed rebase\n";
const EXTRA_SOURCE =
  'package pkg;\npublic final class BranchOnly { public static String value() { return "branch-only"; } }\n';

interface GitWorkflowDependencies {
  app: NativeDesktopApplication;
  surface: NativeEditorSurface;
  synchronize(): Promise<void>;
  runTests(): Promise<void>;
}

/** Real Git, public IDE controls and provider-owned build-tool context; private fixture only. */
export class NativeJavaGitBranchWorkflow {
  readonly proof = {
    repositoryRootVerified: false,
    initialContextAvailable: false,
    initialProjectModelLoaded: false,
    firstSwitchRetiredContext: false,
    firstSwitchReloadedSource: false,
    extraModuleAfterResynchronization: false,
    extraSourceOwnershipResolved: false,
    extraDeclarationNavigated: false,
    synchronizedTestsPassed: false,
    targetContextAvailableBeforeReturn: false,
    returnSwitchRetiredContext: false,
    originalModuleCatalogRestored: false,
    originalInputsRestored: false,
    mergeRetiredContext: false,
    mergedCatalogAndOwnershipQualified: false,
    mergedTestsPassed: false,
    abortRetiredContext: false,
    abortedCatalogRestored: false,
    repeatedMergeRetiredContext: false,
    mergeCommitParentsVerified: false,
    mergeReturnRetiredContext: false,
    mergeOriginalInputsRestored: false,
  };
  readonly rebaseProof = {
    localBranchContextAvailable: false,
    conflictRetiredContext: false,
    abortRetiredContext: false,
    abortRestoredSixModules: false,
    repeatedConflictRetiredContext: false,
    resolvedContextAvailableBeforeContinue: false,
    continueRetiredContext: false,
    rewrittenParentVerified: false,
    rewrittenOwnershipAndNavigation: false,
    rewrittenTestsPassed: false,
    returnRetiredContext: false,
    originalInputsAndReferencesRestored: false,
  };
  readonly rebaseGradleEvaluationChecks: { phase: string; before: number; after: number }[] = [];
  readonly changedSource: string;
  readonly gradleEvaluationChecks: { phase: string; before: number; after: number }[] = [];
  private get extra() {
    return `${this.tool}/branch-extra/src/main/java/pkg/BranchOnly.java`;
  }
  private async evaluationCount() {
    const tracePath = process.env.IDE_JAVA_CONTEXT_TRACE_PATH;
    assert(
      tracePath && path.isAbsolute(tracePath),
      "The Gradle branch workflow requires native project-context tracing.",
    );
    return (await readFile(tracePath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details?.method === "project.sync" &&
          entry.details?.params?.buildSystem === "gradle",
      ).length;
  }
  constructor(
    readonly root: string,
    readonly source: string,
    readonly inputs: ReadonlyMap<string, string>,
    readonly tool: "maven" | "gradle" = "maven",
  ) {
    assert(path.isAbsolute(root));
    this.changedSource =
      inputs.get(source)! +
      `// Active Git branch: extra ${tool === "maven" ? "Maven" : "Gradle"} module\n`;
  }
  private file(relative: string) {
    return path.join(this.root, relative);
  }
  private async git(args: string[]) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
    return (
      await promisify(execFile)("/usr/bin/git", args, {
        cwd: this.root,
        env,
        timeout: 15000,
        maxBuffer: 1048576,
      })
    ).stdout;
  }
  async prepare() {
    await assert.rejects(access(this.file(".git")));
    await this.git(["-c", "init.templateDir=", "init", "--quiet", "--initial-branch=" + ORIGINAL]);
    for (const [key, value] of [
      ["user.name", "Private Java Git fixture"],
      ["user.email", "fixture@example.invalid"],
      ["commit.gpgsign", "false"],
      ["core.autocrlf", "false"],
      ["core.hooksPath", ".git/hooks"],
    ])
      await this.git(["config", key!, value!]);
    await writeFile(
      this.file(".gitignore"),
      ".ide/\n**/target/\n**/products/\n**/build/\n**/.gradle/\n**/gui-proof-*.txt\n",
      { flag: "wx" },
    );
    await this.git(["add", "--", ".gitignore", ...this.inputs.keys()]);
    await this.git(["commit", "--quiet", "-m", "Original private Java reactor"]);
    await this.git(["switch", "--quiet", "-c", TARGET]);
    const descriptor = this.tool === "maven" ? "maven/pom.xml" : "gradle/settings.gradle";
    const moduleBuild = `${this.tool}/branch-extra/${this.tool === "maven" ? "pom.xml" : "build.gradle"}`;
    const originalDescriptor = this.inputs.get(descriptor)!;
    if (this.tool === "maven") assert(originalDescriptor.includes("</modules>"));
    await writeFile(
      this.file(descriptor),
      this.tool === "maven"
        ? originalDescriptor.replace("</modules>", "<module>branch-extra</module></modules>")
        : originalDescriptor + "include 'branch-extra'\n",
    );
    await mkdir(path.dirname(this.file(this.extra)), { recursive: true });
    await writeFile(this.file(this.extra), EXTRA_SOURCE, { flag: "wx" });
    await writeFile(
      this.file(moduleBuild),
      this.tool === "maven"
        ? '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>ide.reference</groupId><artifactId>java-effective-project</artifactId><version>1.0</version><relativePath>../pom.xml</relativePath></parent><artifactId>branch-extra</artifactId></project>\n'
        : "// Java-library settings are inherited from the root project.\n",
      { flag: "wx" },
    );
    await writeFile(this.file(this.source), this.changedSource);
    await this.git(["add", "--", descriptor, this.source, moduleBuild, this.extra]);
    await this.git(["commit", "--quiet", "-m", `Additional ${this.tool} module on private branch`]);
    await this.git(["switch", "--quiet", ORIGINAL]);
    await this.git(["switch", "--quiet", "-c", REBASE_REVIEW]);
    await writeFile(this.file(this.source), this.inputs.get(this.source)! + LOCAL_REBASE_COMMENT);
    await this.git(["add", "--", this.source]);
    await this.git(["commit", "--quiet", "-m", "Local Java change for reviewed rebase"]);
    await this.git(["switch", "--quiet", ORIGINAL]);
    for (const [file, text] of this.inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
  }
  private async inspectExtra(dependencies: GitWorkflowDependencies) {
    const { app, surface } = dependencies,
      browser = app.browser();
    const context = () => browser.$('section[aria-label="Java project context"]');
    const structure = () => context().$(".//details[summary='Saved source structure']");
    const scan = async () => {
      if ((await structure().getAttribute("open")) === null) await structure().$("summary").click();
      await structure().$("button=Refresh").click();
      await browser.waitUntil(
        () => structure().$('button[aria-label^="Open type pkg.Runner at "]').isExisting(),
        { timeout: 20000 },
      );
    };
    const selector = context().$("label=Module and source set").$("select");
    const options = await selector.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const extra = labels.find((label) =>
      label.startsWith(`${this.tool === "maven" ? "Maven" : "Gradle"} · branch-extra · main (`),
    );
    assert(extra, labels.join(", "));
    this.proof.extraModuleAfterResynchronization = true;
    await selector.selectByVisibleText(extra);
    const details = context().$(".//details[summary='Inspect source ownership']");
    if ((await details.getAttribute("open")) === null) await details.$("summary").click();
    await pasteNativeText(
      app,
      context().$('input[placeholder="pkg/Runner.java"]'),
      "pkg/BranchOnly.java",
    );
    await pasteNativeText(app, context().$('input[placeholder="pkg.Runner"]'), "pkg.BranchOnly");
    await context().$("button=Resolve source ownership").click();
    await browser.waitUntil(async () => (await context().getText()).includes(this.extra), {
      timeout: 20000,
    });
    this.proof.extraSourceOwnershipResolved = true;
    await scan();
    const declaration = structure().$('button[aria-label^="Open type pkg.BranchOnly at "]');
    await declaration.waitForDisplayed({ timeout: 5000 });
    assert.match(
      (await declaration.getAttribute("aria-label")) ?? "",
      /(?:maven|gradle)\/branch-extra\/src\/main\/java\/pkg\/BranchOnly\.java:2$/,
    );
    await declaration.scrollIntoView({ block: "center", inline: "center" });
    const label = await declaration.getAttribute("aria-label");
    const point = await browser.execute((label) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
      ).find((el) => el.getAttribute("aria-label") === label);
      if (!button) throw new Error("The provider declaration button is unavailable.");
      const bounds = button.getBoundingClientRect();
      const x = Math.round(bounds.left + bounds.width / 2),
        y = Math.round(bounds.top + bounds.height / 2);
      if (document.elementFromPoint(x, y)?.closest("button") !== button)
        throw new Error("The provider declaration button is covered at its center.");
      return { x, y };
    }, label);
    await browser
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    await surface.assertBuffer(this.extra, EXTRA_SOURCE);
    await surface.assertDirty(this.extra, false);
    const host = browser.$('[data-testid="monaco-code-editor-host"]');
    await browser.waitUntil(
      async () => (await host.getAttribute("data-editor-cursor-line")) === "2",
      { timeout: 5000 },
    );
    this.proof.extraDeclarationNavigated = true;
    await surface.tab(this.extra).$(`button[aria-label="Close ${this.extra}"]`).click();
    await surface.tab(this.source).click();
  }
  async exercise(dependencies: GitWorkflowDependencies) {
    const { app, surface } = dependencies,
      browser = app.browser();
    const context = () => browser.$('section[aria-label="Java project context"]');
    const git = () => browser.$('section[aria-label="Git source control"]');
    const structure = () => context().$(".//details[summary='Saved source structure']");
    const scan = async () => {
      if ((await structure().getAttribute("open")) === null) await structure().$("summary").click();
      await structure().$("button=Refresh").click();
      await browser.waitUntil(
        () => structure().$('button[aria-label^="Open type pkg.Runner at "]').isExisting(),
        { timeout: 20000 },
      );
    };
    assert((await context().getText()).includes("Effective project context"));
    assert(!(await context().getText()).includes("branch-extra"));
    this.proof.initialContextAvailable = true;
    await scan();
    assert.equal(
      await structure().$('button[aria-label^="Open type pkg.BranchOnly at "]').isExisting(),
      false,
    );
    this.proof.initialProjectModelLoaded = true;
    await browser.$('[role="tab"][aria-label="Files"]').click();
    const parts = this.source.split("/");
    for (let count = 1; count < parts.length; count++) {
      const folder = browser.$(`[role="treeitem"][data-path="${parts.slice(0, count).join("/")}"]`);
      await folder.waitForDisplayed({ timeout: 5000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    await surface.open(this.source, this.inputs.get(this.source)!);
    await surface.assertDirty(this.source, false);
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await git().$('input[type="checkbox"]').click();
    const refresh = async () => {
      await git().$("button=Refresh Git").click();
      await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
      assert((await git().getText()).includes(this.root));
    };
    await refresh();
    assert.equal((await this.git(["rev-parse", "--show-toplevel"])).trim(), this.root);
    this.proof.repositoryRootVerified = true;
    const afterSourceChange = async (expected: string, phase: string, evaluations?: number) => {
      await surface.assertBuffer(this.source, expected);
      await surface.assertDirty(this.source, false);
      assert.equal(await readFile(this.file(this.source), "utf8"), expected);
      await browser.$('[role="tab"][aria-label="Java Project"]').click();
      assert(!(await context().getText()).includes("Effective project context"));
      assert.equal(await context().$("button=Resolve source ownership").isExisting(), false);
      assert.equal(
        await structure().$('button[aria-label^="Open type pkg.BranchOnly at "]').isExisting(),
        false,
      );
      if (evaluations !== undefined) {
        const after = await this.evaluationCount();
        assert.equal(
          after,
          evaluations,
          "A Git source operation must not evaluate Gradle build code.",
        );
        this.gradleEvaluationChecks.push({ phase, before: evaluations, after });
      }
    };
    const change = async (branch: string, expected: string) => {
      const evaluations = this.tool === "gradle" ? await this.evaluationCount() : undefined;
      if (evaluations !== undefined)
        assert(evaluations > 0, "The initial Gradle context needs an explicit synchronization.");
      await git().$('select[aria-label="Target Git branch"]').selectByAttribute("value", branch);
      await git().$("button=Switch local branch").click();
      await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
      assert.equal((await this.git(["symbolic-ref", "--short", "HEAD"])).trim(), branch);
      await afterSourceChange(expected, branch, evaluations);
    };
    await change(TARGET, this.changedSource);
    this.proof.firstSwitchRetiredContext = true;
    this.proof.firstSwitchReloadedSource = true;
    await dependencies.synchronize();
    const inspectExtra = () => this.inspectExtra(dependencies);
    await inspectExtra();
    await dependencies.runTests();
    this.proof.synchronizedTestsPassed = true;
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await dependencies.synchronize();
    assert((await context().getText()).includes("Effective project context"));
    assert((await context().getText()).includes("branch-extra"));
    this.proof.targetContextAvailableBeforeReturn = true;
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await refresh();
    await change(ORIGINAL, this.inputs.get(this.source)!);
    this.proof.returnSwitchRetiredContext = true;
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    await assert.rejects(access(this.file(this.extra)));
    this.proof.originalModuleCatalogRestored = true;
    for (const [file, text] of this.inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
    this.proof.originalInputsRestored = true;

    // The review branch keeps the original fixture branch and its build inputs intact.
    const originalHead = (await this.git(["rev-parse", "HEAD"])).trim();
    const targetHead = (await this.git(["rev-parse", `refs/heads/${TARGET}`])).trim();
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await refresh();
    await pasteNativeText(app, git().$('input[aria-label="New Git branch name"]'), MERGE_REVIEW);
    await git().$("button=Create local branch").click();
    await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
    await change(MERGE_REVIEW, this.inputs.get(this.source)!);
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    const startMerge = async (phase: string) => {
      const evaluations = this.tool === "gradle" ? await this.evaluationCount() : undefined;
      await browser.$('[role="tab"][aria-label="Git"]').click();
      await refresh();
      await git().$('select[aria-label="Git branch to merge"]').selectByAttribute("value", TARGET);
      await git().$("button=Start reviewed merge").click();
      await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
      assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), originalHead);
      assert.equal((await this.git(["rev-parse", "MERGE_HEAD"])).trim(), targetHead);
      assert((await git().getText()).includes("Merge in progress"));
      await afterSourceChange(this.changedSource, phase, evaluations);
    };
    await startMerge("merge-before-abort");
    this.proof.mergeRetiredContext = true;
    await dependencies.synchronize();
    await inspectExtra();
    this.proof.mergedCatalogAndOwnershipQualified = true;
    await dependencies.runTests();
    this.proof.mergedTestsPassed = true;
    const evaluations = this.tool === "gradle" ? await this.evaluationCount() : undefined;
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await refresh();
    assert.equal(await git().$("button=Abort reviewed merge").isEnabled(), false);
    await git().$('input[aria-label="Discard saved merge resolutions on abort"]').click();
    await git().$("button=Abort reviewed merge").click();
    await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), originalHead);
    assert.equal(await this.git(["diff", "--cached", "--name-only"]), "");
    await afterSourceChange(this.inputs.get(this.source)!, "merge-abort", evaluations);
    this.proof.abortRetiredContext = true;
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    await assert.rejects(access(this.file(this.extra)));
    this.proof.abortedCatalogRestored = true;
    await startMerge("merge-before-commit");
    this.proof.repeatedMergeRetiredContext = true;
    await dependencies.synchronize();
    await inspectExtra();
    await dependencies.runTests();
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await refresh();
    await pasteNativeText(
      app,
      git().$('textarea[aria-label="Git commit message"]'),
      `Reviewed ${this.tool} module merge`,
    );
    assert.equal(await git().$("button=Commit staged changes").isEnabled(), false);
    await git().$("button=Review all staged changes").click();
    await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
    await git().$("button=Commit staged changes").waitForEnabled({ timeout: 5000 });
    await git().$("button=Commit staged changes").click();
    await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
    const parents = (await this.git(["rev-list", "--parents", "-1", "HEAD"])).trim().split(/\s+/);
    assert.deepEqual(parents.slice(1), [originalHead, targetHead]);
    this.proof.mergeCommitParentsVerified = true;
    await refresh();
    await change(ORIGINAL, this.inputs.get(this.source)!);
    this.proof.mergeReturnRetiredContext = true;
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    await assert.rejects(access(this.file(this.extra)));
    assert.equal((await this.git(["rev-parse", `refs/heads/${ORIGINAL}`])).trim(), originalHead);
    assert.equal((await this.git(["rev-parse", `refs/heads/${TARGET}`])).trim(), targetHead);
    for (const [file, text] of this.inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
    this.proof.mergeOriginalInputsRestored = true;
  }
  async exerciseRebase(dependencies: GitWorkflowDependencies) {
    const { app, surface } = dependencies,
      browser = app.browser();
    await browser.$('[role="tab"][aria-label="Files"]').click();
    if (!(await surface.tab(this.source).isExisting())) {
      const parts = this.source.split("/");
      for (let count = 1; count < parts.length; count++) {
        const folder = browser.$(
          `[role="treeitem"][data-path="${parts.slice(0, count).join("/")}"]`,
        );
        await folder.waitForDisplayed({ timeout: 5000 });
        if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
      }
      await surface.open(this.source, this.inputs.get(this.source)!, "clipboard");
    }
    await surface.tab(this.source).click();
    await browser.$('[role="tab"][aria-label="Git"]').click();
    const trust = browser.$('section[aria-label="Git source control"]').$('input[type="checkbox"]');
    if (!(await trust.isSelected())) await trust.click();
    const git = () => browser.$('section[aria-label="Git source control"]');
    const context = () => browser.$('section[aria-label="Java project context"]');
    const structure = () => context().$(".//details[summary='Saved source structure']");
    const localSource = this.inputs.get(this.source)! + LOCAL_REBASE_COMMENT;
    const resolvedSource = this.changedSource + LOCAL_REBASE_COMMENT;
    const originalHead = (await this.git(["rev-parse", `refs/heads/${ORIGINAL}`])).trim();
    const targetHead = (await this.git(["rev-parse", `refs/heads/${TARGET}`])).trim();
    const localHead = (await this.git(["rev-parse", `refs/heads/${REBASE_REVIEW}`])).trim();
    const idle = async () => {
      await browser.waitUntil(() => git().$("button=Refresh Git").isEnabled(), { timeout: 35000 });
    };
    const refresh = async () => {
      await git().$("button=Refresh Git").click();
      await idle();
    };
    const evaluationCount = async () =>
      this.tool === "gradle" ? this.evaluationCount() : undefined;
    const retired = async (expected: string, phase: string, before?: number) => {
      await surface.assertBuffer(this.source, expected, "clipboard");
      await surface.assertDirty(this.source, false);
      assert.equal(await readFile(this.file(this.source), "utf8"), expected);
      await browser.$('[role="tab"][aria-label="Java Project"]').click();
      assert(!(await context().getText()).includes("Effective project context"));
      assert.equal(await context().$("button=Resolve source ownership").isExisting(), false);
      assert.equal(
        await structure().$('button[aria-label^="Open type pkg.BranchOnly at "]').isExisting(),
        false,
      );
      if (before !== undefined) {
        const after = await this.evaluationCount();
        assert.equal(after, before, "Rebase must not evaluate Gradle build code");
        this.rebaseGradleEvaluationChecks.push({ phase, before, after });
      }
    };
    const switchBranch = async (name: string, expected: string) => {
      const before = await evaluationCount();
      await browser.$('[role="tab"][aria-label="Git"]').click();
      await refresh();
      await git().$('select[aria-label="Target Git branch"]').selectByAttribute("value", name);
      await git().$("button=Switch local branch").click();
      await idle();
      assert.equal((await this.git(["symbolic-ref", "--short", "HEAD"])).trim(), name);
      await retired(expected, `rebase-switch-${name}`, before);
    };
    await switchBranch(REBASE_REVIEW, localSource);
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    this.rebaseProof.localBranchContextAvailable = true;
    const start = async (phase: string) => {
      const before = await evaluationCount();
      await browser.$('[role="tab"][aria-label="Git"]').click();
      await refresh();
      await git().$('select[aria-label="Git rebase upstream"]').selectByAttribute("value", TARGET);
      await git().$("button=Review local rebase").click();
      await idle();
      assert(
        (await git().$('section[aria-label="Git rebase history review"]').getText()).includes(
          "Local Java change for reviewed rebase",
        ),
      );
      assert.equal(await git().$("button=Start reviewed rebase").isEnabled(), false);
      await git().$('input[aria-label="Acknowledge local history rewrite"]').click();
      await git().$("button=Start reviewed rebase").click();
      await idle();
      assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), targetHead);
      assert((await git().getText()).includes("Rebase paused"));
      const conflict = await readFile(this.file(this.source), "utf8");
      assert.match(conflict, /<<<<<<< HEAD/);
      await retired(conflict, phase, before);
    };
    await start("rebase-first-conflict");
    this.rebaseProof.conflictRetiredContext = true;
    const beforeAbort = await evaluationCount();
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await git().$('input[aria-label="Discard saved rebase resolutions on abort"]').click();
    await git().$("button=Abort reviewed rebase").click();
    await idle();
    assert.equal((await this.git(["rev-parse", "HEAD"])).trim(), localHead);
    await retired(localSource, "rebase-abort", beforeAbort);
    this.rebaseProof.abortRetiredContext = true;
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    await assert.rejects(access(this.file(this.extra)));
    this.rebaseProof.abortRestoredSixModules = true;
    await start("rebase-repeated-conflict");
    this.rebaseProof.repeatedConflictRetiredContext = true;
    await pasteNativeText(app, surface.input(this.source), resolvedSource, {
      focus: () => surface.focus(this.source),
      verify: async () => (await readNativeCopiedText(app)) === resolvedSource,
    });
    await surface.assertBuffer(this.source, resolvedSource, "clipboard");
    await surface.assertDirty(this.source, true);
    await surface.save(this.source);
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await refresh();
    await git().$(`button[aria-label="Review saved changes in ${this.source}"]`).click();
    await git().$("button=Stage reviewed saved file").waitForEnabled({ timeout: 5000 });
    await git().$("button=Stage reviewed saved file").click();
    await idle();
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await dependencies.synchronize();
    await this.inspectExtra(dependencies);
    this.rebaseProof.resolvedContextAvailableBeforeContinue = true;
    const beforeContinue = await evaluationCount();
    await browser.$('[role="tab"][aria-label="Git"]').click();
    await refresh();
    assert.equal(await git().$("button=Continue reviewed rebase").isEnabled(), false);
    await git().$("button=Review all staged changes").click();
    await idle();
    await git().$("button=Continue reviewed rebase").click();
    await idle();
    assert.notEqual((await this.git(["rev-parse", "HEAD"])).trim(), localHead);
    assert.equal((await this.git(["rev-parse", "HEAD^"])).trim(), targetHead);
    assert.equal(
      (await this.git(["log", "-1", "--format=%s"])).trim(),
      "Local Java change for reviewed rebase",
    );
    assert.equal((await this.git(["symbolic-ref", "--short", "HEAD"])).trim(), REBASE_REVIEW);
    this.rebaseProof.rewrittenParentVerified = true;
    await retired(resolvedSource, "rebase-continue", beforeContinue);
    this.rebaseProof.continueRetiredContext = true;
    await dependencies.synchronize();
    await this.inspectExtra(dependencies);
    this.rebaseProof.rewrittenOwnershipAndNavigation = true;
    await dependencies.runTests();
    this.rebaseProof.rewrittenTestsPassed = true;
    await switchBranch(ORIGINAL, this.inputs.get(this.source)!);
    this.rebaseProof.returnRetiredContext = true;
    await dependencies.synchronize();
    assert(!(await context().getText()).includes("branch-extra"));
    for (const [file, text] of this.inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
    assert.equal((await this.git(["rev-parse", `refs/heads/${ORIGINAL}`])).trim(), originalHead);
    assert.equal((await this.git(["rev-parse", `refs/heads/${TARGET}`])).trim(), targetHead);
    await assert.rejects(access(this.file(this.extra)));
    this.rebaseProof.originalInputsAndReferencesRestored = true;
  }
}
