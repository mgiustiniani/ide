import {
  XCOM2_MODULE_SCAN_LIMITS,
  type WorkspaceInfo,
  type Xcom2ModuleActivationDecision,
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleConfigurationReadResult,
  type Xcom2ModuleScanCorrelation,
  type Xcom2ModuleScanRequest,
  type Xcom2ProjectActivationDecision,
  type Xcom2ProjectActivationSnapshot,
} from "@ide/contracts";
import {
  evaluateXcom2ModuleActivation,
  evaluateXcom2ProjectActivation,
  selectActiveXcom2ModuleDecisions,
} from "@ide/web-core";
import type { Xcom2ModuleConfigurationPort, Xcom2ModuleScannerPort } from "@ide/web-core/ports";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const INITIAL_WORKSPACE_GENERATION = 1;
const SCAN_ID_PREFIX = "xcom2-module-scan:";
const CONFIGURATION_READ_ID_PREFIX = "xcom2-configuration-read:";
const SCAN_ERROR = "Unable to recognize XCOM 2 modules in the current workspace.";
const CONFIGURATION_ERROR = "Unable to read XCOM 2 module configuration in the current workspace.";
const NO_ACTIVE_MODULES = Object.freeze([] as readonly Readonly<Xcom2ModuleActivationDecision>[]);
const NO_ACTIVE_PROJECTS = Object.freeze([] as readonly Readonly<Xcom2ProjectActivationDecision>[]);

export interface Xcom2ModuleActivationWorkspaceSwitchToken {
  readonly generation: number;
  readonly previousWorkspaceId: string | null;
}

export interface Xcom2ModuleActivationWorkspaceCollaborator {
  beginWorkspaceSwitch(workspaceGeneration: number): Xcom2ModuleActivationWorkspaceSwitchToken;
  activateWorkspace(workspace: WorkspaceInfo): void;
  loadWorkspace(
    token: Xcom2ModuleActivationWorkspaceSwitchToken,
    workspaceId: string,
  ): Promise<void>;
  /** Explicit user refresh. Revocation happens before this method returns its promise. */
  refreshWorkspace(workspaceGeneration: number, workspaceId: string): Promise<void>;
  restoreWorkspace(token: Xcom2ModuleActivationWorkspaceSwitchToken): void;
  settleFailedWorkspaceActivation(token: Xcom2ModuleActivationWorkspaceSwitchToken): void;
}

export interface UseXcom2ModuleActivationControllerDependencies {
  scanner: Pick<Xcom2ModuleScannerPort, "scan">;
  configuration: Pick<Xcom2ModuleConfigurationPort, "read">;
}

export interface Xcom2ModuleActivationController {
  /** Legacy convention-recognition projection retained for the current UI owner. */
  snapshot: Readonly<Xcom2ModuleActivationSnapshot> | null;
  /** Legacy convention-recognition projection retained for the current UI owner. */
  activeModules: readonly Readonly<Xcom2ModuleActivationDecision>[];
  projectSnapshot: Readonly<Xcom2ProjectActivationSnapshot> | null;
  activeProjectDecisions: readonly Readonly<Xcom2ProjectActivationDecision>[];
  isScanning: boolean;
  error: string | null;
  refreshWorkspace(workspaceGeneration: number, workspaceId: string): Promise<void>;
  workspaceCollaborator: Xcom2ModuleActivationWorkspaceCollaborator;
}

interface ActivationAuthority {
  readonly token: Xcom2ModuleActivationWorkspaceSwitchToken;
  readonly scanRequest: Readonly<Xcom2ModuleScanRequest>;
  readonly configurationRequest: Readonly<Xcom2ModuleConfigurationReadRequest>;
}

