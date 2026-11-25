//! Linux PTY ownership is an OS session plus a captured process start time and TTY.
//! Commands can leave that OS session deliberately; this is lifecycle management, not confinement.
use super::super::workspace_registry::current_workspace_binding_is_current;
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    os::unix::fs::PermissionsExt,
    path::{Component, Path},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
const OUTPUT_LIMIT: usize = 1024 * 1024;
const READ_LIMIT: usize = 64 * 1024;
const INPUT_LIMIT: usize = 4096;
const MAX_SESSIONS: usize = 8;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
#[derive(Clone, Default)]
pub(super) struct Sessions(Arc<Mutex<Registry>>);
#[derive(Default)]
struct Registry {
    sessions: HashMap<String, Arc<Session>>,
    owner: Option<(CurrentWorkspaceBinding, Context)>,
}
struct Session {
    binding: CurrentWorkspaceBinding,
    context: Context,
    id: String,
    shell: String,
    cwd: String,
    owner: ProcessIdentity,
    runtime: Mutex<RuntimeState>,
    stopping: Mutex<()>,
    cancelled: AtomicBool,
}
struct RuntimeState {
    master: Option<Box<dyn MasterPty + Send>>,
    child: Box<dyn Child + Send + Sync>,
    output: VecDeque<u8>,
    cursor: u64,
    cols: u16,
    rows: u16,
    state: String,
    exit_code: Option<u32>,
    error: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct ProcessIdentity {
    pid: i32,
    start: u64,
    session: i32,
    tty: i64,
    state: char,
}
fn process_identity(pid: i32) -> Option<ProcessIdentity> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let tail = stat.rsplit_once(')')?.1;
    let fields: Vec<_> = tail.split_whitespace().collect();
    Some(ProcessIdentity {
        pid,
        state: fields.first()?.chars().next()?,
        session: fields.get(3)?.parse().ok()?,
        tty: fields.get(4)?.parse().ok()?,
        start: fields.get(19)?.parse().ok()?,
    })
}
fn same_owner(owner: &ProcessIdentity, member: &ProcessIdentity) -> bool {
    member.session == owner.pid && (member.tty == owner.tty || member.tty == 0) && owner.tty != 0
}
fn members(owner: &ProcessIdentity) -> Vec<ProcessIdentity> {
    if process_identity(owner.pid).is_some_and(|current| current.start != owner.start) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str()?.parse::<i32>().ok())
        .filter_map(process_identity)
        .filter(|member| same_owner(owner, member) && member.state != 'Z')
        .collect()
}
fn process_handle(pid: i32) -> Result<OwnedFd, String> {
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    if fd < 0 {
        return Err("Linux process handles are unavailable for terminal cleanup.".into());
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd as i32) })
}
pub(super) fn process_handles_available() -> bool {
    process_handle(std::process::id() as i32).is_ok()
}
fn signal(owner: &ProcessIdentity, member: &ProcessIdentity, sig: i32) -> Result<(), String> {
    // Pin the target before rechecking identity. pidfd_send_signal cannot hit a
    // replacement process if the original exits between the check and signal.
    let handle = match process_handle(member.pid) {
        Ok(handle) => handle,
        Err(_) if process_identity(member.pid).is_none() => return Ok(()),
        Err(error) => return Err(error),
    };
    if process_identity(member.pid)
        .is_some_and(|now| now.start == member.start && same_owner(owner, &now))
    {
        let result = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                handle.as_raw_fd(),
                sig,
                std::ptr::null::<libc::siginfo_t>(),
                0,
            )
        };
        if result < 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
            return Err("Cannot signal a process in the owned terminal session.".into());
        }
    }
    Ok(())
}
fn cleanup(owner: &ProcessIdentity) -> Result<(), String> {
    // Let the interactive shell reap foreground/background children before stopping the shell.
    for member in members(owner).into_iter().filter(|p| p.pid != owner.pid) {
        signal(owner, &member, libc::SIGTERM)?;
        signal(owner, &member, libc::SIGCONT)?;
    }
    let child_deadline = Instant::now() + Duration::from_millis(200);
    while Instant::now() < child_deadline && members(owner).iter().any(|p| p.pid != owner.pid) {
        thread::sleep(Duration::from_millis(10));
    }
    for member in members(owner) {
        signal(owner, &member, libc::SIGTERM)?;
        signal(owner, &member, libc::SIGCONT)?;
    }
    let deadline = Instant::now() + Duration::from_millis(500);
    while Instant::now() < deadline && !members(owner).is_empty() {
        thread::sleep(Duration::from_millis(10));
    }
    for member in members(owner) {
        signal(owner, &member, libc::SIGKILL)?;
    }
    let deadline = Instant::now() + Duration::from_millis(500);
    while Instant::now() < deadline && !members(owner).is_empty() {
        thread::sleep(Duration::from_millis(10));
    }
    if members(owner).is_empty() {
        Ok(())
    } else {
        Err("Some processes in the terminal OS session could not be stopped.".into())
    }
}
fn shell_path(path: &str) -> Result<String, String> {
    if path.len() > 4096 || !Path::new(path).is_absolute() {
        return Err("Choose an absolute executable shell path.".into());
    }
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|_| "The selected shell is unavailable.")?;
    let metadata = canonical
        .metadata()
        .map_err(|_| "The selected shell is unavailable.")?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return Err("The selected shell is not executable.".into());
    }
    canonical
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The selected shell path is not UTF-8.".into())
}
pub(super) fn default_shell() -> Result<String, String> {
    std::env::var("SHELL")
        .ok()
        .into_iter()
        .chain(["/bin/bash".into(), "/bin/sh".into()])
        .find_map(|path| shell_path(&path).ok())
        .ok_or_else(|| "No executable shell is available.".into())
}
fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=1000).contains(&cols) || !(1..=1000).contains(&rows) {
        return Err("Terminal dimensions are outside the supported range.".into());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}
