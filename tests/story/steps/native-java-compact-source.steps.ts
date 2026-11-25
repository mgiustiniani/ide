import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaCompactSourceSession } from "../support/native-java-compact-source.js";
const sessions = new WeakMap<StoryWorld, NativeJavaCompactSourceSession>();
function session(world: StoryWorld) {
  const s = sessions.get(world);
  if (!s) throw Error("Compact source fixture is not prepared");
  return s;
}
async function checked(
  world: StoryWorld,
  action: (s: NativeJavaCompactSourceSession) => Promise<void>,
) {
  const s = session(world);
  try {
    await action(s);
  } catch (error) {
    await s.captureFailure(error);
    throw error;
  }
}
Given<StoryWorld>(
  "an isolated native {word} workspace targets Java 21 and has a selected JDK 25",
  { timeout: 30000 },
  async function (buildTool: string) {
    if (buildTool !== "Maven" && buildTool !== "Gradle") throw Error("Unknown compact-source build tool");
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw Error("Compact-source acceptance requires the native release/no-bundle desktop");
    const s = new NativeJavaCompactSourceSession();
    sessions.set(this, s);
    await s.prepare(buildTool);
  },
);
When<StoryWorld>(
  "the person synchronizes the project and attempts a compact source below Java 25",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.launchAndRefuse());
  },
);
Then<StoryWorld>(
  "the incompatible compact-source request preserves files, editor tabs and the form",
  async function () {
    const p = session(this).evidence();
    if (!p.lowerReleaseRefused || !p.refusalPreservedFilesAndTabs)
      throw Error("Compact source compatibility refusal was not qualified");
  },
);
When<StoryWorld>(
  "the person upgrades the {word} release to 25 and creates a compact source beside another unsaved draft",
  { timeout: 60000 },
  async function (buildTool: string) {
    if (session(this).evidence().buildTool !== buildTool.toLowerCase()) throw Error("Compact-source build tool changed");
    await checked(this, (s) => s.upgradeAndCreate());
  },
);
Then<StoryWorld>(
  "the captured compact draft compiles without saving it or the unrelated draft",
  async function () {
    const p = session(this).evidence();
    if (
      !p.releaseUpgradedThroughEditor ||
      !p.compactWizardUsed ||
      !p.implicitContextualNameAccepted ||
      !p.diskInitiallyEmpty ||
      !p.templateCapturedAndCompiled ||
      !p.notesDraftPreserved
    )
      throw Error("Compact source draft creation did not preserve the source boundaries");
  },
);
When<StoryWorld>(
  "the person saves, builds and manually runs the compact instance main through Java Run",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.buildAndRun());
  },
);
Then<StoryWorld>(
  "the real JDK 25 launches the compiled compact source and preserves its inputs",
  async function () {
    const p = session(this).evidence();
    if (
      !p.savedSourceMatches ||
      !p.buildPassed ||
      !p.classMajor25 ||
      !p.manualMainRunPassed ||
      !p.inputsPreserved
    )
      throw Error("Compact-source build and manual launch are incomplete");
  },
);
When<StoryWorld>(
  "the person discovers the compact instance main with Java 25 launcher rules and runs the selected candidate",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.discoverAndRun());
  },
);
Then<StoryWorld>(
  "the provider-owned compact class replaces the incorrect launch class and completes successfully",
  async function () {
    const p = session(this).evidence();
    if (!p.modernProviderCandidateSelected || !p.discoveredMainRunPassed || !p.inputsPreserved)
      throw Error("Java 25 provider discovery and selected-candidate execution are incomplete");
  },
);
When<StoryWorld>(
  "the person runs the compact main from its saved editor file using Java 25 launcher rules",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.runCompactFromEditor());
  },
);
Then<StoryWorld>(
  "the editor file action executes the provider-owned compact class with the selected JDK",
  async function () {
    if (!session(this).evidence().compactEditorFileRunPassed)
      throw Error("The compact editor file action did not execute its provider-owned main");
  },
);
When<StoryWorld>(
  "the person debugs the compact instance main at its saved source breakpoint",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.debug());
  },
);
Then<StoryWorld>(
  "JDI exposes the compact receiver and local value before the instance main completes",
  async function () {
    const p = session(this).evidence();
    if (!p.debugCandidateSelected || !p.compactEditorCursorDebugPassed || !p.jdiEntry || !p.instanceMainBreakpoint || !p.localAndThisInspected || !p.debugCompleted)
      throw Error("Compact-source JDI acceptance is incomplete");
  },
);
When<StoryWorld>(
  "the person selects the inherited-main profile and runs the provider-owned child class",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.runInheritedMain());
  },
);
Then<StoryWorld>(
  "the inherited profile omits the compact instance main and the real JVM launches the child",
  async function () {
    const p = session(this).evidence();
    if (!p.inheritedProfileExcludesCompactInstance || !p.inheritedLaunchOwnerSelected || !p.inheritedMainRunPassed)
      throw Error("Inherited main discovery and child launch are incomplete");
  },
);
When<StoryWorld>(
  "the person requests main launch inside a dormant inner type and then debugs the inheriting child at the cursor",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.debugInheritedCursorAndRejectInner());
  },
);
Then<StoryWorld>(
  "the inner type starts no session and JDI exposes the parent main before the child launch completes",
  async function () {
    const p = session(this).evidence();
    if (!p.dormantInnerDoesNotLaunchOuter || !p.inheritedDeclaringFrameAndLocal || !p.inheritedCursorDebugPassed)
      throw Error("Inherited cursor Debug and no-main inner-type refusal are incomplete");
  },
);
When<StoryWorld>(
  "the person checks and repairs a compact Java 25 draft through language-service and SDK compiler diagnostics",
  { timeout: 120000 },
  async function () {
    await checked(this, (s) => s.verifyCompactDiagnostics());
  },
);
Then<StoryWorld>(
  "both diagnostic providers track the compact draft without saving sources or rebuilding the project",
  async function () {
    const p = session(this).evidence();
    if (!p.compactJdtDraftError || !p.compactJdtRepairWarning || !p.compactSdkDraftError || !p.compactSdkRepair || !p.compactDiagnosticsReadOnly)
      throw Error("Compact Java25 diagnostic and repair qualification is incomplete");
    if (p.buildTool === "gradle" && !p.gradleDiagnosticsNoEvaluation)
      throw Error("Compact compiler checks must retain the evaluated Gradle model");
  },
);
When<StoryWorld>(
  "the person closes the compact-source native IDE",
  { timeout: 20000 },
  async function () {
    await checked(this, (s) => s.close());
  },
);
Then<StoryWorld>(
  "the compact source and {word} inputs remain saved and all owned JVMs exit",
  async function (buildTool: string) {
    const p = session(this).evidence();
    if (p.buildTool !== buildTool.toLowerCase()) throw Error("Compact-source build tool changed");
    if (!p.inputsPreserved || !p.cleanExit)
      throw Error("Compact-source close or input preservation failed");
  },
);
After<StoryWorld>({ tags: "@native-java-compact-source", timeout: 45000 }, async function () {
  await sessions.get(this)?.dispose();
  sessions.delete(this);
});
