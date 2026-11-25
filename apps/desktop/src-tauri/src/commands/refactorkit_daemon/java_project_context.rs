//! Explicitly synchronized, snapshot-bound Java project context supplied by RefactorKit.
use super::transport::{session_call_detailed, spawn_session, terminate, Session, REQUEST_TIMEOUT};
use crate::app_config::workspace_registry_path;
use crate::commands::java_execution::maven_runtime::{self, MavenRuntime};
use crate::commands::java_language::JavaLanguageServiceState;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, with_root_activation,
    CurrentWorkspaceBinding,
};
use crate::workspace::{ensure_within_root, workspace_root};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use serde_json::{json, Value};
#[cfg(test)]
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

static JAVA_CONTEXT_TRACE_LOCK: Mutex<()> = Mutex::new(());
const PATCH_RECOVERY_REQUIRED_RPC_CODE: i64 = -32006;
const SAVED_SOURCE_RECOVERY_REQUIRED: &str = "ide.java.context.savedSourceRecoveryRequired";

fn append_trace_record(trace_path: &Path, line: &str) -> std::io::Result<()> {
    let _guard = JAVA_CONTEXT_TRACE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(trace_path)?;
    let mut record = Vec::with_capacity(line.len() + 1);
    record.extend_from_slice(line.as_bytes());
    record.push(b'\n');
    file.write_all(&record)
}

pub(super) fn trace_snapshot(event: &str, details: Value) {
    if std::env::var("IDE_JAVA_CONTEXT_TRACE").as_deref() != Ok("1") {
        return;
    }
    let line = json!({"event": event, "details": details}).to_string();
    let trace_path = std::env::var_os("IDE_JAVA_CONTEXT_TRACE_PATH").map(PathBuf::from);
    let sandbox = std::env::var_os("IDE_STORY_NATIVE_GUI_SANDBOX_PATH").map(PathBuf::from);
    if let (Some(trace_path), Some(sandbox)) = (trace_path, sandbox) {
        let trace_parent = trace_path.parent();
        let canonical_trace_parent = trace_parent.and_then(|parent| parent.canonicalize().ok());
        let canonical_sandbox = sandbox.canonicalize().ok();
        let contained = matches!(
            (canonical_trace_parent.as_ref(), canonical_sandbox.as_ref()),
            (Some(parent), Some(sandbox)) if parent.parent() == Some(sandbox.as_path())
        );
        if trace_path.is_absolute()
            && sandbox.is_absolute()
            && trace_path
                .file_name()
                .is_some_and(|name| name == "java-project-context-snapshot-trace.jsonl")
            && trace_parent
                .is_some_and(|parent| parent.file_name().is_some_and(|name| name == "artifacts"))
            && trace_parent.and_then(Path::parent) == Some(sandbox.as_path())
            && contained
        {
            if append_trace_record(&trace_path, &line).is_ok() {
                return;
            }
        }
    }
    eprintln!("[java-project-context] {line}");
}

pub(super) use crate::commands::java_language::JavaLanguageGradleSettings as GradleSettings;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_path: String,
    sdk_home: String,
    maven_repository: String,
    active_maven_profiles: Vec<String>,
    inactive_maven_profiles: Vec<String>,
    expected_snapshot_hash: Option<String>,
    expected_context_hash: Option<String>,
    provider_id: Option<String>,
    module_id: Option<String>,
    source_set_id: Option<String>,
    source_set_kind: Option<String>,
    required_facts: Option<Vec<String>>,
    source_relative_path: Option<String>,
    symbol: Option<String>,
    gradle: Option<GradleSettings>,
    evaluate_gradle: Option<bool>,
    aggregate_gradle_composite_context: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Authority {
    workspace_id: String,
    generation: u64,
}
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedSourceRecoveryRequest {
    workspace_id: String,
    generation: u64,
    project_path: String,
    request_id: String,
}
struct PendingSavedSourceRecovery {
    request: SavedSourceRecoveryRequest,
    canonical_project: PathBuf,
    ticket: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageSettingsRequest {
    workspace_id: String,
    generation: u64,
    project_path: String,
    context_schema_version: String,
    snapshot_hash: String,
    context_hash: String,
}
pub(super) struct Active {
    pub(super) binding: CurrentWorkspaceBinding,
    pub(super) generation: u64,
    pub(super) session_id: u64,
    pub(super) session: Session,
    pub(super) capabilities: Value,
    pub(super) settings: Value,
    pub(super) opened: Option<(String, u64)>,
    pub(super) context: Option<Value>,
    pub(super) context_verification: Option<(String, Value)>,
    maven_runtime: Option<MavenRuntime>,
    gradle_sync: Option<Value>,
    pub(super) maven_module_rename_plans:
        std::collections::HashMap<String, super::java_maven_module_rename::PlanGuard>,
    pub(super) maven_module_rename_transactions:
        std::collections::HashMap<String, super::java_maven_module_rename::TransactionGuard>,
    pub(super) editor_reviews: std::collections::HashMap<String, Value>,
    pub(super) editor_transactions:
        std::collections::HashMap<String, super::java_editor_transaction::Pending>,
}
impl Active {
    pub(super) fn maven_launcher(&self) -> Option<&Path> {
        self.maven_runtime.as_ref().map(MavenRuntime::launcher)
    }

    pub(super) fn require_current_maven_runtime(&self) -> Result<(), String> {
        if let Some(expected) = &self.maven_runtime {
            if !expected.is_current(&self.session.root, &self.binding.canonical_root) {
                return Err(MAVEN_RUNTIME_CHANGED_MESSAGE.into());
            }
        }
        Ok(())
    }
    pub(super) fn has_gradle_evaluation(&self) -> bool {
        self.gradle_sync.is_some()
    }
    pub(super) fn observe_context(&mut self, context: Value, verification: (String, Value)) {
        self.context = Some(context);
        self.context_verification = Some(verification);
    }
    pub(super) fn observed_context(&self) -> Option<&Value> {
        self.context.as_ref()
    }
    pub(super) fn retire_context(&mut self) {
        self.context = None;
        self.context_verification = None;
    }
    pub(super) fn invalidate_project_context(&mut self, build_inputs_changed: bool) {
        self.context_verification = None;
        invalidate_project_evidence(
            &mut self.context,
            &mut self.gradle_sync,
            build_inputs_changed,
        );
    }
    pub(super) fn invalidate_gradle_evaluation(&mut self) {
        self.invalidate_project_context(true);
    }
}
fn invalidate_project_evidence(
    context: &mut Option<Value>,
    gradle_sync: &mut Option<Value>,
    build_inputs_changed: bool,
) {
    *context = None;
    if build_inputs_changed {
        *gradle_sync = None;
    }
}
pub(super) fn refresh_saved_authority(active: &mut Active, snapshot: &str, generation: u64) {
    if active
        .opened
        .as_ref()
        .is_some_and(|(previous, _)| previous != snapshot)
    {
        active.context = None;
        active.context_verification = None;
    }
    active.opened = Some((snapshot.into(), generation));
}
#[derive(Default)]
pub(super) struct Manager {
    revision: AtomicU64,
    session_ids: AtomicU64,
    shutting_down: AtomicBool,
    authority: Mutex<Option<(String, u64)>>,
    pub(super) active: Mutex<Option<Active>>,
    saved_source_recovery: Mutex<Option<PendingSavedSourceRecovery>>,
    project_watcher: Mutex<Option<ProjectWatch>>,
}

fn ensure_running(state: &Manager) -> Result<(), String> {
    if state.shutting_down.load(Ordering::SeqCst) {
        Err("Java project context is shutting down.".into())
    } else {
        Ok(())
    }
}

struct ProjectWatch {
    workspace_id: String,
    generation: u64,
    project_path: String,
    watch_id: String,
    snapshot_hash: String,
    _watcher: RecommendedWatcher,
}
pub(super) struct ProjectChangeEvent {
    pub(super) workspace_id: String,
    pub(super) generation: u64,
    pub(super) project_path: String,
    pub(super) watch_id: String,
    pub(super) status: &'static str,
    pub(super) change_kind: Option<&'static str>,
}
#[derive(Default)]
pub struct JavaProjectContextState(pub(super) Arc<Manager>);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
pub(in crate::commands) struct GradleGeneratedSourceSet {
    pub(super) module: String,
    pub(super) sources: Vec<String>,
    pub(super) generated: Vec<String>,
}

impl JavaProjectContextState {
    pub(in crate::commands) fn gradle_generated_sources(
        &self,
        request: Option<&crate::commands::java_language::JavaLanguageSessionRequest>,
    ) -> Vec<GradleGeneratedSourceSet> {
        self.read_gradle_generated_sources(request).unwrap_or_default()
    }

    fn read_gradle_generated_sources(
        &self,
        request: Option<&crate::commands::java_language::JavaLanguageSessionRequest>,
    ) -> Option<Vec<GradleGeneratedSourceSet>> {
        let request = request?;
        if request.gradle_import_enabled != Some(true) {
            return None;
        }
        let gradle = request.gradle.as_ref()?;
        let sdk = Path::new(request.project_jdk_home.as_deref()?).canonicalize().ok()?;
        let active = self.0.active.lock().ok()?;
        let active = active.as_ref()?;
        let context = active.context.as_ref()?;
        let configured = serde_json::from_value::<crate::commands::java_language::JavaLanguageGradleSettings>(
            active.settings["gradle"].clone(),
        ).ok()?;
        if &configured != gradle
            || active.binding.workspace_id != request.workspace_id
            || active.settings["projectPath"] != request.project_path.as_deref().unwrap_or("")
            || active.settings["sdkHome"].as_str()
                .and_then(|home| Path::new(home).canonicalize().ok()).as_ref() != Some(&sdk)
            || active.gradle_sync.is_none()
            || context["status"] != "available"
            || !current_workspace_binding_is_current(&active.binding)
            || self.0.shutting_down.load(Ordering::SeqCst)
        {
            return None;
        }
        gradle_generated_source_sets(context, &active.binding.canonical_root, &active.session.root)
    }
}

fn gradle_generated_source_sets(
    context: &Value,
    workspace: &Path,
    project: &Path,
) -> Option<Vec<GradleGeneratedSourceSet>> {
    if !context["providers"].as_array()?.iter().any(|provider| {
        provider["providerId"] == "gradle-effective-v1" && provider["status"] == "available"
    }) {
        return None;
    }
    let root = if provider_qualified_context_schema(context["schemaVersion"].as_str()?) {
        workspace
    } else {
        project
    };
    let directory = |path: &Value| {
        let canonical = normalized_workspace_directory(root, path.as_str()?, true)?;
        if !canonical.starts_with(workspace) || !canonical.is_dir() {
            return None;
        }
        Some(canonical)
    };
    let mut facts = Vec::new();
    for module in context["modules"].as_array()? {
        if module["providerId"] != "gradle-effective-v1" {
            continue;
        }
        let Some(module_root) = directory(&module["root"]) else { continue };
        let source_sets = module["sourceSets"].as_array()?;
        for set in source_sets {
            let source_paths = |key: &str| {
                set[key].as_array().into_iter().flatten()
                    .filter_map(directory)
                    .filter(|path| path.starts_with(&module_root))
                    .filter_map(|path| path.to_str().map(str::to_owned))
                    .collect::<BTreeSet<_>>()
            };
            let sources = source_paths("sourceRoots");
            let generated = source_paths("generatedSourceRoots");
            if !sources.is_empty() && !generated.is_empty() {
                facts.push(GradleGeneratedSourceSet {
                    module: module_root.to_str()?.to_owned(),
                    sources: sources.into_iter().collect(),
                    generated: generated.into_iter().collect(),
                });
            }
        }
    }
    facts.sort();
    facts.dedup();
    let mut generated = BTreeSet::new();
    (facts.len() <= 512
        && facts.iter().all(|set| set.generated.iter().all(|path| generated.insert(path.clone()))))
        .then_some(facts)
}
impl JavaProjectContextState {
    pub(super) fn shared(&self) -> Arc<Manager> {
        self.0.clone()
    }
    pub fn shutdown_all(&self) {
        self.0.shutting_down.store(true, Ordering::SeqCst);
        self.0.revision.fetch_add(1, Ordering::SeqCst);
        match self.0.active.lock() {
            Ok(mut active) => reset(&mut active),
            Err(_) => {}
        }
        match self.0.project_watcher.lock() {
            Ok(mut watcher) => {
                watcher.take();
            }
            Err(_) => {}
        }
    }
}

pub(super) fn with_workspace_session<T>(
    state: &Arc<Manager>,
    binding: &CurrentWorkspaceBinding,
    generation: u64,
    settings: &Value,
    action: impl FnOnce(&mut Active) -> Result<T, String>,
) -> Result<T, String> {
    ensure_running(state)?;
    let revision = state.revision.load(Ordering::SeqCst);
    let mut manager = state
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    ensure_running(state)?;
    if revision != state.revision.load(Ordering::SeqCst) {
        return Err("The Java project context changed; synchronize and retry.".into());
    }
    let owned = manager
        .as_mut()
        .ok_or("Synchronize the Java project before accessing editor transactions.")?;
    if owned.binding != *binding
        || owned.generation != generation
        || owned.settings != settings_key(settings)
        || !current_workspace_binding_is_current(binding)
        || owned
            .session
            .child
            .try_wait()
            .map_err(|_| "Java daemon is unavailable.")?
            .is_some()
    {
        return Err("The Java transaction workspace or settings changed.".into());
    }
    let result = action(owned);
    if revision != state.revision.load(Ordering::SeqCst)
        || state.shutting_down.load(Ordering::SeqCst)
        || !current_workspace_binding_is_current(binding)
    {
        return Err("The Java transaction context changed; its outcome requires recovery.".into());
    }
    result
}
impl Drop for JavaProjectContextState {
    fn drop(&mut self) {
        if Arc::strong_count(&self.0) == 1 {
            self.shutdown_all();
        }
    }
}
pub(super) fn reset(active: &mut Option<Active>) {
    if let Some(mut active) = active.take() {
        trace_snapshot(
            "project.context.reset",
            json!({
                "workspaceId": &active.binding.workspace_id,
                "generation": active.generation,
                "sessionId": active.session_id,
                "contextPresent": active.context.is_some(),
            }),
        );
        terminate(&mut active.session.child);
    }
}
fn text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && !value.contains('\0')
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProjectInputKind {
    Source,
    BuildConfiguration,
}

fn project_input_kind(project: &Path, path: &Path) -> Option<ProjectInputKind> {
    let Ok(relative) = path.strip_prefix(project) else {
        return None;
    };
    if relative.components().any(|component| {
        matches!(
            component
                .as_os_str()
                .to_string_lossy()
                .to_ascii_lowercase()
                .as_str(),
            ".git" | ".gradle" | ".idea" | "target" | "build" | "out" | "node_modules"
        )
    }) {
        return None;
    }
    let Some(name) = relative.file_name().and_then(|value| value.to_str()) else {
        return None;
    };
    if name.starts_with(".ide-save-") {
        return None;
    }
    let lower = name.to_ascii_lowercase();
    let under_gradle_directory = relative.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("gradle")
    });
    let under_build_logic_directory = relative.components().any(|component| {
        matches!(
            component
                .as_os_str()
                .to_string_lossy()
                .to_ascii_lowercase()
                .as_str(),
            "buildsrc" | "build-logic"
        )
    });
    let under_maven_directory = relative.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".mvn")
    });
    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if relative == Path::new(".refactorkit/java-project.json") || matches!(
        lower.as_str(),
        "pom.xml"
            | "build.gradle"
            | "build.gradle.kts"
            | "settings.gradle"
            | "settings.gradle.kts"
            | "gradle.properties"
            | "gradle-wrapper.properties"
            | "maven.config"
            | "mvnw"
            | "mvnw.cmd"
            | "gradlew"
            | "gradlew.bat"
            | "gradle-wrapper.jar"
            | "libs.versions.toml"
            | "gradle.lockfile"
    ) || matches!(extension.as_deref(), Some("gradle" | "kts" | "lockfile"))
        || (under_gradle_directory && matches!(extension.as_deref(), Some("toml" | "xml")))
        || (under_build_logic_directory
            && matches!(extension.as_deref(), Some("java" | "kt" | "groovy")))
        || (under_maven_directory
            && matches!(
                lower.as_str(),
                "extensions.xml" | "jvm.config" | "maven-wrapper.properties" | "maven-wrapper.jar"
            ))
    {
        Some(ProjectInputKind::BuildConfiguration)
    } else if matches!(extension.as_deref(), Some("java" | "kt")) {
        Some(ProjectInputKind::Source)
    } else {
        None
    }
}

