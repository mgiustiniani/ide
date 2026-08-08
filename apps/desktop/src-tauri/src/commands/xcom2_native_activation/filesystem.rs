use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub(super) const SCRIPT_RELATIVE_PATH: &str = ".scripts/build.ps1";
pub(super) const NOTICE_RELATIVE_PATH: &str = ".scripts/X2ModBuildCommon.NOTICE.txt";
pub(super) const HIGHLANDER_SOURCE_RELATIVE_PATH: &str = "Highlander/XComGame";
const MAXIMUM_SCRIPT_BYTES: u64 = 1024 * 1024;
const MAXIMUM_NOTICE_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(not(unix))]
    canonical_path: PathBuf,
    #[cfg(not(unix))]
    length: u64,
    #[cfg(not(unix))]
    modified: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkspaceBinding {
    pub canonical_root: PathBuf,
    pub root_identity: FileIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct InspectedRecipeFacts {
    pub module_identity: String,
    pub script_sha256: String,
    pub script_byte_size: u64,
    pub notice_text: String,
    pub notice_sha256: String,
}

pub(super) fn bind_workspace(root: &Path) -> Result<WorkspaceBinding, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "workspace-authority-unavailable".to_string())?;
    let metadata = fs::symlink_metadata(&canonical_root)
        .map_err(|_| "workspace-authority-unavailable".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("workspace-authority-unavailable".to_string());
    }
    Ok(WorkspaceBinding {
        root_identity: identity(&canonical_root, &metadata),
        canonical_root,
    })
}

pub(super) fn binding_is_current(binding: &WorkspaceBinding) -> bool {
    let Ok(current) = bind_workspace(&binding.canonical_root) else {
        return false;
    };
    current == *binding
}

pub(super) fn module_directory_identity(
    binding: &WorkspaceBinding,
    module_root: &str,
) -> Result<FileIdentity, String> {
    if !portable_relative_path(module_root, true) {
        return Err("module-root-invalid".to_string());
    }
    open_directory_chain(binding, module_root).map(|(_, identity)| identity)
}

pub(super) fn inspect_recipe(
    binding: &WorkspaceBinding,
    module_root: &str,
    expected_module_identity: &FileIdentity,
) -> Result<InspectedRecipeFacts, String> {
    if !binding_is_current(binding) {
        return Err("stale-workspace".to_string());
    }
    if contains_excluded_segment(module_root) || !module_root.is_ascii() {
        return Err("build-recipe-module-root-invalid".to_string());
    }
    let (module, identity) = open_directory_chain(binding, module_root)?;
    if &identity != expected_module_identity {
        return Err("module-identity-changed".to_string());
    }

    let scripts = open_child_directory(&module, ".scripts")?;
    let scripts_identity = directory_identity(&scripts)?;
    let script_name = SCRIPT_RELATIVE_PATH
        .strip_prefix(".scripts/")
        .expect("fixed script path stays below .scripts");
    let (script_bytes, script_metadata) = read_bounded_regular_file(
        &scripts,
        script_name,
        MAXIMUM_SCRIPT_BYTES,
        "build-recipe-script-unavailable",
    )?;
    if script_bytes.is_empty() {
        return Err("build-recipe-script-unavailable".to_string());
    }
    let notice_name = NOTICE_RELATIVE_PATH
        .strip_prefix(".scripts/")
        .expect("fixed notice path stays below .scripts");
    let (notice_bytes, _) = read_bounded_regular_file(
        &scripts,
        notice_name,
        MAXIMUM_NOTICE_BYTES,
        "build-recipe-provenance-unavailable",
    )?;
    let notice = std::str::from_utf8(&notice_bytes)
        .map_err(|_| "build-recipe-provenance-unavailable".to_string())?
        .trim()
        .to_string();
    validate_synthetic_notice(&notice)?;

    let highlander = open_child_directory(&module, "Highlander")?;
    let highlander_identity = directory_identity(&highlander)?;
    let xcom_game = open_child_directory(&highlander, "XComGame")?;
    let xcom_game_identity = directory_identity(&xcom_game)?;

    if module_directory_identity(binding, module_root)? != *expected_module_identity
        || directory_identity(&open_child_directory(&module, ".scripts")?)? != scripts_identity
        || directory_identity(&open_child_directory(&module, "Highlander")?)? != highlander_identity
        || directory_identity(&open_child_directory(&highlander, "XComGame")?)?
            != xcom_game_identity
    {
        return Err("build-recipe-metadata-changed".to_string());
    }

    let module_identity = module_root
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty() && *name != ".")
        .unwrap_or("workspace");
    let module_identity = format!("xcom2-module:{module_identity}");
    if module_identity.len() > 256
        || !module_identity.is_ascii()
        || module_identity.chars().any(is_control)
    {
        return Err("module-identity-invalid".to_string());
    }

    Ok(InspectedRecipeFacts {
        module_identity,
        script_sha256: sha256_hex(&script_bytes),
        script_byte_size: script_metadata.len(),
        notice_sha256: sha256_hex(notice.as_bytes()),
        notice_text: notice,
    })
}

