//! Plan/session application state and use-case orchestration.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::commands::workspace_registry::workspace_id_for_path;

use super::capability_policy::*;
use super::contract::*;
use super::path_policy::*;
use super::transport::*;

#[derive(Clone)]
pub(super) struct Guard {
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Clone)]
pub(super) struct TransactionGuard {
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) operation: Option<String>,
}

/// Preview artifact retained from the exact reviewed plan so Apply binds to the
/// reviewed change rather than rebuilding from a fresh request. Retains the
/// affected files, the rendered patch/diff, and the review evidence that made
/// the plan eligible.
#[derive(Clone)]
pub(super) struct RefactorKitPreviewArtifact {
    pub(super) affected_files: Vec<Value>,
    pub(super) patch: String,
    pub(super) review_evidence: Vec<Value>,
}

/// Exact reviewed real-engine plan guard. Apply binds to the retained exact
/// plan: the retained change descriptor (change intent), target, authority, and
/// preview artifact from the reviewed preview. Apply never rebuilds arguments
/// from a fresh request; a changed or replaced plan requires a fresh preview and
/// review.
#[derive(Clone)]
pub(super) struct EnginePlanGuard {
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    pub(super) change_intent: Option<RefactorKitChangeIntent>,
    pub(super) preview_artifact: RefactorKitPreviewArtifact,
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Default)]
pub(super) struct Manager {
    pub(super) session: Option<Session>,
    pub(super) plans: HashMap<String, Guard>,
    pub(super) transactions: HashMap<String, TransactionGuard>,
    pub(super) consumed_plans: HashSet<String>,
    pub(super) engine_plans: HashMap<String, EnginePlanGuard>,
}

pub struct RefactorKitDaemonState(pub(super) Mutex<Manager>);

impl Default for RefactorKitDaemonState {
    fn default() -> Self {
        Self(Mutex::new(Manager::default()))
    }
}

impl RefactorKitDaemonState {
    pub fn shutdown_all(&self) {
        if let Ok(mut manager) = self.0.lock() {
            reset(&mut manager);
        }
    }
}