fn declared_java_watch_roots(workspace: &Path, project: &Path, context: &Value) -> Vec<std::path::PathBuf> {
    let base = if provider_qualified_context_schema(context["schemaVersion"].as_str().unwrap_or_default()) { workspace } else { project };
    context["modules"].as_array().into_iter().flatten()
        .filter(|module| module["providerId"] == "java-declared-v1")
        .flat_map(|module| module["sourceSets"].as_array().into_iter().flatten())
        .flat_map(|set| set["sourceRoots"].as_array().into_iter().flatten())
        .filter_map(Value::as_str).filter(|path| relative(path, true))
        .map(|path| base.join(path)).filter(|path| path.starts_with(project)).collect()
}

fn project_input_kind_with_declared_roots(project: &Path, path: &Path, roots: &[std::path::PathBuf]) -> Option<ProjectInputKind> {
    project_input_kind(project, path).or_else(|| {
        (path.starts_with(project)
            && path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("java"))
            && roots.iter().any(|root| path.starts_with(root)))
            .then_some(ProjectInputKind::Source)
    })
}

fn project_watch_matches_context(
    watch: Option<&ProjectWatch>,
    workspace_id: &str,
    generation: u64,
    project_path: &str,
    watch_id: &str,
    snapshot_hash: &str,
    active_snapshot_hash: Option<&str>,
) -> bool {
    watch.is_some_and(|watch| {
        watch.workspace_id == workspace_id
            && watch.generation == generation
            && watch.project_path == project_path
            && watch.watch_id == watch_id
            && watch.snapshot_hash == snapshot_hash
            && (active_snapshot_hash.is_none() || active_snapshot_hash == Some(snapshot_hash))
    })
}

fn watch_project_root(
    project: &Path,
    declared_source_roots: Vec<std::path::PathBuf>,
    callback: impl Fn(ProjectInputChange) + Send + Sync + 'static,
) -> Result<RecommendedWatcher, String> {
    let canonical_project = project.to_path_buf();
    let last_event = Arc::new(Mutex::new(None::<(Instant, ProjectInputChange)>));
    let last_event_callback = last_event.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let change = match result {
            Ok(event) if !event.kind.is_access() => {
                let kind = event
                    .paths
                    .iter()
                    .filter_map(|path| project_input_kind_with_declared_roots(&canonical_project, path, &declared_source_roots))
                    .fold(None, |current, candidate| {
                        Some(match (current, candidate) {
                            (Some(ProjectInputKind::BuildConfiguration), _)
                            | (_, ProjectInputKind::BuildConfiguration) => {
                                ProjectInputKind::BuildConfiguration
                            }
                            _ => ProjectInputKind::Source,
                        })
                    });
                let Some(kind) = kind else {
                    return;
                };
                ProjectInputChange::Changed(kind)
            }
            Ok(_) => return,
            Err(_) => ProjectInputChange::Unavailable,
        };
        let now = Instant::now();
        if let Ok(mut previous) = last_event_callback.lock() {
            if should_suppress_project_input_change(*previous, now, change) {
                return;
            }
            *previous = Some((now, change));
        } else {
            return;
        }
        callback(change);
    })
    .map_err(|_| "Automatic Java project change tracking is unavailable.")?;
    watcher
        .watch(project, RecursiveMode::Recursive)
        .map_err(|_| "Automatic Java project change tracking is unavailable.")?;
    Ok(watcher)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProjectInputChange {
    Changed(ProjectInputKind),
    Unavailable,
}

fn should_suppress_project_input_change(
    previous: Option<(Instant, ProjectInputChange)>,
    now: Instant,
    change: ProjectInputChange,
) -> bool {
    let Some((previous_at, previous_change)) = previous else {
        return false;
    };
    if now.duration_since(previous_at) >= Duration::from_millis(300) {
        return false;
    }
    !matches!(
        (previous_change, change),
        (
            ProjectInputChange::Changed(ProjectInputKind::Source),
            ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration)
        )
    )
}

fn invalidate_project_evidence_for_change(
    context: &mut Option<Value>,
    gradle_sync: &mut Option<Value>,
    change: ProjectInputChange,
) {
    if let ProjectInputChange::Changed(kind) = change {
        invalidate_project_evidence(
            context,
            gradle_sync,
            kind == ProjectInputKind::BuildConfiguration,
        );
    }
}

pub(super) fn watch_project_inputs(
    authority: Authority,
    project_path: String,
    watch_id: String,
    state: Arc<Manager>,
    listener: impl Fn(ProjectChangeEvent) + Send + Sync + 'static,
) -> Result<(), String> {
    ensure_running(&state)?;
    if !valid_authority(&authority.workspace_id, authority.generation)
        || !text(&watch_id, 256)
        || !relative(&project_path, true)
    {
        return Err("Invalid Java project watch authority.".into());
    }
    let root = workspace_root()?;
    let binding = current_workspace_binding_at(&root, &workspace_registry_path()?)?;
    if binding.workspace_id != authority.workspace_id
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The Java workspace changed.".into());
    }
    let project = binding
        .canonical_root
        .join(&project_path)
        .canonicalize()
        .map_err(|_| "The selected Java project directory is unavailable.")?;
    ensure_within_root(&binding.canonical_root, &project)
        .map_err(|_| "The Java project escapes the workspace.")?;
    if !project.is_dir() {
        return Err("Select a Java project directory.".into());
    }
    let current_authority = state
        .authority
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    if current_authority.as_ref() != Some(&(authority.workspace_id.clone(), authority.generation)) {
        return Err("The Java project context changed before file monitoring started.".into());
    }
    drop(current_authority);
    let watched_context = state
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?
        .as_ref()
        .and_then(|active| {
            (active.binding == binding
                && active.generation == authority.generation
                && active.settings["projectPath"].as_str() == Some(project_path.as_str())
                && active.session.root == project)
                .then(|| active.context.as_ref())
                .flatten()
                .cloned()
        });
    let snapshot_hash = watched_context.as_ref()
        .and_then(|context| context["snapshotHash"].as_str())
        .filter(|snapshot| hash(snapshot)).map(str::to_string);
    let Some(snapshot_hash) = snapshot_hash else {
        return Err("Synchronize this Java project before starting file monitoring.".into());
    };

    let weak_state = Arc::downgrade(&state);
    let event_authority = (authority.workspace_id.clone(), authority.generation);
    let event_project_path = project_path.clone();
    let event_watch_id = watch_id.clone();
    let event_snapshot_hash = snapshot_hash.clone();
    let canonical_project = project.clone();
    let listener = Arc::new(listener);
    let declared_roots = watched_context.as_ref().map(|context| declared_java_watch_roots(&binding.canonical_root, &project, context)).unwrap_or_default();
    let watcher = watch_project_root(&project, declared_roots, move |change| {
        trace_snapshot(
            "project.context.watch.change",
            json!({
                "workspaceId": &event_authority.0,
                "generation": event_authority.1,
                "watchId": &event_watch_id,
                "change": match change {
                    ProjectInputChange::Changed(ProjectInputKind::Source) => "source",
                    ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration) => "buildConfiguration",
                    ProjectInputChange::Unavailable => "unavailable",
                },
            }),
        );
        let Some(manager) = weak_state.upgrade() else {
            return;
        };
        if manager.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        // A stopped or superseded watcher can still have a filesystem event queued.
        // Keep events bound to this watch and its captured snapshot. After one event
        // retires the context, accept follow-up events from the same watch so a nearby
        // build-file edit can still invalidate the Gradle receipt before resynchronization.
        let Ok(current_watch) = manager.project_watcher.lock() else {
            return;
        };
        let Ok(mut active) = manager.active.lock() else {
            return;
        };
        let active_snapshot_hash = active
            .as_ref()
            .and_then(|active| active.context.as_ref())
            .and_then(|context| context["snapshotHash"].as_str());
        if !project_watch_matches_context(
            current_watch.as_ref(),
            &event_authority.0,
            event_authority.1,
            &event_project_path,
            &event_watch_id,
            &event_snapshot_hash,
            active_snapshot_hash,
        ) {
            return;
        }
        if let ProjectInputChange::Changed(_) = change {
            if let Some(active) = active.as_mut().filter(|active| {
                active.binding.workspace_id == event_authority.0
                    && active.generation == event_authority.1
                    && active.session.root == canonical_project
                    && current_workspace_binding_is_current(&active.binding)
            }) {
                // Source edits require a fresh semantic snapshot but leave the evaluated
                // Gradle model reusable. Build-file edits invalidate both pieces of evidence.
                invalidate_project_evidence_for_change(
                    &mut active.context,
                    &mut active.gradle_sync,
                    change,
                );
            } else {
                return;
            }
        } else if active_snapshot_hash.is_none() {
            return;
        }
        drop(active);
        drop(current_watch);
        listener(ProjectChangeEvent {
            workspace_id: event_authority.0.clone(),
            generation: event_authority.1,
            project_path: event_project_path.clone(),
            watch_id: event_watch_id.clone(),
            status: match change {
                ProjectInputChange::Changed(_) => "changed",
                ProjectInputChange::Unavailable => "unavailable",
            },
            change_kind: match change {
                ProjectInputChange::Changed(ProjectInputKind::Source) => Some("source"),
                ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration) => Some("buildConfiguration"),
                ProjectInputChange::Unavailable => None,
            },
        });
    })?;

    let mut slot = state
        .project_watcher
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    let current_authority = state
        .authority
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    if current_authority.as_ref() != Some(&(authority.workspace_id.clone(), authority.generation))
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The Java workspace changed before file monitoring started.".into());
    }
    *slot = Some(ProjectWatch {
        workspace_id: authority.workspace_id,
        generation: authority.generation,
        project_path,
        watch_id,
        snapshot_hash,
        _watcher: watcher,
    });
    Ok(())
}

