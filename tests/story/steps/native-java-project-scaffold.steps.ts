import assert from "node:assert/strict";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT } from "../support/native-java-project-context.js";
import { NativeJavaProjectScaffoldSession } from "../support/native-java-project-scaffold.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJavaProjectScaffoldSession>();

function session(world: StoryWorld): NativeJavaProjectScaffoldSession {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java Maven scaffold scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the Maven scaffold GUI has an empty isolated workspace",
  { timeout: 30_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error("Java scaffold acceptance requires the native window and matching runner artifact evidence");
    const value = new NativeJavaProjectScaffoldSession();
    sessions.set(this, value);
    await value.prepare();
  },
);

When<StoryWorld>(
  "the person creates Java 27 Maven and both Gradle DSL starters without building them",
  { timeout: 40_000 },
  async function () {
    await session(this).createJava27StartersWithoutBuild();
  },
);

When<StoryWorld>(
  "the harness bootstraps the pinned distributions and builds, tests, and runs all three starters through their wrappers with JDK 27",
  { timeout: 1_450_000 },
  async function () {
    await session(this).buildTestAndRunJava27StarterWrappers();
    assert.equal(session(this).evidence().java27PinnedWrappersBootstrapped, true);
  },
);

When<StoryWorld>(
  "the person opens the Java Project panel and Maven project wizard",
  { timeout: 40_000 },
  async function () {
    await session(this).openWizard();
  },
);

When<StoryWorld>(
  "the person creates Maven Java 8 and 27, Gradle Groovy DSL, Gradle Kotlin DSL, and Spring Boot MVC Maven and Gradle starters and attempts to reuse the Maven and Groovy project folders",
  { timeout: 40_000 },
  async function () {
    await session(this).createStarterAndRefuseDuplicate();
  },
);

When<StoryWorld>(
  "the person opens the Maven project wizard with a capable RefactorKit daemon",
  { timeout: 40_000 },
  async function () {
    await session(this).openWizard({ refactorKit: true });
  },
);

When<StoryWorld>(
  "the person creates a Maven Spring Boot MVC starter without compiling it",
  { timeout: 40_000 },
  async function () {
    await session(this).createSpringBootMvcStarter();
  },
);

Then<StoryWorld>(
  "the person tests, runs and stops the generated Spring Boot application from Java Run",
  { timeout: 390_000 },
  async function () {
    const value = session(this);
    await value.testAndRunSpringBootStarter();
    assert.equal(value.evidence().springBootStarterTestedFromJavaRun, true);
    assert.equal(value.evidence().springBootStarterRanFromJavaRun, true);
  },
);

When<StoryWorld>(
  "the person opens the Gradle project wizard with a capable RefactorKit daemon",
  { timeout: 40_000 },
  async function () {
    await session(this).openWizard({ refactorKit: true, buildTool: "gradle" });
  },
);

When<StoryWorld>(
  "the person creates a Gradle Spring Boot MVC starter using {string} without compiling it",
  { timeout: 40_000 },
  async function (dsl: string) {
    assert.ok(dsl === "groovy" || dsl === "kotlin");
    await session(this).createSpringBootGradleStarter(dsl);
  },
);

Then<StoryWorld>(
  "the person tests, runs and stops the generated {string} Spring Boot application from Java Run",
  { timeout: 480_000 },
  async function (dsl: string) {
    assert.ok(dsl === "groovy" || dsl === "kotlin");
    const value = session(this);
    await value.testAndRunSpringBootStarter(dsl);
    assert.equal(value.evidence().springBootStarterTestedFromJavaRun, true);
    assert.equal(value.evidence().springBootStarterRanFromJavaRun, true);
  },
);

When<StoryWorld>(
  "the person creates Java 26 Maven and Gradle starters without building them",
  { timeout: 40_000 },
  async function () {
    await session(this).createJava26StartersWithoutBuild();
  },
);

When<StoryWorld>(
  "the harness explicitly builds, tests, and runs the generated Java 26 Maven and Gradle starters offline with JDK 26",
  { timeout: 660_000 },
  async function () {
    await session(this).buildTestAndRunJava26Starters();
  },
);

