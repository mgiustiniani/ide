import {
  XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryApplyResult,
  type Xcom2ProjectFoundryDestinationParentSelectionGrant,
  type Xcom2ProjectFoundryRenderedPlanResult,
  type Xcom2ProjectFoundryRenderRequest,
  type Xcom2ProjectFoundrySourceSelectionGrant,
} from "@ide/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RENDERED_FIXTURES } from "../../../../../tests/spec/support/xcom2-project-foundry-rendered-fixtures";
import {
  useXcom2ProjectFoundryController,
  type ProjectFoundryComposition,
  type Xcom2ProjectFoundryController,
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
const initialRendered = RENDERED_FIXTURES[0]
  .rendered as Readonly<Xcom2ProjectFoundryRenderedPlanResult>;
const replacementRendered = RENDERED_FIXTURES[1]
  .rendered as Readonly<Xcom2ProjectFoundryRenderedPlanResult>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cloneRendered(
  rendered: Readonly<Xcom2ProjectFoundryRenderedPlanResult>,
): Xcom2ProjectFoundryRenderedPlanResult {
  return structuredClone(rendered);
}

function createComposition(overrides: Partial<ProjectFoundryComposition> = {}) {
  const selectSourceRepository = vi.fn(async () => sourceGrant);
  const selectDestinationParent = vi.fn(async () => destinationParentGrant);
  const renderPreview = vi.fn(async (request: Readonly<Xcom2ProjectFoundryRenderRequest>) =>
    cloneRendered(request.modId === "Mod_1" ? replacementRendered : initialRendered),
  );
  const revokeOperation = vi.fn(async () => undefined);
  const revokeAll = vi.fn(async () => undefined);
  const composition: ProjectFoundryComposition = {
    selectors: { selectSourceRepository, selectDestinationParent },
    renderer: { renderPreview },
    grants: { revokeOperation, revokeAll },
    ...overrides,
  };
  return {
    composition,
    selectSourceRepository,
    selectDestinationParent,
    renderPreview,
    revokeOperation,
    revokeAll,
  };
}

function renderFoundryController(composition?: ProjectFoundryComposition) {
  return renderHook(() => useXcom2ProjectFoundryController(composition));
}

type FoundryControllerHandle = {
  readonly result: { readonly current: Xcom2ProjectFoundryController };
};

async function selectInputs(
  controller: FoundryControllerHandle,
  modId = "FoundryPreviewFixture",
): Promise<void> {
  act(() => controller.result.current.open());
  await act(() => controller.result.current.selectSourceRepository());
  await act(() => controller.result.current.selectDestinationParent());
  act(() => controller.result.current.setModId(modId));
}

async function renderReady(
  controller: FoundryControllerHandle,
  modId = "FoundryPreviewFixture",
): Promise<void> {
  await selectInputs(controller, modId);
  await act(() => controller.result.current.preview(modId));
  expect(controller.result.current.viewState.kind).toBe("ready");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useXcom2ProjectFoundryController", () => {
  it("sends only copied source/parent/ModId authority to native rendering and validates its result", async () => {
    const harness = createComposition();
    const mutableSource = { ...sourceGrant };
    const mutableDestination = { ...destinationParentGrant };
    harness.selectSourceRepository.mockResolvedValueOnce(mutableSource);
    harness.selectDestinationParent.mockResolvedValueOnce(mutableDestination);
    const controller = renderFoundryController(harness.composition);

    await selectInputs(controller);
    mutableSource.repository = "/mutated/source";
    mutableDestination.parent = "/mutated/destination";
    await act(() => controller.result.current.preview("FoundryPreviewFixture"));

    expect(harness.selectDestinationParent).toHaveBeenCalledExactlyOnceWith();
    expect(harness.renderPreview).toHaveBeenCalledExactlyOnceWith({
      sourceGrant,
      destinationParentGrant,
      modId: "FoundryPreviewFixture",
    });
    const request = harness.renderPreview.mock.calls[0]?.[0];
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request?.sourceGrant)).toBe(true);
    expect(controller.result.current.viewState.kind).toBe("ready");
    if (controller.result.current.viewState.kind !== "ready") throw new Error("Expected preview");
    expect(controller.result.current.viewState.plan.source.repository).toBe(sourceGrant.repository);
    expect(controller.result.current.finalProjectLocation).toBe(
      initialRendered.operationGrant.derivedDestination,
    );
    expect(controller.result.current.applyState).toMatchObject({
      status: "ready",
      current: { operationGrant: initialRendered.operationGrant },
    });
    expect(Object.isFrozen(controller.result.current.viewState.plan)).toBe(true);
    expect(controller.result.current.creationState).toEqual({ kind: "unavailable" });
  });

  it("rejects an inexact source selector result and revokes all supplied authority", async () => {
    const harness = createComposition();
    harness.selectSourceRepository.mockResolvedValueOnce({
      ...sourceGrant,
      unsupported: true,
    } as never);
    const controller = renderFoundryController(harness.composition);
    act(() => controller.result.current.open());

    await act(() => controller.result.current.selectSourceRepository());

    expect(controller.result.current.sourceRepository).toBe("");
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "source-grant-invalid",
    });
    expect(harness.revokeAll).toHaveBeenCalledOnce();
  });

  it("rejects an unsafe destination selector object without exposing its accessor cause", async () => {
    const privateCause = "/private/destination token=secret";
    const harness = createComposition();
    harness.selectDestinationParent.mockResolvedValueOnce(
      Object.defineProperty({}, "kind", {
        enumerable: true,
        get() {
          throw new Error(privateCause);
        },
      }) as never,
    );
    const controller = renderFoundryController(harness.composition);
    act(() => controller.result.current.open());
    await act(() => controller.result.current.selectSourceRepository());

    await act(() => controller.result.current.selectDestinationParent());

    expect(controller.result.current.destinationParent).toBe("");
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "destination-parent-grant-invalid",
    });
    expect(JSON.stringify(controller.result.current)).not.toContain(privateCause);
    expect(harness.revokeAll).toHaveBeenCalledOnce();
  });

  it("preserves exact ModId text and refuses invalid values before native rendering", async () => {
    const harness = createComposition();
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller, " foundry ");

    await act(() => controller.result.current.preview(" foundry "));

    expect(controller.result.current.modId).toBe(" foundry ");
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "mod-id-invalid",
    });
    expect(harness.renderPreview).not.toHaveBeenCalled();
    expect(harness.revokeOperation).not.toHaveBeenCalled();
  });

  it("exposes only a parent-derived informational Linux location before preview and clears it on invalidation", async () => {
    const destinationReplacement = deferred<Xcom2ProjectFoundryDestinationParentSelectionGrant>();
    const harness = createComposition();
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    expect(controller.result.current.finalProjectLocation).toBe(
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
    expect(controller.result.current.applyState).toBeNull();

    act(() => controller.result.current.setModId(" invalid "));
    expect(controller.result.current.finalProjectLocation).toBe("");

    act(() => controller.result.current.setModId("FoundryPreviewFixture"));
    expect(controller.result.current.finalProjectLocation).toBe(
      "/scenario/foundry-output/FoundryPreviewFixture",
    );

    harness.selectDestinationParent.mockImplementationOnce(() => destinationReplacement.promise);
    let replacingDestination!: Promise<void>;
    act(() => {
      replacingDestination = controller.result.current.selectDestinationParent();
    });
    expect(controller.result.current.finalProjectLocation).toBe("");
    await waitFor(() => expect(harness.selectDestinationParent).toHaveBeenCalledTimes(2));
    destinationReplacement.resolve({ ...destinationParentGrant, parent: "/" });
    await act(async () => replacingDestination);
    expect(controller.result.current.finalProjectLocation).toBe("/FoundryPreviewFixture");

    let replacingSource!: Promise<void>;
    act(() => {
      replacingSource = controller.result.current.selectSourceRepository();
    });
    expect(controller.result.current.finalProjectLocation).toBe("");
    await act(async () => replacingSource);
    expect(controller.result.current.destinationParent).toBe("/");
    expect(controller.result.current.finalProjectLocation).toBe("/FoundryPreviewFixture");

    await act(() => controller.result.current.cancel());
    expect(controller.result.current.finalProjectLocation).toBe("");
  });

  it("passes closed native refusals through and maps thrown or malformed renders safely", async () => {
    const privateMessage = "/private/native/source token=secret";
    const cases: readonly [unknown, { kind: "refused"; code: string }][] = [
      [
        { kind: "refused", code: "source-tree-mismatched" },
        { kind: "refused", code: "source-tree-mismatched" },
      ],
      [
        { kind: "rendered", privateMessage },
        { kind: "refused", code: "rendered-plan-invalid" },
      ],
    ];
    for (const [providerResult, expected] of cases) {
      const harness = createComposition({
        renderer: { renderPreview: vi.fn(async () => providerResult as never) },
      });
      const controller = renderFoundryController(harness.composition);
      await selectInputs(controller);
      await act(() => controller.result.current.preview("FoundryPreviewFixture"));
      expect(controller.result.current.viewState).toEqual(expected);
      expect(JSON.stringify(controller.result.current)).not.toContain(privateMessage);
      controller.unmount();
    }

    const thrown = createComposition({
      renderer: {
        renderPreview: vi.fn(async () => {
          throw new Error(privateMessage);
        }),
      },
    });
    const controller = renderFoundryController(thrown.composition);
    await selectInputs(controller);
    await act(() => controller.result.current.preview("FoundryPreviewFixture"));
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "rendered-plan-invalid",
    });
    expect(JSON.stringify(controller.result.current)).not.toContain(privateMessage);
  });

  it("treats an inexact native refusal as rendered-plan-invalid and revokes possible operation authority", async () => {
    const harness = createComposition({
      renderer: {
        renderPreview: vi.fn(async () => ({
          kind: "refused",
          code: "source-tree-mismatched",
          privateDetail: "/private/native/detail",
        })),
      },
    });
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    await act(() => controller.result.current.preview("FoundryPreviewFixture"));

    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "rendered-plan-invalid",
    });
    expect(controller.result.current.finalProjectLocation).toBe(
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
    expect(controller.result.current.applyState).toBeNull();
    expect(harness.revokeOperation.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("awaits queued ModId revocation, executes the current render exactly once, and retains no old operation", async () => {
    const revocation = deferred<undefined>();
    const harness = createComposition();
    harness.revokeOperation.mockImplementationOnce(() => revocation.promise);
    const controller = renderFoundryController(harness.composition);
    await renderReady(controller);
    const revocationsBeforeChange = harness.revokeOperation.mock.calls.length;

    act(() => controller.result.current.setModId("Mod_1"));

    expect(harness.revokeOperation).toHaveBeenCalledTimes(revocationsBeforeChange + 1);
    expect(controller.result.current).toMatchObject({
      sourceRepository: sourceGrant.repository,
      destinationParent: destinationParentGrant.parent,
      modId: "Mod_1",
      finalProjectLocation: "/scenario/foundry-output/Mod_1",
      viewState: { kind: "editing" },
      creationState: { kind: "consumed" },
      applyState: null,
    });

    let replacement!: Promise<void>;
    act(() => {
      replacement = controller.result.current.preview("Mod_1");
    });
    await Promise.resolve();
    expect(harness.renderPreview).toHaveBeenCalledOnce();
    revocation.resolve(undefined);
    await act(async () => replacement);

    expect(harness.renderPreview).toHaveBeenCalledTimes(2);
    expect(harness.renderPreview.mock.calls[1]?.[0]).toMatchObject({ modId: "Mod_1" });
    expect(controller.result.current.finalProjectLocation).toBe(
      replacementRendered.operationGrant.derivedDestination,
    );
    expect(controller.result.current.applyState).toMatchObject({
      status: "ready",
      current: { operationGrant: replacementRendered.operationGrant },
    });
    expect(JSON.stringify(controller.result.current.applyState)).not.toContain(
      initialRendered.operationGrant.identity,
    );
  });

  it("narrowly revokes a current operation before rendering the same ModId again", async () => {
    const gate = deferred<undefined>();
    const harness = createComposition();
    const controller = renderFoundryController(harness.composition);
    await renderReady(controller);
    const baseline = harness.revokeOperation.mock.calls.length;
    harness.revokeOperation.mockImplementationOnce(() => gate.promise);

    let repeated!: Promise<void>;
    act(() => {
      repeated = controller.result.current.preview("FoundryPreviewFixture");
    });
    expect(controller.result.current.finalProjectLocation).toBe(
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
    expect(harness.revokeOperation).toHaveBeenCalledTimes(baseline + 1);
    await Promise.resolve();
    expect(harness.renderPreview).toHaveBeenCalledOnce();
    gate.resolve(undefined);
    await act(async () => repeated);

    expect(harness.renderPreview).toHaveBeenCalledTimes(2);
    expect(controller.result.current.viewState.kind).toBe("ready");
  });

  it("suppresses a stale render, revokes any late operation, and publishes only the next generation", async () => {
    const stale = deferred<Xcom2ProjectFoundryRenderedPlanResult>();
    const harness = createComposition();
    harness.renderPreview
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce(cloneRendered(replacementRendered));
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    let initial!: Promise<void>;
    act(() => {
      initial = controller.result.current.preview("FoundryPreviewFixture");
    });
    await waitFor(() => expect(harness.renderPreview).toHaveBeenCalledOnce());
    act(() => controller.result.current.setModId("Mod_1"));
    let replacement!: Promise<void>;
    act(() => {
      replacement = controller.result.current.preview("Mod_1");
    });
    stale.resolve(cloneRendered(initialRendered));
    await act(async () => Promise.all([initial, replacement]));

    expect(controller.result.current.viewState.kind).toBe("ready");
    if (controller.result.current.viewState.kind !== "ready") throw new Error("Expected preview");
    expect(controller.result.current.viewState.plan.project.modId).toBe("Mod_1");
    expect(harness.revokeOperation.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("serializes back-to-back parent-only selectors under StrictMode", async () => {
    const sourceGate = deferred<Xcom2ProjectFoundrySourceSelectionGrant>();
    const harness = createComposition();
    harness.selectSourceRepository.mockImplementationOnce(() => sourceGate.promise);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const controller = renderHook(() => useXcom2ProjectFoundryController(harness.composition), {
      wrapper,
    });
    await waitFor(() => expect(harness.revokeAll).toHaveBeenCalledOnce());
    const strictRevocations = harness.revokeAll.mock.calls.length;
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

    expect(harness.selectDestinationParent).toHaveBeenCalledExactlyOnceWith();
    expect(controller.result.current).toMatchObject({
      sourceRepository: sourceGrant.repository,
      destinationParent: destinationParentGrant.parent,
    });
    expect(harness.revokeAll).toHaveBeenCalledTimes(strictRevocations);
  });

  it.each(["source", "destination"] as const)(
    "revokes all and clears the other selection when replacing %s authority",
    async (selection) => {
      const harness = createComposition();
      const controller = renderFoundryController(harness.composition);
      await renderReady(controller);
      const revocations = harness.revokeAll.mock.calls.length;

      if (selection === "source") {
        await act(() => controller.result.current.selectSourceRepository());
        expect(controller.result.current.sourceRepository).toBe(sourceGrant.repository);
        expect(controller.result.current.destinationParent).toBe("");
      } else {
        await act(() => controller.result.current.selectDestinationParent());
        expect(controller.result.current.sourceRepository).toBe("");
        expect(controller.result.current.destinationParent).toBe(destinationParentGrant.parent);
      }
      expect(controller.result.current.finalProjectLocation).toBe(
        selection === "source" ? "" : "/scenario/foundry-output/FoundryPreviewFixture",
      );
      expect(controller.result.current.applyState).toBeNull();
      expect(harness.revokeAll).toHaveBeenCalledTimes(revocations + 1);
    },
  );

  it("suppresses an older selector generation and revokes its authority", async () => {
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

  it("cancels a pending render without publishing stale data and revokes all grants", async () => {
    const gate = deferred<Xcom2ProjectFoundryRenderedPlanResult>();
    const harness = createComposition({ renderer: { renderPreview: vi.fn(() => gate.promise) } });
    const controller = renderFoundryController(harness.composition);
    await selectInputs(controller);

    let preview!: Promise<void>;
    act(() => {
      preview = controller.result.current.preview("FoundryPreviewFixture");
    });
    await waitFor(() => expect(harness.composition.renderer.renderPreview).toHaveBeenCalledOnce());
    let cancellation!: Promise<void>;
    act(() => {
      cancellation = controller.result.current.cancel();
    });
    expect(controller.result.current.isOpen).toBe(false);
    gate.resolve(cloneRendered(initialRendered));
    await act(async () => Promise.all([preview, cancellation]));

    expect(controller.result.current).toMatchObject({
      isOpen: false,
      sourceRepository: "",
      destinationParent: "",
      finalProjectLocation: "",
      viewState: { kind: "editing" },
    });
    expect(harness.revokeAll).toHaveBeenCalled();
  });

  it("builds Apply state from the renderer-minted operation and consumes one exact request", async () => {
    const applyGate = deferred<Xcom2ProjectFoundryApplyResult>();
    let observedAtEntry: ReturnType<typeof renderFoundryController>["result"]["current"];
    const apply = vi.fn(() => {
      observedAtEntry = controller.result.current;
      return applyGate.promise;
    });
    const harness = createComposition({ apply });
    const controller = renderFoundryController(harness.composition);
    await renderReady(controller);
    const ready = controller.result.current.applyState;
    if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
    const digest = ready.preview.plan.planDigest;

    let first!: Promise<void>;
    let repeated!: Promise<void>;
    act(() => {
      first = controller.result.current.apply(digest);
      repeated = controller.result.current.apply(digest);
    });
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(observedAtEntry!).toMatchObject({
      creationState: { kind: "creating" },
      applyState: { status: "applying", authority: "consumed" },
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      schemaVersion: 1,
      sourceGrant,
      destinationParentGrant,
      operationGrant: initialRendered.operationGrant,
      modId: "FoundryPreviewFixture",
      approvedPlanDigest: digest,
    });

    applyGate.resolve({
      result: "created",
      planDigest: digest,
      finalProjectLocation: initialRendered.operationGrant.derivedDestination,
      sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
      sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
      committedDirectories: initialRendered.planBody.directories.length,
      committedFiles: initialRendered.planBody.files.length,
    });
    await act(async () => Promise.all([first, repeated]));

    expect(controller.result.current.creationState).toMatchObject({
      kind: "created",
      receipt: { finalProjectLocation: initialRendered.operationGrant.derivedDestination },
    });
    expect(harness.revokeAll).toHaveBeenCalledOnce();
    await act(() => controller.result.current.apply(digest));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("publishes exact destination attention synchronously, retains context, and makes every creation callback terminal", async () => {
    const applyGate = deferred<Xcom2ProjectFoundryApplyResult>();
    const revocationGate = deferred<undefined>();
    const apply = vi.fn(() => applyGate.promise);
    const harness = createComposition({ apply });
    harness.revokeAll.mockImplementationOnce(() => revocationGate.promise);
    const controller = renderFoundryController(harness.composition);
    await renderReady(controller);
    const ready = controller.result.current.applyState;
    if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
    const reviewed = {
      sourceRepository: controller.result.current.sourceRepository,
      destinationParent: controller.result.current.destinationParent,
      modId: controller.result.current.modId,
      finalProjectLocation: controller.result.current.finalProjectLocation,
      viewState: controller.result.current.viewState,
    };

    let pending!: Promise<void>;
    act(() => {
      pending = controller.result.current.apply(ready.preview.plan.planDigest);
    });
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
    await act(async () => {
      applyGate.resolve({
        result: "refused",
        phase: "pre-commit",
        reason: "destination-present",
      });
      await applyGate.promise;
      await Promise.resolve();
    });

    expect(controller.result.current.creationState).toEqual({
      kind: "attention",
      presentation: XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
      terminalDecision: {
        kind: "terminal",
        authority: "consumed",
        preview: "retained-context",
        disabledControls: [
          "source-selection",
          "destination-selection",
          "mod-id",
          "preview",
          "create",
        ],
        enabledControls: ["cancel"],
      },
    });
    expect(controller.result.current.applyState).toMatchObject({
      status: "refused",
      authority: "consumed",
      preview: ready.preview,
    });
    expect(controller.result.current).toMatchObject(reviewed);
    expect(harness.revokeAll).toHaveBeenCalledOnce();

    const sourceCalls = harness.selectSourceRepository.mock.calls.length;
    const destinationCalls = harness.selectDestinationParent.mock.calls.length;
    const renderCalls = harness.renderPreview.mock.calls.length;
    await act(async () => {
      controller.result.current.setModId("ProgrammaticRetry");
      await Promise.all([
        controller.result.current.selectSourceRepository(),
        controller.result.current.selectDestinationParent(),
        controller.result.current.preview("ProgrammaticRetry"),
        controller.result.current.apply(ready.preview.plan.planDigest),
      ]);
    });
    expect(harness.selectSourceRepository).toHaveBeenCalledTimes(sourceCalls);
    expect(harness.selectDestinationParent).toHaveBeenCalledTimes(destinationCalls);
    expect(harness.renderPreview).toHaveBeenCalledTimes(renderCalls);
    expect(apply).toHaveBeenCalledOnce();
    expect(controller.result.current).toMatchObject(reviewed);

    revocationGate.resolve(undefined);
    await act(async () => pending);
  });

  it.each([
    {
      name: "exact generic failure",
      provider: {
        result: "failed",
        phase: "pre-commit",
        reason: "RAW_PROVIDER_REASON /tmp/private-stage errno=17",
      },
    },
    {
      name: "exact generic refusal",
      provider: {
        result: "refused",
        phase: "pre-commit",
        reason: "RAW_PROVIDER_REASON",
      },
    },
    {
      name: "exact recovery-required result",
      provider: {
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: "b".repeat(64),
        finalProjectLocation: "/tmp/private-recovery-destination",
        reason: "RAW_PROVIDER_REASON",
      },
    },
    {
      name: "malformed conflict refusal",
      provider: {
        result: "refused",
        phase: "pre-commit",
        reason: "destination-present",
        rawCause: "RAW_CAUSE_CANARY /home/scenario-owner/private",
      },
    },
  ])("maps $name to fixed generic terminal attention without disclosure", async ({ provider }) => {
    const harness = createComposition({ apply: vi.fn(async () => provider as never) });
    const controller = renderFoundryController(harness.composition);
    await renderReady(controller);
    const ready = controller.result.current.applyState;
    if (ready?.status !== "ready") throw new Error("Expected ready Apply state");

    await act(() => controller.result.current.apply(ready.preview.plan.planDigest));

    expect(controller.result.current.applyState).toMatchObject({
      status: "refused",
      authority: "consumed",
      preview: ready.preview,
      refusal: { reason: "Project creation failed safely." },
    });
    expect(controller.result.current.creationState).toEqual({
      kind: "attention",
      presentation: XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
      terminalDecision: {
        kind: "terminal",
        authority: "consumed",
        preview: "retained-context",
        disabledControls: [
          "source-selection",
          "destination-selection",
          "mod-id",
          "preview",
          "create",
        ],
        enabledControls: ["cancel"],
      },
    });
    expect(JSON.stringify(controller.result.current.creationState)).not.toMatch(
      /RAW_PROVIDER_REASON|RAW_CAUSE_CANARY|private-stage|private-recovery|scenario-owner|errno/u,
    );
    expect(harness.revokeAll).toHaveBeenCalledOnce();
    controller.unmount();
  });

  it("maps thrown Apply causes to generic terminal attention without leaking provider causes", async () => {
    const privateCause = "/private/output token=raw-secret";
    const harness = createComposition({
      apply: vi.fn(async () => {
        throw new Error(privateCause);
      }),
    });
    const controller = renderFoundryController(harness.composition);
    await renderReady(controller);
    const ready = controller.result.current.applyState;
    if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
    await act(() => controller.result.current.apply(ready.preview.plan.planDigest));

    expect(controller.result.current.applyState).toMatchObject({
      status: "refused",
      authority: "consumed",
      preview: ready.preview,
      refusal: { reason: "Project creation failed safely." },
    });
    expect(controller.result.current.creationState).toEqual({
      kind: "attention",
      presentation: XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
      terminalDecision: expect.objectContaining({ enabledControls: ["cancel"] }),
    });
    expect(JSON.stringify(controller.result.current)).not.toContain(privateCause);
  });

  it("suppresses pending Apply completion after cancel, composition replacement, and unmount", async () => {
    for (const invalidation of ["cancel", "composition", "unmount"] as const) {
      const gate = deferred<Xcom2ProjectFoundryApplyResult>();
      const first = createComposition({ apply: vi.fn(() => gate.promise) });
      const second = createComposition({ apply: vi.fn() });
      const hook = renderHook(
        ({ composition }: { composition: ProjectFoundryComposition }) =>
          useXcom2ProjectFoundryController(composition),
        { initialProps: { composition: first.composition } },
      );
      await renderReady(hook);
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
        finalProjectLocation: initialRendered.operationGrant.derivedDestination,
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
        hook.unmount();
      }
      expect(first.revokeAll).toHaveBeenCalled();
    }
  });

  it.each(["composition", "unmount"] as const)(
    "suppresses stale terminal attention after %s invalidation while still revoking authority",
    async (invalidation) => {
      const gate = deferred<Xcom2ProjectFoundryApplyResult>();
      const first = createComposition({ apply: vi.fn(() => gate.promise) });
      const second = createComposition({ apply: vi.fn() });
      const hook = renderHook(
        ({ composition }: { composition: ProjectFoundryComposition }) =>
          useXcom2ProjectFoundryController(composition),
        { initialProps: { composition: first.composition } },
      );
      await renderReady(hook);
      const ready = hook.result.current.applyState;
      if (ready?.status !== "ready") throw new Error("Expected ready Apply state");
      let pending!: Promise<void>;
      act(() => {
        pending = hook.result.current.apply(ready.preview.plan.planDigest);
      });
      await waitFor(() => expect(first.composition.apply).toHaveBeenCalledOnce());

      if (invalidation === "composition") {
        hook.rerender({ composition: second.composition });
      } else {
        hook.unmount();
      }
      gate.resolve({
        result: "refused",
        phase: "pre-commit",
        reason: "destination-present",
      });
      await act(async () => pending);

      if (invalidation === "composition") {
        expect(hook.result.current.isOpen).toBe(false);
        expect(hook.result.current.creationState).toEqual({ kind: "unavailable" });
        hook.unmount();
      }
      expect(first.revokeAll).toHaveBeenCalled();
    },
  );

  it("refuses an absent composition safely and contains no native/Tauri dependency", async () => {
    const controller = renderFoundryController();
    act(() => controller.result.current.open());
    await act(() => controller.result.current.selectSourceRepository());
    expect(controller.result.current.viewState).toEqual({
      kind: "refused",
      code: "source-grant-invalid",
    });

    const workspaceRoot = /\/(?:apps|packages)\/[^/]+$/u.test(process.cwd())
      ? resolve(process.cwd(), "../..")
      : process.cwd();
    const desktopRoot = resolve(workspaceRoot, "apps/desktop");
    const productionSource = readFileSync(
      resolve(
        desktopRoot,
        "src/features/xcom2-project-foundry/useXcom2ProjectFoundryController.ts",
      ),
      "utf8",
    );
    expect(productionSource).not.toMatch(/@tauri-apps|invoke\s*\(/u);
    expect(productionSource).not.toMatch(/resolvePinnedObject|inspectDerivedDestination/u);
  });
});
