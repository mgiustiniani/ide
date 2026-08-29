//! Closed command DTOs and normalized, source-free response contracts.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::path_policy::{nullable_safe_path, safe_path};

pub(super) const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_ID_BYTES: usize = 256;
pub(super) const MAX_TEXT_BYTES: usize = 512 * 1024;
const MAX_ITEMS: usize = 512;
pub(super) const PROTOCOL_FAILED: &str = "RefactorKit daemon returned an invalid response.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRequest {
    pub(super) code: String,
    pub(super) target_directory: String,
    pub(super) source_kind: String,
    pub(super) source_url: Option<String>,
    pub(super) license_policy: String,
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalEvidence {
    pub(super) approval_id: String,
    pub(super) approved_plan_id: String,
    pub(super) approved_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyRequest {
    pub(super) plan_id: String,
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
    pub(super) approval: ApprovalEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscardRequest {
    pub(super) plan_id: String,
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackRequest {
    pub(super) transaction_id: String,
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
    pub(super) request_id: String,
}

// ---------------------------------------------------------------------------
// General Java refactoring (rename / move / change-method-signature / delete)
// ---------------------------------------------------------------------------
// Closed request DTOs for the operational RefactorKit Java refactoring slice.
// A preview is always read-only and grants no apply authority. Apply binds to
// the exact reviewed plan identity under explicit approval authority. Rollback
// is transaction-bound and exposed only when the provider advertises it.
// ---------------------------------------------------------------------------

/// The canonical general Java refactoring operation set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefactoringOperation {
    RenameClass,
    RenameMember,
    RenameLocalVariable,
    MoveClass,
    ChangeMethodSignature,
    SafeDelete,
}

impl RefactoringOperation {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            RefactoringOperation::RenameClass => "rename-class",
            RefactoringOperation::RenameMember => "rename-member",
            RefactoringOperation::RenameLocalVariable => "rename-local-variable",
            RefactoringOperation::MoveClass => "move-class",
            RefactoringOperation::ChangeMethodSignature => "change-method-signature",
            RefactoringOperation::SafeDelete => "safe-delete",
        }
    }
}

/// True when an operation requires operation-specific change intent to execute.
/// Only `safe-delete` needs no intent.
pub(super) fn refactor_operation_requires_intent(operation: RefactoringOperation) -> bool {
    !matches!(operation, RefactoringOperation::SafeDelete)
}

/// Operation-specific mutation intent required by the real engine before a
/// rename/move/signature preview or apply can execute. The intent is optional on
/// the request but validated: an operation that requires intent but has none is
/// honestly refused (never fabricated). The `operation` discriminator must match
/// the request `operation`. `safe-delete` requires no intent. Field names mirror
/// the engine change descriptor (newName/fromName/newPackage/sourcePath/targetPath/
/// oldParameter/newParameter).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefactorKitChangeIntent {
    pub(super) operation: RefactoringOperation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) new_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) from_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) new_package: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) old_parameter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) new_parameter: Option<String>,
}

impl RefactorKitChangeIntent {
    /// Validates the intent discriminator against the request operation and the
    /// per-operation required parameters. Returns an honest refusal reason when
    /// the intent is absent, mismatched, or incomplete; never fabricates intent.
    pub(super) fn validate(&self, operation: RefactoringOperation) -> Result<(), String> {
        if self.operation != operation {
            return Err(format!(
                "change intent operation {} does not match request operation {}.",
                self.operation.as_str(),
                operation.as_str()
            ));
        }
        match operation {
            RefactoringOperation::RenameClass | RefactoringOperation::RenameMember => {
                require_intent_field(&self.new_name, "newName")
            }
            RefactoringOperation::RenameLocalVariable => {
                require_intent_field(&self.from_name, "fromName")?;
                require_intent_field(&self.new_name, "newName")
            }
            RefactoringOperation::MoveClass => require_intent_field(&self.new_package, "newPackage"),
            RefactoringOperation::ChangeMethodSignature => {
                require_intent_field(&self.old_parameter, "oldParameter")?;
                require_intent_field(&self.new_parameter, "newParameter")
            }
            RefactoringOperation::SafeDelete => Ok(()),
        }
    }
}