impl Drop for RefactorKitDaemonState {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

pub fn get_refactorkit_capabilities(
    state: &RefactorKitDaemonState,
) -> Result<RefactorKitCapabilities, String> {
    let root = canonical_workspace()?;
    let workspace_id = workspace_id_for_path(&root);
    let mut manager = lock(state)?;
    let current_matches = manager.session.as_mut().is_some_and(|session| {
        session.workspace_id == workspace_id
            && session.root == root
            && session.child.try_wait().ok().flatten().is_none()
    });
    if !current_matches && ensure_session(&mut manager, &workspace_id, 0, &root).is_err() {
        return Ok(unavailable_capabilities());
    }
    let capabilities = manager
        .session
        .as_ref()
        .and_then(|session| session.capabilities.clone());
    Ok(capabilities
        .map(available_managed_capabilities)
        .unwrap_or_else(unavailable_capabilities))
}

pub fn preview_refactorkit_external_java_import(
    request: PreviewRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    let target = validate_target(&root, &request.target_directory)?;
    if request.code.is_empty() || request.code.len() > MAX_SOURCE_BYTES {
        return Err("External Java source is empty or exceeds the allowed size.".to_string());
    }
    if request.source_kind != "clipboard"
        || request.source_url.is_some()
        || request.license_policy != "warn"
    {
        return Err("Invalid external Java provenance policy.".to_string());
    }

    let mut manager = lock(state)?;
    ensure_session(
        &mut manager,
        &request.workspace_id,
        request.workspace_generation,
        &root,
    )?;
    let params = preview_params(&request.code, &target);
    let raw = call(
        &mut manager,
        "java.importExternalClass",
        params,
        REQUEST_TIMEOUT,
    )?;
    let normalized = match normalize_plan(raw, &root, &request) {
        Ok(plan) => plan,
        Err(error) => {
            // A malformed preview may still have created a source-bearing pending plan in the
            // daemon. EOF clears it when the session is terminated.
            reset(&mut manager);
            return Err(error);
        }
    };
    let plan_id = string_field(&normalized, "planId")?.to_string();
    let retained = normalized.get("status").and_then(Value::as_str) == Some("ready")
        && normalized
            .pointer("/applyEligibility/eligible")
            .and_then(Value::as_bool)
            == Some(true);
    if retained {
        manager.plans.insert(
            plan_id,
            Guard {
                workspace_id: request.workspace_id,
                workspace_generation: request.workspace_generation,
                selection_generation: request.selection_generation,
                request_id: request.request_id,
            },
        );
    } else {
        manager.consumed_plans.insert(plan_id);
    }
    Ok(normalized)
}

pub fn apply_refactorkit_plan(
    request: ApplyRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    require_generation(request.selection_generation)?;
    for value in [
        &request.plan_id,
        &request.request_id,
        &request.approval.approval_id,
        &request.approval.approved_at,
    ] {
        validate_id(value)?;
    }
    if !approval_matches(&request.approval, &request.plan_id) {
        return Err("Approval does not bind the requested RefactorKit plan.".to_string());
    }
    let mut manager = lock(state)?;
    ensure_session(
        &mut manager,
        &request.workspace_id,
        request.workspace_generation,
        &root,
    )?;
    let guard = manager
        .plans
        .get(&request.plan_id)
        .ok_or_else(|| "RefactorKit plan is stale or unknown.".to_string())?;
    if !guard_matches(
        guard,
        &request.workspace_id,
        request.workspace_generation,
        request.selection_generation,
        &request.request_id,
    ) {
        return Err("RefactorKit plan approval guard mismatch.".to_string());
    }
    let raw = call(
        &mut manager,
        "refactor.apply",
        plan_params(&request.plan_id),
        REQUEST_TIMEOUT,
    )?;
    let result = match normalize_apply(raw, &root, &request.plan_id) {
        Ok(result) => result,
        Err(error) => {
            // Applying is a write boundary. An uncorrelated response leaves transaction state
            // indeterminate, so no local guard or process may survive it.
            reset(&mut manager);
            return Err(error);
        }
    };
    let transaction_id = string_field(&result, "transactionId")?.to_string();
    manager.plans.remove(&request.plan_id);
    manager.consumed_plans.insert(request.plan_id);
    manager.transactions.insert(
        transaction_id,
        TransactionGuard {
            workspace_id: request.workspace_id,
            workspace_generation: request.workspace_generation,
            operation: None,
        },
    );
    Ok(result)
}

pub fn discard_refactorkit_plan(
    request: DiscardRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    let mut manager = lock(state)?;
    if manager.consumed_plans.contains(&request.plan_id) {
        return Ok(json!({"planId": request.plan_id, "discarded": false}));
    }
    let guard = manager
        .plans
        .get(&request.plan_id)
        .ok_or_else(|| "RefactorKit plan is stale or unknown.".to_string())?;
    if !guard_matches(
        guard,
        &request.workspace_id,
        request.workspace_generation,
        request.selection_generation,
        &request.request_id,
    ) {
        return Err("RefactorKit plan discard guard mismatch.".to_string());
    }
    consume_plan(&mut manager, &request.plan_id);
    ensure_session(
        &mut manager,
        &request.workspace_id,
        request.workspace_generation,
        &root,
    )?;
    let response = call(
        &mut manager,
        "refactor.discard",
        plan_params(&request.plan_id),
        REQUEST_TIMEOUT,
    );
    match response {
        Ok(value) => Ok(json!({
            "planId": request.plan_id,
            "discarded": value.get("discarded").and_then(Value::as_bool).unwrap_or(true)
        })),
        Err(error) => Err(error),
    }
}

pub fn rollback_refactorkit_transaction(
    request: RollbackRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let mut manager = lock(state)?;
    let guard = manager
        .transactions
        .get(&request.transaction_id)
        .ok_or_else(|| "RefactorKit transaction is stale or unknown.".to_string())?;
    if guard.workspace_id != request.workspace_id
        || guard.workspace_generation != request.workspace_generation
    {
        return Err("RefactorKit transaction ownership mismatch.".to_string());
    }
    ensure_session(
        &mut manager,
        &request.workspace_id,
        request.workspace_generation,
        &root,
    )?;
    let raw = call(
        &mut manager,
        "patch.rollback",
        transaction_params(&request.transaction_id),
        REQUEST_TIMEOUT,
    )?;
    let result = match normalize_rollback(raw, &root, &request.transaction_id) {
        Ok(result) => result,
        Err(error) => {
            reset(&mut manager);
            return Err(error);
        }
    };
    if result
        .get("rolledBack")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        manager.transactions.remove(&request.transaction_id);
    }
    Ok(result)
}

