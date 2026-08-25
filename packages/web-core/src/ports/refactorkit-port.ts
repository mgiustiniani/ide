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
  RefactorApplyRequest,
  RefactorApplyResult,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorRollbackRequest,
  RefactorRollbackResult,
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
  TypeScriptDiagnosticsRequest,
  TypeScriptDiagnosticsResponse,
} from "@ide/contracts";

/** Provider-neutral boundary. Adapters alone translate these calls to an installed API. */
export interface RefactorKitPort {
  getStatus(): Promise<RefactorKitStatus>;
  getCapabilities(): Promise<RefactorKitCapabilities>;
  scan(): Promise<RefactorKitCommandResult>;
  diagnostics(request: TypeScriptDiagnosticsRequest): Promise<TypeScriptDiagnosticsResponse>;
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

  // ---------------------------------------------------------------------------
  // General Java refactoring (rename / move / change-method-signature / safe-delete)
  // Provider-neutral boundary: adapters alone translate these calls to an
  // installed API. Preview is read-only and grants no apply authority; Apply
  // binds to the exact reviewed plan under explicit authority; Rollback is
  // exposed only when the provider advertises the relevant transaction class.
  // When the provider is absent, its capability metadata is unacceptable, or
  // the operation is unsupported, an adapter returns an honest unavailable /
  // unsupported outcome (refused / error status) and never fabricates a plan,
  // a successful result, or a fallback textual rewrite.
  // ---------------------------------------------------------------------------
  previewRefactoring(request: RefactorPreviewRequest): Promise<RefactorPreviewResult>;
  applyRefactoring(request: RefactorApplyRequest): Promise<RefactorApplyResult>;
  /** Adapters must reject this call when rollback is not advertised. */
  rollbackRefactoring(request: RefactorRollbackRequest): Promise<RefactorRollbackResult>;
  discardRefactoring(request: DiscardRefactorKitPlanRequest): Promise<DiscardRefactorKitPlanResult>;
}
