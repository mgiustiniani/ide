import { parseJavaStepFilters } from "./javaStepFilters";
import { useJavaEntryPointDiscovery } from "./useJavaEntryPointDiscovery";
import { isConcreteJavaTestFilter, isJavaDebuggingOperation, isJavaRepeatableExecutionOperation, isJavaTestDebugOperation } from "@ide/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  JavaExecutionCapabilities,
  JavaClassReloadBuildResult,
  JavaDebuggerAction,
  JavaClassReloadRequest,
  JavaExecutionContext,
  JavaExecutionOperation,
  JavaExecutionSnapshot,
  JavaFlightRecordingTimeline,
  JavaFlightRecordingSummary,
  JavaLaunchConfiguration,
  JavaEffectiveProjectContext,
  JavaProjectContextSettings,
} from "@ide/contracts";
import { captureJavaProjectOperationContext, isJavaGradleSettings, sameJavaProjectContextSettings } from "@ide/contracts";
import type { JavaExecutionPort } from "@ide/web-core/ports";
import { validateLaunchSettings } from "./validateJavaLaunchSettings";
import { useJavaApplicationInput } from "./useJavaApplicationInput";
import { useJavaCoverageHistory } from "./useJavaCoverageHistory";
import { checkCoverageThresholds, coverageThresholdError, emptyCoverageThresholds, type JavaCoverageThresholdSettings } from "./javaCoverageThresholds";
import {
  defaultJavaConfigurations,
  isJavaConfigurationCollection,
  javaConfigurationsStorageKey,
  loadJavaConfigurations,
  MAX_JAVA_CONFIGURATIONS,
  MAX_JAVA_CONFIGURATION_STORAGE_BYTES,
  nextJavaConfigurationIdentity,
  validateJavaConfigurationName,
  type JavaConfigurationCollection,
} from "./javaLaunchConfigurations";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The Java operation failed.";
}
function canRestartSession({ operation, state }: JavaExecutionSnapshot): boolean {
  return isJavaRepeatableExecutionOperation(operation) &&
    (operation === "run" || operation === "debug" || isJavaTestDebugOperation(operation) ||
      state === "succeeded" || state === "failed");
}
function isCoverageOperation(operation: JavaExecutionOperation): boolean {
  return operation === "coverage" || operation === "integration-coverage";
}
type CoverageSourceCapture = {
  filePaths: readonly string[];
  verify(): void;
  isDocumentCurrent(filePath: string): boolean;
};
export function useJavaExecutionController({
  port,
  workspaceId,
  generation,
  enabled,
  prepare,
  getSourceBreakpoints,
  projectContext,
  entryPointPort,
  sourceExecutionEnabled = false,
  reviewSavedBuffers,
  captureCoverageSources,
}: {
  port: JavaExecutionPort;
  workspaceId: string | null;
  generation: number;
  enabled: boolean;
  prepare(operation?: JavaExecutionOperation): Promise<void>;
  getSourceBreakpoints?(): import("@ide/contracts").JavaSavedSourceBreakpoint[];
  sourceExecutionEnabled?: boolean;
  entryPointPort?: import("@ide/web-core/ports").JavaEntryPointPort;
  reviewSavedBuffers?(options?: { allowNewBuffers?: boolean }): () => void;
  captureCoverageSources?(): CoverageSourceCapture;
  projectContext?: {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
    getSettings(): JavaProjectContextSettings;
    refresh(
      expected: JavaProjectContextSettings,
      selection?: {
        providerId?: string;
        moduleId: string;
        sourceSetId?: string;
        sourceSetKind?: import("@ide/contracts").JavaProjectSourceSetKind;
      },
      options?: {
        afterSavedBufferReview?: true;
        requiredFacts?: import("@ide/contracts").JavaProjectContextRequest["requiredFacts"];
      },
    ): Promise<JavaEffectiveProjectContext>;
    retire?(): void;
    pauseMonitoring?(): Promise<void>;
  };
}) {
  const [collection, setCollection] = useState(defaultJavaConfigurations);
  const configurations = useRef(collection);
  const configurationOwner = useRef({ workspaceId, generation });
  const selectedConfiguration = collection.configurations.find(
    (item) => item.id === collection.selectedId,
  )!;
  const configuration = selectedConfiguration.configuration;
  const [trusted, setTrustedState] = useState(false);
  const currentTrusted = useRef(trusted);
  currentTrusted.current = trusted;
  const setTrusted = useCallback((value: boolean) => {
    currentTrusted.current = value;
    setTrustedState(value);
  }, []);
  const [capabilities, setCapabilities] = useState<JavaExecutionCapabilities | null>(null);
  const [restartSupported, setRestartSupported] = useState(false);
  const restartAvailable = useRef(false);
  const [snapshot, setSnapshot] = useState<JavaExecutionSnapshot | null>(null);
  const applicationInput = useJavaApplicationInput({ port, workspaceId, generation, enabled, trusted, snapshot });
  const [flightRecordingSummary, setFlightRecordingSummary] =
    useState<JavaFlightRecordingSummary | null>(null);
  const [flightRecordingAnalysisPending, setFlightRecordingAnalysisPending] = useState(false);
  const [flightRecordingTimeline, setFlightRecordingTimeline] =
    useState<JavaFlightRecordingTimeline | null>(null);
  const [flightRecordingTimelinePending, setFlightRecordingTimelinePending] = useState(false);
  const [coverageProjectContext, setCoverageProjectContext] = useState<{
    workspaceId: string;
    generation: number;
    sessionId: string;
    sourceFilesCurrent: boolean;
    sourcePaths: readonly string[];
    isDocumentCurrent?(filePath: string): boolean;
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext;
  } | null>(null);
  const [executionProjectContext, setExecutionProjectContext] = useState<{
    workspaceId: string;
    generation: number;
    sessionId: string;
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext;
  } | null>(null);
  const retainedLaunchContext = useRef<typeof executionProjectContext>(null);
  const coverageSourceReview = useRef<{
    sessionId: string;
    verify(): void;
  } | null>(null);
  const [sessionConfigurationName, setSessionConfigurationName] = useState<string | null>(null);
  const coverageThresholdSession = useRef<{ sessionId: string; settings: JavaCoverageThresholdSettings } | null>(null);
  const coverageHistory = useJavaCoverageHistory(
    workspaceId,
    generation,
    snapshot,
    sessionConfigurationName,
  );
  const [stepFilterText, setStepFilterTextState] = useState("");
  const stepFilterDraft = useRef("");
  const stepFilterSessionId = snapshot?.sessionId;
  const setStepFilterText = useCallback((text: string) => {
    if (current.current.workspaceId !== workspaceId || current.current.generation !== generation ||
      !stepFilterSessionId || activeSession.current !== stepFilterSessionId ||
      currentSnapshot.current?.sessionId !== stepFilterSessionId || currentSnapshot.current.state !== "running") return;
    stepFilterDraft.current = text;
    setStepFilterTextState(text);
  }, [workspaceId, generation, stepFilterSessionId]);
  useEffect(() => {
    stepFilterDraft.current = "";
    setStepFilterTextState("");
  }, [workspaceId, generation, stepFilterSessionId]);
  const [error, setError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [classReloadPending, setClassReloadPending] = useState(false);
  const [classReloadBuild, setClassReloadBuild] = useState<JavaClassReloadBuildResult | null>(null);
  const preparingClassReload = useRef(false);
  const restartAttempt = useRef(0);
  const current = useRef({
    workspaceId,
    generation,
    prepare,
    port,
    getSourceBreakpoints,
    projectContext,
    reviewSavedBuffers,
    captureCoverageSources,
  });
  current.current = {
    workspaceId,
    generation,
    prepare,
    port,
    getSourceBreakpoints,
    projectContext,
    reviewSavedBuffers,
    captureCoverageSources,
  };
  const starting = useRef(false);
  const epoch = useRef(0);
  const activeSession = useRef<string | null>(null);
  const currentSnapshot = useRef(snapshot);
  const pendingFlightRecordingSession = useRef<string | null>(null);
  const pendingFlightRecordingTimelineSession = useRef<string | null>(null);
  const currentCapabilities = useRef(capabilities);
  currentCapabilities.current = capabilities;
  const projectPath =
    (configuration.projectModule
      ? projectContext?.settings.projectPath
      : configuration.projectPath) ?? "";
  const jdkHome = configuration.projectModule
    ? projectContext?.settings.sdkHome
    : configuration.jdkHome;
  const matches = useCallback(
    (context: JavaExecutionContext) =>
      current.current.workspaceId === context.workspaceId &&
      current.current.generation === context.generation,
    [],
  );

  useEffect(() => {
    preparingClassReload.current = false;
    setClassReloadPending(false);
    epoch.current += 1;
    activeSession.current = null;
    currentSnapshot.current = null;
    pendingFlightRecordingSession.current = null;
    pendingFlightRecordingTimelineSession.current = null;
    starting.current = false;
    coverageSourceReview.current = null;
    coverageThresholdSession.current = null;
    const restored = workspaceId
      ? loadJavaConfigurations(workspaceId)
      : defaultJavaConfigurations();
    configurations.current = restored;
    configurationOwner.current = { workspaceId, generation };
    setCollection(restored);
    setTrusted(false);
    setSnapshot(null);
    setFlightRecordingSummary(null);
    setFlightRecordingAnalysisPending(false);
    setFlightRecordingTimeline(null);
    setFlightRecordingTimelinePending(false);
    setCoverageProjectContext(null);
    setExecutionProjectContext(null);
    retainedLaunchContext.current = null;
    restartAvailable.current = false;
    setRestartSupported(false);
    setClassReloadBuild(null);
    setSessionConfigurationName(null);
    setCapabilities(null);
    setError(null);
    setConfigurationError(null);
    setPending(false);
    return () => {
      epoch.current += 1;
      activeSession.current = null;
      configurationOwner.current = { workspaceId: null, generation };
    };
  }, [workspaceId, generation, port]);

  const gradleExecutable = configuration.projectModule ? projectContext?.settings.gradle?.executable || undefined : undefined;
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let cancelled = false;
    const context = {
      workspaceId,
      generation,
      projectPath,
      ...(jdkHome === undefined ? {} : { jdkHome }),
      ...(gradleExecutable === undefined ? {} : { gradleExecutable }),
    };
    setCapabilities(null);
    setError(null);
    void port
      .getCapabilities(context)
      .then((value) => {
        if (!cancelled && matches(context)) {
          setCapabilities(value);
          restartAvailable.current = value.restartExecution === true;
          setRestartSupported(restartAvailable.current);
        }
      })
      .catch((cause) => {
        if (!cancelled && matches(context)) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [port, workspaceId, generation, projectPath, jdkHome, gradleExecutable, enabled, matches]);

  useEffect(() => {
    if (!snapshot || !["starting", "running"].includes(snapshot.state)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const context = {
      workspaceId: snapshot.workspaceId,
      generation: snapshot.generation,
      sessionId: snapshot.sessionId,
    };
    const poll = async () => {
      try {
        const value = await port.snapshot(context);
        if (
          !cancelled &&
          matches(context) &&
          activeSession.current === context.sessionId &&
          value.sessionId === context.sessionId
        ) {
          currentSnapshot.current = value;
          setSnapshot(value);
          if (!["starting", "running"].includes(value.state))
            setExecutionProjectContext((current) =>
              current?.sessionId === value.sessionId ? null : current,
            );
          if (
            !["starting", "running"].includes(value.state) &&
            coverageSourceReview.current?.sessionId === value.sessionId
          ) {
            let sourceFilesCurrent = true;
            try {
              coverageSourceReview.current.verify();
            } catch {
              sourceFilesCurrent = false;
            }
            coverageSourceReview.current = null;
            setCoverageProjectContext((current) =>
              current?.sessionId === value.sessionId ? { ...current, sourceFilesCurrent } : current,
            );
          }
          if (["starting", "running"].includes(value.state))
            timer = setTimeout(() => void poll(), 250);
        }
      } catch (cause) {
        if (!cancelled && matches(context) && activeSession.current === context.sessionId)
          setError(message(cause));
      }
    };
    timer = setTimeout(() => void poll(), 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [port, snapshot, matches]);

  const changeConfigurations = useCallback(
    (change: (value: JavaConfigurationCollection) => JavaConfigurationCollection) => {
      const id = current.current.workspaceId;
      if (
        !id ||
        id !== workspaceId ||
        current.current.generation !== generation ||
        configurationOwner.current.workspaceId !== id ||
        configurationOwner.current.generation !== current.current.generation ||
        starting.current ||
        (currentSnapshot.current && ["starting", "running"].includes(currentSnapshot.current.state))
      )
        return;
      try {
        const next = change(configurations.current);
        if (next === configurations.current) return;
        if (!isJavaConfigurationCollection(next))
          throw new Error("Invalid or oversized Java configuration settings.");
        const serialized = JSON.stringify(next);
        if (new TextEncoder().encode(serialized).length > MAX_JAVA_CONFIGURATION_STORAGE_BYTES)
          throw new Error("Saved Java configurations exceed the 2 MiB limit.");
        configurations.current = next;
        setCollection(next);
        setError(null);
        setConfigurationError(null);
        try {
          localStorage.setItem(javaConfigurationsStorageKey(id), serialized);
        } catch {
          setConfigurationError(
            "Configuration changes could not be saved. They remain available until this workspace is closed.",
          );
        }
      } catch (cause) {
        setConfigurationError(message(cause));
      }
    },
    [workspaceId, generation],
  );
  const updateConfiguration = useCallback(
    (value: JavaLaunchConfiguration) => {
      changeConfigurations((previous) => ({
        ...previous,
        configurations: previous.configurations.map((item) =>
          item.id === previous.selectedId ? { ...item, configuration: value } : item,
        ),
      }));
    },
    [changeConfigurations],
  );
  const selectConfiguration = useCallback(
    (id: string) => {
      changeConfigurations((previous) => {
        if (!previous.configurations.some((item) => item.id === id))
          throw new Error("The selected Java configuration no longer exists.");
        return { ...previous, selectedId: id };
      });
    },
    [changeConfigurations],
  );
  const updateCoverageThresholds = useCallback((settings: JavaCoverageThresholdSettings) => {
    changeConfigurations((previous) => ({ ...previous,
      configurations: previous.configurations.map((item) => item.id === previous.selectedId
        ? { ...item, coverageThresholds: { ...settings } } : item),
    }));
  }, [changeConfigurations]);
  const createConfiguration = useCallback(
    (duplicate = false) => {
      changeConfigurations((previous) => {
        if (previous.configurations.length >= MAX_JAVA_CONFIGURATIONS)
          throw new Error(
            `A workspace supports at most ${MAX_JAVA_CONFIGURATIONS} Java configurations.`,
          );
        const identity = nextJavaConfigurationIdentity(previous);
        const selected = previous.configurations.find((item) => item.id === previous.selectedId)!;
        const configuration = duplicate
          ? structuredClone(selected.configuration)
          : defaultJavaConfigurations().configurations[0].configuration;
        return {
          ...previous,
          selectedId: identity.id,
          configurations: [...previous.configurations, { ...identity, configuration,
            ...(duplicate && selected.coverageThresholds ? { coverageThresholds: structuredClone(selected.coverageThresholds) } : {}),
          }],
        };
      });
    },
    [changeConfigurations],
  );
  const renameConfiguration = useCallback(
    (name: string) => {
      changeConfigurations((previous) => {
        const invalid = validateJavaConfigurationName(name);
        if (invalid) throw new Error(invalid);
        const trimmed = name.trim();
        if (
          previous.configurations.some(
            (item) =>
              item.id !== previous.selectedId && item.name.toLowerCase() === trimmed.toLowerCase(),
          )
        )
          throw new Error("Java configuration names must be unique in this workspace.");
        return {
          ...previous,
          configurations: previous.configurations.map((item) =>
            item.id === previous.selectedId ? { ...item, name: trimmed } : item,
          ),
        };
      });
    },
    [changeConfigurations],
  );
  const deleteConfiguration = useCallback(() => {
    changeConfigurations((previous) => {
      if (previous.configurations.length === 1)
        throw new Error("Keep at least one Java configuration.");
      const index = previous.configurations.findIndex((item) => item.id === previous.selectedId);
      const remaining = previous.configurations.filter((item) => item.id !== previous.selectedId);
      return {
        ...previous,
        selectedId: remaining[Math.max(0, index - 1)].id,
        configurations: remaining,
      };
    });
  }, [changeConfigurations]);
  const start = useCallback(
    async (operation: JavaExecutionOperation, profile = false) => {
      const id = current.current.workspaceId;
      if (
        !id ||
        id !== workspaceId ||
        current.current.generation !== generation ||
        current.current.port !== port ||
        configurationOwner.current.workspaceId !== id ||
        configurationOwner.current.generation !== generation ||
        starting.current
      )
        return;
      const context = { workspaceId: id, generation: current.current.generation };
      const startedEpoch = epoch.current;
      starting.current = true;
      setPending(true);
      setError(null);
      pendingFlightRecordingSession.current = null;
      pendingFlightRecordingTimelineSession.current = null;
      setFlightRecordingAnalysisPending(false);
      setFlightRecordingSummary(null);
      setFlightRecordingTimeline(null);
      setFlightRecordingTimelinePending(false);
      setExecutionProjectContext(null);
      const selected = configurations.current.configurations.find(
        (item) => item.id === configurations.current.selectedId,
      )!;
      const preparationTool = operation === "prepare-gradle" ? "gradle" :
        operation === "prepare-maven" ? "maven" : undefined;
      const project = current.current.projectContext;
      const preparationSettings = preparationTool && project
        ? structuredClone(project.getSettings())
        : undefined;
      const gradlePreparation = preparationTool === "gradle" ? preparationSettings?.gradle : undefined;
      const mavenPreparation = preparationTool === "maven" && preparationSettings ? {
        mavenRepository: preparationSettings.mavenRepository,
        activeMavenProfiles: preparationSettings.activeMavenProfiles,
        inactiveMavenProfiles: preparationSettings.inactiveMavenProfiles,
      } : undefined;
      const launchConfiguration: JavaLaunchConfiguration = preparationTool
        ? {
            buildTool: preparationTool,
            mainClass: "",
            classPath: [],
            projectPath: preparationSettings?.projectPath,
            jdkHome: preparationSettings?.sdkHome,
          }
        : structuredClone(selected.configuration);
      if (isJavaTestDebugOperation(operation)) launchConfiguration.debuggerMode = "jdi";
      const thresholds = structuredClone(selected.coverageThresholds ?? emptyCoverageThresholds);
      const selectedProject = launchConfiguration.projectModule;
      const projectSettings =
        selectedProject && current.current.projectContext
          ? structuredClone(current.current.projectContext.getSettings())
          : undefined;
      let retainedProjectContext: JavaEffectiveProjectContext | null = null;
      let launchProjectContext: JavaEffectiveProjectContext | null = null;
      let sourceCapture: ReturnType<NonNullable<typeof captureCoverageSources>> | undefined;
      try {
        if (!currentTrusted.current)
          throw new Error("Confirm workspace trust before executing Java code or build plugins.");
        if (preparationTool && !preparationSettings?.sdkHome)
          throw new Error("Select the project JDK in Java Project.");
        if (preparationTool === "gradle" && !isJavaGradleSettings(gradlePreparation))
          throw new Error("Select the project JDK and configure Gradle in Java Project.");
        const verifyPreparation = preparationTool ? current.current.reviewSavedBuffers?.() : undefined;
        if (preparationTool && !verifyPreparation)
          throw new Error("Saved workspace review is unavailable.");
        const settingsError = validateLaunchSettings(launchConfiguration, false, operation);
        if (settingsError) throw new Error(settingsError);
        if (launchConfiguration.applicationInput === true && ["run", "debug"].includes(operation) &&
            (currentCapabilities.current?.applicationInput !== true || typeof port.sendApplicationInput !== "function"))
          throw new Error("This runtime does not advertise application input for the selected JDK.");
        if (["coverage", "integration-coverage"].includes(operation)) {
          const invalid = coverageThresholdError(thresholds);
          if (invalid) throw new Error(invalid);
        }
        if (
          profile &&
          (operation !== "run" || currentCapabilities.current?.flightRecorder !== true)
        )
          throw new Error("The selected JDK does not advertise Java Flight Recorder support.");
        if (operation === "clean" && currentCapabilities.current?.cleanProject !== true)
          throw new Error("This runtime does not advertise Maven or Gradle output cleanup.");
        if (operation === "clean" && !selectedProject &&
            (launchConfiguration.buildTool === "auto" ? currentCapabilities.current?.projectKind : launchConfiguration.buildTool) === "jdk")
          throw new Error("Clean requires a Maven or Gradle project.");
        if (operation === "rebuild" && currentCapabilities.current?.rebuildProject !== true)
          throw new Error("This runtime does not advertise Maven or Gradle rebuild.");
        if (operation === "rebuild" && !selectedProject &&
            (launchConfiguration.buildTool === "auto" ? currentCapabilities.current?.projectKind : launchConfiguration.buildTool) === "jdk")
          throw new Error("Rebuild requires a Maven or Gradle project.");
        if (operation === "attach" && currentCapabilities.current?.attachDebugger !== true)
          throw new Error("This provider does not advertise JDI socket attachment.");
        if (isJavaTestDebugOperation(operation) && (currentCapabilities.current?.debugTests !== true || (operation === "debug-integration-test" && currentCapabilities.current?.debugIntegrationTests !== true)))
          throw new Error("This native runtime does not advertise test debugging.");
        if (isJavaTestDebugOperation(operation) && !isConcreteJavaTestFilter(launchConfiguration.testFilter))
          throw new Error("Select one concrete test class or class#method for debugging.");
        const sourceBreakpoints =
          (operation === "debug" || isJavaTestDebugOperation(operation)) ? (current.current.getSourceBreakpoints?.() ?? []) : [];
        if (sourceBreakpoints.length && launchConfiguration.debuggerMode !== "jdi")
          throw new Error(
            "Saved source breakpoints require Structured Java debugger (JDI). Select it before Debug.",
          );
        if (preparationTool || (selectedProject && operation !== "attach"))
          await current.current.projectContext?.pauseMonitoring?.();
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before Java execution.");
        if (operation !== "attach" && !preparationTool) await current.current.prepare(operation);
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before Java execution.");
        if (["coverage", "integration-coverage"].includes(operation)) {
          try {
            sourceCapture = current.current.captureCoverageSources?.();
          } catch {
            sourceCapture = undefined;
          }
        }
        const verifySaved = selectedProject ? current.current.reviewSavedBuffers?.() : undefined;
        if (!matches(context) || epoch.current !== startedEpoch) return;
        if (preparationTool) {
          const actual = current.current.projectContext?.getSettings();
          if (!actual || !preparationSettings ||
              !sameJavaProjectContextSettings(preparationSettings, actual))
            throw new Error("Java Project settings changed before preparation. Retry.");
          verifyPreparation?.();
        }
        if (
          (operation === "debug" || isJavaTestDebugOperation(operation)) &&
          JSON.stringify(sourceBreakpoints) !==
            JSON.stringify(current.current.getSourceBreakpoints?.() ?? [])
        )
          throw new Error("Saved breakpoints changed while preparing Debug; retry.");
        let projectAuthority: import("@ide/contracts").JavaExecutionProjectSelection | undefined;
        if (selectedProject) {
          if (operation === "attach")
            throw new Error("Select manual configuration before attaching to an external JVM.");
          const project = current.current.projectContext;
          if (!project || !projectSettings)
            throw new Error("Java project-context execution is unavailable.");
          if (!sameJavaProjectContextSettings(projectSettings, project.getSettings()))
            throw new Error(
              "The selected project JDK or settings changed while saving. Retry execution.",
            );
          const priorModules = (project.context?.modules ?? []).filter(
            (module) =>
              module.id === selectedProject.moduleId &&
              (!selectedProject.providerId || module.providerId === selectedProject.providerId),
          );
          const priorSourceSets = priorModules.flatMap((module) =>
            module.sourceSets.filter((sourceSet) => sourceSet.id === selectedProject.sourceSetId),
          );
          const providerId =
            selectedProject.providerId ??
            (priorModules.length === 1 ? priorModules[0]!.providerId : undefined);
          const requestFailsafeMetadata =
            providerId === "maven-effective-v1" &&
            priorModules.length === 1 &&
            priorSourceSets.length === 1 &&
            priorSourceSets[0]!.kind === "integration-test";
          const refreshSelection = {
            ...(providerId ? { providerId } : {}),
            moduleId: selectedProject.moduleId,
            ...(requestFailsafeMetadata
              ? { sourceSetKind: "integration-test" as const }
              : { sourceSetId: selectedProject.sourceSetId }),
          };
          verifySaved?.();
          const fresh = await project.refresh(projectSettings, refreshSelection, {
            ...(verifySaved ? { afterSavedBufferReview: true as const } : {}),
            ...(["run", "debug"].includes(operation) && launchConfiguration.launchAsModule === true ? { requiredFacts: ["jpms"] } : {}),
          });
          launchProjectContext = fresh;
          if (!matches(context) || epoch.current !== startedEpoch) return;
          const actualProject = current.current.projectContext;
          if (
            !actualProject ||
            !sameJavaProjectContextSettings(projectSettings, actualProject.getSettings())
          )
            throw new Error(
              "The selected project settings changed while acquiring launch metadata.",
            );
          const authority = captureJavaProjectOperationContext({
            settings: projectSettings,
            context: fresh,
          }, { allowUnqualifiedSemanticAnalysis: true });
          const selectedModules = fresh.modules.filter(
            (module) =>
              module.id === selectedProject.moduleId &&
              (!providerId || module.providerId === providerId),
          );
          const selectedSourceSets = selectedModules[0]?.sourceSets.filter(
            (sourceSet) => sourceSet.id === selectedProject.sourceSetId,
          );
          if (!authority || selectedModules.length !== 1 || selectedSourceSets?.length !== 1)
            throw new Error(
              "The selected module or source set no longer exists. Choose it again in Java Run.",
            );
          projectAuthority = {
            context: authority,
            providerId: selectedModules[0]!.providerId,
            moduleId: selectedProject.moduleId,
            sourceSetId: selectedProject.sourceSetId,
          };
          if (["coverage", "integration-coverage", "discover"].includes(operation))
            retainedProjectContext = fresh;
        }
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before Java execution.");
        verifySaved?.();
        sourceCapture?.verify();
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before Java execution.");
        if (projectAuthority || preparationTool) current.current.projectContext?.retire?.();
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before Java execution.");
        const value = await port.start({
          ...context,
          operation,
          ...(profile ? { profile: true } : {}),
          configuration: projectAuthority
            ? {
                ...launchConfiguration,
                projectPath: projectAuthority.context.projectPath,
                jdkHome: projectAuthority.context.sdkHome,
                buildTool: "auto",
              }
            : launchConfiguration,
          trusted: true,
          ...(gradlePreparation ? { gradlePreparation } : {}),
          ...(mavenPreparation ? { mavenPreparation } : {}),
          ...(projectAuthority ? { projectContext: projectAuthority } : {}),
          ...(sourceBreakpoints.length ? { sourceBreakpoints } : {}),
        });
        if (matches(context) && epoch.current === startedEpoch) {
          coverageThresholdSession.current = { sessionId: value.sessionId, settings: thresholds };
          activeSession.current = value.sessionId;
          currentSnapshot.current = value;
          setSnapshot(value);
          setSessionConfigurationName(preparationTool === "gradle" ? "Gradle dependency preparation" :
            preparationTool === "maven" ? "Maven project verification" : selected.name);
          const capturedLaunchContext =
            launchProjectContext && projectSettings && ["starting", "running"].includes(value.state)
              ? {
                  workspaceId: value.workspaceId,
                  generation: value.generation,
                  sessionId: value.sessionId,
                  settings: projectSettings,
                  context: launchProjectContext,
                }
              : null;
          retainedLaunchContext.current = capturedLaunchContext;
          setExecutionProjectContext(capturedLaunchContext);
          let sourceFilesCurrent = Boolean(sourceCapture);
          const completed = !["starting", "running"].includes(value.state);
          if (sourceCapture && completed) {
            try {
              sourceCapture.verify();
            } catch {
              sourceFilesCurrent = false;
            }
          }
          coverageSourceReview.current =
            sourceCapture && !completed
              ? { sessionId: value.sessionId, verify: sourceCapture.verify }
              : null;
          setCoverageProjectContext(
            retainedProjectContext && projectSettings
              ? {
                  workspaceId: value.workspaceId,
                  generation: value.generation,
                  sessionId: value.sessionId,
                  sourceFilesCurrent,
                  sourcePaths: sourceCapture?.filePaths ?? [],
                  isDocumentCurrent: sourceCapture?.isDocumentCurrent,
                  settings: projectSettings,
                  context: retainedProjectContext,
                }
              : null,
          );
        } else {
          void port
            .stop({
              workspaceId: value.workspaceId,
              generation: value.generation,
              sessionId: value.sessionId,
            })
            .catch(() => undefined);
        }
      } catch (cause) {
        if (matches(context) && epoch.current === startedEpoch) setError(message(cause));
      } finally {
        if (epoch.current === startedEpoch) {
          starting.current = false;
          setPending(false);
        }
      }
    },
    [port, workspaceId, generation, matches],
  );
  const captureRepeatedCoverageSources = useCallback((operation: JavaExecutionOperation) => {
    if (!isCoverageOperation(operation)) return undefined;
    try {
      const sources = current.current.captureCoverageSources?.();
      sources?.verify();
      return sources;
    } catch {
      return undefined;
    }
  }, []);
  const adoptRepeatedCoverage = useCallback((
    previous: JavaExecutionSnapshot,
    value: JavaExecutionSnapshot,
    sources: CoverageSourceCapture | undefined,
  ) => {
    const thresholds = coverageThresholdSession.current?.sessionId === previous.sessionId
      ? coverageThresholdSession.current.settings : emptyCoverageThresholds;
    coverageThresholdSession.current = {
      sessionId: value.sessionId,
      settings: structuredClone(thresholds),
    };
    const completed = value.state !== "starting" && value.state !== "running";
    let sourceFilesCurrent = Boolean(sources);
    if (sources && completed) {
      try {
        sources.verify();
      } catch {
        sourceFilesCurrent = false;
      }
    }
    coverageSourceReview.current = sources && !completed
      ? { sessionId: value.sessionId, verify: sources.verify }
      : null;
    setCoverageProjectContext((context) =>
      isCoverageOperation(value.operation) && context?.sessionId === previous.sessionId &&
      context.workspaceId === previous.workspaceId && context.generation === previous.generation
        ? {
            ...context,
            sessionId: value.sessionId,
            sourceFilesCurrent,
            sourcePaths: sources?.filePaths ?? [],
            isDocumentCurrent: sources?.isDocumentCurrent,
          }
        : null,
    );
  }, []);
  const restart = useCallback(async () => {
    const previous = currentSnapshot.current;
    if (!previous || !canRestartSession(previous) || !matches(previous) ||
        starting.current || preparingClassReload.current || !port.restart ||
        !restartAvailable.current) return;
    const startedEpoch = epoch.current;
    const attempt = ++restartAttempt.current;
    const isCurrent = () => epoch.current === startedEpoch && matches(previous) &&
      activeSession.current === previous.sessionId && restartAttempt.current === attempt;
    starting.current = true;
    setPending(true);
    setError(null);
    const retained = retainedLaunchContext.current?.sessionId === previous.sessionId
      ? retainedLaunchContext.current : null;
    const breakpoints = (previous.operation === "debug" || isJavaTestDebugOperation(previous.operation))
      ? structuredClone(current.current.getSourceBreakpoints?.() ?? []) : [];
    try {
      if (!currentTrusted.current) throw new Error("Confirm workspace trust before restarting Java execution.");
      if (retained) await current.current.projectContext?.pauseMonitoring?.();
      await current.current.prepare(previous.operation);
      const verifySaved = current.current.reviewSavedBuffers?.();
      if (!isCurrent()) return;
      if (!currentTrusted.current) throw new Error("Workspace trust was withdrawn before restart.");
      if ((previous.operation === "debug" || isJavaTestDebugOperation(previous.operation)) && JSON.stringify(breakpoints) !== JSON.stringify(current.current.getSourceBreakpoints?.() ?? []))
        throw new Error("Saved breakpoints changed while preparing restart; retry.");
      if (retained && (!current.current.projectContext ||
          !sameJavaProjectContextSettings(retained.settings, current.current.projectContext.getSettings())))
        throw new Error("The selected project settings changed; start a new Java session.");
      verifySaved?.();
      const sourceCapture = captureRepeatedCoverageSources(previous.operation);
      const value = await port.restart({
        workspaceId: previous.workspaceId, generation: previous.generation,
        sessionId: previous.sessionId, trusted: true, sourceBreakpoints: breakpoints,
      });
      if (!isCurrent()) {
        const stopped = await port.stop({ workspaceId: value.workspaceId, generation: value.generation, sessionId: value.sessionId }).catch(() => undefined);
        if (epoch.current === startedEpoch && matches(previous) && activeSession.current === previous.sessionId &&
            stopped && matches(stopped) && stopped.sessionId === value.sessionId && !["starting", "running"].includes(stopped.state)) {
          activeSession.current = stopped.sessionId;
          currentSnapshot.current = stopped;
          setSnapshot(stopped);
          setExecutionProjectContext(null);
          retainedLaunchContext.current = retained ? { ...retained, sessionId: stopped.sessionId } : null;
          pendingFlightRecordingSession.current = null;
          pendingFlightRecordingTimelineSession.current = null;
          setFlightRecordingAnalysisPending(false);
          setFlightRecordingTimelinePending(false);
          setFlightRecordingSummary(null);
          setFlightRecordingTimeline(null);
        }
        return;
      }
      if (!matches(value) || value.sessionId === previous.sessionId || value.operation !== previous.operation)
        throw new Error("Invalid restarted Java session.");
      if (isCoverageOperation(previous.operation)) adoptRepeatedCoverage(previous, value, sourceCapture);
      activeSession.current = value.sessionId;
      currentSnapshot.current = value;
      setSnapshot(value);
      const nextContext = retained ? { ...retained, sessionId: value.sessionId } : null;
      retainedLaunchContext.current = nextContext;
      setExecutionProjectContext(nextContext);
      setClassReloadBuild(null);
      pendingFlightRecordingSession.current = null;
      pendingFlightRecordingTimelineSession.current = null;
      setFlightRecordingAnalysisPending(false);
      setFlightRecordingTimelinePending(false);
      setFlightRecordingSummary(null);
      setFlightRecordingTimeline(null);
    } catch (cause) {
      if (isCurrent()) setError(message(cause));
    } finally {
      if (epoch.current === startedEpoch) { starting.current = false; setPending(false); }
    }
  }, [port, matches, captureRepeatedCoverageSources, adoptRepeatedCoverage]);
  const rerunFailed = useCallback(async (withDebugger = false) => {
    const previous = currentSnapshot.current;
    const retainedLaunch = retainedLaunchContext.current?.sessionId === previous?.sessionId
      ? retainedLaunchContext.current : null;
    if (
      !previous?.testResults?.canRerunFailed ||
      (withDebugger && previous.canDebugFailedTests !== true) ||
      current.current.workspaceId !== workspaceId ||
      current.current.generation !== generation ||
      current.current.port !== port ||
      !matches(previous) ||
      starting.current ||
      ["starting", "running"].includes(previous.state)
    )
      return;
    const startedEpoch = epoch.current;
    starting.current = true;
    setPending(true);
    setError(null);
    const operation = withDebugger
      ? (["integration-test", "integration-coverage"].includes(previous.operation) ? "debug-integration-test" : "debug-test")
      : previous.operation;
    const breakpoints = isJavaTestDebugOperation(operation)
      ? structuredClone(current.current.getSourceBreakpoints?.() ?? []) : undefined;
    try {
      if (!currentTrusted.current) throw new Error("Confirm workspace trust before rerunning failed tests.");
      if (retainedLaunch) await current.current.projectContext?.pauseMonitoring?.();
      await current.current.prepare(operation);
      if (
        epoch.current !== startedEpoch ||
        !matches(previous) ||
        activeSession.current !== previous.sessionId
      )
        return;
      if (!currentTrusted.current) throw new Error("Workspace trust was withdrawn before rerun.");
      if (breakpoints && JSON.stringify(breakpoints) !== JSON.stringify(current.current.getSourceBreakpoints?.() ?? []))
        throw new Error("Saved breakpoints changed while preparing failed-test rerun; retry.");
      if (retainedLaunch && (!current.current.projectContext ||
          !sameJavaProjectContextSettings(retainedLaunch.settings, current.current.projectContext.getSettings())))
        throw new Error("The selected project settings changed; start a new Java session.");
      current.current.reviewSavedBuffers?.()();
      const sourceCapture = captureRepeatedCoverageSources(operation);
      const value = await port.rerunFailed({
        workspaceId: previous.workspaceId,
        generation: previous.generation,
        sessionId: previous.sessionId,
        trusted: true,
        ...(withDebugger ? { debug: true } : {}),
        ...(breakpoints ? { sourceBreakpoints: breakpoints } : {}),
      });
      if (value.operation !== operation) {
        if (matches(value) && value.sessionId !== previous.sessionId)
          await port.stop({ workspaceId: value.workspaceId, generation: value.generation, sessionId: value.sessionId }).catch(() => undefined);
        throw new Error("Invalid repeated Java test operation.");
      }
      if (
        epoch.current === startedEpoch &&
        matches(previous) &&
        activeSession.current === previous.sessionId
      ) {
        adoptRepeatedCoverage(previous, value, sourceCapture);
        activeSession.current = value.sessionId;
        currentSnapshot.current = value;
        setSnapshot(value);
        const nextLaunch = retainedLaunch ? { ...retainedLaunch, sessionId: value.sessionId } : null;
        retainedLaunchContext.current = nextLaunch;
        setExecutionProjectContext(nextLaunch);
        setClassReloadBuild(null);
      } else {
        void port
          .stop({
            workspaceId: value.workspaceId,
            generation: value.generation,
            sessionId: value.sessionId,
          })
          .catch(() => undefined);
      }
    } catch (cause) {
      if (
        epoch.current === startedEpoch &&
        matches(previous) &&
        activeSession.current === previous.sessionId
      )
        setError(message(cause));
    } finally {
      if (epoch.current === startedEpoch) {
        starting.current = false;
        setPending(false);
      }
    }
  }, [port, workspaceId, generation, matches, captureRepeatedCoverageSources, adoptRepeatedCoverage]);
  const runDiscovered = useCallback(
    async (testId: string, withCoverage = false, withDebugger = false) => {
      const previous = currentSnapshot.current;
      const retainedContext =
        coverageProjectContext !== null &&
        coverageProjectContext.sessionId === previous?.sessionId &&
        coverageProjectContext.workspaceId === previous?.workspaceId &&
        coverageProjectContext.generation === previous?.generation
          ? coverageProjectContext
          : null;
      if (
        previous?.operation !== "discover" ||
        previous.state !== "succeeded" ||
        previous.testDiscovery?.status !== "ready" ||
        !previous.testDiscovery.tests.some((test) => test.id === testId) ||
        current.current.workspaceId !== workspaceId ||
        current.current.generation !== generation ||
        current.current.port !== port ||
        !matches(previous) ||
        starting.current ||
        activeSession.current !== previous.sessionId
      )
        return;
      const startedEpoch = epoch.current;
      starting.current = true;
      setPending(true);
      setError(null);
      let sourceCapture: ReturnType<NonNullable<typeof captureCoverageSources>> | undefined;
      try {
        if (!currentTrusted.current) throw new Error("Confirm workspace trust before running discovered tests.");
        if (withCoverage && withDebugger) throw new Error("Choose either debug or coverage for this test execution.");
        if (withDebugger && currentCapabilities.current?.debugTests !== true) throw new Error("This native runtime does not advertise test debugging.");
        const sourceBreakpoints = withDebugger ? structuredClone(current.current.getSourceBreakpoints?.() ?? []) : [];
        const selected = configurations.current.configurations.find(
          (item) => item.id === configurations.current.selectedId,
        )!;
        const thresholds = structuredClone(selected.coverageThresholds ?? emptyCoverageThresholds);
        if (withCoverage) {
          const invalid = coverageThresholdError(thresholds);
          if (invalid) throw new Error(invalid);
        }
        await current.current.prepare(withDebugger ? "debug-test" : withCoverage ? "coverage" : "test");
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before running discovered tests.");
        if (withCoverage) {
          try {
            sourceCapture = current.current.captureCoverageSources?.();
            sourceCapture?.verify();
          } catch {
            sourceCapture = undefined;
          }
        }
        if (
          epoch.current !== startedEpoch ||
          !matches(previous) ||
          activeSession.current !== previous.sessionId
        )
          return;
        if (withDebugger && JSON.stringify(sourceBreakpoints) !== JSON.stringify(current.current.getSourceBreakpoints?.() ?? [])) throw new Error("Saved breakpoints changed while preparing test debugging; retry.");
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before running discovered tests.");
        const value = await port.start({
          workspaceId: previous.workspaceId,
          generation: previous.generation,
          operation: withDebugger ? "debug-test" : withCoverage ? "coverage" : "test",
          configuration: withDebugger ? { ...selected.configuration, debuggerMode: "jdi" } : selected.configuration,
          ...(sourceBreakpoints.length ? { sourceBreakpoints } : {}),
          trusted: true,
          testSelection: { discoverySessionId: previous.sessionId, testId },
        });
        if (
          epoch.current === startedEpoch &&
          matches(previous) &&
          activeSession.current === previous.sessionId
        ) {
          // Keep the discovery session's name because native execution uses its captured launch settings.
          coverageThresholdSession.current = { sessionId: value.sessionId, settings: thresholds };
          activeSession.current = value.sessionId;
          currentSnapshot.current = value;
          setSnapshot(value);
          let sourceFilesCurrent = Boolean(sourceCapture);
          const completed = !["starting", "running"].includes(value.state);
          if (sourceCapture && completed) {
            try {
              sourceCapture.verify();
            } catch {
              sourceFilesCurrent = false;
            }
          }
          coverageSourceReview.current =
            sourceCapture && !completed
              ? { sessionId: value.sessionId, verify: sourceCapture.verify }
              : null;
          setCoverageProjectContext(
            withCoverage && retainedContext
              ? {
                  ...retainedContext,
                  sessionId: value.sessionId,
                  sourceFilesCurrent,
                  sourcePaths: sourceCapture?.filePaths ?? [],
                  isDocumentCurrent: sourceCapture?.isDocumentCurrent,
                }
              : null,
          );
        } else {
          void port
            .stop({
              workspaceId: value.workspaceId,
              generation: value.generation,
              sessionId: value.sessionId,
            })
            .catch(() => undefined);
        }
      } catch (cause) {
        if (
          epoch.current === startedEpoch &&
          matches(previous) &&
          activeSession.current === previous.sessionId
        )
          setError(message(cause));
      } finally {
        if (epoch.current === startedEpoch) {
          starting.current = false;
          setPending(false);
        }
      }
    },
    [port, workspaceId, generation, matches, coverageProjectContext],
  );
  const stop = useCallback(async () => {
    if (!snapshot) return;
    restartAttempt.current++;
    setError(null);
    try {
      const value = await port.stop({
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        sessionId: snapshot.sessionId,
      });
      if (matches(snapshot) && activeSession.current === snapshot.sessionId) {
        currentSnapshot.current = value;
        setSnapshot(value);
        if (!["starting", "running"].includes(value.state))
          setExecutionProjectContext((current) =>
            current?.sessionId === value.sessionId ? null : current,
          );
      }
    } catch (cause) {
      if (matches(snapshot) && activeSession.current === snapshot.sessionId)
        setError(message(cause));
    }
  }, [port, snapshot, matches]);
  const analyzeFlightRecording = useCallback(async () => {
    const active = currentSnapshot.current;
    if (
      !active ||
      active.operation !== "run" ||
      !["succeeded", "failed"].includes(active.state) ||
      !active.profilePath ||
      !currentTrusted.current ||
      !port.analyzeFlightRecording ||
      pendingFlightRecordingSession.current === active.sessionId
    )
      return;
    const startedEpoch = epoch.current;
    const profilePath = active.profilePath;
    const isCurrent = () =>
      epoch.current === startedEpoch &&
      matches(active) &&
      currentTrusted.current &&
      activeSession.current === active.sessionId &&
      currentSnapshot.current?.sessionId === active.sessionId &&
      currentSnapshot.current.operation === "run" &&
      currentSnapshot.current.profilePath === profilePath &&
      ["succeeded", "failed"].includes(currentSnapshot.current.state);
    if (!isCurrent()) return;
    pendingFlightRecordingSession.current = active.sessionId;
    setFlightRecordingAnalysisPending(true);
    setFlightRecordingSummary(null);
    setFlightRecordingTimeline(null);
    setError(null);
    try {
      const summary = await port.analyzeFlightRecording({
        workspaceId: active.workspaceId,
        generation: active.generation,
        sessionId: active.sessionId,
        trusted: true,
      });
      if (
        isCurrent() &&
        summary.workspaceId === active.workspaceId &&
        summary.generation === active.generation &&
        summary.sessionId === active.sessionId &&
        summary.profilePath === profilePath
      )
        setFlightRecordingSummary(summary);
    } catch (cause) {
      if (isCurrent()) setError(message(cause));
    } finally {
      if (pendingFlightRecordingSession.current === active.sessionId) {
        pendingFlightRecordingSession.current = null;
        setFlightRecordingAnalysisPending(false);
      }
    }
  }, [port, matches]);
  const readFlightRecordingTimeline = useCallback(
    async (eventType: string) => {
      const active = currentSnapshot.current;
      const summary = flightRecordingSummary;
      if (
        !active ||
        active.operation !== "run" ||
        !["succeeded", "failed"].includes(active.state) ||
        !active.profilePath ||
        !currentTrusted.current ||
        !port.readFlightRecordingTimeline ||
        pendingFlightRecordingTimelineSession.current === active.sessionId ||
        summary?.sessionId !== active.sessionId ||
        !summary.events.some((event) => event.name === eventType)
      )
        return;
      const startedEpoch = epoch.current;
      const profilePath = active.profilePath;
      const isCurrent = () =>
        epoch.current === startedEpoch &&
        matches(active) &&
        currentTrusted.current &&
        activeSession.current === active.sessionId &&
        currentSnapshot.current?.sessionId === active.sessionId &&
        currentSnapshot.current.operation === "run" &&
        currentSnapshot.current.profilePath === profilePath &&
        ["succeeded", "failed"].includes(currentSnapshot.current.state);
      if (!isCurrent()) return;
      pendingFlightRecordingTimelineSession.current = active.sessionId;
      setFlightRecordingTimelinePending(true);
      setFlightRecordingTimeline(null);
      setError(null);
      try {
        const timeline = await port.readFlightRecordingTimeline({
          workspaceId: active.workspaceId,
          generation: active.generation,
          sessionId: active.sessionId,
          trusted: true,
          eventType,
        });
        if (
          isCurrent() &&
          timeline.workspaceId === active.workspaceId &&
          timeline.generation === active.generation &&
          timeline.sessionId === active.sessionId &&
          timeline.profilePath === profilePath &&
          timeline.eventType === eventType
        )
          setFlightRecordingTimeline(timeline);
      } catch (cause) {
        if (isCurrent()) setError(message(cause));
      } finally {
        if (pendingFlightRecordingTimelineSession.current === active.sessionId) {
          pendingFlightRecordingTimelineSession.current = null;
          setFlightRecordingTimelinePending(false);
        }
      }
    },
    [flightRecordingSummary, matches, port],
  );
  const debugCommand = useCallback(
    async (command: string) => {
      if (!snapshot) return;
      const startedEpoch = epoch.current;
      const isCurrent = () =>
        epoch.current === startedEpoch &&
        matches(snapshot) &&
        activeSession.current === snapshot.sessionId &&
        currentSnapshot.current?.sessionId === snapshot.sessionId &&
        (currentSnapshot.current.operation === "debug" || isJavaTestDebugOperation(currentSnapshot.current.operation)) &&
        currentSnapshot.current.state === "running";
      if (!isCurrent()) return;
      try {
        await port.debugCommand({
          workspaceId: snapshot.workspaceId,
          generation: snapshot.generation,
          sessionId: snapshot.sessionId,
          command,
        });
      } catch (cause) {
        if (isCurrent()) setError(message(cause));
      }
    },
    [port, snapshot, matches],
  );
  const debugAction = useCallback(
    async (action: JavaDebuggerAction) => {
      if (!snapshot) return;
      const startedEpoch = epoch.current;
      const isCurrent = () =>
        epoch.current === startedEpoch &&
        matches(snapshot) &&
        activeSession.current === snapshot.sessionId &&
        currentSnapshot.current?.sessionId === snapshot.sessionId &&
        isJavaDebuggingOperation(currentSnapshot.current.operation) &&
        currentSnapshot.current?.state === "running" &&
        (!("stopId" in action) || currentSnapshot.current.debuggerState?.stopId === action.stopId);
      if (!isCurrent()) return;
      try {
        if (!port.debugAction)
          throw new Error("Structured debugging is unavailable from this provider.");
        setError(null);
        const filters = action.type === "step" ? parseJavaStepFilters(stepFilterDraft.current) : [];
        if (filters === null) throw new Error("Correct the step exclusion patterns before stepping.");
        const effectiveAction = action.type === "step" && action.exclusionFilters === undefined && filters.length
          ? { ...action, exclusionFilters: filters } : action;
        await port.debugAction({
          workspaceId: snapshot.workspaceId,
          generation: snapshot.generation,
          sessionId: snapshot.sessionId,
          action: effectiveAction,
        });
      } catch (cause) {
        if (isCurrent()) setError(message(cause));
      }
    },
    [port, snapshot, matches],
  );
  const reloadClasses = useCallback(
    async (classes: JavaClassReloadRequest["classes"]) => {
      if (!snapshot || preparingClassReload.current) return;
      const startedEpoch = epoch.current;
      const stopId = snapshot.debuggerState?.stopId ?? null;
      const isCurrent = () =>
        epoch.current === startedEpoch &&
        matches(snapshot) &&
        activeSession.current === snapshot.sessionId &&
        currentSnapshot.current?.sessionId === snapshot.sessionId &&
        currentSnapshot.current?.state === "running" &&
        (currentSnapshot.current?.debuggerState?.stopId ?? null) === stopId;
      if (!isCurrent()) return;
      try {
        if (!currentTrusted.current)
          throw new Error("Confirm workspace trust before reloading classes.");
        if (
          !port.reloadClasses ||
          currentSnapshot.current?.debuggerState?.canReloadClasses !== true
        )
          throw new Error("Class reload is unavailable from this provider or JVM.");
        if (currentSnapshot.current?.classReload?.status === "queued")
          throw new Error("Wait for the current class reload result.");
        preparingClassReload.current = true;
        setClassReloadPending(true);
        setError(null);
        await port.reloadClasses({
          workspaceId: snapshot.workspaceId,
          generation: snapshot.generation,
          sessionId: snapshot.sessionId,
          trusted: true,
          stopId,
          classes: structuredClone(classes),
        });
        if (isCurrent()) {
          const next = await port.snapshot({
            workspaceId: snapshot.workspaceId,
            generation: snapshot.generation,
            sessionId: snapshot.sessionId,
          });
          if (isCurrent() && matches(next) && next.sessionId === snapshot.sessionId) {
            currentSnapshot.current = next;
            setSnapshot(next);
          }
        }
      } catch (cause) {
        if (isCurrent()) setError(message(cause));
      } finally {
        if (epoch.current === startedEpoch) {
          preparingClassReload.current = false;
          setClassReloadPending(false);
        }
      }
    },
    [port, snapshot, matches],
  );
  const buildClasses = useCallback(
    async (classes: JavaClassReloadRequest["classes"] | null) => {
      const active = currentSnapshot.current;
      if (!active || preparingClassReload.current) return;
      const startedEpoch = epoch.current;
      const stopId = active.debuggerState?.stopId ?? null;
      const isCurrent = () =>
        epoch.current === startedEpoch &&
        matches(active) &&
        activeSession.current === active.sessionId &&
        currentSnapshot.current?.sessionId === active.sessionId &&
        currentSnapshot.current.state === "running" &&
        (currentSnapshot.current.debuggerState?.stopId ?? null) === stopId;
      if (!isCurrent()) return;
      try {
        if (!currentTrusted.current)
          throw new Error("Confirm workspace trust before building classes for HotSwap.");
        if (!port.buildForClassReload || (classes !== null && !port.reloadClasses))
          throw new Error("Build and HotSwap are unavailable from this provider.");
        if (active.debuggerState?.canReloadClasses !== true)
          throw new Error("Class reload is unavailable from this provider or JVM.");
        if (currentSnapshot.current?.classReload?.status === "queued")
          throw new Error("Wait for the current class reload result.");
        preparingClassReload.current = true;
        setClassReloadPending(true);
        setClassReloadBuild(null);
        setError(null);
        await current.current.prepare("debug");
        if (!isCurrent()) return;
        const selected = configurations.current.configurations.find(
          (item) => item.id === configurations.current.selectedId,
        );
        const verifySaved = selected?.configuration.projectModule
          ? current.current.reviewSavedBuffers?.()
          : undefined;
        verifySaved?.();
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before building classes for HotSwap.");
        const build = await port.buildForClassReload({
          workspaceId: active.workspaceId,
          generation: active.generation,
          sessionId: active.sessionId,
          trusted: true,
        });
        if (!isCurrent()) return;
        setClassReloadBuild(build);
        if (build.state !== "succeeded") return;

        const afterBuild = await port.snapshot({
          workspaceId: active.workspaceId,
          generation: active.generation,
          sessionId: active.sessionId,
        });
        if (!isCurrent()) return;
        currentSnapshot.current = afterBuild;
        setSnapshot(afterBuild);
        if (
          afterBuild.state !== "running" ||
          afterBuild.debuggerState?.canReloadClasses !== true ||
          (afterBuild.debuggerState?.stopId ?? null) !== stopId
        ) {
          setError(
            "The debugger session or suspension changed during compilation; classes were not reloaded.",
          );
          setClassReloadBuild(null);
          return;
        }

        if (classes === null) {
          if (!build.classChanges) {
            setError("This provider did not return a compiled-class comparison; choose files manually.");
          } else if (build.classChanges.status === "ready" && build.classChanges.stopId !== stopId) {
            setClassReloadBuild(null);
            setError("The compiled-class comparison belongs to another suspension; build and review again.");
          }
          return;
        }
        if (!currentTrusted.current)
          throw new Error("Workspace trust was withdrawn before reloading classes.");
        await port.reloadClasses!({
          workspaceId: active.workspaceId,
          generation: active.generation,
          sessionId: active.sessionId,
          trusted: true,
          stopId,
          classes: structuredClone(classes),
        });
        if (!isCurrent()) return;
        const reloaded = await port.snapshot({
          workspaceId: active.workspaceId,
          generation: active.generation,
          sessionId: active.sessionId,
        });
        if (isCurrent() && matches(reloaded) && reloaded.sessionId === active.sessionId) {
          currentSnapshot.current = reloaded;
          setSnapshot(reloaded);
        }
      } catch (cause) {
        if (isCurrent()) setError(message(cause));
      } finally {
        if (epoch.current === startedEpoch) {
          preparingClassReload.current = false;
          setClassReloadPending(false);
        }
      }
    },
    [port, matches],
  );
  const buildAndReloadClasses = useCallback(
    (classes: JavaClassReloadRequest["classes"]) => buildClasses(classes),
    [buildClasses],
  );
  const buildAndReviewClasses = useCallback(() => buildClasses(null), [buildClasses]);
  const activeExecutionProjectContext =
    executionProjectContext &&
    snapshot?.operation === "debug" &&
    ["starting", "running"].includes(snapshot.state) &&
    snapshot.workspaceId === executionProjectContext.workspaceId &&
    snapshot.generation === executionProjectContext.generation &&
    snapshot.sessionId === executionProjectContext.sessionId &&
    projectContext &&
    sameJavaProjectContextSettings(executionProjectContext.settings, projectContext.getSettings())
      ? {
          ...projectContext,
          settings: executionProjectContext.settings,
          context: executionProjectContext.context,
        }
      : null;
  const entryPoints = useJavaEntryPointDiscovery({
    port: entryPointPort, workspaceId, generation, enabled: enabled || sourceExecutionEnabled, trusted,
    busy: pending || !!snapshot && ["starting", "running"].includes(snapshot.state),
    selectedConfigurationId: collection.selectedId,
    configuration, projectContext, reviewSavedBuffers, updateConfiguration,
    runSelectedConfiguration: async (expected, operation) => {
      const selected = configurations.current.configurations.find(item => item.id === configurations.current.selectedId);
      if (!selected || JSON.stringify(selected.configuration) !== JSON.stringify(expected))
        throw new Error("The launch configuration changed before the discovered main could run.");
      await start(operation);
    },
  });
  return {
    entryPoints,
    applicationInput,
    configuration,
    coverageThresholds: selectedConfiguration.coverageThresholds ?? emptyCoverageThresholds,
    updateCoverageThresholds,
    coverageThresholdCheck: snapshot && matches(snapshot) && coverageThresholdSession.current?.sessionId === snapshot.sessionId
      ? checkCoverageThresholds(snapshot, coverageThresholdSession.current.settings) : null,
    projectContext: activeExecutionProjectContext ?? projectContext,
    updateConfiguration,
    configurations: collection.configurations,
    selectedConfigurationId: collection.selectedId,
    selectConfiguration,
    createConfiguration,
    renameConfiguration,
    deleteConfiguration,
    sessionConfigurationName,
    trusted,
    setTrusted,
    capabilities,
    snapshot,
    flightRecordingSummary:
      flightRecordingSummary?.sessionId === snapshot?.sessionId ? flightRecordingSummary : null,
    flightRecordingAnalysisPending,
    canAnalyzeFlightRecording: typeof port.analyzeFlightRecording === "function",
    analyzeFlightRecording,
    flightRecordingTimeline:
      flightRecordingTimeline?.sessionId === snapshot?.sessionId ? flightRecordingTimeline : null,
    flightRecordingTimelinePending,
    canReadFlightRecordingTimeline: typeof port.readFlightRecordingTimeline === "function",
    readFlightRecordingTimeline,
    error: error ?? configurationError,
    pending,
    start,
    restart,
    canRestart: typeof port.restart === "function" && restartSupported &&
      !!snapshot && canRestartSession(snapshot),
    rerunFailed,
    runDiscovered,
    stop,
    debugCommand,
    stepFilterText,
    setStepFilterText,
    debugAction,
    reloadClasses,
    buildAndReloadClasses,
    buildAndReviewClasses,
    classReloadBuild,
    classReloadPending,
    coverageProjectContext,
    coverageHistory: coverageHistory.entries,
    coverageHistoryError: coverageHistory.error,
    clearCoverageHistory: coverageHistory.clear,
    running: !!snapshot && ["starting", "running"].includes(snapshot.state),
  };
}
export type JavaExecutionController = ReturnType<typeof useJavaExecutionController>;
