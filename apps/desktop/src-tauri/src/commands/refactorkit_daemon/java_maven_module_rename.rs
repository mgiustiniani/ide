//! Provider-owned Maven module rename preview, Apply, and rollback.

use std::path::Path;

use serde_json::{json, Value};

use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current,
};

use super::application::{has_retained_plan_id, RefactorKitDaemonState};
use super::contract::{
    approval_matches, bounded_multiline, bounded_string, normalize_files, protocol_id_field,
    record_field, required_string, string_array, validate_id, DiscardRequest,
    MavenModuleRenameApplyRequest, MavenModuleRenamePreviewRequest,
    MavenModuleRenameRollbackRequest, PROTOCOL_FAILED,
};
use super::java_project_context::{reset, Active, JavaProjectContextState};
use super::path_policy::{require_generation, safe_path, validate_workspace};
use super::transport::{
    session_call_detailed, SessionCallError, SessionCallErrorKind, REQUEST_TIMEOUT,
};

const OPERATION: &str = "java.renameMavenModule";
const DESTINATION_REFUSED: &str = "mavenOwnership.destinationUnrecognized";

fn can_retry_preview_in_context(error: &SessionCallError) -> bool {
    error.kind == SessionCallErrorKind::Rejected
        && error.rpc_code == Some(-32001)
        && error.rpc_refusal_code.as_deref() == Some(DESTINATION_REFUSED)
}

fn preview_call_error(error: SessionCallError) -> String {
    if error.kind == SessionCallErrorKind::Rejected && error.rpc_code == Some(-32001) {
        match error.rpc_refusal_code.as_deref() {
            Some("mavenOwnership.descriptorUnavailable") => {
                return "RefactorKit could not verify the Maven reactor model for this rename. The workspace is unchanged.".into();
            }
            Some(DESTINATION_REFUSED) => {
                return concat!(
                    "RefactorKit refused the Maven module destination or artifact ID. ",
                    "Choose an unused module directory. ",
                    "Leave the artifact ID empty to keep it, or enter an unused ID for a direct-child rename."
                )
                .into();
            }
            _ => {}
        }
    }
    match error.kind {
        SessionCallErrorKind::Rejected => match error.rpc_code {
            Some(code) => format!(
                "RefactorKit rejected the Maven module rename preview (JSON-RPC error {code})."
            ),
            None => "RefactorKit rejected the Maven module rename preview.".into(),
        },
        SessionCallErrorKind::Session => {
            "The RefactorKit session failed or timed out during Maven module rename preview.".into()
        }
        SessionCallErrorKind::Protocol => {
            "RefactorKit returned an invalid response for Maven module rename preview.".into()
        }
        SessionCallErrorKind::RequestTooLarge => {
            "The Maven module rename preview request exceeds the allowed size.".into()
        }
    }
}

fn rollback_call_error(error: SessionCallError) -> String {
    if error.kind == SessionCallErrorKind::Rejected
        && error.rpc_code == Some(-32005)
        && error.rpc_refusal_code.as_deref() == Some("rollback.conflict")
    {
        return "Maven module rename rollback conflicts with the current workspace state.".into();
    }
    "RefactorKit could not roll back the Maven module rename.".into()
}

#[derive(Clone)]
pub(super) struct PlanGuard {
    workspace_id: String,
    workspace_generation: u64,
    selection_generation: u64,
    request_id: String,
    snapshot_hash: String,
    context_hash: String,
    session_id: u64,
}

#[derive(Clone)]
pub(super) struct TransactionGuard {
    workspace_id: String,
    workspace_generation: u64,
    session_id: u64,
}

