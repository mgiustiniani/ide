import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ChainablePromiseElement } from "webdriverio";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";

const FILE = "source code/build/Main.java";
const SOURCE = `package build;
public class Main {
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("plain-pid.txt"), "" + ProcessHandle.current().pid());
    System.out.println("PLAIN_GUI_OK:" + dep.Support.message() + "|" + System.getProperty("java.home"));
  }
}
`;
const DECLARATION = ".refactorkit/java-project.json";
const TEST_FILE = "test code/checks/ChecksTest.java";
const TEST_SOURCE = `package checks;
public class ChecksTest {
  @compileapi.CompileOnly
  @org.junit.jupiter.api.Test public void selected() throws Exception {
    org.junit.jupiter.api.Assertions.assertEquals("build.Main", build.Main.class.getName());
    org.junit.jupiter.api.Assertions.assertEquals("library", library.Greeting.value());
    org.junit.jupiter.api.Assertions.assertEquals("generated main", generated.GeneratedMainSupport.value());
    org.junit.jupiter.api.Assertions.assertEquals("generated test", generated.GeneratedTestSupport.value());
    org.junit.jupiter.api.Assertions.assertEquals("from-jar", dep.Support.message());
    org.junit.jupiter.api.Assertions.assertEquals("main runtime", Class.forName("runtime.Token").getMethod("value").invoke(null));
    org.junit.jupiter.api.Assertions.assertEquals("test runtime", Class.forName("runtime.TestToken").getMethod("value").invoke(null));
    org.junit.jupiter.api.Assertions.assertThrows(ClassNotFoundException.class, () -> Class.forName("compileapi.CompileOnly"));
    java.nio.file.Files.writeString(java.nio.file.Path.of("declared-test-proof.txt"), "selected");
  }
  @org.junit.jupiter.api.Test public void other() throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("unexpected-test-proof.txt"), "wrong");
    throw new AssertionError("This method was not selected");
  }
}
`;
const REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";

export class NativeJavaDeclaredProjectSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #sdk = "";
  #daemon?: string;
  #originalEnvironment = new Map<string, string | undefined>();
  #inputs = new Map<string, string>();
  #binaryInputs = new Map<string, Buffer>();
  #declaration?: string;
  #testWorkflow = false;
  #testFramework: "junit" | "testng" = "junit";
  #testLibraries = ["lib/junit.jar"];
  #mainCompileLibraries = ["lib/dependency.jar"];
  #testReports: unknown[] = [];
  #proof = {
    requirement: REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    declarationCreatedThroughForm: false,
    existingDeclarationPreserved: false,
    providerSynchronized: false,
    buildRespectsRoots: false,
    fileMainRan: false,
    cursorMainDebugBreakpoint: false,
    inputsPreserved: false,
    cleanClose: false,
    testDeclarationCreatedThroughForm: false,
    declaredTestMethodResults: false,
    discoveryWithoutTestBodies: false,
    capturedTestSelection: false,
    separateRuntimeClasspaths: false,
    compileOnlyDependencyExcluded: false,
    generatedSourcesCompiled: false,
    additionalModuleBuildAndExecution: false,
  };
  async prepare(testWorkflow = false, framework: "junit" | "testng" = "junit") {
    this.#testWorkflow = testWorkflow;
    this.#testFramework = framework;
    this.#daemon = process.env.IDE_REAL_REFACTORKIT_DAEMON;
    assert.ok(this.#daemon && path.isAbsolute(this.#daemon));
    this.#sdk = await realpath(process.env.IDE_JAVA_CONTEXT_TEST_JDK!);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    for (const key of [
      "IDE_REFACTORKIT_DAEMON",
      "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE",
      "IDE_REFACTORKIT_ENGINE",
      "IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE",
      "IDE_JAVA_CONTEXT_TRACE_PATH",
    ])
      this.#originalEnvironment.set(key, process.env[key]);
    process.env.IDE_REFACTORKIT_DAEMON = this.#daemon;
    process.env.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE = "1";
    process.env.IDE_REFACTORKIT_ENGINE = path.join(path.dirname(this.#daemon), "refactorkit");
    process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE = "1";
    process.env.IDE_JAVA_CONTEXT_TRACE_PATH = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    this.#inputs.set(
      FILE,
      testWorkflow
        ? SOURCE.replace(
            "dep.Support.message()",
            "dep.Support.message() + library.Greeting.value()",
          )
        : SOURCE,
    );
    if (testWorkflow)
      this.#inputs.set(
        TEST_FILE,
        framework === "testng"
          ? TEST_SOURCE.replaceAll("@org.junit.jupiter.api.Test", "@org.testng.annotations.Test")
          : TEST_SOURCE,
      );
    this.#inputs.set("outside/Broken.java", "This unselected source must not be compiled");
    this.#inputs.set(
      "dependency src/dep/Support.java",
      'package dep; public class Support { public static String message() { return "from-jar"; } }\n',
    );
    if (testWorkflow) {
      this.#mainCompileLibraries.push("lib/compile-only.jar", "library/classes");
      this.#inputs.set(
        "library/src/library/Greeting.java",
        'package library; public class Greeting { public static String value() { return "library"; } }\n',
      );
      this.#inputs.set(
        "generated code/generated/GeneratedMainSupport.java",
        'package generated; public class GeneratedMainSupport { public static String value() { return "generated main"; } }\n',
      );
      this.#inputs.set(
        "generated tests/generated/GeneratedTestSupport.java",
        'package generated; public class GeneratedTestSupport { public static String value() { return "generated test"; } }\n',
      );
      this.#inputs.set(
        "runtime dependency sources/compileapi/CompileOnly.java",
        "package compileapi; @java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.SOURCE) public @interface CompileOnly {}\n",
      );
      for (const [type, value] of [
        ["Token", "main runtime"],
        ["TestToken", "test runtime"],
      ]) {
        this.#inputs.set(
          `runtime dependency sources/runtime/${type}.java`,
          `package runtime; public class ${type} { public static String value() { return "${value}"; } }\n`,
        );
      }
    }
    for (const [relative, text] of this.#inputs) {
      await mkdir(path.dirname(this.file(relative)), { recursive: true });
      await writeFile(this.file(relative), text, { flag: "wx" });
    }
    await mkdir(this.file("lib"));
    if (testWorkflow) {
      const junit = process.env.IDE_JUNIT_PLATFORM_CONSOLE_JAR;
      assert.ok(junit && path.isAbsolute(junit));
      await copyFile(junit, this.file("lib/junit.jar"));
      if (framework === "testng") {
        const classpath = process.env.IDE_TESTNG_CLASSPATH;
        assert.ok(classpath);
        for (const [index, dependency] of classpath.split(path.delimiter).entries()) {
          const relative = `lib/testng-${index}.jar`;
          await copyFile(dependency, this.file(relative));
          this.#testLibraries.push(relative);
        }
      }
    }
    const exec = promisify(execFile);
    await exec(
      path.join(this.#sdk, "bin/javac"),
      [
        "--release",
        "17",
        "-proc:none",
        "-d",
        "dependency classes",
        "dependency src/dep/Support.java",
      ],
      { cwd: this.workspace() },
    );
    await exec(
      path.join(this.#sdk, "bin/jar"),
      ["--create", "--file", "lib/dependency.jar", "-C", "dependency classes", "."],
      { cwd: this.workspace() },
    );
    if (testWorkflow) {
      await exec(
        path.join(this.#sdk, "bin/javac"),
        [
          "--release",
          "17",
          "-proc:none",
          "-d",
          "runtime dependency classes",
          "runtime dependency sources/runtime/Token.java",
          "runtime dependency sources/runtime/TestToken.java",
          "runtime dependency sources/compileapi/CompileOnly.java",
        ],
        { cwd: this.workspace() },
      );
      for (const [type, jar] of [
        ["Token", "runtime"],
        ["TestToken", "test-runtime"],
        ["compileapi/CompileOnly", "compile-only"],
      ]) {
        await exec(
          path.join(this.#sdk, "bin/jar"),
          [
            "--create",
            "--file",
            `lib/${jar}.jar`,
            "-C",
            "runtime dependency classes",
            type!.includes("/") ? `${type}.class` : `runtime/${type}.class`,
          ],
          { cwd: this.workspace() },
        );
      }
    }
    for (const name of await readdir(this.file("lib")))
      this.#binaryInputs.set(`lib/${name}`, await readFile(this.file(`lib/${name}`)));
    await this.#lease.assertConfiguredPathsConfined();
  }
  async createDeclaration() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.app().launch();
    assert.equal(await this.app().environmentValue("IDE_REFACTORKIT_DAEMON"), this.#daemon);
    assert.equal(await this.app().environmentValue("IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE"), "1");
    assert.equal(
      await this.app().environmentValue("IDE_REFACTORKIT_ENGINE"),
      process.env.IDE_REFACTORKIT_ENGINE,
    );
    assert.equal(await this.app().environmentValue("IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE"), "1");
    await this.app().waitForFileExplorer();
    for (const directory of ["source code", "source code/build"]) {
      const row = this.browser().$(`[role="treeitem"][data-path="${directory}"]`);
      await row.waitForDisplayed({ timeout: 5_000 });
      if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    }
    await this.surface().open(FILE, this.#inputs.get(FILE)!);
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await palette.$('input[aria-label="Search commands"]').setValue("Open Java Project");
    await palette.$('[role="option"][aria-label^="Open Java Project"]').click();
    await this.project().waitForDisplayed({ timeout: 10_000 });
    await pasteNativeText(this.app(), this.project().$("#java-project-sdk-home"), this.#sdk);
    await this.project().$("button=Declare plain Java project").click();
    const dialog = this.browser().$('[role="dialog"][aria-label="Declare plain Java project"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(
      this.app(),
      dialog.$("label=Source directories, one per line").$("textarea"),
      "source code",
    );
    await pasteNativeText(
      this.app(),
      dialog.$("label=Dependencies for compilation and execution, one per line").$("textarea"),
      this.#mainCompileLibraries.join("\n"),
    );
    await pasteNativeText(
      this.app(),
      dialog.$("label=Class output directory").$("input"),
      "products/app classes",
    );
    if (this.#testWorkflow) {
      await pasteNativeText(
        this.app(),
        dialog.$("label=Generated source directories, one per line").$("textarea"),
        "generated code",
      );
      await dialog.$("label=Use separate runtime dependencies").$("input").click();
      await pasteNativeText(
        this.app(),
        dialog.$("label=Runtime dependencies, one per line").$("textarea"),
        "lib/dependency.jar\nlib/runtime.jar\nlibrary/classes",
      );
      await dialog.$("label=Include a test source set").$("input").click();
      for (const [label, value] of [
        ["Test source-set name", "checks"],
        ["Test source directories, one per line", "test code"],
        ["Generated test source directories, one per line", "generated tests"],
        ["Additional test dependencies, one per line", this.#testLibraries.join("\n")],
        ["Test class output directory", "products/test classes"],
      ]) {
        await pasteNativeText(this.app(), dialog.$(`label=${label}`).$("input, textarea"), value!);
      }
      await dialog.$("label=Use separate test runtime dependencies").$("input").click();
      await pasteNativeText(
        this.app(),
        dialog.$("label=Additional test runtime dependencies, one per line").$("textarea"),
        [...this.#testLibraries, "lib/test-runtime.jar"].join("\n"),
      );
      await dialog.$("button=Add module").click();
      const library = dialog.$('fieldset[aria-label="Additional Java module 1"]');
      for (const [label, value] of [
        ["Module name", "library"],
        ["Module root directory", "library"],
        ["Source directories, one per line", "library/src"],
        ["Class output directory", "library/classes"],
      ]) {
        await pasteNativeText(this.app(), library.$(`label=${label}`).$("input, textarea"), value!);
      }
      await library.$("label=Java release").$("select").selectByAttribute("value", "11");
    }
    await dialog.$("button=Create declaration").click();
    await dialog.waitForExist({ reverse: true, timeout: 10_000 });
    this.#declaration = await readFile(this.file(DECLARATION), "utf8");
    const manifest = JSON.parse(this.#declaration);
    assert.equal(manifest.schemaVersion, "java-declared-project-v1");
    assert.deepEqual(
      manifest.modules[0].sourceSets[0].sourceRoots,
      this.#testWorkflow ? ["source code", "generated code"] : ["source code"],
    );
    assert.deepEqual(
      manifest.modules[0].sourceSets[0].generatedSourceRoots,
      this.#testWorkflow ? ["generated code"] : [],
    );
    assert.deepEqual(
      manifest.modules[0].sourceSets[0].compileClasspath,
      this.#mainCompileLibraries,
    );
    assert.equal(manifest.modules[0].sourceSets[0].proc, "none");
    await this.surface().tab(DECLARATION).waitForExist({ timeout: 5_000 });
    await assert.rejects(access(this.file("products/app classes/build/Main.class")), {
      code: "ENOENT",
    });
    this.#proof.declarationCreatedThroughForm = true;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.project().$("button=Declare plain Java project").click();
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog.$("button=Create declaration").click();
    await dialog.$('[role="alert"]').waitForDisplayed({ timeout: 5_000 });
    assert.match(await dialog.$('[role="alert"]').getText(), /already exists/);
    assert.equal(await readFile(this.file(DECLARATION), "utf8"), this.#declaration);
    await dialog.$("button=Cancel").click();
    this.#proof.existingDeclarationPreserved = true;
  }
  async synchronizeAndChoose() {
    await this.synchronize();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const trust = this.execution().$('input[type="checkbox"]');
    if (!(await trust.isSelected())) await trust.click();
    await this.selectSourceSet("app", "main");
    await pasteNativeText(
      this.app(),
      this.execution().$('input[placeholder="com.example.Main"]'),
      "wrong.Missing",
    );
    this.#proof.providerSynchronized = true;
  }
  async verifyTestsDeclaredThroughForm() {
    assert.ok(this.#testWorkflow && this.#declaration);
    const declaration = JSON.parse(this.#declaration);
    assert.deepEqual(declaration.modules[0].sourceSets[1], {
      id: "checks",
      kind: "test",
      sourceRoots: ["test code", "generated tests"],
      generatedSourceRoots: ["generated tests"],
      outputDirectories: ["products/test classes"],
      release: 17,
      proc: "none",
      compileClasspath: [
        "products/app classes",
        ...this.#mainCompileLibraries,
        ...this.#testLibraries,
      ],
      runtimeClasspath: [
        "products/test classes",
        "products/app classes",
        "lib/dependency.jar",
        "lib/runtime.jar",
        "library/classes",
        ...this.#testLibraries,
        "lib/test-runtime.jar",
      ],
    });
    assert.deepEqual(
      declaration.modules[0].sourceSets[0].compileClasspath,
      this.#mainCompileLibraries,
    );
    await assert.rejects(access(this.file("products/test classes/checks/ChecksTest.class")), {
      code: "ENOENT",
    });
    assert.equal(await readFile(this.file(DECLARATION), "utf8"), this.#declaration);
    assert.deepEqual(declaration.modules[0].sourceSets[0].runtimeClasspath, [
      "products/app classes",
      "lib/dependency.jar",
      "lib/runtime.jar",
      "library/classes",
    ]);
    assert.deepEqual(declaration.modules[1], {
      id: "library",
      root: "library",
      sourceSets: [
        {
          id: "main",
          kind: "main",
          sourceRoots: ["library/src"],
          generatedSourceRoots: [],
          outputDirectories: ["library/classes"],
          compileClasspath: [],
          runtimeClasspath: ["library/classes"],
          release: 11,
          proc: "none",
        },
      ],
    });
    this.#proof.separateRuntimeClasspaths = true;
    this.#proof.testDeclarationCreatedThroughForm = true;
  }
  async runDeclaredTest() {
    await this.configureDeclaredTests();
    const before = await this.testReportDirectories();
    await pasteNativeText(
      this.app(),
      this.execution().$("label=Test class or class#method (optional)").$("input"),
      "checks.ChecksTest#selected",
    );
    await this.execution().$("button=Run tests").click();
    await this.waitExecution("test");
    await this.assertDeclaredTestResult(before);
    this.#proof.declaredTestMethodResults = true;
    this.#proof.compileOnlyDependencyExcluded = true;
    await access(this.file("products/test classes/generated/GeneratedTestSupport.class"));
    this.#proof.generatedSourcesCompiled = true;
    this.#proof.additionalModuleBuildAndExecution = true;
  }
  async discoverAndRunDeclaredTest() {
    await unlink(this.file("declared-test-proof.txt"));
    await this.configureDeclaredTests();
    await this.execution().$("button=Discover tests").click();
    await this.waitExecution("discover");
    const discovery = this.execution().$('[aria-label="Discovered Java tests"]');
    const selected = discovery.$('button[aria-label="Run method group checks.ChecksTest#selected"]');
    await selected.waitForExist({ timeout: 5_000 });
    await discovery
      .$('button[aria-label="Run method group checks.ChecksTest#other"]')
      .waitForExist({ timeout: 5_000 });
    await assert.rejects(access(this.file("declared-test-proof.txt")), { code: "ENOENT" });
    await assert.rejects(access(this.file("unexpected-test-proof.txt")), { code: "ENOENT" });
    this.#proof.discoveryWithoutTestBodies = true;
    await pasteNativeText(
      this.app(),
      this.execution().$("label=Test class or class#method (optional)").$("input"),
      "wrong.Missing#wrong",
    );
    await this.execution()
      .$("label=Plain-JDK test framework")
      .$("select")
      .selectByAttribute("value", this.#testFramework === "junit" ? "testng" : "junit");
    const before = await this.testReportDirectories();
    await selected.scrollIntoView();
    await selected.click();
    await this.waitExecution("test");
    await this.assertDeclaredTestResult(before);
    this.#proof.capturedTestSelection = true;
  }
  async build() {
    if (this.#testWorkflow) {
      await this.selectSourceSet("library", "main");
      await this.buildSelectedModule();
      const libraryClass = await readFile(this.file("library/classes/library/Greeting.class"));
      assert.equal(libraryClass.readUInt16BE(6), 55, "Library uses its declared Java 11 release");
      await this.synchronize();
      await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
      await this.selectSourceSet("app", "main");
    }
    await this.buildSelectedModule();
    const appClass = await readFile(this.file("products/app classes/build/Main.class"));
    assert.equal(appClass.readUInt16BE(6), 61, "Application uses its declared Java 17 release");
    await access(this.file("products/app classes/build/Main.class"));
    if (this.#testWorkflow)
      await access(this.file("products/app classes/generated/GeneratedMainSupport.class"));
    await assert.rejects(access(this.file("products/app classes/dep/Support.class")), {
      code: "ENOENT",
    });
    await assert.rejects(access(this.file(".ide/java/classes/build/Main.class")), {
      code: "ENOENT",
    });
    this.#proof.buildRespectsRoots = true;
  }
  async runFileMain() {
    await this.synchronize();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.invokeSource("Run", false);
    await this.waitExecution("run");
    await this.assertOutputAndProcess();
    assert.equal(
      await this.execution().$('input[placeholder="com.example.Main"]').getValue(),
      "build.Main",
    );
    this.#proof.fileMainRan = true;
  }
  async debugCursorMain() {
    await this.synchronize();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.execution().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await pasteNativeText(
      this.app(),
      this.execution().$('input[placeholder="com.example.Main"]'),
      "wrong.Missing",
    );
    await this.invokeSource("Debug", true);
    const debuggerPanel = this.execution().$('[aria-label="Structured Java debugger"]');
    await this.waitText(debuggerPanel, "suspended (entry)");
    await pasteNativeText(
      this.app(),
      debuggerPanel.$("label=Breakpoint (class:line)").$("input"),
      "build.Main:5",
    );
    await debuggerPanel.$("button=Set breakpoint").click();
    await debuggerPanel.$("button=Continue").waitForEnabled({ timeout: 5_000 });
    await debuggerPanel.$("button=Continue").click();
    await this.waitText(debuggerPanel, "suspended (breakpoint)");
    assert.ok((await debuggerPanel.getText()).includes("build.Main.main"));
    await debuggerPanel.$("button=Continue").click();
    await this.waitExecution("debug");
    await this.assertOutputAndProcess();
    this.#proof.cursorMainDebugBreakpoint = true;
  }
  async close() {
    await this.app().closeNativeWindow();
    this.#proof.cleanClose = true;
  }
  async assertFinal() {
    await this.app().assertExited();
    for (const [relative, text] of this.#inputs)
      assert.equal(await readFile(this.file(relative), "utf8"), text);
    assert.equal(await readFile(this.file(DECLARATION), "utf8"), this.#declaration);
    for (const [relative, bytes] of this.#binaryInputs)
      assert.deepEqual(await readFile(this.file(relative)), bytes);
    this.#proof.inputsPreserved = true;
    for (const key of [
      "declarationCreatedThroughForm",
      "existingDeclarationPreserved",
      "providerSynchronized",
      "buildRespectsRoots",
      "inputsPreserved",
      "cleanClose",
    ] as const)
      assert.equal(this.#proof[key], true, key);
    const required = this.#testWorkflow
      ? ([
          "testDeclarationCreatedThroughForm",
          "declaredTestMethodResults",
          "discoveryWithoutTestBodies",
          "capturedTestSelection",
          "separateRuntimeClasspaths",
          "compileOnlyDependencyExcluded",
          "generatedSourcesCompiled",
          "additionalModuleBuildAndExecution",
        ] as const)
      : (["fileMainRan", "cursorMainDebugBreakpoint"] as const);
    for (const key of required) assert.equal(this.#proof[key], true, key);
    await this.#lease!.assertConfiguredPathsConfined();
  }
  async captureFailure(error: unknown) {
    if (this.#lease && this.#app) {
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "declared-project-failure.txt"),
        `${String(error)}\n${await this.browser()
          .execute(() => document.body.innerText)
          .catch(() => "Page unavailable")}`,
      );
      await this.browser()
        .saveScreenshot(path.join(this.#lease.runnerArtifactPath, "declared-project-failure.png"))
        .catch(() => undefined);
    }
  }
  evidence() {
    return {
      ...this.#proof,
      testWorkflow: this.#testWorkflow,
      testFramework: this.#testWorkflow ? this.#testFramework : null,
      independentTestReports: this.#testReports,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  async dispose() {
    try {
      await this.#app?.dispose();
    } finally {
      for (const [key, value] of this.#originalEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await this.#lease?.dispose();
      if (this.#lease)
        await writeFile(
          path.join(
            this.#lease.runnerArtifactPath,
            this.#testWorkflow
              ? `java-declared-project-tests-${this.#testFramework}-native-evidence.json`
              : "java-declared-project-native-evidence.json",
          ),
          JSON.stringify(this.evidence(), null, 2),
        );
    }
  }
  private async synchronize() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.project().$("button=Synchronize project").click();
    await this.waitText(this.project(), "java-declared-v1 · available");
  }
  private async buildSelectedModule() {
    const before = await this.execution().getAttribute("data-session-id");
    await this.execution().$("button=Build").click();
    await this.browser().waitUntil(
      async () => {
        const current = await this.execution().getAttribute("data-session-id");
        return Boolean(current && current !== before);
      },
      { timeout: 5_000, timeoutMsg: "Build must create a new execution session" },
    );
    await this.waitExecution("build");
  }
  private async selectSourceSet(moduleId: string, sourceSetId: string) {
    const modules = this.execution().$("label=Synchronized module and source set").$("select");
    const expected = JSON.stringify(["java-declared-v1", moduleId, sourceSetId]);
    const options = await modules.$$("option").getElements();
    let found = -1;
    for (let index = 0; index < options.length; index++)
      if ((await options[index]!.getAttribute("value")) === expected) found = index;
    assert.ok(found >= 0, `Declared source set must be offered: ${expected}`);
    await modules.selectByIndex(found);
    assert.equal(await modules.getValue(), expected);
  }
  private async configureDeclaredTests() {
    await this.synchronize();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.selectSourceSet("app", "checks");
    await this.execution()
      .$("label=Plain-JDK test framework")
      .$("select")
      .selectByAttribute("value", this.#testFramework);
  }
  private async testReportDirectories() {
    return new Set(await readdir(this.file(".ide/java/test-results")).catch(() => [] as string[]));
  }
  private async assertDeclaredTestResult(before: ReadonlySet<string>) {
    await this.waitText(
      this.execution().$('[aria-label="Java test results"]'),
      "1 reported tests: 1 passed, 0 failed",
    );
    assert.equal(await readFile(this.file("declared-test-proof.txt"), "utf8"), "selected");
    await assert.rejects(access(this.file("unexpected-test-proof.txt")), { code: "ENOENT" });
    const current = [...(await this.testReportDirectories())].filter((value) => !before.has(value));
    assert.equal(current.length, 1);
    const script = `import json,sys,pathlib,xml.etree.ElementTree as ET
files=list(pathlib.Path(sys.argv[1]).glob('TEST-*.xml'))
if not files: files=list(pathlib.Path(sys.argv[1]).rglob('TEST-*.xml'))
assert 0 < len(files) <= 16
cases=[]
for file in files:
 raw=file.read_bytes()
 assert len(raw)<=131072 and b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw
 root=ET.fromstring(raw)
 assert root.tag=='testsuite'
 cases.extend(root.findall('testcase'))
assert len(cases)==1
case=cases[0]
assert case.get('classname')=='checks.ChecksTest' and case.get('name') in ('selected','selected()')
assert case.find('failure') is None and case.find('error') is None and case.find('skipped') is None
print(json.dumps(dict(tests=1,passed=1,className=case.get('classname'),method=case.get('name'))))`;
    const { stdout } = await promisify(execFile)("python3", [
      "-c",
      script,
      this.file(`.ide/java/test-results/${current[0]}`),
    ]);
    this.#testReports.push(JSON.parse(stdout));
  }
  private async invokeSource(operation: "Run" | "Debug", cursor: boolean) {
    await this.surface().tab(FILE).click();
    await this.surface().focus(FILE);
    await this.browser().keys(["Control", "Home"]);
    if (cursor) {
      for (let index = 1; index < 5; index++) await this.browser().keys("ArrowDown");
      const point = await this.browser().execute(() => {
        const bounds = document.querySelector(".monaco-editor .cursor")!.getBoundingClientRect();
        return { x: Math.round(bounds.left + 2), y: Math.round(bounds.top + bounds.height / 2) };
      });
      await this.browser()
        .action("pointer")
        .move({ ...point, origin: "viewport" })
        .down({ button: 2 })
        .up({ button: 2 })
        .perform();
    } else await this.surface().openContextMenu(FILE);
    try {
      const label = `${operation} main ${cursor ? "at cursor" : "from this file"}…`;
      await this.browser().waitUntil(
        async () => (await this.surface().contextMenuItem(label)) !== null,
        { timeout: 5_000 },
      );
      const point = await this.surface().contextMenuItem(label);
      assert.ok(point);
      await this.browser()
        .action("pointer")
        .move({ ...point, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
    } finally {
      await this.browser().releaseActions();
    }
  }
  private async assertOutputAndProcess() {
    const output = await this.execution().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes(`PLAIN_GUI_OK:from-jar|${this.#sdk}`), output);
    const pid = Number(await readFile(this.file("plain-pid.txt"), "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    await assert.rejects(access(`/proc/${pid}`), { code: "ENOENT" });
  }
  private async waitExecution(operation: string) {
    await this.waitText(this.execution(), `${operation}: succeeded (exit 0)`);
  }
  private async waitText(element: ChainablePromiseElement, text: string) {
    await this.browser().waitUntil(async () => (await element.getText()).includes(text), {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: `Expected visible text: ${text}`,
    });
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
  private project() {
    return this.browser().$('section[aria-label="Java project context"]');
  }
  private execution() {
    return this.browser().$('[aria-label="Java execution"]');
  }
  private workspace() {
    assert.ok(this.#lease);
    return this.#lease.paths.workspace;
  }
  private file(relative: string) {
    return path.join(this.workspace(), relative);
  }
}
