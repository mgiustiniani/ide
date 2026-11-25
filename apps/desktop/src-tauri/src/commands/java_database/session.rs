//! A workspace owns one JDBC worker and one physical connection until explicit close.
use super::*;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader},
    process::{Child, ChildStdin},
    sync::{mpsc, Arc, Mutex},
    thread::JoinHandle,
};
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    workspace_id: String,
    generation: u64,
    request_id: String,
    session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    #[serde(flatten)]
    scope: Scope,
    sql: String,
    parameters: Option<Vec<JavaDatabaseParameter>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    #[serde(flatten)]
    scope: Scope,
    action: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Close {
    #[serde(flatten)]
    scope: Scope,
    allow_rollback: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerState {
    auto_commit: bool,
    supports_transactions: bool,
    ddl_causes_commit: bool,
    statements_since_boundary: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    session_id: String,
    #[serde(flatten)]
    state: WorkerState,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    sequence: u64,
    session: WorkerState,
    result: Option<Value>,
    error: Option<String>,
    sql_state: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaResult {
    #[serde(flatten)]
    metadata: JavaDatabaseConnectionResult,
    session: Info,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    #[serde(flatten)]
    query: JavaDatabaseQueryResult,
    session: Info,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResult {
    #[serde(flatten)]
    result: QueryResult,
    plan_dialect: EstimatedPlanDialect,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgePlanResult {
    plan_dialect: EstimatedPlanDialect,
    query: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult {
    #[serde(flatten)]
    scope: Scope,
    session: Info,
    outcome: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseResult {
    #[serde(flatten)]
    scope: Scope,
    closed: bool,
    rollback_confirmed: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cancellation {
    workspace_id: String,
    generation: u64,
    request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connection_request_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancellationResult {
    #[serde(flatten)]
    request: Cancellation,
    stopped: bool,
    outcome: &'static str,
}

struct Job {
    operation: String,
    fields: Vec<u8>,
    reply: mpsc::Sender<Result<(Value, Info), String>>,
}
struct Handle {
    id: String,
    connection_request_id: String,
    binding: crate::commands::workspace_registry::CurrentWorkspaceBinding,
    epoch: u64,
    cancel: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    info: Arc<Mutex<Option<WorkerState>>>,
    sender: mpsc::Sender<Job>,
    join: Mutex<Option<JoinHandle<()>>>,
}
impl Handle {
    fn stop(&self) {
        self.cancel.store(true, Ordering::Release);
        if let Ok(mut join) = self.join.lock() {
            if let Some(join) = join.take() {
                let _ = join.join();
            }
        }
    }
    fn info(&self) -> Result<Info, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("The JDBC connection is closed; reconnect before continuing.".into());
        }
        let state = self
            .info
            .lock()
            .map_err(|_| "JDBC connection state is unavailable.")?
            .clone()
            .ok_or("The JDBC connection is still opening.")?;
        Ok(Info {
            session_id: self.id.clone(),
            state,
        })
    }
    fn transition_reason(&self) -> Option<String> {
        if self.stopped.load(Ordering::Acquire) {
            return None;
        }
        if self.busy.load(Ordering::Acquire) {
            return Some("Wait for the database operation to finish before switching workspace or closing the IDE.".into());
        }
        if self
            .info()
            .is_ok_and(|info| !info.state.auto_commit && info.state.statements_since_boundary > 0)
        {
            return Some("Commit or roll back the database transaction before switching workspace or closing the IDE.".into());
        }
        None
    }
    fn request(&self, operation: &str, fields: Vec<u8>) -> Result<(Value, Info), String> {
        let (reply, receive) = mpsc::channel();
        if self
            .sender
            .send(Job {
                operation: operation.into(),
                fields,
                reply,
            })
            .is_err()
        {
            self.busy.store(false, Ordering::Release);
            return Err("The JDBC connection is closed.".into());
        }
        match receive.recv_timeout(OPERATION_TIMEOUT + Duration::from_secs(2)) {
            Ok(result) => result,
            Err(_) => {
                self.stop();
                Err("The JDBC session did not confirm a response; check database state before retrying.".into())
            }
        }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone, Default)]
pub struct JavaDatabaseSessionState {
    active: Arc<Mutex<Option<Arc<Handle>>>>,
    cancelled_openings: Arc<Mutex<Vec<(u64, String, String)>>>,
}
impl JavaDatabaseSessionState {
    pub fn transition_allowed(&self) -> Result<(), String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Database session state is unavailable.")?;
        if let Some(reason) = active
            .as_ref()
            .and_then(|handle| handle.transition_reason())
        {
            return Err(reason);
        }
        Ok(())
    }
    pub fn shutdown_all(&self) {
        if let Ok(mut cancelled) = self.cancelled_openings.lock() {
            cancelled.clear();
        }
        if let Ok(mut active) = self.active.lock() {
            if let Some(handle) = active.take() {
                handle.stop();
            }
        }
    }
    fn cancel_request(
        &self,
        request: &Cancellation,
        binding: &crate::commands::workspace_registry::CurrentWorkspaceBinding,
        epoch: u64,
    ) -> Result<(), String> {
        let handle = super::super::workspace_registry::with_root_activation(|| {
            if request.workspace_id != binding.workspace_id
                || epoch != super::super::workspace_registry::active_workspace_generation()
                || !current_workspace_binding_is_current(binding)
            {
                return Err(
                    "The JDBC stop request does not belong to the active workspace.".to_owned(),
                );
            }
            let handle = self
                .active
                .lock()
                .map_err(|_| "Database session state is unavailable.")?
                .as_ref()
                .cloned();
            let matched = handle.filter(|handle| {
                handle.binding == *binding
                    && handle.epoch == epoch
                    && (request
                        .session_id
                        .as_ref()
                        .is_some_and(|id| id == &handle.id)
                        || request
                            .connection_request_id
                            .as_ref()
                            .is_some_and(|id| id == &handle.connection_request_id))
            });
            if let Some(handle) = matched {
                handle.busy.store(true, Ordering::Release);
                handle.cancel.store(true, Ordering::Release);
                return Ok(Some(handle));
            }
            if let Some(id) = &request.connection_request_id {
                // A stop can overtake startup on the native executor. Refuse that queued startup
                // rather than acknowledging cancellation and letting it open afterward.
                let key = (epoch, binding.workspace_id.clone(), id.clone());
                let mut cancelled = self
                    .cancelled_openings
                    .lock()
                    .map_err(|_| "Database cancellation state is unavailable.")?;
                cancelled.retain(|entry| entry.0 == epoch);
                if !cancelled.contains(&key) {
                    if cancelled.len() >= 64 {
                        return Err("Too many JDBC startup cancellations are pending.".into());
                    }
                    cancelled.push(key);
                }
                return Ok(None);
            }
            Err("The requested JDBC session is no longer available.".into())
        })?;
        if let Some(handle) = handle {
            handle.stop();
            if !handle.stopped.load(Ordering::Acquire) {
                return Err("The JDBC worker has not confirmed termination.".into());
            }
            self.retire(&handle.id);
        }
        Ok(())
    }

    fn retire(&self, id: &str) {
        super::result_export::clear_session(id);
        let removed = self.active.lock().ok().and_then(|mut active| {
            if active.as_ref().is_some_and(|handle| handle.id == id) {
                active.take()
            } else {
                None
            }
        });
        if let Some(handle) = removed {
            handle.stop();
        }
    }
    fn handle(&self, scope: &Scope) -> Result<Arc<Handle>, String> {
        let handle = self
            .active
            .lock()
            .map_err(|_| "Database session state is unavailable.")?
            .as_ref()
            .cloned()
            .ok_or("The JDBC connection is closed; reconnect before continuing.")?;
        if handle.id != scope.session_id
            || handle.binding.workspace_id != scope.workspace_id
            || handle.epoch != super::super::workspace_registry::active_workspace_generation()
            || !current_workspace_binding_is_current(&handle.binding)
            || handle.stopped.load(Ordering::Acquire)
            || handle.cancel.load(Ordering::Acquire)
        {
            return Err("The JDBC connection no longer belongs to this active workspace.".into());
        }
        Ok(handle)
    }
    fn reserve(&self, scope: &Scope, operation: &str) -> Result<Arc<Handle>, String> {
        super::super::workspace_registry::with_root_activation(|| {
            let handle = self.handle(scope)?;
            let info = handle.info()?;
            if operation == "auto-commit" && info.state.statements_since_boundary > 0 {
                return Err("Commit or roll back before enabling auto-commit.".into());
            }
            if operation == "begin"
                && (!info.state.auto_commit || !info.state.supports_transactions)
            {
                return Err("This connection cannot begin another manual transaction.".into());
            }
            if matches!(operation, "commit" | "rollback") && info.state.auto_commit {
                return Err("Begin a manual transaction first.".into());
            }
            if handle
                .busy
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return Err("Another database operation is running.".into());
            }
            if matches!(operation, "execute" | "explain") {
                if let Ok(mut info) = handle.info.lock() {
                    if let Some(info) = info.as_mut() {
                        if !info.auto_commit {
                            info.statements_since_boundary = info
                                .statements_since_boundary
                                .saturating_add(1)
                                .min(1_000_000);
                        }
                    }
                }
            }
            Ok(handle)
        })
    }
}

struct Transport {
    child: Child,
    stdin: Option<ChildStdin>,
    frames: Option<mpsc::Receiver<Result<Vec<u8>, String>>>,
    reader: Option<JoinHandle<()>>,
    errors: Option<JoinHandle<()>>,
    sequence: u64,
    initial: Option<Envelope>,
    _temporary: TemporaryBridgeDirectory,
}
impl Drop for Transport {
    fn drop(&mut self) {
        stop_child(&mut self.child);
        self.stdin.take();
        self.frames.take();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if let Some(errors) = self.errors.take() {
            let _ = errors.join();
        }
    }
}
fn frame(reader: &mut impl BufRead) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .map_err(|_| "The JDBC session output failed.")?;
        if available.is_empty() {
            return Err("The JDBC session ended before a confirmed response; check database state before retrying.".into());
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let count = newline.map_or(available.len(), |index| index + 1);
        if result.len() + count > MAX_BRIDGE_OUTPUT {
            return Err("The JDBC session response exceeded its limit.".into());
        }
        result.extend_from_slice(&available[..count]);
        reader.consume(count);
        if newline.is_some() {
            return Ok(result);
        }
    }
}
impl Transport {
    fn terminate(&mut self) {
        #[cfg(unix)]
        {
            // Give JVM/database shutdown hooks a bounded chance to flush their state. A confirmed
            // process exit is still not proof of a JDBC commit or rollback outcome.
            unsafe {
                libc::kill(self.child.id() as i32, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if self.child.try_wait().ok().flatten().is_some() || Instant::now() >= deadline {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        stop_child(&mut self.child);
    }

    fn receive(
        &mut self,
        cancel: &AtomicBool,
        timeout: Duration,
        sequence: u64,
    ) -> Result<Envelope, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err("The JDBC session was closed.".into());
            }
            if Instant::now() >= deadline {
                return Err(
                    "The JDBC session operation timed out; check database state before retrying."
                        .into(),
                );
            }
            match self
                .frames
                .as_ref()
                .ok_or("The JDBC session is closed.")?
                .recv_timeout(Duration::from_millis(20))
            {
                Ok(result) => {
                    let reply: Envelope = serde_json::from_slice(&result?)
                        .map_err(|_| "The JDBC session returned invalid result data.")?;
                    if reply.sequence != sequence
                        || reply.result.is_some() == reply.error.is_some()
                        || reply.session.statements_since_boundary > 1_000_000
                    {
                        return Err("The JDBC session response does not match its request.".into());
                    }
                    return Ok(reply);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => {
                    return Err(
                        "The JDBC session is closed; its last database outcome is not confirmed."
                            .into(),
                    )
                }
            }
        }
    }
    fn rpc(
        &mut self,
        cancel: &AtomicBool,
        operation: &str,
        fields: Vec<u8>,
        timeout: Duration,
    ) -> Result<Envelope, String> {
        let deadline = Instant::now() + timeout;
        self.sequence += 1;
        let mut bytes = format!("{}\n{operation}\n", self.sequence).into_bytes();
        bytes.extend(fields);
        let mut stdin = self
            .stdin
            .take()
            .ok_or("The JDBC session input is closed.")?;
        let writer = thread::spawn(move || {
            let result = stdin.write_all(&bytes);
            (stdin, result)
        });
        let mut reply = self.receive(cancel, timeout, self.sequence);
        if reply.is_err() {
            self.terminate();
        }
        // Even a complete early response cannot remove the deadline from a blocked input writer.
        while !writer.is_finished() {
            if cancel.load(Ordering::Acquire) || Instant::now() >= deadline {
                reply = Err("The JDBC session input was not confirmed within its deadline; check database state before retrying.".into());
                self.terminate();
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        let (stdin, written) = writer
            .join()
            .map_err(|_| "The JDBC session input failed.")?;
        self.stdin = Some(stdin);
        written.map_err(|_| "The JDBC session did not accept its request.")?;
        reply
    }
}
fn start_transport(
    authorized: &AuthorizedRequest,
    request: &JavaDatabaseConnectionInput,
    cancel: &AtomicBool,
) -> Result<Transport, String> {
    let temporary = prepare_bridge(authorized, Some(cancel))?;
    let captured = temporary.path.join("driver.jar");
    let mut original =
        fs::File::open(&authorized.driver_jar).map_err(|_| "The JDBC driver is unavailable.")?;
    let before = original
        .metadata()
        .map_err(|_| "The JDBC driver is unavailable.")?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut copy = options
        .open(&captured)
        .map_err(|_| "Cannot capture the selected JDBC driver.")?;
    let copied = std::io::copy(
        &mut Read::by_ref(&mut original).take(MAX_DRIVER_BYTES + 1),
        &mut copy,
    )
    .map_err(|_| "Cannot capture the selected JDBC driver.")?;
    let after = original
        .metadata()
        .map_err(|_| "Cannot inspect the selected JDBC driver.")?;
    if copied > MAX_DRIVER_BYTES
        || copied != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err("The selected JDBC driver changed while opening the connection.".into());
    }
    drop(copy);
    if cancel.load(Ordering::Acquire) {
        return Err("The JDBC connection opening was cancelled.".into());
    }
    let class_path = std::env::join_paths([temporary.path.as_os_str(), captured.as_os_str()])
        .map_err(|_| "The JDBC class path is invalid.")?;
    let mut command = Command::new(
        authorized
            .jdk_home
            .join("bin")
            .join(executable_name("java")),
    );
    command
        .args([
            "-Xms16m",
            "-Xmx256m",
            "-XX:MaxMetaspaceSize=128m",
            "-Dfile.encoding=UTF-8",
            "-cp",
        ])
        .arg(class_path)
        .args(["IdeDatabaseBridge", "session"]);
    restrict_process_environment(&mut command, authorized, &temporary.path);
    configure_owned_process(&mut command);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "The JDBC worker could not be started.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("The JDBC worker has no output pipe.")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("The JDBC worker has no error pipe.")?;
    let stdin = child.stdin.take();
    let (sender, frames) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let result = frame(&mut reader);
            let failed = result.is_err();
            if sender.send(result).is_err() || failed {
                break;
            }
        }
    });
    let errors = thread::spawn(move || {
        let _ = bounded_read(stderr, MAX_BRIDGE_ERROR);
    });
    let mut transport = Transport {
        child,
        stdin,
        frames: Some(frames),
        reader: Some(reader),
        errors: Some(errors),
        sequence: 0,
        initial: None,
        _temporary: temporary,
    };
    let input = bridge_input(request, "", None);
    let mut stdin = transport
        .stdin
        .take()
        .ok_or("The JDBC worker has no input pipe.")?;
    let writer = thread::spawn(move || {
        let result = stdin.write_all(&input);
        (stdin, result)
    });
    // Initial handshake is read by the actor, under the same deadline as sending credentials.
    let reply = transport.receive(cancel, OPERATION_TIMEOUT, 0);
    if reply.is_err() {
        transport.terminate();
    }
    let (stdin, result) = writer.join().map_err(|_| "The JDBC worker input failed.")?;
    transport.stdin = Some(stdin);
    result.map_err(|_| "The JDBC worker did not accept its connection request.")?;
    let envelope = reply?;
    // Preserve the initial envelope for the actor without accepting unsolicited later messages.
    transport.initial = Some(envelope);
    Ok(transport)
}

fn worker_error(envelope: &Envelope) -> Option<String> {
    envelope.error.as_ref().map(|message| {
        match envelope
            .sql_state
            .as_ref()
            .filter(|state| !state.is_empty())
        {
            Some(state) => format!("{message} SQL state: {state}."),
            None => message.clone(),
        }
    })
}
fn actor(
    authorized: AuthorizedRequest,
    request: JavaDatabaseConnectionInput,
    id: String,
    cancel: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    info: Arc<Mutex<Option<WorkerState>>>,
    jobs: mpsc::Receiver<Job>,
    initial: mpsc::Sender<Result<(Value, Info), String>>,
) {
    let opened = start_transport(&authorized, &request, &cancel);
    // Connection inputs are not retained by the native session after the handshake.
    drop(request);
    let mut transport = match opened {
        Ok(transport) => transport,
        Err(error) => {
            stopped.store(true, Ordering::Release);
            busy.store(false, Ordering::Release);
            let _ = initial.send(Err(error));
            return;
        }
    };
    let Some(envelope) = transport.initial.take() else {
        stopped.store(true, Ordering::Release);
        busy.store(false, Ordering::Release);
        return;
    };
    if let Some(error) = worker_error(&envelope) {
        stopped.store(true, Ordering::Release);
        busy.store(false, Ordering::Release);
        let _ = initial.send(Err(error));
        return;
    }
    if let Ok(mut state) = info.lock() {
        *state = Some(envelope.session.clone());
    }
    busy.store(false, Ordering::Release);
    if initial
        .send(Ok((
            envelope.result.unwrap(),
            Info {
                session_id: id.clone(),
                state: envelope.session,
            },
        )))
        .is_err()
    {
        cancel.store(true, Ordering::Release);
    }
    loop {
        if cancel.load(Ordering::Acquire) {
            // An idle connection gets a bounded opportunity to roll back and close normally.
            let _ = transport.rpc(
                &AtomicBool::new(false),
                "close",
                vec![],
                Duration::from_secs(2),
            );
            break;
        }
        if transport.child.try_wait().ok().flatten().is_some() {
            break;
        }
        let job = match jobs.recv_timeout(Duration::from_millis(20)) {
            Ok(job) => job,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        let closing = job.operation == "close";
        let transactional = matches!(
            job.operation.as_str(),
            "begin" | "commit" | "rollback" | "auto-commit" | "close"
        );
        let response = transport.rpc(&cancel, &job.operation, job.fields, OPERATION_TIMEOUT);
        let mut fatal = false;
        let response = match response {
            Ok(envelope) => {
                if let Ok(mut state) = info.lock() {
                    *state = Some(envelope.session.clone());
                }
                if let Some(error) = worker_error(&envelope) {
                    if transactional {
                        fatal = true;
                        Err(format!("{error} Transaction outcome was not confirmed; the connection is closed. Check database state before retrying."))
                    } else {
                        Err(error)
                    }
                } else {
                    Ok((
                        envelope.result.unwrap(),
                        Info {
                            session_id: id.clone(),
                            state: envelope.session,
                        },
                    ))
                }
            }
            Err(error) => {
                fatal = true;
                Err(error)
            }
        };
        if fatal || closing {
            drop(transport);
            stopped.store(true, Ordering::Release);
            busy.store(false, Ordering::Release);
            let _ = job.reply.send(response);
            return;
        }
        busy.store(false, Ordering::Release);
        let _ = job.reply.send(response);
    }
    drop(transport);
    stopped.store(true, Ordering::Release);
    busy.store(false, Ordering::Release);
}
impl JavaDatabaseSessionState {
    fn open(
        &self,
        authorized: AuthorizedRequest,
        request: JavaDatabaseConnectionInput,
    ) -> Result<(Arc<Handle>, mpsc::Receiver<Result<(Value, Info), String>>), String> {
        super::super::workspace_registry::with_root_activation(|| {
            ensure_current(&authorized)?;
            let key = (
                authorized.activation_generation,
                authorized.binding.workspace_id.clone(),
                request.request_id.clone(),
            );
            let mut cancelled = self
                .cancelled_openings
                .lock()
                .map_err(|_| "Database cancellation state is unavailable.")?;
            if let Some(index) = cancelled.iter().position(|entry| entry == &key) {
                cancelled.remove(index);
                return Err("The JDBC connection startup was stopped.".into());
            }
            drop(cancelled);
            let mut active = self
                .active
                .lock()
                .map_err(|_| "Database session state is unavailable.")?;
            if active
                .as_ref()
                .is_some_and(|handle| !handle.stopped.load(Ordering::Acquire))
            {
                return Err(
                    "Disconnect the existing JDBC session before opening another connection."
                        .into(),
                );
            }
            active.take();
            let mut random = [0; 16];
            getrandom::fill(&mut random).map_err(|_| "Cannot identify the JDBC session.")?;
            let id = random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let cancel = Arc::new(AtomicBool::new(false));
            let stopped = Arc::new(AtomicBool::new(false));
            let busy = Arc::new(AtomicBool::new(true));
            let info = Arc::new(Mutex::new(None));
            let (sender, jobs) = mpsc::channel();
            let (initial, reply) = mpsc::channel();
            let handle = Arc::new(Handle {
                id: id.clone(),
                connection_request_id: request.request_id.clone(),
                binding: authorized.binding.clone(),
                epoch: authorized.activation_generation,
                cancel: cancel.clone(),
                stopped: stopped.clone(),
                busy: busy.clone(),
                info: info.clone(),
                sender,
                join: Mutex::new(None),
            });
            let join = thread::spawn(move || {
                actor(
                    authorized, request, id, cancel, stopped, busy, info, jobs, initial,
                )
            });
            *handle
                .join
                .lock()
                .map_err(|_| "Cannot own the JDBC worker.")? = Some(join);
            *active = Some(handle.clone());
            Ok((handle, reply))
        })
    }
}
fn validate_scope(window: &WebviewWindow, scope: &Scope) -> Result<(), String> {
    if window.label() != "main" || scope.generation == 0 || scope.generation > 9_007_199_254_740_991
    {
        return Err("Database sessions are restricted to the active main workspace.".into());
    }
    validate_text(
        &scope.workspace_id,
        1,
        MAX_WORKSPACE_ID,
        "workspace identity",
    )?;
    validate_text(&scope.request_id, 1, MAX_REQUEST_ID, "request identity")?;
    if scope.session_id.len() != 32
        || !scope
            .session_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Invalid JDBC session identity.".into());
    }
    Ok(())
}
fn schema_result(
    scope: Scope,
    value: Value,
    session: Info,
    elapsed: Duration,
) -> Result<SchemaResult, String> {
    let bridge: BridgeConnectionResult = serde_json::from_value(value)
        .map_err(|_| "The JDBC session returned malformed schema data.")?;
    Ok(SchemaResult {
        metadata: JavaDatabaseConnectionResult {
            workspace_id: scope.workspace_id,
            generation: scope.generation,
            request_id: scope.request_id,
            product_name: bridge.product_name,
            product_version: bridge.product_version,
            estimated_plan_dialect: bridge.estimated_plan_dialect,
            identifier_quote_string: bridge.identifier_quote_string,
            current_catalog: bridge.current_catalog,
            tables: bridge
                .tables
                .into_iter()
                .map(|table| JavaDatabaseTable {
                    catalog: table.catalog,
                    schema: table.schema,
                    name: table.name,
                    table_type: table.table_type,
                    columns: table
                        .columns
                        .into_iter()
                        .map(|column| JavaDatabaseColumn {
                            name: column.name,
                            type_name: column.type_name,
                            nullable: column.nullable,
                        })
                        .collect(),
                    columns_truncated: table.columns_truncated,
                })
                .collect(),
            truncated: bridge.truncated,
            elapsed_ms: elapsed.as_millis().min(u64::MAX as u128) as u64,
        },
        session,
    })
}
fn query_result(
    scope: Scope,
    value: Value,
    session: Info,
    elapsed: Duration,
) -> Result<QueryResult, String> {
    let bridge: BridgeQueryResult = serde_json::from_value(value)
        .map_err(|_| "The JDBC session returned malformed query data.")?;
    Ok(QueryResult {
        query: JavaDatabaseQueryResult {
            workspace_id: scope.workspace_id,
            generation: scope.generation,
            request_id: scope.request_id,
            columns: bridge
                .columns
                .into_iter()
                .map(|column| JavaDatabaseQueryColumn {
                    name: column.name,
                    type_name: column.type_name,
                })
                .collect(),
            rows: bridge.rows,
            update_count: bridge.update_count,
            rows_truncated: bridge.rows_truncated,
            elapsed_ms: elapsed.as_millis().min(u64::MAX as u128) as u64,
        },
        session,
    })
}
fn query_fields(sql: &str, parameters: Option<&[JavaDatabaseParameter]>) -> Vec<u8> {
    // Reuse the existing bounded field encoder; session commands omit connection credentials.
    let blank = JavaDatabaseConnectionInput {
        workspace_id: String::new(),
        generation: 0,
        request_id: String::new(),
        jdk_home: String::new(),
        driver_jar_path: String::new(),
        jdbc_url: String::new(),
        username: String::new(),
        password: String::new(),
    };
    bridge_input(&blank, sql, parameters)
        .splitn(4, |byte| *byte == b'\n')
        .nth(3)
        .unwrap_or_default()
        .to_vec()
}
#[tauri::command]
pub async fn connect_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: JavaDatabaseConnectionInput,
) -> Result<SchemaResult, String> {
    let authorized = authorize(&window, &request)?;
    super::result_export::clear();
    let state = state.inner().clone();
    super::super::blocking::run(move || {
        let started = Instant::now();
        let mut scope = Scope {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            request_id: request.request_id.clone(),
            session_id: String::new(),
        };
        let (handle, initial) = state.open(authorized, request)?;
        scope.session_id = handle.id.clone();
        let result = (|| {
            let (value, info) = initial
                .recv_timeout(COMPILER_TIMEOUT + OPERATION_TIMEOUT + Duration::from_secs(2))
                .map_err(|_| "The JDBC connection did not open within its deadline.")??;
            super::super::workspace_registry::with_root_activation(|| {
                state.handle(&scope).map(|_| ())
            })?;
            schema_result(scope, value, info, started.elapsed())
        })();
        if result.is_err() {
            state.retire(&handle.id);
        }
        result
    })
    .await
}
#[tauri::command]
pub async fn inspect_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: Scope,
) -> Result<SchemaResult, String> {
    validate_scope(&window, &request)?;
    let state = state.inner().clone();
    super::super::blocking::run(move || {
        let started = Instant::now();
        let handle = state.reserve(&request, "inspect")?;
        let (value, info) = handle.request("inspect", vec![])?;
        super::super::workspace_registry::with_root_activation(|| {
            state.handle(&request).map(|_| ())
        })?;
        let result = schema_result(request, value, info, started.elapsed());
        if result.is_err() {
            state.retire(&handle.id);
        }
        result
    })
    .await
}
#[tauri::command]
pub async fn execute_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: Query,
) -> Result<QueryResult, String> {
    validate_scope(&window, &request.scope)?;
    validate_sql(&request.sql)?;
    validate_parameters(request.parameters.as_deref())?;
    let token = super::result_export::begin();
    let state = state.inner().clone();
    super::super::blocking::run(move || {
        let started = Instant::now();
        let handle = state.reserve(&request.scope, "execute")?;
        let (value, info) = handle.request(
            "execute",
            query_fields(&request.sql, request.parameters.as_deref()),
        )?;
        super::super::workspace_registry::with_root_activation(|| {
            state.handle(&request.scope).map(|_| ())
        })?;
        let result = query_result(request.scope, value, info, started.elapsed());
        if let Ok(ref response) = result {
            super::result_export::remember(
                token,
                handle.binding.canonical_root.clone(),
                handle.epoch,
                Some(handle.id.clone()),
                &response.query,
            );
        } else {
            state.retire(&handle.id);
        }
        result
    })
    .await
}
fn plan_result(
    scope: Scope,
    value: Value,
    info: Info,
    elapsed: Duration,
) -> Result<PlanResult, String> {
    let bridge: BridgePlanResult = serde_json::from_value(value)
        .map_err(|_| "The JDBC session returned malformed estimated-plan data.")?;
    let result = query_result(scope, bridge.query, info, elapsed)?;
    if result.query.update_count.is_some()
        || result.query.columns.len() != 1
        || result.query.rows.len() != 1
        || result.query.rows[0].len() != 1
        || result.query.rows[0][0].is_none()
        || result.query.columns[0].name != "PLAN"
    {
        return Err("The JDBC provider did not return an estimated query plan.".into());
    }
    Ok(PlanResult {
        result,
        plan_dialect: bridge.plan_dialect,
    })
}
#[tauri::command]
pub async fn explain_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: Query,
) -> Result<PlanResult, String> {
    validate_scope(&window, &request.scope)?;
    validate_sql(&request.sql)?;
    validate_parameters(request.parameters.as_deref())?;
    let token = super::result_export::begin();
    let state = state.inner().clone();
    super::super::blocking::run(move || {
        let started = Instant::now();
        let handle = state.reserve(&request.scope, "explain")?;
        let (value, info) = handle.request(
            "explain",
            query_fields(&request.sql, request.parameters.as_deref()),
        )?;
        super::super::workspace_registry::with_root_activation(|| {
            state.handle(&request.scope).map(|_| ())
        })?;
        let result = plan_result(request.scope, value, info, started.elapsed());
        if let Ok(ref response) = result {
            super::result_export::remember(
                token,
                handle.binding.canonical_root.clone(),
                handle.epoch,
                Some(handle.id.clone()),
                &response.result.query,
            );
        } else {
            state.retire(&handle.id);
        }
        result
    })
    .await
}
#[tauri::command]
pub async fn control_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: Control,
) -> Result<ControlResult, String> {
    validate_scope(&window, &request.scope)?;
    let state = state.inner().clone();
    if !matches!(
        request.action.as_str(),
        "begin" | "commit" | "rollback" | "auto-commit" | "status"
    ) {
        return Err("Unsupported JDBC transaction action.".into());
    }
    super::super::blocking::run(move || {
        if request.action == "status" {
            return super::super::workspace_registry::with_root_activation(|| {
                let session = state.handle(&request.scope)?.info()?;
                Ok(ControlResult {
                    scope: request.scope,
                    session,
                    outcome: "status".into(),
                })
            });
        }
        let handle = state.reserve(&request.scope, &request.action)?;
        let (value, session) = handle.request(&request.action, vec![])?;
        let expected = match request.action.as_str() {
            "begin" => "transaction-started",
            "commit" => "committed",
            "rollback" => "rolled-back",
            _ => "auto-commit-enabled",
        };
        if value.get("outcome").and_then(Value::as_str) != Some(expected) {
            state.retire(&handle.id);
            return Err(
                "The JDBC transaction outcome was not confirmed; the connection was closed.".into(),
            );
        }
        super::super::workspace_registry::with_root_activation(|| {
            state.handle(&request.scope).map(|_| ())
        })?;
        Ok(ControlResult {
            scope: request.scope,
            session,
            outcome: expected.into(),
        })
    })
    .await
}
#[tauri::command]
pub async fn close_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: Close,
) -> Result<CloseResult, String> {
    validate_scope(&window, &request.scope)?;
    super::result_export::clear_session(&request.scope.session_id);
    let state = state.inner().clone();
    super::super::blocking::run(move || {
        // Cleanup may address the captured old workspace after its activation has ended.
        let handle = state
            .active
            .lock()
            .map_err(|_| "Database session state is unavailable.")?
            .as_ref()
            .cloned();
        let Some(handle) = handle.filter(|handle| {
            handle.id == request.scope.session_id
                && handle.binding.workspace_id == request.scope.workspace_id
        }) else {
            return Ok(CloseResult {
                scope: request.scope,
                closed: true,
                rollback_confirmed: false,
            });
        };
        if handle.stopped.load(Ordering::Acquire) {
            state.retire(&handle.id);
            return Ok(CloseResult {
                scope: request.scope,
                closed: true,
                rollback_confirmed: false,
            });
        }
        super::super::workspace_registry::with_root_activation(|| {
            if handle
                .busy
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return Err(
                    "Wait for the database operation to finish before disconnecting.".to_string(),
                );
            }
            // Reserve first: the actor may have just completed a statement and updated its state.
            // A stale observation made before reservation must never authorize implicit rollback.
            let checked = handle.info().and_then(|info| {
                if !request.allow_rollback
                    && !info.state.auto_commit
                    && info.state.statements_since_boundary > 0
                {
                    Err("Commit or roll back before discarding this JDBC session.".into())
                } else {
                    Ok(())
                }
            });
            if checked.is_err() {
                handle.busy.store(false, Ordering::Release);
            }
            checked
        })?;
        let reply = handle.request("close", vec![]);
        state.retire(&handle.id);
        let (value, _) = reply?;
        if value.get("closed").and_then(Value::as_bool) != Some(true) {
            return Err(
                "JDBC connection closure was not confirmed; check database state before retrying."
                    .into(),
            );
        }
        Ok(CloseResult {
            scope: request.scope,
            closed: true,
            rollback_confirmed: value.get("rollbackConfirmed").and_then(Value::as_bool)
                == Some(true),
        })
    })
    .await
}

