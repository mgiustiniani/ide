//! Workspace-scoped build, test, run and debugger processes owned by the desktop.
mod java_names;
use std::fs;
use std::io::Read;
#[cfg(test)]
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;

use super::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, CurrentWorkspaceBinding,
};
use crate::app_config::workspace_registry_path;
use crate::workspace::{resolve_existing_path_in_root, resolve_new_path_in_root, workspace_root};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

const OUTPUT_LIMIT: usize = 64 * 1024;
mod attach;
mod application_input;
mod compiler_diagnostics;
mod class_changes;
mod class_reload;
mod coverage;
mod debug_test;
mod debugger_input;
mod debugger_sources;
mod flight_recording;
mod gradle_preparation;
mod maven_preparation;
pub(super) mod maven_runtime;
mod launch_settings;
mod maven_test_forks;
mod project_execution;
mod declared_jdk;
mod structured_debugger;
mod test_discovery;
mod gradle_test_methods;
mod test_results;
use super::refactorkit_daemon::{
    JavaExecutionProjectContext, JavaExecutionProjectSelection, JavaProjectContextState,
};
use launch_settings::{
    build_tool_arguments, gradle_argument_file, gradle_test_argument_file, java8_launcher,
    java_argument_file, java_arguments, java_module_argument_file, java_test_arguments,
    maven_java_launch, maven_test_argument_file, maven_testng_suite_file, validate_settings, LaunchFile,
};
use test_discovery::{DiscoveryArtifact, TestDiscovery};
use test_results::{TestResults, Tracker};
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub workspace_id: String,
    pub generation: u64,
    #[serde(default)]
    pub project_path: String,
    #[serde(default)]
    pub jdk_home: String,
    #[serde(default)]
    pub gradle_executable: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentVariable {
    pub name: String,
    pub value: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub build_tool: String,
    pub main_class: String,
    pub class_path: Vec<String>,
    #[serde(default)]
    pub launch_as_module: bool,
    #[serde(default)]
    pub project_path: String,
    #[serde(default)]
    pub working_directory: String,
    #[serde(default)]
    pub application_input: bool,
    #[serde(default)]
    pub test_filter: String,
    #[serde(default = "default_test_framework")]
    pub test_framework: String,
    #[serde(default)]
    pub test_report_paths: Vec<String>,
    #[serde(default)]
    pub program_arguments: Vec<String>,
    #[serde(default)]
    pub jvm_options: Vec<String>,
    #[serde(default)]
    pub test_jvm_options: Vec<String>,
    #[serde(default)]
    pub environment: Vec<EnvironmentVariable>,
    #[serde(default)]
    pub jdk_home: String,
    #[serde(default = "default_debugger_mode")]
    pub debugger_mode: String,
    #[serde(default)]
    pub debugger_attach: Option<attach::Target>,
}
fn default_debugger_mode() -> String {
    "jdb".into()
}
fn default_test_framework() -> String {
    "junit".into()
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub workspace_id: String,
    pub generation: u64,
    pub operation: String,
    pub configuration: Configuration,
    pub trusted: bool,
    #[serde(default)]
    pub profile: bool,
    #[serde(default)]
    pub source_breakpoints: Vec<debugger_sources::SavedBreakpoint>,
    #[serde(default)]
    pub test_selection: Option<TestSelection>,
    #[serde(default)]
    gradle_preparation: Option<super::java_language::JavaLanguageGradleSettings>,
    #[serde(default)]
    maven_preparation: Option<maven_preparation::Settings>,
    #[serde(skip)]
    testng_selection: bool,
    #[serde(skip)]
    maven_discovered_module_only: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestSelection {
    pub discovery_session_id: String,
    pub test_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlightRecordingAnalysisRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub trusted: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlightRecordingTimelineRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub trusted: bool,
    pub event_type: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlightRecordingAnalysis {
    workspace_id: String,
    generation: u64,
    session_id: String,
    profile_path: String,
    #[serde(flatten)]
    summary: flight_recording::Summary,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlightRecordingTimeline {
    workspace_id: String,
    generation: u64,
    session_id: String,
    profile_path: String,
    #[serde(flatten)]
    timeline: flight_recording::Timeline,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClassReloadBuildRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub trusted: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassReloadBuildResult {
    workspace_id: String,
    generation: u64,
    session_id: String,
    state: String,
    exit_code: i32,
    output: String,
    output_truncated: bool,
    class_changes: class_changes::Changes,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RerunRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub trusted: bool,
    #[serde(default)]
    pub source_breakpoints: Vec<debugger_sources::SavedBreakpoint>,
    #[serde(default)]
    pub debug: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestartRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub trusted: bool,
    pub source_breakpoints: Vec<debugger_sources::SavedBreakpoint>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebugRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub command: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationInputRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub session_id: String,
    pub sequence: u64,
    /// Null closes input; a string is one base64-encoded chunk of application bytes.
    pub data_base64: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationInputResult {
    workspace_id: String,
    generation: u64,
    session_id: String,
    #[serde(flatten)]
    acknowledgement: application_input::Acknowledgement,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    clean_project: bool,
    rebuild_project: bool,
    workspace_id: String,
    generation: u64,
    project_path: String,
    jdk_home: String,
    effective_jdk_home: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gradle_executable: Option<String>,
    available: bool,
    project_kind: String,
    jdk: bool,
    maven: bool,
    gradle: bool,
    debugger: bool,
    flight_recorder: bool,
    structured_debugger: bool,
    attach_debugger: bool,
    debug_tests: bool,
    debug_integration_tests: bool,
    restart_execution: bool,
    application_input: bool,
    reason: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(skip_serializing_if = "compiler_diagnostics::Report::is_empty")]
    compiler_diagnostics: compiler_diagnostics::Report,
    can_debug_failed_tests: bool,
    workspace_id: String,
    generation: u64,
    session_id: String,
    operation: String,
    state: String,
    output: String,
    output_truncated: bool,
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    test_results: Option<TestResults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    coverage: Option<coverage::CoverageResults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    test_jvm_options_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    test_discovery: Option<TestDiscovery>,
    #[serde(skip_serializing_if = "Option::is_none")]
    debugger_state: Option<structured_debugger::DebugState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    class_reload: Option<class_reload::Outcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    application_input: Option<application_input::Snapshot>,
}
struct Job {
    binding: CurrentWorkspaceBinding,
    request: Request,
    test_selections: Vec<String>,
    maven_test_projects: Option<maven_test_forks::RerunProjects>,
    project_context: Option<JavaExecutionProjectSelection>,
    snapshot: Mutex<Snapshot>,
    child: Mutex<Option<Child>>,
    test_tool_child: Mutex<Option<Child>>,
    test_listener_port: Mutex<Option<u16>>,
    cancelled: AtomicBool,
    sources: Mutex<Option<Result<debugger_sources::Sources, String>>>,
    debugger_source_roots: Mutex<Option<Vec<PathBuf>>>,
    /// Workspace output directories on the captured project runtime classpath for this JDI run.
    debugger_class_output_roots: Mutex<Option<Vec<PathBuf>>>,
    class_reload: Mutex<Option<class_reload::Pending>>,
    application_input: Option<Arc<application_input::Bridge>>,
}
#[derive(Default)]
pub struct JavaExecutionState {
    job: Mutex<Option<Arc<Job>>>,
    class_reload_build: Mutex<Option<Arc<Job>>>,
    project_context: Option<JavaExecutionProjectContext>,
}
#[derive(Debug)]
struct Invocation {
    directory: PathBuf,
    executable: PathBuf,
    arguments: Vec<String>,
    interactive: bool,
    java_home: PathBuf,
    launch_file: Option<LaunchFile>,
    discovery: Option<Arc<DiscoveryArtifact>>,
    coverage: Option<Arc<coverage::CoverageArtifact>>,
    auxiliary_files: Vec<LaunchFile>,
    profile_path: Option<String>,
    test_report_path: Option<String>,
}

fn gradle_coverage_report_arguments(
    test_arguments: &[String],
    artifact: &coverage::CoverageArtifact,
) -> Result<Vec<String>, String> {
    let mut arguments = Vec::with_capacity(test_arguments.len());
    let mut index = 0;
    while index < test_arguments.len() {
        match test_arguments[index].as_str() {
            "--init-script" | "--tests" => {
                if index + 1 >= test_arguments.len() {
                    return Err("The captured Gradle coverage arguments are incomplete.".into());
                }
                index += 2;
            }
            "--rerun-tasks" => index += 1,
            task => {
                let task_name = task
                    .trim_start_matches(':')
                    .rsplit(':')
                    .next()
                    .unwrap_or(task);
                if task_name == "test"
                    || artifact
                        .gradle_task()
                        .is_some_and(|selected| selected == task_name)
                {
                    index += 1;
                } else {
                    arguments.push(test_arguments[index].clone());
                    index += 1;
                }
            }
        }
    }
    let init_script = artifact
        .settings
        .path
        .to_str()
        .ok_or("Coverage settings path must be UTF-8.")?;
    let report_task = artifact
        .gradle_report_task()
        .ok_or("Gradle coverage report task is unavailable.")?;
    arguments.extend([
        "--init-script".into(),
        init_script.into(),
        format!(":{report_task}"),
    ]);
    Ok(arguments)
}

fn gradle_coverage_report_invocation(
    directory: &Path,
    executable: &Path,
    test_arguments: &[String],
    artifact: Arc<coverage::CoverageArtifact>,
    java_home: PathBuf,
) -> Result<Invocation, String> {
    Ok(Invocation {
        directory: directory.to_path_buf(),
        executable: executable.to_path_buf(),
        arguments: gradle_coverage_report_arguments(test_arguments, &artifact)?,
        interactive: false,
        java_home,
        launch_file: None,
        discovery: None,
        coverage: Some(artifact),
        auxiliary_files: vec![],
        profile_path: None,
        test_report_path: None,
    })
}

fn authorize(
    window: &WebviewWindow,
    workspace_id: &str,
    generation: u64,
) -> Result<CurrentWorkspaceBinding, String> {
    if window.label() != "main" || generation == 0 || generation > 9_007_199_254_740_991 {
        return Err("Java execution is restricted to the active main workspace.".into());
    }
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != workspace_id {
        return Err("The Java workspace changed.".into());
    }
    Ok(binding)
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    }
}
fn on_path(name: &str) -> Option<PathBuf> {
    let executable = executable_name(name);
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join(&executable))
            .find(|candidate| candidate.is_file())
    })
}
fn jdk_home() -> Option<PathBuf> {
    let valid = |home: &Path| {
        home.join("bin").join(executable_name("java")).is_file()
            && home.join("bin").join(executable_name("javac")).is_file()
    };
    for variable in ["IDE_JAVA_HOME", "JAVA_HOME"] {
        if let Some(home) = std::env::var_os(variable).map(PathBuf::from) {
            if valid(&home) {
                return home.canonicalize().ok();
            }
        }
    }
    // PATH may contain launcher scripts, so resolving the executable alone does
    // not identify the JDK. Read the documented java.home runtime property.
    let mut child = Command::new(on_path("java")?)
        .args(["-XshowSettings:properties", "-version"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let stderr = child.stderr.take()?;
    let reader = thread::spawn(move || {
        let mut output = Vec::new();
        let _ = stderr.take(64 * 1024).read_to_end(&mut output);
        String::from_utf8_lossy(&output).into_owned()
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return None;
            }
        }
    }
    reader.join().ok()?.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        let home = PathBuf::from(value.trim());
        (key.trim() == "java.home" && valid(&home)).then_some(home)
    })
}
fn tool(name: &str) -> Option<PathBuf> {
    if ["java", "javac", "jdb"].contains(&name) {
        let path = jdk_home()?.join("bin").join(executable_name(name));
        return path.is_file().then_some(path);
    }
    on_path(name)
}
fn selected_jdk(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() {
        return jdk_home().ok_or_else(|| "No full JDK is available.".into());
    }
    if value.len() > 4096 || value.contains(['\0', '\r', '\n']) || !Path::new(value).is_absolute() {
        return Err("Choose an absolute full-JDK directory.".into());
    }
    let home = Path::new(value)
        .canonicalize()
        .map_err(|_| "The selected JDK directory is unavailable.")?;
    if !["java", "javac"]
        .iter()
        .all(|name| home.join("bin").join(executable_name(name)).is_file())
    {
        return Err("The selected directory must contain a full JDK with java and javac.".into());
    }
    Ok(home)
}
fn project_kind(root: &Path) -> &'static str {
    if root.join("pom.xml").is_file() {
        "maven"
    } else if root.join("build.gradle").is_file() || root.join("build.gradle.kts").is_file() {
        "gradle"
    } else {
        "jdk"
    }
}
fn workspace_wrapper(root: &Path, workspace: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    // Project wrappers are executable code. They are launched only after explicit trust.
    #[cfg(unix)]
    {
        for directory in root
            .ancestors()
            .take_while(|directory| directory.starts_with(workspace))
        {
            let wrapper = directory.join(if name == "mvn" { "mvnw" } else { "gradlew" });
            if wrapper.is_file() {
                return resolve_existing_path_in_root(workspace, &wrapper).map(Some);
            }
        }
    }
    Ok(None)
}
fn build_tool(root: &Path, workspace: &Path, name: &str) -> Option<PathBuf> {
    match workspace_wrapper(root, workspace, name) {
        Ok(Some(wrapper)) => Some(wrapper),
        Ok(None) => tool(name),
        Err(_) => None,
    }
}
fn selected_gradle(root: &Path, workspace: &Path, selection: Option<&str>) -> Result<PathBuf, String> {
    configured_gradle(root, workspace, selection)?.or_else(|| tool("gradle"))
        .ok_or_else(|| "Gradle is unavailable.".into())
}
fn configured_gradle(root: &Path, workspace: &Path, selection: Option<&str>) -> Result<Option<PathBuf>, String> {
    if let Some(wrapper) = workspace_wrapper(root, workspace, "gradle")? { return Ok(Some(wrapper)); }
    if let Some(value) = selection.filter(|value| !value.is_empty()) {
        if value.len() > 4096 || value.contains('\0') || !Path::new(value).is_absolute() {
            return Err("Choose an absolute Gradle executable path.".into());
        }
        let executable = Path::new(value).canonicalize()
            .map_err(|_| "The selected Gradle executable is unavailable.")?;
        if !executable.is_file() { return Err("Select an existing Gradle executable.".into()); }
        return Ok(Some(executable));
    }
    Ok(None)
}
fn execution_root(workspace: &Path, project_path: &str) -> Result<PathBuf, String> {
    if project_path.len() > 4096
        || project_path.contains('\0')
        || Path::new(project_path).is_absolute()
    {
        return Err("Choose a workspace-relative Java project directory.".into());
    }
    let root = resolve_existing_path_in_root(
        workspace,
        if project_path.is_empty() {
            "."
        } else {
            project_path
        },
    )?;
    if !root.is_dir() {
        return Err("The Java project path must be a directory.".into());
    }
    Ok(root)
}
#[cfg(test)]
fn capabilities(
    binding: &CurrentWorkspaceBinding,
    generation: u64,
    project_path: &str,
    jdk_selection: &str,
) -> Result<Capabilities, String> {
    capabilities_selected(binding, generation, project_path, jdk_selection, None)
}
fn capabilities_selected(
    binding: &CurrentWorkspaceBinding, generation: u64, project_path: &str,
    jdk_selection: &str, gradle_selection: Option<&str>,
) -> Result<Capabilities, String> {
    let workspace = &binding.canonical_root;
    let root = execution_root(workspace, project_path)?;
    let home = selected_jdk(jdk_selection);
    let jdk = home.is_ok();
    let maven = build_tool(&root, workspace, "mvn").is_some();
    let gradle = selected_gradle(&root, workspace, gradle_selection).is_ok();
    let kind = project_kind(&root);
    let debugger_host_available = home
        .as_ref()
        .is_ok_and(|home| structured_debugger::launch_home(home).is_some());
    let available = jdk
        && match kind {
            "maven" => maven,
            "gradle" => gradle,
            _ => true,
        };
    Ok(Capabilities {
        clean_project: true,
        rebuild_project: true,
        workspace_id: binding.workspace_id.clone(),
        generation,
        project_path: project_path.into(),
        gradle_executable: gradle_selection.map(str::to_owned),
        jdk_home: jdk_selection.into(),
        effective_jdk_home: home
            .as_ref()
            .ok()
            .map(|home| home.to_string_lossy().into_owned()),
        available,
        project_kind: kind.into(),
        jdk,
        maven,
        gradle,
        debugger: cfg!(unix)
            && home
                .as_ref()
                .is_ok_and(|home| home.join("bin").join(executable_name("jdb")).is_file()),
        structured_debugger: debugger_host_available,
        flight_recorder: home
            .as_ref()
            .is_ok_and(|home| flight_recording::available(home)),
        attach_debugger: home
            .as_ref()
            .is_ok_and(|home| structured_debugger::available(home)),
        debug_tests: debugger_host_available,
        debug_integration_tests: maven && debugger_host_available,
        restart_execution: true,
        application_input: home.as_ref().is_ok_and(|home| application_input::available(home)),
        reason: home.err().or_else(|| {
            (!available).then(|| "Install the project's Maven or Gradle tool/wrapper.".into())
        }),
    })
}

fn application_directory(workspace: &Path, project: &Path, configuration: &Configuration) -> Result<PathBuf, String> {
    if configuration.working_directory.is_empty() { return Ok(project.to_path_buf()); }
    execution_root(workspace, &configuration.working_directory)
        .map_err(|_| "Choose an existing application working directory inside the active workspace.".into())
}

fn collect_sources(
    root: &Path,
    directory: &Path,
    paths: &mut Vec<String>,
    visited: &mut usize,
    depth: usize,
) -> Result<(), String> {
    collect_sources_with_policy(root, directory, paths, visited, depth, false)
}

