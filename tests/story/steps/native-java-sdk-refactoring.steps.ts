import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { NativeJavaProjectContextSession } from "../support/native-java-project-context.js";
import type { StoryWorld } from "../support/world.js";

const requirement = "REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001";
const sessions = new WeakMap<StoryWorld, NativeJavaProjectContextSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("Native SDK refactoring scenario not prepared");
  return value;
}
async function prepareSession(
  world: StoryWorld,
  sourceRootMoveFixture = false,
  savedImportsFixture = false,
  referencedSafeDeleteFixture = false,
  buildTool: "maven" | "gradle" = "maven",
  gradlePackageMoveFixture = false,
  extractConstantFixture = false,
  extractVariableFixture = false,
  parameterReorderFixture = false,
  extractMethodFixture = false,
  mavenModuleCreatePreview = false,
  makeStaticFixture = false,
  publicParameterReorderRefusalFixture = false,
  encapsulateFieldFixture = false,
  extractVariableInitializerFixture = false,
  extractInterfaceFixture = false,
  extractSuperclassFixture = false,
  projectFixtureOverrides: {
    referenceWorkflow?: boolean;
    inlineRefactoringFixture?: boolean;
    parameterObjectFixture?: boolean;
    extractDelegateFixture?: boolean;
    gradleClassMoveFixture?: boolean;
    extractParameterFixture?: boolean;
    extractFieldFixture?: boolean;
    moveMemberFixture?: "static-method" | "instance-method";
    pullUpMemberFixture?: boolean;
    pushDownMemberFixture?: boolean;
    parameterRemovalFixture?: boolean;
    parameterHierarchyFixture?: boolean;
    functionalReferencesFixture?: "static" | "instance";
    constructorSelectionFixture?: boolean;
    fieldTypeFixture?: "private" | "public";
    constructorReferencesFixture?: boolean;
    constructorDelegationFixture?: boolean;
    constructorSignatureFixture?: "rename" | "add" | "reorder" | "remove" | "type";
    signatureHierarchyOperation?: "reorder" | "remove" | "type";
    jpaQueryFixture?: boolean | "managed";
    makePublicFixture?:
      "final-method" | "non-final-method-in-final-class" | "non-final-method-in-open-class";
  } = {},
) {
  if (
    world.targetProfile.driver !== "tauri-webdriver" ||
    world.targetEvidence?.nativeGui !== true ||
    world.targetEvidence.e2e !== true ||
    !matchesNativeArtifactEvidence(world.targetEvidence)
  )
    throw new Error("SDK refactoring acceptance requires the real native GUI and matching runner artifact evidence");
  const value = new NativeJavaProjectContextSession(requirement);
  sessions.set(world, value);
  await value.prepare(
    projectFixtureOverrides.referenceWorkflow ?? false,
    buildTool,
    undefined,
    sourceRootMoveFixture,
    projectFixtureOverrides.referenceWorkflow ?? false,
    false,
    false,
    false,
    savedImportsFixture,
    referencedSafeDeleteFixture,
    {
      gradlePackageMoveFixture,
      formatterProfileFixture: savedImportsFixture,
      extractConstantFixture,
      extractVariableFixture,
      extractMethodFixture,
      parameterReorderFixture,
      publicParameterReorderRefusalFixture,
      mavenModuleCreatePreview,
      makeStaticFixture,
      encapsulateFieldFixture,
      extractVariableInitializerFixture,
      extractInterfaceFixture,
      extractSuperclassFixture,
      ...projectFixtureOverrides,
    },
  );
}
async function prepareExpressionExtractionSession(
  world: StoryWorld,
  operation: "parameter" | "field",
) {
  await prepareSession(
    world,
    false,
    false,
    false,
    "maven",
    false, // Gradle package move
    false, // Extract Constant
    false, // Extract Variable
    false, // Parameter reorder
    false, // Extract Method
    false, // Maven module creation
    false, // Make Static
    false, // Public parameter-reorder refusal
    false, // Encapsulate Field
    false, // Extract Variable initializer
    false, // Extract Interface
    false, // Extract Superclass
    operation === "parameter" ? { extractParameterFixture: true } : { extractFieldFixture: true },
  );
}

Given<StoryWorld>(
  /^the SDK refactoring GUI has a real Maven project with (a Spring Data JPQL field reference|a closed Spring Data JPQL query) and a capable daemon$/,
  { timeout: 40_000 },
  async function (fixture: string) {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { jpaQueryFixture: fixture === "a closed Spring Data JPQL query" ? "managed" : true },
    );
  },
);

When<StoryWorld>(
  "the person reviews applies and rolls back the JPQL rename while the query returns the same result",
  { timeout: 210_000 },
  async function () {
    await session(this).applyAndRollbackManagedJpqlRename();
  },
);

Given<StoryWorld>(
  /^the same entity declares a (static|computed) JPA named query for the field$/,
  { timeout: 10_000 },
  async function (kind: "static" | "computed") {
    await session(this).addNamedJpqlQuery(kind);
  },
);

