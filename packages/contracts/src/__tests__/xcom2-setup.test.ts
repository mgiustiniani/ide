import { describe, expect, it } from "vitest";

import {
  XCOM2_SETUP_OPERATION_KINDS,
  type Xcom2SetupApproveRequest,
} from "../xcom2-setup";

describe("XCOM 2 setup transaction contracts", () => {
  it("exposes only allowlisted operation kinds", () => {
    expect(XCOM2_SETUP_OPERATION_KINDS).toEqual([
      "atomic-text-config-patch",
      "quarantine-restore-file",
      "create-restore-symlink",
      "create-remove-generated-file",
      "create-remove-generated-directory",
      "copy-restore-managed-directory",
    ]);
    expect(XCOM2_SETUP_OPERATION_KINDS.some((kind) => kind.includes("command"))).toBe(false);
  });

  it("models approval as an exact reviewed transaction binding", () => {
    const approval: Xcom2SetupApproveRequest = {
      transactionId: "tx-1",
      planId: "plan-1",
      planVersion: 1,
      workspaceId: "workspace-1",
      workspaceGeneration: 7,
      reviewedOperationDigest: { algorithm: "sha256", digest: "digest-1" },
      approvedStepIds: ["configure-sdk-offline-mode"],
      approvedOperationIds: ["operation-1"],
      approvedCapabilities: ["patch-sdk-configuration"],
    };

    expect(approval).toMatchObject({
      transactionId: "tx-1",
      workspaceGeneration: 7,
      reviewedOperationDigest: { algorithm: "sha256", digest: "digest-1" },
    });
  });
});
