import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText, readNativeCopiedText } from "./native-text-input.js";

const REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";
const ROOT = "src/main/java";
const NAME = "example.app";
const DESCRIPTOR = `module ${NAME} { exports example; }\n`;
const EXISTING = `package example;

public final class Existing {
  private int value = 1;
  public int repeat(int count) { return value + count; }
  public String repeat(String text) { return text; }
  public static class Nested {
    public int answer() { return 42; }
  }
}
`;
const EXISTING_PATH = `${ROOT}/example/Existing.java`;
const OUTLINE_DRAFT = EXISTING.replace("  private int value", "  // 😀 unsaved structure probe\n  private int value")
  .replace(/\n\}\n$/u, "\n  public int draftOnly() { return 7; }\n}\n");
const CREATED = "package other.orders;\n\npublic class Created {\n}\n";
const CREATED_PATH = `${ROOT}/other/orders/Created.java`;
const NOTES = "Modular source notes\n";
const DRAFT = NOTES + "unsaved developer note\n";

export class NativeJavaModularSourceCreationSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #tool: "Maven" | "Gradle" = "Maven";
  #sdk = "";
  #generatedRoot = "";
  #daemon = "";
  #inputs: Array<[string, string]> = [];
  #failure?: unknown;
  #oracle?: { stdout: string; stderr: string };
  #proof = {
    requirement: REQUIREMENT, nativeGui: true, packagedApplication: false,
    moduleMetadataAvailable: false, compactRejected: false, unnamedTypeRejected: false,
    refusedInputsPreserved: false, packagedDraftAccepted: false, diskInitiallyEmpty: false,
    capturedDraftCompiled: false, namedModuleResolved: false, onlyCreatedTypeSaved: false,
    notesDraftPreserved: false, noWorkspaceCompilation: false, inputsPreserved: false,
    cleanExit: false, environmentRestored: false,
    existingTargetRefused: false, packageDirectoriesCreated: false, packageTreeVisible: false,
    wizardOpenedInExistingPackage: false, destinationPreviewMatched: false,
    generatedSourceNoticeVisible: false, generatedSourceCancellationPreservedInputs: false,
    projectStructureDraftOnlySymbol: false, projectStructureNestedAndOverloads: false,
    projectStructureExactOverloadCursor: false, projectStructureNameOrder: false,
    projectStructureInputsAndDraftsPreserved: false, jdtGradleImportAuthorized: false,
  };
  evidence() { return { ...this.#proof }; }
  private file(name: string) { assert(this.#lease); return path.join(this.#lease.paths.workspace, name); }
  private browser() { assert(this.#app); return this.#app.browser(); }
  private surface() { assert(this.#app); return new NativeEditorSurface(this.#app); }
  private project() { return this.browser().$('section[aria-label="Java project context"]'); }
  async prepare(tool: string) {
    assert(tool === "Maven" || tool === "Gradle"); this.#tool = tool;
    this.#generatedRoot = tool === "Maven" ? "target/generated-sources/annotations" : "build/generated/sources/annotationProcessor/java/main";
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    assert(process.env.IDE_COMPACT_SOURCE_TEST_JDK, "Select the full project JDK25");
    this.#sdk = await realpath(process.env.IDE_COMPACT_SOURCE_TEST_JDK);
    const version = await promisify(execFile)(path.join(this.#sdk, "bin/java"), ["-version"]);
    assert.match(version.stderr, /version "25(?:\.|"|\+)/);
    assert(process.env.IDE_REAL_REFACTORKIT_DAEMON, "Select the qualified daemon");
    this.#daemon = await realpath(process.env.IDE_REAL_REFACTORKIT_DAEMON);
    this.#inputs = [
      [`${ROOT}/module-info.java`, DESCRIPTOR], [`${ROOT}/example/Existing.java`, EXISTING],
      ["notes.txt", NOTES],
      [this.#generatedRoot + "/generation-info.txt", "Generated outputs retained for source-root presentation.\n"],
      [this.#generatedRoot + "/generated/Generated.java", "package generated; public final class Generated {}\n"],
      ...(tool === "Maven" ? [["pom.xml", '<project><modelVersion>4.0.0</modelVersion><groupId>reference</groupId><artifactId>modular-source</artifactId><version>1</version><properties><maven.compiler.release>25</maven.compiler.release></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>\n']] as Array<[string, string]> : [
        ["settings.gradle", "rootProject.name = 'modular-source'\n"],
        ["build.gradle", "plugins { id 'java' }\njava { toolchain { languageVersion = JavaLanguageVersion.of(25) } }\ntasks.withType(JavaCompile).configureEach { options.release = 25 }\n"],
        ["gradle.properties", `org.gradle.daemon=false\norg.gradle.workers.max=2\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\norg.gradle.java.installations.paths=${this.#sdk}\n`],
      ] as Array<[string, string]>),
    ];
    for (const [file, text] of this.#inputs) {
      await mkdir(path.dirname(this.file(file)), { recursive: true });
      await writeFile(this.file(file), text, { flag: "wx" });
    }
    await this.#lease.assertConfiguredPathsConfined();
  }
  private async fill(selector: string, value: string) {
    const field = this.project().$(selector);
    if ((await field.getValue()) !== value) await pasteNativeText(this.#app!, field, value);
  }
  async launchAndSynchronize() {
    this.#app = new NativeDesktopApplication();
    await this.#app.launch({ IDE_JAVA_HOME: this.#sdk, JAVA_HOME: this.#sdk,
      IDE_REFACTORKIT_DAEMON: this.#daemon, IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_REFACTORKIT_ENGINE: path.join(path.dirname(this.#daemon), "refactorkit"), IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE: "1" });
    await this.#app.waitForFileExplorer();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.project().waitForDisplayed({ timeout: 10000 });
    await this.fill('input[placeholder="Full JDK directory"]', this.#sdk);
    const settings = this.project().$(`.//details[summary='${this.#tool} settings']`);
    if ((await settings.getAttribute("open")) === null) await settings.$("summary").click();
    if (this.#tool === "Gradle") {
      for (const [selector, variable] of [["#java-gradle-executable", "IDE_JAVA_CONTEXT_TEST_GRADLE"], ["#java-gradle-runtime-home", "IDE_JAVA_CONTEXT_GRADLE_JDK"], ["#java-gradle-user-home", "IDE_JAVA_CONTEXT_GRADLE_USER_HOME"]] as const) {
        const configured = process.env[variable]; assert(configured, `Set ${variable}`);
        await this.fill(selector, await realpath(configured));
      }
    } else {
      assert(process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY, "Select the Maven cache");
      await this.fill('input[placeholder="Engine default local repository"]', await realpath(process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY));
    }
    const synchronize = this.project().$(`button=${this.#tool === "Gradle" ? "Evaluate Gradle project" : "Synchronize project"}`);
    await synchronize.waitForEnabled({ timeout: 30000 }); await synchronize.click();
    await this.browser().waitUntil(async () => {
      const text = await this.project().getText();
      const error = this.project().$('[role="alert"]');
      if (await error.isExisting()) throw Error(await error.getText());
      return text.includes(`${this.#tool.toLowerCase()}-effective-v1 · available`) && text.includes("Effective project context")
        && await this.project().$("button=Synchronize project").isEnabled();
    }, { timeout: 90000, timeoutMsg: "Named-module source creation has no available context" });
    const details = this.project().$(".//details[starts-with(summary, 'Java module system')]");
    if ((await details.getAttribute("open")) === null) { await details.$("summary").scrollIntoView(); await details.$("summary").click(); }
    const request = this.project().$("button=Request Java module-system details");
    if (await request.isExisting()) { await request.scrollIntoView(); await request.waitForEnabled({ timeout: 10000 }); await request.click(); }
    await this.browser().waitUntil(async () => {
      const current = this.project().$(".//details[starts-with(summary, 'Java module system')]");
      if (!(await current.isExisting())) return false;
      if ((await current.getAttribute("open")) === null) { await current.$("summary").scrollIntoView(); await current.$("summary").click(); return false; }
      const text = await current.getText();
      return text.includes("Java module system · complete") && text.includes(`${NAME}: ${ROOT}/module-info.java`);
    }, { timeout: 30000, timeoutMsg: "RefactorKit has not supplied the declared source-set module" });
    this.#proof.moduleMetadataAvailable = true;
    await this.reveal("notes.txt"); await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
  }
  private async reveal(file: string) {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().waitUntil(async () => {
      if (await this.browser().$(`[role="treeitem"][data-path="${file}"]`).isDisplayed().catch(() => false)) return true;
      for (const node of await this.browser().$$('[role="treeitem"][aria-expanded="false"]').getElements()) {
        const relative = await node.getAttribute("data-path");
        if (relative && file.startsWith(relative + "/")) { await node.scrollIntoView(); await node.click(); return false; }
      }
      return false;
    }, { timeout: 15000, timeoutMsg: `Cannot reveal ${file}` });
  }
  async refuseAndCreate() {
    await this.reveal(this.#generatedRoot);
    const generated = this.browser().$(`[role="treeitem"][data-path="${this.#generatedRoot}"]`);
    await generated.scrollIntoView(); await generated.click({ button: "right" });
    await this.browser().$('[role="menu"]').$("button=New Java Type…").click();
    const generatedDialog = this.browser().$('[role="dialog"][aria-labelledby="file-tree-create-title"]');
    await generatedDialog.waitForDisplayed({ timeout: 5000 });
    assert.match(await generatedDialog.$('[aria-label="Generated Java sources"]').getText(), /code generation can replace its contents/);
    this.#proof.generatedSourceNoticeVisible = true;
    await pasteNativeText(this.#app!, generatedDialog.$('[aria-label="Type name"]'), "HandWritten");
    assert.equal(await generatedDialog.$('[aria-label="Java source destination"]').getText(), `Destination: ${this.#generatedRoot}/HandWritten.java`);
    await generatedDialog.$("button=Cancel").click();
    await generatedDialog.waitForDisplayed({ reverse: true, timeout: 5000 });
    await assert.rejects(access(this.file(this.#generatedRoot + "/HandWritten.java")), { code: "ENOENT" });
    await this.surface().assertDirty("notes.txt", true);
    await this.inputs(); this.#proof.generatedSourceCancellationPreservedInputs = true;
    const selectedDirectory = `${ROOT}/example`;
    await this.reveal(selectedDirectory);
    const root = this.browser().$(`[role="treeitem"][data-path="${selectedDirectory}"]`);
    await root.scrollIntoView(); await root.click({ button: "right" });
    await this.browser().$('[role="menu"]').$("button=New Java Type…").click();
    const dialog = this.browser().$('[role="dialog"][aria-labelledby="file-tree-create-title"]');
    await dialog.waitForDisplayed({ timeout: 5000 });
    assert.match(await dialog.$('[role="status"]').getText(), /Named module: example\.app/);
    assert.equal(await dialog.$('[aria-label="Package name"]').getValue(), "example");
    this.#proof.wizardOpenedInExistingPackage = true;
    const tabs = (await this.browser().$$('[role="tab"][data-path]')).length;
    await dialog.$('[aria-label="Java type"]').selectByAttribute("value", "compact-source");
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Source name"]'), "RejectedCompact");
    await dialog.$("button=Create compact source").click();
    assert.match(await dialog.$('[role="alert"]').getText(), /cannot belong to the named module 'example\.app'/);
    assert.equal(await dialog.$('[aria-label="Source name"]').getValue(), "RejectedCompact");
    await assert.rejects(access(this.file(`${ROOT}/RejectedCompact.java`)), { code: "ENOENT" });
    this.#proof.compactRejected = true;
    await dialog.$('[aria-label="Java type"]').selectByAttribute("value", "class");
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Type name"]'), "RejectedOrdinary");
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Package name"]'), "");
    assert.equal(await dialog.$('[aria-label="Package name"]').getValue(), "");
    await dialog.$("button=Create Java type").click();
    assert.match(await dialog.$('[role="alert"]').getText(), /requires a package name/);
    assert.equal(await dialog.$('[aria-label="Type name"]').getValue(), "RejectedOrdinary");
    await assert.rejects(access(this.file(`${ROOT}/RejectedOrdinary.java`)), { code: "ENOENT" });
    assert.equal((await this.browser().$$('[role="tab"][data-path]')).length, tabs);
    await this.inputs(); this.#proof.unnamedTypeRejected = true; this.#proof.refusedInputsPreserved = true;
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Type name"]'), "Existing");
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Package name"]'), "example");
    await dialog.$("button=Create Java type").click();
    assert.match(await dialog.$('[role="alert"]').getText(), /already exists/i);
    assert.equal(await dialog.$('[aria-label="Type name"]').getValue(), "Existing");
    await this.inputs(); this.#proof.existingTargetRefused = true;
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Type name"]'), "Created");
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Package name"]'), "other.orders");
    await assert.rejects(access(this.file(`${ROOT}/other/orders`)), { code: "ENOENT" });
    assert.equal(await dialog.$('[aria-label="Java source destination"]').getText(), "Destination: " + CREATED_PATH);
    this.#proof.destinationPreviewMatched = true;
    await dialog.$("button=Create Java type").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10000 });
    await this.surface().assertBuffer(CREATED_PATH, CREATED, "clipboard");
    await this.surface().assertDirty(CREATED_PATH, true);
    assert.equal(await readFile(this.file(CREATED_PATH), "utf8"), "");
    await this.surface().assertDirty("notes.txt", true);
    await assert.rejects(access(this.file(`${ROOT}/Created.java`)), { code: "ENOENT" });
    await assert.rejects(access(this.file(`${ROOT}/example/Created.java`)), { code: "ENOENT" });
    this.#proof.packageDirectoriesCreated = true;
    await this.reveal(CREATED_PATH);
    this.#proof.packageTreeVisible = true;
    this.#proof.packagedDraftAccepted = true; this.#proof.diskInitiallyEmpty = true;
  }
  async verifyAndSave() {
    await this.surface().tab(CREATED_PATH).click(); await this.surface().focus(CREATED_PATH);
    await this.browser().keys(["Control", "a"]); await this.browser().keys(["Control", "c"]);
    const captured = await readNativeCopiedText(this.#app!); assert.equal(captured, CREATED);
    assert(this.#lease); const oracle = path.join(this.#lease.paths.root, "module-draft-oracle");
    await mkdir(path.join(oracle, "classes"), { recursive: true });
    for (const [name, source] of [["module-info.java", DESCRIPTOR], ["Existing.java", EXISTING], ["Created.java", captured]]) await writeFile(path.join(oracle, name!), source!);
    await promisify(execFile)(path.join(this.#sdk, "bin/javac"), ["--release", "25", "-proc:none", "-d", "classes", "module-info.java", "Existing.java", "Created.java"], { cwd: oracle, timeout: 20000 });
    this.#proof.capturedDraftCompiled = true;
    this.#oracle = await promisify(execFile)(path.join(this.#sdk, "bin/java"), ["--module-path", "classes", "--describe-module", NAME], { cwd: oracle, timeout: 10000 });
    assert.match(this.#oracle.stdout, /exports example/); this.#proof.namedModuleResolved = true;
    for (const file of ["target/classes/other/orders/Created.class", "build/classes/java/main/other/orders/Created.class"]) await assert.rejects(access(this.file(file)), { code: "ENOENT" });
    this.#proof.noWorkspaceCompilation = true;
    await this.surface().save(CREATED_PATH); assert.equal(await readFile(this.file(CREATED_PATH), "utf8"), CREATED);
    await this.surface().assertDirty(CREATED_PATH, false);
    await this.surface().tab("notes.txt").click(); await this.surface().assertBuffer("notes.txt", DRAFT, "clipboard");
    await this.surface().assertDirty("notes.txt", true); await this.inputs();
    this.#proof.onlyCreatedTypeSaved = true; this.#proof.notesDraftPreserved = true;
  }
  async inspectProjectStructure() {
    if (this.#tool === "Gradle") {
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      await this.project().waitForDisplayed({ timeout: 5000 });
      const settings = this.project().$(".//details[summary='Gradle settings']");
      if ((await settings.getAttribute("open")) === null) { await settings.$("summary").scrollIntoView(); await settings.$("summary").click(); }
      const authorize = this.project().$("button=Allow JDT LS Gradle import for this session");
      if (await authorize.isExisting()) { await authorize.scrollIntoView(); await authorize.waitForEnabled({ timeout: 10000 }); await authorize.click(); }
      await this.project().$("button=Disable JDT LS Gradle import for this session").waitForExist({ timeout: 10000 });
      this.#proof.jdtGradleImportAuthorized = true;
    }
    await this.reveal(EXISTING_PATH);
    await this.surface().open(EXISTING_PATH, EXISTING);
    await this.surface().replace(EXISTING_PATH, OUTLINE_DRAFT);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const intelligence = this.browser().$('[aria-label="Java intelligence"]');
    const status = intelligence.$('[aria-label="Eclipse JDT LS lifecycle status"]');
    if (!["ready", "indexing", "degraded", "starting"].includes((await status.getText()).trim().toLowerCase())) {
      const start = intelligence.$("button=Start");
      await start.waitForEnabled({ timeout: 30000 }); await start.click();
    }
    await this.browser().waitUntil(async () => ["ready", "indexing", "degraded"].includes((await status.getText()).trim().toLowerCase()),
      { timeout: 60000, timeoutMsg: "The project Java language service is not ready for document symbols" });
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(this.#app!, palette.$('[aria-label="Search commands"]'), "Show Java File Structure");
    await palette.$('[role="option"][aria-label^="Show Java File Structure"]').click();
    await palette.waitForExist({ reverse: true, timeout: 5000 });
    const panel = this.browser().$('section[aria-label="Java file structure"]');
    await panel.waitForDisplayed({ timeout: 5000 });
    await panel.$('button[aria-label^="Open method draftOnly("]').waitForDisplayed({ timeout: 30000 });
    this.#proof.projectStructureDraftOnlySymbol = true;
    await panel.$('button[aria-label="Open class Nested"]').waitForDisplayed({ timeout: 5000 });
    await panel.$('button[aria-label^="Open method answer("]').waitForDisplayed({ timeout: 5000 });
    const overloads = await panel.$$('button[aria-label^="Open method repeat("]').getElements();
    assert.equal(overloads.length, 2);
    let stringOverload: typeof overloads[number] | undefined;
    for (const button of overloads) {
      const label = await button.getAttribute("aria-label");
      if (label?.includes("String")) stringOverload = button;
    }
    assert(stringOverload, "The outline must distinguish the String overload");
    this.#proof.projectStructureNestedAndOverloads = true;
    await panel.$('[aria-label="Java declaration order"]').selectByAttribute("value", "name");
    const names: string[] = [];
    for (const button of await panel.$$('button[aria-label^="Open "]').getElements()) names.push(await button.getAttribute("aria-label") ?? "");
    assert(names.findIndex(name => name.startsWith("Open method draftOnly(")) < names.findIndex(name => name.startsWith("Open field value")));
    this.#proof.projectStructureNameOrder = true;
    await pasteNativeText(this.#app!, panel.$('[aria-label="Filter Java declarations"]'), "repeat");
    await panel.$('button[aria-label="Open class Existing"]').waitForDisplayed({ timeout: 5000 });
    assert.equal(await panel.$('button[aria-label^="Open method answer("]').isExisting(), false);
    await stringOverload.click();
    const lines = OUTLINE_DRAFT.split("\n"), line = lines.findIndex(text => text.includes("public String repeat("));
    assert(line >= 0);
    const column = lines[line]!.indexOf("repeat") + 1;
    await this.browser().waitUntil(async () => (await this.browser().$('[data-testid="editor-cursor-position"]').getAttribute("aria-label")) === `Line ${line + 1}, column ${column}`,
      { timeout: 5000, timeoutMsg: "The project outline did not reveal the exact String overload in the dirty buffer" });
    this.#proof.projectStructureExactOverloadCursor = true;
    await this.surface().assertBuffer(EXISTING_PATH, OUTLINE_DRAFT, "clipboard");
    await this.surface().assertDirty(EXISTING_PATH, true);
    await this.inputs();
    await this.surface().replace(EXISTING_PATH, EXISTING, false);
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT, "clipboard");
    await this.surface().assertDirty("notes.txt", true);
    await this.inputs(); this.#proof.projectStructureInputsAndDraftsPreserved = true;
  }
  private async inputs() {
    for (const [file, source] of this.#inputs) assert.equal(await readFile(this.file(file), "utf8"), source, file);
    this.#proof.inputsPreserved = true;
  }
  async close() {
    await this.surface().tab("notes.txt").click(); await this.surface().discardUsingDisk("notes.txt", NOTES);
    await this.inputs(); await this.#app!.closeNativeWindow(); this.#proof.cleanExit = true;
  }
  async captureFailure(error: unknown) {
    this.#failure = error;
    if (!this.#lease || !this.#app) return;
    try {
      await this.browser().saveScreenshot(path.join(this.#lease.runnerArtifactPath, `modular-source-${this.#tool.toLowerCase()}-failure.png`));
      await writeFile(path.join(this.#lease.runnerArtifactPath, `modular-source-${this.#tool.toLowerCase()}-failure.json`), JSON.stringify({ error: String(error), body: await this.browser().execute(() => document.body.innerText) }, null, 2));
    } catch {}
  }
  async dispose() {
    try { await this.#app?.dispose(); }
    finally {
      await this.#lease?.dispose(); this.#proof.environmentRestored = true;
      if (this.#lease) await writeFile(path.join(this.#lease.runnerArtifactPath, `modular-source-${this.#tool.toLowerCase()}-native-evidence.json`), JSON.stringify({ ...this.#proof, buildTool: this.#tool, sdk: this.#sdk, daemon: this.#daemon, namedModule: NAME, oracle: this.#oracle, failure: this.#failure ? String(this.#failure) : null }, null, 2) + "\n");
    }
  }
}