When<StoryWorld>(
  "the person applies and rolls back the JPQL rename with both queries returning the same result",
  { timeout: 210_000 },
  async function () {
    await session(this).applyAndRollbackManagedJpqlRename("User.readNamed");
  },
);

Then<StoryWorld>(
  "the JPQL rename keeps Apply unavailable when a compiled class exists",
  { timeout: 150_000 },
  async function () {
    await session(this).assertManagedJpqlRefusesCompiledOutput();
  },
);

Then<StoryWorld>(
  "the named-query rename shows all references and keeps Apply unavailable with a compiled class",
  { timeout: 150_000 },
  async function () {
    await session(this).assertManagedJpqlRefusesCompiledOutput("User.readNamed");
  },
);

Then<StoryWorld>(
  "the computed named-query rename shows the Spring Data references and keeps Apply unavailable",
  { timeout: 90_000 },
  async function () {
    await session(this).assertManagedJpqlRefusesComputedNamedQuery();
  },
);

Given<StoryWorld>(
  "the Maven project contains uninspected JPQL mapping and query resources",
  { timeout: 10_000 },
  async function () {
    await session(this).addUninspectedJpqlResources();
  },
);
Then<StoryWorld>(
  "the rename review names each uninspected resource and withholds Apply",
  { timeout: 90_000 },
  async function () {
    await session(this).reviewUninspectedJpqlResources();
  },
);

Given<StoryWorld>(
  "the SDK refactoring GUI has a real Gradle project for Add Module using {string} settings and a capable daemon",
  { timeout: 40_000 },
  async function (dsl: string) {
    if (dsl !== "groovy" && dsl !== "kotlin")
      throw new Error(`Unsupported Gradle settings DSL fixture: ${dsl}`);
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true
    )
      throw new Error("Gradle Add Module acceptance requires the real native GUI");
    const value = new NativeJavaProjectContextSession(requirement);
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
        gradleModuleCreatePreview: true,
        gradleModuleCreateDsl: dsl,
      },
    );
  },
);

When<StoryWorld>(
  "the person opens and explicitly evaluates the Gradle project for module creation",
  { timeout: 240_000 },
  async function () {
    await session(this).launchAndEvaluateGradleModuleCreateProject();
  },
);

When<StoryWorld>(
  "the person previews applies builds and rolls back Gradle Add Module",
  { timeout: 240_000 },
  async function () {
    await session(this).applyVerifyAndRollbackGradleModuleCreate();
  },
);