pub(super) fn preview(
    request: MavenModuleRenamePreviewRequest,
    state: &JavaProjectContextState,
    daemon_state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let workspace_root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    let binding = current_workspace_binding_at(&workspace_root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The Java project workspace changed.".into());
    }
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    if !valid_hash(&request.expected_snapshot_hash) || !valid_hash(&request.expected_context_hash) {
        return Err("Synchronize the Java project again before previewing a rename.".into());
    }
    if let Some(artifact_id) = request.new_artifact_id.as_deref() {
        if artifact_id.trim() != artifact_id
            || artifact_id.is_empty()
            || artifact_id.len() > 256
            || artifact_id.chars().any(char::is_control)
        {
            return Err("Invalid Maven module artifact ID.".into());
        }
    }

    let mut active = state
        .0
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    let owned = active
        .as_mut()
        .ok_or("Synchronize the Java project before previewing a module rename.")?;
    validate_active_context(owned, &binding, &request)?;
    let project_root = owned.session.root.clone();
    let old_module_dir = safe_path(&request.old_module_dir, &project_root)?;
    let old_module = project_root
        .join(&old_module_dir)
        .canonicalize()
        .map_err(|_| "The selected Maven module directory is unavailable.")?;
    if !old_module.is_dir()
        || old_module.strip_prefix(&project_root).is_err()
        || !context_contains_module(owned.context.as_ref().unwrap(), &old_module_dir)
    {
        return Err("Select a module reported by the synchronized Maven project model.".into());
    }
    let new_module_dir = safe_path(&request.new_module_dir, &project_root)?;
    if old_module_dir == new_module_dir {
        return Err("Choose a different destination directory for the module.".into());
    }
    if !maven_module_rename_preview_offered(&owned.capabilities) {
        return Err(
            "RefactorKit does not advertise Maven module rename preview with a rendered diff."
                .into(),
        );
    }
    if (old_module_dir.contains('/') || new_module_dir.contains('/'))
        && !maven_module_rename_preview_method(&owned.capabilities)
            .is_some_and(|method| method["features"]["nestedModuleDirectoryMove"] == true)
    {
        return Err("This RefactorKit runtime supports Maven module renames between direct children of the reactor root.".into());
    }
    let project_relative_root = project_root
        .strip_prefix(&binding.canonical_root)
        .map_err(|_| "The selected Java project is outside the workspace.")?
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");

    let mut arguments = json!({
        "oldModuleDir": old_module_dir,
        "newModuleDir": new_module_dir,
    });
    if let Some(artifact_id) = request.new_artifact_id.as_ref() {
        arguments["newArtifactId"] = Value::String(artifact_id.clone());
    }
    let call = session_call_detailed(
        &mut owned.session,
        "refactor.preview",
        json!({
            "operation": "renameMavenModule",
            "languageId": "java",
            "arguments": arguments,
        }),
        REQUEST_TIMEOUT,
    );
    let session_id = owned.session_id;
    let raw = match call {
        Ok(value) => value,
        Err(error) => {
            // A refused destination has no plan or writes. Let the user correct their input
            // against the same snapshot. Other failures still invalidate the session.
            if !can_retry_preview_in_context(&error) {
                reset(&mut active);
            }
            return Err(preview_call_error(error));
        }
    };
    let normalized = match normalize_preview(
        raw,
        &project_root,
        &workspace_root,
        &project_relative_root,
        &request,
    ) {
        Ok(plan) => plan,
        Err(error) => {
            reset(&mut active);
            return Err(error);
        }
    };
    let plan_id = normalized["planId"]
        .as_str()
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?
        .to_string();
    let reserved_by_application =
        match has_retained_plan_id(daemon_state, &plan_id).and_then(|reserved| {
            if reserved {
                Ok(true)
            } else {
                super::java_context_refactoring::has_retained_plan_id(daemon_state, &plan_id)
            }
        }) {
            Ok(reserved) => reserved,
            Err(error) => {
                reset(&mut active);
                return Err(error);
            }
        };
    let owned = active
        .as_mut()
        .ok_or("The Java project context was retired during preview.")?;
    if let Err(error) = validate_active_context(owned, &binding, &request) {
        reset(&mut active);
        return Err(error);
    }
    if reserved_by_application || owned.maven_module_rename_plans.contains_key(&plan_id) {
        reset(&mut active);
        return Err(PROTOCOL_FAILED.to_string());
    }
    owned.maven_module_rename_plans.insert(
        plan_id,
        PlanGuard {
            workspace_id: request.workspace_id,
            workspace_generation: request.workspace_generation,
            selection_generation: request.selection_generation,
            request_id: request.request_id,
            snapshot_hash: request.expected_snapshot_hash,
            context_hash: request.expected_context_hash,
            session_id,
        },
    );
    Ok(normalized)
}

