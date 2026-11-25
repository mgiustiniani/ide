use super::{Invocation, PathBuf};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

pub(super) type RerunProjects = BTreeMap<PathBuf, String>;

pub(super) struct Fork {
    pub module: PathBuf,
    pub jvm: Jvm,
    pub goal: &'static str,
    pub plugin: String,
    pub version: String,
    pub execution: String,
}

pub(super) enum Jvm {
    Fixed {
        java: PathBuf,
        major: u16,
        inherited: bool,
    },
    Toolchain(HashMap<String, String>),
    BuildContextToolchain,
}

pub(super) fn missing_toolchain_reported(output: &str) -> bool {
    const MISSING: &str = ": Requested toolchain specification did not match any configured toolchain:";
    const FORK_LAUNCHER_ERROR: &str = concat!(
        "Exception in thread \"main\" java.lang.AssertionError: ",
        "Requested toolchain specification did not match any configured toolchain for the Maven test fork."
    );
    output.lines().any(|line| {
        let line = line.trim();
        line == FORK_LAUNCHER_ERROR
            || line
                .strip_prefix("[ERROR] Failed to execute goal org.apache.maven.plugins:")
                .is_some_and(|goal| {
                    (goal.starts_with("maven-surefire-plugin:")
                        || goal.starts_with("maven-failsafe-plugin:"))
                        && goal.contains(MISSING)
                })
    })
}

pub(super) fn offline_plugin_resolution_reported(output: &str) -> bool {
    let mut lines = output.lines().map(str::trim).peekable();
    while let Some(line) = lines.next() {
        let resolution_error = line
            .strip_prefix("[ERROR] Plugin ")
            .is_some_and(|detail| detail.ends_with(" or one of its dependencies could not be resolved:"));
        if resolution_error
            && lines.peek().is_some_and(|next| {
                next.strip_prefix("[ERROR]")
                    .map(str::trim_start)
                    .is_some_and(|detail| {
                        let repository_refusal = detail.strip_prefix("Cannot access ").or_else(|| {
                            detail
                                .strip_prefix("The following artifacts could not be resolved: ")
                                .and_then(|artifacts| artifacts.split_once(": Cannot access "))
                                .map(|(_, refusal)| refusal)
                        });
                        repository_refusal.is_some_and(|refusal| refusal.contains(" in offline mode"))
                    })
            })
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::offline_plugin_resolution_reported;

    #[test]
    fn offline_plugin_resolution_requires_the_maven_plugin_error_and_offline_cause() {
        let header = "[ERROR] Plugin org.apache.maven.plugins:maven-toolchains-plugin:3.3.0 or one of its dependencies could not be resolved:";
        let cause = "[ERROR]  Cannot access central (https://repo.maven.apache.org/maven2) in offline mode and the artifact has not been downloaded from it before.";
        let artifact_cause = "[ERROR] \tThe following artifacts could not be resolved: org.apache.maven.plugins:maven-plugins:pom:49 (absent): Cannot access central (https://repo.maven.apache.org/maven2) in offline mode and the artifact has not been downloaded from it before.";
        assert!(offline_plugin_resolution_reported(&format!("{header}\n{cause}")));
        assert!(offline_plugin_resolution_reported(&format!("{header}\n{artifact_cause}")));
        assert!(!offline_plugin_resolution_reported(header));
        assert!(!offline_plugin_resolution_reported(cause));
        assert!(!offline_plugin_resolution_reported(&format!(
            "{header}\n[ERROR]  Could not find artifact org.apache.maven.plugins:maven-toolchains-plugin:jar:3.3.0"
        )));
    }
}

pub(super) struct ReactorTestSelection<'a> {
    pub root: &'a Path,
    pub module: &'a Path,
    pub operation: &'a str,
}

fn report_module_path(reactor: &Path, module: &Path) -> Result<PathBuf, String> {
    let directory = reactor.join(module);
    let pom = directory.join("pom.xml");
    if !pom.is_file() || pom.canonicalize().ok().as_ref() != Some(&pom) {
        return Err("A Maven module from the test report has moved or is unavailable. Run the tests again.".into());
    }
    Ok(directory)
}

