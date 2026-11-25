import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJavaProjectContextSession } from "../support/native-java-project-context.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeJavaProjectContextSession>();
function legacyReferenceRelease(): 8 | 11 | undefined {
  const configured = process.env.IDE_JAVA_REFERENCE_RELEASE;
  if (configured === undefined || configured === "17") return undefined;
  if (configured === "8") return 8;
  if (configured === "11") return 11;
  throw new Error("The project execution profiles accept IDE_JAVA_REFERENCE_RELEASE=8, 11 or 17.");
}
Given<StoryWorld>(
  "the Maven module rename GUI has a real Maven reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true
    )
      throw new Error("Maven module rename acceptance requires real native GUI evidence");
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "maven",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        mavenModuleRenamePreview: true,
      },
    );
  },
);
Given<StoryWorld>(
  "the Java test-template GUI has a real Maven reference project with JUnit 4, Jupiter, TestNG, Mockito, Spring Boot Test and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java test-template acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "maven", undefined, false, false, false, false, false, false, false, {
      testTemplateFrameworks: true,
      mockitoSpringTestTemplates: true,
    });
  },
);
Given<StoryWorld>(
  "the daemon has stopped midway through a saved Maven module rename",
  { timeout: 240_000 },
  async function () {
    await session(this).interruptSavedMavenModuleRename();
  },
);
When<StoryWorld>(
  "the person opens the Java Project panel for the interrupted Maven rename",
  { timeout: 90_000 },
  async function () {
    await session(this).launchForProjectContext();
  },
);
When<StoryWorld>(
  "the person reviews saved-file recovery and confirms it after resolving an open draft",
  { timeout: 240_000 },
  async function () {
    const value = session(this);
    try {
      await value.recoverInterruptedSavedMavenModuleRename();
    } catch (error) {
      await value.captureFailure(error);
      throw error;
    }
  },
);
Then<StoryWorld>(
  "the IDE restores the saved Maven project and synchronizes it again",
  { timeout: 20_000 },
  async function () {
    await session(this).assertSavedMavenRecovery();
  },
);
Given<StoryWorld>(
  "the Java test-template GUI has a real Gradle reference project with JUnit 4, Jupiter, TestNG, Mockito, Spring Boot Test and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java test-template acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true,
      "gradle",
      "discover",
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      {
        testTemplateFrameworks: true,
        mockitoSpringTestTemplates: true,
      },
    );
  },
);
Given<StoryWorld>(
  "the project debugger GUI has a real Maven reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Project debugger acceptance requires matching native desktop artifact evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true, "maven", undefined, false, true, false, false, false, false, false,
      { javaRelease: legacyReferenceRelease() },
    );
  },
);
Given<StoryWorld>(
  "the project debugger GUI has a real Gradle reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Project debugger acceptance requires matching native desktop artifact evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true, "gradle", undefined, false, true, false, false, false, false, false,
      { javaRelease: legacyReferenceRelease() },
    );
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Maven reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Project execution acceptance requires matching native desktop artifact evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true, "maven", undefined, false, false, false, false, false, false, false,
      { javaRelease: legacyReferenceRelease() },
    );
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Maven reference project with custom output directories and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Custom Maven output acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "maven", "tests", false, false, true);
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Gradle reference project with custom output directories and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Custom Gradle output acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "gradle", "tests", false, false, false, true);
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Gradle custom test source set and a duplicate Test task with an incomplete runtime classpath, using a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Custom Gradle source-set acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "gradle", undefined, false, true, false, false, false, false, false, {
      customGradleTestSourceSet: true,
    });
  },
);
Given<StoryWorld>(
  "the project debugger GUI has a real Gradle custom test source set and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Custom Gradle debugger acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "gradle", undefined, false, true, false, false, false, false, false, {
      customGradleTestSourceSet: true,
    });
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real multi-module Gradle Kotlin DSL project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Gradle Kotlin DSL acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true,
      "gradle",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        gradleKotlinDslProject: true,
      },
    );
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Maven reference project with a workspace wrapper and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Maven wrapper acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "maven", undefined, false, false, false, false, true);
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Gradle reference project with a workspace wrapper and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Gradle wrapper acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "gradle", undefined, false, false, false, false, true);
  },
);
Given<StoryWorld>(
  "the project working-directory GUI has a real {word} reference project and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string) {
    if (tool !== "Maven" && tool !== "Gradle") throw new Error("Choose Maven or Gradle.");
    if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true ||
        this.targetEvidence.e2e !== true || !matchesNativeArtifactEvidence(this.targetEvidence))
      throw new Error("Working-directory qualification requires matching native desktop artifact evidence.");
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool === "Maven" ? "maven" : "gradle", undefined, false, false, false, false, false, false, false, { applicationWorkingDirectory: true });
  },
);
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java project context scenario not prepared");
  return value;
}
Given<StoryWorld>(
  "the project test GUI has a real {word} reference project for {word} and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string, workflow: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Project test acceptance requires matching native desktop artifact evidence",
      );
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    if (
      workflow !== "discover" &&
      workflow !== "discovery" &&
      workflow !== "coverage" &&
      workflow !== "rerun"
    )
      throw new Error(`Unsupported test workflow: ${workflow}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, workflow === "discovery" ? "discover" : workflow);
  },
);
Given<StoryWorld>(
  "the project test GUI has a real {word} project at the workspace root for coverage",
  { timeout: 40_000 },
  async function (tool: string) {
    if (!matchesNativeArtifactEvidence(this.targetEvidence))
      throw new Error("Workspace-root coverage requires a native desktop artifact");
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "coverage", false, false, false, false, false, false, false, {
      workspaceRootCoverage: true,
    });
  },
);
When<StoryWorld>(
  "the person synchronizes the workspace-root project and runs tests with coverage",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try { await value.runWorkspaceRootCoverage(); }
    catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "Open measured source reveals the root project's covered Java code and a disk reload retires its coverage links",
  { timeout: 45_000 },
  async function () {
    const value = session(this);
    try { await value.assertWorkspaceRootCoverageSource(); }
    catch (error) { await value.captureFailure(error); throw error; }
  },
);
Given<StoryWorld>(
  "the native GUI has a real {word} project for selected test debugging",
  { timeout: 40_000 },
  async function (tool: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    ) throw new Error("Selected test debugging requires the native GUI artifact declared by the runner");
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "tests", false, false, false, false, false, false, false, {
      selectedTestDebugFixture: true,
      javaRelease: process.env.IDE_JAVA_REFERENCE_RELEASE === "27" ? 27 : legacyReferenceRelease(),
    });
  },
);
Given<StoryWorld>(
  "the native GUI has a real {word} project for failed test debugging from {word}",
  { timeout: 40_000 },
  async function (tool: string, origin: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    ) throw new Error("Failed-test debugging requires the native GUI artifact declared by the runner");
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    if (origin !== "test" && origin !== "debug-test") throw new Error(`Unsupported test origin: ${origin}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "tests", false, false, false, false, false, false, false, {
      selectedTestDebugFixture: true,
      failedTestDebugFixture: true,
      failedTestDebugOrigin: origin,
      javaRelease: process.env.IDE_JAVA_REFERENCE_RELEASE === "27" ? 27 : legacyReferenceRelease(),
    });
  },
);
Given<StoryWorld>(
  "the native GUI has a real {word} project for {word} failed test debugging",
  { timeout: 40_000 },
  async function (tool: string, framework: string) {
    if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true || this.targetEvidence.e2e !== true || !matchesNativeArtifactEvidence(this.targetEvidence)) throw new Error("Framework test debugging requires the native GUI artifact declared by the runner");
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    if (framework !== "jupiter" && framework !== "testng") throw new Error(`Unsupported test framework: ${framework}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "tests", false, false, false, false, false, false, false, { selectedTestDebugFixture: true, failedTestDebugFixture: true, failedTestDebugOrigin: "test", failedTestDebugFramework: framework });
  },
);
Given<StoryWorld>(
  "the native GUI has a real Gradle Jupiter project with an inherited default test method",
  { timeout: 40_000 },
  async function () {
    if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true || this.targetEvidence.e2e !== true || !matchesNativeArtifactEvidence(this.targetEvidence)) throw new Error("Default test method navigation requires the native GUI artifact declared by the runner");
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "gradle", "tests", false, false, false, false, false, false, false, {
      selectedTestDebugFixture: true, failedTestDebugFixture: true, failedTestDebugOrigin: "test",
      failedTestDebugFramework: "jupiter", inheritedDefaultTestMethod: true,
    });
  },
);
Given<StoryWorld>(
  /^the native GUI has a Maven (reactor with app and library Failsafe integration-test source roots|reactor whose app integration tests are declared in a profile|Failsafe reactor whose app selects a Java 8 test JVM)$/u,
  { timeout: 40_000 },
  async function (fixture: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Maven Failsafe context acceptance requires the native GUI artifact declared by the runner",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    const legacyApp = fixture === "Failsafe reactor whose app selects a Java 8 test JVM";
    if (legacyApp && !process.env.IDE_TEST_JAVA8_HOME) throw new Error("Set IDE_TEST_JAVA8_HOME to a full Java 8 JDK.");
    await value.prepare(true, "maven", "tests", false, false, false, false, false, false, false, {
      customMavenIntegrationTestSourceSet: true,
      mavenFailsafeJava8Fixture: legacyApp,
      mavenFailsafeProfile: fixture === "reactor whose app integration tests are declared in a profile",
      javaRelease: !legacyApp && process.env.IDE_JAVA_REFERENCE_RELEASE === "27" ? 27 : undefined,
    });
  },
);
Given<StoryWorld>(
  "the project test GUI has a real {word} reference project for Jupiter execution and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "JUnit Jupiter project-test acceptance requires matching native desktop artifact evidence",
      );
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "tests", false, false, false, false, false, false, false, {
      junitJupiterProjectTests: true,
    });
  },
);
Given<StoryWorld>(
  "the project test GUI has a real {word} reference project for TestNG execution and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "TestNG project-test acceptance requires matching native desktop artifact evidence",
      );
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "tests", false, false, false, false, false, false, false, {
      testNgProjectTests: true,
    });
  },
);
Given<StoryWorld>(
  "the project test GUI has a real {word} reference project for mixed JUnit execution and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Mixed JUnit engine acceptance requires matching native desktop artifact evidence",
      );
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unsupported test tool: ${tool}`);
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, tool, "tests", false, false, false, false, false, false, false, {
      mixedJunitProjectTests: true,
    });
  },
);
Given<StoryWorld>(
  "the project test GUI has a real Gradle custom test source set for coverage and a duplicate Test task with an incomplete runtime classpath, using a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Custom Gradle coverage acceptance requires matching native desktop artifact evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true,
      "gradle",
      "coverage",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { customGradleTestSourceSet: true },
    );
  },
);
Given<StoryWorld>(
  "the project test GUI has a real multi-module Gradle Kotlin DSL project for coverage and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Multi-module Gradle coverage acceptance requires matching native desktop artifact evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true,
      "gradle",
      "coverage",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { gradleKotlinDslProject: true },
    );
  },
);
Given<StoryWorld>(
  "the project execution GUI has a real Gradle reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Project execution acceptance requires matching native desktop artifact evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true, "gradle", undefined, false, false, false, false, false, false, false,
      { javaRelease: legacyReferenceRelease() },
    );
  },
);
Given<StoryWorld>(
  /^the Java Run GUI has a mixed Java and Kotlin (Gradle|Maven) module and a capable daemon$/,
  { timeout: 40_000 },
  async function (buildTool: "Gradle" | "Maven") {
    if (this.targetProfile.driver !== "tauri-webdriver" || !matchesNativeArtifactEvidence(this.targetEvidence))
      throw new Error("Mixed Java and Kotlin acceptance requires the declared native GUI artifact.");
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, buildTool === "Gradle" ? "gradle" : "maven", undefined, false, false, false, false, false, false, false,
      { mixedJvmProject: true });
  },
);
Given<StoryWorld>(
  /^the project execution GUI has a real Gradle composite with an app directory outside the included build root( and another :app project)? and a capable daemon$/,
  { timeout: 40_000 },
  async function (secondApp: string | undefined) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Gradle composite acceptance requires the native GUI artifact declared by the runner",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      true,
      "gradle",
      "discover",
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      { gradleCompositeProject: secondApp ? "same-path-app" : true },
    );
  },
);
Given<StoryWorld>(
  "the project context GUI has a real Maven Java 26 reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Unsupported Java project-context refusal acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "maven",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        mavenUnsupportedRelease: 26,
      },
    );
  },
);
Given<StoryWorld>(
  "the project context GUI has a real Maven Java 27 reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Unsupported Java project-context refusal acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "maven",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { mavenUnsupportedRelease: 27 },
    );
  },
);
Given<StoryWorld>(
  "the Java 26 project-context GUI has a real Maven project and the upgraded daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Java 26 context acceptance requires native GUI evidence matching the runner artifact",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "maven",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        javaRelease: 26,
      },
    );
  },
);
Given<StoryWorld>(
  "the Java 26 project-context GUI has a real Gradle project and the upgraded daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Java 26 context acceptance requires native GUI evidence matching the runner artifact",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "gradle",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        javaRelease: 26,
      },
    );
  },
);
Given<StoryWorld>(
  /^the Java 27 project-context GUI has a real Maven (project|execution project) and the (isolated candidate daemon|standard user installation)$/,
  { timeout: 40_000 },
  async function (project: string, installation: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Java 27 context acceptance requires native GUI evidence matching the runner artifact",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "maven",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        javaRelease: 27,
        java27JdtlsDefinition: true,
        java27MavenExecution: project === "execution project",
      },
    );
    if (installation === "standard user installation")
      await value.useStandardRefactorKitInstallation();
  },
);
Given<StoryWorld>(
  "the Java 27 project-context GUI has a real Gradle project and the isolated candidate daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error(
        "Java 27 context acceptance requires native GUI evidence matching the runner artifact",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(true, "gradle", "tests", false, false, false, false, false, false, false, {
      javaRelease: 27,
      java27JdtlsDefinition: true,
    });
  },
);
Given<StoryWorld>(
  "the project context GUI has real Maven and Gradle reference projects and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Project context acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
Given<StoryWorld>(
  "the project context GUI has a real Gradle JPMS project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Gradle JPMS context acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "gradle",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { gradleJpmsProject: true },
    );
  },
);
Given<StoryWorld>(
  "the project context GUI has a real Gradle JPMS v5 project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Gradle JPMS v5 context acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "gradle",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { gradleJpmsV5Project: true },
    );
  },
);
Given<StoryWorld>(
  "the project context GUI has a real Maven JPMS v5 project and a capable daemon",
  { timeout: 180_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Maven JPMS v5 context acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    await value.prepare(
      false,
      "maven",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { mavenJpmsV5Project: true },
    );
  },
);
Given<StoryWorld>(
  "the project context GUI has a real Gradle preview project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Gradle preview acceptance requires real release/no-bundle native GUI evidence",
      );
    const value = new NativeJavaProjectContextSession();
    sessions.set(this, value);
    const configuredRelease = Number(process.env.IDE_JAVA_CONTEXT_GRADLE_PREVIEW_RELEASE ?? "21");
    if (configuredRelease !== 21 && configuredRelease !== 25 && configuredRelease !== 27)
      throw new Error("IDE_JAVA_CONTEXT_GRADLE_PREVIEW_RELEASE must be 21, 25 or 27");
    await value.prepare(
      false,
      "gradle",
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { gradlePreviewProject: true, gradlePreviewRelease: configuredRelease },
    );
  },
);
const actions: readonly [string, (value: NativeJavaProjectContextSession) => Promise<void>][] = [
  [
    "the person verifies Java 26 rename refusal without processor output and explicitly builds the synchronized application",
    (s) => s.buildJava26RefactoringInputs(),
  ],
  [
    "the person applies and undoes the Java 26 cursor rename then applies and rolls back the saved-source class rename",
    (s) => s.applyRollbackJava26ClassRename(),
  ],
  [
    "the person opens the Java Project panel for the Maven project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person opens the Java Project panel for the Gradle project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person synchronizes the supported Java 26 Maven project context",
    (s) => s.synchronizeJava26ProjectContext(),
  ],
  [
    "the person explicitly evaluates the Java 26 Gradle project context offline",
    (s) => s.synchronizeJava26ProjectContext(),
  ],
  [
    "the person synchronizes the supported Java 27 Maven project context",
    (s) => s.synchronizeJava27ProjectContext(),
  ],

  ["the person builds, runs, tests and debugs the synchronized Java 27 Maven application", (s) => s.qualifyJava27MavenExecution()],  [
    "the person starts Eclipse JDT LS on the qualified JDK 25 runtime for Java 27 and navigates the inherited Maven call",
    (s) => s.navigateJava27DefinitionWithJdtLs(),
  ],
  [
    "the person requests Shift F12 on the Java 27 inherited call",
    (s) => s.navigateJava27ReferencesWithJdtLs(),
  ],
  [
    "the person Control-clicks the Java 27 inherited Maven call",
    (s) => s.ctrlClickJava27MavenDefinition(),
  ],

  ["the editor and Java Intelligence open the Java 27 receiver type and the panel retires results when the cursor moves", (s) => s.assertJava27JdtlsTypeDefinition()],  [
    "the person closes the Java 27 declaration tab before inspecting references",
    (s) => s.closeJava27ReferenceDeclarationTab(),
  ],
  [
    "the person resynchronizes Maven after language-server import and repeats F12",
    (s) => s.refreshJava27MavenContextAfterLanguageImport(),
  ],
  [
    "the person starts Eclipse JDT LS on the qualified JDK 25 runtime for Java 27 and navigates the inherited Gradle call",
    (s) => s.navigateJava27DefinitionWithJdtLs(),
  ],
  [
    "the person reevaluates Gradle after language-server import and repeats F12",
    (s) => s.refreshJava27GradleContextAfterLanguageImport(),
  ],
  [
    "the person explicitly evaluates the Java 27 Gradle project context offline",
    (s) => s.synchronizeJava27ProjectContext(),
  ],
  [
    "the person reevaluates the Java 27 Gradle context after Build",
    (s) => s.refreshJava27GradleProjectContextAfterExecution(),
  ],
  [
    "the person reevaluates the Java 27 Gradle context after Run",
    (s) => s.refreshJava27GradleProjectContextAfterExecution(),
  ],
  [
    "the person opens the Java Project panel for the Java 26 Maven project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person opens the Java Project panel for the Java 27 Maven project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person synchronizes the Java 26 Maven project context",
    (s) => s.synchronizeUnsupportedReleaseMavenExpectingRefusal(26),
  ],
  [
    "the person synchronizes the Java 27 Maven project context",
    (s) => s.synchronizeUnsupportedReleaseMavenExpectingRefusal(27),
  ],
  [
    "the IDE shows the provider refusal, claims no available context, preserves Maven inputs and creates no build output",
    (s) => s.assertUnsupportedReleaseMavenContextRefusedWithoutBuildOutput(26),
  ],
  [
    "the IDE shows the provider refusal for Java 27, claims no available context, preserves Maven inputs and creates no build output",
    (s) => s.assertUnsupportedReleaseMavenContextRefusedWithoutBuildOutput(27),
  ],
  [
    "the person opens the Java Project panel for the Gradle preview project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person prepares JDT LS Gradle import and opens the preview source",
    (s) => s.prepareGradlePreviewImport(),
  ],
  [
    "the person explicitly evaluates and builds the Gradle preview project",
    (s) => s.evaluateGradle(true),
  ],
  ["the person closes the Gradle preview project IDE", (s) => s.close()],
  [
    "the person opens the Java Project panel for the Gradle JPMS project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person opens the Java Project panel for the Maven JPMS project",
    (s) => s.launchForProjectContext(),
  ],
  [
    "the person synchronizes the Maven JPMS project with its selected JDK",
    (s) => s.synchronizeMaven(),
  ],
  [
    "the person runs the synchronized Maven JPMS v5 project as a named module",
    (s) => s.runMavenJpmsV5NamedModule(),
  ],
  [
    "the person starts JDI for the Maven JPMS v5 named module",
    (s) => s.startMavenJpmsV5NamedModuleDebug(),
  ],
  [
    "the person continues the Maven JPMS v5 debuggee",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person runs the synchronized Gradle JPMS v5 project as a named module",
    (s) => s.runGradleJpmsV5NamedModule(),
  ],
  [
    "the person starts JDI for the Gradle JPMS v5 named module",
    (s) => s.startGradleJpmsV5NamedModuleDebug(),
  ],
  [
    "the person continues the Gradle JPMS v5 debuggee",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person saves the edited Java source before Gradle project synchronization when needed",
    (s) => s.saveExecutionDraftBeforeGradleSyncWhenNeeded(),
  ],
  ["the person requests Rebuild for the included Gradle app through the command palette", (s) => s.rebuildGradleCompositeModule()],
  ["composite Rebuild removes the old output, recompiles the app and preserves the library", (s) => s.assertGradleCompositeRebuild()],
  [
    "the person cleans and rebuilds the included Gradle app through the command palette",
    (s) => s.cleanAndRebuildGradleCompositeModule(),
  ],
  [
    "composite Clean targets the external app directory and preserves library outputs and project inputs",
    (s) => s.assertGradleCompositeCleanAndRebuild(),
  ],
  [
    "the person cleans and rebuilds the synchronized application module without running it",
    (s) => s.cleanAndRebuildSynchronizedModule(),
  ],
  [
    "the selected module regenerates compiled and processor outputs without changing project inputs",
    (s) => s.assertSynchronizedCleanAndRebuild(),
  ],
  [
    "the person synchronizes the selected execution project with its full JDK",
    (s) => s.synchronizeExecutionProject(),
  ],
  [
    "the person restores the failed test debug source through native text input and closes the IDE",
    (s) => s.restoreFailedTestDebugSourceAndClose(),
  ],
  [
    "the person reviews the runner selections then repairs and debugs them",
    (s) => s.debugFailedTestsAfterRepair(),
  ],
  [
    "the person debugs a failing test class then repairs and debugs only its failed methods",
    (s) => s.debugFailedTestsAfterRepair(),
  ],
  [
    "the person debugs the selected test then reruns it and stops the test JVM",
    (s) => s.debugSelectedTestRerunAndStop(),
  ],
  [
    "the person discovers tests from the synchronized application module",
    (s) => s.startSynchronizedProjectTests(),
  ],
  [
    "the person discovers tests from Commands for the synchronized application module",
    (s) => s.startSynchronizedProjectTests("commands"),
  ],
  [
    "the person runs tests from Commands for the synchronized application module",
    (s) => s.startSynchronizedProjectTests("commands"),
  ],
  [
    "the person opens the Gradle library source before running coverage",
    (s) => s.openGradleLibrarySourceForCoverage(),
  ],
  [
    "the person runs coverage from Commands for the synchronized application module",
    (s) => s.startSynchronizedProjectTests("commands"),
  ],
  [
    "the person runs coverage for the synchronized application module",
    (s) => s.startSynchronizedProjectTests(),
  ],
  [
    "the person opens the Gradle library source before composite coverage",
    (s) => s.openGradleLibrarySourceForCoverage(),
  ],
  [
    "the person runs coverage for the synchronized included application module",
    (s) => s.startSynchronizedProjectCoverage(),
  ],
  [
    "composite coverage includes covered application and included-library code and opens the dependency source",
    (s) => s.assertCompositeCoverage(),
  ],
  [
    "the person synchronizes and explicitly evaluates the Gradle composite again after coverage",
    (s) => s.refreshGradleContextAfterCompositeExecution(),
  ],
  [
    "the person runs tests for the synchronized application module",
    (s) => s.startSynchronizedProjectTests(),
  ],
  [
    "the person builds the synchronized Gradle integrationTest source set from Java Run",
    (s) => s.startCustomGradleIntegrationBuild(),
  ],
  [
    "the person refreshes the selected Gradle project context after the custom source set is compiled",
    (s) => s.refreshGradleContextAfterCustomSourceExecution(),
  ],
  [
    "the person runs the application from the synchronized Gradle integrationTest source set",
    (s) => s.startCustomGradleIntegrationApplication(),
  ],
  [
    "the person discovers tests from the synchronized Gradle integrationTest source set",
    (s) => s.startCustomGradleIntegrationDiscovery(),
  ],
  [
    "the person runs tests for the synchronized Gradle integrationTest source set from Java Run",
    (s) => s.startCustomGradleIntegrationTests(),
  ],
  [
    "the person runs coverage from the synchronized Gradle integrationTest source set",
    (s) => s.startCustomGradleIntegrationCoverage(),
  ],
  [
    "the multi-module Gradle coverage includes covered application and library code and opens the dependency source",
    (s) => s.assertMultiModuleCoverage(),
  ],
  [
    "the person runs tests for the synchronized Gradle Kotlin DSL project from Java Run",
    (s) => s.startGradleKotlinDslProjectTests(),
  ],
  [
    "the person restarts Eclipse JDT LS with the selected execution JDK",
    (s) => s.startExecutionLanguageService(),
  ],
  [
    "the person enables JDT LS Gradle import for this session when needed",
    (s) => s.authorizeGradleImportForJdtLs(),
  ],
  ["the person opens the reported Java test source", (s) => s.openReportedTestSource()],
  [
    "the person changes visible test settings and runs one discovered module method",
    (s) => s.runCapturedDiscoveredMethod(),
  ],
  [
    "the person filters discovered module methods by name and kind",
    (s) => s.filterDiscoveredModuleMethods(),
  ],
  [
    "the person repairs the failed test in the editor and saves it",
    (s) => s.repairFailedTestInEditor(),
  ],
  [
    "the person synchronizes the project context after saving the repaired test when needed",
    async (s) => { await s.synchronizeContextAfterTestRepairWhenNeeded(); },
  ],
  [
    "the person changes visible test settings and reruns failures from Commands",
    (s) => s.rerunSynchronizedFailedTest("commands"),
  ],
  [
    "the person changes visible test settings and reruns failures",
    (s) => s.rerunSynchronizedFailedTest(),
  ],
  [
    "the person refreshes Maven context after app Failsafe generates build output",
    (s) => s.refreshMavenContextAfterFailsafeExecution(),
  ],
  [
    "the person runs integration tests from the synchronized app Maven source set",
    (s) => s.runSynchronizedMavenFailsafeIntegrationTests("app"),
  ],
  [
    "the person runs integration tests from the synchronized library Maven source set",
    (s) => s.runSynchronizedMavenFailsafeIntegrationTests("library"),
  ],
  ["the person resynchronizes Maven after the app test", (s) => s.resynchronizeMavenAfterExecution()],
  ["the person debugs the Java 8 app integration test and stops its captured rerun", (s) => s.debugMavenFailsafeTest(true)],
  ["the person retries the library test after Maven loses and regains its required toolchain", (s) => s.verifyMavenFailsafeToolchainRecovery()],
  ["the person retries the app test after separately removing and restoring a plugin JAR and its parent POM in the isolated offline Maven cache", (s) => s.verifyMavenFailsafeOfflinePluginRecovery()],
  ["the person measures Failsafe coverage with the Java 8 and JDK 21 test forks", (s) => s.qualifyMavenFailsafeCoverage(true)],
  ["the person measures Failsafe coverage with the selected project JDK", (s) => s.qualifyMavenFailsafeCoverage()],
  ["the person debugs the selected app integration test and stops its captured rerun", (s) => s.debugMavenFailsafeTest()],
  [
    "the person explicitly synchronizes the Gradle execution project with its selected JDK",
    (s) => s.synchronizeGradleForExecution(),
  ],
  [
    "the person synchronizes and explicitly evaluates the Gradle composite again after Run",
    (s) => s.refreshGradleContextAfterCompositeExecution(),
  ],
  [
    "the person synchronizes and explicitly evaluates the Gradle composite again after its selected test",
    (s) => s.refreshGradleContextAfterCompositeExecution(),
  ],
  [
    "the selected project context resolves the included app's provider-qualified build identity",
    (s) => s.assertGradleCompositeProjectContext(),
  ],
  [
    "the person selects and runs the app in the second included build",
    (s) => s.runSecondGradleCompositeApp(),
  ],
  [
    "the person builds the nested app's test source set without running it",
    (s) => s.buildSecondCompositeTests(),
  ],
  [
    "the person discovers the tests of the second app with both Runner sources open",
    (s) => s.discoverSecondCompositeTests(),
  ],
  [
    "running the discovered method with coverage after selecting Plain JDK measures and opens only the second Runner",
    (s) => s.coverSecondCompositeTest(),
  ],
  [
    "Rerun session produces fresh coverage for the same method in the second included build",
    (s) => s.rerunSecondCompositeCoverage(),
  ],
  [
    "the person runs the synchronized application module from Java Run",
    (s) => s.runSynchronizedModule(),
  ],
  [
    "the person builds the synchronized Java 27 Gradle application module",
    (s) => s.startJava27GradleApplicationBuild(),
  ],
  [
    "the Java 27 Gradle build succeeds with the selected compiler JDK",
    (s) => s.assertJava27GradleApplicationBuild(),
  ],
  [
    "the Java 27 Gradle application builds and runs from the metadata-only context with the selected JDK",
    (s) => s.assertJava27GradleApplicationRun(),
  ],
  [
    "the Java 27 Gradle tests pass with the selected JDK and captured test settings",
    (s) => s.assertJava27GradleProjectTests(),
  ],
  [
    "the person measures coverage for the synchronized Java 27 Gradle application",
    (s) => s.qualifyJava27GradleCoverage(),
  ],
  [
    "the person debugs the synchronized Java 27 Gradle application",
    (s) => s.qualifyJava27GradleDebug(),
  ],
  [
    "the person records the synchronized Java 27 application with Flight Recorder",
    (s) => s.qualifyJava27FlightRecorder(),
  ],
  [
    "the person opens a discovered Java 27 test class and runs one selected test",
    (s) => s.qualifyJava27TestDiscovery(),
  ],
  [
    "the person activates the disabled Maven profile and synchronizes it",
    (s) => s.activateMavenFailsafeProfile(),
  ],
  [
    "the person opens the selected Java 27 test source from its result",
    (s) => s.qualifyJava27TestSourceNavigation(),
  ],
  [
    "the person explicitly saves the edited Java source before test debugging",
    (s) => s.saveExecutionDraftBeforeProjectSync(),
  ],
  [
    "the person explicitly saves the edited Java source before Gradle synchronization",
    (s) => s.saveExecutionDraftBeforeProjectSync(),
  ],
  [
    "the person explicitly saves the edited Java source before project synchronization",
    (s) => s.saveExecutionDraftBeforeProjectSync(),
  ],
  [
    "the person sets a source breakpoint in the synchronized app module and requests Debug",
    (s) => s.startSynchronizedModuleDebugging(),
  ],
  [
    "the person sets a source breakpoint in the synchronized app module and requests Debug from Commands",
    (s) => s.startSynchronizedModuleDebugging("commands"),
  ],
  [
    "the person rebinds the saved Runner breakpoint and reruns the captured project debugger to completion",
    (s) => s.restartSynchronizedModuleDebugging(),
  ],
  [
    "the person sets a JDI source breakpoint in the synchronized Gradle integrationTest application and requests Debug",
    (s) => s.startCustomGradleIntegrationDebugging(),
  ],
  [
    "the person continues the synchronized Maven debugger to the source breakpoint",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person continues the synchronized Gradle debugger to the source breakpoint",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person reloads the synchronized Runner output through HotSwap",
    (s) => s.reloadSynchronizedModuleClassFromProjectOutput(),
  ],
  [
    "the person edits the synchronized Runner method and reviews its changed compiled class before reload",
    (s) => s.reviewSynchronizedModuleClassChanges(),
  ],
  [
    "the person continues the Maven debuggee to completion",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person continues the Gradle debuggee to completion",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person continues the custom Gradle debugger to the source breakpoint",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person continues the custom Gradle debuggee to completion",
    (s) => s.continueSynchronizedModuleDebugging(),
  ],
  [
    "the person restores the saved reference source and closes the project execution IDE",
    (s) => s.restoreSavedExecutionSourceAndClose(),
  ],
  [
    "the person opens and synchronizes the Maven reactor before opening Java source",
    (s) => s.launchAndSynchronizeMavenBeforeJavaOpen(),
  ],
  [
    "the person opens the reference Java source and leaves an unsaved edit",
    (s) => s.launchWithDirtyBuffer(),
  ],
  [
    "the person synchronizes the Maven project with its selected full JDK",
    (s) => s.synchronizeMaven(),
  ],
  [
    "the person synchronizes Maven's module catalog with the selected JDK",
    (s) => s.synchronizeMavenForModuleOperations(),
  ],
  [
    "the person verifies the Java type package from the synchronized Maven source root",
    (s) => s.verifyJavaTypePackagePrefillFromMavenSourceRoot(),
  ],
  ["the person synchronizes Maven again with the selected JDK", (s) => s.synchronizeMaven()],
  [
    "the person creates a Java module descriptor from the synchronized library source root",
    (s) => s.createMavenModuleDescriptorFromSourceRoot(),
  ],
  [
    "the person corrects a refused Maven module destination without synchronizing again and reviews the rename",
    (s) => s.previewMavenModuleRename({ retryDestination: true }),
  ],
  [
    "the person reviews, applies and rolls back a nested Maven module relocation with the original artifact ID",
    (s) => s.relocateMavenModule(),
  ],
  [
    "the Maven module rename review remains available from its provider",
    (s) => s.assertMavenModuleRenameAvailableFromProvider(),
  ],
  [
    "the IDE refuses Apply while preserving the Maven module rename preview",
    (s) => s.assertMavenModuleRenamePreview(),
  ],
  [
    "the person discards the fixture edit and applies then rolls back the Maven module rename",
    (s) => s.applyAndRollbackMavenModuleRename(),
  ],
  [
    "the IDE restores the original Maven module and build files",
    (s) => s.assertMavenModuleRenameRollback(),
  ],
  [
    "the person requests all resolved test-method, equality assertion, Mockito and Spring Boot templates in the synchronized Maven test source set",
    (s) => s.requestProjectTestTemplates(),
  ],
  [
    "the person requests all resolved test-method, equality assertion, Mockito and Spring Boot templates in the explicitly evaluated Gradle test source set",
    (s) => s.requestProjectTestTemplates(),
  ],
  [
    "the person restores the test-template draft and closes the project context IDE",
    (s) => s.restoreTestTemplateDraftAndClose(),
  ],
  [
    "the person refreshes the selected project context after the custom main output is generated",
    (s) => s.refreshProjectContextAfterCustomOutput(),
  ],
  [
    "the person starts Eclipse JDT LS with the selected Maven JDK",
    (s) => s.startProjectLanguageService(),
  ],
  ["the person refreshes the saved Java source structure", (s) => s.refreshSavedSourceStructure()],
  [
    "the person refreshes the saved Java source structure for Gradle",
    (s) => s.refreshSavedSourceStructure("gradle"),
  ],
  ["the person opens Runner from the project model", (s) => s.openRunnerFromProjectModel()],
  ["the person resolves the secondary main type", (s) => s.inspectSources()],
  [
    "the Maven compiler adds a test output after context synchronization",
    (s) => s.compileMavenTestOutputAfterContext(),
  ],
  [
    "the person reacquires Maven context after a background output change if required and resolves the same-path test type",
    (s) => s.reacquireMavenContextAfterBackgroundCompilation(),
  ],
  ["the Maven descriptor changes outside the IDE", (s) => s.changeDescriptorOutsideTheIDE()],
  [
    "the person synchronizes the Gradle reference project with its selected JDK",
    (s) => s.synchronizeGradle(),
  ],
  ["the person discards the fixture edit and closes the project context IDE", (s) => s.close()],
  ["the person closes the project context IDE", (s) => s.close()],
  [
    "the person explicitly evaluates the Gradle reference project after its build outputs are prepared",
    (s) => s.evaluateGradle(),
  ],
  [
    "the person explicitly evaluates the Gradle JPMS project with its real module-path JAR",
    (s) => s.evaluateGradle(),
  ],
  [
    "the person keeps the unsaved draft synchronizes Maven and navigates the inherited integer call",
    (s) => s.navigateWithMavenContext(),
  ],
  [
    "the person attempts a project SDK change with an unsaved Java edit and requests navigation without resynchronizing",
    (s) => s.changeSdkAndNavigate(),
  ],
];
const assertions: readonly [string, (value: NativeJavaProjectContextSession) => Promise<void>][] = [
  [
    "the Java 26 rename uses qualified SDK analysis and its applied source copy compiles and passes tests",
    (s) => s.assertJava26ManagedRename(),
  ],
  [
    "the effective Maven context reports Java 26 source level and the selected JDK",
    (s) => s.assertJava26ProjectContext(),
  ],
  [
    "the Java 26 context request uses matching snapshot and SDK evidence and preserves Maven inputs",
    (s) => s.assertJava26ProjectContext(),
  ],
  [
    "the effective Gradle context reports Java 26 source level and the selected JDK",
    (s) => s.assertJava26ProjectContext(),
  ],
  [
    "the Java 26 Gradle synchronization attestation matches the project context snapshot and preserves inputs",
    (s) => s.assertJava26ProjectContext(),
  ],
  [
    "the effective Maven context reports Java 27 source level and the selected JDK",
    (s) => s.assertJava27ProjectContext(),
  ],
  [
    "the Java 27 context request uses matching snapshot and SDK evidence and preserves Maven inputs",
    (s) => s.assertJava27ProjectContext(),
  ],
  [
    "the preview candidate resolves Java 27 Maven source ownership with a JDT binding",
    (s) => s.assertJava27PreviewSourceOwnership(),
  ],
  [
    "the v7 candidate resolves Java 27 Maven source-root ownership without semantic analysis",
    (s) => s.assertJava27V7OwnerOnlySourceOwnership(),
  ],
  [
    "the IDE discovers RefactorKit from the standard user installation without provider overrides",
    (s) => s.assertStandardRefactorKitDiscovery(),
  ],
  [
    "the v7 candidate resolves Java 27 Gradle source-root ownership without semantic analysis",
    (s) => s.assertJava27V7GradleOwnerOnlySourceOwnership(),
  ],
  [
    "the IDE opens the exact cross-module declaration through the JDT LS F12 fallback without changing project sources",
    (s) => s.assertJava27JdtLsDefinition(),
  ],
  [
    "the IDE opens the exact call site from guarded JDT LS references after RefactorKit refuses semantic analysis",
    (s) => s.assertJava27JdtLsReferences(),
  ],
  [
    "the IDE opens the exact cross-module declaration through the JDT LS Control-click fallback",
    (s) => s.assertJava27CtrlClickDefinition(),
  ],
  [
    "the effective Gradle context reports Java 27 source level and the selected JDK",
    (s) => s.assertJava27ProjectContext(),
  ],
  [
    "the Java 27 Gradle synchronization attestation matches the project context snapshot and preserves inputs",
    (s) => s.assertJava27ProjectContext(),
  ],
  [
    "the Java Project panel displays the materialized Gradle annotation processor path and generated source root",
    (s) => s.assertJava27GradleAnnotationProcessorContext(),
  ],
  [
    "JDT LS reports the preview-feature mismatch before project-context synchronization",
    (s) => s.assertGradlePreviewErrorBeforeContext(),
  ],
  [
    "the IDE applies Gradle's verified preview option to JDT LS and clears the diagnostic",
    (s) => s.assertGradlePreviewOptionApplied(),
  ],
  [
    "the synchronized Maven context exposes separate app and library integration-test source sets",
    (s) => s.assertSynchronizedMavenIntegrationTestSourceSetAvailable(),
  ],
  [
    "the Java Project panel warns when the app annotation processor context is incomplete",
    (s) => s.assertMavenAnnotationProcessorWarning(),
  ],
  [
    "the Java Project panel shows the provider test JVM facts for each Failsafe source set",
    (s) => s.assertMavenProfileTestJvmDetails(),
  ],
  [
    "the refreshed Maven context keeps separate app and library integration-test source sets",
    (s) => s.assertSynchronizedMavenIntegrationTestSourceSetAvailable(true),
  ],
  [
    "the refreshed app context exposes its materialized processor path and generated source root",
    (s) => s.assertMavenAnnotationProcessorContextAfterFailsafe(),
  ],
  [
    "F12 opens the generated Java method declaration from its call site",
    (s) => s.assertGeneratedJavaMethodDefinition(),
  ],
  [
    "Maven Failsafe reports the app test from its declared report directory",
    (s) => s.assertSynchronizedMavenFailsafeIntegrationTests("app"),
  ],
  [
    "Maven Failsafe reports the library test from its declared report directory",
    (s) => s.assertSynchronizedMavenFailsafeIntegrationTests("library"),
  ],
  ["the Java 8 app test receives the project and IDE options and produces a fresh Failsafe report", (s) => s.assertLegacyMavenFailsafeJvm()],
  ["the JDK 21 library test passes from its declared Failsafe report directory", (s) => s.assertSynchronizedMavenFailsafeIntegrationTests("library", false)],
  [
    "the native check confirms Monaco inserts and compiles the resolved JUnit 4, Jupiter, TestNG, Mockito and Spring Boot templates with the selected JDK against the Maven test classpath while keeping every editor change unsaved",
    (s) => s.assertProjectTestTemplate(),
  ],
  [
    "the native check confirms Monaco inserts and compiles the resolved JUnit 4, Jupiter, TestNG, Mockito and Spring Boot templates in the evaluated Gradle context with the selected JDK against the effective test classpath while keeping every editor change unsaved",
    (s) => s.assertProjectTestTemplate(),
  ],
  [
    "the project debugger starts suspended before application code and saves the edit",
    (s) => s.assertSynchronizedModuleDebugEntry(),
  ],
  [
    "the project debugger starts suspended before application code with the saved edit",
    (s) => s.assertSynchronizedModuleDebugEntry(),
  ],
  [
    "the project debugger suspends at integrationTest entry with the saved project source",
    (s) => s.assertCustomGradleIntegrationDebugEntry(),
  ],
  [
    "JDI stops on the selected module source before its output statement",
    (s) => s.assertSynchronizedModuleDebugBreakpoint(),
  ],
  [
    "JDI applies the synchronized Runner output and remains suspended",
    (s) => s.assertSynchronizedModuleClassReloaded(),
  ],
  [
    "JDI stops in IntegrationRunner main before its output statement",
    (s) => s.assertCustomGradleIntegrationDebugBreakpoint(),
  ],
  [
    "the application reports its effective dependencies and selected JDK and its JVM exits",
    (s) => s.assertSynchronizedModuleDebugCompleted(),
  ],
  [
    "the custom source-set application reports its runtime dependencies and selected JDK and exits",
    (s) => s.assertCustomGradleIntegrationDebugCompleted(),
  ],
  [
    "all selected module methods are discovered without running their bodies",
    (s) => s.assertSynchronizedDiscovery(),
  ],
  [
    "only the selected method runs with the discovery session JDK JVM options and environment",
    (s) => s.assertCapturedDiscoveredMethod(),
  ],
  [
    "the selected module tests pass with the selected JDK and configured test output directory",
    (s) => s.assertSynchronizedTests(),
  ],
  [
    "the selected module runs one JUnit Jupiter test with the captured settings and selected JDK",
    (s) => s.assertSynchronizedJupiterTests(),
  ],
  [
    "the selected module runs one TestNG test with the captured settings and selected JDK",
    (s) => s.assertSynchronizedTestNgTests(),
  ],
  [
    "the selected module runs its JUnit 4 and Jupiter tests through their configured engines",
    (s) => s.assertSynchronizedMixedJunitTests(),
  ],
  [
    "the synchronized Gradle integrationTest source set build runs its mapped classes task",
    (s) => s.assertCustomGradleIntegrationBuild(),
  ],
  [
    "the custom source-set application uses its compiled classes runtime dependencies and selected JDK",
    (s) => s.assertCustomGradleIntegrationApplication(),
  ],
  [
    "discovery reports the integrationTest method without running its body",
    (s) => s.assertCustomGradleIntegrationDiscovery(),
  ],
  [
    "the synchronized Gradle integrationTest source set runs its mapped task and reports one passing test",
    (s) => s.assertCustomGradleIntegrationTests(),
  ],
  [
    "coverage from the synchronized Gradle integrationTest source set measures and opens the module's main Java code with line decoration",
    (s) => s.assertCustomGradleIntegrationCoverage(),
  ],
  [
    "the synchronized Gradle Kotlin DSL project runs its mapped test task and reports one passing test",
    (s) => s.assertGradleKotlinDslProjectTests(),
  ],
  [
    "the module tests pass with the selected JDK and measured application instructions and lines",
    (s) => s.assertSynchronizedCoverage(),
  ],
  [
    "measured source navigation is available only with an available project context",
    (s) => s.openMeasuredCoverageSource(),
  ],
  [
    "the selected module reports one real failure and two passing companion methods",
    (s) => s.assertSynchronizedFailure(),
  ],
  [
    "the Java editor opens the exact test class from the selected module at the failing source line and preserves its source",
    (s) => s.assertReportedTestSource(),
  ],
  [
    "only the failed method runs again with the original JDK JVM options and environment",
    (s) => s.assertSynchronizedRerun(),
  ],
  [
    "the IDE exits cleanly with the repaired test and every other reference input preserved",
    (s) => s.assertFinal(),
  ],
  [
    "the native application uses the selected JDK and runtime dependencies after saving the draft",
    (s) => s.assertSynchronizedRun(),
  ],
  [
    "the Java application calls Kotlin and receives the result of its call back into Java",
    (s) => s.assertMixedJvmRun(),
  ],
  [
    "the included Gradle application runs from its selected build and library project",
    (s) => s.assertGradleCompositeApplicationRun(),
  ],
  [
    "only the second app reports its marker and creates its compiled entry point",
    (s) => s.assertSecondGradleCompositeAppRun(),
  ],
  [
    "the workspace wrapper dispatches to the real build tool and selected-JDK application result is visible",
    (s) => s.assertSynchronizedRun(),
  ],
  [
    "the native application uses the selected JDK runtime dependencies and configured build output directories after saving the draft",
    (s) => s.assertSynchronizedRun(),
  ],
  [
    "the IDE shows and discards a read-only rename preview without changing the Maven workspace",
    (s) => s.assertMavenModuleRenamePreview(),
  ],
  [
    "the native project view shows effective Maven modules generated roots classpath scopes and artifact coordinates",
    (s) => s.assertMaven(),
  ],
  [
    "the project model shows Runner at its engine-reported source location",
    (s) => s.assertRunnerModelLocation(),
  ],
  [
    "the project model shows Gradle Runner at its engine-reported source location",
    (s) => s.assertGradleRunnerModelLocation(),
  ],
  [
    "the editor reveals the reported line and preserves the unsaved draft",
    (s) => s.assertRunnerModelNavigation(),
  ],
  [
    "source ownership identifies the correct main and test files while preserving the editor draft",
    (s) => s.assertOwnership(),
  ],
  [
    "the project watcher retires the context and disables source ownership without saving the draft",
    (s) => s.assertProjectWatchRetirement(),
  ],
  [
    "Gradle is visibly partial with source ownership disabled and no build executed",
    (s) => s.assertPartialGradle(),
  ],
  [
    "the IDE exits cleanly with all reference source and build inputs preserved",
    (s) => s.assertFinal(),
  ],
  [
    "the editor opens the exact cross-module declaration using the selected Maven context",
    (s) => s.assertContextNavigation(),
  ],
  [
    "the IDE preserves the draft while refusing stale navigation, or records that no distinct JDK is installed",
    (s) => s.assertChangedSdkRefusal(),
  ],
  [
    "the editor keeps the generated descriptor as a draft until Save and the saved descriptor compiles with the library sources",
    (s) => s.assertMavenModuleDescriptorSavedAndCompiled(),
  ],
  [
    "Gradle effective modules and source ownership are visible while the Maven draft remains unsaved",
    (s) => s.assertEffectiveGradle(),
  ],
  [
    "the native project view shows partial Gradle JPMS metadata and refuses incomplete source resolution",
    (s) => s.assertGradleJpmsContext(),
  ],
  [
    "the native project view requests complete Gradle JPMS v5 metadata and displays every standard directive",
    (s) => s.assertGradleJpmsV5Context(),
  ],
  [
    "the native project view requests complete Maven JPMS v5 metadata and displays every standard directive",
    (s) => s.assertMavenJpmsV5Context(),
  ],
  [
    "the Maven JPMS v5 Run resolves its dependency module and preserves literal arguments",
    (s) => s.assertMavenJpmsV5NamedModuleRun(),
  ],
  [
    "the Maven JPMS v5 debuggee suspends before application code",
    (s) => s.assertMavenJpmsV5NamedModuleDebugEntry(),
  ],
  [
    "the Maven JPMS v5 Debug resolves its dependency module, preserves literal arguments and exits",
    (s) => s.assertMavenJpmsV5NamedModuleDebugCompleted(),
  ],
  [
    "the Gradle JPMS v5 Run resolves its dependency module and preserves literal arguments",
    (s) => s.assertGradleJpmsV5NamedModuleRun(),
  ],
  [
    "the Gradle JPMS v5 debuggee suspends before application code",
    (s) => s.assertGradleJpmsV5NamedModuleDebugEntry(),
  ],
  [
    "the Gradle JPMS v5 Debug resolves its dependency module, preserves literal arguments and exits",
    (s) => s.assertGradleJpmsV5NamedModuleDebugCompleted(),
  ],
];
for (const [text, run] of actions)
  When<StoryWorld>(
    text,
    {
      timeout:
        (text.includes("debugs the selected test") ||
          text.includes("debugs a failing test class") ||
          text.includes("applies then rolls back the Maven module rename") ||
          text.includes("corrects a refused Maven module destination") ||
          text.includes("rolls back a nested Maven module relocation") ||
          text.endsWith("app integration test and stops its captured rerun") ||
          text.endsWith("Maven loses and regains its required toolchain") ||
          text.endsWith("in the isolated offline Maven cache") ||
          text.includes("measures Failsafe coverage") ||
          text.startsWith("the multi-module Gradle coverage includes") ||
          text.endsWith("application with Flight Recorder") ||
          text.endsWith("activates the disabled Maven profile and synchronizes it") ||
          text.includes("opens a discovered Java 27 test class and runs one selected test") ||
          text.includes("opens the selected Java 27 test source from its result") ||
          text.includes("reviews the runner selections") ||
          /^the Java 27 Gradle (?:build succeeds|application builds and runs|tests pass)/u.test(text) ||
          /the synchronized Java 27 (?:Gradle|Maven) application$/u.test(text)) ? 180_000 :
        text.includes("Java 26 rename refusal") || text.includes("applies and undoes the Java 26")
          ? 240_000
          : text.includes("explicitly evaluates") ||
            text.startsWith("the person reevaluates the Java 27 Gradle context") ||
            text.startsWith("the person reevaluates Gradle after language-server import") ||
            text.includes("builds the nested app's test source set") ||
            text.includes("discovers the tests of the second app")
            ? 240_000
            : text.startsWith("composite coverage includes")
              ? 90_000
            : text.includes("prepares JDT LS Gradle import")
              ? 150_000
              : text.includes("explicitly synchronizes the Gradle execution project")
                ? 240_000
                : text.includes("synchronizes Maven again") || text.includes("synchronizes Maven's module catalog")
                  ? 120_000
                  : text.includes("refreshes Maven context")
                    ? 120_000
                    : text.includes("runs integration tests from")
                      ? 120_000
                      : text.includes("starts Eclipse JDT LS for Java 27")
                        ? 150_000
                        : text.includes("starts Eclipse JDT LS")
                          ? 90_000
                          : text.includes("restarts Eclipse JDT LS")
                            ? 150_000
                            : text.includes("reacquires Maven context")
                              ? 90_000
                              : (text.includes("cleans and rebuilds the synchronized") || text.includes("cleans and rebuilds the included Gradle") || text.includes("requests Rebuild for the included Gradle"))
                                ? 240_000
                              : text.includes("synchronizes the selected execution project")
                                ? 160_000
                                : 40_000,
    },
    async function () {
      const value = session(this);
      try {
        await run(value);
      } catch (error) {
        await value.captureFailure(error);
        throw error;
      }
    },
  );