fn require_intent_field(value: &Option<String>, name: &str) -> Result<(), String> {
    value
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|_| ())
        .ok_or_else(|| format!("{} requires a non-empty {name}.", "change intent"))
}

/// An exact semantic Java target bound by the IDE for a refactoring request.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefactoringTarget {
    pub(super) kind: String,
    pub(super) path: String,
    pub(super) identity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) selection: Option<RefactoringSelection>,
}

/// Selection in UTF-16 offsets when a request is selection-bound.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefactoringSelection {
    pub(super) start: u64,
    pub(super) end: u64,
}

/// Workspace authority carried by every general refactoring request/result.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceAuthority {
    pub(super) workspace_id: String,
    pub(super) workspace_generation: u64,
}

/// Request one read-only Java refactoring preview for an exact operation + target.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRefactoringRequest {
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

/// Explicit IDE authority binding to the exact reviewed plan.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyRefactoringRequest {
    pub(super) plan_id: String,
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
    pub(super) approval: ApprovalEvidence,
}

/// Request rollback for an advertised, transaction-bound compensating write.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackRefactoringRequest {
    pub(super) transaction_id: String,
    pub(super) operation: RefactoringOperation,
    pub(super) authority: WorkspaceAuthority,
    pub(super) request_id: String,
}

pub(super) fn normalize_plan(
    raw: Value,
    root: &Path,
    request: &PreviewRequest,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let status = match required_string(object, "status")? {
        "preview" => "ready",
        "refused" => "refused",
        "stale" => "stale",
        "error" => "error",
        _ => return Err(PROTOCOL_FAILED.to_string()),
    };
    let plan_id = protocol_id_field(object, "planId")?;
    let summary = bounded_string(object, "summary", MAX_TEXT_BYTES)?;
    let confidence = object
        .get("confidence")
        .and_then(Value::as_f64)
        .filter(|v| (0.0..=1.0).contains(v))
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let risk = enum_string(object, "riskLevel", &["low", "medium", "high", "unknown"])?;
    let evidence = normalize_evidence(object.get("evidence"))?;
    let affected = normalize_files(object.get("affectedFiles"), root)?;
    let placement_raw = record_field(object, "placement")?;
    let source_root = nullable_safe_path(placement_raw.get("sourceRoot"), root)?;
    let package_changes = normalize_package_changes(object.get("packageChanges"), root)?;
    let rendered_diff = bounded_multiline(object.get("renderedDiff"), MAX_TEXT_BYTES)?;
    let structured = normalize_structured_diff(object.get("structuredDiff"), root)?;
    let warnings = string_array(object.get("warnings"))?;
    let diagnostics = normalize_diagnostics(object.get("diagnosticsAfterPreview"), root)?;
    let provenance = record_field(object, "provenance")?;
    if provenance.get("sourceKind").and_then(Value::as_str) != Some("clipboard")
        || provenance.get("licensePolicy").and_then(Value::as_str) != Some("warn")
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let provider = record_field(object, "provider")?;
    Ok(json!({
        "planId": plan_id,
        "status": status,
        "summary": summary,
        "confidence": confidence,
        "riskLevel": risk,
        "evidence": evidence,
        "affectedFiles": affected,
        "placement": {
            "packageName": nullable_string(placement_raw.get("packageName"))?,
            "sourceRoot": source_root,
            "moduleName": nullable_string(placement_raw.get("moduleName"))?
        },
        "packageChanges": package_changes,
        "renderedDiff": rendered_diff,
        "structuredDiff": structured,
        "warnings": warnings,
        "diagnosticsAfterPreview": diagnostics,
        "provenance": {
            "sourceKind": "clipboard", "sourceUrl": null,
            "detectedLicense": nullable_string(provenance.get("detectedLicense"))?,
            "licensePolicy": "warn", "notices": string_array(provenance.get("notices"))?
        },
        "unresolvedDependencies": string_array(object.get("unresolvedDependencies"))?,
        "conflicts": normalize_conflicts(object.get("conflicts"), root)?,
        "refusalReasons": string_array(object.get("refusalReasons"))?,
        "applyEligibility": normalize_eligibility(object.get("applyEligibility"))?,
        "staleness": normalize_staleness(object.get("staleness"))?,
        "provider": bounded_value_string(provider.get("name"), 256)?,
        "providerVersion": nullable_string(provider.get("version"))?,
        "workspaceId": request.workspace_id,
        "workspaceGeneration": request.workspace_generation,
        "selectionGeneration": request.selection_generation,
        "requestId": request.request_id
    }))
}

