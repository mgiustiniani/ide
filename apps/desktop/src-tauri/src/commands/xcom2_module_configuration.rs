use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::de::{IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::workspace::workspace_root;

const CONFIGURATION_DIRECTORY: &str = ".ide";
const CONFIGURATION_FILE: &str = "xcom2.json";
const MAXIMUM_FILE_BYTES: usize = 64 * 1024;
const MAXIMUM_MODULE_ROOTS: usize = 64;
const MAXIMUM_MODULE_ROOT_BYTES: usize = 4096;
const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_CORRELATION_ID_BYTES: usize = 256;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Xcom2ModuleConfigurationReadRequest {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub activation_generation: u64,
    pub configuration_read_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Xcom2ModuleConfigurationReadResult {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub activation_generation: u64,
    pub configuration_read_id: String,
    #[serde(flatten)]
    pub outcome: Xcom2ModuleConfigurationReadOutcome,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Xcom2ModuleConfigurationReadOutcome {
    Absent,
    Ready {
        configuration: Xcom2ModuleConfiguration,
    },
    Stopped {
        code: Xcom2ModuleConfigurationStopCode,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Xcom2ModuleConfiguration {
    pub version: u8,
    pub target: String,
    pub module_roots: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Xcom2ModuleConfigurationStopCode {
    ConfigurationUnreadable,
    ConfigurationTooLarge,
    ConfigurationInvalidUtf8,
    ConfigurationInvalidJson,
    ConfigurationInvalidSchema,
    ConfigurationUnsupportedVersion,
    ConfigurationUnsupportedTarget,
    ConfigurationInvalidModuleRoots,
}

impl Xcom2ModuleConfigurationReadResult {
    fn new(
        request: &Xcom2ModuleConfigurationReadRequest,
        outcome: Xcom2ModuleConfigurationReadOutcome,
    ) -> Self {
        Self {
            workspace_id: request.workspace_id.clone(),
            workspace_generation: request.workspace_generation,
            activation_generation: request.activation_generation,
            configuration_read_id: request.configuration_read_id.clone(),
            outcome,
        }
    }

    fn absent(request: &Xcom2ModuleConfigurationReadRequest) -> Self {
        Self::new(request, Xcom2ModuleConfigurationReadOutcome::Absent)
    }

    fn ready(
        request: &Xcom2ModuleConfigurationReadRequest,
        configuration: Xcom2ModuleConfiguration,
    ) -> Self {
        Self::new(
            request,
            Xcom2ModuleConfigurationReadOutcome::Ready { configuration },
        )
    }

    fn stopped(
        request: &Xcom2ModuleConfigurationReadRequest,
        code: Xcom2ModuleConfigurationStopCode,
    ) -> Self {
        Self::new(
            request,
            Xcom2ModuleConfigurationReadOutcome::Stopped { code },
        )
    }
}

/// Reads only the fixed configuration below the process's current native workspace authority.
/// Configuration failures are returned as the approved presentation-safe stopped union; only an
/// invalid request rejects the command.
#[tauri::command]
pub fn read_xcom2_module_configuration(
    request: Xcom2ModuleConfigurationReadRequest,
) -> Result<Xcom2ModuleConfigurationReadResult, String> {
    validate_request(&request)?;
    let Ok(root) = workspace_root() else {
        return Ok(Xcom2ModuleConfigurationReadResult::stopped(
            &request,
            Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable,
        ));
    };
    Ok(read_configuration_at(&root, &request))
}

fn validate_request(request: &Xcom2ModuleConfigurationReadRequest) -> Result<(), String> {
    if !valid_correlation_id(&request.workspace_id)
        || !valid_correlation_id(&request.configuration_read_id)
    {
        return Err("Invalid XCOM 2 module configuration correlation ID".to_string());
    }
    if !valid_generation(request.workspace_generation)
        || !valid_generation(request.activation_generation)
    {
        return Err("Invalid XCOM 2 module configuration generation".to_string());
    }
    Ok(())
}

fn valid_correlation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CORRELATION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}

fn valid_generation(value: u64) -> bool {
    value > 0 && value <= JS_MAX_SAFE_INTEGER
}

fn read_configuration_at(
    root: &Path,
    request: &Xcom2ModuleConfigurationReadRequest,
) -> Xcom2ModuleConfigurationReadResult {
    read_configuration_at_with_hook(root, request, || {})
}

fn read_configuration_at_with_hook<F>(
    root: &Path,
    request: &Xcom2ModuleConfigurationReadRequest,
    after_open: F,
) -> Xcom2ModuleConfigurationReadResult
where
    F: FnOnce(),
{
    let canonical_root = match root.canonicalize() {
        Ok(root) => root,
        Err(_) => {
            return Xcom2ModuleConfigurationReadResult::stopped(
                request,
                Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable,
            )
        }
    };
    let root_metadata = match fs::symlink_metadata(&canonical_root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => metadata,
        _ => {
            return Xcom2ModuleConfigurationReadResult::stopped(
                request,
                Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable,
            )
        }
    };

    let loaded = read_fixed_configuration_file(&canonical_root, &root_metadata, after_open);
    let bytes = match loaded {
        FixedFileRead::Absent => return Xcom2ModuleConfigurationReadResult::absent(request),
        FixedFileRead::Stopped(code) => {
            return Xcom2ModuleConfigurationReadResult::stopped(request, code)
        }
        FixedFileRead::Bytes(bytes) => bytes,
    };

    if bytes.len() > MAXIMUM_FILE_BYTES {
        return Xcom2ModuleConfigurationReadResult::stopped(
            request,
            Xcom2ModuleConfigurationStopCode::ConfigurationTooLarge,
        );
    }
    if std::str::from_utf8(&bytes).is_err() {
        return Xcom2ModuleConfigurationReadResult::stopped(
            request,
            Xcom2ModuleConfigurationStopCode::ConfigurationInvalidUtf8,
        );
    }

    match parse_configuration(&bytes, &canonical_root) {
        Ok(configuration) => Xcom2ModuleConfigurationReadResult::ready(request, configuration),
        Err(code) => Xcom2ModuleConfigurationReadResult::stopped(request, code),
    }
}

enum FixedFileRead {
    Absent,
    Bytes(Vec<u8>),
    Stopped(Xcom2ModuleConfigurationStopCode),
}

#[cfg(unix)]
fn read_fixed_configuration_file<F>(
    root: &Path,
    root_path_metadata: &Metadata,
    after_open: F,
) -> FixedFileRead
where
    F: FnOnce(),
{
    use std::os::fd::{AsRawFd, FromRawFd};

    let root_file = match File::open(root) {
        Ok(file) => file,
        Err(_) => return unreadable(),
    };
    let root_open_metadata = match root_file.metadata() {
        Ok(metadata)
            if metadata.is_dir() && stable_metadata_equal(root_path_metadata, &metadata) =>
        {
            metadata
        }
        _ => return unreadable(),
    };

    let ide_fd = openat_read_only(
        root_file.as_raw_fd(),
        CONFIGURATION_DIRECTORY,
        libc::O_DIRECTORY | libc::O_NOFOLLOW,
    );
    let ide_file = match ide_fd {
        Ok(fd) => {
            // SAFETY: openat returned a new owned file descriptor, transferred exactly once.
            unsafe { File::from_raw_fd(fd) }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return FixedFileRead::Absent,
        Err(_) => return unreadable(),
    };
    let ide_metadata = match ide_file.metadata() {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => metadata,
        _ => return unreadable(),
    };
    let ide_path = root.join(CONFIGURATION_DIRECTORY);
    if !path_matches_open_file(&ide_path, &ide_metadata, true) {
        return unreadable();
    }

    let configuration_fd = openat_read_only(
        ide_file.as_raw_fd(),
        CONFIGURATION_FILE,
        libc::O_NOFOLLOW | libc::O_NONBLOCK,
    );
    let mut configuration_file = match configuration_fd {
        Ok(fd) => {
            // SAFETY: openat returned a new owned file descriptor, transferred exactly once.
            unsafe { File::from_raw_fd(fd) }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return if path_matches_open_file(&ide_path, &ide_metadata, true) {
                FixedFileRead::Absent
            } else {
                unreadable()
            }
        }
        Err(_) => return unreadable(),
    };
    let opened_metadata = match configuration_file.metadata() {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
        _ => return unreadable(),
    };
    let configuration_path = ide_path.join(CONFIGURATION_FILE);
    if !path_matches_open_file(&configuration_path, &opened_metadata, false) {
        return unreadable();
    }

    after_open();

    let mut bytes =
        Vec::with_capacity(opened_metadata.len().min((MAXIMUM_FILE_BYTES + 1) as u64) as usize);
    if configuration_file
        .by_ref()
        .take((MAXIMUM_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return unreadable();
    }

    let final_configuration_metadata = match configuration_file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return unreadable(),
    };
    let final_ide_metadata = match ide_file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return unreadable(),
    };
    let final_root_metadata = match root_file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return unreadable(),
    };
    if !stable_metadata_equal(&opened_metadata, &final_configuration_metadata)
        || !path_matches_open_file(&configuration_path, &final_configuration_metadata, false)
        || !stable_metadata_equal(&ide_metadata, &final_ide_metadata)
        || !path_matches_open_file(&ide_path, &final_ide_metadata, true)
        || !stable_metadata_equal(&root_open_metadata, &final_root_metadata)
        || !path_matches_open_file(root, &final_root_metadata, true)
    {
        return unreadable();
    }

    FixedFileRead::Bytes(bytes)
}

#[cfg(unix)]
fn openat_read_only(directory_fd: std::os::fd::RawFd, name: &str, flags: i32) -> io::Result<i32> {
    use std::ffi::CString;

    let name = CString::new(name).expect("fixed configuration component contains no NUL");
    // SAFETY: directory_fd is borrowed for the call, name is NUL-terminated, and no mode argument
    // is required because the flags never create a file.
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

#[cfg(not(unix))]
fn read_fixed_configuration_file<F>(
    root: &Path,
    root_path_metadata: &Metadata,
    after_open: F,
) -> FixedFileRead
where
    F: FnOnce(),
{
    let ide_path = root.join(CONFIGURATION_DIRECTORY);
    let ide_metadata = match fs::symlink_metadata(&ide_path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return FixedFileRead::Absent,
        _ => return unreadable(),
    };
    let configuration_path = ide_path.join(CONFIGURATION_FILE);
    let path_metadata = match fs::symlink_metadata(&configuration_path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return FixedFileRead::Absent,
        _ => return unreadable(),
    };
    let mut file = match File::open(&configuration_path) {
        Ok(file) => file,
        Err(_) => return unreadable(),
    };
    let opened_metadata = match file.metadata() {
        Ok(metadata) if stable_metadata_equal(&path_metadata, &metadata) => metadata,
        _ => return unreadable(),
    };

    after_open();

    let mut bytes = Vec::new();
    if file
        .by_ref()
        .take((MAXIMUM_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return unreadable();
    }
    let final_metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(_) => return unreadable(),
    };
    if !stable_metadata_equal(&opened_metadata, &final_metadata)
        || !path_matches_open_file(&configuration_path, &final_metadata, false)
        || !path_matches_open_file(&ide_path, &ide_metadata, true)
        || !path_matches_open_file(root, root_path_metadata, true)
    {
        return unreadable();
    }
    FixedFileRead::Bytes(bytes)
}

fn unreadable() -> FixedFileRead {
    FixedFileRead::Stopped(Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable)
}

fn path_matches_open_file(path: &Path, opened: &Metadata, directory: bool) -> bool {
    let Ok(path_metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if path_metadata.file_type().is_symlink()
        || (directory && !path_metadata.is_dir())
        || (!directory && !path_metadata.is_file())
    {
        return false;
    }
    stable_metadata_equal(&path_metadata, opened)
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

enum RootJson {
    Object {
        fields: BTreeMap<String, Value>,
        duplicate_key: bool,
    },
    Other,
}

struct RootJsonVisitor;

impl<'de> Visitor<'de> for RootJsonVisitor {
    type Value = RootJson;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
    where
        M: MapAccess<'de>,
    {
        let mut fields = BTreeMap::new();
        let mut duplicate_key = false;
        while let Some(key) = map.next_key::<String>()? {
            let value = map.next_value::<Value>()?;
            if fields.insert(key, value).is_some() {
                duplicate_key = true;
            }
        }
        Ok(RootJson::Object {
            fields,
            duplicate_key,
        })
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while sequence.next_element::<IgnoredAny>()?.is_some() {}
        Ok(RootJson::Other)
    }

    fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_string<E>(self, _value: String) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(RootJson::Other)
    }
}

fn parse_configuration(
    bytes: &[u8],
    canonical_root: &Path,
) -> Result<Xcom2ModuleConfiguration, Xcom2ModuleConfigurationStopCode> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let root = serde::de::Deserializer::deserialize_any(&mut deserializer, RootJsonVisitor)
        .map_err(|_| Xcom2ModuleConfigurationStopCode::ConfigurationInvalidJson)?;
    deserializer
        .end()
        .map_err(|_| Xcom2ModuleConfigurationStopCode::ConfigurationInvalidJson)?;

    let RootJson::Object {
        mut fields,
        duplicate_key,
    } = root
    else {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema);
    };
    if duplicate_key
        || fields.len() != 3
        || !fields.contains_key("version")
        || !fields.contains_key("target")
        || !fields.contains_key("moduleRoots")
    {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema);
    }

    let version = fields.remove("version").expect("checked exact field");
    if !version.is_i64() && !version.is_u64() {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema);
    }
    if version.as_u64() != Some(1) {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationUnsupportedVersion);
    }

    let target = fields.remove("target").expect("checked exact field");
    let Some(target) = target.as_str() else {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema);
    };
    if target != "wotc" {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationUnsupportedTarget);
    }

    let module_roots = fields.remove("moduleRoots").expect("checked exact field");
    let Some(module_roots) = module_roots.as_array() else {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema);
    };
    if module_roots.is_empty() || module_roots.len() > MAXIMUM_MODULE_ROOTS {
        return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots);
    }

    let mut roots = Vec::with_capacity(module_roots.len());
    let mut unique = BTreeSet::new();
    for root in module_roots {
        let Some(root) = root.as_str() else {
            return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots);
        };
        if !portable_module_root(root)
            || !unique.insert(root.to_string())
            || !existing_contained_directory(canonical_root, root)
        {
            return Err(Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots);
        }
        roots.push(root.to_string());
    }
    roots.sort();

    Ok(Xcom2ModuleConfiguration {
        version: 1,
        target: "wotc".to_string(),
        module_roots: roots,
    })
}