Then<StoryWorld>(
  "Gradle Add Module compiles an applied-source copy and rollback restores the original project",
  async function () {
    await session(this).assertGradleModuleCreateAppliedAndRolledBack();
  },
);

Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven reactor for Add Module and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a selected constant expression and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "maven", false, true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with inline local and constant fixtures and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      {
        inlineRefactoringFixture: true,
      },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a Maven method with two adjacent parameters and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this, false, false, false, "maven",
      false, false, false, false, false, false, false, false, false, false, false, false,
      { parameterObjectFixture: true },
    );
  },
);
for (const [caption, tool] of [["Maven", "maven"], ["Gradle", "gradle"]] as const) {
  Given<StoryWorld>(
    `the SDK refactoring GUI has a ${caption} class with private static helpers and a capable daemon`,
    { timeout: 40_000 },
    async function () {
      await prepareSession(
        this, false, false, false, tool,
        false, false, false, false, false, false, false, false, false, false, false, false,
        { extractDelegateFixture: true },
      );
    },
  );
}
Given<StoryWorld>(
  "the IDE discovers RefactorKit through the test user's standard installation",
  async function () {
    await session(this).useStandardRefactorKitInstallation();
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a selected return expression and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "maven", false, false, true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a selected local initializer and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real {word} project with binding-aware Extract Method data flow and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string) {
    if (tool !== "Maven" && tool !== "Gradle") throw new Error(`Unknown build tool: ${tool}`);
    await prepareSession(this, false, false, false, tool === "Gradle" ? "gradle" : "maven", false, false, false, false, true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a two-parameter method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "maven", false, false, false, true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with an unused method parameter and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { parameterRemovalFixture: true },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a public two-parameter method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with an isolated private method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a final private method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { makePublicFixture: "final-method" },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a final private method and a source-built RefactorKit LSP",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { makePublicFixture: "final-method" },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a non-final private method in a final class and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { makePublicFixture: "non-final-method-in-final-class" },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a non-final private method in an extensible class and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { makePublicFixture: "non-final-method-in-open-class" },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a bound parameterized field and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a supported public class method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a supported superclass extraction method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a {string} Move Member method and a capable daemon",
  { timeout: 40_000 },
  async function (shape: string) {
    if (shape !== "static-method" && shape !== "instance-method") throw new Error(`Unsupported Move Member fixture: ${shape}`);
    await prepareSession(this, false, false, false, "maven", false, false, false, false, false, false, false, false, false, false, false, false, { moveMemberFixture: shape });
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with one supported Pull Up Method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { pullUpMemberFixture: true },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with one supported Push Down Method and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(
      this,
      false,
      false,
      false,
      "maven",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      { pushDownMemberFixture: true },
    );
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with one supported Extract Parameter call site and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareExpressionExtractionSession(this, "parameter");
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with one supported Extract Field expression and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareExpressionExtractionSession(this, "field");
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven reference project with an unused import, workspace formatter profile and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, true);
  },
);
Given<StoryWorld>(
  "the SDK cleanup GUI has a real Gradle reference project with an unused import and a capable daemon",
  { timeout: 40_000 },
  async function () { await prepareSession(this, false, true, false, "gradle"); },
);
When<StoryWorld>(
  "the person opens builds and synchronizes the Gradle Java cleanup project",
  { timeout: 240_000 },
  async function () {
    try { await session(this).launchGradleForJavaCleanup(); }
    catch (error) { await session(this).captureFailure(error); throw error; }
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven reference project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Gradle reference project for draft recovery",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "gradle");
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with a referenced Java type and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Gradle multi-module project and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "gradle", true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real {word} package migration project and a capable daemon",
  { timeout: 40_000 },
  async function (tool: string) {
    assert.ok(tool === "Maven" || tool === "Gradle");
    const gradle = tool === "Gradle";
    await prepareSession(this, false, false, false, gradle ? "gradle" : "maven", gradle);
    await session(this).preparePackageMoveTextControl();
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Gradle multi-module project with an unreferenced Java type and a capable daemon",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "gradle");
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Gradle multi-module project with an application class used by another application source",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "gradle", false, false, false,
      false, false, false, false, false, false, false, false, false, { gradleClassMoveFixture: true });
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a six-module {word} project and a standard RefactorKit installation",
  { timeout: 40_000 },
  async function (tool: string) {
    if (tool !== "maven" && tool !== "gradle") throw new Error(`Unknown build tool: ${tool}`);
    await prepareSession(this, false, false, tool === "maven", tool, false, false, false,
      false, false, false, false, false, false, false, false, false,
      { referenceWorkflow: true, gradleClassMoveFixture: tool === "gradle" });
    await session(this).useStandardRefactorKitInstallation();
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Maven project with two Build Helper custom source roots in one module",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, true);
  },
);
Given<StoryWorld>(
  "the SDK refactoring GUI has a real Gradle project with two source roots in one module",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, true, false, false, "gradle");
  },
);
const actions: readonly [
  string,
  (value: NativeJavaProjectContextSession) => Promise<void>,
  number?,
][] = [
  [
    "the person introduces a parameter object from the saved method cursor, verifies the Maven copy and rolls back",
    (s) => s.applyRollbackParameterObject(),
    150_000,
  ],
  [
    "the person extracts the helper group into a delegate, tests the applied copy and rolls back",
    (s) => s.applyRollbackExtractDelegate(),
    180_000,
  ],
  [
    "the person closes the IDE, upgrades RefactorKit and reopens the same project",
    (s) => s.restartAfterInlineMethodProviderUpgrade(),
    120_000,
  ],
  [
    "the person opens a saved Java source and synchronizes its selected project JDK",
    (s) => s.launchSavedForRefactoring(),
    180_000,
  ],
  [
    "the person opens a saved Java source and builds and evaluates its Gradle project",
    (s) => s.launchSavedForRefactoring(true),
    240_000,
  ],
  [
    "the person builds and tests the synchronized application in Java Run",
    (s) => s.buildAndTestReferenceWorkflow(),
    150_000,
  ],
  [
    "the person opens the generated Java method from its call site with F12",
    (s) => s.navigateToReferenceGeneratedMethod(),
    150_000,
  ],
  [
    "the person debugs the application, stops at the saved source breakpoint and continues to completion",
    (s) => s.debugReferenceWorkflow(),
    150_000,
  ],
  [
    "the person moves a referenced Java class to the library, verifies the changed project and rolls it back",
    (s) => s.moveReferenceWorkflowClass(),
    180_000,
  ],
  [
    "the person runs the restored application and verifies its selected JDK and generated and runtime dependencies",
    (s) => s.runRestoredReferenceWorkflow(),
    120_000,
  ],
  [
    "the person opens a saved Java source, compiles the Gradle project and synchronizes its selected project JDK",
    (s) => s.launchSavedForRefactoring(true),
    180_000,
  ],
  [
    "the person applies and rolls back Extract Constant from the selected Monaco expression",
    (s) => s.applyRollbackExtractConstant(),
    120_000,
  ],
  [
    "the person applies and rolls back Inline Variable from the selected Java identifier",
    (s) => s.applyRollbackInlineRefactoring("inlineVariable"),
    120_000,
  ],
  [
    "the person applies and rolls back Inline Constant from the selected Java identifier",
    (s) => s.applyRollbackInlineRefactoring("inlineConstant"),
    240_000,
  ],
  [
    "the person applies and rolls back Inline Method from the saved Java cursor",
    (s) => s.applyRollbackInlineRefactoring("inlineMethod"),
    180_000,
  ],
  [
    "the person applies and rolls back Extract Variable from a selected Monaco return subexpression",
    (s) => s.applyRollbackExtractVariable(),
    120_000,
  ],
  [
    "the person applies and rolls back Extract Variable from a selected Monaco local initializer",
    (s) => s.applyRollbackExtractVariable(),
    120_000,
  ],
  [
    "the person applies and rolls back Extract Method from selected Monaco statements with conditional data flow and a checked exception",
    (s) => s.applyRollbackExtractMethod(),
    240_000,
  ],
  [
    "the person applies and rolls back parameter reordering from the Monaco cursor",
    (s) => s.applyRollbackParameterReordering(),
    180_000,
  ],
  [
    "the person applies and rolls back parameter renaming from the Monaco cursor",
    (s) => s.applyRollbackParameterRename(),
    180_000,
  ],
  [
    "a compiled Maven output changes outside the IDE after the person opens the parameter-reorder dialog",
    (s) => s.changeCompiledMavenOutputOutsideTheIde(),
    60_000,
  ],
  [
    "the person attempts to preview the parameter reorder against the stale snapshot",
    (s) => s.previewParameterReorderingAgainstStaleSnapshot(),
    60_000,
  ],
  [
    "the person previews parameter reordering from the Monaco cursor",
    (s) => s.previewPublicParameterReorderRefusal(),
    60_000,
  ],
  [
    "the person restores the Maven output and explicitly resynchronizes the project",
    (s) => s.restoreMavenOutputAndResynchronize(),
    60_000,
  ],
  [
    "the person makes an isolated Java method static from the Monaco cursor and rolls it back",
    (s) => s.applyRollbackMakeStatic(),
    180_000,
  ],
  [
    "the person makes a final Java method public from the Monaco cursor and rolls it back",
    (s) => s.applyRollbackMakePublic(),
    180_000,
  ],
  [
    "the person reviews and applies RefactorKit LSP Make Public to the editor buffer without saving the source",
    (s) => s.applyLspVisibilityChangeToEditorBuffer(),
    120_000,
  ],
  [
    "the person makes a non-final Java method public from the Monaco cursor and rolls it back",
    (s) => s.applyRollbackMakePublic(),
    180_000,
  ],
  [
    "the person previews Make Public for a non-final private method in an extensible class",
    (s) => s.previewMakePublicExtensibleClassRefusal(),
    60_000,
  ],
  [
    "the person extracts an interface from the saved Java class cursor and rolls it back",
    (s) => s.applyRollbackExtractInterface(),
    180_000,
  ],
  [
    "the person extracts a superclass from the saved Java class cursor and rolls it back",
    (s) => s.applyRollbackExtractSuperclass(),
    180_000,
  ],
  [
    "the person selects a Java destination type and applies verifies and rolls back Move Member",
    (s) => s.reviewMoveMember(),
    180_000,
  ],
  [
    "the person selects a Java destination type and reviews the unsupported instance member move",
    (s) => s.reviewMoveMember(true),
    180_000,
  ],
  [
    "the person applies and rolls back Pull Up Method from the saved Java cursor",
    (s) => s.applyRollbackPullUpMember(),
    180_000,
  ],
  [
    "the person applies and rolls back Push Down Method from the saved Java cursor",
    (s) => s.applyRollbackPushDownMember(),
    180_000,
  ],
  [
    "the person extracts the selected return expression into a parameter and rolls it back",
    (s) => s.applyRollbackExtractParameter(),
    180_000,
  ],
  [
    "the person extracts the selected constant expression into an instance field and rolls it back",
    (s) => s.applyRollbackExtractField(),
    180_000,
  ],
  [
    "the person applies and rolls back Encapsulate Field from the Java Project model",
    (s) => s.applyRollbackEncapsulateField(),
    240_000,
  ],
  [
    "the person previews, applies, verifies and rolls back Maven Add Module from a partial project context",
    (s) => s.applyVerifyAndRollbackMavenModuleCreateFromPartialContext(),
    240_000,
  ],
  [
    "the person adds and rolls back a method parameter from the Monaco cursor",
    (s) => s.applyRollbackParameterAddition(),
    180_000,
  ],
  [
    "the person reviews parameter removal from the Monaco cursor for a side-effecting argument and a literal argument",
    (s) => s.applyRollbackParameterRemoval(),
    180_000,
  ],
  [
    "the person changes and rolls back a method parameter type from the Monaco cursor",
    (s) => s.applyRollbackParameterTypeChange(),
    180_000,
  ],
  [
    "the person reviews a Java field rename with direct Spring Data JPQL references and retries after a saved edit",
    (s) => s.reviewIncompleteJpqlFieldRename(),
    60_000,
  ],
  [
    "the person reviews applies and rolls back SDK formatting import organization and class rename",
    (s) => s.reviewApplyRollbackSdkRefactorings(),
    180_000,
  ],
  [
    "the person applies and undoes draft member rename from the editor shortcut and formatting without saving",
    (s) => s.applyUndoDirtySdkRefactorings(["rename-member", "format-file"], false, false, true),
  ],
  [
    "the person applies and undoes draft import organization and class rename through the editor shortcut without saving",
    (s) =>
      s.applyUndoDirtySdkRefactorings(["organize-imports", "rename-class"], false, false, true),
  ],
  [
    "the person applies and rolls back move, refuses Java-referenced deletion and keeps Maven-referenced safe delete review-only",
    (s) => s.applyRollbackProjectModelMoveAndSafeDelete(),
    180_000,
  ],
  [
    "the person applies and rolls back class moves from the command palette, refuses Java-referenced deletion and keeps Maven-referenced safe delete review-only",
    (s) => s.applyRollbackProjectModelMoveAndSafeDelete("command-palette"),
    180_000,
  ],
  [
    "the person applies and rolls back a package move from the Java project model",
    (s) => s.applyRollbackProjectModelPackageMove(),
    180_000,
  ],
  [
    "the person applies and rolls back a package move from the command palette",
    (s) => s.applyRollbackProjectModelPackageMove("command-palette"),
    180_000,
  ],
  [
    "the person applies and rolls back an attested Gradle project-model class move",
    (s) => s.applyRollbackGradleProjectModelClassMove(),
    180_000,
  ],
  [
    "the person moves the Gradle application class into a new package in the library module and rolls it back",
    (s) => s.applyRollbackGradleProjectModelClassMove(true),
    180_000,
  ],
  [
    "the move preview reports missing Gradle compiler outputs and keeps the saved sources intact",
    (s) => s.assertGradleClassMoveRefusedWithMissingCompilerOutputs(),
    90_000,
  ],
  [
    "the person resynchronizes Gradle and retries the move through Apply and Rollback",
    (s) => s.moveReferenceWorkflowClass(),
    180_000,
  ],
  [
    "the person applies and rolls back a source-root move from the Java project context",
    (s) => s.applyRollbackProjectModelSourceRootMove(),
    180_000,
  ],
  ["the person closes the SDK refactoring IDE", (s) => s.close()],
  [
    "the person restarts the IDE and reviews recovery of an applied draft class rename",
    (s) => s.applyUndoDirtySdkRefactorings(["rename-class"], "confirmed"),
    240_000,
  ],
  [
    "the person restarts the IDE and reviews recovery after losing the Apply confirmation",
    (s) => s.applyUndoDirtySdkRefactorings(["rename-class"], "confirmation-lost"),
    240_000,
  ],
  [
    "the person restarts the IDE after it stops during the saved-source move",
    (s) => s.applyUndoDirtySdkRefactorings(["rename-class"], "file-move-interrupted"),
    240_000,
  ],
];
Given<StoryWorld>("the desktop will stop immediately after the saved-source rename", async function () {
  await session(this).stopAfterDraftFileMove();
});
Given<StoryWorld>(
  "the Apply confirmation {string} will be interrupted in transit",
  async function (frame: string) {
    assert.ok(frame === "request" || frame === "response");
    await session(this).dropDraftApplyConfirmation(frame);
  },
);
for (const [text, run, timeoutMs] of actions)
  When<StoryWorld>(text, { timeout: timeoutMs ?? 90_000 }, async function () {
    const value = session(this);
    try {
      await run(value);
    } catch (error) {
      await value.captureFailure(error);
      throw error;
    }
  });
