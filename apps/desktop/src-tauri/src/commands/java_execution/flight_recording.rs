//! Workspace-contained Java Flight Recorder output for application launches.
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::workspace::{ensure_within_root, resolve_new_path_in_root};

pub(super) struct FlightRecording {
    pub jvm_option: String,
    pub workspace_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EventTypeSummary {
    pub name: String,
    pub count: u64,
    pub size_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Summary {
    pub recording_version: String,
    pub chunks: u32,
    pub start_time: String,
    pub duration: String,
    pub events: Vec<EventTypeSummary>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EventField {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StackFrame {
    pub class_name: Option<String>,
    pub method_name: Option<String>,
    pub line_number: Option<i64>,
    pub frame_type: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TimelineEvent {
    pub start_time: String,
    pub duration: Option<String>,
    pub thread_name: Option<String>,
    pub payload: Vec<EventField>,
    pub payload_truncated: bool,
    pub stack_frames: Vec<StackFrame>,
    pub stack_trace_truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Timeline {
    pub event_type: String,
    pub event_count: usize,
    pub truncated: bool,
    pub events: Vec<TimelineEvent>,
}

const SUMMARY_OUTPUT_LIMIT: usize = 128 * 1024;
const SUMMARY_EVENT_LIMIT: usize = 512;
const SUMMARY_TIMEOUT: Duration = Duration::from_secs(15);
const TIMELINE_OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
const TIMELINE_EVENT_LIMIT: usize = 1_000;
const TIMELINE_TIMEOUT: Duration = Duration::from_secs(20);
const EVENT_PAYLOAD_FIELD_LIMIT: usize = 16;
const EVENT_PAYLOAD_FIELD_NAME_LIMIT: usize = 128;
const EVENT_PAYLOAD_FIELD_VALUE_LIMIT: usize = 256;
const EVENT_PAYLOAD_TOTAL_LIMIT: usize = 4 * 1024;
const STACK_FRAME_LIMIT: usize = 32;
const STACK_FRAME_TEXT_LIMIT: usize = 512;

pub(super) fn available(home: &Path) -> bool {
    let Ok(file) = fs::File::open(home.join("release")) else {
        return false;
    };
    let mut release = String::new();
    if file.take(16_385).read_to_string(&mut release).is_err() || release.len() > 16_384 {
        return false;
    }
    let Some(version) = release.lines().find_map(|line| {
        line.strip_prefix("JAVA_VERSION=")
            .map(|value| value.trim_matches('"'))
    }) else {
        return false;
    };
    let mut components = version.split('.');
    let first = components
        .next()
        .and_then(|value| value.parse::<u32>().ok());
    let major = match first {
        Some(1) => components
            .next()
            .and_then(|value| value.parse::<u32>().ok()),
        value => value,
    };
    major.is_some_and(|major| major >= 11)
        && home.join("lib/jfr/profile.jfc").is_file()
        && home
            .join("bin")
            .join(super::executable_name("jfr"))
            .is_file()
}

fn recording_tool_command(home: &Path, recording: &Path) -> Command {
    let executable = home.join("bin").join(super::executable_name("jfr"));
    let mut command = Command::new(executable);
    command
        .current_dir(recording.parent().unwrap_or(home))
        .env("JAVA_HOME", home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "linux")]
    if let Some(app_dir) = std::env::var_os("APPDIR")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
    {
        // An AppImage points Python at its own files. A JDK launcher may be a
        // wrapper that uses the host interpreter and needs the host libraries.
        if std::env::var_os("PYTHONHOME").is_some_and(|value| {
            std::env::split_paths(&value).any(|entry| entry.starts_with(&app_dir))
        }) {
            command.env_remove("PYTHONHOME");
        }
        if let Some(value) = std::env::var_os("PYTHONPATH") {
            let entries = std::env::split_paths(&value).collect::<Vec<_>>();
            if entries.iter().any(|entry| entry.starts_with(&app_dir)) {
                let host_paths = entries
                    .iter()
                    .filter(|entry| !entry.as_os_str().is_empty() && !entry.starts_with(&app_dir))
                    .collect::<Vec<_>>();
                if host_paths.is_empty() {
                    command.env_remove("PYTHONPATH");
                } else if let Ok(value) = std::env::join_paths(host_paths) {
                    command.env("PYTHONPATH", value);
                }
            }
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

pub(super) fn summarize(home: &Path, recording: &Path) -> Result<Summary, String> {
    if !available(home) {
        return Err("The selected JDK's Flight Recorder tool is unavailable.".into());
    }
    if !recording.is_file() {
        return Err("The Java Flight Recorder file is unavailable.".into());
    }

    let mut command = recording_tool_command(home, recording);
    command.arg("summary").arg(recording);
    let mut child = command
        .spawn()
        .map_err(|_| "Cannot start the selected JDK's Flight Recorder tool.".to_owned())?;
    let stdout = child.stdout.take().ok_or_else(|| {
        super::kill_owned_process(&mut child);
        "Cannot read Flight Recorder summary output."
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        super::kill_owned_process(&mut child);
        "Cannot read Flight Recorder diagnostics."
    })?;
    let oversized = Arc::new(AtomicBool::new(false));
    let stdout_oversized = oversized.clone();
    let stderr_oversized = oversized.clone();
    let output =
        thread::spawn(move || read_bounded(stdout, SUMMARY_OUTPUT_LIMIT, stdout_oversized));
    let diagnostics = thread::spawn(move || read_bounded(stderr, 16 * 1024, stderr_oversized));

    let deadline = Instant::now() + SUMMARY_TIMEOUT;
    let mut timed_out = false;
    let status = loop {
        if oversized.load(Ordering::SeqCst) {
            super::kill_owned_process(&mut child);
            break None;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            super::kill_owned_process(&mut child);
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                super::kill_owned_process(&mut child);
                break None;
            }
        }
    };
    let output = output
        .join()
        .map_err(|_| "The Flight Recorder summary reader failed.")?;
    let diagnostics = diagnostics
        .join()
        .map_err(|_| "The Flight Recorder diagnostic reader failed.")?;
    let output = output.map_err(|_| "Cannot read Flight Recorder summary output.")?;
    let diagnostics = diagnostics.map_err(|_| "Cannot read Flight Recorder diagnostics.")?;
    if timed_out {
        return Err(
            "The selected JDK did not finish reading the Flight Recorder file in time.".into(),
        );
    }
    if oversized.load(Ordering::SeqCst) {
        return Err("Flight Recorder summary output exceeded its size limit.".into());
    }
    let Some(status) = status else {
        return Err("The selected JDK's Flight Recorder process ended unexpectedly.".into());
    };
    if !status.success() {
        let diagnostic = String::from_utf8_lossy(&diagnostics).trim().to_owned();
        return Err(if diagnostic.is_empty() {
            "The selected JDK could not read this Flight Recorder file.".into()
        } else {
            format!("The selected JDK could not read this Flight Recorder file: {diagnostic}")
        });
    }
    let output = String::from_utf8(output)
        .map_err(|_| "The selected JDK returned invalid Flight Recorder summary text.")?;
    parse_summary(&output)
}

pub(super) fn timeline(
    home: &Path,
    recording: &Path,
    event_type: &str,
) -> Result<Timeline, String> {
    if !valid_event_type(event_type) {
        return Err("Choose a valid Flight Recorder event type from the recording summary.".into());
    }
    if !available(home) {
        return Err("The selected JDK's Flight Recorder tool is unavailable.".into());
    }
    if !recording.is_file() {
        return Err("The Java Flight Recorder file is unavailable.".into());
    }

    let mut command = recording_tool_command(home, recording);
    command
        .arg("print")
        .arg("--json")
        .arg("--events")
        .arg(event_type)
        .arg("--stack-depth")
        .arg(STACK_FRAME_LIMIT.to_string())
        .arg(recording);
    let mut child = command
        .spawn()
        .map_err(|_| "Cannot start the selected JDK's Flight Recorder tool.".to_owned())?;
    let stdout = child.stdout.take().ok_or_else(|| {
        super::kill_owned_process(&mut child);
        "Cannot read Flight Recorder timeline output."
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        super::kill_owned_process(&mut child);
        "Cannot read Flight Recorder diagnostics."
    })?;
    let oversized = Arc::new(AtomicBool::new(false));
    let stdout_oversized = oversized.clone();
    let stderr_oversized = oversized.clone();
    let output =
        thread::spawn(move || read_bounded(stdout, TIMELINE_OUTPUT_LIMIT, stdout_oversized));
    let diagnostics = thread::spawn(move || read_bounded(stderr, 16 * 1024, stderr_oversized));

    let deadline = Instant::now() + TIMELINE_TIMEOUT;
    let mut timed_out = false;
    let status = loop {
        if oversized.load(Ordering::SeqCst) {
            super::kill_owned_process(&mut child);
            break None;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            super::kill_owned_process(&mut child);
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                super::kill_owned_process(&mut child);
                break None;
            }
        }
    };
    let output = output
        .join()
        .map_err(|_| "The Flight Recorder timeline reader failed.")?;
    let diagnostics = diagnostics
        .join()
        .map_err(|_| "The Flight Recorder diagnostic reader failed.")?;
    let output = output.map_err(|_| "Cannot read Flight Recorder timeline output.")?;
    let diagnostics = diagnostics.map_err(|_| "Cannot read Flight Recorder diagnostics.")?;
    if timed_out {
        return Err(
            "The selected JDK did not finish reading the Flight Recorder file in time.".into(),
        );
    }
    if oversized.load(Ordering::SeqCst) {
        return Err(
            "This event type produces too much timeline data; choose a less frequent event type."
                .into(),
        );
    }
    let Some(status) = status else {
        return Err("The selected JDK's Flight Recorder process ended unexpectedly.".into());
    };
    if !status.success() {
        let diagnostic = String::from_utf8_lossy(&diagnostics).trim().to_owned();
        return Err(if diagnostic.is_empty() {
            "The selected JDK could not read this Flight Recorder event type.".into()
        } else {
            format!("The selected JDK could not read this Flight Recorder event type: {diagnostic}")
        });
    }
    let output = String::from_utf8(output)
        .map_err(|_| "The selected JDK returned invalid Flight Recorder timeline text.")?;
    parse_timeline(&output, event_type)
}

fn valid_event_type(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.$".contains(&byte))
}

fn parse_timeline(text: &str, event_type: &str) -> Result<Timeline, String> {
    if !valid_event_type(event_type) {
        return Err("Invalid Flight Recorder event type.".into());
    }
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| "The selected JDK returned malformed Flight Recorder timeline data.")?;
    let raw = value
        .get("recording")
        .and_then(|recording| recording.get("events"))
        .and_then(serde_json::Value::as_array)
        .filter(|events| events.len() <= 200_000)
        .ok_or("The selected JDK returned an invalid Flight Recorder event list.")?;
    let mut events = Vec::with_capacity(raw.len().min(TIMELINE_EVENT_LIMIT));
    for event in raw {
        if event.get("type").and_then(serde_json::Value::as_str) != Some(event_type) {
            return Err("The Flight Recorder returned an unexpected event type.".into());
        }
        if events.len() >= TIMELINE_EVENT_LIMIT {
            continue;
        }
        let values = event
            .get("values")
            .and_then(serde_json::Value::as_object)
            .ok_or("The selected JDK returned an invalid Flight Recorder event.")?;
        let start_time = values
            .get("startTime")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .ok_or("The selected JDK returned an event without a valid timestamp.")?;
        let duration = match values.get("duration") {
            Some(serde_json::Value::String(value)) if value.len() <= 128 => Some(value.clone()),
            Some(serde_json::Value::Null) | None => None,
            _ => return Err("The selected JDK returned an invalid event duration.".into()),
        };
        let thread_name = match values
            .get("eventThread")
            .or_else(|| values.get("sampledThread"))
            .and_then(|thread| thread.get("javaName"))
        {
            Some(serde_json::Value::String(value)) if value.len() <= 512 => Some(value.clone()),
            Some(serde_json::Value::Null) | None => None,
            _ => return Err("The selected JDK returned an invalid event thread name.".into()),
        };
        let (stack_frames, stack_trace_truncated) = parse_stack_trace(values.get("stackTrace"))?;
        let mut payload = Vec::with_capacity(EVENT_PAYLOAD_FIELD_LIMIT.min(values.len()));
        let mut payload_size = 0;
        let mut payload_truncated = false;
        for (name, value) in values {
            if matches!(
                name.as_str(),
                "startTime" | "duration" | "eventThread" | "sampledThread" | "stackTrace"
            ) {
                continue;
            }
            if payload.len() >= EVENT_PAYLOAD_FIELD_LIMIT {
                payload_truncated = true;
                break;
            }
            let (name, name_truncated) = truncate_text(name, EVENT_PAYLOAD_FIELD_NAME_LIMIT);
            let remaining = EVENT_PAYLOAD_TOTAL_LIMIT.saturating_sub(payload_size + name.len());
            if remaining == 0 {
                payload_truncated = true;
                break;
            }
            let value_limit = EVENT_PAYLOAD_FIELD_VALUE_LIMIT.min(remaining);
            let (value, value_truncated) = bounded_json_value(value, value_limit);
            payload_size += name.len() + value.len();
            payload_truncated |= name_truncated || value_truncated;
            payload.push(EventField { name, value });
            if payload_size >= EVENT_PAYLOAD_TOTAL_LIMIT {
                payload_truncated = true;
                break;
            }
        }
        events.push(TimelineEvent {
            start_time: start_time.to_owned(),
            duration,
            thread_name,
            payload,
            payload_truncated,
            stack_frames,
            stack_trace_truncated,
        });
    }
    Ok(Timeline {
        event_type: event_type.into(),
        event_count: raw.len(),
        truncated: raw.len() > TIMELINE_EVENT_LIMIT,
        events,
    })
}

fn parse_stack_trace(value: Option<&serde_json::Value>) -> Result<(Vec<StackFrame>, bool), String> {
    let Some(value) = value else {
        return Ok((Vec::new(), false));
    };
    if value.is_null() {
        return Ok((Vec::new(), false));
    }
    let trace = value
        .as_object()
        .ok_or("The selected JDK returned an invalid Flight Recorder stack trace.")?;
    let raw_frames = trace
        .get("frames")
        .and_then(serde_json::Value::as_array)
        .filter(|frames| frames.len() <= 256)
        .ok_or("The selected JDK returned an invalid Flight Recorder stack frame list.")?;
    let mut truncated = match trace.get("truncated") {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::Null) | None => false,
        _ => {
            return Err("The selected JDK returned an invalid Flight Recorder stack trace.".into())
        }
    } || raw_frames.len() > STACK_FRAME_LIMIT;
    let mut frames = Vec::with_capacity(raw_frames.len().min(STACK_FRAME_LIMIT));
    for frame in raw_frames.iter().take(STACK_FRAME_LIMIT) {
        let frame = frame
            .as_object()
            .ok_or("The selected JDK returned an invalid Flight Recorder stack frame.")?;
        let method = match frame.get("method") {
            Some(serde_json::Value::Object(method)) => Some(method),
            Some(serde_json::Value::Null) | None => None,
            _ => {
                return Err(
                    "The selected JDK returned an invalid Flight Recorder stack frame.".into(),
                )
            }
        };
        let (class_name, method_name) = if let Some(method) = method {
            let class = method.get("type").and_then(|value| value.get("name"));
            let (class_name, class_truncated) =
                optional_stack_text(class, "class name", STACK_FRAME_TEXT_LIMIT)?;
            let (method_name, method_truncated) =
                optional_stack_text(method.get("name"), "method name", STACK_FRAME_TEXT_LIMIT)?;
            truncated |= class_truncated || method_truncated;
            (class_name, method_name)
        } else {
            (None, None)
        };
        let (frame_type, frame_type_truncated) =
            optional_stack_text(frame.get("type"), "frame type", 64)?;
        let line_number = optional_stack_integer(frame.get("lineNumber"), "line number")?;
        truncated |= frame_type_truncated;
        frames.push(StackFrame {
            class_name,
            method_name,
            line_number,
            frame_type,
        });
    }
    Ok((frames, truncated))
}

fn optional_stack_text(
    value: Option<&serde_json::Value>,
    field_name: &str,
    limit: usize,
) -> Result<(Option<String>, bool), String> {
    match value {
        None | Some(serde_json::Value::Null) => Ok((None, false)),
        Some(serde_json::Value::String(value)) => {
            let (value, truncated) = truncate_text(value, limit);
            Ok((Some(value), truncated))
        }
        _ => Err(format!(
            "The selected JDK returned an invalid stack {field_name}."
        )),
    }
}

fn optional_stack_integer(
    value: Option<&serde_json::Value>,
    field_name: &str,
) -> Result<Option<i64>, String> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(value)) => value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
            .map(Some)
            .ok_or_else(|| format!("The selected JDK returned an invalid stack {field_name}.")),
        _ => Err(format!(
            "The selected JDK returned an invalid stack {field_name}."
        )),
    }
}

fn bounded_json_value(value: &serde_json::Value, limit: usize) -> (String, bool) {
    let rendered = serde_json::to_string(value).unwrap_or_else(|_| "[unavailable]".into());
    truncate_text(&rendered, limit)
}

fn truncate_text(value: &str, limit: usize) -> (String, bool) {
    if value.len() <= limit {
        return (value.to_owned(), false);
    }
    let suffix = "…";
    let content_limit = limit.saturating_sub(suffix.len());
    let mut end = content_limit.min(value.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = value[..end].to_owned();
    if limit >= suffix.len() {
        truncated.push_str(suffix);
    }
    (truncated, true)
}

fn read_bounded(
    mut reader: impl Read,
    limit: usize,
    oversized: Arc<AtomicBool>,
) -> std::io::Result<Vec<u8>> {
    let mut output = Vec::with_capacity(limit.min(16 * 1024));
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Err(error) => return Err(error),
            Ok(count) => {
                let remaining = limit.saturating_sub(output.len());
                let retained = count.min(remaining);
                output.extend_from_slice(&buffer[..retained]);
                if retained != count {
                    oversized.store(true, Ordering::SeqCst);
                }
            }
        }
    }
    Ok(output)
}

