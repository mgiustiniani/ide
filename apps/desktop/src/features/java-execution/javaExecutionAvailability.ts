import { isConcreteJavaTestFilter, isJavaTestDebugOperation } from "@ide/contracts";
import type { JavaExecutionOperation } from "@ide/contracts";
import type { JavaExecutionController } from "./useJavaExecutionController";

export type JavaExecutionAvailabilityState = Pick<
  JavaExecutionController,
  | "snapshot"
  | "configuration"
  | "capabilities"
  | "running"
  | "trusted"
  | "pending"
  | "projectContext"
  | "canRestart"
  | "classReloadPending"
>;

/** Shared presentation checks; native execution still validates current authority. */
export function javaExecutionAvailability(controller: JavaExecutionAvailabilityState) {
  const { configuration, capabilities, running } = controller;
  const projectMode = Boolean(configuration.projectModule);
  const selectedModuleMatches = projectMode
    ? (controller.projectContext?.context?.modules.filter(
        (module) =>
          module.id === configuration.projectModule?.moduleId &&
          (!configuration.projectModule.providerId ||
            module.providerId === configuration.projectModule.providerId),
      ) ?? [])
    : [];
  const ambiguousLegacySelection =
    projectMode && !configuration.projectModule?.providerId && selectedModuleMatches.length > 1;
  const selectedProjectModule =
    selectedModuleMatches.length === 1 ? selectedModuleMatches[0] : undefined;
  const selectedSourceSetMatches = selectedProjectModule
    ? selectedProjectModule.sourceSets.filter(
        (sourceSet) => sourceSet.id === configuration.projectModule?.sourceSetId,
      )
    : [];
  const selectedProjectSourceSet =
    selectedSourceSetMatches.length === 1 ? selectedSourceSetMatches[0] : undefined;
  const unavailableProjectSelection =
    projectMode && (!selectedProjectModule || !selectedProjectSourceSet);
  const providerBuildTool =
    selectedProjectModule?.providerId === "java-declared-v1"
      ? "jdk"
      : selectedProjectModule?.providerId === "maven-effective-v1"
      ? "maven"
      : selectedProjectModule?.providerId === "gradle-effective-v1"
        ? "gradle"
        : undefined;
  const buildTool = projectMode
    ? (providerBuildTool ??
      (configuration.buildTool === "auto" ? capabilities?.projectKind : configuration.buildTool))
    : configuration.buildTool === "auto"
      ? capabilities?.projectKind
      : configuration.buildTool;
  const standardMainSourceSet =
    selectedProjectSourceSet?.kind === "main" &&
    (selectedProjectSourceSet.id === "main" || selectedProjectModule?.providerId === "java-declared-v1");
  const standardTestSourceSet =
    selectedProjectSourceSet?.kind === "test" &&
    (selectedProjectSourceSet.id === "test" || selectedProjectModule?.providerId === "java-declared-v1");
  const customGradleSourceSet =
    projectMode &&
    !!selectedProjectSourceSet &&
    !standardMainSourceSet &&
    !standardTestSourceSet &&
    (buildTool === "gradle" || selectedProjectModule?.providerId.startsWith("gradle-") === true);
  const mavenIntegrationSourceSet =
    projectMode &&
    selectedProjectSourceSet?.kind === "integration-test" &&
    (buildTool === "maven" || selectedProjectModule?.providerId.startsWith("maven-") === true);
  const mavenFailsafeFact = selectedProjectSourceSet?.mavenFailsafe;
  const mavenFailsafeMetadataBlocked =
    mavenIntegrationSourceSet &&
    (controller.projectContext?.context?.schemaVersion === "java-project-context-v4" ||
      controller.projectContext?.context?.schemaVersion === "java-project-context-v5" ||
      controller.projectContext?.context?.schemaVersion === "java-project-context-v6" ||
      controller.projectContext?.context?.schemaVersion === "java-project-context-v7") &&
    (mavenFailsafeFact?.availability !== "complete" ||
      mavenFailsafeFact.executions.length !== 1 ||
      mavenFailsafeFact.executions[0]?.availability !== "complete");
  const unsupportedProjectSourceSet =
    projectMode &&
    !!selectedProjectSourceSet &&
    !standardMainSourceSet &&
    !standardTestSourceSet &&
    !customGradleSourceSet &&
    !mavenIntegrationSourceSet;
  const toolsAvailable =
    capabilities?.jdk &&
    (buildTool === "jdk" ||
      (buildTool === "maven" && capabilities.maven) ||
      (buildTool === "gradle" && capabilities.gradle));

  const canStart = (operation: JavaExecutionOperation, profile = false): boolean => {
    if (profile)
      return (
        operation === "run" &&
        Boolean(
          controller.trusted &&
          toolsAvailable &&
          capabilities?.flightRecorder === true &&
          (!projectMode || standardMainSourceSet) &&
          !running &&
          !controller.pending,
        )
      );
    if (
      ![
        "clean",
        "rebuild",
        "build",
        "run",
        "test",
        "integration-test",
        "debug-test",
        "debug-integration-test",
        "integration-coverage",
        "coverage",
        "discover",
        "debug",
      ].includes(operation)
    )
      return false;
    return Boolean(
      controller.trusted &&
      toolsAvailable &&
      (operation !== "clean" || (capabilities?.cleanProject === true && buildTool !== "jdk")) &&
      (operation !== "rebuild" || (capabilities?.rebuildProject === true && buildTool !== "jdk")) &&
      !unavailableProjectSelection &&
      !running &&
      !controller.pending &&
      (!isJavaTestDebugOperation(operation) || (
        capabilities?.debugTests === true &&
        (operation !== "debug-integration-test" || capabilities?.debugIntegrationTests === true) &&
        isConcreteJavaTestFilter(configuration.testFilter)
      )) &&
      (!["integration-test", "integration-coverage", "debug-integration-test"].includes(operation) ||
        buildTool === "maven") &&
      (operation !== "coverage" || buildTool !== "jdk") &&
      (!mavenIntegrationSourceSet ||
        ["clean", "integration-test", "integration-coverage", "debug-integration-test"].includes(operation)) &&
      (!mavenFailsafeMetadataBlocked ||
        !["integration-test", "integration-coverage", "debug-integration-test"].includes(operation)) &&
      (operation === "clean" || !unsupportedProjectSourceSet) &&
      (operation !== "debug" ||
        (configuration.debuggerMode === "jdi"
          ? capabilities?.structuredDebugger
          : capabilities?.debugger)),
    );
  };
  return {
    projectMode,
    selectedProjectModule,
    selectedProjectSourceSet,
    ambiguousLegacySelection,
    unavailableProjectSelection,
    buildTool,
    standardMainSourceSet,
    standardTestSourceSet,
    customGradleSourceSet,
    mavenIntegrationSourceSet,
    mavenFailsafeMetadataBlocked,
    unsupportedProjectSourceSet,
    canStart,
    canAttach: Boolean(
      controller.trusted &&
      configuration.debuggerMode === "jdi" &&
      !projectMode &&
      capabilities?.attachDebugger &&
      !running &&
      !controller.pending,
    ),
    canRerunFailed: Boolean(
      controller.trusted &&
      !running &&
      !controller.pending &&
      controller.snapshot?.testResults?.canRerunFailed,
    ),
    canDebugFailed: Boolean(
      controller.trusted && !running && !controller.pending &&
      controller.snapshot?.testResults?.canRerunFailed &&
      controller.snapshot?.canDebugFailedTests === true,
    ),
    canStop: running,
    canRestart: Boolean(
      controller.canRestart &&
      controller.trusted &&
      !controller.pending &&
      !controller.classReloadPending,
    ),
  };
}
