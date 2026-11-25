import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { readNativeJavaExecutionStatuses } from "./native-java-execution-status.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

const REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";
const INPUTS = {
  "settings.gradle": "rootProject.name='diagnostic-project'\n",
  "gradle.properties": "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
  "build.gradle": "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\ntasks.withType(JavaCompile).configureEach { options.release = 17 }\nprintln('IDE_DIAGNOSTIC_GUI_SECRET')\n",
  "src/main/java/sample/Example.java": "package sample; public final class Example { public static int answer() { return 42; } }\n",
  "src/test/java/sample/ExampleTest.java": "package sample; public class ExampleTest { @org.junit.Test public void answer() { org.junit.Assert.assertEquals(42, Example.answer()); } }\n",
};
const JUNIT_ARTIFACTS = [
  "junit/junit/4.13.2/junit-4.13.2.pom",
  "junit/junit/4.13.2/junit-4.13.2.jar",
  "org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.pom",
  "org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar",
  "org/hamcrest/hamcrest-parent/1.3/hamcrest-parent-1.3.pom",
];
const TESTNG_ARTIFACTS = [
  "org/testng/testng/7.10.2/testng-7.10.2.pom",
  "org/testng/testng/7.10.2/testng-7.10.2.jar",
  "org/slf4j/slf4j-api/1.7.36/slf4j-api-1.7.36.pom",
  "org/slf4j/slf4j-api/1.7.36/slf4j-api-1.7.36.jar",
  "org/slf4j/slf4j-parent/1.7.36/slf4j-parent-1.7.36.pom",
  "com/beust/jcommander/1.82/jcommander-1.82.pom",
  "com/beust/jcommander/1.82/jcommander-1.82.jar",
  "org/webjars/jquery/3.7.1/jquery-3.7.1.pom",
  "org/webjars/jquery/3.7.1/jquery-3.7.1.jar",
  "org/sonatype/oss/oss-parent/7/oss-parent-7.pom",
];
const DIAGNOSTICS = {
  permission: { cause: "cachePermissionDenied", alert: /cache.*(?:permission|denied|writ)|(?:permission|denied|writ).*cache/i, guidance: "Choose a writable Gradle user home" },
  offline: { cause: "offlineDependencyUnavailable", alert: /offline.*(?:cache|depend)|(?:cache|depend).*offline/i, guidance: "select Prepare Gradle dependencies" },
  plugin: { cause: "offlinePluginResolutionFailed", alert: /offline.*plugin|plugin.*offline/i, guidance: "Check the plugin version and plugin repositories" },
};
export class NativeGradleDiagnosticSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #case: keyof typeof DIAGNOSTICS = "offline";
  #repository?: Server;
  #repositoryAvailable = true;
  #unavailableRepositoryRequests = 0;
  #preparation = false;
  #composite = false;
  #testNg = false;
  #downloaded = new Set<string>();
  #projectPath = "";
  #inputs: Record<string, string> = { ...INPUTS };
  #cache = "";
  #originalEnvironment = new Map<string, string | undefined>();
  #proof = {
    nativeGui: true, e2e: true, ...nativeArtifactEvidence(),
    applicationLocale: null as string | null,
    providerFailureDisplayed: false, causeCode: "", boundedMessage: "",
    refusalHasNoContext: false, rawOutputNotDisplayed: false,
    recoveryAvailable: false, dependencyVisible: false,
    noImplicitCompilation: false, inputsPreserved: false, cleanClose: false,
    projectDirectoryOfferedWithoutStartingShell: false,
    trustedShellStartedInProjectDirectory: false,
    preparedSelectedCache: false, offlineTestPassed: false,
    preparationOpenedFromRefusal: false, returnedForExplicitEvaluation: false,
    preparationFailureVisible: false, preparationRetried: false,
  };
  async prepare(caseName: string) {
    assert.equal(process.platform, "linux");
    assert.ok(caseName === "permission" || caseName === "offline" || caseName === "plugin" ||
      caseName === "prepare" || caseName === "composite" || caseName === "testng");
    this.#composite = caseName === "composite";
    this.#testNg = caseName === "testng";
    if (caseName === "permission" || caseName === "offline" || caseName === "plugin") {
      this.#case = caseName;
    } else {
      this.#preparation = true;
    }
    if (caseName === "plugin") {
      this.#projectPath = "spring project";
      this.#inputs["build.gradle"] = INPUTS["build.gradle"].replace(
        "plugins { id 'java' }",
        "plugins {\n  id 'java'\n  id 'org.springframework.boot' version '4.1.2' apply false\n}",
      );
    }
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    if (this.#preparation) {
      this.#projectPath = "cold Gradle project";
      const repositoryUrl = await this.startRepository();
      this.#inputs["build.gradle"] = INPUTS["build.gradle"].replace(
        "mavenCentral()",
        `maven { url = uri('${repositoryUrl}'); allowInsecureProtocol = true }`,
      );
      if (this.#testNg) {
        this.#inputs["build.gradle"] = this.#inputs["build.gradle"]
          .replace("junit:junit:4.13.2", "org.testng:testng:7.10.2") + "test { useTestNG() }\n";
        this.#inputs["src/test/java/sample/ExampleTest.java"] =
          "package sample; public class ExampleTest { @org.testng.annotations.Test public void answer() { org.testng.Assert.assertEquals(Example.answer(), 42); } }\n";
      }
      if (this.#composite) {
        this.#inputs = {
          ...Object.fromEntries(Object.entries(this.#inputs).map(([file, contents]) =>
            [`nested build/${file}`, contents])),
          "settings.gradle": "rootProject.name = 'composite'\nincludeBuild('outer build') { name = 'outer alias' }\n",
          "gradle.properties": INPUTS["gradle.properties"],
          "outer build/settings.gradle": "rootProject.name = 'outer'\nincludeBuild('../nested build') { name = 'nested alias' }\n",
        };
      }
    }
    for (const [relative, contents] of Object.entries(this.#inputs)) {
      const file = this.file(relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, { flag: "wx" });
    }
    this.#cache = path.join(this.#lease.paths.root, "Gradle diagnostic caché");
    await mkdir(this.#cache);
    if (this.#case === "permission") {
      const sdk = process.env.IDE_JAVA_CONTEXT_TEST_JDK;
      const executable = process.env.IDE_JAVA_CONTEXT_TEST_GRADLE;
      assert.ok(sdk && executable);
      await promisify(execFile)(executable, ["--offline", "--no-daemon", "-g", this.#cache, "--version"], { env: { ...process.env, JAVA_HOME: sdk }, timeout: 15_000, maxBuffer: 128*1024 });
      assert.ok(await this.protectNativeLocks(path.join(this.#cache, "native")) > 0);
      await chmod(this.#cache, 0o500);
      await assert.rejects(writeFile(path.join(this.#cache, "permission-probe"), "must refuse"));
    }
    const daemon = process.env.IDE_REAL_REFACTORKIT_DAEMON;
    assert.ok(daemon && path.isAbsolute(daemon));
    this.setEnvironment("IDE_REFACTORKIT_DAEMON", daemon);
    this.setEnvironment("IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE", "1");
    this.setEnvironment("IDE_REFACTORKIT_ENGINE", path.join(path.dirname(daemon), "refactorkit"));
    this.setEnvironment("IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE", "1");
    this.setEnvironment("IDE_JAVA_CONTEXT_TRACE", "1");
    this.setEnvironment("IDE_JAVA_CONTEXT_TRACE_PATH", path.join(this.#lease.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"));
    await this.#lease.assertConfiguredPathsConfined();
  }
  async observeRefusal() {
    this.#app = new NativeDesktopApplication();
    await this.#app.launch();
    const locale = await this.#app.environmentValue("LC_ALL");
    assert.equal(locale, process.env.LC_ALL);
    this.#proof.applicationLocale = locale ?? null;
    await this.#app.waitForFileExplorer();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.panel().waitForDisplayed({ timeout: 5_000 });
    const sdk = process.env.IDE_JAVA_CONTEXT_TEST_JDK;
    const executable = process.env.IDE_JAVA_CONTEXT_TEST_GRADLE;
    assert.ok(sdk && executable);
    if (this.#projectPath) {
      await this.fill("#java-project-directory", this.#projectPath);
    }
    await this.fill("#java-project-sdk-home", sdk);
    await this.panel().$("summary=Gradle settings").click();
    await this.fill("#java-gradle-executable", executable);
    await this.fill("#java-gradle-user-home", this.#cache);
    await this.evaluate();
    const diagnostic = DIAGNOSTICS[this.#case];
    let message = "";
    await this.browser().waitUntil(async () => {
      const elements = await this.panel().$$('[role="alert"]').getElements();
      const messages = await elements.map((element) => element.getText());
      message = messages.find((value) => diagnostic.alert.test(value)) ?? "";
      return Boolean(message);
    }, { timeout: 45_000, interval: 100, timeoutMsg: "Gradle did not show its classified provider refusal" });
    const trace = await readFile(path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"), "utf8");
    const responses = trace.trim().split("\n").map((line) => JSON.parse(line)).filter((record) => record.event === "refactorkit.daemon.rpc.response" && record.details.method === "project.sync" && record.details.response.result?.status === "refused");
    const error = responses.at(-1)?.details.response.result.error;
    assert.ok(error);
    assert.equal(error.code, "gradle.sync.exportFailed");
    assert.equal(error.cause.code, `gradle.sync.cause.${diagnostic.cause}`);
    assert.equal(error.cause.evidence, "process-output");
    assert.equal(message, error.message);
    await this.browser().waitUntil(async () => (await this.panel().getText()).includes(diagnostic.guidance), {
      timeout: 5_000,
      timeoutMsg: `The IDE did not explain how to recover from ${diagnostic.cause}`,
    });
    if (this.#case === "permission") {
      assert.ok(!(await this.panel().getText()).includes(DIAGNOSTICS.offline.guidance));
      await this.panel().$("summary=Gradle settings").click();
      const userHome = this.panel().$("#java-gradle-user-home");
      assert.equal(await userHome.isDisplayed(), false);
      await this.panel().$("button=Edit Gradle user home").click();
      await userHome.waitForDisplayed({ timeout: 5_000 });
      assert.equal(await this.browser().execute(() => document.activeElement?.id), "java-gradle-user-home");
    }
    this.#proof.providerFailureDisplayed = true;
    this.#proof.causeCode = error.cause.code;
    this.#proof.boundedMessage = message;
    assert.ok(message.length <= 4096);
    for (const excluded of [this.#cache, this.#lease!.paths.workspace, "IDE_DIAGNOSTIC_GUI_SECRET", "org.springframework.boot", "https://", "http://"]) assert.ok(!message.includes(excluded), message);
    this.#proof.rawOutputNotDisplayed = true;
    assert.ok(!(await this.panel().getText()).includes("Effective project context"));
    assert.ok(!(await this.panel().getText()).includes("Partial project context"));
    this.#proof.refusalHasNoContext = true;
    const hasPreparation = this.#case === "offline" || this.#case === "plugin";
    assert.equal(await this.panel().$("button=Open Java Run for Gradle preparation").isExisting(), hasPreparation);
    if (this.#case === "plugin") {
      await this.panel().$("button=Open Gradle project terminal").click();
      const terminal = this.browser().$('section[aria-label="Workspace terminal"]');
      await terminal.waitForDisplayed({ timeout: 5_000 });
      const directory = terminal.$('[aria-label="Terminal directory"]');
      assert.equal(await directory.getValue(), this.#projectPath);
      await directory.setValue(".");
      await this.panel().$("button=Open Gradle project terminal").click();
      await this.browser().waitUntil(async () => (await directory.getValue()) === this.#projectPath, {
        timeout: 5_000,
        timeoutMsg: "Opening the Gradle terminal did not refresh its directory",
      });
      assert.equal(await terminal.$("button=New terminal").isEnabled(), false);
      assert.equal((await terminal.$('[role="tablist"][aria-label="Terminal sessions"]').$$('[role="tab"]').getElements()).length, 0);
      this.#proof.projectDirectoryOfferedWithoutStartingShell = true;
      await terminal.$('input[type="checkbox"]').click();
      await terminal.$("button=New terminal").click();
      const session = terminal.$('[role="tab"][aria-selected="true"]');
      await session.waitForDisplayed({ timeout: 10_000 });
      const processId = / · (\d+) · running$/u.exec(await session.getText())?.[1];
      assert.ok(processId, "The trusted terminal did not start a shell");
      assert.equal(await realpath(`/proc/${processId}/cwd`), await realpath(this.file(".")));
      this.#proof.trustedShellStartedInProjectDirectory = true;
      await terminal.$("button=Close terminal").click();
      await session.waitForExist({ reverse: true, timeout: 10_000 });
    }
  }
  async recover() {
    if (this.#preparation) {
      await this.panel().$("button=Open Java Run for Gradle preparation").click();
      const execution = this.browser().$('section[aria-label="Java execution"]');
      const prepare = execution.$("button=Prepare Gradle dependencies");
      await prepare.waitForDisplayed();
      assert.equal(await prepare.isEnabled(), false);
      assert.equal(this.#downloaded.size, 0);
      this.#proof.preparationOpenedFromRefusal = true;
      await execution.$("label*=I trust this workspace").$("input").click();
      await prepare.waitForEnabled();
      assert.equal(this.#downloaded.size, 0, "Trust alone must not start Gradle");
      if (this.#testNg) {
        this.#repositoryAvailable = false;
        await this.runPreparation("failed");
        assert.ok(this.#unavailableRepositoryRequests > 0);
        assert.equal(this.#downloaded.size, 0);
        assert.equal(await execution.$("button=Open Java Project").isExisting(), false);
        this.#proof.preparationFailureVisible = true;
        this.#repositoryAvailable = true;
      }
      await this.runPreparation("succeeded");
      this.#proof.preparationRetried = this.#testNg;
      for (const artifact of this.repositoryArtifacts().filter((artifact) => artifact.endsWith(".jar")))
        assert.ok(this.#downloaded.has(`/${artifact}`), `${artifact} was not fetched during preparation`);
      await this.stopRepository();
      this.#proof.preparedSelectedCache = true;
      await execution.$("button=Open Java Project").click();
      await this.panel().waitForDisplayed();
      assert.ok(!(await this.panel().getText()).includes("Effective project context"));
      this.#proof.returnedForExplicitEvaluation = true;
    } else {
      const completeCache = process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME;
      assert.ok(completeCache && path.isAbsolute(completeCache));
      await this.fill("#java-gradle-user-home", completeCache);
    }
    await this.evaluate();
    await this.browser().waitUntil(async () => (await this.panel().getText()).includes("gradle-effective-v1 · available"), { timeout: 45_000, interval: 100 });
    const panelText = await this.panel().getText();
    assert.ok(panelText.includes("Effective project context"));
    assert.ok(!panelText.includes(DIAGNOSTICS[this.#case].guidance));
    assert.equal(await this.panel().$("button=Edit Gradle user home").isExisting(), false);
    this.#proof.recoveryAvailable = true;
    const select = this.panel().$("label=Module and source set").$("select");
    const options = await select.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const test = labels.findIndex((label) =>
      label.includes("test (test)") &&
      (!this.#composite || label.includes(`[${this.#projectPath}/nested build :]`)));
    assert.ok(test >= 0, labels.join(", "));
    await select.selectByIndex(test);
    const details = this.panel().$(".//details[starts-with(summary, 'Compile classpath')]");
    if ((await details.getAttribute("open")) === null) await details.$("summary").click();
    assert.ok((await details.getText()).includes(this.#testNg ? "testng-7.10.2.jar" : "junit-4.13.2.jar"));
    this.#proof.dependencyVisible = true;
    const buildPath = this.#composite ? "nested build/build" : "build";
    await assert.rejects(stat(this.file(`${buildPath}/classes/java/main/sample/Example.class`)), { code: "ENOENT" });
    await assert.rejects(stat(this.file(`${buildPath}/classes/java/test/sample/ExampleTest.class`)), { code: "ENOENT" });
    this.#proof.noImplicitCompilation = true;
    for (const [file, contents] of Object.entries(this.#inputs)) assert.equal(await readFile(this.file(file), "utf8"), contents);
    this.#proof.inputsPreserved = true;
    await this.#lease!.assertConfiguredPathsConfined();
    if (this.#preparation) {
      const sdk = process.env.IDE_JAVA_CONTEXT_TEST_JDK;
      const gradle = process.env.IDE_JAVA_CONTEXT_TEST_GRADLE;
      assert.ok(sdk && gradle);
      const result = await promisify(execFile)(gradle, [
        "--offline", "--no-daemon", "--gradle-user-home", this.#cache,
        this.#composite ? ":nested alias:test" : "test",
      ], { cwd: this.file("."), env: { ...process.env, JAVA_HOME: sdk }, timeout: 45_000 });
      assert.match(result.stdout, /BUILD SUCCESSFUL/);
      assert.match(await readFile(this.file(`${buildPath}/test-results/test/TEST-sample.ExampleTest.xml`), "utf8"),
        /tests="1" skipped="0" failures="0" errors="0"/);
      this.#proof.offlineTestPassed = true;
    }
  }
  async close() {
    await this.#app!.closeNativeWindow();
    this.#proof.cleanClose = true;
    assert.ok(this.#proof.providerFailureDisplayed && this.#proof.refusalHasNoContext && this.#proof.rawOutputNotDisplayed && this.#proof.recoveryAvailable && this.#proof.dependencyVisible && this.#proof.noImplicitCompilation && this.#proof.inputsPreserved);
  }
  async dispose() {
    try { await this.#app?.dispose(); }
    finally {
      await this.stopRepository();
      if (this.#case === "permission" && this.#cache) await chmod(this.#cache, 0o700);
      for (const [key, value] of this.#originalEnvironment) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      const artifact = this.#lease?.runnerArtifactPath;
      await this.#lease?.dispose();
      const name = this.#testNg ? "testng" : this.#composite ? "composite" : this.#preparation ? "prepare" : this.#case;
      if (artifact) await writeFile(path.join(artifact, `gradle-diagnostic-${name}-native-evidence.json`), JSON.stringify(this.#proof, null, 2)+"\n");
    }
  }
  private repositoryArtifacts() {
    return this.#testNg ? TESTNG_ARTIFACTS : JUNIT_ARTIFACTS;
  }
  private async runPreparation(expected: "failed" | "succeeded") {
    const execution = this.browser().$('section[aria-label="Java execution"]');
    const previous = await execution.getAttribute("data-session-id");
    const prepare = execution.$("button=Prepare Gradle dependencies");
    await prepare.waitForEnabled();
    await prepare.click();
    let terminalStatus: string | undefined;
    await this.browser().waitUntil(async () => {
      const session = await execution.getAttribute("data-session-id");
      if (!session || session === previous) return false;
      terminalStatus = (await readNativeJavaExecutionStatuses(this.browser())).find((status) =>
        /^Gradle dependency preparation: (succeeded|failed|stopped)\b/u.test(status));
      return Boolean(terminalStatus);
    }, { timeout: 90_000, interval: 100, timeoutMsg: "Gradle dependency preparation did not finish" });
    assert.ok(terminalStatus?.startsWith(`Gradle dependency preparation: ${expected}`), terminalStatus);
  }
  private async startRepository() {
    const repository = process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY;
    assert.ok(repository && path.isAbsolute(repository));
    const content = new Map<string, Buffer>(await Promise.all(this.repositoryArtifacts().map(async (file) =>
      [`/${file}`, await readFile(path.join(repository, file))] as const)));
    const server = createServer((request, response) => {
      const body = content.get(request.url ?? "");
      if (!body || (request.method !== "GET" && request.method !== "HEAD")) {
        response.writeHead(404).end();
        return;
      }
      if (!this.#repositoryAvailable) {
        this.#unavailableRepositoryRequests++;
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { "Content-Length": body.length });
      if (request.method === "GET") this.#downloaded.add(request.url!);
      response.end(request.method === "GET" ? body : undefined);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    this.#repository = server;
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return `http://127.0.0.1:${address.port}`;
  }
  private async stopRepository() {
    const server = this.#repository;
    if (!server) return;
    this.#repository = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  private async protectNativeLocks(directory: string): Promise<number> {
    let count = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) count += await this.protectNativeLocks(file);
      else if (entry.name.endsWith(".lock")) {
        await chmod(file, 0o400);
        count++;
      }
    }
    return count;
  }
  private setEnvironment(key: string, value: string) { this.#originalEnvironment.set(key, process.env[key]); process.env[key] = value; }
  private file(relative: string) { return path.join(this.#lease!.paths.workspace, this.#projectPath, relative); }
  private browser() { return this.#app!.browser(); }
  private panel() { return this.browser().$('section[aria-label="Java project context"]'); }
  private async fill(selector: string, value: string) { await pasteNativeText(this.#app!, this.panel().$(selector), value); }
  private async evaluate() {
    const panel = this.panel();
    await panel.waitForDisplayed({ timeout: 10_000 });
    const settings = panel.$(".//details[summary = 'Gradle settings']");
    if (await settings.getAttribute("open") === null) {
      await settings.$("summary").click();
    }
    const button = panel.$("button=Evaluate Gradle project");
    await button.waitForDisplayed({ timeout: 10_000 });
    await button.waitForEnabled({ timeout: 10_000 });
    await button.scrollIntoView({ block: "center", inline: "nearest" });
    await button.click();
  }
}