pub(super) fn normalize_apply(
    raw: Value,
    root: &Path,
    expected_plan: &str,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "planId")? != expected_plan {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let provider = record_field(object, "provider")?;
    Ok(json!({
        "transactionId": protocol_id_field(object, "transactionId")?,
        "planId": expected_plan,
        "changedFiles": normalize_files(object.get("changedFiles"), root)?,
        "primaryFile": nullable_safe_path(object.get("primaryFile"), root)?,
        "diagnostics": normalize_diagnostics(object.get("diagnostics"), root)?,
        "provider": bounded_value_string(provider.get("name"), 256)?,
        "providerVersion": nullable_string(provider.get("version"))?
    }))
}

pub(super) fn normalize_rollback(raw: Value, root: &Path, expected: &str) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "transactionId")? != expected {
        return Err(PROTOCOL_FAILED.to_string());
    }
    Ok(json!({
        "transactionId": expected,
        "rolledBack": object.get("rolledBack").and_then(Value::as_bool).ok_or_else(|| PROTOCOL_FAILED.to_string())?,
        "changedFiles": normalize_files(object.get("changedFiles"), root)?,
        "diagnostics": normalize_diagnostics(object.get("diagnostics"), root)?
    }))
}

pub(super) fn normalize_refactoring_preview(
    raw: Value,
    root: &Path,
    request: &PreviewRefactoringRequest,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let status = match required_string(object, "status")? {
        "preview" => "ready",
        "refused" => "refused",
        "stale" => "stale",
        "error" => "error",
        _ => return Err(PROTOCOL_FAILED.to_string()),
    };
    let plan_id = protocol_id_field(object, "planId")?;
    let operation = required_string(object, "operation")?;
    if operation != request.operation.as_str() {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let summary = bounded_string(object, "summary", MAX_TEXT_BYTES)?;
    let confidence = object
        .get("confidence")
        .and_then(Value::as_f64)
        .filter(|v| (0.0..=1.0).contains(v))
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let risk = enum_string(object, "riskLevel", &["low", "medium", "high", "unknown"])?;
    let risks = string_array(object.get("risks"))?;
    let evidence = normalize_refactoring_evidence(object.get("evidence"))?;
    let affected = normalize_files(object.get("affectedFiles"), root)?;
    let rendered_diff = bounded_multiline(object.get("renderedDiff"), MAX_TEXT_BYTES)?;
    let structured = normalize_structured_diff(object.get("structuredDiff"), root)?;
    let warnings = string_array(object.get("warnings"))?;
    let diagnostics = normalize_diagnostics(object.get("diagnosticsAfterPreview"), root)?;
    let conflicts = normalize_conflicts(object.get("conflicts"), root)?;
    let refusal_reasons = string_array(object.get("refusalReasons"))?;
    let eligibility = normalize_eligibility(object.get("applyEligibility"))?;
    let staleness = normalize_staleness(object.get("staleness"))?;
    let provider = record_field(object, "provider")?;
    let target = normalize_refactoring_target(&request.target, root)?;
    Ok(json!({
        "planId": plan_id,
        "operation": operation,
        "target": target,
        "status": status,
        "summary": summary,
        "confidence": confidence,
        "riskLevel": risk,
        "risks": risks,
        "evidence": evidence,
        "affectedFiles": affected,
        "renderedDiff": rendered_diff,
        "structuredDiff": structured,
        "warnings": warnings,
        "diagnosticsAfterPreview": diagnostics,
        "conflicts": conflicts,
        "refusalReasons": refusal_reasons,
        "applyEligibility": eligibility,
        "staleness": staleness,
        "grantsApplyAuthority": false,
        "authority": {
            "workspaceId": request.authority.workspace_id,
            "workspaceGeneration": request.authority.workspace_generation
        },
        "selectionGeneration": request.selection_generation,
        "requestId": request.request_id,
        "provider": bounded_value_string(provider.get("name"), 256)?,
        "providerVersion": nullable_string(provider.get("version"))?
    }))
}

pub(super) fn normalize_refactoring_apply(
    raw: Value,
    root: &Path,
    expected_plan: &str,
    expected_operation: &str,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "planId")? != expected_plan {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let outcome = enum_string(
        object,
        "outcome",
        &["applied", "refused", "stale", "failed", "indeterminate"],
    )?;
    let operation = required_string(object, "operation")?;
    if operation != expected_operation {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let provider = record_field(object, "provider")?;
    let mut result = json!({
        "planId": expected_plan,
        "operation": expected_operation,
        "outcome": outcome,
        "changedFiles": normalize_files(object.get("changedFiles"), root)?,
        "primaryFile": nullable_safe_path(object.get("primaryFile"), root)?,
        "diagnostics": normalize_diagnostics(object.get("diagnostics"), root)?,
        "provider": bounded_value_string(provider.get("name"), 256)?,
        "providerVersion": nullable_string(provider.get("version"))?
    });
    if let Some(transaction_id) = optional_protocol_id(object.get("transactionId"))? {
        result["transactionId"] = Value::String(transaction_id);
    }
    Ok(result)
}

pub(super) fn normalize_refactoring_rollback(
    raw: Value,
    root: &Path,
    expected_transaction: &str,
) -> Result<Value, String> {
    let object = raw.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if required_string(object, "transactionId")? != expected_transaction {
        return Err(PROTOCOL_FAILED.to_string());
    }
    Ok(json!({
        "transactionId": expected_transaction,
        "rolledBack": object.get("rolledBack").and_then(Value::as_bool).ok_or_else(|| PROTOCOL_FAILED.to_string())?,
        "changedFiles": normalize_files(object.get("changedFiles"), root)?,
        "conflicts": normalize_conflicts(object.get("conflicts"), root)?,
        "diagnostics": normalize_diagnostics(object.get("diagnostics"), root)?
    }))
}

pub(super) fn normalize_refactoring_evidence(
    value: Option<&Value>,
) -> Result<Vec<Value>, String> {
    array(value)?
        .iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            let kind = enum_string(object, "kind", &["create", "edit", "move", "delete"])?;
            let summary = bounded_string(object, "summary", MAX_TEXT_BYTES)?;
            let mut result = json!({"kind": kind, "summary": summary});
            if let Some(detail) = optional_bounded_string(object.get("detail"), MAX_TEXT_BYTES)? {
                result["detail"] = Value::String(detail);
            }
            Ok(result)
        })
        .collect()
}

