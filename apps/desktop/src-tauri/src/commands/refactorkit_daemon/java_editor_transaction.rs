//! Editor-owned transaction protocol and guarded saved-byte renames. No buffer autosave.
use super::java_navigation::{Document, ProjectContext};
use super::java_project_context::{with_workspace_session, Active, JavaProjectContextState};
use super::transport::{session_call_detailed, REQUEST_TIMEOUT};
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, with_root_activation,
    CurrentWorkspaceBinding,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    workspace_id: String,
    generation: u64,
    phase: String,
    project_context: ProjectContext,
    plan_id: Option<String>,
    approved_plan_hash: Option<String>,
    formatter_profile: Option<crate::commands::java_language::JavaLanguageFormatterProfile>,
    formatter_profile_sha256: Option<String>,
    transaction_id: Option<String>,
    documents: Vec<Document>,
}
pub(super) struct Pending {
    snapshot: String,
    renames: Vec<(String, String, Vec<u8>)>,
    completed: bool,
    authority: Value,
}
pub(super) fn mutation_offered(
    session: &mut super::transport::Session,
    operation: &str,
) -> Result<bool, String> {
    let capabilities = super::transport::session_call_detailed(
        session,
        "server.capabilities",
        json!({}),
        REQUEST_TIMEOUT,
    )
    .map_err(|_| "Editor mutation capability discovery failed.")?;
    Ok(
        capabilities["javaContextRefactoring"]["dirtyEditorMutationAuthority"] == true
            && capabilities["javaContextRefactoring"]["durableEditorRecovery"] == true
            && capabilities["javaContextRefactoring"]["editorMutationOperations"]
                .as_array()
                .is_some_and(|ops| ops.iter().any(|op| op == operation))
            && capabilities["methods"].as_array().is_some_and(|methods| {
                methods.iter().any(|m| {
                    m["name"] == "refactor.editor.preview"
                        && m["features"]["durableEditorMutationMode"] == true
                })
            }),
    )
}
fn hash(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}
fn text(v: &Value, max: usize) -> Result<&str, String> {
    v.as_str()
        .filter(|s| !s.is_empty() && s.len() <= max && !s.contains('\0'))
        .ok_or_else(|| "Invalid Java editor transaction response.".into())
}
fn prefix(context: &ProjectContext) -> String {
    if context.project_path.is_empty() {
        String::new()
    } else {
        format!("{}/", context.project_path)
    }
}
fn documents(request: &Request, root: &Path) -> Result<Vec<Value>, String> {
    let prefix = prefix(&request.project_context);
    let mut paths = std::collections::HashSet::new();
    let mut bytes = 0;
    if request.documents.is_empty() || request.documents.len() > 128 {
        return Err("Capture all affected Java editor documents.".into());
    }
    request
        .documents
        .iter()
        .map(|d| {
            let path = d
                .path
                .strip_prefix(&prefix)
                .ok_or("Editor document is outside the selected Java project.")?;
            super::path_policy::safe_path(path, root)?;
            bytes += d.text.len();
            if !path.ends_with(".java")
                || !paths.insert(path.to_string())
                || d.version == 0
                || d.version > 2147483647
                || d.text.len() > 1024 * 1024
                || bytes > 8 * 1024 * 1024
            {
                return Err("Invalid or oversized Java editor documents.".into());
            }
            Ok(json!({"path":path,"content":d.text,"version":d.version}))
        })
        .collect()
}
fn rpc(active: &mut Active, method: &str, params: Value) -> Result<Value, String> {
    session_call_detailed(&mut active.session,method,params,REQUEST_TIMEOUT).map_err(|_|"The Java editor transaction was refused or its acknowledgement is unknown; inspect recovery before retrying.".into())
}
fn snapshot(active: &mut Active) -> Result<String, String> {
    let r = rpc(active, "workspace.refresh", json!({}))?;
    if !matches!(r["status"].as_str(), Some("ready" | "unchanged")) || !hash(&r["snapshotHash"]) {
        return Err("Current saved Java source evidence is unavailable.".into());
    }
    let snapshot = r["snapshotHash"].as_str().unwrap();
    let generation = r["generation"]
        .as_u64()
        .ok_or("Missing saved Java index generation.")?;
    super::java_project_context::refresh_saved_authority(active, snapshot, generation);
    Ok(snapshot.into())
}
fn offered(active: &Active, phase: &str) -> bool {
    let c = &active.capabilities;
    c["javaContextRefactoring"]["dirtyEditorMutationAuthority"] == true
        && c["javaContextRefactoring"]["durableEditorRecovery"] == true
        && c["javaContextRefactoring"]["editorTransactionSchemaVersion"]
            == "java-editor-transaction-v1"
        && c["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|m| {
                m["name"] == format!("refactor.editor.{phase}")
                    && m["requiresProject"] == true
                    && m["writesWorkspace"] == false
                    && m["features"][if phase == "transactions" {
                        "durableDiscovery"
                    } else {
                        "durableRecovery"
                    }] == true
            })
        })
}
fn normalize(
    raw: &Value,
    request: &Request,
    current: &str,
    root: &Path,
) -> Result<(Value, Option<Pending>), String> {
    let context = &request.project_context;
    let pref = prefix(context);
    if raw["schemaVersion"] != "java-editor-transaction-v1"
        || raw["editOwnership"] != "editor"
        || raw["durableRecoveryAvailable"] != true
        || !matches!(
            raw["status"].as_str(),
            Some(
                "prepared"
                    | "applied"
                    | "undo-prepared"
                    | "undone"
                    | "aborted"
                    | "recovery-required"
            )
        )
        || raw["approvedPlanHash"] != json!(request.approved_plan_hash)
        || raw["baseSnapshotHash"] != context.snapshot_hash
        || raw["contextHash"] != context.context_hash
        || raw["platformIdentities"] != json!(context.platform_identities)
        || request
            .transaction_id
            .as_ref()
            .is_some_and(|id| raw["transactionId"] != *id)
        || request
            .plan_id
            .as_ref()
            .is_some_and(|id| raw["planId"] != *id)
    {
        return Err(
            "The editor transaction did not attest its original approved Java authority.".into(),
        );
    }
    let transaction_id = text(&raw["transactionId"], 256)?;
    let _ = uuid::Uuid::parse_str(transaction_id)
        .map_err(|_| "Invalid Java editor transaction identity.")?;
    let mut result = json!({"transactionId":transaction_id,"planId":text(&raw["planId"],256)?,"approvedPlanHash":raw["approvedPlanHash"],"baseSnapshotHash":raw["baseSnapshotHash"],
        "contextHash":raw["contextHash"],"platformIdentities":raw["platformIdentities"],"durableRecoveryAvailable":true,"status":raw["status"]});
    if raw["status"] == "recovery-required" {
        if raw.get("workspaceEdit").is_some() {
            return Err("Recovery cannot overwrite unknown editor changes.".into());
        }
        result["refusalCode"] = json!(text(&raw["refusalCode"], 256)?);
        return Ok((result, None));
    }
    if !matches!(raw["status"].as_str(), Some("prepared" | "undo-prepared")) {
        return Ok((result, None));
    }
    if !hash(&raw["proposalHash"])
        || !hash(&raw["expectedProviderSnapshotHash"])
        || raw["sourceAuthority"]["kind"] != "immutable-editor-overlay"
        || raw["sourceAuthority"]["baseSnapshotHash"] != current
        || !hash(&raw["sourceAuthority"]["overlayHash"])
    {
        return Err("Missing versioned editor proposal authority.".into());
    }
    let docs = documents(request, root)?;
    let receipts = raw["sourceAuthority"]["documents"]
        .as_array()
        .ok_or("Missing editor proposal document evidence.")?;
    if receipts.len() != docs.len()
        || docs.iter().any(|d| {
            receipts
                .iter()
                .filter(|r| {
                    r["path"] == d["path"]
                        && r["version"] == d["version"]
                        && r["contentSha256"]
                            == super::java_navigation::digest(
                                d["content"].as_str().unwrap().as_bytes(),
                            )
                })
                .count()
                != 1
        })
    {
        return Err("The editor proposal used different captured buffers.".into());
    }
    let mut normalized = Vec::new();
    let mut renames = Vec::new();
    for change in raw["workspaceEdit"]["documentChanges"]
        .as_array()
        .filter(|a| a.len() <= 1024)
        .ok_or("Invalid editor workspace edit.")?
    {
        if change["kind"] == "rename" {
            if change["options"]["overwrite"] != false
                || change["options"]["ignoreIfExists"] != false
            {
                return Err("Editor file renames must refuse overwrite.".into());
            }
            let old = super::java_editor_refactoring::uri_path(&change["oldUri"], root, true)?;
            let new = super::java_editor_refactoring::uri_path(&change["newUri"], root, false)?;
            if root.join(&new).exists() {
                return Err("Editor rename destination already exists.".into());
            }
            let bytes = std::fs::read(root.join(&old))
                .map_err(|_| "Editor rename source is unavailable.")?;
            if bytes.len() > 1024 * 1024 {
                return Err("Editor rename source exceeds its limit.".into());
            }
            renames.push((old.clone(), new.clone(), bytes));
            normalized.push(json!({"kind":"rename","oldPath":format!("{pref}{old}"),"path":format!("{pref}{new}")}));
        } else {
            if !change["kind"].is_null() {
                return Err("Unsupported editor file operation.".into());
            }
            let path = super::java_editor_refactoring::uri_path(
                &change["textDocument"]["uri"],
                root,
                false,
            )?;
            if change["textDocument"]["version"]
                .as_u64()
                .is_none_or(|v| v == 0 || v > 2147483647)
            {
                return Err("Invalid editor edit version.")?;
            }
            let edits = change["edits"]
                .as_array()
                .filter(|a| a.len() <= 4096)
                .ok_or("Invalid editor text edits.")?;
            for edit in edits {
                super::java_navigation::point(&edit["range"]["start"])?;
                super::java_navigation::point(&edit["range"]["end"])?;
                if edit["newText"]
                    .as_str()
                    .is_none_or(|s| s.len() > 8 * 1024 * 1024)
                {
                    return Err("Invalid editor replacement text.".into());
                }
            }
            normalized.push(json!({"kind":"edit","path":format!("{pref}{path}"),"version":change["textDocument"]["version"],"edits":edits}));
        }
    }
    let mut authority = raw["sourceAuthority"].clone();
    for d in authority["documents"].as_array_mut().unwrap() {
        d["path"] = json!(format!("{pref}{}", d["path"].as_str().unwrap()));
    }
    authority.as_object_mut().unwrap().remove("kind");
    result["sourceAuthority"] = authority;
    result["workspaceEdit"] = json!({"documentChanges":normalized});
    Ok((
        result,
        Some(Pending {
            snapshot: current.into(),
            renames,
            completed: false,
            authority: json!({"context":request.project_context,"planId":raw["planId"],"approvedPlanHash":request.approved_plan_hash,"documents":request.documents}),
        }),
    ))
}
fn rename_no_replace(old: &Path, new: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::ffi::OsStrExt;
        let old = std::ffi::CString::new(old.as_os_str().as_bytes())
            .map_err(|_| "Invalid rename path.")?;
        let new = std::ffi::CString::new(new.as_os_str().as_bytes())
            .map_err(|_| "Invalid rename path.")?;
        if unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                old.as_ptr(),
                libc::AT_FDCWD,
                new.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        } != 0
        {
            return Err(
                "The saved-source rename failed; inspect transaction recovery before retrying."
                    .into(),
            );
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (old, new);
        Err("Guarded Java source rename is unavailable on this platform.".into())
    }
}
fn call(
    binding: CurrentWorkspaceBinding,
    request: Request,
    state: std::sync::Arc<super::java_project_context::Manager>,
) -> Result<Value, String> {
    let settings = serde_json::to_value(&request.project_context)
        .map_err(|_| "Invalid Java transaction settings.")?;
    validate_request(&request)?;
    let mut result = with_workspace_session(
        &state,
        &binding,
        request.generation,
        &settings,
        |active| {
            let root = active.session.root.clone();
            if request.phase == "apply-files" {
                let id = request
                    .transaction_id
                    .as_ref()
                    .ok_or("Missing prepared editor transaction.")?;
                let pending = active
                    .editor_transactions
                    .get(id)
                    .ok_or("Prepare the editor transaction before moving its files.")?;
                if pending.authority
                    != json!({"context":request.project_context,"planId":request.plan_id,"approvedPlanHash":request.approved_plan_hash,"documents":request.documents})
                {
                    return Err("The prepared editor proposal or captured buffers changed.".into());
                }
                if pending.completed {
                    return Err("Editor file changes were already applied.")?;
                }
                let expected = pending.snapshot.clone();
                if snapshot(active)? != expected {
                    return Err("Saved Java sources changed after preparation.".into());
                }
                let pending = active.editor_transactions.get_mut(id).unwrap();
                return with_root_activation(|| {
                    if !current_workspace_binding_is_current(&binding) {
                        return Err("The editor transaction workspace changed.")?;
                    }
                    for (old, new, bytes) in &pending.renames {
                        super::path_policy::safe_path(old, &root)?;
                        super::path_policy::safe_path(new, &root)?;
                        if std::fs::read(root.join(old)).ok().as_ref() != Some(bytes)
                            || root.join(new).exists()
                        {
                            return Err("Saved bytes or rename destinations changed; no overwrite is permitted.".into());
                        }
                    }
                    let mut disk_sources = Vec::new();
                    for (old, new, bytes) in &pending.renames {
                        rename_no_replace(&root.join(old), &root.join(new))?;
                        if std::fs::read(root.join(new)).ok().as_ref() != Some(bytes) {
                            return Err(
                                "The rename outcome requires recovery because saved bytes changed."
                                    .into(),
                            );
                        }
                        disk_sources.push(json!({"oldPath":format!("{}{old}",prefix(&request.project_context)),"path":format!("{}{new}",prefix(&request.project_context)),"revision":super::java_navigation::digest(bytes)}));
                    }
                    pending.completed = true;
                    Ok(
                        json!({"kind":"files-applied","transactionId":id,"diskSources":disk_sources}),
                    )
                });
            }
            if !offered(active, &request.phase) {
                return Err("RefactorKit does not advertise durable editor transactions.".into());
            }
            if request.phase == "transactions" {
                let raw = rpc(active, "refactor.editor.transactions", json!({}))?;
                if raw["schemaVersion"] != "java-editor-transactions-v1"
                    || raw["transactions"].as_array().is_none_or(|a| a.len() > 16)
                {
                    return Err("Invalid editor transaction discovery.".into());
                }
                let mut entries = raw["transactions"].clone();
                for e in entries.as_array_mut().unwrap() {
                    text(&e["transactionId"], 256)?;
                    text(&e["planId"], 256)?;
                    text(&e["sdkHome"], 4096)?;
                    if !hash(&e["approvedPlanHash"])
                        || !hash(&e["baseSnapshotHash"])
                        || !hash(&e["contextHash"])
                    {
                        return Err("Invalid discovered editor authority.".into());
                    }
                    e["durableRecoveryAvailable"] = json!(true);
                    if let Some(documents) = e.get_mut("documents") {
                        let documents = documents
                            .as_array_mut()
                            .filter(|a| !a.is_empty() && a.len() <= 128)
                            .ok_or("Invalid discovered editor documents.")?;
                        let mut originals = std::collections::HashSet::new();
                        let mut finals = std::collections::HashSet::new();
                        let pref = prefix(&request.project_context);
                        for document in documents {
                            let original = super::path_policy::safe_path(
                                text(&document["originalPath"], 4096)?,
                                &root,
                            )?;
                            let final_path = super::path_policy::safe_path(
                                text(&document["finalPath"], 4096)?,
                                &root,
                            )?;
                            if !original.ends_with(".java")
                                || !final_path.ends_with(".java")
                                || !originals.insert(original.clone())
                                || !finals.insert(final_path.clone())
                                || !hash(&document["originalSavedContentSha256"])
                            {
                                return Err("Invalid discovered editor document lineage.".into());
                            }
                            document["originalPath"] = json!(format!("{pref}{original}"));
                            document["finalPath"] = json!(format!("{pref}{final_path}"));
                        }
                    }
                }
                return Ok(json!({"kind":"discovery","transactions":entries}));
            }
            if request
                .approved_plan_hash
                .as_ref()
                .is_none_or(|h| !hash(&json!(h)))
                || request.documents.is_empty()
            {
                return Err(
                    "Approve the exact retained editor plan and capture current buffers.".into(),
                );
            }
            match (
                request.formatter_profile.as_ref(),
                request.formatter_profile_sha256.as_deref(),
            ) {
                (None, None) => {}
                (Some(profile), Some(expected))
                    if matches!(request.phase.as_str(), "prepare" | "confirm") =>
                {
                    let (_, _, _, current) =
                        crate::commands::java_language::formatter_profile_payload(&root, profile)?;
                    if !hash(&json!(expected)) || current != expected {
                        return Err("The selected Eclipse formatter profile changed after preview.".into());
                    }
                }
                _ => return Err("The editor transaction requires the exact approved Eclipse formatter profile.".into()),
            }
            if request.phase == "prepare" {
                let id = request
                    .plan_id
                    .as_deref()
                    .ok_or("Missing reviewed editor plan.")?;
                let review = active
                    .editor_reviews
                    .get(id)
                    .ok_or("Review this plan in durable editor mode before applying it.")?;
                if review["context"] != settings
                    || review["planHash"] != json!(request.approved_plan_hash)
                {
                    return Err("The reviewed editor plan authority changed.".into());
                }
            }
            let current = snapshot(active)?;
            let docs = documents(&request, &root)?;
            let mut params = json!({"languageId":"java","approvedPlanHash":request.approved_plan_hash,"expectedSnapshotHash":current,
            "javaContext":super::java_navigation::java_context_authority(&request.project_context, Path::new(&request.project_context.sdk_home)),"sourceAuthority":{"kind":"immutable-editor-overlay","documents":docs}});
            if let Some(hash) = request.formatter_profile_sha256.as_ref() {
                params["formatterProfileSha256"] = json!(hash);
            }
            if let Some(id) = &request.plan_id {
                params["planId"] = json!(id);
            }
            if let Some(id) = &request.transaction_id {
                params["transactionId"] = json!(id);
            }
            let raw = rpc(
                active,
                &format!("refactor.editor.{}", request.phase),
                params,
            )?;
            let (result, pending) = normalize(&raw, &request, &current, &root)?;
            if let Some(pending) = pending {
                if active.editor_transactions.len() >= 16
                    && !active
                        .editor_transactions
                        .contains_key(result["transactionId"].as_str().unwrap())
                {
                    return Err(
                    "Editor transaction retention limit reached; recover pending changes first."
                        .into(),
                );
                }
                active
                    .editor_transactions
                    .insert(result["transactionId"].as_str().unwrap().into(), pending);
            }
            if matches!(
                result["status"].as_str(),
                Some("applied" | "undone" | "aborted")
            ) {
                active
                    .editor_transactions
                    .remove(result["transactionId"].as_str().unwrap());
            }
            Ok(json!({"kind":"transaction","transaction":result}))
        },
    )?;
    result["workspaceId"] = json!(request.workspace_id);
    result["generation"] = json!(request.generation);
    result["phase"] = json!(request.phase);
    Ok(result)
}
fn validate_request(request: &Request) -> Result<(), String> {
    let context = &request.project_context;
    if !matches!(
        request.phase.as_str(),
        "prepare"
            | "confirm"
            | "undo.prepare"
            | "undo.confirm"
            | "recover"
            | "transactions"
            | "apply-files"
    ) || request.generation == 0
        || request.generation > 9_007_199_254_740_991
        || !super::java_project_context::valid_context_schema_version(
            &context.context_schema_version,
        )
        || !hash(&json!(context.snapshot_hash))
        || !hash(&json!(context.context_hash))
        || context.platform_identities.is_empty()
        || context.platform_identities.len() > 128
        || context.platform_identities.iter().any(|s| !hash(&json!(s)))
        || text(&json!(request.workspace_id), 256).is_err()
        || text(&json!(context.sdk_home), 4096).is_err()
        || request
            .plan_id
            .as_ref()
            .is_some_and(|id| text(&json!(id), 256).is_err())
        || request
            .transaction_id
            .as_ref()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
        || (request.phase != "transactions"
            && request
                .approved_plan_hash
                .as_ref()
                .is_none_or(|s| !hash(&json!(s))))
        || (request.phase == "prepare" && request.plan_id.is_none())
        || (!matches!(request.phase.as_str(), "transactions" | "prepare")
            && request.transaction_id.is_none())
    {
        return Err("Invalid Java editor transaction authority.".into());
    }
    Ok(())
}
pub(super) fn prepare(
    request: Request,
    state: &JavaProjectContextState,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    if !matches!(
        request.phase.as_str(),
        "prepare"
            | "confirm"
            | "undo.prepare"
            | "undo.confirm"
            | "recover"
            | "transactions"
            | "apply-files"
    ) || request.generation == 0
        || request.generation > 9_007_199_254_740_991
    {
        return Err("Invalid Java editor transaction phase or authority.".into());
    }
    let binding = current_workspace_binding_at(
        &crate::workspace::workspace_root()?,
        &crate::app_config::workspace_registry_path()?,
    )?;
    if binding.workspace_id != request.workspace_id {
        return Err("The Java editor transaction workspace changed.")?;
    }
    let state = state.shared();
    Ok(move || call(binding, request, state))
}

#[cfg(test)]
pub(super) fn call_at(
    binding: CurrentWorkspaceBinding,
    request: Request,
    state: &JavaProjectContextState,
) -> Result<Value, String> {
    call(binding, request, state.shared())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_transactions_accept_v3_and_refuse_unknown_project_context_schemas() {
        let request: Request = serde_json::from_value(json!({
            "workspaceId": "workspace",
            "generation": 1,
            "phase": "transactions",
            "projectContext": {
                "projectPath": "",
                "sdkHome": "/jdk",
                "mavenRepository": "",
                "activeMavenProfiles": [],
                "inactiveMavenProfiles": [],
                "snapshotHash": "a".repeat(64),
                "contextHash": "b".repeat(64),
                "contextSchemaVersion": "java-project-context-v3",
                "platformIdentities": ["c".repeat(64)]
            },
            "documents": []
        }))
        .unwrap();
        assert!(validate_request(&request).is_ok());
        let mut unsupported = request;
        unsupported.project_context.context_schema_version = "java-project-context-v4".into();
        assert!(validate_request(&unsupported).is_ok());
    }
}
