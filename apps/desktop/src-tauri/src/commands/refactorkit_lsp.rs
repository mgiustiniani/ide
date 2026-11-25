//! Client-managed Java refactoring proposals from RefactorKit's LSP server.
//!
//! This transport deliberately does not apply edits. It captures current open
//! Java buffers, asks the provider for a versioned `WorkspaceEdit`, validates
//! every URI/version/resource operation against the active workspace, and
//! returns a normalized proposal for the editor to review and stage.

use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use url::Url;

use crate::commands::workspace_registry::{active_workspace_generation, workspace_id_for_path};
use crate::workspace::workspace_root;

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_DOCUMENTS: usize = 256;
const MAX_TOTAL_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;
const MAX_EDIT_COUNT: usize = 64;
const MAX_TEXT_BYTES: usize = 8 * 1024 * 1024;
const REFUSE: &str = "RefactorKit LSP returned an unsupported or stale Java edit.";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitLspDocument {
    pub path: String,
    pub text: String,
    pub version: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RefactorKitLspDocumentChange {
    Edit {
        path: String,
        version: i32,
        edits: Vec<RefactorKitLspTextEdit>,
    },
    Create {
        path: String,
        text: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitLspTextEdit {
    pub range: LspRange,
    pub new_text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitLspWorkspaceEdit {
    pub document_changes: Vec<RefactorKitLspDocumentChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitLspCapabilities {
    pub available: bool,
    pub server_version: Option<String>,
    pub change_visibility: bool,
    pub extract_parameter: bool,
    pub extract_superclass: bool,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "operation"
)]
pub enum RefactorKitLspPreviewRequest {
    ChangeVisibility {
        workspace_id: String,
        generation: u64,
        project_path: String,
        sdk_home: String,
        file: String,
        position: LspPosition,
        visibility: String,
        documents: Vec<RefactorKitLspDocument>,
    },
    ExtractParameter {
        workspace_id: String,
        generation: u64,
        project_path: String,
        sdk_home: String,
        file: String,
        range: LspRange,
        name: String,
        documents: Vec<RefactorKitLspDocument>,
    },
    ExtractSuperclass {
        workspace_id: String,
        generation: u64,
        project_path: String,
        sdk_home: String,
        file: String,
        position: LspPosition,
        superclass_name: String,
        method_name: String,
        documents: Vec<RefactorKitLspDocument>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitLspPreview {
    pub operation: String,
    pub summary: String,
    pub workspace_edit: RefactorKitLspWorkspaceEdit,
    pub provider_version: String,
}

#[derive(Clone, Default)]
pub struct RefactorKitLspState {
    gate: std::sync::Arc<Mutex<()>>,
}

struct LspProcess {
    child: Child,
    stdin: ChildStdin,
    incoming: Receiver<Result<Value, String>>,
    next_id: u64,
}

impl Drop for LspProcess {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            terminate(&mut self.child);
        }
    }
}

impl LspProcess {
    fn spawn(executable: &Path, root: &Path) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if env::var("IDE_REFACTORKIT_LSP_INHERIT_ENV").as_deref() != Ok("1") {
            let inherited_path = env::var_os("PATH").unwrap_or_default();
            let runtime_java_home = env::var_os("JAVA_HOME");
            // The server runtime stays independent from the project's compilation SDK.
            command
                .env_clear()
                .env("PATH", inherited_path)
                .env("LANG", "C.UTF-8");
            if let Some(java_home) = runtime_java_home {
                command.env("JAVA_HOME", java_home);
            }
            if let Some(home) = env::var_os("HOME") {
                command.env("HOME", home);
            }
            for key in ["LC_ALL", "MAVEN_OPTS", "GRADLE_OPTS"] {
                if let Some(value) = env::var_os(key) {
                    command.env(key, value);
                }
            }
        }
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
        let mut child = command
            .spawn()
            .map_err(|_| "The RefactorKit LSP process is unavailable.".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "The RefactorKit LSP process has no input stream.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "The RefactorKit LSP process has no output stream.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "The RefactorKit LSP process has no diagnostic stream.".to_string())?;
        let (tx, incoming) = mpsc::sync_channel(64);
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_lsp_frame(&mut reader) {
                    Ok(Some(value)) => {
                        if tx.send(Ok(value)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => {
                        let _ = tx.send(Err("The RefactorKit LSP process exited.".to_string()));
                        break;
                    }
                    Err(error) => {
                        let _ = tx.send(Err(error));
                        break;
                    }
                }
            }
        });
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = [0_u8; 4096];
            while let Ok(count) = reader.read(&mut buffer) {
                if count == 0 {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            incoming,
            next_id: 1,
        })
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({"jsonrpc":"2.0","method":method,"params":params}))
    }

    fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("The RefactorKit LSP request timed out.".to_string());
            }
            let message = match self
                .incoming
                .recv_timeout(remaining.min(Duration::from_millis(100)))
            {
                Ok(Ok(message)) => message,
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {
                    if self
                        .child
                        .try_wait()
                        .map_err(|_| "The RefactorKit LSP process failed.".to_string())?
                        .is_some()
                    {
                        return Err(
                            "The RefactorKit LSP process exited without a response.".to_string()
                        );
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("The RefactorKit LSP process exited without a response.".to_string())
                }
            };
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = lsp_error(&message) {
                    let text = error.get("message").and_then(Value::as_str).unwrap_or("");
                    return Err(safe_provider_message(text));
                }
                return message
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "The RefactorKit LSP response was malformed.".to_string());
            }
            if message.get("id").is_some() && message.get("method").is_some() {
                let response_id = message.get("id").cloned().unwrap_or(Value::Null);
                self.write(&json!({
                    "jsonrpc":"2.0",
                    "id":response_id,
                    "error":{"code":-32601,"message":"Client method unavailable"}
                }))?;
            }
        }
    }

    fn write(&mut self, message: &Value) -> Result<(), String> {
        let body = serde_json::to_vec(message)
            .map_err(|_| "Cannot encode the RefactorKit LSP request.".to_string())?;
        if body.len() > MAX_FRAME_BYTES {
            return Err("The RefactorKit LSP request exceeds the size limit.".to_string());
        }
        write!(self.stdin, "Content-Length: {}\r\n\r\n", body.len())
            .and_then(|_| self.stdin.write_all(&body))
            .and_then(|_| self.stdin.flush())
            .map_err(|_| "Cannot send a request to the RefactorKit LSP process.".to_string())
    }

    fn stop(mut self) {
        let _ = self.request("shutdown", Value::Null, SHUTDOWN_TIMEOUT);
        let _ = self.notify("exit", Value::Null);
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                _ => {
                    terminate(&mut self.child);
                    break;
                }
            }
        }
    }
}

