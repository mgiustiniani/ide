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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  isHistoryVisible: boolean;
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

  currentWorkspaceIdRef.current = dependencies.currentWorkspaceId;

  const [snapshot, setSnapshot] = useState<Xcom2SetupMonitorSnapshot | null>(null);
  const [plan, setPlan] = useState<Xcom2SetupPlan | null>(null);
  const [isLoading, setIsLoading] = useState(dependencies.deferWorkspaceActivation ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [transaction, setTransaction] = useState<Xcom2SetupTransactionDetail | null>(null);
  const [transactions, setTransactions] = useState<readonly Xcom2SetupTransactionSummary[]>([]);
  const [isTransactionLoading, setIsTransactionLoading] = useState(
    dependencies.deferWorkspaceActivation ?? false,
  );
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [transactionProgressEvent, setTransactionProgressEvent] =
    useState<Xcom2SetupTransactionEvent | null>(null);
  const [workspaceSubscriptionsEnabled, setWorkspaceSubscriptionsEnabled] = useState(
    !(dependencies.deferWorkspaceActivation ?? false),
  );

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
      const workspaceGeneration = workspaceGenerationRef.current;
      const expectedWorkspaceId = workspaceIdRef.current ?? currentWorkspaceIdRef.current ?? null;
      if (!expectedWorkspaceId || switchingWorkspaceRef.current) return;

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

  const refreshHistory = useCallback((): Promise<void> => loadTransactions(), [loadTransactions]);

  const refresh = useCallback(async (): Promise<void> => {
    // Monitor evidence and native journals are independent sources of truth.
    await Promise.all([loadSnapshot("refresh"), loadTransactions()]);
  }, [loadSnapshot, loadTransactions]);

  const beginWorkspaceSwitch = useCallback(
    (workspaceGeneration: number): Xcom2SetupWorkspaceSwitchToken => {
      const previousWorkspaceId = workspaceIdRef.current;
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
      setIsLoading(true);
      setTransaction(null);
      setTransactions([]);
      setTransactionError(null);
      setTransactionProgressEvent(null);
      setIsTransactionLoading(true);
      return { generation: workspaceGeneration, previousWorkspaceId };
    },
    [],
  );

  const activateWorkspace = useCallback((workspace: WorkspaceInfo): void => {
    workspaceIdRef.current = workspace.id;
    switchingWorkspaceRef.current = false;
    setWorkspaceSubscriptionsEnabled(true);
  }, []);

  const loadWorkspace = useCallback(
    async (token: Xcom2SetupWorkspaceSwitchToken, workspaceId: string): Promise<void> => {
      await Promise.all([
        loadSnapshot("snapshot", token.generation, workspaceId),
        loadTransactions(token.generation, workspaceId),
      ]);
    },
    [loadSnapshot, loadTransactions],
  );

  const restoreWorkspace = useCallback(
    (token: Xcom2SetupWorkspaceSwitchToken): void => {
      workspaceIdRef.current = token.previousWorkspaceId;
      switchingWorkspaceRef.current = false;
      void loadSnapshot("snapshot", token.generation, token.previousWorkspaceId);
      if (token.previousWorkspaceId) {
        void loadTransactions(token.generation, token.previousWorkspaceId);
      }
    },
    [loadSnapshot, loadTransactions],
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

  useEffect(() => {
    if (!workspaceSubscriptionsEnabled) return;

    const unsubscribe = dependencies.events.subscribeMonitor((event) => {
      const workspaceGeneration = workspaceGenerationRef.current;
      const expectedWorkspaceId = workspaceIdRef.current;
      if (
        switchingWorkspaceRef.current ||
        event.sequence <= eventSequenceRef.current ||
        (expectedWorkspaceId !== null && event.snapshot.workspaceId !== expectedWorkspaceId)
      ) {
        return;
      }

      if (applySnapshot(event.snapshot, workspaceGeneration, expectedWorkspaceId)) {
        eventSequenceRef.current = event.sequence;
        // A newer live event wins over an in-flight snapshot or refresh request.
        setupRequestRef.current += 1;
        setIsLoading(false);
      }
    });
    if (!dependencies.deferWorkspaceActivation) void loadSnapshot();

    return () => {
      setupRequestRef.current += 1;
      unsubscribe();
    };
  }, [
    applySnapshot,
    dependencies.deferWorkspaceActivation,
    dependencies.events,
    loadSnapshot,
    workspaceSubscriptionsEnabled,
  ]);

  useEffect(() => {
    if (!workspaceSubscriptionsEnabled) return;

    const unsubscribe = dependencies.events.subscribeTransactions((event) => {
      const current = transactionRef.current;
      const workspaceGeneration = workspaceGenerationRef.current;
      const expectedWorkspaceId = workspaceIdRef.current;
      const previousSequence = transactionEventSequencesRef.current.get(event.transactionId) ?? -1;
      if (
        switchingWorkspaceRef.current ||
        !current ||
        !expectedWorkspaceId ||
        event.transactionId !== current.transactionId ||
        current.workspaceId !== expectedWorkspaceId ||
        event.sequence <= previousSequence
      ) {
        return;
      }

      transactionEventSequencesRef.current.set(event.transactionId, event.sequence);
      setTransactionProgressEvent(event);
      // Events are notifications only; native detail and history are re-read.
      void loadTransactions(workspaceGeneration, expectedWorkspaceId);
    });

    return () => {
      transactionRequestRef.current += 1;
      unsubscribe();
    };
  }, [dependencies.events, loadTransactions, workspaceSubscriptionsEnabled]);

  useEffect(() => {
    if (
      !dependencies.isHistoryVisible ||
      !dependencies.currentWorkspaceId ||
      switchingWorkspaceRef.current
    ) {
      return;
    }
    void loadTransactions(
      workspaceGenerationRef.current,
      workspaceIdRef.current ?? dependencies.currentWorkspaceId,
    );
  }, [dependencies.currentWorkspaceId, dependencies.isHistoryVisible, loadTransactions]);

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
