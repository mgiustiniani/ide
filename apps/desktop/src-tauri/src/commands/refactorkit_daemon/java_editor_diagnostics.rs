//! Compiler errors for an exact immutable Java editor frame. Session, cancellation,
//! workspace and saved-input guards are shared with the SDK-bound Java query path.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

use super::java_navigation::{
    digest, normalize_editor_overlay_authority, normalize_location, Document, EditorOverlay,
    JavaNavigationRequest, ProjectContext,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub(super) workspace_id: String,
    pub(super) generation: u64,
    pub(super) request_id: String,
    #[serde(deserialize_with = "explicit_context")]
    pub(super) project_context: ProjectContext,
    pub(super) document: Document,
    pub(super) editor_overlay: EditorOverlay,
    pub(super) limit: u64,
}

fn explicit_context<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<ProjectContext, D::Error> {
    let value = Value::deserialize(deserializer)?;
    if value
        .get("contextSchemaVersion")
        .and_then(Value::as_str)
        .is_none()
    {
        return Err(serde::de::Error::custom(
            "Java diagnostics require an explicit context schema version.",
        ));
    }
    serde_json::from_value(value).map_err(serde::de::Error::custom)
}

fn hash(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == 64
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn compiler_identity(raw: &Value) -> bool {
    (raw["providerId"] == "java-sdk-compiler-diagnostics-v1"
        && raw["backend"] == "jdk26-javac-compiler-errors-v1"
        && raw["contextSchemaVersion"] == "java-project-context-v7")
        || matches!(
            (raw["providerId"].as_str(), raw["backend"].as_str()),
            (
                Some("java-jdt-bindings-v1"),
                Some("eclipse-jdt-3.44-bindings-v1")
            ) | (
                Some("java-sdk-compiler-diagnostics-v1"),
                Some("jdk25-javac-compiler-errors-v1")
            ) | (
                Some("java-sdk-and-jdt-compiler-diagnostics-v1"),
                Some("jdk25-javac-compiler-errors-v1+eclipse-jdt-3.44-bindings-v1")
            )
        )
}

fn compiler_code(code: &str, provider: &str) -> bool {
    let jdt = matches!(code, "java.jdt.syntax" | "java.jdt.typeResolution");
    let sdk = code
        .strip_prefix("java.javac.compiler.err.")
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.')
        });
    match provider {
        "java-jdt-bindings-v1" => jdt,
        "java-sdk-compiler-diagnostics-v1" => sdk,
        "java-sdk-and-jdt-compiler-diagnostics-v1" => jdt || sdk,
        _ => false,
    }
}

pub(super) fn normalize(
    raw: Value,
    request: &JavaNavigationRequest,
    root: &Path,
    snapshot_hash: &str,
    provider_version: &str,
) -> Result<Value, String> {
    let context = request
        .project_context
        .as_ref()
        .ok_or("Java diagnostics require a synchronized project context.")?;
    let overlay = request
        .editor_overlay
        .as_ref()
        .ok_or("Java diagnostics require captured editor buffers.")?;
    let values = raw["items"]
        .as_array()
        .ok_or("Missing Java compiler errors.")?;
    // This scope attests compiler errors only. It does not claim warnings or
    // inspections. Closed sources retain saved-snapshot authority; open sources use
    // the exact captured buffer content, including clean companions.
    if raw["status"] != "ready"
        || !compiler_identity(&raw)
        || raw["providerId"] != "java-jdt-bindings-v1"
            && !matches!(
                context.context_schema_version.as_str(),
                "java-project-context-v2"
                    | "java-project-context-v3"
                    | "java-project-context-v4"
                    | "java-project-context-v5"
                    | "java-project-context-v6"
                    | "java-project-context-v7"
            )
        || raw["evidence"] != "compiler"
        || raw["coverage"] != "compiler-errors"
        || raw["complete"] != true
        || raw["truncated"].as_bool() == Some(true)
        || !hash(&raw["provenanceHash"])
        || raw["analyzedSourceCount"]
            .as_u64()
            .is_none_or(|count| count < overlay.documents.len() as u64 || count > 10000)
        || raw["total"].as_u64() != Some(values.len() as u64)
        || values.len() > request.limit as usize
        || values.len() > 500
        || raw["contextSchemaVersion"].as_str() != Some(context.context_schema_version.as_str())
        || raw["contextHash"] != context.context_hash
        || raw["platformIdentities"] != json!(context.platform_identities)
    {
        return Err("RefactorKit did not attest complete compiler errors for the captured Java buffers and SDK.".into());
    }
    let authority =
        normalize_editor_overlay_authority(&raw, &overlay.documents, snapshot_hash, None)?;
    let mut contents = HashMap::new();
    let mut bytes = 0;
    let mut items = Vec::with_capacity(values.len());
    for diagnostic in values {
        let code = diagnostic["code"]
            .as_str()
            .filter(|code| {
                code.len() <= 256
                    && compiler_code(code, raw["providerId"].as_str().unwrap_or_default())
            })
            .ok_or("Invalid Java compiler diagnostic code.")?;
        let message = diagnostic["message"]
            .as_str()
            .filter(|message| !message.is_empty() && message.len() <= 16_384)
            .ok_or("Invalid Java compiler diagnostic message.")?;
        if diagnostic["severity"] != "error"
            || !diagnostic["location"]["path"]
                .as_str()
                .is_some_and(|path| path.ends_with(".java"))
        {
            return Err("Java compiler errors must refer to Java sources.".into());
        }
        let location = normalize_location(
            &diagnostic["location"],
            root,
            Some(overlay),
            &mut contents,
            &mut bytes,
        )?;
        items
            .push(json!({"severity":"error", "code":code, "message":message, "location":location}));
    }
    let mut files: Vec<_> = contents.into_iter().collect();
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let source_files: Vec<_> = files.into_iter().map(|(path, text)| {
        json!({"path":path, "contentSha256":digest(text.as_bytes()), "text":text})
    }).collect();
    Ok(json!({
        "workspaceId":request.workspace_id, "generation":request.generation, "requestId":request.request_id,
        "kind":"diagnostics", "documentPath":request.document.path, "documentVersion":request.document.version,
        "status":"ready", "coverage":"compiler-errors", "complete":true, "analyzedSourceCount":raw["analyzedSourceCount"], "sourceFiles":source_files,
        "items":items, "total":items.len(), "snapshotHash":snapshot_hash, "indexGeneration":raw["indexGeneration"],
        "provider":{"name":"RefactorKit", "version":provider_version, "id":raw["providerId"], "backend":raw["backend"], "evidence":"compiler"},
        "projectContext":{"projectPath":context.project_path, "contextHash":raw["contextHash"],
            "contextSchemaVersion":raw["contextSchemaVersion"], "platformIdentities":raw["platformIdentities"]},
        "editorOverlay":authority
    }))
}