Then<StoryWorld>(
  "the review lists incomplete JPQL references, disables Apply, and opens the selected occurrence without changing the project",
  { timeout: 15_000 },
  async function () {
    await session(this).assertIncompleteJpqlFieldRenameReview();
  },
);
Then<StoryWorld>(
  "Extract Constant replaces the selected expression, passes Maven verify on a source copy, and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractConstant();
  },
);
Then<StoryWorld>(
  "Inline Variable passes Maven verify on a source copy and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertInlineRefactoring("inlineVariable");
  },
);
Then<StoryWorld>(
  "Inline Constant passes Maven verify on a source copy and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertInlineRefactoring("inlineConstant");
  },
);
Then<StoryWorld>(
  "Inline Method passes Maven verify on a source copy and restores the original method on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertInlineRefactoring("inlineMethod");
  },
);
Then<StoryWorld>(
  "Extract Variable introduces a local for the selected return subexpression, passes Maven verify on a source copy, and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractVariable();
  },
);
Then<StoryWorld>(
  "Extract Variable introduces a local before the selected initializer, passes Maven verify on a source copy, and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractVariable();
  },
);
Then<StoryWorld>(
  "Extract Method passes its inputs and checked exception through the helper, passes {word} tests on a source copy, and restores the original source on rollback",
  { timeout: 15_000 },
  async function (tool: string) {
    if (tool !== "Maven" && tool !== "Gradle") throw new Error(`Unknown build tool: ${tool}`);
    await session(this).assertExtractMethod(tool === "Gradle" ? "gradle" : "maven");
  },
);
Then<StoryWorld>(
  "the parameter reorder passes Maven verify on a source copy and restores the original method and call",
  { timeout: 15_000 },
  async function () {
    await session(this).assertParameterReordering();
  },
);
Then<StoryWorld>(
  "parameter rename passes Maven verify on a source copy and restores the original method and call",
  { timeout: 15_000 },
  async function () {
    await session(this).assertParameterRename();
  },
);
Then<StoryWorld>(
  "RefactorKit explains the public-method restriction, disables Apply, and preserves the project",
  { timeout: 15_000 },
  async function () {
    await session(this).assertPublicParameterReorderRefusedWithoutChanges();
  },
);
Then<StoryWorld>(
  "the stale Java context is retired, Apply is unavailable, and explicit synchronization remains available",
  { timeout: 15_000 },
  async function () {
    await session(this).assertStalePreviewContextRetired();
  },
);
Then<StoryWorld>(
  "the effective Maven context is available again after synchronization",
  { timeout: 15_000 },
  async function () {
    await session(this).assertStalePreviewContextResynchronized();
  },
);
Then<StoryWorld>(
  "Make Static passes Maven verify on a source copy and restores the original method on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertMakeStatic();
  },
);
Then<StoryWorld>(
  "Make Public passes Maven verify on a source copy and restores the original method on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertMakePublic();
  },
);
Then<StoryWorld>(
  "the RefactorKit LSP visibility change is reviewed, compiles on a source copy, and leaves the saved source unchanged",
  { timeout: 15_000 },
  async function () {
    await session(this).assertLspVisibilityChangeAppliedWithoutSaving();
  },
);
Then<StoryWorld>(
  "Make Public explains the override risk, disables Apply, and preserves the original project",
  { timeout: 15_000 },
  async function () {
    await session(this).assertMakePublicRefusedWithoutChanges();
  },
);
Then<StoryWorld>(
  "Extract Interface passes Maven verify on a source copy and removes the generated interface on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractInterface();
  },
);
Then<StoryWorld>(
  "Extract Superclass passes Maven verify on a source copy and removes the generated superclass on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractSuperclass();
  },
);
Then<StoryWorld>(
  "Move Member updates the bound call passes Maven tests and restores the original source on rollback",
  { timeout: 15_000 },
  async function () { await session(this).assertMoveMember(); },
);
Then<StoryWorld>(
  "the unsupported Move Member request leaves Apply disabled and all project files unchanged",
  { timeout: 15_000 },
  async function () { await session(this).assertMoveMember(true); },
);
Then<StoryWorld>(
  "Pull Up Method passes Maven verify on a source copy and restores the original method on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertPullUpMember();
  },
);
Then<StoryWorld>(
  "Push Down Method passes Maven verify on a source copy and restores the original method on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertPushDownMember();
  },
);
Then<StoryWorld>(
  "Extract Parameter updates its method and call, passes Maven verify on a source copy, and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractParameter();
  },
);
Then<StoryWorld>(
  "Extract Field passes Maven verify on a source copy and restores the original source on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertExtractField();
  },
);
Then<StoryWorld>(
  "Encapsulate Field updates bound reads, passes Maven verify on a source copy, and restores all original sources",
  { timeout: 15_000 },
  async function () {
    await session(this).assertEncapsulateField();
  },
);
Then<StoryWorld>(
  "Add Module rejects rollback with live build outputs, preserves later edits, and restores the reactor after controlled cleanup and explicit retry",
  { timeout: 15_000 },
  async function () {
    await session(this).assertMavenModuleCreateAppliedAndRolledBack();
  },
);
Then<StoryWorld>(
  "adding a method parameter passes Maven verify on a source copy and restores the original declaration and call",
  { timeout: 15_000 },
  async function () {
    await session(this).assertParameterAddition();
  },
);
Then<StoryWorld>(
  "removing a method parameter passes Maven verify on a source copy and restores the original declaration and call",
  { timeout: 15_000 },
  async function () {
    await session(this).assertParameterRemoval();
  },
);
Then<StoryWorld>(
  "the parameter type change passes Maven verify on a source copy and restores the original declaration and call",
  { timeout: 15_000 },
  async function () {
    await session(this).assertParameterTypeChange();
  },
);
Then<StoryWorld>(
  "durable recovery restores the reviewed original drafts after cancellation without saving sources",
  { timeout: 15000 },
  async function () {
    await session(this).assertRestartRefactoringRecovery();
  },
);
Then<StoryWorld>(
  "the original dirty Java drafts and every saved input are restored",
  { timeout: 15_000 },
  async function () {
    await session(this).assertDraftRefactorings();
  },
);
Then<StoryWorld>(
  "project-model class refactorings restore exact inputs after same-module and dependency-module moves, create the selected destination package, update the dependent source, and refuse unsafe deletion while the open Java tab follows the move and rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertProjectModelClassRefactorings();
  },
);
Then<StoryWorld>(
  "command-palette class moves restore exact inputs after same-module and dependency-module moves, create the selected destination package, update the dependent source, and refuse unsafe deletion",
  { timeout: 15_000 },
  async function () {
    await session(this).assertProjectModelClassMoveCommandPalette();
  },
);
Then<StoryWorld>(
  "project-model package moves pass offline project tests after Apply and restore every original source input on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertProjectModelPackageMove();
  },
);
Then<StoryWorld>(
  "Gradle project-model class moves pass offline project tests after Apply and restore every original source input on rollback",
  { timeout: 15_000 },
  async function () {
    await session(this).assertGradleProjectModelClassMove();
  },
);
Then<StoryWorld>(
  "the Gradle application test calls the moved library class and rollback restores every original input",
  { timeout: 15_000 },
  async function () {
    await session(this).assertGradleProjectModelClassMove(true);
  },
);
Then<StoryWorld>(
  "the moved source passes an offline module test and rollback restores the exact original inputs",
  { timeout: 15_000 },
  async function () {
    await session(this).assertProjectModelSourceRootMove();
  },
);
When<StoryWorld>(
  "the person refuses duplicate cleanup files and applies a mixed batch whose rollback preserves a later edit until retry",
  { timeout: 240_000 },
  async function () {
    try { await session(this).reviewApplyRollbackJavaCleanup(); }
    catch (error) { await session(this).captureFailure(error); throw error; }
  },
);
When<StoryWorld>(
  "the person selects the Team Java Eclipse profile and reviews applies and rolls back mixed Java cleanup",
  { timeout: 240_000 },
  async function () {
    try { await session(this).reviewApplyRollbackJavaCleanup(true); }
    catch (error) { await session(this).captureFailure(error); throw error; }
  },
);
Then<StoryWorld>(
  "the Java cleanup batch source copy passes Maven tests and the exact original inputs are restored",
  { timeout: 15_000 },
  async function () { await session(this).assertJavaCleanup(); },
);
Then<StoryWorld>(
  "the Java cleanup batch source copy passes Gradle tests and the exact original inputs are restored",
  { timeout: 15_000 },
  async function () { await session(this).assertJavaCleanup(); },
);
Then<StoryWorld>(
  "the applied source copies compile and pass Maven tests and all original inputs are restored",
  { timeout: 15_000 },
  async function () {
    await session(this).assertSdkRefactorings();
  },
);
Then<StoryWorld>(
  "the SDK refactoring IDE exits cleanly with the original sources preserved",
  { timeout: 15_000 },
  async function () {
    await session(this).assertFinal();
  },
);
After<StoryWorld>({ tags: `@${requirement}`, timeout: 20_000 }, async function () {
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
});