pub fn preview_refactoring(
    request: PreviewRefactoringRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.authority.workspace_id, request.authority.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    validate_refactoring_target(&root, &request.target)?;
    let operation = request.operation.as_str();

    let mut manager = lock(state)?;
    ensure_session(
        &mut manager,
        &request.authority.workspace_id,
        request.authority.workspace_generation,
        &root,
    )?;
    let raw = call(
        &mut manager,
        "java.refactor.preview",
        refactoring_preview_params(operation, &request.target),
        REQUEST_TIMEOUT,
    )?;
    let normalized = match normalize_refactoring_preview(raw, &root, &request) {
        Ok(plan) => plan,
        Err(error) => {
            reset(&mut manager);
            return Err(error);
        }
    };
    let plan_id = string_field(&normalized, "planId")?.to_string();
    let retained = normalized.get("status").and_then(Value::as_str) == Some("ready")
        && normalized
            .pointer("/applyEligibility/eligible")
            .and_then(Value::as_bool)
            == Some(true);
    if retained {
        manager.plans.insert(
            plan_id,
            Guard {
                workspace_id: request.authority.workspace_id,
                workspace_generation: request.authority.workspace_generation,
                selection_generation: request.selection_generation,
                request_id: request.request_id,
            },
        );
    } else {
        manager.consumed_plans.insert(plan_id);
    }
    Ok(normalized)
}

pub fn apply_refactoring(
    request: ApplyRefactoringRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.authority.workspace_id, request.authority.workspace_generation)?;
    require_generation(request.selection_generation)?;
    for value in [
        &request.plan_id,
        &request.request_id,
        &request.approval.approval_id,
        &request.approval.approved_at,
    ] {
        validate_id(value)?;
    }
    if !approval_matches(&request.approval, &request.plan_id) {
        return Err("Approval does not bind the requested RefactorKit plan.".to_string());
    }
    validate_refactoring_target(&root, &request.target)?;
    let operation = request.operation.as_str();

    let mut manager = lock(state)?;
    ensure_session(
        &mut manager,
        &request.authority.workspace_id,
        request.authority.workspace_generation,
        &root,
    )?;
    let guard = manager
        .plans
        .get(&request.plan_id)
        .ok_or_else(|| "RefactorKit plan is stale or unknown.".to_string())?;
    if !guard_matches(
        guard,
        &request.authority.workspace_id,
        request.authority.workspace_generation,
        request.selection_generation,
        &request.request_id,
    ) {
        return Err("RefactorKit plan approval guard mismatch.".to_string());
    }
    let raw = call(
        &mut manager,
        "java.refactor.apply",
        refactoring_apply_params(&request.plan_id),
        REQUEST_TIMEOUT,
    )?;
    let result = match normalize_refactoring_apply(raw, &root, &request.plan_id, operation) {
        Ok(result) => result,
        Err(error) => {
            // Applying is a write boundary. An uncorrelated response leaves transaction state
            // indeterminate, so no local guard or process may survive it.
            reset(&mut manager);
            return Err(error);
        }
    };
    if result.get("outcome").and_then(Value::as_str) == Some("applied") {
        if let Some(transaction_id) = result.get("transactionId").and_then(Value::as_str) {
            manager.transactions.insert(
                transaction_id.to_string(),
                TransactionGuard {
                    workspace_id: request.authority.workspace_id,
                    workspace_generation: request.authority.workspace_generation,
                    operation: Some(operation.to_string()),
                },
            );
        }
    }
    consume_plan(&mut manager, &request.plan_id);
    Ok(result)
}

