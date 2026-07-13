//! Thin Tauri inbound facade for the native Java language application service.

mod application;
mod contract;
mod path_policy;
mod protocol;
mod semantic;
mod support;
mod toolchain;

use tauri::State;

pub use application::JavaLanguageServiceState;
pub use contract::{
    JavaCompletionTriggerContext, JavaLanguageCapabilities, JavaLanguageDocument,
    JavaLanguageServiceEvent, JavaLanguageServiceEventBatch, JavaLanguageServiceStatus,
    JavaSemanticDocumentTarget, JavaSemanticNativeError, JavaSemanticNativeResponse,
    JavaSemanticPosition, JavaSemanticRequest,
};

#[tauri::command]
pub fn get_java_language_service_status(
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaLanguageServiceStatus, String> {
    state.service_status()
}

#[tauri::command]
pub fn start_java_language_service(
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaLanguageServiceStatus, String> {
    state.start()
}

#[tauri::command]
pub fn stop_java_language_service(
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaLanguageServiceStatus, String> {
    state.stop()
}

#[tauri::command]
pub fn restart_java_language_service(
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaLanguageServiceStatus, String> {
    state.restart()
}

#[tauri::command]
pub fn poll_java_language_service_events(
    after_sequence: u64,
    limit: usize,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaLanguageServiceEventBatch, String> {
    state.poll_events(after_sequence, limit)
}

#[tauri::command]
pub fn open_java_language_document(
    document: JavaLanguageDocument,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<(), String> {
    state.open_document(document)
}

#[tauri::command]
pub fn change_java_language_document(
    document: JavaLanguageDocument,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<(), String> {
    state.change_document(document)
}

#[tauri::command]
pub fn save_java_language_document(
    document: JavaLanguageDocument,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<(), String> {
    state.save_document(document)
}

#[tauri::command]
pub fn close_java_language_document(
    document: JavaLanguageDocument,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<(), String> {
    state.close_document(document)
}

#[tauri::command]
pub fn request_java_completion(
    request: JavaSemanticRequest,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaSemanticNativeResponse, String> {
    state.request_completion(request)
}

#[tauri::command]
pub fn request_java_hover(
    request: JavaSemanticRequest,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaSemanticNativeResponse, String> {
    state.request_hover(request)
}

#[tauri::command]
pub fn request_java_signature_help(
    request: JavaSemanticRequest,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<JavaSemanticNativeResponse, String> {
    state.request_signature_help(request)
}

#[tauri::command]
pub fn cancel_java_semantic_request(
    cancellation_id: String,
    state: State<'_, JavaLanguageServiceState>,
) -> Result<(), String> {
    state.cancel_semantic_request(cancellation_id)
}

#[cfg(test)]
mod boundary_tests;
