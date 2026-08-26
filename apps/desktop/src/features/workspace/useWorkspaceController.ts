import type { WorkspaceInfo, WorkspaceRegistry } from "@ide/contracts";
import type { WorkspacePort } from "@ide/web-core/ports";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { RefactorKitStatusWorkspaceCollaborator } from "../refactorkit-status/useRefactorKitStatusController";
import type {
  Xcom2ModuleActivationWorkspaceCollaborator,
  Xcom2ModuleActivationWorkspaceSwitchToken,
} from "../xcom2-module-activation/useXcom2ModuleActivationController";

const INITIAL_WORKSPACE_GENERATION = 1;
const INITIAL_ACTIVATION_ERROR = "Unable to activate the current workspace.";
const INITIAL_REGISTRY_ERROR = "Unable to load the workspace registry.";

export type WorkspaceGeneration = number;

export type WorkspaceXcomSwitchToken = {
  generation: number;
  previousWorkspaceId: string | null;
};

export interface WorkspaceControllerCollaborators {
  editor: {
    resetWorkspace(): void;
    restoreWorkspace?(): Promise<void>;
  };
  java: {
    detach(nextWorkspaceGeneration: WorkspaceGeneration): Promise<void>;
    attach(workspace: WorkspaceInfo, workspaceGeneration: WorkspaceGeneration): void;
    load(workspaceId: string, workspaceGeneration: WorkspaceGeneration): Promise<void>;
  };
  refactorKitImport: {
    resetWorkspace(): void;
  };
  javaRefactoring: {
    resetWorkspace(): void;
  };
  refactorKitStatus: RefactorKitStatusWorkspaceCollaborator;
  semanticSymbols?: {
    /** Stops and invalidates the old saved-snapshot session before authorization changes. */
    resetWorkspace(nextWorkspaceGeneration: WorkspaceGeneration): Promise<void>;
  };
  xcom2ModuleActivation: Xcom2ModuleActivationWorkspaceCollaborator;
  xcom: {
    beginWorkspaceSwitch(workspaceGeneration: WorkspaceGeneration): WorkspaceXcomSwitchToken;
    activateWorkspace(workspace: WorkspaceInfo): void;
    loadWorkspace(token: WorkspaceXcomSwitchToken, workspaceId: string): Promise<void>;
    restoreWorkspace(token: WorkspaceXcomSwitchToken): void;
    settleFailedWorkspaceActivation?(token: WorkspaceXcomSwitchToken): void;
  };
  ai: {
    beginWorkspaceSwitch(): void;
    activateWorkspace(workspace: WorkspaceInfo): string;
    loadCommands(workspaceKey: string): Promise<void>;
  };
  shell: {
    clearClosedPreviews(): void;
    resetTerminal(): void;
    loadFileTree(): Promise<void>;
  };
}

export interface UseWorkspaceControllerDependencies {
  workspace: WorkspacePort | null | undefined;
  collaboratorsRef: MutableRefObject<WorkspaceControllerCollaborators | null>;
}

export interface WorkspaceContextSnapshot {
  generation: WorkspaceGeneration;
  workspaceId: string | null;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}

export interface WorkspaceController {
  workspaceInfo: WorkspaceInfo | null;
  workspaceRegistry: WorkspaceRegistry | null;
  isLoading: boolean;
  switchingWorkspaceId: string | null;
  error: string | null;
  generation: WorkspaceGeneration;
  currentWorkspaceId: string | null;
  /** Metadata-only refresh used by passive coordinators such as Settings open. */
  refresh(): Promise<void>;
  /** Explicit user refresh of metadata, file tree, and project activation. */
  refreshWorkspace(): Promise<void>;
  switchWorkspace(workspaceId: string): Promise<void>;
  getGeneration(): WorkspaceGeneration;
  getContext(): WorkspaceContextSnapshot;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function nextGeneration(current: WorkspaceGeneration): WorkspaceGeneration {
  if (!Number.isSafeInteger(current) || current < INITIAL_WORKSPACE_GENERATION) {
    return INITIAL_WORKSPACE_GENERATION;
  }
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new Error("Workspace generation exhausted");
  }
  return current + 1;
}

