use std::env;
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::refactorkit_daemon::{
    run_saved_snapshot_diagnostics, SavedSnapshotSemanticState, TypeScriptDiagnosticsError,
    TypeScriptDiagnosticsRequest, TypeScriptDiagnosticsResponse,
};
use crate::commands::workspace_registry::workspace_id_for_path;
use crate::workspace::{ensure_within_root, workspace_root};

const REFACTORKIT_EXECUTABLE: &str = "refactorkit";
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_SYMBOL_BYTES: usize = 512;
const MAX_EXTERNAL_JAVA_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROTOCOL_ID_BYTES: usize = 256;
const EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED: &str = "Update RefactorKit to a managed daemon release that supports java.importExternalClass with targetDirectory, preview, apply, and rollback.";
const EXTERNAL_JAVA_IMPORT_UNAVAILABLE_REASON: &str = "The installed RefactorKit API exposes java.importExternalClass only through a targetPackage contract, and the installed distribution has no managed daemon launcher; path-driven IDE paste is unavailable.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitStatus {
    available: bool,
    path: Option<String>,
    version: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitCapabilities {
    api: &'static str,
    api_version: String,
    provider: &'static str,
    provider_version: Option<String>,
    java_import_external_class: RefactorKitExternalClassImportCapability,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitExternalClassImportCapability {
    supported: bool,
    target_directory: bool,
    preview: bool,
    apply: bool,
    rollback: bool,
    stability: &'static str,
    reason: String,
    update_guidance: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewExternalJavaImportRequest {
    code: String,
    target_directory: String,
    source_kind: String,
    source_url: Option<String>,
    license_policy: String,
    workspace_id: String,
    workspace_generation: u64,
    selection_generation: u64,
    request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefactorKitApprovalEvidence {
    approval_id: String,
    approved_plan_id: String,
    approved_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyRefactorKitPlanRequest {
    plan_id: String,
    workspace_id: String,
    workspace_generation: u64,
    selection_generation: u64,
    request_id: String,
    approval: RefactorKitApprovalEvidence,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackRefactorKitTransactionRequest {
    transaction_id: String,
    workspace_id: String,
    workspace_generation: u64,
    request_id: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitLocation {
    path: String,
    line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitCommandResult {
    stdout: String,
    stderr: String,
    locations: Vec<RefactorKitLocation>,
    success: bool,
    code: i32,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
    command: RefactorKitCommandMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitCommandMetadata {
    executable: String,
    args: Vec<String>,
    cwd: String,
    workspace_root: String,
    timeout_ms: u64,
    output_limit_bytes: usize,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum RefactorKitAction {
    Scan,
    Symbols,
    Definition,
    References,
}

impl RefactorKitAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Scan => "scan",
            Self::Symbols => "symbols",
            Self::Definition => "definition",
            Self::References => "references",
        }
    }
}

pub fn get_refactorkit_capabilities() -> Result<RefactorKitCapabilities, String> {
    probe_refactorkit_capabilities()
}

pub fn preview_refactorkit_external_java_import(
    request: PreviewExternalJavaImportRequest,
) -> Result<serde_json::Value, String> {
    validate_preview_external_java_import_request(&request)?;

    // Capability probing is the only process activity permitted here. The source is never passed
    // to the installed targetPackage-only CLI, and this command never writes to the workspace.
    let capabilities = probe_refactorkit_capabilities()?;
    if !capabilities.java_import_external_class.target_directory {
        return Err(EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED.to_string());
    }

    // A future managed protocol implementation returns the complete RefactorKitPatchPlan here.
    // Refuse until that transport is implemented rather than falling back to --target-package.
    Err(EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED.to_string())
}

pub fn apply_refactorkit_plan(
    request: ApplyRefactorKitPlanRequest,
) -> Result<serde_json::Value, String> {
    validate_apply_refactorkit_plan_request(&request)?;

    // Plans may only be applied by a future managed backend. Never rerun a preview CLI and never
    // materialize a backend plan with direct filesystem writes.
    Err(EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED.to_string())
}

pub fn rollback_refactorkit_transaction(
    request: RollbackRefactorKitTransactionRequest,
) -> Result<serde_json::Value, String> {
    validate_rollback_refactorkit_transaction_request(&request)?;

    // Transaction identifiers are opaque. They are never converted into CLI arguments or paths.
    Err(EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED.to_string())
}

#[tauri::command]
pub fn get_refactorkit_status() -> Result<RefactorKitStatus, String> {
    let path = match find_refactorkit_on_path() {
        Some(path) => path,
        None => {
            return Ok(RefactorKitStatus {
                available: false,
                path: None,
                version: None,
                last_error: Some("refactorkit was not found on PATH".to_string()),
            })
        }
    };

    let cwd = workspace_root()?;
    let args = vec![OsString::from("--version")];
    let output = run_capped_command(&path, &args, &cwd, STATUS_TIMEOUT, MAX_OUTPUT_BYTES);

    match output {
        Ok(output) => {
            let version =
                parse_version_text(&output.stdout).or_else(|| parse_version_text(&output.stderr));
            let last_error = if output.success {
                None
            } else {
                Some(command_error_message(&output, STATUS_TIMEOUT))
            };

            Ok(RefactorKitStatus {
                available: output.success,
                path: Some(path.display().to_string()),
                version,
                last_error,
            })
        }
        Err(error) => Ok(RefactorKitStatus {
            available: false,
            path: Some(path.display().to_string()),
            version: None,
            last_error: Some(error),
        }),
    }
}

fn probe_refactorkit_capabilities() -> Result<RefactorKitCapabilities, String> {
    let Some(executable) = find_refactorkit_on_path() else {
        return Ok(unavailable_external_import_capabilities(
            "unknown".to_string(),
            None,
            "RefactorKit is not installed on an absolute PATH entry.".to_string(),
        ));
    };
    let cwd = workspace_root()?;
    let version_output = run_capped_command(
        &executable,
        &[OsString::from("--version")],
        &cwd,
        STATUS_TIMEOUT,
        MAX_OUTPUT_BYTES,
    );
    let help_output = run_capped_command(
        &executable,
        &[OsString::from("--help")],
        &cwd,
        STATUS_TIMEOUT,
        MAX_OUTPUT_BYTES,
    );

    let version_text = version_output.as_ref().ok().and_then(|output| {
        parse_version_text(&output.stdout).or_else(|| parse_version_text(&output.stderr))
    });
    let (provider_version, api_version) = version_text
        .as_deref()
        .map(parse_refactorkit_version_and_api)
        .unwrap_or((None, None));
    let api_version = api_version.unwrap_or_else(|| "unknown".to_string());
    let help = help_output
        .as_ref()
        .map(|output| format!("{}\n{}", output.stdout, output.stderr))
        .unwrap_or_default();

    let reason = external_import_unavailable_reason(
        &api_version,
        &help,
        version_output.is_err() || help_output.is_err(),
    );

    Ok(unavailable_external_import_capabilities(
        api_version,
        provider_version,
        reason,
    ))
}

fn external_import_unavailable_reason(api_version: &str, help: &str, probe_failed: bool) -> String {
    if api_version == "0.2"
        && help.contains("java import-class --target-package <pkg>")
        && !help.contains("--target-directory")
    {
        EXTERNAL_JAVA_IMPORT_UNAVAILABLE_REASON.to_string()
    } else if probe_failed {
        "RefactorKit capability probing failed; managed external Java import cannot be authorized."
            .to_string()
    } else {
        "RefactorKit did not advertise the required managed targetDirectory external Java import protocol."
            .to_string()
    }
}

fn unavailable_external_import_capabilities(
    api_version: String,
    provider_version: Option<String>,
    reason: String,
) -> RefactorKitCapabilities {
    RefactorKitCapabilities {
        api: "refactorkit",
        api_version,
        provider: "refactorkit",
        provider_version,
        java_import_external_class: RefactorKitExternalClassImportCapability {
            supported: false,
            target_directory: false,
            preview: false,
            apply: false,
            rollback: false,
            stability: "experimental",
            reason,
            update_guidance: EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED.to_string(),
        },
    }
}

fn parse_refactorkit_version_and_api(text: &str) -> (Option<String>, Option<String>) {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty());
    let Some(line) = line else {
        return (None, None);
    };
    let version = line
        .strip_prefix("RefactorKit ")
        .and_then(|rest| rest.split_once(" (API "))
        .map(|(version, _)| version.trim().to_string());
    let api = line
        .split_once("(API ")
        .and_then(|(_, rest)| rest.strip_suffix(')'))
        .map(|api| api.trim().to_string());
    (version, api)
}

fn validate_preview_external_java_import_request(
    request: &PreviewExternalJavaImportRequest,
) -> Result<(), String> {
    validate_workspace_guard(
        &request.workspace_id,
        request.workspace_generation,
        Some(request.selection_generation),
    )?;
    validate_protocol_id("requestId", &request.request_id)?;
    validate_target_directory(&request.target_directory)?;

    validate_external_java_source(&request.code)?;
    if request.source_kind != "clipboard"
        || request.source_url.is_some()
        || request.license_policy != "warn"
    {
        return Err(
            "External Java import requires sourceKind=clipboard, sourceUrl=null, and licensePolicy=warn"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_external_java_source(code: &str) -> Result<(), String> {
    if code.is_empty() {
        return Err("External Java source must not be empty".to_string());
    }
    if code.len() > MAX_EXTERNAL_JAVA_SOURCE_BYTES {
        return Err(format!(
            "External Java source exceeds the {MAX_EXTERNAL_JAVA_SOURCE_BYTES}-byte limit"
        ));
    }
    Ok(())
}

fn validate_apply_refactorkit_plan_request(
    request: &ApplyRefactorKitPlanRequest,
) -> Result<(), String> {
    validate_workspace_guard(
        &request.workspace_id,
        request.workspace_generation,
        Some(request.selection_generation),
    )?;
    validate_protocol_id("requestId", &request.request_id)?;
    validate_protocol_id("planId", &request.plan_id)?;
    validate_protocol_id("approvalId", &request.approval.approval_id)?;
    validate_protocol_text("approvedAt", &request.approval.approved_at)?;
    if request.approval.approved_plan_id != request.plan_id {
        return Err("Approval does not bind the requested RefactorKit plan".to_string());
    }
    Ok(())
}

fn validate_rollback_refactorkit_transaction_request(
    request: &RollbackRefactorKitTransactionRequest,
) -> Result<(), String> {
    validate_workspace_guard(&request.workspace_id, request.workspace_generation, None)?;
    validate_protocol_id("requestId", &request.request_id)?;
    validate_protocol_id("transactionId", &request.transaction_id)
}

fn validate_workspace_guard(
    workspace_id: &str,
    workspace_generation: u64,
    selection_generation: Option<u64>,
) -> Result<(), String> {
    let root = workspace_root()?;
    let expected_workspace_id = workspace_id_for_path(&root);
    if workspace_id != expected_workspace_id {
        return Err("Stale or mismatched workspace selection".to_string());
    }
    if workspace_generation == 0 || selection_generation == Some(0) {
        return Err("Workspace and selection generations must be positive".to_string());
    }
    Ok(())
}

fn validate_target_directory(target_directory: &str) -> Result<String, String> {
    let root = workspace_root()?;
    validate_target_directory_in_root(&root, target_directory)
}

fn validate_target_directory_in_root(
    root: &Path,
    target_directory: &str,
) -> Result<String, String> {
    if target_directory.is_empty()
        || target_directory.contains('\\')
        || Path::new(target_directory).is_absolute()
        || has_drive_or_uri_prefix(target_directory)
    {
        return Err("Target directory must be a canonical workspace-relative path".to_string());
    }

    let mut normalized_parts = Vec::new();
    for component in Path::new(target_directory).components() {
        match component {
            std::path::Component::Normal(part) => {
                let part = part.to_string_lossy();
                if part.is_empty() || part.chars().any(char::is_control) {
                    return Err(
                        "Target directory must be a canonical workspace-relative path".to_string(),
                    );
                }
                normalized_parts.push(part.into_owned());
            }
            _ => {
                return Err(
                    "Target directory must be a canonical workspace-relative path".to_string(),
                )
            }
        }
    }
    let normalized = normalized_parts.join("/");
    if normalized.is_empty() || normalized != target_directory {
        return Err("Target directory must be a canonical workspace-relative path".to_string());
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Cannot resolve the current workspace".to_string())?;
    let candidate = canonical_root.join(&normalized);
    let canonical_target = candidate
        .canonicalize()
        .map_err(|_| "Target directory does not exist".to_string())?;
    ensure_within_root(&canonical_root, &canonical_target)
        .map_err(|_| "Target directory escapes the workspace".to_string())?;
    if !canonical_target.is_dir() {
        return Err("Target path is not a directory".to_string());
    }
    Ok(normalized)
}

fn has_drive_or_uri_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || path.to_ascii_lowercase().starts_with("file:")
}

fn validate_protocol_id(field: &str, value: &str) -> Result<(), String> {
    validate_protocol_text(field, value)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(format!("Invalid RefactorKit {field}"));
    }
    Ok(())
}

fn validate_protocol_text(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_PROTOCOL_ID_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(format!("Invalid RefactorKit {field}"));
    }
    Ok(())
}

#[tauri::command]
pub fn run_refactorkit_scan() -> Result<RefactorKitCommandResult, String> {
    run_refactorkit_action(RefactorKitAction::Scan)
}

#[tauri::command]
pub fn run_refactorkit_diagnostics(
    request: TypeScriptDiagnosticsRequest,
    state: State<'_, SavedSnapshotSemanticState>,
) -> Result<TypeScriptDiagnosticsResponse, TypeScriptDiagnosticsError> {
    run_saved_snapshot_diagnostics(request, &state)
}

#[tauri::command]
pub fn run_refactorkit_symbols() -> Result<RefactorKitCommandResult, String> {
    run_refactorkit_action(RefactorKitAction::Symbols)
}

#[tauri::command]
pub fn run_refactorkit_definition(symbol: String) -> Result<RefactorKitCommandResult, String> {
    run_refactorkit_symbol_action(RefactorKitAction::Definition, symbol)
}

#[tauri::command]
pub fn run_refactorkit_references(symbol: String) -> Result<RefactorKitCommandResult, String> {
    run_refactorkit_symbol_action(RefactorKitAction::References, symbol)
}

fn run_refactorkit_action(action: RefactorKitAction) -> Result<RefactorKitCommandResult, String> {
    let root = workspace_root()?;
    let args = build_refactorkit_args(action, &root);
    execute_refactorkit(action, args, root)
}

fn run_refactorkit_symbol_action(
    action: RefactorKitAction,
    symbol: String,
) -> Result<RefactorKitCommandResult, String> {
    let symbol = validate_symbol(&symbol)?;
    let root = workspace_root()?;
    let args = build_refactorkit_symbol_args(action, &symbol, &root);
    execute_refactorkit(action, args, root)
}

fn execute_refactorkit(
    action: RefactorKitAction,
    args: Vec<OsString>,
    root: PathBuf,
) -> Result<RefactorKitCommandResult, String> {
    let executable = find_refactorkit_on_path()
        .ok_or_else(|| "refactorkit was not found on PATH".to_string())?;
    let output = run_capped_command(&executable, &args, &root, COMMAND_TIMEOUT, MAX_OUTPUT_BYTES)?;
    let locations = locations_from_output(action, &output, &root);

    Ok(RefactorKitCommandResult {
        stdout: output.stdout,
        stderr: output.stderr,
        locations,
        success: output.success,
        code: output.code,
        timed_out: output.timed_out,
        stdout_truncated: output.stdout_truncated,
        stderr_truncated: output.stderr_truncated,
        command: RefactorKitCommandMetadata {
            executable: executable.display().to_string(),
            args: args
                .iter()
                .map(|arg| arg.to_string_lossy().to_string())
                .collect(),
            cwd: root.display().to_string(),
            workspace_root: root.display().to_string(),
            timeout_ms: COMMAND_TIMEOUT.as_millis() as u64,
            output_limit_bytes: MAX_OUTPUT_BYTES,
        },
    })
}

fn locations_from_output(
    action: RefactorKitAction,
    output: &CappedCommandOutput,
    workspace_root: &Path,
) -> Vec<RefactorKitLocation> {
    if !output.success
        || !matches!(
            action,
            RefactorKitAction::Definition | RefactorKitAction::References
        )
    {
        return Vec::new();
    }

    output
        .stdout
        .lines()
        .filter_map(parse_location_line)
        .filter_map(|(path, line, column)| {
            authorize_location(workspace_root, path).map(|path| RefactorKitLocation {
                path,
                line,
                column,
            })
        })
        .collect()
}

fn parse_location_line(line: &str) -> Option<(&str, u32, Option<u32>)> {
    let line = line.trim();
    let (prefix, final_number) = line.rsplit_once(':')?;
    let final_number = parse_one_based_number(final_number)?;

    if let Some((path, possible_line)) = prefix.rsplit_once(':') {
        if let Some(line_number) = parse_one_based_number(possible_line) {
            if !path.is_empty() {
                return Some((path, line_number, Some(final_number)));
            }
        }
    }

    if prefix.is_empty() {
        None
    } else {
        Some((prefix, final_number, None))
    }
}

fn parse_one_based_number(value: &str) -> Option<u32> {
    let number = value.parse::<u32>().ok()?;
    (number > 0).then_some(number)
}

fn authorize_location(workspace_root: &Path, reported_path: &str) -> Option<String> {
    #[cfg(not(windows))]
    if has_windows_drive_prefix(reported_path) {
        return None;
    }

    let canonical_root = workspace_root.canonicalize().ok()?;
    if !canonical_root.is_dir() {
        return None;
    }

    let reported_path = Path::new(reported_path);
    let candidate = if reported_path.is_absolute() {
        reported_path.to_path_buf()
    } else {
        canonical_root.join(reported_path)
    };
    let canonical = candidate.canonicalize().ok()?;
    if !canonical.is_file() || !canonical.starts_with(&canonical_root) {
        return None;
    }

    let relative = canonical.strip_prefix(&canonical_root).ok()?;
    let components: Vec<_> = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect();
    (!components.is_empty()).then(|| components.join("/"))
}

#[cfg(not(windows))]
fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn build_refactorkit_args(action: RefactorKitAction, workspace_root: &Path) -> Vec<OsString> {
    vec![
        OsString::from(action.as_str()),
        workspace_root.as_os_str().to_os_string(),
    ]
}

fn build_refactorkit_symbol_args(
    action: RefactorKitAction,
    symbol: &str,
    workspace_root: &Path,
) -> Vec<OsString> {
    vec![
        OsString::from(action.as_str()),
        OsString::from("--symbol"),
        OsString::from(symbol),
        workspace_root.as_os_str().to_os_string(),
    ]
}

fn validate_symbol(symbol: &str) -> Result<String, String> {
    let symbol = symbol.trim();
    if symbol.is_empty() {
        return Err("RefactorKit symbol must not be empty".to_string());
    }
    if symbol.len() > MAX_SYMBOL_BYTES {
        return Err(format!(
            "RefactorKit symbol must not exceed {MAX_SYMBOL_BYTES} bytes"
        ));
    }
    if symbol.starts_with('-') {
        return Err("RefactorKit symbol must not start with '-'".to_string());
    }
    if symbol.chars().any(char::is_control) {
        return Err("RefactorKit symbol must not contain control characters".to_string());
    }
    if symbol.chars().any(char::is_whitespace) {
        return Err("RefactorKit symbol must not contain whitespace".to_string());
    }
    if symbol.contains(['/', '\\']) {
        return Err("RefactorKit symbol must not contain path separators".to_string());
    }

    validate_symbol_grammar(symbol)?;
    Ok(symbol.to_string())
}

fn validate_symbol_grammar(symbol: &str) -> Result<(), String> {
    let mut parts = symbol.split('#');
    let owner = parts.next().unwrap_or_default();
    let member = parts.next();
    if parts.next().is_some() || !is_qualified_java_name(owner) {
        return Err("Invalid RefactorKit Java symbol selector".to_string());
    }

    if let Some(member) = member {
        if member.is_empty() {
            return Err("Invalid RefactorKit Java member selector".to_string());
        }
        validate_member_selector(member)?;
    }

    Ok(())
}

fn validate_member_selector(member: &str) -> Result<(), String> {
    if let Some(open) = member.find('(') {
        if !member.ends_with(')') || member[..open].contains(')') {
            return Err("Invalid RefactorKit signed method selector".to_string());
        }
        if !is_java_identifier(&member[..open]) {
            return Err("Invalid RefactorKit Java member name".to_string());
        }

        let parameters = &member[open + 1..member.len() - 1];
        if !parameters.is_empty()
            && parameters
                .split(',')
                .any(|parameter| !is_java_type(parameter))
        {
            return Err("Invalid RefactorKit signed method parameter type".to_string());
        }
        return Ok(());
    }

    if is_java_identifier(member) {
        Ok(())
    } else {
        Err("Invalid RefactorKit Java member selector".to_string())
    }
}

fn is_java_type(value: &str) -> bool {
    let mut base = value;
    while let Some(stripped) = base.strip_suffix("[]") {
        base = stripped;
    }
    is_qualified_java_name(base)
}

fn is_qualified_java_name(value: &str) -> bool {
    !value.is_empty() && value.split('.').all(is_java_identifier)
}

fn is_java_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_alphabetic() || first == '_' || first == '$')
        && chars
            .all(|character| character.is_alphanumeric() || character == '_' || character == '$')
}

struct CappedCommandOutput {
    stdout: String,
    stderr: String,
    success: bool,
    code: i32,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

fn run_capped_command(
    executable: &Path,
    args: &[OsString],
    cwd: &Path,
    timeout: Duration,
    output_cap: usize,
) -> Result<CappedCommandOutput, String> {
    let mut child = Command::new(executable)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Command execution failed for '{}': {e}",
                executable.display()
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture refactorkit stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture refactorkit stderr".to_string())?;

    let stdout_thread = thread::spawn(move || read_capped(stdout, output_cap));
    let stderr_thread = thread::spawn(move || read_capped(stderr, output_cap));

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;

    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Cannot poll refactorkit status: {e}"))?
        {
            break status;
        }

        if Instant::now() >= deadline {
            timed_out = true;
            if let Err(kill_error) = child.kill() {
                if child
                    .try_wait()
                    .map_err(|e| format!("Cannot poll refactorkit after kill failure: {e}"))?
                    .is_none()
                {
                    return Err(format!(
                        "Cannot kill timed-out refactorkit process: {kill_error}"
                    ));
                }
            }
            break child
                .wait()
                .map_err(|e| format!("Cannot wait for timed-out refactorkit process: {e}"))?;
        }

        thread::sleep(Duration::from_millis(25));
    };

    let (stdout_bytes, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "Cannot join refactorkit stdout reader".to_string())??;
    let (stderr_bytes, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "Cannot join refactorkit stderr reader".to_string())??;

    let mut stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();
    if timed_out {
        if !stderr_text.is_empty() && !stderr_text.ends_with('\n') {
            stderr_text.push('\n');
        }
        stderr_text.push_str(&format!(
            "refactorkit timed out after {} seconds",
            timeout.as_secs()
        ));
    }

    Ok(CappedCommandOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
        stderr: stderr_text,
        success: status.success() && !timed_out,
        code: if timed_out {
            124
        } else {
            status.code().unwrap_or(1)
        },
        timed_out,
        stdout_truncated,
        stderr_truncated,
    })
}

fn read_capped(mut reader: impl Read, cap: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::with_capacity(cap.min(8192));
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Cannot read refactorkit output: {e}"))?;
        if read == 0 {
            break;
        }

        let remaining = cap.saturating_sub(output.len());
        if remaining > 0 {
            let to_copy = remaining.min(read);
            output.extend_from_slice(&buffer[..to_copy]);
        }

        if read > remaining {
            truncated = true;
        }
    }

    Ok((output, truncated))
}

fn command_error_message(output: &CappedCommandOutput, timeout: Duration) -> String {
    if output.timed_out {
        return format!("refactorkit timed out after {} seconds", timeout.as_secs());
    }

    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }

    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }

    format!("refactorkit exited with code {}", output.code)
}

