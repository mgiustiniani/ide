import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  JavaEffectiveProjectContext,
  JavaProjectContextAuthority,
  JavaProjectContextRequest,
  JavaProjectContextSettings,
  JavaProjectSourceSetKind,
  JavaProjectLanguageSettingsRequest,
  JavaProjectLanguageSettingsResult,
  JavaSavedSourceRecoveryRequest,
} from "@ide/contracts";
import type { JavaProjectContextPort } from "@ide/web-core";
import { isJavaGradleSettings } from "@ide/contracts";

const defaults: JavaProjectContextSettings = {
  projectPath: "",
  sdkHome: "",
  mavenRepository: "",
  activeMavenProfiles: [],
  inactiveMavenProfiles: [],
};
interface WorkspaceContext {
  workspaceId: string | null;
  generation: number;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}
function gradleIdentitiesAreQualified(context: JavaEffectiveProjectContext): boolean {
  const gradleModules = context.modules.filter(
    (module) => module.providerId === "gradle-effective-v1",
  );
  if (gradleModules.length === 0) return true;
  return (
    (context.schemaVersion === "java-project-context-v3" ||
      context.schemaVersion === "java-project-context-v4" ||
      context.schemaVersion === "java-project-context-v5" ||
      context.schemaVersion === "java-project-context-v6" ||
      context.schemaVersion === "java-project-context-v7") &&
    gradleModules.length > 0 &&
    gradleModules.every(
      (module) => module.buildRoot !== undefined && module.projectPath !== undefined,
    )
  );
}
export interface JavaProjectContextController {
  settings: JavaProjectContextSettings;
  context: JavaEffectiveProjectContext | null;
  engineVersion: string | null;
  isBusy: boolean;
  error: string | null;
  message: string | null;
  recoveryAction?: "prepare-gradle" | "edit-gradle-user-home";
  savedSourceRecovery?: JavaSavedSourceRecoveryRequest;
  recoverSavedSources?(
    request: JavaSavedSourceRecoveryRequest,
    beginWrite: () => () => void,
    reconcile: (isCurrent: () => boolean, recovered: boolean) => Promise<string | undefined>,
  ): Promise<void>;
  setSettings(settings: JavaProjectContextSettings): void;
  /** Retire observed source authority while preserving the transaction-owning SDK session. */
  retireContext(message?: string): void;
  /** Stop filesystem monitoring before an operation saves reviewed editor buffers. */
  pauseMonitoring(): Promise<void>;
  synchronize(expected?: JavaProjectContextAuthority & { settings: JavaProjectContextSettings }): Promise<void>;
  /** Caller reviews saved buffers before acquisition and throughout navigation. Never evaluates Gradle. */
  reviewForSourceNavigation(expected: JavaProjectContextSettings): Promise<{
    context: JavaEffectiveProjectContext;
    isCurrent(): boolean;
  }>;
  refreshForExecution(
    expected: JavaProjectContextSettings,
    selection?: {
      providerId?: string;
      moduleId: string;
      sourceSetId?: string;
      sourceSetKind?: JavaProjectSourceSetKind;
    },
    options?: {
      afterSavedBufferReview?: true;
      requiredFacts?: JavaProjectContextRequest["requiredFacts"];
    },
  ): Promise<JavaEffectiveProjectContext>;
  evaluateGradle(): Promise<void>;
  applyLanguageSettings(): Promise<JavaProjectLanguageSettingsResult | null>;
  inspectSource(
    providerId: string | undefined,
    moduleId: string,
    sourceSetId: string,
    path: string,
    symbol: string,
  ): Promise<void>;
  inspectJpms(providerId: string | undefined, moduleId: string, sourceSetId: string): Promise<void>;
  inspectMavenTestJvm?(moduleId: string, sourceSetId: string): Promise<void>;
  cancel(): void;
}
interface Dependencies {
  port: JavaProjectContextPort;
  workspaceId: string | null;
  generation: number;
  supportsProviderQualifiedSourceAssociation?: boolean;
  supportsJavaProjectContextV7?: boolean;
  supportsAggregateGradleCompositeIdentity?: boolean;
  getWorkspaceContext(): WorkspaceContext;
  /** Opt into read-only source refresh only while editor/workspace writes are idle. */
  canRefreshSourceContext?(): boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
}
function restored(
  storage: Dependencies["storage"],
  workspace: string | null,
): JavaProjectContextSettings {
  if (!storage || !workspace) return { ...defaults };
  try {
    const raw = storage.getItem(`java-project-context:${workspace}`);
    if (!raw || raw.length > 65_536) return { ...defaults };
    const data = JSON.parse(raw) as JavaProjectContextSettings;
    if (
      ![data.projectPath, data.sdkHome, data.mavenRepository].every(
        (s) => typeof s === "string" && s.length <= 4096 && !s.includes("\0"),
      ) ||
      ![data.activeMavenProfiles, data.inactiveMavenProfiles].every(
        (items) =>
          Array.isArray(items) &&
          items.length <= 64 &&
          items.every(
            (s) => typeof s === "string" && s.length > 0 && s.length <= 256 && !s.includes("\0"),
          ),
      ) ||
      (data.gradle !== undefined && !isJavaGradleSettings(data.gradle))
    )
      return { ...defaults };
    return {
      projectPath: data.projectPath,
      sdkHome: data.sdkHome,
      mavenRepository: data.mavenRepository,
      activeMavenProfiles: data.activeMavenProfiles,
      inactiveMavenProfiles: data.inactiveMavenProfiles,
      ...(data.gradle
        ? {
            gradle: {
              executable: data.gradle.executable,
              userHome: data.gradle.userHome,
              ...(data.gradle.gradleRuntimeHome !== undefined
                ? { gradleRuntimeHome: data.gradle.gradleRuntimeHome }
                : {}),
              projectProperties: data.gradle.projectProperties,
            },
          }
        : {}),
    };
  } catch {
    return { ...defaults };
  }
}
export function useJavaProjectContextController(deps: Dependencies): JavaProjectContextController {
  const [draft, setDraft] = useState(() => ({
    workspaceId: deps.workspaceId,
    settings: restored(deps.storage, deps.workspaceId),
  }));
  const settings = draft.workspaceId === deps.workspaceId ? draft.settings : defaults;
  const signature = JSON.stringify(settings);
  const [observed, setObserved] = useState<{
    workspaceId: string;
    generation: number;
    signature: string;
    context: JavaEffectiveProjectContext;
    engineVersion: string;
  } | null>(null);
  const [isBusy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<{
      message: string;
      action?: JavaProjectContextController["recoveryAction"];
      savedSourceRecovery?: JavaSavedSourceRecoveryRequest;
    } | null>(null);
  const setMessage = useCallback((message: string | null, action?: JavaProjectContextController["recoveryAction"]) => {
    setNotice(message === null ? null : { message, action });
  }, []);
  const revision = useRef(0),
    sequence = useRef(0),
    busy = useRef(false);
  const sourceRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRefreshEpoch = useRef(0);
  const cancelSourceRefresh = useCallback(() => {
    if (sourceRefreshTimer.current !== null) clearTimeout(sourceRefreshTimer.current);
    sourceRefreshTimer.current = null;
    sourceRefreshEpoch.current++;
  }, []);
  const refreshSourceContext = useRef<(() => Promise<void>) | null>(null);
  const publishedContext = useRef<{
    context: JavaEffectiveProjectContext;
    revision: number;
    workspaceId: string;
    generation: number;
    port: JavaProjectContextPort;
  } | null>(null);
  const lastInvalidation = useRef({ revision: 0, reason: "the project context changed" });
  const latestQueryRequest = useRef<{ requestId: string; token: number } | null>(null);
  const executionQueryDiagnostic = useRef<{
    requestId: string | null;
    status: "not-started" | "pending" | "discarded" | "refused" | "failed" | "completed";
    reason: string;
  } | null>(null);
  const invalidate = useCallback(
    (reason: string) => {
      cancelSourceRefresh();
      revision.current++;
      lastInvalidation.current = { revision: revision.current, reason };
    },
    [cancelSourceRefresh],
  );
  const projectWatch = useRef<{ watchId: string; stop: () => void | Promise<void> } | null>(null);
  const pendingWatchStop = useRef<Promise<void>>(Promise.resolve());
  const stopWatching = useCallback(() => {
    const active = projectWatch.current;
    projectWatch.current = null;
    if (active) {
      let stopped: void | Promise<void>;
      try {
        stopped = active.stop();
      } catch {
        stopped = undefined;
      }
      pendingWatchStop.current = Promise.all([
        pendingWatchStop.current.catch(() => undefined),
        Promise.resolve(stopped).catch(() => undefined),
      ]).then(() => undefined);
    }
    return pendingWatchStop.current;
  }, []);
  const pendingStop = useRef<Promise<void>>(Promise.resolve());
  const enqueueStop = useCallback(
    (port: JavaProjectContextPort, workspaceId: string, generation: number) => {
      pendingStop.current = pendingStop.current
        .catch(() => undefined)
        .then(() => port.stop({ workspaceId, generation }))
        .catch(() => undefined);
    },
    [],
  );
  const clearLanguageSettings = useCallback(
    (port: JavaProjectContextPort, workspaceId: string | null, generation: number) => {
      if (!workspaceId || !port.clearLanguageSettings) return Promise.resolve();
      return port.clearLanguageSettings({ workspaceId, generation }).catch(() => undefined);
    },
    [],
  );
  const latest = useRef(deps);
  latest.current = deps;
  // Settings are updated when accepted, before React commits the panel's draft.
  const settingsRef = useRef(settings);
  const context =
    observed?.workspaceId === deps.workspaceId &&
    observed.generation === deps.generation &&
    observed.signature === signature
      ? observed.context
      : null;
  const cancel = useCallback(() => {
    invalidate("the synchronization was cancelled");
    busy.current = false;
    setBusy(false);
    setMessage("Project-context request cancelled.");
    void stopWatching();
    const current = latest.current;
    void clearLanguageSettings(current.port, current.workspaceId, current.generation);
    if (current.workspaceId) enqueueStop(current.port, current.workspaceId, current.generation);
  }, [clearLanguageSettings, enqueueStop, invalidate, stopWatching]);
  useLayoutEffect(() => {
    invalidate("the workspace or project-context service changed");
    busy.current = false;
    setBusy(false);
    setObserved(null);
    setError(null);
    setMessage(null);
    const restoredSettings = restored(deps.storage, deps.workspaceId);
    settingsRef.current = restoredSettings;
    setDraft({ workspaceId: deps.workspaceId, settings: restoredSettings });
    const { workspaceId, generation, port } = deps;
    return () => {
      invalidate("the workspace or project-context service changed");
      void stopWatching();
      void clearLanguageSettings(port, workspaceId, generation);
      if (workspaceId) enqueueStop(port, workspaceId, generation);
    };
  }, [
    deps.workspaceId,
    deps.generation,
    deps.port,
    deps.storage,
    clearLanguageSettings,
    enqueueStop,
    invalidate,
    stopWatching,
  ]);
  const setSettings = useCallback(
    (value: JavaProjectContextSettings) => {
      const changedKeys = (
        [
          "projectPath",
          "sdkHome",
          "mavenRepository",
          "activeMavenProfiles",
          "inactiveMavenProfiles",
          "gradle",
        ] as const
      ).filter((key) => JSON.stringify(settingsRef.current[key]) !== JSON.stringify(value[key]));
      invalidate(
        changedKeys.length
          ? `Java Project settings changed (${changedKeys.join(", ")})`
          : "Java Project settings were re-applied",
      );
      busy.current = false;
      setBusy(false);
      setObserved(null);
      setError(null);
      setMessage(null);
      void stopWatching();
      settingsRef.current = value;
      const current = latest.current;
      void clearLanguageSettings(current.port, current.workspaceId, current.generation);
      setDraft({ workspaceId: current.workspaceId, settings: value });
      if (current.workspaceId) enqueueStop(current.port, current.workspaceId, current.generation);
    },
    [clearLanguageSettings, enqueueStop, invalidate, stopWatching],
  );
  const query = useCallback(
    async (
      selection?: {
        providerId?: string;
        moduleId: string;
        sourceSetId?: string;
        sourceSetKind?: JavaProjectSourceSetKind;
        sourceRelativePath?: string;
        symbol?: string;
      },
      evaluateGradle = false,
      providerQualificationRefresh = false,
      afterSavedBufferReview = false,
      priorContextOverride?: JavaEffectiveProjectContext,
      aggregateGradleCompositeContext = false,
      requiredFacts?: JavaProjectContextRequest["requiredFacts"],
    ) => {
      const executionSelection = Boolean(selection && afterSavedBufferReview);
      const noteExecutionQuery = (
        status: NonNullable<typeof executionQueryDiagnostic.current>["status"],
        reason: string,
        requestId: string | null = null,
      ) => {
        if (executionSelection) executionQueryDiagnostic.current = { requestId, status, reason };
      };
      const current = latest.current,
        workspace = current.getWorkspaceContext();
      if (
        !current.workspaceId ||
        workspace.workspaceId !== current.workspaceId ||
        workspace.generation !== current.generation ||
        workspace.isSwitching ||
        workspace.isMetadataLoading ||
        busy.current
      ) {
        noteExecutionQuery(
          "not-started",
          "the workspace is unavailable or another synchronization is active",
        );
        return;
      }
      if (
        (observed?.context.schemaVersion === "java-project-context-v6" ||
          observed?.context.schemaVersion === "java-project-context-v7") &&
        observed.context.semanticAnalysis?.availability === "unqualified" &&
        (selection?.symbol !== undefined ||
          requiredFacts?.includes("jpms") === true ||
          (selection?.sourceRelativePath !== undefined &&
            !(
              observed.context.schemaVersion === "java-project-context-v7" &&
              selection.symbol === undefined
            )))
      ) {
        setMessage(
          "Only v7 metadata contexts can identify source-file ownership by path; Java symbol and module analysis remains unavailable.",
        );
        noteExecutionQuery(
          "refused",
          "the selected project context does not qualify semantic analysis",
        );
        return;
      }
      const configured = structuredClone(settingsRef.current);
      if (!configured.sdkHome.trim()) {
        setError("Select a full JDK home before synchronizing the project.");
        noteExecutionQuery("not-started", "a full JDK home is not selected");
        return;
      }
      if (evaluateGradle && !isJavaGradleSettings(configured.gradle)) {
        setError(
          "Select an absolute Gradle executable and valid Gradle settings before evaluating the project.",
        );
        noteExecutionQuery("not-started", "valid Gradle settings are not selected");
        return;
      }
      const token = ++revision.current,
        capturedSignature = JSON.stringify(configured);
      const prior = selection
        ? priorContextOverride
          ? {
              workspaceId: current.workspaceId,
              generation: current.generation,
              signature: capturedSignature,
              context: priorContextOverride,
            }
          : observed
        : null;
      const canAdvancePastReviewedSourceSave = Boolean(selection && afterSavedBufferReview);
      const requestsV7Context = Boolean(
        current.supportsJavaProjectContextV7 &&
        selection?.providerId &&
        selection.moduleId &&
        (selection.sourceSetId !== undefined || selection.sourceSetKind !== undefined),
      );
      const providerScopedContextHash = Boolean(
        prior &&
        (!requestsV7Context || prior.context.schemaVersion === "java-project-context-v7") &&
        (!providerQualificationRefresh ||
          !selection?.providerId ||
          (selection.sourceSetKind !== undefined
            ? prior.context.schemaVersion === "java-project-context-v4" ||
              prior.context.schemaVersion === "java-project-context-v5" ||
              prior.context.schemaVersion === "java-project-context-v6" ||
              prior.context.schemaVersion === "java-project-context-v7"
            : prior.context.schemaVersion === "java-project-context-v3" ||
              prior.context.schemaVersion === "java-project-context-v4" ||
              prior.context.schemaVersion === "java-project-context-v5" ||
              prior.context.schemaVersion === "java-project-context-v6" ||
              prior.context.schemaVersion === "java-project-context-v7")),
      );
      if (
        selection &&
        ((!prior && !canAdvancePastReviewedSourceSave) ||
          (prior &&
            (prior.workspaceId !== current.workspaceId ||
              prior.generation !== current.generation ||
              prior.signature !== capturedSignature)))
      ) {
        noteExecutionQuery(
          "not-started",
          "the selected source set is not bound to the current project context",
        );
        return;
      }
      const request: JavaProjectContextRequest = {
        projectPath: configured.projectPath,
        sdkHome: configured.sdkHome,
        mavenRepository: configured.mavenRepository,
        activeMavenProfiles: configured.activeMavenProfiles,
        inactiveMavenProfiles: configured.inactiveMavenProfiles,
        ...(configured.gradle ? { gradle: configured.gradle } : {}),
        workspaceId: current.workspaceId,
        generation: current.generation,
        requestId: `java-project-${++sequence.current}`,
        ...selection,
        ...(aggregateGradleCompositeContext
          ? { aggregateGradleCompositeContext: true as const }
          : {}),
        ...(requiredFacts ? { requiredFacts } : {}),
        ...(evaluateGradle ? { evaluateGradle: true as const } : {}),
        ...(prior && !canAdvancePastReviewedSourceSave
          ? {
              expectedSnapshotHash: prior.context.snapshotHash,
              ...(providerScopedContextHash
                ? { expectedContextHash: prior.context.contextHash }
                : {}),
            }
          : {}),
      };
      latestQueryRequest.current = { requestId: request.requestId, token };
      noteExecutionQuery("pending", "the provider query is pending", request.requestId);
      const isCurrent = () => {
        const active = latest.current.getWorkspaceContext();
        return (
          revision.current === token &&
          active.workspaceId === request.workspaceId &&
          active.generation === request.generation &&
          !active.isSwitching &&
          !active.isMetadataLoading &&
          JSON.stringify(settingsRef.current) === capturedSignature
        );
      };
      const staleReason = () => {
        if (revision.current !== token) {
          const latestRequest = latestQueryRequest.current;
          if (latestRequest && latestRequest.token !== token)
            return "a newer project-context query superseded this request";
          if (lastInvalidation.current.revision > token)
            return `the project context was invalidated because ${lastInvalidation.current.reason}`;
          return "the project-context revision changed";
        }
        const active = latest.current.getWorkspaceContext();
        if (
          active.workspaceId !== request.workspaceId ||
          active.generation !== request.generation ||
          active.isSwitching
        )
          return "the active workspace changed";
        if (active.isMetadataLoading) return "workspace metadata is still loading";
        if (JSON.stringify(settingsRef.current) !== capturedSignature)
          return "Java Project settings changed";
        return "the active project context changed";
      };
      busy.current = true;
      setBusy(true);
      setError(null);
      setMessage(
        evaluateGradle
          ? "Evaluating Gradle build scripts and synchronizing project metadata…"
          : "Synchronizing saved project inputs…",
      );
      // Retire the old context immediately; a failed synchronization cannot leave it current.
      const stoppingWatch = stopWatching();
      setObserved(null);
      try {
        await stoppingWatch;
        await clearLanguageSettings(current.port, request.workspaceId, request.generation);
        await pendingStop.current;
        if (!isCurrent()) {
          noteExecutionQuery("discarded", staleReason(), request.requestId);
          return;
        }
        const response = await current.port.query(request);
        if (!isCurrent()) {
          noteExecutionQuery("discarded", staleReason(), request.requestId);
          return;
        }
        if (
          response.workspaceId !== request.workspaceId ||
          response.generation !== request.generation ||
          response.requestId !== request.requestId ||
          response.projectPath !== request.projectPath
        )
          throw new Error("The provider returned an uncorrelated project context.");
        if ("context" in response) {
          const needsGradleIdentityQualification = Boolean(
            !selection &&
            current.supportsProviderQualifiedSourceAssociation &&
            response.status === "available" &&
            response.context.modules.some(
              (module) => module.providerId === "gradle-effective-v1",
            ) &&
            !gradleIdentitiesAreQualified(response.context),
          );
          if (needsGradleIdentityQualification) {
            noteExecutionQuery("completed", "the provider context was acquired", request.requestId);
            return response.context;
          }
          let trackingUnavailable = false;
          if (current.port.watch) {
            const watchId = `java-project-watch-${++sequence.current}`;
            try {
              const stop = await current.port.watch(
                { workspaceId: request.workspaceId, generation: request.generation },
                request.projectPath,
                watchId,
                (event) => {
                  if (!isCurrent()) {
                    noteExecutionQuery("discarded", staleReason(), request.requestId);
                    return;
                  }
                  if (event.status === "changed") {
                    invalidate("Java project files changed on disk");
                    busy.current = false;
                    setBusy(false);
                    const clearingLanguageSettings = clearLanguageSettings(
                      current.port,
                      request.workspaceId,
                      request.generation,
                    );
                    setObserved(null);
                    setError(null);
                    setMessage(
                      "Java project files changed on disk. Synchronize the project before using its context again.",
                    );
                    void stopWatching();
                    let mayRefresh = false;
                    try {
                      mayRefresh =
                        event.changeKind === "source" &&
                        latest.current.canRefreshSourceContext !== undefined;
                    } catch {
                      /* Keep the context retired. */
                    }
                    if (mayRefresh) {
                      const refreshRevision = revision.current;
                      const refreshEpoch = sourceRefreshEpoch.current;
                      setMessage("Java source files changed. Refreshing project context…");
                      sourceRefreshTimer.current = setTimeout(() => {
                        sourceRefreshTimer.current = null;
                        void (async () => {
                          await clearingLanguageSettings;
                          const latestWorkspace = latest.current.getWorkspaceContext();
                          if (
                            sourceRefreshEpoch.current !== refreshEpoch ||
                            revision.current !== refreshRevision ||
                            latest.current.port !== current.port ||
                            latestWorkspace.workspaceId !== request.workspaceId ||
                            latestWorkspace.generation !== request.generation ||
                            latestWorkspace.isSwitching ||
                            latestWorkspace.isMetadataLoading ||
                            JSON.stringify(settingsRef.current) !== capturedSignature
                          )
                            return;
                          try {
                            if (latest.current.canRefreshSourceContext?.() !== true) {
                              setMessage(
                                "Java project files changed on disk. Synchronize the project before using its context again.",
                              );
                              return;
                            }
                          } catch {
                            setMessage(
                              "Java project files changed on disk. Synchronize the project before using its context again.",
                            );
                            return;
                          }
                          await refreshSourceContext.current?.();
                        })();
                      }, 300);
                    }
                  } else {
                    trackingUnavailable = true;
                    setMessage(
                      "Project context synchronized, but automatic change tracking is unavailable. Synchronize manually after project changes.",
                    );
                  }
                },
              );
              if (isCurrent()) projectWatch.current = { watchId, stop };
              else stop();
            } catch {
              trackingUnavailable = true;
              if (isCurrent())
                setMessage(
                  "Project context synchronized, but automatic change tracking is unavailable. Synchronize manually after project changes.",
                );
            }
          }
          // Publish the context only after watcher setup settles. Otherwise the
          // language-settings effect can race the watcher fallback and have its
          // explicit JDT LS outcome overwritten by the generic sync message.
          if (!isCurrent()) {
            noteExecutionQuery("discarded", staleReason(), request.requestId);
            return;
          }
          publishedContext.current = { context: response.context, revision: token, workspaceId: request.workspaceId, generation: request.generation, port: current.port };
          setObserved({
            workspaceId: request.workspaceId,
            generation: request.generation,
            signature: capturedSignature,
            context: response.context,
            engineVersion: response.engineVersion,
          });
          setMessage(
            trackingUnavailable
              ? "Project context synchronized, but automatic change tracking is unavailable. Synchronize manually after project changes."
              : response.status === "available"
                ? "Effective Java project context synchronized."
                : "Partial project context. Effective import and analysis are unavailable for this provider.",
          );
          try {
            current.storage?.setItem(
              `java-project-context:${request.workspaceId}`,
              capturedSignature,
            );
          } catch {
            setMessage("Project context loaded; its settings could not be retained.");
          }
          noteExecutionQuery("completed", "the provider context was acquired", request.requestId);
          return response.context;
        } else {
          noteExecutionQuery("refused", response.message, request.requestId);
          const canEvaluateForMetadata =
            response.status === "refused" &&
            response.code === "java.context.sourceLevelUnsupported" &&
            !selection &&
            !evaluateGradle &&
            isJavaGradleSettings(request.gradle);
          setError(response.message);
          let recovery = canEvaluateForMetadata
            ? "Use Evaluate Gradle project to load build metadata."
            : null;
          let recoveryAction: JavaProjectContextController["recoveryAction"];
          if (response.status === "refused" && response.code === "ide.java.context.savedSourceRecoveryRequired"
              && !selection && current.port.recoverSavedSources) {
            setNotice({
              message: "Recover interrupted changes to saved files before synchronizing this project.",
              savedSourceRecovery: {
                workspaceId: request.workspaceId,
                generation: request.generation,
                projectPath: request.projectPath,
                requestId: request.requestId,
              },
            });
            return;
          } else if (response.status === "refused" && response.code === "java.context.compilerOptionsIncomplete") {
            recovery = "Declare the intended Java release or make the source, target and compiler configuration explicit in the build. " +
              (evaluateGradle ? "Then select Evaluate Gradle project again." : "Then select Synchronize project again.");
          } else if (evaluateGradle && response.status === "refused" && response.code === "gradle.sync.exportFailed") {
            const cause = response.gradleFailureCause;
            if (cause === "gradle.sync.cause.offlineDependencyUnavailable") {
              recovery = "In Java Run, trust the workspace and select Prepare Gradle dependencies. This uses network access and the same Gradle user home. Then select Evaluate Gradle project again.";
              recoveryAction = "prepare-gradle";
            } else if (cause === "gradle.sync.cause.offlinePluginResolutionFailed") {
              recovery = "Check the plugin version and plugin repositories in the build. In Java Run, trust the workspace and select Prepare Gradle dependencies. Then select Evaluate Gradle project again.";
              recoveryAction = "prepare-gradle";
            } else if (cause === "gradle.sync.cause.cachePermissionDenied" || cause === "gradle.sync.cause.cacheReadOnly") {
              recovery = "Choose a writable Gradle user home in Java Project, then select Evaluate Gradle project again.";
              recoveryAction = "edit-gradle-user-home";
            } else if (!cause || cause === "gradle.sync.cause.unknown") {
              recovery = "Run Gradle in a trusted shell with the selected settings to see the full error. If dependencies are missing, resolve them with network access in the same Gradle user home, then evaluate again.";
            }
          }
          setMessage(recovery, recoveryAction);
        }
      } catch (failure) {
        noteExecutionQuery(
          "failed",
          failure instanceof Error ? failure.message : "Java project synchronization failed",
          request.requestId,
        );
        if (isCurrent()) {
          setError(
            failure instanceof Error ? failure.message : "Java project synchronization failed.",
          );
          setMessage(null);
        }
      } finally {
        if (isCurrent()) {
          busy.current = false;
          setBusy(false);
        }
      }
    },
    [clearLanguageSettings, invalidate, observed, stopWatching],
  );
  const refuseUnqualifiedGradleContext = useCallback(
    (notice: string) => {
      invalidate("the Gradle project context could not be qualified");
      busy.current = false;
      setBusy(false);
      void stopWatching();
      const current = latest.current;
      void clearLanguageSettings(current.port, current.workspaceId, current.generation);
      setObserved(null);
      setError(notice);
      setMessage(null);
    },
    [clearLanguageSettings, invalidate, stopWatching],
  );
  const synchronizeAggregate = useCallback(
    async (evaluateGradle = false) => {
      const useAggregateGradleContext =
        evaluateGradle && deps.supportsAggregateGradleCompositeIdentity === true;
      const aggregate = await query(
        undefined,
        evaluateGradle,
        false,
        false,
        undefined,
        useAggregateGradleContext,
      );
      if (
        !aggregate ||
        aggregate.status !== "available" ||
        !deps.supportsProviderQualifiedSourceAssociation ||
        gradleIdentitiesAreQualified(aggregate)
      )
        return;
      const module = aggregate.modules.find(
        (candidate) =>
          candidate.providerId === "gradle-effective-v1" && candidate.sourceSets.length > 0,
      );
      const sourceSet =
        module?.sourceSets.find((candidate) => candidate.kind === "main") ?? module?.sourceSets[0];
      if (!module || !sourceSet) {
        refuseUnqualifiedGradleContext(
          "The Gradle provider did not return a selectable source set with build identity.",
        );
        return;
      }
      const qualified = await query(
        {
          providerId: module.providerId,
          moduleId: module.id,
          sourceSetId: sourceSet.id,
        },
        false,
        true,
        false,
        aggregate,
      );
      if (qualified && !gradleIdentitiesAreQualified(qualified))
        refuseUnqualifiedGradleContext(
          "The Gradle provider omitted buildRoot or projectPath for at least one project; composite project selection is unavailable.",
        );
    },
    [
      deps.supportsAggregateGradleCompositeIdentity,
      deps.supportsProviderQualifiedSourceAssociation,
      query,
      refuseUnqualifiedGradleContext,
    ],
  );
  refreshSourceContext.current = () => synchronizeAggregate(false);
  const applyLanguageSettings = useCallback(async () => {
    const published = publishedContext.current;
    const isCurrent = () => {
      const current = latest.current, workspace = current.getWorkspaceContext();
      return published !== null && context !== null &&
        publishedContext.current === published && published.context === context &&
        published.revision === revision.current && published.port === current.port &&
        published.workspaceId === current.workspaceId && published.generation === current.generation &&
        workspace.workspaceId === published.workspaceId && workspace.generation === published.generation &&
        !workspace.isSwitching && !workspace.isMetadataLoading &&
        JSON.stringify(settingsRef.current) === signature;
    };
    if (!context || !published || !published.port.applyLanguageSettings || !isCurrent()) return null;
    const request: JavaProjectLanguageSettingsRequest = {
      workspaceId: published.workspaceId,
      generation: published.generation,
      projectPath: settings.projectPath,
      contextSchemaVersion: context.schemaVersion,
      snapshotHash: context.snapshotHash,
      contextHash: context.contextHash,
    };
    try {
      const result = await published.port.applyLanguageSettings(request);
      if (!isCurrent()) return null;
      if (result.workspaceId !== request.workspaceId || result.generation !== request.generation ||
          result.projectPath !== request.projectPath || result.contextSchemaVersion !== request.contextSchemaVersion ||
          result.contextHash !== request.contextHash || result.snapshotHash !== request.snapshotHash) {
        setError("The language-settings response does not match the synchronized project context. Synchronize again.");
        setMessage(null);
        return null;
      }
      setMessage(result.message);
      return result;
    } catch (failure) {
      if (isCurrent()) {
        setError(typeof failure === "string" ? failure : failure instanceof Error ? failure.message
          : "JDT LS could not apply the verified project compiler settings.");
        setMessage(null);
      }
      return null;
    }
  }, [context, settings.projectPath, signature]);

  const recoverSavedSources = useCallback<
    NonNullable<JavaProjectContextController["recoverSavedSources"]>
  >(async (request, beginWrite, reconcile) => {
      const current = latest.current;
      const observedRevision = revision.current;
      const isCurrent = () => {
        const workspace = latest.current.getWorkspaceContext();
        return latest.current.port === current.port &&
          revision.current === observedRevision &&
          workspace.workspaceId === request.workspaceId &&
          workspace.generation === request.generation &&
          !workspace.isSwitching && !workspace.isMetadataLoading &&
          settingsRef.current.projectPath === request.projectPath;
      };
      if (busy.current || notice?.savedSourceRecovery !== request ||
          !current.port.recoverSavedSources || !isCurrent()) return;
      let release: (() => void) | undefined;
      busy.current = true;
      try {
        release = beginWrite();
        setError(null);
        setMessage("Recovering interrupted changes to saved files…");
        let failure: unknown;
        let recovered = false;
        try {
          await current.port.recoverSavedSources(request);
          recovered = true;
        } catch (error) {
          failure = error;
        }
        if (!isCurrent()) return;
        const warning = await reconcile(isCurrent, recovered).catch(
          () => "The file view could not be refreshed. Compare open buffers with disk before saving.",
        );
        if (!isCurrent()) return;
        if (recovered) {
          setMessage(["Saved-file recovery completed. Synchronize the project again.", warning].filter(Boolean).join(" "));
        } else {
          setError(typeof failure === "string" ? failure : failure instanceof Error
            ? failure.message : "RefactorKit did not confirm saved-file recovery.");
          setNotice({
            message: warning ?? "Inspect the project files before retrying recovery.",
            savedSourceRecovery: request,
          });
        }
      } catch (error) {
        if (isCurrent())
          setError(error instanceof Error ? error.message : "Could not start saved-file recovery.");
      } finally {
        if (isCurrent()) busy.current = false;
        release?.();
      }
    }, [notice?.savedSourceRecovery, setMessage]);

  return {
    settings,
    context,
    engineVersion: context ? observed!.engineVersion : null,
    isBusy,
    error,
    message: notice?.message ?? null,
    recoveryAction: notice?.action,
    savedSourceRecovery: notice?.savedSourceRecovery,
    recoverSavedSources,
    setSettings,
    pauseMonitoring: () => {
      cancelSourceRefresh();
      return stopWatching();
    },
    applyLanguageSettings,
    retireContext: (notice) => {
      invalidate("the editor or another operation retired the project context");
      busy.current = false;
      setBusy(false);
      const current = latest.current;
      void clearLanguageSettings(current.port, current.workspaceId, current.generation);
      setObserved(null);
      setError(null);
      setMessage(notice ?? null);
      void stopWatching();
    },
    synchronize: async (expected) => {
      if (expected) {
        const active = latest.current.getWorkspaceContext();
        if (
          active.workspaceId !== expected.workspaceId ||
          active.generation !== expected.generation ||
          active.isSwitching ||
          active.isMetadataLoading ||
          JSON.stringify(settingsRef.current) !== JSON.stringify(expected.settings)
        )
          return;
      }
      await synchronizeAggregate();
    },
    reviewForSourceNavigation: async (expected) => {
      const captured = latest.current.getWorkspaceContext();
      const expectedSignature = JSON.stringify(expected);
      const sameWorkspaceAndSettings = () => {
        const active = latest.current.getWorkspaceContext();
        return (
          active.workspaceId === captured.workspaceId &&
          active.generation === captured.generation &&
          !active.isSwitching &&
          !active.isMetadataLoading &&
          JSON.stringify(settingsRef.current) === expectedSignature
        );
      };
      if (!sameWorkspaceAndSettings())
        throw new Error("Java Project settings changed before source navigation.");
      // A fresh aggregate locates selectable provider IDs even after test execution
      // retired the prior context. Qualified acquisition supplies workspace paths.
      const aggregate = await query(undefined, false, true, true);
      if (!sameWorkspaceAndSettings() || !aggregate || aggregate.status !== "available")
        throw new Error(
          "Synchronize Java Project before opening a compiled test declaration; Gradle evaluation must be explicit.",
        );
      const module = aggregate.modules.find((candidate) => candidate.sourceSets.length > 0);
      const sourceSet =
        module?.sourceSets.find((candidate) => candidate.kind === "test") ?? module?.sourceSets[0];
      if (!module || !sourceSet)
        throw new Error("The provider returned no selectable Java source set.");
      const fresh = await query(
        { providerId: module.providerId, moduleId: module.id, sourceSetId: sourceSet.id },
        false,
        true,
        true,
      );
      const published = publishedContext.current;
      const isCurrent = () =>
        sameWorkspaceAndSettings() &&
        !busy.current &&
        published !== null &&
        publishedContext.current === published &&
        published.revision === revision.current;
      if (!fresh || fresh.status !== "available" || published?.context !== fresh || !isCurrent())
        throw new Error("The Java Project context changed while acquiring test source ownership.");
      return { context: fresh, isCurrent };
    },
    refreshForExecution: async (expected, selection, options) => {
      if (JSON.stringify(expected) !== JSON.stringify(settingsRef.current))
        throw new Error("The Java Project settings changed before execution.");
      if (
        selection &&
        Number(selection.sourceSetId !== undefined) +
          Number(selection.sourceSetKind !== undefined) !==
          1
      )
        throw new Error("Select exactly one provider-owned Java source set.");
      const qualifiedSelection = selection
        ? {
            ...((options?.afterSavedBufferReview === true ||
              options?.requiredFacts?.includes("jpms") === true ||
              context?.schemaVersion === "java-project-context-v3" ||
              context?.schemaVersion === "java-project-context-v4" ||
              context?.schemaVersion === "java-project-context-v5" ||
              context?.schemaVersion === "java-project-context-v6" ||
              context?.schemaVersion === "java-project-context-v7" ||
              deps.supportsProviderQualifiedSourceAssociation) &&
            selection.providerId
              ? { providerId: selection.providerId }
              : {}),
            moduleId: selection.moduleId,
            ...(selection.sourceSetKind !== undefined
              ? { sourceSetKind: selection.sourceSetKind }
              : { sourceSetId: selection.sourceSetId }),
          }
        : undefined;
      const invalidationBeforeRefresh = lastInvalidation.current.revision;
      const acquireExecutionContext = () =>
        query(
          qualifiedSelection,
          false,
          true,
          options?.afterSavedBufferReview === true,
          undefined,
          false,
          options?.requiredFacts,
        );
      let fresh = await acquireExecutionContext();
      if (!fresh && options?.afterSavedBufferReview === true) {
        const workspace = latest.current.getWorkspaceContext();
        if (
          JSON.stringify(expected) === JSON.stringify(settingsRef.current) &&
          workspace.workspaceId === latest.current.workspaceId &&
          workspace.generation === latest.current.generation &&
          !workspace.isSwitching &&
          !workspace.isMetadataLoading &&
          !busy.current
        )
          fresh = await acquireExecutionContext();
      }
      const active = latest.current.getWorkspaceContext();
      if (
        !fresh ||
        fresh.status !== "available" ||
        JSON.stringify(expected) !== JSON.stringify(settingsRef.current)
      ) {
        const reason =
          JSON.stringify(expected) !== JSON.stringify(settingsRef.current)
            ? "Java Project settings changed during refresh."
            : active.isSwitching ||
                active.workspaceId !== latest.current.workspaceId ||
                active.generation !== latest.current.generation
              ? "The active workspace changed during refresh."
              : active.isMetadataLoading
                ? "Workspace metadata is still loading."
                : busy.current
                  ? "Another Java Project synchronization is still in progress."
                  : !fresh &&
                      executionQueryDiagnostic.current &&
                      executionQueryDiagnostic.current.status !== "completed" &&
                      executionQueryDiagnostic.current.status !== "pending"
                    ? `The execution project-context query did not complete because ${executionQueryDiagnostic.current.reason}.`
                    : lastInvalidation.current.revision > invalidationBeforeRefresh
                      ? `The context refresh was invalidated because ${lastInvalidation.current.reason}.`
                      : !fresh
                        ? "The project-context query did not complete."
                        : "The provider returned partial project context.";
        throw new Error(
          `An available project context is required. ${reason} Synchronize Java Project; Gradle evaluation must be explicit.`,
        );
      }
      return fresh;
    },
    evaluateGradle: async () => {
      await synchronizeAggregate(true);
    },
    inspectSource: async (providerId, moduleId, sourceSetId, path, symbol) => {
      const semanticAnalysisUnqualified =
        (observed?.context.schemaVersion === "java-project-context-v6" ||
          observed?.context.schemaVersion === "java-project-context-v7") &&
        observed.context.semanticAnalysis?.availability === "unqualified";
      const v7OwnerOnlyPathSelection =
        observed?.context.schemaVersion === "java-project-context-v7" &&
        Boolean(path?.trim()) &&
        !symbol?.trim();
      if (semanticAnalysisUnqualified && !v7OwnerOnlyPathSelection) {
        setMessage(
          observed?.context.schemaVersion === "java-project-context-v7"
            ? "This context can identify source-file ownership by path, but Java symbol analysis is unavailable."
            : "Source-file ownership and Java analysis are unavailable for this metadata-only context.",
        );
        return;
      }
      const priorJpms = observed?.context.modules
        .find(
          (module) => module.id === moduleId && (!providerId || module.providerId === providerId),
        )
        ?.sourceSets.find((sourceSet) => sourceSet.id === sourceSetId)?.jpms;
      await query(
        {
          ...(providerId ? { providerId } : {}),
          moduleId,
          sourceSetId,
          ...(path ? { sourceRelativePath: path } : {}),
          ...(symbol ? { symbol } : {}),
        },
        false,
        false,
        false,
        undefined,
        false,
        !semanticAnalysisUnqualified && priorJpms?.availability === "complete"
          ? ["jpms"]
          : undefined,
      );
    },
    inspectJpms: async (providerId, moduleId, sourceSetId) => {
      if (
        (observed?.context.schemaVersion === "java-project-context-v6" ||
          observed?.context.schemaVersion === "java-project-context-v7") &&
        observed.context.semanticAnalysis?.availability === "unqualified"
      ) {
        setMessage("Java module descriptor analysis is unavailable for this project context.");
        return;
      }
      await query(
        { ...(providerId ? { providerId } : {}), moduleId, sourceSetId },
        false,
        true,
        false,
        undefined,
        false,
        ["jpms"],
      );
    },
    inspectMavenTestJvm: deps.supportsJavaProjectContextV7
      ? async (moduleId, sourceSetId) => {
          await query({ providerId: "maven-effective-v1", moduleId, sourceSetId }, false, true);
        }
      : undefined,
    cancel,
  };
}
