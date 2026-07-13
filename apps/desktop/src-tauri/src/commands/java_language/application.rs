//! Session/application lifecycle and process ownership orchestration.

use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::app_config::ide_home_dir;
use crate::workspace::workspace_root;

use super::contract::*;
use super::path_policy::*;
use super::protocol::*;
use super::semantic::*;
use super::support::lock;
use super::toolchain::*;

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const EXIT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_RESTARTS_PER_MINUTE: usize = 3;
const DOCUMENT_WRITE_TIMEOUT: Duration = Duration::from_secs(2);
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(5);
const HOVER_TIMEOUT: Duration = Duration::from_secs(4);
const SIGNATURE_HELP_TIMEOUT: Duration = Duration::from_secs(4);

struct RuntimeInfo {
    lifecycle: String,
    capabilities: Option<JavaLanguageCapabilities>,
    detail: Option<String>,
}

struct Session {
    generation: u64,
    workspace_id: String,
    workspace_root: PathBuf,
    jdtls: JdtlsInstall,
    java: JavaInstall,
    child: Arc<Mutex<Child>>,
    writer: Arc<Mutex<ChildStdin>>,
    shutdown_id: Arc<AtomicU64>,
    shutdown_rx: mpsc::Receiver<()>,
    runtime: Arc<Mutex<RuntimeInfo>>,
    open_documents: HashMap<String, OpenDocument>,
    pending_semantic: PendingSemanticRequests,
    next_request_id: Arc<AtomicU64>,
    threads: Vec<JoinHandle<()>>,
}

struct Manager {
    generation: u64,
    session: Option<Session>,
    events: Arc<Mutex<EventQueue>>,
    restart_times: VecDeque<Instant>,
}

impl Default for Manager {
    fn default() -> Self {
        Self {
            generation: 0,
            session: None,
            events: Arc::new(Mutex::new(EventQueue::default())),
            restart_times: VecDeque::new(),
        }
    }
}

pub struct JavaLanguageServiceState {
    manager: Mutex<Manager>,
}

impl Default for JavaLanguageServiceState {
    fn default() -> Self {
        Self {
            manager: Mutex::new(Manager::default()),
        }
    }
}

impl JavaLanguageServiceState {
    pub fn shutdown_all(&self) {
        if let Ok(mut manager) = self.manager.lock() {
            let _ = stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT);
        }
    }

    pub(super) fn service_status(&self) -> Result<JavaLanguageServiceStatus, String> {
        let manager = lock(&self.manager, "Java language service state")?;
        status(&manager)
    }

    pub(super) fn start(&self) -> Result<JavaLanguageServiceStatus, String> {
        let mut manager = lock(&self.manager, "Java language service state")?;
        start_session(&mut manager, INITIALIZE_TIMEOUT)?;
        status(&manager)
    }

    pub(super) fn stop(&self) -> Result<JavaLanguageServiceStatus, String> {
        let mut manager = lock(&self.manager, "Java language service state")?;
        stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        status(&manager)
    }

    pub(super) fn restart(&self) -> Result<JavaLanguageServiceStatus, String> {
        let mut manager = lock(&self.manager, "Java language service state")?;
        stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        start_session(&mut manager, INITIALIZE_TIMEOUT)?;
        status(&manager)
    }

    pub(super) fn poll_events(
        &self,
        after_sequence: u64,
        limit: usize,
    ) -> Result<JavaLanguageServiceEventBatch, String> {
        let manager = lock(&self.manager, "Java language service state")?;
        let queue = lock(&manager.events, "Java language service event queue")?;
        Ok(queue.poll(after_sequence, limit))
    }

    pub(super) fn open_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Open, document)
    }

    pub(super) fn change_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Change, document)
    }

    pub(super) fn save_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Save, document)
    }

    pub(super) fn close_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Close, document)
    }

    fn synchronize(
        &self,
        action: SyncAction,
        document: JavaLanguageDocument,
    ) -> Result<(), String> {
        let mut manager = lock(&self.manager, "Java language service state")?;
        sync_document(&mut manager, action, document)
    }

    pub(super) fn request_completion(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::Completion, COMPLETION_TIMEOUT)
    }

    pub(super) fn request_hover(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::Hover, HOVER_TIMEOUT)
    }

    pub(super) fn request_signature_help(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::SignatureHelp,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn cancel_semantic_request(&self, cancellation_id: String) -> Result<(), String> {
        validate_semantic_id(&cancellation_id, "cancellation")?;
        let manager = lock(&self.manager, "Java language service state")?;
        let Some(session) = &manager.session else {
            return Ok(());
        };
        cancel_by_cancellation_id(&session.pending_semantic, &session.writer, &cancellation_id);
        Ok(())
    }
}

