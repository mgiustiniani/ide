mod application;
mod contract;
mod filesystem;
mod policy;
mod state;

pub use contract::{
    AcknowledgmentDecision, AcknowledgmentRefusalCode, ActivationAcknowledgment,
    ActivationEvidenceState, ActivationLifecycleDecision, ActivationLifecycleEvent,
    ActivationRevocationCode, BeginActivationEvidenceRequest, BuildRecipeCandidate,
    BuildRecipeInspectionRequest, NativeActivationCandidate,
};
pub use state::Xcom2NativeActivationState;

use tauri::State;

use crate::workspace::workspace_root;

/// Atomically revokes prior native authority and creates one correlated scan/configuration attempt.
#[tauri::command]
pub fn begin_xcom2_native_activation_evidence(
    request: BeginActivationEvidenceRequest,
    state: State<'_, Xcom2NativeActivationState>,
) -> Result<NativeActivationCandidate, String> {
    let root = workspace_root().map_err(|_| "workspace-authority-unavailable".to_string())?;
    application::begin(&state, &root, request)
}

/// Accepts only one native attempt receipt and its opaque selected evidence handles.
#[tauri::command]
pub fn acknowledge_xcom2_native_activation_evidence(
    acknowledgment: ActivationAcknowledgment,
    state: State<'_, Xcom2NativeActivationState>,
) -> AcknowledgmentDecision {
    application::acknowledge(&state, acknowledgment)
}

/// Applies a closed synchronous revocation event; it cannot create or restore authority.
#[tauri::command]
pub fn revoke_xcom2_native_activation_evidence(
    event: ActivationLifecycleEvent,
    state: State<'_, Xcom2NativeActivationState>,
) -> ActivationLifecycleDecision {
    application::transition(&state, event)
}

/// Returns closed metadata for one currently accepted module without executing project input.
#[tauri::command]
pub fn inspect_xcom2_project_build_recipe(
    request: BuildRecipeInspectionRequest,
    state: State<'_, Xcom2NativeActivationState>,
) -> Result<BuildRecipeCandidate, String> {
    application::inspect(&state, request)
}

#[cfg(test)]
mod tests;
