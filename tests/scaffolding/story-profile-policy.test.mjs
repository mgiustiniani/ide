import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertAuthoredSelection } from "./cucumber-selection.mjs";
import { discoverCucumberSelections } from "../../scripts/cucumber-selection.mjs";

import * as cucumberProfiles from "../../cucumber.js";
import { evaluateDeclaredStoryRouting, scenarioKey } from "../../scripts/story-profile-policy.mjs";
import {
  runImplementedStoryAggregate,
  runProfileCommand,
} from "../../scripts/run-implemented-story-aggregate.mjs";

const scenario = (name, tags) => ({
  uri: "features/scaffolding.feature",
  line: 1,
  name,
  tags: new Set(tags),
});

// This file never changes the repository features or profile configuration. Discover each
// profile through Cucumber dry-run in one worker; return fresh tag sets for assertions.
let discoveredProfiles;
function selectedScenarios(profile) {
  discoveredProfiles ??= discoverCucumberSelections({repositoryRoot:process.cwd(),profiles:Object.keys(cucumberProfiles)});
  const discovered=discoveredProfiles.get(profile);
  return discovered.map((selected) => ({ ...selected, tags: new Set(selected.tags) }));
}

function requirementIds(selected) {
  return [...selected.tags].filter((tag) => tag.startsWith("@REQ-")).sort();
}

test("profiles keep default and focused routing while declaring exact aggregate evidence", () => {
  assert.deepEqual(cucumberProfiles.default.worldParameters, {
    target: { name: "unselected", driver: "unselected" },
  });
  assert.equal(cucumberProfiles.default.tags, undefined);

  assert.deepEqual(cucumberProfiles.implementedWeb.worldParameters, {
    target: { name: "web", driver: "playwright" },
  });
  assert.equal(
    cucumberProfiles.implementedWeb.tags,
    "@implemented-and-validated and @web and not @desktop",
  );

  assert.deepEqual(cucumberProfiles.implementedDesktopTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.implementedDesktopTauriHarness.tags,
    "@implemented-not-e2e-validated and @desktop and not @web",
  );

  const nativeGuiEvidence = {
    target: { name: "desktop", driver: "tauri-webdriver" },
    evidence: {
      kind: "tauri-webdriver",
      nativeGui: true,
      e2e: true,
      packagedApplication: false,
      artifactKind: "release-no-bundle",
    },
  };
  assert.deepEqual(
    cucumberProfiles.implementedDesktopTauriWebdriver.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.implementedDesktopTauriWebdriver.tags,
    "@implemented-and-validated and @desktop and @native-gui and not @web and not @packaging",
  );
  assert.deepEqual(cucumberProfiles.desktopTauriWebdriver.worldParameters, nativeGuiEvidence);
  assert.deepEqual(cucumberProfiles.desktopFileOpenNativeGui.worldParameters, nativeGuiEvidence);
  assert.equal(
    cucumberProfiles.desktopFileOpenNativeGui.tags,
    "@REQ-DESKTOP-FILE-OPEN-001 and @implemented-and-validated and @desktop and @native-gui and not @web",
  );
  assert.deepEqual(
    cucumberProfiles.refactorKitJavaImportNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.refactorKitJavaImportNativeGui.tags,
    "@REQ-REFACTORKIT-JAVA-IMPORT-002 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(cucumberProfiles.refactorKitJavaImportNativeGui.tags, /implemented|partial/);
  assert.deepEqual(cucumberProfiles.desktopLayoutNativeGui.worldParameters, nativeGuiEvidence);
  assert.equal(
    cucumberProfiles.desktopLayoutNativeGui.tags,
    "@REQ-LAYOUT-DESKTOP-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(cucumberProfiles.desktopLayoutNativeGui.tags, /implemented|partial/);
  assert.deepEqual(cucumberProfiles.piWorkspaceAgentNativeGui.worldParameters, nativeGuiEvidence);
  assert.equal(
    cucumberProfiles.piWorkspaceAgentNativeGui.tags,
    "@REQ-PI-WORKSPACE-AGENT-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.piWorkspaceAgentNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(cucumberProfiles.xcom2MachineSettingsTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-001",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(cucumberProfiles.xcom2ProjectFoundryTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-001",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
    evidence: {
      kind: "tauri-harness",
      nativeGui: false,
      e2e: false,
      packagedApplication: false,
    },
  });
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-002",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.worldParameters,
    {
      target: { name: "desktop", driver: "tauri" },
      evidence: {
        kind: "tauri-harness",
        nativeGui: false,
        e2e: false,
        packagedApplication: false,
      },
    },
  );
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-003",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.worldParameters,
    {
      target: { name: "desktop", driver: "tauri" },
      evidence: {
        kind: "tauri-harness",
        nativeGui: false,
        e2e: false,
        packagedApplication: false,
      },
    },
  );
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.tags,
    "@REQ-XCOM2-PROJECT-FOUNDRY-004",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.tags,
    /implemented|partial|not-implemented|native-gui|web/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ModuleActivationNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2ModuleActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ModuleActivationNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.worldParameters,
    nativeGuiEvidence,
  );
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 and @desktop and @native-gui and not @web",
  );
  assert.doesNotMatch(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.tags,
    /implemented|partial|not-implemented/,
  );

  assert.deepEqual(cucumberProfiles.implementedDesktop.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
  });
  assert.equal(
    cucumberProfiles.implementedDesktop.tags,
    "@implemented-and-validated and @desktop and not @web",
  );

  assert.deepEqual(cucumberProfiles.desktop.worldParameters, {
    target: { name: "desktop", driver: "tauri" },
  });
  assert.equal(cucumberProfiles.desktop.tags, "@desktop and not @web");
});

test("focused recovery profile binds real GUI evidence without promoting the partial capability", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(
    manifest.scripts["test:story:req-ide-editor-recovery-001:native"],
    "node scripts/run-native-desktop-story.mjs --profile editorRecoveryNativeGui",
  );
  assert.deepEqual(
    cucumberProfiles.editorRecoveryNativeGui.worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles.editorRecoveryNativeGui.tags,
    "@REQ-IDE-EDITOR-RECOVERY-001 and @native-recovery-restart and @desktop and @native-gui and not @web",
  );
  const selected = selectedScenarios("editorRecoveryNativeGui");
  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-IDE-EDITOR-RECOVERY-001"]);
  assert.ok(selected[0].tags.has("@partial"));
  assert.equal(selected[0].uri, "features/workspace/native-editor-recovery.feature");
  assertAuthoredSelection("editorRecoveryNativeGui", 1, 19, selected);
});