impl Drop for JavaLanguageServiceState {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SyncAction {
    Open,
    Change,
    Save,
    Close,
}

fn sync_document(
    manager: &mut Manager,
    action: SyncAction,
    document: JavaLanguageDocument,
) -> Result<(), String> {
    let session = manager
        .session
        .as_mut()
        .ok_or_else(|| "Java language service has no active session".to_string())?;
    let lifecycle = lock(&session.runtime, "Java language service runtime")?
        .lifecycle
        .clone();
    if !matches!(lifecycle.as_str(), "initialized" | "ready" | "degraded") {
        return Err("Java language service is not ready for document synchronization".to_string());
    }
    let current_root = workspace_root()?
        .canonicalize()
        .map_err(|_| "Cannot authorize the current workspace".to_string())?;
    if current_root != session.workspace_root
        || workspace_id(&current_root) != session.workspace_id
        || document.workspace_id != session.workspace_id
        || document.generation != session.generation
    {
        return Err(
            "Document synchronization target does not match the current session".to_string(),
        );
    }
    if document.version < 0 {
        return Err("Document version must be non-negative".to_string());
    }

    let (path, uri) = authorize_java_path(&session.workspace_root, &document.path)?;
    if document.uri != uri {
        return Err("Document URI does not match the native authorized file URI".to_string());
    }
    let current = session.open_documents.get(&path);
    let (language_id, text, message) = match action {
        SyncAction::Open => {
            if current.is_some() {
                return Err("Document is already open in the current session".to_string());
            }
            if session.open_documents.len() >= MAX_OPEN_DOCUMENTS {
                return Err("Open document limit exceeded".to_string());
            }
            let language_id = require_java_language(&document)?;
            let text = require_document_text(&document)?;
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{
                "uri":uri,"languageId":language_id,"version":document.version,"text":text
            }}});
            (language_id, text, message)
        }
        SyncAction::Change => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version <= current.version {
                return Err("Document change version must be strictly increasing".to_string());
            }
            let language_id = require_java_language(&document)?;
            if language_id != current.language_id {
                return Err("Document language cannot change while open".to_string());
            }
            let text = require_document_text(&document)?;
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didChange","params":{
                "textDocument":{"uri":uri,"version":document.version},"contentChanges":[{"text":text}]
            }});
            (language_id, text, message)
        }
        SyncAction::Save => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version != current.version {
                return Err("Document save version must equal the current open version".to_string());
            }
            let language_id = require_java_language(&document)?;
            if language_id != current.language_id {
                return Err("Document language cannot change while open".to_string());
            }
            let text = require_document_text(&document)?;
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didSave","params":{
                "textDocument":{"uri":uri},"text":text
            }});
            (language_id, text, message)
        }
        SyncAction::Close => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version != current.version {
                return Err(
                    "Document close version must equal the current open version".to_string()
                );
            }
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didClose","params":{
                "textDocument":{"uri":uri}
            }});
            (current.language_id.clone(), String::new(), message)
        }
    };

    write_message_timeout(&session.writer, message, DOCUMENT_WRITE_TIMEOUT)?;
    if action == SyncAction::Close {
        session.open_documents.remove(&path);
        push_diagnostics_clear(
            &manager.events,
            session.generation,
            &session.workspace_id,
            &uri,
            document.version,
        );
    } else {
        session.open_documents.insert(
            path.clone(),
            OpenDocument {
                path,
                uri,
                language_id,
                version: document.version,
                text_hash: hash_text(&text),
                line_utf16_boundaries: line_utf16_boundaries(&text)?,
            },
        );
    }
    Ok(())
}

fn semantic_request(
    state: &JavaLanguageServiceState,
    request: JavaSemanticRequest,
    kind: SemanticKind,
    timeout: Duration,
) -> Result<JavaSemanticNativeResponse, String> {
    validate_semantic_id(&request.request_id, "request")?;
    validate_semantic_id(&request.cancellation_id, "cancellation")?;

    let (response_tx, response_rx) = mpsc::sync_channel(1);
    let (writer, pending, native_id, session_root, mut response) = {
        let manager = lock(&state.manager, "Java language service state")?;
        let provider_version = manager
            .session
            .as_ref()
            .and_then(|session| session.jdtls.version.clone());
        let base = native_response(&request, provider_version);
        let Some(session) = &manager.session else {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "Java semantic provider has no active session",
                true,
            ));
        };
        if let Err(summary) = validate_semantic_request(session, &request) {
            return Ok(semantic_failure(base, "stale-version", &summary, false));
        }
        let params = semantic_params(&request, kind)?;
        let native_id = session.next_request_id.fetch_add(1, Ordering::SeqCst);
        match reserve_pending_request(
            &session.pending_semantic,
            native_id,
            request.cancellation_id.clone(),
            response_tx,
        )? {
            Ok(()) => {}
            Err(PendingReservationError::Limit) => {
                return Ok(semantic_failure(
                    base,
                    "unavailable",
                    "Java semantic concurrent request limit exceeded",
                    true,
                ));
            }
            Err(PendingReservationError::DuplicateCancellationId) => {
                return Ok(semantic_failure(
                    base,
                    "unavailable",
                    "Java semantic cancellation ID is already active",
                    false,
                ));
            }
        }
        let message = json!({
            "jsonrpc":"2.0","id":native_id,"method":kind.method(),"params":params
        });
        if write_message(&session.writer, &message).is_err() {
            if let Ok(mut requests) = session.pending_semantic.lock() {
                requests.remove(&native_id);
            }
            return Ok(semantic_failure(
                base,
                "unavailable",
                "Java semantic request could not be sent",
                true,
            ));
        }
        (
            Arc::clone(&session.writer),
            Arc::clone(&session.pending_semantic),
            native_id,
            session.workspace_root.clone(),
            base,
        )
    };

    let deadline = Instant::now() + timeout;
    let raw = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match response_rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(value) => break value,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {
                let workspace_changed = workspace_root()
                    .and_then(|root| {
                        root.canonicalize()
                            .map_err(|_| "Cannot authorize the current workspace".to_string())
                    })
                    .map_or(true, |root| root != session_root);
                if workspace_changed {
                    let removed = pending
                        .lock()
                        .ok()
                        .and_then(|mut requests| requests.remove(&native_id))
                        .is_some();
                    if removed {
                        send_cancel(&writer, native_id);
                    }
                    return Ok(semantic_failure(
                        response,
                        "cancelled",
                        "Java semantic request was cancelled after a workspace switch",
                        true,
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let removed = pending
                    .lock()
                    .ok()
                    .and_then(|mut requests| requests.remove(&native_id))
                    .is_some();
                if removed {
                    send_cancel(&writer, native_id);
                }
                return Ok(semantic_failure(
                    response,
                    "timeout",
                    "Java semantic request timed out",
                    true,
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Ok(semantic_failure(
                    response,
                    "unavailable",
                    "Java semantic session ended before responding",
                    true,
                ));
            }
        }
    };
    if raw.get("__cancelled").and_then(Value::as_bool) == Some(true) {
        return Ok(semantic_failure(
            response,
            "cancelled",
            "Java semantic request was cancelled",
            true,
        ));
    }
    if let Some(error) = raw.get("error") {
        let code = error.get("code").and_then(Value::as_i64);
        let cancelled = code == Some(-32800) || code == Some(-32802);
        let mut failed = semantic_failure(
            response,
            if cancelled {
                "cancelled"
            } else {
                "provider-error"
            },
            if cancelled {
                "Java semantic provider cancelled the request"
            } else {
                "Java semantic provider returned an error"
            },
            cancelled,
        );
        if let Some(code) = code {
            if let Some(error) = &mut failed.error {
                error.provider_code = Some(Value::from(code));
            }
        }
        return Ok(failed);
    }
    let Some(result) = raw.get("result") else {
        return Ok(semantic_failure(
            response,
            "malformed-result",
            "Java semantic provider returned no result",
            false,
        ));
    };
    match sanitize_semantic_result(kind, result, &request, &workspace_root()?) {
        Some(result) => response.result = Some(result),
        None => {
            return Ok(semantic_failure(
                response,
                "malformed-result",
                "Java semantic provider returned an invalid or oversized result",
                false,
            ));
        }
    }
    Ok(response)
}

fn validate_semantic_request(
    session: &Session,
    request: &JavaSemanticRequest,
) -> Result<(), String> {
    let lifecycle = lock(&session.runtime, "Java language service runtime")?
        .lifecycle
        .clone();
    if !matches!(lifecycle.as_str(), "initialized" | "ready" | "degraded") {
        return Err("Java semantic session is not ready".to_string());
    }
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "Cannot authorize the current workspace".to_string())?;
    if root != session.workspace_root
        || workspace_id(&root) != session.workspace_id
        || request.workspace_id != session.workspace_id
        || request.generation != session.generation
    {
        return Err("Java semantic request does not match the current session".to_string());
    }
    let (path, uri) = authorize_java_path(&session.workspace_root, &request.document.path)?;
    if path != request.document.path || uri != request.document.uri {
        return Err("Java semantic document path or URI is stale".to_string());
    }
    let document = session
        .open_documents
        .get(&path)
        .ok_or_else(|| "Java semantic document is not open".to_string())?;
    validate_semantic_open_document(document, &path, &uri, request)
}

fn write_message_timeout(
    writer: &Arc<Mutex<ChildStdin>>,
    value: Value,
    timeout: Duration,
) -> Result<(), String> {
    let writer = Arc::clone(writer);
    let (tx, rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = tx.send(write_message(&writer, &value));
    });
    rx.recv_timeout(timeout)
        .map_err(|_| "Timed out writing an LSP notification".to_string())?
}

