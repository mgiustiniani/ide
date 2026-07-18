import { describe, expect, expectTypeOf, it } from "vitest";

import {
  XCOM2_PROJECT_FOUNDRY_PACK_ID,
  XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION,
  XCOM2_PROJECT_FOUNDRY_PLATFORM,
  XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
  XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES,
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryDestinationParentSelectionGrant,
  type Xcom2ProjectFoundryDigestBoundPlan,
  type Xcom2ProjectFoundryOperationGrant,
  type Xcom2ProjectFoundryPreviewPlan,
  type Xcom2ProjectFoundryPreviewRefusalCode,
  type Xcom2ProjectFoundryPreviewRequest,
  type Xcom2ProjectFoundryPreviewResult,
  type Xcom2ProjectFoundrySourceSelectionGrant,
} from "../../packages/contracts/src/domain/xcom2-project-foundry";

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
] as const satisfies readonly Xcom2ProjectFoundryPreviewRefusalCode[];

describe("@REQ-XCOM2-PROJECT-FOUNDRY-001 provider-neutral preview contracts", () => {
  it("publishes the exact pinned pack, Git object, platform, status, and canonical schema constants", () => {
    expect(XCOM2_PROJECT_FOUNDRY_PACK_ID).toBe("ide.xcom2.empt-v1_4");
    expect(XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT).toBe("d968be3c32b250376723563a743a120770ec5c95");
    expect(XCOM2_PROJECT_FOUNDRY_SOURCE_TREE).toBe("cc8823fa99c0d292c4fe48a8b9463ff790176371");
    expect(XCOM2_PROJECT_FOUNDRY_PLATFORM).toBe("Linux desktop only");
    expect(XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS).toBe("Non-publishable");
    expect(XCOM2_PROJECT_FOUNDRY_PLAN_SCHEMA_VERSION).toBe(1);

    for (const value of [
      XCOM2_PROJECT_FOUNDRY_PACK_ID,
      XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
      XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
      XCOM2_PROJECT_FOUNDRY_PLATFORM,
      XCOM2_PROJECT_FOUNDRY_PUBLICATION_STATUS,
    ]) {
      expect(typeof value).toBe("string");
    }
  });

  it("defines one exhaustive refusal-code vocabulary for every approved fail-closed boundary", () => {
    expect(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES).toEqual(approvedRefusalCodes);
    expect(Object.isFrozen(XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES)).toBe(true);
    expectTypeOf<
      (typeof XCOM2_PROJECT_FOUNDRY_REFUSAL_CODES)[number]
    >().toEqualTypeOf<Xcom2ProjectFoundryPreviewRefusalCode>();
    expectTypeOf<
      (typeof approvedRefusalCodes)[number]
    >().toEqualTypeOf<Xcom2ProjectFoundryPreviewRefusalCode>();
  });

  it("keeps selector grants and the preview request readonly and provider neutral", () => {
    const sourceGrant = {
      kind: "source-repository",
      repository: "/scenario/empt-v1_4",
      identity: "source-grant-foundry-preview-001",
    } as const satisfies Xcom2ProjectFoundrySourceSelectionGrant;
    const destinationParentGrant = {
      kind: "destination-parent",
      parent: "/scenario/foundry-output",
      identity: "destination-parent-grant-foundry-preview-001",
    } as const satisfies Xcom2ProjectFoundryDestinationParentSelectionGrant;
    const operationGrant = {
      kind: "preview-operation",
      derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
      identity: "operation-grant-foundry-preview-001",
    } as const satisfies Xcom2ProjectFoundryOperationGrant;
    const request = {
      sourceGrant,
      destinationParentGrant,
      operationGrant,
      sourceObject: {
        commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
        tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
        fingerprintResult: "Verified",
      },
      destinationState: "absent",
      modId: "FoundryPreviewFixture",
    } as const satisfies Xcom2ProjectFoundryPreviewRequest;

    expect(request).toMatchObject({ sourceGrant, destinationParentGrant, operationGrant });
    expectTypeOf(sourceGrant).toMatchTypeOf<Readonly<Xcom2ProjectFoundrySourceSelectionGrant>>();
    expectTypeOf(destinationParentGrant).toMatchTypeOf<
      Readonly<Xcom2ProjectFoundryDestinationParentSelectionGrant>
    >();
    expectTypeOf(operationGrant).toMatchTypeOf<Readonly<Xcom2ProjectFoundryOperationGrant>>();
    expectTypeOf(request).toMatchTypeOf<Readonly<Xcom2ProjectFoundryPreviewRequest>>();
  });

  it("exposes only digest-bound display metadata in a preview plan, never execution or mutation authority", () => {
    expectTypeOf<Xcom2ProjectFoundryDigestBoundPlan>().toHaveProperty("schemaVersion");
    expectTypeOf<Xcom2ProjectFoundryDigestBoundPlan>().toHaveProperty("directories");
    expectTypeOf<Xcom2ProjectFoundryDigestBoundPlan>().toHaveProperty("files");
    expectTypeOf<Xcom2ProjectFoundryDigestBoundPlan>().toHaveProperty("generatedPreviews");
    expectTypeOf<Xcom2ProjectFoundryDigestBoundPlan>().toHaveProperty("absences");
    expectTypeOf<Xcom2ProjectFoundryDigestBoundPlan>().toHaveProperty("warnings");
    expectTypeOf<Xcom2ProjectFoundryPreviewPlan>().toHaveProperty("planDigest");
    expectTypeOf<Xcom2ProjectFoundryPreviewResult>().toMatchTypeOf<
      | { readonly kind: "ready"; readonly plan: Xcom2ProjectFoundryPreviewPlan }
      | { readonly kind: "refused"; readonly code: Xcom2ProjectFoundryPreviewRefusalCode }
    >();
  });
});
