use std::collections::BTreeMap;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::app_config::{now_rfc3339, settings_path, write_json_pretty};
use crate::workspace::{ensure_within_root, workspace_root};

use super::workspace_registry::workspace_id_for_path;

const PROVIDER_PI: &str = "pi";
const INTEGRATION_SDK: &str = "sdk";
const INTEGRATION_CLI: &str = "cli";
const INTEGRATION_RPC: &str = "rpc";
const PI_PACKAGE: &str = "@earendil-works/pi-coding-agent";
const STATUS_TIMEOUT: Duration = Duration::from_secs(3);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(120);
const RPC_TIMEOUT: Duration = Duration::from_secs(120);
const RPC_COMMANDS_TIMEOUT: Duration = Duration::from_secs(15);
const RPC_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const STATUS_OUTPUT_CAP: usize = 16 * 1024;
const INSTALL_OUTPUT_CAP: usize = 64 * 1024;
const RPC_STDOUT_CAP: usize = 512 * 1024;
const RPC_COMMANDS_STDOUT_CAP: usize = 256 * 1024;
const RPC_STDERR_CAP: usize = 64 * 1024;
const RPC_EVENT_CAP: usize = 100;
const RPC_EVENT_PREVIEW_CAP: usize = 500;
const AGENT_RUN_LIST_DEFAULT_LIMIT: usize = 20;
const AGENT_RUN_LIST_LIMIT_CAP: usize = 100;
const AGENT_RUN_TRACE_EVENT_CAP: usize = 1000;
const AGENT_RUN_TRACE_LINE_CAP: usize = 1024 * 1024;
const AGENT_RUN_CHANGED_FILES_CAP: usize = 500;
const PI_RPC_NO_SESSION_ARGS: &[&str] = &["--mode", "rpc", "--no-session"];
const PI_RPC_PROMPT_ARGS_PREFIX: &[&str] = &["--mode", "rpc", "--session-id"];
const PI_RPC_GET_COMMANDS_REQUEST: &[u8] = b"{\"type\":\"get_commands\"}\n";
const PI_RPC_GET_MESSAGES_COMMAND: &str = "get_messages";
const INSTALL_ARGS: &[&str] = &[
    "install",
    "-g",
    "--ignore-scripts",
    "@earendil-works/pi-coding-agent",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentSettings {
    pub enabled: bool,
    pub provider: String,
    pub preferred_integration: String,
    pub fallback_integrations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Map<String, Value>>,
}

impl Default for PiAgentSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: PROVIDER_PI.to_string(),
            preferred_integration: INTEGRATION_RPC.to_string(),
            fallback_integrations: Vec::new(),
            model: None,
            cli_path: None,
            rpc_endpoint: None,
            metadata: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentSettingsUpdate {
    pub enabled: Option<bool>,
    pub provider: Option<String>,
    pub preferred_integration: Option<String>,
    pub fallback_integrations: Option<Vec<String>>,
    pub model: Option<Option<String>>,
    pub cli_path: Option<Option<String>>,
    pub rpc_endpoint: Option<Option<String>>,
    pub metadata: Option<Option<Map<String, Value>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentStatus {
    pub provider: String,
    pub enabled: bool,
    pub available: bool,
    pub availability: String,
    pub preferred_integration: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_integration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_integrations: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentInstallResult {
    pub provider: String,
    pub success: bool,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentFileChange {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentRun {
    pub run_id: String,
    pub trace_id: Option<String>,
    pub agent_id: Option<String>,
    pub parent_agent_id: Option<String>,
    pub workflow: Option<String>,
    pub workspace_id: Option<String>,
    pub started_at: Option<String>,
    pub sealed_at: Option<String>,
    pub complete: Option<bool>,
    pub event_count: Option<usize>,
    pub changed_files: Vec<PiAgentFileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentRunTrace {
    pub run_id: String,
    pub events: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct IntegrationProbe {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    #[serde(default)]
    pi_agent: PiAgentSettings,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[tauri::command]
pub fn get_pi_agent_settings() -> Result<PiAgentSettings, String> {
    read_pi_agent_settings_at(&settings_path()?)
}

#[tauri::command]
pub fn update_pi_agent_settings(update: PiAgentSettingsUpdate) -> Result<PiAgentSettings, String> {
    let path = settings_path()?;
    update_pi_agent_settings_at(&path, update)
}

#[tauri::command]
pub fn get_pi_agent_status() -> Result<PiAgentStatus, String> {
    let settings = get_pi_agent_settings()?;
    let cli = detect_pi_cli(settings.cli_path.as_deref());
    let sdk = detect_pi_sdk();
    Ok(build_status(settings, cli, sdk, Some(now_rfc3339())))
}

/// Install the optional Pi agent via a fixed, non-shell npm command.
///
/// The caller must pass `confirm: true`; otherwise the command is reported as
/// cancelled. The executed command is exactly:
/// `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.
#[tauri::command]
pub fn install_pi_agent(confirm: bool) -> Result<PiAgentInstallResult, String> {
    install_pi_agent_impl(
        confirm,
        get_pi_agent_detection_status,
        || find_executable_in_path("npm"),
        |npm| run_capped_process(npm, INSTALL_ARGS, None, INSTALL_TIMEOUT, INSTALL_OUTPUT_CAP),
    )
}

/// Send a single prompt to Pi through RPC mode and return the accumulated assistant text.
///
/// This intentionally exposes only the fixed RPC integration. Prompt calls use a
/// stable session id derived from the workspace root (`pi --mode rpc --session-id <id>`)
/// so chat history is isolated per workspace. It does not expose shell execution
/// or arbitrary command arguments. The RPC subprocess is one-shot for this command;
/// stdout is parsed until `agent_settled`, then stdin is closed and the process is
/// allowed to shut down.
#[tauri::command]
pub fn send_pi_agent_prompt(prompt: String) -> Result<Value, String> {
    let settings = get_pi_agent_settings()?;
    let root = workspace_root()?;
    send_pi_agent_prompt_impl(
        prompt,
        settings,
        root,
        || find_executable_in_path("pi"),
        run_pi_rpc_prompt_process,
    )
}

/// Restore persisted Pi RPC session messages for the current workspace.
///
/// This launches the same workspace-scoped session used by prompt calls and sends
/// only a read-only `get_messages` request. It does not send a prompt and does
/// not use command discovery's no-session process.
#[tauri::command]
pub fn get_pi_agent_session_messages() -> Result<Value, String> {
    let settings = get_pi_agent_settings()?;
    let root = workspace_root()?;
    get_pi_agent_session_messages_impl(
        settings,
        root,
        || find_executable_in_path("pi"),
        run_pi_rpc_get_messages_process,
    )
}

/// List Pi slash commands exposed by RPC mode without requiring Pi agent settings to be enabled.
///
/// This intentionally runs only the fixed non-shell command
/// `pi --mode rpc --no-session` in the workspace root and sends the JSONL
/// `get_commands` request. Command discovery remains no-session so it does not
/// mutate or contribute to workspace chat history. The command requires a
/// detectable `pi` CLI on PATH but does not require the optional Pi agent
/// integration to be enabled in app settings.
#[tauri::command]
pub fn list_pi_agent_commands() -> Result<Value, String> {
    let root = workspace_root()?;
    list_pi_agent_commands_impl(
        root,
        || find_executable_in_path("pi"),
        run_pi_rpc_get_commands_process,
    )
}

/// List persisted IDE agent-run traces for the current workspace only.
#[tauri::command]
pub fn list_agent_runs(limit: Option<usize>) -> Result<Vec<PiAgentRun>, String> {
    let root = workspace_root()?;
    list_agent_runs_at(&root, limit)
}

/// Read a persisted IDE agent-run JSONL trace for the current workspace only.
#[tauri::command]
pub fn get_agent_run_trace(run_id: String) -> Result<PiAgentRunTrace, String> {
    let root = workspace_root()?;
    get_agent_run_trace_at(&root, run_id)
}

fn list_agent_runs_at(root: &Path, limit: Option<usize>) -> Result<Vec<PiAgentRun>, String> {
    let Some(runs_dir) = resolve_agent_runs_dir(root, true)? else {
        return Ok(Vec::new());
    };
    let limit = limit
        .unwrap_or(AGENT_RUN_LIST_DEFAULT_LIMIT)
        .min(AGENT_RUN_LIST_LIMIT_CAP);
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut runs: Vec<(PiAgentRun, String)> = Vec::new();
    for entry in fs::read_dir(&runs_dir).map_err(|e| {
        format!(
            "Cannot read agent runs directory '{}': {e}",
            runs_dir.display()
        )
    })? {
        let entry = entry.map_err(|e| format!("Cannot read agent run directory entry: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Cannot read agent run entry type: {e}"))?;
        if !file_type.is_dir() {
            continue;
        }

        let Some(run_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_safe_agent_run_id(&run_id) {
            continue;
        }

        let run_dir = entry.path();
        let metadata =
            read_optional_json_value(&run_dir.join("metadata.json"))?.unwrap_or(Value::Null);
        let seal = read_optional_json_value(&run_dir.join("seal.json"))?;
        let run = build_agent_run_summary(&run_id, &metadata, seal.as_ref());
        let sort_key = run
            .started_at
            .clone()
            .or_else(|| run.sealed_at.clone())
            .unwrap_or_default();
        runs.push((run, sort_key));
    }

    runs.sort_by(|(left, left_key), (right, right_key)| {
        right_key
            .cmp(left_key)
            .then_with(|| right.run_id.cmp(&left.run_id))
    });
    runs.truncate(limit);
    Ok(runs.into_iter().map(|(run, _)| run).collect())
}

fn get_agent_run_trace_at(root: &Path, run_id: String) -> Result<PiAgentRunTrace, String> {
    validate_agent_run_id(&run_id)?;
    let runs_dir = resolve_agent_runs_dir(root, false)?
        .ok_or_else(|| "Agent runs directory does not exist".to_string())?;
    let run_dir = runs_dir.join(&run_id);
    let run_dir_metadata = fs::symlink_metadata(&run_dir).map_err(|e| {
        format!(
            "Cannot read agent run directory '{}': {e}",
            run_dir.display()
        )
    })?;
    if !run_dir_metadata.file_type().is_dir() {
        return Err(format!(
            "Agent run '{}' is not a regular run directory",
            run_id
        ));
    }
    let canonical_run_dir = run_dir.canonicalize().map_err(|e| {
        format!(
            "Cannot resolve agent run directory '{}': {e}",
            run_dir.display()
        )
    })?;
    ensure_within_root(root, &canonical_run_dir)?;
    ensure_path_within_agent_runs(&runs_dir, &canonical_run_dir)?;

    let trace_path = run_dir.join("trace.jsonl");
    let trace_metadata = fs::symlink_metadata(&trace_path).map_err(|e| {
        format!(
            "Cannot read agent run trace '{}': {e}",
            trace_path.display()
        )
    })?;
    if !trace_metadata.file_type().is_file() {
        return Err(format!(
            "Agent run trace '{}' is not a regular file",
            trace_path.display()
        ));
    }

    let file = fs::File::open(&trace_path).map_err(|e| {
        format!(
            "Cannot open agent run trace '{}': {e}",
            trace_path.display()
        )
    })?;
    let reader = BufReader::new(file);
    let events = parse_agent_run_trace_jsonl(reader)?;
    Ok(PiAgentRunTrace { run_id, events })
}

fn resolve_agent_runs_dir(root: &Path, missing_ok: bool) -> Result<Option<PathBuf>, String> {
    let runs_dir = root.join(".ide").join("agent-runs");
    let metadata = match fs::symlink_metadata(&runs_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && missing_ok => {
            return Ok(None)
        }
        Err(error) => {
            return Err(format!(
                "Cannot read agent runs directory '{}': {error}",
                runs_dir.display()
            ))
        }
    };

    if !metadata.file_type().is_dir() {
        return Err(format!(
            "Agent runs path '{}' is not a regular directory",
            runs_dir.display()
        ));
    }

    let canonical = runs_dir.canonicalize().map_err(|e| {
        format!(
            "Cannot resolve agent runs directory '{}': {e}",
            runs_dir.display()
        )
    })?;
    ensure_within_root(root, &canonical)?;
    Ok(Some(canonical))
}

fn ensure_path_within_agent_runs(runs_dir: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(runs_dir) {
        Ok(())
    } else {
        Err(format!(
            "Agent run path escapes agent runs directory: {} is outside {}",
            path.display(),
            runs_dir.display()
        ))
    }
}

fn read_optional_json_value(path: &Path) -> Result<Option<Value>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot read '{}': {error}", path.display())),
    };
    if !metadata.file_type().is_file() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(path).map_err(|e| format!("Cannot read '{}': {e}", path.display()))?;
    Ok(Some(serde_json::from_str(&content).unwrap_or(Value::Null)))
}

fn build_agent_run_summary(run_id: &str, metadata: &Value, seal: Option<&Value>) -> PiAgentRun {
    PiAgentRun {
        run_id: run_id.to_string(),
        trace_id: json_string(metadata, "traceId").or_else(|| json_string_opt(seal, "traceId")),
        agent_id: json_string(metadata, "agentId").or_else(|| json_string_opt(seal, "agentId")),
        parent_agent_id: json_string(metadata, "parentAgentId")
            .or_else(|| json_string_opt(seal, "parentAgentId")),
        workflow: json_string(metadata, "workflow").or_else(|| json_string_opt(seal, "workflow")),
        workspace_id: json_string(metadata, "workspaceId")
            .or_else(|| json_string_opt(seal, "workspaceId")),
        started_at: json_string(metadata, "startedAt")
            .or_else(|| json_string_opt(seal, "startedAt")),
        sealed_at: json_string_opt(seal, "sealedAt").or_else(|| json_string(metadata, "sealedAt")),
        complete: json_bool_opt(seal, "complete").or_else(|| json_bool(metadata, "complete")),
        event_count: json_usize_opt(seal, "eventCount")
            .or_else(|| json_usize(metadata, "eventCount")),
        changed_files: extract_agent_run_changed_files(metadata, seal),
    }
}

fn extract_agent_run_changed_files(
    metadata: &Value,
    seal: Option<&Value>,
) -> Vec<PiAgentFileChange> {
    let candidates = [
        seal.and_then(|value| value.get("changedFiles")),
        seal.and_then(|value| value.get("rawTrajectory"))
            .and_then(|value| value.get("changedFiles")),
        metadata.get("changedFiles"),
    ];

    candidates
        .into_iter()
        .flatten()
        .find_map(|value| value.as_array())
        .map(|files| {
            files
                .iter()
                .take(AGENT_RUN_CHANGED_FILES_CAP)
                .filter_map(|file| {
                    let path = file.get("path").and_then(Value::as_str)?.to_string();
                    if path.is_empty() {
                        return None;
                    }
                    let status = file
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("modified")
                        .to_string();
                    Some(PiAgentFileChange { path, status })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_string_opt(value: Option<&Value>, key: &str) -> Option<String> {
    value.and_then(|value| json_string(value, key))
}

fn json_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn json_bool_opt(value: Option<&Value>, key: &str) -> Option<bool> {
    value.and_then(|value| json_bool(value, key))
}

fn json_usize(value: &Value, key: &str) -> Option<usize> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
}

fn json_usize_opt(value: Option<&Value>, key: &str) -> Option<usize> {
    value.and_then(|value| json_usize(value, key))
}

fn validate_agent_run_id(run_id: &str) -> Result<(), String> {
    if is_safe_agent_run_id(run_id) {
        Ok(())
    } else {
        Err("Agent run id must be a safe single path segment".to_string())
    }
}

fn is_safe_agent_run_id(run_id: &str) -> bool {
    if run_id.is_empty()
        || run_id == "."
        || run_id == ".."
        || run_id.contains('/')
        || run_id.contains('\\')
        || run_id.contains('\0')
    {
        return false;
    }

    let mut components = Path::new(run_id).components();
    matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::Normal(component)), None) if component == run_id
    )
}

fn parse_agent_run_trace_jsonl<R: BufRead>(mut reader: R) -> Result<Vec<Value>, String> {
    let mut events = Vec::new();
    let mut line = Vec::new();

    loop {
        let available = reader
            .fill_buf()
            .map_err(|e| format!("Cannot read agent run trace JSONL: {e}"))?;
        if available.is_empty() {
            if !line.is_empty() && events.len() < AGENT_RUN_TRACE_EVENT_CAP {
                parse_agent_run_trace_line(&line, &mut events)?;
            }
            break;
        }

        let newline_index = available.iter().position(|byte| *byte == b'\n');
        let take_len = newline_index
            .map(|index| index + 1)
            .unwrap_or(available.len());
        if line.len() + take_len > AGENT_RUN_TRACE_LINE_CAP {
            return Err(format!(
                "Agent run trace JSONL line exceeds {} bytes",
                AGENT_RUN_TRACE_LINE_CAP
            ));
        }
        line.extend_from_slice(&available[..take_len]);
        reader.consume(take_len);

        if newline_index.is_some() {
            if events.len() < AGENT_RUN_TRACE_EVENT_CAP {
                parse_agent_run_trace_line(&line, &mut events)?;
            }
            line.clear();
            if events.len() >= AGENT_RUN_TRACE_EVENT_CAP {
                break;
            }
        }
    }

    Ok(events)
}

fn parse_agent_run_trace_line(line: &[u8], events: &mut Vec<Value>) -> Result<(), String> {
    let trimmed = trim_jsonl_line(line);
    if trimmed.is_empty() {
        return Ok(());
    }

    let value: Value = serde_json::from_slice(trimmed)
        .map_err(|e| format!("Cannot parse agent run trace JSONL event: {e}"))?;
    if !value.is_object() {
        return Err("Agent run trace JSONL event must be a JSON object".to_string());
    }
    events.push(value);
    Ok(())
}

fn trim_jsonl_line(mut line: &[u8]) -> &[u8] {
    while matches!(line.last(), Some(b'\n' | b'\r' | b' ' | b'\t')) {
        line = &line[..line.len() - 1];
    }
    while matches!(line.first(), Some(b' ' | b'\t')) {
        line = &line[1..];
    }
    line
}

fn list_pi_agent_commands_impl(
    workspace_root: PathBuf,
    find_pi: impl FnOnce() -> Option<PathBuf>,
    run_rpc: impl FnOnce(&Path, &Path) -> Result<PiRpcCommandsResult, String>,
) -> Result<Value, String> {
    let Some(pi) = find_pi() else {
        return Err("pi CLI was not found on PATH; Pi RPC mode requires the pi CLI".to_string());
    };

    let result = run_rpc(&pi, &workspace_root)?;
    let command_count = result.commands.len();

    Ok(json!({
        "provider": PROVIDER_PI,
        "integration": INTEGRATION_RPC,
        "commands": result.commands,
        "metadata": {
            "command": pi_rpc_no_session_command_for_metadata(),
            "cwd": workspace_root.to_string_lossy(),
            "request": { "type": "get_commands" },
            "commandCount": command_count,
            "exitCode": result.exit_code,
            "stdoutTruncated": result.stdout_truncated,
            "stderrTruncated": result.stderr_truncated,
        }
    }))
}

fn send_pi_agent_prompt_impl(
    prompt: String,
    settings: PiAgentSettings,
    workspace_root: PathBuf,
    find_pi: impl FnOnce() -> Option<PathBuf>,
    run_rpc: impl FnOnce(&Path, &Path, &str, &str, &str) -> Result<PiRpcPromptResult, String>,
) -> Result<Value, String> {
    if !settings.enabled {
        return Err("Pi agent is disabled in settings".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("Pi agent prompt must not be empty".to_string());
    }

    let Some(pi) = find_pi() else {
        return Err("pi CLI was not found on PATH; Pi RPC mode requires the pi CLI".to_string());
    };

    let workspace_id = workspace_id_for_path(&workspace_root);
    let session_id = pi_rpc_session_id_for_workspace_id(&workspace_id);
    let request_id = new_rpc_request_id();
    let result = run_rpc(&pi, &workspace_root, &session_id, &request_id, &prompt)?;

    Ok(json!({
        "provider": PROVIDER_PI,
        "integration": INTEGRATION_RPC,
        "text": result.text,
        "metadata": {
            "oneShot": true,
            "oneShotProcess": true,
            "streaming": false,
            "command": pi_rpc_prompt_command_for_metadata(&session_id),
            "cwd": workspace_root.to_string_lossy(),
            "workspaceId": workspace_id,
            "sessionId": session_id,
            "requestId": request_id,
            "eventCount": result.event_count,
            "events": result.events,
            "exitCode": result.exit_code,
            "stdoutTruncated": result.stdout_truncated,
            "stderrTruncated": result.stderr_truncated,
            "shutdownTimedOut": result.shutdown_timed_out,
        }
    }))
}

fn get_pi_agent_session_messages_impl(
    settings: PiAgentSettings,
    workspace_root: PathBuf,
    find_pi: impl FnOnce() -> Option<PathBuf>,
    run_rpc: impl FnOnce(&Path, &Path, &str, &str) -> Result<PiRpcMessagesResult, String>,
) -> Result<Value, String> {
    if !settings.enabled {
        return Err("Pi agent is disabled in settings".to_string());
    }

    let Some(pi) = find_pi() else {
        return Err("pi CLI was not found on PATH; Pi RPC mode requires the pi CLI".to_string());
    };

    let workspace_id = workspace_id_for_path(&workspace_root);
    let session_id = pi_rpc_session_id_for_workspace_id(&workspace_id);
    let request_id = new_rpc_request_id();
    let result = run_rpc(&pi, &workspace_root, &session_id, &request_id)?;
    let message_count = result.messages.len();

    Ok(json!({
        "provider": PROVIDER_PI,
        "integration": INTEGRATION_RPC,
        "workspaceId": workspace_id.clone(),
        "sessionId": session_id.clone(),
        "messages": result.messages,
        "metadata": {
            "readOnly": true,
            "oneShotProcess": true,
            "command": pi_rpc_prompt_command_for_metadata(&session_id),
            "cwd": workspace_root.to_string_lossy(),
            "workspaceId": workspace_id,
            "sessionId": session_id,
            "request": {
                "id": request_id.clone(),
                "type": PI_RPC_GET_MESSAGES_COMMAND,
            },
            "requestId": request_id,
            "messageCount": message_count,
            "exitCode": result.exit_code,
            "stdoutTruncated": result.stdout_truncated,
            "stderrTruncated": result.stderr_truncated,
        }
    }))
}

fn install_pi_agent_impl(
    confirm: bool,
    detect_status: impl Fn() -> Result<PiAgentStatus, String>,
    find_npm: impl Fn() -> Option<PathBuf>,
    run_install: impl Fn(&Path) -> Result<ProcessOutput, String>,
) -> Result<PiAgentInstallResult, String> {
    if !confirm {
        return Ok(PiAgentInstallResult {
            provider: PROVIDER_PI.to_string(),
            success: false,
            outcome: "cancelled".to_string(),
            integration: None,
            version: None,
            message: Some("Pi agent installation requires explicit confirmation".to_string()),
            metadata: Some(json!({ "command": install_command_for_metadata() })),
        });
    }

    let before = detect_status()?;
    if before.available {
        return Ok(PiAgentInstallResult {
            provider: PROVIDER_PI.to_string(),
            success: true,
            outcome: "already-installed".to_string(),
            integration: before.active_integration.clone(),
            version: before.version.clone(),
            message: Some("Pi agent is already installed".to_string()),
            metadata: Some(json!({ "status": before, "command": install_command_for_metadata() })),
        });
    }

    let Some(npm) = find_npm() else {
        return Ok(PiAgentInstallResult {
            provider: PROVIDER_PI.to_string(),
            success: false,
            outcome: "unsupported".to_string(),
            integration: None,
            version: None,
            message: Some("npm was not found on PATH".to_string()),
            metadata: Some(json!({ "command": install_command_for_metadata() })),
        });
    };
    let output = run_install(&npm)?;
    let success = output.success && !output.timed_out;
    let after = detect_status().ok();

    Ok(PiAgentInstallResult {
        provider: PROVIDER_PI.to_string(),
        success,
        outcome: if success { "installed" } else { "failed" }.to_string(),
        integration: after
            .as_ref()
            .and_then(|status| status.active_integration.clone()),
        version: after.as_ref().and_then(|status| status.version.clone()),
        message: Some(if success {
            "Pi agent installation command completed".to_string()
        } else if output.timed_out {
            format!(
                "Pi agent installation timed out after {} seconds",
                INSTALL_TIMEOUT.as_secs()
            )
        } else {
            "Pi agent installation command failed".to_string()
        }),
        metadata: Some(json!({
            "command": install_command_for_metadata(),
            "exitCode": output.code,
            "timedOut": output.timed_out,
            "stdout": output.stdout,
            "stderr": output.stderr,
            "stdoutTruncated": output.stdout_truncated,
            "stderrTruncated": output.stderr_truncated,
            "statusAfter": after,
        })),
    })
}

fn get_pi_agent_detection_status() -> Result<PiAgentStatus, String> {
    let mut settings = get_pi_agent_settings()?;
    settings.enabled = true;
    let cli = detect_pi_cli(settings.cli_path.as_deref());
    let sdk = detect_pi_sdk();
    Ok(build_status(settings, cli, sdk, Some(now_rfc3339())))
}

pub(crate) fn read_pi_agent_settings_at(path: &Path) -> Result<PiAgentSettings, String> {
    if !path.exists() {
        return Ok(PiAgentSettings::default());
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Cannot read settings '{}': {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(PiAgentSettings::default());
    }

    let file: SettingsFile = serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse settings '{}': {e}", path.display()))?;
    normalize_settings(file.pi_agent)
}

pub(crate) fn update_pi_agent_settings_at(
    path: &Path,
    update: PiAgentSettingsUpdate,
) -> Result<PiAgentSettings, String> {
    let mut file = read_settings_file_at(path)?;
    let mut settings = normalize_settings(file.pi_agent)?;
    apply_settings_update(&mut settings, update)?;
    file.pi_agent = normalize_settings(settings)?;
    write_json_pretty(path, &file)?;
    Ok(file.pi_agent)
}

fn read_settings_file_at(path: &Path) -> Result<SettingsFile, String> {
    if !path.exists() {
        return Ok(SettingsFile::default());
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Cannot read settings '{}': {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(SettingsFile::default());
    }

    serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse settings '{}': {e}", path.display()))
}

fn apply_settings_update(
    settings: &mut PiAgentSettings,
    update: PiAgentSettingsUpdate,
) -> Result<(), String> {
    if let Some(enabled) = update.enabled {
        settings.enabled = enabled;
    }

    if let Some(provider) = update.provider {
        if provider != PROVIDER_PI {
            return Err(format!("Unsupported AI agent provider: {provider}"));
        }
        settings.provider = provider;
    }

    if let Some(preferred) = update.preferred_integration {
        settings.preferred_integration = normalize_preferred_integration(&preferred)?.to_string();
    }

    if update.fallback_integrations.is_some() {
        settings.fallback_integrations.clear();
    }

    if let Some(model) = update.model {
        settings.model = normalize_optional_non_empty(model);
    }
    if let Some(cli_path) = update.cli_path {
        settings.cli_path = normalize_optional_non_empty(cli_path);
    }
    if let Some(rpc_endpoint) = update.rpc_endpoint {
        settings.rpc_endpoint = normalize_optional_non_empty(rpc_endpoint);
    }
    if let Some(metadata) = update.metadata {
        settings.metadata = metadata;
    }

    Ok(())
}

fn normalize_settings(mut settings: PiAgentSettings) -> Result<PiAgentSettings, String> {
    if settings.provider.is_empty() {
        settings.provider = PROVIDER_PI.to_string();
    }
    if settings.provider != PROVIDER_PI {
        return Err(format!(
            "Unsupported AI agent provider: {}",
            settings.provider
        ));
    }

    settings.preferred_integration =
        normalize_preferred_integration(&settings.preferred_integration)?.to_string();
    settings.fallback_integrations.clear();

    settings.model = normalize_optional_non_empty(settings.model);
    settings.cli_path = normalize_optional_non_empty(settings.cli_path);
    settings.rpc_endpoint = normalize_optional_non_empty(settings.rpc_endpoint);
    Ok(settings)
}

fn normalize_optional_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_preferred_integration(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | INTEGRATION_RPC | INTEGRATION_CLI | INTEGRATION_SDK => Ok(INTEGRATION_RPC),
        _ => Err(format!("Unsupported Pi integration: {value}")),
    }
}

fn build_status(
    settings: PiAgentSettings,
    cli: IntegrationProbe,
    sdk: IntegrationProbe,
    checked_at: Option<String>,
) -> PiAgentStatus {
    let rpc = rpc_probe_from_cli(&cli);
    let active = if settings.enabled && rpc.available {
        Some(INTEGRATION_RPC.to_string())
    } else {
        None
    };
    let version = active.as_ref().and_then(|_| rpc.version.clone());
    let last_error = if active.is_none() {
        rpc.last_error.clone()
    } else {
        None
    };

    let availability = if !settings.enabled {
        "disabled"
    } else if active.is_some() {
        "available"
    } else {
        "not-installed"
    };

    PiAgentStatus {
        provider: PROVIDER_PI.to_string(),
        enabled: settings.enabled,
        available: active.is_some(),
        availability: availability.to_string(),
        preferred_integration: INTEGRATION_RPC.to_string(),
        active_integration: active,
        fallback_integrations: Some(Vec::new()),
        version,
        last_error,
        checked_at,
        metadata: Some(json!({
            "cli": cli,
            "sdk": sdk,
            "rpc": rpc,
            "installCommand": install_command_for_metadata()
        })),
    }
}

fn rpc_probe_from_cli(cli: &IntegrationProbe) -> IntegrationProbe {
    IntegrationProbe {
        available: cli.available,
        path: cli.path.clone(),
        version: cli.version.clone(),
        last_error: if cli.available {
            cli.last_error.clone()
        } else {
            cli.last_error
                .clone()
                .or_else(|| Some("pi CLI is required for RPC mode".to_string()))
        },
    }
}

fn detect_pi_cli(cli_path: Option<&str>) -> IntegrationProbe {
    let custom_path_note = cli_path.and_then(|path| {
        let trimmed = path.trim();
        if trimmed.is_empty() || trimmed == "pi" || trimmed == "pi.exe" {
            None
        } else {
            Some("Custom cliPath is stored but was not executed by status policy".to_string())
        }
    });

    let Some(program) = find_executable_in_path("pi") else {
        return IntegrationProbe {
            available: false,
            path: None,
            version: None,
            last_error: custom_path_note
                .or_else(|| Some("pi CLI was not found on PATH".to_string())),
        };
    };

    match run_capped_process(
        &program,
        &["--version"],
        None,
        STATUS_TIMEOUT,
        STATUS_OUTPUT_CAP,
    ) {
        Ok(output) if output.success => IntegrationProbe {
            available: true,
            path: Some(program.to_string_lossy().to_string()),
            version: parse_version_from_output(&output.stdout)
                .or_else(|| parse_version_from_output(&output.stderr)),
            last_error: custom_path_note,
        },
        Ok(output) => IntegrationProbe {
            available: true,
            path: Some(program.to_string_lossy().to_string()),
            version: parse_version_from_output(&output.stdout)
                .or_else(|| parse_version_from_output(&output.stderr)),
            last_error: Some(if output.timed_out {
                format!(
                    "pi --version timed out after {} seconds",
                    STATUS_TIMEOUT.as_secs()
                )
            } else {
                output.stderr.trim().to_string()
            })
            .filter(|message| !message.is_empty())
            .or(custom_path_note),
        },
        Err(error) => IntegrationProbe {
            available: false,
            path: Some(program.to_string_lossy().to_string()),
            version: None,
            last_error: Some(error),
        },
    }
}

fn detect_pi_sdk() -> IntegrationProbe {
    let Some(node) = find_executable_in_path("node") else {
        return IntegrationProbe {
            available: false,
            path: None,
            version: None,
            last_error: Some("node was not found on PATH".to_string()),
        };
    };

    let script = format!(
        "const pkg='{package}/package.json';try{{const resolved=require.resolve(pkg);const manifest=require(resolved);process.stdout.write(JSON.stringify({{available:true,path:resolved,version:manifest.version||null}}));}}catch(error){{process.stdout.write(JSON.stringify({{available:false,lastError:error&&error.message?error.message:String(error)}}));}}",
        package = PI_PACKAGE
    );

    match run_capped_process(
        &node,
        &["-e", &script],
        None,
        STATUS_TIMEOUT,
        STATUS_OUTPUT_CAP,
    ) {
        Ok(output) if output.success => parse_sdk_probe_output(&output.stdout),
        Ok(output) => IntegrationProbe {
            available: false,
            path: Some(node.to_string_lossy().to_string()),
            version: None,
            last_error: Some(if output.timed_out {
                format!(
                    "node SDK probe timed out after {} seconds",
                    STATUS_TIMEOUT.as_secs()
                )
            } else {
                output.stderr.trim().to_string()
            })
            .filter(|message| !message.is_empty()),
        },
        Err(error) => IntegrationProbe {
            available: false,
            path: Some(node.to_string_lossy().to_string()),
            version: None,
            last_error: Some(error),
        },
    }
}

fn parse_sdk_probe_output(output: &str) -> IntegrationProbe {
    let parsed: Result<IntegrationProbe, _> = serde_json::from_str(output.trim());
    parsed.unwrap_or_else(|e| IntegrationProbe {
        available: false,
        path: None,
        version: None,
        last_error: Some(format!("Cannot parse SDK probe output: {e}")),
    })
}

fn parse_version_from_output(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|part| part.chars().any(|ch| ch.is_ascii_digit()))
        .map(|part| {
            part.trim_matches(|ch: char| ch == 'v' || ch == ',')
                .to_string()
        })
        .filter(|part| !part.is_empty())
}

fn install_command_for_metadata() -> Vec<String> {
    std::iter::once("npm".to_string())
        .chain(INSTALL_ARGS.iter().map(|arg| (*arg).to_string()))
        .collect()
}

fn pi_rpc_no_session_command_for_metadata() -> Vec<String> {
    std::iter::once("pi".to_string())
        .chain(PI_RPC_NO_SESSION_ARGS.iter().map(|arg| (*arg).to_string()))
        .collect()
}

fn pi_rpc_prompt_command_for_metadata(session_id: &str) -> Vec<String> {
    std::iter::once("pi".to_string())
        .chain(
            PI_RPC_PROMPT_ARGS_PREFIX
                .iter()
                .map(|arg| (*arg).to_string()),
        )
        .chain(std::iter::once(session_id.to_string()))
        .collect()
}

fn pi_rpc_session_id_for_workspace_id(workspace_id: &str) -> String {
    format!("ide-{workspace_id}")
}

fn new_rpc_request_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("ide-pi-rpc-{nanos}")
}

#[derive(Debug)]
struct PiRpcCommandsResult {
    commands: Vec<PiAgentCommand>,
    exit_code: i32,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

#[derive(Debug)]
struct PiRpcMessagesResult {
    messages: Vec<Value>,
    exit_code: i32,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PiAgentCommand {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[derive(Debug)]
struct PiRpcPromptResult {
    text: String,
    event_count: usize,
    events: Vec<PiRpcEventSummary>,
    exit_code: i32,
    stdout_truncated: bool,
    stderr_truncated: bool,
    shutdown_timed_out: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PiRpcEventSummary {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct PiRpcParsedOutput {
    text: String,
    event_count: usize,
    events: Vec<PiRpcEventSummary>,
}

#[derive(Debug)]
struct PiRpcParseState {
    request_id: String,
    prompt_response_seen: bool,
    prompt_accepted: bool,
    settled: bool,
    text: String,
    event_count: usize,
    events: Vec<PiRpcEventSummary>,
    error: Option<String>,
}

impl PiRpcParseState {
    fn new(request_id: &str) -> Self {
        Self {
            request_id: request_id.to_string(),
            prompt_response_seen: false,
            prompt_accepted: false,
            settled: false,
            text: String::new(),
            event_count: 0,
            events: Vec::new(),
            error: None,
        }
    }

    fn observe_line(&mut self, line: &str) -> Result<(), String> {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            return Ok(());
        }

        let value: Value = serde_json::from_str(line)
            .map_err(|e| format!("Cannot parse Pi RPC stdout JSONL: {e}"))?;
        let message_type = value.get("type").and_then(Value::as_str).unwrap_or("");

        if message_type == "response" {
            self.observe_response(&value);
        } else {
            self.observe_event(message_type, &value);
        }

        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        Ok(())
    }

    fn observe_response(&mut self, value: &Value) {
        let command = value.get("command").and_then(Value::as_str);
        let id_matches = value
            .get("id")
            .and_then(Value::as_str)
            .map(|id| id == self.request_id)
            .unwrap_or(false);
        if command != Some("prompt") || !id_matches {
            return;
        }

        self.prompt_response_seen = true;
        if value
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            self.prompt_accepted = true;
        } else {
            self.error = Some(format!(
                "Pi RPC prompt was rejected: {}",
                rpc_error_text(value).unwrap_or_else(|| "unknown error".to_string())
            ));
        }
    }

    fn observe_event(&mut self, message_type: &str, value: &Value) {
        self.event_count += 1;
        self.observe_event_summary(message_type, value);
        match message_type {
            "message_update" => self.observe_message_update(value),
            "agent_settled" => self.settled = true,
            "extension_error" => {
                self.error = Some(format!(
                    "Pi RPC extension error: {}",
                    rpc_error_text(value).unwrap_or_else(|| "unknown extension error".to_string())
                ));
            }
            "auto_retry_end" if value.get("success").and_then(Value::as_bool) == Some(false) => {
                self.error = Some(format!(
                    "Pi RPC auto-retry failed: {}",
                    value
                        .get("finalError")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| rpc_error_text(value))
                        .unwrap_or_else(|| "unknown retry error".to_string())
                ));
            }
            "compaction_end"
                if value.get("errorMessage").and_then(Value::as_str).is_some()
                    && value.get("willRetry").and_then(Value::as_bool) != Some(true) =>
            {
                self.error = Some(format!(
                    "Pi RPC compaction failed: {}",
                    value
                        .get("errorMessage")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown compaction error")
                ));
            }
            "error" => {
                self.error = Some(format!(
                    "Pi RPC event error: {}",
                    rpc_error_text(value).unwrap_or_else(|| "unknown event error".to_string())
                ));
            }
            _ => {}
        }
    }

    fn observe_event_summary(&mut self, message_type: &str, value: &Value) {
        if self.events.len() >= RPC_EVENT_CAP {
            return;
        }
        if let Some(summary) = summarize_rpc_event(message_type, value) {
            self.events.push(summary);
        }
    }

    fn observe_message_update(&mut self, value: &Value) {
        let Some(event) = value.get("assistantMessageEvent") else {
            return;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    self.text.push_str(delta);
                }
            }
            Some("error") => {
                self.error = Some(format!(
                    "Pi RPC assistant stream error: {}",
                    rpc_error_text(event).unwrap_or_else(|| "unknown assistant error".to_string())
                ));
            }
            _ => {}
        }
    }

    fn finish(self) -> Result<PiRpcParsedOutput, String> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if !self.prompt_response_seen {
            return Err("Pi RPC did not return a prompt response".to_string());
        }
        if !self.prompt_accepted {
            return Err("Pi RPC prompt was not accepted".to_string());
        }
        if !self.settled {
            return Err("Pi RPC ended before agent_settled".to_string());
        }
        Ok(PiRpcParsedOutput {
            text: self.text,
            event_count: self.event_count,
            events: self.events,
        })
    }
}

#[cfg(test)]
fn parse_pi_rpc_stdout(stdout: &str, request_id: &str) -> Result<PiRpcParsedOutput, String> {
    let mut state = PiRpcParseState::new(request_id);
    for line in stdout.split('\n') {
        state.observe_line(line)?;
    }
    state.finish()
}

fn parse_pi_rpc_get_commands_stdout(stdout: &str) -> Result<Vec<PiAgentCommand>, String> {
    for line in stdout.split('\n') {
        let line = line.trim_end_matches('\r').trim();
        if line.is_empty() {
            continue;
        }

        let value: Value = serde_json::from_str(line)
            .map_err(|e| format!("Cannot parse Pi RPC stdout JSONL: {e}"))?;
        let message_type = value.get("type").and_then(Value::as_str);
        let command = value.get("command").and_then(Value::as_str);
        if message_type != Some("response") || command != Some("get_commands") {
            continue;
        }

        if value.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "Pi RPC get_commands was rejected: {}",
                rpc_error_text(&value).unwrap_or_else(|| "unknown error".to_string())
            ));
        }

        let commands = value
            .get("data")
            .and_then(|data| data.get("commands"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                "Pi RPC get_commands response did not include data.commands".to_string()
            })?;

        return Ok(commands
            .iter()
            .filter_map(pi_agent_command_from_value)
            .collect());
    }

    Err("Pi RPC did not return a get_commands response".to_string())
}

fn parse_pi_rpc_get_messages_stdout(stdout: &str, request_id: &str) -> Result<Vec<Value>, String> {
    for line in stdout.split('\n') {
        let line = line.trim_end_matches('\r').trim();
        if line.is_empty() {
            continue;
        }

        let value: Value = serde_json::from_str(line)
            .map_err(|e| format!("Cannot parse Pi RPC stdout JSONL: {e}"))?;
        let message_type = value.get("type").and_then(Value::as_str);
        let command = value.get("command").and_then(Value::as_str);
        if message_type != Some("response") || command != Some(PI_RPC_GET_MESSAGES_COMMAND) {
            continue;
        }
        if value
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id != request_id)
        {
            continue;
        }

        if value.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "Pi RPC get_messages was rejected: {}",
                rpc_error_text(&value).unwrap_or_else(|| "unknown error".to_string())
            ));
        }

        let messages = value
            .get("data")
            .and_then(|data| data.get("messages"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                "Pi RPC get_messages response did not include data.messages".to_string()
            })?;

        return Ok(messages.clone());
    }

    Err("Pi RPC did not return a get_messages response".to_string())
}