fn push_diagnostics_clear(
    events: &Arc<Mutex<EventQueue>>,
    generation: u64,
    workspace_id: &str,
    uri: &str,
    version: i64,
) {
    push_event(
        events,
        generation,
        "diagnostics",
        json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","workspaceId":workspace_id,
            "generation":generation,"params":{"uri":uri,"version":version,"diagnostics":[]}}),
    );
}

fn status(manager: &Manager) -> Result<JavaLanguageServiceStatus, String> {
    if let Some(session) = &manager.session {
        let runtime = lock(&session.runtime, "Java language service runtime")?;
        return Ok(JavaLanguageServiceStatus {
            provider: "jdtls",
            available: true,
            lifecycle: runtime.lifecycle.clone(),
            generation: session.generation,
            workspace_id: Some(session.workspace_id.clone()),
            workspace_root: Some(session.workspace_root.to_string_lossy().into_owned()),
            jdtls_home: Some(session.jdtls.home.to_string_lossy().into_owned()),
            jdtls_version: session.jdtls.version.clone(),
            java_executable: Some(session.java.executable.to_string_lossy().into_owned()),
            java_version: Some(session.java.version.clone()),
            capabilities: runtime.capabilities.clone(),
            detail: runtime.detail.clone(),
        });
    }

    let jdtls = discover_jdtls().ok();
    let java = discover_java().ok();
    let root = workspace_root().ok();
    let detail = match (&jdtls, &java) {
        (None, _) => Some("Eclipse JDT LS is not installed or its layout is invalid".to_string()),
        (_, None) => Some("A full Java JDK could not be capability-probed".to_string()),
        _ => None,
    };
    Ok(JavaLanguageServiceStatus {
        provider: "jdtls",
        available: jdtls.is_some() && java.is_some(),
        lifecycle: "stopped".to_string(),
        generation: manager.generation,
        workspace_id: root.as_deref().map(workspace_id),
        workspace_root: root.map(|path| path.to_string_lossy().into_owned()),
        jdtls_home: jdtls
            .as_ref()
            .map(|install| install.home.to_string_lossy().into_owned()),
        jdtls_version: jdtls.as_ref().and_then(|install| install.version.clone()),
        java_executable: java
            .as_ref()
            .map(|install| install.executable.to_string_lossy().into_owned()),
        java_version: java.map(|install| install.version),
        capabilities: None,
        detail,
    })
}

