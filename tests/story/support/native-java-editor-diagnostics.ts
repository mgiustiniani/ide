import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface } from "./native-editor-surface.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { pasteNativeText } from "./native-text-input.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";

const MAIN = "class Main { int run() { return Helper.value(); } }\n";
const HELPER = "class Helper { static int value() { return 1; } }\n";
const DRAFT = MAIN.replace("return Helper", 'java.util.List.of("SDK API"); return Helper');
const CLOSED = "class Closed { Unknown value; }\n";
const REPAIRED_CLOSED = "// repaired saved source\nclass Closed {}\n";
const REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";

/** Public command, native editor input and visible markers; no private editor/provider APIs. */
export class NativeJavaEditorDiagnosticsSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app!: NativeDesktopApplication;
  #surface!: NativeEditorSurface;
  #environment = new Map<string, string | undefined>();
  #inputs = new Map<string, string>();
  #restricted = false;
  #languageRelease = 8;
  #metadataOnlyChecks: Record<string, boolean> | null = null;
  #externalSourceChecks: Record<string, boolean> | null = null;
  #gradle = false;
  #multiModule = false;
  #testSources = false;
  #testRepository = "";
  #mainRejectsTestDependency = false;
  #testDependencyRepair = false;
  #changedSignature = false;
  #repairedCaller = false;
  #signatureError = false;
  #signatureRepair = false;
  #sdk = "";
  #traceStartLine = 0;
  #sdk26Checks: { removedApiRefused: boolean; backendAttested: boolean } | null = null;
  #sdk26TestClasspathAttested = false;
  #proof = {
    synchronized: false,
    dirtyBuildInputRefused: false,
    automaticChecks: false,
    automaticChecksPaused: false,
    draftErrors: false,
    markers: false,
    repaired: false,
    closedProblemNavigated: false,
    closedSourceRepaired: false,
    retiredOnEdit: false,
    inputsPreserved: false,
    cleanClose: false,
  };
  async prepare(
    profile: string,
    buildTool: "maven" | "gradle" = "maven",
    multiModule = false,
    testSources = false,
  ) {
    assert.ok(!(multiModule && testSources));
    this.#multiModule = multiModule;
    this.#testSources = testSources;
    if (testSources) {
      this.#testRepository = process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY!;
      assert.ok(this.#testRepository && path.isAbsolute(this.#testRepository));
    }
    this.#gradle = buildTool === "gradle";
    const compilerProfile = /^(source\/target|release) (8|26|27)$/.exec(profile);
    assert.ok(compilerProfile);
    this.#languageRelease = Number(compilerProfile[2]);
    this.#restricted = compilerProfile[1] === "release";
    const daemon = process.env.IDE_REAL_REFACTORKIT_DAEMON;
    assert.ok(daemon && path.isAbsolute(daemon));
    this.#sdk = await realpath(process.env.IDE_JAVA_CONTEXT_TEST_JDK!);
    if (this.#languageRelease === 26) {
      this.#sdk26Checks = { removedApiRefused: false, backendAttested: false };
      assert.ok(!this.#gradle && !multiModule, "SDK26 qualification requires a single Maven module");
      assert.match(await readFile(path.join(this.#sdk, "release"), "utf8"), /^JAVA_VERSION="26[.+-]/mu);
    }
    this.#lease = await NativeScenarioEnvironmentLease.acquire(REQUIREMENT);
    for (const key of [
      "IDE_REFACTORKIT_DAEMON",
      "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE",
      "IDE_REFACTORKIT_ENGINE",
      "IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE",
      "IDE_JAVA_CONTEXT_TRACE_PATH",
      "IDE_JAVA_CONTEXT_TRACE",
    ])
      this.#environment.set(key, process.env[key]);
    process.env.IDE_REFACTORKIT_DAEMON = daemon;
    process.env.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE = "1";
    process.env.IDE_REFACTORKIT_ENGINE = path.join(path.dirname(daemon), "refactorkit");
    process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE = "1";
    process.env.IDE_JAVA_CONTEXT_TRACE_PATH = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    if (this.#languageRelease === 26) {
      process.env.IDE_JAVA_CONTEXT_TRACE = "1";
      this.#traceStartLine = (await readFile(process.env.IDE_JAVA_CONTEXT_TRACE_PATH, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
    }
    const mode = this.#restricted
      ? `<maven.compiler.release>${this.#languageRelease}</maven.compiler.release>`
      : `<maven.compiler.source>${this.#languageRelease}</maven.compiler.source><maven.compiler.target>${this.#languageRelease}</maven.compiler.target>`;
    this.#inputs = new Map([
      [this.source("Main.java"), this.main()],
      [this.source("Helper.java"), this.helper()],
      [this.source("Closed.java"), CLOSED],
      [
        "pom.xml",
        `<project><modelVersion>4.0.0</modelVersion><groupId>acceptance</groupId><artifactId>editor-errors</artifactId><version>1</version><properties>${mode}</properties><build><sourceDirectory>.</sourceDirectory><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>`,
      ],
    ]);
    if (this.#languageRelease !== 8)
      this.#inputs.set(
        "pom.xml",
        this.#inputs.get("pom.xml")!.replace("<sourceDirectory>.</sourceDirectory>", ""),
      );
    if (this.#multiModule && !this.#gradle) {
      const parent =
        "<parent><groupId>acceptance</groupId><artifactId>editor-errors</artifactId><version>1</version></parent>";
      this.#inputs.set(
        "pom.xml",
        this.#inputs
          .get("pom.xml")!
          .replace(
            "<version>1</version>",
            "<version>1</version><packaging>pom</packaging><modules><module>library</module><module>app</module></modules>",
          )
          .replace("<sourceDirectory>.</sourceDirectory>", ""),
      );
      this.#inputs.set(
        "library/pom.xml",
        `<project><modelVersion>4.0.0</modelVersion>${parent}<artifactId>library</artifactId></project>`,
      );
      this.#inputs.set(
        "app/pom.xml",
        `<project><modelVersion>4.0.0</modelVersion>${parent}<artifactId>app</artifactId><dependencies><dependency><groupId>acceptance</groupId><artifactId>library</artifactId><version>1</version></dependency></dependencies></project>`,
      );
    }
    if (this.#testSources && !this.#gradle) {
      this.#inputs.set(
        "pom.xml",
        this.#inputs
          .get("pom.xml")!
          .replace("<sourceDirectory>.</sourceDirectory>", "")
          .replace(
            "<properties>",
            "<dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-api</artifactId><version>5.11.4</version><scope>test</scope></dependency></dependencies><properties>",
          ),
      );
    }
    if (this.#gradle) {
      this.#inputs.delete("pom.xml");
      const version = (await readFile(path.join(this.#sdk, "release"), "utf8")).match(
        /JAVA_VERSION="(\d+)/,
      )?.[1];
      assert.ok(version);
      const target = this.#languageRelease === 8 ? "1.8" : String(this.#languageRelease);
      const compiler = this.#restricted
        ? `options.release = ${this.#languageRelease}`
        : `sourceCompatibility = '${target}'; targetCompatibility = '${target}'`;
      this.#inputs.set(
        "settings.gradle",
        "rootProject.name = 'editor-errors'\n" +
          (this.#multiModule ? "include 'library', 'app'\n" : ""),
      );
      this.#inputs.set(
        "build.gradle",
        this.#multiModule
          ? `subprojects { apply plugin: 'java'\njava { toolchain { languageVersion = JavaLanguageVersion.of(${version}) } }\ntasks.withType(JavaCompile).configureEach { ${compiler} } }\nproject(':app') { dependencies { implementation project(':library') } }\n`
          : `plugins { id 'java' }\njava { toolchain { languageVersion = JavaLanguageVersion.of(${version}) } }\ntasks.withType(JavaCompile).configureEach { ${compiler} }\n`,
      );
      if (this.#testSources) {
        const repository = this.#testRepository.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
        this.#inputs.set(
          "build.gradle",
          this.#inputs.get("build.gradle")! +
            `repositories { maven { url = uri('${repository}') } }\ndependencies { testImplementation 'org.junit.jupiter:junit-jupiter-api:5.11.4' }\n`,
        );
      }
      this.#inputs.set(
        "gradle.properties",
        `org.gradle.daemon=false\norg.gradle.workers.max=2\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\norg.gradle.java.installations.paths=${this.#sdk}\n`,
      );
      await mkdir(this.file(".ide/gradle-cache"), { recursive: true });
    }
    await mkdir(this.#lease.paths.workspace, { recursive: true });
    for (const [file, text] of this.#inputs) {
      await mkdir(path.dirname(this.file(file)), { recursive: true });
      await writeFile(this.file(file), text);
    }
    await this.#lease.assertConfiguredPathsConfined();
  }
  async prepareExternalSource(buildTool: "maven" | "gradle") {
    await this.prepare("source/target 8", buildTool);
    if (this.#gradle) {
      const build =
        this.#inputs.get("build.gradle")! +
        "file('.ide/evaluation-count.txt').append('evaluated\\n')\n";
      this.#inputs.set("build.gradle", build);
      await writeFile(this.file("build.gradle"), build);
    }
  }
  main() {
    return this.#testSources
      ? MAIN.replace("class Main", "class MainTest").replace(
          "int run()",
          "@org.junit.jupiter.api.Test void verifies() { if (Helper.value() != 1) throw new AssertionError(); } int run()",
        )
      : MAIN;
  }
  helper() {
    return this.#multiModule
      ? HELPER.replace("class Helper", "public class Helper").replace(
          "static int",
          "public static int",
        )
      : HELPER;
  }
  repairedHelper() {
    const text = "// repaired draft\n" + this.helper();
    return this.#changedSignature
      ? text.replace("int value()", "String value()").replace("return 1", 'return "changed"')
      : text;
  }
  draft() {
    const draft = this.#testSources
      ? this.main().replace("return Helper", 'java.util.List.of("SDK API"); return Helper')
      : DRAFT;
    return this.#repairedCaller ? draft.replace("int run()", "String run()") : draft;
  }
  source(name: string) {
    if (this.#testSources)
      return `src/${name === "Helper.java" ? "main" : "test"}/java/${name === "Main.java" ? "MainTest.java" : name}`;
    if (this.#multiModule)
      return `${name === "Helper.java" ? "library" : "app"}/src/main/java/${name}`;
    return this.#gradle || this.#languageRelease !== 8 ? `src/main/java/${name}` : name;
  }
  file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
  browser() {
    return this.#app.browser();
  }
  async command(label: string) {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5000 });
    await palette.$('input[aria-label="Search commands"]').setValue(label);
    await palette.$(`[role="option"][aria-label^="${label}"]`).click();
  }
  async launch() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    assert.equal(
      await this.#app.environmentValue("IDE_REFACTORKIT_DAEMON"),
      process.env.IDE_REFACTORKIT_DAEMON,
    );
    await this.#app.waitForFileExplorer();
    if (this.#gradle || this.#multiModule || this.#testSources || this.#languageRelease !== 8) {
      const directories = this.#multiModule
        ? [
            "library",
            "library/src",
            "library/src/main",
            "library/src/main/java",
            "app",
            "app/src",
            "app/src/main",
            "app/src/main/java",
          ]
        : this.#testSources
          ? ["src", "src/main", "src/main/java", "src/test", "src/test/java"]
          : ["src", "src/main", "src/main/java"];
      for (const directory of directories) {
        const row = this.browser().$(`[role="treeitem"][data-path="${directory}"]`);
        await row.waitForDisplayed({ timeout: 15000 });
        if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
      }
    }

    const buildFile = this.#gradle ? "build.gradle" : "pom.xml";
    await this.#surface.open(buildFile, this.#inputs.get(buildFile)!);
    await this.#surface.open(this.source("Helper.java"), this.helper());
    await this.#surface.open(this.source("Main.java"), this.main());
    await this.command("Open Java Project");
    const panel = this.browser().$('section[aria-label="Java project context"]');
    await panel.waitForDisplayed({ timeout: 10000 });
    await pasteNativeText(this.#app, panel.$("#java-project-sdk-home"), this.#sdk);
    if (this.#testSources) {
      const details = panel.$(".//details[summary='Maven settings']");
      if ((await details.getAttribute("open")) === null) await details.$("summary").click();
      await pasteNativeText(this.#app, panel.$("#java-maven-repository"), this.#testRepository);
      await details.$("summary").click();
    }
    if (this.#gradle) {
      const details = panel.$(".//details[summary='Gradle settings']");
      if ((await details.getAttribute("open")) === null) await details.$("summary").click();
      assert.ok(
        process.env.IDE_JAVA_CONTEXT_TEST_GRADLE && process.env.IDE_JAVA_CONTEXT_GRADLE_JDK,
      );
      await pasteNativeText(
        this.#app,
        panel.$("#java-gradle-executable"),
        process.env.IDE_JAVA_CONTEXT_TEST_GRADLE,
      );
      await pasteNativeText(
        this.#app,
        panel.$("#java-gradle-runtime-home"),
        process.env.IDE_JAVA_CONTEXT_GRADLE_JDK,
      );
      await pasteNativeText(
        this.#app,
        panel.$("#java-gradle-user-home"),
        this.file(".ide/gradle-cache"),
      );
      await panel.$("button=Evaluate Gradle project").click();
    } else await panel.$("button=Synchronize project").click();
    await this.browser().waitUntil(
      async () =>
        (await panel.getText()).includes(
          `${this.#gradle ? "gradle" : "maven"}-effective-v1 · available`,
        ),
      { timeout: 90000, interval: 200 },
    );
    this.#proof.synchronized = true;
  }
  async checkExternalSource() {
    this.#externalSourceChecks = {
      automaticRecovery: false,
      freshSnapshot: false,
      draftsPreserved: false,
      noBuildEvaluation: false,
      inputsPreserved: false,
      normalClose: false,
    };
    const trace = async () =>
      (await readFile(process.env.IDE_JAVA_CONTEXT_TRACE_PATH!, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const requests = (events: Awaited<ReturnType<typeof trace>>) =>
      events.filter((entry) => entry.event === "refactorkit.daemon.rpc.request");
    await this.command("Enable Automatic Java Compiler Checks");
    await this.waitStatus("2 Java compiler errors in 3 analyzed sources.");
    const before = requests(await trace());
    const beforeSnapshot = before
      .filter(
        (entry) =>
          entry.details.method === "intelligence.query" &&
          entry.details.params.kind === "diagnostics",
      )
      .at(-1)!.details.params.expectedSnapshotHash;
    const evaluations = this.#gradle
      ? await readFile(this.file(".ide/evaluation-count.txt"))
      : null;
    await writeFile(
      this.file(this.source("Closed.java")),
      "class Closed {} // changed outside the IDE\n",
    );
    await this.waitStatus("1 Java compiler error in 3 analyzed sources.");
    this.#externalSourceChecks.automaticRecovery = true;
    const after = requests(await trace());
    const afterSnapshot = after
      .filter(
        (entry) =>
          entry.details.method === "intelligence.query" &&
          entry.details.params.kind === "diagnostics",
      )
      .at(-1)!.details.params.expectedSnapshotHash;
    assert.ok(
      beforeSnapshot && afterSnapshot && beforeSnapshot !== afterSnapshot,
      "external source change must acquire a fresh snapshot",
    );
    this.#externalSourceChecks.freshSnapshot = true;
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.#surface.assertBuffer(
      this.source("Helper.java"),
      this.helper().replace("return 1", 'return "wrong type"'),
    );
    await this.#surface.tab(this.source("Main.java")).click();
    assert.equal(await readFile(this.file(this.source("Main.java")), "utf8"), this.main());
    assert.equal(await readFile(this.file(this.source("Helper.java")), "utf8"), this.helper());
    this.#externalSourceChecks.draftsPreserved = true;
    assert.equal(
      after.filter((entry) => entry.details.method === "project.sync").length,
      before.filter((entry) => entry.details.method === "project.sync").length,
    );
    if (evaluations)
      assert.deepEqual(await readFile(this.file(".ide/evaluation-count.txt")), evaluations);
    this.#externalSourceChecks.noBuildEvaluation = true;
  }
  async closeExternalSource() {
    assert.ok(this.#externalSourceChecks);
    await this.browser().$("button=Pause automatic checks").click();
    await this.#surface.discardUsingDisk(this.source("Main.java"), this.main(), {
      expectedBuffer: this.draft(),
    });
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.#surface.discardUsingDisk(this.source("Helper.java"), this.helper(), {
      expectedBuffer: this.helper().replace("return 1", 'return "wrong type"'),
    });
    await writeFile(this.file(this.source("Closed.java")), CLOSED);
    await this.#app.closeNativeWindow();
    await this.#app.assertExited();
    this.#externalSourceChecks.normalClose = true;
    for (const [file, text] of this.#inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
    this.#externalSourceChecks.inputsPreserved = true;
  }
  assertExternalSourceClosure() {
    assert.ok(this.#externalSourceChecks);
    for (const [name, passed] of Object.entries(this.#externalSourceChecks))
      assert.equal(passed, true, name);
  }
  async checkMetadataOnly() {
    this.#metadataOnlyChecks = {
      manualUnavailable: false,
      automaticUnavailable: false,
      noProviderDiagnosticQueries: false,
      draftPreserved: false,
      contextPreserved: false,
      inputsPreserved: false,
      normalClose: false,
    };
    const panel = this.browser().$('section[aria-label="Java project context"]');
    assert.ok(
      (await panel.getText())
        .replace(/\s+/g, " ")
        .includes("Java source and symbol analysis is unavailable"),
    );
    const unavailable =
      "RefactorKit cannot analyze Java source for this project. Project build settings remain available.";
    await this.command("Check Java Compiler Errors");
    await this.waitStatus(unavailable);
    this.#metadataOnlyChecks.manualUnavailable = true;
    await this.command("Enable Automatic Java Compiler Checks");
    await this.#surface.tab(this.source("Main.java")).click();
    await this.#surface.replace(this.source("Main.java"), this.draft());
    await this.waitStatus(unavailable);
    // Observe beyond the 750 ms automatic-check interval before asserting an absent provider query.
    await this.browser().pause(1500);
    await this.waitStatus(unavailable);
    this.#metadataOnlyChecks.automaticUnavailable = true;
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    assert.equal(await readFile(this.file(this.source("Main.java")), "utf8"), this.main());
    this.#metadataOnlyChecks.draftPreserved = true;
    assert.ok((await panel.getText()).includes("maven-effective-v1 · available"));
    assert.ok(
      (await panel.getText())
        .replace(/\s+/g, " ")
        .includes("Java source and symbol analysis is unavailable"),
    );
    this.#metadataOnlyChecks.contextPreserved = true;
    const trace = (await readFile(process.env.IDE_JAVA_CONTEXT_TRACE_PATH!, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      trace.filter(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "intelligence.query" &&
          entry.details.params.kind === "diagnostics",
      ).length,
      0,
    );
    this.#metadataOnlyChecks.noProviderDiagnosticQueries = true;
  }
  async closeMetadataOnly() {
    assert.ok(this.#metadataOnlyChecks);
    await this.browser().$("button=Pause automatic checks").click();
    await this.#surface.discardUsingDisk(this.source("Main.java"), this.main(), {
      expectedBuffer: this.draft(),
    });
    await this.#app.closeNativeWindow();
    await this.#app.assertExited();
    this.#metadataOnlyChecks.normalClose = true;
    for (const [file, text] of this.#inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
    this.#metadataOnlyChecks.inputsPreserved = true;
  }
  assertMetadataOnlyClosure() {
    assert.ok(this.#metadataOnlyChecks);
    for (const [name, passed] of Object.entries(this.#metadataOnlyChecks))
      assert.equal(passed, true, name);
  }
  async edit() {
    const buildFile = this.#gradle ? "build.gradle" : "pom.xml";
    const savedBuild = this.#inputs.get(buildFile)!;
    const draftBuild =
      savedBuild +
      (this.#gradle ? "\n// unsaved build draft\n" : "\n<!-- unsaved build draft -->\n");
    await this.#surface.tab(buildFile).click();
    await this.#surface.replace(buildFile, draftBuild);
    await this.#surface.tab(this.source("Main.java")).click();
    await this.command("Check Java Compiler Errors");
    await this.waitStatus(
      `Build input ${buildFile} has unsaved changes; save or discard them and synchronize the project before checking Java compiler errors.`,
    );
    await this.#surface.tab(buildFile).click();
    await this.#surface.assertBuffer(buildFile, draftBuild);
    assert.equal(await readFile(this.file(buildFile), "utf8"), savedBuild);
    await this.#surface.discardUsingDisk(buildFile, savedBuild, { expectedBuffer: draftBuild });
    this.#proof.dirtyBuildInputRefused = true;
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.#surface.replace(
      this.source("Helper.java"),
      this.helper().replace("return 1", 'return "wrong type"'),
    );
    await this.#surface.tab(this.source("Main.java")).click();
    await this.#surface.replace(this.source("Main.java"), this.draft());
  }
  async check() {
    await this.command("Check Java Compiler Errors");
    const expected = this.apiRestricted ? 3 : 2;
    await this.waitStatus(`${expected} Java compiler errors in 3 analyzed sources.`);
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.#surface.assertBuffer(
      this.source("Helper.java"),
      this.helper().replace("return 1", 'return "wrong type"'),
    );
    await this.browser().waitUntil(
      async () => (await this.browser().$$(".monaco-editor .squiggly-error").length) > 0,
      { timeout: 10000 },
    );
    this.#proof.markers = true;
    await this.browser().$('[role="tab"][title="Problems in the current project"]').click();
    await this.browser().waitUntil(
      async () => (await this.browser().$("body").getText()).includes("RefactorKit Java compiler"),
      { timeout: 5000 },
    );
    this.#proof.draftErrors = true;
    await this.browser()
      .$('[role="treeitem"][aria-label*="Closed.java"][aria-label*="RefactorKit Java compiler"]')
      .click();
    await this.#surface.assertBuffer(this.source("Closed.java"), CLOSED);
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$("body").getText()).includes(
          `Ln 1, Col ${CLOSED.indexOf("Unknown") + 1}`,
        ),
      { timeout: 10000 },
    );
    await this.waitStatus("Java buffers changed; run the compiler check again.");
    this.#proof.closedProblemNavigated = true;
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.command("Check Java Compiler Errors");
    await this.waitStatus(`${expected} Java compiler errors in 3 analyzed sources.`);
  }
  async repair() {
    await this.#surface.replace(this.source("Helper.java"), this.repairedHelper());
    await this.waitStatus("Java buffers changed; run the compiler check again.");
    this.#proof.retiredOnEdit = true;
    await this.command("Enable Automatic Java Compiler Checks");
    await this.browser()
      .$('[role="status"][aria-label="Automatic Java compiler checks"]')
      .waitForDisplayed({ timeout: 5000 });
    const withClosed = this.apiRestricted ? 2 : 1;
    await this.waitStatus(
      `${withClosed} Java compiler ${withClosed === 1 ? "error" : "errors"} in 3 analyzed sources.`,
    );
    await this.#surface.tab(this.source("Closed.java")).click();
    await this.#surface.replace(this.source("Closed.java"), REPAIRED_CLOSED);
    const expected = this.apiRestricted ? 1 : 0;
    await this.waitStatus(
      `${expected} Java compiler ${expected === 1 ? "error" : "errors"} in 3 analyzed sources.`,
    );
    this.#proof.closedSourceRepaired = true;
    this.#proof.automaticChecks = true;
    await this.#surface.tab(this.source("Main.java")).click();
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    if (this.#multiModule) {
      await this.#surface.tab(this.source("Helper.java")).click();
      this.#changedSignature = true;
      await this.#surface.replace(this.source("Helper.java"), this.repairedHelper());
      await this.waitStatus("1 Java compiler error in 3 analyzed sources.");
      await this.#surface.tab(this.source("Main.java")).click();
      await this.browser().waitUntil(
        async () => (await this.browser().$$(".monaco-editor .squiggly-error").length) > 0,
        { timeout: 10000 },
      );
      this.#signatureError = true;
      this.#repairedCaller = true;
      await this.#surface.replace(this.source("Main.java"), this.draft());
      await this.waitStatus("0 Java compiler errors in 3 analyzed sources.");
      this.#signatureRepair = true;
    }
    if (this.#testSources) {
      await this.#surface.tab(this.source("Helper.java")).click();
      const leaked = this.repairedHelper().replace(
        "static int value()",
        "org.junit.jupiter.api.Test testOnly; static int value()",
      );
      await this.#surface.replace(this.source("Helper.java"), leaked);
      await this.waitStatus("1 Java compiler error in 3 analyzed sources.");
      await this.browser().waitUntil(
        async () => (await this.browser().$$(".monaco-editor .squiggly-error").length) > 0,
        { timeout: 10000 },
      );
      this.#mainRejectsTestDependency = true;
      if (this.#languageRelease === 26) {
        const latest = (await this.sdk26DiagnosticResults()).at(-1);
        assert.ok(latest, "No SDK26 main-source diagnostic response was recorded");
        assert.equal(latest.total, 1);
        assert.equal(latest.items.length, 1);
        assert.equal(latest.items[0].location.path, this.source("Helper.java"));
        assert.equal(latest.items[0].code, "java.javac.compiler.err.doesnt.exist");
        assert.ok(latest.items[0].message.includes("org.junit.jupiter.api"));
        this.#sdk26TestClasspathAttested = true;
      }
      await this.#surface.replace(this.source("Helper.java"), this.repairedHelper());
      await this.waitStatus("0 Java compiler errors in 3 analyzed sources.");
      this.#testDependencyRepair = true;
      await this.#surface.tab(this.source("Main.java")).click();
    }
  }
  async assertTestClasspath() {
    assert.equal(this.#testSources, true);
    assert.equal(this.#mainRejectsTestDependency, true);
    assert.equal(this.#testDependencyRepair, true);
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    await this.waitStatus("0 Java compiler errors in 3 analyzed sources.");
  }
  async assertCrossModule() {
    assert.equal(this.#multiModule, true);
    assert.equal(this.#signatureError, true);
    assert.equal(this.#signatureRepair, true);
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.#surface.assertBuffer(this.source("Helper.java"), this.repairedHelper());
    await this.#surface.tab(this.source("Main.java")).click();
    await this.waitStatus("0 Java compiler errors in 3 analyzed sources.");
  }
  async assertRepair() {
    assert.equal(this.#proof.retiredOnEdit, true);
    const expected = this.apiRestricted ? 1 : 0;
    await this.waitStatus(
      `${expected} Java compiler ${expected === 1 ? "error" : "errors"} in 3 analyzed sources.`,
    );
    await this.#surface.assertBuffer(this.source("Main.java"), this.draft());
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$$(".monaco-editor .squiggly-error").length) > 0 === this.apiRestricted,
      { timeout: 10000 },
    );
    this.#proof.repaired = true;
    if (this.#languageRelease === 26) {
      const removedApi = this.draft().replace("return Helper", "java.applet.Applet removed = null; return Helper");
      await this.#surface.replace(this.source("Main.java"), removedApi);
      await this.waitStatus("1 Java compiler error in 3 analyzed sources.");
      const results = await this.sdk26DiagnosticResults();
      assert.ok(results.some(result => result.items.some((item: {code:string;message:string}) =>
        item.code === "java.javac.compiler.err.doesnt.exist" && item.message.includes("java.applet"))));
      this.#sdk26Checks!.removedApiRefused = true;
      this.#sdk26Checks!.backendAttested = true;
      await this.#surface.assertBuffer(this.source("Main.java"), removedApi);
      assert.equal(await readFile(this.file(this.source("Main.java")), "utf8"), this.main());
      await this.#surface.replace(this.source("Main.java"), this.draft());
      await this.waitStatus("0 Java compiler errors in 3 analyzed sources.");
    }
  }
  private async sdk26DiagnosticResults() {
    const trace = (await readFile(process.env.IDE_JAVA_CONTEXT_TRACE_PATH!, "utf8"))
      .split("\n").filter(Boolean).slice(this.#traceStartLine).map(line => JSON.parse(line));
    const results = trace
      .filter(row => row.event === "refactorkit.daemon.rpc.response" && row.details.method === "intelligence.query")
      .map(row => row.details.response.result)
      .filter(result => result?.kind === "diagnostics" && result.status === "ready");
    assert.ok(results.length > 0, "No SDK26 compiler provenance was recorded");
    for (const result of results) {
      assert.equal(result.providerId, "java-sdk-compiler-diagnostics-v1");
      assert.equal(result.backend, "jdk26-javac-compiler-errors-v1");
      assert.equal(result.contextSchemaVersion, "java-project-context-v7");
    }
    return results;
  }
  async discardAndClose() {
    await this.browser().$("button=Pause automatic checks").click();
    await this.browser()
      .$('[role="status"][aria-label="Automatic Java compiler checks"]')
      .waitForDisplayed({ reverse: true, timeout: 5000 });
    this.#proof.automaticChecksPaused = true;
    await this.#surface.discardUsingDisk(this.source("Main.java"), this.main(), {
      expectedBuffer: this.draft(),
    });
    await this.#surface.tab(this.source("Helper.java")).click();
    await this.#surface.discardUsingDisk(this.source("Helper.java"), this.helper(), {
      expectedBuffer: this.repairedHelper(),
    });
    await this.#surface.tab(this.source("Closed.java")).click();
    await this.#surface.discardUsingDisk(this.source("Closed.java"), CLOSED, {
      expectedBuffer: REPAIRED_CLOSED,
    });
    await this.#app.closeNativeWindow();
    this.#proof.cleanClose = true;
  }
  async assertFinal() {
    await this.#app.assertExited();
    for (const [file, text] of this.#inputs)
      assert.equal(await readFile(this.file(file), "utf8"), text);
    this.#proof.inputsPreserved = true;
    for (const [name, value] of Object.entries(this.#proof)) assert.equal(value, true, name);
    if (this.#sdk26Checks) for (const [name, value] of Object.entries(this.#sdk26Checks)) assert.equal(value, true, name);
    if (this.#testSources) {
      assert.equal(this.#mainRejectsTestDependency, true);
      assert.equal(this.#testDependencyRepair, true);
      if (this.#languageRelease === 26) assert.equal(this.#sdk26TestClasspathAttested, true);
    }
    if (this.#multiModule) {
      assert.equal(
        this.#signatureError,
        true,
        "changed library signature must invalidate app caller",
      );
      assert.equal(
        this.#signatureRepair,
        true,
        "dirty app repair must resolve the cross-module error",
      );
    }
  }
  async waitStatus(expected: string) {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[role="status"][aria-label="Java compiler check"]').getText()) ===
        expected,
      {
        timeout: 30000,
        interval: 200,
        timeoutMsg: `Java compiler check did not report ${expected}`,
      },
    );
  }
  evidence() {
    return {
      requirement: REQUIREMENT,
      nativeGui: true,
      e2e: true,
      ...nativeArtifactEvidence(),
      profile: `${this.#restricted ? "release" : "source/target"} ${this.#languageRelease}`,
      sdk26CompilerChecks: this.#sdk26Checks,
      buildTool: this.#gradle ? "gradle" : "maven",
      multiModule: this.#multiModule,
      testSources: this.#testSources,
      metadataOnlyCompilerChecks: this.#metadataOnlyChecks,
      externalSourceChecks: this.#externalSourceChecks,
      testSourceClasspath: this.#testSources
        ? {
            mainRejectsTestDependency: this.#mainRejectsTestDependency,
            repair: this.#testDependencyRepair,
            ...(this.#languageRelease === 26 ? { sdk26SeparationAttested: this.#sdk26TestClasspathAttested } : {}),
          }
        : null,
      crossModuleSignature: this.#multiModule
        ? { callerError: this.#signatureError, callerRepair: this.#signatureRepair }
        : null,
      ...(this.#metadataOnlyChecks || this.#externalSourceChecks
        ? { synchronized: this.#proof.synchronized }
        : this.#proof),
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  private get apiRestricted() { return this.#restricted && this.#languageRelease === 8; }
  async captureFailure(error: unknown) {
    if (!this.#lease || !this.#app) return;
    const body = await this.browser().$("body").getText().catch(() => "unavailable");
    const name = `java-editor-errors-${this.#restricted ? "release" : "source-target"}${this.#languageRelease}-failure`;
    await writeFile(path.join(this.#lease.runnerArtifactPath, `${name}.json`), JSON.stringify({
      message: error instanceof Error ? error.message : String(error), text: body.slice(0, 20000),
    }, null, 2));
    await this.browser().saveScreenshot(path.join(this.#lease.runnerArtifactPath, `${name}.png`)).catch(() => undefined);
  }
  async dispose() {
    try {
      await this.#app?.dispose();
    } finally {
      for (const [key, value] of this.#environment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await this.#lease?.dispose();
      if (this.#lease)
        await writeFile(
          path.join(
            this.#lease.runnerArtifactPath,
            `java-editor-errors-${this.#externalSourceChecks ? "external-" : ""}${this.#testSources ? "test-" : ""}${this.#multiModule ? "multi-" : ""}${this.#gradle ? "gradle-" : ""}${this.#restricted ? "release" : "source-target"}${this.#languageRelease}-native-evidence.json`,
          ),
          JSON.stringify(this.evidence(), null, 2),
        );
    }
  }
}