#[tauri::command]
pub async fn get_refactorkit_lsp_capabilities(
    state: State<'_, RefactorKitLspState>,
    workspace_id: String,
    generation: u64,
    sdk_home: String,
) -> Result<RefactorKitLspCapabilities, String> {
    let state = state.inner().clone();
    super::blocking::run(move || state.capabilities(&workspace_id, generation, &sdk_home)).await
}

#[tauri::command]
pub async fn preview_refactorkit_lsp_java_refactoring(
    state: State<'_, RefactorKitLspState>,
    request: RefactorKitLspPreviewRequest,
) -> Result<RefactorKitLspPreview, String> {
    let state = state.inner().clone();
    super::blocking::run(move || state.preview(request)).await
}

impl RefactorKitLspState {
    fn capabilities(
        &self,
        workspace_id: &str,
        generation: u64,
        sdk_home: &str,
    ) -> Result<RefactorKitLspCapabilities, String> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "RefactorKit LSP state is unavailable.".to_string())?;
        let (root, native_generation) = authorize_workspace(workspace_id, generation)?;
        let _sdk_home = validate_sdk_home(sdk_home)?;
        let executable = match discover_lsp() {
            Some(path) => path,
            None => {
                return Ok(unavailable_capabilities(
                    "RefactorKit LSP is not installed.",
                ))
            }
        };
        let mut process = LspProcess::spawn(&executable, &root)?;
        let root_uri = file_uri(&root)?;
        let initialized = process.request(
            "initialize",
            initialize_params(&root_uri, true),
            INITIALIZE_TIMEOUT,
        )?;
        let result = capabilities_from_initialize(&initialized);
        let _ = process.notify("initialized", json!({}));
        process.stop();
        ensure_workspace_current(&root, workspace_id, native_generation)?;
        Ok(result)
    }

    fn preview(
        &self,
        request: RefactorKitLspPreviewRequest,
    ) -> Result<RefactorKitLspPreview, String> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| "RefactorKit LSP state is unavailable.".to_string())?;
        let (
            workspace_id,
            generation,
            project_path,
            sdk_home,
            file,
            operation,
            mut arguments,
            documents,
        ) = request_parts(request);
        validate_operation_arguments(&operation, &arguments)?;
        let (workspace_root, native_generation) = authorize_workspace(&workspace_id, generation)?;
        let project_path = normalize_project_path(&project_path)?;
        let project_root = resolve_project_root(&workspace_root, &project_path)?;
        let sdk = validate_sdk_home(&sdk_home)?;
        if let Some(arguments) = arguments.as_object_mut() {
            arguments.insert(
                "sdkHome".to_string(),
                json!(sdk.to_string_lossy().to_string()),
            );
        }
        let workspace_docs = validate_documents(&workspace_root, &documents)?;
        let docs = rebase_documents_to_project(
            &workspace_root,
            &project_root,
            &project_path,
            &workspace_docs,
        )?;
        if docs.is_empty() || docs.len() > MAX_DOCUMENTS {
            return Err(
                "Open at least one Java source document before requesting this refactoring."
                    .to_string(),
            );
        }
        let target_workspace_path = normalize_relative(&file)?;
        let target_path = rebase_workspace_path(&target_workspace_path, &project_path)?;
        if !docs.iter().any(|doc| doc.path == target_path) {
            return Err(
                "Open the selected Java source in the editor before requesting this refactoring."
                    .to_string(),
            );
        }
        if let Some(arguments) = arguments.as_object_mut() {
            arguments.insert("file".to_string(), json!(target_path));
        }
        let executable =
            discover_lsp().ok_or_else(|| "RefactorKit LSP is not installed.".to_string())?;
        let mut process = LspProcess::spawn(&executable, &project_root)?;
        let root_uri = file_uri(&project_root)?;
        let initialize = process.request(
            "initialize",
            initialize_params(&root_uri, true),
            INITIALIZE_TIMEOUT,
        )?;
        let capabilities = capabilities_from_initialize(&initialize);
        if !capabilities.available || !capabilities.advertises(&operation) {
            return Err(
                "The installed RefactorKit LSP does not advertise this Java operation.".to_string(),
            );
        }
        process.notify("initialized", json!({}))?;
        for doc in &docs {
            let path = project_root.join(&doc.path);
            process.notify(
                "textDocument/didOpen",
                json!({"textDocument":{
                    "uri":file_uri(&path)?,"languageId":"java","version":doc.version,"text":doc.text
                }}),
            )?;
        }
        let lsp_result = process.request(
            "workspace/executeCommand",
            json!({"command":operation,"arguments":[arguments]}),
            REQUEST_TIMEOUT,
        );
        let provider_version = capabilities
            .server_version
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let _ = process.stop();
        let result = lsp_result?;
        ensure_workspace_current(&workspace_root, &workspace_id, native_generation)?;
        if resolve_project_root(&workspace_root, &project_path)? != project_root {
            return Err("The selected Java project root changed while RefactorKit was preparing this preview.".to_string());
        }
        let summary = result
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("Review the proposed Java refactoring.")
            .to_string();
        let mut workspace_edit =
            normalize_workspace_edit(&project_root, &docs, &target_path, &operation, &result)?;
        prefix_project_paths(&mut workspace_edit, &project_path);
        Ok(RefactorKitLspPreview {
            operation: operation_name(&operation).to_string(),
            summary: safe_provider_message(&summary),
            workspace_edit,
            provider_version,
        })
    }
}

