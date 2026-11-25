//! Correlate Gradle's public MethodSource with fresh JUnit report cases.
use super::{launch_settings::LaunchFile, main_class};
use base64::Engine;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const LIMIT: usize = 10_000;
const BYTE_LIMIT: usize = 2 * 1024 * 1024;

pub(super) struct Artifact {
    pub source: LaunchFile,
    output: PathBuf,
    inspector: LaunchFile,
    identity: String,
}
impl Artifact {
    pub fn create() -> Result<Self, String> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Cannot identify test method metadata.")?;
        let identity: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let inspector = LaunchFile::create(
            "IdeTestMethodInspector.java",
            include_bytes!("IdeTestMethodInspector.java"),
        )?;
        let source = LaunchFile::create("test-methods.init.gradle", b"")?;
        let output = source.path.with_file_name("test-methods.jsonl");
        let artifact = Self {
            source,
            output,
            inspector,
            identity,
        };
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&artifact.output)
            .map_err(|_| "Cannot allocate private test method metadata.")?;
        let data = serde_json::to_vec(&serde_json::json!({
            "requestId":artifact.identity,"output":artifact.output,"inspectorSource":artifact.inspector.path
        })).map_err(|_| "Cannot encode test method settings.")?;
        let script = include_str!("GradleTestMethods.gradle").replace(
            "IDE_TEST_METHOD_SETTINGS",
            &base64::engine::general_purpose::STANDARD.encode(data),
        );
        fs::write(&artifact.source.path, script)
            .map_err(|_| "Cannot write test method settings.")?;
        Ok(artifact)
    }
    pub fn read(&self, workspace: &Path) -> Result<MethodIndex, String> {
        let before = fs::symlink_metadata(&self.output)
            .map_err(|_| "Test method metadata is unavailable.")?;
        if !before.is_file() || before.len() > BYTE_LIMIT as u64 {
            return Err("Test method metadata is not a bounded regular file.".into());
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
            if before.nlink() != 1 {
                return Err("Linked test method metadata is refused.".into());
            }
        }
        let mut file = options
            .open(&self.output)
            .map_err(|_| "Cannot read test method metadata.")?;
        let opened = file
            .metadata()
            .map_err(|_| "Cannot inspect test method metadata.")?;
        if !same_file(&before, &opened) {
            return Err("Test method metadata changed while opening.".into());
        }
        let mut bytes = Vec::new();
        file.by_ref()
            .take(BYTE_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read test method metadata.")?;
        let after = file
            .metadata()
            .map_err(|_| "Cannot inspect test method metadata.")?;
        let path_after =
            fs::symlink_metadata(&self.output).map_err(|_| "Test method metadata disappeared.")?;
        if !same_file(&opened, &after) || !same_file(&after, &path_after) {
            return Err("Test method metadata changed while reading.".into());
        }
        parse(&bytes, &self.identity, workspace)
    }
}
impl Drop for Artifact {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.output);
        if let Some(directory) = self.inspector.path.parent() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}
