use std::collections::BTreeSet;
use std::fs;
use std::hash::Hasher;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_config::{now_rfc3339, workspace_registry_path, write_json_pretty};
use crate::workspace::{ensure_within_root, set_workspace_root_override, workspace_root};

pub const WORKSPACE_MARKER_FOLDER: &str = ".ide";
pub const WORKSPACE_MARKER_FILE: &str = "workspace.json";
pub const WORKSPACE_REGISTRY_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMarker {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegistry {
    pub version: u8,
    pub workspaces: Vec<WorkspaceInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_workspace_id: Option<String>,
}

impl Default for WorkspaceRegistry {
    fn default() -> Self {
        Self {
            version: WORKSPACE_REGISTRY_VERSION,
            workspaces: Vec::new(),
            current_workspace_id: None,
        }
    }
}

#[tauri::command]
pub fn ensure_current_workspace() -> Result<WorkspaceInfo, String> {
    let root = workspace_root()?;
    let registry_path = workspace_registry_path()?;
    ensure_current_workspace_at_with(root, &registry_path, set_workspace_root_override)
}

fn ensure_current_workspace_at_with<F>(
    root: PathBuf,
    registry_path: &Path,
    activate_workspace: F,
) -> Result<WorkspaceInfo, String>
where
    F: FnOnce(PathBuf) -> Result<(), String>,
{
    // Treat initial discovery as the same authorization boundary as a switch: marker and registry
    // persistence must both succeed before native commands are authorized for this root.
    let workspace = ensure_workspace_at(&root, registry_path)?;
    activate_workspace(root)?;
    Ok(workspace)
}

#[tauri::command]
pub fn list_workspaces() -> Result<WorkspaceRegistry, String> {
    let registry_path = workspace_registry_path()?;
    read_registry_at(&registry_path)
}

#[tauri::command]
pub fn switch_workspace(
    workspace_id: String,
    refactorkit: State<'_, crate::commands::refactorkit_daemon::RefactorKitDaemonState>,
) -> Result<WorkspaceInfo, String> {
    let registry_path = workspace_registry_path()?;
    // Serialize with any in-flight managed RefactorKit request before changing the global
    // workspace root. Otherwise an apply could still target the previous root after the UI has
    // observed the new selection. Killing an idle session when validation later fails is safe.
    refactorkit.shutdown_all();
    switch_workspace_at(&workspace_id, &registry_path)
}

pub(crate) fn switch_workspace_at(
    workspace_id: &str,
    registry_path: &Path,
) -> Result<WorkspaceInfo, String> {
    switch_workspace_at_with(workspace_id, registry_path, set_workspace_root_override)
}

fn switch_workspace_at_with<F>(
    workspace_id: &str,
    registry_path: &Path,
    activate_workspace: F,
) -> Result<WorkspaceInfo, String>
where
    F: FnOnce(PathBuf) -> Result<(), String>,
{
    let registry = read_registry_at(registry_path)?;
    let workspace = registry
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Workspace is not registered: {workspace_id}"))?;

    let root = Path::new(&workspace.root_path)
        .canonicalize()
        .map_err(|e| {
            format!(
                "Cannot resolve registered workspace root '{}': {e}",
                workspace.root_path
            )
        })?;
    if !root.is_dir() {
        return Err(format!(
            "Registered workspace root is not a directory: {}",
            root.display()
        ));
    }

    // Complete marker and registry authorization before changing the process-wide root. A failed
    // switch must leave native commands authorized for the workspace still shown by the frontend.
    let workspace = ensure_workspace_at(&root, registry_path)?;
    activate_workspace(root)?;
    Ok(workspace)
}

pub(crate) fn ensure_workspace_at(
    root: &Path,
    registry_path: &Path,
) -> Result<WorkspaceInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace root '{}': {e}", root.display()))?;
    if !root.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            root.display()
        ));
    }

    let marker_dir = root.join(WORKSPACE_MARKER_FOLDER);
    ensure_within_root(&root, &marker_dir)?;
    ensure_marker_dir(&root, &marker_dir)?;

    let marker_path = marker_dir.join(WORKSPACE_MARKER_FILE);
    ensure_safe_marker_file(&root, &marker_path)?;
    let now = now_rfc3339();
    let existing_marker = read_marker_at(&marker_path).ok();
    let id = existing_marker
        .as_ref()
        .map(|marker| marker.id.clone())
        .unwrap_or_else(|| workspace_id_for_path(&root));
    let created_at = existing_marker
        .as_ref()
        .map(|marker| marker.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let name = workspace_name(&root);
    let root_path = root.to_string_lossy().to_string();

    let marker = WorkspaceMarker {
        id: id.clone(),
        path: root_path.clone(),
        name: name.clone(),
        created_at: created_at.clone(),
        updated_at: now.clone(),
    };
    write_json_pretty(&marker_path, &marker)?;

    let mut registry = read_registry_at(registry_path)?;
    upsert_workspace(&mut registry, marker_to_info(&marker));
    registry.current_workspace_id = Some(id.clone());
    write_json_pretty(registry_path, &registry)?;

    registry
        .workspaces
        .into_iter()
        .find(|workspace| workspace.id == id)
        .ok_or_else(|| "Workspace registry update did not include current workspace".to_string())
}

