import {
  XCOM2_MODULE_SCAN_LIMITS,
  acknowledgeXcom2NativeActivationEvidence,
  authorizeXcom2NativeBuildRecipeInspection,
  beginXcom2NativeActivationEvidence,
  transitionXcom2NativeActivationEvidence,
  type WorkspaceInfo,
  type Xcom2ModuleActivationDecision,
  type Xcom2ModuleActivationSnapshot,
  type Xcom2ModuleConfigurationReadRequest,
  type Xcom2ModuleScanRequest,
  type Xcom2NativeAcceptedActivationSnapshot,
  type Xcom2NativeActivationEvidenceState,
  type Xcom2NativeActivationLifecycleEvent,
  type Xcom2NativeInspectionAuthorizationDecision,
  type Xcom2NativeInspectionCurrent,
  type Xcom2ProjectActivationDecision,
  type Xcom2ProjectActivationSnapshot,
} from "@ide/contracts";
import {
  evaluateXcom2ModuleActivation,
  evaluateXcom2ProjectActivation,
  selectActiveXcom2ModuleDecisions,
} from "@ide/web-core";
import type { Xcom2NativeActivationEvidencePort } from "@ide/web-core/ports";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const INITIAL_WORKSPACE_GENERATION = 1;
const SCAN_ID_PREFIX = "xcom2-module-scan:";
const CONFIGURATION_READ_ID_PREFIX = "xcom2-configuration-read:";
const ACTIVATION_ERROR = "Unable to recognize XCOM 2 modules in the current workspace.";
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
  settleFailedWorkspaceRefresh(workspaceGeneration: number, workspaceId: string): void;
}

export interface UseXcom2ModuleActivationControllerDependencies {
  nativeEvidence: Pick<Xcom2NativeActivationEvidencePort, "begin" | "acknowledge" | "revoke">;
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
  authorizeBuildRecipeInspection(
    current: Readonly<Xcom2NativeInspectionCurrent>,
  ): Readonly<Xcom2NativeInspectionAuthorizationDecision>;
  workspaceCollaborator: Xcom2ModuleActivationWorkspaceCollaborator;
}

interface ActivationAuthority {
  readonly token: Xcom2ModuleActivationWorkspaceSwitchToken;
  readonly scanRequest: Readonly<Xcom2ModuleScanRequest>;
  readonly configurationReadId: string;
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

function acceptedSnapshotFromState(
  state: Extract<Xcom2NativeActivationEvidenceState, { readonly kind: "acknowledged" }>,
): Readonly<Xcom2NativeAcceptedActivationSnapshot> {
  return Object.freeze({
    workspaceId: state.workspaceId,
    workspaceGeneration: state.workspaceGeneration,
    activationGeneration: state.activationGeneration,
    activationAttemptReceipt: state.activationAttemptReceipt,
    modules: Object.freeze(
      state.selectedModules.map(({ moduleRoot, evidenceHandle }) =>
        Object.freeze({ moduleRoot, evidenceHandle }),
      ),
    ),
  });
}

function sameAcknowledgedState(
  expected: Extract<Xcom2NativeActivationEvidenceState, { readonly kind: "acknowledged" }>,
  actual: Extract<Xcom2NativeActivationEvidenceState, { readonly kind: "acknowledged" }>,
): boolean {
  return (
    actual.workspaceId === expected.workspaceId &&
    actual.workspaceGeneration === expected.workspaceGeneration &&
    actual.activationGeneration === expected.activationGeneration &&
    actual.activationAttemptReceipt === expected.activationAttemptReceipt &&
    actual.selectedModules.length === expected.selectedModules.length &&
    actual.selectedModules.every(
      (module, index) =>
        module.moduleRoot === expected.selectedModules[index]?.moduleRoot &&
        module.evidenceHandle === expected.selectedModules[index]?.evidenceHandle,
    )
  );
}

/**
 * Owns native activation-evidence custody. Native convention/configuration facts are
 * evaluated only by the existing pure TypeScript activation policies; native receives
 * only the selected opaque receipt and handles in acknowledgment.
 */
export function useXcom2ModuleActivationController(
  dependencies: UseXcom2ModuleActivationControllerDependencies,
): Xcom2ModuleActivationController {
  const mountedRef = useRef(true);
  const workspaceGenerationRef = useRef(INITIAL_WORKSPACE_GENERATION);
  const workspaceIdRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const currentActivationRef = useRef<ActivationAuthority | null>(null);
  const switchStateRef = useRef<SwitchState | null>(null);
  const committedSnapshotRef = useRef<Readonly<Xcom2ModuleActivationSnapshot> | null>(null);
  const committedProjectSnapshotRef = useRef<Readonly<Xcom2ProjectActivationSnapshot> | null>(null);
  const nativeEvidenceStateRef = useRef<Readonly<Xcom2NativeActivationEvidenceState> | null>(null);
  const nativeAcceptedSnapshotRef = useRef<Readonly<Xcom2NativeAcceptedActivationSnapshot> | null>(
    null,
  );
  const revocationBarrierRef = useRef<Promise<void>>(Promise.resolve());

  const [snapshot, setSnapshot] = useState<Readonly<Xcom2ModuleActivationSnapshot> | null>(null);
  const [projectSnapshot, setProjectSnapshot] =
    useState<Readonly<Xcom2ProjectActivationSnapshot> | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setNativeAuthorityRevision] = useState(0);