fn same_file(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    let mut same = left.is_file()
        && right.is_file()
        && left.len() == right.len()
        && left
            .modified()
            .ok()
            .zip(right.modified().ok())
            .is_some_and(|(a, b)| a == b);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        same &= left.dev() == right.dev()
            && left.ino() == right.ino()
            && left.nlink() == 1
            && right.nlink() == 1;
    }
    same
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Record {
    #[serde(rename_all = "camelCase")]
    Method {
        version: u32,
        request_id: String,
        report_directory: String,
        class_name: String,
        report_name: String,
        outcome: String,
        source_class_name: Option<String>,
        method_name: Option<String>,
        declaring_class_name: Option<String>,
        test_origin: Option<String>,
        declaring_origin: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Complete {
        version: u32,
        request_id: String,
        entries: usize,
        unavailable: bool,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Method {
    Known {
        source_class: String,
        name: String,
        declaring_class: Option<String>,
        test_origin: Option<super::test_results::ClassOrigin>,
        declaring_origin: Option<super::test_results::ClassOrigin>,
    },
    Unknown,
    Ambiguous,
}
pub(super) struct MethodIndex(BTreeMap<(PathBuf, String, String, String), Method>);
impl MethodIndex {
    pub fn lookup(&self, report: &Path, class: &str, name: &str, state: &str) -> Option<&Method> {
        let outcome = match state {
            "failed" | "error" => "failure",
            "passed" => "success",
            "skipped" => "skipped",
            _ => return None,
        };
        self.0.get(&(
            report.parent()?.canonicalize().ok()?,
            class.into(),
            name.into(),
            outcome.into(),
        ))
    }
}
fn parse(bytes: &[u8], identity: &str, workspace: &Path) -> Result<MethodIndex, String> {
    if bytes.len() > BYTE_LIMIT || !bytes.ends_with(b"\n") {
        return Err("Test method metadata is incomplete or oversized.".into());
    }
    let root = workspace
        .canonicalize()
        .map_err(|_| "Test workspace is unavailable.")?;
    let mut rows = 0;
    let mut complete = false;
    let mut methods = BTreeMap::new();
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        if complete {
            return Err("Test method metadata follows its completion marker.".into());
        }
        let record: Record =
            serde_json::from_slice(line).map_err(|_| "Invalid test method metadata.")?;
        match record {
            Record::Complete {
                version,
                request_id,
                entries,
                unavailable,
            } => {
                if version != 2 || request_id != identity || entries != rows || unavailable {
                    return Err("Test method metadata is stale or incomplete.".into());
                }
                complete = true;
            }
            Record::Method {
                version,
                request_id,
                report_directory,
                class_name,
                report_name,
                outcome,
                source_class_name,
                method_name,
                declaring_class_name,
                test_origin,
                declaring_origin,
            } => {
                rows += 1;
                if version != 2
                    || request_id != identity
                    || !matches!(outcome.as_str(), "failure" | "success" | "skipped")
                    || rows > LIMIT
                    || report_directory.len() > 4096
                    || report_directory.contains('\0')
                    || !Path::new(&report_directory).is_absolute()
                    || class_name.len() > 512
                    || !main_class(&class_name)
                    || report_name.is_empty()
                    || report_name.len() > 4096
                    || report_name.contains('\0')
                {
                    return Err("Invalid or oversized test method identity.".into());
                }
                let directory = Path::new(&report_directory)
                    .canonicalize()
                    .map_err(|_| "Test report directory is unavailable.")?;
                if !directory.starts_with(&root) || !directory.is_dir() {
                    return Err("Test method metadata points outside the workspace.".into());
                }
                if declaring_class_name
                    .as_ref()
                    .is_some_and(|name| name.len() > 512 || !main_class(name))
                {
                    return Err("Invalid declaring class identity.".into());
                }
                if declaring_origin.is_some() && declaring_class_name.is_none() {
                    return Err("Class origin requires its declaring class.".into());
                }
                let has_origin = test_origin.is_some() || declaring_origin.is_some();
                let test_origin = class_origin(test_origin, &root)?;
                let declaring_origin = class_origin(declaring_origin, &root)?;
                let method = match (source_class_name, method_name) {
                    (None, None) if declaring_class_name.is_none() && !has_origin => {
                        Method::Unknown
                    }
                    (Some(source_class), Some(name))
                        if source_class.len() <= 512
                            && main_class(&source_class)
                            && name.len() <= 512
                            && main_class(&name)
                            && !name.contains('.') =>
                    {
                        Method::Known {
                            source_class,
                            name,
                            declaring_class: declaring_class_name,
                            test_origin,
                            declaring_origin,
                        }
                    }
                    _ => return Err("Invalid method source identity.".into()),
                };
                let key = (directory, class_name, report_name, outcome);
                methods
                    .entry(key)
                    .and_modify(|current| {
                        if *current != method {
                            *current = Method::Ambiguous;
                        }
                    })
                    .or_insert(method);
            }
        }
    }
    if !complete {
        return Err("Test method metadata is incomplete.".into());
    }
    Ok(MethodIndex(methods))
}

// Code-source locations describe compiled inputs, not source ownership. Only
// workspace-contained paths may cross the native boundary; RefactorKit owns
// their eventual association with modules and source sets.
fn class_origin(
    value: Option<String>,
    root: &Path,
) -> Result<Option<super::test_results::ClassOrigin>, String> {
    let Some(value) = value else { return Ok(None) };
    if value.is_empty()
        || value.len() > 4096
        || value.contains('\0')
        || !Path::new(&value).is_absolute()
    {
        return Err("Invalid compiled class origin.".into());
    }
    let Ok(path) = Path::new(&value).canonicalize() else {
        return Ok(None);
    };
    let Ok(relative) = path.strip_prefix(root) else {
        return Ok(None);
    };
    let kind = if path.is_dir() {
        "directory"
    } else if path.is_file() {
        "archive"
    } else {
        return Ok(None);
    };
    let Some(path) = relative.to_str() else {
        return Ok(None);
    };
    let path = path.replace(std::path::MAIN_SEPARATOR, "/");
    if path.is_empty()
        || path.contains(['\\', ':'])
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Ok(None);
    }
    Ok(Some(super::test_results::ClassOrigin { path, kind }))
}

#[cfg(test)]
#[path = "gradle_test_methods_tests.rs"]
mod tests;
