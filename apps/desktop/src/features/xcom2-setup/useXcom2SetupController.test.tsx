import type {
  WorkspaceInfo,
  Xcom2SetupFailure,
  Xcom2SetupMonitorListener,
  Xcom2SetupMonitorSnapshot,
  Xcom2SetupResult,
  Xcom2SetupTransactionDetail,
  Xcom2SetupTransactionEvent,
  Xcom2SetupTransactionList,
} from "@ide/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useXcom2SetupController,
  type UseXcom2SetupControllerDependencies,
} from "./useXcom2SetupController";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const CHECKED_AT = "2026-07-13T12:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(
  workspaceId: string,
  generation: number,
  overrides: Partial<Xcom2SetupMonitorSnapshot> = {},
): Xcom2SetupMonitorSnapshot {
  return {
    workspaceId,
    generation,
    steamRoot: {
      source: "steam-client",
      displayRoot: "Steam Library (redacted)",
      pathRedacted: true,
    },
    products: [],
    overallState: "downloading",
    canPlanSetup: false,
    canApplySetup: false,
    blockers: ["Required Steam downloads are incomplete"],
    warnings: [],
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function transaction(
  transactionId: string,
  workspaceId = "workspace-one",
  overrides: Partial<Xcom2SetupTransactionDetail> = {},
): Xcom2SetupTransactionDetail {
  return {
    transactionId,
    planId: `plan-${transactionId}`,
    planVersion: 1,
    workspaceId,
    workspaceGeneration: 1,
    createdAt: CHECKED_AT,
    updatedAt: CHECKED_AT,
    state: "awaiting-approval",
    executable: true,
    approvedStepIds: ["configure-sdk-offline-mode"],
    approvedOperationIds: ["operation-one"],
    approvedCapabilities: ["patch-sdk-configuration"],
    reviewedOperationDigest: { algorithm: "sha256", digest: DIGEST },
    journal: {
      scope: "local-machine",
      managedBy: "native",
      redactedLocation: "Native-managed journal (redacted)",
    },
    applyAvailability: { allowed: true, blockers: [] },
    rollbackAvailable: false,
    conflictReasons: [],
    recoveryGuidance: [],
    operations: [],
    externalActions: [],
    ...overrides,
  };
}

function ok<T>(value: T): Xcom2SetupResult<T> {
  return { ok: true, value };
}

function failure<T>(error: Xcom2SetupFailure): Xcom2SetupResult<T> {
  return { ok: false, error };
}

function progressEvent(
  transactionId: string,
  sequence: number,
  overrides: Partial<Xcom2SetupTransactionEvent> = {},
): Xcom2SetupTransactionEvent {
  return {
    transactionId,
    sequence,
    occurredAt: CHECKED_AT,
    kind: "operation-progress",
    state: "applying",
    terminal: false,
    completedOperations: sequence,
    totalOperations: 10,
    ...overrides,
  };
}

function workspace(id: string): WorkspaceInfo {
  return { id, name: id, rootPath: `/workspaces/${id}` };
}

function createHarness() {
  let monitorSnapshot = snapshot("workspace-one", 1);
  let nativeHistory: Xcom2SetupTransactionDetail[] = [];
  const monitorListeners = new Set<Xcom2SetupMonitorListener>();
  const transactionListeners = new Set<(event: Xcom2SetupTransactionEvent) => void>();

  const getSnapshot = vi.fn(async () => monitorSnapshot);
  const refresh = vi.fn(async () => monitorSnapshot);
  const prepare = vi.fn(
    async (
      request: Parameters<UseXcom2SetupControllerDependencies["transactions"]["prepare"]>[0],
    ) => {
      const prepared = transaction("tx-prepared", request.plan.workspaceId, {
        workspaceGeneration: request.plan.workspaceGeneration,
      });
      nativeHistory = [
        prepared,
        ...nativeHistory.filter((item) => item.transactionId !== prepared.transactionId),
      ];
      return ok(prepared);
    },
  );
  const apply = vi.fn(
    async ({ transactionId }: { transactionId: string; approvalToken: string }) => {
      const current =
        nativeHistory.find((item) => item.transactionId === transactionId) ??
        transaction(transactionId);
      const next = transaction(transactionId, current.workspaceId, {
        ...current,
        state: "applying",
      });
      nativeHistory = [
        next,
        ...nativeHistory.filter((item) => item.transactionId !== transactionId),
      ];
      return ok(next);
    },
  );
  const cancel = vi.fn(async ({ transactionId }: { transactionId: string }) => {
    const current =
      nativeHistory.find((item) => item.transactionId === transactionId) ??
      transaction(transactionId);
    const next = transaction(transactionId, current.workspaceId, {
      ...current,
      state: "cancelled",
      applyAvailability: { allowed: false, blockers: ["Transaction was cancelled"] },
    });
    nativeHistory = [next, ...nativeHistory.filter((item) => item.transactionId !== transactionId)];
    return ok(next);
  });
  const rollback = vi.fn(async ({ transactionId }: { transactionId: string }) => {
    const current =
      nativeHistory.find((item) => item.transactionId === transactionId) ??
      transaction(transactionId);
    const next = transaction(transactionId, current.workspaceId, {
      ...current,
      state: "rolled-back",
      rollbackAvailable: false,
      applyAvailability: { allowed: false, blockers: ["Transaction was rolled back"] },
    });
    nativeHistory = [next, ...nativeHistory.filter((item) => item.transactionId !== transactionId)];
    return ok(next);
  });
  const recover = vi.fn(
    async ({
      transactionId,
    }: {
      transactionId: string;
      strategy: "resume-rollback" | "retry-rollback" | "verify-journal";
    }) => {
      const current =
        nativeHistory.find((item) => item.transactionId === transactionId) ??
        transaction(transactionId);
      const next = transaction(transactionId, current.workspaceId, {
        ...current,
        state: "rolling-back",
      });
      nativeHistory = [
        next,
        ...nativeHistory.filter((item) => item.transactionId !== transactionId),
      ];
      return ok(next);
    },
  );
  const listTransactions = vi.fn(
    async ({
      workspaceId,
    }: {
      workspaceId: string;
      limit?: number;
    }): Promise<Xcom2SetupResult<Xcom2SetupTransactionList>> =>
      ok({ transactions: nativeHistory.filter((item) => item.workspaceId === workspaceId) }),
  );
  const getTransaction = vi.fn(async ({ transactionId }: { transactionId: string }) => {
    const current = nativeHistory.find((item) => item.transactionId === transactionId);
    return current
      ? ok(current)
      : failure<Xcom2SetupTransactionDetail>({
          code: "not-found",
          message: "Transaction not found.",
          recoveryGuidance: [],
        });
  });
  const subscribeMonitor = vi.fn((listener: Xcom2SetupMonitorListener) => {
    monitorListeners.add(listener);
    return vi.fn(() => monitorListeners.delete(listener));
  });
  const subscribeTransactions = vi.fn((listener: (event: Xcom2SetupTransactionEvent) => void) => {
    transactionListeners.add(listener);
    return vi.fn(() => transactionListeners.delete(listener));
  });

  const dependencies = {
    monitor: { getSnapshot, refresh },
    transactions: {
      prepare,
      apply,
      getTransaction,
      listTransactions,
      cancel,
      rollback,
      recover,
    },
    events: { subscribeMonitor, subscribeTransactions },
  } satisfies Omit<UseXcom2SetupControllerDependencies, "currentWorkspaceId" | "isHistoryVisible">;

  return {
    dependencies,
    mocks: {
      getSnapshot,
      refresh,
      prepare,
      apply,
      getTransaction,
      listTransactions,
      cancel,
      rollback,
      recover,
      subscribeMonitor,
      subscribeTransactions,
    },
    setMonitorSnapshot(next: Xcom2SetupMonitorSnapshot) {
      monitorSnapshot = next;
    },
    setHistory(next: Xcom2SetupTransactionDetail[]) {
      nativeHistory = next;
    },
    emitMonitor(nextSnapshot: Xcom2SetupMonitorSnapshot, sequence: number) {
      for (const listener of monitorListeners) {
        listener({ type: "snapshot", cause: "poll", sequence, snapshot: nextSnapshot });
      }
    },
    emitTransaction(event: Xcom2SetupTransactionEvent) {
      for (const listener of transactionListeners) listener(event);
    },
    listenerCounts() {
      return { monitor: monitorListeners.size, transactions: transactionListeners.size };
    },
  };
}

function renderController(
  harness: ReturnType<typeof createHarness>,
  currentWorkspaceId: string | null = "workspace-one",
  isHistoryVisible = false,
) {
  return renderHook(
    (props: { currentWorkspaceId: string | null; isHistoryVisible: boolean }) =>
      useXcom2SetupController({
        ...harness.dependencies,
        currentWorkspaceId: props.currentWorkspaceId,
        isHistoryVisible: props.isHistoryVisible,
      }),
    { initialProps: { currentWorkspaceId, isHistoryVisible } },
  );
}

async function waitForInitialSnapshot(controller: ReturnType<typeof renderController>) {
  await waitFor(() => expect(controller.result.current.isLoading).toBe(false));
  expect(controller.result.current.snapshot).not.toBeNull();
}

async function loadHistory(controller: ReturnType<typeof renderController>) {
  await act(() => controller.result.current.refreshHistory());
  await waitFor(() => expect(controller.result.current.isTransactionLoading).toBe(false));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useXcom2SetupController", () => {
  it("refreshes monitor evidence, creates only a dry-run plan, and marks retained evidence stale on a safe refresh failure", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);

    act(() => controller.result.current.planSetup());
    expect(controller.result.current.plan).toMatchObject({
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      state: "waiting-for-download",
      dryRun: true,
      canApply: false,
    });

    harness.setMonitorSnapshot(snapshot("workspace-one", 2));
    await act(() => controller.result.current.refresh());
    expect(harness.mocks.refresh).toHaveBeenCalledOnce();
    expect(harness.mocks.listTransactions).toHaveBeenCalledWith({
      workspaceId: "workspace-one",
      limit: 32,
    });
    expect(controller.result.current.snapshot?.generation).toBe(2);
    expect(controller.result.current.plan).toBeNull();
    expect(controller.result.current.isStale).toBe(false);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveFailure =
      "Steam monitor failed at /home/alice/.steam/steamapps with token=super-secret.";
    harness.mocks.refresh.mockRejectedValueOnce(new Error(sensitiveFailure));
    await act(() => controller.result.current.refresh());

    expect(controller.result.current.snapshot?.generation).toBe(2);
    expect(controller.result.current.isStale).toBe(true);
    expect(controller.result.current.error).toBe(
      "Steam monitor unavailable; native locations remain redacted.",
    );
    expect(errorSpy).toHaveBeenCalledWith("[Xcom2Setup] Failed to load setup monitor", {
      mode: "refresh",
      errorType: "Error",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(sensitiveFailure);
  });

  it("prepares from the current snapshot and permits Apply only for the exact current ID and complete reviewed digest", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);

    await act(() => controller.result.current.prepare());
    expect(harness.mocks.prepare).toHaveBeenCalledOnce();
    expect(harness.mocks.prepare.mock.calls[0]?.[0].plan).toMatchObject({
      workspaceId: "workspace-one",
      workspaceGeneration: 1,
      dryRun: true,
      canApply: false,
    });
    expect(controller.result.current.transaction).toMatchObject({
      transactionId: "tx-prepared",
      state: "awaiting-approval",
      reviewedOperationDigest: { algorithm: "sha256", digest: DIGEST },
    });

    for (const [transactionId, approvalDigest] of [
      ["tx-other", DIGEST],
      ["tx-prepared", DIGEST.slice(0, 16)],
      ["tx-prepared", OTHER_DIGEST],
    ] as const) {
      await act(() => controller.result.current.apply(transactionId, approvalDigest));
    }
    expect(harness.mocks.apply).not.toHaveBeenCalled();
    expect(controller.result.current.transactionError).toBe(
      "Apply requires the exact prepared transaction and full reviewed operation digest.",
    );

    await act(() => controller.result.current.apply("tx-prepared", DIGEST));
    expect(harness.mocks.apply).toHaveBeenCalledOnce();
    expect(harness.mocks.apply).toHaveBeenCalledWith({
      transactionId: "tx-prepared",
      approvalToken: DIGEST,
    });
    expect(controller.result.current.transaction?.state).toBe("applying");
    expect(controller.result.current.transactionError).toBeNull();
  });

  it("denies Apply for each ineligible native state even with the exact ID and full digest", async () => {
    const ineligibleCases: Array<Partial<Xcom2SetupTransactionDetail>> = [
      { state: "planned" },
      { executable: false },
      { applyAvailability: { allowed: false, blockers: ["Native audit denied Apply"] } },
    ];

    for (const [index, ineligible] of ineligibleCases.entries()) {
      const harness = createHarness();
      const transactionId = `tx-ineligible-${index}`;
      harness.setHistory([transaction(transactionId, "workspace-one", ineligible)]);
      const controller = renderController(harness);
      await waitForInitialSnapshot(controller);
      await loadHistory(controller);

      await act(() => controller.result.current.apply(transactionId, DIGEST));

      expect(harness.mocks.apply).not.toHaveBeenCalled();
      expect(controller.result.current.transactionError).toBe(
        "Apply is not available for the current transaction.",
      );
      controller.unmount();
    }
  });

  it("cancels through the injected port and re-reads authoritative transaction/history state", async () => {
    const harness = createHarness();
    harness.setHistory([transaction("tx-cancel")]);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    await loadHistory(controller);
    const readsBefore = harness.mocks.listTransactions.mock.calls.length;

    await act(() => controller.result.current.cancel("tx-cancel"));

    expect(harness.mocks.cancel).toHaveBeenCalledWith({ transactionId: "tx-cancel" });
    expect(harness.mocks.listTransactions.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(controller.result.current.transaction?.state).toBe("cancelled");
    expect(controller.result.current.transactions[0]?.state).toBe("cancelled");
  });

  it("rolls back without force semantics, chooses conflict-safe recovery strategies, and refreshes history", async () => {
    const harness = createHarness();
    harness.setHistory([
      transaction("tx-lifecycle", "workspace-one", {
        state: "applied",
        rollbackAvailable: true,
        applyAvailability: { allowed: false, blockers: ["Already applied"] },
      }),
    ]);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    await loadHistory(controller);

    await act(() => controller.result.current.rollback("tx-lifecycle"));
    expect(harness.mocks.rollback).toHaveBeenCalledWith({ transactionId: "tx-lifecycle" });
    expect(harness.mocks.rollback.mock.calls[0]?.[0]).not.toHaveProperty("force");
    expect(controller.result.current.transaction?.state).toBe("rolled-back");

    harness.setHistory([
      transaction("tx-conflict", "workspace-one", {
        state: "rollback-conflict",
        conflictReasons: ["Current target hash differs from the journal"],
      }),
    ]);
    await loadHistory(controller);
    await act(() => controller.result.current.recover("tx-conflict"));
    expect(harness.mocks.recover).toHaveBeenLastCalledWith({
      transactionId: "tx-conflict",
      strategy: "retry-rollback",
    });

    harness.setHistory([
      transaction("tx-interrupted", "workspace-one", { state: "recovery-required" }),
    ]);
    await loadHistory(controller);
    await act(() => controller.result.current.recover("tx-interrupted"));
    expect(harness.mocks.recover).toHaveBeenLastCalledWith({
      transactionId: "tx-interrupted",
      strategy: "resume-rollback",
    });
    expect(harness.mocks.recover).toHaveBeenCalledTimes(2);
    expect(controller.result.current.transactions[0]?.transactionId).toBe("tx-interrupted");
  });

  it("accepts only the newest monitor refresh and history request completion", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);

    const staleRefresh = deferred<Xcom2SetupMonitorSnapshot>();
    harness.mocks.refresh
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce(snapshot("workspace-one", 3));
    let oldRefresh!: Promise<void>;
    act(() => {
      oldRefresh = controller.result.current.refresh();
    });
    await waitFor(() => expect(harness.mocks.refresh).toHaveBeenCalledTimes(1));
    await act(() => controller.result.current.refresh());
    expect(controller.result.current.snapshot?.generation).toBe(3);

    staleRefresh.resolve(snapshot("workspace-one", 2));
    await act(async () => oldRefresh);
    expect(controller.result.current.snapshot?.generation).toBe(3);
    expect(controller.result.current.error).toBeNull();

    const staleHistory = deferred<Xcom2SetupResult<Xcom2SetupTransactionList>>();
    const newest = transaction("tx-newest");
    harness.mocks.listTransactions
      .mockImplementationOnce(() => staleHistory.promise)
      .mockResolvedValueOnce(ok({ transactions: [newest] }));
    harness.mocks.getTransaction.mockResolvedValueOnce(ok(newest));
    let oldHistory!: Promise<void>;
    act(() => {
      oldHistory = controller.result.current.refreshHistory();
    });
    await waitFor(() => expect(controller.result.current.isTransactionLoading).toBe(true));
    await act(() => controller.result.current.refreshHistory());
    expect(controller.result.current.transaction?.transactionId).toBe("tx-newest");

    staleHistory.resolve(ok({ transactions: [transaction("tx-stale")] }));
    await act(async () => oldHistory);
    expect(controller.result.current.transaction?.transactionId).toBe("tx-newest");
    expect(controller.result.current.transactionError).toBeNull();
  });

  it("invalidates stale prepare and transaction-operation completions", async () => {
    const harness = createHarness();
    const pendingPrepare = deferred<Xcom2SetupResult<Xcom2SetupTransactionDetail>>();
    harness.mocks.prepare.mockImplementationOnce(() => pendingPrepare.promise);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);

    let preparing!: Promise<void>;
    act(() => {
      preparing = controller.result.current.prepare();
    });
    let token!: ReturnType<
      typeof controller.result.current.workspaceCollaborator.beginWorkspaceSwitch
    >;
    act(() => {
      token = controller.result.current.workspaceCollaborator.beginWorkspaceSwitch(2);
    });
    expect(token).toEqual({ generation: 2, previousWorkspaceId: "workspace-one" });
    pendingPrepare.resolve(ok(transaction("tx-late-prepare", "workspace-one")));
    await act(async () => preparing);
    expect(controller.result.current.transaction).toBeNull();

    act(() =>
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("workspace-two")),
    );
    harness.setMonitorSnapshot(snapshot("workspace-two", 1));
    harness.setHistory([transaction("tx-current", "workspace-two")]);
    await act(() =>
      controller.result.current.workspaceCollaborator.loadWorkspace(token, "workspace-two"),
    );

    const pendingCancel = deferred<Xcom2SetupResult<Xcom2SetupTransactionDetail>>();
    harness.mocks.cancel.mockImplementationOnce(() => pendingCancel.promise);
    let cancelling!: Promise<void>;
    act(() => {
      cancelling = controller.result.current.cancel("tx-current");
    });
    await act(() => controller.result.current.rollback("tx-current"));
    pendingCancel.resolve(ok(transaction("tx-current", "workspace-two", { state: "cancelled" })));
    await act(async () => cancelling);

    expect(controller.result.current.transaction?.state).toBe("rolled-back");
    expect(controller.result.current.transactionError).toBeNull();
  });

  it("prevents an older rejected action from overwriting newer detail, error, or loading state", async () => {
    const harness = createHarness();
    harness.setHistory([transaction("tx-race")]);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    await loadHistory(controller);

    const olderCancel = deferred<Xcom2SetupResult<Xcom2SetupTransactionDetail>>();
    harness.mocks.cancel.mockImplementationOnce(() => olderCancel.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let cancelling!: Promise<void>;
    act(() => {
      cancelling = controller.result.current.cancel("tx-race");
    });
    await waitFor(() => expect(controller.result.current.isTransactionLoading).toBe(true));

    await act(() => controller.result.current.rollback("tx-race"));
    expect(controller.result.current.transaction?.state).toBe("rolled-back");
    expect(controller.result.current.transactionError).toBeNull();
    expect(controller.result.current.isTransactionLoading).toBe(false);

    olderCancel.reject(
      new Error("Older failure leaked /home/alice/.steam and password=do-not-render"),
    );
    await act(async () => cancelling);

    expect(controller.result.current.transaction?.state).toBe("rolled-back");
    expect(controller.result.current.transactionError).toBeNull();
    expect(controller.result.current.isTransactionLoading).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("prevents an older late exact-transaction fallback from replacing newer state", async () => {
    const harness = createHarness();
    harness.setHistory([transaction("tx-older")]);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    await loadHistory(controller);

    const historyHead = transaction("tx-history-head", "workspace-one", {
      state: "applying",
      executable: false,
      applyAvailability: { allowed: false, blockers: ["Apply already started"] },
    });
    const lateExact = deferred<Xcom2SetupResult<Xcom2SetupTransactionDetail>>();
    harness.mocks.listTransactions.mockResolvedValueOnce(ok({ transactions: [historyHead] }));
    harness.mocks.getTransaction
      .mockResolvedValueOnce(ok(historyHead))
      .mockImplementationOnce(({ transactionId }: { transactionId: string }) => {
        expect(transactionId).toBe("tx-older");
        return lateExact.promise;
      });

    let olderAction!: Promise<void>;
    act(() => {
      olderAction = controller.result.current.cancel("tx-older");
    });
    await waitFor(() =>
      expect(harness.mocks.getTransaction).toHaveBeenCalledWith({ transactionId: "tx-older" }),
    );

    await act(() => controller.result.current.rollback("tx-history-head"));
    expect(controller.result.current.transaction).toMatchObject({
      transactionId: "tx-history-head",
      state: "rolled-back",
    });
    expect(controller.result.current.isTransactionLoading).toBe(false);

    lateExact.resolve(ok(transaction("tx-older", "workspace-one", { state: "cancelled" })));
    await act(async () => olderAction);

    expect(controller.result.current.transaction).toMatchObject({
      transactionId: "tx-history-head",
      state: "rolled-back",
    });
    expect(controller.result.current.transactionError).toBeNull();
    expect(controller.result.current.isTransactionLoading).toBe(false);
  });

  it("rejects an initial snapshot outside the already-known current workspace", async () => {
    const harness = createHarness();
    harness.setMonitorSnapshot(snapshot("workspace-other", 99));
    const controller = renderController(harness, "workspace-one");

    await waitFor(() => expect(controller.result.current.isLoading).toBe(false));

    expect(harness.mocks.getSnapshot).toHaveBeenCalledOnce();
    expect(controller.result.current.snapshot).toBeNull();
    expect(controller.result.current.plan).toBeNull();
    expect(controller.result.current.error).toBeNull();
    expect(controller.result.current.isStale).toBe(false);
  });

  it("uses positive monotonic workspace generations and suppresses stale switch loads", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    act(() => controller.result.current.planSetup());

    const staleWorkspaceSnapshot = deferred<Xcom2SetupMonitorSnapshot>();
    harness.mocks.getSnapshot.mockImplementationOnce(() => staleWorkspaceSnapshot.promise);
    let tokenTwo!: ReturnType<
      typeof controller.result.current.workspaceCollaborator.beginWorkspaceSwitch
    >;
    act(() => {
      tokenTwo = controller.result.current.workspaceCollaborator.beginWorkspaceSwitch(2);
    });
    expect(tokenTwo.generation).toBeGreaterThan(0);
    expect(controller.result.current).toMatchObject({
      snapshot: null,
      plan: null,
      transaction: null,
      transactions: [],
      isLoading: true,
      isTransactionLoading: true,
    });
    act(() =>
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("workspace-two")),
    );
    let staleLoad!: Promise<void>;
    act(() => {
      staleLoad = controller.result.current.workspaceCollaborator.loadWorkspace(
        tokenTwo,
        "workspace-two",
      );
    });

    let tokenThree!: ReturnType<
      typeof controller.result.current.workspaceCollaborator.beginWorkspaceSwitch
    >;
    act(() => {
      tokenThree = controller.result.current.workspaceCollaborator.beginWorkspaceSwitch(3);
    });
    expect(tokenThree).toEqual({ generation: 3, previousWorkspaceId: "workspace-two" });
    expect(tokenThree.generation).toBeGreaterThan(tokenTwo.generation);
    act(() =>
      controller.result.current.workspaceCollaborator.activateWorkspace(
        workspace("workspace-three"),
      ),
    );
    harness.setMonitorSnapshot(snapshot("workspace-three", 1));
    harness.setHistory([]);
    await act(() =>
      controller.result.current.workspaceCollaborator.loadWorkspace(tokenThree, "workspace-three"),
    );
    expect(controller.result.current.snapshot?.workspaceId).toBe("workspace-three");

    staleWorkspaceSnapshot.resolve(snapshot("workspace-two", 99));
    await act(async () => staleLoad);
    expect(controller.result.current.snapshot?.workspaceId).toBe("workspace-three");
    expect(controller.result.current.snapshot?.generation).toBe(1);
  });

  it("orders monitor events and lets an accepted event suppress a late refresh", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    const lateRefresh = deferred<Xcom2SetupMonitorSnapshot>();
    harness.mocks.refresh.mockImplementationOnce(() => lateRefresh.promise);

    let refreshing!: Promise<void>;
    act(() => {
      refreshing = controller.result.current.refresh();
    });
    act(() => harness.emitMonitor(snapshot("workspace-one", 4), 8));
    expect(controller.result.current.snapshot?.generation).toBe(4);
    expect(controller.result.current.isLoading).toBe(false);

    act(() => {
      harness.emitMonitor(snapshot("workspace-one", 5), 8);
      harness.emitMonitor(snapshot("workspace-one", 3), 9);
      harness.emitMonitor(snapshot("workspace-other", 100), 10);
    });
    expect(controller.result.current.snapshot?.generation).toBe(4);

    lateRefresh.resolve(snapshot("workspace-one", 50));
    await act(async () => refreshing);
    expect(controller.result.current.snapshot?.generation).toBe(4);
  });

  it("scopes sequenced progress events to the current workspace transaction and suppresses late events", async () => {
    const harness = createHarness();
    harness.setHistory([transaction("tx-one")]);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);
    await loadHistory(controller);
    const readsBefore = harness.mocks.listTransactions.mock.calls.length;

    act(() => {
      harness.emitTransaction(progressEvent("tx-other", 100));
      harness.emitTransaction(progressEvent("tx-one", 7));
    });
    expect(controller.result.current.transactionProgressEvent?.sequence).toBe(7);
    await waitFor(() =>
      expect(harness.mocks.listTransactions.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    const readsAfterAccepted = harness.mocks.listTransactions.mock.calls.length;

    act(() => {
      harness.emitTransaction(progressEvent("tx-one", 7));
      harness.emitTransaction(progressEvent("tx-one", 6));
    });
    expect(harness.mocks.listTransactions).toHaveBeenCalledTimes(readsAfterAccepted);
    expect(controller.result.current.transactionProgressEvent?.sequence).toBe(7);

    let token!: ReturnType<
      typeof controller.result.current.workspaceCollaborator.beginWorkspaceSwitch
    >;
    act(() => {
      token = controller.result.current.workspaceCollaborator.beginWorkspaceSwitch(2);
      harness.emitTransaction(progressEvent("tx-one", 8));
    });
    expect(controller.result.current.transactionProgressEvent).toBeNull();

    act(() =>
      controller.result.current.workspaceCollaborator.activateWorkspace(workspace("workspace-two")),
    );
    harness.setMonitorSnapshot(snapshot("workspace-two", 1));
    harness.setHistory([transaction("tx-two", "workspace-two")]);
    await act(() =>
      controller.result.current.workspaceCollaborator.loadWorkspace(token, "workspace-two"),
    );
    act(() => {
      harness.emitTransaction(progressEvent("tx-one", 1000));
      harness.emitTransaction(progressEvent("tx-two", 1));
    });
    expect(controller.result.current.transactionProgressEvent).toMatchObject({
      transactionId: "tx-two",
      sequence: 1,
    });

    controller.unmount();
    expect(harness.listenerCounts()).toEqual({ monitor: 0, transactions: 0 });
    harness.emitTransaction(progressEvent("tx-two", 2));
  });

  it("presents honest non-native failures while logging only redacted error metadata", async () => {
    const harness = createHarness();
    const unavailableMessage =
      "XCOM 2 setup transactions require desktop-only native services and are unavailable in a browser.";
    harness.mocks.listTransactions.mockResolvedValueOnce(
      failure<Xcom2SetupTransactionList>({
        code: "native-unavailable",
        message: unavailableMessage,
        recoveryGuidance: ["Use the desktop application."],
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = renderController(harness);
    await waitForInitialSnapshot(controller);

    await loadHistory(controller);
    expect(controller.result.current.transactions).toEqual([]);
    expect(controller.result.current.transactionError).toBe(unavailableMessage);

    const sensitiveException =
      "Cannot prepare /home/alice/.steam/steamapps; apiKey=provider-secret.";
    class BrowserUnavailableError extends Error {
      constructor() {
        super(sensitiveException);
        this.name = "BrowserUnavailableError";
      }
    }
    harness.mocks.prepare.mockRejectedValueOnce(new BrowserUnavailableError());
    await act(() => controller.result.current.prepare());

    expect(controller.result.current.transactionError).toBe(
      "Unable to complete the XCOM 2 setup request. Refresh and try again.",
    );
    expect(errorSpy).toHaveBeenCalledWith("[Xcom2Setup] Setup transaction action failed", {
      errorType: "BrowserUnavailableError",
    });

    const sensitiveThrownString =
      "D:\\SteamLibrary\\steamapps\\common\\XCOM2 with token=another-secret";
    harness.mocks.cancel.mockRejectedValueOnce(sensitiveThrownString);
    await act(() => controller.result.current.cancel("tx-never-native"));

    expect(controller.result.current.transactionError).toBe(
      "Unable to complete the XCOM 2 setup request. Refresh and try again.",
    );
    expect(errorSpy).toHaveBeenCalledWith("[Xcom2Setup] Setup transaction action failed", {
      errorType: "string",
    });
    const serializedLogs = JSON.stringify(errorSpy.mock.calls);
    expect(serializedLogs).not.toContain(sensitiveException);
    expect(serializedLogs).not.toContain(sensitiveThrownString);
    expect(serializedLogs).not.toMatch(/[/\\](?:home|Users|SteamApps)[/\\]/);
  });
});