test("comparison, recovery errors and Java build tools have bounded real-GUI profiles with exact authored bindings", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const [profile, requirement, scopeTag, command, scenarios, steps, excludedScopes = []] of [
    [
      "javaFrameworkTestDebuggerNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-framework-test-debugger",
      "test:story:req-ide-java-project-context-native-001:debug-framework-tests",
      3,
      24,
    ],
    [
      "javaSelectedTestDebuggerNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-selected-test-debugger",
      "test:story:req-ide-java-project-context-native-001:debug-tests",
      2,
      16,
    ],
    [
      "javaFailedTestDebuggerNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-failed-test-debugger",
      "test:story:req-ide-java-project-context-native-001:debug-failed-tests",
      4,
      32,
    ],
    [
      "javaMoveMemberNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-move-member",
      "test:story:req-ide-java-sdk-refactoring-native-001:move-member",
      2,
      12,
    ],
    [
      "javaGradleBatchCleanupNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-gradle-batch-cleanup",
      "test:story:req-ide-java-sdk-refactoring-native-001:gradle-batch-cleanup",
      1,
      6,
    ],
    [
      "javaBatchCleanupNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-batch-cleanup",
      "test:story:req-ide-java-sdk-refactoring-native-001:batch-cleanup",
      1,
      6,
    ],
    [
      "javaSdkRefactoringNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-saved-refactoring",
      "test:story:req-ide-java-sdk-refactoring-native-001",
      8,
      51,
    ],
    [
      "javaCursorParameterReorderNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-cursor-parameter-reorder",
      "test:story:req-ide-java-sdk-refactoring-native-001:parameter-reorder",
      2,
      15,
    ],
    [
      "javaCursorParameterRenameNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-cursor-parameter-rename",
      "test:story:req-ide-java-sdk-refactoring-native-001:parameter-rename",
      1,
      6,
    ],
    [
      "javaPublicParameterReorderRefusalNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-public-parameter-reorder-refusal",
      "test:story:req-ide-java-sdk-refactoring-native-001:parameter-reorder-refusal",
      1,
      6,
    ],
    [
      "javaExtractMethodNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-extract-method",
      "test:story:req-ide-java-sdk-refactoring-native-001:extract-method",
      1,
      6,
    ],
    [
      "javaExtractVariableNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-extract-variable",
      "test:story:req-ide-java-sdk-refactoring-native-001:extract-variable",
      1,
      6,
    ],
    [
      "javaExtractParameterNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-extract-parameter",
      "test:story:req-ide-java-sdk-refactoring-native-001:extract-parameter",
      1,
      6,
    ],
    [
      "javaExtractFieldNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-extract-field",
      "test:story:req-ide-java-sdk-refactoring-native-001:extract-field",
      1,
      6,
    ],
    [
      "javaExtractSuperclassNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-extract-superclass",
      "test:story:req-ide-java-sdk-refactoring-native-001:extract-superclass",
      1,
      6,
    ],
    [
      "javaPullUpMemberNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-pull-up-member",
      "test:story:req-ide-java-sdk-refactoring-native-001:pull-up-member",
      1,
      6,
    ],
    [
      "javaPushDownMemberNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-push-down-member",
      "test:story:req-ide-java-sdk-refactoring-native-001:push-down-member",
      1,
      6,
    ],
    [
      "javaInlineVariableNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-inline-variable",
      "test:story:req-ide-java-sdk-refactoring-native-001:inline-variable",
      1,
      6,
    ],
    [
      "javaCursorParameterAdditionNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      ["@native-java-cursor-parameter-addition", "@native-java-signature-hierarchy"],
      "test:story:req-ide-java-sdk-refactoring-native-001:parameter-addition",
      2,
      12,
    ],
    [
      "javaCursorParameterTypeChangeNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-cursor-parameter-type-change",
      "test:story:req-ide-java-sdk-refactoring-native-001:parameter-type-change",
      1,
      6,
    ],
    [
      "javaCursorParameterRemovalNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-cursor-parameter-removal",
      "test:story:req-ide-java-sdk-refactoring-native-001:parameter-removal",
      1,
      6,
    ],
    [
      "javaMakePublicNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-make-public",
      "test:story:req-ide-java-sdk-refactoring-native-001:make-public",
      3,
      18,
    ],
    [
      "javaRefactorKitLspNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-lsp-refactoring",
      "test:story:req-ide-java-sdk-refactoring-native-001:lsp",
      1,
      6,
    ],
    [
      "javaDraftRefactoringNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-draft-refactoring",
      "test:story:req-ide-java-sdk-refactoring-native-001:drafts",
      1,
      6,
    ],
    [
      "javaDraftImportsRenameNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-draft-imports-rename",
      "test:story:req-ide-java-sdk-refactoring-native-001:draft-imports-rename",
      1,
      6,
    ],
    [
      "javaDraftRecoveryNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-draft-restart",
      "test:story:req-ide-java-sdk-refactoring-native-001:recovery",
      4,
      27,
    ],
    [
      "javaProjectModelPackageMoveNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-project-model-package-refactoring",
      "test:story:req-ide-java-sdk-refactoring-native-001:package-move",
      1,
      6,
    ],
    [
      "javaProjectModelPackageMoveCommandPaletteNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-project-model-package-refactoring-command-palette",
      "test:story:req-ide-java-sdk-refactoring-native-001:package-move:command-palette",
      1,
      6,
    ],
    [
      "javaGradleProjectModelPackageMoveNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-gradle-project-model-package-refactoring",
      "test:story:req-ide-java-sdk-refactoring-native-001:gradle-package-move",
      1,
      6,
    ],
    [
      "javaProjectContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "",
      "test:story:req-ide-java-project-context-native-001",
      1,
      31,
    ],
    [
      "java26ProjectContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java26-supported-context",
      "test:story:req-ide-java-project-context-native-001:java26-context",
      2,
      20,
    ],
    [
      "java26MavenContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", "@native-java26-maven-context",
      "test:story:req-ide-java-project-context-native-001:java26-maven-context", 1, 10,
    ],
    [
      "java26GradleContextNativeGui", "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001", "@native-java26-gradle-context",
      "test:story:req-ide-java-project-context-native-001:java26-gradle-context", 1, 10,
    ],
    [
      "java27ProjectContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java27-supported-context",
      "test:story:req-ide-java-project-context-native-001:java27-context",
      2,
      44,
    ],
    [
      "java27GradleContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java27-gradle-context",
      "test:story:req-ide-java-project-context-native-001:java27-gradle-context",
      1,
      33,
    ],
    [
      "java27MavenContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java27-maven-context",
      "test:story:req-ide-java-project-context-native-001:java27-maven-context",
      1,
      11,
    ],
    [
      "javaJdtlsRuntimePreferenceNativeGui",
      "@REQ-IDE-JAVA-LANGUAGE-001",
      "@native-java-jdtls-runtime-preference",
      "test:story:req-ide-java-language-001:native:runtime",
      1,
      5,
    ],
    [
      "javaGradleJpmsV5NativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-jpms-v5",
      "test:story:req-ide-java-project-context-native-001:gradle-jpms-v5",
      1,
      13,
    ],
    [
      "javaMavenJpmsV5NativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-maven-jpms-v5",
      "test:story:req-ide-java-project-context-native-001:maven-jpms-v5",
      1,
      12,
    ],
    [
      "javaGradlePreviewNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-preview",
      "test:story:req-ide-java-project-context-native-001:gradle-preview",
      1,
      8,
    ],
    [
      "javaMavenModuleRenameNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-maven-module-rename",
      "test:story:req-ide-java-project-context-native-001:module-rename",
      3,
      21,
    ],
    [
      "javaMavenModuleCreateNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-maven-module-create",
      "test:story:req-ide-java-sdk-refactoring-native-001:maven-module-create",
      1,
      6,
    ],
    [
      "javaGradleModuleCreateNativeGui",
      "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001",
      "@native-java-gradle-module-create",
      "test:story:req-ide-java-sdk-refactoring-native-001:gradle-module-create",
      2,
      12,
    ],
    [
      "javaGradleKotlinDslNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-kotlin-dsl",
      "test:story:req-ide-java-project-context-native-001:gradle-kotlin-dsl",
      1,
      8,
    ],
    [
      "javaProjectTestTemplatesNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-test-templates",
      "test:story:req-ide-java-project-context-native-001:test-templates",
      1,
      7,
    ],
    [
      "javaProjectTestTemplatesGradleNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-test-templates-gradle",
      "test:story:req-ide-java-project-context-native-001:gradle-templates",
      1,
      8,
    ],
    [
      "javaProjectScaffoldNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-scaffold",
      "test:story:req-ide-java-project-context-native-001:scaffold",
      2,
      21,
      ["@native-java-spring-boot-starter", "@native-java-spring-boot-gradle-starter"],
    ],
    [
      "java26ScaffoldNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java26-scaffold",
      "test:story:req-ide-java-project-context-native-001:scaffold-java26",
      1,
      6,
    ],
    [
      "java26ScaffoldBuildNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java26-scaffold-build",
      "test:story:req-ide-java-project-context-native-001:scaffold-java26-build",
      1,
      8,
    ],
    [
      "javaUnsupportedReleaseContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-unsupported-release-context",
      "test:story:req-ide-java-project-context-native-001:unsupported-release-context",
      2,
      12,
    ],
    [
      "javaProjectTextSearchNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-text-search",
      "test:story:req-ide-java-project-context-native-001:text-search",
      1,
      9,
    ],
    [
      "javaEntryPointsNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-entry-points",
      "test:story:req-ide-java-project-context-native-001:entry-points",
      3,
      32,
    ],
    [
      "javaDeclaredProjectNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-declared-project",
      "test:story:req-ide-java-project-context-native-001:declared-jdk",
      3,
      26,
    ],
    [
      "javaDeclaredProjectTestsNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-declared-project-tests",
      "test:story:req-ide-java-project-context-native-001:declared-tests",
      2,
      18,
    ],
    [
      "javaProjectExecutionNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-execution",
      "test:story:req-ide-java-project-context-native-001:execution",
      1,
      12,
    ],
    [
      "javaGradleDiagnosticsNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-diagnostics",
      "test:story:req-ide-java-project-context-native-001:gradle-diagnostics",
      6,
      24,
    ],
    [
      "javaProjectWorkingDirectoryNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-working-directory",
      "test:story:req-ide-java-project-context-native-001:working-directory",
      2,
      18,
    ],
    [
      "javaProjectWrapperNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-wrapper",
      "test:story:req-ide-java-project-context-native-001:wrappers",
      2,
      15,
    ],
    [
      "javaProjectCustomOutputNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-custom-output",
      "test:story:req-ide-java-project-context-native-001:custom-output",
      2,
      21,
    ],
    [
      "javaProjectDebuggerNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-debugger",
      "test:story:req-ide-java-project-context-native-001:debugger",
      2,
      31,
    ],
    [
      "javaGradleProjectExecutionNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-project-execution",
      "test:story:req-ide-java-project-context-native-001:gradle-execution",
      1,
      12,
    ],
    [
      "javaGradleCompositeExecutionNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-composite",
      "test:story:req-ide-java-project-context-native-001:gradle-composite",
      2,
      47,
    ],
    [
      "javaGradleMixedJvmNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-mixed-jvm",
      "test:story:req-ide-java-project-context-native-001:gradle-mixed-jvm",
      1,
      11,
    ],
    [
      "javaGradleKotlinDefinitionNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-kotlin-definition",
      "test:story:req-ide-java-project-context-native-001:gradle-kotlin-definition",
      1,
      10,
    ],
    [
      "javaMavenMixedJvmNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-maven-mixed-jvm",
      "test:story:req-ide-java-project-context-native-001:maven-mixed-jvm",
      1,
      10,
    ],
    [
      "javaGradleCustomSourceSetNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-custom-source-set",
      "test:story:req-ide-java-project-context-native-001:gradle-custom-source-set",
      2,
      29,
    ],
    [
      "javaMavenFailsafeContextNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-maven-failsafe-context",
      "test:story:req-ide-java-project-context-native-001:maven-failsafe-context",
      2,
      32,
    ],
    [
      "javaProjectDiscoveryNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-discovery",
      "test:story:req-ide-java-project-context-native-001:discovery",
      2,
      22,
    ],
    [
      "javaProjectCoverageNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-coverage",
      "test:story:req-ide-java-project-context-native-001:coverage",
      5,
      36,
    ],
    [
      "javaProjectGradleMultimoduleCoverageNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-gradle-multimodule-coverage",
      "test:story:req-ide-java-project-context-native-001:gradle-multimodule-coverage",
      1,
      9,
    ],
    [
      "javaProjectTestRerunNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-test-rerun",
      "test:story:req-ide-java-project-context-native-001:rerun",
      2,
      32,
    ],
    [
      "javaProjectJupiterTestsNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-jupiter-tests",
      "test:story:req-ide-java-project-context-native-001:jupiter",
      2,
      16,
    ],
    [
      "javaProjectTestNgTestsNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-testng-tests",
      "test:story:req-ide-java-project-context-native-001:testng",
      2,
      16,
    ],
    [
      "javaProjectMixedTestEnginesNativeGui",
      "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001",
      "@native-java-project-mixed-engines",
      "test:story:req-ide-java-project-context-native-001:mixed-engines",
      2,
      16,
    ],
    [
      "javaCursorNavigationNativeGui",
      "@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001",
      "",
      "test:story:req-ide-java-cursor-navigation-native-001",
      1,
      30,
    ],
    [
      "javaCodeActionsNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "",
      "test:story:req-ide-java-code-actions-native-001",
      6,
      94,
    ],
    [
      "javaOrganizeImportsNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-organize-imports",
      "test:story:req-ide-java-code-actions-native-001:organize-imports",
      1,
      9,
    ],
    [
      "javaFormatterProfileNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-formatter-profile",
      "test:story:req-ide-java-code-actions-native-001:formatter-profile",
      1,
      18,
    ],
    [
      "javaLocalRenameNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-semantic-local-rename",
      "test:story:req-ide-java-code-actions-native-001:local-rename",
      1,
      9,
    ],
    [
      "javaParameterRenameNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-semantic-parameter-rename",
      "test:story:req-ide-java-code-actions-native-001:parameter-rename",
      1,
      9,
    ],
    [
      "javaCrossFileRenameNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-semantic-cross-file-rename",
      "test:story:req-ide-java-code-actions-native-001:cross-file-rename",
      2,
      19,
    ],
    [
      "javaMultiDocumentCodeActionNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-semantic-multi-document-code-action",
      "test:story:req-ide-java-code-actions-native-001:multi-document",
      2,
      21,
    ],
    [
      "javaTryCatchCodeActionNativeGui",
      "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001",
      "@native-java-surround-try-catch",
      "test:story:req-ide-java-code-actions-native-001:try-catch",
      1,
      9,
    ],
    [
      "javaBuildToolsNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-build-tools",
      "test:story:req-ide-java-execution-native-001:build-tools",
      3,
      64,
    ],
    [
      "javaApplicationInputNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-application-input",
      "test:story:req-ide-java-execution-native-001:application-input",
      9,
      45,
    ],
    [
      "javaWorkingDirectoryNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-working-directory",
      "test:story:req-ide-java-execution-native-001:working-directory",
      1,
      5,
    ],
    [
      "java8MavenRunNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java8-maven-run",
      "test:story:req-ide-java-execution-native-001:java8-maven-run",
      1,
      4,
    ],
    [
      "javaFailsafeReactorNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-failsafe-reactor",
      "test:story:req-ide-java-execution-native-001:failsafe-reactor",
      2,
      24,
    ],
    [
      "javaTestJvmNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-test-jvm-options",
      "test:story:req-ide-java-execution-native-001:test-jvm",
      3,
      43,
    ],
    [
      "javaCoverageNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-coverage",
      "test:story:req-ide-java-execution-native-001:coverage",
      2,
      24,
    ],
    [
      "javaConditionalDebuggerNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-conditional-debugger",
      "test:story:req-ide-java-execution-native-001:conditions",
      1,
      10,
    ],
    [
      "javaExceptionBreakpointsNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-exception-breakpoints",
      "test:story:req-ide-java-execution-native-001:exception-breakpoints",
      1,
      3,
    ],
    [
      "javaAttachDebuggerNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-jdi-attach",
      "test:story:req-ide-java-execution-native-001:attach",
      1,
      14,
    ],
    [
      "javaDebuggerNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-debugger",
      "test:story:req-ide-java-execution-native-001:debugger",
      3,
      45,
    ],
    [
      "javaJdiDebuggerNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-jdi-debugger",
      "test:story:req-ide-java-execution-native-001:jdi",
      2,
      34,
    ],
    [
      "javaFileOperationsNativeGui",
      "@REQ-IDE-JAVA-FILE-OPERATIONS-NATIVE-001",
      "@native-java-file-operations",
      "test:story:req-ide-java-file-operations-native-001",
      2,
      12,
    ],
    [
      "javaTestDiscoveryNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-test-discovery",
      "test:story:req-ide-java-execution-native-001:discovery",
      5,
      60,
    ],
    [
      "editorExternalChangesNativeGui",
      "@REQ-IDE-EDITOR-EXTERNAL-CHANGES-001",
      "",
      "test:story:req-ide-editor-external-changes-001:native",
      1,
      17,
    ],
    [
      "javaTestNgDiscoveryNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-testng-discovery",
      "test:story:req-ide-java-execution-native-001:testng-discovery",
      2,
      20,
    ],
    [
      "javaJupiterTestExecutionNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-junit5-test-execution",
      "test:story:req-ide-java-execution-native-001:junit5-run",
      2,
      22,
    ],
    [
      "javaTestNgTestExecutionNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-testng-test-execution",
      "test:story:req-ide-java-execution-native-001:testng-run",
      2,
      22,
    ],
    [
      "javaPlainJdkTestNgNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "@native-java-plain-jdk-testng",
      "test:story:req-ide-java-execution-native-001:plain-jdk-testng",
      2,
      27,
    ],
    [
      "desktopStartupResponsivenessNativeGui",
      "@REQ-IDE-STARTUP-RESPONSIVENESS-NATIVE-001",
      "",
      "test:story:req-ide-startup-responsiveness-native-001",
      1,
      8,
    ],
    [
      "editorDiskComparisonNativeGui",
      "@REQ-IDE-EDITOR-DISK-COMPARISON-001",
      "",
      "test:story:req-ide-editor-disk-comparison-001:native",
      3,
      43,
    ],
    [
      "editorRecoveryHistoryNativeGui",
      "@REQ-IDE-EDITOR-RECOVERY-001",
      "@native-recovery-history",
      "test:story:req-ide-editor-recovery-001:history:native",
      2,
      27,
    ],
    [
      "editorRecoveryFailuresNativeGui",
      "@REQ-IDE-EDITOR-RECOVERY-001",
      "@native-recovery-failures",
      "test:story:req-ide-editor-recovery-001:failures:native",
      2,
      23,
    ],
    [
      "editorRecoveryCapacityCorruptionNativeGui",
      "@REQ-IDE-EDITOR-RECOVERY-001",
      "@native-recovery-capacity-corruption",
      "test:story:req-ide-editor-recovery-001:capacity-corruption:native",
      2,
      31,
    ],
  ]) {
    const scopeTags = Array.isArray(scopeTag) ? scopeTag : [scopeTag].filter(Boolean);
    const scopeExpression = scopeTags.length > 1 ? `(${scopeTags.join(" or ")})` : scopeTags[0];
    assert.equal(
      manifest.scripts[command],
      `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
    );
    assert.deepEqual(
      cucumberProfiles[profile].worldParameters,
      cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
    );
    assert.equal(
      cucumberProfiles[profile].tags,
      `${requirement}${profile === "javaProjectContextNativeGui" ? " and not @native-java-project-scaffold and not @native-java-text-search and not @native-java-entry-points and not @native-java-declared-project and not @native-java-editor-diagnostics and not @native-java-editor-sdk26-diagnostics and not @native-java-project-execution and not @native-java-project-working-directory and not @native-java-gradle-diagnostics and not @native-java-maven-preparation and not @native-java-project-wrapper and not @native-java-project-custom-output and not @native-java-gradle-project-execution and not @native-java-gradle-composite and not @native-java-gradle-mixed-jvm and not @native-java-gradle-kotlin-definition and not @native-java-maven-mixed-jvm and not @native-java-gradle-custom-source-set and not @native-java-maven-failsafe-context and not @native-java-gradle-kotlin-dsl and not @native-java-project-debugger and not @native-java-selected-test-debugger and not @native-java-failed-test-debugger and not @native-java-framework-test-debugger and not @native-java-project-tests and not @native-java-project-jupiter-tests and not @native-java-project-testng-tests and not @native-java-project-mixed-engines and not @native-java-project-coverage and not @native-java-test-templates and not @native-java-test-templates-gradle and not @native-java-maven-module-rename and not @native-java-gradle-project-model and not @native-java-gradle-preview and not @native-java-gradle-jpms-v5 and not @native-java-maven-jpms-v5 and not @native-java-unsupported-release-context and not @native-java26-scaffold-build and not @native-java26-scaffold-wrapper-build and not @native-java27-scaffold-wrapper-build and not @native-java26-supported-context and not @native-java27-supported-context and not @native-java27-preview-source-ownership and not @native-java27-v7-owner-only-source-ownership and not @native-java27-v7-jdtls-definition and not @native-java-git-branch-context and not @native-java-git-rebase-context and not @native-java-reference-backend and not @native-java-modular-source-creation and not @native-java-compact-source" : ""}${scopeExpression ? ` and ${scopeExpression}` : ""}${excludedScopes.map(tag => ` and not ${tag}`).join("")}${profile === "javaProjectCoverageNativeGui" ? " and not @native-java-gradle-multimodule-coverage" : ""}${profile === "javaMavenFailsafeContextNativeGui" ? " and not @native-java-maven-test-jvm-selection" : ""} and @desktop and @native-gui and not @web${profile === "javaCodeActionsNativeGui" ? " and not @native-java-organize-imports and not @native-java-semantic-local-rename and not @native-java-semantic-parameter-rename and not @native-java-semantic-cross-file-rename and not @native-java-semantic-nested-type-rename and not @native-java-semantic-record-component-rename and not @native-java-semantic-multi-document-code-action and not @native-java-surround-try-catch and not @native-java-language-responsiveness and not @native-java-javadoc" : ""}`,
    );
    const selected = selectedScenarios(profile);
    assert.equal(selected.length, scenarios, `unexpected selection count for ${profile}`);
    for (const scenario of selected) {
      assert.deepEqual(requirementIds(scenario), [requirement]);
      assert.ok(scenario.tags.has("@partial"));
      if (scopeTags.length) assert.ok(scopeTags.some(tag => scenario.tags.has(tag)));
    }
    assertAuthoredSelection(profile, scenarios, steps, selected);
  }
});

test("parameter rename profile selects only the overloaded parameter binding story", async () => {
  const profile = "javaParameterRenameNativeGui";
  const requirement = "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001";
  const scope = "@native-java-semantic-parameter-rename";
  const script = "test:story:req-ide-java-code-actions-native-001:parameter-rename";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(
    manifest.scripts[script],
    `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
  );
  assert.deepEqual(
    cucumberProfiles[profile].worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and ${scope} and @desktop and @native-gui and not @web`,
  );
  const selected = selectedScenarios(profile);
  assert.deepEqual(
    selected.map(({ name }) => name),
    ["Rename one overloaded Java parameter without changing same-named bindings"],
  );
  assertAuthoredSelection(profile, 1, 9, selected);
  assert.ok(selected[0].tags.has(requirement));
  assert.ok(selected[0].tags.has(scope));
  assert.ok(selected[0].tags.has("@partial"));
});

test("nested-type and record-component rename profile selects only the two semantic rename stories", async () => {
  const profile = "javaSemanticTypeRenameNativeGui";
  const requirement = "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001";
  const script = "test:story:req-ide-java-code-actions-native-001:semantic-type-renames";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(
    manifest.scripts[script],
    `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
  );
  assert.deepEqual(
    cucumberProfiles[profile].worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and (@native-java-semantic-nested-type-rename or @native-java-semantic-record-component-rename) and @desktop and @native-gui and not @web`,
  );
  const selected = selectedScenarios(profile);
  assert.equal(selected.length, 2);
  assertAuthoredSelection(profile, 2, 20, selected);
  assert.deepEqual(selected.map(({ name }) => name).sort(), [
    "Rename a Java record component and its accessor references across two open drafts",
    "Rename a nested Java type and its references across two open drafts",
  ]);
  for (const scenario of selected) {
    assert.ok(scenario.tags.has(requirement));
    assert.ok(scenario.tags.has("@partial"));
  }
});

test("native guard and Java execution commands remain real-GUI-only with exact step bindings", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const [profile, requirement, command] of [
    [
      "editorCloseGuardsNativeGui",
      "@REQ-IDE-EDITOR-CLOSE-GUARDS-001",
      "test:story:req-ide-editor-close-guards-001:native",
    ],
    [
      "javaExecutionNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "test:story:req-ide-java-execution-native-001",
    ],
    [
      "javaFlightRecorderNativeGui",
      "@REQ-IDE-JAVA-EXECUTION-NATIVE-001",
      "test:story:req-ide-java-execution-native-001:jfr",
    ],
  ]) {
    assert.equal(
      manifest.scripts[command],
      `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
    );
    assert.deepEqual(
      cucumberProfiles[profile].worldParameters,
      cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
    );
    assert.equal(
      cucumberProfiles[profile].tags,
      `${requirement}${profile === "javaExecutionNativeGui" ? " and @native-java-jdk" : profile === "javaFlightRecorderNativeGui" ? " and @native-java-jfr" : ""} and @desktop and @native-gui and not @web`,
    );
    const selected = selectedScenarios(profile);
    const guard = profile === "editorCloseGuardsNativeGui";
    assert.equal(selected.length, guard ? 2 : 1);
    for (const scenario of selected) {
      assert.deepEqual(requirementIds(scenario), [requirement]);
      assert.ok(scenario.tags.has("@partial"));
    }
    assertAuthoredSelection(
      profile,
      guard ? 2 : 1,
      guard
        ? 25
        : profile === "javaCursorNavigationNativeGui"
          ? 18
          : profile === "javaFlightRecorderNativeGui"
            ? 11
            : 16,
      selected,
    );
  }
});