pub(super) fn normalize_refactoring_target(
    target: &RefactoringTarget,
    root: &Path,
) -> Result<Value, String> {
    let path = safe_path(&target.path, root)?;
    let mut result = json!({"kind": target.kind, "path": path, "identity": target.identity});
    if let Some(selection) = &target.selection {
        result["selection"] = json!({"start": selection.start, "end": selection.end});
    }
    Ok(result)
}

pub(super) fn optional_protocol_id(value: Option<&Value>) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let id = value
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            validate_id(id)?;
            Ok(Some(id.to_string()))
        }
    }
}

pub(super) fn normalize_files(value: Option<&Value>, root: &Path) -> Result<Vec<Value>, String> {
    array(value)?
        .iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            let change = match required_string(object, "change")? {
                "modify" => "edit",
                value @ ("create" | "edit" | "move" | "delete") => value,
                _ => return Err(PROTOCOL_FAILED.to_string()),
            };
            let path = safe_path(required_string(object, "path")?, root)?;
            let previous = nullable_safe_path(object.get("previousPath"), root)?;
            let primary = object
                .get("primary")
                .and_then(Value::as_bool)
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            let mut result = json!({"change": change, "path": path, "primary": primary});
            if let Some(previous) = previous {
                result["previousPath"] = Value::String(previous);
            }
            Ok(result)
        })
        .collect()
}