  const signalNativeRevocation = useCallback(
    (event: Readonly<Xcom2NativeActivationLifecycleEvent>): Promise<void> => {
      const retained = nativeEvidenceStateRef.current;
      if (retained) {
        nativeEvidenceStateRef.current = transitionXcom2NativeActivationEvidence(
          retained,
          event,
        ).state;
      }
      nativeAcceptedSnapshotRef.current = null;
      if (mountedRef.current) setNativeAuthorityRevision((revision) => revision + 1);

      let started: Promise<unknown>;
      try {
        // Invoke immediately so native revocation starts in this synchronous lifecycle turn.
        started = Promise.resolve(dependencies.nativeEvidence.revoke(Object.freeze({ ...event })));
      } catch (revocationError) {
        started = Promise.reject(revocationError);
      }
      const safe = started.catch((revocationError) => {
        console.error("[Xcom2ModuleActivation] Native evidence revocation failed", {
          errorType: getErrorType(revocationError),
        });
      });
      const barrier = Promise.all([revocationBarrierRef.current, safe]).then(() => undefined);
      revocationBarrierRef.current = barrier;
      return barrier;
    },
    [dependencies.nativeEvidence],
  );

  const clearPresentation = useCallback((): void => {
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

      // No old contribution or native authority survives native root transition.
      clearPresentation();
      void signalNativeRevocation({ kind: "workspace-switch-started" });
      return token;
    },
    [clearPresentation, signalNativeRevocation],
  );

  const activateWorkspace = useCallback(
    (workspace: WorkspaceInfo): void => {
      workspaceIdRef.current = workspace.id;
      void signalNativeRevocation({ kind: "workspace-activation-started" });
    },
    [signalNativeRevocation],
  );

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

      let requestGeneration: number;
      try {
        requestGeneration = nextGeneration(
          requestGenerationRef.current,
          "XCOM 2 activation generation",
        );
      } catch (startError) {
        if (mountedRef.current && switchStateRef.current?.token === token) {
          setError(ACTIVATION_ERROR);
          setIsScanning(false);
          void signalNativeRevocation({ kind: "activation-attempt-failed" });
          console.error("[Xcom2ModuleActivation] Failed to start project activation", {
            errorType: getErrorType(startError),
          });
        }
        return;
      }
      requestGenerationRef.current = requestGeneration;

      const scanRequest = Object.freeze({
        workspaceId,
        workspaceGeneration: token.generation,
        scanId: `${SCAN_ID_PREFIX}${requestGeneration}`,
        scanGeneration: requestGeneration,
        limits: Object.freeze({
          maximumDepth: XCOM2_MODULE_SCAN_LIMITS.maximumDepth,
          maximumEncounteredEntries: XCOM2_MODULE_SCAN_LIMITS.maximumEncounteredEntries,
        }),
      } satisfies Xcom2ModuleScanRequest);
      const configurationReadId = `${CONFIGURATION_READ_ID_PREFIX}${requestGeneration}`;
      const authority: ActivationAuthority = { token, scanRequest, configurationReadId };
      currentActivationRef.current = authority;
      setIsScanning(true);
      setError(null);

      const isCurrent = (): boolean =>
        mountedRef.current &&
        currentActivationRef.current === authority &&
        switchStateRef.current?.token === token &&
        workspaceGenerationRef.current === scanRequest.workspaceGeneration &&
        workspaceIdRef.current === scanRequest.workspaceId;

      // A generation transition revokes old native custody before the next begin can run.
      await signalNativeRevocation({
        kind: "newer-activation-generation",
        activationGeneration: requestGeneration,
      });
      if (!isCurrent()) return;
      await revocationBarrierRef.current;
      if (!isCurrent()) return;

