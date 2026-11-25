import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { After, Given, Status, Then, When } from "@cucumber/cucumber";
import { NativeJavaBuildToolsSession } from "../support/native-java-build-tools.js";
import type { StoryWorld } from "../support/world.js";
import type {
  NativeJavaWorkflow,
  NativeJavaTestFramework,
} from "../fixtures/native-java-build-tool-fixtures.js";
const sessions = new WeakMap<StoryWorld, NativeJavaBuildToolsSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native build-tool scenario not prepared");
  return value;
}
async function prepareSession(
  world: StoryWorld,
  tool: string,
  workflow: NativeJavaWorkflow,
  framework: NativeJavaTestFramework = "junit4",
  mavenAggregator = false,
) {
  if (
    world.targetProfile.name !== "desktop" ||
    world.targetProfile.driver !== "tauri-webdriver" ||
    world.targetEvidence?.nativeGui !== true ||
    world.targetEvidence.e2e !== true ||
    !matchesNativeArtifactEvidence(world.targetEvidence)
  )
    throw new Error("build-tool qualification requires matching native desktop artifact evidence");
  if (tool !== "maven" && tool !== "gradle") throw new Error("unselected native Java build tool");
  if (workflow === "ignored-test-jvm" && tool !== "maven")
    throw new Error("ignored Surefire configuration requires Maven");
  if (sessions.has(world)) throw new Error("native build-tool scenario already prepared");
  const value = new NativeJavaBuildToolsSession(tool, workflow, framework, mavenAggregator);
  sessions.set(world, value);
  await value.prepare();
}
Given<StoryWorld>(
  "the native Maven discovery GUI has an aggregator with custom test output and an identically named child test",
  { timeout: 20_000 },
  async function () {
    await prepareSession(this, "maven", "discovery", "junit4", true);
  },
);
Given<StoryWorld>(
  "the native {word} Java GUI has an isolated real project with a pinned JUnit dependency",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "application");
  },
);
Given<StoryWorld>(
  "the native Maven integration-test GUI has an isolated Failsafe project with a custom source root",
  { timeout: 20_000 },
  async function () {
    await prepareSession(this, "maven", "failsafe");
  },
);
Given<StoryWorld>(
  "the native {word} test JVM GUI has an isolated real project with a pinned JUnit dependency",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "test-jvm");
  },
);
Given<StoryWorld>(
  "the native {word} JUnit Jupiter test GUI has an isolated real project",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "test-jvm", "junit5");
  },
);
Given<StoryWorld>(
  "the native {word} TestNG test GUI has an isolated real project",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "test-jvm", "testng");
  },
);
Given<StoryWorld>(
  "the native {word} discovery GUI has an isolated real project with two JUnit methods",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "discovery");
  },
);
Given<StoryWorld>(
  "the native {word} discovery GUI has an isolated real project with JUnit Jupiter method-name groups including overloads",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "discovery", "junit5");
  },
);
Given<StoryWorld>(
  "the native {word} discovery GUI has an isolated real project with two TestNG methods",
  { timeout: 20_000 },
  async function (tool: string) {
    await prepareSession(this, tool, "discovery", "testng");
  },
);
Given<StoryWorld>(
  "the native Maven test JVM GUI has a project with a fixed Surefire argLine",
  { timeout: 20_000 },
  async function () {
    await prepareSession(this, "maven", "ignored-test-jvm");
  },
);
type Step = readonly [string, (session: NativeJavaBuildToolsSession) => Promise<void>, number?];
const actions: Step[] = [
  ["the person rediscovers and requests coverage for the savedSource overloads", (s) => s.coverDiscoveredOverloads(), 60_000],
  ["the person rediscovers and debugs the savedSource overloads until entry suspension", (s) => s.debugDiscoveredOverloads(), 60_000],
  [
    "the person trusts the Maven workspace and requests Run integration tests with coverage",
    (s) => s.trustAndRunIntegrationCoverage(),
  ],
  ["the person trusts the workspace and requests Discover tests", (s) => s.trustAndDiscover()],
  [
    "the person changes the test form and runs the discovered savedSource method-name group",
    (s) => s.runDiscoveredMethod(),
  ],
  [
    "the person enters literal test JVM options independently of an application draft",
    (s) => s.configureTestJvmOptions(),
  ],
  [
    "the person trusts the workspace and runs the saved test JVM configuration",
    (s) => s.trustAndRunTestJvm(),
  ],
  [
    "the person trusts the fixed-argLine workspace and requests Run tests",
    (s) => s.trustAndRunIgnoredTestJvm(),
  ],
  [
    "the production build-tool IDE opens both Java sources with automatic tool detection",
    (s) => s.launch(),
    40_000,
  ],
  [
    "the person edits the build-tool main class through the keyboard without saving",
    (s) => s.editMain(),
  ],
  [
    "the person saves separate application and test configurations and reloads the clean interface",
    (s) => s.saveConfigurationsAndReload(),
    30_000,
  ],
  ["the person trusts the build-tool workspace and requests Build", (s) => s.trustAndBuild()],
  ["the person requests the build-tool main class Run", (s) => s.run()],
  [
    "the person selects the savedSource test method in the chosen project directory",
    (s) => s.selectTest(),
  ],
  ["the person requests Run tests in the build-tool Java activity", (s) => s.test()],
  [
    "the person changes the JUnit expectation through the keyboard and requests Run tests",
    (s) => s.breakTest(),
  ],
  [
    "the person repairs the JUnit expectation and requests Rerun failed tests",
    (s) => s.repairTest(),
  ],
  [
    "the person requests Rerun session for the completed test selection",
    (s) => s.rerunCapturedTestSession(),
  ],
  [
    "the person breaks the main class syntax and requests build-tool Run",
    (s) => s.breakMainAndRun(),
  ],
  [
    "the person repairs the main class and requests build-tool Build",
    (s) => s.repairMainAndBuild(),
  ],
  ["the person closes the clean build-tool IDE through the native X11 protocol", (s) => s.close()],
  ["the person closes the clean build-tool IDE through the native window manager", (s) => s.close()],
  ["the person requests a test method that does not exist", (s) => s.requestMissingTest()],
];
const assertions: Step[] = [
  ["discovery compiles and lists the aggregator tests without building the child or running test bodies", (s) => s.assertMavenAggregatorDiscovery()],
  ["the aggregator test runs a second time with the child still unbuilt", (s) => s.assertDiscoveredMethodPassed(2)],
  ["coverage reports both savedSource overloads and both production branches without running the companion", (s) => s.assertOverloadCoverage(), 60_000],
  ["continuing the debugger executes both overloads and leaves the companion unexecuted", (s) => s.continueDiscoveredOverloads(), 60_000],
  [
    "fresh Failsafe results stay separate from Surefire while JaCoCo reports full verify coverage",
    (s) => s.assertIntegrationCoverage(),
  ],
  [
    "a new integration coverage report preserves the captured Failsafe scope",
    (s) => s.assertIntegrationCoverage(true),
  ],
  [
    "the discovery lists the compiled class and both method-name groups without executing their bodies",
    (s) => s.assertDiscoveryDidNotRun(),
  ],
  [
    "only the discovered method-name group executes using the original session settings",
    (s) => s.assertDiscoveredMethodPassed(),
  ],
  [
    "the real JUnit process uses the selected test JVM options and JDK",
    (s) => s.assertTestJvmPassed(),
  ],
  [
    "the real TestNG process uses the selected test JVM options and JDK",
    (s) => s.assertTestJvmPassed(),
  ],
  [
    "the repaired test rerun retains its original JVM options despite current form edits",
    (s) => s.assertTestJvmRerun(),
  ],
  [
    "the test selection runs again with the captured JVM options",
    (s) => s.assertCapturedTestSessionRerun(),
  ],
  [
    "the passing JUnit report accompanies a visible test configuration failure with tool exit zero",
    (s) => s.assertIgnoredTestJvm(),
  ],
  [
    "the named build-tool settings and selection are restored without workspace trust",
    (s) => s.assertRestoredConfigurations(),
  ],
  [
    "the build-tool actions are untrusted and no execution artifacts exist",
    (s) => s.assertUntrusted(),
  ],
  ["the person requests Rebuild in the build-tool Java activity", (s) => s.rebuild()],
  ["Rebuild removes the old output and recompiles without running the application or tests", (s) => s.assertRebuild()],
  [
    "the detected real build tool saves the main buffer, cleans compiled outputs and rebuilds without running tests",
    (s) => s.assertBuild(),
  ],
  [
    "the build-tool console and append-only application proof show one execution of the saved main class",
    (s) => s.assertRun(),
  ],
  [
    "a real passing JUnit report and test-written proof identify the executed case",
    (s) => s.assertPassedTest(),
  ],
  [
    "the saved test edit produces a nonzero test failure and a new failing JUnit report",
    (s) => s.assertFailedTest(),
  ],
  [
    "the repaired test is saved and a new passing JUnit report proves another execution",
    (s) => s.assertRepairedTest(),
  ],
  [
    "the compiler error opens the selected project source without saving its draft or changing application and test outcomes",
    (s) => s.assertFailedRun(),
  ],
  [
    "the repaired main compiles successfully without an implicit application or test execution",
    (s) => s.assertRepairedBuild(),
  ],
  [
    "the build tool reports a nonzero test failure without executing another case",
    (s) => s.assertMissingTestFailed(),
  ],
  [
    "the build-tool IDE exits with only explicit source saves and unchanged project descriptors",
    (s) => s.assertFinal(),
  ],
];
for (const [text, run, timeout = 30_000] of actions)
  When<StoryWorld>(text, { timeout }, async function () {
    await run(session(this));
  });
for (const [text, run, timeout = 30_000] of assertions)
  Then<StoryWorld>(text, { timeout }, async function () {
    await run(session(this));
  });
After<StoryWorld>(
  {
    tags: "@native-java-build-tools or @native-java-test-jvm-options or @native-java-test-discovery or @native-java-testng-discovery or @native-java-junit5-test-execution or @native-java-testng-test-execution",
    timeout: 20_000,
  },
  async function ({ result }) {
    const value = sessions.get(this);
    if (!value) return;
    sessions.delete(this);
    try {
      if (result?.status === Status.FAILED) await value.captureFailure();
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostic = value.diagnostics();
      if (diagnostic) await this.attach(diagnostic, "text/plain");
    }
  },
);
