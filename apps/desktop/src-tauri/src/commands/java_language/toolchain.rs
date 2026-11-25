//! JDT LS/JDK discovery, constrained process launch, ownership, and redaction helpers.

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use quick_xml::events::{BytesEnd, BytesText, Event};
use quick_xml::{Reader, Writer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::commands::refactorkit_daemon::GradleGeneratedSourceSet;

use super::contract::JavaLanguageFormatterProfile;
use super::support::lock;

const MAX_STDERR_BYTES: usize = 16 * 1024;
const MAX_JDTLS_CONFIG_BYTES: usize = 1024 * 1024;
const MAX_MAVEN_SETTINGS_BYTES: usize = 1024 * 1024;
const MAX_FORMATTER_PROFILE_BYTES: usize = 1024 * 1024;
const JDTLS_PLUGIN_CUSTOMIZATION_FILE: &str = "ide-builder.properties";
// The IDE delegates compilation to the selected JDK/build tool. JDT LS must
// preserve their output even when m2e requests an explicit clean build.
const JDTLS_PLUGIN_CUSTOMIZATION: &[u8] =
    b"org.eclipse.jdt.core/org.eclipse.jdt.core.builder.cleanOutputFolder=ignore\n";
static MAVEN_SETTINGS_SEQUENCE: AtomicU64 = AtomicU64::new(0);

static FORMATTER_PROFILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static GRADLE_SOURCE_IMPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) struct GradleGeneratedSourceImport {
    pub(super) path: PathBuf,
}

impl Drop for GradleGeneratedSourceImport {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub(super) fn gradle_generated_source_script(sources: &[GradleGeneratedSourceSet]) -> Option<String> {
    if sources.is_empty() {
        return None;
    }
    let bytes = serde_json::to_vec(sources).ok()?;
    if bytes.len() > 1024 * 1024 {
        return None;
    }
    Some(include_str!("gradle-generated-sources.gradle")
        .replace("__IDE_GRADLE_GENERATED_SOURCES__", &BASE64.encode(bytes)))
}

pub(super) fn gradle_generated_source_data_directory(base: &Path, script: &str) -> PathBuf {
    base.join(format!("gradle-sources-{:x}", Sha256::digest(script.as_bytes())))
}

pub(super) fn prepare_gradle_generated_source_import(
    data_dir: &Path,
    script: &str,
) -> Result<GradleGeneratedSourceImport, String> {
    let sequence = GRADLE_SOURCE_IMPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = data_dir.join(format!("generated-sources-{}-{sequence}.init.gradle", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path)
        .map_err(|_| "Cannot prepare private Gradle source import settings.".to_string())?;
    let settings = GradleGeneratedSourceImport { path };
    if file.write_all(script.as_bytes()).is_err() {
        drop(file);
        return Err("Cannot write private Gradle source import settings.".into());
    }
    Ok(settings)
}

pub(super) struct PrivateMavenSettings {
    path: PathBuf,
}

impl PrivateMavenSettings {
    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn remove(self) -> Result<(), String> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Cannot remove the private Maven settings file".to_string()),
        }
    }
}

impl Drop for PrivateMavenSettings {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub(super) struct PrivateFormatterProfile {
    path: PathBuf,
}

impl PrivateFormatterProfile {
    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for PrivateFormatterProfile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug, Clone)]
pub(super) struct JdtlsInstall {
    pub(super) home: PathBuf,
    pub(super) launcher: PathBuf,
    pub(super) configuration: PathBuf,
    pub(super) version: Option<String>,
    pub(super) minimum_runtime_java: Option<u32>,
}

#[derive(Debug, Clone)]
pub(super) struct JavaInstall {
    pub(super) executable: PathBuf,
    pub(super) version: String,
}

#[derive(Debug, Clone)]
pub(super) struct ProjectJdk {
    pub(super) requested_home: String,
    pub(super) home: PathBuf,
    pub(super) version: String,
    pub(super) major: u32,
}

pub(super) fn probe_project_jdk(home: &str) -> Result<ProjectJdk, String> {
    if home.len() > 4096 || home.contains('\0') || !Path::new(home).is_absolute() {
        return Err("Project JDK home must be an absolute filesystem path".to_string());
    }
    let resolved = Path::new(home)
        .canonicalize()
        .map_err(|error| format!("Cannot resolve selected project JDK: {error}"))?;
    let install = probe_java(
        &resolved.join("bin").join(executable_name("java")),
        &resolved.join("bin").join(executable_name("javac")),
    )?;
    let release = fs::read_to_string(resolved.join("release"))
        .map_err(|error| format!("Cannot read selected project JDK release: {error}"))?;
    let version = release
        .lines()
        .find_map(|line| line.strip_prefix("JAVA_VERSION="))
        .map(|value| value.trim_matches('"'))
        .ok_or_else(|| "Selected project JDK has no JAVA_VERSION metadata".to_string())?;
    let major_text = version.strip_prefix("1.").unwrap_or(version);
    let major = major_text
        .split(['.', '-', '+'])
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|major| *major >= 8)
        .ok_or_else(|| "Selected project JDK has an unsupported Java version".to_string())?;
    let probed_version = install.version.split('"').nth(1).unwrap_or("");
    let probed_major = probed_version
        .strip_prefix("1.")
        .unwrap_or(probed_version)
        .split(['.', '-', '+', '_'])
        .next()
        .and_then(|value| value.parse::<u32>().ok());
    if probed_major != Some(major) {
        return Err("Selected project JDK executable and release metadata disagree".to_string());
    }
    Ok(ProjectJdk {
        requested_home: home.to_string(),
        home: resolved,
        version: install.version,
        major,
    })
}

pub(super) fn language_settings(
    project_jdk: Option<&ProjectJdk>,
    gradle_import_enabled: bool,
) -> Value {
    let mut settings = json!({
        "java": {
            "signatureHelp":{"enabled":true},
            "format":{"onType":{"enabled":true}},
            "inlayHints":{"parameterNames":{"enabled":"literals"}},
            "autobuild":{"enabled":false},
            "import":{"gradle":{"enabled":gradle_import_enabled}}
        }
    });
    if let Some(jdk) = project_jdk {
        settings["java"]["home"] = json!(jdk.home);
        // Maven and Gradle may request an older Java execution environment. Associate
        // compatible environments with the selected SDK instead of the server's JDK.
        let runtimes: Vec<Value> = (8..=jdk.major)
            .map(|release| {
                let name = if release == 8 {
                    "JavaSE-1.8".to_string()
                } else {
                    format!("JavaSE-{release}")
                };
                json!({"name":name,"path":jdk.home,"default":release == jdk.major})
            })
            .collect();
        settings["java"]["configuration"] = json!({"runtimes":runtimes});
    }
    settings
}