pub fn rollback_refactoring(
    request: RollbackRefactoringRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.authority.workspace_id, request.authority.workspace_generation)?;
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let mut manager = lock(state)?;
    let guard = manager
        .transactions
        .get(&request.transaction_id)
        .ok_or_else(|| "RefactorKit transaction is stale or unknown.".to_string())?;
    if guard.workspace_id != request.authority.workspace_id
        || guard.workspace_generation != request.authority.workspace_generation
    {
        return Err("RefactorKit transaction ownership mismatch.".to_string());
    }
    if guard.operation.as_deref() != Some(request.operation.as_str()) {
        return Err("RefactorKit transaction operation mismatch.".to_string());
    }
    ensure_session(
        &mut manager,
        &request.authority.workspace_id,
        request.authority.workspace_generation,
        &root,
    )?;
    let raw = call(
        &mut manager,
        "java.refactor.rollback",
        refactoring_rollback_params(&request.transaction_id),
        REQUEST_TIMEOUT,
    )?;
    let result = match normalize_refactoring_rollback(raw, &root, &request.transaction_id) {
        Ok(result) => result,
        Err(error) => {
            reset(&mut manager);
            return Err(error);
        }
    };
    if result
        .get("rolledBack")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        manager.transactions.remove(&request.transaction_id);
    }
    Ok(result)
}

pub fn discard_refactoring(
    request: DiscardRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.workspace_id, request.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    let mut manager = lock(state)?;
    if manager.consumed_plans.contains(&request.plan_id) {
        return Ok(json!({"planId": request.plan_id, "discarded": false}));
    }
    let guard = manager
        .plans
        .get(&request.plan_id)
        .ok_or_else(|| "RefactorKit plan is stale or unknown.".to_string())?;
    if !guard_matches(
        guard,
        &request.workspace_id,
        request.workspace_generation,
        request.selection_generation,
        &request.request_id,
    ) {
        return Err("RefactorKit plan discard guard mismatch.".to_string());
    }
    consume_plan(&mut manager, &request.plan_id);
    ensure_session(
        &mut manager,
        &request.workspace_id,
        request.workspace_generation,
        &root,
    )?;
    let response = call(
        &mut manager,
        "java.refactor.discard",
        refactoring_discard_params(&request.plan_id),
        REQUEST_TIMEOUT,
    );
    match response {
        Ok(value) => Ok(json!({
            "planId": request.plan_id,
            "discarded": value.get("discarded").and_then(Value::as_bool).unwrap_or(true)
        })),
        Err(error) => Err(error),
    }
}

pub fn shutdown_refactorkit_daemon(state: &RefactorKitDaemonState) -> Result<(), String> {
    let mut manager = lock(state)?;
    reset(&mut manager);
    Ok(())
}

pub(super) fn lock(
    state: &RefactorKitDaemonState,
) -> Result<std::sync::MutexGuard<'_, Manager>, String> {
    state
        .0
        .lock()
        .map_err(|_| "RefactorKit daemon state is unavailable.".to_string())
}

pub(super) fn reset(manager: &mut Manager) {
    if let Some(mut session) = manager.session.take() {
        terminate(&mut session.child);
    }
    manager.plans.clear();
    manager.transactions.clear();
    manager.consumed_plans.clear();
    manager.engine_plans.clear();
}

