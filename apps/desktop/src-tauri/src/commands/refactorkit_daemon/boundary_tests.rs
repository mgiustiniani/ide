//! Cross-module behavior, protocol, lifecycle, and facade boundary tests.

use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::State;

use crate::commands::workspace_registry::workspace_id_for_path;

use super::application::*;
use super::capability_policy::*;
use super::contract::*;
use super::path_policy::*;
use super::saved_snapshot_semantic::*;
use super::transport::*;

use std::fs;
use std::sync::{Mutex as TestMutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_workspace(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = env::temp_dir().join(format!("ide-rk-{label}-{unique}"));
    fs::create_dir_all(root.join("src/main/java/example")).unwrap();
    root.canonicalize().unwrap()
}

fn preview_request() -> PreviewRequest {
    PreviewRequest {
        code: "package incoming; public class Widget {}".into(),
        target_directory: "src/main/java/example".into(),
        source_kind: "clipboard".into(),
        source_url: None,
        license_policy: "warn".into(),
        workspace_id: "ws-test".into(),
        workspace_generation: 7,
        selection_generation: 9,
        request_id: "request-1".into(),
    }
}

fn rich_plan(status: &str) -> Value {
    json!({
        "planId": "plan-1",
        "status": status,
        "summary": "Create Widget.java",
        "confidence": 0.91,
        "riskLevel": "medium",
        "evidence": [
            "source-root",
            {"kind": "package", "summary": "Package rewritten", "detail": "incoming -> example"}
        ],
        "affectedFiles": [{
            "change": "create", "path": "src/main/java/example/Widget.java",
            "previousPath": null, "primary": true
        }],
        "placement": {"packageName": "example", "sourceRoot": "src/main/java", "moduleName": null},
        "packageChanges": [
            {"fromPackage": null, "toPackage": "example"},
            {"from": "incoming", "to": "example", "path": "src/main/java/example/Widget.java"}
        ],
        "renderedDiff": "--- /dev/null\n+++ b/src/main/java/example/Widget.java\n@@ -0,0 +1 @@\n+package example;",
        "structuredDiff": [{
            "path": "src/main/java/example/Widget.java", "change": "create",
            "hunks": [{"oldStart": 0, "oldLines": 0, "newStart": 1, "newLines": 1,
                "lines": ["+package example;"]}]
        }],
        "warnings": ["Review license"],
        "diagnosticsAfterPreview": [{
            "severity": "warning", "message": "Example diagnostic", "path": "pom.xml",
            "line": 1, "column": 2, "code": "RK001"
        }],
        "provenance": {"sourceKind": "clipboard", "sourceUrl": null,
            "detectedLicense": "Apache-2.0", "licensePolicy": "warn", "notices": ["Retain notice"]},
        "unresolvedDependencies": ["org.example:missing:1"],
        "conflicts": [{"kind": "existing-file", "summary": "Existing type", "path": "pom.xml"}],
        "refusalReasons": if status == "preview" { json!([]) } else { json!(["not ready"]) },
        "applyEligibility": {"eligible": status == "preview", "blockers": if status == "preview" { json!([]) } else { json!(["blocked"]) }},
        "staleness": {"stale": status == "stale", "reasons": if status == "stale" { json!(["changed"]) } else { json!([]) }},
        "provider": {"name": "refactorkit", "version": "0.5.0-SNAPSHOT"}
    })
}

fn complete_capabilities() -> Value {
    json!({
        "version": "0.5.0-SNAPSHOT", "apiVersion": "0.2",
        "protocol": "json-rpc-2.0", "transport": "stdio",
        "methods": [
            {"name": "refactor.apply"}, {"name": "refactor.discard"},
            {"name": "patch.rollback"},
            {"name": "java.importExternalClass", "stability": "experimental", "features": {
                "targetDirectory": true, "preview": true, "apply": true,
                "discard": true, "rollback": true
            }}
        ]
    })
}

fn diagnostics_v2_features() -> Value {
    json!({
        "requestCorrelation": true,
        "semanticLease": true,
        "savedDiskAuthority": true,
        "immutableEditorOverlay": true,
        "exactUtf16Ranges": true,
        "structuredReadiness": true,
        "compilerAttestation": true,
        "boundedResponse": true
    })
}

fn capabilities_with_diagnostics_v2() -> Value {
    let mut capabilities = complete_capabilities();
    capabilities["version"] = json!("0.7.0-SNAPSHOT");
    capabilities["methods"] = json!([
        {"name": "refactor.apply", "stability": "beta-contract", "requiresProject": true, "writesWorkspace": true},
        {"name": "refactor.discard", "stability": "beta-contract", "requiresProject": false, "writesWorkspace": false},
        {"name": "patch.rollback", "stability": "beta-contract", "requiresProject": true, "writesWorkspace": true},
        {"name": "java.importExternalClass", "stability": "experimental", "requiresProject": true, "writesWorkspace": false,
            "features": {"targetDirectory": true, "preview": true, "apply": true, "discard": true, "rollback": true}},
        {"name": "diagnostics.v2", "stability": "additive-api-0.2", "requiresProject": true, "writesWorkspace": false,
            "features": diagnostics_v2_features()}
    ]);
    capabilities["languageKernel"] = diagnostics_v2_language_kernel();
    capabilities
}

fn diagnostics_v2_language_kernel() -> Value {
    let runtime = json!({
        "executionMode": "external-process",
        "supportsTimeout": true,
        "supportsCancellation": true,
        "usesWorkspaceOverlay": true,
        "recordsProcessProvenance": true,
        "limits": {
            "requestTimeoutMillis": 30_000,
            "maxInputBytes": 512 * 1024 * 1024,
            "maxOutputBytes": 8 * 1024 * 1024,
            "maxProcesses": 1
        }
    });
    json!({
        "schemaVersion": 1,
        "adapters": [{
            "languageId": "typescript",
            "extensions": ["ts", "tsx"],
            "backend": "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1",
            "runtime": runtime,
            "capabilities": [{
                "operation": "diagnostics",
                "stability": "experimental",
                "evidence": "compiler",
                "mutationAuthority": "none",
                "backend": "typescript-compiler-exact-v1",
                "runtime": runtime,
                "extensions": ["ts", "tsx"],
                "diagnosticSnapshotModes": ["immutable-editor-overlay", "saved-disk"],
                "diagnosticRangeCapability": "exact-utf16-or-explicit-partial"
            }]
        }],
        "vocabulary": {
            "stability": ["stable", "experimental", "structural", "refused", "not-applicable"],
            "evidence": ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
            "mutationAuthority": ["managed-stable", "proposal-only", "none"],
            "executionMode": ["in-process", "external-process"],
            "diagnosticSnapshotMode": ["saved-disk", "immutable-editor-overlay"],
            "diagnosticRangeCapability": ["exact-utf16-or-explicit-partial"]
        }
    })
}

fn materialize_operation_defaults(mut schema: Value) -> Value {
    for adapter in schema["adapters"].as_array_mut().unwrap() {
        let backend = adapter["backend"].clone();
        let runtime = adapter["runtime"].clone();
        let extensions = adapter["extensions"].clone();
        for capability in adapter["capabilities"].as_array_mut().unwrap() {
            capability["backend"] = backend.clone();
            capability["runtime"] = runtime.clone();
            capability["extensions"] = extensions.clone();
        }
    }
    schema
}

fn actual_language_kernel() -> Value {
    let in_process = |supports_timeout: bool, request_timeout: Value, max_input: Value| {
        json!({
            "executionMode": "in-process",
            "supportsTimeout": supports_timeout,
            "supportsCancellation": false,
            "usesWorkspaceOverlay": false,
            "recordsProcessProvenance": false,
            "limits": {
                "requestTimeoutMillis": request_timeout,
                "maxInputBytes": max_input,
                "maxOutputBytes": null,
                "maxProcesses": null
            }
        })
    };
    let tree_sitter = |language_id: &str, extension: &str| {
        json!({
            "languageId": language_id,
            "extensions": [extension],
            "backend": "tree-sitter-jni-0.25.3",
            "runtime": in_process(true, json!(2_000), json!(16 * 1024 * 1024)),
            "capabilities": [
                {"operation": "identifierSearch", "stability": "stable", "evidence": "native-ast", "mutationAuthority": "none"},
                {"operation": "localRename", "stability": "structural", "evidence": "lexical", "mutationAuthority": "proposal-only"},
                {"operation": "outline", "stability": "stable", "evidence": "native-ast", "mutationAuthority": "none"}
            ]
        })
    };
    materialize_operation_defaults(json!({
        "schemaVersion": 1,
        "adapters": [
            {
                "languageId": "java",
                "extensions": ["java"],
                "backend": "eclipse-jdt-3.44",
                "runtime": in_process(false, Value::Null, Value::Null),
                "capabilities": [
                    {"operation": "changeSignature.addParameter", "stability": "experimental", "evidence": "compiler", "mutationAuthority": "proposal-only"},
                    {"operation": "changeSignature.removeParameter", "stability": "experimental", "evidence": "compiler", "mutationAuthority": "proposal-only"},
                    {"operation": "changeSignature.renameParameter", "stability": "experimental", "evidence": "compiler", "mutationAuthority": "proposal-only"},
                    {"operation": "changeSignature.reorderParameters", "stability": "experimental", "evidence": "compiler", "mutationAuthority": "proposal-only"},
                    {"operation": "extractMethod", "stability": "experimental", "evidence": "compiler", "mutationAuthority": "proposal-only"},
                    {"operation": "formatFile", "stability": "stable", "evidence": "structural-parse", "mutationAuthority": "managed-stable"},
                    {"operation": "moveClass", "stability": "stable", "evidence": "compiler", "mutationAuthority": "managed-stable"},
                    {"operation": "moveSourceRoot", "stability": "stable", "evidence": "structural-parse", "mutationAuthority": "managed-stable"},
                    {"operation": "organizeImports", "stability": "stable", "evidence": "structural-parse", "mutationAuthority": "managed-stable"},
                    {"operation": "renameClass", "stability": "stable", "evidence": "compiler", "mutationAuthority": "managed-stable"},
                    {"operation": "renameMember", "stability": "stable", "evidence": "compiler", "mutationAuthority": "managed-stable"},
                    {"operation": "safeDelete", "stability": "stable", "evidence": "compiler", "mutationAuthority": "managed-stable"}
                ]
            },
            tree_sitter("javascript", "js"),
            tree_sitter("typescript", "ts")
        ],
        "vocabulary": {
            "stability": ["stable", "experimental", "structural", "refused", "not-applicable"],
            "evidence": ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
            "mutationAuthority": ["managed-stable", "proposal-only", "none"],
            "executionMode": ["in-process", "external-process"]
        }
    }))
}

fn actual_capabilities() -> Value {
    let mut capabilities = complete_capabilities();
    capabilities["languageKernel"] = actual_language_kernel();
    capabilities["safety"] = json!({
        "previewBeforeApply": true,
        "snapshotValidation": true,
        "transactionRollback": true,
        "workspaceScopedWrites": true
    });
    capabilities
}

#[test]
fn capability_mapping_is_exact_for_available_and_unavailable_installations() {
    assert_eq!(
        validate_capabilities(&complete_capabilities()).unwrap(),
        "0.5.0-SNAPSHOT"
    );
    let available =
        serde_json::to_value(available_capabilities(Some("0.5.0-SNAPSHOT".into()))).unwrap();
    assert_eq!(
        available.pointer("/javaImportExternalClass/supported"),
        Some(&Value::Bool(true))
    );
    for flag in ["targetDirectory", "preview", "apply", "rollback"] {
        assert_eq!(
            available.pointer(&format!("/javaImportExternalClass/{flag}")),
            Some(&Value::Bool(true))
        );
    }
    let unavailable = serde_json::to_value(unavailable_capabilities()).unwrap();
    for flag in [
        "supported",
        "targetDirectory",
        "preview",
        "apply",
        "rollback",
    ] {
        assert_eq!(
            unavailable.pointer(&format!("/javaImportExternalClass/{flag}")),
            Some(&Value::Bool(false))
        );
    }
    assert!(unavailable
        .pointer("/javaImportExternalClass/updateGuidance")
        .is_some());
}

#[test]
fn modern_method_capabilities_are_strictly_retained_while_legacy_methods_stay_absent() {
    let advertised = capabilities_with_diagnostics_v2();
    let normalized = serde_json::to_value(available_managed_capabilities(
        normalize_server_capabilities(&advertised).unwrap(),
    ))
    .unwrap();
    assert_eq!(normalized.get("methods"), advertised.get("methods"));
    assert_eq!(
        normalized
            .pointer("/languageKernel/schema/adapters/0/capabilities/0/diagnosticSnapshotModes"),
        Some(&json!(["immutable-editor-overlay", "saved-disk"]))
    );
    assert_eq!(
        normalized
            .pointer("/languageKernel/schema/adapters/0/capabilities/0/diagnosticRangeCapability"),
        Some(&json!("exact-utf16-or-explicit-partial"))
    );
    assert_eq!(
        normalized.pointer("/languageKernel/schema/vocabulary/diagnosticSnapshotMode"),
        Some(&json!(["saved-disk", "immutable-editor-overlay"]))
    );
    assert_eq!(
        normalized.pointer("/languageKernel/schema/vocabulary/diagnosticRangeCapability"),
        Some(&json!(["exact-utf16-or-explicit-partial"]))
    );

    let legacy = serde_json::to_value(available_managed_capabilities(
        normalize_server_capabilities(&complete_capabilities()).unwrap(),
    ))
    .unwrap();
    assert!(legacy.get("methods").is_none());
    assert!(serde_json::to_value(unavailable_capabilities())
        .unwrap()
        .get("methods")
        .is_none());
}

#[test]
fn diagnostics_authorization_rechecks_retained_saved_disk_and_read_only_metadata() {
    let mut metadata = normalize_server_capabilities(&capabilities_with_diagnostics_v2()).unwrap();
    assert!(diagnostics_v2_is_authorized(&metadata));

    {
        let diagnostics = metadata
            .methods
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|method| method.name == "diagnostics.v2")
            .unwrap();
        diagnostics
            .features
            .as_mut()
            .unwrap()
            .insert("savedDiskAuthority".into(), false);
    }
    assert!(!diagnostics_v2_is_authorized(&metadata));

    {
        let diagnostics = metadata
            .methods
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|method| method.name == "diagnostics.v2")
            .unwrap();
        diagnostics
            .features
            .as_mut()
            .unwrap()
            .insert("savedDiskAuthority".into(), true);
        diagnostics.writes_workspace = true;
    }
    assert!(!diagnostics_v2_is_authorized(&metadata));

    let mut metadata = normalize_server_capabilities(&capabilities_with_diagnostics_v2()).unwrap();
    metadata.language_kernel.schema.as_mut().unwrap().adapters[0].capabilities[0]
        .diagnostic_snapshot_modes = Some(vec!["saved-disk".into()]);
    assert!(!diagnostics_v2_is_authorized(&metadata));

    let mut metadata = normalize_server_capabilities(&capabilities_with_diagnostics_v2()).unwrap();
    metadata.language_kernel.schema = None;
    assert!(!diagnostics_v2_is_authorized(&metadata));

    let mut metadata = normalize_server_capabilities(&capabilities_with_diagnostics_v2()).unwrap();
    metadata.language_kernel.available = false;
    assert!(!diagnostics_v2_is_authorized(&metadata));
}