impl RefactorKitLspCapabilities {
    fn advertises(&self, operation: &str) -> bool {
        match operation {
            "refactorkit.changeVisibility" => self.change_visibility,
            "refactorkit.extractParameter" => self.extract_parameter,
            "refactorkit.extractSuperclass" => self.extract_superclass,
            _ => false,
        }
    }
}

fn request_parts(
    request: RefactorKitLspPreviewRequest,
) -> (
    String,
    u64,
    String,
    String,
    String,
    String,
    Value,
    Vec<RefactorKitLspDocument>,
) {
    match request {
        RefactorKitLspPreviewRequest::ChangeVisibility {
            workspace_id,
            generation,
            project_path,
            sdk_home,
            file,
            position,
            visibility,
            documents,
        } => {
            let arguments =
                json!({"file":file,"sdkHome":sdk_home,"position":position,"visibility":visibility});
            (
                workspace_id,
                generation,
                project_path,
                sdk_home,
                file,
                "refactorkit.changeVisibility".into(),
                arguments,
                documents,
            )
        }
        RefactorKitLspPreviewRequest::ExtractParameter {
            workspace_id,
            generation,
            project_path,
            sdk_home,
            file,
            range,
            name,
            documents,
        } => {
            let arguments = json!({"file":file,"sdkHome":sdk_home,"range":range,"name":name});
            (
                workspace_id,
                generation,
                project_path,
                sdk_home,
                file,
                "refactorkit.extractParameter".into(),
                arguments,
                documents,
            )
        }
        RefactorKitLspPreviewRequest::ExtractSuperclass {
            workspace_id,
            generation,
            project_path,
            sdk_home,
            file,
            position,
            superclass_name,
            method_name,
            documents,
        } => {
            let arguments = json!({"file":file,"sdkHome":sdk_home,"position":position,"superclassName":superclass_name,"methodName":method_name});
            (
                workspace_id,
                generation,
                project_path,
                sdk_home,
                file,
                "refactorkit.extractSuperclass".into(),
                arguments,
                documents,
            )
        }
    }
}

