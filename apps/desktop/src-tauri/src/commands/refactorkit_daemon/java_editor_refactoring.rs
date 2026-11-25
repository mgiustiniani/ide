//! Read-only editor plans. RefactorKit owns compiler selection and transformations.
use super::contract::{RefactorKitChangeIntent, RefactoringOperation, RefactoringTarget};
use super::java_navigation::{digest, point, valid_position, JavaNavigationRequest};
use super::transport::{session_call_detailed, Session, SessionCallErrorKind, REQUEST_TIMEOUT};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    pub operation: RefactoringOperation,
    pub target: RefactoringTarget,
    pub change_intent: Option<RefactorKitChangeIntent>,
    pub formatter_profile: Option<crate::commands::java_language::JavaLanguageFormatterProfile>,
    pub selection_generation: u64,
    pub mutation_mode: Option<String>,
}

fn operation(value: RefactoringOperation) -> Result<&'static str, String> {
    match value {
        RefactoringOperation::RenameClass => Ok("renameClass"),
        RefactoringOperation::RenameMember => Ok("renameMember"),
        RefactoringOperation::FormatFile => Ok("formatFile"),
        RefactoringOperation::OrganizeImports => Ok("organizeImports"),
        _ => Err("RefactorKit does not offer this operation on Java drafts.".into()),
    }
}
fn hash(value: &Value) -> bool {
    value.as_str().is_some_and(|v| {
        v.len() == 64
            && v.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn text<'a>(value: &'a Value, max: usize) -> Result<&'a str, String> {
    value
        .as_str()
        .filter(|v| v.len() <= max && !v.contains('\0'))
        .ok_or_else(|| "Invalid editor preview text.".into())
}
fn strings(value: &Value) -> Result<Vec<String>, String> {
    value
        .as_array()
        .filter(|v| v.len() <= 500)
        .ok_or("Invalid editor preview list.")?
        .iter()
        .map(|v| text(v, 4096).map(str::to_owned))
        .collect()
}

pub(super) fn validate_selection(
    raw: &Value,
    request: &JavaNavigationRequest,
) -> Result<(), String> {
    let wrapper = &raw["selection"];
    let selected = &wrapper["selection"];
    let context = request
        .project_context
        .as_ref()
        .ok_or("Java drafts require a selected SDK.")?;
    if wrapper["schemaVersion"] != "java-editor-mutation-selection-v1"
        || wrapper["baseSnapshotHash"] != context.snapshot_hash
        || wrapper["overlayHash"] != raw["sourceAuthority"]["overlayHash"]
        || wrapper["documents"] != raw["sourceAuthority"]["documents"]
        || !hash(&wrapper["selectorHash"])
        || selected["schemaVersion"] != "java-mutation-selection-v1"
        || selected["snapshotHash"] != raw["providerSnapshotHash"]
        || selected["contextHash"] != context.context_hash
        || selected["path"] != request.document.path
        || selected["position"]
            != json!({"line":request.position.line,"character":request.position.character})
        || selected["contentSha256"] != digest(request.document.text.as_bytes())
        || selected["provenanceHash"] != raw["provenanceHash"]
        || !hash(&selected["selectorHash"])
        || text(&selected["symbolId"], 4096)?.is_empty()
        || text(&selected["bindingKey"], 8192)?.is_empty()
    {
        return Err("RefactorKit returned a stale Java draft selection.".into());
    }
    let declaration = &selected["declaration"];
    let document = request
        .editor_overlay
        .as_ref()
        .unwrap()
        .documents
        .iter()
        .find(|d| declaration["path"] == d.path)
        .ok_or("Open every affected Java source before reviewing this draft.")?;
    let start = point(&declaration["range"]["start"])?;
    let end = point(&declaration["range"]["end"])?;
    if !valid_position(&document.text, &start)
        || !valid_position(&document.text, &end)
        || (start.line, start.character) > (end.line, end.character)
    {
        return Err("Invalid Java draft declaration range.".into());
    }
    Ok(())
}

pub(super) fn uri_path(uri: &Value, root: &Path, existing: bool) -> Result<String, String> {
    let path = url::Url::parse(text(uri, 16384)?)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .ok_or("Invalid Java edit file URI.")?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Java edit escapes the selected project.")?;
    let value = relative.to_str().ok_or("Invalid Java edit path.")?;
    super::path_policy::safe_path(value, root)?;
    let checked = if existing {
        path.canonicalize()
    } else {
        path.parent()
            .ok_or("Invalid Java rename path.")?
            .canonicalize()
    }
    .map_err(|_| "Java edit source is unavailable.")?;
    crate::workspace::ensure_within_root(root, &checked)
        .map_err(|_| "Java edit escapes the selected project.")?;
    Ok(value.into())
}

pub(super) fn preview(
    session: &mut Session,
    request: &JavaNavigationRequest,
    selection: Option<&Value>,
    root: &Path,
    version: &str,
    generation: u64,
) -> Result<Value, String> {
    let spec = request
        .editor_refactoring
        .as_ref()
        .ok_or("Missing Java editor operation.")?;
    let context = request.project_context.as_ref().unwrap();
    let overlay = request.editor_overlay.as_ref().unwrap();
    let provider_operation = operation(spec.operation)?;
    let mutating = spec.mutation_mode.as_deref() == Some("durable-editor-owned");
    if spec.mutation_mode.is_some() && !mutating {
        return Err("Unsupported Java editor mutation mode.".into());
    }
    if mutating && !super::java_editor_transaction::mutation_offered(session, provider_operation)? {
        return Err("RefactorKit does not offer this durable editor operation.".into());
    }
    let expected_path = if context.project_path.is_empty() {
        request.document.path.clone()
    } else {
        format!("{}/{}", context.project_path, request.document.path)
    };
    if spec.target.path != expected_path {
        return Err("The Java draft target changed.".into());
    }
    if spec.selection_generation == 0 || spec.selection_generation > 9_007_199_254_740_991 {
        return Err("Invalid Java editor preview authority.".into());
    }
    if let Some(intent) = &spec.change_intent {
        intent.validate(spec.operation)?;
    }
    if spec.formatter_profile.is_some() && spec.operation != RefactoringOperation::FormatFile {
        return Err("Eclipse formatter profiles apply only to format-file previews.".into());
    }
    let arguments = if matches!(
        spec.operation,
        RefactoringOperation::RenameClass | RefactoringOperation::RenameMember
    ) {
        let intent = spec
            .change_intent
            .as_ref()
            .ok_or("Enter the requested new name.")?;
        json!({"newName":intent.new_name.as_ref().ok_or("Enter the requested new name.")?})
    } else {
        json!({"file":request.document.path})
    };
    let mut params = json!({
        "operation":provider_operation,"languageId":"java","arguments":arguments,
        "expectedSnapshotHash":context.snapshot_hash,"javaContext":super::java_navigation::java_context_authority(context, Path::new(&context.sdk_home)),
        "sourceAuthority":{"kind":"immutable-editor-overlay","documents":overlay.documents.iter().map(|d|json!({"path":d.path,"version":d.version,"content":d.text})).collect::<Vec<_>>()},
    });
    let formatter_profile = if let Some(profile) = spec.formatter_profile.as_ref() {
        let (path, profile_name, xml, sha256) =
            crate::commands::java_language::formatter_profile_payload(root, profile)?;
        params["formatterProfile"] = json!({"path":path,"profileName":profile_name,"xml":xml});
        Some((path, profile_name, sha256))
    } else {
        None
    };
    if let Some(selection) = selection {
        params["javaEditorSelection"] = selection["selection"].clone();
    } else {
        params["symbol"] = json!(request.document.path);
    }
    if mutating {
        params["editorMutationMode"] = json!("durable-editor-owned");
    }
    let raw = session_call_detailed(session, "refactor.editor.preview", params, REQUEST_TIMEOUT)
        .map_err(|error| {
            super::java_project_context::trace_snapshot(
                "java.editor.preview.refused",
                json!({"kind": format!("{:?}", error.kind), "rpcCode": error.rpc_code, "message": error.rpc_message}),
            );
            const REFUSAL: &str = "RefactorKit refused this Java draft preview.";
            match (error.kind, error.rpc_code, error.rpc_message.as_deref()) {
                (SessionCallErrorKind::Rejected, Some(-32001), Some(reason)) => {
                    format!("{REFUSAL} {reason}")
                }
                _ => format!("{REFUSAL} Check compilation diagnostics and the selected project context before trying again."),
            }
        })?;
    if raw["schemaVersion"] != "java-editor-refactoring-v1"
        || raw["status"] != "preview"
        || raw["editOwnership"] != "editor"
        || raw["applyAvailable"] != mutating
        || (mutating && raw["editorMutationMode"] != "durable-editor-owned")
        || raw["requiresUserApproval"] != true
        || raw["operation"] != provider_operation
        || raw["baseSnapshotHash"] != context.snapshot_hash
        || raw["contextHash"] != context.context_hash
        || raw["contextSchemaVersion"].as_str() != Some(context.context_schema_version.as_str())
        || raw["platformIdentities"] != json!(context.platform_identities)
        || raw["sourceAuthority"]["kind"] != "immutable-editor-overlay"
        || raw["sourceAuthority"]["baseSnapshotHash"] != context.snapshot_hash
        || !hash(&raw["sourceAuthority"]["overlayHash"])
        || !hash(&raw["providerSnapshotHash"])
        || selection.is_some_and(|selected| {
            raw["sourceAuthority"] != selected["sourceAuthority"]
                || raw["providerSnapshotHash"] != selected["providerSnapshotHash"]
                || raw["selectionHash"] != selected["selection"]["selectorHash"]
        })
        || !hash(&raw["planHash"])
        || !hash(&raw["expectedProviderSnapshotHash"])
        || !raw["diffTruncated"].is_boolean()
        || !raw["diagnosticsTruncated"].is_boolean()
    {
        return Err("RefactorKit did not attest the reviewed Java draft plan.".into());
    }
    match formatter_profile.as_ref() {
        Some((path, profile_name, sha256))
            if raw["formatterProfilePath"].as_str() == Some(path.as_str())
                && raw["formatterProfileName"].as_str() == Some(profile_name.as_str())
                && raw["formatterProfileSha256"].as_str() == Some(sha256.as_str()) => {}
        Some(_) => {
            return Err("RefactorKit did not attest the selected Eclipse formatter profile.".into())
        }
        None if !raw["formatterProfilePath"].is_null()
            || !raw["formatterProfileName"].is_null()
            || !raw["formatterProfileSha256"].is_null() =>
        {
            return Err(
                "RefactorKit returned an unexpected Eclipse formatter profile attestation.".into(),
            )
        }
        None => {}
    }
    let receipts = raw["sourceAuthority"]["documents"]
        .as_array()
        .ok_or("Missing Java draft document receipts.")?;
    if receipts.len() != overlay.documents.len()
        || overlay.documents.iter().any(|d| {
            receipts
                .iter()
                .filter(|r| {
                    r["path"] == d.path
                        && r["version"] == d.version
                        && r["contentSha256"] == digest(d.text.as_bytes())
                })
                .count()
                != 1
        })
    {
        return Err("Stale Java draft document receipts.".into());
    }
    let prefix = if context.project_path.is_empty() {
        String::new()
    } else {
        format!("{}/", context.project_path)
    };
    let mut files = Vec::new();
    let changes = raw["workspaceEdit"]["documentChanges"]
        .as_array()
        .filter(|v| v.len() <= 1024)
        .ok_or("Invalid Java editor changes.")?;
    let mut edit_bytes = 0usize;
    let mut edited_paths = std::collections::HashSet::new();
    for change in changes {
        if change["kind"] == "rename" {
            if change["options"]["overwrite"] != false
                || change["options"]["ignoreIfExists"] != false
            {
                return Err("Java rename must refuse overwrite.".into());
            }
            let old = uri_path(&change["oldUri"], root, true)?;
            let new = uri_path(&change["newUri"], root, false)?;
            if !overlay.documents.iter().any(|d| d.path == old) {
                return Err("Uncaptured Java rename source.".into());
            }
            if root.join(&new).exists() {
                return Err("Java rename destination already exists.".into());
            }
            files.push(json!({"path":format!("{prefix}{new}"),"previousPath":format!("{prefix}{old}"),"change":"move","primary":false}));
        } else {
            if !change["kind"].is_null() {
                return Err("Unsupported Java editor file operation.".into());
            }
            let path = uri_path(&change["textDocument"]["uri"], root, true)?;
            if !edited_paths.insert(path.clone()) {
                return Err(
                    "Repeated Java text-document edits require a new versioned plan.".into(),
                );
            }
            let document = overlay
                .documents
                .iter()
                .find(|d| d.path == path)
                .ok_or("Uncaptured Java edit source.")?;
            if change["textDocument"]["version"] != document.version {
                return Err("Stale Java edit version.".into());
            }
            let edits = change["edits"]
                .as_array()
                .filter(|v| v.len() <= 4096)
                .ok_or("Invalid Java text edits.")?;
            let mut ranges = Vec::new();
            for edit in edits {
                let start = point(&edit["range"]["start"])?;
                let end = point(&edit["range"]["end"])?;
                if !valid_position(&document.text, &start)
                    || !valid_position(&document.text, &end)
                    || (start.line, start.character) > (end.line, end.character)
                {
                    return Err("Invalid Java text edit range.".into());
                }
                ranges.push(((start.line, start.character), (end.line, end.character)));
                edit_bytes += text(&edit["newText"], 8 * 1024 * 1024)?.len();
            }
            ranges.sort();
            if ranges.windows(2).any(|v| v[0].1 > v[1].0) || edit_bytes > 8 * 1024 * 1024 {
                return Err("Overlapping or oversized Java text edits.".into());
            }
            files.push(json!({"path":format!("{prefix}{path}"),"change":"edit","primary":false}));
        }
    }
    if matches!(
        spec.operation,
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports
    ) && files
        .iter()
        .any(|f| f["change"] != "edit" || f["path"] != spec.target.path)
    {
        return Err("Java file preview affected another source.".into());
    }
    let mut documents = raw["sourceAuthority"]["documents"].clone();
    for document in documents.as_array_mut().unwrap() {
        document["path"] = json!(format!("{prefix}{}", document["path"].as_str().unwrap()));
    }
    let mut diagnostics = Vec::new();
    for item in raw["diagnosticsAfterPreview"]
        .as_array()
        .filter(|v| v.len() <= 500)
        .ok_or("Invalid Java diagnostics.")?
    {
        let severity = text(&item["severity"], 32)?.to_ascii_lowercase();
        if !matches!(severity.as_str(), "error" | "warning" | "info") {
            return Err("Invalid Java diagnostic severity.".into());
        }
        let mut diagnostic = json!({"severity":severity,"message":text(&item["message"],16384)?});
        if let Some(path) = item["path"].as_str() {
            super::path_policy::safe_path(path, root)?;
            diagnostic["path"] = json!(format!("{prefix}{path}"));
        }
        diagnostics.push(diagnostic);
    }
    let diff = text(&raw["renderedDiff"], 512 * 1024)?;
    if !files.is_empty() && diff.trim().is_empty() {
        return Err("Missing Java draft preview diff.".into());
    }
    let mut warnings = strings(&raw["warnings"])?;
    if raw["diagnosticsTruncated"] == true {
        warnings.push("Provider diagnostics are truncated.".into());
    }
    let mut normalized = json!({"planId":text(&raw["planId"],256)?,"operation":spec.operation,"target":spec.target,
        "status":"ready","summary":text(&raw["summary"],16384)?,"confidence":0.0,"riskLevel":text(&raw["riskLevel"],32)?.to_ascii_lowercase(),
        "risks":[],"evidence":[{"kind":"compiler","summary":text(&raw["evidence"],4096)?}],"affectedFiles":files,
        "renderedDiff":diff,"diffTruncated":raw["diffTruncated"],"diffTruncationReasons":strings(&raw["diffTruncationReasons"])?,
        "structuredDiff":[],"warnings":warnings,"diagnosticsAfterPreview":diagnostics,"conflicts":[],"refusalReasons":[],
        "applyEligibility":{"eligible":mutating && raw["diffTruncated"]==false,"blockers":if mutating && raw["diffTruncated"]==false {json!([])} else {json!(["Editor mutation is unavailable or the reviewed diff is incomplete."])}},
        "staleness":{"stale":false,"reasons":[]},"grantsApplyAuthority":false,
        "authority":{"workspaceId":request.workspace_id,"workspaceGeneration":request.generation},"selectionGeneration":spec.selection_generation,"requestId":request.request_id,
        "provider":"RefactorKit","providerVersion":version,"indexGeneration":selection.map(|s|s["indexGeneration"].clone()).unwrap_or(json!(generation)),
        "projectContext":{"projectPath":context.project_path,"contextHash":context.context_hash,"contextSchemaVersion":context.context_schema_version,"platformIdentities":context.platform_identities},
        "editorPreview":{"mutationMode":if mutating {json!("durable-editor-owned")} else {Value::Null},"symbolId":selection.map(|s|s["selection"]["selection"]["symbolId"].clone()),"planHash":raw["planHash"],"selectionHash":raw["selectionHash"],"baseSnapshotHash":context.snapshot_hash,
            "providerSnapshotHash":raw["providerSnapshotHash"],"expectedProviderSnapshotHash":raw["expectedProviderSnapshotHash"],"overlayHash":raw["sourceAuthority"]["overlayHash"],"documents":documents}
    });
    if let Some((path, profile_name, sha256)) = formatter_profile {
        normalized["formatterProfilePath"] = json!(path);
        normalized["formatterProfileName"] = json!(profile_name);
        normalized["formatterProfileSha256"] = json!(sha256);
    }
    Ok(normalized)
}