pub(crate) fn read_registry_at(path: &Path) -> Result<WorkspaceRegistry, String> {
    if !path.exists() {
        return Ok(WorkspaceRegistry::default());
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Cannot read workspace registry '{}': {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(WorkspaceRegistry::default());
    }

    let mut registry: WorkspaceRegistry = serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse workspace registry '{}': {e}", path.display()))?;
    registry.version = WORKSPACE_REGISTRY_VERSION;
    dedupe_workspaces(&mut registry.workspaces);
    Ok(registry)
}

fn ensure_marker_dir(root: &Path, marker_dir: &Path) -> Result<(), String> {
    match fs::symlink_metadata(marker_dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Workspace marker directory must not be a symlink: {}",
                    marker_dir.display()
                ));
            }
            if !metadata.is_dir() {
                return Err(format!(
                    "Workspace marker path exists but is not a directory: {}",
                    marker_dir.display()
                ));
            }
            let canonical = marker_dir.canonicalize().map_err(|e| {
                format!(
                    "Cannot resolve workspace marker '{}': {e}",
                    marker_dir.display()
                )
            })?;
            ensure_within_root(root, &canonical)?;
            return Ok(());
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Cannot inspect workspace marker '{}': {error}",
                marker_dir.display()
            ));
        }
    }

    fs::create_dir_all(marker_dir).map_err(|e| {
        format!(
            "Cannot create workspace marker '{}': {e}",
            marker_dir.display()
        )
    })?;
    let canonical = marker_dir.canonicalize().map_err(|e| {
        format!(
            "Cannot resolve workspace marker '{}': {e}",
            marker_dir.display()
        )
    })?;
    ensure_within_root(root, &canonical)
}

fn ensure_safe_marker_file(root: &Path, marker_path: &Path) -> Result<(), String> {
    ensure_within_root(root, marker_path)?;
    let metadata = match fs::symlink_metadata(marker_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Cannot inspect workspace marker '{}': {error}",
                marker_path.display()
            ));
        }
    };

    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Workspace marker file must not be a symlink: {}",
            marker_path.display()
        ));
    }
    if !metadata.is_file() {
        return Err(format!(
            "Workspace marker path exists but is not a file: {}",
            marker_path.display()
        ));
    }
    let canonical = marker_path.canonicalize().map_err(|e| {
        format!(
            "Cannot resolve workspace marker '{}': {e}",
            marker_path.display()
        )
    })?;
    ensure_within_root(root, &canonical)
}

fn read_marker_at(path: &Path) -> Result<WorkspaceMarker, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Cannot read workspace marker '{}': {e}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse workspace marker '{}': {e}", path.display()))
}

fn marker_to_info(marker: &WorkspaceMarker) -> WorkspaceInfo {
    WorkspaceInfo {
        id: marker.id.clone(),
        name: marker.name.clone(),
        root_path: marker.path.clone(),
        marker_folder: Some(WORKSPACE_MARKER_FOLDER.to_string()),
        created_at: Some(marker.created_at.clone()),
        last_opened_at: Some(marker.updated_at.clone()),
    }
}

fn upsert_workspace(registry: &mut WorkspaceRegistry, workspace: WorkspaceInfo) {
    if let Some(existing) = registry
        .workspaces
        .iter_mut()
        .find(|existing| existing.id == workspace.id || existing.root_path == workspace.root_path)
    {
        let created_at = existing
            .created_at
            .clone()
            .or_else(|| workspace.created_at.clone());
        *existing = workspace;
        existing.created_at = created_at;
    } else {
        registry.workspaces.push(workspace);
    }

    dedupe_workspaces(&mut registry.workspaces);
    registry.workspaces.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.root_path.cmp(&b.root_path))
    });
}