fn parse_summary(text: &str) -> Result<Summary, String> {
    let mut recording_version = None;
    let mut chunks = None;
    let mut start_time = None;
    let mut duration = None;
    let mut events = Vec::new();
    let mut event_table = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("Version:") {
            recording_version = Some(value.trim().to_owned());
            continue;
        }
        if let Some(value) = line.strip_prefix("Chunks:") {
            chunks = value.trim().parse::<u32>().ok();
            continue;
        }
        if let Some(value) = line.strip_prefix("Start:") {
            start_time = Some(value.trim().to_owned());
            continue;
        }
        if let Some(value) = line.strip_prefix("Duration:") {
            duration = Some(value.trim().to_owned());
            continue;
        }
        if !event_table && !line.is_empty() && line.chars().all(|character| character == '=') {
            event_table = true;
            continue;
        }
        if !event_table || line.is_empty() {
            continue;
        }
        if line.starts_with("Event Type") {
            continue;
        }
        let mut columns = line.split_whitespace();
        let Some(name) = columns.next() else { continue };
        let count = columns
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or("The selected JDK returned an unsupported Flight Recorder event row.")?;
        let size_bytes = columns
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or("The selected JDK returned an unsupported Flight Recorder event row.")?;
        if columns.next().is_some()
            || name.len() > 512
            || !name.chars().all(|character| {
                character.is_alphanumeric() || matches!(character, '.' | '_' | '$')
            })
            || count > 9_007_199_254_740_991
            || size_bytes > 9_007_199_254_740_991
        {
            return Err(
                "The selected JDK returned an unsupported Flight Recorder event row.".into(),
            );
        }
        events.push(EventTypeSummary {
            name: name.to_owned(),
            count,
            size_bytes,
        });
        if events.len() > SUMMARY_EVENT_LIMIT {
            return Err(
                "The Flight Recorder file contains too many event types to summarize.".into(),
            );
        }
    }
    if !event_table
        || recording_version
            .as_ref()
            .is_none_or(|value| value.is_empty() || value.len() > 64)
        || chunks.is_none()
        || start_time
            .as_ref()
            .is_none_or(|value| value.is_empty() || value.len() > 128)
        || duration
            .as_ref()
            .is_none_or(|value| value.is_empty() || value.len() > 128)
    {
        return Err("The selected JDK returned an incomplete Flight Recorder summary.".into());
    }
    Ok(Summary {
        recording_version: recording_version.unwrap(),
        chunks: chunks.unwrap(),
        start_time: start_time.unwrap(),
        duration: duration.unwrap(),
        events,
    })
}

