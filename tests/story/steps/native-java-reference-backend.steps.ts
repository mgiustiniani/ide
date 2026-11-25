import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaReferenceBackendSession } from "../support/native-java-reference-backend.js";
const sessions = new WeakMap<StoryWorld, NativeJavaReferenceBackendSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw Error("Reference backend is not prepared");
  return value;
}
async function checked(
  world: StoryWorld,
  action: (s: NativeJavaReferenceBackendSession) => Promise<void>,
) {
  const value = session(world);
  try {
    await action(value);
  } catch (error) {
    await value.captureFailure(error);
    throw error;
  }
}
Given<StoryWorld>(
  "the native Java IDE has an isolated Spring MVC and JDBC reference backend",
  { timeout: 30000 },
  async function () {
    const evidence = this.targetEvidence;
    const artifactKind = evidence?.artifactKind;
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      evidence?.nativeGui !== true ||
      (artifactKind !== "release-no-bundle" && artifactKind !== "appimage") ||
      evidence.packagedApplication !== (artifactKind === "appimage")
    )
      throw Error("Reference backend acceptance requires a native release/no-bundle IDE or AppImage");
    const value = new NativeJavaReferenceBackendSession(artifactKind);
    sessions.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the person imports the backend, applies a Java rename and reopens its applied review",
  { timeout: 150000 },
  async function () {
    await checked(this, (s) => s.launchAndRefactor());
  },
);
Then<StoryWorld>(
  "the backend context and original rollback authority remain available after closing the review",
  async function () {
    const p = session(this).evidence();
    if (!p.synchronized || !p.refactorApplied || !p.refactorReopened)
      throw Error("Backend import or applied-refactoring review was not qualified");
  },
);
When<StoryWorld>(
  "the person builds and tests the renamed backend from Java Run",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.buildAndTest());
  },
);
When<StoryWorld>(
  "the person runs the backend and exercises shared live state through the IDE HTTP and database tools",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.runHttpAndDatabase());
  },
);
When<StoryWorld>(
  "the person debugs an IDE HTTP request at its saved Java source breakpoint",
  { timeout: 150000 },
  async function () {
    await checked(this, (s) => s.debugHttpRequest());
  },
);
Then<StoryWorld>(
  "build, JUnit, HTTP, JDBC and JDI use the real backend while preserving the developer draft",
  async function () {
    const p = session(this).evidence();
    if (
      !p.buildPassed ||
      !p.junitTestsPassed ||
      !p.httpFromIde ||
      !p.jdbcSharedState ||
      !p.debugEntry ||
      !p.httpSourceBreakpoint ||
      !p.debugLocalInspected ||
      !p.debugResponseCompleted ||
      !p.runStopped ||
      !p.debugStopped ||
      !p.notesDraftPreserved ||
      !p.sourcePreservedAcrossExecution
    )
      throw Error("The integrated backend workflow is incomplete");
  },
);
When<StoryWorld>(
  "the person cleans backend outputs, reopens Rollback and closes the native Java IDE",
  { timeout: 90000 },
  async function () {
    await checked(this, (s) => s.cleanRollbackAndClose());
  },
);
Then<StoryWorld>(
  "the original backend sources are restored and all owned application JVMs have exited",
  async function () {
    const p = session(this).evidence();
    if (!p.rollbackRestored || !p.cleanExit)
      throw Error("Backend source restoration or close failed");
  },
);
After<StoryWorld>({ tags: "@native-java-reference-backend", timeout: 45000 }, async function () {
  await sessions.get(this)?.dispose();
  sessions.delete(this);
});
