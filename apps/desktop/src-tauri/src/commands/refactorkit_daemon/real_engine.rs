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
//! - apply re-derives the plan in READ-ONLY mode (no `--apply`) and compares it
//!   against the retained preview artifact BEFORE any mutating invocation; a
//!   divergent plan is refused with no write and requires a fresh preview + review;
//! - only when the read-only re-preview is identical does apply run the real
//!   transformation with `--apply`, bound to the exact reviewed plan (operation +
//!   target) under explicit approval; a changed or replaced plan requires a fresh
//!   preview and review before any Apply;
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

use super::application::validate_refactoring_target;
use super::application::{
    lock, EnginePlanGuard, RefactorKitDaemonState, RefactorKitPreviewArtifact,
};
use super::capability_policy::evidence_blocks_managed_mutation;
use super::contract::{
    normalize_refactoring_target, refactor_operation_requires_intent, ApprovalEvidence,
    RefactorKitChangeIntent, RefactoringOperation, RefactoringSelection, RefactoringTarget,
    WorkspaceAuthority,
};
use super::path_policy::{canonical_workspace, require_generation, safe_path, validate_workspace};

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
const CANONICAL_OPERATIONS: [&str; 18] = [
    "rename-class",
    "rename-member",
    "rename-local-variable",
    "move-class",
    "change-method-signature",
    "extract-constant",
    "extract-variable",
    "extract-parameter",
    "extract-field",
    "pull-up-member",
    "push-down-member",
    "move-member",
    "inline-variable",
    "inline-constant",
    "encapsulate-field",
    "safe-delete",
    "format-file",
    "organize-imports",
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
    pub(super) managed_operations: Vec<String>,
    pub(super) operational_surface: Vec<String>,
    pub(super) rollback_advertised: bool,
    pub(super) preview_read_only: bool,
    pub(super) reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnginePreviewRequest {
    pub(super) project_context: Option<super::java_context_refactoring::ProjectContext>,
    pub(super) formatter_profile:
        Option<crate::commands::java_language::JavaLanguageFormatterProfile>,
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) change_intent: Option<RefactorKitChangeIntent>,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineApplyRequest {
    pub(super) project_context: Option<super::java_context_refactoring::ProjectContext>,
    pub(super) formatter_profile:
        Option<crate::commands::java_language::JavaLanguageFormatterProfile>,
    pub(super) formatter_profile_sha256: Option<String>,
    pub(super) plan_id: String,
    pub(super) operation: RefactoringOperation,
    pub(super) target: RefactoringTarget,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) change_intent: Option<RefactorKitChangeIntent>,
    pub(super) authority: WorkspaceAuthority,
    pub(super) selection_generation: u64,
    pub(super) request_id: String,
    pub(super) approval: ApprovalEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineRollbackRequest {
    pub(super) project_context: Option<super::java_context_refactoring::ProjectContext>,
    pub(super) expected_snapshot_hash: Option<String>,
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
        let allowed =
            cfg!(test) || env::var("IDE_ALLOW_REFACTORKIT_ENGINE_OVERRIDE").as_deref() == Ok("1");
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
            return Ok(candidate
                .canonicalize()
                .ok()
                .unwrap_or_else(|| candidate.clone()));
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

fn real_engine_capabilities(probe: &RealEngineProbe, workspace_id: &str) -> RealEngineCapabilities {
    let (operations, operational_surface, rollback) =
        derive_surface(probe.capabilities.as_ref(), &probe.help);
    let managed_operations = derive_managed_operations(probe.capabilities.as_ref(), &operations);
    RealEngineCapabilities {
        engine_discovered: true,
        path: Some(probe.path.display().to_string()),
        version: Some(probe.version.clone()),
        workspace_id: workspace_id.to_string(),
        operations,
        managed_operations,
        operational_surface,
        rollback_advertised: rollback,
        preview_read_only: true,
        reason: None,
    }
}

fn unavailable_real_engine_capabilities(
    workspace_id: &str,
    reason: &str,
) -> RealEngineCapabilities {
    RealEngineCapabilities {
        engine_discovered: false,
        path: None,
        version: None,
        workspace_id: workspace_id.to_string(),
        operations: Vec::new(),
        managed_operations: Vec::new(),
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
fn derive_surface(capabilities: Option<&Value>, help: &str) -> (Vec<String>, Vec<String>, bool) {
    let java = capabilities.and_then(java_adapter);
    let mut operations = Vec::new();
    if let Some(java) = java {
        for canonical in CANONICAL_OPERATIONS {
            let advertised = match canonical {
                "rename-class" => java_has_operation(java, "renameClass"),
                "rename-member" => java_has_operation(java, "renameMember"),
                "rename-local-variable" => java_has_operation(java, "renameLocalVariable"),
                "move-class" => java_has_operation(java, "moveClass"),
                // The IDE's current change-signature request renames one parameter.
                // Do not advertise the broader operation based on add/remove/reorder
                // variants that may be proposal-only.
                "change-method-signature" => {
                    java_has_operation(java, "changeSignature.renameParameter")
                }
                "extract-constant" => java_has_operation(java, "extractConstant"),
                "extract-variable" => java_has_operation(java, "extractVariable"),
                "extract-parameter" => java_has_operation(java, "extractParameter"),
                "extract-field" => java_has_operation(java, "extractField"),
                "pull-up-member" => java_has_operation(java, "pullUpMember"),
                "push-down-member" => java_has_operation(java, "pushDownMember"),
                "move-member" => java_has_operation(java, "moveMember"),
                "inline-variable" => java_has_operation(java, "inlineVariable"),
                "inline-constant" => java_has_operation(java, "inlineConstant"),
                "encapsulate-field" => java_has_operation(java, "encapsulateField"),
                "safe-delete" => java_has_operation(java, "safeDelete"),
                "format-file" => {
                    java_has_managed_file_operation(java, "formatFile")
                        && help.contains("refactorkit format-file")
                }
                "organize-imports" => {
                    java_has_managed_file_operation(java, "organizeImports")
                        && help.contains("refactorkit organize-imports")
                }
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
            "change-signature" => {
                java.is_some_and(|j| java_has_operation_prefix(j, "changeSignature"))
            }
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

/// Advertise per-operation managed mutation authority from the engine's own metadata.
/// The general operation list can include read-only or proposal-only semantic actions,
/// so callers must not infer Apply authority from membership alone.
fn derive_managed_operations(capabilities: Option<&Value>, operations: &[String]) -> Vec<String> {
    let Some(java) = capabilities.and_then(java_adapter) else {
        return Vec::new();
    };
    operations
        .iter()
        .filter(|operation| {
            let provider_operation = match operation.as_str() {
                "rename-class" => "renameClass",
                "rename-member" => "renameMember",
                "rename-local-variable" => "renameLocalVariable",
                "move-class" => "moveClass",
                "change-method-signature" => "changeSignature.renameParameter",
                "extract-constant" => "extractConstant",
                "extract-variable" => "extractVariable",
                "extract-parameter" => "extractParameter",
                "extract-field" => "extractField",
                "pull-up-member" => "pullUpMember",
                "push-down-member" => "pushDownMember",
                "move-member" => "moveMember",
                "inline-variable" => "inlineVariable",
                "inline-constant" => "inlineConstant",
                "encapsulate-field" => "encapsulateField",
                "safe-delete" => "safeDelete",
                "format-file" => "formatFile",
                "organize-imports" => "organizeImports",
                _ => return false,
            };
            if matches!(operation.as_str(), "format-file" | "organize-imports") {
                java_has_managed_file_operation(java, provider_operation)
            } else {
                java_has_managed_operation(java, provider_operation)
            }
        })
        .cloned()
        .collect()
}

fn java_adapter(caps: &Value) -> Option<&Value> {
    caps.get("adapters")
        .and_then(Value::as_array)
        .and_then(|adapters| {
            adapters
                .iter()
                .find(|adapter| adapter.get("languageId").and_then(Value::as_str) == Some("java"))
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

fn java_has_managed_file_operation(adapter: &Value, name: &str) -> bool {
    java_has_managed_operation(adapter, name)
        && adapter
            .get("capabilities")
            .and_then(Value::as_array)
            .is_some_and(|entries| {
                entries.iter().any(|entry| {
                    entry.get("operation").and_then(Value::as_str) == Some(name)
                        && entry
                            .get("extensions")
                            .and_then(Value::as_array)
                            .is_some_and(|extensions| {
                                extensions
                                    .iter()
                                    .any(|extension| extension.as_str() == Some("java"))
                            })
                })
            })
}

fn java_has_managed_operation(adapter: &Value, name: &str) -> bool {
    adapter
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry.get("operation").and_then(Value::as_str) == Some(name)
                    && entry.get("stability").and_then(Value::as_str) == Some("stable")
                    && entry.get("mutationAuthority").and_then(Value::as_str)
                        == Some("managed-stable")
                    && matches!(
                        entry.get("evidence").and_then(Value::as_str),
                        Some("compiler" | "language-server" | "native-ast" | "structural-parse")
                    )
            })
        })
}

/// Capability-before-offer: the requested canonical operation is delegated only when
/// the real engine authoritatively advertises it.
fn require_operation_advertised(
    probe: &RealEngineProbe,
    operation: RefactoringOperation,
) -> Result<(), String> {
    let (operations, _, _) = derive_surface(probe.capabilities.as_ref(), &probe.help);
    let project_context_operation_advertised = operation == RefactoringOperation::InlineMethod
        && probe
            .capabilities
            .as_ref()
            .and_then(java_adapter)
            .is_some_and(|java| java_has_operation(java, "inlineMethod"));
    if operations.contains(&operation.as_str().to_string()) || project_context_operation_advertised
    {
        Ok(())
    } else {
        Err(format!(
            "The real RefactorKit engine does not authoritatively advertise the {} operation.",
            operation.as_str()
        ))
    }
}

/// Apply is admitted only for the exact operation that the engine marks as a
/// stable, managed mutation. A sibling proposal-only capability cannot grant it.
fn require_managed_operation_authority(
    probe: &RealEngineProbe,
    operation: RefactoringOperation,
) -> Result<(), String> {
    if matches!(
        operation,
        RefactoringOperation::CreateMavenModule | RefactoringOperation::CreateGradleModule
    ) {
        return Err(
            "Java module creation requires the synchronized RefactorKit project-transform route."
                .into(),
        );
    }
    let java = probe.capabilities.as_ref().and_then(java_adapter);
    let capability = match operation {
        RefactoringOperation::CreateMavenModule => "java.createMavenModule",
        RefactoringOperation::CreateGradleModule => "java.createGradleModule",
        RefactoringOperation::RenameGradleModule => "java.renameGradleModule",
        RefactoringOperation::RenameClass => "renameClass",
        RefactoringOperation::RenameMember => "renameMember",
        RefactoringOperation::RenameLocalVariable => "renameLocalVariable",
        RefactoringOperation::MoveClass => "moveClass",
        RefactoringOperation::MovePackage => "movePackage",
        RefactoringOperation::MoveSourceRoot => "moveSourceRoot",
        RefactoringOperation::ChangeMethodSignature => "changeSignature.renameParameter",
        RefactoringOperation::ChangeMethodParameterType => "changeSignature.changeParameterType",
        RefactoringOperation::AddMethodParameter => "changeSignature.addParameter",
        RefactoringOperation::RemoveMethodParameter => "changeSignature.removeParameter",
        RefactoringOperation::ReorderMethodParameters => "changeSignature.reorderParameters",
        RefactoringOperation::MakeStatic => "makeStatic",
        RefactoringOperation::MakePublic => "changeVisibility",
        RefactoringOperation::ChangeFieldType => "changeType",
        RefactoringOperation::InlineMethod => "inlineMethod",
        RefactoringOperation::IntroduceParameterObject => "introduceParameterObject",
        RefactoringOperation::ExtractDelegate => "extractDelegate",
        RefactoringOperation::ExtractConstant => "extractConstant",
        RefactoringOperation::ExtractVariable => "extractVariable",
        RefactoringOperation::ExtractMethod => "extractMethod",
        RefactoringOperation::ExtractParameter => "extractParameter",
        RefactoringOperation::ExtractField => "extractField",
        RefactoringOperation::ExtractInterface => "extractInterface",
        RefactoringOperation::ExtractSuperclass => "extractSuperclass",
        RefactoringOperation::PullUpMember => "pullUpMember",
        RefactoringOperation::PushDownMember => "pushDownMember",
        RefactoringOperation::MoveMember => "moveMember",
        RefactoringOperation::InlineVariable => "inlineVariable",
        RefactoringOperation::InlineConstant => "inlineConstant",
        RefactoringOperation::EncapsulateField => "encapsulateField",
        RefactoringOperation::SafeDelete => "safeDelete",
        RefactoringOperation::FormatFile => "formatFile",
        RefactoringOperation::OrganizeImports => "organizeImports",
        RefactoringOperation::BatchCleanup => "batchCleanup",
    };
    if java.is_some_and(|adapter| java_has_managed_operation(adapter, capability)) {
        Ok(())
    } else {
        Err(format!(
            "The real RefactorKit engine does not advertise stable managed mutation authority for the {} operation.",
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
    if request.project_context.is_some() {
        return super::java_context_refactoring::preview(request, state);
    }
    if matches!(
        request.operation,
        RefactoringOperation::CreateMavenModule
            | RefactoringOperation::CreateGradleModule
            | RefactoringOperation::RenameGradleModule
            | RefactoringOperation::MovePackage
            | RefactoringOperation::ChangeMethodParameterType
            | RefactoringOperation::RemoveMethodParameter
            | RefactoringOperation::ReorderMethodParameters
            | RefactoringOperation::MakeStatic
            | RefactoringOperation::MakePublic
            | RefactoringOperation::ChangeFieldType
            | RefactoringOperation::InlineMethod
            | RefactoringOperation::IntroduceParameterObject
            | RefactoringOperation::ExtractDelegate
            | RefactoringOperation::ExtractConstant
            | RefactoringOperation::ExtractVariable
            | RefactoringOperation::ExtractMethod
            | RefactoringOperation::ExtractParameter
            | RefactoringOperation::ExtractField
            | RefactoringOperation::ExtractInterface
            | RefactoringOperation::ExtractSuperclass
            | RefactoringOperation::PullUpMember
            | RefactoringOperation::PushDownMember
            | RefactoringOperation::MoveMember
            | RefactoringOperation::EncapsulateField
    ) {
        return Err(format!(
            "{} requires a synchronized Java project context.",
            request.operation.as_str()
        ));
    }
    let root = validate_workspace(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    validate_refactoring_target(&root, &request.target)?;
    let probe = discover_real_engine()?;
    require_operation_advertised(&probe, request.operation)?;
    // The preview change descriptor is resolved from the canonical changeIntent.
    // An operation that requires intent but has none is honestly refused (never
    // fabricated).
    let intent = resolve_change_intent(request.operation, request.change_intent.as_ref())?;
    let args = build_refactor_args(
        request.operation,
        &request.target,
        intent.as_ref(),
        false,
        &root,
    )?;
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
            operation: request.operation,
            target: request.target.clone(),
            change_intent: intent,
            apply_eligible: normalized["applyEligibility"]["eligible"] == true,
            preview_artifact: extract_preview_artifact(&normalized),
            workspace_id: request.authority.workspace_id.clone(),
            workspace_generation: request.authority.workspace_generation,
            selection_generation: request.selection_generation,
            request_id: request.request_id.clone(),
        },
    );
    Ok(normalized)
}

pub(super) fn preview_refactoring_with_project_context(
    request: EnginePreviewRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::JavaProjectContextState,
) -> Result<Value, String> {
    if request
        .project_context
        .as_ref()
        .is_some_and(|context| context.gradle.is_some())
    {
        return super::java_context_refactoring::preview_in_gradle_session(
            request,
            state,
            project_context_state,
        );
    }
    preview_refactoring(request, state)
}

pub(super) fn apply_refactoring(
    request: EngineApplyRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    if request.project_context.is_some() {
        return super::java_context_refactoring::apply(request, state);
    }
    if request.operation == RefactoringOperation::MovePackage {
        return Err("Java package moves require a synchronized Java project context.".into());
    }
    if matches!(
        request.operation,
        RefactoringOperation::CreateMavenModule | RefactoringOperation::CreateGradleModule
    ) {
        return Err("Java module creation requires a synchronized Java project context.".into());
    }
    if matches!(
        request.operation,
        RefactoringOperation::ChangeMethodParameterType
            | RefactoringOperation::RemoveMethodParameter
            | RefactoringOperation::ReorderMethodParameters
    ) {
        return Err(
            "Changing or reordering Java method parameters requires a synchronized Java project context."
                .into(),
        );
    }
    if request.operation == RefactoringOperation::MakeStatic {
        return Err("Make Static requires a synchronized Java project context.".into());
    }
    if request.operation == RefactoringOperation::MakePublic {
        return Err("Make Public requires a synchronized Java project context.".into());
    }
    if matches!(
        request.operation,
        RefactoringOperation::InlineMethod
            | RefactoringOperation::IntroduceParameterObject
            | RefactoringOperation::ExtractDelegate
    ) {
        return Err(format!("{} requires a synchronized Java project context.", request.operation.as_str()));
    }
    let root = validate_workspace(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
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
        return Err(
            "Approval does not bind the requested real-engine RefactorKit plan.".to_string(),
        );
    }
    validate_refactoring_target(&root, &request.target)?;
    let probe = discover_real_engine()?;
    require_operation_advertised(&probe, request.operation)?;
    require_managed_operation_authority(&probe, request.operation)?;

    let mut manager = lock(state)?;
    let guard = manager
        .engine_plans
        .get(&request.plan_id)
        .cloned()
        .ok_or_else(|| {
            "Real-engine plan is stale or unknown; a fresh preview and review are required."
                .to_string()
        })?;
    if guard.operation != request.operation
        || guard.target.kind != request.target.kind
        || guard.target.path != request.target.path
        || guard.target.identity != request.target.identity
        || !selection_matches(&guard.target.selection, &request.target.selection)
        || guard.workspace_id != request.authority.workspace_id
        || guard.workspace_generation != request.authority.workspace_generation
        || guard.selection_generation != request.selection_generation
        || guard.request_id != request.request_id
    {
        return Err("Real-engine plan approval guard mismatch; a changed plan requires a fresh preview and review.".to_string());
    }
    if !guard.apply_eligible {
        return Err(
            "This RefactorKit plan is review-only because it reports lexical or no semantic evidence."
                .to_string(),
        );
    }
    // RQR-RFK-ENGINE-002: Apply binds to the exact reviewed plan. The arguments
    // are built from the retained change descriptor + target, never rebuilt from
    // the fresh request. RQR-RFK-ENGINE-001: apply must REQUIRE change intent
    // for every operation that needs it (rename-*, move-class,
    // change-method-signature) and reject intent for no-parameter actions. Absent or
    // mismatched intent is honestly refused, never accepted via `if let Some`.
    let request_intent = resolve_change_intent(request.operation, request.change_intent.as_ref())?;
    if guard.change_intent != request_intent {
        return Err("Real-engine plan approval guard mismatch; a changed plan requires a fresh preview and review.".to_string());
    }
    // The retained preview artifact must carry non-empty affected files, a
    // rendered patch/diff, and review evidence — a plan without reviewed evidence
    // is not applicable and must not be applied.
    if guard.preview_artifact.affected_files.is_empty()
        || guard.preview_artifact.patch.is_empty()
        || guard.preview_artifact.review_evidence.is_empty()
    {
        manager.engine_plans.remove(&request.plan_id);
        return Err("Real-engine plan was not reviewed with usable preview evidence; a fresh preview and review are required.".to_string());
    }
    // RQR-RFK-ENGINE-002-POST-WRITE: BEFORE any mutating CLI invocation, re-derive
    // the plan in READ-ONLY mode (no --apply) and compare against the retained
    // preview artifact. A divergent plan must NEVER be written — refuse with no
    // write and require a fresh preview + review before any Apply.
    let preview_args = build_refactor_args(
        guard.operation,
        &guard.target,
        guard.change_intent.as_ref(),
        false,
        &root,
    )?;
    let preview_output = run_capped_command(
        &probe.path,
        &preview_args,
        &root,
        COMMAND_TIMEOUT,
        MAX_OUTPUT_BYTES,
    )?;
    if !preview_output.success {
        manager.engine_plans.remove(&request.plan_id);
        return Err("Real-engine re-preview failed; a fresh preview and review are required before any Apply.".to_string());
    }
    if !apply_outcome_matches_preview(
        &preview_output,
        &root,
        guard.operation,
        &guard.preview_artifact,
    ) {
        manager.engine_plans.remove(&request.plan_id);
        return Err("Real-engine re-preview diverges from the reviewed plan; the plan changed and requires a fresh preview and review before any Apply.".to_string());
    }
    // The read-only re-preview is identical to the reviewed plan; only now may the
    // mutating --apply run, bound to the exact reviewed plan.
    let args = build_refactor_args(
        guard.operation,
        &guard.target,
        guard.change_intent.as_ref(),
        true,
        &root,
    )?;
    let output = run_capped_command(&probe.path, &args, &root, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES)?;
    // RQR-RFK-ENGINE-002: before reporting applied, the CLI output patch,
    // affected files, and review evidence must match the retained exact preview
    // artifact. A differing output means the plan changed and requires a fresh
    // preview and review — never accept a rerun that diverges from the reviewed
    // plan as the reviewed result.
    if !apply_outcome_matches_preview(&output, &root, guard.operation, &guard.preview_artifact) {
        manager.engine_plans.remove(&request.plan_id);
        return Err("Real-engine apply output differs from the reviewed plan; the plan changed and requires a fresh preview and review.".to_string());
    }
    let result = match normalize_engine_apply(&output, &request, &probe, &root) {
        Ok(result) => result,
        Err(error) => {
            // Applying is a write boundary. An uncorrelated outcome leaves transaction
            // state indeterminate, so the local guard must not survive it.
            manager.engine_plans.remove(&request.plan_id);
            return Err(error);
        }
    };
    let transaction_id = result
        .get("outcome")
        .and_then(Value::as_str)
        .filter(|outcome| *outcome == "applied")
        .and_then(|_| result.get("transactionId").and_then(Value::as_str))
        .map(ToString::to_string);
    manager.engine_plans.remove(&request.plan_id);
    if let Some(transaction_id) = transaction_id {
        manager.engine_transactions.insert(
            transaction_id,
            super::application::TransactionGuard {
                workspace_id: request.authority.workspace_id.clone(),
                workspace_generation: request.authority.workspace_generation,
                operation: Some(request.operation.as_str().to_string()),
                rollback_files: rollback_file_changes(&result),
            },
        );
    }
    Ok(result)
}

pub(super) fn apply_refactoring_with_project_context(
    request: EngineApplyRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::JavaProjectContextState,
) -> Result<Value, String> {
    if request
        .project_context
        .as_ref()
        .is_some_and(|context| context.gradle.is_some())
    {
        return super::java_context_refactoring::apply_in_gradle_session(
            request,
            state,
            project_context_state,
        );
    }
    apply_refactoring(request, state)
}

pub(super) fn rollback_refactoring(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    if request.project_context.is_some() {
        return super::java_context_refactoring::rollback(request, state);
    }
    if request.operation == RefactoringOperation::MovePackage {
        return Err("Java package rollback requires its synchronized project context.".into());
    }
    if matches!(
        request.operation,
        RefactoringOperation::CreateMavenModule | RefactoringOperation::CreateGradleModule
    ) {
        return Err("Java module rollback requires its synchronized Java project context.".into());
    }
    if request.expected_snapshot_hash.is_some()
        || lock(state)?
            .java_transactions
            .contains_key(&request.transaction_id)
    {
        return Err(
            "An SDK-protected transaction requires its original Java project context.".into(),
        );
    }
    let root = validate_workspace(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let probe = discover_real_engine()?;
    // Rollback is exposed only when the real engine advertises patch-rollback.
    if !probe.help.contains("patch rollback") {
        return Err(
            "The real RefactorKit engine does not authoritatively advertise transaction rollback."
                .to_string(),
        );
    }
    let mut manager = lock(state)?;
    let guard = manager
        .engine_transactions
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
    let rolled_back =
        output.stdout.contains("Rolled back transaction") || output.stdout.contains("rolled back");
    if rolled_back {
        manager.engine_transactions.remove(&request.transaction_id);
    }
    Ok(json!({
        "transactionId": request.transaction_id,
        "rolledBack": rolled_back,
        "changedFiles": if rolled_back { guard.rollback_files } else { vec![] },
        "conflicts": [],
        "diagnostics": []
    }))
}

pub(super) fn rollback_refactoring_with_project_context(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::JavaProjectContextState,
) -> Result<Value, String> {
    if request
        .project_context
        .as_ref()
        .is_some_and(|context| context.gradle.is_some())
    {
        return super::java_context_refactoring::rollback_in_gradle_session(
            request,
            state,
            project_context_state,
        );
    }
    rollback_refactoring(request, state)
}

fn rollback_file_changes(result: &Value) -> Vec<Value> {
    result
        .get("changedFiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|file| {
            let mut inverse = file.clone();
            match file["change"].as_str() {
                Some("create") => inverse["change"] = json!("delete"),
                Some("delete") => inverse["change"] = json!("create"),
                Some("move") => {
                    if let Some(previous) = file.get("previousPath") {
                        inverse["path"] = previous.clone();
                        inverse["previousPath"] = file["path"].clone();
                    }
                }
                _ => {}
            }
            inverse
        })
        .collect()
}

pub(super) fn discard_refactoring(
    request: EngineDiscardRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    validate_workspace(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    require_generation(request.selection_generation)?;
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    let mut manager = lock(state)?;
    let removed = manager.engine_plans.remove(&request.plan_id).is_some();
    if let Some(active) = manager.java_refactoring.as_mut() {
        if active.discard(&request)? {
            return Ok(json!({"planId": request.plan_id, "discarded": true}));
        }
    }
    Ok(json!({"planId": request.plan_id, "discarded": removed}))
}

pub(super) fn discard_refactoring_with_project_context(
    request: EngineDiscardRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::JavaProjectContextState,
) -> Result<Value, String> {
    let has_gradle_plan = lock(state)?
        .java_project_context_plans
        .contains_key(&request.plan_id);
    if has_gradle_plan {
        if let Some(result) = super::java_context_refactoring::discard_in_gradle_session(
            &request,
            state,
            project_context_state,
        )? {
            return Ok(result);
        }
    }
    discard_refactoring(request, state)
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
    run_structural(
        StructuralAction::Definition,
        Some(validate_symbol(&symbol)?),
    )
}

pub(super) fn run_engine_references(symbol: String) -> Result<RealEngineCommandResult, String> {
    run_structural(
        StructuralAction::References,
        Some(validate_symbol(&symbol)?),
    )
}

pub(super) fn run_engine_diagnostics() -> Result<RealEngineCommandResult, String> {
    run_structural(StructuralAction::Diagnostics, None)
}

fn run_structural(
    action: StructuralAction,
    symbol: Option<String>,
) -> Result<RealEngineCommandResult, String> {
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
        && matches!(
            action,
            StructuralAction::Definition | StructuralAction::References
        ) {
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
        command: args
            .iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect(),
    })
}

// -----------------------------------------------------------------------------
// CLI args, plan correlation, and honest output normalization
// -----------------------------------------------------------------------------

fn build_refactor_args(
    operation: RefactoringOperation,
    target: &RefactoringTarget,
    intent: Option<&RefactorKitChangeIntent>,
    apply: bool,
    root: &Path,
) -> Result<Vec<OsString>, String> {
    if matches!(
        operation,
        RefactoringOperation::ExtractConstant
            | RefactoringOperation::ExtractVariable
            | RefactoringOperation::ExtractParameter
            | RefactoringOperation::ExtractField
            | RefactoringOperation::EncapsulateField
            | RefactoringOperation::InlineVariable
            | RefactoringOperation::InlineMethod
            | RefactoringOperation::IntroduceParameterObject
            | RefactoringOperation::ExtractDelegate
            | RefactoringOperation::InlineConstant
    ) {
        return Err(format!(
            "{} requires a synchronized Java project context.",
            operation.as_str()
        ));
    }
    let file_operation = matches!(
        operation,
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports
    );
    let move_source_root = operation == RefactoringOperation::MoveSourceRoot;
    if file_operation != (target.kind == "file")
        || (move_source_root
            && (target.kind != "source-root"
                || target.identity != target.path
                || target.selection.is_some()))
        || (!file_operation && !move_source_root && target.kind == "source-root")
    {
        return Err("Java file operations require a file target; semantic operations require a semantic target.".into());
    }
    if file_operation
        && (!target.path.ends_with(".java")
            || target.path.starts_with('/')
            || target.path.contains(['\\', ':'])
            || target
                .path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || target.identity != target.path
            || target.selection.is_some())
    {
        return Err("Java file operations require an exact workspace-relative Java file target without a selection.".into());
    }
    let mut args: Vec<OsString> = Vec::new();
    match operation {
        RefactoringOperation::BatchCleanup => {
            return Err("Batch cleanup requires a synchronized Java project context.".into());
        }
        RefactoringOperation::CreateMavenModule => {
            return Err(
                "Maven module creation requires a synchronized Java project context.".into(),
            );
        }
        RefactoringOperation::RenameGradleModule => {
            return Err("Gradle module rename requires a synchronized project context.".into());
        }
        RefactoringOperation::CreateGradleModule => {
            return Err(
                "Gradle module creation requires a synchronized Java project context.".into(),
            );
        }
        RefactoringOperation::MoveMember => {
            return Err("Move Member requires a synchronized Java project context.".into());
        }
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports => {
            args.extend([
                OsString::from(operation.as_str()),
                OsString::from(&target.path),
            ]);
            if apply {
                args.push(OsString::from("--apply"));
            }
            args.push(OsString::from("--root"));
            args.push(root.as_os_str().to_os_string());
            return Ok(args);
        }
        RefactoringOperation::RenameClass => {
            let name = intent_required(intent, "new_name", "rename-class requires newName")?;
            args.extend([
                OsString::from("rename"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--to"),
                OsString::from(name),
            ]);
        }
        RefactoringOperation::ExtractConstant => {
            return Err("Extract Constant requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ExtractVariable => {
            return Err("Extract Variable requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ExtractMethod => {
            return Err("Extract Method requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ExtractParameter => {
            return Err("Extract Parameter requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ExtractField => {
            return Err("Extract Field requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ExtractInterface => {
            return Err("Extract Interface requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ExtractSuperclass => {
            return Err("Extract Superclass requires a synchronized Java project context.".into());
        }
        RefactoringOperation::PullUpMember => {
            return Err("Pull Up Method requires a synchronized Java project context.".into());
        }
        RefactoringOperation::PushDownMember => {
            return Err("Push Down Method requires a synchronized Java project context.".into());
        }
        RefactoringOperation::InlineVariable => {
            return Err("Inline Variable requires a synchronized Java project context.".into());
        }
        RefactoringOperation::InlineMethod
        | RefactoringOperation::IntroduceParameterObject
        | RefactoringOperation::ExtractDelegate => {
            return Err(format!("{} requires a synchronized Java project context.", operation.as_str()));
        }
        RefactoringOperation::InlineConstant => {
            return Err("Inline Constant requires a synchronized Java project context.".into());
        }
        RefactoringOperation::EncapsulateField => {
            return Err("Encapsulate Field requires a synchronized Java project context.".into());
        }
        RefactoringOperation::RenameMember => {
            let name = intent_required(intent, "new_name", "rename-member requires newName")?;
            args.extend([
                OsString::from("rename-member"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--to"),
                OsString::from(name),
            ]);
        }
        RefactoringOperation::RenameLocalVariable => {
            let from = intent_required(
                intent,
                "from_name",
                "rename-local-variable requires fromName",
            )?;
            let to = intent_required(intent, "new_name", "rename-local-variable requires newName")?;
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
            let package = intent_required(intent, "new_package", "move-class requires newPackage")?;
            if intent
                .and_then(|value| value.target_path.as_deref())
                .is_some()
                || intent
                    .and_then(|value| value.target_module_id.as_deref())
                    .is_some()
            {
                return Err(
                    "An explicit move-class destination requires a synchronized Java project context."
                        .into(),
                );
            }
            args.extend([
                OsString::from("move-class"),
                OsString::from("--symbol"),
                OsString::from(&target.identity),
                OsString::from("--to-package"),
                OsString::from(package),
            ]);
        }
        RefactoringOperation::MovePackage => {
            return Err("Java package moves require a synchronized Java project context.".into());
        }
        RefactoringOperation::MoveSourceRoot => {
            let destination = intent_required(
                intent,
                "to",
                "move-source-root requires a project-relative destination path",
            )?;
            let destination = safe_path(&destination, root)?;
            args.extend([
                OsString::from("move-source-root"),
                OsString::from("--from"),
                OsString::from(&target.path),
                OsString::from("--to"),
                OsString::from(destination),
            ]);
            if apply {
                args.push(OsString::from("--apply"));
            }
            args.push(OsString::from("--root"));
            args.push(root.as_os_str().to_os_string());
            return Ok(args);
        }
        RefactoringOperation::ChangeMethodSignature => {
            let old = intent_required(
                intent,
                "old_parameter",
                "change-method-signature requires oldParameter",
            )?;
            let new = intent_required(
                intent,
                "new_parameter",
                "change-method-signature requires newParameter",
            )?;
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
        RefactoringOperation::AddMethodParameter => {
            return Err("Add Parameter requires a synchronized Java project context.".into());
        }
        RefactoringOperation::RemoveMethodParameter => {
            return Err("Remove Parameter requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ChangeMethodParameterType => {
            return Err(
                "Changing a Java method parameter type requires a synchronized Java project context."
                    .into(),
            );
        }
        RefactoringOperation::ReorderMethodParameters => {
            return Err(
                "Reordering Java method parameters requires a synchronized Java project context."
                    .into(),
            );
        }
        RefactoringOperation::MakeStatic => {
            return Err("Make Static requires a synchronized Java project context.".into());
        }
        RefactoringOperation::MakePublic => {
            return Err("Make Public requires a synchronized Java project context.".into());
        }
        RefactoringOperation::ChangeFieldType => {
            return Err("Field type change requires a synchronized Java project context.".into());
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

/// Resolve the effective change intent for an operation. An operation that
/// requires intent but has none is honestly refused (never fabricated).
/// RQR-RFK-ENGINE-001: no-parameter actions accept no change intent; any supplied
/// intent is honestly rejected.
fn resolve_change_intent(
    operation: RefactoringOperation,
    change_intent: Option<&RefactorKitChangeIntent>,
) -> Result<Option<RefactorKitChangeIntent>, String> {
    if !refactor_operation_requires_intent(operation) {
        if change_intent.is_some() {
            return Err(format!("{} accepts no change intent.", operation.as_str()));
        }
        return Ok(None);
    }
    if let Some(intent) = change_intent {
        intent.validate(operation)?;
        return Ok(Some(intent.clone()));
    }
    if refactor_operation_requires_intent(operation) {
        return Err(format!(
            "{} requires operation-specific change intent but none was provided.",
            operation.as_str()
        ));
    }
    Ok(None)
}

fn intent_required(
    intent: Option<&RefactorKitChangeIntent>,
    field: &str,
    message: &str,
) -> Result<String, String> {
    let Some(intent) = intent else {
        return Err(message.to_string());
    };
    let value = match field {
        "new_name" => intent.new_name.as_ref(),
        "from_name" => intent.from_name.as_ref(),
        "new_package" => intent.new_package.as_ref(),
        "to" => intent.to.as_ref(),
        "old_parameter" => intent.old_parameter.as_ref(),
        "new_parameter" => intent.new_parameter.as_ref(),
        "name" => intent.name.as_ref(),
        _ => None,
    };
    value
        .map(|value| value.trim().to_string())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= MAX_TEXT_BYTES
                && !value.chars().any(char::is_control)
        })
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
    let summary = parse_summary(text)
        .unwrap_or_else(|| "Real-engine preview produced no summary.".to_string());
    let affected_change = match request.operation {
        RefactoringOperation::SafeDelete => "delete",
        RefactoringOperation::MoveClass | RefactoringOperation::MoveSourceRoot => "move",
        _ => "edit",
    };
    let affected = parse_affected_files(text, root, affected_change)?;
    if matches!(
        request.operation,
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports
    ) && !affected.is_empty()
        && (affected.len() != 1 || affected[0]["path"].as_str() != Some(&request.target.path))
    {
        return Err("A Java file preview must affect only its requested source file.".into());
    }
    let rendered_diff = parse_patch(text).unwrap_or_default();
    let warnings = parse_warnings(text);
    let review_evidence = parse_review_evidence(text);
    let apply_eligible = !review_evidence.iter().any(|item| {
        item.get("kind")
            .and_then(Value::as_str)
            .is_some_and(evidence_blocks_managed_mutation)
    });
    // RQR-RFK-ENGINE-002: a successful preview requires non-empty affected files,
    // a rendered patch/diff, and review evidence. A zero-exit shell without these
    // is not a usable preview — it is honestly unavailable/refused, never
    // reported as status "ready".
    if affected.is_empty() || rendered_diff.is_empty() || review_evidence.is_empty() {
        return Err(
            "The real RefactorKit engine produced no usable preview evidence (non-empty affected files, a rendered patch/diff, and review evidence).".to_string(),
        );
    }
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
        "evidence": review_evidence,
        "affectedFiles": affected,
        "renderedDiff": rendered_diff,
        "structuredDiff": [],
        "warnings": warnings,
        "diagnosticsAfterPreview": [],
        "conflicts": [],
        "refusalReasons": [],
        "applyEligibility": {
            "eligible": apply_eligible,
            "blockers": if apply_eligible { vec![] } else { vec!["The provider reports lexical or no semantic evidence; review is available but Apply is not."] }
        },
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
    let affected_change = match request.operation {
        RefactoringOperation::SafeDelete => "delete",
        RefactoringOperation::MoveClass | RefactoringOperation::MoveSourceRoot => "move",
        _ => "edit",
    };
    let changed_files = parse_affected_files(text, root, affected_change)?;
    // RQR-RFK-ENGINE-006: `applied` requires a successful engine process (exit
    // code 0), non-empty changed files, and the engine's applied-transaction
    // report — NOT merely stdout containing "Applied. Transaction". A failing
    // engine process reports honest failure/indeterminate, never fabricated
    // applied.
    let outcome = if output.success
        && output.code == 0
        && !changed_files.is_empty()
        && (text.contains("Applied. Transaction:") || text.contains("Applied. Transaction"))
    {
        "applied"
    } else if output.success && (text.contains("refused") || text.contains("Refused")) {
        "refused"
    } else {
        "failed"
    };
    // RQR-RFK-ENGINE-003: primaryFile is serialized as a PATH STRING (not an
    // affected-file object), matching what refactorkit-tauri.ts requires.
    let primary_path = changed_files
        .first()
        .and_then(|file| file.get("path"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let transaction_id = parse_transaction_id(text);
    let mut result = json!({
        "planId": request.plan_id,
        "operation": request.operation.as_str(),
        "outcome": outcome,
        "changedFiles": changed_files,
        "primaryFile": primary_path.map_or(Value::Null, Value::String),
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

/// Review evidence reported by the engine on an `Evidence: <kind>` line. This is
/// the review evidence that makes a preview eligible for apply; a successful
/// preview must carry at least one non-empty evidence kind.
fn parse_review_evidence(text: &str) -> Vec<Value> {
    let mut evidence = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Evidence:") {
            let kind = rest.trim();
            if !kind.is_empty() {
                evidence.push(json!({"kind": kind, "summary": kind}));
            }
        }
    }
    evidence
}

/// Extracts the preview artifact (affected files, rendered patch/diff, review
/// evidence) from the normalized preview so the guard retains the exact reviewed
/// plan for Apply binding.
fn extract_preview_artifact(normalized: &Value) -> RefactorKitPreviewArtifact {
    let affected_files = normalized
        .get("affectedFiles")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let patch = normalized
        .get("renderedDiff")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let review_evidence = normalized
        .get("evidence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    RefactorKitPreviewArtifact {
        affected_files,
        patch,
        review_evidence,
    }
}

/// RQR-RFK-ENGINE-002: the apply CLI output must match the retained exact
/// preview artifact (patch, affected files, review evidence). A differing output
/// means the plan changed and requires a fresh preview + review. The stateless
/// CLI is never rerun and accepted as the reviewed plan when it diverges.
fn apply_outcome_matches_preview(
    output: &CappedCommandOutput,
    root: &Path,
    operation: RefactoringOperation,
    artifact: &RefactorKitPreviewArtifact,
) -> bool {
    let text = &output.stdout;
    let affected_change = match operation {
        RefactoringOperation::SafeDelete => "delete",
        RefactoringOperation::MoveClass | RefactoringOperation::MoveSourceRoot => "move",
        _ => "edit",
    };
    let Ok(affected) = parse_affected_files(text, root, affected_change) else {
        return false;
    };
    let patch = parse_patch(text).unwrap_or_default();
    let evidence = parse_review_evidence(text);

    let preview_paths: Vec<&str> = artifact
        .affected_files
        .iter()
        .filter_map(|file| file.get("path").and_then(Value::as_str))
        .collect();
    let preview_changes: Vec<&str> = artifact
        .affected_files
        .iter()
        .filter_map(|file| file.get("change").and_then(Value::as_str))
        .collect();
    let apply_paths: Vec<&str> = affected
        .iter()
        .filter_map(|file| file.get("path").and_then(Value::as_str))
        .collect();
    let apply_changes: Vec<&str> = affected
        .iter()
        .filter_map(|file| file.get("change").and_then(Value::as_str))
        .collect();
    let preview_evidence: Vec<&str> = artifact
        .review_evidence
        .iter()
        .filter_map(|evidence| evidence.get("kind").and_then(Value::as_str))
        .collect();
    let apply_evidence: Vec<&str> = evidence
        .iter()
        .filter_map(|evidence| evidence.get("kind").and_then(Value::as_str))
        .collect();

    preview_paths == apply_paths
        && preview_changes == apply_changes
        && artifact.patch == patch
        && preview_evidence == apply_evidence
}

/// RQR-RFK-ENGINE-002: exact-plan binding must also compare the target selection
/// (UTF-16 offsets), not just kind/path/identity and generation/workspace IDs.
fn selection_matches(
    retained: &Option<RefactoringSelection>,
    requested: &Option<RefactoringSelection>,
) -> bool {
    match (retained, requested) {
        (None, None) => true,
        (Some(a), Some(b)) => a.start == b.start && a.end == b.end,
        _ => false,
    }
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
        return Err(
            "RefactorKit engine symbol must not contain control characters or path separators."
                .to_string(),
        );
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
        ENGINE_LOCK
            .get_or_init(|| TestMutex::new(()))
            .lock()
            .unwrap()
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

    #[test]
    fn managed_java_file_capabilities_and_targets_are_explicit() {
        let entry = json!({"capabilities":[{"operation":"formatFile","stability":"stable","evidence":"structural-parse","mutationAuthority":"managed-stable","extensions":["java"]}]});
        assert!(java_has_managed_file_operation(&entry, "formatFile"));
        let mut unrelated_language = entry.clone();
        unrelated_language["capabilities"][0]["extensions"] = json!(["kt"]);
        assert!(!java_has_managed_file_operation(
            &unrelated_language,
            "formatFile"
        ));
        for field in ["stability", "mutationAuthority"] {
            let mut refused = entry.clone();
            refused["capabilities"][0][field] = json!("proposal-only");
            assert!(!java_has_managed_file_operation(&refused, "formatFile"));
        }
        let mut lexical = entry.clone();
        lexical["capabilities"][0]["evidence"] = json!("lexical");
        assert!(!java_has_managed_file_operation(&lexical, "formatFile"));
        let mut unknown_evidence = entry.clone();
        unknown_evidence["capabilities"][0]["evidence"] = json!("unverified");
        assert!(!java_has_managed_file_operation(
            &unknown_evidence,
            "formatFile"
        ));
        for operation in [
            RefactoringOperation::FormatFile,
            RefactoringOperation::OrganizeImports,
        ] {
            let mut target = RefactoringTarget {
                kind: "file".into(),
                path: "src/main/java/Sample.java".into(),
                identity: "src/main/java/Sample.java".into(),
                selection: None,
            };
            let args =
                build_refactor_args(operation, &target, None, false, Path::new("/workspace"))
                    .unwrap();
            assert_eq!(
                args,
                [
                    operation.as_str(),
                    "src/main/java/Sample.java",
                    "--root",
                    "/workspace"
                ]
                .map(OsString::from)
            );
            assert!(resolve_change_intent(operation, None).unwrap().is_none());
            let intent: RefactorKitChangeIntent =
                serde_json::from_value(json!({"operation": operation.as_str()})).unwrap();
            assert!(resolve_change_intent(operation, Some(&intent)).is_err());
            target.kind = "class".into();
            assert!(
                build_refactor_args(operation, &target, None, true, Path::new("/workspace"))
                    .is_err()
            );
            target.kind = "file".into();
            for path in [
                "../Sample.java",
                "/workspace/Sample.java",
                "src/Sample.kt",
                "src/./Sample.java",
                "C:/Sample.java",
            ] {
                target.path = path.into();
                target.identity = path.into();
                assert!(build_refactor_args(
                    operation,
                    &target,
                    None,
                    false,
                    Path::new("/workspace")
                )
                .is_err());
            }
        }
    }

    #[test]
    fn managed_move_source_root_uses_exact_root_and_safe_destination_arguments() {
        let root = temp_workspace("move-source-root");
        fs::create_dir_all(root.join("app/src/main/java")).unwrap();
        let target = RefactoringTarget {
            kind: "source-root".into(),
            path: "app/src/main/java".into(),
            identity: "app/src/main/java".into(),
            selection: None,
        };
        let intent = RefactorKitChangeIntent {
            actions: None,
            operation: RefactoringOperation::MoveSourceRoot,
            module_name: None,
            build_root: None,
            project_path: None,
            old_project_path: None,
            new_project_path: None,
            new_name: None,
            from_name: None,
            new_package: None,
            from_package: None,
            to_package: None,
            to: Some("app/src/relocated/java".into()),
            source_path: None,
            target_path: None,
            target_module_id: None,
            old_parameter: None,
            new_parameter: None,
            new_type: None,
            parameter_type: None,
            parameter_name: None,
            type_name: None,
            parameters: None,
            members: None,
            default_expression: None,
            include_hierarchy: None,
            accept_external_consumer_risk: None,
            migrate_functional_references: None,
            new_order: None,
            method_name: None,
            interface_name: None,
            superclass_name: None,
            target_type: None,
            target_position: None,
            name: None,
        };
        let args = build_refactor_args(
            RefactoringOperation::MoveSourceRoot,
            &target,
            Some(&intent),
            false,
            &root,
        )
        .unwrap();
        assert_eq!(
            args,
            [
                "move-source-root",
                "--from",
                "app/src/main/java",
                "--to",
                "app/src/relocated/java",
                "--root",
                root.to_str().unwrap(),
            ]
            .map(OsString::from)
        );

        let mut unsafe_intent = intent.clone();
        unsafe_intent.to = Some("../outside".into());
        assert!(build_refactor_args(
            RefactoringOperation::MoveSourceRoot,
            &target,
            Some(&unsafe_intent),
            false,
            &root,
        )
        .is_err());
        let mut wrong_target = target;
        wrong_target.kind = "file".into();
        assert!(build_refactor_args(
            RefactoringOperation::MoveSourceRoot,
            &wrong_target,
            Some(&intent),
            false,
            &root,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn move_class_does_not_ignore_an_explicit_destination_without_project_context() {
        let target = RefactoringTarget {
            kind: "class".into(),
            path: "src/main/java/example/A.java".into(),
            identity: "example.A".into(),
            selection: None,
        };
        for destination in [
            json!({"targetPath": "other/src/main/java/example/services/A.java"}),
            json!({"targetModuleId": "library"}),
        ] {
            let mut change = json!({
                "operation": "move-class",
                "newPackage": "example.services"
            });
            change
                .as_object_mut()
                .unwrap()
                .extend(destination.as_object().unwrap().clone());
            let intent: RefactorKitChangeIntent = serde_json::from_value(change).unwrap();

            assert!(matches!(
                build_refactor_args(
                    RefactoringOperation::MoveClass,
                    &target,
                    Some(&intent),
                    false,
                    Path::new("/workspace")
                ),
                Err(message) if message.contains("synchronized Java project context")
            ));
        }
    }

    #[test]
    fn confirmed_rollback_reports_inverse_file_changes_for_editor_reconciliation() {
        let applied = json!({"changedFiles":[
            {"change":"edit","path":"Edited.java","primary":true},
            {"change":"create","path":"Created.java","primary":false},
            {"change":"delete","path":"Deleted.java","primary":false},
            {"change":"move","path":"new/Moved.java","previousPath":"old/Moved.java","primary":false}
        ]});
        let original = applied.clone();
        assert_eq!(
            rollback_file_changes(&applied),
            vec![
                json!({"change":"edit","path":"Edited.java","primary":true}),
                json!({"change":"delete","path":"Created.java","primary":false}),
                json!({"change":"create","path":"Deleted.java","primary":false}),
                json!({"change":"move","path":"old/Moved.java","previousPath":"new/Moved.java","primary":false})
            ]
        );
        assert_eq!(applied, original);
    }

    #[test]
    #[ignore = "requires IDE_REAL_REFACTORKIT_ENGINE and a full JDK; uses only an isolated temporary Java project; run with --test-threads=1"]
    fn installed_refactorkit_file_operations_review_apply_compile_and_rollback() {
        let _lock = engine_env_lock();
        let engine = env::var_os("IDE_REAL_REFACTORKIT_ENGINE")
            .expect("Select the installed RefactorKit engine");
        let previous_root = canonical_workspace().unwrap();
        let previous_engine = env::var_os("IDE_REFACTORKIT_ENGINE");
        let previous_daemon = env::var_os("IDE_REFACTORKIT_DAEMON");
        let root = temp_workspace("java-file-operations");
        struct Guard {
            root: PathBuf,
            previous_root: PathBuf,
            previous_engine: Option<OsString>,
            previous_daemon: Option<OsString>,
        }
        impl Drop for Guard {
            fn drop(&mut self) {
                let _ = crate::workspace::set_workspace_root_override(self.previous_root.clone());
                if let Some(engine) = &self.previous_engine {
                    env::set_var("IDE_REFACTORKIT_ENGINE", engine);
                } else {
                    env::remove_var("IDE_REFACTORKIT_ENGINE");
                }
                if let Some(daemon) = &self.previous_daemon {
                    env::set_var("IDE_REFACTORKIT_DAEMON", daemon);
                } else {
                    env::remove_var("IDE_REFACTORKIT_DAEMON");
                }
                let _ = fs::remove_dir_all(&self.root);
            }
        }
        let _guard = Guard {
            root: root.clone(),
            previous_root,
            previous_engine,
            previous_daemon,
        };
        let path = "src/main/java/example/Sample.java";
        let file = root.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(root.join("pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>sample</artifactId><version>1</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>").unwrap();
        crate::workspace::set_workspace_root_override(root.clone()).unwrap();
        env::set_var("IDE_REFACTORKIT_ENGINE", engine);
        let engine_capabilities = get_refactorkit_engine_capabilities().unwrap();
        assert!(engine_capabilities
            .operations
            .contains(&"format-file".to_string()));
        assert!(engine_capabilities
            .operations
            .contains(&"organize-imports".to_string()));
        assert!(engine_capabilities
            .managed_operations
            .contains(&"format-file".to_string()));
        assert!(engine_capabilities
            .managed_operations
            .contains(&"organize-imports".to_string()));
        let unavailable_daemon = root.join("unavailable-daemon");
        fs::write(&unavailable_daemon, "#!/bin/sh\nexit 1\n").unwrap();
        fs::set_permissions(&unavailable_daemon, fs::Permissions::from_mode(0o700)).unwrap();
        env::set_var("IDE_REFACTORKIT_DAEMON", unavailable_daemon);
        let source = "package example;\nimport java.util.List;\nimport java.util.Set;\nimport java.util.ArrayList;\nimport java.util.concurrent.*;\npublic class Sample { public static void main(String[] args){List<String> values=new ArrayList<>();values.add(\"7\");System.out.println(values.get(0));} }\n";
        let jdk = env::var_os("IDE_TEST_ALTERNATE_JDK_HOME").map(PathBuf::from);
        let tool = |name: &str| {
            jdk.as_ref()
                .map(|home| home.join("bin").join(name))
                .unwrap_or_else(|| name.into())
        };
        for operation in ["format-file", "organize-imports"] {
            fs::write(&file, source).unwrap();
            let state = RefactorKitDaemonState::default();
            let workspace = workspace_id();
            let params = json!({"operation":operation,"target":{"kind":"file","path":path,"identity":path},"authority":{"workspaceId":workspace,"workspaceGeneration":1},"selectionGeneration":1,"requestId":format!("file-{operation}")});
            let preview = || {
                preview_refactoring(serde_json::from_value(params.clone()).unwrap(), &state)
                    .unwrap()
            };
            let approval = |plan: &Value| json!({"planId":plan["planId"],"operation":operation,"target":plan["target"],"authority":params["authority"],"selectionGeneration":1,"requestId":params["requestId"],"approval":{"approvalId":"file-approval","approvedPlanId":plan["planId"],"approvedAt":"2026-10-03T00:00:00Z"}});
            let stale = preview();
            assert_eq!(fs::read_to_string(&file).unwrap(), source);
            fs::write(&file, format!("{source}// concurrent source edit\n")).unwrap();
            assert!(
                apply_refactoring(serde_json::from_value(approval(&stale)).unwrap(), &state)
                    .is_err()
            );
            assert!(fs::read_to_string(&file)
                .unwrap()
                .ends_with("// concurrent source edit\n"));
            fs::write(&file, source).unwrap();
            let plan = preview();
            assert_eq!(plan["status"], "ready");
            assert_eq!(plan["grantsApplyAuthority"], false);
            assert_eq!(plan["affectedFiles"].as_array().unwrap().len(), 1);
            assert!(plan["renderedDiff"]
                .as_str()
                .unwrap()
                .contains("Sample.java"));
            let daemon = super::super::application::get_refactorkit_capabilities(&state).unwrap();
            assert!(!daemon.java_import_external_class.supported);
            let result =
                apply_refactoring(serde_json::from_value(approval(&plan)).unwrap(), &state)
                    .unwrap();
            assert_eq!(result["outcome"], "applied", "{operation}: {result}");
            let daemon = super::super::application::get_refactorkit_capabilities(&state).unwrap();
            assert!(!daemon.java_import_external_class.supported);
            let after = fs::read_to_string(&file).unwrap();
            assert_ne!(after, source);
            if operation == "format-file" {
                assert!(after.contains("import java.util.Set;"));
                assert!(after.contains("\n\tpublic static void main"));
            } else {
                assert!(!after.contains("import java.util.Set;"));
                assert!(after.contains("import java.util.concurrent.*;"));
                assert!(
                    after.find("import java.util.ArrayList;")
                        < after.find("import java.util.List;")
                );
            }
            let classes = root.join("classes");
            fs::create_dir_all(&classes).unwrap();
            let compiled = std::process::Command::new(tool("javac"))
                .args(["-d"])
                .arg(&classes)
                .arg(&file)
                .output()
                .unwrap();
            assert!(
                compiled.status.success(),
                "{}",
                String::from_utf8_lossy(&compiled.stderr)
            );
            let executed = std::process::Command::new(tool("java"))
                .arg("-cp")
                .arg(&classes)
                .arg("example.Sample")
                .output()
                .unwrap();
            assert!(executed.status.success());
            assert_eq!(String::from_utf8(executed.stdout).unwrap().trim(), "7");
            let rollback = rollback_refactoring(serde_json::from_value(json!({"transactionId": result["transactionId"],"operation":operation,"authority":params["authority"],"requestId":"file-rollback"})).unwrap(), &state).unwrap();
            assert_eq!(rollback["rolledBack"], true, "{rollback}");
            assert_eq!(rollback["changedFiles"][0]["path"], path);
            assert_eq!(fs::read_to_string(&file).unwrap(), source);
        }
    }

    /// The real daemon validates workspace authority against the canonical workspace
    /// (`canonical_workspace()`), not a test temp dir, so tests bind the real id.
    fn workspace_id() -> String {
        workspace_id_for_path(&canonical_workspace().unwrap())
    }

    #[test]
    #[ignore = "requires IDE_REAL_REFACTORKIT_ENGINE pointing to an installed RefactorKit and a compatible JDK; run with --test-threads=1"]
    fn installed_refactorkit_previews_and_applies_a_saved_java_method_rename() {
        let _lock = engine_env_lock();
        let engine = env::var_os("IDE_REAL_REFACTORKIT_ENGINE")
            .expect("Set IDE_REAL_REFACTORKIT_ENGINE to the real installed executable");
        let previous_root = canonical_workspace().unwrap();
        let previous_engine = env::var_os("IDE_REFACTORKIT_ENGINE");
        let root = temp_workspace("installed-java-method");
        struct FixtureGuard {
            root: PathBuf,
            previous_root: PathBuf,
            previous_engine: Option<OsString>,
        }
        impl Drop for FixtureGuard {
            fn drop(&mut self) {
                let _ = crate::workspace::set_workspace_root_override(self.previous_root.clone());
                if let Some(engine) = &self.previous_engine {
                    env::set_var("IDE_REFACTORKIT_ENGINE", engine);
                } else {
                    env::remove_var("IDE_REFACTORKIT_ENGINE");
                }
                let _ = fs::remove_dir_all(&self.root);
            }
        }
        let _fixture = FixtureGuard {
            root: root.clone(),
            previous_root,
            previous_engine,
        };
        let source = "package example;\npublic class A {\n  public int calculate(int value) { return value + 1; }\n  public int use() { return calculate(41); }\n}\n";
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::write(root.join("src/main/java/example/A.java"), source).unwrap();
        fs::write(root.join("pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>java-refactoring-fixture</artifactId><version>1.0</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>\n").unwrap();
        crate::workspace::set_workspace_root_override(root.clone()).unwrap();
        env::set_var("IDE_REFACTORKIT_ENGINE", engine);
        let state = RefactorKitDaemonState::default();
        let workspace = workspace_id();
        let preview: EnginePreviewRequest = serde_json::from_value(json!({
            "operation": "rename-member",
            "target": { "kind": "member", "path": "src/main/java/example/A.java", "identity": "example.A#calculate(int)" },
            "changeIntent": { "operation": "rename-member", "newName": "compute" },
            "authority": { "workspaceId": workspace, "workspaceGeneration": 1 },
            "selectionGeneration": 1, "requestId": "installed-java-method-preview"
        })).unwrap();
        let plan = preview_refactoring(preview, &state).expect("real engine preview");
        assert_eq!(plan["status"], "ready", "{plan}");
        assert!(
            plan["evidence"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["kind"] == "JDT_BINDING"),
            "{}",
            plan["evidence"]
        );
        assert_eq!(plan["grantsApplyAuthority"], false);
        assert_eq!(
            fs::read_to_string(root.join("src/main/java/example/A.java")).unwrap(),
            source
        );
        let request = json!({
            "planId": plan["planId"], "operation": "rename-member", "target": plan["target"],
            "changeIntent": { "operation": "rename-member", "newName": "compute" },
            "authority": { "workspaceId": workspace, "workspaceGeneration": 1 },
            "selectionGeneration": 1, "requestId": "installed-java-method-preview",
            "approval": { "approvalId": "installed-java-method-approval", "approvedPlanId": plan["planId"], "approvedAt": "2026-10-02T00:00:00Z" }
        });
        let mut changed_intent = request.clone();
        changed_intent["changeIntent"]["newName"] = json!("unreviewed");
        assert!(
            apply_refactoring(serde_json::from_value(changed_intent).unwrap(), &state).is_err()
        );
        assert_eq!(
            fs::read_to_string(root.join("src/main/java/example/A.java")).unwrap(),
            source
        );
        let applied = apply_refactoring(serde_json::from_value(request).unwrap(), &state)
            .expect("real engine apply");
        assert_eq!(applied["outcome"], "applied", "{applied}");
        let after = fs::read_to_string(root.join("src/main/java/example/A.java")).unwrap();
        assert!(after.contains("int compute(int value)"), "{after}");
        assert!(after.contains("return compute(41)"), "{after}");
        assert!(!after.contains("calculate"), "{after}");
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
        r#"{"schemaVersion":1,"adapters":[{"languageId":"java","extensions":["java"],"backend":"eclipse-jdt-3.44","runtime":{"executionMode":"in-process","supportsTimeout":false,"supportsCancellation":false,"usesWorkspaceOverlay":false,"recordsProcessProvenance":false,"limits":{"requestTimeoutMillis":null,"maxInputBytes":null,"maxOutputBytes":null,"maxProcesses":null}},"capabilities":[{"operation":"definition","stability":"experimental","evidence":"compiler","mutationAuthority":"none","backend":"eclipse-jdt-3.44"},{"operation":"references","stability":"experimental","evidence":"compiler","mutationAuthority":"none","backend":"eclipse-jdt-3.44"},{"operation":"renameClass","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"renameMember","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"extractMethod","stability":"experimental","evidence":"compiler","mutationAuthority":"proposal-only","backend":"eclipse-jdt-3.44"},{"operation":"changeSignature.addParameter","stability":"experimental","evidence":"compiler","mutationAuthority":"proposal-only","backend":"eclipse-jdt-3.44"},{"operation":"moveClass","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"moveMember","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"},{"operation":"safeDelete","stability":"stable","evidence":"compiler","mutationAuthority":"managed-stable","backend":"eclipse-jdt-3.44"}]}]}"#.to_string()
    }

    /// A canonical rename-class change intent used by the preview/apply tests.
    fn rename_class_intent(new_name: &str) -> RefactorKitChangeIntent {
        RefactorKitChangeIntent {
            actions: None,
            operation: RefactoringOperation::RenameClass,
            module_name: None,
            build_root: None,
            project_path: None,
            old_project_path: None,
            new_project_path: None,
            new_name: Some(new_name.to_string()),
            from_name: None,
            new_package: None,
            from_package: None,
            to_package: None,
            to: None,
            source_path: None,
            target_path: None,
            target_module_id: None,
            old_parameter: None,
            new_parameter: None,
            new_type: None,
            parameter_type: None,
            parameter_name: None,
            type_name: None,
            parameters: None,
            members: None,
            default_expression: None,
            include_hierarchy: None,
            accept_external_consumer_risk: None,
            migrate_functional_references: None,
            new_order: None,
            method_name: None,
            interface_name: None,
            superclass_name: None,
            target_type: None,
            target_position: None,
            name: None,
        }
    }

    /// A complete preview output carrying affected files, a rendered patch, and
    /// review evidence, plus an applied transaction outcome for the apply step.
    fn complete_preview_stdout() -> String {
        "Operation: renameClass\nStatus: PREVIEW\nRename A -> B\nEvidence: JDT_BINDING\nAffected files:\n- src/A.java\nPatch:\n--- a/src/A.java\n+++ b/src/A.java\n@@\n- old\n+ new\nApplied. Transaction: transaction-abc123\nTo rollback: refactorkit patch rollback transaction-abc123\n".to_string()
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
        assert!(!caps
            .operations
            .contains(&"rename-local-variable".to_string()));
        assert!(caps.operational_surface.contains(&"scan".to_string()));
        assert!(caps
            .operational_surface
            .contains(&"extract-method".to_string()));
        assert!(caps.rollback_advertised);
        assert!(caps.preview_read_only);
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn lexical_fallback_preview_is_reviewable_but_apply_is_refused() {
        let _lock = engine_env_lock();
        let root = temp_workspace("lexical-preview");
        let lexical_preview = complete_preview_stdout().replace("JDT_BINDING", "LEXICAL_FALLBACK");
        install_engine_harness(&root, Some(&java_capabilities()), &lexical_preview, true);
        let state = RefactorKitDaemonState::default();
        let workspace = workspace_id();
        let target = RefactoringTarget {
            kind: "class".to_string(),
            path: "src/A.java".to_string(),
            identity: "example.A".to_string(),
            selection: None,
        };
        let result = preview_refactoring(
            EnginePreviewRequest {
                formatter_profile: None,
                project_context: None,
                operation: RefactoringOperation::RenameClass,
                target: target.clone(),
                change_intent: Some(rename_class_intent("B")),
                authority: WorkspaceAuthority {
                    workspace_id: workspace.clone(),
                    workspace_generation: 1,
                },
                selection_generation: 1,
                request_id: "lexical-preview-request".to_string(),
            },
            &state,
        )
        .unwrap();
        let plan_id = result["planId"].as_str().unwrap().to_string();
        assert_eq!(result["status"], "ready");
        assert_eq!(result["applyEligibility"]["eligible"], false);
        assert_eq!(result["evidence"][0]["kind"], "LEXICAL_FALLBACK");

        let error = apply_refactoring(
            EngineApplyRequest {
                formatter_profile: None,
                formatter_profile_sha256: None,
                project_context: None,
                plan_id: plan_id.clone(),
                operation: RefactoringOperation::RenameClass,
                target,
                change_intent: Some(rename_class_intent("B")),
                authority: WorkspaceAuthority {
                    workspace_id: workspace,
                    workspace_generation: 1,
                },
                selection_generation: 1,
                request_id: "lexical-preview-request".to_string(),
                approval: ApprovalEvidence {
                    approval_id: "lexical-preview-approval".to_string(),
                    approved_plan_id: plan_id,
                    approved_at: "2026-10-18T00:00:00Z".to_string(),
                },
            },
            &state,
        )
        .unwrap_err();
        assert!(error.contains("review-only"), "{error}");
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
        install_engine_harness(
            &root,
            Some(&java_capabilities()),
            &complete_preview_stdout(),
            true,
        );
        let state = RefactorKitDaemonState::default();
        let request = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
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
        // RQR-RFK-ENGINE-003: an eligible plan is reported eligible=true (no
        // blocker), so JavaRefactoringPreviewDialog enables Apply.
        assert_eq!(
            result.pointer("/applyEligibility/eligible"),
            Some(&Value::Bool(true))
        );
        assert_eq!(
            result.pointer("/applyEligibility/blockers"),
            Some(&Value::Array(vec![]))
        );
        assert_eq!(result["provider"], "refactorkit");
        // RQR-RFK-ENGINE-002: the guard retains the change descriptor + preview
        // artifact from the exact reviewed plan.
        let state_lock = state.0.lock().unwrap();
        let guard = state_lock
            .engine_plans
            .get(result["planId"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            guard.change_intent.as_ref().unwrap().new_name.as_deref(),
            Some("B")
        );
        assert_eq!(guard.preview_artifact.affected_files.len(), 1);
        assert!(!guard.preview_artifact.patch.is_empty());
        assert_eq!(guard.preview_artifact.review_evidence.len(), 1);
        drop(state_lock);
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_preview_refuses_zero_exit_shell_without_evidence() {
        let _lock = engine_env_lock();
        let root = temp_workspace("preview-evidence");
        // A zero-exit engine shell with no affected files, no patch, and no review
        // evidence must be honestly unavailable/refused, never status "ready".
        install_engine_harness(
            &root,
            Some(&java_capabilities()),
            "Operation: renameClass\nStatus: PREVIEW\n",
            true,
        );
        let state = RefactorKitDaemonState::default();
        let request = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "preview-evidence-req-1".to_string(),
        };
        let error = preview_refactoring(request, &state).unwrap_err();
        assert!(error.contains("no usable preview evidence"));
        // No guard may be retained for an unevidenced preview.
        assert!(state.0.lock().unwrap().engine_plans.is_empty());
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_binds_exact_reviewed_plan_and_approval() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply");
        install_engine_harness(
            &root,
            Some(&java_capabilities()),
            &complete_preview_stdout(),
            true,
        );
        let state = RefactorKitDaemonState::default();
        let preview = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
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
            formatter_profile: None,
            formatter_profile_sha256: None,
            project_context: None,
            plan_id: plan_id.clone(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
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
        // RQR-RFK-ENGINE-003: primaryFile is a PATH STRING, not an affected-file object.
        assert_eq!(result["primaryFile"], "src/A.java");
        assert!(result["primaryFile"].is_string());
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_refuses_unknown_or_mismatched_plan() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-refuse");
        install_engine_harness(
            &root,
            Some(&java_capabilities()),
            "Operation: renameClass\nStatus: PREVIEW\n",
            true,
        );
        let state = RefactorKitDaemonState::default();
        let apply = EngineApplyRequest {
            formatter_profile: None,
            formatter_profile_sha256: None,
            project_context: None,
            plan_id: "engine-plan-unknown".to_string(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
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

    /// Harness that distinguishes the apply invocation (`--apply`) from preview so
    /// tests can prove the apply CLI output is compared against the reviewed plan
    /// and that a failing apply process reports honest failure.
    fn install_apply_aware_harness(
        root: &Path,
        preview_stdout: &str,
        apply_stdout: &str,
        apply_exit: i32,
    ) -> PathBuf {
        let script = root.join(format!(
            "engine-apply-aware-{}.sh",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let caps_json = java_capabilities();
        let body = format!(
            "#!/bin/sh\ncase \"$1\" in\n  --version) echo 'RefactorKit 0.7.0-SNAPSHOT (API 0.2)' ;;\n  capabilities) printf '%s\\n' '{caps_json}' ;;\n  --help) echo 'refactorkit patch rollback <id>' ;;\n  rename) if echo \"$@\" | grep -q -- '--apply'; then printf '%s' '{apply_stdout}'; exit {apply_exit}; else printf '%s' '{preview_stdout}'; fi ;;\n  *) echo 'unsupported' >&2; exit 1 ;;\nesac\n",
            caps_json = caps_json,
            apply_stdout = apply_stdout,
            apply_exit = apply_exit,
            preview_stdout = preview_stdout,
        );
        fs::write(&script, body).unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).unwrap();
        env::set_var("IDE_REFACTORKIT_ENGINE", &script);
        script
    }

    /// Harness that proves no unreviewed write occurs on a divergent plan: the
    /// FIRST read-only invocation (the preview) emits the matching preview, the
    /// SECOND read-only invocation (the re-preview before Apply) emits a divergent
    /// plan, and the mutating --apply path writes a marker file if it is ever
    /// invoked.
    fn install_divergent_reprieve_harness(
        root: &Path,
        preview_stdout: &str,
        reprieve_stdout: &str,
        apply_stdout: &str,
    ) -> PathBuf {
        let script = root.join(format!(
            "engine-divergent-reprieve-{}.sh",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let caps_json = java_capabilities();
        let marker = root.join("APPLIED_MARKER").display().to_string();
        let counter = root.join("PREVIEW_COUNT").display().to_string();
        let body = format!(
            "#!/bin/sh\ncase \"$1\" in\n  --version) echo 'RefactorKit 0.7.0-SNAPSHOT (API 0.2)' ;;\n  capabilities) printf '%s\\n' '{caps_json}' ;;\n  --help) echo 'refactorkit patch rollback <id>' ;;\n  rename) if echo \"$@\" | grep -q -- '--apply'; then touch '{marker}'; printf '%s' '{apply_stdout}'; elif [ -f '{counter}' ]; then printf '%s' '{reprieve_stdout}'; else touch '{counter}'; printf '%s' '{preview_stdout}'; fi ;;\n  *) echo 'unsupported' >&2; exit 1 ;;\nesac\n",
            caps_json = caps_json,
            marker = marker,
            counter = counter,
            apply_stdout = apply_stdout,
            reprieve_stdout = reprieve_stdout,
            preview_stdout = preview_stdout,
        );
        fs::write(&script, body).unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).unwrap();
        env::set_var("IDE_REFACTORKIT_ENGINE", &script);
        script
    }

    /// An apply output whose patch/affected-files differ from the reviewed preview
    /// artifact, proving the exact-plan binding refuses a diverging rerun.
    fn differing_apply_stdout() -> String {
        "Operation: renameClass\nStatus: APPLY\nRename A -> B\nEvidence: JDT_BINDING\nAffected files:\n- src/A.java\n- src/B.java\nPatch:\n--- a/src/A.java\n+++ b/src/A.java\n@@\n- old\n+ new2\nApplied. Transaction: transaction-abc123\nTo rollback: refactorkit patch rollback transaction-abc123\n".to_string()
    }

    /// A read-only re-preview output whose patch/affected-files differ from the
    /// retained preview artifact, proving divergence is detected BEFORE any
    /// mutating --apply invocation.
    fn divergent_reprieve_stdout() -> String {
        "Operation: renameClass\nStatus: PREVIEW\nRename A -> B\nEvidence: JDT_BINDING\nAffected files:\n- src/A.java\n- src/B.java\nPatch:\n--- a/src/A.java\n+++ b/src/A.java\n@@\n- old\n+ new2\n".to_string()
    }

    #[test]
    fn resolve_change_intent_requires_intent_and_rejects_intent_for_safe_delete() {
        // An intent-requiring operation with no intent is honestly refused.
        let error = resolve_change_intent(RefactoringOperation::RenameClass, None).unwrap_err();
        assert!(error.contains("requires operation-specific change intent"));
        // safe-delete accepts no intent.
        let intent = RefactorKitChangeIntent {
            actions: None,
            operation: RefactoringOperation::SafeDelete,
            module_name: None,
            build_root: None,
            project_path: None,
            old_project_path: None,
            new_project_path: None,
            new_name: None,
            from_name: None,
            new_package: None,
            from_package: None,
            to_package: None,
            to: None,
            source_path: None,
            target_path: None,
            target_module_id: None,
            old_parameter: None,
            new_parameter: None,
            new_type: None,
            parameter_type: None,
            parameter_name: None,
            type_name: None,
            parameters: None,
            members: None,
            default_expression: None,
            include_hierarchy: None,
            accept_external_consumer_risk: None,
            migrate_functional_references: None,
            new_order: None,
            method_name: None,
            interface_name: None,
            superclass_name: None,
            target_type: None,
            target_position: None,
            name: None,
        };
        let error =
            resolve_change_intent(RefactoringOperation::SafeDelete, Some(&intent)).unwrap_err();
        assert!(error.contains("safe-delete accepts no change intent"));
        // safe-delete with no intent resolves to None.
        assert!(
            resolve_change_intent(RefactoringOperation::SafeDelete, None)
                .unwrap()
                .is_none()
        );
        // Encapsulate Field also has no user-supplied mutation parameters.
        assert!(
            resolve_change_intent(RefactoringOperation::EncapsulateField, None)
                .unwrap()
                .is_none()
        );
        let mut encapsulate_intent = intent;
        encapsulate_intent.operation = RefactoringOperation::EncapsulateField;
        assert!(resolve_change_intent(
            RefactoringOperation::EncapsulateField,
            Some(&encapsulate_intent)
        )
        .unwrap_err()
        .contains("encapsulate-field accepts no change intent"));
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_refuses_absent_change_intent_for_intent_requiring_operation() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-no-intent");
        install_engine_harness(
            &root,
            Some(&java_capabilities()),
            &complete_preview_stdout(),
            true,
        );
        let state = RefactorKitDaemonState::default();
        let preview = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-no-intent-req".to_string(),
        };
        let previewed = preview_refactoring(preview, &state).unwrap();
        let plan_id = previewed["planId"].as_str().unwrap().to_string();
        let apply = EngineApplyRequest {
            formatter_profile: None,
            formatter_profile_sha256: None,
            project_context: None,
            plan_id: plan_id.clone(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: None,
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-no-intent-req".to_string(),
            approval: ApprovalEvidence {
                approval_id: "approval-no-intent".to_string(),
                approved_plan_id: plan_id.clone(),
                approved_at: "2026-08-27T00:00:00Z".to_string(),
            },
        };
        let error = apply_refactoring(apply, &state).unwrap_err();
        assert!(error.contains("requires operation-specific change intent"));
        // A refused apply must not consume the reviewed plan guard.
        assert_eq!(state.0.lock().unwrap().engine_plans.len(), 1);
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_refuses_apply_output_differing_from_reviewed_plan() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-diff");
        install_apply_aware_harness(
            &root,
            &complete_preview_stdout(),
            &differing_apply_stdout(),
            0,
        );
        let state = RefactorKitDaemonState::default();
        let preview = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-diff-req".to_string(),
        };
        let previewed = preview_refactoring(preview, &state).unwrap();
        let plan_id = previewed["planId"].as_str().unwrap().to_string();
        let apply = EngineApplyRequest {
            formatter_profile: None,
            formatter_profile_sha256: None,
            project_context: None,
            plan_id: plan_id.clone(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-diff-req".to_string(),
            approval: ApprovalEvidence {
                approval_id: "approval-diff".to_string(),
                approved_plan_id: plan_id.clone(),
                approved_at: "2026-08-27T00:00:00Z".to_string(),
            },
        };
        let error = apply_refactoring(apply, &state).unwrap_err();
        assert!(error.contains("differs from the reviewed plan"));
        // An uncorrelated apply is a write boundary: the guard must not survive.
        assert!(state.0.lock().unwrap().engine_plans.is_empty());
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_refuses_before_any_write_when_read_only_reprieve_diverges() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-divergent-reprieve");
        // The FIRST read-only call (preview) emits the matching plan; the SECOND
        // read-only call (re-preview before Apply) diverges; the mutating --apply
        // path writes APPLIED_MARKER if it is ever invoked.
        install_divergent_reprieve_harness(
            &root,
            &complete_preview_stdout(),
            &divergent_reprieve_stdout(),
            &complete_preview_stdout(),
        );
        let state = RefactorKitDaemonState::default();
        let preview = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-divergent-reprieve-req".to_string(),
        };
        let previewed = preview_refactoring(preview, &state).unwrap();
        let plan_id = previewed["planId"].as_str().unwrap().to_string();
        let apply = EngineApplyRequest {
            formatter_profile: None,
            formatter_profile_sha256: None,
            project_context: None,
            plan_id: plan_id.clone(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-divergent-reprieve-req".to_string(),
            approval: ApprovalEvidence {
                approval_id: "approval-divergent-reprieve".to_string(),
                approved_plan_id: plan_id.clone(),
                approved_at: "2026-08-27T00:00:00Z".to_string(),
            },
        };
        let error = apply_refactoring(apply, &state).unwrap_err();
        assert!(error.contains("diverges from the reviewed plan"));
        // RQR-RFK-ENGINE-002-POST-WRITE: the mutating --apply command must NOT have
        // been invoked — no unreviewed write may occur on a divergent plan.
        assert!(!root.join("APPLIED_MARKER").exists());
        // The divergent plan must not survive as applicable; a fresh preview is required.
        assert!(state.0.lock().unwrap().engine_plans.is_empty());
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_reports_honest_failure_when_engine_process_fails() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-fail");
        // The engine exits non-zero but prints an applied-transaction line. A
        // failing process must report honest failure, never fabricated applied.
        install_apply_aware_harness(
            &root,
            &complete_preview_stdout(),
            &complete_preview_stdout(),
            1,
        );
        let state = RefactorKitDaemonState::default();
        let preview = EnginePreviewRequest {
            formatter_profile: None,
            project_context: None,
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-fail-req".to_string(),
        };
        let previewed = preview_refactoring(preview, &state).unwrap();
        let plan_id = previewed["planId"].as_str().unwrap().to_string();
        let apply = EngineApplyRequest {
            formatter_profile: None,
            formatter_profile_sha256: None,
            project_context: None,
            plan_id: plan_id.clone(),
            operation: RefactoringOperation::RenameClass,
            target: RefactoringTarget {
                kind: "class".to_string(),
                path: "src/A.java".to_string(),
                identity: "example.A".to_string(),
                selection: None,
            },
            change_intent: Some(rename_class_intent("B")),
            authority: WorkspaceAuthority {
                workspace_id: workspace_id(),
                workspace_generation: 1,
            },
            selection_generation: 1,
            request_id: "apply-fail-req".to_string(),
            approval: ApprovalEvidence {
                approval_id: "approval-fail".to_string(),
                approved_plan_id: plan_id.clone(),
                approved_at: "2026-08-27T00:00:00Z".to_string(),
            },
        };
        let result = apply_refactoring(apply, &state).unwrap();
        assert_eq!(result["outcome"], "failed");
        // No transaction may be recorded for a failed apply.
        assert!(state.0.lock().unwrap().engine_transactions.is_empty());
        assert!(state.0.lock().unwrap().engine_plans.is_empty());
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn structural_surface_delegation_reports_real_engine_command_result() {
        let _lock = engine_env_lock();
        let root = temp_workspace("structural");
        install_engine_harness(&root, Some(&java_capabilities()), "", true);
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
        // The general IDE operation is parameter rename only; an advertised
        // addParameter proposal does not authorize that operation label.
        assert!(!operations.contains(&"change-method-signature".to_string()));
        assert!(surface.contains(&"scan".to_string()));
        assert!(surface.contains(&"extract-method".to_string()));
        assert!(surface.contains(&"change-signature".to_string()));
        assert!(rollback);
    }

    #[test]
    fn inline_method_is_project_context_only_and_requires_managed_authority_for_apply() {
        let capabilities = json!({
            "adapters": [{
                "languageId": "java",
                "capabilities": [{
                    "operation": "inlineMethod",
                    "stability": "stable",
                    "evidence": "compiler",
                    "mutationAuthority": "managed-stable",
                    "extensions": ["java"]
                }]
            }]
        });
        let probe = RealEngineProbe {
            path: PathBuf::from("/refactorkit"),
            version: "0.8.0".to_string(),
            capabilities: Some(capabilities.clone()),
            help: String::new(),
        };

        let (general_operations, _, _) = derive_surface(Some(&capabilities), "");
        assert!(!general_operations.contains(&"inline-method".to_string()));
        assert!(require_operation_advertised(&probe, RefactoringOperation::InlineMethod).is_ok());
        assert!(
            require_managed_operation_authority(&probe, RefactoringOperation::InlineMethod).is_ok()
        );

        let mut proposal_only = probe.clone();
        proposal_only.capabilities.as_mut().unwrap()["adapters"][0]["capabilities"][0]
            ["mutationAuthority"] = json!("proposal-only");
        assert!(
            require_operation_advertised(&proposal_only, RefactoringOperation::InlineMethod)
                .is_ok()
        );
        assert!(require_managed_operation_authority(
            &proposal_only,
            RefactoringOperation::InlineMethod
        )
        .is_err());
    }

    #[test]
    fn make_public_requires_change_visibility_managed_authority() {
        let capabilities = json!({
            "adapters": [{
                "languageId": "java",
                "capabilities": [{
                    "operation": "changeVisibility",
                    "stability": "stable",
                    "evidence": "compiler",
                    "mutationAuthority": "managed-stable",
                    "extensions": ["java"]
                }]
            }]
        });
        let probe = RealEngineProbe {
            path: PathBuf::from("/refactorkit"),
            version: "0.7.0".to_string(),
            capabilities: Some(capabilities),
            help: String::new(),
        };
        assert!(
            require_managed_operation_authority(&probe, RefactoringOperation::MakePublic).is_ok()
        );

        let mut proposal_only = probe.clone();
        proposal_only.capabilities.as_mut().unwrap()["adapters"][0]["capabilities"][0]
            ["mutationAuthority"] = json!("proposal-only");
        assert!(require_managed_operation_authority(
            &proposal_only,
            RefactoringOperation::MakePublic
        )
        .is_err());
    }

    #[test]
    #[cfg(unix)]
    fn managed_mutation_authority_is_operation_specific_and_requires_supported_evidence() {
        let capabilities = json!({
            "adapters": [{
                "languageId": "java",
                "capabilities": [
                    {"operation":"formatFile", "stability":"stable", "evidence":"structural-parse", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"organizeImports", "stability":"experimental", "evidence":"structural-parse", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"renameClass", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable"},
                    {"operation":"extractParameter", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"extractField", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"inlineVariable", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"inlineConstant", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"pullUpMember", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"pushDownMember", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"moveMember", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]},
                    {"operation":"encapsulateField", "stability":"stable", "evidence":"compiler", "mutationAuthority":"managed-stable", "extensions":["java"]}
                ]
            }]
        });
        let operations = vec![
            "format-file".to_string(),
            "organize-imports".to_string(),
            "rename-class".to_string(),
            "extract-parameter".to_string(),
            "extract-field".to_string(),
            "inline-variable".to_string(),
            "inline-constant".to_string(),
            "pull-up-member".to_string(),
            "push-down-member".to_string(),
            "move-member".to_string(),
            "encapsulate-field".to_string(),
        ];

        let (advertised, _, _) = derive_surface(Some(&capabilities), "");
        assert!(advertised.contains(&"extract-parameter".to_string()));
        assert!(advertised.contains(&"extract-field".to_string()));
        assert!(advertised.contains(&"inline-variable".to_string()));
        assert!(advertised.contains(&"inline-constant".to_string()));
        assert!(advertised.contains(&"pull-up-member".to_string()));
        assert!(advertised.contains(&"push-down-member".to_string()));
        assert!(advertised.contains(&"move-member".to_string()));
        assert!(advertised.contains(&"encapsulate-field".to_string()));

        assert_eq!(
            derive_managed_operations(Some(&capabilities), &operations),
            vec![
                "format-file",
                "rename-class",
                "extract-parameter",
                "extract-field",
                "inline-variable",
                "inline-constant",
                "pull-up-member",
                "push-down-member",
                "move-member",
                "encapsulate-field"
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn engine_apply_refuses_proposal_only_operation_authority_after_preview() {
        let _lock = engine_env_lock();
        let root = temp_workspace("apply-proposal-only");
        let mut capabilities: Value = serde_json::from_str(&java_capabilities()).unwrap();
        let rename = capabilities["adapters"][0]["capabilities"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["operation"] == "renameClass")
            .unwrap();
        rename["stability"] = json!("experimental");
        rename["mutationAuthority"] = json!("proposal-only");
        let capabilities = capabilities.to_string();
        install_engine_harness(&root, Some(&capabilities), &complete_preview_stdout(), true);
        let state = RefactorKitDaemonState::default();
        let workspace = workspace_id();
        let target = RefactoringTarget {
            kind: "class".to_string(),
            path: "src/A.java".to_string(),
            identity: "example.A".to_string(),
            selection: None,
        };
        let previewed = preview_refactoring(
            EnginePreviewRequest {
                formatter_profile: None,
                project_context: None,
                operation: RefactoringOperation::RenameClass,
                target: target.clone(),
                change_intent: Some(rename_class_intent("B")),
                authority: WorkspaceAuthority {
                    workspace_id: workspace.clone(),
                    workspace_generation: 1,
                },
                selection_generation: 1,
                request_id: "proposal-only-preview".to_string(),
            },
            &state,
        )
        .unwrap();
        let plan_id = previewed["planId"].as_str().unwrap().to_string();
        assert_eq!(previewed["status"], "ready");

        let error = apply_refactoring(
            EngineApplyRequest {
                formatter_profile: None,
                formatter_profile_sha256: None,
                project_context: None,
                plan_id: plan_id.clone(),
                operation: RefactoringOperation::RenameClass,
                target,
                change_intent: Some(rename_class_intent("B")),
                authority: WorkspaceAuthority {
                    workspace_id: workspace,
                    workspace_generation: 1,
                },
                selection_generation: 1,
                request_id: "proposal-only-preview".to_string(),
                approval: ApprovalEvidence {
                    approval_id: "proposal-only-approval".to_string(),
                    approved_plan_id: plan_id,
                    approved_at: "2026-10-18T00:00:00Z".to_string(),
                },
            },
            &state,
        )
        .unwrap_err();
        assert!(
            error.contains("stable managed mutation authority"),
            "{error}"
        );
        assert_eq!(state.0.lock().unwrap().engine_plans.len(), 1);
        remove_engine_override();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn engine_rollback_is_exposed_only_when_advertised() {
        let _lock = engine_env_lock();
        let root = temp_workspace("rollback");
        install_engine_harness(&root, Some(&java_capabilities()), "", false);
        let state = RefactorKitDaemonState::default();
        // No advertised transaction, so rollback must refuse.
        let request = EngineRollbackRequest {
            project_context: None,
            expected_snapshot_hash: None,
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
