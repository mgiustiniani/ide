import type {
  RefactorApplyResult,
  RefactorKitCapabilities,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorRollbackResult,
  RefactoringOperation,
  RefactoringTarget,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JAVA_REFACTORING_CAPABILITIES_UNKNOWN,
  JAVA_REFACTORING_OPERATION_NOT_OFFERED,
  JAVA_REFACTORING_STALE_SELECTION,
  JAVA_REFACTORING_UNAVAILABLE,
  useJavaRefactoringController,
} from "./useJavaRefactoringController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const target = (overrides: Partial<RefactoringTarget> = {}): RefactoringTarget => ({
  kind: "class",
  path: "src/main/java/example/A.java",
  identity: "example.A",
  ...overrides,
});

const capabilities: RefactorKitCapabilities = {
  api: "RefactorKit",
  apiVersion: "0.3",
  provider: "refactorkit",
  providerVersion: "0.3.0",
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "preview",
  },
  generalRefactoring: {
    supported: true,
    operations: [
      "rename-class",
      "rename-member",
      "rename-local-variable",
      "move-class",
      "change-method-signature",
      "safe-delete",
    ],
    preview: true,
    apply: true,
    rollback: true,
    discard: true,
    stability: "preview",
  },
};

function previewFor(
  request: RefactorPreviewRequest,
  overrides: Partial<RefactorPreviewResult> = {},
): RefactorPreviewResult {
  return {
    planId: `plan-${request.requestId}`,
    operation: request.operation,
    target: request.target,
    status: "ready",
    summary: `Refactor ${request.target.identity}`,
    confidence: 0.97,
    riskLevel: "low",
    risks: [],
    evidence: [],
    affectedFiles: [
      { change: "edit", path: request.target.path, primary: true },
    ],
    renderedDiff: "reviewed diff",
    structuredDiff: [],
    warnings: [],
    diagnosticsAfterPreview: [],
    conflicts: [],
    refusalReasons: [],
    applyEligibility: { eligible: true, blockers: [] },
    staleness: { stale: false, reasons: [] },
    grantsApplyAuthority: false,
    authority: {
      workspaceId: request.authority.workspaceId,
      workspaceGeneration: request.authority.workspaceGeneration,
    },
    selectionGeneration: request.selectionGeneration,
    requestId: request.requestId,
    provider: "refactorkit",
    providerVersion: "0.3.0",
    ...overrides,
  };
}

function applyResultFor(
  plan: RefactorPreviewResult,
  overrides: Partial<RefactorApplyResult> = {},
): RefactorApplyResult {
  return {
    planId: plan.planId,
    operation: plan.operation,
    outcome: "applied",
    changedFiles: plan.affectedFiles,
    primaryFile: plan.target.path,
    diagnostics: [],
    transactionId: "tx-java-1",
    provider: "refactorkit",
    providerVersion: "0.3.0",
    ...overrides,
  };
}

function rollbackResultFor(
  transactionId: string,
  overrides: Partial<RefactorRollbackResult> = {},
): RefactorRollbackResult {
  return {
    transactionId,
    rolledBack: true,
    changedFiles: [],
    conflicts: [],
    diagnostics: [],
    ...overrides,
  };
}

function createHarness(caps = capabilities) {
  const order: string[] = [];
  const previewRefactoring = vi.fn(async (request: RefactorPreviewRequest) => {
    order.push("preview");
    return previewFor(request);
  });
  const applyRefactoring = vi.fn(
    async (request: Parameters<RefactorKitPort["applyRefactoring"]>[0]) => {
      order.push("apply");
      const previewRequest = previewRefactoring.mock.calls
        .map(([candidate]) => candidate)
        .find((candidate) => `plan-${candidate.requestId}` === request.planId);
      if (!previewRequest) throw new Error("missing preview fixture");
      return applyResultFor(previewFor(previewRequest));
    },
  );
  const rollbackRefactoring = vi.fn(
    async (request: Parameters<RefactorKitPort["rollbackRefactoring"]>[0]) => {
      order.push("rollback");
      return rollbackResultFor(request.transactionId);
    },
  );
  const discardRefactoring = vi.fn(
    async (request: Parameters<RefactorKitPort["discardRefactoring"]>[0]) => ({
      planId: request.planId,
      discarded: true,
    }),
  );
  const refactorKit = {
    previewRefactoring,
    applyRefactoring,
    rollbackRefactoring,
    discardRefactoring,
  } as unknown as RefactorKitPort;

  return {
    order,
    refactorKit,
    previewRefactoring,
    applyRefactoring,
    rollbackRefactoring,
    discardRefactoring,
    capabilities: caps,
  };
}

