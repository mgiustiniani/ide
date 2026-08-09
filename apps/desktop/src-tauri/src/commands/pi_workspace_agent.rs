use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use git2::{Repository, Status, StatusOptions};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::app_config::{now_rfc3339, workspace_registry_path};
use crate::workspace::workspace_root;

use super::ai_agent::{
    find_pi_executable, list_pi_agent_commands_at, pi_rpc_session_id_for_workspace_id,
};
use super::workspace_registry::current_workspace_binding_at;

pub const PI_WORKSPACE_AGENT_OUTPUT_EVENT: &str = "pi-workspace-agent-output";
pub const PI_WORKSPACE_AGENT_STATUS_EVENT: &str = "pi-workspace-agent-status";
const DETACHED_WINDOW_LABEL: &str = "pi-agent";
const PROTOCOL_VERSION: u8 = 1;
const TRANSCRIPT_CAP_BYTES: usize = 1024 * 1024;
const ACTIVITY_CAP: usize = 200;
const CHANGE_CAP: usize = 1000;
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const MIN_TERMINAL_DIMENSION: u16 = 2;
const MAX_TERMINAL_DIMENSION: u16 = 500;
const PACKAGE_OUTPUT_CAP: usize = 512 * 1024;
const PACKAGE_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PiProcessState {
    Starting,
    Running,
    Exited,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentSessionSnapshot {
    pub workspace_id: String,
    pub workspace_name: String,
    pub root_path: String,
    pub session_id: String,
    pub process_state: PiProcessState,
    pub process_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub last_activity_at: String,
    pub attached_view_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentActivity {
    pub sequence: u64,
    pub event_type: String,
    pub timestamp: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentAttachment {
    pub protocol_version: u8,
    pub session: PiWorkspaceAgentSessionSnapshot,
    pub transcript_base64: String,
    pub transcript_sequence: u64,
    pub transcript_truncated: bool,
    pub activities: Vec<PiWorkspaceAgentActivity>,
    pub sessions: Vec<PiWorkspaceAgentSessionSnapshot>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentOutputEvent {
    pub protocol_version: u8,
    pub workspace_id: String,
    pub process_generation: u64,
    pub sequence: u64,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentStatusEvent {
    pub protocol_version: u8,
    pub session: PiWorkspaceAgentSessionSnapshot,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentResource {
    pub kind: String,
    pub name: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentChange {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentAccessories {
    pub protocol_version: u8,
    pub workspace_id: String,
    pub changes: Vec<PiWorkspaceAgentChange>,
    pub resources: Vec<PiWorkspaceAgentResource>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceAgentDetachedBinding {
    pub protocol_version: u8,
    pub workspace_id: String,
    pub workspace_name: String,
}

#[derive(Clone)]
struct EventEmitter(Arc<dyn Fn(&str, Value) + Send + Sync>);

impl EventEmitter {
    fn from_app(app: AppHandle) -> Self {
        Self(Arc::new(move |event, payload| {
            let _ = app.emit(event, payload);
        }))
    }

    #[cfg(test)]
    fn new(callback: impl Fn(&str, Value) + Send + Sync + 'static) -> Self {
        Self(Arc::new(callback))
    }

    fn emit<T: Serialize>(&self, event: &str, payload: &T) {
        if let Ok(value) = serde_json::to_value(payload) {
            (self.0)(event, value);
        }
    }
}

struct SessionRuntime {
    process_state: PiProcessState,
    process_generation: u64,
    process_id: Option<u32>,
    exit_code: Option<u32>,
    started_at: Option<String>,
    last_activity_at: String,
    last_error: Option<String>,
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    child: Option<Box<dyn Child + Send + Sync>>,
    attached_views: BTreeSet<String>,
    transcript: VecDeque<u8>,
    transcript_sequence: u64,
    transcript_truncated: bool,
    activities: VecDeque<PiWorkspaceAgentActivity>,
    next_activity_sequence: u64,
}

struct WorkspaceSession {
    workspace_id: String,
    workspace_name: String,
    root: PathBuf,
    session_id: String,
    runtime: Mutex<SessionRuntime>,
}

impl WorkspaceSession {
    fn new(workspace_id: String, workspace_name: String, root: PathBuf) -> Self {
        let session_id = pi_rpc_session_id_for_workspace_id(&workspace_id);
        Self {
            workspace_id,
            workspace_name,
            root,
            session_id,
            runtime: Mutex::new(SessionRuntime {
                process_state: PiProcessState::Stopped,
                process_generation: 0,
                process_id: None,
                exit_code: None,
                started_at: None,
                last_activity_at: now_rfc3339(),
                last_error: None,
                master: None,
                writer: None,
                child: None,
                attached_views: BTreeSet::new(),
                transcript: VecDeque::new(),
                transcript_sequence: 0,
                transcript_truncated: false,
                activities: VecDeque::new(),
                next_activity_sequence: 1,
            }),
        }
    }

    fn snapshot(&self) -> PiWorkspaceAgentSessionSnapshot {
        let runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.snapshot_with_runtime(&runtime)
    }

    fn snapshot_with_runtime(&self, runtime: &SessionRuntime) -> PiWorkspaceAgentSessionSnapshot {
        PiWorkspaceAgentSessionSnapshot {
            workspace_id: self.workspace_id.clone(),
            workspace_name: self.workspace_name.clone(),
            root_path: self.root.to_string_lossy().to_string(),
            session_id: self.session_id.clone(),
            process_state: runtime.process_state,
            process_generation: runtime.process_generation,
            process_id: runtime.process_id,
            exit_code: runtime.exit_code,
            started_at: runtime.started_at.clone(),
            last_activity_at: runtime.last_activity_at.clone(),
            attached_view_count: runtime.attached_views.len(),
            last_error: runtime.last_error.clone(),
        }
    }
}

#[derive(Default)]
pub struct PiWorkspaceAgentState {
    sessions: Mutex<BTreeMap<String, Arc<WorkspaceSession>>>,
    detached_workspace_id: Mutex<Option<String>>,
}

impl PiWorkspaceAgentState {
    fn session(&self, workspace_id: &str) -> Result<Arc<WorkspaceSession>, String> {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| format!("Pi has not been attached to workspace '{workspace_id}'"))
    }

    fn sessions_snapshot(&self) -> Vec<PiWorkspaceAgentSessionSnapshot> {
        self.sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .map(|session| session.snapshot())
            .collect()
    }

    fn ensure_current_session(
        &self,
        workspace_id: &str,
        workspace_name: &str,
    ) -> Result<Arc<WorkspaceSession>, String> {
        validate_workspace_id(workspace_id)?;
        if let Some(existing) = self
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(workspace_id)
            .cloned()
        {
            return Ok(existing);
        }

        let root = workspace_root()?;
        let registry_path = workspace_registry_path()?;
        let binding = current_workspace_binding_at(&root, &registry_path)?;
        if binding.workspace_id != workspace_id {
            return Err(format!(
                "Pi attachment workspace '{}' does not match the current authorized workspace",
                workspace_id
            ));
        }

        let session = Arc::new(WorkspaceSession::new(
            workspace_id.to_string(),
            non_empty_workspace_name(workspace_name, workspace_id),
            binding.canonical_root,
        ));
        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(sessions
            .entry(workspace_id.to_string())
            .or_insert_with(|| session.clone())
            .clone())
    }

    fn attach(
        &self,
        workspace_id: &str,
        workspace_name: &str,
        view_id: &str,
        cols: u16,
        rows: u16,
        emitter: EventEmitter,
    ) -> Result<PiWorkspaceAgentAttachment, String> {
        validate_view_id(view_id)?;
        validate_size(cols, rows)?;
        let session = self.ensure_current_session(workspace_id, workspace_name)?;

        let should_start = {
            let runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime.process_generation == 0
        };
        if should_start {
            let program = find_pi_executable()?;
            self.start_session_with_program(&session, &program, cols, rows, emitter.clone())?;
        }

        {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(master) = runtime.master.as_ref() {
                master
                    .resize(pty_size(cols, rows))
                    .map_err(|error| format!("Cannot resize Pi pseudoterminal: {error}"))?;
            }
            runtime.attached_views.insert(view_id.to_string());
            push_activity(
                &mut runtime,
                "attached",
                format!("Renderer view '{view_id}' attached without owning the Pi process"),
                Some(view_id.to_string()),
            );
        }
        emit_status(&session, &emitter);
        Ok(self.attachment_snapshot(&session))
    }

    fn attachment_snapshot(&self, session: &WorkspaceSession) -> PiWorkspaceAgentAttachment {
        let (current_snapshot, transcript, transcript_sequence, transcript_truncated, activities) = {
            let runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            (
                session.snapshot_with_runtime(&runtime),
                runtime.transcript.iter().copied().collect::<Vec<u8>>(),
                runtime.transcript_sequence,
                runtime.transcript_truncated,
                runtime.activities.iter().cloned().collect(),
            )
        };
        let mut sessions = self.sessions_snapshot();
        if let Some(position) = sessions
            .iter()
            .position(|candidate| candidate.workspace_id == current_snapshot.workspace_id)
        {
            sessions[position] = current_snapshot.clone();
        }
        PiWorkspaceAgentAttachment {
            protocol_version: PROTOCOL_VERSION,
            session: current_snapshot,
            transcript_base64: BASE64_STANDARD.encode(transcript),
            transcript_sequence,
            transcript_truncated,
            activities,
            sessions,
        }
    }

    fn start(
        &self,
        workspace_id: &str,
        cols: u16,
        rows: u16,
        emitter: EventEmitter,
    ) -> Result<PiWorkspaceAgentAttachment, String> {
        validate_size(cols, rows)?;
        let session = self.session(workspace_id)?;
        let program = find_pi_executable()?;
        self.start_session_with_program(&session, &program, cols, rows, emitter)?;
        Ok(self.attachment_snapshot(&session))
    }

    fn start_session_with_program(
        &self,
        session: &Arc<WorkspaceSession>,
        program: &Path,
        cols: u16,
        rows: u16,
        emitter: EventEmitter,
    ) -> Result<(), String> {
        let generation = {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if matches!(
                runtime.process_state,
                PiProcessState::Starting | PiProcessState::Running
            ) {
                return Ok(());
            }
            runtime.process_generation = runtime
                .process_generation
                .checked_add(1)
                .ok_or_else(|| "Pi process generation exhausted".to_string())?;
            runtime.process_state = PiProcessState::Starting;
            runtime.exit_code = None;
            runtime.last_error = None;
            runtime.process_id = None;
            runtime.writer = None;
            runtime.master = None;
            runtime.child = None;
            push_activity(
                &mut runtime,
                "starting",
                "Starting the fixed Pi executable in the workspace pseudoterminal".to_string(),
                None,
            );
            runtime.process_generation
        };
        emit_status(session, &emitter);

        let spawn_result = (|| {
            let pair = native_pty_system()
                .openpty(pty_size(cols, rows))
                .map_err(|error| format!("Cannot open Pi pseudoterminal: {error}"))?;
            let mut command = CommandBuilder::new(program);
            command.cwd(&session.root);
            command.arg("--session-id");
            command.arg(&session.session_id);
            command.env("TERM", "xterm-256color");
            command.env("COLORTERM", "truecolor");
            let child = pair
                .slave
                .spawn_command(command)
                .map_err(|error| format!("Cannot start Pi in pseudoterminal: {error}"))?;
            let process_id = child.process_id();
            let reader = pair
                .master
                .try_clone_reader()
                .map_err(|error| format!("Cannot read Pi pseudoterminal: {error}"))?;
            let writer = pair
                .master
                .take_writer()
                .map_err(|error| format!("Cannot write Pi pseudoterminal: {error}"))?;
            Ok::<_, String>((pair.master, writer, child, reader, process_id))
        })();

        let (master, writer, child, reader, process_id) = match spawn_result {
            Ok(handles) => handles,
            Err(error) => {
                let mut runtime = session
                    .runtime
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if runtime.process_generation == generation {
                    runtime.process_state = PiProcessState::Failed;
                    runtime.last_error = Some(error.clone());
                    push_activity(&mut runtime, "failed", error.clone(), None);
                }
                drop(runtime);
                emit_status(session, &emitter);
                return Err(error);
            }
        };

        {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime.process_generation != generation {
                return Err("Pi start was superseded".to_string());
            }
            runtime.master = Some(master);
            runtime.writer = Some(writer);
            runtime.child = Some(child);
            runtime.process_id = process_id;
            runtime.started_at = Some(now_rfc3339());
            runtime.process_state = PiProcessState::Running;
            push_activity(
                &mut runtime,
                "started",
                format!(
                    "Pi process started in '{}' with deterministic session '{}'",
                    session.root.display(),
                    session.session_id
                ),
                None,
            );
        }
        emit_status(session, &emitter);
        spawn_reader(session.clone(), generation, reader, emitter);
        Ok(())
    }

    fn write(&self, workspace_id: &str, data: &[u8]) -> Result<(), String> {
        if data.is_empty() {
            return Ok(());
        }
        let session = self.session(workspace_id)?;
        let mut runtime = session
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if runtime.process_state != PiProcessState::Running {
            return Err(format!("Pi is not running for workspace '{workspace_id}'"));
        }
        let writer = runtime
            .writer
            .as_mut()
            .ok_or_else(|| "Pi pseudoterminal writer is unavailable".to_string())?;
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|error| format!("Cannot write Pi pseudoterminal input: {error}"))
    }

    fn resize(&self, workspace_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        validate_size(cols, rows)?;
        let session = self.session(workspace_id)?;
        let runtime = session
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(master) = runtime.master.as_ref() else {
            return Ok(());
        };
        master
            .resize(pty_size(cols, rows))
            .map_err(|error| format!("Cannot resize Pi pseudoterminal: {error}"))
    }

    fn detach(
        &self,
        workspace_id: &str,
        view_id: &str,
        emitter: EventEmitter,
    ) -> Result<(), String> {
        validate_view_id(view_id)?;
        let session = self.session(workspace_id)?;
        {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runtime.attached_views.remove(view_id);
            push_activity(
                &mut runtime,
                "detached",
                format!(
                    "Renderer view '{view_id}' detached; no EOF or termination signal was sent"
                ),
                Some(view_id.to_string()),
            );
        }
        emit_status(&session, &emitter);
        Ok(())
    }

    fn stop(
        &self,
        workspace_id: &str,
        confirmed: bool,
        emitter: EventEmitter,
    ) -> Result<PiWorkspaceAgentAttachment, String> {
        if !confirmed {
            return Err("Stopping Pi requires explicit confirmation".to_string());
        }
        let session = self.session(workspace_id)?;
        {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if matches!(
                runtime.process_state,
                PiProcessState::Running | PiProcessState::Starting
            ) {
                if let Some(child) = runtime.child.as_mut() {
                    child
                        .kill()
                        .map_err(|error| format!("Cannot stop Pi process: {error}"))?;
                    runtime.exit_code = child
                        .try_wait()
                        .ok()
                        .flatten()
                        .map(|status| status.exit_code());
                }
            }
            runtime.process_generation = runtime
                .process_generation
                .checked_add(1)
                .ok_or_else(|| "Pi process generation exhausted".to_string())?;
            runtime.process_state = PiProcessState::Stopped;
            runtime.process_id = None;
            runtime.last_error = None;
            runtime.writer = None;
            runtime.master = None;
            runtime.child = None;
            push_activity(
                &mut runtime,
                "stopped",
                "Pi was terminated by the separately confirmed Stop Pi action".to_string(),
                None,
            );
        }
        emit_status(&session, &emitter);
        Ok(self.attachment_snapshot(&session))
    }

    pub(crate) fn shutdown_all(&self) {
        let sessions: Vec<Arc<WorkspaceSession>> = self
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .cloned()
            .collect();
        for session in sessions {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(child) = runtime.child.as_mut() {
                let _ = child.kill();
            }
            runtime.writer = None;
            runtime.master = None;
            runtime.child = None;
        }
    }
}

fn spawn_reader(
    session: Arc<WorkspaceSession>,
    generation: u64,
    mut reader: Box<dyn Read + Send>,
    emitter: EventEmitter,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let event = {
                        let mut runtime = session
                            .runtime
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        if runtime.process_generation != generation {
                            return;
                        }
                        append_transcript(&mut runtime, &buffer[..length]);
                        runtime.transcript_sequence = runtime.transcript_sequence.saturating_add(1);
                        runtime.last_activity_at = now_rfc3339();
                        PiWorkspaceAgentOutputEvent {
                            protocol_version: PROTOCOL_VERSION,
                            workspace_id: session.workspace_id.clone(),
                            process_generation: generation,
                            sequence: runtime.transcript_sequence,
                            data_base64: BASE64_STANDARD.encode(&buffer[..length]),
                        }
                    };
                    emitter.emit(PI_WORKSPACE_AGENT_OUTPUT_EVENT, &event);
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }

        {
            let mut runtime = session
                .runtime
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if runtime.process_generation != generation
                || runtime.process_state == PiProcessState::Stopped
            {
                return;
            }
            runtime.exit_code = runtime
                .child
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten())
                .map(|status| status.exit_code());
            runtime.process_state = PiProcessState::Exited;
            runtime.process_id = None;
            runtime.writer = None;
            runtime.master = None;
            push_activity(
                &mut runtime,
                "exited",
                "Pi process exited; its deterministic session remains available for restart"
                    .to_string(),
                None,
            );
        }
        emit_status(&session, &emitter);
    });
}

fn append_transcript(runtime: &mut SessionRuntime, bytes: &[u8]) {
    if bytes.len() >= TRANSCRIPT_CAP_BYTES {
        runtime.transcript.clear();
        runtime
            .transcript
            .extend(bytes[bytes.len() - TRANSCRIPT_CAP_BYTES..].iter().copied());
        runtime.transcript_truncated = true;
        return;
    }
    let overflow = runtime
        .transcript
        .len()
        .saturating_add(bytes.len())
        .saturating_sub(TRANSCRIPT_CAP_BYTES);
    if overflow > 0 {
        runtime.transcript.drain(..overflow);
        runtime.transcript_truncated = true;
    }
    runtime.transcript.extend(bytes.iter().copied());
}

fn push_activity(
    runtime: &mut SessionRuntime,
    event_type: &str,
    detail: String,
    view_id: Option<String>,
) {
    let timestamp = now_rfc3339();
    runtime.last_activity_at = timestamp.clone();
    runtime.activities.push_back(PiWorkspaceAgentActivity {
        sequence: runtime.next_activity_sequence,
        event_type: event_type.to_string(),
        timestamp,
        detail,
        view_id,
    });
    runtime.next_activity_sequence = runtime.next_activity_sequence.saturating_add(1);
    while runtime.activities.len() > ACTIVITY_CAP {
        runtime.activities.pop_front();
    }
}

fn emit_status(session: &WorkspaceSession, emitter: &EventEmitter) {
    emitter.emit(
        PI_WORKSPACE_AGENT_STATUS_EVENT,
        &PiWorkspaceAgentStatusEvent {
            protocol_version: PROTOCOL_VERSION,
            session: session.snapshot(),
        },
    );
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn validate_size(cols: u16, rows: u16) -> Result<(), String> {
    if !(MIN_TERMINAL_DIMENSION..=MAX_TERMINAL_DIMENSION).contains(&cols)
        || !(MIN_TERMINAL_DIMENSION..=MAX_TERMINAL_DIMENSION).contains(&rows)
    {
        return Err(format!(
            "Pi terminal size must be between {MIN_TERMINAL_DIMENSION} and {MAX_TERMINAL_DIMENSION}"
        ));
    }
    Ok(())
}

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
    if workspace_id.is_empty()
        || workspace_id.len() > 128
        || !workspace_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("Invalid Pi Agent workspace id".to_string());
    }
    Ok(())
}

fn validate_view_id(view_id: &str) -> Result<(), String> {
    if view_id.is_empty()
        || view_id.len() > 128
        || !view_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("Invalid Pi Agent renderer view id".to_string());
    }
    Ok(())
}

fn non_empty_workspace_name(workspace_name: &str, workspace_id: &str) -> String {
    let sanitized: String = workspace_name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(200)
        .collect();
    if sanitized.is_empty() {
        workspace_id.to_string()
    } else {
        sanitized
    }
}

#[tauri::command]
pub fn attach_pi_workspace_agent(
    workspace_id: String,
    workspace_name: String,
    view_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    state: State<'_, PiWorkspaceAgentState>,
    app: AppHandle,
) -> Result<PiWorkspaceAgentAttachment, String> {
    state.attach(
        &workspace_id,
        &workspace_name,
        &view_id,
        cols.unwrap_or(DEFAULT_COLS),
        rows.unwrap_or(DEFAULT_ROWS),
        EventEmitter::from_app(app),
    )
}

#[tauri::command]
pub fn detach_pi_workspace_agent(
    workspace_id: String,
    view_id: String,
    state: State<'_, PiWorkspaceAgentState>,
    app: AppHandle,
) -> Result<(), String> {
    state.detach(&workspace_id, &view_id, EventEmitter::from_app(app))
}

#[tauri::command]
pub fn write_pi_workspace_agent(
    workspace_id: String,
    data_base64: String,
    state: State<'_, PiWorkspaceAgentState>,
) -> Result<(), String> {
    let data = BASE64_STANDARD
        .decode(data_base64)
        .map_err(|_| "Pi terminal input is not valid base64".to_string())?;
    state.write(&workspace_id, &data)
}

#[tauri::command]
pub fn resize_pi_workspace_agent(
    workspace_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PiWorkspaceAgentState>,
) -> Result<(), String> {
    state.resize(&workspace_id, cols, rows)
}

#[tauri::command]
pub fn start_pi_workspace_agent(
    workspace_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    state: State<'_, PiWorkspaceAgentState>,
    app: AppHandle,
) -> Result<PiWorkspaceAgentAttachment, String> {
    state.start(
        &workspace_id,
        cols.unwrap_or(DEFAULT_COLS),
        rows.unwrap_or(DEFAULT_ROWS),
        EventEmitter::from_app(app),
    )
}

#[tauri::command]
pub fn stop_pi_workspace_agent(
    workspace_id: String,
    confirmed: bool,
    state: State<'_, PiWorkspaceAgentState>,
    app: AppHandle,
) -> Result<PiWorkspaceAgentAttachment, String> {
    state.stop(&workspace_id, confirmed, EventEmitter::from_app(app))
}

#[tauri::command]
pub fn get_pi_workspace_agent_snapshot(
    workspace_id: String,
    state: State<'_, PiWorkspaceAgentState>,
) -> Result<PiWorkspaceAgentAttachment, String> {
    let session = state.session(&workspace_id)?;
    Ok(state.attachment_snapshot(&session))
}

#[tauri::command]
pub fn get_pi_workspace_agent_accessories(
    workspace_id: String,
    state: State<'_, PiWorkspaceAgentState>,
) -> Result<PiWorkspaceAgentAccessories, String> {
    let session = state.session(&workspace_id)?;
    Ok(discover_accessories(&session))
}

#[tauri::command]
pub fn open_pi_workspace_agent_window(
    workspace_id: String,
    state: State<'_, PiWorkspaceAgentState>,
    app: AppHandle,
) -> Result<PiWorkspaceAgentDetachedBinding, String> {
    let requested = state.session(&workspace_id)?;
    if let Some(window) = app.get_webview_window(DETACHED_WINDOW_LABEL) {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|error| format!("Cannot focus detached Pi Agent window: {error}"))?;
        let pinned_id = state
            .detached_workspace_id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .unwrap_or_else(|| requested.workspace_id.clone());
        let pinned = state.session(&pinned_id)?;
        return Ok(detached_binding(&pinned));
    }

    *state
        .detached_workspace_id
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(requested.workspace_id.clone());
    let title = format!("Pi Agent — {}", requested.workspace_name);
    WebviewWindowBuilder::new(
        &app,
        DETACHED_WINDOW_LABEL,
        WebviewUrl::App("index.html?view=pi-agent".into()),
    )
    .title(title)
    .inner_size(1100.0, 800.0)
    .min_inner_size(700.0, 500.0)
    .resizable(true)
    .build()
    .map_err(|error| format!("Cannot open detached Pi Agent window: {error}"))?;
    Ok(detached_binding(&requested))
}

