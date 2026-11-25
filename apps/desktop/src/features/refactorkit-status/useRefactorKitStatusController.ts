import type { RefactorKitCapabilities, RefactorKitStatus } from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INITIAL_WORKSPACE_GENERATION = 1;
const STATUS_ERROR = "Unable to check RefactorKit availability.";
const CAPABILITIES_ERROR = "Unable to load RefactorKit capability discovery.";

export interface RefactorKitStatusWorkspaceCollaborator {
  beginWorkspaceSwitch(workspaceGeneration: number): number;
  load(workspaceStatusGeneration: number): Promise<void>;
  settleFailedWorkspaceSwitch(workspaceStatusGeneration: number): void;
}

export interface UseRefactorKitStatusControllerDependencies {
  refactorKit: RefactorKitPort;
  /** Desktop composition defers workspace-scoped checks until root authorization succeeds. */
  deferWorkspaceActivation?: boolean;
}

export interface RefactorKitStatusSnapshot {
  status: RefactorKitStatus | null;
  capabilities: RefactorKitCapabilities | null;
  /** Short source-safe detail when capability discovery failed. */
  capabilitiesError?: string | null;
}

function safeCapabilityError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const detail = error.message.trim();
  if (
    detail.length === 0 ||
    detail.length > 240 ||
    !/^\[tauri:get_refactorkit_(?:engine_)?capabilities\] /u.test(detail) ||
    /[\\/]|\b(?:password|secret|credential|token|authorization|api key)\b/iu.test(detail) ||
    !/^[\p{L}\p{N}\s.,:;()[\]_'"!?-]+$/u.test(detail)
  )
    return null;
  return detail;
}

export interface RefactorKitStatusController {
  status: RefactorKitStatus | null;
  capabilities: RefactorKitCapabilities | null;
  isChecking: boolean;
  error: string | null;
  refresh(workspaceGeneration?: number): Promise<void>;
  /** Refreshes and returns the exact status/capability snapshot for an immediate consumer. */
  refreshWithSnapshot(workspaceGeneration?: number): Promise<RefactorKitStatusSnapshot>;
  workspaceCollaborator: RefactorKitStatusWorkspaceCollaborator;
}

/**
 * Owns the provider-neutral RefactorKit daemon and capability-discovery lifecycle.
 * Adapter-normalized results cross this boundary unchanged; the controller only
 * coordinates independent outcomes and workspace/request staleness.
 */
export function useRefactorKitStatusController(
  dependencies: UseRefactorKitStatusControllerDependencies,
): RefactorKitStatusController {
  const requestRef = useRef(0);
  const workspaceGenerationRef = useRef(INITIAL_WORKSPACE_GENERATION);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<RefactorKitStatus | null>(null);
  const [capabilities, setCapabilities] = useState<RefactorKitCapabilities | null>(null);
  const [isChecking, setIsChecking] = useState(dependencies.deferWorkspaceActivation ?? false);
  const [error, setError] = useState<string | null>(null);

  const refreshWithSnapshot = useCallback(
    async (workspaceGeneration?: number): Promise<RefactorKitStatusSnapshot> => {
      const targetGeneration = workspaceGeneration ?? workspaceGenerationRef.current;
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setIsChecking(true);
      setError(null);

      try {
        const [statusResult, capabilitiesResult] = await Promise.allSettled([
          Promise.resolve().then(() => dependencies.refactorKit.getStatus()),
          Promise.resolve().then(() => dependencies.refactorKit.getCapabilities()),
        ]);
        if (
          !mountedRef.current ||
          requestRef.current !== requestId ||
          workspaceGenerationRef.current !== targetGeneration
        )
          return { status: null, capabilities: null };

        const errors: string[] = [];
        let currentStatus: RefactorKitStatus | null = null;
        let currentCapabilities: RefactorKitCapabilities | null = null;
        if (statusResult.status === "fulfilled") {
          currentStatus = statusResult.value;
          setStatus(currentStatus);
        } else {
          setStatus(null);
          errors.push(STATUS_ERROR);
          console.error("[App] Failed to load RefactorKit status.");
        }

        let capabilitiesError: string | null = null;
        if (capabilitiesResult.status === "fulfilled") {
          currentCapabilities = capabilitiesResult.value;
          setCapabilities(currentCapabilities);
        } else {
          setCapabilities(null);
          errors.push(CAPABILITIES_ERROR);
          capabilitiesError = safeCapabilityError(capabilitiesResult.reason);
          console.error("[App] Failed to load RefactorKit capabilities.");
        }

        setError(errors.length > 0 ? errors.join(" ") : null);
        return { status: currentStatus, capabilities: currentCapabilities, capabilitiesError };
      } finally {
        if (
          mountedRef.current &&
          requestRef.current === requestId &&
          workspaceGenerationRef.current === targetGeneration
        ) {
          setIsChecking(false);
        }
      }
    },
    [dependencies.refactorKit],
  );
  const refresh = useCallback(
    async (workspaceGeneration?: number): Promise<void> => {
      await refreshWithSnapshot(workspaceGeneration);
    },
    [refreshWithSnapshot],
  );

  const beginWorkspaceSwitch = useCallback((workspaceGeneration: number): number => {
    workspaceGenerationRef.current = workspaceGeneration;
    requestRef.current += 1;
    setStatus(null);
    setCapabilities(null);
    setError(null);
    setIsChecking(true);
    return workspaceGeneration;
  }, []);

  const settleFailedWorkspaceSwitch = useCallback((workspaceStatusGeneration: number): void => {
    if (workspaceGenerationRef.current === workspaceStatusGeneration) {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!dependencies.deferWorkspaceActivation) void refresh();
  }, [dependencies.deferWorkspaceActivation, refresh]);

  const workspaceCollaborator = useMemo<RefactorKitStatusWorkspaceCollaborator>(
    () => ({
      beginWorkspaceSwitch,
      load: refresh,
      settleFailedWorkspaceSwitch,
    }),
    [beginWorkspaceSwitch, refresh, settleFailedWorkspaceSwitch],
  );

  return useMemo(
    () => ({
      status,
      capabilities,
      isChecking,
      error,
      refresh,
      refreshWithSnapshot,
      workspaceCollaborator,
    }),
    [capabilities, error, isChecking, refresh, refreshWithSnapshot, status, workspaceCollaborator],
  );
}