Given<StoryWorld>(
  "the SDK refactoring GUI has a Maven interface implementation and calls through both types",
  { timeout: 40_000 },
  async function () {
    await prepareSession(this, false, false, false, "maven", false, false, false, true,
      false, false, false, false, false, false, false, false, { parameterHierarchyFixture: true });
  },
);


Given<StoryWorld>(
  "the SDK refactoring GUI has a Maven {word} signature hierarchy",
  { timeout: 40_000 },
  async function (operation: string) {
    if (operation !== "reorder" && operation !== "remove" && operation !== "type") throw new Error("Unsupported signature hierarchy fixture");
    await prepareSession(this, false, false, false, "maven", false, false, false, true,
      false, false, false, false, false, false, false, false,
      { parameterHierarchyFixture: true, signatureHierarchyOperation: operation });
  },
);
When<StoryWorld>("the person reviews applies verifies and rolls back the signature hierarchy change", { timeout: 180_000 }, async function () {
  await session(this).applyRollbackSignatureHierarchy();
});
Then<StoryWorld>("the acknowledged signature hierarchy and both calls are verified and restored", async function () {
  await session(this).assertSignatureHierarchy();
});


for (const [fixture, description] of [["static", "static method"], ["instance", "bound instance"]] as const) {
  Given<StoryWorld>(
    `the SDK refactoring GUI has a Maven ${description} reference and a direct call`,
    { timeout: 40_000 },
    async function () {
      await prepareSession(this, false, false, false, "maven", false, false, false, true,
        false, false, false, false, false, false, false, false, { functionalReferencesFixture: fixture });
    },
  );
}
Then<StoryWorld>("the static method reference becomes a verified lambda and exact rollback restores it", async function () {
  await session(this).assertFunctionalReferenceMigration();
});
Then<StoryWorld>("the bound instance reference becomes a verified lambda and exact rollback restores it", async function () {
  await session(this).assertFunctionalReferenceMigration();
});