      let candidate: Awaited<ReturnType<Xcom2NativeActivationEvidencePort["begin"]>>;
      try {
        candidate = await invokeSafely(() =>
          dependencies.nativeEvidence.begin(
            Object.freeze({
              workspaceId: scanRequest.workspaceId,
              workspaceGeneration: scanRequest.workspaceGeneration,
              scanId: scanRequest.scanId,
              scanGeneration: scanRequest.scanGeneration,
              configurationReadId,
              limits: scanRequest.limits,
            }),
          ),
        );
      } catch (activationError) {
        if (!isCurrent()) return;
        currentActivationRef.current = null;
        committedSnapshotRef.current = null;
        committedProjectSnapshotRef.current = null;
        setSnapshot(null);
        setProjectSnapshot(null);
        setError(ACTIVATION_ERROR);
        setIsScanning(false);
        void signalNativeRevocation({ kind: "activation-attempt-failed" });
        console.error("[Xcom2ModuleActivation] Native activation evidence failed", {
          errorType: getErrorType(activationError),
        });
        return;
      }
      if (!isCurrent()) return;

      const pendingDecision = beginXcom2NativeActivationEvidence(candidate);
      if (pendingDecision.kind !== "pending") {
        currentActivationRef.current = null;
        committedSnapshotRef.current = null;
        committedProjectSnapshotRef.current = null;
        setSnapshot(null);
        setProjectSnapshot(null);
        setError(ACTIVATION_ERROR);
        setIsScanning(false);
        void signalNativeRevocation({ kind: "activation-attempt-failed" });
        return;
      }
      const pending = pendingDecision.state;
      if (
        pending.workspaceId !== scanRequest.workspaceId ||
        pending.workspaceGeneration !== scanRequest.workspaceGeneration ||
        pending.scan.scanId !== scanRequest.scanId ||
        pending.scan.scanGeneration !== scanRequest.scanGeneration ||
        pending.scan.limits.maximumDepth !== scanRequest.limits.maximumDepth ||
        pending.scan.limits.maximumEncounteredEntries !==
          scanRequest.limits.maximumEncounteredEntries ||
        pending.configuration.configurationReadId !== configurationReadId
      ) {
        currentActivationRef.current = null;
        committedSnapshotRef.current = null;
        committedProjectSnapshotRef.current = null;
        setSnapshot(null);
        setProjectSnapshot(null);
        setError(null);
        setIsScanning(false);
        void signalNativeRevocation({ kind: "activation-attempt-failed" });
        return;
      }
      nativeEvidenceStateRef.current = pending;

      const recognition = evaluateXcom2ModuleActivation(pending.scan);
      const configurationRequest = Object.freeze({
        workspaceId: pending.configuration.workspaceId,
        workspaceGeneration: pending.configuration.workspaceGeneration,
        activationGeneration: pending.configuration.activationGeneration,
        configurationReadId: pending.configuration.configurationReadId,
      } satisfies Xcom2ModuleConfigurationReadRequest);
      const evaluation = evaluateXcom2ProjectActivation(
        configurationRequest,
        pending.configuration,
        recognition,
      );
      if (!isCurrent()) return;

      const project =
        evaluation.kind === "accepted" &&
        projectMatchesRecognition(evaluation.snapshot, recognition)
          ? evaluation.snapshot
          : null;
      const selected = acknowledgeXcom2NativeActivationEvidence(
        pending,
        evaluation,
        Object.freeze({
          workspaceId: pending.workspaceId,
          workspaceGeneration: pending.workspaceGeneration,
          activationGeneration: pending.activationGeneration,
          activationAttemptReceipt: pending.activationAttemptReceipt,
        }),
      );

