import {
  XCOM2_PROJECT_FOUNDRY_SOURCE_COMMIT,
  XCOM2_PROJECT_FOUNDRY_SOURCE_TREE,
  type Xcom2ProjectFoundryPreviewResult,
} from "../../../packages/contracts/src/domain/xcom2-project-foundry";
import { FOUNDRY_PREVIEW_FIXTURE_BODY } from "./xcom2-project-foundry-rendered-fixtures";

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

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function readyFoundryApplyPreview() {
  const result: Xcom2ProjectFoundryPreviewResult = {
    kind: "ready",
    plan: {
      ...structuredClone(FOUNDRY_PREVIEW_FIXTURE_BODY),
      planDigest: APPROVED_FOUNDRY_APPLY_DIGEST,
    },
  };
  return deepFreeze(result) as Extract<Xcom2ProjectFoundryPreviewResult, { kind: "ready" }>;
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

export function mutableFoundryStageWriteFailure(
  cleanupStatus: "verified-complete" | "not-verified" = "verified-complete",
) {
  return {
    result: "failed" as const,
    phase: "pre-commit" as const,
    reason: "stage-write-failed",
    cleanupStatus,
  };
}
