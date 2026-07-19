import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION,
  XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION,
  type Xcom2ProjectFoundryApplyAttentionPresentation,
  type Xcom2ProjectFoundryApplyResult,
  type Xcom2ProjectFoundryApplyState,
  type Xcom2ProjectFoundryApplyTerminalSessionDecision,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";
import * as foundryCore from "../../packages/web-core/src/xcom2/project-foundry";
import {
  APPROVED_FOUNDRY_APPLY_DIGEST,
  mutableFoundryApplySelection,
  readyFoundryApplyPreview,
} from "./support/xcom2-project-foundry-apply-fixture";

type RefusedApplyState = Extract<Xcom2ProjectFoundryApplyState, { readonly status: "refused" }>;

const destinationPresentPresentation = {
  title: "Project location conflict",
  summary:
    "The final project location is no longer absent. Foundry did not replace or change the existing item, and this approved preview cannot be retried.",
  remediation:
    "Cancel and review or move the existing item. Then reopen Project Foundry, choose an absent final project location, and preview again.",
  supportCode: "foundry-apply-destination-present",
} as const satisfies Xcom2ProjectFoundryApplyAttentionPresentation;

const genericAttentionPresentation = {
  title: "Project creation needs attention",
  summary:
    "Foundry could not complete or safely confirm project creation. This approved preview cannot be retried.",
  remediation: "Cancel and leave the destination unchanged. Contact support before trying again.",
  supportCode: "foundry-apply-unavailable",
} as const satisfies Xcom2ProjectFoundryApplyAttentionPresentation;

const strictOtherAttentionResults = [
  ...[
    "schema-version-invalid",
    "source-grant-mismatched",
    "destination-parent-grant-mismatched",
    "operation-grant-mismatched",
    "mod-id-invalid",
    "mod-id-mismatched",
    "approved-plan-digest-invalid",
    "approved-plan-digest-mismatched",
    "apply-authority-consumed",
    "source-stale",
    "destination-parent-stale",
    "rendered-plan-invalid",
    "stage-conflict",
    "journal-conflict",
  ].map((reason) => ({ result: "refused", phase: "pre-commit", reason }) as const),
  ...[
    "journal-create-failed",
    "journal-sync-failed",
    "stage-create-failed",
    "stage-write-failed",
    "stage-verify-failed",
    "stage-sync-failed",
    "parent-sync-failed",
    "atomic-commit-failed",
    "cleanup-failed",
  ].map((reason) => ({ result: "failed", phase: "pre-commit", reason }) as const),
  ...["post-commit-parent-sync-failed", "post-commit-journal-failed"].map(
    (reason) =>
      ({
        result: "created-recovery-required",
        phase: "post-commit",
        planDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
        finalProjectLocation: "/scenario/foundry-output/FoundryPreviewFixture",
        reason,
      }) as const,
  ),
] as const satisfies readonly Xcom2ProjectFoundryApplyResult[];

const attentionCore = foundryCore as typeof foundryCore & {
  mapXcom2ProjectFoundryApplyAttentionPresentation(
    result: unknown,
  ): Readonly<Xcom2ProjectFoundryApplyAttentionPresentation>;
  decideXcom2ProjectFoundryApplyTerminalSession(
    state: Readonly<RefusedApplyState>,
  ): Readonly<Xcom2ProjectFoundryApplyTerminalSessionDecision>;
};

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function applyingState() {
  const initial = attentionCore.createXcom2ProjectFoundryReadyApplyState({
    preview: readyFoundryApplyPreview(),
    current: mutableFoundryApplySelection(),
  });
  const decision = attentionCore.reduceXcom2ProjectFoundryApplyState(initial, {
    kind: "apply-requested",
    approvedPlanDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
  });
  if (decision.kind !== "prepared") throw new Error(`Expected prepared, received ${decision.kind}`);
  return decision.state;
}

/**
 * Focused Spec BDD complements, rather than duplicates, AT-X2-031:
 * these examples pin the pure provider-neutral attention and terminal-session decisions.
 */