#[tauri::command]
pub fn get_pi_workspace_agent_detached_binding(
    state: State<'_, PiWorkspaceAgentState>,
) -> Result<PiWorkspaceAgentDetachedBinding, String> {
    let workspace_id = state
        .detached_workspace_id
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .ok_or_else(|| "Detached Pi Agent window has no pinned workspace".to_string())?;
    let session = state.session(&workspace_id)?;
    Ok(detached_binding(&session))
}

fn detached_binding(session: &WorkspaceSession) -> PiWorkspaceAgentDetachedBinding {
    PiWorkspaceAgentDetachedBinding {
        protocol_version: PROTOCOL_VERSION,
        workspace_id: session.workspace_id.clone(),
        workspace_name: session.workspace_name.clone(),
    }
}

fn discover_accessories(session: &WorkspaceSession) -> PiWorkspaceAgentAccessories {
    let mut warnings = Vec::new();
    let changes = match discover_changes(&session.root) {
        Ok(changes) => changes,
        Err(error) => {
            warnings.push(error);
            Vec::new()
        }
    };
    let mut resources = match discover_packages(&session.root) {
        Ok(packages) => packages,
        Err(error) => {
            warnings.push(error);
            Vec::new()
        }
    };
    match list_pi_agent_commands_at(session.root.clone()) {
        Ok(response) => resources.extend(command_resources(&response)),
        Err(error) => warnings.push(format!("Pi command discovery unavailable: {error}")),
    }
    resources.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.name.cmp(&right.name))
    });
    resources.dedup_by(|left, right| {
        left.kind == right.kind && left.name == right.name && left.scope == right.scope
    });

    PiWorkspaceAgentAccessories {
        protocol_version: PROTOCOL_VERSION,
        workspace_id: session.workspace_id.clone(),
        changes,
        resources,
        warnings,
    }
}