impl Session {
    fn snapshot(&self, cursor: u64) -> Result<Snapshot, String> {
        let state = self
            .runtime
            .lock()
            .map_err(|_| "Terminal state is unavailable.")?;
        if cursor > state.cursor {
            return Err("Terminal output cursor is stale or invalid.".into());
        }
        let first = state.cursor - state.output.len() as u64;
        let start = cursor.max(first);
        let bytes: Vec<_> = state
            .output
            .iter()
            .skip((start - first) as usize)
            .take(READ_LIMIT)
            .copied()
            .collect();
        Ok(Snapshot {
            workspace_id: self.context.workspace_id.clone(),
            generation: self.context.generation,
            client_id: self.context.client_id.clone(),
            session_id: self.id.clone(),
            state: state.state.clone(),
            pid: self.owner.pid as u32,
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            cols: state.cols,
            rows: state.rows,
            data_base64: STANDARD.encode(&bytes),
            first_cursor: start,
            next_cursor: start + bytes.len() as u64,
            end_cursor: state.cursor,
            reset: cursor < first,
            exit_code: state.exit_code,
            error: state.error.clone(),
        })
    }
    fn stop(&self) -> Result<(), String> {
        let _stop = self
            .stopping
            .lock()
            .map_err(|_| "Terminal stop state is unavailable.")?;
        let was_running = self
            .runtime
            .lock()
            .map_err(|_| "Terminal state is unavailable.")?
            .state
            == "running";
        self.cancelled.store(true, Ordering::Release);
        let result = cleanup(&self.owner);
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Terminal state is unavailable.")?;
        let reap_deadline = Instant::now() + Duration::from_millis(500);
        loop {
            match runtime.child.try_wait() {
                Ok(Some(status)) => {
                    runtime.exit_code = Some(status.exit_code());
                    break;
                }
                Ok(None) if Instant::now() < reap_deadline => {
                    thread::sleep(Duration::from_millis(5))
                }
                Ok(None) => {
                    runtime.error =
                        Some("The shell has not exited; process cleanup is incomplete.".into());
                    runtime.state = "failed".into();
                    break;
                }
                Err(_) => {
                    runtime.error = Some("The shell exit status is unavailable.".into());
                    runtime.state = "failed".into();
                    break;
                }
            }
        }
        runtime.master.take();
        if (was_running || runtime.state == "running") && runtime.error.is_none() {
            runtime.state = if result.is_ok() { "stopped" } else { "failed" }.into();
        }
        if let Err(error) = &result {
            runtime.error = Some(error.clone());
            runtime.state = "failed".into();
        }
        result?;
        if runtime.state == "failed" {
            return Err(runtime
                .error
                .clone()
                .unwrap_or_else(|| "Terminal cleanup failed.".into()));
        }
        Ok(())
    }
}
impl Sessions {
    pub(super) fn claim(
        &self,
        binding: CurrentWorkspaceBinding,
        context: &Context,
    ) -> Result<(), String> {
        let mut registry = self
            .0
            .lock()
            .map_err(|_| "Terminal sessions are unavailable.")?;
        if registry
            .owner
            .as_ref()
            .is_some_and(|(root, owner)| *root == binding && owner == context)
        {
            return Ok(());
        }
        for session in registry.sessions.values() {
            session.stop()?;
        }
        registry.sessions.clear();
        registry.owner = Some((binding, context.clone()));
        Ok(())
    }