Given<StoryWorld>("the SDK refactoring GUI has a Maven constructor with new calls and a constructor reference", { timeout: 40_000 }, async function () {
  await prepareSession(this, false, false, false, "maven", false, false, false, true,
    false, false, false, false, false, false, false, false, { constructorSelectionFixture: true });
});
When<StoryWorld>("the person requests Add Parameter at the saved constructor cursor", { timeout: 60_000 }, async function () {
  await session(this).refuseConstructorSelection();
});
Then<StoryWorld>("the provider constructor-selection limitation is explained and the source is preserved", async function () {
  await session(this).assertConstructorSelectionRefused();
});

Given<StoryWorld>("the SDK refactoring GUI has a Maven {word} constructor signature and an unrelated overload", { timeout: 40_000 }, async function (operation: string) {
  if (operation !== "rename" && operation !== "add" && operation !== "reorder" && operation !== "remove" && operation !== "type") throw new Error("Unsupported constructor signature fixture");
  await prepareSession(this, false, false, false, "maven", false, false, false, true,
    false, false, false, false, false, false, false, false, { constructorSignatureFixture: operation });
});
When<StoryWorld>("the person reviews applies verifies and rolls back the constructor signature change", { timeout: 180_000 }, async function () {
  await session(this).applyRollbackConstructorSignature();
});
Then<StoryWorld>("the constructor signature and bound call are verified and restored with the overload unchanged", async function () {
  await session(this).assertConstructorSignature();
});