#[test]
fn malformed_or_unsafe_diagnostics_v2_method_metadata_fails_closed() {
    let mut cases = Vec::new();

    let mut duplicate = capabilities_with_diagnostics_v2();
    let duplicate_method = duplicate["methods"][4].clone();
    duplicate["methods"]
        .as_array_mut()
        .unwrap()
        .push(duplicate_method);
    cases.push(("duplicate method", duplicate));

    let mut extra_method_field = capabilities_with_diagnostics_v2();
    extra_method_field["methods"][4]["fallbackOutput"] = json!(false);
    cases.push(("extra method field", extra_method_field));

    for (name, pointer, replacement) in [
        (
            "wrong stability",
            "/methods/4/stability",
            json!("experimental"),
        ),
        (
            "project not required",
            "/methods/4/requiresProject",
            json!(false),
        ),
        ("workspace write", "/methods/4/writesWorkspace", json!(true)),
        (
            "false feature",
            "/methods/4/features/structuredReadiness",
            json!(false),
        ),
        (
            "malformed feature",
            "/methods/4/features/compilerAttestation",
            json!("true"),
        ),
    ] {
        let mut value = capabilities_with_diagnostics_v2();
        *value.pointer_mut(pointer).unwrap() = replacement;
        cases.push((name, value));
    }

    let mut missing_feature = capabilities_with_diagnostics_v2();
    missing_feature["methods"][4]["features"]
        .as_object_mut()
        .unwrap()
        .remove("savedDiskAuthority");
    cases.push(("missing saved-disk authority", missing_feature));

    let mut extra_feature = capabilities_with_diagnostics_v2();
    extra_feature["methods"][4]["features"]["fallbackOutput"] = json!(true);
    cases.push(("extra feature", extra_feature));

    for (name, candidate) in cases {
        assert!(
            normalize_server_capabilities(&candidate).is_err(),
            "unsafe diagnostics.v2 metadata was accepted: {name}"
        );
    }
}

#[test]
fn malformed_or_contradictory_diagnostics_language_metadata_fails_closed() {
    let mut cases = Vec::new();
    let operation = "/languageKernel/adapters/0/capabilities/0";

    for (name, pointer, replacement) in [
        (
            "snapshot mode order",
            format!("{operation}/diagnosticSnapshotModes"),
            json!(["saved-disk", "immutable-editor-overlay"]),
        ),
        (
            "duplicate snapshot mode",
            format!("{operation}/diagnosticSnapshotModes"),
            json!(["immutable-editor-overlay", "immutable-editor-overlay"]),
        ),
        (
            "unsupported snapshot mode",
            format!("{operation}/diagnosticSnapshotModes"),
            json!(["immutable-editor-overlay", "live-workspace"]),
        ),
        (
            "wrong range capability",
            format!("{operation}/diagnosticRangeCapability"),
            json!("approximate-codepoints"),
        ),
        (
            "snapshot vocabulary order",
            "/languageKernel/vocabulary/diagnosticSnapshotMode".into(),
            json!(["immutable-editor-overlay", "saved-disk"]),
        ),
        (
            "duplicate range vocabulary",
            "/languageKernel/vocabulary/diagnosticRangeCapability".into(),
            json!([
                "exact-utf16-or-explicit-partial",
                "exact-utf16-or-explicit-partial"
            ]),
        ),
    ] {
        let mut value = capabilities_with_diagnostics_v2();
        *value.pointer_mut(&pointer).unwrap() = replacement;
        cases.push((name, value));
    }

    for (name, pointer) in [
        (
            "missing snapshot modes",
            format!("{operation}/diagnosticSnapshotModes"),
        ),
        (
            "missing range capability",
            format!("{operation}/diagnosticRangeCapability"),
        ),
        (
            "missing snapshot vocabulary",
            "/languageKernel/vocabulary/diagnosticSnapshotMode".into(),
        ),
        (
            "missing range vocabulary",
            "/languageKernel/vocabulary/diagnosticRangeCapability".into(),
        ),
    ] {
        let mut value = capabilities_with_diagnostics_v2();
        let (parent, field) = pointer.rsplit_once('/').unwrap();
        value
            .pointer_mut(parent)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(field);
        cases.push((name, value));
    }

    let mut extra = capabilities_with_diagnostics_v2();
    extra.pointer_mut(operation).unwrap()["diagnosticFallbackMode"] = json!("saved-disk");
    cases.push(("extra diagnostic operation field", extra));

    let mut extra = capabilities_with_diagnostics_v2();
    extra["languageKernel"]["vocabulary"]["diagnosticFallbackMode"] = json!(["saved-disk"]);
    cases.push(("extra diagnostic vocabulary field", extra));

    let mut missing_kernel = capabilities_with_diagnostics_v2();
    missing_kernel
        .as_object_mut()
        .unwrap()
        .remove("languageKernel");
    cases.push(("missing diagnostics language kernel", missing_kernel));

    for (name, value) in cases {
        assert!(
            matches!(normalize_server_capabilities(&value), Err(ref error) if error == PROTOCOL_FAILED),
            "malformed diagnostics language metadata was accepted: {name}"
        );
    }
}