function renderController(
  harness: ReturnType<typeof createHarness>,
  workspaceId = "workspace-one",
  getWorkspaceGeneration?: () => number,
  capabilities: RefactorKitCapabilities | null = harness.capabilities,
) {
  return renderHook(() =>
    useJavaRefactoringController({
      refactorKit: harness.refactorKit,
      capabilities,
      workspaceId,
      getWorkspaceGeneration,
    }),
  );
}

function openIdle(
  controller: ReturnType<typeof renderController>,
  operation: RefactoringOperation = "rename-class",
  targetValue = target(),
) {
  act(() => controller.result.current.open(operation, targetValue));
  expect(controller.result.current.dialog).toMatchObject({
    status: "idle",
    operation,
    target: targetValue,
  });
  return controller.result.current.dialog!;
}

async function previewReady(
  controller: ReturnType<typeof renderController>,
  operation: RefactoringOperation = "rename-class",
  targetValue = target(),
) {
  openIdle(controller, operation, targetValue);
  let pending!: Promise<void>;
  act(() => {
    pending = controller.result.current.preview();
  });
  expect(controller.result.current.dialog).toMatchObject({ status: "loading" });
  await act(async () => pending);
  expect(controller.result.current.dialog).toMatchObject({ status: "preview" });
  return controller.result.current.dialog!.plan!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useJavaRefactoringController", () => {
  it("reports general refactoring unavailable before any native call when not advertised", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        supported: false,
        preview: false,
      },
    });
    const controller = renderController(harness);

    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: JAVA_REFACTORING_UNAVAILABLE,
      plan: null,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("reports unavailable when preview is not advertised even if the operation set is", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        preview: false,
      },
    });
    const controller = renderController(harness);

    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: JAVA_REFACTORING_UNAVAILABLE,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("reports unknown capabilities honestly when discovery has not loaded", async () => {
    const harness = createHarness();
    const controller = renderController(harness, "workspace-one", undefined, null);

    openIdle(controller);
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "unavailable",
      message: JAVA_REFACTORING_CAPABILITIES_UNKNOWN,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("refuses an operation not advertised without invoking the native preview", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: {
        ...capabilities.generalRefactoring!,
        operations: ["rename-class"],
      },
    });
    const controller = renderController(harness);

    openIdle(controller, "move-class");
    await act(() => controller.result.current.preview());

    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: JAVA_REFACTORING_OPERATION_NOT_OFFERED,
      plan: null,
    });
    expect(harness.previewRefactoring).not.toHaveBeenCalled();
  });

  it("previews read-only and applies only the exact displayed plan with source-free approval", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    expect(harness.order).toEqual(["preview"]);
    expect(harness.previewRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "rename-class",
        target: target(),
        authority: { workspaceId: "workspace-one", workspaceGeneration: expect.any(Number) },
      }),
    );
    expect(displayedPlan.grantsApplyAuthority).toBe(false);
    expect(controller.result.current.dialog?.plan?.status).toBe("ready");

    await act(() =>
      controller.result.current.applyDisplayedPlan({ ...displayedPlan, planId: "stale-plan" }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("preview");

    await act(async () => {
      await controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    expect(controller.result.current.dialog?.status).toBe("applied");
    expect(controller.result.current.successMessage).toContain("tx-java-1");

    const applyRequest = harness.applyRefactoring.mock.calls[0][0];
    expect(applyRequest).toEqual({
      planId: displayedPlan.planId,
      operation: displayedPlan.operation,
      target: displayedPlan.target,
      authority: {
        workspaceId: "workspace-one",
        workspaceGeneration: displayedPlan.authority.workspaceGeneration,
      },
      selectionGeneration: displayedPlan.selectionGeneration,
      requestId: displayedPlan.requestId,
      approval: {
        approvalId: `desktop-java-refactor-approval-${displayedPlan.requestId}`,
        approvedPlanId: displayedPlan.planId,
        approvedAt: expect.any(String),
      },
    });
    expect(applyRequest).not.toHaveProperty("code");
    expect(applyRequest).not.toHaveProperty("renderedDiff");
    expect(JSON.stringify(applyRequest)).not.toContain(displayedPlan.renderedDiff);
  });

  it("reports refused, stale, failed, and indeterminate apply outcomes honestly", async () => {
    const harness = createHarness();
    const controller = renderController(harness);

    for (const outcome of ["refused", "stale", "failed", "indeterminate"] as const) {
      const displayedPlan = await previewReady(controller);
      harness.applyRefactoring.mockResolvedValueOnce(applyResultFor(displayedPlan, { outcome }));
      await act(() => controller.result.current.applyDisplayedPlan(displayedPlan));
      if (outcome === "refused" || outcome === "stale") {
        expect(controller.result.current.dialog?.status).toBe("refused");
      } else {
        expect(controller.result.current.dialog?.status).toBe("error");
      }
      expect(controller.result.current.successMessage).toBeNull();
      expect(harness.applyRefactoring).toHaveBeenCalledTimes(
        ["refused", "stale", "failed", "indeterminate"].indexOf(outcome) + 1,
      );
    }
  });

  it("rolls back only when advertised and transaction-bound", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);
    await act(async () => {
      await controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    const appliedResult = controller.result.current.dialog!.result!;

    // No transactionId -> rollback refused without native call.
    await act(() => controller.result.current.rollback({ ...appliedResult, transactionId: undefined }));
    expect(harness.rollbackRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("error");

    // Re-open, preview, apply with a transaction-bound result.
    await previewReady(controller);
    await act(async () => {
      await controller.result.current.applyDisplayedPlan(controller.result.current.dialog!.plan!);
    });

    await act(async () => {
      await controller.result.current.rollback(controller.result.current.dialog!.result!);
    });
    expect(controller.result.current.dialog?.status).toBe("rolled-back");
    expect(harness.rollbackRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "tx-java-1",
        operation: "rename-class",
        authority: { workspaceId: "workspace-one", workspaceGeneration: expect.any(Number) },
      }),
    );
    expect(controller.result.current.successMessage).toContain("tx-java-1");
  });

  it("does not roll back when the provider does not advertise rollback", async () => {
    const harness = createHarness({
      ...capabilities,
      generalRefactoring: { ...capabilities.generalRefactoring!, rollback: false },
    });
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);
    await act(async () => {
      await controller.result.current.applyDisplayedPlan(displayedPlan);
    });

    await act(async () => {
      await controller.result.current.rollback(controller.result.current.dialog!.result!);
    });
    expect(harness.rollbackRefactoring).not.toHaveBeenCalled();
    expect(controller.result.current.dialog?.status).toBe("error");
  });

  it("discards the retained plan on cancel exactly once with source-free tokens", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    act(() => controller.result.current.cancel());
    act(() => controller.result.current.cancel());

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardRefactoring).toHaveBeenCalledOnce();
    const discardRequest = harness.discardRefactoring.mock.calls[0][0];
    expect(discardRequest).toEqual({
      planId: displayedPlan.planId,
      workspaceId: displayedPlan.authority.workspaceId,
      workspaceGeneration: displayedPlan.authority.workspaceGeneration,
      selectionGeneration: displayedPlan.selectionGeneration,
      requestId: displayedPlan.requestId,
    });
    expect(Object.keys(discardRequest).sort()).toEqual([
      "planId",
      "requestId",
      "selectionGeneration",
      "workspaceGeneration",
      "workspaceId",
    ]);
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("discardDisplayedPlan discards the retained plan and closes", async () => {
    const harness = createHarness();
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    act(() => controller.result.current.discardDisplayedPlan());

    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardRefactoring).toHaveBeenCalledOnce();
    expect(harness.discardRefactoring.mock.calls[0][0].planId).toBe(displayedPlan.planId);
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("rejects and discards a preview plan not correlated to the exact request", async () => {
    const harness = createHarness();
    harness.previewRefactoring.mockImplementationOnce(async (request) =>
      previewFor(request, { requestId: "other-request" }),
    );
    const controller = renderController(harness);

    openIdle(controller);
    await act(() => controller.result.current.preview());
    const request = harness.previewRefactoring.mock.calls[0][0];

    expect(controller.result.current.dialog).toMatchObject({
      status: "refused",
      message: JAVA_REFACTORING_STALE_SELECTION,
      plan: null,
    });
    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({ planId: `plan-${request.requestId}` }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("keeps only the newest operation/request when previews overlap", async () => {
    const harness = createHarness();
    const firstBackend = deferred<RefactorPreviewResult>();
    harness.previewRefactoring.mockImplementationOnce(() => firstBackend.promise);
    const controller = renderController(harness);

    openIdle(controller, "rename-class");
    let firstPreview!: Promise<void>;
    act(() => {
      firstPreview = controller.result.current.preview();
    });
    await waitFor(() => expect(harness.previewRefactoring).toHaveBeenCalledOnce());
    const firstRequest = harness.previewRefactoring.mock.calls[0][0];

    openIdle(controller, "move-class");
    await act(() => controller.result.current.preview());
    const secondRequest = harness.previewRefactoring.mock.calls[1][0];
    expect(secondRequest.requestId).not.toBe(firstRequest.requestId);
    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      plan: { planId: `plan-${secondRequest.requestId}` },
    });

    firstBackend.resolve(previewFor(firstRequest));
    await act(async () => firstPreview);

    expect(controller.result.current.dialog).toMatchObject({
      status: "preview",
      selection: { requestId: secondRequest.requestId },
      plan: { planId: `plan-${secondRequest.requestId}` },
    });
    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({ planId: `plan-${firstRequest.requestId}` }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("ignores a late apply after cancel and discards no applied result", async () => {
    const harness = createHarness();
    const backendApply = deferred<RefactorApplyResult>();
    harness.applyRefactoring.mockImplementationOnce(() => backendApply.promise);
    const controller = renderController(harness);
    const displayedPlan = await previewReady(controller);

    let applying!: Promise<void>;
    act(() => {
      applying = controller.result.current.applyDisplayedPlan(displayedPlan);
    });
    expect(controller.result.current.dialog?.status).toBe("applying");
    act(() => controller.result.current.cancel());
    expect(controller.result.current.dialog).toBeNull();

    backendApply.resolve(applyResultFor(displayedPlan));
    await act(async () => applying);

    expect(controller.result.current.dialog).toBeNull();
    expect(controller.result.current.successMessage).toBeNull();
  });

  it("resets the workspace, advances the local generation, and suppresses stale completion", async () => {
    const harness = createHarness();
    const oldBackend = deferred<RefactorPreviewResult>();
    harness.previewRefactoring.mockImplementationOnce(() => oldBackend.promise);
    const workspaceGeneration = 5;
    const controller = renderController(harness, "workspace-one", () => workspaceGeneration);

    openIdle(controller);
    let oldPreview!: Promise<void>;
    act(() => {
      oldPreview = controller.result.current.preview();
    });
    await waitFor(() => expect(harness.previewRefactoring).toHaveBeenCalledOnce());
    const oldRequest = harness.previewRefactoring.mock.calls[0][0];
    expect(oldRequest.authority.workspaceGeneration).toBe(5);

    act(() => controller.result.current.resetWorkspace());
    expect(controller.result.current.dialog).toBeNull();

    oldBackend.resolve(previewFor(oldRequest));
    await act(async () => oldPreview);
    expect(controller.result.current.dialog).toBeNull();
    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${oldRequest.requestId}`,
        workspaceGeneration: 5,
        requestId: oldRequest.requestId,
      }),
    );
  });

  it("invalidates on unmount and discards a late plan without continuing collaborators", async () => {
    const harness = createHarness();
    const backend = deferred<RefactorPreviewResult>();
    harness.previewRefactoring.mockImplementationOnce(() => backend.promise);
    const controller = renderController(harness);

    openIdle(controller);
    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.preview();
    });
    await waitFor(() => expect(harness.previewRefactoring).toHaveBeenCalledOnce());
    const request = harness.previewRefactoring.mock.calls[0][0];
    controller.unmount();

    backend.resolve(previewFor(request));
    await preview;

    expect(harness.discardRefactoring).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: `plan-${request.requestId}`,
        requestId: request.requestId,
      }),
    );
    expect(harness.applyRefactoring).not.toHaveBeenCalled();
  });

  it("updates operation and target only while the dialog is idle", () => {
    const harness = createHarness();
    const controller = renderController(harness);

    act(() => {
      controller.result.current.setOperation("move-class");
      controller.result.current.setTarget({ ...target(), path: "b.java" });
    });
    expect(controller.result.current.dialog).toBeNull();

    openIdle(controller);
    act(() => {
      controller.result.current.setOperation("safe-delete");
      controller.result.current.setTarget({ ...target(), kind: "local-binding" });
    });
    expect(controller.result.current.dialog).toMatchObject({
      status: "idle",
      operation: "safe-delete",
      target: { kind: "local-binding" },
    });
  });
});