pub(super) fn discard(
    request: DiscardRequest,
    state: &JavaProjectContextState,
) -> Result<Value, String> {
    let workspace_root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    let binding = current_workspace_binding_at(&workspace_root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The Java project workspace changed.".into());
    }
    require_generation(request.selection_generation)?;
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    let mut active = state
        .0
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    let owned = active
        .as_mut()
        .ok_or("Maven module rename preview is stale or unknown.")?;
    let guard = owned
        .maven_module_rename_plans
        .get(&request.plan_id)
        .cloned()
        .ok_or("Maven module rename preview is stale or unknown.")?;
    if guard.workspace_id != request.workspace_id
        || guard.workspace_generation != request.workspace_generation
        || guard.selection_generation != request.selection_generation
        || guard.request_id != request.request_id
        || owned.binding != binding
        || owned.generation != request.workspace_generation
        || owned.session.workspace_id != request.workspace_id
        || owned.session.generation != request.workspace_generation
        || owned.session_id != guard.session_id
        || owned
            .session
            .child
            .try_wait()
            .map_err(|_| "The Java daemon is unavailable.")?
            .is_some()
    {
        return Err("Maven module rename preview discard authority changed.".into());
    }
    let raw = match session_call_detailed(
        &mut owned.session,
        "refactor.discard",
        json!({ "planId": request.plan_id }),
        REQUEST_TIMEOUT,
    ) {
        Ok(value) => value,
        Err(_) => {
            reset(&mut active);
            return Err("RefactorKit could not discard the Maven module rename preview.".into());
        }
    };
    let discarded = match (|| {
        let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        if required_string(object, "planId")? != request.plan_id {
            return Err(PROTOCOL_FAILED.to_string());
        }
        object
            .get("discarded")
            .and_then(Value::as_bool)
            .ok_or_else(|| PROTOCOL_FAILED.to_string())
    })() {
        Ok(discarded) => discarded,
        Err(error) => {
            reset(&mut active);
            return Err(error);
        }
    };
    let owned = active
        .as_mut()
        .ok_or("The Java project context changed during preview discard.")?;
    if !current_workspace_binding_is_current(&binding) {
        return Err("The workspace changed during preview discard.".into());
    }
    owned.maven_module_rename_plans.remove(&request.plan_id);
    Ok(json!({ "planId": request.plan_id, "discarded": discarded }))
}

pub(super) fn apply(
    request: MavenModuleRenameApplyRequest,
    state: &JavaProjectContextState,
    java_language: &crate::commands::java_language::JavaLanguageServiceState,
) -> Result<Value, String> {
    let workspace_root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    let binding = current_workspace_binding_at(&workspace_root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The Java project workspace changed.".into());
    }
    require_generation(request.selection_generation)?;
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    validate_id(&request.approval.approval_id)?;
    validate_id(&request.approval.approved_at)?;
    if !approval_matches(&request.approval, &request.plan_id) {
        return Err("Approval does not bind the requested Maven module rename plan.".into());
    }

    let mut active = state
        .0
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    let owned = active
        .as_mut()
        .ok_or("Synchronize the Java project before applying a module rename.")?;
    let guard = owned
        .maven_module_rename_plans
        .get(&request.plan_id)
        .cloned()
        .ok_or("Maven module rename preview is stale or unknown.")?;
    if guard.workspace_id != request.workspace_id
        || guard.workspace_generation != request.workspace_generation
        || guard.selection_generation != request.selection_generation
        || guard.request_id != request.request_id
        || owned.binding != binding
        || owned.generation != request.workspace_generation
        || owned.session.workspace_id != request.workspace_id
        || owned.session.generation != request.workspace_generation
        || owned.session_id != guard.session_id
        || owned
            .session
            .child
            .try_wait()
            .map_err(|_| "The Java daemon is unavailable.")?
            .is_some()
    {
        return Err("Maven module rename Apply authority changed.".into());
    }
    validate_plan_guard(owned, &binding, &guard)?;
    if !maven_module_rename_apply_offered(&owned.capabilities) {
        return Err(
            "RefactorKit does not advertise managed Maven module rename Apply and Rollback.".into(),
        );
    }

    let project_root = owned.session.root.clone();
    let project_relative_root = project_root
        .strip_prefix(&binding.canonical_root)
        .map_err(|_| "The selected Java project is outside the workspace.")?
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    let response = java_language.with_project_topology_paused(&request.workspace_id, || {
        session_call_detailed(
            &mut owned.session,
            "refactor.apply",
            json!({"planId": request.plan_id}),
            REQUEST_TIMEOUT,
        )
    })?;
    let raw = match response {
        Ok(value) => value,
        Err(_) => {
            reset(&mut active);
            return Err("Maven module rename Apply outcome is unknown; inspect the project before continuing.".into());
        }
    };
    let normalized = match normalize_apply(
        raw,
        &project_root,
        &workspace_root,
        &project_relative_root,
        &request.plan_id,
    ) {
        Ok(result) => result,
        Err(_) => {
            reset(&mut active);
            return Err("Maven module rename Apply returned an invalid result; inspect the project before continuing.".into());
        }
    };
    let transaction_id = normalized["transactionId"]
        .as_str()
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?
        .to_string();
    let owned = active
        .as_mut()
        .ok_or("The Java project context was retired during module rename Apply.")?;
    if !current_workspace_binding_is_current(&binding)
        || owned.session_id != guard.session_id
        || owned.binding != binding
    {
        reset(&mut active);
        return Err(
            "The Java workspace changed during Maven module rename Apply; inspect the project."
                .into(),
        );
    }
    owned.maven_module_rename_plans.remove(&request.plan_id);
    owned.maven_module_rename_transactions.insert(
        transaction_id,
        TransactionGuard {
            workspace_id: request.workspace_id,
            workspace_generation: request.workspace_generation,
            session_id: guard.session_id,
        },
    );
    owned.invalidate_project_context(true);
    Ok(normalized)
}

