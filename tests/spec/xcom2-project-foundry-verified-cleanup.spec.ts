import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_PROJECT_FOUNDRY_APPLY_CLEANUP_STATUSES,
  XCOM2_PROJECT_FOUNDRY_APPLY_STAGE_WRITE_CLEANUP_VERIFIED_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
  type Xcom2ProjectFoundryApplyAttentionPresentation,
  type Xcom2ProjectFoundryApplyCleanupStatus,
  type Xcom2ProjectFoundryApplyResult,
  type Xcom2ProjectFoundryApplyState,
  type Xcom2ProjectFoundryApplyTerminalSessionDecision,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";
import * as foundryCore from "../../packages/web-core/src/xcom2/project-foundry";
import {
  APPROVED_FOUNDRY_APPLY_DIGEST,
  mutableFoundryApplySelection,
  mutableFoundryStageWriteFailure,
  readyFoundryApplyPreview,
} from "./support/xcom2-project-foundry-apply-fixture";

type FailedApplyState = Extract<Xcom2ProjectFoundryApplyState, { readonly status: "failed" }>;
type RefusedApplyState = Extract<Xcom2ProjectFoundryApplyState, { readonly status: "refused" }>;

const cleanupCore = foundryCore as typeof foundryCore & {
  decideXcom2ProjectFoundryApplyTerminalSession(
    state: Readonly<FailedApplyState | RefusedApplyState>,
  ): Readonly<Xcom2ProjectFoundryApplyTerminalSessionDecision>;
};

const verifiedCleanupPresentation = {
  title: "Project creation stopped safely",
  summary:
    "Foundry could not finish writing the project, but verified that the final project location and temporary transaction items are absent. This approved preview cannot be retried.",
  remediation:
    "Cancel, then reopen Project Foundry and preview again before trying to create the project.",
  supportCode: "foundry-apply-stage-write-cleanup-verified",
} as const satisfies Xcom2ProjectFoundryApplyAttentionPresentation;

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function applyingState() {
  const initial = cleanupCore.createXcom2ProjectFoundryReadyApplyState({
    preview: readyFoundryApplyPreview(),
    current: mutableFoundryApplySelection(),
  });
  const decision = cleanupCore.reduceXcom2ProjectFoundryApplyState(initial, {
    kind: "apply-requested",
    approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
  });
  if (decision.kind !== "prepared") throw new Error(`Expected prepared, received ${decision.kind}`);
  return decision.state;
}

const positiveTuple = mutableFoundryStageWriteFailure();
const extraSymbol = Symbol("provider-detail");
const genericFallbackCases: readonly (readonly [string, unknown])[] = [
  [
    "missing cleanup status",
    { result: "failed", phase: "pre-commit", reason: "stage-write-failed" },
  ],
  ["null cleanup status", { ...positiveTuple, cleanupStatus: null }],
  ["unknown cleanup status", { ...positiveTuple, cleanupStatus: "cleanup-complete" }],
  ["legacy cleanup status", { ...positiveTuple, cleanupStatus: true }],
  ["not-verified cleanup", mutableFoundryStageWriteFailure("not-verified")],
  ["wrong result", { ...positiveTuple, result: "refused" }],
  ["wrong phase", { ...positiveTuple, phase: "post-commit" }],
  ["other failure reason", { ...positiveTuple, reason: "stage-verify-failed" }],
  ["cleanup-failed reason", { ...positiveTuple, reason: "cleanup-failed" }],
  ["extra string field", { ...positiveTuple, rawCause: "provider-secret" }],
  ["extra symbol field", { ...positiveTuple, [extraSymbol]: "provider-secret" }],
  ["inherited tuple", Object.assign(Object.create({ provider: "secret" }), positiveTuple)],
];

/**
 * Focused Spec BDD complements, rather than duplicates, AT-X2-032:
 * these examples pin the pure closed cleanup-attestation contract and attention decision.
 */