pub(super) fn stop_project_watch(
    authority: Authority,
    watch_id: String,
    state: Arc<Manager>,
) -> Result<(), String> {
    if !valid_authority(&authority.workspace_id, authority.generation) || !text(&watch_id, 256) {
        return Err("Invalid Java project watch authority.".into());
    }
    let mut watcher = state
        .project_watcher
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    if watcher.as_ref().is_some_and(|watcher| {
        watcher.workspace_id == authority.workspace_id
            && watcher.generation == authority.generation
            && watcher.watch_id == watch_id
    }) {
        watcher.take();
    }
    Ok(())
}

fn retire_project_watch_for_sync(authority: &Authority, state: &Manager) -> Result<(), String> {
    ensure_running(state)?;
    let mut watcher = state
        .project_watcher
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    if watcher.as_ref().is_some_and(|watcher| {
        watcher.workspace_id == authority.workspace_id && watcher.generation == authority.generation
    }) {
        // Serializes against callbacks, which hold this lock until the old
        // snapshot has either been invalidated or rejected as stale.
        watcher.take();
    }
    Ok(())
}

fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
fn bounded_string(value: &Value, limit: usize, allow_empty: bool) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() <= limit && (allow_empty || !text.is_empty()) && !text.contains('\0')
    })
}
fn exact_object_keys(value: &Value, expected: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
    })
}
fn maven_test_jvm_setting_valid(value: &Value) -> bool {
    exact_object_keys(
        value,
        &["name", "value", "origin", "availability", "redacted"],
    ) && matches!(
        value["name"].as_str(),
        Some("forkCount" | "forkMode" | "reuseForks" | "argLine")
    ) && (value["value"].is_null() || bounded_string(&value["value"], 16_384, true))
        && bounded_string(&value["origin"], 8192, true)
        && matches!(
            value["availability"].as_str(),
            Some(
                "complete"
                    | "partial"
                    | "unavailable"
                    | "ambiguous"
                    | "not-declared"
                    | "not-applicable"
            )
        )
        && value["redacted"].is_boolean()
}
pub(super) fn maven_test_jvm_fact_valid(value: &Value) -> bool {
    if !exact_object_keys(
        value,
        &["availability", "mode", "refusalCode", "executions"],
    ) || !matches!(
        value["availability"].as_str(),
        Some(
            "complete"
                | "partial"
                | "unavailable"
                | "ambiguous"
                | "not-declared"
                | "not-applicable"
        )
    ) || !matches!(
        value["mode"].as_str(),
        Some("forked" | "in-process" | "ambiguous" | "unknown" | "mixed")
    ) || !(value["refusalCode"].is_null() || bounded_string(&value["refusalCode"], 128, false))
    {
        return false;
    }
    let Some(executions) = value["executions"]
        .as_array()
        .filter(|items| items.len() <= 16)
    else {
        return false;
    };
    for execution in executions {
        if !exact_object_keys(
            execution,
            &[
                "pluginId",
                "pluginVersion",
                "executionId",
                "goals",
                "phase",
                "mode",
                "availability",
                "refusalCode",
                "forkSettings",
                "argLineLayers",
                "effectiveArgLineTemplate",
            ],
        ) || !bounded_string(&execution["pluginId"], 512, true)
            || !(execution["pluginVersion"].is_null()
                || bounded_string(&execution["pluginVersion"], 128, true))
            || !(execution["executionId"].is_null()
                || bounded_string(&execution["executionId"], 512, true))
            || !execution["goals"].as_array().is_some_and(|goals| {
                goals.len() <= 32 && goals.iter().all(|goal| bounded_string(goal, 128, true))
            })
            || !(execution["phase"].is_null() || bounded_string(&execution["phase"], 128, true))
            || !matches!(
                execution["mode"].as_str(),
                Some("forked" | "in-process" | "ambiguous" | "unknown")
            )
            || !matches!(
                execution["availability"].as_str(),
                Some("complete" | "partial" | "unavailable" | "ambiguous")
            )
            || !(execution["refusalCode"].is_null()
                || bounded_string(&execution["refusalCode"], 128, false))
            || !["forkSettings", "argLineLayers"].iter().all(|field| {
                execution[field].as_array().is_some_and(|settings| {
                    settings.len() <= 16 && settings.iter().all(maven_test_jvm_setting_valid)
                })
            })
            || !(execution["effectiveArgLineTemplate"].is_null()
                || bounded_string(&execution["effectiveArgLineTemplate"], 16_384, true))
        {
            return false;
        }
        if execution["availability"] == "complete" {
            if !execution["refusalCode"].is_null()
                || !bounded_string(&execution["pluginId"], 512, false)
            {
                return false;
            }
        } else if execution["refusalCode"].is_null() {
            return false;
        }
    }
    match value["availability"].as_str() {
        Some("complete") => {
            value["refusalCode"].is_null()
                && !executions.is_empty()
                && executions
                    .iter()
                    .all(|entry| entry["availability"] == "complete")
        }
        Some("not-declared" | "not-applicable") => {
            value["refusalCode"].is_null() && executions.is_empty()
        }
        Some("partial" | "unavailable" | "ambiguous") => !value["refusalCode"].is_null(),
        _ => false,
    }
}
fn relative(value: &str, empty: bool) -> bool {
    (empty && value.is_empty())
        || (text(value, 4096)
            && !value.contains(['\\', ':'])
            && value
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != "..")
            && Path::new(value)
                .components()
                .all(|part| matches!(part, Component::Normal(_))))
}
fn valid_authority(workspace: &str, generation: u64) -> bool {
    text(workspace, 256) && generation > 0 && generation <= 9_007_199_254_740_991
}
fn validate(
    request: &Request,
    binding: &CurrentWorkspaceBinding,
) -> Result<(PathBuf, PathBuf), String> {
    if !valid_authority(&request.workspace_id, request.generation)
        || !text(&request.request_id, 256)
        || !relative(&request.project_path, true)
        || !text(&request.sdk_home, 4096)
        || !Path::new(&request.sdk_home).is_absolute()
        || (!request.maven_repository.is_empty()
            && (!text(&request.maven_repository, 4096)
                || !Path::new(&request.maven_repository).is_absolute()))
        || request.active_maven_profiles.len() > 64
        || request.inactive_maven_profiles.len() > 64
        || request
            .active_maven_profiles
            .iter()
            .chain(&request.inactive_maven_profiles)
            .any(|v| !text(v, 256))
        || request
            .active_maven_profiles
            .iter()
            .any(|v| request.inactive_maven_profiles.contains(v))
        || request
            .expected_snapshot_hash
            .as_ref()
            .is_some_and(|v| !hash(v))
        || request
            .expected_context_hash
            .as_ref()
            .is_some_and(|v| !hash(v))
        || request.module_id.is_some()
            != (request.source_set_id.is_some() || request.source_set_kind.is_some())
        || request.source_set_id.is_some() && request.source_set_kind.is_some()
        || request.provider_id.is_some()
            && (request.module_id.is_none()
                || request.source_set_id.is_none() && request.source_set_kind.is_none())
        || request.source_set_kind.as_ref().is_some_and(|kind| {
            !matches!(
                kind.as_str(),
                "main" | "test" | "integration-test" | "custom"
            ) || request.provider_id.as_deref() != Some("maven-effective-v1")
        })
        || [
            &request.module_id,
            &request.source_set_id,
            &request.source_set_kind,
            &request.symbol,
        ]
        .into_iter()
        .flatten()
        .any(|v| !text(v, 1024))
        || request.provider_id.as_ref().is_some_and(|v| !text(v, 128))
        || request
            .source_relative_path
            .as_ref()
            .is_some_and(|v| !relative(v, false))
        || request
            .gradle
            .as_ref()
            .is_some_and(|settings| !settings.valid())
        || request.evaluate_gradle.is_some_and(|allowed| {
            !allowed
                || request.gradle.is_none()
                || request.module_id.is_some()
                || request.source_relative_path.is_some()
                || request.symbol.is_some()
        })
        || request
            .aggregate_gradle_composite_context
            .is_some_and(|enabled| {
                !enabled
                    || request.evaluate_gradle != Some(true)
                    || request.gradle.is_none()
                    || request.provider_id.is_some()
                    || request.module_id.is_some()
                    || request.source_set_id.is_some()
                    || request.source_set_kind.is_some()
                    || request.source_relative_path.is_some()
                    || request.symbol.is_some()
            })
    {
        return Err("Select a workspace-relative project, full JDK home and valid project-context settings.".into());
    }
    let project = binding
        .canonical_root
        .join(&request.project_path)
        .canonicalize()
        .map_err(|_| "The selected Java project directory is unavailable.")?;
    ensure_within_root(&binding.canonical_root, &project)
        .map_err(|_| "The Java project escapes the workspace.")?;
    if !project.is_dir() {
        return Err("Select a Java project directory.".into());
    }
    let sdk = Path::new(&request.sdk_home)
        .canonicalize()
        .map_err(|_| "The selected JDK is unavailable.")?;
    if !sdk.join("release").is_file()
        || !sdk.join("lib/ct.sym").is_file()
        || !sdk
            .join(if cfg!(windows) {
                "bin/javac.exe"
            } else {
                "bin/javac"
            })
            .is_file()
    {
        return Err(
            "Select a full JDK with release metadata, javac and platform signatures.".into(),
        );
    }
    Ok((project, sdk))
}

/// Reuse project-context configuration validation for an operation using its saved authority.
pub(super) fn validate_operation_settings(
    binding: &CurrentWorkspaceBinding,
    generation: u64,
    context_schema_version: &str,
    project_path: &str,
    sdk_home: &str,
    maven_repository: &str,
    active_maven_profiles: &[String],
    inactive_maven_profiles: &[String],
) -> Result<(PathBuf, PathBuf), String> {
    if !valid_context_schema_version(context_schema_version) {
        return Err("Unsupported Java project-context schema.".into());
    }
    validate(
        &Request {
            workspace_id: binding.workspace_id.clone(),
            generation,
            request_id: "java-operation-context".into(),
            project_path: project_path.into(),
            sdk_home: sdk_home.into(),
            maven_repository: maven_repository.into(),
            active_maven_profiles: active_maven_profiles.to_vec(),
            inactive_maven_profiles: inactive_maven_profiles.to_vec(),
            expected_snapshot_hash: None,
            expected_context_hash: None,
            provider_id: None,
            module_id: None,
            source_set_id: None,
            source_set_kind: None,
            required_facts: None,
            source_relative_path: None,
            symbol: None,
            gradle: None,
            evaluate_gradle: None,
            aggregate_gradle_composite_context: None,
        },
        binding,
    )
}
pub(super) fn provider_qualified_context_schema(version: &str) -> bool {
    matches!(
        version,
        "java-project-context-v3"
            | "java-project-context-v4"
            | "java-project-context-v5"
            | "java-project-context-v6"
            | "java-project-context-v7"
    )
}
pub(super) fn valid_context_schema_version(version: &str) -> bool {
    matches!(
        version,
        "java-project-context-v1"
            | "java-project-context-v2"
            | "java-project-context-v3"
            | "java-project-context-v4"
            | "java-project-context-v5"
            | "java-project-context-v6"
            | "java-project-context-v7"
    )
}
fn result(request: &Request, status: &str, code: &str, message: &str) -> Value {
    json!({"workspaceId": request.workspace_id, "generation": request.generation, "requestId": request.request_id,
        "projectPath": request.project_path, "status": status, "code": code, "message": message})
}
fn maven_runtime_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            method["name"] == "project.open"
                && method["requiresProject"] == false
                && method["writesWorkspace"] == false
                && method["features"]["mavenRuntime"] == true
        })
    })
}

pub(super) fn attach_maven_runtime(
    params: &mut Value,
    capabilities: &Value,
    project: &Path,
    workspace: &Path,
) -> Option<MavenRuntime> {
    if !maven_runtime_advertised(capabilities) {
        return None;
    }
    let runtime = maven_runtime::selected(project, workspace)?;
    params["mavenRuntime"] = runtime.project_open_params();
    Some(runtime)
}

