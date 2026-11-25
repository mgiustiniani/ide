//! Workspace-owned interactive shell sessions. Browser renderers have no process authority.
use super::workspace_registry::{
    current_workspace_binding_at, with_root_activation, CurrentWorkspaceBinding,
};
use crate::{app_config::workspace_registry_path, workspace::workspace_root};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};
#[cfg(target_os = "linux")]
mod linux;

#[derive(Clone, Default)]
pub struct WorkspaceTerminalState {
    #[cfg(target_os = "linux")]
    sessions: linux::Sessions,
}
impl WorkspaceTerminalState {
    pub fn shutdown_all(&self) {
        #[cfg(target_os = "linux")]
        self.sessions.shutdown_all();
    }
}
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    workspace_id: String,
    generation: u64,
    client_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    context: Context,
    trusted: bool,
    cwd: String,
    shell: Option<String>,
    cols: u16,
    rows: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    context: Context,
    session_id: String,
    cursor: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteRequest {
    session: SessionRequest,
    data_base64: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResizeRequest {
    session: SessionRequest,
    cols: u16,
    rows: u16,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    workspace_id: String,
    generation: u64,
    client_id: String,
    available: bool,
    default_shell: Option<String>,
    reason: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    workspace_id: String,
    generation: u64,
    client_id: String,
    session_id: String,
    state: String,
    pid: u32,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
    data_base64: String,
    first_cursor: u64,
    next_cursor: u64,
    end_cursor: u64,
    reset: bool,
    exit_code: Option<u32>,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    workspace_id: String,
    generation: u64,
    client_id: String,
    session_id: String,
    accepted_bytes: usize,
}
fn authorize<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    context: &Context,
) -> Result<CurrentWorkspaceBinding, String> {
    if window.label() != "main"
        || context.generation == 0
        || context.generation > 9_007_199_254_740_991
        || context.client_id.is_empty()
        || context.client_id.len() > 128
    {
        return Err("Terminal workspace authority is unavailable.".into());
    }
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != context.workspace_id {
        return Err("The terminal request belongs to a different workspace.".into());
    }
    Ok(binding)
}
#[tauri::command]
pub async fn get_workspace_terminal_capabilities<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: Context,
) -> Result<Capabilities, String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request)?;
            #[cfg(target_os = "linux")]
            window
                .state::<WorkspaceTerminalState>()
                .sessions
                .claim(binding, &request)?;
            #[cfg(not(target_os = "linux"))]
            let _ = binding;
            #[cfg(target_os = "linux")]
            let shell = if linux::process_handles_available() { linux::default_shell().ok() } else { None };
            #[cfg(not(target_os = "linux"))]
            let shell: Option<String> = None;
            let reason = if shell.is_none() {
                Some(
                    "Interactive workspace terminals require Linux process handles and an executable shell.".into(),
                )
            } else {
                None
            };
            Ok(Capabilities {
                workspace_id: request.workspace_id,
                generation: request.generation,
                client_id: request.client_id,
                available: shell.is_some(),
                default_shell: shell,
                reason,
            })
        })
    })
    .await
}
#[tauri::command]
pub async fn start_workspace_terminal<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: StartRequest,
) -> Result<Snapshot, String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request.context)?;
            #[cfg(target_os = "linux")]
            return window
                .state::<WorkspaceTerminalState>()
                .sessions
                .start(binding, request);
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (binding, request);
                Err("Interactive workspace terminals are unavailable on this platform.".into())
            }
        })
    })
    .await
}
#[tauri::command]
pub async fn read_workspace_terminal<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: SessionRequest,
) -> Result<Snapshot, String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request.context)?;
            #[cfg(target_os = "linux")]
            return window
                .state::<WorkspaceTerminalState>()
                .sessions
                .read(&binding, &request);
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (binding, request);
                Err("Interactive workspace terminals are unavailable on this platform.".into())
            }
        })
    })
    .await
}
#[tauri::command]
pub async fn write_workspace_terminal<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: WriteRequest,
) -> Result<WriteResult, String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request.session.context)?;
            #[cfg(target_os = "linux")]
            return window
                .state::<WorkspaceTerminalState>()
                .sessions
                .write(&binding, &request);
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (binding, request);
                Err("Interactive workspace terminals are unavailable on this platform.".into())
            }
        })
    })
    .await
}
#[tauri::command]
pub async fn resize_workspace_terminal<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: ResizeRequest,
) -> Result<Snapshot, String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request.session.context)?;
            #[cfg(target_os = "linux")]
            return window
                .state::<WorkspaceTerminalState>()
                .sessions
                .resize(&binding, &request);
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (binding, request);
                Err("Interactive workspace terminals are unavailable on this platform.".into())
            }
        })
    })
    .await
}
#[tauri::command]
pub async fn stop_workspace_terminal<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: SessionRequest,
) -> Result<Snapshot, String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request.context)?;
            #[cfg(target_os = "linux")]
            return window
                .state::<WorkspaceTerminalState>()
                .sessions
                .stop(&binding, &request);
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (binding, request);
                Err("Interactive workspace terminals are unavailable on this platform.".into())
            }
        })
    })
    .await
}
#[tauri::command]
pub async fn close_workspace_terminal<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    request: SessionRequest,
) -> Result<(), String> {
    super::blocking::run(move || {
        with_root_activation(|| {
            let binding = authorize(&window, &request.context)?;
            #[cfg(target_os = "linux")]
            return window
                .state::<WorkspaceTerminalState>()
                .sessions
                .close(&binding, &request);
            #[cfg(not(target_os = "linux"))]
            {
                let _ = (binding, request);
                Err("Interactive workspace terminals are unavailable on this platform.".into())
            }
        })
    })
    .await
}