fn discover_packages(root: &Path) -> Result<Vec<PiWorkspaceAgentResource>, String> {
    let pi = find_pi_executable()?;
    let mut child = Command::new(pi)
        .args(["list", "--no-approve"])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Cannot list installed Pi packages: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Pi package discovery stdout is unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Pi package discovery stderr is unavailable".to_string())?;
    let stdout_reader = thread::spawn(move || read_capped(stdout, PACKAGE_OUTPUT_CAP));
    let stderr_reader = thread::spawn(move || read_capped(stderr, PACKAGE_OUTPUT_CAP));
    let deadline = Instant::now() + PACKAGE_DISCOVERY_TIMEOUT;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Cannot poll Pi package discovery: {error}"))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Pi package discovery timed out after {} seconds",
                PACKAGE_DISCOVERY_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "Pi package stdout reader failed".to_string())??;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "Pi package stderr reader failed".to_string())??;
    if stdout_truncated || stderr_truncated {
        return Err("Pi package discovery output exceeded its fixed cap".to_string());
    }
    if !status.success() {
        return Err(format!(
            "Pi package discovery failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    parse_package_list(&String::from_utf8_lossy(&stdout))
}

fn read_capped(mut reader: impl Read, cap: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::with_capacity(cap.min(8192));
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let length = reader
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read Pi discovery output: {error}"))?;
        if length == 0 {
            break;
        }
        let remaining = cap.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..length.min(remaining)]);
        if length > remaining {
            truncated = true;
        }
    }
    Ok((output, truncated))
}

