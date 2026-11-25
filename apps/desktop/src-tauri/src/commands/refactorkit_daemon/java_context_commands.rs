//! Tauri inbound commands for Java project context and cursor navigation.

use super::{
    java_editor_transaction, java_navigation, java_project_context, JavaNavigationState,
    JavaProjectContextState,
};
use serde_json::{json, Value};
use tauri::{Emitter, State};

const JAVA_PROJECT_INPUTS_CHANGED: &str = "ide://java-project-inputs-changed";

#[tauri::command]
pub async fn query_refactorkit_java_editor_diagnostics(
    window: tauri::WebviewWindow,
    request: super::java_editor_diagnostics::Request,
    state: State<'_, JavaNavigationState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Java diagnostics require the main workspace window.".into());
    }
    let request = java_navigation::JavaNavigationRequest::editor_diagnostics(request);
    tauri::async_runtime::spawn_blocking(java_navigation::prepare_query(request, &state)?)
        .await
        .map_err(|_| "Java compiler diagnostics ended safely.".to_string())?
}

#[tauri::command]
pub async fn refactorkit_java_editor_transaction(
    window: tauri::WebviewWindow,
    request: java_editor_transaction::Request,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Java editor transactions require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_editor_transaction::prepare(request, &state)?)
        .await
        .map_err(|_| "The Java editor transaction acknowledgement is unknown.".to_string())?
}

#[tauri::command]
pub async fn query_refactorkit_java_project_context(
    window: tauri::WebviewWindow,
    request: java_project_context::Request,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Java project context requires the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_project_context::prepare_query(request, &state)?)
        .await
        .map_err(|_| "Java project context ended safely.".to_string())?
}

#[tauri::command]
pub async fn recover_refactorkit_java_saved_sources<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    request: java_project_context::SavedSourceRecoveryRequest,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Java saved-file recovery requires the main workspace window.".into());
    }
    let recover = java_project_context::prepare_saved_source_recovery(request, &state)?;
    super::super::blocking::run(move || {
        use tauri::Manager;
        let java_language = app.state::<crate::commands::java_language::JavaLanguageServiceState>();
        recover(&java_language)
    })
    .await
}

#[tauri::command]
pub async fn apply_refactorkit_java_project_language_settings<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    request: java_project_context::LanguageSettingsRequest,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    use tauri::Manager;
    if window.label() != "main" {
        return Err("Java project language settings require the main workspace window.".into());
    }
    let context_state = JavaProjectContextState(state.shared());
    tauri::async_runtime::spawn_blocking(move || {
        let language_state =
            app.state::<crate::commands::java_language::JavaLanguageServiceState>();
        java_project_context::apply_language_settings(request, &context_state, &language_state)
    })
    .await
    .map_err(|_| "Applying Java project compiler settings ended safely.".to_string())?
}

#[tauri::command]
pub async fn stop_refactorkit_java_project_context(
    window: tauri::WebviewWindow,
    authority: java_project_context::Authority,
    state: State<'_, JavaProjectContextState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Java project context requires the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_project_context::prepare_stop(authority, &state)?)
        .await
        .map_err(|_| "Java project context ended safely.".to_string())?
}

#[tauri::command]
pub async fn clear_refactorkit_java_project_language_settings<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    authority: java_project_context::Authority,
) -> Result<(), String> {
    use tauri::Manager;
    if window.label() != "main" {
        return Err("Java project language settings require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let language_state =
            app.state::<crate::commands::java_language::JavaLanguageServiceState>();
        java_project_context::clear_language_settings(authority, &language_state)
    })
    .await
    .map_err(|_| "Restoring Java language settings ended safely.".to_string())?
}

#[tauri::command]
pub async fn watch_refactorkit_java_project_inputs(
    window: tauri::WebviewWindow,
    authority: java_project_context::Authority,
    project_path: String,
    watch_id: String,
    state: State<'_, JavaProjectContextState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Java project context requires the main workspace window.".into());
    }
    let state = state.shared();
    tauri::async_runtime::spawn_blocking(move || {
        java_project_context::watch_project_inputs(
            authority,
            project_path,
            watch_id,
            state,
            move |event| {
                let mut payload = json!({
                    "workspaceId": event.workspace_id,
                    "generation": event.generation,
                    "projectPath": event.project_path,
                    "watchId": event.watch_id,
                    "status": event.status,
                });
                if let Some(kind) = event.change_kind {
                    payload["changeKind"] = json!(kind);
                }
                let _ = window.emit(JAVA_PROJECT_INPUTS_CHANGED, payload);
            },
        )
    })
    .await
    .map_err(|_| "Java project change tracking ended safely.".to_string())?
}

#[tauri::command]
pub async fn stop_refactorkit_java_project_watch(
    window: tauri::WebviewWindow,
    authority: java_project_context::Authority,
    watch_id: String,
    state: State<'_, JavaProjectContextState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Java project context requires the main workspace window.".into());
    }
    java_project_context::stop_project_watch(authority, watch_id, state.shared())
}

#[tauri::command]
pub async fn query_refactorkit_java_navigation(
    window: tauri::WebviewWindow,
    request: java_navigation::JavaNavigationRequest,
    state: State<'_, JavaNavigationState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Java navigation requires the main workspace window.".into());
    }
    let started = std::time::Instant::now();
    let request_id = request.request_id.clone();
    let result =
        tauri::async_runtime::spawn_blocking(java_navigation::prepare_query(request, &state)?)
            .await
            .map_err(|_| "Java navigation ended safely.".to_string())??;
    java_project_context::trace_snapshot(
        "navigation.command.complete",
        json!({
            "requestId": request_id,
            "elapsedMs": started.elapsed().as_millis(),
            "status": result["status"],
        }),
    );
    Ok(result)
}

#[tauri::command]
pub async fn cancel_refactorkit_java_navigation_query(
    window: tauri::WebviewWindow,
    context: java_navigation::JavaNavigationContext,
    request_id: String,
    state: State<'_, JavaNavigationState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Java navigation requires the main workspace window.".into());
    }
    java_navigation::cancel_request(context, request_id, &state)
}

#[tauri::command]
pub async fn stop_refactorkit_java_navigation(
    window: tauri::WebviewWindow,
    context: java_navigation::JavaNavigationContext,
    state: State<'_, JavaNavigationState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Java navigation requires the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_navigation::prepare_stop(context, &state)?)
        .await
        .map_err(|_| "Java navigation ended safely.".to_string())?
}

#[tauri::command]
pub async fn query_refactorkit_java_entry_points(
    window: tauri::WebviewWindow,
    request: super::java_entry_points::Request,
    state: State<'_, JavaProjectContextState>,
    requests: State<'_, super::JavaEntryPointState>,
) -> Result<Value, String> {
    if window.label() != "main" { return Err("Main-class discovery requires the main workspace window.".into()); }
    tauri::async_runtime::spawn_blocking(super::java_entry_points::prepare(request,&state,&requests)?)
        .await.map_err(|_| "Main-class discovery ended safely.".to_string())?
}

#[tauri::command]
pub fn cancel_refactorkit_java_entry_points(
    window: tauri::WebviewWindow,
    workspace_id: String,
    generation: u64,
    request_id: String,
    requests: State<'_, super::JavaEntryPointState>,
) -> Result<(), String> {
    if window.label() != "main" { return Err("Main-class discovery requires the main workspace window.".into()); }
    super::java_entry_points::cancel(&requests,workspace_id,generation,request_id)
}
