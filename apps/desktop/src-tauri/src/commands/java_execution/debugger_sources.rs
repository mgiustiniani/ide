//! Saved source binding for debugger presentation; runtime class information remains JDI-owned.
use super::{collect_sources, execution_root, structured_debugger, Job, SessionRequest};
use crate::workspace::resolve_existing_path_in_root;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const FILE_LIMIT: u64 = 2 * 1024 * 1024;
const TOTAL_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedBreakpoint {
    pub source_path: String,
    pub line: u32,
    pub fingerprint: String,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub hit_count: u32,
    #[serde(default)]
    pub log_message: String,
}

pub(super) fn validate_initial(request: &super::Request) -> Result<(), String> {
    if request.source_breakpoints.is_empty() {
        return Ok(());
    }
    if (request.operation != "debug" && !super::debug_test::is_debug(&request.operation)) || request.configuration.debugger_mode != "jdi" {
        return Err("Saved source breakpoints require Structured Java debugger (JDI).".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    if request.source_breakpoints.len() > 128
        || request.source_breakpoints.iter().any(|point| {
            let path = &point.source_path;
            point.line == 0
                || structured_debugger::validate_breakpoint_options(
                    &point.condition,
                    point.hit_count,
                    &point.log_message,
                )
                .is_err()
                || point.line > i32::MAX as u32
                || path.len() > 1024
                || !path.ends_with(".java")
                || path.starts_with('/')
                || path.contains(['\\', ':', '\0', '\n', '\r'])
                || path
                    .split('/')
                    .any(|p| p.is_empty() || p == "." || p == "..")
                || point.fingerprint.len() != 64
                || !point
                    .fingerprint
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                || !seen.insert((path, point.line))
        })
    {
        return Err("Invalid saved source breakpoints or breakpoint limit exceeded.".into());
    }
    Ok(())
}

pub(super) struct Sources {
    root: PathBuf,
    files: BTreeMap<String, [u8; 32]>,
}

fn bytes(root: &Path, path: &Path) -> Result<Vec<u8>, String> {
    let canonical = resolve_existing_path_in_root(root, path)?;
    if canonical != path || !std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file()) {
        return Err("Debugger source must be an unchanged regular workspace file.".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file: File = options
        .open(path)
        .map_err(|_| "Cannot read debugger source.")?;
    if !file
        .metadata()
        .is_ok_and(|m| m.is_file() && m.len() <= FILE_LIMIT)
    {
        return Err("Debugger source exceeds its file limit or is unavailable.".into());
    }
    let mut text = Vec::new();
    file.take(FILE_LIMIT + 1)
        .read_to_end(&mut text)
        .map_err(|_| "Cannot read debugger source.")?;
    if text.len() as u64 > FILE_LIMIT || resolve_existing_path_in_root(root, path)? != path {
        return Err("Debugger source changed or exceeded its file limit.".into());
    }
    Ok(text)
}

impl Sources {
    pub(super) fn initial_breakpoints(
        &self,
        job: &Arc<Job>,
        report_excluded: bool,
    ) -> Result<String, String> {
        let mut lines = String::from("3\n");
        let mut inspected = BTreeMap::new();
        for point in &job.request.source_breakpoints {
            let Some(expected) = self.files.get(&point.source_path) else {
                if report_excluded {
                    job.append(format!("Saved breakpoint {}:{} is outside captured sources for the selected project; it was not installed.\n", point.source_path, point.line).as_bytes());
                }
                continue;
            };
            let fingerprint: String = expected.iter().map(|b| format!("{b:02x}")).collect();
            if !inspected.contains_key(&point.source_path) {
                let saved = bytes(&self.root, &self.root.join(&point.source_path))?;
                let current: [u8; 32] = Sha256::digest(&saved).into();
                inspected.insert(
                    point.source_path.clone(),
                    (current, saved.split(|byte| *byte == b'\n').count()),
                );
            }
            let (current, count) = &inspected[&point.source_path];
            if fingerprint != point.fingerprint || expected != current {
                return Err(format!("Saved breakpoint {}:{} refers to changed source. Review and rebind or remove it before Debug.", point.source_path, point.line));
            }
            if point.line as usize > *count {
                return Err(format!(
                    "Saved breakpoint {}:{} has no source line.",
                    point.source_path, point.line
                ));
            }
            let fields = format!(
                "{}\0{}\0{}\0{}\0{}\0{}",
                point.source_path,
                point.line,
                self.minimum_components(&point.source_path),
                point.condition,
                point.hit_count,
                point.log_message
            );
            lines.push_str(&base64::engine::general_purpose::STANDARD.encode(fields));
            lines.push('\n');
        }
        Ok(lines)
    }
    pub(super) fn capture(job: &Arc<Job>) -> Result<Self, String> {
        let root = &job.binding.canonical_root;
        let directories = if job.project_context.is_some() {
            job.debugger_source_roots
                .lock()
                .map_err(|_| "Debugger source-root state is unavailable.")?
                .clone()
                .filter(|roots| !roots.is_empty())
                .ok_or("The synchronized source set has no available debugger sources.")?
        } else {
            let project = execution_root(root, &job.request.configuration.project_path)?;
            if let Some(modules) = &job.maven_test_projects {
                modules.keys().map(|module| project.join(module)).collect()
            } else {
                vec![project]
            }
        };
        let mut paths = Vec::new();
        let mut visited = 0;
        for directory in directories {
            if job.project_context.is_some() {
                super::collect_sources_with_policy(root, &directory, &mut paths, &mut visited, 0, true)?;
            } else {
                collect_sources(root, &directory, &mut paths, &mut visited, 0)?;
            }
        }
        paths.sort();
        paths.dedup();
        let mut files = BTreeMap::new();
        let mut total = 0;
        for path in paths {
            if job.cancelled.load(std::sync::atomic::Ordering::SeqCst)
                || !super::current_workspace_binding_is_current(&job.binding)
            {
                return Err(
                    "Debugger source capture was cancelled or its workspace changed.".into(),
                );
            }
            let path = PathBuf::from(path);
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "Debugger source escaped its workspace.")?
                .to_str()
                .ok_or("Debugger source paths must be UTF-8.")?
                .to_owned();
            if relative.len() > 1024 || relative.contains(['\\', '\0', '\n', '\r']) {
                return Err("Unsupported debugger source path.".into());
            }
            let text = bytes(root, &path)?;
            total += text.len() as u64;
            if total > TOTAL_LIMIT {
                return Err("Debugger sources exceed the 64 MiB inspection limit.".into());
            }
            files.insert(relative, Sha256::digest(&text).into());
        }
        Ok(Self {
            root: root.clone(),
            files,
        })
    }
    fn document(&self, document: &Document) -> Result<String, String> {
        if document.text.len() as u64 > FILE_LIMIT
            || document.version == 0
            || document.path.len() > 4096
            || document.path.contains('\0')
        {
            return Err(
                "The Java editor document is invalid or exceeds its debugger limit.".into(),
            );
        }
        let path = resolve_existing_path_in_root(&self.root, Path::new(&document.path))?;
        let relative = path
            .strip_prefix(&self.root)
            .map_err(|_| "Debugger source escaped its workspace.")?
            .to_str()
            .ok_or("Debugger source paths must be UTF-8.")?
            .to_owned();
        let expected = self
            .files
            .get(&relative)
            .ok_or("This source was not captured for the debug session.")?;
        let editor: [u8; 32] = Sha256::digest(document.text.as_bytes()).into();
        let saved: [u8; 32] = Sha256::digest(bytes(&self.root, &path)?).into();
        if expected != &editor || expected != &saved {
            return Err("Source changed since Debug started. Keep your edits and restart Debug to use this source.".into());
        }
        Ok(relative)
    }
    fn source(&self, runtime: &str) -> Option<&str> {
        let runtime = runtime.replace('\\', "/");
        if runtime.is_empty()
            || runtime.starts_with('/')
            || runtime
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
        {
            return None;
        }
        let mut matches = self.files.keys().filter(|path| {
            *path == &runtime
                || path.ends_with(&format!("/{runtime}"))
                || runtime.ends_with(&format!("/{path}"))
        });
        let first = matches.next()?;
        matches.next().is_none().then_some(first.as_str())
    }
    fn minimum_components(&self, path: &str) -> usize {
        let components: Vec<_> = path.split('/').collect();
        for count in 1..=components.len() {
            let suffix = components[components.len() - count..].join("/");
            if self
                .files
                .keys()
                .filter(|other| *other == &suffix || other.ends_with(&format!("/{suffix}")))
                .count()
                == 1
            {
                return count;
            }
        }
        components.len() + 1
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub path: String,
    pub text: String,
    pub version: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub request_id: String,
    pub document: Document,
    pub stop_id: Option<String>,
    pub frame_id: Option<String>,
}
impl SourceRequest {
    pub(super) fn session(&self) -> SessionRequest {
        SessionRequest {
            workspace_id: self.workspace_id.clone(),
            generation: self.generation,
            session_id: self.session_id.clone(),
        }
    }
    fn state(&self, job: &Arc<Job>) -> Result<structured_debugger::DebugState, String> {
        let snapshot = job.read()?;
        if self.request_id.is_empty()
            || self.request_id.len() > 128
            || !super::current_workspace_binding_is_current(&job.binding)
            || !["debug", "attach", "debug-test", "debug-integration-test"].contains(&snapshot.operation.as_str())
            || snapshot.state != "running"
            || job.request.configuration.debugger_mode != "jdi"
            || job.cancelled.load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err("The structured debugger source request is obsolete.".into());
        }
        let state = snapshot
            .debugger_state
            .ok_or("Wait for the JDI debugger to initialize.")?;
        if state.stop_id != self.stop_id
            || state.selected_frame_id != self.frame_id
            || state.status == structured_debugger::Status::Terminated
        {
            return Err("The suspended debugger location changed; refresh the editor.".into());
        }
        Ok(state)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    workspace_id: String,
    generation: u64,
    session_id: String,
    request_id: String,
    document_path: String,
    document_version: u64,
    stop_id: Option<String>,
    frame_id: Option<String>,
    source_path: String,
    execution_line: Option<u32>,
    breakpoints: Vec<SourceBreakpoint>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceBreakpoint {
    line: u32,
    verified: bool,
}
pub(super) fn inspect(job: &Arc<Job>, request: &SourceRequest) -> Result<SourceView, String> {
    let state = request.state(job)?;
    let sources = job
        .sources
        .try_lock()
        .map_err(|_| "Debugger source inspection is unavailable.")?;
    let sources = sources
        .as_ref()
        .ok_or("Debugger source inspection is not ready.")?
        .as_ref()
        .map_err(Clone::clone)?;
    let path = sources.document(&request.document)?;
    let frame = state
        .frames
        .iter()
        .find(|frame| Some(&frame.id) == state.selected_frame_id.as_ref());
    let matches = frame.is_some_and(|frame| {
        frame.source_path.as_ref().and_then(|p| sources.source(p)) == Some(path.as_str())
    });
    if frame.is_some_and(|frame| {
        frame.source_path.as_ref().is_some_and(|runtime| {
            (path == *runtime
                || path.ends_with(&format!("/{runtime}"))
                || runtime.ends_with(&format!("/{path}")))
                && sources.source(runtime).is_none()
        })
    }) {
        return Err("Runtime source path is ambiguous between captured workspace files.".into());
    }
    let breakpoints = state
        .breakpoints
        .iter()
        .filter(|point| {
            point
                .source_path
                .as_deref()
                .and_then(|runtime| sources.source(runtime))
                == Some(path.as_str())
                || (point.class_name.is_some()
                    && matches
                    && frame.is_some_and(|f| point.class_name.as_deref() == Some(&f.class_name)))
        })
        .map(|point| SourceBreakpoint {
            line: point.line,
            verified: point.verified,
        })
        .collect();
    request.state(job)?;
    Ok(SourceView {
        workspace_id: request.workspace_id.clone(),
        generation: request.generation,
        session_id: request.session_id.clone(),
        request_id: request.request_id.clone(),
        document_path: request.document.path.clone(),
        document_version: request.document.version,
        stop_id: request.stop_id.clone(),
        frame_id: request.frame_id.clone(),
        source_path: path,
        execution_line: if matches {
            frame.and_then(|f| f.line)
        } else {
            None
        },
        breakpoints,
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BreakpointRequest {
    pub source: SourceRequest,
    pub line: u32,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub hit_count: u32,
    #[serde(default)]
    pub log_message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunToCursorRequest {
    pub source: SourceRequest,
    pub line: u32,
}

pub(super) fn run_to_cursor(job: &Arc<Job>, request: &RunToCursorRequest) -> Result<(), String> {
    let state = request.source.state(job)?;
    if state.status != structured_debugger::Status::Suspended || request.source.stop_id.is_none() {
        return Err("Run to Cursor requires a suspended JDI session.".into());
    }
    let sources = job
        .sources
        .try_lock()
        .map_err(|_| "Debugger source inspection is unavailable.")?;
    let sources = sources
        .as_ref()
        .ok_or("Debugger source inspection is not ready.")?
        .as_ref()
        .map_err(Clone::clone)?;
    let path = sources.document(&request.source.document)?;
    if request.line == 0
        || request.line > i32::MAX as u32
        || request.line as usize > request.source.document.text.lines().count()
    {
        return Err("Choose an existing Java source line for Run to Cursor.".into());
    }
    let frame = state
        .frames
        .iter()
        .find(|frame| Some(&frame.id) == state.selected_frame_id.as_ref());
    let runtime_source = frame
        .and_then(|frame| frame.source_path.as_deref())
        .filter(|runtime| sources.source(runtime) == Some(path.as_str()));
    if frame.is_some_and(|frame| {
        frame.source_path.as_ref().is_some_and(|runtime| {
            (path == *runtime
                || path.ends_with(&format!("/{runtime}"))
                || runtime.ends_with(&format!("/{path}")))
                && sources.source(runtime).is_none()
        })
    }) {
        return Err("Runtime source path is ambiguous between captured workspace files.".into());
    }
    let class_name = frame
        .filter(|_| runtime_source.is_some())
        .map(|frame| frame.class_name.as_str());
    if state.breakpoints.iter().any(|point| {
        point.line == request.line
            && (point
                .source_path
                .as_deref()
                .and_then(|runtime| sources.source(runtime))
                == Some(path.as_str())
                || (class_name.is_some() && point.class_name.as_deref() == class_name))
    }) {
        return Err(
            "A breakpoint already exists on this line; remove it before Run to Cursor.".into(),
        );
    }
    let minimum_components = runtime_source.map_or_else(
        || sources.minimum_components(&path),
        |runtime| runtime.split('/').count(),
    );
    if minimum_components > path.split('/').count() {
        return Err("The runtime source path is ambiguous for Run to Cursor.".into());
    }
    let target = runtime_source.map_or(path, str::to_owned);
    request.source.state(job)?;
    structured_debugger::send_fields(
        job,
        [
            "runToCursor".into(),
            request.source.stop_id.clone().unwrap_or_default(),
            target,
            request.line.to_string(),
            minimum_components.to_string(),
            request.source.frame_id.clone().unwrap_or_default(),
        ],
    )
}

pub(super) fn toggle(job: &Arc<Job>, request: &BreakpointRequest) -> Result<(), String> {
    structured_debugger::validate_breakpoint_options(
        &request.condition,
        request.hit_count,
        &request.log_message,
    )?;
    let state = request.source.state(job)?;
    let sources = job
        .sources
        .try_lock()
        .map_err(|_| "Debugger source inspection is unavailable.")?;
    let sources = sources
        .as_ref()
        .ok_or("Debugger source inspection is not ready.")?
        .as_ref()
        .map_err(Clone::clone)?;
    let path = sources.document(&request.source.document)?;
    if request.line == 0
        || request.line > i32::MAX as u32
        || request.line as usize > request.source.document.text.lines().count()
    {
        return Err("Choose an existing source line for the breakpoint.".into());
    }
    let clearing = state.breakpoints.iter().any(|point| {
        point.class_name.is_none()
            && point.source_path.as_deref() == Some(&path)
            && point.line == request.line
    });
    let selected_frame = state
        .frames
        .iter()
        .find(|frame| Some(&frame.id) == state.selected_frame_id.as_ref());
    let runtime_source = selected_frame
        .and_then(|frame| frame.source_path.as_deref())
        .filter(|runtime| sources.source(runtime) == Some(path.as_str()));
    let class_point = selected_frame
        .filter(|_| runtime_source.is_some())
        .and_then(|frame| {
            state.breakpoints.iter().find(|point| {
                point.class_name.as_deref() == Some(&frame.class_name) && point.line == request.line
            })
        })
        .and_then(|point| point.class_name.clone());
    request.source.state(job)?;
    let minimum_components = runtime_source.map_or_else(
        || sources.minimum_components(&path),
        |runtime| runtime.split('/').count(),
    );
    let action = if !clearing && class_point.is_some() {
        "clearClassSourceBreakpoint"
    } else if clearing {
        "clearSourceBreakpoint"
    } else {
        "setSourceBreakpoint"
    };
    let target = if clearing {
        path
    } else {
        class_point
            .or_else(|| runtime_source.map(str::to_owned))
            .unwrap_or(path)
    };
    structured_debugger::send_fields(
        job,
        [
            action.into(),
            request.source.stop_id.clone().unwrap_or_default(),
            target,
            request.line.to_string(),
            minimum_components.to_string(),
            request.source.frame_id.clone().unwrap_or_default(),
            request.condition.clone(),
            request.hit_count.to_string(),
            request.log_message.clone(),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::Sources;
    use std::path::PathBuf;

    fn sources(paths: &[&str]) -> Sources {
        Sources {
            root: PathBuf::new(),
            files: paths
                .iter()
                .map(|path| ((*path).to_owned(), [0; 32]))
                .collect(),
        }
    }

    #[test]
    fn maps_only_unique_runtime_source_paths_to_local_files() {
        let local_name_only = sources(&["External.java"]);
        assert_eq!(
            local_name_only.source("example/External.java"),
            Some("External.java")
        );

        let exact_relative = sources(&["app/src/main/java/example/External.java"]);
        assert_eq!(
            exact_relative.source("example/External.java"),
            Some("app/src/main/java/example/External.java")
        );

        let ambiguous = sources(&["External.java", "app/src/main/java/example/External.java"]);
        assert_eq!(ambiguous.source("example/External.java"), None);
    }
}