fn advertised(value: &Value) -> bool {
    value["apiVersion"] == "0.2"
        && value["version"].as_str().is_some_and(|v| text(v, 128))
        && value["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|method| {
                method["name"] == "project.context"
                    && method["requiresProject"] == true
                    && method["writesWorkspace"] == false
                    && (method["features"]["typedSchemaV1"] == true
                        || method["features"]["typedSchemaV2"] == true
                        || method["features"]["typedSchemaV3"] == true)
                    && [
                        "snapshotBound",
                        "configuredSdkEvidence",
                        "orderedCompileRuntimeClasspaths",
                        "sharedJdtBuildContext",
                        "staleEvidenceRefusal",
                    ]
                    .iter()
                    .all(|flag| method["features"][flag] == true)
            }) || methods.iter().any(|method| {
                method["name"] == "project.context.v7"
                    && method["requiresProject"] == true
                    && method["writesWorkspace"] == false
                    && method["features"]["typedSchemaV7"] == true
                    && method["features"]["providerQualifiedSourceAssociation"] == true
                    && method["features"]["readOnlyBuildDiscovery"] == true
            }) || methods.iter().any(|method| {
                method["name"] == "project.context.v6"
                    && method["requiresProject"] == true
                    && method["writesWorkspace"] == false
                    && method["features"]["typedSchemaV6"] == true
                    && method["features"]["providerQualifiedSourceAssociation"] == true
                    && [
                        "snapshotBound",
                        "configuredSdkEvidence",
                        "orderedCompileRuntimeClasspaths",
                        "sharedJdtBuildContext",
                        "staleEvidenceRefusal",
                    ]
                    .iter()
                    .all(|flag| method["features"][flag] == true)
            })
        })
}
fn provider_qualified_source_association_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            ((method["name"] == "project.context" && method["features"]["typedSchemaV3"] == true)
                || (method["name"] == "project.context.v5"
                    && method["features"]["typedSchemaV5"] == true)
                || (method["name"] == "project.context.v6"
                    && method["features"]["typedSchemaV6"] == true)
                || (method["name"] == "project.context.v7"
                    && method["features"]["typedSchemaV7"] == true))
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && method["features"]["providerQualifiedSourceAssociation"] == true
        })
    })
}
pub(super) fn java_project_context_v5_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            method["name"] == "project.context.v5"
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && method["features"]["typedSchemaV5"] == true
                && method["features"]["providerQualifiedSourceAssociation"] == true
                && method["features"]["standardJpmsDirectives"] == true
                && method["features"]["closedLegacySchemas"] == true
                && method["features"]["mavenFailsafeExecutionMetadata"] == true
        })
    })
}
pub(super) fn java_project_context_v6_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            method["name"] == "project.context.v6"
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && method["features"]["typedSchemaV6"] == true
                && method["features"]["providerQualifiedSourceAssociation"] == true
        })
    })
}
pub(super) fn java_project_context_v7_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            method["name"] == "project.context.v7"
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && method["features"]["typedSchemaV7"] == true
                && method["features"]["providerQualifiedSourceAssociation"] == true
                && method["features"]["mavenFailsafeExecutionMetadata"] == true
                && method["features"]["mavenTestJvmSettings"] == true
                && method["features"]["testJvmSettingsAreSourceSetBound"] == true
                && method["features"]["explicitOriginsOnly"] == true
                && method["features"]["preservesArgLineLateTokens"] == true
                && method["features"]["standardJpmsDirectives"] == true
                && method["features"]["readOnlyBuildDiscovery"] == true
        })
    })
}
fn java_project_context_v4_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            method["name"] == "project.context.v4"
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && method["features"]["typedSchemaV4"] == true
                && method["features"]["mavenFailsafeExecutionMetadata"] == true
        })
    })
}
pub(super) fn maven_failsafe_context_advertised(value: &Value) -> bool {
    java_project_context_v4_advertised(value)
        || java_project_context_v5_advertised(value)
        || java_project_context_v7_advertised(value)
        || value["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|method| {
                method["name"] == "project.context.v6"
                    && method["requiresProject"] == true
                    && method["writesWorkspace"] == false
                    && method["features"]["typedSchemaV6"] == true
                    && method["features"]["mavenFailsafeExecutionMetadata"] == true
            })
        })
}
fn context_method(request: &Request, capabilities: &Value) -> &'static str {
    if request.aggregate_gradle_composite_context == Some(true) {
        "project.context.aggregate"
    } else if java_project_context_v7_advertised(capabilities)
        && request.provider_id.is_some()
        && request.module_id.is_some()
        && (request.source_set_id.is_some() || request.source_set_kind.is_some())
    {
        "project.context.v7"
    } else if request
        .required_facts
        .as_ref()
        .is_some_and(|facts| facts.iter().any(|fact| fact == "jpms"))
        && request.provider_id.is_some()
        && request.module_id.is_some()
        && (request.source_set_id.is_some() || request.source_set_kind.is_some())
        && java_project_context_v5_advertised(capabilities)
    {
        "project.context.v5"
    } else if request.source_set_kind.is_some() && java_project_context_v4_advertised(capabilities)
    {
        "project.context.v4"
    } else if request.source_set_kind.is_some() && java_project_context_v5_advertised(capabilities)
    {
        "project.context.v5"
    } else if request
        .required_facts
        .as_ref()
        .is_some_and(|facts| facts.iter().any(|fact| fact == "jpms"))
        && request.provider_id.is_some()
        && request.module_id.is_some()
        && request.source_set_id.is_some()
        && java_project_context_v4_advertised(capabilities)
    {
        "project.context.v4"
    } else {
        "project.context"
    }
}
fn aggregate_gradle_composite_identity_advertised(value: &Value) -> bool {
    value["methods"].as_array().is_some_and(|methods| {
        methods.iter().any(|method| {
            method["name"] == "project.context.aggregate"
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && [
                    "typedSchemaV3",
                    "aggregateGradleCompositeBuildIdentity",
                    "requiresExplicitGradleSync",
                    "snapshotBound",
                    "readOnly",
                ]
                .iter()
                .all(|feature| method["features"][feature] == true)
        })
    })
}
pub(super) fn settings_key(value: &Value) -> Value {
    json!({"projectPath":value["projectPath"], "sdkHome":value["sdkHome"],
        "mavenRepository":value["mavenRepository"], "activeMavenProfiles":value["activeMavenProfiles"],
        "inactiveMavenProfiles":value["inactiveMavenProfiles"], "gradle":value["gradle"]})
}
fn selected_context_matches(context: &Value, expected: &Value) -> bool {
    let identities = context["sdk"].as_array().map(|items| {
        items
            .iter()
            .map(|sdk| sdk["identitySha256"].clone())
            .collect::<Vec<_>>()
    });
    context["status"] == "available"
        && context["schemaVersion"] == expected["contextSchemaVersion"]
        && context["snapshotHash"] == expected["snapshotHash"]
        && context["contextHash"] == expected["contextHash"]
        && identities.as_ref().map(|values| json!(values))
            == Some(expected["platformIdentities"].clone())
}
fn request_settings(request: &Request) -> Value {
    settings_key(
        &json!({"projectPath":request.project_path,"sdkHome":request.sdk_home,
        "mavenRepository":request.maven_repository,"activeMavenProfiles":request.active_maven_profiles,
        "inactiveMavenProfiles":request.inactive_maven_profiles,"gradle":request.gradle}),
    )
}

fn normalized_module_root(
    workspace_root: &Path,
    selected_project_root: &Path,
    value: &str,
) -> Option<PathBuf> {
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return None;
    }
    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized
            .split('/')
            .any(|part| part == ".." || part == ".")
    {
        return None;
    }
    let resolve = |base: &Path| {
        let candidate = if normalized.is_empty() {
            base.to_path_buf()
        } else {
            base.join(&normalized)
        };
        candidate.canonicalize().ok()
    };
    let workspace_candidate = resolve(workspace_root);
    let project_candidate = resolve(selected_project_root);
    let valid = |candidate: &Option<PathBuf>| {
        candidate
            .as_ref()
            .is_some_and(|path| path.is_dir() && path.starts_with(selected_project_root))
    };
    match (valid(&workspace_candidate), valid(&project_candidate)) {
        (true, true) if workspace_candidate != project_candidate => None,
        (true, _) => workspace_candidate,
        (_, true) => project_candidate,
        _ => None,
    }
}

fn normalized_workspace_directory(
    workspace_root: &Path,
    value: &str,
    allow_workspace_root: bool,
) -> Option<PathBuf> {
    if value.len() > 4096 || value.chars().any(char::is_control) || value.contains('\\') {
        return None;
    }
    if value == "." {
        return Some(workspace_root.to_path_buf());
    }
    if value.is_empty() {
        return allow_workspace_root.then(|| workspace_root.to_path_buf());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    let candidate = workspace_root.join(path);
    let canonical = candidate.canonicalize().ok()?;
    (canonical.is_dir() && canonical.starts_with(workspace_root)).then_some(canonical)
}

fn valid_gradle_logical_path(value: &str) -> bool {
    if value.len() > 4096 || !value.starts_with(':') || value.chars().any(char::is_control) {
        return false;
    }
    value == ":"
        || value[1..].split(':').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && !segment.contains(['/', '\\'])
        })
}

fn gradle_compiler_option_enables_preview(option: &Value) -> Result<bool, &'static str> {
    let name = option["name"]
        .as_str()
        .ok_or("A Gradle compiler option has no name.")?;
    let value = option["value"]
        .as_str()
        .ok_or("A Gradle compiler option has no value.")?;
    let redacted = option["redacted"]
        .as_bool()
        .ok_or("A Gradle compiler option has no redaction status.")?;

    match name {
        // Older project-context producers represented a flag as the option name.
        "--enable-preview" => {
            if value.is_empty() && !redacted {
                Ok(true)
            } else {
                Err("The Gradle preview option is not reported as a complete flag.")
            }
        }
        // The effective Gradle provider reports each JavaCompile compiler argument
        // with the stable name `compilerArg` and the argument token in `value`.
        "compilerArg" if value == "--enable-preview" => {
            if redacted {
                Err("The Gradle preview compiler argument is redacted.")
            } else {
                Ok(true)
            }
        }
        // A redacted compiler argument could be the preview flag. Do not claim
        // preview is absent while the provider has withheld an argument value.
        "compilerArg" if redacted => {
            Err("A redacted Gradle compiler argument makes preview settings unknown.")
        }
        _ => Ok(false),
    }
}

fn gradle_preview_targets(
    context: &Value,
    workspace_root: &Path,
    selected_project_root: &Path,
    selected_sdk_home: &Path,
) -> Result<(Vec<PathBuf>, u64), &'static str> {
    if !(context["schemaVersion"] == "java-project-context-v2"
        || context["schemaVersion"] == "java-project-context-v3"
        || context["schemaVersion"] == "java-project-context-v4"
        || context["schemaVersion"] == "java-project-context-v5"
        || context["schemaVersion"] == "java-project-context-v6"
        || context["schemaVersion"] == "java-project-context-v7")
        || context["status"] != "available"
        || !context["providers"].as_array().is_some_and(|providers| {
            providers.iter().any(|provider| {
                provider["providerId"] == "gradle-effective-v1" && provider["status"] == "available"
            })
        })
    {
        return Err("The provider has not supplied a complete Gradle project context v2.");
    }
    let sdks = context["sdk"]
        .as_array()
        .ok_or("The Gradle context has no selected SDK evidence.")?;
    let matching_sdks: Vec<_> = sdks
        .iter()
        .filter(|sdk| {
            sdk["home"]
                .as_str()
                .and_then(|home| Path::new(home).canonicalize().ok())
                .as_deref()
                == Some(selected_sdk_home)
        })
        .collect();
    if matching_sdks.len() != 1 {
        return Err("The Gradle context does not identify one selected project JDK.");
    }
    let selected_release = matching_sdks[0]["platformRelease"]
        .as_u64()
        .ok_or("The selected project JDK release is unavailable.")?;
    let modules = context["modules"]
        .as_array()
        .filter(|modules| !modules.is_empty() && modules.len() <= 512)
        .ok_or("The Gradle context has no bounded module inventory.")?;
    let mut targets = Vec::new();
    let mut composite_projects = BTreeSet::new();
    for module in modules {
        if module["providerId"] != "gradle-effective-v1" {
            return Err("The Gradle context contains a module without Gradle provider authority.");
        }
        let module_root = if provider_qualified_context_schema(
            context["schemaVersion"].as_str().unwrap_or_default(),
        ) {
            let build_root = module["buildRoot"]
                .as_str()
                .and_then(|value| normalized_workspace_directory(workspace_root, value, false))
                .ok_or("A Gradle build root is outside the workspace or invalid.")?;
            let project_path = module["projectPath"]
                .as_str()
                .filter(|value| valid_gradle_logical_path(value))
                .ok_or("A Gradle logical project path is invalid.")?;
            let id = module["id"]
                .as_str()
                .filter(|value| !value.is_empty() && value.len() <= 1024)
                .ok_or("A Gradle module has no stable project identity.")?;
            let identity = format!("{}\0{}", build_root.display(), project_path);
            if !composite_projects.insert(identity) {
                return Err("The Gradle context repeats a composite build project identity.");
            }
            if modules
                .iter()
                .filter(|candidate| candidate["id"] == id)
                .count()
                != 1
            {
                return Err("The Gradle context repeats a module identity.");
            }
            module["root"]
                .as_str()
                .and_then(|root| normalized_workspace_directory(workspace_root, root, true))
                .ok_or("A Gradle module root is outside the workspace or invalid.")?
        } else {
            module["root"]
                .as_str()
                .and_then(|root| {
                    normalized_module_root(workspace_root, selected_project_root, root)
                })
                .ok_or("A Gradle module root is outside the selected project.")?
        };
        let source_sets = module["sourceSets"]
            .as_array()
            .filter(|source_sets| !source_sets.is_empty() && source_sets.len() <= 256)
            .ok_or("A Gradle module has no bounded source-set inventory.")?;
        let mut flags = Vec::new();
        let mut source_levels = Vec::new();
        for source_set in source_sets {
            let source_roots = source_set["sourceRoots"]
                .as_array()
                .ok_or("A Gradle source set has no source-root inventory.")?;
            if source_roots.is_empty() {
                continue;
            }
            if source_set["compilerOptionsAvailability"] != "complete" {
                return Err("The Gradle compiler options are incomplete for a source set.");
            }
            let options = source_set["compilerOptions"]
                .as_array()
                .filter(|options| options.len() <= 1024)
                .ok_or("A Gradle source set has no bounded compiler-option inventory.")?;
            let preview_options: Vec<_> = options
                .iter()
                .map(gradle_compiler_option_enables_preview)
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter(|enabled| *enabled)
                .collect();
            if preview_options.len() > 1 {
                return Err("The Gradle preview option is duplicated.");
            }
            let enabled = !preview_options.is_empty();
            let source_level = source_set["release"]
                .as_u64()
                .or_else(|| source_set["sourceLevel"].as_u64())
                .ok_or("The Gradle source-set language level is unavailable.")?;
            if enabled && source_level != selected_release {
                return Err("Preview features do not match the selected project JDK release.");
            }
            flags.push(enabled);
            source_levels.push(source_level);
        }
        if flags.is_empty() {
            continue;
        }
        if flags.iter().any(|enabled| *enabled) && flags.iter().any(|enabled| !*enabled) {
            return Err("JDT LS cannot represent different preview settings across source sets.");
        }
        if flags.iter().all(|enabled| *enabled) {
            if source_levels.iter().any(|level| *level != selected_release) {
                return Err("The Gradle module uses inconsistent preview source levels.");
            }
            targets.push(module_root);
        }
    }
    targets.sort();
    if targets.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("The Gradle context maps multiple modules to one project directory.");
    }
    Ok((targets, selected_release))
}

