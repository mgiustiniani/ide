use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::workspace::{
    ensure_within_root, resolve_existing_path_in_root, resolve_new_path_in_root,
    validate_child_name, workspace_root,
};

const MAX_DIRECTORY_DEPTH: usize = 4;
const MAX_FILE_SEARCH_DEPTH: usize = 64;
const MAX_FILE_SEARCH_ENTRIES: usize = 50_000;
const MAX_FILE_SEARCH_RESULTS: usize = 200;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_generation: Option<u64>,
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
        // Conventional output/dependency names can also be legitimate source folders.
        // Show them, but enumerate their contents only when the person opens them.
        let children = if depth >= MAX_DIRECTORY_DEPTH || (depth > 0 && is_ignored_directory(&name))
        {
            Vec::new()
        } else {
            read_directory_children(root, path, depth)?
        };

        Ok(FileEntry {
            name,
            path: path_str,
            entry_type: "directory".to_string(),
            children: Some(children),
            workspace_generation: None,
        })
    } else {
        Ok(FileEntry {
            name,
            path: path_str,
            entry_type: "file".to_string(),
            children: None,
            workspace_generation: None,
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

        if file_type.is_dir() && file_name.starts_with('.') && is_ignored_directory(&file_name) {
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
                workspace_generation: None,
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
    let (root, workspace_generation) = super::workspace_registry::with_root_activation(|| {
        Ok((
            workspace_root()?,
            super::workspace_registry::active_workspace_generation(),
        ))
    })?;
    let path_buf = resolve_existing_path_in_root(&root, &path)?;

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    let mut entry = read_directory_recursive(&root, &path_buf, 0)?;
    if path_buf == root {
        entry.workspace_generation = Some(workspace_generation);
    }

    serde_json::to_value(entry).map_err(|e| format!("Serialization error: {e}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileSearchMatch {
    name: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileSearchResult {
    workspace_generation: u64,
    files: Vec<WorkspaceFileSearchMatch>,
    truncated: bool,
    partial: bool,
}

#[tauri::command]
pub async fn search_workspace_files(
    query: String,
    expected_workspace_root: String,
    expected_workspace_generation: u64,
) -> Result<Value, String> {
    let query = query.trim().to_lowercase();
    if query.len() > 256 {
        return Err("File search query exceeds the 256-byte limit.".to_string());
    }

    let root = with_expected_workspace_authority(
        &expected_workspace_root,
        expected_workspace_generation,
        |root| Ok(root.to_path_buf()),
    )?;
    let result = tauri::async_runtime::spawn_blocking({
        let query = query.clone();
        let root = root.clone();
        move || search_workspace_files_at(&root, expected_workspace_generation, &query)
    })
    .await
    .map_err(|_| "Workspace file search worker stopped unexpectedly.".to_string())??;

    // A result discovered in an old workspace must not be returned after a switch.
    with_expected_workspace_authority(
        &expected_workspace_root,
        expected_workspace_generation,
        |_| Ok(()),
    )?;

    serde_json::to_value(result).map_err(|e| format!("Serialization error: {e}"))
}

fn search_workspace_files_at(
    root: &Path,
    workspace_generation: u64,
    query: &str,
) -> Result<WorkspaceFileSearchResult, String> {
    let query = query.trim().to_lowercase();
    let mut matches = Vec::new();
    let mut visited_entries = 0usize;
    let mut truncated = false;
    let mut partial = false;

    if !query.is_empty() {
        let mut pending = vec![(root.to_path_buf(), 0usize)];
        while let Some((directory, depth)) = pending.pop() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(_) if directory == root => {
                    return Err("The active workspace could not be searched.".to_string());
                }
                Err(_) => {
                    partial = true;
                    continue;
                }
            };

            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        partial = true;
                        continue;
                    }
                };
                visited_entries += 1;
                if visited_entries > MAX_FILE_SEARCH_ENTRIES {
                    truncated = true;
                    break;
                }

                let name = match entry.file_name().into_string() {
                    Ok(name) => name,
                    Err(_) => {
                        partial = true;
                        continue;
                    }
                };
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(_) => {
                        partial = true;
                        continue;
                    }
                };

                // Ignore symlinks entirely: Quick Open must not traverse outside the workspace
                // or offer a path whose ownership changes between search and open.
                if file_type.is_symlink() {
                    continue;
                }

                if file_type.is_dir() {
                    if is_ignored_directory(&name) {
                        continue;
                    }
                    if depth >= MAX_FILE_SEARCH_DEPTH {
                        truncated = true;
                        continue;
                    }
                    pending.push((entry.path(), depth + 1));
                    continue;
                }

                if !file_type.is_file() {
                    continue;
                }

                let path = match entry.path().strip_prefix(root) {
                    Ok(relative) => {
                        let mut components = Vec::new();
                        let mut representable = true;
                        for component in relative.components() {
                            match component {
                                std::path::Component::Normal(value) => match value.to_str() {
                                    Some(value) => components.push(value),
                                    None => representable = false,
                                },
                                _ => representable = false,
                            }
                        }
                        if !representable {
                            partial = true;
                            continue;
                        }
                        components.join("/")
                    }
                    Err(_) => {
                        partial = true;
                        continue;
                    }
                };
                if path.is_empty() {
                    continue;
                }

                if let Some(score) = file_search_score(&name, &path, &query) {
                    matches.push((score, WorkspaceFileSearchMatch { name, path }));
                }
            }

            if truncated {
                break;
            }
        }
    }

    matches.sort_by(|(left_score, left), (right_score, right)| {
        left_score
            .cmp(right_score)
            .then_with(|| left.path.cmp(&right.path))
    });
    if matches.len() > MAX_FILE_SEARCH_RESULTS {
        truncated = true;
        matches.truncate(MAX_FILE_SEARCH_RESULTS);
    }

    Ok(WorkspaceFileSearchResult {
        workspace_generation,
        files: matches.into_iter().map(|(_, file)| file).collect(),
        truncated,
        partial,
    })
}