When<StoryWorld>(
  "the harness bootstraps both pinned wrappers into empty caches and builds, tests, and runs the starters with JDK 26",
  { timeout: 1_260_000 },
  async function () {
    await session(this).buildTestAndRunJava26Starters(true);
    assert.equal(session(this).evidence().java26PinnedWrappersBootstrapped, true);
  },
);

Then<StoryWorld>(
  "the native workspace contains Java 26 Maven and Gradle starters with no build output",
  function () {
    const evidence = session(this).evidence();
    assert.equal(evidence.java26StarterCreated, true);
    assert.equal(evidence.java26StarterWrapperCreated, true);
    assert.equal(evidence.java26GradleStarterCreated, true);
    assert.equal(evidence.java26GradleWrapperCreated, true);
    assert.equal(evidence.java26ProjectTreeRefreshed, true);
    assert.equal(evidence.java26StarterUnbuilt, true);
  },
);

Then<StoryWorld>(
  "both Java 26 starters pass their tests, run, and emit Java 26 class files",
  function () {
    const evidence = session(this).evidence();
    assert.equal(evidence.java26StartersBuiltTestedAndRun, true);
    assert.equal(evidence.java26Builds.length, 2);
    for (const build of evidence.java26Builds) {
      assert.equal(build.jdkMajor, 26);
      assert.equal(build.classFileMajor, 70);
      assert.equal(build.testCases, 1);
      assert.match(build.applicationOutput, /Hello from java26-/);
    }
  },
);

Then<StoryWorld>(
  "the native workspace contains the starter sources, pinned build wrappers and visible project folder",
  function () {
    assert.equal(session(this).evidence().starterCreated, true);
    assert.equal(session(this).evidence().springBootStarterCreated, true);
    assert.equal(session(this).evidence().springBootGradleStartersCreated, true);
    assert.equal(session(this).evidence().springBootSynchronizationRequiresJdk, true);
    assert.equal(session(this).evidence().springBootGradleSynchronizationRequiresJdk, true);
    assert.equal(session(this).evidence().java27StarterCreated, true);
    assert.equal(session(this).evidence().java27GradleStartersCreated, true);
    assert.equal(session(this).evidence().gradleMultiModuleCreated, true);
    assert.equal(session(this).evidence().gradleKotlinDslCreated, true);
    assert.equal(session(this).evidence().mavenWrapperCreated, true);
    assert.equal(session(this).evidence().java27WrapperCreated, true);
    assert.equal(session(this).evidence().gradleGroovyWrapperCreated, true);
    assert.equal(session(this).evidence().gradleKotlinWrapperCreated, true);
    assert.equal(session(this).evidence().projectTreeRefreshed, true);
  },
);

Then<StoryWorld>(
  "all generated projects have no build output and require an explicitly selected JDK for synchronization",
  function () {
    assert.equal(session(this).evidence().synchronizationRequiresJdk, true);
    assert.equal(session(this).evidence().gradleSynchronizationRequiresJdk, true);
    assert.equal(session(this).evidence().kotlinGradleSynchronizationRequiresJdk, true);
    assert.equal(session(this).evidence().java27GradleSynchronizationRequiresJdk, true);
    assert.equal(session(this).evidence().java27KotlinGradleSynchronizationRequiresJdk, true);
  },
);

Then<StoryWorld>(
  "the refused duplicates leave the Maven and Groovy projects unchanged",
  function () {
    assert.equal(session(this).evidence().existingProjectPreserved, true);
    assert.equal(session(this).evidence().gradleExistingProjectPreserved, true);
  },
);

When<StoryWorld>(
  "the harness builds, tests, and launches the generated Java 8 Maven and Java 21 Gradle starters offline",
  { timeout: 660_000 },
  async function () {
    await session(this).buildTestAndRunCompatibleStarters();
  },
);