test("core Java language-intelligence GUI profile runs without the separate Java 27 preview fixture", async () => {
  const profile = "javaLanguageIntelligenceCoreNativeGui";
  const requirement = "@REQ-IDE-JAVA-LANGUAGE-001";
  const scope = "@native-java-language-intelligence";
  const script = "test:story:req-ide-java-language-001:native:core";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(
    manifest.scripts[script],
    `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
  );
  assert.deepEqual(
    cucumberProfiles[profile].worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and ${scope} and not @native-java-search-everywhere and not @native-java27-preview and not @native-java26-preview and @desktop and @native-gui and not @web`,
  );

  const selected = selectedScenarios(profile);
  assert.deepEqual(
    selected.map(({ name }) => name),
    ["AC-007 - Java diagnostics and intelligence reach the native editor"],
  );
  assertAuthoredSelection(profile, 1, 25, selected);
  assert.ok(selected[0].tags.has(requirement));
  assert.ok(selected[0].tags.has(scope));
  assert.ok(selected[0].tags.has("@partial"));
});

test("Java 26 preview language support has a focused native project profile", async () => {
  const profile = "java26PreviewImportNativeGui";
  const requirement = "@REQ-IDE-JAVA-LANGUAGE-001";
  const script = "test:story:req-ide-java-language-001:native:java26-preview";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(
    manifest.scripts[script],
    `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
  );
  assert.deepEqual(
    cucumberProfiles[profile].worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and @native-java26-preview and @desktop and @native-gui and not @web`,
  );

  const selected = selectedScenarios(profile);
  assert.deepEqual(
    selected.map(({ name }) => name),
    ["AC-012 - Java 26 primitive patterns resolve in the native editor"],
  );
  assertAuthoredSelection(profile, 1, 5, selected);
  assert.ok(selected[0].tags.has(requirement));
  assert.ok(selected[0].tags.has("@native-java26-preview"));
});

