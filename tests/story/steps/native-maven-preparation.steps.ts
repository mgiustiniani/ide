import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeScenarioEnvironmentLease } from "../support/native-scenario-environment.js";
import { NativeDesktopApplication } from "../support/native-desktop-application.js";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { pasteNativeText } from "../support/native-text-input.js";

const directory = "cold Maven reactor";
const parent = "<parent><groupId>sample</groupId><artifactId>reactor</artifactId><version>1</version></parent>";
const pom = (body: string) => `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>${body}</project>\n`;
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const sessions = new WeakMap<StoryWorld, MavenPreparation>();

class MavenPreparation {
  lease?: NativeScenarioEnvironmentLease;
  app?: NativeDesktopApplication;
  inputs = new Map<string, string>();
  repository = "";
  populatedRepository = "";
  mirror = "";
  sdk = "";
  trace = "";
  environment = new Map<string, string | undefined>();

  async prepare(compiler: "explicit" | "implicit-wrapper" | "implicit-runtime" = "explicit") {
    const launcher = process.env.IDE_JAVA_CONTEXT_TEST_MAVEN;
    const artifacts = process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY;
    const sdk = process.env.IDE_JAVA_CONTEXT_TEST_JDK;
    const daemon = process.env.IDE_REAL_REFACTORKIT_DAEMON;
    assert.ok(launcher && path.isAbsolute(launcher), "Set IDE_JAVA_CONTEXT_TEST_MAVEN to a Maven launcher admitting repository access.");
    assert.ok(artifacts && path.isAbsolute(artifacts));
    assert.ok(sdk && daemon);
    this.sdk = sdk;
    this.populatedRepository = artifacts;
    this.lease = await NativeScenarioEnvironmentLease.acquire("REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001");
    this.repository = path.join(this.lease.paths.root, "empty Maven repository");
    this.mirror = path.join(this.lease.paths.root, "fixture mirror");
    this.trace = path.join(this.lease.runnerArtifactPath,
      compiler === "implicit-wrapper" ? "maven-compiler-options-wrapper.log" : "maven-preparation-wrapper.log");
    await mkdir(this.repository);
    await symlink(artifacts, this.mirror, "dir");
    const settings = path.join(this.lease.paths.root, "fixture-settings.xml");
    await writeFile(settings, `<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"><mirrors><mirror>
<id>fixture</id><mirrorOf>*</mirrorOf><url>${pathToFileURL(this.mirror).href}</url>
</mirror></mirrors></settings>\n`);
    const property = "$" + "{fixture.option}";
    const compilerProperties = compiler !== "explicit"
      ? "<maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target>"
      : "<maven.compiler.release>17</maven.compiler.release>";
    this.inputs = new Map([
      ["mvnw", `#!/bin/sh\nprintf '%s\\n' "$@" >> ${quote(this.trace)}\nexec ${quote(launcher)} --settings ${quote(settings)} "$@"\n`],
      ["pom.xml", pom(`<groupId>sample</groupId><artifactId>reactor</artifactId><version>1</version><packaging>pom</packaging>
<modules><module>library</module><module>app</module></modules>
<properties>${compilerProperties}</properties>
<profiles><profile><id>quality</id><properties><fixture.option>chosen</fixture.option></properties></profile>
<profile><id>skip-check</id><properties><fixture.option>wrong</fixture.option></properties></profile></profiles>`)],
      ["library/pom.xml", pom(parent + "<artifactId>library</artifactId>")],
      ["app/pom.xml", pom(parent + `<artifactId>app</artifactId><dependencies>
<dependency><groupId>sample</groupId><artifactId>library</artifactId><version>1</version></dependency>
<dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency>
</dependencies><build><plugins><plugin><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version>
<configuration><systemPropertyVariables><fixture.option>${property}</fixture.option></systemPropertyVariables></configuration>
</plugin></plugins></build>`)],
      ["library/src/main/java/sample/Answer.java", "package sample; public final class Answer { public static int value() { return 42; } }\n"],
      ["app/src/test/java/sample/AnswerTest.java", `package sample;
public class AnswerTest {
  @org.junit.Test public void verifiesReactorAndProfile() {
    org.junit.Assert.assertEquals(42, Answer.value());
    org.junit.Assert.assertEquals("chosen", System.getProperty("fixture.option"));
  }
}\n`],
    ]);
    if (compiler === "implicit-runtime") {
      this.inputs.delete("mvnw");
      this.environment.set("PATH", process.env.PATH);
      process.env.PATH = [path.dirname(launcher), process.env.PATH].filter(Boolean).join(path.delimiter);
    }
    for (const [file, contents] of this.inputs) {
      const target = this.file(file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents, { flag: "wx", mode: file === "mvnw" ? 0o700 : 0o600 });
    }
    for (const [key, value] of Object.entries({
      IDE_REFACTORKIT_DAEMON: daemon,
      IDE_REFACTORKIT_ENGINE: path.join(path.dirname(daemon), "refactorkit"),
      IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE: "1",
      IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE: "1",
      IDE_JAVA_CONTEXT_TRACE: "1",
      IDE_JAVA_CONTEXT_TRACE_PATH: path.join(this.lease.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"),
    })) {
      this.environment.set(key, process.env[key]);
      process.env[key] = value;
    }
  }
  private async openProject(repository: string) {
    this.app = new NativeDesktopApplication();
    await this.app.launch();
    await this.app.waitForFileExplorer();
    const browser = this.app.browser();
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    const project = browser.$('section[aria-label="Java project context"]');
    await project.waitForDisplayed();
    await pasteNativeText(this.app, project.$("#java-project-directory"), directory);
    await pasteNativeText(this.app, project.$("#java-project-sdk-home"), this.sdk);
    await project.$("summary=Maven settings").click();
    await pasteNativeText(this.app, project.$("#java-maven-repository"), repository);
    await pasteNativeText(this.app, project.$("label*=Active profiles").$("textarea"), "quality");
    await pasteNativeText(this.app, project.$("label*=Inactive profiles").$("textarea"), "skip-check");
    const synchronize = project.$("button=Synchronize project");
    return { browser, project, synchronize };
  }
  async verify() {
    const { browser, project, synchronize } = await this.openProject(this.repository);
    await synchronize.waitForEnabled();
    await synchronize.scrollIntoView({ block: "center", inline: "nearest" });
    await synchronize.click();
    await project.$("p*=The local Maven repository is missing artifacts").waitForDisplayed({ timeout: 25_000 });
    assert.match(await project.getText(), /maven-effective-v1 · offline-missing/);
    await project.$("button=Open Java Run for Maven verification").click();
    const execution = browser.$('section[aria-label="Java execution"]');
    const verify = execution.$("button=Verify Maven project");
    await verify.waitForDisplayed();
    assert.equal(await verify.isEnabled(), false);
    await execution.$("label*=I trust this workspace").$("input").click();
    await verify.waitForEnabled();
    assert.deepEqual(await readdir(this.repository), []);
    await assert.rejects(readFile(this.trace), { code: "ENOENT" });
    await verify.click();
    await browser.waitUntil(async () => {
      const text = await execution.getText();
      if (text.includes("Maven project verification: failed")) throw new Error(text.slice(-4000));
      return text.includes("Maven project verification: succeeded");
    }, { timeout: 120_000 });
    const args = (await readFile(this.trace, "utf8")).trim().split("\n");
    assert.ok(args.includes(`-Dmaven.repo.local=${this.repository}`));
    assert.ok(args.includes("-P+quality,!skip-check"));
    assert.equal(args.at(-1), "verify");
    await readFile(path.join(this.repository, "junit/junit/4.13.2/junit-4.13.2.jar"));
    await readFile(this.file("library/target/library-1.jar"));
    const report = await readFile(this.file("app/target/surefire-reports/TEST-sample.AnswerTest.xml"), "utf8");
    for (const result of ['tests="1"', 'errors="0"', 'failures="0"']) assert.ok(report.includes(result));
    await unlink(this.mirror);
    await execution.$("button=Open Java Project").click();
    await synchronize.waitForEnabled();
    await synchronize.scrollIntoView();
    await synchronize.click();
    let projectText = "";
    try {
      await browser.waitUntil(async () => {
        projectText = await project.getText();
        return projectText.includes("maven-effective-v1 · available");
      }, { timeout: 20_000 });
    } catch (cause) {
      throw new Error(`Maven project context did not become available: ${projectText.slice(-4500)}`, { cause });
    }
    const sources = project.$("label=Module and source set").$("select");
    const options = await sources.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const appTest = labels.findIndex((label) => label.includes("app") && label.includes("test (test)"));
    assert.ok(appTest >= 0, labels.join(", "));
    await sources.selectByIndex(appTest);
    const classpath = project.$(".//details[starts-with(summary, 'Compile classpath')]");
    if ((await classpath.getAttribute("open")) === null) await classpath.$("summary").click();
    assert.match(await classpath.getText(), /junit-4\.13\.2\.jar/);
    assert.equal(await project.$("p*=The local Maven repository is missing artifacts").isExisting(), false);
  }
  async verifyCompilerConfiguration() {
    const { browser, project, synchronize } = await this.openProject(this.populatedRepository);
    await synchronize.waitForEnabled();
    await synchronize.scrollIntoView({ block: "center", inline: "nearest" });
    await synchronize.click();
    const guidance = project.$("p*=Declare the intended Java release");
    await guidance.waitForDisplayed({ timeout: 25_000 });
    assert.match(await project.$('[role="alert"]').getText(), /complete effective compiler options for source set (?:main|test)\b/);
    await assert.rejects(readFile(this.trace), { code: "ENOENT" });

    const original = this.inputs.get("pom.xml")!;
    const corrected = original.replace(
      "<maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target>",
      "<maven.compiler.release>17</maven.compiler.release>",
    );
    assert.notEqual(corrected, original);
    await writeFile(this.file("pom.xml"), corrected);
    try {
      await synchronize.waitForEnabled();
      await synchronize.scrollIntoView({ block: "center", inline: "nearest" });
      await synchronize.click();
      await browser.waitUntil(async () => (await project.getText()).includes("maven-effective-v1 · available"), {
        timeout: 25_000,
      });
      assert.equal(await guidance.isExisting(), false);
      await assert.rejects(readFile(this.trace), { code: "ENOENT" });
      await assert.rejects(readFile(this.file("library/target/library-1.jar")), { code: "ENOENT" });
    } finally {
      await writeFile(this.file("pom.xml"), original);
    }
  }
  async verifyInstalledCompiler() {
    const plugin = process.env.IDE_JAVA_CONTEXT_MAVEN_COMPILER_PLUGIN;
    assert.ok(plugin, "Set IDE_JAVA_CONTEXT_MAVEN_COMPILER_PLUGIN to the expected default for the selected distribution.");
    const { browser, project, synchronize } = await this.openProject(this.populatedRepository);
    await synchronize.waitForEnabled();
    await synchronize.scrollIntoView({ block: "center", inline: "nearest" });
    await synchronize.click();
    await browser.waitUntil(async () => (await project.getText()).includes("maven-effective-v1 · available"), { timeout: 25_000 });
    const sourceSets = project.$("label=Module and source set").$("select");
    const choices = await sourceSets.$$("option").getElements();
    const labels = await choices.map((option) => option.getText());
    for (const kind of ["main", "test"]) {
      const selection = labels.findIndex((label) => label.includes("app") && label.includes(`${kind} (${kind})`));
      assert.ok(selection >= 0, `Missing ${kind} source set in ${labels.join(", ")}`);
      await sourceSets.selectByIndex(selection);
      const options = project.$(".//details[starts-with(summary, 'Compiler options')]");
      if (await options.getAttribute("open") === null) await options.$("summary").click();
      assert.equal(await options.$("p=complete").isDisplayed(), true);
      assert.ok((await options.getText()).includes(`pluginVersion ${plugin}`));
    }
    assert.equal(await project.$("p*=Declare the intended Java release").isExisting(), false);
    for (const module of ["library", "app"]) {
      await assert.rejects(readdir(this.file(`${module}/target`)), { code: "ENOENT" });
    }

    await browser.$('[role="tab"][aria-label="Java Run"]').click();
    const execution = browser.$('section[aria-label="Java execution"]');
    const synchronized = execution.$("label=Synchronized module and source set").$("select");
    await synchronized.waitForDisplayed();
    const modules = await synchronized.$$("option").getElements();
    const moduleLabels = await modules.map((option) => option.getText());
    const appMain = moduleLabels.findIndex((label) => label.includes("app") && label.includes("main"));
    assert.ok(appMain >= 0, moduleLabels.join(", "));
    await synchronized.selectByIndex(appMain);
    await execution.$("label*=I trust this workspace").$("input").click();
    const build = execution.$("button=Build");
    await build.waitForEnabled();
    await build.click();
    await browser.waitUntil(async () => {
      const output = await execution.getText();
      if (output.includes("build: failed")) throw new Error(output.slice(-4000));
      return output.includes("build: succeeded (exit 0)") && output.includes(`compiler:${plugin}:compile`);
    }, { timeout: 90_000, timeoutMsg: `Build must succeed with Maven Compiler Plugin ${plugin}` });
    const built = await readFile(this.file("library/target/classes/sample/Answer.class"));
    assert.equal(built.readUInt32BE(0), 0xcafebabe);
    assert.equal(built.readUInt16BE(6), 61);
  }
  async close() {
    for (const [file, text] of this.inputs) assert.equal(await readFile(this.file(file), "utf8"), text);
    await this.app!.closeNativeWindow();
  }
  async dispose() {
    try { await this.app?.dispose(); }
    finally {
      for (const [key, value] of this.environment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await this.lease?.dispose();
    }
  }
  private file(relative: string) {
    return path.join(this.lease!.paths.workspace, directory, relative);
  }
}

Given<StoryWorld>("the native Java IDE has a two-module Maven reactor and an empty local repository",
  { timeout: 25_000 }, async function () {
    assert.ok(this.targetEvidence && matchesNativeArtifactEvidence(this.targetEvidence));
    const session = new MavenPreparation();
    sessions.set(this, session);
    await session.prepare();
  });
Given<StoryWorld>("the native Java IDE has a Maven reactor with source and target and an implicit compiler plugin",
  { timeout: 25_000 }, async function () {
    assert.ok(this.targetEvidence && matchesNativeArtifactEvidence(this.targetEvidence));
    const session = new MavenPreparation();
    sessions.set(this, session);
    await session.prepare("implicit-wrapper");
  });
Given<StoryWorld>("the native Java IDE has a Maven reactor with an implicit compiler and a local Maven distribution",
  { timeout: 25_000 }, async function () {
    assert.ok(this.targetEvidence && matchesNativeArtifactEvidence(this.targetEvidence));
    const session = new MavenPreparation();
    sessions.set(this, session);
    await session.prepare("implicit-runtime");
  });
When<StoryWorld>("Java Run builds with the compiler plugin shown during Maven synchronization",
  { timeout: 180_000 }, async function () {
    await sessions.get(this)!.verifyInstalledCompiler();
  });
When<StoryWorld>("the person verifies Maven from Java Run and synchronizes with the mirror removed",
  { timeout: 195_000 }, async function () {
    await sessions.get(this)!.verify();
  });
When<StoryWorld>("the person sees compiler configuration guidance and resynchronizes with an explicit Java release",
  { timeout: 120_000 }, async function () {
    await sessions.get(this)!.verifyCompilerConfiguration();
  });
Then<StoryWorld>("the Maven verification window closes with source and build inputs unchanged",
  { timeout: 20_000 }, async function () {
    await sessions.get(this)!.close();
  });
After<StoryWorld>({ tags: "@native-java-maven-preparation", timeout: 30_000 }, async function () {
  await sessions.get(this)?.dispose();
});
