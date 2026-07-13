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

/** Provider-neutral boundary. Adapters alone translate these calls to an installed API. */
export interface RefactorKitPort {
  getStatus(): Promise<RefactorKitStatus>;
  getCapabilities(): Promise<RefactorKitCapabilities>;
  scan(): Promise<RefactorKitCommandResult>;
  diagnostics(): Promise<RefactorKitCommandResult>;
  symbols(): Promise<RefactorKitCommandResult>;
  definition(symbol: string): Promise<RefactorKitCommandResult>;
  references(symbol: string): Promise<RefactorKitCommandResult>;
  previewExternalJavaImport(request: PreviewExternalJavaImportRequest): Promise<RefactorKitPatchPlan>;
  applyPlan(request: ApplyRefactorKitPlanRequest): Promise<ApplyRefactorKitPlanResult>;
  /** Adapters must reject this call when rollback is not advertised. */
  rollbackTransaction(
    request: RollbackRefactorKitTransactionRequest,
  ): Promise<RollbackRefactorKitTransactionResult>;
  discardPlan(request: DiscardRefactorKitPlanRequest): Promise<DiscardRefactorKitPlanResult>;
}