fn collect_sources_with_policy(
    root: &Path,
    directory: &Path,
    paths: &mut Vec<String>,
    visited: &mut usize,
    depth: usize,
    explicit_roots: bool,
) -> Result<(), String> {
    if depth > 32 {
        return Err("Java source traversal is too deep.".into());
    }
    for entry in fs::read_dir(directory).map_err(|e| format!("Cannot list Java sources: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        *visited += 1;
        if *visited > 20_000 {
            return Err("Too many files for a plain-JDK build; use Maven or Gradle.".into());
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            if explicit_roots {
                return Err("Explicit debugger source roots must not contain symbolic links.".into());
            }
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            if explicit_roots || ![
                ".git",
                ".ide",
                ".refactorkit",
                "node_modules",
                "target",
                "build",
                "dist",
            ]
            .contains(&entry.file_name().to_string_lossy().as_ref())
            {
                collect_sources_with_policy(root, &path, paths, visited, depth + 1, explicit_roots)?;
            }
        } else if path
            .extension()
            .is_some_and(|extension| extension == "java")
        {
            let canonical = resolve_existing_path_in_root(root, &path)?;
            paths.push(canonical.to_string_lossy().into_owned());
            if paths.len() > 2000 {
                return Err("Too many Java sources for a plain-JDK build.".into());
            }
        }
    }
    Ok(())
}

fn jdk_test_report_directory(project: &Path) -> Result<PathBuf, String> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Cannot identify the Java test run.")?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let canonical_project = project
        .canonicalize()
        .map_err(|_| "The Java project directory is unavailable.")?;
    let mut parent = canonical_project.clone();
    for component in [".ide", "java", "test-results"] {
        parent.push(component);
        match fs::symlink_metadata(&parent) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err("Java test report storage contains a non-directory or symlink.".into())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                match builder.create(&parent) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                        let metadata = fs::symlink_metadata(&parent)
                            .map_err(|_| "Java test report storage changed during creation.")?;
                        if !metadata.is_dir() || metadata.file_type().is_symlink() {
                            return Err(
                                "Java test report storage contains a non-directory or symlink."
                                    .into(),
                            );
                        }
                    }
                    Err(_) => return Err("Cannot prepare Java test report storage.".into()),
                }
            }
            Err(_) => return Err("Cannot inspect Java test report storage.".into()),
        }
        let canonical_parent = parent
            .canonicalize()
            .map_err(|_| "Java test report storage is unavailable.")?;
        if canonical_parent != parent || !canonical_parent.starts_with(&canonical_project) {
            return Err(
                "Java test report storage must stay inside the project without symlinks.".into(),
            );
        }
    }
    let directory = parent.join(format!("run-{token}"));
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|_| "Cannot create private Java test report storage.")?;
    let canonical = directory
        .canonicalize()
        .map_err(|_| "Java test report storage is unavailable.")?;
    if canonical != directory {
        let _ = fs::remove_dir(&directory);
        return Err("Java test report storage changed during creation.".into());
    }
    if !canonical.starts_with(&canonical_project) {
        let _ = fs::remove_dir(&directory);
        return Err("Java test report storage must remain inside the selected project.".into());
    }
    Ok(canonical)
}

fn jdk_test_invocation(
    workspace: &Path,
    project: &Path,
    home: &Path,
    java: &Path,
    classes: &Path,
    extra_classpath: &[PathBuf],
    options: &[String],
    filter: &str,
    selections: &[String],
    declared_runtime: Option<&[PathBuf]>,
) -> Result<Invocation, String> {
    let selectors = if selections.is_empty() {
        if filter.is_empty() {
            Vec::new()
        } else {
            vec![filter.to_owned()]
        }
    } else {
        selections.to_vec()
    };
    if selectors.len() > 256 {
        return Err("Too many Java test selections.".into());
    }
    for selector in &selectors {
        let (class, method) = selector
            .split_once('#')
            .map_or((selector.as_str(), None), |(class, method)| {
                (class, Some(method))
            });
        if !main_class(class)
            || method.is_some_and(|name| !main_class(name) || name.contains('.'))
            || selector.contains('*')
        {
            return Err(
                "Plain-JDK JUnit selection needs a class or class#method without wildcards.".into(),
            );
        }
    }
    let report_directory = jdk_test_report_directory(project)?;
    let report_path = report_directory
        .strip_prefix(workspace)
        .map_err(|_| "Java test report storage must remain inside the workspace.")?
        .to_str()
        .ok_or("Java test report paths must be UTF-8.")?
        .replace('\\', "/");
    let report_directory_text = report_directory
        .to_str()
        .ok_or("Java test report paths must be UTF-8.")?;
    let classpath = declared_runtime.map(Vec::from).unwrap_or_else(||
        std::iter::once(classes.to_path_buf()).chain(extra_classpath.iter().cloned()).collect());
    let classpath = std::env::join_paths(classpath)
        .map_err(|_| "The JUnit runtime classpath cannot be represented on this platform.")?
        .into_string()
        .map_err(|_| "The JUnit runtime classpath must be UTF-8.")?;
    let mut arguments = vec![
        "--disable-banner".into(),
        "--disable-ansi-colors".into(),
        "--fail-if-no-tests".into(),
        "--details=tree".into(),
        format!("--reports-dir={report_directory_text}"),
    ];
    if selectors.is_empty() {
        arguments.push(format!(
            "--scan-class-path={}",
            classes.to_str().ok_or("Java class paths must be UTF-8.")?
        ));
    } else {
        for selector in selectors {
            if selector.contains('#') {
                arguments.extend(["--select-method".into(), selector]);
            } else {
                arguments.extend(["--select-class".into(), selector]);
            }
        }
    }
    let (arguments, launch_file) = java_test_arguments(
        home,
        options,
        "org.junit.platform.console.ConsoleLauncher",
        &arguments,
        &classpath,
    )?;
    Ok(Invocation {
        directory: project.to_path_buf(),
        executable: java.to_path_buf(),
        arguments,
        interactive: false,
        java_home: home.to_path_buf(),
        launch_file,
        discovery: None,
        coverage: None,
        auxiliary_files: vec![],
        profile_path: None,
        test_report_path: Some(report_path),
    })
}

fn jdk_testng_invocations(
    workspace: &Path,
    project: &Path,
    home: &Path,
    java: &Path,
    classes: &Path,
    extra_classpath: &[PathBuf],
    options: &[String],
    filter: &str,
    selections: &[String],
    declared_runtime: Option<&[PathBuf]>,
) -> Result<Vec<Invocation>, String> {
    let selectors = if selections.is_empty() {
        if filter.is_empty() {
            Vec::new()
        } else {
            vec![filter.to_owned()]
        }
    } else {
        selections.to_vec()
    };
    if selectors.len() > 256 {
        return Err("Too many Java test selections.".into());
    }
    for selector in &selectors {
        let (class, method) = selector
            .split_once('#')
            .map_or((selector.as_str(), None), |(class, method)| {
                (class, Some(method))
            });
        if !main_class(class)
            || method.is_some_and(|name| !main_class(name) || name.contains('.'))
            || selector.contains('*')
        {
            return Err(
                "Plain-JDK TestNG selection needs a class or class#method without wildcards."
                    .into(),
            );
        }
    }
    let classpath = declared_runtime.map(Vec::from).unwrap_or_else(||
        std::iter::once(classes.to_path_buf()).chain(extra_classpath.iter().cloned()).collect());
    let classpath = std::env::join_paths(classpath)
        .map_err(|_| "The TestNG runtime classpath cannot be represented on this platform.")?
        .into_string()
        .map_err(|_| "The TestNG runtime classpath must be UTF-8.")?;
    let mut invocations = Vec::new();
    if selectors.is_empty() {
        let report_directory = jdk_test_report_directory(project)?;
        let report_path = report_directory
            .strip_prefix(workspace)
            .map_err(|_| "Java test report storage must remain inside the workspace.")?
            .to_str()
            .ok_or("Java test report paths must be UTF-8.")?
            .replace('\\', "/");
        let report_directory_text = report_directory
            .to_str()
            .ok_or("Java test report paths must be UTF-8.")?;
        let archive = report_directory.join("compiled-tests.jar");
        let jar = home.join("bin").join(executable_name("jar"));
        if !jar.is_file() {
            return Err("Plain-JDK TestNG execution requires the selected JDK jar tool.".into());
        }
        let mut archive_arguments = if java8_launcher(home) {
            vec!["cf".into()]
        } else {
            vec!["--create".into(), "--file".into()]
        };
        archive_arguments.extend([
            archive.to_str().ok_or("Java test paths must be UTF-8.")?.into(),
            "-C".into(),
            classes.to_str().ok_or("Java class paths must be UTF-8.")?.into(),
            ".".into(),
        ]);
        invocations.push(Invocation {
            directory: project.to_path_buf(),
            executable: jar,
            arguments: archive_arguments,
            interactive: false,
            java_home: home.to_path_buf(),
            launch_file: None,
            discovery: None,
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: None,
        });
        let arguments = vec![
            "-d".into(),
            report_directory_text.into(),
            "-testjar".into(),
            archive
                .to_str()
                .ok_or("Java test paths must be UTF-8.")?
                .into(),
            "-listener".into(),
            "org.testng.reporters.JUnitXMLReporter".into(),
        ];
        let (arguments, launch_file) =
            java_test_arguments(home, options, "org.testng.TestNG", &arguments, &classpath)?;
        invocations.push(Invocation {
            directory: project.to_path_buf(),
            executable: java.to_path_buf(),
            arguments,
            interactive: false,
            java_home: home.to_path_buf(),
            launch_file,
            discovery: None,
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: Some(report_path),
        });
        return Ok(invocations);
    }
    for selector in selectors {
        let report_directory = jdk_test_report_directory(project)?;
        let report_path = report_directory
            .strip_prefix(workspace)
            .map_err(|_| "Java test report storage must remain inside the workspace.")?
            .to_str()
            .ok_or("Java test report paths must be UTF-8.")?
            .replace('\\', "/");
        let mut arguments = vec![
            "-d".into(),
            report_directory
                .to_str()
                .ok_or("Java test report paths must be UTF-8.")?
                .into(),
            "-listener".into(),
            "org.testng.reporters.JUnitXMLReporter".into(),
        ];
        if let Some((class, method)) = selector.split_once('#') {
            arguments.extend(["-methods".into(), format!("{class}.{method}")]);
        } else {
            arguments.extend(["-testclass".into(), selector]);
        }
        let (arguments, launch_file) =
            java_test_arguments(home, options, "org.testng.TestNG", &arguments, &classpath)?;
        invocations.push(Invocation {
            directory: project.to_path_buf(),
            executable: java.to_path_buf(),
            arguments,
            interactive: false,
            java_home: home.to_path_buf(),
            launch_file,
            discovery: None,
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: Some(report_path),
        });
    }
    Ok(invocations)
}

