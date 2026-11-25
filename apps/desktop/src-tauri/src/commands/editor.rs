use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::workspace::{resolve_existing_path_in_root, resolve_new_path_in_root, workspace_root};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
const MAX_FILE_WORKERS: usize = 4;

#[derive(Default)]
struct FileWorkers(Arc<AtomicUsize>);
struct FileWorker(Arc<AtomicUsize>);
impl Drop for FileWorker {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl FileWorkers {
    fn acquire(&self) -> Result<FileWorker, String> {
        self.0
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_FILE_WORKERS).then_some(count + 1)
            })
            .map_err(|_| "Editor file I/O is busy; retry.".to_string())?;
        Ok(FileWorker(self.0.clone()))
    }
}
fn file_workers() -> &'static FileWorkers {
    static WORKERS: OnceLock<FileWorkers> = OnceLock::new();
    WORKERS.get_or_init(FileWorkers::default)
}
async fn file_io(
    workers: &FileWorkers,
    operation: impl FnOnce() -> Result<Value, String> + Send + 'static,
) -> Result<Value, String> {
    let worker = workers.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _worker = worker;
        operation()
    })
    .await
    .map_err(|_| "Editor file I/O worker failed.".to_string())?
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<Value, String> {
    let root = workspace_root()?;
    file_io(file_workers(), move || read_file_in_root(&root, &path)).await
}