describe("@REQ-XCOM2-PROJECT-FOUNDRY-004 ADR0010 verified stage-write cleanup policy", () => {
  it("defines the closed cleanup-status vocabulary and exact frozen positive presentation", () => {
    expectTypeOf<Xcom2ProjectFoundryApplyCleanupStatus>().toEqualTypeOf<
      "verified-complete" | "not-verified"
    >();
    expectTypeOf<
      FailedApplyState["failure"]["cleanupStatus"]
    >().toEqualTypeOf<Xcom2ProjectFoundryApplyCleanupStatus>();
    expect(XCOM2_PROJECT_FOUNDRY_APPLY_CLEANUP_STATUSES).toEqual([
      "verified-complete",
      "not-verified",
    ]);
    expect(Object.isFrozen(XCOM2_PROJECT_FOUNDRY_APPLY_CLEANUP_STATUSES)).toBe(true);

    const presentation = XCOM2_PROJECT_FOUNDRY_APPLY_STAGE_WRITE_CLEANUP_VERIFIED_PRESENTATION;
    expect(presentation).toEqual(verifiedCleanupPresentation);
    expect(Object.keys(presentation)).toEqual(["title", "summary", "remediation", "supportCode"]);
    assertDeepFrozen(presentation);
  });

  it("maps only the exact closed four-field positive tuple to verified-cleanup wording", () => {
    expect(Reflect.ownKeys(positiveTuple)).toEqual(["result", "phase", "reason", "cleanupStatus"]);

    const presentation =
      cleanupCore.mapXcom2ProjectFoundryApplyAttentionPresentation(positiveTuple);

    expect(presentation).toBe(
      XCOM2_PROJECT_FOUNDRY_APPLY_STAGE_WRITE_CLEANUP_VERIFIED_PRESENTATION,
    );
    expect(presentation).toEqual(verifiedCleanupPresentation);
    assertDeepFrozen(presentation);
  });

  it.each(genericFallbackCases)("maps %s to the existing generic fallback", (_label, result) => {
    const presentation = cleanupCore.mapXcom2ProjectFoundryApplyAttentionPresentation(result);

    expect(presentation).toBe(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION);
    expect(JSON.stringify(presentation)).not.toMatch(
      /(?:verified that|stopped safely|cleanup-verified|provider-secret)/u,
    );
  });

  it("retains mandatory cleanup status in the frozen failed state", () => {
    const applying = applyingState();
    const completion = cleanupCore.reduceXcom2ProjectFoundryApplyState(applying, {
      kind: "apply-completed",
      result: positiveTuple satisfies Xcom2ProjectFoundryApplyResult,
    });
    if (completion.kind !== "transitioned" || completion.state.status !== "failed") {
      throw new Error("Expected failed Apply state");
    }

    expect(completion.state.failure).toEqual(positiveTuple);
    assertDeepFrozen(completion.state);
  });

  it("applies the same frozen terminal policy to verified failure and destination refusal", () => {
    const failureCompletion = cleanupCore.reduceXcom2ProjectFoundryApplyState(applyingState(), {
      kind: "apply-completed",
      result: positiveTuple satisfies Xcom2ProjectFoundryApplyResult,
    });
    if (failureCompletion.kind !== "transitioned" || failureCompletion.state.status !== "failed") {
      throw new Error("Expected failed Apply state");
    }

    const refusalCompletion = cleanupCore.reduceXcom2ProjectFoundryApplyState(applyingState(), {
      kind: "apply-completed",
      result: { result: "refused", phase: "pre-commit", reason: "destination-present" },
    });
    if (refusalCompletion.kind !== "transitioned" || refusalCompletion.state.status !== "refused") {
      throw new Error("Expected refused Apply state");
    }

    const failedPolicy = cleanupCore.decideXcom2ProjectFoundryApplyTerminalSession(
      failureCompletion.state,
    );
    const refusalPolicy = cleanupCore.decideXcom2ProjectFoundryApplyTerminalSession(
      refusalCompletion.state,
    );
    expect(failedPolicy).toBe(refusalPolicy);
    expect(failedPolicy).toEqual({
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
    });
    assertDeepFrozen(failedPolicy);
  });
});
