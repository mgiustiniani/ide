//! Thin Tauri inbound facade for the managed RefactorKit daemon application service.

mod application;
mod capability_policy;
mod contract;
pub mod java_context_commands;
mod java_context_refactoring;
mod java_dependency_source;
mod java_editor_refactoring;
mod java_editor_transaction;
mod java_execution_context;
mod java_entry_points;
pub use java_entry_points::JavaEntryPointState;
mod java_maven_module_rename;
mod java_navigation;
mod java_editor_diagnostics;
mod java_platform_source;
mod java_project_context;
pub mod java_source_commands;
mod path_policy;
mod real_engine;
mod saved_snapshot_diagnostics;
mod saved_snapshot_semantic;
pub use java_context_commands::{
    apply_refactorkit_java_project_language_settings, cancel_refactorkit_java_navigation_query,
    clear_refactorkit_java_project_language_settings, query_refactorkit_java_navigation,
    query_refactorkit_java_project_context, refactorkit_java_editor_transaction,
    stop_refactorkit_java_navigation, stop_refactorkit_java_project_context,
    stop_refactorkit_java_project_watch, watch_refactorkit_java_project_inputs,
};
pub use java_navigation::JavaNavigationState;
pub use java_project_context::JavaProjectContextState;
pub(super) use java_project_context::GradleGeneratedSourceSet;

#[cfg(test)]
pub(crate) use java_execution_context::MavenTestJvmSourceSetFacts;
pub(crate) use java_execution_context::{
    DeclaredJdkCompilation, JavaExecutionProjectContext, JavaExecutionProjectSelection, MavenFailsafeExecution,
    MavenTestJvmModuleFacts, MavenTestJvmSelection, ResolvedProject,
};

#[cfg(test)]
pub(crate) fn daemon_env_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn trace_java_application_lifecycle(stage: &str) {
    java_project_context::trace_snapshot("native.application.lifecycle", json!({"stage": stage}));
}

mod transport;

#[cfg(test)]
mod boundary_tests;

use serde_json::{json, Value};
use tauri::State;

pub use application::RefactorKitDaemonState;
pub use capability_policy::RefactorKitCapabilities;
pub use contract::{
    ApplyRefactoringRequest, ApplyRequest, ApprovalEvidence, DiscardRequest,
    MavenModuleRenameApplyRequest, MavenModuleRenamePreviewRequest,
    MavenModuleRenameRollbackRequest, PreviewRefactoringRequest, PreviewRequest,
    RefactoringOperation, RefactoringTarget, RollbackRefactoringRequest, RollbackRequest,
};
pub use real_engine::{RealEngineCapabilities, RealEngineCommandResult, RealEngineLocation};
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
pub async fn get_refactorkit_capabilities<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RefactorKitCapabilities, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            application::get_refactorkit_capabilities(&app.state::<RefactorKitDaemonState>())
        })
    })
    .await
}

/// Preview for the provider-owned Maven module rename planner.
#[tauri::command]
pub async fn preview_refactorkit_maven_module_rename<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: MavenModuleRenamePreviewRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            java_maven_module_rename::preview(
                request,
                &app.state::<JavaProjectContextState>(),
                &app.state::<RefactorKitDaemonState>(),
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn apply_refactorkit_maven_module_rename<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: MavenModuleRenameApplyRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            java_maven_module_rename::apply(
                request,
                &app.state::<JavaProjectContextState>(),
                &app.state::<super::java_language::JavaLanguageServiceState>(),
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn rollback_refactorkit_maven_module_rename<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: MavenModuleRenameRollbackRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            java_maven_module_rename::rollback(
                request,
                &app.state::<JavaProjectContextState>(),
                &app.state::<super::java_language::JavaLanguageServiceState>(),
            )
        })
    })
    .await
}

/// Discard only a retained read-only Maven module rename preview.
#[tauri::command]
pub async fn discard_refactorkit_maven_module_rename_preview<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: DiscardRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            java_maven_module_rename::discard(request, &app.state::<JavaProjectContextState>())
        })
    })
    .await
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
pub async fn get_refactorkit_engine_capabilities() -> Result<RealEngineCapabilities, String> {
    super::blocking::run(real_engine::get_refactorkit_engine_capabilities).await
}

/// Read-only real-engine preview: no `--apply` is ever passed, and the preview
/// grants no apply authority for the plan.
#[tauri::command]
pub async fn preview_refactorkit_engine_refactoring<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: real_engine::EnginePreviewRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            real_engine::preview_refactoring_with_project_context(
                request,
                &app.state::<RefactorKitDaemonState>(),
                &app.state::<JavaProjectContextState>(),
            )
        })
    })
    .await
}

/// Real-engine apply bound to the exact reviewed plan (operation + target) under
/// explicit approval; a changed or replaced plan requires a fresh preview.
#[tauri::command]
pub async fn apply_refactorkit_engine_refactoring<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: real_engine::EngineApplyRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            real_engine::apply_refactoring_with_project_context(
                request,
                &app.state::<RefactorKitDaemonState>(),
                &app.state::<JavaProjectContextState>(),
            )
        })
    })
    .await
}

/// Transaction-bound real-engine rollback, exposed only when the engine advertises
/// `patch rollback`.
#[tauri::command]
pub async fn rollback_refactorkit_engine_refactoring<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: real_engine::EngineRollbackRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            real_engine::rollback_refactoring_with_project_context(
                request,
                &app.state::<RefactorKitDaemonState>(),
                &app.state::<JavaProjectContextState>(),
            )
        })
    })
    .await
}

/// Local retirement of a reviewed real-engine plan; no real engine write occurs.
#[tauri::command]
pub async fn discard_refactorkit_engine_refactoring<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: real_engine::EngineDiscardRequest,
) -> Result<Value, String> {
    use tauri::Manager;
    super::blocking::run(move || {
        super::workspace_registry::with_root_activation(|| {
            real_engine::discard_refactoring_with_project_context(
                request,
                &app.state::<RefactorKitDaemonState>(),
                &app.state::<JavaProjectContextState>(),
            )
        })
    })
    .await
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
pub fn run_refactorkit_engine_definition(
    symbol: String,
) -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_definition(symbol)
}

/// Delegate `references --symbol` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_references(
    symbol: String,
) -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_references(symbol)
}

/// Delegate `diagnostics` to the real engine CLI.
#[tauri::command]
pub fn run_refactorkit_engine_diagnostics() -> Result<RealEngineCommandResult, String> {
    real_engine::run_engine_diagnostics()
}