pub(super) fn validate_java_formatter_profile(
    workspace_root: &Path,
    profile: Option<&JavaLanguageFormatterProfile>,
) -> Result<(), String> {
    if let Some(profile) = profile {
        read_java_formatter_profile(workspace_root, profile)?;
    }
    Ok(())
}

pub(super) fn prepare_java_formatter_profile(
    data_dir: &Path,
    workspace_root: &Path,
    profile: &JavaLanguageFormatterProfile,
) -> Result<PrivateFormatterProfile, String> {
    let contents = read_java_formatter_profile(workspace_root, profile)?;
    fs::create_dir_all(data_dir)
        .map_err(|_| "Cannot create private Java language-service storage".to_string())?;
    for _ in 0..8 {
        let sequence = FORMATTER_PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = data_dir.join(format!(
            "formatter-profile-{}-{sequence}.xml",
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                if file
                    .write_all(&contents)
                    .and_then(|()| file.sync_all())
                    .is_err()
                {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err("Cannot prepare the private Eclipse formatter profile".to_string());
                }
                return Ok(PrivateFormatterProfile { path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Cannot create the private Eclipse formatter profile".to_string()),
        }
    }
    Err("Cannot allocate a private Eclipse formatter profile".to_string())
}

fn valid_formatter_profile_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 256
        && name.trim() == name
        && !name.chars().any(char::is_control)
}

pub(super) fn read_java_formatter_profile(
    workspace_root: &Path,
    profile: &JavaLanguageFormatterProfile,
) -> Result<Vec<u8>, String> {
    if !valid_formatter_profile_name(&profile.profile_name) {
        return Err("Eclipse formatter profile selection is invalid".to_string());
    }
    let contents = read_formatter_xml(workspace_root, &profile.path)?;
    let names = parse_formatter_profile_names(&contents)?;
    if names
        .iter()
        .filter(|name| *name == &profile.profile_name)
        .count()
        != 1
    {
        return Err(
            "The selected Eclipse formatter profile name must match exactly one profile in the XML"
                .into(),
        );
    }
    Ok(contents)
}

pub(super) fn list_formatter_profile_names(
    workspace_root: &Path,
    path: &str,
) -> Result<Vec<String>, String> {
    let contents = read_formatter_xml(workspace_root, path)?;
    let mut names = std::collections::BTreeMap::new();
    for name in parse_formatter_profile_names(&contents)? {
        *names.entry(name).or_insert(0usize) += 1;
    }
    let unique: Vec<_> = names
        .into_iter()
        .filter_map(|(name, count)| (count == 1).then_some(name))
        .collect();
    if unique.is_empty() {
        return Err("Eclipse formatter XML has no uniquely named profiles".into());
    }
    Ok(unique)
}

fn read_formatter_xml(workspace_root: &Path, xml_path: &str) -> Result<Vec<u8>, String> {
    if xml_path.is_empty()
        || xml_path.len() > 4_096
        || xml_path.trim() != xml_path
        || xml_path.chars().any(char::is_control)
    {
        return Err("Eclipse formatter XML path is invalid".to_string());
    }
    let normalized_path = xml_path.replace('\\', "/");
    if normalized_path.starts_with('/')
        || normalized_path.starts_with("//")
        || normalized_path.as_bytes().get(1) == Some(&b':')
        || normalized_path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Eclipse formatter XML path must be workspace-relative".to_string());
    }
    if !normalized_path.to_ascii_lowercase().ends_with(".xml") {
        return Err("Eclipse formatter profile must be an XML file".to_string());
    }
    let root = workspace_root.canonicalize().map_err(|_| {
        "Cannot resolve the authorized workspace for the formatter profile".to_string()
    })?;
    let path = root
        .join(&normalized_path)
        .canonicalize()
        .map_err(|_| "Cannot resolve the Eclipse formatter XML inside the workspace".to_string())?;
    if !path.starts_with(&root) {
        return Err("Eclipse formatter XML must remain inside the workspace".to_string());
    }
    let metadata =
        fs::metadata(&path).map_err(|_| "Cannot inspect the Eclipse formatter XML".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FORMATTER_PROFILE_BYTES as u64 {
        return Err(
            "Eclipse formatter XML must be a regular file no larger than 1 MiB".to_string(),
        );
    }
    let mut contents = Vec::new();
    fs::File::open(&path)
        .and_then(|file| {
            file.take((MAX_FORMATTER_PROFILE_BYTES + 1) as u64)
                .read_to_end(&mut contents)
        })
        .map_err(|_| "Cannot read the Eclipse formatter XML".to_string())?;
    if contents.len() > MAX_FORMATTER_PROFILE_BYTES {
        return Err("Eclipse formatter XML is larger than 1 MiB".to_string());
    }
    Ok(contents)
}

fn parse_formatter_profile_names(contents: &[u8]) -> Result<Vec<String>, String> {
    std::str::from_utf8(contents)
        .map_err(|_| "Eclipse formatter XML must be valid UTF-8".to_string())?;
    let mut reader = Reader::from_reader(contents);
    reader.config_mut().trim_text(true);
    let mut root_seen = false;
    let mut names = Vec::new();
    let mut depth = 0usize;
    loop {
        let event = reader
            .read_event()
            .map_err(|_| "Eclipse formatter XML is malformed")?;
        match &event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.name();
                if depth == 0 {
                    if root_seen || xml_local_name(name.as_ref()) != b"profiles" {
                        return Err("Eclipse formatter XML must have one profiles root".into());
                    }
                    root_seen = true;
                }
                if depth == 1 && xml_local_name(name.as_ref()) == b"profile" {
                    for attribute in element.attributes() {
                        let attribute = attribute
                            .map_err(|_| "Eclipse formatter XML has an invalid profile entry")?;
                        if xml_local_name(attribute.key.as_ref()) == b"name" {
                            let name = attribute
                                .decode_and_unescape_value(reader.decoder())
                                .map_err(|_| "Eclipse formatter XML has an invalid profile name")?;
                            if valid_formatter_profile_name(&name) {
                                names.push(name.into_owned());
                            }
                        }
                    }
                }
                if matches!(event, Event::Start(_)) {
                    depth += 1;
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or("Eclipse formatter XML is malformed")?;
            }
            Event::DocType(_) => {
                return Err("Eclipse formatter XML must not declare a document type".into())
            }
            Event::Text(_) | Event::CData(_) if depth == 0 => {
                return Err("Eclipse formatter XML has content outside the profiles root".into());
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root_seen || depth != 0 {
        return Err("Eclipse formatter XML is missing a complete profiles root".into());
    }
    Ok(names)
}

/// Read a workspace-authorized formatter profile and derive RefactorKit's content identity.
pub(crate) fn formatter_profile_payload(
    workspace_root: &Path,
    profile: &JavaLanguageFormatterProfile,
) -> Result<(String, String, String, String), String> {
    let contents = read_java_formatter_profile(workspace_root, profile)?;
    let xml = String::from_utf8(contents)
        .map_err(|_| "Eclipse formatter XML must be valid UTF-8".to_string())?;
    let path = profile.path.replace('\\', "/");
    let identity = format!(
        "java-formatter-profile-v1\0{path}\0{}\0{xml}",
        profile.profile_name
    );
    let digest = Sha256::digest(identity.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok((path, profile.profile_name.clone(), xml, digest))
}

pub(super) fn prepare_maven_user_settings(
    data_dir: &Path,
    local_repository: &str,
) -> Result<PrivateMavenSettings, String> {
    prepare_maven_user_settings_from(
        data_dir,
        local_repository,
        user_home()
            .map(|home| home.join(".m2").join("settings.xml"))
            .as_deref(),
    )
}

pub(super) fn validate_maven_local_repository(local_repository: &str) -> Result<(), String> {
    let repository = Path::new(local_repository);
    if local_repository.is_empty()
        || local_repository.len() > 4_096
        || local_repository.chars().any(char::is_control)
        || !repository.is_absolute()
    {
        return Err("Maven local repository must be an absolute filesystem path".to_string());
    }
    Ok(())
}

fn prepare_maven_user_settings_from(
    data_dir: &Path,
    local_repository: &str,
    source_settings: Option<&Path>,
) -> Result<PrivateMavenSettings, String> {
    validate_maven_local_repository(local_repository)?;
    let source = match source_settings {
        Some(path) => match fs::metadata(path) {
            Ok(metadata)
                if metadata.is_file() && metadata.len() <= MAX_MAVEN_SETTINGS_BYTES as u64 =>
            {
                let contents = fs::read(path)
                    .map_err(|_| "Cannot read the user's Maven settings.xml".to_string())?;
                if contents.len() > MAX_MAVEN_SETTINGS_BYTES {
                    return Err("The user's Maven settings.xml is oversized".to_string());
                }
                Some(contents)
            }
            Ok(_) => {
                return Err(
                    "The user's Maven settings.xml is not a regular file or is oversized"
                        .to_string(),
                )
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Cannot inspect the user's Maven settings.xml".to_string()),
        },
        None => None,
    };
    let contents = match source {
        Some(contents) => rewrite_maven_local_repository(&contents, local_repository)?,
        None => format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<settings xmlns=\"http://maven.apache.org/SETTINGS/1.2.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://maven.apache.org/SETTINGS/1.2.0 https://maven.apache.org/xsd/settings-1.2.0.xsd\"><localRepository>{}</localRepository></settings>\n",
            quick_xml::escape::escape(local_repository)
        )
        .into_bytes(),
    };

    fs::create_dir_all(data_dir)
        .map_err(|_| "Cannot create private Java language-service storage".to_string())?;
    for _ in 0..8 {
        let sequence = MAVEN_SETTINGS_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = data_dir.join(format!(
            "maven-settings-{}-{sequence}.xml",
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                if file
                    .write_all(&contents)
                    .and_then(|()| file.sync_all())
                    .is_err()
                {
                    drop(file);
                    let _ = fs::remove_file(&path);
                    return Err("Cannot prepare private Maven settings for JDT LS".to_string());
                }
                return Ok(PrivateMavenSettings { path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Cannot create private Maven settings for JDT LS".to_string()),
        }
    }
    Err("Cannot allocate private Maven settings for JDT LS".to_string())
}

fn rewrite_maven_local_repository(
    contents: &[u8],
    local_repository: &str,
) -> Result<Vec<u8>, String> {
    if contents.len() > MAX_MAVEN_SETTINGS_BYTES {
        return Err("The user's Maven settings.xml is oversized".to_string());
    }
    let mut reader = Reader::from_reader(contents);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(contents.len() + local_repository.len()));
    let mut stack: Vec<Vec<u8>> = Vec::new();
    let mut root_seen = false;
    let mut repository_seen = false;
    let mut replacing_local_repository: Option<Vec<u8>> = None;

    loop {
        let event = reader
            .read_event()
            .map_err(|_| "The user's Maven settings.xml is invalid".to_string())?;
        if let Some(replaced_name) = &replacing_local_repository {
            match event {
                Event::End(end) if end.name().as_ref() == replaced_name => {
                    writer
                        .write_event(Event::End(end.into_owned()))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    replacing_local_repository = None;
                }
                Event::Start(_) | Event::Empty(_) => {
                    return Err(
                        "The user's Maven localRepository setting must contain plain text"
                            .to_string(),
                    )
                }
                Event::Eof => return Err("The user's Maven settings.xml is incomplete".to_string()),
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(start) => {
                let name = start.name().as_ref().to_vec();
                let local = xml_local_name(&name);
                if stack.is_empty() {
                    if root_seen || local != b"settings" {
                        return Err(
                            "The user's Maven settings.xml has no settings root".to_string()
                        );
                    }
                    root_seen = true;
                }
                if stack.len() == 1
                    && xml_local_name(stack.last().unwrap()) == b"settings"
                    && local == b"localRepository"
                {
                    if repository_seen {
                        return Err(
                            "The user's Maven settings.xml has duplicate localRepository elements"
                                .to_string(),
                        );
                    }
                    repository_seen = true;
                    writer
                        .write_event(Event::Start(start.into_owned()))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    writer
                        .write_event(Event::Text(BytesText::new(local_repository)))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    replacing_local_repository = Some(name);
                    continue;
                }
                writer
                    .write_event(Event::Start(start.into_owned()))
                    .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                stack.push(name);
            }
            Event::Empty(empty) => {
                let name = empty.name().as_ref().to_vec();
                if stack.len() == 1
                    && xml_local_name(stack.last().unwrap()) == b"settings"
                    && xml_local_name(&name) == b"localRepository"
                {
                    if repository_seen {
                        return Err(
                            "The user's Maven settings.xml has duplicate localRepository elements"
                                .to_string(),
                        );
                    }
                    repository_seen = true;
                    let qualified = std::str::from_utf8(&name).map_err(|_| {
                        "The user's Maven settings.xml has an invalid element name".to_string()
                    })?;
                    writer
                        .write_event(Event::Start(quick_xml::events::BytesStart::new(qualified)))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    writer
                        .write_event(Event::Text(BytesText::new(local_repository)))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    writer
                        .write_event(Event::End(BytesEnd::new(qualified)))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                } else {
                    writer
                        .write_event(Event::Empty(empty.into_owned()))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                }
            }
            Event::End(end) => {
                if stack.len() == 1
                    && xml_local_name(stack.last().unwrap()) == b"settings"
                    && !repository_seen
                {
                    writer
                        .write_event(Event::Start(quick_xml::events::BytesStart::new(
                            "localRepository",
                        )))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    writer
                        .write_event(Event::Text(BytesText::new(local_repository)))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    writer
                        .write_event(Event::End(BytesEnd::new("localRepository")))
                        .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                    repository_seen = true;
                }
                if stack
                    .last()
                    .is_none_or(|open_name| open_name.as_slice() != end.name().as_ref())
                {
                    return Err("The user's Maven settings.xml is invalid".to_string());
                }
                writer
                    .write_event(Event::End(end.into_owned()))
                    .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?;
                stack.pop();
            }
            Event::Eof => break,
            other => writer
                .write_event(other.into_owned())
                .map_err(|_| "Cannot rewrite the user's Maven settings.xml".to_string())?,
        }
    }
    if !root_seen || !stack.is_empty() || !repository_seen || replacing_local_repository.is_some() {
        return Err("The user's Maven settings.xml is incomplete".to_string());
    }
    Ok(writer.into_inner())
}

fn xml_local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

pub(super) fn language_data_dir(base: PathBuf, project_jdk: Option<&ProjectJdk>) -> PathBuf {
    match project_jdk {
        None => base,
        Some(jdk) => {
            let mut digest = Sha256::new();
            digest.update(jdk.home.to_string_lossy().as_bytes());
            digest.update([0]);
            digest.update(jdk.version.as_bytes());
            base.join(format!("project-jdk-{:x}", digest.finalize()))
        }
    }
}

pub(super) fn discover_jdtls() -> Result<JdtlsInstall, String> {
    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("IDE_JDTLS_HOME") {
        candidates.push(PathBuf::from(home));
    }
    if let Some(data_home) = env::var_os("XDG_DATA_HOME") {
        candidates.push(PathBuf::from(data_home).join("ide/tools/jdtls/current"));
    } else if let Some(home) = user_home() {
        candidates.push(home.join(".local/share/ide/tools/jdtls/current"));
    }
    if let Some(home) = user_home() {
        candidates.push(home.join(".local/share/jdtls"));
    }
    candidates.extend([
        PathBuf::from("/usr/share/jdtls"),
        PathBuf::from("/opt/jdtls"),
    ]);
    if let Some(path) = find_on_path(executable_name("jdtls")) {
        if let Ok(path) = path.canonicalize() {
            if let Some(parent) = path.parent() {
                candidates.push(parent.to_path_buf());
                if let Some(grandparent) = parent.parent() {
                    candidates.push(grandparent.to_path_buf());
                }
            }
        }
    }
    for candidate in candidates {
        if let Ok(install) = inspect_jdtls_layout(&candidate) {
            return Ok(install);
        }
    }
    Err("Cannot discover a valid Eclipse JDT LS installation".to_string())
}

pub(super) fn inspect_jdtls_layout(home: &Path) -> Result<JdtlsInstall, String> {
    let home = home
        .canonicalize()
        .map_err(|error| format!("Cannot resolve JDT LS home '{}': {error}", home.display()))?;
    if !home.is_dir() {
        return Err("JDT LS home is not a directory".to_string());
    }
    let plugins = home.join("plugins");
    let mut launchers = fs::read_dir(&plugins)
        .map_err(|error| format!("Cannot read '{}': {error}", plugins.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("org.eclipse.equinox.launcher_") && name.ends_with(".jar")
                    })
        })
        .collect::<Vec<_>>();
    launchers.sort();
    if launchers.len() != 1 {
        return Err("JDT LS must contain exactly one Equinox launcher JAR".to_string());
    }
    if fs::metadata(&launchers[0])
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        == 0
    {
        return Err("JDT LS Equinox launcher JAR is empty".to_string());
    }
    let config_name = if cfg!(target_os = "windows") {
        "config_win"
    } else if cfg!(target_os = "macos") {
        "config_mac"
    } else {
        "config_linux"
    };
    let configuration = home.join(config_name);
    if !configuration.join("config.ini").is_file() {
        return Err(format!(
            "JDT LS configuration directory '{config_name}' is invalid"
        ));
    }
    let version = read_jdtls_version(&home);
    let minimum_runtime_java =
        read_jdtls_minimum_runtime_java(&home)?.max(super::bundle_runtime::required_java(&home)?);
    Ok(JdtlsInstall {
        home,
        launcher: launchers.remove(0),
        configuration,
        version,
        minimum_runtime_java,
    })
}

pub(super) fn read_jdtls_version(home: &Path) -> Option<String> {
    let manifest = fs::read_to_string(home.join("install-manifest.json")).ok()?;
    serde_json::from_str::<Value>(&manifest)
        .ok()?
        .get("version")?
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| home.file_name()?.to_str().map(ToOwned::to_owned))
}

fn read_jdtls_minimum_runtime_java(home: &Path) -> Result<Option<u32>, String> {
    let manifest_path = home.join("install-manifest.json");
    let manifest = match fs::read_to_string(&manifest_path) {
        Ok(manifest) => manifest,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Cannot read JDT LS installation manifest '{}': {error}",
                manifest_path.display()
            ));
        }
    };
    let manifest: Value = serde_json::from_str(&manifest)
        .map_err(|error| format!("JDT LS installation manifest is invalid: {error}"))?;
    let Some(minimum) = manifest.get("minimumRuntimeJava") else {
        return Ok(None);
    };
    let minimum = minimum
        .as_u64()
        .and_then(|major| u32::try_from(major).ok())
        .filter(|major| (8..=99).contains(major))
        .ok_or_else(|| "JDT LS minimumRuntimeJava manifest value is invalid".to_string())?;
    Ok(Some(minimum))
}

pub(super) fn validate_jdtls_runtime(
    install: &JdtlsInstall,
    java: &JavaInstall,
) -> Result<(), String> {
    let Some(minimum) = install.minimum_runtime_java else {
        return Ok(());
    };
    let major = java_major(&java.version).ok_or_else(|| {
        format!(
            "Cannot determine the Java runtime version required by Eclipse JDT LS {}",
            install.version.as_deref().unwrap_or("installation")
        )
    })?;
    if major < minimum {
        return Err(format!(
            "Eclipse JDT LS {} requires JDK {minimum} or newer to run; discovered {}. Configure the JDT LS runtime JDK in Settings, or set IDE_JDTLS_JAVA_HOME, IDE_JAVA_HOME, or JAVA_HOME to a compatible full JDK.",
            install.version.as_deref().unwrap_or("installation"),
            java.version
        ));
    }
    Ok(())
}

pub(super) fn java_major(version: &str) -> Option<u32> {
    let version = version.split('"').nth(1).or_else(|| {
        version.split_whitespace().find(|token| {
            token
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
        })
    })?;
    let major_text = version.strip_prefix("1.").unwrap_or(version);
    major_text
        .split(['.', '-', '+', '_'])
        .next()
        .and_then(|major| major.parse::<u32>().ok())
}

pub(super) fn discover_jdtls_java_with_home(
    jdtls: &JdtlsInstall,
    server_jdk_home: Option<&str>,
) -> Result<JavaInstall, String> {
    let candidates = if let Some(home) = server_jdk_home {
        let home = PathBuf::from(home);
        if !home.is_absolute() {
            return Err(
                "The selected JDT LS runtime JDK home must be an absolute path".to_string(),
            );
        }
        vec![(
            home.join("bin").join(executable_name("java")),
            home.join("bin").join(executable_name("javac")),
        )]
    } else if let Some(home) = env::var_os("IDE_JDTLS_JAVA_HOME") {
        let home = PathBuf::from(home);
        if !home.is_absolute() {
            return Err("IDE_JDTLS_JAVA_HOME must be an absolute JDK home".to_string());
        }
        vec![(
            home.join("bin").join(executable_name("java")),
            home.join("bin").join(executable_name("javac")),
        )]
    } else {
        let mut candidates = Vec::new();
        for variable in ["IDE_JAVA_HOME", "JAVA_HOME"] {
            if let Some(home) = env::var_os(variable) {
                let home = PathBuf::from(home);
                candidates.push((
                    home.join("bin").join(executable_name("java")),
                    home.join("bin").join(executable_name("javac")),
                ));
            }
        }
        if let (Some(java), Some(javac)) = (
            find_on_path(executable_name("java")),
            find_on_path(executable_name("javac")),
        ) {
            candidates.push((java, javac));
        }
        candidates
    };

    select_compatible_jdtls_java(
        jdtls,
        candidates
            .into_iter()
            .map(|(java, javac)| probe_java(&java, &javac)),
    )
}

fn select_compatible_jdtls_java(
    jdtls: &JdtlsInstall,
    candidates: impl IntoIterator<Item = Result<JavaInstall, String>>,
) -> Result<JavaInstall, String> {
    let mut probe_failure = None;
    let mut runtime_failure = None;
    for candidate in candidates {
        match candidate {
            Ok(java) => match validate_jdtls_runtime(jdtls, &java) {
                Ok(()) => return Ok(java),
                Err(error) => runtime_failure = Some(error),
            },
            Err(error) => probe_failure = Some(error),
        }
    }
    Err(runtime_failure
        .or(probe_failure)
        .unwrap_or_else(|| "Cannot discover a full usable Java JDK".to_string()))
}

pub(super) fn discover_java() -> Result<JavaInstall, String> {
    let mut candidates = Vec::new();
    for variable in ["IDE_JAVA_HOME", "JAVA_HOME"] {
        if let Some(home) = env::var_os(variable) {
            let home = PathBuf::from(home);
            candidates.push((
                home.join("bin").join(executable_name("java")),
                home.join("bin").join(executable_name("javac")),
            ));
        }
    }
    if let (Some(java), Some(javac)) = (
        find_on_path(executable_name("java")),
        find_on_path(executable_name("javac")),
    ) {
        candidates.push((java, javac));
    }
    for (java, javac) in candidates {
        if let Ok(install) = probe_java(&java, &javac) {
            return Ok(install);
        }
    }
    Err("Cannot discover a full usable Java JDK".to_string())
}

pub(super) fn probe_java(java: &Path, javac: &Path) -> Result<JavaInstall, String> {
    if !java.is_file() || !javac.is_file() {
        return Err("Java candidate does not include java and javac".to_string());
    }
    let java = java
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Java executable: {error}"))?;
    let javac = javac
        .canonicalize()
        .map_err(|error| format!("Cannot resolve javac executable: {error}"))?;
    let java_output = run_probe(&java, &["-version"], Duration::from_secs(5))?;
    let _ = run_probe(&javac, &["-version"], Duration::from_secs(5))?;
    let version = java_output
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Java version unavailable")
        .chars()
        .take(300)
        .collect();
    Ok(JavaInstall {
        executable: java,
        version,
    })
}

pub(super) fn run_probe(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Cannot run '{}': {error}", executable.display()))?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("Cannot collect tool probe output: {error}"))?;
                if !status.success() {
                    return Err(format!("Tool probe failed with {status}"));
                }
                let mut combined = output.stderr;
                combined.extend_from_slice(&output.stdout);
                combined.truncate(4096);
                return Ok(String::from_utf8_lossy(&combined).into_owned());
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Tool capability probe timed out".to_string());
            }
            Err(error) => return Err(format!("Cannot wait for tool probe: {error}")),
        }
    }
}

