//! Thin Tauri inbound facade for the managed RefactorKit daemon application service.

mod application;
mod capability_policy;
mod contract;
mod path_policy;
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
pub fn shutdown_refactorkit_daemon(state: State<'_, RefactorKitDaemonState>) -> Result<(), String> {
    application::shutdown_refactorkit_daemon(&state)
}