fn context_params(request: &Request, snapshot: &str, sdk: &Path, _method: &str) -> Value {
    let mut params = json!({"expectedSnapshotHash": snapshot, "sdkHome": sdk});
    for (name, value) in [
        ("providerId", &request.provider_id),
        ("moduleId", &request.module_id),
        ("sourceSetId", &request.source_set_id),
        ("sourceSetKind", &request.source_set_kind),
        ("sourceRelativePath", &request.source_relative_path),
        ("symbol", &request.symbol),
        ("expectedContextHash", &request.expected_context_hash),
    ] {
        if let Some(value) = value {
            params[name] = json!(value);
        }
    }
    if let Some(required_facts) = &request.required_facts {
        params["requiredFacts"] = json!(required_facts);
    }
    params
}

fn select_v6_context_scope(
    session: &mut Session,
    request: &Request,
    snapshot: &str,
) -> Result<Request, String> {
    let provider_id = if request.gradle.is_some() {
        "gradle-effective-v1"
    } else {
        "maven-effective-v1"
    };
    if request
        .provider_id
        .as_deref()
        .is_some_and(|selected| selected != provider_id)
    {
        return Err("Java metadata context belongs to a different build provider.".into());
    }

    let summary = session_call_detailed(session, "project.summary", json!({}), REQUEST_TIMEOUT)
        .map_err(|_| "RefactorKit could not identify a module and source set for Java metadata.")?;
    if summary["snapshotHash"] != snapshot || summary["buildModelsTruncated"] != false {
        return Err("RefactorKit returned incomplete or stale build-model selection data.".into());
    }
    let models = summary["buildModels"]
        .as_array()
        .ok_or("RefactorKit omitted build-model selection data.")?;
    let matching_models = models
        .iter()
        .filter(|model| model["providerId"] == provider_id)
        .collect::<Vec<_>>();
    let model = match matching_models.as_slice() {
        [model]
            if matches!(model["status"].as_str(), Some("available" | "partial"))
                && model["truncated"] == false =>
        {
            *model
        }
        _ => {
            return Err(
                "RefactorKit did not return one complete build model for Java metadata.".into(),
            )
        }
    };
    let modules = model["modules"]
        .as_array()
        .ok_or("RefactorKit omitted module selection data.")?;
    let mut matching_modules = modules
        .iter()
        .filter(|module| {
            request
                .module_id
                .as_deref()
                .is_none_or(|module_id| module["id"] == module_id)
        })
        .collect::<Vec<_>>();
    matching_modules.sort_by_key(|module| module["id"].as_str().unwrap_or_default());
    let selected_scope = matching_modules.into_iter().find_map(|module| {
        if module["truncated"] != false {
            return None;
        }
        let source_sets = module["sourceSets"].as_array()?;
        let matching_source_sets = source_sets
            .iter()
            .filter(|source_set| {
                if let Some(source_set_id) = request.source_set_id.as_deref() {
                    source_set["id"] == source_set_id
                } else if let Some(source_set_kind) = request.source_set_kind.as_deref() {
                    source_set["kind"] == source_set_kind
                } else {
                    source_set["kind"] == "main"
                }
            })
            .collect::<Vec<_>>();
        match matching_source_sets.as_slice() {
            [source_set] if source_set["truncated"] == false => Some((module, *source_set)),
            _ => None,
        }
    });
    let (module, source_set) = selected_scope.ok_or(
        "RefactorKit requires one complete module and source set for Java metadata context.",
    )?;
    let module_id = module["id"]
        .as_str()
        .filter(|value| text(value, 1024))
        .ok_or("RefactorKit returned an invalid module identity.")?;
    let source_set_id = source_set["id"]
        .as_str()
        .filter(|value| text(value, 1024))
        .ok_or("RefactorKit returned an invalid source-set identity.")?;

    let mut selected = request.clone();
    selected.provider_id = Some(provider_id.into());
    selected.module_id = Some(module_id.into());
    selected.source_set_id = Some(source_set_id.into());
    selected.source_set_kind = None;
    selected.aggregate_gradle_composite_context = None;
    selected.evaluate_gradle = None;
    Ok(selected)
}

fn valid_required_facts(request: &Request) -> bool {
    let has_source_set_selector =
        request.source_set_id.is_some() || request.source_set_kind.is_some();
    let scope_valid = request.module_id.is_some() == has_source_set_selector
        && !(request.source_set_id.is_some() && request.source_set_kind.is_some())
        && (request.provider_id.is_none()
            || request.module_id.is_some() && has_source_set_selector);
    let facts_valid = request.required_facts.as_ref().is_none_or(|facts| {
        facts.len() <= 5
            && facts.iter().collect::<std::collections::HashSet<_>>().len() == facts.len()
            && facts.iter().all(|fact| {
                matches!(
                    fact.as_str(),
                    "source-root-provenance"
                        | "compiler-options"
                        | "artifact-coordinates"
                        | "annotation-processors"
                        | "jpms"
                )
            })
    });
    scope_valid && facts_valid
}

/// Serialize SDK consumers with context acquisition, preserving evaluated Gradle metadata.
/// Missing/retired sessions require explicit synchronization; never reopen or execute a build here.
pub(super) const SESSION_RETIRED_MESSAGE: &str =
    "The Java project session was lost; synchronize and retry.";
pub(super) const MAVEN_RUNTIME_CHANGED_MESSAGE: &str =
    "The Maven runtime changed. Synchronize the Java project again.";

pub(super) fn with_selected_session<T>(
    state: &Arc<Manager>,
    binding: &CurrentWorkspaceBinding,
    generation: u64,
    expected: &Value,
    action: impl FnOnce(&mut Active) -> Result<T, String>,
) -> Result<T, String> {
    ensure_running(state)?;
    let revision = state.revision.load(Ordering::SeqCst);
    let mut manager = state
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    ensure_running(state)?;
    if revision != state.revision.load(Ordering::SeqCst) {
        return Err("The Java project context changed; synchronize and retry.".into());
    }
    trace_snapshot(
        "project.context.consume",
        json!({
            "workspaceId": &binding.workspace_id,
            "generation": generation,
            "activePresent": manager.is_some(),
            "contextStatus": manager.as_ref().and_then(|active| active.context.as_ref().and_then(|context| context["status"].as_str())),
        }),
    );
    let owned = manager
        .as_mut()
        .ok_or("Synchronize the Java project before using its SDK context.")?;
    let context = owned
        .context
        .as_ref()
        .ok_or("The Java project context has been retired.")?;
    if owned.binding != *binding
        || owned.generation != generation
        || owned.settings != settings_key(expected)
        || !selected_context_matches(context, expected)
        || !current_workspace_binding_is_current(binding)
    {
        return Err("The selected Java context changed; synchronize and retry.".into());
    }
    if !matches!(owned.session.child.try_wait(), Ok(None)) {
        reset(&mut manager);
        return Err(SESSION_RETIRED_MESSAGE.into());
    }
    if let Err(error) = owned.require_current_maven_runtime() {
        owned.retire_context();
        return Err(error);
    }
    let result = action(owned);
    trace_snapshot(
        "project.context.consume.result",
        json!({
            "workspaceId": &binding.workspace_id,
            "generation": generation,
            "resultOk": result.is_ok(),
            "error": result.as_ref().err(),
        }),
    );
    if result.is_err() {
        reset(&mut manager);
    }
    if state.revision.load(Ordering::SeqCst) != revision
        || state.shutting_down.load(Ordering::SeqCst)
        || !current_workspace_binding_is_current(binding)
    {
        return Err("The Java project context changed during the operation.".into());
    }
    result
}

fn provider_allowed(provider: &Value, request: &Request) -> bool {
    (provider["buildCodeExecution"] == "denied"
        && provider["credentialsAccess"] == "denied"
        && provider["networkAccess"] == "denied")
        || (request.gradle.is_some()
            && provider["providerId"] == "gradle-effective-v1"
            && provider["buildCodeExecution"] == "allowed-explicit"
            && provider["credentialsAccess"] == "build-controlled"
            && provider["networkAccess"] == "offline-resolution")
}