describe("@REQ-XCOM2-PROJECT-FOUNDRY-003 ADR0010 Apply attention policy", () => {
  it("defines readonly presentation, refused-state, and terminal-session contracts", () => {
    type ReadyPreview = Extract<
      Xcom2ProjectFoundryApplyState,
      { readonly status: "ready" }
    >["preview"];

    expectTypeOf<Xcom2ProjectFoundryApplyAttentionPresentation>().toEqualTypeOf<{
      readonly title: string;
      readonly summary: string;
      readonly remediation: string;
      readonly supportCode: string;
    }>();
    expectTypeOf<RefusedApplyState>().toEqualTypeOf<{
      readonly status: "refused";
      readonly authority: "consumed";
      readonly preview: Readonly<ReadyPreview>;
      readonly refusal: Readonly<
        Extract<Xcom2ProjectFoundryApplyResult, { readonly result: "refused" }>
      >;
    }>();
    expectTypeOf<Xcom2ProjectFoundryApplyTerminalSessionDecision>().toEqualTypeOf<{
      readonly kind: "terminal";
      readonly authority: "consumed";
      readonly preview: "retained-context";
      readonly disabledControls: readonly [
        "source-selection",
        "destination-selection",
        "mod-id",
        "preview",
        "create",
      ];
      readonly enabledControls: readonly ["cancel"];
    }>();
    expectTypeOf(
      attentionCore.mapXcom2ProjectFoundryApplyAttentionPresentation,
    ).parameters.toEqualTypeOf<[unknown]>();
    expectTypeOf(
      attentionCore.mapXcom2ProjectFoundryApplyAttentionPresentation,
    ).returns.toEqualTypeOf<Readonly<Xcom2ProjectFoundryApplyAttentionPresentation>>();

    expect(XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION).toEqual(
      destinationPresentPresentation,
    );
    expect(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION).toEqual(
      genericAttentionPresentation,
    );
    expect(Object.keys(XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION)).toEqual([
      "title",
      "summary",
      "remediation",
      "supportCode",
    ]);
    expect(Object.keys(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION)).toEqual([
      "title",
      "summary",
      "remediation",
      "supportCode",
    ]);
    assertDeepFrozen(XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION);
    assertDeepFrozen(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION);
  });

  it("maps only the exact destination-present refusal to the fixed conflict presentation", () => {
    const result = {
      result: "refused",
      phase: "pre-commit",
      reason: "destination-present",
    } as const;
    const presentation = attentionCore.mapXcom2ProjectFoundryApplyAttentionPresentation(result);

    expect(presentation).toBe(XCOM2_PROJECT_FOUNDRY_APPLY_DESTINATION_PRESENT_PRESENTATION);
    expect(presentation).toEqual(destinationPresentPresentation);
    assertDeepFrozen(presentation);
    expect(() => {
      (presentation as { summary: string }).summary = "mutation-must-be-refused";
    }).toThrow(TypeError);
  });

  it.each(strictOtherAttentionResults)(
    "collapses strict $result/$phase/$reason attention to the one fixed generic fallback",
    (result) => {
      const presentation = attentionCore.mapXcom2ProjectFoundryApplyAttentionPresentation(result);

      expect(presentation).toBe(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION);
      expect(presentation).toEqual(genericAttentionPresentation);
      expect(JSON.stringify(presentation)).not.toContain(result.reason);
    },
  );

  it.each([
    null,
    "provider-secret: /tmp/private-stage errno=17",
    new Error("raw-cause-canary /home/scenario-owner/private errno=17"),
    { result: "refused", phase: "pre-commit", reason: "unknown-provider-reason" },
    {
      result: "refused",
      phase: "pre-commit",
      reason: "destination-present",
      rawCause: "raw-cause-canary",
    },
    { result: "refused", phase: "post-commit", reason: "destination-present" },
    { result: "failed", phase: "pre-commit", reason: "destination-present" },
    {
      result: "created-recovery-required",
      phase: "post-commit",
      planDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
      finalProjectLocation: "/tmp/private-destination",
      reason: "destination-present",
      errno: 17,
    },
  ])("fails closed for malformed or unknown input without interpolation: %#", (result) => {
    const presentation = attentionCore.mapXcom2ProjectFoundryApplyAttentionPresentation(result);
    const rendered = JSON.stringify(presentation);

    expect(presentation).toBe(XCOM2_PROJECT_FOUNDRY_APPLY_UNAVAILABLE_PRESENTATION);
    expect(presentation).toEqual(genericAttentionPresentation);
    expect(rendered).not.toMatch(
      /(?:unknown-provider-reason|raw-cause-canary|provider-secret|private-stage|private-destination|scenario-owner|errno|\/tmp\/|\/home\/)/u,
    );
  });

  it("makes destination refusal terminal while retaining the immutable Preview only as context", () => {
    const applying = applyingState();
    const mutableRefusal = {
      result: "refused" as const,
      phase: "pre-commit" as const,
      reason: "destination-present",
    };
    const completed = attentionCore.reduceXcom2ProjectFoundryApplyState(applying, {
      kind: "apply-completed",
      result: mutableRefusal,
    });
    if (completed.kind !== "transitioned" || completed.state.status !== "refused") {
      throw new Error("Expected terminal refused Apply state");
    }

    const refused = completed.state;
    const policy = attentionCore.decideXcom2ProjectFoundryApplyTerminalSession(refused);

    expect(refused).toEqual({
      status: "refused",
      authority: "consumed",
      preview: applying.preview,
      refusal: {
        result: "refused",
        phase: "pre-commit",
        reason: "destination-present",
      },
    });
    expect(policy).toEqual({
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
    assertDeepFrozen(refused);
    assertDeepFrozen(policy);

    mutableRefusal.reason = "raw-cause-after-completion";
    expect(refused.refusal.reason).toBe("destination-present");
    expect(JSON.stringify(policy)).not.toContain("raw-cause-after-completion");
  });
});
