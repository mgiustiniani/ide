//! JDT LS/JDK discovery, constrained process launch, ownership, and redaction helpers.

use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::support::lock;

const MAX_STDERR_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub(super) struct JdtlsInstall {
    pub(super) home: PathBuf,
    pub(super) launcher: PathBuf,
    pub(super) configuration: PathBuf,
    pub(super) version: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct JavaInstall {
    pub(super) executable: PathBuf,
    pub(super) version: String,
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
    Ok(JdtlsInstall {
        home,
        launcher: launchers.remove(0),
        configuration,
        version,
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

pub(super) fn launch_args(jdtls: &JdtlsInstall, data_dir: &Path) -> Vec<String> {
    vec![
        "-Declipse.application=org.eclipse.jdt.ls.core.id1".to_string(),
        "-Dosgi.bundles.defaultStartLevel=4".to_string(),
        "-Declipse.product=org.eclipse.jdt.ls.core.product".to_string(),
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
        jdtls.configuration.to_string_lossy().into_owned(),
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
        fs::write(
            root.join("plugins/org.eclipse.equinox.launcher_2.jar"),
            "jar",
        )
        .unwrap();
        assert!(inspect_jdtls_layout(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn launch_arguments_isolate_workspace_data() {
        let install = JdtlsInstall {
            home: PathBuf::from("/tool"),
            launcher: PathBuf::from("/tool/launcher.jar"),
            configuration: PathBuf::from("/tool/config_linux"),
            version: None,
        };
        let first = launch_args(&install, Path::new("/state/workspace-a"));
        let second = launch_args(&install, Path::new("/state/workspace-b"));
        assert_ne!(first.last(), second.last());
        assert_eq!(first[first.len() - 2], "-data");
        assert!(!first.iter().any(|arg| arg.contains("sh -c")));
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
