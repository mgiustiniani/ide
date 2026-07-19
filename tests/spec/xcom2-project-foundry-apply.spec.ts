import { describe, expect, expectTypeOf, it } from "vitest";

import * as foundryContracts from "../../packages/contracts/src/domain/xcom2-project-foundry";
import type {
  Xcom2ProjectFoundryApplyCleanupStatus,
  Xcom2ProjectFoundryApplyCurrentSelection,
  Xcom2ProjectFoundryApplyEvent,
  Xcom2ProjectFoundryApplyFailurePhase,
  Xcom2ProjectFoundryApplyPreparation,
  Xcom2ProjectFoundryApplyPreparationResult,
  Xcom2ProjectFoundryApplyRefusalCode,
  Xcom2ProjectFoundryApplyRequest,
  Xcom2ProjectFoundryApplyResult,
  Xcom2ProjectFoundryApplyState,
  Xcom2ProjectFoundryApplyStateDecision,
  Xcom2ProjectFoundryCreatedReceipt,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";
import * as foundryCore from "../../packages/web-core/src/xcom2/project-foundry";
import {
  APPROVED_FOUNDRY_APPLY_DIGEST,
  mutableFoundryApplySelection,
  mutableFoundryCreatedReceipt,
  readyFoundryApplyPreview,
} from "./support/xcom2-project-foundry-apply-fixture";

const expectedRefusalCodes = [
  "preview-not-ready",
  "preview-stale",
  "source-grant-mismatched",
  "destination-parent-grant-mismatched",
  "operation-grant-mismatched",
  "mod-id-invalid",
  "mod-id-mismatched",
  "approved-plan-digest-invalid",
  "approved-plan-digest-mismatched",
  "apply-authority-consumed",
  "created-receipt-invalid",
] as const satisfies readonly Xcom2ProjectFoundryApplyRefusalCode[];

const contractRuntime = foundryContracts as typeof foundryContracts & {
  readonly XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION: 1;
  readonly XCOM2_PROJECT_FOUNDRY_APPLY_REFUSAL_CODES: readonly Xcom2ProjectFoundryApplyRefusalCode[];
  readonly XCOM2_PROJECT_FOUNDRY_APPLY_FAILURE_PHASES: readonly Xcom2ProjectFoundryApplyFailurePhase[];
};

const applyCore = foundryCore as typeof foundryCore & {
  prepareXcom2ProjectFoundryApply(
    preparation: Xcom2ProjectFoundryApplyPreparation,
  ): Xcom2ProjectFoundryApplyPreparationResult;
  createXcom2ProjectFoundryReadyApplyState(input: {
    readonly preview: ReturnType<typeof readyFoundryApplyPreview>;
    readonly current: Xcom2ProjectFoundryApplyCurrentSelection;
  }): Xcom2ProjectFoundryApplyState;
  reduceXcom2ProjectFoundryApplyState(
    state: Readonly<Xcom2ProjectFoundryApplyState>,
    event: Readonly<Xcom2ProjectFoundryApplyEvent>,
  ): Xcom2ProjectFoundryApplyStateDecision;
};

function matchingPreparation(): Xcom2ProjectFoundryApplyPreparation {
  return {
    preview: readyFoundryApplyPreview(),
    current: mutableFoundryApplySelection(),
    approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    authority: "available",
    stale: false,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...collectKeys(child),
  ]);
}

function expectReadyPreparation(result: Xcom2ProjectFoundryApplyPreparationResult) {
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error(`Unexpected refusal: ${result.code}`);
  return result.request;
}

function readyState() {
  return applyCore.createXcom2ProjectFoundryReadyApplyState({
    preview: readyFoundryApplyPreview(),
    current: mutableFoundryApplySelection(),
  });
}

function expectPrepared(decision: Xcom2ProjectFoundryApplyStateDecision) {
  expect(decision.kind).toBe("prepared");
  if (decision.kind !== "prepared") throw new Error(`Expected prepared, received ${decision.kind}`);
  return decision;
}

function applyingState() {
  return expectPrepared(
    applyCore.reduceXcom2ProjectFoundryApplyState(readyState(), {
      kind: "apply-requested",
      approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    }),
  ).state;
}

