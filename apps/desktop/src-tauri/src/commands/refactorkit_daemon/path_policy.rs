//! Workspace generation, target, and relative-path authorization policy.

use std::path::{Component, Path, PathBuf};

use serde_json::Value;

use crate::commands::workspace_registry::workspace_id_for_path;
use crate::workspace::{ensure_within_root, workspace_root};

use super::contract::PROTOCOL_FAILED;

pub(super) fn canonical_workspace() -> Result<PathBuf, String> {
    workspace_root()?
        .canonicalize()
        .map_err(|_| "Cannot authorize the current workspace.".to_string())
}
pub(super) fn validate_workspace(workspace_id: &str, generation: u64) -> Result<PathBuf, String> {
    require_generation(generation)?;
    let root = canonical_workspace()?;
    if workspace_id_for_path(&root) != workspace_id {
        return Err("Stale or mismatched workspace selection.".to_string());
    }
    Ok(root)
}
pub(super) fn require_generation(generation: u64) -> Result<(), String> {
    if generation == 0 {
        Err("Workspace and selection generations must be positive.".to_string())
    } else {
        Ok(())
    }
}

pub(super) fn validate_target(root: &Path, target: &str) -> Result<String, String> {
    let path = safe_path(target, root)?;
    let canonical = root
        .join(&path)
        .canonicalize()
        .map_err(|_| "Target directory does not exist.".to_string())?;
    ensure_within_root(root, &canonical)
        .map_err(|_| "Target directory escapes the workspace.".to_string())?;
    if !canonical.is_dir() {
        return Err("Target path is not a directory.".to_string());
    }
    Ok(path)
}
pub(super) fn safe_path(value: &str, root: &Path) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 4096
        || value.contains('\\')
        || Path::new(value).is_absolute()
        || value.contains(':')
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let components: Vec<_> = Path::new(value).components().collect();
    if components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let normalized = components
        .iter()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if normalized != value || normalized.chars().any(char::is_control) {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let mut ancestor = root.join(value);
    while !ancestor.exists() {
        if !ancestor.pop() {
            return Err(PROTOCOL_FAILED.to_string());
        }
    }
    let canonical = ancestor
        .canonicalize()
        .map_err(|_| PROTOCOL_FAILED.to_string())?;
    ensure_within_root(root, &canonical).map_err(|_| PROTOCOL_FAILED.to_string())?;
    Ok(normalized)
}
pub(super) fn nullable_safe_path(
    value: Option<&Value>,
    root: &Path,
) -> Result<Option<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => safe_path(value, root).map(Some),
        _ => Err(PROTOCOL_FAILED.to_string()),
    }
}
