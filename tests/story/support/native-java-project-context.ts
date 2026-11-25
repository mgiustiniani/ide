import { readNativeJavaExecutionStatuses } from "./native-java-execution-status.js";
import { nativeArtifactEvidence } from "./native-artifact-evidence.js";
import { NativeJavaGitBranchWorkflow } from "./native-java-git-branch-workflow.js";
import assert from "node:assert/strict";
import type { ChainablePromiseElement } from "webdriverio";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  javaCrossModuleClassMoveSources,
  javaGradleCompositeProjectReference,
  javaGradleMixedJvmReference,
  javaMavenMixedJvmReference,
  NESTED_COMPOSITE_BUILD,
  javaGradleKotlinDslReference,
  javaGradleLiteralDependencyReference,
  javaGradleJpmsReference,
  javaGradlePreviewReference,
  javaGradlePackageMoveReference,
  javaEffectiveProjectReference,
  javaMavenJava27MetadataReference,
  javaMavenJpmsV5Reference,
  javaMavenModuleRenameReference,
} from "../fixtures/java-effective-project-reference.js";
import {
  captureOwnedApplication,
  type OwnedApplicationIdentity,
} from "./native-application-process-identity.js";
import { NativeDesktopApplication } from "./native-desktop-application.js";
import { NativeEditorSurface, textKeySequence } from "./native-editor-surface.js";
import { readNativeJUnitReport, type NativeJUnitReport } from "./native-java-test-report.js";
import { JAVA_NAMED_TEST_INVOCATION } from "../fixtures/java-named-test-loader.js";
import {
  javaManagedJpqlProject,
  managedJpqlApiJars,
  managedJpqlEntity,
  managedJpqlQueryCheck,
  managedJpqlRepository,
} from "../fixtures/java-managed-jpql.js";
import { NativeScenarioEnvironmentLease } from "./native-scenario-environment.js";
import {
  assertNativeCopiedText,
  pasteNativeText,
  readNativeCopiedText,
} from "./native-text-input.js";

export const JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT = "REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001";
const SOURCE = "maven/app/src/main/java/pkg/Runner.java";
type GradleModuleRenameFixture = "app" | "literal-library" | "application-library" | "dynamic-library";
const MANAGED_JPQL_MAVEN_OUTPUTS = ["maven/target/classes", "maven/target/test-classes"];
const SECOND_COMPOSITE_BUILD_ROOT = `gradle/${NESTED_COMPOSITE_BUILD}`;
const SECOND_COMPOSITE_APP = `${SECOND_COMPOSITE_BUILD_ROOT}/app`;
const SECOND_COMPOSITE_SOURCE = `${SECOND_COMPOSITE_APP}/src/main/java/pkg/Runner.java`;
const COMPOSITE_LIBRARY_SOURCE = "gradle/library/src/main/java/pkg/Greeter.java";
const SECOND_COMPOSITE_GREETER = `${SECOND_COMPOSITE_APP}/src/main/java/pkg/Greeter.java`;
const TEST_METHODS = [
  "dependenciesOverloadsAndGeneratedSource",
  "testScopeAndSamePathSource",
  "unrelatedModuleIsNotVisible",
] as const;
const SDK_REFACTORING_FORMATTER_FILE = "config/team-formatter.xml";
const SDK_REFACTORING_FORMATTER_NAME = "Team Java";
const SDK_REFACTORING_FORMATTER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<profiles version="23">
  <profile kind="CodeFormatterProfile" name="${SDK_REFACTORING_FORMATTER_NAME}" version="23">
    <setting id="org.eclipse.jdt.core.formatter.tabulation.char" value="space"/>
    <setting id="org.eclipse.jdt.core.formatter.tabulation.size" value="4"/>
    <setting id="org.eclipse.jdt.core.formatter.indentation.size" value="4"/>
    <setting id="org.eclipse.jdt.core.formatter.brace_position_for_type_declaration" value="next_line"/>
  </profile>
  <profile kind="CodeFormatterProfile" name="Compact Java" version="23">
    <setting id="org.eclipse.jdt.core.formatter.tabulation.size" value="2"/>
  </profile>
</profiles>
`;
const TEST_TEMPLATE_PROBES = [
  {
    path: "maven/app/src/test/java/pkg/JUnit4TemplateProbe.java",
    className: "JUnit4TemplateProbe",
    label: "test4",
    jar: "junit-4.13.2.jar",
    annotation: "@org.junit.Test",
    signature: "public void shouldDescribeBehavior()",
    assertionLabel: "assert4",
    assertionText: "org.junit.Assert.assertEquals(expected, actual);",
  },
  {
    path: "maven/app/src/test/java/pkg/JupiterTemplateProbe.java",
    className: "JupiterTemplateProbe",
    label: "test5",
    jar: "junit-jupiter-api-",
    annotation: "@org.junit.jupiter.api.Test",
    signature: "void shouldDescribeBehavior()",
    assertionLabel: "assert5",
    assertionText: "org.junit.jupiter.api.Assertions.assertEquals(expected, actual);",
  },
  {
    path: "maven/app/src/test/java/pkg/TestNGTemplateProbe.java",
    className: "TestNGTemplateProbe",
    label: "testng",
    jar: "testng-7.10.2.jar",
    annotation: "@org.testng.annotations.Test",
    signature: "public void shouldDescribeBehavior()",
    assertionLabel: "assertng",
    assertionText: "org.testng.Assert.assertEquals(actual, expected);",
  },
] as const;
const MOCKITO_TEMPLATE_SOURCE = `package pkg;
class MockitoTemplateProbe {
  static final class Service {
    String method(String value) { return value; }
  }
  void exercise() {
    String arguments = "input";
    String result = "result";

  }
}
`;
const SPRING_BOOT_TEMPLATE_SOURCE = `package pkg;
`;
function testTemplateProbes(tool: "maven" | "gradle") {
  return TEST_TEMPLATE_PROBES.map((probe) => ({
    ...probe,
    path: `${tool}/${probe.path.slice("maven/".length)}`,
  }));
}
async function isTemplateCompletionRow(
  row: WebdriverIO.Element | ChainablePromiseElement,
  label: string,
): Promise<boolean> {
  const labelPattern = new RegExp(`^\\s*(?:abc\\s+)?${label}(?:\\s|$)`, "u");
  const element = row as unknown as WebdriverIO.Element;
  const accessibleLabel = (await element.getAttribute("aria-label")) ?? "";
  const visibleText = await element.getText();
  const icon = element.$(".suggest-icon") as unknown as WebdriverIO.Element;
  const iconClass = (await icon.getAttribute("class")) ?? "";
  return (
    (labelPattern.test(accessibleLabel) || labelPattern.test(visibleText)) &&
    iconClass.split(/\s+/u).includes("codicon-symbol-snippet")
  );
}
const APPLICATION_DIRECTORY_FIRST = "run assets/café's";
const APPLICATION_DIRECTORY_SECOND = "run assets/other";
type ProjectTestWorkflow = "discover" | "tests" | "coverage" | "rerun";

const GRADLE_CROSS_MODULE_CLASS_MOVE = {
  sourceType: "pkg.MigrateToLibrary",
  relativeSource: "gradle/app/src/main/java/pkg/MigrateToLibrary.java",
  destinationPackage: "fixtures.library.migrated",
  destination: "gradle/library/src/main/java/fixtures/library/migrated/MigrateToLibrary.java",
  targetModuleId: ":library",
};

const GRADLE_SAME_MODULE_CLASS_MOVE = {
  sourceType: "fixtures.unrelated.Hidden",
  relativeSource: "gradle/unrelated/src/main/java/fixtures/unrelated/Hidden.java",
  destinationPackage: "fixtures.unrelated.moved",
  destination: "gradle/unrelated/src/main/java/fixtures/unrelated/moved/Hidden.java",
};

export class NativeJavaProjectContextSession {
  #lease?: NativeScenarioEnvironmentLease;
  #app?: NativeDesktopApplication;
  #surface?: NativeEditorSurface;
  #inputs = new Map<string, string>();
  #interruptedMavenRename?: {
    before: Map<string, string>;
    partial: Map<string, string>;
    journal: string;
    firstMoved: string;
  };
  #gitBranchWorkflow?: NativeJavaGitBranchWorkflow;
  #gitWorkflowTestRuns = 0;
  #mavenManifestAtSync?: Map<string, string>;
  #mavenManifestBeforeSync?: Map<string, string>;
  #contextTraceStart = 0;
  #mavenManifestAfterParameterSourceOpen?: Map<string, string>;
  #mavenManifestBeforeParameterPreview?: Map<string, string>;
  #originalEnvironment = new Map<string, string | undefined>();
  #sdk = "";
  #jdtlsServerSdk = "";
  #engine = "";
  #standardInstallation = false;
  #draftConfirmationInterruption?: { wrapper: string; frame: "request" | "response" };
  #draftRenameStopEnvironment?: Record<string, string>;
  #executionTool: "maven" | "gradle" = "maven";
  #applicationWorkingDirectory = false;
  #applicationDirectoryProof = "";
  #applicationInputPid: number | null = null;
  #compilerBuildFixture?: { source: string; draft: string; broken: string; line: number };
  #javaRelease?: 8 | 11 | 26 | 27;
  #mavenUnsupportedRelease?: 26 | 27;
  #executionDraftSavedBeforeProjectSync = false;
  #customMavenOutputs = false;
  #customMavenIntegrationTestSourceSet = false;
  #mavenFailsafeProfile = false;
  #customGradleOutputs = false;
  #customGradleTestSourceSet = false;
  #sourceRootMoveFixture = false;
  #mavenModuleOperationFixture = false;
  #gradleModuleCreatePreview = false;
  #gradleModuleRenamePreview: GradleModuleRenameFixture | null = null;
  #gradleModuleCreateDsl: "groovy" | "kotlin" = "groovy";
  #jpaQueryFixture: boolean | "managed" = false;
  #jpqlVerificationClasspath = "";
  #jpqlFieldRenameReviewQualified = false;
  #extractConstantFixture = false;
  #extractVariableFixture = false;
  #extractVariableInitializerFixture = false;
  #inlineRefactoringFixture = false;
  #parameterObjectFixture = false;
  #extractDelegateFixture = false;
  #extractMethodFixture = false;
  #extractParameterFixture = false;
  #extractFieldFixture = false;
  #extractInterfaceFixture = false;
  #extractSuperclassFixture = false;
  #selectedTestDebugFixture = false;
  #failedTestDebugFixture = false;
  #failedTestDebugOrigin: "test" | "debug-test" = "debug-test";
  #failedTestDebugFramework: "junit4" | "jupiter" | "testng" = "junit4";
  #inheritedDefaultTestMethod = false;
  #moveMemberFixture: "static-method" | "instance-method" | undefined;
  #pullUpMemberFixture = false;
  #pushDownMemberFixture = false;
  #parameterReorderFixture = false;
  #parameterHierarchyFixture = false;
  #functionalReferencesFixture: "static" | "instance" | undefined;
  #constructorSelectionFixture = false;
  #fieldTypeFixture: "private" | "public" | null = null;
  #constructorReferencesFixture = false;
  #constructorDelegationFixture = false;
  #constructorSignatureFixture: "rename" | "add" | "reorder" | "remove" | "type" | null = null;
  #signatureHierarchyOperation: "add" | "reorder" | "remove" | "type" = "add";
  #parameterRemovalFixture = false;
  #publicParameterReorderRefusalFixture = false;
  #makeStaticFixture = false;
  #makePublicFixture:
    "final-method" | "non-final-method-in-final-class" | "non-final-method-in-open-class" | false =
    false;
  #encapsulateFieldFixture = false;
  #gradleKotlinDslProject = false;
  #gradleCompositeProject = false;
  #workspaceWrapper = false;
  #testWorkflow?: ProjectTestWorkflow;
  #gradleSdk = "";
  #gradleRuntimeSdk = "";
  #gradleJpmsArtifactPath = "";
  #gradleJpmsArtifactSha256 = "";
  #mavenJpmsArtifactPath = "";
  #mavenJpmsArtifactSha256 = "";
  #mavenFailsafeReports: Partial<Record<"app" | "library", NativeJUnitReport>> = {};
  #repository = "";
  #projectTestTemplateClasspath: string[] = [];
  #mockitoSpringTestTemplates = false;
  #failureObservation: unknown;
  #draftStages: { stage: string; time: string }[] = [];
  #projectDebugProcesses: OwnedApplicationIdentity[] = [];
  #proof = {
    requirement: JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT,
    nativeGui: true,
    e2e: true,
    ...nativeArtifactEvidence(),
    daemon: "",
    engine: "",
    applicationInput: { run: false, jfr: false, rerun: false, debug: false, testsIgnoreInput: false, stopReapedWaitingJvm: false },
    mainClassDiscovery: { dirtyDraftPreserved: false, providerCandidateSelected: false, partialCoverageVisible: false, editorFileActionStartedRun: false, editorFileActionStartedDebug: false, cursorSiblingWithoutMainRefused: false, editorCursorStartedRun: false, editorCursorStartedDebug: false },
    synchronizedCompilerFailure: { savedFault: false, sourceTabActivatedFromLibrary: false, draftAndDiskPreserved: false, repairedContext: false, freshRunDraft: false },
    applicationDirectory: {
      runUsesSelectedDirectory: false, jfrUsesSelectedDirectory: false,
      jfrRetainsProjectStorage: false, jfrAnalysis: false,
      rerunRetainsCapturedDirectory: false, rerunPreservesRecording: false,
      testsRetainModuleDirectory: false, debugUsesSelectedDirectory: false,
    },
    realMavenBuild: false,
    realGradleBuild: false,
    projectJavaRelease: null as 8 | 11 | 26 | 27 | null,
    gradlePreviewRelease: null as 21 | 25 | 27 | null,
    java26MavenContextAvailable: false,
    java26GradleContextAvailable: false,
    java26ContextSdkAndSnapshotAttested: false,
    java26GradleSyncAttested: false,
    java26ContextDaemonSha256: null as string | null,
    java26CandidateArchiveSha256: null as string | null,
    java26SdkManagedRename: false,
    java26CursorApplyUndo: false,
    java26RenameBeforeBuildRefused: false,
    java26ContextReacquiredAfterRefusal: false,
    java26RefusedPreviewRetiredContext: false,
    java26ProcessorOutputBuilt: false,
    java26RenamedSourceCopyTested: false,
    java27MavenContextAvailable: false,
    java27MavenExecutionPassed: false,
    java27FlightRecorderPassed: false,
    java27TestDiscoveryPassed: false,
    java27DiscoveredTestClassOpened: false,
    java27TestSourceNavigationPassed: false,
    java27GradleContextAvailable: false,
    java27ContextSdkAndSnapshotAttested: false,
    java27GradleSyncAttested: false,
    java27MetadataOnlyContext: false,
    java27SourceAnalysisUnqualified: false,
    java27PreviewMavenSourceOwnership: false,
    java27V7MavenOwnerOnlySourceOwnership: false,
    java27V7GradleOwnerOnlySourceOwnership: false,
    java27JdtlsServerRuntimeJdk25ProjectJdk27: false,
    java27JdtlsDefinitionOpened: false,
    java27JdtlsTypePanelRetiredAndOpened: false,
    java27JdtlsReferencesOpened: false,
    java27ReferenceDeclarationTabClosed: false,
    java27ClosedSourceReferencePreviewVerified: false,
    java27ShiftF12RefactorKitResultStatus: null as string | null,
    java27F12DefinitionFallbackAfterRefusal: false,
    java27F12RefactorKitResultStatus: null as string | null,
    java27JdtlsProjectChangesBeforeF12: [] as string[],
    java27JdtlsMaterializedOutputRoots: [] as string[],
    java27ContextRefreshedAfterLanguageImport: false,
    java27NavigationProjectRecoveryActionVerified: false,
    java27CtrlClickDefinitionOpened: false,
    refactorKitStandardInstallationDiscovered: false,
    java27CtrlClickPreviousRequestId: null as string | null,
    java27CtrlClickInput: null as { ctrlKey: boolean; insideSource: boolean } | null,
    java27JdtlsGradleImportEnabled: false,
    java27GradleRuntimeJdkAttested: false,
    java27GradleBuildTaskPassed: false,
    java27GradleProcessorContextPresented: false,
    java27GradleApplicationBuiltAndRan: false,
    java27GradleTestsPassed: false,
    java27GradleCoveragePassed: false,
    java27GradleDebugPassed: false,
    java27ContextDaemonSha256: null as string | null,
    mavenUnsupportedRelease: null as 26 | 27 | null,
    mavenUnsupportedReleaseRefusedByProvider: false,
    mavenUnsupportedReleaseRefusalMessage: null as string | null,
    mavenUnsupportedReleaseProjectInputsUnchanged: false,
    effectiveMavenModulesAndGeneratedRoots: false,
    mainAndTestClasspathScopes: false,
    mavenArtifactCoordinatesAndNestedRows: false,
    mainAndTestSourceOwnership: false,
    projectContextRetiredAfterInputChange: false,
    contextReacquiredAfterGeneratedOutputChange: false,
    gradleExplicitlyPartial: false,
    gradleExplicitEvaluationAndSourceOwnership: false,
    gradleJpmsContextPresented: false,
    gradleJpmsV5CompleteContextPresented: false,
    gradleJpmsModulePathPreserved: false,
    gradleJpmsV5NamedModuleRun: false,
    gradleJpmsV5NamedModuleDebugEntry: false,
    gradleJpmsV5NamedModuleDebugCompleted: false,
    mavenJpmsV5CompleteContextPresented: false,
    mavenJpmsV5NamedModuleRun: false,
    mavenJpmsV5NamedModuleDebugEntry: false,
    mavenJpmsV5NamedModuleDebugCompleted: false,
    gradleJpmsSourceOwnershipResolved: false,
    gradleJpmsRequiredFactRefused: false,
    gradlePreviewCompilerSettingAppliedToJdtLs: false,
    gradlePreviewOptionAppliedAndDiagnosticCleared: false,
    gradlePreviewUnrelatedDraftDiagnosticPresented: false,
    dirtyBufferPreservedWithoutSave: false,
    contextBoundCursorNavigation: false,
    contextBoundOverlayNavigation: false,
    contextNavigationCursorBeforeF12: null as string | null,
    contextNavigationEditorFocusedBeforeF12: false,
    contextNavigationDefinitionCallsBeforeF12: null as number | null,
    contextNavigationDefinitionCallsAfterF12: null as number | null,
    javaTypePackagePrefilledFromMavenSourceRoot: false,
    mavenModuleDescriptorCreatedAsDraft: false,
    mavenModuleDescriptorSavedAndCompiled: false,
    projectLanguageServiceReadyBeforeContextSync: false,
    projectJdkSwitchRestartedLanguageService: false,
    projectJdkSwitchUnavailableBecauseNoDistinctJdk: false,
    projectJdkSwitchPreservedDirtyBuffer: false,
    changedSdkNavigationRefused: false,
    projectModelReportsRunnerLocation: false,
    gradleProjectModelReportsRunnerLocation: false,
    mavenModuleRenameRefusedForDirtyBuffersAppliedAndRolledBack: false,
    mavenModuleRenameDestinationRetried: false,
    mavenNestedModuleRelocationVerified: false,
    mavenModuleRenameAppliedMavenVerify: false,
    mavenSavedSourceRecoveryRestoredAndSynchronized: false,
    mavenModuleCreateAppliedMavenVerifyRolledBack: false,
    mavenModuleCreateApplied: false,
    mavenModuleCreateRollbackRefusedWithoutWrites: false,
    mavenModuleCreateRollbackExplicitRetrySucceeded: false,
    mavenModuleCreateSourceCopyVerified: false,
    mavenModuleCreateLiveReactorVerified: false,
    mavenModuleCreateBuildOutputsPreservedOnRollbackRefusal: false,
    mavenModuleCreateOnlyBuildOutputsRemoved: false,
    mavenModuleCreateRolledBack: false,
    gradleModuleCreateReviewedAppliedAndRolledBack: false,
    gradleModuleCreateSourceCopyCompiled: false,
    projectModelNavigationRevealsLine: false,
    projectModelNavigationPreservesDraft: false,
    synchronizedCoverageSourceNavigationAndDecoration: false,
    synchronizedGradleCoverageSourceMappingUnavailable: false,
    synchronizedGradleCoverageSourceNavigationAndDecoration: false,
    sourceInputsPreserved: false,
    cleanExit: false,
    sdkFormattingReviewedAppliedAndRolledBack: false,
    managedJpqlRenameVerifiedAndRolledBack: false,
    managedJpqlEmptyOutputDirectoriesPreserved: false,
    managedJpqlCompiledOutputRefused: false,
    sdkBatchCleanupReviewedAppliedAndRolledBack: false,
    sdkBatchCleanupDuplicateRefused: false,
    sdkBatchCleanupWorkspaceSearchSelected: false,
    sdkBatchCleanupRollbackConflictPreservedInputs: false,
    sdkBatchCleanupBuildTool: null as "maven" | "gradle" | null,
    sdkBatchCleanupLiveBuildVerified: false,
    sdkBatchCleanupContextSchema: null as string | null,
    sdkImportOrganizationReviewedAppliedAndRolledBack: false,
    sdkDirtyApplyUndoWithoutSave: false,
    sdkDirtyOperations: [] as string[],
    sdkRestartRecoveryReviewedAndRestored: false,
    sdkClassRenameReviewedAppliedAndRolledBack: false,
    sdkExtractConstantReviewedAppliedAndRolledBack: false,
    sdkExtractVariableReviewedAppliedAndRolledBack: false,
    sdkInlineVariableReviewedAppliedAndRolledBack: false,
    sdkInlineConstantReviewedAppliedAndRolledBack: false,
    sdkInlineMethodReviewedAppliedAndRolledBack: false,
    sdkExtractMethodReviewedAppliedAndRolledBack: false,
    sdkExtractMethodSourceCopyCompiledAndTested: false,
    sdkExtractParameterReviewedAppliedAndRolledBack: false,
    sdkExtractParameterSourceCopyCompiledAndTested: false,
    sdkExtractFieldReviewedAppliedAndRolledBack: false,
    sdkExtractFieldSourceCopyCompiledAndTested: false,
    sdkExtractInterfaceReviewedAppliedAndRolledBack: false,
    sdkExtractInterfaceSourceCopyCompiledAndTested: false,
    sdkExtractSuperclassReviewedAppliedAndRolledBack: false,
    sdkExtractSuperclassSourceCopyCompiledAndTested: false,
    failedTestDebuggerRerunQualified: false,
    failedTestDebuggerStartedFromOrdinaryTest: false,
    failedTestDebuggerFrameworkQualified: null as "jupiter" | "testng" | null,
    selectedJavaTestDebuggerCompleted: false,
    selectedJavaTestDebuggerStopped: false,
    selectedJavaTestDebuggerCapturedRerun: false,
    selectedJavaTestDebuggerLocalsInspected: false,
    java27GradleReadOnlyRefusalExplained: false,
    sdkMoveMemberLiveBuildVerified: false,
    sdkMoveMemberDestinationSelected: false,
    sdkMoveMemberReviewedAppliedAndRolledBack: false,
    sdkMoveMemberSourceCopyCompiledAndTested: false,
    sdkMoveMemberRefusedWithoutChanges: false,
    sdkPullUpMemberReviewedAppliedAndRolledBack: false,
    sdkPullUpMemberSourceCopyCompiledAndTested: false,
    sdkPushDownMemberReviewedAppliedAndRolledBack: false,
    sdkPushDownMemberSourceCopyCompiledAndTested: false,
    sdkParameterReorderReviewedAppliedAndRolledBack: false,
    sdkParameterRenameReviewedAppliedAndRolledBack: false,
    sdkStaleParameterPreviewRetiredContext: false,
    sdkPublicParameterReorderRefusedWithoutChanges: false,
    sdkMakeStaticReviewedAppliedAndRolledBack: false,
    sdkMakePublicReviewedAppliedAndRolledBack: false,
    lspVisibilityReviewedAppliedAndDiscardedWithoutSaving: false,
    sdkMakePublicRefusedWithoutChanges: false,
    sdkEncapsulateFieldReviewedAppliedAndRolledBack: false,
    sdkEncapsulateFieldSourceCopyCompiledAndTested: false,
    sdkParameterAdditionReviewedAppliedAndRolledBack: false,
    sdkParameterHierarchyReviewedAppliedAndRolledBack: false,
    sdkFunctionalReferencesMigratedAndRolledBack: false,
    sdkConstructorSelectionRefusedWithoutChanges: false,
    sdkSignatureHierarchyOperationsQualified: [] as string[],
    sdkConstructorSignatureOperationsQualified: [] as string[],
    sdkConstructorReferenceMigratedAndRolledBack: false,
    sdkConstructorDelegationOperationsQualified: [] as string[],
    projectContextCommandSynchronization: [] as string[],
    gradleModuleRenameQualified: [] as string[],
    gradleModuleRenameDirtyApplyRefused: false,
    sdkFieldTypeChangedAndRolledBack: false,
    sdkFieldTypeRefusedWithoutChanges: false,
    sdkParameterHierarchyRiskAcceptanceRequired: false,
    sdkParameterRemovalReviewedAppliedAndRolledBack: false,
    sdkParameterRemovalWithSideEffectsRefused: false,
    sdkParameterTypeChangeReviewedAppliedAndRolledBack: false,
    sdkProjectModelMoveReviewedAndSafeDeleteReviewed: false,
    sdkProjectModelClassMoveFromCommandPalette: false,
    sdkOpenJavaTabFollowsProjectModelMoveAndRollback: false,
    sdkProjectModelMoveSourceCopyCompiledAndTested: false,
    sdkCrossModuleClassMoveReviewedAppliedAndRolledBack: false,
    sdkCrossModuleClassMoveUpdatedDependentModuleReference: false,
    sdkCrossModuleClassMoveSourceCopyCompiledAndTested: false,
    sdkCrossModuleNewPackageDestinationSelected: false,
    sdkProjectModelPackageMoveReviewedAppliedAndRolledBack: false,
    sdkProjectModelPackageMoveSourceCopyCompiledAndTested: false,
    sdkGradleProjectModelPackageMoveSourceCopyCompiledAndTested: false,
    sdkGradleProjectModelClassMoveReviewedAppliedAndRolledBack: false,
    sdkGradleProjectModelClassMoveSourceCopyCompiledAndTested: false,
    sdkGradleCrossModuleClassMoveReviewedAppliedAndRolledBack: false,
    sdkGradleClassMoveMissingCompilerOutputsRefused: false,
    sdkReferencedSafeDeleteRefusedWithoutChanges: false,
    sdkSafeDeleteWithMavenReferenceRemainsReadOnly: false,
    sdkProjectModelSourceRootMoveReviewedAppliedAndRolledBack: false,
    sdkProjectModelSourceRootSourceCopyTested: false,
    sdkRenameShortcutOperations: [] as string[],
    appliedSourceCopiesCompiledAndTested: false,
    synchronizedModuleRunSavedDraft: false,
    synchronizedModuleCleanRemovedOutputs: false,
    synchronizedModuleCleanRebuiltGeneratedSources: false,
    synchronizedModuleCleanPreservedSelectionAndInputs: false,
    synchronizedModuleRuntimeDependencies: false,
    synchronizedModuleSelectedJdk: false,
    synchronizedMavenMainOutputDirectory: false,
    synchronizedMavenTestOutputDirectory: false,
    projectAwareTestTemplatePresented: false,
    projectAwareEqualityAssertionTemplatePresented: false,
    projectAwareTestTemplateCompilationPassed: false,
    projectAwareTestTemplateSavedSourceUnchanged: false,
    projectAwareTestTemplateClasspathResolved: false,
    projectAwareMockitoTemplatesPresented: false,
    projectAwareSpringBootTemplatePresented: false,
    synchronizedGradleMainOutputDirectory: false,
    synchronizedGradleTestOutputDirectory: false,
    gradleCompositeContextIdentityResolved: false,
    gradleCompositePostExecutionIdentityRefreshes: 0,
    gradleCompositeApplicationRan: false,
    gradleCompositeSecondAppRan: false,
    gradleCompositeSecondAppTestCompiled: false,
    gradleCompositeSecondAppTestCoverage: false,
    gradleCompositeCoverageConfigurationPreserved: false,
    gradleCompositeSecondAppCoverageRepeated: false,
    gradleCompositeSecondAppTestDebug: false,
    gradleCompositeLibraryJarBreakpoint: false,
    gradleCompositeCoverageMeasuredApplicationAndDependency: false,
    gradleCompositeApplicationDebugStoppedOnSource: false,
    gradleCompositeApplicationDebugCompleted: false,
    gradleCompositeCleanSelectedExternalModule: false,
    gradleCompositeCleanPreservedLibraryAndInputs: false,
    gradleCompositeBuildAfterCleanSucceeded: false,
    gradleCompositeRebuildRemovedOldOutputAndCompiled: false,
    synchronizedModuleDebugSavedDraft: false,
    synchronizedModuleHotSwapUsedProjectOutput: false,
    synchronizedModuleHotSwapUsedProjectSuggestion: false,
    synchronizedModuleCompiledChangesReviewed: false,
    synchronizedModuleCompiledChangesApplied: false,
    synchronizedModuleCapturedSessionRestarted: false,
    configuredExecutionCommands: [] as string[],
    synchronizedModuleDebugStoppedOnSource: false,
    synchronizedModuleDebugRuntimeDependencies: false,
    synchronizedModuleDebugProcessesExited: false,
    executionBeganWithoutCompiledOutputs: false,
    synchronizedDiscoveryDidNotRunTests: false,
    synchronizedDiscoveryFiltered: false,
    synchronizedSelectionRetainedSettings: false,
    synchronizedCoverageMeasuredApplication: false,
    workspaceRootCoverageOpened: false,
    workspaceRootCoverageRetiredAfterReload: false,
    multiModuleGradleCoverageMeasuredProjectDependencies: false,
    multiModuleGradleCoverageOpenedDependencySource: false,
    gradleCoverageProjectContextBeforeTest: "",
    customGradleSourceSetCoverageMeasuredMain: false,
    customGradleSourceSetCoverageOpenedMainSource: false,
    customGradleSourceSetBuildTaskRan: false,
    customGradleSourceSetApplicationRan: false,
    customGradleSourceSetDiscoveryReady: false,
    customGradleSourceSetDiscoveryDidNotRunTests: false,
    customGradleSourceSetDebugStoppedOnSource: false,
    customGradleSourceSetDebugProcessesExited: false,
    synchronizedFailedRerunRetainedSettings: false,
    mavenDependencyTestsExcluded: false,
    mavenDiscoveredTestSourceOwnsBinaryName: false,
    testResultSourceNavigation: false,
    namedClassLoaderFailureSourceNavigation: false,
    customGradleSourceSetTestTaskRan: false,
    synchronizedMavenIntegrationTestSourceSetClassified: false,
    synchronizedMavenFailsafeTestTaskRan: false,
    synchronizedMavenFailsafeAppAndLibrarySourceSetsClassified: false,
    synchronizedMavenFailsafeAppAndLibraryTasksRan: false,
    mavenAnnotationProcessorContextWarningVisible: false,
    mavenAnnotationProcessorWarningBeforeJavaOpen: false,
    mavenAnnotationProcessorContextAvailableAfterFailsafe: false,
    mavenProfileTestJvmDetailsObserved: false,
    generatedJavaSourceOpenedFromProjectRoot: false,
    generatedJavaSourceNoticeAndRevealVerified: false,
    generatedJavaMethodDefinitionOpened: false,
    generatedJavaMethodDefinitionProvider: null as "RefactorKit" | "JDT LS" | null,
    mavenTestJvmOptionAccepted: false,
    mavenLegacyFailsafeJvmVerified: false,
    mavenFailsafeToolchainRecoveryVerified: false,
    mavenFailsafeOfflinePluginRecoveryVerified: false,
    mavenFailsafeCoverageVerified: false,
    mavenLegacyFailsafeDebugCompletedAndStopped: false,
    mavenFailsafeDebugCompletedAndStopped: false,
    mavenTestJvmOptionObservedByFailsafe: false,
    synchronizedJupiterTestSourcePrepared: false,
    synchronizedJupiterTestPassedForSelectedBuildTool: false,
    synchronizedTestNgTestSourcePrepared: false,
    synchronizedTestNgTestPassedForSelectedBuildTool: false,
    synchronizedMixedJunitTestSourcePrepared: false,
    synchronizedMixedJunitTestsPassedForSelectedBuildTool: false,
    gradleKotlinDslProjectContextTestPassed: false,
    mixedJvmDebug: false,
    mixedJvmMemberRenameRefused: false,
    mixedMavenRenameRejectedStaleContext: false,
    mixedMavenTestOutputCreatedWhileStartingLanguageService: false,
    mixedJvmDefinitionRefusalCode: null as string | null,
    mixedJvmKotlinDefinitionsRevealed: [] as string[],
    mixedJvmKotlinBinaryDriftRefused: false,
    mixedJvmKotlinDefinitionAfterRebuild: false,
    mixedJvmJavaDefinitionRevealed: false,
    workspaceWrapperDispatchedToRealBuildTool: false,
    explicitlyRepairedTest: null as string | null,
  };
  #runnerModelPath = "";
  #runnerModelLine = 0;
  #pendingOwnershipRecovery?: { kind: string; symbol: string; expected: string };
  #generatedOutputProbeCreated = false;
  #staleParameterOutputBackup?: { relativePath: string; bytes: Uint8Array; sha256: string };
  #moduleDescriptor?: { path: string; source: string };

  constructor(
    readonly requirement:
      | typeof JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT
      | "REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001" = JAVA_PROJECT_CONTEXT_NATIVE_REQUIREMENT,
  ) {
    this.#proof.requirement = requirement;
  }

  async prepare(
    forExecution = false,
    executionTool: "maven" | "gradle" = "maven",
    testWorkflow?: ProjectTestWorkflow,
    sourceRootMoveFixture = false,
    forDebugger = false,
    customMavenOutputs = false,
    customGradleOutputs = false,
    workspaceWrapper = false,
    savedImportsFixture = false,
    referencedSafeDeleteFixture = false,
    {
      applicationWorkingDirectory = false,
      workspaceRootCoverage = false,
      testTemplateFrameworks = false,
      mockitoSpringTestTemplates = false,
      java27JdtlsDefinition = false,
      java27MavenExecution = false,
      mavenModuleRenamePreview = false,
      mavenModuleCreatePreview = false,
      javaRelease,
      mavenUnsupportedRelease,
      gradleModuleCreatePreview = false,
      gradleModuleRenamePreview = null,
      gradleModuleCreateDsl = "groovy",
      customGradleTestSourceSet = false,
      gradleKotlinDslProject = false,
      mixedJvmProject = false,
      gradleCompositeProject = false,
      gradlePackageMoveFixture = false,
      gradleClassMoveFixture = false,
      gradleJpmsProject = false,
      gradleJpmsV5Project = false,
      mavenJpmsV5Project = false,
      gradlePreviewProject = false,
      gradlePreviewRelease = 21,
      junitJupiterProjectTests = false,
      testNgProjectTests = false,
      mixedJunitProjectTests = false,
      customMavenIntegrationTestSourceSet = false,
      mavenFailsafeProfile = false,
      mavenFailsafeJava8Fixture = false,
      extractConstantFixture = false,
      extractVariableFixture = false,
      extractVariableInitializerFixture = false,
      inlineRefactoringFixture = false,
      parameterObjectFixture = false,
      extractDelegateFixture = false,
      formatterProfileFixture = false,
      extractMethodFixture = false,
      extractParameterFixture = false,
      extractFieldFixture = false,
      extractInterfaceFixture = false,
      extractSuperclassFixture = false,
      jpaQueryFixture = false,
      selectedTestDebugFixture = false,
      failedTestDebugFixture = false,
      failedTestDebugOrigin = "debug-test",
      failedTestDebugFramework = "junit4",
      inheritedDefaultTestMethod = false,
      moveMemberFixture,
      pullUpMemberFixture = false,
      pushDownMemberFixture = false,
      parameterReorderFixture = false,
      parameterHierarchyFixture = false,
      functionalReferencesFixture,
      constructorSelectionFixture = false,
      fieldTypeFixture = null,
      constructorReferencesFixture = false,
      constructorDelegationFixture = false,
      constructorSignatureFixture = null,
      signatureHierarchyOperation = "add",
      parameterRemovalFixture = false,
      publicParameterReorderRefusalFixture = false,
      makeStaticFixture = false,
      makePublicFixture,
      encapsulateFieldFixture = false,
    }: {
      applicationWorkingDirectory?: boolean;
      workspaceRootCoverage?: boolean;
      testTemplateFrameworks?: boolean;
      mockitoSpringTestTemplates?: boolean;
      java27JdtlsDefinition?: boolean;
      java27MavenExecution?: boolean;
      mavenModuleRenamePreview?: boolean;
      mavenModuleCreatePreview?: boolean;
      javaRelease?: 8 | 11 | 26 | 27;
      mavenUnsupportedRelease?: 26 | 27;
      gradleModuleCreatePreview?: boolean;
      gradleModuleRenamePreview?: GradleModuleRenameFixture | null;
      gradleModuleCreateDsl?: "groovy" | "kotlin";
      customGradleTestSourceSet?: boolean;
      gradleKotlinDslProject?: boolean;
      mixedJvmProject?: boolean;
      gradleCompositeProject?: boolean | "same-path-app";
      gradlePackageMoveFixture?: boolean;
      gradleClassMoveFixture?: boolean;
      gradleJpmsProject?: boolean;
      gradleJpmsV5Project?: boolean;
      mavenJpmsV5Project?: boolean;
      gradlePreviewProject?: boolean;
      gradlePreviewRelease?: 21 | 25 | 27;
      junitJupiterProjectTests?: boolean;
      testNgProjectTests?: boolean;
      mixedJunitProjectTests?: boolean;
      customMavenIntegrationTestSourceSet?: boolean;
      mavenFailsafeProfile?: boolean;
      mavenFailsafeJava8Fixture?: boolean;
      extractConstantFixture?: boolean;
      extractVariableFixture?: boolean;
      extractVariableInitializerFixture?: boolean;
      inlineRefactoringFixture?: boolean;
      parameterObjectFixture?: boolean;
      extractDelegateFixture?: boolean;
      formatterProfileFixture?: boolean;
      extractMethodFixture?: boolean;
      extractParameterFixture?: boolean;
      extractFieldFixture?: boolean;
      extractInterfaceFixture?: boolean;
      extractSuperclassFixture?: boolean;
      jpaQueryFixture?: boolean | "managed";
      selectedTestDebugFixture?: boolean;
      failedTestDebugFixture?: boolean;
      failedTestDebugOrigin?: "test" | "debug-test";
      failedTestDebugFramework?: "junit4" | "jupiter" | "testng";
      inheritedDefaultTestMethod?: boolean;
      moveMemberFixture?: "static-method" | "instance-method";
      pullUpMemberFixture?: boolean;
      pushDownMemberFixture?: boolean;
      parameterReorderFixture?: boolean;
      parameterHierarchyFixture?: boolean;
      functionalReferencesFixture?: "static" | "instance";
      constructorSelectionFixture?: boolean;
      fieldTypeFixture?: "private" | "public" | null;
      constructorReferencesFixture?: boolean;
      constructorDelegationFixture?: boolean;
      constructorSignatureFixture?: "rename" | "add" | "reorder" | "remove" | "type" | null;
      signatureHierarchyOperation?: "add" | "reorder" | "remove" | "type";
      parameterRemovalFixture?: boolean;
      publicParameterReorderRefusalFixture?: boolean;
      makeStaticFixture?: boolean;
      makePublicFixture?:
        "final-method" | "non-final-method-in-final-class" | "non-final-method-in-open-class";
      encapsulateFieldFixture?: boolean;
    } = {},
  ) {
    this.#executionTool = executionTool;
    this.#applicationWorkingDirectory = applicationWorkingDirectory;
    assert.ok(!applicationWorkingDirectory || (forExecution && !testWorkflow && !forDebugger));
    this.#javaRelease = javaRelease;
    this.#mavenUnsupportedRelease = mavenUnsupportedRelease;
    this.#proof.projectJavaRelease = javaRelease ?? null;
    if (javaRelease === 26) {
      assert.equal(
        process.env.IDE_JAVA_CONTEXT_TRACE,
        "1",
        "Enable the Java 26 context evidence trace.",
      );
      assert.equal(
        process.env.IDE_JAVA_EDITOR_TRACE,
        "1",
        "Enable editor RPC tracing for the Java 26 refusal and rename checks.",
      );
      const archive = process.env.IDE_JAVA_CONTEXT_CANDIDATE_ARCHIVE;
      assert.ok(
        archive && path.isAbsolute(archive),
        "Set IDE_JAVA_CONTEXT_CANDIDATE_ARCHIVE to the verified Java 26 candidate ZIP.",
      );
      this.#proof.java26CandidateArchiveSha256 = createHash("sha256")
        .update(await readFile(archive))
        .digest("hex");
      assert.equal(
        this.#proof.java26CandidateArchiveSha256,
        process.env.IDE_JAVA_CONTEXT_CANDIDATE_SHA256,
        "Java 26 candidate archive differs from the expected checksum",
      );
    }

    assert.ok(
      gradlePreviewRelease === 21 || gradlePreviewRelease === 25 || gradlePreviewRelease === 27,
    );
    this.#proof.gradlePreviewRelease = gradlePreviewProject ? gradlePreviewRelease : null;
    this.#proof.mavenUnsupportedRelease = mavenUnsupportedRelease ?? null;
    this.#sourceRootMoveFixture = sourceRootMoveFixture;
    this.#extractConstantFixture = extractConstantFixture;
    this.#extractVariableFixture = extractVariableFixture;
    this.#extractVariableInitializerFixture = extractVariableInitializerFixture;
    this.#inlineRefactoringFixture = inlineRefactoringFixture;
    this.#parameterObjectFixture = parameterObjectFixture;
    this.#extractDelegateFixture = extractDelegateFixture;
    this.#extractMethodFixture = extractMethodFixture;
    this.#extractParameterFixture = extractParameterFixture;
    this.#extractFieldFixture = extractFieldFixture;
    this.#extractInterfaceFixture = extractInterfaceFixture;
    this.#extractSuperclassFixture = extractSuperclassFixture;
    this.#jpaQueryFixture = jpaQueryFixture;
    this.#selectedTestDebugFixture = selectedTestDebugFixture;
    this.#failedTestDebugFixture = failedTestDebugFixture;
    this.#failedTestDebugOrigin = failedTestDebugOrigin;
    this.#failedTestDebugFramework = failedTestDebugFramework;
    this.#inheritedDefaultTestMethod = inheritedDefaultTestMethod;
    assert.ok(!inheritedDefaultTestMethod || (failedTestDebugFixture && failedTestDebugFramework === "jupiter" && executionTool === "gradle"));
    assert.ok(failedTestDebugOrigin !== "test" || failedTestDebugFixture);
    assert.ok(!failedTestDebugFixture || selectedTestDebugFixture);
    this.#moveMemberFixture = moveMemberFixture;
    this.#pullUpMemberFixture = pullUpMemberFixture;
    this.#pushDownMemberFixture = pushDownMemberFixture;
    this.#parameterReorderFixture = parameterReorderFixture;
    this.#parameterHierarchyFixture = parameterHierarchyFixture;
    this.#functionalReferencesFixture = functionalReferencesFixture;
    this.#constructorSelectionFixture = constructorSelectionFixture;
    this.#fieldTypeFixture = fieldTypeFixture;
    assert.ok(!fieldTypeFixture || (parameterReorderFixture && !constructorSignatureFixture && !parameterHierarchyFixture && !functionalReferencesFixture));
    this.#constructorReferencesFixture = constructorReferencesFixture;
    this.#constructorDelegationFixture = constructorDelegationFixture;
    assert.ok(!constructorDelegationFixture || (constructorSignatureFixture && !constructorReferencesFixture));
    assert.ok(!constructorReferencesFixture || constructorSignatureFixture === "add");
    this.#constructorSignatureFixture = constructorSignatureFixture;
    assert.ok(!constructorSignatureFixture || (parameterReorderFixture && !constructorSelectionFixture && !functionalReferencesFixture && !parameterHierarchyFixture));
    assert.ok(!constructorSelectionFixture || (parameterReorderFixture && !functionalReferencesFixture && !parameterHierarchyFixture));
    assert.ok(!functionalReferencesFixture || (parameterReorderFixture && !parameterHierarchyFixture));
    this.#signatureHierarchyOperation = signatureHierarchyOperation;
    assert.ok(signatureHierarchyOperation === "add" || parameterHierarchyFixture);
    assert.ok(!parameterHierarchyFixture || parameterReorderFixture);
    this.#parameterRemovalFixture = parameterRemovalFixture;
    this.#publicParameterReorderRefusalFixture = publicParameterReorderRefusalFixture;
    this.#makeStaticFixture = makeStaticFixture;
    this.#makePublicFixture = makePublicFixture ?? false;
    this.#encapsulateFieldFixture = encapsulateFieldFixture;
    this.#mockitoSpringTestTemplates = mockitoSpringTestTemplates;
    assert.ok(!mockitoSpringTestTemplates || testTemplateFrameworks);
    assert.ok(!(customMavenOutputs && customGradleOutputs));
    assert.ok(!customMavenOutputs || executionTool === "maven");
    assert.ok(!customGradleOutputs || executionTool === "gradle");
    assert.ok(!customGradleTestSourceSet || (forExecution && executionTool === "gradle"));
    assert.ok(!mavenFailsafeJava8Fixture || customMavenIntegrationTestSourceSet);
    assert.ok(
      !customMavenIntegrationTestSourceSet ||
        (forExecution && executionTool === "maven" && testWorkflow === "tests"),
    );
    assert.ok(!gradleKotlinDslProject || (forExecution && executionTool === "gradle"));
    assert.ok(!gradleCompositeProject || (forExecution && executionTool === "gradle"));
    assert.ok(!gradlePackageMoveFixture || executionTool === "gradle");
    assert.ok(!mavenModuleCreatePreview || (executionTool === "maven" && !forExecution));
    assert.ok(
      mavenUnsupportedRelease === undefined || (executionTool === "maven" && !forExecution),
    );
    assert.ok(!(javaRelease !== undefined && mavenUnsupportedRelease !== undefined));
    const legacyReference = javaRelease === 8 || javaRelease === 11;
    assert.ok(
      javaRelease === undefined ||
        !forExecution ||
        (legacyReference && (!testWorkflow || selectedTestDebugFixture)) ||
        (javaRelease === 27 && (selectedTestDebugFixture || customMavenIntegrationTestSourceSet ||
          (executionTool === "gradle" && testWorkflow === "tests"))),
      "The requested Java release is not configured for this execution workflow.",
    );
    assert.ok(!(mavenUnsupportedRelease !== undefined && mavenModuleCreatePreview));
    assert.ok(!gradleModuleCreatePreview || (executionTool === "gradle" && !forExecution));
    assert.ok(gradleModuleCreatePreview || gradleModuleRenamePreview !== null || gradleModuleCreateDsl === "groovy");
    assert.ok(!gradleJpmsProject || (executionTool === "gradle" && !forExecution));
    assert.ok(!gradleJpmsV5Project || (executionTool === "gradle" && !forExecution));
    assert.ok(!mavenJpmsV5Project || (executionTool === "maven" && !forExecution));
    assert.ok(!(gradleJpmsV5Project && mavenJpmsV5Project));
    assert.ok(!gradlePreviewProject || (executionTool === "gradle" && !forExecution));
    assert.ok(!extractConstantFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!extractVariableFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!extractVariableInitializerFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!formatterProfileFixture || !forExecution);
    assert.ok(!extractMethodFixture || !forExecution);
    assert.ok(!extractParameterFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!extractFieldFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!extractInterfaceFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!extractSuperclassFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!jpaQueryFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!selectedTestDebugFixture || (forExecution && testWorkflow === "tests"));
    assert.ok(!moveMemberFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!pullUpMemberFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!pushDownMemberFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!(pullUpMemberFixture && pushDownMemberFixture));
    assert.ok(!parameterReorderFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!parameterRemovalFixture || (executionTool === "maven" && !forExecution));
    assert.ok(
      !publicParameterReorderRefusalFixture ||
        (parameterReorderFixture && executionTool === "maven" && !forExecution),
    );
    assert.ok(!makeStaticFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!makePublicFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!encapsulateFieldFixture || (executionTool === "maven" && !forExecution));
    assert.ok(!(extractConstantFixture && extractVariableFixture));
    assert.ok(!inlineRefactoringFixture || (executionTool === "maven" && !forExecution));
    assert.ok(
      !inlineRefactoringFixture ||
        !(extractConstantFixture || extractVariableFixture || extractVariableInitializerFixture),
    );
    assert.ok(!(extractVariableFixture && extractVariableInitializerFixture));
    assert.ok(!(extractParameterFixture && extractFieldFixture));
    assert.ok(!(extractConstantFixture && extractVariableInitializerFixture));
    assert.ok(
      !(
        extractMethodFixture &&
        (extractConstantFixture || extractVariableFixture || extractVariableInitializerFixture)
      ),
    );
    assert.ok(
      !(
        parameterReorderFixture &&
        (extractConstantFixture ||
          extractVariableFixture ||
          extractVariableInitializerFixture ||
          extractMethodFixture ||
          makeStaticFixture)
      ),
    );
    assert.ok(
      !(
        makeStaticFixture &&
        (extractConstantFixture ||
          extractVariableFixture ||
          extractVariableInitializerFixture ||
          extractMethodFixture)
      ),
    );
    assert.ok(!junitJupiterProjectTests || (forExecution && testWorkflow === "tests"));
    assert.ok(!testNgProjectTests || (forExecution && testWorkflow === "tests"));
    assert.ok(!mixedJunitProjectTests || (forExecution && testWorkflow === "tests"));
    assert.ok(!(customGradleTestSourceSet && gradleKotlinDslProject));
    assert.ok(!(customMavenIntegrationTestSourceSet && customGradleTestSourceSet));
    assert.ok(
      !(
        (junitJupiterProjectTests || testNgProjectTests) &&
        (customGradleTestSourceSet || gradleKotlinDslProject)
      ),
    );
    assert.ok(!(mixedJunitProjectTests && (customGradleTestSourceSet || gradleKotlinDslProject)));
    assert.ok(!(mixedJunitProjectTests && (junitJupiterProjectTests || testNgProjectTests)));
    assert.ok(!gradleKotlinDslProject || !customGradleOutputs);
    assert.ok(!workspaceWrapper || forExecution);
    assert.ok(!workspaceWrapper || process.platform === "linux");
    assert.ok(
      !savedImportsFixture || this.requirement === "REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
    );
    this.#workspaceWrapper = workspaceWrapper;
    this.#customMavenOutputs = customMavenOutputs;
    this.#customGradleOutputs = customGradleOutputs;
    this.#customGradleTestSourceSet = customGradleTestSourceSet;
    this.#customMavenIntegrationTestSourceSet = customMavenIntegrationTestSourceSet;
    this.#mavenFailsafeProfile = mavenFailsafeProfile;
    this.#gradleKotlinDslProject =
      gradleKotlinDslProject || ((gradleModuleCreatePreview || gradleModuleRenamePreview !== null) && gradleModuleCreateDsl === "kotlin");
    this.#gradleModuleCreatePreview = gradleModuleCreatePreview;
    this.#gradleModuleRenamePreview = gradleModuleRenamePreview;
    this.#gradleModuleCreateDsl = gradleModuleCreateDsl;
    this.#gradleCompositeProject = Boolean(gradleCompositeProject);
    this.#testWorkflow = testWorkflow;
    const configured = process.env.IDE_REAL_REFACTORKIT_DAEMON;
    assert.ok(
      configured && path.isAbsolute(configured),
      "Set IDE_REAL_REFACTORKIT_DAEMON to a daemon providing project.context.",
    );
    await access(configured, constants.X_OK);
    this.#proof.daemon = await realpath(configured);
    assert.ok((await lstat(this.#proof.daemon)).isFile(), "IDE_REAL_REFACTORKIT_DAEMON must identify an executable file.");
    const engine =
      process.env.IDE_REFACTORKIT_ENGINE ||
      path.join(
        path.dirname(this.#proof.daemon),
        process.platform === "win32" ? "refactorkit.exe" : "refactorkit",
      );
    await access(engine, constants.X_OK);
    this.#engine = await realpath(engine);
    assert.ok((await lstat(this.#engine)).isFile(), "The RefactorKit CLI must identify an executable file.");
    this.#proof.engine = this.#engine;
    this.#sdk = await realpath(
      process.env.IDE_JAVA_CONTEXT_TEST_JDK ??
        process.env.IDE_JAVA_HOME ??
        "/usr/lib/jvm/java-21-openjdk",
    );
    if (java27JdtlsDefinition) {
      assert.equal(javaRelease, 27);
      const configuredServerJdk = process.env.IDE_JDTLS_SERVER_JDK;
      assert.ok(
        configuredServerJdk && path.isAbsolute(configuredServerJdk),
        "Set IDE_JDTLS_SERVER_JDK to the qualified JDK 25 server runtime.",
      );
      this.#jdtlsServerSdk = await realpath(configuredServerJdk);
      assert.notEqual(this.#jdtlsServerSdk, this.#sdk);
      const serverRelease = await readFile(path.join(this.#jdtlsServerSdk, "release"), "utf8");
      const serverMajor = /^JAVA_VERSION="(\d+)/mu.exec(serverRelease)?.[1];
      assert.equal(serverMajor, "25", "The native Java 27 story requires a JDK 25 JDT LS runtime.");
      await Promise.all([
        access(path.join(this.#jdtlsServerSdk, "bin/java"), constants.X_OK),
        access(path.join(this.#jdtlsServerSdk, "bin/javac"), constants.X_OK),
      ]);
      this.#originalEnvironment.set("IDE_JDTLS_JAVA_HOME", process.env.IDE_JDTLS_JAVA_HOME);
      this.#originalEnvironment.set("IDE_JAVA_HOME", process.env.IDE_JAVA_HOME);
      process.env.IDE_JAVA_HOME = this.#sdk;
      process.env.IDE_JDTLS_JAVA_HOME = this.#jdtlsServerSdk;
    }
    const gradleSdk = process.env.IDE_JAVA_CONTEXT_GRADLE_JDK;
    if (gradleSdk) {
      assert.ok(
        path.isAbsolute(gradleSdk),
        "IDE_JAVA_CONTEXT_GRADLE_JDK must be an absolute path to a full JDK.",
      );
      this.#gradleSdk = await realpath(gradleSdk);
    } else if (executionTool === "gradle") {
      assert.fail(
        "Set IDE_JAVA_CONTEXT_GRADLE_JDK to the full JDK for Gradle context qualification.",
      );
    } else {
      this.#gradleSdk = this.#sdk;
    }
    const gradleRuntimeSdk = process.env.IDE_JAVA_CONTEXT_GRADLE_RUNTIME_JDK;
    if (legacyReference && executionTool === "gradle") {
      assert.ok(gradleRuntimeSdk, "Set IDE_JAVA_CONTEXT_GRADLE_RUNTIME_JDK for the legacy Gradle fixture.");
    }
    if (gradleRuntimeSdk) {
      assert.ok(
        path.isAbsolute(gradleRuntimeSdk),
        "IDE_JAVA_CONTEXT_GRADLE_RUNTIME_JDK must be an absolute path to a full JDK.",
      );
      this.#gradleRuntimeSdk = await realpath(gradleRuntimeSdk);
    } else {
      this.#gradleRuntimeSdk = "";
    }
    for (const sdk of new Set([this.#sdk, this.#gradleSdk, this.#gradleRuntimeSdk].filter(Boolean)))
      await access(path.join(sdk, "bin/javac"), constants.X_OK);
    if ((selectedTestDebugFixture || customMavenIntegrationTestSourceSet) && javaRelease === 27) {
      const release = await readFile(path.join(this.executionSdk(), "release"), "utf8");
      assert.equal(/^JAVA_VERSION="(\d+)/mu.exec(release)?.[1], "27", "The Java 27 test profile requires a JDK 27 project SDK.");
    }
    const repository = process.env.IDE_JAVA_CONTEXT_MAVEN_REPOSITORY;
    assert.ok(
      repository && path.isAbsolute(repository),
      "Set IDE_JAVA_CONTEXT_MAVEN_REPOSITORY to the populated Maven cache for offline qualification.",
    );
    this.#repository = await realpath(repository);
    this.#lease = await NativeScenarioEnvironmentLease.acquire(this.requirement);
    if (mavenJpmsV5Project || mavenFailsafeJava8Fixture) {
      const isolatedRepository = path.join(this.#lease.paths.root, "maven-repository");
      await cp(this.#repository, isolatedRepository, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
      this.#repository = isolatedRepository;
    }
    if (mavenJpmsV5Project) {
      await this.createMavenJpmsV5DependencyArtifact();
    }
    const mavenModuleOperationFixture = mavenModuleRenamePreview || mavenModuleCreatePreview;
    this.#mavenModuleOperationFixture = mavenModuleOperationFixture;
    const skipBaselineMavenBuild =
      mavenModuleOperationFixture ||
      jpaQueryFixture === "managed" ||
      mavenJpmsV5Project ||
      gradleModuleCreatePreview ||
      gradleModuleRenamePreview !== null ||
      javaRelease !== undefined ||
      mavenUnsupportedRelease !== undefined;
    const tools = workspaceRootCoverage
      ? []
      : mixedJvmProject
      ? [executionTool]
      : mavenModuleOperationFixture || jpaQueryFixture === "managed" || mavenJpmsV5Project || mavenUnsupportedRelease !== undefined
        ? (["maven"] as const)
        : (["maven", "gradle"] as const);
    const kotlinRepository = process.env.IDE_JAVA_MIXED_GRADLE_REPOSITORY ?? "";
    if (mixedJvmProject && executionTool === "gradle") {
      assert.ok(path.isAbsolute(kotlinRepository), "Set IDE_JAVA_MIXED_GRADLE_REPOSITORY to a local Maven repository with Kotlin 2.0.21.");
      assert.ok((await lstat(kotlinRepository)).isDirectory());
    }
    for (const tool of tools) {
      const mavenTestIsolationFixture = tool === "maven" && tool === executionTool &&
        ((failedTestDebugFixture && failedTestDebugFramework === "junit4") ||
          testWorkflow === "rerun" || testWorkflow === "coverage" || testWorkflow === "discover");
      const reference =
        tool === "gradle" && (gradleModuleRenamePreview === "literal-library" || gradleModuleRenamePreview === "dynamic-library")
          ? javaGradleLiteralDependencyReference(gradleModuleCreateDsl === "kotlin")
          : jpaQueryFixture === "managed"
          ? await this.prepareManagedJpqlProject()
          : mixedJvmProject
          ? tool === "gradle"
            ? javaGradleMixedJvmReference(pathToFileURL(kotlinRepository).href)
            : javaMavenMixedJvmReference()
          : mavenJpmsV5Project && tool === "maven"
          ? javaMavenJpmsV5Reference()
          : mavenModuleOperationFixture && tool === "maven"
            ? javaMavenModuleRenameReference()
            : gradleKotlinDslProject && tool === "gradle"
              ? javaGradleKotlinDslReference()
              : (gradleModuleCreatePreview || gradleModuleRenamePreview !== null) && tool === "gradle" && gradleModuleCreateDsl === "kotlin"
                ? javaGradleKotlinDslReference()
                : gradleCompositeProject && tool === "gradle"
                  ? javaGradleCompositeProjectReference(gradleCompositeProject === "same-path-app")
                  : (gradleJpmsProject || gradleJpmsV5Project) && tool === "gradle"
                    ? javaGradleJpmsReference(
                        this.file("gradle/test-modules/fixture-dependency.jar"),
                        gradleJpmsV5Project,
                      )
                    : gradlePreviewProject && tool === "gradle"
                      ? javaGradlePreviewReference(gradlePreviewRelease)
                      : gradlePackageMoveFixture && tool === "gradle"
                        ? javaGradlePackageMoveReference()
                        : javaRelease === 27 && tool === "maven" && !selectedTestDebugFixture
                          && !customMavenIntegrationTestSourceSet
                          ? javaMavenJava27MetadataReference({
                              crossModuleDefinition: java27JdtlsDefinition,
                              execution: java27MavenExecution,
                            })
                          : javaEffectiveProjectReference(
                              tool,
                              customGradleOutputs && tool === "gradle",
                              referencedSafeDeleteFixture && tool === "maven",
                              mavenFailsafeJava8Fixture && tool === "maven"
                                ? 8
                                : (javaRelease ?? mavenUnsupportedRelease ?? 17),
                              legacyReference && tool === "gradle",
                            );
      if (gradleModuleRenamePreview === "dynamic-library" && tool === "gradle") {
        const kotlin = gradleModuleCreateDsl === "kotlin";
        const script = kotlin ? "app/build.gradle.kts" : "app/build.gradle";
        const build = reference[script];
        assert.ok(build);
        const literal = kotlin ? 'implementation(project(":library"))' : "implementation project(':library')";
        const dynamic = kotlin ? "implementation(project(libraryPath))" : "implementation project(libraryPath)";
        assert.ok(build.includes(literal));
        reference[script] = build.replace(literal, dynamic).replace(
          "dependencies {",
          `${kotlin ? 'val libraryPath = ":library"' : "def libraryPath = ':library'"}\ndependencies {`,
        );
      }
      if (legacyReference && tool === "gradle") {
        reference["gradle.properties"] +=
          `org.gradle.java.installations.paths=${this.#gradleSdk}\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\n`;
      }
      if (javaRelease === 27 && java27JdtlsDefinition && forExecution && tool === "gradle") {
        reference["unrelated/src/test/java/pkg/RunnerTest.java"] =
          "package pkg; public class RunnerTest { public void unrelatedDeclaration() {} }\n";
      }
      if (gradleClassMoveFixture && tool === "gradle") {
        Object.assign(reference, javaCrossModuleClassMoveSources);
        reference["app/src/test/java/pkg/MoveClientTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class MoveClientTest {
  @Test public void callsMovedType() {
    assertEquals("moved", new MoveClient().value());
  }
}
`;
      }
      if (testWorkflow === "rerun") {
        reference["app/src/test/java/fixtures/testloader/NamedTestInvocation.java"] =
          JAVA_NAMED_TEST_INVOCATION;
      }
      if (jpaQueryFixture === true && tool === "maven") {
        reference["app/src/main/java/jakarta/persistence/Entity.java"] =
          `package jakarta.persistence;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Entity {}
`;
        reference["app/src/main/java/org/springframework/data/jpa/repository/Query.java"] =
          `package org.springframework.data.jpa.repository;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Query { String value(); }
`;
        reference["app/src/main/java/demo/User.java"] = `package demo;
import jakarta.persistence.Entity;
@Entity
public class User {
  private String displayName;
  public String getDisplayName() { return displayName; }
}
`;
        reference["app/src/main/java/demo/UserRepository.java"] = `package demo;
import org.springframework.data.jpa.repository.Query;
public interface UserRepository {
  @Query("select u.displayName from User u where u.displayName = :displayName")
  String findByName(String displayName);
}
`;
      }
      if (formatterProfileFixture && tool === executionTool)
        reference[SDK_REFACTORING_FORMATTER_FILE] = SDK_REFACTORING_FORMATTER_XML;
      if (parameterObjectFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ParameterObjectFixture.java"] = `package pkg;
public final class ParameterObjectFixture {
  private static int combine(int left, int right) {
    return left * 10 + right;
  }
  public static int answer(int left, int right) {
    return combine(left, right);
  }
}
`;
        reference["app/src/test/java/pkg/ParameterObjectFixtureTest.java"] = `package pkg;
public class ParameterObjectFixtureTest {
  @org.junit.Test
  public void preservesArgumentOrder() {
    org.junit.Assert.assertEquals(27, ParameterObjectFixture.answer(2, 7));
  }
}
`;
      }
      if (extractDelegateFixture) {
        reference["app/src/main/java/pkg/ExtractDelegateFixture.java"] = `package pkg;
public final class ExtractDelegateFixture {
  private static final int OFFSET = 2;

  private static int adjust(int n) {
    return n + OFFSET;
  }

  private static int compute(int n) {
    return adjust(n) * 3;
  }

  public static int answer(int n) {
    return compute(n);
  }
}
`;
        reference["app/src/test/java/pkg/ExtractDelegateFixtureTest.java"] = `package pkg;
public class ExtractDelegateFixtureTest {
  @org.junit.Test
  public void preservesAnswer() {
    org.junit.Assert.assertEquals(18, ExtractDelegateFixture.answer(4));
  }
}
`;
      }
      if (inlineRefactoringFixture && tool === "maven") {
        reference["app/src/main/java/pkg/InlineFixture.java"] = `package pkg;
public final class InlineFixture {
  private static final int ANSWER = 42;
  public static int calculate() {
    int local = 42;
    return local + ANSWER;
  }
  private static int inlineValue() {
    return 40 + 2;
  }
  public static int calculateFromInlineMethod() {
    return inlineValue();
  }
}
`;
      } else if (extractMethodFixture && tool === executionTool) {
        reference["app/src/main/java/pkg/ExtractMethodFixture.java"] = `package pkg;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
public final class ExtractMethodFixture {
  public static String answer(Path path, String fallback) throws IOException {
    String prefix = "";
    String raw = Files.readString(path);
    String normalized = prefix + raw.trim();
    if (normalized.isEmpty()) {
      normalized = fallback;
    }
    return normalized;
  }
}
`;
        reference["app/src/test/java/pkg/ExtractMethodFixtureTest.java"] = `package pkg;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ExtractMethodFixtureTest {
  @Test public void preservesNormalizedAndFallbackResults() throws IOException {
    Path input = Files.createTempFile("extract-method", ".txt");
    try {
      Files.writeString(input, "  extracted value  ");
      assertEquals("extracted value", ExtractMethodFixture.answer(input, "fallback"));
      Files.writeString(input, "   ");
      assertEquals("fallback", ExtractMethodFixture.answer(input, "fallback"));
    } finally {
      Files.deleteIfExists(input);
    }
  }
}
`;
      } else if (
        (extractConstantFixture || extractVariableFixture || extractVariableInitializerFixture) &&
        tool === "maven"
      ) {
        reference["app/src/main/java/pkg/ConstantFixture.java"] = `package pkg;
public final class ConstantFixture {
  public static int answer() {
    ${extractVariableInitializerFixture ? "int result = 6 * 7 + 1;\n    return result;" : extractVariableFixture ? "return 6 * 7 + 0;" : "return 6 * 7;"}
  }
}
`;
      }
      if (extractParameterFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ExtractParameterFixture.java"] = `package pkg;
public final class ExtractParameterFixture {
  private static int calculate(int base) {
    return base + 1;
  }
  public static int result() {
    int input = 41;
    return calculate(input);
  }
}
`;
        reference["app/src/test/java/pkg/ExtractParameterFixtureTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ExtractParameterFixtureTest {
  @Test public void preservesResult() {
    assertEquals(42, ExtractParameterFixture.result());
  }
}
`;
      }
      if (extractFieldFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ExtractFieldFixture.java"] = `package pkg;
public final class ExtractFieldFixture {
  public int result() {
    return 6 * 7;
  }
}
`;
        reference["app/src/test/java/pkg/ExtractFieldFixtureTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ExtractFieldFixtureTest {
  @Test public void preservesResult() {
    assertEquals(42, new ExtractFieldFixture().result());
  }
}
`;
      }
      if (parameterReorderFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
public final class ParameterOrderFixture {
  ${this.#publicParameterReorderRefusalFixture ? "public " : ""}static int combine(int first, int second) {
    return first * 10 + second;
  }
  public static int result() {
    return combine(2, 3);
  }
}
`;
        if (parameterHierarchyFixture) {
          reference["app/src/main/java/pkg/Combiner.java"] = `package pkg;
public interface Combiner { int combine(int first, int second); }
`;
          reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
public final class ParameterOrderFixture implements Combiner {
  @Override public int combine(int first, int second) {
    return first * 10${signatureHierarchyOperation === "remove" ? "" : signatureHierarchyOperation === "type" ? " + (int)second" : " + second"};
  }
  public static int result() {
    Combiner api = new ParameterOrderFixture();
    return api.combine(2, 3) + new ParameterOrderFixture().combine(2, 3) - ${signatureHierarchyOperation === "remove" ? 20 : 23};
  }
}
`;
        }
        if (functionalReferencesFixture) {
          const bound = functionalReferencesFixture === "instance";
          reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
import java.util.function.IntBinaryOperator;
public final class ParameterOrderFixture {
  ${bound ? "private" : "static"} int combine(int first, int second) {
    return first * 10 + second;
  }
${bound ? `  public static int result() {
    return new ParameterOrderFixture().boundResult();
  }
  private int boundResult() {` : `  public static int result() {`}
    IntBinaryOperator ref = ${bound ? "this" : "ParameterOrderFixture"}::combine;
    return combine(2, 3) + ref.applyAsInt(2, 3) - 23;
  }
}
`;
        }
        if (constructorSelectionFixture) {
          reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
import java.util.function.IntFunction;
public final class ParameterOrderFixture {
  private final int value;
  private ParameterOrderFixture(int value) { this.value = value; }
  public static int result() {
    IntFunction<ParameterOrderFixture> factory = ParameterOrderFixture::new;
    return new ParameterOrderFixture(23).value + factory.apply(23).value - 23;
  }
}
`;
        }
        if (constructorSignatureFixture) {
          reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
${constructorReferencesFixture ? "import java.util.function.BiFunction;\n" : ""}public final class ParameterOrderFixture {
  private final int value;
  private ParameterOrderFixture(int first, int second) {
    this.value = first * 10${constructorSignatureFixture === "remove" ? "" : constructorSignatureFixture === "type" ? " + (int)second" : " + second"};
  }
  private ParameterOrderFixture(boolean marker) { this.value = -1; }
  public static int result() {
    ${constructorReferencesFixture ? "BiFunction<Integer, Integer, ParameterOrderFixture> factory = ParameterOrderFixture::new;" : ""}
    return new ParameterOrderFixture(2, 3).value${constructorReferencesFixture ? " + factory.apply(2, 3).value - 23" : ""};
  }
  public static int overloadResult() { return new ParameterOrderFixture(true).value; }
}
`;
        }
        if (constructorDelegationFixture) {
          reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
public class ParameterOrderFixture {
  private final int value;
  ParameterOrderFixture(int first, int second) {
    this.value = first * 10${constructorSignatureFixture === "remove" ? "" : constructorSignatureFixture === "type" ? " + (int)second" : " + second"};
  }
  private ParameterOrderFixture(boolean marker) { this.value = -1; }
  private ParameterOrderFixture() { this(2, 3); }
  public static int result() {
    ParameterOrderFixture child = new DelegatingChild();
    return new ParameterOrderFixture().value + child.value - ${constructorSignatureFixture === "remove" ? 20 : 23};
  }
  public static int overloadResult() { return new ParameterOrderFixture(true).value; }
}
final class DelegatingChild extends ParameterOrderFixture {
  DelegatingChild() { super(2, 3); }
}
`;
        }
        reference["app/src/test/java/pkg/ParameterOrderFixtureTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ParameterOrderFixtureTest {
  @Test public void preservesArgumentMeaning() {
    ${constructorSignatureFixture ? "assertEquals(-1, ParameterOrderFixture.overloadResult());" : ""}
    assertEquals(${(parameterHierarchyFixture && signatureHierarchyOperation === "remove") || constructorSignatureFixture === "remove" ? 20 : 23}, ParameterOrderFixture.result());
  }
}
`;
      }
      if (fieldTypeFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ParameterOrderFixture.java"] = `package pkg;
public final class ParameterOrderFixture {
  ${fieldTypeFixture} int value = 41;
  private int unaffected = 5;
  public long result() {
    this.value++;
    int value = 7;
    return this.value + value + unaffected;
  }
}
`;
        reference["app/src/test/java/pkg/ParameterOrderFixtureTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ParameterOrderFixtureTest {
  @Test public void preservesFieldAndLocalMeaning() {
    assertEquals(54L, new ParameterOrderFixture().result());
  }
}
`;
      }
      if (parameterRemovalFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ParameterRemovalFixture.java"] = `package pkg;
public final class ParameterRemovalFixture {
  static int retain(int value, int unused) {
    return value;
  }
  public static int result() {
    return retain(41, 9);
  }
  private static int calls;
  static int retainWithEffect(int value, int unused) {
    return value;
  }
  public static int resultWithEffect() {
    return retainWithEffect(41, calls++);
  }
}
`;
        reference["app/src/test/java/pkg/ParameterRemovalFixtureTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ParameterRemovalFixtureTest {
  @Test public void preservesResult() {
    assertEquals(41, ParameterRemovalFixture.result());
  }
}
`;
      }
      if (moveMemberFixture && tool === "maven") {
        reference["app/src/main/java/pkg/MoveMemberFixture.java"] = `package pkg;
public final class MoveMemberFixture {
  ${moveMemberFixture === "static-method" ? "static " : ""}int value() {
    return 42;
  }
  public static int result() {
    return ${moveMemberFixture === "static-method" ? "MoveMemberFixture" : "new MoveMemberFixture()"}.value();
  }
}
class MoveDestination {
}
`;
        reference["app/src/test/java/pkg/MoveMemberFixtureTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class MoveMemberFixtureTest {
  @Test public void preservesResult() {
    assertEquals(42, MoveMemberFixture.result());
    System.out.println("MOVE_MEMBER_RESULT_42");
  }
}
`;
      }
      if (makeStaticFixture && tool === "maven") {
        reference["app/src/main/java/pkg/MakeStaticFixture.java"] = `package pkg;
public final class MakeStaticFixture {
  private int isolated() {
    return 42;
  }
}
`;
      }
      if (makePublicFixture && tool === "maven") {
        const method =
          makePublicFixture === "final-method"
            ? `  private final int isolated() {
    return 42;
  }`
            : `  private int flexible() {
    return 43;
  }`;
        reference["app/src/main/java/pkg/MakePublicFixture.java"] = `package pkg;
public ${makePublicFixture === "non-final-method-in-open-class" ? "class" : "final class"} MakePublicFixture {
${method}
}
`;
      }
      if (extractInterfaceFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ExtractInterfaceFixture.java"] = `package pkg;
public final class ExtractInterfaceFixture {
  public int calculate(int input) {
    return input * 2;
  }
}
`;
      }
      if (extractSuperclassFixture && tool === "maven") {
        reference["app/src/main/java/pkg/ExtractSuperclassFixture.java"] = `package pkg;
public class ExtractSuperclassFixture {
  public int calculate(int input) {
    return input * 2;
  }
}
`;
      }
      if (pullUpMemberFixture && tool === "maven") {
        reference["app/src/main/java/pkg/PullUpFixture.java"] = `package pkg;
class PullUpParent {
}
public final class PullUpFixture extends PullUpParent {
  public final int value() {
    return 42;
  }
}
`;
      }
      if (pushDownMemberFixture && tool === "maven") {
        reference["app/src/main/java/pkg/PushDownFixture.java"] = `package pkg;
abstract class PushDownParent {
  protected final int value() {
    return 42;
  }
}
final class PushDownFixture extends PushDownParent {
  int read() {
    return value();
  }
}
`;
      }
      if (encapsulateFieldFixture && tool === "maven") {
        reference["app/src/main/java/pkg/FieldEncapsulationFixture.java"] = `package pkg;
import java.util.List;
public final class FieldEncapsulationFixture {
  public final List<String> labels = List.of("one", "two");
}
`;
        reference["app/src/main/java/pkg/FieldEncapsulationClient.java"] = `package pkg;
public final class FieldEncapsulationClient {
  public int labelCount() {
    return new FieldEncapsulationFixture().labels.size();
  }
}
`;
        reference["app/src/test/java/pkg/FieldEncapsulationClientTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class FieldEncapsulationClientTest {
  @Test public void boundFieldReadUsesGetter() {
    assertEquals(2, new FieldEncapsulationClient().labelCount());
  }
}
`;
      }
      if (gradleCompositeProject && tool === "gradle" && testWorkflow) {
        const includedBuild = reference["included-build/build.gradle"];
        const appBuild = reference["app/build.gradle"];
        assert.ok(includedBuild?.includes("repositories { mavenCentral() }"));
        assert.ok(appBuild?.includes("implementation project(':library')"));
        const repositoryUrl = pathToFileURL(this.#repository).href.replaceAll("'", "%27");
        reference["included-build/build.gradle"] = includedBuild
          .replace(
            "repositories { mavenCentral() }",
            `repositories { mavenCentral(); maven { url = uri('${repositoryUrl}') } }`,
          )
          .replace(
            "tasks.withType(JavaCompile).configureEach { options.release = 17 }",
            "tasks.withType(JavaCompile).configureEach { options.release = 17 }\ntasks.withType(Test).configureEach { useJUnit() }",
          );
        if (gradleCompositeProject === "same-path-app") {
          reference[`${NESTED_COMPOSITE_BUILD}/app/src/main/java/pkg/Greeter.java`] =
            'package pkg;\npublic final class Greeter {\n  public static String message() { return "other-app"; }\n}\n';
          reference[`${NESTED_COMPOSITE_BUILD}/app/build.gradle`] +=
            `repositories { mavenCentral(); maven { url = uri('${repositoryUrl}') } }\n` +
            "dependencies { testImplementation 'junit:junit:4.13.2' }\n";
        }
        reference["app/build.gradle"] = appBuild.replace(
          "implementation project(':library')",
          "implementation project(':library')\n  testImplementation 'junit:junit:4.13.2'",
        );
        reference["app/src/test/java/pkg/RunnerTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class RunnerTest {
  @Test public void dependenciesOverloadsAndGeneratedSource() throws Exception {
    assertEquals("included-build", Greeter.message());
  }
  @Test public void testScopeAndSamePathSource() {
    assertEquals("included-build", Greeter.message());
  }
  @Test public void unrelatedModuleIsNotVisible() {
    assertEquals("included-build", Greeter.message());
  }
}
`;
        reference["app/src/main/java/pkg/Runner.java"] = `package pkg;
public final class Runner {
  public static String result() { return Greeter.message(); }
  public static void main(String[] args) throws Exception {
    System.out.println("LIBRARY_CODE_SOURCE:" + java.nio.file.Path.of(Greeter.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath());
    System.out.println("GRADLE_COMPOSITE_RUN_OK:" + result());
    System.out.println("PROJECT_GUI_JDK:" + System.getProperty("java.home"));
  }
}
`;
        reference["app/src/test/java/pkg/RunnerTest.java"] = reference[
          "app/src/test/java/pkg/RunnerTest.java"
        ]!.replaceAll("Greeter.message()", "Runner.result()");
      }
      if (gradlePackageMoveFixture && tool === "gradle") {
        const rootBuild = reference["build.gradle"];
        const appBuild = reference["app/build.gradle"];
        assert.ok(rootBuild?.includes("subprojects {"));
        assert.ok(appBuild?.includes("implementation project(':library')"));
        const repositoryUrl = pathToFileURL(this.#repository).href.replaceAll("'", "%27");
        reference["build.gradle"] =
          `${rootBuild}\nsubprojects {\n  repositories { maven { url = uri('${repositoryUrl}') } }\n}\n`;
        reference["app/build.gradle"] =
          `${appBuild}\ndependencies { testImplementation 'junit:junit:4.13.2' }\n`;
        reference["app/src/main/java/pkg/Runner.java"] = `package pkg;
public final class Runner {
  public static String result() { return Library.value(); }
  public static void main(String[] args) { System.out.println(result()); }
}
`;
        reference["app/src/test/java/pkg/RunnerTest.java"] = `package pkg;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class RunnerTest {
  @Test public void movedApplicationPackageStillPasses() {
    assertEquals("library", Runner.result());
  }
}
`;
      }
      if (testTemplateFrameworks && tool === "maven") {
        const appPom = reference["app/pom.xml"];
        assert.ok(appPom?.includes("</dependencies>"));
        reference["app/pom.xml"] = appPom.replace(
          "</dependencies>",
          `<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-api</artifactId><version>5.11.0</version><scope>test</scope></dependency>
        <dependency><groupId>org.testng</groupId><artifactId>testng</artifactId><version>7.10.2</version><scope>test</scope></dependency>${
          mockitoSpringTestTemplates
            ? `<dependency><groupId>org.mockito</groupId><artifactId>mockito-core</artifactId><version>5.20.0</version><scope>test</scope></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-test</artifactId><version>4.1.0</version><scope>test</scope></dependency>`
            : ""
        }</dependencies>`,
        );
      }
      if (testTemplateFrameworks && tool === "gradle") {
        const appBuild = reference["app/build.gradle"];
        assert.ok(appBuild?.includes("testImplementation 'junit:junit:4.13.2'"));
        reference["app/build.gradle"] = appBuild.replace(
          "testImplementation 'junit:junit:4.13.2'",
          `testImplementation 'junit:junit:4.13.2'\n  testImplementation 'org.junit.jupiter:junit-jupiter-api:5.11.2'\n  testImplementation 'org.testng:testng:7.10.2'${
            mockitoSpringTestTemplates
              ? "\n  testImplementation 'org.mockito:mockito-core:5.20.0'\n  testImplementation 'org.springframework.boot:spring-boot-test:4.1.0'"
              : ""
          }`,
        );
      }
      if (junitJupiterProjectTests) {
        if (tool === "maven") {
          const appPom = reference["app/pom.xml"];
          assert.ok(appPom?.includes("</dependencies>"));
          reference["app/pom.xml"] = appPom.replace(
            "</dependencies>",
            `<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-api</artifactId><version>5.11.2</version><scope>test</scope></dependency>
        <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-engine</artifactId><version>5.11.2</version><scope>test</scope></dependency>
        <dependency><groupId>org.junit.platform</groupId><artifactId>junit-platform-launcher</artifactId><version>1.11.2</version><scope>test</scope></dependency></dependencies>`,
          );
        } else {
          const rootBuild = reference["build.gradle"];
          const appBuild = reference["app/build.gradle"];
          assert.ok(rootBuild?.includes("useJUnit()"));
          assert.ok(appBuild?.includes("testImplementation 'junit:junit:4.13.2'"));
          reference["build.gradle"] = rootBuild.replace("useJUnit()", "useJUnitPlatform()");
          reference["app/build.gradle"] = appBuild.replace(
            "testImplementation 'junit:junit:4.13.2'",
            `testImplementation 'junit:junit:4.13.2'\n  testImplementation 'org.junit.jupiter:junit-jupiter-api:5.11.2'\n  testRuntimeOnly 'org.junit.jupiter:junit-jupiter-engine:5.11.2'\n  testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.11.2'`,
          );
        }
        reference["app/src/test/java/pkg/ProjectContextJupiterTest.java"] = `package pkg;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
public class ProjectContextJupiterTest {
  @Test void runsAgainstSynchronizedModule() throws Exception {
    assertEquals("hello JVM|count:2|generated-greeting|runtime-token|main-peer", Runner.result());
    assertEquals("value with spaces", System.getProperty("context.gui.literal"));
    assertEquals("literal environment", System.getenv("CONTEXT_GUI_ENV"));
    Files.writeString(Path.of("jupiter-project-test-proof.txt"), System.getProperty("java.home") + "|" + System.getProperty("context.gui.literal") + "|" + System.getenv("CONTEXT_GUI_ENV") + "\\n");
  }
}
`;
        this.#proof.synchronizedJupiterTestSourcePrepared = true;
      }
      if (testNgProjectTests) {
        if (tool === "maven") {
          const appPom = reference["app/pom.xml"];
          assert.ok(appPom?.includes("</dependencies>"));
          reference["app/pom.xml"] = appPom.replace(
            "</dependencies>",
            `<dependency><groupId>org.testng</groupId><artifactId>testng</artifactId><version>7.10.2</version><scope>test</scope></dependency></dependencies>`,
          );
        } else {
          const rootBuild = reference["build.gradle"];
          const appBuild = reference["app/build.gradle"];
          assert.ok(rootBuild?.includes("useJUnit()"));
          assert.ok(appBuild?.includes("testImplementation 'junit:junit:4.13.2'"));
          reference["build.gradle"] = rootBuild.replace("useJUnit()", "useTestNG()");
          reference["app/build.gradle"] = appBuild.replace(
            "testImplementation 'junit:junit:4.13.2'",
            `testImplementation 'junit:junit:4.13.2'\n  testImplementation 'org.testng:testng:7.10.2'`,
          );
        }
        reference["app/src/test/java/pkg/ProjectContextTestNgTest.java"] = `package pkg;
import java.nio.file.Files;
import java.nio.file.Path;
import org.testng.Assert;
import org.testng.annotations.Test;
public class ProjectContextTestNgTest {
  @Test public void runsAgainstSynchronizedModule() throws Exception {
    Assert.assertEquals(Runner.result(), "hello JVM|count:2|generated-greeting|runtime-token|main-peer");
    Assert.assertEquals(System.getProperty("context.gui.literal"), "value with spaces");
    Assert.assertEquals(System.getenv("CONTEXT_GUI_ENV"), "literal environment");
    Files.writeString(Path.of("testng-project-test-proof.txt"), System.getProperty("java.home") + "|" + System.getProperty("context.gui.literal") + "|" + System.getenv("CONTEXT_GUI_ENV") + "\\n");
  }
}
`;
        this.#proof.synchronizedTestNgTestSourcePrepared = true;
      }
      if (mixedJunitProjectTests) {
        if (tool === "maven") {
          const appPom = reference["app/pom.xml"];
          assert.ok(appPom?.includes("</dependencies>"));
          reference["app/pom.xml"] = appPom.replace(
            "</dependencies>",
            `<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-api</artifactId><version>5.11.2</version><scope>test</scope></dependency>
        <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-engine</artifactId><version>5.11.2</version><scope>test</scope></dependency>
        <dependency><groupId>org.junit.platform</groupId><artifactId>junit-platform-launcher</artifactId><version>1.11.2</version><scope>test</scope></dependency>
        <dependency><groupId>org.junit.vintage</groupId><artifactId>junit-vintage-engine</artifactId><version>5.11.2</version><scope>test</scope></dependency></dependencies>`,
          );
        } else {
          const rootBuild = reference["build.gradle"];
          const appBuild = reference["app/build.gradle"];
          assert.ok(rootBuild?.includes("useJUnit()"));
          assert.ok(rootBuild.includes("repositories { mavenCentral() }"));
          assert.ok(appBuild?.includes("testImplementation 'junit:junit:4.13.2'"));
          const repositoryUrl = pathToFileURL(this.#repository).href.replaceAll("'", "%27");
          reference["build.gradle"] = rootBuild
            .replace("useJUnit()", "useJUnitPlatform()")
            .replace(
              "repositories { mavenCentral() }",
              `repositories { maven { url = uri('${repositoryUrl}') }; mavenCentral() }`,
            );
          reference["app/build.gradle"] = appBuild.replace(
            "testImplementation 'junit:junit:4.13.2'",
            `testImplementation 'junit:junit:4.13.2'\n  testImplementation 'org.junit.jupiter:junit-jupiter-api:5.11.2'\n  testRuntimeOnly 'org.junit.jupiter:junit-jupiter-engine:5.11.2'\n  testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.11.2'\n  testRuntimeOnly 'org.junit.vintage:junit-vintage-engine:5.11.2'`,
          );
        }
        reference["app/src/test/java/pkg/ProjectContextJupiterTest.java"] = `package pkg;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
public class ProjectContextJupiterTest {
  @Test void runsAlongsideJUnit4Engine() throws Exception {
    assertEquals("hello JVM|count:2|generated-greeting|runtime-token|main-peer", Runner.result());
    assertEquals("value with spaces", System.getProperty("context.gui.literal"));
    assertEquals("literal environment", System.getenv("CONTEXT_GUI_ENV"));
    Files.writeString(Path.of("mixed-junit-project-test-proof.txt"), System.getProperty("java.home") + "|" + System.getProperty("context.gui.literal") + "|" + System.getenv("CONTEXT_GUI_ENV") + "\\n");
  }
}
`;
        this.#proof.synchronizedMixedJunitTestSourcePrepared = true;
      }
      if (testTemplateFrameworks && mockitoSpringTestTemplates && tool === "gradle") {
        const rootBuild = reference["build.gradle"];
        assert.ok(rootBuild?.includes("repositories { mavenCentral() }"));
        const repositoryUrl = pathToFileURL(this.#repository).href.replaceAll("'", "%27");
        reference["build.gradle"] = rootBuild.replace(
          "repositories { mavenCentral() }",
          `repositories { maven { url = uri('${repositoryUrl}') }; mavenCentral() }`,
        );
      }
      if (testTemplateFrameworks) {
        for (const probe of testTemplateProbes(tool))
          reference[probe.path.slice(`${tool}/`.length)] =
            `package pkg;\nclass ${probe.className} {\n}\n`;
        if (mockitoSpringTestTemplates) {
          reference["app/src/test/java/pkg/MockitoTemplateProbe.java"] = MOCKITO_TEMPLATE_SOURCE;
          reference["app/src/test/java/pkg/SpringBootTemplateProbe.java"] =
            SPRING_BOOT_TEMPLATE_SOURCE;
        }
      }
      if (customMavenOutputs && tool === "maven")
        reference["pom.xml"] = reference["pom.xml"]!.replace(
          "<build><plugins>",
          "<build><outputDirectory>${project.basedir}/products/main</outputDirectory><testOutputDirectory>${project.basedir}/products/test</testOutputDirectory><plugins>",
        );
      if (customMavenIntegrationTestSourceSet && tool === "maven") {
        const appPom = reference["app/pom.xml"];
        assert.ok(appPom?.includes("</plugins></build></project>"));
        const forkConfiguration = { app: "", library: "" };
        let appToolchainPlugin = "";
        if (mavenFailsafeJava8Fixture) {
          const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
          const legacyHome = await realpath(process.env.IDE_TEST_JAVA8_HOME!);
          const selectedJava = await realpath(path.join(this.#sdk, "bin/java"));
          forkConfiguration.app = `<configuration><argLine>-Dcontext.pom.option=preserved</argLine></configuration>`;
          appToolchainPlugin = `<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-toolchains-plugin</artifactId><version>3.3.0</version>
            <executions><execution><id>select-build-jdk</id><phase>validate</phase><goals><goal>toolchain</goal></goals></execution></executions>
            <configuration><toolchains><jdk><version>1.8</version></jdk></toolchains></configuration>
          </plugin>`;
          forkConfiguration.library = `<configuration><jvm>${escapeXml(selectedJava)}</jvm><jdkToolchain><version>1.8</version></jdkToolchain><argLine>-Dcontext.pom.option=library</argLine></configuration>`;
          reference["toolchains.xml"] = `<toolchains><toolchain><type>jdk</type><provides><version>1.8</version></provides><configuration><jdkHome>${escapeXml(legacyHome)}</jdkHome></configuration></toolchain></toolchains>`;
          const toolchains = this.file("maven/toolchains.xml");
          reference[".mvn/maven.config"] = `--toolchains\n${toolchains}\n--global-toolchains\n${toolchains}\n`;
        }
        const testProperties = mavenFailsafeProfile
          ? "<systemPropertyVariables><context.gui.literal>value with spaces</context.gui.literal></systemPropertyVariables>"
          : "";
        const buildHelperFailsafePlugins = (moduleName: "app" | "library") =>
          `<plugin><groupId>org.codehaus.mojo</groupId><artifactId>build-helper-maven-plugin</artifactId><version>3.6.1</version><executions><execution><id>integration-test-source</id><phase>generate-test-sources</phase><goals><goal>add-test-source</goal></goals><configuration><sources><source>src/integration-test/java</source></sources></configuration></execution></executions></plugin>
        <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version>${forkConfiguration[moduleName]}<executions><execution><id>integration-tests</id><phase>integration-test</phase><goals><goal>integration-test</goal><goal>verify</goal></goals><configuration><includes><include>**/*IT.java</include></includes><reportsDirectory>target/${moduleName === "app" ? "failsafe-reports" : "library-failsafe-reports"}</reportsDirectory><reportFormat>plain</reportFormat>${testProperties}</configuration></execution></executions></plugin>`;
        const appPlugins = buildHelperFailsafePlugins("app");
        const profile = mavenFailsafeProfile
          ? `<profiles><profile><id>app-integration</id><activation><activeByDefault>true</activeByDefault></activation><build><plugins>${appPlugins}</plugins></build></profile></profiles>`
          : "";
        reference["app/pom.xml"] = appPom.replace(
          "</plugins></build></project>",
          `${appToolchainPlugin}${profile ? "" : appPlugins}</plugins></build>${profile}</project>`,
        );
        const libraryPom = reference["library/pom.xml"];
        assert.ok(libraryPom?.includes("</project>"));
        reference["library/pom.xml"] = libraryPom.replace(
          "</project>",
          `<dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins>${buildHelperFailsafePlugins("library")}</plugins></build></project>`,
        );
        reference["app/src/integration-test/java/pkg/RunnerIT.java"] = `package pkg;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class RunnerIT {
  @Test public void savedSource() throws Exception {
    assertEquals("hello JVM|count:2|generated-greeting|runtime-token|main-peer", Runner.result());
    assertEquals("value with spaces", System.getProperty("context.gui.literal"));
    ${mavenFailsafeProfile ? 'assertEquals("IDE profile value", System.getProperty("context.gui.profileOption"));' : ""}
    ${mavenFailsafeJava8Fixture ? 'assertEquals("1.8", System.getProperty("java.specification.version"));\n    assertEquals("preserved", System.getProperty("context.pom.option"));' : ""}
    Files.write(Paths.get("target/maven-failsafe-context.pid"), Files.readSymbolicLink(Paths.get("/proc/self")).toString().getBytes(StandardCharsets.US_ASCII));
    Files.write(Paths.get("target/maven-failsafe-context-proof.txt"), (System.getProperty("java.home") + "|" + System.getProperty("context.gui.literal") + "\\n").getBytes(StandardCharsets.UTF_8));
    System.out.println("MAVEN_FAILSAFE_CONTEXT_IT_OK");
  }
}
`;
        reference["library/src/integration-test/java/fixtures/library/LibraryIT.java"] =
          `package fixtures.library;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class LibraryIT {
  @Test public void selectedModuleSourceSet() throws Exception {
    assertEquals("count:2", new GreetingService().message(2));
    assertEquals("value with spaces", System.getProperty("context.gui.literal"));
    ${mavenFailsafeJava8Fixture ? 'assertEquals("library", System.getProperty("context.pom.option"));' : ""}
    Files.write(Paths.get("target/maven-library-failsafe-context-proof.txt"), (System.getProperty("java.home") + "|" + System.getProperty("context.gui.literal") + "\\n").getBytes(StandardCharsets.UTF_8));
    System.out.println("MAVEN_LIBRARY_FAILSAFE_CONTEXT_IT_OK");
  }
}
`;
      }
      if (sourceRootMoveFixture && tool === "maven") {
        reference["unrelated/pom.xml"] = reference["unrelated/pom.xml"]!.replace(
          "</project>",
          `<dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies>
          <build><plugins><plugin><groupId>org.codehaus.mojo</groupId><artifactId>build-helper-maven-plugin</artifactId><version>3.6.1</version><executions><execution><id>extra-source-root</id><phase>generate-sources</phase><goals><goal>add-source</goal></goals><configuration><sources><source>src/extra/java</source><source>src/relocated/java</source></sources></configuration></execution></executions></plugin></plugins></build></project>`,
        );
        reference["unrelated/src/relocated/java/.keep"] = "";
      }
      if (sourceRootMoveFixture && tool === "gradle") {
        const rootBuild = reference["build.gradle"];
        assert.ok(rootBuild?.includes("repositories { mavenCentral() }"));
        const repositoryUrl = pathToFileURL(this.#repository).href.replaceAll("'", "%27");
        reference["build.gradle"] = rootBuild.replace(
          "repositories { mavenCentral() }",
          `repositories { maven { url = uri('${repositoryUrl}') }; mavenCentral() }`,
        );
        reference["unrelated/build.gradle"] =
          `${reference["unrelated/build.gradle"] ?? ""}\nsourceSets { main { java { srcDir 'src/extra/java' } } }\ndependencies { testImplementation 'junit:junit:4.13.2' }\n`;
      }
      if (sourceRootMoveFixture) {
        reference["unrelated/src/extra/java/fixtures/unrelated/Extra.java"] =
          `package fixtures.unrelated;\npublic final class Extra { public static String value() { return "extra-root"; } }\n`;
        reference["unrelated/src/test/java/fixtures/unrelated/ExtraSourceRootTest.java"] =
          `package fixtures.unrelated;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class ExtraSourceRootTest {
  @Test public void movedSourceRemainsAvailableToItsModuleTest() {
    assertEquals("extra-root", Extra.value());
    System.out.println("EXTRA_SOURCE_ROOT_TEST_OK");
  }
}
`;
      }
      if (customGradleTestSourceSet && tool === "gradle") {
        reference["app/build.gradle"] += `
sourceSets {
  integrationTest {
    compileClasspath += sourceSets.main.output + configurations.testRuntimeClasspath
    runtimeClasspath += output + compileClasspath
  }
}
configurations {
  integrationTestImplementation.extendsFrom testImplementation
  integrationTestRuntimeOnly.extendsFrom testRuntimeOnly
}
tasks.register('integrationTest', Test) {
  testClassesDirs = sourceSets.integrationTest.output.classesDirs
  classpath = sourceSets.integrationTest.runtimeClasspath
  workingDir projectDir
  systemProperty 'ide.fixture.sourceSet', 'integrationTest'
}
tasks.register('integrationTestDecoy', Test) {
  testClassesDirs = sourceSets.integrationTest.output.classesDirs
  classpath = sourceSets.test.runtimeClasspath
  workingDir projectDir
  systemProperty 'ide.fixture.sourceSet', 'decoy'
}
`;
        reference["app/src/integrationTest/java/pkg/IntegrationRunnerTest.java"] = `package pkg;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class IntegrationRunnerTest {
  @Test public void selectedTaskRan() throws Exception {
    assertEquals("integrationTest", System.getProperty("ide.fixture.sourceSet"));
    assertEquals("value with spaces", System.getProperty("context.gui.literal"));
    assertEquals("hello JVM|count:2|generated-greeting|runtime-token|main-peer", Runner.result());
    Files.writeString(Path.of("custom-gradle-test-proof.txt"), "integrationTest\\n");
  }
}
`;
        reference["app/src/integrationTest/java/pkg/IntegrationRunner.java"] = `package pkg;
public final class IntegrationRunner {
  public static void main(String[] args) throws Exception {
    System.out.println("INTEGRATION_SOURCE_SET_OK:" + Runner.result());
    System.out.println("PROJECT_GUI_JDK:" + System.getProperty("java.home"));
  }
}
`;
      }
      if (failedTestDebugFixture && failedTestDebugFramework === "jupiter" && tool === "gradle" &&
          tool === executionTool && this.#gradleRuntimeSdk && this.#gradleRuntimeSdk !== this.#gradleSdk) {
        const release = await readFile(path.join(this.#gradleSdk, "release"), "utf8");
        const major = /^JAVA_VERSION="(\d+)/mu.exec(release)?.[1];
        assert.ok(major, "The selected test JDK must report its Java version.");
        const rootBuild = reference["build.gradle"];
        assert.ok(rootBuild?.includes("options.release = 17"));
        reference["build.gradle"] = rootBuild.replaceAll("options.release = 17", `options.release = ${major}`) +
          `\nsubprojects { java { toolchain { languageVersion = JavaLanguageVersion.of(${major}) } } }\n`;
        reference["gradle.properties"] = `org.gradle.java.installations.paths=${this.#gradleSdk}\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\n`;
      }
      const debugPidFile = JSON.stringify(this.file(`${tool}/app/project-debug-pid.txt`));
      if (gradlePreviewProject && tool === "gradle" && this.#gradleRuntimeSdk &&
          this.#gradleRuntimeSdk !== this.#gradleSdk) {
        reference["build.gradle"] += `\nsubprojects { java { toolchain { languageVersion = JavaLanguageVersion.of(${gradlePreviewRelease}) } } }\n`;
        reference["gradle.properties"] += `org.gradle.java.installations.paths=${this.#gradleSdk}\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\n`;
      }
      for (const [relative, original] of Object.entries(reference)) {
        let text =
          forExecution && relative === "app/src/main/java/pkg/Runner.java"
            ? original.replace(
                "public static void main(String[] args) throws Exception {",
                'public static void main(String[] args) throws Exception {\n    System.out.println("PROJECT_GUI_JDK:" + System.getProperty("java.home"));',
              )
            : original;
        if (applicationWorkingDirectory && tool === executionTool) {
          if (relative === "app/src/main/java/pkg/Runner.java")
            text = text.replace("public static void main(String[] args) throws Exception {", `public static void main(String[] args) throws Exception {
    System.out.println("PROJECT_GUI_INPUT_PID:" + ProcessHandle.current().pid());
    System.out.println("PROJECT_GUI_INPUT_READY");
    byte[] input = System.in.readAllBytes();
    String encodedInput = java.util.Base64.getEncoder().encodeToString(input);
    java.nio.file.Files.writeString(java.nio.file.Path.of("synchronized-input-proof.txt"), encodedInput);
    System.out.println("PROJECT_GUI_INPUT_BYTES:" + encodedInput);
    String resource = java.nio.file.Files.readString(java.nio.file.Path.of("settings.txt"));
    String proof = java.util.UUID.randomUUID()+"|"+resource+"|"+java.nio.file.Path.of("").toRealPath()+"|"+java.nio.file.Path.of(System.getProperty("user.dir")).toRealPath()+"|"+java.nio.file.Files.readSymbolicLink(java.nio.file.Path.of("/proc/self/cwd"))+"|"+System.getProperty("java.home");
    java.nio.file.Files.writeString(java.nio.file.Path.of("synchronized-cwd-proof.txt"), proof);
`);
          if (relative === "app/src/test/java/pkg/RunnerTest.java")
            text = text.replace("dependenciesOverloadsAndGeneratedSource() throws Exception {", `dependenciesOverloadsAndGeneratedSource() throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("synchronized-test-cwd-proof.txt"), java.nio.file.Path.of("").toRealPath()+"|"+java.nio.file.Path.of(System.getProperty("user.dir")).toRealPath()+"|"+java.nio.file.Files.readSymbolicLink(java.nio.file.Path.of("/proc/self/cwd"))+"|"+System.getProperty("java.home"));
`);
        }
        if (forDebugger && relative === "app/src/main/java/pkg/Runner.java")
          text = text.replace(
            '    System.out.println("PROJECT_GUI_JDK:',
            (javaRelease === 8
              ? `    java.nio.file.Files.write(java.nio.file.Paths.get(${debugPidFile}), java.nio.file.Files.readSymbolicLink(java.nio.file.Paths.get("/proc/self")).toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII));\n`
              : `    java.nio.file.Files.writeString(java.nio.file.Path.of(${debugPidFile}), Long.toString(ProcessHandle.current().pid()));\n`) +
              '    System.out.println("PROJECT_GUI_JDK:',
          );
        if (forDebugger && relative === "app/src/integrationTest/java/pkg/IntegrationRunner.java")
          text = text.replace(
            '    System.out.println("INTEGRATION_SOURCE_SET_OK:',
            `    java.nio.file.Files.writeString(java.nio.file.Path.of(${debugPidFile}), Long.toString(ProcessHandle.current().pid()));\n    System.out.println("INTEGRATION_SOURCE_SET_OK:`,
          );
        if (
          savedImportsFixture &&
          relative === "app/src/main/java/pkg/Runner.java"
        )
          text = text.replace("package pkg;\n", "package pkg;\nimport java.util.List;\n");
        if (testWorkflow && relative === "app/src/test/java/pkg/RunnerTest.java") {
          for (const method of TEST_METHODS) {
            const signature = `${method}()${method === TEST_METHODS[0] ? " throws Exception" : ""} {`;
            assert.ok(text.includes(signature));
            text = text.replace(
              signature,
              `${signature}\n    try { java.nio.file.Files.write(java.nio.file.Paths.get("gui-proof-${method}.txt"), (System.getProperty("java.home") + "|" + System.getProperty("context.gui.literal") + "|" + System.getenv("CONTEXT_GUI_ENV") + "\\n").getBytes(java.nio.charset.StandardCharsets.UTF_8), java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND); } catch (java.io.IOException error) { throw new AssertionError(error); }`,
            );
          }
          if (testWorkflow === "rerun") {
            const signature = "testScopeAndSamePathSource() {";
            text = text.replace(
              signature,
              `${signature}\n    if (!"native-test-loader".equals(getClass().getClassLoader().getName())) {\n      fixtures.testloader.NamedTestInvocation.invoke(getClass(), "testScopeAndSamePathSource");\n      return;\n    }`,
            );
            text = text.replace(
              'assertEquals("test-token", TestToken.VALUE);',
              'assertEquals("deliberate-failure", TestToken.VALUE);',
            );
          }
        }
        if (
          gradleKotlinDslProject &&
          testWorkflow === "coverage" &&
          relative === "app/src/test/java/pkg/RunnerDslTest.java"
        ) {
          const assertion = 'assertEquals("from-gradle-library", pkg.Greeter.message());';
          assert.ok(text.includes(assertion));
          text = text.replace(assertion, `${assertion}\n    pkg.Runner.main(new String[0]);`);
        }
        if (selectedTestDebugFixture && tool === executionTool && relative === "app/src/test/java/pkg/RunnerTest.java") {
          text = `package pkg;
import java.nio.file.*;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class RunnerTest {
  @Test public void selectedDebugTest() throws Exception {
    int debugValue = 41;
    Files.createDirectories(Paths.get("target"));
    String pid = Files.readSymbolicLink(Paths.get("/proc/self")).toString();
    Files.write(Paths.get("target/selected-test-debug.pid"), pid.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    Files.write(Paths.get("target/selected-test-debug-result.txt"), ((debugValue + 1) + "\\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII), StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    assertEquals(42, debugValue + 1);
    System.out.println("SELECTED_TEST_DEBUG_OK");
  }
  @Test public void unselectedTest() { throw new AssertionError("The selected debug filter was lost"); }
}
`;
        }
        if (mavenTestIsolationFixture && relative === "library/pom.xml") {
          const scope = testWorkflow === "discover" ? "" : "<scope>test</scope>";
          text = text.replace("</project>", `<dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version>${scope}</dependency></dependencies></project>`);
        }
        if (failedTestDebugFixture && tool === executionTool && relative === "app/src/test/java/pkg/RunnerTest.java") {
          text = `package pkg;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class RunnerTest {
  static boolean broken = true;
  @Test public void firstFailure() throws Exception {
    int debugValue = 41;
    recordPid();
    assertEquals("first failure", false, broken);
    appendResult("failed-debug-results.txt", "first\\n");
  }
  @Test public void secondFailure() throws Exception {
    int debugValue = 41;
    recordPid();
    assertEquals("second failure", false, broken);
    appendResult("failed-debug-results.txt", "second\\n");
  }
  @Test public void alreadyPassed() throws Exception {
    appendResult("already-passed.txt", "once\\n");
  }
  private static void recordPid() throws Exception {
    Files.createDirectories(Paths.get("target"));
    String pid = Files.readSymbolicLink(Paths.get("/proc/self")).toString();
    Files.write(Paths.get("target/failed-debug.pid"), pid.getBytes(StandardCharsets.US_ASCII));
  }
  private static void appendResult(String file, String value) throws Exception {
    Files.createDirectories(Paths.get("target"));
    Files.write(Paths.get("target", file), value.getBytes(StandardCharsets.US_ASCII), StandardOpenOption.CREATE, StandardOpenOption.APPEND);
  }
}
`;
        }
        if (failedTestDebugFixture && tool === executionTool && failedTestDebugFramework !== "junit4") {
          const framework = failedTestDebugFramework;
          if (relative === "app/src/test/java/pkg/RunnerTest.java") {
            text = text.replace("import org.junit.Test;", framework === "jupiter" ? "import org.junit.jupiter.api.Test;" : "import org.testng.annotations.Test;");
            if (framework === "jupiter") text = text
              .replace("@Test public void firstFailure()", '@org.junit.jupiter.api.DisplayName("alreadyPassed()") @Test public void firstFailure()')
              .replace("@Test public void alreadyPassed()", '@org.junit.jupiter.api.DisplayName("secondFailure()") @Test public void alreadyPassed()');
          }
          if (relative === "app/pom.xml") {
            const dependency = framework === "jupiter"
              ? "<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.2</version><scope>test</scope></dependency>"
              : "<dependency><groupId>org.testng</groupId><artifactId>testng</artifactId><version>7.10.2</version><scope>test</scope></dependency>";
            assert.ok(text.includes("</dependencies>"));
            text = text.replace("</dependencies>", dependency + "</dependencies>");
          }
          if (relative === "app/build.gradle") {
            assert.ok(text.includes("dependencies {"));
            text = text.replace("dependencies {", "dependencies {\n" + (framework === "jupiter"
              ? "  testImplementation 'org.junit.jupiter:junit-jupiter:5.11.2'\n  testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.11.2'"
              : "  testImplementation 'org.testng:testng:7.10.2'"));
            text += `\ntasks.named('test') { ${framework === "jupiter" ? "useJUnitPlatform()" : "useTestNG()"} }\n`;
          }
        }
        if (failedTestDebugFixture && failedTestDebugFramework === "jupiter" && tool === "gradle" && tool === executionTool && relative === "library/build.gradle") {
          text += "\ndependencies { compileOnly 'org.junit.jupiter:junit-jupiter-api:5.11.2' }\n";
        }
        const additionalTopLevelTest = failedTestDebugFixture && failedTestDebugFramework === "jupiter" &&
          tool === executionTool && relative === "app/src/test/java/pkg/RunnerTest.java";
        if (additionalTopLevelTest) {
          const inheritance = inheritedDefaultTestMethod ? "implements" : "extends";
          text = text.replace("public class RunnerTest {", `public class TestCases {}\nclass RunnerTest ${inheritance} BaseChecks {`);
          const start = text.indexOf('  @org.junit.jupiter.api.DisplayName("secondFailure()") @Test public void alreadyPassed()');
          const end = text.indexOf("\n  }\n", start) + "\n  }\n".length;
          assert.ok(start > 0 && end > start);
          const inherited = text.slice(start, end)
            .replace("@Test public void alreadyPassed", inheritedDefaultTestMethod ? "@Test public default void alreadyPassed" : "@Test protected void alreadyPassed")
            .replace('    appendResult("already-passed.txt", "once\\n");', `    Files.createDirectories(Paths.get("target"));
    Files.writeString(Paths.get("target", "already-passed.txt"), "once\\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);`);
          text = text.slice(0, start) + text.slice(end);
          if (tool === "gradle") {
            const declarations = {
              "library/src/main/java/pkg/BaseChecks.java": `package pkg;\nimport java.nio.file.*;\nimport org.junit.jupiter.api.Test;\npublic ${inheritedDefaultTestMethod ? "interface" : "class"} BaseChecks {\n${inherited}}\n`,
              // Same binary name outside the producing source set must not win search.
              "library/src/test/java/pkg/BaseChecks.java": "package pkg;\npublic class BaseChecks { protected void alreadyPassed() { throw new AssertionError(\"wrong test source set\"); } }\n",
              "unrelated/src/main/java/pkg/BaseChecks.java": "package pkg;\npublic class BaseChecks { protected void alreadyPassed() { throw new AssertionError(\"wrong module\"); } }\n",
            };
            for (const [relative, contents] of Object.entries(declarations)) {
              const file = `${tool}/${relative}`;
              this.#inputs.set(file, contents);
              await mkdir(path.dirname(this.file(file)), { recursive: true });
              await writeFile(this.file(file), contents, { flag: "wx" });
            }
          } else text += `\nclass BaseChecks {\n${inherited}}\n`;
        }
        const file = `${tool}/${additionalTopLevelTest ? "app/src/test/java/pkg/TestCases.java" : relative}`;
        this.#inputs.set(file, text);
        await mkdir(path.dirname(this.file(file)), { recursive: true });
        await writeFile(this.file(file), text, { flag: "wx" });
      }
      if (mavenTestIsolationFixture) {
        const sibling = "maven/library/src/test/java/pkg/RunnerTest.java";
        const method = failedTestDebugFixture ? "firstFailure" : TEST_METHODS[1];
        const contents = `package pkg;
import java.nio.file.*;
import org.junit.Test;
public class RunnerTest {
  @Test public void ${method}() throws Exception {
    Files.writeString(Path.of("target/sibling-test-proof.txt"), "library",
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
  }
  @Test public void dependencyOnly() throws Exception {
    Files.writeString(Path.of("target/sibling-test-proof.txt"), "library-only",
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
  }
}
`;
        this.#inputs.set(sibling, contents);
        await mkdir(path.dirname(this.file(sibling)), { recursive: true });
        await writeFile(this.file(sibling), contents, { flag: "wx" });
        if (testWorkflow === "discover") {
          const libraryTest = "maven/library/src/main/java/pkg/RunnerTest.java";
          const libraryTestSource = `package pkg;
import org.junit.Test;
public class RunnerTest {
  @Test public void belongsToLibrary() { throw new AssertionError("dependency-only test"); }
  @Test public void testScopeAndSamePathSource() { throw new AssertionError("dependency class shadowed application test"); }
}
`;
          this.#inputs.set(libraryTest, libraryTestSource);
          await mkdir(path.dirname(this.file(libraryTest)), { recursive: true });
          await writeFile(this.file(libraryTest), libraryTestSource, { flag: "wx" });
        }
      }
      if (workspaceWrapper && tool === executionTool) {
        const name = tool === "maven" ? "mvnw" : "gradlew";
        const executable = tool === "maven" ? "mvn" : "gradle";
        const invocationRecord = this.wrapperInvocationRecord();
        const quotedRecord = `'${invocationRecord.replaceAll("'", "'\\''")}'`;
        const script = `#!/bin/sh\nset -eu\nprintf '%s\\n' 'IDE_WORKSPACE_WRAPPER:${tool}'\nprintf '%s\\n' 'IDE_WORKSPACE_WRAPPER:${tool}' > ${quotedRecord}\nexec ${executable} "$@"\n`;
        const relative = `${tool}/${name}`;
        this.#inputs.set(relative, script);
        await writeFile(this.file(relative), script, { flag: "wx", mode: 0o755 });
      }
      if ((gradleJpmsProject || gradleJpmsV5Project) && tool === "gradle") {
        const artifactDirectory = this.file("gradle/test-modules");
        const temporaryDirectory = this.file("gradle/.jpms-module-build");
        const sourceDirectory = path.join(temporaryDirectory, "source");
        const classesDirectory = path.join(temporaryDirectory, "classes");
        this.#gradleJpmsArtifactPath = path.join(artifactDirectory, "fixture-dependency.jar");
        await mkdir(path.join(sourceDirectory, "dependency/api"), { recursive: true });
        await mkdir(path.join(sourceDirectory, "dependency/internal"), { recursive: true });
        await writeFile(
          path.join(sourceDirectory, "module-info.java"),
          "module fixture.dependency { exports dependency.api; }\n",
          { flag: "wx" },
        );
        await writeFile(
          path.join(sourceDirectory, "dependency/api/DependencyApi.java"),
          "package dependency.api; public final class DependencyApi {}\n",
          { flag: "wx" },
        );
        await writeFile(
          path.join(sourceDirectory, "dependency/internal/SecretThing.java"),
          "package dependency.internal; public final class SecretThing {}\n",
          { flag: "wx" },
        );
        const compiler = path.join(this.#gradleSdk, "bin/javac");
        const jar = path.join(this.#gradleSdk, "bin/jar");
        await promisify(execFile)(
          compiler,
          [
            "--release",
            "21",
            "-d",
            classesDirectory,
            path.join(sourceDirectory, "module-info.java"),
            path.join(sourceDirectory, "dependency/api/DependencyApi.java"),
            path.join(sourceDirectory, "dependency/internal/SecretThing.java"),
          ],
          { env: { ...process.env, JAVA_HOME: this.#gradleSdk }, timeout: 20_000 },
        );
        await mkdir(artifactDirectory, { recursive: true });
        await promisify(execFile)(
          jar,
          ["--create", "--file", this.#gradleJpmsArtifactPath, "-C", classesDirectory, "."],
          { env: { ...process.env, JAVA_HOME: this.#gradleSdk }, timeout: 20_000 },
        );
        await rm(temporaryDirectory, { recursive: true, force: true });
        this.#gradleJpmsArtifactSha256 = createHash("sha256")
          .update(await readFile(this.#gradleJpmsArtifactPath))
          .digest("hex");
      }
    }
    if (mavenModuleRenamePreview) {
      // JDT LS import may create these output directories before the first build.
      await mkdir(this.file("maven/app/target/classes"), { recursive: true });
      await mkdir(this.file("maven/app/target/test-classes"), { recursive: true });
    }
    if (workspaceRootCoverage) {
      const files = {
        "src/main/java/pkg/Runner.java": "package pkg;\npublic final class Runner {\n  static int answer() { return 42; }\n}\n",
        "src/test/java/pkg/RunnerTest.java": "package pkg;\npublic final class RunnerTest {\n  @org.junit.Test public void answer() { org.junit.Assert.assertEquals(42, Runner.answer()); }\n}\n",
        ...(executionTool === "maven" ? {
          "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>fixture</groupId><artifactId>coverage-root</artifactId><version>1</version>
<properties><maven.compiler.release>17</maven.compiler.release></properties>
<dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies>
<build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin>
<plugin><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>\n`,
        } : {
          "settings.gradle": "rootProject.name = 'coverage-root'\n",
          "gradle.properties": "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
          "build.gradle": `plugins { id 'java' }
repositories { mavenCentral() }
dependencies { testImplementation 'junit:junit:4.13.2' }
tasks.withType(JavaCompile).configureEach { options.release = 17 }
`,
        }),
      };
      for (const [file, contents] of Object.entries(files)) {
        this.#inputs.set(file, contents);
        await mkdir(path.dirname(this.file(file)), { recursive: true });
        await writeFile(this.file(file), contents, { flag: "wx" });
      }
    }
    if (applicationWorkingDirectory) {
      for (const [directory, value] of [[APPLICATION_DIRECTORY_FIRST, "FIRST"], [APPLICATION_DIRECTORY_SECOND, "SECOND"]]) {
        const relative = `${directory}/settings.txt`;
        this.#inputs.set(relative, value);
        await mkdir(this.file(directory), { recursive: true });
        await writeFile(this.file(relative), value, { flag: "wx" });
      }
    }
    if (!forExecution && !skipBaselineMavenBuild) {
      await promisify(execFile)(
        "mvn",
        ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
        {
          cwd: this.file("maven"),
          env: { ...process.env, JAVA_HOME: this.#sdk },
          timeout: 30_000,
          maxBuffer: 512 * 1024,
        },
      );
      this.#proof.realMavenBuild = true;
    } else {
      await assert.rejects(
        access(
          this.file(
            executionTool === "maven"
              ? mavenJpmsV5Project
                ? "maven/target/classes/fixture/app/Main.class"
                : customMavenOutputs
                  ? "maven/app/products/main/pkg/Runner.class"
                  : "maven/app/target/classes/pkg/Runner.class"
              : customGradleOutputs
                ? "gradle/app/build/products/main/pkg/Runner.class"
                : "gradle/app/build/classes/java/main/pkg/Runner.class",
          ),
        ),
        {
          code: "ENOENT",
        },
      );
      if (forExecution) this.#proof.executionBeganWithoutCompiledOutputs = true;
    }
    for (const key of [
      "IDE_REFACTORKIT_DAEMON",
      "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE",
      "IDE_REFACTORKIT_ENGINE",
      "IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE",
    ])
      this.#originalEnvironment.set(key, process.env[key]);
    if (process.env.IDE_JAVA_CONTEXT_TRACE === "1") {
      const tracePathKey = "IDE_JAVA_CONTEXT_TRACE_PATH";
      this.#originalEnvironment.set(tracePathKey, process.env[tracePathKey]);
      process.env[tracePathKey] = path.join(
        this.#lease.runnerArtifactPath,
        "java-project-context-snapshot-trace.jsonl",
      );
      if (javaRelease === 26 || javaRelease === 27) {
        this.#contextTraceStart = await lstat(process.env[tracePathKey])
          .then((info) => info.size)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return 0;
            throw error;
          });
      }
    }
    process.env.IDE_REFACTORKIT_DAEMON = this.#proof.daemon;
    process.env.IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE = "1";
    process.env.IDE_REFACTORKIT_ENGINE = this.#engine;
    process.env.IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE = "1";
    await this.#lease.assertConfiguredPathsConfined();
  }
  private async createMavenJpmsV5DependencyArtifact() {
    assert.ok(this.#lease);
    const temporaryDirectory = path.join(this.#lease.paths.root, "maven-jpms-dependency-build");
    const sourceDirectory = path.join(temporaryDirectory, "source");
    const classesDirectory = path.join(temporaryDirectory, "classes");
    this.#mavenJpmsArtifactPath = path.join(
      this.#repository,
      "fixture/dependency/1/dependency-1.jar",
    );
    await mkdir(path.join(sourceDirectory, "dependency/api"), { recursive: true });
    await writeFile(
      path.join(sourceDirectory, "module-info.java"),
      "module fixture.dependency { exports dependency.api; }\n",
      { flag: "wx" },
    );
    await writeFile(
      path.join(sourceDirectory, "dependency/api/DependencyApi.java"),
      "package dependency.api; public final class DependencyApi {}\n",
      { flag: "wx" },
    );
    await promisify(execFile)(
      path.join(this.#sdk, "bin/javac"),
      [
        "--release",
        "21",
        "-d",
        classesDirectory,
        path.join(sourceDirectory, "module-info.java"),
        path.join(sourceDirectory, "dependency/api/DependencyApi.java"),
      ],
      { env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 20_000 },
    );
    await mkdir(path.dirname(this.#mavenJpmsArtifactPath), { recursive: true });
    await promisify(execFile)(
      path.join(this.#sdk, "bin/jar"),
      ["--create", "--file", this.#mavenJpmsArtifactPath, "-C", classesDirectory, "."],
      { env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 20_000 },
    );
    await writeFile(
      path.join(path.dirname(this.#mavenJpmsArtifactPath), "dependency-1.pom"),
      `<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>dependency</artifactId><version>1</version></project>\n`,
      { flag: "wx" },
    );
    this.#mavenJpmsArtifactSha256 = createHash("sha256")
      .update(await readFile(this.#mavenJpmsArtifactPath))
      .digest("hex");
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  async launchWithDirtyBuffer() {
    await this.launchWithJavaSource(this.#jpaQueryFixture !== "managed");
  }
  private async launchWithJavaSource(addDraft: boolean) {
    if (!this.#app) {
      this.#app = new NativeDesktopApplication();
      this.#surface = new NativeEditorSurface(this.#app);
      await this.#app.launch();
      await this.#app.waitForFileExplorer();
      if (process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland") {
        const collapse = this.browser().$('button[aria-label="Collapse bottom panel"]');
        if (await collapse.isExisting()) await collapse.click();
      }
    }
    await this.assertRefactorKitLaunchEnvironment();
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
    });
    if (process.env.IDE_JAVA_CONTEXT_TRACE === "1") {
      assert.equal(await this.#app.environmentValue("IDE_JAVA_CONTEXT_TRACE"), "1");
      assert.equal(
        await this.#app.environmentValue("IDE_JAVA_CONTEXT_TRACE_PATH"),
        process.env.IDE_JAVA_CONTEXT_TRACE_PATH,
      );
    }
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    const source = this.executionSource();
    const root = source.split("/")[0];
    await this.#app.waitForFileExplorer(`[role="treeitem"][data-path=${JSON.stringify(root)}]`);
    if (this.#jpaQueryFixture === "managed") {
      await this.browser().keys(["Control", "p"]);
      const quickOpen = this.browser().$('[role="dialog"][aria-label="Go to File"]');
      await pasteNativeText(this.#app, quickOpen.$('[aria-label="Search workspace files"]'), source);
      await quickOpen.$(`[role="option"][data-path="${source}"]`).click();
      await this.surface().assertBuffer(source, this.originalSource(source));
    } else {
      await this.openRefactoringSourceFromExplorer(
        source,
        this.originalSource(source),
        this.executionDraftReadBack(),
      );
    }
    if (addDraft) {
      await this.surface().focus(source);
      await this.browser().keys(["Control", "Home"]);
      await this.browser().keys(" ");
      await this.assertDraft(source);
    } else {
      await this.surface().assertDirty(source, false);
    }
    const tab = this.browser().$('[role="tab"][aria-label="Java Project"]');
    await tab.waitForDisplayed({ timeout: 5000 });
    await tab.click();
    await this.panel().waitForDisplayed({ timeout: 5000 });
  }
  async useStandardRefactorKitInstallation() {
    assert.ok(this.#lease);
    assert.equal(path.dirname(this.#engine), path.dirname(this.#proof.daemon));
    const share = path.join(this.#lease.paths.home, ".local/share");
    await mkdir(share, { recursive: true });
    await symlink(path.dirname(path.dirname(this.#engine)), path.join(share, "refactorkit"), "dir");
    for (const key of ["IDE_REFACTORKIT_LSP", "IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE"]) {
      this.#originalEnvironment.set(key, process.env[key]);
    }
    for (const key of [
      "IDE_REFACTORKIT_DAEMON",
      "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE",
      "IDE_REFACTORKIT_ENGINE",
      "IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE",
      "IDE_REFACTORKIT_LSP",
      "IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE",
    ])
      delete process.env[key];
    this.#standardInstallation = true;
  }
  private async assertRefactorKitLaunchEnvironment() {
    assert.ok(this.#app);
    if (this.#standardInstallation) {
      for (const key of [
        "IDE_REFACTORKIT_DAEMON",
        "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE",
        "IDE_REFACTORKIT_ENGINE",
        "IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE",
        "IDE_REFACTORKIT_LSP",
        "IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE",
      ] as const)
        assert.equal(await this.#app.environmentValue(key), undefined);
      assert.equal(await this.#app.environmentValue("HOME"), this.#lease!.paths.home);
      const searchPath = await this.#app.environmentValue("PATH");
      assert.ok(searchPath);
      for (const directory of searchPath.split(path.delimiter)) {
        assert.equal(
          await access(path.join(directory, "refactorkit"), constants.X_OK).then(
            () => true,
            () => false,
          ),
          false,
          "A PATH launcher would bypass the standard-installation discovery under test.",
        );
      }
    } else {
      assert.equal(
        await this.#app.environmentValue("IDE_REFACTORKIT_DAEMON"),
        this.#draftConfirmationInterruption?.wrapper ?? this.#proof.daemon,
      );
      assert.equal(await this.#app.environmentValue("IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE"), "1");
      assert.equal(await this.#app.environmentValue("IDE_REFACTORKIT_ENGINE"), this.#engine);
      assert.equal(await this.#app.environmentValue("IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE"), "1");
    }
  }
  async launchForProjectContext() {
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.assertRefactorKitLaunchEnvironment();
    await this.#app.waitForFileExplorer();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.panel().waitForDisplayed({ timeout: 5000 });
  }
  async assertStandardRefactorKitDiscovery() {
    assert.equal(this.#standardInstallation, true);
    const observedStatus = await this.browser().executeAsync((done) => {
      const bridge = (
        window as unknown as {
          __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__?.invoke;
      if (!bridge) return done({ error: "The native bridge is unavailable." });
      void bridge("get_refactorkit_status").then(done, (error) => done({ error: String(error) }));
    });
    const status = observedStatus as {
      available?: boolean;
      path?: string;
      version?: string;
      error?: string;
    };
    assert.equal(status.available, true);
    assert.equal(status.path, this.#engine);
    assert.match(status.version ?? "", /RefactorKit .*API 0\.2/);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const availability = this.browser().$('[aria-label="RefactorKit availability status"]');
    await availability.waitForDisplayed({ timeout: 10_000 });
    await this.browser().waitUntil(
      async () => (await availability.getText()).trim() === "Available",
      {
        timeout: 15_000,
        timeoutMsg:
          "The IDE did not present the automatically discovered RefactorKit installation as available.",
      },
    );
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    this.#proof.refactorKitStandardInstallationDiscovered = true;
  }
  private async invokeProjectContextCommand(label: string) {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), label);
    const command = palette.$(`[role="option"][aria-label^="${label}"]`);
    await command.waitForDisplayed({ timeout: 5_000 });
    await command.click();
    await palette.waitForExist({ reverse: true, timeout: 5_000 });
    await this.panel().waitForDisplayed({ timeout: 5_000 });
  }

  async launchAndSynchronizeFromCommands() {
    await this.launchWithDirtyBuffer();
    if (this.#executionTool === "maven") await this.synchronizeMaven(true);
    else {
      await this.fill('input[placeholder="Workspace root"]', "gradle");
      await this.fill('input[placeholder="Full JDK directory"]', this.#gradleSdk);
      await this.evaluateGradle(true, true);
    }
    this.#proof.projectContextCommandSynchronization.push(this.#executionTool);
    await this.assertDraft(this.executionSource());
    await this.assertInputs();
  }

  async assertProjectContextCommandSynchronization() {
    assert.ok(this.#proof.projectContextCommandSynchronization.includes(this.#executionTool));
    await this.assertDraft(this.executionSource());
    await this.assertInputs();
  }

  async launchSavedForRefactoring(prepareGradleOutputs = this.#gradleCompositeProject) {
    await this.launchWithJavaSource(false);
    if (this.#standardInstallation) await this.assertStandardRefactorKitDiscovery();
    if (this.#executionTool === "maven") {
      if (this.#mavenModuleOperationFixture) await this.synchronizeMavenForModuleOperations();
      else await this.synchronizeMaven();
    } else {
      if (this.#sourceRootMoveFixture) {
        const moduleSource = "gradle/unrelated/src/main/java/pkg/Peer.java";
        await this.openRefactoringSourceFromExplorer(moduleSource, this.originalSource(moduleSource));
      }
      await this.synchronizeGradleForExecution(prepareGradleOutputs);
    }
  }

  async restartAfterInlineMethodProviderUpgrade() {
    assert.ok(this.#standardInstallation && this.#lease && this.#app);
    const configured = process.env.IDE_JAVA_INLINE_METHOD_UPGRADE_DAEMON;
    assert.ok(configured && path.isAbsolute(configured), "Select the upgraded RefactorKit daemon.");
    const daemon = await realpath(configured);
    const engine = await realpath(path.join(path.dirname(daemon), "refactorkit"));
    assert.notEqual(daemon, this.#proof.daemon);
    await access(daemon, constants.X_OK);
    await access(engine, constants.X_OK);

    await this.assertInstalledInlineMethodCapability(false);
    await this.assertInputs();
    await this.close();
    await this.#app.assertExited();
    await this.#app.dispose();
    this.#app = undefined;
    this.#surface = undefined;

    const installation = path.join(this.#lease.paths.home, ".local/share/refactorkit");
    assert.equal(await readlink(installation), path.dirname(path.dirname(this.#engine)));
    const replacement = installation + ".next";
    await symlink(path.dirname(path.dirname(engine)), replacement, "dir");
    await rename(replacement, installation);
    this.#engine = this.#proof.engine = engine;
    this.#proof.daemon = daemon;

    await this.launchSavedForRefactoring();
    await this.assertInstalledInlineMethodCapability(true);
    await this.assertInputs();
  }

  private async assertInstalledInlineMethodCapability(expected: boolean) {
    const observed = await this.browser().executeAsync((done) => {
      const bridge = (
        window as unknown as {
          __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__?.invoke;
      if (!bridge) return done({ error: "The native bridge is unavailable." });
      void bridge("get_refactorkit_capabilities").then(done, (error) => done({ error: String(error) }));
    });
    const capabilities = observed as { error?: string; javaContextRefactoring?: { operations?: string[] } };
    assert.equal(capabilities.error, undefined);
    const operations = capabilities.javaContextRefactoring?.operations;
    assert.ok(operations && operations.includes("inlineVariable"), "The installed Java capability catalog is unavailable.");
    assert.equal(operations.includes("inlineMethod"), expected);
  }

  private async openRefactoringSourceFromExplorer(
    file: string,
    source: string,
    readBack: "rendered" | "clipboard" = "rendered",
  ) {
    const browser = this.browser();
    await browser.$('[role="tab"][aria-label="Files"]').click();
    const item = browser.$(`[role="treeitem"][data-path="${file}"]`);
    for (let depth = file.split("/").length; depth > 0; depth--) {
      const folderPath = await browser.waitUntil(async () => {
        if (await item.isDisplayed()) return file;
        return browser.execute((filePath) =>
          Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded="false"][data-path]'))
            .map((row) => row.getAttribute("data-path") ?? "")
            .find((folder) => folder && filePath.startsWith(`${folder}/`)) ?? false,
          file,
        );
      }, { timeout: 5_000, timeoutMsg: `The native file explorer did not reveal a path to ${file}` });
      if (folderPath === file) break;
      const folder = browser.$(`[role="treeitem"][data-path="${folderPath}"]`);
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "true") continue;
      await folder.scrollIntoView({ block: "center", inline: "nearest" });
      await folder.waitForClickable({ timeout: 5_000 });
      await folder.waitForStable({ timeout: 5_000 });
      await folder.click();
      await browser.waitUntil(
        async () => (await folder.getAttribute("aria-expanded")) === "true",
        { timeout: 5_000, timeoutMsg: `The native file explorer did not expand ${folderPath}` },
      );
    }
    await this.surface().open(file, source, readBack);
  }

  private async synchronizeReferenceWorkflow() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    if (this.#executionTool === "gradle") await this.synchronizeGradleForExecution();
    else await this.synchronizeMaven();
  }

  async buildAndTestReferenceWorkflow() {
    const gradle = this.#executionTool === "gradle";
    const target = gradle ? "gradle/app/build" : "maven/app/target";
    const compiled = this.file(gradle ? `${target}/classes/java/main/pkg/Runner.class` : `${target}/classes/pkg/Runner.class`);
    await assert.rejects(access(compiled), { code: "ENOENT" });
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    const generated = gradle
      ? "generated/sources/annotationProcessor/java/main"
      : "generated-sources/annotations";
    assert.match(
      await readFile(this.file(`${target}/${generated}/generated/GeneratedGreeting.java`), "utf8"),
      /class GeneratedGreeting/u,
    );
    await access(compiled);
    await this.synchronizeReferenceWorkflow();
    await this.configureSynchronizedExecution("test");
    await this.requestProjectExecution("Run tests");
    await this.waitProjectExecution("test", "succeeded");
    const count = gradle ? 4 : 3;
    await this.assertTestSummary(count, count, 0);
    await this.assertInputs();
  }

  async navigateToReferenceGeneratedMethod() {
    await this.synchronizeReferenceWorkflow();
    await this.assertGeneratedJavaMethodDefinition();
    await this.assertInputs();
  }

  async debugReferenceWorkflow() {
    const expectedSource = this.originalSource(this.executionSource());
    await this.synchronizeReferenceWorkflow();
    await this.startSynchronizedModuleDebugging();
    await this.assertSynchronizedModuleDebugEntry(expectedSource);
    await this.continueSynchronizedModuleDebugging();
    await this.assertSynchronizedModuleDebugBreakpoint();
    await this.continueSynchronizedModuleDebugging();
    await this.assertSynchronizedModuleDebugCompleted(expectedSource);
  }

  async moveReferenceWorkflowClass() {
    if (this.#executionTool === "gradle") {
      await this.synchronizeReferenceWorkflow();
      await this.applyRollbackGradleProjectModelClassMove(true);
      await this.assertGradleProjectModelClassMove(true);
      return;
    }
    await this.applyRollbackProjectModelMoveAndSafeDelete("project-model", true);
    assert.ok(this.#proof.sdkCrossModuleClassMoveUpdatedDependentModuleReference);
    assert.ok(this.#proof.sdkCrossModuleClassMoveSourceCopyCompiledAndTested);
    assert.ok(this.#proof.sdkCrossModuleClassMoveReviewedAppliedAndRolledBack);
  }

  async runRestoredReferenceWorkflow() {
    await this.synchronizeReferenceWorkflow();
    await this.runSynchronizedModule();
    await this.assertSynchronizedRun();
    await unlink(this.file(this.projectDebugPidFile()));
    await this.assertInputs();
  }

  async launchAndEvaluateGradleModuleCreateProject() {
    assert.equal(this.#gradleModuleCreatePreview, true);
    await this.launchAndEvaluateGradleModuleProject();
  }

  async launchAndEvaluateGradleModuleRenameProject() {
    assert.ok(this.#gradleModuleRenamePreview);
    await this.launchAndEvaluateGradleModuleProject();
  }

  private async launchAndEvaluateGradleModuleProject() {
    await this.launchWithDirtyBuffer();
    const source = this.executionSource();
    if (!this.#gradleModuleRenamePreview) await this.surface().discardUsingDisk(source, this.originalSource(source));
    await this.synchronizeGradle(true);

    const executable = await realpath(
      process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle",
    );
    const configuredHome = process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME;
    assert.ok(
      configuredHome && path.isAbsolute(configuredHome),
      "Set IDE_JAVA_CONTEXT_GRADLE_USER_HOME to the populated offline Gradle cache.",
    );
    const userHome = await realpath(configuredHome);
    const preparation = await promisify(execFile)(
      executable,
      [
        "--offline",
        "--no-daemon",
        "--console=plain",
        "-g",
        userHome,
        ":app:classes",
        ":app:testClasses",
      ],
      {
        cwd: this.file("gradle"),
        env: { ...process.env, JAVA_HOME: this.#gradleSdk },
        timeout: 120_000,
        maxBuffer: 512 * 1024,
      },
    );
    assert.match(preparation.stdout, /BUILD SUCCESSFUL/u, preparation.stdout);
    this.#proof.realGradleBuild = true;
    await this.evaluateGradle(false);
    const context = await this.panel().getText();
    assert.ok(context.includes("gradle-effective-v1 · available"), context);
    this.#proof.dirtyBufferPreservedWithoutSave = true;
  }

  async reviewGradleModuleRename() {
    assert.ok(this.#gradleModuleRenamePreview);
    const fixture = this.#gradleModuleRenamePreview;
    const mode = fixture === "app" ? "app" : "library";
    const updatesConsumer = fixture === "literal-library" || fixture === "application-library";
    const source = this.executionSource();
    const settings = `gradle/settings.gradle${this.#gradleModuleCreateDsl === "kotlin" ? ".kts" : ""}`;
    const original = this.#inputs.get(settings)!;
    const renamed = `:renamed-${mode}`;
    const openReview = async () => {
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      if (updatesConsumer) {
        await this.panel().$(".//p[contains(normalize-space(.), 'update supported literal project dependencies')]")
          .waitForExist({ timeout: 15_000 });
      }
      const selector = this.panel().$('select[aria-label="Gradle module to rename"]');
      await this.browser().waitUntil(() => selector.isEnabled(), { timeout: 15_000, interval: 100 });
      const options = await selector.$$("option").getElements();
      const labels = await options.map(option => option.getText());
      const choice = labels.find(label => label.startsWith(`:${mode} · `));
      assert.ok(choice, `Selected Gradle project :${mode} is missing: ${labels.join(", ")}`);
      await selector.selectByVisibleText(choice);
      await this.panel().$("button=Review Gradle Module Rename").click();
      const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
      await dialog.waitForDisplayed({ timeout: 5_000 });
      assert.equal(await dialog.$("h2").getText(), "Rename Gradle Module (experimental)");
      await pasteNativeText(this.#app!, dialog.$(".//label[span='New Gradle project path']/input"), renamed);
      await dialog.$("button=Preview").click();
      return dialog;
    };
    let dialog = await openReview();
    if (fixture === "dynamic-library") {
      await this.browser().waitUntil(async () => /old Gradle project identity|inbound Gradle project dependencies|incoming Gradle project dependencies/iu.test(await dialog.getText()), {
        timeout: 30_000, interval: 100, timeoutMsg: "The provider did not explain its inbound-dependency refusal",
      }).catch(async error => { throw new Error(`Gradle rename refusal: ${await dialog.getText()}`, { cause: error }); });
      assert.equal(await dialog.$("button=Apply").isEnabled(), false);
      await this.assertDraft(source); await this.assertInputs();
    } else {
      const waitForPreview = async () => this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
        timeout: 30_000, interval: 100, timeoutMsg: "Gradle rename did not produce an applicable preview",
      }).catch(async error => { throw new Error(`Gradle rename preview: ${await dialog.getText()}`, { cause: error }); });
      await waitForPreview();
      await dialog.$("button=Apply").click();
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Save or discard all open editor changes before applying a module change."), { timeout: 5_000, interval: 100 });
      assert.equal(await readFile(this.file(settings), "utf8"), original);
      await this.assertDraft(source); await this.assertInputs();
      this.#proof.gradleModuleRenameDirtyApplyRefused = true;
      await dialog.$("button=Cancel").click();
      await dialog.waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().discardUsingDisk(source, this.originalSource(source));
      dialog = await openReview();
      await waitForPreview();
      const pre = (await dialog.$$("pre").getElements())[0]; assert.ok(pre);
      assert.ok((await pre.getText()).includes(renamed));
      const consumerScript = `gradle/app/build.gradle${this.#gradleModuleCreateDsl === "kotlin" ? ".kts" : ""}`;
      const originalConsumer = this.originalSource(consumerScript);
      if (updatesConsumer) {
        assert.ok(originalConsumer.includes(":library"));
        assert.match(await dialog.getText(), /app\/build\.gradle/u);
        assert.equal(await readFile(this.file(consumerScript), "utf8"), originalConsumer);
      }
      await dialog.$("button=Apply").click();
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Refactoring applied successfully."), { timeout: 30_000, interval: 100 });
      const applied = await readFile(this.file(settings), "utf8");
      assert.ok(applied.includes(renamed)); assert.ok(applied.includes("projectDir"));
      await access(this.file(mode === "app" ? source : "gradle/library"));
      await assert.rejects(access(this.file(`gradle/renamed-${mode}`)), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      if (updatesConsumer) {
        assert.equal(await readFile(this.file(consumerScript), "utf8"), originalConsumer.replace(":library", renamed));
      }
      const copy = path.join(this.#lease!.runnerArtifactPath, `gradle-module-rename-${this.#gradleModuleCreateDsl}-source-copy`);
      await assert.rejects(access(copy), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      await cp(this.file("gradle"), copy, { recursive: true, filter: item => !["build", ".gradle", ".refactorkit"].includes(path.basename(item)) });
      const executable = await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle");
      const userHome = await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!);
      const tasks = fixture === "application-library" ? ["test", ":app:run"] : ["test"];
      const build = await promisify(execFile)(executable, ["--offline", "--no-daemon", "--console=plain", "-g", userHome, ...tasks], {
        cwd: copy, env: { ...process.env, JAVA_HOME: this.#gradleSdk }, timeout: 120_000, maxBuffer: 1024 * 1024,
      });
      await writeFile(path.join(this.#lease!.runnerArtifactPath, `gradle-module-rename-${this.#gradleModuleCreateDsl}-test.log`), build.stdout + build.stderr);
      assert.match(build.stdout, /BUILD SUCCESSFUL/u);
      assert.ok(build.stdout.includes(`${renamed}:compileJava`));
      if (fixture === "literal-library") {
        const classpath = ["app", "library"].map(module => path.join(copy, module, "build/classes/java/main"));
        const application = await promisify(execFile)(path.join(this.#gradleSdk, "bin/java"),
          ["-cp", classpath.join(path.delimiter), "pkg.Runner"], { cwd: copy, timeout: 20_000 });
        assert.equal(application.stdout.trim(), "library remains linked");
      } else if (fixture === "application-library") {
        assert.ok(build.stdout.includes(":app:test"));
        const kotlin = this.#gradleModuleCreateDsl === "kotlin";
        const suite = kotlin ? "pkg.RunnerDslTest" : "pkg.RunnerTest";
        const method = kotlin ? "kotlinDslConfiguredTaskRuns" : "dependenciesOverloadsAndGeneratedSource";
        const report = await readFile(path.join(copy, `app/build/test-results/test/TEST-${suite}.xml`), "utf8");
        assert.match(report, new RegExp(`<testcase\\b[^>]*\\bname="${method}(?:\\(\\))?"`, "u"));
        assert.doesNotMatch(report, /<(?:failure|error|skipped)\b/u);
        assert.match(build.stdout, kotlin
          ? /GRADLE_KOTLIN_DSL_MAIN:from-gradle-library:/u
          : /JAVA_REFERENCE_OK:hello JVM\|count:2\|generated-greeting\|runtime-token\|main-peer\|base/u);
      }
      await dialog.$("button=Rollback").click();
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Refactoring rolled back."), { timeout: 60_000, interval: 100 });
      assert.equal(await readFile(this.file(settings), "utf8"), original);
      await this.assertInputs();
      await this.surface().assertBuffer(source, this.originalSource(source));
      await this.surface().assertDirty(source, false);
    }
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    this.#proof.gradleModuleRenameQualified.push(`${this.#gradleModuleCreateDsl}:${fixture}`);
  }

  async assertGradleModuleRename() {
    assert.ok(this.#gradleModuleRenamePreview);
    assert.ok(this.#proof.gradleModuleRenameQualified.includes(`${this.#gradleModuleCreateDsl}:${this.#gradleModuleRenamePreview}`));
    if (this.#gradleModuleRenamePreview !== "dynamic-library") {
      assert.equal(this.#proof.gradleModuleRenameDirtyApplyRefused, true);
    }
    await this.assertInputs();
  }

  async applyVerifyAndRollbackGradleModuleCreate() {
    assert.equal(this.#gradleModuleCreatePreview, true);
    const moduleProjectPath = ":native-parent:core";
    const moduleDirectory = this.file("gradle/native-parent/core");
    const settingsRelativePath =
      this.#gradleModuleCreateDsl === "kotlin"
        ? "gradle/settings.gradle.kts"
        : "gradle/settings.gradle";
    const settingsPath = this.file(settingsRelativePath);
    const originalSettings = this.#inputs.get(settingsRelativePath);
    assert.ok(originalSettings, `The ${this.#gradleModuleCreateDsl} settings fixture is missing`);
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings);

    const buildRootSelect = this.panel().$('select[aria-label="Gradle build for new module"]');
    await this.browser().waitUntil(() => buildRootSelect.isEnabled(), {
      timeout: 10_000,
      interval: 50,
      timeoutMsg: "The Gradle Add Module build selector stayed busy after synchronization",
    });
    const buildOptions = await buildRootSelect.$$("option").getElements();
    const buildLabels = await buildOptions.map((option) => option.getText());
    const expectedBuildRoot = path.dirname(settingsRelativePath);
    const rootLabel = buildLabels.find((label) => label === expectedBuildRoot);
    assert.ok(
      rootLabel,
      `The synchronized Gradle build at ${expectedBuildRoot} was not offered: ${buildLabels.join(", ")}`,
    );
    await buildRootSelect.selectByVisibleText(rootLabel);
    await this.panel().$("button=Review Add Module").click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await dialog.$("h2").getText(), "Add Gradle Module");
    const projectPathInput = dialog.$(
      '//label[.//span[normalize-space(.)="Gradle project path"]]/input',
    );
    await projectPathInput.setValue(moduleProjectPath);
    assert.equal(await projectPathInput.getValue(), moduleProjectPath);
    await dialog.$("button=Preview").click();
    try {
      await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "RefactorKit did not produce an applicable Gradle Add Module preview",
      });
    } catch (error) {
      const details = await dialog
        .getText()
        .catch(() => "The preview dialog is no longer visible.");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nGradle Add Module dialog:\n${details}`, { cause: error });
    }

    const expectedBuildScript =
      this.#gradleModuleCreateDsl === "kotlin"
        ? 'plugins { id("java") }\n'
        : "plugins { id 'java' }\n";
    const settingsInclude =
      this.#gradleModuleCreateDsl === "kotlin"
        ? `include("${moduleProjectPath}")`
        : `include '${moduleProjectPath}'`;
    const previewText = await dialog.getText();
    assert.ok(previewText.includes(moduleProjectPath), previewText);
    assert.ok(previewText.includes("build.gradle"), previewText);
    await assert.rejects(access(moduleDirectory), { code: "ENOENT" });
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings);

    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "RefactorKit did not apply the reviewed Gradle Add Module transaction",
      },
    );
    const createdBuildScript =
      this.#gradleModuleCreateDsl === "kotlin"
        ? path.join(moduleDirectory, "build.gradle.kts")
        : path.join(moduleDirectory, "build.gradle");
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings + settingsInclude + "\n");
    assert.equal(await readFile(createdBuildScript, "utf8"), expectedBuildScript);
    assert.equal(await dialog.$("button=Rollback").isEnabled(), true);

    const copy = path.join(
      this.#lease!.runnerArtifactPath,
      `gradle-module-create-${this.#gradleModuleCreateDsl}-source-copy`,
    );
    await cp(this.file("gradle"), copy, {
      recursive: true,
      filter: (sourcePath) =>
        !["build", ".gradle", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const copiedSource = path.join(copy, "native-parent/core/src/main/java/pkg/NativeModule.java");
    await mkdir(path.dirname(copiedSource), { recursive: true });
    await writeFile(
      copiedSource,
      "package pkg; public final class NativeModule { public static int answer() { return 42; } }\n",
      { flag: "wx" },
    );
    const configuredHome = process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME;
    assert.ok(configuredHome && path.isAbsolute(configuredHome));
    const build = await promisify(execFile)(
      await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle"),
      [
        "--offline",
        "--no-daemon",
        "--console=plain",
        "-g",
        await realpath(configuredHome),
        ":native-parent:core:classes",
      ],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#gradleSdk },
        timeout: 120_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(
        this.#lease!.runnerArtifactPath,
        `gradle-module-create-${this.#gradleModuleCreateDsl}.log`,
      ),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESSFUL/u, build.stdout);
    await access(
      path.join(copy, "native-parent/core/build/classes/java/main/pkg/NativeModule.class"),
    );
    this.#proof.gradleModuleCreateSourceCopyCompiled = true;

    await dialog.$("button=Rollback").click();
    try {
      await this.browser().waitUntil(
        async () => (await dialog.getText()).includes("Refactoring rolled back."),
        {
          timeout: 30_000,
          interval: 100,
          timeoutMsg: "RefactorKit did not roll back the Gradle Add Module transaction",
        },
      );
    } catch (error) {
      const details = await dialog
        .getText()
        .catch(() => "The preview dialog is no longer visible.");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nGradle Add Module dialog:\n${details}`, { cause: error });
    }
    await assert.rejects(access(moduleDirectory), { code: "ENOENT" });
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    this.#proof.gradleModuleCreateReviewedAppliedAndRolledBack = true;
  }

  async assertGradleModuleCreateAppliedAndRolledBack() {
    assert.equal(this.#proof.gradleModuleCreateReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.gradleModuleCreateSourceCopyCompiled, true);
    const settingsRelativePath =
      this.#gradleModuleCreateDsl === "kotlin"
        ? "gradle/settings.gradle.kts"
        : "gradle/settings.gradle";
    assert.equal(
      await readFile(this.file(settingsRelativePath), "utf8"),
      this.#inputs.get(settingsRelativePath),
    );
    await assert.rejects(access(this.file("gradle/native-parent/core")), { code: "ENOENT" });
    await this.assertInputs();
  }

  async applyRollbackExtractConstant() {
    await this.applyRollbackExpressionExtraction("constant");
  }

  async applyRollbackInlineRefactoring(
    operationName: "inlineVariable" | "inlineConstant" | "inlineMethod",
  ) {
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().open(source, original);
    const collapseBottomPanel = this.browser().$('button[aria-label="Collapse bottom panel"]');
    if (await collapseBottomPanel.isDisplayed()) await collapseBottomPanel.click();

    for (const operation of [
      {
        operation: "inlineVariable" as const,
        identifier: "local",
        label: "Review inlining the selected Java local",
        result: /return 42 \+ ANSWER;/u,
        sourceCopy: "sdk-inline-variable-source-copy",
        proof: "sdkInlineVariableReviewedAppliedAndRolledBack" as const,
      },
      {
        operation: "inlineConstant" as const,
        identifier: "ANSWER",
        label: "Review inlining the selected Java constant",
        result: /return local \+ 42;/u,
        sourceCopy: "sdk-inline-constant-source-copy",
        proof: "sdkInlineConstantReviewedAppliedAndRolledBack" as const,
      },
      {
        operation: "inlineMethod" as const,
        identifier: "inlineValue",
        label: "Review Java Inline Method at cursor",
        result: /return \(?40 \+ 2\)?;/u,
        sourceCopy: "sdk-inline-method-source-copy",
        proof: "sdkInlineMethodReviewedAppliedAndRolledBack" as const,
      },
    ].filter((operation) => operation.operation === operationName)) {
      await this.surface().selectText(source, operation.identifier);
      if (operation.operation === "inlineMethod")
        await this.browser().keys(["ArrowLeft", "ArrowRight", "ArrowRight", "ArrowRight"]);
      await this.browser().keys(["Shift", "F10"]);
      let menuPoint: { x: number; y: number } | null = null;
      await this.browser().waitUntil(
        async () => {
          menuPoint = await this.surface().contextMenuItem(operation.label);
          return menuPoint !== null;
        },
        { timeout: 10_000, interval: 100, timeoutMsg: `${operation.label} was not offered` },
      );
      await this.browser()
        .action("pointer")
        .move({ ...menuPoint!, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
      const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
      await dialog.waitForDisplayed({ timeout: 5_000 });
      const dialogText = await dialog.getText();
      if (operation.operation === "inlineMethod") {
        const targetInputs = await dialog.$$("input");
        assert.match(
          await targetInputs[0]?.getValue(),
          /(?:^|\/)app\/src\/main\/java\/pkg\/InlineFixture\.java$/u,
        );
        assert.equal(await targetInputs[1]?.getValue(), "@cursor");
      } else {
        assert.ok(dialogText.includes(operation.identifier));
      }
      await dialog.$("button=Preview").click();
      await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: `${operation.label} preview did not become applicable`,
      });
      assert.ok((await dialog.$$("pre").getElements()).length > 0, "provider diff is not visible");
      await this.assertInputs();
      await dialog.$("button=Apply").click();
      await dialog
        .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring applied successfully.')]")
        .waitForDisplayed({ timeout: 45_000, timeoutMsg: `${operation} did not report a successful Apply` });

      const applied = await readFile(this.file(source), "utf8");
      if (operation.operation === "inlineVariable") {
        assert.doesNotMatch(applied, /int local\s*=/u);
      } else if (operation.operation === "inlineConstant") {
        assert.doesNotMatch(applied, /private static final int ANSWER\s*=/u);
      } else {
        assert.doesNotMatch(applied, /private static int inlineValue\s*\(/u);
      }
      assert.match(applied, operation.result);
      const copy = path.join(this.#lease!.runnerArtifactPath, operation.sourceCopy);
      await cp(this.file("maven"), copy, {
        recursive: true,
        filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
      });
      const build = await promisify(execFile)(
        "mvn",
        ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
        {
          cwd: copy,
          env: { ...process.env, JAVA_HOME: this.#sdk },
          timeout: 30_000,
          maxBuffer: 512 * 1024,
        },
      );
      await writeFile(
        path.join(this.#lease!.runnerArtifactPath, `${operation.sourceCopy}.log`),
        build.stdout + build.stderr,
      );
      assert.match(build.stdout, /BUILD SUCCESS/u);

      await dialog.$("button=Rollback").click();
      await this.browser().waitUntil(
        async () => (await dialog.getText()).includes("Refactoring rolled back."),
        { timeout: 60_000, interval: 100 },
      );
      assert.equal(await readFile(this.file(source), "utf8"), original);
      await dialog.$("button=Cancel").click();
      await dialog.waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().assertBuffer(source, original);
      await this.surface().assertDirty(source, false);
      this.#proof[operation.proof] = true;
    }
  }

  async applyRollbackExtractVariable() {
    await this.applyRollbackExpressionExtraction("variable");
  }

  async applyRollbackParameterObject() {
    assert.ok(this.#lease);
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.openRefactoringSourceFromExplorer(source, original);
    await this.surface().selectText(source, "combine");
    await this.browser().keys(["ArrowLeft", "ArrowRight", "ArrowRight"]);
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    const label = "Review Java Introduce Parameter Object";
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), label);
    await palette.$(`[role="option"][aria-label^="${label}"]`).click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog.$("label=Parameter object type name").$("input").setValue("Arguments");
    await dialog.$("label=First parameter name").$("input").setValue("left");
    await dialog.$("label=Second parameter name").$("input").setValue("right");
    await dialog.$("button=Preview").click();
    await dialog.$("button=Apply").waitForEnabled({ timeout: 20_000 });
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring applied successfully.')]")
      .waitForDisplayed({ timeout: 45_000 });
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /private static final class Arguments\b/u);
    assert.match(applied, /combine\(\s*new Arguments\(\s*left\s*,\s*right\s*\)\s*\)/u);
    const copy = path.join(this.#lease.runnerArtifactPath, "parameter-object-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (entry) => !["target", ".refactorkit"].includes(path.basename(entry)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      { cwd: copy, env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 30_000 },
    );
    await writeFile(`${copy}.log`, build.stdout + build.stderr);
    assert.match(build.stdout, /BUILD SUCCESS/u);
    const report = await readFile(
      path.join(copy, "app/target/surefire-reports/TEST-pkg.ParameterObjectFixtureTest.xml"),
      "utf8",
    );
    assert.match(report, /name="preservesArgumentOrder"/u);
    await dialog.$("button=Rollback").click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring rolled back.')]")
      .waitForDisplayed({ timeout: 60_000 });
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
  }

  async applyRollbackExtractDelegate() {
    assert.ok(this.#lease);
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.openRefactoringSourceFromExplorer(source, original);
    const reviewDelegate = async (members: string) => {
      await this.surface().selectText(source, "compute");
      await this.browser().keys(["ArrowLeft", "ArrowRight", "ArrowRight"]);
      await this.browser().$("button=Commands").click();
      const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
      await palette.waitForDisplayed({ timeout: 5_000 });
      const label = "Review Java Extract Delegate";
      await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), label);
      await palette.$(`[role="option"][aria-label^="${label}"]`).click();

      const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
      await dialog.waitForDisplayed({ timeout: 5_000 });
      await dialog.$("label=Delegate type name").$("input").setValue("Calculation");
      await dialog.$("label=Member names (comma-separated)").$("input").setValue(members);
      await dialog.$("button=Preview").click();
      return dialog;
    };

    const incompleteGroup = await reviewDelegate("adjust,compute");
    await incompleteGroup.$(".//*[@role='alert'][contains(., 'unselected member OFFSET')]")
      .waitForDisplayed({ timeout: 30_000 });
    assert.equal(await incompleteGroup.$("button=Apply").isEnabled(), false);
    await this.assertInputs();
    await incompleteGroup.$("button=Cancel").click();
    const dialog = await reviewDelegate("OFFSET,adjust,compute");
    await dialog.$("button=Apply").waitForEnabled({ timeout: 30_000 });
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring applied successfully.')]")
      .waitForDisplayed({ timeout: 45_000 });
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /private static final class Calculation\b/u);
    assert.match(applied, /public static int answer\(int n\)\s*\{\s*return Calculation\.compute\(n\);/u);
    const copy = await this.verifyAppliedJavaCopy(`extract-delegate-${this.#executionTool}-source-copy`);
    const reportDirectory = this.#executionTool === "maven" ? "target/surefire-reports" : "build/test-results/test";
    const testClass = "pkg.ExtractDelegateFixtureTest";
    const report = await readNativeJUnitReport(
      copy, `app/${reportDirectory}/TEST-${testClass}.xml`, "", testClass, testClass, "preservesAnswer",
    );
    assert.equal(report.tests, 1);
    assert.equal(report.failures + report.errors + report.skipped, 0);
    assert.equal(report.caseFailure, false);
    await dialog.$("button=Rollback").click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring rolled back.')]")
      .waitForDisplayed({ timeout: 60_000 });
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
  }

  private async verifyAppliedJavaCopy(name: string) {
    const copy = path.join(this.#lease!.runnerArtifactPath, name);
    const buildTool = this.#executionTool;
    const excludedDirectories = buildTool === "maven"
      ? ["target", ".refactorkit"]
      : ["build", ".gradle", ".refactorkit"];
    await cp(this.file(buildTool), copy, {
      recursive: true,
      filter: (sourcePath) => !excludedDirectories.includes(path.basename(sourcePath)),
    });
    const build = buildTool === "maven"
      ? await promisify(execFile)(
          process.env.IDE_JAVA_CONTEXT_TEST_MAVEN ?? "mvn",
          ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
          {
            cwd: copy,
            env: { ...process.env, JAVA_HOME: this.#sdk },
            timeout: 30_000,
            maxBuffer: 512 * 1024,
          },
        )
      : await promisify(execFile)(
          await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle"),
          ["--offline", "--no-daemon", "--console=plain", "-g",
            await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!), "test"],
          {
            cwd: copy,
            env: { ...process.env, JAVA_HOME: this.#gradleRuntimeSdk || this.#gradleSdk },
            timeout: 120_000,
            maxBuffer: 512 * 1024,
          },
        );
    await writeFile(`${copy}.log`, build.stdout + build.stderr);
    assert.match(build.stdout, buildTool === "maven" ? /BUILD SUCCESS/u : /BUILD SUCCESSFUL/u);
    return copy;
  }

  async applyRollbackExtractMethod() {
    await this.applyRollbackExpressionExtraction("method");
  }

  async applyRollbackExtractParameter() {
    await this.applyRollbackExpressionExtraction("parameter");
  }

  async applyRollbackExtractField() {
    await this.applyRollbackExpressionExtraction("field");
  }

  private async openCursorParameterRefactoringDialog(
    source: string,
    original: string,
    actionLabel: string,
    methodSignature = "combine(int first, int second)",
    cursorToken = "combine",
    entryPoint: "context-menu" | "command-palette" = "context-menu",
    requireElementIdentity = true,
  ) {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().open(source, original);
    if (this.#parameterReorderFixture)
      this.#mavenManifestAfterParameterSourceOpen = await this.fileManifest(this.file("maven"));
    const collapseBottomPanel = this.browser().$('button[aria-label="Collapse bottom panel"]');
    if (await collapseBottomPanel.isDisplayed()) await collapseBottomPanel.click();

    const lines = original.split("\n");
    const methodLine = lines.findIndex((line) => line.includes(methodSignature));
    assert.ok(methodLine >= 0, `cursor fixture has no method matching ${methodSignature}`);
    const methodColumn = lines[methodLine].indexOf(cursorToken) + 2;
    await this.surface().focus(source);
    await this.browser().keys(["Control", "Home"]);
    const moves = [
      ...Array.from({ length: methodLine }, () => "\uE015"),
      ...Array.from({ length: methodColumn }, () => "\uE014"),
    ].flatMap((value) => [
      { type: "keyDown" as const, value },
      { type: "keyUp" as const, value },
    ]);
    try {
      await this.browser().performActions([
        { type: "key", id: "java-parameter-reorder-cursor", actions: moves },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await cursor.getText()).trim() === `Ln ${methodLine + 1}, Col ${methodColumn + 1}`,
      { timeout: 5_000, interval: 100, timeoutMsg: "Monaco cursor did not reach the method" },
    );
    if (entryPoint === "command-palette") {
      await this.browser().$("button=Commands").click();
      const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
      await palette.waitForDisplayed({ timeout: 5_000 });
      await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), actionLabel);
      const command = palette.$(`[role="option"][aria-label^="${actionLabel}"]`);
      await command.waitForDisplayed({ timeout: 10_000 });
      await command.click();
      await palette.waitForExist({ reverse: true, timeout: 5_000 });
    } else {
      await this.browser().keys(["Shift", "F10"]);
      let menuPoint: { x: number; y: number } | null = null;
      await this.browser().waitUntil(
        async () => {
          menuPoint = await this.surface().contextMenuItem(actionLabel);
          return menuPoint !== null;
        },
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: `Cursor-based refactoring action ${actionLabel} was not offered`,
        },
      );
      await this.browser()
        .action("pointer")
        .move({ ...menuPoint!, origin: "viewport" })
        .down({ button: 0 })
        .up({ button: 0 })
        .perform();
    }

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    if (requireElementIdentity) {
      const targetIdentity = dialog.$(".//label[span='Element identity']/input");
      assert.equal(await targetIdentity.isEnabled(), false);
      assert.equal(await targetIdentity.getValue(), "@cursor");
    }
    return dialog;
  }

  private async openCursorSavedClassExtractionDialog(
    source: string,
    original: string,
    className = "ExtractInterfaceFixture",
    actionLabel = "Review Java interface extraction at cursor",
    nameFieldLabel = "Interface name",
  ) {
    await this.browser().$("[role='tab'][aria-label='Files']").click();
    await this.surface().open(source, original);
    const collapseBottomPanel = this.browser().$("button[aria-label='Collapse bottom panel']");
    if (await collapseBottomPanel.isDisplayed()) await collapseBottomPanel.click();

    const lines = original.split("\n");
    const classLine = lines.findIndex((line) => line.includes(`class ${className}`));
    assert.ok(classLine >= 0, `${className} fixture class declaration is missing`);
    const classColumn = lines[classLine].indexOf(className) + 2;
    await this.surface().focus(source);
    await this.browser().keys(["Control", "Home"]);
    const moves = [
      ...Array.from({ length: classLine }, () => "\uE015"),
      ...Array.from({ length: classColumn }, () => "\uE014"),
    ].flatMap((value) => [
      { type: "keyDown" as const, value },
      { type: "keyUp" as const, value },
    ]);
    try {
      await this.browser().performActions([
        { type: "key", id: "java-saved-class-extraction-cursor", actions: moves },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    const cursor = this.browser().$("[data-testid='editor-cursor-position']");
    await this.browser().waitUntil(
      async () => (await cursor.getText()).trim() === `Ln ${classLine + 1}, Col ${classColumn + 1}`,
      { timeout: 5_000, interval: 100, timeoutMsg: "Monaco cursor did not reach the class name" },
    );
    await this.browser().keys(["Shift", "F10"]);
    let menuPoint: { x: number; y: number } | null = null;
    await this.browser().waitUntil(
      async () => {
        menuPoint = await this.surface().contextMenuItem(actionLabel);
        return menuPoint !== null;
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Cursor-based Extract Interface was not offered",
      },
    );
    await this.browser()
      .action("pointer")
      .move({ ...menuPoint!, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();

    const dialog = this.browser().$("[role='dialog'][aria-modal='true']");
    await dialog.waitForDisplayed({ timeout: 5_000 });
    const targetIdentity = dialog.$(".//label[span='Element identity']/input");
    assert.equal(await targetIdentity.isEnabled(), false);
    assert.equal(await targetIdentity.getValue(), "@cursor");
    await dialog.$(`.//label[span='${nameFieldLabel}']/input`).waitForDisplayed({ timeout: 5_000 });
    await dialog.$(".//label[span='Method name']/input").waitForDisplayed({ timeout: 5_000 });
    return dialog;
  }

  async applyRollbackParameterReordering() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java method parameter order",
    );
    this.#mavenManifestBeforeParameterPreview = await this.fileManifest(this.file("maven"));
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='New parameter order']/input"),
      "second, first",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Cursor-bound parameter reorder did not become applicable",
    });
    if (this.#lease) {
      const baseline = this.#mavenManifestAtSync;
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "parameter-reorder-output-checkpoints.json"),
        JSON.stringify(
          {
            outputFilesAtSync: baseline ? this.mavenTargetFiles(baseline) : null,
            outputFilesAfterSourceOpen: this.#mavenManifestAfterParameterSourceOpen
              ? this.mavenTargetFiles(this.#mavenManifestAfterParameterSourceOpen)
              : null,
            outputFilesBeforePreview: this.#mavenManifestBeforeParameterPreview
              ? this.mavenTargetFiles(this.#mavenManifestBeforeParameterPreview)
              : null,
          },
          null,
          2,
        ),
      );
    }
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    const diffText = await diff.getText();
    assert.ok(diffText.includes("second") && diffText.includes("first"));
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /combine\(int second,\s*int first\)/u);
    assert.match(applied, /combine\(3,\s*2\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-reorder-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-reorder-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkParameterReorderReviewedAppliedAndRolledBack = true;
  }

  async applyRollbackParameterRename() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java Parameter Rename",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Current parameter name']/input"),
      "second",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='New parameter name']/input"),
      "factor",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Cursor-bound parameter rename did not become applicable",
    });
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    const diffText = await diff.getText();
    assert.match(diffText, /combine\(int first, int factor\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /combine\(int first, int factor\)/u);
    assert.match(applied, /combine\(2,\s*3\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-rename-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-rename-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkParameterRenameReviewedAppliedAndRolledBack = true;
  }

  async previewPublicParameterReorderRefusal() {
    assert.equal(this.#publicParameterReorderRefusalFixture, true);
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java method parameter order",
    );
    const before = await this.fileManifest(this.file("maven"));
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='New parameter order']/input"),
      "second, first",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("RefactorKit refused this refactoring."),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "The public-method reorder refusal was not explained in the dialog",
      },
    );
    const dialogText = await dialog.getText();
    assert.ok(dialogText.includes("public method or protected method"), dialogText);
    assert.ok(dialogText.includes("external-consumer risk and hierarchy evidence"), dialogText);
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.deepEqual([...(await this.fileManifest(this.file("maven")))], [...before]);
    await this.assertInputs();
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkPublicParameterReorderRefusedWithoutChanges = true;
  }

  async changeCompiledMavenOutputOutsideTheIde() {
    assert.equal(this.#parameterReorderFixture, true);
    assert.ok((await this.panel().getText()).includes("maven-effective-v1 · available"));
    const source = this.executionSource();
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      this.originalSource(source),
      "Review Java method parameter order",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='New parameter order']/input"),
      "second, first",
    );
    assert.ok(await dialog.$("button=Preview").isEnabled());
    const relativePath = "maven/app/target/classes/pkg/ParameterOrderFixture.class";
    const expectedHash = this.#mavenManifestAtSync?.get(relativePath.slice("maven/".length));
    assert.ok(expectedHash, "parameter reorder class output was not present at synchronization");
    const bytes = await readFile(this.file(relativePath));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, expectedHash, "compiled class changed before the stale-snapshot probe");
    this.#staleParameterOutputBackup = { relativePath, bytes, sha256 };
    const changed = Uint8Array.from(bytes);
    changed[0] = changed[0]! ^ 1;
    await writeFile(this.file(relativePath), changed);
    assert.notEqual(
      createHash("sha256")
        .update(await readFile(this.file(relativePath)))
        .digest("hex"),
      sha256,
      "compiled class output did not change",
    );
    this.#mavenManifestBeforeParameterPreview = await this.fileManifest(this.file("maven"));
    if (this.#lease)
      await writeFile(
        path.join(this.#lease.runnerArtifactPath, "parameter-reorder-stale-output-probe.json"),
        JSON.stringify(
          {
            path: relativePath,
            originalSha256: sha256,
            changedSha256: createHash("sha256")
              .update(await readFile(this.file(relativePath)))
              .digest("hex"),
          },
          null,
          2,
        ),
      );
  }

  async previewParameterReorderingAgainstStaleSnapshot() {
    assert.ok(this.#staleParameterOutputBackup, "compiled output must change before preview");
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    const preview = dialog.$("button=Preview");
    if (await preview.isEnabled()) await preview.click();
    await this.browser().waitUntil(
      async () => /Synchronize the (?:project and preview again|selected Java project)/u.test(
        await dialog.getText(),
      ),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "stale project snapshot was not reported in the refactoring dialog",
      },
    );
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.deepEqual(
      await this.fileManifest(this.file("maven")),
      this.#mavenManifestBeforeParameterPreview,
    );
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
  }

  async assertStalePreviewContextRetired() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.panel().waitForDisplayed({ timeout: 5_000 });
    const panelText = await this.panel().getText();
    assert.ok(
      /Synchronize the project (?:and preview again|before using its context again)|The selected Java SDK or project inputs changed during navigation/u.test(panelText),
      "the Java Project panel did not retain the stale-snapshot guidance",
    );
    assert.ok(
      !panelText.includes("maven-effective-v1 · available"),
      "the stale effective Maven context is still presented as synchronized",
    );
    const synchronize = this.panel().$("button=Synchronize project");
    assert.ok(await synchronize.isEnabled(), "explicit project synchronization is unavailable");
    this.#proof.sdkStaleParameterPreviewRetiredContext = true;
  }

  async restoreMavenOutputAndResynchronize() {
    const backup = this.#staleParameterOutputBackup;
    assert.ok(backup, "there is no compiled output snapshot to restore");
    await writeFile(this.file(backup.relativePath), backup.bytes);
    assert.equal(
      createHash("sha256")
        .update(await readFile(this.file(backup.relativePath)))
        .digest("hex"),
      backup.sha256,
      "compiled class output was not restored exactly",
    );
    this.#staleParameterOutputBackup = undefined;
    await this.panel().$("button=Synchronize project").click();
    await this.waitForText("Effective Java project context synchronized.");
    await this.browser().waitUntil(
      async () => (await this.panel().getText()).includes("maven-effective-v1 · available"),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "Maven context was not reacquired after explicit synchronization",
      },
    );
  }

  async assertStalePreviewContextResynchronized() {
    assert.equal(this.#proof.sdkStaleParameterPreviewRetiredContext, true);
    assert.ok((await this.panel().getText()).includes("maven-effective-v1 · available"));
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertIncompleteJpqlFieldRenameReview() {
    assert.equal(this.#jpqlFieldRenameReviewQualified, true);
    await this.assertInputs();
  }

  async applyRollbackMakeStatic() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review making the Java method static",
      "private int isolated()",
      "isolated",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Cursor-bound Make Static did not become applicable",
    });
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    assert.match(await diff.getText(), /private static int isolated\(\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /private static int isolated\(\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-make-static-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-make-static-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkMakeStaticReviewedAppliedAndRolledBack = true;
  }

  async applyLspVisibilityChangeToEditorBuffer() {
    assert.equal(process.env.IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE, "1");
    assert.ok(
      process.env.IDE_REFACTORKIT_LSP && path.isAbsolute(process.env.IDE_REFACTORKIT_LSP),
      "Set IDE_REFACTORKIT_LSP to an absolute source-built RefactorKit LSP executable.",
    );
    assert.equal(
      await this.#app!.environmentValue("IDE_REFACTORKIT_LSP"),
      process.env.IDE_REFACTORKIT_LSP,
    );
    const source = this.executionSource();
    const original = this.originalSource(source);
    const expected = original.replace(
      "private final int isolated()",
      "public final int isolated()",
    );
    assert.notEqual(expected, original, "the LSP fixture must contain the selected method");
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java visibility change at cursor",
      "private final int isolated()",
      "isolated",
      "context-menu",
      false,
    );
    assert.match(await dialog.getText(), /Promote the selected method to public/u);
    await dialog.$("button=Preview changes").click();
    const apply = dialog.$("button=Apply to editor buffers");
    await this.browser().waitUntil(() => apply.isEnabled(), {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: "RefactorKit LSP visibility preview did not become applicable",
    });
    const reviewed = await dialog.getText();
    assert.match(reviewed, /public final int isolated\(\)/u);
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await apply.click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.browser().waitUntil(
      async () => {
        try {
          await this.surface().assertBuffer(source, expected);
          return true;
        } catch {
          return false;
        }
      },
      {
        timeout: 10_000,
        interval: 200,
        timeoutMsg: "The LSP proposal was not applied to the Java editor buffer",
      },
    );
    await this.surface().assertDirty(source, true);
    assert.equal(await readFile(this.file(source), "utf8"), original);

    const copy = path.join(this.#lease!.runnerArtifactPath, "lsp-visibility-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    await writeFile(
      path.join(copy, path.relative(this.file("maven"), this.file(source))),
      expected,
    );
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "lsp-visibility-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await this.surface().discardUsingDisk(source, original, { expectedBuffer: expected });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    await this.assertInputs();
    this.#proof.lspVisibilityReviewedAppliedAndDiscardedWithoutSaving = true;
  }

  async assertLspVisibilityChangeAppliedWithoutSaving() {
    assert.equal(this.#proof.lspVisibilityReviewedAppliedAndDiscardedWithoutSaving, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async applyRollbackMakePublic() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const nonFinalMethod = this.#makePublicFixture === "non-final-method-in-final-class";
    const methodSignature = nonFinalMethod
      ? "private int flexible()"
      : "private final int isolated()";
    const cursorToken = nonFinalMethod ? "flexible" : "isolated";
    const expectedDeclaration = nonFinalMethod
      ? "public int flexible()"
      : "public final int isolated()";
    const artifactName = nonFinalMethod ? "sdk-make-public-non-final-method" : "sdk-make-public";
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review making the Java method public",
      methodSignature,
      cursorToken,
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: `Cursor-bound Make Public did not become applicable for ${methodSignature}`,
    });
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    assert.ok((await diff.getText()).includes(expectedDeclaration));
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    assert.ok((await readFile(this.file(source), "utf8")).includes(expectedDeclaration));

    const copy = path.join(this.#lease!.runnerArtifactPath, `${artifactName}-source-copy`);
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, `${artifactName}-maven.log`),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkMakePublicReviewedAppliedAndRolledBack = true;
  }

  async previewMakePublicExtensibleClassRefusal() {
    assert.equal(this.#makePublicFixture, "non-final-method-in-open-class");
    const source = this.executionSource();
    const original = this.originalSource(source);
    const manifestBefore = await this.fileManifest(this.file("maven"));
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review making the Java method public",
      "private int flexible()",
      "flexible",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("RefactorKit refused this refactoring."),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "Make Public did not explain the extensible-class override risk",
      },
    );
    const dialogText = await dialog.getText();
    assert.match(dialogText, /not final.*unproven external override path/iu);
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.deepEqual([...(await this.fileManifest(this.file("maven")))], [...manifestBefore]);
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkMakePublicRefusedWithoutChanges = true;
  }

  async applyRollbackExtractInterface() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const interfacePath = "maven/app/src/main/java/pkg/ExtractedOperations.java";
    await assert.rejects(access(this.file(interfacePath)), { code: "ENOENT" });
    const dialog = await this.openCursorSavedClassExtractionDialog(source, original);
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Interface name']/input"),
      "ExtractedOperations",
    );
    await pasteNativeText(this.#app!, dialog.$(".//label[span='Method name']/input"), "calculate");
    await this.assertInputs();
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Saved class Extract Interface did not become applicable",
    });
    const diffs = await dialog.$$("pre").getElements();
    let diffText = "";
    for (const diff of diffs) diffText += `${await diff.getText()}\n`;
    assert.match(diffText, /ExtractedOperations/u);
    assert.match(diffText, /implements ExtractedOperations/u);
    assert.match(diffText, /calculate\(int input\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    const appliedInterface = await readFile(this.file(interfacePath), "utf8");
    assert.match(applied, /implements ExtractedOperations/u);
    assert.match(appliedInterface, /public interface ExtractedOperations/u);
    assert.match(appliedInterface, /int calculate\(int input\);/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-extract-interface-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-extract-interface-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);
    this.#proof.sdkExtractInterfaceSourceCopyCompiledAndTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await assert.rejects(access(this.file(interfacePath)), { code: "ENOENT" });
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkExtractInterfaceReviewedAppliedAndRolledBack = true;
  }

  async applyRollbackExtractSuperclass() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const superclassPath = "maven/app/src/main/java/pkg/ExtractedBase.java";
    await assert.rejects(access(this.file(superclassPath)), { code: "ENOENT" });
    const dialog = await this.openCursorSavedClassExtractionDialog(
      source,
      original,
      "ExtractSuperclassFixture",
      "Review Java superclass extraction at cursor",
      "Superclass name",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Superclass name']/input"),
      "ExtractedBase",
    );
    await pasteNativeText(this.#app!, dialog.$(".//label[span='Method name']/input"), "calculate");
    await this.assertInputs();
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Saved class Extract Superclass did not become applicable",
    });
    const diffs = await dialog.$$("pre").getElements();
    let diffText = "";
    for (const diff of diffs) diffText += `${await diff.getText()}\n`;
    assert.match(diffText, /ExtractedBase/u);
    assert.match(diffText, /extends ExtractedBase/u);
    assert.match(diffText, /calculate\(int input\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    const appliedSuperclass = await readFile(this.file(superclassPath), "utf8");
    assert.match(applied, /extends ExtractedBase/u);
    assert.match(appliedSuperclass, /public class ExtractedBase/u);
    assert.match(appliedSuperclass, /int calculate\(int input\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-extract-superclass-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-extract-superclass-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);
    this.#proof.sdkExtractSuperclassSourceCopyCompiledAndTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await assert.rejects(access(this.file(superclassPath)), { code: "ENOENT" });
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkExtractSuperclassReviewedAppliedAndRolledBack = true;
  }

  async reviewMoveMember(expectRefusal = false) {
    assert.equal(this.#moveMemberFixture, expectRefusal ? "instance-method" : "static-method");
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.startLanguageServiceWithSdk(this.#sdk);
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    const compiled = await readFile(this.file("maven/app/target/classes/pkg/MoveMemberFixture.class"));
    assert.equal(compiled.readUInt32BE(0), 0xcafebabe);
    assert.equal(compiled.readUInt16BE(6), 61);
    this.#proof.sdkMoveMemberLiveBuildVerified = true;
    this.#proof.realMavenBuild = true;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeMaven();
    const before = await this.fileManifest(this.file("maven"));
    const dialog = await this.openCursorParameterRefactoringDialog(
      source, original, "Review Move Member", "int value()", "value", "command-palette",
    );
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Search destination Java type in the current source file"]'), "MoveDestination");
    const types = dialog.$('[aria-label="Destination Java types"]');
    const destination = types.$("button*=pkg.MoveDestination");
    await destination.waitForDisplayed({ timeout: 30_000 });
    await destination.click();
    assert.equal(await destination.getAttribute("aria-pressed"), "true");
    this.#proof.sdkMoveMemberDestinationSelected = true;
    await this.assertInputs();
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(async () => {
      const text = await dialog.getText();
      if (text.includes("RefactorKit refused this refactoring.")) {
        if (!expectRefusal) throw new Error(`Move Member refused the supported fixture: ${text}`);
        return true;
      }
      return !expectRefusal && await dialog.$("button=Apply").isEnabled();
    }, { timeout: 30_000, interval: 100, timeoutMsg: "Move Member did not finish its provider-backed review" });
    const trace = (await readFile(path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    if (expectRefusal) {
      const response = trace.filter((row) => row.event === "refactorkit.daemon.rpc.response" && row.details?.method === "refactor.preview").at(-1)?.details.response;
      assert.equal(response?.error?.data?.refusalCode, "java.moveMember.methodShapeUnsupported");
      assert.match(await dialog.getText(), /package-private static no-argument int method/u);
      assert.equal(await dialog.$("button=Apply").isEnabled(), false);
      assert.deepEqual([...(await this.fileManifest(this.file("maven")))], [...before]);
      await this.assertInputs();
      await dialog.$("button=Cancel").click();
      await dialog.waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().assertBuffer(source, original);
      await this.surface().assertDirty(source, false);
      this.#proof.sdkMoveMemberRefusedWithoutChanges = true;
      return;
    }
    const request = trace.filter((row) => row.event === "refactorkit.daemon.rpc.request" && row.details?.method === "refactor.preview").at(-1)?.details.params;
    assert.equal(request?.operation, "moveMember");
    assert.equal(request?.arguments?.targetType, "pkg.MoveDestination");
    assert.equal(typeof request?.arguments?.targetBindingKey, "string");
    assert.ok(request.arguments.targetBindingKey.length > 0);
    assert.equal(request?.javaContext?.sdkHome, this.#sdk);
    const diff = await dialog.$("pre").getText();
    assert.match(diff, /MoveDestination\.value\(\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(async () => (await dialog.getText()).includes("Refactoring applied successfully."), { timeout: 30_000, interval: 100 });
    const applied = await readFile(this.file(source), "utf8");
    const destinationStart = applied.indexOf("class MoveDestination");
    const fixtureStart = applied.indexOf("public final class MoveMemberFixture");
    const methodStart = applied.indexOf("static int value()");
    assert.ok(fixtureStart >= 0 && destinationStart > fixtureStart && methodStart > destinationStart, "The method must move into the selected destination class");
    assert.doesNotMatch(applied.slice(0, destinationStart), /int value\(\)/u);
    assert.match(applied.slice(fixtureStart), /MoveDestination\.value\(\)/u);
    assert.doesNotMatch(applied, /MoveMemberFixture\.value\(\)/u);
    for (const [file, originalInput] of this.#inputs) if (file !== source) assert.equal(await readFile(this.file(file), "utf8"), originalInput, file);
    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-move-member-source-copy");
    await cp(this.file("maven"), copy, { recursive: true, filter: (file) => !["target", ".refactorkit"].includes(path.basename(file)) });
    const build = await promisify(execFile)("mvn", ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"], {
      cwd: copy, env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 30_000, maxBuffer: 512 * 1024,
    });
    await writeFile(path.join(this.#lease!.runnerArtifactPath, "sdk-move-member-maven.log"), build.stdout + build.stderr);
    assert.match(build.stdout, /BUILD SUCCESS/u);
    const report = await readNativeJUnitReport(copy, "app/target/surefire-reports/TEST-pkg.MoveMemberFixtureTest.xml", "MOVE_MEMBER_RESULT_42", "pkg.MoveMemberFixtureTest", "pkg.MoveMemberFixtureTest", "preservesResult");
    assert.equal(report.failures, 0);
    await writeFile(path.join(this.#lease!.runnerArtifactPath, "sdk-move-member-test-report.json"), JSON.stringify(report, null, 2));
    this.#proof.sdkMoveMemberSourceCopyCompiledAndTested = true;
    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(async () => (await dialog.getText()).includes("Refactoring rolled back."), { timeout: 60_000, interval: 100 });
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkMoveMemberReviewedAppliedAndRolledBack = true;
  }

  async assertMoveMember(expectRefusal = false) {
    assert.equal(this.#proof.sdkMoveMemberLiveBuildVerified, true);
    assert.equal(this.#proof.sdkMoveMemberDestinationSelected, true);
    if (expectRefusal) assert.equal(this.#proof.sdkMoveMemberRefusedWithoutChanges, true);
    else {
      assert.equal(this.#proof.sdkMoveMemberReviewedAppliedAndRolledBack, true);
      assert.equal(this.#proof.sdkMoveMemberSourceCopyCompiledAndTested, true);
    }
    await this.assertInputs();
  }

  async applyRollbackPullUpMember() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Pull Up Method",
      "public final int value()",
      "value",
      "command-palette",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Target supertype (fully qualified name)']/input"),
      "pkg.PullUpParent",
    );
    await this.assertInputs();
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "The bounded Pull Up Method preview did not become applicable",
    });
    const planText = await dialog.getText();
    assert.match(planText, /risk\s*high/i);
    assert.match(
      planText,
      /reflection and external or resource-shaped consumers;\s*these are not analyzed/u,
    );
    const diffs = await dialog.$$("pre").getElements();
    let diffText = "";
    for (const diff of diffs) diffText += `${await diff.getText()}\n`;
    assert.match(planText, /to its direct superclass pkg\.PullUpParent/u);
    assert.match(diffText, /public final int value\(\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    const parentStart = applied.indexOf("class PullUpParent");
    const childStart = applied.indexOf("class PullUpFixture");
    const methodStart = applied.indexOf("public final int value()");
    assert.ok(parentStart >= 0 && childStart > parentStart && methodStart > parentStart);
    assert.ok(
      methodStart < childStart,
      "the final method was not moved into its direct superclass",
    );
    assert.doesNotMatch(applied.slice(childStart), /public final int value\(\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-pull-up-member-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-pull-up-member-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);
    this.#proof.sdkPullUpMemberSourceCopyCompiledAndTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkPullUpMemberReviewedAppliedAndRolledBack = true;
  }

  async applyRollbackPushDownMember() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Push Down Method",
      "protected final int value()",
      "value",
      "command-palette",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Target subtype (fully qualified name)']/input"),
      "pkg.PushDownFixture",
    );
    await this.assertInputs();
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "The bounded Push Down Method preview did not become applicable",
    });
    const planText = await dialog.getText();
    assert.match(planText, /risk\s*high/i);
    assert.match(
      planText,
      /reflection and external or resource-shaped consumers;\s*these are not analyzed/u,
    );
    const diffs = await dialog.$$("pre").getElements();
    let diffText = "";
    for (const diff of diffs) diffText += `${await diff.getText()}\n`;
    assert.match(planText, /to its only direct child pkg\.PushDownFixture/u);
    assert.match(diffText, /protected final int value\(\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    const parentStart = applied.indexOf("abstract class PushDownParent");
    const childStart = applied.indexOf("class PushDownFixture");
    const methodStart = applied.indexOf("protected final int value()");
    assert.ok(parentStart >= 0 && childStart > parentStart && methodStart > childStart);
    assert.doesNotMatch(applied.slice(parentStart, childStart), /protected final int value\(\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-push-down-member-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-push-down-member-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);
    this.#proof.sdkPushDownMemberSourceCopyCompiledAndTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkPushDownMemberReviewedAppliedAndRolledBack = true;
  }

  async applyRollbackEncapsulateField() {
    const source = this.executionSource();
    const client = "maven/app/src/main/java/pkg/FieldEncapsulationClient.java";
    const original = this.originalSource(source);
    const originalClient = this.originalSource(client);

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    assert.ok((await this.panel().getText()).includes("maven-effective-v1 · available"));
    await this.refreshSavedSourceStructure();
    const structure = this.panel().$(".//details[summary='Saved source structure']");
    const actionName = "Review encapsulation of field pkg.FieldEncapsulationFixture#labels";
    const action = structure.$(`button[aria-label="${actionName}"]`);
    await action.waitForDisplayed({ timeout: 10_000 });
    await action.scrollIntoView();
    await action.click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 10_000 });
    assert.equal(await dialog.$("select").getValue(), "encapsulate-field");
    assert.match(
      await dialog.getText(),
      /tested support for public final instance fields of type int, String, List<String>, and int\[\]/u,
    );
    await this.assertInputs();
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Bound List<String> field encapsulation was not applicable",
    });
    const diffs = await dialog.$$("pre").getElements();
    let diffText = "";
    for (const diff of diffs) diffText += `${await diff.getText()}\n`;
    assert.match(diffText, /private final List<String> labels/u);
    assert.match(diffText, /public List<String> getLabels\(\)/u);
    assert.match(diffText, /getLabels\(\)\.size\(\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );

    const applied = await readFile(this.file(source), "utf8");
    const appliedClient = await readFile(this.file(client), "utf8");
    assert.match(applied, /private final List<String> labels/u);
    assert.match(applied, /public List<String> getLabels\(\)/u);
    assert.match(appliedClient, /getLabels\(\)\.size\(\)/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-encapsulate-field-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-encapsulate-field-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);
    this.#proof.sdkEncapsulateFieldSourceCopyCompiledAndTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    assert.equal(await readFile(this.file(client), "utf8"), originalClient);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkEncapsulateFieldReviewedAppliedAndRolledBack = true;
  }

  async reviewFieldTypeChange() {
    assert.ok(this.#fieldTypeFixture);
    const source = this.executionSource();
    const original = this.originalSource(source);
    const supported = this.#fieldTypeFixture === "private";
    const dialog = await this.openCursorParameterRefactoringDialog(source, original,
      supported ? "Review Java Field Type" : "Review Java field type", "int value = 41", "value",
      supported ? "command-palette" : "context-menu", false);
    await pasteNativeText(this.#app!, dialog.$(".//label[span='New field type']/input"), "long");
    await dialog.$("button=Preview").click();
    if (!supported) {
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Only a private field is supported"), {
        timeout: 20_000, interval: 100, timeoutMsg: "The provider's public-field type-change refusal was not explained",
      }).catch(async error => { throw new Error(`Field type refusal missing. Dialog: ${await dialog.getText()}`, { cause: error }); });
      assert.equal(await dialog.$("button=Apply").isEnabled(), false);
      await this.assertInputs();
      this.#proof.sdkFieldTypeRefusedWithoutChanges = true;
    } else {
      await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
        timeout: 20_000, interval: 100, timeoutMsg: "The attested field-type preview did not become applicable",
      }).catch(async error => { throw new Error(`Field type preview failed. Dialog: ${await dialog.getText()}`, { cause: error }); });
      const diff = (await dialog.$$("pre").getElements())[0];
      assert.ok(diff); assert.match(await diff.getText(), /private long value/u);
      await this.assertInputs();
      await dialog.$("button=Apply").click();
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Refactoring applied successfully."), { timeout: 25_000, interval: 100 });
      const applied = await readFile(this.file(source), "utf8");
      assert.equal(applied, original.replace("private int value = 41", "private long value = 41"));
      assert.ok(applied.includes("int value = 7;"));
      assert.ok(applied.includes("private int unaffected = 5;"));
      const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-field-type-source-copy");
      await assert.rejects(access(copy), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      await cp(this.file("maven"), copy, { recursive: true,
        filter: sourcePath => !["target", ".refactorkit"].includes(path.basename(sourcePath)) });
      const build = await promisify(execFile)("mvn", ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"], {
        cwd: copy, env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 30_000, maxBuffer: 512 * 1024,
      });
      await writeFile(path.join(this.#lease!.runnerArtifactPath, "sdk-field-type-maven.log"), build.stdout + build.stderr);
      assert.match(build.stdout, /BUILD SUCCESS/u);
      await dialog.$("button=Rollback").click();
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Refactoring rolled back."), { timeout: 60_000, interval: 100 });
      assert.equal(await readFile(this.file(source), "utf8"), original);
      await this.assertInputs();
      this.#proof.sdkFieldTypeChangedAndRolledBack = true;
    }
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
  }

  async assertFieldTypeChange() {
    assert.ok(this.#fieldTypeFixture);
    assert.equal(this.#fieldTypeFixture === "private" ? this.#proof.sdkFieldTypeChangedAndRolledBack : this.#proof.sdkFieldTypeRefusedWithoutChanges, true);
    await this.assertInputs();
  }

  async refuseConstructorSelection() {
    assert.equal(this.#constructorSelectionFixture, true);
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(source, original,
      "Review adding a Java method parameter", "ParameterOrderFixture(int value)", "ParameterOrderFixture", "context-menu", false);
    for (const [label, value] of [["Parameter type", "int"], ["Parameter name", "count"], ["Value at existing calls", "0"]]) {
      await pasteNativeText(this.#app!, dialog.$(`.//label[span='${label}']/input`), value);
    }
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(async () => (await dialog.getText()).includes("does not support constructor targets through this saved-cursor route"), {
      timeout: 20_000, interval: 100, timeoutMsg: "The provider's constructor selection refusal was not explained",
    }).catch(async error => {
      throw new Error(`Constructor selection refusal was not explained. Dialog: ${await dialog.getText()}`, { cause: error });
    });
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.ok((await dialog.getText()).includes("No refactoring plan was created."));
    await this.assertInputs();
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkConstructorSelectionRefusedWithoutChanges = true;
  }

  async assertConstructorSelectionRefused() {
    assert.equal(this.#proof.sdkConstructorSelectionRefusedWithoutChanges, true);
    await this.assertInputs();
  }

  async applyRollbackParameterAddition() {
    await this.applyRollbackSignatureChange("add");
  }

  async assertFunctionalReferenceMigration() {
    assert.equal(this.#proof.sdkFunctionalReferencesMigratedAndRolledBack, true);
    await this.assertInputs();
  }

  async applyRollbackSignatureHierarchy() {
    assert.equal(this.#parameterHierarchyFixture, true);
    await this.applyRollbackSignatureChange(this.#signatureHierarchyOperation);
  }

  async assertSignatureHierarchy() {
    assert.ok(this.#proof.sdkSignatureHierarchyOperationsQualified.includes(this.#signatureHierarchyOperation));
    assert.equal(this.#proof.sdkParameterHierarchyRiskAcceptanceRequired, true);
    await this.assertInputs();
  }

  async applyRollbackConstructorSignature() {
    assert.ok(this.#constructorSignatureFixture);
    await this.applyRollbackSignatureChange(this.#constructorSignatureFixture);
  }

  async assertConstructorDelegation() {
    assert.ok(this.#constructorSignatureFixture);
    assert.ok(this.#proof.sdkConstructorDelegationOperationsQualified.includes(this.#constructorSignatureFixture));
    await this.assertInputs();
  }

  async assertConstructorReferenceMigration() {
    assert.equal(this.#proof.sdkConstructorReferenceMigratedAndRolledBack, true);
    await this.assertInputs();
  }

  async assertConstructorSignature() {
    assert.ok(this.#constructorSignatureFixture);
    assert.ok(this.#proof.sdkConstructorSignatureOperationsQualified.includes(this.#constructorSignatureFixture));
    await this.assertInputs();
  }

  private async applyRollbackSignatureChange(operation: "rename" | "add" | "reorder" | "remove" | "type") {
    const change = {
      rename: { label: "Review Java Parameter Rename", fields: [["Current parameter name", "second"], ["New parameter name", "factor"]], declaration: /combine\(int first,\s*int factor\)/u, call: /combine\(2,\s*3\)/u },
      add: { label: "Review adding a Java method parameter", fields: [["Parameter type", "int"], ["Parameter name", "count"], ["Value at existing calls", "0"]], declaration: /combine\(int first,\s*int second,\s*int count\)/u, call: /combine\(2,\s*3,\s*0\)/u },
      reorder: { label: "Review Java method parameter order", fields: [["New parameter order", "second, first"]], declaration: /combine\(int second,\s*int first\)/u, call: /combine\(3,\s*2\)/u },
      remove: { label: "Review removing a Java method parameter", fields: [["Parameter name to remove", "second"]], declaration: /combine\(int first\)/u, call: /combine\(2\)/u },
      type: { label: "Review Java parameter type", fields: [["Parameter name", "second"], ["New parameter type", "long"]], declaration: /combine\(int first,\s*long second\)/u, call: /combine\(2,\s*3\)/u },
    }[operation];
    const constructor = this.#constructorSignatureFixture !== null;
    if (constructor) {
      change.declaration = new RegExp(change.declaration.source.replace("combine", "ParameterOrderFixture"), "u");
      change.call = new RegExp(change.call.source.replace("combine", this.#constructorDelegationFixture ? "super" : "new ParameterOrderFixture"), "u");
    }
    const source = this.executionSource();
    const original = this.originalSource(source);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      change.label,
      constructor ? "ParameterOrderFixture(int first, int second)" : "combine(int first, int second)",
      constructor ? "ParameterOrderFixture" : "combine",
      "context-menu",
      !constructor,
    );
    for (const [label, value] of change.fields) {
      await pasteNativeText(this.#app!, dialog.$(`.//label[span='${label}']/input`), value);
    }
    if (this.#functionalReferencesFixture || this.#constructorReferencesFixture) {
      const migration = dialog.$(".//fieldset[legend='Method and constructor references']//input[@type='checkbox']");
      if (this.#functionalReferencesFixture === "instance")
        assert.ok((await dialog.getText()).includes("RefactorKit can also adapt supported this::method references"));
      assert.equal(await migration.isSelected(), false);
      await migration.click();
    }
    if (this.#parameterHierarchyFixture) {
      const hierarchy = dialog.$("label*=Update the source override hierarchy").$("input");
      const risk = dialog.$("label*=I accept the risk to callers outside this workspace").$("input");
      assert.equal(await hierarchy.isSelected(), false);
      assert.equal(await risk.isSelected(), false);
      await hierarchy.click();
      await dialog.$("button=Preview").click();
      await this.browser().waitUntil(async () => (await dialog.getText()).includes("Hierarchy changes require explicit acceptance of external-consumer risk."), {
        timeout: 5_000, interval: 50,
      });
      await this.assertInputs();
      this.#proof.sdkParameterHierarchyRiskAcceptanceRequired = true;
      await risk.click();
    }
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: `Cursor-bound ${operation} signature change did not become applicable`,
    }).catch(async error => {
      throw new Error(`Cursor-bound ${operation} preview failed. Dialog: ${await dialog.getText()}`, { cause: error });
    });
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    const diffText = await diff.getText();
    assert.match(diffText, change.declaration);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, change.declaration);
    assert.match(applied, change.call);

    if (this.#parameterHierarchyFixture) {
      const contract = await readFile(this.file("maven/app/src/main/java/pkg/Combiner.java"), "utf8");
      assert.match(contract, change.declaration);
      assert.equal([...applied.matchAll(new RegExp(change.call.source, "gu"))].length, 2);
      assert.ok(diffText.includes("Combiner.java") && diffText.includes("ParameterOrderFixture.java"));
    }

    if (this.#functionalReferencesFixture) {
      const receiver = this.#functionalReferencesFixture === "instance" ? "this" : "ParameterOrderFixture";
      assert.ok(!applied.includes(`${receiver}::combine`));
      assert.match(applied, new RegExp(`\\(arg0,\\s*arg1\\)\\s*->\\s*${receiver}\\.combine\\(arg0,\\s*arg1,\\s*0\\)`, "u"));
      assert.ok(applied.includes("ref.applyAsInt(2, 3)"));
      assert.ok(diffText.includes("->"));
    }
    if (this.#constructorDelegationFixture) {
      assert.match(applied, new RegExp(change.call.source.replace("super", "this"), "u"));
      assert.ok(applied.includes("new DelegatingChild()"));
      assert.ok(applied.includes("new ParameterOrderFixture().value"));
    }
    if (this.#constructorReferencesFixture) {
      assert.ok(!applied.includes("ParameterOrderFixture::new"));
      assert.match(applied, /\(arg0,\s*arg1\)\s*->\s*new ParameterOrderFixture\(arg0,\s*arg1,\s*0\)/u);
      assert.ok(applied.includes("factory.apply(2, 3)"));
      assert.ok(diffText.includes("->"));
    }
    if (constructor) {
      assert.ok(applied.includes("private ParameterOrderFixture(boolean marker) { this.value = -1; }"));
      assert.ok(applied.includes("new ParameterOrderFixture(true)"));
      if (operation === "rename") assert.match(applied, /this\.value = first \* 10 \+ factor/u);
    }
    const functionalReferenceArtifact = this.#functionalReferencesFixture === "instance"
      ? "sdk-parameter-addition-instance-reference" : "sdk-parameter-addition-functional-references";
    const artifactName = this.#constructorDelegationFixture ? `sdk-constructor-delegation-${operation}` : this.#constructorReferencesFixture ? "sdk-constructor-reference-addition" : constructor ? `sdk-constructor-signature-${operation}` : this.#functionalReferencesFixture ? functionalReferenceArtifact : operation === "add" ? (this.#parameterHierarchyFixture ? "sdk-parameter-addition-hierarchy" : "sdk-parameter-addition") : `sdk-signature-${operation}`;
    const copy = path.join(this.#lease!.runnerArtifactPath, `${artifactName}-source-copy`);
    await assert.rejects(access(copy), (error: NodeJS.ErrnoException) => error.code === "ENOENT", "Each signature scenario requires a fresh build copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, `${artifactName}-maven.log`),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);
    if (this.#functionalReferencesFixture) {
      const test = "pkg.ParameterOrderFixtureTest";
      const report = await readNativeJUnitReport(
        copy, `app/target/surefire-reports/TEST-${test}.xml`, "", test, test, "preservesArgumentMeaning",
      );
      assert.equal(report.tests, 1);
      assert.equal(report.failures + report.errors + report.skipped, 0);
      assert.equal(report.caseFailure, false);
    }

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    if (operation === "add") {
      this.#proof.sdkParameterAdditionReviewedAppliedAndRolledBack = true;
      if (this.#parameterHierarchyFixture) this.#proof.sdkParameterHierarchyReviewedAppliedAndRolledBack = true;
    }
    if (this.#constructorDelegationFixture) this.#proof.sdkConstructorDelegationOperationsQualified.push(operation);
    if (this.#constructorReferencesFixture) this.#proof.sdkConstructorReferenceMigratedAndRolledBack = true;
    if (constructor) this.#proof.sdkConstructorSignatureOperationsQualified.push(operation);
    if (this.#parameterHierarchyFixture) this.#proof.sdkSignatureHierarchyOperationsQualified.push(operation);
    if (this.#functionalReferencesFixture) this.#proof.sdkFunctionalReferencesMigratedAndRolledBack = true;
  }

  async applyRollbackParameterRemoval() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.previewParameterRemovalWithSideEffects(source, original);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java Remove Parameter",
      "retain(int value, int unused)",
      "retain",
      "command-palette",
    );
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Parameter name to remove']/input"),
      "unused",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Cursor-bound parameter removal did not become applicable",
    });
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    const diffText = await diff.getText();
    assert.match(diffText, /retain\(int value\)/u);
    assert.match(diffText, /retain\(41\)/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 25_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /retain\(int value\)/u);
    assert.match(applied, /return retain\(41\);/u);

    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-removal-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-removal-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkParameterRemovalReviewedAppliedAndRolledBack = true;
  }

  private async previewParameterRemovalWithSideEffects(source: string, original: string) {
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review removing a Java method parameter",
      "retainWithEffect(int value, int unused)",
      "retainWithEffect",
    );
    const before = await this.fileManifest(this.file("maven"));
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Parameter name to remove']/input"),
      "unused",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("RefactorKit refused this refactoring."),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "Parameter removal did not show the provider refusal",
      },
    );
    assert.match(await dialog.getText(), /Removing this argument could remove a side effect/u);
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.deepEqual(await this.fileManifest(this.file("maven")), before);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkParameterRemovalWithSideEffectsRefused = true;
  }

  async applyRollbackParameterTypeChange() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    const menu = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java parameter type",
    );
    await menu.$("button=Cancel").click();
    await menu.waitForExist({ reverse: true, timeout: 5_000 });
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java Parameter Type",
      undefined,
      undefined,
      "command-palette",
    );
    await pasteNativeText(this.#app!, dialog.$(".//label[span='Parameter name']/input"), "second");
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='New parameter type']/input"),
      "Integer",
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "Cursor-bound parameter type change did not become applicable",
    });
    const diff = (await dialog.$$("pre").getElements())[0];
    assert.ok(diff, "provider diff is not visible");
    assert.match(await diff.getText(), /Integer/u);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring applied successfully.')]")
      .waitForDisplayed({ timeout: 45_000 });
    const applied = await readFile(this.file(source), "utf8");
    assert.match(applied, /combine\(int first, Integer second\)/u);
    assert.match(applied, /combine\(2,\s*3\)/u);

    const copy = path.join(
      this.#lease!.runnerArtifactPath,
      "sdk-parameter-type-change-source-copy",
    );
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (sourcePath) => !["target", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "sdk-parameter-type-change-maven.log"),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESS/u);

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.sdkParameterTypeChangeReviewedAppliedAndRolledBack = true;
  }

  private async applyRollbackExpressionExtraction(
    operation: "constant" | "variable" | "method" | "parameter" | "field",
  ) {
    const variable = operation === "variable";
    const method = operation === "method";
    const parameter = operation === "parameter";
    const field = operation === "field";
    const operationTitle = method
      ? "Extract Method"
      : variable
        ? "Extract Variable"
        : parameter
          ? "Extract Parameter"
          : field
            ? "Extract Field"
            : "Extract Constant";
    const actionLabel = method
      ? "Review Java method extraction"
      : variable
        ? "Review Java variable extraction"
        : parameter
          ? "Review Java parameter extraction"
          : field
            ? "Review Java field extraction"
            : "Review Java constant extraction";
    const intentLabel = method
      ? "Method name"
      : variable
        ? "Variable name"
        : parameter
          ? "Parameter name"
          : field
            ? "Field name"
            : "Constant name";
    const name = method
      ? "calculateTotal"
      : variable
        ? "doubled"
        : parameter
          ? "offset"
          : field
            ? "answer"
            : "ANSWER";
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().open(source, original);
    const collapseBottomPanel = this.browser().$('button[aria-label="Collapse bottom panel"]');
    if (await collapseBottomPanel.isDisplayed()) await collapseBottomPanel.click();
    await this.browser().setWindowSize(1440, 900);
    const selectedText = method
      ? "String raw = Files.readString(path);\n    String normalized = prefix + raw.trim();\n    if (normalized.isEmpty()) {\n      normalized = fallback;\n    }"
      : parameter
        ? "base + 1"
        : "6 * 7";
    await this.surface().selectText(source, selectedText);
    await this.browser().keys(["Shift", "F10"]);
    let menuPoint: { x: number; y: number } | null = null;
    await this.browser().waitUntil(
      async () => {
        menuPoint = await this.surface().contextMenuItem(actionLabel);
        return menuPoint !== null;
      },
      { timeout: 10_000, interval: 100, timeoutMsg: `${operationTitle} action was not offered` },
    );
    await this.browser()
      .action("pointer")
      .move({ ...menuPoint!, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    const actionStatus = this.browser().$('[aria-label="Java file action status"]');
    await this.browser().waitUntil(
      async () => (await dialog.isDisplayed()) || (await actionStatus.isDisplayed()),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: `${operationTitle} review action produced no dialog or status`,
      },
    );
    if (!(await dialog.isDisplayed())) {
      const status = await actionStatus.getText();
      throw new Error(`${operationTitle} was rejected before preview: ${status}`);
    }
    assert.ok(
      (await dialog.getText()).includes(selectedText),
      "dialog did not retain the selection",
    );
    await pasteNativeText(this.#app!, dialog.$(`.//label[span='${intentLabel}']/input`), name);
    const previewButton = dialog.$("button=Preview");
    await previewButton.waitForEnabled({ timeout: 5_000, timeoutMsg: `${operationTitle} Preview is disabled` });
    await previewButton.click();
    const apply = dialog.$("button=Apply");
    const refusal = dialog.$('[role="alert"]');
    await this.browser().waitUntil(async () => (await apply.isEnabled()) || (await refusal.isDisplayed()), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: `${operationTitle} preview did not finish`,
    });
    if (!(await apply.isEnabled())) throw new Error(`${operationTitle} preview was refused: ${await refusal.getText()}`);
    const preview = await dialog.getText();
    assert.ok(preview.includes(name));
    assert.ok((await dialog.$$("pre").getElements()).length > 0, "provider diff is not visible");
    await this.assertInputs();
    await apply.click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 20_000, interval: 100 },
    );
    const applied = await readFile(this.file(source), "utf8");
    if (method) {
      assert.match(applied, /String normalized = calculateTotal\(path, fallback, prefix\);/u);
      assert.match(
        applied,
        /private static (?:String|java\.lang\.String) calculateTotal\(\s*(?:Path|java\.nio\.file\.Path) path,\s*(?:String|java\.lang\.String) fallback,\s*(?:String|java\.lang\.String) prefix\s*\) throws (?:IOException|java\.io\.IOException)/u,
      );
      assert.match(applied, /String raw = (?:java\.nio\.file\.)?Files\.readString\(path\);/u);
      assert.match(applied, /String normalized = prefix \+ raw\.trim\(\);/u);
      assert.match(applied, /if \(normalized\.isEmpty\(\)\)\s*\{\s*normalized = fallback;/u);
      assert.match(applied, /return normalized;/u);
    } else if (parameter) {
      assert.match(applied, /private static int calculate\(int base,\s*int offset\)/u);
      assert.match(applied, /return calculate\(input,\s*input \+ 1\);/u);
    } else if (field) {
      assert.match(applied, /private final int answer = 6 \* 7;/u);
      assert.match(applied, /return this\.answer;/u);
    } else if (variable) {
      assert.match(
        applied,
        this.#extractVariableInitializerFixture
          ? /int doubled = 6 \* 7;\s+int result = doubled \+ 1;\s+return result;/u
          : /int doubled = 6 \* 7;\s+return doubled \+ 0;/u,
      );
    } else {
      assert.match(applied, /private static final int ANSWER = 6 \* 7;/u);
      assert.match(applied, /return (?:pkg\.)?ConstantFixture\.ANSWER;/u);
    }
    const copy = await this.verifyAppliedJavaCopy(`sdk-extract-${operation}-source-copy`);
    const buildTool = this.#executionTool;
    if (method) {
      const reportDirectory = buildTool === "maven" ? "target/surefire-reports" : "build/test-results/test";
      const testClass = "pkg.ExtractMethodFixtureTest";
      const report = await readNativeJUnitReport(
        copy, `app/${reportDirectory}/TEST-${testClass}.xml`, "", testClass, testClass,
        "preservesNormalizedAndFallbackResults",
      );
      assert.equal(report.tests, 1);
      assert.equal(report.failures + report.errors + report.skipped, 0);
      assert.equal(report.caseFailure, false);
    }
    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    if (method) {
      this.#proof.sdkExtractMethodSourceCopyCompiledAndTested = true;
      this.#proof.sdkExtractMethodReviewedAppliedAndRolledBack = true;
    } else if (parameter) {
      this.#proof.sdkExtractParameterSourceCopyCompiledAndTested = true;
      this.#proof.sdkExtractParameterReviewedAppliedAndRolledBack = true;
    } else if (field) {
      this.#proof.sdkExtractFieldSourceCopyCompiledAndTested = true;
      this.#proof.sdkExtractFieldReviewedAppliedAndRolledBack = true;
    } else if (variable) this.#proof.sdkExtractVariableReviewedAppliedAndRolledBack = true;
    else this.#proof.sdkExtractConstantReviewedAppliedAndRolledBack = true;
  }

  async assertExtractConstant() {
    assert.equal(this.#proof.sdkExtractConstantReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
  }

  async assertInlineRefactoring(
    operationName: "inlineVariable" | "inlineConstant" | "inlineMethod",
  ) {
    assert.equal(
      operationName === "inlineVariable"
        ? this.#proof.sdkInlineVariableReviewedAppliedAndRolledBack
        : operationName === "inlineConstant"
          ? this.#proof.sdkInlineConstantReviewedAppliedAndRolledBack
          : this.#proof.sdkInlineMethodReviewedAppliedAndRolledBack,
      true,
    );
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
  }

  async assertExtractVariable() {
    assert.equal(this.#proof.sdkExtractVariableReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
  }

  async assertExtractMethod(tool: "maven" | "gradle") {
    assert.equal(this.#executionTool, tool);
    assert.equal(this.#proof.sdkExtractMethodReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkExtractMethodSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertExtractParameter() {
    assert.equal(this.#proof.sdkExtractParameterReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkExtractParameterSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertExtractField() {
    assert.equal(this.#proof.sdkExtractFieldReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkExtractFieldSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertExtractInterface() {
    assert.equal(this.#proof.sdkExtractInterfaceReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkExtractInterfaceSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    const interfacePath = "maven/app/src/main/java/pkg/ExtractedOperations.java";
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await assert.rejects(access(this.file(interfacePath)), { code: "ENOENT" });
    await this.assertInputs();
  }

  async assertExtractSuperclass() {
    assert.equal(this.#proof.sdkExtractSuperclassReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkExtractSuperclassSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    const superclassPath = "maven/app/src/main/java/pkg/ExtractedBase.java";
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await assert.rejects(access(this.file(superclassPath)), { code: "ENOENT" });
    await this.assertInputs();
  }

  async assertPullUpMember() {
    assert.equal(this.#proof.sdkPullUpMemberReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkPullUpMemberSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertPushDownMember() {
    assert.equal(this.#proof.sdkPushDownMemberReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkPushDownMemberSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertParameterReordering() {
    assert.equal(this.#proof.sdkParameterReorderReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertParameterRename() {
    assert.equal(this.#proof.sdkParameterRenameReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertPublicParameterReorderRefusedWithoutChanges() {
    assert.equal(this.#proof.sdkPublicParameterReorderRefusedWithoutChanges, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertMakeStatic() {
    assert.equal(this.#proof.sdkMakeStaticReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertMakePublic() {
    assert.equal(this.#proof.sdkMakePublicReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertMakePublicRefusedWithoutChanges() {
    assert.equal(this.#proof.sdkMakePublicRefusedWithoutChanges, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertEncapsulateField() {
    assert.equal(this.#proof.sdkEncapsulateFieldReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkEncapsulateFieldSourceCopyCompiledAndTested, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertParameterAddition() {
    assert.equal(this.#proof.sdkParameterAdditionReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertParameterRemoval() {
    assert.equal(this.#proof.sdkParameterRemovalReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkParameterRemovalWithSideEffectsRefused, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async assertParameterTypeChange() {
    assert.equal(this.#proof.sdkParameterTypeChangeReviewedAppliedAndRolledBack, true);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
  }

  async launchGradleForJavaCleanup() {
    assert.equal(this.#executionTool, "gradle");
    await this.launchSavedForRefactoring();
    const generated = this.file("gradle/app/build/generated/sources/annotationProcessor/java/main/generated/GeneratedGreeting.java");
    const compiled = this.file("gradle/app/build/classes/java/main/pkg/Runner.class");
    await assert.rejects(access(generated), { code: "ENOENT" });
    await assert.rejects(access(compiled), { code: "ENOENT" });
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    const generatedSource = await readFile(generated, "utf8");
    assert.match(generatedSource, /class GeneratedGreeting/);
    const bytecode = await readFile(compiled);
    assert.equal(bytecode.readUInt32BE(0), 0xcafebabe);
    assert.equal(bytecode.readUInt16BE(6), 61, "The reference project targets Java 17 on the selected JDK 21.");
    await writeFile(path.join(this.#lease!.runnerArtifactPath, "sdk-batch-cleanup-live-build.json"), JSON.stringify({
      sdkHome: this.executionSdk(), projectRelease: 17, classMajorVersion: 61,
      generatedSourceSha256: createHash("sha256").update(generatedSource).digest("hex"),
    }, null, 2));
    this.#proof.sdkBatchCleanupLiveBuildVerified = true;
    this.#proof.realGradleBuild = true;
    await this.synchronizeGradleForExecution();
  }

  private async selectSdkFormatterProfile() {
    const formatterPath = `${this.#executionTool}/${SDK_REFACTORING_FORMATTER_FILE}`;
    await this.browser().$("button=Settings").click();
    const settings = this.browser().$('[role="dialog"]');
    await settings.waitForDisplayed({ timeout: 5_000 });
    await this.browser().$('nav[aria-label="Settings sections"]').$("button*=Editor").click();
    await this.browser()
      .$('[aria-label="Eclipse formatter XML path"]')
      .setValue(formatterPath);
    await settings.$("button=Read profile names").click();
    const formatterNames = settings.$('select[aria-label="Eclipse formatter profile name"]');
    await formatterNames.waitForDisplayed({ timeout: 5_000 });
    assert.ok(await formatterNames.$('option[value="Compact Java"]').isExisting());
    await formatterNames.selectByVisibleText(SDK_REFACTORING_FORMATTER_NAME);
    await settings.$("button=Apply formatter profile").click();
    await this.browser().keys("Escape");
    return formatterPath;
  }

  async reviewApplyRollbackJavaCleanup(withFormatterProfile = false) {
    const tool = this.#executionTool;
    const source = this.executionSource();
    const library = `${tool}/library/src/main/java/fixtures/library/BaseGreeting.java`;
    const formatterPath = withFormatterProfile ? await this.selectSdkFormatterProfile() : undefined;
    const formatterXml = formatterPath ? await readFile(this.file(formatterPath), "utf8") : undefined;
    const formatterHash = formatterPath
      ? createHash("sha256").update(
        ["java-formatter-profile-v1", formatterPath, SDK_REFACTORING_FORMATTER_NAME, formatterXml].join("\0"),
      ).digest("hex")
      : undefined;
    await this.browser().$("button=Commands").click();
    let palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), "Review Java Cleanup");
    await palette.$('[role="option"][aria-label^="Review Java Cleanup"]').click();
    let dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await dialog.$('[aria-label="Cleanup file 1"]').getValue(), source);
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Cleanup file 2"]'), source);
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(async () => (await dialog.getText()).includes("distinct normalized Java source paths"), { timeout: 5_000, interval: 50 });
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    await this.assertInputs();
    this.#proof.sdkBatchCleanupDuplicateRefused = true;
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    // Acquire current saved authority after opening the source and checking the
    // local invalid selection; the provider may reject an earlier snapshot.
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    if (tool === "maven") await this.synchronizeMaven();
    else await this.synchronizeGradleForExecution();
    await this.browser().$("button=Commands").click();
    palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), "Review Java Cleanup");
    await palette.$('[role="option"][aria-label^="Review Java Cleanup"]').click();
    dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog.$('[aria-label="Find cleanup file 2"]').click();
    await pasteNativeText(this.#app!, dialog.$('[aria-label="Java cleanup file search"]'), "BaseGreeting");
    const match = dialog.$(`button=${library}`);
    await match.waitForDisplayed({ timeout: 10_000 });
    await match.click();
    assert.equal(await dialog.$('[aria-label="Cleanup file 2"]').getValue(), library);
    assert.equal(await dialog.$('[aria-label="Java cleanup file search"]').isExisting(), false);
    this.#proof.sdkBatchCleanupWorkspaceSearchSelected = true;
    await dialog.$('[aria-label="Cleanup action 2"]').selectByVisibleText("Format file");
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), { timeout: 30_000, interval: 100 });
    const tracePath = path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl");
    const readTrace = async () => (await readFile(tracePath, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    const trace = await readTrace();
    const preview = trace.filter((row) => row.event === "refactorkit.daemon.rpc.response" && row.details?.method === "refactor.preview").at(-1)?.details.response.result;
    const request = trace.filter((row) => row.event === "refactorkit.daemon.rpc.request" && row.details?.method === "refactor.preview").at(-1)?.details.params;
    assert.equal(preview?.operation, "batchCleanup");
    assert.equal(preview?.contextSchemaVersion, tool === "maven" ? "java-project-context-v2" : "java-project-context-v3");
    assert.equal(request?.javaContext.sdkHome, this.executionSdk());
    this.#proof.sdkBatchCleanupContextSchema = preview.contextSchemaVersion;
    if (formatterPath) {
      assert.equal(request?.formatterProfile?.path, formatterPath);
      assert.equal(request?.formatterProfile?.profileName, SDK_REFACTORING_FORMATTER_NAME);
      assert.equal(request?.formatterProfile?.xml, formatterXml);
      assert.equal(preview.formatterProfilePath, formatterPath);
      assert.equal(preview.formatterProfileName, SDK_REFACTORING_FORMATTER_NAME);
      assert.equal(preview.formatterProfileSha256, formatterHash);
      assert.ok((await dialog.getText()).includes(
        `RefactorKit used the workspace Eclipse formatter profile “${SDK_REFACTORING_FORMATTER_NAME}” from ${formatterPath}.`,
      ));
    }
    const diff = await dialog.$("pre").getText();
    assert.ok(diff.includes("Runner.java") && diff.includes("BaseGreeting.java"), diff);
    assert.equal(await dialog.$('[aria-label="Cleanup file 2"]').isEnabled(), false);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring applied successfully.')]")
      .waitForDisplayed({ timeout: 45_000 });
    assert.doesNotMatch(await readFile(this.file(source), "utf8"), /import java\.util\.List;/);
    const formattedLibrary = await readFile(this.file(library), "utf8");
    assert.notEqual(formattedLibrary, this.originalSource(library));
    if (formatterPath) {
      assert.match(formattedLibrary, /public class BaseGreeting\s*\n\s*\{/);
      const apply = (await readTrace()).filter((row) => row.event === "refactorkit.daemon.rpc.request" && row.details?.method === "refactor.apply").at(-1);
      assert.equal(apply?.details.params.planId, preview.planId);
      assert.equal(apply?.details.params.formatterProfileSha256, formatterHash);
    }
    const selected = new Set([source, library]);
    for (const [file, original] of this.#inputs) if (!selected.has(file)) assert.equal(await readFile(this.file(file), "utf8"), original, file);
    const copy = path.join(this.#lease!.runnerArtifactPath, "sdk-batch-cleanup-source-copy");
    await cp(this.file(tool), copy, { recursive: true, filter: (file) => !["target", "build", ".gradle", ".refactorkit"].includes(path.basename(file)) });
    const executable = tool === "maven" ? "mvn" : await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle");
    const args = tool === "maven"
      ? ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"]
      : ["--offline", "--no-daemon", "--console=plain", "-g", process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!, "test"];
    const build = await promisify(execFile)(executable, args, {
      cwd: copy, env: { ...process.env, JAVA_HOME: tool === "maven" ? this.#sdk : this.#gradleRuntimeSdk || this.#gradleSdk }, timeout: tool === "maven" ? 30_000 : 90_000, maxBuffer: 512 * 1024,
    });
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `sdk-batch-cleanup-${tool}.log`), build.stdout + build.stderr);
    assert.match(build.stdout, tool === "maven" ? /BUILD SUCCESS/ : /BUILD SUCCESSFUL/);

    const appliedLibrary = await readFile(this.file(library), "utf8");
    await writeFile(this.file(library), `${appliedLibrary}\n// Edit made after cleanup.\n`);
    const inputsBeforeRefusal = await Promise.all(Array.from(this.#inputs.keys(), async (file) =>
      [file, await readFile(this.file(file))] as const));
    await dialog.$("button=Rollback").click();
    const retry = dialog.$("button=Retry Rollback");
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Rollback was not started.") && await retry.isEnabled(),
      { timeout: 30_000, interval: 100, timeoutMsg: "Cleanup rollback did not refuse the external edit before writing" },
    );
    for (const [file, before] of inputsBeforeRefusal) {
      assert.deepEqual(await readFile(this.file(file)), before, `Refused cleanup rollback changed ${file}`);
    }
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    this.#proof.sdkBatchCleanupRollbackConflictPreservedInputs = true;

    await writeFile(this.file(library), appliedLibrary);
    await retry.click();
    await dialog
      .$(".//*[@role='status'][starts-with(normalize-space(.), 'Refactoring rolled back.')]")
      .waitForDisplayed({ timeout: 60_000 });
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, this.originalSource(source));
    await this.surface().assertDirty(source, false);
    this.#proof.sdkBatchCleanupReviewedAppliedAndRolledBack = true;
    this.#proof.sdkBatchCleanupBuildTool = tool;
  }

  async assertJavaCleanup() {
    assert.equal(this.#proof.sdkBatchCleanupBuildTool, this.#executionTool);
    if (this.#executionTool === "gradle") assert.equal(this.#proof.sdkBatchCleanupLiveBuildVerified, true);
    assert.equal(this.#proof.sdkBatchCleanupDuplicateRefused, true);
    assert.equal(this.#proof.sdkBatchCleanupWorkspaceSearchSelected, true);
    assert.equal(this.#proof.sdkBatchCleanupRollbackConflictPreservedInputs, true);
    assert.equal(this.#proof.sdkBatchCleanupReviewedAppliedAndRolledBack, true);
    await this.assertInputs();
  }

  async reviewApplyRollbackSdkRefactorings() {
    const captureSavedFiles = async () => {
      const files: Record<string, string> = {};
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const child = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(child);
          else if (entry.isFile()) {
            files[path.relative(this.file("maven"), child)] = createHash("sha256")
              .update(await readFile(child))
              .digest("hex");
          }
        }
      };
      await visit(this.file("maven"));
      return files;
    };
    const beforeLanguageConfiguration = await captureSavedFiles();
    const library = "maven/library/src/main/java/fixtures/library/BaseGreeting.java";
    const formatterPath = await this.selectSdkFormatterProfile();
    // Open each saved source through explorer controls and invoke its reviewed
    // RefactorKit action from Monaco's visible command palette.
    for (const [operation, file] of [
      ["format-file", library],
      ["organize-imports", SOURCE],
      ["rename-class", SOURCE],
    ] as const) {
      const action =
        operation === "organize-imports" ? "Review Java imports" : "Review Java formatting";
      const beforeSynchronization = await captureSavedFiles();
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      await this.synchronizeMaven();
      const afterSynchronization = await captureSavedFiles();
      assert.ok(this.#lease);
      const inventoryPath = path.join(
        this.#lease.runnerArtifactPath,
        `saved-refactoring-${operation}-file-inventory.json`,
      );
      await writeFile(
        inventoryPath,
        JSON.stringify(
          { beforeLanguageConfiguration, beforeSynchronization, afterSynchronization },
          null,
          2,
        ),
      );
      if (operation === "format-file") {
        const compiledOutputs = Object.entries(beforeLanguageConfiguration).filter(([file]) =>
          /\/target\/(?:classes|test-classes)\//u.test(file),
        );
        assert.ok(compiledOutputs.length > 0, "The fixture must have existing compiler output");
        for (const [file, hash] of compiledOutputs) {
          assert.equal(
            afterSynchronization[file],
            hash,
            `Java language-service configuration changed build-tool output ${file}`,
          );
        }
      }
      await this.browser().$('[role="tab"][aria-label="Files"]').click();
      await this.browser().waitUntil(
        async () => {
          const item = this.browser().$(`[role="treeitem"][data-path="${file}"]`);
          if (await item.isDisplayed()) return true;
          const folders = await this.browser()
            .$$('[role="treeitem"][aria-expanded="false"]')
            .getElements();
          for (const folder of folders) {
            const relative = await folder.getAttribute("data-path");
            if (relative && file.startsWith(`${relative}/`)) {
              await folder.scrollIntoView();
              await folder.click();
              return false;
            }
          }
          return false;
        },
        { timeout: 10_000, interval: 100, timeoutMsg: `Explorer did not expose ${file}` },
      );
      await this.surface().open(file, this.#inputs.get(file)!);
      await this.surface().focus(file);
      const beforePreview = await captureSavedFiles();
      await writeFile(
        inventoryPath,
        JSON.stringify(
          { beforeLanguageConfiguration, beforeSynchronization, afterSynchronization, beforePreview },
          null,
          2,
        ),
      );
      await this.browser().keys("F1");
      try {
        await this.browser().performActions([
          {
            type: "key",
            id: "sdk-action-search",
            actions: textKeySequence(action),
          },
        ]);
      } finally {
        await this.browser().releaseActions();
      }
      await this.browser().waitUntil(
        async () => (await this.browser().$(".quick-input-list").getText()).includes(action),
        {
          timeout: 40_000,
          interval: 200,
          timeoutMsg: `${action} was not advertised in the Command Palette`,
        },
      );
      const paletteRows = await this.browser()
        .$$(".quick-input-list .monaco-list-row")
        .getElements();
      let actionFound = false;
      for (const row of paletteRows)
        if ((await row.getText()).includes(action)) {
          await row.click();
          actionFound = true;
          break;
        }
      assert.ok(actionFound, `${action} was not present in the command palette`);
      const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
      await dialog.waitForDisplayed({ timeout: 5000 });
      if (operation === "rename-class") {
        const selects = await dialog.$$("select").getElements();
        await selects[0].selectByVisibleText("rename-class");
        await selects[1].selectByVisibleText("class");
        await pasteNativeText(this.#app!, dialog.$('input[placeholder="example.A"]'), "pkg.Runner");
        await pasteNativeText(this.#app!, dialog.$(".//label[span='New name']/input"), "Worker");
      }
      await dialog.$("button=Preview").click();
      await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
        timeout: 20_000,
        interval: 100,
      });
      const reviewedText = await dialog.getText();
      assert.ok(
        reviewedText.includes(
          operation === "format-file"
            ? "BaseGreeting.java"
            : operation === "organize-imports"
              ? "Runner.java"
              : "Worker.java",
        ),
        reviewedText,
      );
      if (operation === "format-file")
        assert.ok(
          reviewedText.includes(
            `RefactorKit used the workspace Eclipse formatter profile “${SDK_REFACTORING_FORMATTER_NAME}” from ${formatterPath}.`,
          ),
          reviewedText,
        );
      assert.ok(
        (await dialog.$$("pre").getElements()).length > 0,
        "Provider text diff is not visible",
      );
      await this.assertInputs();
      await dialog.$("button=Apply").click();
      await this.browser().waitUntil(
        async () => (await dialog.getText()).includes("Refactoring applied successfully."),
        { timeout: 20_000, interval: 100 },
      );
      assert.equal(await dialog.$("button=Rollback").isEnabled(), true);
      if (operation === "format-file") {
        const formatted = await readFile(this.file(file), "utf8");
        assert.notEqual(formatted, this.#inputs.get(file));
        assert.match(formatted, /public class BaseGreeting\s*\n\s*\{/);
      } else if (operation === "organize-imports") {
        assert.doesNotMatch(await readFile(this.file(file), "utf8"), /import java\.util\.List;/);
      } else {
        await assert.rejects(
          access(this.file(SOURCE)),
          (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
        );
        assert.match(
          await readFile(this.file("maven/app/src/main/java/pkg/Worker.java"), "utf8"),
          /class Worker/,
        );
        assert.equal(
          await readFile(this.file("maven/unrelated/src/main/java/pkg/Peer.java"), "utf8"),
          this.#inputs.get("maven/unrelated/src/main/java/pkg/Peer.java"),
        );
      }
      // Compile a source copy so qualification does not change the live
      // transaction's classpath evidence before protected rollback.
      const copy = path.join(this.#lease!.runnerArtifactPath, `sdk-${operation}-source-copy`);
      await cp(this.file("maven"), copy, {
        recursive: true,
        filter: (source) => !["target", ".refactorkit"].includes(path.basename(source)),
      });
      const build = await promisify(execFile)(
        "mvn",
        ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
        {
          cwd: copy,
          env: { ...process.env, JAVA_HOME: this.#sdk },
          timeout: 30_000,
          maxBuffer: 512 * 1024,
        },
      );
      await writeFile(
        path.join(this.#lease!.runnerArtifactPath, `sdk-${operation}-maven.log`),
        build.stdout + build.stderr,
      );
      assert.match(build.stdout, /BUILD SUCCESS/);
      await dialog.$("button=Rollback").click();
      await this.browser().waitUntil(
        async () => (await dialog.getText()).includes("Refactoring rolled back."),
        { timeout: 60_000, interval: 100 },
      );
      await this.assertInputs();
      if (operation === "rename-class")
        await assert.rejects(
          access(this.file("maven/app/src/main/java/pkg/Worker.java")),
          (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
        );
      if (operation === "organize-imports")
        assert.match(await readFile(this.file(file), "utf8"), /import java\.util\.List;/);
      await dialog.$("button=Cancel").click();
      await dialog.waitForExist({ reverse: true, timeout: 5000 });
      await this.surface().assertBuffer(file, this.#inputs.get(file)!);
      await this.surface().assertDirty(file, false);
      if (operation === "format-file") this.#proof.sdkFormattingReviewedAppliedAndRolledBack = true;
      else if (operation === "organize-imports")
        this.#proof.sdkImportOrganizationReviewedAppliedAndRolledBack = true;
      else this.#proof.sdkClassRenameReviewedAppliedAndRolledBack = true;
    }
    this.#proof.appliedSourceCopiesCompiledAndTested = true;
  }

  private async prepareManagedJpqlProject() {
    const api = process.env.IDE_JAVA_CONTEXT_JPQL_API_DIR;
    const hibernate = process.env.IDE_JAVA_CONTEXT_JPQL_HIBERNATE_DIR;
    assert.ok(api && path.isAbsolute(api), "Set IDE_JAVA_CONTEXT_JPQL_API_DIR to the fixture API jars.");
    assert.ok(hibernate && path.isAbsolute(hibernate), "Set IDE_JAVA_CONTEXT_JPQL_HIBERNATE_DIR to the Hibernate and H2 runtime jars.");
    const apiJars = managedJpqlApiJars.map(({ file }) => path.join(api, file));
    const runtimeJars = (await readdir(hibernate)).filter((file) => file.endsWith(".jar")).sort();
    assert.ok(runtimeJars.some((file) => file.startsWith("hibernate-core-")));
    assert.ok(runtimeJars.some((file) => file.startsWith("h2-")));
    for (const file of apiJars) await access(file, constants.R_OK);
    this.#jpqlVerificationClasspath = [
      ...apiJars,
      ...runtimeJars.map((file) => path.join(hibernate, file)),
    ].join(path.delimiter);
    return javaManagedJpqlProject(api);
  }

  async addNamedJpqlQuery(kind: "static" | "computed") {
    assert.equal(this.#jpaQueryFixture, "managed");
    const source = this.executionSource();
    const original = this.originalSource(source);
    const query = kind === "static"
      ? '"select u.amount from User u where u.amount is not null"'
      : '"select u." + "amount from User u where u.amount is not null"';
    const updated = original
      .replace("import jakarta.persistence.Id;\n", "import jakarta.persistence.Id;\nimport jakarta.persistence.NamedQuery;\n")
      .replace("@Entity\n", `@Entity\n@NamedQuery(name = "User.readNamed", query = ${query})\n`);
    assert.notEqual(updated, original);
    await writeFile(this.file(source), updated);
    this.#inputs.set(source, updated);
  }

  private async verifyManagedJpqlQuery(
    stage: "original" | "applied" | "restored" | "compiled-output-control" | "named-compiled-output-control" | "computed-query-control",
    namedQuery?: string,
  ) {
    assert.ok(this.#lease && this.#jpqlVerificationClasspath);
    const copy = path.join(this.#lease.runnerArtifactPath, `jpql-${stage}`);
    await cp(this.file("maven/src"), path.join(copy, "src"), { recursive: true });
    const check = path.join(copy, "CheckSavedQuery.java");
    await writeFile(check, managedJpqlQueryCheck, { flag: "wx" });
    const java = (tool: string, args: string[]) =>
      promisify(execFile)(path.join(this.#sdk, "bin", tool), args, {
        cwd: copy,
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      });
    const classes = path.join(copy, "classes");
    await mkdir(classes);
    await java("javac", [
      "-proc:none", "-d", classes, "-cp", this.#jpqlVerificationClasspath,
      managedJpqlEntity, managedJpqlRepository, check,
    ]);
    const run = await java("java", [
      "-cp", [classes, this.#jpqlVerificationClasspath].join(path.delimiter), "CheckSavedQuery",
      ...(namedQuery ? [namedQuery] : []),
    ]);
    await writeFile(path.join(copy, "query.log"), run.stdout + run.stderr);
    assert.match(run.stdout, /Verified JPQL result \[kept\] and column display_name/);
    if (namedQuery) assert.match(run.stdout, /Verified named JPQL result \[kept\]/);
    return classes;
  }

  private async assertManagedJpqlEmptyOutputs() {
    for (const output of MANAGED_JPQL_MAVEN_OUTPUTS) {
      const directory = this.file(output);
      assert.ok((await lstat(directory)).isDirectory(), `${output} is not a regular directory`);
      assert.deepEqual(await readdir(directory), [], `${output} contains build output`);
    }
  }

  private async waitForManagedJpqlEmptyOutputs() {
    await this.browser().waitUntil(async () => {
      for (const output of MANAGED_JPQL_MAVEN_OUTPUTS) {
        if (!(await lstat(this.file(output)).catch(() => null))?.isDirectory()) return false;
      }
      return true;
    }, { timeout: 15_000, interval: 100, timeoutMsg: "JDT LS did not create the Maven output directories" });
    await this.assertManagedJpqlEmptyOutputs();
  }

  private async openManagedJpqlRename() {
    const source = this.executionSource();
    await this.positionEditorCursorOnToken(source, this.originalSource(source), "String amount", "amount");
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), "Review Java Member Rename");
    await palette.$('[role="option"][aria-label^="Review Java Member Rename"]').click();
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await pasteNativeText(this.#app!, dialog.$(".//label[span='New name']/input"), "label");
    await dialog.$("button=Preview").click();
    return dialog;
  }

  async assertManagedJpqlRefusesCompiledOutput(namedQuery?: "User.readNamed") {
    const stage = namedQuery ? "named-compiled-output-control" : "compiled-output-control";
    const classes = await this.verifyManagedJpqlQuery(stage, namedQuery);
    const compiled = path.join("example", "jpql", "User.class");
    const output = this.file(`maven/target/classes/${compiled}`);
    const bytes = await readFile(path.join(classes, compiled));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: "wx" });
    await this.synchronizeMaven();
    await this.assertManagedJpqlReviewOnly(namedQuery ? 2 : 0);
    assert.deepEqual(await readFile(output), bytes);
    this.#proof.managedJpqlCompiledOutputRefused = true;
  }

  async assertManagedJpqlRefusesComputedNamedQuery() {
    await this.verifyManagedJpqlQuery("computed-query-control", "User.readNamed");
    await this.waitForManagedJpqlEmptyOutputs();
    await this.assertManagedJpqlReviewOnly(0);
    await this.assertManagedJpqlEmptyOutputs();
  }

  private async assertManagedJpqlReviewOnly(namedReferences: 0 | 2) {
    const dialog = await this.openManagedJpqlRename();
    const analysis = dialog.$(".//section[h3='Reference analysis']");
    await analysis.waitForDisplayed({ timeout: 30_000 }).catch(async (error) => {
      throw new Error(await dialog.getText(), { cause: error });
    });
    const text = await analysis.getText();
    assert.ok(text.includes(`Typed reference analysis incomplete: ${2 + namedReferences} reference locations.`));
    assert.match(text, /Project complete: No\. Managed write authority: none\./);
    assert.equal(text.match(/spring-data\.query-jpql/g)?.length, 2);
    assert.equal(text.match(/jpa\.named-query-jpql/g)?.length ?? 0, namedReferences);
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
  }

  async applyAndRollbackManagedJpqlRename(namedQuery?: "User.readNamed") {
    const source = this.executionSource();
    const repository = `maven/${managedJpqlRepository}`;
    const original = this.originalSource(source);
    const originalRepository = this.originalSource(repository);
    await this.verifyManagedJpqlQuery("original", namedQuery);
    await this.waitForManagedJpqlEmptyOutputs();
    const dialog = await this.openManagedJpqlRename();
    const apply = dialog.$("button=Apply");
    await apply.waitForEnabled({ timeout: 30_000 }).catch(async (error) => {
      throw new Error(await dialog.getText(), { cause: error });
    });
    const analysis = await dialog.$(".//section[h3='Reference analysis']").getText();
    assert.ok(analysis.includes(`Typed reference analysis complete: ${namedQuery ? 4 : 2} reference locations.`));
    assert.match(analysis, /Project complete: Yes\. Managed write authority: managed-stable\./);
    assert.ok(analysis.includes(managedJpqlRepository));
    if (namedQuery) {
      assert.equal(analysis.match(/jpa\.named-query-jpql/g)?.length, 2);
      assert.ok(analysis.includes(managedJpqlEntity));
    }
    await this.assertInputs();
    await apply.click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 30_000, interval: 100 },
    );
    let updatedSource = original.replace("String amount;", "String label;");
    if (namedQuery) updatedSource = updatedSource.replaceAll("u.amount", "u.label");
    assert.equal(await readFile(this.file(source), "utf8"), updatedSource);
    assert.equal(await readFile(this.file(repository), "utf8"), originalRepository.replaceAll("u.amount", "u.label"));
    await this.assertManagedJpqlEmptyOutputs();
    await this.verifyManagedJpqlQuery("applied", namedQuery);
    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 30_000, interval: 100 },
    );
    await this.assertInputs();
    await this.assertManagedJpqlEmptyOutputs();
    await this.verifyManagedJpqlQuery("restored", namedQuery);
    await dialog.$("button=Cancel").click();
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.managedJpqlRenameVerifiedAndRolledBack = true;
    this.#proof.managedJpqlEmptyOutputDirectoriesPreserved = true;
  }

  private async openJpqlFieldRenameReview(source: string) {
    await this.browser().$("button=Java Refactor").click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    const selects = await dialog.$$("select").getElements();
    assert.ok(selects.length >= 2, "Java Refactor target controls were not rendered");
    await selects[0]!.selectByVisibleText("rename-member");
    await selects[1]!.selectByVisibleText("member");
    await pasteNativeText(this.#app!, dialog.$(".//label[span='Source path']/input"), source);
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Element identity']/input"),
      "demo.User#displayName",
    );
    await pasteNativeText(this.#app!, dialog.$(".//label[span='New name']/input"), "displayLabel");
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(
      async () => {
        const text = await dialog.getText();
        return (
          text.includes("Typed reference analysis incomplete:") &&
          text.includes("spring-data.query-jpql")
        );
      },
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "The real RefactorKit preview did not return its JPQL reference analysis",
      },
    );
    return dialog;
  }

  async addUninspectedJpqlResources() {
    const query = "select u.displayName from User u";
    const files = {
      "maven/app/src/main/resources/META-INF/orm.xml": `
<entity-mappings xmlns="https://jakarta.ee/xml/ns/persistence/orm" version="3.2">
  <named-query name="User.external"><query>${query}</query></named-query>
</entity-mappings>
`.trimStart(),
      "maven/app/src/main/resources/META-INF/jpa-named-queries.properties": `User.external=${query}\n`,
      "maven/app/src/test/resources/queries/user.jpql": `${query}\n`,
    };
    for (const [relative, content] of Object.entries(files)) {
      const file = this.file(relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, { flag: "wx" });
      this.#inputs.set(relative, content);
    }
  }

  async reviewUninspectedJpqlResources() {
    const dialog = await this.openJpqlFieldRenameReview("maven/app/src/main/java/demo/User.java");
    const preview = await dialog.getText();
    const analysis = await dialog.$(".//section[h3='Reference analysis']").getText();
    const affectedFiles = await dialog.$(".//section[h3='Affected files']").getText();
    assert.match(analysis, /Typed reference analysis incomplete: 2 reference locations\./);
    assert.match(analysis, /Project complete: No\. Managed write authority: none\./);
    for (const relative of [
      "app/src/main/resources/META-INF/orm.xml",
      "app/src/main/resources/META-INF/jpa-named-queries.properties",
      "app/src/test/resources/queries/user.jpql",
    ]) {
      const warning = `JPQL reference closure cannot inspect workspace resource '${relative}'.`;
      assert.ok(analysis.includes(warning), `The reference analysis did not identify the uninspected resource: ${relative}`);
      assert.equal(preview.split(warning).length, 2, `The preview repeats the warning about ${relative}`);
      assert.ok(!affectedFiles.includes(relative), `The preview would edit an uninspected resource: ${relative}`);
    }
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
  }

  async reviewIncompleteJpqlFieldRename() {
    const source = "maven/app/src/main/java/demo/User.java";
    const repository = "maven/app/src/main/java/demo/UserRepository.java";
    const occurrence = `button=${repository}:4:52–4:63`;
    const original = this.originalSource(repository);
    const staleReview = await this.openJpqlFieldRenameReview(source);
    try {
      await writeFile(this.file(repository), "\n" + original);
      await this.browser().waitUntil(
        async () => !(await this.panel().getText()).includes("maven-effective-v1 · available"),
        { timeout: 15_000, interval: 100, timeoutMsg: "Editing the saved repository did not retire the Java project context" },
      );
      await staleReview.$(occurrence).click();
      await this.browser().waitUntil(
        async () => (await staleReview.getText()).includes("The selected Java project context changed."),
        { timeout: 5_000, interval: 100, timeoutMsg: "Opening a stale JPQL reference was not refused" },
      );
      assert.equal(await this.surface().tab(repository).isExisting(), false);
      assert.equal(await staleReview.$("button=Apply").isEnabled(), false);
      assert.equal(await readFile(this.file(repository), "utf8"), "\n" + original);
    } finally {
      await writeFile(this.file(repository), original);
    }
    await staleReview.$("button=Cancel").click();
    await staleReview.waitForExist({ reverse: true, timeout: 5_000 });
    await this.synchronizeMaven();

    const dialog = await this.openJpqlFieldRenameReview(source);
    const reviewed = await dialog.getText();
    assert.match(reviewed, /Typed reference analysis incomplete: 2 reference locations\./);
    assert.match(reviewed, /Project complete: No\. Managed write authority: none\./);
    assert.match(
      reviewed,
      /Reference closure is incomplete: only direct static Spring Data @Query JPQL property paths are inspected/,
    );
    assert.match(reviewed, /maven\/app\/src\/main\/java\/demo\/UserRepository\.java:4:20–4:31/);
    assert.match(reviewed, /maven\/app\/src\/main\/java\/demo\/UserRepository\.java:4:52–4:63/);
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.assertInputs();
    await dialog.$(occurrence).click();
    await dialog.waitForExist({ reverse: true, timeout: 10_000 });
    const tab = this.surface().tab(repository);
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(async () =>
      (await tab.getAttribute("aria-selected")) === "true" &&
      (await cursor.getText()).trim() === "Ln 4, Col 63",
    { timeout: 15_000, interval: 100, timeoutMsg: "The second JPQL reference was not selected in its editor" });
    await this.browser().waitUntil(
      () => this.browser().execute(() => {
        const editor = document.querySelector(".monaco-editor");
        const line = Array.from(editor?.querySelectorAll(".view-lines .view-line") ?? [])
          .find((row) => row.textContent?.includes("@Query"));
        if (line?.textContent?.slice(51, 62) !== "displayName") return false;

        // Match the painted selection to the rendered UTF-16 range, independently of the clipboard.
        const range = document.createRange();
        const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let offset = 0;
        for (let node = text.nextNode(); node; node = text.nextNode()) {
          const next = offset + (node.textContent?.length ?? 0);
          if (offset <= 51 && 51 < next) range.setStart(node, 51 - offset);
          if (offset < 62 && 62 <= next) {
            range.setEnd(node, 62 - offset);
            break;
          }
          offset = next;
        }
        const expected = range.getBoundingClientRect();
        return expected.width > 0 && Array.from(
          editor?.querySelectorAll(".view-overlays .selected-text") ?? [],
        ).some((selection) => {
          const actual = selection.getBoundingClientRect();
          return Math.abs(actual.left - expected.left) <= 2 &&
            Math.abs(actual.right - expected.right) <= 2 &&
            actual.top < expected.bottom && actual.bottom > expected.top;
        });
      }),
      { timeout: 5_000, interval: 100, timeoutMsg: "The visible JPQL selection did not match displayName" },
    );
    await this.surface().assertBuffer(repository, this.originalSource(repository));
    await this.surface().assertDirty(repository, false);
    this.#jpqlFieldRenameReviewQualified = true;
    await this.assertInputs();
  }

  async applyRollbackProjectModelMoveAndSafeDelete(
    entryPoint: "project-model" | "command-palette" = "project-model",
    crossModuleOnly = false,
  ) {
    const operations = [
      ...(this.#inputs.has("maven/app/src/main/java/pkg/MigrateToLibrary.java")
        ? [
            {
              operation: "move-class" as const,
              qualifiedName: "pkg.MigrateToLibrary",
              relativeSource: "maven/app/src/main/java/pkg/MigrateToLibrary.java",
              destination: "maven/library/src/main/java/fixtures/moved/MigrateToLibrary.java",
              destinationPackage: "fixtures.moved",
              targetModuleId: "library",
              crossModule: true,
            },
          ]
        : []),
      {
        operation: "move-class" as const,
        qualifiedName: "fixtures.unrelated.Hidden",
        relativeSource: "maven/unrelated/src/main/java/fixtures/unrelated/Hidden.java",
        destination: "maven/unrelated/src/main/java/fixtures/unrelated/moved/Hidden.java",
        destinationPackage: "fixtures.unrelated.moved",
        targetModuleId: undefined,
        crossModule: false,
      },
    ];

    for (const {
      operation,
      qualifiedName,
      relativeSource,
      destination,
      destinationPackage,
      targetModuleId,
      crossModule,
    } of operations) {
      if (crossModuleOnly && !crossModule) continue;
      const originalSource = this.#inputs.get(relativeSource);
      assert.ok(originalSource, `missing fixture source ${relativeSource}`);
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      await this.synchronizeMaven();
      await this.refreshSavedSourceStructure();
      const actionName = `Review ${operation === "move-class" ? "move" : "deletion"} of type ${qualifiedName}`;
      if (entryPoint === "command-palette") {
        const paletteActionName = `Review move of Java type ${qualifiedName}`;
        await this.openRefactoringSourceFromExplorer(relativeSource, originalSource);
        await this.surface().focus(relativeSource);
        await this.browser().$("button=Commands").click();
        const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
        await palette.waitForDisplayed({ timeout: 5000 });
        await palette.$('input[aria-label="Search commands"]').setValue(paletteActionName);
        const command = palette.$(`[role="option"][aria-label^="${paletteActionName}"]`);
        await command.waitForDisplayed({ timeout: 10_000 });
        await command.click();
      } else {
        const structure = this.panel().$(".//details[summary='Saved source structure']");
        const actions = await structure.$$(`button[aria-label="${actionName}"]`).getElements();
        let action: (typeof actions)[number] | undefined;
        for (const candidate of actions) {
          const rowText = (await candidate.$("./ancestor::li[1]").getText()).replaceAll("\\", "/");
          if (rowText.includes(relativeSource)) {
            action = candidate;
            break;
          }
        }
        assert.ok(action, `Java Project did not show ${actionName} for ${relativeSource}`);
        await action.waitForDisplayed({ timeout: 10_000 });
        await action.scrollIntoView({ block: "center", inline: "nearest" });
        await action.waitForClickable({ timeout: 10_000 });
        await action.click();
      }

      const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
      await dialog.waitForDisplayed({ timeout: 10_000 });
      if (operation === "move-class") {
        await this.surface().tab(relativeSource).waitForDisplayed({ timeout: 10_000 });
        await this.surface().assertBuffer(relativeSource, originalSource);
      }
      assert.equal(await dialog.$("select").getValue(), operation);
      const targetSelects = await dialog.$$("select").getElements();
      assert.equal(await targetSelects[1]!.getValue(), "class");
      if (operation === "move-class") {
        await pasteNativeText(
          this.#app!,
          dialog.$(".//label[span='Destination package']/input"),
          destinationPackage,
        );
        if (targetModuleId) {
          const destinationModule = dialog.$(".//label[span='Destination module']/select");
          await destinationModule.waitForDisplayed({ timeout: 10_000 });
          await destinationModule.selectByAttribute("value", targetModuleId);
          assert.equal(await destinationModule.getValue(), targetModuleId);
          this.#proof.sdkCrossModuleNewPackageDestinationSelected = true;
        }
      }

      await dialog.$("button=Preview").waitForEnabled({ timeout: 20_000 });
      await dialog.$("button=Preview").click();
      await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: `${operation} preview was not applicable`,
      });
      assert.ok((await dialog.$$("pre").getElements()).length > 0, "provider diff is not visible");
      await this.assertInputs();
      await dialog.$("button=Apply").click();
      await this.browser().waitUntil(
        async () => (await dialog.getText()).includes("Refactoring applied successfully."),
        { timeout: 20_000, interval: 100 },
      );
      assert.equal(await dialog.$("button=Rollback").isEnabled(), true);

      if (operation === "move-class") {
        const movedBuffer = originalSource.replace(
          /^package [^;]+;/m,
          `package ${destinationPackage};`,
        );
        await this.surface().tab(relativeSource).waitForExist({
          reverse: true,
          timeout: 10_000,
        });
        const movedTab = this.surface().tab(destination!);
        await movedTab.waitForDisplayed({ timeout: 10_000 });
        assert.equal(await movedTab.getAttribute("aria-selected"), "true");
        await assert.rejects(
          access(this.file(relativeSource)),
          (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
        );
        assert.equal(await readFile(this.file(destination!), "utf8"), movedBuffer);
        if (crossModule) {
          const client = await readFile(
            this.file("maven/app/src/main/java/pkg/MoveClient.java"),
            "utf8",
          );
          assert.ok(client.includes(`import ${destinationPackage}.MigrateToLibrary;`));
          assert.match(client, /MigrateToLibrary\.value\(\)/);
          this.#proof.sdkCrossModuleClassMoveUpdatedDependentModuleReference = true;
        }
        const copy = path.join(
          this.#lease!.runnerArtifactPath,
          crossModule
            ? "project-model-cross-module-move-source-copy"
            : "project-model-move-source-copy",
        );
        await cp(this.file("maven"), copy, {
          recursive: true,
          filter: (source) => !["target", ".refactorkit"].includes(path.basename(source)),
        });
        const build = await promisify(execFile)(
          "mvn",
          ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
          {
            cwd: copy,
            env: { ...process.env, JAVA_HOME: this.#sdk },
            timeout: 30_000,
            maxBuffer: 512 * 1024,
          },
        );
        await writeFile(
          path.join(
            this.#lease!.runnerArtifactPath,
            crossModule
              ? "project-model-cross-module-move-maven.log"
              : "project-model-move-maven.log",
          ),
          build.stdout + build.stderr,
        );
        assert.match(build.stdout, /BUILD SUCCESS/);
        this.#proof.sdkProjectModelMoveSourceCopyCompiledAndTested = true;
        if (crossModule) this.#proof.sdkCrossModuleClassMoveSourceCopyCompiledAndTested = true;
      }

      await dialog.$("button=Rollback").click();
      await this.browser().waitUntil(
        async () => (await dialog.getText()).includes("Refactoring rolled back."),
        { timeout: 60_000, interval: 100 },
      );
      assert.equal(await readFile(this.file(relativeSource), "utf8"), originalSource);
      if (operation === "move-class")
        await assert.rejects(
          access(this.file(destination!)),
          (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
        );
      await this.assertInputs();
      await dialog.$("button=Cancel").click();
      await dialog.waitForExist({ reverse: true, timeout: 5000 });
      if (operation === "move-class") {
        const originalTab = this.surface().tab(relativeSource);
        await originalTab.waitForDisplayed({ timeout: 10_000 });
        assert.equal(await originalTab.getAttribute("aria-selected"), "true");
        await this.surface().tab(destination!).waitForExist({
          reverse: true,
          timeout: 10_000,
        });
      }
      await this.surface().assertBuffer(relativeSource, originalSource);
      await this.surface().assertDirty(relativeSource, false);
      if (operation === "move-class")
        this.#proof.sdkOpenJavaTabFollowsProjectModelMoveAndRollback = true;
      if (crossModule) this.#proof.sdkCrossModuleClassMoveReviewedAppliedAndRolledBack = true;
    }

    if (crossModuleOnly) return;
    const referencedPath = "maven/unrelated/src/main/java/fixtures/unrelated/Hidden.java";
    const consumerPath = "maven/unrelated/src/main/java/fixtures/unrelated/UsesHidden.java";
    const referencedSource = this.#inputs.get(referencedPath);
    const consumerSource = this.#inputs.get(consumerPath);
    assert.ok(referencedSource, `missing fixture source ${referencedPath}`);
    assert.ok(consumerSource, `missing fixture source ${consumerPath}`);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeMaven();
    await this.refreshSavedSourceStructure();
    const referencedDelete = this.panel().$(
      "button[aria-label='Review deletion of type fixtures.unrelated.Hidden']",
    );
    await referencedDelete.waitForDisplayed({ timeout: 10_000 });
    await referencedDelete.scrollIntoView();
    await referencedDelete.click();
    const refusalDialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await refusalDialog.waitForDisplayed({ timeout: 10_000 });
    await refusalDialog.$("button=Preview").click();
    await this.browser().waitUntil(
      async () => (await refusalDialog.getText()).includes("RefactorKit refused this refactoring."),
      { timeout: 20_000, interval: 100, timeoutMsg: "Referenced type deletion was not refused" },
    );
    assert.equal(await refusalDialog.$("button=Apply").isEnabled(), false);
    assert.match(await refusalDialog.getText(), /RefactorKit refused/);
    assert.equal(await readFile(this.file(referencedPath), "utf8"), referencedSource);
    assert.equal(await readFile(this.file(consumerPath), "utf8"), consumerSource);
    await this.assertInputs();
    await refusalDialog.$("button=Cancel").click();
    await refusalDialog.waitForExist({ reverse: true, timeout: 5000 });
    await this.surface().assertBuffer(referencedPath, referencedSource);
    await this.surface().assertDirty(referencedPath, false);
    this.#proof.sdkReferencedSafeDeleteRefusedWithoutChanges = true;

    const buildReferencedPath = "maven/unrelated/src/main/java/fixtures/unrelated/Unused.java";
    const buildFile = "maven/pom.xml";
    const buildReferencedSource = this.#inputs.get(buildReferencedPath);
    const originalPom = this.#inputs.get(buildFile);
    assert.ok(buildReferencedSource, `missing fixture source ${buildReferencedPath}`);
    assert.ok(originalPom, `missing fixture build input ${buildFile}`);
    assert.match(
      originalPom,
      /<fixture\.safeDeleteTarget>fixtures\.unrelated\.Unused<\/fixture\.safeDeleteTarget>/,
    );
    const javaCallers = [...this.#inputs.entries()].filter(
      ([relativePath, source]) =>
        relativePath.endsWith(".java") &&
        relativePath !== buildReferencedPath &&
        source.includes("Unused"),
    );
    assert.deepEqual(javaCallers, [], "the Maven POM is the only reference to Unused");

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeMaven();
    await this.refreshSavedSourceStructure();
    const buildReferencedDelete = this.panel().$(
      "button[aria-label='Review deletion of type fixtures.unrelated.Unused']",
    );
    await buildReferencedDelete.waitForDisplayed({ timeout: 10_000 });
    await buildReferencedDelete.scrollIntoView();
    await buildReferencedDelete.click();
    const buildReferenceDialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await buildReferenceDialog.waitForDisplayed({ timeout: 10_000 });
    await buildReferenceDialog.$("button=Preview").click();
    await this.browser().waitUntil(
      async () => {
        const dialogText = await buildReferenceDialog.getText();
        return (
          dialogText.includes("Review-only proposal: delete fixtures.unrelated.Unused") &&
          dialogText.includes("Backend eligible: No")
        );
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg:
          "Maven-referenced safe delete did not produce an eligible review-only provider preview",
      },
    );
    assert.equal(await buildReferenceDialog.$("button=Apply").isEnabled(), false);
    assert.match(
      await buildReferenceDialog.getText(),
      /Review-only proposal: delete fixtures\.unrelated\.Unused/is,
    );
    assert.match(await buildReferenceDialog.getText(), /Backend eligible: No/);
    assert.match(
      await buildReferenceDialog.getText(),
      /complete project-wide reference analysis.*build and resource files/is,
    );
    assert.equal(await readFile(this.file(buildReferencedPath), "utf8"), buildReferencedSource);
    assert.equal(await readFile(this.file(buildFile), "utf8"), originalPom);
    await this.assertInputs();
    await buildReferenceDialog.$("button=Cancel").click();
    await buildReferenceDialog.waitForExist({ reverse: true, timeout: 5000 });
    await this.surface().assertBuffer(buildReferencedPath, buildReferencedSource);
    await this.surface().assertDirty(buildReferencedPath, false);
    this.#proof.sdkSafeDeleteWithMavenReferenceRemainsReadOnly = true;

    this.#proof.sdkProjectModelMoveReviewedAndSafeDeleteReviewed = true;
    if (entryPoint === "command-palette")
      this.#proof.sdkProjectModelClassMoveFromCommandPalette = true;
  }

  private packageMoveTextControlPath() {
    return `${this.#executionTool}/app/src/main/java/client/PackageMoveReference.java`;
  }
  async preparePackageMoveTextControl() {
    const relative = this.packageMoveTextControlPath();
    const source = `package client;

import pkg.Runner;

public final class PackageMoveReference {
  Runner imported;
  pkg.Runner qualified;
  // pkg.Runner is the key in external documentation.
  String url = "https://docs.example.test/pkg.Runner";
  String documentationKey = "pkg.Runner";
  String multiline = """
      See https://docs.example.test/pkg.Runner
      """;
}
`;
    await mkdir(path.dirname(this.file(relative)), { recursive: true });
    await writeFile(this.file(relative), source, { flag: "wx" });
    this.#inputs.set(relative, source);
  }
  async applyRollbackProjectModelPackageMove(
    entryPoint: "project-model" | "command-palette" = "project-model",
  ) {
    const buildTool = this.#executionTool;
    const fromPackage = "pkg";
    const toPackage = "pkg.relocated";
    const textControl = this.packageMoveTextControlPath();
    const expectedControl = this.originalSource(textControl)
      .replace("import pkg.Runner;", `import ${toPackage}.Runner;`)
      .replace("  pkg.Runner qualified;", `  ${toPackage}.Runner qualified;`);
    const packageSources = [...this.#inputs.entries()].filter(
      ([relativePath, source]) =>
        relativePath.startsWith(`${buildTool}/`) &&
        relativePath.endsWith(".java") &&
        /^package pkg;\s*$/mu.test(source.split("\n")[0] ?? ""),
    );
    assert.equal(
      packageSources.length,
      4,
      "fixture should place exact-package sources in two modules",
    );

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    if (buildTool === "maven") await this.synchronizeMaven();
    else
      assert.ok(
        (await this.panel().getText()).includes("gradle-effective-v1 · available"),
        "the evaluated Gradle project context was not retained for package-move review",
      );
    await this.refreshSavedSourceStructure(buildTool);
    if (entryPoint === "command-palette") {
      await this.browser().$("button=Commands").click();
      const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
      await palette.waitForDisplayed({ timeout: 5000 });
      await palette.$('input[aria-label="Search commands"]').setValue("Review move of package pkg");
      const command = palette.$('[role="option"][aria-label^="Review move of package pkg"]');
      await command.waitForDisplayed({ timeout: 5000 });
      await command.click();
    } else {
      const structure = this.panel().$(".//details[summary='Saved source structure']");
      const action = structure.$('button[aria-label="Review move of package pkg"]');
      await action.waitForDisplayed({ timeout: 10_000 });
      await action.scrollIntoView();
      await action.click();
    }

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 10_000 });
    assert.equal(await dialog.$("select").getValue(), "move-package");
    const targetSelects = await dialog.$$("select").getElements();
    assert.equal(await targetSelects[1]!.getValue(), "package");
    assert.equal(await dialog.$(".//label[span='Current package']/input").getValue(), fromPackage);
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Destination package']/input"),
      toPackage,
    );

    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "package-move preview was not applicable",
    });
    const previewParts: string[] = [];
    for (const item of await dialog.$$("pre").getElements())
      previewParts.push(await item.getText());
    assert.match(previewParts.join("\n"), /pkg\.relocated/);
    assert.ok(!previewParts.join("\n").includes("https://docs.example.test/pkg.relocated.Runner"));
    await this.assertInputs();

    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 20_000, interval: 100 },
    );
    assert.equal(await dialog.$("button=Rollback").isEnabled(), true);
    assert.equal(
      await readFile(this.file(textControl), "utf8"),
      expectedControl,
      "Move Package must update Java references and preserve the exact URL, comment and string bytes.",
    );

    for (const [relativePath, source] of packageSources) {
      const destination = relativePath.replace(/\/pkg\//u, "/pkg/relocated/");
      await assert.rejects(
        access(this.file(relativePath)),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      );
      assert.equal(
        await readFile(this.file(destination), "utf8"),
        source.replace(/^package pkg;/u, `package ${toPackage};`),
      );
    }

    const copy = path.join(
      this.#lease!.runnerArtifactPath,
      `project-model-package-move-${buildTool}-source-copy`,
    );
    await cp(this.file(buildTool), copy, {
      recursive: true,
      filter: (sourcePath) =>
        !(
          buildTool === "maven" ? ["target", ".refactorkit"] : ["build", ".gradle", ".refactorkit"]
        ).includes(path.basename(sourcePath)),
    });
    const build =
      buildTool === "maven"
        ? await promisify(execFile)(
            "mvn",
            ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
            {
              cwd: copy,
              env: { ...process.env, JAVA_HOME: this.#sdk },
              timeout: 30_000,
              maxBuffer: 512 * 1024,
            },
          )
        : await promisify(execFile)(
            await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle"),
            [
              "--offline",
              "--no-daemon",
              "--console=plain",
              "-g",
              await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!),
              "test",
            ],
            {
              cwd: copy,
              env: { ...process.env, JAVA_HOME: this.#gradleSdk },
              timeout: 120_000,
              maxBuffer: 512 * 1024,
            },
          );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, `project-model-package-move-${buildTool}.log`),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, buildTool === "maven" ? /BUILD SUCCESS/ : /BUILD SUCCESSFUL/);
    if (buildTool === "maven")
      this.#proof.sdkProjectModelPackageMoveSourceCopyCompiledAndTested = true;
    else {
      assert.match(build.stdout, /> Task :app:test(?:\s|$)/u);
      const reportPath = path.join(
        copy,
        "app/build/test-results/test/TEST-pkg.relocated.RunnerTest.xml",
      );
      const report = await readFile(reportPath, "utf8");
      const suite = report.match(/<testsuite\b[^>]*>/u)?.[0];
      assert.ok(suite, `Gradle did not produce the moved JUnit test report at ${reportPath}`);
      assert.match(suite, /\btests="1"/u);
      assert.match(suite, /\bfailures="0"/u);
      assert.match(suite, /\berrors="0"/u);
      this.#proof.sdkGradleProjectModelPackageMoveSourceCopyCompiledAndTested = true;
    }

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    for (const [relativePath, source] of packageSources) {
      assert.equal(await readFile(this.file(relativePath), "utf8"), source);
      const destination = relativePath.replace(/\/pkg\//u, "/pkg/relocated/");
      await assert.rejects(
        access(this.file(destination)),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      );
    }
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    this.#proof.sdkProjectModelPackageMoveReviewedAppliedAndRolledBack = true;
  }

  private async previewGradleClassMove({
    sourceType,
    relativeSource,
    destinationPackage,
    targetModuleId,
  }: Pick<typeof GRADLE_CROSS_MODULE_CLASS_MOVE, "sourceType" | "relativeSource" | "destinationPackage"> & {
    targetModuleId?: string;
  }) {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    assert.ok(
      (await this.panel().getText()).includes("gradle-effective-v1 · available"),
      "the evaluated Gradle project context was not retained for class-move review",
    );
    await this.refreshSavedSourceStructure("gradle");
    const structure = this.panel().$(".//details[summary='Saved source structure']");
    const actionName = `Review move of type ${sourceType}`;
    const actions = await structure.$$(`button[aria-label="${actionName}"]`).getElements();
    let action: (typeof actions)[number] | undefined;
    for (const candidate of actions) {
      const rowText = (await candidate.$("./ancestor::li[1]").getText()).replaceAll("\\", "/");
      if (rowText.includes(relativeSource)) {
        action = candidate;
        break;
      }
    }
    assert.ok(action, `Java Project did not show ${actionName} for ${relativeSource}`);
    await action.waitForDisplayed({ timeout: 10_000 });
    await action.scrollIntoView();
    await action.click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 10_000 });
    await this.surface().tab(relativeSource).waitForDisplayed({ timeout: 10_000 });
    await this.surface().assertBuffer(relativeSource, this.originalSource(relativeSource));
    assert.equal(await dialog.$("select").getValue(), "move-class");
    const targetSelects = await dialog.$$("select").getElements();
    assert.equal(await targetSelects[1]!.getValue(), "class");
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Destination package']/input"),
      destinationPackage,
    );
    if (targetModuleId) {
      const selector = dialog.$('select[aria-label="Destination module"]');
      await selector.waitForDisplayed({ timeout: 15_000 });
      await selector.selectByAttribute("value", targetModuleId);
      assert.equal(await selector.getValue(), targetModuleId);
    }
    await dialog.$("button=Preview").waitForEnabled({ timeout: 15_000 });
    await dialog.$("button=Preview").click();
    return dialog;
  }

  async assertGradleClassMoveRefusedWithMissingCompilerOutputs() {
    assert.equal(process.env.IDE_JAVA_CONTEXT_TRACE, "1", "Enable IDE_JAVA_CONTEXT_TRACE for provider verification");
    const move = GRADLE_CROSS_MODULE_CLASS_MOVE;
    const generated = this.file("gradle/app/build/generated/sources/annotationProcessor/java/main/generated/GeneratedGreeting.java");
    await assert.rejects(access(generated), { code: "ENOENT" });
    const dialog = await this.previewGradleClassMove(move);
    await this.browser().waitUntil(
      async () => {
        const text = await dialog.getText();
        if (text.includes("RefactorKit refused this refactoring.")) {
          assert.match(text, /missing project outputs/u);
          assert.match(text, /Compile the affected source sets and synchronize Gradle/u);
          return true;
        }
        assert.equal(await dialog.$("button=Apply").isEnabled(), false);
        return false;
      },
      { timeout: 45_000, interval: 100, timeoutMsg: "Gradle move did not explain the missing compiler outputs" },
    );
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.equal(await dialog.$("button=Rollback").isEnabled(), false);
    await assert.rejects(access(generated), { code: "ENOENT" });
    await assert.rejects(access(this.file(move.destination)), { code: "ENOENT" });
    await this.assertInputs();

    const trace = await readFile(
      path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"),
      "utf8",
    );
    const reply = trace.trimEnd().split("\n").reverse().map((line) => JSON.parse(line)).find(
      (entry) => entry.event === "refactorkit.daemon.rpc.response" &&
        entry.details.method === "refactor.preview",
    )?.details.response;
    assert.equal(reply?.error?.data?.refusalCode, "java.moveClass.gradleCompilerOutputsMissing");
    assert.equal(reply?.result, undefined);

    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(move.relativeSource, this.originalSource(move.relativeSource));
    await this.surface().assertDirty(move.relativeSource, false);
    this.#proof.sdkGradleClassMoveMissingCompilerOutputsRefused = true;
  }

  async applyRollbackGradleProjectModelClassMove(crossModule = false) {
    const move = crossModule ? GRADLE_CROSS_MODULE_CLASS_MOVE : GRADLE_SAME_MODULE_CLASS_MOVE;
    const { relativeSource, destination, destinationPackage } = move;
    const originalSource = this.originalSource(relativeSource);
    const dialog = await this.previewGradleClassMove(move);
    try {
      await dialog.$("button=Apply").waitForEnabled({ timeout: 30_000 });
    } catch (error) {
      await this.assertInputs();
      await assert.rejects(access(this.file(destination)), { code: "ENOENT" });
      throw new Error(`Attested Gradle class-move preview did not enable Apply. ${await dialog.getText()}`, {
        cause: error,
      });
    }
    const previewParts: string[] = [];
    for (const item of await dialog.$$("pre").getElements())
      previewParts.push(await item.getText());
    const preview = previewParts.join("\n");
    assert.ok(preview.includes(destinationPackage), "The diff does not include the target package");
    assert.equal(await readFile(this.file(relativeSource), "utf8"), originalSource);
    await this.assertInputs();

    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 20_000, interval: 100 },
    );
    assert.equal(await dialog.$("button=Rollback").isEnabled(), true);
    await assert.rejects(
      access(this.file(relativeSource)),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    const movedSource = originalSource.replace(
      /^package [^;]+;/m,
      `package ${destinationPackage};`,
    );
    assert.equal(await readFile(this.file(destination), "utf8"), movedSource);
    if (crossModule) {
      const client = await readFile(this.file("gradle/app/src/main/java/pkg/MoveClient.java"), "utf8");
      assert.ok(client.includes(`import ${destinationPackage}.MigrateToLibrary;`));
      assert.match(client, /MigrateToLibrary\.value\(\)/);
    }

    const artifactName = crossModule
      ? "gradle-cross-module-class-move"
      : "gradle-project-model-class-move";
    const copy = path.join(
      this.#lease!.runnerArtifactPath,
      `${artifactName}-source-copy`,
    );
    await cp(this.file("gradle"), copy, {
      recursive: true,
      filter: (sourcePath) =>
        !["build", ".gradle", ".refactorkit"].includes(path.basename(sourcePath)),
    });
    const build = await promisify(execFile)(
      await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle"),
      [
        "--offline",
        "--no-daemon",
        "--console=plain",
        "-g",
        await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!),
        "test",
      ],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#gradleSdk },
        timeout: 120_000,
        maxBuffer: 512 * 1024,
      },
    );
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, `${artifactName}.log`),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, /BUILD SUCCESSFUL/u);
    if (crossModule) {
      const report = await readFile(
        path.join(copy, "app/build/test-results/test/TEST-pkg.MoveClientTest.xml"),
        "utf8",
      );
      assert.match(report, /<testcase name="callsMovedType"/u);
      assert.match(report, /tests="1" skipped="0" failures="0" errors="0"/u);
    }
    this.#proof.sdkGradleProjectModelClassMoveSourceCopyCompiledAndTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      { timeout: 60_000, interval: 100 },
    );
    assert.equal(await readFile(this.file(relativeSource), "utf8"), originalSource);
    await assert.rejects(
      access(this.file(destination)),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    const originalTab = this.surface().tab(relativeSource);
    await originalTab.waitForDisplayed({ timeout: 10_000 });
    assert.equal(await originalTab.getAttribute("aria-selected"), "true");
    await this.surface().tab(destination).waitForExist({ reverse: true, timeout: 10_000 });
    await this.surface().assertBuffer(relativeSource, originalSource);
    await this.surface().assertDirty(relativeSource, false);
    this.#proof.sdkGradleProjectModelClassMoveReviewedAppliedAndRolledBack = true;
    if (crossModule) this.#proof.sdkGradleCrossModuleClassMoveReviewedAppliedAndRolledBack = true;
  }

  async applyRollbackProjectModelSourceRootMove() {
    const buildTool = this.#executionTool;
    const executionSource = this.executionSource();
    const sourceRoot = "unrelated/src/extra/java";
    const sourceFile = `${buildTool}/${sourceRoot}/fixtures/unrelated/Extra.java`;
    const destinationRoot = buildTool === "maven" ? "src/relocated/java" : "src/main/java";
    const destinationFile = `${buildTool}/unrelated/${destinationRoot}/fixtures/unrelated/Extra.java`;
    const originalSource = this.#inputs.get(sourceFile);
    assert.ok(originalSource, `missing fixture source ${sourceFile}`);

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    if (buildTool === "maven") await this.synchronizeMaven();
    else
      assert.ok(
        (await this.panel().getText()).includes("gradle-effective-v1 · available"),
        "the evaluated Gradle project context was not retained for source-root review",
      );
    const sourceSet = this.panel().$("label=Module and source set").$("select");
    const expectedSourceSetPrefix =
      buildTool === "maven"
        ? "Maven · unrelated · custom ("
        : this.projectSourceSetLabel("unrelated", "main", "main");
    const sourceSetOptions = await (
      await sourceSet.$$("option").getElements()
    ).map((option) => option.getText());
    const expectedSourceSet = sourceSetOptions.find((label) =>
      label.startsWith(expectedSourceSetPrefix),
    );
    assert.ok(
      expectedSourceSet,
      `source set beginning with ${expectedSourceSetPrefix} is not in the synchronized project model; available: ${sourceSetOptions.join(", ")}`,
    );
    await sourceSet.selectByVisibleText(expectedSourceSet!);
    const sourceRootRows = await this.panel().$("ul").$$("li").getElements();
    let action;
    for (const row of sourceRootRows) {
      if ((await row.getText()).includes(sourceRoot)) {
        action = row.$("button=Review move");
        break;
      }
    }
    assert.ok(action, `source root ${sourceRoot} is not shown by the ${buildTool} project model`);
    await action.waitForDisplayed({ timeout: 10_000 });
    await action.scrollIntoView({ block: "center", inline: "nearest" });
    await action.waitForClickable({ timeout: 10_000 });
    await action.click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 10_000 });
    assert.equal(await dialog.$("select").getValue(), "move-source-root");
    const targetSelects = await dialog.$$("select").getElements();
    assert.equal(await targetSelects[1]!.getValue(), "source-root");
    await pasteNativeText(
      this.#app!,
      dialog.$(".//label[span='Destination source root']/input"),
      `unrelated/${destinationRoot}`,
    );
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "move-source-root preview was not applicable",
    });
    assert.ok((await dialog.$$("pre").getElements()).length > 0, "provider diff is not visible");
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      { timeout: 30_000, interval: 100 },
    );
    assert.equal(await dialog.$("button=Rollback").isEnabled(), true);
    await assert.rejects(access(this.file(sourceFile)), (error: unknown) =>
      ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""),
    );
    assert.equal(await readFile(this.file(destinationFile), "utf8"), originalSource);

    const maven = buildTool === "maven";
    const copy = path.join(
      this.#lease!.runnerArtifactPath,
      `project-model-source-root-move-${buildTool}-source-copy`,
    );
    const excludedDirectories = maven
      ? ["target", ".refactorkit"]
      : ["build", ".gradle", ".refactorkit"];
    await cp(this.file(buildTool), copy, {
      recursive: true,
      filter: (sourcePath) => !excludedDirectories.includes(path.basename(sourcePath)),
    });
    const executable = maven
      ? "mvn"
      : await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle");
    const arguments_ = maven
      ? ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "-pl", "unrelated", "test"]
      : [
          "--offline", "--no-daemon", "--console=plain", "-g",
          await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!), "test",
        ];
    const build = await promisify(execFile)(executable, arguments_, {
      cwd: copy,
      env: { ...process.env, JAVA_HOME: maven ? this.#sdk : this.#gradleRuntimeSdk || this.#gradleSdk },
      timeout: 120_000,
      maxBuffer: 512 * 1024,
    });
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, `project-model-source-root-move-${buildTool}.log`),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, maven ? /BUILD SUCCESS/u : /BUILD SUCCESSFUL/u);
    const suite = "fixtures.unrelated.ExtraSourceRootTest";
    const reportDirectory = maven
      ? "unrelated/target/surefire-reports"
      : "unrelated/build/test-results/test";
    const report = await readNativeJUnitReport(
      copy,
      `${reportDirectory}/TEST-${suite}.xml`,
      "EXTRA_SOURCE_ROOT_TEST_OK",
      suite,
      suite,
      "movedSourceRemainsAvailableToItsModuleTest",
    );
    assert.equal(report.failures, 0);
    this.#proof.sdkProjectModelSourceRootSourceCopyTested = true;

    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => {
        const dialogText = await dialog.getText();
        const rollbackError = dialogText.match(/RefactorKit could not roll back[^\n]*/)?.[0];
        if (rollbackError) throw new Error(rollbackError);
        return dialogText.includes("Refactoring rolled back.");
      },
      {
        timeout: 60_000,
        interval: 100,
        timeoutMsg: "RefactorKit did not confirm source-root rollback",
      },
    );
    assert.equal(await readFile(this.file(sourceFile), "utf8"), originalSource);
    await assert.rejects(access(this.file(destinationFile)), (error: unknown) =>
      ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""),
    );
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    const executionTab = this.surface().tab(executionSource);
    await executionTab.waitForDisplayed({ timeout: 10_000 });
    await executionTab.click();
    await this.surface().assertBuffer(executionSource, this.#inputs.get(executionSource)!);
    await this.surface().assertDirty(executionSource, false);
    this.#proof.sdkProjectModelSourceRootMoveReviewedAppliedAndRolledBack = true;
  }

  async dropDraftApplyConfirmation(frame: "request" | "response") {
    const wrapper = path.join(this.#lease!.paths.root, "refactorkit-confirmation-wrapper");
    const marker = this.droppedDraftApplyConfirmationPath(frame);
    const proxy = path.resolve("tests/story/support/drop-java-apply-confirmation.py");
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec /usr/bin/python3 ${quote(proxy)} ${quote(this.#proof.daemon)} ${quote(marker)} ${quote(frame)} "$@"\n`,
      { flag: "wx", mode: 0o700 },
    );
    this.#draftConfirmationInterruption = { wrapper, frame };
    process.env.IDE_REFACTORKIT_DAEMON = wrapper;
  }

  private droppedDraftApplyConfirmationPath(frame: "request" | "response") {
    return path.join(this.#lease!.runnerArtifactPath, `java-apply-confirmation-${frame}-dropped.json`);
  }

  async stopAfterDraftFileMove() {
    const source = this.executionSource();
    const interposer = path.join(this.#lease!.paths.root, "stop-after-java-source-rename.so");
    await promisify(execFile)(
      "cc",
      ["-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", "-o", interposer,
        path.resolve("tests/story/support/stop-after-java-source-rename.c"), "-ldl"],
      { timeout: 10_000 },
    );
    this.#draftRenameStopEnvironment = {
      LD_PRELOAD: [interposer, process.env.LD_PRELOAD].filter(Boolean).join(" "),
      IDE_STORY_JAVA_RENAME_SOURCE: this.file(source),
      IDE_STORY_JAVA_RENAME_DESTINATION: this.file(source.replace("Runner.java", "DraftRunner.java")),
      IDE_STORY_JAVA_RENAME_MARKER: path.join(this.#lease!.runnerArtifactPath, "java-source-rename-stopped.txt"),
    };
    for (const [key, value] of Object.entries(this.#draftRenameStopEnvironment)) {
      this.#originalEnvironment.set(key, process.env[key]);
      process.env[key] = value;
    }
  }

  private async recoverInterruptedDraftFileMove(
    applyButton: ChainablePromiseElement,
    draft: string,
    currentPath: string,
  ) {
    const environment = this.#draftRenameStopEnvironment;
    assert.ok(environment);
    await this.waitForDraftCheckpoint();
    const click = applyButton.click().catch((error: unknown) => error);
    const deadline = Date.now() + 25_000;
    let stoppedPid: number | undefined;
    while (Date.now() < deadline) {
      try {
        const pid = Number(await readFile(environment.IDE_STORY_JAVA_RENAME_MARKER, "utf8"));
        if (Number.isSafeInteger(pid) && pid > 1) {
          const stat = await readFile(`/proc/${pid}/stat`, "utf8");
          if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("T ")) {
            stoppedPid = pid;
            break;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(stoppedPid, "The desktop did not stop inside the fixture's saved-source rename.");
    const source = this.executionSource();
    assert.equal(await readFile(this.file(currentPath), "utf8"), this.originalSource(source));
    await assert.rejects(access(this.file(source)), { code: "ENOENT" });
    const journalDirectory = this.file(`${this.#executionTool}/.refactorkit/editor-transactions`);
    const journalFiles = (await readdir(journalDirectory)).filter((name) => name.endsWith(".json"));
    assert.equal(journalFiles.length, 1);
    const journalPath = path.join(journalDirectory, journalFiles[0]);
    const { receipt: before } = JSON.parse(await readFile(journalPath, "utf8"));
    assert.equal(before.phase, "prepared");
    await this.#app!.forceTerminate(stoppedPid);
    for (const key of Object.keys(environment)) {
      const original = this.#originalEnvironment.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    await this.recordDraftStage("rename-class:stopped-after-file-move");
    await this.restoreSdkTransactionAfterRestart(draft, currentPath, true);
    const { receipt: after } = JSON.parse(await readFile(journalPath, "utf8"));
    assert.equal(after.id, before.id);
    assert.equal(after.phase, "undone");
    void click;
  }

  async applyUndoDirtySdkRefactorings(
    operations: readonly ("rename-member" | "format-file" | "organize-imports" | "rename-class")[],
    restartRecovery: false | "confirmed" | "confirmation-lost" | "file-move-interrupted" = false,
    useCursorContextMenu = false,
    useCursorShortcut = false,
  ) {
    const source = this.executionSource();
    const originalSource = this.originalSource(source);
    for (const file of [
      source,
      `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`,
      `${this.#executionTool}/unrelated/src/main/java/pkg/Peer.java`,
    ]) {
      await this.openRefactoringSourceFromExplorer(file, this.originalSource(file));
    }
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.surface().tab(source).click();
    const draft =
      "// draft transaction\n" +
      originalSource
        .replace("package pkg;", "package pkg;\nimport java.util.List;")
        .replace(
          "\n}\nclass Peer",
          '\n  private static String draftHelper() { return "draft"; }\n}\nclass Peer',
        );
    assert.notEqual(draft, originalSource);
    await pasteNativeText(
      this.#app!,
      this.browser().$(`[role="textbox"][aria-label^="Code editor for ${source}"]`),
      draft,
      {
        focus: () => this.surface().focus(source),
        verify: async () => {
          await this.browser().keys(["Control", "Home"]);
          return (await this.surface().renderedText({ file: source })) === draft;
        },
      },
    );
    await this.surface().assertBuffer(source, draft, this.completeEditorReadBack());
    await this.recordDraftStage("original-draft-verified");
    await this.surface().assertDirty(source, true);
    const lines = draft.split("\n"),
      line = lines.findIndex((text) => text.includes("draftHelper"));
    assert.ok(line >= 0);
    await this.browser().keys(["Control", "Home"]);
    const moves = [
      ...Array.from({ length: line }, () => "\uE015"),
      ...Array.from({ length: lines[line].indexOf("draftHelper") }, () => "\uE014"),
    ].flatMap((value) => [
      { type: "keyDown" as const, value },
      { type: "keyUp" as const, value },
    ]);
    try {
      await this.browser().performActions([{ type: "key", id: "draft-cursor", actions: moves }]);
    } finally {
      await this.browser().releaseActions();
    }
    for (const operation of operations) {
      if (operation === "rename-class") {
        await this.surface().focus(source);
        await this.browser().keys(["Control", "Home"]);
        const classLine = lines.findIndex((text) => text.includes("class Runner"));
        const steps = [
          ...Array.from({ length: classLine }, () => "\uE015"),
          ...Array.from({ length: lines[classLine].indexOf("Runner") }, () => "\uE014"),
        ].flatMap((value) => [
          { type: "keyDown" as const, value },
          { type: "keyUp" as const, value },
        ]);
        try {
          await this.browser().performActions([
            { type: "key", id: "draft-class-cursor", actions: steps },
          ]);
        } finally {
          await this.browser().releaseActions();
        }
      }
      const cursorRename = operation === "rename-member" || operation === "rename-class";
      if (useCursorShortcut && cursorRename) {
        await this.browser().keys(operation === "rename-class" ? ["Shift", "F6"] : ["F2"]);
        this.#proof.sdkRenameShortcutOperations.push(operation);
      } else if (useCursorContextMenu && cursorRename) {
        const collapseBottomPanel = this.browser().$('button[aria-label="Collapse bottom panel"]');
        if (await collapseBottomPanel.isDisplayed()) await collapseBottomPanel.click();
        const point = await this.browser().execute(() => {
          const cursor = document.querySelector<HTMLElement>(
            ".monaco-editor .cursors-layer .cursor",
          );
          if (!cursor) throw new Error("Monaco's visible cursor element is unavailable");
          const bounds = cursor.getBoundingClientRect();
          const x = Math.round(bounds.left + bounds.width / 2);
          const y = Math.round(bounds.top + bounds.height / 2);
          const editor = document.querySelector<HTMLElement>(".monaco-editor");
          if (!bounds.width || !bounds.height || !editor?.contains(document.elementFromPoint(x, y)))
            throw new Error("Monaco's visible cursor has no native pointer target");
          return { x, y };
        });
        try {
          await this.browser().performActions([
            {
              type: "pointer",
              id: "java-refactor-cursor-context-menu",
              parameters: { pointerType: "mouse" },
              actions: [
                { type: "pointerMove", ...point, origin: "viewport" },
                { type: "pointerDown", button: 2 },
                { type: "pointerUp", button: 2 },
              ],
            },
          ]);
        } finally {
          await this.browser().releaseActions();
        }
        const menuKeys =
          operation === "rename-class"
            ? ["End", "ArrowUp", "ArrowUp", "Enter"]
            : ["End", "ArrowUp", "Enter"];
        for (const key of menuKeys) {
          await this.browser().keys([key]);
          await this.browser().pause(150);
        }
      } else {
        await this.browser().$("button=Java Refactor").click();
      }
      const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
      await dialog.waitForDisplayed({ timeout: 5000 });
      const cursorAction = cursorRename && (useCursorContextMenu || useCursorShortcut);
      const selects = cursorAction ? [] : await dialog.$$("select").getElements();
      if (selects.length > 0) await selects[0].selectByVisibleText(operation);
      if (operation === "rename-member" || operation === "rename-class") {
        if (!cursorAction)
          await selects[1].selectByVisibleText(operation === "rename-member" ? "member" : "class");
        await pasteNativeText(
          this.#app!,
          dialog.$(".//label[span='New name']/input"),
          operation === "rename-member" ? "reviewedHelper" : "DraftRunner",
        );
      }
      await dialog.$("button=Preview").click();
      await this.browser().waitUntil(async () => await dialog.$("button=Apply").isEnabled(), {
        timeout: 20_000,
        interval: 100,
      });
      assert.equal(await dialog.$("button=Apply").isEnabled(), true);
      const diff = (await dialog.$$("pre").getElements())[0];
      assert.ok(
        diff &&
          (await diff.getText()).includes(
            operation === "rename-member"
              ? "reviewedHelper"
              : operation === "rename-class"
                ? "DraftRunner"
                : operation === "organize-imports"
                  ? "java.util.List"
                  : "draftHelper",
          ),
      );
      await this.assertInputs();
      await this.recordDraftStage(`${operation}:reviewed`);
      const currentPath =
        operation === "rename-class" ? source.replace("Runner.java", "DraftRunner.java") : source;
      if (restartRecovery === "file-move-interrupted") {
        await this.recoverInterruptedDraftFileMove(dialog.$("button=Apply"), draft, currentPath);
        this.#proof.sdkDirtyOperations.push(operation);
        continue;
      }
      await dialog.$("button=Apply").click();
      const confirmationLost = restartRecovery === "confirmation-lost";
      await this.browser().waitUntil(
        async () =>
          (await dialog.getText()).includes(
            confirmationLost
              ? "Inspect Java transaction recovery before retrying."
              : "Java drafts transformed without saving their content.",
          ),
        { timeout: 25_000, interval: 100 },
      );
      let interruptedTransaction: string | undefined;
      if (confirmationLost) {
        const interruption = this.#draftConfirmationInterruption;
        assert.ok(interruption);
        const report = JSON.parse(
          await readFile(this.droppedDraftApplyConfirmationPath(interruption.frame), "utf8"),
        );
        assert.equal(report.daemon, this.#proof.daemon);
        assert.equal(report.droppedFrame, interruption.frame);
        assert.equal(report.status, interruption.frame === "response" ? "applied" : undefined);
        assert.match(report.transactionId, /^[a-f0-9-]{36}$/u);
        assert.ok(Number.isInteger(report.requestId));
        interruptedTransaction = this.file(
          `${this.#executionTool}/.refactorkit/editor-transactions/${report.transactionId}.json`,
        );
        const { receipt: journal } = JSON.parse(await readFile(interruptedTransaction, "utf8"));
        assert.equal(journal.id, report.transactionId);
        assert.equal(journal.phase, interruption.frame === "response" ? "applied" : "prepared");
        assert.ok(
          !(await dialog.getText()).includes("Java drafts transformed without saving their content."),
        );
        this.#draftConfirmationInterruption = undefined;
        process.env.IDE_REFACTORKIT_DAEMON = this.#proof.daemon;
      }
      await this.recordDraftStage(`${operation}:${confirmationLost ? "confirmation-lost" : "applied"}`);
      await this.surface().assertDirty(currentPath, true);
      if (operation === "rename-class") {
        assert.equal(await readFile(this.file(currentPath), "utf8"), originalSource);
        await assert.rejects(access(this.file(source)));
      } else await this.assertInputs();
      const visible = await this.browser().execute(() =>
        Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"))
          .map((line) => line.textContent ?? "")
          .join("\n")
          .replaceAll("\u00a0", " "),
      );
      assert.ok(
        visible.includes(
          operation === "rename-member"
            ? "reviewedHelper"
            : operation === "rename-class"
              ? "class DraftRunner"
              : "class Runner",
        ),
      );
      if (operation === "organize-imports") assert.ok(!visible.includes("import java.util.List;"));
      if (restartRecovery) {
        await dialog.$("button=Cancel").click();
        await dialog.waitForExist({ reverse: true, timeout: 5000 });
        await this.restoreSdkTransactionAfterRestart(draft, currentPath);
        if (interruptedTransaction) {
          const { receipt: journal } = JSON.parse(await readFile(interruptedTransaction, "utf8"));
          assert.equal(journal.phase, "undone");
        }
      } else {
        await dialog.$("button=Undo").click();
        await this.browser().waitUntil(
          async () =>
            (await dialog.getText()).includes(
              "Original Java drafts restored without saving their content.",
            ),
          { timeout: 25_000, interval: 100 },
        );
        await this.assertInputs();
        await this.recordDraftStage(`${operation}:undone`);
        await dialog.$("button=Cancel").click();
        await dialog.waitForExist({ reverse: true, timeout: 5000 });
      }
      await this.surface().assertBuffer(source, draft, this.completeEditorReadBack());
      await this.surface().assertDirty(source, true);
      this.#proof.sdkDirtyOperations.push(operation);
    }
    this.#proof.sdkDirtyApplyUndoWithoutSave = true;
    await this.surface().discardUsingDisk(source, originalSource);
    await this.assertInputs();
  }

  async assertSdkRefactorings() {
    assert.equal(this.#proof.sdkFormattingReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkImportOrganizationReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkClassRenameReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.appliedSourceCopiesCompiledAndTested, true);
    await this.assertInputs();
  }
  async assertDraftRefactorings() {
    assert.equal(this.#proof.sdkDirtyApplyUndoWithoutSave, true);
    assert.deepEqual(
      this.#proof.sdkRenameShortcutOperations,
      this.#proof.sdkDirtyOperations.filter(
        (operation) => operation === "rename-class" || operation === "rename-member",
      ),
    );
    await this.assertInputs();
  }
  async assertRestartRefactoringRecovery() {
    assert.equal(this.#proof.sdkRestartRecoveryReviewedAndRestored, true);
    await this.assertInputs();
  }
  private async waitForDraftCheckpoint() {
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[aria-label="Recovery checkpoint status"]').getText()).includes(
          "ready",
        ),
      { timeout: 10000, interval: 100 },
    );
  }
  private async restoreSdkTransactionAfterRestart(
    originalDraft: string,
    currentPath: string,
    alreadyTerminated = false,
  ) {
    const source = this.executionSource();
    const originalSource = this.originalSource(source);
    if (!alreadyTerminated) {
      await this.waitForDraftCheckpoint();
      await this.#app!.forceTerminate();
    }
    await this.#app!.dispose();
    this.#app = new NativeDesktopApplication();
    this.#surface = new NativeEditorSurface(this.#app);
    await this.#app.launch();
    await this.#app.waitForFileExplorer();
    if (process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland") {
      const collapse = this.browser().$('button[aria-label="Collapse bottom panel"]');
      if (await collapse.isExisting()) await collapse.click();
    }
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    if (this.#executionTool === "maven") await this.synchronizeMaven();
    else await this.synchronizeGradleForExecution(false);
    const unrelatedPath = `${this.#executionTool}/library/src/main/java/fixtures/library/BaseGreeting.java`;
    const unrelatedSource = this.originalSource(unrelatedPath);
    const unrelatedDraft = `// unrelated draft after restart\n${unrelatedSource}`;
    await this.openRefactoringSourceFromExplorer(unrelatedPath, unrelatedSource);
    await pasteNativeText(this.#app!, this.browser().$(`[role="textbox"][aria-label^="Code editor for ${unrelatedPath}"]`), unrelatedDraft, {
      focus: () => this.surface().focus(unrelatedPath),
    });
    await this.surface().assertBuffer(unrelatedPath, unrelatedDraft, this.completeEditorReadBack());
    await this.surface().assertDirty(unrelatedPath, true);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const open = async () => {
      await this.browser().$("button=Java draft transactions").click();
      const dialog = this.browser().$('[role="dialog"][aria-label="Java draft transactions"]');
      await dialog.waitForDisplayed({ timeout: 10000 });
      await dialog.$("button=Review restoration").waitForEnabled({ timeout: 10000 });
      await dialog.$("button=Review restoration").click();
      await dialog.$("button=Restore original drafts").waitForEnabled({ timeout: 20000 }).catch(async (cause) => {
        throw new Error(`Draft restoration did not become available. ${await dialog.getText()}`, { cause });
      });
      const texts = await this.browser().execute(() =>
        Array.from(document.querySelectorAll('[aria-label="Reviewed original drafts"] pre')).map(
          (e) => e.textContent,
        ),
      );
      assert.ok(
        texts.includes(originalDraft),
        "Recovery must display the exact original dirty draft before approval.",
      );
      return dialog;
    };
    let dialog = await open();
    assert.equal(await readFile(this.file(currentPath), "utf8"), originalSource);
    await assert.rejects(access(this.file(source)));
    await dialog.$("button=Close").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    await this.surface().tab(unrelatedPath).click();
    await this.surface().assertBuffer(unrelatedPath, unrelatedDraft, this.completeEditorReadBack());
    await this.surface().assertDirty(unrelatedPath, true);
    await this.surface().tab(currentPath).click();
    await this.surface().assertBuffer(currentPath, originalSource, this.completeEditorReadBack());
    await this.surface().assertDirty(currentPath, false);
    dialog = await open();
    await dialog.$("button=Restore original drafts").click();
    await this.browser().waitUntil(
      async () =>
        (await dialog.getText()).includes(
          "Original Java drafts restored without saving source content.",
        ),
      { timeout: 60_000, interval: 100 },
    );
    await this.assertInputs();
    await dialog.$("button=Close").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    await this.surface().tab(unrelatedPath).click();
    await this.surface().assertBuffer(unrelatedPath, unrelatedDraft, this.completeEditorReadBack());
    await this.surface().assertDirty(unrelatedPath, true);
    await this.surface().discardUsingDisk(unrelatedPath, unrelatedSource);
    await this.surface().tab(source).click();
    await this.surface().assertBuffer(source, originalDraft, this.completeEditorReadBack());
    await this.surface().assertDirty(source, true);
    this.#proof.sdkRestartRecoveryReviewedAndRestored = true;
    await this.recordDraftStage("restart:reviewed-cancelled-and-restored");
  }
  private async recordDraftStage(stage: string) {
    this.#draftStages.push({ stage, time: new Date().toISOString() });
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "java-draft-progress.json"),
      JSON.stringify(this.#draftStages),
    );
  }
  private async requestMavenSynchronization(fromCommands = false, project = "maven") {
    await this.fill('input[placeholder="Workspace root"]', project);
    await this.fill('input[placeholder="Full JDK directory"]', this.#sdk);
    const mavenSettings = this.panel().$(".//details[summary='Maven settings']");
    if ((await mavenSettings.getAttribute("open")) === null)
      await mavenSettings.$("summary").click();
    await this.fill('input[placeholder="Engine default local repository"]', this.#repository);
    this.#mavenManifestBeforeSync = await this.fileManifest(this.file(project));
    if (fromCommands) await this.invokeProjectContextCommand("Synchronize Java Project");
    else await this.panel().$("button=Synchronize project").click();
  }
  async synchronizeMaven(fromCommands = false) {
    await this.requestMavenSynchronization(fromCommands);
    // Initial synchronization can require separate daemon discovery, project open, and context requests.
    await this.waitForText("maven-effective-v1 · available", 60_000);
    this.#mavenManifestAtSync = await this.fileManifest(this.file("maven"));
  }
  async prepareGitBranchWorkflow() {
    assert.ok(this.#lease);
    this.#gitBranchWorkflow = new NativeJavaGitBranchWorkflow(this.#lease.paths.workspace, this.executionSource(), this.#inputs, this.#executionTool);
    await this.#gitBranchWorkflow.prepare();
  }
  async synchronizeGitBranchProject() {
    if (this.#executionTool === "maven") await this.synchronizeMaven();
    else await this.synchronizeGradleForExecution();
  }
  private async runGitWorkflowTests() {
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.executionPanel().waitForDisplayed({ timeout: 5000 });
    const previousSession = await this.executionPanel().getAttribute("data-session-id");
    if (this.#gitWorkflowTestRuns === 0) await this.startSynchronizedProjectTests();
    else {
      await this.configureSynchronizedExecution();
      await this.requestProjectExecution("Run tests");
    }
    await this.browser().waitUntil(async () => {
      const current = await this.executionPanel().getAttribute("data-session-id");
      return Boolean(current && current !== previousSession);
    }, { timeout: 30_000, interval: 100, timeoutMsg: "The requested Java tests did not create a fresh execution session" });
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(3, 3, 0);
    this.#gitWorkflowTestRuns++;
    for (const method of TEST_METHODS) await this.assertTestProof(method, this.#gitWorkflowTestRuns);
  }
  async exerciseGitBranchWorkflow() {
    assert.ok(this.#gitBranchWorkflow && this.#app);
    await this.#gitBranchWorkflow.exercise({ app: this.#app, surface: this.surface(), synchronize: () => this.synchronizeGitBranchProject(), runTests: () => this.runGitWorkflowTests() });
  }
  async exerciseGitRebaseWorkflow() {
    assert.ok(this.#gitBranchWorkflow && this.#app);
    await this.#gitBranchWorkflow.exerciseRebase({ app: this.#app, surface: this.surface(), synchronize: () => this.synchronizeGitBranchProject(), runTests: () => this.runGitWorkflowTests() });
  }
  async synchronizeJava26ProjectContext() {
    await this.synchronizeSupportedJavaProjectContext(26);
  }
  async synchronizeJava27ProjectContext() {
    await this.synchronizeSupportedJavaProjectContext(27);
  }
  private async synchronizeSupportedJavaProjectContext(release: 26 | 27) {
    assert.equal(this.#javaRelease, release);
    if (this.#executionTool === "maven") await this.synchronizeMaven();
    else {
      await this.fill('input[placeholder="Workspace root"]', "gradle");
      await this.fill('input[placeholder="Full JDK directory"]', this.#gradleSdk);
      await this.evaluateGradle(false);
    }
  }
  private async openJava26ClassRenameDialog() {
    assert.equal(this.#javaRelease, 26);
    const tool = this.#executionTool;
    const source = `${tool}/app/src/main/java/pkg/Runner.java`;
    const original = this.originalSource(source);
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    for (const file of [source, `${tool}/app/src/test/java/pkg/RunnerTest.java`]) {
      const parts = file.split("/");
      for (let index = 1; index < parts.length; index++) {
        const folder = this.browser().$(
          `[role="treeitem"][data-path="${parts.slice(0, index).join("/")}"]`,
        );
        await folder.waitForDisplayed({ timeout: 5_000 });
        if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
      }
      await this.surface().open(file, this.originalSource(file));
    }
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeSupportedJavaProjectContext(26);
    const dialog = await this.openCursorParameterRefactoringDialog(
      source,
      original,
      "Review Java Type Rename",
      "public final class Runner",
      "Runner",
      "command-palette",
      false,
    );
    await pasteNativeText(this.#app!, dialog.$(".//label[span='New name']/input"), "Worker");
    await dialog.$("button=Preview").click();
    return dialog;
  }
  async buildJava26RefactoringInputs() {
    const generated = `${this.#executionTool}/app/${this.#executionTool === "maven" ? "target/generated-sources/annotations" : "build/generated/sources/annotationProcessor/java/main"}/generated/GeneratedGreeting.java`;
    await assert.rejects(access(this.file(generated)), { code: "ENOENT" });
    const dialog = await this.openJava26ClassRenameDialog();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("RefactorKit refused this refactoring"),
      { timeout: 30_000, interval: 100 },
    );
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    const trace = (
      await readFile(
        path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const failure = trace
      .filter(
        (row) =>
          row.event === "refactorkit.daemon.rpc.response" &&
          row.details.method === "refactor.editor.preview",
      )
      .at(-1)?.details.response.error;
    assert.equal(failure?.code, -32001);
    assert.equal(failure?.data?.refusalCode, "java.editor.semanticUnavailable");
    await this.assertInputs();
    await assert.rejects(
      access(this.file(`${this.#executionTool}/app/src/main/java/pkg/Worker.java`)),
      { code: "ENOENT" },
    );
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    this.#proof.java26RenameBeforeBuildRefused = true;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.browser().waitUntil(async () => {
      const text = await this.panel().getText();
      return text.includes("The selected Java project context changed. Synchronize the project and preview again.") &&
        !text.includes("Effective project context") && !text.includes("Partial project context");
    }, { timeout: 5_000, interval: 50 });
    this.#proof.java26RefusedPreviewRetiredContext = true;
    await this.synchronizeSupportedJavaProjectContext(26);
    this.#proof.java26ContextReacquiredAfterRefusal = true;
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    assert.match(await readFile(this.file(generated), "utf8"), /class GeneratedGreeting/);
    assert.match(await readFile(this.file(generated), "utf8"), /generated-greeting/);
    const output = `${this.#executionTool}/app/${this.#executionTool === "maven" ? "target/classes" : "build/classes/java/main"}/pkg/Runner.class`;
    const bytes = await readFile(this.file(output));
    assert.equal(bytes.readUInt32BE(0), 0xcafebabe);
    assert.equal(bytes.readUInt16BE(6), 70);
    await this.assertJava26QualifiedV7Context();
    this.#proof.java26ProcessorOutputBuilt = true;
  }
  async applyRollbackJava26ClassRename() {
    assert.ok(this.#proof.java26ProcessorOutputBuilt);
    const tool = this.#executionTool;
    const source = `${tool}/app/src/main/java/pkg/Runner.java`;
    const renamed = `${tool}/app/src/main/java/pkg/Worker.java`;
    const original = this.originalSource(source);
    let dialog = await this.openJava26ClassRenameDialog();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: "Java 26 class rename did not produce an applicable preview",
    });
    assert.match(await dialog.getText(), /Worker.java/);
    await this.assertInputs();
    await this.assertJava26RenameSdkAuthority();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () =>
        (await dialog.getText()).includes("Java drafts transformed without saving their content."),
      { timeout: 30_000, interval: 100 },
    );
    await this.surface().assertDirty(renamed, true);
    await this.surface().assertDirty(`${tool}/app/src/test/java/pkg/RunnerTest.java`, true);
    assert.equal(await readFile(this.file(renamed), "utf8"), original);
    assert.equal(
      await readFile(this.file(`${tool}/app/src/test/java/pkg/RunnerTest.java`), "utf8"),
      this.originalSource(`${tool}/app/src/test/java/pkg/RunnerTest.java`),
    );
    await this.waitForJava26RenamedEditor(renamed);
    await dialog.$("button=Undo").click();
    await this.browser().waitUntil(
      async () =>
        (await dialog.getText()).includes(
          "Original Java drafts restored without saving their content.",
        ),
      { timeout: 30_000, interval: 100 },
    );
    await this.assertInputs();
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    for (const file of [source, `${tool}/app/src/test/java/pkg/RunnerTest.java`]) {
      await this.surface().tab(file).click();
      await this.surface().focus(file);
      await assertNativeCopiedText(this.#app!, this.originalSource(file));
      await this.surface().assertDirty(file, false);
    }
    this.#proof.java26CursorApplyUndo = true;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeSupportedJavaProjectContext(26);
    await this.surface().tab(source).click();
    await this.browser().$("button=Java Refactor").click();
    dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, dialog.$('input[placeholder="example.A"]'), "pkg.Runner");
    await pasteNativeText(this.#app!, dialog.$(".//label[span='New name']/input"), "Worker");
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(() => dialog.$("button=Apply").isEnabled(), {
      timeout: 30_000,
      interval: 100,
    });
    assert.match(await dialog.getText(), /Worker.java/);
    await this.assertInputs();
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      {
        timeout: 30_000,
        interval: 100,
      },
    );
    await this.waitForJava26RenamedEditor(renamed);
    await assert.rejects(access(this.file(source)), { code: "ENOENT" });
    assert.equal(
      await readFile(this.file(renamed), "utf8"),
      original.replace(/\bRunner\b/g, "Worker"),
    );
    const testSource = `${tool}/app/src/test/java/pkg/RunnerTest.java`;
    assert.equal(
      await readFile(this.file(testSource), "utf8"),
      this.originalSource(testSource).replace(/\bRunner\b/g, "Worker"),
    );
    const copy = path.join(this.#lease!.runnerArtifactPath, `java26-${tool}-rename-source-copy`);
    await cp(this.file(tool), copy, {
      recursive: true,
      filter: (file) =>
        !["target", "build", ".gradle", ".refactorkit"].includes(path.basename(file)),
    });
    const executable =
      tool === "maven" ? "mvn" : await realpath(process.env.IDE_JAVA_CONTEXT_TEST_GRADLE!);
    const args =
      tool === "maven"
        ? ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"]
        : [
            "--offline",
            "--no-daemon",
            "--console=plain",
            "-g",
            await realpath(process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME!),
            "test",
          ];
    const build = await promisify(execFile)(executable, args, {
      cwd: copy,
      env: { ...process.env, JAVA_HOME: this.executionSdk() },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, `java26-${tool}-rename-build.log`),
      build.stdout + build.stderr,
    );
    assert.match(build.stdout, tool === "maven" ? /BUILD SUCCESS/ : /BUILD SUCCESSFUL/);
    const classFile = path.join(
      copy,
      tool === "maven"
        ? "app/target/classes/pkg/Worker.class"
        : "app/build/classes/java/main/pkg/Worker.class",
    );
    const bytes = await readFile(classFile);
    assert.equal(bytes.readUInt32BE(0), 0xcafebabe);
    assert.equal(bytes.readUInt16BE(6), 70);
    this.#proof.java26RenamedSourceCopyTested = true;
    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      {
        timeout: 60_000,
        interval: 100,
      },
    );
    await this.assertInputs();
    await assert.rejects(access(this.file(renamed)), { code: "ENOENT" });
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().assertBuffer(source, original);
    await this.surface().assertDirty(source, false);
    this.#proof.java26SdkManagedRename = true;
  }
  private async waitForJava26RenamedEditor(renamed: string) {
    await this.browser().waitUntil(
      async () =>
        this.browser().execute((sourcePath) => {
          const input = Array.from(
            document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
          ).find(
            (element) => element.getAttribute("aria-label") === `Code editor for ${sourcePath}`,
          );
          const host = input?.closest(".monaco-code-editor-host");
          return /class Worker/.test(
            (host?.querySelector(".view-lines")?.textContent ?? "").replaceAll("\u00a0", " "),
          );
        }, renamed),
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "The renamed editor did not render the transformed Worker declaration",
      },
    );
  }
  private async assertJava26QualifiedV7Context() {
    const trace = (
      await readFile(
        path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; details: Record<string, unknown> });
    const responses = trace.filter(
      (row) =>
        row.event === "refactorkit.daemon.rpc.response" &&
        row.details.method === "project.context.v7",
    );
    const contexts = responses
      .map((row) => (row.details.response as { result?: Record<string, unknown> }).result)
      .filter((value) => value?.status === "available");
    assert.ok(contexts.length > 0, "Build did not acquire a v7 project context");
    for (const context of contexts) {
      assert.deepEqual(context!.semanticAnalysis, { availability: "available", refusalCode: null });
      const sdk = context!.sdk as Array<Record<string, unknown>>;
      assert.ok(
        sdk.some(
          (value) =>
            value.sourceRelease === 26 &&
            value.platformRelease === 26 &&
            value.home === this.executionSdk(),
        ),
      );
      assert.match(String(context!.snapshotHash), /^[a-f0-9]{64}$/);
      assert.match(String(context!.contextHash), /^[a-f0-9]{64}$/);
      assert.equal((context!.analysis as Record<string, unknown>)?.backend, "eclipse-jdt");
    }
  }
  private async assertJava26RenameSdkAuthority() {
    const rows = (
      await readFile(
        path.join(this.#lease!.runnerArtifactPath, "java-project-context-snapshot-trace.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const preview = rows
      .filter(
        (row) =>
          row.event === "refactorkit.daemon.rpc.response" &&
          row.details.method === "refactor.editor.preview",
      )
      .at(-1)?.details.response.result;
    assert.ok(preview, "The editor provider did not return a successful rename preview");
    assert.equal(preview.evidence, "JDT_BINDING");
    assert.deepEqual(preview.diagnosticsBefore, []);
    assert.deepEqual(preview.diagnosticsAfterPreview, []);
    const contexts = rows
      .filter(
        (row) =>
          row.event === "refactorkit.daemon.rpc.response" &&
          ["project.context", "project.context.aggregate", "project.context.v7"].includes(
            row.details.method,
          ),
      )
      .map((row) => row.details.response.result)
      .filter((context) => context?.contextHash === preview.contextHash);
    assert.ok(contexts.length > 0, "Rename has no matching acquired SDK context");
    for (const context of contexts) {
      assert.equal(context.analysis?.backend, "eclipse-jdt");
      assert.equal(context.analysis?.warningCount, 0);
      assert.ok(
        context.sdk.some(
          (sdk: Record<string, unknown>) =>
            sdk.sourceRelease === 26 &&
            sdk.platformRelease === 26 &&
            sdk.home === this.executionSdk(),
        ),
      );
    }
  }
  async assertJava26ManagedRename() {
    assert.ok(
      this.#proof.java26SdkManagedRename &&
        this.#proof.java26RenamedSourceCopyTested &&
        this.#proof.java26CursorApplyUndo &&
        this.#proof.java26RenameBeforeBuildRefused &&
        this.#proof.java26RefusedPreviewRetiredContext &&
        this.#proof.java26ContextReacquiredAfterRefusal &&
        this.#proof.java26ProcessorOutputBuilt,
    );
    await this.assertInputs();
  }
  async assertJava26ProjectContext() {
    await this.assertSupportedJavaProjectContext(26);
  }
  async assertJava27ProjectContext() {
    await this.assertSupportedJavaProjectContext(27);
  }
  async assertJava27PreviewSourceOwnership() {
    assert.equal(this.#executionTool, "maven");
    assert.equal(this.#javaRelease, 27);
    await this.waitForText("maven-effective-v1 · available");
    await this.chooseSourceSet("main");
    const sdkHome = this.executionSdk();
    const panelText = await this.panel().getText();
    assert.ok(panelText.includes(`Java 27 platform from JDK 27: ${sdkHome}`), panelText);
    assert.ok(panelText.includes("Source level: 27"), panelText);
    assert.ok(panelText.includes("release 27"), panelText);

    assert.ok(this.#lease);
    const tracePath = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    type TraceEntry = { event: string; details: Record<string, unknown> };
    const readTrace = async () =>
      (await readFile(tracePath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceEntry);
    let trace = await readTrace();
    const contextRequest = trace.find(
      (entry) =>
        entry.event === "refactorkit.daemon.rpc.request" &&
        entry.details.method === "project.context" &&
        typeof (entry.details.params as Record<string, unknown> | undefined)
          ?.expectedSnapshotHash === "string",
    );
    assert.ok(
      contextRequest,
      "The preview candidate did not receive a snapshot-bound context request",
    );
    const responseFor = (request: TraceEntry, rows: TraceEntry[]) => {
      const response = rows.find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.response" &&
          entry.details.method === request.details.method &&
          entry.details.requestId === request.details.requestId,
      );
      assert.ok(response, `RefactorKit did not answer ${String(request.details.method)}`);
      const wire = response.details.response as Record<string, unknown>;
      const result = wire.result;
      assert.ok(typeof result === "object" && result !== null);
      return result as Record<string, unknown>;
    };
    const contextParams = contextRequest.details.params as Record<string, unknown>;
    const context = responseFor(contextRequest, trace);
    const analysis = context.analysis as Record<string, unknown> | null;
    assert.equal(context.status, "available");
    assert.ok(
      [
        "java-project-context-v2",
        "java-project-context-v3",
        "java-project-context-v6",
        "java-project-context-v7",
      ].includes(context.schemaVersion as string),
      `Unexpected Java 27 preview context schema: ${String(context.schemaVersion)}`,
    );
    assert.ok(analysis, "Java 27 preview context did not attest semantic analysis");
    assert.equal(analysis.backend, "eclipse-jdt");
    assert.equal(analysis.snapshotHash, context.snapshotHash);
    assert.equal(context.snapshotHash, contextParams.expectedSnapshotHash);
    const platformIdentities = analysis.platformIdentitiesByRelease as Record<string, unknown>;
    assert.equal(typeof platformIdentities["27"], "string");
    const sdk = (context.sdk as Array<Record<string, unknown>>).find(
      (entry) => entry.platformRelease === 27,
    );
    assert.ok(sdk, "The available context omitted its JDK 27 identity");
    assert.equal(sdk.home, sdkHome);
    assert.equal(sdk.identitySha256, platformIdentities["27"]);
    const daemonSha256 = createHash("sha256")
      .update(await readFile(this.#proof.daemon))
      .digest("hex");
    assert.equal(contextRequest.details.daemonSha256, daemonSha256);

    await this.resolve("main", "pkg.Runner");
    await this.browser().waitUntil(
      async () => {
        trace = await readTrace();
        const request = trace
          .slice()
          .reverse()
          .find(
            (entry) =>
              entry.event === "refactorkit.daemon.rpc.request" &&
              entry.details.method === "project.context" &&
              (entry.details.params as Record<string, unknown> | undefined)?.symbol ===
                "pkg.Runner",
          );
        if (!request) return false;
        const response = trace.find(
          (entry) =>
            entry.event === "refactorkit.daemon.rpc.response" &&
            entry.details.method === request.details.method &&
            entry.details.requestId === request.details.requestId,
        );
        if (!response) return false;
        const wire = response.details.response as Record<string, unknown>;
        const result = wire.result as Record<string, unknown> | undefined;
        const selected = result?.selectedSource as Record<string, unknown> | undefined;
        return selected?.symbol === "pkg.Runner";
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "The Java 27 preview provider did not resolve pkg.Runner ownership",
      },
    );
    const ownershipRequest = trace
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "project.context" &&
          (entry.details.params as Record<string, unknown> | undefined)?.symbol === "pkg.Runner",
      );
    assert.ok(ownershipRequest);
    const ownership = responseFor(ownershipRequest, trace);
    assert.equal(ownership.status, "available");
    assert.equal(ownership.snapshotHash, context.snapshotHash);
    const selected = ownership.selectedSource as Record<string, unknown>;
    assert.equal(selected.symbol, "pkg.Runner");
    assert.equal(selected.providerId, "maven-effective-v1");
    assert.equal(selected.moduleId, "app");
    assert.equal(selected.sourceSetId, "main");
    assert.equal(selected.path, "app/src/main/java/pkg/Runner.java");
    assert.equal(selected.evidence, "JDT_BINDING");
    assert.equal(selected.bindingKey, "Lpkg/Runner;");
    const resultText = await this.panel().getText();
    assert.ok(resultText.includes("pkg.Runner:"), resultText);
    assert.ok(resultText.includes("app/src/main/java/pkg/Runner.java"), resultText);
    await this.assertInputs();
    assert.deepEqual(await this.mavenFilesChangedFromBaseline(), []);
    await assert.rejects(access(this.file("maven/app/target")), { code: "ENOENT" });
    this.#proof.java27MavenContextAvailable = true;
    this.#proof.java27ContextSdkAndSnapshotAttested = true;
    this.#proof.java27ContextDaemonSha256 = daemonSha256;
    this.#proof.java27PreviewMavenSourceOwnership = true;
  }
  async assertJava27V7OwnerOnlySourceOwnership() {
    assert.equal(this.#executionTool, "maven");
    assert.equal(this.#javaRelease, 27);
    await this.waitForText("maven-effective-v1 · available");
    await this.chooseSourceSet("main");
    const sdkHome = this.executionSdk();
    const panelText = await this.panel().getText();
    assert.ok(panelText.includes(`Java 27 platform from JDK 27: ${sdkHome}`), panelText);
    assert.ok(panelText.includes("Source level: 27"), panelText);
    assert.ok(this.#lease);
    const tracePath = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    type TraceEntry = { event: string; details: Record<string, unknown> };
    const readTrace = async () =>
      (await readFile(tracePath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceEntry);
    const responseFor = (request: TraceEntry, rows: TraceEntry[]) => {
      const response = rows.find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.response" &&
          entry.details.method === request.details.method &&
          entry.details.requestId === request.details.requestId,
      );
      assert.ok(response, `RefactorKit did not answer ${String(request.details.method)}`);
      const wire = response.details.response as Record<string, unknown>;
      assert.ok(typeof wire.result === "object" && wire.result !== null);
      return wire.result as Record<string, unknown>;
    };
    let trace = await readTrace();
    const legacyRequest = trace
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "project.context" &&
          typeof (entry.details.params as Record<string, unknown> | undefined)
            ?.expectedSnapshotHash === "string" &&
          (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
            undefined,
      );
    assert.ok(
      legacyRequest,
      "The legacy Maven context request was not bound to the opened project snapshot",
    );
    const legacyContext = responseFor(legacyRequest, trace);
    assert.equal(legacyContext.status, "refused");
    assert.deepEqual(legacyContext.refusal, {
      code: "java.context.sourceLevelUnsupported",
      message:
        "Declared Java source level '27' is outside the installed JDT parser/compiler range 8-26",
    });

    const initialRequest = trace
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "project.context.v7" &&
          typeof (entry.details.params as Record<string, unknown> | undefined)
            ?.expectedSnapshotHash === "string" &&
          (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
            undefined,
      );
    assert.ok(
      initialRequest,
      "The v7 Maven context request was not bound to the opened project snapshot",
    );
    const initialParams = initialRequest.details.params as Record<string, unknown>;
    assert.equal(initialParams.providerId, "maven-effective-v1");
    assert.equal(initialParams.moduleId, "app");
    assert.equal(initialParams.sourceSetId, "main");
    const initialContext = responseFor(initialRequest, trace);
    assert.equal(initialContext.status, "available");
    assert.equal(initialContext.schemaVersion, "java-project-context-v7");
    assert.equal(initialContext.snapshotHash, initialParams.expectedSnapshotHash);
    assert.equal(initialParams.sdkHome, sdkHome);
    assert.equal(initialContext.selectedSource, null);
    assert.equal(initialContext.analysis, null);
    assert.deepEqual(initialContext.semanticAnalysis, {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    const sdk = (initialContext.sdk as Array<Record<string, unknown>>).find(
      (entry) => entry.platformRelease === 27,
    );
    assert.ok(sdk, "The Maven context omitted its JDK 27 identity");
    assert.equal(sdk.home, sdkHome);
    assert.match(sdk.identitySha256 as string, /^[a-f0-9]{64}$/);
    const daemonSha256 = createHash("sha256")
      .update(await readFile(this.#proof.daemon))
      .digest("hex");
    assert.equal(initialRequest.details.daemonSha256, daemonSha256);

    await this.resolveSourcePath("main", "pkg/Runner.java");
    await this.browser().waitUntil(
      async () => {
        trace = await readTrace();
        const request = trace
          .slice()
          .reverse()
          .find(
            (entry) =>
              entry.event === "refactorkit.daemon.rpc.request" &&
              entry.details.method === "project.context.v7" &&
              (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
                "pkg/Runner.java",
          );
        if (!request) return false;
        const params = request.details.params as Record<string, unknown>;
        if (params.symbol !== undefined) return false;
        const result = responseFor(request, trace);
        const selected = result.selectedSource as Record<string, unknown> | null;
        return (
          result.status === "available" && selected?.path === "app/src/main/java/pkg/Runner.java"
        );
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "The Java 27 v7 provider did not resolve source-root ownership for Runner.java",
      },
    );
    const ownerRequest = trace
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "project.context.v7" &&
          (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
            "pkg/Runner.java",
      );
    assert.ok(ownerRequest);
    const ownerParams = ownerRequest.details.params as Record<string, unknown>;
    assert.equal(ownerParams.symbol, undefined);
    const ownerContext = responseFor(ownerRequest, trace);
    assert.equal(ownerContext.status, "available");
    assert.equal(ownerContext.snapshotHash, initialContext.snapshotHash);
    assert.equal(ownerContext.analysis, null);
    assert.deepEqual(ownerContext.semanticAnalysis, {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    const selected = ownerContext.selectedSource as Record<string, unknown>;
    assert.equal(selected.symbol, null);
    assert.equal(selected.providerId, "maven-effective-v1");
    assert.equal(selected.moduleId, "app");
    assert.equal(selected.sourceSetId, "main");
    assert.equal(selected.path, "app/src/main/java/pkg/Runner.java");
    assert.equal(selected.sourceRoot, "app/src/main/java");
    assert.equal(selected.generated, false);
    assert.equal(selected.evidence, "SOURCE_ROOT_OWNERSHIP");
    assert.equal(selected.bindingKey, null);
    const resultText = await this.panel().getText();
    assert.ok(
      resultText.includes("Source: maven/app/src/main/java/pkg/Runner.java · app/main"),
      resultText,
    );
    assert.ok(resultText.includes("Java symbol analysis is unavailable"), resultText);
    await this.assertInputs();
    assert.deepEqual(await this.mavenFilesChangedFromBaseline(), []);
    await assert.rejects(access(this.file("maven/app/target")), { code: "ENOENT" });
    this.#proof.java27V7MavenOwnerOnlySourceOwnership = true;
    this.#proof.java27ContextDaemonSha256 = daemonSha256;
  }
  async assertJava27V7GradleOwnerOnlySourceOwnership() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    await this.waitForText("gradle-effective-v1 · available");
    await this.chooseSourceSet("main");
    const sdkHome = this.executionSdk();
    const panelText = await this.panel().getText();
    assert.ok(panelText.includes(`Java 27 platform from JDK 27: ${sdkHome}`), panelText);
    assert.ok(panelText.includes("Source level: 27"), panelText);
    assert.ok(this.#lease);
    const tracePath = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    type TraceEntry = { event: string; details: Record<string, unknown> };
    const readTrace = async () =>
      (await readFile(tracePath))
        .subarray(this.#contextTraceStart)
        .toString("utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceEntry);
    const responseFor = (request: TraceEntry, rows: TraceEntry[]) => {
      const response = rows.slice(rows.indexOf(request) + 1).find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.response" &&
          entry.details.method === request.details.method &&
          entry.details.requestId === request.details.requestId,
      );
      assert.ok(response, `RefactorKit did not answer ${String(request.details.method)}`);
      const wire = response.details.response as Record<string, unknown>;
      assert.ok(typeof wire.result === "object" && wire.result !== null);
      return wire.result as Record<string, unknown>;
    };
    let trace = await readTrace();
    const initialRequest = trace
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "project.context.v7" &&
          (entry.details.params as Record<string, unknown> | undefined)?.providerId ===
            "gradle-effective-v1" &&
          (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
            undefined,
      );
    assert.ok(initialRequest, "The v7 Gradle context request did not identify its provider");
    const initialParams = initialRequest.details.params as Record<string, unknown>;
    assert.equal(initialParams.moduleId, ":app");
    assert.equal(initialParams.sourceSetId, "main");
    assert.equal(initialParams.sdkHome, sdkHome);
    const initialContext = responseFor(initialRequest, trace);
    assert.equal(initialContext.status, "available");
    assert.equal(initialContext.schemaVersion, "java-project-context-v7");
    assert.equal(initialContext.snapshotHash, initialParams.expectedSnapshotHash);
    assert.equal(initialContext.selectedSource, null);
    assert.equal(initialContext.analysis, null);
    assert.deepEqual(initialContext.semanticAnalysis, {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    const sdk = (initialContext.sdk as Array<Record<string, unknown>>).find(
      (entry) => entry.platformRelease === 27,
    );
    assert.ok(sdk, "The Gradle context omitted its JDK 27 identity");
    assert.equal(sdk.home, sdkHome);
    assert.match(sdk.identitySha256 as string, /^[a-f0-9]{64}$/);

    await this.resolveSourcePath("main", "pkg/Runner.java");
    await this.browser().waitUntil(
      async () => {
        trace = await readTrace();
        const request = trace
          .slice()
          .reverse()
          .find(
            (entry) =>
              entry.event === "refactorkit.daemon.rpc.request" &&
              entry.details.method === "project.context.v7" &&
              (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
                "pkg/Runner.java",
          );
        if (!request) return false;
        const params = request.details.params as Record<string, unknown>;
        if (params.symbol !== undefined) return false;
        const result = responseFor(request, trace);
        const selected = result.selectedSource as Record<string, unknown> | null;
        return (
          result.status === "available" && selected?.path === "app/src/main/java/pkg/Runner.java"
        );
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg:
          "The Java 27 v7 provider did not resolve Gradle source-root ownership for Runner.java",
      },
    );
    const ownerRequest = trace
      .slice()
      .reverse()
      .find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" &&
          entry.details.method === "project.context.v7" &&
          (entry.details.params as Record<string, unknown> | undefined)?.sourceRelativePath ===
            "pkg/Runner.java",
      );
    assert.ok(ownerRequest);
    const ownerParams = ownerRequest.details.params as Record<string, unknown>;
    assert.equal(ownerParams.providerId, "gradle-effective-v1");
    assert.equal(ownerParams.moduleId, ":app");
    assert.equal(ownerParams.sourceSetId, "main");
    assert.equal(ownerParams.symbol, undefined);
    const ownerContext = responseFor(ownerRequest, trace);
    assert.equal(ownerContext.status, "available");
    assert.equal(ownerContext.snapshotHash, initialContext.snapshotHash);
    assert.equal(ownerContext.analysis, null);
    const selected = ownerContext.selectedSource as Record<string, unknown>;
    assert.equal(selected.symbol, null);
    assert.equal(selected.providerId, "gradle-effective-v1");
    assert.equal(selected.moduleId, ":app");
    assert.equal(selected.sourceSetId, "main");
    assert.equal(selected.path, "app/src/main/java/pkg/Runner.java");
    assert.equal(selected.sourceRoot, "app/src/main/java");
    assert.equal(selected.generated, false);
    assert.equal(selected.evidence, "SOURCE_ROOT_OWNERSHIP");
    assert.equal(selected.bindingKey, null);
    const resultText = await this.panel().getText();
    assert.ok(resultText.includes("app/src/main/java/pkg/Runner.java · :app/main"), resultText);
    assert.ok(resultText.includes("Java symbol analysis is unavailable"), resultText);
    await this.assertInputs();
    this.#proof.java27V7GradleOwnerOnlySourceOwnership = true;
  }
  async navigateJava27DefinitionWithJdtLs() {
    assert.equal(this.#javaRelease, 27);
    const gradle = this.#executionTool === "gradle";
    assert.equal(
      gradle
        ? this.#proof.java27V7GradleOwnerOnlySourceOwnership
        : this.#proof.java27V7MavenOwnerOnlySourceOwnership,
      true,
    );
    const sourcePath = gradle ? "gradle/app/src/main/java/pkg/Runner.java" : SOURCE;
    await this.startLanguageServiceWithSdk(this.executionSdk());
    const serviceStatus = await this.browser().executeAsync((done) => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__?.invoke;
      if (!invoke) {
        done({ error: "The Tauri invoke bridge is unavailable." });
        return;
      }
      void invoke("get_java_language_service_status").then(done, (error) =>
        done({ error: error instanceof Error ? error.message : String(error) }),
      );
    });
    assert.ok(
      typeof serviceStatus === "object" && serviceStatus !== null,
      "The Java language service did not return its active configuration.",
    );
    const activeService = serviceStatus as Record<string, unknown>;
    assert.equal(activeService.gradleImportEnabled, gradle);
    if (gradle) assert.equal(activeService.gradleSettingsConfigured, true);
    const capabilities = activeService.capabilities;
    assert.ok(
      typeof capabilities === "object" && capabilities !== null,
      "JDT LS did not report its initialized capabilities.",
    );
    assert.equal(
      (capabilities as Record<string, unknown>).definition,
      true,
      "The active JDT LS session did not advertise definition navigation.",
    );
    assert.equal(
      (capabilities as Record<string, unknown>).references,
      true,
      "The active JDT LS session did not advertise reference search.",
    );
    this.#proof.java27JdtlsGradleImportEnabled = activeService.gradleImportEnabled === true;
    const serverJava = await realpath(path.join(this.#jdtlsServerSdk, "bin/java"));
    const javaLanguageStatus = await this.languagePanel().getText();
    assert.equal(
      await this.#app!.environmentValue("IDE_JDTLS_JAVA_HOME"),
      this.#jdtlsServerSdk,
      "The native IDE did not inherit the qualified JDK 25 server runtime.",
    );
    assert.equal(
      await this.#app!.environmentValue("IDE_JAVA_HOME"),
      this.executionSdk(),
      "The native IDE did not inherit the Java 27 project JDK.",
    );
    assert.ok(javaLanguageStatus.includes("Server Java: " + serverJava), javaLanguageStatus);
    assert.ok(
      javaLanguageStatus.includes("Project JDK: " + this.executionSdk()),
      javaLanguageStatus,
    );
    this.#proof.java27JdtlsServerRuntimeJdk25ProjectJdk27 = true;
    await this.requestJava27DefinitionAtInheritedCall(sourcePath, gradle);
  }
  private async requestJava27DefinitionAtInheritedCall(sourcePath: string, gradle: boolean) {
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().keys(["Control", "p"]);
    const quickOpen = this.browser().$('[role="dialog"][aria-label="Go to File"]');
    await quickOpen.waitForDisplayed({ timeout: 5_000 });
    await quickOpen.$('[role="combobox"][aria-label="Search workspace files"]').setValue(sourcePath);
    const result = quickOpen.$(`[role="option"][data-path="${sourcePath}"]`);
    await result.waitForDisplayed({ timeout: 10_000 });
    await result.click();
    const source = this.originalSource(sourcePath);
    await this.surface().assertDirty(sourcePath, false);
    assert.equal(await readFile(this.file(sourcePath), "utf8"), source);
    const offset = source.indexOf("message(2)");
    assert.notEqual(offset, -1, "The selected source fixture has no inherited integer call.");
    const line = source.slice(0, offset).split("\n").length;
    const lineText = source.split("\n")[line - 1];
    const column = Array.from(lineText.slice(0, lineText.indexOf("message(2)"))).length;
    await this.surface().focus(sourcePath);
    await this.browser().keys(["Control", "Home"]);
    for (let index = 1; index < line; index++) await this.browser().keys("ArrowDown");
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "java27-jdtls-definition-caret",
          actions: textKeySequence("\uE014".repeat(column)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[data-testid="editor-cursor-position"]').getText()).trim() ===
        `Ln ${line}, Col ${column + 1}`,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "The editor did not place the caret on the Java 27 inherited call",
      },
    );
    const input = this.browser().$(`[role="textbox"][aria-label^="Code editor for ${sourcePath}"]`);
    assert.equal(await input.isFocused(), true);
    assert.ok((await this.surface().renderedText({ file: sourcePath })).split("\n").includes(lineText));
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
    });
    if (!gradle) {
      this.#proof.java27JdtlsProjectChangesBeforeF12 = (
        await this.mavenFilesChangedFromBaseline()
      ).map((change) => change.path);
      await writeFile(
        path.join(this.#lease!.runnerArtifactPath, "java27-jdtls-imported-paths.json"),
        JSON.stringify(this.#proof.java27JdtlsProjectChangesBeforeF12),
      );
    }
    this.#proof.contextNavigationDefinitionCallsBeforeF12 =
      await this.definitionProviderCallCount(sourcePath);
    await this.browser().keys("F12");
    await this.browser().waitUntil(
      async () =>
        (await this.definitionProviderCallCount(sourcePath)) >
        (this.#proof.contextNavigationDefinitionCallsBeforeF12 ?? 0),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "F12 did not invoke RefactorKit's registered Java definition provider",
      },
    );
    this.#proof.contextNavigationDefinitionCallsAfterF12 =
      await this.definitionProviderCallCount(sourcePath);
  }
  async refreshJava27MavenContextAfterLanguageImport() {
    assert.equal(this.#executionTool, "maven");
    assert.equal(this.#javaRelease, 27);
    await this.assertInputs();
    assert.deepEqual(await this.mavenFilesChangedFromBaseline(), []);
    const materialized: string[] = [];
    for (const output of [
      "app/target/classes",
      "app/target/test-classes",
      "library/target/classes",
      "library/target/test-classes",
    ]) {
      try {
        await readdir(this.file(`maven/${output}`));
        materialized.push(output);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.#proof.java27JdtlsMaterializedOutputRoots = materialized;
    assert.ok(
      materialized.length > 0,
      "The language-server import did not materialize a declared output root.",
    );
    const recovery = this.browser().$("button=Open Java Project");
    await recovery.waitForDisplayed({ timeout: 10_000 });
    await recovery.click();
    await this.panel().waitForDisplayed({ timeout: 5_000 });
    await this.surface().assertBuffer(SOURCE, this.originalSource(SOURCE));
    this.#proof.java27NavigationProjectRecoveryActionVerified = true;
    await this.synchronizeMaven();
    this.#proof.java27ContextRefreshedAfterLanguageImport = true;
    await this.requestJava27DefinitionAtInheritedCall(SOURCE, false);
  }
  async assertJava27JdtLsDefinition() {
    const gradle = this.#executionTool === "gradle";
    assert.equal(
      gradle
        ? this.#proof.java27V7GradleOwnerOnlySourceOwnership
        : this.#proof.java27V7MavenOwnerOnlySourceOwnership,
      true,
    );
    assert.equal(this.#javaRelease, 27);
    const file = gradle
      ? "gradle/library/src/main/java/fixtures/library/BaseGreeting.java"
      : "maven/library/src/main/java/fixtures/library/BaseGreeting.java";
    const sourcePath = gradle ? "gradle/app/src/main/java/pkg/Runner.java" : SOURCE;
    const original = this.#inputs.get(file);
    assert.ok(original, `The selected fixture did not capture ${file}`);
    const offset = original.indexOf("message(int");
    assert.notEqual(offset, -1, "The library fixture has no inherited integer declaration.");
    const line = original.slice(0, offset).split("\n").length;
    const declarationLine = original.split("\n")[line - 1];
    const column = Array.from(
      declarationLine.slice(0, declarationLine.indexOf("message(int")),
    ).length;
    await this.surface().tab(file).waitForDisplayed({ timeout: 60_000 });
    await this.browser().waitUntil(
      async () => (await this.surface().tab(file).getAttribute("aria-selected")) === "true",
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "The JDT LS definition command did not select the library declaration",
      },
    );
    const definitionHistory = await this.browser().execute(() => {
      try {
        const value = JSON.parse(
          document.body.getAttribute("data-java-definition-result-history") ?? "[]",
        );
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    });
    const refactorKitResult = definitionHistory.at(-1) as
      { status?: string; refusalCode?: string } | undefined;
    assert.equal(
      refactorKitResult?.status,
      "refused",
      "F12 did not record RefactorKit's semantic-analysis refusal before JDT LS fallback",
    );
    assert.equal(
      refactorKitResult?.refusalCode,
      "java.context.sourceAnalysisUnqualified",
      "F12 did not preserve RefactorKit's typed Java 27 source-analysis refusal",
    );
    this.#proof.java27F12RefactorKitResultStatus = refactorKitResult?.status ?? null;
    this.#proof.java27F12DefinitionFallbackAfterRefusal = true;
    await this.surface().assertBuffer(file, original);
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[data-testid="editor-cursor-position"]').getText()).trim() ===
        `Ln ${line}, Col ${column + 1}`,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "JDT LS opened the declaration without navigating to its method name",
      },
    );
    assert.equal(await readFile(this.file(file), "utf8"), original);
    assert.equal(await readFile(this.file(sourcePath), "utf8"), this.originalSource(sourcePath));
    await this.assertInputs();
    if (!gradle) {
      assert.deepEqual(await this.mavenFilesChangedFromBaseline(), []);
      const appTarget = this.file("maven/app/target");
      let generatedTargetFiles: string[] = [];
      try {
        generatedTargetFiles = [...(await this.fileManifest(appTarget)).keys()].sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      assert.deepEqual(
        generatedTargetFiles,
        [],
        `JDT LS generated Maven build output files: ${generatedTargetFiles.join(", ")}`,
      );
    }
    this.#proof.java27JdtlsDefinitionOpened = true;
  }
  async assertJava27JdtlsTypeDefinition() {
    const source = this.originalSource(SOURCE);
    const positionReceiver = async () => {
      const caller = this.surface().tab(SOURCE);
      await caller.click();
      await this.surface().focus(SOURCE);
      await this.browser().keys(["Control", "Home"]);
      const offset = source.indexOf("receiver.toString()") + 1;
      assert.ok(offset > 0);
      const prefix = source.slice(0, offset).split("\n");
      for (let line = 1; line < prefix.length; line++) await this.browser().keys("ArrowDown");
      try {
        await this.browser().performActions([{
          type: "key",
          id: "java27-jdtls-type-definition-caret",
          actions: textKeySequence("\uE014".repeat(prefix.at(-1)!.length)),
        }]);
      } finally {
        await this.browser().releaseActions();
      }
    };
    await positionReceiver();
    await this.browser().keys(["Shift", "F10"]);
    const item = "Go to Type Definition";
    await this.browser().waitUntil(async () => Boolean(await this.surface().contextMenuItem(item)), {
      timeout: 10_000,
      timeoutMsg: "The Java 27 editor did not offer Go to Type Definition",
    });
    const point = await this.surface().contextMenuItem(item);
    assert.ok(point);
    try {
      await this.browser().action("pointer").move({ ...point, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
    } finally {
      await this.browser().releaseActions();
    }
    const destination = "maven/library/src/main/java/fixtures/library/GreetingService.java";
    await this.surface().tab(destination).waitForDisplayed({ timeout: 15_000 });
    await this.surface().assertBuffer(destination, this.originalSource(destination));
    const declaration = this.originalSource(destination).split("\n").findIndex((line) => line.includes("class GreetingService"));
    const column = this.originalSource(destination).split("\n")[declaration]!.indexOf("GreetingService") + 1;
    await this.browser().waitUntil(async () =>
      (await this.browser().$('[data-testid="editor-cursor-position"]').getText()).trim() === `Ln ${declaration + 1}, Col ${column}`,
    { timeout: 10_000, interval: 50 });
    await positionReceiver();
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const definition = this.browser().$("button=JDT LS definition");
    await definition.waitForEnabled({ timeout: 10_000 });
    await definition.click();
    await this.browser().$(
      `[aria-label="JDT LS definitions"] button[aria-label^="Open JDT LS definition in ${SOURCE}"]`,
    ).waitForDisplayed({ timeout: 10_000 });
    const query = this.browser().$("button=JDT LS type definition");
    const target = this.browser().$(
      `[aria-label="JDT LS type definitions"] button[aria-label^="Open JDT LS type definition in ${destination}"]`,
    );
    await query.waitForEnabled({ timeout: 10_000 });
    await query.click();
    await target.waitForDisplayed({ timeout: 10_000 });
    await this.surface().focus(SOURCE);
    await this.browser().keys("ArrowRight");
    await target.waitForExist({ reverse: true, timeout: 10_000 });
    await positionReceiver();
    await query.click();
    await target.waitForDisplayed({ timeout: 10_000 });
    await target.click();
    await this.browser().waitUntil(async () =>
      (await this.surface().tab(destination).getAttribute("aria-selected")) === "true",
    { timeout: 10_000, interval: 50 });
    this.#proof.java27JdtlsTypePanelRetiredAndOpened = true;
    await this.assertInputs();
  }

  async closeJava27ReferenceDeclarationTab() {
    assert.equal(this.#proof.java27JdtlsDefinitionOpened, true);
    const path = "maven/library/src/main/java/fixtures/library/BaseGreeting.java";
    await this.surface().assertBuffer(path, this.originalSource(path));
    await this.surface().tab(path).$(`button[aria-label="Close ${path}"]`).click();
    await this.surface().tab(path).waitForExist({ reverse: true, timeout: 5_000 });
    this.#proof.java27ReferenceDeclarationTabClosed = true;
  }
  async navigateJava27ReferencesWithJdtLs() {
    assert.equal(this.#proof.java27JdtlsDefinitionOpened, true);
    const gradle = this.#executionTool === "gradle";
    const sourcePath = gradle ? "gradle/app/src/main/java/pkg/Runner.java" : SOURCE;
    const source = this.originalSource(sourcePath);
    const offset = source.indexOf("message(2)");
    assert.notEqual(offset, -1, "The Java 27 caller fixture has no inherited integer call.");
    const line = source.slice(0, offset).split("\n").length;
    const lineText = source.split("\n")[line - 1];
    assert.ok(lineText);
    const column = Array.from(lineText.slice(0, lineText.indexOf("message(2)"))).length;
    const tab = this.surface().tab(sourcePath);
    await tab.waitForDisplayed({ timeout: 10_000 });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await this.surface().focus(sourcePath);
    await this.browser().keys(["Control", "Home"]);
    for (let index = 1; index < line; index++) await this.browser().keys("ArrowDown");
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "java27-jdtls-references-caret",
          actions: textKeySequence("\uE014".repeat(column)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[data-testid="editor-cursor-position"]').getText()).trim() ===
        `Ln ${line}, Col ${column + 1}`,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "The editor did not place the caret on the Java 27 inherited call",
      },
    );
    assert.equal(
      await this.browser()
        .$(`[role="textbox"][aria-label^="Code editor for ${sourcePath}"]`)
        .isFocused(),
      true,
    );
    await this.browser().keys(["Shift", "F12"]);
  }
  async assertJava27JdtLsReferences() {
    const gradle = this.#executionTool === "gradle";
    const sourcePath = gradle ? "gradle/app/src/main/java/pkg/Runner.java" : SOURCE;
    const source = this.originalSource(sourcePath);
    const offset = source.indexOf("message(2)");
    assert.notEqual(offset, -1, "The Java 27 caller fixture has no inherited integer call.");
    const line = source.slice(0, offset).split("\n").length;
    const lineText = source.split("\n")[line - 1]!;
    const column = Array.from(lineText.slice(0, lineText.indexOf("message(2)"))).length;
    const referenceFile = gradle
      ? "gradle/library/src/main/java/fixtures/library/BaseGreeting.java"
      : "maven/library/src/main/java/fixtures/library/BaseGreeting.java";
    const declaration = this.#inputs.get(referenceFile);
    assert.ok(declaration, `The Java 27 reference fixture did not capture ${referenceFile}`);
    const widget = this.browser().$(".reference-zone-widget");
    await widget.waitForDisplayed({ timeout: 20_000 });
    await this.browser().waitUntil(
      () =>
        this.browser().execute(() => {
          const value = document.body.getAttribute("data-java-reference-result-history") ?? "[]";
          let history: unknown[] = [];
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) history = parsed;
          } catch {
            history = [];
          }
          const latest = history.at(-1) as { status?: string; refusalCode?: string } | undefined;
          const files = Array.from(
            document.querySelectorAll('.reference-zone-widget [role="treeitem"][aria-expanded]'),
          ).map((file) => file.getAttribute("aria-label"));
          return (
            latest?.status === "refused" &&
            latest.refusalCode === "java.context.sourceAnalysisUnqualified" &&
            files.some((file) => file?.includes("BaseGreeting.java")) &&
            files.some((file) => file?.includes("Runner.java"))
          );
        }),
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg:
          "Shift+F12 did not present Java 27 JDT LS references after RefactorKit's typed refusal",
      },
    );
    const history = await this.browser().execute(() => {
      try {
        const value = JSON.parse(
          document.body.getAttribute("data-java-reference-result-history") ?? "[]",
        );
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    });
    const result = history.at(-1) as { status?: string } | undefined;
    this.#proof.java27ShiftF12RefactorKitResultStatus = result?.status ?? null;
    const preview = widget.$(".preview .monaco-editor");
    const input = preview.$("textarea");
    await input.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await input.getAttribute("readonly"), "true");
    assert.ok((await preview.$(".view-lines").getText()).includes("message"));
    if (this.#proof.java27ReferenceDeclarationTabClosed) {
      const declarationGroup = widget.$(
        '[role="treeitem"][aria-label*="BaseGreeting.java"][aria-expanded]',
      );
      if ((await declarationGroup.getAttribute("aria-expanded")) === "false") {
        await declarationGroup.click();
      }
      const declarationRow = widget.$(
        '[role="treeitem"][aria-label*="BaseGreeting.java"]:not([aria-expanded])',
      );
      await declarationRow.waitForDisplayed({ timeout: 5_000 });
      await declarationRow.click();
      await this.browser().waitUntil(
        async () => (await preview.$(".view-lines").getText()).includes("message(int"),
        {
          timeout: 5_000,
          timeoutMsg: "The closed declaration preview did not show its actual source",
        },
      );
      assert.equal(await input.getAttribute("readonly"), "true");
      assert.equal(await this.surface().tab(referenceFile).isExisting(), false);
      this.#proof.java27ClosedSourceReferencePreviewVerified = true;
    }
    const file = widget.$('[role="treeitem"][aria-label*="Runner.java"][aria-expanded]');
    if ((await file.getAttribute("aria-expanded")) === "false") await file.click();
    const row = widget.$(
      `[role="treeitem"][aria-label*="Runner.java"][aria-label*="on line ${line}"]`,
    );
    await row.waitForDisplayed({ timeout: 5_000 });
    await row.doubleClick();
    await this.browser().waitUntil(
      async () => (await this.surface().tab(sourcePath).getAttribute("aria-selected")) === "true",
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "Opening the reference did not return to the exact Java 27 caller",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await this.browser().$('[data-testid="editor-cursor-position"]').getText()).trim() ===
        `Ln ${line}, Col ${column + 1}`,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "JDT LS references did not reveal the exact Java 27 call-site range",
      },
    );
    await this.surface().assertDirty(sourcePath, false);
    assert.ok((await this.surface().renderedText({ file: sourcePath })).split("\n").includes(lineText));
    if (this.#proof.java27ReferenceDeclarationTabClosed) {
      assert.equal(await this.surface().tab(referenceFile).isExisting(), false);
    } else {
      await this.surface().tab(referenceFile).click();
      await this.surface().focus(referenceFile);
      await this.browser().keys(["Control", "Home"]);
      await this.surface().assertBuffer(referenceFile, declaration);
      await this.surface().tab(sourcePath).click();
    }
    assert.equal(await readFile(this.file(sourcePath), "utf8"), source);
    assert.equal(await readFile(this.file(referenceFile), "utf8"), declaration);
    await this.assertInputs();
    this.#proof.java27JdtlsReferencesOpened = true;
  }
  async ctrlClickJava27MavenDefinition() {
    assert.equal(this.#executionTool, "maven");
    assert.equal(this.#proof.java27JdtlsReferencesOpened, true);
    await this.surface().focus(SOURCE);
    await this.browser().keys("Escape");
    this.#proof.java27CtrlClickPreviousRequestId = await this.browser().execute(() => {
      const history = JSON.parse(
        document.body.getAttribute("data-java-definition-result-history") ?? "[]",
      );
      return history.at(-1)?.requestId ?? null;
    });
    const point = await this.browser().execute((filePath) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((item) => item.getAttribute("aria-label") === `Code editor for ${filePath}`);
      const editor = input?.closest(".monaco-code-editor-host")?.querySelector(".monaco-editor");
      const line = Array.from(editor?.querySelectorAll(".view-line") ?? []).find(
        (item) => item.textContent?.includes("return") && item.textContent.includes("message"),
      );
      if (!editor || !line) throw new Error("The Java 27 inherited call is not visible.");
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const start = (node.textContent ?? "").indexOf("message");
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + "message".length);
        const bounds = range.getBoundingClientRect();
        if (!bounds.width || !bounds.height) continue;
        const x = Math.round(bounds.left + bounds.width / 2);
        const y = Math.round(bounds.top + bounds.height / 2);
        if (!line.contains(document.elementFromPoint(x, y))) {
          throw new Error("The Java 27 method token is covered by another editor surface.");
        }
        document.body.removeAttribute("data-java27-ctrl-click-input");
        document.addEventListener(
          "mousedown",
          (event) => {
            const target = event.target;
            document.body.setAttribute(
              "data-java27-ctrl-click-input",
              JSON.stringify({
                ctrlKey: event.ctrlKey,
                insideSource: target instanceof Node && line.contains(target),
              }),
            );
          },
          { capture: true, once: true },
        );
        return { x, y };
      }
      throw new Error("The Java 27 method token has no visible text bounds.");
    }, SOURCE);
    try {
      await this.browser().performActions([
        {
          type: "pointer",
          id: "java27-definition-pointer",
          parameters: { pointerType: "mouse" },
          actions: [{ type: "pointerMove", origin: "viewport", ...point }],
        },
      ]);
      await this.browser().performActions([
        {
          type: "key",
          id: "java27-definition-modifier",
          actions: [{ type: "keyDown", value: "\uE009" }],
        },
      ]);
      await this.browser().performActions([
        {
          type: "pointer",
          id: "java27-definition-pointer",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
  }
  async assertJava27CtrlClickDefinition() {
    const input = (await this.browser().execute(() =>
      JSON.parse(document.body.getAttribute("data-java27-ctrl-click-input") ?? "null"),
    )) as { ctrlKey: boolean; insideSource: boolean } | null;
    assert.equal(input?.ctrlKey, true, "The native click did not carry Control.");
    assert.equal(input?.insideSource, true, "The native click missed the inherited source call.");
    this.#proof.java27CtrlClickInput = input;
    await this.assertJava27JdtLsDefinition();
    const requestId = await this.browser().execute(() => {
      const history = JSON.parse(
        document.body.getAttribute("data-java-definition-result-history") ?? "[]",
      );
      return history.at(-1)?.requestId ?? null;
    });
    assert.ok(requestId);
    assert.notEqual(requestId, this.#proof.java27CtrlClickPreviousRequestId);
    this.#proof.java27CtrlClickDefinitionOpened = true;
  }
  async refreshJava27GradleProjectContextAfterExecution() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    await this.synchronizeGradleForExecution();
  }
  async refreshJava27GradleContextAfterLanguageImport() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    await this.assertInputs();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeGradle(true);
    await this.evaluateGradle(false);
    this.#proof.java27ContextRefreshedAfterLanguageImport = true;
    await this.requestJava27DefinitionAtInheritedCall(
      "gradle/app/src/main/java/pkg/Runner.java",
      true,
    );
  }
  async qualifyJava27MavenExecution() {
    assert.equal(this.#executionTool, "maven");
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#proof.java27MetadataOnlyContext, true);
    await assert.rejects(access(this.file("maven/app/target/classes/pkg/Runner.class")), { code: "ENOENT" });
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    const compiled = await readFile(this.file("maven/app/target/classes/pkg/Runner.class"));
    assert.equal(compiled.readUInt32BE(0), 0xcafebabe);
    assert.equal(compiled.readUInt16BE(6), 71);

    await this.resynchronizeMavenAfterExecution();
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Run");
    await this.waitProjectExecution("run", "succeeded");
    const output = this.executionPanel().$('[aria-label="Java console output"]');
    assert.match(await output.getText(), /JAVA_27_CROSS_MODULE:7[\s\S]*JAVA_27_RUNTIME:27/u);

    await this.resynchronizeMavenAfterExecution();
    await this.configureSynchronizedExecution("test");
    const execution = this.executionPanel();
    await execution.$("button=Add test JVM option").click();
    await pasteNativeText(this.#app!, execution.$("label*=Test JVM option 1").$("textarea"),
      "-Djava27.gui.test=value with spaces");
    await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'),
      "pkg.RunnerTest#runsWithSelectedSdk");
    await this.requestProjectExecution("Run tests");
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    await access(this.file("maven/app/target/surefire-reports/TEST-pkg.RunnerTest.xml"));

    await this.resynchronizeMavenAfterExecution();
    await this.configureSynchronizedExecution("test");
    await this.requestProjectExecution("Run tests with coverage");
    await this.waitProjectExecution("coverage", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    const coverage = execution.$('[aria-label="Java test coverage"]');
    assert.match(await coverage.getText(), /JaCoCo: ready/u);
    const measuredSources = await coverage.$("label*=Measured source file").$("select").getText();
    assert.match(measuredSources, /pkg\/Runner\.java/u);
    const instructions = await coverage.$(".//dt[text()='Instructions']/following-sibling::dd").getText();
    const measured = /\((\d+) \/ (\d+)\)/u.exec(instructions);
    assert.ok(measured && Number(measured[1]) > 0, instructions);

    await this.resynchronizeMavenAfterExecution();
    await this.openWorkspaceSourceViaQuickOpen(SOURCE);
    await this.configureSynchronizedExecution();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    const line = this.originalSource(SOURCE).split("\n").findIndex((row) => row.includes('"JAVA_27_CROSS_MODULE:"')) + 1;
    assert.ok(line > 0);
    await this.clickProjectSourceBreakpoint(SOURCE, line);
    await this.resynchronizeMavenAfterExecution();
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Debug");
    await this.waitForProjectDebuggerStatus("suspended (entry)", 30_000);
    const debuggerPanel = execution.$('[aria-label="Structured Java debugger"]');
    await debuggerPanel.$("button=Continue").click();
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 30_000);
    const debuggerText = (await debuggerPanel.getText()).replaceAll("/", ".");
    assert.match(debuggerText, /pkg\.Runner\.main/u);
    assert.ok(debuggerText.includes(`pkg.Runner.java:${line}`), debuggerText);
    await debuggerPanel.$("button=Continue").click();
    await this.waitProjectExecution("debug", "succeeded");
    assert.match(await output.getText(), /JAVA_27_CROSS_MODULE:7[\s\S]*JAVA_27_RUNTIME:27/u);
    await this.resynchronizeMavenAfterExecution();
    await this.configureSynchronizedExecution();
    await this.setApplicationInput(true);
    await execution.$("button=Add JVM option").click();
    await pasteNativeText(this.#app!, execution.$("label=JVM option 1").$("textarea"), "-Djava27.gui.input=true");
    await this.requestProjectExecution("Run");
    await this.waitForApplicationInput();
    const input = this.applicationInputPanel();
    await pasteNativeText(this.#app!, input.$("textarea"), "café Java 27");
    await input.$("button=Send line").click();
    const expectedInput = Buffer.from("café Java 27\n", "utf8");
    await this.browser().waitUntil(async () => (await input.getText()).includes(`Bytes accepted: ${expectedInput.length}.`),
      { timeout: 10_000, interval: 100 });
    await input.$("button=Close input (EOF)").click();
    await this.waitProjectExecution("run", "succeeded");
    assert.ok((await output.getText()).includes(`JAVA_27_INPUT:${expectedInput.toString("base64")}`));
    this.#proof.java27MavenExecutionPassed = true;
    await this.assertInputs();
  }
  async startJava27GradleApplicationBuild() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Build");
  }
  async assertJava27GradleApplicationBuild() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    await this.waitProjectExecution("build", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("BUILD SUCCESSFUL"), output);
    assert.ok(output.includes(`PROJECT_COMPILER_JDK:${this.#gradleSdk}`), output);
    await access(this.file("gradle/app/build/classes/java/main/pkg/Runner.class"));
    await access(
      this.file(
        "gradle/app/build/generated/sources/annotationProcessor/java/main/generated/GeneratedGreeting.java",
      ),
    );
    this.#proof.java27GradleBuildTaskPassed = true;
  }
  async assertJava27GradleAnnotationProcessorContext() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#proof.java27GradleBuildTaskPassed, true);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const context = this.panel();
    const contextSelect = context.$("label=Module and source set").$("select");
    const options = await contextSelect.$$("option").getElements();
    const labels = await options.map((item) => item.getText());
    const appMain = labels.find((label) => label.startsWith("Gradle · app · main ("));
    assert.ok(appMain, `Gradle app main source set is missing: ${labels.join(", ")}`);
    await contextSelect.selectByVisibleText(appMain);
    let contextText = await context.getText();
    assert.ok(
      contextText.includes("gradle/app/build/generated/sources/annotationProcessor/java/main"),
      `The generated Gradle source root is missing after resynchronization: ${contextText}`,
    );
    await context.$("summary=Annotation processors (1)").click();
    contextText = await context.getText();
    assert.ok(contextText.includes("fixtures.processor.GreetingProcessor"), contextText);
    assert.ok(contextText.includes("Processor path"), contextText);
    assert.match(contextText, /processor[\\/]build[\\/]classes[\\/]java[\\/]main/u, contextText);
    this.#proof.java27GradleProcessorContextPresented = true;
    const root = "gradle/app/build/generated/sources/annotationProcessor/java/main";
    await this.openGeneratedJavaSourceFromProjectRoot(root, root);
  }
  async assertJava27GradleApplicationRun() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#proof.java27MetadataOnlyContext, true);
    await this.assertSynchronizedRun();
    this.#proof.java27GradleApplicationBuiltAndRan = true;
  }
  async assertJava27GradleProjectTests() {
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#proof.java27MetadataOnlyContext, true);
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(3, 3, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("BUILD SUCCESSFUL"), output);
    for (const method of TEST_METHODS) await this.assertTestProof(method, 1);
    await access(this.file("gradle/app/build/classes/java/test/pkg/RunnerTest.class"));
    this.#proof.java27GradleTestsPassed = true;
  }
  async qualifyJava27GradleCoverage() {
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#executionTool, "gradle");
    assert.equal(this.#proof.java27GradleTestsPassed, true);
    await this.synchronizeGradleForExecution(false);
    await this.configureSynchronizedExecution("test");
    await this.requestProjectExecution("Run tests with coverage");
    await this.waitProjectExecution("coverage", "succeeded", 60_000);
    await this.assertTestSummary(3, 3, 0);
    for (const method of TEST_METHODS) await this.assertTestProof(method, 2);

    const execution = this.executionPanel();
    const coverage = execution.$('[aria-label="Java test coverage"]');
    assert.match(await coverage.getText(), /JaCoCo: ready/u);
    const measuredSource = coverage.$("label*=Measured source file").$("select");
    const options = await measuredSource.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const runner = labels.find((label) => label.startsWith("pkg/Runner.java ·"));
    assert.ok(runner, "Gradle coverage must measure the selected application's source");
    await measuredSource.selectByVisibleText(runner);
    const instructions = await coverage.$$(".//dt[text()='Instructions']/following-sibling::dd").getElements();
    assert.ok(instructions.length >= 2);
    const sourceCounter = /\((\d+) \/ (\d+)\)/u.exec(await instructions[1]!.getText());
    assert.ok(sourceCounter && Number(sourceCounter[1]) > 0, "Gradle coverage must count executed Java 27 instructions");
    this.#proof.java27GradleCoveragePassed = true;
    await this.assertInputs();
  }

  async qualifyJava27GradleDebug() {
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#executionTool, "gradle");
    const execution = this.executionPanel();
    const source = "gradle/app/src/main/java/pkg/Runner.java";
    await this.openWorkspaceSourceViaQuickOpen(source);
    await this.synchronizeGradleForExecution(false);
    await this.configureSynchronizedExecution();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    const line = this.originalSource(source).split("\n").findIndex((row) => row.includes('"JAVA_REFERENCE_OK:"')) + 1;
    assert.ok(line > 0);
    await this.clickProjectSourceBreakpoint(source, line);
    await this.synchronizeGradleForExecution(false);
    await this.configureSynchronizedExecution();
    await this.requestProjectExecution("Debug");
    await this.waitForProjectDebuggerStatus("suspended (entry)", 30_000);
    const debuggerPanel = execution.$('[aria-label="Structured Java debugger"]');
    await debuggerPanel.$("button=Continue").click();
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 30_000);
    const debuggerText = (await debuggerPanel.getText()).replaceAll("/", ".");
    assert.match(debuggerText, /pkg\.Runner\.main/u);
    assert.ok(debuggerText.includes(`pkg.Runner.java:${line}`), debuggerText);
    await debuggerPanel.$("button=Continue").click();
    await this.waitProjectExecution("debug", "succeeded");
    const output = execution.$('[aria-label="Java console output"]');
    assert.match(await output.getText(), /JAVA_REFERENCE_OK:hello JVM\|count:2\|generated-greeting\|runtime-token\|main-peer\|base/u);
    assert.ok((await output.getText()).includes(`PROJECT_GUI_JDK:${this.#gradleSdk}`));
    this.#proof.java27GradleDebugPassed = true;
    await this.assertInputs();
  }
  async qualifyJava27FlightRecorder() {
    assert.equal(this.#javaRelease, 27);
    const maven = this.#executionTool === "maven";
    if (maven) await this.resynchronizeMavenAfterExecution();
    else await this.synchronizeGradleForExecution(false);
    await this.configureSynchronizedExecution();
    const execution = this.executionPanel();
    if (maven) {
      await execution.$('[aria-label="Remove JVM option 1"]').click();
      await this.setApplicationInput(false);
    }
    const priorSession = await execution.getAttribute("data-session-id");
    await this.requestProjectExecution("Run with JFR");
    await this.browser().waitUntil(async () => {
      const session = await execution.getAttribute("data-session-id");
      return Boolean(session && session !== priorSession);
    }, { timeout: 10_000, interval: 100, timeoutMsg: "Flight Recorder did not start a new Java Run session" });
    await this.waitProjectExecution("run", "succeeded");
    const consoleText = await execution.$('[aria-label="Java console output"]').getText();
    if (maven) assert.match(consoleText, /JAVA_27_CROSS_MODULE:7[\s\S]*JAVA_27_RUNTIME:27/u);
    else assert.ok(consoleText.includes(`PROJECT_GUI_JDK:${this.#gradleSdk}`), consoleText);
    const recording = this.file(await this.applicationDirectoryRecording());
    const bytes = await readFile(recording);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "FLR\0");

    await this.requestProjectExecution("Analyze recording");
    const summary = execution.$('table[aria-label="JFR event type summary"]');
    await summary.waitForDisplayed({ timeout: 15_000 });
    const inspect = summary.$('button[aria-label="Inspect timeline for jdk.JVMInformation"]');
    await inspect.waitForEnabled({ timeout: 5_000 });
    await inspect.click();
    const timeline = execution.$('table[aria-label="JFR events ordered by recorded timestamp"]');
    await timeline.waitForDisplayed({ timeout: 15_000 });
    await timeline.$("tbody tr summary").click();
    assert.match(await timeline.$(".//dt[text()='jvmVersion']/following-sibling::dd").getText(), /\b27\./u);
    assert.match(await timeline.$(".//dt[text()='javaArguments']/following-sibling::dd").getText(), /\bpkg\.Runner\b/u);
    assert.deepEqual(await readFile(recording), bytes);
    await this.assertInputs();
    this.#proof.java27FlightRecorderPassed = true;
  }
  async qualifyJava27TestDiscovery() {
    assert.equal(this.#javaRelease, 27);
    const maven = this.#executionTool === "maven";
    const methods = maven ? ["runsWithSelectedSdk", "verifiesCrossModuleValue"] : TEST_METHODS;
    const selectedMethod = maven ? "runsWithSelectedSdk" : TEST_METHODS[1];
    const selectedProof = this.file("maven/app/target/selected-test-proof.txt");
    const unselectedProof = this.file("maven/app/target/unselected-test-proof.txt");
    if (!maven) await this.synchronizeGradleForExecution(false);
    await this.startLanguageServiceWithSdk(this.executionSdk(), !maven);
    if (maven) await this.resynchronizeMavenAfterExecution();
    else await this.synchronizeGradleForExecution(false);
    await this.configureSynchronizedExecution("test");
    const execution = this.executionPanel();
    const selector = execution.$('input[placeholder="com.example.MainTest#computes"]');
    await selector.click();
    await this.browser().keys(["Control", "a"]);
    await this.browser().keys("Backspace");
    await this.requestProjectExecution("Discover tests");
    await this.waitProjectExecution("discover", "succeeded");
    const discovery = execution.$('[aria-label="Discovered Java tests"]');
    assert.match(await discovery.getText(), new RegExp(`Discovery: ready. 1 classes, ${methods.length} method-name groups`));
    for (const method of methods) {
      assert.equal(
        await discovery.$(`[aria-label="Run method group pkg.RunnerTest#${method}"]`).isEnabled(),
        true,
      );
    }
    const source = `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`;
    const text = this.originalSource(source);
    const line = text.split("\n").findIndex((row) => row.includes("class RunnerTest")) + 1;
    assert.ok(line > 0);
    const tab = this.surface().tab(source);
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    try {
      const open = discovery.$('[aria-label="Open test class pkg.RunnerTest"]');
      await open.waitForEnabled({ timeout: 5_000 });
      await open.scrollIntoView();
      await open.click();
      await this.browser().waitUntil(async () => (await tab.isExisting()) &&
        (await tab.getAttribute("aria-selected")) === "true" &&
        (await cursor.getText()).trim().startsWith(`Ln ${line}, Col `),
        { timeout: 20_000, interval: 100, timeoutMsg: `Discovery did not navigate to ${source}:${line}` },
      );
    } catch (cause) {
      throw new Error(`Discovered test source navigation failed: ${(await discovery.getText()).slice(-3000)}`, { cause });
    }
    await this.surface().assertDirty(source, false);
    assert.equal(await readFile(this.file(source), "utf8"), text);
    this.#proof.java27DiscoveredTestClassOpened = true;
    if (maven) {
      assert.equal(await readFile(selectedProof, "utf8"), "selected".repeat(2));
      await assert.rejects(access(unselectedProof), { code: "ENOENT" });
      await pasteNativeText(this.#app!, execution.$("label*=Test JVM option 1").$("textarea"), "-Djava27.gui.test=changed");
      await pasteNativeText(this.#app!, selector, "does.not.Exist#mustNotRun");
    } else {
      for (const method of TEST_METHODS) await this.assertTestProof(method, 2);
      await this.changeVisibleTestSettings();
    }
    const selected = discovery.$(`[aria-label="Run method group pkg.RunnerTest#${selectedMethod}"]`);
    await selected.scrollIntoView();
    await selected.click();
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    const results = execution.$('[aria-label="Java test results"]');
    assert.ok((await results.getText()).includes(selectedMethod));
    if (maven) {
      assert.equal(await readFile(selectedProof, "utf8"), "selected".repeat(3));
      await assert.rejects(access(unselectedProof), { code: "ENOENT" });
    } else {
      for (const method of TEST_METHODS) await this.assertTestProof(method, method === selectedMethod ? 3 : 2);
    }
    await this.assertInputs();
    this.#proof.java27TestDiscoveryPassed = true;
  }
  async qualifyJava27TestSourceNavigation() {
    assert.equal(this.#javaRelease, 27);
    assert.equal(this.#proof.java27TestDiscoveryPassed, true);
    const maven = this.#executionTool === "maven";
    const method = maven ? "runsWithSelectedSdk" : TEST_METHODS[1];
    const source = `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`;
    const text = this.originalSource(source);
    const lines = text.split("\n");
    const expected = maven ? "class RunnerTest" : `${method}(`;
    const line = lines.findIndex((row) => row.includes(expected)) + 1;
    assert.ok(line > 0);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const results = this.executionPanel().$('[aria-label="Java test results"]');
    const tab = this.surface().tab(source);
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    try {
      await results.$("label=Search reported tests").$("input").setValue(method);
      const test = results.$('.//details[button[starts-with(@aria-label,"Open source for pkg.RunnerTest test ")]]');
      const summary = test.$("summary");
      await summary.waitForDisplayed({ timeout: 10_000 });
      await summary.scrollIntoView();
      if (!(await test.getProperty("open"))) await summary.click();
      const open = test.$('[aria-label^="Open source for pkg.RunnerTest test "]');
      await open.waitForDisplayed({ timeout: 5_000 });
      assert.ok((await open.getAttribute("aria-label"))?.includes(method));
      await open.click();
      await this.browser().waitUntil(async () => (await tab.isExisting()) &&
        (await tab.getAttribute("aria-selected")) === "true" &&
        (await cursor.getText()).trim().startsWith(`Ln ${line}, Col `),
        { timeout: 20_000, interval: 100, timeoutMsg: `The report did not navigate to ${source}:${line}` },
      );
    } catch (cause) {
      throw new Error(`Test source navigation failed: ${(await results.getText()).slice(-3000)}`, { cause });
    }
    await this.surface().assertDirty(source, false);
    assert.equal(await readFile(this.file(source), "utf8"), text);
    this.#proof.java27TestSourceNavigationPassed = true;
  }
  private async assertSupportedJavaProjectContext(release: 26 | 27) {
    assert.equal(this.#javaRelease, release);
    const providerId =
      this.#executionTool === "maven" ? "maven-effective-v1" : "gradle-effective-v1";
    await this.waitForText(`${providerId} · available`);
    await this.chooseSourceSet("main");
    const panelText = await this.panel().getText();
    const sdkHome = this.executionSdk();
    assert.ok(panelText.includes(`${providerId} · available`), panelText);
    assert.ok(
      panelText.includes(`Java ${release} platform from JDK ${release}: ${sdkHome}`),
      panelText,
    );
    assert.ok(panelText.includes(`Source level: ${release}`), panelText);
    assert.ok(panelText.includes(`release ${release}`), panelText);
    await this.assertSupportedJavaProjectContextTrace(sdkHome, release);
    if (release === 27 && this.#proof.java27MetadataOnlyContext) {
      assert.ok(
        panelText.includes(
          "Project metadata is available for build, run and tests. Java source and symbol analysis is unavailable for this context.",
        ),
        panelText,
      );
      await this.openOwnership();
      await this.fill('input[placeholder="pkg/Runner.java"]', "pkg/Runner.java");
      await this.fill('input[placeholder="pkg.Runner"]', "pkg.Runner");
      assert.equal(await this.panel().$("button=Resolve source ownership").isEnabled(), false);
    }
    await this.assertInputs();
    if (this.#executionTool === "maven") {
      await assert.rejects(access(this.file("maven/app/target")), { code: "ENOENT" });
      if (release === 26) this.#proof.java26MavenContextAvailable = true;
      else this.#proof.java27MavenContextAvailable = true;
    } else {
      if (release === 26) this.#proof.java26GradleContextAvailable = true;
      else this.#proof.java27GradleContextAvailable = true;
    }
  }
  private async assertSupportedJavaProjectContextTrace(sdkHome: string, release: 26 | 27) {
    assert.ok(this.#lease);
    const providerId =
      this.#executionTool === "maven" ? "maven-effective-v1" : "gradle-effective-v1";
    const tracePath = path.join(
      this.#lease.runnerArtifactPath,
      "java-project-context-snapshot-trace.jsonl",
    );
    const trace = (await readFile(tracePath))
      .subarray(this.#contextTraceStart)
      .toString("utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; details: Record<string, unknown> });
    const rpcRequest = (method: string) => {
      const event = trace.find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.request" && entry.details.method === method,
      );
      assert.ok(event, `The IDE did not send RefactorKit ${method}`);
      return event;
    };
    const rpcResponse = (request: (typeof trace)[number]) => {
      const event = trace.slice(trace.indexOf(request) + 1).find(
        (entry) =>
          entry.event === "refactorkit.daemon.rpc.response" &&
          entry.details.method === request.details.method &&
          entry.details.requestId === request.details.requestId,
      );
      assert.ok(event, `RefactorKit did not answer ${String(request.details.method)}`);
      const response = event.details.response;
      assert.ok(typeof response === "object" && response !== null);
      const result = (response as Record<string, unknown>).result;
      assert.ok(typeof result === "object" && result !== null);
      return result as Record<string, unknown>;
    };
    const syncRequest = this.#executionTool === "gradle" ? rpcRequest("project.sync") : undefined;
    const v7ContextRequest = trace.find(
      (entry) =>
        entry.event === "refactorkit.daemon.rpc.request" &&
        entry.details.method === "project.context.v7" &&
        (entry.details.params as Record<string, unknown> | undefined)?.providerId === providerId,
    );
    const v6ContextRequest = trace.find(
      (entry) =>
        entry.event === "refactorkit.daemon.rpc.request" &&
        entry.details.method === "project.context.v6" &&
        (entry.details.params as Record<string, unknown> | undefined)?.providerId === providerId,
    );
    const contextRequest =
      v7ContextRequest ??
      v6ContextRequest ??
      rpcRequest(
        this.#executionTool === "gradle" ? "project.context.aggregate" : "project.context",
      );
    const usesV7Context = contextRequest.details.method === "project.context.v7";
    const usesV6Context = contextRequest.details.method === "project.context.v6";
    const usesV6OrV7Context = usesV6Context || usesV7Context;
    assert.equal(
      usesV7Context,
      true,
      `The Java ${release} candidate must qualify the v7 context path`,
    );
    const contextParams = contextRequest.details.params as Record<string, unknown>;
    const syncParams = syncRequest?.details.params as Record<string, unknown> | undefined;
    const openedSnapshotHash =
      syncParams?.expectedSnapshotHash ?? contextParams.expectedSnapshotHash;
    // Opening a project is an IDE-side snapshot operation, not a daemon RPC.
    const opened = trace.find(
      (entry) =>
        entry.event === "project.open" && entry.details.snapshotHash === openedSnapshotHash,
    );
    assert.ok(opened, "The IDE did not record the opened project snapshot for this build tool");
    assert.equal(typeof opened.details.snapshotHash, "string");
    let expectedSnapshot = opened.details.snapshotHash as string;
    if (this.#executionTool === "gradle") {
      assert.ok(syncRequest && syncParams);
      assert.equal(syncParams.buildSystem, "gradle");
      assert.equal(syncParams.sdkHome, sdkHome);
      assert.equal(syncParams.expectedSnapshotHash, expectedSnapshot);
      assert.equal(syncParams.allowBuildExecution, true);
      assert.equal(typeof syncParams.gradleExecutable, "string");
      assert.equal(path.isAbsolute(syncParams.gradleExecutable as string), true);
      assert.equal(syncParams.gradleRuntimeHome, this.#gradleRuntimeSdk || undefined);
      const synchronized = rpcResponse(syncRequest);
      assert.equal(synchronized.schemaVersion, "java-gradle-sync-v1");
      assert.equal(synchronized.status, "synchronized");
      assert.equal(synchronized.sdkHome, sdkHome);
      assert.equal(typeof synchronized.snapshotHash, "string");
      if (usesV6OrV7Context) {
        assert.equal(synchronized.gradleRuntimeHome, this.#gradleRuntimeSdk || sdkHome);
        if (this.#gradleRuntimeSdk) this.#proof.java27GradleRuntimeJdkAttested = true;
      }
      expectedSnapshot = synchronized.snapshotHash as string;
      if (release === 26) this.#proof.java26GradleSyncAttested = true;
      else this.#proof.java27GradleSyncAttested = true;
    }
    assert.equal(contextParams.sdkHome, sdkHome);
    assert.equal(contextParams.expectedSnapshotHash, expectedSnapshot);
    const context = rpcResponse(contextRequest);
    const contextResponse = trace.find(
      (entry) =>
        entry.event === "project.context.response" &&
        entry.details.method === contextRequest.details.method &&
        entry.details.observedSnapshotHash === expectedSnapshot &&
        entry.details.schemaVersion === context.schemaVersion &&
        entry.details.status === context.status,
    );
    assert.ok(contextResponse, "The IDE did not record the project-context response");
    const normalizedContext = trace.find(
      (entry) =>
        entry.event === "project.context.normalize" &&
        entry.details.requestId === contextResponse.details.requestId,
    );
    assert.ok(normalizedContext, "The IDE did not record normalized project-context evidence");
    assert.equal(normalizedContext.details.outcome, "accepted");
    const expectedContextSchema = usesV7Context
      ? "java-project-context-v7"
      : usesV6Context
        ? "java-project-context-v6"
        : this.#executionTool === "gradle"
          ? "java-project-context-v3"
          : "java-project-context-v2";
    assert.equal(context.schemaVersion, expectedContextSchema);
    assert.equal(context.status, "available");
    assert.equal(context.snapshotHash, expectedSnapshot);
    if (usesV6OrV7Context) {
      assert.equal(contextParams.providerId, providerId);
      assert.equal(typeof contextParams.moduleId, "string");
      assert.equal(typeof contextParams.sourceSetId, "string");
      assert.equal(contextParams.sourceRelativePath, undefined);
      assert.equal(context.selectedSource, null);
      if (release === 27) {
        assert.equal(context.analysis, null);
        assert.deepEqual(context.semanticAnalysis, {
          availability: "unqualified",
          refusalCode: "java.context.sourceAnalysisUnqualified",
        });
      } else {
        assert.equal((context.analysis as Record<string, unknown>)?.backend, "eclipse-jdt");
        assert.deepEqual(context.semanticAnalysis, { availability: "available", refusalCode: null });
      }
      if (usesV7Context) {
        assert.ok(Array.isArray(context.modules) && context.modules.length > 0);
        const sourceSets = (context.modules as Array<Record<string, unknown>>).flatMap((module) =>
          Array.isArray(module.sourceSets)
            ? (module.sourceSets as Array<Record<string, unknown>>)
            : [],
        );
        assert.ok(sourceSets.length > 0, "The v7 context did not include any source sets");
        for (const sourceSet of sourceSets) {
          const testJvm = sourceSet.mavenTestJvm;
          assert.ok(typeof testJvm === "object" && testJvm !== null);
          assert.ok(Array.isArray((testJvm as Record<string, unknown>).executions));
        }
      }
      if (release === 27) {
        this.#proof.java27MetadataOnlyContext = true;
        this.#proof.java27SourceAnalysisUnqualified = true;
      }
    }
    const actualDaemonHash = createHash("sha256")
      .update(await readFile(this.#proof.daemon))
      .digest("hex");
    assert.equal(contextRequest.details.daemonSha256, actualDaemonHash);
    if (release === 26) {
      this.#proof.java26ContextDaemonSha256 = actualDaemonHash;
      this.#proof.java26ContextSdkAndSnapshotAttested = true;
    } else {
      this.#proof.java27ContextDaemonSha256 = actualDaemonHash;
      this.#proof.java27ContextSdkAndSnapshotAttested = true;
    }
  }
  async synchronizeMavenForModuleOperations() {
    await this.requestMavenSynchronization();
    await this.panel()
      .$(".//p[normalize-space(.) = 'maven-effective-v1 · available']")
      .waitForExist({
        timeout: 45_000,
        interval: 100,
        timeoutMsg: "Java project panel did not show the available Maven provider",
      });
    this.#mavenManifestAtSync = await this.fileManifest(this.file("maven"));
  }
  private async mavenRecoverySourceManifest() {
    const files = await this.fileManifest(this.file("maven"));
    return new Map([...files].filter(([relative]) => !relative.startsWith(".refactorkit/")));
  }
  async interruptSavedMavenModuleRename() {
    for (let index = 0; index < 512; index++) {
      const type = `RecoveryProbe${String(index).padStart(3, "0")}`;
      const relative = `maven/app/src/main/java/pkg/${type}.java`;
      const content = `package pkg;\npublic final class ${type} {}\n`;
      await writeFile(this.file(relative), content, { flag: "wx" });
      this.#inputs.set(relative, content);
    }
    const before = await this.mavenRecoverySourceManifest();
    const { stdout } = await promisify(execFile)(
      "/usr/bin/python3",
      [path.resolve("tests/story/support/interrupt-maven-module-rename.py"), this.#proof.daemon, this.file("maven")],
      { timeout: 230_000 },
    );
    const { journal, firstMoved } = JSON.parse(stdout) as { journal: string; firstMoved: string };
    assert.match(journal, /^\.refactorkit\/transactions\/[a-z0-9-]+\.json$/u);
    assert.match(firstMoved, /^app-preview\/src\/main\/java\/pkg\/RecoveryProbe000\.java$/u);
    const partial = await this.mavenRecoverySourceManifest();
    assert.notDeepEqual(partial, before);
    assert.ok(partial.has(firstMoved));
    this.#interruptedMavenRename = { before, partial, journal, firstMoved };
  }
  async recoverInterruptedSavedMavenModuleRename() {
    const interrupted = this.#interruptedMavenRename;
    assert.ok(interrupted);
    const panel = this.panel();
    await this.requestMavenSynchronization();
    const review = panel.$("button=Review saved-file recovery");
    await review.waitForClickable({ timeout: 45_000 });
    assert.match(await panel.$('[role="alert"]').getText(), /interrupted RefactorKit change to saved files/u);
    await review.click();
    await panel.$("button=Cancel recovery").click();
    assert.deepEqual(await this.mavenRecoverySourceManifest(), interrupted.partial);

    const libraryFile = "maven/library/src/main/java/pkg/Library.java";
    const librarySource = this.originalSource(libraryFile);
    const libraryDraft = `// keep this open draft\n${librarySource}`;
    await this.openRefactoringSourceFromExplorer(libraryFile, librarySource);
    await this.startLanguageServiceWithSdk(this.#sdk);
    await pasteNativeText(
      this.#app!,
      this.browser().$('[role="textbox"][aria-label^="Code editor for maven/library/src/main/java/pkg/Library.java"]'),
      libraryDraft,
      { focus: () => this.surface().focus(libraryFile) },
    );
    await this.surface().assertBuffer(libraryFile, libraryDraft, this.completeEditorReadBack());
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await review.click();
    await panel.$("button=Recover saved files").click();
    await this.waitForText("Save all editor buffers and wait for file operations before refactoring.", 15_000);
    assert.deepEqual(await this.mavenRecoverySourceManifest(), interrupted.partial);
    await this.surface().assertBuffer(libraryFile, libraryDraft, this.completeEditorReadBack());
    await this.surface().assertDirty(libraryFile, true);
    await this.surface().discardUsingDisk(libraryFile, librarySource);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();

    const movedFile = this.file(`maven/${interrupted.firstMoved}`);
    const movedBytes = await readFile(movedFile, "utf8");
    const externalEdit = `${movedBytes}// independent edit during recovery\n`;
    await writeFile(movedFile, externalEdit);
    const conflicting = await this.mavenRecoverySourceManifest();
    const tracePath = process.env.IDE_JAVA_CONTEXT_TRACE_PATH;
    const recoveryTraceStart = tracePath ? (await lstat(tracePath)).size : 0;
    await review.click();
    await panel.$("button=Recover saved files").click();
    await this.waitForText("RefactorKit could not safely complete recovery.", 60_000);
    if (tracePath) {
      const trace = (await readFile(tracePath)).subarray(recoveryTraceStart).toString("utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      const stop = trace.findIndex(({ event, details }) =>
        event === "native.application.lifecycle" && details.stage === "stop-after-join-threads");
      const recover = trace.findIndex(({ event, details }) =>
        event === "refactorkit.daemon.rpc.request" && details.method === "patch.recover");
      assert.ok(stop >= 0 && recover > stop, "JDT LS must exit before saved-file recovery starts");
    }
    assert.deepEqual(await this.mavenRecoverySourceManifest(), conflicting);
    assert.equal(await readFile(movedFile, "utf8"), externalEdit);
    const journalPath = this.file(`maven/${interrupted.journal}`);
    const readRecoveryState = async () => {
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as { state: string; failure?: unknown };
      return { state: journal.state, failure: journal.failure ?? null };
    };
    const conflictState = await readRecoveryState();
    assert.equal(conflictState.state, "RECOVERY_REQUIRED");
    await writeFile(movedFile, movedBytes);
    // Java tooling may create its output directories even when compilation never ran.
    for (const relative of ["app-preview/target/classes", "app-preview/target/test-classes"]) {
      const directory = this.file(`maven/${relative}`);
      await mkdir(directory, { recursive: true });
      assert.deepEqual(await readdir(directory), []);
    }
    assert.deepEqual(await this.mavenRecoverySourceManifest(), interrupted.partial);

    const unrelatedOutput = this.file("maven/app-preview/target/classes/external-output.txt");
    await writeFile(unrelatedOutput, "Output produced after the interruption\n");
    const withUnrelatedOutput = await this.mavenRecoverySourceManifest();
    await review.waitForClickable({ timeout: 15_000 });
    await review.click();
    await panel.$("button=Recover saved files").click();
    await this.browser().waitUntil(async () => {
      const state = await readRecoveryState();
      return state.state === "RECOVERY_REQUIRED" && state.failure !== conflictState.failure;
    }, { timeout: 60_000, interval: 100, timeoutMsg: "Recovery did not record the conflict with the nonempty output directory" });
    await this.waitForText("RefactorKit could not safely complete recovery.");
    assert.deepEqual(await this.mavenRecoverySourceManifest(), withUnrelatedOutput);
    const outputConflict = await readRecoveryState();
    await unlink(unrelatedOutput);

    await review.waitForClickable({ timeout: 15_000 });
    await review.click();
    await panel.$("button=Recover saved files").click();
    try {
      await this.waitForText("Saved-file recovery completed. Synchronize the project again.", 90_000);
    } finally {
      const retry = await readRecoveryState();
      await writeFile(
        path.join(this.#lease!.runnerArtifactPath, "maven-interrupted-recovery-states.json"),
        JSON.stringify({ conflict: conflictState, outputConflict, retry }, null, 2),
      );
    }
    assert.deepEqual(await this.mavenRecoverySourceManifest(), interrupted.before);
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    assert.equal(journal.state, "ROLLED_BACK");
    await assert.rejects(access(this.file(`maven/${interrupted.firstMoved}`)), { code: "ENOENT" });
    await assert.rejects(access(this.file("maven/app-preview")), { code: "ENOENT" });
    await this.surface().assertBuffer(libraryFile, librarySource, this.completeEditorReadBack());
    await this.surface().assertDirty(libraryFile, false);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const lifecycle = this.languagePanel().$('[role="status"][aria-label="Eclipse JDT LS lifecycle status"]');
    await this.browser().waitUntil(async () => (await lifecycle.getText()).trim().toLowerCase() === "ready",
      { timeout: 60_000, interval: 100, timeoutMsg: "JDT LS did not resume after successful saved-file recovery" });
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeMavenForModuleOperations();
    this.#proof.mavenSavedSourceRecoveryRestoredAndSynchronized = true;
  }
  async assertSavedMavenRecovery() {
    assert.equal(this.#proof.mavenSavedSourceRecoveryRestoredAndSynchronized, true);
    await this.assertInputs();
  }
  async synchronizeUnsupportedReleaseMavenExpectingRefusal(release: 26 | 27) {
    await this.requestMavenSynchronization();
    const alert = this.browser().$('[role="alert"]');
    await alert.waitForDisplayed({
      timeout: 20_000,
      interval: 100,
      timeoutMsg: `RefactorKit did not report why Java ${release} project context is unavailable`,
    });
    this.#proof.mavenUnsupportedReleaseRefusalMessage = (await alert.getText()).trim();
  }
  async assertUnsupportedReleaseMavenContextRefusedWithoutBuildOutput(release: 26 | 27) {
    assert.equal(this.#mavenUnsupportedRelease, release);
    const message = this.#proof.mavenUnsupportedReleaseRefusalMessage;
    assert.ok(message, "The native UI did not retain the RefactorKit refusal message");
    assert.match(
      message,
      new RegExp(`(?:Java release|Java source level) ['"]${release}['"]`, "iu"),
      message,
    );
    assert.match(
      message,
      /outside\b.*(?:supported Java 8-25 range|parser\/compiler range 8-25)/iu,
      message,
    );
    const panelText = await this.panel().getText();
    assert.ok(!panelText.includes("maven-effective-v1 · available"), panelText);
    assert.ok(!panelText.includes("Effective project context"), panelText);
    assert.deepEqual(
      await this.fileManifest(this.file("maven")),
      this.#mavenManifestBeforeSync,
      `Java ${release} context synchronization changed Maven project inputs`,
    );
    await assert.rejects(access(this.file("maven/app/target")), { code: "ENOENT" });
    this.#proof.mavenUnsupportedReleaseRefusedByProvider = true;
    this.#proof.mavenUnsupportedReleaseProjectInputsUnchanged = true;
  }
  async assertMavenModuleRenameAvailableFromProvider() {
    const panel = this.panel();
    assert.deepEqual(await readdir(this.file("maven/app/target/classes")), []);
    assert.deepEqual(await readdir(this.file("maven/app/target/test-classes")), []);
    const review = panel.$("button=Review Maven module rename");
    await review.waitForDisplayed({ timeout: 10_000 });
    assert.equal(await review.isEnabled(), true);
  }
  async verifyJavaTypePackagePrefillFromMavenSourceRoot() {
    const directory = "maven/app/src/main/java/pkg";
    assert.ok((await this.panel().getText()).includes("maven-effective-v1 · available"));
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    const parts = directory.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      const folder = this.browser().$(`[role="treeitem"][data-path="${folderPath}"]`);
      await folder.waitForDisplayed({ timeout: 5_000, interval: 50 });
      if ((await folder.getAttribute("aria-expanded")) !== "true") {
        await folder.scrollIntoView();
        await folder.click();
        await this.browser().waitUntil(
          async () => (await folder.getAttribute("aria-expanded")) === "true",
          {
            timeout: 5_000,
            interval: 50,
            timeoutMsg: `The native file explorer did not expand ${folderPath}`,
          },
        );
      }
    }
    const packageDirectory = this.browser().$(`[role="treeitem"][data-path="${directory}"]`);
    await packageDirectory.waitForDisplayed({ timeout: 5_000, interval: 50 });
    await packageDirectory.click({ button: "right" });
    const menu = this.browser().$('[role="menu"][aria-label="Actions for pkg"]');
    await menu.waitForDisplayed({ timeout: 5_000, interval: 50 });
    await menu.$('//button[normalize-space(.)="New Java Type…"]').click();
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await dialog.$("h2").getText(), "Create Java type");
    assert.equal(await dialog.$('[aria-label="Package name"]').getValue(), "pkg");
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000, interval: 50 });
    this.#proof.javaTypePackagePrefilledFromMavenSourceRoot = true;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
  }
  async createMavenModuleDescriptorFromSourceRoot() {
    const sourceRoot = "maven/library/src/main/java";
    const descriptor = `${sourceRoot}/module-info.java`;
    assert.ok((await this.panel().getText()).includes("maven-effective-v1 · available"));
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    const parts = sourceRoot.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      const folder = this.browser().$(`[role="treeitem"][data-path="${folderPath}"]`);
      await folder.waitForDisplayed({ timeout: 5_000, interval: 50 });
      if ((await folder.getAttribute("aria-expanded")) !== "true") {
        await folder.scrollIntoView();
        await folder.click();
        await this.browser().waitUntil(
          async () => (await folder.getAttribute("aria-expanded")) === "true",
          {
            timeout: 5_000,
            interval: 50,
            timeoutMsg: `The native file explorer did not expand ${folderPath}`,
          },
        );
      }
    }
    const sourceRootRow = this.browser().$(`[role="treeitem"][data-path="${sourceRoot}"]`);
    await sourceRootRow.waitForDisplayed({ timeout: 5_000, interval: 50 });
    await sourceRootRow.click({ button: "right" });
    const menu = this.browser().$('[role="menu"][aria-label="Actions for java"]');
    await menu.waitForDisplayed({ timeout: 5_000, interval: 50 });
    await menu.$('//button[normalize-space(.)="New Java Module Descriptor…"]').click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000, interval: 50 });
    assert.equal(await dialog.$("h2").getText(), "Create Java module descriptor");
    const moduleName = "ide.reference.library";
    const input = dialog.$('[aria-label="Module name"]');
    await pasteNativeText(this.#app!, input, moduleName);
    assert.equal(await input.getValue(), moduleName);
    await dialog.$("button=Create module descriptor").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000, interval: 50 });

    const expected = `module ${moduleName} {\n}\n`;
    await this.surface().assertBuffer(descriptor, expected);
    await this.surface().assertDirty(descriptor, true);
    assert.equal(await readFile(this.file(descriptor), "utf8"), "");
    await this.surface().tab(SOURCE).click();
    await this.assertDraft(SOURCE);
    this.#proof.mavenModuleDescriptorCreatedAsDraft = true;
    this.#moduleDescriptor = { path: descriptor, source: expected };
  }
  async assertMavenModuleDescriptorSavedAndCompiled() {
    const descriptor = this.#moduleDescriptor;
    assert.ok(descriptor, "The Maven module descriptor wizard did not create a draft");
    await this.surface().tab(descriptor.path).click();
    await this.surface().save(descriptor.path);
    await this.surface().assertDirty(descriptor.path, false);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(descriptor.path), "utf8")) === descriptor.source,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "Saving the module descriptor did not persist its exact editor contents",
      },
    );

    const buildRoot = this.file("maven/.module-descriptor-verification");
    const classes = path.join(buildRoot, "classes");
    await mkdir(classes, { recursive: true });
    await promisify(execFile)(
      path.join(this.#sdk, "bin", "javac"),
      [
        "--release",
        "17",
        "-d",
        classes,
        this.file(descriptor.path),
        this.file("maven/library/src/main/java/fixtures/library/BaseGreeting.java"),
        this.file("maven/library/src/main/java/fixtures/library/GreetingService.java"),
      ],
      { env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 20_000 },
    );
    for (const output of [
      "module-info.class",
      "fixtures/library/BaseGreeting.class",
      "fixtures/library/GreetingService.class",
    ])
      await access(path.join(classes, output));
    await rm(buildRoot, { recursive: true, force: true });
    this.#inputs.set(descriptor.path, descriptor.source);
    this.#proof.mavenModuleDescriptorSavedAndCompiled = true;
  }
  async previewMavenModuleRename({ retryDestination = false } = {}) {
    await this.panel().$("button=Review Maven module rename").click();
    const dialog = this.browser().$('[role="dialog"][aria-label="Maven module rename preview"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await dialog.$("select").selectByVisibleText("app · app");
    const inputs = await dialog.$$("input");
    assert.equal(inputs.length, 2);
    const plan = dialog.$('[aria-label="Reviewed Maven module rename plan"]');
    const refusal = dialog.$('[role="alert"]');
    let firstRefusal: string | null = null;
    if (retryDestination) {
      await inputs[0]!.setValue("library");
      await dialog.$("button=Preview rename").click();
      await refusal.waitForDisplayed({ timeout: 20_000 });
      firstRefusal = await refusal.getText();
      assert.match(firstRefusal, /Choose an unused module directory/u);
      assert.equal(await plan.isExisting(), false);
      assert.equal(await dialog.$("button=Apply reviewed rename").isExisting(), false);
      assert.deepEqual(await this.mavenFilesChangedFromBaseline(), []);
      await this.surface().assertDirty(SOURCE, true);
    }
    await inputs[0]!.setValue("app-preview");
    await inputs[1]!.setValue("app-preview");
    await dialog.$("button=Preview rename").click();
    await this.browser().waitUntil(async () =>
      await plan.isExisting() || (await refusal.isExisting() && await refusal.getText() !== firstRefusal), {
      timeout: 20_000,
      interval: 100,
      timeoutMsg: "RefactorKit did not render the Maven module rename diff",
    });
    if (await refusal.isExisting()) throw new Error(await refusal.getText());
    assert.match(await plan.$("pre").getText(), /app-preview/u);
    await assert.rejects(access(this.file("maven/app-preview")), {
      code: "ENOENT",
    });
    if (retryDestination) this.#proof.mavenModuleRenameDestinationRetried = true;
  }
  async assertMavenModuleRenamePreview() {
    const dialog = this.browser().$('[role="dialog"][aria-label="Maven module rename preview"]');
    const plan = dialog.$('[aria-label="Reviewed Maven module rename plan"]');
    assert.ok((await plan.getText()).includes("pom.xml"));
    const diff = await plan.$("pre").getText();
    assert.ok(diff.includes("app-preview"), diff);
    await dialog.$("button=Apply reviewed rename").click();
    await this.surface().assertAlert(
      "Save all editor buffers and wait for file operations before refactoring.",
    );
    await dialog.$("button=Close and discard preview").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    assert.deepEqual(await this.mavenFilesChangedFromBaseline(), []);
    await assert.rejects(access(this.file("maven/app-preview")), { code: "ENOENT" });
    await this.assertDraft();
    await this.assertInputs();
  }
  async relocateMavenModule() {
    const destination = "components/library";
    const project = this.file("maven");
    const originalSourcePath = "maven/library/src/main/java/pkg/Library.java";
    const relocatedSourcePath = `maven/${destination}/src/main/java/pkg/Library.java`;
    await mkdir(this.file("maven/components"));
    await mkdir(this.file("maven/library/src/main/resources/empty"), { recursive: true });
    await mkdir(this.file("maven/library/target/classes"), { recursive: true });
    await mkdir(this.file("maven/library/target/test-classes"), { recursive: true });
    const runner = this.originalSource(SOURCE).replace('"rename-preview"', "new Library().value()");
    await writeFile(this.file(SOURCE), runner);
    this.#inputs.set(SOURCE, runner);
    const verifyApplication = async (libraryDir: string) => {
      const copy = await mkdtemp(path.join(this.#lease!.paths.root, "maven-relocation-verify-"));
      try {
        await cp(project, copy, { recursive: true, filter: (source) => path.basename(source) !== ".refactorkit" });
        const env = { ...process.env, JAVA_HOME: this.#sdk };
        const verification = await promisify(execFile)(
          process.env.IDE_JAVA_CONTEXT_TEST_MAVEN ?? "mvn",
          ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
          { cwd: copy, env, timeout: 60_000 },
        );
        assert.match(verification.stdout, /BUILD SUCCESS/u);
        const output = await promisify(execFile)(path.join(this.#sdk, "bin/java"), [
          "-cp", [path.join(copy, "app/target/classes"), path.join(copy, libraryDir, "target/classes")].join(path.delimiter),
          "pkg.Runner",
        ], { cwd: copy, env, timeout: 10_000 });
        assert.equal(output.stdout.trim(), "library");
      } finally {
        await rm(copy, { recursive: true, force: true });
      }
    };
    await verifyApplication("library");
    await this.launchForProjectContext();
    await this.synchronizeMaven();
    await this.openWorkspaceSourceViaQuickOpen(originalSourcePath);
    await this.startLanguageServiceWithSdk(this.#sdk);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeMaven();
    const assertLanguageServiceResumed = async () => {
      await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
      const state = this.languagePanel().$('[role="status"][aria-label="Eclipse JDT LS lifecycle status"]');
      await this.browser().waitUntil(async () => (await state.getText()).trim().toLowerCase() === "ready",
        { timeout: 60_000, interval: 100, timeoutMsg: "JDT LS did not resume after the Maven module change" });
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    };
    const originalFiles = await this.fileManifest(project);
    const originalDirectories = await this.directoryManifest(project);
    await this.panel().$("button=Review Maven module rename").click();
    const dialog = this.browser().$('[role="dialog"][aria-label="Maven module rename preview"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    assert.match(await dialog.getText(), /For a nested move, use an existing parent directory/u);
    await dialog.$("select").selectByVisibleText("library · library");
    const inputs = await dialog.$$("input");
    await inputs[0]!.setValue(destination);
    assert.equal(await inputs[1]!.getValue(), "");
    await dialog.$("button=Preview rename").click();
    const plan = dialog.$('[aria-label="Reviewed Maven module rename plan"]');
    const refusal = dialog.$('[role="alert"]');
    await this.browser().waitUntil(async () => await plan.isExisting() || await refusal.isExisting(),
      { timeout: 30_000, interval: 100 });
    if (await refusal.isExisting()) throw new Error(await refusal.getText());
    assert.match(await plan.$("pre").getText(), /components\/library/u);
    assert.deepEqual(await this.fileManifest(project), originalFiles);
    assert.deepEqual(await this.directoryManifest(project), originalDirectories);
    await dialog.$("button=Apply reviewed rename").click();
    await dialog.waitForExist({ reverse: true, timeout: 45_000 });
    const rollback = this.panel().$("button=Rollback Maven rename");
    const failedApply = "Maven module rename Apply failed or could not be confirmed.";
    await this.browser().waitUntil(async () =>
      (await rollback.isExisting() && await rollback.isEnabled()) ||
      (await this.panel().getText()).includes(failedApply),
    { timeout: 45_000, interval: 100, timeoutMsg: "The IDE did not show the result of Maven module relocation" });
    if ((await this.panel().getText()).includes(failedApply)) {
      const directories = await this.directoryManifest(project);
      const files = await this.fileManifest(project);
      await writeFile(path.join(this.#lease!.runnerArtifactPath, "maven-module-relocation-failed-apply.json"),
        JSON.stringify({
          retiredDirectories: directories.filter((entry) => entry === "library" || entry.startsWith("library/")),
          retiredFiles: [...files.keys()].filter((entry) => entry.startsWith("library/")),
        }, null, 2));
      throw new Error(failedApply);
    }
    assert.match(await readFile(this.file("maven/pom.xml"), "utf8"), /<module>components\/library<\/module>/u);
    const movedPom = await readFile(this.file(`maven/${destination}/pom.xml`), "utf8");
    assert.match(movedPom, /<relativePath>\.\.\/\.\.\/pom\.xml<\/relativePath>/u);
    assert.match(movedPom, /<artifactId>library<\/artifactId>/u);
    assert.equal(await readFile(this.file("maven/app/pom.xml"), "utf8"), this.originalSource("maven/app/pom.xml"));
    assert.equal(await readFile(this.file(relocatedSourcePath), "utf8"), this.originalSource(originalSourcePath));
    await this.surface().tab(relocatedSourcePath).waitForDisplayed({ timeout: 10_000 });
    await assertLanguageServiceResumed();
    const isJournal = (relative: string) => relative === ".refactorkit" || relative.startsWith(".refactorkit/");
    const appliedDirectories = (await this.directoryManifest(project)).filter((dir) => !isJournal(dir));
    const directoriesEvidence = path.join(this.#lease!.runnerArtifactPath, "maven-module-relocation-directories.json");
    await writeFile(directoriesEvidence, JSON.stringify({ originalDirectories, appliedDirectories }, null, 2));
    assert.equal(appliedDirectories.includes("library"), false, "Apply left the original Maven module directory in place");
    await verifyApplication(destination);
    const savedInputs = async () => new Map([...await this.fileManifest(project)].filter(([file]) => !isJournal(file)));
    const assertRollbackRefused = async () => {
      const before = await savedInputs();
      const directories = (await this.directoryManifest(project)).filter((dir) => !isJournal(dir));
      await rollback.click();
      await this.waitForText("The workspace changed after the Maven module rename. Review the changes before retrying rollback.");
      await rollback.waitForEnabled({ timeout: 10_000 });
      assert.deepEqual(await savedInputs(), before);
      assert.deepEqual((await this.directoryManifest(project)).filter((dir) => !isJournal(dir)), directories);
      await this.surface().assertBuffer(relocatedSourcePath, this.originalSource(originalSourcePath));
    };
    const destinationPom = this.file(`maven/${destination}/pom.xml`);
    await writeFile(destinationPom, movedPom + "<!-- external change after Apply -->\n");
    await assertRollbackRefused();
    await writeFile(destinationPom, movedPom);

    // A different process can occupy the retired path before the user requests rollback.
    const directoriesAfterRefusedRollback = (await this.directoryManifest(project)).filter((dir) => !isJournal(dir));
    await writeFile(directoriesEvidence, JSON.stringify({
      originalDirectories, appliedDirectories, directoriesAfterRefusedRollback,
    }, null, 2));
    assert.equal(directoriesAfterRefusedRollback.includes("library"), false,
      "The original Maven module directory reappeared before the rollback conflict check");
    const retiredDirectory = this.file("maven/library");
    await mkdir(retiredDirectory);
    const unrelatedFile = path.join(retiredDirectory, "unrelated.txt");
    await writeFile(unrelatedFile, "New independent content\n");
    await assertRollbackRefused();
    await unlink(unrelatedFile);
    await rmdir(retiredDirectory);

    await rollback.click();
    await rollback.waitForExist({ reverse: true, timeout: 45_000 });
    await this.assertRestoredOriginalBuffer(originalSourcePath);
    await assertLanguageServiceResumed();
    const restoredDirectories = (await this.directoryManifest(project)).filter((dir) => !isJournal(dir));
    await writeFile(directoriesEvidence,
      JSON.stringify({ originalDirectories, appliedDirectories, directoriesAfterRefusedRollback, restoredDirectories }, null, 2));
    assert.deepEqual(await savedInputs(), new Map([...originalFiles].filter(([file]) => !isJournal(file))));
    assert.deepEqual(restoredDirectories, originalDirectories.filter((dir) => !isJournal(dir)));
    await this.assertInputs();
    await this.assertMavenModuleTransactionRestored();
    await verifyApplication("library");
    this.#proof.mavenNestedModuleRelocationVerified = true;
  }
  async applyAndRollbackMavenModuleRename() {
    const projectRoot = this.file("maven");
    const originalModuleDirectories = await this.directoryManifest(this.file("maven/app"));
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().tab(SOURCE).click();
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForExist({ reverse: true, timeout: 5_000 });
    await this.surface().discardUsingDisk(SOURCE, this.originalSource(SOURCE));
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.previewMavenModuleRename();
    const dialog = this.browser().$('[role="dialog"][aria-label="Maven module rename preview"]');
    await dialog.$("button=Apply reviewed rename").click();
    await dialog.waitForExist({ reverse: true, timeout: 20_000 });
    const rollbackButton = this.panel().$("button=Rollback Maven rename");
    try {
      await rollbackButton.waitForEnabled({ timeout: 45_000 });
    } catch {
      const message = await this.panel()
        .$('[role="alert"]')
        .getText()
        .catch(() => "no visible alert");
      throw new Error(`Apply did not retain a rollback action: ${message}`);
    }
    await access(this.file("maven/app-preview/pom.xml"));
    await assert.rejects(access(this.file("maven/app/pom.xml")), { code: "ENOENT" });
    const beforeBuild = await this.fileManifest(projectRoot);
    const directoriesBeforeBuild = await this.directoryManifest(projectRoot);
    const verification = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: projectRoot,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.match(verification.stdout, /BUILD SUCCESS/);
    await writeFile(
      path.join(this.#lease!.runnerArtifactPath, "maven-module-rename-verify.log"),
      verification.stdout + verification.stderr,
    );
    this.#proof.mavenModuleRenameAppliedMavenVerify = true;
    const outputRoots = ["app-preview/target", "library/target"];
    const isBuildOutput = (relative: string) =>
      outputRoots.some((root) => relative === root || relative.startsWith(`${root}/`));
    const newFiles = this.diffMavenFileManifests(beforeBuild, await this.fileManifest(projectRoot));
    const newDirectories = (await this.directoryManifest(projectRoot))
      .filter((directory) => !directoriesBeforeBuild.includes(directory));
    assert.ok(newFiles.length > 0, "Maven verify must produce real build outputs");
    assert.ok(newFiles.every((change) => change.before === null && isBuildOutput(change.path)));
    assert.ok(newDirectories.every(isBuildOutput));
    for (const change of newFiles) await unlink(path.join(projectRoot, change.path));
    // The directory manifest is sorted with parents before descendants.
    for (const directory of newDirectories.reverse()) await rmdir(path.join(projectRoot, directory));
    assert.deepEqual(await this.fileManifest(projectRoot), beforeBuild);
    assert.deepEqual(await this.directoryManifest(projectRoot), directoriesBeforeBuild);
    await rollbackButton.click();
    try {
      await this.browser().waitUntil(
        async () =>
          !(await rollbackButton.isExisting()) &&
          (await access(this.file("maven/app/pom.xml")).then(() => true, () => false)),
        { timeout: 30_000, interval: 100 },
      );
    } catch (cause) {
      const message = await this.panel().$('[role="alert"]').getText().catch(() => "no visible alert");
      throw new Error(`Maven module rollback did not restore the original POM. ${message}`, { cause });
    }
    await this.browser().waitUntil(
      async () =>
        access(this.file("maven/app-preview")).then(
          () => false,
          (error: NodeJS.ErrnoException) => error.code === "ENOENT",
        ),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "RefactorKit rollback did not remove the renamed Maven destination directory",
      },
    );
    await this.assertRestoredOriginalBuffer(SOURCE);
    await this.assertInputs();
    assert.deepEqual(await this.directoryManifest(this.file("maven/app")), originalModuleDirectories);
    await this.assertMavenModuleTransactionRestored();
    this.#proof.mavenModuleRenameRefusedForDirtyBuffersAppliedAndRolledBack = true;
  }
  async assertMavenModuleRenameRollback() {
    assert.equal(this.#proof.mavenModuleRenameRefusedForDirtyBuffersAppliedAndRolledBack, true);
    await access(this.file("maven/app/pom.xml"));
    await assert.rejects(access(this.file("maven/app-preview")), { code: "ENOENT" });
    await this.assertMavenModuleTransactionRestored();
    await this.assertInputs();
  }
  async applyVerifyAndRollbackMavenModuleCreateFromPartialContext() {
    const moduleName = "ide-native-created-module";
    const parentPom = this.file("maven/pom.xml");
    const moduleDirectory = this.file(`maven/${moduleName}`);
    const originalParentPom = this.#inputs.get("maven/pom.xml");
    assert.ok(originalParentPom, "The Maven reactor root POM is missing from the fixture");
    assert.equal(await readFile(parentPom, "utf8"), originalParentPom);

    const parentSelect = this.panel().$('select[aria-label="Maven module parent"]');
    await this.browser().waitUntil(() => parentSelect.isEnabled(), {
      timeout: 10_000,
      interval: 50,
      timeoutMsg: "The Maven Add Module parent selector stayed busy after project synchronization",
    });
    const parentOptions = await parentSelect.$$("option").getElements();
    const parentLabels = await parentOptions.map((option) => option.getText());
    const parentLabel = parentLabels.find((label) => label.startsWith("Project root · maven"));
    assert.ok(
      parentLabel,
      `The Maven project root was not offered as a parent: ${parentLabels.join(", ")}`,
    );
    await parentSelect.selectByVisibleText(parentLabel);
    await this.panel().$("button=Review Add Module").click();

    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    assert.equal(await dialog.$("h2").getText(), "Add Maven Module");
    const inputs = await dialog.$$("input").getElements();
    assert.equal(
      inputs.length,
      3,
      "Add Module should expose its parent, identity, and name fields",
    );
    const moduleNameInput = dialog.$(
      '//label[.//span[normalize-space(.)="Maven module name"]]/input',
    );
    await pasteNativeText(this.#app!, moduleNameInput, moduleName);
    await this.browser().waitUntil(async () => await dialog.$("button=Preview").isEnabled(), {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: "The IDE did not enable Maven Add Module preview",
    });
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(async () => await dialog.$("button=Apply").isEnabled(), {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: "RefactorKit did not produce an applicable Maven Add Module preview",
    });
    const previewText = await dialog.getText();
    assert.ok(previewText.includes(moduleName), previewText);
    await assert.rejects(access(moduleDirectory), { code: "ENOENT" });
    assert.equal(await readFile(parentPom, "utf8"), originalParentPom);
    await dialog.$("button=Apply").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring applied successfully."),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "RefactorKit did not apply the reviewed Maven Add Module transaction",
      },
    );
    await access(path.join(moduleDirectory, "pom.xml"));
    assert.notEqual(await readFile(parentPom, "utf8"), originalParentPom);
    this.#proof.mavenModuleCreateApplied = true;
    const copy = path.join(this.#lease!.runnerArtifactPath, "maven-module-create-applied-source-copy");
    await cp(this.file("maven"), copy, {
      recursive: true,
      filter: (source) => !["target", ".refactorkit"].includes(path.basename(source)),
    });
    const verification = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      {
        cwd: copy,
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.match(verification.stdout, /BUILD SUCCESS/);
    await writeFile(path.join(this.#lease!.runnerArtifactPath, "maven-module-create-source-copy-verify.log"), verification.stdout + verification.stderr);
    this.#proof.mavenModuleCreateSourceCopyVerified = true;
    // Preserve pre-existing output directories, including empty language-service
    // output roots. Remove only entries added by this controlled fixture build.
    const beforeLiveBuild = await this.fileManifest(this.file("maven"));
    const beforeLiveDirectories = await this.directoryManifest(this.file("maven"));
    const liveVerification = await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "verify"],
      { cwd: this.file("maven"), env: { ...process.env, JAVA_HOME: this.#sdk }, timeout: 180_000, maxBuffer: 1024 * 1024 },
    );
    assert.match(liveVerification.stdout, /BUILD SUCCESS/);
    await writeFile(path.join(this.#lease!.runnerArtifactPath, "maven-module-create-live-verify.log"), liveVerification.stdout + liveVerification.stderr);
    this.#proof.mavenModuleCreateLiveReactorVerified = true;
    const afterLiveBuild = await this.fileManifest(this.file("maven"));
    const liveChanges = this.diffMavenFileManifests(beforeLiveBuild, afterLiveBuild);
    assert.ok(liveChanges.length > 0, "The live Maven build must create real outputs");
    assert.ok(liveChanges.every((change) => change.before === null &&
      ["library/target/", "app/target/", `${moduleName}/target/`].some((prefix) => change.path.startsWith(prefix))),
      "The live build must preserve every pre-existing file");
    const afterLiveDirectories = await this.directoryManifest(this.file("maven"));
    const addedDirectories = afterLiveDirectories.filter((directory) => !beforeLiveDirectories.includes(directory));
    assert.ok(addedDirectories.every((directory) =>
      ["library/target", "app/target", `${moduleName}/target`].some((prefix) => directory === prefix || directory.startsWith(`${prefix}/`))),
      "The live build must add directories only under its expected output roots");
    await writeFile(path.join(this.#lease!.runnerArtifactPath, "maven-module-create-live-build-entries.json"),
      JSON.stringify({ preExistingDirectories: beforeLiveDirectories, createdFiles: liveChanges.map((change) => change.path), createdDirectories: addedDirectories }, null, 2));
    await this.browser().waitUntil(async () => await dialog.$("button=Rollback").isEnabled(), {
      timeout: 10_000, interval: 100,
      timeoutMsg: "The applied transaction did not expose rollback after Maven verify",
    });
    await dialog.$("button=Rollback").click();
    await this.browser().waitUntil(async () =>
      (await dialog.getText()).includes("Rollback was not started.") && await dialog.$("button=Retry Rollback").isEnabled(), {
      timeout: 30_000, interval: 100,
      timeoutMsg: "Live build outputs did not produce a retryable pre-write rollback refusal",
    });
    assert.deepEqual(await this.fileManifest(this.file("maven")), afterLiveBuild,
      "Rollback refusal must preserve every source and build output file");
    assert.deepEqual(await this.directoryManifest(this.file("maven")), afterLiveDirectories,
      "Rollback refusal must preserve every build output directory");
    this.#proof.mavenModuleCreateBuildOutputsPreservedOnRollbackRefusal = true;
    for (const change of liveChanges) await unlink(this.file(`maven/${change.path}`));
    for (const directory of addedDirectories.sort((left, right) => right.split("/").length - left.split("/").length))
      await rmdir(this.file(`maven/${directory}`));
    assert.deepEqual(await this.fileManifest(this.file("maven")), beforeLiveBuild,
      "Controlled output cleanup must restore every post-Apply file byte");
    assert.deepEqual(await this.directoryManifest(this.file("maven")), beforeLiveDirectories,
      "Controlled output cleanup must preserve pre-existing directories, including empty output roots");
    this.#proof.mavenModuleCreateOnlyBuildOutputsRemoved = true;
    await this.browser().waitUntil(async () => await dialog.$("button=Retry Rollback").isEnabled(), {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: "The applied Add Module transaction did not expose rollback",
    });
    const appliedParentPom = await readFile(parentPom, "utf8");
    const laterParentPom = `${appliedParentPom}\n<!-- Later external edit: keep until reviewed. -->\n`;
    await writeFile(parentPom, laterParentPom);
    const beforeRefusedRollback = await this.fileManifest(this.file("maven"));
    await dialog.$("button=Retry Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Rollback was not started.") &&
        await dialog.$("button=Retry Rollback").isEnabled(),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "Changed saved inputs did not produce a retryable pre-write rollback refusal",
      },
    );
    assert.deepEqual(await this.fileManifest(this.file("maven")), beforeRefusedRollback,
      "A refused rollback must preserve both applied files and later external edits");
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    assert.equal(await dialog.$("button=Preview").isEnabled(), false);
    assert.ok(!(await dialog.getText()).includes("Refactoring applied successfully."));
    this.#proof.mavenModuleCreateRollbackRefusedWithoutWrites = true;
    await writeFile(parentPom, appliedParentPom);
    await dialog.$("button=Retry Rollback").click();
    await this.browser().waitUntil(
      async () => (await dialog.getText()).includes("Refactoring rolled back."),
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: "RefactorKit did not roll back the Maven Add Module transaction",
      },
    );
    await assert.rejects(access(moduleDirectory), { code: "ENOENT" });
    assert.equal(await readFile(parentPom, "utf8"), originalParentPom);
    await this.assertInputs();
    await this.assertMavenModuleTransactionRestored();
    this.#proof.mavenModuleCreateRolledBack = true;
    this.#proof.mavenModuleCreateRollbackExplicitRetrySucceeded = true;
    this.#proof.mavenModuleCreateAppliedMavenVerifyRolledBack = true;
    await dialog.$("button=Cancel").click();
  }
  async assertMavenModuleCreateAppliedAndRolledBack() {
    assert.equal(this.#proof.mavenModuleCreateAppliedMavenVerifyRolledBack, true);
    assert.equal(this.#proof.mavenModuleCreateRollbackRefusedWithoutWrites, true);
    assert.equal(this.#proof.mavenModuleCreateLiveReactorVerified, true);
    assert.equal(this.#proof.mavenModuleCreateBuildOutputsPreservedOnRollbackRefusal, true);
    assert.equal(this.#proof.mavenModuleCreateOnlyBuildOutputsRemoved, true);
    assert.equal(this.#proof.mavenModuleCreateRollbackExplicitRetrySucceeded, true);
    await access(this.file("maven/pom.xml"));
    await assert.rejects(access(this.file("maven/ide-native-created-module")), { code: "ENOENT" });
    await this.assertMavenModuleTransactionRestored();
    await this.assertInputs();
  }
  async requestProjectTestTemplates() {
    const probes = testTemplateProbes(this.#executionTool);
    const contextMarker =
      this.#executionTool === "maven"
        ? "maven-effective-v1 · available"
        : "gradle-effective-v1 · available";
    assert.ok((await this.panel().getText()).includes(contextMarker));
    await this.chooseSourceSet("test");
    const sourceSetText = await this.panel().getText();
    assert.ok(sourceSetText.includes("app/src/test/java"), sourceSetText);
    const testClasspath = await this.classpath("Compile");
    for (const probe of probes)
      assert.ok(
        testClasspath.some((entry) => entry.includes(probe.jar)),
        `${probe.jar} is absent from the resolved ${this.#executionTool} test classpath: ${JSON.stringify(testClasspath)}`,
      );
    if (this.#mockitoSpringTestTemplates)
      for (const jar of ["mockito-core-5.20.0.jar", "spring-boot-test-4.1.0.jar"])
        assert.ok(
          testClasspath.some((entry) => entry.includes(jar)),
          `${jar} is absent from the resolved ${this.#executionTool} test classpath: ${JSON.stringify(testClasspath)}`,
        );
    this.#projectTestTemplateClasspath = [...testClasspath];
    this.#proof.projectAwareTestTemplateClasspathResolved = true;
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    const parts = probes[0]!.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      const folder = this.browser().$(`[role="treeitem"][data-path="${folderPath}"]`);
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) !== "true") {
        await folder.scrollIntoView();
        await folder.click();
        try {
          await this.browser().waitUntil(
            async () => (await folder.getAttribute("aria-expanded")) === "true",
            {
              timeout: 5_000,
              interval: 50,
              timeoutMsg: `The native file explorer did not expand ${folderPath}`,
            },
          );
        } catch (error) {
          const rows = await this.browser().execute(
            (targetPath) =>
              Array.from(document.querySelectorAll<HTMLElement>("[role=treeitem][data-path]"))
                .filter((row) => {
                  const path = row.getAttribute("data-path") ?? "";
                  return (
                    path === targetPath ||
                    targetPath.startsWith(`${path}/`) ||
                    path.startsWith(`${targetPath}/`)
                  );
                })
                .map((row) => ({
                  path: row.getAttribute("data-path"),
                  label: row.getAttribute("aria-label"),
                  expanded: row.getAttribute("aria-expanded"),
                  visible: row.getClientRects().length > 0,
                })),
            folderPath,
          );
          throw new Error(
            `The native file explorer did not expand ${folderPath}: ${JSON.stringify(rows)}`,
            { cause: error },
          );
        }
      }
    }
    const widget = this.browser().$(".suggest-widget");
    for (const probe of probes) {
      await this.surface().open(probe.path, this.originalSource(probe.path));
      await this.surface().focus(probe.path);
      const editorHost = this.browser().$('[data-testid="monaco-code-editor-host"]');
      const contextStatus = await editorHost.getAttribute(
        "data-java-template-project-context-status",
      );
      assert.equal(
        contextStatus === "available" ||
          (this.#executionTool === "gradle" && contextStatus === "partial"),
        true,
        `the active ${probe.className} editor did not receive an available ${this.#executionTool} source-set context`,
      );
      await this.browser().keys(["Control", "Home"]);
      await this.browser().keys(["ArrowDown"]);
      await this.browser().keys(["ArrowDown"]);
      await this.browser().keys(["Home"]);
      try {
        await this.browser().performActions([
          {
            type: "key",
            id: `java-test-template-prefix-${probe.label}`,
            actions: textKeySequence(`  ${probe.label}`),
          },
        ]);
      } finally {
        await this.browser().releaseActions();
      }
      await this.browser().keys(["Control", "Space"]);
      await this.browser().waitUntil(
        async () => {
          if (!(await widget.isDisplayed())) return false;
          const rows = await widget.$$(".monaco-list-row").getElements();
          for (const row of rows) if (await isTemplateCompletionRow(row, probe.label)) return true;
          return false;
        },
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: `The synchronized ${this.#executionTool} test source set did not offer ${probe.label}`,
        },
      );
      const templateSelectionState = await this.browser().execute(() => {
        const widget = document.querySelector<HTMLElement>(".suggest-widget");
        return {
          activeElement: document.activeElement
            ? {
                tag: document.activeElement.tagName,
                role: document.activeElement.getAttribute("role"),
                label: document.activeElement.getAttribute("aria-label"),
                className: (document.activeElement as HTMLElement).className,
              }
            : null,
          widgetVisible: Boolean(widget?.getClientRects().length),
          rows: Array.from(widget?.querySelectorAll<HTMLElement>(".monaco-list-row") ?? []).map(
            (row) => ({
              label: row.getAttribute("aria-label"),
              selected: row.getAttribute("aria-selected"),
              className: row.className,
              iconClass: row.querySelector(".suggest-icon")?.getAttribute("class") ?? null,
              text: row.textContent,
            }),
          ),
        };
      });
      assert.ok(
        templateSelectionState.widgetVisible,
        `The ${probe.label} ${this.#executionTool} template popup closed before acceptance: ${JSON.stringify(templateSelectionState)}`,
      );
      await this.pressTemplateKey("\uE007");
      await this.browser().waitUntil(
        async () =>
          (await this.surface().renderedText({ file: probe.path })).includes(probe.annotation),
        {
          timeout: 2_000,
          interval: 50,
          timeoutMsg: `Selecting ${probe.label} did not insert its Java test annotation`,
        },
      );
      this.#proof.projectAwareTestTemplatePresented = true;

      await this.browser().keys(["Tab"]);
      try {
        await this.browser().performActions([
          {
            type: "key",
            id: `java-test-assertion-template-prefix-${probe.assertionLabel}`,
            actions: textKeySequence(probe.assertionLabel),
          },
        ]);
      } finally {
        await this.browser().releaseActions();
      }
      await this.browser().keys(["Control", "Space"]);
      await this.browser().waitUntil(
        async () => {
          if (!(await widget.isDisplayed())) return false;
          const rows = await widget.$$(".monaco-list-row").getElements();
          for (const row of rows)
            if (await isTemplateCompletionRow(row, probe.assertionLabel)) return true;
          return false;
        },
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: `The synchronized ${this.#executionTool} test source set did not offer ${probe.assertionLabel}`,
        },
      );
      await this.pressTemplateKey("\uE007");
      await this.browser().waitUntil(
        async () =>
          (await this.surface().renderedText({ file: probe.path })).includes(probe.assertionText),
        {
          timeout: 2_000,
          interval: 50,
          timeoutMsg: `Selecting ${probe.assertionLabel} did not insert its Java assertion`,
        },
      );
      this.#proof.projectAwareEqualityAssertionTemplatePresented = true;
    }
    if (this.#mockitoSpringTestTemplates) {
      await this.requestMockitoTemplates();
      await this.requestSpringBootTemplate();
    }
  }
  private async pressTemplateKey(value: string) {
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "java-template-selection",
          actions: textKeySequence(value),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
  }
  private async selectProjectTemplate(
    label: string,
    purpose: string,
    insertionText: string,
    relativePath: string,
  ) {
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: `java-${purpose}-prefix-${label}`,
          actions: textKeySequence(label),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().keys(["Control", "Space"]);
    const widget = this.browser().$(".suggest-widget");
    await this.browser().waitUntil(
      async () => {
        if (!(await widget.isDisplayed())) return false;
        const rows = await widget.$$(".monaco-list-row").getElements();
        for (const row of rows) if (await isTemplateCompletionRow(row, label)) return true;
        return false;
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `The synchronized ${this.#executionTool} test source set did not offer ${label}`,
      },
    );
    await this.pressTemplateKey("\uE007");
    await this.browser().waitUntil(
      async () =>
        (await this.surface().renderedText({ file: relativePath })).includes(insertionText),
      {
        timeout: 2_000,
        interval: 50,
        timeoutMsg: `Selecting ${label} did not insert its Java template`,
      },
    );
  }
  private async requestMockitoTemplates() {
    const relativePath = `${this.#executionTool}/app/src/test/java/pkg/MockitoTemplateProbe.java`;
    await this.surface().open(relativePath, this.originalSource(relativePath));
    await this.surface().focus(relativePath);
    const editorHost = this.browser().$('[data-testid="monaco-code-editor-host"]');
    assert.equal(
      await editorHost.getAttribute("data-java-template-project-context-status"),
      "available",
      `the active Mockito probe did not receive an available ${this.#executionTool} source-set context`,
    );
    await this.browser().keys(["Control", "End"]);
    await this.browser().keys(["ArrowUp"]);
    await this.browser().keys(["ArrowUp"]);
    await this.browser().keys(["Home"]);
    await this.selectProjectTemplate(
      "mockitoMock",
      "mockito-mock-template",
      "org.mockito.Mockito.mock(",
      relativePath,
    );
    await this.browser().keys(["Tab"]);
    await this.browser().keys(["Tab"]);
    await this.browser().keys(["Enter"]);
    await this.selectProjectTemplate(
      "mockitoWhen",
      "mockito-stub-template",
      "org.mockito.Mockito.when(",
      relativePath,
    );
    for (let index = 0; index < 4; index++) await this.browser().keys(["Tab"]);
    await this.browser().keys(["Enter"]);
    await this.selectProjectTemplate(
      "mockitoVerify",
      "mockito-verify-template",
      "org.mockito.Mockito.verify(",
      relativePath,
    );
    for (let index = 0; index < 3; index++) await this.browser().keys(["Tab"]);
    this.#proof.projectAwareMockitoTemplatesPresented = true;
  }
  private async requestSpringBootTemplate() {
    const relativePath = `${this.#executionTool}/app/src/test/java/pkg/SpringBootTemplateProbe.java`;
    await this.surface().open(relativePath, this.originalSource(relativePath));
    await this.surface().focus(relativePath);
    const editorHost = this.browser().$('[data-testid="monaco-code-editor-host"]');
    assert.equal(
      await editorHost.getAttribute("data-java-template-project-context-status"),
      "available",
      `the active Spring Boot probe did not receive an available ${this.#executionTool} source-set context`,
    );
    await this.browser().keys(["Control", "End"]);
    await this.selectProjectTemplate(
      "springBootTest",
      "spring-boot-test-template",
      "@org.springframework.boot.test.context.SpringBootTest",
      relativePath,
    );
    await this.browser().keys(["Tab"]);
    this.#proof.projectAwareSpringBootTemplatePresented = true;
  }
  async assertProjectTestTemplate() {
    assert.equal(this.#proof.projectAwareTestTemplateClasspathResolved, true);
    for (const probe of testTemplateProbes(this.#executionTool)) {
      await this.surface().tab(probe.path).click();
      await this.browser()
        .$(".editor-opening-placeholder")
        .waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().focus(probe.path);
      const buffer = await readNativeCopiedText(this.#app!);
      assert.ok(
        buffer.trimStart().startsWith("package pkg;"),
        `${probe.label} copied text was not the active Java editor buffer: ${JSON.stringify(buffer)}`,
      );
      const annotationIndex = buffer.indexOf(probe.annotation);
      assert.ok(annotationIndex >= 0, `Missing template annotation ${probe.annotation}`);
      const classStart = buffer.indexOf(`class ${probe.className} {`);
      const classClose = buffer.lastIndexOf("}");
      assert.ok(
        classStart >= 0 && classStart < annotationIndex && annotationIndex < classClose,
        `${probe.label} was not inserted in the test class body: ${JSON.stringify(buffer)}`,
      );
      const methodStart = buffer.indexOf(probe.signature);
      const methodOpen = buffer.indexOf("{", methodStart + probe.signature.length);
      const methodClose = buffer.indexOf("}", methodOpen);
      const assertionIndex = buffer.indexOf(probe.assertionText);
      assert.ok(methodStart > annotationIndex, `Missing ${probe.label} method signature`);
      assert.ok(
        methodOpen > methodStart && methodClose > methodOpen && methodClose < classClose,
        `${probe.label} method body is not enclosed in the test class: ${JSON.stringify(buffer)}`,
      );
      assert.ok(
        assertionIndex > methodOpen && assertionIndex < methodClose,
        `Missing ${probe.assertionLabel} inside ${probe.label}: ${JSON.stringify(buffer)}`,
      );
      await this.compileGeneratedTestTemplate(probe, buffer);
      assert.equal(
        [...buffer.matchAll(/\{/gu)].length,
        [...buffer.matchAll(/\}/gu)].length,
        `${probe.label} left unbalanced Java braces: ${JSON.stringify(buffer)}`,
      );
      await this.surface().assertDirty(probe.path, true);
      assert.equal(
        await readFile(this.file(probe.path), "utf8"),
        this.originalSource(probe.path),
        `Accepting ${probe.label} must leave its source file unsaved`,
      );
    }
    if (this.#mockitoSpringTestTemplates) {
      assert.equal(this.#proof.projectAwareMockitoTemplatesPresented, true);
      assert.equal(this.#proof.projectAwareSpringBootTemplatePresented, true);
      const mockitoPath = `${this.#executionTool}/app/src/test/java/pkg/MockitoTemplateProbe.java`;
      await this.surface().tab(mockitoPath).click();
      await this.browser()
        .$(".editor-opening-placeholder")
        .waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().focus(mockitoPath);
      const mockitoSource = await readNativeCopiedText(this.#app!);
      assert.ok(mockitoSource.includes("Mockito.mock(Service.class)"), mockitoSource);
      assert.ok(
        mockitoSource.includes("Mockito.when(service.method(arguments)).thenReturn(result)"),
        mockitoSource,
      );
      assert.ok(mockitoSource.includes("Mockito.verify(service).method(arguments)"), mockitoSource);
      await this.compileGeneratedTestTemplate(
        {
          className: "MockitoTemplateProbe",
          label: "mockito",
          assertionLabel: "Mockito templates",
        },
        mockitoSource,
      );
      await this.surface().assertDirty(mockitoPath, true);
      assert.equal(
        await readFile(this.file(mockitoPath), "utf8"),
        this.originalSource(mockitoPath),
      );

      const springPath = `${this.#executionTool}/app/src/test/java/pkg/SpringBootTemplateProbe.java`;
      await this.surface().tab(springPath).click();
      await this.browser()
        .$(".editor-opening-placeholder")
        .waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().focus(springPath);
      const springSource = await readNativeCopiedText(this.#app!);
      assert.ok(
        springSource.includes("@org.springframework.boot.test.context.SpringBootTest"),
        springSource,
      );
      assert.ok(springSource.includes("class ApplicationTests {"), springSource);
      await this.compileGeneratedTestTemplate(
        {
          className: "ApplicationTests",
          label: "springBootTest",
          assertionLabel: "Spring Boot test class",
        },
        springSource,
      );
      await this.surface().assertDirty(springPath, true);
      assert.equal(await readFile(this.file(springPath), "utf8"), this.originalSource(springPath));
    }
    assert.equal(this.#proof.projectAwareEqualityAssertionTemplatePresented, true);
    assert.equal(this.#proof.projectAwareTestTemplateCompilationPassed, true);
    const source = this.executionSource();
    await this.surface().tab(source).click();
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForExist({ reverse: true, timeout: 5_000 });
    await this.assertDraft(source);
    this.#proof.projectAwareTestTemplateSavedSourceUnchanged = true;
  }
  async restoreTestTemplateDraftAndClose() {
    const paths = [
      ...testTemplateProbes(this.#executionTool).map((probe) => probe.path),
      ...(this.#mockitoSpringTestTemplates
        ? [
            `${this.#executionTool}/app/src/test/java/pkg/MockitoTemplateProbe.java`,
            `${this.#executionTool}/app/src/test/java/pkg/SpringBootTemplateProbe.java`,
          ]
        : []),
    ];
    for (const sourcePath of paths) {
      await this.surface().tab(sourcePath).click();
      await this.browser()
        .$(".editor-opening-placeholder")
        .waitForExist({ reverse: true, timeout: 5_000 });
      await this.surface().discardUsingDisk(sourcePath, this.originalSource(sourcePath));
    }
    const source = this.executionSource();
    if (await this.surface().tab(source).$('[aria-label="Unsaved changes"]').isExisting()) {
      await this.surface().tab(source).click();
      await this.surface().discardUsingDisk(source, this.originalSource(source));
    }
    const closeState = () =>
      this.browser().execute(() => ({
        dirtyTabs: Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
          .filter((tab) => tab.querySelector('[aria-label="Unsaved changes"]'))
          .map((tab) => tab.getAttribute("aria-label") ?? tab.getAttribute("data-path")),
        visibleAlerts: Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]'))
          .filter((alert) => alert.getClientRects().length > 0)
          .map((alert) => alert.innerText),
      }));
    await this.browser().waitUntil(async () => (await closeState()).dirtyTabs.length === 0, {
      timeout: 5_000,
      interval: 50,
      timeoutMsg: "Test-template fixture still has dirty editor tabs before native close",
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await this.close();
    } catch (error) {
      const diagnostics = await closeState()
        .then((state) => JSON.stringify(state))
        .catch(
          (diagnosticError: unknown) =>
            `WebDriver state unavailable: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`,
        );
      throw new Error(
        `Native close failed after template restoration (${error instanceof Error ? error.message : String(error)}); UI=${diagnostics}`,
        {
          cause: error,
        },
      );
    }
  }
  private async compileGeneratedTestTemplate(
    probe: { className: string; label: string; assertionLabel: string },
    source: string,
  ) {
    const sdk = this.#executionTool === "maven" ? this.#sdk : this.#gradleSdk;
    const compiler = path.join(sdk, "bin", "javac");
    const projectRoot = this.file(this.#executionTool);
    const compileClasspath = this.#projectTestTemplateClasspath.map((entry) =>
      path.isAbsolute(entry) ? entry : path.resolve(projectRoot, entry),
    );
    assert.ok(
      compileClasspath.length > 0 && compileClasspath.every((entry) => path.isAbsolute(entry)),
      `The resolved ${this.#executionTool} test classpath must contain absolute entries before template compilation: ${JSON.stringify(compileClasspath)}`,
    );
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ide-java-template-compile-"));
    const sourcePath = path.join(temporaryRoot, "src", "pkg", `${probe.className}.java`);
    const outputPath = path.join(temporaryRoot, "classes");
    try {
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await mkdir(outputPath);
      const classDeclaration = `class ${probe.className} {`;
      assert.ok(source.includes(classDeclaration), `Missing ${probe.className} declaration`);
      const compileSource = source.replace(
        classDeclaration,
        `${classDeclaration}\n  private static final Object expected = new Object();\n  private static final Object actual = expected;`,
      );
      await writeFile(sourcePath, compileSource, "utf8");
      await promisify(execFile)(
        compiler,
        [
          "--release",
          "17",
          "-proc:none",
          "-classpath",
          compileClasspath.join(path.delimiter),
          "-d",
          outputPath,
          sourcePath,
        ],
        {
          env: { ...process.env, JAVA_HOME: sdk },
          timeout: 30_000,
          maxBuffer: 512 * 1024,
        },
      );
      this.#proof.projectAwareTestTemplateCompilationPassed = true;
    } catch (error) {
      const compilerOutput =
        typeof error === "object" && error !== null && "stderr" in error
          ? String(error.stderr)
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(
        `The generated ${probe.label} and ${probe.assertionLabel} source did not compile with the selected ${this.#executionTool} JDK and resolved test classpath: ${compilerOutput}`,
        { cause: error },
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
  async refreshProjectContextAfterCustomOutput() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    if (this.#executionTool === "maven") await this.synchronizeMaven();
    else await this.evaluateGradle(false);
  }
  async refreshSavedSourceStructure(buildTool: "maven" | "gradle" = "maven") {
    const structure = this.panel().$(".//details[summary='Saved source structure']");
    await structure.waitForDisplayed({ timeout: 5000 });
    if ((await structure.getAttribute("open")) === null) await structure.$("summary").click();
    const refresh = structure.$("button=Refresh");
    await refresh.scrollIntoView();
    await refresh.click();
    let accessibleName: string | null = null;
    try {
      await this.browser().waitUntil(
        async () => {
          const runners = await structure.$$('button[aria-label^="Open type pkg.Runner at "]');
          const accessibleNames: (string | null)[] = [];
          for (const runner of runners)
            accessibleNames.push(await runner.getAttribute("aria-label"));
          accessibleName =
            accessibleNames.find((name) =>
              name
                ?.replaceAll("\\", "/")
                .includes(`${buildTool}/app/src/main/java/pkg/Runner.java:`),
            ) ?? null;
          return accessibleName !== null;
        },
        {
          timeout: 20_000,
          interval: 100,
          timeoutMsg: `RefactorKit did not return the ${buildTool} Runner source location`,
        },
      );
    } catch (error) {
      throw new Error(
        `RefactorKit did not return the ${buildTool} Runner source location. Current project model: ${await structure.getText()}`,
        { cause: error },
      );
    }
    const match = /^Open type pkg\.Runner at (.+):([1-9][0-9]*)$/u.exec(accessibleName ?? "");
    assert.ok(match, `RefactorKit did not return a usable Runner location: ${accessibleName}`);
    this.#runnerModelPath = match[1]!;
    this.#runnerModelLine = Number(match[2]);
    const normalizedPath = this.#runnerModelPath.replaceAll("\\", "/");
    assert.ok(
      normalizedPath.endsWith(`${buildTool}/app/src/main/java/pkg/Runner.java`),
      `RefactorKit returned an unexpected Runner path: ${this.#runnerModelPath}`,
    );
  }
  async assertRunnerModelLocation() {
    assert.ok(this.#runnerModelPath, "the RefactorKit project model did not report Runner");
    assert.ok(this.#runnerModelLine > 0, "the RefactorKit project model did not report a line");
    this.#proof.projectModelReportsRunnerLocation = true;
    await this.assertDraft();
    await this.assertInputs();
  }
  async assertGradleRunnerModelLocation() {
    assert.ok(this.#runnerModelPath, "the RefactorKit project model did not report Gradle Runner");
    assert.ok(this.#runnerModelLine > 0, "the RefactorKit project model did not report a line");
    assert.ok(
      this.#runnerModelPath
        .replaceAll("\\", "/")
        .endsWith("gradle/app/src/main/java/pkg/Runner.java"),
      `RefactorKit returned an unexpected Gradle Runner path: ${this.#runnerModelPath}`,
    );
    this.#proof.gradleProjectModelReportsRunnerLocation = true;
    await this.assertDraft();
    await this.assertInputs();
  }
  async openRunnerFromProjectModel() {
    assert.ok(this.#runnerModelPath && this.#runnerModelLine > 0);
    const structure = this.panel().$(".//details[summary='Saved source structure']");
    const runner = structure.$(
      `button[aria-label="Open type pkg.Runner at ${this.#runnerModelPath}:${this.#runnerModelLine}"]`,
    );
    await runner.scrollIntoView();
    await runner.waitForDisplayed({ timeout: 5000 });
    assert.equal(await runner.isEnabled(), true, "the reported project-model location is disabled");
    const label = await runner.getAttribute("aria-label");
    await this.browser().execute((ariaLabel) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
      ).find((candidate) => candidate.getAttribute("aria-label") === ariaLabel);
      if (!button) throw new Error("the reported project-model location is not rendered");
      button.click();
    }, label);
    const tab = this.surface().tab(SOURCE);
    await tab.waitForDisplayed({ timeout: 10_000 });
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "project-model navigation did not activate Runner.java",
      },
    );
    assert.equal(
      (await tab.getAttribute("data-path"))?.replaceAll("\\", "/"),
      this.#runnerModelPath.replaceAll("\\", "/"),
      "project-model navigation did not target the active Runner.java buffer",
    );
    const cursorPosition = () => this.browser().$('[data-testid="editor-cursor-position"]');
    const initialCursorPosition = cursorPosition();
    const workspaceId = await initialCursorPosition.getAttribute("data-navigation-workspace-id");
    const contextWorkspaceId = await initialCursorPosition.getAttribute(
      "data-navigation-context-workspace-id",
    );
    assert.equal(contextWorkspaceId, workspaceId, "Java model navigation workspace is not current");
    assert.equal(
      await initialCursorPosition.getAttribute("data-navigation-context-generation"),
      await initialCursorPosition.getAttribute("data-navigation-generation"),
      "Java model navigation generation is stale",
    );
    assert.equal(
      await initialCursorPosition.getAttribute("data-navigation-switching"),
      "false",
      "Java model navigation workspace is switching",
    );
    assert.equal(
      await initialCursorPosition.getAttribute("data-navigation-metadata-loading"),
      "false",
      "Java model navigation workspace metadata is loading",
    );
    const navigationStatus = () =>
      this.browser().$('[data-testid="java-project-navigation-status"]');
    await this.browser().waitUntil(
      async () => {
        const statusElement = navigationStatus();
        const status = (await statusElement.isExisting()) ? await statusElement.getText() : "";
        return (
          status.startsWith("Could not open") ||
          (await cursorPosition().getAttribute("data-reveal-file-path")) ===
            this.#runnerModelPath ||
          (await cursorPosition().getText()).startsWith(`Ln ${this.#runnerModelLine}, Col `)
        );
      },
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "project-model navigation did not reveal the engine-reported line",
      },
    );
    const finalNavigationStatus = navigationStatus();
    assert.equal(
      (await finalNavigationStatus.isExisting()) ? await finalNavigationStatus.getText() : "",
      "",
      "the IDE refused the RefactorKit Java source location",
    );
    const finalCursorPosition = cursorPosition();
    assert.equal(
      await finalCursorPosition.getAttribute("data-reveal-file-path"),
      this.#runnerModelPath,
    );
    assert.equal(
      Number(await finalCursorPosition.getAttribute("data-reveal-line")),
      this.#runnerModelLine,
    );
    const monacoHost = this.browser().$('[data-testid="monaco-code-editor-host"]');
    await this.browser().waitUntil(
      async () =>
        (await monacoHost.getAttribute("data-reveal-requested-line")) ===
          String(this.#runnerModelLine) &&
        (await monacoHost.getAttribute("data-editor-cursor-line")) ===
          String(this.#runnerModelLine),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Monaco did not apply the engine-reported cursor position",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await cursorPosition().getText()).startsWith(`Ln ${this.#runnerModelLine}, Col `),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "project-model navigation did not reveal the engine-reported line",
      },
    );
    this.#proof.projectModelNavigationRevealsLine = true;
  }
  async assertRunnerModelNavigation() {
    assert.equal(this.#proof.projectModelNavigationRevealsLine, true);
    await this.assertDraft();
    await this.assertInputs();
    this.#proof.projectModelNavigationPreservesDraft = true;
  }
  async synchronizeGradleForExecution(prepareOutputs = this.#gradleCompositeProject) {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeGradle(true);
    await this.evaluateGradle(prepareOutputs);
  }
  async refreshGradleContextAfterCompositeExecution() {
    assert.equal(this.#gradleCompositeProject, true);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeGradle(true);
    await this.evaluateGradle(false);
    await this.assertGradleCompositeExecutionIdentity();
    this.#proof.gradleCompositePostExecutionIdentityRefreshes++;
  }
  async synchronizeExecutionProject() {
    if (this.#executionTool === "maven") await this.synchronizeMaven();
    else if (this.#selectedTestDebugFixture && this.#javaRelease === 27) {
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      await this.synchronizeSupportedJavaProjectContext(27);
    } else await this.synchronizeGradleForExecution();
    if (this.#executionDraftSavedBeforeProjectSync) await this.assertSavedExecutionDraft();
    else await this.assertDraft(this.executionSource());
  }
  async refreshMavenContextAfterFailsafeExecution() {
    assert.equal(this.#proof.synchronizedMavenFailsafeTestTaskRan, true);
    await this.resynchronizeMavenAfterExecution();
    await this.assertSavedExecutionDraft();
  }
  async resynchronizeMavenAfterExecution() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeMaven();
  }
  async runProfileAndRepeatWithApplicationDirectory() {
    assert.equal(this.#applicationWorkingDirectory, true);
    await this.configureSynchronizedExecution();
    await this.setApplicationDirectory(APPLICATION_DIRECTORY_FIRST);
    await this.setApplicationInput(true);
    await this.requestProjectExecution("Run");
    await this.submitApplicationInput("run");
    await this.assertSynchronizedRun();
    let proof = await this.readApplicationDirectoryProof();
    this.assertApplicationDirectoryProof(proof);
    this.#proof.applicationDirectory.runUsesSelectedDirectory = true;
    // Compilation deliberately retires semantic context. A new launch requires
    // another reviewed synchronization; captured-session repeat reacquires it.
    await this.synchronizeApplicationDirectoryProject();
    await this.configureSynchronizedExecution();
    await this.setApplicationInput(true);
    await this.requestProjectExecution("Run with JFR");
    await this.submitApplicationInput("jfr");
    await this.waitForNewApplicationProof(proof);
    await this.waitProjectExecution("run", "succeeded");
    proof = await this.readApplicationDirectoryProof();
    this.assertApplicationDirectoryProof(proof);
    this.#proof.applicationDirectory.jfrUsesSelectedDirectory = true;
    const firstRecording = await this.applicationDirectoryRecording();
    const bytes = await readFile(this.file(firstRecording));
    assert.ok(bytes.length > 0);
    await assert.rejects(access(this.file(`${APPLICATION_DIRECTORY_FIRST}/.ide`)), { code: "ENOENT" });
    this.#proof.applicationDirectory.jfrRetainsProjectStorage = true;
    await this.requestProjectExecution("Analyze recording");
    const table = this.executionPanel().$('table[aria-label="JFR event type summary"]');
    await table.waitForDisplayed({ timeout: 15_000 });
    assert.match(await table.getText(), /jdk\./);
    this.#proof.applicationDirectory.jfrAnalysis = true;
    await this.setApplicationDirectory(APPLICATION_DIRECTORY_SECOND);
    await this.setApplicationInput(false);
    await this.requestProjectExecution("Rerun session");
    await this.submitApplicationInput("rerun");
    await this.waitForNewApplicationProof(proof);
    await this.waitProjectExecution("run", "succeeded");
    this.#applicationDirectoryProof = await this.readApplicationDirectoryProof();
    this.assertApplicationDirectoryProof(this.#applicationDirectoryProof);
    await assert.rejects(access(this.file(`${APPLICATION_DIRECTORY_SECOND}/synchronized-cwd-proof.txt`)), { code: "ENOENT" });
    this.#proof.applicationDirectory.rerunRetainsCapturedDirectory = true;
    const repeated = await this.applicationDirectoryRecording();
    assert.notEqual(repeated, firstRecording);
    assert.ok((await readFile(this.file(repeated))).length > 0);
    assert.deepEqual(await readFile(this.file(firstRecording)), bytes);
    this.#proof.applicationDirectory.rerunPreservesRecording = true;
  }
  async testWithApplicationDirectoryUnused() {
    await this.synchronizeApplicationDirectoryProject();
    await this.configureSynchronizedExecution("test");
    await this.setApplicationDirectory(APPLICATION_DIRECTORY_FIRST);
    await pasteNativeText(this.#app!, this.executionPanel().$('input[placeholder="com.example.MainTest#computes"]'), "pkg.RunnerTest");
    await this.setApplicationInput(true);
    await this.requestProjectExecution("Run tests");
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(3, 3, 0);
    const moduleDirectory = this.file(`${this.#executionTool}/app`);
    assert.equal(await readFile(path.join(moduleDirectory, "synchronized-test-cwd-proof.txt"), "utf8"), `${moduleDirectory}|${moduleDirectory}|${moduleDirectory}|${this.executionSdk()}`);
    assert.equal(await this.readApplicationDirectoryProof(), this.#applicationDirectoryProof);
    await assert.rejects(access(this.file(`${APPLICATION_DIRECTORY_FIRST}/synchronized-test-cwd-proof.txt`)), { code: "ENOENT" });
    this.#proof.applicationDirectory.testsRetainModuleDirectory = true;
    assert.equal(await this.applicationInputPanel().isExisting(), false);
    assert.equal(await this.applicationInputFlag().isSelected(), true);
    this.#proof.applicationInput.testsIgnoreInput = true;
  }
  async debugWithApplicationDirectory() {
    await this.synchronizeApplicationDirectoryProject();
    await this.configureSynchronizedExecution();
    await this.setApplicationDirectory(APPLICATION_DIRECTORY_FIRST);
    await this.executionPanel().$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.setApplicationInput(true);
    await this.requestProjectExecution("Debug");
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    await this.executionPanel().$('[aria-label="Structured Java debugger"]').$("button=Continue").click();
    await this.submitApplicationInput("debug");
    await this.waitForNewApplicationProof(this.#applicationDirectoryProof);
    await this.waitProjectExecution("debug", "succeeded");
    this.assertApplicationDirectoryProof(await this.readApplicationDirectoryProof());
    this.#proof.applicationDirectory.debugUsesSelectedDirectory = true;
    assert.ok(Object.values(this.#proof.applicationDirectory).every((value) => value));
    const compiled = this.#executionTool === "maven" ? "target/classes/pkg/Runner.class" : "build/classes/java/main/pkg/Runner.class";
    await access(this.file(`${this.#executionTool}/app/${compiled}`));
    await assert.rejects(access(this.file(`${APPLICATION_DIRECTORY_FIRST}/target`)), { code: "ENOENT" });
    await assert.rejects(access(this.file(`${APPLICATION_DIRECTORY_FIRST}/build`)), { code: "ENOENT" });
    await this.synchronizeApplicationDirectoryProject();
    await this.configureSynchronizedExecution();
    await this.setApplicationInput(true);
    await this.requestProjectExecution("Run");
    const pid = await this.waitForApplicationInput();
    await pasteNativeText(this.#app!, this.applicationInputPanel().$("textarea"), "waiting without EOF");
    await this.applicationInputPanel().$("button=Send line").click();
    await this.browser().waitUntil(async () => (await this.applicationInputPanel().getText()).includes("Bytes accepted: 20."), { timeout: 10_000 });
    await this.requestProjectExecution("Stop");
    await this.waitProjectExecution("run", "stopped");
    await this.browser().waitUntil(async () => {
      try { process.kill(pid, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }, { timeout: 10_000 });
    assert.equal(await this.applicationInputPanel().$("textarea").getValue(), "");
    this.#proof.applicationInput.stopReapedWaitingJvm = true;
    assert.ok(Object.values(this.#proof.applicationInput).every((value) => value));
  }
  private applicationInputPanel() { return this.executionPanel().$('[aria-label="Application input"]'); }
  private applicationInputFlag() { return this.executionPanel().$("label=Application input (System.in)").$("input"); }
  private async setApplicationInput(enabled: boolean) {
    if (await this.applicationInputFlag().isSelected() !== enabled) await this.applicationInputFlag().click();
  }
  private async waitForApplicationInput() {
    const previous = this.#applicationInputPid;
    let current = 0;
    await this.browser().waitUntil(async () => {
      const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
      const pid = Number(/PROJECT_GUI_INPUT_PID:(\d+)/.exec(output)?.[1]);
      if (!pid || pid === previous || !output.includes("PROJECT_GUI_INPUT_READY")) return false;
      current = pid;
      return (await this.applicationInputPanel().getText()).includes("Input: open.");
    }, { timeout: 30_000, interval: 100 });
    this.#applicationInputPid = current;
    return current;
  }
  private async submitApplicationInput(phase: "run" | "jfr" | "rerun" | "debug") {
    await this.waitForApplicationInput();
    const text = `quit\ncont\ncafé 🙂 𐐀 'quoted' $(false); ${phase}`;
    const panel = this.applicationInputPanel();
    const textarea = panel.$("textarea");
    await pasteNativeText(this.#app!, textarea, text);
    await panel.$("button=Send line").click();
    await this.browser().waitUntil(async () => (await textarea.getValue()) === "" && await panel.$("button=Send line").isEnabled(), { timeout: 10_000 });
    await panel.$("button=Send line").click();
    const expected = Buffer.from(`${text}\n\n`, "utf8");
    await this.browser().waitUntil(async () => (await panel.getText()).includes(`Bytes accepted: ${expected.length}.`) && await panel.$("button=Close input (EOF)").isEnabled(), { timeout: 10_000 });
    await panel.$("button=Close input (EOF)").click();
    await this.browser().waitUntil(async () => (await this.executionPanel().$('[aria-label="Java console output"]').getText()).includes(`PROJECT_GUI_INPUT_BYTES:${expected.toString("base64")}`), { timeout: 10_000 });
    assert.equal(await readFile(this.file(`${APPLICATION_DIRECTORY_FIRST}/synchronized-input-proof.txt`), "utf8"), expected.toString("base64"));
    await assert.rejects(access(this.file(`${APPLICATION_DIRECTORY_SECOND}/synchronized-input-proof.txt`)), { code: "ENOENT" });
    this.#proof.applicationInput[phase] = true;
  }
  private async synchronizeApplicationDirectoryProject() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
  }
  private async setApplicationDirectory(value: string) {
    await pasteNativeText(this.#app!, this.executionPanel().$("label=Application working directory (workspace-relative; optional)").$("input"), value);
  }
  private async readApplicationDirectoryProof() {
    return readFile(this.file(`${APPLICATION_DIRECTORY_FIRST}/synchronized-cwd-proof.txt`), "utf8");
  }
  private async waitForNewApplicationProof(previous: string) {
    await this.browser().waitUntil(async () => (await this.readApplicationDirectoryProof()) !== previous, { timeout: 30_000, interval: 100 });
  }
  private assertApplicationDirectoryProof(proof: string) {
    const [id, resource, javaDirectory, propertyDirectory, osDirectory, sdk] = proof.split("|");
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(resource, "FIRST");
    for (const directory of [javaDirectory, propertyDirectory, osDirectory]) assert.equal(directory, this.file(APPLICATION_DIRECTORY_FIRST));
    assert.equal(sdk, this.executionSdk());
    assert.ok(!proof.includes("SECOND"));
  }
  private async applicationDirectoryRecording() {
    const elements = await this.executionPanel().$$("[role=status]").getElements();
    const texts = await elements.map((element) => element.getText());
    const relative = texts.find((text) => text.startsWith("JFR recording saved to "))?.slice("JFR recording saved to ".length).trim();
    assert.ok(relative);
    assert.ok(relative.startsWith(`${this.#executionTool}/app/.ide/flight-recordings/`), relative);
    assert.equal(path.isAbsolute(relative), false);
    assert.ok(!relative.split("/").includes(".."));
    return relative;
  }
  private async replaceCompilerFixtureSource(value: string) {
    assert.ok(this.#compilerBuildFixture);
    const source = this.#compilerBuildFixture.source;
    await pasteNativeText(this.#app!, this.browser().$(`[role="textbox"][aria-label="Code editor for ${source}"]`), value, {
      focus: () => this.surface().focus(source),
      verify: async () => { await assertNativeCopiedText(this.#app!, value); return true; },
    });
    await this.surface().assertDirty(source, true);
  }
  async breakSynchronizedSourceAndBuild() {
    const source = this.executionSource();
    const draft = ` ${this.originalSource(source)}`;
    const broken = draft.replace("public static void main(String[] args) throws Exception {",
      "public static void main(String[] args) throws Exception {\n    int compilerFault = ?;");
    assert.notEqual(broken, draft);
    const line = broken.split("\n").findIndex(line => line.includes("int compilerFault")) + 1;
    assert.ok(line > 0);
    this.#compilerBuildFixture = { source, draft, broken, line };
    await this.configureSynchronizedExecution();
    await this.replaceCompilerFixtureSource(broken);
    await this.requestProjectExecution("Build");
  }
  async navigateSynchronizedCompilerFailure() {
    assert.ok(this.#compilerBuildFixture);
    const { source, draft, broken, line } = this.#compilerBuildFixture;
    await this.waitProjectExecution("build", "failed");
    assert.match(await this.executionPanel().getText(), /build: failed \(exit [1-9][0-9]*\)/);
    assert.equal(await readFile(this.file(source), "utf8"), broken);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("Runner.java"));
    assert.ok(!output.includes("JAVA_REFERENCE_OK:"));
    this.#proof.synchronizedCompilerFailure.savedFault = true;
    await this.replaceCompilerFixtureSource(draft);
    const library = `${this.#executionTool}/library/src/main/java/fixtures/library/BaseGreeting.java`;
    assert.ok(this.#inputs.has(library));
    await this.browser().keys(["Control", "p"]);
    const quickOpen = this.browser().$('[role="dialog"][aria-label="Go to File"]');
    await quickOpen.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, quickOpen.$('[aria-label="Search workspace files"]'), library);
    const result = quickOpen.$(`[role="option"][data-path="${library}"]`);
    await result.waitForDisplayed({ timeout: 5_000 });
    await result.click();
    await quickOpen.waitForExist({ reverse: true, timeout: 10_000 });
    assert.equal(await this.surface().tab(library).getAttribute("aria-selected"), "true");
    await this.surface().assertBuffer(library, this.originalSource(library), "clipboard");
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const locations = this.executionPanel().$('section[aria-label="Reported compiler locations"]');
    await locations.waitForDisplayed({ timeout: 5_000 });
    const links = await locations.$$("button").getElements();
    let target;
    for (const link of links) if (await link.getText() === `${source}:${line} · error`) target = link;
    assert.ok(target, `The compiler report did not identify ${source}:${line}.`);
    await target.scrollIntoView();
    await target.waitForEnabled({ timeout: 5_000 });
    await target.click();
    await this.browser().waitUntil(async () =>
      await this.surface().tab(source).getAttribute("aria-selected") === "true" &&
      await this.browser().$('[data-testid="editor-cursor-position"]').getAttribute("aria-label") === `Line ${line}, column 1`,
      { timeout: 5_000, interval: 50 });
    await this.surface().assertBuffer(source, draft, "clipboard");
    await this.surface().assertDirty(source, true);
    assert.equal(await readFile(this.file(source), "utf8"), broken);
    this.#proof.synchronizedCompilerFailure.sourceTabActivatedFromLibrary = true;
    this.#proof.synchronizedCompilerFailure.draftAndDiskPreserved = true;
  }
  async saveCompilerRepairAndSynchronize() {
    assert.ok(this.#compilerBuildFixture);
    await this.saveExecutionDraftBeforeProjectSync();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
    this.#proof.synchronizedCompilerFailure.repairedContext = true;
    const source = this.#compilerBuildFixture.source;
    await this.surface().focus(source);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys("Delete");
    await this.surface().assertBuffer(source, this.originalSource(source), "clipboard");
    await this.surface().assertDirty(source, true);
    assert.equal(await readFile(this.file(source), "utf8"), this.#compilerBuildFixture.draft);
    this.#executionDraftSavedBeforeProjectSync = false;
    this.#proof.synchronizedCompilerFailure.freshRunDraft = true;
  }
  private async invokeMainSourceAction(operation: "Run" | "Debug" = "Run", mode: "file" | "cursor" = "file", line = this.projectDebuggerBreakpointLine()) {
    const source = this.executionSource();
    await this.surface().focus(source);
    await this.browser().keys(["Control", "Home"]);
    if (mode === "cursor") {
      for (let index = 1; index < line; index++) await this.browser().keys("ArrowDown");
      const point = await this.browser().execute(() => {
        const cursor=document.querySelector<HTMLElement>(".monaco-editor .cursor");
        if(!cursor) throw new Error("No visible source cursor");
        const bounds=cursor.getBoundingClientRect();
        return {x:Math.round(bounds.left+2),y:Math.round(bounds.top+bounds.height/2)};
      });
      await this.browser().action("pointer").move({...point,origin:"viewport"}).down({button:2}).up({button:2}).perform();
    } else await this.surface().openContextMenu(source);
    const label = `${operation} main ${mode === "file" ? "from this file" : "at cursor"}…`;
    try {
      await this.browser().waitUntil(async () => {
        return (await this.surface().contextMenuItem(label)) !== null;
      }, { timeout: 5_000, interval: 50, timeoutMsg: "The Java editor main launch action is unavailable" });
      const point = await this.surface().contextMenuItem(label);
      assert.ok(point);
      await this.browser().action("pointer").move({ ...point, origin: "viewport" }).down({ button: 0 }).up({ button: 0 }).perform();
    } finally { await this.browser().releaseActions(); }
  }
  async rejectDirtyMainDiscovery() {
    await this.configureSynchronizedExecution("main", "wrong.Missing");
    const discovery = this.executionPanel().$('section[aria-label="Main-class discovery"]');
    await this.invokeMainSourceAction();
    await this.browser().waitUntil(async () => /save|unsaved|saved/i.test(await discovery.$('[role="status"]').getText()), { timeout: 5_000 });
    this.#proof.mainClassDiscovery.dirtyDraftPreserved = true;
    await this.surface().assertDirty(this.executionSource(), true);
    await this.surface().assertBuffer(this.executionSource(), ` ${this.originalSource(this.executionSource())}`, "clipboard");
    assert.equal(await readFile(this.file(this.executionSource()), "utf8"), this.originalSource(this.executionSource()));
    assert.equal(await discovery.$("li").isExisting(), false);
  }
  async discoverSavedMainAndSelect() {
    await this.saveExecutionDraftBeforeProjectSync();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
    await this.configureSynchronizedExecution("main", "wrong.Missing");
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
    await this.configureSynchronizedExecution("main", "wrong.Missing");
    const discovery = this.executionPanel().$('section[aria-label="Main-class discovery"]');
    await discovery.$("button=Discover main classes").click();
    const candidate = discovery.$(`button=pkg.Runner · ${this.executionSource()}`);
    await candidate.waitForDisplayed({ timeout: 30_000 });
    assert.match(await discovery.getText(), /Partial coverage/);
    this.#proof.mainClassDiscovery.partialCoverageVisible = true;
    await candidate.click();
    assert.equal(await this.executionPanel().$('input[placeholder="com.example.Main"]').getValue(), "pkg.Runner");
    await this.assertSavedExecutionDraft();
    this.#proof.mainClassDiscovery.providerCandidateSelected = true;
  }
  async runDiscoveredMain() {
    const input = this.executionPanel().$('input[placeholder="com.example.Main"]');
    await pasteNativeText(this.#app!, input, "wrong.Missing");
    await this.invokeMainSourceAction();
    await this.browser().waitUntil(async () => (await input.getValue()) === "pkg.Runner", { timeout: 30_000, interval: 100, timeoutMsg: "The editor action did not select the provider-owned main" });
    await this.browser().waitUntil(async () => /run: (starting|running|succeeded)/.test(await this.executionPanel().getText()), { timeout: 30_000, interval: 100 });
    this.#proof.mainClassDiscovery.editorFileActionStartedRun = true;
  }
  async debugDiscoveredMainAndComplete(mode: "file" | "cursor" = "file") {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.Main"]'), "wrong.Missing");
    await this.invokeMainSourceAction("Debug", mode);
    await this.waitForProjectDebuggerStatus("suspended (entry)", 90_000);
    const debuggerPanel = execution.$('[aria-label="Structured Java debugger"]');
    await pasteNativeText(this.#app!, debuggerPanel.$("label=Breakpoint (class:line)").$("input"), `pkg.Runner:${this.projectDebuggerBreakpointLine()}`);
    await debuggerPanel.$("button=Set breakpoint").click();
    await debuggerPanel.$("button=Continue").waitForEnabled({ timeout: 5_000 });
    await debuggerPanel.$("button=Continue").click();
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)");
    assert.ok((await debuggerPanel.getText()).includes("pkg.Runner.main"));
    assert.equal(await execution.$('input[placeholder="com.example.Main"]').getValue(), "pkg.Runner");
    await this.assertSavedExecutionDraft();
    await debuggerPanel.$("button=Continue").click();
    await this.waitProjectExecution("debug", "succeeded");
    const output = await execution.$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("PROJECT_GUI_JDK:" + this.executionSdk()), output);
    assert.ok(output.includes("JAVA_REFERENCE_OK:hello JVM|count:2|generated-greeting|runtime-token|main-peer|"), output);
    if (mode === "file") this.#proof.mainClassDiscovery.editorFileActionStartedDebug = true;
    else this.#proof.mainClassDiscovery.editorCursorStartedDebug = true;
  }
  async runCursorMainAndRejectSibling() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
    await this.configureSynchronizedExecution("main", "wrong.Missing");
    const peerLine=this.originalSource(this.executionSource()).split("\n").findIndex(line=>line.includes('static String value()'))+1;
    assert.ok(peerLine>0);
    const previousSession=await this.executionPanel().getAttribute("data-session-id");
    await this.invokeMainSourceAction("Run", "cursor", peerLine);
    const discovery=this.executionPanel().$('section[aria-label="Main-class discovery"]');
    await this.browser().waitUntil(async()=> (await discovery.getText()).includes("Selected type: pkg.Peer"),{timeout:30_000,interval:100});
    assert.equal(await discovery.$("li").isExisting(),false);
    assert.equal(await this.executionPanel().$('input[placeholder="com.example.Main"]').getValue(),"wrong.Missing");
    assert.equal(await this.executionPanel().getAttribute("data-session-id"),previousSession);
    this.#proof.mainClassDiscovery.cursorSiblingWithoutMainRefused=true;
    await this.invokeMainSourceAction("Run", "cursor");
    await this.browser().waitUntil(async()=> (await this.executionPanel().$('input[placeholder="com.example.Main"]').getValue())==="pkg.Runner",{timeout:30_000,interval:100});
    await this.browser().waitUntil(async()=> { const current=await this.executionPanel().getAttribute("data-session-id"); return Boolean(current && current!==previousSession); },{timeout:30_000,interval:100});
    await this.assertSynchronizedRun();
    this.#proof.mainClassDiscovery.editorCursorStartedRun=true;
  }
  async runSynchronizedModule(compositeRoot?: string) {
    await this.configureSynchronizedExecution("main", "pkg.Runner", "app", compositeRoot);
    const panel = this.executionPanel();
    const previous = await panel.getAttribute("data-session-id");
    await this.requestProjectExecution("Run");
    await this.browser().waitUntil(
      async () => {
        const current = await panel.getAttribute("data-session-id");
        return Boolean(current && current !== previous);
      },
      { timeout: 30_000, interval: 100, timeoutMsg: "Run did not start a new Java execution session" },
    );
  }
  async assertMixedJvmRun() {
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /JAVA_KOTLIN_INTEROP:java-kotlin/u);
    if (this.#executionTool === "maven") {
      await access(this.file("maven/app/target/classes/pkg/Runner.class"));
      await access(this.file("maven/app/target/classes/pkg/Greeter.class"));
    } else {
      await access(this.file("gradle/app/build/classes/java/main/pkg/Runner.class"));
      await access(this.file("gradle/app/build/classes/kotlin/main/pkg/Greeter.class"));
    }
  }
  async debugMixedJvmCallback() {
    if (this.#executionTool === "maven") {
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    }
    await this.synchronizeExecutionProject();
    const source = this.executionSource();
    const line = this.originalSource(source).split("\n").findIndex((text) => text.includes('return "java";')) + 1;
    assert.ok(line > 0);
    await this.startSynchronizedModuleDebugging("panel", line);
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    await this.continueSynchronizedModuleDebugging();
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 45_000);
    const execution = this.executionPanel();
    const frames = execution.$('[aria-label="Java stack frames"]');
    const current = await frames.$('button[aria-pressed="true"]').getText();
    assert.ok(current.includes("pkg.Runner.fromJava") && current.includes(`Runner.java:${line}`), current);
    assert.match(await frames.getText(), /pkg\.Greeter\.message.*Greeter\.kt/u);
    await this.browser().$(".monaco-editor .java-debug-execution-line").waitForDisplayed({ timeout: 5_000 });
    await this.continueSynchronizedModuleDebugging();
    await this.waitProjectExecution("debug", "succeeded");
    assert.match(await execution.$('[aria-label="Java console output"]').getText(), /JAVA_KOTLIN_INTEROP:java-kotlin/u);
    this.#proof.mixedJvmDebug = true;
  }
  async assertMixedJvmMemberRenameRefused() {
    if (this.#executionTool === "maven") {
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    }
    await this.synchronizeExecutionProject();
    const source = this.executionSource();
    const savedSource = await readFile(this.file(source), "utf8");
    const project = this.file(this.#executionTool);
    const before = await this.fileManifest(project);
    const dialog = await this.openMixedJvmMemberRenameDialog(source, savedSource);
    assert.deepEqual(await this.fileManifest(project), before, "Project files changed while opening the review");
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(async () => {
      const message = await dialog.getText();
      return message.includes("RefactorKit refused this refactoring.") &&
        message.includes("requires compiler-proven closure of Kotlin consumers");
    }, { timeout: 30_000, interval: 100, timeoutMsg: "The member rename refusal was not displayed" })
      .catch(async error => { throw new Error(await dialog.getText(), { cause: error }); });
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    assert.deepEqual(await this.fileManifest(project), before);
    await this.surface().assertBuffer(source, savedSource);
    await this.surface().assertDirty(source, false);
    this.#proof.mixedJvmMemberRenameRefused = true;
  }
  private async openMixedJvmMemberRenameDialog(source: string, savedSource: string) {
    await this.surface().assertBuffer(source, savedSource);
    await this.positionEditorCursorOnToken(source, savedSource, "String fromJava()", "fromJava");
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), "Review Java Member Rename");
    await palette.$('[role="option"][aria-label^="Review Java Member Rename"]').click();
    const dialog = this.browser().$('[role="dialog"][aria-modal="true"]');
    await dialog.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, dialog.$(".//label[span='New name']/input"), "renamedCallback");
    return dialog;
  }
  async assertMavenMixedJvmMemberRenameAfterResync() {
    assert.equal(this.#executionTool, "maven");
    const project = this.file("maven");
    const testOutput = this.file("maven/app/target/test-classes");
    const hadTestOutput = await access(testOutput).then(() => true, () => false);
    await this.startLanguageServiceWithSdk(this.executionSdk());
    this.#proof.mixedMavenTestOutputCreatedWhileStartingLanguageService =
      !hadTestOutput && await access(testOutput).then(() => true, () => false);
    await rmdir(testOutput).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeExecutionProject();
    const source = this.executionSource();
    const savedSource = await readFile(this.file(source), "utf8");
    const before = await this.fileManifest(project);
    const dialog = await this.openMixedJvmMemberRenameDialog(source, savedSource);
    await mkdir(testOutput);
    await dialog.$("button=Preview").click();
    await this.browser().waitUntil(async () => {
      const message = await dialog.getText();
      return /(?:project inputs changed|snapshot is stale)/iu.test(message);
    }, { timeout: 20_000, interval: 100, timeoutMsg: "The stale Maven context did not refuse Preview" })
      .catch(async error => { throw new Error(await dialog.getText(), { cause: error }); });
    assert.equal(await dialog.$("button=Apply").isEnabled(), false);
    await dialog.$("button=Cancel").click();
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
    assert.deepEqual(await this.fileManifest(project), before);
    this.#proof.mixedMavenRenameRejectedStaleContext = true;
    await this.assertMixedJvmMemberRenameRefused();
  }
  private async positionEditorCursorOnToken(source: string, text: string, token: string, symbol: string) {
    const lines = text.split("\n");
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    const line = lines.findIndex((text) => text.includes(token));
    assert.ok(line >= 0, `Missing definition fixture: ${token}`);
    const column = lines[line].indexOf(token) + token.indexOf(symbol) + 1;
    await this.surface().focus(source);
    const before = /^Ln (\d+), Col \d+$/u.exec((await cursor.getText()).trim());
    assert.ok(before, "The cursor position is unavailable");
    const distance = line + 1 - Number(before[1]);
    for (let move = 0; move < Math.abs(distance); move++) {
      await this.browser().keys(distance > 0 ? "ArrowDown" : "ArrowUp");
    }
    await this.browser().keys("Home");
    const atLineStart = new RegExp(`^Ln ${line + 1}, Col (\\d+)$`, "u").exec((await cursor.getText()).trim());
    assert.ok(atLineStart, "The cursor did not reach the requested line");
    const horizontal = column + 1 - Number(atLineStart[1]);
    try {
      await this.browser().performActions([{
        type: "key", id: "definition-caret",
        actions: textKeySequence((horizontal > 0 ? "\uE014" : "\uE012").repeat(Math.abs(horizontal))),
      }]);
    } finally {
      await this.browser().releaseActions();
    }
    await this.browser().waitUntil(
      async () => (await cursor.getText()).trim() === `Ln ${line + 1}, Col ${column + 1}`,
      { timeout: 5_000, interval: 50 },
    );
  }
  private async followMixedJvmDefinition(source: string, text: string, token: string, symbol: string) {
    await this.positionEditorCursorOnToken(source, text, token, symbol);
    this.#proof.contextNavigationDefinitionCallsBeforeF12 = await this.definitionProviderCallCount(source);
    await this.requestDefinitionAtCurrentPosition(source);
  }
  private async assertMixedJvmKotlinDestination(target: string, text: string, symbol: string) {
    const lines = text.split("\n");
    const line = lines.findIndex((value) => value.includes(symbol));
    assert.ok(line >= 0, `Missing Kotlin declaration of ${symbol}`);
    const column = lines[line].indexOf(symbol) + 1;
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    const tab = this.surface().tab(target);
    await this.browser().waitUntil(async () =>
      (await tab.isExisting()) &&
      (await tab.getAttribute("aria-selected")) === "true" &&
      (await cursor.getText()).trim() === `Ln ${line + 1}, Col ${column}`,
    { timeout: 40_000, interval: 100, timeoutMsg: `F12 did not open the saved Kotlin declaration of ${symbol}` });
    await this.surface().assertBuffer(target, text);
    await this.surface().assertDirty(target, false);
  }
  async assertMixedJvmKotlinDefinitions() {
    assert.equal(this.#executionTool, "gradle");
    await this.synchronizeExecutionProject();
    const source = this.executionSource();
    const savedSource = await readFile(this.file(source), "utf8");
    const target = "gradle/app/src/main/kotlin/pkg/Greeter.kt";
    const targetText = this.originalSource(target);
    for (const symbol of ["Greeter", "message"]) {
      await this.surface().tab(source).click();
      await this.surface().assertBuffer(source, savedSource);
      await this.followMixedJvmDefinition(source, savedSource, "Greeter.message()", symbol);
      await this.assertMixedJvmKotlinDestination(target, targetText, symbol);
      this.#proof.mixedJvmKotlinDefinitionsRevealed.push(symbol);
    }
    assert.equal(await readFile(this.file(target), "utf8"), targetText);
    await this.assertSavedExecutionDraft();
  }
  async assertMixedJvmKotlinBinaryDriftAndRebuild() {
    assert.equal(this.#executionTool, "gradle");
    const source = this.executionSource();
    const savedSource = await readFile(this.file(source), "utf8");
    const target = "gradle/app/src/main/kotlin/pkg/Greeter.kt";
    const original = this.originalSource(target);
    const changed = original.replace("@JvmStatic", "\n    @JvmStatic").replace('"-kotlin"', '"-kotlin-rebuilt"');
    assert.notEqual(changed, original);
    const compiled = this.file("gradle/app/build/classes/kotlin/main/pkg/Greeter.class");
    const oldClass = await readFile(compiled);
    await this.surface().replace(target, changed);
    await this.surface().save(target);
    assert.equal(await readFile(this.file(target), "utf8"), changed);

    await this.surface().tab(source).click();
    await this.synchronizeExecutionProject();
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
    });
    await this.followMixedJvmDefinition(source, savedSource, "Greeter.message()", "message");
    await this.browser().waitUntil(async () =>
      this.browser().execute(() => {
        const history = JSON.parse(document.body.getAttribute("data-java-definition-result-history") ?? "[]");
        const latest = history.at(-1);
        return latest?.status === "refused" && latest.refusalCode === "java.definitionKotlinBinaryDrift";
      }),
    { timeout: 35_000, interval: 100, timeoutMsg: "F12 did not report the stale Kotlin class" });
    assert.equal(await this.surface().tab(source).getAttribute("aria-selected"), "true");
    assert.deepEqual(await readFile(compiled), oldClass);
    this.#proof.mixedJvmKotlinBinaryDriftRefused = true;

    await this.runSynchronizedModule();
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /JAVA_KOTLIN_INTEROP:java-kotlin-rebuilt/u);
    assert.notDeepEqual(await readFile(compiled), oldClass);
    await this.synchronizeExecutionProject();
    await this.followMixedJvmDefinition(source, savedSource, "Greeter.message()", "message");
    await this.assertMixedJvmKotlinDestination(target, changed, "message");
    this.#proof.mixedJvmKotlinDefinitionAfterRebuild = true;
    await this.surface().replace(target, original);
    await this.surface().save(target);
    assert.equal(await readFile(this.file(target), "utf8"), original);
  }
  async assertMixedJvmDefinitionNavigation() {
    await this.synchronizeExecutionProject();
    const source = this.executionSource();
    const savedSource = await readFile(this.file(source), "utf8");
    await this.surface().assertBuffer(source, savedSource);
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
    });
    const lines = savedSource.split("\n");
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.followMixedJvmDefinition(source, savedSource, "Greeter.message()", "message");
    await this.browser().waitUntil(async () => {
      const statuses = await this.browser().$$('[role="status"]').getElements();
      return (await statuses.map((status) => status.getText())).some((text) =>
        text.includes("Kotlin JVM declaration whose source has no qualified mapping"),
      );
    }, { timeout: 30_000, interval: 100, timeoutMsg: "F12 did not explain the unavailable Kotlin destination" });
    const refusal = await this.browser().execute(() => {
      const history = JSON.parse(document.body.getAttribute("data-java-definition-result-history") ?? "[]");
      return history.at(-1);
    });
    assert.equal(refusal?.status, "refused");
    assert.equal(refusal?.refusalCode, "java.definitionKotlinSourceUnqualified");
    assert.equal(await this.surface().tab(source).getAttribute("aria-selected"), "true");
    this.#proof.mixedJvmDefinitionRefusalCode = refusal.refusalCode;

    await this.followMixedJvmDefinition(source, savedSource, "fromJava();", "fromJava");
    const declaration = lines.findIndex((text) => text.includes("static String fromJava()"));
    const declarationColumn = lines[declaration].indexOf("fromJava") + 1;
    await this.browser().waitUntil(
      async () => (await cursor.getText()).trim() === `Ln ${declaration + 1}, Col ${declarationColumn}`,
      { timeout: 30_000, interval: 100, timeoutMsg: "F12 did not reveal the Java control declaration" },
    );
    await this.surface().assertBuffer(source, savedSource);
    await this.assertSavedExecutionDraft();
    this.#proof.mixedJvmJavaDefinitionRevealed = true;
  }
  async cleanAndRebuildSynchronizedModule() {
    const tool = this.#executionTool;
    const resynchronize = async () => {
      await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
      if (tool === "maven") await this.synchronizeMaven();
      else {
        await this.synchronizeGradle(true);
        await this.evaluateGradle(false);
      }
      await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    };
    await resynchronize();
    await this.configureSynchronizedExecution();
    const picker = this.executionPanel().$("label=Synchronized module and source set").$("select");
    const selected = await picker.getValue();
    assert.ok(selected, "Clean requires an explicit synchronized module selection");
    const beforeInputs = new Map<string, string>();
    for (const file of this.#inputs.keys()) beforeInputs.set(file, await readFile(this.file(file), "utf8"));
    const compiled = `${tool}/app/${tool === "maven" ? "target/classes" : "build/classes/java/main"}/pkg/Runner.class`;
    const generated = `${tool}/app/${tool === "maven" ? "target/generated-sources/annotations" : "build/generated/sources/annotationProcessor/java/main"}/generated/GeneratedGreeting.java`;
    await access(this.file(compiled));
    await access(this.file(generated));
    await this.requestProjectExecution("Clean build outputs");
    await this.waitProjectExecution("clean", "succeeded");
    await assert.rejects(access(this.file(compiled)), { code: "ENOENT" });
    await assert.rejects(access(this.file(generated)), { code: "ENOENT" });
    const cleanOutput = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(!cleanOutput.includes("JAVA_REFERENCE_OK:"), "Clean must not run the application");
    this.#proof.synchronizedModuleCleanRemovedOutputs = true;
    for (const [file, content] of beforeInputs) assert.equal(await readFile(this.file(file), "utf8"), content, `Clean changed ${file}`);
    await resynchronize();
    assert.equal(await picker.getValue(), selected, "Resynchronizing after Clean must preserve the selected provider/module/source set");
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    const bytes = await readFile(this.file(compiled));
    assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    assert.match(await readFile(this.file(generated), "utf8"), /class GeneratedGreeting/);
    const buildOutput = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(!buildOutput.includes("JAVA_REFERENCE_OK:"), "Build after Clean must not run the application");
    this.#proof.synchronizedModuleCleanRebuiltGeneratedSources = true;
    assert.equal(await picker.getValue(), selected);
    for (const [file, content] of beforeInputs) assert.equal(await readFile(this.file(file), "utf8"), content, `Rebuild changed ${file}`);
    this.#proof.synchronizedModuleCleanPreservedSelectionAndInputs = true;
  }
  async cleanAndRebuildGradleCompositeModule() {
    assert.equal(this.#gradleCompositeProject, true);
    await this.refreshGradleContextAfterCompositeExecution();
    await this.configureSynchronizedExecution();
    const picker = this.executionPanel().$("label=Synchronized module and source set").$("select");
    const selected = await picker.getValue();
    assert.ok(selected);
    const [provider, module, sourceSet] = JSON.parse(String(selected)) as string[];
    assert.equal(provider, "gradle-effective-v1");
    assert.ok(module.endsWith("::app"));
    assert.equal(sourceSet, "main");
    const applicationClass = this.file("gradle/app/build/classes/java/main/pkg/Runner.class");
    const libraryClass = this.file("gradle/library/build/classes/java/main/pkg/Greeter.class");
    const originalApplicationClass = await readFile(applicationClass);
    const originalLibraryClass = await readFile(libraryClass);
    const beforeInputs = new Map<string, string>();
    for (const file of this.#inputs.keys()) beforeInputs.set(file, await readFile(this.file(file), "utf8"));
    await this.requestProjectExecution("Clean build outputs", "commands");
    await this.waitProjectExecution("clean", "succeeded");
    await assert.rejects(access(applicationClass), { code: "ENOENT" });
    assert.deepEqual(await readFile(libraryClass), originalLibraryClass, "Cleaning :app must preserve the included library's compiled class");
    const cleanOutput = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(cleanOutput.includes(":app:clean"), cleanOutput);
    assert.ok(!cleanOutput.includes("GRADLE_COMPOSITE_RUN_OK:"));
    this.#proof.gradleCompositeCleanSelectedExternalModule = true;
    for (const [file, content] of beforeInputs) assert.equal(await readFile(this.file(file), "utf8"), content, `Composite Clean changed ${file}`);
    this.#proof.gradleCompositeCleanPreservedLibraryAndInputs = true;
    await this.refreshGradleContextAfterCompositeExecution();
    assert.equal(await picker.getValue(), selected, "Composite Clean must preserve the provider-qualified app selection");
    await this.requestProjectExecution("Build", "commands");
    await this.waitProjectExecution("build", "succeeded");
    const rebuilt = await readFile(applicationClass);
    assert.deepEqual(rebuilt.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    assert.equal(rebuilt.readUInt16BE(6), originalApplicationClass.readUInt16BE(6));
    assert.deepEqual(await readFile(libraryClass), originalLibraryClass);
    assert.equal(await picker.getValue(), selected);
    const buildOutput = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(!buildOutput.includes("GRADLE_COMPOSITE_RUN_OK:"));
    for (const [file, content] of beforeInputs) assert.equal(await readFile(this.file(file), "utf8"), content, `Composite rebuild changed ${file}`);
    this.#proof.gradleCompositeBuildAfterCleanSucceeded = true;
  }
  async rebuildGradleCompositeModule() {
    assert.equal(this.#gradleCompositeProject, true);
    const marker = this.file("gradle/app/build/obsolete-output.marker");
    await writeFile(marker, "Old build output for composite Rebuild qualification", { flag: "wx" });
    await this.refreshGradleContextAfterCompositeExecution();
    await this.configureSynchronizedExecution();
    const picker = this.executionPanel().$("label=Synchronized module and source set").$("select");
    const selected = await picker.getValue();
    const library = this.file("gradle/library/build/classes/java/main/pkg/Greeter.class");
    const libraryBytes = await readFile(library);
    const application = this.file("gradle/app/build/classes/java/main/pkg/Runner.class");
    const targetVersion = (await readFile(application)).readUInt16BE(6);
    const beforeInputs = new Map<string, string>();
    for (const file of this.#inputs.keys()) beforeInputs.set(file, await readFile(this.file(file), "utf8"));
    await this.requestProjectExecution("Rebuild", "commands");
    await this.waitProjectExecution("rebuild", "succeeded");
    await assert.rejects(access(marker), { code: "ENOENT" });
    const rebuilt = await readFile(application);
    assert.deepEqual(rebuilt.subarray(0, 4), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
    assert.equal(rebuilt.readUInt16BE(6), targetVersion);
    assert.deepEqual(await readFile(library), libraryBytes);
    assert.equal(await picker.getValue(), selected);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes(":app:clean"), output);
    assert.ok(!output.includes(":library:clean"), output);
    assert.ok(!output.includes("GRADLE_COMPOSITE_RUN_OK:"));
    for (const [file, content] of beforeInputs) assert.equal(await readFile(this.file(file), "utf8"), content, `Composite Rebuild changed ${file}`);
    this.#proof.gradleCompositeRebuildRemovedOldOutputAndCompiled = true;
  }
  async assertGradleCompositeRebuild() {
    assert.equal(this.#proof.gradleCompositeRebuildRemovedOldOutputAndCompiled, true);
  }
  async assertGradleCompositeCleanAndRebuild() {
    assert.equal(this.#proof.gradleCompositeCleanSelectedExternalModule, true);
    assert.equal(this.#proof.gradleCompositeCleanPreservedLibraryAndInputs, true);
    assert.equal(this.#proof.gradleCompositeBuildAfterCleanSucceeded, true);
  }
  async assertSynchronizedCleanAndRebuild() {
    assert.equal(this.#proof.synchronizedModuleCleanRemovedOutputs, true);
    assert.equal(this.#proof.synchronizedModuleCleanRebuiltGeneratedSources, true);
    assert.equal(this.#proof.synchronizedModuleCleanPreservedSelectionAndInputs, true);
  }
  async startCustomGradleIntegrationBuild() {
    assert.equal(this.#customGradleTestSourceSet, true);
    await this.configureSynchronizedExecution("integrationTest", "pkg.IntegrationRunner");
    await this.requestProjectExecution("Build");
  }
  async assertCustomGradleIntegrationBuild() {
    await this.waitProjectExecution("build", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /BUILD SUCCESSFUL/);
    assert.match(output, /:app:integrationTestClasses/);
    await access(
      this.file("gradle/app/build/classes/java/integrationTest/pkg/IntegrationRunner.class"),
    );
    this.#proof.customGradleSourceSetBuildTaskRan = true;
  }
  async refreshGradleContextAfterCustomSourceExecution() {
    assert.equal(this.#customGradleTestSourceSet, true);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.panel().$("button=Synchronize project").click();
    await this.waitForText("Effective Java project context synchronized.");
  }
  async startCustomGradleIntegrationApplication() {
    assert.equal(this.#customGradleTestSourceSet, true);
    await this.configureSynchronizedExecution("integrationTest", "pkg.IntegrationRunner");
    await this.requestProjectExecution("Run");
  }
  async assertCustomGradleIntegrationApplication() {
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /BUILD SUCCESSFUL/);
    assert.ok(
      output.includes(
        "INTEGRATION_SOURCE_SET_OK:hello JVM|count:2|generated-greeting|runtime-token|main-peer",
      ),
      output,
    );
    assert.ok(output.includes("PROJECT_GUI_JDK:" + this.executionSdk()), output);
    await access(
      this.file("gradle/app/build/classes/java/integrationTest/pkg/IntegrationRunner.class"),
    );
    this.#proof.customGradleSourceSetApplicationRan = true;
  }
  async startCustomGradleIntegrationDiscovery() {
    assert.equal(this.#customGradleTestSourceSet, true);
    await this.configureSynchronizedExecution("integrationTest");
    await this.requestProjectExecution("Discover tests");
  }
  async assertCustomGradleIntegrationDiscovery() {
    await this.waitProjectExecution("discover", "succeeded");
    const discovery = this.executionPanel().$('[aria-label="Discovered Java tests"]');
    await discovery.scrollIntoView();
    assert.ok(
      (await discovery.getText()).includes("Discovery: ready. 1 classes, 1 method-name groups."),
    );
    assert.equal(
      await discovery
        .$('[aria-label="Run method group pkg.IntegrationRunnerTest#selectedTaskRan"]')
        .isEnabled(),
      true,
    );
    await access(
      this.file("gradle/app/build/classes/java/integrationTest/pkg/IntegrationRunnerTest.class"),
    );
    await assert.rejects(access(this.file("gradle/app/custom-gradle-test-proof.txt")), {
      code: "ENOENT",
    });
    await this.assertSavedExecutionDraft();
    this.#proof.customGradleSourceSetDiscoveryReady = true;
    this.#proof.customGradleSourceSetDiscoveryDidNotRunTests = true;
  }
  async startCustomGradleIntegrationDebugging() {
    assert.equal(this.#customGradleTestSourceSet, true);
    const source = "gradle/app/src/integrationTest/java/pkg/IntegrationRunner.java";
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    const parts = source.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folder = this.browser().$(
        `[role="treeitem"][data-path="${parts.slice(0, index).join("/")}"]`,
      );
      await folder.waitForDisplayed({ timeout: 5_000 });
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    }
    await this.surface().open(source, this.originalSource(source));
    const execution = this.executionPanel();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const modules = execution.$("label=Synchronized module and source set").$("select");
    await modules.selectByVisibleText(this.synchronizedModuleLabel("app", "integrationTest"));
    await pasteNativeText(
      this.#app!,
      execution.$('input[placeholder="com.example.Main"]'),
      "pkg.IntegrationRunner",
    );
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    const breakpointLine = this.customGradleIntegrationBreakpointLine();
    await this.clickProjectSourceBreakpoint(source, breakpointLine);
    const savedBreakpoints = execution.$('[aria-label="Saved Java source breakpoints"]');
    await this.browser().waitUntil(
      async () =>
        (await savedBreakpoints.isExisting()) &&
        (await savedBreakpoints.getText()).includes("IntegrationRunner.java:" + breakpointLine),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "The integrationTest source breakpoint was not saved before Debug",
      },
    );
    const trust = execution.$("label*=I trust this workspace").$("input");
    assert.equal(await trust.isSelected(), false);
    assert.equal(await execution.$("button=Debug").isEnabled(), false);
    await trust.click();
    await execution.$("button=Debug").waitForEnabled({ timeout: 10_000 });
    await execution.$("button=Debug").click();
    this.#proof.synchronizedModuleDebugSavedDraft = true;
  }
  async assertCustomGradleIntegrationDebugEntry() {
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    const source = "gradle/app/src/integrationTest/java/pkg/IntegrationRunner.java";
    const breakpointLine = this.customGradleIntegrationBreakpointLine();
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.surface().assertDirty(source, false);
    await access(
      this.file("gradle/app/build/classes/java/integrationTest/pkg/IntegrationRunner.class"),
    );
    await assert.rejects(access(this.file(this.projectDebugPidFile())), { code: "ENOENT" });
    assert.ok(
      (
        await this.executionPanel().$('[aria-label="Saved Java source breakpoints"]').getText()
      ).includes("IntegrationRunner.java:" + breakpointLine),
    );
  }
  async assertCustomGradleIntegrationDebugBreakpoint() {
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)");
    const source = "gradle/app/src/integrationTest/java/pkg/IntegrationRunner.java";
    const line = this.customGradleIntegrationBreakpointLine();
    const execution = this.executionPanel();
    const debuggerText = await execution.$('[aria-label="Structured Java debugger"]').getText();
    const normalizedDebuggerText = debuggerText.replaceAll("/", ".").replace(/\s+/gu, " ");
    assert.ok(normalizedDebuggerText.includes("pkg.IntegrationRunner.main"), debuggerText);
    assert.ok(normalizedDebuggerText.includes("IntegrationRunner.java:" + line), debuggerText);
    await this.surface().focus(source);
    await this.browser().$(".monaco-editor .java-debug-breakpoint-verified").waitForDisplayed({
      timeout: 5_000,
    });
    await this.browser().waitUntil(
      async () =>
        this.browser().execute((number: number) => {
          const editor = document.querySelector(".monaco-editor");
          const marker = editor?.querySelector(".java-debug-execution-line");
          const label = Array.from(
            editor?.querySelectorAll(".margin-view-overlays .line-numbers") ?? [],
          ).find((item) => item.textContent?.trim() === String(number));
          return (
            !!marker &&
            !!label &&
            Math.abs(label.getBoundingClientRect().top - marker.getBoundingClientRect().top) < 2
          );
        }, line),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "JDI did not reveal the integrationTest source line",
      },
    );
    const output = await execution.$('[aria-label="Java console output"]').getText();
    assert.doesNotMatch(output, /INTEGRATION_SOURCE_SET_OK:/);
    const pid = Number(await readFile(this.file(this.projectDebugPidFile()), "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1, "the suspended debuggee did not write its PID");
    this.#projectDebugProcesses.push(
      await captureOwnedApplication(pid, {
        executable: await realpath(path.join(this.executionSdk(), "bin/java")),
        sandbox: this.#lease!.runnerSandbox,
        workspace: this.#lease!.paths.workspace,
        ideHome: this.#lease!.paths.ideHome,
      }),
    );
    this.#proof.customGradleSourceSetDebugStoppedOnSource = true;
  }
  async assertCustomGradleIntegrationDebugCompleted() {
    await this.waitProjectExecution("debug", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /BUILD SUCCESSFUL/);
    assert.ok(
      output.includes(
        "INTEGRATION_SOURCE_SET_OK:hello JVM|count:2|generated-greeting|runtime-token|main-peer",
      ),
      output,
    );
    assert.ok(output.includes("PROJECT_GUI_JDK:" + this.executionSdk()), output);
    for (const process of this.#projectDebugProcesses)
      await assert.rejects(access("/proc/" + process.pid), { code: "ENOENT" });
    await unlink(this.file(this.projectDebugPidFile()));
    await assert.rejects(access(this.file(this.projectDebugPidFile())), { code: "ENOENT" });
    const source = "gradle/app/src/integrationTest/java/pkg/IntegrationRunner.java";
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    await this.surface().assertDirty(source, false);
    await this.assertSavedExecutionDraft();
    this.#proof.customGradleSourceSetDebugProcessesExited = true;
    this.#proof.realGradleBuild = true;
  }
  async saveExecutionDraftBeforeProjectSync() {
    const source = this.executionSource();
    await this.surface().focus(source);
    await this.browser().keys(["Control", "s"]);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(source), "utf8")) === ` ${this.originalSource(source)}`,
      { timeout: 5_000, interval: 50 },
    );
    await this.surface().assertDirty(source, false);
    this.#executionDraftSavedBeforeProjectSync = true;
  }
  async saveExecutionDraftBeforeGradleSyncWhenNeeded() {
    if (this.#executionTool === "gradle") await this.saveExecutionDraftBeforeProjectSync();
  }
  private synchronizedModuleLabel(moduleName: string, sourceSetId: string, compositeRoot = "gradle/included-build") {
    const provider = this.#executionTool === "maven" ? "Maven" : "Gradle";
    const identity =
      this.#gradleCompositeProject && moduleName === "app" ? ` [${compositeRoot} :app]` : "";
    return `${provider} · ${moduleName} / ${sourceSetId}${identity}`;
  }
  private projectSourceSetLabel(
    moduleName: string,
    sourceSetId: string,
    kind: string,
    providerLabel = this.#executionTool === "maven" ? "Maven" : "Gradle",
  ) {
    const identity =
      this.#gradleCompositeProject && moduleName === "app" && providerLabel === "Gradle"
        ? " [gradle/included-build :app]"
        : "";
    return `${providerLabel} · ${moduleName} · ${kind} (${sourceSetId})${identity}`;
  }
  async startSynchronizedModuleDebugging(entry: "panel" | "commands" = "panel", breakpointLine = this.projectDebuggerBreakpointLine()) {
    const source = this.executionSource();
    const execution = this.executionPanel();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const modules = execution.$("label=Synchronized module and source set").$("select");
    const options = await modules.$$("option").getElements();
    let selectedIndex: number | undefined;
    const reportedIdentities: [string, string, string][] = [];
    let index = 0;
    for (const option of options) {
      const optionIndex = index++;
      const value = await option.getAttribute("value");
      if (!value) continue;
      let identity: [string, string, string];
      try {
        identity = JSON.parse(value) as [string, string, string];
      } catch {
        continue;
      }
      reportedIdentities.push(identity);
      const [providerId, moduleId, sourceSetId] = identity;
      const expectedProvider =
        this.#executionTool === "maven"
          ? providerId === "maven-effective-v1"
          : providerId.startsWith("gradle-");
      const expectedModule = this.#gradleCompositeProject
        ? providerId === "gradle-effective-v1" && moduleId.endsWith("::app")
        : this.#executionTool === "maven"
          ? moduleId === "app"
          : moduleId === "app" || moduleId === ":app";
      if (expectedProvider && expectedModule && sourceSetId === "main") {
        selectedIndex = optionIndex;
        break;
      }
    }
    assert.notEqual(
      selectedIndex,
      undefined,
      `Java Run did not report the synchronized ${this.#executionTool} app/main identity; options: ${JSON.stringify(reportedIdentities)}`,
    );
    await modules.selectByIndex(selectedIndex!);
    const selectedValue = await modules.getValue();
    assert.ok(selectedValue, "Java Run selected manual configuration before Debug");
    const selectedIdentity = JSON.parse(selectedValue) as [string, string, string];
    assert.equal(selectedIdentity[2], "main", selectedValue);
    if (this.#gradleCompositeProject) {
      assert.equal(selectedIdentity[0], "gradle-effective-v1", selectedValue);
      assert.ok(selectedIdentity[1].endsWith("::app"), selectedValue);
    } else if (this.#executionTool === "gradle") {
      assert.ok(selectedIdentity[1] === "app" || selectedIdentity[1] === ":app", selectedValue);
    } else {
      assert.equal(selectedIdentity[1], "app", selectedValue);
    }
    await pasteNativeText(
      this.#app!,
      execution.$('input[placeholder="com.example.Main"]'),
      "pkg.Runner",
    );
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    await this.clickProjectSourceBreakpoint(source, breakpointLine);
    const savedBreakpoints = execution.$('[aria-label="Saved Java source breakpoints"]');
    await this.browser().waitUntil(
      async () =>
        (await savedBreakpoints.isExisting()) &&
        (await savedBreakpoints.getText()).includes("Runner.java:" + breakpointLine),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "The synchronized module source breakpoint was not saved before Debug",
      },
    );
    const trust = execution.$("label*=I trust this workspace").$("input");
    if (!(await trust.isSelected())) {
      if (!this.#gradleCompositeProject)
        assert.equal(await execution.$("button=Debug").isEnabled(), false);
      if (!(await execution.$("button=Debug").isEnabled())) await trust.click();
    }
    await execution.$("button=Debug").waitForEnabled({ timeout: 10_000 });
    if (entry === "commands")
      await this.invokeConfiguredExecutionCommand("Debug configured Java application");
    else await execution.$("button=Debug").click();
    this.#proof.synchronizedModuleDebugSavedDraft = true;
    await this.browser().waitUntil(
      async () => {
        const alerts = await execution.$$("[role=alert]").getElements();
        if (alerts.length)
          throw new Error(`Project Debug was refused: ${await alerts[0]!.getText()}`);
        const status = execution.$('[aria-label="Structured Java debugger"] [role="status"]');
        return (await status.isExisting()) || (await status.isDisplayed().catch(() => false));
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "Project Debug did not publish an initial JDI state",
      },
    );
  }
  async assertSynchronizedModuleDebugEntry(expectedSource = " " + this.originalSource(this.executionSource())) {
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), expectedSource);
    await this.surface().assertDirty(source, false);
    await access(
      this.file(
        this.#executionTool === "maven"
          ? "maven/app/target/classes/pkg/Runner.class"
          : "gradle/app/build/classes/java/main/pkg/Runner.class",
      ),
    );
    await assert.rejects(access(this.file(this.projectDebugPidFile())), {
      code: "ENOENT",
    });
    assert.ok(
      (
        await this.executionPanel().$('[aria-label="Saved Java source breakpoints"]').getText()
      ).includes("Runner.java:" + this.projectDebuggerBreakpointLine()),
    );
  }
  async continueSynchronizedModuleDebugging() {
    const button = this.executionPanel()
      .$('[aria-label="Structured Java debugger"]')
      .$("button=Continue");
    await button.waitForEnabled({ timeout: 5_000 });
    await button.click();
  }
  async reloadSynchronizedModuleClassFromProjectOutput() {
    const execution = this.executionPanel();
    const panel = execution.$('[aria-label="Java class reload"]');
    await panel.$("button=Refresh loaded JVM classes").click();
    await this.browser().waitUntil(
      async () =>
        this.browser().execute(() => {
          const panel = document.querySelector<HTMLElement>('[aria-label="Java class reload"]');
          const loaded = Array.from(
            document.querySelectorAll<HTMLOptionElement>(
              'select[aria-label="Prepared JVM class 1"] option',
            ),
          ).some((option) => option.value === "pkg.Runner");
          return (
            loaded && !!panel?.innerText.includes("prepared class names were read from this JVM")
          );
        }),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg:
          "The synchronized debuggee did not publish pkg.Runner in its prepared class list",
      },
    );
    await panel.$('[aria-label="Prepared JVM class 1"]').selectByAttribute("value", "pkg.Runner");
    assert.equal(await panel.$("label=Class name 1").$("input").getValue(), "pkg.Runner");

    const expectedOutput =
      this.#executionTool === "maven"
        ? "maven/app/target/classes/pkg/Runner.class"
        : "gradle/app/build/classes/java/main/pkg/Runner.class";
    const outputOptions = await this.browser().execute(() => {
      const options = Array.from(
        document.querySelectorAll<HTMLOptionElement>("datalist[id^='java-class-output-'] option"),
      );
      return options.map((option) => option.value);
    });
    const suggestedOutput = outputOptions.find((output) => output.endsWith(expectedOutput));
    assert.ok(
      suggestedOutput,
      `the synchronized ${this.#executionTool} app output was not suggested for pkg.Runner; options: ${JSON.stringify(outputOptions)}`,
    );
    const selectedOutput = suggestedOutput;
    await access(this.file(selectedOutput));
    const classFile = panel.$("label=Compiled file 1").$("input");
    await pasteNativeText(this.#app!, classFile, selectedOutput);
    assert.equal(await classFile.getValue(), selectedOutput);
    await panel.$("button=Reload compiled classes").click();
    await this.browser().waitUntil(
      async () =>
        this.browser()
          .execute(
            () =>
              document.querySelector<HTMLElement>('[aria-label="Java class reload"]')?.innerText ??
              "",
          )
          .then((text) => text.includes("Class reload: applied (pkg.Runner)")),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: `HotSwap did not apply the synchronized ${this.#executionTool} Runner output`,
      },
    );
  }
  #reviewedProjectSource: string | null = null;
  async reviewSynchronizedModuleClassChanges() {
    const source = this.executionSource();
    const original = ` ${this.originalSource(source)}`;
    const replacement = original.replace(
      "+ Peer.value();",
      '+ Peer.value() + "|reviewed-hotswap";',
    );
    assert.notEqual(replacement, original);
    await this.surface().tab(source).click();
    await this.surface().focus(source);
    await pasteNativeText(
      this.#app!,
      this.browser().$(`[role="textbox"][aria-label="Code editor for ${source}"]`),
      replacement,
      {
        focus: () => this.surface().focus(source),
        verify: async () => {
          await this.surface().assertBuffer(source, replacement, this.completeEditorReadBack());
          return true;
        },
      },
    );
    await this.surface().save(source);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(source), "utf8")) === replacement,
      { timeout: 10_000, interval: 100 },
    );
    this.#reviewedProjectSource = replacement;
    const panel = this.executionPanel().$('[aria-label="Java class reload"]');
    await panel.$("button=Build and review changed classes").waitForEnabled({ timeout: 10_000 });
    await panel.$("button=Build and review changed classes").click();
    const changes = panel.$('[aria-label="Changed compiled classes"]');
    const expectedOutput =
      this.#executionTool === "maven"
        ? "maven/app/target/classes/pkg/Runner.class"
        : "gradle/app/build/classes/java/main/pkg/Runner.class";
    try {
      await this.browser().waitUntil(
        async () =>
          (await changes.isExisting()) && (await changes.getText()).includes(expectedOutput),
        { timeout: 60_000, interval: 100 },
      );
    } catch (error) {
      throw new Error(
        `Changed-class review was unavailable: ${(await this.executionPanel().getText()).slice(-6500)}`,
        { cause: error },
      );
    }
    this.#proof.synchronizedModuleCompiledChangesReviewed = true;
    await changes.$("button=Use changed classes").waitForEnabled({ timeout: 5_000 });
    await changes.$("button=Use changed classes").click();
    assert.equal(await panel.$("label=Compiled file 1").$("input").getValue(), expectedOutput);
    const previousReload = await panel
      .$('[aria-label="Java class reload result"]')
      .getAttribute("data-request-id");
    await panel.$("button=Reload compiled classes").click();
    await this.browser().waitUntil(
      async () =>
        await this.browser().execute((previous) => {
          const result = document.querySelector<HTMLElement>(
            '[aria-label="Java class reload result"]',
          );
          return (
            result?.dataset.requestId !== previous &&
            result?.innerText.includes("Class reload: applied (pkg.Runner)")
          );
        }, previousReload),
      { timeout: 10_000, interval: 100 },
    );
    this.#proof.synchronizedModuleCompiledChangesApplied = true;
  }
  async assertSynchronizedModuleClassReloaded() {
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)");
    const classReloadText = await this.browser().execute(
      () =>
        document.querySelector<HTMLElement>('[aria-label="Java class reload"]')?.innerText ?? "",
    );
    assert.ok(classReloadText.includes("Class reload: applied (pkg.Runner)"), classReloadText);
    this.#proof.synchronizedModuleHotSwapUsedProjectOutput = true;
    this.#proof.synchronizedModuleHotSwapUsedProjectSuggestion = true;
  }
  async assertSynchronizedModuleDebugBreakpoint() {
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)");
    const execution = this.executionPanel();
    const line = this.projectDebuggerBreakpointLine();
    const debuggerText = await execution.$('[aria-label="Structured Java debugger"]').getText();
    const normalizedDebuggerText = debuggerText.replaceAll("/", ".").replace(/\s+/gu, " ");
    assert.ok(normalizedDebuggerText.includes("pkg.Runner.main"), debuggerText);
    assert.ok(normalizedDebuggerText.includes("pkg.Runner.java:" + line), debuggerText);
    await this.browser().$(".monaco-editor .java-debug-breakpoint-verified").waitForDisplayed({
      timeout: 5_000,
    });
    await this.browser().waitUntil(
      async () =>
        this.browser().execute((number: number) => {
          const editor = document.querySelector(".monaco-editor");
          const marker = editor?.querySelector(".java-debug-execution-line");
          const label = Array.from(
            editor?.querySelectorAll(".margin-view-overlays .line-numbers") ?? [],
          ).find((item) => item.textContent?.trim() === String(number));
          return (
            !!marker &&
            !!label &&
            Math.abs(label.getBoundingClientRect().top - marker.getBoundingClientRect().top) < 2
          );
        }, line),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: "JDI did not reveal the synchronized source line",
      },
    );
    const output = await execution.$('[aria-label="Java console output"]').getText();
    assert.doesNotMatch(
      output,
      this.#gradleCompositeProject ? /GRADLE_COMPOSITE_RUN_OK:/ : /JAVA_REFERENCE_OK:/,
    );
    const pid = Number(await readFile(this.file(this.projectDebugPidFile()), "utf8"));
    assert.ok(
      Number.isSafeInteger(pid) && pid > 1,
      "the suspended project debuggee did not write its PID",
    );
    this.#projectDebugProcesses.push(
      await captureOwnedApplication(pid, {
        executable: await realpath(path.join(this.executionSdk(), "bin/java")),
        sandbox: this.#lease!.runnerSandbox,
        workspace: this.#lease!.paths.workspace,
        ideHome: this.#lease!.paths.ideHome,
      }),
    );
    this.#proof.synchronizedModuleDebugStoppedOnSource = true;
    if (this.#gradleCompositeProject)
      this.#proof.gradleCompositeApplicationDebugStoppedOnSource = true;
  }
  async restartSynchronizedModuleDebugging() {
    await this.surface().tab(this.executionSource()).click();
    const execution = this.executionPanel();
    const saved = execution.$('[aria-label="Saved Java source breakpoints"]');
    await this.browser().waitUntil(
      async () => (await saved.getText()).includes("has one matching source context"),
      { timeout: 10_000, interval: 100 },
    );
    await saved.$("button=Rebind active file").click();
    await this.browser().waitUntil(
      async () => !(await saved.getText()).includes("has one matching source context"),
      { timeout: 10_000, interval: 100 },
    );
    const alerts = await saved.$$('[role="alert"]').getElements();
    assert.equal(alerts.length, 0, alerts.length ? await alerts[0]!.getText() : "");
    const previousPid = this.#projectDebugProcesses.at(-1)!.pid;
    await execution.$("button=Rerun session").waitForEnabled({ timeout: 5_000 });
    await execution.$("button=Rerun session").click();
    await this.waitForProjectDebuggerStatus("suspended (entry)");
    await this.continueSynchronizedModuleDebugging();
    await this.assertSynchronizedModuleDebugBreakpoint();
    assert.notEqual(this.#projectDebugProcesses.at(-1)!.pid, previousPid);
    await this.continueSynchronizedModuleDebugging();
    await this.assertSynchronizedModuleDebugCompleted();
    this.#proof.synchronizedModuleCapturedSessionRestarted = true;
  }
  async assertSynchronizedModuleDebugCompleted(
    expectedSource = this.#reviewedProjectSource ?? " " + this.originalSource(this.executionSource()),
  ) {
    await this.waitProjectExecution("debug", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    if (!this.#gradleCompositeProject)
      assert.ok(
        output.includes(this.#executionTool === "maven" ? "BUILD SUCCESS" : "BUILD SUCCESSFUL"),
        output,
      );
    assert.ok(
      output.includes(
        this.#gradleCompositeProject
          ? "GRADLE_COMPOSITE_RUN_OK:included-build"
          : "JAVA_REFERENCE_OK:hello JVM|count:2|generated-greeting|runtime-token|main-peer|",
      ),
      output,
    );
    assert.ok(output.includes("PROJECT_GUI_JDK:" + this.executionSdk()), output);
    if (this.#proof.synchronizedModuleCompiledChangesApplied)
      assert.ok(output.includes("main-peer|reviewed-hotswap|"), output);
    for (const process of this.#projectDebugProcesses)
      await assert.rejects(access("/proc/" + process.pid), { code: "ENOENT" });
    await unlink(this.file(this.projectDebugPidFile()));
    await assert.rejects(access(this.file(this.projectDebugPidFile())), {
      code: "ENOENT",
    });
    assert.equal(
      await readFile(this.file(this.executionSource()), "utf8"),
      expectedSource,
    );
    await this.surface().assertDirty(this.executionSource(), false);
    this.#proof.synchronizedModuleDebugRuntimeDependencies = true;
    this.#proof.synchronizedModuleDebugProcessesExited = true;
    if (this.#gradleCompositeProject) this.#proof.gradleCompositeApplicationDebugCompleted = true;
    if (this.#executionTool === "maven") this.#proof.realMavenBuild = true;
    else this.#proof.realGradleBuild = true;
  }
  private async configureSynchronizedExecution(
    sourceSetId = "main",
    mainClass = "pkg.Runner",
    moduleName = "app",
    compositeRoot = "gradle/included-build",
  ) {
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const execution = this.browser().$('section[aria-label="Java execution"]');
    await execution.waitForDisplayed({ timeout: 5000 });
    const modules = execution.$("label=Synchronized module and source set").$("select");
    const options = await modules.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    if (this.#gradleKotlinDslProject) {
      const expectedLibrary = this.synchronizedModuleLabel("library", "main");
      assert.ok(
        labels.some(
          (label) => label === expectedLibrary || label.startsWith(`${expectedLibrary} [`),
        ),
        `Gradle Kotlin DSL library module unavailable: ${labels.join(", ")}`,
      );
    }
    const selected =
      this.#executionTool === "maven" && sourceSetId === "integrationTest"
        ? labels.find((label) => label.startsWith(`Maven · ${moduleName} / integration-test (`))
        : this.synchronizedModuleLabel(moduleName, sourceSetId, compositeRoot);
    const displayedSelection =
      selected && labels.find((label) => label === selected || label.startsWith(`${selected} [`));
    assert.ok(displayedSelection, `Synchronized ${selected} unavailable: ${labels.join(", ")}`);
    const option = options[labels.indexOf(displayedSelection)]!;
    const expectedSelection = await option.getAttribute("value");
    assert.ok(expectedSelection, `Synchronized ${displayedSelection} has no option value`);
    if (this.#gradleCompositeProject) {
      const [provider, module, sourceSet] = JSON.parse(expectedSelection) as [string, string, string];
      assert.equal(provider, "gradle-effective-v1");
      assert.ok(module.endsWith(`::${moduleName}`), module);
      assert.equal(sourceSet, sourceSetId);
    }
    await modules.selectByVisibleText(displayedSelection);
    await pasteNativeText(
      this.#app!,
      execution.$('input[placeholder="com.example.Main"]'),
      mainClass,
    );
    const trust = execution.$("label*=I trust this workspace").$("input");
    if (!(await trust.isSelected())) {
      assert.equal(await execution.$("button=Run").isEnabled(), false);
      await trust.click();
    }
    await this.browser().waitUntil(
      async () =>
        (await modules.getValue()) === expectedSelection &&
        !(await execution.getText()).includes(
          "The saved module or source set is not present in the current Java Project context.",
        ),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `The selected ${moduleName}/${sourceSetId} did not remain available in Java Run`,
      },
    );
  }
  async debugFailedTestsAfterRepair() {
    assert.equal(this.#failedTestDebugFixture, true);
    const tool = this.#executionTool;
    const origin = this.#failedTestDebugOrigin;
    const framework = this.#failedTestDebugFramework;
    const wholeClass = false;
    const qualifier = framework === "junit4" ? `${origin}-${tool}` : `${framework}-${origin}-${tool}${this.#inheritedDefaultTestMethod ? "-interface-default" : ""}`;
    // Fixture expectations describe XML display labels, never selectors sent to the IDE.
    const reportNames = (names: string[]) => names.map((name) => framework === "jupiter" && tool === "gradle"
      ? `${name === "firstFailure" ? "alreadyPassed" : name === "alreadyPassed" ? "secondFailure" : name}()` : name).sort();
    const source = this.executionSource();
    const saved = ` ${this.originalSource(source)}`;
    const repaired = `// Repaired in the native editor\n\n${saved.replace("broken = true", "broken = false")}`;
    assert.notEqual(repaired, saved);
    await this.configureSynchronizedExecution("test");
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", origin === "test" ? "jdb" : "jdi");
    await this.waitForSourceDebuggerReady();
    await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'), "pkg.RunnerTest");
    const firstAction = execution.$(origin === "test" ? "button=Run tests" : "button=Debug test");
    await firstAction.waitForEnabled({ timeout: 10_000 });
    await firstAction.click();
    if (origin === "debug-test") {
      await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
      await execution.$('[aria-label="Structured Java debugger"]').$("button=Continue").click();
    }
    await this.waitProjectExecution(origin, "failed", tool === "gradle" ? 60_000 : undefined);
    await this.assertTestSummary(3, 1, 2);
    const result = this.file(`${tool}/app/target/failed-debug-results.txt`);
    const passed = this.file(`${tool}/app/target/already-passed.txt`);
    const pidFile = this.file(`${tool}/app/target/failed-debug.pid`);
    await assert.rejects(access(result), { code: "ENOENT" });
    assert.equal(await readFile(passed, "utf8"), "once\n");
    const firstPid = Number(await readFile(pidFile, "utf8"));
    assert.ok(Number.isSafeInteger(firstPid) && firstPid > 1);
    await this.browser().waitUntil(async () => access(`/proc/${firstPid}`).then(() => false, () => true), { timeout: 5_000, interval: 100 });
    const relativeReport = `${tool}/app/${tool === "maven" ? "target/surefire-reports" : "build/test-results/test"}/TEST-pkg.RunnerTest.xml`;
    const readReport = async () => {
      const file = this.file(relativeReport);
      assert.equal(await realpath(file), file);
      const before = await readFile(file);
      assert.ok(before.length <= 128 * 1024);
      const { stdout } = await promisify(execFile)("/usr/bin/python3", ["-c", `import json, sys, xml.etree.ElementTree as ET
with open(sys.argv[1], 'rb') as f: raw=f.read(131073)
assert len(raw)<=131072 and b'<!DOCTYPE' not in raw and b'<!ENTITY' not in raw
root=ET.fromstring(raw)
assert root.tag=='testsuite' and root.get('name')=='pkg.RunnerTest'
cases=root.findall('testcase')
assert all(c.get('classname')=='pkg.RunnerTest' for c in cases)
print(json.dumps({'tests':int(root.get('tests')), 'failures':int(root.get('failures','0')), 'errors':int(root.get('errors','0')), 'skipped':int(root.get('skipped','0')), 'methods':sorted(c.get('name') for c in cases), 'failedMethods':sorted(c.get('name') for c in cases if c.find('failure') is not None or c.find('error') is not None)}))`, file], { timeout: 5_000, maxBuffer: 8192 });
      assert.deepEqual(await readFile(file), before);
      return { ...JSON.parse(stdout) as { tests: number; failures: number; errors: number; skipped: number; methods: string[]; failedMethods: string[] }, sha256: createHash("sha256").update(before).digest("hex") };
    };
    const initialReport = await readReport();
    if (framework === "junit4") await this.assertMavenDependencyTestsSkipped();
    if (this.#javaRelease === 27) {
      const classes = tool === "maven" ? "target/test-classes" : "build/classes/java/test";
      const compiled = await readFile(this.file(`${tool}/app/${classes}/pkg/RunnerTest.class`));
      assert.equal(compiled.readUInt32BE(0), 0xcafebabe);
      assert.equal(compiled.readUInt16BE(6), 71);
    }
    let runnerMethods: string[] | null = null;
    let runnerMethodDeclaration: { method: string; path: string; reportedName: string; line: number; column: number } | null = null;
    if (tool === "gradle" && framework === "jupiter") {
      await this.authorizeGradleImportForJdtLs();
      await this.startExecutionLanguageService();
      const labels = await execution.$$('[aria-label^="Runner method for "]').getElements();
      runnerMethods = [];
      for (const label of labels) {
        assert.equal(await label.isDisplayed(), true);
        runnerMethods.push(await label.getText());
      }
      assert.deepEqual(runnerMethods.sort(), ["alreadyPassed", "firstFailure", "secondFailure"].map((method) => `Method: pkg.RunnerTest#${method}`).sort());
      const cases = await execution.$$("details").getElements();
      let openedPassingMethod = false;
      for (const test of cases) {
        const summary = test.$("summary");
        if (!(await summary.getText()).startsWith("passed: pkg.RunnerTest")) continue;
        await summary.click();
        assert.equal(await test.$('[aria-label="Test method declaring class"]').getText(), "Declared in: pkg.BaseChecks");
        const openSource = test.$('button[aria-label="Open source for pkg.RunnerTest test secondFailure()"]');
        await openSource.waitForDisplayed({ timeout: 5_000 });
        await openSource.click();
        const declarationPath = "gradle/library/src/main/java/pkg/BaseChecks.java";
        const declarationText = this.originalSource(declarationPath);
        const lines = declarationText.split("\n");
        const index = lines.findIndex((line) => line.includes("void alreadyPassed("));
        assert.ok(index > 0);
        const column = lines[index]!.indexOf("alreadyPassed") + 1;
        const host = this.browser().$('[data-testid="monaco-code-editor-host"]');
        const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
        await this.browser().waitUntil(async () =>
          await host.getAttribute("data-reveal-requested-line") === String(index + 1) &&
          await host.getAttribute("data-editor-cursor-line") === String(index + 1) &&
          (await cursor.getText()).trim() === `Ln ${index + 1}, Col ${column}`,
          { timeout: 10_000, interval: 50, timeoutMsg: "The passing result did not reveal its runner method declaration" }).catch(async (error) => {
            const status = await execution.$('[aria-label="Java test results"]').getText();
            throw new Error(`Method declaration navigation failed. Test results: ${status.slice(-4000)}`, { cause: error });
          });
        assert.equal(await this.surface().tab(declarationPath).getAttribute("aria-selected"), "true");
        await this.surface().assertBuffer(declarationPath, declarationText, this.completeEditorReadBack());
        await this.surface().assertDirty(declarationPath, false);
        assert.equal(await readFile(this.file(declarationPath), "utf8"), declarationText);
        runnerMethodDeclaration = { method: "pkg.BaseChecks#alreadyPassed", path: declarationPath, reportedName: "secondFailure()", line: index + 1, column };
        openedPassingMethod = true;
        break;
      }
      assert.equal(openedPassingMethod, true);
    }
    assert.deepEqual(initialReport.methods, reportNames(["alreadyPassed", "firstFailure", "secondFailure"]));
    assert.deepEqual(initialReport.failedMethods, reportNames(["firstFailure", "secondFailure"]));
    const selectionPreview = execution.$('[aria-label="Java failed-test selections"]');
    await selectionPreview.waitForDisplayed({ timeout: 5_000 });
    await selectionPreview.scrollIntoView();
    const preview = await selectionPreview.getText();
    if (wholeClass) {
      assert.ok(preview.includes("pkg.RunnerTest — whole class"), preview);
      assert.ok(preview.includes("previously passing or skipped"), preview);
    } else {
      assert.ok(preview.includes("pkg.RunnerTest#firstFailure") && preview.includes("pkg.RunnerTest#secondFailure"), preview);
      assert.ok(!preview.includes("whole class"), preview);
    }
    const replaceAndSave = async (before: string, after: string) => {
      await this.surface().tab(source).click();
      await this.surface().assertDirty(source, false);
      assert.equal(await readFile(this.file(source), "utf8"), before);
      await pasteNativeText(this.#app!, this.browser().$(`[role="textbox"][aria-label^="Code editor for ${source}"]`), after, {
        focus: () => this.surface().focus(source),
        verify: async () => { await this.surface().assertDirty(source, true); return true; },
      });
      assert.equal(await readFile(this.file(source), "utf8"), before);
      await this.surface().assertDirty(source, true);
      await this.surface().save(source);
      await this.browser().waitUntil(async () => await readFile(this.file(source), "utf8") === after, { timeout: 10_000, interval: 100 });
      await this.surface().assertDirty(source, false);
    };
    await replaceAndSave(saved, repaired);
    const gradleReevaluatedAfterRepair = await this.synchronizeContextAfterTestRepairWhenNeeded();
    if (tool === "gradle" && framework === "jupiter")
      assert.equal(gradleReevaluatedAfterRepair, false, "A saved-source change must not lose the evaluated Gradle model");
    const failureAssertions = ["first failure", "second failure"].map((marker) => `assertEquals("${marker}"`);
    const points = failureAssertions.map((assertion) =>
      repaired.split("\n").findIndex((line) => line.includes(assertion)) + 1,
    );
    assert.ok(points.every((point) => point > 2));
    for (const assertion of failureAssertions) {
      await this.positionEditorCursorOnToken(source, repaired, assertion, "assertEquals");
      await this.browser().keys("F9");
    }
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const savedBreakpoints = execution.$('[aria-label="Saved Java source breakpoints"]');
    await this.browser().waitUntil(async () => {
      const labels = await savedBreakpoints.$$("li label").getElements();
      const actual: string[] = [];
      for (const label of labels) actual.push(await label.getText());
      return points.every((point) => actual.includes(`${source}:${point}`));
    }, { timeout: 10_000, interval: 100, timeoutMsg: "The IDE did not bind both saved breakpoints to the repaired source lines" });
    await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'), "does.not.Exist#mustNotRun");
    const rerun = execution.$('[aria-label="Java test results"]').$(origin === "test" ? "button=Debug failed tests" : "button=Rerun failed tests");
    await rerun.waitForEnabled({ timeout: 10_000 });
    await rerun.scrollIntoView();
    await rerun.click();
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    const debuggerPanel = execution.$('[aria-label="Structured Java debugger"]');
    await debuggerPanel.$("button=Continue").click();
    const observedLines: number[] = [];
    let rerunPid = 0;
    for (let index = 0; index < points.length; index++) {
      // Require two distinct current source lines, regardless of test execution order.
      await this.browser().waitUntil(async () => {
        if (!(await debuggerPanel.getText()).includes("suspended (breakpoint)")) return false;
        const frame = await debuggerPanel.$('[aria-label="Java stack frames"] button[aria-pressed="true"]').getText();
        const point = points.find((line) => frame.includes(`${path.basename(source)}:${line})`) && !observedLines.includes(line));
        if (!point) return false;
        observedLines.push(point);
        return true;
      }, { timeout: 60_000, interval: 100 });
      const rows = await debuggerPanel.$('table[aria-label="Java local variables"]').$$("tbody tr").getElements();
      let local = false;
      for (const row of rows) {
        const cells = await row.$$("td").getElements();
        if (cells.length >= 3 && await cells[0]!.getText() === "debugValue") {
          assert.equal(await cells[2]!.getText(), "41");
          local = true;
        }
      }
      assert.equal(local, true);
      const pid = Number(await readFile(pidFile, "utf8"));
      if (!rerunPid) {
        assert.notEqual(pid, firstPid);
        await this.captureTestJvm(pid);
        rerunPid = pid;
      }
      assert.equal(pid, rerunPid);
      await debuggerPanel.$("button=Continue").click();
    }
    await this.waitProjectExecution("debug-test", "succeeded");
    assert.equal(await execution.$("label=Debugger").$("select").getValue(), origin === "test" ? "jdb" : "jdi");
    await this.assertTestSummary(wholeClass ? 3 : 2, wholeClass ? 3 : 2, 0);
    assert.deepEqual((await readFile(result, "utf8")).trim().split("\n").sort(), ["first", "second"]);
    assert.equal(await readFile(passed, "utf8"), "once\n".repeat(wholeClass ? 2 : 1));
    const finalReport = await readReport();
    assert.deepEqual(finalReport.methods, reportNames(wholeClass ? ["alreadyPassed", "firstFailure", "secondFailure"] : ["firstFailure", "secondFailure"]));
    assert.deepEqual(finalReport.failedMethods, []);
    assert.equal(finalReport.tests, wholeClass ? 3 : 2);
    assert.equal(finalReport.failures + finalReport.errors + finalReport.skipped, 0);
    assert.notEqual(finalReport.sha256, initialReport.sha256);
    if (framework === "junit4") await this.assertMavenDependencyTestsSkipped();
    await this.browser().waitUntil(async () => access(`/proc/${rerunPid}`).then(() => false, () => true), { timeout: 5_000, interval: 100 });
    assert.equal(await readFile(this.file(source), "utf8"), repaired);
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `failed-test-debugger-${qualifier}-results.json`), JSON.stringify({ origin, framework, inheritedDefaultTestMethod: this.#inheritedDefaultTestMethod, testJdk: this.executionSdk(), gradleRuntimeJdk: tool === "gradle" ? this.#gradleRuntimeSdk || this.#gradleSdk : null, wholeClassFallback: wholeClass, runnerMethods, runnerMethodDeclaration, gradleReevaluatedAfterRepair, initialReport, finalReport, observedLines, testPids: [firstPid, rerunPid], allExited: true, previouslyPassingMethodNotRepeated: !wholeClass, siblingTestExcludedFromDebug: tool === "maven" && framework === "junit4" }, null, 2));
    await replaceAndSave(repaired, saved);
    this.#proof.failedTestDebuggerRerunQualified = true;
    this.#proof.failedTestDebuggerFrameworkQualified = framework === "junit4" ? null : framework;
    this.#proof.failedTestDebuggerStartedFromOrdinaryTest = origin === "test";
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
  }
  async restoreFailedTestDebugSourceAndClose() {
    assert.equal(this.#failedTestDebugFixture, true);
    await this.restoreSavedExecutionSourceAndClose();
  }
  async assertFailedTestDebugRerun() {
    assert.equal(this.#proof.failedTestDebuggerRerunQualified, true);
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
  }

  private async captureTestJvm(pid: number, sdk = this.executionSdk(), legacy = this.#javaRelease === 8): Promise<void> {
    const launchers = await Promise.all([
      path.join(sdk, "bin/java"),
      ...(legacy ? [path.join(sdk, "jre/bin/java")] : []),
    ].map((launcher) => realpath(launcher)));
    const executable = await readlink(`/proc/${pid}/exe`);
    assert.ok(launchers.includes(executable), `Unexpected test JVM executable: ${executable}`);
    await captureOwnedApplication(pid, {
      executable,
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.#lease!.paths.workspace,
      ideHome: this.#lease!.paths.ideHome,
    });
  }

  async debugSelectedTestRerunAndStop() {
    assert.equal(this.#selectedTestDebugFixture, true);
    const tool = this.#executionTool;
    const source = this.executionSource();
    const line = this.originalSource(source).split("\n").findIndex((value) => value.includes('"target/selected-test-debug-result.txt"')) + 1;
    assert.ok(line > 0);
    await this.configureSynchronizedExecution("test");
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    await this.clickProjectSourceBreakpoint(source, line);
    await this.browser().waitUntil(async () => (await execution.$('[aria-label="Saved Java source breakpoints"]').getText()).includes(`RunnerTest.java:${line}`), { timeout: 5_000, interval: 100 });
    await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'), "pkg.RunnerTest#selectedDebugTest");
    const result = this.file(`${tool}/app/target/selected-test-debug-result.txt`);
    const pidFile = this.file(`${tool}/app/target/selected-test-debug.pid`);
    await assert.rejects(access(result), { code: "ENOENT" });
    await execution.$("button=Debug test").waitForEnabled({ timeout: 10_000 });
    await execution.$("button=Debug test").click();
    const pids: number[] = [];
    for (const cycle of ["complete", "stop"] as const) {
      await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
      const debuggerPanel = execution.$('[aria-label="Structured Java debugger"]');
      const continueButton = debuggerPanel.$("button=Continue");
      await continueButton.click();
      await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 60_000);
      const locals = debuggerPanel.$('table[aria-label="Java local variables"]');
      const rows = await locals.$$("tbody tr").getElements();
      let observed = false;
      for (const row of rows) {
        const cells = await row.$$("td").getElements();
        if (cells.length >= 3 && await cells[0]!.getText() === "debugValue") {
          assert.equal(await cells[2]!.getText(), "41");
          observed = true;
        }
      }
      assert.equal(observed, true, "The selected test local was not inspected through JDI");
      this.#proof.selectedJavaTestDebuggerLocalsInspected = true;
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.ok(Number.isSafeInteger(pid) && pid > 1 && !pids.includes(pid));
      await this.captureTestJvm(pid);
      pids.push(pid);
      if (cycle === "complete") {
        await assert.rejects(access(result), { code: "ENOENT" });
        await continueButton.click();
        await this.waitProjectExecution("debug-test", "succeeded");
        await this.assertTestSummary(1, 1, 0);
        if (this.#javaRelease === 27) {
          const classPath = tool === "maven" ? "target/test-classes" : "build/classes/java/test";
          const testClass = await readFile(this.file(`${tool}/app/${classPath}/pkg/RunnerTest.class`));
          assert.equal(testClass.readUInt32BE(0), 0xcafebabe);
          assert.equal(testClass.readUInt16BE(6), 71);
        }
        assert.equal(await readFile(result, "utf8"), "42\n");
        const reportPath = tool === "maven" ? "maven/app/target/surefire-reports/TEST-pkg.RunnerTest.xml" : "gradle/app/build/test-results/test/TEST-pkg.RunnerTest.xml";
        const report = await readNativeJUnitReport(this.#lease!.paths.workspace, reportPath, "SELECTED_TEST_DEBUG_OK", "pkg.RunnerTest", "pkg.RunnerTest", "selectedDebugTest");
        assert.equal(report.failures, 0);
        await writeFile(path.join(this.#lease!.runnerArtifactPath, `selected-test-debugger-${tool}-test-report.json`), JSON.stringify(report, null, 2));
        await this.browser().waitUntil(async () => access(`/proc/${pid}`).then(() => false, () => true), { timeout: 5_000, interval: 100 });
        this.#proof.selectedJavaTestDebuggerCompleted = true;
        // A captured rerun must keep the original selector after the current form changes.
        await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'), "does.not.Exist#mustNotRun");
        await execution.$("button=Rerun session").waitForEnabled({ timeout: 5_000 });
        await execution.$("button=Rerun session").click();
      } else {
        assert.equal(await readFile(result, "utf8"), "42\n");
        await execution.$("button=Stop").click();
        await this.browser().waitUntil(async () => (await execution.getText()).includes("debug-test: stopped"), { timeout: 10_000, interval: 100 });
        await this.browser().waitUntil(async () => access(`/proc/${pid}`).then(() => false, () => true), { timeout: 5_000, interval: 100 });
        assert.equal(await readFile(result, "utf8"), "42\n");
        this.#proof.selectedJavaTestDebuggerStopped = true;
        this.#proof.selectedJavaTestDebuggerCapturedRerun = true;
      }
    }
    await writeFile(path.join(this.#lease!.runnerArtifactPath, `selected-test-debugger-${tool}-processes.json`), JSON.stringify({ selectedTestPids: pids, allExited: true }, null, 2));
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
  }
  async assertSelectedTestDebugging() {
    for (const flag of [this.#proof.selectedJavaTestDebuggerCompleted, this.#proof.selectedJavaTestDebuggerStopped, this.#proof.selectedJavaTestDebuggerCapturedRerun, this.#proof.selectedJavaTestDebuggerLocalsInspected]) assert.equal(flag, true);
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
  }

  async startSynchronizedProjectTests(entry: "panel" | "commands" = "panel") {
    assert.ok(this.#testWorkflow);
    await this.configureSynchronizedExecution();
    const execution = this.executionPanel();
    await pasteNativeText(
      this.#app!,
      execution.$('input[placeholder="com.example.MainTest#computes"]'),
      "",
    );
    await execution.$("button=Add test JVM option").click();
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Test JVM option 1").$("textarea"),
      "-Dcontext.gui.literal=value with spaces",
    );
    await execution.$("button=Add environment variable").click();
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Variable 1 name").$("input"),
      "CONTEXT_GUI_ENV",
    );
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Variable 1 value").$("textarea"),
      "literal environment",
    );
    await this.requestProjectExecution(
      this.#testWorkflow === "discover"
        ? "Discover tests"
        : this.#testWorkflow === "coverage"
          ? "Run tests with coverage"
          : "Run tests",
      entry,
    );
  }
  async startSynchronizedProjectCoverage() {
    assert.equal(this.#gradleCompositeProject, true);
    assert.equal(this.#testWorkflow, "discover");
    await this.configureSynchronizedExecution();
    const execution = this.executionPanel();
    await pasteNativeText(
      this.#app!,
      execution.$('input[placeholder="com.example.MainTest#computes"]'),
      "pkg.RunnerTest",
    );
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Test JVM option 1").$("textarea"),
      "-Dcontext.gui.literal=value with spaces",
    );
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Variable 1 value").$("textarea"),
      "literal environment",
    );
    for (const method of TEST_METHODS) await rm(this.testProofFile(method), { force: true });
    await this.requestProjectExecution("Run tests with coverage");
  }
  async startCustomGradleIntegrationTests() {
    assert.equal(this.#customGradleTestSourceSet, true);
    await this.configureSynchronizedExecution("integrationTest");
    const execution = this.executionPanel();
    await execution.$("button=Add test JVM option").click();
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Test JVM option 1").$("textarea"),
      "-Dcontext.gui.literal=value with spaces",
    );
    await this.requestProjectExecution("Run tests");
  }
  async assertSynchronizedMavenIntegrationTestSourceSetAvailable(sourceSaved = false) {
    assert.equal(this.#customMavenIntegrationTestSourceSet, true);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const execution = this.executionPanel();
    const modules = execution.$("label=Synchronized module and source set").$("select");
    const options = await modules.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const appIntegrationLabels = labels.filter((label) =>
      label.startsWith("Maven · app / integration-test ("),
    );
    const libraryIntegrationLabels = labels.filter((label) =>
      label.startsWith("Maven · library / integration-test ("),
    );
    this.#proof.synchronizedMavenIntegrationTestSourceSetClassified =
      appIntegrationLabels.length === 1 && libraryIntegrationLabels.length === 1;
    assert.ok(labels.includes("Maven · app / main"), labels.join(", "));
    assert.ok(labels.includes("Maven · app / test"), labels.join(", "));
    assert.ok(labels.includes("Maven · library / main"), labels.join(", "));
    assert.ok(labels.includes("Maven · library / test"), labels.join(", "));
    assert.equal(appIntegrationLabels.length, 1, labels.join(", "));
    assert.equal(libraryIntegrationLabels.length, 1, labels.join(", "));
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const context = this.panel();
    const contextSelect = context.$("label=Module and source set").$("select");
    for (const [moduleName, otherModule] of [
      ["app", "library"],
      ["library", "app"],
    ] as const) {
      const contextOptions = await contextSelect.$$("option").getElements();
      const contextLabels = await contextOptions.map((item) => item.getText());
      const option = contextLabels.find((label) =>
        label.startsWith(`Maven · ${moduleName} · integration-test (`),
      );
      assert.ok(option, `${moduleName} integration-test source set: ${contextLabels.join(", ")}`);
      await contextSelect.selectByVisibleText(option);
      const contextText = await context.getText();
      assert.ok(
        contextText.includes(`${moduleName}/src/integration-test/java`),
        `${moduleName} integration source root missing: ${contextText}`,
      );
      assert.ok(
        !contextText.includes(`${otherModule}/src/integration-test/java`),
        `${moduleName} integration source set contains ${otherModule}'s root: ${contextText}`,
      );
    }
    this.#proof.synchronizedMavenFailsafeAppAndLibrarySourceSetsClassified = true;
    if (sourceSaved) await this.assertSavedExecutionDraft();
    else await this.assertDraft();
    await this.assertInputs({ allowSavedExecutionSource: sourceSaved });
  }
  async launchAndSynchronizeMavenBeforeJavaOpen() {
    assert.equal(this.#customMavenIntegrationTestSourceSet, true);
    await this.launchForProjectContext();
    if (this.#mavenFailsafeProfile) {
      const settings = this.panel().$(".//details[summary='Maven settings']");
      if ((await settings.getAttribute("open")) === null) await settings.$("summary").click();
      await pasteNativeText(this.#app!, settings.$("label*=Inactive profiles").$("textarea"), "app-integration");
    }
    // Check unavailable processor inputs before Java language-server import can
    // materialize empty declared output directories. No compilation is requested.
    for (const relative of ["maven/processor/target/classes", "maven/app/target/generated-sources/annotations"]) {
      await assert.rejects(access(this.file(relative)), { code: "ENOENT" });
    }
    await this.synchronizeMaven();
    await assert.rejects(access(this.file("maven/processor/target/classes")), { code: "ENOENT" });
    assert.equal(await this.surface().tab(this.executionSource()).isExisting(), false);
    await this.assertInputs();
    this.#proof.mavenAnnotationProcessorWarningBeforeJavaOpen = true;
  }
  async assertMavenAnnotationProcessorWarning() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const context = this.panel();
    const contextSelect = context.$("label=Module and source set").$("select");
    const options = await contextSelect.$$("option").getElements();
    const labels = await options.map((item) => item.getText());
    const appMain = labels.find((label) => label.startsWith("Maven · app · main ("));
    assert.ok(appMain, `Maven app main source set is missing: ${labels.join(", ")}`);
    await contextSelect.selectByVisibleText(appMain);
    const collapsedContextText = await context.getText();
    assert.ok(
      collapsedContextText.includes(
        "Processor inputs are not fully resolved, so generated-source roots may be missing.",
      ),
      `The generated-source limitation is hidden while processor details are collapsed: ${collapsedContextText}`,
    );
    await context.$("summary=Annotation processors (1)").click();
    const contextText = await context.getText();
    assert.ok(
      contextText.includes("java.context.annotationProcessorPathUnavailable"),
      `The provider refusal is not visible: ${contextText}`,
    );
    assert.ok(
      contextText.includes(
        "Processor inputs are not fully resolved, so generated-source roots may be missing.",
      ),
      `The panel did not explain the generated-source limitation: ${contextText}`,
    );
    this.#proof.mavenAnnotationProcessorContextWarningVisible = true;
  }
  async activateMavenFailsafeProfile() {
    assert.equal(this.#mavenFailsafeProfile, true);
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const modules = this.executionPanel().$("label=Synchronized module and source set").$("select");
    const options = await modules.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    assert.ok(labels.includes("Maven · app / main"), labels.join(", "));
    assert.ok(labels.some((label) => label.startsWith("Maven · library / integration-test (")), labels.join(", "));
    assert.ok(!labels.some((label) => label.startsWith("Maven · app / integration-test (")), labels.join(", "));
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const settings = this.panel().$(".//details[summary='Maven settings']");
    if ((await settings.getAttribute("open")) === null) await settings.$("summary").click();
    const inactive = settings.$("label*=Inactive profiles").$("textarea");
    await inactive.click();
    await this.browser().keys(["Control", "a"]);
    await this.browser().keys("Backspace");
    assert.equal(await inactive.getValue(), "");
    await pasteNativeText(this.#app!, settings.$("label*=Active profiles").$("textarea"), "app-integration");
    try {
      await this.synchronizeMaven();
    } catch (cause) {
      throw new Error(`Maven profile synchronization failed: ${(await this.panel().getText()).slice(0, 3000)}`, { cause });
    }
    await this.assertInputs();
  }
  async assertMavenProfileTestJvmDetails() {
    const panel = this.panel();
    const modules = panel.$("label=Module and source set").$("select");
    const details = () => panel.$(".//details[summary[starts-with(normalize-space(.), 'Maven test JVM')]]");
    for (const module of ["app", "library"]) {
      const options = await modules.$$("option").getElements();
      const labels = await options.map((option) => option.getText());
      const selected = labels.find((label) => label.startsWith(`Maven · ${module} · integration-test (`));
      assert.ok(selected, labels.join(", "));
      await modules.selectByVisibleText(selected);
      if ((await details().getAttribute("open")) === null) await details().$("summary").click();
      const request = details().$("button=Request Maven test JVM details");
      if (await request.isExisting()) {
        await request.click();
        await this.browser().waitUntil(async () => (await details().isExisting()) &&
          !(await details().$("summary").getText()).includes("not reported"),
          { timeout: 20_000, interval: 100, timeoutMsg: `Maven test JVM facts are missing for ${module}` },
        );
      }
      if ((await details().getAttribute("open")) === null) await details().$("summary").click();
      const text = await details().getText();
      assert.match(text, /Maven test JVM · complete/u);
      assert.match(text, /org\.apache\.maven\.plugins:maven-failsafe-plugin:3\.5\.4 · integration-tests/u);
      assert.match(text, /forked · complete/u);
      assert.match(text, /forkCount · 1/u);
    }
    await assert.rejects(access(this.file("maven/app/target/failsafe-reports")), { code: "ENOENT" });
    await this.assertInputs();
    this.#proof.mavenProfileTestJvmDetailsObserved = true;
  }
  async assertMavenAnnotationProcessorContextAfterFailsafe() {
    assert.equal(this.#proof.mavenAnnotationProcessorWarningBeforeJavaOpen, true);
    assert.equal(this.#proof.mavenAnnotationProcessorContextWarningVisible, true);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const context = this.panel();
    const contextSelect = context.$("label=Module and source set").$("select");
    const options = await contextSelect.$$("option").getElements();
    const labels = await options.map((item) => item.getText());
    const appMain = labels.find((label) => label.startsWith("Maven · app · main ("));
    assert.ok(appMain, `Maven app main source set is missing after Failsafe: ${labels.join(", ")}`);
    await contextSelect.selectByVisibleText(appMain);
    let contextText = await context.getText();
    assert.ok(
      !contextText.includes(
        "Processor inputs are not fully resolved, so generated-source roots may be missing.",
      ),
      `The refreshed app context still reports incomplete processor inputs: ${contextText}`,
    );
    assert.ok(
      contextText.includes("app/target/generated-sources/annotations"),
      `The generated app source root is missing after Failsafe: ${contextText}`,
    );
    await context.$("summary=Annotation processors (1)").click();
    contextText = await context.getText();
    assert.ok(contextText.includes("Processor path"), contextText);
    assert.match(contextText, /processor[\\/]target[\\/]classes/u, contextText);
    this.#proof.mavenAnnotationProcessorContextAvailableAfterFailsafe = true;
    if (this.#mavenFailsafeProfile) {
      const reported = "app/target/generated-sources/annotations";
      const workspacePath = `maven/${reported}`;
      const label = this.panel().$(`[aria-label="Reveal generated source root ${workspacePath} in Files"]`);
      await this.openGeneratedJavaSourceFromProjectRoot(
        await label.isExisting() ? workspacePath : reported,
        workspacePath,
      );
    }
    await this.assertInputs({ allowSavedExecutionSource: true });
  }
  private async openGeneratedJavaSourceFromProjectRoot(reported: string, root: string) {
    const browser = this.browser();
    const reveal = this.panel().$(`[aria-label="Reveal generated source root ${reported} in Files"]`);
    const source = `${root}/generated/GeneratedGreeting.java`;
    const bytes = await readFile(this.file(source));
    await reveal.scrollIntoView();
    await reveal.click();
    const row = browser.$(`[role="treeitem"][data-path="${root}"]`);
    await row.waitForDisplayed({ timeout: 10_000 });
    assert.equal(await row.getAttribute("aria-expanded"), "true");
    await browser.waitUntil(() => row.isFocused(), {
      timeout: 5_000, interval: 100, timeoutMsg: `Files did not focus ${root}`,
    });
    assert.equal(await this.surface().tab(source).isExisting(), false);
    const packageRow = browser.$(`[role="treeitem"][data-path="${root}/generated"]`);
    await packageRow.waitForDisplayed({ timeout: 10_000 });
    if ((await packageRow.getAttribute("aria-expanded")) !== "true") {
      await packageRow.scrollIntoView();
      await packageRow.waitForClickable({ timeout: 5_000 });
      await packageRow.click();
      await browser.waitUntil(async () => (await packageRow.getAttribute("aria-expanded")) === "true", {
        timeout: 5_000, interval: 100, timeoutMsg: `Files did not expand ${root}/generated`,
      });
    }
    await this.surface().open(source, bytes.toString("utf8"));
    await this.surface().assertDirty(source, false);
    const notice = browser.$('[role="status"][aria-label="Generated Java source"]');
    await notice.waitForDisplayed({ timeout: 5_000 });
    assert.match(await notice.getText(), /build may overwrite edits/u);
    await browser.$('[role="tab"][aria-label="Java Project"]').click();
    await browser.$("button=Reveal generated root").click();
    await row.waitForDisplayed({ timeout: 10_000 });
    await browser.waitUntil(() => row.isFocused(), {
      timeout: 5_000, interval: 100, timeoutMsg: `Files did not focus ${root} from the editor`,
    });
    assert.equal(await this.surface().tab(source).getAttribute("aria-selected"), "true");
    assert.deepEqual(await readFile(this.file(source)), bytes);
    this.#proof.generatedJavaSourceOpenedFromProjectRoot = true;
    this.#proof.generatedJavaSourceNoticeAndRevealVerified = true;
  }
  async assertGeneratedJavaMethodDefinition() {
    const maven = this.#executionTool === "maven";
    const caller = this.executionSource();
    const root = maven
      ? "maven/app/target/generated-sources/annotations"
      : "gradle/app/build/generated/sources/annotationProcessor/java/main";
    const destination = `${root}/generated/GeneratedGreeting.java`;
    const generated = await readFile(this.file(destination), "utf8");
    const callerText = await readFile(this.file(caller), "utf8");
    if (maven && this.#javaRelease === 27) {
      await this.startLanguageServiceWithSdk(this.executionSdk());
      await this.resynchronizeMavenAfterExecution();
    }
    const target = this.surface().tab(destination);
    if (await target.isExisting()) {
      await target.$(`button[aria-label="Close ${destination}"]`).click();
      await target.waitForExist({ reverse: true, timeout: 5_000 });
    }
    await this.surface().tab(caller).click();
    assert.equal(await this.browser().$('[aria-label="Generated Java source"]').isExisting(), false);
    await this.browser().execute(() => {
      document.body.setAttribute("data-native-java-navigation-diagnostics", "true");
      document.body.removeAttribute("data-java-definition-result-history");
    });
    await this.positionEditorCursorOnToken(caller, callerText, "GeneratedGreeting.value()", "value");
    await this.browser().keys("F12");
    const lines = generated.split("\n");
    const line = lines.findIndex((text) => text.includes("value()"));
    assert.ok(line >= 0, "The generated method declaration is missing");
    const column = lines[line].indexOf("value()") + 1;
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(async () =>
      (await target.isExisting()) &&
        (await target.getAttribute("aria-selected")) === "true" &&
        (await cursor.getText()).trim() === `Ln ${line + 1}, Col ${column}`,
    { timeout: 35_000, interval: 100, timeoutMsg: `F12 did not open ${destination}:${line + 1}:${column}` });
    const result = await this.browser().execute(() => {
      const history = JSON.parse(document.body.getAttribute("data-java-definition-result-history") ?? "[]");
      return history.at(-1) as { status?: string; refusalCode?: string } | undefined;
    });
    if (this.#javaRelease === 27) {
      assert.equal(result?.status, "refused");
      assert.equal(result?.refusalCode, "java.context.sourceAnalysisUnqualified");
    } else {
      assert.equal(result?.status, "ready");
    }
    assert.equal(await readFile(this.file(destination), "utf8"), generated);
    assert.equal(await readFile(this.file(caller), "utf8"), callerText);
    await this.surface().assertBuffer(destination, generated);
    await this.surface().assertDirty(destination, false);
    await this.browser().$('[aria-label="Generated Java source"]').waitForDisplayed({ timeout: 5_000 });
    this.#proof.generatedJavaMethodDefinitionProvider = this.#javaRelease === 27 ? "JDT LS" : "RefactorKit";
    this.#proof.generatedJavaMethodDefinitionOpened = true;
  }
  private async configureMavenFailsafeTestJvmOptions(
    moduleName: "app" | "library",
    option = "-Dcontext.gui.literal=value with spaces",
  ) {
    assert.equal(this.#customMavenIntegrationTestSourceSet, true);
    await this.configureSynchronizedExecution("integrationTest", "pkg.Runner", moduleName);
    const execution = this.executionPanel();
    const currentTestJvmOptions = await execution.$$("label*=Test JVM option 1").getElements();
    if (currentTestJvmOptions.length === 0) await execution.$("button=Add test JVM option").click();
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Test JVM option 1").$("textarea"),
      option,
    );
  }

  async assertLegacyMavenFailsafeJvm() {
    const runtime = await realpath(path.join(process.env.IDE_TEST_JAVA8_HOME!, "jre"));
    await this.assertSynchronizedMavenFailsafeIntegrationTests("app", false, runtime);
    for (const method of TEST_METHODS) {
      const proof = await readFile(this.testProofFile(method), "utf8");
      assert.deepEqual(proof.trimEnd().split("\n").at(-1)?.split("|").slice(0, 2), [runtime, "value with spaces"]);
    }
    this.#proof.mavenLegacyFailsafeJvmVerified = true;
  }

  async verifyMavenFailsafeToolchainRecovery() {
    const toolchains = this.file("maven/toolchains.xml");
    const original = await readFile(toolchains);
    const result = this.file("maven/library/target/maven-library-failsafe-context-proof.txt");
    const report = this.file("maven/library/target/library-failsafe-reports/TEST-fixtures.library.LibraryIT.xml");
    const before = await Promise.all([result, report].map((file) => lstat(file, { bigint: true })));
    await writeFile(toolchains, "<toolchains/>");
    try {
      await this.resynchronizeMavenAfterExecution();
      await this.configureMavenFailsafeTestJvmOptions("library");
      await this.requestProjectExecution("Run integration tests");
      await this.waitProjectExecution("integration-test", "failed");
      const execution = this.executionPanel();
      assert.match(await execution.$('[aria-label="Java console output"]').getText(),
        /Requested toolchain specification did not match any configured toolchain/u);
      const alerts = await execution.$$('[role="alert"]').getElements();
      assert.ok((await alerts.map((alert) => alert.getText())).includes(
        "Maven could not find a matching JDK toolchain for the test fork. Configure a matching toolchain in Maven and run again.",
      ));
      const results = execution.$('[aria-label="Java test results"]');
      assert.doesNotMatch(await results.getText(), /1 reported tests|TEST-fixtures\.library\.LibraryIT\.xml/u);
      const after = await Promise.all([result, report].map((file) => lstat(file, { bigint: true })));
      assert.deepEqual(after.map((file) => file.mtimeNs), before.map((file) => file.mtimeNs));
    } finally {
      await writeFile(toolchains, original);
    }
    await this.resynchronizeMavenAfterExecution();
    await this.runSynchronizedMavenFailsafeIntegrationTests("library");
    await this.assertSynchronizedMavenFailsafeIntegrationTests("library", false);
    assert.ok((await lstat(report, { bigint: true })).mtimeNs > before[1]!.mtimeNs);
    this.#proof.mavenFailsafeToolchainRecoveryVerified = true;
  }

  async verifyMavenFailsafeOfflinePluginRecovery() {
    assert.equal(this.#proof.mavenLegacyFailsafeJvmVerified, true);
    assert.equal(this.#repository, path.join(this.#lease!.paths.root, "maven-repository"));
    const artifacts = [
      {
        relativePath: "maven-toolchains-plugin/3.3.0/maven-toolchains-plugin-3.3.0.jar",
        errorDetail: /Cannot access .* in offline mode and the artifact org\.apache\.maven\.plugins:maven-toolchains-plugin:jar:3\.3\.0/u,
      },
      {
        relativePath: "maven-plugins/49/maven-plugins-49.pom",
        errorDetail: /The following artifacts could not be resolved: org\.apache\.maven\.plugins:maven-plugins:pom:49 \(absent\): Cannot access .* in offline mode/u,
      },
    ];
    const omitted = path.join(this.#lease!.paths.root, "omitted-maven-artifact");
    const report = this.file("maven/app/target/failsafe-reports/TEST-pkg.RunnerIT.xml");
    const previousReport = await readFile(report);
    const previousReportModifiedAt = (await lstat(report, { bigint: true })).mtimeNs;
    for (const { relativePath, errorDetail } of artifacts) {
      const artifact = path.join(this.#repository, "org/apache/maven/plugins", relativePath);
      assert.equal(await realpath(artifact), artifact, "The Maven artifact must be inside the isolated cache");
      assert.ok((await lstat(artifact)).isFile());
      await rename(artifact, omitted);
      try {
        await this.resynchronizeMavenAfterExecution();
        await this.configureMavenFailsafeTestJvmOptions("app");
        await this.requestProjectExecution("Run integration tests");
        const execution = this.executionPanel();
        const consoleOutput = execution.$('[aria-label="Java console output"]');
        await this.browser().waitUntil(
          async () => (await consoleOutput.isExisting()) && errorDetail.test(await consoleOutput.getText()),
          { timeout: 30_000, interval: 100, timeoutMsg: `Maven did not report the missing ${relativePath}` },
        );
        await this.waitProjectExecution("integration-test", "failed");
        const output = await consoleOutput.getText();
        assert.match(output, /maven-toolchains-plugin:3\.3\.0 or one of its dependencies could not be resolved/u);
        const alerts = await execution.$$('[role="alert"]').getElements();
        assert.ok((await alerts.map((alert) => alert.getText())).includes(
          "Maven could not resolve a build plugin in offline mode. In a trusted workspace, use Verify Maven project to populate the selected repository, then run the tests again.",
        ), `The IDE did not show the offline plugin diagnosis for ${relativePath}`);
        assert.doesNotMatch(await execution.$('[aria-label="Java test results"]').getText(),
          /[1-9]\d* reported tests|TEST-pkg\.RunnerIT\.xml/u);
        await assert.rejects(access(artifact), { code: "ENOENT" });
        assert.deepEqual(await readFile(report), previousReport);
        assert.equal((await lstat(report, { bigint: true })).mtimeNs, previousReportModifiedAt);
      } finally {
        await rename(omitted, artifact);
      }
    }
    await this.resynchronizeMavenAfterExecution();
    await this.runSynchronizedMavenFailsafeIntegrationTests("app");
    await this.assertLegacyMavenFailsafeJvm();
    assert.ok((await lstat(report, { bigint: true })).mtimeNs > previousReportModifiedAt);
    this.#proof.mavenFailsafeOfflinePluginRecoveryVerified = true;
  }

  async debugMavenFailsafeTest(legacy = false) {
    const testJdk = legacy ? await realpath(process.env.IDE_TEST_JAVA8_HOME!) : this.executionSdk();
    const source = "maven/app/src/integration-test/java/pkg/RunnerIT.java";
    const original = this.originalSource(source);
    const line = original.split("\n").findIndex((row) => row.includes('Files.write(Paths.get("target/maven-failsafe-context-proof.txt")')) + 1;
    assert.ok(line > 0);
    await this.resynchronizeMavenAfterExecution();
    await this.openWorkspaceSourceViaQuickOpen(source);
    await this.configureMavenFailsafeTestJvmOptions("app");
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    await this.clickProjectSourceBreakpoint(source, line);
    await this.browser().waitUntil(
      async () => (await execution.$('[aria-label="Saved Java source breakpoints"]').getText()).includes(`RunnerIT.java:${line}`),
      { timeout: 5_000, interval: 100 },
    );
    await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'), "pkg.RunnerIT#savedSource");
    await this.requestProjectExecution("Debug integration test");
    const reportProof = this.file("maven/app/target/maven-failsafe-context-proof.txt");
    const originalProof = await lstat(reportProof, { bigint: true });
    const processFile = this.file("maven/app/target/maven-failsafe-context.pid");
    const debugPids: number[] = [];
    for (const complete of [true, false]) {
      await this.waitForProjectDebuggerStatus("suspended (entry)", 60_000);
      const continueButton = execution.$('[aria-label="Structured Java debugger"]').$("button=Continue");
      await continueButton.click();
      await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 30_000);
      const debuggerText = (await execution.$('[aria-label="Structured Java debugger"]').getText()).replaceAll("/", ".");
      assert.match(debuggerText, /pkg\.RunnerIT\.savedSource/u);
      assert.ok(debuggerText.includes(`pkg.RunnerIT.java:${line}`), debuggerText);
      const pid = Number(await readFile(processFile, "utf8"));
      assert.ok(Number.isSafeInteger(pid) && pid > 1 && !debugPids.includes(pid));
      await this.captureTestJvm(pid, testJdk, legacy);
      debugPids.push(pid);
      if (complete) {
        await continueButton.click();
        await this.waitProjectExecution("debug-integration-test", "succeeded");
        if (legacy) await this.assertLegacyMavenFailsafeJvm();
        else await this.assertSynchronizedMavenFailsafeIntegrationTests();
        await pasteNativeText(this.#app!, execution.$('input[placeholder="com.example.MainTest#computes"]'), "does.not.Exist#mustNotRun");
        await execution.$("button=Rerun session").waitForEnabled({ timeout: 5_000 });
        await execution.$("button=Rerun session").click();
      } else {
        const completedProof = await lstat(reportProof, { bigint: true });
        assert.ok(completedProof.mtimeNs > originalProof.mtimeNs);
        await execution.$("button=Stop").click();
        await this.waitProjectExecution("debug-integration-test", "stopped");
        assert.equal((await lstat(reportProof, { bigint: true })).mtimeNs, completedProof.mtimeNs);
      }
      await this.browser().waitUntil(async () => access(`/proc/${pid}`).then(() => false, () => true),
        { timeout: 5_000, interval: 100 });
    }
    if (legacy) this.#proof.mavenLegacyFailsafeDebugCompletedAndStopped = true;
    else this.#proof.mavenFailsafeDebugCompletedAndStopped = true;
    await this.assertInputs({ allowSavedExecutionSource: !legacy });
  }

  async qualifyMavenFailsafeCoverage(legacyAppFork = false) {
    for (const [module, productionSource, testSource] of [
      ["app", "pkg/Runner.java", "RunnerIT.java"],
      ["library", "fixtures/library/GreetingService.java", "LibraryIT.java"],
    ] as const) {
      await this.resynchronizeMavenAfterExecution();
      await this.configureMavenFailsafeTestJvmOptions(module);
      const execution = this.executionPanel();
      const previousSession = await execution.getAttribute("data-session-id");
      await this.requestProjectExecution("Run integration tests with coverage");
      await this.browser().waitUntil(async () => {
        const session = await execution.getAttribute("data-session-id");
        return Boolean(session && session !== previousSession);
      }, { timeout: 10_000, interval: 100, timeoutMsg: `Coverage did not start a new session for ${module}` });
      await this.waitProjectExecution("integration-coverage", "succeeded");
      if (legacyAppFork && module === "app") await this.assertLegacyMavenFailsafeJvm();
      else await this.assertSynchronizedMavenFailsafeIntegrationTests(module, !legacyAppFork);

      const coverage = execution.$('[aria-label="Java test coverage"]');
      await coverage.scrollIntoView();
      assert.match(await coverage.getText(), /JaCoCo: ready/u);
      const source = coverage.$("label*=Measured source file").$("select");
      const options = await source.$$("option").getElements();
      const labels = await options.map((option) => option.getText());
      const selected = labels.find((label) => label.startsWith(`${productionSource} ·`));
      assert.ok(selected, `JaCoCo did not measure ${productionSource}: ${labels.join(", ")}`);
      assert.ok(!labels.some((label) => label.includes(testSource)), "JaCoCo reported integration test source as production coverage");
      await source.selectByVisibleText(selected);
      const instructions = await coverage.$$(".//dt[text()='Instructions']/following-sibling::dd").getElements();
      assert.ok(instructions.length >= 2);
      const sourceCounter = /\((\d+) \/ (\d+)\)/u.exec(await instructions[1]!.getText());
      assert.ok(sourceCounter && Number(sourceCounter[1]) > 0, `No covered instructions in ${productionSource}`);
    }
    this.#proof.mavenFailsafeCoverageVerified = true;
  }

  async runSynchronizedMavenFailsafeIntegrationTests(moduleName: "app" | "library" = "app") {
    await this.configureMavenFailsafeTestJvmOptions(
      moduleName,
      this.#mavenFailsafeProfile ? "-Dcontext.gui.profileOption=IDE profile value" : undefined,
    );
    const execution = this.executionPanel();
    const consoleOutput = execution.$('[aria-label="Java console output"]');
    const previousOutput = (await consoleOutput.isExisting()) ? await consoleOutput.getText() : "";
    const selectedModule = execution.$("label=Synchronized module and source set").$("select");
    assert.ok(await selectedModule.getValue(), "The Failsafe module/source-set selection was lost");
    assert.ok(
      !(await execution.getText()).includes(
        "The saved module or source set is not present in the current Java Project context.",
      ),
      "The Failsafe module/source-set selection is unavailable before execution",
    );
    await this.requestProjectExecution("Run integration tests");
    const expectedMarker =
      moduleName === "app"
        ? "MAVEN_FAILSAFE_CONTEXT_IT_OK"
        : "MAVEN_LIBRARY_FAILSAFE_CONTEXT_IT_OK";
    try {
      await this.browser().waitUntil(
        async () => {
          const alerts = await execution.$$('[role="alert"]').getElements();
          if (alerts.length)
            throw new Error(`Project execution refused: ${await alerts[0]!.getText()}`);
          if (!(await consoleOutput.isExisting())) return false;
          const output = await consoleOutput.getText();
          return (
            output !== previousOutput &&
            output.includes(expectedMarker) &&
            output.includes("BUILD SUCCESS")
          );
        },
        {
          timeout: 90_000,
          interval: 100,
          timeoutMsg: `The selected ${moduleName} Failsafe invocation did not produce fresh completed Maven output`,
        },
      );
    } catch (error) {
      const [panelText, output] = await Promise.all([
        execution.getText(),
        consoleOutput
          .isExisting()
          .then((exists) => (exists ? consoleOutput.getText() : "<absent>")),
      ]);
      throw new Error(
        `The selected ${moduleName} Failsafe invocation did not complete. Panel: ${panelText.slice(-1500)}. Console: ${output.slice(-1500)}`,
        { cause: error },
      );
    }
    await this.waitProjectExecution("integration-test", "succeeded");
    this.#proof.mavenTestJvmOptionAccepted = true;
  }
  async assertSynchronizedMavenFailsafeIntegrationTests(
    moduleName: "app" | "library" = "app",
    expectSavedDraft = true,
    javaHome = this.executionSdk(),
  ) {
    await this.assertTestSummary(1, 1, 0);
    const results = this.executionPanel().$('[aria-label="Java test results"]');
    const reportName =
      moduleName === "app" ? "TEST-pkg.RunnerIT.xml" : "TEST-fixtures.library.LibraryIT.xml";
    const reportDirectory = moduleName === "app" ? "failsafe-reports" : "library-failsafe-reports";
    const expectedReport = `maven/${moduleName}/target/${reportDirectory}/${reportName}`;
    const resultText = await results.getText();
    assert.ok(
      resultText.includes(expectedReport),
      `Expected fresh Failsafe report ${expectedReport} in Java test results, received: ${resultText}`,
    );
    assert.equal(
      await readFile(
        this.file(
          moduleName === "app"
            ? "maven/app/target/maven-failsafe-context-proof.txt"
            : "maven/library/target/maven-library-failsafe-context-proof.txt",
        ),
        "utf8",
      ),
      `${javaHome}|value with spaces\n`,
    );
    this.#proof.mavenTestJvmOptionObservedByFailsafe = true;
    if (this.#javaRelease === 27) {
      const testClassPath = moduleName === "app" ? "pkg/RunnerIT.class" : "fixtures/library/LibraryIT.class";
      const compiled = await readFile(this.file(`maven/${moduleName}/target/test-classes/${testClassPath}`));
      assert.equal(compiled.readUInt32BE(0), 0xcafebabe);
      assert.equal(compiled.readUInt16BE(6), 71);
    }
    const reportPath = `maven/${moduleName}/target/${reportDirectory}/${reportName}`;
    assert.ok(this.#lease);
    this.#mavenFailsafeReports[moduleName] = await readNativeJUnitReport(
      this.#lease.paths.workspace,
      reportPath,
      moduleName === "app"
        ? "MAVEN_FAILSAFE_CONTEXT_IT_OK"
        : "MAVEN_LIBRARY_FAILSAFE_CONTEXT_IT_OK",
      moduleName === "app" ? "pkg.RunnerIT" : "fixtures.library.LibraryIT",
      moduleName === "app" ? "pkg.RunnerIT" : "fixtures.library.LibraryIT",
      moduleName === "app" ? "savedSource" : "selectedModuleSourceSet",
    );
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(
      output,
      moduleName === "app"
        ? /MAVEN_FAILSAFE_CONTEXT_IT_OK/
        : /MAVEN_LIBRARY_FAILSAFE_CONTEXT_IT_OK/,
    );
    if (expectSavedDraft) await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: expectSavedDraft });
    if (this.#executionDraftSavedBeforeProjectSync)
      this.#proof.synchronizedModuleRunSavedDraft = true;
    this.#proof.synchronizedMavenFailsafeTestTaskRan = true;
    this.#proof.realMavenBuild = true;
    if (moduleName === "library" && this.#mavenFailsafeReports.app)
      this.#proof.synchronizedMavenFailsafeAppAndLibraryTasksRan = true;
  }
  async startCustomGradleIntegrationCoverage() {
    assert.equal(this.#customGradleTestSourceSet, true);
    assert.equal(this.#testWorkflow, "coverage");
    await this.configureSynchronizedExecution("integrationTest");
    const execution = this.executionPanel();
    await execution.$("button=Add test JVM option").click();
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Test JVM option 1").$("textarea"),
      "-Dcontext.gui.literal=value with spaces",
    );
    await this.requestProjectExecution("Run tests with coverage");
  }
  async assertCustomGradleIntegrationCoverage() {
    await this.waitProjectExecution("coverage", "succeeded", 60_000);
    await this.assertTestSummary(1, 1, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /:app:integrationTest/);
    assert.match(output, /:app:ideCoverageJavaSourceSetTest/);
    const history = this.executionPanel().$('[aria-label="Java coverage history"]');
    await this.browser().waitUntil(async () =>
      (await history.$("label=Coverage measurement").$("option:checked").getText()).includes("integrationTest · No IDE test filter"),
      { timeout: 5000, timeoutMsg: "Coverage history omitted the Gradle integrationTest source set" },
    );
    assert.equal(
      await readFile(this.file("gradle/app/custom-gradle-test-proof.txt"), "utf8"),
      "integrationTest\n",
    );
    const coverage = this.executionPanel().$('[aria-label="Java test coverage"]');
    await coverage.scrollIntoView();
    assert.match(await coverage.getText(), /JaCoCo: ready/);
    const source = coverage.$("label*=Measured source file").$("select");
    const options = await source.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const runner = labels.find((label) => label.startsWith("pkg/Runner.java ·"));
    assert.ok(
      runner,
      `Integration-test coverage omitted production Runner.java: ${labels.join(", ")}`,
    );
    assert.equal(
      labels.some((label) => label.includes("IntegrationRunnerTest.java")),
      false,
      `Coverage reported test code instead of production code: ${labels.join(", ")}`,
    );
    await source.selectByVisibleText(runner);
    assert.match(await coverage.$("caption").getText(), /Line measurements for Runner.java/);
    const rows = await coverage.$$("tbody tr").getElements();
    assert.ok(rows.length > 0);
    const cells = await rows.map((row) => row.$$("td").getElements());
    const coveredInstructions: number[] = [];
    for (const row of cells)
      coveredInstructions.push(Number((await row[1].getText()).split(" / ")[0]));
    assert.ok(
      coveredInstructions.some((count) => count > 0),
      "Integration tests did not produce covered lines for production Runner.java.",
    );
    const openSource = coverage.$("button=Open measured source");
    assert.equal(await openSource.isExisting(), true);
    assert.equal(await openSource.isEnabled(), true);
    await openSource.scrollIntoView();
    await openSource.click();
    const runnerSource = "gradle/app/src/main/java/pkg/Runner.java";
    const runnerTab = this.surface().tab(runnerSource);
    await runnerTab.waitForDisplayed({ timeout: 10000 });
    await this.browser().waitUntil(
      async () => (await runnerTab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5000,
        interval: 50,
        timeoutMsg: "Gradle integration coverage did not open production Runner.java",
      },
    );
    const decoratedLines = await this.browser().execute((sourcePath) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${sourcePath}`);
      const host = input?.closest(".monaco-code-editor-host");
      return (
        host?.querySelectorAll(".java-coverage-line-covered, .java-coverage-line-partial").length ??
        0
      );
    }, runnerSource);
    assert.ok(decoratedLines > 0, "The Gradle production source has no covered-line decoration.");
    await access(
      this.file("gradle/app/build/classes/java/integrationTest/pkg/IntegrationRunnerTest.class"),
    );
    await this.assertSavedExecutionDraft();
    this.#proof.realGradleBuild = true;
    this.#proof.customGradleSourceSetTestTaskRan = true;
    this.#proof.customGradleSourceSetCoverageMeasuredMain = true;
    this.#proof.customGradleSourceSetCoverageOpenedMainSource = true;
  }
  async assertCustomGradleIntegrationTests() {
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes(":app:integrationTest"), output);
    assert.equal(
      await readFile(this.file("gradle/app/custom-gradle-test-proof.txt"), "utf8"),
      "integrationTest\n",
    );
    await access(
      this.file("gradle/app/build/classes/java/integrationTest/pkg/IntegrationRunnerTest.class"),
    );
    assert.equal(
      await readFile(this.file(this.executionSource()), "utf8"),
      ` ${this.originalSource()}`,
    );
    await this.surface().assertDirty(this.executionSource(), false);
    this.#proof.realGradleBuild = true;
    this.#proof.customGradleSourceSetTestTaskRan = true;
  }
  async startGradleKotlinDslProjectTests() {
    assert.equal(this.#gradleKotlinDslProject, true);
    await this.configureSynchronizedExecution("test");
    await this.requestProjectExecution("Run tests");
  }
  async assertGradleKotlinDslProjectTests() {
    assert.equal(this.#gradleKotlinDslProject, true);
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes(":app:test"), output);
    assert.equal(
      await readFile(this.file("gradle/app/gradle-kotlin-dsl-test-proof.txt"), "utf8"),
      "kotlin-dsl:from-gradle-library\n",
    );
    await access(this.file("gradle/app/build/classes/java/test/pkg/RunnerDslTest.class"));
    await access(this.file("gradle/library/build/classes/java/main/pkg/Greeter.class"));
    assert.equal(
      await readFile(this.file(this.executionSource()), "utf8"),
      ` ${this.originalSource(this.executionSource())}`,
    );
    await this.surface().assertDirty(this.executionSource(), false);
    this.#proof.realGradleBuild = true;
    this.#proof.gradleKotlinDslProjectContextTestPassed = true;
  }
  async assertSynchronizedTests() {
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(3, 3, 0);
    for (const method of TEST_METHODS) await this.assertTestProof(method, 1);
    if (this.#customMavenOutputs) {
      await access(this.file("maven/app/products/test/pkg/RunnerTest.class"));
      await assert.rejects(
        access(this.file("maven/app/target/test-classes/pkg/RunnerTest.class")),
        { code: "ENOENT" },
      );
      this.#proof.synchronizedMavenTestOutputDirectory = true;
    } else if (this.#customGradleOutputs) {
      await access(this.file("gradle/app/build/products/test/pkg/RunnerTest.class"));
      await assert.rejects(
        access(this.file("gradle/app/build/classes/java/test/pkg/RunnerTest.class")),
        { code: "ENOENT" },
      );
      this.#proof.synchronizedGradleTestOutputDirectory = true;
    } else assert.fail("Custom output test verification requires a custom build output fixture.");
    await this.assertSavedExecutionDraft();
  }
  async assertSynchronizedJupiterTests() {
    assert.equal(this.#proof.synchronizedJupiterTestSourcePrepared, true);
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(
      output.includes(this.#executionTool === "maven" ? "BUILD SUCCESS" : "BUILD SUCCESSFUL"),
      output,
    );
    const proof = await readFile(
      this.file(`${this.#executionTool}/app/jupiter-project-test-proof.txt`),
      "utf8",
    );
    assert.equal(proof, `${this.executionSdk()}|value with spaces|literal environment\n`);
    await access(
      this.file(
        this.#executionTool === "maven"
          ? "maven/app/target/test-classes/pkg/ProjectContextJupiterTest.class"
          : "gradle/app/build/classes/java/test/pkg/ProjectContextJupiterTest.class",
      ),
    );
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
    if (this.#executionTool === "maven") this.#proof.realMavenBuild = true;
    else this.#proof.realGradleBuild = true;
    this.#proof.synchronizedJupiterTestPassedForSelectedBuildTool = true;
  }
  async assertSynchronizedTestNgTests() {
    assert.equal(this.#proof.synchronizedTestNgTestSourcePrepared, true);
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(
      output.includes(this.#executionTool === "maven" ? "BUILD SUCCESS" : "BUILD SUCCESSFUL"),
      output,
    );
    const proof = await readFile(
      this.file(`${this.#executionTool}/app/testng-project-test-proof.txt`),
      "utf8",
    );
    assert.equal(proof, `${this.executionSdk()}|value with spaces|literal environment\n`);
    await access(
      this.file(
        this.#executionTool === "maven"
          ? "maven/app/target/test-classes/pkg/ProjectContextTestNgTest.class"
          : "gradle/app/build/classes/java/test/pkg/ProjectContextTestNgTest.class",
      ),
    );
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
    if (this.#executionTool === "maven") this.#proof.realMavenBuild = true;
    else this.#proof.realGradleBuild = true;
    this.#proof.synchronizedTestNgTestPassedForSelectedBuildTool = true;
  }
  async assertSynchronizedMixedJunitTests() {
    assert.equal(this.#proof.synchronizedMixedJunitTestSourcePrepared, true);
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(4, 4, 0);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(
      output.includes(this.#executionTool === "maven" ? "BUILD SUCCESS" : "BUILD SUCCESSFUL"),
      output,
    );
    const proof = await readFile(
      this.file(`${this.#executionTool}/app/mixed-junit-project-test-proof.txt`),
      "utf8",
    );
    assert.equal(proof, `${this.executionSdk()}|value with spaces|literal environment\n`);
    await access(
      this.file(
        this.#executionTool === "maven"
          ? "maven/app/target/test-classes/pkg/ProjectContextJupiterTest.class"
          : "gradle/app/build/classes/java/test/pkg/ProjectContextJupiterTest.class",
      ),
    );
    await this.assertSavedExecutionDraft();
    await this.assertInputs({ allowSavedExecutionSource: true });
    if (this.#executionTool === "maven") this.#proof.realMavenBuild = true;
    else this.#proof.realGradleBuild = true;
    this.#proof.synchronizedMixedJunitTestsPassedForSelectedBuildTool = true;
  }
  async assertSynchronizedDiscovery() {
    await this.waitProjectExecution("discover", "succeeded");
    await this.assertMavenDependencyTestsSkipped();
    if (this.#executionTool === "maven") {
      await access(this.file("maven/library/target/classes/pkg/RunnerTest.class"));
      await access(this.file("maven/app/target/test-classes/pkg/RunnerTest.class"));
    }
    const discovery = this.executionPanel().$('[aria-label="Discovered Java tests"]');
    await discovery.scrollIntoView();
    assert.ok(
      (await discovery.getText()).includes("Discovery: ready. 1 classes, 3 method-name groups."),
    );
    for (const method of TEST_METHODS) {
      assert.equal(
        await discovery.$(`[aria-label="Run method group pkg.RunnerTest#${method}"]`).isEnabled(),
        true,
      );
      await assert.rejects(access(this.testProofFile(method)), { code: "ENOENT" });
    }
    if (this.#executionTool === "maven") {
      await this.startExecutionLanguageService();
      const source = "maven/app/src/test/java/pkg/RunnerTest.java";
      const sourceText = this.originalSource(source);
      const line = sourceText.split("\n").findIndex((row) => row.includes("class RunnerTest")) + 1;
      assert.ok(line > 0);
      const open = discovery.$('[aria-label="Open test class pkg.RunnerTest"]');
      await open.waitForEnabled({ timeout: 10_000 });
      await open.scrollIntoView();
      await open.click();
      const tab = this.surface().tab(source);
      const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
      await this.browser().waitUntil(async () => (await tab.isExisting()) &&
        (await tab.getAttribute("aria-selected")) === "true" &&
        (await cursor.getText()).trim().startsWith(`Ln ${line}, Col `),
        { timeout: 20_000, interval: 100, timeoutMsg: "Discovery did not open the application test declaration" },
      );
      await this.surface().assertDirty(source, false);
      assert.equal(await readFile(this.file(source), "utf8"), sourceText);
      this.#proof.mavenDiscoveredTestSourceOwnsBinaryName = true;
    }
    await this.assertSavedExecutionDraft();
    this.#proof.synchronizedDiscoveryDidNotRunTests = true;
  }
  async runCapturedDiscoveredMethod() {
    await this.changeVisibleTestSettings();
    const button = this.executionPanel().$(
      '[aria-label="Run method group pkg.RunnerTest#testScopeAndSamePathSource"]',
    );
    await button.scrollIntoView();
    await button.click();
  }
  async filterDiscoveredModuleMethods() {
    const discovery = this.executionPanel().$('[aria-label="Discovered Java tests"]');
    const search = discovery.$("label=Search discovered tests").$("input");
    const kind = discovery.$("label=Discovered test kind").$("select");
    await search.setValue("TESTSCOPEANDSAMEPATHSOURCE");
    await kind.selectByAttribute("value", "method");
    await this.browser().waitUntil(async () => (await discovery.$$("li").length) === 1, {
      timeout: 5_000,
      timeoutMsg: "Discovery search did not select the captured module method.",
    });
    assert.ok((await discovery.$("li").getText()).includes("pkg.RunnerTest"));
    await kind.selectByAttribute("value", "class");
    await this.browser().waitUntil(
      async () => (await discovery.getText()).includes("No matching discovered tests."),
      { timeout: 5_000, timeoutMsg: "Discovery kind filtering did not preserve the empty view." },
    );
    assert.ok((await discovery.getText()).includes("1 classes, 3 method-name groups."));
    await kind.selectByAttribute("value", "method");
    await discovery
      .$('[aria-label="Run method group pkg.RunnerTest#testScopeAndSamePathSource"]')
      .waitForEnabled({ timeout: 5_000 });
    for (const method of TEST_METHODS)
      await assert.rejects(access(this.testProofFile(method)), { code: "ENOENT" });
    this.#proof.synchronizedDiscoveryFiltered = true;
  }
  async assertCapturedDiscoveredMethod() {
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    await this.assertMavenDependencyTestsSkipped();
    await this.assertTestProof("testScopeAndSamePathSource", 1);
    for (const method of [TEST_METHODS[0], TEST_METHODS[2]])
      await assert.rejects(access(this.testProofFile(method)), { code: "ENOENT" });
    await this.assertSavedExecutionDraft();
    this.#proof.synchronizedSelectionRetainedSettings = true;
  }
  async assertSynchronizedCoverage() {
    await this.waitProjectExecution("coverage", "succeeded", this.#executionTool === "gradle" ? 60_000 : undefined);
    await this.assertTestSummary(3, 3, 0);
    await this.assertMavenDependencyTestsSkipped();
    for (const method of TEST_METHODS) await this.assertTestProof(method, 1);
    const coverage = this.executionPanel().$('[aria-label="Java test coverage"]');
    await coverage.scrollIntoView();
    assert.match(await coverage.getText(), /JaCoCo: ready/);
    const source = coverage.$("label*=Measured source file").$("select");
    const options = await source.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const runner = labels.find((label) => label.startsWith("pkg/Runner.java ·"));
    assert.ok(runner, `Application coverage unavailable: ${labels.join(", ")}`);
    await source.selectByVisibleText(runner);
    const instructions = await coverage
      .$$(".//dt[text()='Instructions']/following-sibling::dd")
      .getElements();
    assert.ok(instructions.length >= 2);
    for (const counter of instructions) {
      const counts = /\((\d+) \/ (\d+)\)/.exec(await counter.getText());
      assert.ok(counts && Number(counts[1]) > 0 && Number(counts[2]) >= Number(counts[1]));
    }
    assert.match(await coverage.$("caption").getText(), /Line measurements for Runner.java/);
    const rows = await coverage.$$("tbody tr").getElements();
    assert.ok(rows.length > 0);
    const covered = await rows.map((row) => row.$$("td").getElements());
    assert.ok(
      (await Promise.all(covered.map((cells) => cells[1].getText()))).some(
        (text) => Number(text.split(" / ")[0]) > 0,
      ),
    );
    await this.assertSavedExecutionDraft();
    this.#proof.synchronizedCoverageMeasuredApplication = true;
  }
  async runWorkspaceRootCoverage() {
    await this.launchForProjectContext();
    const maven = this.#executionTool === "maven";
    if (maven) {
      await this.requestMavenSynchronization(false, "");
    } else {
      const executable = process.env.IDE_JAVA_CONTEXT_TEST_GRADLE;
      const cache = process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME;
      assert.ok(executable && cache);
      await this.fill("#java-project-sdk-home", this.#gradleSdk);
      await this.panel().$("summary=Gradle settings").click();
      await this.fill("#java-gradle-executable", executable);
      await this.fill("#java-gradle-user-home", cache);
      await this.panel().$("button=Evaluate Gradle project").click();
    }
    assert.equal(await this.panel().$('input[placeholder="Workspace root"]').getValue(), "");
    await this.waitForText(`${this.#executionTool}-effective-v1 · available`);
    const file = "src/main/java/pkg/Runner.java";
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.browser().keys(["Control", "p"]);
    const quickOpen = this.browser().$('[role="dialog"][aria-label="Go to File"]');
    await quickOpen.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, quickOpen.$('[aria-label="Search workspace files"]'), file);
    const result = quickOpen.$(`[role="option"][data-path="${file}"]`);
    await result.waitForDisplayed({ timeout: 5_000 });
    await result.click();
    await quickOpen.waitForExist({ reverse: true, timeout: 10_000 });
    await this.surface().assertBuffer(file, this.originalSource(file));
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const execution = this.executionPanel();
    const modules = execution.$("label=Synchronized module and source set").$("select");
    const options = await modules.$$("option").getElements();
    const values = await options.map(option => option.getAttribute("value"));
    const main = values.flatMap((value, index) => {
      if (!value?.startsWith("[")) return [];
      const [provider, , sourceSet] = JSON.parse(value) as [string, string, string];
      return provider === `${this.#executionTool}-effective-v1` && sourceSet === "main" ? [index] : [];
    });
    assert.equal(main.length, 1, `Missing unique workspace-root main selection: ${JSON.stringify(values)}`);
    await modules.selectByIndex(main[0]!);
    const trust = execution.$("label*=I trust this workspace").$("input");
    if (!await trust.isSelected()) await trust.click();
    await this.requestProjectExecution("Run tests with coverage");
    await this.waitProjectExecution("coverage", "succeeded", 60_000);
    await this.assertTestSummary(1, 1, 0);
  }
  async assertWorkspaceRootCoverageSource() {
    const file = "src/main/java/pkg/Runner.java";
    const original = this.originalSource(file);
    const coverage = this.executionPanel().$('[aria-label="Java test coverage"]');
    assert.match(await coverage.getText(), /JaCoCo: ready/u);
    const open = coverage.$("button=Open measured source");
    await open.waitForEnabled({ timeout: 5000 });
    await open.click();
    assert.equal(await this.surface().tab(file).getAttribute("aria-selected"), "true");
    await this.browser().$(".monaco-editor .java-coverage-line-covered").waitForDisplayed({ timeout: 5000 });
    await this.surface().assertBuffer(file, original);
    await this.assertInputs();
    this.#proof.workspaceRootCoverageOpened = true;

    const changed = "// Source updated after coverage\n" + original;
    await writeFile(this.file(file), changed);
    try {
      await this.surface().discardUsingDisk(file, changed, { staleReviewRetries: 1 });
      await this.browser().waitUntil(
        async () => !(await this.browser().$("p*=This file changed on disk").isExisting()),
        { timeout: 8_000, interval: 150 },
      );
      await this.surface().assertDirty(file, false);
      assert.equal(await open.isExisting(), false);
      assert.equal(await this.browser().$(".monaco-editor .java-coverage-line-covered").isExisting(), false);
      assert.match(await coverage.getText(), /JaCoCo: ready/u);
      this.#proof.workspaceRootCoverageRetiredAfterReload = true;
    } finally {
      await writeFile(this.file(file), original);
    }
    await this.surface().discardUsingDisk(file, original, { staleReviewRetries: 1 });
    assert.equal(await open.isExisting(), false);
  }
  async assertMultiModuleCoverage() {
    assert.equal(this.#gradleKotlinDslProject, true);
    assert.equal(this.#testWorkflow, "coverage");
    await this.waitProjectExecution("coverage", "succeeded", 60_000);
    await this.assertTestSummary(1, 1, 0);
    const coverage = this.executionPanel().$('[aria-label="Java test coverage"]');
    await coverage.scrollIntoView();
    assert.match(await coverage.getText(), /JaCoCo: ready/);
    const source = coverage.$("label*=Measured source file").$("select");
    const options = await source.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    for (const file of ["pkg/Runner.java", "pkg/Greeter.java"]) {
      const measured = labels.find((label) => label.startsWith(`${file} ·`));
      assert.ok(measured, `Multi-module coverage omitted ${file}: ${labels.join(", ")}`);
      await source.selectByVisibleText(measured);
      const sourceName = file.slice(file.lastIndexOf("/") + 1);
      assert.match(
        await coverage.$("caption").getText(),
        new RegExp(`Line measurements for ${sourceName}`),
      );
      const rows = await coverage.$$("tbody tr").getElements();
      assert.ok(rows.length > 0, `Multi-module coverage has no lines for ${file}`);
      const cells = await rows.map((row) => row.$$("td").getElements());
      const covered = await Promise.all(cells.map((row) => row[1].getText()));
      assert.ok(
        covered.some((value) => Number(value.split(" / ")[0]) > 0),
        `Multi-module coverage has no covered production lines for ${file}`,
      );
    }
    const libraryLabel = labels.find((label) => label.startsWith("pkg/Greeter.java ·"));
    assert.ok(libraryLabel, `Library coverage source is unavailable: ${labels.join(", ")}`);
    await source.selectByVisibleText(libraryLabel);
    const openSource = coverage.$("button=Open measured source");
    if (!(await openSource.isExisting())) {
      throw new Error(
        `Dependency source mapping unavailable; synchronized library context: ${this.#proof.gradleCoverageProjectContextBeforeTest}`,
      );
    }
    await openSource.scrollIntoView();
    await openSource.waitForDisplayed({ timeout: 5000 });
    assert.equal(await openSource.isEnabled(), true);
    await openSource.click();
    const librarySource = "gradle/library/src/main/java/pkg/Greeter.java";
    const tab = this.surface().tab(librarySource);
    await tab.waitForDisplayed({ timeout: 10000 });
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5000,
        interval: 50,
        timeoutMsg: "multi-module coverage did not open Greeter.java from the dependency module",
      },
    );
    await this.browser().waitUntil(
      () => this.browser().execute((sourcePath) => {
        const input = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${sourcePath}`);
        const host = input?.closest(".monaco-code-editor-host");
        return Boolean(host?.querySelector(".java-coverage-line-covered, .java-coverage-line-partial"));
      }, librarySource),
      { timeout: 5_000, interval: 50, timeoutMsg: "The dependency source has no measured covered-line decoration." },
    );
    assert.equal(
      await readFile(this.file("gradle/app/gradle-kotlin-dsl-test-proof.txt"), "utf8"),
      "kotlin-dsl:from-gradle-library\n",
    );
    await this.assertSavedExecutionDraft();
    this.#proof.realGradleBuild = true;
    this.#proof.multiModuleGradleCoverageMeasuredProjectDependencies = true;
    this.#proof.multiModuleGradleCoverageOpenedDependencySource = true;
  }
  async assertCompositeCoverage() {
    assert.equal(this.#gradleCompositeProject, true);
    assert.equal(this.#testWorkflow, "discover");
    await this.waitProjectExecution("coverage", "succeeded", 60_000);
    await this.assertTestSummary(TEST_METHODS.length, TEST_METHODS.length, 0);
    for (const method of TEST_METHODS) await this.assertTestProof(method, 1);
    const coverage = this.executionPanel().$("[aria-label='Java test coverage']");
    await coverage.scrollIntoView();
    assert.match(await coverage.getText(), /JaCoCo: ready/);
    const source = coverage.$("label*=Measured source file").$("select");
    const options = await source.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    for (const file of ["pkg/Runner.java", "pkg/Greeter.java"]) {
      const measured = labels.find((label) => label.startsWith(`${file} ·`));
      assert.ok(measured, `Composite coverage omitted ${file}: ${labels.join(", ")}`);
      await source.selectByVisibleText(measured);
      const sourceName = file.slice(file.lastIndexOf("/") + 1);
      assert.match(
        await coverage.$("caption").getText(),
        new RegExp(`Line measurements for ${sourceName}`),
      );
      const rows = await coverage.$$("tbody tr").getElements();
      assert.ok(rows.length > 0, `Composite coverage has no lines for ${file}`);
      const cells = await rows.map((row) => row.$$("td").getElements());
      const covered = await Promise.all(cells.map((row) => row[1]!.getText()));
      assert.ok(
        covered.some((value) => Number(value.split(" / ")[0]) > 0),
        `Composite coverage has no covered production lines for ${file}`,
      );
    }
    const libraryLabel = labels.find((label) => label.startsWith("pkg/Greeter.java ·"));
    assert.ok(libraryLabel, `Included-build coverage source is unavailable: ${labels.join(", ")}`);
    await source.selectByVisibleText(libraryLabel);
    const openSource = coverage.$("button=Open measured source");
    await openSource.scrollIntoView();
    await openSource.waitForEnabled({ timeout: 5_000 });
    await openSource.click();
    const librarySource = "gradle/library/src/main/java/pkg/Greeter.java";
    const tab = this.surface().tab(librarySource);
    await tab.waitForDisplayed({ timeout: 10_000 });
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Composite coverage did not open Greeter.java from the included build",
      },
    );
    await this.browser().waitUntil(
      async () =>
        (await this.browser().execute((sourcePath) => {
          const input = Array.from(
            document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
          ).find(
            (element) => element.getAttribute("aria-label") === `Code editor for ${sourcePath}`,
          );
          const host = input?.closest(".monaco-code-editor-host");
          return (
            host?.querySelectorAll(".java-coverage-line-covered, .java-coverage-line-partial")
              .length ?? 0
          );
        }, librarySource)) > 0,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "Included-build source has no measured coverage decoration.",
      },
    );
    await this.assertSavedExecutionDraft();
    this.#proof.realGradleBuild = true;
    this.#proof.gradleCompositeCoverageMeasuredApplicationAndDependency = true;
  }
  async openGradleLibrarySourceForCoverage() {
    assert.ok(this.#gradleKotlinDslProject || this.#gradleCompositeProject);
    assert.ok(
      this.#testWorkflow === "coverage" ||
        (this.#gradleCompositeProject && this.#testWorkflow === "discover"),
    );
    const source = "gradle/library/src/main/java/pkg/Greeter.java";
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const contextPanel = this.browser().$('[aria-label="Java project context"]');
    await this.browser().waitUntil(
      async () =>
        (await contextPanel.isExisting()) &&
        (await contextPanel.getText()).includes("Effective project context"),
      {
        timeout: 5000,
        interval: 50,
        timeoutMsg: "Gradle project context was not available after synchronization",
      },
    );
    const contextChoice = contextPanel.$('select[aria-label="Module and source set"]');
    const contextOptions = await contextChoice.$$("option").getElements();
    const libraryChoice = [];
    let optionIndex = 0;
    for (const option of contextOptions) {
      libraryChoice.push({
        index: optionIndex++,
        label: await option.getText(),
        value: await option.getAttribute("value"),
      });
    }
    const selectedLibrary = libraryChoice.find(
      ({ label }) => label.includes("library") && /main/.test(label),
    );
    assert.ok(
      selectedLibrary,
      `Synchronized library source set unavailable: ${JSON.stringify(libraryChoice)}`,
    );
    await contextChoice.selectByIndex(selectedLibrary.index);
    this.#proof.gradleCoverageProjectContextBeforeTest = await contextPanel.getText();
    await this.openRefactoringSourceFromExplorer(source, this.#inputs.get(source)!);
    const appTab = this.surface().tab(this.executionSource());
    await appTab.click();
  }
  async openMeasuredCoverageSource() {
    const coverage = this.executionPanel().$('[aria-label="Java test coverage"]');
    const source = coverage.$("label*=Measured source file").$("select");
    const options = await source.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const runnerLabel = labels.find((label) => label.startsWith("pkg/Runner.java ·"));
    assert.ok(runnerLabel, `Runner.java coverage source is unavailable: ${labels.join(", ")}`);
    await source.selectByVisibleText(runnerLabel);
    const openSource = coverage.$("button=Open measured source");
    if (!(await openSource.isExisting())) {
      assert.equal(this.#executionTool, "gradle");
      assert.match(
        await coverage.getText(),
        /Source navigation needs one unique main source file that was open during this run in synchronized Java Project\./,
      );
      const undecoratedLines = await this.browser().execute((sourcePath) => {
        const input = Array.from(
          document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
        ).find((element) => element.getAttribute("aria-label") === `Code editor for ${sourcePath}`);
        const host = input?.closest(".monaco-code-editor-host");
        return (
          host?.querySelectorAll(
            ".java-coverage-line-covered, .java-coverage-line-uncovered, .java-coverage-line-partial",
          ).length ?? 0
        );
      }, this.executionSource());
      assert.equal(
        undecoratedLines,
        0,
        "Unavailable Gradle source mapping must not claim ownership.",
      );
      this.#proof.synchronizedGradleCoverageSourceMappingUnavailable = true;
      return;
    }
    await openSource.scrollIntoView();
    await openSource.waitForDisplayed({ timeout: 5000 });
    assert.equal(await openSource.isEnabled(), true);
    await openSource.click();
    const file = this.executionSource();
    const tab = this.surface().tab(file);
    await tab.waitForDisplayed({ timeout: 10000 });
    await this.browser().waitUntil(
      async () => (await tab.getAttribute("aria-selected")) === "true",
      { timeout: 5000, interval: 50, timeoutMsg: "coverage navigation did not open Runner.java" },
    );
    const rows = await coverage.$$("tbody tr").getElements();
    let selectedLine: number | undefined;
    for (const row of rows) {
      const cells = await row.$$("td").getElements();
      if (cells.length < 2) continue;
      const instructions = /^(\d+)\s*\/\s*\d+$/.exec(await cells[1]!.getText());
      if (!instructions || Number(instructions[1]) === 0) continue;
      const candidate = cells[0]!.$("button");
      if (!(await candidate.isExisting())) continue;
      selectedLine = Number(await candidate.getText());
      await candidate.scrollIntoView();
      await candidate.click();
      break;
    }
    assert.ok(selectedLine, "No covered application line can be opened from results.");
    const lineNumber = selectedLine;
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () =>
        (await cursor.getText()).trim() === `Ln ${lineNumber}, Col 1` &&
        Number(await cursor.getAttribute("data-reveal-line")) === lineNumber,
      {
        timeout: 10000,
        interval: 50,
        timeoutMsg: "coverage line selection did not reveal its source location",
      },
    );
    const decorationCount = await this.browser().execute((sourcePath) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${sourcePath}`);
      const host = input?.closest(".monaco-code-editor-host");
      return (
        host?.querySelectorAll(
          ".java-coverage-line-covered, .java-coverage-line-uncovered, .java-coverage-line-partial",
        ).length ?? 0
      );
    }, file);
    assert.ok(decorationCount > 0, "Monaco did not render a measured Java coverage line.");
    await this.assertSavedExecutionDraft();
    this.#proof.synchronizedCoverageSourceNavigationAndDecoration = true;
    if (this.#executionTool === "gradle")
      this.#proof.synchronizedGradleCoverageSourceNavigationAndDecoration = true;
  }
  async assertSynchronizedFailure() {
    await this.waitProjectExecution("test", "failed");
    await this.assertTestSummary(3, 2, 1);
    await this.assertMavenDependencyTestsSkipped();
    for (const method of TEST_METHODS) await this.assertTestProof(method, 1);
    const results = this.executionPanel().$('[aria-label="Java test results"]');
    assert.ok((await results.getText()).includes("deliberate-failure"));
    assert.ok(
      (await results.getText()).includes(
        "native-test-loader//pkg.RunnerTest.testScopeAndSamePathSource(RunnerTest.java:",
      ),
      "The actual failing test frame did not retain its named JVM class loader.",
    );
    assert.equal(await results.$("button=Rerun failed tests").isEnabled(), true);
    await this.assertSavedExecutionDraft();
  }
  async openReportedTestSource() {
    const results = this.executionPanel().$('[aria-label="Java test results"]');
    await results.scrollIntoView();
    const open = results.$(
      '[aria-label="Open source for pkg.RunnerTest test testScopeAndSamePathSource"]',
    );
    await open.waitForDisplayed({ timeout: 10_000 });
    await open.waitForEnabled({ timeout: 5_000 });
    await open.scrollIntoView();
    await open.click();
  }
  async authorizeGradleImportForJdtLs() {
    if (this.#executionTool !== "gradle") return;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const details = this.panel().$(".//details[summary='Gradle settings']");
    if ((await details.getAttribute("open")) === null) await details.$("summary").click();
    const authorization = this.browser().$("button=Allow JDT LS Gradle import for this session");
    assert.equal(
      await authorization.isExisting(),
      true,
      "The Java project did not expose the JDT LS Gradle import authorization control.",
    );
    await authorization.scrollIntoView();
    await authorization.waitForEnabled({ timeout: 30_000 });
    await authorization.click();
    await this.browser().waitUntil(
      () => this.browser().$("button=Disable JDT LS Gradle import for this session").isExisting(),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "The Java project did not retain this-session Gradle import authorization",
      },
    );
  }
  async assertReportedTestSource() {
    const source = `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`;
    const failureLine =
      this.originalSource(source)
        .split(/\r\n|\r|\n/)
        .findIndex((line) =>
          line.includes('assertEquals("deliberate-failure", TestToken.VALUE);'),
        ) + 1;
    assert.ok(failureLine > 0, "the deliberately failing assertion has no source line");
    try {
      await this.browser().waitUntil(
        () => this.browser().execute((file, line) => {
          const tab = document.querySelector(`[role="tab"][data-path="${CSS.escape(file)}"]`);
          const host = document.querySelector('[data-testid="monaco-code-editor-host"]');
          const cursor = document.querySelector('[data-testid="editor-cursor-position"]');
          return tab?.getAttribute("aria-selected") === "true" &&
            !document.querySelector(".editor-opening-placeholder") &&
            host?.getAttribute("data-editor-file-path") === file &&
            host.getAttribute("data-reveal-requested-line") === String(line) &&
            host.getAttribute("data-editor-cursor-line") === String(line) &&
            cursor?.getAttribute("data-reveal-file-path") === file &&
            cursor.textContent?.trim() === `Ln ${line}, Col 1`;
        }, source, failureLine),
        { timeout: 20_000, interval: 50 },
      );
    } catch (cause) {
      const evidence = await this.browser().execute(() => {
        const results = document.querySelector('[aria-label="Java test results"]');
        return {
          status: Array.from(results?.querySelectorAll('[role="status"]') ?? [])
            .map((element) => element.textContent?.trim()).filter(Boolean),
          detail: results?.querySelector('pre[aria-label="Test detail for testScopeAndSamePathSource"]')?.textContent?.slice(0, 1200),
        };
      });
      throw new Error(`The test editor did not reveal line ${failureLine}, column 1. ${JSON.stringify(evidence)}`, { cause });
    }
    await this.surface().assertBuffer(source, this.originalSource(source), this.completeEditorReadBack());
    await this.surface().assertDirty(source, false);
    this.#proof.testResultSourceNavigation = true;
    this.#proof.namedClassLoaderFailureSourceNavigation = true;
    await this.assertSavedExecutionDraft();
  }
  async repairFailedTestInEditor() {
    const source = `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`;
    const original = this.originalSource(source);
    const repaired = original.replace(
      'assertEquals("deliberate-failure", TestToken.VALUE);',
      'assertEquals("test-token", TestToken.VALUE);',
    );
    assert.notEqual(repaired, original);
    // The preceding report navigation opened this exact test tab.
    const sourceTab = this.surface().tab(source);
    await sourceTab.waitForDisplayed({ timeout: 5000 });
    if ((await sourceTab.getAttribute("aria-selected")) !== "true") await sourceTab.click();
    await this.browser().waitUntil(
      async () => (await sourceTab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "the repaired test source tab did not become active",
      },
    );
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForExist({ reverse: true, timeout: 5000 });
    await this.browser()
      .$(`[role="textbox"][aria-label^="Code editor for ${source}"]`)
      .waitForDisplayed({ timeout: 5_000 });
    await this.surface().assertBuffer(source, original, this.completeEditorReadBack());
    await pasteNativeText(
      this.#app!,
      this.browser().$(`[role="textbox"][aria-label^="Code editor for ${source}"]`),
      repaired,
      {
        focus: () => this.surface().focus(source),
        verify: async () => {
          await this.surface().assertBuffer(source, repaired, this.completeEditorReadBack());
          return true;
        },
      },
    );
    await this.surface().assertDirty(source, true);
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.surface().focus(source);
    await this.browser().keys(["Control", "s"]);
    await this.browser().waitUntil(
      async () => (await readFile(this.file(source), "utf8")) === repaired,
      { timeout: 5_000, interval: 50 },
    );
    await this.surface().assertDirty(source, false);
  }
  async synchronizeContextAfterTestRepairWhenNeeded() {
    if (this.#executionTool !== "gradle") return false;
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.synchronizeGradle(true);
    // A stale in-flight semantic query can retire the SDK session and its evaluated
    // model after a save. The person must explicitly authorize reevaluation again.
    const needsEvaluation = (await this.panel().getText()).includes("gradle-declarative-v1 · partial");
    if (needsEvaluation) await this.evaluateGradle(false);
    await this.waitForText("gradle-effective-v1 · available");
    return needsEvaluation;
  }
  async rerunSynchronizedFailedTest(entry: "panel" | "commands" = "panel") {
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    await this.changeVisibleTestSettings();
    if (entry === "commands") {
      await this.invokeConfiguredExecutionCommand("Rerun failed Java tests");
      return;
    }
    const rerun = this.executionPanel()
      .$('[aria-label="Java test results"]')
      .$("button=Rerun failed tests");
    await rerun.scrollIntoView();
    await rerun.click();
  }
  async assertSynchronizedRerun() {
    await this.waitProjectExecution("test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    await this.assertMavenDependencyTestsSkipped();
    await this.assertTestProof(TEST_METHODS[1], 2);
    for (const method of [TEST_METHODS[0], TEST_METHODS[2]]) await this.assertTestProof(method, 1);
    const source = `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`;
    const repaired = this.originalSource(source).replace(
      'assertEquals("deliberate-failure", TestToken.VALUE);',
      'assertEquals("test-token", TestToken.VALUE);',
    );
    assert.equal(await readFile(this.file(source), "utf8"), repaired);
    await this.surface().assertDirty(source, false);
    this.#inputs.set(source, repaired);
    this.#proof.explicitlyRepairedTest = source;
    await this.assertSavedExecutionDraft();
    this.#proof.synchronizedFailedRerunRetainedSettings = true;
  }

  private projectDebuggerBreakpointLine() {
    const marker = this.#gradleCompositeProject
      ? 'System.out.println("GRADLE_COMPOSITE_RUN_OK:'
      : 'System.out.println("JAVA_REFERENCE_OK:';
    const line = this.originalSource(this.executionSource())
      .split("\n")
      .findIndex((value) => value.includes(marker));
    assert.ok(line >= 0, "the reference source has no independently observable application line");
    return line + 1;
  }
  private customGradleIntegrationBreakpointLine() {
    const source = "gradle/app/src/integrationTest/java/pkg/IntegrationRunner.java";
    const line = this.originalSource(source)
      .split("\n")
      .findIndex((value) => value.includes('System.out.println("INTEGRATION_SOURCE_SET_OK:'));
    assert.ok(line >= 0, "the integrationTest application source has no breakpoint statement");
    return line + 1;
  }
  private projectDebugPidFile() {
    return `${this.#executionTool}/app/project-debug-pid.txt`;
  }
  private async waitForSourceDebuggerReady() {
    await this.browser().waitUntil(
      async () => {
        const status = this.browser().$('[aria-label="Java source debugger"]');
        if (!(await status.isExisting())) return false;
        const text = await status.getText();
        return text === "Source debugging: ready" || text === "Saved source breakpoints";
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "JDI source breakpoint controls did not become ready",
      },
    );
  }
  private async clickProjectSourceBreakpoint(source: string, line: number) {
    const sourceTab = this.surface().tab(source);
    await sourceTab.waitForDisplayed({ timeout: 10_000 });
    if ((await sourceTab.getAttribute("aria-selected")) !== "true") await sourceTab.click();
    await this.browser().waitUntil(
      async () => (await sourceTab.getAttribute("aria-selected")) === "true",
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: `The breakpoint source tab did not activate: ${source}`,
      },
    );
    await this.surface().focus(source);
    await this.browser().keys(["Control", "Home"]);
    const gutterPoint = () => this.browser().execute((number: number) => {
      const editor = document.querySelector(".monaco-editor");
      const glyph = editor?.querySelector(".glyph-margin");
      if (!editor || !glyph) throw new Error("Native Monaco glyph margin is unavailable");
      const label = Array.from(editor.querySelectorAll(".margin-view-overlays .line-numbers")).find(
        (item) =>
          item.textContent?.trim() === String(number) && item.getBoundingClientRect().height > 0,
      );
      if (!label) return null;
      const column = glyph.getBoundingClientRect();
      const row = label.getBoundingClientRect();
      const x = Math.round(column.left + column.width / 2);
      const y = Math.round(row.top + row.height / 2);
      if (
        x < 0 ||
        y < 0 ||
        x >= innerWidth ||
        y >= innerHeight ||
        !editor.contains(document.elementFromPoint(x, y))
      )
        return null;
      return { x, y };
    }, line);
    const point = await this.browser().waitUntil(gutterPoint, {
      timeout: 5_000,
      interval: 50,
      timeoutMsg: `The breakpoint gutter for line ${line} in ${source} is not visible`,
    });
    await this.browser()
      .action("pointer")
      .move({ ...point, origin: "viewport" })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }
  private async waitForProjectDebuggerStatus(value: string, timeout = 30_000) {
    await this.browser().waitUntil(
      async () => {
        const view = this.executionPanel().$('[aria-label="Structured Java debugger"]');
        if (!(await view.isExisting())) return false;
        const status = view.$('[role="status"]');
        return (await status.isExisting()) && (await status.getText()) === "JDI: " + value;
      },
      {
        timeout,
        interval: 100,
        timeoutMsg: "Synchronized project JDI did not reach " + value,
      },
    );
  }
  async assertProjectModelClassRefactorings() {
    assert.ok(this.#proof.sdkProjectModelMoveReviewedAndSafeDeleteReviewed);
    assert.ok(this.#proof.sdkOpenJavaTabFollowsProjectModelMoveAndRollback);
    assert.ok(this.#proof.sdkProjectModelMoveSourceCopyCompiledAndTested);
    assert.ok(this.#proof.sdkCrossModuleClassMoveReviewedAppliedAndRolledBack);
    assert.ok(this.#proof.sdkCrossModuleClassMoveUpdatedDependentModuleReference);
    assert.ok(this.#proof.sdkCrossModuleClassMoveSourceCopyCompiledAndTested);
    assert.ok(this.#proof.sdkCrossModuleNewPackageDestinationSelected);
    assert.ok(this.#proof.sdkReferencedSafeDeleteRefusedWithoutChanges);
    assert.ok(this.#proof.sdkSafeDeleteWithMavenReferenceRemainsReadOnly);
    await this.assertInputs();
  }
  async assertProjectModelClassMoveCommandPalette() {
    assert.equal(this.#proof.sdkProjectModelClassMoveFromCommandPalette, true);
    await this.assertProjectModelClassRefactorings();
  }
  async assertProjectModelPackageMove() {
    assert.ok(this.#proof.sdkProjectModelPackageMoveReviewedAppliedAndRolledBack);
    if (this.#executionTool === "maven")
      assert.ok(this.#proof.sdkProjectModelPackageMoveSourceCopyCompiledAndTested);
    else assert.ok(this.#proof.sdkGradleProjectModelPackageMoveSourceCopyCompiledAndTested);
    await this.assertInputs();
  }
  async assertGradleProjectModelClassMove(crossModule = false) {
    assert.equal(this.#proof.sdkGradleProjectModelClassMoveReviewedAppliedAndRolledBack, true);
    assert.equal(this.#proof.sdkGradleProjectModelClassMoveSourceCopyCompiledAndTested, true);
    if (crossModule)
      assert.equal(this.#proof.sdkGradleCrossModuleClassMoveReviewedAppliedAndRolledBack, true);
    await this.assertInputs();
  }
  async assertProjectModelSourceRootMove() {
    assert.ok(this.#proof.sdkProjectModelSourceRootMoveReviewedAppliedAndRolledBack);
    assert.ok(this.#proof.sdkProjectModelSourceRootSourceCopyTested);
    await this.assertInputs();
  }
  private executionPanel() {
    return this.browser().$('section[aria-label="Java execution"]');
  }
  private async invokeConfiguredExecutionCommand(label: string) {
    await this.browser().$("button=Commands").click();
    const palette = this.browser().$('[role="dialog"][aria-label="Command palette"]');
    await palette.waitForDisplayed({ timeout: 5_000 });
    await pasteNativeText(this.#app!, palette.$('input[aria-label="Search commands"]'), label);
    const option = palette.$(`[role="option"][aria-label="${label} Java · Run"]`);
    await option.waitForDisplayed({ timeout: 5_000 });
    await option.click();
    await palette.waitForExist({ reverse: true, timeout: 15_000 });
    this.#proof.configuredExecutionCommands.push(label);
  }
  private async requestProjectExecution(label: string, entry: "panel" | "commands" = "panel") {
    if (entry === "commands") {
      const commands: Record<string, string> = {
        "Clean build outputs": "Clean configured Java project outputs",
        "Build": "Build configured Java project",
        "Rebuild": "Rebuild configured Java project",
        "Discover tests": "Discover configured Java tests",
        "Run tests": "Run configured Java tests",
        "Run tests with coverage": "Run configured Java tests with coverage",
      };
      assert.ok(commands[label], `No configured command for ${label}`);
      await this.invokeConfiguredExecutionCommand(commands[label]);
      return;
    }
    const button = this.executionPanel().$(`button=${label}`);
    await button.scrollIntoView();
    try {
      await button.waitForEnabled({ timeout: 5000 });
    } catch (error) {
      const state = await this.executionPanel().getText();
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nJava execution panel: ${state}`,
      );
    }
    await button.click();
  }
  private async waitProjectExecution(
    operation: string,
    state: "succeeded" | "failed" | "stopped",
    timeout = this.projectExecutionTimeout,
  ) {
    await this.browser().waitUntil(
      async () => {
        const text = await this.executionPanel().getText();
        const statuses = await readNativeJavaExecutionStatuses(this.browser());
        const hasStatus = (expected: string) => statuses.some((status) => {
          const prefix = `${operation}: ${expected}`;
          return status === prefix || status.startsWith(`${prefix} `);
        });
        const alerts = await this.executionPanel().$$('[role="alert"]').getElements();
        if (!hasStatus(state) && alerts.length)
          throw new Error(`Project execution refused: ${await alerts[0].getText()}`);
        if (
          state === "succeeded" &&
          (hasStatus("failed") || hasStatus("stopped")) &&
          (await this.executionPanel().$("button=Run tests").isEnabled())
        )
          throw new Error(`Project execution terminated unsuccessfully: ${text}`);
        return hasStatus(state);
      },
      {
        timeout,
        interval: 100,
        timeoutMsg: `Synchronized ${operation} did not finish as ${state}`,
      },
    );
  }
  private get projectExecutionTimeout() {
    return this.#javaRelease === 27 && this.#executionTool === "gradle" ? 60_000 : 25_000;
  }
  private async changeVisibleTestSettings() {
    const execution = this.executionPanel();
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Test JVM option 1").$("textarea"),
      "-Dcontext.gui.literal=changed current draft",
    );
    await pasteNativeText(
      this.#app!,
      execution.$("label*=Variable 1 value").$("textarea"),
      "changed current environment",
    );
    await pasteNativeText(
      this.#app!,
      execution.$('input[placeholder="com.example.MainTest#computes"]'),
      "pkg.RunnerTest#missingCurrentDraft",
    );
  }
  private async assertSavedExecutionDraft() {
    const source = this.executionSource();
    assert.equal(await readFile(this.file(source), "utf8"), ` ${this.originalSource(source)}`);
    await this.surface().assertDirty(source, false);
  }
  private async assertMavenDependencyTestsSkipped() {
    if (this.#executionTool !== "maven") return;
    await assert.rejects(access(this.file("maven/library/target/sibling-test-proof.txt")), { code: "ENOENT" });
    await assert.rejects(access(this.file("maven/library/target/surefire-reports/TEST-pkg.RunnerTest.xml")), { code: "ENOENT" });
    this.#proof.mavenDependencyTestsExcluded = true;
  }
  private testProofFile(method: string) {
    return this.file(`${this.#executionTool}/app/gui-proof-${method}.txt`);
  }
  private async assertTestProof(method: string, count: number) {
    const proof = await readFile(this.testProofFile(method), "utf8");
    assert.equal(
      proof,
      `${this.executionSdk()}|value with spaces|literal environment\n`.repeat(count),
    );
  }
  private async assertTestSummary(total: number, passed: number, failed: number) {
    const results = this.executionPanel().$('[aria-label="Java test results"]');
    await results.scrollIntoView();
    assert.ok(
      (await results.getText()).includes(
        `${total} reported tests: ${passed} passed, ${failed} failed, 0 errors, 0 skipped`,
      ),
    );
  }
  async assertSynchronizedRun() {
    const source = this.executionSource();
    const execution = this.browser().$('section[aria-label="Java execution"]');
    await this.browser().waitUntil(
      async () => {
        const text = await execution.getText();
        if (text.includes("run: failed") || text.includes("run: stopped"))
          throw new Error(`Synchronized Java Run terminated unsuccessfully: ${text}`);
        return text.includes("run: succeeded (exit 0)");
      },
      {
        timeout: this.projectExecutionTimeout,
        interval: 100,
        timeoutMsg: "Synchronized Java Run did not complete successfully",
      },
    );
    const output = await execution.$('[aria-label="Java console output"]').getText();
    assert.ok(
      output.includes(this.#executionTool === "maven" ? "BUILD SUCCESS" : "BUILD SUCCESSFUL"),
      output,
    );
    assert.ok(
      output.includes(
        "JAVA_REFERENCE_OK:hello JVM|count:2|generated-greeting|runtime-token|main-peer|",
      ),
      output,
    );
    assert.ok(output.includes(`PROJECT_GUI_JDK:${this.executionSdk()}`), output);
    if (this.#workspaceWrapper) {
      assert.equal(
        await readFile(this.wrapperInvocationRecord(), "utf8"),
        `IDE_WORKSPACE_WRAPPER:${this.#executionTool}\n`,
      );
      this.#proof.workspaceWrapperDispatchedToRealBuildTool = true;
    }
    const expectedSource = this.#executionDraftSavedBeforeProjectSync
      ? ` ${this.originalSource(source)}`
      : this.originalSource(source);
    assert.equal(await readFile(this.file(source), "utf8"), expectedSource);
    if (await this.surface().tab(source).isExisting())
      await this.surface().assertDirty(source, false);
    this.#proof.synchronizedModuleRunSavedDraft = true;
    this.#proof.synchronizedModuleRuntimeDependencies = true;
    this.#proof.synchronizedModuleSelectedJdk = true;
    if (this.#javaRelease === 8 || this.#javaRelease === 11) {
      const output = this.#executionTool === "maven"
        ? "maven/app/target/classes/pkg/Runner.class"
        : "gradle/app/build/classes/java/main/pkg/Runner.class";
      const bytecode = await readFile(this.file(output));
      assert.equal(bytecode.readUInt32BE(0), 0xcafebabe);
      assert.equal(bytecode.readUInt16BE(6), 44 + this.#javaRelease);
    }
    if (this.#executionTool === "maven") this.#proof.realMavenBuild = true;
    else this.#proof.realGradleBuild = true;
    if (this.#customMavenOutputs) {
      await access(this.file("maven/app/products/main/pkg/Runner.class"));
      await assert.rejects(access(this.file("maven/app/target/classes/pkg/Runner.class")), {
        code: "ENOENT",
      });
      this.#proof.synchronizedMavenMainOutputDirectory = true;
    } else if (this.#customGradleOutputs) {
      await access(this.file("gradle/app/build/products/main/pkg/Runner.class"));
      await assert.rejects(
        access(this.file("gradle/app/build/classes/java/main/pkg/Runner.class")),
        { code: "ENOENT" },
      );
      this.#proof.synchronizedGradleMainOutputDirectory = true;
    }
  }
  async restoreSavedExecutionSourceAndClose() {
    const source = this.executionSource();
    const original = this.originalSource(source);
    await this.surface().tab(source).click();
    if (this.#reviewedProjectSource) {
      assert.equal(await readFile(this.file(source), "utf8"), this.#reviewedProjectSource);
      await pasteNativeText(
        this.#app!,
        this.browser().$(`[role="textbox"][aria-label="Code editor for ${source}"]`),
        original,
        {
          focus: () => this.surface().focus(source),
          verify: async () => {
            await this.surface().assertBuffer(source, original, this.completeEditorReadBack());
            return true;
          },
        },
      );
      await this.surface().save(source);
      await this.browser().waitUntil(
        async () => (await readFile(this.file(source), "utf8")) === original,
        { timeout: 10_000, interval: 100 },
      );
      this.#reviewedProjectSource = null;
    }
    await this.browser().waitUntil(
      () =>
        this.browser().execute(
          (file) =>
            !document.querySelector(".editor-opening-placeholder") &&
            Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]')).some(
              (input) =>
                input.getAttribute("aria-label") === `Code editor for ${file}` &&
                input.getClientRects().length > 0,
            ),
          source,
        ),
      { timeout: 5_000, interval: 50, timeoutMsg: `The source editor for ${source} did not open` },
    );
    if ((await readFile(this.file(source), "utf8")) === original) {
      const dirty = await this.surface()
        .tab(source)
        .$('[aria-label="Unsaved changes"]')
        .isExisting();
      if (dirty) await this.surface().discardUsingDisk(source, original);
      else await this.surface().assertBuffer(source, original);
    } else {
      const savedDraft = ` ${original}`;
      assert.equal(
        await readFile(this.file(source), "utf8"),
        savedDraft,
        "The disk source changed beyond the exact saved draft used by this scenario.",
      );
      // The saved fixture edit is a single leading space.
      await this.surface().assertDirty(source, false);
      await this.surface().focus(source);
      await this.browser().keys(["Control", "Home"]);
      await this.browser().keys("Delete");
      await this.surface().assertDirty(source, true);
      await this.browser().keys(["Control", "s"]);
      await this.browser().waitUntil(
        async () => (await readFile(this.file(source), "utf8")) === original,
        { timeout: 15_000, interval: 100 },
      );
    }
    assert.equal(await readFile(this.file(source), "utf8"), original);
    await this.surface().assertDirty(source, false);
    await this.#app!.closeNativeWindow();
  }
  async assertMaven() {
    const text = await this.panel().getText();
    assert.ok(text.includes("maven-effective-v1 · available"), text);
    assert.ok(text.includes(this.#sdk), text);
    const options = await this.panel()
      .$("label=Module and source set")
      .$("select")
      .$$("option")
      .getElements();
    const names = await options.map((option) => option.getText());
    for (const name of ["processor", "library", "runtime", "testsupport", "unrelated", "app"])
      assert.ok(
        names.some((entry) => entry.startsWith(this.projectSourceSetLabel(name, "main", "main"))),
        `Missing module ${name}: ${names.join(", ")}`,
      );
    await this.chooseSourceSet("main");
    assert.ok((await this.panel().getText()).includes("app/target/generated-sources/annotations"));
    const compile = await this.classpath("Compile"),
      runtime = await this.classpath("Runtime");
    assert.ok(
      compile.some((entry) => entry.includes("library/target/classes")),
      JSON.stringify(compile),
    );
    assert.ok(
      !compile.some(
        (entry) =>
          entry.includes("runtime/target/classes") || entry.includes("testsupport/target/classes"),
      ),
      JSON.stringify(compile),
    );
    assert.ok(
      runtime.some((entry) => entry.includes("runtime/target/classes")),
      JSON.stringify(runtime),
    );
    await this.chooseSourceSet("test");
    const test = await this.classpath("Compile");
    assert.ok(
      test.some((entry) => entry.includes("testsupport/target/classes")),
      JSON.stringify(test),
    );
    assert.ok(
      test.some((entry) => entry.includes("junit-4.13.2.jar")),
      JSON.stringify(test),
    );
    const compileDetails = this.panel().$(".//details[starts-with(summary, 'Compile classpath')]");
    const compileDetailsText = await compileDetails.getText();
    assert.ok(
      compileDetailsText.includes("junit:junit:4.13.2"),
      `The test classpath row lost its Maven artifact identity: ${compileDetailsText}`,
    );
    const resolvedArtifacts = this.panel().$(
      ".//details[starts-with(summary, 'Resolved artifacts')]",
    );
    await resolvedArtifacts.$("summary").scrollIntoView();
    if ((await resolvedArtifacts.getAttribute("open")) === null)
      await resolvedArtifacts.$("summary").click();
    const resolvedArtifactsText = await resolvedArtifacts.getText();
    assert.ok(
      resolvedArtifactsText.includes("junit:junit:4.13.2"),
      `Resolved artifacts omitted JUnit GAV: ${resolvedArtifactsText}`,
    );
    assert.ok(
      resolvedArtifactsText.includes("jar · test · direct"),
      `Resolved artifacts omitted extension, scope or transitivity: ${resolvedArtifactsText}`,
    );
    this.#proof.mavenArtifactCoordinatesAndNestedRows = true;
    this.#proof.effectiveMavenModulesAndGeneratedRoots = true;
    this.#proof.mainAndTestClasspathScopes = true;
    await this.assertDraft();
    await this.assertInputs();
  }
  async inspectSources() {
    const ownership = {
      kind: "main",
      symbol: "pkg.Peer",
      expected: "pkg.Peer: maven/app/src/main/java/pkg/Runner.java",
    };
    if (await this.attemptOwnership(ownership)) return;
    this.#pendingOwnershipRecovery = ownership;
  }
  async compileMavenTestOutputAfterContext() {
    await this.waitForMavenOutputsToSettle();
    const source = this.file("maven/app/src/test/java/pkg/BackgroundOutputProbe.java");
    const output = this.file("maven/app/target/test-classes/pkg/BackgroundOutputProbe.class");
    await assert.rejects(access(source), (error: unknown) =>
      ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""),
    );
    await assert.rejects(access(output), (error: unknown) =>
      ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""),
    );
    await writeFile(source, "package pkg;\npublic final class BackgroundOutputProbe {}\n", {
      flag: "wx",
    });
    this.#generatedOutputProbeCreated = true;
    await promisify(execFile)(
      "mvn",
      ["-B", "-o", "-Dstyle.color=never", `-Dmaven.repo.local=${this.#repository}`, "test-compile"],
      {
        cwd: this.file("maven"),
        env: { ...process.env, JAVA_HOME: this.#sdk },
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      },
    );
    await access(output);
    await this.assertInputs();
  }
  async reacquireMavenContextAfterBackgroundCompilation() {
    const pendingRecovery = this.#pendingOwnershipRecovery;
    if (pendingRecovery) {
      await this.waitForMavenOutputsToSettle();
      await this.synchronizeMaven();
      assert.equal(
        await this.attemptOwnership(pendingRecovery),
        true,
        "Maven source ownership remained stale after an explicit resynchronization",
      );
      this.#pendingOwnershipRecovery = undefined;
    }

    const testOwnership = {
      kind: "test",
      symbol: "pkg.Unrelated",
      expected: "pkg.Unrelated: maven/app/src/test/java/pkg/Runner.java",
    };
    // Creating and compiling the additional Java source can retire the acquired
    // context while its watcher event is delivered. Reacquire explicitly before
    // trying to choose a source set; without context the selector is intentionally absent.
    if (!(await this.panel().$('select[aria-label="Module and source set"]').isExisting())) {
      await this.waitForMavenOutputsToSettle();
      await this.synchronizeMaven();
      this.#proof.contextReacquiredAfterGeneratedOutputChange = true;
    }
    if (!(await this.attemptOwnership(testOwnership))) {
      await this.waitForMavenOutputsToSettle();
      await this.synchronizeMaven();
      assert.equal(
        await this.attemptOwnership(testOwnership),
        true,
        "Maven test-source ownership remained stale after an explicit resynchronization",
      );
    }
  }
  async assertOwnership() {
    assert.ok(
      (await this.panel().getText()).includes(
        "pkg.Unrelated: maven/app/src/test/java/pkg/Runner.java",
      ),
    );
    this.#proof.mainAndTestSourceOwnership = true;
    await this.assertDraft();
    await this.assertInputs();
  }
  async changeDescriptorOutsideTheIDE() {
    const pom = this.#inputs.get("maven/pom.xml")!;
    await writeFile(
      this.file("maven/pom.xml"),
      pom.replace("<greeting.fixture.mode>base", "<greeting.fixture.mode>alternate"),
    );
    await this.waitForText("Java project files changed on disk.");
  }
  async assertProjectWatchRetirement() {
    const panel = this.panel();
    await this.waitForText("Java project files changed on disk.");
    assert.ok(!(await panel.getText()).includes("Effective project context"));
    assert.equal(await panel.$("button=Resolve source ownership").isExisting(), false);
    await writeFile(this.file("maven/pom.xml"), this.#inputs.get("maven/pom.xml")!);
    this.#proof.projectContextRetiredAfterInputChange = true;
    await this.assertDraft();
    await this.assertInputs();
  }
  async synchronizeGradle(allowEffectiveResult = false) {
    await this.fill('input[placeholder="Workspace root"]', "gradle");
    await this.fill('input[placeholder="Full JDK directory"]', this.#gradleSdk);
    const syncButton = this.panel().$("button=Synchronize project");
    const disabledBeforeSync = await syncButton.getAttribute("disabled");
    await syncButton.click();
    if (!allowEffectiveResult) {
      await this.waitForText("Partial project context");
      return;
    }
    const synchronizationState = () =>
      this.browser().execute(() => {
        const panel = document.querySelector<HTMLElement>(
          'section[aria-label="Java project context"]',
        );
        if (!panel) return null;
        const syncButton = Array.from(panel.querySelectorAll("button")).find((button) =>
          ["Synchronize project", "Synchronizing…"].includes(button.textContent?.trim() ?? ""),
        );
        return {
          button: syncButton?.textContent?.trim() ?? null,
          available: panel.innerText.includes("gradle-effective-v1 · available"),
          partial: panel.innerText.includes("Partial project context"),
          error: panel.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
        };
      });
    try {
      await this.browser().waitUntil(
        async () => (await synchronizationState())?.button === "Synchronizing…",
        {
          timeout: 5_000,
          interval: 20,
          timeoutMsg: "Gradle project synchronization did not start",
        },
      );
      await this.browser().waitUntil(
        async () => {
          const state = await synchronizationState();
          return Boolean(
            state?.button === "Synchronize project" &&
            !state.error &&
            (state.available || state.partial),
          );
        },
        {
          timeout: 60_000,
          interval: 100,
          timeoutMsg: "Gradle project synchronization did not restore a usable context",
        },
      );
    } catch (failure) {
      const state = await synchronizationState();
      const controls = await this.browser().execute(() =>
        Array.from(document.querySelectorAll("button"))
          .filter((button) =>
            ["Synchronize project", "Evaluate Gradle project"].includes(
              button.textContent?.trim() ?? "",
            ),
          )
          .map((button) => ({
            label: button.textContent?.trim() ?? "",
            disabled: (button as HTMLButtonElement).disabled,
            ariaDisabled: button.getAttribute("aria-disabled"),
          })),
      );
      const panelText = (await this.panel().getText()).slice(0, 1800);
      throw new Error(
        `Gradle project synchronization did not complete; disabledBeforeSync=${disabledBeforeSync}; state=${JSON.stringify(state)}; controls=${JSON.stringify(controls)}; panel=${panelText}; cause=${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  }
  async assertPartialGradle() {
    const text = await this.panel().getText();
    assert.ok(text.includes("gradle-declarative-v1 · partial"), text);
    assert.ok(!text.includes("Effective project context"));
    await this.chooseSourceSet("main", "gradle-declarative-v1");
    await this.openOwnership();
    await this.fill('input[placeholder="pkg/Runner.java"]', "pkg/Runner.java");
    assert.equal(await this.panel().$("button=Resolve source ownership").isEnabled(), false);
    // The readonly engine must not execute this build or create compilation output.
    for (const relative of ["gradle/.gradle", "gradle/app/build", "gradle/processor/build"]) {
      await assert.rejects(
        access(this.file(relative)),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      );
    }
    this.#proof.gradleExplicitlyPartial = true;
    await this.assertDraft();
    await this.assertInputs();
  }
  async evaluateGradle(prepareOutputs = true, fromCommands = false) {
    const executable = await realpath(
      process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle",
    );
    const configuredHome = process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME;
    assert.ok(
      configuredHome && path.isAbsolute(configuredHome),
      "Set IDE_JAVA_CONTEXT_GRADLE_USER_HOME to the populated offline Gradle cache.",
    );
    const userHome = await realpath(configuredHome);
    // A real build prepares dependency and generated-source outputs. The subsequent
    // UI action requests metadata only, using the user's explicit build-code authorization.
    if (prepareOutputs) {
      const buildRoot = this.#gradleCompositeProject
        ? this.file("gradle/included-build")
        : this.file("gradle");
      const tasks = this.#gradleCompositeProject
        ? [":app:classes", ":app:testClasses"]
        : ["classes", "testClasses"];
      await promisify(execFile)(
        executable,
        ["--offline", "--no-daemon", "--console=plain", "-g", userHome, ...tasks],
        {
          cwd: buildRoot,
          env: { ...process.env, JAVA_HOME: this.#gradleRuntimeSdk || this.#gradleSdk },
          timeout: 90_000,
          maxBuffer: 512 * 1024,
        },
      );
      this.#proof.realGradleBuild = true;
    }
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const details = this.panel().$(".//details[summary='Gradle settings']");
    if ((await details.getAttribute("open")) === null) await details.$("summary").click();
    await this.fill('input[placeholder="Absolute Gradle or wrapper executable"]', executable);
    if (this.#gradleRuntimeSdk)
      await this.fill('input[placeholder="Defaults to project JDK"]', this.#gradleRuntimeSdk);
    await this.fill('input[placeholder="Gradle default user home"]', userHome);
    if (this.#selectedTestDebugFixture && this.#javaRelease === 27) {
      await this.panel().$("button=Synchronize project").click();
      await this.waitForText("Use Evaluate Gradle project to load build metadata.");
      assert.match(await this.panel().$('[role="alert"]').getText(), /Java source level '27'/u);
      assert.equal(await this.panel().$("button=Evaluate Gradle project").isEnabled(), true);
      assert.equal(await this.panel().$("button=Resolve source ownership").isExisting(), false);
      for (const relative of ["gradle/.gradle", "gradle/app/build", "gradle/processor/build"]) {
        await assert.rejects(access(this.file(relative)), { code: "ENOENT" });
      }
      this.#proof.java27GradleReadOnlyRefusalExplained = true;
    }
    if (fromCommands) await this.invokeProjectContextCommand("Evaluate Gradle Project and Synchronize");
    else await this.panel().$("button=Evaluate Gradle project").click();
    await this.browser().waitUntil(
      async () => (await this.panel().getText()).includes("gradle-effective-v1 · available"),
      {
        timeout: 135_000,
        interval: 200,
        timeoutMsg: "Explicit Gradle evaluation did not provide an available Gradle provider",
      },
    );
    await this.browser().waitUntil(
      () => this.panel().$("button=Evaluate Gradle project").isEnabled(),
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "Gradle project evaluation did not finish before execution",
      },
    );
  }
  async prepareGradlePreviewImport() {
    assert.equal(this.#executionTool, "gradle");
    if (this.#proof.gradlePreviewRelease === 27) {
      await this.fill('input[placeholder="Workspace root"]', "gradle");
    } else {
      await this.synchronizeGradle(false);
    }

    const executable = await realpath(
      process.env.IDE_JAVA_CONTEXT_TEST_GRADLE ?? "/usr/bin/gradle",
    );
    const configuredHome = process.env.IDE_JAVA_CONTEXT_GRADLE_USER_HOME;
    assert.ok(
      configuredHome && path.isAbsolute(configuredHome),
      "Set IDE_JAVA_CONTEXT_GRADLE_USER_HOME to the Gradle cache for preview acceptance.",
    );
    const userHome = await realpath(configuredHome);
    const details = this.panel().$(".//details[summary='Gradle settings']");
    if ((await details.getAttribute("open")) === null) await details.$("summary").click();
    await this.fill('input[placeholder="Absolute Gradle or wrapper executable"]', executable);
    if (this.#gradleRuntimeSdk)
      await this.fill('input[placeholder="Defaults to project JDK"]', this.#gradleRuntimeSdk);
    await this.fill('input[placeholder="Gradle default user home"]', userHome);
    await this.authorizeGradleImportForJdtLs();
    await this.startLanguageServiceWithSdk(this.#gradleSdk);

    const sourcePath = "gradle/app/src/main/java/pkg/PreviewFixture.java";
    const source = this.#inputs.get(sourcePath);
    assert.ok(source, "The Gradle preview source fixture was not created");
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    const parts = sourcePath.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      const folder = this.browser().$(`[role="treeitem"][data-path="${folderPath}"]`);
      await folder.waitForDisplayed({ timeout: 5_000, interval: 50 });
      if ((await folder.getAttribute("aria-expanded")) !== "true") {
        await folder.scrollIntoView();
        await folder.click();
        await this.browser().waitUntil(
          async () => (await folder.getAttribute("aria-expanded")) === "true",
          {
            timeout: 5_000,
            interval: 50,
            timeoutMsg: `The native file explorer did not expand ${folderPath}`,
          },
        );
      }
    }
    await this.surface().open(sourcePath, source);
    await this.waitForPreviewErrorMarker(sourcePath, true);
  }

  async assertGradlePreviewOptionApplied() {
    const sourcePath = "gradle/app/src/main/java/pkg/PreviewFixture.java";
    const appliedMessage =
      "Applied the verified Gradle preview compiler setting to the matching JDT LS projects.";
    const previousMessage =
      "Project context synchronized, but automatic change tracking is unavailable. Synchronize manually after project changes.";
    const statusMessages = () =>
      this.browser().execute(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[aria-label="Java project context"] [role="status"]',
          ),
        )
          .map((element) => element.innerText.trim())
          .filter(Boolean),
      );
    const alert = this.panel().$('[role="alert"]');
    await this.browser().waitUntil(
      async () => {
        if (await alert.isDisplayed().catch(() => false)) return true;
        return (await statusMessages()).some(
          (message) =>
            message === appliedMessage ||
            (message !== previousMessage && /JDT LS|Gradle (preview|compiler)/iu.test(message)),
        );
      },
      {
        timeout: 30_000,
        interval: 200,
        timeoutMsg: "The IDE did not report the Gradle preview synchronization outcome",
      },
    );
    const outcomeMessage =
      (await statusMessages()).find(
        (message) =>
          message === appliedMessage ||
          (message !== previousMessage && /JDT LS|Gradle (preview|compiler)/iu.test(message)),
      ) ?? "";
    const errorMessage = await alert.getText().catch(() => "");
    if (errorMessage || outcomeMessage !== appliedMessage) {
      throw new Error(
        `JDT LS did not apply Gradle's verified --enable-preview setting; error=${JSON.stringify(errorMessage)}; outcome=${JSON.stringify(outcomeMessage)}`,
      );
    }
    const markerCount = await this.previewErrorMarkerCount(sourcePath);
    if (markerCount !== 0) {
      const problemsTab = this.browser().$('[role="tab"][aria-label^="Problems"]');
      if (await problemsTab.isDisplayed()) await problemsTab.click();
      const diagnostics = await this.browser().execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-label]'))
          .map((element) => element.getAttribute("aria-label"))
          .filter((label): label is string => label !== null)
          .slice(0, 20),
      );
      const jdtlsStatus = await this.browser()
        .$('[aria-label="Eclipse JDT LS lifecycle status"]')
        .getText()
        .catch(() => "unavailable");
      throw new Error(
        `JDT LS accepted the setting but retained ${markerCount} editor error marker(s); lifecycle=${jdtlsStatus}; Problems=${JSON.stringify(diagnostics)}`,
      );
    }
    await access(this.file("gradle/app/build/classes/java/main/pkg/PreviewFixture.class"));
    const original = this.#inputs.get(sourcePath)!;
    const invalidDraft = original.replace("class PreviewFixture {", "class PreviewFixture {\n  UnknownPreviewFixtureType unrelated;");
    assert.notEqual(invalidDraft, original);
    await this.browser().$('[role="tab"][aria-label="Files"]').click();
    await this.surface().tab(sourcePath).click();
    await this.surface().replace(sourcePath, invalidDraft);
    await this.browser().$('[role="tab"][aria-label^="Problems"]').click();
    await this.browser().waitUntil(
      async () => (await this.browser().$('[aria-label="Problems list"]').getText().catch(() => ""))
        .includes("UnknownPreviewFixtureType cannot be resolved"),
      { timeout: 30_000, interval: 100, timeoutMsg: "JDT LS did not diagnose an unrelated missing type after enabling preview" },
    );
    this.#proof.gradlePreviewUnrelatedDraftDiagnosticPresented = true;
    await this.surface().replace(sourcePath, original, false);
    await this.waitForPreviewErrorMarker(sourcePath, false);
    assert.equal(
      await readFile(this.file(sourcePath), "utf8"),
      this.#inputs.get(sourcePath),
      "Gradle preview synchronization must not rewrite the Java source",
    );
    this.#proof.gradlePreviewCompilerSettingAppliedToJdtLs = true;
    this.#proof.gradlePreviewOptionAppliedAndDiagnosticCleared = true;
    this.#proof.realGradleBuild = true;
  }

  async assertGradlePreviewErrorBeforeContext() {
    await this.waitForPreviewErrorMarker("gradle/app/src/main/java/pkg/PreviewFixture.java", true);
  }

  private async previewErrorMarkerCount(sourcePath: string) {
    return this.browser().execute((file: string) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${file}`);
      const host = input?.closest(".monaco-code-editor-host");
      return host?.querySelectorAll(".squiggly-error").length ?? 0;
    }, sourcePath);
  }

  private async waitForPreviewErrorMarker(sourcePath: string, visible: boolean) {
    await this.browser().waitUntil(
      async () => (await this.previewErrorMarkerCount(sourcePath)) > 0 === visible,
      {
        timeout: 90_000,
        interval: 200,
        timeoutMsg: visible
          ? "JDT LS did not report the initial Gradle preview-feature mismatch"
          : "JDT LS kept the Gradle preview-feature error after applying project metadata",
      },
    );
  }
  async assertEffectiveGradle() {
    const text = await this.panel().getText();
    assert.ok(text.includes("gradle-effective-v1 · available"), text);
    await this.resolve("main", "pkg.Peer", "Gradle");
    await this.waitForText("app/src/main/java/pkg/Runner.java");
    const owner = await this.panel().getText();
    assert.ok(owner.includes("app/src/main/java/pkg/Runner.java"), owner);
    await this.assertDraft();
    await this.assertInputs();
    this.#proof.gradleExplicitEvaluationAndSourceOwnership = true;
  }
  async assertGradleJpmsContext() {
    assert.ok(this.#gradleJpmsArtifactPath);
    const panel = this.panel();
    const text = await panel.getText();
    assert.ok(text.includes("gradle-effective-v1 · available"), text);
    const moduleSelector = panel.$('select[aria-label="Module and source set"]');
    const labels = await (
      await moduleSelector.$$("option").getElements()
    ).map((option) => option.getText());
    const main = labels.find((label) =>
      label.startsWith("Gradle · gradle-jpms-reference · main (main)"),
    );
    assert.ok(main, `The provider did not expose the JPMS source set: ${labels.join(", ")}`);
    await moduleSelector.selectByVisibleText(main);
    const jpmsSummary = panel.$("summary=Java module system · partial");
    await jpmsSummary.waitForDisplayed({ timeout: 5000 });
    await jpmsSummary.click();
    const metadata = await panel.getText();
    assert.ok(metadata.includes("test-modules/fixture-dependency.jar"), metadata);
    assert.ok(metadata.includes("fixture.dependency"), metadata);
    assert.ok(metadata.includes("fixture.gradle: gradle/src/main/java/module-info.java"), metadata);
    assert.ok(metadata.includes("requires fixture.dependency"), metadata);
    assert.ok(metadata.includes("exports fixture.api"), metadata);
    assert.ok(metadata.includes("Provider did not report: opens, uses, provides."), metadata);
    await panel.$("button=Request Java module-system details").click();
    await this.waitForText("The requested JPMS facts are incomplete or ambiguous.");
    const refused = await panel.getText();
    assert.ok(refused.includes("The requested JPMS facts are incomplete or ambiguous."), refused);
    assert.equal(await panel.$("button=Resolve source ownership").isExisting(), false);
    assert.equal(
      createHash("sha256")
        .update(await readFile(this.#gradleJpmsArtifactPath))
        .digest("hex"),
      this.#gradleJpmsArtifactSha256,
      "The Gradle module-path JAR changed during native context evaluation",
    );
    await this.assertInputs();
    this.#proof.gradleJpmsContextPresented = true;
    this.#proof.gradleJpmsModulePathPreserved = true;
    this.#proof.gradleJpmsRequiredFactRefused = true;
  }
  async assertGradleJpmsV5Context() {
    assert.ok(this.#gradleJpmsArtifactPath);
    const panel = this.panel();
    const moduleSelector = panel.$('select[aria-label="Module and source set"]');
    const labels = await (
      await moduleSelector.$$("option").getElements()
    ).map((option) => option.getText());
    const main = labels.find((label) =>
      label.startsWith("Gradle · gradle-jpms-reference · main (main)"),
    );
    assert.ok(main, `The provider did not expose the JPMS source set: ${labels.join(", ")}`);
    await moduleSelector.selectByVisibleText(main);
    const jpmsSummary = panel.$("summary=Java module system · partial");
    await jpmsSummary.waitForDisplayed({ timeout: 5000 });
    await jpmsSummary.click();
    const partial = await panel.getText();
    assert.ok(partial.includes("Provider did not report: opens, uses, provides."), partial);
    await panel.$("button=Request Java module-system details").click();
    await this.waitForText("Java module system · complete");
    const complete = await panel.getText();
    assert.ok(complete.includes("requires fixture.dependency (transitive)"), complete);
    assert.ok(complete.includes("exports fixture.api to fixture.dependency"), complete);
    assert.ok(complete.includes("opens fixture.api to fixture.dependency"), complete);
    assert.ok(complete.includes("uses fixture.service.Service"), complete);
    assert.ok(
      complete.includes("provides fixture.service.Service with fixture.service.Provider"),
      complete,
    );
    assert.ok(!complete.includes("Provider did not report:"), complete);
    assert.equal(await panel.$("button=Request Java module-system details").isExisting(), false);
    assert.equal(
      createHash("sha256")
        .update(await readFile(this.#gradleJpmsArtifactPath))
        .digest("hex"),
      this.#gradleJpmsArtifactSha256,
      "The Gradle module-path JAR changed during native context evaluation",
    );
    await this.assertInputs();
    this.#proof.gradleJpmsV5CompleteContextPresented = true;
    this.#proof.gradleJpmsModulePathPreserved = true;
  }
  private async configureGradleJpmsV5NamedModule(firstArgument: string, addArguments: boolean) {
    await this.configureSynchronizedExecution("main", "fixture.app.Main", "gradle-jpms-reference");
    const execution = this.executionPanel();
    const launchAsModule = execution.$("label*=Launch Run/Debug as a named JPMS module").$("input");
    if (!(await launchAsModule.isSelected())) await launchAsModule.click();
    if (addArguments) {
      await execution.$("button=Add argument").click();
      await execution.$("button=Add argument").click();
      await execution.$("button=Add argument").click();
      await pasteNativeText(
        this.#app!,
        execution.$("label*=Argument 1").$("textarea"),
        firstArgument,
      );
      await pasteNativeText(
        this.#app!,
        execution.$("label*=Argument 2").$("textarea"),
        "two words",
      );
    } else {
      await pasteNativeText(
        this.#app!,
        execution.$("label*=Argument 1").$("textarea"),
        firstArgument,
      );
    }
  }
  async runGradleJpmsV5NamedModule() {
    await this.configureGradleJpmsV5NamedModule("run", true);
    await this.requestProjectExecution("Run");
  }
  async assertGradleJpmsV5NamedModuleRun() {
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("GRADLE_JPMS_OK:fixture.dependency:run|two words|"), output);
    await access(this.file("gradle/build/classes/java/main/fixture/app/Main.class"));
    await this.assertInputs();
    this.#proof.gradleJpmsV5NamedModuleRun = true;
    this.#proof.realGradleBuild = true;
  }
  async startGradleJpmsV5NamedModuleDebug() {
    await this.synchronizeGradleForExecution();
    await this.assertGradleJpmsV5Context();
    await this.configureGradleJpmsV5NamedModule("debug", false);
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.requestProjectExecution("Debug");
  }
  async assertGradleJpmsV5NamedModuleDebugEntry() {
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(!output.includes("GRADLE_JPMS_OK:fixture.dependency:debug|two words|"), output);
    this.#proof.gradleJpmsV5NamedModuleDebugEntry = true;
  }
  async assertGradleJpmsV5NamedModuleDebugCompleted() {
    await this.waitProjectExecution("debug", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("GRADLE_JPMS_OK:fixture.dependency:debug|two words|"), output);
    await this.assertInputs();
    this.#proof.gradleJpmsV5NamedModuleDebugCompleted = true;
    this.#proof.realGradleBuild = true;
  }
  async assertMavenJpmsV5Context() {
    assert.ok(this.#mavenJpmsArtifactPath);
    const panel = this.panel();
    const moduleSelector = panel.$('select[aria-label="Module and source set"]');
    const labels = await (
      await moduleSelector.$$("option").getElements()
    ).map((option) => option.getText());
    const main = labels.find((label) => label.startsWith("Maven · maven · main (main) · fixture:app:1.0"));
    assert.ok(main, `The provider did not expose the Maven JPMS source set: ${labels.join(", ")}`);
    await moduleSelector.selectByVisibleText(main);
    const jpmsSummary = panel.$("summary=Java module system · partial");
    await jpmsSummary.waitForDisplayed({ timeout: 5000 });
    await jpmsSummary.click();
    const partial = await panel.getText();
    assert.ok(partial.includes("Provider did not report: opens, uses, provides."), partial);
    await panel.$("button=Request Java module-system details").click();
    await this.waitForText("Java module system · complete");
    const complete = await panel.getText();
    assert.ok(complete.includes("requires fixture.dependency (transitive)"), complete);
    assert.ok(complete.includes("exports fixture.api to fixture.dependency"), complete);
    assert.ok(complete.includes("opens fixture.api to fixture.dependency"), complete);
    assert.ok(complete.includes("uses fixture.service.Service"), complete);
    assert.ok(
      complete.includes("provides fixture.service.Service with fixture.service.Provider"),
      complete,
    );
    assert.ok(complete.includes("dependency-1.jar"), complete);
    assert.ok(!complete.includes("Provider did not report:"), complete);
    assert.equal(await panel.$("button=Request Java module-system details").isExisting(), false);
    assert.equal(
      createHash("sha256")
        .update(await readFile(this.#mavenJpmsArtifactPath))
        .digest("hex"),
      this.#mavenJpmsArtifactSha256,
      "The Maven module-path JAR changed during native context evaluation",
    );
    await this.assertInputs();
    this.#proof.mavenJpmsV5CompleteContextPresented = true;
  }
  private async configureMavenJpmsV5NamedModule(firstArgument: string, addArguments: boolean) {
    await this.configureSynchronizedExecution("main", "fixture.app.Main", "maven");
    const execution = this.executionPanel();
    const launchAsModule = execution.$("label*=Launch Run/Debug as a named JPMS module").$("input");
    if (!(await launchAsModule.isSelected())) await launchAsModule.click();
    if (addArguments) {
      await execution.$("button=Add argument").click();
      await execution.$("button=Add argument").click();
      await execution.$("button=Add argument").click();
      await pasteNativeText(
        this.#app!,
        execution.$("label*=Argument 1").$("textarea"),
        firstArgument,
      );
      await pasteNativeText(
        this.#app!,
        execution.$("label*=Argument 2").$("textarea"),
        "two words",
      );
    } else {
      await pasteNativeText(
        this.#app!,
        execution.$("label*=Argument 1").$("textarea"),
        firstArgument,
      );
    }
  }
  async runMavenJpmsV5NamedModule() {
    await this.configureMavenJpmsV5NamedModule("run", true);
    await this.requestProjectExecution("Run");
  }
  async assertMavenJpmsV5NamedModuleRun() {
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("MAVEN_JPMS_OK:fixture.dependency:run|two words|"), output);
    await access(this.file("maven/target/classes/fixture/app/Main.class"));
    assert.equal(
      createHash("sha256")
        .update(await readFile(this.#mavenJpmsArtifactPath))
        .digest("hex"),
      this.#mavenJpmsArtifactSha256,
      "The Maven module-path JAR changed during named-module Run",
    );
    await this.assertInputs();
    this.#proof.mavenJpmsV5NamedModuleRun = true;
    this.#proof.realMavenBuild = true;
  }
  async startMavenJpmsV5NamedModuleDebug() {
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.panel().waitForDisplayed({ timeout: 5000 });
    await this.synchronizeMaven();
    await this.assertMavenJpmsV5Context();
    await this.configureMavenJpmsV5NamedModule("debug", false);
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.requestProjectExecution("Debug");
  }
  async assertMavenJpmsV5NamedModuleDebugEntry() {
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(!output.includes("MAVEN_JPMS_OK:fixture.dependency:debug|two words|"), output);
    this.#proof.mavenJpmsV5NamedModuleDebugEntry = true;
  }
  async assertMavenJpmsV5NamedModuleDebugCompleted() {
    await this.waitProjectExecution("debug", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("MAVEN_JPMS_OK:fixture.dependency:debug|two words|"), output);
    assert.equal(
      createHash("sha256")
        .update(await readFile(this.#mavenJpmsArtifactPath))
        .digest("hex"),
      this.#mavenJpmsArtifactSha256,
      "The Maven module-path JAR changed during named-module Debug",
    );
    await this.assertInputs();
    this.#proof.mavenJpmsV5NamedModuleDebugCompleted = true;
    this.#proof.realMavenBuild = true;
  }
  async assertGradleCompositeProjectContext() {
    assert.equal(this.#gradleCompositeProject, true);
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const panel = this.panel();
    const modules = panel.$('select[aria-label="Module and source set"]');
    const labels = await (
      await modules.$$("option").getElements()
    ).map((option) => option.getText());
    const app = labels.find((label) => label.startsWith("Gradle · app · main (main)"));
    assert.ok(app, `The provider did not list the included app project: ${labels.join(", ")}`);
    assert.ok(
      labels.some((label) => label.startsWith("Gradle · library · main (main)")),
      `The provider did not list the included library project: ${labels.join(", ")}`,
    );
    await modules.selectByVisibleText(app);
    await this.openOwnership();
    await this.fill('input[placeholder="pkg/Runner.java"]', "pkg/Runner.java");
    await this.fill('input[placeholder="pkg.Runner"]', "pkg.Runner");
    await panel.$("button=Resolve source ownership").click();
    await this.browser().waitUntil(
      async () => {
        const text = await panel.getText();
        return (
          text.includes("Gradle build root: gradle/included-build") &&
          text.includes("Gradle project path: :app") &&
          text.includes("Workspace-relative module directory: gradle/app") &&
          /pkg\.Runner: gradle\/app\/src\/main\/java\/pkg\/Runner\.java · gradle-[^ ]+::app\/main/.test(
            text,
          )
        );
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "The provider-qualified Gradle composite context did not resolve Runner",
      },
    );
    const contextText = await panel.getText();
    assert.ok(contextText.includes("gradle-effective-v1 · available"), contextText);
    await this.assertSavedExecutionDraft();
    await this.assertGradleCompositeExecutionIdentity();
  }
  async assertGradleCompositeExecutionIdentity() {
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
    const execution = this.executionPanel();
    const executionModules = execution.$("label=Synchronized module and source set").$("select");
    const options = await executionModules.$$("option").getElements();
    const optionDetails = await options.map(async (option) => ({
      label: await option.getText(),
      value: await option.getAttribute("value"),
    }));
    const compositeApp = optionDetails.find(({ label, value }) => {
      if (!value) return false;
      const [providerId, moduleId, sourceSetId] = JSON.parse(value) as [string, string, string];
      return (
        providerId === "gradle-effective-v1" &&
        moduleId.endsWith("::app") &&
        sourceSetId === "main" &&
        label === "Gradle · app / main [gradle/included-build :app]"
      );
    });
    assert.ok(
      compositeApp,
      `Java Run did not retain the included app provider association: ${JSON.stringify(optionDetails)}`,
    );
    this.#proof.gradleCompositeContextIdentityResolved = true;
  }
  async runSecondGradleCompositeApp() {
    await assert.rejects(access(this.file(`${SECOND_COMPOSITE_APP}/build/classes/java/main/pkg/Runner.class`)), { code: "ENOENT" });
    await this.runSynchronizedModule(SECOND_COMPOSITE_BUILD_ROOT);
  }
  async assertSecondGradleCompositeAppRun() {
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.ok(output.includes("GRADLE_COMPOSITE_RUN_OK:second-build"), output);
    assert.ok(!output.includes("GRADLE_COMPOSITE_RUN_OK:included-build"), output);
    assert.ok(output.includes(`PROJECT_GUI_JDK:${this.#gradleSdk}`), output);
    await access(this.file(`${SECOND_COMPOSITE_APP}/build/classes/java/main/pkg/Runner.class`));
    await assert.rejects(access(this.file(this.projectDebugPidFile())), { code: "ENOENT" });
    this.#proof.gradleCompositeSecondAppRan = true;
  }
  private async openWorkspaceSourceViaQuickOpen(source: string) {
    if (!(await this.surface().tab(source).isExisting())) {
      await this.browser().keys(["Control", "p"]);
      const quickOpen = this.browser().$('[role="dialog"][aria-label="Go to File"]');
      await quickOpen.waitForDisplayed({ timeout: 5_000 });
      await pasteNativeText(this.#app!, quickOpen.$('[aria-label="Search workspace files"]'), source);
      const result = quickOpen.$(`[role="option"][data-path="${source}"]`);
      await result.waitForDisplayed({ timeout: 5_000 });
      await result.click();
      await quickOpen.waitForExist({ reverse: true, timeout: 10_000 });
      await this.surface().assertBuffer(source, this.originalSource(source));
    }
  }
  async discoverSecondCompositeTests(completedRuns = 0) {
    await this.refreshGradleContextAfterCompositeExecution();
    await this.openWorkspaceSourceViaQuickOpen(SECOND_COMPOSITE_SOURCE);
    await this.surface().tab(this.executionSource()).click();
    await this.configureSynchronizedExecution("test", "pkg.Runner", "app", SECOND_COMPOSITE_BUILD_ROOT);
    await this.requestProjectExecution("Discover tests");
    await this.waitProjectExecution("discover", "succeeded");
    const list = this.executionPanel().$('[aria-label="Discovered Java tests"]');
    assert.match(await list.getText(), /Discovery: ready\. 1 classes, 2 method-name groups/);
    for (const name of ["testScopeAndSamePathSource", "secondBuildOnly"]) {
      assert.ok(await list.$(`[aria-label="Run method group pkg.RunnerTest#${name}"]`).isEnabled());
    }
    await this.assertSecondCompositeTestInvocations(completedRuns);
  }
  async buildSecondCompositeTests() {
    const compiledTest = this.file(`${SECOND_COMPOSITE_APP}/build/classes/java/test/pkg/RunnerTest.class`);
    await assert.rejects(access(compiledTest), { code: "ENOENT" });
    await this.refreshGradleContextAfterCompositeExecution();
    await this.configureSynchronizedExecution("test", "pkg.Runner", "app", SECOND_COMPOSITE_BUILD_ROOT);
    await this.requestProjectExecution("Build");
    await this.waitProjectExecution("build", "succeeded");
    await access(compiledTest);
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /> Task :included-build:nested-app:app:testClasses\b/u);
    await this.assertSecondCompositeTestInvocations(0);
    this.#proof.gradleCompositeSecondAppTestCompiled = true;
  }
  private async assertSecondCompositeTestInvocations(count: number) {
    const selected = this.file(`${SECOND_COMPOSITE_APP}/selected-method.txt`);
    if (count) assert.equal(await readFile(selected, "utf8"), "second-build\n".repeat(count));
    else await assert.rejects(access(selected), { code: "ENOENT" });
    await assert.rejects(access(this.file(`${SECOND_COMPOSITE_APP}/other-method.txt`)), { code: "ENOENT" });
    for (const method of TEST_METHODS) await assert.rejects(access(this.testProofFile(method)), { code: "ENOENT" });
  }
  async coverSecondCompositeTest() {
    const execution = this.executionPanel();
    const selector = execution.$("label=Java configuration").$("select");
    const discoveryConfiguration = await selector.getValue();
    const discoveryName = await execution.$("label=Configuration name").$("input").getValue();
    await execution.$("button=Duplicate configuration").click();
    assert.notEqual(await selector.getValue(), discoveryConfiguration);
    const modules = execution.$("label=Synchronized module and source set").$("select");
    await modules.selectByVisibleText("Manual configuration");
    await execution.$("label=Build tool").$("select").selectByAttribute("value", "jdk");
    const button = execution.$('[aria-label="Cover method group pkg.RunnerTest#testScopeAndSamePathSource"]');
    await button.scrollIntoView();
    await button.click();
    await this.waitProjectExecution("coverage", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    await this.assertSecondCompositeTestInvocations(1);
    await execution.$(`p=Session configuration: ${discoveryName}`).waitForDisplayed({ timeout: 5000 });
    const history = execution.$('[aria-label="Java coverage history"]');
    await this.browser().waitUntil(async () =>
      (await history.$("label=Coverage measurement").$("select").getText()).includes(` · ${discoveryName} · `),
      { timeout: 5000, timeoutMsg: "Coverage history did not retain the discovery configuration name" },
    );
    this.#proof.gradleCompositeCoverageConfigurationPreserved = true;
    await this.openSecondCompositeMeasuredSource();
    this.#proof.gradleCompositeSecondAppTestCoverage = true;
  }
  async rerunSecondCompositeCoverage() {
    const execution = this.executionPanel();
    const configuration = await execution.$("p*=Session configuration:").getText();
    const previous = await execution.getAttribute("data-session-id");
    assert.ok(previous);
    await this.surface().tab(this.executionSource()).click();
    await this.requestProjectExecution("Rerun session");
    await this.browser().waitUntil(async () => {
      const current = await execution.getAttribute("data-session-id");
      return Boolean(current && current !== previous);
    }, { timeout: 45_000, timeoutMsg: "Coverage rerun did not start a new test session" });
    await this.waitProjectExecution("coverage", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    await this.assertSecondCompositeTestInvocations(2);
    assert.equal(await execution.$("p*=Session configuration:").getText(), configuration);
    await this.openSecondCompositeMeasuredSource();
    this.#proof.gradleCompositeSecondAppCoverageRepeated = true;
  }
  private async openSecondCompositeMeasuredSource() {
    const execution = this.executionPanel();
    const coverage = execution.$('[aria-label="Java test coverage"]');
    const picker = coverage.$("label*=Measured source file").$("select");
    const labels = await (await picker.$$("option").getElements()).map(option => option.getText());
    const runner = labels.filter(label => label.startsWith("pkg/Runner.java ·"));
    assert.equal(runner.length, 1, labels.join(", "));
    await picker.selectByVisibleText(runner[0]!);
    const open = coverage.$("button=Open measured source");
    await open.scrollIntoView();
    await open.waitForEnabled({ timeout: 5_000 });
    assert.equal(await this.surface().tab(this.executionSource()).getAttribute("aria-selected"), "true");
    await open.click();
    await this.browser().waitUntil(async () => (await this.surface().tab(SECOND_COMPOSITE_SOURCE).getAttribute("aria-selected")) === "true", {
      timeout: 5_000, timeoutMsg: "Coverage did not open Runner.java in the second included build",
    });
    await this.browser().$(".monaco-editor .java-coverage-line-covered, .monaco-editor .java-coverage-line-partial").waitForDisplayed({ timeout: 5_000 });
  }
  async debugSecondCompositeTest() {
    await this.discoverSecondCompositeTests(2);
    await this.refreshGradleContextAfterCompositeExecution();
    await this.configureSynchronizedExecution("test");
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    const line = this.originalSource(SECOND_COMPOSITE_SOURCE).split("\n").findIndex(s => s.includes("return ParentLibrary.marker(")) + 1;
    assert.ok(line > 0);
    await this.clickProjectSourceBreakpoint(SECOND_COMPOSITE_SOURCE, line);
    const button = execution.$('[aria-label="Debug method group pkg.RunnerTest#testScopeAndSamePathSource"]');
    await button.scrollIntoView();
    await button.click();
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    await this.continueSynchronizedModuleDebugging();
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 60_000);
    const frame = await execution.$('[aria-label="Structured Java debugger"]').getText();
    assert.ok(frame.includes("pkg.Runner.origin"), frame);
    assert.ok(frame.includes(`Runner.java:${line}`), frame);
    assert.equal(await this.surface().tab(SECOND_COMPOSITE_SOURCE).getAttribute("aria-selected"), "true");
    await this.browser().$(".monaco-editor .java-debug-execution-line").waitForDisplayed({ timeout: 5_000 });
    await this.assertSecondCompositeTestInvocations(2);
    await this.continueSynchronizedModuleDebugging();
    await this.waitProjectExecution("debug-test", "succeeded");
    await this.assertTestSummary(1, 1, 0);
    await this.assertSecondCompositeTestInvocations(3);
    this.#proof.gradleCompositeSecondAppTestDebug = true;
  }
  private compositeGreeterBreakpointLine(source: string) {
    const line = this.originalSource(source).split("\n").findIndex(text => text.includes("return \"")) + 1;
    assert.ok(line > 0, `Missing Greeter return statement in ${source}`);
    return line;
  }
  async debugCompositeLibrary() {
    await this.refreshGradleContextAfterCompositeExecution();
    for (const source of [SECOND_COMPOSITE_GREETER, COMPOSITE_LIBRARY_SOURCE]) {
      await this.openWorkspaceSourceViaQuickOpen(source);
    }
    await this.configureSynchronizedExecution("main", "pkg.Runner", "app", "gradle/included-build");
    const execution = this.executionPanel();
    await execution.$("label=Debugger").$("select").selectByAttribute("value", "jdi");
    await this.waitForSourceDebuggerReady();
    for (const source of [SECOND_COMPOSITE_GREETER, COMPOSITE_LIBRARY_SOURCE]) {
      await this.clickProjectSourceBreakpoint(source, this.compositeGreeterBreakpointLine(source));
    }
    await this.requestProjectExecution("Debug");
    await this.waitForProjectDebuggerStatus("suspended (entry)", 120_000);
    await this.continueSynchronizedModuleDebugging();
  }
  async assertCompositeLibraryBreakpoint() {
    await this.waitForProjectDebuggerStatus("suspended (breakpoint)", 45_000);
    const execution = this.executionPanel();
    const line = this.compositeGreeterBreakpointLine(COMPOSITE_LIBRARY_SOURCE);
    const frame = await execution.$('[aria-label="Java stack frames"] button[aria-pressed="true"]').getText();
    assert.ok(frame.includes("pkg.Greeter.message") && frame.includes(`Greeter.java:${line}`), frame);
    assert.equal(await this.surface().tab(COMPOSITE_LIBRARY_SOURCE).getAttribute("aria-selected"), "true");
    await this.browser().$(".monaco-editor .java-debug-execution-line").waitForDisplayed({ timeout: 5_000 });
    const output = await execution.$('[aria-label="Java console output"]').getText();
    const artifact = await realpath(this.file("gradle/library/build/libs/library-1.0.jar"));
    assert.ok(output.includes(`LIBRARY_CODE_SOURCE:${artifact}`), output);
    const otherLine = this.compositeGreeterBreakpointLine(SECOND_COMPOSITE_GREETER);
    assert.ok(output.includes(`Saved breakpoint ${SECOND_COMPOSITE_GREETER}:${otherLine} is outside captured sources`), output);
    assert.ok(!output.includes("GRADLE_COMPOSITE_RUN_OK:"), output);
    const pid = Number(await readFile(this.file(this.projectDebugPidFile()), "utf8"));
    this.#projectDebugProcesses.push(await captureOwnedApplication(pid, {
      executable: await realpath(path.join(this.executionSdk(), "bin/java")),
      sandbox: this.#lease!.runnerSandbox,
      workspace: this.#lease!.paths.workspace,
      ideHome: this.#lease!.paths.ideHome,
    }));
    await this.continueSynchronizedModuleDebugging();
    await this.assertSynchronizedModuleDebugCompleted();
    this.#proof.gradleCompositeLibraryJarBreakpoint = true;
  }
  async assertGradleCompositeApplicationRun() {
    assert.equal(this.#gradleCompositeProject, true);
    assert.equal(this.#proof.gradleCompositeContextIdentityResolved, true);
    await this.waitProjectExecution("run", "succeeded");
    const output = await this.executionPanel().$('[aria-label="Java console output"]').getText();
    assert.match(output, /BUILD SUCCESSFUL/, output);
    assert.ok(output.includes("GRADLE_COMPOSITE_RUN_OK:included-build"), output);
    assert.ok(!output.includes("GRADLE_COMPOSITE_RUN_OK:second-build"), output);
    assert.ok(output.includes(`PROJECT_GUI_JDK:${this.#gradleSdk}`), output);
    await access(this.file("gradle/app/build/classes/java/main/pkg/Runner.class"));
    await access(this.file("gradle/library/build/classes/java/main/pkg/Greeter.class"));
    const pid = Number(await readFile(this.file(this.projectDebugPidFile()), "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    await assert.rejects(access("/proc/" + pid), { code: "ENOENT" });
    await unlink(this.file(this.projectDebugPidFile()));
    await this.assertSavedExecutionDraft();
    this.#proof.gradleCompositeApplicationRan = true;
    this.#proof.realGradleBuild = true;
    this.#proof.synchronizedModuleRunSavedDraft = true;
    this.#proof.synchronizedModuleRuntimeDependencies = true;
    this.#proof.synchronizedModuleSelectedJdk = true;
  }
  async close() {
    await this.removeGeneratedOutputProbe();
    const source = this.executionSource();
    const tab = this.surface().tab(source);
    if ((await tab.isExisting()) && (await tab.$('[aria-label="Unsaved changes"]').isExisting())) {
      await tab.click();
      await this.surface().discardUsingDisk(source, this.originalSource(source));
    }
    await this.#app!.closeNativeWindow();
  }
  async assertFinal() {
    await this.#app!.assertExited();
    await this.assertInputs();
    for (const relative of [
      "maven/app/src/test/java/pkg/BackgroundOutputProbe.java",
      "maven/app/target/test-classes/pkg/BackgroundOutputProbe.class",
    ])
      await assert.rejects(access(this.file(relative)), (error: unknown) =>
        ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""),
      );
    if (this.#gradleJpmsArtifactPath) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(this.#gradleJpmsArtifactPath))
          .digest("hex"),
        this.#gradleJpmsArtifactSha256,
        "The Gradle module-path JAR changed before native scenario cleanup",
      );
    }
    await this.#lease!.assertConfiguredPathsConfined();
    this.#proof.sourceInputsPreserved = true;
    this.#proof.cleanExit = true;
  }
  async navigateWithMavenContext() {
    await this.assertDraft();
    await this.synchronizeMaven();
    const semanticModelPath = pathToFileURL(this.file(SOURCE)).href;
    await this.browser().waitUntil(
      async () =>
        (await this.browser()
          .$('[data-testid="monaco-code-editor-host"]')
          .getAttribute("data-editor-model-path")) === semanticModelPath,
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "The Java editor model did not settle on the language-service document URI",
      },
    );
    await this.positionInheritedCall(` ${this.originalSource()}`);
    await this.requestDefinitionAtCurrentPosition();
  }
  async startProjectLanguageService() {
    await this.startLanguageServiceWithSdk(this.#sdk);
    this.#proof.projectLanguageServiceReadyBeforeContextSync = true;
    await this.assertDraft();
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
  }
  async startExecutionLanguageService() {
    await this.startLanguageServiceWithSdk(this.executionSdk(), true);
    await this.assertSavedExecutionDraft();
    await this.browser().$('[role="tab"][aria-label="Java Run"]').click();
  }
  private async startLanguageServiceWithSdk(sdkHome: string, restartCurrentSession = false) {
    const configuredHome = process.env.IDE_JDTLS_HOME;
    assert.ok(
      configuredHome && path.isAbsolute(configuredHome),
      "Set IDE_JDTLS_HOME to the installed Eclipse JDT LS directory for native SDK qualification.",
    );
    assert.equal(
      await this.#app!.environmentValue("IDE_JDTLS_HOME"),
      configuredHome,
      "The native IDE did not inherit the configured Eclipse JDT LS installation.",
    );
    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    const sdkInput = 'input[placeholder="Full JDK directory"]';
    if ((await this.panel().$(sdkInput).getValue()) !== sdkHome)
      await this.fill(sdkInput, sdkHome);
    await this.browser().$('[role="tab"][aria-label="Java Intelligence"]').click();
    const languagePanel = this.languagePanel();
    await languagePanel.waitForDisplayed({ timeout: 5000 });
    const lifecycle = languagePanel.$(
      '[role="status"][aria-label="Eclipse JDT LS lifecycle status"]',
    );
    const actionableStates = ["stopped", "ready", "indexing", "degraded", "failed"];
    await this.browser().waitUntil(
      async () => actionableStates.includes((await lifecycle.getText()).trim().toLowerCase()),
      {
        timeout: 15_000,
        interval: 100,
        timeoutMsg: "The configured Eclipse JDT LS provider did not reach an actionable state",
      },
    );
    const state = (await lifecycle.getText()).trim().toLowerCase();
    if (
      restartCurrentSession &&
      ["ready", "indexing", "degraded", "failed"].includes(state)
    ) {
      const restart = languagePanel.$("button=Restart");
      await restart.waitForEnabled({ timeout: 15_000 });
      await restart.click();
      await this.browser().waitUntil(
        async () => ["starting", "stopping"].includes((await lifecycle.getText()).toLowerCase()),
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: "Eclipse JDT LS did not enter its restart transition",
        },
      );
    } else if (["stopped", "failed"].includes(state)) {
      const start = languagePanel.$("button=Start");
      await start.waitForEnabled({ timeout: 15_000 });
      await start.click();
    }
    const observedStates = new Set<string>([state]);
    const providerErrors = new Set<string>();
    try {
      await this.browser().waitUntil(
        async () => {
          const observedState = (await lifecycle.getText()).trim().toLowerCase();
          observedStates.add(observedState);
          if (["failed", "degraded", "unavailable"].includes(observedState)) {
            for (const alert of await languagePanel.$$('p[role="alert"]')) {
              const message = (await alert.getText()).trim();
              if (message) providerErrors.add(message);
            }
          }
          return observedState === "ready";
        },
        { timeout: 60_000, interval: 100 },
      );
    } catch (error) {
      throw new Error(
        [
          `Eclipse JDT LS did not become ready for the selected project JDK. The service reported ${[...observedStates].join(", ")}.`,
          ...providerErrors,
          await languagePanel.getText(),
        ].join("\n"),
        { cause: error },
      );
    }
    await this.browser().waitUntil(
      async () => (await languagePanel.getText()).includes(`Project JDK: ${sdkHome}`),
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: "Eclipse JDT LS did not use the selected project JDK",
      },
    );
  }
  async assertContextNavigation() {
    const file = "maven/library/src/main/java/fixtures/library/BaseGreeting.java";
    const original = this.#inputs.get(file)!;
    const offset = original.indexOf("message(int");
    assert.notEqual(offset, -1, "The cross-module fixture has no inherited integer method.");
    const targetLine = original.slice(0, offset).split("\n").length;
    const targetColumn = offset - original.lastIndexOf("\n", offset);
    await this.surface().tab(file).waitForDisplayed({ timeout: 20_000 });
    await this.surface().assertBuffer(file, original);
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    const monacoHost = this.browser().$('[data-testid="monaco-code-editor-host"]');
    await this.browser().waitUntil(
      async () =>
        (await monacoHost.getAttribute("data-reveal-requested-line")) === String(targetLine) &&
        (await monacoHost.getAttribute("data-editor-cursor-line")) === String(targetLine) &&
        (await cursor.getText()).trim() === `Ln ${targetLine}, Col ${targetColumn}`,
      {
        timeout: 10_000,
        interval: 50,
        timeoutMsg: "Cursor navigation opened the declaration without applying its exact range",
      },
    );
    const input = this.browser().$(`[role="textbox"][aria-label^="Code editor for ${file}"]`);
    await this.browser().waitUntil(() => input.isFocused(), { timeout: 5000 });
    await this.browser().keys("X");
    await this.surface().assertBuffer(
      file,
      `${original.slice(0, offset)}x${original.slice(offset)}`,
    );
    assert.equal(await readFile(this.file(file), "utf8"), original);
    await this.surface().discardUsingDisk(file, original);
    await this.surface().tab(SOURCE).click();
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForExist({ reverse: true, timeout: 5000 });
    await this.assertDraft();
    await this.surface().discardUsingDisk(SOURCE, this.originalSource());
    this.#proof.contextBoundCursorNavigation = true;
    this.#proof.contextBoundOverlayNavigation = true;
    await this.assertInputs();
  }
  async changeSdkAndNavigate() {
    const intelligenceTab = this.browser().$('[role="tab"][aria-label="Java Intelligence"]');
    await intelligenceTab.waitForDisplayed({ timeout: 5000 });
    await intelligenceTab.click();
    const languagePanel = this.languagePanel();
    await languagePanel.waitForDisplayed({ timeout: 5000 });
    await this.browser().waitUntil(
      async () => (await languagePanel.getText()).includes(`Project JDK: ${this.#sdk}`),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: "Java language service did not report the selected Maven JDK",
      },
    );
    const initialGeneration = this.languageServiceGeneration(await languagePanel.getText());

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.surface().tab(SOURCE).click();
    await this.surface().focus(SOURCE);
    await this.browser().keys(["Control", "Home"]);
    await this.browser().keys(" ");
    const draft = ` ${this.originalSource()}`;
    await this.surface().assertBuffer(SOURCE, draft);
    await this.surface().assertDirty(SOURCE, true);
    if (this.#gradleSdk === this.#sdk) {
      this.#proof.projectJdkSwitchUnavailableBecauseNoDistinctJdk = true;
      this.#proof.projectJdkSwitchPreservedDirtyBuffer = true;
      return;
    }
    await this.fill('input[placeholder="Full JDK directory"]', this.#gradleSdk);

    await intelligenceTab.click();
    await this.browser().waitUntil(
      async () => {
        const text = await languagePanel.getText();
        const generation = this.languageServiceGeneration(text);
        return text.includes(`Project JDK: ${this.#gradleSdk}`) && generation > initialGeneration;
      },
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg:
          "Changing the project JDK did not restart the Java language service with the selected JDK",
      },
    );
    this.#proof.projectJdkSwitchRestartedLanguageService = true;

    await this.browser().$('[role="tab"][aria-label="Java Project"]').click();
    await this.surface().tab(SOURCE).click();
    await this.browser()
      .$(".editor-opening-placeholder")
      .waitForExist({ reverse: true, timeout: 5000 });
    await this.surface().assertBuffer(SOURCE, draft);
    await this.surface().assertDirty(SOURCE, true);
    this.#proof.projectJdkSwitchPreservedDirtyBuffer = true;
    await this.positionInheritedCall(draft);
    await this.requestDefinitionAtCurrentPosition();
  }
  async assertChangedSdkRefusal() {
    if (this.#proof.projectJdkSwitchUnavailableBecauseNoDistinctJdk) {
      assert.equal(this.#sdk, this.#gradleSdk);
      assert.equal(this.#proof.projectJdkSwitchRestartedLanguageService, false);
      assert.equal(this.#proof.projectJdkSwitchPreservedDirtyBuffer, true);
      const draft = ` ${this.originalSource()}`;
      await this.surface().assertBuffer(SOURCE, draft);
      await this.surface().assertDirty(SOURCE, true);
      assert.equal(await readFile(this.file(SOURCE), "utf8"), this.originalSource());
      return;
    }
    await this.browser().waitUntil(
      async () => {
        const statuses = await this.browser().$$('[role="status"]').getElements();
        return (await statuses.map((status) => status.getText())).some((text) =>
          text.includes("Synchronize an effective Java project context"),
        );
      },
      { timeout: 10_000, timeoutMsg: "Navigation did not refuse the changed project SDK" },
    );
    assert.equal(await this.surface().tab(SOURCE).getAttribute("aria-selected"), "true");
    const draft = ` ${this.originalSource()}`;
    await this.surface().assertBuffer(SOURCE, draft);
    await this.surface().assertDirty(SOURCE, true);
    assert.equal(this.#proof.projectJdkSwitchRestartedLanguageService, true);
    assert.equal(this.#proof.projectJdkSwitchPreservedDirtyBuffer, true);
    this.#proof.changedSdkNavigationRefused = true;
    await this.assertInputs();
  }
  private async positionInheritedCall(source = this.originalSource()) {
    await this.surface().focus(SOURCE);
    const offset = source.indexOf("message(2)");
    assert.notEqual(offset, -1, "The source fixture has no integer call to navigate.");
    const line = source.slice(0, offset).split("\n").length;
    const lineText = source.split("\n")[line - 1];
    const column = Array.from(lineText.slice(0, lineText.indexOf("message(2)"))).length;
    await this.browser().keys(["Control", "Home"]);
    for (let index = 1; index < line; index++) await this.browser().keys("ArrowDown");
    try {
      await this.browser().performActions([
        {
          type: "key",
          id: "context-java-call-column",
          actions: textKeySequence("\uE014".repeat(column)),
        },
      ]);
    } finally {
      await this.browser().releaseActions();
    }
    const cursor = this.browser().$('[data-testid="editor-cursor-position"]');
    await this.browser().waitUntil(
      async () => (await cursor.getText()).trim() === `Ln ${line}, Col ${column + 1}`,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "The editor did not place the caret on the inherited integer call",
      },
    );
    const input = this.browser().$(`[role="textbox"][aria-label^="Code editor for ${SOURCE}"]`);
    this.#proof.contextNavigationCursorBeforeF12 = (await cursor.getText()).trim();
    this.#proof.contextNavigationEditorFocusedBeforeF12 = await input.isFocused();
    this.#proof.contextNavigationDefinitionCallsBeforeF12 =
      await this.definitionProviderCallCount();
    assert.equal(this.#proof.contextNavigationEditorFocusedBeforeF12, true);
  }
  private async requestDefinitionAtCurrentPosition(filePath = SOURCE) {
    const before = this.#proof.contextNavigationDefinitionCallsBeforeF12;
    assert.ok(before !== null, "The Java definition provider baseline was not captured.");
    await this.browser().keys("F12");
    await this.browser().waitUntil(
      async () => (await this.definitionProviderCallCount(filePath)) > before,
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "F12 did not invoke Monaco's registered Java definition provider",
      },
    );
    this.#proof.contextNavigationDefinitionCallsAfterF12 =
      await this.definitionProviderCallCount(filePath);
  }
  private async definitionProviderCallCount(filePath = SOURCE): Promise<number> {
    return this.browser().execute((filePath) => {
      const input = Array.from(
        document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label]'),
      ).find((element) => element.getAttribute("aria-label") === `Code editor for ${filePath}`);
      const editor = input?.closest(".monaco-code-editor-host")?.querySelector(".monaco-editor");
      const count = Number(editor?.getAttribute("data-java-definition-provider-call-count") ?? 0);
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    }, filePath);
  }
  evidence() {
    return {
      ...(this.#gitBranchWorkflow ? { javaGitBranchWorkflow: { ...this.#gitBranchWorkflow.proof }, javaGitBranchGradleEvaluations: this.#gitBranchWorkflow.gradleEvaluationChecks, javaGitRebaseWorkflow: { ...this.#gitBranchWorkflow.rebaseProof }, javaGitRebaseGradleEvaluations: this.#gitBranchWorkflow.rebaseGradleEvaluationChecks } : {}),
      ...this.#proof,
      ...(this.#testWorkflow || this.#workspaceWrapper || this.#applicationWorkingDirectory
        ? {
            executionTool: this.#executionTool,
            ...(this.#testWorkflow ? { testWorkflow: this.#testWorkflow } : {}),
            selectedJdk: this.executionSdk(),
          }
        : {}),
      ...(this.#workspaceWrapper
        ? { workspaceWrapperInvocationRecord: path.basename(this.wrapperInvocationRecord()) }
        : {}),
      failureObservation: this.#failureObservation,
      mavenFailsafeReports: this.#mavenFailsafeReports,
      application: this.#app?.evidence(),
      scenarioEnvironment: this.#lease?.evidence(),
    };
  }
  diagnostics() {
    return this.#app?.redactedDiagnostics([...this.#inputs.values()].filter(Boolean)) ?? "";
  }
  async captureFailure(error?: unknown) {
    if (!this.#app || !this.#lease) return;
    if (this.#javaRelease === 26 && process.env.IDE_JAVA_EDITOR_TRACE === "1") {
      const project = this.file(this.#executionTool);
      const fixture = path.join(
        this.#lease.runnerArtifactPath,
        `java26-${this.#executionTool}-failed-project`,
      );
      try {
        const before = await this.fileManifest(project);
        await cp(project, fixture, {
          recursive: true,
          filter: (file) => path.basename(file) !== ".refactorkit",
        });
        const after = await this.fileManifest(project);
        await writeFile(
          path.join(
            this.#lease.runnerArtifactPath,
            `java26-${this.#executionTool}-failed-project.json`,
          ),
          JSON.stringify(
            {
              sourceFilesStableDuringCopy:
                JSON.stringify([...before]) === JSON.stringify([...after]),
              files: [...after],
              excludedDirectory: ".refactorkit",
            },
            null,
            2,
          ),
        );
      } catch (captureError) {
        await writeFile(
          path.join(
            this.#lease.runnerArtifactPath,
            `java26-${this.#executionTool}-failed-project-copy-error.txt`,
          ),
          String(captureError),
        );
      }
    }
    try {
      const page = await this.browser().execute(() => {
          const cursor = document.querySelector('[data-testid="editor-cursor-position"]');
          const editor = document.querySelector('[data-testid="monaco-code-editor-host"]');
          const monacoEditor = editor?.querySelector(".monaco-editor") ?? null;
          const navigation = document.querySelector(
            '[data-testid="java-project-navigation-status"]',
          );
          const attributes = (element: Element | null, names: string[]) =>
            Object.fromEntries(names.map((name) => [name, element?.getAttribute(name) ?? null]));
          return {
            text: document.body.innerText.slice(-10_000),
            projectContextControls: Array.from(document.querySelectorAll("button"))
              .filter((button) =>
                ["Synchronize project", "Evaluate Gradle project"].includes(
                  button.textContent?.trim() ?? "",
                ),
              )
              .map((button) => ({
                label: button.textContent?.trim() ?? "",
                disabled: (button as HTMLButtonElement).disabled,
                ariaDisabled: button.getAttribute("aria-disabled"),
              })),
            inputs: Array.from(document.querySelectorAll("input, textarea, select")).map(
              (input) => ({
                label: input.getAttribute("placeholder") ?? input.getAttribute("aria-label"),
                value: (input as HTMLInputElement).value,
              }),
            ),
            navigation: {
              status: navigation?.textContent?.slice(0, 500) ?? null,
              cursorText: cursor?.textContent?.slice(0, 200) ?? null,
              cursor: attributes(cursor, [
                "data-reveal-file-path",
                "data-reveal-line",
                "data-navigation-generation",
                "data-navigation-context-generation",
                "data-navigation-switching",
                "data-navigation-metadata-loading",
              ]),
              editor: attributes(editor, [
                "data-editor-file-path",
                "data-editor-model-path",
                "data-editor-document-identity-path",
                "data-editor-semantic-document-path",
                "data-editor-semantic-document-uri",
                "data-reveal-requested-line",
                "data-reveal-handled-request-id",
                "data-editor-cursor-line",
                "data-java-template-project-context-status",
              ]),
              definitionProviderCalls:
                monacoEditor?.getAttribute("data-java-definition-provider-call-count") ?? null,
              definitionResultStatus: document.body.getAttribute(
                "data-java-definition-result-status",
              ),
              definitionResultMessage: document.body.getAttribute(
                "data-java-definition-result-message",
              ),
              definitionResultHistory: document.body.getAttribute(
                "data-java-definition-result-history",
              ),
              definitionProviderHistory: document.body.getAttribute(
                "data-java-definition-provider-history",
              ),
              navigationLifecycleHistory: document.body.getAttribute(
                "data-java-navigation-lifecycle-history",
              ),
            },
          };
        }),
        engineCapabilityProbe = await this.browser().executeAsync((done) => {
          let settled = false;
          const finish = (value: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            done(value);
          };
          const timeout = setTimeout(
            () => finish({ error: "Engine capability probe timed out." }),
            15_000,
          );
          const internals = (
            window as unknown as {
              __TAURI_INTERNALS__?: { invoke?: (command: string) => Promise<unknown> };
            }
          ).__TAURI_INTERNALS__;
          if (!internals?.invoke) {
            finish({ error: "Tauri invoke bridge is unavailable." });
            return;
          }
          void Promise.allSettled([
            internals.invoke("get_refactorkit_engine_capabilities"),
            internals.invoke("get_refactorkit_capabilities"),
            internals.invoke("get_refactorkit_status"),
          ]).then(([engineResult, baseResult, statusResult]) => {
            const value = (result: PromiseSettledResult<unknown>) =>
              result.status === "fulfilled" &&
              typeof result.value === "object" &&
              result.value !== null
                ? (result.value as Record<string, unknown>)
                : null;
            const error = (result: PromiseSettledResult<unknown>) =>
              result.status === "rejected"
                ? result.reason instanceof Error
                  ? result.reason.message.slice(0, 500)
                  : String(result.reason).slice(0, 500)
                : null;
            const engine = value(engineResult);
            const base = value(baseResult);
            const status = value(statusResult);
            finish({
              engine:
                engine === null
                  ? { error: error(engineResult) }
                  : {
                      engineDiscovered: engine.engineDiscovered ?? null,
                      path: engine.path ?? null,
                      version: engine.version ?? null,
                      operationalSurface: engine.operationalSurface ?? null,
                      reason: engine.reason ?? null,
                    },
              base:
                base === null
                  ? { error: error(baseResult) }
                  : {
                      providerVersion: base.providerVersion ?? null,
                      javaContextRefactoring: base.javaContextRefactoring ?? null,
                      methodCount: Array.isArray(base.methods) ? base.methods.length : null,
                    },
              status:
                status === null
                  ? { error: error(statusResult) }
                  : {
                      available: status.available ?? null,
                      version: status.version ?? null,
                    },
            });
          });
        }),
        mavenFilesChangedFromBaseline = await this.mavenFilesChangedFromBaseline(),
        mavenFileBaseline = this.#mavenManifestAtSync
          ? "lastSuccessfulSync"
          : this.#mavenManifestBeforeSync
            ? "beforeInitialSync"
            : "unavailable";
      const failure =
        error instanceof Error
          ? `${error.name}: ${error.message}\n${error.stack?.slice(0, 3000) ?? ""}`
          : error === undefined
            ? undefined
            : String(error).slice(0, 3000);
      this.#failureObservation = {
        ...page,
        engineCapabilityProbe,
        failure,
        mavenFileBaseline,
        mavenFilesChangedFromBaseline,
        mavenFilesChangedAfterParameterSourceOpen: this.#mavenManifestAfterParameterSourceOpen
          ? this.diffMavenFileManifests(
              this.#mavenManifestAtSync ?? this.#mavenManifestBeforeSync,
              this.#mavenManifestAfterParameterSourceOpen,
            )
          : null,
        mavenFilesChangedBeforeParameterPreview: this.#mavenManifestBeforeParameterPreview
          ? this.diffMavenFileManifests(
              this.#mavenManifestAtSync ?? this.#mavenManifestBeforeSync,
              this.#mavenManifestBeforeParameterPreview,
            )
          : null,
      };
      await this.browser().saveScreenshot(
        path.join(this.#lease.runnerArtifactPath, "java-project-context-failure.png"),
      );
    } catch {
      /* Preserve the original failure if the window is unavailable. */
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
      await this.removeGeneratedOutputProbe();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.restoreStaleParameterOutputBackup();
    } catch (error) {
      errors.push(error);
    }
    for (const [key, value] of this.#originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      await this.#lease?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.#lease) {
        const testWorkflow = this.#proof.synchronizedJupiterTestSourcePrepared ? "jupiter"
          : this.#proof.synchronizedTestNgTestSourcePrepared ? "testng"
          : this.#proof.synchronizedMixedJunitTestSourcePrepared ? "mixed-junit"
          : this.#testWorkflow;
        const evidenceFile = this.#mavenFailsafeProfile
          ? "java-maven-failsafe-profile-native-evidence.json"
          : this.#inputs.has(SECOND_COMPOSITE_SOURCE)
          ? "java-gradle-composite-same-path-native-evidence.json"
          : this.#applicationWorkingDirectory
          ? `java-project-working-directory-${this.#executionTool}-native-evidence.json`
          : this.#javaRelease !== undefined
            ? `java-project-java${this.#javaRelease}-${this.#executionTool}-context-native-evidence.json`
            : this.#customGradleTestSourceSet && this.#proof.synchronizedModuleDebugSavedDraft
              ? "java-project-gradle-custom-source-set-debugger-native-evidence.json"
              : this.#gradleKotlinDslProject && this.#testWorkflow === "coverage"
                ? "java-project-gradle-kotlin-dsl-coverage-native-evidence.json"
                : this.#gradleKotlinDslProject
                  ? "java-project-gradle-kotlin-dsl-native-evidence.json"
                  : this.#customGradleTestSourceSet
                    ? "java-project-gradle-custom-source-set-native-evidence.json"
                    : this.#customMavenOutputs
                      ? "java-project-maven-custom-output-native-evidence.json"
                      : this.#customGradleOutputs
                        ? "java-project-gradle-custom-output-native-evidence.json"
                        : testWorkflow
                          ? `java-project-${testWorkflow}-${this.#executionTool}-native-evidence.json`
                          : this.#workspaceWrapper
                            ? `java-project-${this.#executionTool}-wrapper-native-evidence.json`
                            : this.#proof.synchronizedModuleDebugSavedDraft
                              ? `java-project-debugger-${this.#executionTool}-native-evidence.json`
                              : this.#mavenUnsupportedRelease !== undefined
                                ? `java-project-java${this.#mavenUnsupportedRelease}-context-refusal-native-evidence.json`
                                : "java-project-context-native-evidence.json";
        const serializedEvidence = JSON.stringify(this.evidence(), null, 2);
        await writeFile(
          path.join(this.#lease.runnerArtifactPath, evidenceFile),
          serializedEvidence,
        );
        if (this.#proof.mainClassDiscovery.providerCandidateSelected) await writeFile(
          path.join(this.#lease.runnerArtifactPath, `java-main-discovery-${this.#executionTool}-native-evidence.json`),
          serializedEvidence,
        );
        if (this.#compilerBuildFixture) await writeFile(
          path.join(this.#lease.runnerArtifactPath, `java-project-compiler-failure-${this.#executionTool}-native-evidence.json`),
          serializedEvidence,
        );
        const scenarioEvidenceFile = this.#failedTestDebugFixture
          ? `java-failed-test-debugger-${this.#failedTestDebugFramework === "junit4" ? "" : `${this.#failedTestDebugFramework}-`}${this.#failedTestDebugOrigin}-${this.#executionTool}${this.#inheritedDefaultTestMethod ? "-interface-default" : ""}-native-evidence.json`
          : this.#selectedTestDebugFixture
          ? `java-selected-test-debugger-${this.#executionTool}-native-evidence.json`
          : this.#moveMemberFixture
          ? `java-move-member-${this.#moveMemberFixture}-native-evidence.json`
          : this.#proof.gradleModuleCreateReviewedAppliedAndRolledBack
          ? `java-gradle-module-create-${this.#gradleModuleCreateDsl}-native-evidence.json`
          : this.#proof.sdkParameterReorderReviewedAppliedAndRolledBack
            ? "java-parameter-reorder-native-evidence.json"
            : this.#proof.sdkParameterRenameReviewedAppliedAndRolledBack
              ? "java-parameter-rename-native-evidence.json"
              : this.#proof.sdkExtractParameterReviewedAppliedAndRolledBack
                ? "java-extract-parameter-native-evidence.json"
                : this.#proof.sdkExtractFieldReviewedAppliedAndRolledBack
                  ? "java-extract-field-native-evidence.json"
                  : this.#proof.sdkExtractSuperclassReviewedAppliedAndRolledBack
                    ? "java-extract-superclass-native-evidence.json"
                    : this.#proof.sdkExtractInterfaceReviewedAppliedAndRolledBack
                      ? "java-extract-interface-native-evidence.json"
                      : this.#proof.sdkStaleParameterPreviewRetiredContext
                        ? "java-stale-parameter-reorder-native-evidence.json"
                        : this.#proof.sdkPublicParameterReorderRefusedWithoutChanges
                          ? "java-public-parameter-reorder-refusal-native-evidence.json"
                          : undefined;
        if (scenarioEvidenceFile)
          await writeFile(
            path.join(this.#lease.runnerArtifactPath, scenarioEvidenceFile),
            serializedEvidence,
          );
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "native Java project context cleanup failed");
  }
  private browser() {
    assert.ok(this.#app);
    return this.#app.browser();
  }
  private surface() {
    assert.ok(this.#surface);
    return this.#surface;
  }
  private panel() {
    return this.browser().$('section[aria-label="Java project context"]');
  }
  private languagePanel() {
    return this.browser().$('section[aria-label="Java intelligence"]');
  }
  private languageServiceGeneration(text: string) {
    const match = text.match(/Generation:\s*(\d+)/);
    assert.ok(match, "Java language service did not report a numeric generation");
    return Number(match[1]);
  }
  private file(relative: string) {
    assert.ok(this.#lease);
    return path.join(this.#lease.paths.workspace, relative);
  }
  private wrapperInvocationRecord() {
    assert.ok(this.#lease);
    return path.join(
      this.#lease.runnerArtifactPath,
      `java-project-${this.#executionTool}-wrapper-invoked.txt`,
    );
  }
  private executionSource() {
    if (this.#failedTestDebugFixture && this.#failedTestDebugFramework === "jupiter")
      return `${this.#executionTool}/app/src/test/java/pkg/TestCases.java`;
    if (this.#selectedTestDebugFixture) return `${this.#executionTool}/app/src/test/java/pkg/RunnerTest.java`;
    if (this.#moveMemberFixture) return "maven/app/src/main/java/pkg/MoveMemberFixture.java";
    if (this.#jpaQueryFixture === "managed") return `maven/${managedJpqlEntity}`;
    if (this.#jpaQueryFixture) return "maven/app/src/main/java/demo/User.java";
    if (this.#pushDownMemberFixture) return "maven/app/src/main/java/pkg/PushDownFixture.java";
    if (this.#pullUpMemberFixture) return "maven/app/src/main/java/pkg/PullUpFixture.java";
    if (this.#extractParameterFixture)
      return "maven/app/src/main/java/pkg/ExtractParameterFixture.java";
    if (this.#extractFieldFixture) return "maven/app/src/main/java/pkg/ExtractFieldFixture.java";
    if (this.#inlineRefactoringFixture) return "maven/app/src/main/java/pkg/InlineFixture.java";
    if (this.#parameterObjectFixture) return "maven/app/src/main/java/pkg/ParameterObjectFixture.java";
    if (this.#extractDelegateFixture) return `${this.#executionTool}/app/src/main/java/pkg/ExtractDelegateFixture.java`;
    if (this.#extractSuperclassFixture)
      return "maven/app/src/main/java/pkg/ExtractSuperclassFixture.java";
    if (this.#extractInterfaceFixture)
      return "maven/app/src/main/java/pkg/ExtractInterfaceFixture.java";
    if (this.#encapsulateFieldFixture)
      return "maven/app/src/main/java/pkg/FieldEncapsulationFixture.java";
    if (this.#makeStaticFixture) return "maven/app/src/main/java/pkg/MakeStaticFixture.java";
    if (this.#makePublicFixture) return "maven/app/src/main/java/pkg/MakePublicFixture.java";
    if (this.#parameterReorderFixture)
      return "maven/app/src/main/java/pkg/ParameterOrderFixture.java";
    if (this.#parameterRemovalFixture)
      return "maven/app/src/main/java/pkg/ParameterRemovalFixture.java";
    if (
      this.#extractConstantFixture ||
      this.#extractVariableFixture ||
      this.#extractVariableInitializerFixture ||
      this.#extractMethodFixture
    )
      return this.#extractMethodFixture
        ? `${this.#executionTool}/app/src/main/java/pkg/ExtractMethodFixture.java`
        : "maven/app/src/main/java/pkg/ConstantFixture.java";
    return `${this.#executionTool}/app/src/main/java/pkg/Runner.java`;
  }
  private executionSdk() {
    return this.#executionTool === "maven" ? this.#sdk : this.#gradleSdk;
  }
  private originalSource(source = SOURCE) {
    return this.#inputs.get(source)!;
  }
  private async fill(selector: string, value: string) {
    await pasteNativeText(this.#app!, this.panel().$(selector), value);
  }
  private async waitForText(text: string, timeout = 20_000) {
    await this.browser().waitUntil(async () => (await this.panel().getText()).includes(text), {
      timeout,
      interval: 100,
      timeoutMsg: `Java project panel did not show ${text}`,
    });
  }
  private async chooseSourceSet(kind: string, providerLabel?: string) {
    const select = this.panel().$("label=Module and source set").$("select");
    const options = await select.$$("option").getElements();
    const labels = await options.map((option) => option.getText());
    const label = labels.find((text) =>
      text.startsWith(this.projectSourceSetLabel("app", kind, kind, providerLabel)),
    );
    assert.ok(label, `app ${kind} source set not reported: ${labels.join(", ")}`);
    await select.scrollIntoView();
    await select.selectByVisibleText(label);
  }
  private async classpath(kind: "Compile" | "Runtime") {
    const details = this.panel().$(`.//details[starts-with(summary, '${kind} classpath')]`);
    if ((await details.getAttribute("open")) === null) {
      await details.$("summary").scrollIntoView();
      await details.$("summary").click();
    }
    const spans = await details.$$("ol li > span").getElements();
    return spans.map((span) => span.getText());
  }
  private async openOwnership() {
    const summary = this.panel().$("summary=Inspect source ownership");
    const details = this.panel().$(".//details[summary='Inspect source ownership']");
    if ((await details.getAttribute("open")) === null) {
      await summary.scrollIntoView();
      await summary.click();
    }
  }
  private async resolve(kind: string, symbol: string, providerLabel?: string) {
    await this.chooseSourceSet(kind, providerLabel);
    await this.openOwnership();
    await this.fill('input[placeholder="pkg/Runner.java"]', "pkg/Runner.java");
    await this.fill('input[placeholder="pkg.Runner"]', symbol);
    await this.panel().$("button=Resolve source ownership").click();
  }
  private async resolveSourcePath(kind: string, sourceRelativePath: string) {
    await this.chooseSourceSet(kind);
    await this.openOwnership();
    await this.fill('input[placeholder="pkg/Runner.java"]', sourceRelativePath);
    await this.fill('input[placeholder="pkg.Runner"]', "");
    await this.panel().$("button=Resolve source ownership").click();
  }
  private async attemptOwnership(ownership: { kind: string; symbol: string; expected: string }) {
    await this.resolve(ownership.kind, ownership.symbol);
    let result = "";
    await this.browser().waitUntil(
      async () => {
        result = await this.panel().getText();
        return (
          result.includes(ownership.expected) ||
          /project inputs changed|snapshot.*stale/i.test(result)
        );
      },
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: `Source ownership did not resolve ${ownership.symbol}`,
      },
    );
    if (result.includes(ownership.expected)) return true;

    const changedFiles = await this.mavenFilesChangedFromBaseline();
    assert.ok(
      changedFiles.some(({ path: relative }) => /\/target\/.*\.class$/u.test(`/${relative}`)),
      `The stale context was not explained by a compiled-output change: ${JSON.stringify(changedFiles)}`,
    );
    this.#proof.contextReacquiredAfterGeneratedOutputChange = true;
    return false;
  }
  private executionDraftReadBack() {
    if (this.#applicationWorkingDirectory || this.#selectedTestDebugFixture)
      return this.completeEditorReadBack();
    return "rendered";
  }
  private completeEditorReadBack() {
    return process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland" ? "rendered" : "clipboard";
  }
  private async assertDraft(source = SOURCE) {
    await this.surface().assertBuffer(source, ` ${this.originalSource(source)}`, this.executionDraftReadBack());
    await this.surface().assertDirty(source, true);
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
    this.#proof.dirtyBufferPreservedWithoutSave = true;
  }
  private async assertRestoredOriginalBuffer(source = SOURCE) {
    await this.surface().assertBuffer(source, this.originalSource(source));
    await this.surface().assertDirty(source, false);
    assert.equal(await readFile(this.file(source), "utf8"), this.originalSource(source));
  }
  private async assertInputs({ allowSavedExecutionSource = false } = {}) {
    for (const [file, text] of this.#inputs) {
      if (allowSavedExecutionSource && file === this.executionSource()) continue;
      assert.equal(await readFile(this.file(file), "utf8"), text, `Project input changed: ${file}`);
    }
  }
  private async directoryManifest(root: string): Promise<string[]> {
    const result: string[] = [];
    const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const relative = path.join(relativeDirectory, entry.name).replaceAll("\\", "/");
        result.push(relative);
        await visit(path.join(directory, entry.name), relative);
      }
    };
    await visit(root, "");
    return result.sort();
  }
  private async fileManifest(root: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name),
          relative = path.join(relativeDirectory, entry.name).replaceAll("\\", "/");
        if (entry.isDirectory()) await visit(absolute, relative);
        else if (entry.isFile())
          result.set(
            relative,
            createHash("sha256")
              .update(await readFile(absolute))
              .digest("hex"),
          );
      }
    };
    await visit(root, "");
    return result;
  }
  private async mavenFilesChangedFromBaseline() {
    const baseline = this.#mavenManifestAtSync ?? this.#mavenManifestBeforeSync;
    if (!baseline) return [];
    const current = await this.fileManifest(this.file("maven"));
    return this.diffMavenFileManifests(baseline, current);
  }
  private diffMavenFileManifests(
    baseline: Map<string, string> | undefined,
    current: Map<string, string>,
  ) {
    if (!baseline) return [];
    const paths = new Set([...baseline.keys(), ...current.keys()]);
    return [...paths]
      .filter((relative) => baseline.get(relative) !== current.get(relative))
      .sort()
      .map((relative) => ({
        path: relative,
        before: baseline.get(relative) ?? null,
        after: current.get(relative) ?? null,
      }));
  }
  private mavenTargetFiles(manifest: Map<string, string>) {
    return [...manifest.keys()].filter((relative) => relative.split("/").includes("target")).sort();
  }
  private async assertMavenModuleTransactionRestored(): Promise<void> {
    const changed = await this.mavenFilesChangedFromBaseline();
    const transactionDirectory = this.file("maven/.refactorkit/transactions");
    await this.browser().waitUntil(
      async () => (await readdir(transactionDirectory)).every((name) => !name.includes(".tmp-")),
      {
        timeout: 5_000,
        interval: 50,
        timeoutMsg: "RefactorKit left a temporary transaction file after Maven rollback",
      },
    );
    const transactions = await readdir(transactionDirectory);
    assert.equal(transactions.length, 1);
    assert.match(transactions[0] ?? "", /^transaction-[0-9a-f-]{36}\.json$/u);
    const lockPath = ".refactorkit/workspace.lock";
    const transactionPath = `.refactorkit/transactions/${transactions[0]}`;
    assert.deepEqual(
      changed.map(({ path: relative }) => relative),
      [lockPath, transactionPath].sort(),
      "Maven inputs should match their synchronized baseline after rollback; only RefactorKit transaction metadata may remain",
    );
    assert.equal(await readFile(this.file(`maven/${lockPath}`), "utf8"), "");
  }
  private async waitForMavenOutputsToSettle() {
    const outputRoots = [
      "app/target/classes",
      "app/target/test-classes",
      "library/target/classes",
      "processor/target/classes",
      "runtime/target/classes",
      "testsupport/target/classes",
      "unrelated/target/classes",
      "unrelated/target/test-classes",
    ];
    const manifest = async () => {
      const current = new Map<string, string>();
      for (const root of outputRoots) {
        try {
          await access(this.file(`maven/${root}`));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        const output = await this.fileManifest(this.file(`maven/${root}`));
        for (const [relative, hash] of output) current.set(`${root}/${relative}`, hash);
      }
      return current;
    };
    const equals = (left: Map<string, string>, right: Map<string, string>) =>
      left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
    const deadline = Date.now() + 20_000;
    let previous: Map<string, string> | undefined;
    let stableSamples = 0;
    while (Date.now() < deadline) {
      const current = await manifest();
      stableSamples = previous && equals(previous, current) ? stableSamples + 1 : 0;
      if (stableSamples >= 8) return;
      previous = current;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Maven compiled outputs did not settle after the stale-context refusal");
  }
  private async removeGeneratedOutputProbe() {
    if (!this.#generatedOutputProbeCreated) return;
    for (const relative of [
      "maven/app/src/test/java/pkg/BackgroundOutputProbe.java",
      "maven/app/target/test-classes/pkg/BackgroundOutputProbe.class",
    ]) {
      try {
        await unlink(this.file(relative));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.#generatedOutputProbeCreated = false;
  }
  private async restoreStaleParameterOutputBackup() {
    const backup = this.#staleParameterOutputBackup;
    if (!backup) return;
    await writeFile(this.file(backup.relativePath), backup.bytes);
    this.#staleParameterOutputBackup = undefined;
  }
}
