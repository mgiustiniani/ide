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
    let _: for<'a> fn(
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaLanguageServiceStatus, String> = get_java_language_service_status;
    let _: for<'a> fn(
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaLanguageServiceStatus, String> = start_java_language_service;
    let _: for<'a> fn(
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaLanguageServiceStatus, String> = stop_java_language_service;
    let _: for<'a> fn(
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaLanguageServiceStatus, String> = restart_java_language_service;
    let _: for<'a> fn(
        u64,
        usize,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaLanguageServiceEventBatch, String> = poll_java_language_service_events;

    let _: for<'a> fn(
        JavaLanguageDocument,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<(), String> = open_java_language_document;
    let _: for<'a> fn(
        JavaLanguageDocument,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<(), String> = change_java_language_document;
    let _: for<'a> fn(
        JavaLanguageDocument,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<(), String> = save_java_language_document;
    let _: for<'a> fn(
        JavaLanguageDocument,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<(), String> = close_java_language_document;

    let _: for<'a> fn(
        JavaSemanticRequest,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaSemanticNativeResponse, String> = request_java_completion;
    let _: for<'a> fn(
        JavaSemanticRequest,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaSemanticNativeResponse, String> = request_java_hover;
    let _: for<'a> fn(
        JavaSemanticRequest,
        State<'a, JavaLanguageServiceState>,
    ) -> Result<JavaSemanticNativeResponse, String> = request_java_signature_help;
    let _: for<'a> fn(String, State<'a, JavaLanguageServiceState>) -> Result<(), String> =
        cancel_java_semantic_request;
}

#[test]
fn facade_contains_only_command_delegation() {
    let facade = include_str!("../java_language.rs");
    assert_eq!(
        facade
            .lines()
            .filter(|line| line.trim() == "#[tauri::command]")
            .count(),
        13
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
    assert!(facade.lines().count() < 250);
}