fn directory_identity(directory: &File) -> Result<FileIdentity, String> {
    let metadata = directory
        .metadata()
        .map_err(|_| "build-recipe-metadata-unavailable".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("build-recipe-metadata-unavailable".to_string());
    }
    Ok(identity(Path::new("."), &metadata))
}

fn validate_synthetic_notice(notice: &str) -> Result<(), String> {
    if notice.is_empty()
        || notice.len() > MAXIMUM_NOTICE_BYTES as usize
        || !notice.is_ascii()
        || notice.chars().any(is_control)
        || !notice.contains("X2ModBuildCommon")
        || !notice.contains("MIT")
        || !(notice.contains("contributors") || notice.contains("attribution"))
        || notice.contains("Permission is hereby granted")
    {
        return Err("build-recipe-provenance-unavailable".to_string());
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn portable_relative_path(path: &str, allow_root: bool) -> bool {
    if path.is_empty()
        || path.len() > 4096
        || path.starts_with('/')
        || path.contains('\\')
        || path.chars().any(is_control)
        || has_windows_drive_prefix(path)
        || path
            .get(..6)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:/"))
    {
        return false;
    }
    if path == "." {
        return allow_root;
    }
    path.split('/')
        .all(|component| !component.is_empty() && component != "." && component != "..")
}

fn contains_excluded_segment(path: &str) -> bool {
    path.split('/').any(|segment| {
        matches!(
            segment.to_ascii_lowercase().as_str(),
            "content" | "script" | "vendor" | "build" | "log" | "asset" | "assets"
        )
    })
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_control(character: char) -> bool {
    matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}'..='\u{009f}')
}

#[cfg(unix)]
fn open_directory_chain(
    binding: &WorkspaceBinding,
    relative: &str,
) -> Result<(File, FileIdentity), String> {
    use std::os::fd::{AsRawFd, FromRawFd};

    let root = File::open(&binding.canonical_root)
        .map_err(|_| "workspace-authority-unavailable".to_string())?;
    let metadata = root
        .metadata()
        .map_err(|_| "workspace-authority-unavailable".to_string())?;
    if !metadata.is_dir() || identity(&binding.canonical_root, &metadata) != binding.root_identity {
        return Err("workspace-authority-unavailable".to_string());
    }
    if relative == "." {
        return Ok((root, binding.root_identity.clone()));
    }

    let mut current = root;
    for component in relative.split('/') {
        let fd = openat(
            current.as_raw_fd(),
            component,
            libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK,
        )
        .map_err(|_| "module-root-unavailable".to_string())?;
        // SAFETY: openat returned a new owned descriptor and ownership is transferred once.
        let next = unsafe { File::from_raw_fd(fd) };
        let metadata = next
            .metadata()
            .map_err(|_| "module-root-unavailable".to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("module-root-unavailable".to_string());
        }
        current = next;
    }
    let metadata = current
        .metadata()
        .map_err(|_| "module-root-unavailable".to_string())?;
    Ok((
        current,
        identity(&binding.canonical_root.join(relative), &metadata),
    ))
}

#[cfg(not(unix))]
fn open_directory_chain(
    binding: &WorkspaceBinding,
    relative: &str,
) -> Result<(File, FileIdentity), String> {
    let mut path = binding.canonical_root.clone();
    if relative != "." {
        for component in relative.split('/') {
            path.push(component);
            let metadata =
                fs::symlink_metadata(&path).map_err(|_| "module-root-unavailable".to_string())?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("module-root-unavailable".to_string());
            }
        }
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "module-root-unavailable".to_string())?;
    if canonical != path || !canonical.starts_with(&binding.canonical_root) {
        return Err("module-root-unavailable".to_string());
    }
    let file = File::open(&path).map_err(|_| "module-root-unavailable".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "module-root-unavailable".to_string())?;
    Ok((file, identity(&path, &metadata)))
}

#[cfg(unix)]
fn open_child_directory(parent: &File, name: &str) -> Result<File, String> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let fd = openat(
        parent.as_raw_fd(),
        name,
        libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK,
    )
    .map_err(|_| "build-recipe-metadata-unavailable".to_string())?;
    // SAFETY: openat returned a new owned descriptor and ownership is transferred once.
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file
        .metadata()
        .map_err(|_| "build-recipe-metadata-unavailable".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("build-recipe-metadata-unavailable".to_string());
    }
    Ok(file)
}

