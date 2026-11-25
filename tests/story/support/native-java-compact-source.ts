import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { pasteNativeText, readNativeCopiedText } from "./native-text-input.js";
import { readNativeJavaExecutionStatuses } from "./native-java-execution-status.js";
const REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";
const ROOT = "src/main/java";
const FILE = ROOT + "/record.java";
const INHERITED_FILE = ROOT + "/demo/LauncherChild.java";
const INHERITED_MAIN = `package demo;
class LauncherParent {
  public static void main(String[] args) {
    int value = 25;
    System.out.println("INHERITED_MAIN_OK:" + value + "|" + System.getProperty("sun.java.command") + "|" + System.getProperty("java.home"));
  }
}
public class LauncherChild extends LauncherParent {
  // 😀 child cursor
  static class NoMain {}
}
`;
const ANCHOR = "public final class Existing {}\n";
const NOTES = "Compact source notes\n";
const DRAFT = NOTES + "unsaved developer note\n";
const TEMPLATE = "void main() {\n}\n";
const MAIN = `void main() {
  int value = 25;
  java.lang.System.out.println("COMPACT_MAIN_OK:" + value + "|" + java.lang.System.getProperty("java.home"));
}
`;
function pom(release: number) {
  return `<project><modelVersion>4.0.0</modelVersion><groupId>reference</groupId><artifactId>compact</artifactId><version>1.0</version>
<properties><maven.compiler.release>${release}</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
<build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version><configuration><debug>true</debug><debuglevel>lines,vars,source</debuglevel></configuration></plugin></plugins></build></project>\n`;
}
export class NativeJavaCompactSourceSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #jdk = "";
  #daemon = "";
  #engine = "";
  #repository = "";
  #buildTool: "maven" | "gradle" = "maven";
  #gradle = "";
  #gradleRuntime = "";
  #gradleHome = "";
  #gradleNeedsEvaluation = true;
  #failure?: unknown;
  #diagnosticObservations: Array<{ phase: string; items: string[] }> = [];
  #proof = {
    requirement: REQUIREMENT,
    nativeGui: true,
    packagedApplication: false,
    buildTool: "maven" as "maven" | "gradle",
    gradleDiagnosticsNoEvaluation: null as boolean | null,
    jdtGradleImportAuthorized: null as boolean | null,
    lowerReleaseRefused: false,
    refusalPreservedFilesAndTabs: false,
    releaseUpgradedThroughEditor: false,
    compactWizardUsed: false,
    wizardOpenedInPackage: false,
    compactDestinationPreviewMatched: false,
    compactCreatedAtSourceRoot: false,
    implicitContextualNameAccepted: false,
    diskInitiallyEmpty: false,
    templateCapturedAndCompiled: false,
    notesDraftPreserved: false,
    savedSourceMatches: false,
    buildPassed: false,
    classMajor25: false,
    manualMainRunPassed: false,
    modernProviderCandidateSelected: false,
    discoveredMainRunPassed: false,
    compactEditorFileRunPassed: false,
    compactEditorCursorDebugPassed: false,
    inheritedProfileExcludesCompactInstance: false,
    inheritedLaunchOwnerSelected: false,
    inheritedMainRunPassed: false,
    dormantInnerDoesNotLaunchOuter: false,
    inheritedCursorDebugPassed: false,
    inheritedDeclaringFrameAndLocal: false,
    compactJdtDraftError: false,
    compactJdtRepairWarning: false,
    compactSdkDraftError: false,
    compactSdkRepair: false,
    compactDiagnosticsReadOnly: false,
    debugCandidateSelected: false,
    jdiEntry: false,
    instanceMainBreakpoint: false,
    localAndThisInspected: false,
    debugCompleted: false,
    inputsPreserved: false,
    cleanExit: false,
    environmentRestored: false,
  };
  evidence() {
    return { ...this.#proof };
  }
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
  private surface() {
    assert(this.#app);
    return new NativeEditorSurface(this.#app);
  }
  private project() {
    return this.browser().$('section[aria-label="Java project context"]');
  }
  private execution() {
    return this.browser().$('section[aria-label="Java execution"]');
  }
  private buildFile() {
    return this.#buildTool === "gradle" ? "build.gradle" : "pom.xml";
  }
  private classFile() {
    return this.#buildTool === "gradle" ? "build/classes/java/main/record.class" : "target/classes/record.class";
  }
  private buildInputs(release: number): Array<[string, string]> {
    if (this.#buildTool === "maven") return [["pom.xml", pom(release)]];
    return [
      ["settings.gradle", "rootProject.name = 'compact'\n"],
      ["build.gradle", `plugins { id 'application' }
java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }
tasks.withType(JavaCompile).configureEach {
  options.release = ${release}
  options.debug = true
  options.debugOptions.debugLevel = 'lines,vars,source'
}
application { mainClass = 'record' }
file('evaluation-count.txt').append('evaluated\\n')
`],
      ["gradle.properties", `org.gradle.daemon=false\norg.gradle.workers.max=2\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\norg.gradle.java.installations.paths=${this.#jdk}\n`],
    ];
  }
  private buildText(release: number) {
    return this.buildInputs(release).find(([name]) => name === this.buildFile())![1];
  }
  async prepare(buildTool: "Maven" | "Gradle" = "Maven") {
    this.#buildTool = buildTool === "Gradle" ? "gradle" : "maven";
    this.#proof.buildTool = this.#buildTool;
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    assert(
      process.env.IDE_COMPACT_SOURCE_TEST_JDK,
      "Set IDE_COMPACT_SOURCE_TEST_JDK to a full JDK 25",
    );
    this.#jdk = await realpath(process.env.IDE_COMPACT_SOURCE_TEST_JDK);
    if (this.#buildTool === "maven") this.#repository = await realpath(process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY ?? "");
    else {
      for (const name of ["IDE_JAVA_CONTEXT_TEST_GRADLE", "IDE_JAVA_CONTEXT_GRADLE_JDK", "IDE_JAVA_CONTEXT_GRADLE_USER_HOME"])
        assert(process.env[name], `Set ${name} for the Gradle compact-source fixture`);
      this.#gradle = await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "");
      this.#gradleRuntime = await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_JDK ?? "");
      this.#gradleHome = await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME ?? "");
    }
    this.#daemon = await realpath(process.env.IDE_REAL_REFACTORKIT_DAEMON ?? "");
    this.#engine = await realpath(
      process.env.IDE_REFACTORKIT_ENGINE ?? path.join(path.dirname(this.#daemon), "refactorkit"),
    );
    const version = await promisify(execFile)(path.join(this.#jdk, "bin/java"), ["-version"], {
      timeout: 10000,
    });
    assert.match(version.stderr, /version "25(?:\.|"|\+)/);
    await mkdir(this.file(ROOT), { recursive: true });
    await mkdir(this.file(ROOT + "/demo"), { recursive: true });
    for (const [name, text] of [
      ...this.buildInputs(21),
      [ROOT + "/Existing.java", ANCHOR],
      [INHERITED_FILE, INHERITED_MAIN],
      ["notes.txt", NOTES],
    ])
      await writeFile(this.file(name), text, { flag: "wx" });
    await this.#lease.assertConfiguredPathsConfined();
  }
  private async reveal(name: string) {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().waitUntil(
      async () => {
        const row = this.browser().$(`[role="treeitem"][data-path="${name}"]`);
        if (await row.isDisplayed().catch(() => false)) return true;
        for (const folder of await this.browser()
          .$$('[role="treeitem"][aria-expanded="false"]')
          .getElements()) {
          const relative = await folder.getAttribute("data-path");
          if (relative && name.startsWith(relative + "/")) {
            await folder.scrollIntoView();
            await folder.click();
            return false;
          }
        }
        return false;
      },
      { timeout: 15000, timeoutMsg: `Compact fixture path was not revealed: ${name}` },
    );
  }
  private async creationDialog() {
    const selectedDirectory = ROOT + "/demo";
    await this.reveal(selectedDirectory);
    const row = this.browser().$(`[role="treeitem"][data-path="${selectedDirectory}"]`);
    await row.scrollIntoView();
    await row.click({ button: "right" });
    const menu = this.browser().$('[role="menu"]');
    await menu.waitForDisplayed({ timeout: 5000 });
    await menu.$("button=New Java Type…").click();
    const dialog = this.browser().$('[role="dialog"][aria-labelledby="file-tree-create-title"]');
    await dialog.waitForDisplayed({ timeout: 5000 });
    assert.equal(await dialog.$('[aria-label="Package name"]').getValue(), "demo");
    this.#proof.wizardOpenedInPackage = true;
    await dialog.$('[aria-label="Java type"]').selectByAttribute("value", "compact-source");
    return dialog;
  }
  private async synchronize() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.project().waitForDisplayed({ timeout: 5000 });
    const sdk = this.project().$('input[placeholder="Full JDK directory"]');
    if ((await sdk.getValue()) !== this.#jdk) await pasteNativeText(this.#app!, sdk, this.#jdk);
    const details = this.project().$(`.//details[summary='${this.#buildTool === "gradle" ? "Gradle" : "Maven"} settings']`);
    if ((await details.getAttribute("open")) === null) await details.$("summary").click();
    if (this.#buildTool === "gradle") {
      for (const [selector, value] of [["#java-gradle-executable", this.#gradle], ["#java-gradle-runtime-home", this.#gradleRuntime], ["#java-gradle-user-home", this.#gradleHome]]) {
        const input = this.project().$(selector);
        if ((await input.getValue()) !== value) await pasteNativeText(this.#app!, input, value);
      }
      const authorization = this.project().$("button=Allow JDT LS Gradle import for this session");
      if (await authorization.isExisting()) {
        await authorization.scrollIntoView();
        await authorization.waitForEnabled({ timeout: 10000 });
        await authorization.click();
      }
      await this.project().$("button=Disable JDT LS Gradle import for this session").waitForExist({ timeout: 10000 });
      this.#proof.jdtGradleImportAuthorized = true;
    } else {
      const input = this.project().$('input[placeholder="Engine default local repository"]');
      if ((await input.getValue()) !== this.#repository) await pasteNativeText(this.#app!, input, this.#repository);
    }
    const synchronize = this.project().$(`button=${this.#buildTool === "gradle" && this.#gradleNeedsEvaluation ? "Evaluate Gradle project" : "Synchronize project"}`);
    await synchronize.waitForExist({ timeout: 30000 });
    await synchronize.waitForEnabled({ timeout: 30000 });
    await synchronize.click();
    await this.browser().waitUntil(
      async () => {
        const text = await this.project().getText();
        if (
          text.includes(`${this.#buildTool}-effective-v1 · available`) &&
          text.includes("Effective project context · RefactorKit") &&
          await this.project().$("button=Synchronize project").isEnabled()
        )
          return true;
        const error = this.project().$('[role="alert"]');
        if (await error.isExisting())
          throw Error("Compact fixture synchronization failed: " + (await error.getText()));
        return false;
      },
      { timeout: 90000, timeoutMsg: `The compact fixture ${this.#buildTool} context did not become available` },
    );
    this.#gradleNeedsEvaluation = false;
  }
  async launchAndRefuse() {
    assert(this.#lease);
    this.#app = new NativeDesktopApplication();
    await this.#app.launch({
      IDE_JAVA_HOME: this.#jdk,
      JAVA_HOME: this.#jdk,
      IDE_REFACTORKIT_DAEMON: this.#daemon,
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_REFACTORKIT_ENGINE: this.#engine,
      IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE: "1",
    });
    await this.#app.waitForFileExplorer();
    await this.synchronize();
    const tabsBefore = (await this.browser().$$('[role="tab"][data-path]')).length;
    const dialog = await this.creationDialog();
    assert.match(await dialog.$('[role="status"]').getText(), /Project source level: Java 21\./);
    await pasteNativeText(this.#app, dialog.$('[aria-label="Source name"]'), "TooEarly");
    await dialog.$("button=Create compact source").click();
    await dialog.$('[role="alert"]').waitForDisplayed({ timeout: 5000 });
    assert.match(await dialog.$('[role="alert"]').getText(), /require Java 25 or later/);
    this.#proof.lowerReleaseRefused = true;
    await assert.rejects(access(this.file(ROOT + "/TooEarly.java")), { code: "ENOENT" });
    assert.equal((await this.browser().$$('[role="tab"][data-path]')).length, tabsBefore);
    assert.equal(await dialog.$('[aria-label="Source name"]').getValue(), "TooEarly");
    this.#proof.refusalPreservedFilesAndTabs = true;
    await dialog.$("button=Cancel").click();
  }
  async upgradeAndCreate() {
    const file = this.buildFile();
    await this.reveal(file);
    await this.surface().open(file, this.buildText(21));
    await this.surface().replace(file, this.buildText(25));
    await this.surface().save(file);
    await this.surface().assertDirty(file, false);
    assert.equal(await readFile(this.file(file), "utf8"), this.buildText(25));
    this.#proof.releaseUpgradedThroughEditor = true;
    this.#gradleNeedsEvaluation = true;
    await this.synchronize();
    await this.reveal("notes.txt");
    await this.surface().open("notes.txt", NOTES);
    await this.surface().replace("notes.txt", DRAFT);
    const dialog = await this.creationDialog();
    assert.match(await dialog.$('[role="status"]').getText(), /Project source level: Java 25\./);
    assert.equal(await dialog.$('[aria-label="Package name"]').isExisting(), false);
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Source name"]'), "record");
    assert.equal(await dialog.$('[aria-label="Java source destination"]').getText(), "Destination: " + FILE);
    this.#proof.compactDestinationPreviewMatched = true;
    await dialog.$("button=Create compact source").click();
    await dialog.waitForExist({ reverse: true, timeout: 10000 });
    await this.surface().tab(FILE).waitForDisplayed({ timeout: 10000 });
    await this.surface().assertBuffer(FILE, TEMPLATE, "clipboard");
    await this.surface().assertDirty(FILE, true);
    assert.equal(await readFile(this.file(FILE), "utf8"), "");
    await assert.rejects(access(this.file(ROOT + "/demo/record.java")), { code: "ENOENT" });
    this.#proof.compactCreatedAtSourceRoot = true;
    this.#proof.compactWizardUsed = true;
    this.#proof.implicitContextualNameAccepted = true;
    this.#proof.diskInitiallyEmpty = true;
    await this.surface().focus(FILE);
    const captured = await readNativeCopiedText(this.#app!);
    assert.equal(captured, TEMPLATE);
    const scratch = path.join(this.#lease!.paths.root, "captured-template");
    await mkdir(scratch);
    const source = path.join(scratch, "record.java");
    await writeFile(source, captured);
    await promisify(execFile)(
      path.join(this.#jdk, "bin/javac"),
      ["--release", "25", "-d", scratch, source],
      { timeout: 20000 },
    );
    assert.equal((await readFile(path.join(scratch, "record.class"))).readUInt16BE(6), 69);
    assert.equal(await readFile(this.file(FILE), "utf8"), "");
    this.#proof.templateCapturedAndCompiled = true;
    await this.surface().tab("notes.txt").click();
    await this.surface().assertBuffer("notes.txt", DRAFT, "clipboard");
    await this.surface().assertDirty("notes.txt", true);
    assert.equal(await readFile(this.file("notes.txt"), "utf8"), NOTES);
    this.#proof.notesDraftPreserved = true;
  }
  private async configuration(synchronize = true) {
    if (synchronize) await this.synchronize();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.execution().waitForDisplayed({ timeout: 5000 });
    const picker = this.execution().$("label=Synchronized module and source set").$("select");
    let index = -1;
    const options = await picker.$$("option").getElements();
    for (let i = 0; i < options.length; i++) {
      const value = await options[i].getAttribute("value");
      if (!value) continue;
      let identity;
      try {
        identity = JSON.parse(value);
      } catch {
        continue;
      }
      if (identity[0] === `${this.#buildTool}-effective-v1` && identity[2] === "main") {
        assert.equal(index, -1);
        index = i;
      }
    }
    assert(index >= 0, "Compact fixture main source set is unavailable");
    await picker.selectByIndex(index);
    const trust = this.execution().$("label*=I trust this workspace").$("input");
    if (!(await trust.isSelected())) await trust.click();
    const main = this.execution().$('input[placeholder="com.example.Main"]');
    if ((await main.getValue()) !== "record") await pasteNativeText(this.#app!, main, "record");
  }
  private async action(label: string) {
    const previous = await this.execution().getAttribute("data-session-id");
    const button = this.execution().$(`button=${label}`);
    await button.scrollIntoView();
    await button.waitForEnabled({ timeout: 10000 });
    await button.click();
    await this.browser().waitUntil(
      async () => {
        const id = await this.execution().getAttribute("data-session-id");
        if (id && id !== previous) return true;
        const error = this.execution().$('[role="alert"]');
        if (await error.isExisting()) throw Error(await error.getText());
        return false;
      },
      { timeout: 20000, timeoutMsg: `${label} did not start a new compact-source session` },
    );
  }
  private async completed(operation: string) {
    await this.browser().waitUntil(
      async () => {
        const statuses = await readNativeJavaExecutionStatuses(this.browser());
        if (statuses.some((s) => s.startsWith(`${operation}: succeeded`))) return true;
        if (statuses.some((s) => s.startsWith(`${operation}: failed`)))
          throw Error(await this.execution().getText());
        const error = this.execution().$('[role="alert"]');
        if (await error.isExisting()) throw Error(await error.getText());
        return false;
      },
      { timeout: 90000, timeoutMsg: `Compact-source ${operation} did not complete` },
    );
  }
  async buildAndRun() {
    await this.surface().tab(FILE).click();
    await this.surface().replace(FILE, MAIN);
    await this.surface().save(FILE);
    await this.surface().assertDirty(FILE, false);
    assert.equal(await readFile(this.file(FILE), "utf8"), MAIN);
    this.#proof.savedSourceMatches = true;
    await this.surface().tab("notes.txt").click();
    await this.surface().focus("notes.txt");
    await this.surface().discardUsingDisk("notes.txt", NOTES);
    await this.configuration();
    await this.action("Build");
    await this.completed("build");
    this.#proof.buildPassed = true;
    assert.equal((await readFile(this.file(this.classFile()))).readUInt16BE(6), 69);
    this.#proof.classMajor25 = true;
    await this.configuration();
    await this.action("Run");
    await this.completed("run");
    assert.ok((await this.execution().getText()).includes("COMPACT_MAIN_OK:25|" + this.#jdk));
    this.#proof.manualMainRunPassed = true;
    await this.assertInputs();
  }
  private async selectDiscoveredCompactMain() {
    const main = this.execution().$('input[placeholder="com.example.Main"]');
    await pasteNativeText(this.#app!, main, "wrong.Missing");
    const discovery = this.execution().$('section[aria-label="Main-class discovery"]');
    const profile = discovery.$('[aria-label="Launcher discovery rules"]');
    await profile.waitForEnabled({ timeout: 10000 });
    await profile.selectByAttribute("value", "java25-v1");
    await discovery.$("button=Discover main classes").click();
    const candidate = discovery.$(`button=record · ${FILE}`);
    await candidate.waitForDisplayed({ timeout: 30000 });
    const text = await discovery.getText();
    assert.ok(text.includes("Complete for the qualified profile and selected scope"), text);
    assert.ok(text.includes("instance main() · compact source"), text);
    await candidate.click();
    assert.equal(await main.getValue(), "record");
    this.#proof.modernProviderCandidateSelected = true;
  }
  async discoverAndRun() {
    await this.configuration();
    await this.selectDiscoveredCompactMain();
    await this.action("Run");
    await this.completed("run");
    assert.ok((await this.execution().getText()).includes("COMPACT_MAIN_OK:25|" + this.#jdk));
    this.#proof.discoveredMainRunPassed = true;
    await this.assertInputs();
  }
  private async profile(value: "java25-v1" | "inherited-v1") {
    const picker = this.execution().$('[aria-label="Launcher discovery rules"]');
    await picker.waitForEnabled({ timeout: 10000 });
    await picker.selectByAttribute("value", value);
  }
  private async wrongMain() {
    await pasteNativeText(this.#app!, this.execution().$('input[placeholder="com.example.Main"]'), "wrong.Missing");
  }
  private async sourceAction(operation: "Run" | "Debug", mode: "file" | "cursor") {
    await this.browser().keys(["Shift", "F10"]);
    const label = `${operation} main ${mode === "file" ? "from this file" : "at cursor"}…`;
    await this.browser().waitUntil(async () => !!await this.surface().contextMenuItem(label), {
      timeout: 10000, timeoutMsg: `The saved source action ${label} is unavailable`,
    });
    const point = await this.surface().contextMenuItem(label);
    assert.ok(point);
    try {
      await this.browser().action("pointer").move({ ...point, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
    } finally { await this.browser().releaseActions(); }
  }
  private async launchedSource(previous: string | null, binaryName: string) {
    await this.browser().waitUntil(async () => {
      const id = await this.execution().getAttribute("data-session-id");
      return !!id && id !== previous && await this.execution().$('input[placeholder="com.example.Main"]').getValue() === binaryName;
    }, { timeout: 30000, timeoutMsg: `The editor did not launch the provider-owned ${binaryName}` });
  }
  private async position(file: string, source: string, needle: string) {
    await this.surface().tab(file).click();
    await this.surface().focus(file);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys(["Control", "f"]);
    const find = this.browser().$('[aria-label="Find"]');
    await find.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(this.#app!, find, needle, {
      focus: async () => { await this.browser().keys(["Control", "f"]); },
    });
    const offset = source.indexOf(needle);
    assert.ok(offset >= 0 && source.indexOf(needle, offset + 1) === -1);
    const before = source.slice(0, offset), line = before.split("\n").length;
    const column = before.split("\n").at(-1)!.length + 1;
    await this.browser().waitUntil(async () => {
      const label = await this.browser().$('[data-testid="editor-cursor-position"]').getAttribute("aria-label");
      return label === `Line ${line}, column ${column}` || label === `Line ${line}, column ${column + needle.length}`;
    }, { timeout: 5000, timeoutMsg: `Find did not select ${needle}` });
    await this.browser().keys("Escape");
    await this.browser().keys("ArrowLeft");
    await this.browser().keys("ArrowRight");
    assert.equal(await this.browser().$('[data-testid="editor-cursor-position"]').getAttribute("aria-label"), `Line ${line}, column ${column + 1}`);
  }
  async runCompactFromEditor() {
    await this.configuration();
    await this.profile("java25-v1");
    await this.wrongMain();
    await this.surface().tab(FILE).click();
    await this.surface().focus(FILE);
    const previous = await this.execution().getAttribute("data-session-id");
    await this.sourceAction("Run", "file");
    await this.launchedSource(previous, "record");
    await this.completed("run");
    assert.ok((await this.execution().getText()).includes("COMPACT_MAIN_OK:25|" + this.#jdk));
    this.#proof.compactEditorFileRunPassed = true;
    await this.assertInputs();
  }
  private async stopped(reason: string) {
    await this.browser().waitUntil(
      async () => {
        const panel = this.execution().$('[aria-label="Structured Java debugger"]');
        return (
          (await panel.isExisting()) && (await panel.getText()).includes(`suspended (${reason})`)
        );
      },
      { timeout: 60000, timeoutMsg: `Compact-source JDI did not stop at ${reason}` },
    );
  }
  async debug() {
    await this.configuration();
    await this.execution().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.surface().tab(FILE).click();
    await this.surface().focus(FILE);
    await this.browser().keys(["Control", "Home"]);
    try {
      await this.browser().performActions([
        { type: "key", id: "compact-source-breakpoint", actions: textKeySequence("\uE015\uE015") },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().keys("F9");
    await this.browser().waitUntil(
      async () =>
        (
          await this.execution().$('[aria-label="Saved Java source breakpoints"]').getText()
        ).includes("record.java:3"),
      { timeout: 10000 },
    );
    await this.configuration();
    await this.profile("java25-v1");
    await this.wrongMain();
    await this.position(FILE, MAIN, "int value");
    const previous = await this.execution().getAttribute("data-session-id");
    await this.sourceAction("Debug", "cursor");
    await this.launchedSource(previous, "record");
    this.#proof.debugCandidateSelected = true;
    await this.stopped("entry");
    this.#proof.jdiEntry = true;
    const panel = this.execution().$('[aria-label="Structured Java debugger"]');
    await panel.$("button=Continue").click();
    await this.stopped("breakpoint");
    assert.match(await panel.getText(), /record\.main/);
    this.#proof.instanceMainBreakpoint = true;
    const locals = panel.$('[aria-label="Java local variables"]');
    const value = await locals.$("td=value").$("..").$$("td");
    assert.equal(await value[1].getText(), "int");
    assert.equal(await value[2].getText(), "25");
    const receiver = await locals.$("td=this").$("..").$$("td");
    assert.equal(await receiver[1].getText(), "record");
    this.#proof.localAndThisInspected = true;
    await panel.$("button=Continue").click();
    await this.completed("debug");
    assert.ok((await this.execution().getText()).includes("COMPACT_MAIN_OK:25|" + this.#jdk));
    this.#proof.debugCompleted = true;
    this.#proof.compactEditorCursorDebugPassed = true;
    await this.assertInputs();
  }
  async runInheritedMain() {
    await this.configuration();
    await this.profile("inherited-v1");
    await this.wrongMain();
    const discovery = this.execution().$('section[aria-label="Main-class discovery"]');
    await discovery.$("button=Discover main classes").click();
    const candidate = discovery.$(`button=demo.LauncherChild · ${INHERITED_FILE}`);
    await candidate.waitForDisplayed({ timeout: 30000 });
    assert.ok((await discovery.getText()).includes("static main(String[]) inherited from demo.LauncherParent"));
    assert.equal(await discovery.$(`button=record · ${FILE}`).isExisting(), false);
    this.#proof.inheritedProfileExcludesCompactInstance = true;
    await candidate.click();
    assert.equal(await this.execution().$('input[placeholder="com.example.Main"]').getValue(), "demo.LauncherChild");
    this.#proof.inheritedLaunchOwnerSelected = true;
    await this.action("Run");
    await this.completed("run");
    await this.assertInheritedOutput();
    this.#proof.inheritedMainRunPassed = true;
    await this.assertInputs();
  }
  private async assertInheritedOutput() {
    const output = await this.execution().getText();
    assert.ok(output.includes("INHERITED_MAIN_OK:25|demo.LauncherChild|" + this.#jdk), output);
    assert.ok(!output.includes("COMPACT_MAIN_OK:"), output);
  }
  async debugInheritedCursorAndRejectInner() {
    await this.configuration();
    await this.execution().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.profile("inherited-v1");
    await this.wrongMain();
    await this.reveal(INHERITED_FILE);
    await this.surface().open(INHERITED_FILE, INHERITED_MAIN, "clipboard");
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.position(INHERITED_FILE, INHERITED_MAIN, "NoMain");
    const previous = await this.execution().getAttribute("data-session-id");
    await this.sourceAction("Run", "cursor");
    const discovery = this.execution().$('section[aria-label="Main-class discovery"]');
    await this.browser().waitUntil(async () => (await discovery.getText()).includes("Selected type: demo.LauncherChild$NoMain"), { timeout: 30000 });
    assert.ok((await discovery.getText()).includes("No eligible main was returned"));
    assert.equal(await this.execution().getAttribute("data-session-id"), previous);
    assert.equal(await this.execution().$('input[placeholder="com.example.Main"]').getValue(), "wrong.Missing");
    this.#proof.dormantInnerDoesNotLaunchOuter = true;
    await this.position(INHERITED_FILE, INHERITED_MAIN, "child cursor");
    await this.sourceAction("Debug", "cursor");
    await this.launchedSource(previous, "demo.LauncherChild");
    await this.stopped("entry");
    const panel = this.execution().$('[aria-label="Structured Java debugger"]');
    await pasteNativeText(this.#app!, panel.$("label=Breakpoint (class:line)").$("input"), "demo.LauncherParent:5");
    await panel.$("button=Set breakpoint").click();
    await panel.$("button=Continue").click();
    await this.stopped("breakpoint");
    assert.ok((await panel.getText()).includes("demo.LauncherParent.main"));
    const value = await panel.$('[aria-label="Java local variables"]').$("td=value").$("..").$$("td");
    assert.equal(await value[2].getText(), "25");
    this.#proof.inheritedDeclaringFrameAndLocal = true;
    await panel.$("button=Continue").click();
    await this.completed("debug");
    await this.assertInheritedOutput();
    this.#proof.inheritedCursorDebugPassed = true;
    await this.assertInputs();
  }
  private async diagnosticItems() {
    return this.browser().execute((file) => Array.from(document.querySelectorAll('[role="treeitem"][aria-label]'))
      .map(item => item.getAttribute("aria-label") ?? "")
      .filter(label => label.includes(file) && label.includes("provider ")), FILE);
  }
  private async compilerCheck(expected: string) {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await pasteNativeText(this.#app!, palette.$('[aria-label="Search commands"]'), "Check Java Compiler Errors");
    await palette.$('[role="option"][aria-label^="Check Java Compiler Errors"]').click();
    await this.browser().waitUntil(async () => {
      const status = this.browser().$('[role="status"][aria-label="Java compiler check"]');
      return await status.isExisting() && await status.getText() === expected;
    }, { timeout: 30000, timeoutMsg: `Compact compiler check did not report ${expected}` });
  }
  async verifyCompactDiagnostics() {
    await this.configuration();
    await this.surface().tab(FILE).click();
    await this.browser().$('[role="tab"][title="Problems in the current project"]').click();
    const compiled = await readFile(this.file(this.classFile()));
    const compiledTime = (await stat(this.file(this.classFile()), { bigint: true })).mtimeNs;
    const evaluations = this.#buildTool === "gradle" ? await readFile(this.file("evaluation-count.txt")) : null;
    const session = await this.execution().getAttribute("data-session-id");
    this.#diagnosticObservations.push({ phase: "saved-valid-source", items: await this.diagnosticItems() });
    const broken = MAIN.replace("int value = 25;", "int value = missingCompactValue;");
    await this.surface().replace(FILE, broken);
    await this.browser().waitUntil(async () => (await this.diagnosticItems()).some(item =>
      item.startsWith("error:") && item.includes("missingCompactValue") && item.includes("provider jdt-ls")),
    { timeout: 30000, timeoutMsg: "JDT LS did not diagnose the missing variable in the compact Java25 draft" });
    this.#proof.compactJdtDraftError = true;
    this.#diagnosticObservations.push({ phase: "jdt-draft-error", items: await this.diagnosticItems() });
    const warning = MAIN.replace("int value = 25;", "int compactWarning = 1;\n  int value = 25;");
    await this.surface().replace(FILE, warning);
    await this.browser().waitUntil(async () => {
      const items = await this.diagnosticItems();
      return items.some(item => item.startsWith("warning:") && item.includes("compactWarning") && item.includes("provider jdt-ls"))
        && !items.some(item => item.startsWith("error:"));
    }, { timeout: 30000, timeoutMsg: "JDT LS did not replace the compact draft error with a fresh unused-variable warning" });
    this.#proof.compactJdtRepairWarning = true;
    this.#diagnosticObservations.push({ phase: "jdt-repaired-warning", items: await this.diagnosticItems() });
    await this.compilerCheck("0 Java compiler errors in 3 analyzed sources.");
    await this.surface().replace(FILE, broken);
    await this.compilerCheck("1 Java compiler error in 3 analyzed sources.");
    assert.ok((await this.diagnosticItems()).some(item => item.includes("missingCompactValue") && item.includes("provider RefactorKit Java compiler")));
    this.#proof.compactSdkDraftError = true;
    this.#diagnosticObservations.push({ phase: "sdk-draft-error", items: await this.diagnosticItems() });
    await this.surface().replace(FILE, MAIN, false);
    await this.compilerCheck("0 Java compiler errors in 3 analyzed sources.");
    assert.equal((await this.diagnosticItems()).some(item => item.startsWith("error:")), false);
    this.#proof.compactSdkRepair = true;
    await this.surface().assertBuffer(FILE, MAIN, "clipboard");
    await this.surface().assertDirty(FILE, false);
    assert.deepEqual(await readFile(this.file(this.classFile())), compiled);
    assert.equal((await stat(this.file(this.classFile()), { bigint: true })).mtimeNs, compiledTime);
    if (evaluations) {
      assert.deepEqual(await readFile(this.file("evaluation-count.txt")), evaluations);
      this.#proof.gradleDiagnosticsNoEvaluation = true;
    }
    assert.equal(await this.execution().getAttribute("data-session-id"), session);
    await this.assertInputs();
    this.#proof.compactDiagnosticsReadOnly = true;
  }
  private async assertInputs() {
    for (const [file, text] of [
      ...this.buildInputs(25),
      [ROOT + "/Existing.java", ANCHOR],
      [INHERITED_FILE, INHERITED_MAIN],
      ["notes.txt", NOTES],
      [FILE, MAIN],
    ])
      assert.equal(
        await readFile(this.file(file), "utf8"),
        text,
        `Unexpected compact-source input change: ${file}`,
      );
    this.#proof.inputsPreserved = true;
  }
  async close() {
    await this.assertInputs();
    await this.#app!.closeWindow();
    this.#proof.cleanExit = true;
  }
  async captureFailure(error: unknown) {
    this.#failure = error;
    if (!this.#app || !this.#lease) return;
    try {
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "compact-source-failure.png"),
      );
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "compact-source-failure.json"),
        JSON.stringify(
          {
            error: String(error),
            body: await this.browser().execute(() => document.body.innerText),
          },
          null,
          2,
        ),
      );
    } catch {}
  }
  async dispose() {
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
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "compact-source-native-evidence.json"),
        JSON.stringify(
          {
            ...this.#proof,
            configuredTools: { sdkHome: this.#jdk, providerDaemon: this.#daemon, providerEngine: this.#engine, languageServerHome: process.env.IDE_JDTLS_HOME ?? null,
              gradle: this.#buildTool === "gradle" ? { executable: this.#gradle, runtimeHome: this.#gradleRuntime, userHome: this.#gradleHome } : null },
            diagnosticObservations: this.#diagnosticObservations,
            failure: this.#failure ? String(this.#failure) : failure ? String(failure) : null,
          },
          null,
          2,
        ) + "\n",
      );
    if (failure) throw failure;
  }
}