pub(super) fn prepare_jdtls_configuration(
    jdtls: &JdtlsInstall,
    data_dir: &Path,
) -> Result<PathBuf, String> {
    let template_path = jdtls.configuration.join("config.ini");
    let template = fs::read(&template_path).map_err(|error| {
        format!("Cannot read the managed JDT LS configuration template: {error}")
    })?;
    if template.is_empty() || template.len() > MAX_JDTLS_CONFIG_BYTES {
        return Err("Managed JDT LS configuration template is empty or oversized".to_string());
    }
    let mut digest = Sha256::new();
    digest.update(jdtls.home.to_string_lossy().as_bytes());
    digest.update([0]);
    digest.update(&template);
    digest.update([0]);
    digest.update(JDTLS_PLUGIN_CUSTOMIZATION);
    let configuration = data_dir.join(format!("configuration-{:x}", digest.finalize()));
    fs::create_dir_all(&configuration)
        .map_err(|error| format!("Cannot create the private JDT LS configuration area: {error}"))?;
    if !fs::symlink_metadata(&configuration)
        .map_err(|error| format!("Cannot inspect the private JDT LS configuration area: {error}"))?
        .file_type()
        .is_dir()
    {
        return Err("Private JDT LS configuration area is not a directory".to_string());
    }
    write_jdtls_configuration_file(&configuration.join("config.ini"), &template)?;
    write_jdtls_configuration_file(
        &configuration.join(JDTLS_PLUGIN_CUSTOMIZATION_FILE),
        JDTLS_PLUGIN_CUSTOMIZATION,
    )?;
    Ok(configuration)
}

