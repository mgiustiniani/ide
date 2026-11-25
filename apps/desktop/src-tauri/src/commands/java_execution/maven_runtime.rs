//! Read-only identity for the installed Maven launcher selected by Java Run.
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

const CORE_JAR_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(PartialEq, Eq)]
pub(in crate::commands) struct MavenRuntime {
    launcher: PathBuf,
    launcher_digest: String,
    bootstrap_digest: String,
    core_jar: PathBuf,
    sha256: String,
}

impl MavenRuntime {
    pub(in crate::commands) fn launcher(&self) -> &Path {
        &self.launcher
    }

    pub(in crate::commands) fn project_open_params(&self) -> serde_json::Value {
        serde_json::json!({"coreJar": self.core_jar, "sha256": self.sha256})
    }

    pub(in crate::commands) fn is_current(&self, project: &Path, workspace: &Path) -> bool {
        selected(project, workspace).as_ref() == Some(self)
    }
}

pub(in crate::commands) fn selected(project: &Path, workspace: &Path) -> Option<MavenRuntime> {
    // These overrides can select a different runtime or replace its lifecycle mapping.
    if ["MAVEN_ARGS", "MAVEN_OPTS", "MAVEN_EXT_CLASS_PATH"]
        .iter()
        .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()))
    {
        return None;
    }
    discover(project, workspace, || super::tool("mvn"))
}

fn discover(
    project: &Path,
    workspace: &Path,
    installed_launcher: impl FnOnce() -> Option<PathBuf>,
) -> Option<MavenRuntime> {
    if !project.join("pom.xml").is_file()
        || super::workspace_wrapper(project, workspace, "mvn")
            .ok()?
            .is_some()
    {
        return None;
    }
    let launcher = installed_launcher()?.canonicalize().ok()?;
    let bin = launcher.parent()?;
    if launcher.starts_with(workspace)
        || bin.file_name()?.to_str()? != "bin"
        || launcher.file_name()?.to_str()? != super::executable_name("mvn")
    {
        return None;
    }
    let launcher_digest = digest(&launcher)?;
    let bootstrap_digest = digest(&bin.join("m2.conf"))?;
    let lib = bin.parent()?.join("lib");
    let mut core_jar = None;
    for (index, entry) in fs::read_dir(lib).ok()?.enumerate() {
        if index >= 256 {
            return None;
        }
        let path = entry.ok()?.path();
        let name = path.file_name()?.to_str()?;
        if !name.starts_with("maven-core-") || !name.ends_with(".jar") {
            continue;
        }
        if core_jar.is_some() {
            return None;
        }
        core_jar = Some(path);
    }
    let core_jar = core_jar?;
    let version = core_jar
        .file_name()?
        .to_str()?
        .strip_prefix("maven-core-3.9.")?
        .strip_suffix(".jar")?;
    if version.is_empty()
        || version.len() > 3
        || !version.bytes().all(|byte| byte.is_ascii_digit())
        || core_jar.canonicalize().ok()? != core_jar
    {
        return None;
    }
    let sha256 = digest(&core_jar)?;
    Some(MavenRuntime {
        launcher,
        launcher_digest,
        bootstrap_digest,
        core_jar,
        sha256,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn installed_distribution_is_bound_to_launcher_bootstrap_and_core_bytes() {
        let parent = std::env::temp_dir().join(format!("ide-maven-runtime-{}", std::process::id()));
        fs::create_dir(&parent).unwrap();
        let root = parent.canonicalize().unwrap();
        let project = root.join("project");
        let distribution = root.join("maven");
        let launcher = distribution.join("bin/mvn");
        let bootstrap = distribution.join("bin/m2.conf");
        let core = distribution.join("lib/maven-core-3.9.16.jar");
        for directory in [&project, launcher.parent().unwrap(), core.parent().unwrap()] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(project.join("pom.xml"), "<project/>").unwrap();
        fs::write(&launcher, "launcher").unwrap();
        fs::write(&bootstrap, "configuration").unwrap();
        fs::write(&core, "core").unwrap();
        let shim = root.join("mvn");
        symlink(&launcher, &shim).unwrap();
        let inspect = || discover(&project, &project, || Some(shim.clone()));
        let original = inspect().unwrap();
        assert_eq!(
            original.project_open_params(),
            serde_json::json!({
                "coreJar": &core,
                "sha256": format!("{:x}", Sha256::digest(b"core")),
            })
        );
        for (path, original_bytes) in [
            (&launcher, "launcher"),
            (&bootstrap, "configuration"),
            (&core, "core"),
        ] {
            fs::write(path, "changed").unwrap();
            assert!(inspect().is_some_and(|current| current != original));
            fs::write(path, original_bytes).unwrap();
        }
        let wrapper = project.join("mvnw");
        fs::write(&wrapper, "wrapper").unwrap();
        assert!(inspect().is_none());
        fs::remove_file(wrapper).unwrap();
        let other_core = distribution.join("lib/maven-core-3.9.11.jar");
        fs::write(&other_core, "other").unwrap();
        assert!(inspect().is_none());
        fs::remove_file(&core).unwrap();
        symlink(&other_core, &core).unwrap();
        fs::rename(other_core, distribution.join("other.jar")).unwrap();
        // Either a dangling or redirected symbolic Core JAR is unqualified.
        assert!(inspect().is_none());
        fs::remove_dir_all(parent).unwrap();
    }
}

fn digest(path: &Path) -> Option<String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || !(1..=CORE_JAR_LIMIT).contains(&metadata.len()) {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(CORE_JAR_LIMIT + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 == metadata.len()).then(|| format!("{:x}", Sha256::digest(bytes)))
}
