import {
  XCOM2_MODULE_SCAN_LIMITS,
  type WorkspaceInfo,
  type Xcom2ModuleActivationDecision,
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleScanCorrelation,
  type Xcom2ModuleScanRequest,
} from "@ide/contracts";
import { evaluateXcom2ModuleActivation, selectActiveXcom2ModuleDecisions } from "@ide/web-core";
import type { Xcom2ModuleScannerPort } from "@ide/web-core/ports";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const INITIAL_WORKSPACE_GENERATION = 1;
const SCAN_ID_PREFIX = "xcom2-module-scan:";
const SCAN_ERROR = "Unable to recognize XCOM 2 modules in the current workspace.";
const NO_ACTIVE_MODULES = Object.freeze([] as readonly Readonly<Xcom2ModuleActivationDecision>[]);

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
  restoreWorkspace(token: Xcom2ModuleActivationWorkspaceSwitchToken): void;
  settleFailedWorkspaceActivation(token: Xcom2ModuleActivationWorkspaceSwitchToken): void;
}

export interface UseXcom2ModuleActivationControllerDependencies {
  scanner: Pick<Xcom2ModuleScannerPort, "scan">;
}

export interface Xcom2ModuleActivationController {
  snapshot: Readonly<Xcom2ModuleActivationSnapshot> | null;
  activeModules: readonly Readonly<Xcom2ModuleActivationDecision>[];
  isScanning: boolean;
  error: string | null;
  workspaceCollaborator: Xcom2ModuleActivationWorkspaceCollaborator;
}

interface ScanAuthority {
  readonly token: Xcom2ModuleActivationWorkspaceSwitchToken;
  readonly request: Readonly<Xcom2ModuleScanRequest>;
}

interface SwitchState {
  readonly token: Xcom2ModuleActivationWorkspaceSwitchToken;
  readonly previousSnapshot: Readonly<Xcom2ModuleActivationSnapshot> | null;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function nextScanGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) return 1;
  if (current === Number.MAX_SAFE_INTEGER) throw new Error("XCOM 2 scan generation exhausted");
  return current + 1;
}

