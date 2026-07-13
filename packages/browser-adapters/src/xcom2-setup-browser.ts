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
} from '@ide/contracts';
import type { Xcom2SetupPort, Xcom2SetupSubscription } from '@ide/web-core/ports';

const UNAVAILABLE_MESSAGE =
  'XCOM 2 setup transactions require desktop-only native filesystem and journal services and are unavailable in a browser.';

export type BrowserXcom2SetupOperation =
  | 'prepare'
  | 'approve'
  | 'apply'
  | 'cancel'
  | 'rollback'
  | 'recover';

/** Error raised when browser code requests a desktop-only XCOM 2 transaction operation. */
export class BrowserXcom2SetupUnavailableError extends Error {
  readonly code = 'BROWSER_XCOM2_SETUP_UNAVAILABLE';

  constructor(readonly operation: BrowserXcom2SetupOperation) {
    super(`Cannot ${operation} an XCOM 2 setup transaction in a browser. ${UNAVAILABLE_MESSAGE}`);
    this.name = 'BrowserXcom2SetupUnavailableError';
  }
}

function rejectUnavailable<T>(
  operation: BrowserXcom2SetupOperation,
): Promise<Xcom2SetupResult<T>> {
  return Promise.reject(new BrowserXcom2SetupUnavailableError(operation));
}

function unavailableResult<T>(): Xcom2SetupResult<T> {
  return {
    ok: false,
    error: {
      code: 'native-unavailable',
      message: UNAVAILABLE_MESSAGE,
      recoveryGuidance: ['Use the desktop application to inspect XCOM 2 setup transactions.'],
    },
  };
}

/**
 * Honest browser boundary for native XCOM 2 setup transactions.
 *
 * It creates no transaction state and performs no filesystem, network, timer,
 * polling, or native work. Mutation requests reject, reads explicitly report
 * native unavailability, and subscriptions never invent progress events.
 */
export class BrowserXcom2SetupAdapter implements Xcom2SetupPort {
  prepare(
    _request: Xcom2SetupPrepareRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return rejectUnavailable('prepare');
  }

  approve(
    _request: Xcom2SetupApproveRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupApproval>> {
    return rejectUnavailable('approve');
  }

  apply(
    _request: Xcom2SetupApplyRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return rejectUnavailable('apply');
  }

  getTransaction(
    _request: Xcom2SetupGetTransactionRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return Promise.resolve(unavailableResult());
  }

  listTransactions(
    _request: Xcom2SetupListTransactionsRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionList>> {
    return Promise.resolve(unavailableResult());
  }

  cancel(
    _request: Xcom2SetupCancelRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return rejectUnavailable('cancel');
  }

  rollback(
    _request: Xcom2SetupRollbackRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return rejectUnavailable('rollback');
  }

  recover(
    _request: Xcom2SetupRecoverRequest,
  ): Promise<Xcom2SetupResult<Xcom2SetupTransactionDetail>> {
    return rejectUnavailable('recover');
  }

  subscribe(
    _subscription: Xcom2SetupSubscription,
    _listener: Xcom2SetupEventListener,
  ): Xcom2SetupUnsubscribe {
    let active = true;

    return () => {
      if (!active) return;
      active = false;
    };
  }
}