interface SwitchState {
  readonly token: Xcom2ModuleActivationWorkspaceSwitchToken;
  readonly previousSnapshot: Readonly<Xcom2ModuleActivationSnapshot> | null;
  readonly previousProjectSnapshot: Readonly<Xcom2ProjectActivationSnapshot> | null;
  started: boolean;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function invokeSafely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

function nextGeneration(current: number, label: string): number {
  if (!Number.isSafeInteger(current) || current < 0) return 1;
  if (current === Number.MAX_SAFE_INTEGER) throw new Error(`${label} exhausted`);
  return current + 1;
}

function exactlyMatchesScan(
  snapshot: Readonly<Xcom2ModuleScanCorrelation>,
  request: Readonly<Xcom2ModuleScanRequest>,
): boolean {
  return (
    snapshot.workspaceId === request.workspaceId &&
    snapshot.workspaceGeneration === request.workspaceGeneration &&
    snapshot.scanId === request.scanId &&
    snapshot.scanGeneration === request.scanGeneration
  );
}

function exactlyMatchesConfiguration(
  result: Readonly<Xcom2ModuleConfigurationReadResult>,
  request: Readonly<Xcom2ModuleConfigurationReadRequest>,
): boolean {
  return (
    result.workspaceId === request.workspaceId &&
    result.workspaceGeneration === request.workspaceGeneration &&
    result.activationGeneration === request.activationGeneration &&
    result.configurationReadId === request.configurationReadId
  );
}

function projectMatchesRecognition(
  project: Readonly<Xcom2ProjectActivationSnapshot>,
  recognition: Readonly<Xcom2ModuleActivationSnapshot>,
): boolean {
  return (
    project.workspaceId === recognition.workspaceId &&
    project.workspaceGeneration === recognition.workspaceGeneration &&
    project.scanId === recognition.scanId &&
    project.scanGeneration === recognition.scanGeneration
  );
}

/**
 * Owns one-shot configured and convention-based XCOM 2 project activation. Native
 * results have no authority unless their identity and every correlation field still
 * match the current activation object.
 */
export function useXcom2ModuleActivationController(
  dependencies: UseXcom2ModuleActivationControllerDependencies,
): Xcom2ModuleActivationController {
  const mountedRef = useRef(true);
  const workspaceGenerationRef = useRef(INITIAL_WORKSPACE_GENERATION);
  const workspaceIdRef = useRef<string | null>(null);
  const activationGenerationRef = useRef(0);
  const scanGenerationRef = useRef(0);
  const currentActivationRef = useRef<ActivationAuthority | null>(null);
  const switchStateRef = useRef<SwitchState | null>(null);
  const committedSnapshotRef = useRef<Readonly<Xcom2ModuleActivationSnapshot> | null>(null);
  const committedProjectSnapshotRef = useRef<Readonly<Xcom2ProjectActivationSnapshot> | null>(null);

  const [snapshot, setSnapshot] = useState<Readonly<Xcom2ModuleActivationSnapshot> | null>(null);
  const [projectSnapshot, setProjectSnapshot] =
    useState<Readonly<Xcom2ProjectActivationSnapshot> | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = useCallback((): void => {
    currentActivationRef.current = null;
    setSnapshot(null);
    setProjectSnapshot(null);
    setIsScanning(false);
    setError(null);
  }, []);

  const beginWorkspaceSwitch = useCallback(
    (workspaceGeneration: number): Xcom2ModuleActivationWorkspaceSwitchToken => {
      const previousWorkspaceId = workspaceIdRef.current;
      const token = Object.freeze({ generation: workspaceGeneration, previousWorkspaceId });

      workspaceGenerationRef.current = workspaceGeneration;
      workspaceIdRef.current = null;
      switchStateRef.current = {
        token,
        previousSnapshot: committedSnapshotRef.current,
        previousProjectSnapshot: committedProjectSnapshotRef.current,
        started: false,
      };

      // Revocation is synchronous: no old contribution survives native root activation.
      revoke();
      return token;
    },
    [revoke],
  );

  const activateWorkspace = useCallback((workspace: WorkspaceInfo): void => {
    workspaceIdRef.current = workspace.id;
  }, []);

  const runActivation = useCallback(
    async (
      token: Xcom2ModuleActivationWorkspaceSwitchToken,
      workspaceId: string,
    ): Promise<void> => {
      const switchState = switchStateRef.current;
      if (
        !mountedRef.current ||
        switchState?.token !== token ||
        switchState.started ||
        workspaceGenerationRef.current !== token.generation ||
        workspaceIdRef.current !== workspaceId
      ) {
        return;
      }
      switchState.started = true;

      let activationGeneration: number;
      let scanGeneration: number;
      try {
        activationGeneration = nextGeneration(
          activationGenerationRef.current,
          "XCOM 2 activation generation",
        );
        scanGeneration = nextGeneration(scanGenerationRef.current, "XCOM 2 scan generation");
      } catch (startError) {
        if (mountedRef.current && switchStateRef.current?.token === token) {
          setError(SCAN_ERROR);
          setIsScanning(false);
          console.error("[Xcom2ModuleActivation] Failed to start project activation", {
            errorType: getErrorType(startError),
          });
        }
        return;
      }
      activationGenerationRef.current = activationGeneration;
      scanGenerationRef.current = scanGeneration;

      const scanRequest = Object.freeze({
        workspaceId,
        workspaceGeneration: token.generation,
        scanId: `${SCAN_ID_PREFIX}${scanGeneration}`,
        scanGeneration,
        limits: Object.freeze({
          maximumDepth: XCOM2_MODULE_SCAN_LIMITS.maximumDepth,
          maximumEncounteredEntries: XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries,
        }),
      } satisfies Xcom2ModuleScanRequest);
      const configurationRequest = Object.freeze({
        workspaceId,
        workspaceGeneration: token.generation,
        activationGeneration,
        configurationReadId: `${CONFIGURATION_READ_ID_PREFIX}${activationGeneration}`,
      } satisfies Xcom2ModuleConfigurationReadRequest);
      const authority: ActivationAuthority = { token, scanRequest, configurationRequest };
      currentActivationRef.current = authority;
      setIsScanning(true);
      setError(null);

      const isCurrent = (): boolean =>
        mountedRef.current &&
        currentActivationRef.current === authority &&
        switchStateRef.current?.token === token &&
        workspaceGenerationRef.current === scanRequest.workspaceGeneration &&
        workspaceIdRef.current === scanRequest.workspaceId;

      const [scanResult, configurationResult] = await Promise.allSettled([
        invokeSafely(() => dependencies.scanner.scan(scanRequest)),
        invokeSafely(() => dependencies.configuration.read(configurationRequest)),
      ]);
      if (!isCurrent()) return;

      let recognition: Readonly<Xcom2ModuleActivationSnapshot> | null = null;
      if (scanResult.status === "fulfilled" && exactlyMatchesScan(scanResult.value, scanRequest)) {
        const evaluated = evaluateXcom2ModuleActivation(scanResult.value);
        if (exactlyMatchesScan(evaluated, scanRequest)) recognition = evaluated;
      } else if (scanResult.status === "rejected") {
        console.error("[Xcom2ModuleActivation] Module scan failed", {
          errorType: getErrorType(scanResult.reason),
        });
      }
      if (!isCurrent()) return;

      let project: Readonly<Xcom2ProjectActivationSnapshot> | null = null;
      if (
        recognition &&
        configurationResult.status === "fulfilled" &&
        exactlyMatchesConfiguration(configurationResult.value, configurationRequest)
      ) {
        const evaluated = evaluateXcom2ProjectActivation(
          configurationRequest,
          configurationResult.value,
          recognition,
        );
        if (
          evaluated.kind === "accepted" &&
          exactlyMatchesScan(evaluated.snapshot, scanRequest) &&
          evaluated.snapshot.activationGeneration === configurationRequest.activationGeneration &&
          evaluated.snapshot.configurationReadId === configurationRequest.configurationReadId &&
          projectMatchesRecognition(evaluated.snapshot, recognition)
        ) {
          project = evaluated.snapshot;
        }
      } else if (configurationResult.status === "rejected") {
        console.error("[Xcom2ModuleActivation] Configuration read failed", {
          errorType: getErrorType(configurationResult.reason),
        });
      }
      if (!isCurrent()) return;

      committedSnapshotRef.current = recognition;
      committedProjectSnapshotRef.current = project;
      setSnapshot(recognition);
      setProjectSnapshot(project);
      setError(
        scanResult.status === "rejected"
          ? SCAN_ERROR
          : configurationResult.status === "rejected"
            ? CONFIGURATION_ERROR
            : null,
      );
      currentActivationRef.current = null;
      setIsScanning(false);
    },
    [dependencies.configuration, dependencies.scanner],
  );

  const loadWorkspace = useCallback(
    (token: Xcom2ModuleActivationWorkspaceSwitchToken, workspaceId: string): Promise<void> =>
      runActivation(token, workspaceId),
    [runActivation],
  );

  const refreshWorkspace = useCallback(
    (workspaceGeneration: number, workspaceId: string): Promise<void> => {
      if (
        !mountedRef.current ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        workspaceIdRef.current !== workspaceId
      ) {
        return Promise.resolve();
      }

      // Reuse the switch authority shape without changing native workspace authorization.
      const token = beginWorkspaceSwitch(workspaceGeneration);
      workspaceIdRef.current = workspaceId;
      return runActivation(token, workspaceId);
    },
    [beginWorkspaceSwitch, runActivation],
  );

  const restoreWorkspace = useCallback((token: Xcom2ModuleActivationWorkspaceSwitchToken): void => {
    const switchState = switchStateRef.current;
    if (
      !mountedRef.current ||
      switchState?.token !== token ||
      workspaceGenerationRef.current !== token.generation
    ) {
      return;
    }

    currentActivationRef.current = null;
    workspaceIdRef.current = token.previousWorkspaceId;
    const restoredSnapshot =
      token.previousWorkspaceId !== null &&
      switchState.previousSnapshot?.workspaceId === token.previousWorkspaceId
        ? switchState.previousSnapshot
        : null;
    const restoredProjectSnapshot =
      restoredSnapshot &&
      switchState.previousProjectSnapshot?.workspaceId === token.previousWorkspaceId &&
      projectMatchesRecognition(switchState.previousProjectSnapshot, restoredSnapshot)
        ? switchState.previousProjectSnapshot
        : null;
    committedSnapshotRef.current = restoredSnapshot;
    committedProjectSnapshotRef.current = restoredProjectSnapshot;
    setIsScanning(false);
    setError(null);
    setSnapshot(restoredSnapshot);
    setProjectSnapshot(restoredProjectSnapshot);
  }, []);

  const settleFailedWorkspaceActivation = useCallback(
    (token: Xcom2ModuleActivationWorkspaceSwitchToken): void => {
      if (
        !mountedRef.current ||
        switchStateRef.current?.token !== token ||
        workspaceGenerationRef.current !== token.generation
      ) {
        return;
      }
      currentActivationRef.current = null;
      workspaceIdRef.current = token.previousWorkspaceId;
      committedSnapshotRef.current = null;
      committedProjectSnapshotRef.current = null;
      setSnapshot(null);
      setProjectSnapshot(null);
      setIsScanning(false);
    },
    [],
  );

  useLayoutEffect(
    () => () => {
      mountedRef.current = false;
      currentActivationRef.current = null;
      switchStateRef.current = null;
    },
    [],
  );

  const activeModules = useMemo(
    () => (snapshot ? selectActiveXcom2ModuleDecisions(snapshot) : NO_ACTIVE_MODULES),
    [snapshot],
  );
  const activeProjectDecisions = useMemo(
    () =>
      projectSnapshot
        ? Object.freeze(projectSnapshot.decisions.filter(({ state }) => state === "active"))
        : NO_ACTIVE_PROJECTS,
    [projectSnapshot],
  );
  const workspaceCollaborator = useMemo<Xcom2ModuleActivationWorkspaceCollaborator>(
    () => ({
      beginWorkspaceSwitch,
      activateWorkspace,
      loadWorkspace,
      refreshWorkspace,
      restoreWorkspace,
      settleFailedWorkspaceActivation,
    }),
    [
      activateWorkspace,
      beginWorkspaceSwitch,
      loadWorkspace,
      refreshWorkspace,
      restoreWorkspace,
      settleFailedWorkspaceActivation,
    ],
  );

  return {
    snapshot,
    activeModules,
    projectSnapshot,
    activeProjectDecisions,
    isScanning,
    error,
    refreshWorkspace,
    workspaceCollaborator,
  };
}