fn pi_agent_command_from_value(value: &Value) -> Option<PiAgentCommand> {
    let name = normalized_non_empty_field(value, "name")?;
    let source = normalized_non_empty_field(value, "source")?;
    if !matches!(source.as_str(), "extension" | "prompt" | "skill") {
        return None;
    }

    Some(PiAgentCommand {
        name,
        description: normalized_non_empty_field(value, "description"),
        source,
        location: normalized_non_empty_field(value, "location"),
        path: normalized_non_empty_field(value, "path"),
    })
}

fn normalized_non_empty_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn summarize_rpc_event(message_type: &str, value: &Value) -> Option<PiRpcEventSummary> {
    let mut summary = match message_type {
        "agent_start" => rpc_event_summary(message_type, Some("started")),
        "agent_end" => rpc_event_summary(
            message_type,
            Some(
                if value.get("willRetry").and_then(Value::as_bool) == Some(true) {
                    "retrying"
                } else {
                    "completed"
                },
            ),
        ),
        "agent_settled" => rpc_event_summary(message_type, Some("settled")),
        "turn_start" => rpc_event_summary(message_type, Some("started")),
        "turn_end" => rpc_event_summary(message_type, Some("completed")),
        "message_start" => rpc_event_summary(message_type, Some("started")),
        "message_end" => rpc_event_summary(message_type, Some("completed")),
        "tool_execution_start" => rpc_event_summary(message_type, Some("started")),
        "tool_execution_update" => rpc_event_summary(message_type, Some("running")),
        "tool_execution_end" => rpc_event_summary(
            message_type,
            Some(
                if value.get("isError").and_then(Value::as_bool) == Some(true) {
                    "error"
                } else {
                    "completed"
                },
            ),
        ),
        "extension_error" => rpc_event_summary(message_type, Some("error")),
        _ => return None,
    };

    summary.name = match message_type {
        "tool_execution_start" | "tool_execution_update" | "tool_execution_end" => {
            rpc_tool_name(value)
        }
        "message_start" | "message_end" => rpc_message_role(value),
        "extension_error" => rpc_extension_name(value),
        _ => None,
    };

    summary.preview = match message_type {
        "tool_execution_start" => value.get("args").and_then(rpc_json_preview),
        "tool_execution_update" => value.get("partialResult").and_then(rpc_value_preview),
        "tool_execution_end" => value.get("result").and_then(rpc_value_preview),
        "extension_error" => rpc_error_text(value).map(|text| truncate_rpc_preview(&text)),
        _ => None,
    };

    Some(summary)
}