pub(super) fn normalize_evidence(value: Option<&Value>) -> Result<Vec<Value>, String> {
    array(value)?
        .iter()
        .map(|item| match item {
            Value::String(kind) if !kind.is_empty() && kind.len() <= 256 => {
                Ok(json!({"kind": kind, "summary": kind}))
            }
            Value::Object(object) => {
                let kind = bounded_string(object, "kind", 256)?;
                let summary = bounded_string(object, "summary", MAX_TEXT_BYTES)?;
                let mut result = json!({"kind": kind, "summary": summary});
                if let Some(detail) = optional_bounded_string(object.get("detail"), MAX_TEXT_BYTES)?
                {
                    result["detail"] = Value::String(detail);
                }
                Ok(result)
            }
            _ => Err(PROTOCOL_FAILED.to_string()),
        })
        .collect()
}

pub(super) fn normalize_package_changes(
    value: Option<&Value>,
    root: &Path,
) -> Result<Vec<Value>, String> {
    array(value)?.iter().map(|item| {
        let object = item.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let mut result = json!({
            "fromPackage": nullable_string(object.get("fromPackage").or_else(|| object.get("from")))?,
            "toPackage": nullable_string(object.get("toPackage").or_else(|| object.get("to")))?
        });
        if let Some(path) = nullable_safe_path(object.get("path"), root)? { result["path"] = Value::String(path); }
        Ok(result)
    }).collect()
}

pub(super) fn normalize_structured_diff(
    value: Option<&Value>,
    root: &Path,
) -> Result<Vec<Value>, String> {
    array(value)?.iter().map(|item| {
        let object = item.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let change = match required_string(object, "change")? { "modify" => "edit", value @ ("create" | "edit" | "move" | "delete") => value, _ => return Err(PROTOCOL_FAILED.to_string()) };
        let hunks: Result<Vec<Value>, String> = array(object.get("hunks"))?.iter().map(|hunk| {
            let h = hunk.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            Ok(json!({
                "oldStart": unsigned(h, "oldStart")?, "oldLines": unsigned(h, "oldLines")?,
                "newStart": unsigned(h, "newStart")?, "newLines": unsigned(h, "newLines")?,
                "lines": string_array(h.get("lines"))?
            }))
        }).collect();
        Ok(json!({"path": safe_path(required_string(object, "path")?, root)?, "change": change, "hunks": hunks?}))
    }).collect()
}

pub(super) fn normalize_diagnostics(
    value: Option<&Value>,
    root: &Path,
) -> Result<Vec<Value>, String> {
    array(value)?.iter().map(|item| {
        let object = item.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let severity = enum_string(object, "severity", &["error", "warning", "information", "hint"])?;
        let mut result = json!({"severity": severity, "message": bounded_string(object, "message", MAX_TEXT_BYTES)?});
        if let Some(path) = nullable_safe_path(object.get("path"), root)? { result["path"] = Value::String(path); }
        for field in ["line", "column"] { if let Some(value) = object.get(field) { result[field] = json!(value.as_u64().filter(|v| *v > 0).ok_or_else(|| PROTOCOL_FAILED.to_string())?); } }
        if let Some(code) = optional_bounded_string(object.get("code"), 256)? { result["code"] = Value::String(code); }
        Ok(result)
    }).collect()
}