pub(super) fn rollback(
    request: MavenModuleRenameRollbackRequest,
    state: &JavaProjectContextState,
    java_language: &crate::commands::java_language::JavaLanguageServiceState,
) -> Result<Value, String> {
    let workspace_root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    let binding = current_workspace_binding_at(&workspace_root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The Java project workspace changed.".into());
    }
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let mut active = state
        .0
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    let owned = active
        .as_mut()
        .ok_or("Maven module rename rollback session is unavailable.")?;
    let guard = owned
        .maven_module_rename_transactions
        .get(&request.transaction_id)
        .cloned()
        .ok_or("Maven module rename transaction is stale or unknown.")?;
    if guard.workspace_id != request.workspace_id
        || guard.workspace_generation != request.workspace_generation
        || owned.binding != binding
        || owned.generation != request.workspace_generation
        || owned.session.workspace_id != request.workspace_id
        || owned.session.generation != request.workspace_generation
        || owned.session_id != guard.session_id
        || owned
            .session
            .child
            .try_wait()
            .map_err(|_| "The Java daemon is unavailable.")?
            .is_some()
    {
        return Err("Maven module rename rollback authority changed.".into());
    }
    let project_root = owned.session.root.clone();
    let project_relative_root = project_root
        .strip_prefix(&binding.canonical_root)
        .map_err(|_| "The selected Java project is outside the workspace.")?
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    let response = java_language.with_project_topology_paused(&request.workspace_id, || {
        session_call_detailed(
            &mut owned.session,
            "patch.rollback",
            json!({"transactionId": request.transaction_id}),
            REQUEST_TIMEOUT,
        )
    })?;
    let raw = match response {
        Ok(value) => value,
        Err(error) => return Err(rollback_call_error(error)),
    };
    let normalized = match normalize_rollback(
        raw,
        &project_root,
        &workspace_root,
        &project_relative_root,
        &request.transaction_id,
    ) {
        Ok(result) => result,
        Err(error) => {
            reset(&mut active);
            return Err(error);
        }
    };
    if normalized["rolledBack"] == true {
        let owned = active
            .as_mut()
            .ok_or("The Java project context was retired during module rename rollback.")?;
        if !current_workspace_binding_is_current(&binding)
            || owned.session_id != guard.session_id
            || owned.binding != binding
        {
            reset(&mut active);
            return Err("The Java workspace changed during Maven module rename rollback.".into());
        }
        owned
            .maven_module_rename_transactions
            .remove(&request.transaction_id);
        owned.invalidate_project_context(true);
    }
    Ok(normalized)
}

fn validate_plan_guard(
    active: &Active,
    binding: &crate::commands::workspace_registry::CurrentWorkspaceBinding,
    guard: &PlanGuard,
) -> Result<(), String> {
    let context = active
        .context
        .as_ref()
        .ok_or("Synchronize the Java project again before applying a module rename.")?;
    let opened_snapshot = active
        .opened
        .as_ref()
        .map(|(snapshot, _)| snapshot.as_str());
    if active.binding != *binding
        || active.generation != guard.workspace_generation
        || active.session.workspace_id != guard.workspace_id
        || active.session.generation != guard.workspace_generation
        || !current_workspace_binding_is_current(binding)
        || !maven_operation_context_matches(context, &guard.snapshot_hash, &guard.context_hash)
        || opened_snapshot != Some(guard.snapshot_hash.as_str())
    {
        return Err(
            "The synchronized Maven project context changed; discard and preview the rename again."
                .into(),
        );
    }
    Ok(())
}

