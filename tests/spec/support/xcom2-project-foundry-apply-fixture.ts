import {
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryPreviewRequest,
} from "../../../packages/contracts/src/domain/xcom2-project-foundry";
import {
  createXcom2ProjectFoundryPreviewRequest,
  previewXcom2ProjectFoundry,
} from "../../../packages/web-core/src/xcom2/project-foundry";

export const APPROVED_FOUNDRY_APPLY_DIGEST =
  "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6";

export function mutableFoundryApplySelection() {
  return {
    sourceGrant: {
      kind: "source-repository" as const,
      repository: "/scenario/empt-v1_4",
      identity: "source-grant-foundry-preview-001",
    },
    destinationParentGrant: {
      kind: "destination-parent" as const,
      parent: "/scenario/foundry-output",
      identity: "destination-parent-grant-foundry-preview-001",
    },
    operationGrant: {
      kind: "preview-operation" as const,
      derivedDestination: "/scenario/foundry-output/FoundryPreviewFixture",
      identity: "operation-grant-foundry-preview-001",
    },
    modId: "FoundryPreviewFixture",
  };
}

export function readyFoundryApplyPreview() {
  const current = mutableFoundryApplySelection();
  const request: Xcom2ProjectFoundryPreviewRequest = {
    ...current,
    sourceObject: {
      commit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
      tree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
      fingerprintResult: "Verified",
    },
    destinationState: "absent",
  };
  const result = previewXcom2ProjectFoundry(createXcom2ProjectFoundryPreviewRequest(request));
  if (result.kind !== "ready") throw new Error(`Expected ready preview, received ${result.code}`);
  if (result.plan.planDigest !== APPROVED_FOUNDRY_APPLY_DIGEST) {
    throw new Error(`Unexpected approved fixture digest ${result.plan.planDigest}`);
  }
  return result;
}

export function mutableFoundryCreatedReceipt() {
  return {
    result: "created" as const,
    planDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    finalProjectLocation: "/scenario/foundry-output/FoundryPreviewFixture",
    sourceCommit: XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
    sourceTree: XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
    committedDirectories: 12,
    committedFiles: 27,
  };
}