pub(super) fn ensure_session(
    manager: &mut Manager,
    workspace_id: &str,
    generation: u64,
    root: &Path,
) -> Result<(), String> {
    let reusable = manager.session.as_mut().is_some_and(|session| {
        session.workspace_id == workspace_id
            && session.generation == generation
            && session.root == root
            && session.child.try_wait().ok().flatten().is_none()
    });
    if reusable {
        return Ok(());
    }
    reset(manager);
    let mut session = spawn_session(workspace_id, generation, root)?;
    let initialized = (|| {
        let capabilities = session_call(
            &mut session,
            "server.capabilities",
            json!({}),
            START_TIMEOUT,
        )?;
        session.capabilities = Some(normalize_server_capabilities(&capabilities)?);
        let opened = session_call(
            &mut session,
            "project.open",
            json!({"root": root.to_string_lossy()}),
            START_TIMEOUT,
        )?;
        let opened_root = opened
            .get("root")
            .and_then(Value::as_str)
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        if Path::new(opened_root).canonicalize().ok().as_deref() != Some(root) {
            return Err(PROTOCOL_FAILED.to_string());
        }
        Ok(())
    })();
    if let Err(error) = initialized {
        terminate(&mut session.child);
        return Err(error);
    }
    manager.session = Some(session);
    Ok(())
}

pub(super) fn preview_params(code: &str, target_directory: &str) -> Value {
    json!({
        "code": code,
        "targetDirectory": target_directory,
        "sourceKind": "clipboard",
        "sourceUrl": null,
        "licensePolicy": "warn"
    })
}

pub(super) fn plan_params(plan_id: &str) -> Value {
    json!({"planId": plan_id})
}

pub(super) fn transaction_params(transaction_id: &str) -> Value {
    json!({"transactionId": transaction_id})
}

pub(super) fn refactoring_target_params(target: &RefactoringTarget) -> Value {
    let mut value = json!({
        "kind": target.kind,
        "path": target.path,
        "identity": target.identity
    });
    if let Some(selection) = &target.selection {
        value["selection"] = json!({"start": selection.start, "end": selection.end});
    }
    value
}

pub(super) fn refactoring_preview_params(operation: &str, target: &RefactoringTarget) -> Value {
    json!({"operation": operation, "target": refactoring_target_params(target)})
}

pub(super) fn refactoring_apply_params(plan_id: &str) -> Value {
    json!({"planId": plan_id})
}

pub(super) fn refactoring_rollback_params(transaction_id: &str) -> Value {
    json!({"transactionId": transaction_id})
}

pub(super) fn refactoring_discard_params(plan_id: &str) -> Value {
    json!({"planId": plan_id})
}

pub(super) fn validate_refactoring_target(root: &Path, target: &RefactoringTarget) -> Result<String, String> {
    if !matches!(target.kind.as_str(), "class" | "member" | "local-binding") {
        return Err(PROTOCOL_FAILED.to_string());
    }
    if target.identity.is_empty()
        || target.identity.len() > MAX_TEXT_BYTES
        || target.identity.chars().any(char::is_control)
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    if let Some(selection) = &target.selection {
        if selection.end < selection.start {
            return Err(PROTOCOL_FAILED.to_string());
        }
    }
    safe_path(&target.path, root)
}

pub(super) fn call(
    manager: &mut Manager,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let result = {
        let session = manager
            .session
            .as_mut()
            .ok_or_else(|| SESSION_FAILED.to_string())?;
        session_call(session, method, params, timeout)
    };
    if result.is_err() {
        reset(manager);
    }
    result
}

pub(super) fn consume_plan(manager: &mut Manager, plan_id: &str) {
    manager.plans.remove(plan_id);
    manager.consumed_plans.insert(plan_id.to_string());
}

pub(super) fn guard_matches(
    guard: &Guard,
    workspace_id: &str,
    generation: u64,
    selection: u64,
    request_id: &str,
) -> bool {
    guard.workspace_id == workspace_id
        && guard.workspace_generation == generation
        && guard.selection_generation == selection
        && guard.request_id == request_id
}