Given<StoryWorld>("the SDK refactoring GUI has a Maven constructor reference direct call and unrelated overload", { timeout: 40_000 }, async function () {
  await prepareSession(this, false, false, false, "maven", false, false, false, true,
    false, false, false, false, false, false, false, false,
    { constructorSignatureFixture: "add", constructorReferencesFixture: true });
});
Then<StoryWorld>("the constructor reference becomes a verified lambda and exact rollback restores it", async function () {
  await session(this).assertConstructorReferenceMigration();
});

Given<StoryWorld>("the SDK refactoring GUI has a Maven {word} constructor signature with this and super delegation", { timeout: 40_000 }, async function (operation: string) {
  if (operation !== "rename" && operation !== "add" && operation !== "reorder" && operation !== "remove" && operation !== "type") throw new Error("Unsupported constructor delegation fixture");
  await prepareSession(this, false, false, false, "maven", false, false, false, true,
    false, false, false, false, false, false, false, false,
    { constructorSignatureFixture: operation, constructorDelegationFixture: true });
});
Then<StoryWorld>("both constructor delegations are verified and restored with the overload unchanged", async function () {
  await session(this).assertConstructorDelegation();
});

Given<StoryWorld>("the Java Project command GUI has a real {word} reference project", { timeout: 40_000 }, async function (tool: string) {
  if (tool !== "maven" && tool !== "gradle") throw new Error("Unsupported project command fixture");
  await prepareSession(this, false, false, false, tool);
});
When<StoryWorld>("the person synchronizes the selected project from Commands with an unsaved Java edit", { timeout: 180_000 }, async function () {
  await session(this).launchAndSynchronizeFromCommands();
});
Then<StoryWorld>("Java Project displays the effective context and preserves the unsaved edit and saved inputs", async function () {
  await session(this).assertProjectContextCommandSynchronization();
});