/// RefactorKit opens `request.project_path` as the root of its project session. Convert v3 paths
/// from that root to the IDE workspace root before exposing the context to IDE consumers.
fn qualify_context_paths(context: &mut Value, project_path: &str) {
    if project_path.is_empty() || project_path == "." {
        return;
    }
    fn qualify(path: &mut Value, project_path: &str) {
        let Some(value) = path.as_str() else {
            return;
        };
        if Path::new(value).is_absolute() || value.as_bytes().get(1) == Some(&b':') {
            return;
        }
        *path = json!(if value.is_empty() || value == "." {
            project_path.to_string()
        } else {
            format!("{project_path}/{value}")
        });
    }
    fn visit(value: &mut Value, project_path: &str) {
        match value {
            Value::Object(fields) => {
                for (name, field) in fields {
                    match name.as_str() {
                        "path" | "root" | "buildRoot" | "sourceRoot" | "descriptorPath" => {
                            qualify(field, project_path);
                            if !field.is_string() {
                                visit(field, project_path);
                            }
                        }
                        "sourceRoots"
                        | "generatedSourceRoots"
                        | "outputDirectories"
                        | "analysisSourceRoots"
                        | "processorPath" => {
                            if let Some(paths) = field.as_array_mut() {
                                for path in paths {
                                    qualify(path, project_path);
                                }
                            }
                        }
                        _ => visit(field, project_path),
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    visit(item, project_path);
                }
            }
            _ => {}
        }
    }
    visit(context, project_path);
}

pub(super) fn normalize(
    raw: Value,
    request: &Request,
    snapshot: &str,
    sdk: &Path,
    version: &str,
) -> Result<Value, String> {
    let schema_version = raw["schemaVersion"].as_str().unwrap_or_default();
    let expects_provider_qualified_context = request.provider_id.is_some()
        || request.aggregate_gradle_composite_context == Some(true)
        || schema_version == "java-project-context-v6"
        || schema_version == "java-project-context-v7";
    if !matches!(
        Some(schema_version),
        Some(
            "java-project-context-v1"
                | "java-project-context-v2"
                | "java-project-context-v3"
                | "java-project-context-v4"
                | "java-project-context-v5"
                | "java-project-context-v6"
                | "java-project-context-v7"
        )
    ) || expects_provider_qualified_context != provider_qualified_context_schema(schema_version)
    {
        return Err("Unsupported RefactorKit Java project-context schema.".into());
    }
    if raw["status"] == "refused" {
        let code = raw["refusal"]["code"]
            .as_str()
            .filter(|v| text(v, 256))
            .ok_or("Missing project-context refusal code.")?;
        let message = raw["refusal"]["message"]
            .as_str()
            .filter(|v| text(v, 4096))
            .ok_or("Missing project-context refusal reason.")?;
        return Ok(result(request, "refused", code, message));
    }
    if !matches!(raw["status"].as_str(), Some("available" | "partial"))
        || raw["snapshotHash"] != snapshot
        || raw["contextHash"].as_str().is_none_or(|v| !hash(v))
        || request
            .expected_context_hash
            .as_ref()
            .is_some_and(|v| raw["contextHash"] != *v)
        || !raw["refusal"].is_null()
    {
        return Err("RefactorKit returned stale or invalid Java project-context evidence.".into());
    }
    let sdks = raw["sdk"].as_array().ok_or("Missing Java SDK evidence.")?;
    if sdks.iter().any(|entry| {
        entry["home"]
            .as_str()
            .and_then(|v| Path::new(v).canonicalize().ok())
            .as_deref()
            != Some(sdk)
    }) {
        return Err("RefactorKit returned another project SDK.".into());
    }
    let providers = raw["providers"]
        .as_array()
        .ok_or("Missing Java project providers.")?;
    if providers.iter().any(|p| !provider_allowed(p, request)) {
        return Err("Read-only project context requires offline providers without build execution or credentials.".into());
    }
    if let Some(provider_id) = request.provider_id.as_deref() {
        if raw["selectedSource"].is_object() && raw["selectedSource"]["providerId"] != provider_id {
            return Err("RefactorKit selected a different Java project provider.".into());
        }
    }
    let analysis_is_qualified =
        raw["analysis"]["backend"] == "eclipse-jdt" && raw["analysis"]["snapshotHash"] == snapshot;
    let metadata_only_source_selection_valid = || {
        let selected = &raw["selectedSource"];
        if selected.is_null() {
            return request.source_relative_path.is_none() && request.symbol.is_none();
        }
        if schema_version != "java-project-context-v7" {
            return false;
        }
        let (
            Some(path),
            Some(source_root),
            Some(relative_path),
            Some(provider_id),
            Some(module_id),
            Some(source_set_id),
            Some(generated),
        ) = (
            selected["path"].as_str(),
            selected["sourceRoot"].as_str(),
            request.source_relative_path.as_deref(),
            selected["providerId"].as_str(),
            selected["moduleId"].as_str(),
            selected["sourceSetId"].as_str(),
            selected["generated"].as_bool(),
        )
        else {
            return false;
        };
        if request.symbol.is_some()
            || selected.get("symbol").is_none_or(|value| !value.is_null())
            || selected
                .get("bindingKey")
                .is_none_or(|value| !value.is_null())
            || selected["evidence"] != "SOURCE_ROOT_OWNERSHIP"
            || !relative(path, false)
            || !relative(source_root, true)
            || !relative(relative_path, false)
            || request
                .provider_id
                .as_deref()
                .is_some_and(|expected| expected != provider_id)
            || request
                .module_id
                .as_deref()
                .is_some_and(|expected| expected != module_id)
        {
            return false;
        }
        let expected_path = if source_root.is_empty() {
            relative_path.to_owned()
        } else {
            format!("{source_root}/{relative_path}")
        };
        if path != expected_path {
            return false;
        }
        let Some(modules) = raw["modules"].as_array() else {
            return false;
        };
        let owners: Vec<_> = modules
            .iter()
            .filter(|module| module["providerId"] == provider_id && module["id"] == module_id)
            .collect();
        if owners.len() != 1 {
            return false;
        }
        let Some(source_sets) = owners[0]["sourceSets"].as_array() else {
            return false;
        };
        let source_sets: Vec<_> = source_sets
            .iter()
            .filter(|source_set| {
                source_set["id"] == source_set_id
                    && request
                        .source_set_id
                        .as_deref()
                        .is_none_or(|expected| expected == source_set_id)
                    && request
                        .source_set_kind
                        .as_deref()
                        .is_none_or(|expected| source_set["kind"] == expected)
                    && source_set[if generated {
                        "generatedSourceRoots"
                    } else {
                        "sourceRoots"
                    }]
                    .as_array()
                    .is_some_and(|roots| roots.iter().any(|root| root == source_root))
            })
            .collect();
        source_sets.len() == 1
    };
    if schema_version == "java-project-context-v7"
        && !raw["modules"].as_array().is_some_and(|modules| {
            modules.iter().all(|module| {
                module["sourceSets"].as_array().is_some_and(|source_sets| {
                    source_sets
                        .iter()
                        .all(|source_set| maven_test_jvm_fact_valid(&source_set["mavenTestJvm"]))
                })
            })
        })
    {
        return Err("RefactorKit returned invalid Maven test JVM provenance facts.".into());
    }
    let schema_v6_or_later = matches!(
        schema_version,
        "java-project-context-v6" | "java-project-context-v7"
    );
    let metadata_only_unqualified = schema_v6_or_later
        && raw["semanticAnalysis"]["availability"] == "unqualified"
        && raw["semanticAnalysis"]["refusalCode"] == "java.context.sourceAnalysisUnqualified"
        && raw["analysis"].is_null()
        && metadata_only_source_selection_valid();
    let semantic_analysis_available = schema_v6_or_later
        && raw["semanticAnalysis"]["availability"] == "available"
        && raw["semanticAnalysis"]["refusalCode"].is_null()
        && analysis_is_qualified;
    let has_usable_analysis_or_metadata = if schema_v6_or_later {
        metadata_only_unqualified || semantic_analysis_available
    } else {
        analysis_is_qualified
    };
    if raw["status"] == "available"
        && (sdks.is_empty()
            || providers.is_empty()
            || providers.iter().any(|p| {
                !matches!(
                    p["providerId"].as_str(),
                    Some("maven-effective-v1" | "gradle-effective-v1" | "java-declared-v1")
                ) || p["status"] != "available"
            })
            || !has_usable_analysis_or_metadata)
    {
        return Err("RefactorKit has not supplied an effective Java analysis context.".into());
    }
    if raw["status"] == "available" {
        if let (Some(module_id), Some(source_set_selector)) = (
            request.module_id.as_deref(),
            request
                .source_set_id
                .as_deref()
                .or(request.source_set_kind.as_deref()),
        ) {
            let selected_scopes = raw["modules"]
                .as_array()
                .map(|modules| {
                    modules
                        .iter()
                        .filter(|module| {
                            module["id"] == module_id
                                && request
                                    .provider_id
                                    .as_deref()
                                    .is_none_or(|provider_id| module["providerId"] == provider_id)
                                && module["sourceSets"].as_array().is_some_and(|source_sets| {
                                    source_sets.iter().any(|source_set| {
                                        if request.source_set_kind.is_some() {
                                            source_set["kind"] == source_set_selector
                                        } else {
                                            source_set["id"] == source_set_selector
                                        }
                                    })
                                })
                        })
                        .count()
                })
                .unwrap_or(0);
            if selected_scopes != 1 {
                return Err(
                    "RefactorKit did not resolve one selected Java module and source set.".into(),
                );
            }
        }
    }
    let mut context = raw;
    if provider_qualified_context_schema(context["schemaVersion"].as_str().unwrap_or_default()) {
        qualify_context_paths(&mut context, &request.project_path);
    }
    Ok(
        json!({"workspaceId": request.workspace_id, "generation": request.generation, "requestId": request.request_id,
        "projectPath": request.project_path, "status": context["status"], "engineVersion": version, "context": context}),
    )
}
fn query_owned(
    binding: CurrentWorkspaceBinding,
    request: Request,
    state: Arc<Manager>,
    ticket: u64,
) -> Result<Value, String> {
    if state.shutting_down.load(Ordering::SeqCst) {
        return Ok(result(
            &request,
            "refused",
            "ide.java.context.obsolete",
            "The project context is shutting down.",
        ));
    }
    let (project, sdk) = match validate(&request, &binding) {
        Ok(paths) => paths,
        Err(message) => {
            return Ok(result(
                &request,
                "refused",
                "ide.java.context.invalidSettings",
                &message,
            ))
        }
    };
    let current = || {
        !state.shutting_down.load(Ordering::SeqCst)
            && state.revision.load(Ordering::SeqCst) == ticket
            && current_workspace_binding_is_current(&binding)
    };
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    if !current() {
        return Ok(result(
            &request,
            "refused",
            "ide.java.context.obsolete",
            "The project-context request is obsolete.",
        ));
    }
    if active.as_mut().is_some_and(|a| {
        a.binding != binding
            || a.generation != request.generation
            || a.session.root != project
            || a.settings != request_settings(&request)
            || a.require_current_maven_runtime().is_err()
            || a.session.child.try_wait().ok().flatten().is_some()
    }) {
        reset(&mut active);
    }
    if active.is_none() {
        if request.expected_snapshot_hash.is_some() {
            return Ok(result(
                &request,
                "refused",
                "ide.java.context.sessionRetired",
                "Synchronize the Java project again; its provider session was retired.",
            ));
        }
        let mut session = match spawn_session(&request.workspace_id, request.generation, &project) {
            Ok(session) => session,
            Err(_) => {
                return Ok(result(
                    &request,
                    "unavailable",
                    "ide.java.context.providerUnavailable",
                    "Install a RefactorKit daemon with Java effective project-context support.",
                ))
            }
        };
        let capabilities = match session_call_detailed(
            &mut session,
            "server.capabilities",
            json!({}),
            REQUEST_TIMEOUT,
        ) {
            Ok(value) => value,
            Err(_) => {
                terminate(&mut session.child);
                return Ok(result(
                    &request,
                    "unavailable",
                    "ide.java.context.capabilitiesUnavailable",
                    "RefactorKit project-context capability discovery failed.",
                ));
            }
        };
        *active = Some(Active {
            binding: binding.clone(),
            generation: request.generation,
            session_id: state.session_ids.fetch_add(1, Ordering::SeqCst) + 1,
            session,
            capabilities,
            settings: request_settings(&request),
            opened: None,
            context: None,
            context_verification: None,
            maven_runtime: None,
            gradle_sync: None,
            maven_module_rename_plans: Default::default(),
            maven_module_rename_transactions: Default::default(),
            editor_reviews: Default::default(),
            editor_transactions: Default::default(),
        });
    }
    let owned = active.as_mut().unwrap();
    if !advertised(&owned.capabilities) {
        return Ok(result(&request, "unavailable", "ide.java.context.unsupported", "This RefactorKit daemon does not advertise the required Java project-context contract."));
    }
    if request.source_set_kind.is_some() && !maven_failsafe_context_advertised(&owned.capabilities)
    {
        return Ok(result(
            &request,
            "unavailable",
            "ide.java.context.mavenFailsafeMetadataUnavailable",
            "This RefactorKit daemon does not advertise versioned Maven Failsafe execution metadata.",
        ));
    }
    if request.provider_id.is_some()
        && !provider_qualified_source_association_advertised(&owned.capabilities)
    {
        return Ok(result(
            &request,
            "unavailable",
            "ide.java.context.providerQualifiedSelectionUnavailable",
            "This RefactorKit daemon does not advertise provider-qualified Java source selection.",
        ));
    }
    let version = owned.capabilities["version"].as_str().unwrap().to_string();
    let resolved = (|| {
        let reuse = owned.opened.is_some()
            && (request.expected_snapshot_hash.is_some()
                || (request.gradle.is_some()
                    && owned.gradle_sync.is_some()
                    && request.evaluate_gradle != Some(true)));
        if !reuse {
            let mut open = json!({"root": project, "resolveDependencies": false,
            "activeMavenProfiles": request.active_maven_profiles, "inactiveMavenProfiles": request.inactive_maven_profiles});
            if !request.maven_repository.is_empty() {
                open["mavenRepository"] = json!(request.maven_repository);
            }
            owned.maven_runtime = if request.gradle.is_none() {
                attach_maven_runtime(&mut open, &owned.capabilities, &project, &binding.canonical_root)
            } else {
                None
            };
            owned.editor_reviews.clear();
            owned.editor_transactions.clear();
            owned.maven_module_rename_plans.clear();
            let opened = match session_call_detailed(
                &mut owned.session,
                "project.open",
                open,
                REQUEST_TIMEOUT,
            ) {
                Ok(opened) => opened,
                Err(error) if error.rpc_code == Some(PATCH_RECOVERY_REQUIRED_RPC_CODE) => {
                    let supported = saved_source_recovery_advertised(&owned.capabilities);
                    return Ok(result(
                        &request,
                        "refused",
                        if supported {
                            SAVED_SOURCE_RECOVERY_REQUIRED
                        } else {
                            "ide.java.context.savedSourceRecoveryUnavailable"
                        },
                        if supported {
                            "The selected Java project has an interrupted RefactorKit change to saved files."
                        } else {
                            "The selected Java project has interrupted changes to saved files. Its RefactorKit daemon does not advertise recovery."
                        },
                    ));
                }
                Err(_) => return Err("RefactorKit could not open the selected Java project.".into()),
            };
            if opened["root"]
                .as_str()
                .and_then(|v| Path::new(v).canonicalize().ok())
                .as_deref()
                != Some(&project)
            {
                return Err("RefactorKit opened another project directory.".into());
            }
            let snapshot = opened["snapshotHash"]
                .as_str()
                .filter(|v| hash(v))
                .ok_or("Invalid Java project snapshot.")?;
            let generation = opened["indexGeneration"]
                .as_u64()
                .ok_or("Invalid Java project index generation.")?;
            trace_snapshot(
                "project.open",
                json!({
                    "requestId": request.request_id,
                    "snapshotHash": snapshot,
                    "indexGeneration": generation,
                }),
            );
            owned.opened = Some((snapshot.into(), generation));
            owned.context = None;
            owned.context_verification = None;
            owned.gradle_sync = None;
        }
        if reuse && request.expected_snapshot_hash.is_none() {
            // Ordinary synchronization renews saved-source authority without executing
            // Gradle again. The provider still owns build-input invalidation.
            let refreshed = session_call_detailed(
                &mut owned.session,
                "workspace.refresh",
                json!({}),
                REQUEST_TIMEOUT,
            )
            .map_err(|_| "RefactorKit could not refresh saved Java project inputs.")?;
            if !matches!(refreshed["status"].as_str(), Some("ready" | "unchanged")) {
                return Err("Current saved Java project evidence is unavailable.".into());
            }
            let snapshot = refreshed["snapshotHash"]
                .as_str()
                .filter(|value| hash(value))
                .ok_or("Invalid refreshed Java project snapshot.")?;
            let generation = refreshed["generation"]
                .as_u64()
                .ok_or("Invalid refreshed Java index generation.")?;
            refresh_saved_authority(owned, snapshot, generation);
        }
        let mut snapshot = owned.opened.as_ref().unwrap().0.clone();
        if !current() {
            return Err("The Java project-context request is obsolete.".into());
        }
        if request
            .expected_snapshot_hash
            .as_ref()
            .is_some_and(|v| v != &snapshot)
        {
            return Ok(result(
                &request,
                "refused",
                "java.context.snapshotStale",
                "Project inputs changed; synchronize again before using this context.",
            ));
        }
        if request.aggregate_gradle_composite_context == Some(true)
            && !aggregate_gradle_composite_identity_advertised(&owned.capabilities)
        {
            return Err(
                "This RefactorKit daemon does not advertise aggregate Gradle composite identity."
                    .into(),
            );
        }
        if request.evaluate_gradle == Some(true) {
            let supported = owned.capabilities["methods"]
                .as_array()
                .is_some_and(|methods| {
                    methods.iter().any(|m| {
                        m["name"] == "project.sync"
                            && m["requiresProject"] == true
                            && m["writesWorkspace"] == true
                            && [
                                "effectiveGradleContext",
                                "explicitBuildExecution",
                                "offlineDependencyResolution",
                                "configuredSdk",
                                "boundedMetadataExport",
                                "noRequestedCompilationTask",
                            ]
                            .iter()
                            .all(|flag| m["features"][flag] == true)
                    })
                });
            if !supported {
                return Err(
                    "This RefactorKit daemon does not advertise effective Gradle synchronization."
                        .into(),
                );
            }
            let settings = request.gradle.as_ref().unwrap();
            let executable = Path::new(&settings.executable)
                .canonicalize()
                .map_err(|_| "The selected Gradle executable is unavailable.")?;
            if !executable.is_file() {
                return Err("Select a Gradle executable.".into());
            }
            let gradle_runtime_home = settings
                .gradle_runtime_home
                .as_deref()
                .filter(|home| !home.is_empty())
                .map(|home| {
                    Path::new(home)
                        .canonicalize()
                        .map_err(|_| "The selected Gradle runtime JDK is unavailable.")
                })
                .transpose()?;
            let expected_runtime_home = gradle_runtime_home.as_ref().unwrap_or(&sdk);
            let mut sync = json!({"buildSystem":"gradle","expectedSnapshotHash":snapshot,"sdkHome":sdk,
                "gradleExecutable":executable,"allowBuildExecution":true,"projectProperties":settings.project_properties});
            if !settings.user_home.is_empty() {
                sync["gradleUserHome"] = json!(settings.user_home);
            }
            if let Some(runtime_home) = &gradle_runtime_home {
                sync["gradleRuntimeHome"] = json!(runtime_home);
            }
            let receipt = session_call_detailed(
                &mut owned.session,
                "project.sync",
                sync,
                Duration::from_secs(135),
            )
            .map_err(|_| "RefactorKit could not evaluate the Gradle project.")?;
            if receipt["schemaVersion"] == "java-gradle-sync-v1" && receipt["status"] == "refused" {
                let mut refusal = result(
                    &request,
                    "refused",
                    receipt["error"]["code"]
                        .as_str()
                        .filter(|v| text(v, 256))
                        .ok_or("Invalid Gradle refusal.")?,
                    receipt["error"]["message"]
                        .as_str()
                        .filter(|v| text(v, 4096))
                        .ok_or("Invalid Gradle refusal.")?,
                );
                if receipt["error"]["cause"]["evidence"] == "process-output" {
                    if let Some(cause) = receipt["error"]["cause"]["code"]
                        .as_str()
                        .filter(|code| code.starts_with("gradle.sync.cause.") && text(code, 128))
                    {
                        refusal["gradleFailureCause"] = json!(cause);
                    }
                }
                return Ok(refusal);
            }
            if receipt["schemaVersion"] != "java-gradle-sync-v1"
                || receipt["status"] != "synchronized"
                || receipt["providerId"] != "gradle-effective-v1"
                || receipt["snapshotHash"].as_str().is_none_or(|v| !hash(v))
                || receipt["gradleVersion"]
                    .as_str()
                    .is_none_or(|v| !text(v, 128))
                || receipt["sdkHome"]
                    .as_str()
                    .and_then(|v| Path::new(v).canonicalize().ok())
                    .as_deref()
                    != Some(&sdk)
                || receipt.get("gradleRuntimeHome").is_some_and(|reported| {
                    reported
                        .as_str()
                        .and_then(|home| Path::new(home).canonicalize().ok())
                        .as_ref()
                        != Some(expected_runtime_home)
                })
                || !current()
            {
                return Err(
                    "RefactorKit returned invalid or obsolete Gradle synchronization evidence."
                        .into(),
                );
            }
            snapshot = receipt["snapshotHash"].as_str().unwrap().into();
            owned.opened.as_mut().unwrap().0 = snapshot.clone();
            owned.gradle_sync = Some(receipt);
            if request.aggregate_gradle_composite_context == Some(true)
                && std::env::var("IDE_JAVA_CONTEXT_TRACE").as_deref() == Ok("1")
            {
                // Capture the daemon's read-only project inventory beside the
                // aggregate context response when qualifying included-build identity.
                // This diagnostic is opt-in and does not affect the context result.
                let summary = session_call_detailed(
                    &mut owned.session,
                    "project.summary",
                    json!({}),
                    REQUEST_TIMEOUT,
                );
                trace_snapshot(
                    "project.summary.diagnostic",
                    json!({
                        "requestId": request.request_id,
                        "available": summary.is_ok(),
                    }),
                );
            }
        }
        let retry_initial_acquisition = request.expected_snapshot_hash.is_none()
            && request.expected_context_hash.is_none()
            && request.gradle.is_none()
            && request.evaluate_gradle.is_none()
            && owned.context.is_none()
            && owned.gradle_sync.is_none();
        trace_snapshot(
            "project.context.request",
            json!({
                "requestId": request.request_id,
                "expectedSnapshotHash": snapshot,
                "expectedSnapshotPinned": request.expected_snapshot_hash.is_some(),
                "expectedContextPinned": request.expected_context_hash.is_some(),
                "gradleSettingsPresent": request.gradle.is_some(),
                "gradleEvaluationRequested": request.evaluate_gradle == Some(true),
                "contextAlreadyPresent": owned.context.is_some(),
                "gradleReceiptPresent": owned.gradle_sync.is_some(),
                "initialAcquisitionRetryEligible": retry_initial_acquisition,
            }),
        );
        let mut context_request = request.clone();
        let mut method = context_method(&request, &owned.capabilities);
        let params = context_params(&context_request, &snapshot, &sdk, method);
        let mut raw = session_call_detailed(&mut owned.session, method, params, REQUEST_TIMEOUT)
            .map_err(|_| "RefactorKit could not acquire Java project context.")?;
        trace_snapshot(
            "project.context.response",
            json!({
                "requestId": request.request_id,
                "method": method,
                "sourceSetKind": request.source_set_kind,
                "schemaVersion": raw.get("schemaVersion"),
                "attempt": "initial",
                "expectedSnapshotHash": snapshot,
                "observedSnapshotHash": raw.get("snapshotHash"),
                "status": raw.get("status"),
                "refusalCode": raw.pointer("/refusal/code"),
            }),
        );
        if retry_initial_acquisition
            && (raw["schemaVersion"] == "java-project-context-v1"
                || raw["schemaVersion"] == "java-project-context-v2"
                || raw["schemaVersion"] == "java-project-context-v3"
                || raw["schemaVersion"] == "java-project-context-v4"
                || raw["schemaVersion"] == "java-project-context-v5"
                || raw["schemaVersion"] == "java-project-context-v6"
                || raw["schemaVersion"] == "java-project-context-v7")
            && raw["status"] == "refused"
            && raw["refusal"]["code"] == "java.context.snapshotStale"
        {
            if let Some(fresh_snapshot) = raw["snapshotHash"]
                .as_str()
                .filter(|value| hash(value) && *value != snapshot)
            {
                if !current() {
                    return Err("The Java project-context request is obsolete.".into());
                }
                snapshot = fresh_snapshot.to_owned();
                if let Some(opened) = owned.opened.as_mut() {
                    opened.0 = snapshot.clone();
                }
                trace_snapshot(
                    "project.context.retry",
                    json!({
                        "requestId": request.request_id,
                        "reason": "snapshotStale",
                        "retryExpectedSnapshotHash": snapshot,
                        "initialObservedSnapshotHash": fresh_snapshot,
                    }),
                );
                // The retry rebases only this first acquisition. Existing context hashes
                // and caller-provided snapshot authority never enter this path.
                raw = session_call_detailed(
                    &mut owned.session,
                    method,
                    context_params(&context_request, &snapshot, &sdk, method),
                    REQUEST_TIMEOUT,
                )
                .map_err(|_| "RefactorKit could not acquire Java project context.")?;
                trace_snapshot(
                    "project.context.response",
                    json!({
                        "requestId": request.request_id,
                        "method": method,
                        "sourceSetKind": request.source_set_kind,
                        "schemaVersion": raw.get("schemaVersion"),
                        "attempt": "retry",
                        "expectedSnapshotHash": snapshot,
                        "observedSnapshotHash": raw.get("snapshotHash"),
                        "status": raw.get("status"),
                        "refusalCode": raw.pointer("/refusal/code"),
                    }),
                );
            }
        }
        if raw["status"] == "refused"
            && raw["refusal"]["code"] == "java.context.sourceLevelUnsupported"
            && java_project_context_v6_advertised(&owned.capabilities)
            && (request.gradle.is_none() || owned.has_gradle_evaluation())
            && request.expected_context_hash.is_none()
            && request.required_facts.is_none()
            && request.source_relative_path.is_none()
            && request.symbol.is_none()
        {
            if !current() {
                return Err("The Java project-context request is obsolete.".into());
            }
            context_request = select_v6_context_scope(&mut owned.session, &request, &snapshot)?;
            method =
                if context_method(&context_request, &owned.capabilities) == "project.context.v7" {
                    "project.context.v7"
                } else {
                    "project.context.v6"
                };
            raw = session_call_detailed(
                &mut owned.session,
                method,
                context_params(&context_request, &snapshot, &sdk, method),
                REQUEST_TIMEOUT,
            )
            .map_err(|_| "RefactorKit could not acquire Java metadata context.")?;
            trace_snapshot(
                "project.context.response",
                json!({
                    "requestId": request.request_id,
                    "method": method,
                    "sourceSetKind": context_request.source_set_kind,
                    "schemaVersion": raw.get("schemaVersion"),
                    "attempt": "metadata-v6-fallback",
                    "expectedSnapshotHash": snapshot,
                    "observedSnapshotHash": raw.get("snapshotHash"),
                    "status": raw.get("status"),
                    "refusalCode": raw.pointer("/refusal/code"),
                }),
            );
        }
        if raw["providers"].as_array().is_some_and(|providers| {
            providers
                .iter()
                .any(|p| p["providerId"] == "gradle-effective-v1")
        }) && owned.gradle_sync.is_none()
        {
            return Err(
                "Effective Gradle context requires an explicit evaluation in this session.".into(),
            );
        }
        let raw_schema_version = raw["schemaVersion"].as_str().map(str::to_owned);
        let mut normalized = match normalize(raw, &context_request, &snapshot, &sdk, &version) {
            Ok(normalized) => {
                trace_snapshot(
                    "project.context.normalize",
                    json!({
                        "requestId": request.request_id,
                        "method": method,
                        "schemaVersion": raw_schema_version,
                        "outcome": "accepted",
                    }),
                );
                normalized
            }
            Err(error) => {
                trace_snapshot(
                    "project.context.normalize",
                    json!({
                        "requestId": request.request_id,
                        "method": method,
                        "schemaVersion": raw_schema_version,
                        "outcome": "rejected",
                        "error": error,
                    }),
                );
                return Err(error);
            }
        };
        if let Some(receipt) = &owned.gradle_sync {
            normalized["gradleSync"] = receipt.clone();
        }
        owned.require_current_maven_runtime()?;
        owned.context = normalized.get("context").cloned();
        owned.context_verification = owned.context.as_ref().map(|_| {
            (method.to_owned(), context_params(&context_request, &snapshot, &sdk, method))
        });
        if !current() {
            return Err("The Java project-context request is obsolete.".into());
        }
        Ok::<Value, String>(normalized)
    })();
    match resolved {
        Ok(value) if value["code"] == SAVED_SOURCE_RECOVERY_REQUIRED => {
            reset(&mut active);
            if current() {
                *state
                    .saved_source_recovery
                    .lock()
                    .map_err(|_| "Java saved-file recovery is unavailable.")? =
                    Some(PendingSavedSourceRecovery {
                        request: SavedSourceRecoveryRequest {
                            workspace_id: request.workspace_id,
                            generation: request.generation,
                            project_path: request.project_path,
                            request_id: request.request_id,
                        },
                        canonical_project: project,
                        ticket,
                    });
            }
            Ok(value)
        }
        Ok(value) if value["code"] == "ide.java.context.savedSourceRecoveryUnavailable" => {
            reset(&mut active);
            Ok(value)
        }
        Ok(value) => Ok(value),
        Err(message) => {
            reset(&mut active);
            Ok(result(
                &request,
                "refused",
                "ide.java.context.acquisitionFailed",
                &message,
            ))
        }
    }
}
fn saved_source_recovery_advertised(capabilities: &Value) -> bool {
    capabilities["methods"].as_array().is_some_and(|methods| {
        let mut recovery = methods.iter().filter(|method| method["name"] == "patch.recover");
        recovery.next().is_some_and(|method| {
            method["requiresProject"] == false && method["writesWorkspace"] == true
        }) && recovery.next().is_none()
    })
}

fn recover_saved_sources_at(
    request: SavedSourceRecoveryRequest,
    binding: CurrentWorkspaceBinding,
    state: &Manager,
    java_language: &JavaLanguageServiceState,
) -> Result<Value, String> {
    ensure_running(state)?;
    let _active = state.active.lock().map_err(|_| "Java project context is unavailable.")?;
    let mut pending = state
        .saved_source_recovery
        .lock()
        .map_err(|_| "Java saved-file recovery is unavailable.")?;
    let observed = pending.as_ref().filter(|observed| {
        observed.request == request
            && observed.ticket == state.revision.load(Ordering::SeqCst)
    }).ok_or("Synchronize the selected Java project and review recovery again.")?;
    let project_directory = binding.canonical_root.join(&request.project_path);
    let is_current = || {
        !state.shutting_down.load(Ordering::SeqCst)
            && state.revision.load(Ordering::SeqCst) == observed.ticket
            && current_workspace_binding_is_current(&binding)
            && project_directory.canonicalize().ok().as_ref() == Some(&observed.canonical_project)
    };
    if !is_current() {
        return Err("The selected Java project changed before recovery.".into());
    }
    let mut session = spawn_session(
        &request.workspace_id,
        request.generation,
        &observed.canonical_project,
    )?;
    let outcome = (|| {
        let capabilities = session_call_detailed(
            &mut session, "server.capabilities", json!({}), REQUEST_TIMEOUT,
        )
        .map_err(|_| "RefactorKit recovery capability discovery failed.")?;
        if !saved_source_recovery_advertised(&capabilities) {
            return Err("This RefactorKit daemon does not advertise saved-file recovery.".into());
        }
        match session_call_detailed(
            &mut session,
            "project.open",
            json!({"root": observed.canonical_project, "resolveDependencies": false}),
            REQUEST_TIMEOUT,
        ) {
            Err(error) if error.rpc_code == Some(PATCH_RECOVERY_REQUIRED_RPC_CODE) => {}
            Ok(_) => return Err("No interrupted changes remain. Synchronize the project again.".into()),
            Err(_) => return Err("RefactorKit could not verify that the project still requires recovery.".into()),
        }
        if !is_current() {
            return Err("The selected Java project changed before recovery.".into());
        }
        java_language.with_project_topology_paused(&request.workspace_id, || {
            with_root_activation(|| {
                if !is_current() {
                    return Err("The selected Java project changed before recovery.".into());
                }
                let result = session_call_detailed(
                    &mut session,
                    "patch.recover",
                    json!({"root": observed.canonical_project}),
                    REQUEST_TIMEOUT,
                )
                .map_err(|error| {
                    if error.rpc_code == Some(PATCH_RECOVERY_REQUIRED_RPC_CODE) {
                        "RefactorKit could not safely complete recovery. Inspect the saved files and the RefactorKit journal before trying again."
                    } else {
                        "RefactorKit did not confirm recovery. Inspect the saved files and synchronize again."
                    }
                })?;
                if result["recovered"] != true
                    || result["root"].as_str().map(Path::new) != Some(observed.canonical_project.as_path())
                {
                    return Err("RefactorKit returned an invalid saved-file recovery result.".into());
                }
                Ok(json!({
                    "workspaceId": request.workspace_id,
                    "generation": request.generation,
                    "projectPath": request.project_path,
                    "requestId": request.request_id,
                    "recovered": true,
                }))
            })
        })?
    })();
    terminate(&mut session.child);
    if outcome.is_ok() {
        pending.take();
    }
    outcome
}

pub(super) fn prepare_saved_source_recovery(
    request: SavedSourceRecoveryRequest,
    state: &JavaProjectContextState,
) -> Result<impl FnOnce(&JavaLanguageServiceState) -> Result<Value, String> + Send + 'static, String> {
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !valid_authority(&request.workspace_id, request.generation)
        || (!request.project_path.is_empty()
            && validate_relative_project_path(&request.project_path).is_err())
    {
        return Err("The selected Java project is unavailable for recovery.".into());
    }
    let state = state.shared();
    Ok(move |java_language: &JavaLanguageServiceState| {
        recover_saved_sources_at(request, binding, &state, java_language)
    })
}