Then<StoryWorld>(
  "the selected Java test returns its real report and a captured debug rerun stops without executing the test body",
  { timeout: 15_000 },
  async function () { await session(this).assertSelectedTestDebugging(); },
);
Then<StoryWorld>(
  "the failed test debug rerun uses current breakpoints and excludes the previously passing method",
  { timeout: 15_000 },
  async function () { await session(this).assertFailedTestDebugRerun(); },
);
Then<StoryWorld>(
  "the framework debug run follows the displayed method or class scope and preserves captured settings",
  { timeout: 15_000 },
  async function () { await session(this).assertFailedTestDebugRerun(); },
);
for (const [text, run] of [
  ["the person saves the working-directory source before project synchronization", (s: NativeJavaProjectContextSession) => s.saveExecutionDraftBeforeProjectSync()],
  ["the person sends application input and EOF through Run, JFR and captured working-directory Rerun", (s: NativeJavaProjectContextSession) => s.runProfileAndRepeatWithApplicationDirectory()],
  ["the person runs synchronized tests without inheriting application input or its directory", (s: NativeJavaProjectContextSession) => s.testWithApplicationDirectoryUnused()],
  ["the person sends input during synchronized Debug and stops another waiting application", (s: NativeJavaProjectContextSession) => s.debugWithApplicationDirectory()],
] as const)
  When<StoryWorld>(text, { timeout: 90_000 }, async function () {
    const value = session(this);
    try { await run(value); } catch (error) { await value.captureFailure(error); throw error; }
  });
