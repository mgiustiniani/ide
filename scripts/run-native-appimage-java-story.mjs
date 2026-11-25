#!/usr/bin/env node

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  buildNativeDesktopApplication,
  reuseNativeAppImage,
  runNativeDesktopStory,
  waylandAppImageProfiles,
  withNativeDesktopCancellation,
} from "./run-native-desktop-story.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { version } = JSON.parse(
  readFileSync(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const applicationPath = path.join(
  repositoryRoot,
  `apps/desktop/src-tauri/target/release/bundle/appimage/IDE_${version}_amd64.AppImage`,
);
const { values } = parseArgs({
  options: {
    wayland: { type: "boolean", default: false },
    profile: { type: "string" },
    "reuse-appimage": { type: "string" },
  },
});
const { wayland } = values;
const defaultProfile = wayland
  ? "javaCursorNavigationAppImageNativeGui"
  : "javaLanguageIntelligenceAppImageNativeGui";
const profile = values.profile ?? defaultProfile;
const manifestPath = values["reuse-appimage"];
const executionTimeouts = new Map([
  ["java8MavenRunAppImageNativeGui", 90_000],
  ["javaPlainJdkTestNgAppImageNativeGui", 120_000],
  ["javaDebuggerAppImageNativeGui", 180_000],
  ["javaJdiDebuggerAppImageNativeGui", 420_000],
  ["javaConditionalDebuggerAppImageNativeGui", 360_000],
  ["javaFlightRecorderAppImageNativeGui", 420_000],
  ["javaLanguageIntelligenceAppImageNativeGui", 180_000],
  ["javaCursorNavigationAppImageNativeGui", 240_000],
  ["javaApplicationInputAppImageNativeGui", 240_000],
  ["javaCompilerAndSourceCreationAppImageNativeGui", 600_000],
  ["javaGradleCompositeExecutionAppImageNativeGui", 780_000],
  ["javaMixedJvmAppImageNativeGui", 360_000],
  ["javaGradleKotlinDefinitionAppImageNativeGui", 240_000],
  ["javaProjectModelClassRefactoringAppImageNativeGui", 540_000],
  ["javaProjectModelPackageMoveAppImageNativeGui", 480_000],
  ["javaGradleCrossModuleClassMoveAppImageNativeGui", 360_000],
  ["javaProjectModelSourceRootRefactoringAppImageNativeGui", 360_000],
  ["javaReferenceDevelopmentAppImageNativeGui", 660_000],
  ["javaReferenceBackendAppImageNativeGui", 480_000],
  ["javaSpringBootStarterAppImageNativeGui", 420_000],
  ["javaSpringBootGradleStarterAppImageNativeGui", 1_080_000],
  ["javaProjectExecutionAndDebuggerAppImageNativeGui", 660_000],
  ["javaProjectDebuggerAppImageNativeGui", 660_000],
  ["javaGradleClassMoveRecoveryAppImageNativeGui", 360_000],
  ["javaGradleDiagnosticsAppImageNativeGui", 240_000],
  ["javaMavenPreparationAppImageNativeGui", 240_000],
  ["javaProjectCoverageAppImageNativeGui", 660_000],
  ["javaProjectTestWorkflowsAppImageNativeGui", 1_080_000],
  ["javaMavenProjectTestScopeAppImageNativeGui", 300_000],
  ["javaMavenAggregatorDiscoveryAppImageNativeGui", 300_000],
  ["javaProjectWorkingDirectoryAppImageNativeGui", 660_000],
  ["javaDraftRefactoringAppImageNativeGui", 900_000],
  ["javaGradleDraftRecoveryAppImageNativeGui", 660_000],
  ["javaMethodRefactoringAppImageNativeGui", 1_080_000],
  ["javaExtractExpressionAppImageNativeGui", 540_000],
  ["javaInlineRefactoringsAppImageNativeGui", 540_000],
  ["javaLargePackageAppImageNativeGui", 150_000],
  ["javaCleanupAppImageNativeGui", 660_000],
  ["javaBatchFormatterProfileAppImageNativeGui", 660_000],
  ["javaInlineMethodUpgradeAppImageNativeGui", 360_000],
  ["javaParameterObjectAppImageNativeGui", 240_000],
  ["javaFunctionalReferencesAppImageNativeGui", 420_000],
  ["javaExtractDelegateAppImageNativeGui", 660_000],
  ["javaParameterTypeAppImageNativeGui", 240_000],
  ["javaModuleCreationAppImageNativeGui", 780_000],
  ["javaModuleRenameAppImageNativeGui", 1_320_000],
  ["javaGradleModuleRenameInboundAppImageNativeGui", 960_000],
  ["javaGradleApplicationModuleRenameAppImageNativeGui", 660_000],
  ["javaConstructorRefactoringAppImageNativeGui", 1_080_000],
  ["javaFieldTypeAppImageNativeGui", 360_000],
  ["javaMemberRefactoringAppImageNativeGui", 900_000],
  ["javaJpqlReviewAppImageNativeGui", 240_000],
  ["javaJpqlOpaqueResourceAppImageNativeGui", 240_000],
  ["javaJpqlManagedAppImageNativeGui", 420_000],
  ["javaJpqlNamedQueryAppImageNativeGui", 420_000],
  ["javaGradleExtractMethodAppImageNativeGui", 480_000],
  ["javaCoverageAppImageNativeGui", 900_000],
  ["java26ProjectContextAppImageNativeGui", 660_000],
  ["java26EditorDiagnosticsAppImageNativeGui", 540_000],
  ["java26ScaffoldWrapperBuildAppImageNativeGui", 1_320_000],
  ["java27ScaffoldWrapperBuildAppImageNativeGui", 1_510_000],
  ["java27ProjectContextAppImageNativeGui", 720_000],
  ["javaFailsafeReactorAppImageNativeGui", 300_000],
  ["javaMavenFailsafeContextAppImageNativeGui", 360_000],
  ["javaMavenTestJvmSelectionAppImageNativeGui", 360_000],
  ["javaSelectedTestDebuggerAppImageNativeGui", 360_000],
  ["javaFailedTestDebuggerAppImageNativeGui", 360_000],
  ["javaMavenFailedTestDebuggerAppImageNativeGui", 300_000],
]);
if (!executionTimeouts.has(profile))
  throw new Error("Choose a supported Java AppImage profile with --profile.");
if (wayland && !waylandAppImageProfiles.has(profile))
  throw new Error("Choose a Java AppImage profile with Wayland support.");

await withNativeDesktopCancellation((signal) => runNativeDesktopStory(profile, {
  applicationPath,
  signal,
  artifactKind: "appimage",
  displayBackend: wayland ? "wayland" : "x11",
  buildTimeoutMs: 15 * 60 * 1000,
  executionTimeoutMs: executionTimeouts.get(profile),
  buildApplication: (options) => manifestPath !== undefined ? reuseNativeAppImage(manifestPath) :
    buildNativeDesktopApplication({
      ...options,
      applicationPath,
      timeoutMs: 15 * 60 * 1000,
      buildCommand: {
        command: "pnpm",
        arguments: [
          "--filter",
          "@ide/desktop",
          "tauri",
          "build",
          "--verbose",
          "--bundles",
          "appimage",
          "--ci",
        ],
      },
    }),
}));
