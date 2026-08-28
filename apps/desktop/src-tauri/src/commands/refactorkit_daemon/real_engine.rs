//! Real-engine discovery and CLI delegation for the operational RefactorKit surface.
//!
//! This module owns honest wrapper-PATH / installed-engine-path discovery and real
//! CLI delegation for the operational surface (scan, symbols, definition,
//! references, diagnostics, and the canonical Java refactoring operations). The
//! deterministic in-process fixture peer (`refactorkit-daemon`) remains a fallback /
//! harness behind the managed JSON-RPC transport and is never claimed as real-engine
//! evidence here.
//!
//! Capability advertisement is authoritative only from the real engine's own report
//! (`--version` + `capabilities` + `--help`). Nothing is inferred from the fixture
//! peer, a version string alone, or a visible control. When no real engine is
//! discoverable the surface is reported honestly as unavailable with a reason.
//!
//! Real CLI delegation:
//! - preview is always read-only (no `--apply`) and grants no apply authority;
//! - apply runs the real transformation with `--apply`, bound to the exact reviewed
//!   plan (operation + target) under explicit approval; a changed or replaced plan
//!   requires a fresh preview and review before any Apply;
//! - rollback is exposed only when the real engine advertises `patch rollback` and
//!   is transaction-bound; no rollback success is inferred from a transaction id or
//!   generic apply capability.

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::refactorkit::{
    authorize_location, find_refactorkit_on_path, parse_location_line, run_capped_command,
    CappedCommandOutput,
};
use crate::commands::workspace_registry::workspace_id_for_path;

use super::application::{lock, RefactorKitDaemonState, EnginePlanGuard};
use super::contract::{
    normalize_refactoring_target, ApprovalEvidence, RefactoringOperation, RefactoringTarget,
    WorkspaceAuthority,
};
use super::path_policy::{canonical_workspace, require_generation, safe_path, validate_workspace};
use super::application::validate_refactoring_target;

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_ID_BYTES: usize = 256;
const MAX_TEXT_BYTES: usize = 512 * 1024;

/// Honest reason when no real engine is discoverable through a wrapper PATH or an
/// installed engine path.
const NO_ENGINE_DISCOVERABLE: &str =
    "No real RefactorKit engine is discoverable through a wrapper PATH or an installed engine path.";
/// Honest reason when the discovered engine did not report usable version/capability metadata.
const ENGINE_UNREPORTED: &str =
    "The discovered RefactorKit engine did not report version and capability metadata.";

/// The canonical Java refactoring operations advertised only when the real engine's
/// `capabilities` report advertises the corresponding java-language operation.
const CANONICAL_OPERATIONS: [&str; 6] = [
    "rename-class",
    "rename-member",
    "rename-local-variable",
    "move-class",
    "change-method-signature",
    "safe-delete",
];

/// The CLI-style operational surface AC-001 requires authoritative capability for.
const OPERATIONAL_SURFACE: [&str; 9] = [
    "scan",
    "symbols",
    "definition",
    "references",
    "diagnostics",
    "rename",
    "rename-member",
    "extract-method",
    "change-signature",
];

/// Source wrapper / installed engine path for the real RefactorKit CLI. The task
/// boundary for this slice is `/home/paperboy/workspace/refactorkit` (the `refactorkit`
/// CLI via the wrapper); the packaged installed engine path is also a candidate.
const INSTALLED_ENGINE_SOURCE_WRAPPER: &str = "/home/paperboy/workspace/refactorkit/refactorkit";