fn main_class(value: &str) -> bool {
    java_names::binary_name(value)
}
fn test_filter(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    if value.len() > 512 || value.matches('#').count() > 1 {
        return false;
    }
    value.split('#').all(|part| {
        !part.is_empty()
            && part.split('.').all(|segment| {
                java_names::pattern_segment(segment)
            })
    })
}
#[cfg(test)]
fn invocation(root: &Path, request: &Request) -> Result<Vec<Invocation>, String> {
    invocation_selected(root, request, &[], false, None, None)
}
fn invocation_selected(
    root: &Path,
    request: &Request,
    selections: &[String],
    rerun: bool,
    project_test_source_set: Option<&str>,
    project_module_root: Option<&Path>,
) -> Result<Vec<Invocation>, String> {
    invocation_selected_with_settings(root, request, selections, rerun, project_test_source_set, project_module_root, InvocationSettings::default())
}
#[derive(Default)]
struct InvocationSettings<'a> {
    maven_fork_launcher: bool,
    application_input: Option<&'a str>,
    build_tool_executable: Option<&'a Path>,
    gradle_target_build_root: Option<&'a Path>,
    declared_jdk: Option<&'a crate::commands::refactorkit_daemon::DeclaredJdkCompilation>,
    declared_jdk_runtime_classpath: Option<&'a [PathBuf]>,
}
fn prepend_clean_to_build(steps: &mut [Invocation], build_tool: &str, gradle_project_path: Option<&str>) -> Result<(), String> {
    if steps.len() != 1 { return Err("Rebuild requires one build-tool compilation invocation.".into()); }
    let arguments = &mut steps[0].arguments;
    let (position, clean) = match build_tool {
        "maven" => (arguments.iter().position(|argument| ["compile", "test-compile"].contains(&argument.as_str()))
            .ok_or("Rebuild requires a mapped Maven compilation phase.")?, "clean".into()),
        "gradle" => (arguments.iter().position(|argument| !argument.starts_with('-'))
            .ok_or("Rebuild requires a mapped Gradle compilation task.")?,
            gradle_project_path.map(|path| if path == ":" { ":clean".into() } else { format!("{path}:clean") }).unwrap_or_else(|| "clean".into())),
        _ => return Err("Rebuild requires a Maven or Gradle project.".into()),
    };
    arguments.insert(position, clean);
    Ok(())
}
fn invocation_selected_with_settings(
    root: &Path, request: &Request, selections: &[String], rerun: bool,
    project_test_source_set: Option<&str>, project_module_root: Option<&Path>,
    settings: InvocationSettings<'_>,
) -> Result<Vec<Invocation>, String> {
    if !request.trusted {
        return Err("Confirm workspace trust before running project code or build plugins.".into());
    }
    if request.operation == "prepare-gradle" {
        return gradle_preparation::plan(root, request).map(|step| vec![step]);
    }
    if request.operation == "prepare-maven" {
        return maven_preparation::plan(root, request).map(|step| vec![step]);
    }
    let mut planned;
    let request = if debug_test::is_debug(&request.operation) {
        debug_test::validate(request, selections)?;
        planned = request.clone();
        planned.operation = debug_test::test_operation(&request.operation).into();
        &planned
    } else { request };
    if ["debug", "attach"].contains(&request.operation.as_str()) && !cfg!(unix) {
        return Err("Java debugging requires Unix process-group ownership in this release.".into());
    }
    let config = &request.configuration;
    validate_settings(config, &request.operation)?;
    if request.profile && request.operation != "run" {
        return Err("Java Flight Recorder profiling is available only for application Run.".into());
    }
    if request.profile
        && request
            .configuration
            .jvm_options
            .iter()
            .any(|option| option.starts_with("-XX:StartFlightRecording"))
    {
        return Err(
            "Remove the custom StartFlightRecording option before using Run with JFR.".into(),
        );
    }
    if request.profile
        && !flight_recording::available(&selected_jdk(&request.configuration.jdk_home)?)
    {
        return Err("Run with JFR requires JDK 11 or later with Flight Recorder support.".into());
    }
    if request.profile
        && config
            .jvm_options
            .iter()
            .any(|option| option.starts_with("-XX:StartFlightRecording"))
    {
        return Err(
            "Remove the custom StartFlightRecording option before using Run with JFR.".into(),
        );
    }
    if request.operation == "attach" {
        if !selections.is_empty() || rerun || !request.source_breakpoints.is_empty() {
            return Err(
                "Attach does not admit test selections or unverified local source breakpoints."
                    .into(),
            );
        }
        return Ok(vec![attach::invocation(root, config)?]);
    }
    if selections.len() > 256
        || selections
            .iter()
            .any(|value| value.is_empty() || !test_filter(value))
        || (!selections.is_empty()
            && ![
                "test",
                "integration-test",
                "integration-coverage",
                "coverage",
            ]
            .contains(&request.operation.as_str()))
    {
        return Err("Invalid Java test rerun selections.".into());
    }
    if config.test_report_paths.len() > 16 {
        return Err("Too many test report directories.".into());
    }
    for path in &config.test_report_paths {
        if path.is_empty()
            || path.len() > 4096
            || Path::new(path).is_absolute()
            || path.contains(['\\', '\0'])
            || path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err("Use workspace-relative test report directory paths.".into());
        }
        resolve_new_path_in_root(root, path)?;
    }
    if [
        "test",
        "integration-test",
        "integration-coverage",
        "coverage",
    ]
    .contains(&request.operation.as_str())
        && !test_filter(&config.test_filter)
    {
        return Err("Enter a test class or class#method; only name characters and * wildcards are supported.".into());
    }
    let workspace = root;
    let directory = execution_root(workspace, &config.project_path)?;
    let application_directory = if ["run", "debug"].contains(&request.operation.as_str()) {
        application_directory(workspace, &directory, config)?
    } else { directory.clone() };
    let mut adjusted_config = config.clone();
    if let Some(option) = settings.application_input { adjusted_config.jvm_options.push(option.into()); }
    let profile = if request.profile {
        let home = selected_jdk(&config.jdk_home)?;
        if !flight_recording::available(&home) {
            return Err(
                "Run with JFR requires JDK 11 or later with Flight Recorder support.".into(),
            );
        }
        let recording =
            flight_recording::FlightRecording::create(workspace, &directory, &config.project_path, &application_directory)?;
        adjusted_config
            .jvm_options
            .push(recording.jvm_option.clone());
        Some(recording)
    } else {
        None
    };
    let config = &adjusted_config;
    let root = directory.as_path();
    let kind = if config.build_tool == "auto" {
        project_kind(root)
    } else {
        &config.build_tool
    };
    if kind == "jdk"
        && request.operation == "test"
        && !["junit", "testng"].contains(&config.test_framework.as_str())
    {
        return Err("Choose JUnit or TestNG for plain-JDK test execution.".into());
    }
    if !["jdk", "maven", "gradle"].contains(&kind)
        || ![
            "clean",
            "rebuild",
            "build",
            "run",
            "test",
            "integration-test",
            "integration-coverage",
            "coverage",
            "debug",
            "discover",
        ]
        .contains(&request.operation.as_str())
    {
        return Err("Unsupported Java execution operation or build tool.".into());
    }
    if ["clean", "rebuild"].contains(&request.operation.as_str()) && kind == "jdk" {
        return Err(format!("{} requires a Maven or Gradle project.", if request.operation == "clean" { "Clean" } else { "Rebuild" }));
    }
    if request.operation == "rebuild" {
        let mut build = request.clone();
        build.operation = "build".into();
        let mut steps = invocation_selected_with_settings(workspace, &build, selections, rerun,
            project_test_source_set, project_module_root, settings)?;
        prepend_clean_to_build(&mut steps, kind, None)?;
        return Ok(steps);
    }
    if ["integration-test", "integration-coverage"].contains(&request.operation.as_str())
        && kind != "maven"
    {
        return Err("Maven Failsafe integration tests require a Maven project.".into());
    }
    if ["run", "debug"].contains(&request.operation.as_str())
        && kind != "gradle"
        && !main_class(&config.main_class)
    {
        return Err("Enter a fully qualified Java main class.".into());
    }
    if request.operation == "debug" && !main_class(&config.main_class) {
        return Err("Enter a Java main class for debugging.".into());
    }
    if config.class_path.len() > 64 {
        return Err("Too many runtime classpath entries.".into());
    }
    let extra = config
        .class_path
        .iter()
        .map(|path| {
            if path.len() > 4096 {
                return Err("Classpath entry is too long.".into());
            }
            resolve_existing_path_in_root(workspace, path)
        })
        .collect::<Result<Vec<_>, String>>()?;
    let declared_runtime = settings.declared_jdk_runtime_classpath.map(|provided| {
        let mut paths = provided.to_vec();
        for path in &extra { if !paths.contains(path) { paths.push(path.clone()); } }
        paths
    });
    let home = selected_jdk(&config.jdk_home)?;
    let javac = home.join("bin").join(executable_name("javac"));
    let java = home.join("bin").join(executable_name("java"));
    let mut plan = Vec::new();
    let integration_test_coverage = request.operation == "integration-coverage";
    let coverage = if ["coverage", "integration-coverage"].contains(&request.operation.as_str()) {
        let coverage_selectors = if selections.is_empty() {
            if config.test_filter.is_empty() {
                Vec::new()
            } else {
                vec![config.test_filter.clone()]
            }
        } else {
            selections.to_vec()
        };
        Some(Arc::new(coverage::CoverageArtifact::create(
            workspace,
            root,
            &config.project_path,
            kind,
            project_test_source_set,
            &config.test_jvm_options,
            &coverage_selectors,
            integration_test_coverage,
            project_module_root,
        )?))
    } else {
        None
    };
    let classes;
    match kind {
        "maven" => {
            classes = root.join("target/classes");
            let executable = build_tool(root, workspace, "mvn").ok_or("Maven is unavailable.")?;
            let mut args = vec!["-B".into(), "-Dstyle.color=never".into()];
            if request.operation == "discover" || request.maven_discovered_module_only {
                args.push("--non-recursive".into());
            }
            args.extend(match request.operation.as_str() {
                "clean" => vec!["clean".into()],
                "discover" => vec![
                    "test-compile".into(),
                    "org.codehaus.mojo:exec-maven-plugin:3.5.0:exec".into(),
                    format!("-Dexec.executable={}", java.display()),
                    "-Dexec.classpathScope=test".into(),
                ],
                "run" if !config.program_arguments.is_empty() || !config.jvm_options.is_empty() || !config.working_directory.is_empty() => {
                    vec![
                        "compile".into(),
                        "exec:exec".into(),
                        format!("-Dexec.executable={}", java.display()),
                    ]
                }
                "run" => vec![
                    "compile".into(),
                    "exec:java".into(),
                    format!("-Dexec.mainClass={}", config.main_class),
                ],
                "test" => vec!["test".into()],
                "integration-test" => vec!["verify".into()],
                "coverage" | "integration-coverage" => vec![
                    format!(
                        "org.jacoco:jacoco-maven-plugin:{}:{}",
                        coverage::VERSION,
                        coverage.as_ref().unwrap().maven_prepare_goal()
                    ),
                    if request.operation == "integration-coverage" {
                        "verify".into()
                    } else {
                        "test".into()
                    },
                ],
                _ => vec!["compile".into()],
            });
            if let Some(artifact) = &coverage {
                args.extend(artifact.maven_properties(!config.test_jvm_options.is_empty()));
                if request.operation == "coverage" {
                    args.push("-DfailIfNoTests=true".into());
                }
            }
            let filter = if selections.is_empty() {
                config.test_filter.clone()
            } else {
                selections.join(",")
            };
            let mut auxiliary_files = Vec::new();
            if ["test", "coverage", "integration-coverage"].contains(&request.operation.as_str())
                && request.testng_selection
            {
                let selected = if selections.is_empty() {
                    vec![filter.clone()]
                } else {
                    selections.to_vec()
                };
                let file = maven_testng_suite_file(&selected)?;
                let path = file
                    .path
                    .to_str()
                    .ok_or("TestNG suite storage must have a UTF-8 path.")?;
                if path.contains(',') {
                    return Err(
                        "TestNG suite storage contains an unsupported list separator.".into(),
                    );
                }
                let suite_property = if request.operation == "integration-coverage" {
                    "failsafe.suiteXmlFiles"
                } else {
                    "surefire.suiteXmlFiles"
                };
                args.extend([
                    format!("-D{suite_property}={path}"),
                    if request.operation == "integration-coverage" {
                        "-Dfailsafe.failIfNoSpecifiedTests=false".into()
                    } else {
                        "-DfailIfNoTests=true".into()
                    },
                ]);
                auxiliary_files.push(file);
            } else if ["integration-test", "integration-coverage"]
                .contains(&request.operation.as_str())
                && !filter.is_empty()
            {
                args.extend([
                    format!("-Dit.test={filter}"),
                    "-Dit.failIfNoSpecifiedTests=false".into(),
                    "-Dfailsafe.failIfNoSpecifiedTests=false".into(),
                ]);
            } else if ["test", "coverage", "integration-coverage"]
                .contains(&request.operation.as_str())
                && !filter.is_empty()
            {
                args.extend([
                    format!("-Dtest={filter}"),
                    "-Dsurefire.failIfNoSpecifiedTests=true".into(),
                    "-DfailIfNoTests=true".into(),
                ]);
            }
            if request.operation == "run" && !config.working_directory.is_empty() {
                args.push(format!("-Dexec.workingdir={}", application_directory.to_str().ok_or("Application working directory must be UTF-8.")?));
            }
            let discovery = if request.operation == "discover" {
                Some(Arc::new(DiscoveryArtifact::create(
                    workspace,
                    root,
                    &config.project_path,
                    kind,
                    &config.test_jvm_options,
                    None,
                    None,
                )?))
            } else {
                None
            };
            let launch_file = if let Some(artifact) = &discovery {
                let (compile_discovery, classes) = artifact.compile_invocation(&directory, &home)?;
                let (compile_launcher, launcher, file, maven_arguments) = maven_java_launch(
                    &directory, &home, "IdeTestDiscovery", &config.test_jvm_options,
                    &artifact.arguments(workspace)?, Some(&classes), true,
                )?;
                plan.extend([compile_discovery, compile_launcher]);
                auxiliary_files.push(launcher);
                args.push(format!("-Dexec.args={maven_arguments}"));
                Some(file)
            } else if request.operation == "run"
                && (!config.program_arguments.is_empty() || !config.jvm_options.is_empty() || !config.working_directory.is_empty())
            {
                let (mut file, maven_arguments) = if java8_launcher(&home) {
                    let (compile, launcher, file, maven_arguments) = maven_java_launch(
                        &directory, &home, &config.main_class, &config.jvm_options,
                        &config.program_arguments, None, false,
                    )?;
                    plan.push(compile);
                    auxiliary_files.push(launcher);
                    (file, maven_arguments)
                } else {
                    let file = java_argument_file(
                        &config.jvm_options, &config.main_class, &config.program_arguments, None,
                    )?;
                    let maven_arguments = build_tool_arguments(&[
                        "-classpath".into(), "%classpath".into(), file.argument_reference()?,
                    ]);
                    (file, maven_arguments)
                };
                if !config.working_directory.is_empty() { file.application_directory = Some(application_directory.clone()); }
                args.push(format!("-Dexec.args={maven_arguments}"));
                Some(file)
            } else if [
                "test",
                "coverage",
                "integration-test",
                "integration-coverage",
            ]
            .contains(&request.operation.as_str())
                && !config.test_jvm_options.is_empty()
                && project_test_source_set.is_none()
                && !settings.maven_fork_launcher
            {
                let file = maven_test_argument_file(&config.test_jvm_options)?;
                args.push(format!(
                    "-DargLine={}",
                    if coverage.is_some() {
                        format!(
                            "@{{ide.coverage.agent}} {}",
                            build_tool_arguments(&[file.argument_reference()?])
                        )
                    } else {
                        build_tool_arguments(&[file.argument_reference()?])
                    }
                ));
                Some(file)
            } else {
                None
            };
            if request.operation == "run" && !config.working_directory.is_empty() {
                plan.push(Invocation {
                    directory: directory.clone(), executable: executable.clone(),
                    arguments: vec!["-B".into(), "-Dstyle.color=never".into(), "compile".into()],
                    interactive: false, java_home: home.clone(), launch_file: None,
                    discovery: None, coverage: None, auxiliary_files: vec![], profile_path: None, test_report_path: None,
                });
                args.retain(|argument| argument != "compile");
            }
            plan.push(Invocation {
                directory: directory.clone(),
                executable,
                arguments: args,
                interactive: false,
                java_home: home.clone(),
                launch_file,
                discovery,
                coverage: coverage.clone(),
                auxiliary_files,
                profile_path: None,
                test_report_path: None,
            });
        }
        "gradle" => {
            classes = root.join("build/classes/java/main");
            let executable =
                settings.build_tool_executable.map(Path::to_path_buf)
                    .or_else(|| build_tool(root, workspace, "gradle")).ok_or("Gradle is unavailable.")?;
            let task = match request.operation.as_str() {
                "clean" => "clean",
                "run" => "run",
                "test" | "coverage" | "discover" => "test",
                _ => "classes",
            };
            let mut arguments = vec!["--no-daemon".into(), "--console=plain".into(), task.into()];
            let discovery = if request.operation == "discover" {
                let artifact = Arc::new(DiscoveryArtifact::create(
                    workspace,
                    root,
                    &config.project_path,
                    kind,
                    &config.test_jvm_options,
                    project_test_source_set,
                    settings.gradle_target_build_root,
                )?);
                arguments.extend([
                    "--init-script".into(),
                    artifact
                        .source
                        .path
                        .to_str()
                        .ok_or("Test discovery paths must be UTF-8.")?
                        .into(),
                    "--rerun-tasks".into(),
                ]);
                Some(artifact)
            } else {
                None
            };
            let launch_file = if request.operation == "run"
                && (!config.program_arguments.is_empty() || !config.jvm_options.is_empty() || !config.working_directory.is_empty())
            {
                let selection = workspace.join(&config.working_directory);
                let file = gradle_argument_file(root, &config.program_arguments, &config.jvm_options,
                    (!config.working_directory.is_empty()).then_some((application_directory.as_path(), selection.as_path())))?;
                arguments.extend([
                    "--init-script".into(),
                    file.path
                        .to_str()
                        .ok_or("Java launch storage must have a UTF-8 path.")?
                        .into(),
                ]);
                Some(file)
            } else if ["test", "coverage"].contains(&request.operation.as_str())
                && !config.test_jvm_options.is_empty()
                && project_test_source_set.is_none()
            {
                let file = gradle_test_argument_file(root, &config.test_jvm_options, settings.gradle_target_build_root)?;
                arguments.extend([
                    "--init-script".into(),
                    file.path
                        .to_str()
                        .ok_or("Java launch storage must have a UTF-8 path.")?
                        .into(),
                ]);
                Some(file)
            } else {
                None
            };
            if let Some(artifact) = &coverage {
                arguments.extend([
                    "--init-script".into(),
                    artifact
                        .settings
                        .path
                        .to_str()
                        .ok_or("Coverage settings path must be UTF-8.")?
                        .into(),
                    "--rerun-tasks".into(),
                ]);
            }
            if ["test", "coverage"].contains(&request.operation.as_str()) {
                // An explicit test action must execute tests again, even when the
                // inputs match an earlier successful run. Cached reports are not
                // fresh results for this session. Coverage already adds this flag.
                if coverage.is_none() {
                    arguments.push("--rerun-tasks".into());
                }
                if selections.is_empty() {
                    if !config.test_filter.is_empty() {
                        arguments.extend(["--tests".into(), config.test_filter.replace('#', ".")]);
                    }
                } else {
                    for filter in selections {
                        arguments.extend(["--tests".into(), filter.replace('#', ".")]);
                    }
                }
            }
            plan.push(Invocation {
                directory: directory.clone(),
                executable,
                arguments,
                interactive: false,
                java_home: home.clone(),
                launch_file,
                discovery,
                coverage: coverage.clone(),
                auxiliary_files: vec![],
                profile_path: None,
                test_report_path: None,
            });
        }
        _ => {
            if ["coverage"].contains(&request.operation.as_str()) {
                return Err(
                    "Plain-JDK coverage needs build-tool instrumentation and is unavailable. Use Maven or Gradle."
                        .into(),
                );
            }
            let sources;
            if let Some(declaration) = settings.declared_jdk {
                (classes, sources) = declared_jdk::inputs(workspace, declaration)?;
            } else {
                classes = resolve_new_path_in_root(root, ".ide/java/classes")?;
                let mut collected=Vec::new();
                collect_sources(root,root,&mut collected,&mut 0,0)?;
                collected.sort();sources=collected;
            }
            if sources.is_empty() {
                return Err("No Java source files were found.".into());
            }
            fs::create_dir_all(&classes)
                .map_err(|e| format!("Cannot prepare Java classes: {e}"))?;
            let mut args = vec![
                "-encoding".into(),
                "UTF-8".into(),
                "-g".into(),
                "-d".into(),
                classes.to_string_lossy().into_owned(),
            ];
            let mut compiler_files = Vec::new();
            let empty_search_path = if let Some(declaration) = settings.declared_jdk {
                if java8_launcher(&home) {
                    if declaration.release != 8 {
                        return Err("The selected JDK 8 can compile a declared project targeting Java 8.".into());
                    }
                    args.extend(["-source".into(), "8".into(), "-target".into(), "8".into()]);
                } else {
                    args.extend(["--release".into(), declaration.release.to_string()]);
                }
                args.push("-proc:none".into());
                // javac otherwise searches the classpath/current directory for implicit sources.
                let marker = LaunchFile::create("compiler-search-marker", b"")?;
                let empty = marker.path.parent().ok_or("Missing private compiler directory.")?.to_path_buf();
                args.extend(["-sourcepath".into(), empty.to_string_lossy().into_owned()]);
                compiler_files.push(marker);
                Some(empty)
            } else { None };
            let compiler_classpath=settings.declared_jdk.map(|declaration| declaration.compile_classpath.as_slice()).unwrap_or(&extra);
            if !compiler_classpath.is_empty() {
                args.extend([
                    "-classpath".into(),
                    std::env::join_paths(compiler_classpath)
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .into_owned(),
                ]);
            } else if let Some(empty) = empty_search_path {
                args.extend(["-classpath".into(), empty.to_string_lossy().into_owned()]);
            }
            args.extend(sources);
            plan.push(Invocation {
                directory: directory.clone(),
                executable: javac,
                arguments: args,
                interactive: false,
                java_home: home.clone(),
                launch_file: None,
                discovery: None,
                coverage: None,
                auxiliary_files: compiler_files,
                profile_path: None,
                test_report_path: None,
            });
            if request.operation == "test" {
                if request.testng_selection || config.test_framework == "testng" {
                    plan.extend(jdk_testng_invocations(
                        workspace,
                        root,
                        &home,
                        &java,
                        &classes,
                        &extra,
                        &config.test_jvm_options,
                        &config.test_filter,
                        selections,
                        declared_runtime.as_deref(),
                    )?);
                } else {
                    plan.push(jdk_test_invocation(
                        workspace,
                        root,
                        &home,
                        &java,
                        &classes,
                        &extra,
                        &config.test_jvm_options,
                        &config.test_filter,
                        selections,
                        declared_runtime.as_deref(),
                    )?);
                }
            } else if request.operation == "discover" {
                let artifact = Arc::new(DiscoveryArtifact::create(
                    workspace,
                    root,
                    &config.project_path,
                    kind,
                    &config.test_jvm_options,
                    None,
                    None,
                )?);
                let mut arguments = artifact.arguments(workspace)?;
                if declared_runtime.is_some() {
                    arguments.push(classes.to_str().ok_or("Declared test output must be UTF-8.")?.into());
                }
                let runtime_paths = declared_runtime.clone().unwrap_or_else(||
                    std::iter::once(classes.clone()).chain(extra.iter().cloned()).collect());
                plan.extend(artifact.direct_invocations(
                    root, &home, &runtime_paths, &config.test_jvm_options, &arguments,
                )?);
            }
        }
    }
    if request.operation == "debug" || (request.operation == "run" && kind == "jdk") {
        let directory = application_directory;
        let mut paths = vec![classes];
        paths.extend(extra);
        let classpath = std::env::join_paths(paths)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        let debugging = request.operation == "debug";
        if debugging && (config.debugger_mode == "jdi" || java8_launcher(&home)) {
            let launch = Request { configuration: adjusted_config, ..request.clone() };
            plan.extend(project_execution::runtime_invocations(
                directory, home, &classpath, None, &launch,
            )?);
            return Ok(plan);
        }
        let executable = if debugging {
            let debugger = home.join("bin").join(executable_name("jdb"));
            if !debugger.is_file() {
                return Err("The selected JDK debugger (jdb) is unavailable.".into());
            }
            debugger
        } else {
            java
        };
        let mut arguments = Vec::new();
        if debugging {
            arguments.push("-launch".into());
        }
        let launch_file = if debugging
            && (!config.program_arguments.is_empty() || !config.jvm_options.is_empty() || !config.working_directory.is_empty())
        {
            let file = java_argument_file(
                &config.jvm_options,
                &config.main_class,
                &config.program_arguments,
                Some(&classpath),
            )?;
            let reference = file.argument_reference()?;
            if reference.contains([',', '\n', '\r', '\'', '"']) {
                return Err(
                    "The debugger launch directory contains unsupported connector characters."
                        .into(),
                );
            }
            arguments.push(reference);
            Some(file)
        } else {
            arguments.extend(java_arguments(
                &config.jvm_options,
                &config.main_class,
                &config.program_arguments,
                Some(&classpath),
            ));
            None
        };
        plan.push(Invocation {
            directory,
            executable,
            arguments,
            interactive: debugging,
            java_home: home,
            launch_file,
            discovery: None,
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: None,
        });
    }
    if let Some(profile) = profile {
        let invocation = plan
            .last_mut()
            .ok_or("No Java application launch was created for profiling.")?;
        invocation.profile_path = Some(profile.workspace_path);
    }
    Ok(plan)
}
impl Job {
    fn read(&self) -> Result<Snapshot, String> {
        let mut snapshot = self.snapshot.lock()
            .map(|snapshot| snapshot.clone()).map_err(|_| "Java session is unavailable.")?;
        snapshot.application_input = self.application_input.as_ref().map(|bridge| bridge.snapshot()).transpose()?;
        Ok(snapshot)
    }
    fn append(&self, bytes: &[u8]) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            snapshot.output.push_str(&String::from_utf8_lossy(bytes));
            if snapshot.output.len() > OUTPUT_LIMIT {
                let mut start = snapshot.output.len() - OUTPUT_LIMIT;
                while !snapshot.output.is_char_boundary(start) {
                    start += 1;
                }
                snapshot.output.drain(..start);
                snapshot.output_truncated = true;
            }
        }
    }
    fn stop(&self) {
        if let Some(input) = &self.application_input { input.finish(); }
        self.cancelled.store(true, Ordering::SeqCst);
        if debug_test::is_debug(&self.request.operation) {
            debug_test::terminate_children(self);
        }
        if let Ok(mut current) = self.child.lock() {
            if let Some(child) = current.as_mut() {
                if self.request.operation == "attach" {
                    // Permit the JDI shutdown hook to dispose its connection and
                    // resume debugger suspensions. A stalled helper is still bounded.
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(child.id() as i32, libc::SIGTERM);
                    }
                    let deadline = std::time::Instant::now() + Duration::from_secs(1);
                    while std::time::Instant::now() < deadline {
                        if child.try_wait().ok().flatten().is_some() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                }
                kill_owned_process(child);
            }
        }
        if let Ok(mut snapshot) = self.snapshot.lock() {
            snapshot.state = "stopped".into();
            snapshot.exit_code = None;
            snapshot.test_jvm_options_error = None;
            if let Some(debugger) = &mut snapshot.debugger_state {
                debugger.terminate();
            }
            if let Some(discovery) = &mut snapshot.test_discovery {
                discovery.unavailable(
                    "Test discovery was stopped; no complete selections are presented.",
                );
            }
            if let Some(results) = &mut snapshot.test_results {
                results
                    .unavailable("Test execution was stopped; no complete results are presented.");
            }
            if let Some(results) = &mut snapshot.coverage {
                results
                    .unavailable("Coverage was stopped; no complete measurements are presented.");
            }
        }
        class_reload::retire(self);
    }
}
fn kill_owned_process(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn drain(mut reader: impl Read, job: Arc<Job>, directory: PathBuf) {
    let mut diagnostics = compiler_diagnostics::Stream::default();
    let record = |item, omitted| {
        if let Ok(mut snapshot) = job.snapshot.lock() {
            snapshot.compiler_diagnostics.record(item, omitted);
        }
    };
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                job.append(&buffer[..count]);
                diagnostics.push(&buffer[..count], &job.binding.canonical_root, &directory, &record);
            }
        }
    }
    diagnostics.finish(&job.binding.canonical_root, &directory, &record);
}
fn execute(job: &Arc<Job>, invocation: Invocation) -> Result<i32, String> {
    execute_in_slot(job, invocation, false)
}
fn execute_in_slot(job: &Arc<Job>, invocation: Invocation, test_tool: bool) -> Result<i32, String> {
    let child_slot = if test_tool { &job.test_tool_child } else { &job.child };
    let structured = invocation.interactive && job.request.configuration.debugger_mode == "jdi";
    let _launch_file = invocation.launch_file;
    let _discovery = invocation.discovery;
    let _auxiliary_files = invocation.auxiliary_files;
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(1);
    }
    if !current_workspace_binding_is_current(&job.binding) {
        return Err("The Java workspace changed before execution.".into());
    }
    if ["run", "debug"].contains(&job.request.operation.as_str()) && !job.request.configuration.working_directory.is_empty() {
        let project = execution_root(&job.binding.canonical_root, &job.request.configuration.project_path)?;
        let current = application_directory(&job.binding.canonical_root, &project, &job.request.configuration)?;
        let java_process = [executable_name("java"), executable_name("jdb")].iter()
            .any(|name| invocation.executable.file_name().is_some_and(|file| file == std::ffi::OsStr::new(name)));
        let captured = if java_process { Some(&invocation.directory) }
            else { _launch_file.as_ref().and_then(|file| file.application_directory.as_ref()) };
        if captured.is_some_and(|directory| directory != &current) {
            return Err("The application working directory changed before launch.".into());
        }
    }
    let output_directory = invocation.directory.clone();
    let error_directory = invocation.directory.clone();
    let mut command = Command::new(invocation.executable);
    command
        .args(invocation.arguments)
        .current_dir(invocation.directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if invocation.interactive {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    let _initial_breakpoints = if structured && !job.request.source_breakpoints.is_empty() {
        let sources = job
            .sources
            .lock()
            .map_err(|_| "Debugger sources are unavailable.")?;
        let sources = sources
            .as_ref()
            .ok_or("Debugger sources are not ready.")?
            .as_ref()
            .map_err(Clone::clone)?;
        let contents = sources.initial_breakpoints(job, false)?;
        let file = LaunchFile::create("breakpoints.txt", contents.as_bytes())?;
        command.arg(&file.path);
        Some(file)
    } else {
        None
    };
    command.envs(
        job.request
            .configuration
            .environment
            .iter()
            .map(|variable| (&variable.name, &variable.value)),
    );
    command.env("JAVA_HOME", invocation.java_home);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut current = child_slot
        .lock()
        .map_err(|_| "Java process is unavailable.")?;
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(1);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start Java tool: {e}"))?;
    if invocation.interactive {
        let prepared = child
            .stdin
            .as_ref()
            .ok_or_else(|| "Cannot open debugger input.".to_owned())
            .and_then(debugger_input::prepare);
        if let Err(error) = prepared {
            kill_owned_process(&mut child);
            return Err(error);
        }
    }
    let stdout = child.stdout.take().ok_or("Cannot read Java output.")?;
    let stderr = child.stderr.take().ok_or("Cannot read Java errors.")?;
    *current = Some(child);
    drop(current);
    if let Ok(mut snapshot) = job.snapshot.lock() {
        if snapshot.state != "stopped" {
            snapshot.state = "running".into();
        }
    }
    let output_job = job.clone();
    let error_job = job.clone();
    let output = thread::spawn(move || {
        if structured {
            structured_debugger::drain(stdout, output_job)
        } else {
            drain(stdout, output_job, output_directory);
            Ok(())
        }
    });
    let errors = thread::spawn(move || drain(stderr, error_job, error_directory));
    let started = std::time::Instant::now();
    let mut startup_error = None;
    let result = loop {
        if test_tool && startup_error.is_none() && job.read()?.debugger_state.is_none()
            && (started.elapsed() > Duration::from_secs(120)
                || job.child.lock().map_err(|_| "Test debugger is unavailable.")?.is_none())
        {
            startup_error = Some("The test JVM did not connect to the owned JDI debugger.".to_string());
            debug_test::terminate_children(job);
        }
        if job.cancelled.load(Ordering::SeqCst)
            || !current_workspace_binding_is_current(&job.binding)
        {
            job.stop();
        }
        let mut current = child_slot
            .lock()
            .map_err(|_| "Java process is unavailable.")?;
        let child = current.as_mut().ok_or("Java process disappeared.")?;
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let code = status.code().unwrap_or(1);
            // A debugger can leave a suspended child VM when its own process exits.
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            *current = None;
            break code;
        }
        drop(current);
        thread::sleep(Duration::from_millis(30));
    };
    let parsed = output
        .join()
        .map_err(|_| "The Java output reader failed.")?;
    let _ = errors.join();
    if !job.cancelled.load(Ordering::SeqCst) {
        parsed?;
    }
    if let Some(error) = startup_error { return Err(error); }
    Ok(result)
}
impl JavaExecutionState {
    pub fn new(project_context: &JavaProjectContextState) -> Self {
        Self {
            job: Default::default(),
            class_reload_build: Default::default(),
            project_context: Some(JavaExecutionProjectContext::new(project_context)),
        }
    }
    pub(crate) fn start_project(
        &self,
        binding: CurrentWorkspaceBinding,
        request: Request,
        selection: JavaExecutionProjectSelection,
    ) -> Result<Snapshot, String> {
        if request.test_selection.is_some() || request.operation == "attach" {
            return Err(
                "Attach and captured test selections do not accept a replacement project context."
                    .into(),
            );
        }
        self.start_selected(binding, request, vec![], None, None, Some(selection))
    }
    pub(crate) fn start(
        &self,
        binding: CurrentWorkspaceBinding,
        request: Request,
    ) -> Result<Snapshot, String> {
        if (request.gradle_preparation.is_some() || request.maven_preparation.is_some())
            && request.test_selection.is_some()
        {
            return Err("Project preparation cannot run a captured test selection.".into());
        }
        if let Some(selection) = &request.test_selection {
            if !request.trusted
                || ![
                    "debug-test",
                    "debug-integration-test",
                    "test",
                    "integration-test",
                    "integration-coverage",
                    "coverage",
                ]
                .contains(&request.operation.as_str())
                || selection.discovery_session_id.len() > 128
                || selection.test_id.len() > 128
            {
                return Err(
                    "Trust the workspace and choose a test from a completed discovery session."
                        .into(),
                );
            }
            let job = self.session(
                &binding,
                &SessionRequest {
                    workspace_id: request.workspace_id.clone(),
                    generation: request.generation,
                    session_id: selection.discovery_session_id.clone(),
                },
            )?;
            let snapshot = job.read()?;
            if snapshot.operation != "discover" || snapshot.state != "succeeded" {
                return Err(
                    "Wait for successful test discovery before running a selection.".into(),
                );
            }
            let discovery = snapshot
                .test_discovery
                .ok_or("This session has no test discovery results.")?;
            if discovery.status != "ready" {
                return Err(
                    "Incomplete discovery cannot provide a reliable test selection.".into(),
                );
            }
            let selected_test = discovery
                .tests
                .iter()
                .find(|test| test.id == selection.test_id)
                .ok_or("The discovered test selection does not exist.")?;
            let selected = selected_test.selection();
            let mut captured = job.request.clone();
            captured.operation = request.operation.clone();
            captured.test_selection = None;
            captured.testng_selection = selected_test.testng;
            captured.maven_discovered_module_only =
                job.project_context.is_none() && captured.configuration.build_tool == "maven";
            captured.configuration.test_filter = selected.clone();
            if debug_test::is_debug(&captured.operation) {
                captured.configuration.debugger_mode = "jdi".into();
                captured.source_breakpoints = request.source_breakpoints;
            }
            return self.start_selected(
                binding,
                captured,
                vec![selected],
                None,
                Some(&selection.discovery_session_id),
                job.project_context.clone(),
            );
        }
        self.start_selected(binding, request, vec![], None, None, None)
    }
    fn start_selected(
        &self,
        binding: CurrentWorkspaceBinding,
        mut request: Request,
        selections: Vec<String>,
        maven_test_projects: Option<maven_test_forks::RerunProjects>,
        previous_session: Option<&str>,
        mut project_context: Option<JavaExecutionProjectSelection>,
    ) -> Result<Snapshot, String> {
        if !request.trusted {
            return Err(
                "Confirm workspace trust before running project code or build plugins.".into(),
            );
        }
        if ["prepare-gradle", "prepare-maven"].contains(&request.operation.as_str())
            && (project_context.is_some() || previous_session.is_some() || !selections.is_empty())
        {
            return Err("Project preparation requires the current Java Project settings.".into());
        }
        if (request.operation != "prepare-gradle" && request.gradle_preparation.is_some())
            || (request.operation != "prepare-maven" && request.maven_preparation.is_some())
        {
            return Err("Preparation settings require the matching build-tool operation.".into());
        }
        if request.configuration.launch_as_module
            && ["run", "debug"].contains(&request.operation.as_str())
            && project_context.is_none()
        {
            return Err("Named-module launch requires a synchronized Java project module.".into());
        }
        if debug_test::is_debug(&request.operation) { debug_test::validate(&request, &selections)?; }
        validate_settings(&request.configuration, debug_test::test_operation(&request.operation))?;
        if request.profile && request.operation != "run" {
            return Err(
                "Java Flight Recorder profiling is available only for application Run.".into(),
            );
        }
        debugger_sources::validate_initial(&request)?;
        if previous_session.is_none()
            && [
                "debug-test",
                "debug-integration-test",
                "test",
                "integration-test",
                "integration-coverage",
                "coverage",
                "discover",
            ]
            .contains(&request.operation.as_str())
        {
            if let Some(selection) = project_context.as_ref() {
                project_context = Some(
                    self.project_context
                        .as_ref()
                        .ok_or("Project-context execution is unavailable.")?
                        .test_selection(&binding, request.generation, selection)?,
                );
            }
        }
        if let Some(selection) = &project_context {
            let provider = self
                .project_context
                .as_ref()
                .ok_or("Project-context execution is unavailable.")?;
            if previous_session.is_some() {
                provider.validate_retained(&binding, request.generation, selection)?;
            } else {
                let selected = provider.captured(&binding, request.generation, selection)?;
                if request.configuration.build_tool != "auto"
                    && request.configuration.build_tool != selected.build_tool
                {
                    return Err(
                        "The launch build tool differs from the selected project provider.".into(),
                    );
                }
                if !request.configuration.jdk_home.is_empty()
                    && selected_jdk(&request.configuration.jdk_home)? != selected.sdk_home
                {
                    return Err("The launch JDK differs from the synchronized project JDK.".into());
                }
                request.configuration.build_tool = selected.build_tool;
                request.configuration.jdk_home = selected.sdk_home.to_string_lossy().into_owned();
                request.configuration.project_path = selected
                    .module_root
                    .strip_prefix(&binding.canonical_root)
                    .map_err(|_| "The launch module is outside its workspace.")?
                    .to_string_lossy()
                    .replace('\\', "/");
            }
        }
        let mut current = self
            .job
            .lock()
            .map_err(|_| "Java executor is unavailable.")?;
        if self
            .class_reload_build
            .lock()
            .map_err(|_| "Java build state is unavailable.")?
            .as_ref()
            .is_some_and(|build| {
                build.read().is_ok_and(|snapshot| {
                    ["starting", "running"].contains(&snapshot.state.as_str())
                })
            })
        {
            return Err(
                "Wait for the build running alongside HotSwap before starting another task.".into(),
            );
        }
        if current.as_ref().is_some_and(|job| {
            job.read()
                .is_ok_and(|snapshot| ["starting", "running"].contains(&snapshot.state.as_str()))
        }) {
            return Err("Stop the current Java task before starting another.".into());
        }
        if let Some(previous) = previous_session {
            if current.as_ref().is_none_or(|job| {
                job.binding != binding
                    || job.read().map_or(true, |snapshot| {
                        snapshot.session_id != previous || snapshot.generation != request.generation
                    })
            }) {
                return Err("The captured Java session changed before repeated execution.".into());
            }
        }
        let project = if request.operation == "attach" {
            binding.canonical_root.clone()
        } else {
            execution_root(&binding.canonical_root, &request.configuration.project_path)?
        };
        if request.configuration.build_tool == "auto" {
            request.configuration.build_tool = project_kind(&project).into();
        }
        request.configuration.jdk_home = selected_jdk(&request.configuration.jdk_home)?
            .to_string_lossy()
            .into_owned();
        let application_input = if request.configuration.application_input
            && ["run", "debug"].contains(&request.operation.as_str()) {
            Some(Arc::new(application_input::Bridge::create(Path::new(&request.configuration.jdk_home))?))
        } else { None };
        let mut plan = if project_context.is_some() {
            vec![]
        } else {
            invocation_selected_with_settings(
                &binding.canonical_root,
                &request,
                &selections,
                previous_session.is_some(),
                None,
                None,
                InvocationSettings { application_input: application_input.as_ref().map(|input| input.option()),
                    ..InvocationSettings::default() },
            )?
        };
        if let Some(projects) = &maven_test_projects {
            if request.testng_selection {
                return Err("Reactor-scoped reruns of a captured TestNG suite require a fresh module test run.".into());
            }
            let invocation = plan.last_mut().ok_or("Maven reactor rerun is unavailable.")?;
            maven_test_forks::configure_rerun(
                invocation, &project, projects, &request.operation,
            )?;
        }
        let initial_profile_path = plan
            .iter()
            .find_map(|invocation| invocation.profile_path.clone());
        let testing = [
            "debug-test",
            "debug-integration-test",
            "test",
            "integration-test",
            "integration-coverage",
            "coverage",
        ]
        .contains(&request.operation.as_str());
        let initial_coverage = ["coverage", "integration-coverage"]
            .contains(&request.operation.as_str())
            .then(|| {
                coverage::CoverageResults::collecting(
                    &request.configuration.project_path,
                    &request.configuration.build_tool,
                )
            });
        let initial_results = testing.then(|| {
            TestResults::collecting(
                &request.configuration.project_path,
                &request.configuration.build_tool,
            )
        });
        let initial_discovery = (request.operation == "discover").then(|| {
            TestDiscovery::collecting(
                &request.configuration.project_path,
                &request.configuration.build_tool,
            )
        });
        let job = Arc::new(Job {
            binding: binding.clone(),
            request: request.clone(),
            test_selections: selections,
            maven_test_projects,
            project_context,
            cancelled: AtomicBool::new(false),
            sources: Mutex::new(None),
            debugger_source_roots: Mutex::new(None),
            debugger_class_output_roots: Mutex::new(None),
            class_reload: Mutex::new(None),
            application_input,
            child: Mutex::new(None),
            test_tool_child: Mutex::new(None),
            test_listener_port: Mutex::new(None),
            snapshot: Mutex::new(Snapshot {
                workspace_id: request.workspace_id,
                generation: request.generation,
                session_id: format!("java-{}", NEXT_SESSION.fetch_add(1, Ordering::SeqCst)),
                operation: request.operation,
                state: "starting".into(),
                output: String::new(),
                output_truncated: false,
                exit_code: None,
                profile_path: initial_profile_path,
                test_results: initial_results,
                coverage: initial_coverage,
                test_jvm_options_error: None,
                test_discovery: initial_discovery,
                debugger_state: None,
                class_reload: None,
                application_input: None,
                can_debug_failed_tests: false,
                compiler_diagnostics: compiler_diagnostics::Report::default(),
            }),
        });
        *current = Some(job.clone());
        let worker = job.clone();
        let project_provider = self.project_context.clone();
        let is_rerun = previous_session.is_some();
        thread::spawn(move || {
            let _input_completion = worker.application_input.as_ref().map(|input| input.completion());
            let mut plan = if let Some(selection) = &worker.project_context {
                match project_execution::plan(
                    &worker,
                    project_provider.as_ref().unwrap(),
                    selection,
                    &worker.test_selections,
                    is_rerun,
                ) {
                    Ok(plan) => plan,
                    Err(error) => {
                        worker.append(error.as_bytes());
                        if let Ok(mut snapshot) = worker.snapshot.lock() {
                            let stopped = worker.cancelled.load(Ordering::SeqCst)
                                || !current_workspace_binding_is_current(&worker.binding);
                            snapshot.state = if stopped { "stopped" } else { "failed" }.into();
                            if stopped {
                                snapshot.exit_code = None;
                            } else if snapshot.exit_code.is_none() {
                                snapshot.exit_code = Some(1);
                            }
                            if let Some(discovery) = &mut snapshot.test_discovery {
                                discovery.unavailable(&error);
                            }
                            if let Some(coverage) = &mut snapshot.coverage {
                                coverage.unavailable(&error);
                            }
                            if let Some(results) = &mut snapshot.test_results {
                                results.unavailable(&error);
                            }
                        }
                        return;
                    }
                }
            } else {
                plan
            };
            let method_artifact = if testing && worker.request.configuration.build_tool == "gradle" {
                match gradle_test_methods::Artifact::create() {
                    Ok(artifact) => {
                        if let Some(invocation) = plan.last_mut() {
                            invocation.arguments.extend([
                                "-Dorg.gradle.configuration-cache=false".into(),
                                "--init-script".into(), artifact.source.path.to_string_lossy().into_owned(),
                            ]);
                        }
                        Some(artifact)
                    }
                    Err(_) => None,
                }
            } else { None };
            if let Ok(mut snapshot) = worker.snapshot.lock() {
                snapshot.profile_path = plan
                    .iter()
                    .find_map(|invocation| invocation.profile_path.clone());
            }
            let source_error = if ["debug", "attach", "debug-test", "debug-integration-test"].contains(&worker.request.operation.as_str())
                && worker.request.configuration.debugger_mode == "jdi"
            {
                let captured = debugger_sources::Sources::capture(&worker);
                let error = if worker.request.source_breakpoints.is_empty() {
                    None
                } else {
                    captured
                        .as_ref()
                        .map_err(Clone::clone)
                        .and_then(|sources| sources.initial_breakpoints(&worker, true))
                        .err()
                };
                if let Ok(mut sources) = worker.sources.lock() {
                    *sources = Some(captured);
                }
                error
            } else {
                None
            };
            let coverage_artifact = plan
                .iter()
                .find_map(|invocation| invocation.coverage.clone());
            let gradle_report_configuration = coverage_artifact
                .as_ref()
                .filter(|artifact| artifact.gradle_report_task().is_some())
                .and_then(|_| {
                    plan.iter()
                        .find(|invocation| invocation.coverage.is_some())
                        .map(|invocation| {
                            (
                                invocation.directory.clone(),
                                invocation.executable.clone(),
                                invocation.arguments.clone(),
                            )
                        })
                });
            let discovery_artifact = plan
                .iter()
                .find_map(|invocation| invocation.discovery.clone());
            let test_jvm_invocation = plan.iter().find(|invocation| {
                invocation.launch_file.as_ref().is_some_and(|file| file.test_jvm_marker.is_some())
            });
            let test_jvm_launch = test_jvm_invocation.and_then(|invocation| {
                let file = invocation.launch_file.as_ref()?;
                Some((file.test_jvm_marker.clone()?, file.argument_reference().ok()?))
            });
            let test_operation = debug_test::test_operation(&worker.request.operation);
            // Maven verify runs Surefire before the selected Failsafe task. Check
            // fresh unit reports in conventional directories without displaying
            // them as integration results or requiring a project to run unit tests.
            let surefire_tracker = test_jvm_invocation
                .filter(|_| ["integration-test", "integration-coverage"].contains(&test_operation))
                .map(|invocation| Tracker::prepare_for_operation(
                    &worker.binding.canonical_root, &invocation.directory, "maven", &[], "test",
                ));
            let tracker = testing.then(|| {
                let mut report_paths = worker.request.configuration.test_report_paths.clone();
                report_paths.extend(
                    plan.iter()
                        .filter_map(|invocation| invocation.test_report_path.clone()),
                );
                Tracker::prepare_for_operation(
                    &worker.binding.canonical_root,
                    &project,
                    &worker.request.configuration.build_tool,
                    &report_paths,
                    test_operation,
                )
            });
            if let Some(input) = &worker.application_input {
                let mut compilation = input.compilation(Path::new(&worker.request.configuration.jdk_home));
                compilation.append(&mut plan);
                plan = compilation;
            }
            let mut exit_code = 0;
            let final_step = plan.len().saturating_sub(1);
            for (index, invocation) in plan.into_iter().enumerate() {
                if let Some(error) = &source_error {
                    worker.append(error.as_bytes());
                    exit_code = 1;
                    break;
                }
                if let Some((provider, selection)) = project_provider.as_ref().zip(worker.project_context.as_ref()) {
                    if worker.request.configuration.build_tool == "maven" {
                        if let Err(error) = provider.validate_retained(&worker.binding, worker.request.generation, selection) {
                            worker.append(error.as_bytes());
                            exit_code = 1;
                            break;
                        }
                    }
                }
                let executed = if debug_test::is_debug(&worker.request.operation) && index == final_step {
                    debug_test::execute(&worker, invocation)
                } else { execute(&worker, invocation) };
                match executed {
                    Ok(code) => {
                        exit_code = code;
                        if code != 0 || worker.cancelled.load(Ordering::SeqCst) {
                            break;
                        }
                    }
                    Err(error) => {
                        worker.append(error.as_bytes());
                        exit_code = 1;
                        break;
                    }
                }
            }
            let mut coverage_report_error = None;
            if let Some(artifact) = &coverage_artifact {
                if artifact.tool == "maven"
                    && !worker.cancelled.load(Ordering::SeqCst)
                    && current_workspace_binding_is_current(&worker.binding)
                {
                    let reporter = (|| {
                        let maven_launcher = match worker.project_context.as_ref() {
                            Some(selection) => project_provider.as_ref().unwrap().validate_retained(
                                &worker.binding, worker.request.generation, selection,
                            )?,
                            None => None,
                        };
                        let executable = maven_launcher.clone()
                            .or_else(|| build_tool(&project, &worker.binding.canonical_root, "mvn"))
                                .ok_or("Maven is unavailable for coverage reporting.")?;
                        let mut arguments = vec![
                            "-B".into(),
                            "-Dstyle.color=never".into(),
                            format!(
                                "org.jacoco:jacoco-maven-plugin:{}:{}",
                                coverage::VERSION,
                                artifact.maven_report_goal()
                            ),
                        ];
                        arguments.extend(artifact.maven_properties(false));
                        let mut reporting = Invocation {
                            directory: project.clone(),
                            executable,
                            arguments,
                            interactive: false,
                            java_home: selected_jdk(&worker.request.configuration.jdk_home)?,
                            launch_file: None,
                            discovery: None,
                            coverage: Some(artifact.clone()),
                            auxiliary_files: vec![],
                            profile_path: None,
                            test_report_path: None,
                        };
                        if let Some(selection) = worker.project_context.as_ref() {
                            project_execution::configure_report(
                                &mut reporting,
                                &worker.binding.canonical_root,
                                selection,
                                maven_launcher,
                            )?;
                        }
                        execute(&worker, reporting)
                    })();
                    match reporter {
                        Ok(0) => {}
                        Ok(code) => {
                            coverage_report_error =
                                Some(format!("JaCoCo report generation exited with code {code}."));
                            if exit_code == 0 {
                                exit_code = code;
                            }
                        }
                        Err(error) => {
                            coverage_report_error = Some(error);
                            if exit_code == 0 {
                                exit_code = 1;
                            }
                        }
                    }
                } else if artifact.tool == "gradle"
                    && artifact.gradle_report_task().is_some()
                    && !worker.cancelled.load(Ordering::SeqCst)
                    && current_workspace_binding_is_current(&worker.binding)
                {
                    let reporter = (|| {
                        let (directory, executable, test_arguments) = gradle_report_configuration
                            .as_ref()
                            .ok_or("Captured Gradle coverage settings are unavailable.")?;
                        let invocation = gradle_coverage_report_invocation(
                            directory,
                            executable,
                            test_arguments,
                            artifact.clone(),
                            selected_jdk(&worker.request.configuration.jdk_home)?,
                        )?;
                        execute(&worker, invocation)
                    })();
                    match reporter {
                        Ok(0) => {}
                        Ok(code) => {
                            coverage_report_error = Some(format!(
                                "Gradle coverage report generation exited with code {code}."
                            ));
                            if exit_code == 0 {
                                exit_code = code;
                            }
                        }
                        Err(error) => {
                            coverage_report_error = Some(error);
                            if exit_code == 0 {
                                exit_code = 1;
                            }
                        }
                    }
                }
            }
            let coverage_results = coverage_artifact
                .as_ref()
                .map(|artifact| artifact.finish(&worker, coverage_report_error.as_deref()));
            let coverage_failed = coverage_results
                .as_ref()
                .is_some_and(|result| result.status != "ready");
            let results = tracker.map(|tracker| {
                let marker = test_jvm_launch.as_ref().map(|(marker, _)| marker.as_str());
                let mut results = tracker.finish_with_jvm_options(
                    &worker.request.configuration.project_path,
                    marker,
                );
                if results.test_jvm_options_error.is_none() {
                    if let Some(error) = surefire_tracker.as_ref().zip(marker)
                        .and_then(|(tracker, marker)| tracker.verify_optional_test_jvm_options(marker))
                    {
                        results.record_test_jvm_options_error(error);
                    }
                }
                if results.status == "ready" && !worker.cancelled.load(Ordering::SeqCst) && current_workspace_binding_is_current(&worker.binding) {
                    if let Some(artifact) = method_artifact.as_ref() {
                        match artifact.read(&worker.binding.canonical_root) {
                            Ok(identities) => results.correlate_gradle_methods(&worker.binding.canonical_root, &identities),
                            Err(error) if results.can_rerun_failed => worker.append(format!("Gradle test method identities are unavailable: {error}\n").as_bytes()),
                            Err(_) => {},
                        }
                    }
                }
                if worker.project_context.is_none() {
                    results.scope_maven_reactor_rerun(worker.maven_test_projects.as_ref());
                }
                results
            });
            let has_test_filter =
                !worker.test_selections.is_empty() || !worker.request.configuration.test_filter.is_empty();
            let results_missing = results
                .as_ref()
                .is_some_and(|results| results.status != "ready" || results.summary.total == 0);
            let filtered_results_missing = has_test_filter
                && (worker.project_context.is_some()
                    || worker.maven_test_projects.is_some()
                    || ["integration-test", "integration-coverage"]
                        .contains(&worker.request.operation.as_str()))
                && results_missing;
            let integration_results_missing = ["integration-test", "integration-coverage"]
                .contains(&worker.request.operation.as_str())
                && results_missing;
            let plain_jdk_results_missing = worker.request.configuration.build_tool == "jdk"
                && worker.request.operation == "test"
                && results_missing;
            let test_results_failed = filtered_results_missing
                || integration_results_missing
                || plain_jdk_results_missing;
            if test_results_failed {
                let message = if ["integration-test", "integration-coverage"]
                    .contains(&worker.request.operation.as_str())
                {
                    b"The Maven integration-test task did not produce complete fresh Failsafe results. Check the selector, plugin configuration and report diagnostics.\n".as_slice()
                } else if plain_jdk_results_missing {
                    b"The plain-JDK JUnit task did not produce complete fresh reports. Check the ConsoleLauncher, test engines, selector and report diagnostics.\n".as_slice()
                } else {
                    b"The selected tests did not produce complete fresh results. Check the test selector and report diagnostics.\n".as_slice()
                };
                worker.append(message);
            }
            let discovery = discovery_artifact
                .as_ref()
                .map(|artifact| artifact.finish(exit_code));
            let discovery_failed = discovery
                .as_ref()
                .is_some_and(|result| result.status == "unavailable");
            if let Ok(mut snapshot) = worker.snapshot.lock() {
                if let Some(debugger) = &mut snapshot.debugger_state {
                    debugger.terminate();
                }
                if worker.cancelled.load(Ordering::SeqCst)
                    || !current_workspace_binding_is_current(&worker.binding)
                {
                    snapshot.state = "stopped".into();
                    snapshot.exit_code = None;
                    if let Some(results) = &mut snapshot.coverage {
                        results.unavailable("Coverage stopped or the workspace changed.");
                    }
                    if let Some(results) = &mut snapshot.test_results {
                        results.unavailable("Test execution stopped or the workspace changed.");
                    }
                    if let Some(discovery) = &mut snapshot.test_discovery {
                        discovery.unavailable("Discovery stopped or the workspace changed.");
                    }
                } else {
                    let configuration_error = results
                        .as_ref()
                        .and_then(|results| results.test_jvm_options_error.clone())
                        .map(|error| {
                            if exit_code != 0
                                && worker.request.configuration.build_tool == "maven"
                                && maven_test_forks::missing_toolchain_reported(&snapshot.output)
                            {
                                concat!(
                                    "Maven could not find a matching JDK toolchain for the test fork. ",
                                    "Configure a matching toolchain in Maven and run again."
                                )
                                .into()
                            } else if exit_code != 0
                                && worker.request.configuration.build_tool == "maven"
                                && maven_test_forks::offline_plugin_resolution_reported(&snapshot.output)
                            {
                                concat!(
                                    "Maven could not resolve a build plugin in offline mode. ",
                                    "In a trusted workspace, use Verify Maven project to populate the selected repository, then run the tests again."
                                )
                                .into()
                            } else if exit_code != 0
                                && test_jvm_launch.as_ref().is_some_and(|(_, reference)| {
                                    launch_settings::argument_file_reported_as_main_class(
                                        &snapshot.output,
                                        reference,
                                    )
                                })
                            {
                                "A Maven test JVM treated the IDE argument file as a class name and could not start. \
                                 Configure the project's test JVM to support Java launcher argument files, \
                                 or clear Test JVM options to use the project's defaults."
                                    .into()
                            } else {
                                error
                            }
                        });
                    snapshot.state = if exit_code == 0
                        && configuration_error.is_none()
                        && !test_results_failed
                        && !discovery_failed
                        && !coverage_failed
                    {
                        "succeeded"
                    } else {
                        "failed"
                    }
                    .into();
                    snapshot.exit_code = Some(exit_code);
                    snapshot.can_debug_failed_tests = results.as_ref().is_some_and(|results| {
                        debug_test::failed_request(&worker.request, results, worker.project_context.is_none()).is_ok()
                    });
                    snapshot.test_results = results;
                    snapshot.coverage = coverage_results;
                    snapshot.test_jvm_options_error = configuration_error;
                    snapshot.test_discovery = discovery;
                }
                if let Some(path) = snapshot.profile_path.as_ref() {
                    let output = worker.binding.canonical_root.join(path);
                    if fs::metadata(&output).map_or(true, |metadata| metadata.len() == 0) {
                        if let Some(directory) = output.parent() {
                            let _ = fs::remove_dir(directory);
                        }
                        snapshot.profile_path = None;
                    }
                }
            }
            class_reload::retire(&worker);
        });
        job.read()
    }
    fn validate_debugger_class_outputs(&self, job: &Job) -> Result<(), String> {
        let Some(selection) = job.project_context.as_ref() else {
            return Ok(());
        };
        let provider = self
            .project_context
            .as_ref()
            .ok_or("Project-context validation is unavailable.")?;
        let resolved =
            provider.resolve(&job.binding, job.request.generation, selection, true, false)?;
        let current_roots = project_execution::class_output_roots(
            &job.binding.canonical_root,
            &resolved.runtime_classpath,
        );
        let captured_roots = job
            .debugger_class_output_roots
            .lock()
            .map_err(|_| "Debugger class-output state is unavailable.")?
            .clone()
            .ok_or("The debugger has no captured synchronized runtime outputs; restart it.")?;
        if captured_roots != current_roots {
            return Err(
                "The synchronized runtime outputs changed during this debugger session; restart it before reloading classes.".into(),
            );
        }
        Ok(())
    }
    pub(crate) fn build_for_class_reload_at(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: ClassReloadBuildRequest,
    ) -> Result<ClassReloadBuildResult, String> {
        if !request.trusted {
            return Err("Confirm workspace trust before building classes for HotSwap.".into());
        }
        let session_request = SessionRequest {
            workspace_id: request.workspace_id,
            generation: request.generation,
            session_id: request.session_id,
        };
        let debug_job = self.session(binding, &session_request)?;
        let current = debug_job.read()?;
        let debugger = current
            .debugger_state
            .as_ref()
            .ok_or("Wait for the JDI debugger to initialize before building for HotSwap.")?;
        if !debug_job.request.trusted
            || !["debug", "attach"].contains(&current.operation.as_str())
            || current.state != "running"
            || debug_job.request.configuration.debugger_mode != "jdi"
            || !debugger.can_reload_classes
            || debugger.status == structured_debugger::Status::Terminated
            || !current_workspace_binding_is_current(binding)
        {
            return Err("Build for HotSwap requires the current trusted JDI session.".into());
        }
        self.validate_debugger_class_outputs(&debug_job)?;
        let before_classes = class_changes::capture(&debug_job);

        let mut build_request = debug_job.request.clone();
        build_request.operation = "build".into();
        build_request.source_breakpoints.clear();
        build_request.test_selection = None;
        build_request.testng_selection = false;
        let build_session_id =
            format!("java-build-{}", NEXT_SESSION.fetch_add(1, Ordering::SeqCst));
        let build_job = Arc::new(Job {
            binding: binding.clone(),
            request: build_request.clone(),
            test_selections: Vec::new(),
            maven_test_projects: None,
            project_context: debug_job.project_context.clone(),
            cancelled: AtomicBool::new(false),
            sources: Mutex::new(None),
            debugger_source_roots: Mutex::new(None),
            debugger_class_output_roots: Mutex::new(None),
            class_reload: Mutex::new(None),
            application_input: None,
            child: Mutex::new(None),
            test_tool_child: Mutex::new(None),
            test_listener_port: Mutex::new(None),
            snapshot: Mutex::new(Snapshot {
                workspace_id: build_request.workspace_id.clone(),
                generation: build_request.generation,
                session_id: build_session_id,
                operation: "build".into(),
                state: "running".into(),
                output: String::new(),
                output_truncated: false,
                exit_code: None,
                profile_path: None,
                test_results: None,
                coverage: None,
                test_jvm_options_error: None,
                test_discovery: None,
                debugger_state: None,
                class_reload: None,
                application_input: None,
                can_debug_failed_tests: false,
                compiler_diagnostics: compiler_diagnostics::Report::default(),
            }),
        });

        let plan = if let Some(selection) = build_job.project_context.as_ref() {
            let provider = self
                .project_context
                .as_ref()
                .ok_or_else(|| "Project-context build is unavailable.".to_string());
            provider.and_then(|provider| {
                // Saved edits are expected beside a live debugger. Reacquire provider
                // facts as for repeated execution; captured runtime outputs remain
                // checked against this debug session before and after the build.
                project_execution::plan(&build_job, provider, selection, &[], true)
            })
        } else {
            invocation_selected(
                &binding.canonical_root,
                &build_request,
                &[],
                false,
                None,
                None,
            )
        };
        let mut exit_code = match plan {
            Ok(plan) => {
                {
                    let active_job = self
                        .job
                        .lock()
                        .map_err(|_| "Java executor is unavailable.")?;
                    if active_job
                        .as_ref()
                        .is_none_or(|current_job| !Arc::ptr_eq(current_job, &debug_job))
                    {
                        return Err("The debugger session changed before compilation.".into());
                    }
                    let active_snapshot = debug_job.read()?;
                    if active_snapshot.state != "running"
                        || !active_snapshot
                            .debugger_state
                            .as_ref()
                            .is_some_and(|state| {
                                state.can_reload_classes
                                    && state.status != structured_debugger::Status::Terminated
                            })
                    {
                        return Err("The JDI session ended before compilation.".into());
                    }
                    let mut active_build = self
                        .class_reload_build
                        .lock()
                        .map_err(|_| "Java build state is unavailable.")?;
                    if active_build.as_ref().is_some_and(|build| {
                        build.read().is_ok_and(|snapshot| {
                            ["starting", "running"].contains(&snapshot.state.as_str())
                        })
                    }) {
                        return Err("A build for HotSwap is already running.".into());
                    }
                    *active_build = Some(build_job.clone());
                }
                let mut code = 0;
                for invocation in plan {
                    if build_job.cancelled.load(Ordering::SeqCst)
                        || !current_workspace_binding_is_current(binding)
                    {
                        build_job.append(b"The workspace changed during compilation.\n");
                        code = 1;
                        break;
                    }
                    match execute(&build_job, invocation) {
                        Ok(status) if status == 0 => {}
                        Ok(status) => {
                            code = status;
                            break;
                        }
                        Err(error) => {
                            build_job.append(error.as_bytes());
                            code = 1;
                            break;
                        }
                    }
                }
                if build_job.cancelled.load(Ordering::SeqCst) {
                    build_job.append(b"Compilation was stopped with the debugger session.\n");
                    code = 1;
                }
                code
            }
            Err(error) => {
                build_job.append(error.as_bytes());
                1
            }
        };
        if !current_workspace_binding_is_current(binding) {
            exit_code = 1;
            build_job.append(b"The workspace changed before the build result was accepted.\n");
        }
        if exit_code == 0 {
            if let Err(error) = self.validate_debugger_class_outputs(&debug_job) {
                exit_code = 1;
                build_job.append(error.as_bytes());
            }
        }
        let result = build_job.read()?;
        let class_changes = if exit_code == 0 {
            class_changes::compare(&debug_job, before_classes)
        } else {
            class_changes::Changes::unavailable(
                "The build failed; changed classes are unavailable.",
            )
        };
        if let Ok(mut active_build) = self.class_reload_build.lock() {
            if active_build
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, &build_job))
            {
                *active_build = None;
            }
        }
        Ok(ClassReloadBuildResult {
            workspace_id: current.workspace_id,
            generation: current.generation,
            session_id: current.session_id,
            state: if exit_code == 0 {
                "succeeded"
            } else {
                "failed"
            }
            .into(),
            exit_code,
            output: result.output,
            output_truncated: result.output_truncated,
            class_changes,
        })
    }
    pub(crate) fn rerun_failed(
        &self,
        binding: CurrentWorkspaceBinding,
        request: RerunRequest,
    ) -> Result<Snapshot, String> {
        if !request.trusted {
            return Err("Confirm workspace trust before rerunning failed tests.".into());
        }
        let job = self.session(
            &binding,
            &SessionRequest {
                workspace_id: request.workspace_id,
                generation: request.generation,
                session_id: request.session_id.clone(),
            },
        )?;
        let snapshot = job.read()?;
        if !["failed", "succeeded"].contains(&snapshot.state.as_str()) {
            return Err("Wait for the Java test task to complete before rerun.".into());
        }
        let results = snapshot.test_results.ok_or("This session has no structured test results.")?;
        let (mut captured, selections, maven_test_projects) = if request.debug {
            debug_test::failed_request(&job.request, &results, job.project_context.is_none())?
        } else {
            (job.request.clone(), results.failed_selections()?, results.maven_rerun_projects()?)
        };
        captured.trusted = request.trusted;
        captured.source_breakpoints = request.source_breakpoints;
        debugger_sources::validate_initial(&captured)?;
        self.start_selected(
            binding,
            captured,
            selections,
            maven_test_projects,
            Some(&request.session_id),
            job.project_context.clone(),
        )
    }
    pub(crate) fn restart(
        &self,
        binding: CurrentWorkspaceBinding,
        request: RestartRequest,
    ) -> Result<Snapshot, String> {
        if !request.trusted {
            return Err("Confirm workspace trust before restarting Java execution.".into());
        }
        let session = SessionRequest {
            workspace_id: request.workspace_id,
            generation: request.generation,
            session_id: request.session_id.clone(),
        };
        let job = self.session(&binding, &session)?;
        let stop_previous = match job.request.operation.as_str() {
            "run" | "debug" | "debug-test" | "debug-integration-test" => true,
            "test" | "integration-test" | "coverage" | "integration-coverage" => {
                if !matches!(job.read()?.state.as_str(), "succeeded" | "failed") {
                    return Err("Wait for the Java test task to complete before rerun.".into());
                }
                false
            }
            _ => return Err("Select an IDE-launched Run, Debug or completed test session.".into()),
        };
        let mut captured = job.request.clone();
        captured.trusted = request.trusted;
        captured.source_breakpoints = request.source_breakpoints;
        debugger_sources::validate_initial(&captured)?;
        if let Some(selection) = job.project_context.as_ref() {
            self.project_context
                .as_ref()
                .ok_or("Project-context execution is unavailable.")?
                .validate_retained(&binding, session.generation, selection)?;
        }
        // Stop waits for the owned process, including an active HotSwap build.
        // start_selected then checks this exact session before replacing it.
        if stop_previous {
            let current = self
                .job
                .lock()
                .map_err(|_| "Java executor is unavailable.")?;
            if current
                .as_ref()
                .is_none_or(|current| !Arc::ptr_eq(current, &job))
            {
                return Err("The Java session changed before restart.".into());
            }
            let build = self
                .class_reload_build
                .lock()
                .map_err(|_| "Java build state is unavailable.")?
                .clone();
            job.stop();
            if let Some(build) = build {
                build.stop();
            }
        }
        self.start_selected(
            binding,
            captured,
            job.test_selections.clone(),
            job.maven_test_projects.clone(),
            Some(&request.session_id),
            job.project_context.clone(),
        )
    }
    fn session(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<Arc<Job>, String> {
        let job = self
            .job
            .lock()
            .map_err(|_| "Java executor is unavailable.")?
            .clone()
            .ok_or("No Java session exists.")?;
        let snapshot = job.read()?;
        if job.binding != *binding
            || snapshot.workspace_id != request.workspace_id
            || snapshot.generation != request.generation
            || snapshot.session_id != request.session_id
        {
            return Err("The Java session is stale or belongs to another workspace.".into());
        }
        Ok(job)
    }
    pub(crate) fn snapshot_at(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<Snapshot, String> {
        self.session(binding, request)?.read()
    }
    pub(crate) fn debug_command_at(
        &self, binding: &CurrentWorkspaceBinding, request: DebugRequest,
    ) -> Result<(), String> {
        if !validate_debug_command(&request.command) {
            return Err("Unsupported debugger command.".into());
        }
        let job = self.session(
            binding,
            &SessionRequest {
                workspace_id: request.workspace_id,
                generation: request.generation,
                session_id: request.session_id,
            },
        )?;
        let snapshot = job.read()?;
        if job.request.configuration.debugger_mode == "jdi" {
            return Err("Use structured actions for the JDI debugger.".into());
        }
        if snapshot.operation != "debug"
            || snapshot.state != "running"
            || job.cancelled.load(Ordering::SeqCst)
        {
            return Err("The debugger is not running.".into());
        }
        let mut current = job
            .child
            .lock()
            .map_err(|_| "The debugger is unavailable.")?;
        if job.cancelled.load(Ordering::SeqCst) || !current_workspace_binding_is_current(&job.binding) {
            return Err("The debugger session is obsolete.".into());
        }
        let input = current
            .as_mut()
            .and_then(|child| child.stdin.as_mut())
            .ok_or("The debugger is not ready; compilation may still be running.")?;
        debugger_input::send(input, &request.command)
    }
    pub(crate) fn application_input_at(
        &self, binding: &CurrentWorkspaceBinding, request: &ApplicationInputRequest,
    ) -> Result<ApplicationInputResult, String> {
        use base64::Engine;
        let bytes = request.data_base64.as_ref().map(|value| {
            if value.len() > application_input::CHUNK_LIMIT.div_ceil(3) * 4 {
                return Err("Application input chunk is too large.");
            }
            base64::engine::general_purpose::STANDARD.decode(value)
                .map_err(|_| "Application input must be valid base64.")
        }).transpose()?;
        // Hold the current-session lock through the nonblocking write, so replacement
        // cannot route a late request into the previous application.
        let current = self.job.lock().map_err(|_| "Java executor is unavailable.")?;
        let job = current.as_ref().ok_or("No Java session exists.")?;
        let snapshot = job.read()?;
        if job.binding != *binding || snapshot.workspace_id != request.workspace_id
            || snapshot.generation != request.generation || snapshot.session_id != request.session_id
        { return Err("The application input session is obsolete.".into()); }
        let input = job.application_input.as_ref().ok_or("Application input was not enabled for this launch.")?;
        let acknowledgement = input.send(request.sequence, bytes.as_deref(), || current_workspace_binding_is_current(binding))?;
        Ok(ApplicationInputResult { workspace_id: request.workspace_id.clone(), generation: request.generation,
            session_id: request.session_id.clone(), acknowledgement })
    }
    pub(crate) fn analyze_flight_recording_at(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &FlightRecordingAnalysisRequest,
    ) -> Result<FlightRecordingAnalysis, String> {
        if !request.trusted {
            return Err("Confirm workspace trust before analyzing a Java recording.".into());
        }
        let session = SessionRequest {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            session_id: request.session_id.clone(),
        };
        let job = self.session(binding, &session)?;
        if !job.request.trusted || job.request.operation != "run" || !job.request.profile {
            return Err("This Java session did not create a Flight Recorder recording.".into());
        }
        let snapshot = job.read()?;
        if !["succeeded", "failed"].contains(&snapshot.state.as_str()) {
            return Err(
                "Wait for the Java Run session to finish before analyzing its recording.".into(),
            );
        }
        let profile_path = snapshot
            .profile_path
            .clone()
            .ok_or("The Java Run session did not produce a readable Flight Recorder file.")?;
        let recording = resolve_existing_path_in_root(&binding.canonical_root, &profile_path)?;
        let metadata = fs::metadata(&recording)
            .map_err(|_| "The Java Flight Recorder file is unavailable.")?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("The Java Flight Recorder file is empty or unavailable.".into());
        }
        let home = selected_jdk(&job.request.configuration.jdk_home)?;
        let summary = flight_recording::summarize(&home, &recording)?;
        if !current_workspace_binding_is_current(binding)
            || !self
                .job
                .lock()
                .map_err(|_| "Java executor is unavailable.")?
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &job))
        {
            return Err("The Java session changed while analyzing its recording.".into());
        }
        Ok(FlightRecordingAnalysis {
            workspace_id: snapshot.workspace_id,
            generation: snapshot.generation,
            session_id: snapshot.session_id,
            profile_path,
            summary,
        })
    }
    pub(crate) fn read_flight_recording_timeline_at(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &FlightRecordingTimelineRequest,
    ) -> Result<FlightRecordingTimeline, String> {
        if !request.trusted {
            return Err("Confirm workspace trust before reading a Java recording timeline.".into());
        }
        let session = SessionRequest {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            session_id: request.session_id.clone(),
        };
        let job = self.session(binding, &session)?;
        if !job.request.trusted || job.request.operation != "run" || !job.request.profile {
            return Err("This Java session did not create a Flight Recorder recording.".into());
        }
        let snapshot = job.read()?;
        if !["succeeded", "failed"].contains(&snapshot.state.as_str()) {
            return Err(
                "Wait for the Java Run session to finish before reading its recording timeline."
                    .into(),
            );
        }
        let profile_path = snapshot
            .profile_path
            .clone()
            .ok_or("The Java Run session did not produce a readable Flight Recorder file.")?;
        let recording = resolve_existing_path_in_root(&binding.canonical_root, &profile_path)?;
        let metadata = fs::metadata(&recording)
            .map_err(|_| "The Java Flight Recorder file is unavailable.")?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("The Java Flight Recorder file is empty or unavailable.".into());
        }
        let home = selected_jdk(&job.request.configuration.jdk_home)?;
        let timeline = flight_recording::timeline(&home, &recording, &request.event_type)?;
        if !current_workspace_binding_is_current(binding)
            || !self
                .job
                .lock()
                .map_err(|_| "Java executor is unavailable.")?
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &job))
        {
            return Err("The Java session changed while reading its recording timeline.".into());
        }
        Ok(FlightRecordingTimeline {
            workspace_id: snapshot.workspace_id,
            generation: snapshot.generation,
            session_id: snapshot.session_id,
            profile_path,
            timeline,
        })
    }
    pub(crate) fn stop_at(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &SessionRequest,
    ) -> Result<Snapshot, String> {
        let job = self.session(binding, request)?;
        job.stop();
        let build = self
            .class_reload_build
            .lock()
            .map_err(|_| "Java build state is unavailable.")?
            .clone();
        if let Some(build) = build {
            build.stop();
        }
        job.read()
    }
    pub(crate) fn debug_action_at(
        &self,
        binding: &CurrentWorkspaceBinding,
        request: &structured_debugger::ActionRequest,
    ) -> Result<(), String> {
        let job = self.session(binding, &request.session())?;
        structured_debugger::send(&job, &request.action)
    }
    pub fn shutdown_all(&self) {
        let current = self.job.lock().ok().and_then(|current| current.clone());
        let build = self
            .class_reload_build
            .lock()
            .ok()
            .and_then(|build| build.clone());
        if let Some(job) = current {
            job.stop();
        }
        if let Some(build) = build {
            build.stop();
        }
    }
}