pub(super) fn prepare_query(
    request: Request,
    state: &JavaProjectContextState,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    ensure_running(&state.0)?;
    if !valid_required_facts(&request) {
        return Err("Invalid required Java project-context facts.".into());
    }
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !valid_authority(&request.workspace_id, request.generation)
    {
        return Err("The Java workspace changed.".into());
    }
    let state = state.0.clone();
    if request.module_id.is_none()
        && request.source_set_id.is_none()
        && request.source_set_kind.is_none()
        && request.source_relative_path.is_none()
        && request.symbol.is_none()
    {
        retire_project_watch_for_sync(
            &Authority {
                workspace_id: request.workspace_id.clone(),
                generation: request.generation,
            },
            &state,
        )?;
    }
    *state
        .authority
        .lock()
        .map_err(|_| "Java project context is unavailable.")? =
        Some((request.workspace_id.clone(), request.generation));
    let ticket = state.revision.fetch_add(1, Ordering::SeqCst) + 1;
    Ok(move || query_owned(binding, request, state, ticket))
}

fn language_settings_response(
    request: &LanguageSettingsRequest,
    outcome: &str,
    message: &str,
) -> Value {
    json!({
        "workspaceId": request.workspace_id,
        "generation": request.generation,
        "projectPath": request.project_path,
        "contextSchemaVersion": request.context_schema_version,
        "snapshotHash": request.snapshot_hash,
        "contextHash": request.context_hash,
        "outcome": outcome,
        "message": message,
    })
}