      if (selected.kind === "acknowledged") {
        let nativeDecision;
        try {
          // This is the complete envelope: opaque receipt and selected opaque handles only.
          nativeDecision = await invokeSafely(() =>
            dependencies.nativeEvidence.acknowledge(selected.acknowledgment),
          );
        } catch (acknowledgmentError) {
          if (!isCurrent()) return;
          currentActivationRef.current = null;
          committedSnapshotRef.current = null;
          committedProjectSnapshotRef.current = null;
          setSnapshot(null);
          setProjectSnapshot(null);
          setError(ACTIVATION_ERROR);
          setIsScanning(false);
          void signalNativeRevocation({ kind: "activation-attempt-failed" });
          console.error("[Xcom2ModuleActivation] Native activation acknowledgment failed", {
            errorType: getErrorType(acknowledgmentError),
          });
          return;
        }
        if (!isCurrent()) return;
        if (
          nativeDecision.kind !== "acknowledged" ||
          !sameAcknowledgedState(selected.state, nativeDecision.state)
        ) {
          currentActivationRef.current = null;
          committedSnapshotRef.current = null;
          committedProjectSnapshotRef.current = null;
          setSnapshot(null);
          setProjectSnapshot(null);
          setError(ACTIVATION_ERROR);
          setIsScanning(false);
          void signalNativeRevocation({ kind: "activation-attempt-failed" });
          return;
        }
        nativeEvidenceStateRef.current = selected.state;
        nativeAcceptedSnapshotRef.current = acceptedSnapshotFromState(nativeDecision.state);
        setNativeAuthorityRevision((revision) => revision + 1);
      } else {
        void signalNativeRevocation({ kind: "activation-attempt-failed" });
      }
      if (!isCurrent()) return;

      const canPublishActive = project?.state !== "active" || selected.kind === "acknowledged";
      const publishedRecognition = canPublishActive ? recognition : null;
      const publishedProject = canPublishActive ? project : null;
      committedSnapshotRef.current = publishedRecognition;
      committedProjectSnapshotRef.current = publishedProject;
      setSnapshot(publishedRecognition);
      setProjectSnapshot(publishedProject);
      setError(null);
      currentActivationRef.current = null;
      setIsScanning(false);
    },
    [dependencies.nativeEvidence, signalNativeRevocation],
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

      const token = Object.freeze({
        generation: workspaceGeneration,
        previousWorkspaceId: workspaceId,
      });
      switchStateRef.current = {
        token,
        previousSnapshot: committedSnapshotRef.current,
        previousProjectSnapshot: committedProjectSnapshotRef.current,
        started: false,
      };
      clearPresentation();
      void signalNativeRevocation({ kind: "workspace-refresh" });
      return runActivation(token, workspaceId);
    },
    [clearPresentation, runActivation, signalNativeRevocation],
  );

  const restoreWorkspace = useCallback(
    (token: Xcom2ModuleActivationWorkspaceSwitchToken): void => {
      const switchState = switchStateRef.current;
      if (
        !mountedRef.current ||
        switchState?.token !== token ||
        workspaceGenerationRef.current !== token.generation
      ) {
        return;
      }

      currentActivationRef.current = null;
      void signalNativeRevocation({ kind: "workspace-activation-failed" });
      void signalNativeRevocation({ kind: "cached-react-restoration" });
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
    },
    [signalNativeRevocation],
  );

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
      void signalNativeRevocation({ kind: "workspace-activation-failed" });
    },
    [signalNativeRevocation],
  );

  const settleFailedWorkspaceRefresh = useCallback(
    (workspaceGeneration: number, workspaceId: string): void => {
      if (
        !mountedRef.current ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        workspaceIdRef.current !== workspaceId
      ) {
        return;
      }
      currentActivationRef.current = null;
      committedSnapshotRef.current = null;
      committedProjectSnapshotRef.current = null;
      setSnapshot(null);
      setProjectSnapshot(null);
      setIsScanning(false);
      void signalNativeRevocation({ kind: "workspace-activation-failed" });
    },
    [signalNativeRevocation],
  );

  const authorizeBuildRecipeInspection = useCallback(
    (
      current: Readonly<Xcom2NativeInspectionCurrent>,
    ): Readonly<Xcom2NativeInspectionAuthorizationDecision> => {
      const state = nativeEvidenceStateRef.current;
      const accepted = nativeAcceptedSnapshotRef.current;
      if (!state || !accepted) {
        return Object.freeze({ kind: "refused", code: "authority-unavailable" });
      }
      return authorizeXcom2NativeBuildRecipeInspection(state, current, accepted);
    },
    [],
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      currentActivationRef.current = null;
      switchStateRef.current = null;
      void signalNativeRevocation({ kind: "app-exit" });
    };
  }, [signalNativeRevocation]);

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
      settleFailedWorkspaceRefresh,
    }),
    [
      activateWorkspace,
      beginWorkspaceSwitch,
      loadWorkspace,
      refreshWorkspace,
      restoreWorkspace,
      settleFailedWorkspaceActivation,
      settleFailedWorkspaceRefresh,
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
    authorizeBuildRecipeInspection,
    workspaceCollaborator,
  };
}