fn parse_package_list(output: &str) -> Result<Vec<PiWorkspaceAgentResource>, String> {
    let mut resources = Vec::new();
    let mut scope: Option<&str> = None;
    let mut pending_name: Option<String> = None;

    for raw_line in output.lines() {
        let line = raw_line.trim_end();
        match line {
            "User packages:" => {
                scope = Some("user");
                pending_name = None;
            }
            "Project packages:" => {
                scope = Some("project");
                pending_name = None;
            }
            _ if line.starts_with("  ") && !line.starts_with("    ") => {
                pending_name = Some(line.trim().to_string());
            }
            _ if line.starts_with("    ") => {
                if let (Some(package_scope), Some(name)) = (scope, pending_name.take()) {
                    resources.push(PiWorkspaceAgentResource {
                        kind: "package".to_string(),
                        name: name.clone(),
                        scope: package_scope.to_string(),
                        source: Some(name),
                        path: Some(line.trim().to_string()),
                        description: None,
                    });
                }
            }
            _ if line.trim().is_empty() => {}
            _ => {
                pending_name = None;
            }
        }
    }
    if resources.len() > 10_000 {
        return Err("Pi package list exceeded its fixed entry cap".to_string());
    }
    Ok(resources)
}

fn command_resources(response: &Value) -> Vec<PiWorkspaceAgentResource> {
    response
        .get("commands")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|command| {
            let name = command.get("name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(PiWorkspaceAgentResource {
                kind: "command".to_string(),
                name: name.to_string(),
                scope: "effective".to_string(),
                source: command
                    .get("source")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                path: command
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                description: command
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .take(10_000)
        .collect()
}

fn discover_changes(root: &Path) -> Result<Vec<PiWorkspaceAgentChange>, String> {
    let repository = match Repository::discover(root) {
        Ok(repository) => repository,
        Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Cannot inspect workspace changes: {error}")),
    };
    let workdir = repository
        .workdir()
        .ok_or_else(|| "Workspace changes are unavailable for a bare repository".to_string())?;
    let canonical_workdir = workdir
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Git worktree: {error}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Pi workspace root: {error}"))?;
    let workspace_prefix = canonical_root
        .strip_prefix(&canonical_workdir)
        .map_err(|_| "Discovered Git worktree does not contain the Pi workspace".to_string())?;

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(|error| format!("Cannot read workspace Git status: {error}"))?;
    let mut changes = Vec::new();
    for entry in statuses.iter() {
        let Some(repository_path) = entry.path().map(Path::new) else {
            continue;
        };
        let Ok(workspace_path) = repository_path.strip_prefix(workspace_prefix) else {
            continue;
        };
        let path = workspace_path.to_string_lossy().replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        changes.push(PiWorkspaceAgentChange {
            path,
            status: status_label(entry.status()).to_string(),
        });
        if changes.len() >= CHANGE_CAP {
            break;
        }
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

fn status_label(status: Status) -> &'static str {
    if status.intersects(Status::CONFLICTED) {
        "conflicted"
    } else if status.intersects(Status::WT_NEW | Status::INDEX_NEW) {
        "added"
    } else if status.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
        "deleted"
    } else if status.intersects(Status::WT_RENAMED | Status::INDEX_RENAMED) {
        "renamed"
    } else if status.intersects(Status::WT_TYPECHANGE | Status::INDEX_TYPECHANGE) {
        "type-changed"
    } else {
        "modified"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let suffix = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "ide-pi-workspace-agent-{label}-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn wait_until(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if condition() {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("condition was not met before timeout");
    }

    fn insert_test_session(
        state: &PiWorkspaceAgentState,
        workspace_id: &str,
        root: &Path,
    ) -> Arc<WorkspaceSession> {
        let session = Arc::new(WorkspaceSession::new(
            workspace_id.to_string(),
            workspace_id.to_string(),
            root.to_path_buf(),
        ));
        state
            .sessions
            .lock()
            .unwrap()
            .insert(workspace_id.to_string(), session.clone());
        session
    }

    #[test]
    fn parses_all_packages_even_when_they_have_no_command() {
        let resources = parse_package_list(
            "User packages:\n  skills/multi-agent\n    /home/u/.pi/agent/skills/multi-agent\n  npm:no-command\n    /home/u/.pi/agent/npm/node_modules/no-command\nProject packages:\n  local/project-resource\n    /workspace/.pi/project-resource\n",
        )
        .unwrap();

        assert_eq!(resources.len(), 3);
        assert_eq!(resources[1].name, "npm:no-command");
        assert_eq!(resources[1].scope, "user");
        assert_eq!(resources[2].scope, "project");
    }

    #[cfg(unix)]
    #[test]
    fn workspace_a_b_a_sessions_are_isolated_and_detach_does_not_stop_them() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = TestDirectory::new("continuity");
        let root_a = fixture.0.join("a");
        let root_b = fixture.0.join("b");
        fs::create_dir_all(&root_a).unwrap();
        fs::create_dir_all(&root_b).unwrap();
        let helper = fixture.0.join("fake-pi");
        fs::write(
            &helper,
            "#!/bin/sh\nprintf 'READY:%s\\n' \"$PWD\"\nwhile IFS= read -r line; do printf 'ECHO:%s:%s\\n' \"$PWD\" \"$line\"; done\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&helper).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&helper, permissions).unwrap();

        let state = PiWorkspaceAgentState::default();
        let session_a = insert_test_session(&state, "workspace-a", &root_a);
        let session_b = insert_test_session(&state, "workspace-b", &root_b);
        let events = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
        let captured = events.clone();
        let emitter = EventEmitter::new(move |name, payload| {
            captured.lock().unwrap().push((name.to_string(), payload));
        });

        state
            .start_session_with_program(&session_a, &helper, 80, 24, emitter.clone())
            .unwrap();
        state
            .start_session_with_program(&session_b, &helper, 80, 24, emitter.clone())
            .unwrap();
        state.write("workspace-a", b"A-only\r").unwrap();
        state.write("workspace-b", b"B-only\r").unwrap();
        wait_until(|| {
            let events = events.lock().unwrap();
            let mut observed = String::new();
            for (name, payload) in events.iter() {
                if name != PI_WORKSPACE_AGENT_OUTPUT_EVENT {
                    continue;
                }
                if let Some(encoded) = payload.get("dataBase64").and_then(Value::as_str) {
                    if let Ok(bytes) = BASE64_STANDARD.decode(encoded) {
                        observed.push_str(&String::from_utf8_lossy(&bytes));
                    }
                }
            }
            observed.contains("A-only") && observed.contains("B-only")
        });

        {
            let mut runtime = session_a.runtime.lock().unwrap();
            runtime.attached_views.insert("main-a".to_string());
        }
        state
            .detach("workspace-a", "main-a", emitter.clone())
            .unwrap();
        assert_eq!(session_a.snapshot().process_state, PiProcessState::Running);
        let a_attachment = state.attachment_snapshot(&session_a);
        let a_transcript = BASE64_STANDARD
            .decode(a_attachment.transcript_base64)
            .unwrap();
        let a_text = String::from_utf8_lossy(&a_transcript);
        assert!(a_text.contains("A-only"));
        assert!(!a_text.contains("B-only"));

        assert_eq!(
            state
                .stop("workspace-a", false, emitter.clone())
                .unwrap_err(),
            "Stopping Pi requires explicit confirmation"
        );
        assert_eq!(session_a.snapshot().process_state, PiProcessState::Running);
        state.stop("workspace-a", true, emitter.clone()).unwrap();
        assert_eq!(session_a.snapshot().process_state, PiProcessState::Stopped);
        assert_eq!(session_b.snapshot().process_state, PiProcessState::Running);

        let deterministic_session_id = session_a.session_id.clone();
        state
            .start_session_with_program(&session_a, &helper, 80, 24, emitter.clone())
            .unwrap();
        assert_eq!(session_a.snapshot().process_state, PiProcessState::Running);
        assert_eq!(session_a.session_id, deterministic_session_id);
        assert_eq!(session_b.snapshot().process_state, PiProcessState::Running);
        state.shutdown_all();
    }

    #[test]
    fn transcript_is_bounded_to_one_mebibyte() {
        let mut runtime = SessionRuntime {
            process_state: PiProcessState::Running,
            process_generation: 1,
            process_id: None,
            exit_code: None,
            started_at: None,
            last_activity_at: now_rfc3339(),
            last_error: None,
            master: None,
            writer: None,
            child: None,
            attached_views: BTreeSet::new(),
            transcript: VecDeque::new(),
            transcript_sequence: 0,
            transcript_truncated: false,
            activities: VecDeque::new(),
            next_activity_sequence: 1,
        };
        append_transcript(&mut runtime, &vec![b'a'; TRANSCRIPT_CAP_BYTES + 12]);
        assert_eq!(runtime.transcript.len(), TRANSCRIPT_CAP_BYTES);
        assert!(runtime.transcript_truncated);
    }
}