fn dedupe_workspaces(workspaces: &mut Vec<WorkspaceInfo>) {
    let mut seen_ids = BTreeSet::new();
    let mut seen_paths = BTreeSet::new();
    workspaces.retain(|workspace| {
        !workspace.id.is_empty()
            && !workspace.root_path.is_empty()
            && seen_ids.insert(workspace.id.clone())
            && seen_paths.insert(workspace.root_path.clone())
    });
}

fn workspace_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| root.to_string_lossy().to_string())
}

pub(crate) fn workspace_id_for_path(path: &Path) -> String {
    let mut hasher = Fnv1a64::default();
    hasher.write(path.to_string_lossy().as_bytes());
    format!("ws-{:016x}", hasher.finish())
}

struct Fnv1a64(u64);

impl Default for Fnv1a64 {
    fn default() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
}

impl Hasher for Fnv1a64 {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "{prefix}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn ensure_workspace_writes_marker_and_registry() {
        let root = temp_dir("ide-desktop-workspace-registry-root");
        let home = temp_dir("ide-desktop-workspace-registry-home");
        let registry_path = home.join("workspaces.json");

        let workspace = ensure_workspace_at(&root, &registry_path).unwrap();

        assert_eq!(workspace.name, workspace_name(&root));
        assert_eq!(workspace.root_path, root.to_string_lossy());
        assert!(root
            .join(WORKSPACE_MARKER_FOLDER)
            .join(WORKSPACE_MARKER_FILE)
            .exists());

