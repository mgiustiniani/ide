use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, CurrentWorkspaceBinding,
};
use crate::workspace::workspace_root;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{State, WebviewWindow};

const MAX_BYTES: u64 = 4 * 1024 * 1024;
const WORK_BUDGET: Duration = Duration::from_millis(250);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    workspace_id: String,
    generation: u64,
    file_path: String,
    expected_revision: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    workspace_id: String,
    generation: u64,
    file_path: String,
    status: &'static str,
}
#[derive(Default)]
pub struct EditorDiskInspectionState {
    busy: Arc<AtomicBool>,
}
struct WorkerSlot(Arc<AtomicBool>);
impl Drop for WorkerSlot {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl EditorDiskInspectionState {
    fn acquire(&self) -> Result<WorkerSlot, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "Disk inspection is busy; retry".to_string())?;
        Ok(WorkerSlot(self.busy.clone()))
    }
}
fn validate(label: &str, request: &Request) -> Result<(), String> {
    if label != "main"
        || request.generation == 0
        || request.generation > 9_007_199_254_740_991
        || request.workspace_id.trim().is_empty()
        || request.workspace_id.len() > 256
        || request.workspace_id.contains('\0')
        || request.file_path.is_empty()
        || request.file_path.len() > 4096
        || request.file_path.contains(['\\', ':', '\0'])
        || request
            .file_path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || request.expected_revision.len() != 64
        || !request
            .expected_revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Disk inspection is restricted to a current main-workspace file".into());
    }
    Ok(())
}
fn authorize(
    label: &str,
    request: &Request,
    root: &Path,
    registry: &Path,
) -> Result<CurrentWorkspaceBinding, String> {
    validate(label, request)?;
    let binding = current_workspace_binding_at(root, registry)?;
    if binding.workspace_id != request.workspace_id {
        return Err("The disk inspection workspace changed".into());
    }
    Ok(binding)
}

// Descriptor-relative Unix traversal refuses symlink ancestors and special files,
// including FIFOs, without blocking on opening them or following paths outside root.
#[cfg(unix)]
pub(crate) fn open_checked(root: &Path, relative: &str) -> io::Result<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::OpenOptionsExt;
    let mut current = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)?;
    let parts: Vec<_> = relative.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        let name = CString::new(*part).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | libc::O_NONBLOCK
            | if index + 1 < parts.len() {
                libc::O_DIRECTORY
            } else {
                0
            };
        // SAFETY: current owns a live directory descriptor and name is NUL-terminated.
        let descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: successful openat returned a new, exclusively owned descriptor.
        current = unsafe { File::from_raw_fd(descriptor) };
    }
    Ok(current)
}
#[cfg(not(unix))]
pub(crate) fn open_checked(root: &Path, relative: &str) -> io::Result<File> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        if fs::symlink_metadata(&path)?.file_type().is_symlink() {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
    }
    File::open(path)
}
fn same_file(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() {
            return false;
        }
    }
    before.len() == after.len() && before.modified().ok() == after.modified().ok()
}
fn inspect_revision(root: &Path, request: &Request) -> &'static str {
    let started = Instant::now();
    let mut file = match open_checked(root, &request.file_path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return "missing",
        Err(_) => return "unavailable",
    };
    let before = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return "unavailable",
    };
    if !before.is_file() || before.len() > MAX_BYTES {
        return "unavailable";
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.nlink() != 1 {
            return "unavailable";
        }
    }
    let mut hash = Sha256::new();
    let mut chunk = [0_u8; 8192];
    let mut total = 0_u64;
    loop {
        if started.elapsed() > WORK_BUDGET {
            return "unavailable";
        }
        let count = match file.read(&mut chunk) {
            Ok(count) => count,
            Err(_) => return "unavailable",
        };
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_BYTES {
            return "unavailable";
        }
        hash.update(&chunk[..count]);
    }
    let after = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return "unavailable",
    };
    let at_path = match open_checked(root, &request.file_path).and_then(|file| file.metadata()) {
        Ok(metadata) => metadata,
        Err(_) => return "unavailable",
    };
    if total != before.len()
        || !same_file(&before, &after)
        || !same_file(&after, &at_path)
        || started.elapsed() > WORK_BUDGET
    {
        return "unavailable";
    }
    if format!("{:x}", hash.finalize()) == request.expected_revision {
        "unchanged"
    } else {
        "changed"
    }
}