fn file_search_score(name: &str, path: &str, query: &str) -> Option<usize> {
    let name = name.to_lowercase();
    let path = path.to_lowercase();
    if name == query {
        return Some(0);
    }
    if name.starts_with(query) {
        return Some(10 + query.len());
    }
    if let Some(index) = name.find(query) {
        return Some(100 + index);
    }
    if let Some(index) = path.find(query) {
        return Some(200 + index);
    }

    let mut query_chars = query.chars();
    let mut next = query_chars.next()?;
    let mut last_index = None;
    let mut gaps = 0usize;
    for (index, character) in name.chars().enumerate() {
        if character != next {
            continue;
        }
        if let Some(previous) = last_index {
            gaps += index.saturating_sub(previous + 1);
        }
        last_index = Some(index);
        match query_chars.next() {
            Some(character) => next = character,
            None => return Some(300 + gaps),
        }
    }

    let mut query_chars = query.chars();
    let mut next = query_chars.next()?;
    let mut last_index = None;
    let mut gaps = 0usize;
    for (index, character) in path.chars().enumerate() {
        if character != next {
            continue;
        }
        if let Some(previous) = last_index {
            gaps += index.saturating_sub(previous + 1);
        }
        last_index = Some(index);
        match query_chars.next() {
            Some(character) => next = character,
            None => return Some(400 + gaps),
        }
    }
    None
}

#[tauri::command]
pub fn create_file(
    path: String,
    expected_workspace_root: String,
    expected_workspace_generation: u64,
    create_parent_directories_under: Option<String>,
) -> Result<Value, String> {
    with_expected_workspace_authority(
        &expected_workspace_root,
        expected_workspace_generation,
        |root| {
            let path_buf = match create_parent_directories_under.as_deref() {
                Some(anchor) => create_file_beneath(root, anchor, &path)?,
                None => create_file_at(root, &path)?,
            };

            serde_json::to_value(serde_json::json!({
                "success": true,
                "path": path_buf.to_string_lossy()
            }))
            .map_err(|e| format!("Serialization error: {e}"))
        },
    )
}

fn create_file_at(root: &Path, relative_path: &str) -> Result<std::path::PathBuf, String> {
    let path_buf = resolve_new_path_in_root(root, relative_path)?;
    let parent = path_buf
        .parent()
        .ok_or_else(|| "Cannot determine the file's parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "The selected parent directory is no longer available.".to_string())?;
    ensure_within_root(root, &canonical_parent)?;
    if !canonical_parent.is_dir() {
        return Err("The selected parent is not a directory.".to_string());
    }

    if path_buf.exists() {
        return Err(format!("File already exists: {relative_path}"));
    }

    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path_buf)
        .map_err(|e| format!("Cannot create file '{}': {e}", path_buf.display()))?;
    Ok(path_buf)
}