fn write_jdtls_configuration_file(config_file: &Path, contents: &[u8]) -> Result<(), String> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&config_file)
    {
        Ok(mut file) => {
            if let Err(error) = file.write_all(contents).and_then(|()| file.sync_all()) {
                drop(file);
                let _ = fs::remove_file(&config_file);
                return Err(format!(
                    "Cannot prepare the private JDT LS configuration: {error}"
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(&config_file).map_err(|metadata_error| {
                format!("Cannot inspect the private JDT LS configuration: {metadata_error}")
            })?;
            if !metadata.file_type().is_file()
                || metadata.len() != contents.len() as u64
                || fs::read(&config_file).map_err(|read_error| {
                    format!("Cannot read the private JDT LS configuration: {read_error}")
                })? != contents
            {
                return Err("Private JDT LS configuration does not match its template".to_string());
            }
        }
        Err(error) => {
            return Err(format!(
                "Cannot create the private JDT LS configuration: {error}"
            ));
        }
    }
    Ok(())
}

pub(super) fn launch_args(
    jdtls: &JdtlsInstall,
    data_dir: &Path,
    configuration: &Path,
) -> Vec<String> {
    vec![
        "-Declipse.application=org.eclipse.jdt.ls.core.id1".to_string(),
        "-Dosgi.bundles.defaultStartLevel=4".to_string(),
        "-Declipse.product=org.eclipse.jdt.ls.core.product".to_string(),
        "-Djava.import.generatesMetadataFilesAtProjectRoot=false".to_string(),
        "-Dlog.protocol=false".to_string(),
        "-Dlog.level=WARNING".to_string(),
        "-Xms128m".to_string(),
        "-Xmx1G".to_string(),
        "--add-modules=ALL-SYSTEM".to_string(),
        "--add-opens".to_string(),
        "java.base/java.util=ALL-UNNAMED".to_string(),
        "--add-opens".to_string(),
        "java.base/java.lang=ALL-UNNAMED".to_string(),
        "-jar".to_string(),
        jdtls.launcher.to_string_lossy().into_owned(),
        "-configuration".to_string(),
        configuration.to_string_lossy().into_owned(),
        "-pluginCustomization".to_string(),
        configuration
            .join(JDTLS_PLUGIN_CUSTOMIZATION_FILE)
            .to_string_lossy()
            .into_owned(),
        "-data".to_string(),
        data_dir.to_string_lossy().into_owned(),
    ]
}

pub(super) fn copy_safe_environment(command: &mut Command) {
    for key in [
        "HOME",
        "USERPROFILE",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "LC_ALL",
        "TZ",
    ] {
        if let Some(value) = env::var_os(key) {
            command.env(key, value);
        }
    }
}

pub(super) fn drain_stderr(mut stderr: impl Read, workspace: &str, home: Option<&str>) {
    let mut retained = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match stderr.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) if retained.len() < MAX_STDERR_BYTES => {
                let remaining = MAX_STDERR_BYTES - retained.len();
                retained.extend_from_slice(&buffer[..read.min(remaining)]);
            }
            Ok(_) => {}
        }
    }
    let mut redacted = String::from_utf8_lossy(&retained).replace(workspace, "<workspace>");
    if let Some(home) = home {
        redacted = redacted.replace(home, "<home>");
    }
    drop(redacted);
}