fn normalize_project_path(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Ok(String::new());
    }
    if raw.len() > 4096 || raw.contains('\\') || raw.chars().any(char::is_control) {
        return Err("The selected Java project root is invalid.".to_string());
    }
    let path = Path::new(raw);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(
            "The selected Java project root must stay inside the active workspace.".to_string(),
        );
    }
    Ok(path
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn resolve_project_root(workspace_root: &Path, project_path: &str) -> Result<PathBuf, String> {
    let candidate = if project_path.is_empty() {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(project_path)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "The selected Java project root is unavailable.".to_string())?;
    if !canonical.starts_with(workspace_root) || !canonical.is_dir() {
        return Err(
            "The selected Java project root must stay inside the active workspace.".to_string(),
        );
    }
    Ok(canonical)
}

fn rebase_workspace_path(path: &str, project_path: &str) -> Result<String, String> {
    if project_path.is_empty() {
        return Ok(path.to_string());
    }
    path.strip_prefix(project_path)
        .and_then(|relative| relative.strip_prefix('/'))
        .filter(|relative| !relative.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "The selected Java source is outside the active project root.".to_string())
}

fn rebase_documents_to_project(
    workspace_root: &Path,
    project_root: &Path,
    project_path: &str,
    documents: &[RefactorKitLspDocument],
) -> Result<Vec<RefactorKitLspDocument>, String> {
    let mut rebased = Vec::new();
    for document in documents {
        let relative = if project_path.is_empty() {
            document.path.as_str()
        } else {
            let Some(relative) = document
                .path
                .strip_prefix(project_path)
                .and_then(|path| path.strip_prefix('/'))
            else {
                continue;
            };
            relative
        };
        let path = normalize_relative(relative)?;
        let absolute = project_root.join(&path);
        let canonical = absolute.canonicalize().map_err(|_| {
            "An open Java document is no longer saved in the selected project.".to_string()
        })?;
        if !canonical.starts_with(project_root) || !canonical.is_file() {
            return Err("An open Java document resolves outside the selected project.".to_string());
        }
        if !workspace_root
            .join(&document.path)
            .canonicalize()
            .is_ok_and(|workspace_path| workspace_path == canonical)
        {
            return Err(
                "An open Java document changed while selecting the active project.".to_string(),
            );
        }
        rebased.push(RefactorKitLspDocument {
            path,
            text: document.text.clone(),
            version: document.version,
        });
    }
    rebased.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(rebased)
}

fn prefix_project_paths(workspace_edit: &mut RefactorKitLspWorkspaceEdit, project_path: &str) {
    if project_path.is_empty() {
        return;
    }
    for change in &mut workspace_edit.document_changes {
        match change {
            RefactorKitLspDocumentChange::Edit { path, .. }
            | RefactorKitLspDocumentChange::Create { path, .. } => {
                *path = format!("{project_path}/{path}");
            }
        }
    }
}

fn validate_sdk_home(raw: &str) -> Result<PathBuf, String> {
    let sdk_home = PathBuf::from(raw);
    if !sdk_home.is_absolute() || !sdk_home.is_dir() {
        return Err(
            "Select a valid Java project JDK before requesting this refactoring.".to_string(),
        );
    }
    sdk_home.canonicalize().map_err(|_| {
        "Select a valid Java project JDK before requesting this refactoring.".to_string()
    })
}

fn authorize_workspace(workspace_id: &str, generation: u64) -> Result<(PathBuf, u64), String> {
    let native_generation = checked_generation(generation, active_workspace_generation())?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The active workspace is unavailable.".to_string())?;
    if workspace_id_for_path(&root) != workspace_id {
        return Err("The Java refactoring belongs to a stale workspace.".to_string());
    }
    Ok((root, native_generation))
}

fn checked_generation(requested: u64, active: u64) -> Result<u64, String> {
    if requested == 0 || requested > 9_007_199_254_740_991 || requested != active {
        return Err("The Java refactoring belongs to a stale workspace.".to_string());
    }
    Ok(active)
}

fn ensure_workspace_current(
    root: &Path,
    workspace_id: &str,
    generation: u64,
) -> Result<(), String> {
    if active_workspace_generation() != generation
        || workspace_root()?.canonicalize().ok().as_deref() != Some(root)
        || workspace_id_for_path(root) != workspace_id
    {
        return Err(
            "The workspace changed while RefactorKit was preparing this Java refactoring."
                .to_string(),
        );
    }
    Ok(())
}

fn validate_documents(
    root: &Path,
    documents: &[RefactorKitLspDocument],
) -> Result<Vec<RefactorKitLspDocument>, String> {
    if documents.len() > MAX_DOCUMENTS {
        return Err("Too many Java documents are open for this refactoring.".to_string());
    }
    let mut total = 0usize;
    let mut seen = HashSet::new();
    let mut validated = Vec::with_capacity(documents.len());
    for document in documents {
        let path = normalize_relative(&document.path)?;
        if !path.to_ascii_lowercase().ends_with(".java")
            || document.version < 1
            || document.version > i32::MAX
            || !seen.insert(path.clone())
        {
            return Err("An open Java document has an invalid path or version.".to_string());
        }
        total = total.saturating_add(document.text.len());
        if document.text.len() > MAX_TEXT_BYTES || total > MAX_TOTAL_DOCUMENT_BYTES {
            return Err("Open Java documents exceed the RefactorKit request limit.".to_string());
        }
        let absolute = root.join(&path);
        let canonical = absolute.canonicalize().map_err(|_| {
            "An open Java document is no longer saved in this workspace.".to_string()
        })?;
        if !canonical.starts_with(root) || !canonical.is_file() {
            return Err("An open Java document resolves outside the active workspace.".to_string());
        }
        validated.push(RefactorKitLspDocument {
            path,
            text: document.text.clone(),
            version: document.version,
        });
    }
    validated.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(validated)
}

fn normalize_relative(raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.len() > 4096 || raw.contains('\\') || raw.chars().any(char::is_control)
    {
        return Err("The RefactorKit LSP returned an invalid workspace path.".to_string());
    }
    let path = Path::new(raw);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("The RefactorKit LSP returned a path outside the workspace.".to_string());
    }
    Ok(path
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn normalize_workspace_edit(
    root: &Path,
    documents: &[RefactorKitLspDocument],
    target_path: &str,
    operation: &str,
    result: &Value,
) -> Result<RefactorKitLspWorkspaceEdit, String> {
    if result.get("status").and_then(Value::as_str) != Some("PREVIEW")
        || result
            .get("refactorkitEditOwnership")
            .and_then(Value::as_str)
            != Some("client-managed")
        || result
            .get("refactorkitRollbackAvailable")
            .and_then(Value::as_bool)
            != Some(false)
        || result
            .get("refactorkitDocumentVersionsChecked")
            .and_then(Value::as_bool)
            != Some(true)
    {
        return Err(REFUSE.to_string());
    }
    let raw_changes = result
        .get("documentChanges")
        .and_then(Value::as_array)
        .ok_or_else(|| REFUSE.to_string())?;
    if raw_changes.is_empty() || raw_changes.len() > 8 {
        return Err(REFUSE.to_string());
    }
    let current: HashMap<_, _> = documents
        .iter()
        .map(|doc| (doc.path.as_str(), doc))
        .collect();
    let mut creates = HashMap::<String, String>::new();
    let mut changes = Vec::new();
    let mut edited = HashSet::new();
    for raw in raw_changes {
        if raw.get("kind").and_then(Value::as_str) == Some("create") {
            let uri = raw
                .get("uri")
                .and_then(Value::as_str)
                .ok_or_else(|| REFUSE.to_string())?;
            let path = workspace_path_from_uri(root, uri)?;
            let options = raw.get("options");
            if options.is_some_and(|value| !value.is_object())
                || options.is_some_and(|value| {
                    ["overwrite", "ignoreIfExists"].iter().any(|key| {
                        value
                            .get(key)
                            .is_some_and(|option| option.as_bool() != Some(false))
                    })
                })
                || current.contains_key(path.as_str())
                || creates.insert(path.clone(), String::new()).is_some()
            {
                return Err(REFUSE.to_string());
            }
            let target = root.join(&path);
            if Path::new(&path).parent() != Path::new(target_path).parent() {
                return Err(REFUSE.to_string());
            }
            if target.exists() {
                return Err(
                    "The proposed Java file already exists; refresh the workspace before retrying."
                        .to_string(),
                );
            }
            let parent = target
                .parent()
                .ok_or_else(|| REFUSE.to_string())?
                .canonicalize()
                .map_err(|_| REFUSE.to_string())?;
            if !parent.starts_with(root) {
                return Err(REFUSE.to_string());
            }
            continue;
        }
        let text_document = raw.get("textDocument").ok_or_else(|| REFUSE.to_string())?;
        let uri = text_document
            .get("uri")
            .and_then(Value::as_str)
            .ok_or_else(|| REFUSE.to_string())?;
        let path = workspace_path_from_uri(root, uri)?;
        let version_value = text_document.get("version");
        let version = version_value.and_then(Value::as_i64);
        let edits = raw
            .get("edits")
            .and_then(Value::as_array)
            .ok_or_else(|| REFUSE.to_string())?;
        if edits.is_empty() || edits.len() > MAX_EDIT_COUNT || !edited.insert(path.clone()) {
            return Err(REFUSE.to_string());
        }
        let mut parsed = Vec::with_capacity(edits.len());
        for edit in edits {
            parsed.push(RefactorKitLspTextEdit {
                range: serde_json::from_value(
                    edit.get("range")
                        .cloned()
                        .ok_or_else(|| REFUSE.to_string())?,
                )
                .map_err(|_| REFUSE.to_string())?,
                new_text: edit
                    .get("newText")
                    .and_then(Value::as_str)
                    .filter(|text| text.len() <= MAX_TEXT_BYTES)
                    .ok_or_else(|| REFUSE.to_string())?
                    .to_string(),
            });
        }
        if let Some(expected) = current.get(path.as_str()) {
            if version != Some(expected.version as i64) || path != target_path {
                return Err(REFUSE.to_string());
            }
            changes.push(RefactorKitLspDocumentChange::Edit {
                path,
                version: expected.version,
                edits: parsed,
            });
        } else if creates.contains_key(&path) && version_value.is_some_and(Value::is_null) {
            let text = apply_lsp_edits_to_empty(&parsed)?;
            creates.insert(path, text);
        } else {
            return Err(REFUSE.to_string());
        }
    }
    if changes.is_empty() {
        return Err(REFUSE.to_string());
    }
    for (path, text) in creates {
        if text.is_empty()
            || text.len() > MAX_TEXT_BYTES
            || !path.to_ascii_lowercase().ends_with(".java")
        {
            return Err(REFUSE.to_string());
        }
        changes.push(RefactorKitLspDocumentChange::Create { path, text });
    }
    let edit_count: usize = changes
        .iter()
        .map(|change| match change {
            RefactorKitLspDocumentChange::Edit { edits, .. } => edits.len(),
            RefactorKitLspDocumentChange::Create { .. } => 0,
        })
        .sum();
    match operation {
        "refactorkit.changeVisibility" if changes.len() == 1 && edit_count == 1 => {}
        "refactorkit.extractParameter" if changes.len() == 1 && edit_count == 3 => {}
        "refactorkit.extractSuperclass"
            if changes.len() == 2
                && edit_count == 2
                && changes.iter().any(|change| {
                    matches!(change, RefactorKitLspDocumentChange::Create { .. })
                }) => {}
        _ => return Err(REFUSE.to_string()),
    }
    Ok(RefactorKitLspWorkspaceEdit {
        document_changes: changes,
    })
}

fn apply_lsp_edits_to_empty(edits: &[RefactorKitLspTextEdit]) -> Result<String, String> {
    if edits.len() != 1
        || edits[0].range.start.line != 0
        || edits[0].range.start.character != 0
        || edits[0].range.end.line != 0
        || edits[0].range.end.character != 0
    {
        return Err(REFUSE.to_string());
    }
    Ok(edits[0].new_text.clone())
}

fn workspace_path_from_uri(root: &Path, raw_uri: &str) -> Result<String, String> {
    let uri = Url::parse(raw_uri).map_err(|_| REFUSE.to_string())?;
    if uri.scheme() != "file" || uri.query().is_some() || uri.fragment().is_some() {
        return Err(REFUSE.to_string());
    }
    let path = uri
        .to_file_path()
        .map_err(|_| REFUSE.to_string())?
        .normalize();
    if !path.starts_with(root) || path == root {
        return Err(REFUSE.to_string());
    }
    let relative = path.strip_prefix(root).map_err(|_| REFUSE.to_string())?;
    normalize_relative(&relative.to_string_lossy().replace('\\', "/"))
}

trait NormalizePath {
    fn normalize(&self) -> PathBuf;
}
impl NormalizePath for Path {
    fn normalize(&self) -> PathBuf {
        self.components().collect()
    }
}

fn initialize_params(root_uri: &str, create_file: bool) -> Value {
    let mut resource_operations = vec![json!("create")];
    if !create_file {
        resource_operations.clear();
    }
    json!({
        "processId": null,
        "rootUri": root_uri,
        "workspaceFolders": [{"uri":root_uri,"name":"workspace"}],
        "capabilities": {
            "workspace": {"workspaceEdit": {"documentChanges":true,"resourceOperations":resource_operations}}
        }
    })
}

fn capabilities_from_initialize(result: &Value) -> RefactorKitLspCapabilities {
    let commands = result
        .pointer("/capabilities/executeCommandProvider/commands")
        .and_then(Value::as_array);
    let has = |command: &str| {
        commands.is_some_and(|values| values.iter().any(|value| value.as_str() == Some(command)))
    };
    let change_visibility = has("refactorkit.changeVisibility");
    let extract_parameter = has("refactorkit.extractParameter");
    let extract_superclass = has("refactorkit.extractSuperclass");
    let available = change_visibility || extract_parameter || extract_superclass;
    RefactorKitLspCapabilities {
        available,
        server_version: result
            .pointer("/serverInfo/version")
            .and_then(Value::as_str)
            .map(str::to_owned),
        change_visibility,
        extract_parameter,
        extract_superclass,
        detail: (!available).then(|| {
            "The installed RefactorKit LSP does not advertise these Java refactorings.".to_string()
        }),
    }
}

fn unavailable_capabilities(detail: &str) -> RefactorKitLspCapabilities {
    RefactorKitLspCapabilities {
        available: false,
        server_version: None,
        change_visibility: false,
        extract_parameter: false,
        extract_superclass: false,
        detail: Some(detail.to_string()),
    }
}

fn operation_name(operation: &str) -> &'static str {
    match operation {
        "refactorkit.changeVisibility" => "changeVisibility",
        "refactorkit.extractParameter" => "extractParameter",
        _ => "extractSuperclass",
    }
}

fn validate_operation_arguments(operation: &str, arguments: &Value) -> Result<(), String> {
    if operation == "refactorkit.changeVisibility"
        && arguments.get("visibility").and_then(Value::as_str) != Some("public")
    {
        return Err(
            "This RefactorKit operation currently supports promoting a method to public only."
                .to_string(),
        );
    }
    Ok(())
}

fn file_uri(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map(|uri| uri.to_string())
        .map_err(|_| "The Java workspace path cannot be represented as an LSP URI.".to_string())
}

fn discover_lsp() -> Option<PathBuf> {
    if let Some(path) = env::var_os("IDE_REFACTORKIT_LSP") {
        let candidate = PathBuf::from(path);
        let allow =
            cfg!(test) || env::var("IDE_ALLOW_REFACTORKIT_LSP_OVERRIDE").as_deref() == Ok("1");
        if allow && candidate.is_absolute() && executable(&candidate) {
            return candidate.canonicalize().ok();
        }
    }
    if let Some(refactorkit) = crate::commands::refactorkit::find_refactorkit_on_path() {
        if let Some(parent) = refactorkit.parent() {
            let sibling = parent.join(lsp_filename());
            if executable(&sibling) {
                return sibling.canonicalize().ok();
            }
        }
    }
    let candidate = crate::commands::refactorkit::standard_refactorkit_bin()?
        .join(lsp_filename());
    executable(&candidate)
        .then(|| candidate.canonicalize().ok())
        .flatten()
}

#[cfg(windows)]
fn lsp_filename() -> &'static str {
    "refactorkit-lsp.exe"
}
#[cfg(not(windows))]
fn lsp_filename() -> &'static str {
    "refactorkit-lsp"
}