    pub(super) fn start(
        &self,
        binding: CurrentWorkspaceBinding,
        request: StartRequest,
    ) -> Result<Snapshot, String> {
        if !request.trusted {
            return Err("Trust this workspace before starting its shell.".into());
        }
        if request.context.generation == 0
            || request.context.generation > 9_007_199_254_740_991
            || request.context.workspace_id != binding.workspace_id
        {
            return Err("Terminal workspace authority is invalid.".into());
        }
        if !process_handles_available() {
            return Err("This Linux host cannot safely signal owned terminal processes.".into());
        }
        let dimensions = size(request.cols, request.rows)?;
        if request.cwd.len() > 4096
            || Path::new(&request.cwd)
                .components()
                .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
        {
            return Err("Choose a directory inside the workspace.".into());
        }
        let cwd = binding
            .canonical_root
            .join(&request.cwd)
            .canonicalize()
            .map_err(|_| "The terminal directory is unavailable.")?;
        if !cwd.starts_with(&binding.canonical_root) || !cwd.is_dir() {
            return Err("Choose a directory inside the workspace.".into());
        }
        let cwd_text = cwd
            .to_str()
            .ok_or("The terminal directory is not UTF-8.")?
            .to_owned();
        let shell = match request.shell {
            Some(path) => shell_path(&path)?,
            None => default_shell()?,
        };
        let mut sessions = self
            .0
            .lock()
            .map_err(|_| "Terminal sessions are unavailable.")?;
        if !sessions
            .owner
            .as_ref()
            .is_some_and(|(root, owner)| *root == binding && *owner == request.context)
        {
            return Err(
                "The terminal renderer authority is stale. Refresh the terminal provider.".into(),
            );
        }
        if sessions.sessions.len() >= MAX_SESSIONS {
            return Err(
                "Close a terminal before opening another; at most eight sessions are retained."
                    .into(),
            );
        }
        let pair = native_pty_system()
            .openpty(dimensions)
            .map_err(|_| "Cannot open a native PTY.")?;
        let mut command = CommandBuilder::new(&shell);
        command.arg("-i");
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| "Cannot start the selected shell.")?;
        drop(pair.slave);
        let setup = (|| {
            let pid = child
                .process_id()
                .ok_or("The shell process identity is unavailable.")? as i32;
            let deadline = Instant::now() + Duration::from_millis(300);
            let owner = loop {
                if let Some(owner) =
                    process_identity(pid).filter(|p| p.session == pid && p.tty != 0)
                {
                    break owner;
                }
                if Instant::now() >= deadline {
                    return Err("The shell did not create an owned OS session.");
                }
                thread::sleep(Duration::from_millis(5));
            };
            let fd = pair
                .master
                .as_raw_fd()
                .ok_or("The native PTY descriptor is unavailable.")?;
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err("Cannot configure nonblocking terminal input.");
            }
            let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 3) };
            if duplicate < 0 {
                return Err("Cannot duplicate the native PTY descriptor.");
            }
            Ok((owner, unsafe { OwnedFd::from_raw_fd(duplicate) }))
        })();
        let (owner, reader) = match setup {
            Ok(values) => values,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        let id = format!(
            "terminal-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        );
        let session = Arc::new(Session {
            binding,
            context: request.context,
            id: id.clone(),
            shell,
            cwd: cwd_text,
            owner,
            runtime: Mutex::new(RuntimeState {
                master: Some(pair.master),
                child,
                output: VecDeque::new(),
                cursor: 0,
                cols: request.cols,
                rows: request.rows,
                state: "running".into(),
                exit_code: None,
                error: None,
            }),
            stopping: Mutex::new(()),
            cancelled: AtomicBool::new(false),
        });
        sessions.sessions.insert(id, session.clone());
        let background = session.clone();
        thread::spawn(move || monitor(background, reader));
        session.snapshot(0)
    }
    fn get(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<Arc<Session>, String> {
        let sessions = self
            .0
            .lock()
            .map_err(|_| "Terminal sessions are unavailable.")?;
        let session = sessions
            .sessions
            .get(&request.session_id)
            .ok_or("This terminal session is unavailable.")?;
        if session.binding != *binding
            || session.context.workspace_id != request.context.workspace_id
            || session.context != request.context
        {
            return Err("The terminal request belongs to a stale workspace session.".into());
        }
        Ok(session.clone())
    }
    pub(super) fn read(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<Snapshot, String> {
        self.get(binding, request)?.snapshot(request.cursor)
    }
    pub(super) fn write(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &WriteRequest,
    ) -> Result<WriteResult, String> {
        if request.data_base64.len() > INPUT_LIMIT.div_ceil(3) * 4 {
            return Err("Terminal input exceeds the 4096-byte transport limit.".into());
        }
        let bytes = STANDARD
            .decode(&request.data_base64)
            .map_err(|_| "Terminal input is not valid Base64.")?;
        if bytes.is_empty() || bytes.len() > INPUT_LIMIT {
            return Err("Terminal input must contain between one and 4096 bytes.".into());
        }
        let session = self.get(binding, &request.session)?;
        let runtime = session
            .runtime
            .lock()
            .map_err(|_| "Terminal state is unavailable.")?;
        if session.cancelled.load(Ordering::Acquire) || runtime.state != "running" {
            return Err("This terminal is no longer running.".into());
        }
        let fd = runtime
            .master
            .as_ref()
            .and_then(|m| m.as_raw_fd())
            .ok_or("The terminal input is unavailable.")?;
        let accepted = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
        let accepted_bytes = if accepted < 0 {
            let error = std::io::Error::last_os_error();
            if matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
            ) {
                0
            } else {
                return Err("Cannot write to the terminal process.".into());
            }
        } else {
            accepted as usize
        };
        Ok(WriteResult {
            workspace_id: session.context.workspace_id.clone(),
            generation: session.context.generation,
            client_id: session.context.client_id.clone(),
            session_id: session.id.clone(),
            accepted_bytes,
        })
    }
    pub(super) fn resize(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &ResizeRequest,
    ) -> Result<Snapshot, String> {
        let dimensions = size(request.cols, request.rows)?;
        let session = self.get(binding, &request.session)?;
        {
            let mut runtime = session
                .runtime
                .lock()
                .map_err(|_| "Terminal state is unavailable.")?;
            if session.cancelled.load(Ordering::Acquire) || runtime.state != "running" {
                return Err("This terminal is no longer running.".into());
            }
            runtime
                .master
                .as_ref()
                .ok_or("The terminal is unavailable.")?
                .resize(dimensions)
                .map_err(|_| "Cannot resize the native PTY.")?;
            runtime.cols = request.cols;
            runtime.rows = request.rows;
        }
        session.snapshot(request.session.cursor)
    }
    pub(super) fn stop(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<Snapshot, String> {
        let session = self.get(binding, request)?;
        session.stop()?;
        session.snapshot(request.cursor)
    }
    pub(super) fn close(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<(), String> {
        let session = self.get(binding, request)?;
        session.stop()?;
        self.0
            .lock()
            .map_err(|_| "Terminal sessions are unavailable.")?
            .sessions
            .remove(&request.session_id);
        Ok(())
    }
    pub(super) fn shutdown_all(&self) {
        let sessions = match self.0.lock() {
            Ok(mut sessions) => {
                sessions.owner = None;
                std::mem::take(&mut sessions.sessions)
            }
            Err(_) => return,
        };
        for session in sessions.into_values() {
            let _ = session.stop();
        }
    }
}
fn monitor(session: Arc<Session>, reader: OwnedFd) {
    let mut bytes = [0_u8; 8192];
    let mut last_authority_check = Instant::now();
    loop {
        if session.cancelled.load(Ordering::Acquire) {
            break;
        }
        if last_authority_check.elapsed() > Duration::from_millis(250) {
            if !current_workspace_binding_is_current(&session.binding) {
                let _ = session.stop();
                break;
            }
            last_authority_check = Instant::now();
        }
        let count =
            unsafe { libc::read(reader.as_raw_fd(), bytes.as_mut_ptr().cast(), bytes.len()) };
        let mut runtime = match session.runtime.lock() {
            Ok(state) => state,
            Err(_) => break,
        };
        if count > 0 {
            let count = count as usize;
            runtime.output.extend(&bytes[..count]);
            runtime.cursor += count as u64;
            while runtime.output.len() > OUTPUT_LIMIT {
                runtime.output.pop_front();
            }
        } else if count < 0 {
            let error = std::io::Error::last_os_error();
            if !matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
            ) && error.raw_os_error() != Some(libc::EIO)
            {
                runtime.error = Some("Cannot read native terminal output.".into());
                runtime.state = "failed".into();
                drop(runtime);
                let _ = session.stop();
                break;
            }
        }
        match runtime.child.try_wait() {
            Ok(Some(status)) => {
                runtime.exit_code = Some(status.exit_code());
                runtime.state = "exited".into();
                // Drain bytes already queued after exit before releasing the PTY.
                for _ in 0..(READ_LIMIT / bytes.len()) {
                    let n = unsafe {
                        libc::read(reader.as_raw_fd(), bytes.as_mut_ptr().cast(), bytes.len())
                    };
                    if n <= 0 {
                        break;
                    }
                    runtime.output.extend(&bytes[..n as usize]);
                    runtime.cursor += n as u64;
                    while runtime.output.len() > OUTPUT_LIMIT {
                        runtime.output.pop_front();
                    }
                }
                drop(runtime);
                let _ = session.stop();
                break;
            }
            Ok(None) => {}
            Err(_) => {
                runtime.error = Some("The shell exit status is unavailable.".into());
                runtime.state = "failed".into();
                drop(runtime);
                let _ = session.stop();
                break;
            }
        }
        drop(runtime);
        if count <= 0 {
            thread::sleep(Duration::from_millis(15));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        root: std::path::PathBuf,
        registry: std::path::PathBuf,
        binding: CurrentWorkspaceBinding,
        sessions: Sessions,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "ide-pty-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(root.join("nested")).unwrap();
            let registry = root.join("registry.json");
            fs::write(&registry, serde_json::to_vec(&serde_json::json!({"version":1,"currentWorkspaceId":"pty","workspaces":[{"id":"pty","name":"PTY","rootPath":root}]})).unwrap()).unwrap();
            let binding = current_workspace_binding_at(&root, &registry).unwrap();
            let sessions = Sessions::default();
            sessions
                .claim(
                    binding.clone(),
                    &Context {
                        workspace_id: "pty".into(),
                        generation: 1,
                        client_id: "test-client".into(),
                    },
                )
                .unwrap();
            Self {
                root,
                registry,
                binding,
                sessions,
            }
        }
        fn request(&self, id: &str) -> SessionRequest {
            SessionRequest {
                context: Context {
                    workspace_id: "pty".into(),
                    generation: 1,
                    client_id: "test-client".into(),
                },
                session_id: id.into(),
                cursor: 0,
            }
        }
        fn start(&self) -> Snapshot {
            self.sessions
                .start(
                    self.binding.clone(),
                    StartRequest {
                        context: Context {
                            workspace_id: "pty".into(),
                            generation: 1,
                            client_id: "test-client".into(),
                        },
                        trusted: true,
                        cwd: ".".into(),
                        shell: Some("/bin/bash".into()),
                        cols: 91,
                        rows: 27,
                    },
                )
                .unwrap()
        }
        fn input(&self, id: &str, text: &str) {
            let mut bytes = text.as_bytes();
            let deadline = Instant::now() + Duration::from_secs(5);
            while !bytes.is_empty() {
                assert!(Instant::now() < deadline, "terminal input deadline");
                let n = self
                    .sessions
                    .write(
                        &self.binding,
                        &WriteRequest {
                            session: self.request(id),
                            data_base64: STANDARD.encode(&bytes[..bytes.len().min(INPUT_LIMIT)]),
                        },
                    )
                    .unwrap()
                    .accepted_bytes;
                bytes = &bytes[n..];
                if n == 0 {
                    thread::sleep(Duration::from_millis(10));
                }
            }
        }
        fn wait_text(&self, id: &str, expected: &str) -> String {
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut cursor = 0;
            let mut output = Vec::new();
            loop {
                let mut request = self.request(id);
                request.cursor = cursor;
                let snapshot = self.sessions.read(&self.binding, &request).unwrap();
                cursor = snapshot.next_cursor;
                output.extend(STANDARD.decode(snapshot.data_base64).unwrap());
                let text = String::from_utf8_lossy(&output).into_owned();
                if text.contains(expected) {
                    return text;
                }
                assert!(Instant::now() < deadline, "missing {expected:?}: {text}");
                thread::sleep(Duration::from_millis(15));
            }
        }
        fn pid(&self, name: &str) -> i32 {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(text) = fs::read_to_string(self.root.join(name)) {
                    if let Ok(pid) = text.trim().parse() {
                        return pid;
                    }
                }
                assert!(Instant::now() < deadline, "missing PID {name}");
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.sessions.shutdown_all();
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn gone(pid: i32) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while process_identity(pid).is_some() {
            assert!(
                Instant::now() < deadline,
                "owned process {pid} survived: {:?}",
                process_identity(pid)
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn refuses_untrusted_shell_outside_paths_and_invalid_dimensions_before_spawning() {
        let fixture = Fixture::new();
        for (trusted, cwd, cols) in [
            (false, ".", 80),
            (true, "../", 80),
            (true, "/tmp", 80),
            (true, ".", 0),
        ] {
            assert!(fixture
                .sessions
                .start(
                    fixture.binding.clone(),
                    StartRequest {
                        context: Context {
                            workspace_id: "pty".into(),
                            generation: 1,
                            client_id: "test-client".into()
                        },
                        trusted,
                        cwd: cwd.into(),
                        shell: Some("/bin/bash".into()),
                        cols,
                        rows: 24
                    }
                )
                .is_err());
        }
        assert!(fixture.sessions.0.lock().unwrap().sessions.is_empty());
    }
    #[test]
    fn process_ownership_requires_the_original_session_and_original_or_revoked_terminal() {
        let owner = ProcessIdentity {
            pid: 42,
            start: 91,
            session: 42,
            tty: 1234,
            state: 'S',
        };
        let mut member = owner.clone();
        member.pid = 43;
        assert!(same_owner(&owner, &member));
        member.session = 99;
        assert!(!same_owner(&owner, &member));
        member.session = 42;
        member.tty = 5678;
        assert!(!same_owner(&owner, &member));
        member.tty = 0;
        assert!(same_owner(&owner, &member));
    }
    #[test]
    fn native_requests_have_closed_nested_contexts() {
        let valid = serde_json::json!({"context":{"workspaceId":"pty","generation":1,"clientId":"test-client"},"trusted":true,"cwd":".","shell":null,"cols":80,"rows":24});
        assert!(serde_json::from_value::<StartRequest>(valid.clone()).is_ok());
        let mut invalid = valid;
        invalid["context"]["unexpected"] = true.into();
        assert!(serde_json::from_value::<StartRequest>(invalid).is_err());
    }
    #[test]
    #[ignore = "Runs a real Linux PTY, shell, JDK, and owned process signals"]
    fn real_pty_preserves_shell_state_java_resize_ctrl_c_and_owned_job_cleanup() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("Main.java"), "class Main { public static void main(String[] args) { System.out.println(\"JAVA_PTY_こんにちは😀\"); } }\n").unwrap();
        let first = fixture.start();
        let id = &first.session_id;
        fixture.input(id, "stty -echo; printf 'READY_%s\\n' PTY\r");
        fixture.wait_text(id, "READY_PTY");
        fixture.input(id, "test -t 0 && test -t 1 && printf 'IS_%s\\n' TTY; stty size; cd nested; export PTY_STATE=kept; pwd; javac ../Main.java && java -cp .. Main; printf 'STATE_%s\\n' \"$PTY_STATE\"\r");
        let text = fixture.wait_text(id, "STATE_kept");
        assert!(text.contains("IS_TTY"));
        assert!(text.contains("27 91"));
        assert!(text.contains("JAVA_PTY_こんにちは😀"));
        assert!(text.contains(fixture.root.join("nested").to_str().unwrap()));
        let resized = fixture
            .sessions
            .resize(
                &fixture.binding,
                &ResizeRequest {
                    session: fixture.request(id),
                    cols: 103,
                    rows: 31,
                },
            )
            .unwrap();
        assert_eq!((resized.cols, resized.rows), (103, 31));
        fixture.input(id, "stty size; printf 'RESIZED_%s\\n' OK\r");
        assert!(fixture.wait_text(id, "RESIZED_OK").contains("31 103"));
        fixture.input(id, "sh -c 'echo $$ > ../fg.pid; exec sleep 30'\r");
        let foreground = fixture.pid("fg.pid");
        fixture.input(id, "\u{3}");
        fixture.input(id, "printf 'AFTER_%s\\n' CTRL\r");
        fixture.wait_text(id, "AFTER_CTRL");
        gone(foreground);
        fixture.input(
            id,
            "sleep 60 & echo $! > ../bg.pid; printf 'BG_%s\\n' READY\r",
        );
        fixture.wait_text(id, "BG_READY");
        let background = fixture.pid("bg.pid");
        let mut stale = fixture.request(id);
        stale.context.generation = 2;
        assert!(fixture
            .sessions
            .write(
                &fixture.binding,
                &WriteRequest {
                    session: stale,
                    data_base64: STANDARD.encode(b"x")
                }
            )
            .is_err());
        let stopped = fixture
            .sessions
            .stop(&fixture.binding, &fixture.request(id))
            .unwrap();
        assert_eq!(stopped.state, "stopped");
        gone(first.pid as i32);
        gone(background);
        assert!(fixture
            .sessions
            .write(
                &fixture.binding,
                &WriteRequest {
                    session: fixture.request(id),
                    data_base64: STANDARD.encode(b"x")
                }
            )
            .is_err());
        let second = fixture.start();
        fixture.input(
            &second.session_id,
            "stty -echo; sleep 60 & echo $! > exit-bg.pid; exit 7\r",
        );
        let orphan = fixture.pid("exit-bg.pid");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let result = fixture
                .sessions
                .read(&fixture.binding, &fixture.request(&second.session_id))
                .unwrap();
            if result.state == "exited" {
                assert_eq!(result.exit_code, Some(7));
                break;
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        gone(second.pid as i32);
        gone(orphan);
    }
    #[test]
    #[ignore = "Runs a real Linux PTY and exercises nonblocking queue saturation and root revocation"]
    fn real_pty_bounds_output_keeps_stop_available_under_input_backpressure_and_revokes_changed_root(
    ) {
        let fixture = Fixture::new();
        let first = fixture.start();
        let id = &first.session_id;
        fixture.input(
            id,
            "stty -echo; head -c 1200000 /dev/zero | tr '\\0' x; printf 'OUTPUT_%s\\n' DONE\r",
        );
        fixture.wait_text(id, "OUTPUT_DONE");
        let result = fixture
            .sessions
            .read(&fixture.binding, &fixture.request(id))
            .unwrap();
        assert!(result.reset);
        assert!(result.first_cursor > 0);
        assert!(STANDARD.decode(result.data_base64).unwrap().len() <= READ_LIMIT);
        let owner = process_identity(first.pid as i32).unwrap();
        signal(&owner, &owner, libc::SIGSTOP).unwrap();
        let start = Instant::now();
        let mut blocked = false;
        for _ in 0..512 {
            if fixture
                .sessions
                .write(
                    &fixture.binding,
                    &WriteRequest {
                        session: fixture.request(id),
                        data_base64: STANDARD.encode(vec![b'a'; INPUT_LIMIT]),
                    },
                )
                .unwrap()
                .accepted_bytes
                == 0
            {
                blocked = true;
                break;
            }
        }
        assert!(
            blocked,
            "PTY input should reach backpressure while the shell is stopped"
        );
        assert!(start.elapsed() < Duration::from_secs(2));
        let start = Instant::now();
        fixture
            .sessions
            .stop(&fixture.binding, &fixture.request(id))
            .unwrap();
        assert!(start.elapsed() < Duration::from_secs(3));
        gone(first.pid as i32);
        let second = fixture.start();
        fixture.input(
            &second.session_id,
            "stty -echo; sleep 60 & echo $! > revoke-bg.pid; printf 'REVOKE_%s\\n' READY\r",
        );
        fixture.wait_text(&second.session_id, "REVOKE_READY");
        let background = fixture.pid("revoke-bg.pid");
        fs::write(
            &fixture.registry,
            serde_json::to_vec(
                &serde_json::json!({"version":1,"currentWorkspaceId":null,"workspaces":[]}),
            )
            .unwrap(),
        )
        .unwrap();
        gone(second.pid as i32);
        gone(background);
    }
}
