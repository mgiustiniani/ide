use std::env;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use arc_swap::ArcSwapOption;

pub const WORKSPACE_ROOT_ENV: &str = "IDE_WORKSPACE_ROOT";

fn workspace_root_override() -> &'static ArcSwapOption<PathBuf> {
    static OVERRIDE: OnceLock<ArcSwapOption<PathBuf>> = OnceLock::new();
    OVERRIDE.get_or_init(|| ArcSwapOption::new(None))
}

pub fn set_workspace_root_override(path: PathBuf) -> Result<(), String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace root '{}': {e}", path.display()))?;

    if !canonical.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            canonical.display()
        ));
    }

    workspace_root_override().store(Some(Arc::new(canonical)));
    Ok(())
}

pub fn workspace_root() -> Result<PathBuf, String> {
    if let Some(root) = workspace_root_override().load_full() {
        return Ok((*root).clone());
    }

    let root = env::var_os(WORKSPACE_ROOT_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let canonical = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace root '{}': {e}", root.display()))?;

    if !canonical.is_dir() {
        return Err(format!(
            "Workspace root is not a directory: {}",
            canonical.display()
        ));
    }

    Ok(canonical)
}

pub fn resolve_existing_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = workspace_root()?;
    resolve_existing_path_in_root(&root, path)
}

pub fn resolve_new_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = workspace_root()?;
    resolve_new_path_in_root(&root, path)
}

pub fn ensure_within_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err(format!(
            "Path escapes workspace root: {} is outside {}",
            path.display(),
            root.display()
        ))
    }
}

pub fn validate_child_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err("New name must be a non-empty filename".to_string());
    }

    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("New name must be a single filename, not a path".to_string());
    }

    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None) if component == name => Ok(()),
        _ => Err("New name must be a single filename, not a path".to_string()),
    }
}

pub(crate) fn resolve_existing_path_in_root(
    root: &Path,
    path: impl AsRef<Path>,
) -> Result<PathBuf, String> {
    let candidate = root.join_components(path.as_ref())?;
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {e}", candidate.display()))?;
    ensure_within_root(root, &canonical)?;
    Ok(canonical)
}

pub(crate) fn resolve_new_path_in_root(
    root: &Path,
    path: impl AsRef<Path>,
) -> Result<PathBuf, String> {
    let components = normalize_components(root, path.as_ref())?;
    let candidate = components
        .iter()
        .fold(root.to_path_buf(), |acc, component| acc.join(component));

    verify_existing_ancestors_stay_in_root(root, &components)?;

    if candidate.exists() {
        let canonical = candidate
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path '{}': {e}", candidate.display()))?;
        ensure_within_root(root, &canonical)?;
    }

    Ok(candidate)
}

fn verify_existing_ancestors_stay_in_root(
    root: &Path,
    components: &[OsString],
) -> Result<(), String> {
    let mut current = root.to_path_buf();

    for component in components {
        current.push(component);

        if !current.exists() {
            break;
        }

        let canonical = current
            .canonicalize()
            .map_err(|e| format!("Cannot resolve path '{}': {e}", current.display()))?;
        ensure_within_root(root, &canonical)?;
    }

    Ok(())
}

trait JoinChecked {
    fn join_components(&self, path: &Path) -> Result<PathBuf, String>;
}

impl JoinChecked for Path {
    fn join_components(&self, path: &Path) -> Result<PathBuf, String> {
        let components = normalize_components(self, path)?;
        Ok(components
            .iter()
            .fold(self.to_path_buf(), |acc, component| acc.join(component)))
    }
}

fn normalize_components(root: &Path, path: &Path) -> Result<Vec<OsString>, String> {
    let relative = if path.is_absolute() {
        path.strip_prefix(root).map_err(|_| {
            format!(
                "Path escapes workspace root: {} is outside {}",
                path.display(),
                root.display()
            )
        })?
    } else {
        path
    };

    let mut components = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => components.push(part.to_os_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Path traversal outside the workspace is not allowed".to_string())
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Absolute paths must stay inside the workspace root".to_string())
            }
        }
    }

    Ok(components)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
        let root = env::temp_dir().join(format!("ide-desktop-workspace-test-{id}"));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn existing_path_must_stay_inside_workspace() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        let outside = env::temp_dir().join(format!(
            "ide-desktop-outside-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "secret").unwrap();

        let result = resolve_existing_path_in_root(&root, &outside);

        assert!(result.is_err());
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn traversal_components_are_rejected() {
        let _guard = test_lock();
        let root = make_temp_workspace();

        let result = resolve_new_path_in_root(&root, "../escape.txt");

        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        let outside = env::temp_dir().join(format!(
            "ide-desktop-symlink-outside-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.txt")).unwrap();

        let result = resolve_existing_path_in_root(&root, "link.txt");

        assert!(result.is_err());
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_root_override_rejects_non_directory() {
        let _guard = test_lock();
        let root = make_temp_workspace();
        let file = root.join("file.txt");
        fs::write(&file, "content").unwrap();

        let result = set_workspace_root_override(file);

        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_name_must_be_single_filename() {
        assert!(validate_child_name("safe-name.txt").is_ok());
        assert!(validate_child_name("../escape.txt").is_err());
        assert!(validate_child_name("nested/file.txt").is_err());
    }
}