/// Create missing directories only below an existing, explicitly selected anchor.
/// The workspace authority lock held by the command covers the whole operation.
fn create_file_beneath(
    root: &Path,
    anchor: &str,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    fn parts(value: &str) -> Result<Vec<&str>, String> {
        let parts: Vec<_> = value.split('/').collect();
        if parts.len() > 64 || value.contains(':') {
            return Err("Use a bounded workspace-relative file path.".to_string());
        }
        for part in &parts {
            validate_child_name(part)?;
        }
        Ok(parts)
    }
    let anchor_parts = if anchor.is_empty() || anchor == "." {
        vec![]
    } else {
        parts(anchor)?
    };
    let file_parts = parts(relative_path)?;
    if file_parts.len() <= anchor_parts.len() || !file_parts.starts_with(&anchor_parts) {
        return Err("The new file must be beneath the selected directory.".to_string());
    }
    let existing_anchor =
        resolve_existing_path_in_root(root, if anchor.is_empty() { "." } else { anchor })?;
    if !existing_anchor.is_dir() {
        return Err("The selected parent is not a directory.".to_string());
    }
    let mut created = Vec::new();
    let result = (|| {
        let mut directory = root.to_path_buf();
        for (index, part) in file_parts[..file_parts.len() - 1].iter().enumerate() {
            directory.push(part);
            match fs::symlink_metadata(&directory) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                    return Err(
                        "A destination parent is a symbolic link or is not a directory."
                            .to_string(),
                    )
                }
                Ok(_) => (),
                Err(error)
                    if error.kind() == std::io::ErrorKind::NotFound
                        && index >= anchor_parts.len() =>
                {
                    fs::create_dir(&directory)
                        .map_err(|e| format!("Cannot create package directory: {e}"))?;
                    created.push(directory.clone());
                }
                Err(error) => {
                    return Err(format!("Cannot inspect the destination parent: {error}"))
                }
            }
            ensure_within_root(
                root,
                &directory
                    .canonicalize()
                    .map_err(|e| format!("Cannot resolve destination parent: {e}"))?,
            )?;
        }
        create_file_at(root, relative_path)
    })();
    if result.is_err() {
        // Never remove pre-existing directories or another writer's contents.
        for directory in created.iter().rev() {
            let _ = fs::remove_dir(directory);
        }
    }
    result
}

#[tauri::command]
pub fn create_directory(
    path: String,
    expected_workspace_root: String,
    expected_workspace_generation: u64,
) -> Result<Value, String> {
    with_expected_workspace_authority(
        &expected_workspace_root,
        expected_workspace_generation,
        |root| {
            let path_buf = resolve_new_path_in_root(root, &path)?;
            create_directory_at(&path_buf)?;

            serde_json::to_value(serde_json::json!({
                "success": true,
                "path": path_buf.to_string_lossy()
            }))
            .map_err(|e| format!("Serialization error: {e}"))
        },
    )
}

fn create_directory_at(path: &Path) -> Result<(), String> {
    fs::create_dir(path).map_err(|e| format!("Cannot create directory '{}': {e}", path.display()))
}

#[tauri::command]
pub fn delete_path(
    path: String,
    expected_workspace_root: String,
    expected_workspace_generation: u64,
) -> Result<Value, String> {
    with_expected_workspace_authority(
        &expected_workspace_root,
        expected_workspace_generation,
        |root| {
            let path_buf = resolve_existing_path_in_root(root, &path)?;

            if path_buf.is_dir() {
                fs::remove_dir_all(&path_buf).map_err(|e| {
                    format!("Cannot delete directory '{}': {e}", path_buf.display())
                })?;
            } else {
                fs::remove_file(&path_buf)
                    .map_err(|e| format!("Cannot delete file '{}': {e}", path_buf.display()))?;
            }

            serde_json::to_value(serde_json::json!({
                "success": true,
                "path": path_buf.to_string_lossy()
            }))
            .map_err(|e| format!("Serialization error: {e}"))
        },
    )
}

#[tauri::command]
pub fn rename_path(
    path: String,
    new_name: String,
    expected_workspace_root: String,
    expected_workspace_generation: u64,
) -> Result<Value, String> {
    with_expected_workspace_authority(
        &expected_workspace_root,
        expected_workspace_generation,
        |root| {
            validate_child_name(&new_name)?;

            let path_buf = resolve_existing_path_in_root(root, &path)?;
            let parent = path_buf
                .parent()
                .ok_or_else(|| "Cannot determine parent directory".to_string())?;
            let new_path = parent.join(&new_name);

            ensure_within_root(root, parent)?;
            ensure_within_root(root, &new_path)?;

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
        },
    )
}