test("Java 27 preview language support has a focused native project profile", async () => {
  const profile = "java27PreviewImportNativeGui";
  const requirement = "@REQ-IDE-JAVA-LANGUAGE-001";
  const scope = "@native-java27-preview";
  const script = "test:story:req-ide-java-language-001:native:java27-preview";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(
    manifest.scripts[script],
    `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
  );
  assert.deepEqual(
    cucumberProfiles[profile].worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and ${scope} and @desktop and @native-gui and not @web`,
  );

  const selected = selectedScenarios(profile);
  assert.deepEqual(
    selected.map(({ name }) => name),
    ["AC-009 - Maven Java 27 preview source resolves in the native editor"],
  );
  assertAuthoredSelection(profile, 1, 5, selected);
  assert.ok(selected[0].tags.has(requirement));
  assert.ok(selected[0].tags.has(scope));
  assert.ok(
    selectedScenarios("javaLanguageIntelligenceNativeGui").every(
      (scenario) => !scenario.tags.has(scope),
    ),
  );
});

test("Search Everywhere has one focused native GUI scenario for all result sources", async () => {
  const profile = "javaSearchEverywhereNativeGui";
  const requirement = "@REQ-IDE-JAVA-LANGUAGE-001";
  const scope = "@native-java-search-everywhere";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(
    manifest.scripts["test:story:req-ide-search-everywhere-native-001"],
    `node scripts/run-native-desktop-story.mjs --profile ${profile}`,
  );
  assert.deepEqual(
    cucumberProfiles[profile].worldParameters,
    cucumberProfiles.desktopFileOpenNativeGui.worldParameters,
  );
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and ${scope} and @desktop and @native-gui and not @web`,
  );

  const selected = selectedScenarios(profile);
  assert.deepEqual(
    selected.map(({ name }) => name),
    ["AC-010 - Search Everywhere combines file, Java symbol, and project text results"],
  );
  assertAuthoredSelection(profile, 1, 8, selected);
  assert.ok(selected[0].tags.has(requirement));
  assert.ok(selected[0].tags.has(scope));
  assert.ok(selected[0].tags.has("@partial"));
});

test("AppImage compiler and source creation profile selects the existing real workflows", async () => {
  const profile = "javaCompilerAndSourceCreationAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:java-compiler-source-creation:appimage"],
    "node scripts/run-native-appimage-java-story.mjs --profile javaCompilerAndSourceCreationAppImageNativeGui");
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 22, 207, selected);
  const ordinary = ["javaSourceFileCreationNativeGui", "javaExecutionNativeGui", "javaBuildToolsNativeGui", "javaProjectExecutionNativeGui", "javaGradleProjectExecutionNativeGui", "javaApplicationInputNativeGui"].flatMap(selectedScenarios);
  assert.deepEqual(selected.map(({ name }) => name).sort(), ordinary.map(({ name }) => name).sort());
});

test("Gradle composite AppImage exercises the same two projects with packaged evidence", async () => {
  const profile = "javaGradleCompositeExecutionAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:gradle-composite:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:gradle-composite:appimage:wayland"],
    `node scripts/run-native-appimage-java-story.mjs --wayland --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 2, 47, selected);
  assert.equal(cucumberProfiles[profile].tags, cucumberProfiles.javaGradleCompositeExecutionNativeGui.tags);
});