fn executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
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

fn read_lsp_frame(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut length = None;
    let mut total_header = 0usize;
    loop {
        let mut line = Vec::new();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|_| "Cannot read the RefactorKit LSP response.".to_string())?;
        if read == 0 {
            return if total_header == 0 {
                Ok(None)
            } else {
                Err("The RefactorKit LSP frame header was incomplete.".to_string())
            };
        }
        total_header += read;
        if total_header > 8192 {
            return Err("The RefactorKit LSP frame header exceeds the limit.".to_string());
        }
        if line == b"\r\n" || line == b"\n" {
            break;
        }
        let text = std::str::from_utf8(&line)
            .map_err(|_| "The RefactorKit LSP frame header is invalid.".to_string())?
            .trim_end_matches(['\r', '\n']);
        let (name, value) = text
            .split_once(':')
            .ok_or_else(|| "The RefactorKit LSP frame header is malformed.".to_string())?;
        if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err("The RefactorKit LSP frame contains duplicate lengths.".to_string());
            }
            length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "The RefactorKit LSP frame length is invalid.".to_string())?,
            );
        }
    }
    let length =
        length.ok_or_else(|| "The RefactorKit LSP frame has no content length.".to_string())?;
    if length > MAX_FRAME_BYTES {
        return Err("The RefactorKit LSP response exceeds the size limit.".to_string());
    }
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| "The RefactorKit LSP response was incomplete.".to_string())?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|_| "The RefactorKit LSP response was malformed.".to_string())
}

