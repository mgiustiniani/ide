import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

const TEST_JVM_LITERAL = "café 'quoted'\nline";

function fixture(unicode: boolean) {
  const packageName = unicode ? "café" : "fixture";
  const mainType = unicode ? "Avvío𐐀" : "Main";
  const testType = unicode ? "Próva𐐀" : "PlainJdkTestNgTest";
  const pass = unicode ? "réussit𐐀" : "passes", fail = unicode ? "échoue" : "fails";
  const mainSource = unicode ? `package ${packageName};
public final class ${mainType} {
  public static void main(String[] args) {
    int número = 42;
    System.out.println("UNICODE_NATIVE_MAIN_OK:" + número);
  }
}
` : "package fixture; public final class Main { public static void main(String[] args) {} }\n";
  const testSource = `package ${packageName};
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import org.testng.Assert;
import org.testng.annotations.Test;
public final class ${testType} {
  private static void record(String file) throws Exception {
    Assert.assertEquals(System.getProperty("fixture.testng.literal"), ${JSON.stringify(TEST_JVM_LITERAL)});
    String home = Paths.get(System.getProperty("java.home")).toRealPath().toString();
    Files.write(Paths.get(file), home.getBytes(StandardCharsets.UTF_8));
  }
  @Test public void ${pass}() throws Exception { record("testng-passed.txt"); }
  @Test public void ${fail}() throws Exception { record("testng-failed.txt"); Assert.fail("PLAIN_JDK_TESTNG_FAILURE"); }
}
`;
  return { unicode, pass, fail, mainClass: `${packageName}.${mainType}`, testClass: `${packageName}.${testType}`,
    mainFile: `src/main/java/${packageName}/${mainType}.java`, testFile: `src/test/java/${packageName}/${testType}.java`,
    mainSource, testSource, fixedTestSource: testSource.replace('Assert.fail("PLAIN_JDK_TESTNG_FAILURE");', "Assert.assertTrue(true);") };
}
const REPORT_PARSER = `import json, sys, xml.etree.ElementTree as ET
with open(sys.argv[1], 'rb') as stream:
    raw = stream.read(131073)
assert len(raw) <= 131072
assert b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw
root = ET.fromstring(raw)
assert root.tag == 'testsuite'
cases = root.findall('testcase')
print(json.dumps({
    'tests': int(root.get('tests', '0')),
    'failures': int(root.get('failures', '0')),
    'errors': int(root.get('errors', '0')),
    'skipped': int(root.get('skipped', '0')),
    'cases': [{'className': case.get('classname'), 'name': case.get('name'), 'failed': case.find('failure') is not None or case.find('error') is not None} for case in cases],
}))
`;

type Report = {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  cases: Array<{ className: string | null; name: string | null; failed: boolean }>;
};