impl FlightRecording {
    pub(super) fn create(
        workspace: &Path,
        project_root: &Path,
        project_path: &str,
        application_directory: &Path,
    ) -> Result<Self, String> {
        let base = project_root.join(".ide").join("flight-recordings");
        resolve_new_path_in_root(workspace, &base)?;
        fs::create_dir_all(&base)
            .map_err(|_| "Cannot create the project's Flight Recorder output directory.")?;
        let base = base
            .canonicalize()
            .map_err(|_| "The project's Flight Recorder directory is unavailable.")?;
        ensure_within_root(workspace, &base)?;

        let token = (0..8)
            .find_map(|_| {
                let mut bytes = [0_u8; 16];
                getrandom::fill(&mut bytes).ok()?;
                let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
                match fs::create_dir(base.join(&token)) {
                    Ok(()) => Some(Ok(token)),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                    Err(_) => Some(Err(())),
                }
            })
            .ok_or("Cannot allocate a unique Flight Recorder output directory.")?
            .map_err(|_| "Cannot create a unique Flight Recorder output directory.")?;

        let relative = format!(".ide/flight-recordings/{token}/recording.jfr");
        let project_prefix = project_path.trim_matches('/');
        let workspace_path = if project_prefix.is_empty() || project_prefix == "." {
            relative.clone()
        } else {
            PathBuf::from(project_prefix)
                .join(&relative)
                .to_string_lossy()
                .replace('\\', "/")
        };

        // JFR resolves filename against the application process, independently of the
        // project's build and recording storage directories.
        let target = project_root.join(&relative);
        let filename = relative_recording_filename(application_directory, &target)?;
        Ok(Self {
            jvm_option: format!(
                "-XX:StartFlightRecording=filename={filename},settings=profile,dumponexit=true"
            ),
            workspace_path,
        })
    }
}

