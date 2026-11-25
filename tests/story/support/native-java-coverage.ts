import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";
import {
  captureOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";

const FILE = "service/src/test/java/ChoiceTest.java";
const PREFIX =
  "import org.junit.Test; import static org.junit.Assert.*; public class ChoiceTest { static int expected = ";
const MAIN =
  "public class Choice {\n public static int choose(int n) {\n  if (n > 0) return 7;\n  return 3;\n }\n}\n";
function testSource(expected: string) {
  return `${PREFIX}${expected}; @Test public void positive() throws Exception { assertEquals("native coverage literal", System.getProperty("coverage.literal")); java.nio.file.Files.writeString(java.nio.file.Path.of("test-jdk.txt"), System.getProperty("java.home")); if (Boolean.getBoolean("coverage.hold")) { java.nio.file.Files.writeString(java.nio.file.Path.of("coverage-pid.txt"), "" + ProcessHandle.current().pid()); Thread.sleep(300000); } assertEquals(expected, Choice.choose(1)); } @Test public void negative() { assertEquals(3, Choice.choose(-1)); } }`;
}

export class NativeJavaCoverageSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #descriptor = "";
  #jdk = "";
  #pid?: OwnedApplicationIdentity;
  #firstCoverageSessionId = "";
  #proof = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    untrusted: false,
    measuredBranches: false,
    savedFailure: false,
    frozenCoverageRerun: false,
    allBranches: false,
    coverageHistoryCompared: false,
    coverageHistorySelectionVerified: false,
    coverageThresholdFailed: false,
    coverageThresholdPassed: false,
    coverageThresholdRerunRetained: false,
    repeatedCoverageSessionRetained: false,
    stoppedCoverageThresholdUnavailable: false,
    coverageHistoryRestoredAfterRestart: false,
    coverageHistoryClearPersisted: false,
    coverageHistoryNewRunAfterRestart: false,
    reportedTestViewFiltered: false,
    stoppedJvm: false,
    cleanClose: false,
    executionFailure: null as string | null,
  };
  constructor(readonly tool: "maven" | "gradle") {}
  async prepare() {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    await mkdir(this.file("service/src/main/java"), { recursive: true });
    await mkdir(this.file("service/src/test/java"), { recursive: true });
    await writeFile(this.file("service/src/main/java/Choice.java"), MAIN, { flag: "wx" });
    await writeFile(this.file(FILE), testSource("7"), { flag: "wx" });
    this.#descriptor =
      this.tool === "maven"
        ? '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>native-coverage</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>'
        : "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\n";
    await writeFile(
      this.file(`service/${this.tool === "maven" ? "pom.xml" : "build.gradle"}`),
      this.#descriptor,
      { flag: "wx" },
    );
    if (this.tool === "gradle")
      await writeFile(
        this.file("service/settings.gradle"),
        "rootProject.name = 'native-coverage'\n",
        { flag: "wx" },
      );
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    for (const directory of [
      "service",
      "service/src",
      "service/src/test",
      "service/src/test/java",
    ]) {
      const node = this.browser().$(`[role="treeitem"][data-path="${directory}"]`);
      await node.waitForDisplayed({ timeout: 10000 });
      if ((await node.getAttribute("aria-expanded")) !== "true") await node.click();
    }
    await this.#surface.open(FILE, testSource("7"));
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10000 });
    await this.panel().$('input[placeholder="Workspace root"]').setValue("service");
    await this.panel()
      .$('input[placeholder="com.example.MainTest#computes"]')
      .setValue("ChoiceTest#positive");
    await this.panel().$("label=Build tool").$("select").selectByAttribute("value", this.tool);
    const observed = this.panel().$("p*=Selected JDK:");
    await observed.waitForDisplayed({ timeout: 5000 });
    this.#jdk = await realpath((await observed.getText()).replace(/^Selected JDK:\s*/, ""));
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#jdk);
    await this.button("Add test JVM option").click();
    await this.panel()
      .$("label=Test JVM option 1")
      .$("textarea")
      .setValue("-Dcoverage.literal=native coverage literal");
    await this.panel().$("label=Minimum branches coverage (%)").$("input").setValue("75");
    assert.equal(await this.button("Run tests with coverage").isEnabled(), false);
    this.#proof.untrusted = true;
    await this.panel().$('input[type="checkbox"]').click();
  }
  async first() {
    await this.button("Run tests with coverage").click();
    await this.status("succeeded");
    await this.measured("1 / 2");
    await this.report(1, 0);
    assert.equal(
      await realpath(await readFile(this.file("service/test-jdk.txt"), "utf8")),
      this.#jdk,
    );
    this.#proof.measuredBranches = true;
    await this.threshold("failed", "75");
    this.#proof.coverageThresholdFailed = true;
    const measurement = this.panel().$('[aria-label="Java coverage history"] select');
    await measurement.waitForDisplayed({ timeout: 5_000 });
    this.#firstCoverageSessionId = await measurement.getValue();
    assert.ok(this.#firstCoverageSessionId);
  }
  async failure() {
    await this.#surface!.replaceCharacter(FILE, PREFIX.length, "9", testSource("9"));
    assert.equal(await readFile(this.file(FILE), "utf8"), testSource("7"));
    await this.button("Run tests with coverage").click();
    await this.status("failed");
    await this.measured("1 / 2");
    await this.report(1, 1);
    assert.equal(await readFile(this.file(FILE), "utf8"), testSource("9"));
    await this.#surface!.assertDirty(FILE, false);
    this.#proof.savedFailure = true;
  }
  async rerun() {
    await this.#surface!.replaceCharacter(FILE, PREFIX.length, "7", testSource("7"));
    await this.panel()
      .$('input[placeholder="com.example.MainTest#computes"]')
      .setValue("ChoiceTest#negative");
    await this.panel().$("label=Minimum branches coverage (%)").$("input").setValue("40");
    await this.panel().$('[aria-label="Java test results"]').$("button=Rerun failed tests").click();
    await this.status("succeeded");
    await this.measured("1 / 2");
    await this.report(1, 0);
    await this.threshold("failed", "75");
    this.#proof.coverageThresholdRerunRetained = true;
    assert.equal(await readFile(this.file(FILE), "utf8"), testSource("7"));
    this.#proof.frozenCoverageRerun = true;
  }
  async repeat() {
    const previous = await this.panel().getAttribute("data-session-id");
    assert.ok(previous);
    await this.button("Rerun session").click();
    await this.browser().waitUntil(async () => {
      const session = await this.panel().getAttribute("data-session-id");
      return Boolean(session && session !== previous);
    }, { timeout: 10_000, timeoutMsg: "Coverage rerun did not create a new session" });
    await this.status("succeeded");
    await this.measured("1 / 2");
    await this.report(1, 0, "positive");
    await this.threshold("failed", "75");
    this.#proof.repeatedCoverageSessionRetained = true;
  }
  async all() {
    const filter = this.panel().$('input[placeholder="com.example.MainTest#computes"]');
    await filter.click();
    await this.browser().keys(["Control", "a"]);
    await this.browser().keys("Backspace");
    assert.equal(await filter.getValue(), "");
    await this.panel().$("label=Minimum branches coverage (%)").$("input").setValue("75");
    await this.button("Run tests with coverage").click();
    await this.status("succeeded");
    await this.measured("2 / 2");
    await this.report(2, 0);
    this.#proof.allBranches = true;
    await this.threshold("passed", "75");
    this.#proof.coverageThresholdPassed = true;
  }
  async stop() {
    await this.panel()
      .$('input[placeholder="com.example.MainTest#computes"]')
      .setValue("ChoiceTest#positive");
    await this.button("Add test JVM option").click();
    await this.panel().$("label=Test JVM option 2").$("textarea").setValue("-Dcoverage.hold=true");
    await this.button("Run tests with coverage").click();
    await this.browser().waitUntil(
      async () => {
        try {
          return /^[1-9][0-9]+$/.test(
            await readFile(this.file("service/coverage-pid.txt"), "utf8"),
          );
        } catch {
          return false;
        }
      },
      { timeout: 60000, interval: 100 },
    );
    const pid = Number(await readFile(this.file("service/coverage-pid.txt"), "utf8"));
    this.#pid = await captureOwnedApplication(pid, {
      executable: await realpath(path.join(this.#jdk, "bin/java")),
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.#lease!.paths.workspace,
      ideHome: this.#lease!.paths.ideHome,
    });
    assert.equal(await this.button("Stop").isEnabled(), true);
    await this.button("Stop").click();
    await this.status("stopped");
    await this.browser().waitUntil(
      async () => {
        try {
          await access(`/proc/${pid}`);
          return false;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
          throw e;
        }
      },
      { timeout: 5000, interval: 50 },
    );
    const coverage = this.panel().$('[aria-label="Java test coverage"]');
    assert.match(await coverage.getText(), /JaCoCo: unavailable/);
    assert.equal(await coverage.$("table").isExisting(), false);
    const historical = this.panel().$('[aria-label="Java coverage history"]');
    assert.equal(await historical.$('select').$$('option').length, 5);
    await this.threshold("unavailable", "75");
    this.#proof.stoppedCoverageThresholdUnavailable = true;
    this.#proof.stoppedJvm = true;
  }
  async compareHistory() {
    const history = this.panel().$('[aria-label="Java coverage history"]');
    await history.waitForDisplayed({ timeout: 5_000 });
    const selects = await history.$$("select");
    assert.equal(selects.length, 2);
    assert.equal(await selects[0].$$("option").length, 5);
    const entries = await selects[0].$$("option").getElements();
    const labels = await entries.map((option) => option.getText());
    assert.equal(labels.filter((label) => label.includes("ChoiceTest#positive")).length, 4);
    const current = await selects[0].$("option:checked").getText();
    assert.match(current, /No IDE test filter/u);
    await selects[1].selectByAttribute("value", this.#firstCoverageSessionId);
    const baseline = await selects[1].$("option:checked").getText();
    assert.match(baseline, /ChoiceTest#positive/u);
    const branches = history.$(".//tr[th='branches']");
    await this.browser().waitUntil(
      async () => (await branches.getText()).includes("+50.0 pp"),
      { timeout: 5_000, timeoutMsg: "Coverage history did not compare the measured branch percentages." },
    );
    const text = await branches.getText();
    assert.ok(text.includes("100.0%") && text.includes("50.0%"), text);
    this.#proof.coverageHistorySelectionVerified = true;
    this.#proof.coverageHistoryCompared = true;
  }
  async filterReportedTests() {
    const results = this.panel().$('[aria-label="Java test results"]');
    const search = results.$("label=Search reported tests").$("input");
    const outcome = results.$("label=Show test outcomes").$("select");
    await search.setValue("NEGATIVE");
    await this.browser().waitUntil(
      async () => (await results.$$("li").length) === 1,
      { timeout: 5_000, timeoutMsg: "Search did not select the reported negative test." },
    );
    assert.ok((await results.$("li").getText()).includes("negative"));
    await outcome.selectByAttribute("value", "failures");
    await this.browser().waitUntil(
      async () => (await results.getText()).includes("No matching reported tests."),
      { timeout: 5_000, timeoutMsg: "Outcome filtering did not show an empty failure view." },
    );
    assert.ok((await results.getText()).includes("2 reported tests: 2 passed"));
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), false);
    await outcome.selectByAttribute("value", "all");
    await search.click();
    await this.browser().keys(["Control", "a"]);
    await this.browser().keys("Backspace");
    await this.browser().waitUntil(
      async () => (await results.$$("li").length) === 2,
      { timeout: 5_000, timeoutMsg: "Clearing filters did not restore the complete test view." },
    );
    this.#proof.reportedTestViewFiltered = true;
  }
  async reopenAndClearHistory() {
    await this.reopenForHistory();
    const history = this.panel().$('[aria-label="Java coverage history"]');
    await history.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await history.$("select").$$("option").length, 5);
    assert.equal(await this.panel().$('[aria-label="Java test coverage"]').isExisting(), false);
    assert.equal(await this.panel().$('[aria-label="Coverage threshold result"]').isExisting(), false);
    assert.equal(await this.button("Run tests with coverage").isEnabled(), false);
    await this.compareHistory();
    this.#proof.coverageHistoryRestoredAfterRestart = true;
    await this.panel().$('[aria-label="Remove test JVM option 2"]').click();
    await this.panel().$('input[placeholder="com.example.MainTest#computes"]').setValue("ChoiceTest");
    await this.panel().$('input[type="checkbox"]').click();
    await this.button("Run tests with coverage").waitForEnabled({ timeout: 10_000 });
    await this.button("Run tests with coverage").click();
    await this.status("succeeded");
    await this.measured("2 / 2");
    await this.browser().waitUntil(
      async () => (await history.$("select").$$("option").length) === 6,
      { timeout: 5_000, timeoutMsg: "The new application's coverage run collided with saved execution history." },
    );
    this.#proof.coverageHistoryNewRunAfterRestart = true;
    await history.$("button=Clear saved coverage history").click();
    await history.waitForExist({ reverse: true, timeout: 5_000 });
    await this.reopenForHistory();
    assert.equal(await this.panel().$('[aria-label="Java coverage history"]').isExisting(), false);
    this.#proof.coverageHistoryClearPersisted = true;
  }
  private async reopenForHistory() {
    await this.#app!.closeNativeWindow();
    await this.#app!.assertExited();
    await this.#app!.dispose();
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
  }
  async close() {
    assert.equal(await readFile(this.file("service/src/main/java/Choice.java"), "utf8"), MAIN);
    assert.equal(await readFile(this.file(FILE), "utf8"), testSource("7"));
    assert.equal(
      await readFile(
        this.file(`service/${this.tool === "maven" ? "pom.xml" : "build.gradle"}`),
        "utf8",
      ),
      this.#descriptor,
    );
    await this.#app!.closeNativeWindow();
    await this.#app!.assertExited();
    await this.#lease!.assertConfiguredPathsConfined();
    this.#proof.cleanClose = true;
  }
  async cleanup() {
    const errors: unknown[] = [];
    try {
      await this.#app?.dispose();
    } catch (e) {
      errors.push(e);
    }
    try {
      await this.#lease?.dispose();
    } catch (e) {
      errors.push(e);
    }
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, `java-${this.tool}-coverage-evidence.json`),
        JSON.stringify(
          {
            ...this.#proof,
            tool: this.tool,
            jdk: this.#jdk,
            ownedTestJvm: this.#pid,
            application: this.#app?.evidence(),
            environment: this.#lease.evidence(),
          },
          null,
          2,
        ),
      );
    if (errors.length) throw new AggregateError(errors, "Native coverage cleanup failed.");
  }
  private async measured(branches: string) {
    const region = this.panel().$('[aria-label="Java test coverage"]');
    await region.waitForDisplayed({ timeout: 5000 });
    let text = "";
    await this.browser().waitUntil(async () => {
      text = await region.getText();
      return /JaCoCo: ready/.test(text);
    }, { timeout: 15_000, interval: 100 }).catch(() => {
      assert.match(text, /JaCoCo: ready/, "JaCoCo did not finish collecting the current measurement");
    });
    const observed = await this.browser().execute(() => {
      const list = document.querySelector('[aria-label="Java test coverage"] dl');
      return (
        Array.from(list?.querySelectorAll("dt") ?? []).find(
          (node) => node.textContent === "Branches",
        )?.nextElementSibling?.textContent ?? ""
      );
    });
    assert.ok(observed.includes(`(${branches})`), observed);
    assert.equal(await region.$("table").isExisting(), true);
    assert.equal(
      await region
        .$("select")
        .getText()
        .then((t) => t.includes("Choice.java")),
      true,
    );
  }
  private async report(total: number, failed: number, expectedMethod = "") {
    const relative =
      this.tool === "maven"
        ? "service/target/surefire-reports/TEST-ChoiceTest.xml"
        : "service/build/test-results/test/TEST-ChoiceTest.xml";
    const reportFile = this.file(relative);
    assert.equal(await realpath(reportFile), reportFile);
    const before = await lstat(reportFile);
    assert.ok(before.isFile() && before.nlink === 1 && before.size <= 128 * 1024);
    const bytes = await readFile(reportFile);
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      [
        "-c",
        `import json, sys, xml.etree.ElementTree as ET
with open(sys.argv[1], 'rb') as stream: raw = stream.read(131073)
assert len(raw) <= 131072 and b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw
root = ET.fromstring(raw)
assert root.tag == 'testsuite' and root.get('name') == 'ChoiceTest'
cases = root.findall('testcase')
assert all(c.get('classname') == 'ChoiceTest' and c.get('name') in ['positive', 'negative'] for c in cases)
assert len(cases) == int(root.get('tests'))
if sys.argv[2]: assert [case.get('name') for case in cases] == [sys.argv[2]]
print(json.dumps({k: int(root.get(k, '0')) for k in ['tests', 'failures', 'errors', 'skipped']}))`,
        reportFile,
        expectedMethod,
      ],
      { timeout: 5000, maxBuffer: 8192 },
    );
    const report = JSON.parse(stdout) as {
      tests: number;
      failures: number;
      errors: number;
      skipped: number;
    };
    const after = await lstat(reportFile);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.deepEqual(await readFile(reportFile), bytes);
    assert.equal(report.tests, total);
    assert.equal(report.failures, failed);
    assert.equal(report.errors, 0);
    assert.equal(report.skipped, 0);
    const text = await this.panel().$('[aria-label="Java test results"]').getText();
    assert.ok(text.includes(`${total} reported tests:`), text);
  }
  private async status(state: string) {
    let observed = "";
    try {
      await this.browser().waitUntil(
        async () => {
          observed = await this.panel().getText();
          return new RegExp(`coverage: ${state}(?: \\(exit [0-9]+\\))?`).test(observed);
        },
        { timeout: 60000, interval: 100 },
      );
      assert.match(observed, new RegExp(`coverage: ${state}(?: \\(exit [0-9]+\\))?`));
    } catch (error) {
      this.#proof.executionFailure = observed;
      throw new Error(`Coverage did not reach ${state}. Java Run panel: ${observed}`, { cause: error });
    }
  }
  private async threshold(state: string, required: string) {
    const result = this.panel().$('[aria-label="Coverage threshold result"]');
    await result.waitForDisplayed({ timeout: 5_000 });
    const text = await result.getText();
    assert.ok(text.includes(`Coverage thresholds: ${state}.`), text);
    assert.ok(text.includes(`required ${required}%`), text);
  }
  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }
  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }
}