fn with_expected_workspace_authority<T>(
    expected_workspace_root: &str,
    expected_workspace_generation: u64,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    super::workspace_registry::with_root_activation(|| {
        let active_root = workspace_root()?;
        run_if_workspace_authority_matches(
            &active_root,
            super::workspace_registry::active_workspace_generation(),
            expected_workspace_root,
            expected_workspace_generation,
            operation,
        )
    })
}

fn run_if_workspace_authority_matches<T>(
    active_root: &Path,
    active_generation: u64,
    expected_workspace_root: &str,
    expected_workspace_generation: u64,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    if active_generation != expected_workspace_generation {
        return Err("The active workspace changed before the file operation.".to_string());
    }
    let expected = Path::new(expected_workspace_root)
        .canonicalize()
        .map_err(|_| "The expected workspace is no longer available.".to_string())?;
    if !expected.is_absolute() || expected != active_root {
        return Err("The active workspace changed before the file operation.".to_string());
    }
    operation(active_root)
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

        let result = rename_path(
            "file.txt".to_string(),
            "../escape.txt".to_string(),
            root.to_string_lossy().to_string(),
            super::super::workspace_registry::active_workspace_generation(),
        );

        assert!(result.is_err());
        assert!(root.join("file.txt").exists());
        env::remove_var(WORKSPACE_ROOT_ENV);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_directory_creates_one_child_and_refuses_existing_targets() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        let child = root.join("package");

        create_directory_at(&child).expect("new child directory should be created");
        let duplicate = create_directory_at(&child);
        let nested_without_parent = create_directory_at(&root.join("missing/child"));

        assert!(child.is_dir());
        assert!(duplicate.is_err());
        assert!(nested_without_parent.is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_file_requires_an_existing_parent_and_refuses_existing_targets() {
        let root = make_temp_workspace();
        let package = root.join("package");
        fs::create_dir(&package).unwrap();

        let created = create_file_at(&root, "package/Example.java")
            .expect("file should be created in an existing directory");
        let duplicate = create_file_at(&root, "package/Example.java");
        let missing_parent = create_file_at(&root, "missing/Example.java");

        assert!(created.is_file());
        assert!(duplicate.is_err());
        assert!(missing_parent.is_err());
        assert!(!root.join("missing").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn nested_file_creation_preserves_existing_inputs_and_requires_an_existing_anchor() {
        let root = make_temp_workspace();
        fs::create_dir(root.join("source")).unwrap();
        fs::write(root.join("source/notes.txt"), "keep").unwrap();
        let file =
            create_file_beneath(&root, "source", "source/example/orders/Created.java").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"");
        fs::write(&file, "existing draft").unwrap();
        assert!(
            create_file_beneath(&root, "source", "source/example/orders/Created.java").is_err()
        );
        assert_eq!(fs::read(&file).unwrap(), b"existing draft");
        assert_eq!(fs::read(root.join("source/notes.txt")).unwrap(), b"keep");
        for (anchor, path) in [
            ("missing", "missing/example/Created.java"),
            ("source", "other/example/Created.java"),
            ("source", "source/../outside/Created.java"),
            ("source", "/source/example/Created.java"),
            ("source", "source//example/Created.java"),
            ("source", "source/example\\outside/Created.java"),
        ] {
            assert!(
                create_file_beneath(&root, anchor, path).is_err(),
                "{anchor}: {path}"
            );
        }
        assert!(!root.join("missing").exists());
        assert!(!root.join("other").exists());
        assert!(!root.join("outside").exists());
        assert!(create_file_beneath(&root, ".", "unicode/例子/Created.java").is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn nested_file_creation_refuses_symlinks_and_cleans_only_its_empty_directories() {
        use std::os::unix::fs::symlink;
        let root = make_temp_workspace();
        let outside = make_temp_workspace();
        fs::create_dir(root.join("source")).unwrap();
        symlink(&outside, root.join("source/linked")).unwrap();
        assert!(
            create_file_beneath(&root, "source", "source/linked/example/Created.java").is_err()
        );
        assert!(!outside.join("example").exists());
        fs::create_dir(root.join("source/retained")).unwrap();
        let too_long = format!("source/retained/new/package/{}.java", "a".repeat(300));
        assert!(create_file_beneath(&root, "source", &too_long).is_err());
        assert!(root.join("source/retained").is_dir());
        assert!(!root.join("source/retained/new").exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn stale_workspace_authority_is_rejected_before_running_a_file_operation() {
        let active_root = make_temp_workspace();
        let other_root = make_temp_workspace();
        let mut operation_ran = false;

        let stale_root = run_if_workspace_authority_matches(
            &active_root,
            5,
            other_root.to_str().unwrap(),
            5,
            |_| {
                operation_ran = true;
                Ok(())
            },
        );
        let stale_generation = run_if_workspace_authority_matches(
            &active_root,
            6,
            active_root.to_str().unwrap(),
            5,
            |_| {
                operation_ran = true;
                Ok(())
            },
        );
        let current = run_if_workspace_authority_matches(
            &active_root,
            5,
            active_root.to_str().unwrap(),
            5,
            |root| Ok(root == active_root),
        );

        assert!(stale_root.is_err());
        assert!(stale_generation.is_err());
        assert!(!operation_ran);
        assert_eq!(current, Ok(true));

        let _ = fs::remove_dir_all(active_root);
        let _ = fs::remove_dir_all(other_root);
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

        let result = delete_path(
            outside.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            super::super::workspace_registry::active_workspace_generation(),
        );

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
        assert!(entry.workspace_generation.is_some());

        for _ in 0..MAX_DIRECTORY_DEPTH {
            let children = entry.children.take().unwrap();
            entry = children.into_iter().next().unwrap();
        }

        assert!(entry.children.unwrap().is_empty());
        env::remove_var(WORKSPACE_ROOT_ENV);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn quick_open_finds_deep_workspace_files_and_ignores_generated_directories() {
        let root = make_temp_workspace();
        let source = root.join("src/main/java/example/deep/MainController.java");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "class MainController {}").unwrap();
        fs::create_dir_all(root.join("target/generated-sources/example")).unwrap();
        fs::write(
            root.join("target/generated-sources/example/MainController.java"),
            "class GeneratedMainController {}",
        )
        .unwrap();

        let result = search_workspace_files_at(&root, 17, "maincont").unwrap();

        assert_eq!(result.workspace_generation, 17);
        assert_eq!(result.files.len(), 1);
        assert_eq!(
            result.files[0].path,
            "src/main/java/example/deep/MainController.java"
        );
        assert!(!result.truncated);
        assert!(!result.partial);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explorer_exposes_conventional_output_names_without_eagerly_traversing_them() {
        let root = make_temp_workspace();
        fs::create_dir_all(root.join("source code/build")).unwrap();
        fs::create_dir_all(root.join("target/generated-sources")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(
            root.join("source code/build/Main.java"),
            "package build; class Main {}\n",
        )
        .unwrap();
        let entry = read_directory_recursive(&root, &root, 0).unwrap();
        let children = entry.children.unwrap();
        assert!(!children.iter().any(|entry| entry.name == ".git"));
        assert!(children
            .iter()
            .find(|entry| entry.name == "target")
            .unwrap()
            .children
            .as_ref()
            .unwrap()
            .is_empty());
        let sources = children
            .iter()
            .find(|entry| entry.name == "source code")
            .unwrap();
        let package = sources
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|entry| entry.name == "build")
            .unwrap();
        assert!(package.children.as_ref().unwrap().is_empty());
        let opened = read_directory_recursive(&root, &root.join("source code/build"), 0).unwrap();
        assert_eq!(opened.children.unwrap()[0].name, "Main.java");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn quick_open_ranks_exact_and_prefix_names_before_path_matches() {
        let root = make_temp_workspace();
        fs::create_dir_all(root.join("docs/Example.java")).unwrap();
        fs::write(root.join("docs/Example.java/README.md"), "readme").unwrap();
        fs::create_dir_all(root.join("src/example")).unwrap();
        fs::write(root.join("src/example/Example.java"), "class Example {}").unwrap();
        fs::create_dir_all(root.join("src/example/deep")).unwrap();
        fs::write(
            root.join("src/example/deep/ExampleTest.java"),
            "class ExampleTest {}",
        )
        .unwrap();

        let result = search_workspace_files_at(&root, 2, "Example.java").unwrap();

        assert_eq!(result.files.len(), 3);
        assert_eq!(result.files[0].path, "src/example/Example.java");
        assert_eq!(result.files[1].path, "docs/Example.java/README.md");
        assert_eq!(result.files[2].path, "src/example/deep/ExampleTest.java");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn quick_open_reports_bounded_results_for_many_matches() {
        let root = make_temp_workspace();
        for index in 0..=MAX_FILE_SEARCH_RESULTS {
            fs::write(root.join(format!("Main{index:05}.java")), "class Main {}").unwrap();
        }

        let result = search_workspace_files_at(&root, 3, "Main").unwrap();

        assert!(result.truncated);
        assert!(result.files.len() <= MAX_FILE_SEARCH_RESULTS);
        let _ = fs::remove_dir_all(root);
    }
}