#[tauri::command]
pub async fn inspect_editor_disk_status(
    window: WebviewWindow,
    state: State<'_, EditorDiskInspectionState>,
    request: Request,
) -> Result<Response, String> {
    let label = window.label().to_string();
    validate(&label, &request)?;
    let slot = state.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _slot = slot;
        let binding = authorize(
            &label,
            &request,
            &workspace_root()?,
            &workspace_registry_path()?,
        )?;
        let status = inspect_revision(&binding.canonical_root, &request);
        if workspace_root()? != binding.canonical_root
            || !current_workspace_binding_is_current(&binding)
        {
            return Err("The disk inspection workspace changed".into());
        }
        Ok(Response {
            workspace_id: request.workspace_id,
            generation: request.generation,
            file_path: request.file_path,
            status,
        })
    })
    .await
    .map_err(|_| "Disk inspection worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Request {
        Request {
            workspace_id: "one".into(),
            generation: 1,
            file_path: "file.txt".into(),
            expected_revision: format!("{:x}", Sha256::digest(b"before")),
        }
    }
    fn root() -> std::path::PathBuf {
        let mut nonce = [0; 8];
        getrandom::fill(&mut nonce).unwrap();
        let root =
            std::env::temp_dir().join(format!("ide-disk-check-{:x}", u64::from_le_bytes(nonce)));
        fs::create_dir(&root).unwrap();
        root.canonicalize().unwrap()
    }
    #[test]
    fn content_checks_detect_same_length_changes_without_writing() {
        let root = root();
        let path = root.join("file.txt");
        fs::write(&path, "before").unwrap();
        assert_eq!(inspect_revision(&root, &request()), "unchanged");
        fs::write(&path, "after!").unwrap();
        assert_eq!(inspect_revision(&root, &request()), "changed");
        assert_eq!(fs::read(&path).unwrap(), b"after!");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_files_are_reported_without_recreation() {
        let root = root();
        assert_eq!(inspect_revision(&root, &request()), "missing");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn directories_and_oversized_files_are_unavailable() {
        let root = root();
        let path = root.join("file.txt");
        fs::create_dir(&path).unwrap();
        assert_eq!(inspect_revision(&root, &request()), "unavailable");
        fs::remove_dir(&path).unwrap();
        File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        assert_eq!(inspect_revision(&root, &request()), "unavailable");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn validation_refuses_foreign_windows_unsafe_paths_and_invalid_correlation() {
        assert!(validate("main", &request()).is_ok());
        assert!(validate("pi-view", &request()).is_err());
        for path in [
            "../outside",
            "/outside",
            "a/../outside",
            "a//file",
            "a\\file",
            "C:other",
            "",
            "./file",
        ] {
            let mut request = request();
            request.file_path = path.into();
            assert!(validate("main", &request).is_err());
        }
        for generation in [0, 9_007_199_254_740_992] {
            let mut request = request();
            request.generation = generation;
            assert!(validate("main", &request).is_err());
        }
        let mut request = request();
        request.expected_revision = "not-a-revision".into();
        assert!(validate("main", &request).is_err());
    }
    #[test]
    fn native_authority_checks_the_registered_active_root_and_id() {
        let root = root();
        let registry = root.join("registry.json");
        fs::write(&registry, serde_json::to_vec(&serde_json::json!({ "version": 1, "currentWorkspaceId": "one", "workspaces": [{ "id":"one", "name":"One", "rootPath":root.to_string_lossy() }] })).unwrap()).unwrap();
        assert!(authorize("main", &request(), &root, &registry).is_ok());
        let mut other = request();
        other.workspace_id = "other".into();
        assert!(authorize("main", &other, &root, &registry).is_err());
        let foreign = self::root();
        assert!(authorize("main", &request(), &foreign, &registry).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(foreign).unwrap();
    }
    #[test]
    fn a_timed_out_caller_cannot_create_unbounded_native_workers() {
        let state = EditorDiskInspectionState::default();
        let slot = state.acquire().unwrap();
        assert!(state.acquire().is_err());
        drop(slot);
        assert!(state.acquire().is_ok());
    }
    #[test]
    fn unknown_request_fields_do_not_create_authority() {
        let json = serde_json::json!({ "workspaceId":"one", "generation":1, "filePath":"file.txt", "expectedRevision":"a".repeat(64), "reload":true });
        assert!(serde_json::from_value::<Request>(json).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlink_ancestors_hard_links_and_fifos_are_not_read_or_followed() {
        use std::os::unix::fs::symlink;
        let root = root();
        let outside = self::root();
        fs::write(outside.join("private"), "outside source").unwrap();
        symlink(outside.join("private"), root.join("file.txt")).unwrap();
        assert_eq!(inspect_revision(&root, &request()), "unavailable");
        fs::remove_file(root.join("file.txt")).unwrap();
        symlink(&outside, root.join("linked")).unwrap();
        let mut ancestor = request();
        ancestor.file_path = "linked/private".into();
        assert_eq!(inspect_revision(&root, &ancestor), "unavailable");
        fs::hard_link(outside.join("private"), root.join("file.txt")).unwrap();
        assert_eq!(inspect_revision(&root, &request()), "unavailable");
        fs::remove_file(root.join("file.txt")).unwrap();
        let name = std::ffi::CString::new(root.join("file.txt").to_str().unwrap()).unwrap();
        // SAFETY: name is a valid NUL-terminated private fixture pathname.
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        let start = Instant::now();
        assert_eq!(inspect_revision(&root, &request()), "unavailable");
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(
            fs::read(outside.join("private")).unwrap(),
            b"outside source"
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