fn start_session(manager: &mut Manager, timeout: Duration) -> Result<(), String> {
    let root = workspace_root()?;
    let id = workspace_id(&root);
    if let Some(session) = &manager.session {
        let running =
            lock(&session.runtime, "Java language service runtime")?.lifecycle == "initialized";
        if running && session.workspace_id == id && session.workspace_root == root {
            return Ok(());
        }
    }
    enforce_restart_limit(manager)?;
    if manager.session.is_some() {
        stop_session(manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
    }

    let jdtls = discover_jdtls()?;
    let java = discover_java()?;
    manager.generation = manager.generation.saturating_add(1);
    let generation = manager.generation;
    let data_dir = ide_home_dir()?
        .join("language-services")
        .join("java")
        .join(&id);
    fs::create_dir_all(&data_dir).map_err(|error| {
        format!(
            "Cannot create Java language service data directory '{}': {error}",
            data_dir.display()
        )
    })?;

    let args = launch_args(&jdtls, &data_dir);
    let mut command = Command::new(&java.executable);
    command
        .args(&args)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    copy_safe_environment(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot launch Eclipse JDT LS: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "JDT LS stdin was not piped".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "JDT LS stdout was not piped".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "JDT LS stderr was not piped".to_string())?;
    let child = Arc::new(Mutex::new(child));
    let writer = Arc::new(Mutex::new(stdin));
    let runtime = Arc::new(Mutex::new(RuntimeInfo {
        lifecycle: "starting".to_string(),
        capabilities: None,
        detail: None,
    }));
    let (incoming_tx, incoming_rx) = mpsc::sync_channel(64);
    let reader_runtime = Arc::clone(&runtime);
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_frame(&mut reader, MAX_MESSAGE_BYTES) {
                Ok(Some(message)) => {
                    if incoming_tx.send(Incoming::Message(message)).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = incoming_tx.send(Incoming::Closed("JDT LS stdout closed".to_string()));
                    break;
                }
                Err(error) => {
                    if let Ok(mut info) = reader_runtime.lock() {
                        info.lifecycle = "failed".to_string();
                        info.detail = Some(error.clone());
                    }
                    let _ = incoming_tx.send(Incoming::Closed(error));
                    break;
                }
            }
        }
    });
    let stderr_root = root.to_string_lossy().into_owned();
    let stderr_home = env::var("HOME").ok();
    let stderr_thread =
        thread::spawn(move || drain_stderr(stderr, &stderr_root, stderr_home.as_deref()));

    let initialize_id = generation.saturating_mul(10).saturating_add(1);
    let request = initialize_request(initialize_id, &root);
    if let Err(error) = write_message(&writer, &request) {
        kill_child(&child);
        return Err(error);
    }

    let initialize_result = wait_for_initialize(&incoming_rx, initialize_id, timeout);
    let capabilities = match initialize_result {
        Ok(value) => normalize_capabilities(&value),
        Err(error) => {
            kill_child(&child);
            let _ = reader.join();
            let _ = stderr_thread.join();
            push_event(
                &manager.events,
                generation,
                "status",
                json!({"lifecycle":"failed","detail":error}),
            );
            return Err(error);
        }
    };
    if let Err(error) = write_message(
        &writer,
        &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
    ) {
        kill_child(&child);
        let _ = reader.join();
        let _ = stderr_thread.join();
        return Err(error);
    }
    if let Err(error) = write_message(
        &writer,
        &json!({
            "jsonrpc":"2.0",
            "method":"workspace/didChangeConfiguration",
            "params":{"settings":{"java":{"signatureHelp":{"enabled":true}}}}
        }),
    ) {
        kill_child(&child);
        let _ = reader.join();
        let _ = stderr_thread.join();
        return Err(error);
    }
    if let Ok(mut info) = runtime.lock() {
        info.lifecycle = "initialized".to_string();
        info.capabilities = Some(capabilities.clone());
    }
    push_event(
        &manager.events,
        generation,
        "status",
        json!({"lifecycle":"initialized","capabilities":capabilities}),
    );

    let shutdown_id = Arc::new(AtomicU64::new(0));
    let pending_semantic = Arc::new(Mutex::new(HashMap::new()));
    let next_request_id = Arc::new(AtomicU64::new(
        generation.saturating_mul(1_000_000).saturating_add(100),
    ));
    let (shutdown_tx, shutdown_rx) = mpsc::sync_channel(1);
    let dispatcher_events = Arc::clone(&manager.events);
    let dispatcher_runtime = Arc::clone(&runtime);
    let dispatcher_shutdown_id = Arc::clone(&shutdown_id);
    let dispatcher_writer = Arc::clone(&writer);
    let dispatcher_workspace_id = id.clone();
    let dispatcher_workspace_root = root.clone();
    let dispatcher_pending_semantic = Arc::clone(&pending_semantic);
    let dispatcher = thread::spawn(move || {
        dispatch_messages(
            incoming_rx,
            generation,
            DispatcherContext {
                workspace_id: dispatcher_workspace_id,
                workspace_root: dispatcher_workspace_root,
                events: dispatcher_events,
                runtime: dispatcher_runtime,
                shutdown_id: dispatcher_shutdown_id,
                shutdown_tx,
                writer: dispatcher_writer,
                pending_semantic: dispatcher_pending_semantic,
            },
        )
    });

    manager.session = Some(Session {
        generation,
        workspace_id: id,
        workspace_root: root,
        jdtls,
        java,
        child,
        writer,
        shutdown_id,
        shutdown_rx,
        runtime,
        open_documents: HashMap::new(),
        pending_semantic,
        next_request_id,
        threads: vec![reader, stderr_thread, dispatcher],
    });
    Ok(())
}

fn stop_session(
    manager: &mut Manager,
    shutdown_timeout: Duration,
    exit_timeout: Duration,
) -> Result<(), String> {
    let Some(mut session) = manager.session.take() else {
        manager.generation = manager.generation.saturating_add(1);
        return Ok(());
    };
    manager.generation = manager.generation.max(session.generation).saturating_add(1);
    if let Ok(mut runtime) = session.runtime.lock() {
        runtime.lifecycle = "stopping".to_string();
    }
    push_event(
        &manager.events,
        session.generation,
        "status",
        json!({"lifecycle":"stopping"}),
    );
    cancel_all_semantic_requests(&session.pending_semantic, &session.writer);

    for document in session.open_documents.drain().map(|(_, document)| document) {
        let close = json!({"jsonrpc":"2.0","method":"textDocument/didClose","params":{
            "textDocument":{"uri":document.uri}
        }});
        let _ = write_message_timeout(&session.writer, close, DOCUMENT_WRITE_TIMEOUT);
        push_diagnostics_clear(
            &manager.events,
            session.generation,
            &session.workspace_id,
            &document.uri,
            document.version,
        );
    }

    let request_id = session.generation.saturating_mul(10).saturating_add(2);
    session.shutdown_id.store(request_id, Ordering::SeqCst);
    let shutdown_sent = write_message(
        &session.writer,
        &json!({"jsonrpc":"2.0","id":request_id,"method":"shutdown","params":null}),
    )
    .is_ok();
    if shutdown_sent && session.shutdown_rx.recv_timeout(shutdown_timeout).is_ok() {
        let _ = write_message(
            &session.writer,
            &json!({"jsonrpc":"2.0","method":"exit","params":null}),
        );
    }
    drop(session.writer);

    let exited = wait_for_exit(&session.child, exit_timeout)?;
    if !exited {
        kill_child(&session.child);
    }
    for handle in session.threads.drain(..) {
        let _ = handle.join();
    }
    push_event(
        &manager.events,
        manager.generation,
        "status",
        json!({"lifecycle":"stopped"}),
    );
    Ok(())
}

