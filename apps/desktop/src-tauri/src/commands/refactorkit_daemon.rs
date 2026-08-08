//! Thin Tauri inbound facade for the managed RefactorKit daemon application service.

mod application;
mod capability_policy;
mod contract;
mod path_policy;
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
    ApplyRequest, ApprovalEvidence, DiscardRequest, PreviewRequest, RollbackRequest,
};
pub use saved_snapshot_diagnostics::{
    run_saved_snapshot_diagnostics, TypeScriptDiagnosticsError, TypeScriptDiagnosticsRequest,
    TypeScriptDiagnosticsResponse,
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