fn relative_recording_filename(
    application_directory: &Path,
    recording: &Path,
) -> Result<String, String> {
    let from: Vec<_> = application_directory.components().collect();
    let to: Vec<_> = recording.components().collect();
    let common = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    if common == 0 {
        return Err(
            "The Flight Recorder destination is not relative to the application directory.".into(),
        );
    }
    let mut path = PathBuf::new();
    for _ in common..from.len() {
        path.push("..");
    }
    for part in &to[common..] {
        path.push(part.as_os_str());
    }
    let value = path
        .to_str()
        .ok_or("The Flight Recorder destination must be UTF-8.")?;
    // JFR expands these even inside quotes, and its diagnostic argument parser
    // does not remove backslashes used to escape embedded quotes.
    if value.contains("%p") || value.contains("%t") || value.chars().any(char::is_control) {
        return Err("The relative Flight Recorder destination contains unsupported control characters or filename substitutions.".into());
    }
    if !value.contains(['\'', '"', ',']) {
        return Ok(value.to_owned());
    }
    if !value.contains('"') {
        return Ok(format!("\"{value}\""));
    }
    if !value.contains('\'') {
        return Ok(format!("'{value}'"));
    }
    Err("The relative Flight Recorder destination contains both quote styles; choose an application directory inside the project.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUMMARY: &str = "Version: 2.1\nChunks: 1\nStart: 2026-10-18 12:00:00 (UTC)\nDuration: 1 s\n\n Event Type                       Count  Size (bytes)\n=====================================================\njdk.ExecutionSample                   9          108\njdk.ThreadStart                       2           64\n";

    #[test]
    fn parses_jdk_flight_recorder_event_summary() {
        let summary = parse_summary(SUMMARY).unwrap();
        assert_eq!(summary.recording_version, "2.1");
        assert_eq!(summary.chunks, 1);
        assert_eq!(summary.start_time, "2026-10-18 12:00:00 (UTC)");
        assert_eq!(summary.duration, "1 s");
        assert_eq!(summary.events.len(), 2);
        assert_eq!(summary.events[0].name, "jdk.ExecutionSample");
        assert_eq!(summary.events[0].count, 9);
        assert_eq!(summary.events[0].size_bytes, 108);
    }

    #[test]
    fn rejects_incomplete_or_unsafe_jfr_summaries() {
        assert!(parse_summary("Version: 2.1\n").is_err());
        let unsafe_row = SUMMARY.replace("jdk.ExecutionSample", "../../outside");
        assert!(parse_summary(&unsafe_row).is_err());
        let unsafe_number = SUMMARY.replace("9          108", "9007199254740992 108");
        assert!(parse_summary(&unsafe_number).is_err());
    }

    #[test]
    fn parses_bounded_event_payload_and_stack_frames() {
        let raw = r#"{"recording":{"events":[{"type":"jdk.GarbageCollection","values":{"startTime":"2026-10-20T12:00:00.000+02:00","duration":"PT0.007S","eventThread":{"javaName":"VM Thread"},"stackTrace":{"frames":[{"method":{"type":{"name":"example.Main"},"name":"collect"},"lineNumber":5,"type":"Interpreted"}],"truncated":false},"cause":"System.gc()"}},{"type":"jdk.GarbageCollection","values":{"startTime":"2026-10-20T12:00:01.000+02:00","duration":"PT0.010S","eventThread":null,"cause":"Allocation Failure"}}]}}"#;
        let timeline = parse_timeline(raw, "jdk.GarbageCollection").unwrap();
        assert_eq!(timeline.event_type, "jdk.GarbageCollection");
        assert_eq!(timeline.event_count, 2);
        assert!(!timeline.truncated);
        assert_eq!(timeline.events.len(), 2);
        assert_eq!(
            timeline.events[0].start_time,
            "2026-10-20T12:00:00.000+02:00"
        );
        assert_eq!(timeline.events[0].duration.as_deref(), Some("PT0.007S"));
        assert_eq!(timeline.events[0].thread_name.as_deref(), Some("VM Thread"));
        assert_eq!(timeline.events[0].payload.len(), 1);
        assert_eq!(timeline.events[0].payload[0].name, "cause");
        assert_eq!(timeline.events[0].payload[0].value, "\"System.gc()\"");
        assert!(!timeline.events[0].payload_truncated);
        assert_eq!(timeline.events[0].stack_frames.len(), 1);
        assert_eq!(
            timeline.events[0].stack_frames[0].method_name.as_deref(),
            Some("collect")
        );
        assert_eq!(timeline.events[1].thread_name, None);
        assert_eq!(
            timeline.events[1].payload[0].value,
            "\"Allocation Failure\""
        );
    }

    #[test]
    fn bounds_jfr_event_payload_fields_and_keeps_stack_traces_separate() {
        let mut values = serde_json::Map::new();
        values.insert(
            "startTime".into(),
            serde_json::Value::String("2026-10-20T12:00:00.000+02:00".into()),
        );
        values.insert(
            "stackTrace".into(),
            serde_json::json!({"truncated": false, "frames": [{"method": null}]}),
        );
        values.insert(
            "aLarge".into(),
            serde_json::Value::String("x".repeat(2_000)),
        );
        for index in 0..EVENT_PAYLOAD_FIELD_LIMIT + 2 {
            values.insert(format!("field{index:02}"), serde_json::json!(index));
        }
        let input = serde_json::json!({
            "recording": { "events": [{ "type": "jdk.ExecutionSample", "values": values }] }
        });
        let timeline = parse_timeline(&input.to_string(), "jdk.ExecutionSample").unwrap();
        let event = &timeline.events[0];
        assert_eq!(event.payload.len(), EVENT_PAYLOAD_FIELD_LIMIT);
        assert!(event.payload_truncated);
        assert!(event.payload[0].value.ends_with('…'));
        assert!(event
            .payload
            .iter()
            .all(|field| field.value.len() <= EVENT_PAYLOAD_FIELD_VALUE_LIMIT));
        assert!(
            event
                .payload
                .iter()
                .map(|field| field.name.len() + field.value.len())
                .sum::<usize>()
                <= EVENT_PAYLOAD_TOTAL_LIMIT
        );
        assert!(!event.payload.iter().any(|field| field.name == "stackTrace"));
        assert_eq!(event.stack_frames.len(), 1);
    }

    #[test]
    fn parses_sampled_threads_and_bounds_java_stack_frames() {
        let frame = serde_json::json!({
            "method": {
                "type": { "name": "example.Main" },
                "name": "cpuWork"
            },
            "lineNumber": 12,
            "type": "JIT compiled"
        });
        let frames = std::iter::repeat_n(frame, STACK_FRAME_LIMIT + 2).collect::<Vec<_>>();
        let raw = serde_json::json!({
            "recording": { "events": [{
                "type": "jdk.ExecutionSample",
                "values": {
                    "startTime": "2026-10-20T12:00:00.000+02:00",
                    "sampledThread": { "javaName": "main" },
                    "stackTrace": { "truncated": false, "frames": frames }
                }
            }] }
        });
        let timeline = parse_timeline(&raw.to_string(), "jdk.ExecutionSample").unwrap();
        let event = &timeline.events[0];
        assert_eq!(event.thread_name.as_deref(), Some("main"));
        assert_eq!(event.stack_frames.len(), STACK_FRAME_LIMIT);
        assert!(event.stack_trace_truncated);
        assert_eq!(
            event.stack_frames[0].class_name.as_deref(),
            Some("example.Main")
        );
        assert_eq!(
            event.stack_frames[0].method_name.as_deref(),
            Some("cpuWork")
        );
        assert_eq!(event.stack_frames[0].line_number, Some(12));
        assert_eq!(
            event.stack_frames[0].frame_type.as_deref(),
            Some("JIT compiled")
        );
    }

    #[test]
    fn refuses_unbounded_or_mismatched_event_timeline_data() {
        let event =
            r#"{"type":"jdk.GCPhasePause","values":{"startTime":"2026-10-20T12:00:00.000+02:00"}}"#;
        let many = format!(
            "{{\"recording\":{{\"events\":[{}]}}}}",
            std::iter::repeat_n(event, TIMELINE_EVENT_LIMIT + 1)
                .collect::<Vec<_>>()
                .join(",")
        );
        let timeline = parse_timeline(&many, "jdk.GCPhasePause").unwrap();
        assert_eq!(timeline.event_count, TIMELINE_EVENT_LIMIT + 1);
        assert_eq!(timeline.events.len(), TIMELINE_EVENT_LIMIT);
        assert!(timeline.truncated);
        assert!(parse_timeline(event, "jdk.GCPhasePause").is_err());
        assert!(!valid_event_type("../../outside"));
        assert!(!valid_event_type("jdk.GC Phase"));
    }

    #[test]
    fn reports_flight_recorder_only_for_supported_full_jdks() {
        let root = std::env::temp_dir().join(format!("ide-jfr-capability-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("lib/jfr")).unwrap();
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("release"), "JAVA_VERSION=\"21.0.1\"\n").unwrap();
        fs::write(root.join("lib/jfr/profile.jfc"), "").unwrap();
        fs::write(
            root.join("bin").join(super::super::executable_name("jfr")),
            "",
        )
        .unwrap();
        assert!(available(&root));
        fs::write(root.join("release"), "JAVA_VERSION=\"8.0.402\"\n").unwrap();
        assert!(!available(&root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_jfr_filename_expansion_and_unrepresentable_quote_combinations() {
        let root = std::env::temp_dir();
        for name in ["project-%p", "project-%t", "project'\"", "project\n"] {
            assert!(
                relative_recording_filename(
                    &root.join("runtime"),
                    &root.join(name).join("recording.jfr")
                )
                .is_err(),
                "{name:?}"
            );
        }
    }

    #[test]
    fn allocates_distinct_workspace_contained_recording_paths_without_precreating_files() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let root = std::env::temp_dir().join(format!(
            "ide-jfr-output-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let first = FlightRecording::create(&root, &root, "", &root).unwrap();
        let second = FlightRecording::create(&root, &root, "", &root).unwrap();
        assert_ne!(first.workspace_path, second.workspace_path);
        assert!(first.workspace_path.starts_with(".ide/flight-recordings/"));
        assert!(first
            .jvm_option
            .contains("settings=profile,dumponexit=true"));
        assert!(!root.join(&first.workspace_path).exists());
        assert!(!root.join(&second.workspace_path).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
