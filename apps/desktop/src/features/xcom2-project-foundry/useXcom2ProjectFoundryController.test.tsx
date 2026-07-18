import {
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryDestinationParentSelectionGrant,
  type Xcom2ProjectFoundryOperationGrant,
  type Xcom2ProjectFoundrySourceObjectEvidence,
  type Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useXcom2ProjectFoundryController,
  type ProjectFoundryComposition,
} from "./useXcom2ProjectFoundryController";

const sourceGrant: Xcom2ProjectFoundrySourceSelectionGrant = {
  kind: "source-repository",
  repository: "/scenario/empt-v1_4",
  identity: "source-grant-foundry-preview-001",
};
const destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant = {
  kind: "destination-parent",
  parent: "/scenario/foundry-output",
  identity: "destination-parent-grant-foundry-preview-001",
};
const operationGrant: Xcom2ProjectFoundryOperationGrant = {
  kind: "preview-operation",
  derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
  identity: "operation-grant-foundry-preview-001",
};
const sourceObject: Xcom2ProjectFoundrySourceObjectEvidence = {
  commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  fingerprintResult: "Verified",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createComposition(overrides: Partial<ProjectFoundryComposition> = {}) {
  const selectSourceRepository = vi.fn(async () => sourceGrant);
  const selectDestinationParent = vi.fn(async (_modId?: string) => ({
    destinationParentGrant,
    operationGrant,
  }));
  const resolvePinnedObject = vi.fn(async () => sourceObject);
  const inspectDerivedDestination = vi.fn(async () => "absent" as const);
  const revokeAll = vi.fn(async () => undefined);
  const composition: ProjectFoundryComposition = {
    selectors: { selectSourceRepository, selectDestinationParent },
    source: { resolvePinnedObject },
    destination: { inspectDerivedDestination },
    grants: { revokeAll },
    ...overrides,
  };
  return {
    composition,
    selectSourceRepository,
    selectDestinationParent,
    resolvePinnedObject,
    inspectDerivedDestination,
    revokeAll,
  };
}

async function selectInputs(
  controller: ReturnType<typeof renderFoundryController>,
  modId = "FoundryPreviewFixture",
): Promise<void> {
  act(() => controller.result.current.open());
  await act(() => controller.result.current.selectSourceRepository());
  await act(() => controller.result.current.selectDestinationParent());
  act(() => controller.result.current.setModId(modId));
}

function renderFoundryController(composition?: ProjectFoundryComposition) {
  return renderHook(() => useXcom2ProjectFoundryController(composition));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useXcom2ProjectFoundryController", () => {
  it("orchestrates exact provider evidence into a pure immutable preview and never offers apply", async () => {
    const harness = createComposition();
    const mutableSource = { ...sourceGrant };
    const mutableDestination = { ...destinationParentGrant };
    const mutableOperation = { ...operationGrant };
    harness.selectSourceRepository.mockResolvedValueOnce(mutableSource);
    harness.selectDestinationParent.mockResolvedValueOnce({
      destinationParentGrant: mutableDestination,
      operationGrant: mutableOperation,
    });
    const controller = renderFoundryController(harness.composition);

    await selectInputs(controller);
    mutableSource.repository = "/mutated/source";
    mutableDestination.parent = "/mutated/destination";
    mutableOperation.derivedDestination = "/mutated/output";

    await act(() => controller.result.current.preview("FoundryPreviewFixture"));

    expect(harness.selectDestinationParent).toHaveBeenCalledExactlyOnceWith("");
    expect(harness.resolvePinnedObject).toHaveBeenCalledWith(Object.freeze({ ...sourceGrant }));
    expect(harness.inspectDerivedDestination).toHaveBeenCalledWith(
      Object.freeze({ ...destinationParentGrant }),
      Object.freeze({ ...operationGrant }),
    );
    expect(controller.result.current.viewState.kind).toBe("ready");
    if (controller.result.current.viewState.kind !== "ready") throw new Error("Expected preview");
    const { plan } = controller.result.current.viewState;
    expect(plan.source.repository).toBe(sourceGrant.repository);
    expect(plan.project.modId).toBe("FoundryPreviewFixture");
    expect(plan.destination.parent).toBe(destinationParentGrant.parent);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.files)).toBe(true);
    expect(controller.result.current.creationState).toEqual({ kind: "unavailable" });
    expect(controller.result.current.apply).toEqual(expect.any(Function));
  });

  it("preserves the exact ModId and safely refuses invalid or destination-mismatched values", async () => {
    const harness = createComposition();
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller, " foundry ");

    await act(() => controller.result.current.preview(" foundry "));
    expect(controller.result.current.modId).toBe(" foundry ");
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "mod-id-invalid",
    });
    expect(harness.resolvePinnedObject).not.toHaveBeenCalled();

    act(() => controller.result.current.setModId("AnotherMod"));
    await act(() => controller.result.current.preview("AnotherMod"));
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "derived-destination-mismatched",
    });
  });

  it("maps private provider failures to phase-specific refusal codes without leaking messages", async () => {
    const privateMessage = "/home/private/source: permission denied; token=secret";
    const sourceFailure = createComposition({
      source: {
        resolvePinnedObject: vi.fn(async () => {
          throw new Error(privateMessage);
        }),
      },
    });
    const sourceController = renderFoundryController(sourceFailure.composition);
    await selectInputs(sourceController);
    await act(() => sourceController.result.current.preview("FoundryPreviewFixture"));
    expect(sourceController.result.current.viewState).toEqual({
      kind: "refused",
      code: "source-commit-unreadable",
    });
    expect(JSON.stringify(sourceController.result.current)).not.toContain(privateMessage);
    sourceController.unmount();

    const destinationFailure = createComposition({
      destination: {
        inspectDerivedDestination: vi.fn(async () => {
          throw new Error(privateMessage);
        }),
      },
    });
    const destinationController = renderFoundryController(destinationFailure.composition);
    await selectInputs(destinationController);
    await act(() => destinationController.result.current.preview("FoundryPreviewFixture"));
    expect(destinationController.result.current.viewState).toEqual({
      kind: "refused",
      code: "destination-parent-unavailable",
    });
    expect(JSON.stringify(destinationController.result.current)).not.toContain(privateMessage);
  });

  it("suppresses an older selector generation, revokes its authority, and publishes only the winner", async () => {
    const first = deferred<Xcom2ProjectFoundrySourceSelectionGrant>();
    const harness = createComposition();
    harness.selectSourceRepository
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ...sourceGrant, repository: "/scenario/winner" });
    const controller = renderFoundryController(harness.composition);
    act(() => controller.result.current.open());

    let stale!: Promise<void>;
    let winner!: Promise<void>;
    act(() => {
      stale = controller.result.current.selectSourceRepository();
    });
    await waitFor(() => expect(harness.selectSourceRepository).toHaveBeenCalledOnce());
    act(() => {
      winner = controller.result.current.selectSourceRepository();
    });
    first.resolve({ ...sourceGrant, repository: "/scenario/stale" });
    await act(async () => Promise.all([stale, winner]));

    expect(controller.result.current.sourceRepository).toBe("/scenario/winner");
    expect(harness.revokeAll).toHaveBeenCalledOnce();
  });

  it("serializes back-to-back selectors under StrictMode without prematurely revoking their grants", async () => {
    const sourceGate = deferred<Xcom2ProjectFoundrySourceSelectionGrant>();
    const harness = createComposition();
    harness.selectSourceRepository.mockImplementationOnce(() => sourceGate.promise);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const controller = renderHook(() => useXcom2ProjectFoundryController(harness.composition), {
      wrapper,
    });
    await waitFor(() => expect(harness.revokeAll).toHaveBeenCalledOnce());
    const strictModeRevocations = harness.revokeAll.mock.calls.length;
    act(() => controller.result.current.open());

    let sourceSelection!: Promise<void>;
    let destinationSelection!: Promise<void>;
    act(() => {
      sourceSelection = controller.result.current.selectSourceRepository();
      destinationSelection = controller.result.current.selectDestinationParent();
    });
    await waitFor(() => expect(harness.selectSourceRepository).toHaveBeenCalledOnce());
    expect(harness.selectDestinationParent).not.toHaveBeenCalled();

    sourceGate.resolve(sourceGrant);
    await act(async () => Promise.all([sourceSelection, destinationSelection]));

    expect(harness.selectDestinationParent).toHaveBeenCalledExactlyOnceWith("");
    expect(controller.result.current).toMatchObject({
      sourceRepository: sourceGrant.repository,
      destinationParent: destinationParentGrant.parent,
    });
    expect(harness.revokeAll).toHaveBeenCalledTimes(strictModeRevocations);
  });

  it("invalidates stale preview completion when the exact ModId changes", async () => {
    const sourceGate = deferred<Xcom2ProjectFoundrySourceObjectEvidence>();
    const harness = createComposition();
    harness.resolvePinnedObject.mockImplementationOnce(() => sourceGate.promise);
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.preview("FoundryPreviewFixture");
    });
    await waitFor(() => expect(harness.resolvePinnedObject).toHaveBeenCalledOnce());
    act(() => controller.result.current.setModId("NewExactMod"));
    sourceGate.resolve(sourceObject);
    await act(async () => preview);

    expect(harness.inspectDerivedDestination).not.toHaveBeenCalled();
    expect(controller.result.current.modId).toBe("NewExactMod");
    expect(controller.result.current.viewState).toEqual({ kind: "editing" });
  });

  it("cancels safely during source selection and leaves no remembered state after reopening", async () => {
    const sourceGate = deferred<Xcom2ProjectFoundrySourceSelectionGrant>();
    const harness = createComposition();
    harness.selectSourceRepository.mockImplementationOnce(() => sourceGate.promise);
    const controller = renderFoundryController(harness.composition);
    act(() => controller.result.current.open());

    let selection!: Promise<void>;
    let cancellation!: Promise<void>;
    act(() => {
      selection = controller.result.current.selectSourceRepository();
      cancellation = controller.result.current.cancel();
    });
    expect(controller.result.current.isOpen).toBe(false);
    sourceGate.resolve(sourceGrant);
    await act(async () => Promise.all([selection, cancellation]));
    expect(harness.revokeAll).toHaveBeenCalled();

    act(() => controller.result.current.open());
    expect(controller.result.current).toMatchObject({
      sourceRepository: "",
      destinationParent: "",
      modId: "",
      viewState: { kind: "editing" },
    });
  });

  it("cancels safely during destination selection", async () => {
    const destinationGate = deferred<{
      destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
      operationGrant: Xcom2ProjectFoundryOperationGrant;
    }>();
    const harness = createComposition();
    harness.selectDestinationParent.mockImplementationOnce(() => destinationGate.promise);
    const controller = renderFoundryController(harness.composition);
    act(() => controller.result.current.open());
    await act(() => controller.result.current.selectSourceRepository());

    let selection!: Promise<void>;
    let cancellation!: Promise<void>;
    act(() => {
      selection = controller.result.current.selectDestinationParent();
      cancellation = controller.result.current.cancel();
    });
    destinationGate.resolve({ destinationParentGrant, operationGrant });
    await act(async () => Promise.all([selection, cancellation]));

    expect(controller.result.current.isOpen).toBe(false);
    expect(harness.revokeAll).toHaveBeenCalled();
  });

  it("cancels safely during source resolution and skips destination inspection", async () => {
    const sourceGate = deferred<Xcom2ProjectFoundrySourceObjectEvidence>();
    const harness = createComposition();
    harness.resolvePinnedObject.mockImplementationOnce(() => sourceGate.promise);
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.preview("FoundryPreviewFixture");
    });
    await waitFor(() => expect(harness.resolvePinnedObject).toHaveBeenCalledOnce());
    let cancellation!: Promise<void>;
    act(() => {
      cancellation = controller.result.current.cancel();
    });
    sourceGate.resolve(sourceObject);
    await act(async () => Promise.all([preview, cancellation]));

    expect(harness.inspectDerivedDestination).not.toHaveBeenCalled();
    expect(controller.result.current.isOpen).toBe(false);
    expect(harness.revokeAll).toHaveBeenCalled();
  });

  it("cancels safely during destination inspection and cannot publish the stale plan", async () => {
    const destinationGate = deferred<"absent">();
    const harness = createComposition();
    harness.inspectDerivedDestination.mockImplementationOnce(() => destinationGate.promise);
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.preview("FoundryPreviewFixture");
    });
    await waitFor(() => expect(harness.inspectDerivedDestination).toHaveBeenCalledOnce());
    let cancellation!: Promise<void>;
    act(() => {
      cancellation = controller.result.current.cancel();
    });
    destinationGate.resolve("absent");
    await act(async () => Promise.all([preview, cancellation]));

    expect(controller.result.current.isOpen).toBe(false);
    expect(controller.result.current.viewState).toEqual({ kind: "editing" });
    expect(harness.revokeAll).toHaveBeenCalled();
  });

  it("discards a ready plan, revokes all grants, and remains stable under StrictMode", async () => {
    const harness = createComposition();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const controller = renderHook(() => useXcom2ProjectFoundryController(harness.composition), {
      wrapper,
    });
    await selectInputs(controller);
    await act(() => controller.result.current.preview("FoundryPreviewFixture"));
    expect(controller.result.current.viewState.kind).toBe("ready");

    await act(() => controller.result.current.cancel());
    expect(controller.result.current).toMatchObject({
      isOpen: false,
      sourceRepository: "",
      destinationParent: "",
      modId: "",
      viewState: { kind: "editing" },
    });
    expect(harness.selectSourceRepository).toHaveBeenCalledOnce();
    expect(harness.resolvePinnedObject).toHaveBeenCalledOnce();
    expect(harness.revokeAll).toHaveBeenCalled();
  });

  it("consumes exact approval synchronously before one port entry and snapshots a matching receipt", async () => {
    const applyGate = deferred<any>();
    let observedAtPortEntry: ReturnType<typeof renderFoundryController>["result"]["current"];
    const apply = vi.fn((_request: any) => {
      observedAtPortEntry = controller.result.current;
      return applyGate.promise;
    });
    const harness = createComposition({ apply });
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);
    await act(() => controller.result.current.preview("FoundryPreviewFixture"));
    expect(controller.result.current.creationState).toEqual({ kind: "ready" });
    expect(controller.result.current.finalProjectLocation).toBe(operationGrant.derivedDestination);
    expect(controller.result.current.applyState?.status).toBe("ready");
    const readyState = controller.result.current.applyState;
    if (readyState?.status !== "ready") throw new Error("Expected ready Apply state");
    const digest = readyState.preview.plan.planDigest;

    let first!: Promise<void>;
    let repeated!: Promise<void>;
    act(() => {
      first = controller.result.current.apply(digest);
      repeated = controller.result.current.apply(digest);
    });
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());

    expect(observedAtPortEntry!.creationState).toEqual({ kind: "creating" });
    expect(observedAtPortEntry!.applyState).toMatchObject({
      status: "applying",
      authority: "consumed",
    });
    const request = apply.mock.calls[0]?.[0];
    expect(request).toEqual({
      schemaVersion: 1,
      sourceGrant,
      destinationParentGrant,
      operationGrant,
      modId: "FoundryPreviewFixture",
      approvedPlanDigest: digest,
    });
    expect(Object.isFrozen(request)).toBe(true);

    const mutableReceipt = {
      result: "created" as const,
      planDigest: digest,
      finalProjectLocation: operationGrant.derivedDestination,
      sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
      sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
      committedDirectories: readyState.preview.plan.directories.length,
      committedFiles: readyState.preview.plan.files.length,
    };
    applyGate.resolve(mutableReceipt);
    await act(async () => Promise.all([first, repeated]));
    mutableReceipt.finalProjectLocation = "/mutated/provider/location";

    expect(apply).toHaveBeenCalledOnce();
    expect(controller.result.current.applyState).toMatchObject({
      status: "created",
      authority: "consumed",
    });
    expect(controller.result.current.creationState).toMatchObject({
      kind: "created",
      receipt: { finalProjectLocation: operationGrant.derivedDestination },
    });
    expect(Object.isFrozen(controller.result.current.creationState)).toBe(false);
    if (controller.result.current.creationState.kind !== "created") {
      throw new Error("Expected created presentation");
    }
    expect(Object.isFrozen(controller.result.current.creationState.receipt)).toBe(true);
    expect(controller.result.current).toMatchObject({
      sourceRepository: sourceGrant.repository,
      destinationParent: destinationParentGrant.parent,
      modId: "FoundryPreviewFixture",
      finalProjectLocation: operationGrant.derivedDestination,
      viewState: { kind: "ready" },
    });
    expect(harness.revokeAll).toHaveBeenCalledOnce();

    await act(() => controller.result.current.preview("FoundryPreviewFixture"));
    await act(() => controller.result.current.apply(digest));
    expect(apply).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "source",
      (controller: ReturnType<typeof renderFoundryController>) =>
        controller.result.current.selectSourceRepository(),
    ],
    [
      "destination",
      (controller: ReturnType<typeof renderFoundryController>) =>
        controller.result.current.selectDestinationParent(),
    ],
    [
      "ModId",
      (controller: ReturnType<typeof renderFoundryController>) =>
        Promise.resolve(controller.result.current.setModId("ChangedMod")),
    ],
  ] as const)("invalidates ready approval immediately on %s change", async (_name, change) => {
    const apply = vi.fn();
    const harness = createComposition({ apply });
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);
    await act(() => controller.result.current.preview("FoundryPreviewFixture"));
    expect(controller.result.current.creationState).toEqual({ kind: "ready" });

    let changePromise!: Promise<void>;
    act(() => {
      changePromise = change(controller);
    });
    expect(controller.result.current.creationState).toEqual({ kind: "consumed" });
    expect(controller.result.current.applyState).toBeNull();
    await act(async () => changePromise);
    expect(apply).not.toHaveBeenCalled();
  });

  it("consumes mismatched receipts and safely reduces typed refusals and failures", async () => {
    const cases = [
      {
        result: {
          result: "created" as const,
          planDigest: "b".repeat(64),
          finalProjectLocation: operationGrant.derivedDestination,
          sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
          sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
          committedDirectories: 12,
          committedFiles: 27,
        },
        expectedStatus: "applying",
      },
      {
        result: {
          result: "refused" as const,
          phase: "pre-commit" as const,
          reason: "Safe refusal",
        },
        expectedStatus: "refused",
      },
      {
        result: { result: "failed" as const, phase: "pre-commit" as const, reason: "Safe failure" },
        expectedStatus: "failed",
      },
    ];

    for (const scenario of cases) {
      const harness = createComposition({ apply: vi.fn(async () => scenario.result as any) });
      const controller = renderFoundryController(harness.composition);
      await selectInputs(controller);
      await act(() => controller.result.current.preview("FoundryPreviewFixture"));
      const ready = controller.result.current.applyState;
      if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
      await act(() => controller.result.current.apply(ready.preview.plan.planDigest));

      expect(controller.result.current.creationState).toEqual({ kind: "consumed" });
      expect(controller.result.current.applyState?.status).toBe(scenario.expectedStatus);
      expect(harness.revokeAll).toHaveBeenCalledOnce();
      controller.unmount();
    }
  });

  it("maps thrown provider failures to a fixed safe failure without exposing the cause", async () => {
    const privateCause = "/private/output token=raw-secret";
    const harness = createComposition({
      apply: vi.fn(async () => {
        throw new Error(privateCause);
      }),
    });
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);
    await act(() => controller.result.current.preview("FoundryPreviewFixture"));
    const ready = controller.result.current.applyState;
    if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
    await act(() => controller.result.current.apply(ready.preview.plan.planDigest));

    expect(controller.result.current.applyState).toMatchObject({
      status: "failed",
      failure: { reason: "Project creation failed safely." },
    });
    expect(JSON.stringify(controller.result.current)).not.toContain(privateCause);
  });

  it("suppresses a pending completion after cancel, composition replacement, and unmount", async () => {
    for (const invalidation of ["cancel", "composition", "unmount"] as const) {
      const gate = deferred<any>();
      const first = createComposition({ apply: vi.fn(() => gate.promise) });
      const second = createComposition({ apply: vi.fn() });
      const hook = renderHook(
        ({ composition }: { composition: ProjectFoundryComposition }) =>
          useXcom2ProjectFoundryController(composition),
        { initialProps: { composition: first.composition } },
      );
      act(() => hook.result.current.open());
      await act(() => hook.result.current.selectSourceRepository());
      await act(() => hook.result.current.selectDestinationParent());
      act(() => hook.result.current.setModId("FoundryPreviewFixture"));
      await act(() => hook.result.current.preview("FoundryPreviewFixture"));
      const ready = hook.result.current.applyState;
      if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
      let pending!: Promise<void>;
      act(() => {
        pending = hook.result.current.apply(ready.preview.plan.planDigest);
      });
      await waitFor(() => expect(first.composition.apply).toHaveBeenCalledOnce());

      let cancellation: Promise<void> | undefined;
      if (invalidation === "cancel") {
        act(() => {
          cancellation = hook.result.current.cancel();
        });
      } else if (invalidation === "composition") {
        hook.rerender({ composition: second.composition });
      } else {
        hook.unmount();
      }
      gate.resolve({
        result: "created",
        planDigest: ready.preview.plan.planDigest,
        finalProjectLocation: operationGrant.derivedDestination,
        sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
        sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
        committedDirectories: 12,
        committedFiles: 27,
      });
      await act(async () => {
        await pending;
        await cancellation;
      });
      if (invalidation !== "unmount") {
        expect(hook.result.current.isOpen).toBe(false);
        expect(hook.result.current.creationState).toEqual({ kind: "unavailable" });
      }
      expect(first.revokeAll).toHaveBeenCalled();
      if (invalidation !== "unmount") hook.unmount();
    }
  });

  it("refuses an absent composition safely and contains no native/Tauri dependency", async () => {
    const controller = renderFoundryController();
    act(() => controller.result.current.open());
    await act(() => controller.result.current.selectSourceRepository());
    expect(controller.result.current.sourceRepository).toBe("");
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "source-grant-invalid",
    });

    const productionSource = readFileSync(
      resolve(
        process.cwd(),
        "apps/desktop/src/features/xcom2-project-foundry/useXcom2ProjectFoundryController.ts",
      ),
      "utf8",
    );
    expect(productionSource).not.toMatch(/@tauri-apps|invoke\s*\(/u);
  });
});