fn safe_provider_message(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty()
        || normalized.len() > 240
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
        .any(|word| normalized.to_ascii_lowercase().contains(word))
    {
        "RefactorKit could not produce this Java preview.".to_string()
    } else {
        normalized
    }
}

fn lsp_error(message: &Value) -> Option<&Value> {
    message.get("error").filter(|error| !error.is_null())
}

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> PathBuf {
        let path = env::temp_dir().join(format!(
            "ide-refactorkit-lsp-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("src")).unwrap();
        fs::write(path.join("src/App.java"), "class App {}\n").unwrap();
        path
    }

    fn document() -> RefactorKitLspDocument {
        RefactorKitLspDocument {
            path: "src/App.java".into(),
            text: "class App {}\n".into(),
            version: 3,
        }
    }

    struct RootCleanup(PathBuf);

    impl Drop for RootCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn refuses_a_stale_generation_even_when_the_workspace_path_is_reused() {
        assert!(checked_generation(4, 5).is_err());
        assert_eq!(checked_generation(5, 5).unwrap(), 5);
    }

    #[test]
    fn accepts_json_rpc_success_with_a_null_error_member() {
        assert!(lsp_error(&json!({"result":{"capabilities":{}},"error":null})).is_none());
        assert_eq!(
            lsp_error(&json!({"error":{"code":-32602,"message":"bad params"}}))
                .and_then(|error| error.get("code"))
                .and_then(Value::as_i64),
            Some(-32602)
        );
    }

    #[test]
    fn deserializes_preview_request_from_tauri_camel_case_payload() {
        let request: RefactorKitLspPreviewRequest = serde_json::from_value(json!({
            "operation": "changeVisibility",
            "workspaceId": "workspace",
            "generation": 3,
            "projectPath": "maven",
            "sdkHome": "/jdk",
            "file": "src/App.java",
            "position": {"line": 0, "character": 6},
            "visibility": "public",
            "documents": [{"path": "src/App.java", "text": "class App {}\\n", "version": 3}]
        }))
        .unwrap();

        assert!(matches!(
            request,
            RefactorKitLspPreviewRequest::ChangeVisibility {
                workspace_id,
                generation: 3,
                project_path,
                sdk_home,
                ..
            } if workspace_id == "workspace" && project_path == "maven" && sdk_home == "/jdk"
        ));
    }

    #[test]
    fn selected_project_root_rebases_open_documents_and_workspace_edits() {
        let root = root();
        let _cleanup = RootCleanup(root.clone());
        let workspace_root = root.canonicalize().unwrap();
        let project_path = normalize_project_path("src").unwrap();
        let project_root = resolve_project_root(&workspace_root, &project_path).unwrap();
        assert_eq!(
            rebase_workspace_path("src/App.java", &project_path).unwrap(),
            "App.java"
        );
        assert!(rebase_workspace_path("other/App.java", &project_path).is_err());

        let rebased = rebase_documents_to_project(
            &workspace_root,
            &project_root,
            &project_path,
            &[document()],
        )
        .unwrap();
        assert_eq!(rebased.len(), 1);
        assert_eq!(rebased[0].path, "App.java");

        let mut edit = RefactorKitLspWorkspaceEdit {
            document_changes: vec![
                RefactorKitLspDocumentChange::Edit {
                    path: "App.java".into(),
                    version: 3,
                    edits: vec![],
                },
                RefactorKitLspDocumentChange::Create {
                    path: "Base.java".into(),
                    text: "class Base {}".into(),
                },
            ],
        };
        prefix_project_paths(&mut edit, &project_path);
        assert!(matches!(
            &edit.document_changes[0],
            RefactorKitLspDocumentChange::Edit { path, .. } if path == "src/App.java"
        ));
        assert!(matches!(
            &edit.document_changes[1],
            RefactorKitLspDocumentChange::Create { path, .. } if path == "src/Base.java"
        ));
    }

    #[test]
    fn rejects_project_roots_outside_or_missing_from_the_workspace() {
        assert!(normalize_project_path("../outside").is_err());
        assert!(normalize_project_path("/outside").is_err());
        assert!(normalize_project_path("project\\folder").is_err());
        let root = root();
        let _cleanup = RootCleanup(root.clone());
        let workspace_root = root.canonicalize().unwrap();
        assert!(resolve_project_root(&workspace_root, "missing").is_err());
    }

    #[test]
    fn reads_refactorkit_commands_and_version_from_initialize_response() {
        let capabilities = capabilities_from_initialize(&json!({
            "capabilities":{"executeCommandProvider":{"commands":[
                "refactorkit.changeVisibility",
                "refactorkit.extractParameter",
                "refactorkit.extractSuperclass"
            ]}},
            "serverInfo":{"version":"0.7.0"}
        }));
        assert!(capabilities.available);
        assert!(capabilities.change_visibility);
        assert!(capabilities.extract_parameter);
        assert!(capabilities.extract_superclass);
        assert_eq!(capabilities.server_version.as_deref(), Some("0.7.0"));
    }

    #[test]
    fn refuses_visibility_changes_the_provider_does_not_support() {
        assert!(validate_operation_arguments(
            "refactorkit.changeVisibility",
            &json!({"visibility":"private"})
        )
        .is_err());
        assert!(validate_operation_arguments(
            "refactorkit.changeVisibility",
            &json!({"visibility":"public"})
        )
        .is_ok());
    }

    fn result(root: &Path) -> Value {
        let created = file_uri(&root.join("src/Base.java")).unwrap();
        let source = file_uri(&root.join("src/App.java")).unwrap();
        json!({
            "status":"PREVIEW",
            "summary":"Extract compute into Base",
            "refactorkitEditOwnership":"client-managed",
            "refactorkitRollbackAvailable":false,
            "refactorkitDocumentVersionsChecked":true,
            "documentChanges":[
                {"kind":"create","uri":created,"options":{"overwrite":false,"ignoreIfExists":false}},
                {"textDocument":{"uri":created,"version":null},"edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"class Base {}\n"}]},
                {"textDocument":{"uri":source,"version":3},"edits":[
                    {"range":{"start":{"line":0,"character":10},"end":{"line":0,"character":10}},"newText":" extends Base"},
                    {"range":{"start":{"line":0,"character":12},"end":{"line":0,"character":12}},"newText":""}
                ]}
            ]
        })
    }

    #[test]
    fn accepts_client_managed_extract_superclass_with_one_unsaved_create() {
        let root = root();
        let edit = normalize_workspace_edit(
            &root,
            &[document()],
            "src/App.java",
            "refactorkit.extractSuperclass",
            &result(&root),
        )
        .unwrap();
        assert_eq!(edit.document_changes.len(), 2);
        assert!(matches!(
            edit.document_changes[0],
            RefactorKitLspDocumentChange::Edit { .. }
        ));
        assert!(matches!(
            &edit.document_changes[1],
            RefactorKitLspDocumentChange::Create { path, text }
                if path == "src/Base.java" && text == "class Base {}\n"
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_stale_cross_package_or_overwriting_create_file_proposals() {
        let root = root();
        let mut stale = result(&root);
        stale["documentChanges"][2]["textDocument"]["version"] = json!(2);
        assert!(normalize_workspace_edit(
            &root,
            &[document()],
            "src/App.java",
            "refactorkit.extractSuperclass",
            &stale,
        )
        .is_err());

        let mut cross_package = result(&root);
        cross_package["documentChanges"][0]["uri"] =
            file_uri(&root.join("other/Base.java")).unwrap().into();
        cross_package["documentChanges"][1]["textDocument"]["uri"] =
            file_uri(&root.join("other/Base.java")).unwrap().into();
        fs::create_dir_all(root.join("other")).unwrap();
        assert!(normalize_workspace_edit(
            &root,
            &[document()],
            "src/App.java",
            "refactorkit.extractSuperclass",
            &cross_package,
        )
        .is_err());

        let mut overwrite = result(&root);
        overwrite["documentChanges"][0]["options"]["overwrite"] = json!(true);
        assert!(normalize_workspace_edit(
            &root,
            &[document()],
            "src/App.java",
            "refactorkit.extractSuperclass",
            &overwrite,
        )
        .is_err());

        let mut malformed_options = result(&root);
        malformed_options["documentChanges"][0]["options"] = json!("overwrite");
        assert!(normalize_workspace_edit(
            &root,
            &[document()],
            "src/App.java",
            "refactorkit.extractSuperclass",
            &malformed_options,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires IDE_REAL_REFACTORKIT_LSP and IDE_REAL_JAVA_HOME"]
    fn real_lsp_change_visibility_uses_native_transport_and_preserves_saved_source() {
        let executable = PathBuf::from(
            env::var_os("IDE_REAL_REFACTORKIT_LSP")
                .expect("IDE_REAL_REFACTORKIT_LSP must select a source-built server"),
        );
        let sdk_home = PathBuf::from(
            env::var_os("IDE_REAL_JAVA_HOME")
                .expect("IDE_REAL_JAVA_HOME must select the project JDK"),
        )
        .canonicalize()
        .expect("the selected project JDK must exist");
        let root = root();
        let _cleanup = RootCleanup(root.clone());
        fs::remove_dir_all(root.join("src")).unwrap();
        let source_path = root.join("src/main/java/sample/Demo.java");
        fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId>
  <artifactId>lsp-client-smoke</artifactId>
  <version>1</version>
  <properties><maven.compiler.release>17</maven.compiler.release></properties>
</project>
"#,
        )
        .unwrap();
        let source = "package sample;\npublic class Demo {\n    private final int calculate(int value) { return value + 1; }\n}\n";
        fs::write(&source_path, source).unwrap();
        let root = root.canonicalize().unwrap();
        let source = fs::read_to_string(&source_path).unwrap();
        let version = 7;
        let documents = vec![RefactorKitLspDocument {
            path: "src/main/java/sample/Demo.java".to_string(),
            text: source.clone(),
            version,
        }];
        let mut process = LspProcess::spawn(&executable, &root).unwrap();
        let initialize = process
            .request(
                "initialize",
                initialize_params(&file_uri(&root).unwrap(), true),
                INITIALIZE_TIMEOUT,
            )
            .unwrap();
        let capabilities = capabilities_from_initialize(&initialize);
        assert!(capabilities.change_visibility);
        assert!(capabilities.extract_parameter);
        assert!(capabilities.extract_superclass);
        process.notify("initialized", json!({})).unwrap();
        process
            .notify(
                "textDocument/didOpen",
                json!({"textDocument":{
                    "uri":file_uri(&source_path).unwrap(),
                    "languageId":"java",
                    "version":version,
                    "text":source
                }}),
            )
            .unwrap();
        let method_character = source
            .lines()
            .nth(2)
            .and_then(|line| line.find("calculate"))
            .unwrap() as u32;
        let proposal = process
            .request(
                "workspace/executeCommand",
                json!({
                    "command":"refactorkit.changeVisibility",
                    "arguments":[{
                        "file":"src/main/java/sample/Demo.java",
                        "sdkHome":sdk_home,
                        "position":{"line":2,"character":method_character},
                        "visibility":"public"
                    }]
                }),
                REQUEST_TIMEOUT,
            )
            .unwrap();
        let edit = normalize_workspace_edit(
            &root,
            &documents,
            "src/main/java/sample/Demo.java",
            "refactorkit.changeVisibility",
            &proposal,
        )
        .unwrap();
        assert_eq!(edit.document_changes.len(), 1);
        assert_eq!(fs::read_to_string(&source_path).unwrap(), source);
        process.stop();
    }
}
