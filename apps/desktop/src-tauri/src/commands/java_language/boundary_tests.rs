use super::*;
use serde_json::{json, Value};

#[test]
fn public_response_contract_remains_camel_case_and_source_free() {
    let response = JavaSemanticNativeResponse {
        provider: "jdtls",
        provider_version: Some("test".to_string()),
        workspace_id: "workspace-test".to_string(),
        generation: 7,
        path: "src/Main.java".to_string(),
        uri: "file:///workspace/src/Main.java".to_string(),
        version: 4,
        request_id: "request-1".to_string(),
        cancelled: false,
        timeout: false,
        error: Some(JavaSemanticNativeError {
            kind: "provider-error".to_string(),
            summary: Some("Java semantic provider returned an error".to_string()),
            provider_code: Some(Value::from(-32603)),
            retryable: false,
        }),
        result: None,
    };

    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({
            "provider":"jdtls",
            "providerVersion":"test",
            "workspaceId":"workspace-test",
            "generation":7,
            "path":"src/Main.java",
            "uri":"file:///workspace/src/Main.java",
            "version":4,
            "requestId":"request-1",
            "cancelled":false,
            "timeout":false,
            "error":{
                "kind":"provider-error",
                "summary":"Java semantic provider returned an error",
                "providerCode":-32603,
                "retryable":false
            },
            "result":null
        })
    );
}

#[test]
fn public_request_contract_remains_camel_case_and_closed() {
    let value = json!({
        "workspaceId":"workspace-test",
        "generation":7,
        "document":{
            "path":"src/Main.java",
            "uri":"file:///workspace/src/Main.java",
            "version":4
        },
        "position":{"line":2,"character":3},
        "requestId":"request-1",
        "cancellationId":"cancel-1",
        "trigger":{"kind":"invoked","character":null}
    });
    let request: JavaSemanticRequest = serde_json::from_value(value).unwrap();
    assert_eq!(request.workspace_id, "workspace-test");
    assert!(serde_json::from_value::<JavaSemanticRequest>(json!({
        "workspaceId":"workspace-test",
        "generation":7,
        "document":{"path":"Main.java","uri":"file:///Main.java","version":1},
        "position":{"line":0,"character":0},
        "requestId":"request-1",
        "cancellationId":"cancel-1",
        "unexpected":true
    }))
    .is_err());
}

#[test]
fn command_signatures_remain_stable() {
    fn status_command<
        F: std::future::Future<Output = Result<JavaLanguageServiceStatus, String>>,
    >(
        _: fn(tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    status_command(get_java_language_service_status::<tauri::Wry>);
    fn lifecycle_command<
        F: std::future::Future<Output = Result<JavaLanguageServiceStatus, String>>,
    >(
        _: fn(tauri::AppHandle<tauri::Wry>, Option<JavaLanguageSessionRequest>) -> F,
    ) {
    }
    lifecycle_command(start_java_language_service::<tauri::Wry>);
    lifecycle_command(stop_java_language_service::<tauri::Wry>);
    lifecycle_command(restart_java_language_service::<tauri::Wry>);
    fn events_command<
        F: std::future::Future<Output = Result<JavaLanguageServiceEventBatch, String>>,
    >(
        _: fn(u64, usize, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    events_command(poll_java_language_service_events::<tauri::Wry>);

    fn document_command<F: std::future::Future<Output = Result<(), String>> + Send>(
        _: fn(JavaLanguageDocument, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    document_command(open_java_language_document::<tauri::Wry>);
    document_command(change_java_language_document::<tauri::Wry>);
    document_command(save_java_language_document::<tauri::Wry>);
    document_command(close_java_language_document::<tauri::Wry>);
    document_command(revalidate_java_language_document::<tauri::Wry>);
    fn workspace_file_command<F: std::future::Future<Output = Result<(), String>> + Send>(
        _: fn(JavaLanguageWorkspaceFile, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    workspace_file_command(notify_java_language_workspace_file_saved::<tauri::Wry>);

    fn semantic_command<
        F: std::future::Future<Output = Result<JavaSemanticNativeResponse, String>> + Send,
    >(
        _: fn(JavaSemanticRequest, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    semantic_command(request_java_completion::<tauri::Wry>);
    semantic_command(request_java_hover::<tauri::Wry>);
    semantic_command(request_java_signature_help::<tauri::Wry>);
    semantic_command(request_java_document_symbols::<tauri::Wry>);
    semantic_command(request_java_document_highlights::<tauri::Wry>);
    semantic_command(request_java_definitions::<tauri::Wry>);
    semantic_command(request_java_type_definitions::<tauri::Wry>);
    semantic_command(request_java_implementations::<tauri::Wry>);
    semantic_command(request_java_references::<tauri::Wry>);
    semantic_command(request_java_semantic_tokens::<tauri::Wry>);
    semantic_command(request_java_inlay_hints::<tauri::Wry>);
    semantic_command(request_java_formatting::<tauri::Wry>);
    semantic_command(request_java_code_actions::<tauri::Wry>);
    semantic_command(request_java_rename::<tauri::Wry>);

    fn workspace_symbols_command<
        F: std::future::Future<Output = Result<JavaWorkspaceSymbolsNativeResponse, String>> + Send,
    >(
        _: fn(JavaWorkspaceSymbolsRequest, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    workspace_symbols_command(request_java_workspace_symbols::<tauri::Wry>);
    fn hierarchy_command<
        F: std::future::Future<Output = Result<JavaSemanticNativeResponse, String>> + Send,
    >(
        _: fn(JavaCallHierarchyRequest, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    hierarchy_command(request_java_call_hierarchy::<tauri::Wry>);
    fn cancellation_command<F: std::future::Future<Output = Result<(), String>> + Send>(
        _: fn(String, tauri::AppHandle<tauri::Wry>) -> F,
    ) {
    }
    cancellation_command(cancel_java_semantic_request::<tauri::Wry>);
}

#[test]
fn facade_contains_only_command_delegation() {
    let facade = include_str!("../java_language.rs");
    assert_eq!(
        facade
            .lines()
            .filter(|line| line.trim() == "#[tauri::command]")
            .count(),
        29
    );
    for forbidden in [
        concat!("std::process::", "Command"),
        concat!("Child", "Stdin"),
        concat!("workspace_", "root()"),
        concat!("serde_json::", "to_vec"),
        concat!("Sha", "256"),
        concat!("read_", "frame("),
    ] {
        assert!(!facade.contains(forbidden), "facade contains {forbidden}");
    }
    assert!(facade.lines().count() < 300);
}