impl Drop for JavaExecutionState {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

#[tauri::command]
pub fn get_java_execution_capabilities(
    window: WebviewWindow,
    request: Context,
) -> Result<Capabilities, String> {
    capabilities_selected(
        &authorize(&window, &request.workspace_id, request.generation)?,
        request.generation,
        &request.project_path,
        &request.jdk_home,
        request.gradle_executable.as_deref(),
    )
}
#[tauri::command]
pub fn start_java_execution(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: Request,
) -> Result<Snapshot, String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.start(binding, request)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRequest {
    execution: Request,
    project_context: JavaExecutionProjectSelection,
}
#[tauri::command]
pub fn start_java_project_execution(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: ProjectRequest,
) -> Result<Snapshot, String> {
    let binding = authorize(
        &window,
        &request.execution.workspace_id,
        request.execution.generation,
    )?;
    state.start_project(binding, request.execution, request.project_context)
}
#[tauri::command]
pub fn get_java_execution_snapshot(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: SessionRequest,
) -> Result<Snapshot, String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.snapshot_at(&binding, &request)
}
#[tauri::command]
pub async fn analyze_java_flight_recording(
    window: WebviewWindow,
    request: FlightRecordingAnalysisRequest,
) -> Result<FlightRecordingAnalysis, String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(&window, &request.workspace_id, request.generation)?;
        window
            .app_handle()
            .state::<JavaExecutionState>()
            .analyze_flight_recording_at(&binding, &request)
    })
    .await
}
#[tauri::command]
pub async fn read_java_flight_recording_timeline(
    window: WebviewWindow,
    request: FlightRecordingTimelineRequest,
) -> Result<FlightRecordingTimeline, String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(&window, &request.workspace_id, request.generation)?;
        window
            .app_handle()
            .state::<JavaExecutionState>()
            .read_flight_recording_timeline_at(&binding, &request)
    })
    .await
}
#[tauri::command]
pub fn stop_java_execution(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: SessionRequest,
) -> Result<Snapshot, String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.stop_at(&binding, &request)
}
#[tauri::command]
pub fn rerun_java_failed_tests(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: RerunRequest,
) -> Result<Snapshot, String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.rerun_failed(binding, request)
}
#[tauri::command]
pub async fn restart_java_execution(
    window: WebviewWindow,
    request: RestartRequest,
) -> Result<Snapshot, String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(&window, &request.workspace_id, request.generation)?;
        window
            .app_handle()
            .state::<JavaExecutionState>()
            .restart(binding, request)
    })
    .await
}
fn validate_debug_command(command: &str) -> bool {
    if command.len() > 1024 || command.contains(['\n', '\r', '\0']) {
        return false;
    }
    if [
        "cont", "next", "step", "step up", "where", "locals", "threads",
    ]
    .contains(&command)
    {
        return true;
    }
    if let Some(value) = command
        .strip_prefix("stop at ")
        .or_else(|| command.strip_prefix("clear "))
    {
        return value.rsplit_once(':').is_some_and(|(class, line)| {
            main_class(class) && line.parse::<u32>().is_ok_and(|line| line > 0)
        });
    }
    if let Some(method) = command.strip_prefix("stop in ") {
        return main_class(method);
    }
    command
        .strip_prefix("print ")
        .is_some_and(|expression| !expression.trim().is_empty())
}
#[tauri::command]
pub fn send_java_application_input(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: ApplicationInputRequest,
) -> Result<ApplicationInputResult, String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.application_input_at(&binding, &request)
}

