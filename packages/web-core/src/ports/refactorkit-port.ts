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
  SavedSnapshotDefinitionRequest,
  SavedSnapshotDefinitionResult,
  SavedSnapshotSemanticSessionStartRequest,
  SavedSnapshotSemanticSessionStartResult,
  SavedSnapshotSemanticSessionStopRequest,
  SavedSnapshotSemanticSessionStopResult,
  SavedSnapshotSymbolSearchRequest,
  SavedSnapshotSymbolSearchResult,
} from "@ide/contracts";

/** Provider-neutral boundary. Adapters alone translate these calls to an installed API. */
export interface RefactorKitPort {
  getStatus(): Promise<RefactorKitStatus>;
  getCapabilities(): Promise<RefactorKitCapabilities>;
  scan(): Promise<RefactorKitCommandResult>;
  diagnostics(): Promise<RefactorKitCommandResult>;
  symbols(): Promise<RefactorKitCommandResult>;
  definition(symbol: string): Promise<RefactorKitCommandResult>;
  references(symbol: string): Promise<RefactorKitCommandResult>;
  startSavedSnapshotSemanticSession(
    request: SavedSnapshotSemanticSessionStartRequest,
  ): Promise<SavedSnapshotSemanticSessionStartResult>;
  stopSavedSnapshotSemanticSession(
    request: SavedSnapshotSemanticSessionStopRequest,
  ): Promise<SavedSnapshotSemanticSessionStopResult>;
  searchSavedSnapshotSymbols(
    request: SavedSnapshotSymbolSearchRequest,
  ): Promise<SavedSnapshotSymbolSearchResult>;
  resolveSavedSnapshotDefinition(
    request: SavedSnapshotDefinitionRequest,
  ): Promise<SavedSnapshotDefinitionResult>;
  previewExternalJavaImport(
    request: PreviewExternalJavaImportRequest,
  ): Promise<RefactorKitPatchPlan>;
  applyPlan(request: ApplyRefactorKitPlanRequest): Promise<ApplyRefactorKitPlanResult>;
  /** Adapters must reject this call when rollback is not advertised. */
  rollbackTransaction(
    request: RollbackRefactorKitTransactionRequest,
  ): Promise<RollbackRefactorKitTransactionResult>;
  discardPlan(request: DiscardRefactorKitPlanRequest): Promise<DiscardRefactorKitPlanResult>;
}