#[derive(Clone)]
pub(super) struct RealEngineProbe {
    pub(super) path: PathBuf,
    pub(super) version: String,
    pub(super) capabilities: Option<Value>,
    pub(super) help: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealEngineCapabilities {
    pub(super) engine_discovered: bool,
    pub(super) path: Option<String>,
    pub(super) version: Option<String>,
    pub(super) workspace_id: String,
    pub(super) operations: Vec<String>,
    pub(super) operational_surface: Vec<String>,
    pub(super) rollback_advertised: bool,
    pub(super) preview_read_only: bool,
    pub(super) reason: Option<String>,
}

/// Operation-specific CLI parameters for a real-engine refactoring request.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineRefactoringChange {
    pub new_name: Option<String>,
    pub from_name: Option<String>,
    pub new_package: Option<String>,
    pub old_parameter: Option<String>,
    pub new_parameter: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnginePreviewRequest {
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    pub(super) change: EngineRefactoringChange,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineApplyRequest {
    pub(super) plan_id: String,
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    pub(super) change: EngineRefactoringChange,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
    pub(super) approval: ApprovalEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineRollbackRequest {
    pub(super) transaction_id: String,
    pub(super) operation: RefactoringOperation,
    pub(super) authority: WorkspaceAuthority,
    pub(super) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineDiscardRequest {
    pub(super) plan_id: String,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealEngineLocation {
    pub(super) path: String,
    pub(super) line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) column: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealEngineCommandResult {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) locations: Vec<RealEngineLocation>,
    pub(super) success: bool,
    pub(super) code: i32,
    pub(super) timed_out: bool,
    pub(super) stdout_truncated: bool,
    pub(super) stderr_truncated: bool,
    pub(super) engine: String,
    pub(super) engine_version: String,
    pub(super) command: Vec<String>,
}

// -----------------------------------------------------------------------------
// Engine discovery
// -----------------------------------------------------------------------------

pub(super) fn discover_real_engine() -> Result<RealEngineProbe, String> {
    let path = resolve_real_engine()?;
    probe_real_engine(&path)
}

fn resolve_real_engine() -> Result<PathBuf, String> {
    // Test-gated env override so the real-engine integration is deterministically
    // exercised by a fixture harness script without touching production discovery.
    if let Some(override_path) = env::var_os("IDE_REFACTORKIT_ENGINE") {
        let allowed = cfg!(test)
            || env::var("IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE").as_deref() == Ok("1");
        let path = PathBuf::from(&override_path);
        if allowed && path.is_absolute() && executable(&path) {
            return Ok(path.canonicalize().ok().unwrap_or_else(|| path.clone()));
        }
    }
    // Wrapper on PATH (absolute entries only, matching the daemon convention).
    if let Some(path) = find_refactorkit_on_path() {
        return Ok(path);
    }
    // Installed engine paths.
    for candidate in installed_engine_candidates() {
        if executable(&candidate) {
            return Ok(candidate.canonicalize().ok().unwrap_or_else(|| candidate.clone()));
        }
    }
    Err(NO_ENGINE_DISCOVERABLE.to_string())
}

fn installed_engine_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/share/refactorkit/bin/refactorkit"));
    }
    candidates.push(PathBuf::from(INSTALLED_ENGINE_SOURCE_WRAPPER));
    candidates
}

fn executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn probe_real_engine(path: &Path) -> Result<RealEngineProbe, String> {
    let version = probe_version(path)?;
    let capabilities = probe_capabilities(path);
    let help = probe_help(path);
    Ok(RealEngineProbe {
        path: path.to_path_buf(),
        version,
        capabilities,
        help,
    })
}

fn probe_version(path: &Path) -> Result<String, String> {
    let cwd = canonical_workspace().map_err(|_| ENGINE_UNREPORTED.to_string())?;
    let output = run_capped_command(
        path,
        &[OsString::from("--version")],
        &cwd,
        PROBE_TIMEOUT,
        MAX_OUTPUT_BYTES,
    )?;
    let text = output
        .stdout
        .lines()
        .chain(output.stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or_else(|| ENGINE_UNREPORTED.to_string())?;
    let version = parse_version(text).ok_or_else(|| ENGINE_UNREPORTED.to_string())?;
    Ok(version)
}

fn parse_version(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    line.strip_prefix("RefactorKit ")
        .and_then(|rest| rest.split_once(" (API "))
        .map(|(version, _)| version.trim().to_string())
        .or_else(|| Some(line.to_string()))
}

fn probe_capabilities(path: &Path) -> Option<Value> {
    let cwd = canonical_workspace().ok()?;
    let output = run_capped_command(
        path,
        &[OsString::from("capabilities")],
        &cwd,
        PROBE_TIMEOUT,
        MAX_OUTPUT_BYTES,
    )
    .ok()?;
    if !output.success {
        return None;
    }
    serde_json::from_str(output.stdout.trim()).ok()
}

fn probe_help(path: &Path) -> String {
    let cwd = canonical_workspace().ok();
    let Some(cwd) = cwd else {
        return String::new();
    };
    run_capped_command(
        path,
        &[OsString::from("--help")],
        &cwd,
        PROBE_TIMEOUT,
        MAX_OUTPUT_BYTES,
    )
    .map(|output| format!("{}\n{}", output.stdout, output.stderr))
    .unwrap_or_default()
}

// -----------------------------------------------------------------------------
// Authoritative capability advertisement
// -----------------------------------------------------------------------------

pub(super) fn get_refactorkit_engine_capabilities() -> Result<RealEngineCapabilities, String> {
    let root = canonical_workspace()?;
    let workspace_id = workspace_id_for_path(&root);
    match discover_real_engine() {
        Ok(probe) => Ok(real_engine_capabilities(&probe, &workspace_id)),
        Err(reason) => Ok(unavailable_real_engine_capabilities(&workspace_id, &reason)),
    }
}

fn real_engine_capabilities(
    probe: &RealEngineProbe,
    workspace_id: &str,
) -> RealEngineCapabilities {
    let (operations, operational_surface, rollback) =
        derive_surface(probe.capabilities.as_ref(), &probe.help);
    RealEngineCapabilities {
        engine_discovered: true,
        path: Some(probe.path.display().to_string()),
        version: Some(probe.version.clone()),
        workspace_id: workspace_id.to_string(),
        operations,
        operational_surface,
        rollback_advertised: rollback,
        preview_read_only: true,
        reason: None,
    }
}

fn unavailable_real_engine_capabilities(workspace_id: &str, reason: &str) -> RealEngineCapabilities {
    RealEngineCapabilities {
        engine_discovered: false,
        path: None,
        version: None,
        workspace_id: workspace_id.to_string(),
        operations: Vec::new(),
        operational_surface: Vec::new(),
        rollback_advertised: false,
        preview_read_only: true,
        reason: Some(reason.to_string()),
    }
}

/// The operational surface is advertised only when the real engine reports it:
/// semantic java operations come from the authoritative `capabilities` schema, and
/// scan/symbols/diagnostics + patch-rollback come from the engine's own CLI help.
/// Nothing is inferred from the fixture peer, a version string, or a visible control.
fn derive_surface(
    capabilities: Option<&Value>,
    help: &str,
) -> (Vec<String>, Vec<String>, bool) {
    let java = capabilities.and_then(java_adapter);
    let mut operations = Vec::new();
    if let Some(java) = java {
        for canonical in CANONICAL_OPERATIONS {
            let advertised = match canonical {
                "rename-class" => java_has_operation(java, "renameClass"),
                "rename-member" => java_has_operation(java, "renameMember"),
                "rename-local-variable" => java_has_operation(java, "renameLocalVariable"),
                "move-class" => java_has_operation(java, "moveClass"),
                "change-method-signature" => java_has_operation_prefix(java, "changeSignature"),
                "safe-delete" => java_has_operation(java, "safeDelete"),
                _ => false,
            };
            if advertised {
                operations.push(canonical.to_string());
            }
        }
    }
    let mut surface = Vec::new();
    for name in OPERATIONAL_SURFACE {
        let advertised = match name {
            "definition" => java.is_some_and(|j| java_has_operation(j, "definition")),
            "references" => java.is_some_and(|j| java_has_operation(j, "references")),
            "rename" => java.is_some_and(|j| java_has_operation(j, "renameClass")),
            "rename-member" => java.is_some_and(|j| java_has_operation(j, "renameMember")),
            "extract-method" => java.is_some_and(|j| java_has_operation(j, "extractMethod")),
            "change-signature" => java.is_some_and(|j| java_has_operation_prefix(j, "changeSignature")),
            "scan" => help.contains("refactorkit scan"),
            "symbols" => help.contains("refactorkit symbols"),
            "diagnostics" => help.contains("refactorkit diagnostics"),
            _ => false,
        };
        if advertised {
            surface.push(name.to_string());
        }
    }
    let rollback = help.contains("patch rollback");
    (operations, surface, rollback)
}

fn java_adapter(caps: &Value) -> Option<&Value> {
    caps.get("adapters")
        .and_then(Value::as_array)
        .and_then(|adapters| {
            adapters.iter().find(|adapter| {
                adapter
                    .get("languageId")
                    .and_then(Value::as_str)
                    == Some("java")
            })
        })
}

fn java_has_operation(adapter: &Value, name: &str) -> bool {
    adapter
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability.get("operation").and_then(Value::as_str) == Some(name))
        })
}

