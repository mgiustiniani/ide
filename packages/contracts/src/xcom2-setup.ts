// ---------------------------------------------------------------------------
// @ide/contracts – XCOM 2 operational setup contracts
// ---------------------------------------------------------------------------
// Dry-run plans remain export-safe and non-executable. Only a native adapter may
// turn a plan into an allowlisted, journaled transaction; the frontend never
// supplies filesystem paths, commands, or operations.

export const XCOM2_SETUP_PLAN_VERSION = 1 as const;
/**
 * @deprecated Apply eligibility is native transaction evidence, not a frontend
 * feature flag. This compatibility export no longer disables production apply.
 */
export const XCOM2_SETUP_PRODUCTION_APPLY_ENABLED = true as const;

export type Xcom2SetupWorkflowState =
  | "waiting-for-download"
  | "planned"
  | "awaiting-approval"
  | "applying"
  | "applied"
  | "partial"
  | "failed"
  | "rolling-back"
  | "rolled-back"
  | "rollback-conflict"
  | "cancelled"
  | "recovery-required";

export type Xcom2SetupDryRunState = Extract<
  Xcom2SetupWorkflowState,
  "waiting-for-download" | "planned"
>;

export type Xcom2SetupStepId =
  | "verify-downloads"
  | "discover-tools"
  | "authorize-external-roots"
  | "backup-sdk-files"
  | "remove-day-zero-references"
  | "quarantine-tle-sources"
  | "configure-sdk-offline-mode"
  | "link-cooked-pc-console"
  | "verify-proton-shortcut"
  | "provision-proton-prefix"
  | "create-build-prefix-copy"
  | "create-sdk-alias"
  | "write-workspace-configuration"
  | "verify-operational-readiness";

export type Xcom2SetupStepDisposition =
  | "automatic"
  | "requires-approval"
  | "requires-user-action"
  | "already-satisfied"
  | "blocked"
  | "not-applicable";

export interface Xcom2SetupPlanStep {
  readonly id: Xcom2SetupStepId;
  readonly title: string;
  readonly disposition: Xcom2SetupStepDisposition;
  readonly summary: string;
  readonly blockers: readonly string[];
  /** A dry-run step is never executable, even when native preparation is available. */
  readonly executable: false;
}

