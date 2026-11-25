//! JDI runtime state from the owned JDK bridge, without parsing a debugger's display text.
use super::{debugger_input, main_class, Job, SessionRequest};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::Arc;

pub(super) const SOURCE: &[u8] = concat!(
    include_str!("IdeJavaDebugger.java"),
    "\n",
    include_str!("IdeJavaDebuggerExpressions.java")
)
.as_bytes();
const FRAME_LIMIT: u64 = 512 * 1024;
// The JDI helper bounds a Base64 command line before decoding it.
const COMMAND_LINE_LIMIT: usize = 3072;
const STEP_FILTER_BYTES: usize = 1536;

pub(super) fn available(home: &Path) -> bool {
    cfg!(unix) && super::launch_settings::java_runtime_has_module(home, "jdk.jdi", 17)
}

pub(super) fn launch_home(target: &Path) -> Option<std::path::PathBuf> {
    if !cfg!(unix) {
        return None;
    }
    if available(target) {
        return Some(target.to_owned());
    }
    let host = match std::env::var("IDE_JAVA_DEBUGGER_HOME") {
        Ok(home) if !home.is_empty() => super::selected_jdk(&home).ok(),
        Ok(_) | Err(std::env::VarError::NotPresent) => super::jdk_home(),
        Err(std::env::VarError::NotUnicode(_)) => None,
    }?;
    available(&host).then_some(host)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub breakpoints_muted: Option<bool>,
    #[serde(default)]
    pub can_reload_classes: bool,
    #[serde(default)]
    pub can_drop_frame: bool,
    pub status: Status,
    pub stop_id: Option<String>,
    pub reason: Option<String>,
    pub exception_mode: String,
    #[serde(default)]
    pub exception_class_name: String,
    #[serde(default = "include_exception_subclasses")]
    pub exception_include_subclasses: bool,
    pub selected_thread_id: Option<String>,
    pub selected_frame_id: Option<String>,
    pub threads: Vec<DebugThread>,
    pub frames: Vec<DebugFrame>,
    pub variables: Vec<Variable>,
    pub variable_page: Option<VariablePage>,
    pub breakpoints: Vec<Breakpoint>,
    pub watches: Vec<Watch>,
    pub evaluation: Option<Evaluation>,
    pub threads_truncated: bool,
    pub frames_truncated: bool,
    pub variables_truncated: bool,
    #[serde(default)]
    pub loaded_classes: Vec<LoadedClass>,
    #[serde(default)]
    pub loaded_classes_truncated: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}