#[tauri::command]
pub fn send_java_debug_command(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: DebugRequest,
) -> Result<(), String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.debug_command_at(&binding, request)
}

#[tauri::command]
pub fn send_java_debug_action(
    window: WebviewWindow,
    state: State<'_, JavaExecutionState>,
    request: structured_debugger::ActionRequest,
) -> Result<(), String> {
    let binding = authorize(&window, &request.workspace_id, request.generation)?;
    state.debug_action_at(&binding, &request)
}

#[tauri::command]
pub async fn reload_java_classes(
    window: WebviewWindow,
    request: class_reload::Request,
) -> Result<(), String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(&window, &request.workspace_id, request.generation)?;
        let state = window.app_handle().state::<JavaExecutionState>();
        let job = state.session(&binding, &request.session())?;
        state.validate_debugger_class_outputs(&job)?;
        class_reload::send(&job, &request)
    })
    .await
}

#[tauri::command]
pub async fn build_java_for_class_reload(
    window: WebviewWindow,
    request: ClassReloadBuildRequest,
) -> Result<ClassReloadBuildResult, String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(&window, &request.workspace_id, request.generation)?;
        let state = window.app_handle().state::<JavaExecutionState>();
        state.build_for_class_reload_at(&binding, request)
    })
    .await
}

