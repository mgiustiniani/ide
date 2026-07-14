//! Owned daemon process and bounded NDJSON JSON-RPC transport.

use std::env;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use super::capability_policy::{ManagedCapabilityMetadata, UNAVAILABLE};
use super::contract::PROTOCOL_FAILED;

const DAEMON_NAME: &str = "refactorkit-daemon";
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const START_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024 + 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
pub(super) const SESSION_FAILED: &str = "RefactorKit daemon session failed safely.";
const REQUEST_REJECTED: &str = "RefactorKit daemon rejected the request.";

pub(super) struct Session {
    pub(super) workspace_id: String,
    pub(super) generation: u64,
    pub(super) root: PathBuf,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct SessionCallError {
    pub(super) kind: SessionCallErrorKind,
    pub(super) rpc_code: Option<i64>,
}

impl SessionCallError {
    fn message(self) -> &'static str {
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
    session.next_id = session.next_id.checked_add(1).ok_or(SessionCallError {
        kind: SessionCallErrorKind::Session,
        rpc_code: None,
    })?;
    let id = session.next_id;
    let mut frame = serde_json::to_vec(&json!({
        "jsonrpc": "2.0", "id": id, "method": method, "params": params
    }))
    .map_err(|_| SessionCallError {
        kind: SessionCallErrorKind::Session,
        rpc_code: None,
    })?;
    if frame.len() > MAX_REQUEST_BYTES {
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::RequestTooLarge,
            rpc_code: None,
        });
    }
    frame.push(b'\n');
    if session.stdin.write_all(&frame).is_err() || session.stdin.flush().is_err() {
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Session,
            rpc_code: None,
        });
    }
    let bytes = match session.responses.recv_timeout(timeout) {
        Ok(Ok(bytes)) => bytes,
        _ => {
            terminate(&mut session.child);
            return Err(SessionCallError {
                kind: SessionCallErrorKind::Session,
                rpc_code: None,
            });
        }
    };
    let response: Value = serde_json::from_slice(&bytes).map_err(|_| {
        terminate(&mut session.child);
        SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
        }
    })?;
    let Some(object) = response.as_object() else {
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
        });
    };
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || object.get("id").and_then(Value::as_u64) != Some(id)
    {
        terminate(&mut session.child);
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Protocol,
            rpc_code: None,
        });
    }
    if let Some(error) = object.get("error").filter(|value| !value.is_null()) {
        let Some(error) = error.as_object() else {
            terminate(&mut session.child);
            return Err(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
            });
        };
        let Some(rpc_code) = error.get("code").and_then(Value::as_i64) else {
            terminate(&mut session.child);
            return Err(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
            });
        };
        return Err(SessionCallError {
            kind: SessionCallErrorKind::Rejected,
            rpc_code: Some(rpc_code),
        });
    }
    match object.get("result").filter(|value| !value.is_null()) {
        Some(result) => Ok(result.clone()),
        None => {
            terminate(&mut session.child);
            Err(SessionCallError {
                kind: SessionCallErrorKind::Protocol,
                rpc_code: None,
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
    let home = env::var_os("HOME").map(PathBuf::from)?;
    let canonical = home
        .join(".local/share/refactorkit/bin")
        .join(daemon_filename());
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