/** Make authorization evidence authoritative over a possibly stale registry read. */
function promoteWorkspaceRegistry(
  registry: WorkspaceRegistry | null,
  workspace: WorkspaceInfo,
): WorkspaceRegistry {
  const workspaces = registry?.workspaces ?? [];
  const existingIndex = workspaces.findIndex((candidate) => candidate.id === workspace.id);
  const promotedWorkspaces = [...workspaces];
  if (existingIndex >= 0) promotedWorkspaces[existingIndex] = workspace;
  else promotedWorkspaces.push(workspace);

  return {
    ...(registry ?? {}),
    workspaces: promotedWorkspaces,
    currentWorkspaceId: workspace.id,
  };
}

/**
 * Application-layer owner of workspace registry metadata, the authorized active root,
 * and the generation boundary used to invalidate dependent bounded contexts.
 */
export function useWorkspaceController(
  dependencies: UseWorkspaceControllerDependencies,
): WorkspaceController {
  const workspaceInfoRef = useRef<WorkspaceInfo | null>(null);
  const workspaceRegistryRef = useRef<WorkspaceRegistry | null>(null);
  const metadataRequestRef = useRef(0);
  const fullRefreshRequestRef = useRef(0);
  const activeFullRefreshRef = useRef<number | null>(null);
  const initialActivationRef = useRef(0);
  const initialActivationStartedRef = useRef(false);
  const fileTreeLoadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const metadataLoadingRef = useRef(true);
  const loadingRef = useRef(true);
  const switchingRef = useRef(true);
  const generationRef = useRef<WorkspaceGeneration>(INITIAL_WORKSPACE_GENERATION);

  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [workspaceRegistry, setWorkspaceRegistry] = useState<WorkspaceRegistry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<WorkspaceGeneration>(INITIAL_WORKSPACE_GENERATION);

  const setLoading = useCallback((loading: boolean): void => {
    loadingRef.current = loading;
    setIsLoading(loading);
  }, []);

  const loadFileTree = useCallback((load: () => Promise<void>): Promise<void> => {
    const operation = fileTreeLoadQueueRef.current.then(load);
    fileTreeLoadQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = metadataRequestRef.current + 1;
    metadataRequestRef.current = requestId;
    metadataLoadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (!dependencies.workspace) {
        setError("Workspace adapter unavailable");
        return;
      }

      const [workspaceResult, registryResult] = await Promise.allSettled([
        dependencies.workspace.ensureCurrentWorkspace(),
        dependencies.workspace.listWorkspaces(),
      ]);

      if (metadataRequestRef.current !== requestId) return;

      const errors: string[] = [];
      if (workspaceResult.status === "fulfilled") {
        workspaceInfoRef.current = workspaceResult.value;
        setWorkspaceInfo(workspaceResult.value);
      } else {
        errors.push(`current workspace: ${getErrorMessage(workspaceResult.reason)}`);
        console.error("[Workspace] Failed to ensure current workspace", {
          errorType: getErrorType(workspaceResult.reason),
        });
      }

      if (registryResult.status === "fulfilled") {
        workspaceRegistryRef.current = registryResult.value;
        setWorkspaceRegistry(registryResult.value);
      } else {
        errors.push(`workspace registry: ${getErrorMessage(registryResult.reason)}`);
        console.error("[Workspace] Failed to list workspace registry", {
          errorType: getErrorType(registryResult.reason),
        });
      }

      setError(errors.length > 0 ? errors.join("; ") : null);
    } catch (refreshError) {
      if (metadataRequestRef.current !== requestId) return;
      setError(getErrorMessage(refreshError));
      console.error("[Workspace] Failed to load workspace metadata", {
        errorType: getErrorType(refreshError),
      });
    } finally {
      if (metadataRequestRef.current === requestId) {
        metadataLoadingRef.current = false;
        if (activeFullRefreshRef.current === null) setLoading(false);
      }
    }
  }, [dependencies.workspace, setLoading]);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    const collaborators = dependencies.collaboratorsRef.current;
    const activeWorkspace = workspaceInfoRef.current;
    if (!dependencies.workspace || !collaborators || !activeWorkspace) {
      const message = !dependencies.workspace
        ? "Workspace adapter unavailable"
        : !collaborators
          ? "Workspace collaborators unavailable"
          : "Current workspace unavailable";
      setError(message);
      throw new Error(message);
    }

    const requestId = fullRefreshRequestRef.current + 1;
    fullRefreshRequestRef.current = requestId;
    activeFullRefreshRef.current = requestId;
    const workspaceGeneration = generationRef.current;
    setLoading(true);
    setError(null);

    // The project contribution is revoked synchronously before metadata or filesystem I/O.
    const projectActivation = collaborators.xcom2ModuleActivation.refreshWorkspace(
      workspaceGeneration,
      activeWorkspace.id,
    );

    try {
      await Promise.all([
        refresh(),
        loadFileTree(collaborators.shell.loadFileTree),
        projectActivation,
      ]);
    } catch (refreshError) {
      if (
        fullRefreshRequestRef.current !== requestId ||
        generationRef.current !== workspaceGeneration
      ) {
        return;
      }
      setError(getErrorMessage(refreshError));
      collaborators.xcom2ModuleActivation.settleFailedWorkspaceRefresh(
        workspaceGeneration,
        activeWorkspace.id,
      );
      console.error("[Workspace] Failed explicit workspace refresh", {
        errorType: getErrorType(refreshError),
      });
      throw refreshError;
    } finally {
      if (
        activeFullRefreshRef.current === requestId &&
        fullRefreshRequestRef.current === requestId &&
        generationRef.current === workspaceGeneration
      ) {
        activeFullRefreshRef.current = null;
        setLoading(false);
      }
    }
  }, [dependencies.collaboratorsRef, dependencies.workspace, loadFileTree, refresh, setLoading]);

  const getGeneration = useCallback((): WorkspaceGeneration => generationRef.current, []);

  const getContext = useCallback(
    (): WorkspaceContextSnapshot => ({
      generation: generationRef.current,
      workspaceId:
        workspaceInfoRef.current?.id ?? workspaceRegistryRef.current?.currentWorkspaceId ?? null,
      isSwitching: switchingRef.current || loadingRef.current,
      isMetadataLoading: metadataLoadingRef.current,
    }),
    [],
  );

  const activateInitialWorkspace = useCallback(async (): Promise<void> => {
    if (initialActivationStartedRef.current) return;
    initialActivationStartedRef.current = true;

    const activationId = initialActivationRef.current + 1;
    initialActivationRef.current = activationId;
    const workspaceGeneration = generationRef.current;
    metadataLoadingRef.current = true;
    switchingRef.current = true;
    setLoading(true);
    setError(null);

    const isCurrent = (): boolean =>
      initialActivationRef.current === activationId &&
      generationRef.current === workspaceGeneration;

    let xcom2ModuleActivationToken: Xcom2ModuleActivationWorkspaceSwitchToken | null = null;
    let xcomToken: WorkspaceXcomSwitchToken | null = null;
    let refactorKitStatusGeneration: number | null = null;

    try {
      if (!dependencies.workspace) throw new Error("Workspace adapter unavailable");
      const collaborators = dependencies.collaboratorsRef.current;
      if (!collaborators) throw new Error("Workspace collaborators unavailable");

      // This is the authorization transition. No registry or dependent native read may overtake it.
      const ensuredWorkspace = await dependencies.workspace.ensureCurrentWorkspace();
      if (!isCurrent()) return;

      let registryWarning: string | null = null;
      let listedRegistry: WorkspaceRegistry | null = null;
      try {
        listedRegistry = await dependencies.workspace.listWorkspaces();
      } catch (registryError) {
        if (!isCurrent()) return;
        registryWarning = INITIAL_REGISTRY_ERROR;
        console.error("[Workspace] Failed to list workspace registry during initial activation", {
          errorType: getErrorType(registryError),
        });
      }
      if (!isCurrent()) return;

      // Native authorization is stronger evidence than a stale/empty registry snapshot.
      const promotedRegistry = promoteWorkspaceRegistry(
        listedRegistry ?? workspaceRegistryRef.current,
        ensuredWorkspace,
      );
      workspaceInfoRef.current = ensuredWorkspace;
      workspaceRegistryRef.current = promotedRegistry;
      setWorkspaceInfo(ensuredWorkspace);
      setWorkspaceRegistry(promotedRegistry);

      // Establish the shared generation boundary only after authorization and registry promotion.
      xcom2ModuleActivationToken =
        collaborators.xcom2ModuleActivation.beginWorkspaceSwitch(workspaceGeneration);
      xcomToken = collaborators.xcom.beginWorkspaceSwitch(workspaceGeneration);
      refactorKitStatusGeneration =
        collaborators.refactorKitStatus.beginWorkspaceSwitch(workspaceGeneration);
      collaborators.ai.beginWorkspaceSwitch();
      collaborators.xcom2ModuleActivation.activateWorkspace(ensuredWorkspace);
      collaborators.xcom.activateWorkspace(ensuredWorkspace);
      collaborators.java.attach(ensuredWorkspace, workspaceGeneration);
      const workspaceKey = collaborators.ai.activateWorkspace(ensuredWorkspace);
      const resetSemanticSymbols =
        collaborators.semanticSymbols?.resetWorkspace(workspaceGeneration) ?? Promise.resolve();

      await Promise.all([
        resetSemanticSymbols,
        ...(collaborators.editor.restoreWorkspace ? [collaborators.editor.restoreWorkspace()] : []),
        loadFileTree(collaborators.shell.loadFileTree),
        collaborators.java.load(ensuredWorkspace.id, workspaceGeneration),
        collaborators.ai.loadCommands(workspaceKey),
        collaborators.refactorKitStatus.load(refactorKitStatusGeneration),
        collaborators.xcom2ModuleActivation.loadWorkspace(
          xcom2ModuleActivationToken,
          ensuredWorkspace.id,
        ),
        collaborators.xcom.loadWorkspace(xcomToken, ensuredWorkspace.id),
      ]);
      if (!isCurrent()) return;
      setError(registryWarning);
    } catch (activationError) {
      if (!isCurrent()) return;
      setError(INITIAL_ACTIVATION_ERROR);
      if (xcom2ModuleActivationToken) {
        dependencies.collaboratorsRef.current?.xcom2ModuleActivation.settleFailedWorkspaceActivation(
          xcom2ModuleActivationToken,
        );
      }
      if (xcomToken) {
        dependencies.collaboratorsRef.current?.xcom.settleFailedWorkspaceActivation?.(xcomToken);
      }
      if (refactorKitStatusGeneration !== null) {
        dependencies.collaboratorsRef.current?.refactorKitStatus.settleFailedWorkspaceSwitch(
          refactorKitStatusGeneration,
        );
      }
      console.error("[Workspace] Failed initial workspace activation", {
        errorType: getErrorType(activationError),
      });
    } finally {
      if (isCurrent()) {
        metadataLoadingRef.current = false;
        switchingRef.current = false;
        setLoading(false);
      }
    }
  }, [dependencies.collaboratorsRef, dependencies.workspace, loadFileTree, setLoading]);

  const switchWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (!dependencies.workspace) {
        const message = "Workspace adapter unavailable";
        setError(message);
        throw new Error(message);
      }

      const collaborators = dependencies.collaboratorsRef.current;
      if (!collaborators) {
        const message = "Workspace collaborators unavailable";
        setError(message);
        throw new Error(message);
      }

      // A user transition owns all subsequent completion; older cold starts and refreshes are stale.
      initialActivationRef.current += 1;
      fullRefreshRequestRef.current += 1;
      activeFullRefreshRef.current = null;
      const oldWorkspace = workspaceInfoRef.current;
      const workspaceGeneration = nextGeneration(generationRef.current);
      generationRef.current = workspaceGeneration;
      setGeneration(workspaceGeneration);
      switchingRef.current = true;
      // Revoke recognized module contributions synchronously, before any native root transition.
      const xcom2ModuleActivationToken =
        collaborators.xcom2ModuleActivation.beginWorkspaceSwitch(workspaceGeneration);
      collaborators.editor.resetWorkspace();
      collaborators.refactorKitImport.resetWorkspace();
      collaborators.javaRefactoring.resetWorkspace();

      const javaDetach = collaborators.java.detach(workspaceGeneration);
      const semanticSymbolsReset =
        collaborators.semanticSymbols?.resetWorkspace(workspaceGeneration) ?? Promise.resolve();
      const xcomToken = collaborators.xcom.beginWorkspaceSwitch(workspaceGeneration);
      const refactorKitStatusGeneration =
        collaborators.refactorKitStatus.beginWorkspaceSwitch(workspaceGeneration);
      collaborators.ai.beginWorkspaceSwitch();
      setLoading(true);
      setSwitchingWorkspaceId(workspaceId);
      setError(null);

      try {
        // Both old language processes must settle before native workspace authorization changes.
        await Promise.all([javaDetach, semanticSymbolsReset]);
        if (generationRef.current !== workspaceGeneration) return;

        const switchedWorkspace = await dependencies.workspace.switchWorkspace(workspaceId);
        if (generationRef.current !== workspaceGeneration) return;

        workspaceInfoRef.current = switchedWorkspace;
        setWorkspaceInfo(switchedWorkspace);
        collaborators.xcom2ModuleActivation.activateWorkspace(switchedWorkspace);
        collaborators.xcom.activateWorkspace(switchedWorkspace);
        collaborators.java.attach(switchedWorkspace, workspaceGeneration);
        const switchedWorkspaceKey = collaborators.ai.activateWorkspace(switchedWorkspace);

        collaborators.shell.clearClosedPreviews();
        collaborators.shell.resetTerminal();

        await Promise.all([
          refresh(),
          loadFileTree(collaborators.shell.loadFileTree),
          collaborators.ai.loadCommands(switchedWorkspaceKey),
          collaborators.refactorKitStatus.load(refactorKitStatusGeneration),
          collaborators.java.load(switchedWorkspace.id, workspaceGeneration),
          collaborators.xcom2ModuleActivation.loadWorkspace(
            xcom2ModuleActivationToken,
            switchedWorkspace.id,
          ),
          collaborators.xcom.loadWorkspace(xcomToken, switchedWorkspace.id),
        ]);
      } catch (switchError) {
        if (generationRef.current !== workspaceGeneration) return;
        setError(getErrorMessage(switchError));
        collaborators.xcom2ModuleActivation.restoreWorkspace(xcom2ModuleActivationToken);
        collaborators.xcom.restoreWorkspace(xcomToken);
        collaborators.refactorKitStatus.settleFailedWorkspaceSwitch(refactorKitStatusGeneration);
        if (oldWorkspace) {
          collaborators.java.attach(oldWorkspace, workspaceGeneration);
          void collaborators.java.load(oldWorkspace.id, workspaceGeneration);
        }
        console.error("[Workspace] Failed to switch workspace", {
          errorType: getErrorType(switchError),
        });
        throw switchError;
      } finally {
        if (generationRef.current === workspaceGeneration) {
          switchingRef.current = false;
          setLoading(false);
          setSwitchingWorkspaceId(null);
        }
      }
    },
    [dependencies.collaboratorsRef, dependencies.workspace, loadFileTree, refresh, setLoading],
  );

  useEffect(() => {
    void activateInitialWorkspace();
  }, [activateInitialWorkspace]);

  return {
    workspaceInfo,
    workspaceRegistry,
    isLoading,
    switchingWorkspaceId,
    error,
    generation,
    currentWorkspaceId: workspaceInfo?.id ?? workspaceRegistry?.currentWorkspaceId ?? null,
    refresh,
    refreshWorkspace,
    switchWorkspace,
    getGeneration,
    getContext,
  };
}