fn parse_version_text(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn find_refactorkit_on_path() -> Option<PathBuf> {
    find_executable_on_path(OsStr::new(REFACTORKIT_EXECUTABLE))
}

fn find_executable_on_path(executable: &OsStr) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;

    for dir in env::split_paths(&path_var) {
        if !dir.is_absolute() {
            continue;
        }

        for candidate in executable_candidates(&dir, executable) {
            if is_executable_file(&candidate) {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }

    None
}

#[cfg(windows)]
fn executable_candidates(dir: &Path, executable: &OsStr) -> Vec<PathBuf> {
    let executable_path = Path::new(executable);
    if executable_path.extension().is_some() {
        return vec![dir.join(executable_path)];
    }

    let pathext = env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
    pathext
        .to_string_lossy()
        .split(';')
        .filter(|ext| !ext.trim().is_empty())
        .map(|ext| dir.join(format!("{}{}", executable.to_string_lossy(), ext)))
        .chain(std::iter::once(dir.join(executable_path)))
        .collect()
}

#[cfg(not(windows))]
fn executable_candidates(dir: &Path, executable: &OsStr) -> Vec<PathBuf> {
    vec![dir.join(executable)]
}

fn is_executable_file(path: &Path) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_workspace() -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("refactorkit-location-test-{id}"));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn successful_output(stdout: impl Into<String>) -> CappedCommandOutput {
        CappedCommandOutput {
            stdout: stdout.into(),
            stderr: String::new(),
            success: true,
            code: 0,
            timed_out: false,
            stdout_truncated: false,
            stderr_truncated: false,
        }
    }

    #[test]
    fn fixed_scan_args_include_only_action_and_workspace_root() {
        let root = PathBuf::from("/tmp/example-workspace");

        let args = build_refactorkit_args(RefactorKitAction::Scan, &root);

        assert_eq!(args, vec![OsString::from("scan"), root.into_os_string()]);
    }

    #[test]
    fn fixed_actions_map_to_expected_refactorkit_subcommands() {
        assert_eq!(RefactorKitAction::Scan.as_str(), "scan");
        assert_eq!(RefactorKitAction::Symbols.as_str(), "symbols");
        assert_eq!(RefactorKitAction::Definition.as_str(), "definition");
        assert_eq!(RefactorKitAction::References.as_str(), "references");
    }

    #[test]
    fn diagnostics_command_uses_the_correlated_saved_snapshot_boundary() {
        let _: for<'a> fn(
            TypeScriptDiagnosticsRequest,
            State<'a, SavedSnapshotSemanticState>,
        )
            -> Result<TypeScriptDiagnosticsResponse, TypeScriptDiagnosticsError> =
            run_refactorkit_diagnostics;
        let source = include_str!("refactorkit.rs");
        assert!(source.contains("request: TypeScriptDiagnosticsRequest"));
        assert!(source.contains("State<'_, SavedSnapshotSemanticState>"));
        assert!(source.contains("run_saved_snapshot_diagnostics(request, &state)"));
        assert!(!source.contains(concat!(
            "pub fn run_refactorkit_diagnostics() -> Result<",
            "RefactorKitCommandResult, String>"
        )));
    }

    #[test]
    fn symbol_args_have_exact_fixed_order() {
        let root = PathBuf::from("/tmp/example-workspace");

        let args = build_refactorkit_symbol_args(
            RefactorKitAction::References,
            "com.example.Service#find(java.lang.String,int[])",
            &root,
        );

        assert_eq!(
            args,
            vec![
                OsString::from("references"),
                OsString::from("--symbol"),
                OsString::from("com.example.Service#find(java.lang.String,int[])"),
                root.into_os_string(),
            ]
        );
    }

    #[test]
    fn symbol_validation_accepts_and_normalizes_supported_selectors() {
        let accepted = [
            (" com.example.Service ", "com.example.Service"),
            (
                "com.example.Outer$Inner#value",
                "com.example.Outer$Inner#value",
            ),
            ("com.example.Service#find()", "com.example.Service#find()"),
            (
                "com.example.Service#find(java.lang.String,int[],byte[][])",
                "com.example.Service#find(java.lang.String,int[],byte[][])",
            ),
        ];

        for (input, expected) in accepted {
            assert_eq!(validate_symbol(input).unwrap(), expected);
        }
    }

    #[test]
    fn symbol_validation_rejects_malicious_and_invalid_input() {
        let too_long = format!("a.{}", "x".repeat(MAX_SYMBOL_BYTES));
        let rejected = [
            "",
            "   ",
            "-version",
            "com.example.Service member",
            "com.example.Service\n#member",
            "com/example/Service",
            "com\\example\\Service",
            "com.example.Service;rm",
            "com.example.Service&&whoami",
            "com.example.Service|cat",
            "com.example.Service`id`",
            "$(whoami)",
            "com..example.Service",
            "com.example.Service#",
            "com.example.Service#find(java.lang.String,)",
            "com.example.Service#find(java.lang.String);touch",
        ];

        for input in rejected {
            assert!(
                validate_symbol(input).is_err(),
                "unexpectedly accepted {input:?}"
            );
        }
        assert!(validate_symbol(&too_long).is_err());
    }

    #[test]
    fn relative_definition_location_is_authorized_and_normalized() {
        let root = make_temp_workspace();
        let source = root.join("src/main/java/com/acme/Service.java");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "class Service {}\n").unwrap();
        let output = successful_output("src/main/java/com/acme/Service.java:3:7\n");

        let locations = locations_from_output(RefactorKitAction::Definition, &output, &root);

        assert_eq!(
            locations,
            vec![RefactorKitLocation {
                path: "src/main/java/com/acme/Service.java".to_string(),
                line: 3,
                column: Some(7),
            }]
        );
        let serialized = serde_json::to_value(&locations).unwrap();
        assert_eq!(serialized[0]["column"], 7);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multiple_references_preserve_lines_and_omit_absent_columns() {
        let root = make_temp_workspace();
        for path in ["src/One.java", "src/Two.java"] {
            let source = root.join(path);
            fs::create_dir_all(source.parent().unwrap()).unwrap();
            fs::write(source, "class Example {}\n").unwrap();
        }
        let output = successful_output("src/One.java:2\nsrc/Two.java:9\n");

        let locations = locations_from_output(RefactorKitAction::References, &output, &root);

        assert_eq!(locations.len(), 2);
        assert_eq!(locations[0].line, 2);
        assert_eq!(locations[1].line, 9);
        let serialized = serde_json::to_value(&locations).unwrap();
        assert!(serialized[0].get("column").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_and_non_file_location_lines_are_ignored() {
        let root = make_temp_workspace();
        fs::create_dir(root.join("src")).unwrap();
        let output =
            successful_output("not a location\nmissing.java:nope\nmissing.java:0\nsrc:4\n:3\n");

        let locations = locations_from_output(RefactorKitAction::References, &output, &root);

        assert!(locations.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn absolute_inside_location_is_normalized_and_outside_location_is_omitted() {
        let root = make_temp_workspace();
        let inside = root.join("Inside.java");
        fs::write(&inside, "class Inside {}\n").unwrap();
        let outside = env::temp_dir().join(format!(
            "refactorkit-location-outside-{}-Outside.java",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "class Outside {}\n").unwrap();
        let output = successful_output(format!(
            "{}:11\n{}:12\n",
            inside.display(),
            outside.display()
        ));

        let locations = locations_from_output(RefactorKitAction::Definition, &output, &root);

        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].path, "Inside.java");
        assert_eq!(locations[0].line, 11);
        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn traversal_location_is_omitted() {
        let root = make_temp_workspace();
        let outside = root.parent().unwrap().join(format!(
            "refactorkit-traversal-{}.java",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "class Escape {}\n").unwrap();
        let name = outside.file_name().unwrap().to_string_lossy();
        let output = successful_output(format!("../{name}:5\n"));

        let locations = locations_from_output(RefactorKitAction::References, &output, &root);

        assert!(locations.is_empty());
        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_location_is_omitted() {
        let root = make_temp_workspace();
        let outside = env::temp_dir().join(format!(
            "refactorkit-symlink-{}.java",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "class Escape {}\n").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("Linked.java")).unwrap();
        let output = successful_output("Linked.java:8\n");

        let locations = locations_from_output(RefactorKitAction::References, &output, &root);

        assert!(locations.is_empty());
        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_like_drive_colon_is_not_confused_with_line_or_column() {
        assert_eq!(
            parse_location_line(r"C:\work\src\Service.java:31"),
            Some((r"C:\work\src\Service.java", 31, None))
        );
        assert_eq!(
            parse_location_line(r"C:\work\src\Service.java:31:6"),
            Some((r"C:\work\src\Service.java", 31, Some(6)))
        );

        #[cfg(not(windows))]
        {
            let root = make_temp_workspace();
            fs::write(root.join(r"C:\work\src\Service.java"), "class Service {}\n").unwrap();
            assert!(authorize_location(&root, r"C:\work\src\Service.java").is_none());
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn non_lookup_and_failed_commands_have_empty_locations() {
        let root = make_temp_workspace();
        let source = root.join("Service.java");
        fs::write(&source, "class Service {}\n").unwrap();
        let output = successful_output("Service.java:3\n");

        for action in [RefactorKitAction::Scan, RefactorKitAction::Symbols] {
            assert!(locations_from_output(action, &output, &root).is_empty());
        }

        let mut failed = successful_output("Service.java:3\n");
        failed.success = false;
        assert!(locations_from_output(RefactorKitAction::Definition, &failed, &root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_capped_truncates_without_exceeding_cap() {
        let input = Cursor::new(vec![b'x'; 100]);

        let (bytes, truncated) = read_capped(input, 64).unwrap();

        assert_eq!(bytes.len(), 64);
        assert!(truncated);
    }

    #[test]
    fn read_capped_keeps_small_output_unmarked() {
        let input = Cursor::new(b"hello".to_vec());

        let (bytes, truncated) = read_capped(input, 64).unwrap();

        assert_eq!(bytes, b"hello");
        assert!(!truncated);
    }

    #[test]
    fn version_parser_uses_first_non_empty_line() {
        assert_eq!(
            parse_version_text("\n refactorkit 1.2.3\nextra"),
            Some("refactorkit 1.2.3".to_string())
        );
    }

    #[test]
    fn deployed_version_and_api_are_parsed_exactly() {
        assert_eq!(
            parse_refactorkit_version_and_api("RefactorKit 1.0.0-rc.1-SNAPSHOT (API 0.2)\n"),
            (
                Some("1.0.0-rc.1-SNAPSHOT".to_string()),
                Some("0.2".to_string())
            )
        );
    }

    #[test]
    fn deployed_target_package_contract_is_explicitly_unavailable() {
        let deployed_help = "RefactorKit 1.0.0-rc.1-SNAPSHOT  deterministic refactoring engine\n  refactorkit java import-class --target-package <pkg> (--stdin|--file <path>) [--apply] [<root>]\n";
        let reason = external_import_unavailable_reason("0.2", deployed_help, false);
        assert_eq!(reason, EXTERNAL_JAVA_IMPORT_UNAVAILABLE_REASON);

        let capabilities = unavailable_external_import_capabilities(
            "0.2".to_string(),
            Some("1.0.0-rc.1-SNAPSHOT".to_string()),
            EXTERNAL_JAVA_IMPORT_UNAVAILABLE_REASON.to_string(),
        );

        assert!(!capabilities.java_import_external_class.supported);
        assert!(!capabilities.java_import_external_class.target_directory);
        assert!(!capabilities.java_import_external_class.preview);
        assert!(!capabilities.java_import_external_class.apply);
        assert!(!capabilities.java_import_external_class.rollback);
        assert_eq!(
            capabilities.java_import_external_class.update_guidance,
            EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED
        );
    }

    #[test]
    fn target_directory_requires_canonical_existing_workspace_directory() {
        let root = make_temp_workspace();
        fs::create_dir_all(root.join("src/main/java")).unwrap();
        fs::write(root.join("src/main/java/File.java"), "class File {}\n").unwrap();

        assert_eq!(
            validate_target_directory_in_root(&root, "src/main/java").unwrap(),
            "src/main/java"
        );
        for rejected in [
            "../outside",
            "/tmp",
            "C:\\outside",
            "src/./main/java",
            "src/main/java/File.java",
        ] {
            assert!(
                validate_target_directory_in_root(&root, rejected).is_err(),
                "unexpectedly accepted {rejected:?}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn target_directory_rejects_symlink_escape() {
        let root = make_temp_workspace();
        let outside = env::temp_dir().join(format!(
            "refactorkit-import-outside-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();

        assert!(validate_target_directory_in_root(&root, "linked").is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn source_size_error_does_not_leak_source() {
        let secret = format!(
            "SECRET_CLIPBOARD_{}",
            "x".repeat(MAX_EXTERNAL_JAVA_SOURCE_BYTES)
        );
        let error = validate_external_java_source(&secret).unwrap_err();

        assert!(!error.contains("SECRET_CLIPBOARD"));
        assert_eq!(
            error,
            format!("External Java source exceeds the {MAX_EXTERNAL_JAVA_SOURCE_BYTES}-byte limit")
        );
    }

    #[test]
    fn unsupported_mutation_commands_use_one_fixed_update_message() {
        assert_eq!(
            EXTERNAL_JAVA_IMPORT_UPDATE_REQUIRED,
            "Update RefactorKit to a managed daemon release that supports java.importExternalClass with targetDirectory, preview, apply, and rollback."
        );
    }
}