/** Export-safe dry-run plan tied to one monitor snapshot generation. */
export interface Xcom2SetupPlan {
  readonly version: typeof XCOM2_SETUP_PLAN_VERSION;
  readonly planId: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly sourceCheckedAt: string;
  readonly state: Xcom2SetupDryRunState;
  readonly dryRun: true;
  readonly canApply: false;
  readonly steps: readonly Xcom2SetupPlanStep[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly generatedAt: string;
}

/**
 * Native-owned operation vocabulary. It deliberately contains no raw command kind.
 *
 * The current executable scope is exactly the 15 reversible operations emitted by
 * the vanilla WOTC SDK audit: three SDK configuration patches, quarantine of the
 * 11 audited direct TLE files, and the allowlisted CookedPCConsole symlink. Steam
 * or Proton shortcut, prefix, installer, and package-manager work remains
 * non-executable and requires explicit user action. The broader vocabulary is
 * reserved for reviewed native transactions; its presence does not make an
 * operation executable.
 */
export const XCOM2_SETUP_OPERATION_KINDS = [
  "atomic-text-config-patch",
  "quarantine-restore-file",
  "create-restore-symlink",
  "create-remove-generated-file",
  "create-remove-generated-directory",
  "copy-restore-managed-directory",
] as const;

export type Xcom2SetupOperationKind = (typeof XCOM2_SETUP_OPERATION_KINDS)[number];

export type Xcom2SetupCapability =
  | "patch-sdk-configuration"
  | "quarantine-sdk-file"
  | "manage-sdk-symlink"
  | "manage-generated-workspace-content"
  | "manage-generated-prefix-content"
  | "copy-managed-directory";

export type Xcom2SetupOperationSupport = "supported" | "unsupported";
export type Xcom2SetupRollbackSupport = "full" | "conflict-checked" | "none";

export type Xcom2SetupJournalStatus = "pending" | "recorded" | "validated";
export type Xcom2SetupHashValidationStatus = "pending" | "matched" | "not-applicable" | "mismatch";

export type Xcom2SetupOperationStatus =
  | "previewed"
  | "approved"
  | "applying"
  | "applied"
  | "skipped"
  | "unsupported"
  | "failed"
  | "rolling-back"
  | "rolled-back"
  | "rollback-conflict";

/** Hash metadata only; content and native paths must never cross this boundary. */
export interface Xcom2SetupContentHash {
  readonly algorithm: "sha256";
  readonly digest: string;
}

/** A redacted reference to a native-managed target, not a user-supplied path. */
export interface Xcom2SetupTargetProvenance {
  readonly targetId: string;
  readonly scope: "workspace" | "steam-game" | "steam-sdk" | "proton-prefix";
  readonly redactedLabel: string;
}

export interface Xcom2SetupOperation {
  readonly operationId: string;
  readonly stepId: Xcom2SetupStepId;
  readonly kind: Xcom2SetupOperationKind;
  readonly capability: Xcom2SetupCapability;
  readonly summary: string;
  readonly target: Xcom2SetupTargetProvenance;
  readonly support: Xcom2SetupOperationSupport;
  readonly unsupportedReason?: string;
  readonly rollbackSupport: Xcom2SetupRollbackSupport;
  readonly nonReversibleReason?: string;
  readonly status: Xcom2SetupOperationStatus;
  readonly journalStatus: Xcom2SetupJournalStatus;
  readonly hashValidationStatus: Xcom2SetupHashValidationStatus;
  readonly originalHash?: Xcom2SetupContentHash;
  readonly resultHash?: Xcom2SetupContentHash;
  readonly conflictReason?: string;
}

/** Installer/download work performed by the user, never by the transaction. */
export interface Xcom2SetupExternalAction {
  readonly actionId: string;
  readonly stepId: Xcom2SetupStepId;
  readonly kind: "steam-download" | "steam-installer" | "proton-installer" | "manual-verification";
  readonly title: string;
  readonly guidance: string;
  readonly status: "required" | "in-progress" | "completed" | "blocked";
}

export interface Xcom2SetupJournalProvenance {
  readonly scope: "local-machine";
  readonly managedBy: "native";
  readonly redactedLocation: string;
}

export interface Xcom2SetupApplyAvailability {
  /** Native audit result; frontend plans can never set this to true. */
  readonly allowed: boolean;
  /** Native audit blockers. Eligibility requires this collection to be empty. */
  readonly blockers: readonly string[];
}

export interface Xcom2SetupTransactionSummary {
  readonly transactionId: string;
  readonly planId: string;
  readonly planVersion: typeof XCOM2_SETUP_PLAN_VERSION;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: Xcom2SetupWorkflowState;
  /** Native transaction evidence. A dry-run plan never carries this field. */
  readonly executable: boolean;
  readonly approvedStepIds: readonly Xcom2SetupStepId[];
  readonly approvedOperationIds: readonly string[];
  readonly approvedCapabilities: readonly Xcom2SetupCapability[];
  /**
   * Exact native operation-set digest presented for review and approval. Apply
   * eligibility requires a complete SHA-256 digest; a boolean approval is not
   * sufficient.
   */
  readonly reviewedOperationDigest?: Xcom2SetupContentHash;
  readonly journal: Xcom2SetupJournalProvenance;
  readonly applyAvailability: Xcom2SetupApplyAvailability;
  readonly rollbackAvailable: boolean;
  readonly conflictReasons: readonly string[];
  readonly recoveryGuidance: readonly string[];
}

export interface Xcom2SetupTransactionDetail extends Xcom2SetupTransactionSummary {
  /** Native-generated, allowlisted previews. The client cannot add or alter them. */
  readonly operations: readonly Xcom2SetupOperation[];
  /** Kept separate because these actions are never journaled native mutations. */
  readonly externalActions: readonly Xcom2SetupExternalAction[];
}

export interface Xcom2SetupPrepareRequest {
  /** This remains a non-executable dry-run plan; native code independently validates it. */
  readonly plan: Xcom2SetupPlan;
}

/** Approval binds every reviewed identity and cannot be represented by a boolean. */
export interface Xcom2SetupApproveRequest {
  readonly transactionId: string;
  readonly planId: string;
  readonly planVersion: typeof XCOM2_SETUP_PLAN_VERSION;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly reviewedOperationDigest: Xcom2SetupContentHash;
  readonly approvedStepIds: readonly Xcom2SetupStepId[];
  readonly approvedOperationIds: readonly string[];
  readonly approvedCapabilities: readonly Xcom2SetupCapability[];
}

export interface Xcom2SetupApproval {
  readonly approvalToken: string;
  readonly transactionId: string;
  readonly planId: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly reviewedOperationDigest: Xcom2SetupContentHash;
  readonly expiresAt?: string;
}

export interface Xcom2SetupApplyRequest {
  readonly transactionId: string;
  readonly approvalToken: string;
}

export interface Xcom2SetupCancelRequest {
  readonly transactionId: string;
  readonly reason?: string;
}

export interface Xcom2SetupRollbackRequest {
  readonly transactionId: string;
  /** Hash validation and rollback scope are resolved from the native journal. */
  readonly reason?: string;
}

export interface Xcom2SetupRecoverRequest {
  readonly transactionId: string;
  readonly strategy: "resume-rollback" | "retry-rollback" | "verify-journal";
}

export interface Xcom2SetupGetTransactionRequest {
  readonly transactionId: string;
}

export interface Xcom2SetupListTransactionsRequest {
  readonly workspaceId: string;
  readonly states?: readonly Xcom2SetupWorkflowState[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Xcom2SetupTransactionList {
  readonly transactions: readonly Xcom2SetupTransactionSummary[];
  readonly nextCursor?: string;
}

export type Xcom2SetupErrorCode =
  | "invalid-request"
  | "not-found"
  | "stale-plan"
  | "workspace-generation-mismatch"
  | "operation-digest-mismatch"
  | "approval-required"
  | "approval-expired"
  | "apply-blocked"
  | "invalid-state"
  | "rollback-conflict"
  | "recovery-required"
  | "native-unavailable";

export interface Xcom2SetupFailure {
  readonly code: Xcom2SetupErrorCode;
  readonly message: string;
  readonly recoveryGuidance: readonly string[];
  readonly transaction?: Xcom2SetupTransactionDetail;
}

export type Xcom2SetupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Xcom2SetupFailure };

export type Xcom2SetupEventKind =
  "transaction-state" | "step-progress" | "operation-progress" | "terminal";

export interface Xcom2SetupTransactionEvent {
  readonly transactionId: string;
  /** Strictly increases within a transaction, including after process recovery. */
  readonly sequence: number;
  readonly occurredAt: string;
  readonly kind: Xcom2SetupEventKind;
  readonly state: Xcom2SetupWorkflowState;
  readonly terminal: boolean;
  readonly stepId?: Xcom2SetupStepId;
  readonly operationId?: string;
  readonly operationStatus?: Xcom2SetupOperationStatus;
  readonly completedOperations?: number;
  readonly totalOperations?: number;
  readonly message?: string;
}

export type Xcom2SetupEventListener = (event: Xcom2SetupTransactionEvent) => void;
export type Xcom2SetupUnsubscribe = () => void;
