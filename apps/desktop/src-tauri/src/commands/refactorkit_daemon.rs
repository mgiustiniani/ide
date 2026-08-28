//! Thin Tauri inbound facade for the managed RefactorKit daemon application service.

mod application;
mod capability_policy;
mod contract;
mod path_policy;
mod real_engine;
mod saved_snapshot_diagnostics;
mod saved_snapshot_semantic;
mod transport;

#[cfg(test)]
mod boundary_tests;

use serde_json::Value;
use tauri::State;

pub use application::RefactorKitDaemonState;
pub use capability_policy::RefactorKitCapabilities;
pub use contract::{
    ApplyRefactoringRequest, ApplyRequest, ApprovalEvidence, DiscardRequest, PreviewRequest,
    PreviewRefactoringRequest, RefactoringOperation, RefactoringTarget, RollbackRequest,
    RollbackRefactoringRequest,
};
pub use saved_snapshot_diagnostics::{
    run_saved_snapshot_diagnostics, TypeScriptDiagnosticsError, TypeScriptDiagnosticsRequest,
    TypeScriptDiagnosticsResponse,
};
pub use real_engine::{
    RealEngineCommandResult, RealEngineLocation, RealEngineCapabilities,
};
pub use saved_snapshot_semantic::{
    ExternalToolchainRequest, ResolveSavedSnapshotDefinitionRequest, SavedSnapshotSemanticError,
    SavedSnapshotSemanticState, SearchSavedSnapshotSymbolsRequest,
    StartSavedSnapshotSemanticSessionRequest, StopSavedSnapshotSemanticSessionRequest,
};

#[tauri::command]
pub fn get_refactorkit_capabilities(
    state: State<'_, RefactorKitDaemonState>,
) -> Result<RefactorKitCapabilities, String> {
    application::get_refactorkit_capabilities(&state)
}

#[tauri::command]
pub fn preview_refactorkit_external_java_import(
    request: PreviewRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::preview_refactorkit_external_java_import(request, &state)
}

#[tauri::command]
pub fn apply_refactorkit_plan(
    request: ApplyRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::apply_refactorkit_plan(request, &state)
}

#[tauri::command]
pub fn discard_refactorkit_plan(
    request: DiscardRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::discard_refactorkit_plan(request, &state)
}

#[tauri::command]
pub fn rollback_refactorkit_transaction(
    request: RollbackRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::rollback_refactorkit_transaction(request, &state)
}

#[tauri::command]
pub fn preview_refactorkit_refactoring(
    request: PreviewRefactoringRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::preview_refactoring(request, &state)
}

#[tauri::command]
pub fn apply_refactorkit_refactoring(
    request: ApplyRefactoringRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::apply_refactoring(request, &state)
}

#[tauri::command]
pub fn rollback_refactorkit_refactoring(
    request: RollbackRefactoringRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::rollback_refactoring(request, &state)
}

#[tauri::command]
pub fn discard_refactorkit_refactoring(
    request: DiscardRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    application::discard_refactoring(request, &state)
}

#[tauri::command]
pub fn start_refactorkit_saved_snapshot_semantic_session(
    request: StartSavedSnapshotSemanticSessionRequest,
    state: State<'_, SavedSnapshotSemanticState>,
) -> Result<Value, SavedSnapshotSemanticError> {
    saved_snapshot_semantic::start(request, &state)
}

#[tauri::command]
pub fn stop_refactorkit_saved_snapshot_semantic_session(
    request: StopSavedSnapshotSemanticSessionRequest,
    state: State<'_, SavedSnapshotSemanticState>,
) -> Result<Value, SavedSnapshotSemanticError> {
    saved_snapshot_semantic::stop(request, &state)
}

#[tauri::command]
pub fn search_refactorkit_saved_snapshot_symbols(
    request: SearchSavedSnapshotSymbolsRequest,
    state: State<'_, SavedSnapshotSemanticState>,
) -> Result<Value, SavedSnapshotSemanticError> {
    saved_snapshot_semantic::search(request, &state)
}

#[tauri::command]
pub fn resolve_refactorkit_saved_snapshot_definition(
    request: ResolveSavedSnapshotDefinitionRequest,
    state: State<'_, SavedSnapshotSemanticState>,
) -> Result<Value, SavedSnapshotSemanticError> {
    saved_snapshot_semantic::resolve_definition(request, &state)
}

#[tauri::command]
pub fn shutdown_refactorkit_daemon(
    state: State<'_, RefactorKitDaemonState>,
    semantic_state: State<'_, SavedSnapshotSemanticState>,
) -> Result<(), String> {
    semantic_state.shutdown_all();
    application::shutdown_refactorkit_daemon(&state)
}

// -----------------------------------------------------------------------------
// Real-engine discovery + CLI delegation for REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001
// -----------------------------------------------------------------------------

/// Authoritative real-engine capability report correlated to the discovered engine,
/// its version, and the workspace. Honest-unavailable when no wrapper PATH or
/// installed engine path is discoverable.
#[tauri::command]
pub fn get_refactorkit_engine_capabilities() -> Result<RealEngineCapabilities, String> {
    real_engine::get_refactorkit_engine_capabilities()
}

/// Read-only real-engine preview: no `--apply` is ever passed, and the preview
/// grants no apply authority for the plan.
#[tauri::command]
pub fn preview_refactorkit_engine_refactoring(
    request: real_engine::EnginePreviewRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    real_engine::preview_refactoring(request, &state)
}

/// Real-engine apply bound to the exact reviewed plan (operation + target) under
/// explicit approval; a changed or replaced plan requires a fresh preview.
#[tauri::command]
pub fn apply_refactorkit_engine_refactoring(
    request: real_engine::EngineApplyRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    real_engine::apply_refactoring(request, &state)
}

/// Transaction-bound real-engine rollback, exposed only when the engine advertises
/// `patch rollback`.
#[tauri::command]
pub fn rollback_refactorkit_engine_refactoring(
    request: real_engine::EngineRollbackRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    real_engine::rollback_refactoring(request, &state)
}

/// Local retirement of a reviewed real-engine plan; no real engine write occurs.
#[tauri::command]
pub fn discard_refactorkit_engine_refactoring(
    request: real_engine::EngineDiscardRequest,
    state: State<'_, RefactorKitDaemonState>,
) -> Result<Value, String> {
    real_engine::discard_refactoring(request, &state)
}

/// Delegate `scan` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_scan() -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_scan()
}

/// Delegate `symbols` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_symbols() -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_symbols()
}

/// Delegate `definition --symbol` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_definition(symbol: String) -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_definition(symbol)
}

/// Delegate `references --symbol` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_references(symbol: String) -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_references(symbol)
}

/// Delegate `diagnostics` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_diagnostics() -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_diagnostics()
}