pub(super) fn normalize_conflicts(
    value: Option<&Value>,
    root: &Path,
) -> Result<Vec<Value>, String> {
    array(value)?.iter().map(|item| {
        let object = item.as_object().ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let mut result = json!({"kind": bounded_string(object, "kind", 256)?, "summary": bounded_string(object, "summary", MAX_TEXT_BYTES)?});
        if let Some(path) = nullable_safe_path(object.get("path"), root)? { result["path"] = Value::String(path); }
        Ok(result)
    }).collect()
}

pub(super) fn normalize_eligibility(value: Option<&Value>) -> Result<Value, String> {
    let object = value
        .and_then(Value::as_object)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    Ok(
        json!({"eligible": object.get("eligible").and_then(Value::as_bool).ok_or_else(|| PROTOCOL_FAILED.to_string())?, "blockers": string_array(object.get("blockers"))?}),
    )
}
pub(super) fn normalize_staleness(value: Option<&Value>) -> Result<Value, String> {
    let object = value
        .and_then(Value::as_object)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    Ok(
        json!({"stale": object.get("stale").and_then(Value::as_bool).ok_or_else(|| PROTOCOL_FAILED.to_string())?, "reasons": string_array(object.get("reasons"))?}),
    )
}

pub(super) fn array(value: Option<&Value>) -> Result<&Vec<Value>, String> {
    value
        .and_then(Value::as_array)
        .filter(|values| values.len() <= MAX_ITEMS)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}
pub(super) fn string_array(value: Option<&Value>) -> Result<Vec<String>, String> {
    array(value)?
        .iter()
        .map(|item| bounded_value_string(Some(item), MAX_TEXT_BYTES))
        .collect()
}
pub(super) fn record_field<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a Map<String, Value>, String> {
    object
        .get(field)
        .and_then(Value::as_object)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}
pub(super) fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
) -> Result<&'a str, String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}
pub(super) fn bounded_string(
    object: &Map<String, Value>,
    field: &str,
    max: usize,
) -> Result<String, String> {
    bounded_value_string(object.get(field), max)
}
pub(super) fn bounded_value_string(value: Option<&Value>, max: usize) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
        })
        .map(ToString::to_string)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}
pub(super) fn bounded_multiline(value: Option<&Value>, max: usize) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() <= max
                && !value.chars().any(|character| {
                    character.is_control() && !matches!(character, '\n' | '\r' | '\t')
                })
        })
        .map(ToString::to_string)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}
pub(super) fn optional_bounded_string(
    value: Option<&Value>,
    max: usize,
) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => bounded_value_string(Some(value), max).map(Some),
    }
}
pub(super) fn nullable_string(value: Option<&Value>) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value))
            if value.len() <= MAX_TEXT_BYTES && !value.chars().any(char::is_control) =>
        {
            Ok(Some(value.clone()))
        }
        _ => Err(PROTOCOL_FAILED.to_string()),
    }
}
pub(super) fn enum_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    allowed: &[&str],
) -> Result<&'a str, String> {
    required_string(object, field).and_then(|value| {
        allowed
            .contains(&value)
            .then_some(value)
            .ok_or_else(|| PROTOCOL_FAILED.to_string())
    })
}
pub(super) fn protocol_id_field(
    object: &Map<String, Value>,
    field: &str,
) -> Result<String, String> {
    let value = required_string(object, field)?;
    validate_id(value)?;
    Ok(value.to_string())
}
pub(super) fn unsigned(object: &Map<String, Value>, field: &str) -> Result<u64, String> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}
pub(super) fn string_field<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}

pub(super) fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        Err("Invalid RefactorKit protocol identifier.".to_string())
    } else {
        Ok(())
    }
}
pub(super) fn approval_matches(approval: &ApprovalEvidence, plan_id: &str) -> bool {
    approval.approved_plan_id == plan_id
}