#[cfg(not(unix))]
fn open_child_directory(parent: &File, _name: &str) -> Result<File, String> {
    let _ = parent;
    Err("build-recipe-inspection-unsupported".to_string())
}

#[cfg(unix)]
fn read_bounded_regular_file(
    parent: &File,
    name: &str,
    maximum: u64,
    failure: &str,
) -> Result<(Vec<u8>, Metadata), String> {
    use std::os::fd::{AsRawFd, FromRawFd};

    let fd = openat(
        parent.as_raw_fd(),
        name,
        libc::O_NOFOLLOW | libc::O_NONBLOCK,
    )
    .map_err(|_| failure.to_string())?;
    // SAFETY: openat returned a new owned descriptor and ownership is transferred once.
    let mut file = unsafe { File::from_raw_fd(fd) };
    let before = file.metadata().map_err(|_| failure.to_string())?;
    if !before.is_file()
        || before.file_type().is_symlink()
        || before.len() == 0
        || before.len() > maximum
    {
        return Err(failure.to_string());
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.by_ref()
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| failure.to_string())?;
    let after = file.metadata().map_err(|_| failure.to_string())?;
    if bytes.len() as u64 != before.len() || !stable_metadata_equal(&before, &after) {
        return Err(failure.to_string());
    }

    let verification_fd = openat(
        parent.as_raw_fd(),
        name,
        libc::O_NOFOLLOW | libc::O_NONBLOCK,
    )
    .map_err(|_| failure.to_string())?;
    // SAFETY: openat returned a new owned descriptor and ownership is transferred once.
    let verification = unsafe { File::from_raw_fd(verification_fd) };
    let verification_metadata = verification.metadata().map_err(|_| failure.to_string())?;
    if !stable_metadata_equal(&after, &verification_metadata) {
        return Err(failure.to_string());
    }
    Ok((bytes, after))
}

#[cfg(not(unix))]
fn read_bounded_regular_file(
    _parent: &File,
    _name: &str,
    _maximum: u64,
    _failure: &str,
) -> Result<(Vec<u8>, Metadata), String> {
    Err("build-recipe-inspection-unsupported".to_string())
}

#[cfg(unix)]
fn openat(directory_fd: std::os::fd::RawFd, name: &str, flags: i32) -> io::Result<i32> {
    use std::ffi::CString;
    let name = CString::new(name).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    // SAFETY: directory_fd is borrowed, name is NUL-terminated, and no creation flag is used.
    let fd = unsafe {
        libc::openat(
            directory_fd,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | flags,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(fd)
    }
}

#[cfg(unix)]
fn identity(_path: &Path, metadata: &Metadata) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;
    FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(not(unix))]
fn identity(path: &Path, metadata: &Metadata) -> FileIdentity {
    FileIdentity {
        canonical_path: path.to_path_buf(),
        length: metadata.len(),
        modified: metadata.modified().ok(),
    }
}

#[cfg(unix)]
fn stable_metadata_equal(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.mode() == right.mode()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn stable_metadata_equal(left: &Metadata, right: &Metadata) -> bool {
    left.file_type() == right.file_type()
        && left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
}
