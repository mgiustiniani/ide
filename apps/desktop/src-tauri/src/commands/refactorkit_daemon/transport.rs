//! Owned daemon process and bounded NDJSON JSON-RPC transport.

use std::env;
use std::fmt;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::capability_policy::{ManagedCapabilityMetadata, UNAVAILABLE};
use super::contract::PROTOCOL_FAILED;

const DAEMON_NAME: &str = "refactorkit-daemon";
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const START_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024 + 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_RPC_ERROR_MESSAGE_CHARS: usize = 512;
const CANCELLATION_ACK_TIMEOUT: Duration = Duration::from_secs(1);
pub(super) const SESSION_FAILED: &str = "RefactorKit daemon session failed safely.";
const REQUEST_REJECTED: &str = "RefactorKit daemon rejected the request.";
pub(super) const PARAMETER_REMOVAL_EFFECTS_MESSAGE: &str =
    "Removing this argument could remove a side effect. RefactorKit supports removing literals and reads of local variables or parameters when their bindings are known";

fn should_trace_rpc(method: &str, context_enabled: bool, editor_enabled: bool) -> bool {
    context_enabled
        && (matches!(
            method,
            "server.version"
                | "server.capabilities"
                | "project.summary"
                | "project.sync"
                | "project.context.aggregate"
                | "project.context"
                | "project.context.v6"
                | "project.context.v7"
                | "intelligence.query"
                | "refactor.preview"
                | "refactor.apply"
                | "refactor.rollback"
                | "patch.rollback"
                | "patch.recover"
        ) || (editor_enabled && method == "refactor.editor.preview"))
}

#[cfg(test)]
mod rpc_trace_tests {
    use super::should_trace_rpc;
    #[test]
    fn editor_buffer_requests_require_both_explicit_trace_options() {
        for (context, editor) in [(false, false), (false, true), (true, false)] {
            assert!(!should_trace_rpc(
                "refactor.editor.preview",
                context,
                editor
            ));
        }
        assert!(should_trace_rpc("refactor.editor.preview", true, true));
        assert!(should_trace_rpc("project.context.v7", true, false));
        assert!(!should_trace_rpc("project.context.v7", false, true));
        assert!(should_trace_rpc("patch.recover", true, false));
        assert!(!should_trace_rpc("patch.recover", false, true));
        assert!(!should_trace_rpc("unlisted.method", true, true));
    }
}

fn trace_transport_terminal(
    session: &mut Session,
    trace_rpc: bool,
    request_id: u64,
    method: &str,
    reason: &str,
    started: std::time::Instant,
    cancellation_sent_at: Option<std::time::Instant>,
) {
    if !trace_rpc {
        return;
    }
    let process = match session.child.try_wait() {
        Ok(Some(status)) => {
            json!({"state":"exited","success":status.success(),"code":status.code()})
        }
        Ok(None) => json!({"state":"running"}),
        Err(_) => json!({"state":"unknown"}),
    };
    super::java_project_context::trace_snapshot(
        "refactorkit.daemon.rpc.terminal",
        json!({
            "daemonPath": session.executable.display().to_string(),
            "daemonSha256": session.executable_sha256.clone(),
            "requestId": request_id,
            "method": method,
            "reason": reason,
            "elapsedMs": started.elapsed().as_millis(),
            "cancellationElapsedMs": cancellation_sent_at.map(|at| at.elapsed().as_millis()),
            "process": process,
        }),
    );
}

pub(super) struct Session {
    pub(super) workspace_id: String,
    pub(super) generation: u64,
    pub(super) root: PathBuf,
    pub(super) executable: PathBuf,
    pub(super) executable_sha256: Option<String>,
    pub(super) child: Child,
    pub(super) stdin: ChildStdin,
    pub(super) responses: Receiver<Result<Vec<u8>, ()>>,
    pub(super) next_id: u64,
    pub(super) capabilities: Option<ManagedCapabilityMetadata>,
}