export class NativeJavaJdkTestNgSession {
  private readonly fixture: ReturnType<typeof fixture>;
  constructor(unicode = false) { this.fixture = fixture(unicode); }
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #jdkHome = "";
  #testRuntimeHome = "";
  #reportPaths: string[] = [];
  #proof = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    dependenciesCopiedInsideWorkspace: false,
    untrustedActionsDisabled: false,
    nativeTestNgSuiteReported: false,
    failedMethodRerunReported: false,
    testNgDiscoveryDidNotRunBodies: false,
    capturedTestNgMethodRanAfterSettingsChanged: false,
    uniqueFreshReports: false,
    unicodeMainRun: false,
    unicodeDebugger: false,
    cleanClose: false,
  };

  async prepare(): Promise<void> {
    const configuredClasspath = process.env.IDE_TESTNG_CLASSPATH;
    assert.ok(
      configuredClasspath,
      "IDE_TESTNG_CLASSPATH must provide the real TestNG runtime jars",
    );
    const dependencies = configuredClasspath
      .split(path.delimiter)
      .filter(Boolean)
      .map((dependency) => path.resolve(dependency));
    assert.ok(dependencies.length > 0, "TestNG runtime classpath is empty");
    assert.ok(
      dependencies.some((dependency) => /testng[^/]*\.jar$/i.test(path.basename(dependency))),
      "IDE_TESTNG_CLASSPATH must include the TestNG runtime jar",
    );

    const configuredJdk = process.env.IDE_JAVA_HOME ?? process.env.JAVA_HOME;
    assert.ok(configuredJdk, "IDE_JAVA_HOME or JAVA_HOME must select a full JDK");
    this.#jdkHome = await realpath(configuredJdk);
    const release = await readFile(path.join(this.#jdkHome, "release"), "utf8");
    this.#testRuntimeHome = /^JAVA_VERSION="1\.8\./m.test(release)
      ? await realpath(path.join(this.#jdkHome, "jre"))
      : this.#jdkHome;
    for (const executable of ["java", "javac", "jar"]) {
      await access(path.join(this.#jdkHome, "bin", executable));
    }

    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    await mkdir(this.file("lib"), { recursive: true });
    const classpathEntries: string[] = [];
    const copiedNames = new Set<string>();
    for (const dependency of dependencies) {
      const metadata = await lstat(dependency);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1);
      const canonical = await realpath(dependency);
      const name = path.basename(canonical);
      assert.match(name, /^[A-Za-z0-9._+-]+\.jar$/);
      assert.ok(!copiedNames.has(name), `duplicate TestNG runtime jar name: ${name}`);
      copiedNames.add(name);
      const relative = `lib/${name}`;
      await copyFile(canonical, this.file(relative), fsConstants.COPYFILE_EXCL);
      classpathEntries.push(relative);
    }
    await mkdir(path.dirname(this.file(this.fixture.mainFile)), { recursive: true });
    await mkdir(path.dirname(this.file(this.fixture.testFile)), { recursive: true });
    await writeFile(this.file(this.fixture.mainFile), this.fixture.mainSource, { flag: "wx" });
    await writeFile(this.file(this.fixture.testFile), this.fixture.testSource, { flag: "wx" });
    this.#proof.dependenciesCopiedInsideWorkspace = true;
    await this.#lease.assertConfiguredPathsConfined();
    this.classpathEntries = classpathEntries;
  }

  private classpathEntries: string[] = [];

  async launch(): Promise<void> {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.openSource(this.fixture.mainFile, this.fixture.mainSource);
    await this.openSource(this.fixture.testFile, this.fixture.testSource);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", "jdk");
    await pasteNativeText(this.app(), this.panel().$('input[placeholder="com.example.Main"]'), this.fixture.mainClass);
    const runtimeClasspath = this.classpathEntries.join("\n");
    const runtimeClasspathInput = this.panel()
      .$("label*=Additional runtime classpath")
      .$("textarea");
    await pasteNativeText(this.app(), runtimeClasspathInput, runtimeClasspath);
    assert.equal(await runtimeClasspathInput.getValue(), runtimeClasspath);
    await this.panel()
      .$("label=Plain-JDK test framework")
      .$("select")
      .selectByAttribute("value", "testng");
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#jdkHome);
    await this.button("Add test JVM option").click();
    await pasteNativeText(this.app(), this.panel().$("label=Test JVM option 1").$("textarea"),
      `-Dfixture.testng.literal=${TEST_JVM_LITERAL}`);
    await this.browser().waitUntil(
      async () => (await this.panel().getText()).includes(`Selected JDK: ${this.#jdkHome}`),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "the selected JDK was not reflected in Java Run",
      },
    );
  }

  async runAndDebugUnicodeMain(): Promise<void> {
    assert.equal(this.fixture.unicode, true);
    await this.panel().$('input[type="checkbox"]').click();
    await this.request("Run");
    await this.waitStatus("run", false);
    assert.ok((await this.panel().getText()).includes("UNICODE_NATIVE_MAIN_OK:42"));
    this.#proof.unicodeMainRun = true;
    await this.panel().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.request("Debug");
    const debuggerPanel = this.browser().$('[aria-label="Structured Java debugger"]');
    await this.browser().waitUntil(async () => (await debuggerPanel.getText()).includes("JDI: suspended (entry)"), { timeout: 20_000 });
    await pasteNativeText(this.app(), debuggerPanel.$('input[placeholder="com.example.Main:12"]'), `${this.fixture.mainClass}:5`);
    await debuggerPanel.$("button=Set breakpoint").waitForEnabled({ timeout: 5_000 });
    await debuggerPanel.$("button=Set breakpoint").click();
    await debuggerPanel.$('[aria-label="Java breakpoints"]').waitForDisplayed({ timeout: 5_000 });
    await debuggerPanel.$("button=Continue").click();
    await this.browser().waitUntil(async () => (await debuggerPanel.getText()).includes("JDI: suspended (breakpoint)"), { timeout: 10_000 });
    await this.browser().waitUntil(async () => (await debuggerPanel.$('[aria-label="Java breakpoints"]').getText()).includes(`${this.fixture.mainClass}:5: verified`), { timeout: 5_000 });
    await this.browser().$("button=Refresh loaded JVM classes").click();
    await this.browser().waitUntil(async () => (await this.browser().$('[aria-label="Prepared JVM class 1"]').getText()).includes(this.fixture.mainClass), { timeout: 5_000 });
    await pasteNativeText(this.app(), debuggerPanel.$("label=Watch expression").$("input"), "número");
    await debuggerPanel.$("button=Evaluate once").click();
    await this.browser().waitUntil(async () => (await debuggerPanel.$('[aria-label="Evaluation result"]').getText()).includes("42"), { timeout: 5_000 });
    await debuggerPanel.$("button=Continue").click();
    await this.waitStatus("debug", false);
    this.#proof.unicodeDebugger = true;
  }

  async assertUntrusted(): Promise<void> {
    assert.equal(await this.panel().$('input[type="checkbox"]').isSelected(), false);
    for (const action of ["Build", "Run tests", "Discover tests"])
      assert.equal(await this.button(action).isEnabled(), false);
    await this.assertMissing(`.ide/java/classes/${this.fixture.testClass.replaceAll(".", "/")}.class`);
    await this.assertMissing("testng-passed.txt");
    await this.assertMissing("testng-failed.txt");
    assert.equal(await readFile(this.file(this.fixture.testFile), "utf8"), this.fixture.testSource);
    this.#proof.untrustedActionsDisabled = true;
  }

  async trustAndRunSuite(): Promise<void> {
    if (!await this.panel().$('input[type="checkbox"]').isSelected()) await this.panel().$('input[type="checkbox"]').click();
    await this.request("Run tests");
  }

  async assertFailedSuite(): Promise<void> {
    await this.waitStatus("test", true);
    const results = this.results();
    await results.waitForDisplayed({ timeout: 5_000 });
    const text = await results.getText();
    assert.ok(text.includes("2 reported tests: 1 passed, 1 failed, 0 errors, 0 skipped"), text);
    assert.ok(text.includes(`passed: ${this.fixture.testClass} · ${this.fixture.pass}`), text);
    assert.ok(text.includes(`failed: ${this.fixture.testClass} · ${this.fixture.fail}`), text);
    assert.ok(text.includes("PLAIN_JDK_TESTNG_FAILURE"), text);
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), true);
    assert.equal(await readFile(this.file("testng-passed.txt"), "utf8"), this.#testRuntimeHome);
    assert.equal(await readFile(this.file("testng-failed.txt"), "utf8"), this.#testRuntimeHome);
    const report = await this.latestReport();
    assert.equal(report.tests, 2);
    assert.equal(report.failures, 1);
    assert.equal(report.errors, 0);
    assert.deepEqual(
      new Set(report.cases.map((test) => `${test.className}#${test.name}:${test.failed}`)),
      new Set([`${this.fixture.testClass}#${this.fixture.pass}:false`, `${this.fixture.testClass}#${this.fixture.fail}:true`]),
    );
    this.#proof.nativeTestNgSuiteReported = true;
  }

  async repairAndRerunFailure(): Promise<void> {
    await this.surface().replaceText(
      this.fixture.testFile,
      'Assert.fail("PLAIN_JDK_TESTNG_FAILURE");',
      "Assert.assertTrue(true);",
      this.fixture.fixedTestSource,
    );
    await this.request("Rerun failed tests");
  }

  async assertRerunPassed(): Promise<void> {
    await this.waitStatus("test", false);
    const results = this.results();
    await results.waitForDisplayed({ timeout: 5_000 });
    const text = await results.getText();
    assert.ok(text.includes("1 reported tests: 1 passed, 0 failed, 0 errors, 0 skipped"), text);
    assert.ok(text.includes(`passed: ${this.fixture.testClass} · ${this.fixture.fail}`), text);
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), false);
    await this.surface().assertDirty(this.fixture.testFile, false);
    assert.equal(await readFile(this.file(this.fixture.testFile), "utf8"), this.fixture.fixedTestSource);
    const report = await this.latestReport();
    assert.equal(report.tests, 1);
    assert.equal(report.failures, 0);
    assert.equal(report.cases[0]?.className, this.fixture.testClass);
    assert.equal(report.cases[0]?.name, this.fixture.fail);
    assert.equal(report.cases[0]?.failed, false);
    assert.equal(await readFile(this.file("testng-failed.txt"), "utf8"), this.#testRuntimeHome);
    this.#proof.failedMethodRerunReported = true;
  }

  async discoverTests(): Promise<void> {
    await this.removeIfPresent("testng-passed.txt");
    await this.removeIfPresent("testng-failed.txt");
    await this.request("Discover tests");
  }

  async assertDiscoveryDidNotRunBodies(): Promise<void> {
    await this.waitStatus("discover", false);
    const discovery = this.browser().$('[aria-label="Discovered Java tests"]');
    await discovery.waitForDisplayed({ timeout: 5_000 });
    const text = await discovery.getText();
    assert.ok(text.includes("Discovery: ready. 1 classes, 2 method-name groups."), text);
    assert.ok(text.includes(`${this.fixture.testClass.split(".").at(-1)} (TestNG)`), text);
    assert.equal(
      await discovery.$(`[aria-label="Run method group ${this.fixture.testClass}#${this.fixture.pass}"]`).isEnabled(),
      true,
    );
    await this.assertMissing("testng-passed.txt");
    await this.assertMissing("testng-failed.txt");
    this.#proof.testNgDiscoveryDidNotRunBodies = true;
  }

  async changeCurrentSettingsAndRunCapturedMethod(): Promise<void> {
    await this.panel()
      .$("label=Plain-JDK test framework")
      .$("select")
      .selectByAttribute("value", "junit");
    await this.panel()
      .$('input[placeholder="com.example.MainTest#computes"]')
      .setValue("Unrelated#missing");
    await pasteNativeText(this.app(), this.panel().$("label*=Test JVM option 1").$("textarea"),
      "-Dfixture.testng.literal=changed form");
    await this.browser()
      .$('[aria-label="Discovered Java tests"]')
      .$(`[aria-label="Run method group ${this.fixture.testClass}#${this.fixture.pass}"]`)
      .click();
  }

  async assertCapturedMethodPassed(): Promise<void> {
    await this.waitStatus("test", false);
    const results = this.results();
    await results.waitForDisplayed({ timeout: 5_000 });
    const text = await results.getText();
    assert.ok(text.includes("1 reported tests: 1 passed, 0 failed, 0 errors, 0 skipped"), text);
    assert.ok(text.includes(`passed: ${this.fixture.testClass} · ${this.fixture.pass}`), text);
    assert.equal(await readFile(this.file("testng-passed.txt"), "utf8"), this.#testRuntimeHome);
    await this.assertMissing("testng-failed.txt");
    const report = await this.latestReport();
    assert.equal(report.tests, 1);
    assert.equal(report.failures, 0);
    assert.equal(report.cases[0]?.name, this.fixture.pass);
    this.#proof.capturedTestNgMethodRanAfterSettingsChanged = true;
    assert.ok(new Set(this.#reportPaths).size === 3, this.#reportPaths.join("\n"));
    this.#proof.uniqueFreshReports = true;
  }

  async close(): Promise<void> {
    await this.app().closeNativeWindow();
    this.#proof.cleanClose = true;
  }

  async assertFinal(): Promise<void> {
    await this.app().assertExited();
    await this.#lease!.assertConfiguredPathsConfined();
    assert.equal(await readFile(this.file(this.fixture.testFile), "utf8"), this.fixture.fixedTestSource);
    if (this.fixture.unicode) { assert.equal(this.#proof.unicodeMainRun, true); assert.equal(this.#proof.unicodeDebugger, true); }
  }

  evidence() {
    return {
      ...this.#proof,
      ...nativeArtifactEvidence(),
      fixture: { mainClass: this.fixture.mainClass, testClass: this.fixture.testClass, passedMethod: this.fixture.pass, failedMethod: this.fixture.fail },
      selectedJdkHome: this.#jdkHome,
      observedTestRuntimeHome: this.#testRuntimeHome,
      reportPaths: this.#reportPaths,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  diagnostics() {
    return this.#app?.redactedDiagnostics([this.fixture.mainSource, this.fixture.testSource, this.fixture.fixedTestSource]) ?? "";
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
          path.join(this.#lease.runnerArtifactPath, this.fixture.unicode ? "java-unicode-native-evidence.json" : "java-plain-jdk-testng-native-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "plain-JDK TestNG native cleanup failed");
  }

  private app() {
    assert.ok(this.#app);
    return this.#app;
  }

  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }

  private browser() {
    return this.app().browser();
  }

  private workspace() {
    assert.ok(this.#lease);
    return this.#lease.paths.workspace;
  }

  private file(relative: string) {
    const absolute = path.resolve(this.workspace(), relative);
    const fromRoot = path.relative(this.workspace(), absolute);
    assert.ok(fromRoot && !fromRoot.startsWith("..") && !path.isAbsolute(fromRoot));
    return absolute;
  }

  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }

  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }

  private results() {
    return this.panel().$('[aria-label="Java test results"]');
  }

  private async request(name: string) {
    await this.button(name).waitForEnabled({ timeout: 10_000 });
    await this.button(name).click();
  }

  private async openSource(relativePath: string, expected: string) {
    const parts = relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const folderPath = parts.slice(0, index).join("/");
      const folder = this.browser().$(`[role="treeitem"][data-path="${folderPath}"]`);
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    await this.surface().open(relativePath, expected);
  }

  private async waitStatus(operation: string, failed: boolean) {
    const status = new RegExp(
      `${operation}: ${failed ? "failed \\(exit [1-9][0-9]*\\)" : "succeeded \\(exit 0\\)"}`,
    );
    let observedText = "";
    try {
      await this.browser().waitUntil(
        async () => {
          observedText = await this.panel().getText();
          return status.test(observedText);
        },
        {
          timeout: 30_000,
          interval: 100,
          timeoutMsg: `plain-JDK TestNG status did not reach ${operation}`,
        },
      );
    } catch (cause) {
      throw new Error(
        `plain-JDK TestNG status did not reach ${operation}; Java Run panel showed: ${observedText}`,
        { cause },
      );
    }
  }

  private async latestReport(): Promise<Report> {
    const directory = this.file(".ide/java/test-results");
    const candidates: string[] = [];
    const visit = async (current: string, depth: number): Promise<void> => {
      assert.ok(depth <= 5, "TestNG report directory exceeded the fixture depth");
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      assert.ok(entries.length <= 256, "TestNG report directory exceeded the fixture entry limit");
      for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        const metadata = await lstat(absolute);
        assert.ok(!metadata.isSymbolicLink(), "TestNG reports cannot be symlinks");
        if (metadata.isDirectory()) await visit(absolute, depth + 1);
        else if (metadata.isFile() && /^TEST-.*\.xml$/.test(entry.name)) {
          assert.equal(metadata.nlink, 1);
          candidates.push(absolute);
        }
      }
    };
    await visit(directory, 0);
    const unseen = candidates.filter((candidate) => !this.#reportPaths.includes(candidate));
    assert.equal(unseen.length, 1, `expected one fresh TestNG report, found ${unseen.length}`);
    const reportPath = unseen[0]!;
    assert.ok(
      path.relative(this.workspace(), reportPath).startsWith(".ide/java/test-results/run-"),
    );
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      ["-c", REPORT_PARSER, reportPath],
      { timeout: 5_000, maxBuffer: 8_192 },
    );
    const report = JSON.parse(stdout) as Report;
    this.#reportPaths.push(reportPath);
    return report;
  }

  private async removeIfPresent(relative: string) {
    try {
      const absolute = this.file(relative);
      const metadata = await lstat(absolute);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1);
      const { unlink } = await import("node:fs/promises");
      await unlink(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async assertMissing(relative: string) {
    await assert.rejects(access(this.file(relative)), { code: "ENOENT" });
  }
}
