import type {
  WorkspaceInfo,
  Xcom2SetupMonitorListener,
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupMonitorUnsubscribe,
  Xcom2SetupPlan,
  Xcom2SetupResult,
  Xcom2SetupTransactionDetail,
  Xcom2SetupTransactionEvent,
  Xcom2SetupTransactionSummary,
  Xcom2SetupUnsubscribe,
} from "@ide/contracts";
import { canApplyXcom2SetupTransaction, createXcom2SetupPlan } from "@ide/web-core";
import type { Xcom2SetupMonitorPort, Xcom2SetupPort } from "@ide/web-core/ports";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

const INITIAL_WORKSPACE_GENERATION = 1;
const TRANSACTION_HISTORY_LIMIT = 32;
const SHA256_DIGEST = /^[a-f0-9]{64}$/i;
const APPLY_IDENTITY_ERROR =
  "Apply requires the exact prepared transaction and full reviewed operation digest.";
const APPLY_ELIGIBILITY_ERROR = "Apply is not available for the current transaction.";
const UNEXPECTED_MONITOR_ERROR = "Steam monitor unavailable; native locations remain redacted.";
const UNEXPECTED_TRANSACTION_ERROR =
  "Unable to complete the XCOM 2 setup request. Refresh and try again.";

type Xcom2SetupMonitorCommands = Pick<Xcom2SetupMonitorPort, "getSnapshot" | "refresh">;
type Xcom2SetupTransactionCommands = Pick<
  Xcom2SetupPort,
  "prepare" | "apply" | "getTransaction" | "listTransactions" | "cancel" | "rollback" | "recover"
>;

type TransactionAction = () => Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

interface Xcom2SettingsLifecycle {
  readonly identity: symbol;
  readonly workspaceGeneration: number;
  readonly workspaceId: string;
  unsubscribeMonitor: Xcom2SetupMonitorUnsubscribe;
  unsubscribeTransactions: Xcom2SetupUnsubscribe;
  initialLoad: Promise<void>;
}

export interface Xcom2SetupEventSources {
  subscribeMonitor(listener: Xcom2SetupMonitorListener): Xcom2SetupMonitorUnsubscribe;
  subscribeTransactions(
    listener: (event: Xcom2SetupTransactionEvent) => void,
  ): Xcom2SetupUnsubscribe;
}

export interface Xcom2SetupWorkspaceSwitchToken {
  readonly generation: number;
  readonly previousWorkspaceId: string | null;
}

export interface Xcom2SetupWorkspaceCollaborator {
  beginWorkspaceSwitch(workspaceGeneration: number): Xcom2SetupWorkspaceSwitchToken;
  activateWorkspace(workspace: WorkspaceInfo): void;
  loadWorkspace(token: Xcom2SetupWorkspaceSwitchToken, workspaceId: string): Promise<void>;
  restoreWorkspace(token: Xcom2SetupWorkspaceSwitchToken): void;
  settleFailedWorkspaceActivation(token: Xcom2SetupWorkspaceSwitchToken): void;
}

export interface UseXcom2SetupControllerDependencies {
  monitor: Xcom2SetupMonitorCommands;
  transactions: Xcom2SetupTransactionCommands;
  events: Xcom2SetupEventSources;
  currentWorkspaceId: string | null;
  isSettingsOpen: boolean;
  /** Desktop composition delegates the first workspace-scoped load to its workspace owner. */
  deferWorkspaceActivation?: boolean;
}