function exactlyMatches(
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

/**
 * Owns one-shot, workspace-authorized XCOM 2 convention recognition. Native scan
 * results have no authority unless all four correlation fields still match the
 * active workspace and scan request.
 */
export function useXcom2ModuleActivationController(
  dependencies: UseXcom2ModuleActivationControllerDependencies,
): Xcom2ModuleActivationController {
  const mountedRef = useRef(true);
  const workspaceGenerationRef = useRef(INITIAL_WORKSPACE_GENERATION);
  const workspaceIdRef = useRef<string | null>(null);
  const scanGenerationRef = useRef(0);
  const lastScannedWorkspaceGenerationRef = useRef(0);
  const currentScanRef = useRef<ScanAuthority | null>(null);
  const switchStateRef = useRef<SwitchState | null>(null);
  const committedSnapshotRef = useRef<Readonly<Xcom2ModuleActivationSnapshot> | null>(null);

  const [snapshot, setSnapshot] = useState<Readonly<Xcom2ModuleActivationSnapshot> | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginWorkspaceSwitch = useCallback(
    (workspaceGeneration: number): Xcom2ModuleActivationWorkspaceSwitchToken => {
      const previousWorkspaceId = workspaceIdRef.current;
      const token = Object.freeze({ generation: workspaceGeneration, previousWorkspaceId });
      const previousSnapshot = committedSnapshotRef.current;

      workspaceGenerationRef.current = workspaceGeneration;
      workspaceIdRef.current = null;
      currentScanRef.current = null;
      switchStateRef.current = { token, previousSnapshot };

      // Revocation is synchronous: no old contribution survives until native root activation.
      setSnapshot(null);
      setIsScanning(false);
      setError(null);
      return token;
    },
    [],
  );

  const activateWorkspace = useCallback((workspace: WorkspaceInfo): void => {
    workspaceIdRef.current = workspace.id;
  }, []);

  const loadWorkspace = useCallback(
    async (
      token: Xcom2ModuleActivationWorkspaceSwitchToken,
      workspaceId: string,
    ): Promise<void> => {
      const switchState = switchStateRef.current;
      if (
        !mountedRef.current ||
        switchState?.token !== token ||
        workspaceGenerationRef.current !== token.generation ||
        workspaceIdRef.current !== workspaceId ||
        token.generation <= lastScannedWorkspaceGenerationRef.current
      ) {
        return;
      }

      lastScannedWorkspaceGenerationRef.current = token.generation;
      let scanGeneration: number;
      try {
        scanGeneration = nextScanGeneration(scanGenerationRef.current);
      } catch (scanError) {
        if (mountedRef.current && switchStateRef.current?.token === token) {
          setError(SCAN_ERROR);
          setIsScanning(false);
          console.error("[Xcom2ModuleActivation] Failed to start module scan", {
            errorType: getErrorType(scanError),
          });
        }
        return;
      }
      scanGenerationRef.current = scanGeneration;

      const request = Object.freeze({
        workspaceId,
        workspaceGeneration: token.generation,
        scanId: `${SCAN_ID_PREFIX}${scanGeneration}`,
        scanGeneration,
        limits: Object.freeze({
          maximumDepth: XCOM2_MODULE_SCAN_LIMITS.maximumDepth,
          maximumEncounteredEntries: XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries,
        }),
      } satisfies Xcom2ModuleScanRequest);
      const authority: ScanAuthority = { token, request };
      currentScanRef.current = authority;
      setSnapshot(null);
      setIsScanning(true);
      setError(null);

      const isCurrent = (): boolean =>
        mountedRef.current &&
        currentScanRef.current === authority &&
        switchStateRef.current?.token === token &&
        workspaceGenerationRef.current === request.workspaceGeneration &&
        workspaceIdRef.current === request.workspaceId;

      try {
        const scanned = await dependencies.scanner.scan(request);
        if (!isCurrent() || !exactlyMatches(scanned, request)) return;

        const evaluated = evaluateXcom2ModuleActivation(scanned);
        if (!isCurrent() || !exactlyMatches(evaluated, request)) return;

        committedSnapshotRef.current = evaluated;
        setSnapshot(evaluated);
        setError(null);
      } catch (scanError) {
        if (!isCurrent()) return;
        setError(SCAN_ERROR);
        console.error("[Xcom2ModuleActivation] Module scan failed", {
          errorType: getErrorType(scanError),
        });
      } finally {
        if (isCurrent()) {
          currentScanRef.current = null;
          setIsScanning(false);
        }
      }
    },
    [dependencies.scanner],
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

    currentScanRef.current = null;
    workspaceIdRef.current = token.previousWorkspaceId;
    const restoredSnapshot =
      token.previousWorkspaceId !== null &&
      switchState.previousSnapshot?.workspaceId === token.previousWorkspaceId
        ? switchState.previousSnapshot
        : null;
    committedSnapshotRef.current = restoredSnapshot;
    setIsScanning(false);
    setError(null);
    setSnapshot(restoredSnapshot);
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
      currentScanRef.current = null;
      workspaceIdRef.current = token.previousWorkspaceId;
      committedSnapshotRef.current = null;
      setSnapshot(null);
      setIsScanning(false);
    },
    [],
  );

  useLayoutEffect(
    () => () => {
      mountedRef.current = false;
      currentScanRef.current = null;
      switchStateRef.current = null;
    },
    [],
  );

  const activeModules = useMemo(
    () => (snapshot ? selectActiveXcom2ModuleDecisions(snapshot) : NO_ACTIVE_MODULES),
    [snapshot],
  );
  const workspaceCollaborator = useMemo<Xcom2ModuleActivationWorkspaceCollaborator>(
    () => ({
      beginWorkspaceSwitch,
      activateWorkspace,
      loadWorkspace,
      restoreWorkspace,
      settleFailedWorkspaceActivation,
    }),
    [
      activateWorkspace,
      beginWorkspaceSwitch,
      loadWorkspace,
      restoreWorkspace,
      settleFailedWorkspaceActivation,
    ],
  );

  return { snapshot, activeModules, isScanning, error, workspaceCollaborator };
}