#[test]
fn provider_version_is_diagnostic_and_cannot_authorize_capabilities() {
    let decisions: Vec<Value> = ["0.5.0-SNAPSHOT", "0.6.0-SNAPSHOT"]
        .into_iter()
        .map(|provider_version| {
            let mut advertised = actual_capabilities();
            advertised["version"] = json!(provider_version);
            let normalized = serde_json::to_value(available_managed_capabilities(
                normalize_server_capabilities(&advertised).unwrap(),
            ))
            .unwrap();
            assert_eq!(normalized["providerVersion"], provider_version);

            let mut incompatible = advertised;
            incompatible["methods"][3]["features"]["rollback"] = json!(false);
            assert_eq!(
                normalize_server_capabilities(&incompatible)
                    .err()
                    .as_deref(),
                Some(UNAVAILABLE),
                "provider version {provider_version} must not authorize an incomplete contract"
            );

            json!({
                "api": normalized["api"],
                "apiVersion": normalized["apiVersion"],
                "provider": normalized["provider"],
                "javaImportExternalClass": normalized["javaImportExternalClass"],
                "languageKernel": normalized["languageKernel"],
                "safety": normalized["safety"]
            })
        })
        .collect();

    assert_eq!(
        decisions[0], decisions[1],
        "provider version must not change API, capability, or safety decisions"
    );
}

#[test]
fn actual_schema_v1_language_metadata_and_exact_safety_flags_are_normalized() {
    let metadata = normalize_server_capabilities(&actual_capabilities()).unwrap();
    let normalized = serde_json::to_value(available_managed_capabilities(metadata)).unwrap();

    assert_eq!(
        normalized.pointer("/languageKernel/available"),
        Some(&json!(true))
    );
    assert_eq!(
        normalized.pointer("/languageKernel/schema"),
        Some(&actual_language_kernel())
    );
    let safety_keys: HashSet<&str> = normalized["safety"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        safety_keys,
        [
            "previewBeforeApply",
            "snapshotValidation",
            "transactionRollback",
            "workspaceScopedWrites"
        ]
        .into_iter()
        .collect()
    );
    for flag in [
        "previewBeforeApply",
        "snapshotValidation",
        "transactionRollback",
        "workspaceScopedWrites",
    ] {
        assert_eq!(
            normalized.pointer(&format!("/safety/{flag}")),
            Some(&json!(true))
        );
    }
}

#[test]
fn provider_neutral_schema_is_the_only_adapter_source_and_retains_advertised_false_safety() {
    let mut capabilities = complete_capabilities();
    capabilities["languageKernel"] = materialize_operation_defaults(json!({
        "schemaVersion": 1,
        "adapters": [{
            "languageId": "kotlin",
            "extensions": ["kts", "kt"],
            "backend": "custom-language-kernel-v7",
            "runtime": {
                "executionMode": "external-process",
                "supportsTimeout": true,
                "supportsCancellation": true,
                "usesWorkspaceOverlay": true,
                "recordsProcessProvenance": true,
                "limits": {
                    "requestTimeoutMillis": 7_500,
                    "maxInputBytes": 4_096,
                    "maxOutputBytes": 8_192,
                    "maxProcesses": 2
                }
            },
            "capabilities": [
                {"operation": "renameModule", "stability": "experimental", "evidence": "language-server", "mutationAuthority": "proposal-only"},
                {"operation": "inspectModule", "stability": "refused", "evidence": "none", "mutationAuthority": "none"}
            ],
            "toolchainReadiness": "ready",
            "workspaceReadiness": "ready",
            "sessionReadiness": "ready"
        }],
        "vocabulary": {
            "stability": ["stable", "experimental", "structural", "refused", "not-applicable"],
            "evidence": ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
            "mutationAuthority": ["managed-stable", "proposal-only", "none"],
            "executionMode": ["in-process", "external-process"]
        }
    }));
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["backend"] =
        json!("kotlin-analysis-server-v2");
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["runtime"] = json!({
        "executionMode": "in-process", "supportsTimeout": false,
        "supportsCancellation": false, "usesWorkspaceOverlay": false,
        "recordsProcessProvenance": false,
        "limits": {"requestTimeoutMillis": null, "maxInputBytes": 2_048,
            "maxOutputBytes": null, "maxProcesses": null}
    });
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["extensions"] = json!(["kt"]);
    capabilities["safety"] = json!({
        "previewBeforeApply": false,
        "snapshotValidation": true,
        "transactionRollback": false,
        "workspaceScopedWrites": true
    });
    capabilities["previewSource"] = json!("private-preview-source-sentinel");
    capabilities["diagnostics"] = json!(["private-diagnostic-sentinel"]);
    capabilities["responsePayload"] = json!({"id": "private-response-id-sentinel"});
    capabilities["nativeErrorDetail"] = json!("private-native-detail-sentinel");

    let metadata = normalize_server_capabilities(&capabilities).unwrap();
    let normalized = serde_json::to_value(available_managed_capabilities(metadata)).unwrap();
    assert_eq!(
        normalized.pointer("/languageKernel/schema/adapters"),
        Some(&json!([{
            "languageId": "kotlin",
            "extensions": ["kt", "kts"],
            "backend": "custom-language-kernel-v7",
            "runtime": {
                "executionMode": "external-process",
                "supportsTimeout": true,
                "supportsCancellation": true,
                "usesWorkspaceOverlay": true,
                "recordsProcessProvenance": true,
                "limits": {
                    "requestTimeoutMillis": 7_500,
                    "maxInputBytes": 4_096,
                    "maxOutputBytes": 8_192,
                    "maxProcesses": 2
                }
            },
            "capabilities": [
                {"operation": "inspectModule", "stability": "refused", "evidence": "none", "mutationAuthority": "none",
                    "backend": "custom-language-kernel-v7",
                    "runtime": {
                        "executionMode": "external-process", "supportsTimeout": true,
                        "supportsCancellation": true, "usesWorkspaceOverlay": true,
                        "recordsProcessProvenance": true,
                        "limits": {"requestTimeoutMillis": 7_500, "maxInputBytes": 4_096,
                            "maxOutputBytes": 8_192, "maxProcesses": 2}
                    },
                    "extensions": ["kt", "kts"]},
                {"operation": "renameModule", "stability": "experimental", "evidence": "language-server", "mutationAuthority": "proposal-only",
                    "backend": "kotlin-analysis-server-v2",
                    "runtime": {
                        "executionMode": "in-process", "supportsTimeout": false,
                        "supportsCancellation": false, "usesWorkspaceOverlay": false,
                        "recordsProcessProvenance": false,
                        "limits": {"requestTimeoutMillis": null, "maxInputBytes": 2_048,
                            "maxOutputBytes": null, "maxProcesses": null}
                    },
                    "extensions": ["kt"]}
            ]
        }]))
    );
    assert_eq!(
        normalized.get("safety"),
        Some(&json!({
            "previewBeforeApply": false,
            "snapshotValidation": true,
            "transactionRollback": false,
            "workspaceScopedWrites": true
        }))
    );
    let serialized = normalized.to_string();
    for forbidden in [
        "toolchainReadiness",
        "workspaceReadiness",
        "sessionReadiness",
        "private-preview-source-sentinel",
        "private-diagnostic-sentinel",
        "private-response-id-sentinel",
        "private-native-detail-sentinel",
    ] {
        assert!(!serialized.contains(forbidden));
    }

    capabilities["languageKernel"]["schemaVersion"] = json!(2);
    assert!(matches!(
        normalize_server_capabilities(&capabilities),
        Err(ref error) if error == PROTOCOL_FAILED
    ));
}

#[test]
fn legacy_capabilities_report_language_metadata_unavailable_without_inventing_safety() {
    let metadata = normalize_server_capabilities(&complete_capabilities()).unwrap();
    let normalized = serde_json::to_value(available_managed_capabilities(metadata)).unwrap();
    assert_eq!(
        normalized.pointer("/languageKernel/available"),
        Some(&json!(false))
    );
    assert_eq!(
        normalized.pointer("/languageKernel/schema"),
        Some(&Value::Null)
    );
    assert_eq!(
        normalized.pointer("/languageKernel/reason"),
        Some(&json!(LANGUAGE_KERNEL_UNAVAILABLE))
    );
    assert!(normalized.get("safety").is_none());
}

