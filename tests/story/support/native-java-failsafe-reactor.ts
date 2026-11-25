import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { pasteNativeText } from "./native-text-input.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";
import { readNativeJUnitReport, type NativeJUnitReport } from "./native-java-test-report.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";

const PROJECT = "service";
const MAIN = "service/app/src/main/java/example/Main.java";
const APP_IT = "service/app/src/test/java/example/AppIT.java";
const CORE_HOMONYM = "service/core/src/test/java/example/AppIT.java";
const APP_IT_INITIAL = `package example;
import org.junit.Test;
import java.nio.file.*;
import static org.junit.Assert.*;
public class AppIT {
  @Test public void savedSource() throws Exception {
    Files.writeString(Path.of("target/app-failsafe-proof.txt"), "selected\\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    System.out.println("APP_FAILSAFE_SELECTED");
    assertEquals(Core.expected(), 0);
  }
}
`;
const APP_IT_REPAIRED = APP_IT_INITIAL.replace("assertEquals(Core.expected(), 0)", "assertEquals(Core.expected(), 1)");

const INPUTS: Readonly<Record<string, string>> = {
  "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>native.fixture</groupId><artifactId>failsafe-reactor</artifactId><version>1</version><packaging>pom</packaging>
  <modules><module>core</module><module>app</module></modules>
  <properties><maven.compiler.release>21</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><executions><execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions></plugin>
  </plugins></build>
</project>
`,
  "core/pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>native.fixture</groupId><artifactId>failsafe-reactor</artifactId><version>1</version><relativePath>../pom.xml</relativePath></parent><artifactId>core</artifactId></project>\n`,
  "app/pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>native.fixture</groupId><artifactId>failsafe-reactor</artifactId><version>1</version><relativePath>../pom.xml</relativePath></parent><artifactId>app</artifactId><dependencies><dependency><groupId>native.fixture</groupId><artifactId>core</artifactId><version>1</version></dependency></dependencies></project>\n`,
  "core/src/main/java/example/Core.java": "package example; public class Core { public static int expected() { return 1; } }\n",
  "app/src/main/java/example/Main.java": "package example; public class Main { public static void main(String[] args) {} }\n",
  "core/src/test/java/example/CoreTest.java": `package example;
import org.junit.Test;
import static org.junit.Assert.*;
public class CoreTest { @Test public void savedSource() { System.out.println("CORE_SUREFIRE_OK"); assertEquals(1, 1); } }
`,
  "app/src/test/java/example/AppTest.java": `package example;
import org.junit.Test;
import static org.junit.Assert.*;
public class AppTest { @Test public void savedSource() { System.out.println("APP_SUREFIRE_OK"); assertEquals(1, 1); } }
`,
  "core/src/test/java/example/AppIT.java": `package example;
import org.junit.Test;
import java.nio.file.*;
import static org.junit.Assert.*;
public class AppIT {
  @Test public void savedSource() throws Exception {
    Files.writeString(Path.of("target/core-failsafe-proof.txt"), "core\\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    System.out.println("CORE_FAILSAFE_OK");
    assertEquals(Core.expected(), 1);
  }
}
`,
  "app/src/test/java/example/AppIT.java": APP_IT_INITIAL,
};

export class NativeJavaFailsafeReactorSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #selectedJdk = "";
  #initialReports?: { core: NativeJUnitReport; app: NativeJUnitReport };
  #rerunReport?: NativeJUnitReport;
  #failureObservation?: unknown;
  #evidence = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    twoModuleMavenReactor: false,
    untrustedIntegrationActionDisabled: false,
    freshFailsafeReportsPresentedAcrossModules: false,
    SurefireReportsExcludedFromResults: false,
    openedReportOwnedSource: false,
    failedMethodRerunUsesCapturedReactor: false,
    capturedIntegrationSessionRepeated: false,
    coreModuleNotRerun: false,
    repairedSourceSaved: false,
    projectDescriptorsUnchanged: false,
    cleanNativeCloseAndStorageConfined: false,
  };

  constructor(
    private readonly artifactKind: "release-no-bundle" | "appimage",
    private readonly reports: "standard" | "custom",
  ) {}

  private pom() {
    if (this.reports === "standard") return INPUTS["pom.xml"]!;
    const output = "${project.basedir}/test-evidence/failsafe";
    return INPUTS["pom.xml"]!.replace(
      "<artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version>",
      `<artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><configuration><reportsDirectory>${output}</reportsDirectory><summaryFile>${output}/failsafe-summary.xml</summaryFile></configuration>`,
    );
  }

  private reportDirectory(module: "core" | "app") {
    return `${module}/${this.reports === "custom" ? "test-evidence/failsafe" : "target/failsafe-reports"}`;
  }

  private reportPath(module: "core" | "app") {
    return `${this.reportDirectory(module)}/TEST-example.AppIT.xml`;
  }

  async prepare() {
    const { stdout } = await promisify(execFile)("mvn", ["--version"], {
      timeout: 10_000,
      maxBuffer: 8_192,
    });
    assert.match(stdout, /Apache Maven [\d.]+/);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    for (const [file, content] of Object.entries(INPUTS)) {
      const absolute = this.file(file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, file === "pom.xml" ? this.pom() : content, { flag: "wx" });
    }
    await writeFile(path.join(this.workspace(), "Root.java"), "workspace root sentinel\n", {
      flag: "wx",
    });
    await this.#lease.assertConfiguredPathsConfined();
  }

  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.openSource(APP_IT, APP_IT_INITIAL);
    await this.openSource(MAIN, INPUTS["app/src/main/java/example/Main.java"]);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
    assert.equal(await this.panel().$("label=Build tool").$("select").getValue(), "auto");
    await this.panel().$('input[placeholder="Workspace root"]').setValue(PROJECT);
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("example.Main");
    const selected = this.panel().$("p*=Selected JDK:");
    await selected.waitForDisplayed({ timeout: 5_000 });
    this.#selectedJdk = await realpath((await selected.getText()).replace(/^Selected JDK:\s*/, ""));
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#selectedJdk);
    assert.equal(await this.panel().$('input[placeholder="com.example.MainTest#computes"]').getValue(), "");
    if (this.reports === "custom") {
      const field = this.panel().$("label*=Custom test report directories").$("textarea");
      const directories = (["core", "app"] as const).map((module) => `${PROJECT}/${this.reportDirectory(module)}`).join("\n");
      await pasteNativeText(this.app(), field, directories);
      assert.equal(await field.getValue(), directories);
    }
  }

  async assertUntrusted() {
    assert.equal(await this.panel().$('input[type="checkbox"]').isSelected(), false);
    for (const action of ["Run integration tests", "Run integration tests with coverage"])
      assert.equal(await this.button(action).isEnabled(), false);
    for (const relative of [
      this.reportPath("core"),
      this.reportPath("app"),
      "core/target/surefire-reports/TEST-example.CoreTest.xml",
      "app/target/surefire-reports/TEST-example.AppTest.xml",
      "core/target/core-failsafe-proof.txt",
      "app/target/app-failsafe-proof.txt",
    ])
      await this.assertMissing(relative);
    assert.equal(await readFile(this.file("pom.xml"), "utf8"), this.pom());
    this.#evidence.untrustedIntegrationActionDisabled = true;
  }

  async trustAndRun() {
    await this.panel().$('input[type="checkbox"]').click();
    await this.button("Run integration tests").click();
  }

  async assertInitialFailure() {
    await this.waitStatus("integration-test", true);
    const coreReport = await readNativeJUnitReport(
      this.workspace(),
      `${PROJECT}/${this.reportPath("core")}`,
      "CORE_FAILSAFE_OK",
      "example.AppIT",
      "example.AppIT",
    );
    const appReport = await readNativeJUnitReport(
      this.workspace(),
      `${PROJECT}/${this.reportPath("app")}`,
      "APP_FAILSAFE_SELECTED",
      "example.AppIT",
      "example.AppIT",
    );
    assert.equal(coreReport.tests, 1);
    assert.equal(coreReport.failures, 0);
    assert.equal(appReport.tests, 1);
    assert.equal(appReport.failures, 1);
    assert.equal(appReport.failureMessage, "expected:<1> but was:<0>");
    const coreSurefire = await readNativeJUnitReport(
      this.workspace(),
      "service/core/target/surefire-reports/TEST-example.CoreTest.xml",
      "CORE_SUREFIRE_OK",
      "example.CoreTest",
      "example.CoreTest",
    );
    const appSurefire = await readNativeJUnitReport(
      this.workspace(),
      "service/app/target/surefire-reports/TEST-example.AppTest.xml",
      "APP_SUREFIRE_OK",
      "example.AppTest",
      "example.AppTest",
    );
    assert.equal(coreSurefire.failures + appSurefire.failures, 0);
    this.#initialReports = { core: coreReport, app: appReport };
    assert.equal(await readFile(this.file("core/target/core-failsafe-proof.txt"), "utf8"), "core\n");
    assert.equal(await readFile(this.file("app/target/app-failsafe-proof.txt"), "utf8"), "selected\n");

    const results = this.panel().$('[aria-label="Java test results"]');
    await results.waitForDisplayed({ timeout: 5_000 });
    let text = await results.getText();
    assert.ok(text.includes("2 reported tests: 1 passed, 1 failed"), text);
    assert.ok(text.includes("failed: example.AppIT · savedSource"), text);
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), true);
    const coreSuite = results.$("details:not([open]) > summary");
    await coreSuite.waitForDisplayed({ timeout: 5_000 });
    await coreSuite.click();
    text = await results.getText();
    assert.ok(text.includes(`${PROJECT}/${this.reportPath("core")}`), text);
    assert.ok(text.includes(`${PROJECT}/${this.reportPath("app")}`), text);
    assert.ok(!text.includes("surefire-reports"), text);
    this.#evidence.twoModuleMavenReactor = true;
    this.#evidence.freshFailsafeReportsPresentedAcrossModules = true;
    this.#evidence.SurefireReportsExcludedFromResults = true;
  }

  async repairAndRerunFailed() {
    await this.activate(APP_IT, APP_IT_INITIAL);
    await this.surface().replaceText(
      APP_IT,
      "assertEquals(Core.expected(), 0);",
      "assertEquals(Core.expected(), 1);",
      APP_IT_REPAIRED,
    );
    await this.surface().assertDirty(APP_IT, true);
    await this.panel().$('input[placeholder="com.example.MainTest#computes"]').setValue("MissingIT#absent");
    await this.button("Rerun failed tests").click();
  }

  async openReportedFailure() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.browser().$("#java-project-directory").setValue(PROJECT);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const language = this.browser().$('[aria-labelledby="jdt-language-service-heading"]');
    const start = language.$("button=Start");
    const lifecycle = language.$('[aria-label="Eclipse JDT LS lifecycle status"]');
    if ((await lifecycle.getText()).trim().toLowerCase() === "stopped") await start.click();
    await this.browser().waitUntil(
      async () => {
        if ((await lifecycle.getText()).trim().toLowerCase() !== "ready") return false;
        const status = await this.browser().executeAsync((done) => {
          const { invoke } = (window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string) => Promise<{ lifecycle?: string; projectPath?: string }>;
            };
          }).__TAURI_INTERNALS__;
          void invoke("get_java_language_service_status").then(done, () => done(null));
        }) as { lifecycle?: string; projectPath?: string } | null;
        return status?.lifecycle === "initialized" && status.projectPath === PROJECT;
      },
      { timeout: 60_000, interval: 150, timeoutMsg: "JDT LS did not become ready for the reactor" },
    );
    const search = this.browser().$('[aria-label="Search Java workspace symbols"]');
    await search.$("#java-workspace-symbol-query").setValue("AppIT");
    const submit = search.$("button=Search");
    await submit.waitForEnabled({ timeout: 5_000 });
    await submit.click();
    await this.browser().waitUntil(async () => {
      const text = await this.browser().execute(
        () => document.querySelector('ul[aria-label="Java workspace symbol results"]')?.textContent ?? "",
      );
      return text.includes(APP_IT) && text.includes(CORE_HOMONYM);
    }, { timeout: 30_000, interval: 300, timeoutMsg: "JDT LS did not index both AppIT declarations" });
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const result = this.panel().$('details[open] > button[aria-label="Open source for example.AppIT test savedSource"]');
    await result.waitForDisplayed({ timeout: 10_000 });
    await result.click();
    const failureLine = APP_IT_INITIAL.split("\n").findIndex((line) => line.includes("assertEquals(Core.expected(), 0)")) + 1;
    await this.browser().waitUntil(
      () => this.browser().execute((file, line) => {
        const tab = document.querySelector(`[role="tab"][data-path="${CSS.escape(file)}"]`);
        const cursor = document.querySelector('[data-testid="editor-cursor-position"]');
        return tab?.getAttribute("aria-selected") === "true" &&
          cursor?.textContent?.trim() === `Ln ${line}, Col 1`;
      }, APP_IT, failureLine),
      { timeout: 15_000, interval: 100, timeoutMsg: "The failing AppIT did not open from the app report" },
    );
    await this.surface().assertBuffer(APP_IT, APP_IT_INITIAL);
    assert.equal(await this.surface().tab(CORE_HOMONYM).isExisting(), false);
    this.#evidence.openedReportOwnedSource = true;
  }

  async repeatIntegrationSession() {
    const previous = await this.panel().getAttribute("data-session-id");
    assert.ok(previous);
    await this.button("Rerun session").click();
    await this.browser().waitUntil(async () => {
      const current = await this.panel().getAttribute("data-session-id");
      return Boolean(current && current !== previous);
    }, { timeout: 10_000, timeoutMsg: "The integration test rerun did not create a new session" });
  }

  async assertRerun(expectedExecutions = 2) {
    await this.waitStatus("integration-test", false);
    const appReport = await readNativeJUnitReport(
      this.workspace(),
      `${PROJECT}/${this.reportPath("app")}`,
      "APP_FAILSAFE_SELECTED",
      "example.AppIT",
      "example.AppIT",
    );
    assert.equal(appReport.tests, 1);
    assert.equal(appReport.failures, 0);
    assert.notEqual(appReport.sha256, this.#rerunReport?.sha256 ?? this.#initialReports?.app.sha256);
    this.#rerunReport = appReport;
    const coreReport = await readNativeJUnitReport(
      this.workspace(),
      `${PROJECT}/${this.reportPath("core")}`,
      "CORE_FAILSAFE_OK",
      "example.AppIT",
      "example.AppIT",
    );
    assert.equal(coreReport.sha256, this.#initialReports?.core.sha256);
    assert.equal(await readFile(this.file("core/target/core-failsafe-proof.txt"), "utf8"), "core\n");
    assert.equal(
      await readFile(this.file("app/target/app-failsafe-proof.txt"), "utf8"),
      "selected\n".repeat(expectedExecutions),
    );
    await this.surface().assertDirty(APP_IT, false);
    assert.equal(await readFile(this.file("app/src/test/java/example/AppIT.java"), "utf8"), APP_IT_REPAIRED);
    const results = this.panel().$('[aria-label="Java test results"]');
    const text = await results.getText();
    assert.ok(text.includes("1 reported tests: 1 passed, 0 failed"), text);
    assert.ok(text.includes("passed: example.AppIT · savedSource"), text);
    assert.ok(text.includes(`${PROJECT}/${this.reportPath("app")}`), text);
    assert.ok(!text.includes(`${PROJECT}/${this.reportDirectory("core")}`), text);
    assert.ok(!text.includes("surefire-reports"), text);
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), false);
    this.#evidence.failedMethodRerunUsesCapturedReactor = true;
    this.#evidence.capturedIntegrationSessionRepeated = expectedExecutions === 3;
    this.#evidence.coreModuleNotRerun = true;
    this.#evidence.repairedSourceSaved = true;
  }

  async requestClose() {
    await this.app().closeNativeWindow();
  }

  async assertClosed() {
    await this.app().assertExited();
    assert.equal(await readFile(this.file("pom.xml"), "utf8"), this.pom());
    for (const [relative, content] of Object.entries(INPUTS)) {
      const expected = relative === "app/src/test/java/example/AppIT.java" ? APP_IT_REPAIRED : relative === "pom.xml" ? this.pom() : content;
      assert.equal(await readFile(this.file(relative), "utf8"), expected, relative);
    }
    assert.equal(await readFile(path.join(this.workspace(), "Root.java"), "utf8"), "workspace root sentinel\n");
    assert.ok(this.#rerunReport);
    await this.lease().assertConfiguredPathsConfined();
    this.#evidence.projectDescriptorsUnchanged = true;
    this.#evidence.cleanNativeCloseAndStorageConfined = true;
  }

  async captureFailure() {
    try {
      this.#failureObservation = await this.browser().execute(() => ({
        statuses: Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map(
          (item) => item.textContent?.slice(0, 2_000),
        ),
        consoleOutput: document.querySelector('[aria-label="Java console output"]')?.textContent?.slice(-12_000),
        testResults: document.querySelector('[aria-label="Java test results"]')?.textContent?.slice(0, 8_000),
        workspaceSymbols: document.querySelector('[aria-label="Java workspace symbol results"]')?.textContent,
      }));
      await this.browser().saveScreenshot(path.join(this.lease().runnerArtifactPath, `java-maven-failsafe-reactor-${this.reports}-failure.png`));
    } catch {
      // Keep the original scenario failure if the native window already exited.
    }
  }

  async dispose() {
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
      if (this.#lease) {
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, `java-maven-failsafe-reactor-${this.reports}-evidence.json`),
          JSON.stringify(this.evidence(), null, 2),
        );
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "Maven Failsafe reactor cleanup failed");
  }

  evidence() {
    return {
      ...this.#evidence,
      packagedApplication: this.artifactKind === "appimage",
      artifactKind: this.artifactKind,
      reportLayout: this.reports,
      selectedJdk: this.#selectedJdk,
      initialReports: this.#initialReports,
      rerunReport: this.#rerunReport,
      failureObservation: this.#failureObservation,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  diagnostics() {
    return this.#app?.redactedDiagnostics(Object.values(INPUTS)) ?? "";
  }

  private async openSource(file: string, expected: string) {
    await this.browser().keys(["Control", "p"]);
    const dialog = this.browser().$('[role="dialog"][aria-label="Go to File"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.app(), dialog.$('[aria-label="Search workspace files"]'), file);
    const result = dialog.$(`[role="option"][data-path="${file}"]`);
    await result.waitForDisplayed({ timeout: 5_000 });
    await result.click();
    await dialog.waitForExist({ reverse: true, timeout: 10_000 });
    await this.surface().tab(file).waitForDisplayed({ timeout: 10_000 });
    await this.surface().assertBuffer(file, expected);
  }

  private async activate(file: string, expected: string) {
    await this.surface().tab(file).click();
    await this.browser().waitUntil(
      async () => (await this.surface().tab(file).getAttribute("aria-selected")) === "true",
      { timeout: 2_000, interval: 50 },
    );
    await this.surface().focus(file);
    await this.surface().assertBuffer(file, expected);
  }

  private async waitStatus(operation: string, failed: boolean) {
    const pattern = new RegExp(`${operation}: ${failed ? "failed \\(exit [1-9][0-9]*\\)" : "succeeded \\(exit 0\\)"}`);
    await this.browser().waitUntil(async () => pattern.test(await this.panel().getText()), {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Maven reactor ${operation} outcome was not presented`,
    });
  }

  private async assertMissing(relative: string) {
    await assert.rejects(access(this.file(relative)), { code: "ENOENT" });
  }

  private file(relative: string) {
    return path.join(this.workspace(), PROJECT, relative);
  }

  private workspace() {
    return this.lease().paths.workspace;
  }

  private browser() {
    return this.app().browser();
  }

  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }

  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }

  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }

  private app() {
    assert.ok(this.#app);
    return this.#app;
  }

  private lease() {
    assert.ok(this.#lease);
    return this.#lease;
  }
}
