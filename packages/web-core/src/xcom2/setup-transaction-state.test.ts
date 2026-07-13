import type { Xcom2SetupTransactionSummary } from "@ide/contracts";
import { describe, expect, it } from "vitest";

import {
  canApplyXcom2SetupTransaction,
  canTransitionXcom2SetupState,
} from "./setup-transaction-state";

const digest = "a".repeat(64);

function transaction(
  overrides: Partial<Xcom2SetupTransactionSummary> = {},
): Xcom2SetupTransactionSummary {
  return {
    transactionId: "transaction-1",
    planId: "plan-1",
    planVersion: 1,
    workspaceId: "workspace-1",
    workspaceGeneration: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    state: "awaiting-approval",
    executable: true,
    approvedStepIds: ["configure-sdk-offline-mode"],
    approvedOperationIds: ["operation-1"],
    approvedCapabilities: ["patch-sdk-configuration"],
    reviewedOperationDigest: { algorithm: "sha256", digest },
    journal: {
      scope: "local-machine",
      managedBy: "native",
      redactedLocation: "Native-managed journal",
    },
    applyAvailability: { allowed: true, blockers: [] },
    rollbackAvailable: false,
    conflictReasons: [],
    recoveryGuidance: [],
    ...overrides,
  };
}

describe("XCOM 2 setup transaction state transitions", () => {
  it("supports a reviewed apply and rollback cycle", () => {
    const cycle = [
      "awaiting-approval",
      "applying",
      "applied",
      "rolling-back",
      "rolled-back",
      "awaiting-approval",
    ] as const;

    for (let index = 1; index < cycle.length; index += 1) {
      expect(canTransitionXcom2SetupState(cycle[index - 1]!, cycle[index]!)).toBe(true);
    }
  });

  it("requires rollback instead of silently returning an applied transaction to planning", () => {
    expect(canTransitionXcom2SetupState("applied", "planned")).toBe(false);
    expect(canTransitionXcom2SetupState("applying", "cancelled")).toBe(false);
  });

  it("permits idempotent event snapshots without changing state", () => {
    expect(canTransitionXcom2SetupState("rolling-back", "rolling-back")).toBe(true);
  });

  it("allows an executable native prepared transaction with exact evidence", () => {
    expect(canApplyXcom2SetupTransaction(transaction())).toBe(true);
  });

  it("rejects blocked or inconsistent transaction evidence", () => {
    expect(
      canApplyXcom2SetupTransaction(
        transaction({
          applyAvailability: {
            allowed: false,
            blockers: ["SDK manifest changed after preparation"],
          },
        }),
      ),
    ).toBe(false);
    expect(canApplyXcom2SetupTransaction(transaction({ executable: false }))).toBe(false);
    expect(canApplyXcom2SetupTransaction(transaction({ state: "applied" }))).toBe(false);
    expect(canApplyXcom2SetupTransaction(transaction({ rollbackAvailable: true }))).toBe(false);
    expect(
      canApplyXcom2SetupTransaction(
        transaction({ reviewedOperationDigest: { algorithm: "sha256", digest: "short" } }),
      ),
    ).toBe(false);
  });
});