#[tauri::command]
pub async fn cancel_java_database_session(
    window: WebviewWindow,
    state: State<'_, JavaDatabaseSessionState>,
    request: Cancellation,
) -> Result<CancellationResult, String> {
    validate_scope(
        &window,
        &Scope {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            request_id: request.request_id.clone(),
            session_id: request.session_id.clone().unwrap_or_else(|| "0".repeat(32)),
        },
    )?;
    match (&request.session_id, &request.connection_request_id) {
        (Some(_), None) => {}
        (None, Some(id)) => validate_text(id, 1, MAX_REQUEST_ID, "connection request identity")?,
        _ => return Err("Identify exactly one JDBC session or connection startup to stop.".into()),
    }
    if let Some(id) = request.session_id.as_deref() {
        super::result_export::clear_session(id);
    }
    let state = state.inner().clone();
    super::super::blocking::run(move || {
        let binding =
            current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
        let epoch = super::super::workspace_registry::active_workspace_generation();
        state.cancel_request(&request, &binding, epoch)?;
        Ok(CancellationResult {
            request,
            stopped: true,
            outcome: "unknown",
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_request_deserialization_accepts_operations_and_refuses_unknown_fields() {
        let scope = serde_json::json!({"workspaceId":"one","generation":1,"requestId":"request","sessionId":"a".repeat(32)});
        let mut query = scope.clone();
        query["sql"] = "SELECT ?".into();
        query["parameters"] = serde_json::json!([{ "type": "integer", "value": "12" }]);
        assert!(serde_json::from_value::<Query>(query.clone()).is_ok());
        query["password"] = "unexpected".into();
        assert!(serde_json::from_value::<Query>(query).is_err());
        let mut control = scope.clone();
        control["action"] = "commit".into();
        assert!(serde_json::from_value::<Control>(control).is_ok());
        let mut close = scope;
        close["allowRollback"] = true.into();
        assert!(serde_json::from_value::<Close>(close).is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn session_deadline_covers_a_full_input_pipe_after_an_early_response() {
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).unwrap();
        let directory = std::env::temp_dir().join(format!(
            "ide-jdbc-early-response-{:x}",
            u128::from_be_bytes(nonce)
        ));
        fs::create_dir(&directory).unwrap();
        let temporary = TemporaryBridgeDirectory { path: directory };
        let mut command = Command::new("/usr/bin/python3");
        command.arg("-c").arg("import json,time; print(json.dumps({'sequence':1,'session':{'autoCommit':True,'supportsTransactions':True,'ddlCausesCommit':False,'statementsSinceBoundary':0},'result':{}}),flush=True); time.sleep(60)")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        configure_owned_process(&mut command);
        let mut child = command.spawn().unwrap();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (sender, frames) = mpsc::sync_channel(1);
        let reader = thread::spawn(move || {
            let _ = sender.send(frame(&mut BufReader::new(stdout)));
        });
        let mut transport = Transport {
            child,
            stdin,
            frames: Some(frames),
            reader: Some(reader),
            errors: None,
            sequence: 0,
            initial: None,
            _temporary: temporary,
        };
        let started = Instant::now();
        let result = transport.rpc(
            &AtomicBool::new(false),
            "execute",
            vec![b'x'; 256 * 1024],
            Duration::from_millis(150),
        );
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(transport.child.try_wait().unwrap().is_some());
    }

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn context() -> (
        Fixture,
        JavaDatabaseConnectionInput,
        impl Fn() -> AuthorizedRequest,
    ) {
        let home = PathBuf::from(std::env::var("IDE_DATABASE_TEST_JDK_HOME").unwrap())
            .canonicalize()
            .unwrap();
        let driver = PathBuf::from(std::env::var("IDE_STORY_JAVA_DATABASE_DRIVER_PATH").unwrap());
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).unwrap();
        let fixture = Fixture(
            std::env::temp_dir().join(format!("ide-jdbc-session-{:x}", u128::from_be_bytes(nonce))),
        );
        let root = fixture.0.join("workspace");
        fs::create_dir_all(&root).unwrap();
        fs::copy(driver, root.join("driver.jar")).unwrap();
        let registry = fixture.0.join("registry.json");
        let workspace =
            crate::commands::workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = current_workspace_binding_at(&root, &registry).unwrap();
        let request = JavaDatabaseConnectionInput {
            workspace_id: workspace.id,
            generation: 1,
            request_id: "jdbc-session".into(),
            jdk_home: home.to_string_lossy().into(),
            driver_jar_path: "driver.jar".into(),
            jdbc_url: format!("jdbc:h2:file:{}", fixture.0.join("database").display()),
            username: "sa".into(),
            password: String::new(),
        };
        let factory = move || AuthorizedRequest {
            binding: binding.clone(),
            activation_generation: crate::commands::workspace_registry::active_workspace_generation(
            ),
            jdk_home: home.clone(),
            driver_jar: root.join("driver.jar"),
        };
        (fixture, request, factory)
    }
    fn open(
        state: &JavaDatabaseSessionState,
        authorized: AuthorizedRequest,
        request: JavaDatabaseConnectionInput,
    ) -> (Arc<Handle>, Scope, Info) {
        let mut scope = Scope {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            request_id: request.request_id.clone(),
            session_id: String::new(),
        };
        let (handle, initial) = state.open(authorized, request).unwrap();
        let (metadata, info) = initial
            .recv_timeout(Duration::from_secs(55))
            .unwrap()
            .unwrap();
        let schema: BridgeConnectionResult = serde_json::from_value(metadata).unwrap();
        assert_eq!(schema.identifier_quote_string.as_deref(), Some("\""));
        assert_eq!(
            schema.estimated_plan_dialect,
            Some(EstimatedPlanDialect::H2)
        );
        assert!(schema
            .current_catalog
            .as_ref()
            .is_some_and(|value| !value.is_empty()));
        scope.session_id = handle.id.clone();
        (handle, scope, info)
    }
    fn sql(
        state: &JavaDatabaseSessionState,
        scope: &Scope,
        sql: &str,
    ) -> Result<BridgeQueryResult, String> {
        validate_sql(sql)?;
        let handle = state.reserve(scope, "execute")?;
        let (value, _) = handle.request("execute", query_fields(sql, None))?;
        serde_json::from_value(value).map_err(|_| "Malformed query".into())
    }
    fn control(state: &JavaDatabaseSessionState, scope: &Scope, operation: &str) -> Info {
        let handle = state.reserve(scope, operation).unwrap();
        handle.request(operation, vec![]).unwrap().1
    }
    fn close(state: &JavaDatabaseSessionState, scope: &Scope) -> Value {
        let handle = state.reserve(scope, "close").unwrap();
        let (value, _) = handle.request("close", vec![]).unwrap();
        state.retire(&handle.id);
        value
    }
    #[test]
    fn session_frames_are_bounded_and_require_complete_lines() {
        assert!(frame(&mut std::io::Cursor::new(vec![b'x'; MAX_BRIDGE_OUTPUT + 1])).is_err());
        assert!(frame(&mut std::io::Cursor::new(b"incomplete")).is_err());
        assert_eq!(frame(&mut std::io::Cursor::new(b"{}\n")).unwrap(), b"{}\n");
    }
    #[test]
    #[ignore = "requires IDE_DATABASE_TEST_JDK_HOME and IDE_STORY_JAVA_DATABASE_DRIVER_PATH (H2 2.4.240)"]
    fn real_jdbc_estimated_plans_preserve_data_parameters_and_manual_work() {
        let (_fixture, request, authorized) = context();
        let state = JavaDatabaseSessionState::default();
        let (_handle, scope, _) = open(&state, authorized(), request);
        sql(
            &state,
            &scope,
            "CREATE TABLE notes(id INTEGER PRIMARY KEY, name VARCHAR(200))",
        )
        .unwrap();
        sql(&state, &scope, "INSERT INTO notes VALUES (1, 'original')").unwrap();
        control(&state, &scope, "begin");
        let estimate = |statement: &str,
                        parameters: Option<&[JavaDatabaseParameter]>|
         -> Result<PlanResult, String> {
            validate_sql(statement)?;
            validate_parameters(parameters)?;
            let handle = state.reserve(&scope, "explain")?;
            let (value, info) = handle.request("explain", query_fields(statement, parameters))?;
            plan_result(scope.clone(), value, info, Duration::ZERO)
        };
        let parameters = [JavaDatabaseParameter {
            kind: JavaDatabaseParameterType::Integer,
            value: "1".into(),
        }];
        let plan = estimate("SELECT name FROM notes WHERE id = ?", Some(&parameters)).unwrap();
        assert_eq!(plan.plan_dialect, EstimatedPlanDialect::H2);
        assert_eq!(plan.result.session.session_id, scope.session_id);
        assert!(!plan.result.session.state.auto_commit);
        assert_eq!(plan.result.session.state.statements_since_boundary, 1);
        assert!(plan.result.query.rows[0][0]
            .as_ref()
            .unwrap()
            .contains("PRIMARY_KEY"));
        for statement in [
            "UPDATE notes SET name='changed' WHERE id=1", "DELETE FROM notes WHERE id=1",
            "INSERT INTO notes VALUES (2,'inserted')", "MERGE INTO notes KEY(id) VALUES (1,'merged')",
            "/* outer /* inner ; */ still comment */ SELECT 'I''m; literal' AS \"semi;column\"; -- trailing ;",
            "SELECT $$a; DELETE FROM notes$$", "SELECT ARRAY[1, 2]", "// line ;\nSELECT 1",
        ] { estimate(statement, None).unwrap(); }
        for statement in [
            "SELECT 1; DELETE FROM notes",
            "SELECT 1; /* comment */ DELETE FROM notes",
            "ANALYZE DELETE FROM notes",
            "EXPLAIN ANALYZE DELETE FROM notes",
            "DELETE FROM notes;;",
            "SELECT 'unterminated",
            "SELECT $$unterminated",
            "SELECT a$$b; DELETE FROM notes; $$",
            "/* unterminated",
            "/* comments only */",
            "CREATE TABLE unwanted(id INT)",
        ] {
            assert!(
                estimate(statement, None).is_err(),
                "must refuse {statement}"
            );
        }
        assert!(estimate("SELECT name FROM notes WHERE id=?", Some(&[])).is_err());
        assert_eq!(
            sql(&state, &scope, "SELECT id, name FROM notes")
                .unwrap()
                .rows,
            vec![vec![Some("1".into()), Some("original".into())]]
        );
        assert!(state.transition_allowed().is_err());
        sql(&state, &scope, "SET MODE MySQL").unwrap();
        assert!(estimate("SELECT 1", None)
            .err()
            .unwrap()
            .contains("REGULAR mode"));
        sql(&state, &scope, "SET MODE REGULAR").unwrap();
        estimate("SELECT 1", None).unwrap();
        control(&state, &scope, "rollback");
        let handle = state.reserve(&scope, "close").unwrap();
        let (closed, _) = handle.request("close", vec![]).unwrap();
        assert_eq!(closed["rollbackConfirmed"], true);
        state.retire(&scope.session_id);
    }

    #[test]
    #[ignore = "requires IDE_DATABASE_TEST_JDK_HOME and IDE_STORY_JAVA_DATABASE_DRIVER_PATH (H2 2.4.240)"]
    fn real_jdbc_session_keeps_one_connection_commits_rolls_back_and_pins_the_driver() {
        let (fixture, request, authorized) = context();
        let state = JavaDatabaseSessionState::default();
        let original = fs::read(authorized().driver_jar).unwrap();
        let (_handle, scope, info) = open(&state, authorized(), request.clone());
        assert!(info.state.auto_commit && info.state.supports_transactions);
        // Later JDBC classes must still come from the captured JAR rather than a replaced workspace file.
        fs::write(authorized().driver_jar, b"replacement is not a JAR").unwrap();
        sql(
            &state,
            &scope,
            "CREATE TABLE notes (id INTEGER PRIMARY KEY, name VARCHAR(200))",
        )
        .unwrap();
        assert!(!control(&state, &scope, "begin").state.auto_commit);
        sql(&state, &scope, "INSERT INTO notes VALUES (1,'rolled back')").unwrap();
        assert_eq!(
            sql(&state, &scope, "SELECT COUNT(*) FROM notes")
                .unwrap()
                .rows[0][0],
            Some("1".into())
        );
        assert!(state
            .transition_allowed()
            .unwrap_err()
            .contains("Commit or roll back"));
        assert!(state.reserve(&scope, "auto-commit").is_err());
        assert!(!control(&state, &scope, "rollback").state.auto_commit);
        assert_eq!(
            sql(&state, &scope, "SELECT COUNT(*) FROM notes")
                .unwrap()
                .rows[0][0],
            Some("0".into())
        );
        control(&state, &scope, "rollback");
        sql(&state, &scope, "INSERT INTO notes VALUES (2,'committed')").unwrap();
        assert_eq!(
            control(&state, &scope, "commit")
                .state
                .statements_since_boundary,
            0
        );
        sql(
            &state,
            &scope,
            "INSERT INTO notes VALUES (3,'discarded on close')",
        )
        .unwrap();
        assert!(close(&state, &scope)["rollbackConfirmed"]
            .as_bool()
            .unwrap());
        fs::write(authorized().driver_jar, original).unwrap();
        let (_handle, next, _) = open(&state, authorized(), request.clone());
        assert_eq!(
            sql(&state, &next, "SELECT name FROM notes").unwrap().rows,
            vec![vec![Some("committed".into())]]
        );
        close(&state, &next);
        let mut memory = request;
        memory.jdbc_url = "jdbc:h2:mem:one_connection".into();
        let (_handle, scope, _) = open(&state, authorized(), memory);
        sql(
            &state,
            &scope,
            "CREATE TABLE memory_notes (name VARCHAR(200))",
        )
        .unwrap();
        sql(
            &state,
            &scope,
            "INSERT INTO memory_notes VALUES ('still connected')",
        )
        .unwrap();
        assert_eq!(
            sql(&state, &scope, "SELECT name FROM memory_notes")
                .unwrap()
                .rows,
            vec![vec![Some("still connected".into())]]
        );
        control(&state, &scope, "begin");
        assert!(sql(&state, &scope, "INSERT INTO missing_table VALUES (1)").is_err());
        assert!(state.handle(&scope).is_ok());
        assert!(state.transition_allowed().is_err());
        control(&state, &scope, "rollback");
        control(&state, &scope, "auto-commit");
        assert!(state.transition_allowed().is_ok());
        close(&state, &scope);
        assert!(fixture.0.exists());
    }
    #[test]
    #[ignore = "requires IDE_DATABASE_TEST_JDK_HOME and IDE_STORY_JAVA_DATABASE_DRIVER_PATH (H2 2.4.240)"]
    fn real_jdbc_cancellation_stops_query_and_compiler_and_refuses_cancelled_queued_startup() {
        let (fixture, mut request, authorized) = context();
        let state = JavaDatabaseSessionState::default();
        let owner = authorized();
        let workspace_id = request.workspace_id.clone();
        let cancellation =
            |session_id: Option<String>, connection_request_id: Option<String>| Cancellation {
                workspace_id: workspace_id.clone(),
                generation: 1,
                request_id: "stop-test".into(),
                session_id,
                connection_request_id,
            };
        state
            .cancel_request(
                &cancellation(None, Some(request.request_id.clone())),
                &owner.binding,
                owner.activation_generation,
            )
            .unwrap();
        assert!(state
            .open(authorized(), request.clone())
            .err()
            .unwrap()
            .contains("startup was stopped"));
        request.request_id = "live-query".into();
        let (_handle, scope, _) = open(&state, authorized(), request.clone());
        let mut wrong_owner = cancellation(Some(scope.session_id.clone()), None);
        wrong_owner.workspace_id = "another-workspace".into();
        assert!(state
            .cancel_request(&wrong_owner, &owner.binding, owner.activation_generation)
            .is_err());
        assert!(state
            .cancel_request(
                &cancellation(Some("f".repeat(32)), None),
                &owner.binding,
                owner.activation_generation
            )
            .is_err());
        assert!(state.handle(&scope).is_ok());
        assert_eq!(
            sql(&state, &scope, "SELECT 'é 😀' AS \"é label\"")
                .unwrap()
                .rows,
            vec![vec![Some("é 😀".into())]]
        );
        sql(&state, &scope, "CREATE TABLE notes (name VARCHAR(40))").unwrap();
        sql(&state, &scope, "INSERT INTO notes VALUES ('committed')").unwrap();
        sql(&state, &scope, "CREATE ALIAS IDE_PAUSE AS $$ void pause(String file) throws Exception { java.nio.file.Files.writeString(java.nio.file.Path.of(file), Long.toString(ProcessHandle.current().pid())); Thread.sleep(60000); } $$").unwrap();
        control(&state, &scope, "begin");
        sql(&state, &scope, "INSERT INTO notes VALUES ('pending')").unwrap();
        let marker = fixture.0.join("query-running");
        let query_state = state.clone();
        let query_scope = scope.clone();
        let query_marker = marker.clone();
        let running = thread::spawn(move || {
            sql(
                &query_state,
                &query_scope,
                &format!("CALL IDE_PAUSE('{}')", query_marker.display()),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !marker.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            marker.exists(),
            "the real JDBC query never entered the blocking alias"
        );
        let worker_pid: u32 = fs::read_to_string(marker).unwrap().parse().unwrap();
        assert!(state.transition_allowed().is_err());
        let started = Instant::now();
        state
            .cancel_request(
                &cancellation(Some(scope.session_id.clone()), None),
                &owner.binding,
                owner.activation_generation,
            )
            .unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(running.join().unwrap().is_err());
        assert!(state.transition_allowed().is_ok());
        #[cfg(target_os = "linux")]
        assert!(!PathBuf::from(format!("/proc/{worker_pid}")).exists());
        request.request_id = "after-stop".into();
        let (_handle, next, _) = open(&state, authorized(), request.clone());
        assert_eq!(
            sql(&state, &next, "SELECT name FROM notes").unwrap().rows,
            vec![vec![Some("committed".into())]]
        );
        close(&state, &next);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let fake_home = fixture.0.join("slow-jdk");
            fs::create_dir_all(fake_home.join("bin")).unwrap();
            let compiler = fake_home.join("bin/javac");
            fs::write(&compiler, b"#!/bin/sh\nprintf '%s' \"$$\" > \"$(dirname \"$0\")/../started\"\nexec /usr/bin/sleep 60\n").unwrap();
            fs::set_permissions(&compiler, fs::Permissions::from_mode(0o700)).unwrap();
            let mut slow_owner = authorized();
            slow_owner.jdk_home = fake_home.clone();
            request.request_id = "slow-startup".into();
            request.jdk_home = fake_home.to_string_lossy().into();
            let (_handle, result) = state.open(slow_owner, request.clone()).unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            while !fake_home.join("started").exists() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            assert!(fake_home.join("started").exists());
            let compiler_pid: u32 = fs::read_to_string(fake_home.join("started"))
                .unwrap()
                .parse()
                .unwrap();
            let started = Instant::now();
            state
                .cancel_request(
                    &cancellation(None, Some(request.request_id.clone())),
                    &owner.binding,
                    owner.activation_generation,
                )
                .unwrap();
            assert!(started.elapsed() < Duration::from_secs(3));
            assert!(result
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .is_err());
            assert!(state.transition_allowed().is_ok());
            #[cfg(target_os = "linux")]
            assert!(!PathBuf::from(format!("/proc/{compiler_pid}")).exists());
        }
    }
}