#[cfg(not(unix))]
pub(super) fn configure_rerun(
    invocation: &mut Invocation,
    reactor: &Path,
    projects: &RerunProjects,
    _: &str,
) -> Result<(), String> {
    let mut paths = Vec::new();
    let filter = projects.values().next();
    for (module, selector) in projects {
        if Some(selector) != filter {
            return Err("Rerun the failed tests from each Maven module separately.".into());
        }
        report_module_path(reactor, module)?;
        let names = module.iter().map(|part| {
            part.to_str().filter(|name| {
                !name.contains([',', ':', '\\']) && !name.chars().any(char::is_control)
                    && name.trim() == *name
            }).ok_or("A report's Maven module path cannot be passed safely to Maven.")
        }).collect::<Result<Vec<_>, _>>()?;
        paths.push(if names.is_empty() { ".".into() } else { format!("./{}", names.join("/")) });
    }
    invocation.arguments.extend(["--projects".into(), paths.join(",")]);
    Ok(())
}

#[cfg(unix)]
pub(super) fn configure_rerun(
    invocation: &mut Invocation,
    reactor: &Path,
    projects: &RerunProjects,
    operation: &str,
) -> Result<(), String> {
    use super::LaunchFile;

    let mut launch = LaunchFile::create("run-maven", include_bytes!("maven_test_forks/run-maven.sh"))?;
    let phase = write_reactor_selection(launch.managed_directory(), reactor, projects, operation)?;
    wrap_invocation(invocation, &mut launch, phase)?;
    invocation.auxiliary_files.push(launch);
    Ok(())
}

#[cfg(unix)]
fn write_reactor_selection(
    directory: &Path,
    reactor: &Path,
    projects: &RerunProjects,
    operation: &str,
) -> Result<&'static str, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let mut manifest = String::new();
    for (module, tests) in projects {
        let module = report_module_path(reactor, module)?;
        let module = module.to_str().ok_or("Maven module paths must be UTF-8.")?;
        manifest.push_str(&STANDARD.encode(module));
        manifest.push('\t');
        manifest.push_str(&STANDARD.encode(tests));
        manifest.push('\n');
    }
    let phase = match operation {
        "test" | "debug-test" | "coverage" => "rerun-test",
        "integration-test" | "debug-integration-test" | "integration-coverage" => "rerun-integration-test",
        _ => return Err("Maven reactor test selection requires a test operation.".into()),
    };
    std::fs::write(directory.join("rerun"), manifest)
        .map_err(|_| "Cannot write the Maven test selection.")?;
    Ok(phase)
}

#[cfg(not(unix))]
pub(super) fn configure(_: &mut Invocation, _: &[Fork], _: &[String], reactor_tests: Option<ReactorTestSelection<'_>>) -> Result<(), String> {
    if let Some(ReactorTestSelection { root, module, operation }) = reactor_tests {
        let _ = (root, module, operation);
        return Err("Debugging tests in a synchronized Maven reactor module requires the Unix test launcher.".into());
    }
    Err("This Maven test JVM configuration requires the Unix fork launcher.".into())
}