fn maven_module_rename_apply_offered(capabilities: &Value) -> bool {
    maven_module_rename_preview_method(capabilities).is_some_and(|method| {
        method["features"]["apply"] == true && method["features"]["rollback"] == true
    })
}

fn normalize_apply(
    raw: Value,
    project_root: &Path,
    workspace_root: &Path,
    project_relative_root: &str,
    expected_plan: &str,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "status")? != "applied"
        || required_string(object, "planId")? != expected_plan
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let transaction_id = protocol_id_field(object, "transactionId")?;
    let snapshot_hash = required_string(object, "snapshotHash")?;
    if !valid_hash(snapshot_hash) {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let changed_files = normalize_changed_files(
        object.get("changedFiles"),
        project_root,
        workspace_root,
        project_relative_root,
    )?;
    let provider = record_field(object, "provider")?;
    Ok(json!({
        "status": "applied",
        "planId": expected_plan,
        "transactionId": transaction_id,
        "snapshotHash": snapshot_hash,
        "changedFiles": changed_files,
        "provider": bounded_string(provider, "name", 256)?,
        "providerVersion": bounded_string(provider, "version", 256)?
    }))
}

fn normalize_rollback(
    raw: Value,
    project_root: &Path,
    workspace_root: &Path,
    project_relative_root: &str,
    expected_transaction: &str,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "status")? != "rolledBack"
        || required_string(object, "transactionId")? != expected_transaction
        || object.get("rolledBack").and_then(Value::as_bool) != Some(true)
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let changed_files = normalize_changed_files(
        object.get("changedFiles"),
        project_root,
        workspace_root,
        project_relative_root,
    )?;
    Ok(json!({
        "transactionId": expected_transaction,
        "rolledBack": true,
        "changedFiles": changed_files
    }))
}

fn normalize_changed_files(
    value: Option<&Value>,
    project_root: &Path,
    workspace_root: &Path,
    project_relative_root: &str,
) -> Result<Vec<Value>, String> {
    let files = value
        .and_then(Value::as_array)
        .filter(|files| files.len() <= 512)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let qualified = files
        .iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            let mut item = item.clone();
            for field in ["path", "previousPath"] {
                if let Some(path) = object.get(field) {
                    if path.is_null() {
                        continue;
                    }
                    let path = path.as_str().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
                    let project_relative = safe_path(path, project_root)?;
                    let workspace_relative = if project_relative_root.is_empty() {
                        project_relative
                    } else {
                        format!("{project_relative_root}/{project_relative}")
                    };
                    item[field] = Value::String(safe_path(&workspace_relative, workspace_root)?);
                }
            }
            Ok(item)
        })
        .collect::<Result<Vec<_>, String>>()?;
    normalize_files(Some(&Value::Array(qualified)), workspace_root)
}

fn validate_active_context(
    active: &mut Active,
    binding: &crate::commands::workspace_registry::CurrentWorkspaceBinding,
    request: &MavenModuleRenamePreviewRequest,
) -> Result<(), String> {
    let context = active
        .context
        .as_ref()
        .ok_or("Synchronize the Java project before previewing a module rename.")?;
    let opened_snapshot = active
        .opened
        .as_ref()
        .map(|(snapshot, _)| snapshot.as_str());
    if active.binding != *binding
        || active.generation != request.workspace_generation
        || active.session.workspace_id != request.workspace_id
        || active.session.generation != request.workspace_generation
        || active
            .session
            .child
            .try_wait()
            .map_err(|_| "The Java daemon is unavailable.")?
            .is_some()
        || !current_workspace_binding_is_current(binding)
        || !maven_operation_context_matches(
            context,
            &request.expected_snapshot_hash,
            &request.expected_context_hash,
        )
        || opened_snapshot != Some(request.expected_snapshot_hash.as_str())
    {
        return Err(
            "The synchronized Maven project context changed; synchronize and retry.".into(),
        );
    }
    Ok(())
}

fn context_has_available_maven_model(context: &Value) -> bool {
    let Some(providers) = context["providers"].as_array() else {
        return false;
    };
    let matching: Vec<_> = providers
        .iter()
        .filter(|provider| provider["providerId"] == "maven-effective-v1")
        .collect();
    matching.len() == 1 && matching[0]["status"] == "available"
}

fn maven_operation_context_matches(
    context: &Value,
    expected_snapshot_hash: &str,
    expected_context_hash: &str,
) -> bool {
    matches!(context["status"].as_str(), Some("available" | "partial"))
        && context["snapshotHash"] == expected_snapshot_hash
        && context["contextHash"] == expected_context_hash
        && context_has_available_maven_model(context)
}