fn java_has_operation_prefix(adapter: &Value, prefix: &str) -> bool {
    adapter
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|capabilities| {
            capabilities.iter().any(|capability| {
                capability
                    .get("operation")
                    .and_then(Value::as_str)
                    .is_some_and(|operation| operation.starts_with(prefix))
            })
        })
}

/// Capability-before-offer: the requested canonical operation is delegated only when
/// the real engine authoritatively advertises it.
fn require_operation_advertised(probe: &RealEngineProbe, operation: RefactoringOperation) -> Result<(), String> {
    let (operations, _, _) = derive_surface(probe.capabilities.as_ref(), &probe.help);
    if operations.contains(&operation.as_str().to_string()) {
        Ok(())
    } else {
        Err(format!(
            "The real RefactorKit engine does not authoritatively advertise the {} operation.",
            operation.as_str()
        ))
    }
}

// -----------------------------------------------------------------------------
// Real CLI delegation — general refactoring (preview / apply / rollback / discard)
// -----------------------------------------------------------------------------

pub(super) fn preview_refactoring(
    request: EnginePreviewRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.authority.workspace_id, request.authority.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    validate_refactoring_target(&root, &request.target)?;
    let probe = discover_real_engine()?;
    require_operation_advertised(&probe, request.operation)?;
    let args = build_refactor_args(request.operation, &request.target, &request.change, false, &root)?;
    let output = run_capped_command(&probe.path, &args, &root, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES)?;
    if !output.success {
        return Err(engine_command_error(&output));
    }
    let plan_id = correlate_plan_id(&request.request_id);
    let normalized = normalize_engine_preview(&output, &request, &probe, &root, &plan_id)?;

    let mut manager = lock(state)?;
    manager.engine_plans.insert(
        plan_id.clone(),
        EnginePlanGuard {
            operation: request.operation.as_str().to_string(),
            target: request.target.clone(),
            workspace_id: request.authority.workspace_id.clone(),
            workspace_generation: request.authority.workspace_generation,
            selection_generation: request.selection_generation,
            request_id: request.request_id.clone(),
        },
    );
    Ok(normalized)
}

pub(super) fn apply_refactoring(
    request: EngineApplyRequest,
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
    if request.approval.approved_plan_id != request.plan_id {
        return Err("Approval does not bind the requested real-engine RefactorKit plan.".to_string());
    }
    validate_refactoring_target(&root, &request.target)?;
    let probe = discover_real_engine()?;
    require_operation_advertised(&probe, request.operation)?;

    let mut manager = lock(state)?;
    let guard = manager
        .engine_plans
        .get(&request.plan_id)
        .cloned()
        .ok_or_else(|| "Real-engine plan is stale or unknown; a fresh preview and review are required.".to_string())?;
    if guard.operation != request.operation.as_str()
        || guard.target.kind != request.target.kind
        || guard.target.path != request.target.path
        || guard.target.identity != request.target.identity
        || guard.workspace_id != request.authority.workspace_id
        || guard.workspace_generation != request.authority.workspace_generation
        || guard.selection_generation != request.selection_generation
        || guard.request_id != request.request_id
    {
        return Err("Real-engine plan approval guard mismatch; a changed plan requires a fresh preview and review.".to_string());
    }
    let args = build_refactor_args(request.operation, &request.target, &request.change, true, &root)?;
    let output = run_capped_command(&probe.path, &args, &root, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES)?;
    let result = match normalize_engine_apply(&output, &request, &probe, &root) {
        Ok(result) => result,
        Err(error) => {
            // Applying is a write boundary. An uncorrelated outcome leaves transaction
            // state indeterminate, so the local guard must not survive it.
            manager.engine_plans.remove(&request.plan_id);
            return Err(error);
        }
    };
    let transaction_id = result.get("transactionId").and_then(Value::as_str).map(ToString::to_string);
    manager.engine_plans.remove(&request.plan_id);
    if let Some(transaction_id) = transaction_id {
        manager.transactions.insert(
            transaction_id,
            super::application::TransactionGuard {
                workspace_id: request.authority.workspace_id.clone(),
                workspace_generation: request.authority.workspace_generation,
                operation: Some(request.operation.as_str().to_string()),
            },
        );
    }
    Ok(result)
}