        let marker: WorkspaceMarker = serde_json::from_str(
            &fs::read_to_string(
                root.join(WORKSPACE_MARKER_FOLDER)
                    .join(WORKSPACE_MARKER_FILE),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(marker.id, workspace.id);
        assert_eq!(marker.path, workspace.root_path);

        let registry = read_registry_at(&registry_path).unwrap();
        assert_eq!(registry.version, WORKSPACE_REGISTRY_VERSION);
        assert_eq!(registry.current_workspace_id, Some(workspace.id));
        assert_eq!(registry.workspaces.len(), 1);

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn successful_initial_ensure_activates_root_after_persistence() {
        let root = temp_dir("ide-desktop-workspace-initial-ensure-root");
        let home = temp_dir("ide-desktop-workspace-initial-ensure-home");
        let registry_path = home.join("workspaces.json");
        let mut activated_root = None;

        // Record the activation transition instead of changing the process-wide override so this
        // unit test remains isolated from other workspace-root tests running in parallel.
        let workspace = ensure_current_workspace_at_with(root.clone(), &registry_path, |path| {
            let registry = read_registry_at(&registry_path)?;
            if registry.current_workspace_id.is_none() {
                return Err("Workspace was activated before registry persistence".to_string());
            }
            activated_root = Some(path);
            Ok(())
        })
        .unwrap();

        assert_eq!(activated_root, Some(root.clone()));
        assert_eq!(
            read_registry_at(&registry_path)
                .unwrap()
                .current_workspace_id,
            Some(workspace.id)
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn failed_initial_ensure_does_not_activate_root() {
        let root = temp_dir("ide-desktop-workspace-initial-ensure-failed-root");
        let home = temp_dir("ide-desktop-workspace-initial-ensure-failed-home");
        let registry_path = home.join("workspaces.json");
        fs::create_dir(&registry_path).unwrap();
        let mut activated = false;

        let result = ensure_current_workspace_at_with(root.clone(), &registry_path, |_| {
            activated = true;
            Ok(())
        });

        assert!(result.is_err());
        assert!(!activated);
        assert!(root
            .join(WORKSPACE_MARKER_FOLDER)
            .join(WORKSPACE_MARKER_FILE)
            .exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn registry_parser_dedupes_workspace_paths() {
        let home = temp_dir("ide-desktop-workspace-registry-parse");
        let registry_path = home.join("workspaces.json");
        fs::write(
            &registry_path,
            r#"{
              "version": 1,
              "workspaces": [
                {"id":"one","name":"One","rootPath":"/tmp/one"},
                {"id":"one","name":"Duplicate Id","rootPath":"/tmp/two"},
                {"id":"two","name":"Duplicate Path","rootPath":"/tmp/one"}
              ],
              "currentWorkspaceId": "one"
            }"#,
        )
        .unwrap();

        let registry = read_registry_at(&registry_path).unwrap();

        assert_eq!(registry.workspaces.len(), 1);
        assert_eq!(registry.workspaces[0].id, "one");
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn switch_workspace_rejects_unknown_workspace_id() {
        let root = temp_dir("ide-desktop-workspace-switch-root");
        let home = temp_dir("ide-desktop-workspace-switch-home");
        let registry_path = home.join("workspaces.json");
        let workspace = ensure_workspace_at(&root, &registry_path).unwrap();

        let result = switch_workspace_at("missing-workspace", &registry_path);

        assert!(result.is_err());
        assert_eq!(
            workspace.id,
            read_registry_at(&registry_path).unwrap().workspaces[0].id
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn failed_switch_does_not_activate_an_unauthorized_root() {
        let root = temp_dir("ide-desktop-workspace-switch-invalid-root");
        let home = temp_dir("ide-desktop-workspace-switch-invalid-home");
        let registry_path = home.join("workspaces.json");
        let registry = WorkspaceRegistry {
            version: WORKSPACE_REGISTRY_VERSION,
            workspaces: vec![WorkspaceInfo {
                id: "invalid-marker".to_string(),
                name: "Invalid marker".to_string(),
                root_path: root.to_string_lossy().to_string(),
                marker_folder: None,
                created_at: None,
                last_opened_at: None,
            }],
            current_workspace_id: None,
        };
        write_json_pretty(&registry_path, &registry).unwrap();
        fs::write(root.join(WORKSPACE_MARKER_FOLDER), "not a directory").unwrap();
        let mut activated = false;

        let result = switch_workspace_at_with("invalid-marker", &registry_path, |_| {
            activated = true;
            Ok(())
        });

        assert!(result.is_err());
        assert!(!activated);
        assert_eq!(
            read_registry_at(&registry_path)
                .unwrap()
                .current_workspace_id,
            None
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn switch_workspace_rejects_registered_missing_directory() {
        let home = temp_dir("ide-desktop-workspace-switch-missing-home");
        let registry_path = home.join("workspaces.json");
        let missing_root = home.join("missing-root");
        let registry = WorkspaceRegistry {
            version: WORKSPACE_REGISTRY_VERSION,
            workspaces: vec![WorkspaceInfo {
                id: "missing".to_string(),
                name: "Missing".to_string(),
                root_path: missing_root.to_string_lossy().to_string(),
                marker_folder: None,
                created_at: None,
                last_opened_at: None,
            }],
            current_workspace_id: None,
        };
        write_json_pretty(&registry_path, &registry).unwrap();

        let result = switch_workspace_at("missing", &registry_path);

        assert!(result.is_err());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn workspace_id_is_stable_for_path() {
        let path = PathBuf::from("/tmp/example");
        assert_eq!(workspace_id_for_path(&path), workspace_id_for_path(&path));
        assert!(workspace_id_for_path(&path).starts_with("ws-"));
    }

    #[cfg(unix)]
    #[test]
    fn marker_directory_symlink_is_rejected() {
        let root = temp_dir("ide-desktop-workspace-marker-root");
        let outside = temp_dir("ide-desktop-workspace-marker-outside");
        let home = temp_dir("ide-desktop-workspace-marker-home");
        std::os::unix::fs::symlink(&outside, root.join(WORKSPACE_MARKER_FOLDER)).unwrap();

        let result = ensure_workspace_at(&root, &home.join("workspaces.json"));

        assert!(result.is_err());
        assert!(!outside.join(WORKSPACE_MARKER_FILE).exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        let _ = fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn marker_file_symlink_is_rejected() {
        let root = temp_dir("ide-desktop-workspace-marker-file-root");
        let outside = temp_dir("ide-desktop-workspace-marker-file-outside");
        let home = temp_dir("ide-desktop-workspace-marker-file-home");
        fs::create_dir_all(root.join(WORKSPACE_MARKER_FOLDER)).unwrap();
        std::os::unix::fs::symlink(
            outside.join(WORKSPACE_MARKER_FILE),
            root.join(WORKSPACE_MARKER_FOLDER)
                .join(WORKSPACE_MARKER_FILE),
        )
        .unwrap();

        let result = ensure_workspace_at(&root, &home.join("workspaces.json"));

        assert!(result.is_err());
        assert!(!outside.join(WORKSPACE_MARKER_FILE).exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        let _ = fs::remove_dir_all(home);
    }
}