export interface Xcom2SetupController {
  snapshot: Xcom2SetupMonitorSnapshot | null;
  plan: Xcom2SetupPlan | null;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
  transaction: Xcom2SetupTransactionDetail | null;
  transactions: readonly Xcom2SetupTransactionSummary[];
  isTransactionLoading: boolean;
  transactionError: string | null;
  transactionProgressEvent: Xcom2SetupTransactionEvent | null;
  workspaceCollaborator: Xcom2SetupWorkspaceCollaborator;
  refresh(): Promise<void>;
  planSetup(): void;
  prepare(): Promise<void>;
  apply(transactionId: string, approvalDigest: string): Promise<void>;
  cancel(transactionId: string): Promise<void>;
  rollback(transactionId: string): Promise<void>;
  recover(transactionId: string): Promise<void>;
  refreshHistory(): Promise<void>;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Application-layer owner of read-only setup monitoring, dry-run planning, and
 * native transaction orchestration. All native capabilities and event streams
 * are supplied through provider-neutral boundaries.
 */
export function useXcom2SetupController(
  dependencies: UseXcom2SetupControllerDependencies,
): Xcom2SetupController {
  const setupRequestRef = useRef(0);
  const transactionRequestRef = useRef(0);
  const workspaceGenerationRef = useRef(INITIAL_WORKSPACE_GENERATION);
  const workspaceIdRef = useRef<string | null>(null);
  const currentWorkspaceIdRef = useRef(dependencies.currentWorkspaceId);
  const eventSequenceRef = useRef(-1);
  const transactionEventSequencesRef = useRef<Map<string, number>>(new Map());
  const snapshotRef = useRef<Xcom2SetupMonitorSnapshot | null>(null);
  const transactionRef = useRef<Xcom2SetupTransactionDetail | null>(null);
  const switchingWorkspaceRef = useRef(dependencies.deferWorkspaceActivation ?? false);
  const settingsOpenRef = useRef(dependencies.isSettingsOpen);
  const lifecycleRef = useRef<Xcom2SettingsLifecycle | null>(null);

  currentWorkspaceIdRef.current = dependencies.currentWorkspaceId;
  settingsOpenRef.current = dependencies.isSettingsOpen;

  const [snapshot, setSnapshot] = useState<Xcom2SetupMonitorSnapshot | null>(null);
  const [plan, setPlan] = useState<Xcom2SetupPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [transaction, setTransaction] = useState<Xcom2SetupTransactionDetail | null>(null);
  const [transactions, setTransactions] = useState<readonly Xcom2SetupTransactionSummary[]>([]);
  const [isTransactionLoading, setIsTransactionLoading] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [transactionProgressEvent, setTransactionProgressEvent] =
    useState<Xcom2SetupTransactionEvent | null>(null);

  const applyTransaction = useCallback(
    (
      nextTransaction: Xcom2SetupTransactionDetail,
      workspaceGeneration: number,
      expectedWorkspaceId: string,
    ): boolean => {
      if (
        switchingWorkspaceRef.current ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        nextTransaction.workspaceId !== expectedWorkspaceId
      ) {
        return false;
      }

      transactionRef.current = nextTransaction;
      setTransaction(nextTransaction);
      return true;
    },
    [],
  );

  const loadTransactions = useCallback(
    async (
      workspaceGeneration = workspaceGenerationRef.current,
      expectedWorkspaceId = workspaceIdRef.current ?? currentWorkspaceIdRef.current ?? null,
      authoritativeRequestId?: number,
    ): Promise<void> => {
      if (!expectedWorkspaceId || switchingWorkspaceRef.current) return;

      const requestId = authoritativeRequestId ?? transactionRequestRef.current + 1;
      if (authoritativeRequestId === undefined) {
        transactionRequestRef.current = requestId;
      } else if (transactionRequestRef.current !== requestId) {
        return;
      }
      setIsTransactionLoading(true);
      setTransactionError(null);

      try {
        const listed = await dependencies.transactions.listTransactions({
          workspaceId: expectedWorkspaceId,
          limit: TRANSACTION_HISTORY_LIMIT,
        });
        if (
          transactionRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }

        if (!listed.ok) {
          if (listed.error.transaction) {
            applyTransaction(listed.error.transaction, workspaceGeneration, expectedWorkspaceId);
          }
          setTransactionError(listed.error.message);
          return;
        }

        const nextTransactions = listed.value.transactions.filter(
          (candidate) => candidate.workspaceId === expectedWorkspaceId,
        );
        setTransactions(nextTransactions);
        const latest = nextTransactions[0];
        if (!latest) {
          transactionRef.current = null;
          setTransaction(null);
          setTransactionProgressEvent(null);
          return;
        }

        const current = await dependencies.transactions.getTransaction({
          transactionId: latest.transactionId,
        });
        if (
          transactionRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }

        if (!current.ok) {
          if (current.error.transaction) {
            applyTransaction(current.error.transaction, workspaceGeneration, expectedWorkspaceId);
          }
          setTransactionError(current.error.message);
          return;
        }

        applyTransaction(current.value, workspaceGeneration, expectedWorkspaceId);
      } catch (loadError) {
        if (
          transactionRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }
        setTransactionError(UNEXPECTED_TRANSACTION_ERROR);
        console.error("[Xcom2Setup] Failed to load setup transactions", {
          errorType: getErrorType(loadError),
        });
      } finally {
        if (
          transactionRequestRef.current === requestId &&
          workspaceGenerationRef.current === workspaceGeneration &&
          !switchingWorkspaceRef.current
        ) {
          setIsTransactionLoading(false);
        }
      }
    },
    [applyTransaction, dependencies.transactions],
  );

  const applySnapshot = useCallback(
    (
      nextSnapshot: Xcom2SetupMonitorSnapshot,
      workspaceGeneration: number,
      expectedWorkspaceId: string | null,
    ): boolean => {
      if (
        switchingWorkspaceRef.current ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        (expectedWorkspaceId !== null && nextSnapshot.workspaceId !== expectedWorkspaceId)
      ) {
        return false;
      }

      const current = snapshotRef.current;
      if (
        current?.workspaceId === nextSnapshot.workspaceId &&
        nextSnapshot.generation < current.generation
      ) {
        return false;
      }

      workspaceIdRef.current = nextSnapshot.workspaceId;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setPlan(null);
      setError(null);
      setIsStale(false);
      return true;
    },
    [],
  );

  const loadSnapshot = useCallback(
    async (
      mode: "snapshot" | "refresh" = "snapshot",
      workspaceGeneration = workspaceGenerationRef.current,
      expectedWorkspaceId = workspaceIdRef.current ?? currentWorkspaceIdRef.current,
    ): Promise<void> => {
      const requestId = setupRequestRef.current + 1;
      setupRequestRef.current = requestId;
      setIsLoading(true);
      setError(null);

      try {
        const nextSnapshot =
          mode === "refresh"
            ? await dependencies.monitor.refresh()
            : await dependencies.monitor.getSnapshot();
        if (setupRequestRef.current !== requestId) return;
        applySnapshot(nextSnapshot, workspaceGeneration, expectedWorkspaceId);
      } catch (loadError) {
        if (
          setupRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }
        setError(UNEXPECTED_MONITOR_ERROR);
        setIsStale(snapshotRef.current !== null);
        console.error("[Xcom2Setup] Failed to load setup monitor", {
          mode,
          errorType: getErrorType(loadError),
        });
      } finally {
        if (
          setupRequestRef.current === requestId &&
          workspaceGenerationRef.current === workspaceGeneration &&
          !switchingWorkspaceRef.current
        ) {
          setIsLoading(false);
        }
      }
    },
    [applySnapshot, dependencies.monitor],
  );

  const runTransactionAction = useCallback(
    async (action: TransactionAction, transactionId?: string): Promise<void> => {
      const lifecycle = lifecycleRef.current;
      const workspaceGeneration = workspaceGenerationRef.current;
      const expectedWorkspaceId = workspaceIdRef.current ?? currentWorkspaceIdRef.current ?? null;
      if (
        !lifecycle ||
        !settingsOpenRef.current ||
        !expectedWorkspaceId ||
        switchingWorkspaceRef.current ||
        lifecycle.workspaceGeneration !== workspaceGeneration ||
        lifecycle.workspaceId !== expectedWorkspaceId
      ) {
        return;
      }

      const requestId = transactionRequestRef.current + 1;
      transactionRequestRef.current = requestId;
      setIsTransactionLoading(true);
      setTransactionError(null);

      try {
        const result = await action();
        if (
          transactionRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }

        const nativeTransaction = result.ok ? result.value : result.error.transaction;
        if (nativeTransaction) {
          applyTransaction(nativeTransaction, workspaceGeneration, expectedWorkspaceId);
        }
        if (!result.ok) setTransactionError(result.error.message);

        // Native state remains authoritative after every action. The reload
        // shares this action's request authority so it cannot invalidate itself.
        await loadTransactions(workspaceGeneration, expectedWorkspaceId, requestId);
        if (
          transactionRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }

        if (transactionId && transactionRef.current?.transactionId !== transactionId) {
          const exact = await dependencies.transactions.getTransaction({ transactionId });
          if (
            transactionRequestRef.current !== requestId ||
            workspaceGenerationRef.current !== workspaceGeneration ||
            switchingWorkspaceRef.current
          ) {
            return;
          }
          if (exact.ok) {
            applyTransaction(exact.value, workspaceGeneration, expectedWorkspaceId);
          }
        }
      } catch (actionError) {
        if (
          transactionRequestRef.current !== requestId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          switchingWorkspaceRef.current
        ) {
          return;
        }
        setTransactionError(UNEXPECTED_TRANSACTION_ERROR);
        console.error("[Xcom2Setup] Setup transaction action failed", {
          errorType: getErrorType(actionError),
        });
      } finally {
        if (
          transactionRequestRef.current === requestId &&
          workspaceGenerationRef.current === workspaceGeneration &&
          !switchingWorkspaceRef.current
        ) {
          setIsTransactionLoading(false);
        }
      }
    },
    [applyTransaction, dependencies.transactions, loadTransactions],
  );

  const planSetup = useCallback((): void => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot) {
      setError("Refresh Steam setup status before generating a plan.");
      return;
    }
    setPlan(createXcom2SetupPlan(currentSnapshot));
    setError(null);
  }, []);

  const prepare = useCallback(async (): Promise<void> => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot) {
      setTransactionError("Refresh Steam setup status before preparing a transaction.");
      return;
    }
    await runTransactionAction(() =>
      dependencies.transactions.prepare({ plan: createXcom2SetupPlan(currentSnapshot) }),
    );
  }, [dependencies.transactions, runTransactionAction]);

  const apply = useCallback(
    async (transactionId: string, approvalDigest: string): Promise<void> => {
      const currentTransaction = transactionRef.current;
      const reviewedDigest = currentTransaction?.reviewedOperationDigest;
      if (
        !currentTransaction ||
        currentTransaction.transactionId !== transactionId ||
        reviewedDigest?.algorithm !== "sha256" ||
        !SHA256_DIGEST.test(approvalDigest) ||
        reviewedDigest.digest !== approvalDigest
      ) {
        setTransactionError(APPLY_IDENTITY_ERROR);
        return;
      }

      if (!canApplyXcom2SetupTransaction(currentTransaction)) {
        setTransactionError(APPLY_ELIGIBILITY_ERROR);
        return;
      }

      await runTransactionAction(
        () =>
          dependencies.transactions.apply({
            transactionId: currentTransaction.transactionId,
            approvalToken: reviewedDigest.digest,
          }),
        currentTransaction.transactionId,
      );
    },
    [dependencies.transactions, runTransactionAction],
  );

  const cancel = useCallback(
    (transactionId: string): Promise<void> =>
      runTransactionAction(
        () => dependencies.transactions.cancel({ transactionId }),
        transactionId,
      ),
    [dependencies.transactions, runTransactionAction],
  );

  const rollback = useCallback(
    (transactionId: string): Promise<void> =>
      runTransactionAction(
        () => dependencies.transactions.rollback({ transactionId }),
        transactionId,
      ),
    [dependencies.transactions, runTransactionAction],
  );

  const recover = useCallback(
    (transactionId: string): Promise<void> => {
      const strategy =
        transactionRef.current?.state === "rollback-conflict"
          ? "retry-rollback"
          : "resume-rollback";
      return runTransactionAction(
        () => dependencies.transactions.recover({ transactionId, strategy }),
        transactionId,
      );
    },
    [dependencies.transactions, runTransactionAction],
  );

  const refreshHistory = useCallback((): Promise<void> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle || !settingsOpenRef.current || switchingWorkspaceRef.current) {
      return Promise.resolve();
    }
    return loadTransactions(lifecycle.workspaceGeneration, lifecycle.workspaceId);
  }, [loadTransactions]);

  const refresh = useCallback(async (): Promise<void> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle || !settingsOpenRef.current || switchingWorkspaceRef.current) return;

    // Monitor evidence and native journals are independent sources of truth.
    await Promise.all([
      loadSnapshot("refresh", lifecycle.workspaceGeneration, lifecycle.workspaceId),
      loadTransactions(lifecycle.workspaceGeneration, lifecycle.workspaceId),
    ]);
  }, [loadSnapshot, loadTransactions]);

  const isCurrentLifecycle = useCallback((lifecycle: Xcom2SettingsLifecycle): boolean => {
    return (
      lifecycleRef.current?.identity === lifecycle.identity &&
      settingsOpenRef.current &&
      !switchingWorkspaceRef.current &&
      workspaceGenerationRef.current === lifecycle.workspaceGeneration &&
      workspaceIdRef.current === lifecycle.workspaceId
    );
  }, []);

  const stopLifecycle = useCallback((): void => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;

    // Revoke authority before either adapter can synchronously deliver another event.
    lifecycleRef.current = null;
    setupRequestRef.current += 1;
    transactionRequestRef.current += 1;
    lifecycle.unsubscribeMonitor();
    lifecycle.unsubscribeTransactions();
    setIsLoading(false);
    setIsTransactionLoading(false);
  }, []);

  const startLifecycle = useCallback(
    (workspaceGeneration: number, workspaceId: string): Promise<void> => {
      const active = lifecycleRef.current;
      if (
        active &&
        isCurrentLifecycle(active) &&
        active.workspaceGeneration === workspaceGeneration &&
        active.workspaceId === workspaceId
      ) {
        return active.initialLoad;
      }
      if (
        !settingsOpenRef.current ||
        switchingWorkspaceRef.current ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        workspaceIdRef.current !== workspaceId
      ) {
        return Promise.resolve();
      }

      stopLifecycle();
      const lifecycle: Xcom2SettingsLifecycle = {
        identity: Symbol("xcom2-settings-lifecycle"),
        workspaceGeneration,
        workspaceId,
        unsubscribeMonitor: () => undefined,
        unsubscribeTransactions: () => undefined,
        initialLoad: Promise.resolve(),
      };
      // Publish the identity before subscribing or loading. Collaborator and
      // layout-effect activation can now converge on this exact lifecycle.
      lifecycleRef.current = lifecycle;
      eventSequenceRef.current = -1;
      transactionEventSequencesRef.current.clear();

      lifecycle.unsubscribeMonitor = dependencies.events.subscribeMonitor((event) => {
        if (!isCurrentLifecycle(lifecycle) || event.sequence <= eventSequenceRef.current) return;
        if (event.snapshot.workspaceId !== lifecycle.workspaceId) return;

        if (applySnapshot(event.snapshot, lifecycle.workspaceGeneration, lifecycle.workspaceId)) {
          eventSequenceRef.current = event.sequence;
          // A newer live event wins over an in-flight snapshot or refresh request.
          setupRequestRef.current += 1;
          setIsLoading(false);
        }
      });
      lifecycle.unsubscribeTransactions = dependencies.events.subscribeTransactions((event) => {
        if (!isCurrentLifecycle(lifecycle)) return;
        const current = transactionRef.current;
        const previousSequence =
          transactionEventSequencesRef.current.get(event.transactionId) ?? -1;
        if (
          !current ||
          event.transactionId !== current.transactionId ||
          current.workspaceId !== lifecycle.workspaceId ||
          event.sequence <= previousSequence
        ) {
          return;
        }

        transactionEventSequencesRef.current.set(event.transactionId, event.sequence);
        setTransactionProgressEvent(event);
        // Events are notifications only; native detail and history are re-read.
        void loadTransactions(lifecycle.workspaceGeneration, lifecycle.workspaceId);
      });

      lifecycle.initialLoad = Promise.all([
        loadSnapshot("snapshot", workspaceGeneration, workspaceId),
        loadTransactions(workspaceGeneration, workspaceId),
      ]).then(() => undefined);
      return lifecycle.initialLoad;
    },
    [
      applySnapshot,
      dependencies.events,
      isCurrentLifecycle,
      loadSnapshot,
      loadTransactions,
      stopLifecycle,
    ],
  );

  const beginWorkspaceSwitch = useCallback(
    (workspaceGeneration: number): Xcom2SetupWorkspaceSwitchToken => {
      const previousWorkspaceId = workspaceIdRef.current;
      stopLifecycle();
      workspaceGenerationRef.current = workspaceGeneration;
      setupRequestRef.current += 1;
      transactionRequestRef.current += 1;
      switchingWorkspaceRef.current = true;
      workspaceIdRef.current = null;
      snapshotRef.current = null;
      eventSequenceRef.current = -1;
      transactionEventSequencesRef.current.clear();
      transactionRef.current = null;
      setSnapshot(null);
      setPlan(null);
      setError(null);
      setIsStale(false);
      setIsLoading(settingsOpenRef.current);
      setTransaction(null);
      setTransactions([]);
      setTransactionError(null);
      setTransactionProgressEvent(null);
      setIsTransactionLoading(settingsOpenRef.current);
      return { generation: workspaceGeneration, previousWorkspaceId };
    },
    [stopLifecycle],
  );

  const activateWorkspace = useCallback((workspace: WorkspaceInfo): void => {
    workspaceIdRef.current = workspace.id;
    switchingWorkspaceRef.current = false;
  }, []);

  const loadWorkspace = useCallback(
    (token: Xcom2SetupWorkspaceSwitchToken, workspaceId: string): Promise<void> =>
      startLifecycle(token.generation, workspaceId),
    [startLifecycle],
  );

  const restoreWorkspace = useCallback(
    (token: Xcom2SetupWorkspaceSwitchToken): void => {
      workspaceIdRef.current = token.previousWorkspaceId;
      switchingWorkspaceRef.current = false;
      if (token.previousWorkspaceId) {
        void startLifecycle(token.generation, token.previousWorkspaceId);
      }
    },
    [startLifecycle],
  );

  const settleFailedWorkspaceActivation = useCallback(
    (token: Xcom2SetupWorkspaceSwitchToken): void => {
      if (workspaceGenerationRef.current !== token.generation) return;
      switchingWorkspaceRef.current = false;
      setIsLoading(false);
      setIsTransactionLoading(false);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!dependencies.isSettingsOpen) {
      stopLifecycle();
      return;
    }
    if (switchingWorkspaceRef.current) return;

    const workspaceId = workspaceIdRef.current ?? dependencies.currentWorkspaceId;
    if (!workspaceId) return;
    workspaceIdRef.current = workspaceId;
    void startLifecycle(workspaceGenerationRef.current, workspaceId);
  }, [dependencies.currentWorkspaceId, dependencies.isSettingsOpen, startLifecycle, stopLifecycle]);

  useLayoutEffect(() => () => stopLifecycle(), [stopLifecycle]);

  const workspaceCollaborator = useMemo<Xcom2SetupWorkspaceCollaborator>(
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

  return {
    snapshot,
    plan,
    isLoading,
    error,
    isStale,
    transaction,
    transactions,
    isTransactionLoading,
    transactionError,
    transactionProgressEvent,
    workspaceCollaborator,
    refresh,
    planSetup,
    prepare,
    apply,
    cancel,
    rollback,
    recover,
    refreshHistory,
  };
}