pub(super) fn rollback_refactoring(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let root = validate_workspace(&request.authority.workspace_id, request.authority.workspace_generation)?;
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let probe = discover_real_engine()?;
    // Rollback is exposed only when the real engine advertises patch-rollback.
    if !probe.help.contains("patch rollback") {
        return Err("The real RefactorKit engine does not authoritatively advertise transaction rollback.".to_string());
    }
    let mut manager = lock(state)?;
    let guard = manager
        .transactions
        .get(&request.transaction_id)
        .cloned()
        .ok_or_else(|| "Real-engine transaction is stale or unknown.".to_string())?;
    if guard.workspace_id != request.authority.workspace_id
        || guard.workspace_generation != request.authority.workspace_generation
        || guard.operation.as_deref() != Some(request.operation.as_str())
    {
        return Err("Real-engine transaction ownership mismatch.".to_string());
    }
    let args = vec![
        OsString::from("patch"),
        OsString::from("rollback"),
        OsString::from(&request.transaction_id),
    ];
    let output = run_capped_command(&probe.path, &args, &root, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES)?;
    if !output.success {
        return Err(engine_command_error(&output));
    }
    let rolled_back = output.stdout.contains("Rolled back transaction")
        || output.stdout.contains("rolled back");
    if rolled_back {
        manager.transactions.remove(&request.transaction_id);
    }
    Ok(json!({
        "transactionId": request.transaction_id,
        "rolledBack": rolled_back,
        "changedFiles": [],
        "conflicts": [],
        "diagnostics": []
    }))
}

pub(super) fn discard_refactoring(
    request: EngineDiscardRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    validate_workspace(&request.authority.workspace_id, request.authority.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    let mut manager = lock(state)?;
    let removed = manager.engine_plans.remove(&request.plan_id).is_some();
    Ok(json!({"planId": request.plan_id, "discarded": removed}))
}

// -----------------------------------------------------------------------------
// Real CLI delegation — structural surface (scan / symbols / definition /
// references / diagnostics)
// -----------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StructuralAction {
    Scan,
    Symbols,
    Definition,
    References,
    Diagnostics,
}

impl StructuralAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Scan => "scan",
            Self::Symbols => "symbols",
            Self::Definition => "definition",
            Self::References => "references",
            Self::Diagnostics => "diagnostics",
        }
    }
}

pub(super) fn run_engine_scan() -> Result<RealEngineCommandResult, String> {
    run_structural(StructuralAction::Scan, None)
}

pub(super) fn run_engine_symbols() -> Result<RealEngineCommandResult, String> {
    run_structural(StructuralAction::Symbols, None)
}

pub(super) fn run_engine_definition(symbol: String) -> Result<RealEngineCommandResult, String> {
    run_structural(StructuralAction::Definition, Some(validate_symbol(&symbol)?))
}

pub(super) fn run_engine_references(symbol: String) -> Result<RealEngineCommandResult, String> {
    run_structural(StructuralAction::References, Some(validate_symbol(&symbol)?))
}

pub(super) fn run_engine_diagnostics() -> Result<RealEngineCommandResult, String> {
    run_structural(StructuralAction::Diagnostics, None)
}

