import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, constants, cp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { readNativeJavaExecutionStatuses } from "./native-java-execution-status.js";
import { pasteNativeText } from "./native-text-input.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import { JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT } from "./native-java-project-context.js";

const executeFile = promisify(execFile);

async function assertGradleWrapperDistributions(project: string): Promise<void> {
  const wrapperDirectory = path.join(project, "gradle/wrapper");
  const variants = [
    {
      name: "java8",
      version: "8.14.6",
      checksum: "7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24",
    },
    {
      name: "java25",
      version: "9.8.0",
      checksum: "bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c",
    },
  ];
  for (const variant of variants) {
    const properties = await readFile(
      path.join(wrapperDirectory, `gradle-wrapper-${variant.name}.properties`),
      "utf8",
    );
    const jar = await readFile(path.join(wrapperDirectory, `gradle-wrapper-${variant.name}.jar`));
    assert.match(properties, new RegExp(`gradle-${variant.version}-bin\\.zip`));
    assert.match(properties, new RegExp(`distributionSha256Sum=${variant.checksum}`));
    assert.match(properties, /networkTimeout=120000\n/);
    assert.equal(
      createHash("sha256").update(jar).digest("hex"),
      "238e777fcddd7e34f9708186085def2abd6e08e658505b38718d79d74c21abd5",
    );
  }
  assert.match(await readFile(path.join(project, "gradlew"), "utf8"), /gradle-wrapper-java25\.jar/);
  assert.match(
    await readFile(path.join(project, "gradlew.bat"), "utf8"),
    /gradle-wrapper-java8\.jar/,
  );
}

export class NativeJavaProjectScaffoldSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #proof = {
    requirement: JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    wizardOpened: false,
    starterCreated: false,
    springBootStarterCreated: false,
    springBootSynchronizationRequiresJdk: false,
    springBootGradleStartersCreated: false,
    springBootGradleSynchronizationRequiresJdk: false,
    springBootStarterBuiltTested: false,
    springBootStarterTestedFromJavaRun: false,
    springBootStarterRanFromJavaRun: false,
    springBootEndpointResponse: "",
    springBootGradleBuilds: [] as {
      project: string;
      dsl: "groovy" | "kotlin";
      testCases: number;
      endpointResponse: string;
    }[],
    mavenWrapperCreated: false,
    java26StarterCreated: false,
    java26StarterWrapperCreated: false,
    java26GradleStarterCreated: false,
    java26GradleWrapperCreated: false,
    java26ProjectTreeRefreshed: false,
    java26StarterUnbuilt: false,
    java26StartersBuiltTestedAndRun: false,
    java26PinnedWrappersBootstrapped: false,
    java26Builds: [] as {
      project: string;
      buildTool: "maven" | "gradle";
      testCases: number;
      classFileMajor: number;
      jdkMajor: number;
      applicationOutput: string;
    }[],
    java27StarterCreated: false,
    java27WrapperCreated: false,
    gradleMultiModuleCreated: false,
    gradleGroovyWrapperCreated: false,
    gradleKotlinDslCreated: false,
    gradleKotlinWrapperCreated: false,
    projectTreeRefreshed: false,
    synchronizationRequiresJdk: false,
    gradleSynchronizationRequiresJdk: false,
    kotlinGradleSynchronizationRequiresJdk: false,
    generatedProjectsBuiltTestedAndRun: false,
    java27StarterBuiltTestedAndRun: false,
    java27StarterJdkMajor: 0,
    java27StarterClassFileMajor: 0,
    java27PinnedWrappersBootstrapped: false,
    java27GradleStartersCreated: false,
    java27GradleSynchronizationRequiresJdk: false,
    java27KotlinGradleSynchronizationRequiresJdk: false,
    java27GradleBuilds: [] as {
      project: string;
      dsl: "groovy" | "kotlin";
      testCases: number;
      classFileMajor: number;
      jdkMajor: number;
      applicationOutput: string;
    }[],
    scaffoldBuilds: [] as {
      project: string;
      buildTool: "maven" | "gradle";
      release: number;
      testCases: number;
      applicationOutput: string;
    }[],
    existingProjectPreserved: false,
    gradleExistingProjectPreserved: false,
    cleanExit: false,
  };

  async prepare(): Promise<void> {
    this.#lease = await NativeScenarioEnvironmentLease.acquire(
      JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT,
    );
    assert.deepEqual(await readdir(this.workspace()), [], "workspace must start empty");
    await this.#lease.assertConfiguredPathsConfined();
  }

  async openWizard({ refactorKit = false, buildTool = "maven" }: {
    refactorKit?: boolean;
    buildTool?: "maven" | "gradle";
  } = {}): Promise<void> {
    const app = (this.#app = new NativeDesktopApplication());
    const environment: Record<string, string> = {};
    if (refactorKit) {
      const daemon = await this.configuredExecutable("IDE_REAL_REFACTORKIT_DAEMON", "");
      environment.IDE_REFACTORKIT_DAEMON = daemon;
      environment.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE = "1";
      environment.IDE_REFACTORKIT_ENGINE = await this.configuredExecutable(
        "IDE_REFACTORKIT_ENGINE",
        path.join(path.dirname(daemon), "refactorkit"),
      );
      environment.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE = "1";
      if (buildTool === "maven") {
        environment.MAVEN_ARGS = "--offline";
      }
    }
    await app.launch(environment);
    await app.waitForFileExplorer();
    const browser = app.browser();
    const tab = browser.$('[role="tab"][aria-label="Java Project"]');
    await tab.waitForDisplayed({ timeout: 10_000 });
    await tab.click();
    const newProject = browser.$(buildTool === "maven" ? "button=New Maven project" : "button=New Gradle project");
    await newProject.waitForDisplayed({ timeout: 5_000 });
    await newProject.click();
    await browser
      .$('[role="dialog"][aria-labelledby="java-project-wizard-title"]')
      .waitForDisplayed({
        timeout: 5_000,
      });
    this.#proof.wizardOpened = true;
  }

  async createStarterAndRefuseDuplicate(): Promise<void> {
    const browser = this.app().browser();
    const dialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await dialog.$("label=Project folder and artifact ID").$("input").setValue("native-starter");
    await dialog.$("label=Group ID").$("input").setValue("dev.example");
    await dialog.$("label=Java package").$("input").setValue("dev.example.app");
    await dialog.$("label=Java release").$("select").selectByAttribute("value", "8");
    await dialog.$("button=Create project").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const project = path.join(this.workspace(), "native-starter");
    const pom = await readFile(path.join(project, "pom.xml"), "utf8");
    const source = await readFile(
      path.join(project, "src/main/java/dev/example/app/App.java"),
      "utf8",
    );
    const test = await readFile(
      path.join(project, "src/test/java/dev/example/app/AppTest.java"),
      "utf8",
    );
    const mavenWrapper = await readFile(
      path.join(project, ".mvn/wrapper/maven-wrapper.properties"),
      "utf8",
    );
    assert.match(pom, /<groupId>dev\.example<\/groupId>/);
    assert.match(pom, /<maven\.compiler\.release>8<\/maven\.compiler\.release>/);
    assert.match(source, /package dev\.example\.app;/);
    assert.match(test, /org\.junit\.jupiter\.api\.Test/);
    await access(path.join(project, ".gitignore"));
    await access(path.join(project, "README.md"));
    await access(path.join(project, "mvnw.cmd"));
    assert.ok(((await stat(path.join(project, "mvnw"))).mode & 0o111) !== 0);
    assert.match(mavenWrapper, /apache-maven-3\.10\.0-bin\.zip/);
    assert.match(
      mavenWrapper,
      /distributionSha256Sum=1f6d9909266510f039f59aa0e13dcd2c66da85f043e56276e41f2918f8bddaff/,
    );
    this.#proof.mavenWrapperCreated = true;
    await access(path.join(project, "target")).then(
      () => assert.fail("project creation must not execute Maven"),
      (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
    );
    this.#proof.starterCreated = true;

    const panel = browser.$('section[aria-label="Java project context"]');
    await browser.waitUntil(
      async () => (await panel.$("#java-project-directory").getValue()) === "native-starter",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "the new workspace-relative project path was not selected",
      },
    );
    await browser.waitUntil(
      async () => (await panel.getText()).includes("Select a full JDK home"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "project synchronization must honestly require an explicitly selected JDK",
      },
    );
    this.#proof.synchronizationRequiresJdk = true;

    await browser.$('[role="tab"][aria-label="Files"]').click();
    const item = browser.$('[role="treeitem"][data-path="native-starter"]');
    await item.waitForDisplayed({ timeout: 5_000 });
    this.#proof.projectTreeRefreshed = true;

    const before = new Map(
      await Promise.all(
        [
          "pom.xml",
          "src/main/java/dev/example/app/App.java",
          "src/test/java/dev/example/app/AppTest.java",
        ].map(
          async (relative) =>
            [relative, await readFile(path.join(project, relative), "utf8")] as const,
        ),
      ),
    );
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await browser.$("button=New Maven project").click();
    const duplicate = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await duplicate.$("label=Project folder and artifact ID").$("input").setValue("native-starter");
    await duplicate.$("button=Create project").click();
    const alert = duplicate.$('[role="alert"]');
    await alert.waitForDisplayed({ timeout: 5_000 });
    assert.match(await alert.getText(), /already exists/);
    for (const [relative, content] of before)
      assert.equal(await readFile(path.join(project, relative), "utf8"), content);
    await duplicate.$("button=Cancel").click();
    this.#proof.existingProjectPreserved = true;

    await browser.$("button=New Maven project").click();
    await this.createJava27MavenStarter();

    await browser.$("button=New Gradle project").click();
    const gradleDialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await gradleDialog.waitForDisplayed({ timeout: 5_000 });
    await gradleDialog
      .$("label=Project folder and Gradle root project name")
      .$("input")
      .setValue("gradle-native-starter");
    await gradleDialog.$("label=Group ID").$("input").setValue("dev.example");
    await gradleDialog
      .$("label=Project layout")
      .$("select")
      .selectByAttribute("value", "multi-module");
    await gradleDialog.$("label=Java package").$("input").setValue("dev.example.app");
    await gradleDialog.$("label=Java release").$("select").selectByAttribute("value", "21");
    await gradleDialog.$("button=Create project").click();
    await gradleDialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const gradleProject = path.join(this.workspace(), "gradle-native-starter");
    const settingsScript = await readFile(path.join(gradleProject, "settings.gradle"), "utf8");
    const buildScript = await readFile(path.join(gradleProject, "build.gradle"), "utf8");
    const appBuildScript = await readFile(path.join(gradleProject, "app/build.gradle"), "utf8");
    const libraryBuildScript = await readFile(
      path.join(gradleProject, "library/build.gradle"),
      "utf8",
    );
    const gradleWrapper = await readFile(
      path.join(gradleProject, "gradle/wrapper/gradle-wrapper.properties"),
      "utf8",
    );
    const gradleSource = await readFile(
      path.join(gradleProject, "app/src/main/java/dev/example/app/App.java"),
      "utf8",
    );
    await access(path.join(gradleProject, "library/src/main/java/dev/example/app/Greeting.java"));
    await access(path.join(gradleProject, "app/src/test/java/dev/example/app/AppTest.java"));
    await access(
      path.join(gradleProject, "library/src/test/java/dev/example/app/GreetingTest.java"),
    );
    assert.match(settingsScript, /rootProject\.name = 'gradle-native-starter'/);
    assert.match(settingsScript, /include 'library', 'app'/);
    assert.match(buildScript, /options\.release = 21/);
    assert.match(appBuildScript, /implementation project\(':library'\)/);
    assert.match(
      appBuildScript,
      /testRuntimeOnly 'org\.junit\.platform:junit-platform-launcher:1\.10\.2'/,
    );
    assert.match(
      libraryBuildScript,
      /testRuntimeOnly 'org\.junit\.platform:junit-platform-launcher:1\.10\.2'/,
    );
    assert.match(libraryBuildScript, /id 'java-library'/);
    assert.match(gradleSource, /package dev\.example\.app;/);
    await access(path.join(gradleProject, ".gitignore"));
    await access(path.join(gradleProject, "README.md"));
    await access(path.join(gradleProject, "gradlew.bat"));
    assert.ok(((await stat(path.join(gradleProject, "gradlew"))).mode & 0o111) !== 0);
    assert.match(gradleWrapper, /gradle-8\.14\.6-bin\.zip/);
    assert.match(
      gradleWrapper,
      /distributionSha256Sum=7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24/,
    );
    await assertGradleWrapperDistributions(gradleProject);
    assert.equal(
      createHash("sha256")
        .update(await readFile(path.join(gradleProject, "gradle/wrapper/gradle-wrapper.jar")))
        .digest("hex"),
      "238e777fcddd7e34f9708186085def2abd6e08e658505b38718d79d74c21abd5",
    );
    for (const output of ["app/build", "library/build"])
      await access(path.join(gradleProject, output)).then(
        () => assert.fail("project creation must not execute Gradle"),
        (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
      );
    this.#proof.gradleMultiModuleCreated = true;
    this.#proof.gradleGroovyWrapperCreated = true;

    const gradlePanel = browser.$('section[aria-label="Java project context"]');
    await browser.waitUntil(
      async () =>
        (await gradlePanel.$("#java-project-directory").getValue()) === "gradle-native-starter",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "the new Gradle workspace-relative project path was not selected",
      },
    );
    await browser.waitUntil(
      async () => (await gradlePanel.getText()).includes("Select a full JDK home"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Gradle synchronization must require an explicitly selected JDK",
      },
    );
    this.#proof.gradleSynchronizationRequiresJdk = true;

    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser
      .$('[role="treeitem"][data-path="gradle-native-starter"]')
      .waitForDisplayed({ timeout: 5_000 });
    this.#proof.projectTreeRefreshed = true;

    const gradleBefore = new Map(
      await Promise.all(
        [
          "build.gradle",
          "settings.gradle",
          "app/build.gradle",
          "library/build.gradle",
          "app/src/main/java/dev/example/app/App.java",
          "app/src/test/java/dev/example/app/AppTest.java",
          "library/src/main/java/dev/example/app/Greeting.java",
          "library/src/test/java/dev/example/app/GreetingTest.java",
        ].map(
          async (relative) =>
            [relative, await readFile(path.join(gradleProject, relative), "utf8")] as const,
        ),
      ),
    );
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await browser.$("button=New Gradle project").click();
    const duplicateGradle = browser.$(
      '[role="dialog"][aria-labelledby="java-project-wizard-title"]',
    );
    await duplicateGradle
      .$("label=Project folder and Gradle root project name")
      .$("input")
      .setValue("gradle-native-starter");
    await duplicateGradle
      .$("label=Project layout")
      .$("select")
      .selectByAttribute("value", "multi-module");
    await duplicateGradle.$("button=Create project").click();
    const gradleAlert = duplicateGradle.$('[role="alert"]');
    await gradleAlert.waitForDisplayed({ timeout: 5_000 });
    assert.match(await gradleAlert.getText(), /already exists/);
    for (const [relative, content] of gradleBefore)
      assert.equal(await readFile(path.join(gradleProject, relative), "utf8"), content);
    await duplicateGradle.$("button=Cancel").click();
    this.#proof.gradleExistingProjectPreserved = true;

    await browser.$("button=New Gradle project").click();
    const kotlinDialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await kotlinDialog.waitForDisplayed({ timeout: 5_000 });
    await kotlinDialog
      .$("label=Project folder and Gradle root project name")
      .$("input")
      .setValue("gradle-kotlin-starter");
    await kotlinDialog.$("label=Group ID").$("input").setValue("dev.example");
    await kotlinDialog
      .$("label=Project layout")
      .$("select")
      .selectByAttribute("value", "single-module");
    await kotlinDialog.$("label=Gradle DSL").$("select").selectByAttribute("value", "kotlin");
    await kotlinDialog.$("label=Java package").$("input").setValue("dev.example.kotlinapp");
    await kotlinDialog.$("label=Java release").$("select").selectByAttribute("value", "21");
    await kotlinDialog.$("button=Create project").click();
    await kotlinDialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const kotlinProject = path.join(this.workspace(), "gradle-kotlin-starter");
    const kotlinSettings = await readFile(path.join(kotlinProject, "settings.gradle.kts"), "utf8");
    const kotlinBuild = await readFile(path.join(kotlinProject, "build.gradle.kts"), "utf8");
    const kotlinWrapper = await readFile(
      path.join(kotlinProject, "gradle/wrapper/gradle-wrapper.properties"),
      "utf8",
    );
    assert.match(kotlinSettings, /rootProject\.name = "gradle-kotlin-starter"/);
    assert.match(kotlinBuild, /options\.release = 21/);
    assert.match(
      kotlinBuild,
      /testRuntimeOnly\("org\.junit\.platform:junit-platform-launcher:1\.10\.2"\)/,
    );
    await access(path.join(kotlinProject, "src/main/java/dev/example/kotlinapp/App.java"));
    await access(path.join(kotlinProject, "src/test/java/dev/example/kotlinapp/AppTest.java"));
    await access(path.join(kotlinProject, ".gitignore"));
    await access(path.join(kotlinProject, "gradlew.bat"));
    assert.ok(((await stat(path.join(kotlinProject, "gradlew"))).mode & 0o111) !== 0);
    assert.match(kotlinWrapper, /gradle-8\.14\.6-bin\.zip/);
    assert.match(
      kotlinWrapper,
      /distributionSha256Sum=7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24/,
    );
    await assertGradleWrapperDistributions(kotlinProject);
    assert.match(
      await readFile(path.join(kotlinProject, "README.md"), "utf8"),
      /Gradle Kotlin DSL/,
    );
    for (const output of ["build", ".gradle"])
      await access(path.join(kotlinProject, output)).then(
        () => assert.fail("project creation must not execute Gradle"),
        (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
      );
    this.#proof.gradleKotlinDslCreated = true;
    this.#proof.gradleKotlinWrapperCreated = true;

    const kotlinPanel = browser.$('section[aria-label="Java project context"]');
    await browser.waitUntil(
      async () =>
        (await kotlinPanel.$("#java-project-directory").getValue()) === "gradle-kotlin-starter",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "the new Kotlin DSL Gradle project path was not selected",
      },
    );
    await browser.waitUntil(
      async () => (await kotlinPanel.getText()).includes("Select a full JDK home"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Kotlin DSL Gradle synchronization must require an explicitly selected JDK",
      },
    );
    this.#proof.kotlinGradleSynchronizationRequiresJdk = true;
    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser
      .$('[role=treeitem][data-path="gradle-kotlin-starter"]')
      .waitForDisplayed({ timeout: 5_000 });
    this.#proof.projectTreeRefreshed = true;
    await this.createSpringBootMvcStarter();
    await this.createSpringBootGradleStarter("groovy");
    await this.createSpringBootGradleStarter("kotlin");
    this.#proof.springBootGradleStartersCreated = true;
  }

  async createSpringBootMvcStarter(): Promise<void> {
    const browser = this.app().browser();
    const dialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    if (!(await dialog.isDisplayed())) {
      await browser.$('[role="tab"][aria-label="Java Project"]').click();
      await browser.$("button=New Maven project").click();
    }
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog
      .$("label=Project folder and artifact ID")
      .$("input")
      .setValue("spring-boot-native-starter");
    await dialog.$("label=Group ID").$("input").setValue("dev.example");
    await dialog.$("label=Java package").$("input").setValue("dev.example.bootapp");
    await dialog.$("label=Project type").$("select").selectByAttribute("value", "spring-boot-mvc");
    await dialog.$("label=Java release").$("select").selectByAttribute("value", "21");
    assert.equal(
      await dialog.$("label=Project layout").$("option[value=multi-module]").isEnabled(),
      false,
      "Spring Boot starter must restrict the current template to a single module",
    );
    await dialog.$("button=Create project").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const project = path.join(this.workspace(), "spring-boot-native-starter");
    const pom = await readFile(path.join(project, "pom.xml"), "utf8");
    const app = await readFile(
      path.join(project, "src/main/java/dev/example/bootapp/App.java"),
      "utf8",
    );
    const controller = await readFile(
      path.join(project, "src/main/java/dev/example/bootapp/GreetingController.java"),
      "utf8",
    );
    const test = await readFile(
      path.join(project, "src/test/java/dev/example/bootapp/GreetingControllerTest.java"),
      "utf8",
    );
    assert.match(pom, /spring-boot-starter-parent/);
    assert.match(pom, /<version>4\.1\.2<\/version>/);
    assert.match(pom, /<maven\.compiler\.release>21<\/maven\.compiler\.release>/);
    assert.match(pom, /spring-boot-starter-webmvc/);
    assert.match(app, /@SpringBootApplication/);
    assert.match(controller, /@GetMapping\("\/api\/hello"\)/);
    assert.match(test, /SpringBootTest\.WebEnvironment\.RANDOM_PORT/);
    assert.match(test, /assertEquals\("Hello from [^"]+!", response\.body\(\)\)/);
    assert.match(test, /HttpClient\.newHttpClient\(\)\.send/);
    await access(path.join(project, "mvnw"));
    await access(path.join(project, "README.md"));
    await access(path.join(project, ".gitignore"));
    await access(path.join(project, "target")).then(
      () => assert.fail("Spring Boot project creation must not run Maven"),
      (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
    );
    this.#proof.springBootStarterCreated = true;
    const panel = browser.$('section[aria-label="Java project context"]');
    await browser.waitUntil(
      async () =>
        (await panel.$("#java-project-directory").getValue()) === "spring-boot-native-starter",
      { timeout: 5_000, interval: 50 },
    );
    await browser.waitUntil(
      async () => (await panel.getText()).includes("Select a full JDK home"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Spring Boot project synchronization must require an explicitly selected JDK",
      },
    );
    this.#proof.springBootSynchronizationRequiresJdk = true;
    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser
      .$('[role="treeitem"][data-path="spring-boot-native-starter"]')
      .waitForDisplayed({ timeout: 5_000 });
    this.#proof.projectTreeRefreshed = true;
  }

  async testAndRunSpringBootStarter(dsl?: "groovy" | "kotlin"): Promise<void> {
    const projectName = dsl ? `spring-boot-gradle-${dsl}-starter` : "spring-boot-native-starter";
    const projectPath = path.join(this.workspace(), projectName);
    await access(projectPath);
    const tool = dsl ? "Gradle" : "Maven";
    const provider = dsl ? "gradle-effective-v1" : "maven-effective-v1";
    const app = this.app();
    const browser = app.browser();
    const jdk = await this.fullJdk(
      process.env.IDE_JAVA_CONTEXT_SPRING_BOOT_JDK ?? process.env.IDE_JAVA_HOME ?? "",
      `Spring Boot ${tool}`,
    );
    assert.ok(this.#lease);
    const gradleHome = path.join(this.#lease.paths.root, "spring-starter-gradle-home");
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    const project = browser.$('section[aria-label="Java project context"]');
    await pasteNativeText(app, project.$('input[placeholder="Full JDK directory"]'), jdk);
    const settings = project.$(`.//details[summary='${tool} settings']`);
    if ((await settings.getAttribute("open")) === null) await settings.$("summary").click();
    if (dsl) {
      const cachedHome = await this.configuredDirectory("IDE_JAVA_CONTEXT_GRADLE_USER_HOME");
      await cp(path.join(cachedHome, "caches"), path.join(gradleHome, "caches"), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        filter: (source) => !source.endsWith(".lock"),
      });
      const initDirectory = path.join(gradleHome, "init.d");
      await mkdir(initDirectory);
      const repository = await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
      await cp(
        await this.createGradleLocalMavenRepositoryInitScript(repository),
        path.join(initDirectory, "native-offline.gradle"),
      );
      await pasteNativeText(app, settings.$('input[placeholder="Absolute Gradle or wrapper executable"]'), path.join(projectPath, "gradlew"));
      await pasteNativeText(app, settings.$('input[placeholder="Gradle default user home"]'), gradleHome);
    } else {
      const cachedRepository = await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
      const repository = path.join(this.#lease.paths.root, "spring-starter-maven-repository");
      await cp(cachedRepository, repository, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        filter: (source) => source !== path.join(cachedRepository, ".locks"),
      });
      await pasteNativeText(app, settings.$('input[placeholder="Engine default local repository"]'), repository);
    }
    const synchronize = async (evaluate = false) => {
      await project.$(evaluate ? "button=Evaluate Gradle project" : "button=Synchronize project").click();
      await browser.waitUntil(async () => {
        const error = project.$('[role="alert"]');
        if (await error.isExisting()) throw new Error(await error.getText());
        return (await project.getText()).includes(`${provider} · available`);
      }, {
        timeout: evaluate ? 180_000 : 60_000,
        interval: 100,
        timeoutMsg: "The generated Spring Boot starter did not synchronize",
      });
    };
    await synchronize(Boolean(dsl));
    const outputDirectory = dsl ? "build/classes" : "target/classes";
    await assert.rejects(access(path.join(projectPath, outputDirectory)), { code: "ENOENT" });

    const execution = browser.$('section[aria-label="Java execution"]');
    const selectSourceSet = async (sourceSet: "main" | "test") => {
      await browser.$('[role="tab"][aria-label="Java Run"]').click();
      const sourceSets = execution.$("label=Synchronized module and source set").$("select");
      const options = await sourceSets.$$("option").getElements();
      const matches: number[] = [];
      for (let index = 0; index < options.length; index++) {
        const value = await options[index]!.getAttribute("value");
        if (value && JSON.parse(value)[2] === sourceSet) matches.push(index);
      }
      assert.equal(matches.length, 1, `Expected one synchronized ${tool} ${sourceSet} source set`);
      await sourceSets.selectByIndex(matches[0]!);
    };
    await selectSourceSet("test");
    const runTests = execution.$("button=Run tests");
    assert.equal(await runTests.isEnabled(), false, "The starter must require explicit trust to run tests");
    await execution.$("label*=I trust this workspace").$("input").click();
    await runTests.waitForEnabled({ timeout: 10_000 });
    await runTests.click();
    await browser.waitUntil(async () => {
      const statuses = await readNativeJavaExecutionStatuses(browser);
      if (statuses.some((status) => status.startsWith("test: failed")))
        throw new Error(await execution.getText());
      return statuses.some((status) => status.startsWith("test: succeeded"));
    }, { timeout: 180_000, interval: 100, timeoutMsg: "Java Run did not complete the generated Spring Boot test" });

    const report = path.join(
      projectPath,
      dsl ? "build/test-results/test" : "target/surefire-reports",
      "TEST-dev.example.bootapp.GreetingControllerTest.xml",
    );
    assert.equal(await this.assertTestReport(projectName, report), 1);
    const reportText = await readFile(report, "utf8");
    assert.match(reportText, /<testcase name="servesTheGreetingEndpoint(?:\(\))?"/);
    assert.match(reportText, /Tomcat started on port/);
    const wrapperHome = dsl
      ? path.join(gradleHome, "wrapper/dists/gradle-8.14.6-bin")
      : path.join(this.#lease.paths.home, ".m2/wrapper/dists/apache-maven-3.10.0");
    assert.ok((await readdir(wrapperHome)).length > 0, `Java Run did not use the generated ${tool} wrapper`);
    this.#proof.springBootStarterTestedFromJavaRun = true;

    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await synchronize();
    await selectSourceSet("main");
    await pasteNativeText(app, execution.$("label=Main class").$("input"), "dev.example.bootapp.App");
    for (const [index, value] of ["--server.port=0", "--server.address=127.0.0.1"].entries()) {
      await execution.$("button=Add argument").click();
      await pasteNativeText(app, execution.$(`label=Argument ${index + 1}`).$("textarea"), value);
    }
    const run = execution.$("button=Run");
    await run.waitForEnabled({ timeout: 10_000 });
    await run.click();
    const consoleOutput = execution.$('[aria-label="Java console output"]');
    let port = 0;
    await browser.waitUntil(async () => {
      const statuses = await readNativeJavaExecutionStatuses(browser);
      if (statuses.some((status) => status.startsWith("run: failed")))
        throw new Error(await execution.getText());
      if (!statuses.some((status) => status.startsWith("run: running"))) return false;
      port = Number(/Tomcat started on port (\d+)/u.exec(await consoleOutput.getText())?.[1]);
      return Number.isSafeInteger(port) && port > 0 && port <= 65_535;
    }, { timeout: 60_000, interval: 100, timeoutMsg: "Java Run did not start the generated Spring Boot application" });
    const endpoint = `http://127.0.0.1:${port}/api/hello`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
    this.#proof.springBootEndpointResponse = await response.text();
    assert.equal(this.#proof.springBootEndpointResponse, `Hello from ${projectName}!`);
    await execution.$("button=Stop").click();
    await browser.waitUntil(async () =>
      (await readNativeJavaExecutionStatuses(browser)).some((status) => status.startsWith("run: stopped")),
    { timeout: 20_000, interval: 100, timeoutMsg: "The generated Spring Boot application did not stop" });
    await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(5_000) }));
    this.#proof.springBootStarterRanFromJavaRun = true;
  }

  async createSpringBootGradleStarter(dsl: "groovy" | "kotlin"): Promise<void> {
    const browser = this.app().browser();
    const artifactId = `spring-boot-gradle-${dsl}-starter`;
    const buildFile = dsl === "groovy" ? "build.gradle" : "build.gradle.kts";
    const settingsFile = dsl === "groovy" ? "settings.gradle" : "settings.gradle.kts";
    const dialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    if (!(await dialog.isDisplayed())) {
      await browser.$('[role="tab"][aria-label="Java Project"]').click();
      await browser.$("button=New Gradle project").click();
    }
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog
      .$("label=Project folder and Gradle root project name")
      .$("input")
      .setValue(artifactId);
    await dialog.$("label=Group ID").$("input").setValue("dev.example");
    await dialog.$("label=Java package").$("input").setValue("dev.example.bootapp");
    await dialog.$("label=Project type").$("select").selectByAttribute("value", "spring-boot-mvc");
    await dialog.$("label=Gradle DSL").$("select").selectByAttribute("value", dsl);
    await dialog.$("label=Java release").$("select").selectByAttribute("value", "21");
    assert.equal(
      await dialog.$("label=Project layout").$("option[value=multi-module]").isEnabled(),
      false,
      "Spring Boot Gradle starter must restrict the current template to a single module",
    );
    await dialog.$("button=Create project").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const project = path.join(this.workspace(), artifactId);
    const generatedFiles = await readdir(project, { recursive: true });
    assert.ok(
      generatedFiles.includes("src/main/java/dev/example/bootapp/App.java"),
      `${project} is missing its application source; generated files: ${generatedFiles.join(", ")}`,
    );
    const build = await readFile(path.join(project, buildFile), "utf8");
    const settings = await readFile(path.join(project, settingsFile), "utf8");
    const rootName = dsl === "groovy" ? `'${artifactId}'` : `"${artifactId}"`;
    assert.equal(settings, `rootProject.name = ${rootName}\n`);
    const app = await readFile(
      path.join(project, "src/main/java/dev/example/bootapp/App.java"),
      "utf8",
    );
    const controller = await readFile(
      path.join(project, "src/main/java/dev/example/bootapp/GreetingController.java"),
      "utf8",
    );
    const test = await readFile(
      path.join(project, "src/test/java/dev/example/bootapp/GreetingControllerTest.java"),
      "utf8",
    );
    assert.match(build, /org\.springframework\.boot/);
    assert.match(build, /4\.1\.2/);
    assert.match(build, /spring-boot-starter-webmvc/);
    assert.match(build, /spring-boot-starter-test/);
    assert.match(build, /junit-platform-launcher/);
    assert.match(build, /options\.release = 21/);
    assert.match(app, /@SpringBootApplication/);
    assert.match(controller, /@GetMapping\("\/api\/hello"\)/);
    assert.match(test, /SpringBootTest\.WebEnvironment\.RANDOM_PORT/);
    await access(path.join(project, "gradlew"));
    await access(path.join(project, "README.md"));
    await access(path.join(project, ".gitignore"));
    await access(path.join(project, "build")).then(
      () => assert.fail("Spring Boot project creation must not run Gradle"),
      (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
    );
    const panel = browser.$('section[aria-label="Java project context"]');
    await browser.waitUntil(
      async () => (await panel.$("#java-project-directory").getValue()) === artifactId,
      { timeout: 5_000, interval: 50 },
    );
    await browser.waitUntil(
      async () => (await panel.getText()).includes("Select a full JDK home"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Spring Boot Gradle synchronization must require an explicitly selected JDK",
      },
    );
    this.#proof.springBootGradleSynchronizationRequiresJdk = true;
    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser.$(`[role="treeitem"][data-path="${artifactId}"]`).waitForDisplayed({
      timeout: 5_000,
    });
    this.#proof.projectTreeRefreshed = true;
  }

  async buildTestAndRunCompatibleStarters(): Promise<void> {
    const mavenJdk = await this.fullJdk(
      process.env.IDE_JAVA_CONTEXT_MAVEN_JDK ??
        process.env.IDE_JAVA_HOME ??
        process.env.JAVA_HOME ??
        "/usr/lib/jvm/java-21-openjdk",
      "Maven",
    );
    const gradleJdk = await this.fullJdk(
      process.env.IDE_JAVA_CONTEXT_GRADLE_JDK ??
        process.env.IDE_JAVA_HOME ??
        process.env.JAVA_HOME ??
        "/usr/lib/jvm/java-21-openjdk",
      "Gradle",
    );
    const mavenRepository = await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
    const gradleUserHome = await this.configuredDirectory("IDE_JAVA_CONTEXT_GRADLE_USER_HOME");
    const maven = await this.configuredExecutable("IDE_JAVA_CONTEXT_TEST_MAVEN", "/usr/bin/mvn");
    const gradle = await this.configuredExecutable(
      "IDE_JAVA_CONTEXT_TEST_GRADLE",
      "/usr/bin/gradle",
    );
    const gradleInitScript = await this.createGradleLocalMavenRepositoryInitScript();

    const mavenProject = path.join(this.workspace(), "native-starter");
    const mavenLog = await this.runBuildCommand(
      "maven-java8-starter-verify",
      maven,
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${mavenRepository}`, "verify"],
      mavenProject,
      mavenJdk,
    );
    assert.match(mavenLog, /BUILD SUCCESS/);
    const mavenTests = await this.assertTestReport(
      "maven-java8-starter",
      path.join(mavenProject, "target/surefire-reports/TEST-dev.example.app.AppTest.xml"),
    );
    const mavenRuntime = await this.runBuildCommand(
      "maven-java8-starter-run",
      path.join(mavenJdk, "bin/java"),
      ["-cp", path.join(mavenProject, "target/classes"), "dev.example.app.App"],
      mavenProject,
      mavenJdk,
    );
    this.#proof.scaffoldBuilds.push({
      project: "native-starter",
      buildTool: "maven",
      release: 8,
      testCases: mavenTests,
      applicationOutput: this.assertApplicationOutput(mavenRuntime, "native-starter"),
    });

    const groovyProject = path.join(this.workspace(), "gradle-native-starter");
    const groovyLog = await this.runBuildCommand(
      "gradle-groovy-java21-starter-build-test-run",
      gradle,
      [
        "--offline",
        "--no-daemon",
        "--console=plain",
        "-g",
        gradleUserHome,
        "--init-script",
        gradleInitScript,
        "clean",
        "build",
        ":app:run",
      ],
      groovyProject,
      gradleJdk,
    );
    assert.match(groovyLog, /BUILD SUCCESSFUL/);
    const groovyTests =
      (await this.assertTestReport(
        "gradle-groovy-app",
        path.join(groovyProject, "app/build/test-results/test/TEST-dev.example.app.AppTest.xml"),
      )) +
      (await this.assertTestReport(
        "gradle-groovy-library",
        path.join(
          groovyProject,
          "library/build/test-results/test/TEST-dev.example.app.GreetingTest.xml",
        ),
      ));
    this.#proof.scaffoldBuilds.push({
      project: "gradle-native-starter",
      buildTool: "gradle",
      release: 21,
      testCases: groovyTests,
      applicationOutput: this.assertApplicationOutput(groovyLog, "gradle-native-starter"),
    });

    const kotlinProject = path.join(this.workspace(), "gradle-kotlin-starter");
    const kotlinLog = await this.runBuildCommand(
      "gradle-kotlin-java21-starter-build-test-run",
      gradle,
      [
        "--offline",
        "--no-daemon",
        "--console=plain",
        "-g",
        gradleUserHome,
        "--init-script",
        gradleInitScript,
        "clean",
        "build",
        "run",
      ],
      kotlinProject,
      gradleJdk,
    );
    assert.match(kotlinLog, /BUILD SUCCESSFUL/);
    const kotlinTests = await this.assertTestReport(
      "gradle-kotlin-app",
      path.join(kotlinProject, "build/test-results/test/TEST-dev.example.kotlinapp.AppTest.xml"),
    );
    this.#proof.scaffoldBuilds.push({
      project: "gradle-kotlin-starter",
      buildTool: "gradle",
      release: 21,
      testCases: kotlinTests,
      applicationOutput: this.assertApplicationOutput(kotlinLog, "gradle-kotlin-starter"),
    });
    this.#proof.generatedProjectsBuiltTestedAndRun = true;
    await this.buildAndTestSpringBootMvcStarter();
  }

  private async buildAndTestSpringBootMvcStarter(): Promise<void> {
    assert.ok(this.#lease, "native Java scaffold artifacts are unavailable");
    const jdk = await this.fullJdk(
      process.env.IDE_JAVA_CONTEXT_SPRING_BOOT_JDK ??
        process.env.IDE_JAVA_CONTEXT_MAVEN_JDK ??
        process.env.IDE_JAVA_HOME ??
        process.env.JAVA_HOME ??
        "/usr/lib/jvm/java-21-openjdk",
      "Spring Boot Maven",
    );
    const mavenRepository = await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
    const project = path.join(this.workspace(), "spring-boot-native-starter");
    const mavenUserHome = path.join(this.#lease.runnerArtifactPath, "spring-boot-maven-user-home");
    await mkdir(mavenUserHome, { recursive: true });
    const output = await this.runBuildCommand(
      "spring-boot-maven-wrapper-test",
      path.join(project, "mvnw"),
      [
        "--batch-mode",
        "--no-transfer-progress",
        "-Dstyle.color=never",
        `-Dmaven.repo.local=${mavenRepository}`,
        "clean",
        "test",
      ],
      project,
      jdk,
      600_000,
      { MAVEN_USER_HOME: mavenUserHome },
    );
    assert.match(output, /BUILD SUCCESS/);
    const testReportPath = path.join(
      project,
      "target/surefire-reports/TEST-dev.example.bootapp.GreetingControllerTest.xml",
    );
    const testCases = await this.assertTestReport("spring-boot-native-starter", testReportPath);
    assert.equal(testCases, 1);
    const testReport = await readFile(testReportPath, "utf8");
    assert.match(testReport, /<testcase name="servesTheGreetingEndpoint"/);
    const endpointResponse = "Hello from spring-boot-native-starter!";
    assert.match(output, /Tomcat started on port/);
    this.#proof.springBootStarterBuiltTested = true;
    this.#proof.springBootEndpointResponse = endpointResponse;
    this.#proof.scaffoldBuilds.push({
      project: "spring-boot-native-starter",
      buildTool: "maven",
      release: 21,
      testCases,
      applicationOutput: endpointResponse,
    });
    await this.buildAndTestSpringBootGradleStarters();
  }

  private async buildAndTestSpringBootGradleStarters(): Promise<void> {
    const jdk = await this.fullJdk(
      process.env.IDE_JAVA_CONTEXT_GRADLE_JDK ??
        process.env.IDE_JAVA_HOME ??
        process.env.JAVA_HOME ??
        "/usr/lib/jvm/java-21-openjdk",
      "Spring Boot Gradle",
    );
    const gradle = await this.configuredExecutable(
      "IDE_JAVA_CONTEXT_TEST_GRADLE",
      "/usr/bin/gradle",
    );
    const gradleUserHome = await this.configuredDirectory("IDE_JAVA_CONTEXT_GRADLE_USER_HOME");
    const gradleInitScript = await this.createGradleLocalMavenRepositoryInitScript();
    for (const dsl of ["groovy", "kotlin"] as const) {
      const projectName = `spring-boot-gradle-${dsl}-starter`;
      const project = path.join(this.workspace(), projectName);
      const output = await this.runBuildCommand(
        `${projectName}-build-test`,
        gradle,
        [
          "--no-daemon",
          "--console=plain",
          "-g",
          gradleUserHome,
          "--init-script",
          gradleInitScript,
          "clean",
          "test",
        ],
        project,
        jdk,
        600_000,
      );
      assert.match(output, /BUILD SUCCESSFUL/);
      const reportPath = path.join(
        project,
        "build/test-results/test/TEST-dev.example.bootapp.GreetingControllerTest.xml",
      );
      const testCases = await this.assertTestReport(projectName, reportPath);
      assert.equal(testCases, 1);
      const report = await readFile(reportPath, "utf8");
      assert.match(report, /<testcase name="servesTheGreetingEndpoint(?:\(\))?"/);
      const endpointResponse = `Hello from ${projectName}!`;
      this.#proof.springBootGradleBuilds.push({
        project: projectName,
        dsl,
        testCases,
        endpointResponse,
      });
      this.#proof.scaffoldBuilds.push({
        project: projectName,
        buildTool: "gradle",
        release: 21,
        testCases,
        applicationOutput: endpointResponse,
      });
    }
  }

  async buildTestAndRunJava27MavenStarter(useWrapper = false): Promise<void> {
    const java27Jdk = await this.fullJdk(
      process.env.IDE_JAVA_27_HOME ?? "",
      "Java 27 Maven scaffold",
    );
    const { stdout, stderr } = await executeFile(path.join(java27Jdk, "bin/java"), ["-version"]);
    const versionMatch = /version "(?:1\.)?(\d+)/u.exec(`${stdout}${stderr}`);
    assert.ok(versionMatch, "Java 27 Maven scaffold JDK version could not be determined");
    const javaMajor = Number(versionMatch[1]);
    assert.equal(javaMajor, 27, "the Java 27 Maven starter must use JDK 27");

    const mavenRepository = await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
    const project = path.join(this.workspace(), "java27-starter");
    const maven = useWrapper
      ? path.join(project, "mvnw")
      : await this.configuredExecutable("IDE_JAVA_CONTEXT_TEST_MAVEN", "/usr/bin/mvn");
    const preservedInputs = new Map(
      await Promise.all(
        [
          "pom.xml",
          "src/main/java/dev/example/app/App.java",
          "src/test/java/dev/example/app/AppTest.java",
          "mvnw",
          ".mvn/wrapper/maven-wrapper.properties",
        ].map(
          async (relative) =>
            [relative, await readFile(path.join(project, relative), "utf8")] as const,
        ),
      ),
    );
    assert.match(
      preservedInputs.get("pom.xml")!,
      /<maven\.compiler\.release>27<\/maven\.compiler\.release>/,
    );

    const mavenUserHome = path.join(this.#lease!.paths.root, "java27-maven-wrapper-home");
    const environment = useWrapper ? { MAVEN_USER_HOME: mavenUserHome } : {};
    if (useWrapper) await this.bootstrapMavenStarterWrapper(project, java27Jdk, 27, mavenUserHome);
    const buildLog = await this.runBuildCommand(
      "maven-java27-starter-verify",
      maven,
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${mavenRepository}`, "verify"],
      project,
      java27Jdk,
      180_000,
      environment,
    );
    assert.match(buildLog, /BUILD SUCCESS/);
    const testCases = await this.assertTestReport(
      "maven-java27-starter",
      path.join(project, "target/surefire-reports/TEST-dev.example.app.AppTest.xml"),
    );
    const classFile = await readFile(
      path.join(project, "target/classes/dev/example/app/App.class"),
    );
    assert.equal(classFile.readUInt32BE(0), 0xcafebabe, "Maven did not emit a Java class file");
    const classFileMajor = classFile.readUInt16BE(6);
    assert.equal(classFileMajor, 71, "Java 27 scaffold must emit Java 27 class files");

    const runtime = await this.runBuildCommand(
      "maven-java27-starter-run",
      path.join(java27Jdk, "bin/java"),
      ["-cp", path.join(project, "target/classes"), "dev.example.app.App"],
      project,
      java27Jdk,
    );
    this.#proof.scaffoldBuilds.push({
      project: "java27-starter",
      buildTool: "maven",
      release: 27,
      testCases,
      applicationOutput: this.assertApplicationOutput(runtime, "java27-starter"),
    });
    for (const [relative, content] of preservedInputs)
      assert.equal(await readFile(path.join(project, relative), "utf8"), content);
    this.#proof.java27StarterJdkMajor = javaMajor;
    this.#proof.java27StarterClassFileMajor = classFileMajor;
    this.#proof.java27StarterBuiltTestedAndRun = true;
  }

  async createJava27StartersWithoutBuild(): Promise<void> {
    await this.createJava27MavenStarter();
    const browser = this.app().browser();
    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser.$('[role="treeitem"][data-path="java27-starter"]').waitForDisplayed({ timeout: 5_000 });
    await this.createJava27GradleStarters();
  }

  private async createJava27MavenStarter(): Promise<void> {
    const browser = this.app().browser();
    const java27Dialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await java27Dialog.waitForDisplayed({ timeout: 5_000 });
    await java27Dialog
      .$("label=Project folder and artifact ID")
      .$("input")
      .setValue("java27-starter");
    await java27Dialog.$("label=Group ID").$("input").setValue("dev.example");
    await java27Dialog.$("label=Java package").$("input").setValue("dev.example.app");
    await java27Dialog.$("label=Java release").$("select").selectByAttribute("value", "27");
    const releaseHelp = java27Dialog.$("#java-project-wizard-release-help");
    await releaseHelp.waitForDisplayed({ timeout: 5_000 });
    assert.match(await releaseHelp.getText(), /select a full JDK for Java 27 in Java Project/iu);
    assert.match(await releaseHelp.getText(), /Project analysis depends on the configured RefactorKit version/iu);
    await java27Dialog.$("button=Create project").click();
    await java27Dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });
    const java27Project = path.join(this.workspace(), "java27-starter");
    const java27Pom = await readFile(path.join(java27Project, "pom.xml"), "utf8");
    const java27Wrapper = await readFile(
      path.join(java27Project, ".mvn/wrapper/maven-wrapper.properties"),
      "utf8",
    );
    assert.match(java27Pom, /<maven\.compiler\.release>27<\/maven\.compiler\.release>/);
    assert.match(java27Wrapper, /apache-maven-3\.10\.0-bin\.zip/);
    assert.match(
      java27Wrapper,
      /distributionSha256Sum=1f6d9909266510f039f59aa0e13dcd2c66da85f043e56276e41f2918f8bddaff/,
    );
    await access(path.join(java27Project, "mvnw.cmd"));
    assert.ok(((await stat(path.join(java27Project, "mvnw"))).mode & 0o111) !== 0);
    await access(path.join(java27Project, "src/main/java/dev/example/app/App.java"));
    await access(path.join(java27Project, "src/test/java/dev/example/app/AppTest.java"));
    await access(path.join(java27Project, "target")).then(
      () => assert.fail("project creation must not execute Maven"),
      (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
    );
    this.#proof.java27StarterCreated = true;
    this.#proof.java27WrapperCreated = true;
  }

  async createJava27GradleStarters(): Promise<void> {
    const browser = this.app().browser();
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await browser.$("button=New Gradle project").click();
    await this.createJava27GradleStarter({
      artifactId: "gradle-java27-starter",
      packageName: "dev.example.java27groovy",
      dsl: "groovy",
    });
    await browser.$("button=New Gradle project").click();
    await this.createJava27GradleStarter({
      artifactId: "gradle-kotlin-java27-starter",
      packageName: "dev.example.java27kotlin",
      dsl: "kotlin",
    });
    this.#proof.java27GradleStartersCreated = true;
    await browser.$('[role="tab"][aria-label="Files"]').click();
  }

  async buildTestAndRunJava27GradleStarters(useWrappers = false): Promise<void> {
    const java27Jdk = await this.fullJdk(
      process.env.IDE_JAVA_27_HOME ?? "",
      "Java 27 Gradle scaffold",
    );
    const { stdout, stderr } = await executeFile(path.join(java27Jdk, "bin/java"), ["-version"]);
    const versionMatch = /version "(?:1\.)?(\d+)/u.exec(`${stdout}${stderr}`);
    assert.ok(versionMatch, "Java 27 Gradle scaffold JDK version could not be determined");
    const javaMajor = Number(versionMatch[1]);
    assert.equal(javaMajor, 27, "the Java 27 Gradle starters must use JDK 27");

    await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
    const gradleUserHome = useWrappers
      ? path.join(this.#lease!.paths.root, "java27-gradle-wrapper-home")
      : await this.configuredDirectory("IDE_JAVA_CONTEXT_GRADLE_USER_HOME");
    const installedGradle = useWrappers
      ? null
      : await this.configuredExecutable("IDE_JAVA_CONTEXT_TEST_GRADLE", "/usr/bin/gradle");
    const initScript = await this.createGradleLocalMavenRepositoryInitScript();
    for (const [projectName, dsl, buildFile, packageName] of [
      ["gradle-java27-starter", "groovy", "build.gradle", "java27groovy"],
      ["gradle-kotlin-java27-starter", "kotlin", "build.gradle.kts", "java27kotlin"],
    ] as const) {
      const project = path.join(this.workspace(), projectName);
      const sourcePath = `src/main/java/dev/example/${packageName}/App.java`;
      const testPath = `src/test/java/dev/example/${packageName}/AppTest.java`;
      const settingsPath = dsl === "groovy" ? "settings.gradle" : "settings.gradle.kts";
      const inputs = new Map(
        await Promise.all(
          [buildFile, settingsPath, sourcePath, testPath, "gradlew",
            "gradle/wrapper/gradle-wrapper-java25.properties"].map(
            async (relative) =>
              [relative, await readFile(path.join(project, relative), "utf8")] as const,
          ),
        ),
      );
      assert.match(inputs.get(buildFile)!, /options\.release\s*(?:=\s*|\(\s*)27/u);
      const gradle = installedGradle ?? path.join(project, "gradlew");
      if (useWrappers) {
        if (dsl === "groovy") {
          await mkdir(gradleUserHome);
          assert.deepEqual(await readdir(gradleUserHome), []);
        }
        await this.verifyPinnedGradleStarterWrapper(project, java27Jdk, gradleUserHome);
      }
      const buildLog = await this.runBuildCommand(
        `${projectName}-build-test-run`,
        gradle,
        [
          "--offline",
          "--no-daemon",
          "--console=plain",
          "-g",
          gradleUserHome,
          "--init-script",
          initScript,
          "clean",
          "build",
          "run",
        ],
        project,
        java27Jdk,
        300_000,
        { GRADLE_USER_HOME: gradleUserHome },
      );
      assert.match(buildLog, /BUILD SUCCESSFUL/);
      const report = path.join(
        project,
        `build/test-results/test/TEST-dev.example.${packageName}.AppTest.xml`,
      );
      const testCases = await this.assertTestReport(projectName, report);
      const classFilePath = path.join(
        project,
        `build/classes/java/main/dev/example/${packageName}/App.class`,
      );
      const classFile = await readFile(classFilePath);
      assert.equal(
        classFile.readUInt32BE(0),
        0xcafebabe,
        `${projectName} did not emit a Java class file`,
      );
      const classFileMajor = classFile.readUInt16BE(6);
      assert.equal(classFileMajor, 71, `${projectName} must emit Java 27 class files`);
      for (const [relative, content] of inputs)
        assert.equal(await readFile(path.join(project, relative), "utf8"), content);
      const applicationOutput = this.assertApplicationOutput(buildLog, projectName);
      this.#proof.java27GradleBuilds.push({
        project: projectName,
        dsl,
        testCases,
        classFileMajor,
        jdkMajor: javaMajor,
        applicationOutput,
      });
      this.#proof.scaffoldBuilds.push({
        project: projectName,
        buildTool: "gradle",
        release: 27,
        testCases,
        applicationOutput,
      });
    }
  }

  async buildTestAndRunJava27StarterWrappers(): Promise<void> {
    await this.buildTestAndRunJava27MavenStarter(true);
    await this.buildTestAndRunJava27GradleStarters(true);
    this.#proof.java27PinnedWrappersBootstrapped = true;
  }

  async createJava26StartersWithoutBuild(): Promise<void> {
    const browser = this.app().browser();
    const dialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await dialog.$("label=Project folder and artifact ID").$("input").setValue("java26-starter");
    await dialog.$("label=Group ID").$("input").setValue("dev.example");
    await dialog.$("label=Java package").$("input").setValue("dev.example.app");
    await dialog.$("label=Java release").$("select").selectByAttribute("value", "26");
    await dialog.$("button=Create project").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const project = path.join(this.workspace(), "java26-starter");
    const pom = await readFile(path.join(project, "pom.xml"), "utf8");
    const wrapper = await readFile(
      path.join(project, ".mvn/wrapper/maven-wrapper.properties"),
      "utf8",
    );
    assert.match(pom, /<maven\.compiler\.release>26<\/maven\.compiler\.release>/);
    assert.match(wrapper, /apache-maven-3\.10\.0-bin\.zip/);
    assert.match(
      wrapper,
      /distributionSha256Sum=1f6d9909266510f039f59aa0e13dcd2c66da85f043e56276e41f2918f8bddaff/,
    );
    await access(path.join(project, "mvnw.cmd"));
    assert.ok(((await stat(path.join(project, "mvnw"))).mode & 0o111) !== 0);
    await access(path.join(project, "src/main/java/dev/example/app/App.java"));
    await access(path.join(project, "src/test/java/dev/example/app/AppTest.java"));
    await access(path.join(project, "target")).then(
      () => assert.fail("Java 26 starter creation must not run Maven"),
      (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
    );
    this.#proof.java26StarterCreated = true;
    this.#proof.java26StarterWrapperCreated = true;
    this.#proof.java26StarterUnbuilt = true;

    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await browser.$("button=New Gradle project").click();
    const gradleDialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await gradleDialog.waitForDisplayed({ timeout: 5_000 });
    await gradleDialog
      .$("label=Project folder and Gradle root project name")
      .$("input")
      .setValue("java26-gradle-starter");
    await gradleDialog
      .$("label=Project layout")
      .$("select")
      .selectByAttribute("value", "single-module");
    await gradleDialog.$("label=Gradle DSL").$("select").selectByAttribute("value", "groovy");
    await gradleDialog.$("label=Group ID").$("input").setValue("dev.example");
    await gradleDialog.$("label=Java package").$("input").setValue("dev.example.app");
    await gradleDialog.$("label=Java release").$("select").selectByAttribute("value", "26");
    await gradleDialog.$("button=Create project").click();
    await gradleDialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const gradleProject = path.join(this.workspace(), "java26-gradle-starter");
    const buildScript = await readFile(path.join(gradleProject, "build.gradle"), "utf8");
    const wrapperProperties = await readFile(
      path.join(gradleProject, "gradle/wrapper/gradle-wrapper.properties"),
      "utf8",
    );
    assert.match(buildScript, /options\.release = 26/);
    assert.match(wrapperProperties, /gradle-9\.8\.0-bin\.zip/);
    assert.match(
      wrapperProperties,
      /distributionSha256Sum=bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c/,
    );
    await access(path.join(gradleProject, "gradlew.bat"));
    assert.ok(((await stat(path.join(gradleProject, "gradlew"))).mode & 0o111) !== 0);
    await access(path.join(gradleProject, "src/main/java/dev/example/app/App.java"));
    await access(path.join(gradleProject, "src/test/java/dev/example/app/AppTest.java"));
    await assertGradleWrapperDistributions(gradleProject);
    for (const output of ["build", ".gradle"])
      await access(path.join(gradleProject, output)).then(
        () => assert.fail("Java 26 starter creation must not run Gradle"),
        (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
      );
    this.#proof.java26GradleStarterCreated = true;
    this.#proof.java26GradleWrapperCreated = true;

    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser
      .$('[role="treeitem"][data-path="java26-starter"]')
      .waitForDisplayed({ timeout: 5_000 });
    await browser
      .$('[role="treeitem"][data-path="java26-gradle-starter"]')
      .waitForDisplayed({ timeout: 5_000 });
    this.#proof.java26ProjectTreeRefreshed = true;
  }

  async buildTestAndRunJava26Starters(useWrappers = false): Promise<void> {
    const java26Jdk = await this.fullJdk(process.env.IDE_JAVA_26_HOME ?? "", "Java 26 scaffold");
    const { stdout, stderr } = await executeFile(path.join(java26Jdk, "bin/java"), ["-version"]);
    const versionMatch = /version "(?:1\.)?(\d+)/u.exec(`${stdout}${stderr}`);
    assert.ok(versionMatch, "Java 26 scaffold JDK version could not be determined");
    const javaMajor = Number(versionMatch[1]);
    assert.equal(javaMajor, 26, "the Java 26 starters must use JDK 26");

    const mavenRepository = await this.configuredDirectory("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY");
    const mavenProject = path.join(this.workspace(), "java26-starter");
    const maven = useWrappers
      ? path.join(mavenProject, "mvnw")
      : await this.configuredExecutable("IDE_JAVA_CONTEXT_TEST_MAVEN", "/usr/bin/mvn");
    const mavenUserHome = path.join(this.#lease!.paths.root, "java26-maven-wrapper-home");
    const mavenEnvironment = useWrappers ? { MAVEN_USER_HOME: mavenUserHome } : {};
    const mavenInputs = new Map(
      await Promise.all(
        [
          "pom.xml",
          "src/main/java/dev/example/app/App.java",
          "src/test/java/dev/example/app/AppTest.java",
          "mvnw",
          ".mvn/wrapper/maven-wrapper.properties",
        ].map(
          async (relative) =>
            [relative, await readFile(path.join(mavenProject, relative), "utf8")] as const,
        ),
      ),
    );
    assert.match(
      mavenInputs.get("pom.xml")!,
      /<maven\.compiler\.release>26<\/maven\.compiler\.release>/,
    );
    if (useWrappers)
      await this.bootstrapMavenStarterWrapper(mavenProject, java26Jdk, 26, mavenUserHome);
    const mavenBuildLog = await this.runBuildCommand(
      "maven-java26-starter-verify",
      maven,
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${mavenRepository}`, "verify"],
      mavenProject,
      java26Jdk,
      300_000,
      mavenEnvironment,
    );
    assert.match(mavenBuildLog, /BUILD SUCCESS/);
    const mavenTestCases = await this.assertTestReport(
      "maven-java26-starter",
      path.join(mavenProject, "target/surefire-reports/TEST-dev.example.app.AppTest.xml"),
    );
    const mavenClassFile = await readFile(
      path.join(mavenProject, "target/classes/dev/example/app/App.class"),
    );
    assert.equal(
      mavenClassFile.readUInt32BE(0),
      0xcafebabe,
      "Maven did not emit a Java class file",
    );
    const mavenClassFileMajor = mavenClassFile.readUInt16BE(6);
    assert.equal(mavenClassFileMajor, 70, "Maven must emit Java 26 class files");
    const mavenRuntime = await this.runBuildCommand(
      "maven-java26-starter-run",
      path.join(java26Jdk, "bin/java"),
      ["-cp", path.join(mavenProject, "target/classes"), "dev.example.app.App"],
      mavenProject,
      java26Jdk,
    );
    const mavenOutput = this.assertApplicationOutput(mavenRuntime, "java26-starter");
    for (const [relative, content] of mavenInputs)
      assert.equal(await readFile(path.join(mavenProject, relative), "utf8"), content);
    this.#proof.java26Builds.push({
      project: "java26-starter",
      buildTool: "maven",
      testCases: mavenTestCases,
      classFileMajor: mavenClassFileMajor,
      jdkMajor: javaMajor,
      applicationOutput: mavenOutput,
    });

    const gradleProject = path.join(this.workspace(), "java26-gradle-starter");
    const gradleUserHome = useWrappers
      ? path.join(this.#lease!.paths.root, "java26-gradle-wrapper-home")
      : await this.configuredDirectory("IDE_JAVA_CONTEXT_GRADLE_USER_HOME");
    const gradle = useWrappers
      ? path.join(gradleProject, "gradlew")
      : await this.configuredExecutable("IDE_JAVA_CONTEXT_TEST_GRADLE", "/usr/bin/gradle");
    const gradleEnvironment = { GRADLE_USER_HOME: gradleUserHome };
    const initScript = await this.createGradleLocalMavenRepositoryInitScript();
    const gradleInputs = new Map(
      await Promise.all(
        [
          "build.gradle",
          "settings.gradle",
          "src/main/java/dev/example/app/App.java",
          "src/test/java/dev/example/app/AppTest.java",
          "gradlew",
          "gradle/wrapper/gradle-wrapper-java25.properties",
        ].map(
          async (relative) =>
            [relative, await readFile(path.join(gradleProject, relative), "utf8")] as const,
        ),
      ),
    );
    assert.match(gradleInputs.get("build.gradle")!, /options\.release\s*(?:=\s*|\(\s*)26/u);
    if (useWrappers) {
      await mkdir(gradleUserHome);
      assert.deepEqual(await readdir(gradleUserHome), []);
    }
    const gradleVersion = useWrappers
      ? await this.verifyPinnedGradleStarterWrapper(gradleProject, java26Jdk, gradleUserHome)
      : await this.runBuildCommand(
          "gradle-java26-starter-version", gradle, ["--version"], gradleProject, java26Jdk, 30_000,
          gradleEnvironment,
        );
    const gradleVersionMatch = /^Gradle\s+(\d+)\.(\d+)(?:\.\d+)?/mu.exec(
      gradleVersion,
    );
    assert.ok(gradleVersionMatch, "Gradle version could not be determined for Java 26");
    const gradleMajor = Number(gradleVersionMatch[1]);
    const gradleMinor = Number(gradleVersionMatch[2]);
    assert.ok(
      gradleMajor > 9 || (gradleMajor === 9 && gradleMinor >= 4),
      "Gradle 9.4 or newer is required to run on JDK 26",
    );
    const gradleBuildLog = await this.runBuildCommand(
      "gradle-java26-starter-build-test-run",
      gradle,
      [
        "--offline",
        "--no-daemon",
        "--console=plain",
        "-g",
        gradleUserHome,
        "--init-script",
        initScript,
        "clean",
        "build",
        "run",
      ],
      gradleProject,
      java26Jdk,
      300_000,
      gradleEnvironment,
    );
    assert.match(gradleBuildLog, /BUILD SUCCESSFUL/);
    const gradleTestCases = await this.assertTestReport(
      "gradle-java26-starter",
      path.join(gradleProject, "build/test-results/test/TEST-dev.example.app.AppTest.xml"),
    );
    const gradleClassFile = await readFile(
      path.join(gradleProject, "build/classes/java/main/dev/example/app/App.class"),
    );
    assert.equal(
      gradleClassFile.readUInt32BE(0),
      0xcafebabe,
      "Gradle did not emit a Java class file",
    );
    const gradleClassFileMajor = gradleClassFile.readUInt16BE(6);
    assert.equal(gradleClassFileMajor, 70, "Gradle must emit Java 26 class files");
    const gradleOutput = this.assertApplicationOutput(gradleBuildLog, "java26-gradle-starter");
    for (const [relative, content] of gradleInputs)
      assert.equal(await readFile(path.join(gradleProject, relative), "utf8"), content);
    this.#proof.java26Builds.push({
      project: "java26-gradle-starter",
      buildTool: "gradle",
      testCases: gradleTestCases,
      classFileMajor: gradleClassFileMajor,
      jdkMajor: javaMajor,
      applicationOutput: gradleOutput,
    });
    this.#proof.java26StartersBuiltTestedAndRun = true;
    this.#proof.java26PinnedWrappersBootstrapped = useWrappers;
  }

  async close(): Promise<void> {
    await this.app().closeNativeWindow();
    this.#proof.cleanExit = true;
  }

  async assertFinal(): Promise<void> {
    await this.app().assertExited();
    await this.#lease!.assertConfiguredPathsConfined();
  }

  evidence() {
    return {
      ...this.#proof,
      ...nativeArtifactEvidence(),
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }

  diagnostics(): string {
    return this.#app?.redactedDiagnostics() ?? "";
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
          path.join(this.#lease.runnerArtifactPath, "java-project-scaffold-native-evidence.json"),
          JSON.stringify(this.evidence(), null, 2),
        );
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "native Java scaffold cleanup failed");
  }

  private app(): NativeDesktopApplication {
    assert.ok(this.#app, "native Java scaffold application is unavailable");
    return this.#app;
  }

  private workspace(): string {
    assert.ok(this.#lease, "native Java scaffold workspace is unavailable");
    return this.#lease.paths.workspace;
  }

  private async createJava27GradleStarter({
    artifactId,
    packageName,
    dsl,
  }: {
    artifactId: string;
    packageName: string;
    dsl: "groovy" | "kotlin";
  }): Promise<void> {
    const browser = this.app().browser();
    const dialog = browser.$('[role="dialog"][aria-labelledby="java-project-wizard-title"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog
      .$("label=Project folder and Gradle root project name")
      .$("input")
      .setValue(artifactId);
    await dialog.$("label=Group ID").$("input").setValue("dev.example");
    await dialog.$("label=Project layout").$("select").selectByAttribute("value", "single-module");
    await dialog.$("label=Gradle DSL").$("select").selectByAttribute("value", dsl);
    await dialog.$("label=Java package").$("input").setValue(packageName);
    await dialog.$("label=Java release").$("select").selectByAttribute("value", "27");
    await dialog.$("button=Create project").click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const project = path.join(this.workspace(), artifactId);
    const buildFile = dsl === "groovy" ? "build.gradle" : "build.gradle.kts";
    const settingsFile = dsl === "groovy" ? "settings.gradle" : "settings.gradle.kts";
    const packagePath = packageName.replaceAll(".", "/");
    const buildScript = await readFile(path.join(project, buildFile), "utf8");
    const settings = await readFile(path.join(project, settingsFile), "utf8");
    const wrapper = await readFile(
      path.join(project, "gradle/wrapper/gradle-wrapper.properties"),
      "utf8",
    );
    assert.match(buildScript, /options\.release\s*=\s*27/u);
    assert.match(settings, new RegExp(`rootProject\\.name = [\"']${artifactId}[\"']`));
    assert.match(buildScript, /org\.junit\.platform:junit-platform-launcher:1\.10\.2/u);
    assert.match(wrapper, /gradle-9\.8\.0-bin\.zip/u);
    assert.match(
      wrapper,
      /distributionSha256Sum=bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c/u,
    );
    await assertGradleWrapperDistributions(project);
    await access(path.join(project, "gradlew.bat"));
    assert.ok(((await stat(path.join(project, "gradlew"))).mode & 0o111) !== 0);
    await access(path.join(project, `src/main/java/${packagePath}/App.java`));
    await access(path.join(project, `src/test/java/${packagePath}/AppTest.java`));
    await access(path.join(project, "README.md"));
    for (const output of ["build", ".gradle"])
      await access(path.join(project, output)).then(
        () => assert.fail("Java 27 Gradle project creation must not execute Gradle"),
        (error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
      );

    const panel = browser.$('section[aria-label="Java project context"]');
    await browser.waitUntil(
      async () => (await panel.$("#java-project-directory").getValue()) === artifactId,
      { timeout: 5_000, interval: 50, timeoutMsg: "Java 27 Gradle project was not selected" },
    );
    await browser.waitUntil(
      async () => (await panel.getText()).includes("Select a full JDK home"),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `${dsl} Gradle synchronization must require an explicit JDK`,
      },
    );
    if (dsl === "groovy") this.#proof.java27GradleSynchronizationRequiresJdk = true;
    else this.#proof.java27KotlinGradleSynchronizationRequiresJdk = true;
    await browser.$('[role="tab"][aria-label="Files"]').click();
    await browser
      .$(`[role="treeitem"][data-path="${artifactId}"]`)
      .waitForDisplayed({ timeout: 5_000 });
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
  }

  private async fullJdk(configured: string, label: string): Promise<string> {
    assert.ok(path.isAbsolute(configured), `${label} JDK home must be an absolute path`);
    const home = await realpath(configured);
    for (const binary of ["java", "javac"]) await access(path.join(home, "bin", binary));
    return home;
  }

  private async configuredDirectory(environmentName: string): Promise<string> {
    const configured = process.env[environmentName];
    assert.ok(
      configured && path.isAbsolute(configured),
      `Set ${environmentName} to an absolute directory for offline qualification.`,
    );
    const directory = await realpath(configured);
    assert.ok((await stat(directory)).isDirectory(), `${environmentName} must name a directory`);
    return directory;
  }

  private async configuredExecutable(environmentName: string, fallback: string): Promise<string> {
    const configured = process.env[environmentName] ?? fallback;
    assert.ok(path.isAbsolute(configured), `${environmentName} must be an absolute path`);
    const executable = await realpath(configured);
    await access(executable);
    return executable;
  }

  private async bootstrapMavenStarterWrapper(
    project: string, jdk: string, release: 26 | 27, userHome: string,
  ): Promise<void> {
    await mkdir(userHome);
    assert.deepEqual(await readdir(userHome), []);
    const version = await this.runBuildCommand(
      `maven-java${release}-wrapper-version`,
      path.join(project, "mvnw"),
      ["--version"],
      project,
      jdk,
      300_000,
      { MAVEN_USER_HOME: userHome },
    );
    assert.match(version, /Apache Maven 3\.10\.0\b/u);
    assert.match(version, new RegExp(`Java version: ${release}\\b`, "u"));
    const cache = path.join(userHome, "wrapper/dists/apache-maven-3.10.0");
    const entries = await readdir(cache);
    assert.equal(entries.length, 1);
    await access(path.join(cache, entries[0]!, "bin/mvn"));
  }

  private async verifyPinnedGradleStarterWrapper(
    project: string, jdk: string, userHome: string,
  ): Promise<string> {
    const version = await this.runBuildCommand(
      `${path.basename(project)}-wrapper-version`,
      path.join(project, "gradlew"),
      ["--version"],
      project,
      jdk,
      300_000,
      { GRADLE_USER_HOME: userHome },
    );
    assert.match(version, /^Gradle\s+9\.8\.0\s*$/mu);
    const cache = path.join(userHome, "wrapper/dists/gradle-9.8.0-bin");
    const entries = await readdir(cache);
    assert.equal(entries.length, 1);
    await access(path.join(cache, entries[0]!, "gradle-9.8.0/bin/gradle"));
    return version;
  }

  private async createGradleLocalMavenRepositoryInitScript(repository?: string): Promise<string> {
    assert.ok(this.#lease, "native Java scaffold artifacts are unavailable");
    const script = path.join(
      this.#lease.runnerArtifactPath,
      "scaffold-offline-maven-repository.gradle",
    );
    const repositoryUrl = repository === undefined
      ? "System.getenv('IDE_JAVA_CONTEXT_MAVEN_REPOSITORY')"
      : `'${pathToFileURL(repository).href.replaceAll("'", "%27")}'`;
    await writeFile(
      script,
      [
        "gradle.beforeProject { project ->",
        "    project.repositories.maven {",
        "        name = 'nativeOfflineMavenRepository'",
        `        url = project.uri(${repositoryUrl})`,
        "    }",
        "}",
        "",
      ].join("\n"),
    );
    return script;
  }

  private async runBuildCommand(
    name: string,
    executable: string,
    arguments_: string[],
    cwd: string,
    jdk: string,
    timeoutMs = 180_000,
    extraEnvironment: NodeJS.ProcessEnv = {},
  ): Promise<string> {
    let output = "";
    try {
      const result = await executeFile(executable, arguments_, {
        cwd,
        env: { ...process.env, ...extraEnvironment, JAVA_HOME: jdk },
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      });
      output = result.stdout + result.stderr;
    } catch (error) {
      const observation = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      output = `${observation.stdout ?? ""}${observation.stderr ?? ""}`;
      await this.writeBuildLog(name, output);
      throw new Error(
        `${name} failed${observation.code ? ` (${observation.code})` : ""}: ${output.slice(-4_000)}`,
        { cause: error },
      );
    }
    await this.writeBuildLog(name, output);
    return output;
  }

  private async writeBuildLog(name: string, output: string): Promise<void> {
    assert.ok(this.#lease, "native Java scaffold artifacts are unavailable");
    await writeFile(path.join(this.#lease.runnerArtifactPath, `${name}.log`), output);
  }

  private async assertTestReport(name: string, reportPath: string): Promise<number> {
    const report = await readFile(reportPath, "utf8");
    assert.match(report, /<testsuite\b/, `${name} did not produce a JUnit test report`);
    const counts = new Map<string, number>();
    for (const attribute of ["tests", "failures", "errors", "skipped"]) {
      const match = report.match(new RegExp(`\\b${attribute}=["'](\\d+)["']`));
      assert.ok(match, `${name} report is missing its ${attribute} count`);
      counts.set(attribute, Number(match[1]));
    }
    assert.ok((counts.get("tests") ?? 0) > 0, `${name} executed no tests`);
    for (const attribute of ["failures", "errors", "skipped"])
      assert.equal(
        counts.get(attribute),
        0,
        `${name} reported ${counts.get(attribute)} ${attribute}`,
      );
    return counts.get("tests")!;
  }

  private assertApplicationOutput(output: string, projectName: string): string {
    const expected = `Hello from ${projectName}!`;
    assert.ok(
      output.includes(expected),
      `the ${projectName} application did not print its greeting`,
    );
    return expected;
  }
}