fn portable_module_root(root: &str) -> bool {
    if root.is_empty()
        || root.len() > MAXIMUM_MODULE_ROOT_BYTES
        || root.starts_with('/')
        || root.contains('\\')
        || root.chars().any(|character| character.is_control())
        || has_windows_drive_prefix(root)
    {
        return false;
    }
    if root == "." {
        return true;
    }
    root.split('/')
        .all(|component| !component.is_empty() && component != "." && component != "..")
}

fn has_windows_drive_prefix(root: &str) -> bool {
    let bytes = root.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn existing_contained_directory(canonical_root: &Path, root: &str) -> bool {
    if root == "." {
        return fs::symlink_metadata(canonical_root)
            .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink());
    }

    let mut candidate = PathBuf::from(canonical_root);
    for component in root.split('/') {
        candidate.push(component);
        let Ok(first_metadata) = fs::symlink_metadata(&candidate) else {
            return false;
        };
        if first_metadata.file_type().is_symlink() || !first_metadata.is_dir() {
            return false;
        }
        let Ok(canonical) = candidate.canonicalize() else {
            return false;
        };
        if canonical != candidate || !canonical.starts_with(canonical_root) {
            return false;
        }
        let Ok(second_metadata) = fs::symlink_metadata(&candidate) else {
            return false;
        };
        if !second_metadata.is_dir()
            || second_metadata.file_type().is_symlink()
            || !stable_metadata_equal(&first_metadata, &second_metadata)
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestWorkspace(PathBuf);

    impl TestWorkspace {
        fn new(label: &str) -> Self {
            static NEXT_ID: AtomicU64 = AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "ide-xcom2-module-configuration-{label}-{nonce}-{}",
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join(CONFIGURATION_DIRECTORY)).expect("create test workspace");
            Self(path.canonicalize().expect("canonical test workspace"))
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn directory(&self, relative: &str) {
            fs::create_dir_all(self.0.join(relative)).expect("create test directory");
        }

        fn write_configuration(&self, bytes: impl AsRef<[u8]>) {
            fs::write(
                self.0
                    .join(CONFIGURATION_DIRECTORY)
                    .join(CONFIGURATION_FILE),
                bytes,
            )
            .expect("write test configuration");
        }

        fn configuration_path(&self) -> PathBuf {
            self.0
                .join(CONFIGURATION_DIRECTORY)
                .join(CONFIGURATION_FILE)
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn request() -> Xcom2ModuleConfigurationReadRequest {
        Xcom2ModuleConfigurationReadRequest {
            workspace_id: "workspace:authorized".to_string(),
            workspace_generation: 7,
            activation_generation: 11,
            configuration_read_id: "xcom2-configuration-read:11".to_string(),
        }
    }

    fn read(workspace: &TestWorkspace) -> Xcom2ModuleConfigurationReadResult {
        read_configuration_at(workspace.path(), &request())
    }

    fn code(result: &Xcom2ModuleConfigurationReadResult) -> Xcom2ModuleConfigurationStopCode {
        match result.outcome {
            Xcom2ModuleConfigurationReadOutcome::Stopped { code } => code,
            _ => panic!("expected stopped result, got {:?}", result.outcome),
        }
    }

    fn configuration(result: Xcom2ModuleConfigurationReadResult) -> Xcom2ModuleConfiguration {
        match result.outcome {
            Xcom2ModuleConfigurationReadOutcome::Ready { configuration } => configuration,
            outcome => panic!("expected ready result, got {outcome:?}"),
        }
    }

    fn valid_json(roots: &[String]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "target": "wotc",
            "moduleRoots": roots,
        }))
        .expect("serialize fixture")
    }

    #[test]
    fn request_and_result_use_the_exact_correlated_adapter_schema() {
        let exact = serde_json::json!({
            "workspaceId": "workspace:authorized",
            "workspaceGeneration": 7,
            "activationGeneration": 11,
            "configurationReadId": "xcom2-configuration-read:11",
        });
        assert_eq!(
            serde_json::from_value::<Xcom2ModuleConfigurationReadRequest>(exact.clone())
                .expect("exact request"),
            request()
        );
        let mut extra = exact;
        extra["root"] = Value::String("/caller/root".to_string());
        assert!(serde_json::from_value::<Xcom2ModuleConfigurationReadRequest>(extra).is_err());

        let workspace = TestWorkspace::new("correlation");
        let result = read(&workspace);
        assert_eq!(result.workspace_id, request().workspace_id);
        assert_eq!(result.workspace_generation, 7);
        assert_eq!(result.activation_generation, 11);
        assert_eq!(
            result.configuration_read_id,
            request().configuration_read_id
        );
        assert_eq!(
            serde_json::to_value(result).expect("serialize result"),
            serde_json::json!({
                "workspaceId": "workspace:authorized",
                "workspaceGeneration": 7,
                "activationGeneration": 11,
                "configurationReadId": "xcom2-configuration-read:11",
                "kind": "absent",
            })
        );
    }

    #[test]
    fn invalid_request_correlation_and_generations_are_rejected_safely() {
        for mutate in [
            |value: &mut Xcom2ModuleConfigurationReadRequest| value.workspace_id.clear(),
            |value: &mut Xcom2ModuleConfigurationReadRequest| {
                value.configuration_read_id = "../read".to_string()
            },
            |value: &mut Xcom2ModuleConfigurationReadRequest| value.workspace_generation = 0,
            |value: &mut Xcom2ModuleConfigurationReadRequest| {
                value.activation_generation = JS_MAX_SAFE_INTEGER + 1
            },
        ] {
            let mut candidate = request();
            mutate(&mut candidate);
            assert!(validate_request(&candidate).is_err());
        }
    }

    #[test]
    fn missing_configuration_and_missing_ide_directory_are_absent() {
        let workspace = TestWorkspace::new("absent");
        assert_eq!(
            read(&workspace).outcome,
            Xcom2ModuleConfigurationReadOutcome::Absent
        );
        fs::remove_dir(workspace.path().join(CONFIGURATION_DIRECTORY)).expect("remove ide");
        assert_eq!(
            read(&workspace).outcome,
            Xcom2ModuleConfigurationReadOutcome::Absent
        );
    }

    #[test]
    fn valid_configuration_is_returned_and_roots_are_sorted_lexically() {
        let workspace = TestWorkspace::new("valid-sorted");
        for root in ["mods/zeta", "mods/outer/nested", "mods/outer", "mods/alpha"] {
            workspace.directory(root);
        }
        workspace.write_configuration(valid_json(&[
            "mods/zeta".to_string(),
            "mods/outer/nested".to_string(),
            ".".to_string(),
            "mods/outer".to_string(),
            "mods/alpha".to_string(),
        ]));

        assert_eq!(
            configuration(read(&workspace)),
            Xcom2ModuleConfiguration {
                version: 1,
                target: "wotc".to_string(),
                module_roots: vec![
                    ".".to_string(),
                    "mods/alpha".to_string(),
                    "mods/outer".to_string(),
                    "mods/outer/nested".to_string(),
                    "mods/zeta".to_string(),
                ],
            }
        );
    }

    #[test]
    fn inclusive_sixty_four_root_boundary_is_ready() {
        let workspace = TestWorkspace::new("sixty-four");
        let roots = (0..64)
            .map(|index| format!("mods/root-{index:02}"))
            .collect::<Vec<_>>();
        for root in &roots {
            workspace.directory(root);
        }
        let mut reversed = roots.clone();
        reversed.reverse();
        workspace.write_configuration(valid_json(&reversed));

        assert_eq!(configuration(read(&workspace)).module_roots, roots);
    }

    #[test]
    fn file_size_is_bounded_by_reading_at_most_sixty_four_kib_plus_one() {
        let workspace = TestWorkspace::new("size");
        workspace.directory("mods/root");
        let mut exact = br#"{"version":1,"target":"wotc","moduleRoots":["mods/root"]}"#.to_vec();
        exact.resize(MAXIMUM_FILE_BYTES, b' ');
        workspace.write_configuration(&exact);
        assert!(matches!(
            read(&workspace).outcome,
            Xcom2ModuleConfigurationReadOutcome::Ready { .. }
        ));

        exact.push(b' ');
        workspace.write_configuration(&exact);
        assert_eq!(
            code(&read(&workspace)),
            Xcom2ModuleConfigurationStopCode::ConfigurationTooLarge
        );
    }

    #[test]
    fn invalid_utf8_is_stopped_without_exposing_bytes() {
        let workspace = TestWorkspace::new("utf8");
        workspace.write_configuration([0xff, 0xfe]);
        let result = read(&workspace);
        assert_eq!(
            code(&result),
            Xcom2ModuleConfigurationStopCode::ConfigurationInvalidUtf8
        );
        let serialized = serde_json::to_string(&result).expect("serialize stopped result");
        assert!(!serialized.contains("path"));
        assert!(!serialized.contains("content"));
        assert!(!serialized.contains("255"));
    }

    #[test]
    fn malformed_comments_and_trailing_data_are_invalid_json() {
        let workspace = TestWorkspace::new("invalid-json");
        for bytes in [
            br#"{"version":1"#.as_slice(),
            br#"{/*comment*/"version":1,"target":"wotc","moduleRoots":["."]}"#,
            br#"{"version":1,"target":"wotc","moduleRoots":["."]} true"#,
        ] {
            workspace.write_configuration(bytes);
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidJson
            );
        }
    }

    #[test]
    fn duplicate_unknown_and_missing_top_level_keys_are_invalid_schema() {
        let workspace = TestWorkspace::new("invalid-fields");
        for bytes in [
            br#"{"version":1,"version":1,"target":"wotc","moduleRoots":["."]}"#.as_slice(),
            br#"{"version":1,"target":"wotc","moduleRoots":["."],"sdk":"no"}"#,
            br#"{"version":1,"target":"wotc"}"#,
        ] {
            workspace.write_configuration(bytes);
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema
            );
        }
    }

    #[test]
    fn top_level_and_field_types_are_not_coerced() {
        let workspace = TestWorkspace::new("types");
        for bytes in [
            br#"[]"#.as_slice(),
            br#"{"version":"1","target":"wotc","moduleRoots":["."]}"#,
            br#"{"version":1.0,"target":"wotc","moduleRoots":["."]}"#,
            br#"{"version":1,"target":2,"moduleRoots":["."]}"#,
            br#"{"version":1,"target":"wotc","moduleRoots":"."}"#,
        ] {
            workspace.write_configuration(bytes);
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidSchema
            );
        }

        workspace.write_configuration(br#"{"version":1,"target":"wotc","moduleRoots":[1]}"#);
        assert_eq!(
            code(&read(&workspace)),
            Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots
        );
    }

    #[test]
    fn unsupported_version_and_target_have_only_the_approved_codes() {
        let workspace = TestWorkspace::new("unsupported");
        workspace.write_configuration(br#"{"version":2,"target":"wotc","moduleRoots":["."]}"#);
        assert_eq!(
            code(&read(&workspace)),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnsupportedVersion
        );
        workspace.write_configuration(br#"{"version":1,"target":"WOTC","moduleRoots":["."]}"#);
        assert_eq!(
            code(&read(&workspace)),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnsupportedTarget
        );
    }

    #[test]
    fn root_count_duplicates_and_non_portable_paths_are_invalid_atomically() {
        let workspace = TestWorkspace::new("invalid-roots");
        let over_limit = (0..65)
            .map(|index| format!("root-{index}"))
            .collect::<Vec<_>>();
        let cases = vec![
            Vec::<String>::new(),
            vec![".".to_string(), ".".to_string()],
            over_limit,
            vec!["".to_string()],
            vec!["/absolute".to_string()],
            vec!["C:/drive".to_string()],
            vec!["mods\\root".to_string()],
            vec!["mods//root".to_string()],
            vec!["mods/./root".to_string()],
            vec!["mods/../root".to_string()],
            vec!["mods/\u{7f}root".to_string()],
            vec!["é".repeat(MAXIMUM_MODULE_ROOT_BYTES + 1)],
        ];
        for roots in cases {
            workspace.write_configuration(valid_json(&roots));
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots
            );
        }
    }

    #[test]
    fn roots_must_be_existing_regular_exact_case_directories() {
        let workspace = TestWorkspace::new("filesystem-roots");
        workspace.directory("mods/Exact");
        fs::write(workspace.path().join("mods/file"), b"not a directory").expect("write file");

        for root in ["mods/missing", "mods/file"] {
            workspace.write_configuration(valid_json(&[root.to_string()]));
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots
            );
        }

        #[cfg(target_os = "linux")]
        {
            workspace.write_configuration(valid_json(&["mods/exact".to_string()]));
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn internal_and_outside_module_root_symlinks_are_rejected() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new("root-symlinks");
        workspace.directory("mods/real");
        let outside = TestWorkspace::new("outside-root");
        outside.directory("external");
        symlink("real", workspace.path().join("mods/internal-link")).expect("internal symlink");
        symlink(
            outside.path().join("external"),
            workspace.path().join("mods/outside-link"),
        )
        .expect("outside symlink");

        for root in ["mods/internal-link", "mods/outside-link"] {
            workspace.write_configuration(valid_json(&[root.to_string()]));
            assert_eq!(
                code(&read(&workspace)),
                Xcom2ModuleConfigurationStopCode::ConfigurationInvalidModuleRoots
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_configuration_and_symlink_ide_directory_are_unreadable() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new("configuration-symlink");
        let outside = TestWorkspace::new("configuration-target");
        outside.write_configuration(br#"{"version":1,"target":"wotc","moduleRoots":["."]}"#);
        symlink(outside.configuration_path(), workspace.configuration_path())
            .expect("configuration symlink");
        assert_eq!(
            code(&read(&workspace)),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable
        );

        fs::remove_file(workspace.configuration_path()).expect("remove configuration symlink");
        fs::remove_dir(workspace.path().join(CONFIGURATION_DIRECTORY)).expect("remove ide");
        symlink(
            outside.path().join(CONFIGURATION_DIRECTORY),
            workspace.path().join(CONFIGURATION_DIRECTORY),
        )
        .expect("ide symlink");
        assert_eq!(
            code(&read(&workspace)),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable
        );
    }

    #[test]
    fn configuration_and_ide_wrong_entry_types_are_unreadable() {
        let configuration_type = TestWorkspace::new("configuration-type");
        fs::create_dir(configuration_type.configuration_path()).expect("configuration directory");
        assert_eq!(
            code(&read(&configuration_type)),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable
        );

        let ide_type = TestWorkspace::new("ide-type");
        fs::remove_dir(ide_type.path().join(CONFIGURATION_DIRECTORY)).expect("remove ide");
        fs::write(ide_type.path().join(CONFIGURATION_DIRECTORY), b"file").expect("write ide file");
        assert_eq!(
            code(&read(&ide_type)),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable
        );
    }

    #[test]
    fn reading_is_byte_and_tree_read_only_and_never_reads_module_content() {
        let workspace = TestWorkspace::new("read-only");
        workspace.directory("mods/root");
        fs::write(
            workspace.path().join("mods/root/proprietary.bin"),
            b"module bytes must never be read or changed",
        )
        .expect("write module fixture");
        workspace
            .write_configuration(br#"{"version":1,"target":"wotc","moduleRoots":["mods/root"]}"#);
        let before = tree_snapshot(workspace.path());

        assert!(matches!(
            read(&workspace).outcome,
            Xcom2ModuleConfigurationReadOutcome::Ready { .. }
        ));

        assert_eq!(tree_snapshot(workspace.path()), before);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_replacement_after_no_follow_open_is_rejected_by_stable_identity() {
        let workspace = TestWorkspace::new("stable-identity");
        workspace.write_configuration(br#"{"version":1,"target":"wotc","moduleRoots":["."]}"#);
        let path = workspace.configuration_path();
        let displaced = path.with_extension("displaced");

        let result = read_configuration_at_with_hook(workspace.path(), &request(), || {
            fs::rename(&path, &displaced).expect("displace opened configuration");
            fs::write(
                &path,
                br#"{"version":1,"target":"wotc","moduleRoots":["."]}"#,
            )
            .expect("replace configuration");
        });

        assert_eq!(
            code(&result),
            Xcom2ModuleConfigurationStopCode::ConfigurationUnreadable
        );
    }

    fn tree_snapshot(root: &Path) -> BTreeMap<String, (String, Vec<u8>)> {
        fn visit(root: &Path, directory: &Path, result: &mut BTreeMap<String, (String, Vec<u8>)>) {
            let mut entries = fs::read_dir(directory)
                .expect("read snapshot directory")
                .collect::<Result<Vec<_>, _>>()
                .expect("read snapshot entries");
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let path = entry.path();
                let relative = path
                    .strip_prefix(root)
                    .expect("relative snapshot path")
                    .to_string_lossy()
                    .replace('\\', "/");
                let metadata = fs::symlink_metadata(&path).expect("snapshot metadata");
                if metadata.is_dir() {
                    result.insert(relative, ("directory".to_string(), Vec::new()));
                    visit(root, &path, result);
                } else if metadata.is_file() {
                    result.insert(
                        relative,
                        ("file".to_string(), fs::read(&path).expect("snapshot bytes")),
                    );
                }
            }
        }

        let mut result = BTreeMap::new();
        visit(root, root, &mut result);
        result
    }
}