#[test]
fn malformed_language_metadata_fails_closed_for_bounds_identity_vocabulary_and_semantics() {
    let mut cases: Vec<(&str, Value)> = Vec::new();

    let mut value = actual_capabilities();
    value["languageKernel"]["schemaVersion"] = json!(2);
    cases.push(("schema version", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["vocabulary"]["stability"] = json!([
        "experimental",
        "stable",
        "structural",
        "refused",
        "not-applicable"
    ]);
    cases.push(("vocabulary order", value));

    for (name, pointer, replacement) in [
        (
            "language id",
            "/languageKernel/adapters/0/languageId",
            json!("Java"),
        ),
        (
            "extension",
            "/languageKernel/adapters/0/extensions/0",
            json!(".java"),
        ),
        (
            "stability",
            "/languageKernel/adapters/0/capabilities/0/stability",
            json!("beta"),
        ),
        (
            "evidence",
            "/languageKernel/adapters/0/capabilities/0/evidence",
            json!("guess"),
        ),
        (
            "mutation authority",
            "/languageKernel/adapters/0/capabilities/0/mutationAuthority",
            json!("direct"),
        ),
        (
            "execution mode",
            "/languageKernel/adapters/0/runtime/executionMode",
            json!("worker"),
        ),
        (
            "timeout bound",
            "/languageKernel/adapters/1/runtime/limits/requestTimeoutMillis",
            json!(300_001),
        ),
        (
            "input bound",
            "/languageKernel/adapters/1/runtime/limits/maxInputBytes",
            json!(MAX_RUNTIME_BYTES + 1),
        ),
        (
            "process bound",
            "/languageKernel/adapters/1/runtime/limits/maxProcesses",
            json!(65),
        ),
    ] {
        let mut value = actual_capabilities();
        *value.pointer_mut(pointer).unwrap() = replacement;
        cases.push((name, value));
    }

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][1]["languageId"] = json!("java");
    cases.push(("duplicate language", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][1]["extensions"] = json!(["java"]);
    cases.push(("ambiguous extension", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["extensions"] = json!(["java", "java"]);
    cases.push(("duplicate extension", value));

    let mut value = actual_capabilities();
    let duplicate = value["languageKernel"]["adapters"][1]["capabilities"][0].clone();
    value["languageKernel"]["adapters"][1]["capabilities"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    cases.push(("duplicate operation", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["capabilities"][0]["mutationAuthority"] =
        json!("managed-stable");
    cases.push(("managed-stable experimental", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["capabilities"][5]["evidence"] = json!("lexical");
    cases.push(("managed-stable lexical", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["runtime"]["recordsProcessProvenance"] = json!(true);
    cases.push(("in-process provenance", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["runtime"]["usesWorkspaceOverlay"] = json!(true);
    cases.push(("in-process overlay", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][1]["runtime"]["limits"]["requestTimeoutMillis"] =
        Value::Null;
    cases.push(("timeout coherence", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"] = Value::Array(
        (0..=MAX_LANGUAGE_ADAPTERS)
            .map(|index| {
                json!({
                    "languageId": format!("extra-{index}"),
                    "extensions": [format!("x{index}")],
                    "backend": "fixture",
                    "runtime": actual_language_kernel()["adapters"][0]["runtime"].clone(),
                    "capabilities": []
                })
            })
            .collect(),
    );
    cases.push(("adapter bound", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["extensions"] = Value::Array(
        (0..=MAX_LANGUAGE_EXTENSIONS)
            .map(|index| json!(format!("x{index}")))
            .collect(),
    );
    cases.push(("extension bound", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["capabilities"] = Value::Array(
        (0..=MAX_LANGUAGE_CAPABILITIES)
            .map(|index| {
                json!({
                    "operation": format!("operation-{index}"),
                    "stability": "stable", "evidence": "compiler", "mutationAuthority": "none",
                    "backend": "eclipse-jdt-3.44",
                    "runtime": actual_language_kernel()["adapters"][0]["runtime"].clone(),
                    "extensions": ["java"]
                })
            })
            .collect(),
    );
    cases.push(("capability bound", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["backend"] = json!("é".repeat(129));
    cases.push(("UTF-8 string bound", value));

    for field in ["backend", "runtime", "extensions"] {
        let mut value = actual_capabilities();
        value["languageKernel"]["adapters"][0]["capabilities"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
        cases.push((
            match field {
                "backend" => "missing operation backend",
                "runtime" => "missing operation runtime",
                _ => "missing operation extensions",
            },
            value,
        ));
    }

    for (name, field, replacement) in [
        ("wrong operation backend type", "backend", json!(7)),
        (
            "wrong operation runtime type",
            "runtime",
            json!("in-process"),
        ),
        (
            "wrong operation extensions type",
            "extensions",
            json!("java"),
        ),
    ] {
        let mut value = actual_capabilities();
        value["languageKernel"]["adapters"][0]["capabilities"][0][field] = replacement;
        cases.push((name, value));
    }

    for (name, extensions) in [
        ("empty operation extensions", json!([])),
        ("duplicate operation extensions", json!(["java", "java"])),
        ("non-canonical operation extension", json!([".java"])),
    ] {
        let mut value = actual_capabilities();
        value["languageKernel"]["adapters"][0]["capabilities"][0]["extensions"] = extensions;
        cases.push((name, value));
    }

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["capabilities"][0]["extensions"] = Value::Array(
        (0..=MAX_LANGUAGE_EXTENSIONS)
            .map(|index| json!(format!("x{index}")))
            .collect(),
    );
    cases.push(("operation extension bound", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["capabilities"][0]["backend"] = json!("é".repeat(129));
    cases.push(("operation backend UTF-8 bound", value));

    let mut value = actual_capabilities();
    value["languageKernel"]["adapters"][0]["capabilities"][0]["runtime"]
        ["recordsProcessProvenance"] = json!(true);
    cases.push(("operation runtime coherence", value));

    let mut value = actual_capabilities();
    value["safety"]["snapshotValidation"] = json!("yes");
    cases.push(("safety boolean", value));

    for (name, value) in cases {
        assert!(
            matches!(normalize_server_capabilities(&value), Err(ref error) if error == PROTOCOL_FAILED),
            "malformed case was accepted: {name}"
        );
    }
}

#[test]
fn incomplete_or_false_capabilities_are_rejected() {
    for pointer in [
        "/methods/3/features/targetDirectory",
        "/methods/3/features/preview",
        "/methods/3/features/apply",
        "/methods/3/features/discard",
        "/methods/3/features/rollback",
    ] {
        let mut capabilities = complete_capabilities();
        *capabilities.pointer_mut(pointer).unwrap() = Value::Bool(false);
        assert_eq!(
            validate_capabilities(&capabilities),
            Err(UNAVAILABLE.to_string())
        );
    }
    let mut missing = complete_capabilities();
    missing["methods"].as_array_mut().unwrap().remove(1);
    assert_eq!(
        validate_capabilities(&missing),
        Err(UNAVAILABLE.to_string())
    );
}

#[test]
fn daemon_params_are_exact_and_source_is_preview_only() {
    let preview = preview_params("secret source", "src/main/java/example");
    assert_eq!(
        preview,
        json!({
            "code": "secret source", "targetDirectory": "src/main/java/example",
            "sourceKind": "clipboard", "sourceUrl": null, "licensePolicy": "warn"
        })
    );
    for forbidden in [
        "targetPackage",
        "workspaceId",
        "workspaceGeneration",
        "selectionGeneration",
        "requestId",
        "approval",
        "ui",
    ] {
        assert!(preview.get(forbidden).is_none());
    }
    assert_eq!(plan_params("plan-1"), json!({"planId": "plan-1"}));
    assert_eq!(transaction_params("tx-1"), json!({"transactionId": "tx-1"}));
    assert!(transaction_params("tx-1").get("force").is_none());
}

#[test]
fn rich_preview_statuses_and_nested_protocol_fields_are_normalized() {
    let root = temp_workspace("normalize");
    fs::write(root.join("pom.xml"), "<project/>").unwrap();
    let request = preview_request();
    for (wire, normalized_status) in [
        ("preview", "ready"),
        ("refused", "refused"),
        ("stale", "stale"),
        ("error", "error"),
    ] {
        let normalized = normalize_plan(rich_plan(wire), &root, &request).unwrap();
        assert_eq!(normalized["status"], normalized_status);
        assert_eq!(normalized.pointer("/packageChanges/0/path"), None);
        assert_eq!(
            normalized
                .pointer("/packageChanges/1/path")
                .and_then(Value::as_str),
            Some("src/main/java/example/Widget.java")
        );
        assert_eq!(
            normalized
                .pointer("/structuredDiff/0/hunks/0/lines/0")
                .and_then(Value::as_str),
            Some("+package example;")
        );
        assert_eq!(
            normalized
                .pointer("/diagnosticsAfterPreview/0/code")
                .and_then(Value::as_str),
            Some("RK001")
        );
        assert_eq!(
            normalized
                .pointer("/provenance/detectedLicense")
                .and_then(Value::as_str),
            Some("Apache-2.0")
        );
        assert_eq!(
            normalized
                .pointer("/conflicts/0/path")
                .and_then(Value::as_str),
            Some("pom.xml")
        );
        assert_eq!(normalized["workspaceGeneration"], 7);
        assert!(normalized.get("code").is_none());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn malformed_oversized_ids_paths_and_provenance_are_rejected_without_source_echo() {
    let root = temp_workspace("invalid");
    fs::write(root.join("pom.xml"), "<project/>").unwrap();
    let request = preview_request();
    let secret = "private clipboard source must not escape";
    let mut cases = Vec::new();
    let mut malformed = rich_plan("preview");
    malformed["confidence"] = json!(2);
    cases.push(malformed);
    let mut oversized = rich_plan("preview");
    oversized["renderedDiff"] = Value::String("x".repeat(MAX_TEXT_BYTES + 1));
    cases.push(oversized);
    let mut wrong_id = rich_plan("preview");
    wrong_id["planId"] = Value::String("/bad/id".into());
    cases.push(wrong_id);
    let mut traversal = rich_plan("preview");
    traversal["affectedFiles"][0]["path"] = Value::String("../Secret.java".into());
    cases.push(traversal);
    let mut provenance = rich_plan("preview");
    provenance["provenance"]["sourceKind"] = Value::String("url".into());
    cases.push(provenance);
    for mut raw in cases {
        raw["backendSource"] = Value::String(secret.into());
        let error = normalize_plan(raw, &root, &request).unwrap_err();
        assert!(matches!(
            error.as_str(),
            PROTOCOL_FAILED | "Invalid RefactorKit protocol identifier."
        ));
        assert!(!error.contains(secret));
    }
    assert!(validate_id(&"x".repeat(MAX_ID_BYTES + 1)).is_err());
    assert!(safe_path("/tmp/secret", &root).is_err());
    assert!(safe_path("src/../secret", &root).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn request_deserialization_and_all_correlation_guards_are_exact() {
    let preview_json = json!({
        "code": "class X {}", "targetDirectory": "src", "sourceKind": "clipboard",
        "sourceUrl": null, "licensePolicy": "warn", "workspaceId": "w",
        "workspaceGeneration": 2, "selectionGeneration": 3, "requestId": "r"
    });
    assert!(serde_json::from_value::<PreviewRequest>(preview_json.clone()).is_ok());
    let mut extra = preview_json;
    extra["targetPackage"] = json!("forbidden");
    assert!(serde_json::from_value::<PreviewRequest>(extra).is_err());
    assert!(require_generation(0).is_err());
    assert!(require_generation(1).is_ok());
    let root = canonical_workspace().unwrap();
    assert!(validate_workspace("wrong-workspace", 1).is_err());
    assert!(validate_workspace(&workspace_id_for_path(&root), 0).is_err());

    let guard = Guard {
        workspace_id: "w".into(),
        workspace_generation: 2,
        selection_generation: 3,
        request_id: "r".into(),
    };
    assert!(guard_matches(&guard, "w", 2, 3, "r"));
    assert!(!guard_matches(&guard, "other", 2, 3, "r"));
    assert!(!guard_matches(&guard, "w", 4, 3, "r"));
    assert!(!guard_matches(&guard, "w", 2, 4, "r"));
    assert!(!guard_matches(&guard, "w", 2, 3, "other"));
    let approval = ApprovalEvidence {
        approval_id: "a".into(),
        approved_plan_id: "plan-1".into(),
        approved_at: "time".into(),
    };
    assert!(approval_matches(&approval, "plan-1"));
    assert!(!approval_matches(&approval, "plan-2"));
}

#[test]
fn mutation_request_contracts_remain_camel_case_and_closed() {
    let apply = json!({
        "planId": "plan-1",
        "workspaceId": "workspace-1",
        "workspaceGeneration": 7,
        "selectionGeneration": 9,
        "requestId": "request-1",
        "approval": {
            "approvalId": "approval-1",
            "approvedPlanId": "plan-1",
            "approvedAt": "2026-07-13T00:00:00Z"
        }
    });
    assert!(serde_json::from_value::<ApplyRequest>(apply.clone()).is_ok());
    let mut extra_apply = apply;
    extra_apply["approval"]["unexpected"] = json!(true);
    assert!(serde_json::from_value::<ApplyRequest>(extra_apply).is_err());

    let discard = json!({
        "planId": "plan-1",
        "workspaceId": "workspace-1",
        "workspaceGeneration": 7,
        "selectionGeneration": 9,
        "requestId": "request-1"
    });
    assert!(serde_json::from_value::<DiscardRequest>(discard.clone()).is_ok());
    let mut extra_discard = discard;
    extra_discard["force"] = json!(true);
    assert!(serde_json::from_value::<DiscardRequest>(extra_discard).is_err());

    let rollback = json!({
        "transactionId": "transaction-1",
        "workspaceId": "workspace-1",
        "workspaceGeneration": 7,
        "requestId": "request-1"
    });
    assert!(serde_json::from_value::<RollbackRequest>(rollback.clone()).is_ok());
    let mut extra_rollback = rollback;
    extra_rollback["force"] = json!(true);
    assert!(serde_json::from_value::<RollbackRequest>(extra_rollback).is_err());
}

#[test]
fn discard_retires_local_plan_before_any_daemon_failure() {
    let mut manager = Manager::default();
    manager.plans.insert(
        "plan-1".into(),
        Guard {
            workspace_id: "w".into(),
            workspace_generation: 1,
            selection_generation: 1,
            request_id: "r".into(),
        },
    );
    consume_plan(&mut manager, "plan-1");
    assert!(!manager.plans.contains_key("plan-1"));
    assert!(manager.consumed_plans.contains("plan-1"));
    // This is the state retained even if ensure_session/refactor.discard subsequently fails.
    assert_eq!(plan_params("plan-1"), json!({"planId": "plan-1"}));
}

#[test]
fn reset_models_workspace_switch_and_app_exit_cleanup() {
    let state = RefactorKitDaemonState::default();
    {
        let mut manager = state.0.lock().unwrap();
        manager.plans.insert(
            "plan".into(),
            Guard {
                workspace_id: "w".into(),
                workspace_generation: 1,
                selection_generation: 1,
                request_id: "r".into(),
            },
        );
        manager.transactions.insert(
            "tx".into(),
            TransactionGuard {
                workspace_id: "w".into(),
                workspace_generation: 1,
                operation: None,
            },
        );
        manager.consumed_plans.insert("old".into());
    }
    state.shutdown_all();
    let manager = state.0.lock().unwrap();
    assert!(
        manager.session.is_none()
            && manager.plans.is_empty()
            && manager.transactions.is_empty()
            && manager.consumed_plans.is_empty()
    );
}

#[cfg(unix)]
fn daemon_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<TestMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| TestMutex::new(())).lock().unwrap()
}

#[cfg(unix)]
fn fake_session(root: &Path, body: &str) -> (Session, PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let script = root.join(format!(
        "fake-daemon-{}.sh",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script, permissions).unwrap();
    env::set_var("IDE_REFACTORKIT_DAEMON", &script);
    let session = spawn_session("fake", 1, root).unwrap();
    env::remove_var("IDE_REFACTORKIT_DAEMON");
    (session, script)
}

#[test]
#[cfg(unix)]
fn emitted_json_rpc_frame_has_only_the_exact_protocol_fields() {
    let _lock = daemon_env_lock();
    let root = temp_workspace("frame");
    let capture = root.join("captured-frame.json");
    let body = format!(
            "read line; printf '%s' \"$line\" > '{}'; printf '{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{\"ok\":true}}}}\\n'",
            capture.display()
        );
    let (mut session, script) = fake_session(&root, &body);
    assert_eq!(
        session_call(
            &mut session,
            "java.importExternalClass",
            preview_params("class X {}", "src/main/java/example"),
            Duration::from_secs(1),
        )
        .unwrap(),
        json!({"ok": true})
    );
    let frame: Value = serde_json::from_slice(&fs::read(&capture).unwrap()).unwrap();
    assert_eq!(
        frame
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<HashSet<_>>(),
        ["jsonrpc", "id", "method", "params"]
            .into_iter()
            .map(ToString::to_string)
            .collect()
    );
    assert_eq!(frame["jsonrpc"], "2.0");
    assert_eq!(frame["id"], 1);
    assert_eq!(frame["method"], "java.importExternalClass");
    assert_eq!(
        frame["params"],
        preview_params("class X {}", "src/main/java/example")
    );
    terminate(&mut session.child);
    fs::remove_file(script).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn detailed_transport_retains_only_safe_json_rpc_error_code() {
    let _lock = daemon_env_lock();
    let root = temp_workspace("structured-error");
    let (mut session, script) = fake_session(
        &root,
        "read line; printf '{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32602,\"message\":\"/private/toolchain secret-source\",\"data\":{\"payload\":\"secret\"}}}\\n'",
    );

    let error = session_call_detailed(
        &mut session,
        "symbol.search",
        json!({"languageId": "typescript", "query": "Service"}),
        Duration::from_secs(1),
    )
    .unwrap_err();

    assert_eq!(error.kind, SessionCallErrorKind::Rejected);
    assert_eq!(error.rpc_code, Some(-32602));
    let debug = format!("{error:?}");
    for forbidden in ["private", "toolchain", "secret", "payload"] {
        assert!(!debug.contains(forbidden));
    }
    terminate(&mut session.child);
    fs::remove_file(script).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn malformed_oversized_wrong_id_timeout_and_process_death_kill_sessions() {
    let _lock = daemon_env_lock();
    let scenarios = [
        "read line; printf 'not-json\\n'",
        "read line; printf '{\"jsonrpc\":\"2.0\",\"id\":999,\"result\":{}}\\n'",
        "read line; head -c 2097153 /dev/zero | tr '\\000' x; printf '\\n'",
        "read line; exit 0",
        "read line; sleep 2",
    ];
    for body in scenarios {
        let root = temp_workspace("fake");
        let (mut session, script) = fake_session(&root, body);
        let error = session_call(
            &mut session,
            "test.method",
            json!({}),
            Duration::from_millis(100),
        )
        .unwrap_err();
        assert!(matches!(error.as_str(), PROTOCOL_FAILED | SESSION_FAILED));
        assert!(
            session.child.try_wait().unwrap().is_some(),
            "failed session was not killed"
        );
        fs::remove_file(script).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[cfg(unix)]
fn process_death_clears_all_manager_lifecycle_state() {
    let _lock = daemon_env_lock();
    let root = temp_workspace("death");
    let (session, script) = fake_session(&root, "read line; exit 0");
    let mut manager = Manager {
        session: Some(session),
        ..Manager::default()
    };
    manager.plans.insert(
        "plan".into(),
        Guard {
            workspace_id: "w".into(),
            workspace_generation: 1,
            selection_generation: 1,
            request_id: "r".into(),
        },
    );
    manager.transactions.insert(
        "tx".into(),
        TransactionGuard {
            workspace_id: "w".into(),
            workspace_generation: 1,
            operation: None,
        },
    );
    assert_eq!(
        call(&mut manager, "test", json!({}), Duration::from_millis(200)),
        Err(SESSION_FAILED.to_string())
    );
    assert!(
        manager.session.is_none() && manager.plans.is_empty() && manager.transactions.is_empty()
    );
    fs::remove_file(script).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires an installed compatible RefactorKit packaged daemon; creates only a temporary Java workspace"]
fn packaged_daemon_full_preview_discard_apply_rollback_smoke() {
    let root = temp_workspace("packaged-smoke");
    let target = root.join("src/main/java/example");
    let existing = target.join("Existing.java");
    let original = b"package example;\npublic class Existing {}\n";
    fs::write(&existing, original).unwrap();
    let imported = target.join("ImportedSmoke.java");
    let before_entries = fs::read_dir(&target).unwrap().count();
    let mut manager = Manager::default();
    ensure_session(&mut manager, "smoke-workspace", 1, &root).unwrap();
    let capabilities = manager
        .session
        .as_ref()
        .unwrap()
        .capabilities
        .as_ref()
        .unwrap();
    assert!(!capabilities.provider_version.is_empty());
    assert!(diagnostics_v2_is_authorized(capabilities));
    assert!(capabilities.provider_version.len() <= 128);
    assert!(!capabilities.provider_version.chars().any(char::is_control));
    eprintln!(
        "running packaged RefactorKit smoke with provider version {}",
        capabilities.provider_version
    );

    let first = call(
        &mut manager,
        "java.importExternalClass",
        preview_params(
            "// MIT License\npackage old.pkg;\npublic class DiscardedSmoke {}\n",
            "src/main/java/example",
        ),
        REQUEST_TIMEOUT,
    )
    .unwrap();
    let first_id = first["planId"].as_str().unwrap().to_string();
    assert!(!target.join("DiscardedSmoke.java").exists());
    let discarded = call(
        &mut manager,
        "refactor.discard",
        plan_params(&first_id),
        REQUEST_TIMEOUT,
    )
    .unwrap();
    assert_eq!(discarded["discarded"], true);

    let raw = call(
        &mut manager,
        "java.importExternalClass",
        preview_params(
            "// MIT License\npackage old.pkg;\npublic class ImportedSmoke {}\n",
            "src/main/java/example",
        ),
        REQUEST_TIMEOUT,
    )
    .unwrap();
    let request = PreviewRequest {
        code: String::new(),
        target_directory: "src/main/java/example".into(),
        source_kind: "clipboard".into(),
        source_url: None,
        license_policy: "warn".into(),
        workspace_id: "smoke-workspace".into(),
        workspace_generation: 1,
        selection_generation: 1,
        request_id: "smoke-preview".into(),
    };
    let preview = normalize_plan(raw, &root, &request).unwrap();
    assert_eq!(preview["status"], "ready");
    assert!(!preview["renderedDiff"].as_str().unwrap().is_empty());
    assert!(!preview["structuredDiff"].as_array().unwrap()[0]["hunks"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(preview["diagnosticsAfterPreview"].is_array());
    assert_eq!(
        fs::read_dir(&target).unwrap().count(),
        before_entries,
        "preview wrote workspace"
    );
    assert!(!imported.exists());

    let plan_id = preview["planId"].as_str().unwrap();
    let applied_raw = call(
        &mut manager,
        "refactor.apply",
        plan_params(plan_id),
        REQUEST_TIMEOUT,
    )
    .unwrap();
    let applied = normalize_apply(applied_raw, &root, plan_id).unwrap();
    assert!(imported.exists());
    let transaction_id = applied["transactionId"].as_str().unwrap();
    let rollback_raw = call(
        &mut manager,
        "patch.rollback",
        transaction_params(transaction_id),
        REQUEST_TIMEOUT,
    )
    .unwrap();
    let rollback = normalize_rollback(rollback_raw, &root, transaction_id).unwrap();
    assert_eq!(rollback["rolledBack"], true);
    assert!(!imported.exists());
    assert_eq!(
        fs::read(&existing).unwrap(),
        original,
        "rollback did not restore exact bytes"
    );
    assert_eq!(fs::read_dir(&target).unwrap().count(), before_entries);
    reset(&mut manager);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn command_signatures_remain_stable() {
    let _: for<'a> fn(
        State<'a, RefactorKitDaemonState>,
    ) -> Result<RefactorKitCapabilities, String> = super::get_refactorkit_capabilities;
    let _: for<'a> fn(PreviewRequest, State<'a, RefactorKitDaemonState>) -> Result<Value, String> =
        super::preview_refactorkit_external_java_import;
    let _: for<'a> fn(ApplyRequest, State<'a, RefactorKitDaemonState>) -> Result<Value, String> =
        super::apply_refactorkit_plan;
    let _: for<'a> fn(DiscardRequest, State<'a, RefactorKitDaemonState>) -> Result<Value, String> =
        super::discard_refactorkit_plan;
    let _: for<'a> fn(RollbackRequest, State<'a, RefactorKitDaemonState>) -> Result<Value, String> =
        super::rollback_refactorkit_transaction;
    let _: for<'a> fn(
        PreviewRefactoringRequest,
        State<'a, RefactorKitDaemonState>,
    ) -> Result<Value, String> = super::preview_refactorkit_refactoring;
    let _: for<'a> fn(
        ApplyRefactoringRequest,
        State<'a, RefactorKitDaemonState>,
    ) -> Result<Value, String> = super::apply_refactorkit_refactoring;
    let _: for<'a> fn(
        RollbackRefactoringRequest,
        State<'a, RefactorKitDaemonState>,
    ) -> Result<Value, String> = super::rollback_refactorkit_refactoring;
    let _: for<'a> fn(
        DiscardRequest,
        State<'a, RefactorKitDaemonState>,
    ) -> Result<Value, String> = super::discard_refactorkit_refactoring;
    let _: for<'a> fn(
        State<'a, RefactorKitDaemonState>,
        State<'a, SavedSnapshotSemanticState>,
    ) -> Result<(), String> = super::shutdown_refactorkit_daemon;
    let _: for<'a> fn(
        StartSavedSnapshotSemanticSessionRequest,
        State<'a, SavedSnapshotSemanticState>,
    ) -> Result<Value, SavedSnapshotSemanticError> =
        super::start_refactorkit_saved_snapshot_semantic_session;
    let _: for<'a> fn(
        StopSavedSnapshotSemanticSessionRequest,
        State<'a, SavedSnapshotSemanticState>,
    ) -> Result<Value, SavedSnapshotSemanticError> =
        super::stop_refactorkit_saved_snapshot_semantic_session;
    let _: for<'a> fn(
        SearchSavedSnapshotSymbolsRequest,
        State<'a, SavedSnapshotSemanticState>,
    ) -> Result<Value, SavedSnapshotSemanticError> =
        super::search_refactorkit_saved_snapshot_symbols;
    let _: for<'a> fn(
        ResolveSavedSnapshotDefinitionRequest,
        State<'a, SavedSnapshotSemanticState>,
    ) -> Result<Value, SavedSnapshotSemanticError> =
        super::resolve_refactorkit_saved_snapshot_definition;
}

#[test]
fn facade_is_thin_and_tauri_free_below_the_inbound_boundary() {
    let facade = include_str!("../refactorkit_daemon.rs");
    // The real-engine slice (REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001) adds 10 thin
    // command wrappers on top of the original 14; the facade stays thin (no process,
    // no Tauri dependency below the inbound boundary, no forbidden imports).
    assert_eq!(
        facade
            .lines()
            .filter(|line| line.trim() == "#[tauri::command]")
            .count(),
        24
    );
    assert!(facade.lines().count() < 260);
    for forbidden in [
        concat!("std::process::", "Command"),
        concat!("Child", "Stdin"),
        concat!("workspace_", "root()"),
        concat!("serde_json::", "to_vec"),
        "languageKernel",
        "consumed_plans",
    ] {
        assert!(!facade.contains(forbidden), "facade contains {forbidden}");
    }

    for (name, module) in [
        ("application", include_str!("application.rs")),
        ("capability_policy", include_str!("capability_policy.rs")),
        ("contract", include_str!("contract.rs")),
        ("path_policy", include_str!("path_policy.rs")),
        (
            "saved_snapshot_semantic",
            include_str!("saved_snapshot_semantic.rs"),
        ),
        ("transport", include_str!("transport.rs")),
    ] {
        assert!(!module.contains("tauri::"), "{name} depends on Tauri");
        assert!(
            !module.contains("#[tauri::command]"),
            "{name} exposes a Tauri command"
        );
    }
}

// ---------------------------------------------------------------------------
// General Java refactoring slice (REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001)
// ---------------------------------------------------------------------------

fn refactor_target() -> RefactoringTarget {
    RefactoringTarget {
        kind: "class".into(),
        path: "src/main/java/example/Widget.java".into(),
        identity: "example.Widget".into(),
        selection: None,
    }
}

fn refactor_preview_request(workspace_id: &str) -> PreviewRefactoringRequest {
    PreviewRefactoringRequest {
        operation: RefactoringOperation::RenameClass,
        target: refactor_target(),
        authority: WorkspaceAuthority {
            workspace_id: workspace_id.into(),
            workspace_generation: 1,
        },
        selection_generation: 1,
        request_id: "refactor-request-1".into(),
    }
}

fn rich_refactoring_plan(status: &str) -> Value {
    json!({
        "planId": "refactor-plan-1",
        "operation": "rename-class",
        "status": status,
        "summary": "Rename Widget to WidgetV2",
        "confidence": 0.93,
        "riskLevel": "low",
        "risks": ["Affects call sites"],
        "evidence": [
            {"kind": "edit", "summary": "Update declaration"},
            {"kind": "edit", "summary": "Update references"}
        ],
        "affectedFiles": [{
            "change": "edit", "path": "src/main/java/example/Widget.java",
            "previousPath": null, "primary": true
        }],
        "renderedDiff": "--- a/src/main/java/example/Widget.java\n+++ b/src/main/java/example/Widget.java",
        "structuredDiff": [{
            "path": "src/main/java/example/Widget.java", "change": "edit",
            "hunks": [{"oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1,
                "lines": ["-package example;", "+package example;"]}]
        }],
        "warnings": [],
        "diagnosticsAfterPreview": [],
        "conflicts": [],
        "refusalReasons": if status == "preview" { json!([]) } else { json!(["not ready"]) },
        "applyEligibility": {"eligible": status == "preview", "blockers": if status == "preview" { json!([]) } else { json!(["blocked"]) }},
        "staleness": {"stale": status == "stale", "reasons": if status == "stale" { json!(["changed"]) } else { json!([]) }},
        "provider": {"name": "refactorkit", "version": "0.5.0-SNAPSHOT"}
    })
}

#[test]
fn general_refactoring_requests_are_closed_and_camel_case() {
    let target = json!({
        "kind": "class", "path": "src/main/java/example/Widget.java", "identity": "example.Widget"
    });
    let preview = json!({
        "operation": "rename-class", "target": target,
        "authority": {"workspaceId": "w", "workspaceGeneration": 2},
        "selectionGeneration": 3, "requestId": "r"
    });
    assert!(serde_json::from_value::<PreviewRefactoringRequest>(preview.clone()).is_ok());
    let mut extra = preview.clone();
    extra["target"]["package"] = json!("forbidden");
    assert!(serde_json::from_value::<PreviewRefactoringRequest>(extra).is_err());
    let mut bad_operation = preview;
    bad_operation["operation"] = json!("change-signature");
    assert!(
        serde_json::from_value::<PreviewRefactoringRequest>(bad_operation).is_err(),
        "non-canonical change-signature must be rejected"
    );

    let apply = json!({
        "planId": "plan-1", "operation": "rename-member", "target": target,
        "authority": {"workspaceId": "w", "workspaceGeneration": 2},
        "selectionGeneration": 3, "requestId": "r",
        "approval": {"approvalId": "a", "approvedPlanId": "plan-1", "approvedAt": "t"}
    });
    assert!(serde_json::from_value::<ApplyRefactoringRequest>(apply.clone()).is_ok());
    let mut extra_apply = apply;
    extra_apply["unexpected"] = json!(true);
    assert!(serde_json::from_value::<ApplyRefactoringRequest>(extra_apply).is_err());

    let rollback = json!({
        "transactionId": "tx-1", "operation": "safe-delete",
        "authority": {"workspaceId": "w", "workspaceGeneration": 2}, "requestId": "r"
    });
    assert!(serde_json::from_value::<RollbackRefactoringRequest>(rollback.clone()).is_ok());
    let mut extra_rollback = rollback;
    extra_rollback["force"] = json!(true);
    assert!(serde_json::from_value::<RollbackRefactoringRequest>(extra_rollback).is_err());

    for (operation, name) in [
        (RefactoringOperation::RenameClass, "rename-class"),
        (RefactoringOperation::RenameMember, "rename-member"),
        (RefactoringOperation::RenameLocalVariable, "rename-local-variable"),
        (RefactoringOperation::MoveClass, "move-class"),
        (RefactoringOperation::ChangeMethodSignature, "change-method-signature"),
        (RefactoringOperation::SafeDelete, "safe-delete"),
    ] {
        assert_eq!(operation.as_str(), name);
        assert_eq!(serde_json::to_value(operation).unwrap(), json!(name));
        assert!(serde_json::from_value::<RefactoringOperation>(json!(name)).is_ok());
    }
}

#[test]
fn general_refactoring_params_are_exact_and_authority_free() {
    let target = refactor_target();
    assert_eq!(
        refactoring_preview_params("rename-class", &target),
        json!({
            "operation": "rename-class",
            "target": {
                "kind": "class",
                "path": "src/main/java/example/Widget.java",
                "identity": "example.Widget"
            }
        })
    );
    let with_selection = RefactoringTarget {
        selection: Some(RefactoringSelection { start: 10, end: 20 }),
        ..target.clone()
    };
    assert_eq!(
        refactoring_target_params(&with_selection),
        json!({
            "kind": "class", "path": "src/main/java/example/Widget.java",
            "identity": "example.Widget", "selection": {"start": 10, "end": 20}
        })
    );
    assert_eq!(refactoring_apply_params("plan-1"), json!({"planId": "plan-1"}));
    assert_eq!(refactoring_rollback_params("tx-1"), json!({"transactionId": "tx-1"}));
    assert_eq!(refactoring_discard_params("plan-1"), json!({"planId": "plan-1"}));
    let preview = refactoring_preview_params("rename-class", &target);
    for forbidden in [
        "workspaceId",
        "workspaceGeneration",
        "selectionGeneration",
        "requestId",
        "approval",
        "authority",
    ] {
        assert!(preview.get(forbidden).is_none());
    }
}

#[test]
fn general_refactoring_preview_statuses_are_normalized_without_apply_authority() {
    let root = temp_workspace("refactor-normalize");
    fs::write(root.join("src/main/java/example/Widget.java"), "package example; public class Widget {}").unwrap();
    let request = refactor_preview_request(&workspace_id_for_path(&root));
    for (wire, status) in [
        ("preview", "ready"),
        ("refused", "refused"),
        ("stale", "stale"),
        ("error", "error"),
    ] {
        let normalized =
            normalize_refactoring_preview(rich_refactoring_plan(wire), &root, &request).unwrap();
        assert_eq!(normalized["status"], status);
        assert_eq!(normalized["operation"], "rename-class");
        assert_eq!(normalized["grantsApplyAuthority"], false);
        assert_eq!(
            normalized.pointer("/target/path").and_then(Value::as_str),
            Some("src/main/java/example/Widget.java")
        );
        assert_eq!(normalized["authority"]["workspaceId"], request.authority.workspace_id);
        assert_eq!(normalized["selectionGeneration"], request.selection_generation);
        assert_eq!(normalized["risks"], json!(["Affects call sites"]));
        assert_eq!(
            normalized.pointer("/evidence/0/kind").and_then(Value::as_str),
            Some("edit")
        );
        assert_eq!(
            normalized.pointer("/applyEligibility/eligible"),
            Some(&Value::Bool(status == "ready"))
        );
        assert!(normalized.get("code").is_none());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn general_refactoring_apply_outcomes_are_normalized_honestly() {
    let root = temp_workspace("refactor-apply");
    fs::write(root.join("src/main/java/example/Widget.java"), "package example; public class Widget {}").unwrap();
    let applied = json!({
        "planId": "refactor-plan-1", "operation": "rename-class", "outcome": "applied",
        "changedFiles": [{"change": "edit", "path": "src/main/java/example/Widget.java", "primary": true}],
        "primaryFile": "src/main/java/example/Widget.java", "diagnostics": [],
        "transactionId": "refactor-tx-1",
        "provider": {"name": "refactorkit", "version": "0.5.0-SNAPSHOT"}
    });
    let normalized =
        normalize_refactoring_apply(applied.clone(), &root, "refactor-plan-1", "rename-class")
            .unwrap();
    assert_eq!(normalized["outcome"], "applied");
    assert_eq!(normalized["transactionId"], "refactor-tx-1");

    for outcome in ["refused", "stale", "failed", "indeterminate"] {
        let raw = json!({
            "planId": "refactor-plan-1", "operation": "rename-class", "outcome": outcome,
            "changedFiles": [], "diagnostics": [],
            "provider": {"name": "refactorkit", "version": "0.5.0-SNAPSHOT"}
        });
        let normalized =
            normalize_refactoring_apply(raw, &root, "refactor-plan-1", "rename-class").unwrap();
        assert_eq!(normalized["outcome"], outcome);
        assert!(
            normalized.get("transactionId").is_none(),
            "{outcome} must not fabricate a transaction"
        );
    }

    let mut wrong_plan = applied.clone();
    wrong_plan["planId"] = json!("other-plan");
    assert!(normalize_refactoring_apply(wrong_plan, &root, "refactor-plan-1", "rename-class").is_err());
    let mut wrong_operation = applied.clone();
    wrong_operation["operation"] = json!("move-class");
    assert!(normalize_refactoring_apply(wrong_operation, &root, "refactor-plan-1", "rename-class").is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn general_refactoring_rollback_is_normalized_and_correlated() {
    let root = temp_workspace("refactor-rollback");
    fs::write(root.join("src/main/java/example/Widget.java"), "package example; public class Widget {}").unwrap();
    let raw = json!({
        "transactionId": "tx-1", "rolledBack": true,
        "changedFiles": [{"change": "edit", "path": "src/main/java/example/Widget.java", "primary": true}],
        "conflicts": [{"kind": "reference", "summary": "External call site"}],
        "diagnostics": []
    });
    let normalized = normalize_refactoring_rollback(raw.clone(), &root, "tx-1").unwrap();
    assert_eq!(normalized["rolledBack"], true);
    assert_eq!(normalized["transactionId"], "tx-1");
    assert_eq!(
        normalized.pointer("/conflicts/0/kind").and_then(Value::as_str),
        Some("reference")
    );
    let mut mismatch = raw;
    mismatch["transactionId"] = json!("tx-2");
    assert!(normalize_refactoring_rollback(mismatch, &root, "tx-1").is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn general_refactoring_capability_is_advertised_only_when_offered() {
    let mut advertised = complete_capabilities();
    advertised["javaRefactor"] = json!({
        "operations": ["rename-class","rename-member","rename-local-variable","move-class","change-method-signature","safe-delete"],
        "stability": "experimental", "preview": true, "apply": true, "rollback": true, "discard": true
    });
    advertised["methods"].as_array_mut().unwrap().extend(json!([
        {"name": "java.refactor.preview"}, {"name": "java.refactor.apply"},
        {"name": "java.refactor.rollback"}, {"name": "java.refactor.discard"}
    ]).as_array().unwrap().clone());

    let normalized = serde_json::to_value(available_managed_capabilities(
        normalize_server_capabilities(&advertised).unwrap(),
    ))
    .unwrap();
    assert_eq!(
        normalized.pointer("/generalRefactoring/supported"),
        Some(&json!(true))
    );
    assert_eq!(
        normalized.pointer("/generalRefactoring/operations"),
        Some(&json!([
            "rename-class", "rename-member", "rename-local-variable",
            "move-class", "change-method-signature", "safe-delete"
        ]))
    );
    for flag in ["preview", "apply", "rollback", "discard"] {
        assert_eq!(
            normalized.pointer(&format!("/generalRefactoring/{flag}")),
            Some(&json!(true))
        );
    }

    let absent = serde_json::to_value(available_managed_capabilities(
        normalize_server_capabilities(&complete_capabilities()).unwrap(),
    ))
    .unwrap();
    assert_eq!(
        absent.pointer("/generalRefactoring/supported"),
        Some(&json!(false))
    );
    assert!(absent.pointer("/generalRefactoring/reason").is_some());
    assert_eq!(
        absent.pointer("/generalRefactoring/operations"),
        Some(&json!([
            "rename-class", "rename-member", "rename-local-variable",
            "move-class", "change-method-signature", "safe-delete"
        ]))
    );

    let mut incomplete_operations = advertised.clone();
    incomplete_operations["javaRefactor"]["operations"] = json!(["rename-class"]);
    assert_eq!(
        normalize_server_capabilities(&incomplete_operations).err().as_deref(),
        Some(UNAVAILABLE)
    );
    let mut missing_method = advertised.clone();
    missing_method["methods"].as_array_mut().unwrap().retain(|method| {
        method.get("name").and_then(Value::as_str) != Some("java.refactor.rollback")
    });
    assert_eq!(
        normalize_server_capabilities(&missing_method).err().as_deref(),
        Some(UNAVAILABLE)
    );
    let mut false_flag = advertised.clone();
    false_flag["javaRefactor"]["rollback"] = json!(false);
    assert_eq!(
        normalize_server_capabilities(&false_flag).err().as_deref(),
        Some(UNAVAILABLE)
    );
}

#[test]
fn refactoring_rollback_rejects_operation_mismatch_and_unknown_transaction() {
    let state = RefactorKitDaemonState::default();
    let root = canonical_workspace().unwrap();
    let workspace_id = workspace_id_for_path(&root);
    {
        let mut manager = state.0.lock().unwrap();
        manager.transactions.insert(
            "tx-1".into(),
            TransactionGuard {
                workspace_id: workspace_id.clone(),
                workspace_generation: 1,
                operation: Some("rename-class".into()),
            },
        );
    }
    let authority = WorkspaceAuthority {
        workspace_id: workspace_id.clone(),
        workspace_generation: 1,
    };
    let mismatch = RollbackRefactoringRequest {
        transaction_id: "tx-1".into(),
        operation: RefactoringOperation::MoveClass,
        authority: authority.clone(),
        request_id: "r".into(),
    };
    assert_eq!(
        rollback_refactoring(mismatch, &state),
        Err("RefactorKit transaction operation mismatch.".to_string())
    );
    let unknown = RollbackRefactoringRequest {
        transaction_id: "tx-999".into(),
        operation: RefactoringOperation::RenameClass,
        authority,
        request_id: "r".into(),
    };
    assert_eq!(
        rollback_refactoring(unknown, &state),
        Err("RefactorKit transaction is stale or unknown.".to_string())
    );
}

#[cfg(unix)]
fn install_fixture_daemon(
    root: &Path,
    workspace_root: &Path,
    caps: &Value,
    preview: &Value,
    apply: &Value,
    rollback: &Value,
) -> PathBuf {
    fs::write(root.join("caps.json"), format!("{}\n", serde_json::to_string(caps).unwrap())).unwrap();
    fs::write(root.join("preview.json"), format!("{}\n", serde_json::to_string(preview).unwrap())).unwrap();
    fs::write(root.join("apply.json"), format!("{}\n", serde_json::to_string(apply).unwrap())).unwrap();
    fs::write(root.join("rollback.json"), format!("{}\n", serde_json::to_string(rollback).unwrap())).unwrap();
    let caps_path = root.join("caps.json").display().to_string();
    let preview_path = root.join("preview.json").display().to_string();
    let apply_path = root.join("apply.json").display().to_string();
    let rollback_path = root.join("rollback.json").display().to_string();
    let open = format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{{\"root\":\"{}\"}}}}",
        workspace_root.display()
    );
    let discard = "{\"jsonrpc\":\"2.0\",\"id\":4,\"result\":{\"discarded\":true}}";
    let script = root.join(format!(
        "fixture-daemon-{}.sh",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let body = format!(
        "#!/bin/sh\nwhile read line; do\n  id=$(printf '%s' \"$line\" | sed -n 's/.*\"id\":\\([0-9]\\+\\)[^0-9].*/\\1/p')\n  case \"$id\" in\n    1) cat '{caps_path}' ;;\n    2) printf '%s\\n' '{open}' ;;\n    3) cat '{preview_path}' ;;\n    4) printf '%s\\n' '{discard}' ;;\n    5) sed 's/\"id\":3/\"id\":5/' '{preview_path}' ;;\n    6) cat '{apply_path}' ;;\n    7) cat '{rollback_path}' ;;\n  esac\n done\n",
        caps_path = caps_path,
        preview_path = preview_path,
        apply_path = apply_path,
        rollback_path = rollback_path,
        open = open,
        discard = discard,
    );
    fs::write(&script, body).unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script, permissions).unwrap();
    env::set_var("IDE_REFACTORKIT_DAEMON", &script);
    script
}

#[test]
#[cfg(unix)]
fn general_refactoring_preview_discard_apply_rollback_flow_with_fixture_peer() {
    let _lock = daemon_env_lock();
    let root = temp_workspace("refactor-flow");
    let workspace_root = canonical_workspace().unwrap();
    let workspace_id = workspace_id_for_path(&workspace_root);

    let caps = json!({
        "id": 1, "jsonrpc": "2.0", "result": {
            "version": "0.5.0-SNAPSHOT", "apiVersion": "0.2",
            "protocol": "json-rpc-2.0", "transport": "stdio",
            "methods": [
                {"name": "refactor.apply"}, {"name": "refactor.discard"}, {"name": "patch.rollback"},
                {"name": "java.importExternalClass", "stability": "experimental", "features": {
                    "targetDirectory": true, "preview": true, "apply": true,
                    "discard": true, "rollback": true}},
                {"name": "java.refactor.preview"}, {"name": "java.refactor.apply"},
                {"name": "java.refactor.rollback"}, {"name": "java.refactor.discard"}
            ],
            "javaRefactor": {
                "operations": ["rename-class","rename-member","rename-local-variable","move-class","change-method-signature","safe-delete"],
                "stability": "experimental", "preview": true, "apply": true,
                "rollback": true, "discard": true
            }
        }
    });
    let preview = json!({
        "id": 3, "jsonrpc": "2.0", "result": {
            "planId": "refactor-plan-1", "operation": "rename-class", "status": "preview",
            "summary": "Rename Widget to WidgetV2", "confidence": 0.93, "riskLevel": "low",
            "risks": ["Affects call sites"],
            "evidence": [
                {"kind": "edit", "summary": "Update declaration"},
                {"kind": "edit", "summary": "Update references"}
            ],
            "affectedFiles": [{"change": "edit", "path": "src/main/java/example/Widget.java",
                "previousPath": null, "primary": true}],
            "renderedDiff": "--- a/src/main/java/example/Widget.java\n+++ b/src/main/java/example/Widget.java",
            "structuredDiff": [{"path": "src/main/java/example/Widget.java", "change": "edit",
                "hunks": [{"oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1,
                    "lines": ["-package example;", "+package example;"]}]}],
            "warnings": [], "diagnosticsAfterPreview": [], "conflicts": [],
            "refusalReasons": [], "applyEligibility": {"eligible": true, "blockers": []},
            "staleness": {"stale": false, "reasons": []},
            "provider": {"name": "refactorkit", "version": "0.5.0-SNAPSHOT"}
        }
    });
    let apply = json!({
        "id": 6, "jsonrpc": "2.0", "result": {
            "planId": "refactor-plan-1", "operation": "rename-class", "outcome": "applied",
            "changedFiles": [{"change": "edit", "path": "src/main/java/example/Widget.java", "primary": true}],
            "primaryFile": "src/main/java/example/Widget.java", "diagnostics": [],
            "transactionId": "refactor-tx-1",
            "provider": {"name": "refactorkit", "version": "0.5.0-SNAPSHOT"}
        }
    });
    let rollback = json!({
        "id": 7, "jsonrpc": "2.0", "result": {
            "transactionId": "refactor-tx-1", "rolledBack": true,
            "changedFiles": [{"change": "edit", "path": "src/main/java/example/Widget.java", "primary": true}],
            "conflicts": [], "diagnostics": []
        }
    });
    let script = install_fixture_daemon(&root, &workspace_root, &caps, &preview, &apply, &rollback);

    let state = RefactorKitDaemonState::default();

    let previewed = preview_refactoring(refactor_preview_request(&workspace_id), &state).unwrap();
    assert_eq!(previewed["planId"], "refactor-plan-1");
    assert_eq!(previewed["operation"], "rename-class");
    assert_eq!(previewed["status"], "ready");
    assert_eq!(previewed["grantsApplyAuthority"], false);
    assert_eq!(
        previewed.pointer("/applyEligibility/eligible"),
        Some(&Value::Bool(true))
    );
    assert_eq!(previewed["authority"]["workspaceId"], workspace_id.clone());
    assert_eq!(previewed["selectionGeneration"], 1);

    let discarded = discard_refactoring(
        DiscardRequest {
            plan_id: "refactor-plan-1".into(),
            workspace_id: workspace_id.clone(),
            workspace_generation: 1,
            selection_generation: 1,
            request_id: "refactor-request-1".into(),
        },
        &state,
    )
    .unwrap();
    assert_eq!(discarded["discarded"], true);

    let previewed2 = preview_refactoring(refactor_preview_request(&workspace_id), &state).unwrap();
    assert_eq!(previewed2["status"], "ready");

    let applied = apply_refactoring(
        ApplyRefactoringRequest {
            plan_id: "refactor-plan-1".into(),
            operation: RefactoringOperation::RenameClass,
            target: refactor_target(),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id.clone(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "refactor-request-1".into(),
            approval: ApprovalEvidence {
                approval_id: "approval-1".into(),
                approved_plan_id: "refactor-plan-1".into(),
                approved_at: "2026-07-13T00:00:00Z".into(),
            },
        },
        &state,
    )
    .unwrap();
    assert_eq!(applied["outcome"], "applied");
    assert_eq!(applied["transactionId"], "refactor-tx-1");

    let rolled_back = rollback_refactoring(
        RollbackRefactoringRequest {
            transaction_id: "refactor-tx-1".into(),
            operation: RefactoringOperation::RenameClass,
            authority: WorkspaceAuthority {
                workspace_id: workspace_id.clone(),
                workspace_generation: 1,
            },
            request_id: "refactor-request-3".into(),
        },
        &state,
    )
    .unwrap();
    assert_eq!(rolled_back["rolledBack"], true);
    assert_eq!(rolled_back["transactionId"], "refactor-tx-1");

    state.shutdown_all();
    env::remove_var("IDE_REFACTORKIT_DAEMON");
    fs::remove_file(&script).unwrap();
    fs::remove_dir_all(root).unwrap();
}