pub fn read_file_in_root(root: &Path, path: &str) -> Result<Value, String> {
    read_resolved_file(&resolve_existing_path_in_root(root, path)?, path)
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_resolved_file(path: &Path, requested_path: &str) -> Result<Value, String> {
    if !path.is_file() {
        return Err(format!("Path is not a file: {requested_path}"));
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read file: {e}"))?;
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| "The file is not valid UTF-8; it was not opened.".to_string())?;
    Ok(json!({
        "path": path.to_string_lossy(), "content": content,
        "language": infer_language(path), "revision": revision(&bytes)
    }))
}

#[tauri::command]
pub async fn write_file(
    path: String,
    content: String,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    // Resolve against this command's admitted root, not a later workspace selected
    // while a worker is occupied. Already-admitted filesystem I/O is not cancelled.
    let root = workspace_root()?;
    file_io(file_workers(), move || {
        let resolved = resolve_new_path_in_root(&root, &path)?;
        let revision =
            write_atomically(&resolved, content.as_bytes(), expected_revision.as_deref())?;
        Ok(json!({"success": true, "path": resolved.to_string_lossy(), "revision": revision}))
    })
    .await
}

fn check_revision(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected else {
        return if path.exists() {
            Err("The new file already exists; inspect it before saving.".to_string())
        } else {
            Ok(())
        };
    };
    let current = fs::read(path)
        .map_err(|_| "The file changed or disappeared; reopen it before saving.".to_string())?;
    if revision(&current) != expected {
        return Err("The file was changed by another tool; reopen it before saving.".to_string());
    }
    Ok(())
}

fn write_atomically(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<String, String> {
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "File writer is unavailable".to_string())?;
    check_revision(path, expected)?;
    let parent = path.parent().ok_or("The file has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent directory: {e}"))?;
    let mut nonce = [0_u8; 16];
    getrandom::fill(&mut nonce).map_err(|_| "Cannot prepare an atomic save".to_string())?;
    let name: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let temporary = parent.join(format!(".ide-save-{name}.tmp"));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| format!("Cannot prepare file save: {e}"))?;
        if let Ok(metadata) = fs::metadata(path) {
            fs::set_permissions(&temporary, metadata.permissions())
                .map_err(|e| format!("Cannot preserve file permissions: {e}"))?;
        }
        file.write_all(bytes)
            .map_err(|e| format!("Cannot write file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush file: {e}"))?;
        drop(file);
        check_revision(path, expected)?;
        if expected.is_none() {
            fs::hard_link(&temporary, path).map_err(|_| {
                "The new file already exists; inspect it before saving.".to_string()
            })?;
            fs::remove_file(&temporary)
                .map_err(|_| "The new file was saved but temporary cleanup failed.".to_string())?;
        } else {
            fs::rename(&temporary, path).map_err(|e| format!("Cannot publish file save: {e}"))?;
        }
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| {
                format!("The file was saved but directory durability could not be verified: {e}")
            })?;
        Ok(revision(bytes))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn infer_language(path: &Path) -> String {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "rs" => "rust",
        "js" => "javascript",
        "ts" => "typescript",
        "tsx" => "typescriptreact",
        "jsx" => "javascriptreact",
        "py" => "python",
        "json" => "json",
        "html" => "html",
        "css" => "css",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" | "markdown" => "markdown",
        "adoc" | "asciidoc" => "asciidoc",
        "rst" | "rest" => "rst",
        "sh" | "bash" => "shell",
        "c" => "c",
        "cpp" | "hpp" | "h" => "cpp",
        "go" => "go",
        "java" => "java",
        "rb" => "ruby",
        "php" => "php",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "sql" => "sql",
        "xml" | "svg" => "xml",
        _ => "plaintext",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ide-atomic-save-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn file_workers_refuse_excess_admission_and_release_capacity() {
        let workers = FileWorkers::default();
        let slots: Vec<_> = (0..MAX_FILE_WORKERS)
            .map(|_| workers.acquire().unwrap())
            .collect();
        assert!(workers.acquire().is_err());
        let result = tauri::async_runtime::block_on(file_io(&workers, || {
            panic!("a refused file operation must not run")
        }));
        assert_eq!(result.unwrap_err(), "Editor file I/O is busy; retry.");
        drop(slots);
        assert_eq!(workers.0.load(Ordering::Acquire), 0);
        assert!(workers.acquire().is_ok());
    }

    #[test]
    fn source_io_runs_on_a_worker_and_preserves_operation_errors() {
        let workers = FileWorkers::default();
        let caller = std::thread::current().id();
        let result = tauri::async_runtime::block_on(file_io(&workers, move || {
            assert_ne!(std::thread::current().id(), caller);
            Err("source operation refused".to_string())
        }));
        assert_eq!(result.unwrap_err(), "source operation refused");
        assert_eq!(workers.0.load(Ordering::Acquire), 0);
    }

    #[test]
    fn worker_failure_is_sanitized_and_releases_its_slot() {
        let workers = FileWorkers::default();
        let result =
            tauri::async_runtime::block_on(file_io(&workers, || panic!("isolated worker panic")));
        assert_eq!(result.unwrap_err(), "Editor file I/O worker failed.");
        assert_eq!(workers.0.load(Ordering::Acquire), 0);
    }

    #[test]
    fn retiring_a_caller_keeps_the_slot_until_admitted_io_finishes() {
        let workers = Arc::new(FileWorkers::default());
        let task_workers = workers.clone();
        let (started, observed) = std::sync::mpsc::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let task = tauri::async_runtime::spawn(async move {
            file_io(&task_workers, move || {
                started.send(()).unwrap();
                blocked.recv().unwrap();
                Ok(json!({"finished": true}))
            })
            .await
        });
        observed
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        task.abort();
        assert!(tauri::async_runtime::block_on(task).is_err());
        assert_eq!(workers.0.load(Ordering::Acquire), 1);
        release.send(()).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while workers.0.load(Ordering::Acquire) != 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert_eq!(workers.0.load(Ordering::Acquire), 0);
    }

    #[test]
    fn atomic_save_preserves_external_changes_on_revision_conflict() {
        let root = root();
        let path = root.join("Main.java");
        fs::write(&path, "original").unwrap();
        let expected = revision(b"original");
        fs::write(&path, "external").unwrap();
        assert!(write_atomically(&path, b"editor", Some(&expected)).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_save_publishes_exact_bytes_and_returns_next_revision() {
        let root = root();
        let path = root.join("Main.java");
        fs::write(&path, "original").unwrap();
        let next = write_atomically(&path, b"new\n", Some(&revision(b"original"))).unwrap();
        assert_eq!(next, revision(b"new\n"));
        assert_eq!(fs::read(&path).unwrap(), b"new\n");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_first_save_creates_without_overwriting_a_new_file() {
        let root = root();
        let path = root.join("Base.java");
        let next = write_atomically(&path, b"class Base {}", None).unwrap();
        assert_eq!(next, revision(b"class Base {}"));
        assert_eq!(fs::read(&path).unwrap(), b"class Base {}");
        assert!(write_atomically(&path, b"class Overwrite {}", None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"class Base {}");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