test("The mixed JVM AppImage exercises the Maven and Gradle workflows with packaged evidence", async () => {
  const profile = "javaMixedJvmAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:mixed-jvm:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 2, 21, selected);
  const releaseProfiles = ["javaGradleMixedJvmNativeGui", "javaMavenMixedJvmNativeGui"];
  assert.deepEqual(selected.map(({ name }) => name).sort(),
    releaseProfiles.flatMap(selectedScenarios).map(({ name }) => name).sort());
});

test("The Kotlin definition AppImage exercises the Gradle workflow with packaged evidence", async () => {
  const profile = "javaGradleKotlinDefinitionAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:gradle-kotlin-definition:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  assert.equal(cucumberProfiles[profile].tags, cucumberProfiles.javaGradleKotlinDefinitionNativeGui.tags);
  assertAuthoredSelection(profile, 1, 10, selectedScenarios(profile));
});

test("The class refactoring AppImage keeps the Maven and Gradle scenarios", async () => {
  const profile = "javaProjectModelClassRefactoringAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:project-model:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:project-model:appimage:wayland"],
    `node scripts/run-native-appimage-java-story.mjs --wayland --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 3, 18, selected);
  const releaseProfiles = ["javaProjectModelClassRefactoringNativeGui", "javaGradleProjectModelClassRefactoringNativeGui"];
  assert.deepEqual(selected.map(({ name }) => name).sort(),
    releaseProfiles.flatMap(selectedScenarios).map(({ name }) => name).sort());
});

test("The package move AppImage keeps all Maven and Gradle entry points", async () => {
  const profile = "javaProjectModelPackageMoveAppImageNativeGui";
  const command = "test:story:req-ide-java-sdk-refactoring-native-001:package-move";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts[`${command}:appimage`],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.equal(manifest.scripts[`${command}:appimage:wayland`],
    `node scripts/run-native-appimage-java-story.mjs --wayland --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 3, 18, selected);
  const releaseProfiles = [
    "javaProjectModelPackageMoveNativeGui",
    "javaProjectModelPackageMoveCommandPaletteNativeGui",
    "javaGradleProjectModelPackageMoveNativeGui",
  ];
  assert.deepEqual(selected.map(({ name }) => name).sort(),
    releaseProfiles.flatMap(selectedScenarios).map(({ name }) => name).sort());
});

test("The cross-module Gradle move AppImage selects the positive acceptance scenario", async () => {
  const profile = "javaGradleCrossModuleClassMoveAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:gradle-cross-module-class-move:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:gradle-cross-module-class-move:appimage:wayland"],
    `node scripts/run-native-appimage-java-story.mjs --wayland --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  assertAuthoredSelection(profile, 1, 6, selectedScenarios(profile));
});

test("The Java reference AppImage selects both six-module development workflows", async () => {
  const profile = "javaReferenceDevelopmentAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:reference-development:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  assertAuthoredSelection(profile, 2, 18, selectedScenarios(profile));
});

test("The Gradle class move recovery AppImage exercises the missing-output diagnostic and retry", async () => {
  const profile = "javaGradleClassMoveRecoveryAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:gradle-class-move-recovery:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.equal(manifest.scripts["test:story:req-ide-java-sdk-refactoring-native-001:gradle-class-move-recovery:appimage:wayland"],
    `node scripts/run-native-appimage-java-story.mjs --wayland --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  assertAuthoredSelection(profile, 1, 8, selectedScenarios(profile));
});

test("The recent JDK AppImage profiles retain the Maven and Gradle context scenarios", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const [release, steps] of [[26, 20], [27, 44]]) {
    const nativeProfile = `java${release}ProjectContextNativeGui`;
    const packagedProfile = `java${release}ProjectContextAppImageNativeGui`;
    assert.equal(manifest.scripts[`test:story:req-ide-java-project-context-native-001:java${release}-context:appimage`],
      `node scripts/run-native-appimage-java-story.mjs --profile ${packagedProfile}`);
    assert.equal(cucumberProfiles[packagedProfile].tags, cucumberProfiles[nativeProfile].tags);
    assert.deepEqual(cucumberProfiles[packagedProfile].worldParameters.evidence, {
      kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
    });
    assertAuthoredSelection(packagedProfile, 2, steps, selectedScenarios(packagedProfile));
  }
});

test("The Java 26 compiler-check AppImage selects both Maven classpaths and both compiler configurations", async () => {
  const profile = "java26EditorDiagnosticsAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:java26-diagnostics:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const scenarios = selectedScenarios(profile);
  assertAuthoredSelection(profile, 4, 34, scenarios);
  assert.deepEqual(scenarios.map(({ name }) => name).sort(),
    ["java26EditorDiagnosticsNativeGui", "java26TestSourceEditorDiagnosticsNativeGui"]
      .flatMap(selectedScenarios).map(({ name }) => name).sort());
});