When<StoryWorld>("the person introduces a syntax error and requests Build for the synchronized module", { timeout: 30_000 },
  async function () { const value = session(this); try { await value.breakSynchronizedSourceAndBuild(); } catch (error) { await value.captureFailure(error); throw error; } });
Then<StoryWorld>("the compiler location navigates from the library to the application while preserving its unsaved repair", { timeout: 45_000 },
  async function () { const value = session(this); try { await value.navigateSynchronizedCompilerFailure(); } catch (error) { await value.captureFailure(error); throw error; } });
When<StoryWorld>("the person saves the repair, synchronizes again and leaves a new unsaved source edit", { timeout: 45_000 },
  async function () { const value = session(this); try { await value.saveCompilerRepairAndSynchronize(); } catch (error) { await value.captureFailure(error); throw error; } });
Then<StoryWorld>(
  "JDI stops in the Java callback invoked by Kotlin and resumes execution",
  { timeout: 180_000 },
  async function () {
    const value = session(this);
    try { await value.debugMixedJvmCallback(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "F12 explains the unavailable Kotlin destination and opens the Java control declaration",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try { await value.assertMixedJvmDefinitionNavigation(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "a Maven output directory change blocks member rename until the project is synchronized again",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try { await value.assertMavenMixedJvmMemberRenameAfterResync(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "F12 opens the saved Kotlin type and method declarations from Java",
  { timeout: 150_000 },
  async function () {
    const value = session(this);
    try { await value.assertMixedJvmKotlinDefinitions(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "F12 rejects changed Kotlin source until a rebuild produces matching class files",
  { timeout: 150_000 },
  async function () {
    const value = session(this);
    try { await value.assertMixedJvmKotlinBinaryDriftAndRebuild(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "the IDE refuses member rename when Kotlin consumers cannot be verified",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try { await value.assertMixedJvmMemberRenameRefused(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "debugging the rediscovered method after selecting the first app stops in the second Runner and completes only that test",
  { timeout: 180_000 },
  async function () {
    const value = session(this);
    try {
      await value.debugSecondCompositeTest();
    } catch (error) {
      await value.captureFailure(error);
      throw error;
    }
  },
);
When<StoryWorld>(
  "the person sets breakpoints in both Greeter sources and debugs the first included app",
  { timeout: 180_000 },
  async function () {
    const value = session(this);
    try { await value.debugCompositeLibrary(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "JDI stops in the library loaded from its project JAR and excludes the other Greeter breakpoint",
  { timeout: 90_000 },
  async function () {
    const value = session(this);
    try { await value.assertCompositeLibraryBreakpoint(); } catch (error) { await value.captureFailure(error); throw error; }
  },
);
for (const [text, run] of assertions)
  Then<StoryWorld>(
    text,
    {
      timeout: text.includes("project debugger starts suspended") || text.startsWith("F12 opens the generated Java")
        ? 150_000
        : text.includes("applies Gradle's verified preview option")
          ? 90_000
          : text.startsWith("coverage from the synchronized Gradle integrationTest source set") ||
              text.includes("measured application instructions and lines") ||
              text.includes("external JDT LS opens the exact cross-module declaration") ||
              text.includes("JDT LS F12 fallback") ||
              text.includes("JDT LS Control-click fallback") ||
              text.includes("guarded JDT LS references")
            ? 90_000
            : 30_000,
    },
    async function () {
      const value = session(this);
      try {
        await run(value);
      } catch (error) {
        await value.captureFailure(error);
        throw error;
      }
    },
  );
After<StoryWorld>(
  { tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", timeout: 20_000 },
  async function () {
    const value = sessions.get(this);
    if (!value) return;
    sessions.delete(this);
    try {
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostic = value.diagnostics();
      if (diagnostic) await this.attach(diagnostic, "text/plain");
    }
  },
);

When<StoryWorld>("the person requests main-class discovery with an unsaved Java draft", { timeout: 30_000 }, async function () {
  const value = session(this); try { await value.rejectDirtyMainDiscovery(); } catch(error) { await value.captureFailure(error); throw error; }
});
When<StoryWorld>("the person saves the Java draft, builds, synchronizes again and selects a provider-owned main class", { timeout: 90_000 }, async function () {
  const value = session(this); try { await value.discoverSavedMainAndSelect(); } catch(error) { await value.captureFailure(error); throw error; }
});
When<StoryWorld>("the person runs the chosen main from the Java editor action", { timeout: 30_000 }, async function () {
  const value = session(this); try { await value.runDiscoveredMain(); } catch(error) { await value.captureFailure(error); throw error; }
});

When<StoryWorld>("the person synchronizes again, debugs the file main from the editor, stops on a source line and continues to completion", { timeout: 150_000 }, async function () {
 const value=session(this);try {await value.debugDiscoveredMainAndComplete();}catch(error){await value.captureFailure(error);throw error;}
});

When<StoryWorld>("the person synchronizes, rejects a sibling without main and runs the type at the cursor", {timeout:120_000}, async function(){const value=session(this);try{await value.runCursorMainAndRejectSibling();}catch(error){await value.captureFailure(error);throw error;}});
When<StoryWorld>("the person synchronizes and debugs the enclosing type at the cursor to completion", {timeout:150_000}, async function(){const value=session(this);try{await value.debugDiscoveredMainAndComplete("cursor");}catch(error){await value.captureFailure(error);throw error;}});

Given<StoryWorld>("the Java Git branch GUI has a real Maven reactor and a branch with an additional module", { timeout: 40000 }, async function () {
  if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true || this.targetEvidence.packagedApplication !== false)
    throw new Error("Java Git branch acceptance requires the real release/no-bundle desktop");
  const value = new NativeJavaProjectContextSession(); sessions.set(this, value);
  await value.prepare(true, "maven", "tests", false, false, true);
  await value.prepareGitBranchWorkflow();
});
When<StoryWorld>("the person switches, merges and aborts Java project branches, resynchronizes and runs their tests", { timeout: 150000 }, async function () {
  const value = session(this);
  try { await value.exerciseGitBranchWorkflow(); }
  catch (error) { await value.captureFailure(error); throw error; }
});
Then<StoryWorld>("each branch and merge has its own current module catalog and source buffers and the selected tests pass", async function () {
  const proof = session(this).evidence().javaGitBranchWorkflow;
  if (!proof || Object.values(proof).some(value => value !== true)) throw new Error("The Java Git branch workflow has incomplete native evidence");
});


Given<StoryWorld>("the Java Git branch GUI has a real Gradle build and a branch with an additional project", { timeout: 40000 }, async function () {
  if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true || this.targetEvidence.packagedApplication !== false)
    throw new Error("Gradle Git branch acceptance requires the real release/no-bundle desktop");
  const value = new NativeJavaProjectContextSession(); sessions.set(this, value);
  await value.prepare(true, "gradle", "tests", false, false, false, true);
  await value.prepareGitBranchWorkflow();
});
When<StoryWorld>("the person explicitly synchronizes the Gradle Git branch project", { timeout: 150000 }, async function () {
  const value = session(this);
  try { await value.synchronizeGitBranchProject(); }
  catch (error) { await value.captureFailure(error); throw error; }
});
Then<StoryWorld>("Gradle branch switching, merging and abort send no implicit project evaluation request", async function () {
  const checks = session(this).evidence().javaGitBranchGradleEvaluations;
  if (!checks || checks.length !== 7 || checks.some((check, index) => check.before <= 0 || check.before !== check.after || (index > 0 && check.before <= checks[index - 1]!.after)))
    throw new Error("Gradle branch and merge operations must retain explicit evaluation boundaries");
});

When<StoryWorld>("the person aborts a Java rebase, resolves it again and resynchronizes before running tests", { timeout: 150000 }, async function () {
  const value=session(this); try { await value.exerciseGitRebaseWorkflow(); } catch(error) { await value.captureFailure(error); throw error; }
});
Then<StoryWorld>("rebase abort and continuation retire Java context and the rewritten project passes its tests", async function () {
  const proof=session(this).evidence().javaGitRebaseWorkflow;
  if (!proof || Object.values(proof).some(value => value !== true)) throw Error("Java rebase context evidence is incomplete");
});
Then<StoryWorld>("Gradle rebase operations send no implicit project evaluation request", async function () {
  const checks=session(this).evidence().javaGitRebaseGradleEvaluations;
  if (!checks || checks.length!==6 || checks.some(check => check.before<=0 || check.before!==check.after)) throw Error("Rebase added an implicit Gradle evaluation");
});