fn include_exception_subclasses() -> bool { true }

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Running,
    Suspended,
    Terminated,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugThread {
    pub id: String,
    pub name: String,
    pub status: i32,
    pub suspended: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugFrame {
    #[serde(default)]
    pub obsolete: bool,
    pub id: String,
    pub class_name: String,
    pub method_name: String,
    pub source_path: Option<String>,
    pub line: Option<u32>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Variable {
    pub name: String,
    pub r#type: String,
    pub value: String,
    pub value_truncated: bool,
    pub reference: Option<String>,
    pub child_count: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadedClass {
    pub class_name: String,
    pub class_loader_count: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariablePage {
    pub reference: String,
    pub start: u32,
    pub total: u32,
    pub variables: Vec<Variable>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Breakpoint {
    pub class_name: Option<String>,
    pub source_path: Option<String>,
    pub line: u32,
    pub verified: bool,
    pub message: Option<String>,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub hit_count: u32,
    #[serde(default)]
    pub hits: u32,
    #[serde(default)]
    pub log_message: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Watch {
    pub expression: String,
    pub variable: Option<Variable>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evaluation {
    pub stop_id: String,
    pub frame_id: String,
    pub expression: String,
    pub variable: Option<Variable>,
    pub error: Option<String>,
}

impl DebugState {
    pub(super) fn terminate(&mut self) {
        self.can_reload_classes = false;
        self.can_drop_frame = false;
        self.status = Status::Terminated;
        self.stop_id = None;
        self.reason = None;
        self.selected_thread_id = None;
        self.selected_frame_id = None;
        self.threads.clear();
        self.frames.clear();
        self.variables.clear();
        self.variable_page = None;
        self.loaded_classes.clear();
        self.loaded_classes_truncated = false;
        self.evaluation = None;
        for watch in &mut self.watches {
            watch.variable = None;
            watch.error = Some("The debugger session has ended.".into());
        }
    }
    fn validate(&self) -> Result<(), String> {
        fn text(value: &str, limit: usize) -> bool {
            value.len() <= limit && !value.contains('\0')
        }
        fn optional(value: &Option<String>, limit: usize) -> bool {
            value.as_ref().is_none_or(|value| text(value, limit))
        }
        fn variable(value: &Variable) -> bool {
            text(&value.name, 2048)
                && text(&value.r#type, 2048)
                && text(&value.value, 2048)
                && optional(&value.reference, 128)
        }
        let suspended = self.status == Status::Suspended;
        if !["none", "caught", "uncaught", "all"].contains(&self.exception_mode.as_str())
            || (!self.exception_class_name.is_empty() && !main_class(&self.exception_class_name)) {
            return Err("Invalid JDI exception breakpoint mode.".into());
        }
        if self.threads.len() > 128
            || self.frames.len() > 128
            || self.variables.len() > 128
            || self.loaded_classes.len() > 2000
            || self.breakpoints.len() > 128
            || self.watches.len() > 32
            || !optional(&self.stop_id, 128)
            || !optional(&self.selected_thread_id, 128)
            || !optional(&self.selected_frame_id, 128)
            || !optional(&self.message, 4096)
            || !optional(&self.error, 4096)
            || suspended != self.stop_id.as_ref().is_some_and(|id| !id.is_empty())
            || (!suspended
                && (!self.frames.is_empty()
                    || !self.variables.is_empty()
                    || self.variable_page.is_some()
                    || self.selected_frame_id.is_some()
                    || self.selected_thread_id.is_some()))
            || self
                .threads
                .iter()
                .any(|item| item.id.is_empty() || !text(&item.id, 128) || !text(&item.name, 2048))
            || self.frames.iter().any(|item| {
                item.id.is_empty()
                    || !text(&item.id, 128)
                    || !text(&item.class_name, 2048)
                    || !text(&item.method_name, 2048)
                    || !optional(&item.source_path, 16384)
                    || item.line == Some(0)
            })
            || self.variables.iter().any(|item| !variable(item))
            || self.loaded_classes.iter().any(|item| {
                !main_class(&item.class_name)
                    || !text(&item.class_name, 2048)
                    || item.class_loader_count == 0
            })
            || self.loaded_classes.windows(2).any(|pair| {
                pair[0]
                    .class_name
                    .encode_utf16()
                    .cmp(pair[1].class_name.encode_utf16())
                    != std::cmp::Ordering::Less
            })
            || self.breakpoints.iter().any(|item| {
                !optional(&item.class_name, 2048)
                    || !optional(&item.source_path, 4096)
                    || (item.class_name.is_some() == item.source_path.is_some())
                    || item.line == 0
                    || !optional(&item.message, 4096)
                    || validate_breakpoint_options(
                        &item.condition,
                        item.hit_count,
                        &item.log_message,
                    )
                    .is_err()
                    || item.hits > 1_000_000_000
                    || (item.hit_count > 0 && item.hits > item.hit_count)
            })
            || self.watches.iter().any(|item| {
                validate_watch_expression(&item.expression).is_err()
                    || !optional(&item.error, 4096)
                    || item.variable.as_ref().is_some_and(|item| !variable(item))
            })
            || self.evaluation.as_ref().is_some_and(|item| {
                validate_watch_expression(&item.expression).is_err()
                    || !text(&item.stop_id, 128)
                    || !text(&item.frame_id, 128)
                    || !optional(&item.error, 4096)
                    || (item.variable.is_some() == item.error.is_some())
                    || item.variable.as_ref().is_some_and(|item| !variable(item))
                    || self.status != Status::Suspended
                    || Some(&item.stop_id) != self.stop_id.as_ref()
                    || Some(&item.frame_id) != self.selected_frame_id.as_ref()
            })
            || self.variable_page.as_ref().is_some_and(|page| {
                !text(&page.reference, 128)
                    || page.variables.len() > 32
                    || page.start > page.total
                    || page.variables.len() as u64 + page.start as u64 > page.total as u64
                    || page.variables.iter().any(|item| !variable(item))
            })
            || self.selected_thread_id.as_ref().is_some_and(|id| {
                !self
                    .threads
                    .iter()
                    .any(|thread| thread.id == *id && thread.suspended)
            })
            || self
                .selected_frame_id
                .as_ref()
                .is_some_and(|id| !self.frames.iter().any(|frame| frame.id == *id))
            || self.reason.as_ref().is_some_and(|reason| {
                ![
                    "entry",
                    "breakpoint",
                    "step",
                    "pause",
                    "exception",
                    "frame-drop",
                ]
                .contains(&reason.as_str())
            })
            || (self.can_drop_frame
                && (self.status != Status::Suspended
                    || !self
                        .frames
                        .iter()
                        .position(|frame| Some(&frame.id) == self.selected_frame_id.as_ref())
                        .is_some_and(|index| index + 1 < self.frames.len())))
        {
            return Err("Invalid JDI runtime state.".into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Event {
    TestListener {
        port: u16,
    },
    State {
        state: DebugState,
    },
    Output {
        text: String,
    },
    Logpoint {
        text: String,
    },
    ClassReload {
        result: super::class_reload::Outcome,
    },
}

pub(super) fn drain(reader: impl Read, job: Arc<Job>) -> Result<(), String> {
    let mut reader = BufReader::new(reader);
    let mut initial_connection = false;
    let mut last_status = None;
    let result = (|| {
        loop {
            let mut line = Vec::new();
            let read = reader
                .by_ref()
                .take(FRAME_LIMIT + 1)
                .read_until(b'\n', &mut line)
                .map_err(|_| "Cannot read the JDI debugger transport.")?;
            if read == 0 {
                break;
            }
            if read as u64 > FRAME_LIMIT || line.last() != Some(&b'\n') {
                return Err("JDI debugger transport exceeded its frame limit.".into());
            }
            let event: Event = serde_json::from_slice(&line)
                .map_err(|_| "Invalid JDI debugger transport data.")?;
            match event {
                Event::TestListener { port } => {
                    super::debug_test::listener_port(&line)?;
                    if !super::debug_test::is_debug(&job.request.operation)
                        || port == 0
                        || last_status.is_some()
                    {
                        return Err("Unexpected test debugger listener frame.".into());
                    }
                    let mut ready = job
                        .test_listener_port
                        .lock()
                        .map_err(|_| "Test debugger listener is unavailable.")?;
                    if ready.is_some() {
                        return Err("Duplicate test debugger listener frame.".into());
                    }
                    *ready = Some(port);
                }
                Event::ClassReload { result } => super::class_reload::complete(&job, result)?,
                Event::Output { text } => {
                    if text.len() > 16384 {
                        return Err("Oversized JDI application output frame.".into());
                    }
                    job.append(text.as_bytes());
                }
                Event::Logpoint { text } => {
                    if text.len() > 32768 {
                        return Err("Oversized JDI logpoint frame.".into());
                    }
                    job.append(format!("[Logpoint] {text}\n").as_bytes());
                }
                Event::State { mut state } => {
                    state.validate()?;
                    if super::debug_test::is_debug(&job.request.operation) {
                        state.can_reload_classes = false;
                    }
                    if last_status.is_none() {
                        initial_connection = (state.status == Status::Suspended
                            && state.reason.as_deref() == Some("entry"))
                            || (job.request.operation == "attach"
                                && state.status == Status::Running);
                    }
                    last_status = Some(state.status.clone());
                    if !job.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
                        job.snapshot
                            .lock()
                            .map_err(|_| "JDI debugger state is unavailable.")?
                            .debugger_state = Some(state);
                    }
                }
            }
        }
        if !job.cancelled.load(std::sync::atomic::Ordering::SeqCst)
            && (!initial_connection || last_status != Some(Status::Terminated))
        {
            return Err("JDI debugger ended without a complete runtime session.".into());
        }
        Ok(())
    })();
    if result.is_err() {
        if let Ok(mut child) = job.child.lock() {
            if let Some(child) = child.as_mut() {
                super::kill_owned_process(child);
            }
        }
    }
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub action: Action,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    MuteBreakpoints { muted: bool },
    ListLoadedClasses,
    Continue {
        stop_id: String,
    },
    Step {
        stop_id: String,
        kind: StepKind,
        #[serde(default)]
        exclusion_filters: Vec<String>,
    },
    Pause,
    SelectThread {
        stop_id: String,
        thread_id: String,
    },
    SelectFrame {
        stop_id: String,
        frame_id: String,
    },
    DropFrame {
        stop_id: String,
        frame_id: String,
    },
    Variables {
        stop_id: String,
        reference: String,
        start: u32,
    },
    SetBreakpoint {
        class_name: String,
        line: u32,
        #[serde(default)]
        condition: String,
        #[serde(default)]
        hit_count: u32,
        #[serde(default)]
        log_message: String,
    },
    ClearBreakpoint {
        class_name: String,
        line: u32,
    },
    Watch {
        stop_id: String,
        expression: String,
    },
    Evaluate {
        stop_id: String,
        expression: String,
    },
    SetLocalValue {
        stop_id: String,
        frame_id: String,
        assignment: String,
    },
    RemoveWatch {
        stop_id: String,
        expression: String,
    },
    Exceptions {
        mode: ExceptionMode,
        #[serde(default)]
        class_name: String,
        #[serde(default = "include_exception_subclasses")]
        include_subclasses: bool,
    },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Into,
    Over,
    Out,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExceptionMode {
    None,
    Caught,
    Uncaught,
    All,
}

impl Action {
    fn fields<'a>(&'a self, state: &DebugState) -> Result<Vec<String>, String> {
        let (kind, stop, target, number) = match self {
            Self::MuteBreakpoints { muted } => {
                if state.breakpoints_muted.is_none() {
                    return Err("This debugger does not support muting breakpoints.".into());
                }
                ("muteBreakpoints", None, if *muted { "true" } else { "false" }, 0)
            }
            Self::ListLoadedClasses => ("listLoadedClasses", None, "", 0),
            Self::Continue { stop_id } => ("continue", Some(stop_id), "", 0),
            Self::Step { stop_id, kind, .. } => (
                "step",
                Some(stop_id),
                match kind {
                    StepKind::Into => "into",
                    StepKind::Over => "over",
                    StepKind::Out => "out",
                },
                0,
            ),
            Self::Pause => ("pause", None, "", 0),
            Self::SelectThread { stop_id, thread_id } => {
                ("selectThread", Some(stop_id), thread_id.as_str(), 0)
            }
            Self::SelectFrame { stop_id, frame_id } => {
                ("selectFrame", Some(stop_id), frame_id.as_str(), 0)
            }
            Self::DropFrame { stop_id, frame_id } => {
                if !state.can_drop_frame
                    || state.selected_frame_id.as_deref() != Some(frame_id.as_str())
                {
                    return Err("The selected frame cannot be removed at this suspension.".into());
                }
                ("dropFrame", Some(stop_id), frame_id.as_str(), 0)
            }
            Self::Variables {
                stop_id,
                reference,
                start,
            } => ("variables", Some(stop_id), reference.as_str(), *start),
            Self::Watch {
                stop_id,
                expression,
            } => {
                validate_watch_expression(expression)?;
                ("watch", Some(stop_id), expression.as_str(), 0)
            }
            Self::RemoveWatch {
                stop_id,
                expression,
            } => {
                validate_watch_expression(expression)?;
                ("removeWatch", Some(stop_id), expression.as_str(), 0)
            }
            Self::Evaluate {
                stop_id,
                expression,
            } => {
                validate_watch_expression(expression)?;
                ("evaluate", Some(stop_id), expression.as_str(), 0)
            }
            Self::SetLocalValue {
                stop_id,
                frame_id,
                assignment,
            } => {
                validate_watch_expression(assignment)?;
                if frame_id.is_empty()
                    || frame_id.len() > 128
                    || state.selected_frame_id.as_deref() != Some(frame_id)
                {
                    return Err(
                        "Select the current suspended frame before changing a local variable."
                            .into(),
                    );
                }
                ("setLocalValue", Some(stop_id), assignment.as_str(), 0)
            }
            Self::SetBreakpoint {
                class_name, line, ..
            }
            | Self::ClearBreakpoint { class_name, line } => {
                if !main_class(class_name) || *line == 0 || *line > i32::MAX as u32 {
                    return Err(
                        "Use a Java class and a positive source line for the breakpoint.".into(),
                    );
                }
                (
                    if matches!(self, Self::SetBreakpoint { .. }) {
                        "setBreakpoint"
                    } else {
                        "clearBreakpoint"
                    },
                    None,
                    class_name.as_str(),
                    *line,
                )
            }
            Self::Exceptions { mode, .. } => (
                "exceptions",
                None,
                match mode {
                    ExceptionMode::None => "none",
                    ExceptionMode::Caught => "caught",
                    ExceptionMode::Uncaught => "uncaught",
                    ExceptionMode::All => "all",
                },
                0,
            ),
        };
        if state.status == Status::Terminated
            || target.len() > 1024
            || target.contains(['\0', '\n', '\r'])
            || number > i32::MAX as u32
            || stop.is_some_and(|stop| {
                state.status != Status::Suspended || Some(stop) != state.stop_id.as_ref()
            })
            || (matches!(self, Self::Evaluate { .. }) && state.selected_frame_id.is_none())
            || (matches!(self, Self::SetLocalValue { .. }) && state.selected_frame_id.is_none())
            || (matches!(self, Self::Pause) && state.status != Status::Running)
        {
            return Err(
                "The JDI debugger action is unavailable or its suspended state is obsolete.".into(),
            );
        }
        let mut fields = vec![
            kind.into(),
            stop.map_or(String::new(), Clone::clone),
            target.into(),
            number.to_string(),
        ];
        if let Self::SetBreakpoint {
            condition,
            hit_count,
            log_message,
            ..
        } = self
        {
            validate_breakpoint_options(condition, *hit_count, log_message)?;
            fields.extend([
                condition.clone(),
                hit_count.to_string(),
                log_message.clone(),
            ]);
        }
        if let Self::SetLocalValue { frame_id, .. } = self {
            fields.push(frame_id.clone());
        }
        if let Self::Step { exclusion_filters, .. } = self {
            if exclusion_filters.len() > 16 || exclusion_filters.iter().any(|pattern| {
                let core = pattern.trim_start_matches('*').trim_end_matches('*');
                pattern.len() > 512 || core.is_empty()
                    || pattern.chars().filter(|c| *c == '*').count() > 1
                    || core.chars().any(|c| !(c.is_alphanumeric() || matches!(c, '.' | '_' | '$')))
            }) || exclusion_filters.iter().map(String::len).sum::<usize>() > STEP_FILTER_BYTES {
                return Err("Use at most 16 step exclusion patterns and 1,536 UTF-8 bytes in total, with one optional wildcard at the beginning or end.".into());
            }
            fields.extend(exclusion_filters.iter().cloned());
        }
        if let Self::Exceptions { class_name, include_subclasses, .. } = self {
            if !class_name.is_empty() && !main_class(class_name) {
                return Err("Enter a Java binary class name of at most 512 UTF-8 bytes, or leave it empty for all exception classes.".into());
            }
            fields.extend([class_name.clone(), include_subclasses.to_string()]);
        }
        Ok(fields)
    }
}

pub(super) fn send(job: &Arc<Job>, action: &Action) -> Result<(), String> {
    let snapshot = job.read()?;
    if !["debug", "attach", "debug-test", "debug-integration-test"]
        .contains(&snapshot.operation.as_str())
        || snapshot.state != "running"
        || job.request.configuration.debugger_mode != "jdi"
    {
        return Err("The structured debugger is not running.".into());
    }
    let state = snapshot
        .debugger_state
        .as_ref()
        .ok_or("Wait for the JDI debugger to initialize.")?;
    let fields = action.fields(state)?;
    send_fields(job, fields)
}

pub(super) fn send_fields(job: &Arc<Job>, fields: impl AsRef<[String]>) -> Result<(), String> {
    let command = base64::engine::general_purpose::STANDARD.encode(fields.as_ref().join("\0"));
    if command.len() > COMMAND_LINE_LIMIT {
        return Err("The debugger request is too large; shorten the input and retry.".into());
    }
    let mut child = job
        .child
        .lock()
        .map_err(|_| "The debugger is unavailable.")?;
    if job.cancelled.load(std::sync::atomic::Ordering::SeqCst)
        || !super::current_workspace_binding_is_current(&job.binding)
    {
        return Err("The JDI debugger session has stopped.".into());
    }
    let input = child
        .as_mut()
        .and_then(|child| child.stdin.as_ref())
        .ok_or("The JDI debugger is not ready.")?;
    debugger_input::send(input, &command)
}

pub(super) fn validate_breakpoint_options(
    condition: &str,
    hit_count: u32,
    log_message: &str,
) -> Result<(), String> {
    if condition.len() > 512
        || condition.contains(['\0', '\n', '\r'])
        || hit_count > 1_000_000_000
        || log_message.len() > 512
        || log_message.contains(['\0', '\n', '\r'])
    {
        return Err("Use a single-line condition and log message up to 512 UTF-8 bytes each, and a matching-hit count between zero and 1,000,000,000.".into());
    }
    Ok(())
}

fn validate_watch_expression(expression: &str) -> Result<(), String> {
    if expression.trim().is_empty()
        || expression.len() > 512
        || expression.contains(['\0', '\n', '\r'])
    {
        return Err(
            "Use a nonempty, single-line debugger expression up to 512 UTF-8 bytes.".into(),
        );
    }
    Ok(())
}

impl ActionRequest {
    pub(super) fn session(&self) -> SessionRequest {
        SessionRequest {
            workspace_id: self.workspace_id.clone(),
            generation: self.generation,
            session_id: self.session_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Action, DebugState, Status, Watch};

    #[test]
    fn drop_frame_requires_current_stop_selection_and_runtime_admission() {
        let mut state = suspended_state();
        let action = Action::DropFrame {
            stop_id: "stop-1".into(),
            frame_id: "stop-1:1:0".into(),
        };
        assert!(action.fields(&state).is_err());
        state.can_drop_frame = true;
        assert!(
            state.validate().is_err(),
            "admission requires a visible caller"
        );
        let mut caller = state.frames[0].clone();
        caller.id = "stop-1:1:1".into();
        state.frames.push(caller);
        assert!(state.validate().is_ok());
        assert!(action.fields(&state).is_ok());
        assert!(Action::DropFrame {
            stop_id: "old-stop".into(),
            frame_id: "stop-1:1:0".into()
        }
        .fields(&state)
        .is_err());
        assert!(Action::DropFrame {
            stop_id: "stop-1".into(),
            frame_id: "old-frame".into()
        }
        .fields(&state)
        .is_err());
        state.terminate();
        assert!(!state.can_drop_frame);
        assert!(action.fields(&state).is_err());
    }

    #[test]
    fn step_filters_validate_patterns_and_preserve_legacy_requests_and_stop_guards() {
        use super::StepKind;
        let state = suspended_state();
        let legacy: Action = serde_json::from_value(serde_json::json!({"type":"step","stopId":"stop-1","kind":"into"})).unwrap();
        assert_eq!(legacy.fields(&state).unwrap(), vec!["step", "stop-1", "into", "0"]);
        let mut action = Action::Step { stop_id: "stop-1".into(), kind: StepKind::Into, exclusion_filters: vec!["java.*".into(), "*.Helper".into(), "Main$Nested".into()] };
        assert_eq!(&action.fields(&state).unwrap()[4..], ["java.*", "*.Helper", "Main$Nested"]);
        for pattern in ["*", "*java*", "ja*va", "java.**", "java.[a-z]", "a/b", "a\0b", "a b", &"x".repeat(513)] {
            if let Action::Step { exclusion_filters, .. } = &mut action { *exclusion_filters = vec![pattern.into()]; }
            assert!(action.fields(&state).is_err(), "{pattern:?}");
        }
        if let Action::Step { exclusion_filters, .. } = &mut action { *exclusion_filters = vec!["java.*".into(); 17]; }
        assert!(action.fields(&state).is_err());
        let filters = vec!["a".repeat(512), "b".repeat(512), "c".repeat(512)];
        assert!(Action::Step { stop_id: "stop-1".into(), kind: StepKind::Into, exclusion_filters: filters.clone() }.fields(&state).is_ok());
        let mut oversized = filters;
        oversized.push("d".into());
        assert!(Action::Step { stop_id: "stop-1".into(), kind: StepKind::Into, exclusion_filters: oversized }.fields(&state).is_err());
        assert!(Action::Step { stop_id: "old".into(), kind: StepKind::Into, exclusion_filters: vec![] }.fields(&state).is_err());
    }

    #[test]
    fn exception_filters_validate_binary_names_and_keep_legacy_defaults() {
        let state = suspended_state();
        let legacy: Action = serde_json::from_value(serde_json::json!({"type":"exceptions","mode":"caught"})).unwrap();
        assert_eq!(legacy.fields(&state).unwrap(), vec!["exceptions", "", "caught", "0", "", "true"]);
        let action = |name: &str| Action::Exceptions { mode: super::ExceptionMode::All, class_name: name.into(), include_subclasses: false };
        assert_eq!(&action("Main$Problem").fields(&state).unwrap()[4..], ["Main$Problem", "false"]);
        for name in ["java.*", "a/b", "a..b", "9Problem", "a\0b", &"x".repeat(513)] {
            assert!(action(name).fields(&state).is_err(), "{name:?}");
        }
        let mut ended = state.clone(); ended.terminate();
        assert!(action("Main$Problem").fields(&ended).is_err());
    }

    #[test]
    fn mute_breakpoints_requires_provider_support_and_a_live_session() {
        let mut state = suspended_state();
        let action = super::Action::MuteBreakpoints { muted: true };
        assert!(action.fields(&state).is_err());
        state.breakpoints_muted = Some(false);
        assert_eq!(action.fields(&state).unwrap(), vec!["muteBreakpoints", "", "true", "0"]);
        state.terminate();
        assert!(action.fields(&state).is_err());
    }

    fn suspended_state() -> DebugState {
        serde_json::from_value(serde_json::json!({
            "status": "suspended",
            "stopId": "stop-1",
            "reason": "breakpoint",
            "exceptionMode": "none",
            "selectedThreadId": "1",
            "selectedFrameId": "stop-1:1:0",
            "threads": [{"id": "1", "name": "main", "status": 1, "suspended": true}],
            "frames": [{
                "id": "stop-1:1:0",
                "className": "Main",
                "methodName": "main",
                "sourcePath": "Main.java",
                "line": 10
            }],
            "variables": [],
            "variablePage": null,
            "breakpoints": [],
            "watches": [],
            "evaluation": null,
            "threadsTruncated": false,
            "framesTruncated": false,
            "variablesTruncated": false,
            "message": null,
            "error": null
        }))
        .unwrap()
    }

    #[test]
    fn one_time_evaluation_does_not_consume_or_depend_on_a_watch_slot() {
        let mut state = suspended_state();
        state.watches = (0..32)
            .map(|index| Watch {
                expression: format!("value + {index}"),
                variable: None,
                error: Some("unavailable in this frame".into()),
            })
            .collect();

        let fields = Action::Evaluate {
            stop_id: "stop-1".into(),
            expression: "value * 2".into(),
        }
        .fields(&state)
        .unwrap();

        assert_eq!(fields, ["evaluate", "stop-1", "value * 2", "0"]);
        assert_eq!(state.watches.len(), 32);
    }

    #[test]
    fn local_assignment_is_bound_to_the_current_stop_and_selected_frame() {
        let state = suspended_state();
        assert_eq!(
            Action::SetLocalValue {
                stop_id: "stop-1".into(),
                frame_id: "stop-1:1:0".into(),
                assignment: "value = value + 1".into(),
            }
            .fields(&state)
            .unwrap(),
            [
                "setLocalValue",
                "stop-1",
                "value = value + 1",
                "0",
                "stop-1:1:0"
            ]
        );
        assert!(Action::SetLocalValue {
            stop_id: "stop-1".into(),
            frame_id: "retired-frame".into(),
            assignment: "value = 43".into(),
        }
        .fields(&state)
        .is_err());
        assert!(Action::SetLocalValue {
            stop_id: "old-stop".into(),
            frame_id: "stop-1:1:0".into(),
            assignment: "value = 43".into(),
        }
        .fields(&state)
        .is_err());
    }

    #[test]
    fn loaded_class_discovery_does_not_require_a_suspended_stop() {
        let mut state = suspended_state();
        state.status = Status::Running;
        state.stop_id = None;
        state.selected_thread_id = None;
        state.selected_frame_id = None;
        state.frames.clear();
        assert_eq!(
            Action::ListLoadedClasses.fields(&state).unwrap(),
            ["listLoadedClasses", "", "", "0"]
        );
    }

    #[test]
    fn unicode_loaded_classes_follow_the_jvm_utf16_string_order() {
        let mut state = suspended_state();
        state.loaded_classes = vec![
            super::LoadedClass {
                class_name: "pkg.𐐀".into(),
                class_loader_count: 1,
            },
            super::LoadedClass {
                class_name: "pkg.ￜ".into(),
                class_loader_count: 1,
            },
        ];
        state.validate().unwrap();
        state.loaded_classes.reverse();
        assert!(state.validate().is_err());
    }

    #[test]
    fn runtime_evaluation_must_match_the_current_stop_and_frame() {
        let mut state = suspended_state();
        state.evaluation = Some(super::Evaluation {
            stop_id: "stop-1".into(),
            frame_id: "stop-1:1:0".into(),
            expression: "value * 2".into(),
            variable: Some(super::Variable {
                name: "value * 2".into(),
                r#type: "int".into(),
                value: "84".into(),
                value_truncated: false,
                reference: None,
                child_count: 0,
            }),
            error: None,
        });
        state.validate().unwrap();

        state.evaluation.as_mut().unwrap().frame_id = "retired-frame".into();
        assert!(state.validate().is_err());
    }
}
