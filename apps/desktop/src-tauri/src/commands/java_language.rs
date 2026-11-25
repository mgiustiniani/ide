//! Thin Tauri inbound facade for the native Java language application service.

mod application;
mod bundle_runtime;
mod compiler_support;
mod contract;
mod path_policy;
mod protocol;
mod semantic;
mod support;
mod toolchain;

use tauri::Manager;

pub use application::JavaLanguageServiceState;
pub use contract::{
    JavaCallHierarchyRequest, JavaCodeActionDiagnostic, JavaCompletionTriggerContext,
    JavaFormattingOptions, JavaLanguageCapabilities, JavaLanguageDocument,
    JavaLanguageFormatterProfile, JavaLanguageGradleSettings, JavaLanguageServiceEvent,
    JavaLanguageServiceEventBatch, JavaLanguageServiceStatus, JavaLanguageSessionRequest,
    JavaLanguageWorkspaceFile, JavaSemanticDocumentTarget, JavaSemanticNativeError,
    JavaSemanticNativeResponse, JavaSemanticPosition, JavaSemanticRange, JavaSemanticRequest,
    JavaWorkspaceSymbolsNativeResponse, JavaWorkspaceSymbolsRequest,
};
pub(super) use toolchain::formatter_profile_payload;

impl JavaLanguageServiceState {
    pub(super) fn clear_project_compiler_settings(
        &self,
        workspace_id: &str,
        generation: u64,
    ) -> Result<(), String> {
        application::JavaLanguageServiceState::clear_project_compiler_settings_inner(
            self,
            workspace_id,
            generation,
        )
    }
}
#[tauri::command]
pub async fn list_java_formatter_profiles<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    workspace_id: String,
    path: String,
) -> Result<Vec<String>, String> {
    super::blocking::run(move || application::list_formatter_profiles(window.label(), &workspace_id, &path)).await
}

#[tauri::command]
pub async fn get_java_language_service_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<JavaLanguageServiceStatus, String> {
    super::blocking::run(move || app.state::<JavaLanguageServiceState>().service_status()).await
}

#[tauri::command]
pub async fn start_java_language_service<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: Option<JavaLanguageSessionRequest>,
) -> Result<JavaLanguageServiceStatus, String> {
    super::blocking::run(move || {
        let sources = app.state::<super::refactorkit_daemon::JavaProjectContextState>()
            .gradle_generated_sources(request.as_ref());
        app.state::<JavaLanguageServiceState>().start_with_generated_sources(request, &sources)
    }).await
}

#[tauri::command]
pub async fn stop_java_language_service<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: Option<JavaLanguageSessionRequest>,
) -> Result<JavaLanguageServiceStatus, String> {
    super::blocking::run(move || app.state::<JavaLanguageServiceState>().stop(request)).await
}

#[tauri::command]
pub async fn restart_java_language_service<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: Option<JavaLanguageSessionRequest>,
) -> Result<JavaLanguageServiceStatus, String> {
    super::blocking::run(move || {
        let sources = app.state::<super::refactorkit_daemon::JavaProjectContextState>()
            .gradle_generated_sources(request.as_ref());
        app.state::<JavaLanguageServiceState>().restart_with_generated_sources(request, &sources)
    }).await
}

#[tauri::command]
pub async fn poll_java_language_service_events<R: tauri::Runtime>(
    after_sequence: u64,
    limit: usize,
    app: tauri::AppHandle<R>,
) -> Result<JavaLanguageServiceEventBatch, String> {
    super::blocking::run(move || {
        app.state::<JavaLanguageServiceState>()
            .poll_events(after_sequence, limit)
    })
    .await
}

async fn with_service<R: tauri::Runtime, T: Send + 'static>(
    app: tauri::AppHandle<R>,
    work: impl FnOnce(&JavaLanguageServiceState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    super::blocking::run(move || work(&app.state::<JavaLanguageServiceState>())).await
}

#[tauri::command]
pub async fn open_java_language_document<R: tauri::Runtime>(
    document: JavaLanguageDocument,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| state.open_document(document)).await
}

#[tauri::command]
pub async fn change_java_language_document<R: tauri::Runtime>(
    document: JavaLanguageDocument,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| state.change_document(document)).await
}

#[tauri::command]
pub async fn save_java_language_document<R: tauri::Runtime>(
    document: JavaLanguageDocument,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| state.save_document(document)).await
}

#[tauri::command]
pub async fn close_java_language_document<R: tauri::Runtime>(
    document: JavaLanguageDocument,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| state.close_document(document)).await
}

#[tauri::command]
pub async fn revalidate_java_language_document<R: tauri::Runtime>(
    document: JavaLanguageDocument,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| state.revalidate_document(document)).await
}

#[tauri::command]
pub async fn notify_java_language_workspace_file_saved<R: tauri::Runtime>(
    document: JavaLanguageWorkspaceFile,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| {
        state.notify_workspace_file_saved(document)
    })
    .await
}

#[tauri::command]
pub async fn request_java_completion<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_completion(request)).await
}

#[tauri::command]
pub async fn request_java_hover<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_hover(request)).await
}

#[tauri::command]
pub async fn request_java_signature_help<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_signature_help(request)).await
}

#[tauri::command]
pub async fn request_java_document_symbols<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_document_symbols(request)).await
}

#[tauri::command]
pub async fn request_java_workspace_symbols<R: tauri::Runtime>(
    request: JavaWorkspaceSymbolsRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaWorkspaceSymbolsNativeResponse, String> {
    with_service(app, move |state| state.request_workspace_symbols(request)).await
}

#[tauri::command]
pub async fn request_java_document_highlights<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_document_highlights(request)).await
}

#[tauri::command]
pub async fn request_java_implementations<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_implementations(request)).await
}

#[tauri::command]
pub async fn request_java_definitions<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_definitions(request)).await
}

#[tauri::command]
pub async fn request_java_type_definitions<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_type_definitions(request)).await
}

#[tauri::command]
pub async fn request_java_call_hierarchy<R: tauri::Runtime>(
    request: JavaCallHierarchyRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_call_hierarchy(request)).await
}

#[tauri::command]
pub async fn request_java_references<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_references(request)).await
}

#[tauri::command]
pub async fn request_java_semantic_tokens<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_semantic_tokens(request)).await
}

#[tauri::command]
pub async fn request_java_inlay_hints<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_inlay_hints(request)).await
}

#[tauri::command]
pub async fn request_java_formatting<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_formatting(request)).await
}

#[tauri::command]
pub async fn request_java_code_actions<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_code_actions(request)).await
}

#[tauri::command]
pub async fn request_java_rename<R: tauri::Runtime>(
    request: JavaSemanticRequest,
    app: tauri::AppHandle<R>,
) -> Result<JavaSemanticNativeResponse, String> {
    with_service(app, move |state| state.request_rename(request)).await
}

#[tauri::command]
pub async fn cancel_java_semantic_request<R: tauri::Runtime>(
    cancellation_id: String,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    with_service(app, move |state| {
        state.cancel_semantic_request(cancellation_id)
    })
    .await
}

#[cfg(test)]
mod boundary_tests;