test("The recent Java starter AppImage profiles select the pinned wrapper bootstrap scenarios", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const release of [26, 27]) {
    const profile = `java${release}ScaffoldWrapperBuildAppImageNativeGui`;
    assert.equal(manifest.scripts[`test:story:req-ide-java-project-context-native-001:scaffold-java${release}-wrappers:appimage`],
      `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
    assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
      kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
    });
    assertAuthoredSelection(profile, 1, 8, selectedScenarios(profile));
  }
});

test("The Maven Failsafe AppImage keeps both reactor scenarios and requires packaged evidence", async () => {
  const profile = "javaMavenFailsafeContextAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:maven-failsafe-context:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  assert.equal(cucumberProfiles[profile].tags, cucumberProfiles.javaMavenFailsafeContextNativeGui.tags);
  assertAuthoredSelection(profile, 2, 32, selectedScenarios(profile));
});

test("The debugger AppImage profiles keep the selected-test and failed-test scenarios", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const [profile, releaseProfile, command, scenarios, steps] of [
    ["javaSelectedTestDebuggerAppImageNativeGui", "javaSelectedTestDebuggerNativeGui", "debug-tests", 2, 16],
    ["javaFailedTestDebuggerAppImageNativeGui", "javaFailedTestDebuggerNativeGui", "debug-failed-tests", 4, 32],
  ]) {
    assert.equal(manifest.scripts[`test:story:req-ide-java-project-context-native-001:${command}:appimage`],
      `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
    assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
      kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
    });
    assert.equal(cucumberProfiles[profile].tags, cucumberProfiles[releaseProfile].tags);
    assertAuthoredSelection(profile, scenarios, steps, selectedScenarios(profile));
  }
});