fn enforce_restart_limit(manager: &mut Manager) -> Result<(), String> {
    let now = Instant::now();
    while manager
        .restart_times
        .front()
        .is_some_and(|time| now.duration_since(*time) > Duration::from_secs(60))
    {
        manager.restart_times.pop_front();
    }
    if manager.restart_times.len() >= MAX_RESTARTS_PER_MINUTE {
        return Err(
            "Java language service launch/restart limit exceeded; retry in one minute".to_string(),
        );
    }
    manager.restart_times.push_back(now);
    Ok(())
}

struct DispatcherContext {
    workspace_id: String,
    workspace_root: PathBuf,
    events: Arc<Mutex<EventQueue>>,
    runtime: Arc<Mutex<RuntimeInfo>>,
    shutdown_id: Arc<AtomicU64>,
    shutdown_tx: mpsc::SyncSender<()>,
    writer: Arc<Mutex<ChildStdin>>,
    pending_semantic: PendingSemanticRequests,
}

fn dispatch_messages(
    incoming: mpsc::Receiver<Incoming>,
    generation: u64,
    context: DispatcherContext,
) {
    while let Ok(item) = incoming.recv() {
        match item {
            Incoming::Message(message) => {
                let expected = context.shutdown_id.load(Ordering::SeqCst);
                if expected != 0 && response_id(&message) == Some(expected) {
                    let _ = context.shutdown_tx.try_send(());
                    continue;
                }
                let method = message.get("method").and_then(Value::as_str);
                if route_pending_response(&context.pending_semantic, &message) {
                    // Unknown and late client responses are intentionally dropped. They must
                    // never become pollable generic protocol events.
                    continue;
                }
                if method.is_some() && message.get("id").is_some() {
                    if let Err(detail) = respond_to_server_request(&context.writer, &message) {
                        if let Ok(mut info) = context.runtime.lock() {
                            info.lifecycle = "failed".to_string();
                            info.detail = Some(detail.clone());
                        }
                        push_event(
                            &context.events,
                            generation,
                            "status",
                            json!({"lifecycle":"failed","detail":detail}),
                        );
                        break;
                    }
                }
                if method == Some("textDocument/publishDiagnostics") {
                    if let Some(payload) = sanitize_diagnostics(
                        message,
                        generation,
                        &context.workspace_id,
                        &context.workspace_root,
                    ) {
                        push_event(&context.events, generation, "diagnostics", payload);
                    }
                    continue;
                }
                let kind = match method {
                    Some("$/progress") => "progress",
                    Some("window/logMessage") | Some("window/showMessage") => "status",
                    Some(_) => "notification",
                    None => "protocol",
                };
                push_event(&context.events, generation, kind, bounded_payload(message));
            }
            Incoming::Closed(detail) => {
                if let Ok(mut pending) = context.pending_semantic.lock() {
                    pending.clear();
                }
                let mut unexpected = true;
                if let Ok(mut info) = context.runtime.lock() {
                    unexpected = info.lifecycle != "stopping";
                    if unexpected {
                        info.lifecycle = "failed".to_string();
                        info.detail = Some(detail.clone());
                    }
                }
                if unexpected {
                    push_event(
                        &context.events,
                        generation,
                        "status",
                        json!({"lifecycle":"failed","detail":detail}),
                    );
                }
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "ide-jdtls-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn wait_for_matching_event(
        manager: &Manager,
        after_sequence: u64,
        timeout: Duration,
        predicate: impl Fn(&JavaLanguageServiceEvent) -> bool,
    ) -> JavaLanguageServiceEvent {
        let deadline = Instant::now() + timeout;
        loop {
            let batch = lock(&manager.events, "real event queue")
                .unwrap()
                .poll(after_sequence, MAX_EVENTS);
            if let Some(event) = batch.events.iter().find(|event| predicate(event)) {
                return event.clone();
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for JDT LS event after sequence {after_sequence}: {batch:?}"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    #[ignore = "requires the checksum-verified managed JDT LS installation and a full JDK"]
    fn managed_jdtls_real_semantic_completion_hover_and_signature_smoke() {
        let root = temp_dir("real-semantic-workspace");
        let ide_home = temp_dir("real-semantic-state");
        let java_path = root.join("src/main/java/example/SemanticFixture.java");
        fs::create_dir_all(java_path.parent().unwrap()).unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>semantic-fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release></properties>
</project>"#,
        )
        .unwrap();
        let source = concat!(
            "package example;\n",
            "public final class SemanticFixture {\n",
            "  static String helper(String value, int count) { return value.repeat(count); }\n",
            "  void run() {\n",
            "    String text = \"hello\";\n",
            "    text.substring(0);\n",
            "    helper(text, 2);\n",
            "  }\n",
            "}\n",
        );
        fs::write(&java_path, source).unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-real-semantic"}"#,
        )
        .unwrap();

        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        let mut manager = Manager::default();
        let discovery = status(&manager).unwrap();
        if !discovery.available {
            eprintln!("skipping real semantic smoke: managed JDT LS unavailable");
            env::remove_var(crate::workspace::WORKSPACE_ROOT_ENV);
            env::remove_var(crate::app_config::IDE_HOME_ENV);
            fs::remove_dir_all(&root).unwrap();
            fs::remove_dir_all(&ide_home).unwrap();
            return;
        }

        start_session(&mut manager, Duration::from_secs(60)).unwrap();
        let initialized = status(&manager).unwrap();
        assert!(initialized
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| {
                capabilities.document_sync
                    && capabilities.completion
                    && capabilities.hover
                    && capabilities.signature_help
            }));
        wait_for_matching_event(&manager, 0, Duration::from_secs(60), |event| {
            event.payload.get("method").and_then(Value::as_str) == Some("language/status")
                && event
                    .payload
                    .pointer("/params/type")
                    .and_then(Value::as_str)
                    == Some("ServiceReady")
        });

        let uri = file_uri(&java_path);
        let pid = lock(
            &manager.session.as_ref().unwrap().child,
            "real semantic JDT LS process",
        )
        .unwrap()
        .id();
        sync_document(
            &mut manager,
            SyncAction::Open,
            JavaLanguageDocument {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                path: "src/main/java/example/SemanticFixture.java".to_string(),
                uri: uri.clone(),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            },
        )
        .unwrap();
        let state = JavaLanguageServiceState {
            manager: Mutex::new(manager),
        };

        let request =
            |position: JavaSemanticPosition,
             request_id: String,
             cancellation_id: String,
             trigger: Option<JavaCompletionTriggerContext>| JavaSemanticRequest {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                document: JavaSemanticDocumentTarget {
                    path: "src/main/java/example/SemanticFixture.java".to_string(),
                    uri: uri.clone(),
                    version: 1,
                },
                position,
                request_id,
                cancellation_id,
                trigger,
            };
        let assert_metadata = |response: &JavaSemanticNativeResponse, request_id: &str| {
            assert_eq!(response.provider, "jdtls");
            assert_eq!(response.provider_version, initialized.jdtls_version);
            assert_eq!(response.workspace_id, "jdtls-real-semantic");
            assert_eq!(response.generation, initialized.generation);
            assert_eq!(response.path, "src/main/java/example/SemanticFixture.java");
            assert_eq!(response.uri, uri);
            assert_eq!(response.version, 1);
            assert_eq!(response.request_id, request_id);
            assert!(!response.cancelled && !response.timeout, "{response:?}");
        };

        // Reconciliation and Maven indexing can trail ServiceReady briefly. Poll with unique
        // correlation IDs, bounded by one outer deadline and each native request timeout.
        let completion_deadline = Instant::now() + Duration::from_secs(30);
        let mut completion_attempt = 0;
        let completion = loop {
            completion_attempt += 1;
            let request_id = format!("real-completion-{completion_attempt}");
            let response = semantic_request(
                &state,
                request(
                    JavaSemanticPosition {
                        line: 5,
                        character: 9,
                    },
                    request_id.clone(),
                    format!("real-completion-cancel-{completion_attempt}"),
                    Some(JavaCompletionTriggerContext {
                        kind: "invoked".to_string(),
                        character: None,
                    }),
                ),
                SemanticKind::Completion,
                COMPLETION_TIMEOUT,
            )
            .unwrap();
            assert_metadata(&response, &request_id);
            let found = response
                .result
                .as_ref()
                .and_then(|result| result.get("items"))
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items.iter().any(|item| {
                        item.get("label")
                            .and_then(Value::as_str)
                            .is_some_and(|label| label.contains("repeat"))
                    })
                });
            if found {
                break response;
            }
            assert!(
                Instant::now() < completion_deadline,
                "completion did not contain repeat: {response:?}"
            );
            thread::sleep(Duration::from_millis(200));
        };

        let hover = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 6,
                    character: 6,
                },
                "real-hover".to_string(),
                "real-hover-cancel".to_string(),
                None,
            ),
            SemanticKind::Hover,
            HOVER_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&hover, "real-hover");
        let hover_text = hover
            .result
            .as_ref()
            .and_then(|result| result.get("contents"))
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|content| content.get("value").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !hover_text.is_empty() && hover_text.contains("helper"),
            "{hover:?}"
        );

        let signature = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 5,
                    character: 19,
                },
                "real-signature".to_string(),
                "real-signature-cancel".to_string(),
                None,
            ),
            SemanticKind::SignatureHelp,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&signature, "real-signature");
        let signatures = signature
            .result
            .as_ref()
            .and_then(|result| result.get("signatures"))
            .and_then(Value::as_array)
            .unwrap();
        assert!(
            signatures.iter().any(|item| {
                item.get("label")
                    .and_then(Value::as_str)
                    .is_some_and(|label| label.contains("substring") && label.contains("int"))
                    && item
                        .get("parameters")
                        .and_then(Value::as_array)
                        .is_some_and(|parameters| !parameters.is_empty())
            }),
            "{signature:?}"
        );

        let (cancel_tx, cancel_rx) = mpsc::sync_channel(1);
        let (pending, writer) = {
            let manager = state.manager.lock().unwrap();
            let session = manager.session.as_ref().unwrap();
            (
                Arc::clone(&session.pending_semantic),
                Arc::clone(&session.writer),
            )
        };
        assert!(pending.lock().unwrap().is_empty());
        assert_eq!(
            reserve_pending_request(
                &pending,
                9_999_999,
                "real-cleanup-cancel".to_string(),
                cancel_tx
            )
            .unwrap(),
            Ok(())
        );
        cancel_by_cancellation_id(&pending, &writer, "real-cleanup-cancel");
        assert_eq!(
            cancel_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            json!({"__cancelled":true})
        );
        assert!(pending.lock().unwrap().is_empty());

        let mut manager = state.manager.lock().unwrap();
        let close = JavaLanguageDocument {
            workspace_id: "jdtls-real-semantic".to_string(),
            generation: initialized.generation,
            path: "src/main/java/example/SemanticFixture.java".to_string(),
            uri: uri.clone(),
            version: 1,
            language_id: None,
            text: None,
        };
        sync_document(&mut manager, SyncAction::Close, close).unwrap();
        stop_session(
            &mut manager,
            Duration::from_secs(10),
            Duration::from_secs(10),
        )
        .unwrap();
        drop(manager);
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());

        let evidence = json!({"completion":completion,"hover":hover,"signature":signature,"processLeak":false});
        assert!(!serde_json::to_string(&evidence).unwrap().contains(source));
        assert!(!root.join(".metadata").exists());
        assert!(!root.join(".jdtls").exists());
        println!("REAL_JDTLS_SEMANTIC_EVIDENCE={evidence}");

        env::remove_var(crate::workspace::WORKSPACE_ROOT_ENV);
        env::remove_var(crate::app_config::IDE_HOME_ENV);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&ide_home).unwrap();
        assert!(!root.exists() && !ide_home.exists());
    }

    #[test]
    #[ignore = "requires the checksum-verified managed JDT LS installation and a full JDK"]
    fn managed_jdtls_real_initialize_poll_and_graceful_stop() {
        let root = temp_dir("real-workspace");
        let ide_home = temp_dir("real-state");
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release></properties>
</project>"#,
        )
        .unwrap();
        fs::write(
            root.join("src/main/java/example/App.java"),
            "package example; public final class App { public static void main(String[] args) { System.out.println(\"ready\"); } }\n",
        )
        .unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-real-integration"}"#,
        )
        .unwrap();

        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        let mut manager = Manager::default();

        let initial = status(&manager).unwrap();
        assert!(initial.available, "discovery failed: {:?}", initial.detail);
        assert_eq!(
            initial.jdtls_version.as_deref(),
            Some("1.61.0-202607102111")
        );
        assert!(
            initial.jdtls_home.as_deref().is_some_and(
                |home| home.contains("/.local/share/ide/tools/jdtls/1.61.0-202607102111")
            )
        );
        assert!(initial
            .java_executable
            .as_deref()
            .is_some_and(|java| java.ends_with("/java")));

        start_session(&mut manager, Duration::from_secs(60)).unwrap();
        let initialized = status(&manager).unwrap();
        assert_eq!(initialized.lifecycle, "initialized");
        let capabilities = initialized.capabilities.as_ref().unwrap();
        assert!(capabilities.completion);
        assert!(capabilities.hover);
        assert!(capabilities.definition);
        assert!(capabilities.references);
        assert!(capabilities.document_symbols);
        assert!(capabilities.workspace_symbols);
        assert!(capabilities.rename);
        assert!(capabilities.code_actions);
        assert!(capabilities.formatting);
        assert!(capabilities.signature_help);
        assert!(capabilities.document_sync);
        assert!(capabilities.diagnostics);

        let session = manager.session.as_ref().unwrap();
        let pid = lock(&session.child, "real JDT LS process").unwrap().id();
        let data_dir = ide_home
            .join("language-services/java")
            .join(&session.workspace_id);
        assert!(data_dir.is_dir());
        assert!(!data_dir.starts_with(&root));

        let ready_started = Instant::now();
        let ready = wait_for_matching_event(&manager, 0, Duration::from_secs(60), |event| {
            event.payload.get("method").and_then(Value::as_str) == Some("language/status")
                && event
                    .payload
                    .pointer("/params/type")
                    .and_then(Value::as_str)
                    == Some("ServiceReady")
        });
        let ready_elapsed = ready_started.elapsed();

        let document_uri = file_uri(&root.join("src/main/java/example/App.java"));
        let synchronized = |version, text: &str| JavaLanguageDocument {
            workspace_id: "jdtls-real-integration".to_string(),
            generation: initialized.generation,
            path: "src/main/java/example/App.java".to_string(),
            uri: document_uri.clone(),
            version,
            language_id: Some("java".to_string()),
            text: Some(text.to_string()),
        };
        let valid_open = "package example;\npublic final class App {\n  String value;\n}\n";
        let invalid_change =
            "package example;\npublic final class App {\n  MissingType value;\n}\n";
        let fixed_change =
            "package example;\npublic final class App {\n  String value = \"fixed\";\n}\n";

        sync_document(&mut manager, SyncAction::Open, synchronized(1, valid_open)).unwrap();
        // JDT LS registers its reconciler asynchronously after didOpen.
        thread::sleep(Duration::from_secs(1));
        let change_started = Instant::now();
        sync_document(
            &mut manager,
            SyncAction::Change,
            synchronized(2, invalid_change),
        )
        .unwrap();
        let diagnostic =
            wait_for_matching_event(&manager, ready.sequence, Duration::from_secs(30), |event| {
                event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(document_uri.as_str())
                    && matches!(
                        event
                            .payload
                            .pointer("/params/version")
                            .and_then(Value::as_i64),
                        None | Some(2)
                    )
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(|items| !items.is_empty())
            });
        let diagnostic_elapsed = change_started.elapsed();
        let diagnostics = diagnostic
            .payload
            .pointer("/params/diagnostics")
            .and_then(Value::as_array)
            .unwrap();
        assert!(diagnostics.len() <= MAX_DIAGNOSTICS);
        assert_eq!(diagnostic.generation, initialized.generation);
        assert_eq!(diagnostic.payload["generation"], initialized.generation);
        assert_eq!(diagnostic.payload["workspaceId"], "jdtls-real-integration");
        assert_eq!(initialized.provider, "jdtls");
        assert!(diagnostics.iter().all(|item| {
            let start = item.pointer("/range/start");
            let end = item.pointer("/range/end");
            start
                .and_then(|value| value.get("line"))
                .and_then(Value::as_u64)
                .is_some()
                && start
                    .and_then(|value| value.get("character"))
                    .and_then(Value::as_u64)
                    .is_some()
                && end
                    .and_then(|value| value.get("line"))
                    .and_then(Value::as_u64)
                    .is_some()
                && end
                    .and_then(|value| value.get("character"))
                    .and_then(Value::as_u64)
                    .is_some()
        }));
        assert!(diagnostics.iter().any(|item| {
            item.get("source").and_then(Value::as_str) == Some("Java")
                && item
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("MissingType"))
        }));

        let fix_started = Instant::now();
        sync_document(
            &mut manager,
            SyncAction::Change,
            synchronized(3, fixed_change),
        )
        .unwrap();
        let cleared = wait_for_matching_event(
            &manager,
            diagnostic.sequence,
            Duration::from_secs(30),
            |event| {
                event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(document_uri.as_str())
                    && matches!(
                        event
                            .payload
                            .pointer("/params/version")
                            .and_then(Value::as_i64),
                        None | Some(3)
                    )
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty)
            },
        );
        let clear_elapsed = fix_started.elapsed();
        sync_document(
            &mut manager,
            SyncAction::Save,
            synchronized(3, fixed_change),
        )
        .unwrap();
        let mut close = synchronized(3, "");
        close.language_id = None;
        close.text = None;
        sync_document(&mut manager, SyncAction::Close, close).unwrap();
        let close_clear = wait_for_matching_event(
            &manager,
            cleared.sequence,
            Duration::from_secs(2),
            |event| {
                event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(document_uri.as_str())
                    && event
                        .payload
                        .pointer("/params/version")
                        .and_then(Value::as_i64)
                        == Some(3)
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty)
            },
        );
        let serialized_evidence = serde_json::to_string(&diagnostic.payload).unwrap();
        assert!(!serialized_evidence.contains(valid_open));
        assert!(!serialized_evidence.contains(invalid_change));
        assert!(!serialized_evidence.contains(fixed_change));

        println!(
            "REAL_JDTLS_PHASE_1B_EVIDENCE={}",
            json!({
                "status": initialized,
                "pid": pid,
                "dataDir": data_dir,
                "serviceReadyMs": ready_elapsed.as_millis(),
                "diagnosticLatencyMs": diagnostic_elapsed.as_millis(),
                "diagnosticCount": diagnostics.len(),
                "diagnosticVersion": diagnostic.payload.pointer("/params/version"),
                "diagnostics": diagnostics,
                "clearLatencyMs": clear_elapsed.as_millis(),
                "clearVersion": cleared.payload.pointer("/params/version"),
                "closeClearSequence": close_clear.sequence,
                "latestSequence": close_clear.sequence,
            })
        );

        thread::sleep(Duration::from_secs(1));
        let stop_started = Instant::now();
        stop_session(
            &mut manager,
            Duration::from_secs(10),
            Duration::from_secs(10),
        )
        .unwrap();
        let stop_elapsed = stop_started.elapsed();
        assert!(
            stop_elapsed < Duration::from_secs(9),
            "JDT LS did not acknowledge graceful shutdown: {stop_elapsed:?}"
        );
        assert_eq!(status(&manager).unwrap().lifecycle, "stopped");
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());

        start_session(&mut manager, Duration::from_secs(60)).unwrap();
        let restarted = status(&manager).unwrap();
        assert!(restarted.generation > initialized.generation);
        let restarted_pid = lock(
            &manager.session.as_ref().unwrap().child,
            "restarted real JDT LS process",
        )
        .unwrap()
        .id();
        assert_ne!(restarted_pid, pid);
        wait_for_matching_event(
            &manager,
            close_clear.sequence,
            Duration::from_secs(60),
            |event| {
                event.generation == restarted.generation
                    && event.payload.get("method").and_then(Value::as_str)
                        == Some("language/status")
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            },
        );
        let restart_stop_started = Instant::now();
        stop_session(
            &mut manager,
            Duration::from_secs(10),
            Duration::from_secs(10),
        )
        .unwrap();
        let restart_stop_elapsed = restart_stop_started.elapsed();
        assert!(restart_stop_elapsed < Duration::from_secs(9));
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{restarted_pid}")).exists());
        assert!(!root.join(".metadata").exists());
        assert!(!root.join(".jdtls").exists());

        println!(
            "REAL_JDTLS_GRACEFUL_STOP_EVIDENCE={}",
            json!({
                "firstStopMs": stop_elapsed.as_millis(),
                "restartGeneration": restarted.generation,
                "restartedPid": restarted_pid,
                "restartStopMs": restart_stop_elapsed.as_millis(),
                "processLeak": false,
            })
        );

        env::remove_var(crate::workspace::WORKSPACE_ROOT_ENV);
        env::remove_var(crate::app_config::IDE_HOME_ENV);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&ide_home).unwrap();
        assert!(!root.exists());
        assert!(!ide_home.exists());
    }

    #[cfg(unix)]
    #[test]
    fn fake_lsp_process_initializes_shuts_down_crashes_and_is_killed() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("fake-lsp");
        let script = root.join("fake-lsp.sh");
        fs::write(
            &script,
            r#"#!/bin/sh
mode="$1"
[ "$mode" = crash ] && exit 9
[ "$mode" = hang ] && { sleep 30; exit 0; }
read_message() {
  length=""
  while IFS= read -r line; do
    line=$(printf '%s' "$line" | tr -d '\r')
    [ -z "$line" ] && break
    case "$line" in Content-Length:*) length=${line#Content-Length: };; esac
  done
  [ -n "$length" ] || exit 10
  dd bs=1 count="$length" of=/dev/null 2>/dev/null
}
send_message() {
  body="$1"
  printf 'Content-Length: %s\r\n\r\n%s' "${#body}" "$body"
}
read_message
send_message '{"jsonrpc":"2.0","id":71,"result":{"capabilities":{"hoverProvider":true}}}'
read_message
read_message
send_message '{"jsonrpc":"2.0","id":72,"result":null}'
read_message
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).unwrap();

        let mut child = Command::new(&script)
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let writer = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let mut reader = BufReader::new(child.stdout.take().unwrap());
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","id":71,"method":"initialize","params":{}}),
        )
        .unwrap();
        let response = read_frame(&mut reader, MAX_MESSAGE_BYTES).unwrap().unwrap();
        assert_eq!(response_id(&response), Some(71));
        assert!(normalize_capabilities(response.get("result").unwrap()).hover);
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
        )
        .unwrap();
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","id":72,"method":"shutdown","params":null}),
        )
        .unwrap();
        assert_eq!(
            response_id(&read_frame(&mut reader, MAX_MESSAGE_BYTES).unwrap().unwrap()),
            Some(72)
        );
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","method":"exit","params":null}),
        )
        .unwrap();
        drop(writer);
        assert!(child.wait().unwrap().success());

        let status = Command::new(&script).arg("crash").status().unwrap();
        assert_eq!(status.code(), Some(9));

        let child = Arc::new(Mutex::new(
            Command::new(&script).arg("hang").spawn().unwrap(),
        ));
        assert!(!wait_for_exit(&child, Duration::from_millis(30)).unwrap());
        kill_child(&child);
        assert!(wait_for_exit(&child, Duration::from_millis(30)).unwrap());
        let _ = fs::remove_dir_all(root);
    }
}