pub(super) fn spawn_session(
    workspace_id: &str,
    generation: u64,
    root: &Path,
) -> Result<Session, String> {
    let executable = discover_daemon().ok_or_else(|| UNAVAILABLE.to_string())?;
    let executable_sha256 = (std::env::var("IDE_JAVA_CONTEXT_TRACE").as_deref() == Ok("1"))
        .then(|| {
            std::fs::read(&executable)
                .ok()
                .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
        })
        .flatten();
    let mut command = Command::new(executable);
    command
        .args([] as [&str; 0])
        .current_dir(root)
        .env_clear()
        .env("LANG", "C.UTF-8")
        .env("LC_ALL", "C.UTF-8")
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
    let mut child = command.spawn().map_err(|_| UNAVAILABLE.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| SESSION_FAILED.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SESSION_FAILED.to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| SESSION_FAILED.to_string())?;
    let (tx, responses) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::with_capacity(4096);
            let mut byte = [0_u8; 1];
            loop {
                match reader.read(&mut byte) {
                    Ok(0) => {
                        let _ = tx.send(Err(()));
                        return;
                    }
                    Ok(_) if byte[0] == b'\n' => break,
                    Ok(_) => {
                        if bytes.len() >= MAX_RESPONSE_BYTES {
                            let _ = tx.send(Err(()));
                            return;
                        }
                        bytes.push(byte[0]);
                    }
                    Err(_) => {
                        let _ = tx.send(Err(()));
                        return;
                    }
                }
            }
            if tx.send(Ok(bytes)).is_err() {
                return;
            }
        }
    });
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = stderr.read(&mut buffer) {
            if count == 0 {
                break;
            }
        }
    });
    Ok(Session {
        workspace_id: workspace_id.to_string(),
        generation,
        root: root.to_path_buf(),
        executable: command.get_program().into(),
        executable_sha256,
        child,
        stdin,
        responses,
        next_id: 0,
        capabilities: None,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SessionCallErrorKind {
    Session,
    Protocol,
    RequestTooLarge,
    Rejected,
}

#[derive(Eq, PartialEq)]
pub(super) struct SessionCallError {
    pub(super) kind: SessionCallErrorKind,
    pub(super) rpc_code: Option<i64>,
    pub(super) rpc_message: Option<String>,
    pub(super) rpc_refusal_code: Option<String>,
}

impl fmt::Debug for SessionCallError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionCallError")
            .field("kind", &self.kind)
            .field("rpc_code", &self.rpc_code)
            .field(
                "rpc_message",
                &self.rpc_message.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

pub(super) fn safe_rpc_error_message(value: Option<&Value>) -> Option<String> {
    let message = value?.as_str()?;
    let normalized = message
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    // This known refusal contains a slash. Translate the whole message so
    // arbitrary paths remain subject to the redaction below.
    if normalized.trim_end_matches('.')
        == "Removed call-site argument may have observable effects; only literals and exact JDT-bound local/parameter reads are supported"
    {
        return Some(PARAMETER_REMOVAL_EFFECTS_MESSAGE.into());
    }
    let lower = normalized.to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.contains('/')
        || normalized.contains('\\')
        || [
            "password",
            "secret",
            "credential",
            "token",
            "authorization",
            "api key",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
        || !normalized.chars().all(|character| {
            character.is_alphanumeric()
                || character.is_whitespace()
                || ".,:;()'_-.".contains(character)
        })
    {
        return None;
    }
    let mut characters = normalized.chars();
    let bounded = characters
        .by_ref()
        .take(MAX_RPC_ERROR_MESSAGE_CHARS)
        .collect::<String>();
    if characters.next().is_some() {
        Some(format!("{}…", bounded.trim_end()))
    } else {
        Some(bounded)
    }
}

impl SessionCallError {
    pub(super) fn message(self) -> &'static str {
        match self.kind {
            SessionCallErrorKind::Session => SESSION_FAILED,
            SessionCallErrorKind::Protocol => PROTOCOL_FAILED,
            SessionCallErrorKind::RequestTooLarge => {
                "RefactorKit daemon request exceeds the allowed size."
            }
            SessionCallErrorKind::Rejected => REQUEST_REJECTED,
        }
    }
}

pub(super) fn session_call(
    session: &mut Session,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    session_call_detailed(session, method, params, timeout)
        .map_err(|error| error.message().to_string())
}

pub(super) fn session_call_detailed(
    session: &mut Session,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, SessionCallError> {
    session_call_detailed_inner(session, method, params, timeout, None)
}

pub(super) fn session_call_detailed_cancellable(
    session: &mut Session,
    method: &str,
    params: Value,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<Value, SessionCallError> {
    if method != "intelligence.query" {
        return session_call_detailed(session, method, params, timeout);
    }
    let Some(request_id) = params
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
            rpc_message: None,
            rpc_refusal_code: None,
        });
    };
    session_call_detailed_inner(
        session,
        method,
        params,
        timeout,
        Some((cancelled, &request_id)),
    )
}

fn session_call_detailed_inner(
    session: &mut Session,
    method: &str,
    params: Value,
    timeout: Duration,
    cancellation: Option<(&AtomicBool, &str)>,
) -> Result<Value, SessionCallError> {
    if cancellation.is_some_and(|(flag, _)| flag.load(Ordering::SeqCst)) {
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Rejected,
            rpc_code: Some(-32800),
            rpc_message: None,
            rpc_refusal_code: None,
        });
    }
    session.next_id = session.next_id.checked_add(1).ok_or(SessionCallError {
        kind: SessionCallErrorKind::Session,
        rpc_code: None,
        rpc_message: None,
        rpc_refusal_code: None,
    })?;
    let id = session.next_id;
    let trace_rpc = should_trace_rpc(
        method,
        std::env::var("IDE_JAVA_CONTEXT_TRACE").as_deref() == Ok("1"),
        std::env::var("IDE_JAVA_EDITOR_TRACE").as_deref() == Ok("1"),
    );

    if trace_rpc {
        super::java_project_context::trace_snapshot(
            "refactorkit.daemon.rpc.request",
            json!({
                "daemonPath": session.executable.display().to_string(),
                "daemonSha256": session.executable_sha256.clone(),
                "requestId": id,
                "method": method,
                "params": params.clone(),
            }),
        );
    }
    let mut frame = serde_json::to_vec(&json!({
        "jsonrpc": "2.0", "id": id, "method": method, "params": params
    }))
    .map_err(|_| SessionCallError {
        kind: SessionCallErrorKind::Session,
        rpc_code: None,
        rpc_message: None,
        rpc_refusal_code: None,
    })?;
    if frame.len() > MAX_REQUEST_BYTES {
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::RequestTooLarge,
            rpc_code: None,
            rpc_message: None,
            rpc_refusal_code: None,
        });
    }
    frame.push(b'\n');
    if session.stdin.write_all(&frame).is_err() || session.stdin.flush().is_err() {
        trace_transport_terminal(
            session,
            trace_rpc,
            id,
            method,
            "request_write_failed",
            std::time::Instant::now(),
            None,
        );
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Session,
            rpc_code: None,
            rpc_message: None,
            rpc_refusal_code: None,
        });
    }
    let response_wait_started = std::time::Instant::now();
    let bytes = if let Some((cancelled, semantic_request_id)) = cancellation {
        let started = response_wait_started;
        let mut cancellation_sent_at = None;
        loop {
            if cancelled.load(Ordering::SeqCst) && cancellation_sent_at.is_none() {
                let mut notification = serde_json::to_vec(&json!({
                    "jsonrpc": "2.0",
                    "method": "intelligence.cancel",
                    "params": {"requestId": semantic_request_id}
                }))
                .map_err(|_| SessionCallError {
                    kind: SessionCallErrorKind::Protocol,
                    rpc_code: None,
                    rpc_message: None,
                    rpc_refusal_code: None,
                })?;
                notification.push(b'\n');
                if session.stdin.write_all(&notification).is_err() || session.stdin.flush().is_err()
                {
                    trace_transport_terminal(
                        session,
                        trace_rpc,
                        id,
                        method,
                        "cancellation_write_failed",
                        started,
                        cancellation_sent_at,
                    );
                    terminate(&mut session.child);
                    return Err(SessionCallError {
                        kind: SessionCallErrorKind::Session,
                        rpc_code: None,
                        rpc_message: None,
                        rpc_refusal_code: None,
                    });
                }
                cancellation_sent_at = Some(std::time::Instant::now());
                if trace_rpc {
                    super::java_project_context::trace_snapshot(
                        "refactorkit.daemon.rpc.cancel",
                        json!({
                            "daemonPath": session.executable.display().to_string(),
                            "daemonSha256": session.executable_sha256.clone(),
                            "requestId": id,
                            "method": method,
                            "semanticRequestId": semantic_request_id,
                            "elapsedMs": started.elapsed().as_millis(),
                            "notificationWritten": true,
                        }),
                    );
                }
            }
            let mut remaining = timeout.saturating_sub(started.elapsed());
            if let Some(sent_at) = cancellation_sent_at {
                let cancellation_remaining =
                    CANCELLATION_ACK_TIMEOUT.saturating_sub(sent_at.elapsed());
                remaining = remaining.min(cancellation_remaining);
            }
            if remaining.is_zero() {
                trace_transport_terminal(
                    session,
                    trace_rpc,
                    id,
                    method,
                    if cancellation_sent_at.is_some() {
                        "cancellation_deadline"
                    } else {
                        "request_timeout"
                    },
                    started,
                    cancellation_sent_at,
                );
                terminate(&mut session.child);
                return Err(SessionCallError {
                    kind: SessionCallErrorKind::Session,
                    rpc_code: None,
                    rpc_message: None,
                    rpc_refusal_code: None,
                });
            }
            match session
                .responses
                .recv_timeout(remaining.min(Duration::from_millis(25)))
            {
                Ok(Ok(bytes)) => break bytes,
                Ok(Err(())) | Err(RecvTimeoutError::Disconnected) => {
                    trace_transport_terminal(
                        session,
                        trace_rpc,
                        id,
                        method,
                        "response_stream_closed",
                        started,
                        cancellation_sent_at,
                    );
                    terminate(&mut session.child);
                    return Err(SessionCallError {
                        kind: SessionCallErrorKind::Session,
                        rpc_code: None,
                        rpc_message: None,
                        rpc_refusal_code: None,
                    });
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    } else {
        match session.responses.recv_timeout(timeout) {
            Ok(Ok(bytes)) => bytes,
            response => {
                let reason = match response {
                    Err(RecvTimeoutError::Timeout) => "request_timeout",
                    Err(RecvTimeoutError::Disconnected) | Ok(Err(())) => "response_stream_closed",
                    Ok(Ok(_)) => unreachable!("successful response handled above"),
                };
                trace_transport_terminal(
                    session,
                    trace_rpc,
                    id,
                    method,
                    reason,
                    std::time::Instant::now(),
                    None,
                );
                terminate(&mut session.child);
                return Err(SessionCallError {
                    kind: SessionCallErrorKind::Session,
                    rpc_code: None,
                    rpc_message: None,
                    rpc_refusal_code: None,
                });
            }
        }
    };
    let response: Value = serde_json::from_slice(&bytes).map_err(|_| {
        trace_transport_terminal(
            session,
            trace_rpc,
            id,
            method,
            "invalid_json_response",
            response_wait_started,
            None,
        );
        terminate(&mut session.child);
        SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
            rpc_message: None,
            rpc_refusal_code: None,
        }
    })?;
    let Some(object) = response.as_object() else {
        trace_transport_terminal(
            session,
            trace_rpc,
            id,
            method,
            "non_object_response",
            response_wait_started,
            None,
        );
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
            rpc_message: None,
            rpc_refusal_code: None,
        });
    };
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || object.get("id").and_then(Value::as_u64) != Some(id)
    {
        trace_transport_terminal(
            session,
            trace_rpc,
            id,
            method,
            "response_id_or_version_mismatch",
            response_wait_started,
            None,
        );
        if trace_rpc {
            super::java_project_context::trace_snapshot(
                "refactorkit.daemon.rpc.unmatchedResponse",
                json!({
                    "daemonPath": session.executable.display().to_string(),
                    "daemonSha256": session.executable_sha256.clone(),
                    "requestId": id,
                    "method": method,
                    "observedId": object.get("id"),
                    "observedJsonrpc": object.get("jsonrpc"),
                }),
            );
        }
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
            rpc_message: None,
            rpc_refusal_code: None,
        });
    }
    if trace_rpc {
        super::java_project_context::trace_snapshot(
            "refactorkit.daemon.rpc.response",
            json!({
                "daemonPath": session.executable.display().to_string(),
                "daemonSha256": session.executable_sha256.clone(),
                "requestId": id,
                "method": method,
                "response": response.clone(),
            }),
        );
    }
    if let Some(error) = object.get("error").filter(|value| !value.is_null()) {
        let Some(error) = error.as_object() else {
            terminate(&mut session.child);
            return Err(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
                rpc_message: None,
                rpc_refusal_code: None,
            });
        };
        let Some(rpc_code) = error.get("code").and_then(Value::as_i64) else {
            terminate(&mut session.child);
            return Err(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
                rpc_message: None,
                rpc_refusal_code: None,
            });
        };
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Rejected,
            rpc_code: Some(rpc_code),
            rpc_message: safe_rpc_error_message(error.get("message")),
            rpc_refusal_code: (!object.contains_key("result"))
                .then(|| error.get("data")?.get("refusalCode")?.as_str())
                .flatten()
                .filter(|code| {
                    !code.is_empty()
                        && code.len() <= 128
                        && code.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
                        })
                })
                .map(str::to_owned),
        });
    }
    match object.get("result").filter(|value| !value.is_null()) {
        Some(result) => {
            let result = result.clone();
            if trace_rpc && method == "server.capabilities" {
                let server_version = session_call_detailed_inner(
                    session,
                    "server.version",
                    json!({}),
                    timeout,
                    None,
                );
                super::java_project_context::trace_snapshot(
                    "refactorkit.daemon.server.version",
                    json!({
                        "daemonPath": session.executable.display().to_string(),
                        "daemonSha256": session.executable_sha256.clone(),
                        "version": server_version.ok(),
                    }),
                );
            }
            Ok(result)
        }
        None => {
            terminate(&mut session.child);
            Err(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
                rpc_message: None,
                rpc_refusal_code: None,
            })
        }
    }
}

pub(super) fn discover_daemon() -> Option<PathBuf> {
    if let Some(override_path) = env::var_os("IDE_REFACTORKIT_DAEMON") {
        let path = PathBuf::from(override_path);
        let allowed =
            cfg!(test) || env::var("IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE").as_deref() == Ok("1");
        if allowed && path.is_absolute() && executable(&path) {
            return path.canonicalize().ok();
        }
    }
    if let Some(refactorkit) = crate::commands::refactorkit::find_refactorkit_on_path() {
        if let Some(parent) = refactorkit.parent() {
            let sibling = parent.join(daemon_filename());
            if executable(&sibling) {
                return sibling.canonicalize().ok();
            }
        }
    }
    let canonical =
        crate::commands::refactorkit::standard_refactorkit_bin()?.join(daemon_filename());
    executable(&canonical)
        .then(|| canonical.canonicalize().ok())
        .flatten()
}
#[cfg(windows)]
pub(super) fn daemon_filename() -> &'static str {
    "refactorkit-daemon.exe"
}
#[cfg(not(windows))]
pub(super) fn daemon_filename() -> &'static str {
    DAEMON_NAME
}
pub(super) fn executable(path: &Path) -> bool {
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
pub(super) fn terminate(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
