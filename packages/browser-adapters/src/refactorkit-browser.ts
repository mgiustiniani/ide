import type {
  ApplyRefactorKitPlanRequest,
  ApplyRefactorKitPlanResult,
  DiscardRefactorKitPlanRequest,
  DiscardRefactorKitPlanResult,
  PreviewExternalJavaImportRequest,
  RefactorKitCapabilities,
  RefactorKitCommandResult,
  RefactorKitPatchPlan,
  RefactorKitStatus,
  RollbackRefactorKitTransactionRequest,
  RollbackRefactorKitTransactionResult,
} from '@ide/contracts';
import type { RefactorKitPort } from '@ide/web-core/ports';

const UNAVAILABLE_REASON =
  'Local RefactorKit daemon access is desktop-only and unavailable in browser clients.';

/** Error raised when browser code requests a local RefactorKit operation. */
export class BrowserRefactorKitUnavailableError extends Error {
  readonly code = 'BROWSER_REFACTORKIT_UNAVAILABLE';

  constructor() {
    super(UNAVAILABLE_REASON);
    this.name = 'BrowserRefactorKitUnavailableError';
  }
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(new BrowserRefactorKitUnavailableError());
}

function unavailableCapabilities(): RefactorKitCapabilities {
  return {
    api: 'refactorkit',
    apiVersion: 'unknown',
    provider: 'refactorkit',
    providerVersion: null,
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: 'experimental',
    },
    languageKernel: {
      available: false,
      schema: null,
      reason: UNAVAILABLE_REASON,
    },
  };
}

/** Honest browser boundary for the desktop-owned local RefactorKit daemon. */
export class BrowserRefactorKitAdapter implements RefactorKitPort {
  getStatus(): Promise<RefactorKitStatus> {
    return Promise.resolve({
      available: false,
      lastError: UNAVAILABLE_REASON,
    });
  }

  getCapabilities(): Promise<RefactorKitCapabilities> {
    return Promise.resolve(unavailableCapabilities());
  }

  scan(): Promise<RefactorKitCommandResult> {
    return unavailable();
  }

  diagnostics(): Promise<RefactorKitCommandResult> {
    return unavailable();
  }

  symbols(): Promise<RefactorKitCommandResult> {
    return unavailable();
  }

  definition(_symbol: string): Promise<RefactorKitCommandResult> {
    return unavailable();
  }

  references(_symbol: string): Promise<RefactorKitCommandResult> {
    return unavailable();
  }

  previewExternalJavaImport(
    _request: PreviewExternalJavaImportRequest,
  ): Promise<RefactorKitPatchPlan> {
    return unavailable();
  }

  applyPlan(_request: ApplyRefactorKitPlanRequest): Promise<ApplyRefactorKitPlanResult> {
    return unavailable();
  }

  rollbackTransaction(
    _request: RollbackRefactorKitTransactionRequest,
  ): Promise<RollbackRefactorKitTransactionResult> {
    return unavailable();
  }

  discardPlan(
    _request: DiscardRefactorKitPlanRequest,
  ): Promise<DiscardRefactorKitPlanResult> {
    return unavailable();
  }
}