test("The Java project execution AppImage keeps the Maven and Gradle execution and application debugger scenarios", async () => {
  const profile = "javaProjectExecutionAndDebuggerAppImageNativeGui";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(manifest.scripts["test:story:req-ide-java-project-context-native-001:execution-debugger:appimage"],
    `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
  assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
    kind: "tauri-webdriver", nativeGui: true, e2e: true, packagedApplication: true, artifactKind: "appimage",
  });
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 4, 55, selected);
  const releaseProfiles = [
    "javaProjectExecutionNativeGui",
    "javaGradleProjectExecutionNativeGui",
    "javaProjectDebuggerNativeGui",
  ];
  assert.deepEqual(selected.map(({ name }) => name).sort(),
    releaseProfiles.flatMap(selectedScenarios).map(({ name }) => name).sort());
});

test("AppImage execution profiles retain their native scenarios and require packaged evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  for (const [profile, releaseProfile, command, scenarios, steps] of [
    ["javaApplicationInputAppImageNativeGui", "javaApplicationInputNativeGui", "application-input", 9, 45],
    ["java8MavenRunAppImageNativeGui", "java8MavenRunNativeGui", "java8-maven-run", 1, 4],
    ["javaPlainJdkTestNgAppImageNativeGui", "javaPlainJdkTestNgNativeGui", "plain-jdk-testng", 2, 27],
    ["javaDebuggerAppImageNativeGui", "javaDebuggerNativeGui", "debugger", 3, 45],
  ]) {
    assert.equal(manifest.scripts[`test:story:req-ide-java-execution-native-001:${command}:appimage`],
      `node scripts/run-native-appimage-java-story.mjs --profile ${profile}`);
    assert.deepEqual(cucumberProfiles[profile].worldParameters.evidence, {
      kind: "tauri-webdriver", nativeGui: true, e2e: true,
      packagedApplication: true, artifactKind: "appimage",
    });
    const selected = selectedScenarios(profile);
    assertAuthoredSelection(profile, scenarios, steps, selected);
    assert.deepEqual(selected.map(({ name }) => name), selectedScenarios(releaseProfile).map(({ name }) => name));
  }
});

test("AppImage Java profile declares packaged evidence for intelligence and template scenarios", async () => {
  const profile = "javaLanguageIntelligenceAppImageNativeGui";
  const requirement = "@REQ-IDE-JAVA-LANGUAGE-001";
  const scope = "@native-java-language-intelligence";
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(
    manifest.scripts["test:story:req-ide-java-language-001:appimage"],
    "node scripts/run-native-appimage-java-story.mjs",
  );
  assert.deepEqual(cucumberProfiles[profile].worldParameters, {
    target: { name: "desktop", driver: "tauri-webdriver" },
    evidence: {
      kind: "tauri-webdriver",
      nativeGui: true,
      e2e: true,
      packagedApplication: true,
      artifactKind: "appimage",
    },
  });
  assert.equal(
    cucumberProfiles[profile].tags,
    `${requirement} and (${scope} or @native-java-templates) and not @native-java-search-everywhere and not @native-java27-preview and not @native-java26-preview and @desktop and @native-gui and not @web`,
  );

  const selected = selectedScenarios(profile);
  assert.deepEqual(
    selected.map(({ name }) => name),
    [
      "AC-007 - Java diagnostics and intelligence reach the native editor",
      "AC-008 - Java typing templates expand in the native editor",
    ],
  );
  assertAuthoredSelection(profile, 2, 36, selected);
  assert.ok(selected[0].tags.has(requirement));
  assert.ok(selected[0].tags.has(scope));
  assert.ok(selected[0].tags.has("@partial"));
});

test("focused XCOM machine Settings profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2MachineSettingsTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MACHINE-SETTINGS-001"]);
  assert.equal(selected[0].uri, "features/xcom2/machine-settings-runtime.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-001",
  );
});

test("focused XCOM machine Settings command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-machine-settings-001"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2MachineSettingsTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsTauriHarness.worldParameters.evidence.artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-001"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assertAuthoredSelection("xcom2ProjectFoundryTauriHarness", 1, 57, selected);
});

test("focused XCOM Project Foundry command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-001"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryTauriHarness.worldParameters.evidence.artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry Apply profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryApplyTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-002"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assertAuthoredSelection("xcom2ProjectFoundryApplyTauriHarness", 1, 38, selected);
});

test("focused XCOM Project Foundry Apply command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-002"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryApplyTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryApplyTauriHarness.worldParameters.evidence.artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry destination-conflict profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryDestinationConflictTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-003"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assertAuthoredSelection("xcom2ProjectFoundryDestinationConflictTauriHarness", 1, 52, selected);
});

test("focused XCOM Project Foundry destination-conflict command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-003"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryDestinationConflictTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryDestinationConflictTauriHarness.worldParameters.evidence
      .artifactKind,
    undefined,
  );
});

test("focused XCOM Project Foundry verified-cleanup profile retains its promoted deterministic harness route", () => {
  const selected = selectedScenarios("xcom2ProjectFoundryVerifiedCleanupTauriHarness");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-PROJECT-FOUNDRY-004"]);
  assert.equal(selected[0].uri, "features/xcom2/project-foundry.feature");
  assert.ok(selected[0].tags.has("@implemented-not-e2e-validated"));
  assert.equal(selected[0].tags.has("@partial"), false);
  assert.equal(selected[0].tags.has("@not-implemented"), false);
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@tauri-harness"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(selected[0].tags.has("@native-gui"), false);
  assertAuthoredSelection("xcom2ProjectFoundryVerifiedCleanupTauriHarness", 1, 65, selected);
});

test("focused XCOM Project Foundry verified-cleanup command declares only deterministic harness evidence", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const command = manifest.scripts["test:story:req-xcom2-project-foundry-004"];

  assert.equal(
    command,
    "IDE_STORY_TARGET=desktop/tauri-harness node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js --profile xcom2ProjectFoundryVerifiedCleanupTauriHarness",
  );
  assert.match(command, /^IDE_STORY_TARGET=desktop\/tauri-harness\b/);
  assert.doesNotMatch(command, /native|webdriver|playwright|implementedWeb|build|package|bundle/i);
  assert.equal(
    cucumberProfiles.xcom2ProjectFoundryVerifiedCleanupTauriHarness.worldParameters.evidence
      .artifactKind,
    undefined,
  );
});

test("focused missing-Steam XCOM machine Settings profile is native-only and status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2MachineSettingsMissingSteamNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001"]);
  assert.equal(selected[0].uri, "features/xcom2/machine-settings-missing-steam.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.ok(selected[0].tags.has("@desktop"));
  assert.ok(selected[0].tags.has("@native-gui"));
  assert.equal(selected[0].tags.has("@web"), false);
  assert.equal(
    cucumberProfiles.xcom2MachineSettingsMissingSteamNativeGui.tags,
    "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001 and @desktop and @native-gui and not @web",
  );
});

test("focused XCOM module activation profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2ModuleActivationNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MODULE-ACTIVATION-001"]);
  assert.equal(selected[0].uri, "features/xcom2/module-activation.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.equal(
    cucumberProfiles.xcom2ModuleActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
});

test("focused XCOM module configuration activation profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2ModuleConfigurationActivationNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), ["@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001"]);
  assert.equal(selected[0].uri, "features/xcom2/module-configuration-activation.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationActivationNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 and @desktop and @native-gui and not @web",
  );
});

test("focused XCOM module configuration diagnostics profile stays status-independent after promotion", () => {
  const selected = selectedScenarios("xcom2ModuleConfigurationDiagnosticsNativeGui");

  assert.equal(selected.length, 1);
  assert.deepEqual(requirementIds(selected[0]), [
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
  ]);
  assert.equal(selected[0].uri, "features/xcom2/module-configuration-diagnostics.feature");
  assert.ok(selected[0].tags.has("@implemented-and-validated"));
  assert.equal(
    cucumberProfiles.xcom2ModuleConfigurationDiagnosticsNativeGui.tags,
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 and @desktop and @native-gui and not @web",
  );
});

test("focused Pi workspace Agent profiles stay exact and status-independent after promotion", () => {
  const nativeSelected = selectedScenarios("piWorkspaceAgentNativeGui");
  const harnessSelected = selectedScenarios("piWorkspaceAgentTauriHarness");

  assert.equal(nativeSelected.length, 1);
  assert.equal(harnessSelected.length, 1);
  assert.deepEqual(requirementIds(nativeSelected[0]), ["@REQ-PI-WORKSPACE-AGENT-001"]);
  assert.deepEqual(requirementIds(harnessSelected[0]), ["@REQ-PI-WORKSPACE-AGENT-001"]);
  assert.equal(nativeSelected[0].uri, "features/workspace/pi-native-agent.feature");
  assert.equal(harnessSelected[0].uri, nativeSelected[0].uri);
  assert.ok(nativeSelected[0].tags.has("@implemented-and-validated"));
  assert.equal(nativeSelected[0].tags.has("@implemented-not-e2e-validated"), false);
  assert.ok(nativeSelected[0].tags.has("@desktop"));
  assert.ok(nativeSelected[0].tags.has("@native-gui"));
  assert.ok(nativeSelected[0].tags.has("@tauri-harness"));
  assert.equal(nativeSelected[0].tags.has("@web"), false);
  assertAuthoredSelection("piWorkspaceAgentNativeGui", 1, 34, nativeSelected);
  assertAuthoredSelection("piWorkspaceAgentTauriHarness", 1, 34, harnessSelected);
  assert.equal(cucumberProfiles.piWorkspaceAgentTauriHarness.tags, "@REQ-PI-WORKSPACE-AGENT-001");
  assert.equal(
    cucumberProfiles.piWorkspaceAgentNativeGui.tags,
    "@REQ-PI-WORKSPACE-AGENT-001 and @desktop and @native-gui and not @web",
  );
});

test("focused native package commands make no harness or package claim", async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const commands = new Map([
    [
      "test:story:req-refactorkit-java-import-002",
      "node scripts/run-native-desktop-story.mjs --profile refactorKitJavaImportNativeGui",
    ],
    [
      "test:story:req-layout-desktop-001:native",
      "node scripts/run-native-desktop-story.mjs --profile desktopLayoutNativeGui",
    ],
    [
      "test:story:req-pi-workspace-agent-001:native",
      "node scripts/run-native-desktop-story.mjs --profile piWorkspaceAgentNativeGui",
    ],
    [
      "test:story:req-xcom2-machine-settings-missing-steam-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2MachineSettingsMissingSteamNativeGui",
    ],
    [
      "test:story:req-xcom2-module-activation-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2ModuleActivationNativeGui",
    ],
    [
      "test:story:req-xcom2-module-configuration-activation-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2ModuleConfigurationActivationNativeGui",
    ],
    [
      "test:story:req-xcom2-module-configuration-diagnostics-001:native",
      "node scripts/run-native-desktop-story.mjs --profile xcom2ModuleConfigurationDiagnosticsNativeGui",
    ],
  ]);

  for (const [name, expected] of commands) {
    const command = manifest.scripts[name];
    assert.equal(command, expected);
    assert.doesNotMatch(command, /tauri-harness|package|bundle/);
  }
});

test("zero runnable selections are successful", () => {
  const result = evaluateDeclaredStoryRouting([]);

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedWeb, []);
  assert.deepEqual(result.expectedDesktopTauriHarness, []);
  assert.deepEqual(result.expectedDesktopTauriWebdriver, []);
  assert.deepEqual(result.unsupportedValidatedDesktop, []);
});

test("declared routing separates web, harness, and native GUI evidence while excluding parked statuses", () => {
  const web = scenario("validated web", ["@implemented-and-validated", "@web"]);
  const harness = scenario("desktop harness", ["@implemented-not-e2e-validated", "@desktop"]);
  const nativeGui = scenario("native desktop", [
    "@implemented-and-validated",
    "@desktop",
    "@native-gui",
  ]);
  const notImplemented = scenario("parked", ["@not-implemented", "@desktop", "@native-gui"]);
  const partial = scenario("partial", ["@partial", "@desktop", "@native-gui"]);

  const result = evaluateDeclaredStoryRouting([web, harness, nativeGui, notImplemented, partial]);

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedWeb.map(scenarioKey), [scenarioKey(web)]);
  assert.deepEqual(result.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(harness)]);
  assert.deepEqual(result.expectedDesktopTauriWebdriver.map(scenarioKey), [scenarioKey(nativeGui)]);
});

test("promoted XCOM Project Foundry routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("promoted XCOM Project Foundry Apply routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryApplyTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("promoted XCOM Project Foundry destination conflict routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryDestinationConflictTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("promoted XCOM Project Foundry verified cleanup routes only to deterministic harness evidence", () => {
  const [promoted] = selectedScenarios("xcom2ProjectFoundryVerifiedCleanupTauriHarness");

  const routing = evaluateDeclaredStoryRouting([promoted]);
  assert.deepEqual(routing.failures, []);
  assert.deepEqual(routing.expectedWeb, []);
  assert.deepEqual(routing.expectedDesktopTauriHarness.map(scenarioKey), [scenarioKey(promoted)]);
  assert.deepEqual(routing.expectedDesktopTauriWebdriver, []);
});

test("declared routes and partial versus non-implemented inventory stay exact", () => {
  const declared = selectedScenarios("declaredDiscovery");
  const validated = declared.filter(({ tags }) => tags.has("@implemented-and-validated"));
  const harnessOnly = declared.filter(({ tags }) => tags.has("@implemented-not-e2e-validated"));
  const partial = declared.filter(({ tags }) => tags.has("@partial"));
  const notImplemented = declared.filter(({ tags }) => tags.has("@not-implemented"));
  const web = selectedScenarios("implementedWeb");
  const harness = selectedScenarios("implementedDesktopTauriHarness");
  const nativeGui = selectedScenarios("implementedDesktopTauriWebdriver");
  const packaging = selectedScenarios("idePackagingTauriHarness");
  const routing = evaluateDeclaredStoryRouting(declared);
  const currentNativeRequirements = [
    "@REQ-DESKTOP-FILE-OPEN-001",
    "@REQ-DESKTOP-FILE-OPEN-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001",
    "@REQ-LAYOUT-DESKTOP-001",
    "@REQ-PI-WORKSPACE-AGENT-001",
    "@REQ-REFACTORKIT-JAVA-IMPORT-002",
    "@REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001",
    "@REQ-XCOM2-MODULE-ACTIVATION-001",
    "@REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001",
    "@REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001",
  ];

  assert.deepEqual(web.flatMap(requirementIds).sort(), [
    "@REQ-IDE-GIT-DIFF-REVIEW-001",
    "@REQ-IDE-GIT-DIFF-REVIEW-002",
    "@REQ-IDE-GIT-DIFF-REVIEW-003",
    "@REQ-IDE-GIT-DIFF-REVIEW-004",
    "@REQ-LAYOUT-WEB-001",
    "@REQ-WEB-001",
  ]);
  assert.deepEqual(harness.flatMap(requirementIds).sort(), [
    "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
    "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
    "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
    "@REQ-IDE-DOC-SYNTAX-SPLIT-001",
    "@REQ-REFACTORKIT-JAVA-IMPORT-001",
    "@REQ-REFACTORKIT-TS-001",
    "@REQ-REFACTORKIT-TS-002",
    "@REQ-XCOM2-MACHINE-SETTINGS-001",
    "@REQ-XCOM2-PROJECT-BUILD-RECIPE-001",
    "@REQ-XCOM2-PROJECT-FOUNDRY-001",
    "@REQ-XCOM2-PROJECT-FOUNDRY-002",
    "@REQ-XCOM2-PROJECT-FOUNDRY-003",
    "@REQ-XCOM2-PROJECT-FOUNDRY-004",
  ]);
  assert.deepEqual(nativeGui.flatMap(requirementIds).sort(), currentNativeRequirements);
  assert.deepEqual(packaging.flatMap(requirementIds).sort(), ["@REQ-IDE-PACKAGING-001"]);
  // Count expanded scenarios, including Examples rows, without duplicating requirement IDs.
  const partialRequirements = partial.flatMap(requirementIds).reduce(
    (counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1), new Map(),
  );
  assert.deepEqual(Object.fromEntries(partialRequirements), {
    "@REQ-IDE-EDITOR-CLOSE-GUARDS-001": 2,
    "@REQ-IDE-EDITOR-DISK-COMPARISON-001": 3,
    "@REQ-IDE-EDITOR-EXTERNAL-CHANGES-001": 1,
    "@REQ-IDE-EDITOR-RECOVERY-001": 9,
    "@REQ-IDE-GIT-SOURCE-CONTROL-001": 7,
    "@REQ-IDE-HTTP-CLIENT-001": 6,
    "@REQ-IDE-JAVA-BUILD-RUN-DEBUG-001": 6,
    "@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001": 19,
    "@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001": 1,
    "@REQ-IDE-JAVA-DATABASE-001": 6,
    "@REQ-IDE-JAVA-EXECUTION-NATIVE-001": 49,
    "@REQ-IDE-JAVA-FILE-OPERATIONS-NATIVE-001": 2,
    "@REQ-IDE-JAVA-LANGUAGE-001": 13,
    "@REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001": 9,
    "@REQ-IDE-JAVA-NAVIGATION-001": 5,
    "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001": 113,
    "@REQ-IDE-JAVA-PROJECT-MODEL-001": 6,
    "@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001": 98,
    "@REQ-IDE-STARTUP-RESPONSIVENESS-NATIVE-001": 1,
    "@REQ-IDE-WORKSPACE-TERMINAL-001": 1,
  });
  assert.deepEqual([...new Set(notImplemented.flatMap(requirementIds))].sort(), [
    "@REQ-IDE-KOTLIN-LANGUAGE-001",
    "@REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001",
    "@REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001",
  ]);
  assert.equal(declared.length, 409);
  assert.equal(validated.length, 23);
  assert.equal(harnessOnly.length, 13);
  assert.equal(partial.length, 357);
  assert.equal(notImplemented.length, 16);
  assert.equal(web.length, 6);
  assert.equal(harness.length, 13);
  assert.equal(nativeGui.length, 16);
  assert.equal(packaging.length, 1);
  assert.equal(
    web.length +
      harness.length +
      nativeGui.length +
      packaging.length +
      partial.length +
      notImplemented.length,
    declared.length,
  );
  assertAuthoredSelection("implementedWeb", 6, 33, web);
  assertAuthoredSelection("implementedDesktopTauriHarness", 13, 347, harness);
  assertAuthoredSelection("implementedDesktopTauriWebdriver", 16, 297, nativeGui);
  assertAuthoredSelection("idePackagingTauriHarness", 1, 13, packaging);
  assert.deepEqual(routing.failures, []);
  assert.equal(routing.expectedWeb.length, 6);
  assert.equal(routing.expectedDesktopTauriHarness.length, 13);
  assert.equal(routing.expectedDesktopTauriWebdriver.length, 16);
  assert.equal(routing.expectedIdePackagingTauriHarness.length, 1);
  assert.deepEqual(
    routing.expectedDesktopTauriWebdriver.flatMap(requirementIds).sort(),
    currentNativeRequirements,
  );
  assert.deepEqual(routing.expectedIdePackagingTauriHarness.flatMap(requirementIds).sort(), [
    "@REQ-IDE-PACKAGING-001",
  ]);
});

test("promoted desktop layout routes only to native GUI evidence", () => {
  const desktopLayout = scenario("desktop layout", [
    "@REQ-LAYOUT-DESKTOP-001",
    "@implemented-and-validated",
    "@desktop",
    "@native-gui",
  ]);

  const result = evaluateDeclaredStoryRouting([desktopLayout]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expectedDesktopTauriHarness, []);
  assert.deepEqual(result.expectedDesktopTauriWebdriver.map(scenarioKey), [
    scenarioKey(desktopLayout),
  ]);
});

test("missing and multiple statuses are rejected", () => {
  const result = evaluateDeclaredStoryRouting([
    scenario("missing status", ["@web"]),
    scenario("multiple statuses", ["@implemented-and-validated", "@partial", "@web"]),
  ]);

  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 missing status must declare exactly one Story status tag; received 0",
    "features/scaffolding.feature:1 multiple statuses must declare exactly one Story status tag; received 2",
  ]);
});

test("missing and multiple targets are rejected", () => {
  const result = evaluateDeclaredStoryRouting([
    scenario("missing target", ["@implemented-and-validated"]),
    scenario("multiple targets", ["@implemented-and-validated", "@web", "@desktop"]),
  ]);

  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 missing target must declare exactly one Story target tag; received 0",
    "features/scaffolding.feature:1 multiple targets must declare exactly one Story target tag; received 2",
  ]);
});

test("validated desktop is rejected unless it opts into native GUI E2E evidence", () => {
  const desktop = scenario("validated desktop", ["@implemented-and-validated", "@desktop"]);
  const result = evaluateDeclaredStoryRouting([desktop]);

  assert.deepEqual(result.unsupportedValidatedDesktop.map(scenarioKey), [scenarioKey(desktop)]);
  assert.deepEqual(result.failures, [
    "features/scaffolding.feature:1 validated desktop is @implemented-and-validated @desktop but does not declare @native-gui for desktop/tauri-webdriver evidence",
  ]);
});

test("implemented aggregate keeps web and harness routes and adds the bounded native and AppImage-packaging runners", async () => {
  const invocations = [];
  await runImplementedStoryAggregate({
    run: async (command, arguments_, options) => {
      invocations.push({ command, arguments_, options });
    },
  });

  assert.equal(invocations.length, 5);
  assert.ok(invocations[1].arguments_.includes("implementedWeb"));
  assert.ok(invocations[2].arguments_.includes("implementedDesktopTauriHarness"));
  assert.deepEqual(invocations[3].arguments_, [
    "scripts/run-native-desktop-story.mjs",
    "--profile",
    "implementedDesktopTauriWebdriver",
  ]);
  assert.ok(invocations[4].arguments_.includes("idePackagingTauriHarness"));
});

test("interrupting an aggregate profile command terminates its process", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "story-aggregate-cleanup-"));
  const pidPath = path.join(directory, "pid");
  const controller = new AbortController();
  let pid;

  let testFailure;
  try {
    const running = runProfileCommand(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { writeFileSync } from "node:fs"; process.on("SIGTERM", () => {}); writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`,
      ],
      { signal: controller.signal, stdio: "ignore", stopTimeoutMs: 25 },
    );

    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        pid = Number(await readFile(pidPath, "utf8"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(Number.isInteger(pid) && pid > 0, "the child process must publish its PID");

    controller.abort();
    await assert.rejects(running, /aborted/);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } catch (error) {
    testFailure = error;
  }

  const cleanupFailures = [];
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") cleanupFailures.push(error);
    }
  }
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupFailures.push(error);
  }

  const failures = testFailure ? [testFailure, ...cleanupFailures] : cleanupFailures;
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Story aggregate assertion and cleanup failures");
  }
});