/**
 * Focused Spec BDD complements, rather than duplicates, the AT-X2-030 Story:
 * these examples pin the pure provider-neutral Apply contracts and lifecycle policy.
 */
describe("@REQ-XCOM2-PROJECT-FOUNDRY-002 ADR0010 pure exact-preview Apply policy", () => {
  it("defines exact immutable request, created-receipt, and fail-closed result contracts", () => {
    expect(contractRuntime.XCOM2_PROJECT_FOUNDRY_APPLY_SCHEMA_VERSION).toBe(1);
    expect(contractRuntime.XCOM2_PROJECT_FOUNDRY_APPLY_REFUSAL_CODES).toEqual(expectedRefusalCodes);
    expect(contractRuntime.XCOM2_PROJECT_FOUNDRY_APPLY_FAILURE_PHASES).toEqual([
      "pre-commit",
      "post-commit",
    ]);
    expect(Object.isFrozen(contractRuntime.XCOM2_PROJECT_FOUNDRY_APPLY_REFUSAL_CODES)).toBe(true);
    expect(Object.isFrozen(contractRuntime.XCOM2_PROJECT_FOUNDRY_APPLY_FAILURE_PHASES)).toBe(true);

    expectTypeOf<Xcom2ProjectFoundryApplyRequest>().toEqualTypeOf<{
      readonly schemaVersion: 1;
      readonly sourceGrant: Readonly<foundryContracts.Xcom2ProjectFoundrySourceSelectionGrant>;
      readonly destinationParentGrant: Readonly<foundryContracts.Xcom2ProjectFoundryDestinationParentSelectionGrant>;
      readonly operationGrant: Readonly<foundryContracts.Xcom2ProjectFoundryOperationGrant>;
      readonly modId: string;
      readonly approvedPlanDigest: string;
    }>();
    expectTypeOf<Xcom2ProjectFoundryApplyRequest>().not.toHaveProperty("sourceObject");
    expectTypeOf<Xcom2ProjectFoundryApplyRequest>().not.toHaveProperty("destinationState");
    expectTypeOf<Xcom2ProjectFoundryApplyRequest>().not.toHaveProperty("manifest");
    expectTypeOf<Xcom2ProjectFoundryApplyRequest>().not.toHaveProperty("bytes");
    expectTypeOf<Xcom2ProjectFoundryApplyRequest>().not.toHaveProperty("success");

    expectTypeOf<Xcom2ProjectFoundryCreatedReceipt>().toEqualTypeOf<{
      readonly result: "created";
      readonly planDigest: string;
      readonly finalProjectLocation: string;
      readonly sourceCommit: string;
      readonly sourceTree: string;
      readonly committedDirectories: number;
      readonly committedFiles: number;
    }>();
    expectTypeOf<Xcom2ProjectFoundryApplyFailurePhase>().toEqualTypeOf<
      "pre-commit" | "post-commit"
    >();
    expectTypeOf<Xcom2ProjectFoundryApplyCleanupStatus>().toEqualTypeOf<
      "verified-complete" | "not-verified"
    >();
    expectTypeOf<Extract<Xcom2ProjectFoundryApplyResult, { result: "refused" }>>().toEqualTypeOf<{
      readonly result: "refused";
      readonly phase: "pre-commit";
      readonly reason: string;
    }>();
    expectTypeOf<Extract<Xcom2ProjectFoundryApplyResult, { result: "failed" }>>().toEqualTypeOf<{
      readonly result: "failed";
      readonly phase: "pre-commit";
      readonly reason: string;
      readonly cleanupStatus: Xcom2ProjectFoundryApplyCleanupStatus;
    }>();
    expectTypeOf<
      Extract<Xcom2ProjectFoundryApplyResult, { result: "created-recovery-required" }>
    >().toEqualTypeOf<{
      readonly result: "created-recovery-required";
      readonly phase: "post-commit";
      readonly planDigest: string;
      readonly finalProjectLocation: string;
      readonly reason: string;
    }>();
  });

  it("defines the exact immutable preparation, state, event, and decision lifecycle", () => {
    type ReadyPreview = Extract<
      foundryContracts.Xcom2ProjectFoundryPreviewResult,
      { readonly kind: "ready" }
    >;
    type ApplyingState = Extract<Xcom2ProjectFoundryApplyState, { readonly status: "applying" }>;

    expectTypeOf<Xcom2ProjectFoundryApplyCurrentSelection>().toEqualTypeOf<{
      readonly sourceGrant: Readonly<foundryContracts.Xcom2ProjectFoundrySourceSelectionGrant>;
      readonly destinationParentGrant: Readonly<foundryContracts.Xcom2ProjectFoundryDestinationParentSelectionGrant>;
      readonly operationGrant: Readonly<foundryContracts.Xcom2ProjectFoundryOperationGrant>;
      readonly modId: string;
    }>();
    expectTypeOf<Xcom2ProjectFoundryApplyPreparation>().toEqualTypeOf<{
      readonly preview: Readonly<foundryContracts.Xcom2ProjectFoundryPreviewResult>;
      readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
      readonly approvedPlanDigest: string;
      readonly authority: "available" | "consumed";
      readonly stale: boolean;
    }>();
    expectTypeOf<Xcom2ProjectFoundryApplyPreparationResult>().toEqualTypeOf<
      | { readonly kind: "ready"; readonly request: Readonly<Xcom2ProjectFoundryApplyRequest> }
      | { readonly kind: "refused"; readonly code: Xcom2ProjectFoundryApplyRefusalCode }
    >();

    expectTypeOf<Xcom2ProjectFoundryApplyState>().toEqualTypeOf<
      | {
          readonly status: "editing";
          readonly authority: "available";
          readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
          readonly invalidatedBy: "source" | "destination" | "mod-id";
        }
      | {
          readonly status: "ready";
          readonly authority: "available";
          readonly current: Readonly<Xcom2ProjectFoundryApplyCurrentSelection>;
          readonly preview: Readonly<ReadyPreview>;
        }
      | {
          readonly status: "applying";
          readonly authority: "consumed";
          readonly preview: Readonly<ReadyPreview>;
          readonly request: Readonly<Xcom2ProjectFoundryApplyRequest>;
        }
      | {
          readonly status: "created";
          readonly authority: "consumed";
          readonly receipt: Readonly<Xcom2ProjectFoundryCreatedReceipt>;
        }
      | {
          readonly status: "refused";
          readonly authority: "consumed";
          readonly preview: Readonly<ReadyPreview>;
          readonly refusal: Readonly<
            Extract<Xcom2ProjectFoundryApplyResult, { readonly result: "refused" }>
          >;
        }
      | {
          readonly status: "failed";
          readonly authority: "consumed";
          readonly failure: Readonly<
            Extract<Xcom2ProjectFoundryApplyResult, { readonly result: "failed" }>
          >;
        }
      | {
          readonly status: "created-recovery-required";
          readonly authority: "consumed";
          readonly failure: Readonly<
            Extract<
              Xcom2ProjectFoundryApplyResult,
              { readonly result: "created-recovery-required" }
            >
          >;
        }
    >();

    expectTypeOf<Xcom2ProjectFoundryApplyEvent>().toEqualTypeOf<
      | {
          readonly kind: "source-selection-changed";
          readonly sourceGrant: Readonly<foundryContracts.Xcom2ProjectFoundrySourceSelectionGrant>;
        }
      | {
          readonly kind: "destination-selection-changed";
          readonly destinationParentGrant: Readonly<foundryContracts.Xcom2ProjectFoundryDestinationParentSelectionGrant>;
          readonly operationGrant: Readonly<foundryContracts.Xcom2ProjectFoundryOperationGrant>;
        }
      | { readonly kind: "mod-id-changed"; readonly modId: string }
      | { readonly kind: "apply-requested"; readonly approvedPlanDigest: string }
      | {
          readonly kind: "apply-completed";
          readonly result: Readonly<Xcom2ProjectFoundryApplyResult>;
        }
    >();
    expectTypeOf<Xcom2ProjectFoundryApplyStateDecision>().toEqualTypeOf<
      | { readonly kind: "transitioned"; readonly state: Xcom2ProjectFoundryApplyState }
      | {
          readonly kind: "prepared";
          readonly state: ApplyingState;
          readonly request: Readonly<Xcom2ProjectFoundryApplyRequest>;
        }
      | {
          readonly kind: "refused";
          readonly code: Xcom2ProjectFoundryApplyRefusalCode;
          readonly state: Xcom2ProjectFoundryApplyState;
        }
    >();
  });

  it("prepares only the exact Gherkin request and isolates it from mutable caller data", () => {
    const preparation = matchingPreparation();
    const mutableCurrent = preparation.current as ReturnType<typeof mutableFoundryApplySelection>;
    const request = expectReadyPreparation(applyCore.prepareXcom2ProjectFoundryApply(preparation));

    expect(request).toEqual({
      schemaVersion: 1,
      sourceGrant: {
        kind: "source-repository",
        repository: "/scenario/empt-v1_4",
        identity: "source-grant-foundry-preview-001",
      },
      destinationParentGrant: {
        kind: "destination-parent",
        parent: "/scenario/foundry-output",
        identity: "destination-parent-grant-foundry-preview-001",
      },
      operationGrant: {
        kind: "preview-operation",
        derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
        identity: "operation-grant-foundry-preview-001",
      },
      modId: "FoundryPreviewFixture",
      approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    });
    expect(Object.keys(request)).toEqual([
      "schemaVersion",
      "sourceGrant",
      "destinationParentGrant",
      "operationGrant",
      "modId",
      "approvedPlanDigest",
    ]);
    expect(
      collectKeys(request).filter((key) =>
        /^(?:sourceObject|destinationState|manifest|bytes|receipt|success)$/u.test(key),
      ),
    ).toEqual([]);
    assertDeepFrozen(request);

    mutableCurrent.sourceGrant.repository = "/changed/source";
    mutableCurrent.destinationParentGrant.parent = "/changed/destination";
    mutableCurrent.operationGrant.identity = "changed-operation";
    mutableCurrent.modId = "Changed";
    expect(request.sourceGrant.repository).toBe("/scenario/empt-v1_4");
    expect(request.modId).toBe("FoundryPreviewFixture");
    expect(() => {
      (request.operationGrant as { identity: string }).identity = "mutation-refused";
    }).toThrow(TypeError);
  });

  it.each([
    [
      "preview-not-ready",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input as { preview: unknown }).preview = { kind: "refused", code: "source-grant-invalid" };
      },
    ],
    [
      "preview-stale",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input as { stale: boolean }).stale = true;
      },
    ],
    [
      "source-grant-mismatched",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input.current.sourceGrant as { identity: string }).identity = "replacement-source-grant";
      },
    ],
    [
      "destination-parent-grant-mismatched",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input.current.destinationParentGrant as { parent: string }).parent = "/scenario/elsewhere";
      },
    ],
    [
      "operation-grant-mismatched",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input.current.operationGrant as { identity: string }).identity = "replacement-operation";
      },
    ],
    [
      "mod-id-invalid",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input.current as { modId: string }).modId = "1Invalid";
      },
    ],
    [
      "mod-id-mismatched",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input.current as { modId: string }).modId = "AnotherValidMod";
      },
    ],
    [
      "approved-plan-digest-invalid",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input as { approvedPlanDigest: string }).approvedPlanDigest =
          APPROVED_FOUNDRY_APPLY_DIGEST.toUpperCase();
      },
    ],
    [
      "approved-plan-digest-mismatched",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input as { approvedPlanDigest: string }).approvedPlanDigest = "0".repeat(64);
      },
    ],
    [
      "apply-authority-consumed",
      (input: Xcom2ProjectFoundryApplyPreparation) => {
        (input as { authority: "consumed" }).authority = "consumed";
      },
    ],
  ] as const)("refuses %s without producing an Apply request", (code, change) => {
    const preparation = matchingPreparation();
    change(preparation);
    expect(applyCore.prepareXcom2ProjectFoundryApply(preparation)).toEqual({
      kind: "refused",
      code,
    });
  });

  it.each([
    [
      "source",
      {
        kind: "source-selection-changed" as const,
        sourceGrant: {
          kind: "source-repository" as const,
          repository: "/scenario/replacement-source",
          identity: "replacement-source-grant",
        },
      },
    ],
    [
      "destination",
      {
        kind: "destination-selection-changed" as const,
        destinationParentGrant: {
          kind: "destination-parent" as const,
          parent: "/scenario/replacement-output",
          identity: "replacement-destination-grant",
        },
        operationGrant: {
          kind: "preview-operation" as const,
          derivedDestination: "/scenario/replacement-output/FoundryPreviewFixture",
          identity: "replacement-operation-grant",
        },
      },
    ],
    ["mod-id", { kind: "mod-id-changed" as const, modId: "ReplacementMod" }],
  ] as const)("immediately invalidates a ready preview when %s changes", (invalidatedBy, event) => {
    const decision = applyCore.reduceXcom2ProjectFoundryApplyState(readyState(), event);

    expect(decision.kind).toBe("transitioned");
    if (decision.kind !== "transitioned") throw new Error(`Unexpected ${decision.kind}`);
    expect(decision.state).toMatchObject({
      status: "editing",
      invalidatedBy,
      authority: "available",
    });
    expect(decision.state).not.toHaveProperty("preview");
    expect(decision.state).not.toHaveProperty("request");
    expect(decision.state).not.toHaveProperty("receipt");
    assertDeepFrozen(decision);
  });

  it("consumes approval before Apply starts and refuses repeat submission while applying", () => {
    const initial = readyState();
    const prepared = expectPrepared(
      applyCore.reduceXcom2ProjectFoundryApplyState(initial, {
        kind: "apply-requested",
        approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
      }),
    );

    expect(prepared.state).toMatchObject({ status: "applying", authority: "consumed" });
    expect(prepared.request.approvedPlanDigest).toBe(APPROVED_FOUNDRY_APPLY_DIGEST);
    assertDeepFrozen(prepared);

    const repeated = applyCore.reduceXcom2ProjectFoundryApplyState(prepared.state, {
      kind: "apply-requested",
      approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    });
    expect(repeated).toEqual({
      kind: "refused",
      code: "apply-authority-consumed",
      state: prepared.state,
    });
  });

  it("accepts only an exact created receipt, copies it deeply, and refuses repeat after creation", () => {
    const applying = applyingState();
    const receiptInput = mutableFoundryCreatedReceipt();
    const completed = applyCore.reduceXcom2ProjectFoundryApplyState(applying, {
      kind: "apply-completed",
      result: receiptInput,
    });

    expect(completed.kind).toBe("transitioned");
    if (completed.kind !== "transitioned") throw new Error(`Unexpected ${completed.kind}`);
    expect(completed.state).toMatchObject({
      status: "created",
      authority: "consumed",
      receipt: mutableFoundryCreatedReceipt(),
    });
    assertDeepFrozen(completed);

    receiptInput.finalProjectLocation = "/mutated/after-completion";
    receiptInput.committedFiles = 99;
    const createdState = completed.state;
    if (createdState.status !== "created") throw new Error("Expected created state");
    expect(createdState.receipt.finalProjectLocation).toBe(
      "/scenario/foundry-output/FoundryPreviewFixture",
    );
    expect(createdState.receipt.committedFiles).toBe(27);
    expect(() => {
      (createdState.receipt as { committedFiles: number }).committedFiles = 28;
    }).toThrow(TypeError);

    const repeated = applyCore.reduceXcom2ProjectFoundryApplyState(completed.state, {
      kind: "apply-requested",
      approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    });
    expect(repeated).toEqual({
      kind: "refused",
      code: "apply-authority-consumed",
      state: completed.state,
    });
  });

  it.each([
    ["result", "unexpected"],
    ["planDigest", "0".repeat(64)],
    ["finalProjectLocation", "/scenario/foundry-output/Other"],
    ["sourceCommit", "0".repeat(40)],
    ["sourceTree", "0".repeat(40)],
    ["committedDirectories", 11],
    ["committedFiles", 26],
  ] as const)(
    "refuses a created receipt with mismatched %s and preserves applying state",
    (field, value) => {
      const applying = applyingState();
      const receipt = mutableFoundryCreatedReceipt() as Record<string, unknown>;
      receipt[field] = value;

      const decision = applyCore.reduceXcom2ProjectFoundryApplyState(applying, {
        kind: "apply-completed",
        result: receipt as unknown as Xcom2ProjectFoundryApplyResult,
      });
      expect(decision).toEqual({
        kind: "refused",
        code: "created-receipt-invalid",
        state: applying,
      });
    },
  );
});
