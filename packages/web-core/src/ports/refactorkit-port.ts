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
  JavaEditorTransactionRequest,
  JavaEditorTransactionResult,
  MavenModuleRenamePreview,
  MavenModuleRenameApplyRequest,
  MavenModuleRenameApplyResult,
  MavenModuleRenameDiscardRequest,
  MavenModuleRenamePreviewRequest,
  MavenModuleRenameRollbackRequest,
  MavenModuleRenameRollbackResult,
} from "@ide/contracts";

/** A rollback request was refused before any source write; retry still requires full authority checks. */
export class RefactorRollbackNotStartedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefactorRollbackNotStartedError";
  }
}

/** Provider-neutral boundary. Adapters alone translate these calls to an installed API. */
export interface RefactorKitPort {
  /** Explicit editor-owned transactions; absence means unavailable. Never delegates to saved-source Apply. */
  editorTransaction?(request: JavaEditorTransactionRequest): Promise<JavaEditorTransactionResult>;
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
  /** Read-only provider-owned Maven module rename preview. It grants no Apply authority. */
  previewMavenModuleRename(
    request: MavenModuleRenamePreviewRequest,
  ): Promise<MavenModuleRenamePreview>;
  discardMavenModuleRenamePreview(request: MavenModuleRenameDiscardRequest): Promise<boolean>;
  applyMavenModuleRename(
    request: MavenModuleRenameApplyRequest,
  ): Promise<MavenModuleRenameApplyResult>;
  rollbackMavenModuleRename(
    request: MavenModuleRenameRollbackRequest,
  ): Promise<MavenModuleRenameRollbackResult>;
  applyRefactoring(request: RefactorApplyRequest): Promise<RefactorApplyResult>;
  /** Adapters must reject this call when rollback is not advertised. */
  rollbackRefactoring(request: RefactorRollbackRequest): Promise<RefactorRollbackResult>;
  discardRefactoring(request: DiscardRefactorKitPlanRequest): Promise<DiscardRefactorKitPlanResult>;
}
