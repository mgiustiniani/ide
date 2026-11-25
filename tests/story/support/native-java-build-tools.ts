import { readNativeJavaExecutionStatuses } from "./native-java-execution-status.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  BUILD_TOOL_INTEGRATION_TEST,
  BUILD_TOOL_MAIN,
  BUILD_TOOL_TEST,
  MAIN_MODE_PREFIX,
  TEST_EXPECTED_PREFIX,
  LAUNCH_ARGUMENTS,
  LAUNCH_ENVIRONMENT,
  LAUNCH_JVM_OPTIONS,
  LAUNCH_JVM_LITERAL,
  TEST_JVM_OPTIONS,
  TEST_JVM_LITERAL,
  MAVEN_AGGREGATOR_TEST_CLASS,
  nativeJavaBuildToolFixture,
  type NativeJavaBuildTool,
  type NativeJavaWorkflow,
  type NativeJavaTestFramework,
} from "../fixtures/native-java-build-tool-fixtures.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { JAVA_NATIVE_REQUIREMENT } from "./native-java-execution.js";
import { readNativeJUnitReport, type NativeJUnitReport } from "./native-java-test-report.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

export class NativeJavaBuildToolsSession {
  readonly projectPath = "service";
  readonly #rootSentinel = "This root source must not be compiled by the selected project.";
  readonly #fixture;
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #toolVersion = "";
  #runtimeHome = "";
  #selectedJdkHome = "";
  #testConfigurationId = "";
  readonly #testClassName: string;
  #reports: NativeJUnitReport[] = [];
  #passingReport?: Buffer;
  #classFileMajor?: number;
  #rebuildMarker?: string;
  #failureObservation?: unknown;
  #testJvmProof = { applied: false, frozenRerun: false, capturedSessionRepeated: false, ignoredSettingsReported: false };
  #discoveryProof = {
    collectedWithoutTestExecution: false,
    overloadNamesPreserved: false,
    wholeMethodGroupExecuted: false,
    coverageMeasuredBothOverloads: false,
    debuggerSuspendedBeforeGroup: false,
    debuggerCompletedBothOverloads: false,
    selectedMethodExecutedWithCapturedSettings: false,
  };
  #integrationTestProof = {
    freshFailsafeReportPresented: false,
    surefireReportExcludedFromDisplayedResults: false,
    capturedIntegrationCoverageRepeated: false,
  };
  #proof = {
    requirement: JAVA_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    untrustedActionsDisabled: false,
    automaticToolBuildSavedSource: false,
    cleanRemovedCompiledOutputsWithoutRunning: false,
    buildAfterCleanSucceeded: false,
    rebuildRemovedOldOutputAndCompiled: false,
    realRunOutputAndFile: false,
    realJUnitPassed: false,
    savedTestFailureVisible: false,
    repairedTestPassed: false,
    failedRunDidNotExecuteOldMain: false,
    compilerLocationOpenedProjectSource: false,
    compilerNavigationPreservedDraft: false,
    compilerNavigationActivatedSourceTab: false,
    repairedBuildDidNotRunOrTest: false,
    selectedProjectAndMethod: false,
    missingSelectedMethodFailed: false,
    cleanNativeCloseAndIdeStorageConfined: false,
    structuredTestResults: false,
    failedTestRerun: false,
    staleTestReportsOmitted: false,
    literalLaunchArgumentsEnvironmentAndJdk: false,
    namedConfigurationsRestored: false,
    selectedNamedConfigurationsExecuted: false,
    applicationJvmOptionsApplied: false,
    unusedApplicationJvmDraftsIgnored: false,
  };
  constructor(
    readonly tool: NativeJavaBuildTool,
    readonly workflow: NativeJavaWorkflow = "application",
    readonly framework: NativeJavaTestFramework = "junit4",
    readonly mavenAggregator = false,
  ) {
    this.#fixture = nativeJavaBuildToolFixture(tool, workflow, framework, mavenAggregator);
    this.#testClassName = workflow === "failsafe" ? "MainIT" : "MainTest";
  }
  async prepare() {
    const { stdout } = await promisify(execFile)(
      this.tool === "maven" ? "mvn" : "gradle",
      ["--version"],
      {
        timeout: 10_000,
        maxBuffer: 8_192,
      },
    );
    const version = stdout.match(this.tool === "maven" ? /Apache Maven [\d.]+/ : /Gradle [\d.]+/);
    assert.ok(version, "installed build tool did not identify its version");
    this.#toolVersion = version[0];
    this.#lease = await NativeScenarioEnvironmentLease.acquire(JAVA_NATIVE_REQUIREMENT);
    for (const [file, content] of Object.entries(this.#fixture.files)) {
      const absolute = this.file(file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, content, { flag: "wx" });
    }
    await writeFile(path.join(this.workspace(), "Root.java"), this.#rootSentinel, { flag: "wx" });
    await this.#lease.assertConfiguredPathsConfined();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    await this.openSource(this.editorPath(BUILD_TOOL_TEST), this.#fixture.test("1"));
    await this.openSource(this.editorPath(BUILD_TOOL_MAIN), this.#fixture.main("0"));
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 10_000 });
    assert.equal(await this.panel().$("label=Build tool").$("select").getValue(), "auto");
    await this.panel().$('input[placeholder="Workspace root"]').setValue(this.projectPath);
    await this.panel().$('input[placeholder="com.example.Main"]').setValue("Main");
    const observed = this.panel().$("p*=Selected JDK:");
    await observed.waitForDisplayed({ timeout: 5_000 });
    this.#selectedJdkHome = await realpath(
      (await observed.getText()).replace(/^Selected JDK:\s*/, ""),
    );
    await this.panel().$('input[placeholder="IDE default JDK"]').setValue(this.#selectedJdkHome);
    if (this.workflow !== "application") await this.button("Add JVM option").click();
    for (const [index, value] of (this.workflow === "application"
      ? LAUNCH_JVM_OPTIONS
      : []
    ).entries()) {
      await this.button("Add JVM option").click();
      const input = this.panel()
        .$(`label=JVM option ${index + 1}`)
        .$("textarea");
      if (Array.from(value).some((character) => character.codePointAt(0)! > 0xffff))
        await pasteNativeText(this.app(), input, value);
      else await input.setValue(value);
      assert.equal(await input.getValue(), value);
    }
    for (const [index, value] of (this.workflow === "application"
      ? LAUNCH_ARGUMENTS
      : []
    ).entries()) {
      await this.button("Add argument").click();
      const input = this.panel()
        .$(`label=Argument ${index + 1}`)
        .$("textarea");
      if (value !== "") {
        if (Array.from(value).some((character) => character.codePointAt(0)! > 0xffff))
          await pasteNativeText(this.app(), input, value);
        else await input.setValue(value);
      }
      assert.equal(await input.getValue(), value);
    }
    for (const [index, variable] of LAUNCH_ENVIRONMENT.entries()) {
      await this.button("Add environment variable").click();
      await this.panel()
        .$(`label=Variable ${index + 1} name`)
        .$("input")
        .setValue(variable.name);
      const input = this.panel()
        .$(`label=Variable ${index + 1} value`)
        .$("textarea");
      if (variable.value !== "") await pasteNativeText(this.app(), input, variable.value);
      assert.equal(await input.getValue(), variable.value);
    }
  }
  async assertUntrusted() {
    assert.equal(await this.panel().$('input[type="checkbox"]').isSelected(), false);
    for (const action of [
      "Clean build outputs",
      "Rebuild",
      "Build",
      "Run",
      "Run tests",
      ...(this.workflow === "failsafe"
        ? ["Run integration tests", "Run integration tests with coverage"]
        : []),
      "Discover tests",
      "Debug",
    ])
      assert.equal(await this.button(action).isEnabled(), false);
    for (const file of [
      this.#fixture.classFile,
      this.#fixture.testReport,
      "execution-proof.txt",
      "test-proof.txt",
    ])
      await this.assertMissing(file);
    await this.assertSources("0", "1");
    this.#proof.untrustedActionsDisabled = true;
  }
  async configureTestJvmOptions() {
    assert.notEqual(this.workflow, "application");
    for (const [index, value] of TEST_JVM_OPTIONS.entries()) {
      await this.button("Add test JVM option").click();
      const input = this.panel()
        .$(`label=Test JVM option ${index + 1}`)
        .$("textarea");
      if (Array.from(value).some((character) => character.codePointAt(0)! > 0xffff))
        await pasteNativeText(this.app(), input, value);
      else await input.setValue(value);
      assert.equal(await input.getValue(), value);
    }
  }
  async trustAndDiscover() {
    assert.equal(this.workflow, "discovery");
    await this.panel().$('input[type="checkbox"]').click();
    await this.request("Discover tests");
  }
  async assertDiscoveryDidNotRun() {
    await this.waitStatus("discover", false);
    const discovery = this.panel().$('[aria-label="Discovered Java tests"]');
    await discovery.scrollIntoView();
    assert.ok(
      (await discovery.getText()).includes("Discovery: ready. 1 classes, 2 method-name groups."),
    );
    assert.equal(await discovery.$('[aria-label="Run class MainTest"]').isEnabled(), true);
    assert.equal(
      await discovery.$('[aria-label="Run method group MainTest#savedSource"]').isEnabled(),
      true,
    );
    assert.equal(
      await discovery.$('[aria-label="Run method group MainTest#companion"]').isEnabled(),
      true,
    );
    if (this.framework === "junit5") {
      await discovery.$("summary=Discovered display names (2)").click();
      const text = await discovery.getText();
      assert.ok(text.includes("savedSource()") && text.includes("savedSource(TestInfo)"), text);
      assert.ok(text.includes("every matching overload"), text);
      await this.assertMissing("discovery-overload-proof.txt");
      this.#discoveryProof.overloadNamesPreserved = true;
    }
    await this.assertMissing("test-proof.txt");
    await this.assertMissing("discovery-companion-proof.txt");
    await this.assertMissing("execution-proof.txt");
    await this.assertSources("1", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    this.#discoveryProof.collectedWithoutTestExecution = true;
  }
  async runDiscoveredMethod() {
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.MainTest#computes"]'),
      "MainTest#notPresent",
    );
    await this.button("Add test JVM option").click();
    const run = this.panel()
      .$('[aria-label="Discovered Java tests"]')
      .$('[aria-label="Run method group MainTest#savedSource"]');
    await run.scrollIntoView();
    await run.click();
  }
  async assertMavenAggregatorDiscovery() {
    await this.assertDiscoveryDidNotRun();
    assert.ok((await readFile(this.file(MAVEN_AGGREGATOR_TEST_CLASS))).length > 0);
    await this.assertMavenChildDidNotRun();
  }
  private async assertMavenChildDidNotRun() {
    await this.assertMissing("child/target/test-classes/MainTest.class");
    await this.assertMissing("child/target/surefire-reports/TEST-MainTest.xml");
    await this.assertMissing("child/child-test-proof.txt");
  }
  async assertDiscoveredMethodPassed(expectedRuns = 1) {
    await this.waitStatus("test", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(0, expectedRuns);
    await this.assertMissing("discovery-companion-proof.txt");
    if (this.mavenAggregator) await this.assertMavenChildDidNotRun();
    await this.assertSources("1", "1");
    assert.ok((await this.panel().getText()).includes("Session configuration: Default"));
    if (this.framework === "junit5") {
      await this.assertOverloadExecutions(1);
      assert.equal(this.#reports.at(-1)?.tests, 2);
      this.#discoveryProof.wholeMethodGroupExecuted = true;
    }
    this.#discoveryProof.selectedMethodExecutedWithCapturedSettings = true;
  }
  private async assertOverloadExecutions(count: number) {
    assert.equal(
      await readFile(this.file("discovery-overload-proof.txt"), "utf8"),
      "overloaded selected method\n".repeat(count),
    );
  }
  private async rediscoverOverloads() {
    assert.equal(this.framework, "junit5");
    assert.equal(this.workflow, "discovery");
    // The captured-selection check leaves one incomplete test option in the public form.
    const optionRow = this.panel().$("label=Test JVM option 1");
    if (await optionRow.isExisting()) {
      const option = optionRow.$("textarea");
      if (!(await option.getValue()).trim()) await option.setValue("-Dide.gui.group=true");
    }
    await this.request("Discover tests");
    await this.waitStatus("discover", false);
  }
  async coverDiscoveredOverloads() {
    await this.rediscoverOverloads();
    const button = this.panel().$('[aria-label="Cover method group MainTest#savedSource"]');
    await button.scrollIntoView();
    await button.click();
  }
  async assertOverloadCoverage() {
    await this.waitStatus("coverage", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(0, 2);
    await this.assertOverloadExecutions(2);
    await this.assertMissing("discovery-companion-proof.txt");
    const coverage = this.panel().$('[aria-label="Java test coverage"]');
    await coverage.scrollIntoView();
    assert.ok((await coverage.getText()).includes("JaCoCo: ready"));
    const row = coverage.$(".//tbody/tr[td[1][normalize-space()='3']]");
    await row.waitForDisplayed({ timeout: 5000 });
    assert.equal(await row.$("td:nth-child(3)").getText(), "2 / 2");
    await this.assertSources("1", "1");
    this.#discoveryProof.coverageMeasuredBothOverloads = true;
  }
  async debugDiscoveredOverloads() {
    await this.rediscoverOverloads();
    const button = this.panel().$('[aria-label="Debug method group MainTest#savedSource"]');
    await button.scrollIntoView();
    await button.click();
    const debuggerPanel = this.panel().$('[aria-label="Structured Java debugger"]');
    await this.browser().waitUntil(
      async () => {
        if (!(await debuggerPanel.isExisting())) return false;
        return (await debuggerPanel.getText()).includes("JDI: suspended (entry)");
      },
      { timeout: 25_000, timeoutMsg: "The discovered method group did not suspend at JDI entry" },
    );
    await this.assertExecutionCounts(0, 2);
    await this.assertOverloadExecutions(2);
    this.#discoveryProof.debuggerSuspendedBeforeGroup = true;
  }
  async continueDiscoveredOverloads() {
    const button = this.panel().$('[aria-label="Structured Java debugger"]').$("button=Continue");
    await button.scrollIntoView();
    await button.click();
    await this.waitStatus("debug-test", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(0, 3);
    await this.assertOverloadExecutions(3);
    await this.assertMissing("discovery-companion-proof.txt");
    await this.assertSources("1", "1");
    this.#discoveryProof.debuggerCompletedBothOverloads = true;
  }
  async trustAndRunTestJvm() {
    assert.equal(this.workflow, "test-jvm");
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel()
      .$("label=Java configuration")
      .$("select")
      .selectByAttribute("value", this.#testConfigurationId);
    assert.equal(await this.panel().$("label*=JVM option 1").$("textarea").getValue(), "");
    await this.request("Run tests");
  }
  async assertTestJvmPassed() {
    await this.assertPassedTest();
    await this.assertTestJvmProof();
    await this.assertSources("1", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    this.#testJvmProof.applied = true;
  }
  async assertTestJvmRerun() {
    await this.assertRepairedTest();
    await this.assertTestJvmProof();
    this.#testJvmProof.frozenRerun = true;
  }
  async rerunCapturedTestSession() {
    const previous = await this.panel().getAttribute("data-session-id");
    assert.ok(previous);
    await this.request("Rerun session");
    await this.browser().waitUntil(async () => {
      const current = await this.panel().getAttribute("data-session-id");
      return Boolean(current && current !== previous);
    }, { timeout: 10_000, timeoutMsg: "The test rerun did not create a new session" });
  }
  async assertCapturedTestSessionRerun() {
    await this.waitStatus("test", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(0, 4);
    await this.assertTestJvmProof();
    assert.ok((await this.panel().getText()).includes("Session configuration: Selected tests"));
    this.#testJvmProof.capturedSessionRepeated = true;
  }
  async trustAndRunIgnoredTestJvm() {
    assert.equal(this.workflow, "ignored-test-jvm");
    await this.panel().$('input[type="checkbox"]').click();
    await this.panel()
      .$('input[placeholder="com.example.MainTest#computes"]')
      .setValue("MainTest#savedSource");
    await this.request("Run tests");
  }
  async assertIgnoredTestJvm() {
    await this.browser().waitUntil(
      async () => (await this.panel().getText()).includes("test: failed (exit 0)"),
      { timeout: 25_000, interval: 100 },
    );
    assert.ok((await this.panel().$('[role="alert"]').getText()).includes("not confirmed"));
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(0, 1);
    assert.equal(
      await readFile(this.file("test-jvm-settings-proof.txt"), "utf8"),
      "JVM_SETTINGS_ABSENT",
    );
    await this.assertSources("1", "1");
    this.#testJvmProof.ignoredSettingsReported = true;
  }
  private async assertTestJvmProof() {
    assert.equal(
      await readFile(this.file("test-jvm-settings-proof.txt"), "utf8"),
      `${TEST_JVM_LITERAL}\nEMPTY=\nHEAP_FLAG=true\nJDK=${this.#selectedJdkHome}\nJAVA_HOME=${this.#selectedJdkHome}`,
    );
    await this.assertMissing("test-vm-injected.txt");
  }
  async saveConfigurationsAndReload() {
    const name = this.panel().$("label=Configuration name").$("input");
    await pasteNativeText(this.app(), name, "Application");
    await this.button("Rename configuration").click();
    await this.button("Duplicate configuration").click();
    await pasteNativeText(
      this.app(),
      this.panel().$("label=Configuration name").$("input"),
      "Selected tests",
    );
    await this.button("Rename configuration").click();
    this.#testConfigurationId = await this.panel()
      .$("label=Java configuration")
      .$("select")
      .getValue();
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.Main"]'),
      "UnusedMain",
    );
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.MainTest#computes"]'),
      "MainTest#savedSource",
    );
    await this.button("New configuration").click();
    assert.equal(await this.panel().$('input[placeholder="com.example.Main"]').getValue(), "");
    await this.button("Delete configuration").click();
    await this.panel()
      .$("label=Java configuration")
      .$("select")
      .selectByAttribute("value", "default");
    assert.equal(await this.panel().$('input[placeholder="com.example.Main"]').getValue(), "Main");
    assert.equal(
      await this.panel().$('input[placeholder="com.example.MainTest#computes"]').getValue(),
      "",
    );
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_TEST), false);
    await this.browser().refresh();
    await this.app().waitForFileExplorer();
    await this.openSource(this.editorPath(BUILD_TOOL_TEST), this.#fixture.test("1"));
    await this.openSource(this.editorPath(BUILD_TOOL_MAIN), this.#fixture.main("0"));
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.panel().waitForDisplayed({ timeout: 5_000 });
  }
  async assertRestoredConfigurations() {
    const selected = this.panel().$("label=Java configuration").$("select");
    assert.equal(await selected.getValue(), "default");
    assert.deepEqual(await selected.$$("option").map((item) => item.getText()), [
      "Application",
      "Selected tests",
    ]);
    await selected.selectByAttribute("value", this.#testConfigurationId);
    assert.equal(
      await this.panel().$('input[placeholder="com.example.Main"]').getValue(),
      "UnusedMain",
    );
    assert.equal(
      await this.panel().$('input[placeholder="com.example.MainTest#computes"]').getValue(),
      "MainTest#savedSource",
    );
    await this.panel()
      .$("label=Java configuration")
      .$("select")
      .selectByAttribute("value", "default");
    assert.equal(await this.panel().$('input[placeholder="com.example.Main"]').getValue(), "Main");
    assert.equal(
      await this.panel().$('input[placeholder="Workspace root"]').getValue(),
      this.projectPath,
    );
    assert.equal(
      await this.panel().$('input[placeholder="IDE default JDK"]').getValue(),
      this.#selectedJdkHome,
    );
    for (const [index, value] of (this.workflow === "application"
      ? LAUNCH_ARGUMENTS
      : []
    ).entries())
      assert.equal(
        await this.panel()
          .$(`label*=Argument ${index + 1}`)
          .$("textarea")
          .getValue(),
        value,
      );
    for (const [index, value] of (this.workflow === "application"
      ? LAUNCH_JVM_OPTIONS
      : [""]
    ).entries())
      assert.equal(
        await this.panel()
          .$(`label*=JVM option ${index + 1}`)
          .$("textarea")
          .getValue(),
        value,
      );
    if (this.workflow === "test-jvm")
      for (const [index, value] of TEST_JVM_OPTIONS.entries())
        assert.equal(
          await this.panel()
            .$(`label*=Test JVM option ${index + 1}`)
            .$("textarea")
            .getValue(),
          value,
        );
    for (const [index, variable] of LAUNCH_ENVIRONMENT.entries()) {
      assert.equal(
        await this.panel()
          .$(`label=Variable ${index + 1} name`)
          .$("input")
          .getValue(),
        variable.name,
      );
      assert.equal(
        await this.panel()
          .$(`label*=Variable ${index + 1} value`)
          .$("textarea")
          .getValue(),
        variable.value,
      );
    }
    await this.assertUntrusted();
    this.#proof.namedConfigurationsRestored = true;
  }
  async editMain() {
    await this.surface().replaceCharacter(
      this.editorPath(BUILD_TOOL_MAIN),
      MAIN_MODE_PREFIX.length,
      "1",
      this.#fixture.main("1"),
    );
    await this.assertSources("0", "1");
  }
  async trustAndBuild() {
    await this.panel().$('input[type="checkbox"]').click();
    await this.button("Add JVM option").click();
    assert.equal(
      await this.panel()
        .$(`label=JVM option ${LAUNCH_JVM_OPTIONS.length + 1}`)
        .$("textarea")
        .getValue(),
      "",
    );
    await this.request("Build");
  }
  async assertBuild() {
    await this.waitStatus("build", false);
    await this.assertSources("1", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    const bytes = await readFile(this.file(this.#fixture.classFile));
    assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    this.#classFileMajor = bytes.readUInt16BE(6);
    assert.equal(this.#classFileMajor, 65);
    assert.match(
      await this.consoleText(),
      this.tool === "maven" ? /BUILD SUCCESS/ : /BUILD SUCCESSFUL/,
    );
    await this.assertMissing("execution-proof.txt");
    await this.assertMissing("test-proof.txt");
    await this.assertMissing(this.#fixture.testReport);
    this.#proof.automaticToolBuildSavedSource = true;
    await this.request("Clean build outputs");
    await this.waitStatus("clean", false);
    await this.assertMissing(this.#fixture.classFile);
    await this.assertSources("1", "1");
    await this.assertMissing("execution-proof.txt");
    await this.assertMissing("test-proof.txt");
    this.#proof.cleanRemovedCompiledOutputsWithoutRunning = true;
    await this.request("Build");
    await this.waitStatus("build", false);
    const rebuilt = await readFile(this.file(this.#fixture.classFile));
    assert.deepEqual(rebuilt.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    assert.equal(rebuilt.readUInt16BE(6), this.#classFileMajor);
    await this.assertSources("1", "1");
    await this.assertMissing("execution-proof.txt");
    await this.assertMissing("test-proof.txt");
    this.#proof.buildAfterCleanSucceeded = true;
  }
  async rebuild() {
    this.#rebuildMarker = `${path.dirname(this.#fixture.classFile)}/obsolete-output.marker`;
    await writeFile(this.file(this.#rebuildMarker), "Old build output for Rebuild qualification", {
      flag: "wx",
    });
    await this.request("Rebuild");
  }
  async assertRebuild() {
    await this.waitStatus("rebuild", false);
    assert.ok(this.#rebuildMarker);
    await this.assertMissing(this.#rebuildMarker);
    const rebuilt = await readFile(this.file(this.#fixture.classFile));
    assert.deepEqual(rebuilt.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    assert.equal(rebuilt.readUInt16BE(6), this.#classFileMajor);
    await this.assertSources("1", "1");
    await this.assertMissing("execution-proof.txt");
    await this.assertMissing("test-proof.txt");
    this.#proof.rebuildRemovedOldOutputAndCompiled = true;
  }
  async run() {
    await this.panel()
      .$(`[aria-label="Remove JVM option ${LAUNCH_JVM_OPTIONS.length + 1}"]`)
      .click();
    await this.request("Run");
  }
  async assertRun() {
    await this.waitStatus("run", false);
    assert.ok((await this.consoleText()).includes(this.#fixture.runMarker));
    await this.assertExecutionCounts(1, 0);
    this.#runtimeHome = await realpath(
      (await readFile(this.file("execution-jdk.txt"), "utf8")).trim(),
    );
    assert.equal(this.#runtimeHome, this.#selectedJdkHome);
    assert.equal(
      await realpath((await readFile(this.file("execution-java-home.txt"), "utf8")).trim()),
      this.#runtimeHome,
    );
    assert.equal(
      await readFile(this.file("launch-settings-proof.txt"), "utf8"),
      `${LAUNCH_ARGUMENTS.join("\n")}\nMODE=${LAUNCH_ENVIRONMENT[0].value}\nEMPTY=`,
    );
    await this.assertMissing("injected.txt");
    await this.assertMissing("vm-injected.txt");
    assert.equal(
      await readFile(this.file("jvm-settings-proof.txt"), "utf8"),
      `${LAUNCH_JVM_LITERAL}\nEMPTY=\nHEAP_FLAG=true\nGRADLE_DEFAULT=${this.tool === "gradle" ? "retained" : "null"}`,
    );
    this.#proof.applicationJvmOptionsApplied = true;
    this.#proof.literalLaunchArgumentsEnvironmentAndJdk = true;
    await this.assertSources("1", "1");
    this.#proof.realRunOutputAndFile = true;
    assert.ok((await this.panel().getText()).includes("Session configuration: Application"));
  }
  async test() {
    await this.request("Run tests");
  }
  async trustAndRunIntegrationCoverage() {
    assert.equal(this.tool, "maven");
    assert.equal(this.workflow, "failsafe");
    await this.panel().$('input[type="checkbox"]').click();
    await this.request("Run integration tests with coverage");
  }
  async assertIntegrationCoverage(repeated = false) {
    await this.waitStatus("integration-coverage", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(0, repeated ? 4 : 2);
    assert.ok(
      (await readFile(this.file("target/surefire-reports/TEST-MainTest.xml"), "utf8")).includes(
        "<testsuite",
      ),
      "the earlier Surefire lifecycle phase did not produce its own report",
    );
    const structured = await this.panel().$('[aria-label="Java test results"]').getText();
    assert.ok(structured.includes("1 reported tests"), structured);
    assert.ok(structured.includes(`passed: ${this.#testClassName} · savedSource`), structured);
    const coverage = this.panel().$('[aria-label="Java test coverage"]');
    assert.ok((await coverage.getText()).includes("JaCoCo: ready"));
    assert.ok((await coverage.getText()).includes("Branches"));
    assert.ok((await coverage.$("table").getText()).includes("1 / 2"));
    await access(this.file("target/site/jacoco-it/jacoco.xml"));
    this.#integrationTestProof.freshFailsafeReportPresented = true;
    this.#integrationTestProof.surefireReportExcludedFromDisplayedResults = true;
    this.#integrationTestProof.capturedIntegrationCoverageRepeated = repeated;
    this.#proof.realJUnitPassed = true;
    this.#proof.structuredTestResults = true;
    await this.assertSources("1", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_TEST), false);
  }
  async selectTest() {
    await this.panel()
      .$("label=Java configuration")
      .$("select")
      .selectByAttribute("value", this.#testConfigurationId);
    const input = this.panel().$('input[placeholder="com.example.MainTest#computes"]');
    await pasteNativeText(this.app(), input, "MainTest#savedSource");
    await this.button("Add JVM option").click();
    assert.equal(
      await this.panel()
        .$(`label=JVM option ${LAUNCH_JVM_OPTIONS.length + 1}`)
        .$("textarea")
        .getValue(),
      "",
    );
    assert.equal(await input.getValue(), "MainTest#savedSource");
    assert.equal(
      await this.panel().$('input[placeholder="Workspace root"]').getValue(),
      this.projectPath,
    );
  }
  async assertPassedTest() {
    await this.waitStatus("test", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertExecutionCounts(this.workflow === "application" ? 1 : 0, 1);
    this.#proof.realJUnitPassed = true;
    this.#proof.selectedProjectAndMethod = true;
    assert.ok((await this.panel().getText()).includes("Session configuration: Selected tests"));
    this.#proof.selectedNamedConfigurationsExecuted = true;
    this.#proof.unusedApplicationJvmDraftsIgnored = true;
  }
  async breakTest() {
    await this.activate(this.editorPath(BUILD_TOOL_TEST), this.#fixture.test("1"));
    await this.surface().replaceCharacter(
      this.editorPath(BUILD_TOOL_TEST),
      TEST_EXPECTED_PREFIX.length,
      "2",
      this.#fixture.test("2"),
    );
    await this.assertSources("1", "1");
    await this.request("Run tests");
  }
  async assertFailedTest() {
    await this.waitStatus("test", true);
    await this.observeReport(true);
    await this.assertStructuredReport(true);
    await this.assertSources("1", "2");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_TEST), false);
    await this.assertExecutionCounts(this.workflow === "application" ? 1 : 0, 2);
    assert.ok((await this.consoleText()).includes("MainTest"));
    this.#proof.savedTestFailureVisible = true;
  }
  async repairTest() {
    await this.surface().replaceCharacter(
      this.editorPath(BUILD_TOOL_TEST),
      TEST_EXPECTED_PREFIX.length,
      "1",
      this.#fixture.test("1"),
    );
    await this.panel()
      .$("label=Java configuration")
      .$("select")
      .selectByAttribute("value", "default");
    if (this.workflow === "test-jvm") {
      await pasteNativeText(
        this.app(),
        this.panel().$("label*=Test JVM option 1").$("textarea"),
        "-Xmx128m",
      );
      await pasteNativeText(
        this.app(),
        this.panel().$("label*=Test JVM option 2").$("textarea"),
        "-Dide.gui.test.literal=changed current configuration",
      );
    }
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.MainTest#computes"]'),
      "MainTest#notPresent",
    );
    await this.request("Rerun failed tests");
  }
  async assertRepairedTest() {
    await this.waitStatus("test", false);
    await this.observeReport(false);
    await this.assertStructuredReport(false);
    await this.assertSources("1", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_TEST), false);
    await this.assertExecutionCounts(this.workflow === "application" ? 1 : 0, 3);
    this.#passingReport = await readFile(this.file(this.#fixture.testReport));
    this.#proof.repairedTestPassed = true;
    this.#proof.structuredTestResults = true;
    this.#proof.failedTestRerun = true;
    assert.ok((await this.panel().getText()).includes("Session configuration: Selected tests"));
  }
  async breakMainAndRun() {
    await this.activate(this.editorPath(BUILD_TOOL_MAIN), this.#fixture.main("1"));
    await this.surface().replaceCharacter(
      this.editorPath(BUILD_TOOL_MAIN),
      MAIN_MODE_PREFIX.length,
      "?",
      this.#fixture.main("?"),
    );
    await this.assertSources("1", "1");
    await this.request("Run");
  }
  async assertFailedRun() {
    await this.waitStatus("run", true);
    const output = await this.consoleText();
    assert.ok(output.includes("Main.java"));
    assert.match(output, /(?:COMPILATION ERROR|error:)/);
    await this.assertSources("?", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    await this.assertExecutionCounts(1, 3);
    assert.deepEqual(await readFile(this.file(this.#fixture.testReport)), this.#passingReport);
    this.#proof.failedRunDidNotExecuteOldMain = true;
    const file = this.editorPath(BUILD_TOOL_MAIN);
    await this.surface().replaceCharacter(
      file,
      MAIN_MODE_PREFIX.length,
      "1",
      this.#fixture.main("1"),
    );
    await this.activate(this.editorPath(BUILD_TOOL_TEST), this.#fixture.test("1"));
    const locations = this.panel().$('section[aria-label="Reported compiler locations"]');
    await locations.waitForDisplayed({ timeout: 5_000 });
    const link = locations.$("button");
    assert.equal(await link.getText(), `${file}:2 · error`);
    await link.waitForEnabled({ timeout: 5_000 });
    await link.click();
    await this.browser().waitUntil(
      async () => (await this.surface().tab(file).getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `The ${this.tool} compiler location did not activate its source tab.`,
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await this.browser()
          .$('[data-testid="editor-cursor-position"]')
          .getAttribute("aria-label")) === "Line 2, column 1",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `The ${this.tool} compiler location did not reveal its project source line.`,
      },
    );
    await this.surface().assertBuffer(file, this.#fixture.main("1"), "clipboard");
    await this.surface().assertDirty(file, true);
    await this.assertSources("?", "1");
    await this.assertExecutionCounts(1, 3);
    assert.deepEqual(await readFile(this.file(this.#fixture.testReport)), this.#passingReport);
    this.#proof.compilerLocationOpenedProjectSource = true;
    this.#proof.compilerNavigationPreservedDraft = true;
    this.#proof.compilerNavigationActivatedSourceTab = true;
  }
  async repairMainAndBuild() {
    await this.surface().replaceCharacter(
      this.editorPath(BUILD_TOOL_MAIN),
      MAIN_MODE_PREFIX.length,
      "1",
      this.#fixture.main("1"),
    );
    await this.request("Build");
  }
  async assertRepairedBuild() {
    await this.waitStatus("build", false);
    await this.assertSources("1", "1");
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_MAIN), false);
    await this.surface().assertDirty(this.editorPath(BUILD_TOOL_TEST), false);
    await this.assertExecutionCounts(1, 3);
    assert.deepEqual(await readFile(this.file(this.#fixture.testReport)), this.#passingReport);
    assert.equal(await this.panel().$("label=Build tool").$("select").getValue(), "auto");
    this.#proof.repairedBuildDidNotRunOrTest = true;
  }
  async close() {
    await this.app().closeNativeWindow();
  }
  async requestMissingTest() {
    await this.panel()
      .$("label=Java configuration")
      .$("select")
      .selectByAttribute("value", this.#testConfigurationId);
    await pasteNativeText(
      this.app(),
      this.panel().$('input[placeholder="com.example.MainTest#computes"]'),
      "MainTest#notPresent",
    );
    await this.request("Run tests");
  }
  async assertMissingTestFailed() {
    await this.waitStatus("test", true);
    await this.assertExecutionCounts(1, 3);
    await this.assertSources("1", "1");
    const reports = this.panel().$('[aria-label="Java test results"]');
    await reports.scrollIntoView();
    assert.ok((await reports.getText()).includes("No fresh test cases were reported."));
    assert.equal(await reports.$("button=Rerun failed tests").isExisting(), false);
    this.#proof.staleTestReportsOmitted = true;
    this.#proof.missingSelectedMethodFailed = true;
  }
  async assertFinal() {
    await this.app().assertExited();
    await this.assertSources("1", "1");
    await this.assertExecutionCounts(
      this.workflow === "application" ? 1 : 0,
      this.mavenAggregator ? 2 : this.workflow === "failsafe"
        ? (this.#integrationTestProof.capturedIntegrationCoverageRepeated ? 4 : 2)
        : this.workflow === "discovery" && this.framework === "junit5"
          ? 3
          : this.workflow === "ignored-test-jvm" || this.workflow === "discovery"
            ? 1
            : this.workflow === "test-jvm" &&
                (this.framework === "junit5" || this.framework === "testng")
              ? 1
              : this.#testJvmProof.capturedSessionRepeated ? 4 : 3,
    );
    if (this.mavenAggregator) await this.assertMavenChildDidNotRun();
    assert.equal(
      await readFile(path.join(this.workspace(), "Root.java"), "utf8"),
      this.#rootSentinel,
    );
    for (const [file, content] of Object.entries(this.#fixture.files))
      if (file !== BUILD_TOOL_MAIN && file !== BUILD_TOOL_TEST)
        assert.equal(await readFile(this.file(file), "utf8"), content);
    await this.#lease!.assertConfiguredPathsConfined();
    this.#proof.cleanNativeCloseAndIdeStorageConfined = true;
  }
  evidence() {
    return {
      ...this.#proof,
      workflow: this.workflow,
      testFramework: this.framework,
      ...(this.workflow === "discovery"
        ? { testDiscovery: this.#discoveryProof }
        : this.workflow === "test-jvm" || this.workflow === "ignored-test-jvm"
          ? { testJvmOptions: this.#testJvmProof }
          : this.workflow === "failsafe"
            ? { integrationTests: this.#integrationTestProof }
            : {}),
      failureObservation: this.#failureObservation,
      buildTool: this.tool,
      projectPath: this.projectPath,
      toolVersion: this.#toolVersion,
      classFileMajor: this.#classFileMajor,
      runtimeHome: this.#runtimeHome,
      selectedJdkHome: this.#selectedJdkHome,
      junitReports: this.#reports,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return this.#app?.redactedDiagnostics(Object.values(this.#fixture.files)) ?? "";
  }
  async captureFailure() {
    if (!this.#app || !this.#lease) return;
    try {
      this.#failureObservation = await this.browser().execute(() => ({
        statuses: Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map(
          (element) => element.textContent?.slice(0, 2_000),
        ),
        console: document
          .querySelector('[aria-label="Java console output"]')
          ?.textContent?.slice(-65_536),
        results: document
          .querySelector('[aria-label="Java test results"]')
          ?.textContent?.slice(0, 8_000),
      }));
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, `java-${this.tool}-failure.png`),
      );
    } catch {
      // Preserve the original scenario failure if its native window has already exited.
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
      if (this.#lease)
        await writeFile(
          path.join(
            this.#lease.runnerArtifactPath,
            `java-${this.tool}-${this.workflow === "application" ? "native" : this.workflow}${this.framework === "testng" ? "-testng" : ""}-evidence.json`,
          ),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Java build-tool cleanup failed");
  }
  private async observeReport(failed: boolean) {
    const report = await readNativeJUnitReport(
      this.workspace(),
      this.editorPath(this.#fixture.testReport),
      this.#fixture.testMarker,
      this.#fixture.testReportSuite,
      this.#testClassName,
      "savedSource",
      this.workflow === "discovery" && this.framework === "junit5" ? ["savedSource(TestInfo)"] : [],
    );
    assert.equal(report.failures, failed ? 1 : 0);
    assert.equal(report.caseFailure, failed);
    if (failed)
      assert.equal(
        report.failureMessage,
        `${this.tool === "gradle" ? "java.lang.AssertionError: " : ""}expected:<2> but was:<1>`,
      );
    if (this.#reports.length) assert.notEqual(report.sha256, this.#reports.at(-1)!.sha256);
    this.#reports.push(report);
  }
  private async assertStructuredReport(failed: boolean) {
    const results = this.panel().$('[aria-label="Java test results"]');
    await results.waitForExist({ timeout: 5_000 });
    await results.scrollIntoView();
    await results.waitForDisplayed({ timeout: 5_000 });
    const text = await results.getText();
    const count = this.workflow === "discovery" && this.framework === "junit5" ? 2 : 1;
    assert.ok(
      text.includes(
        `${count} reported tests: ${failed ? "0 passed, 1 failed" : `${count} passed, 0 failed`}`,
      ),
      text,
    );
    assert.ok(
      text.includes(`${failed ? "failed" : "passed"}: ${this.#testClassName} · savedSource`),
      text,
    );
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), failed);
    if (failed) assert.ok(text.includes("expected:<2> but was:<1>"), text);
  }
  private async assertExecutionCounts(runs: number, tests: number) {
    if (runs === 0) await this.assertMissing("execution-proof.txt");
    else
      assert.equal(
        await readFile(this.file("execution-proof.txt"), "utf8"),
        `${this.#fixture.runMarker}\n`.repeat(runs),
      );
    if (tests === 0) await this.assertMissing("test-proof.txt");
    else
      assert.equal(
        await readFile(this.file("test-proof.txt"), "utf8"),
        `${this.#fixture.testMarker}\n`.repeat(tests),
      );
  }
  private async assertSources(main: string, test: string) {
    assert.equal(await readFile(this.file(BUILD_TOOL_MAIN), "utf8"), this.#fixture.main(main));
    assert.equal(await readFile(this.file(BUILD_TOOL_TEST), "utf8"), this.#fixture.test(test));
    if (this.workflow === "failsafe")
      assert.equal(
        await readFile(this.file(BUILD_TOOL_INTEGRATION_TEST), "utf8"),
        this.#fixture.files[BUILD_TOOL_INTEGRATION_TEST],
      );
  }
  private async assertMissing(file: string) {
    await assert.rejects(access(this.file(file)), { code: "ENOENT" });
  }
  private async request(name: string) {
    await this.button(name).waitForEnabled({ timeout: 5_000 });
    await this.button(name).click();
  }
  private async waitStatus(operation: string, failed: boolean) {
    const pattern = new RegExp(
      `^${operation}: ${failed ? "failed \\(exit [1-9][0-9]*\\)" : "succeeded \\(exit 0\\)"}`,
    );
    await this.browser().waitUntil(
      async () =>
        (await readNativeJavaExecutionStatuses(this.browser())).some((status) =>
          pattern.test(status),
        ),
      {
        timeout: 25_000,
        interval: 100,
        timeoutMsg: `real ${this.tool} ${operation} outcome not presented`,
      },
    );
  }
  private async openSource(file: string, expected: string) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = this.browser().$(
        `[role="treeitem"][data-path="${parts.slice(0, i).join("/")}"]`,
      );
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    await this.surface().open(file, expected);
  }
  private async activate(file: string, expected: string) {
    await this.surface().tab(file).click();
    try {
      await this.browser().waitUntil(
        async () => (await this.surface().tab(file).getAttribute("aria-selected")) === "true",
        {
          timeout: 2_000,
          interval: 50,
          timeoutMsg: "the requested source tab did not become active",
        },
      );
      await this.browser().waitUntil(
        async () =>
          (await this.browser()
            .$('[data-testid="editor-monaco-layer"]')
            .getAttribute("aria-hidden")) === "false",
        {
          timeout: 5_000,
          interval: 50,
          timeoutMsg: "the activated Monaco view remained covered by its opening placeholder",
        },
      );
      // Focus only the qualified visible surface, using a real pointer.
      await this.surface().focus(file);
      await this.surface().assertBuffer(file, expected);
    } catch (error) {
      const observation = await this.browser().execute(() => ({
        tabs: Array.from(document.querySelectorAll('[role="tab"][data-path]')).map((node) => ({
          path: node.getAttribute("data-path"),
          selected: node.getAttribute("aria-selected"),
        })),
        inputs: Array.from(document.querySelectorAll('[role="textbox"]')).map((node) => ({
          label: node.getAttribute("aria-label"),
          visible: node.getBoundingClientRect().height > 0,
        })),
        editorText: Array.from(document.querySelectorAll(".monaco-editor .view-line"))
          .map((node) => node.textContent)
          .join("\n")
          .slice(0, 300),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((node) =>
          node.textContent?.slice(0, 200),
        ),
      }));
      throw new Error(`Native source activation failed: ${JSON.stringify(observation)}`, {
        cause: error,
      });
    }
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
    return path.join(this.workspace(), this.projectPath, relative);
  }
  private editorPath(relative: string) {
    return `${this.projectPath}/${relative}`;
  }
  private panel() {
    return this.browser().$('[aria-label="Java execution"]');
  }
  private button(name: string) {
    return this.panel().$(`button=${name}`);
  }
  private consoleText() {
    return this.panel().$('[aria-label="Java console output"]').getText();
  }
}
