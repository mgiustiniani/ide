// ---------------------------------------------------------------------------
// @ide/web-core – Xcom2SetupPort
// ---------------------------------------------------------------------------
// Provider-neutral transaction boundary. Native implementations alone discover
// targets and construct allowlisted operations; callers provide no paths or raw
// filesystem instructions.

import type {
  Xcom2SetupApproval,
  Xcom2SetupApplyRequest,
  Xcom2SetupApproveRequest,
  Xcom2SetupCancelRequest,
  Xcom2SetupEventListener,
  Xcom2SetupGetTransactionRequest,
  Xcom2SetupListTransactionsRequest,
  Xcom2SetupPrepareRequest,
  Xcom2SetupRecoverRequest,
  Xcom2SetupResult,
  Xcom2SetupRollbackRequest,
  Xcom2SetupTransactionDetail,
  Xcom2SetupTransactionList,
  Xcom2SetupUnsubscribe,
} from "@ide/contracts";

export interface Xcom2SetupSubscription {
  readonly transactionId?: string;
  readonly workspaceId?: string;
}

export interface Xcom2SetupPort {
  /** Validate a dry-run plan and ask native code to produce a journaled preview. */
  prepare(
    request: Xcom2SetupPrepareRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

  /** Bind explicit reviewed steps, operations, capabilities, and digest. */
  approve(request: Xcom2SetupApproveRequest): Promise<Xcom2SetupResult<Xcom2SetupApproval>>;

  /**
   * Start a transaction whose native evidence is executable, unblocked, in the
   * approval state, bound to the exact reviewed digest, and not already rollbackable.
   * Dry-run plans and external Steam, Proton, prefix, or package-manager actions
   * are never executable through this boundary.
   */
  apply(request: Xcom2SetupApplyRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

  getTransaction(
    request: Xcom2SetupGetTransactionRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

  listTransactions(
    request: Xcom2SetupListTransactionsRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionList>>;

  cancel(request: Xcom2SetupCancelRequest): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

  rollback(
    request: Xcom2SetupRollbackRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

  recover(
    request: Xcom2SetupRecoverRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>>;

  /** Events are monotonically sequenced per transaction. */
  subscribe(
    subscription: Xcom2SetupSubscription,
    listener: Xcom2SetupEventListener,
  ): Xcom2SetupUnsubscribe;
}