pub(super) fn apply_language_settings(
    request: LanguageSettingsRequest,
    state: &JavaProjectContextState,
    java_language: &crate::commands::java_language::JavaLanguageServiceState,
) -> Result<Value, String> {
    if !valid_authority(&request.workspace_id, request.generation)
        || (request.project_path != ""
            && validate_relative_project_path(&request.project_path).is_err())
        || !hash(&request.snapshot_hash)
        || !hash(&request.context_hash)
        || !matches!(
            request.context_schema_version.as_str(),
            "java-project-context-v1"
                | "java-project-context-v2"
                | "java-project-context-v3"
                | "java-project-context-v4"
                | "java-project-context-v5"
                | "java-project-context-v6"
                | "java-project-context-v7"
        )
    {
        return Err("Invalid Java project language-settings authority.".into());
    }
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "Cannot authorize the current workspace.")?;
    let binding = current_workspace_binding_at(&root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !current_workspace_binding_is_current(&binding)
    {
        return Ok(language_settings_response(
            &request,
            "refused",
            "The workspace changed before JDT LS could receive the project compiler settings.",
        ));
    }
    let revision = state.0.revision.load(Ordering::SeqCst);
    let mut active = state
        .0
        .active
        .lock()
        .map_err(|_| "Java project context is unavailable.")?;
    let Some(owned) = active.as_mut() else {
        return Ok(language_settings_response(
            &request,
            "unavailable",
            "Synchronize the Gradle project before applying compiler settings to JDT LS.",
        ));
    };
    if state.0.revision.load(Ordering::SeqCst) != revision
        || owned.binding != binding
        || owned.generation != request.generation
        || owned.settings["projectPath"] != request.project_path
        || !current_workspace_binding_is_current(&binding)
    {
        return Ok(language_settings_response(
            &request,
            "refused",
            "The synchronized Java project context changed before applying compiler settings.",
        ));
    }
    let Some(context) = owned.context.as_ref() else {
        return Ok(language_settings_response(
            &request,
            "unavailable",
            "Synchronize the Gradle project before applying compiler settings to JDT LS.",
        ));
    };
    if context["schemaVersion"] != request.context_schema_version
        || context["snapshotHash"] != request.snapshot_hash
        || context["contextHash"] != request.context_hash
    {
        return Ok(language_settings_response(
            &request,
            "refused",
            "The requested compiler settings belong to a stale project snapshot.",
        ));
    }

    // Retire a previous provider-derived JDT LS override before considering the
    // new context. This keeps a failed or partial synchronization from leaving
    // stale preview semantics active in the editor.
    java_language.clear_project_compiler_settings(&request.workspace_id, request.generation)?;

    let Some(gradle) = owned.settings["gradle"].as_object() else {
        return Ok(language_settings_response(
            &request,
            "unavailable",
            "JDT LS compiler synchronization is limited to an explicitly configured Gradle project.",
        ));
    };
    if gradle.is_empty() || owned.gradle_sync.is_none() {
        return Ok(language_settings_response(
            &request,
            "unavailable",
            "Evaluate and synchronize the Gradle project before applying its compiler settings.",
        ));
    }
    let gradle_settings: crate::commands::java_language::JavaLanguageGradleSettings =
        match serde_json::from_value(owned.settings["gradle"].clone()) {
            Ok(settings) => settings,
            Err(_) => {
                return Ok(language_settings_response(
                    &request,
                    "unavailable",
                    "The synchronized Gradle settings cannot be matched to the JDT LS session.",
                ));
            }
        };
    let Some(selected_sdk_home) = owned.settings["sdkHome"]
        .as_str()
        .and_then(|home| Path::new(home).canonicalize().ok())
    else {
        return Ok(language_settings_response(
            &request,
            "unavailable",
            "The selected project JDK is no longer available.",
        ));
    };
    let project_root = owned.session.root.clone();
    let (targets, preview_release) =
        match gradle_preview_targets(context, &root, &project_root, &selected_sdk_home) {
            Ok(targets) => targets,
            Err(message) => {
                return Ok(language_settings_response(&request, "unavailable", message));
            }
        };
    if targets.is_empty() {
        return Ok(language_settings_response(
            &request,
            "unchanged",
            "The complete Gradle compiler settings do not enable preview features; JDT LS import settings are retained.",
        ));
    }
    let applied = java_language.apply_gradle_preview_settings(
        &request.workspace_id,
        request.generation,
        &request.project_path,
        &selected_sdk_home,
        &gradle_settings,
        &request.context_hash,
        &targets,
        preview_release,
    )?;
    if state.0.revision.load(Ordering::SeqCst) != revision
        || state.0.shutting_down.load(Ordering::SeqCst)
        || !current_workspace_binding_is_current(&binding)
        || owned.context.as_ref().is_none_or(|current| {
            current["contextHash"] != request.context_hash
                || current["snapshotHash"] != request.snapshot_hash
        })
    {
        java_language.clear_project_compiler_settings(&request.workspace_id, request.generation)?;
        return Ok(language_settings_response(
            &request,
            "refused",
            "The Java project context changed while applying compiler settings; JDT LS settings were restored.",
        ));
    }
    match applied {
        None => Ok(language_settings_response(
            &request,
            "unavailable",
            "JDT LS is not ready with the same authorized Gradle project and workspace generation.",
        )),
        Some(false) => Ok(language_settings_response(
            &request,
            "unchanged",
            "JDT LS already uses the verified Gradle preview compiler setting.",
        )),
        Some(true) => Ok(language_settings_response(
            &request,
            "applied",
            "Applied the verified Gradle preview compiler setting to the matching JDT LS projects.",
        )),
    }
}

fn validate_relative_project_path(value: &str) -> Result<(), String> {
    let normalized = value.replace('\\', "/");
    if value.len() > 4096
        || value.chars().any(char::is_control)
        || normalized.starts_with('/')
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Invalid Java project path.".into());
    }
    Ok(())
}

pub(super) fn clear_language_settings(
    authority: Authority,
    java_language: &crate::commands::java_language::JavaLanguageServiceState,
) -> Result<(), String> {
    if !valid_authority(&authority.workspace_id, authority.generation) {
        return Err("Invalid Java project context authority.".into());
    }
    java_language.clear_project_compiler_settings(&authority.workspace_id, authority.generation)
}

pub(super) fn prepare_stop(
    authority: Authority,
    state: &JavaProjectContextState,
) -> Result<impl FnOnce() -> Result<(), String> + Send + 'static, String> {
    ensure_running(&state.0)?;
    if !valid_authority(&authority.workspace_id, authority.generation) {
        return Err("Invalid Java project-context authority.".into());
    }
    let state = state.0.clone();
    let matched = state
        .authority
        .lock()
        .map_err(|_| "Java project context is unavailable.")?
        .as_ref()
        .is_some_and(|a| a == &(authority.workspace_id.clone(), authority.generation));
    let stopped = if matched {
        Some(state.revision.fetch_add(1, Ordering::SeqCst) + 1)
    } else {
        None
    };
    trace_snapshot(
        "project.context.stop",
        json!({
            "workspaceId": &authority.workspace_id,
            "generation": authority.generation,
            "matched": matched,
        }),
    );
    Ok(move || {
        if let Some(ticket) = stopped {
            if let Ok(mut watcher) = state.project_watcher.lock() {
                if watcher.as_ref().is_some_and(|watcher| {
                    watcher.workspace_id == authority.workspace_id
                        && watcher.generation == authority.generation
                }) {
                    watcher.take();
                }
            }
            let mut active = state
                .active
                .lock()
                .map_err(|_| "Java project context is unavailable.")?;
            if state.revision.load(Ordering::SeqCst) == ticket {
                reset(&mut active);
            }
        }
        Ok(())
    })
}

#[cfg(test)]
pub(super) fn capabilities_at(state: &Arc<Manager>) -> Value {
    state
        .active
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .capabilities
        .clone()
}

#[cfg(test)]
#[path = "java_project_context_tests.rs"]
mod tests;
