//! Explicit JDI HotSwap of captured compiled bytes; this is not a source compiler or project model.
use super::{main_class, structured_debugger, Job, LaunchFile, SessionRequest, NEXT_SESSION};
use crate::workspace::resolve_existing_path_in_root;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{atomic::Ordering, Arc};

const FILE_LIMIT: u64 = 1024 * 1024;
const TOTAL_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone)]
enum ConstantPoolEntry {
    Utf8(Vec<u8>),
    Class(u16),
    Other,
}

struct ClassFileCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ClassFileCursor<'a> {
    fn read(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or("The selected compiled class is malformed.")?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or("The selected compiled class is malformed.")?;
        self.offset = end;
        Ok(bytes)
    }

    fn u1(&mut self) -> Result<u8, String> {
        Ok(self.read(1)?[0])
    }

    fn u2(&mut self) -> Result<u16, String> {
        Ok(u16::from_be_bytes(self.read(2)?.try_into().unwrap()))
    }

    fn u4(&mut self) -> Result<u32, String> {
        Ok(u32::from_be_bytes(self.read(4)?.try_into().unwrap()))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub trusted: bool,
    pub stop_id: Option<String>,
    pub classes: Vec<ClassFile>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClassFile {
    pub class_name: String,
    pub class_file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_sha256: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outcome {
    pub request_id: String,
    pub status: String,
    pub classes: Vec<String>,
    pub error: Option<String>,
}
pub(super) struct Pending {
    outcome: Outcome,
    _file: LaunchFile,
}
impl Request {
    pub(super) fn session(&self) -> SessionRequest {
        SessionRequest {
            workspace_id: self.workspace_id.clone(),
            generation: self.generation,
            session_id: self.session_id.clone(),
        }
    }
    fn validate(&self) -> Result<(), String> {
        let mut names = BTreeSet::new();
        let mut paths = BTreeSet::new();
        if !self.trusted {
            return Err("Confirm workspace trust before reloading compiled classes.".into());
        }
        if self.classes.is_empty()
            || self.classes.len() > 32
            || self
                .stop_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 128 || id.contains('\0'))
            || self.classes.iter().any(|item| {
                let path = &item.class_file;
                !main_class(&item.class_name)
                    || item.expected_sha256.as_ref().is_some_and(|hash| {
                        hash.len() != 64
                            || !hash
                                .bytes()
                                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    })
                    || item.class_name.len() > 512
                    || !names.insert(&item.class_name)
                    || !paths.insert(path)
                    || path.len() > 1024
                    || !path.ends_with(".class")
                    || path.contains(['\\', ':', '\0', '\n', '\r'])
                    || path
                        .split('/')
                        .any(|part| part.is_empty() || part == "." || part == "..")
            })
        {
            return Err(
                "Choose 1–32 distinct Java classes and workspace-relative compiled .class files."
                    .into(),
            );
        }
        Ok(())
    }
}
fn current(job: &Arc<Job>, request: &Request) -> Result<(), String> {
    let snapshot = job.read()?;
    let state = snapshot
        .debugger_state
        .as_ref()
        .ok_or("Wait for the JDI debugger to initialize.")?;
    if job.cancelled.load(Ordering::SeqCst)
        || !super::current_workspace_binding_is_current(&job.binding)
        || snapshot.workspace_id != request.workspace_id
        || snapshot.generation != request.generation
        || snapshot.session_id != request.session_id
        || !["debug", "attach"].contains(&snapshot.operation.as_str())
        || snapshot.state != "running"
        || job.request.configuration.debugger_mode != "jdi"
        || !state.can_reload_classes
        || state.status == structured_debugger::Status::Terminated
        || state.stop_id != request.stop_id
    {
        return Err("Class reload is unavailable or its debugger state is obsolete.".into());
    }
    Ok(())
}
pub(super) fn compiled(job: &Arc<Job>, file: &ClassFile) -> Result<Vec<u8>, String> {
    let root = &job.binding.canonical_root;
    let path = root.join(&file.class_file);
    let canonical = resolve_existing_path_in_root(root, &path)?;
    if canonical != path {
        return Err("Compiled classes must be regular files inside this workspace.".into());
    }
    let output_roots = job
        .debugger_class_output_roots
        .lock()
        .map_err(|_| "Debugger class-output state is unavailable.")?
        .clone();
    validate_runtime_output_binding(
        job.project_context.is_some(),
        output_roots.as_deref(),
        &canonical,
    )?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let opened = options
        .open(&path)
        .map_err(|_| "Cannot read the selected compiled class.")?;
    let metadata = opened
        .metadata()
        .map_err(|_| "Cannot inspect the selected compiled class.")?;
    if !metadata.is_file() || metadata.len() > FILE_LIMIT {
        return Err("A compiled class must be a regular file of at most 1 MiB.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("Linked compiled class files are unavailable for reload.".into());
        }
    }
    let mut bytes = Vec::new();
    opened
        .take(FILE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read the selected compiled class.")?;
    if bytes.len() as u64 > FILE_LIMIT
        || !bytes.starts_with(&[0xca, 0xfe, 0xba, 0xbe])
        || resolve_existing_path_in_root(root, &path)? != path
    {
        return Err(
            "The selected compiled class is invalid, changed path or exceeded its limit.".into(),
        );
    }
    validate_class_file_name(&bytes, &file.class_name)?;
    if file
        .expected_sha256
        .as_ref()
        .is_some_and(|hash| *hash != format!("{:x}", Sha256::digest(&bytes)))
    {
        return Err("The compiled class changed after review; build and review it again.".into());
    }
    Ok(bytes)
}

fn validate_runtime_output_binding(
    synchronized_project: bool,
    output_roots: Option<&[PathBuf]>,
    class_file: &Path,
) -> Result<(), String> {
    if !synchronized_project {
        return Ok(());
    }
    let output_roots = output_roots
        .filter(|roots| !roots.is_empty())
        .ok_or("The synchronized debugger runtime outputs are unavailable; restart the session.")?;
    if output_roots
        .iter()
        .any(|root| class_file != root && class_file.starts_with(root))
    {
        Ok(())
    } else {
        Err("Choose a compiled class beneath a workspace directory on this session's synchronized runtime classpath.".into())
    }
}

fn validate_class_file_name(bytes: &[u8], expected_name: &str) -> Result<(), String> {
    let declared_name = class_file_binary_name(bytes)?;
    if declared_name != expected_name {
        return Err(format!(
            "The selected .class file declares '{declared_name}', not '{expected_name}'."
        ));
    }
    Ok(())
}

fn class_file_binary_name(bytes: &[u8]) -> Result<String, String> {
    let mut cursor = ClassFileCursor { bytes, offset: 0 };
    if cursor.u4()? != 0xcafe_babe {
        return Err("The selected compiled class has an invalid header.".into());
    }
    cursor.u2()?;
    cursor.u2()?;
    let count = cursor.u2()? as usize;
    if count < 2 {
        return Err("The selected compiled class has an invalid constant pool.".into());
    }
    let mut pool = vec![None; count];
    let mut index = 1;
    while index < count {
        let tag = cursor.u1()?;
        let entry = match tag {
            1 => {
                let length = cursor.u2()? as usize;
                Some(ConstantPoolEntry::Utf8(cursor.read(length)?.to_vec()))
            }
            3 | 4 => {
                cursor.read(4)?;
                Some(ConstantPoolEntry::Other)
            }
            5 | 6 => {
                cursor.read(8)?;
                if index + 1 >= count {
                    return Err("The selected compiled class has an invalid constant pool.".into());
                }
                pool[index] = Some(ConstantPoolEntry::Other);
                index += 2;
                continue;
            }
            7 => Some(ConstantPoolEntry::Class(cursor.u2()?)),
            8 | 16 | 19 | 20 => {
                cursor.read(2)?;
                Some(ConstantPoolEntry::Other)
            }
            9 | 10 | 11 | 12 | 17 | 18 => {
                cursor.read(4)?;
                Some(ConstantPoolEntry::Other)
            }
            15 => {
                cursor.read(3)?;
                Some(ConstantPoolEntry::Other)
            }
            _ => {
                return Err("The selected compiled class uses an unsupported constant pool.".into())
            }
        };
        pool[index] = entry;
        index += 1;
    }
    cursor.u2()?;
    let this_class = cursor.u2()? as usize;
    cursor.u2()?;
    let name_index = match pool.get(this_class).and_then(Option::as_ref) {
        Some(ConstantPoolEntry::Class(name_index)) => *name_index as usize,
        _ => return Err("The selected compiled class has an invalid type name.".into()),
    };
    let internal_name = match pool.get(name_index).and_then(Option::as_ref) {
        Some(ConstantPoolEntry::Utf8(name)) => {
            if name.iter().any(|byte| *byte == 0 || *byte >= 0xf0) {
                return Err(
                    "The selected compiled class has an invalid modified UTF-8 name.".into(),
                );
            }
            cesu8::from_java_cesu8(name)
                .map_err(|_| "The selected compiled class has an invalid modified UTF-8 name.")?
        }
        _ => return Err("The selected compiled class has an invalid type name.".into()),
    };
    let binary_name = internal_name.replace('/', ".");
    if !super::main_class(&binary_name) {
        return Err("The selected compiled class has an unsupported binary name.".into());
    }
    Ok(binary_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        let mut bytes = vec![
            0xca, 0xfe, 0xba, 0xbe, // magic
            0, 0, // minor version
            0, 61, // major version
            0, 3, // constant pool count
            1, // UTF-8 class name
        ];
        let encoded = cesu8::to_java_cesu8(name);
        bytes.extend_from_slice(&(encoded.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&encoded);
        bytes.extend_from_slice(&[
            7, 0, 1, // class entry referring to UTF-8 entry 1
            0, 0x21, // access flags
            0, 2, // this_class
            0, 0, // super_class
        ]);
        bytes
    }

    #[test]
    fn reads_binary_name_from_classfile_and_rejects_a_mismatch() {
        let bytes = fixture("example/Outer$Inner");
        assert_eq!(
            class_file_binary_name(&bytes).unwrap(),
            "example.Outer$Inner"
        );
        assert!(validate_class_file_name(&bytes, "example.Outer$Inner").is_ok());
        assert!(validate_class_file_name(&bytes, "example.Other").is_err());
    }

    #[test]
    fn classfile_names_use_modified_utf8_including_supplementary_letters() {
        for name in ["café/Avvío𐐀", "测试/类", "pkg/Œuvre$Étage"] {
            let bytes = fixture(name);
            assert_eq!(
                class_file_binary_name(&bytes).unwrap(),
                name.replace('/', ".")
            );
            assert!(validate_class_file_name(&bytes, &name.replace('/', ".")).is_ok());
            assert!(validate_class_file_name(&bytes, "other.Classe").is_err());
        }
        for bytes in [
            vec![0xed, 0xa0, 0x80],
            vec![0xed, 0xb0, 0x80],
            vec![0xc0, 0x80],
            vec![0xf0, 0x90, 0x90, 0x80],
        ] {
            let mut malformed = fixture("X");
            malformed.splice(
                11..14,
                [((bytes.len() >> 8) & 255) as u8, (bytes.len() & 255) as u8]
                    .into_iter()
                    .chain(bytes),
            );
            assert!(class_file_binary_name(&malformed).is_err());
        }
    }

    #[test]
    fn rejects_malformed_or_unsupported_classfiles() {
        assert!(class_file_binary_name(&[0, 1, 2]).is_err());
        assert!(class_file_binary_name(&fixture("example/Bad-Name")).is_err());
    }

    #[test]
    fn synchronized_project_reload_requires_a_materialized_runtime_output() {
        let roots = [PathBuf::from("/workspace/module/build/classes/java/main")];
        assert!(validate_runtime_output_binding(
            true,
            Some(&roots),
            Path::new("/workspace/module/build/classes/java/main/pkg/Runner.class"),
        )
        .is_ok());
        assert!(validate_runtime_output_binding(
            true,
            Some(&roots),
            Path::new("/workspace/module/target/classes/pkg/Runner.class"),
        )
        .is_err());
        assert!(
            validate_runtime_output_binding(true, None, Path::new("/workspace/Runner.class"))
                .is_err()
        );
        assert!(validate_runtime_output_binding(
            false,
            None,
            Path::new("/workspace/manual-attach/Runner.class"),
        )
        .is_ok());
    }
}
pub(super) fn send(job: &Arc<Job>, request: &Request) -> Result<(), String> {
    request.validate()?;
    current(job, request)?;
    let mut pending = job
        .class_reload
        .try_lock()
        .map_err(|_| "Class reload preparation is already in progress.")?;
    if pending.is_some() {
        return Err("Wait for the current class reload result before another reload.".into());
    }
    let mut contents = String::from("IDE JDI class reload 1\n");
    let mut total = 0;
    for file in &request.classes {
        let bytes = compiled(job, file)?;
        total += bytes.len();
        if total > TOTAL_LIMIT {
            return Err("Compiled class reload exceeds its 8 MiB aggregate limit.".into());
        }
        contents.push_str(&base64::engine::general_purpose::STANDARD.encode(&file.class_name));
        contents.push('\t');
        contents.push_str(&base64::engine::general_purpose::STANDARD.encode(bytes));
        contents.push('\n');
    }
    let file = LaunchFile::create("class-reload.txt", contents.as_bytes())?;
    let transfer_path = file
        .path
        .to_str()
        .filter(|path| path.len() <= 1024)
        .ok_or("Class reload storage must be UTF-8 and have a path of at most 1024 bytes.")?
        .to_owned();
    let hash = format!("{:x}", Sha256::digest(contents.as_bytes()));
    let outcome = Outcome {
        request_id: format!("reload-{}", NEXT_SESSION.fetch_add(1, Ordering::SeqCst)),
        status: "queued".into(),
        classes: request
            .classes
            .iter()
            .map(|file| file.class_name.clone())
            .collect(),
        error: None,
    };
    current(job, request)?;
    let mut sources = job
        .sources
        .try_lock()
        .map_err(|_| "Source inspection is in progress; retry class reload.")?;
    let previous = sources.take();
    *sources = Some(Err("Source binding was retired for class reload; local files cannot be verified against the revised JVM.".into()));
    let fields = vec![
        "reloadClasses".into(),
        request.stop_id.clone().unwrap_or_default(),
        transfer_path,
        "0".into(),
        outcome.request_id.clone(),
        hash,
    ];
    if let Err(error) = structured_debugger::send_fields(job, &fields) {
        *sources = previous;
        return Err(error);
    }
    *pending = Some(Pending {
        outcome: outcome.clone(),
        _file: file,
    });
    job.snapshot
        .lock()
        .map_err(|_| "Class reload state is unavailable.")?
        .class_reload = Some(outcome);
    Ok(())
}
pub(super) fn complete(job: &Arc<Job>, mut result: Outcome) -> Result<(), String> {
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(());
    }
    let mut pending = job
        .class_reload
        .lock()
        .map_err(|_| "Class reload state is unavailable.")?;
    let expected = pending
        .as_ref()
        .ok_or("Unrequested JDI class reload result.")?;
    if result.request_id != expected.outcome.request_id
        || (result.status == "applied" && result.classes != expected.outcome.classes)
        || !expected.outcome.classes.starts_with(&result.classes)
        || !["applied", "failed"].contains(&result.status.as_str())
        || (result.status == "applied" && result.error.is_some())
        || (result.status == "failed"
            && result
                .error
                .as_ref()
                .is_none_or(|error| error.is_empty() || error.len() > 4096 || error.contains('\0')))
    {
        return Err("Invalid JDI class reload result.".into());
    }
    result.classes = expected.outcome.classes.clone();
    job.snapshot
        .lock()
        .map_err(|_| "Class reload state is unavailable.")?
        .class_reload = Some(result);
    *pending = None;
    Ok(())
}
pub(super) fn retire(job: &Job) {
    if let Ok(mut pending) = job.class_reload.try_lock() {
        *pending = None;
    }
    if let Ok(mut snapshot) = job.snapshot.lock() {
        if let Some(result) = snapshot
            .class_reload
            .as_mut()
            .filter(|result| result.status == "queued")
        {
            result.status = "failed".into();
            result.error = Some(
                "The debugger connection ended before a class reload result was received.".into(),
            );
        }
    }
}