test("Git source control has a focused native profile without promoting its wider workflow", () => {
  const profile="gitWorkspaceNativeGui";
  const selected=selectedScenarios(profile);
  assertAuthoredSelection(profile,5,27,selected);
  assert.ok(selected[0].tags.has("@REQ-IDE-GIT-SOURCE-CONTROL-001"));
  assert.ok(selected[0].tags.has("@partial"));
  assert.deepEqual(cucumberProfiles[profile].worldParameters,cucumberProfiles.desktopFileOpenNativeGui.worldParameters);
});

test("Java Maven branch changes have a focused native context and test-execution profile", () => {
  const profile = "javaProjectContextGitBranchNativeGui";
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 1, 7, selected);
  assert.ok(selected[0].tags.has("@native-java-git-branch-context"));
  assert.ok(selected[0].tags.has("@partial"));
});


test("Gradle branch qualification keeps evaluation explicit in its own native profile", () => {
  const profile = "javaGradleProjectContextGitBranchNativeGui";
  const selected = selectedScenarios(profile);
  assertAuthoredSelection(profile, 1, 8, selected);
  assert.ok(selected[0].tags.has("@native-gradle-git-branch-context"));
  assert.ok(selected[0].tags.has("@partial"));
});

test("Java rebase context profiles keep complete checks within the existing native deadline", () => {
  for (const [profile, steps] of [["javaProjectContextGitRebaseNativeGui",7],["javaGradleProjectContextGitRebaseNativeGui",8]]) {
    const selected=selectedScenarios(profile);assertAuthoredSelection(profile,1,steps,selected);
    assert.ok(selected[0].tags.has("@partial"));assert.ok(selected[0].tags.has("@native-java-git-rebase-context"));
    assert.deepEqual(cucumberProfiles[profile].worldParameters,cucumberProfiles.desktopFileOpenNativeGui.worldParameters);
  }
});