fn run_structural(action: StructuralAction, symbol: Option<String>) -> Result<RealEngineCommandResult, String> {
    let root = canonical_workspace()?;
    let probe = discover_real_engine()?;
    // Capability-before-offer for the structural surface.
    let (_, surface, _) = derive_surface(probe.capabilities.as_ref(), &probe.help);
    if !surface.contains(&action.as_str().to_string()) {
        return Err(format!(
            "The real RefactorKit engine does not authoritatively advertise the {} surface.",
            action.as_str()
        ));
    }
    let mut args: Vec<OsString> = Vec::new();
    match (action, symbol) {
        (StructuralAction::Scan | StructuralAction::Symbols | StructuralAction::Diagnostics, _) => {
            args.push(OsString::from(action.as_str()));
        }
        (StructuralAction::Definition | StructuralAction::References, Some(symbol)) => {
            args.push(OsString::from(action.as_str()));
            args.push(OsString::from("--symbol"));
            args.push(OsString::from(symbol));
        }
        (StructuralAction::Definition | StructuralAction::References, None) => {
            return Err("The requested real-engine surface requires a symbol.".to_string());
        }
    }
    args.push(root.as_os_str().to_os_string());
    let output = run_capped_command(&probe.path, &args, &root, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES)?;
    let locations = if output.success
        && matches!(action, StructuralAction::Definition | StructuralAction::References)
    {
        output
            .stdout
            .lines()
            .filter_map(parse_location_line)
            .filter_map(|(path, line, column)| {
                authorize_location(&root, path).map(|path| RealEngineLocation {
                    path,
                    line,
                    column,
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(RealEngineCommandResult {
        stdout: output.stdout,
        stderr: output.stderr,
        locations,
        success: output.success,
        code: output.code,
        timed_out: output.timed_out,
        stdout_truncated: output.stdout_truncated,
        stderr_truncated: output.stderr_truncated,
        engine: probe.path.display().to_string(),
        engine_version: probe.version,
        command: args.iter().map(|arg| arg.to_string_lossy().to_string()).collect(),
    })
}

// -----------------------------------------------------------------------------
// CLI args, plan correlation, and honest output normalization
// -----------------------------------------------------------------------------

fn build_refactor_args(
    operation: RefactoringOperation,
    target: &RefactoringTarget,
    change: &EngineRefactoringChange,
    apply: bool,
    root: &Path,
) -> Result<Vec<OsString>, String> {
    let mut args: Vec<OsString> = Vec::new();
    match operation {
        RefactoringOperation::RenameClass => {
            let name = required_change(&change.new_name, "rename-class requires newName")?;
            args.extend([
                OsString::from("rename"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--to"),
                OsString::from(name),
            ]);
        }
        RefactoringOperation::RenameMember => {
            let name = required_change(&change.new_name, "rename-member requires newName")?;
            args.extend([
                OsString::from("rename-member"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--to"),
                OsString::from(name),
            ]);
        }
        RefactoringOperation::RenameLocalVariable => {
            let from = required_change(&change.from_name, "rename-local-variable requires fromName")?;
            let to = required_change(&change.new_name, "rename-local-variable requires newName")?;
            args.extend([
                OsString::from("local-rename"),
                OsString::from(&target.path),
                OsString::from("--from"),
                OsString::from(from),
                OsString::from("--to"),
                OsString::from(to),
            ]);
            if apply {
                args.push(OsString::from("--apply"));
            }
            args.push(OsString::from("--root"));
            args.push(root.as_os_str().to_os_string());
            return Ok(args);
        }
        RefactoringOperation::MoveClass => {
            let package = required_change(&change.new_package, "move-class requires newPackage")?;
            args.extend([
                OsString::from("move-class"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--to-package"),
                OsString::from(package),
            ]);
        }
        RefactoringOperation::ChangeMethodSignature => {
            let old = required_change(&change.old_parameter, "change-method-signature requires oldParameter")?;
            let new = required_change(&change.new_parameter, "change-method-signature requires newParameter")?;
            args.extend([
                OsString::from("change-signature"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--old-name"),
                OsString::from(old),
                OsString::from("--new-name"),
                OsString::from(new),
            ]);
        }
        RefactoringOperation::SafeDelete => {
            args.extend([
                OsString::from("safe-delete"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
            ]);
        }
    }
    if apply {
        args.push(OsString::from("--apply"));
    }
    args.push(root.as_os_str().to_os_string());
    Ok(args)
}

fn required_change(value: &Option<String>, message: &str) -> Result<String, String> {
    value
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value.len() <= MAX_TEXT_BYTES && !value.chars().any(char::is_control))
        .ok_or_else(|| message.to_string())
}

/// A deterministic, source-free plan correlation identity bound to the request.
fn correlate_plan_id(request_id: &str) -> String {
    // The real engine CLI is stateless; the daemon correlates the reviewed plan to
    // the request identity so Apply can bind to the exact reviewed plan.
    let digest = request_id.as_bytes().iter().fold(0_u64, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(u64::from(*byte))
    });
    format!("engine-plan-{digest:016x}")
}

fn normalize_engine_preview(
    output: &CappedCommandOutput,
    request: &EnginePreviewRequest,
    probe: &RealEngineProbe,
    root: &Path,
    plan_id: &str,
) -> Result<Value, String> {
    let text = &output.stdout;
    let summary = parse_summary(text).unwrap_or_else(|| "Real-engine preview produced no summary.".to_string());
    let affected_change = match request.operation {
        RefactoringOperation::SafeDelete => "delete",
        RefactoringOperation::MoveClass => "move",
        _ => "edit",
    };
    let affected = parse_affected_files(text, root, affected_change)?;
    let rendered_diff = parse_patch(text).unwrap_or_default();
    let warnings = parse_warnings(text);
    let target = normalize_refactoring_target(&request.target, root)?;
    Ok(json!({
        "planId": plan_id,
        "operation": request.operation.as_str(),
        "target": target,
        "status": "ready",
        "summary": summary,
        "confidence": 0.0,
        "riskLevel": "unknown",
        "risks": [],
        "evidence": [],
        "affectedFiles": affected,
        "renderedDiff": rendered_diff,
        "structuredDiff": [],
        "warnings": warnings,
        "diagnosticsAfterPreview": [],
        "conflicts": [],
        "refusalReasons": [],
        "applyEligibility": {"eligible": false, "blockers": ["preview grants no apply authority"]},
        "staleness": {"stale": false, "reasons": []},
        "grantsApplyAuthority": false,
        "authority": {
            "workspaceId": request.authority.workspace_id,
            "workspaceGeneration": request.authority.workspace_generation
        },
        "selectionGeneration": request.selection_generation,
        "requestId": request.request_id,
        "provider": "refactorkit",
        "providerVersion": probe.version,
        "engine": probe.path.display().to_string()
    }))
}

fn normalize_engine_apply(
    output: &CappedCommandOutput,
    request: &EngineApplyRequest,
    probe: &RealEngineProbe,
    root: &Path,
) -> Result<Value, String> {
    let text = &output.stdout;
    let outcome = if text.contains("Applied. Transaction:")
        || text.contains("Applied. Transaction")
    {
        "applied"
    } else if text.contains("refused") || text.contains("Refused") {
        "refused"
    } else {
        "failed"
    };
    let affected_change = match request.operation {
        RefactoringOperation::SafeDelete => "delete",
        RefactoringOperation::MoveClass => "move",
        _ => "edit",
    };
    let changed_files = parse_affected_files(text, root, affected_change)?;
    let primary = changed_files.first().cloned().unwrap_or(Value::Null);
    let transaction_id = parse_transaction_id(text);
    let mut result = json!({
        "planId": request.plan_id,
        "operation": request.operation.as_str(),
        "outcome": outcome,
        "changedFiles": changed_files,
        "primaryFile": primary,
        "diagnostics": [],
        "provider": "refactorkit",
        "providerVersion": probe.version
    });
    if let Some(transaction_id) = transaction_id {
        result["transactionId"] = Value::String(transaction_id);
    }
    Ok(result)
}

fn parse_affected_files(text: &str, root: &Path, change: &str) -> Result<Vec<Value>, String> {
    let mut in_files = false;
    let mut files = Vec::new();
    let mut seen_primary = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Affected files:") {
            in_files = true;
            continue;
        }
        if in_files && (trimmed.is_empty() || !trimmed.starts_with('-')) {
            break;
        }
        if in_files {
            let path = trimmed.trim_start_matches('-').trim();
            let path = safe_path(path, root)?;
            files.push(json!({
                "change": change,
                "path": path,
                "primary": !seen_primary
            }));
            seen_primary = true;
        }
    }
    Ok(files)
}

fn parse_patch(text: &str) -> Option<String> {
    let mut in_patch = false;
    let mut patch = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "Patch:" {
            in_patch = true;
            continue;
        }
        if in_patch {
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("Use --apply") {
                break;
            }
            if trimmed.starts_with("Applied.") || trimmed.starts_with("To rollback:") {
                break;
            }
            patch.push_str(line);
            patch.push('\n');
        }
    }
    if patch.is_empty() {
        None
    } else {
        Some(patch)
    }
}

fn parse_warnings(text: &str) -> Vec<String> {
    let mut in_warnings = false;
    let mut warnings = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "Warnings:" {
            in_warnings = true;
            continue;
        }
        if in_warnings {
            if trimmed.is_empty() || !trimmed.starts_with('-') {
                break;
            }
            warnings.push(trimmed.trim_start_matches('-').trim().to_string());
        }
    }
    warnings
}

fn parse_summary(text: &str) -> Option<String> {
    let mut skip = true;
    for line in text.lines() {
        let trimmed = line.trim();
        if skip {
            if trimmed.is_empty()
                || trimmed.starts_with("Operation:")
                || trimmed.starts_with("Status:")
                || trimmed.starts_with("Evidence:")
                || trimmed.starts_with("Warnings:")
            {
                continue;
            }
            skip = false;
        }
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("Warnings:") || trimmed.starts_with("Affected files:") {
            return None;
        }
        return Some(trimmed.to_string());
    }
    None
}

fn parse_transaction_id(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| {
            let start = line.find("transaction-")?;
            let rest = &line[start + "transaction-".len()..];
            let end = rest
                .char_indices()
                .find(|(_, c)| !c.is_ascii_alphanumeric() && *c != '-')
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            Some(format!("transaction-{}", &rest[..end]))
        })
        .filter(|id| !id.is_empty())
}

fn engine_command_error(output: &CappedCommandOutput) -> String {
    let stderr = output.stderr.trim();
    let stdout = output.stdout.trim();
    let detail = if !stderr.is_empty() {
        stderr.to_string()
    } else if !stdout.is_empty() {
        stdout.to_string()
    } else {
        format!("exit code {}", output.code)
    };
    format!("The real RefactorKit engine did not produce a usable result: {detail}")
}

// -----------------------------------------------------------------------------
// Request validation helpers (shared with the daemon contract conventions)
// -----------------------------------------------------------------------------

fn validate_symbol(symbol: &str) -> Result<String, String> {
    let symbol = symbol.trim();
    if symbol.is_empty() || symbol.len() > MAX_TEXT_BYTES {
        return Err("RefactorKit engine symbol must be non-empty and bounded.".to_string());
    }
    if symbol.chars().any(char::is_control) || symbol.contains(['/', '\\']) {
        return Err("RefactorKit engine symbol must not contain control characters or path separators.".to_string());
    }
    Ok(symbol.to_string())
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        Err("Invalid RefactorKit engine protocol identifier.".to_string())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    type TestMutex<T> = Mutex<T>;
    static ENGINE_LOCK: OnceLock<TestMutex<()>> = OnceLock::new();
    fn engine_env_lock() -> std::sync::MutexGuard<'static, ()> {
        ENGINE_LOCK.get_or_init(|| TestMutex::new(())).lock().unwrap()
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("real-engine-{label}-{id}"));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    /// The real daemon validates workspace authority against the canonical workspace
    /// (`canonical_workspace()`), not a test temp dir, so tests bind the real id.
    fn workspace_id() -> String {
        workspace_id_for_path(&canonical_workspace().unwrap())
    }

    /// A deterministic fake engine CLI harness. It is a harness only and is never
    /// reported as real-engine evidence; tests assert the daemon reports real-engine
    /// capability from the engine's own advertised report, not the harness output.
    fn install_engine_harness(
        root: &Path,
        capabilities: Option<&str>,
        preview_stdout: &str,
        rollback_advertised: bool,
    ) -> PathBuf {
        let script = root.join(format!(
            "engine-harness-{}.sh",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let caps_json = capabilities.unwrap_or("{}");
        let body = format!(
            "#!/bin/sh\ncase \"$1\" in\n  --version) echo 'RefactorKit 0.7.0-SNAPSHOT (API 0.2)' ;;\n  capabilities) printf '%s\\n' '{caps_json}' ;;\n  --help) cat <<'HELP'\nrefactorkit scan <path>\nrefactorkit symbols <path>\nrefactorkit diagnostics <path>\nrefactorkit references --symbol <fqcn> [<path>]\nrefactorkit definition --symbol <fqcn> [<path>]\nrefactorkit rename --symbol <fqcn> --to <name> [--apply] [<path>]\nrefactorkit rename-member --symbol <fqcn> --to <name> [--apply] [<path>]\nrefactorkit extract-method --file <path> [--apply]\nrefactorkit change-signature --symbol <fqcn> [--apply] [<path>]\nrefactorkit move-class --symbol <fqcn> --to-package <pkg> [--apply] [<path>]\nrefactorkit safe-delete --symbol <fqcn> [--apply] [<path>]\n{rollback_line}\nHELP\n;;\n  rename) printf '%s' '{preview_stdout}' ;;\n  *) echo 'unsupported' >&2; exit 1 ;;\nesac\n",
            caps_json = caps_json,
            preview_stdout = preview_stdout,
            rollback_line = if rollback_advertised {
                "refactorkit patch rollback <transaction-id> [--force] [--root <path>]"
            } else {
                ""
            },
        );
        fs::write(&script, body).unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).unwrap();
        env::set_var("IDE_REFACTORKIT_ENGINE", &script);
        script
    }

    fn remove_engine_override() {
        env::remove_var("IDE_REFACTORKIT_ENGINE");
    }

    /// An executable engine override that never reports version/capability metadata,
    /// forcing the honest-unavailable branch deterministically even when a real engine
    /// is installed on this host.
    fn install_unreported_engine(root: &Path) -> PathBuf {
        let script = root.join(format!(
            "unreported-engine-{}.sh",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&script, "#!/bin/sh\nexit 1\n").unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).unwrap();
        env::set_var("IDE_REFACTORKIT_ENGINE", &script);
        script
    }

    fn java_capabilities() -> String {
        r#"{"schemaVersion":1,"adapters":[{"languageId":"java","extensions":["java"],"backend":"eclipse-jdt-3.44","runtime":{"executionMode":"in-process","supportsTimeout":false,"supportsCancellation":false,"usesWorkspaceOverlay":false,"recordsProcessProvenance":false,"limits":{"requestTimeoutMillis":null,"maxInputBytes":null,"maxOutputBytes":null,"maxProcesses":null}},"capabilities":[{"operation":"definition","stability":"experimental","evidence":"compiler","mutationAuthority":"none","backend":"eclipse-jdt-3.44"},{"operation":"references","stability":"experimental","evidence":"compiler","mutationAuthority":"none","backend":"eclipse-jdt-3.44"},{"operation":"renameClass","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"renameMember","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"extractMethod","stability":"experimental","evidence":"compiler","mutationAuthority":"proposal-only","backend":"eclipse-jdt-3.44"},{"operation":"changeSignature.addParameter","stability":"experimental","evidence":"compiler","mutationAuthority":"proposal-only","backend":"eclipse-jdt-3.44"},{"operation":"moveClass","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"safeDelete","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"}]}]}"#.to_string()
    }

    #[test]
    #[cfg(unix)]
    fn engine_discovery_and_capability_are_authoritative_from_engine_report() {
        let _lock = engine_env_lock();
        let root = temp_workspace("capability");
        let script = install_engine_harness(&root, Some(&java_capabilities()), "Operation: renameClass\nStatus: PREVIEW\nRename A -> B\nAffected files:\n- src/A.java\nPatch:\n--- a/src/A.java\n+++ b/src/A.java\n" , true);
        let probe = discover_real_engine().unwrap();
        assert_eq!(probe.path, script.canonicalize().unwrap());
        assert_eq!(probe.version, "0.7.0-SNAPSHOT");
        let caps = get_refactorkit_engine_capabilities().unwrap();
        assert!(caps.engine_discovered);
        assert_eq!(caps.version.as_deref(), Some("0.7.0-SNAPSHOT"));
        // Authoritative operational surface: no rename-local-variable (engine does not
        // advertise a java renameLocalVariable operation).
        assert!(caps.operations.contains(&"rename-class".to_string()));
        assert!(!caps.operations.contains(&"rename-local-variable".to_string()));
        assert!(caps.operational_surface.contains(&"scan".to_string()));
        assert!(caps.operational_surface.contains(&"extract-method".to_string()));
        assert!(caps.rollback_advertised);
        assert!(caps.preview_read_only);
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_unavailable_when_no_wrapper_path_or_installed_path() {
        let _lock = engine_env_lock();
        let root = temp_workspace("unavailable");
        // Force the honest-unavailable branch: an engine that exists but never reports
        // version/capability metadata is treated as unavailable (no fabrication).
        install_unreported_engine(&root);
        let caps = get_refactorkit_engine_capabilities().unwrap();
        assert!(!caps.engine_discovered);
        assert!(caps.path.is_none());
        assert!(caps.version.is_none());
        assert!(caps.operations.is_empty());
        assert!(caps.reason.is_some());
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn real_engine_preview_is_read_only_and_grants_no_apply_authority() {
        let _lock = engine_env_lock();
        let root = temp_workspace("preview");
        install_engine_harness(&root, Some(&java_capabilities()), "Operation: renameClass\nStatus: PREVIEW\nRename A -> B\nAffected files:\n- src/A.java\nPatch:\n--- a/src/A.java\n+++ b/src/A.java\nUse --apply to apply this change.\n" , true);
        let state = RefactorKitDaemonState::default();
        let request = EnginePreviewRequest {
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change: EngineRefactoringChange {
                new_name: Some("B".to_string()),
                from_name: None,
                new_package: None,
                old_parameter: None,
                new_parameter: None,
            },
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "preview-req-1".to_string(),
        };
        let result = preview_refactoring(request, &state).unwrap();
        assert_eq!(result["operation"], "rename-class");
        assert_eq!(result["status"], "ready");
        assert_eq!(result["grantsApplyAuthority"], false);
        assert_eq!(result.pointer("/applyEligibility/eligible"), Some(&Value::Bool(false)));
        assert_eq!(result["provider"], "refactorkit");
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_binds_exact_reviewed_plan_and_approval() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply");
        install_engine_harness(&root, Some(&java_capabilities()), "Operation: renameClass\nStatus: PREVIEW\nAffected files:\n- src/A.java\nApplied. Transaction: transaction-abc123\nTo rollback: refactorkit patch rollback transaction-abc123\n" , true);
        let state = RefactorKitDaemonState::default();
        let preview = EnginePreviewRequest {
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change: EngineRefactoringChange {
                new_name: Some("B".to_string()),
                from_name: None,
                new_package: None,
                old_parameter: None,
                new_parameter: None,
            },
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-req-1".to_string(),
        };
        let previewed = preview_refactoring(preview, &state).unwrap();
        let plan_id = previewed["planId"].as_str().unwrap().to_string();
        let apply = EngineApplyRequest {
            plan_id: plan_id.clone(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change: EngineRefactoringChange {
                new_name: Some("B".to_string()),
                from_name: None,
                new_package: None,
                old_parameter: None,
                new_parameter: None,
            },
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-req-1".to_string(),
            approval: ApprovalEvidence {
                approval_id: "approval-1".to_string(),
                approved_plan_id: plan_id.clone(),
                approved_at: "2026-08-27T00:00:00Z".to_string(),
            },
        };
        let result = apply_refactoring(apply, &state).unwrap();
        assert_eq!(result["outcome"], "applied");
        assert_eq!(result["transactionId"], "transaction-abc123");
        assert_eq!(result["planId"], plan_id);
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_refuses_unknown_or_mismatched_plan() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-refuse");
        install_engine_harness(&root, Some(&java_capabilities()), "Operation: renameClass\nStatus: PREVIEW\n" , true);
        let state = RefactorKitDaemonState::default();
        let apply = EngineApplyRequest {
            plan_id: "engine-plan-unknown".to_string(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change: EngineRefactoringChange {
                new_name: Some("B".to_string()),
                from_name: None,
                new_package: None,
                old_parameter: None,
                new_parameter: None,
            },
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-req-2".to_string(),
            approval: ApprovalEvidence {
                approval_id: "approval-2".to_string(),
                approved_plan_id: "engine-plan-unknown".to_string(),
                approved_at: "2026-08-27T00:00:00Z".to_string(),
            },
        };
        let error = apply_refactoring(apply, &state).unwrap_err();
        assert!(error.contains("fresh preview and review"));
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn structural_surface_delegation_reports_real_engine_command_result() {
        let _lock = engine_env_lock();
        let root = temp_workspace("structural");
        install_engine_harness(&root, Some(&java_capabilities()), "" , true);
        let result = run_engine_scan().unwrap();
        assert!(!result.success);
        assert!(!result.stdout.is_empty() || !result.stderr.is_empty());
        assert!(result.engine_version == "0.7.0-SNAPSHOT");
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn derive_surface_is_authoritative_and_never_infers_fixture_or_version() {
        let caps: Value = serde_json::from_str(&java_capabilities()).unwrap();
        let help = "refactorkit scan <path>\nrefactorkit symbols <path>\nrefactorkit diagnostics <path>\nrefactorkit patch rollback <id>\n";
        let (operations, surface, rollback) = derive_surface(Some(&caps), help);
        // rename-local-variable is NOT advertised: the engine has no java
        // renameLocalVariable operation and version/help cannot infer it.
        assert!(!operations.contains(&"rename-local-variable".to_string()));
        assert!(operations.contains(&"change-method-signature".to_string()));
        assert!(surface.contains(&"scan".to_string()));
        assert!(surface.contains(&"extract-method".to_string()));
        assert!(rollback);
    }

    #[test]
    #[cfg(unix)]
    fn engine_rollback_is_exposed_only_when_advertised() {
        let _lock = engine_env_lock();
        let root = temp_workspace("rollback");
        install_engine_harness(&root, Some(&java_capabilities()), "" , false);
        let state = RefactorKitDaemonState::default();
        // No advertised transaction, so rollback must refuse.
        let request = EngineRollbackRequest {
            transaction_id: "transaction-nope".to_string(),
            operation: RefactoringOperation::RenameClass,
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            request_id: "rollback-req-1".to_string(),
        };
        let error = rollback_refactoring(request, &state).unwrap_err();
        assert!(error.contains("does not authoritatively advertise"));
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }
}