#[cfg(unix)]
pub(super) fn configure(
    invocation: &mut Invocation,
    forks: &[Fork],
    options: &[String],
    reactor_tests: Option<ReactorTestSelection<'_>>,
) -> Result<(), String> {
    use super::{
        build_tool_arguments,
        launch_settings::{argument_file_contents, marked_test_jvm_options},
        LaunchFile,
    };
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{fs, os::unix::fs::PermissionsExt};

    let mut launch = LaunchFile::create("run-maven", include_bytes!("maven_test_forks/run-maven.sh"))?;
    let directory = launch.managed_directory().to_path_buf();
    let mode = if let Some(selection) = reactor_tests {
        let module = selection.module.strip_prefix(selection.root)
            .map_err(|_| "The selected test module moved outside the Maven reactor.")?;
        // The invocation already contains the selected test filter or TestNG suite.
        let projects = BTreeMap::from([(module.to_path_buf(), String::new())]);
        write_reactor_selection(&directory, selection.root, &projects, selection.operation)?
    } else {
        "forks"
    };
    if forks.is_empty() {
        wrap_invocation(invocation, &mut launch, mode)?;
        invocation.auxiliary_files.push(launch);
        return Ok(());
    }
    let (marker, arguments) = marked_test_jvm_options(options)?;
    let quoted_options = arguments
        .iter()
        .map(|arg| shell_literal(arg))
        .collect::<Vec<_>>()
        .join(" ");
    let argument_file = if forks
        .iter()
        .any(|fork| !matches!(fork.jvm, Jvm::Fixed { major: 8, .. }))
    {
        let path = directory.join("test-jvm.args");
        fs::write(&path, argument_file_contents(&arguments))
            .map_err(|_| "Cannot write the private Maven test JVM options.")?;
        let reference = format!(
            "@{}",
            path.to_str()
                .ok_or("Maven launch storage must have a UTF-8 path.")?
        );
        build_tool_arguments(&[reference])
    } else {
        String::new()
    };
    let mut manifest = String::new();
    for (index, fork) in forks.iter().enumerate() {
        let bin = directory.join(format!("fork-{index}/bin"));
        let launcher = bin.join("java");
        let (java, mode, launcher_java, argument_file, requirements) = match &fork.jvm {
            Jvm::Fixed {
                java,
                major,
                inherited,
            } => {
                let java = java.to_str().ok_or("Maven test JVM paths must be UTF-8.")?;
                let mode = if *inherited { "inherited" } else { "explicit" };
                if *major == 8 {
                    (
                        java,
                        mode,
                        Some(format!("real_java={}", shell_literal(java))),
                        "",
                        None,
                    )
                } else {
                    (java, mode, None, argument_file.as_str(), None)
                }
            }
            Jvm::Toolchain(requirements) => (
                "",
                "toolchain",
                Some(r#"IFS= read -r real_java < "${0%/bin/java}/real-java""#.into()),
                argument_file.as_str(),
                Some(requirements),
            ),
            Jvm::BuildContextToolchain => (
                "",
                "build-context-toolchain",
                Some(r#"IFS= read -r real_java < "${0%/bin/java}/real-java""#.into()),
                argument_file.as_str(),
                None,
            ),
        };
        if let Some(launcher_java) = launcher_java.as_ref() {
            let contents = include_str!("maven_test_forks/java.sh")
                .replace("IDE_JVM_OPTIONS", &quoted_options)
                .replacen("IDE_REAL_JAVA", launcher_java, 1);
            fs::create_dir_all(&bin)
                .map_err(|_| "Cannot create the private Maven test launcher.")?;
            fs::write(&launcher, contents)
                .map_err(|_| "Cannot write the private Maven test launcher.")?;
            fs::set_permissions(&launcher, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot enable the private Maven test launcher.")?;
        }
        let fields = [
            fork.module
                .to_str()
                .ok_or("Maven module paths must be UTF-8.")?,
            &fork.plugin,
            &fork.version,
            &fork.execution,
            fork.goal,
            java,
            mode,
            if launcher_java.is_some() {
                launcher
                    .to_str()
                    .ok_or("Maven launch storage must have a UTF-8 path.")?
            } else {
                ""
            },
            argument_file,
        ];
        manifest.push_str(&fields.map(|value| STANDARD.encode(value)).join("\t"));
        if let Some(requirements) = requirements {
            for (name, value) in requirements {
                manifest.push('\t');
                manifest.push_str(&STANDARD.encode(name));
                manifest.push('\t');
                manifest.push_str(&STANDARD.encode(value));
            }
        }
        manifest.push('\n');
    }
    fs::write(directory.join("forks"), manifest)
        .map_err(|_| "Cannot write Maven test fork settings.")?;
    wrap_invocation(invocation, &mut launch, mode)?;
    launch.test_jvm_marker = Some(marker);
    invocation.launch_file = Some(launch);
    Ok(())
}

#[cfg(unix)]
fn wrap_invocation(invocation: &mut Invocation, launch: &mut super::LaunchFile, mode: &str) -> Result<(), String> {
    let directory = launch.managed_directory().to_path_buf();
    std::fs::write(
        directory.join("ForkLauncher.java"),
        include_bytes!("maven_test_forks/ForkLauncher.java"),
    )
    .map_err(|_| "Cannot write the Maven test extension.")?;
    std::fs::write(
        directory.join("components.xml"),
        include_bytes!("maven_test_forks/components.xml"),
    )
    .map_err(|_| "Cannot write the Maven test extension descriptor.")?;
    let executable = invocation
        .executable
        .to_str()
        .ok_or("The Maven launcher path must be UTF-8.")?;
    let directory = directory
        .to_str()
        .ok_or("Maven launch storage must have a UTF-8 path.")?;
    invocation.arguments.splice(
        0..0,
        [
            launch
                .path
                .to_str()
                .ok_or("Maven launch storage must have a UTF-8 path.")?
                .to_owned(),
            executable.to_owned(),
            directory.to_owned(),
            mode.to_owned(),
        ],
    );
    invocation.executable = PathBuf::from("/bin/sh");
    Ok(())
}

#[cfg(unix)]
fn shell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