fn rpc_event_summary(event_type: &str, status: Option<&str>) -> PiRpcEventSummary {
    PiRpcEventSummary {
        event_type: event_type.to_string(),
        name: None,
        status: status.map(str::to_string),
        preview: None,
    }
}

fn rpc_tool_name(value: &Value) -> Option<String> {
    value
        .get("toolName")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("tool")
                .and_then(|tool| tool.get("name"))
                .and_then(Value::as_str)
        })
        .map(str::to_string)
}

fn rpc_message_role(value: &Value) -> Option<String> {
    value
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn rpc_extension_name(value: &Value) -> Option<String> {
    value
        .get("extensionPath")
        .and_then(Value::as_str)
        .and_then(|path| Path::new(path).file_name())
        .map(|name| name.to_string_lossy().to_string())
        .or_else(|| {
            value
                .get("event")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn rpc_value_preview(value: &Value) -> Option<String> {
    let mut text = String::new();
    collect_rpc_preview_text(value, &mut text);

    if text.trim().is_empty() {
        rpc_json_preview(value)
    } else {
        Some(truncate_rpc_preview(text.trim()))
    }
}

fn rpc_json_preview(value: &Value) -> Option<String> {
    serde_json::to_string(value)
        .ok()
        .map(|text| truncate_rpc_preview(&text))
}

fn collect_rpc_preview_text(value: &Value, output: &mut String) {
    match value {
        Value::String(text) => append_rpc_preview_text(output, text),
        Value::Array(items) => {
            for item in items {
                collect_rpc_preview_text(item, output);
            }
        }
        Value::Object(object) => {
            for key in [
                "text",
                "stdout",
                "stderr",
                "output",
                "message",
                "error",
                "errorMessage",
            ] {
                if let Some(text) = object.get(key).and_then(Value::as_str) {
                    append_rpc_preview_text(output, text);
                }
            }
            for key in ["content", "partialResult", "result"] {
                if let Some(nested) = object.get(key) {
                    collect_rpc_preview_text(nested, output);
                }
            }
        }
        _ => {}
    }
}

fn append_rpc_preview_text(output: &mut String, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push('\n');
    }
    output.push_str(text);
}

fn truncate_rpc_preview(input: &str) -> String {
    let mut output = String::new();
    let mut chars = input.chars();
    for _ in 0..RPC_EVENT_PREVIEW_CAP {
        let Some(ch) = chars.next() else {
            return output;
        };
        output.push(ch);
    }

    if chars.next().is_some() && RPC_EVENT_PREVIEW_CAP > 0 {
        output.pop();
        output.push('…');
    }
    output
}

fn rpc_error_text(value: &Value) -> Option<String> {
    for key in ["error", "message", "reason", "errorMessage"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }

    value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[derive(Debug)]
struct ProcessOutput {
    stdout: String,
    stderr: String,
    success: bool,
    code: i32,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

enum RpcStdoutMessage {
    Line(String),
    Truncated,
    ReadError(String),
    Eof,
}

fn run_pi_rpc_get_commands_process(
    program: &Path,
    cwd: &Path,
) -> Result<PiRpcCommandsResult, String> {
    let mut command = Command::new(program);
    command
        .args(PI_RPC_NO_SESSION_ARGS)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!(
            "Cannot start Pi RPC command '{} {}': {e}",
            program.display(),
            PI_RPC_NO_SESSION_ARGS.join(" ")
        )
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Cannot open Pi RPC stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture Pi RPC stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture Pi RPC stderr".to_string())?;

    let stdout_thread = thread::spawn(move || read_capped(stdout, RPC_COMMANDS_STDOUT_CAP));
    let stderr_thread = thread::spawn(move || read_capped(stderr, RPC_STDERR_CAP));

    if let Err(error) = stdin
        .write_all(PI_RPC_GET_COMMANDS_REQUEST)
        .and_then(|_| stdin.flush())
    {
        let _ = kill_and_wait(&mut child);
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        return Err(format!(
            "Cannot write Pi RPC get_commands to stdin: {error}"
        ));
    }
    drop(stdin);

    let (status, timed_out) = wait_child_timeout(&mut child, RPC_COMMANDS_TIMEOUT)?;

    let (stdout_bytes, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "Cannot join Pi RPC stdout reader".to_string())??;
    let (stderr_bytes, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "Cannot join Pi RPC stderr reader".to_string())??;
    let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr = String::from_utf8_lossy(&stderr_bytes).trim().to_string();

    if timed_out {
        return Err(append_stderr(
            format!(
                "Pi RPC get_commands timed out after {} seconds",
                RPC_COMMANDS_TIMEOUT.as_secs()
            ),
            &stderr,
        ));
    }
    if stdout_truncated {
        return Err(append_stderr(
            format!(
                "Pi RPC get_commands stdout exceeded {} bytes",
                RPC_COMMANDS_STDOUT_CAP
            ),
            &stderr,
        ));
    }

    let commands =
        parse_pi_rpc_get_commands_stdout(&stdout).map_err(|error| append_stderr(error, &stderr))?;

    Ok(PiRpcCommandsResult {
        commands,
        exit_code: status
            .code()
            .unwrap_or(if status.success() { 0 } else { 1 }),
        stdout_truncated,
        stderr_truncated,
    })
}

fn run_pi_rpc_get_messages_process(
    program: &Path,
    cwd: &Path,
    session_id: &str,
    request_id: &str,
) -> Result<PiRpcMessagesResult, String> {
    let mut command = Command::new(program);
    command
        .args(PI_RPC_PROMPT_ARGS_PREFIX)
        .arg(session_id)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!(
            "Cannot start Pi RPC command '{} {} {}': {e}",
            program.display(),
            PI_RPC_PROMPT_ARGS_PREFIX.join(" "),
            session_id
        )
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Cannot open Pi RPC stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture Pi RPC stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture Pi RPC stderr".to_string())?;

    let stdout_thread = thread::spawn(move || read_capped(stdout, RPC_STDOUT_CAP));
    let stderr_thread = thread::spawn(move || read_capped(stderr, RPC_STDERR_CAP));

    let request = json!({
        "id": request_id,
        "type": PI_RPC_GET_MESSAGES_COMMAND,
    });
    let mut request_line = serde_json::to_vec(&request)
        .map_err(|e| format!("Cannot serialize Pi RPC get_messages command: {e}"))?;
    request_line.push(b'\n');

    if let Err(error) = stdin.write_all(&request_line).and_then(|_| stdin.flush()) {
        let _ = kill_and_wait(&mut child);
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        return Err(format!(
            "Cannot write Pi RPC get_messages to stdin: {error}"
        ));
    }
    drop(stdin);

    let (status, timed_out) = wait_child_timeout(&mut child, RPC_COMMANDS_TIMEOUT)?;

    let (stdout_bytes, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "Cannot join Pi RPC stdout reader".to_string())??;
    let (stderr_bytes, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "Cannot join Pi RPC stderr reader".to_string())??;
    let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr = String::from_utf8_lossy(&stderr_bytes).trim().to_string();

    if timed_out {
        return Err(append_stderr(
            format!(
                "Pi RPC get_messages timed out after {} seconds",
                RPC_COMMANDS_TIMEOUT.as_secs()
            ),
            &stderr,
        ));
    }
    if stdout_truncated {
        return Err(append_stderr(
            format!(
                "Pi RPC get_messages stdout exceeded {} bytes",
                RPC_STDOUT_CAP
            ),
            &stderr,
        ));
    }

    let messages = parse_pi_rpc_get_messages_stdout(&stdout, request_id)
        .map_err(|error| append_stderr(error, &stderr))?;

    Ok(PiRpcMessagesResult {
        messages,
        exit_code: status
            .code()
            .unwrap_or(if status.success() { 0 } else { 1 }),
        stdout_truncated,
        stderr_truncated,
    })
}

fn run_pi_rpc_prompt_process(
    program: &Path,
    cwd: &Path,
    session_id: &str,
    request_id: &str,
    prompt: &str,
) -> Result<PiRpcPromptResult, String> {
    let mut command = Command::new(program);
    command
        .args(PI_RPC_PROMPT_ARGS_PREFIX)
        .arg(session_id)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!(
            "Cannot start Pi RPC command '{} {} {}': {e}",
            program.display(),
            PI_RPC_PROMPT_ARGS_PREFIX.join(" "),
            session_id
        )
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Cannot open Pi RPC stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture Pi RPC stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture Pi RPC stderr".to_string())?;

    let request = json!({
        "id": request_id,
        "type": "prompt",
        "message": prompt,
    });
    let mut request_line = serde_json::to_vec(&request)
        .map_err(|e| format!("Cannot serialize Pi RPC prompt command: {e}"))?;
    request_line.push(b'\n');
    stdin
        .write_all(&request_line)
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("Cannot write Pi RPC prompt to stdin: {e}"))?;

    let (stdout_sender, stdout_receiver) = mpsc::channel();
    let stdout_thread = thread::spawn(move || {
        read_rpc_stdout_lines(stdout, RPC_STDOUT_CAP, stdout_sender);
    });
    let stderr_thread = thread::spawn(move || read_capped(stderr, RPC_STDERR_CAP));

    let mut state = PiRpcParseState::new(request_id);
    let mut stdout_truncated = false;
    let mut failure: Option<String> = None;
    let deadline = Instant::now() + RPC_TIMEOUT;

    while !state.settled {
        let now = Instant::now();
        if now >= deadline {
            failure = Some(format!(
                "Pi RPC prompt timed out after {} seconds",
                RPC_TIMEOUT.as_secs()
            ));
            break;
        }

        let remaining = deadline.saturating_duration_since(now);
        let wait = if remaining > Duration::from_millis(100) {
            Duration::from_millis(100)
        } else {
            remaining
        };

        match stdout_receiver.recv_timeout(wait) {
            Ok(RpcStdoutMessage::Line(line)) => {
                if let Err(error) = state.observe_line(&line) {
                    failure = Some(error);
                    break;
                }
            }
            Ok(RpcStdoutMessage::Truncated) => {
                stdout_truncated = true;
                failure = Some(format!("Pi RPC stdout exceeded {} bytes", RPC_STDOUT_CAP));
                break;
            }
            Ok(RpcStdoutMessage::ReadError(error)) => {
                failure = Some(error);
                break;
            }
            Ok(RpcStdoutMessage::Eof) => {
                failure = Some("Pi RPC process ended before agent_settled".to_string());
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                failure = Some("Pi RPC stdout reader stopped unexpectedly".to_string());
                break;
            }
        }
    }

    drop(stdin);

    let mut shutdown_timed_out = false;
    let status = if failure.is_some() {
        kill_and_wait(&mut child)?
    } else {
        let (status, timed_out) = wait_child_timeout(&mut child, RPC_SHUTDOWN_TIMEOUT)?;
        shutdown_timed_out = timed_out;
        status
    };

    stdout_thread
        .join()
        .map_err(|_| "Cannot join Pi RPC stdout reader".to_string())?;
    let (stderr_bytes, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "Cannot join Pi RPC stderr reader".to_string())??;
    let stderr = String::from_utf8_lossy(&stderr_bytes).trim().to_string();

    if let Some(error) = failure {
        return Err(append_stderr(error, &stderr));
    }

    let parsed = state
        .finish()
        .map_err(|error| append_stderr(error, &stderr))?;
    Ok(PiRpcPromptResult {
        text: parsed.text,
        event_count: parsed.event_count,
        events: parsed.events,
        exit_code: status
            .code()
            .unwrap_or(if status.success() { 0 } else { 1 }),
        stdout_truncated,
        stderr_truncated,
        shutdown_timed_out,
    })
}

fn read_rpc_stdout_lines(reader: impl Read, cap: usize, sender: mpsc::Sender<RpcStdoutMessage>) {
    let mut reader = BufReader::new(reader);
    let mut captured = 0_usize;

    loop {
        let mut line = Vec::new();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => {
                let _ = sender.send(RpcStdoutMessage::Eof);
                break;
            }
            Ok(_) => {
                if captured.saturating_add(line.len()) > cap {
                    let _ = sender.send(RpcStdoutMessage::Truncated);
                    break;
                }
                captured += line.len();
                if line.ends_with(b"\n") {
                    line.pop();
                }
                if line.ends_with(b"\r") {
                    line.pop();
                }
                let _ = sender.send(RpcStdoutMessage::Line(
                    String::from_utf8_lossy(&line).to_string(),
                ));
            }
            Err(error) => {
                let _ = sender.send(RpcStdoutMessage::ReadError(format!(
                    "Cannot read Pi RPC stdout: {error}"
                )));
                break;
            }
        }
    }
}

fn wait_child_timeout(
    child: &mut Child,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, bool), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Cannot poll Pi RPC process status: {e}"))?
        {
            return Ok((status, false));
        }
        if Instant::now() >= deadline {
            return Ok((kill_and_wait(child)?, true));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn kill_and_wait(child: &mut Child) -> Result<std::process::ExitStatus, String> {
    if let Some(status) = child
        .try_wait()
        .map_err(|e| format!("Cannot poll Pi RPC process status: {e}"))?
    {
        return Ok(status);
    }
    let _ = child.kill();
    child
        .wait()
        .map_err(|e| format!("Cannot wait for Pi RPC process: {e}"))
}

fn append_stderr(error: String, stderr: &str) -> String {
    if stderr.is_empty() {
        error
    } else {
        format!("{error}. stderr: {stderr}")
    }
}

fn run_capped_process(
    program: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
    cap: usize,
) -> Result<ProcessOutput, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start '{}': {e}", program.display()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture process stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture process stderr".to_string())?;

    let stdout_thread = thread::spawn(move || read_capped(stdout, cap));
    let stderr_thread = thread::spawn(move || read_capped(stderr, cap));
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;

    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Cannot poll process status: {e}"))?
        {
            break status;
        }

        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            break child
                .wait()
                .map_err(|e| format!("Cannot wait for timed-out process: {e}"))?;
        }

        thread::sleep(Duration::from_millis(25));
    };

    let (stdout_bytes, stdout_truncated) = stdout_thread
        .join()
        .map_err(|_| "Cannot join stdout reader".to_string())??;
    let (stderr_bytes, stderr_truncated) = stderr_thread
        .join()
        .map_err(|_| "Cannot join stderr reader".to_string())??;

    Ok(ProcessOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
        stderr: String::from_utf8_lossy(&stderr_bytes).to_string(),
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
            .map_err(|e| format!("Cannot read process output: {e}"))?;
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

fn find_executable_in_path(program: &str) -> Option<PathBuf> {
    if program.contains('/') || program.contains('\\') {
        return None;
    }

    let path_var = env::var_os("PATH")?;
    let candidates = executable_names(program);
    for dir in env::split_paths(&path_var) {
        for candidate in &candidates {
            let path = dir.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    None
}

fn executable_names(program: &str) -> Vec<OsString> {
    #[cfg(windows)]
    {
        let mut names = Vec::new();
        let has_extension = Path::new(program).extension().is_some();
        if has_extension {
            names.push(OsString::from(program));
        } else {
            let pathext =
                env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
            for ext in pathext.to_string_lossy().split(';') {
                names.push(OsString::from(format!("{program}{ext}")));
                names.push(OsString::from(format!(
                    "{program}{}",
                    ext.to_ascii_lowercase()
                )));
            }
            names.push(OsString::from(program));
        }
        names
    }

    #[cfg(not(windows))]
    {
        vec![OsString::from(program)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn temp_settings_path() -> PathBuf {
        env::temp_dir().join(format!(
            "ide-desktop-ai-settings-{}.json",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn available_cli_probe() -> IntegrationProbe {
        IntegrationProbe {
            available: true,
            path: Some("/usr/bin/pi".to_string()),
            version: Some("0.1.0".to_string()),
            last_error: None,
        }
    }

    fn missing_sdk_probe() -> IntegrationProbe {
        IntegrationProbe {
            available: false,
            path: None,
            version: None,
            last_error: Some("missing".to_string()),
        }
    }

    #[test]
    fn agent_run_id_must_be_safe_single_segment() {
        assert!(is_safe_agent_run_id("550e8400-e29b-41d4-a716-446655440000"));
        assert!(is_safe_agent_run_id("run_123-abc"));

        for invalid in ["", ".", "..", "a/b", "a\\b", "a\0b"] {
            assert!(!is_safe_agent_run_id(invalid));
            assert!(validate_agent_run_id(invalid).is_err());
        }
    }

    #[test]
    fn agent_run_trace_jsonl_parser_reads_objects_and_skips_blank_lines() {
        let input = b"{\"type\":\"delegation_started\"}\r\n\n  {\"type\":\"agent_completed\",\"ok\":true}\n";
        let events = parse_agent_run_trace_jsonl(std::io::Cursor::new(input)).unwrap();

        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].get("type").and_then(Value::as_str),
            Some("delegation_started")
        );
        assert_eq!(events[1].get("ok").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn agent_run_trace_jsonl_parser_caps_event_count() {
        let mut input = String::new();
        for index in 0..(AGENT_RUN_TRACE_EVENT_CAP + 5) {
            input.push_str(&format!("{{\"type\":\"event\",\"index\":{index}}}\n"));
        }

        let events = parse_agent_run_trace_jsonl(std::io::Cursor::new(input)).unwrap();

        assert_eq!(events.len(), AGENT_RUN_TRACE_EVENT_CAP);
        assert_eq!(
            events
                .last()
                .and_then(|event| event.get("index"))
                .and_then(Value::as_u64),
            Some((AGENT_RUN_TRACE_EVENT_CAP - 1) as u64)
        );
    }

    #[test]
    fn agent_run_summary_extracts_metadata_and_seal_values() {
        let metadata = serde_json::json!({
            "runId": "ignored",
            "traceId": "trace-1",
            "workflow": "tauri-full-development",
            "workspaceId": "workspace-1",
            "agentId": "tauri-rust-coder",
            "parentAgentId": "tauri-planner",
            "startedAt": "2026-07-11T00:00:00.000Z"
        });
        let seal = serde_json::json!({
            "sealedAt": "2026-07-11T00:01:00.000Z",
            "complete": true,
            "eventCount": 42,
            "rawTrajectory": {
                "changedFiles": [{ "path": "apps/desktop/src-tauri/src/lib.rs", "status": "modified" }]
            }
        });

        let run = build_agent_run_summary("trace-1", &metadata, Some(&seal));

        assert_eq!(run.run_id, "trace-1");
        assert_eq!(run.trace_id.as_deref(), Some("trace-1"));
        assert_eq!(run.agent_id.as_deref(), Some("tauri-rust-coder"));
        assert_eq!(run.complete, Some(true));
        assert_eq!(run.event_count, Some(42));
        assert_eq!(run.changed_files.len(), 1);
        assert_eq!(run.changed_files[0].status, "modified");
    }

    #[test]
    fn default_settings_prefer_rpc_without_fallbacks() {
        let settings = PiAgentSettings::default();

        assert_eq!(settings.preferred_integration, INTEGRATION_RPC);
        assert!(settings.fallback_integrations.is_empty());
    }

    #[test]
    fn empty_settings_normalize_to_rpc_only_defaults() {
        let normalized = normalize_settings(PiAgentSettings {
            provider: String::new(),
            preferred_integration: String::new(),
            fallback_integrations: Vec::new(),
            ..PiAgentSettings::default()
        })
        .unwrap();

        assert_eq!(normalized.provider, PROVIDER_PI);
        assert_eq!(normalized.preferred_integration, INTEGRATION_RPC);
        assert!(normalized.fallback_integrations.is_empty());
    }

    #[test]
    fn legacy_settings_normalize_to_rpc_only() {
        let normalized = normalize_settings(PiAgentSettings {
            preferred_integration: INTEGRATION_SDK.to_string(),
            fallback_integrations: vec![
                INTEGRATION_CLI.to_string(),
                INTEGRATION_SDK.to_string(),
                INTEGRATION_RPC.to_string(),
            ],
            ..PiAgentSettings::default()
        })
        .unwrap();

        assert_eq!(normalized.preferred_integration, INTEGRATION_RPC);
        assert!(normalized.fallback_integrations.is_empty());
    }

    #[test]
    fn settings_update_is_normalized_and_persisted() {
        let _guard = test_lock();
        let path = temp_settings_path();
        let settings = update_pi_agent_settings_at(
            &path,
            PiAgentSettingsUpdate {
                enabled: Some(true),
                preferred_integration: Some("CLI".to_string()),
                fallback_integrations: Some(vec![
                    "cli".to_string(),
                    "rpc".to_string(),
                    "cli".to_string(),
                ]),
                model: Some(Some(" local-profile ".to_string())),
                ..PiAgentSettingsUpdate::default()
            },
        )
        .unwrap();

        assert!(settings.enabled);
        assert_eq!(settings.provider, PROVIDER_PI);
        assert_eq!(settings.preferred_integration, INTEGRATION_RPC);
        assert!(settings.fallback_integrations.is_empty());
        assert_eq!(settings.model.as_deref(), Some("local-profile"));

        let reloaded = read_pi_agent_settings_at(&path).unwrap();
        assert_eq!(reloaded, settings);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn invalid_integration_is_rejected() {
        let update = PiAgentSettingsUpdate {
            preferred_integration: Some("shell".to_string()),
            ..PiAgentSettingsUpdate::default()
        };
        let mut settings = PiAgentSettings::default();
        assert!(apply_settings_update(&mut settings, update).is_err());
    }

    #[test]
    fn sdk_probe_output_parser_handles_available_package() {
        let probe = parse_sdk_probe_output(
            r#"{"available":true,"path":"/node_modules/@earendil-works/pi-coding-agent/package.json","version":"1.2.3"}"#,
        );

        assert!(probe.available);
        assert_eq!(probe.version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn status_selects_rpc_when_default_preferred_and_cli_available() {
        let settings = PiAgentSettings {
            enabled: true,
            ..PiAgentSettings::default()
        };

        let status = build_status(
            settings,
            available_cli_probe(),
            missing_sdk_probe(),
            Some("2026-07-10T00:00:00Z".to_string()),
        );

        assert!(status.available);
        assert_eq!(status.availability, "available");
        assert_eq!(status.preferred_integration, INTEGRATION_RPC);
        assert_eq!(status.active_integration.as_deref(), Some(INTEGRATION_RPC));
        assert_eq!(
            status.fallback_integrations.as_deref(),
            Some(&[] as &[String])
        );
        assert_eq!(status.version.as_deref(), Some("0.1.0"));

        let metadata = status.metadata.as_ref().unwrap();
        let rpc = metadata.get("rpc").unwrap();
        assert_eq!(rpc.get("available").and_then(Value::as_bool), Some(true));
        assert_eq!(rpc.get("path").and_then(Value::as_str), Some("/usr/bin/pi"));
        assert_eq!(rpc.get("version").and_then(Value::as_str), Some("0.1.0"));
        assert!(rpc.get("lastError").is_none());
    }

    #[test]
    fn status_ignores_legacy_preferences_and_uses_rpc_only() {
        let settings = PiAgentSettings {
            enabled: true,
            preferred_integration: INTEGRATION_SDK.to_string(),
            fallback_integrations: vec![INTEGRATION_CLI.to_string()],
            ..PiAgentSettings::default()
        };

        let status = build_status(
            settings,
            available_cli_probe(),
            missing_sdk_probe(),
            Some("2026-07-10T00:00:00Z".to_string()),
        );

        assert!(status.available);
        assert_eq!(status.availability, "available");
        assert_eq!(status.preferred_integration, INTEGRATION_RPC);
        assert_eq!(status.active_integration.as_deref(), Some(INTEGRATION_RPC));
        assert_eq!(
            status.fallback_integrations.as_deref(),
            Some(&[] as &[String])
        );
        assert_eq!(status.version.as_deref(), Some("0.1.0"));
    }

    #[test]
    fn status_reports_rpc_unavailable_when_pi_cli_is_missing() {
        let settings = PiAgentSettings {
            enabled: true,
            ..PiAgentSettings::default()
        };
        let cli = IntegrationProbe {
            available: false,
            path: None,
            version: None,
            last_error: Some("pi CLI was not found on PATH".to_string()),
        };

        let status = build_status(
            settings,
            cli,
            missing_sdk_probe(),
            Some("2026-07-10T00:00:00Z".to_string()),
        );

        assert!(!status.available);
        assert_eq!(status.availability, "not-installed");
        assert_eq!(status.active_integration, None);
        assert_eq!(
            status.last_error.as_deref(),
            Some("pi CLI was not found on PATH")
        );

        let metadata = status.metadata.as_ref().unwrap();
        let rpc = metadata.get("rpc").unwrap();
        assert_eq!(rpc.get("available").and_then(Value::as_bool), Some(false));
        assert!(rpc.get("path").is_none());
        assert!(rpc.get("version").is_none());
        assert_eq!(
            rpc.get("lastError").and_then(Value::as_str),
            Some("pi CLI was not found on PATH")
        );
    }

    #[test]
    fn rpc_get_commands_parser_filters_and_maps_supported_sources() {
        let commands = parse_pi_rpc_get_commands_stdout(
            r#"{"type":"response","command":"get_commands","success":true,"data":{"commands":[{"name":"session-name","description":"Set session name","source":"extension","path":"/home/user/.pi/agent/extensions/session.ts"},{"name":"fix-tests","description":"Fix failing tests","source":"prompt","location":"project","path":"/repo/.pi/agent/prompts/fix-tests.md"},{"name":"skill:brave-search","description":"Web search","source":"skill","location":"user","path":"/home/user/.pi/agent/skills/brave-search/SKILL.md"},{"name":"settings","description":"Built-in","source":"builtin"},{"name":"","source":"skill"}]}}"#,
        )
        .unwrap();

        assert_eq!(commands.len(), 3);
        assert_eq!(commands[0].name, "session-name");
        assert_eq!(commands[0].source, "extension");
        assert_eq!(commands[0].location, None);
        assert_eq!(
            commands[0].path.as_deref(),
            Some("/home/user/.pi/agent/extensions/session.ts")
        );
        assert_eq!(commands[1].name, "fix-tests");
        assert_eq!(commands[1].source, "prompt");
        assert_eq!(commands[1].location.as_deref(), Some("project"));
        assert_eq!(commands[2].name, "skill:brave-search");
        assert_eq!(commands[2].source, "skill");
        assert_eq!(commands[2].description.as_deref(), Some("Web search"));
    }

    #[test]
    fn rpc_get_commands_parser_rejects_failed_response() {
        let error = parse_pi_rpc_get_commands_stdout(
            r#"{"type":"response","command":"get_commands","success":false,"error":"commands unavailable"}"#,
        )
        .unwrap_err();

        assert!(error.contains("commands unavailable"));
    }

    #[test]
    fn list_commands_does_not_require_enabled_settings() {
        let response = list_pi_agent_commands_impl(
            PathBuf::from("/tmp/workspace"),
            || Some(PathBuf::from("/usr/bin/pi")),
            |program, cwd| -> Result<PiRpcCommandsResult, String> {
                assert_eq!(program, Path::new("/usr/bin/pi"));
                assert_eq!(cwd, Path::new("/tmp/workspace"));
                Ok(PiRpcCommandsResult {
                    commands: vec![PiAgentCommand {
                        name: "skill:example".to_string(),
                        description: Some("Example skill".to_string()),
                        source: "skill".to_string(),
                        location: Some("user".to_string()),
                        path: Some("/home/user/.pi/agent/skills/example/SKILL.md".to_string()),
                    }],
                    exit_code: 0,
                    stdout_truncated: false,
                    stderr_truncated: false,
                })
            },
        )
        .unwrap();

        let commands = response.get("commands").and_then(Value::as_array).unwrap();
        assert_eq!(commands.len(), 1);
        assert_eq!(
            commands[0].get("source").and_then(Value::as_str),
            Some("skill")
        );
        let metadata = response.get("metadata").unwrap();
        assert_eq!(
            metadata
                .get("request")
                .and_then(|request| request.get("type"))
                .and_then(Value::as_str),
            Some("get_commands")
        );
        assert_eq!(
            metadata.get("command").and_then(Value::as_array).unwrap(),
            &vec![
                json!("pi"),
                json!("--mode"),
                json!("rpc"),
                json!("--no-session"),
            ]
        );
        assert!(metadata.get("sessionId").is_none());
    }

    #[test]
    fn rpc_get_messages_parser_returns_matching_response_messages() {
        let messages = parse_pi_rpc_get_messages_stdout(
            r#"{"id":"other","type":"response","command":"get_messages","success":true,"data":{"messages":[]}}
{"id":"req-1","type":"response","command":"get_messages","success":true,"data":{"messages":[{"type":"user","content":"hello"},{"type":"assistant","content":"hi"}]}}
"#,
            "req-1",
        )
        .unwrap();

        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0].get("type").and_then(Value::as_str),
            Some("user")
        );
        assert_eq!(
            messages[1].get("content").and_then(Value::as_str),
            Some("hi")
        );
    }

    #[test]
    fn rpc_get_messages_parser_rejects_failed_response() {
        let error = parse_pi_rpc_get_messages_stdout(
            r#"{"id":"req-1","type":"response","command":"get_messages","success":false,"error":"session unavailable"}"#,
            "req-1",
        )
        .unwrap_err();

        assert!(error.contains("session unavailable"));
    }

    #[test]
    fn get_session_messages_requires_enabled_settings_without_launching_pi() {
        let result = get_pi_agent_session_messages_impl(
            PiAgentSettings::default(),
            PathBuf::from("/tmp/workspace"),
            || -> Option<PathBuf> { panic!("pi lookup should not run when disabled") },
            |_, _, _, _| -> Result<PiRpcMessagesResult, String> {
                panic!("RPC process should not run when disabled")
            },
        );

        assert!(result.unwrap_err().contains("disabled"));
    }

    #[test]
    fn get_session_messages_uses_workspace_scoped_session_id() {
        let settings = PiAgentSettings {
            enabled: true,
            ..PiAgentSettings::default()
        };
        let workspace_root = PathBuf::from("/tmp/workspace");
        let expected_workspace_id = workspace_id_for_path(&workspace_root);
        let expected_session_id = pi_rpc_session_id_for_workspace_id(&expected_workspace_id);
        let expected_session_id_for_rpc = expected_session_id.clone();

        let response = get_pi_agent_session_messages_impl(
            settings,
            workspace_root,
            || Some(PathBuf::from("/usr/bin/pi")),
            |program, cwd, session_id, request_id| -> Result<PiRpcMessagesResult, String> {
                assert_eq!(program, Path::new("/usr/bin/pi"));
                assert_eq!(cwd, Path::new("/tmp/workspace"));
                assert_eq!(session_id, expected_session_id_for_rpc);
                assert!(request_id.starts_with("ide-pi-rpc-"));
                Ok(PiRpcMessagesResult {
                    messages: vec![json!({ "type": "user", "content": "hello" })],
                    exit_code: 0,
                    stdout_truncated: false,
                    stderr_truncated: false,
                })
            },
        )
        .unwrap();

        assert_eq!(
            response.get("workspaceId").and_then(Value::as_str),
            Some(expected_workspace_id.as_str())
        );
        assert_eq!(
            response.get("sessionId").and_then(Value::as_str),
            Some(expected_session_id.as_str())
        );
        let messages = response.get("messages").and_then(Value::as_array).unwrap();
        assert_eq!(messages.len(), 1);

        let metadata = response.get("metadata").unwrap();
        assert_eq!(
            metadata
                .get("request")
                .and_then(|request| request.get("type"))
                .and_then(Value::as_str),
            Some("get_messages")
        );
        assert_eq!(
            metadata.get("readOnly").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            metadata.get("command").and_then(Value::as_array).unwrap(),
            &vec![
                json!("pi"),
                json!("--mode"),
                json!("rpc"),
                json!("--session-id"),
                json!(expected_session_id),
            ]
        );
    }

    #[test]
    fn rpc_parser_accumulates_text_delta_until_agent_settled() {
        let parsed = parse_pi_rpc_stdout(
            r#"{"id":"req-1","type":"response","command":"prompt","success":true}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":" world"}}
{"type":"agent_settled"}
"#,
            "req-1",
        )
        .unwrap();

        assert_eq!(parsed.text, "Hello world");
        assert_eq!(parsed.event_count, 3);
        assert_eq!(parsed.events.len(), 1);
        assert_eq!(parsed.events[0].event_type, "agent_settled");
    }

    #[test]
    fn rpc_parser_accumulates_text_delta_and_tool_events() {
        let parsed = parse_pi_rpc_stdout(
            r#"{"id":"req-1","type":"response","command":"prompt","success":true}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Done"}}
{"type":"tool_execution_start","toolCallId":"call-1","toolName":"bash","args":{"command":"echo hi"}}
{"type":"tool_execution_end","toolCallId":"call-1","toolName":"bash","result":{"content":[{"type":"text","text":"hi\n"}]},"isError":false}
{"type":"agent_settled"}
"#,
            "req-1",
        )
        .unwrap();

        assert_eq!(parsed.text, "Done");
        assert_eq!(parsed.event_count, 4);
        assert_eq!(parsed.events.len(), 3);
        assert_eq!(parsed.events[0].event_type, "tool_execution_start");
        assert_eq!(parsed.events[0].name.as_deref(), Some("bash"));
        assert_eq!(parsed.events[0].status.as_deref(), Some("started"));
        assert_eq!(parsed.events[1].event_type, "tool_execution_end");
        assert_eq!(parsed.events[1].name.as_deref(), Some("bash"));
        assert_eq!(parsed.events[1].status.as_deref(), Some("completed"));
        assert_eq!(parsed.events[1].preview.as_deref(), Some("hi"));
        assert_eq!(parsed.events[2].event_type, "agent_settled");
    }

    #[test]
    fn rpc_parser_rejects_prompt_response_failure() {
        let error = parse_pi_rpc_stdout(
            r#"{"id":"req-1","type":"response","command":"prompt","success":false,"error":"preflight failed"}
"#,
            "req-1",
        )
        .unwrap_err();

        assert!(error.contains("preflight failed"));
    }

    #[test]
    fn rpc_parser_rejects_assistant_stream_error() {
        let error = parse_pi_rpc_stdout(
            r#"{"id":"req-1","type":"response","command":"prompt","success":true}
{"type":"message_update","assistantMessageEvent":{"type":"error","reason":"error","message":"model failed"}}
{"type":"agent_settled"}
"#,
            "req-1",
        )
        .unwrap_err();

        assert!(error.contains("model failed"));
    }

    #[test]
    fn rpc_parser_requires_agent_settled() {
        let error = parse_pi_rpc_stdout(
            r#"{"id":"req-1","type":"response","command":"prompt","success":true}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"partial"}}
"#,
            "req-1",
        )
        .unwrap_err();

        assert!(error.contains("agent_settled"));
    }

    #[test]
    fn send_prompt_rejects_disabled_settings_without_launching_pi() {
        let result = send_pi_agent_prompt_impl(
            "hello".to_string(),
            PiAgentSettings::default(),
            PathBuf::from("/tmp"),
            || -> Option<PathBuf> { panic!("pi lookup should not run when disabled") },
            |_, _, _, _, _| -> Result<PiRpcPromptResult, String> {
                panic!("RPC process should not run when disabled")
            },
        );

        assert!(result.unwrap_err().contains("disabled"));
    }

    #[test]
    fn send_prompt_reports_rpc_timeout_error() {
        let settings = PiAgentSettings {
            enabled: true,
            ..PiAgentSettings::default()
        };

        let result = send_pi_agent_prompt_impl(
            "hello".to_string(),
            settings,
            PathBuf::from("/tmp"),
            || Some(PathBuf::from("/usr/bin/pi")),
            |_, _, _, _, _| -> Result<PiRpcPromptResult, String> {
                Err("Pi RPC prompt timed out after 120 seconds".to_string())
            },
        );

        assert!(result.unwrap_err().contains("timed out"));
    }

    #[test]
    fn send_prompt_returns_rpc_events_in_metadata() {
        let settings = PiAgentSettings {
            enabled: true,
            ..PiAgentSettings::default()
        };

        let workspace_root = PathBuf::from("/tmp/workspace");
        let expected_workspace_id = workspace_id_for_path(&workspace_root);
        let expected_session_id = pi_rpc_session_id_for_workspace_id(&expected_workspace_id);

        let response = send_pi_agent_prompt_impl(
            "hello".to_string(),
            settings,
            workspace_root,
            || Some(PathBuf::from("/usr/bin/pi")),
            |program, cwd, session_id, _, _| -> Result<PiRpcPromptResult, String> {
                assert_eq!(program, Path::new("/usr/bin/pi"));
                assert_eq!(cwd, Path::new("/tmp/workspace"));
                assert_eq!(session_id, expected_session_id);
                Ok(PiRpcPromptResult {
                    text: "ok".to_string(),
                    event_count: 1,
                    events: vec![PiRpcEventSummary {
                        event_type: "tool_execution_start".to_string(),
                        name: Some("bash".to_string()),
                        status: Some("started".to_string()),
                        preview: None,
                    }],
                    exit_code: 0,
                    stdout_truncated: false,
                    stderr_truncated: false,
                    shutdown_timed_out: false,
                })
            },
        )
        .unwrap();

        let metadata = response.get("metadata").unwrap();
        assert_eq!(
            metadata.get("workspaceId").and_then(Value::as_str),
            Some(expected_workspace_id.as_str())
        );
        assert_eq!(
            metadata.get("sessionId").and_then(Value::as_str),
            Some(expected_session_id.as_str())
        );
        assert_eq!(
            metadata.get("oneShotProcess").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            metadata.get("command").and_then(Value::as_array).unwrap(),
            &vec![
                json!("pi"),
                json!("--mode"),
                json!("rpc"),
                json!("--session-id"),
                json!(expected_session_id),
            ]
        );

        let events = metadata.get("events").and_then(Value::as_array).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].get("type").and_then(Value::as_str),
            Some("tool_execution_start")
        );
    }

    #[test]
    fn install_short_circuits_already_installed_when_default_rpc_detects_pi() {
        let settings = PiAgentSettings {
            enabled: true,
            ..PiAgentSettings::default()
        };
        let detected = build_status(
            settings,
            available_cli_probe(),
            missing_sdk_probe(),
            Some("2026-07-10T00:00:00Z".to_string()),
        );

        let result = install_pi_agent_impl(
            true,
            || Ok(detected.clone()),
            || -> Option<PathBuf> { panic!("npm lookup should not run when Pi is detected") },
            |_: &Path| -> Result<ProcessOutput, String> {
                panic!("install command should not run when Pi is detected")
            },
        )
        .unwrap();

        assert!(result.success);
        assert_eq!(result.outcome, "already-installed");
        assert_eq!(result.integration.as_deref(), Some(INTEGRATION_RPC));
        assert_eq!(result.version.as_deref(), Some("0.1.0"));
    }

    #[test]
    fn install_command_is_fixed_and_ignores_scripts() {
        assert_eq!(
            install_command_for_metadata(),
            vec![
                "npm",
                "install",
                "-g",
                "--ignore-scripts",
                "@earendil-works/pi-coding-agent"
            ]
        );
    }
}