Given<StoryWorld>("the field-type GUI has a Maven {word} field and a shadowing local", { timeout: 40_000 }, async function (visibility: string) {
  if (visibility !== "private" && visibility !== "public") throw new Error("Unsupported field type fixture");
  await prepareSession(this, false, false, false, "maven", false, false, false, true,
    false, false, false, false, false, false, false, false, { fieldTypeFixture: visibility });
});
When<StoryWorld>("the person reviews the saved Java field type through RefactorKit", { timeout: 180_000 }, async function () {
  await session(this).reviewFieldTypeChange();
});
Then<StoryWorld>("the field type is verified and restored or its unsupported visibility is refused without changes", async function () {
  await session(this).assertFieldTypeChange();
});

Given<StoryWorld>("the Gradle rename GUI has an {word} project using {string} settings", { timeout: 40_000 }, async function (mode: string, dsl: string) {
  if ((mode !== "app" && mode !== "literal-library" && mode !== "application-library" && mode !== "dynamic-library") ||
    (dsl !== "groovy" && dsl !== "kotlin")) {
    throw new Error("Unsupported Gradle rename fixture");
  }
  const value = new NativeJavaProjectContextSession(requirement); sessions.set(this, value);
  await value.prepare(false, "gradle", undefined, false, false, false, false, false, false, false,
    { gradleModuleRenamePreview: mode, gradleModuleCreateDsl: dsl });
});
When<StoryWorld>("the person explicitly evaluates the Gradle rename project", { timeout: 180_000 }, async function () {
  await session(this).launchAndEvaluateGradleModuleRenameProject();
});
When<StoryWorld>("the person reviews renaming the selected Gradle project", { timeout: 180_000 }, async function () {
  await session(this).reviewGradleModuleRename();
});
Then<StoryWorld>("the Gradle rename is built and rolled back or its inbound dependency is refused without changes", async function () {
  await session(this).assertGradleModuleRename();
});