#[tauri::command]
pub async fn get_java_debug_source(
    window: WebviewWindow,
    request: debugger_sources::SourceRequest,
) -> Result<debugger_sources::SourceView, String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(&window, &request.workspace_id, request.generation)?;
        let state = window.app_handle().state::<JavaExecutionState>();
        let job = state.session(&binding, &request.session())?;
        debugger_sources::inspect(&job, &request)
    })
    .await
}

#[tauri::command]
pub async fn toggle_java_source_breakpoint(
    window: WebviewWindow,
    request: debugger_sources::BreakpointRequest,
) -> Result<(), String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(
            &window,
            &request.source.workspace_id,
            request.source.generation,
        )?;
        let state = window.app_handle().state::<JavaExecutionState>();
        let job = state.session(&binding, &request.source.session())?;
        debugger_sources::toggle(&job, &request)
    })
    .await
}

#[tauri::command]
pub async fn run_java_to_cursor(
    window: WebviewWindow,
    request: debugger_sources::RunToCursorRequest,
) -> Result<(), String> {
    super::blocking::run(move || {
        use tauri::Manager;
        let binding = authorize(
            &window,
            &request.source.workspace_id,
            request.source.generation,
        )?;
        let state = window.app_handle().state::<JavaExecutionState>();
        let job = state.session(&binding, &request.source.session())?;
        debugger_sources::run_to_cursor(&job, &request)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    mod application_input_tests;
    mod compiler_diagnostics_tests;
    mod gradle_selection_tests;
    mod attach_tests;
    mod class_reload_tests;
    mod conditional_debugger_tests;
    mod coverage_tests;
    mod debug_test_tests;
    mod failsafe_reactor_tests;
    mod launch_settings_tests;
    mod plain_jdk_tests;
    mod restart_tests;
    mod structured_debugger_tests;
    mod test_discovery_tests;
    mod test_jvm_settings_tests;
    mod working_directory_tests;
    #[test]
    fn plain_jdk_junit_uses_explicit_classpath_and_exact_method_selector() {
        let (root, _) = fixture();
        let classes = root.join(".ide/java/classes");
        let dependency = root.join("lib/junit-platform-console-standalone.jar");
        fs::create_dir_all(&classes).unwrap();
        fs::create_dir_all(dependency.parent().unwrap()).unwrap();
        fs::write(&dependency, "fixture dependency path").unwrap();
        let home = root.join("selected-jdk");
        let invocation = jdk_test_invocation(
            &root,
            &root,
            &home,
            &home.join("bin/java"),
            &classes,
            std::slice::from_ref(&dependency),
            &["-Dfixture.test.jvm=selected".into()],
            "",
            &["example.SampleTest#works".into()],
            None,
        )
        .unwrap();
        assert_eq!(invocation.java_home, home);
        assert!(invocation
            .test_report_path
            .as_deref()
            .unwrap()
            .starts_with(".ide/java/test-results/run-"));
        assert!(invocation.arguments[0].starts_with('@'));
        let launch = fs::read_to_string(&invocation.launch_file.as_ref().unwrap().path).unwrap();
        for expected in [
            "-Dfixture.test.jvm=selected",
            "org.junit.platform.console.ConsoleLauncher",
            "--select-method",
            "example.SampleTest#works",
            "--reports-dir=",
            classes.to_str().unwrap(),
            dependency.to_str().unwrap(),
        ] {
            assert!(launch.contains(expected), "missing {expected} in {launch}");
        }
        assert!(!launch.contains("--scan-class-path"));
        drop(invocation);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn plain_jdk_junit_scan_refuses_wildcards_and_fails_if_no_tests() {
        let (root, _) = fixture();
        let classes = root.join(".ide/java/classes");
        fs::create_dir_all(&classes).unwrap();
        let home = root.join("selected-jdk");
        assert!(jdk_test_invocation(
            &root,
            &root,
            &home,
            &home.join("bin/java"),
            &classes,
            &[],
            &[],
            "example.*Test",
            &[],
            None,
        )
        .is_err());
        let invocation = jdk_test_invocation(
            &root,
            &root,
            &home,
            &home.join("bin/java"),
            &classes,
            &[],
            &[],
            "",
            &[],
            None,
        )
        .unwrap();
        let launch = fs::read_to_string(&invocation.launch_file.as_ref().unwrap().path).unwrap();
        assert!(launch.contains("--fail-if-no-tests"));
        assert!(launch.contains("--scan-class-path="));
        drop(invocation);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn plain_jdk_testng_uses_native_runner_and_junit_xml_reports() {
        let (root, _) = fixture();
        let classes = root.join(".ide/java/classes");
        let dependency = root.join("lib/testng.jar");
        let home = root.join("selected-jdk");
        fs::create_dir_all(&classes).unwrap();
        fs::create_dir_all(dependency.parent().unwrap()).unwrap();
        fs::write(&dependency, "fixture dependency path").unwrap();
        fs::create_dir_all(home.join("bin")).unwrap();
        fs::write(home.join("bin/jar"), "selected JDK jar tool").unwrap();

        let all = jdk_testng_invocations(
            &root,
            &root,
            &home,
            &home.join("bin/java"),
            &classes,
            std::slice::from_ref(&dependency),
            &["-Dfixture.test.jvm=selected".into()],
            "",
            &[],
            None,
        )
        .unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].executable, home.join("bin/jar"));
        assert!(all[0].arguments.iter().any(|value| value == "--create"));
        assert!(all[0]
            .arguments
            .iter()
            .any(|value| value.ends_with("compiled-tests.jar")));
        let launcher = fs::read_to_string(&all[1].launch_file.as_ref().unwrap().path).unwrap();
        for expected in [
            "-Dfixture.test.jvm=selected",
            "org.testng.TestNG",
            "-testjar",
            "org.testng.reporters.JUnitXMLReporter",
            dependency.to_str().unwrap(),
        ] {
            assert!(
                launcher.contains(expected),
                "missing {expected} in {launcher}"
            );
        }
        assert!(all[1]
            .test_report_path
            .as_deref()
            .unwrap()
            .starts_with(".ide/java/test-results/run-"));

        let selected = jdk_testng_invocations(
            &root,
            &root,
            &home,
            &home.join("bin/java"),
            &classes,
            std::slice::from_ref(&dependency),
            &[],
            "",
            &["example.SampleTest#works".into()],
            None,
        )
        .unwrap();
        assert_eq!(selected.len(), 1);
        let launcher = fs::read_to_string(&selected[0].launch_file.as_ref().unwrap().path).unwrap();
        assert!(launcher.contains("-methods"));
        assert!(launcher.contains("example.SampleTest.works"));
        assert!(!launcher.contains("-testjar"));
        assert!(jdk_testng_invocations(
            &root,
            &root,
            &home,
            &home.join("bin/java"),
            &classes,
            &[dependency],
            &[],
            "",
            &["example.*Test#works".into()],
            None,
        )
        .is_err());
        drop(all);
        drop(selected);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn plain_jdk_report_storage_refuses_symlinked_internal_directories() {
        use std::os::unix::fs::symlink;
        let (root, _) = fixture();
        let target = root.join("unrelated-data");
        fs::create_dir(&target).unwrap();
        let report_parent = root.join(".ide/java");
        fs::create_dir_all(&report_parent).unwrap();
        symlink(&target, report_parent.join("test-results")).unwrap();
        assert!(jdk_test_report_directory(&root).is_err());
        assert!(target.is_dir());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn debugger_commands_reject_multiline_and_process_launch_commands() {
        for command in [
            "cont",
            "next",
            "stop at example.Main:12",
            "stop in example.Main.main",
            "print value + 1",
        ] {
            assert!(validate_debug_command(command), "{command}");
        }
        for command in [
            "run",
            "exec bash",
            "stop at Main:0",
            "cont\nexit",
            "print \nrun",
            "stop at ../Main:1",
        ] {
            assert!(!validate_debug_command(command), "{command}");
        }
    }
    #[test]
    fn gradle_coverage_reporting_keeps_captured_project_settings_and_drops_test_only_args() {
        let (root, _) = fixture();
        let artifact = coverage::CoverageArtifact::create(
            &root,
            &root,
            "",
            "gradle",
            Some("integrationTest"),
            &[],
            &["example.Test#method".into()],
            false,
            Some(&root),
        )
        .unwrap();
        let task = artifact.gradle_task().unwrap();
        let captured = vec![
            "--no-daemon".into(),
            "--console=plain".into(),
            format!(":app:{task}"),
            "--init-script".into(),
            "/tmp/test-options.gradle".into(),
            "--gradle-user-home".into(),
            "/tmp/gradle-home".into(),
            "-Pprofile=ci".into(),
            "--init-script".into(),
            artifact.settings.path.to_string_lossy().into_owned(),
            "--rerun-tasks".into(),
            "--tests".into(),
            "example.Test.method".into(),
        ];

        let arguments = gradle_coverage_report_arguments(&captured, &artifact).unwrap();
        assert_eq!(
            arguments,
            vec![
                "--no-daemon".to_owned(),
                "--console=plain".to_owned(),
                "--gradle-user-home".to_owned(),
                "/tmp/gradle-home".to_owned(),
                "-Pprofile=ci".to_owned(),
                "--init-script".to_owned(),
                artifact.settings.path.to_str().unwrap().to_owned(),
                format!(":{}", artifact.gradle_report_task().unwrap()),
            ]
        );
        let build_root = root.join("included-build");
        let gradle = root.join("bin/gradle");
        let report = gradle_coverage_report_invocation(
            &build_root,
            &gradle,
            &captured,
            Arc::new(artifact),
            PathBuf::from("/project-jdk"),
        )
        .unwrap();
        assert_eq!(report.directory, build_root);
        assert_eq!(report.executable, gradle);
        assert_eq!(report.arguments, arguments);
        assert!(!report.interactive);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn launch_class_rejects_options_and_shell_fragments() {
        assert!(main_class("example.Main$Nested"));
        for value in ["", "-jar", "Main;rm", "../Main", "Main\n", "a..Main"] {
            assert!(!main_class(value));
        }
    }
    #[test]
    fn project_directories_are_workspace_authorized_and_old_configuration_remains_usable() {
        let (root, _) = fixture();
        let module = root.join("modules/service");
        fs::create_dir_all(&module).unwrap();
        assert_eq!(execution_root(&root, "").unwrap(), root);
        assert_eq!(execution_root(&root, "modules/service").unwrap(), module);
        for path in ["../", "/tmp", "Main.java", "missing", "bad\0path"] {
            assert!(execution_root(&root, path).is_err(), "{path:?}");
        }
        let old: Configuration = serde_json::from_value(serde_json::json!({
            "buildTool": "auto", "mainClass": "Main", "classPath": []
        }))
        .unwrap();
        assert!(old.project_path.is_empty());
        assert!(old.test_filter.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selected_tests_are_bounded_class_and_method_patterns_not_command_options() {
        for value in [
            "",
            "MainTest",
            "example.MainTest#computes",
            "example.*Test#fast*",
            "MainTest$Nested",
        ] {
            assert!(test_filter(value), "{value}");
        }
        for value in [
            "-x",
            "../Test",
            "MainTest#",
            "#method",
            "Test##method",
            "Test;exit",
            "Test\nnext",
            "a..Test",
        ] {
            assert!(!test_filter(value), "{value:?}");
        }
        assert!(!test_filter(&"a".repeat(513)));
    }
    #[test]
    #[cfg(unix)]
    fn module_execution_uses_workspace_wrappers_and_refuses_external_symlinks() {
        use std::os::unix::fs::symlink;
        let (root, _) = fixture();
        let (outside, _) = fixture();
        let module = root.join("modules/service");
        fs::create_dir_all(&module).unwrap();
        fs::write(root.join("mvnw"), "workspace wrapper").unwrap();
        assert_eq!(
            build_tool(&module, &root, "mvn").unwrap(),
            root.join("mvnw")
        );
        fs::write(module.join("mvnw"), "module wrapper").unwrap();
        assert_eq!(
            build_tool(&module, &root, "mvn").unwrap(),
            module.join("mvnw")
        );
        fs::remove_file(module.join("mvnw")).unwrap();
        symlink(outside.join("Main.java"), module.join("mvnw")).unwrap();
        assert!(build_tool(&module, &root, "mvn").is_none());
        fs::write(root.join("gradlew"), "workspace Gradle wrapper").unwrap();
        assert_eq!(
            build_tool(&module, &root, "gradle").unwrap(),
            root.join("gradlew")
        );
        fs::write(module.join("gradlew"), "module Gradle wrapper").unwrap();
        assert_eq!(
            build_tool(&module, &root, "gradle").unwrap(),
            module.join("gradlew")
        );
        fs::remove_file(module.join("gradlew")).unwrap();
        symlink(outside.join("Main.java"), module.join("gradlew")).unwrap();
        assert!(build_tool(&module, &root, "gradle").is_none());
        symlink(&outside, root.join("external-module")).unwrap();
        assert!(execution_root(&root, "external-module").is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
    fn fixture() -> (PathBuf, CurrentWorkspaceBinding) {
        use std::time::{SystemTime, UNIX_EPOCH};
        let root = std::env::temp_dir().join(format!(
            "ide-java-execution-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Main.java"), "public class Main {\n public static void main(String[] args) {\n  int value = 42;\n  System.out.println(\"JAVA_RUN_OK:\" + value);\n }\n}\n").unwrap();
        let registry = root.join("registry.json");
        super::super::workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = current_workspace_binding_at(&root, &registry).unwrap();
        (root, binding)
    }
    fn request(binding: &CurrentWorkspaceBinding, operation: &str) -> Request {
        Request {
            workspace_id: binding.workspace_id.clone(),
            generation: 1,
            operation: operation.into(),
            trusted: true,
            profile: false,
            source_breakpoints: vec![],
            test_selection: None,
            gradle_preparation: None,
            maven_preparation: None,
            testng_selection: false,
            maven_discovered_module_only: false,
            configuration: Configuration {
                build_tool: "jdk".into(),
                main_class: "Main".into(),
                class_path: vec![],
                launch_as_module: false,
                project_path: String::new(),
                test_filter: String::new(),
                test_framework: default_test_framework(),
                test_report_paths: vec![],
                working_directory: String::new(),
                application_input: false,
                program_arguments: vec![],
                jvm_options: vec![],
                test_jvm_options: vec![],
                environment: vec![],
                jdk_home: String::new(),
                debugger_mode: default_debugger_mode(),
                debugger_attach: None,
            },
        }
    }
    fn wait_for(job: &Arc<Job>, predicate: impl Fn(&Snapshot) -> bool) -> Snapshot {
        let deadline = std::time::Instant::now() + Duration::from_secs(90);
        loop {
            let snapshot = job.read().unwrap();
            if predicate(&snapshot) {
                return snapshot;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Java fixture timed out: state={}, debugger={:?}, classReload={:?}, output={}",
                snapshot.state,
                snapshot.debugger_state,
                snapshot.class_reload,
                snapshot.output,
            );
            thread::sleep(Duration::from_millis(30));
        }
    }
    #[test]
    #[ignore = "requires an installed full JDK"]
    fn real_jdk_compiles_runs_and_reports_compile_failure() {
        let (root, binding) = fixture();
        let state = JavaExecutionState::default();
        state
            .start(binding.clone(), request(&binding, "run"))
            .unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let snapshot = wait_for(&job, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(snapshot.exit_code, Some(0), "{}", snapshot.output);
        assert!(
            snapshot.output.contains("JAVA_RUN_OK:42"),
            "{}",
            snapshot.output
        );
        fs::write(root.join("Main.java"), "this is not Java").unwrap();
        state
            .start(binding.clone(), request(&binding, "build"))
            .unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let snapshot = wait_for(&job, |snapshot| snapshot.state == "failed");
        assert_ne!(snapshot.exit_code, Some(0));
        assert!(snapshot.output.contains("error"));
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires an installed full JDK"]
    fn real_jdk_runs_unicode_binary_name_accepted_by_the_selected_compiler() {
        let (root, binding) = fixture();
        let home = selected_jdk("").unwrap();
        let name = "café.Avvío𐐀";
        let source = root.join("Avvío𐐀.java");
        fs::write(&source, "package café; public class Avvío𐐀 { public static void main(String[] args) { System.out.println(\"UNICODE_JAVA_RUN_OK\"); } }\n").unwrap();
        let oracle = root.join("oracle"); fs::create_dir(&oracle).unwrap();
        let compiled = Command::new(home.join("bin").join(executable_name("javac"))).args(["-encoding", "UTF-8", "-d"]).arg(&oracle).arg(&source).output().unwrap();
        assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
        let ran = Command::new(home.join("bin").join(executable_name("java"))).arg("-cp").arg(&oracle).arg(name).output().unwrap();
        assert!(ran.status.success(), "{}", String::from_utf8_lossy(&ran.stderr));
        assert!(String::from_utf8_lossy(&ran.stdout).contains("UNICODE_JAVA_RUN_OK"));
        let state = JavaExecutionState::default();
        let mut launch = request(&binding, "run"); launch.configuration.main_class = name.into();
        state.start(binding, launch).unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let snapshot = wait_for(&job, |snapshot| !["starting", "running"].contains(&snapshot.state.as_str()));
        assert_eq!(snapshot.exit_code, Some(0), "{}", snapshot.output);
        assert!(snapshot.output.contains("UNICODE_JAVA_RUN_OK"), "{}", snapshot.output);
        state.shutdown_all(); fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires a JDK with Java Flight Recorder and the jfr tool"]
    fn real_jdk_run_with_flight_recorder_writes_a_readable_project_recording() {
        let (root, binding) = fixture();
        let home = selected_jdk("").unwrap();
        if !flight_recording::available(&home) {
            return;
        }
        let executor = JavaExecutionState::default();
        let mut launch = request(&binding, "run");
        launch.profile = true;
        executor.start(binding.clone(), launch).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let completed = wait_for(&job, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(completed.state, "succeeded", "{}", completed.output);
        let profile = completed
            .profile_path
            .expect("successful profile run should report its recording");
        let profile_file = root.join(&profile);
        assert!(profile_file.is_file());
        assert!(fs::metadata(&profile_file).unwrap().len() > 0);
        let summary = Command::new(home.join("bin").join(executable_name("jfr")))
            .args(["summary", profile_file.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(
            summary.status.success(),
            "{}",
            String::from_utf8_lossy(&summary.stderr)
        );
        executor.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "requires an installed full JDK and jdb"]
    fn real_jdb_breakpoint_stack_locals_and_stop() {
        let (root, binding) = fixture();
        let state = JavaExecutionState::default();
        state
            .start(binding.clone(), request(&binding, "debug"))
            .unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        wait_for(&job, |snapshot| snapshot.output.contains("VM Started"));
        {
            let mut current = job.child.lock().unwrap();
            let input = current.as_mut().unwrap().stdin.as_mut().unwrap();
            input.write_all(b"stop at Main:4\ncont\n").unwrap();
            input.flush().unwrap();
        }
        wait_for(&job, |snapshot| snapshot.output.contains("Breakpoint hit"));
        {
            let mut current = job.child.lock().unwrap();
            let input = current.as_mut().unwrap().stdin.as_mut().unwrap();
            input.write_all(b"where\nlocals\nprint value\n").unwrap();
            input.flush().unwrap();
        }
        let snapshot = wait_for(&job, |snapshot| snapshot.output.contains("value = 42"));
        assert!(snapshot.output.contains("Main.main"));
        job.stop();
        assert_eq!(job.read().unwrap().state, "stopped");
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    #[ignore = "requires an installed full Java 8 JDK and localhost JDWP"]
    fn real_java8_jdb_reports_the_debuggee_exit_code() {
        let home = selected_jdk("").unwrap();
        assert!(java8_launcher(&home));
        let (root, binding) = fixture();
        fs::write(
            root.join("Main.java"),
            "public class Main { public static void main(String[] args) { System.exit(7); } }",
        ).unwrap();
        let state = JavaExecutionState::default();
        state.start(binding.clone(), request(&binding, "debug")).unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let started = wait_for(&job, |snapshot| {
            snapshot.output.contains("VM Started") || snapshot.state == "failed"
        });
        assert_ne!(started.state, "failed", "{}", started.output);
        {
            let mut current = job.child.lock().unwrap();
            let input = current.as_mut().unwrap().stdin.as_mut().unwrap();
            input.write_all(b"cont\n").unwrap();
            input.flush().unwrap();
        }
        let completed = wait_for(&job, |snapshot| !["running", "starting"].contains(&snapshot.state.as_str()));
        assert_eq!(completed.state, "failed", "{}", completed.output);
        assert_eq!(completed.exit_code, Some(7), "{}", completed.output);
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clean_refuses_plain_jdk_and_untrusted_projects_without_creating_outputs() {
        let (root, binding) = fixture();
        for operation in ["clean", "rebuild"] {
            let mut clean = request(&binding, operation);
            assert!(invocation(&root, &clean).unwrap_err().contains("requires a Maven or Gradle"));
            clean.trusted = false;
            clean.configuration.build_tool = "maven".into();
            assert!(invocation(&root, &clean).unwrap_err().contains("Confirm workspace trust"));
        }
        assert!(!root.join(".ide/java/classes").exists());
        assert!(root.join("Main.java").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires offline Maven and a compatible JDK"]
    fn real_maven_clean_removes_outputs_preserves_sources_and_rebuilds() {
        real_build_tool_clean("maven");
    }
    #[test]
    #[ignore = "requires offline Gradle and a compatible JDK"]
    fn real_gradle_clean_removes_outputs_preserves_sources_and_rebuilds() {
        real_build_tool_clean("gradle");
    }
    fn real_build_tool_clean(kind: &str) {
        let (root, binding) = fixture();
        let source = fs::read_to_string(root.join("Main.java")).unwrap();
        fs::create_dir_all(root.join("src/main/java")).unwrap();
        fs::rename(root.join("Main.java"), root.join("src/main/java/Main.java")).unwrap();
        let descriptor = if kind == "maven" { "pom.xml" } else { "build.gradle" };
        let descriptor_text = if kind == "maven" {
            "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>clean-fixture</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-clean-plugin</artifactId><version>3.5.0</version></plugin></plugins></build></project>"
        } else { "plugins { id 'java' }\n" };
        fs::write(root.join(descriptor), descriptor_text).unwrap();
        if kind == "gradle" { fs::write(root.join("settings.gradle"), "rootProject.name = 'clean-fixture'\n").unwrap(); }
        let output = root.join(if kind == "maven" { "target/classes/Main.class" } else { "build/classes/java/main/Main.class" });
        let executor = JavaExecutionState::default();
        let stale = output.parent().unwrap().join("Stale.class");
        for operation in ["build", "clean", "build", "rebuild"] {
            if operation == "rebuild" { fs::write(&stale, "old compiled output").unwrap(); }
            let mut launch = request(&binding, operation);
            launch.configuration.build_tool = kind.into();
            launch.configuration.main_class.clear();
            executor.start(binding.clone(), launch).unwrap();
            let job = executor.job.lock().unwrap().clone().unwrap();
            let result = wait_for(&job, |s| !["starting", "running"].contains(&s.state.as_str()));
            assert_eq!(result.state, "succeeded", "{}", result.output);
            assert_eq!(result.operation, operation);
            assert_eq!(output.exists(), operation != "clean");
            if operation == "rebuild" { assert!(!stale.exists()); }
            assert_eq!(fs::read_to_string(root.join("src/main/java/Main.java")).unwrap(), source);
            assert_eq!(fs::read_to_string(root.join(descriptor)).unwrap(), descriptor_text);
            assert!(result.test_results.is_none());
        }
        fs::write(root.join("src/main/java/Main.java"), "this is not Java").unwrap();
        let mut broken = request(&binding, "rebuild");
        broken.configuration.build_tool = kind.into();
        executor.start(binding.clone(), broken).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let failed = wait_for(&job, |s| !["starting", "running"].contains(&s.state.as_str()));
        assert_eq!(failed.state, "failed", "{}", failed.output);
        assert_ne!(failed.exit_code, Some(0));
        assert!(!output.exists(), "A failed compilation after Clean must not retain the previous Main.class");
        fs::write(root.join("src/main/java/Main.java"), &source).unwrap();
        let mut repaired = request(&binding, "rebuild");
        repaired.configuration.build_tool = kind.into();
        executor.start(binding.clone(), repaired).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let passed = wait_for(&job, |s| !["starting", "running"].contains(&s.state.as_str()));
        assert_eq!(passed.state, "succeeded", "{}", passed.output);
        assert!(output.exists());
        fs::write(root.join(descriptor), if kind == "maven" { "<invalid>" } else { "throw new GradleException('expected-clean-failure')" }).unwrap();
        for operation in ["clean", "rebuild"] {
            let mut launch = request(&binding, operation);
            launch.configuration.build_tool = kind.into();
            executor.start(binding.clone(), launch).unwrap();
            let job = executor.job.lock().unwrap().clone().unwrap();
            let result = wait_for(&job, |s| !["starting", "running"].contains(&s.state.as_str()));
            assert_eq!(result.state, "failed", "{}", result.output);
            assert_ne!(result.exit_code, Some(0));
            assert!(output.exists());
        }
        assert_eq!(fs::read_to_string(root.join("src/main/java/Main.java")).unwrap(), source);
        executor.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires Maven, a compatible JDK, and dependency access"]
    fn real_maven_runs_main_and_junit_tests() {
        real_build_tool("maven");
    }
    #[test]
    #[ignore = "requires Gradle, a compatible JDK, and dependency access"]
    fn real_gradle_runs_main_and_junit_tests() {
        real_build_tool("gradle");
    }
    fn real_build_tool(kind: &str) {
        let (root, binding) = fixture();
        fs::create_dir_all(root.join("src/main/java")).unwrap();
        fs::create_dir_all(root.join("src/test/java")).unwrap();
        fs::rename(root.join("Main.java"), root.join("src/main/java/Main.java")).unwrap();
        fs::write(root.join("src/test/java/MainTest.java"), "import org.junit.Test; import static org.junit.Assert.*; public class MainTest { @Test public void computes() { assertEquals(42, 6 * 7); } }").unwrap();
        if kind == "maven" {
            fs::write(root.join("pom.xml"), r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>fixture</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies></project>"#).unwrap();
        } else {
            fs::write(
                root.join("settings.gradle"),
                "rootProject.name = 'fixture'\n",
            )
            .unwrap();
            fs::write(root.join("build.gradle"), "plugins { id 'java'; id 'application' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\napplication { mainClass = 'Main' }\n").unwrap();
        }
        let state = JavaExecutionState::default();
        let mut operations = vec![("test", false), ("run", false)];
        if selected_jdk("").is_ok_and(|home| flight_recording::available(&home)) {
            operations.push(("run", true));
        }
        for (operation, profile) in operations {
            let mut request = request(&binding, operation);
            request.configuration.build_tool = kind.into();
            request.profile = profile;
            state.start(binding.clone(), request).unwrap();
            let job = state.job.lock().unwrap().clone().unwrap();
            let snapshot = wait_for(&job, |snapshot| {
                !["starting", "running"].contains(&snapshot.state.as_str())
            });
            assert_eq!(snapshot.state, "succeeded", "{}", snapshot.output);
            if operation == "run" {
                assert!(
                    snapshot.output.contains("JAVA_RUN_OK:42"),
                    "{}",
                    snapshot.output
                );
                if profile {
                    let profile_path = snapshot.profile_path.clone().expect("JFR output path");
                    let path = root.join(&profile_path);
                    assert!(path.is_file());
                    let home = selected_jdk("").unwrap();
                    let summary = Command::new(home.join("bin").join(executable_name("jfr")))
                        .args(["summary", path.to_str().unwrap()])
                        .output()
                        .unwrap();
                    assert!(
                        summary.status.success(),
                        "{}",
                        String::from_utf8_lossy(&summary.stderr)
                    );
                    let analysis_request = FlightRecordingAnalysisRequest {
                        workspace_id: snapshot.workspace_id.clone(),
                        generation: snapshot.generation,
                        session_id: snapshot.session_id.clone(),
                        trusted: false,
                    };
                    assert!(state
                        .analyze_flight_recording_at(&binding, &analysis_request)
                        .is_err());
                    let analysis_request = FlightRecordingAnalysisRequest {
                        trusted: true,
                        ..analysis_request
                    };
                    let analysis = state
                        .analyze_flight_recording_at(&binding, &analysis_request)
                        .unwrap();
                    assert_eq!(analysis.workspace_id, snapshot.workspace_id);
                    assert_eq!(analysis.generation, snapshot.generation);
                    assert_eq!(analysis.session_id, snapshot.session_id);
                    assert_eq!(analysis.profile_path, profile_path);
                    assert!(!analysis.summary.recording_version.is_empty());
                    assert!(!analysis.summary.events.is_empty());
                }
            } else {
                let report = root.join(if kind == "maven" {
                    "target/surefire-reports/TEST-MainTest.xml"
                } else {
                    "build/test-results/test/TEST-MainTest.xml"
                });
                let report = fs::read_to_string(report).unwrap();
                assert!(report.contains("tests=\"1\""));
                assert!(report.contains("failures=\"0\""));
                let results = snapshot.test_results.as_ref().unwrap();
                assert_eq!(results.status, "ready", "{results:?}");
                assert_eq!(results.summary.total, 1);
                assert_eq!(results.summary.passed, 1);
            }
        }
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires Maven 3, a compatible JDK, and cached Maven/JUnit dependencies"]
    fn real_maven_runs_selected_failsafe_tests_and_collects_only_fresh_integration_reports() {
        let (root, binding) = fixture();
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::create_dir_all(root.join("src/test/java/example")).unwrap();
        fs::write(
            root.join("src/main/java/example/Choice.java"),
            "package example; public class Choice { public static int select(boolean positive) { if (positive) return 1; return 2; } }",
        )
        .unwrap();
        fs::write(
            root.join("src/test/java/example/UnitTest.java"),
            "package example; import org.junit.Test; import static org.junit.Assert.*; public class UnitTest { @Test public void passes() { assertEquals(1, Choice.select(true)); } }",
        )
        .unwrap();
        fs::write(
            root.join("src/test/java/example/SampleIT.java"),
            "package example; import org.junit.Test; import static org.junit.Assert.*; public class SampleIT { @Test public void selected() { assertEquals(2, Choice.select(false)); assertEquals(\"selected\", System.getProperty(\"fixture.test.jvm\")); throw new AssertionError(\"repair this integration test\"); } @Test public void notSelected() { throw new AssertionError(\"The Failsafe selector was ignored\"); } }",
        )
        .unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>failsafe</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><executions><execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions></plugin></plugins></build></project>"#,
        )
        .unwrap();

        let state = JavaExecutionState::default();
        let mut launch = request(&binding, "integration-coverage");
        launch.configuration.build_tool = "maven".into();
        launch.configuration.test_filter = "example.SampleIT#selected".into();
        launch.configuration.test_jvm_options = vec!["-Dfixture.test.jvm=selected".into()];
        state.start(binding.clone(), launch).unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let snapshot = wait_for(&job, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(snapshot.state, "failed", "{}", snapshot.output);
        assert!(snapshot.exit_code.is_some_and(|code| code != 0));
        let report = root.join("target/failsafe-reports/TEST-example.SampleIT.xml");
        let report = fs::read_to_string(report).unwrap();
        assert!(report.contains("tests=\"1\""), "{report}");
        assert!(report.contains("name=\"selected\""), "{report}");
        assert!(!report.contains("name=\"notSelected\""), "{report}");
        assert!(report.contains("failures=\"1\""), "{report}");
        assert!(root
            .join("target/surefire-reports/TEST-example.UnitTest.xml")
            .is_file());
        let failed = snapshot.test_results.as_ref().unwrap();
        assert_eq!(failed.status, "ready", "{failed:?}");
        assert_eq!(failed.summary.total, 1);
        assert_eq!(failed.summary.failed, 1);
        assert!(failed.can_rerun_failed, "{failed:?}");
        assert!(failed.test_jvm_options_error.is_none());
        let measured = serde_json::to_value(snapshot.coverage.as_ref().unwrap()).unwrap();
        assert_eq!(
            measured["status"], "ready",
            "{measured}\n{}",
            snapshot.output
        );
        assert_eq!(measured["counters"]["branches"]["covered"], 2);
        assert_eq!(measured["counters"]["branches"]["missed"], 0);
        assert!(measured["files"].as_array().unwrap().iter().any(|file| {
            file["name"] == "Choice.java"
                && file["reportPath"] == "target/site/jacoco-it/jacoco.xml"
        }));

        fs::write(
            root.join("src/test/java/example/SampleIT.java"),
            "package example; import org.junit.Test; import static org.junit.Assert.*; public class SampleIT { @Test public void selected() { assertEquals(2, Choice.select(false)); assertEquals(\"selected\", System.getProperty(\"fixture.test.jvm\")); } @Test public void notSelected() { throw new AssertionError(\"The Failsafe selector was ignored\"); } }",
        )
        .unwrap();
        state
            .rerun_failed(
                binding.clone(),
                RerunRequest {
                    workspace_id: binding.workspace_id.clone(),
                    generation: 1,
                    session_id: snapshot.session_id,
                    trusted: true,
                    debug: false,
                    source_breakpoints: vec![],
                },
            )
            .unwrap();
        let repaired = state.job.lock().unwrap().clone().unwrap();
        let repaired = wait_for(&repaired, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(repaired.operation, "integration-coverage");
        assert_eq!(repaired.state, "succeeded", "{}", repaired.output);
        assert!(repaired.test_jvm_options_error.is_none());
        let report =
            fs::read_to_string(root.join("target/failsafe-reports/TEST-example.SampleIT.xml"))
                .unwrap();
        assert!(report.contains("tests=\"1\""), "{report}");
        assert!(report.contains("failures=\"0\""), "{report}");
        assert!(report.contains("name=\"selected\""), "{report}");
        assert!(!report.contains("name=\"notSelected\""), "{report}");
        let results = repaired.test_results.as_ref().unwrap();
        assert_eq!(results.status, "ready", "{results:?}");
        assert_eq!(results.summary.total, 1);
        assert_eq!(results.summary.passed, 1);
        let measured = serde_json::to_value(repaired.coverage.as_ref().unwrap()).unwrap();
        assert_eq!(
            measured["status"], "ready",
            "{measured}\n{}",
            repaired.output
        );
        assert_eq!(measured["counters"]["branches"]["covered"], 2);
        assert_eq!(measured["counters"]["branches"]["missed"], 0);
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires Maven, a compatible JDK, and dependency access"]
    fn real_maven_selects_a_method_in_a_workspace_module() {
        real_selected_test("maven");
    }
    #[test]
    #[ignore = "requires Gradle, a compatible JDK, and dependency access"]
    fn real_gradle_selects_a_method_in_a_workspace_module() {
        real_selected_test("gradle");
    }
    fn real_selected_test(kind: &str) {
        let (root, binding) = fixture();
        fs::write(
            root.join("Main.java"),
            "root source must not be compiled by the selected module",
        )
        .unwrap();
        let module = root.join("modules/service");
        fs::create_dir_all(module.join("src/test/java")).unwrap();
        fs::write(module.join("src/test/java/SelectedTest.java"),
            "import org.junit.Test; import static org.junit.Assert.*; public class SelectedTest { @Test public void selected() { assertEquals(42, 6 * 7); } @Test public void other() { fail(\"unselected method ran\"); } }").unwrap();
        if kind == "maven" {
            fs::write(module.join("pom.xml"), r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>selected</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies></project>"#).unwrap();
        } else {
            fs::write(
                root.join("settings.gradle"),
                "rootProject.name = 'selection'\ninclude 'modules:service'\n",
            )
            .unwrap();
            fs::write(module.join("build.gradle"), "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\n").unwrap();
        }
        let state = JavaExecutionState::default();
        let mut selected = request(&binding, "test");
        selected.configuration.build_tool = "auto".into();
        selected.configuration.project_path = "modules/service".into();
        selected.configuration.test_filter = "SelectedTest#selected".into();
        let caps = capabilities(&binding, 1, &selected.configuration.project_path, "").unwrap();
        assert_eq!(caps.project_kind, kind);
        assert_eq!(caps.project_path, "modules/service");
        for (filter, expected) in [
            ("SelectedTest#selected", "succeeded"),
            ("SelectedTest#missing", "failed"),
        ] {
            selected.configuration.test_filter = filter.into();
            state.start(binding.clone(), selected.clone()).unwrap();
            let job = state.job.lock().unwrap().clone().unwrap();
            let snapshot = wait_for(&job, |snapshot| {
                !["starting", "running"].contains(&snapshot.state.as_str())
            });
            assert_eq!(snapshot.state, expected, "{}", snapshot.output);
            if expected == "succeeded" {
                let results = snapshot.test_results.as_ref().unwrap();
                assert_eq!(results.summary.total, 1);
                assert_eq!(results.suites[0].cases[0].name, "selected");
                let report = fs::read_to_string(module.join(if kind == "maven" {
                    "target/surefire-reports/TEST-SelectedTest.xml"
                } else {
                    "build/test-results/test/TEST-SelectedTest.xml"
                }))
                .unwrap();
                assert!(report.contains("tests=\"1\""), "{report}");
                assert!(report.contains("name=\"selected\""), "{report}");
                assert!(!report.contains("name=\"other\""), "{report}");
            } else {
                let results = snapshot.test_results.as_ref().unwrap();
                assert_eq!(results.status, "unavailable");
                assert_eq!(results.summary.total, 0);
                assert!(!results.can_rerun_failed);
            }
        }
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires Maven, a compatible JDK, and dependency access"]
    fn real_maven_structured_results_and_failed_test_rerun() {
        real_structured_results("maven");
    }
    #[test]
    #[ignore = "requires Gradle, a compatible JDK, and dependency access"]
    fn real_gradle_structured_results_and_failed_test_rerun() {
        real_structured_results("gradle");
    }
    fn real_structured_results(kind: &str) {
        let (root, binding) = fixture();
        fs::create_dir_all(root.join("src/test/java")).unwrap();
        let source = "import org.junit.*; import java.nio.file.*; public class SampleTest { static boolean broken = true; @Test public void fails() { Assert.assertFalse(\"first failure\", broken); } @Test public void errors() { if (broken) throw new IllegalStateException(\"second failure\"); } @Test public void passes() throws Exception { Files.writeString(Path.of(\"passing-test-proof.txt\"), \"passed\"); } @Ignore @Test public void skipped() {} }";
        let source_path = root.join("src/test/java/SampleTest.java");
        fs::write(&source_path, source).unwrap();
        if kind == "maven" {
            fs::write(root.join("pom.xml"), r#"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>results</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>"#).unwrap();
        } else {
            fs::write(root.join("settings.gradle"), "rootProject.name='results'\n").unwrap();
            fs::write(root.join("gradle.properties"), "org.gradle.workers.max=2\n").unwrap();
            fs::write(root.join("build.gradle"), "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\ntest { useJUnit() }\n").unwrap();
        }
        let state = JavaExecutionState::default();
        let mut launch = request(&binding, "test");
        launch.configuration.build_tool = kind.into();
        state.start(binding.clone(), launch.clone()).unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let initial = wait_for(&job, |value| value.state == "failed");
        let results = initial.test_results.as_ref().unwrap();
        assert_eq!(results.status, "ready", "{}\n{results:?}", initial.output);
        assert_eq!(
            results.summary,
            test_results::Summary {
                total: 4,
                passed: 1,
                failed: if kind == "maven" { 1 } else { 2 },
                error: if kind == "maven" { 1 } else { 0 },
                skipped: 1,
                flaky: 0
            }
        );
        assert!(results.can_rerun_failed);
        assert_eq!(
            results.failed_selections().unwrap(),
            ["SampleTest#errors", "SampleTest#fails"]
        );
        let rerun = || RerunRequest {
            workspace_id: binding.workspace_id.clone(),
            generation: 1,
            session_id: initial.session_id.clone(),
            trusted: true,
            debug: false,
            source_breakpoints: vec![],
        };
        assert!(state
            .rerun_failed(
                binding.clone(),
                RerunRequest {
                    trusted: false,
                    ..rerun()
                }
            )
            .is_err());
        fs::remove_file(root.join("passing-test-proof.txt")).unwrap();
        fs::write(
            &source_path,
            source.replace("broken = true", "broken = false"),
        )
        .unwrap();
        let next = state.rerun_failed(binding.clone(), rerun()).unwrap();
        assert_ne!(initial.session_id, next.session_id);
        let next_job = state.job.lock().unwrap().clone().unwrap();
        let completed = wait_for(&next_job, |value| {
            !["starting", "running"].contains(&value.state.as_str())
        });
        assert_eq!(completed.state, "succeeded", "{}", completed.output);
        let results = completed.test_results.unwrap();
        assert_eq!(results.status, "ready", "{results:?}");
        assert_eq!(results.summary.total, 2);
        assert_eq!(results.summary.passed, 2);
        assert!(!results.can_rerun_failed);
        assert!(
            !root.join("passing-test-proof.txt").exists(),
            "the previously passing test must not rerun"
        );
        assert!(
            state.rerun_failed(binding.clone(), rerun()).is_err(),
            "a retired session cannot rerun"
        );
        fs::write(&source_path, "invalid Java source").unwrap();
        state.start(binding, launch).unwrap();
        let compilation = state.job.lock().unwrap().clone().unwrap();
        let failed = wait_for(&compilation, |value| value.state == "failed");
        let results = failed.test_results.unwrap();
        assert_eq!(results.status, "unavailable");
        assert_eq!(results.summary.total, 0);
        assert!(results.unchanged_reports > 0);
        assert!(!results.can_rerun_failed);
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn untrusted_workspace_is_refused_before_any_work() {
        let request = Request {
            workspace_id: "one".into(),
            generation: 1,
            operation: "build".into(),
            trusted: false,
            profile: false,
            source_breakpoints: vec![],
            test_selection: None,
            gradle_preparation: None,
            maven_preparation: None,
            testng_selection: false,
            maven_discovered_module_only: false,
            configuration: Configuration {
                build_tool: "jdk".into(),
                main_class: "Main".into(),
                class_path: vec![],
                launch_as_module: false,
                project_path: String::new(),
                test_filter: String::new(),
                test_framework: default_test_framework(),
                test_report_paths: vec![],
                working_directory: String::new(),
                application_input: false,
                program_arguments: vec![],
                jvm_options: vec![],
                test_jvm_options: vec![],
                environment: vec![],
                jdk_home: String::new(),
                debugger_mode: default_debugger_mode(),
                debugger_attach: None,
            },
        };
        assert!(invocation(Path::new("/does-not-exist"), &request)
            .unwrap_err()
            .contains("trust"));
    }
}
