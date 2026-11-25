use crate::app_config::{ide_home_dir, workspace_registry_path};
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, CurrentWorkspaceBinding,
};
use crate::workspace::workspace_root;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{State, WebviewWindow};
mod store;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub workspace_id: String,
    pub generation: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointRequest {
    pub session: Session,
    pub drafts: Vec<Draft>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntryRequest {
    pub session: Session,
    pub entry_id: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub file_path: String,
    pub content: String,
    pub language: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub file_path: String,
    pub language: String,
    pub kind: String,
    pub captured_at: u64,
    pub byte_length: usize,
    pub current_session: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}
struct Binding {
    context: Session,
    workspace: CurrentWorkspaceBinding,
    home: PathBuf,
}
#[derive(Clone, Default)]
pub struct EditorRecoveryState {
    sessions: Arc<Mutex<HashMap<String, Binding>>>,
}
impl EditorRecoveryState {
    pub fn shutdown_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}
fn require_main(label: &str, generation: u64) -> Result<(), String> {
    if label != "main" || generation == 0 || generation > 9_007_199_254_740_991 {
        return Err("Recovery is restricted to the active main workspace".into());
    }
    Ok(())
}
fn with_session<T>(
    label: &str,
    state: &EditorRecoveryState,
    session: &Session,
    action: impl FnOnce(&Binding) -> Result<T, String>,
) -> Result<T, String> {
    require_main(label, session.generation)?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Recovery sessions are unavailable")?;
    let binding = sessions
        .get(&session.session_id)
        .ok_or("Recovery session is stale")?;
    if binding.context.workspace_id != session.workspace_id
        || binding.context.generation != session.generation
        || workspace_root()? != binding.workspace.canonical_root
        || !current_workspace_binding_is_current(&binding.workspace)
    {
        return Err("The recovery workspace changed".into());
    }
    action(binding)
}
fn response(session: &Session) -> Value {
    json!({"workspaceId":session.workspace_id,"generation":session.generation,"sessionId":session.session_id})
}
// File locking, JSON processing and durability barriers never execute on the UI thread.
async fn run<T: Send + 'static>(
    state: &EditorRecoveryState,
    action: impl FnOnce(EditorRecoveryState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || action(state))
        .await
        .map_err(|_| "Recovery worker failed".to_string())?
}

#[tauri::command]
pub async fn start_editor_recovery(
    window: WebviewWindow,
    state: State<'_, EditorRecoveryState>,
    request: Context,
) -> Result<Session, String> {
    require_main(window.label(), request.generation)?;
    run(&state, move |state| {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Recovery sessions are unavailable")?;
        let workspace =
            current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
        if workspace.workspace_id != request.workspace_id {
            return Err("The recovery workspace changed".into());
        }
        if sessions.len() >= 16 {
            return Err("Too many recovery sessions".into());
        }
        let context = Session {
            workspace_id: request.workspace_id,
            generation: request.generation,
            session_id: store::random_id()?,
        };
        sessions.insert(
            context.session_id.clone(),
            Binding {
                context: context.clone(),
                workspace,
                home: ide_home_dir()?,
            },
        );
        Ok(context)
    })
    .await
}
#[tauri::command]
pub async fn checkpoint_editor_recovery(
    window: WebviewWindow,
    state: State<'_, EditorRecoveryState>,
    request: CheckpointRequest,
) -> Result<Value, String> {
    let label = window.label().to_string();
    run(&state, move |state| {
        with_session(&label, &state, &request.session, |binding| {
            store::checkpoint(
                &binding.home,
                &binding.workspace.canonical_root,
                &request.session.session_id,
                &request.drafts,
            )?;
            Ok(response(&request.session))
        })
    })
    .await
}
#[tauri::command]
pub async fn list_editor_recovery(
    window: WebviewWindow,
    state: State<'_, EditorRecoveryState>,
    request: Session,
) -> Result<Value, String> {
    let label = window.label().to_string();
    run(&state, move |state| {
        with_session(&label, &state, &request, |binding| {
            let mut result = response(&request);
            result["entries"] = serde_json::to_value(store::list(
                &binding.home,
                &binding.workspace.canonical_root,
                &request.session_id,
            )?)
            .map_err(|_| "Cannot encode recovery entries")?;
            Ok(result)
        })
    })
    .await
}
#[tauri::command]
pub async fn read_editor_recovery(
    window: WebviewWindow,
    state: State<'_, EditorRecoveryState>,
    request: EntryRequest,
) -> Result<Value, String> {
    let label = window.label().to_string();
    run(&state, move |state| {
        with_session(&label, &state, &request.session, |binding| {
            let mut result = response(&request.session);
            result["entry"] = serde_json::to_value(store::read(
                &binding.home,
                &binding.workspace.canonical_root,
                &request.session.session_id,
                &request.entry_id,
            )?)
            .map_err(|_| "Cannot encode recovery entry")?;
            Ok(result)
        })
    })
    .await
}
#[tauri::command]
pub async fn remove_editor_recovery(
    window: WebviewWindow,
    state: State<'_, EditorRecoveryState>,
    request: EntryRequest,
) -> Result<Value, String> {
    let label = window.label().to_string();
    run(&state, move |state| {
        with_session(&label, &state, &request.session, |binding| {
            store::remove(
                &binding.home,
                &binding.workspace.canonical_root,
                &request.entry_id,
            )?;
            Ok(response(&request.session))
        })
    })
    .await
}
#[tauri::command]
pub async fn stop_editor_recovery(
    window: WebviewWindow,
    state: State<'_, EditorRecoveryState>,
    request: Session,
) -> Result<Value, String> {
    require_main(window.label(), request.generation)?;
    run(&state, move |state| {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Recovery sessions are unavailable")?;
        if sessions.get(&request.session_id).is_some_and(|binding| {
            binding.context.workspace_id == request.workspace_id
                && binding.context.generation == request.generation
        }) {
            sessions.remove(&request.session_id);
        }
        Ok(response(&request))
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_identity_and_generation_are_not_client_supplied_authority() {
        assert!(require_main("detached-pi", 1).is_err());
        assert!(require_main("main", 0).is_err());
        assert!(require_main("main", 9_007_199_254_740_992).is_err());
        assert!(require_main("main", 1).is_ok());
        assert!(serde_json::from_value::<Context>(
            json!({"workspaceId":"ws", "generation":1, "windowLabel":"main"})
        )
        .is_err());
    }
}
