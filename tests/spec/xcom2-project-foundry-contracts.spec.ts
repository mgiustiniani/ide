import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_PROJECT_FOUNDRY_PACK_ID,
  XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PLATFORM,
  XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_CODE,
  XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_SUMMARY,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryOperationGrant,
  type Xcom2ProjectFoundryPreviewPlan,
  type Xcom2ProjectFoundryRenderRequest,
  type Xcom2ProjectFoundryRenderedPlanBody,
  type Xcom2ProjectFoundryRenderedPlanRefusal,
  type Xcom2ProjectFoundryRenderedPlanResult,
  type Xcom2ProjectFoundryRenderedPlanValidationResult,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";
import { RENDERED_FIXTURES } from "./support/xcom2-project-foundry-rendered-fixtures";

const approvedRefusalCodes = [
  "mod-id-invalid",
  "mod-id-windows-device",
  "source-commit-missing",
  "source-commit-unreadable",
  "source-commit-mismatched",
  "source-commit-fingerprint-invalid",
  "source-tree-missing",
  "source-tree-unreadable",
  "source-tree-mismatched",
  "source-tree-fingerprint-invalid",
  "source-blob-missing",
  "source-blob-unreadable",
  "source-blob-mismatched",
  "source-blob-fingerprint-invalid",
  "source-grant-invalid",
  "destination-parent-unavailable",
  "destination-parent-grant-invalid",
  "derived-destination-present",
  "derived-destination-mismatched",
  "operation-grant-invalid",
  "rendered-plan-invalid",
] as const;

describe("@REQ-XCOM2-PROJECT-FOUNDRY-001 ADR0010@0f1fcd5 corrected contracts", () => {
  it("retains the exact pinned pack, Git object, platform, status, and canonical schema constants", () => {
    expect(XCOM2_PROJECT_FOUNDRY_PACK_ID).toBe("ide.xcom2.empt-v1_4");
    expect(XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT).toBe("d968be3c32b250376723563a743a120770ec5c95");
    expect(XCOM2_PROJECT_FOUNDRY_SOURCE_TREE).toBe("cc8823fa99c0d292c4fe48a8b9463ff790176371");
    expect(XCOM2_PROJECT_FOUNDRY_PLATFORM).toBe("Linux desktop only");
    expect(XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS).toBe("Non-publishable");
    expect(XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION).toBe(1);
  });

  it("adds only the safe rendered-plan-invalid vocabulary to the approved preview refusals", () => {
    expect(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES).toEqual(approvedRefusalCodes);
    expect(Object.isFrozen(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES)).toBe(true);
    expect(XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_CODE).toBe("rendered-plan-invalid");
    expect(XCOM2_PROJECT_FOUNDRY_RENDERED_PLAN_INVALID_SUMMARY).toBe(
      "The project preview could not be validated.",
    );
  });

  it("defines the provider-neutral render request without native evidence or operation authority", () => {
    const request = RENDERED_FIXTURES[0].request satisfies Xcom2ProjectFoundryRenderRequest;

    expect(Object.keys(request)).toEqual(["sourceGrant", "destinationParentGrant", "modId"]);
    expect(request).not.toHaveProperty("operationGrant");
    expect(request).not.toHaveProperty("sourceObject");
    expect(request).not.toHaveProperty("destinationState");
    expectTypeOf(request).toMatchTypeOf<Readonly<Xcom2ProjectFoundryRenderRequest>>();
    expectTypeOf<Xcom2ProjectFoundryRenderRequest>().not.toHaveProperty("operationGrant");
    expectTypeOf<Xcom2ProjectFoundryRenderRequest>().not.toHaveProperty("sourceObject");
    expectTypeOf<Xcom2ProjectFoundryRenderRequest>().not.toHaveProperty("destinationState");
  });

  it("defines a native rendered body/result that returns the newly minted operation grant", () => {
    const rendered = RENDERED_FIXTURES[0].rendered satisfies Xcom2ProjectFoundryRenderedPlanResult;

    expect(Object.keys(rendered)).toEqual(["kind", "operationGrant", "planBody"]);
    expect(rendered.kind).toBe("rendered");
    expect(rendered.operationGrant).toEqual({
      kind: "preview-operation",
      derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
      identity: "operation-grant-foundry-preview-001",
    });
    expect(rendered.planBody).not.toHaveProperty("planDigest");
    expect(rendered.planBody.destination.operationGrantIdentity).toBe(
      rendered.operationGrant.identity,
    );
    expect(rendered.planBody.destination.derivedAbsentDestination).toBe(
      rendered.operationGrant.derivedDestination,
    );
    expectTypeOf(rendered).toMatchTypeOf<Readonly<Xcom2ProjectFoundryRenderedPlanResult>>();
    expectTypeOf<Xcom2ProjectFoundryRenderedPlanBody>().toEqualTypeOf<
      Xcom2ProjectFoundryRenderedPlanResult["planBody"]
    >();
    expectTypeOf<Xcom2ProjectFoundryRenderedPlanRefusal>().toEqualTypeOf<
      Extract<Xcom2ProjectFoundryRenderedPlanValidationResult, { readonly kind: "refused" }>
    >();
    expectTypeOf<Xcom2ProjectFoundryRenderedPlanValidationResult>().toEqualTypeOf<
      | {
          readonly kind: "ready";
          readonly operationGrant: Readonly<Xcom2ProjectFoundryOperationGrant>;
          readonly plan: Readonly<Xcom2ProjectFoundryPreviewPlan>;
        }
      | {
          readonly kind: "refused";
          readonly code: "rendered-plan-invalid";
          readonly summary: "The project preview could not be validated.";
        }
    >();
  });
});
