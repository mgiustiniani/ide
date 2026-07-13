use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::workspace::{
    ensure_within_root, resolve_existing_path, resolve_new_path, validate_child_name,
    workspace_root,
};

const MAX_DIRECTORY_DEPTH: usize = 4;
const HEAVY_DIRECTORIES: &[&str] = &[
    ".cache",
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: String, // "file" or "directory"
    pub children: Option<Vec<FileEntry>>,
}

fn read_directory_recursive(root: &Path, path: &Path, depth: usize) -> Result<FileEntry, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let path_str = path.to_string_lossy().to_string();

    let metadata =
        fs::metadata(path).map_err(|e| format!("Cannot inspect '{}': {e}", path.display()))?;

    if metadata.is_dir() {
        let children = if depth >= MAX_DIRECTORY_DEPTH {
            Vec::new()
        } else {
            read_directory_children(root, path, depth)?
        };

        Ok(FileEntry {
            name,
            path: path_str,
            entry_type: "directory".to_string(),
            children: Some(children),
        })
    } else {
        Ok(FileEntry {
            name,
            path: path_str,
            entry_type: "file".to_string(),
            children: None,
        })
    }
}

fn read_directory_children(
    root: &Path,
    path: &Path,
    depth: usize,
) -> Result<Vec<FileEntry>, String> {
    let mut children = Vec::new();
    let entries =
        fs::read_dir(path).map_err(|e| format!("Cannot read '{}': {e}", path.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read directory entry: {e}"))?;
        let child_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Cannot inspect '{}': {e}", child_path.display()))?;

        if file_type.is_dir() && is_ignored_directory(&file_name) {
            continue;
        }

        if file_type.is_symlink() {
            let canonical = match child_path.canonicalize() {
                Ok(canonical) => canonical,
                Err(_) => continue,
            };

            if ensure_within_root(root, &canonical).is_err() {
                continue;
            }

            let target_metadata = match fs::metadata(&child_path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };

            if target_metadata.is_dir() {
                // Do not traverse symlinked directories. This avoids cycles and
                // prevents later time-of-check/time-of-use surprises.
                continue;
            }

            children.push(FileEntry {
                name: file_name,
                path: canonical.to_string_lossy().to_string(),
                entry_type: "file".to_string(),
                children: None,
            });
            continue;
        }

        let canonical = child_path
            .canonicalize()
            .map_err(|e| format!("Cannot resolve '{}': {e}", child_path.display()))?;
        ensure_within_root(root, &canonical)?;
        let child = read_directory_recursive(root, &canonical, depth + 1)?;
        children.push(child);
    }

    children.sort_by(|a, b| {
        let a_is_dir = a.entry_type == "directory";
        let b_is_dir = b.entry_type == "directory";
        if a_is_dir && !b_is_dir {
            std::cmp::Ordering::Less
        } else if !a_is_dir && b_is_dir {
            std::cmp::Ordering::Greater
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(children)
}

fn is_ignored_directory(name: &str) -> bool {
    HEAVY_DIRECTORIES.iter().any(|ignored| ignored == &name)
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Value, String> {
    let root = workspace_root()?;
    let path_buf = resolve_existing_path(&path)?;

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    let entry = read_directory_recursive(&root, &path_buf, 0)?;

    serde_json::to_value(entry).map_err(|e| format!("Serialization error: {e}"))
}

#[tauri::command]
pub fn create_file(path: String) -> Result<Value, String> {
    let path_buf = resolve_new_path(&path)?;

    if path_buf.exists() {
        return Err(format!("File already exists: {path}"));
    }

    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent directories: {e}"))?;
    }

    fs::write(&path_buf, "")
        .map_err(|e| format!("Cannot create file '{}': {e}", path_buf.display()))?;

    serde_json::to_value(serde_json::json!({
        "success": true,
        "path": path_buf.to_string_lossy()
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<Value, String> {
    let path_buf = resolve_new_path(&path)?;

    if path_buf.exists() {
        return Err(format!("Path already exists: {path}"));
    }

    fs::create_dir_all(&path_buf)
        .map_err(|e| format!("Cannot create directory '{}': {e}", path_buf.display()))?;

    serde_json::to_value(serde_json::json!({
        "success": true,
        "path": path_buf.to_string_lossy()
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<Value, String> {
    let path_buf = resolve_existing_path(&path)?;

    if path_buf.is_dir() {
        fs::remove_dir_all(&path_buf)
            .map_err(|e| format!("Cannot delete directory '{}': {e}", path_buf.display()))?;
    } else {
        fs::remove_file(&path_buf)
            .map_err(|e| format!("Cannot delete file '{}': {e}", path_buf.display()))?;
    }

    serde_json::to_value(serde_json::json!({
        "success": true,
        "path": path_buf.to_string_lossy()
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<Value, String> {
    validate_child_name(&new_name)?;

    let path_buf = resolve_existing_path(&path)?;
    let parent = path_buf
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;
    let new_path = parent.join(&new_name);
    let root = workspace_root()?;

    ensure_within_root(&root, parent)?;
    ensure_within_root(&root, &new_path)?;

    if new_path.exists() {
        return Err(format!(
            "Target path already exists: {}",
            new_path.display()
        ));
    }

    fs::rename(&path_buf, &new_path).map_err(|e| {
        format!(
            "Cannot rename '{}' to '{}': {e}",
            path_buf.display(),
            new_path.display()
        )
    })?;

    serde_json::to_value(serde_json::json!({
        "success": true,
        "oldPath": path_buf.to_string_lossy(),
        "newPath": new_path.to_string_lossy()
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::WORKSPACE_ROOT_ENV;
    use std::env;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn make_temp_workspace() -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("ide-desktop-file-tree-test-{id}"));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn rename_rejects_traversal_filename() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        env::set_var(WORKSPACE_ROOT_ENV, &root);
        fs::write(root.join("file.txt"), "content").unwrap();

        let result = rename_path("file.txt".to_string(), "../escape.txt".to_string());

        assert!(result.is_err());
        assert!(root.join("file.txt").exists());
        env::remove_var(WORKSPACE_ROOT_ENV);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_rejects_absolute_path_outside_workspace() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        let outside = env::temp_dir().join(format!(
            "ide-desktop-delete-outside-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "content").unwrap();
        env::set_var(WORKSPACE_ROOT_ENV, &root);

        let result = delete_path(outside.to_string_lossy().to_string());

        assert!(result.is_err());
        assert!(outside.exists());
        env::remove_var(WORKSPACE_ROOT_ENV);
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_directory_stops_at_max_depth() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        env::set_var(WORKSPACE_ROOT_ENV, &root);

        let mut current = root.clone();
        for level in 0..=MAX_DIRECTORY_DEPTH + 1 {
            current.push(format!("level-{level}"));
            fs::create_dir_all(&current).unwrap();
        }

        let value = list_directory(".".to_string()).unwrap();
        let mut entry: FileEntry = serde_json::from_value(value).unwrap();

        for _ in 0..MAX_DIRECTORY_DEPTH {
            let children = entry.children.take().unwrap();
            entry = children.into_iter().next().unwrap();
        }

        assert!(entry.children.unwrap().is_empty());
        env::remove_var(WORKSPACE_ROOT_ENV);
        let _ = fs::remove_dir_all(root);
    }
}