pub(super) fn wait_for_exit(child: &Arc<Mutex<Child>>, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let exited = lock(child, "JDT LS process")?
            .try_wait()
            .map_err(|error| format!("Cannot inspect JDT LS process: {error}"))?
            .is_some();
        if exited {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(20));
    }
}

pub(super) fn kill_child(child: &Arc<Mutex<Child>>) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub(super) fn workspace_id(root: &Path) -> String {
    let marker = root.join(".ide/workspace.json");
    if let Ok(content) = fs::read_to_string(marker) {
        if let Ok(value) = serde_json::from_str::<Value>(&content) {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                if !id.is_empty()
                    && id.len() <= 128
                    && id.chars().all(|character| {
                        character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                    })
                {
                    return id.to_string();
                }
            }
        }
    }
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in root.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("workspace-{hash:016x}")
}

pub(super) fn find_on_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|path| {
        env::split_paths(&path)
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.is_file())
    })
}

pub(super) fn executable_name(name: &str) -> &str {
    if cfg!(windows) {
        match name {
            "java" => "java.exe",
            "javac" => "javac.exe",
            "jdtls" => "jdtls.bat",
            _ => name,
        }
    } else {
        name
    }
}

pub(super) fn user_home() -> Option<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn gradle_import_is_disabled_by_default_and_explicitly_configured() {
        let disabled = language_settings(None, false);
        assert_eq!(disabled.pointer("/java/format/onType/enabled"), Some(&Value::Bool(true)));
        assert_eq!(disabled.pointer("/java/autobuild/enabled"), Some(&Value::Bool(false)));
        assert_eq!(
            disabled.pointer("/java/inlayHints/parameterNames/enabled"),
            Some(&Value::String("literals".to_string()))
        );
        assert_eq!(
            disabled.pointer("/java/import/gradle/enabled"),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            disabled.pointer("/java/autobuild/enabled"),
            Some(&Value::Bool(false))
        );

        let enabled = language_settings(None, true);
        assert_eq!(
            enabled.pointer("/java/import/gradle/enabled"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn explicit_project_jdk_rejects_missing_or_invalid_selection_without_discovery() {
        assert!(probe_project_jdk("relative/jdk").is_err());
        assert!(probe_project_jdk("/jdk\0other").is_err());
        assert!(probe_project_jdk("/missing-ide-project-sdk-qualification").is_err());
    }

    fn temp_dir(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "ide-jdtls-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn selected_maven_repository_preserves_user_settings_and_cleans_private_copy() {
        let root = temp_dir("maven-settings");
        let source = root.join("settings.xml");
        let data = root.join("session");
        fs::write(
            &source,
            r#"<?xml version="1.0"?><settings xmlns="http://maven.apache.org/SETTINGS/1.2.0"><mirrors><mirror><id>corp</id><url>https://repo.example.test</url><mirrorOf>*</mirrorOf></mirror></mirrors><proxies><proxy><id>corp-proxy</id><host>proxy.example.test</host><port>8080</port></proxy></proxies><servers><server><id>corp</id><username>user</username><password>secret</password></server></servers><localRepository>/old/cache</localRepository></settings>"#,
        )
        .unwrap();
        let private =
            prepare_maven_user_settings_from(&data, "/selected/repository&cache", Some(&source))
                .unwrap();
        let path = private.path().to_path_buf();
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.contains("https://repo.example.test"));
        assert!(contents.contains("corp-proxy"));
        assert!(contents.contains("proxy.example.test"));
        assert!(contents.contains("<username>user</username>"));
        assert!(contents.contains("<password>secret</password>"));
        assert!(contents.contains("/selected/repository&amp;cache"));
        assert!(contents.contains("</localRepository>"));
        assert!(contents.ends_with("</settings>"));
        assert!(!contents.contains("/old/cache"));
        assert!(fs::read_to_string(&source).unwrap().contains("/old/cache"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(private);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn formatter_profile_lookup_lists_only_unambiguous_names() {
        let root = temp_dir("formatter-profile-names");
        let path = root.join("style.xml");
        fs::write(&path, r#"<profiles><profile name="Team &amp; Java"/><profile name="Compact"/><profile name="Repeated"/><profile name="Repeated"/></profiles>"#).unwrap();
        assert_eq!(list_formatter_profile_names(&root, "style.xml").unwrap(), ["Compact", "Team & Java"]);
        assert!(list_formatter_profile_names(&root, "../style.xml").is_err());
        fs::write(&path, r#"<profiles><profile name="Incomplete"/>"#).unwrap();
        assert!(list_formatter_profile_names(&root, "style.xml").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn formatter_profile_must_be_a_workspace_xml_entry_and_is_copied_privately() {
        let root = temp_dir("formatter-profile");
        let data_dir = root.join("session");
        let source = root.join("config/java-formatter.xml");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(
            &source,
            r#"<?xml version="1.0" encoding="UTF-8"?><profiles version="23"><profile kind="CodeFormatterProfile" name="Team Java"><setting id="org.eclipse.jdt.core.formatter.tabulation.size" value="4"/></profile></profiles>"#,
        )
        .unwrap();
        let profile = JavaLanguageFormatterProfile {
            path: "config/java-formatter.xml".to_string(),
            profile_name: "Team Java".to_string(),
        };
        validate_java_formatter_profile(&root, Some(&profile)).unwrap();
        let private = prepare_java_formatter_profile(&data_dir, &root, &profile).unwrap();
        let private_path = private.path().to_path_buf();
        assert_ne!(private_path, source);
        assert_eq!(fs::read(&private_path).unwrap(), fs::read(&source).unwrap());
        drop(private);
        assert!(!private_path.exists());

        let outside = JavaLanguageFormatterProfile {
            path: "../java-formatter.xml".to_string(),
            profile_name: "Team Java".to_string(),
        };
        assert!(validate_java_formatter_profile(&root, Some(&outside)).is_err());
        let missing_name = JavaLanguageFormatterProfile {
            path: "config/java-formatter.xml".to_string(),
            profile_name: "Missing".to_string(),
        };
        assert!(validate_java_formatter_profile(&root, Some(&missing_name)).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selected_maven_repository_is_added_when_user_settings_have_no_override() {
        let root = temp_dir("maven-settings-default");
        let source = root.join("settings.xml");
        fs::write(&source, "<settings><profiles/></settings>").unwrap();
        let private = prepare_maven_user_settings_from(
            &root.join("session"),
            "/selected/repository",
            Some(&source),
        )
        .unwrap();
        let contents = fs::read_to_string(private.path()).unwrap();
        assert!(contents.contains("<profiles/>") || contents.contains("<profiles></profiles>"));
        assert!(contents.contains("<localRepository>/selected/repository</localRepository>"));
        drop(private);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_maven_repository_creates_settings_when_default_file_is_absent() {
        let root = temp_dir("maven-settings-absent");
        let private =
            prepare_maven_user_settings_from(&root.join("session"), "/selected/repository", None)
                .unwrap();
        let contents = fs::read_to_string(private.path()).unwrap();
        assert!(contents.starts_with("<?xml version=\"1.0\""));
        assert!(contents.contains("<localRepository>/selected/repository</localRepository>"));
        drop(private);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_maven_repository_rejects_invalid_settings_without_copying_them() {
        let root = temp_dir("maven-settings-invalid");
        let source = root.join("settings.xml");
        fs::write(&source, "<settings><localRepository>one</localRepository><localRepository>two</localRepository></settings>").unwrap();
        assert!(prepare_maven_user_settings_from(
            &root.join("session"),
            "relative/repository",
            Some(&source)
        )
        .is_err());
        assert!(prepare_maven_user_settings_from(
            &root.join("session"),
            "/repository",
            Some(&source)
        )
        .is_err());
        fs::write(&source, "<settings><profile></settings>").unwrap();
        assert!(prepare_maven_user_settings_from(
            &root.join("session"),
            "/repository",
            Some(&source)
        )
        .is_err());
        assert!(!root.join("session").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn layout_requires_exact_launcher_and_platform_config() {
        let root = temp_dir("layout");
        fs::create_dir_all(root.join("plugins")).unwrap();
        let config = if cfg!(target_os = "windows") {
            "config_win"
        } else if cfg!(target_os = "macos") {
            "config_mac"
        } else {
            "config_linux"
        };
        fs::create_dir_all(root.join(config)).unwrap();
        fs::write(root.join(config).join("config.ini"), "ok").unwrap();
        fs::write(
            root.join("plugins/org.eclipse.equinox.launcher_1.jar"),
            "jar",
        )
        .unwrap();
        let install = inspect_jdtls_layout(&root).unwrap();
        assert!(install
            .launcher
            .ends_with("org.eclipse.equinox.launcher_1.jar"));
        let file = fs::File::create(root.join("plugins/org.eclipse.jdt.core_1.jar")).unwrap();
        let mut jar = zip::ZipWriter::new(file);
        jar.start_file(
            "META-INF/MANIFEST.MF",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        jar.write_all(b"Bundle-RequiredExecutionEnvironment: JavaSE-25\n")
            .unwrap();
        jar.finish().unwrap();
        fs::write(
            root.join("install-manifest.json"),
            r#"{"minimumRuntimeJava":21}"#,
        )
        .unwrap();
        assert_eq!(
            inspect_jdtls_layout(&root).unwrap().minimum_runtime_java,
            Some(25)
        );
        fs::write(
            root.join("install-manifest.json"),
            r#"{"minimumRuntimeJava":27}"#,
        )
        .unwrap();
        assert_eq!(
            inspect_jdtls_layout(&root).unwrap().minimum_runtime_java,
            Some(27)
        );
        fs::write(
            root.join("plugins/org.eclipse.equinox.launcher_2.jar"),
            "jar",
        )
        .unwrap();
        assert!(inspect_jdtls_layout(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn managed_jdtls_runtime_floor_rejects_older_server_jdks_with_clear_detail() {
        let install = JdtlsInstall {
            home: PathBuf::from("/tool"),
            launcher: PathBuf::from("/tool/launcher.jar"),
            configuration: PathBuf::from("/tool/config_linux"),
            version: Some("1.62.0-202610131109".to_string()),
            minimum_runtime_java: Some(25),
        };
        let old_java = JavaInstall {
            executable: PathBuf::from("/jdk-21/bin/java"),
            version: "openjdk version \"21.0.9\" 2026-07-21".to_string(),
        };
        let error = validate_jdtls_runtime(&install, &old_java).unwrap_err();
        assert!(error.contains("requires JDK 25 or newer"), "{error}");
        assert!(error.contains("21.0.9"), "{error}");
        assert!(
            error.contains("IDE_JDTLS_JAVA_HOME, IDE_JAVA_HOME, or JAVA_HOME"),
            "{error}"
        );

        let current_java = JavaInstall {
            executable: PathBuf::from("/jdk-25/bin/java"),
            version: "openjdk version \"25.0.3\" 2026-04-21".to_string(),
        };
        validate_jdtls_runtime(&install, &current_java).unwrap();
        assert_eq!(java_major("java version \"1.8.0_442\""), Some(8));
        assert_eq!(java_major("openjdk version \"25-ea\""), Some(25));
    }

    #[test]
    fn managed_jdtls_runtime_selection_skips_an_older_project_jdk() {
        let install = JdtlsInstall {
            home: PathBuf::from("/tool"),
            launcher: PathBuf::from("/tool/launcher.jar"),
            configuration: PathBuf::from("/tool/config_linux"),
            version: Some("1.62.0-202610131109".to_string()),
            minimum_runtime_java: Some(25),
        };
        let selected = select_compatible_jdtls_java(
            &install,
            [
                Ok(JavaInstall {
                    executable: PathBuf::from("/jdk-21/bin/java"),
                    version: "openjdk version \"21.0.9\" 2026-07-21".to_string(),
                }),
                Ok(JavaInstall {
                    executable: PathBuf::from("/jdk-25/bin/java"),
                    version: "openjdk version \"25.0.3\" 2026-04-21".to_string(),
                }),
            ],
        )
        .unwrap();

        assert_eq!(selected.executable, PathBuf::from("/jdk-25/bin/java"));
    }

    #[cfg(unix)]
    #[test]
    fn configured_jdtls_runtime_home_is_probed_and_checked_against_the_server_floor() {
        use std::os::unix::fs::PermissionsExt;

        fn fake_jdk(root: &Path, version: &str) {
            let bin = root.join("bin");
            fs::create_dir_all(&bin).unwrap();
            for executable in ["java", "javac"] {
                let path = bin.join(executable);
                fs::write(
                    &path,
                    format!("#!/bin/sh\necho 'openjdk version \"{version}\"'\n"),
                )
                .unwrap();
                let mut permissions = fs::metadata(&path).unwrap().permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(path, permissions).unwrap();
            }
        }

        let root = temp_dir("selected-server-jdk");
        let configured = root.join("runtime-25");
        let too_old = root.join("runtime-21");
        fake_jdk(&configured, "25.0.3");
        fake_jdk(&too_old, "21.0.9");
        let install = JdtlsInstall {
            home: PathBuf::from("/tool"),
            launcher: PathBuf::from("/tool/launcher.jar"),
            configuration: PathBuf::from("/tool/config_linux"),
            version: Some("1.62.0-202610131109".to_string()),
            minimum_runtime_java: Some(25),
        };

        let selected =
            discover_jdtls_java_with_home(&install, Some(configured.to_str().unwrap())).unwrap();
        assert!(selected.executable.starts_with(&configured));
        assert!(selected.version.contains("25.0.3"));

        let error =
            discover_jdtls_java_with_home(&install, Some(too_old.to_str().unwrap())).unwrap_err();
        assert!(error.contains("requires JDK 25 or newer"), "{error}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_jdtls_runtime_floor_is_loaded_from_install_manifest() {
        let root = temp_dir("runtime-floor");
        fs::write(
            root.join("install-manifest.json"),
            r#"{"version":"1.62.0-202610131109","minimumRuntimeJava":25}"#,
        )
        .unwrap();
        assert_eq!(read_jdtls_minimum_runtime_java(&root).unwrap(), Some(25));
        fs::write(
            root.join("install-manifest.json"),
            r#"{"minimumRuntimeJava":"25"}"#,
        )
        .unwrap();
        assert!(read_jdtls_minimum_runtime_java(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn launch_arguments_isolate_workspace_data() {
        let install = JdtlsInstall {
            home: PathBuf::from("/tool"),
            launcher: PathBuf::from("/tool/launcher.jar"),
            configuration: PathBuf::from("/tool/config_linux"),
            version: None,
            minimum_runtime_java: None,
        };
        let first = launch_args(
            &install,
            Path::new("/state/workspace-a"),
            Path::new("/state/workspace-a/configuration"),
        );
        let second = launch_args(
            &install,
            Path::new("/state/workspace-b"),
            Path::new("/state/workspace-b/configuration"),
        );
        assert_ne!(first.last(), second.last());
        assert_eq!(first[first.len() - 2], "-data");
        assert!(first.contains(&"/state/workspace-a/configuration".to_string()));
        let customization = first
            .iter()
            .position(|arg| arg == "-pluginCustomization")
            .unwrap();
        assert_eq!(
            first[customization + 1],
            "/state/workspace-a/configuration/ide-builder.properties"
        );
        assert!(
            first.contains(&"-Djava.import.generatesMetadataFilesAtProjectRoot=false".to_string())
        );
        assert!(!first.iter().any(|arg| arg.contains("sh -c")));
    }

    #[test]
    fn configuration_area_is_writable_private_and_reused_only_for_the_same_template() {
        let root = temp_dir("config-template");
        let install_root = root.join("install");
        let source = install_root.join("config_linux");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("config.ini"),
            "osgi.configuration.area=@user.home/.config\n",
        )
        .unwrap();
        let install = JdtlsInstall {
            home: install_root,
            launcher: PathBuf::from("/tool/launcher.jar"),
            configuration: source.clone(),
            version: Some("test".to_string()),
            minimum_runtime_java: None,
        };
        let data = root.join("state");
        fs::create_dir_all(&data).unwrap();

        let first = prepare_jdtls_configuration(&install, &data).unwrap();
        let second = prepare_jdtls_configuration(&install, &data).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            fs::read(first.join("config.ini")).unwrap(),
            fs::read(source.join("config.ini")).unwrap()
        );
        assert!(first.starts_with(&data));
        assert!(first.join("config.ini").is_file());
        let builder_preferences = first.join(JDTLS_PLUGIN_CUSTOMIZATION_FILE);
        assert_eq!(
            fs::read(&builder_preferences).unwrap(),
            JDTLS_PLUGIN_CUSTOMIZATION
        );
        fs::write(
            &builder_preferences,
            "org.eclipse.jdt.core/org.eclipse.jdt.core.builder.cleanOutputFolder=clean\n",
        )
        .unwrap();
        assert!(prepare_jdtls_configuration(&install, &data).is_err());
        assert_eq!(
            fs::read(source.join("config.ini")).unwrap(),
            b"osgi.configuration.area=@user.home/.config\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_ids_are_stable_and_marker_ids_are_validated() {
        let root = temp_dir("workspace-id");
        let fallback = workspace_id(&root);
        assert_eq!(fallback, workspace_id(&root));
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(root.join(".ide/workspace.json"), r#"{"id":"project-123"}"#).unwrap();
        assert_eq!(workspace_id(&root), "project-123");
        let _ = fs::remove_dir_all(root);
    }
}
