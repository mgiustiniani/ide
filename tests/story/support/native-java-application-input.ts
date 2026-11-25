import assert from "node:assert/strict";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { pasteNativeText } from "./native-text-input.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";

const SOURCE = `import java.util.Base64;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
public class Main {
 public static void main(String[] args) throws Exception {
  System.out.println("APP_INPUT_PID:" + Files.readSymbolicLink(Paths.get("/proc/self")));
  System.out.println("APP_INPUT_JAVA_HOME:" + Paths.get(System.getProperty("java.home")).toRealPath());
  System.out.println("APP_INPUT_READY");
  ByteArrayOutputStream input = new ByteArrayOutputStream();
  byte[] buffer = new byte[4096];
  int count;
  while ((count = System.in.read(buffer)) != -1) input.write(buffer, 0, count);
  String proof = Base64.getEncoder().encodeToString(input.toByteArray());
  Files.write(Paths.get("input-proof.txt"), proof.getBytes(StandardCharsets.UTF_8));
  System.out.println("APP_INPUT_BYTES:" + proof);
 }
}
`;
const TEXT = "quit\ncont\ncafé 🙂 𐐀 'quoted' $(false);";

export class NativeJavaApplicationInputSession {
  #lease: NativeScenarioEnvironmentLease | null = null;
  #app: NativeDesktopApplication | null = null;
  #mode = "run";
  #tool = "jdk";
  #source = "module/Main.java";
  #inputs = new Map<string, string>();
  #gradleUserHome: string | null = null;
  #legacyJdk?: string;
  #legacyRuntime?: string;
  #pid: number | null = null;
  #proof = { exactUtf8AndEmptyLine: false, eof: false, capturedInputRetained: false,
    stopReapedApplication: false, savedFlagRestored: false, trustNotRestored: false,
    sourcePreserved: false, cleanClose: false };

  async prepare(selection: string) {
    const [tool, mode] = selection.split("/");
    assert.ok(["jdk", "maven", "gradle"].includes(tool));
    assert.ok(["run", "jdi", "jdb"].includes(mode));
    this.#mode = mode;
    this.#tool = tool;
    if (process.env.IDE_JAVA8_HOME) {
      this.#legacyJdk = await realpath(process.env.IDE_JAVA8_HOME);
      assert.match(await readFile(path.join(this.#legacyJdk, "release"), "utf8"), /^JAVA_VERSION="1\.8\./m);
      this.#legacyRuntime = await realpath(path.join(this.#legacyJdk, "jre"));
    }
    this.#source = tool === "jdk" ? "module/Main.java" : "module/src/main/java/Main.java";
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    this.#inputs.set(this.#source, SOURCE);
    if (tool === "maven") {
      this.#inputs.set("module/pom.xml", `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>input</artifactId><version>1</version><properties><maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin></plugins></build></project>\n`);
    } else if (tool === "gradle") {
      this.#gradleUserHome = path.join(this.#lease.paths.home, "gradle-cache");
      await mkdir(this.#gradleUserHome, { recursive: true });
      this.#inputs.set("module/settings.gradle", "rootProject.name = 'native-input-fixture'\n");
      this.#inputs.set("module/build.gradle", "plugins { id 'application' }\napplication { mainClass = 'Main' }\n");
      this.#inputs.set("module/gradle.properties", "org.gradle.daemon=false\norg.gradle.workers.max=2\n");
      if (this.#legacyJdk) {
        const runtime = process.env.IDE_JAVA_CONTEXT_GRADLE_RUNTIME_JDK;
        const gradle = process.env.IDE_JAVA_CONTEXT_TEST_GRADLE;
        assert.ok(runtime && path.isAbsolute(runtime), "Set IDE_JAVA_CONTEXT_GRADLE_RUNTIME_JDK for the legacy test");
        assert.ok(gradle && path.isAbsolute(gradle), "Set IDE_JAVA_CONTEXT_TEST_GRADLE for the legacy test");
        const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
        this.#inputs.set("module/gradlew",
          `#!/bin/sh\nexport JAVA_HOME=${quote(await realpath(runtime))}\nexec ${quote(await realpath(gradle))} --offline "$@"\n`);
        this.#inputs.set("module/build.gradle", this.#inputs.get("module/build.gradle") +
          "java { toolchain { languageVersion = JavaLanguageVersion.of(8) } }\n");
        this.#inputs.set("module/gradle.properties", this.#inputs.get("module/gradle.properties") +
          `org.gradle.java.installations.paths=${this.#legacyJdk}\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\n`);
      }
    }
    for (const [file, contents] of this.#inputs) {
      await mkdir(path.dirname(this.file(file)), { recursive: true });
      await writeFile(this.file(file), contents, { flag: "wx", ...(file === "module/gradlew" ? { mode: 0o700 } : {}) });
    }
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    try { await this.#app.launch(); }
    catch (error) {
      const diagnostics = this.#app.redactedDiagnostics();
      await writeFile(path.join(this.#lease!.runnerArtifactPath,
        `java-application-input-${this.#tool}-${this.#mode}-startup-failure.json`),
        JSON.stringify({ error: String(error), diagnostics }, null, 2) + "\n");
      throw new Error(`${String(error)}; Native startup diagnostics: ${diagnostics}`, { cause: error });
    }
    await this.#app.waitForFileExplorer();
    const parts = this.#source.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folder = this.browser().$(`[role="treeitem"][data-path="${parts.slice(0, index).join("/")}"]`);
      await folder.waitForDisplayed({ timeout: 10_000 });
      if (await folder.getAttribute("aria-expanded") === "false") await folder.click();
    }
    await new NativeEditorSurface(this.#app).open(this.#source, SOURCE);
    await this.openRun();
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", this.#tool);
    await this.panel().$("label=Project or module directory (workspace-relative)").$("input").setValue("module");
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Main");
    if (this.#legacyJdk) {
      await pasteNativeText(this.#app, this.panel().$('input[placeholder="IDE default JDK"]'), this.#legacyJdk);
    }
    await this.panel().$("label=Debugger").$("select").selectByAttribute("value", this.#mode === "jdi" ? "jdi" : "jdb");
    if (this.#gradleUserHome) {
      await this.panel().$("button=Add environment variable").click();
      await this.panel().$("label=Variable 1 name").$("input").setValue("GRADLE_USER_HOME");
      await pasteNativeText(this.#app, this.panel().$("label*=Variable 1 value").$("textarea"), this.#gradleUserHome);
    }
    await this.flag().click();
    await this.trust().click();
    await this.action(this.#mode === "run" ? "Run" : "Debug");
    await this.ready();
  }
  async sendAndClose() {
    const input = this.input();
    const textarea = input.$("textarea");
    await pasteNativeText(this.#app!, textarea, TEXT);
    await input.$("button=Send line").click();
    await this.browser().waitUntil(async () => (await textarea.getValue()) === "" && await input.$("button=Send line").isEnabled(), { timeout: 10_000 });
    // An empty submission is an actual empty line, not an ignored click.
    await input.$("button=Send line").click();
    const count = Buffer.byteLength(`${TEXT}\n\n`, "utf8");
    await this.browser().waitUntil(async () => (await input.getText()).includes(`Bytes accepted: ${count}.`) && await input.$("button=Close input (EOF)").isEnabled(), { timeout: 10_000 });
    await input.$("button=Close input (EOF)").click();
    await this.status(`${this.operation()}: succeeded (exit 0)`);
    const expected = Buffer.from(`${TEXT}\n\n`, "utf8").toString("base64");
    assert.ok((await this.console().getText()).includes(`APP_INPUT_BYTES:${expected}`));
    assert.equal(await readFile(this.file("module/input-proof.txt"), "utf8"), expected);
    assert.equal(await textarea.getValue(), "");
    assert.equal(await input.$("button=Send line").isEnabled(), false);
    const classes = this.#tool === "maven" ? "target/classes" : this.#tool === "gradle" ? "build/classes/java/main" : ".ide/java/classes";
    assert.ok((await stat(this.file(`module/${classes}/Main.class`))).isFile());
    this.#proof.exactUtf8AndEmptyLine = true;
    this.#proof.eof = true;
  }
  async repeatAndStop() {
    // The changed form affects the next ordinary launch; Rerun retains its own flag.
    await this.flag().click();
    assert.equal(await this.flag().isSelected(), false);
    await this.action("Rerun session");
    await this.ready();
    assert.equal(await this.input().$("button=Send line").isEnabled(), true);
    this.#proof.capturedInputRetained = true;
    await pasteNativeText(this.#app!, this.input().$("textarea"), "unsent private draft");
    const pid = this.#pid!;
    await this.action("Stop");
    await this.status(`${this.operation()}: stopped`);
    await this.browser().waitUntil(async () => {
      try { process.kill(pid, 0); return false; }
      catch (failure) { return (failure as NodeJS.ErrnoException).code === "ESRCH"; }
    }, { timeout: 10_000 });
    assert.equal(await this.input().$("textarea").getValue(), "");
    this.#proof.stopReapedApplication = true;
    await this.flag().click();
    await this.browser().refresh();
    await this.#app!.waitForFileExplorer();
    await this.openRun();
    assert.equal(await this.flag().isSelected(), true);
    assert.equal(await this.panel().$("label=Build tool").$("select").getValue(), this.#tool);
    assert.equal(await this.panel().$("label=Project or module directory (workspace-relative)").$("input").getValue(), "module");
    if (this.#gradleUserHome) {
      assert.equal(await this.panel().$("label=Variable 1 name").$("input").getValue(), "GRADLE_USER_HOME");
      assert.equal(await this.panel().$("label*=Variable 1 value").$("textarea").getValue(), this.#gradleUserHome);
    }
    assert.equal(await this.trust().isSelected(), false);
    this.#proof.savedFlagRestored = true;
    this.#proof.trustNotRestored = true;
    for (const [file, contents] of this.#inputs) assert.equal(await readFile(this.file(file), "utf8"), contents, file);
    this.#proof.sourcePreserved = true;
    await this.#lease!.assertConfiguredPathsConfined();
  }
  async close() {
    await this.#app!.closeNativeWindow();
    this.#proof.cleanClose = true;
    assert.ok(Object.values(this.#proof).every((value) => value === true));
  }
  async dispose() {
    try { await this.#app?.dispose(); }
    finally {
      const artifacts = this.#lease?.runnerArtifactPath;
      await this.#lease?.dispose();
      if (artifacts) await writeFile(path.join(artifacts, `java-application-input-${this.#tool}-${this.#mode}-native-evidence.json`),
        JSON.stringify({ ...nativeArtifactEvidence(), tool: this.#tool, mode: this.#mode,
          ...(this.#legacyRuntime ? { runtimeHome: this.#legacyRuntime } : {}), ...this.#proof }, null, 2) + "\n");
    }
  }
  private async ready() {
    try { await this.waitReady(); }
    catch (error) {
      const output = await this.console().getText().catch(() => "Java console unavailable");
      const panel = await this.panel().getText().catch(() => "Java panel unavailable");
      if (this.#lease) await writeFile(path.join(this.#lease.runnerArtifactPath,
        `java-application-input-${this.#tool}-${this.#mode}-failure.json`),
        JSON.stringify({ error: String(error), output, panel }, null, 2) + "\n");
      throw new Error(`${String(error)}; Java console: ${output}`, { cause: error });
    }
  }
  private async waitReady() {
    await this.status(`${this.operation()}: running`);
    if (this.#mode === "jdi") {
      const debuggerPanel = this.browser().$('[aria-label="Structured Java debugger"]');
      await this.browser().waitUntil(async () => (await debuggerPanel.isExisting()) &&
        (await debuggerPanel.getText()).includes("JDI: suspended (entry)"), { timeout: 30_000 });
      await debuggerPanel.$("button=Continue").click();
    } else if (this.#mode === "jdb") {
      await this.browser().waitUntil(async () => (await this.console().getText()).includes("main[1]"), { timeout: 30_000 });
      await this.action("Continue");
    }
    const previous = this.#pid;
    await this.browser().waitUntil(async () => {
      const text = await this.console().getText();
      const pid = Number(/APP_INPUT_PID:(\d+)/.exec(text)?.[1]);
      if (!pid || pid === previous || !text.includes("APP_INPUT_READY")) return false;
      this.#pid = pid;
      return true;
    }, { timeout: 30_000 });
    if (this.#legacyRuntime) {
      assert.ok((await this.console().getText()).includes(`APP_INPUT_JAVA_HOME:${this.#legacyRuntime}`));
    }
    await this.browser().waitUntil(async () => (await this.input().getText()).includes("Input: open."), { timeout: 10_000 });
  }
  private operation() { return this.#mode === "run" ? "run" : "debug"; }
  private flag() { return this.panel().$("label=Application input (System.in)").$("input"); }
  private trust() { return this.panel().$("label*=I trust this workspace").$("input"); }
  private browser() { return this.#app!.browser(); }
  private panel() { return this.browser().$('[aria-label="Java execution"]'); }
  private input() { return this.panel().$('[aria-label="Application input"]'); }
  private console() { return this.panel().$('[aria-label="Java console output"]'); }
  private file(relative: string) { return path.join(this.#lease!.paths.workspace, relative); }
  private async action(name: string) { const button = this.panel().$(`button=${name}`); await button.waitForEnabled({ timeout: 10_000 }); await button.click(); }
  private async status(text: string) { await this.browser().waitUntil(async () => (await this.panel().getText()).includes(text), { timeout: 30_000 }); }
  private async openRun() {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await palette.$('input[aria-label="Search commands"]').setValue("Open Java Run");
    await palette.$('[role="option"][aria-label="Open Java Run Java"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
  }
}
