//! Tauri inbound adapters for Java SDK and dependency source navigation.

use super::{java_dependency_source, JavaProjectContextState};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn lookup_java_platform_source(
    window: tauri::WebviewWindow,
    request: java_dependency_source::Request,
    expected_platform_identity_sha256: String,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("SDK sources require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_dependency_source::prepare_platform_query(
        request,
        &state,
        "lookup",
        expected_platform_identity_sha256,
    )?)
    .await
    .map_err(|_| "SDK source lookup ended safely.".to_string())?
}

#[tauri::command]
pub async fn read_java_platform_source(
    window: tauri::WebviewWindow,
    request: java_dependency_source::Request,
    expected_platform_identity_sha256: String,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("SDK sources require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_dependency_source::prepare_platform_query(
        request,
        &state,
        "read",
        expected_platform_identity_sha256,
    )?)
    .await
    .map_err(|_| "SDK source read ended safely.".to_string())?
}

#[tauri::command]
pub async fn resolve_java_platform_source_declaration(
    window: tauri::WebviewWindow,
    request: java_dependency_source::Request,
    expected_platform_identity_sha256: String,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("SDK sources require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_dependency_source::prepare_platform_query(
        request,
        &state,
        "declaration",
        expected_platform_identity_sha256,
    )?)
    .await
    .map_err(|_| "SDK source declaration lookup ended safely.".to_string())?
}

#[tauri::command]
pub async fn lookup_java_dependency_source(
    window: tauri::WebviewWindow,
    request: java_dependency_source::Request,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Dependency sources require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_dependency_source::prepare_query(
        request, &state, "lookup",
    )?)
    .await
    .map_err(|_| "Dependency source lookup ended safely.".to_string())?
}

#[tauri::command]
pub async fn read_java_dependency_source(
    window: tauri::WebviewWindow,
    request: java_dependency_source::Request,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Dependency sources require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_dependency_source::prepare_query(
        request, &state, "read",
    )?)
    .await
    .map_err(|_| "Dependency source read ended safely.".to_string())?
}

#[tauri::command]
pub async fn resolve_java_dependency_source_declaration(
    window: tauri::WebviewWindow,
    request: java_dependency_source::Request,
    state: State<'_, JavaProjectContextState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Dependency sources require the main workspace window.".into());
    }
    tauri::async_runtime::spawn_blocking(java_dependency_source::prepare_query(
        request,
        &state,
        "declaration",
    )?)
    .await
    .map_err(|_| "Dependency declaration lookup ended safely.".to_string())?
}