Then<StoryWorld>(
  "the Maven, Gradle and Spring Boot starter builds pass their generated tests, print greetings and verify the HTTP endpoint",
  function () {
    const builds = session(this).evidence().scaffoldBuilds;
    const evidence = session(this).evidence();
    assert.equal(evidence.generatedProjectsBuiltTestedAndRun, true);
    assert.equal(evidence.springBootStarterBuiltTested, true);
    assert.equal(evidence.springBootEndpointResponse, "Hello from spring-boot-native-starter!");
    assert.deepEqual(
      evidence.springBootGradleBuilds.map(({ dsl }) => dsl),
      ["groovy", "kotlin"],
    );
    for (const bootBuild of evidence.springBootGradleBuilds) {
      assert.equal(bootBuild.testCases, 1);
      assert.equal(bootBuild.endpointResponse, `Hello from ${bootBuild.project}!`);
    }
    assert.equal(builds.length, 9);
    assert.deepEqual(
      builds.map(({ project }) => project),
      [
        "native-starter",
        "gradle-native-starter",
        "gradle-kotlin-starter",
        "spring-boot-native-starter",
        "spring-boot-gradle-groovy-starter",
        "spring-boot-gradle-kotlin-starter",
        "java27-starter",
        "gradle-java27-starter",
        "gradle-kotlin-java27-starter",
      ],
    );
    for (const build of builds) {
      assert.ok(build.testCases > 0);
      assert.match(build.applicationOutput, /^Hello from .+!$/);
    }
  },
);

When<StoryWorld>(
  "the harness builds, tests, and launches the generated Java 27 Maven starter offline with JDK 27",
  { timeout: 240_000 },
  async function () {
    await session(this).buildTestAndRunJava27MavenStarter();
  },
);

When<StoryWorld>(
  "the person creates Java 27 Gradle Groovy and Kotlin DSL starters",
  { timeout: 40_000 },
  async function () {
    await session(this).createJava27GradleStarters();
  },
);

Then<StoryWorld>(
  "the Java 27 Maven starter passes its JUnit test and emits Java 27 class files",
  function () {
    const evidence = session(this).evidence();
    assert.equal(evidence.java27StarterBuiltTestedAndRun, true);
    assert.equal(evidence.java27StarterJdkMajor, 27);
    assert.equal(evidence.java27StarterClassFileMajor, 71);
    const build = evidence.scaffoldBuilds.find(({ project }) => project === "java27-starter");
    assert.ok(build);
    assert.equal(build.release, 27);
    assert.equal(build.testCases, 1);
    assert.equal(build.applicationOutput, "Hello from java27-starter!");
  },
);

When<StoryWorld>(
  "the harness builds, tests, and launches the generated Java 27 Gradle Groovy and Kotlin DSL starters offline with JDK 27",
  { timeout: 300_000 },
  async function () {
    await session(this).buildTestAndRunJava27GradleStarters();
  },
);

Then<StoryWorld>(
  "the Java 27 Gradle starters pass their JUnit tests and emit Java 27 class files",
  function () {
    const builds = session(this).evidence().java27GradleBuilds;
    assert.equal(builds.length, 2);
    assert.deepEqual(
      builds.map(({ project, dsl }) => [project, dsl]),
      [
        ["gradle-java27-starter", "groovy"],
        ["gradle-kotlin-java27-starter", "kotlin"],
      ],
    );
    for (const build of builds) {
      assert.equal(build.jdkMajor, 27);
      assert.equal(build.classFileMajor, 71);
      assert.equal(build.testCases, 1);
      assert.equal(build.applicationOutput, `Hello from ${build.project}!`);
    }
  },
);

When<StoryWorld>("the person closes the Maven scaffold IDE", async function () {
  await session(this).close();
});

Then<StoryWorld>(
  "the native window exits cleanly and the scenario environment is restored",
  { timeout: 10_000 },
  async function () {
    await session(this).assertFinal();
  },
);

After<StoryWorld>(
  {
    tags: `@${JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT} and (@native-java-project-scaffold or @native-java26-scaffold or @native-java26-scaffold-build or @native-java26-scaffold-wrapper-build or @native-java27-scaffold-wrapper-build)`,
    timeout: 20_000,
  },
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
