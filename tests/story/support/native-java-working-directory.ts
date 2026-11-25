import assert from "node:assert/strict";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";

const SOURCE = `import java.nio.file.*;
public class Main {
 public static void main(String[] args) throws Exception {
  String resource = Files.readString(Path.of("settings.txt"));
  String proof = java.util.UUID.randomUUID()+"|"+resource+"|"+Path.of("").toRealPath()+"|"+Files.readSymbolicLink(Path.of("/proc/self/cwd"));
  Files.writeString(Path.of("cwd-proof.txt"), proof);
  System.out.println("NATIVE_APP_DIRECTORY_OK:"+resource);
 }
}
`;
const FILE = "module/Main.java", FIRST = "run assets/café's", SECOND = "run assets/other";
const MAVEN_FILE = "module/src/main/java/Main.java";
const MAVEN_TEST_FILE = "module/src/test/java/Java8Test.java";
const MAVEN_POM = `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>ide.fixture</groupId><artifactId>java8-run</artifactId><version>1</version>
  <properties>
    <maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies><dependency>
    <groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>runtime</scope>
  </dependency></dependencies>
  <build><plugins>
    <plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin>
  </plugins></build>
</project>
`;
const MAVEN_LITERAL = "quote ' and \" with café\na second line";
const MAVEN_SOURCE = `import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public class Main {
 public static void main(String[] args) throws Exception {
  Class.forName("junit.framework.TestCase");
  String expected = ${JSON.stringify(MAVEN_LITERAL)};
  if (args.length != 2 || !args[0].isEmpty() || !expected.equals(args[1])) throw new AssertionError("Arguments changed");
  if (!expected.equals(System.getProperty("ide.gui.literal"))) throw new AssertionError("JVM option changed");
  String resource = new String(Files.readAllBytes(Paths.get("settings.txt")), StandardCharsets.UTF_8);
  if (!"FIRST".equals(resource)) throw new AssertionError("Wrong application directory");
  String home = Paths.get(System.getProperty("java.home")).toRealPath().toString();
  Files.write(Paths.get("maven-run-proof.txt"), home.getBytes(StandardCharsets.UTF_8));
  System.out.println("MAVEN_JAVA8_GUI_OK");
 }
}
`;
const MAVEN_TEST_SOURCE = `import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.BlockJUnit4ClassRunner;
import org.junit.runners.model.InitializationError;
@RunWith(Java8Test.Runner.class)
public class Java8Test {
 public static class Runner extends BlockJUnit4ClassRunner {
  public Runner(Class<?> type) throws InitializationError, java.io.IOException {
   super(type);
   String value = System.getProperty("ide.discovery.literal", "project defaults");
   if (!"1.8".equals(System.getProperty("java.specification.version"))) throw new AssertionError("Unexpected test JDK");
   Files.write(Paths.get("discovery-option.txt"), value.getBytes(StandardCharsets.UTF_8));
  }
 }
 @Test public void selected() throws Exception {
  Files.createFile(Paths.get("selected-method.txt"));
 }
 @Test public void companion() {
  throw new AssertionError("The companion method must not run");
 }
}
`;
export class NativeJavaWorkingDirectorySession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #first = "";
  #recordingPath = "";
  #recordingBytes?: Buffer;
  #java8Home?: string;
  #mavenLaunchVerified = false;
  #mavenDiscoveryVerified = false;
  #proof = {
    nativeGui: true, projectCompileDirectoryRetained: false, applicationDirectoryUsed: false,
    jfrUsesApplicationDirectory: false, jfrRecordedUnderProject: false, jfrAnalysis: false,
    jfrRerunPreservesFirstRecording: false,
    completedRerunRetainsCapturedDirectory: false, invalidDirectoryRefusedWithoutRunningOldClass: false,
    buildIgnoresApplicationDirectoryDraft: false, namedConfigurationRestored: false,
    executionTrustNotRestored: false, jdiApplicationDirectoryUsed: false, sourcePreserved: false, cleanClose: false,
  };
  async prepare(mavenJava8 = false) {
    if (mavenJava8) {
      const jdk = process.env.IDE_JAVA8_HOME;
      assert.ok(jdk && path.isAbsolute(jdk), "Set IDE_JAVA8_HOME to a full Java 8 JDK");
      this.#java8Home = await realpath(jdk);
      assert.match(await readFile(path.join(this.#java8Home, "release"), "utf8"), /^JAVA_VERSION="1\.8\./m);
    }
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    const source = this.file(mavenJava8 ? MAVEN_FILE : FILE);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, mavenJava8 ? MAVEN_SOURCE : SOURCE, { flag: "wx" });
    if (mavenJava8) {
      const testSource = this.file(MAVEN_TEST_FILE);
      await mkdir(path.dirname(testSource), { recursive: true });
      await writeFile(testSource, MAVEN_TEST_SOURCE, { flag: "wx" });
      await writeFile(this.file("module/pom.xml"), MAVEN_POM, { flag: "wx" });
    }
    for (const [folder, value] of [[FIRST, "FIRST"], [SECOND, "SECOND"]]) {
      await mkdir(this.file(folder), { recursive: true });
      await writeFile(this.file(`${folder}/settings.txt`), value, { flag: "wx" });
    }
    await this.#lease.assertConfiguredPathsConfined();
  }
  async saveMavenJava8Settings() {
    assert.ok(this.#java8Home);
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.openRun();
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", "maven");
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Main");
    await this.panel().$("label=Project or module directory (workspace-relative)").$("input").setValue("module");
    await this.setDirectory(FIRST);
    await pasteNativeText(this.#app, this.panel().$('input[placeholder="IDE default JDK"]'), this.#java8Home);
    await this.action("Add JVM option");
    await pasteNativeText(this.#app, this.panel().$("label=JVM option 1").$("textarea"), `-Dide.gui.literal=${MAVEN_LITERAL}`);
    await this.action("Add argument");
    await this.action("Add argument");
    await pasteNativeText(this.#app, this.panel().$("label=Argument 2").$("textarea"), MAVEN_LITERAL);
    await this.panel().$("label=Configuration name").$("input").setValue("Maven Java 8");
    await this.action("Rename configuration");
    await this.browser().refresh();
    await this.#app.waitForFileExplorer();
    await this.openRun();
  }
  async verifyMavenJava8Run() {
    assert.ok(this.#java8Home);
    assert.equal(await this.panel().$("label=Configuration name").$("input").getValue(), "Maven Java 8");
    assert.equal(await this.panel().$('input[placeholder="IDE default JDK"]').getValue(), this.#java8Home);
    assert.equal(await this.directory().getValue(), FIRST);
    assert.equal(await this.panel().$("label=Argument 1").$("textarea").getValue(), "");
    assert.equal(await this.panel().$("label*=Argument 2").$("textarea").getValue(), MAVEN_LITERAL);
    assert.equal(await this.panel().$("label*=JVM option 1").$("textarea").getValue(), `-Dide.gui.literal=${MAVEN_LITERAL}`);
    const trust = this.panel().$('input[type="checkbox"]');
    assert.equal(await trust.isSelected(), false);
    assert.equal(await this.panel().$("button=Run").isEnabled(), false);
    await trust.click();
    await this.action("Run");
    await this.status("run: succeeded (exit 0)");
    await this.status("MAVEN_JAVA8_GUI_OK");
    assert.equal(await readFile(this.file(`${FIRST}/maven-run-proof.txt`), "utf8"),
      await realpath(path.join(this.#java8Home, "jre")));
    const compiled = await readFile(this.file("module/target/classes/Main.class"));
    assert.equal(compiled.readUInt16BE(6), 52);
    assert.equal(await readFile(this.file(MAVEN_FILE), "utf8"), MAVEN_SOURCE);
    assert.equal(await readFile(this.file("module/pom.xml"), "utf8"), MAVEN_POM);
    this.#mavenLaunchVerified = true;
  }
  async verifyMavenJava8Discovery() {
    assert.ok(this.#mavenLaunchVerified);
    const panel = this.panel();
    const discovery = panel.$('[aria-label="Discovered Java tests"]');
    const selected = discovery.$('[aria-label="Run method group Java8Test#selected"]');
    const companion = discovery.$('[aria-label="Run method group Java8Test#companion"]');
    const output = this.file("module/selected-method.txt");
    const report = this.file("module/target/surefire-reports/TEST-Java8Test.xml");
    await this.action("Add test JVM option");
    await pasteNativeText(this.#app!, panel.$("label=Test JVM option 1").$("textarea"), `-Dide.discovery.literal=${MAVEN_LITERAL}`);
    await this.action("Discover tests");
    await this.status("discover: succeeded (exit 0)");
    assert.equal(await readFile(this.file("module/discovery-option.txt"), "utf8"), MAVEN_LITERAL);
    assert.equal(await selected.isEnabled(), true);
    assert.equal(await companion.isEnabled(), true);
    await assert.rejects(stat(output), { code: "ENOENT" });
    await assert.rejects(stat(report), { code: "ENOENT" });

    // A fresh discovery captures project defaults for the later Surefire fork on Java 8.
    await panel.$('[aria-label="Remove test JVM option 1"]').click();
    await this.action("Discover tests");
    await this.browser().waitUntil(
      async () => await readFile(this.file("module/discovery-option.txt"), "utf8") === "project defaults",
      { timeout: 20_000, timeoutMsg: "The second discovery did not reach the runner with project defaults" },
    );
    await this.status("discover: succeeded (exit 0)");
    await assert.rejects(stat(output), { code: "ENOENT" });
    await assert.rejects(stat(report), { code: "ENOENT" });
    await selected.scrollIntoView();
    await selected.click();
    await this.status("test: succeeded (exit 0)");
    assert.ok((await stat(output)).isFile());
    const xml = await readFile(report, "utf8");
    assert.match(xml, /<testsuite[^>]*\btests="1"/);
    assert.match(xml, /<testcase[^>]*\bname="selected"/);
    assert.doesNotMatch(xml, /<(?:failure|error)\b|<testcase[^>]*\bname="companion"/);
    assert.equal(await readFile(this.file(MAVEN_TEST_FILE), "utf8"), MAVEN_TEST_SOURCE);
    assert.equal(await readFile(this.file(MAVEN_FILE), "utf8"), MAVEN_SOURCE);
    assert.equal(await readFile(this.file("module/pom.xml"), "utf8"), MAVEN_POM);
    await this.#lease!.assertConfiguredPathsConfined();
    await this.#app!.closeNativeWindow();
    this.#mavenDiscoveryVerified = true;
  }
  async launchAndConfigure() {
    this.#app = new NativeDesktopApplication();
    await this.#app.launch(); await this.#app.waitForFileExplorer();
    await this.browser().$('[role="treeitem"][data-path="module"]').click();
    await new NativeEditorSurface(this.#app).open(FILE, SOURCE);
    await this.openRun();
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", "jdk");
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Main");
    await this.panel().$("label=Project or module directory (workspace-relative)").$("input").setValue("module");
    await this.setDirectory(FIRST);
    await this.panel().$('input[type="checkbox"]').click();
    await this.action("Run");
    await this.status("run: succeeded (exit 0)");
    this.#first = await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8");
    this.assertProof(this.#first, "FIRST", FIRST);
    assert.ok((await stat(this.file("module/.ide/java/classes/Main.class"))).isFile());
    await assert.rejects(stat(this.file(`${FIRST}/.ide/java/classes/Main.class`)));
    await assert.rejects(stat(this.file("module/cwd-proof.txt")));
    this.#proof.projectCompileDirectoryRetained = true;
    this.#proof.applicationDirectoryUsed = true;
    await this.action("Run with JFR");
    await this.browser().waitUntil(async () => (await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8")) !== this.#first, { timeout: 20_000 });
    await this.status("run: succeeded (exit 0)");
    this.#first = await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8");
    this.assertProof(this.#first, "FIRST", FIRST);
    this.#proof.jfrUsesApplicationDirectory = true;
    this.#recordingPath = await this.savedRecording();
    this.#recordingBytes = await readFile(this.file(this.#recordingPath));
    assert.ok(this.#recordingBytes.length > 0);
    await assert.rejects(stat(this.file(`${FIRST}/.ide/flight-recordings`)));
    this.#proof.jfrRecordedUnderProject = true;
    await this.action("Analyze recording");
    const table = this.panel().$('table[aria-label="JFR event type summary"]');
    await table.waitForDisplayed({ timeout: 15_000 });
    assert.match(await table.getText(), /jdk\./);
    this.#proof.jfrAnalysis = true;
  }
  async rerunCapturedAndRefuseMissingDirectory() {
    await this.setDirectory(SECOND);
    await this.action("Rerun session");
    await this.browser().waitUntil(async () => (await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8")) !== this.#first, { timeout: 20_000 });
    await this.status("run: succeeded (exit 0)");
    const repeated = await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8");
    this.assertProof(repeated, "FIRST", FIRST);
    await assert.rejects(stat(this.file(`${SECOND}/cwd-proof.txt`)));
    this.#proof.completedRerunRetainsCapturedDirectory = true;
    const repeatedRecording = await this.savedRecording();
    assert.notEqual(repeatedRecording, this.#recordingPath);
    assert.ok((await stat(this.file(repeatedRecording))).size > 0);
    assert.deepEqual(await readFile(this.file(this.#recordingPath)), this.#recordingBytes);
    this.#proof.jfrRerunPreservesFirstRecording = true;
    await this.setDirectory("missing-directory");
    await this.action("Run");
    await this.status("Choose an existing application working directory inside the active workspace.");
    assert.equal(await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8"), repeated);
    await assert.rejects(stat(this.file(`${SECOND}/cwd-proof.txt`)));
    this.#proof.invalidDirectoryRefusedWithoutRunningOldClass = true;
    await this.action("Build");
    await this.status("build: succeeded (exit 0)");
    assert.equal(await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8"), repeated);
    this.#proof.buildIgnoresApplicationDirectoryDraft = true;
  }
  async restoreAndDebug() {
    await this.setDirectory(FIRST);
    await this.panel().$("label=Configuration name").$("input").setValue("Application directory");
    await this.panel().$("button=Rename configuration").click();
    await this.browser().refresh();
    await this.#app!.waitForFileExplorer();
    await this.openRun();
    assert.equal(await this.directory().getValue(), FIRST);
    assert.equal(await this.panel().$("label=Configuration name").$("input").getValue(), "Application directory");
    assert.equal(await this.panel().$("label=Project or module directory (workspace-relative)").$("input").getValue(), "module");
    assert.equal(await this.panel().$('input[type="checkbox"]').isSelected(), false);
    this.#proof.namedConfigurationRestored = true;
    this.#proof.executionTrustNotRestored = true;
    await this.panel().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.panel().$('input[type="checkbox"]').click();
    await this.action("Debug");
    const debuggerPanel = this.browser().$('[aria-label="Structured Java debugger"]');
    await this.browser().waitUntil(async () => (await debuggerPanel.getText()).includes("JDI: suspended (entry)"), { timeout: 20_000 });
    await debuggerPanel.$("button=Continue").click();
    await this.status("debug: succeeded (exit 0)");
    const current = await readFile(this.file(`${FIRST}/cwd-proof.txt`), "utf8");
    this.assertProof(current, "FIRST", FIRST);
    assert.notEqual(current, this.#first);
    this.#proof.jdiApplicationDirectoryUsed = true;
    assert.equal(await readFile(this.file(FILE), "utf8"), SOURCE);
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
      if (artifacts) {
        const name = this.#java8Home ? "java8-maven-run-native-evidence.json" : "java-working-directory-native-evidence.json";
        const evidence = this.#java8Home
          ? { ...nativeArtifactEvidence(), javaHome: this.#java8Home,
              mavenLaunchVerified: this.#mavenLaunchVerified, mavenDiscoveryVerified: this.#mavenDiscoveryVerified }
          : this.#proof;
        await writeFile(path.join(artifacts, name), JSON.stringify(evidence, null, 2)+"\n");
      }
    }
  }
  private assertProof(proof: string, resource: string, directory: string) {
    const [id, actualResource, actualDirectory, operatingSystemDirectory] = proof.split("|");
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(actualResource, resource);
    assert.equal(actualDirectory, this.file(directory));
    assert.equal(operatingSystemDirectory, this.file(directory));
  }
  private async savedRecording() {
    const elements = await this.panel().$$("[role=status]").getElements();
    const statuses = await elements.map((element) => element.getText());
    const recording = statuses.find((value) => value.startsWith("JFR recording saved to "))?.slice("JFR recording saved to ".length).trim();
    assert.ok(recording, "The completed JFR session must expose its saved recording.");
    assert.match(recording, /^module\/\.ide\/flight-recordings\/[0-9a-f]+\/recording\.jfr$/);
    return recording;
  }
  private async setDirectory(value: string) { await pasteNativeText(this.#app!, this.directory(), value); }
  private directory() { return this.panel().$("label=Application working directory (workspace-relative; optional)").$("input"); }
  private browser() { return this.#app!.browser(); }
  private panel() { return this.browser().$('[aria-label="Java execution"]'); }
  private file(relative: string) { return path.join(this.#lease!.paths.workspace, relative); }
  private async action(name: string) { const button = this.panel().$(`button=${name}`); await button.waitForEnabled({ timeout: 10_000 }); await button.click(); }
  private async status(text: string) {
    await this.browser().waitUntil(async () => (await this.panel().getText()).includes(text), { timeout: 30_000, timeoutMsg: `Java Run did not show ${text}` });
  }
  private async openRun() {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await palette.$('input[aria-label="Search commands"]').setValue("Open Java Run");
    await palette.$('[role="option"][aria-label="Open Java Run Java"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
  }
}