fn context_contains_module(context: &Value, module_root: &str) -> bool {
    context["modules"].as_array().is_some_and(|modules| {
        modules.iter().any(|module| {
            module["providerId"] == "maven-effective-v1" && module["root"] == module_root
        })
    })
}

fn maven_module_rename_preview_offered(capabilities: &Value) -> bool {
    maven_module_rename_preview_method(capabilities).is_some()
}

fn maven_module_rename_preview_method(capabilities: &Value) -> Option<&Value> {
    let mut matching = capabilities["methods"]
        .as_array()?
        .iter()
        .filter(|method| method["name"] == OPERATION);
    let method = matching.next()?;
    (matching.next().is_none()
        && matches!(
            method["stability"].as_str(),
            Some("experimental" | "preview" | "stable")
        )
        && method["requiresProject"] == true
        && method["writesWorkspace"] == false
        && method["features"]["preview"] == true
        && method["features"]["renderedDiff"] == true)
        .then_some(method)
}

fn normalize_preview(
    raw: Value,
    project_root: &Path,
    workspace_root: &Path,
    project_relative_root: &str,
    request: &MavenModuleRenamePreviewRequest,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "operation")? != OPERATION
        || required_string(object, "status")? != "PREVIEW"
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let plan_id = protocol_id_field(object, "planId")?;
    let summary = bounded_string(object, "summary", 512 * 1024)?;
    let rendered_diff = bounded_multiline(object.get("renderedDiff"), 2 * 1024 * 1024)?;
    let diff_truncated = object
        .get("diffTruncated")
        .and_then(Value::as_bool)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let reasons = string_array(object.get("diffTruncationReasons"))?;
    let affected_files = object
        .get("affectedFiles")
        .and_then(Value::as_array)
        .filter(|files| files.len() <= 512)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?
        .iter()
        .map(|path| {
            let path = path.as_str().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            let project_relative = safe_path(path, project_root)?;
            let workspace_relative = if project_relative_root.is_empty() {
                project_relative
            } else {
                format!("{project_relative_root}/{project_relative}")
            };
            safe_path(&workspace_relative, workspace_root)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let snapshot = record_field(object, "snapshot")?;
    let snapshot_hash = required_string(snapshot, "hash")?;
    if !valid_hash(snapshot_hash) || snapshot_hash != request.expected_snapshot_hash {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let provider = record_field(object, "provider")?;
    Ok(json!({
        "planId": plan_id,
        "operation": OPERATION,
        "status": "preview",
        "summary": summary,
        "snapshotHash": snapshot_hash,
        "affectedFiles": affected_files,
        "renderedDiff": rendered_diff,
        "diffTruncated": diff_truncated,
        "diffTruncationReasons": reasons,
        "provider": bounded_string(provider, "name", 256)?,
        "providerVersion": bounded_string(provider, "version", 256)?,
        "workspaceId": request.workspace_id,
        "workspaceGeneration": request.workspace_generation,
        "selectionGeneration": request.selection_generation,
        "requestId": request.request_id,
    }))
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maven_module_rename_accepts_partial_aggregate_with_current_maven_authority() {
        let mut context = json!({
            "status": "partial",
            "snapshotHash": "snapshot-1",
            "contextHash": "context-1",
            "providers": [{
                "providerId": "maven-effective-v1",
                "status": "available"
            }],
            "modules": [{
                "providerId": "maven-effective-v1",
                "root": "app"
            }]
        });
        assert!(maven_operation_context_matches(
            &context,
            "snapshot-1",
            "context-1"
        ));
        assert!(context_contains_module(&context, "app"));

        context["providers"][0]["status"] = json!("partial");
        assert!(!maven_operation_context_matches(
            &context,
            "snapshot-1",
            "context-1"
        ));
    }

    #[test]
    fn maven_module_rename_rejects_unavailable_or_stale_context() {
        let mut context = json!({
            "status": "available",
            "snapshotHash": "snapshot-1",
            "contextHash": "context-1",
            "providers": [{
                "providerId": "maven-effective-v1",
                "status": "available"
            }]
        });
        assert!(!maven_operation_context_matches(
            &context,
            "snapshot-2",
            "context-1"
        ));
        assert!(!maven_operation_context_matches(
            &context,
            "snapshot-1",
            "context-2"
        ));

        context["status"] = json!("unavailable");
        assert!(!maven_operation_context_matches(
            &context,
            "snapshot-1",
            "context-1"
        ));
    }

    #[test]
    fn reports_the_maven_preview_failure_category_without_disclosing_raw_provider_data() {
        assert_eq!(
            preview_call_error(SessionCallError {
                kind: SessionCallErrorKind::Rejected,
                rpc_code: Some(-32001),
                rpc_message: Some("Refused destination at /provider/internal/path".into()),
                rpc_refusal_code: Some("mavenOwnership.destinationUnrecognized".into()),
            }),
            concat!(
                "RefactorKit refused the Maven module destination or artifact ID. ",
                "Choose an unused module directory. ",
                "Leave the artifact ID empty to keep it, or enter an unused ID for a direct-child rename."
            )
        );
        assert_eq!(
            preview_call_error(SessionCallError {
                kind: SessionCallErrorKind::Rejected,
                rpc_code: Some(-32001),
                rpc_message: Some("Staged reactor facts differ for /provider/internal/path".into()),
                rpc_refusal_code: Some("mavenOwnership.descriptorUnavailable".into()),
            }),
            "RefactorKit could not verify the Maven reactor model for this rename. The workspace is unchanged."
        );
        assert_eq!(
            preview_call_error(SessionCallError {
                kind: SessionCallErrorKind::Rejected,
                rpc_code: Some(-32603),
                rpc_message: None,
                rpc_refusal_code: None,
            }),
            "RefactorKit rejected the Maven module rename preview (JSON-RPC error -32603)."
        );
        assert_eq!(
            preview_call_error(SessionCallError {
                kind: SessionCallErrorKind::Session,
                rpc_code: None,
                rpc_message: None,
                rpc_refusal_code: None,
            }),
            "The RefactorKit session failed or timed out during Maven module rename preview."
        );
        assert_eq!(
            preview_call_error(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
                rpc_message: None,
                rpc_refusal_code: None,
            }),
            "RefactorKit returned an invalid response for Maven module rename preview."
        );
    }

    #[test]
    fn maven_rollback_reports_the_typed_conflict_without_disclosing_provider_paths() {
        assert_eq!(
            rollback_call_error(SessionCallError {
                kind: SessionCallErrorKind::Rejected,
                rpc_code: Some(-32005),
                rpc_message: Some("Rollback conflict in /provider/internal/path".into()),
                rpc_refusal_code: Some("rollback.conflict".into()),
            }),
            "Maven module rename rollback conflicts with the current workspace state."
        );
    }

    fn request() -> MavenModuleRenamePreviewRequest {
        MavenModuleRenamePreviewRequest {
            old_module_dir: "catalog-model".into(),
            new_module_dir: "catalog-domain".into(),
            new_artifact_id: Some("catalog-domain".into()),
            expected_snapshot_hash: "a".repeat(64),
            expected_context_hash: "b".repeat(64),
            workspace_id: "workspace-1".into(),
            workspace_generation: 4,
            selection_generation: 7,
            request_id: "module-rename-1".into(),
        }
    }

    fn raw_preview(snapshot: &str, affected_files: Value) -> Value {
        json!({
            "planId": "plan-1",
            "operation": OPERATION,
            "status": "PREVIEW",
            "summary": "Rename Maven module",
            "snapshot": {"hash": snapshot, "validatedOnApply": true},
            "affectedFiles": affected_files,
            "renderedDiff": "--- a/pom.xml\n+++ b/pom.xml\n",
            "diffTruncated": false,
            "diffTruncationReasons": [],
            "provider": {"name": "refactorkit-java", "version": "0.8.0-SNAPSHOT"}
        })
    }

    fn raw_apply() -> Value {
        json!({
            "status": "applied",
            "planId": "plan-1",
            "transactionId": "transaction-1",
            "snapshotHash": "c".repeat(64),
            "changedFiles": [{
                "change": "move",
                "path": "catalog-domain/pom.xml",
                "previousPath": "catalog-model/pom.xml",
                "primary": true
            }],
            "provider": {"name": "refactorkit-java", "version": "0.8.0-SNAPSHOT"}
        })
    }

    fn raw_rollback() -> Value {
        json!({
            "status": "rolledBack",
            "transactionId": "transaction-1",
            "rolledBack": true,
            "changedFiles": [{
                "change": "move",
                "path": "catalog-model/pom.xml",
                "previousPath": "catalog-domain/pom.xml",
                "primary": true
            }]
        })
    }

    #[test]
    fn normalizes_only_correlated_provider_preview_and_workspace_paths() {
        let root =
            std::env::temp_dir().join(format!("maven-module-preview-{}", std::process::id()));
        let project = root.join("services/catalog");
        std::fs::create_dir_all(project.join("catalog-model")).unwrap();
        std::fs::create_dir_all(project.join("catalog-domain")).unwrap();
        let workspace_root = root.canonicalize().unwrap();
        let project = project.canonicalize().unwrap();
        let request = request();
        let normalized = normalize_preview(
            raw_preview(
                &request.expected_snapshot_hash,
                json!(["pom.xml", "catalog-model/pom.xml"]),
            ),
            &project,
            &workspace_root,
            "services/catalog",
            &request,
        )
        .unwrap();
        assert_eq!(normalized["status"], "preview");
        assert_eq!(normalized["planId"], "plan-1");
        assert_eq!(normalized["workspaceGeneration"], 4);
        assert_eq!(
            normalized["affectedFiles"],
            json!([
                "services/catalog/pom.xml",
                "services/catalog/catalog-model/pom.xml"
            ])
        );
    }

    #[test]
    fn rejects_snapshot_mismatch_and_paths_outside_project_or_workspace() {
        let root =
            std::env::temp_dir().join(format!("maven-module-preview-bad-{}", std::process::id()));
        let project = root.join("services/catalog");
        std::fs::create_dir_all(&project).unwrap();
        let workspace_root = root.canonicalize().unwrap();
        let project = project.canonicalize().unwrap();
        let request = request();
        assert!(normalize_preview(
            raw_preview(&"c".repeat(64), json!(["pom.xml"])),
            &project,
            &workspace_root,
            "services/catalog",
            &request,
        )
        .is_err());
        assert!(normalize_preview(
            raw_preview(&request.expected_snapshot_hash, json!(["../pom.xml"])),
            &project,
            &workspace_root,
            "services/catalog",
            &request,
        )
        .is_err());
    }

    #[test]
    fn normalizes_apply_and_rollback_changes_to_workspace_paths() {
        let root =
            std::env::temp_dir().join(format!("maven-module-transaction-{}", std::process::id()));
        let project = root.join("services/catalog");
        std::fs::create_dir_all(project.join("catalog-model")).unwrap();
        std::fs::create_dir_all(project.join("catalog-domain")).unwrap();
        let workspace_root = root.canonicalize().unwrap();
        let project = project.canonicalize().unwrap();
        let applied = normalize_apply(
            raw_apply(),
            &project,
            &workspace_root,
            "services/catalog",
            "plan-1",
        )
        .unwrap();
        assert_eq!(applied["status"], "applied");
        assert_eq!(applied["transactionId"], "transaction-1");
        assert_eq!(
            applied["changedFiles"][0],
            json!({
                "change": "move",
                "path": "services/catalog/catalog-domain/pom.xml",
                "previousPath": "services/catalog/catalog-model/pom.xml",
                "primary": true
            })
        );
        let rolled_back = normalize_rollback(
            raw_rollback(),
            &project,
            &workspace_root,
            "services/catalog",
            "transaction-1",
        )
        .unwrap();
        assert_eq!(rolled_back["rolledBack"], true);
        assert_eq!(
            rolled_back["changedFiles"][0]["path"],
            "services/catalog/catalog-model/pom.xml"
        );
    }

    #[test]
    fn requires_one_explicit_read_only_capability() {
        let offered = json!({"methods": [{
            "name": OPERATION,
            "stability": "experimental",
            "requiresProject": true,
            "writesWorkspace": false,
            "features": {"preview": true, "renderedDiff": true}
        }]});
        assert!(maven_module_rename_preview_offered(&offered));
        let mut writable = offered.clone();
        writable["methods"][0]["writesWorkspace"] = json!(true);
        assert!(!maven_module_rename_preview_offered(&writable));
        let mut duplicate = offered.clone();
        duplicate["methods"]
            .as_array_mut()
            .unwrap()
            .push(offered["methods"][0].clone());
        assert!(!maven_module_rename_preview_offered(&duplicate));
    }

    #[test]
    fn apply_requires_provider_owned_rollback_capability_too() {
        let mut offered = json!({"methods": [{
            "name": OPERATION,
            "stability": "experimental",
            "requiresProject": true,
            "writesWorkspace": false,
            "features": {
                "preview": true,
                "renderedDiff": true,
                "apply": true,
                "rollback": true
            }
        }]});
        assert!(maven_module_rename_apply_offered(&offered));
        offered["methods"][0]["features"]["rollback"] = json!(false);
        assert!(!maven_module_rename_apply_offered(&offered));
    }
}
