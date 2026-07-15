import type { Xcom2SetupTransactionSummary, Xcom2SetupWorkflowState } from "@ide/contracts";

/**
 * Provider-neutral lifecycle guard. Native code remains authoritative and may
 * reject a transition for journal/hash reasons even when it is structurally valid.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<Xcom2SetupWorkflowState, readonly Xcom2SetupWorkflowState[]>
> = {
  "waiting-for-download": ["planned", "cancelled"],
  planned: ["awaiting-approval", "cancelled"],
  "awaiting-approval": ["applying", "cancelled", "failed"],
  applying: ["applied", "partial", "failed", "rolling-back", "recovery-required"],
  applied: ["rolling-back"],
  partial: ["rolling-back", "recovery-required"],
  failed: ["rolling-back", "recovery-required"],
  "rolling-back": ["rolled-back", "rollback-conflict", "recovery-required"],
  "rolled-back": ["awaiting-approval"],
  "rollback-conflict": ["rolling-back", "recovery-required"],
  cancelled: [],
  "recovery-required": ["rolling-back", "failed"],
};

export function canTransitionXcom2SetupState(
  from: Xcom2SetupWorkflowState,
  to: Xcom2SetupWorkflowState,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

const SHA256_DIGEST = /^[a-f0-9]{64}$/i;

/**
 * Conservatively derives apply eligibility from native transaction evidence.
 * This does not authorize a mutation; native code remains authoritative and
 * revalidates the exact digest, journal, and audited preconditions at apply time.
 */
export function canApplyXcom2SetupTransaction(transaction: Xcom2SetupTransactionSummary): boolean {
  const digest = transaction.reviewedOperationDigest;

  return (
    transaction.executable &&
    transaction.state === "awaiting-approval" &&
    transaction.applyAvailability.allowed &&
    transaction.applyAvailability.blockers.length === 0 &&
    digest?.algorithm === "sha256" &&
    SHA256_DIGEST.test(digest.digest) &&
    !transaction.rollbackAvailable
  );
}
