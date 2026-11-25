//! Session/application lifecycle and process ownership orchestration.

use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use url::Url;

use crate::app_config::ide_home_dir;
use crate::commands::refactorkit_daemon::GradleGeneratedSourceSet;
use crate::workspace::workspace_root;

use super::contract::*;
use super::path_policy::*;
use super::protocol::*;
use super::semantic::*;
use super::support::lock;
use super::toolchain::*;

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const EXIT_TIMEOUT: Duration = Duration::from_secs(2);
// A normal project setup can start JDT LS, then restart for the selected JDK,
// project root and Maven profiles. Keep a burst bound for crash loops without
// blocking that configuration sequence or an immediate SDK change.
const MAX_RESTARTS_PER_MINUTE: usize = 8;
const DOCUMENT_WRITE_TIMEOUT: Duration = Duration::from_secs(2);
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(5);
const HOVER_TIMEOUT: Duration = Duration::from_secs(4);
const SIGNATURE_HELP_TIMEOUT: Duration = Duration::from_secs(4);
const FORMATTING_TIMEOUT: Duration = Duration::from_secs(10);
const WORKSPACE_SYMBOLS_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_JAVA_PROJECTS_FOR_MAVEN_PROFILES: usize = 512;
const MAX_MAVEN_PROFILES: usize = 64;
const MAX_MAVEN_PROFILE_ID_BYTES: usize = 256;
const MAVEN_NATURE_ID: &str = "org.eclipse.m2e.core.maven2Nature";
const GRADLE_NATURE_ID: &str = "org.eclipse.buildship.core.gradleprojectnature";
const MAVEN_SELECTED_PROFILES_SETTING: &str = "org.eclipse.m2e.core.selectedProfiles";
const JAVA_NATURE_IDS_SETTING: &str = "org.eclipse.jdt.ls.core.natureIds";
const JAVA_COMPILER_SOURCE_SETTING: &str = "org.eclipse.jdt.core.compiler.source";
const JAVA_COMPILER_COMPLIANCE_SETTING: &str = "org.eclipse.jdt.core.compiler.compliance";
const JAVA_COMPILER_TARGET_SETTING: &str = "org.eclipse.jdt.core.compiler.codegen.targetPlatform";
const JAVA_ENABLE_PREVIEW_SETTING: &str =
    "org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures";
const GRADLE_PREVIEW_COMPILER_SETTINGS: [&str; 4] = [
    JAVA_COMPILER_SOURCE_SETTING,
    JAVA_COMPILER_COMPLIANCE_SETTING,
    JAVA_COMPILER_TARGET_SETTING,
    JAVA_ENABLE_PREVIEW_SETTING,
];

pub(super) fn list_formatter_profiles(
    window_label: &str,
    workspace_id: &str,
    path: &str,
) -> Result<Vec<String>, String> {
    use crate::app_config::workspace_registry_path;
    use crate::commands::workspace_registry::{
        current_workspace_binding_at, current_workspace_binding_is_current,
    };

    if window_label != "main" {
        return Err("Formatter profiles can only be read from the main workspace".into());
    }
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != workspace_id {
        return Err("The Java workspace changed".into());
    }
    let names = list_formatter_profile_names(&binding.canonical_root, path)?;
    if !current_workspace_binding_is_current(&binding) {
        return Err("The Java workspace changed while reading formatter profiles".into());
    }
    Ok(names)
}

fn trace_language_lifecycle(stage: &str) {
    crate::commands::refactorkit_daemon::trace_java_application_lifecycle(stage);
}

struct RuntimeInfo {
    lifecycle: String,
    capabilities: Option<JavaLanguageCapabilities>,
    detail: Option<String>,
    diagnostic_refusals: HashMap<String, String>,
}

struct Session {
    generation: u64,
    workspace_id: String,
    workspace_root: PathBuf,
    jdtls: JdtlsInstall,
    java: JavaInstall,
    project_jdk: Option<ProjectJdk>,
    server_jdk_home: Option<String>,
    gradle_import_enabled: bool,
    java_formatter_profile: Option<JavaLanguageFormatterProfile>,
    _private_formatter_profile: Option<PrivateFormatterProfile>,
    project_path: String,
    maven_repository: String,
    maven_project_root: PathBuf,
    maven_user_settings: Option<PrivateMavenSettings>,
    gradle_settings: Option<JavaLanguageGradleSettings>,
    gradle_generated_source_script: Option<String>,
    _gradle_generated_source_import: Option<GradleGeneratedSourceImport>,
    active_maven_profiles: Vec<String>,
    inactive_maven_profiles: Vec<String>,
    gradle_preview_context_hash: Option<String>,
    compiler_latest_source: Option<u32>,
    project_settings_supported: bool,
    gradle_preview_original_settings: HashMap<String, HashMap<String, String>>,
    child: Arc<Mutex<Child>>,
    writer: Arc<Mutex<ChildStdin>>,
    shutdown_id: Arc<AtomicU64>,
    shutdown_rx: mpsc::Receiver<()>,
    runtime: Arc<Mutex<RuntimeInfo>>,
    semantic_token_legend: Option<SemanticTokenLegend>,
    open_documents: HashMap<String, OpenDocument>,
    pending_semantic: PendingSemanticRequests,
    next_request_id: Arc<AtomicU64>,
    threads: Vec<JoinHandle<()>>,
}

struct Manager {
    generation: u64,
    session: Option<Session>,
    initialization_failure: Option<(PathBuf, String)>,
    events: Arc<Mutex<EventQueue>>,
    restart_times: VecDeque<Instant>,
    startup: Arc<Mutex<StartupState>>,
}

impl Default for Manager {
    fn default() -> Self {
        Self {
            generation: 0,
            session: None,
            initialization_failure: None,
            events: Arc::new(Mutex::new(EventQueue::default())),
            restart_times: VecDeque::new(),
            startup: Arc::new(Mutex::new(StartupState::default())),
        }
    }
}

#[derive(Default)]
struct StartupState {
    exiting: bool,
    child: Option<Arc<Mutex<Child>>>,
}

impl StartupState {
    fn admit(&self) -> Result<(), String> {
        if self.exiting {
            return Err("The IDE is exiting; Java language service startup was cancelled".into());
        }
        Ok(())
    }
}

struct StartingChild(Arc<Mutex<StartupState>>);

impl Drop for StartingChild {
    fn drop(&mut self) {
        if let Ok(mut startup) = self.0.lock() {
            startup.child = None;
        }
    }
}

pub struct JavaLanguageServiceState {
    manager: Mutex<Manager>,
    startup: Arc<Mutex<StartupState>>,
    main_document_changed: AtomicBool,
}

impl Default for JavaLanguageServiceState {
    fn default() -> Self {
        Self::new(Manager::default())
    }
}

impl JavaLanguageServiceState {
    fn new(manager: Manager) -> Self {
        Self {
            startup: Arc::clone(&manager.startup),
            manager: Mutex::new(manager),
            main_document_changed: AtomicBool::new(false),
        }
    }

    pub(crate) fn main_document_changed(&self) {
        self.main_document_changed.store(true, Ordering::Release);
    }

    fn manager(&self) -> Result<MutexGuard<'_, Manager>, String> {
        let mut manager = lock(&self.manager, "Java language service state")?;
        // Navigation relinquishes the editor's document versions. Retire the
        // old session on a blocking worker before admitting more Java work.
        if self.main_document_changed.swap(false, Ordering::AcqRel) && manager.session.is_some() {
            trace_language_lifecycle("main-document-retire-java-session");
            stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        }
        Ok(manager)
    }

    pub(crate) fn begin_application_exit(&self) {
        let child = match self.startup.lock() {
            Ok(mut startup) => {
                startup.exiting = true;
                startup.child.take()
            }
            Err(_) => return,
        };
        // Startup holds the manager while waiting for JDT LS responses.
        // Closing its pipes releases those waits before shutdown takes the manager.
        if let Some(child) = child {
            if let Ok(mut child) = child.lock() {
                trace_language_lifecycle("stop-cancel-startup");
                let _ = child.kill();
            }
        }
    }

    pub fn shutdown_all(&self) {
        if let Ok(mut manager) = self.manager.lock() {
            let _ = stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT);
        }
    }

    pub(in crate::commands) fn with_project_topology_paused<T>(
        &self,
        workspace_id: &str,
        work: impl FnOnce() -> T,
    ) -> Result<T, String> {
        let mut manager = self.manager()?;
        if let Some(session) = manager.session.as_ref() {
            if session.workspace_id != workspace_id {
                return Err("The Java language service is attached to another workspace.".into());
            }
            stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        }
        // Start and restart take the same manager lock. In particular, a queued
        // editor activation cannot import the old project while the provider moves it.
        let result = work();
        drop(manager);
        Ok(result)
    }

    pub(in crate::commands) fn apply_gradle_preview_settings(
        &self,
        workspace_id: &str,
        generation: u64,
        project_path: &str,
        project_jdk_home: &Path,
        gradle_settings: &JavaLanguageGradleSettings,
        context_hash: &str,
        module_roots: &[PathBuf],
        preview_release: u64,
    ) -> Result<Option<bool>, String> {
        let mut manager = self.manager()?;
        let Some(session) = manager.session.as_mut() else {
            return Ok(None);
        };
        if session.workspace_id != workspace_id
            || session.generation != generation
            || session.project_path != project_path
            || session
                .project_jdk
                .as_ref()
                .is_none_or(|jdk| jdk.home != project_jdk_home)
            || !session.gradle_import_enabled
            || session.gradle_settings.as_ref() != Some(gradle_settings)
        {
            return Ok(None);
        }
        if !matches!(
            lock(&session.runtime, "Java language service runtime")?
                .lifecycle
                .as_str(),
            "initialized" | "ready" | "degraded"
        ) {
            return Ok(None);
        }
        if session.gradle_preview_context_hash.as_deref() == Some(context_hash) {
            return Ok(Some(false));
        }
        restore_gradle_preview_settings(session)?;
        if module_roots.is_empty() {
            return Ok(Some(false));
        }
        apply_gradle_preview_settings_to_session(
            session,
            context_hash,
            module_roots,
            preview_release,
        )
        .map(Some)
    }

    pub(super) fn clear_project_compiler_settings_inner(
        &self,
        workspace_id: &str,
        generation: u64,
    ) -> Result<(), String> {
        let mut manager = self.manager()?;
        let Some(session) = manager.session.as_mut() else {
            return Ok(());
        };
        if session.workspace_id != workspace_id || session.generation != generation {
            return Ok(());
        }
        restore_gradle_preview_settings(session)
    }

    pub(super) fn service_status(&self) -> Result<JavaLanguageServiceStatus, String> {
        let manager = self.manager()?;
        status(&manager)
    }

    #[cfg(test)]
    pub(super) fn start(
        &self,
        request: Option<JavaLanguageSessionRequest>,
    ) -> Result<JavaLanguageServiceStatus, String> {
        self.start_with_generated_sources(request, &[])
    }

    pub(super) fn start_with_generated_sources(
        &self,
        request: Option<JavaLanguageSessionRequest>,
        generated_sources: &[GradleGeneratedSourceSet],
    ) -> Result<JavaLanguageServiceStatus, String> {
        let mut manager = self.manager()?;
        validate_session_request(&manager, request.as_ref(), true)?;
        start_session(
            &mut manager,
            INITIALIZE_TIMEOUT,
            request
                .as_ref()
                .and_then(|request| request.project_jdk_home.as_deref()),
            request
                .as_ref()
                .and_then(|request| request.server_jdk_home.as_deref()),
            request
                .as_ref()
                .and_then(|request| request.gradle_import_enabled)
                .unwrap_or(false),
            request
                .as_ref()
                .and_then(|request| request.project_path.as_deref())
                .unwrap_or(""),
            request
                .as_ref()
                .and_then(|request| request.maven_repository.as_deref())
                .unwrap_or(""),
            request
                .as_ref()
                .and_then(|request| request.active_maven_profiles.as_deref())
                .unwrap_or_default(),
            request
                .as_ref()
                .and_then(|request| request.inactive_maven_profiles.as_deref())
                .unwrap_or_default(),
            request.as_ref().and_then(|request| request.gradle.as_ref()),
            request
                .as_ref()
                .and_then(|request| request.java_formatter_profile.as_ref()),
            generated_sources,
            false,
        )?;
        verify_started_workspace(&mut manager, request.as_ref())?;
        status(&manager)
    }

    pub(super) fn stop(
        &self,
        request: Option<JavaLanguageSessionRequest>,
    ) -> Result<JavaLanguageServiceStatus, String> {
        let mut manager = self.manager()?;
        validate_session_request(&manager, request.as_ref(), false)?;
        if request
            .as_ref()
            .is_some_and(|request| request.generation.is_none())
        {
            return Err("Java language Stop requires the owning generation".to_string());
        }
        stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        status(&manager)
    }

    #[cfg(test)]
    pub(super) fn restart(
        &self,
        request: Option<JavaLanguageSessionRequest>,
    ) -> Result<JavaLanguageServiceStatus, String> {
        self.restart_with_generated_sources(request, &[])
    }

    pub(super) fn restart_with_generated_sources(
        &self,
        request: Option<JavaLanguageSessionRequest>,
        generated_sources: &[GradleGeneratedSourceSet],
    ) -> Result<JavaLanguageServiceStatus, String> {
        let mut manager = self.manager()?;
        validate_session_request(&manager, request.as_ref(), true)?;
        if request
            .as_ref()
            .is_some_and(|request| request.generation.is_none())
        {
            return Err("Java language Restart requires the owning generation".to_string());
        }
        // Check the replacement JDK before stopping the current provider.
        if let Some(home) = request
            .as_ref()
            .and_then(|request| request.project_jdk_home.as_deref())
        {
            probe_project_jdk(home)?;
        }
        let server_jdk_home = request
            .as_ref()
            .and_then(|request| request.server_jdk_home.as_deref());
        validate_server_jdk_home(server_jdk_home)?;
        let jdtls = discover_jdtls()?;
        discover_jdtls_java_with_home(&jdtls, server_jdk_home)?;
        let active_maven_profiles = request
            .as_ref()
            .and_then(|request| request.active_maven_profiles.as_deref())
            .unwrap_or_default();
        let inactive_maven_profiles = request
            .as_ref()
            .and_then(|request| request.inactive_maven_profiles.as_deref())
            .unwrap_or_default();
        maven_profile_selection(active_maven_profiles, inactive_maven_profiles)?;
        let maven_repository = request
            .as_ref()
            .and_then(|request| request.maven_repository.as_deref())
            .unwrap_or("");
        if !maven_repository.is_empty() {
            validate_maven_local_repository(maven_repository)?;
        }
        let root = workspace_root()?;
        let (selected_project_root, _) = resolve_maven_project_root(
            &root,
            request
                .as_ref()
                .and_then(|request| request.project_path.as_deref())
                .unwrap_or(""),
        )?;
        validate_gradle_language_settings(
            request.as_ref().and_then(|request| request.gradle.as_ref()),
        )?;
        let java_formatter_profile = request
            .as_ref()
            .and_then(|request| request.java_formatter_profile.as_ref());
        validate_java_formatter_profile(&root, java_formatter_profile)?;
        resolve_gradle_import_launcher(
            request
                .as_ref()
                .and_then(|request| request.gradle_import_enabled)
                .unwrap_or(false),
            request.as_ref().and_then(|request| request.gradle.as_ref()),
            &root,
            &selected_project_root,
        )?;
        let gradle_import_settings_changed = manager.session.as_ref().is_some_and(|session| {
            session.gradle_import_enabled
                != request
                    .as_ref()
                    .and_then(|request| request.gradle_import_enabled)
                    .unwrap_or(false)
                || session.gradle_settings.as_ref()
                    != request.as_ref().and_then(|request| request.gradle.as_ref())
        });
        stop_session(&mut manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        start_session(
            &mut manager,
            INITIALIZE_TIMEOUT,
            request
                .as_ref()
                .and_then(|request| request.project_jdk_home.as_deref()),
            server_jdk_home,
            request
                .as_ref()
                .and_then(|request| request.gradle_import_enabled)
                .unwrap_or(false),
            request
                .as_ref()
                .and_then(|request| request.project_path.as_deref())
                .unwrap_or(""),
            maven_repository,
            request
                .as_ref()
                .and_then(|request| request.active_maven_profiles.as_deref())
                .unwrap_or_default(),
            request
                .as_ref()
                .and_then(|request| request.inactive_maven_profiles.as_deref())
                .unwrap_or_default(),
            request.as_ref().and_then(|request| request.gradle.as_ref()),
            java_formatter_profile,
            generated_sources,
            gradle_import_settings_changed,
        )?;
        verify_started_workspace(&mut manager, request.as_ref())?;
        status(&manager)
    }

    pub(super) fn poll_events(
        &self,
        after_sequence: u64,
        limit: usize,
    ) -> Result<JavaLanguageServiceEventBatch, String> {
        let manager = self.manager()?;
        let queue = lock(&manager.events, "Java language service event queue")?;
        Ok(queue.poll(after_sequence, limit))
    }

    pub(super) fn open_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Open, document)
    }

    pub(super) fn change_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Change, document)
    }

    pub(super) fn save_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Save, document)
    }

    pub(super) fn close_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Close, document)
    }

    pub(super) fn revalidate_document(&self, document: JavaLanguageDocument) -> Result<(), String> {
        self.synchronize(SyncAction::Validate, document)
    }

    pub(super) fn notify_workspace_file_saved(
        &self,
        document: JavaLanguageWorkspaceFile,
    ) -> Result<(), String> {
        let manager = self.manager()?;
        let session = manager
            .session
            .as_ref()
            .ok_or("Java language service has no active session")?;
        let root = workspace_root()?
            .canonicalize()
            .map_err(|_| "Cannot authorize the current workspace")?;
        if !matches!(
            lock(&session.runtime, "Java language service runtime")?
                .lifecycle
                .as_str(),
            "initialized" | "ready" | "degraded"
        ) {
            return Err(
                "Java language service is not ready for workspace file notifications".into(),
            );
        }
        let message = saved_workspace_file_message(
            &session.workspace_root,
            &root,
            &session.workspace_id,
            session.generation,
            &document,
        )?;
        write_message_timeout(&session.writer, message, DOCUMENT_WRITE_TIMEOUT)
    }

    fn synchronize(
        &self,
        action: SyncAction,
        document: JavaLanguageDocument,
    ) -> Result<(), String> {
        let mut manager = self.manager()?;
        sync_document(&mut manager, action, document)
    }

    pub(super) fn request_completion(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::Completion, COMPLETION_TIMEOUT)
    }

    pub(super) fn request_hover(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::Hover, HOVER_TIMEOUT)
    }

    pub(super) fn request_signature_help(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::SignatureHelp,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn request_document_symbols(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::DocumentSymbols,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn request_workspace_symbols(
        &self,
        request: JavaWorkspaceSymbolsRequest,
    ) -> Result<JavaWorkspaceSymbolsNativeResponse, String> {
        workspace_symbols_request(self, request)
    }

    pub(super) fn request_document_highlights(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::DocumentHighlights,
            HOVER_TIMEOUT,
        )
    }

    pub(super) fn request_implementations(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::Implementations,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn request_definitions(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::Definitions,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn request_type_definitions(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::TypeDefinitions,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn request_call_hierarchy(
        &self,
        request: JavaCallHierarchyRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        call_hierarchy_request(self, request)
    }

    pub(super) fn request_references(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(
            self,
            request,
            SemanticKind::References,
            SIGNATURE_HELP_TIMEOUT,
        )
    }

    pub(super) fn request_semantic_tokens(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::SemanticTokens, HOVER_TIMEOUT)
    }

    pub(super) fn request_inlay_hints(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::InlayHints, HOVER_TIMEOUT)
    }

    pub(super) fn request_formatting(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        let kind = if request.formatting_character.is_some() {
            SemanticKind::OnTypeFormatting
        } else if request.range.is_some() {
            SemanticKind::RangeFormatting
        } else {
            SemanticKind::Formatting
        };
        semantic_request(self, request, kind, FORMATTING_TIMEOUT)
    }

    pub(super) fn request_code_actions(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        if request
            .generation_selection
            .as_ref()
            .is_some_and(|selection| !valid_generation_selection(selection))
        {
            return Err("Invalid Java code-action generation selection".to_string());
        }
        let mut response = semantic_request(
            self,
            request.clone(),
            SemanticKind::CodeActions,
            SIGNATURE_HELP_TIMEOUT,
        )?;
        if response.error.is_some() || response.cancelled || response.timeout {
            return Ok(response);
        }
        for action in [
            generated_constructor_action(self, &request)?,
            generated_hash_code_equals_action(self, &request)?,
            generated_override_methods_action(self, &request)?,
            generated_delegate_methods_action(self, &request)?,
        ]
        .into_iter()
        .flatten()
        {
            let Some(result) = response.result.as_mut() else {
                break;
            };
            let Some(actions) = result.get("actions").and_then(Value::as_array) else {
                break;
            };
            let action_title = action
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if actions
                .iter()
                .any(|existing| existing.get("title").and_then(Value::as_str) == Some(action_title))
            {
                result["actions"]
                    .as_array_mut()
                    .expect("the code-action array was validated")
                    .retain(|existing| {
                        existing.get("title").and_then(Value::as_str) != Some(action_title)
                    });
            }
            if result["actions"].as_array().map_or(0, Vec::len) >= MAX_CODE_ACTIONS {
                result["isTruncated"] = Value::Bool(true);
                continue;
            }
            result["actions"]
                .as_array_mut()
                .expect("the code-action array was validated")
                .push(action);
            if serde_json::to_vec(result)
                .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
            {
                result["actions"]
                    .as_array_mut()
                    .expect("the code-action array was validated")
                    .pop();
                result["isTruncated"] = Value::Bool(true);
            }
        }
        Ok(response)
    }

    pub(super) fn request_rename(
        &self,
        request: JavaSemanticRequest,
    ) -> Result<JavaSemanticNativeResponse, String> {
        semantic_request(self, request, SemanticKind::Rename, SIGNATURE_HELP_TIMEOUT)
    }

    pub(super) fn cancel_semantic_request(&self, cancellation_id: String) -> Result<(), String> {
        validate_semantic_id(&cancellation_id, "cancellation")?;
        let manager = self.manager()?;
        let Some(session) = &manager.session else {
            return Ok(());
        };
        cancel_by_cancellation_id(&session.pending_semantic, &session.writer, &cancellation_id);
        Ok(())
    }
}

impl Drop for JavaLanguageServiceState {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SyncAction {
    Open,
    Change,
    Save,
    Close,
    Validate,
}

fn saved_workspace_file_message(
    session_root: &Path,
    current_root: &Path,
    workspace_id: &str,
    generation: u64,
    document: &JavaLanguageWorkspaceFile,
) -> Result<Value, String> {
    if current_root != session_root
        || document.workspace_id != workspace_id
        || document.generation != generation
    {
        return Err("Workspace file notification does not match the current session".into());
    }
    let (_, uri) = authorize_workspace_path(current_root, &document.path)?;
    if document.uri != uri || !current_root.join(&document.path).is_file() {
        return Err("Saved workspace file does not match an authorized file URI".into());
    }
    Ok(
        json!({"jsonrpc":"2.0", "method":"workspace/didChangeWatchedFiles",
        "params":{"changes":[{"uri":uri,"type":2}]}}),
    )
}

fn sync_document(
    manager: &mut Manager,
    action: SyncAction,
    document: JavaLanguageDocument,
) -> Result<(), String> {
    let session = manager
        .session
        .as_mut()
        .ok_or_else(|| "Java language service has no active session".to_string())?;
    let lifecycle = lock(&session.runtime, "Java language service runtime")?
        .lifecycle
        .clone();
    if !matches!(lifecycle.as_str(), "initialized" | "ready" | "degraded") {
        return Err("Java language service is not ready for document synchronization".to_string());
    }
    let current_root = workspace_root()?
        .canonicalize()
        .map_err(|_| "Cannot authorize the current workspace".to_string())?;
    if current_root != session.workspace_root
        || workspace_id(&current_root) != session.workspace_id
        || document.workspace_id != session.workspace_id
        || document.generation != session.generation
    {
        return Err(
            "Document synchronization target does not match the current session".to_string(),
        );
    }
    if document.version < 0 {
        return Err("Document version must be non-negative".to_string());
    }

    let (path, uri) = authorize_java_path(&session.workspace_root, &document.path)?;
    if document.uri != uri {
        return Err("Document URI does not match the native authorized file URI".to_string());
    }
    let current = session.open_documents.get(&path);
    let (language_id, text, message) = match action {
        SyncAction::Open => {
            let language_id = require_java_language(&document)?;
            let text = require_document_text(&document)?;
            if let Some(current) = current {
                validate_open_document(current, &path, &uri)?;
                // A reloaded WebView can reopen the same snapshot while JDT LS is still running.
                // Keep the existing LSP document and refuse any conflicting snapshot.
                if current.version == document.version
                    && current.language_id == language_id
                    && current.text_hash == hash_text(&text)
                {
                    return Ok(());
                }
                return Err("Document is already open in the current session".to_string());
            }
            if session.open_documents.len() >= MAX_OPEN_DOCUMENTS {
                return Err("Open document limit exceeded".to_string());
            }
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{
                "uri":uri,"languageId":language_id,"version":document.version,"text":text
            }}});
            (language_id, text, message)
        }
        SyncAction::Change => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version <= current.version {
                return Err("Document change version must be strictly increasing".to_string());
            }
            let language_id = require_java_language(&document)?;
            if language_id != current.language_id {
                return Err("Document language cannot change while open".to_string());
            }
            let text = require_document_text(&document)?;
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didChange","params":{
                "textDocument":{"uri":uri,"version":document.version},"contentChanges":[{"text":text}]
            }});
            (language_id, text, message)
        }
        SyncAction::Save => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version != current.version {
                return Err("Document save version must equal the current open version".to_string());
            }
            let language_id = require_java_language(&document)?;
            if language_id != current.language_id {
                return Err("Document language cannot change while open".to_string());
            }
            let text = require_document_text(&document)?;
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didSave","params":{
                "textDocument":{"uri":uri},"text":text
            }});
            (language_id, text, message)
        }
        SyncAction::Validate => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version != current.version {
                return Err("Document validation requires the current open version".to_string());
            }
            let message = json!({"jsonrpc":"2.0","method":"java/validateDocument","params":{
                "textDocument":{"uri":uri}
            }});
            (current.language_id.clone(), String::new(), message)
        }
        SyncAction::Close => {
            let current = current.ok_or_else(|| "Document is not open".to_string())?;
            validate_open_document(current, &path, &uri)?;
            if document.version != current.version {
                return Err(
                    "Document close version must equal the current open version".to_string()
                );
            }
            let message = json!({"jsonrpc":"2.0","method":"textDocument/didClose","params":{
                "textDocument":{"uri":uri}
            }});
            (current.language_id.clone(), String::new(), message)
        }
    };

    if action == SyncAction::Validate
        && session.project_settings_supported
        && !check_document_compiler_support(session, &manager.events, &uri, document.version)?
    {
        return Ok(());
    }
    write_message_timeout(&session.writer, message, DOCUMENT_WRITE_TIMEOUT)?;
    if action == SyncAction::Validate {
        return Ok(());
    }
    if action == SyncAction::Close {
        lock(&session.runtime, "Java language service runtime")?
            .diagnostic_refusals
            .remove(&uri);
        session.open_documents.remove(&path);
        push_diagnostics_clear(
            &manager.events,
            session.generation,
            &session.workspace_id,
            &uri,
            document.version,
        );
    } else {
        session.open_documents.insert(
            path.clone(),
            OpenDocument {
                path,
                uri,
                language_id,
                version: document.version,
                text_hash: hash_text(&text),
                line_utf16_boundaries: line_utf16_boundaries(&text)?,
            },
        );
    }
    Ok(())
}

fn semantic_request(
    state: &JavaLanguageServiceState,
    request: JavaSemanticRequest,
    kind: SemanticKind,
    timeout: Duration,
) -> Result<JavaSemanticNativeResponse, String> {
    validate_semantic_id(&request.request_id, "request")?;
    validate_semantic_id(&request.cancellation_id, "cancellation")?;

    let (response_tx, response_rx) = mpsc::sync_channel(1);
    let (
        writer,
        pending,
        native_id,
        session_root,
        token_legend,
        token_document,
        open_documents,
        mut response,
    ) = {
        let manager = state.manager()?;
        let provider_version = manager
            .session
            .as_ref()
            .and_then(|session| session.jdtls.version.clone());
        let base = native_response(&request, provider_version);
        let Some(session) = &manager.session else {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "Java semantic provider has no active session",
                true,
            ));
        };
        if let Err(summary) = validate_semantic_request(session, &request) {
            return Ok(semantic_failure(base, "stale-version", &summary, false));
        }
        if kind == SemanticKind::SemanticTokens && session.semantic_token_legend.is_none() {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "Java semantic-token provider is unavailable",
                false,
            ));
        }
        if kind == SemanticKind::InlayHints
            && !lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.inlay_hints)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support Java inlay hints",
                false,
            ));
        }
        if kind == SemanticKind::Implementations
            && !lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.implementation)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support implementation queries",
                false,
            ));
        }
        if kind == SemanticKind::Definitions
            && !lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.definition)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support definition queries",
                false,
            ));
        }
        if kind == SemanticKind::TypeDefinitions
            && !lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.type_definition)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support type definition queries",
                false,
            ));
        }
        if kind == SemanticKind::References
            && !lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.references)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support reference queries",
                false,
            ));
        }
        if kind == SemanticKind::Rename
            && !lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.rename)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support semantic rename",
                false,
            ));
        }
        if matches!(
            kind,
            SemanticKind::Formatting | SemanticKind::RangeFormatting | SemanticKind::OnTypeFormatting
        ) {
            let capabilities = lock(&session.runtime, "Java language service runtime")?
                .capabilities
                .clone();
            let supported = capabilities
                .as_ref()
                .is_some_and(|capabilities| match kind {
                    SemanticKind::Formatting => capabilities.formatting,
                    SemanticKind::RangeFormatting => capabilities.range_formatting,
                    SemanticKind::OnTypeFormatting => request.formatting_character.as_ref()
                        .is_some_and(|character| capabilities.on_type_formatting_triggers.contains(character)),
                    _ => false,
                });
            if !supported {
                return Ok(semantic_failure(
                    base,
                    "unavailable",
                    if kind == SemanticKind::OnTypeFormatting {
                        "JDT LS does not support formatting for this typed character"
                    } else if kind == SemanticKind::Formatting {
                        "JDT LS does not support document formatting"
                    } else {
                        "JDT LS does not support range formatting"
                    },
                    false,
                ));
            }
        }
        let params = semantic_params(&request, kind)?;
        let native_id = session.next_request_id.fetch_add(1, Ordering::SeqCst);
        match reserve_pending_request(
            &session.pending_semantic,
            native_id,
            request.cancellation_id.clone(),
            response_tx,
        )? {
            Ok(()) => {}
            Err(PendingReservationError::Limit) => {
                return Ok(semantic_failure(
                    base,
                    "unavailable",
                    "Java semantic concurrent request limit exceeded",
                    true,
                ));
            }
            Err(PendingReservationError::DuplicateCancellationId) => {
                return Ok(semantic_failure(
                    base,
                    "unavailable",
                    "Java semantic cancellation ID is already active",
                    false,
                ));
            }
        }
        let message = json!({
            "jsonrpc":"2.0","id":native_id,"method":kind.method(),"params":params
        });
        if write_message(&session.writer, &message).is_err() {
            if let Ok(mut requests) = session.pending_semantic.lock() {
                requests.remove(&native_id);
            }
            return Ok(semantic_failure(
                base,
                "unavailable",
                "Java semantic request could not be sent",
                true,
            ));
        }
        (
            Arc::clone(&session.writer),
            Arc::clone(&session.pending_semantic),
            native_id,
            session.workspace_root.clone(),
            session.semantic_token_legend.clone(),
            session.open_documents.get(&request.document.path).cloned(),
            session.open_documents.clone(),
            base,
        )
    };

    let deadline = Instant::now() + timeout;
    let raw = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match response_rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(value) => break value,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {
                let workspace_changed = workspace_root()
                    .and_then(|root| {
                        root.canonicalize()
                            .map_err(|_| "Cannot authorize the current workspace".to_string())
                    })
                    .map_or(true, |root| root != session_root);
                if workspace_changed {
                    let removed = pending
                        .lock()
                        .ok()
                        .and_then(|mut requests| requests.remove(&native_id))
                        .is_some();
                    if removed {
                        send_cancel(&writer, native_id);
                    }
                    return Ok(semantic_failure(
                        response,
                        "cancelled",
                        "Java semantic request was cancelled after a workspace switch",
                        true,
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let removed = pending
                    .lock()
                    .ok()
                    .and_then(|mut requests| requests.remove(&native_id))
                    .is_some();
                if removed {
                    send_cancel(&writer, native_id);
                }
                return Ok(semantic_failure(
                    response,
                    "timeout",
                    "Java semantic request timed out",
                    true,
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Ok(semantic_failure(
                    response,
                    "unavailable",
                    "Java semantic session ended before responding",
                    true,
                ));
            }
        }
    };
    if raw.get("__cancelled").and_then(Value::as_bool) == Some(true) {
        return Ok(semantic_failure(
            response,
            "cancelled",
            "Java semantic request was cancelled",
            true,
        ));
    }
    if let Some(error) = raw.get("error") {
        let code = error.get("code").and_then(Value::as_i64);
        let cancelled = code == Some(-32800) || code == Some(-32802);
        let mut failed = semantic_failure(
            response,
            if cancelled {
                "cancelled"
            } else {
                "provider-error"
            },
            if cancelled {
                "Java semantic provider cancelled the request"
            } else {
                "Java semantic provider returned an error"
            },
            cancelled,
        );
        if let Some(code) = code {
            if let Some(error) = &mut failed.error {
                error.provider_code = Some(Value::from(code));
            }
        }
        return Ok(failed);
    }
    let Some(result) = raw.get("result") else {
        return Ok(semantic_failure(
            response,
            "malformed-result",
            "Java semantic provider returned no result",
            false,
        ));
    };
    match sanitize_semantic_result(
        kind,
        result,
        &request,
        &workspace_root()?,
        token_legend.as_ref(),
        token_document.as_ref(),
        &open_documents,
    ) {
        Some(result) => response.result = Some(result),
        None => {
            return Ok(semantic_failure(
                response,
                "malformed-result",
                "Java semantic provider returned an invalid or oversized result",
                false,
            ));
        }
    }
    Ok(response)
}

/// Request a bounded JDT LS extension operation for the currently synchronized document.
/// Extension results remain inside the native process and are normalized before reaching UI.
fn request_jdtls_extension(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
    method: &'static str,
    params: Value,
) -> Result<Option<Value>, String> {
    request_jdtls_extension_inner(state, request, method, params, false)
}

fn request_jdtls_extension_allow_null(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
    method: &'static str,
    params: Value,
) -> Result<Option<Value>, String> {
    request_jdtls_extension_inner(state, request, method, params, true)
}

fn request_jdtls_extension_inner(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
    method: &'static str,
    params: Value,
    allow_null_result: bool,
) -> Result<Option<Value>, String> {
    validate_semantic_id(&request.request_id, "request")?;
    validate_semantic_id(&request.cancellation_id, "cancellation")?;
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    let (writer, pending, native_id, session_root) = {
        let manager = state.manager()?;
        let Some(session) = &manager.session else {
            return Ok(None);
        };
        if validate_semantic_request(session, request).is_err() {
            return Ok(None);
        }
        let native_id = session.next_request_id.fetch_add(1, Ordering::SeqCst);
        match reserve_pending_request(
            &session.pending_semantic,
            native_id,
            request.cancellation_id.clone(),
            response_tx,
        )? {
            Ok(()) => {}
            Err(_) => return Ok(None),
        }
        if write_message(
            &session.writer,
            &json!({"jsonrpc":"2.0","id":native_id,"method":method,"params":params}),
        )
        .is_err()
        {
            if let Ok(mut requests) = session.pending_semantic.lock() {
                requests.remove(&native_id);
            }
            return Ok(None);
        }
        (
            Arc::clone(&session.writer),
            Arc::clone(&session.pending_semantic),
            native_id,
            session.workspace_root.clone(),
        )
    };

    let deadline = Instant::now() + SIGNATURE_HELP_TIMEOUT;
    let raw = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match response_rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(value) => break value,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {
                let workspace_changed = workspace_root()
                    .and_then(|root| {
                        root.canonicalize()
                            .map_err(|_| "Cannot authorize the current workspace".to_string())
                    })
                    .map_or(true, |root| root != session_root);
                if workspace_changed {
                    let removed = pending
                        .lock()
                        .ok()
                        .and_then(|mut requests| requests.remove(&native_id))
                        .is_some();
                    if removed {
                        send_cancel(&writer, native_id);
                    }
                    return Ok(None);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let removed = pending
                    .lock()
                    .ok()
                    .and_then(|mut requests| requests.remove(&native_id))
                    .is_some();
                if removed {
                    send_cancel(&writer, native_id);
                }
                return Ok(None);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(None),
        }
    };
    if raw.get("__cancelled").and_then(Value::as_bool) == Some(true) || raw.get("error").is_some() {
        return Ok(None);
    }
    let Some(result) = raw.get("result") else {
        return Ok(None);
    };
    if (result.is_null() && !allow_null_result)
        || serde_json::to_vec(result).map_or(true, |bytes| bytes.len() > 256 * 1024)
    {
        return Ok(None);
    }
    Ok(Some(result.clone()))
}

const MAX_PREPARED_CALL_HIERARCHY_ITEMS: usize = 4;

fn call_hierarchy_request(
    state: &JavaLanguageServiceState,
    request: JavaCallHierarchyRequest,
) -> Result<JavaSemanticNativeResponse, String> {
    let semantic = request.semantic_request();
    validate_semantic_id(&semantic.request_id, "request")?;
    validate_semantic_id(&semantic.cancellation_id, "cancellation")?;
    let (mut response, root) = {
        let manager = state.manager()?;
        let provider_version = manager
            .session
            .as_ref()
            .and_then(|session| session.jdtls.version.clone());
        let base = native_response(&semantic, provider_version);
        let Some(session) = &manager.session else {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "Java semantic provider has no active session",
                true,
            ));
        };
        if let Err(summary) = validate_semantic_request(session, &semantic) {
            return Ok(semantic_failure(base, "stale-version", &summary, false));
        }
        if !lock(&session.runtime, "Java language service runtime")?
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.call_hierarchy)
        {
            return Ok(semantic_failure(
                base,
                "unavailable",
                "JDT LS does not support call-hierarchy queries",
                false,
            ));
        }
        (base, session.workspace_root.clone())
    };

    let Some(raw_prepared) = request_jdtls_extension_allow_null(
        state,
        &semantic,
        "textDocument/prepareCallHierarchy",
        json!({
            "textDocument":{"uri":semantic.document.uri},
            "position":{"line":semantic.position.line,"character":semantic.position.character}
        }),
    )?
    else {
        return Ok(semantic_failure(
            response,
            "unavailable",
            "JDT LS call-hierarchy preparation failed or was cancelled",
            true,
        ));
    };
    let prepared = if raw_prepared.is_null() {
        &[][..]
    } else if let Some(items) = raw_prepared.as_array() {
        items.as_slice()
    } else {
        return Ok(semantic_failure(
            response,
            "malformed-result",
            "JDT LS returned an invalid call-hierarchy preparation",
            false,
        ));
    };

    let mut prepared_items = Vec::new();
    let mut truncated = prepared.len() > MAX_PREPARED_CALL_HIERARCHY_ITEMS;
    for item in prepared {
        if !call_hierarchy_item_is_workspace_source(item, &root) {
            truncated = true;
            continue;
        }
        if prepared_items.len() == MAX_PREPARED_CALL_HIERARCHY_ITEMS {
            truncated = true;
            break;
        }
        prepared_items.push(item.clone());
    }

    let method = if request.direction == JavaCallHierarchyDirection::Incoming {
        "callHierarchy/incomingCalls"
    } else {
        "callHierarchy/outgoingCalls"
    };
    let mut calls = Vec::with_capacity(prepared_items.len());
    for item in &prepared_items {
        let Some(result) =
            request_jdtls_extension_allow_null(state, &semantic, method, json!({"item":item}))?
        else {
            return Ok(semantic_failure(
                response,
                "unavailable",
                "JDT LS call-hierarchy query failed or was cancelled",
                true,
            ));
        };
        calls.push(result);
    }
    let Some(result) = sanitize_call_hierarchy(
        request.direction(),
        &prepared_items,
        &calls,
        truncated,
        &root,
    ) else {
        return Ok(semantic_failure(
            response,
            "malformed-result",
            "JDT LS returned invalid or oversized call-hierarchy results",
            false,
        ));
    };
    response.result = Some(result);
    Ok(response)
}

const MAX_GENERATOR_MEMBERS: usize = 64;
const MAX_DELEGATE_METHODS: usize = 128;
const MAX_GENERATOR_BINDING_KEY_BYTES: usize = 4_096;

fn valid_key_list_with_limit(keys: &[String], limit: usize) -> bool {
    keys.len() <= limit
        && keys.iter().enumerate().all(|(index, key)| {
            !key.is_empty()
                && key.len() <= MAX_GENERATOR_BINDING_KEY_BYTES
                && !key.chars().any(char::is_control)
                && keys[..index].iter().all(|previous| previous != key)
        })
}

fn valid_key_list(keys: &[String]) -> bool {
    valid_key_list_with_limit(keys, MAX_GENERATOR_MEMBERS)
}

fn valid_generation_selection(selection: &JavaCodeActionGenerationSelection) -> bool {
    let fields_valid = valid_key_list(&selection.selected_field_binding_keys);
    let constructors_valid = valid_key_list(&selection.selected_constructor_binding_keys);
    let methods_valid = valid_key_list(&selection.selected_overridable_method_keys);
    let delegate_methods_valid = valid_key_list_with_limit(
        &selection.selected_delegate_method_keys,
        MAX_DELEGATE_METHODS,
    );
    fields_valid
        && constructors_valid
        && methods_valid
        && delegate_methods_valid
        && match selection.kind {
            JavaCodeActionGenerationKind::Constructors => {
                !selection.selected_constructor_binding_keys.is_empty()
                    && selection.selected_overridable_method_keys.is_empty()
                    && selection.selected_delegate_method_keys.is_empty()
            }
            JavaCodeActionGenerationKind::HashCodeEquals => {
                !selection.selected_field_binding_keys.is_empty()
                    && selection.selected_constructor_binding_keys.is_empty()
                    && selection.selected_overridable_method_keys.is_empty()
                    && selection.selected_delegate_method_keys.is_empty()
            }
            JavaCodeActionGenerationKind::OverrideMethods => {
                !selection.selected_overridable_method_keys.is_empty()
                    && selection.selected_field_binding_keys.is_empty()
                    && selection.selected_constructor_binding_keys.is_empty()
                    && selection.selected_delegate_method_keys.is_empty()
            }
            JavaCodeActionGenerationKind::DelegateMethods => {
                !selection.selected_delegate_method_keys.is_empty()
                    && selection.selected_field_binding_keys.is_empty()
                    && selection.selected_constructor_binding_keys.is_empty()
                    && selection.selected_overridable_method_keys.is_empty()
            }
        }
}

fn binding_keys(items: &[Value]) -> Option<Vec<String>> {
    let mut keys = Vec::with_capacity(items.len());
    for item in items {
        let key = item.get("bindingKey")?.as_str()?;
        if key.is_empty()
            || key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
            || keys.iter().any(|existing| existing == key)
        {
            return None;
        }
        keys.push(key.to_string());
    }
    Some(keys)
}

fn member_selection_group(
    id: &str,
    label: &str,
    items: &[Value],
    selected_keys: &[String],
) -> Option<Value> {
    let members = items
        .iter()
        .map(|item| {
            let mut member = json!({
                "selectionKey": item.get("bindingKey")?.as_str()?,
                "name": item.get("name")?.as_str()?
            });
            if id == "fields" {
                if let Some(detail) = item
                    .get("type")
                    .or_else(|| item.get("typeName"))
                    .and_then(Value::as_str)
                    .filter(|detail| !detail.is_empty() && detail.len() <= 4_096)
                {
                    member["detail"] = Value::String(detail.to_string());
                }
            } else if id == "constructors" {
                if let Some(parameters) = item.get("parameters").and_then(Value::as_array) {
                    if parameters.len() <= MAX_GENERATOR_MEMBERS {
                        let signature = parameters
                            .iter()
                            .map(|parameter| {
                                parameter.as_str().map(str::to_string).or_else(|| {
                                    let parameter_type =
                                        parameter.get("type")?.as_str()?.to_string();
                                    let parameter_name = parameter
                                        .get("name")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default();
                                    Some(if parameter_name.is_empty() {
                                        parameter_type
                                    } else {
                                        format!("{parameter_type} {parameter_name}")
                                    })
                                })
                            })
                            .collect::<Option<Vec<_>>>();
                        if let Some(signature) = signature {
                            let detail =
                                format!("{}({})", item["name"].as_str()?, signature.join(", "));
                            if detail.len() <= 4_096 {
                                member["detail"] = Value::String(detail);
                            }
                        }
                    }
                }
            }
            Some(member)
        })
        .collect::<Option<Vec<_>>>()?;
    Some(json!({
        "id":id,
        "label":label,
        "members":members,
        "selectedKeys":selected_keys
    }))
}

fn overridable_method_key(method: &Value) -> Option<String> {
    let name = method.get("name")?.as_str()?;
    let declaring_class = method.get("declaringClass")?.as_str()?;
    let parameters = method.get("parameters")?.as_array()?;
    if name.is_empty()
        || name.len() > 512
        || declaring_class.is_empty()
        || declaring_class.len() > 2_048
        || name.chars().any(char::is_control)
        || declaring_class.chars().any(char::is_control)
        || parameters.len() > 64
        || parameters.iter().any(|parameter| {
            parameter.as_str().is_none_or(|parameter| {
                parameter.len() > 2_048 || parameter.chars().any(char::is_control)
            })
        })
    {
        return None;
    }
    let key = serde_json::to_string(&json!({
        "name":name,
        "declaringClass":declaring_class,
        "parameters":parameters
    }))
    .ok()?;
    (key.len() <= MAX_GENERATOR_BINDING_KEY_BYTES).then_some(key)
}

fn valid_overridable_methods(methods: &[Value]) -> Option<Vec<String>> {
    if methods.is_empty() || methods.len() > MAX_GENERATOR_MEMBERS {
        return None;
    }
    let keys = methods
        .iter()
        .map(overridable_method_key)
        .collect::<Option<Vec<_>>>()?;
    if keys
        .iter()
        .enumerate()
        .any(|(index, key)| keys[..index].iter().any(|previous| previous == key))
    {
        return None;
    }
    Some(keys)
}

fn validated_overridable_method_selection(
    methods: &[Value],
    selected_keys: &[String],
) -> Option<Vec<Value>> {
    let available_keys = valid_overridable_methods(methods)?;
    if selected_keys.is_empty()
        || selected_keys.len() > MAX_GENERATOR_MEMBERS
        || selected_keys.iter().enumerate().any(|(index, key)| {
            key.is_empty()
                || key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
                || !available_keys.iter().any(|available| available == key)
                || selected_keys[..index]
                    .iter()
                    .any(|previous| previous == key)
        })
    {
        return None;
    }
    selected_keys
        .iter()
        .map(|selected| {
            methods
                .iter()
                .find(|method| overridable_method_key(method).as_ref() == Some(selected))
                .cloned()
        })
        .collect()
}

fn generated_override_methods_action(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
) -> Result<Option<Value>, String> {
    if request
        .generation_selection
        .as_ref()
        .is_some_and(|selection| selection.kind != JavaCodeActionGenerationKind::OverrideMethods)
    {
        return Ok(None);
    }
    let context = semantic_params(request, SemanticKind::CodeActions)?;
    let Some(response) = request_jdtls_extension(
        state,
        request,
        "java/listOverridableMethods",
        context.clone(),
    )?
    else {
        return Ok(None);
    };
    let Some(methods) = response.get("methods").and_then(Value::as_array) else {
        return Ok(None);
    };
    let Some(available_keys) = valid_overridable_methods(methods) else {
        return Ok(None);
    };
    let title = "Generate Override/Implement Methods";
    let Some(selection) = request.generation_selection.as_ref() else {
        let members = methods
            .iter()
            .zip(&available_keys)
            .map(|(method, key)| {
                let name = method.get("name")?.as_str()?;
                let declaring_class = method.get("declaringClass")?.as_str()?;
                let parameters = method.get("parameters")?.as_array()?;
                let parameters = parameters
                    .iter()
                    .map(|parameter| parameter.as_str().map(str::to_string))
                    .collect::<Option<Vec<_>>>()?;
                let detail = format!("{}({}) — {}", name, parameters.join(", "), declaring_class);
                (detail.len() <= 4_096).then(|| {
                    json!({
                        "selectionKey":key,
                        "name":name,
                        "detail":detail
                    })
                })
            })
            .collect::<Option<Vec<_>>>();
        let Some(members) = members else {
            return Ok(None);
        };
        return Ok(Some(json!({
            "title":title,
            "kind":"quickassist",
            "edits":[],
            "memberSelection":{
                "kind":"overrideMethods",
                "groups":[{
                    "id":"overridableMethods",
                    "label":"Methods to override or implement",
                    "members":members,
                    "selectedKeys":[]
                }]
            }
        })));
    };
    let Some(selected_methods) = validated_overridable_method_selection(
        methods,
        &selection.selected_overridable_method_keys,
    ) else {
        return Ok(None);
    };
    let Some(edit) = request_jdtls_extension(
        state,
        request,
        "java/addOverridableMethods",
        json!({"context":context,"overridableMethods":selected_methods}),
    )?
    else {
        return Ok(None);
    };
    Ok(sanitize_code_action(
        &json!({"title":title,"kind":"quickassist","edit":edit}),
        request,
    ))
}

fn delegate_method_key(field: &Value, method: &Value) -> Option<String> {
    let field_key = field.get("bindingKey")?.as_str()?;
    let method_key = method.get("bindingKey")?.as_str()?;
    if field_key.is_empty()
        || field_key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
        || method_key.is_empty()
        || method_key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
    {
        return None;
    }
    let key = serde_json::to_string(&json!({
        "fieldBindingKey":field_key,
        "methodBindingKey":method_key
    }))
    .ok()?;
    (key.len() <= MAX_GENERATOR_BINDING_KEY_BYTES).then_some(key)
}

fn valid_delegate_fields(delegate_fields: &[Value]) -> Option<Vec<(String, usize, usize)>> {
    if delegate_fields.is_empty() || delegate_fields.len() > MAX_DELEGATE_METHODS {
        return None;
    }
    let mut keys = Vec::new();
    let mut locations = Vec::new();
    for (field_index, entry) in delegate_fields.iter().enumerate() {
        let field = entry.get("field")?;
        let field_key = field.get("bindingKey")?.as_str()?;
        let field_name = field.get("name")?.as_str()?;
        let field_type = field.get("type")?.as_str()?;
        let methods = entry.get("delegateMethods")?.as_array()?;
        if field_key.is_empty()
            || field_key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
            || field_name.is_empty()
            || field_name.len() > 512
            || field_type.is_empty()
            || field_type.len() > 2_048
            || field_name.chars().any(char::is_control)
            || field_type.chars().any(char::is_control)
            || methods.len() > MAX_DELEGATE_METHODS
        {
            return None;
        }
        for (method_index, method) in methods.iter().enumerate() {
            let name = method.get("name")?.as_str()?;
            let parameters = method.get("parameters")?.as_array()?;
            if name.is_empty()
                || name.len() > 512
                || name.chars().any(char::is_control)
                || parameters.len() > 64
                || parameters.iter().any(|parameter| {
                    parameter.as_str().is_none_or(|parameter| {
                        parameter.len() > 2_048 || parameter.chars().any(char::is_control)
                    })
                })
            {
                return None;
            }
            let key = delegate_method_key(field, method)?;
            if keys.iter().any(|available| available == &key) {
                return None;
            }
            keys.push(key.clone());
            locations.push((key, field_index, method_index));
            if keys.len() > MAX_DELEGATE_METHODS {
                return None;
            }
        }
    }
    (!keys.is_empty()).then_some(locations)
}

fn generated_delegate_methods_action(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
) -> Result<Option<Value>, String> {
    if request
        .generation_selection
        .as_ref()
        .is_some_and(|selection| selection.kind != JavaCodeActionGenerationKind::DelegateMethods)
    {
        return Ok(None);
    }
    let context = semantic_params(request, SemanticKind::CodeActions)?;
    let Some(status) = request_jdtls_extension(
        state,
        request,
        "java/checkDelegateMethodsStatus",
        context.clone(),
    )?
    else {
        return Ok(None);
    };
    let Some(delegate_fields) = status.get("delegateFields").and_then(Value::as_array) else {
        return Ok(None);
    };
    let Some(locations) = valid_delegate_fields(delegate_fields) else {
        return Ok(None);
    };
    let title = "Generate Delegate Methods";
    let Some(selection) = request.generation_selection.as_ref() else {
        let mut members = Vec::with_capacity(locations.len());
        for (key, field_index, method_index) in locations {
            let entry = &delegate_fields[field_index];
            let field = entry.get("field").expect("validated field");
            let method = entry
                .get("delegateMethods")
                .and_then(Value::as_array)
                .and_then(|methods| methods.get(method_index))
                .expect("validated delegate method");
            let field_name = field
                .get("name")
                .and_then(Value::as_str)
                .expect("validated name");
            let field_type = field
                .get("type")
                .and_then(Value::as_str)
                .expect("validated type");
            let name = method
                .get("name")
                .and_then(Value::as_str)
                .expect("validated name");
            let parameters = method
                .get("parameters")
                .and_then(Value::as_array)
                .expect("validated parameters")
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>();
            let detail = format!(
                "{field_type} {field_name} → {name}({})",
                parameters.join(", ")
            );
            if detail.len() > 4_096 {
                return Ok(None);
            }
            members.push(
                json!({"selectionKey":key,"name":format!("{field_name}.{name}"),"detail":detail}),
            );
        }
        return Ok(Some(json!({
            "title":title,
            "kind":"quickassist",
            "edits":[],
            "memberSelection":{
                "kind":"delegateMethods",
                "groups":[{
                    "id":"delegateMethods",
                    "label":"Methods to delegate",
                    "members":members,
                    "selectedKeys":[]
                }]
            }
        })));
    };
    let available_keys = locations
        .iter()
        .map(|(key, _, _)| key.clone())
        .collect::<Vec<_>>();
    let selected_keys = &selection.selected_delegate_method_keys;
    if selected_keys.is_empty()
        || selected_keys.len() > MAX_DELEGATE_METHODS
        || selected_keys.iter().enumerate().any(|(index, key)| {
            key.is_empty()
                || key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
                || !available_keys.iter().any(|available| available == key)
                || selected_keys[..index]
                    .iter()
                    .any(|previous| previous == key)
        })
    {
        return Ok(None);
    }
    let mut delegate_entries = Vec::with_capacity(selected_keys.len());
    for key in selected_keys {
        let Some((_, field_index, method_index)) = locations
            .iter()
            .find(|(available_key, _, _)| available_key == key)
        else {
            return Ok(None);
        };
        let entry = &delegate_fields[*field_index];
        let mut field = entry.get("field").expect("validated field").clone();
        field["isSelected"] = Value::Bool(true);
        let method = entry
            .get("delegateMethods")
            .and_then(Value::as_array)
            .and_then(|methods| methods.get(*method_index))
            .expect("validated delegate method");
        delegate_entries.push(json!({"field":field,"delegateMethod":method}));
    }
    let Some(edit) = request_jdtls_extension(
        state,
        request,
        "java/generateDelegateMethods",
        json!({"context":context,"delegateEntries":delegate_entries}),
    )?
    else {
        return Ok(None);
    };
    Ok(sanitize_code_action(
        &json!({"title":title,"kind":"quickassist","edit":edit}),
        request,
    ))
}

fn validated_selection_keys(items: &[Value], selected: &[String]) -> Option<Vec<String>> {
    let available = binding_keys(items)?;
    if selected.len() > MAX_GENERATOR_MEMBERS
        || selected.iter().any(|key| {
            key.is_empty()
                || key.len() > MAX_GENERATOR_BINDING_KEY_BYTES
                || !available.iter().any(|candidate| candidate == key)
        })
        || selected
            .iter()
            .enumerate()
            .any(|(index, key)| selected[..index].iter().any(|previous| previous == key))
    {
        return None;
    }
    Some(selected.to_vec())
}

fn selected_generator_fields(fields: &[Value], selected: &[String]) -> Option<Vec<Value>> {
    let mut result = Vec::with_capacity(selected.len());
    for field in fields {
        let binding_key = field.get("bindingKey")?.as_str()?;
        if selected.iter().any(|key| key == binding_key) {
            let mut field = field.clone();
            field
                .as_object_mut()?
                .insert("isSelected".to_string(), Value::Bool(true));
            result.push(field);
        }
    }
    (result.len() == selected.len()).then_some(result)
}

fn generated_constructor_action(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
) -> Result<Option<Value>, String> {
    if request
        .generation_selection
        .as_ref()
        .is_some_and(|selection| selection.kind != JavaCodeActionGenerationKind::Constructors)
    {
        return Ok(None);
    }
    let context = semantic_params(request, SemanticKind::CodeActions)?;
    let Some(status) = request_jdtls_extension(
        state,
        request,
        "java/checkConstructorsStatus",
        context.clone(),
    )?
    else {
        return Ok(None);
    };
    let Some(constructors) = status.get("constructors").and_then(Value::as_array) else {
        return Ok(None);
    };
    let Some(fields) = status.get("fields").and_then(Value::as_array) else {
        return Ok(None);
    };
    if constructors.is_empty() || constructors.len() > 64 || fields.len() > 64 {
        return Ok(None);
    }
    if constructors.iter().any(|item| {
        item.get("bindingKey")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
            || item
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
    }) || fields.iter().any(|item| {
        item.get("bindingKey")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
            || item
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
    }) {
        return Ok(None);
    }
    let Some(selection) = request.generation_selection.as_ref() else {
        let Some(field_keys) = binding_keys(fields) else {
            return Ok(None);
        };
        let Some(constructor_keys) = binding_keys(constructors) else {
            return Ok(None);
        };
        let Some(field_group) =
            member_selection_group("fields", "Fields to initialize", fields, &field_keys)
        else {
            return Ok(None);
        };
        let Some(constructor_group) = member_selection_group(
            "constructors",
            "Super constructors",
            constructors,
            &constructor_keys,
        ) else {
            return Ok(None);
        };
        return Ok(Some(json!({
            "title":"Generate constructors",
            "kind":"quickassist",
            "edits":[],
            "memberSelection":{
                "kind":"constructors",
                "groups":[field_group, constructor_group]
            }
        })));
    };
    let Some(selected_field_keys) =
        validated_selection_keys(fields, &selection.selected_field_binding_keys)
    else {
        return Ok(None);
    };
    let Some(selected_constructor_keys) =
        validated_selection_keys(constructors, &selection.selected_constructor_binding_keys)
    else {
        return Ok(None);
    };
    if selected_constructor_keys.is_empty() {
        return Ok(None);
    }
    let selected_constructors = constructors
        .iter()
        .filter(|item| {
            item.get("bindingKey")
                .and_then(Value::as_str)
                .is_some_and(|key| {
                    selected_constructor_keys
                        .iter()
                        .any(|selected| selected == key)
                })
        })
        .cloned()
        .collect::<Vec<_>>();
    let Some(selected_fields) = selected_generator_fields(fields, &selected_field_keys) else {
        return Ok(None);
    };
    let params = json!({
        "context":context,
        "constructors":selected_constructors,
        "fields":selected_fields
    });
    let Some(edit) = request_jdtls_extension(state, request, "java/generateConstructors", params)?
    else {
        return Ok(None);
    };
    Ok(sanitize_code_action(
        &json!({"title":"Generate constructors","kind":"quickassist","edit":edit}),
        request,
    ))
}

fn generated_hash_code_equals_action(
    state: &JavaLanguageServiceState,
    request: &JavaSemanticRequest,
) -> Result<Option<Value>, String> {
    if request
        .generation_selection
        .as_ref()
        .is_some_and(|selection| selection.kind != JavaCodeActionGenerationKind::HashCodeEquals)
    {
        return Ok(None);
    }
    let context = semantic_params(request, SemanticKind::CodeActions)?;
    let Some(status) = request_jdtls_extension(
        state,
        request,
        "java/checkHashCodeEqualsStatus",
        context.clone(),
    )?
    else {
        return Ok(None);
    };
    let Some(fields) = status.get("fields").and_then(Value::as_array) else {
        return Ok(None);
    };
    if fields.is_empty()
        || fields.len() > 64
        || status.get("type").and_then(Value::as_str).is_none()
    {
        return Ok(None);
    }
    if fields.iter().any(|item| {
        item.get("bindingKey")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
            || item
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
    }) {
        return Ok(None);
    }
    let Some(selection) = request.generation_selection.as_ref() else {
        let Some(field_keys) = binding_keys(fields) else {
            return Ok(None);
        };
        let Some(field_group) = member_selection_group(
            "fields",
            "Fields used by hashCode() and equals()",
            fields,
            &field_keys,
        ) else {
            return Ok(None);
        };
        return Ok(Some(json!({
            "title":"Generate hashCode() and equals()",
            "kind":"quickassist",
            "edits":[],
            "memberSelection":{
                "kind":"hashCodeEquals",
                "groups":[field_group]
            }
        })));
    };
    if !selection.selected_constructor_binding_keys.is_empty() {
        return Ok(None);
    }
    let Some(selected_field_keys) =
        validated_selection_keys(fields, &selection.selected_field_binding_keys)
    else {
        return Ok(None);
    };
    if selected_field_keys.is_empty() {
        return Ok(None);
    }
    let Some(selected_fields_array) = selected_generator_fields(fields, &selected_field_keys)
    else {
        return Ok(None);
    };
    let params = json!({"context":context,"fields":selected_fields_array,"regenerate":false});
    let Some(edit) =
        request_jdtls_extension(state, request, "java/generateHashCodeEquals", params)?
    else {
        return Ok(None);
    };
    Ok(sanitize_code_action(
        &json!({
            "title":"Generate hashCode() and equals()",
            "kind":"quickassist",
            "edit":edit
        }),
        request,
    ))
}

fn workspace_symbols_request(
    state: &JavaLanguageServiceState,
    request: JavaWorkspaceSymbolsRequest,
) -> Result<JavaWorkspaceSymbolsNativeResponse, String> {
    validate_semantic_id(&request.request_id, "request")?;
    validate_semantic_id(&request.cancellation_id, "cancellation")?;
    let query = validate_workspace_symbol_query(&request.query)?;
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    let (writer, pending, native_id, session_root, mut response) = {
        let manager = state.manager()?;
        let provider_version = manager
            .session
            .as_ref()
            .and_then(|session| session.jdtls.version.clone());
        let base = workspace_symbols_response(&request, provider_version);
        let Some(session) = &manager.session else {
            return Ok(workspace_symbols_failure(
                base,
                "unavailable",
                "Java workspace-symbol provider has no active session",
                true,
            ));
        };
        let lifecycle = lock(&session.runtime, "Java language service runtime")?;
        if !matches!(
            lifecycle.lifecycle.as_str(),
            "initialized" | "ready" | "degraded"
        ) {
            return Ok(workspace_symbols_failure(
                base,
                "unavailable",
                "Java language service is not ready for workspace-symbol search",
                true,
            ));
        }
        if !lifecycle
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.workspace_symbols)
        {
            return Ok(workspace_symbols_failure(
                base,
                "unavailable",
                "JDT LS does not support workspace-symbol search",
                false,
            ));
        }
        drop(lifecycle);
        let current_root = workspace_root()?
            .canonicalize()
            .map_err(|_| "Cannot authorize the current workspace".to_string())?;
        if current_root != session.workspace_root
            || workspace_id(&current_root) != session.workspace_id
            || request.workspace_id != session.workspace_id
            || request.generation != session.generation
        {
            return Ok(workspace_symbols_failure(
                base,
                "stale-version",
                "Java workspace-symbol request does not match the current session",
                false,
            ));
        }
        let native_id = session.next_request_id.fetch_add(1, Ordering::SeqCst);
        match reserve_pending_request(
            &session.pending_semantic,
            native_id,
            request.cancellation_id.clone(),
            response_tx,
        )? {
            Ok(()) => {}
            Err(PendingReservationError::Limit) => {
                return Ok(workspace_symbols_failure(
                    base,
                    "unavailable",
                    "Java semantic concurrent request limit exceeded",
                    true,
                ));
            }
            Err(PendingReservationError::DuplicateCancellationId) => {
                return Ok(workspace_symbols_failure(
                    base,
                    "unavailable",
                    "Java semantic cancellation ID is already active",
                    false,
                ));
            }
        }
        if write_message(
            &session.writer,
            &json!({
                "jsonrpc":"2.0","id":native_id,"method":"workspace/symbol",
                "params":{"query":query}
            }),
        )
        .is_err()
        {
            if let Ok(mut requests) = session.pending_semantic.lock() {
                requests.remove(&native_id);
            }
            return Ok(workspace_symbols_failure(
                base,
                "unavailable",
                "Java workspace-symbol request could not be sent",
                true,
            ));
        }
        (
            Arc::clone(&session.writer),
            Arc::clone(&session.pending_semantic),
            native_id,
            session.workspace_root.clone(),
            base,
        )
    };

    let deadline = Instant::now() + WORKSPACE_SYMBOLS_TIMEOUT;
    let raw = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match response_rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(value) => break value,
            Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() < deadline => {
                let workspace_changed = workspace_root()
                    .and_then(|root| {
                        root.canonicalize()
                            .map_err(|_| "Cannot authorize the current workspace".to_string())
                    })
                    .map_or(true, |root| root != session_root);
                if workspace_changed {
                    let removed = pending
                        .lock()
                        .ok()
                        .and_then(|mut requests| requests.remove(&native_id))
                        .is_some();
                    if removed {
                        send_cancel(&writer, native_id);
                    }
                    return Ok(workspace_symbols_failure(
                        response,
                        "cancelled",
                        "Java workspace-symbol request was cancelled after a workspace switch",
                        true,
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let removed = pending
                    .lock()
                    .ok()
                    .and_then(|mut requests| requests.remove(&native_id))
                    .is_some();
                if removed {
                    send_cancel(&writer, native_id);
                }
                return Ok(workspace_symbols_failure(
                    response,
                    "timeout",
                    "Java workspace-symbol request timed out",
                    true,
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Ok(workspace_symbols_failure(
                    response,
                    "unavailable",
                    "Java language session ended before workspace-symbol search completed",
                    true,
                ));
            }
        }
    };
    if raw.get("__cancelled").and_then(Value::as_bool) == Some(true) {
        return Ok(workspace_symbols_failure(
            response,
            "cancelled",
            "Java workspace-symbol request was cancelled",
            true,
        ));
    }
    if let Some(error) = raw.get("error") {
        let code = error.get("code").and_then(Value::as_i64);
        let cancelled = code == Some(-32800) || code == Some(-32802);
        let mut failed = workspace_symbols_failure(
            response,
            if cancelled {
                "cancelled"
            } else {
                "provider-error"
            },
            if cancelled {
                "Java workspace-symbol provider cancelled the request"
            } else {
                "Java workspace-symbol provider returned an error"
            },
            cancelled,
        );
        if let Some(code) = code {
            if let Some(error) = &mut failed.error {
                error.provider_code = Some(Value::from(code));
            }
        }
        return Ok(failed);
    }
    let Some(result) = raw.get("result") else {
        return Ok(workspace_symbols_failure(
            response,
            "malformed-result",
            "Java workspace-symbol provider returned no result",
            false,
        ));
    };
    match sanitize_workspace_symbols(result, &session_root) {
        Some(result) => response.result = Some(result),
        None => {
            return Ok(workspace_symbols_failure(
                response,
                "malformed-result",
                "Java workspace-symbol provider returned an invalid or oversized result",
                false,
            ));
        }
    }
    Ok(response)
}

fn validate_semantic_request(
    session: &Session,
    request: &JavaSemanticRequest,
) -> Result<(), String> {
    let lifecycle = lock(&session.runtime, "Java language service runtime")?
        .lifecycle
        .clone();
    if !matches!(lifecycle.as_str(), "initialized" | "ready" | "degraded") {
        return Err("Java semantic session is not ready".to_string());
    }
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "Cannot authorize the current workspace".to_string())?;
    if root != session.workspace_root
        || workspace_id(&root) != session.workspace_id
        || request.workspace_id != session.workspace_id
        || request.generation != session.generation
    {
        return Err("Java semantic request does not match the current session".to_string());
    }
    let (path, uri) = authorize_java_path(&session.workspace_root, &request.document.path)?;
    if path != request.document.path || uri != request.document.uri {
        return Err("Java semantic document path or URI is stale".to_string());
    }
    let document = session
        .open_documents
        .get(&path)
        .ok_or_else(|| "Java semantic document is not open".to_string())?;
    validate_semantic_open_document(document, &path, &uri, request)
}

fn write_message_timeout(
    writer: &Arc<Mutex<ChildStdin>>,
    value: Value,
    timeout: Duration,
) -> Result<(), String> {
    let writer = Arc::clone(writer);
    let (tx, rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = tx.send(write_message(&writer, &value));
    });
    rx.recv_timeout(timeout)
        .map_err(|_| "Timed out writing an LSP notification".to_string())?
}

fn push_diagnostics_clear(
    events: &Arc<Mutex<EventQueue>>,
    generation: u64,
    workspace_id: &str,
    uri: &str,
    version: i64,
) {
    push_event(
        events,
        generation,
        "diagnostics",
        json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","workspaceId":workspace_id,
            "generation":generation,"params":{"uri":uri,"version":version,"diagnostics":[]}}),
    );
}

fn status(manager: &Manager) -> Result<JavaLanguageServiceStatus, String> {
    if let Some(session) = &manager.session {
        let runtime = lock(&session.runtime, "Java language service runtime")?;
        return Ok(JavaLanguageServiceStatus {
            provider: "jdtls",
            available: true,
            lifecycle: runtime.lifecycle.clone(),
            generation: session.generation,
            workspace_id: Some(session.workspace_id.clone()),
            workspace_root: Some(session.workspace_root.to_string_lossy().into_owned()),
            jdtls_home: Some(session.jdtls.home.to_string_lossy().into_owned()),
            jdtls_version: session.jdtls.version.clone(),
            java_executable: Some(session.java.executable.to_string_lossy().into_owned()),
            java_version: Some(session.java.version.clone()),
            server_jdk_home: session.server_jdk_home.clone(),
            project_jdk_home: session
                .project_jdk
                .as_ref()
                .map(|jdk| jdk.requested_home.clone()),
            project_jdk_version: session.project_jdk.as_ref().map(|jdk| jdk.version.clone()),
            gradle_import_enabled: session.gradle_import_enabled,
            gradle_settings_configured: session.gradle_settings.is_some(),
            project_path: Some(session.project_path.clone()),
            maven_repository: (!session.maven_repository.is_empty())
                .then(|| session.maven_repository.clone()),
            active_maven_profiles: session.active_maven_profiles.clone(),
            inactive_maven_profiles: session.inactive_maven_profiles.clone(),
            java_formatter_profile: session.java_formatter_profile.clone(),
            capabilities: runtime.capabilities.clone(),
            detail: runtime.detail.clone(),
        });
    }

    let jdtls = discover_jdtls().ok();
    let java = discover_java().ok();
    let root = workspace_root().ok();
    let initialization_failure = manager
        .initialization_failure
        .as_ref()
        .filter(|(failed_root, _)| root.as_ref() == Some(failed_root));
    let detail = match (initialization_failure, &jdtls, &java) {
        (Some((_, detail)), _, _) => Some(detail.clone()),
        (_, None, _) => Some("Eclipse JDT LS is not installed or its layout is invalid".to_string()),
        (_, _, None) => Some("A full Java JDK could not be capability-probed".to_string()),
        _ => None,
    };
    Ok(JavaLanguageServiceStatus {
        provider: "jdtls",
        available: jdtls.is_some() && java.is_some(),
        lifecycle: if initialization_failure.is_some() {
            "failed"
        } else {
            "stopped"
        }
        .to_string(),
        generation: manager.generation,
        workspace_id: root.as_deref().map(workspace_id),
        workspace_root: root.map(|path| path.to_string_lossy().into_owned()),
        jdtls_home: jdtls
            .as_ref()
            .map(|install| install.home.to_string_lossy().into_owned()),
        jdtls_version: jdtls.as_ref().and_then(|install| install.version.clone()),
        java_executable: java
            .as_ref()
            .map(|install| install.executable.to_string_lossy().into_owned()),
        java_version: java.map(|install| install.version),
        server_jdk_home: None,
        project_jdk_home: None,
        project_jdk_version: None,
        gradle_import_enabled: false,
        gradle_settings_configured: false,
        project_path: None,
        maven_repository: None,
        active_maven_profiles: Vec::new(),
        inactive_maven_profiles: Vec::new(),
        java_formatter_profile: None,
        capabilities: None,
        detail,
    })
}

fn validate_session_request(
    manager: &Manager,
    request: Option<&JavaLanguageSessionRequest>,
    require_current_workspace: bool,
) -> Result<(), String> {
    let Some(request) = request else {
        return Ok(());
    };
    if !require_current_workspace
        && manager
            .session
            .as_ref()
            .is_some_and(|session| session.workspace_id != request.workspace_id)
    {
        return Err("Java language Stop belongs to another workspace".to_string());
    }
    if (require_current_workspace || manager.session.is_none())
        && workspace_id(&workspace_root()?) != request.workspace_id
    {
        return Err("Java language session belongs to a stale workspace".to_string());
    }
    if let Some(expected) = request.generation {
        let generation = manager
            .session
            .as_ref()
            .map_or(manager.generation, |session| session.generation);
        if expected != generation
            || manager
                .session
                .as_ref()
                .is_some_and(|session| session.workspace_id != request.workspace_id)
        {
            return Err("Java language session generation is stale".to_string());
        }
    }
    if let Some(project_path) = request.project_path.as_deref() {
        resolve_maven_project_root(&workspace_root()?, project_path)?;
    }
    validate_server_jdk_home(request.server_jdk_home.as_deref())?;
    if let Some(profile) = request.java_formatter_profile.as_ref() {
        validate_java_formatter_profile(&workspace_root()?, Some(profile))?;
    }
    Ok(())
}

fn validate_server_jdk_home(home: Option<&str>) -> Result<(), String> {
    let Some(home) = home else {
        return Ok(());
    };
    if home.is_empty()
        || home.len() > 4_096
        || home.trim() != home
        || home.chars().any(char::is_control)
        || !Path::new(home).is_absolute()
    {
        return Err(
            "Invalid JDT LS runtime JDK home; expected a trimmed absolute path".to_string(),
        );
    }
    Ok(())
}

fn verify_started_workspace(
    manager: &mut Manager,
    request: Option<&JavaLanguageSessionRequest>,
) -> Result<(), String> {
    let current = workspace_root().is_ok_and(|root| {
        manager.session.as_ref().is_some_and(|session| {
            session.workspace_root == root
                && request.is_none_or(|request| session.workspace_id == request.workspace_id)
        })
    });
    if !current {
        stop_session(manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
        return Err("Workspace changed while starting Java language service".to_string());
    }
    Ok(())
}

fn validate_maven_profiles(profiles: &[String]) -> Result<(), String> {
    if profiles.len() > MAX_MAVEN_PROFILES
        || profiles.iter().any(|profile| {
            profile.is_empty()
                || profile.len() > MAX_MAVEN_PROFILE_ID_BYTES
                || profile.trim() != profile
                || profile.starts_with('!')
                || profile.contains(',')
                || profile.chars().any(char::is_control)
        })
    {
        return Err("Invalid Maven profile selection".to_string());
    }
    let mut unique = std::collections::HashSet::new();
    if profiles.iter().any(|profile| !unique.insert(profile)) {
        return Err("Duplicate Maven profile selection".to_string());
    }
    Ok(())
}

fn maven_profile_selection(active: &[String], inactive: &[String]) -> Result<String, String> {
    validate_maven_profiles(active)?;
    validate_maven_profiles(inactive)?;
    if active.iter().any(|profile| inactive.contains(profile)) {
        return Err("A Maven profile cannot be both active and inactive".to_string());
    }
    let mut selected = active.to_vec();
    selected.extend(inactive.iter().map(|profile| format!("!{profile}")));
    Ok(selected.join(","))
}

fn workspace_project_path(uri: &str, workspace_root: &PathBuf) -> Option<PathBuf> {
    if uri.len() > 4_096 {
        return None;
    }
    let parsed = Url::parse(uri).ok()?;
    if parsed.scheme() != "file"
        || parsed.host_str().is_some_and(|host| !host.is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let project_path = parsed.to_file_path().ok()?.canonicalize().ok()?;
    (project_path == *workspace_root || project_path.starts_with(workspace_root))
        .then_some(project_path)
}

fn resolve_maven_project_root(
    workspace_root: &PathBuf,
    project_path: &str,
) -> Result<(PathBuf, String), String> {
    if project_path.is_empty() {
        return Ok((workspace_root.clone(), String::new()));
    }
    if project_path.len() > 4_096 || project_path.chars().any(char::is_control) {
        return Err("Invalid selected Java project path".to_string());
    }
    let normalized = project_path.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || normalized.as_bytes().get(1) == Some(&b':')
    {
        return Err("Selected Java project path must be workspace-relative".to_string());
    }
    let selected = workspace_root
        .join(&normalized)
        .canonicalize()
        .map_err(|_| "Selected Java project path is unavailable".to_string())?;
    if !selected.is_dir() || !selected.starts_with(workspace_root) {
        return Err("Selected Java project path is outside the workspace".to_string());
    }
    let relative = selected
        .strip_prefix(workspace_root)
        .map_err(|_| "Selected Java project path is outside the workspace".to_string())?;
    let canonical_relative = relative.to_string_lossy().replace('\\', "/");
    Ok((selected, canonical_relative))
}

fn execute_jdtls_command(
    session: &Session,
    command: &str,
    arguments: Value,
    deadline: Instant,
) -> Result<Value, String> {
    let request_id = session.next_request_id.fetch_add(1, Ordering::Relaxed);
    let cancellation_id = format!("jdtls-command-{}-{request_id}", session.generation);
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    match reserve_pending_request(
        &session.pending_semantic,
        request_id,
        cancellation_id.clone(),
        response_tx,
    )? {
        Ok(()) => {}
        Err(_) => return Err("Too many Java language-service requests are pending".to_string()),
    }
    let request = json!({
        "jsonrpc":"2.0",
        "id":request_id,
        "method":"workspace/executeCommand",
        "params":{"command":command,"arguments":arguments}
    });
    if write_message_timeout(&session.writer, request, DOCUMENT_WRITE_TIMEOUT).is_err() {
        cancel_by_cancellation_id(&session.pending_semantic, &session.writer, &cancellation_id);
        return Err("Cannot send a Java language-service project settings request".to_string());
    }

    loop {
        if workspace_root()
            .ok()
            .and_then(|root| root.canonicalize().ok())
            .is_none_or(|root| root != session.workspace_root)
        {
            cancel_by_cancellation_id(&session.pending_semantic, &session.writer, &cancellation_id);
            return Err("Workspace changed while applying Maven profile settings".to_string());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            cancel_by_cancellation_id(&session.pending_semantic, &session.writer, &cancellation_id);
            return Err("Timed out applying Maven profile settings in JDT LS".to_string());
        }
        match response_rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(response) => {
                if response.get("error").is_some() {
                    return Err("JDT LS could not apply Maven profile settings".to_string());
                }
                return response.get("result").cloned().ok_or_else(|| {
                    "JDT LS returned an invalid project-settings response".to_string()
                });
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("JDT LS stopped while applying Maven profile settings".to_string());
            }
        }
    }
}

fn check_document_compiler_support(
    session: &mut Session,
    events: &Arc<Mutex<EventQueue>>,
    uri: &str,
    version: i64,
) -> Result<bool, String> {
    let refusal = (|| -> Result<Option<String>, String> {
        let settings = execute_jdtls_command(session, "java.project.getSettings",
            json!([uri, [JAVA_COMPILER_SOURCE_SETTING, JAVA_ENABLE_PREVIEW_SETTING]]),
            Instant::now() + Duration::from_secs(5))
            .map_err(|_| "JDT LS diagnostics are unavailable: the compiler settings could not be checked. Refresh the language service to retry.".to_string())?;
        let latest = match session.compiler_latest_source {
            Some(latest) => latest,
            None => {
                let latest = super::compiler_support::latest_source(&session.jdtls, &session.java)
                    .map_err(|_| "JDT LS diagnostics are unavailable: the selected JDT compiler's Java support could not be checked. Refresh the language service to retry.".to_string())?;
                session.compiler_latest_source = Some(latest);
                latest
            }
        };
        super::compiler_support::diagnostic_refusal(&settings, latest)
    })().unwrap_or_else(|message| Some(message));
    let mut runtime = lock(&session.runtime, "Java language service runtime")?;
    let previous = runtime.diagnostic_refusals.remove(uri);
    if let Some(reason) = &refusal {
        runtime
            .diagnostic_refusals
            .insert(uri.to_string(), reason.clone());
    }
    // Serialize this change with the dispatcher's refusal check. A subsequent
    // validation can restore diagnostics after provider settings change.
    if refusal.is_some() || previous.is_some() {
        push_event(
            events,
            session.generation,
            "diagnostics",
            json!({
                "jsonrpc":"2.0","method":"textDocument/publishDiagnostics",
                "workspaceId":session.workspace_id,"generation":session.generation,
                "params":{"uri":uri,"version":version,"diagnostics":[],"unavailableReason":refusal}
            }),
        );
    }
    Ok(refusal.is_none())
}

fn apply_maven_profiles(manager: &mut Manager, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let session = manager
        .session
        .as_ref()
        .ok_or_else(|| "Java language service has no active session".to_string())?;
    let selection = maven_profile_selection(
        &session.active_maven_profiles,
        &session.inactive_maven_profiles,
    )?;
    let workspace_root = session.maven_project_root.clone();
    let profiles_requested =
        !session.active_maven_profiles.is_empty() || !session.inactive_maven_profiles.is_empty();

    loop {
        let projects = execute_jdtls_command(session, "java.project.getAll", json!([]), deadline)?;
        let projects = projects
            .as_array()
            .filter(|projects| projects.len() <= MAX_JAVA_PROJECTS_FOR_MAVEN_PROFILES)
            .ok_or_else(|| "JDT LS returned an invalid Java project list".to_string())?;
        let mut maven_projects = Vec::new();
        for project in projects {
            let uri = project
                .as_str()
                .ok_or_else(|| "JDT LS returned an invalid Java project URI".to_string())?;
            if workspace_project_path(uri, &workspace_root).is_none() {
                continue;
            }
            let settings = execute_jdtls_command(
                session,
                "java.project.getSettings",
                json!([uri, [JAVA_NATURE_IDS_SETTING]]),
                deadline,
            )?;
            let nature_ids = settings
                .get(JAVA_NATURE_IDS_SETTING)
                .and_then(Value::as_array)
                .ok_or_else(|| "JDT LS returned invalid Java project natures".to_string())?;
            if nature_ids
                .iter()
                .any(|nature| nature.as_str() == Some(MAVEN_NATURE_ID))
            {
                maven_projects.push(uri.to_string());
            }
        }

        if !maven_projects.is_empty() {
            for uri in &maven_projects {
                let result = execute_jdtls_command(
                    session,
                    "java.project.updateSettings",
                    json!([uri, {(MAVEN_SELECTED_PROFILES_SETTING): selection}]),
                    deadline,
                )?;
                if result == Value::Bool(false) {
                    return Err("JDT LS refused the Maven profile selection".to_string());
                }
            }
            return Ok(());
        }

        if !profiles_requested {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("JDT LS found no Maven Java project for the selected profiles".to_string());
        }
        thread::sleep(
            Duration::from_millis(150).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn apply_gradle_import_settings(manager: &Manager, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let session = manager
        .session
        .as_ref()
        .ok_or_else(|| "Java language service has no active session".to_string())?;
    if !session.gradle_import_enabled {
        return Ok(());
    }
    let workspace_root = session.workspace_root.clone();

    loop {
        let projects = execute_jdtls_command(session, "java.project.getAll", json!([]), deadline)?;
        let projects = projects
            .as_array()
            .filter(|projects| projects.len() <= MAX_JAVA_PROJECTS_FOR_MAVEN_PROFILES)
            .ok_or_else(|| "JDT LS returned an invalid Java project list".to_string())?;
        let mut gradle_projects = Vec::new();
        for project in projects {
            let uri = project
                .as_str()
                .ok_or_else(|| "JDT LS returned an invalid Java project URI".to_string())?;
            if workspace_project_path(uri, &workspace_root).is_none() {
                continue;
            }
            let settings = execute_jdtls_command(
                session,
                "java.project.getSettings",
                json!([uri, [JAVA_NATURE_IDS_SETTING]]),
                deadline,
            )?;
            let nature_ids = settings
                .get(JAVA_NATURE_IDS_SETTING)
                .and_then(Value::as_array)
                .ok_or_else(|| "JDT LS returned invalid Java project natures".to_string())?;
            if nature_ids
                .iter()
                .any(|nature| nature.as_str() == Some(GRADLE_NATURE_ID))
            {
                gradle_projects.push(uri.to_string());
            }
        }

        if !gradle_projects.is_empty() {
            execute_jdtls_command(
                session,
                "java.project.changeImportedProjects",
                json!([[], gradle_projects, []]),
                deadline,
            )?;
            return Ok(());
        }
        if Instant::now() >= deadline {
            // Gradle support may be enabled in a workspace without an importable Gradle Java project.
            return Ok(());
        }
        thread::sleep(
            Duration::from_millis(150).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn restore_gradle_preview_settings(session: &mut Session) -> Result<(), String> {
    if session.gradle_preview_original_settings.is_empty() {
        session.gradle_preview_context_hash = None;
        return Ok(());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    for (uri, previous) in &session.gradle_preview_original_settings {
        let previous = previous
            .iter()
            .map(|(key, value)| (key.clone(), json!(value)))
            .collect::<serde_json::Map<_, _>>();
        let result = execute_jdtls_command(
            session,
            "java.project.updateSettings",
            json!([uri, previous]),
            deadline,
        )?;
        if result == Value::Bool(false) {
            return Err("JDT LS refused to restore its previous preview setting".to_string());
        }
    }
    session.gradle_preview_original_settings.clear();
    session.gradle_preview_context_hash = None;
    Ok(())
}

fn apply_gradle_preview_settings_to_session(
    session: &mut Session,
    context_hash: &str,
    module_roots: &[PathBuf],
    preview_release: u64,
) -> Result<bool, String> {
    if context_hash.len() != 64 || !context_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid verified Java project-context hash".to_string());
    }
    let selected_root = session
        .workspace_root
        .join(&session.project_path)
        .canonicalize()
        .map_err(|_| "The selected Java project directory is unavailable")?;
    let mut requested = HashSet::new();
    for root in module_roots {
        let canonical = root
            .canonicalize()
            .map_err(|_| "A verified Gradle module directory is unavailable")?;
        if !canonical.starts_with(&selected_root) || !requested.insert(canonical) {
            return Err(
                "The Gradle preview modules are outside or duplicated in the project".into(),
            );
        }
    }
    if requested.is_empty() {
        return Ok(false);
    }
    let latest = match session.compiler_latest_source {
        Some(latest) => latest,
        None => {
            let latest = super::compiler_support::latest_source(&session.jdtls, &session.java)?;
            session.compiler_latest_source = Some(latest);
            latest
        }
    };
    super::compiler_support::require_preview_release(latest, preview_release)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let projects = execute_jdtls_command(session, "java.project.getAll", json!([]), deadline)?;
    let projects = projects
        .as_array()
        .filter(|projects| projects.len() <= MAX_JAVA_PROJECTS_FOR_MAVEN_PROFILES)
        .ok_or("JDT LS returned an invalid Java project list")?;
    let mut matches = HashMap::<PathBuf, String>::new();
    for project in projects {
        let uri = project
            .as_str()
            .ok_or("JDT LS returned an invalid Java project URI")?;
        let Some(project_root) = workspace_project_path(uri, &session.workspace_root) else {
            continue;
        };
        if !requested.contains(&project_root) {
            continue;
        }
        let settings = execute_jdtls_command(
            session,
            "java.project.getSettings",
            json!([uri, [JAVA_NATURE_IDS_SETTING]]),
            deadline,
        )?;
        let nature_ids = settings
            .get(JAVA_NATURE_IDS_SETTING)
            .and_then(Value::as_array)
            .ok_or("JDT LS returned invalid Java project natures")?;
        if nature_ids
            .iter()
            .any(|nature| nature.as_str() == Some(GRADLE_NATURE_ID))
            && matches.insert(project_root, uri.to_string()).is_some()
        {
            return Err("JDT LS returned duplicate projects for one Gradle module".into());
        }
    }
    if matches.len() != requested.len() {
        return Err("JDT LS has not imported every verified Gradle preview module".into());
    }

    let mut changed = false;
    for uri in matches.values() {
        let settings = execute_jdtls_command(
            session,
            "java.project.getSettings",
            json!([uri, GRADLE_PREVIEW_COMPILER_SETTINGS]),
            deadline,
        )?;
        let mut previous = HashMap::new();
        for name in GRADLE_PREVIEW_COMPILER_SETTINGS {
            let value = settings
                .get(name)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 32)
                .ok_or("JDT LS did not report the current Gradle compiler settings")?;
            previous.insert(name.to_string(), value.to_string());
        }
        let desired = [
            (JAVA_COMPILER_SOURCE_SETTING, preview_release.to_string()),
            (
                JAVA_COMPILER_COMPLIANCE_SETTING,
                preview_release.to_string(),
            ),
            (JAVA_COMPILER_TARGET_SETTING, preview_release.to_string()),
            (JAVA_ENABLE_PREVIEW_SETTING, "enabled".to_string()),
        ];
        let mut changes = Vec::new();
        for (name, value) in &desired {
            if previous.get(*name) != Some(value) {
                changes.push((*name, value.clone()));
            }
        }
        if changes.is_empty() {
            continue;
        }
        session
            .gradle_preview_original_settings
            .entry(uri.clone())
            .or_insert(previous);
        let update_settings = changes
            .iter()
            .map(|(name, value)| ((*name).to_string(), json!(value)))
            .collect::<serde_json::Map<_, _>>();
        let update = execute_jdtls_command(
            session,
            "java.project.updateSettings",
            json!([uri, update_settings]),
            deadline,
        );
        match update {
            Ok(Value::Bool(false)) | Err(_) => {
                let rollback = restore_gradle_preview_settings(session);
                return Err(match rollback {
                    Ok(()) => "JDT LS could not apply the verified preview compiler setting".into(),
                    Err(_) => {
                        "JDT LS could not apply or restore the preview compiler setting".into()
                    }
                });
            }
            Ok(_) => {
                let updated = match execute_jdtls_command(
                    session,
                    "java.project.getSettings",
                    json!([uri, GRADLE_PREVIEW_COMPILER_SETTINGS]),
                    deadline,
                ) {
                    Ok(updated) => updated,
                    Err(error) => {
                        let rollback = restore_gradle_preview_settings(session);
                        return Err(match rollback {
                            Ok(()) => format!(
                                "JDT LS could not verify the applied Gradle compiler settings: {error}"
                            ),
                            Err(_) => {
                                "JDT LS could not verify or restore the Gradle compiler settings."
                                    .into()
                            }
                        });
                    }
                };
                if desired.iter().any(|(name, value)| {
                    updated.get(name).and_then(Value::as_str) != Some(value.as_str())
                }) {
                    let rollback = restore_gradle_preview_settings(session);
                    return Err(match rollback {
                        Ok(()) => {
                            "JDT LS did not retain the verified Gradle compiler settings.".into()
                        }
                        Err(_) => {
                            "JDT LS did not retain or restore the verified Gradle compiler settings.".into()
                        }
                    });
                }
                changed = true;
            }
        }
    }
    let affected_open_documents = session
        .open_documents
        .values()
        .filter_map(|document| {
            let path = path_from_file_uri(&document.uri)?;
            let path = path.canonicalize().ok()?;
            requested
                .iter()
                .any(|module_root| path.starts_with(module_root))
                .then(|| document.uri.clone())
        })
        .collect::<HashSet<_>>();
    for uri in affected_open_documents {
        let refreshed = execute_jdtls_command(
            session,
            "java.project.refreshDiagnostics",
            json!([uri, "thisFile", false, true]),
            deadline,
        );
        if refreshed.is_err() {
            let rollback = restore_gradle_preview_settings(session);
            return Err(match rollback {
                Ok(()) => {
                    "JDT LS could not refresh diagnostics after applying Gradle compiler settings."
                        .into()
                }
                Err(_) => {
                    "JDT LS could not refresh diagnostics or restore Gradle compiler settings."
                        .into()
                }
            });
        }
    }
    session.gradle_preview_context_hash = Some(context_hash.to_string());
    Ok(changed)
}

enum GradleImportLauncher {
    Installation(PathBuf),
    ProjectWrapper,
}

fn validate_gradle_language_settings(
    gradle: Option<&JavaLanguageGradleSettings>,
) -> Result<(), String> {
    let Some(gradle) = gradle else {
        return Ok(());
    };
    if gradle.executable.is_empty()
        || gradle.executable.len() > 4_096
        || gradle.executable.contains('\0')
        || !Path::new(&gradle.executable).is_absolute()
        || gradle.user_home.len() > 4_096
        || gradle.user_home.contains('\0')
        || (!gradle.user_home.is_empty() && !Path::new(&gradle.user_home).is_absolute())
        || gradle.gradle_runtime_home.as_deref().is_some_and(|home| {
            home.len() > 4_096
                || home.contains('\0')
                || (!home.is_empty() && !Path::new(home).is_absolute())
        })
        || gradle.project_properties.len() > 64
        || gradle.project_properties.iter().any(|(key, value)| {
            key.is_empty()
                || key.len() > 128
                || !key.as_bytes()[0].is_ascii_alphabetic()
                || !key.bytes().all(|character| {
                    character.is_ascii_alphanumeric() || b"_.-".contains(&character)
                })
                || value.len() > 1_024
                || value.contains('\0')
        })
    {
        return Err("Selected Gradle project settings are invalid".to_string());
    }
    Ok(())
}

fn resolve_gradle_import_launcher(
    import_enabled: bool,
    gradle: Option<&JavaLanguageGradleSettings>,
    workspace_root: &Path,
    selected_project_root: &Path,
) -> Result<Option<GradleImportLauncher>, String> {
    if !import_enabled {
        return Ok(None);
    }
    let Some(gradle) = gradle else {
        // With no selected executable, JDT LS retains its normal project-wrapper behavior;
        // the separate session authorization still protects that build-script execution.
        return Ok(None);
    };
    let selected = Path::new(&gradle.executable)
        .canonicalize()
        .map_err(|error| format!("Cannot resolve selected Gradle executable: {error}"))?;
    if !selected.is_file() {
        return Err("Selected Gradle executable is not a file".to_string());
    }
    let name = selected
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let parent = selected.parent();
    if matches!(name.as_str(), "gradle" | "gradle.bat")
        && parent
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("bin"))
    {
        let home = parent
            .and_then(Path::parent)
            .ok_or_else(|| "Selected Gradle installation has no home directory".to_string())?;
        if !home.is_dir() {
            return Err("Selected Gradle installation home is unavailable".to_string());
        }
        return Ok(Some(GradleImportLauncher::Installation(home.to_path_buf())));
    }

    if matches!(name.as_str(), "gradlew" | "gradlew.bat") && selected.starts_with(workspace_root) {
        for directory in selected_project_root.ancestors() {
            if !directory.starts_with(workspace_root) {
                break;
            }
            for wrapper_name in ["gradlew", "gradlew.bat"] {
                let candidate = directory.join(wrapper_name);
                if candidate
                    .canonicalize()
                    .is_ok_and(|candidate| candidate == selected)
                {
                    return Ok(Some(GradleImportLauncher::ProjectWrapper));
                }
            }
            if directory == workspace_root {
                break;
            }
        }
    }

    Err(format!(
        "JDT LS cannot use the selected Gradle executable '{}'. Select a Gradle installation under its bin directory or the selected project's wrapper.",
        gradle.executable
    ))
}

fn apply_gradle_language_settings(
    settings: &mut Value,
    project_jdk: Option<&ProjectJdk>,
    gradle: Option<&JavaLanguageGradleSettings>,
    launcher: Option<GradleImportLauncher>,
) {
    if let Some(runtime_home) = gradle
        .and_then(|settings| settings.gradle_runtime_home.as_deref())
        .filter(|home| !home.is_empty())
    {
        settings["java"]["import"]["gradle"]["java"]["home"] = json!(runtime_home);
    } else if let Some(jdk) = project_jdk {
        settings["java"]["import"]["gradle"]["java"]["home"] = json!(jdk.home);
    }
    let Some(gradle) = gradle else {
        return;
    };
    if !gradle.user_home.is_empty() {
        settings["java"]["import"]["gradle"]["user"]["home"] = json!(gradle.user_home);
    }
    let arguments: Vec<String> = gradle
        .project_properties
        .iter()
        .map(|(key, value)| format!("-P{key}={value}"))
        .collect();
    settings["java"]["import"]["gradle"]["arguments"] = json!(arguments);
    match launcher {
        Some(GradleImportLauncher::Installation(home)) => {
            settings["java"]["import"]["gradle"]["home"] = json!(home);
            settings["java"]["import"]["gradle"]["wrapper"]["enabled"] = json!(false);
        }
        Some(GradleImportLauncher::ProjectWrapper) => {
            settings["java"]["import"]["gradle"]["wrapper"]["enabled"] = json!(true);
        }
        None => {}
    }
}

fn apply_maven_language_settings(settings: &mut Value, user_settings: Option<&Path>) {
    if let Some(path) = user_settings {
        settings["java"]["configuration"]["maven"]["userSettings"] = json!(path.to_string_lossy());
    }
}

fn apply_java_formatter_language_settings(
    settings: &mut Value,
    profile_path: Option<&Path>,
    profile: Option<&JavaLanguageFormatterProfile>,
) -> Result<(), String> {
    if let (Some(path), Some(profile)) = (profile_path, profile) {
        let uri = Url::from_file_path(path)
            .map_err(|_| "Cannot create a file URI for the private Eclipse formatter profile")?;
        settings["java"]["format"]["settings"]["url"] = json!(uri.to_string());
        settings["java"]["format"]["settings"]["profile"] = json!(profile.profile_name);
    }
    Ok(())
}

fn start_session(
    manager: &mut Manager,
    timeout: Duration,
    project_jdk_home: Option<&str>,
    server_jdk_home: Option<&str>,
    gradle_import_enabled: bool,
    project_path: &str,
    maven_repository: &str,
    active_maven_profiles: &[String],
    inactive_maven_profiles: &[String],
    gradle_settings: Option<&JavaLanguageGradleSettings>,
    java_formatter_profile: Option<&JavaLanguageFormatterProfile>,
    generated_sources: &[GradleGeneratedSourceSet],
    force_gradle_import_refresh: bool,
) -> Result<(), String> {
    let startup = Arc::clone(&manager.startup);
    lock(&startup, "Java language service startup")?.admit()?;
    let root = workspace_root()?;
    let id = workspace_id(&root);
    let (maven_project_root, _) = resolve_maven_project_root(&root, project_path)?;
    let project_path = project_path.to_string();
    if !maven_repository.is_empty() {
        validate_maven_local_repository(maven_repository)?;
    }
    let maven_repository = maven_repository.to_string();
    let project_jdk = project_jdk_home.map(probe_project_jdk).transpose()?;
    validate_server_jdk_home(server_jdk_home)?;
    let jdtls = discover_jdtls()?;
    let java = discover_jdtls_java_with_home(&jdtls, server_jdk_home)?;
    maven_profile_selection(active_maven_profiles, inactive_maven_profiles)?;
    validate_gradle_language_settings(gradle_settings)?;
    validate_java_formatter_profile(&root, java_formatter_profile)?;
    let gradle_import_launcher = resolve_gradle_import_launcher(
        gradle_import_enabled,
        gradle_settings,
        &root,
        &maven_project_root,
    )?;
    let generated_source_script = gradle_import_enabled
        .then(|| gradle_generated_source_script(generated_sources)).flatten();
    let gradle_import_settings_changed = force_gradle_import_refresh
        || manager.session.as_ref().is_some_and(|session| {
            session.gradle_import_enabled != gradle_import_enabled
                || session.gradle_settings.as_ref() != gradle_settings
        });
    if let Some(session) = &manager.session {
        let running =
            lock(&session.runtime, "Java language service runtime")?.lifecycle == "initialized";
        if running
            && session.workspace_id == id
            && session.workspace_root == root
            && session
                .project_jdk
                .as_ref()
                .map(|jdk| (&jdk.requested_home, &jdk.home, &jdk.version))
                == project_jdk
                    .as_ref()
                    .map(|jdk| (&jdk.requested_home, &jdk.home, &jdk.version))
            && session.server_jdk_home.as_deref() == server_jdk_home
            && session.gradle_import_enabled == gradle_import_enabled
            && session.gradle_settings.as_ref() == gradle_settings
            && session.gradle_generated_source_script == generated_source_script
            && session.project_path == project_path
            && session.maven_repository == maven_repository
            && session.active_maven_profiles == active_maven_profiles
            && session.inactive_maven_profiles == inactive_maven_profiles
            && session.java_formatter_profile.as_ref() == java_formatter_profile
        {
            return Ok(());
        }
    }
    enforce_restart_limit(manager)?;
    if manager.session.is_some() {
        stop_session(manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT)?;
    }

    manager.initialization_failure = None;
    manager.generation = manager.generation.saturating_add(1);
    let generation = manager.generation;
    let data_dir = language_data_dir(
        ide_home_dir()?
            .join("language-services")
            .join("java")
            .join(&id),
        project_jdk.as_ref(),
    );
    let data_dir = generated_source_script.as_ref().map_or(data_dir.clone(), |script| {
        gradle_generated_source_data_directory(&data_dir, script)
    });
    fs::create_dir_all(&data_dir).map_err(|error| {
        format!(
            "Cannot create Java language service data directory '{}': {error}",
            data_dir.display()
        )
    })?;

    let maven_user_settings = if maven_repository.is_empty() {
        None
    } else {
        Some(prepare_maven_user_settings(&data_dir, &maven_repository)?)
    };
    let private_formatter_profile = java_formatter_profile
        .map(|profile| prepare_java_formatter_profile(&data_dir, &root, profile))
        .transpose()?;
    let generated_source_import = generated_source_script.as_ref()
        .map(|script| prepare_gradle_generated_source_import(&data_dir, script))
        .transpose()?;
    let configuration = prepare_jdtls_configuration(&jdtls, &data_dir)?;
    let args = launch_args(&jdtls, &data_dir, &configuration);
    let mut command = Command::new(&java.executable);
    command
        .args(&args)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    copy_safe_environment(&mut command);

    let mut starting = lock(&startup, "Java language service startup")?;
    starting.admit()?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot launch Eclipse JDT LS: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "JDT LS stdin was not piped".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "JDT LS stdout was not piped".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "JDT LS stderr was not piped".to_string())?;
    let child = Arc::new(Mutex::new(child));
    starting.child = Some(Arc::clone(&child));
    drop(starting);
    let _starting_child = StartingChild(startup);
    let writer = Arc::new(Mutex::new(stdin));
    let runtime = Arc::new(Mutex::new(RuntimeInfo {
        lifecycle: "starting".to_string(),
        capabilities: None,
        detail: None,
        diagnostic_refusals: HashMap::new(),
    }));
    let (incoming_tx, incoming_rx) = mpsc::sync_channel(64);
    let reader_runtime = Arc::clone(&runtime);
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_frame(&mut reader, MAX_MESSAGE_BYTES) {
                Ok(Some(message)) => {
                    if incoming_tx.send(Incoming::Message(message)).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = incoming_tx.send(Incoming::Closed("JDT LS stdout closed".to_string()));
                    break;
                }
                Err(error) => {
                    if let Ok(mut info) = reader_runtime.lock() {
                        info.lifecycle = "failed".to_string();
                        info.detail = Some(error.clone());
                    }
                    let _ = incoming_tx.send(Incoming::Closed(error));
                    break;
                }
            }
        }
    });
    let stderr_root = root.to_string_lossy().into_owned();
    let stderr_home = env::var("HOME").ok();
    let stderr_thread =
        thread::spawn(move || drain_stderr(stderr, &stderr_root, stderr_home.as_deref()));

    let initialize_id = generation.saturating_mul(10).saturating_add(1);
    let mut settings = language_settings(project_jdk.as_ref(), gradle_import_enabled);
    apply_gradle_language_settings(
        &mut settings,
        project_jdk.as_ref(),
        gradle_settings,
        gradle_import_launcher,
    );
    if let Some(import) = &generated_source_import {
        let arguments = &mut settings["java"]["import"]["gradle"]["arguments"];
        if let Some(arguments) = arguments.as_array_mut() {
            arguments.extend([json!("--init-script"), json!(import.path)]);
        }
    }
    apply_maven_language_settings(
        &mut settings,
        maven_user_settings.as_ref().map(PrivateMavenSettings::path),
    );
    apply_java_formatter_language_settings(
        &mut settings,
        private_formatter_profile
            .as_ref()
            .map(PrivateFormatterProfile::path),
        java_formatter_profile,
    )?;
    let initialize_result: Result<Value, String> = (|| {
        write_message(&writer, &initialize_request(initialize_id, &root, &settings))?;
        let result = wait_for_initialize(
            &incoming_rx,
            initialize_id,
            timeout,
            Some((&writer, &settings, &root)),
        )?;
        write_message(&writer, &json!({"jsonrpc":"2.0","method":"initialized","params":{}}))?;
        write_message(&writer, &json!({
            "jsonrpc":"2.0",
            "method":"workspace/didChangeConfiguration",
            "params":{"settings":settings}
        }))?;
        Ok(result)
    })();
    let (capabilities, semantic_token_legend, project_settings_supported) = match initialize_result
    {
        Ok(value) => (
            normalize_capabilities(&value),
            semantic_token_legend(&value),
            value
                .pointer("/capabilities/executeCommandProvider/commands")
                .and_then(Value::as_array)
                .is_some_and(|commands| {
                    commands
                        .iter()
                        .any(|command| command.as_str() == Some("java.project.getSettings"))
                }),
        ),
        Err(error) => {
            drop(incoming_rx);
            kill_child(&child);
            let _ = reader.join();
            let _ = stderr_thread.join();
            manager.initialization_failure = Some((root, error.clone()));
            push_event(
                &manager.events,
                generation,
                "status",
                json!({"lifecycle":"failed","detail":error}),
            );
            return Err(error);
        }
    };
    if let Ok(mut info) = runtime.lock() {
        info.lifecycle = "initialized".to_string();
        info.capabilities = Some(capabilities.clone());
    }
    push_event(
        &manager.events,
        generation,
        "status",
        json!({"lifecycle":"initialized","capabilities":capabilities}),
    );

    let shutdown_id = Arc::new(AtomicU64::new(0));
    let pending_semantic = Arc::new(Mutex::new(HashMap::new()));
    let next_request_id = Arc::new(AtomicU64::new(
        generation.saturating_mul(1_000_000).saturating_add(100),
    ));
    let (shutdown_tx, shutdown_rx) = mpsc::sync_channel(1);
    let dispatcher_events = Arc::clone(&manager.events);
    let dispatcher_runtime = Arc::clone(&runtime);
    let dispatcher_shutdown_id = Arc::clone(&shutdown_id);
    let dispatcher_writer = Arc::clone(&writer);
    let dispatcher_workspace_id = id.clone();
    let dispatcher_workspace_root = root.clone();
    let dispatcher_pending_semantic = Arc::clone(&pending_semantic);
    let dispatcher = thread::spawn(move || {
        dispatch_messages(
            incoming_rx,
            generation,
            DispatcherContext {
                workspace_id: dispatcher_workspace_id,
                workspace_root: dispatcher_workspace_root,
                settings,
                events: dispatcher_events,
                runtime: dispatcher_runtime,
                shutdown_id: dispatcher_shutdown_id,
                shutdown_tx,
                writer: dispatcher_writer,
                pending_semantic: dispatcher_pending_semantic,
            },
        )
    });

    manager.session = Some(Session {
        generation,
        workspace_id: id,
        workspace_root: root,
        jdtls,
        java,
        project_jdk,
        server_jdk_home: server_jdk_home.map(str::to_owned),
        gradle_import_enabled,
        java_formatter_profile: java_formatter_profile.cloned(),
        _private_formatter_profile: private_formatter_profile,
        project_path,
        maven_repository,
        maven_project_root,
        maven_user_settings,
        gradle_settings: gradle_settings.cloned(),
        gradle_generated_source_script: generated_source_script,
        _gradle_generated_source_import: generated_source_import,
        active_maven_profiles: active_maven_profiles.to_vec(),
        inactive_maven_profiles: inactive_maven_profiles.to_vec(),
        gradle_preview_context_hash: None,
        compiler_latest_source: None,
        project_settings_supported,
        gradle_preview_original_settings: HashMap::new(),
        child,
        writer,
        shutdown_id,
        shutdown_rx,
        runtime,
        semantic_token_legend,
        open_documents: HashMap::new(),
        pending_semantic,
        next_request_id,
        threads: vec![reader, stderr_thread, dispatcher],
    });
    if let Err(error) = apply_maven_profiles(manager, timeout) {
        let _ = stop_session(manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT);
        return Err(error);
    }
    if gradle_import_settings_changed && gradle_import_enabled {
        if let Err(error) = apply_gradle_import_settings(manager, timeout) {
            let _ = stop_session(manager, SHUTDOWN_TIMEOUT, EXIT_TIMEOUT);
            return Err(error);
        }
    }
    Ok(())
}

fn stop_session(
    manager: &mut Manager,
    shutdown_timeout: Duration,
    exit_timeout: Duration,
) -> Result<(), String> {
    trace_language_lifecycle("stop-enter");
    manager.initialization_failure = None;
    let Some(mut session) = manager.session.take() else {
        manager.generation = manager.generation.saturating_add(1);
        trace_language_lifecycle("stop-no-session");
        return Ok(());
    };
    let compiler_restore_error = restore_gradle_preview_settings(&mut session).err();
    trace_language_lifecycle("stop-after-restore-preview-settings");
    manager.generation = manager.generation.max(session.generation).saturating_add(1);
    if let Ok(mut runtime) = session.runtime.lock() {
        runtime.lifecycle = "stopping".to_string();
    }
    push_event(
        &manager.events,
        session.generation,
        "status",
        json!({"lifecycle":"stopping"}),
    );
    cancel_all_semantic_requests(&session.pending_semantic, &session.writer);
    trace_language_lifecycle("stop-after-cancel-semantic-requests");

    for document in session.open_documents.drain().map(|(_, document)| document) {
        let close = json!({"jsonrpc":"2.0","method":"textDocument/didClose","params":{
            "textDocument":{"uri":document.uri}
        }});
        let _ = write_message_timeout(&session.writer, close, DOCUMENT_WRITE_TIMEOUT);
        push_diagnostics_clear(
            &manager.events,
            session.generation,
            &session.workspace_id,
            &document.uri,
            document.version,
        );
    }
    trace_language_lifecycle("stop-after-close-documents");

    let request_id = session.generation.saturating_mul(10).saturating_add(2);
    session.shutdown_id.store(request_id, Ordering::SeqCst);
    trace_language_lifecycle("stop-before-shutdown-write");
    let shutdown_sent = write_message(
        &session.writer,
        &json!({"jsonrpc":"2.0","id":request_id,"method":"shutdown","params":null}),
    )
    .is_ok();
    trace_language_lifecycle("stop-after-shutdown-write");
    let shutdown_acknowledged =
        shutdown_sent && session.shutdown_rx.recv_timeout(shutdown_timeout).is_ok();
    trace_language_lifecycle(if shutdown_acknowledged {
        "stop-shutdown-acknowledged"
    } else {
        "stop-shutdown-acknowledgement-unavailable"
    });
    if shutdown_acknowledged {
        let _ = write_message(
            &session.writer,
            &json!({"jsonrpc":"2.0","method":"exit","params":null}),
        );
    }
    drop(session.writer);

    trace_language_lifecycle("stop-before-wait-for-exit");
    let exited = wait_for_exit(&session.child, exit_timeout)?;
    trace_language_lifecycle(if exited {
        "stop-process-exited"
    } else {
        "stop-process-exit-timeout"
    });
    if !exited {
        trace_language_lifecycle("stop-before-kill-process");
        kill_child(&session.child);
        trace_language_lifecycle("stop-after-kill-process");
    }
    for (index, handle) in session.threads.drain(..).enumerate() {
        trace_language_lifecycle(match index {
            0 => "stop-before-join-reader",
            1 => "stop-before-join-stderr-reader",
            _ => "stop-before-join-dispatcher",
        });
        let _ = handle.join();
        trace_language_lifecycle(match index {
            0 => "stop-after-join-reader",
            1 => "stop-after-join-stderr-reader",
            _ => "stop-after-join-dispatcher",
        });
    }
    trace_language_lifecycle("stop-after-join-threads");
    if let Some(settings) = session.maven_user_settings.take() {
        settings.remove()?;
    }
    push_event(
        &manager.events,
        manager.generation,
        "status",
        json!({"lifecycle":"stopped"}),
    );
    compiler_restore_error.map_or(Ok(()), Err)
}

fn enforce_restart_limit(manager: &mut Manager) -> Result<(), String> {
    let now = Instant::now();
    while manager
        .restart_times
        .front()
        .is_some_and(|time| now.duration_since(*time) > Duration::from_secs(60))
    {
        manager.restart_times.pop_front();
    }
    if manager.restart_times.len() >= MAX_RESTARTS_PER_MINUTE {
        return Err(
            "Java language service launch/restart limit exceeded; retry in one minute".to_string(),
        );
    }
    manager.restart_times.push_back(now);
    Ok(())
}

struct DispatcherContext {
    workspace_id: String,
    workspace_root: PathBuf,
    settings: Value,
    events: Arc<Mutex<EventQueue>>,
    runtime: Arc<Mutex<RuntimeInfo>>,
    shutdown_id: Arc<AtomicU64>,
    shutdown_tx: mpsc::SyncSender<()>,
    writer: Arc<Mutex<ChildStdin>>,
    pending_semantic: PendingSemanticRequests,
}

fn dispatch_messages(
    incoming: mpsc::Receiver<Incoming>,
    generation: u64,
    context: DispatcherContext,
) {
    while let Ok(item) = incoming.recv() {
        match item {
            Incoming::Message(message) => {
                let expected = context.shutdown_id.load(Ordering::SeqCst);
                if expected != 0 && response_id(&message) == Some(expected) {
                    let _ = context.shutdown_tx.try_send(());
                    continue;
                }
                let method = message.get("method").and_then(Value::as_str);
                if route_pending_response(&context.pending_semantic, &message) {
                    // Unknown and late client responses are intentionally dropped. They must
                    // never become pollable generic protocol events.
                    continue;
                }
                if method.is_some() && message.get("id").is_some() {
                    if let Err(detail) = respond_to_server_request(
                        &context.writer,
                        &message,
                        &context.settings,
                        &context.workspace_root,
                    ) {
                        if let Ok(mut info) = context.runtime.lock() {
                            info.lifecycle = "failed".to_string();
                            info.detail = Some(detail.clone());
                        }
                        push_event(
                            &context.events,
                            generation,
                            "status",
                            json!({"lifecycle":"failed","detail":detail}),
                        );
                        break;
                    }
                }
                if matches!(
                    method,
                    Some("client/registerCapability" | "client/unregisterCapability")
                ) {
                    let mut status_payload = None;
                    if let Ok(mut info) = context.runtime.lock() {
                        let lifecycle = info.lifecycle.clone();
                        if let Some(capabilities) = &mut info.capabilities {
                            if super::protocol::apply_dynamic_capability_registration(
                                capabilities,
                                method.unwrap_or_default(),
                                message.get("params").unwrap_or(&Value::Null),
                            ) {
                                status_payload = Some(json!({
                                    "lifecycle":lifecycle,
                                    "capabilities":capabilities.clone(),
                                }));
                            }
                        }
                    }
                    if let Some(payload) = status_payload {
                        push_event(&context.events, generation, "status", payload);
                    }
                    continue;
                }
                if method == Some("textDocument/publishDiagnostics") {
                    let Ok(runtime) = context.runtime.lock() else {
                        continue;
                    };
                    let refused = message
                        .pointer("/params/uri")
                        .and_then(Value::as_str)
                        .is_some_and(|uri| runtime.diagnostic_refusals.contains_key(uri));
                    if refused {
                        continue;
                    }
                    if let Some(payload) = sanitize_diagnostics(
                        message,
                        generation,
                        &context.workspace_id,
                        &context.workspace_root,
                    ) {
                        push_event(&context.events, generation, "diagnostics", payload);
                    }
                    continue;
                }
                let kind = match method {
                    Some("$/progress") => "progress",
                    Some("window/logMessage") | Some("window/showMessage") => "status",
                    Some(_) => "notification",
                    None => "protocol",
                };
                push_event(&context.events, generation, kind, bounded_payload(message));
            }
            Incoming::Closed(detail) => {
                if let Ok(mut pending) = context.pending_semantic.lock() {
                    pending.clear();
                }
                let mut unexpected = true;
                if let Ok(mut info) = context.runtime.lock() {
                    unexpected = info.lifecycle != "stopping";
                    if unexpected {
                        info.lifecycle = "failed".to_string();
                        info.detail = Some(detail.clone());
                    }
                }
                if unexpected {
                    push_event(
                        &context.events,
                        generation,
                        "status",
                        json!({"lifecycle":"failed","detail":detail}),
                    );
                }
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn project_topology_change_excludes_language_session_start_until_work_finishes() {
        let state = JavaLanguageServiceState::default();
        let result = state
            .with_project_topology_paused("workspace", || {
                assert!(matches!(
                    state.manager.try_lock(),
                    Err(std::sync::TryLockError::WouldBlock)
                ));
                "provider result"
            })
            .unwrap();
        assert_eq!(result, "provider result");
        assert!(state.manager.try_lock().is_ok());
    }

    #[test]
    fn main_document_change_does_not_wait_for_the_manager_or_retire_an_idle_generation() {
        let state = JavaLanguageServiceState::default();
        let manager = state.manager.lock().unwrap();
        let generation = manager.generation;
        let marked = thread::scope(|scope| {
            let (sent, received) = mpsc::sync_channel(1);
            let state = &state;
            scope.spawn(move || {
                state.main_document_changed();
                let _ = sent.send(());
            });
            let result = received.recv_timeout(Duration::from_secs(2));
            drop(manager);
            result
        });
        assert!(marked.is_ok(), "navigation must not wait for the Java worker");
        assert_eq!(state.manager().unwrap().generation, generation);
        assert!(!state.main_document_changed.load(Ordering::Acquire));
    }

    #[cfg(unix)]
    #[test]
    fn application_exit_terminates_a_starting_language_server() {
        let state = JavaLanguageServiceState::default();
        let child = Arc::new(Mutex::new(Command::new("sleep").arg("30").spawn().unwrap()));
        state.startup.lock().unwrap().child = Some(Arc::clone(&child));

        let manager = state.manager.lock().unwrap();
        let exit_signalled = thread::scope(|scope| {
            let (sent, received) = mpsc::sync_channel(1);
            let state = &state;
            scope.spawn(move || {
                state.begin_application_exit();
                let _ = sent.send(());
            });
            let result = received.recv_timeout(Duration::from_secs(2));
            drop(manager);
            result.is_ok()
        });
        assert!(exit_signalled, "exit must signal startup while the manager is busy");
        let exited = wait_for_exit(&child, Duration::from_secs(2)).unwrap();
        if !exited {
            kill_child(&child);
        }
        assert!(exited, "a server still starting must exit when the IDE closes");
        let startup = state.startup.lock().unwrap();
        assert!(startup.child.is_none());
        assert!(startup.admit().is_err());
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

    fn wait_for_matching_event(
        manager: &Manager,
        after_sequence: u64,
        timeout: Duration,
        predicate: impl Fn(&JavaLanguageServiceEvent) -> bool,
    ) -> JavaLanguageServiceEvent {
        let deadline = Instant::now() + timeout;
        loop {
            let batch = lock(&manager.events, "real event queue")
                .unwrap()
                .poll(after_sequence, MAX_EVENTS);
            if let Some(event) = batch.events.iter().find(|event| predicate(event)) {
                return event.clone();
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for JDT LS event after sequence {after_sequence}: {batch:?}"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn configured_jdtls_runtime_home_must_be_a_trimmed_absolute_path() {
        let selected = env::temp_dir().join("jdtls-runtime-jdk");
        assert!(validate_server_jdk_home(Some(selected.to_str().unwrap())).is_ok());
        assert!(validate_server_jdk_home(None).is_ok());
        assert!(validate_server_jdk_home(Some("jdk-25")).is_err());
        assert!(validate_server_jdk_home(Some(" /jdk-25 ")).is_err());
        assert!(validate_server_jdk_home(Some("/jdk-25\0bad")).is_err());
    }

    #[test]
    fn saved_configuration_notifications_are_bound_to_regular_workspace_files_and_session() {
        let root = temp_dir("saved-config");
        let other = temp_dir("saved-config-other");
        fs::create_dir_all(root.join(".settings")).unwrap();
        let file = root.join(".settings/org.eclipse.jdt.core.prefs");
        fs::write(&file, "eclipse.preferences.version=1\n").unwrap();
        let request = JavaLanguageWorkspaceFile {
            workspace_id: "test".into(),
            generation: 3,
            path: ".settings/org.eclipse.jdt.core.prefs".into(),
            uri: file_uri(&file),
        };
        let message = saved_workspace_file_message(&root, &root, "test", 3, &request).unwrap();
        assert_eq!(message["method"], "workspace/didChangeWatchedFiles");
        assert_eq!(
            message["params"]["changes"],
            json!([{"uri":file_uri(&file),"type":2}])
        );
        assert!(saved_workspace_file_message(&root, &other, "test", 3, &request).is_err());
        assert!(saved_workspace_file_message(&root, &root, "test", 4, &request).is_err());
        assert!(saved_workspace_file_message(&root, &root, "other", 3, &request).is_err());
        for path in ["../secret", ".settings", "missing.xml"] {
            let invalid = JavaLanguageWorkspaceFile {
                path: path.into(),
                ..request.clone()
            };
            assert!(saved_workspace_file_message(&root, &root, "test", 3, &invalid).is_err());
        }
        #[cfg(unix)]
        {
            fs::write(other.join("secret.prefs"), "secret").unwrap();
            std::os::unix::fs::symlink(other.join("secret.prefs"), root.join("linked.prefs"))
                .unwrap();
            let invalid = JavaLanguageWorkspaceFile {
                path: "linked.prefs".into(),
                uri: file_uri(&root.join("linked.prefs")),
                ..request
            };
            assert!(saved_workspace_file_message(&root, &root, "test", 3, &invalid).is_err());
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn generator_member_selections_are_bounded_and_bound_to_jdt_status() {
        let fields = vec![
            json!({"bindingKey":"field:displayName","name":"displayName"}),
            json!({"bindingKey":"field:revision","name":"revision"}),
        ];
        assert_eq!(
            validated_selection_keys(&fields, &["field:displayName".to_string()]),
            Some(vec!["field:displayName".to_string()])
        );
        assert_eq!(
            selected_generator_fields(&fields, &["field:displayName".to_string()])
                .unwrap()
                .iter()
                .map(|field| field["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["displayName"]
        );
        assert!(validated_selection_keys(&fields, &["field:unknown".to_string()]).is_none());
        assert!(validated_selection_keys(
            &fields,
            &[
                "field:displayName".to_string(),
                "field:displayName".to_string()
            ]
        )
        .is_none());

        let constructors = JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::Constructors,
            selected_field_binding_keys: vec![],
            selected_constructor_binding_keys: vec!["constructor:Object()".to_string()],
            selected_overridable_method_keys: vec![],
            selected_delegate_method_keys: vec![],
        };
        assert!(valid_generation_selection(&constructors));
        let hash_code_equals = JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::HashCodeEquals,
            selected_field_binding_keys: vec!["field:displayName".to_string()],
            selected_constructor_binding_keys: vec![],
            selected_overridable_method_keys: vec![],
            selected_delegate_method_keys: vec![],
        };
        assert!(valid_generation_selection(&hash_code_equals));
        assert!(!valid_generation_selection(
            &JavaCodeActionGenerationSelection {
                kind: JavaCodeActionGenerationKind::HashCodeEquals,
                selected_field_binding_keys: vec![],
                selected_constructor_binding_keys: vec![],
                selected_overridable_method_keys: vec![],
                selected_delegate_method_keys: vec![],
            }
        ));

        let methods = vec![
            json!({
                "name":"label",
                "declaringClass":"example.LabelContract",
                "parameters":[]
            }),
            json!({
                "name":"value",
                "declaringClass":"example.Base",
                "parameters":["int"]
            }),
        ];
        let method_keys = valid_overridable_methods(&methods).unwrap();
        assert_eq!(method_keys.len(), 2);
        assert_eq!(
            validated_overridable_method_selection(&methods, &[method_keys[0].clone()]),
            Some(vec![methods[0].clone()])
        );
        assert!(validated_overridable_method_selection(&methods, &["stale".to_string()]).is_none());
        assert!(valid_overridable_methods(&[methods[0].clone(), methods[0].clone()]).is_none());
        assert!(valid_overridable_methods(&[json!({"name":"label"})]).is_none());

        let override_methods = JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::OverrideMethods,
            selected_field_binding_keys: vec![],
            selected_constructor_binding_keys: vec![],
            selected_overridable_method_keys: vec![method_keys[0].clone()],
            selected_delegate_method_keys: vec![],
        };
        assert!(valid_generation_selection(&override_methods));
        assert!(!valid_generation_selection(
            &JavaCodeActionGenerationSelection {
                kind: JavaCodeActionGenerationKind::OverrideMethods,
                selected_field_binding_keys: vec!["field:displayName".to_string()],
                selected_constructor_binding_keys: vec![],
                selected_overridable_method_keys: vec![method_keys[0].clone()],
                selected_delegate_method_keys: vec![],
            }
        ));
        let delegate_fields = vec![json!({
            "field":{"bindingKey":"field:delegate","name":"delegate","type":"example.Target","isField":true},
            "delegateMethods":[{"bindingKey":"method:render","name":"render","parameters":["java.lang.String"]}]
        })];
        let delegate_locations = valid_delegate_fields(&delegate_fields).unwrap();
        assert_eq!(delegate_locations.len(), 1);
        let delegate_key = delegate_method_key(
            &delegate_fields[0]["field"],
            &delegate_fields[0]["delegateMethods"][0],
        )
        .unwrap();
        let delegate_methods = JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::DelegateMethods,
            selected_field_binding_keys: vec![],
            selected_constructor_binding_keys: vec![],
            selected_overridable_method_keys: vec![],
            selected_delegate_method_keys: vec![delegate_key],
        };
        assert!(valid_generation_selection(&delegate_methods));
        assert_eq!(
            delegate_fields[0]["field"]["name"].as_str(),
            Some("delegate")
        );
        assert!(valid_delegate_fields(&[json!({"field":{"name":"delegate"}})]).is_none());
    }

    #[test]
    fn launch_limit_allows_normal_jdtls_reconfiguration_and_stays_bounded() {
        let mut manager = Manager::default();
        for _ in 0..MAX_RESTARTS_PER_MINUTE {
            enforce_restart_limit(&mut manager).unwrap();
        }
        assert!(enforce_restart_limit(&mut manager)
            .unwrap_err()
            .contains("retry in one minute"));
    }

    #[test]
    fn maven_profile_selection_preserves_active_and_inactive_intent() {
        let active = vec!["alternate".to_string(), "integration".to_string()];
        let inactive = vec!["legacy".to_string()];
        assert_eq!(
            maven_profile_selection(&active, &inactive).unwrap(),
            "alternate,integration,!legacy"
        );
        assert_eq!(maven_profile_selection(&[], &[]).unwrap(), "");
    }

    #[test]
    fn maven_profile_selection_rejects_ambiguous_ids_and_conflicting_intent() {
        for profile in [
            "",
            " leading",
            "trailing ",
            "!inactive",
            "one,two",
            "bad\nprofile",
        ] {
            assert!(
                validate_maven_profiles(&[profile.to_string()]).is_err(),
                "{profile:?}"
            );
        }
        assert!(validate_maven_profiles(&["same".into(), "same".into()]).is_err());
        assert!(maven_profile_selection(&["shared".into()], &["shared".into()]).is_err());
    }

    #[test]
    fn selected_maven_settings_are_exposed_to_jdt_ls_import_configuration() {
        let mut settings = language_settings(None, false);
        apply_maven_language_settings(&mut settings, Some(Path::new("/private/settings.xml")));
        assert_eq!(
            settings.pointer("/java/configuration/maven/userSettings"),
            Some(&Value::String("/private/settings.xml".to_string()))
        );
    }

    #[test]
    fn selected_eclipse_formatter_profile_is_exposed_to_jdt_ls() {
        let mut settings = language_settings(None, false);
        let profile = JavaLanguageFormatterProfile {
            path: "config/format.xml".to_string(),
            profile_name: "Team Java".to_string(),
        };
        apply_java_formatter_language_settings(
            &mut settings,
            Some(Path::new("/private/formatter-profile.xml")),
            Some(&profile),
        )
        .unwrap();
        assert_eq!(
            settings.pointer("/java/format/settings/url"),
            Some(&Value::String(
                Url::from_file_path("/private/formatter-profile.xml")
                    .unwrap()
                    .to_string()
            ))
        );
        assert_eq!(
            settings.pointer("/java/format/settings/profile"),
            Some(&Value::String("Team Java".to_string()))
        );
    }

    #[test]
    fn jdtls_gradle_import_uses_selected_installation_and_project_settings() {
        let root = temp_dir("gradle-settings");
        let gradle_home = root.join("gradle-9");
        let bin = gradle_home.join("bin");
        let project = root.join("project");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&project).unwrap();
        let executable = bin.join(if cfg!(windows) {
            "gradle.bat"
        } else {
            "gradle"
        });
        fs::write(&executable, "fixture").unwrap();
        let settings = JavaLanguageGradleSettings {
            executable: executable.to_string_lossy().into_owned(),
            user_home: root.join("gradle-user-home").to_string_lossy().into_owned(),
            gradle_runtime_home: Some("/jdk-21".to_string()),
            project_properties: BTreeMap::from([
                ("feature".to_string(), "classfile".to_string()),
                ("release".to_string(), "25".to_string()),
            ]),
        };
        let launcher = resolve_gradle_import_launcher(true, Some(&settings), &root, &project)
            .unwrap()
            .unwrap();
        let jdk = ProjectJdk {
            requested_home: "/jdk-25".to_string(),
            home: PathBuf::from("/jdk-25"),
            version: "25".to_string(),
            major: 25,
        };
        let mut language = language_settings(Some(&jdk), true);
        apply_gradle_language_settings(&mut language, Some(&jdk), Some(&settings), Some(launcher));

        assert_eq!(
            language
                .pointer("/java/import/gradle/home")
                .and_then(Value::as_str),
            gradle_home.to_str()
        );
        assert_eq!(
            language.pointer("/java/import/gradle/wrapper/enabled"),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            language
                .pointer("/java/import/gradle/user/home")
                .and_then(Value::as_str),
            Some(settings.user_home.as_str())
        );
        assert_eq!(
            language
                .pointer("/java/import/gradle/java/home")
                .and_then(Value::as_str),
            Some("/jdk-21")
        );
        assert_eq!(
            language.pointer("/java/import/gradle/arguments"),
            Some(&json!(["-Pfeature=classfile", "-Prelease=25"]))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn jdtls_gradle_import_accepts_only_the_selected_project_wrapper_or_installation() {
        let root = temp_dir("gradle-wrapper-settings");
        let project = root.join("modules/service");
        fs::create_dir_all(&project).unwrap();
        let wrapper = root.join(if cfg!(windows) {
            "gradlew.bat"
        } else {
            "gradlew"
        });
        fs::write(&wrapper, "fixture").unwrap();
        let settings = JavaLanguageGradleSettings {
            executable: wrapper.to_string_lossy().into_owned(),
            user_home: String::new(),
            gradle_runtime_home: None,
            project_properties: BTreeMap::new(),
        };

        assert!(matches!(
            resolve_gradle_import_launcher(true, Some(&settings), &root, &project),
            Ok(Some(GradleImportLauncher::ProjectWrapper))
        ));
        assert!(resolve_gradle_import_launcher(false, Some(&settings), &root, &project).is_ok());

        let unsupported = root.join("custom-gradle");
        fs::write(&unsupported, "fixture").unwrap();
        let unsupported_settings = JavaLanguageGradleSettings {
            executable: unsupported.to_string_lossy().into_owned(),
            user_home: String::new(),
            gradle_runtime_home: None,
            project_properties: BTreeMap::new(),
        };
        assert!(
            resolve_gradle_import_launcher(true, Some(&unsupported_settings), &root, &project)
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn jdtls_project_uri_is_limited_to_canonical_workspace_paths() {
        let workspace = temp_dir("maven-profile-uri");
        let project = workspace.join("module");
        let outside = temp_dir("maven-profile-outside");
        fs::create_dir_all(&project).unwrap();
        assert_eq!(
            workspace_project_path(&super::super::path_policy::file_uri(&project), &workspace),
            Some(project.canonicalize().unwrap())
        );
        assert_eq!(
            workspace_project_path(&super::super::path_policy::file_uri(&outside), &workspace),
            None
        );
        assert_eq!(
            workspace_project_path("https://example.test/project", &workspace),
            None
        );
        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn selected_maven_project_root_is_workspace_relative_and_canonical() {
        let workspace = temp_dir("selected-maven-root");
        let selected = workspace.join("services/api");
        fs::create_dir_all(&selected).unwrap();
        let (root, path) = resolve_maven_project_root(&workspace, "services/api").unwrap();
        assert_eq!(root, selected.canonicalize().unwrap());
        assert_eq!(path, "services/api");
        assert!(resolve_maven_project_root(&workspace, "../outside").is_err());
        assert!(resolve_maven_project_root(&workspace, "/etc").is_err());
        assert!(resolve_maven_project_root(&workspace, "services/missing").is_err());
        let _ = fs::remove_dir_all(workspace);
    }

    fn wait_for_unresolved_type_diagnostic(
        state: &JavaLanguageServiceState,
        generation: u64,
        after_sequence: u64,
        uri: &str,
        type_name: &str,
        expect_unresolved: bool,
    ) -> JavaLanguageServiceEvent {
        wait_for_matching_event(
            &lock(&state.manager, "Maven profile integration state").unwrap(),
            after_sequence,
            Duration::from_secs(60),
            |event| {
                if event.generation != generation
                    || event.kind != "diagnostics"
                    || event.payload.pointer("/params/uri").and_then(Value::as_str) != Some(uri)
                {
                    return false;
                }
                let Some(diagnostics) = event
                    .payload
                    .pointer("/params/diagnostics")
                    .and_then(Value::as_array)
                else {
                    return false;
                };
                let unresolved = diagnostics.iter().any(|diagnostic| {
                    diagnostic
                        .get("message")
                        .and_then(Value::as_str)
                        .is_some_and(|message| {
                            let message = message.to_ascii_lowercase();
                            message.contains(&type_name.to_ascii_lowercase())
                                && message.contains("cannot be resolved")
                        })
                });
                unresolved == expect_unresolved
            },
        )
    }

    fn wait_for_imported_java_project_settings(
        state: &JavaLanguageServiceState,
        project_root: &Path,
        required_nature: &str,
        timeout: Duration,
    ) -> Value {
        let project_root = project_root
            .canonicalize()
            .expect("qualification project root must resolve");
        let deadline = Instant::now() + timeout;
        loop {
            let imported_settings = {
                let manager = state.manager.lock().unwrap();
                let session = manager
                    .session
                    .as_ref()
                    .expect("JDT LS session must remain active");
                let projects =
                    execute_jdtls_command(session, "java.project.getAll", json!([]), deadline)
                        .expect("query imported Java projects");
                let projects = projects
                    .as_array()
                    .expect("JDT LS project list must be an array");
                let mut imported_settings = None;
                for uri in projects.iter().filter_map(Value::as_str) {
                    let Some(path) = workspace_project_path(uri, &project_root) else {
                        continue;
                    };
                    if path.canonicalize().ok().as_ref() != Some(&project_root) {
                        continue;
                    }
                    let settings = execute_jdtls_command(
                        session,
                        "java.project.getSettings",
                        json!([
                            uri,
                            [
                                JAVA_NATURE_IDS_SETTING,
                                "org.eclipse.jdt.core.compiler.source",
                                "org.eclipse.jdt.core.compiler.compliance",
                                "org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures"
                            ]
                        ]),
                        deadline,
                    )
                    .expect("query imported project settings");
                    let has_nature = settings
                        .get(JAVA_NATURE_IDS_SETTING)
                        .and_then(Value::as_array)
                        .is_some_and(|natures| {
                            natures
                                .iter()
                                .any(|nature| nature.as_str() == Some(required_nature))
                        });
                    if has_nature {
                        imported_settings = Some(settings);
                        break;
                    }
                }
                imported_settings
            };
            if let Some(settings) = imported_settings {
                return settings;
            }
            assert!(
                Instant::now() < deadline,
                "JDT LS did not import the fixture with nature {required_nature}"
            );
            thread::sleep(Duration::from_millis(200));
        }
    }

    #[test]
    #[ignore = "requires managed JDT LS and a full JDK 25"]
    fn managed_jdtls_applies_active_and_inactive_maven_profiles_to_selected_project() {
        let root = temp_dir("real-maven-profiles-workspace");
        let ide_home = temp_dir("real-maven-profiles-state");
        let project = root.join("selected");
        fs::create_dir_all(project.join("src/main/java/example")).unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            project.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>profile-fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release></properties>
  <profiles><profile><id>classfile-api</id><activation><activeByDefault>true</activeByDefault></activation>
    <properties><maven.compiler.release>25</maven.compiler.release></properties>
  </profile></profiles>
</project>"#,
        )
        .unwrap();
        let source = "package example; public final class ProfileFixture { java.lang.classfile.ClassFile value; }\n";
        let path = project.join("src/main/java/example/ProfileFixture.java");
        fs::write(&path, source).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-maven-profiles"}"#,
        )
        .unwrap();
        let java_executable = discover_java()
            .expect("a full Java JDK is required")
            .executable;
        let java_home = java_executable
            .parent()
            .and_then(Path::parent)
            .expect("the Java executable must be inside a JDK")
            .to_path_buf();
        let previous = [
            crate::workspace::WORKSPACE_ROOT_ENV,
            crate::app_config::IDE_HOME_ENV,
            "IDE_JAVA_HOME",
        ]
        .into_iter()
        .map(|name| (name, env::var_os(name)))
        .collect();

        struct Cleanup {
            state: JavaLanguageServiceState,
            root: PathBuf,
            ide_home: PathBuf,
            previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.state.shutdown_all();
                for (name, value) in &self.previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.ide_home);
            }
        }
        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        env::set_var("IDE_JAVA_HOME", &java_home);
        let guard = Cleanup {
            state: JavaLanguageServiceState::default(),
            root: root.clone(),
            ide_home: ide_home.clone(),
            previous,
        };

        let inactive = guard
            .state
            .start(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-maven-profiles".to_string(),
                generation: None,
                project_jdk_home: None,
                server_jdk_home: None,
                gradle_import_enabled: Some(false),
                project_path: Some("selected".to_string()),
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: Some(vec!["classfile-api".to_string()]),
                gradle: None,
                java_formatter_profile: None,
            }))
            .unwrap();
        assert_eq!(inactive.project_path.as_deref(), Some("selected"));
        assert_eq!(
            inactive.inactive_maven_profiles,
            vec!["classfile-api".to_string()]
        );
        let ready = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, 0, Duration::from_secs(60), |event| {
                event.generation == inactive.generation
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            })
        };
        guard
            .state
            .open_document(JavaLanguageDocument {
                workspace_id: "jdtls-maven-profiles".to_string(),
                generation: inactive.generation,
                path: "selected/src/main/java/example/ProfileFixture.java".to_string(),
                uri: file_uri(&path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            })
            .unwrap();
        wait_for_unresolved_type_diagnostic(
            &guard.state,
            inactive.generation,
            ready.sequence,
            &file_uri(&path),
            "classfile",
            true,
        );

        let active = guard
            .state
            .restart(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-maven-profiles".to_string(),
                generation: Some(inactive.generation),
                project_jdk_home: None,
                server_jdk_home: None,
                gradle_import_enabled: Some(false),
                project_path: Some("selected".to_string()),
                maven_repository: None,
                active_maven_profiles: Some(vec!["classfile-api".to_string()]),
                inactive_maven_profiles: Some(Vec::new()),
                gradle: None,
                java_formatter_profile: None,
            }))
            .unwrap();
        assert_eq!(active.project_path.as_deref(), Some("selected"));
        assert_eq!(
            active.active_maven_profiles,
            vec!["classfile-api".to_string()]
        );
        let ready = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, ready.sequence, Duration::from_secs(60), |event| {
                event.generation == active.generation
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            })
        };
        guard
            .state
            .open_document(JavaLanguageDocument {
                workspace_id: "jdtls-maven-profiles".to_string(),
                generation: active.generation,
                path: "selected/src/main/java/example/ProfileFixture.java".to_string(),
                uri: file_uri(&path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            })
            .unwrap();
        wait_for_unresolved_type_diagnostic(
            &guard.state,
            active.generation,
            ready.sequence,
            &file_uri(&path),
            "classfile",
            false,
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
    }

    #[test]
    #[ignore = "requires managed JDT LS, JDK 25, a Gradle installation and writable Gradle user home"]
    fn managed_jdtls_imports_gradle_with_selected_installation_and_project_properties() {
        let project_jdk_home = Path::new(
            &env::var("IDE_JDTLS_PROJECT_JDK_25").expect("JDK 25 qualification path required"),
        )
        .canonicalize()
        .expect("selected JDK path must resolve")
        .to_string_lossy()
        .into_owned();
        probe_project_jdk(&project_jdk_home).expect("selected project JDK must be usable");
        let gradle_executable = env::var("IDE_JDTLS_GRADLE_EXECUTABLE")
            .expect("Gradle installation executable qualification path required");
        let gradle_home = Path::new(&gradle_executable)
            .parent()
            .and_then(Path::parent)
            .expect("selected executable must be under a Gradle bin directory")
            .canonicalize()
            .expect("selected Gradle installation home must resolve");
        let gradle_user_home = PathBuf::from(
            env::var("IDE_JDTLS_GRADLE_USER_HOME")
                .expect("writable Gradle user home qualification path required"),
        );
        fs::create_dir_all(&gradle_user_home).expect("Gradle user home must be writable");
        let gradle_user_home = gradle_user_home
            .canonicalize()
            .expect("Gradle user home must resolve");
        let gradle_version = env::var("IDE_JDTLS_GRADLE_VERSION")
            .expect("selected Gradle version qualification value required");
        let project_properties = BTreeMap::from([
            (
                "expectedGradleHome".into(),
                gradle_home.to_string_lossy().into_owned(),
            ),
            (
                "expectedGradleUserHome".into(),
                gradle_user_home.to_string_lossy().into_owned(),
            ),
            ("expectedGradleVersion".into(), gradle_version),
            ("expectedJavaHome".into(), project_jdk_home.clone()),
            ("fixtureLibrary".into(), "selected".into()),
        ]);
        let gradle = JavaLanguageGradleSettings {
            executable: gradle_executable,
            user_home: gradle_user_home.to_string_lossy().into_owned(),
            gradle_runtime_home: None,
            project_properties: project_properties.clone(),
        };
        let root = temp_dir("real-gradle-import-workspace");
        let ide_home = temp_dir("real-gradle-import-state");
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::create_dir_all(root.join("library/src/main/java/library")).unwrap();
        fs::write(root.join("library/build.gradle"), "plugins { id 'java' }\n").unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name = 'gradle-import-fixture'\ninclude 'library'\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
        fs::write(
            root.join("build.gradle"),
            "plugins { id 'java' }\n\
def fixtureLibrary = providers.gradleProperty('fixtureLibrary').getOrElse('missing')\n\
def expectedGradleHome = providers.gradleProperty('expectedGradleHome').get()\n\
def expectedGradleUserHome = providers.gradleProperty('expectedGradleUserHome').get()\n\
def expectedGradleVersion = providers.gradleProperty('expectedGradleVersion').get()\n\
def expectedJavaHome = providers.gradleProperty('expectedJavaHome').get()\n\
if (gradle.gradleHomeDir.canonicalFile != new File(expectedGradleHome).canonicalFile) { throw new GradleException('Selected Gradle installation was not used') }\n\
if (gradle.gradleUserHomeDir.canonicalFile != new File(expectedGradleUserHome).canonicalFile) { throw new GradleException('Selected Gradle user home was not used') }\n\
if (gradle.gradleVersion != expectedGradleVersion) { throw new GradleException('Selected Gradle version was not used') }\n\
if (new File(System.getProperty('java.home')).canonicalFile != new File(expectedJavaHome).canonicalFile) { throw new GradleException('Selected Gradle JDK was not used') }\n\
if (fixtureLibrary == 'selected') { dependencies { implementation project(':library') } }\n",
        )
        .unwrap();
        let library_source = root.join("library/src/main/java/library/SelectedGradleType.java");
        fs::write(
            &library_source,
            "package library; public final class SelectedGradleType {}\n",
        )
        .unwrap();
        let source = "package example; public final class GradleImportFixture { library.SelectedGradleType value; }\n";
        let path = root.join("src/main/java/example/GradleImportFixture.java");
        fs::write(&path, source).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-gradle-import"}"#,
        )
        .unwrap();
        let java_executable = discover_java()
            .expect("a full Java JDK is required")
            .executable;
        let java_home = java_executable
            .parent()
            .and_then(Path::parent)
            .expect("the Java executable must be inside a JDK")
            .to_path_buf();
        let previous = [
            crate::workspace::WORKSPACE_ROOT_ENV,
            crate::app_config::IDE_HOME_ENV,
            "IDE_JAVA_HOME",
            "GRADLE_USER_HOME",
        ]
        .into_iter()
        .map(|name| (name, env::var_os(name)))
        .collect();

        struct Cleanup {
            state: JavaLanguageServiceState,
            root: PathBuf,
            ide_home: PathBuf,
            previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.state.shutdown_all();
                for (name, value) in &self.previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.ide_home);
            }
        }
        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        env::set_var("IDE_JAVA_HOME", &java_home);
        env::set_var("GRADLE_USER_HOME", &gradle_user_home);
        let guard = Cleanup {
            state: JavaLanguageServiceState::default(),
            root: root.clone(),
            ide_home: ide_home.clone(),
            previous,
        };

        let first = guard
            .state
            .start(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-gradle-import".to_string(),
                generation: None,
                project_jdk_home: Some(project_jdk_home.clone()),
                server_jdk_home: None,
                gradle_import_enabled: Some(true),
                project_path: None,
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: Some(gradle.clone()),
                java_formatter_profile: None,
            }))
            .unwrap();
        assert!(first.gradle_import_enabled);
        assert!(first.gradle_settings_configured);
        let ready = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, 0, Duration::from_secs(90), |event| {
                event.generation == first.generation
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            })
        };
        guard
            .state
            .open_document(JavaLanguageDocument {
                workspace_id: "jdtls-gradle-import".to_string(),
                generation: first.generation,
                path: "src/main/java/example/GradleImportFixture.java".to_string(),
                uri: file_uri(&path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            })
            .unwrap();
        wait_for_unresolved_type_diagnostic(
            &guard.state,
            first.generation,
            ready.sequence,
            &file_uri(&path),
            "library",
            false,
        );

        let mut updated_gradle = gradle;
        updated_gradle.project_properties.remove("fixtureLibrary");
        let second = guard
            .state
            .restart(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-gradle-import".to_string(),
                generation: Some(first.generation),
                project_jdk_home: Some(project_jdk_home),
                server_jdk_home: None,
                gradle_import_enabled: Some(true),
                project_path: None,
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: Some(updated_gradle),
                java_formatter_profile: None,
            }))
            .unwrap();
        assert!(second.gradle_settings_configured);
        let ready = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, ready.sequence, Duration::from_secs(90), |event| {
                event.generation == second.generation
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            })
        };
        guard
            .state
            .open_document(JavaLanguageDocument {
                workspace_id: "jdtls-gradle-import".to_string(),
                generation: second.generation,
                path: "src/main/java/example/GradleImportFixture.java".to_string(),
                uri: file_uri(&path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            })
            .unwrap();
        wait_for_unresolved_type_diagnostic(
            &guard.state,
            second.generation,
            ready.sequence,
            &file_uri(&path),
            "library",
            true,
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
    }

    #[test]
    #[ignore = "requires managed JDT LS and IDE_JDTLS_PROJECT_JDK_21/25/27 full JDK installations"]
    fn managed_jdtls_real_project_jdk_switch_preserves_unsaved_document() {
        qualify_jdtls_project_sdk_switch(false);
    }

    #[test]
    #[ignore = "requires managed JDT LS and real JDK 21/25; run with --test-threads=1"]
    fn managed_jdtls_source_target_and_release_use_distinct_sdk_apis() {
        qualify_jdtls_project_sdk_switch(true);
    }

    fn qualify_jdtls_project_sdk_switch(api_profiles: bool) {
        let sdk21 =
            env::var("IDE_JDTLS_PROJECT_JDK_21").expect("SDK 21 qualification path required");
        let sdk25 =
            env::var("IDE_JDTLS_PROJECT_JDK_25").expect("SDK 25 qualification path required");
        let sdk27 = if api_profiles {
            None
        } else {
            Some(env::var("IDE_JDTLS_PROJECT_JDK_27").expect("SDK 27 qualification path required"))
        };
        let server_jdk = env::var("IDE_JDTLS_SERVER_JDK").unwrap_or_else(|_| sdk25.clone());
        let server_major = probe_project_jdk(&server_jdk)
            .expect("JDT LS server runtime must be a full JDK")
            .major;
        assert!(server_major >= 25, "JDT LS 1.62 requires JDK 25 to run");
        let root = temp_dir("project-sdk-workspace");
        let ide_home = temp_dir("project-sdk-state");
        struct Cleanup {
            state: JavaLanguageServiceState,
            root: PathBuf,
            ide_home: PathBuf,
            previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.state.shutdown_all();
                for (name, value) in &self.previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.ide_home);
            }
        }
        let guard = Cleanup {
            state: JavaLanguageServiceState::default(),
            root: root.clone(),
            ide_home: ide_home.clone(),
            previous: [
                crate::workspace::WORKSPACE_ROOT_ENV,
                crate::app_config::IDE_HOME_ENV,
                "IDE_JAVA_HOME",
            ]
            .into_iter()
            .map(|name| (name, env::var_os(name)))
            .collect(),
        };
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-project-sdk"}"#,
        )
        .unwrap();
        let saved = "package example; public class SdkFixture {}\n";
        let draft = if api_profiles {
            "package example; public class SdkFixture { void run() { java.util.List.of(\"selected SDK\"); java.util.List.ideSdkQualificationMissing(); } }\n"
        } else {
            "package example; public class SdkFixture { java.lang.classfile.ClassFile value; void run() { java.lang.classfile.ClassFile.ideSdkQualificationMissing(); } }\n"
        };
        let owner_type = if api_profiles { "List" } else { "ClassFile" };
        let unavailable_api = |message: &str| {
            if api_profiles {
                message.contains("of(") && message.contains("List") && message.contains("undefined")
            } else {
                message.contains("classfile") && message.contains("cannot be resolved")
            }
        };
        let path = root.join("src/main/java/example/SdkFixture.java");
        fs::write(&path, saved).unwrap();
        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        env::set_var("IDE_JAVA_HOME", &server_jdk);
        let mut pids = Vec::new();
        let mut previous_generation = None;
        let cases = if api_profiles {
            vec![
                (&sdk25, 25, true, true),
                (&sdk21, 21, true, true),
                (&sdk25, 25, false, false),
                (&sdk21, 21, false, false),
                (&sdk25, 25, true, true),
                (&sdk21, 21, true, true),
            ]
        } else {
            vec![
                (&sdk25, 25, false, false),
                (&sdk21, 21, true, false),
                (sdk27.as_ref().unwrap(), 27, false, false),
            ]
        };
        let mut evidence = Vec::new();
        for (sdk, expected_major, expect_missing, release_eight) in cases {
            let compiler = if api_profiles {
                if release_eight {
                    "<maven.compiler.release>8</maven.compiler.release>"
                } else {
                    "<maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target>"
                }
            } else {
                "<maven.compiler.source>21</maven.compiler.source><maven.compiler.target>21</maven.compiler.target>"
            };
            let pom = format!("<project xmlns=\"http://maven.apache.org/POM/4.0.0\"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>sdk-fixture</artifactId><version>1.0.0</version><properties>{compiler}</properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>");
            fs::write(root.join("pom.xml"), &pom).unwrap();
            let start_sequence = guard
                .state
                .manager
                .lock()
                .unwrap()
                .events
                .lock()
                .unwrap()
                .next_sequence;
            let request = JavaLanguageSessionRequest {
                workspace_id: "jdtls-project-sdk".to_string(),
                generation: None,
                project_jdk_home: Some(sdk.clone()),
                server_jdk_home: None,
                gradle_import_enabled: Some(false),
                project_path: Some(String::new()),
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: None,
                java_formatter_profile: None,
            };
            let initialized = guard.state.start(Some(request)).unwrap();
            assert_eq!(initialized.project_jdk_home.as_deref(), Some(sdk.as_str()));
            assert_eq!(
                probe_project_jdk(sdk).unwrap().major,
                expected_major,
                "qualification JDK path has the wrong major version"
            );
            assert!(
                initialized
                    .project_jdk_version
                    .as_deref()
                    .is_some_and(|version| version.contains(&expected_major.to_string())),
                "{initialized:?}"
            );
            assert_eq!(
                initialized.java_executable.as_deref(),
                Some(
                    probe_java(
                        &Path::new(&server_jdk).join("bin/java"),
                        &Path::new(&server_jdk).join("bin/javac")
                    )
                    .unwrap()
                    .executable
                    .to_str()
                    .unwrap()
                )
            );
            if let Some(previous) = previous_generation {
                assert!(initialized.generation > previous);
            }
            let after = {
                let manager = guard.state.manager.lock().unwrap();
                pids.push(manager.session.as_ref().unwrap().child.lock().unwrap().id());
                wait_for_matching_event(
                    &manager,
                    start_sequence,
                    Duration::from_secs(60),
                    |event| {
                        event.generation == initialized.generation
                            && event
                                .payload
                                .pointer("/params/type")
                                .and_then(Value::as_str)
                                == Some("ServiceReady")
                    },
                );
                let sequence = manager.events.lock().unwrap().next_sequence;
                sequence
            };
            let imported_settings = {
                let manager = guard.state.manager.lock().unwrap();
                execute_jdtls_command(
                    manager.session.as_ref().unwrap(),
                    "java.project.getSettings",
                    json!([
                        file_uri(&root),
                        [
                            "org.eclipse.jdt.core.compiler.source",
                            "org.eclipse.jdt.core.compiler.compliance",
                            "org.eclipse.jdt.core.compiler.codegen.targetPlatform",
                            "org.eclipse.jdt.core.compiler.release",
                            "org.eclipse.jdt.ls.core.natureIds",
                            "org.eclipse.jdt.ls.core.vm.location",
                            "org.eclipse.jdt.ls.core.classpathEntries"
                        ]
                    ]),
                    Instant::now() + Duration::from_secs(10),
                )
                .unwrap()
            };
            guard
                .state
                .open_document(JavaLanguageDocument {
                    workspace_id: "jdtls-project-sdk".to_string(),
                    generation: initialized.generation,
                    path: "src/main/java/example/SdkFixture.java".to_string(),
                    uri: file_uri(&path),
                    version: 1,
                    language_id: Some("java".to_string()),
                    text: Some(draft.to_string()),
                })
                .unwrap();
            let document_settings = {
                let manager = guard.state.manager.lock().unwrap();
                execute_jdtls_command(
                    manager.session.as_ref().unwrap(),
                    "java.project.getSettings",
                    json!([
                        file_uri(&path),
                        [
                            "org.eclipse.jdt.core.compiler.source",
                            "org.eclipse.jdt.core.compiler.compliance",
                            "org.eclipse.jdt.core.compiler.codegen.targetPlatform",
                            "org.eclipse.jdt.core.compiler.release",
                            "org.eclipse.jdt.ls.core.natureIds",
                            "org.eclipse.jdt.ls.core.vm.location",
                            "org.eclipse.jdt.ls.core.classpathEntries"
                        ]
                    ]),
                    Instant::now() + Duration::from_secs(10),
                )
                .unwrap()
            };
            for key in [
                "org.eclipse.jdt.core.compiler.source",
                "org.eclipse.jdt.core.compiler.compliance",
                "org.eclipse.jdt.core.compiler.codegen.targetPlatform",
                "org.eclipse.jdt.core.compiler.release",
                "org.eclipse.jdt.ls.core.natureIds",
                "org.eclipse.jdt.ls.core.vm.location",
            ] {
                assert_eq!(
                    document_settings[key], imported_settings[key],
                    "Document and project disagree on {key}"
                );
            }
            if let Some(output) = env::var_os("IDE_JDTLS_SDK_API_EVIDENCE") {
                let mut stages = evidence.clone();
                stages.push(json!({"sdk":expected_major,"releaseEight":release_eight,
                    "generation":initialized.generation,"importedSettings":imported_settings,
                    "documentSettings":document_settings,"awaitingDiagnostics":true}));
                fs::write(
                    output,
                    serde_json::to_vec_pretty(&json!({"cases":stages,"complete":false})).unwrap(),
                )
                .unwrap();
            }
            let diagnostic = {
                let manager = guard.state.manager.lock().unwrap();
                wait_for_matching_event(&manager, after, Duration::from_secs(60), |event| {
                    event.generation == initialized.generation
                        && event.kind == "diagnostics"
                        && event.payload.pointer("/params/uri").and_then(Value::as_str)
                            == Some(file_uri(&path).as_str())
                        && matches!(
                            event
                                .payload
                                .pointer("/params/version")
                                .and_then(Value::as_u64),
                            None | Some(1)
                        )
                        && event
                            .payload
                            .pointer("/params/diagnostics")
                            .and_then(Value::as_array)
                            .is_some_and(|items| {
                                items.iter().any(|item| {
                                    let message =
                                        item.get("message").and_then(Value::as_str).unwrap_or("");
                                    item.get("severity").and_then(Value::as_u64) == Some(1)
                                        && if expect_missing {
                                            unavailable_api(message)
                                        } else {
                                            message.contains("ideSdkQualificationMissing")
                                                && message.contains(owner_type)
                                                && message.contains("undefined")
                                        }
                                })
                            })
                })
            };
            let errors: Vec<_> = diagnostic
                .payload
                .pointer("/params/diagnostics")
                .and_then(Value::as_array)
                .unwrap()
                .iter()
                .filter(|item| item.get("severity").and_then(Value::as_u64) == Some(1))
                .collect();
            if expect_missing {
                assert!(
                    errors.iter().any(|item| item
                        .get("message")
                        .and_then(Value::as_str)
                        .is_some_and(unavailable_api)),
                    "{diagnostic:?}"
                );
            } else {
                assert_eq!(errors.len(), 1, "{diagnostic:?}");
                let message = errors[0].get("message").and_then(Value::as_str).unwrap();
                assert!(
                    message.contains("ideSdkQualificationMissing")
                        && message.contains(owner_type)
                        && message.contains("undefined"),
                    "{diagnostic:?}"
                );
            }
            assert_eq!(fs::read_to_string(&path).unwrap(), saved);
            if let Some(previous) = previous_generation {
                assert!(guard
                    .state
                    .stop(Some(JavaLanguageSessionRequest {
                        workspace_id: "jdtls-project-sdk".to_string(),
                        generation: Some(previous),
                        project_jdk_home: None,
                        server_jdk_home: None,
                        gradle_import_enabled: None,
                        project_path: None,
                        maven_repository: None,
                        active_maven_profiles: None,
                        inactive_maven_profiles: None,
                        gradle: None,
                        java_formatter_profile: None,
                    }))
                    .is_err());
                assert_eq!(
                    guard.state.service_status().unwrap().generation,
                    initialized.generation
                );
                assert!(guard
                    .state
                    .change_document(JavaLanguageDocument {
                        workspace_id: "jdtls-project-sdk".to_string(),
                        generation: previous,
                        path: "src/main/java/example/SdkFixture.java".to_string(),
                        uri: file_uri(&path),
                        version: 2,
                        language_id: Some("java".to_string()),
                        text: Some("stale draft".to_string()),
                    })
                    .is_err());
            }
            assert_eq!(fs::read_to_string(root.join("pom.xml")).unwrap(), pom);
            evidence.push(json!({"sdk":expected_major,"releaseEight":release_eight,
                "generation":initialized.generation,"importedSettings":imported_settings,"documentSettings":document_settings,"diagnostics":diagnostic.payload}));
            previous_generation = Some(initialized.generation);
        }
        guard
            .state
            .stop(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-project-sdk".to_string(),
                generation: previous_generation,
                project_jdk_home: None,
                server_jdk_home: None,
                gradle_import_enabled: None,
                project_path: None,
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: None,
                java_formatter_profile: None,
            }))
            .unwrap();
        #[cfg(target_os = "linux")]
        for pid in pids {
            assert!(!Path::new(&format!("/proc/{pid}")).exists());
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), saved);
        if let Some(output) = env::var_os("IDE_JDTLS_SDK_API_EVIDENCE") {
            fs::write(
                output,
                serde_json::to_vec_pretty(&json!({"serverJdk":server_major,
                "cases":evidence,"sourceTargetApiMatrix":api_profiles,"inputsPreserved":true,
                "staleGenerationRejected":true,"processesExited":true}))
                .unwrap(),
            )
            .unwrap();
        }
        println!(
            "REAL_JDTLS_PROJECT_SDK_EVIDENCE={}",
            json!({
                "serverJdk": server_major,
                "cases": evidence,
                "sourceTargetApiMatrix": api_profiles,
                "apiAvailabilityChanged": true,
                "unsavedTextPreserved": true,
                "staleGenerationRejected": true,
                "processLeak": false
            })
        );
    }
    #[test]
    #[ignore = "requires managed JDT LS 1.63, JDK 27 and Maven project import support"]
    fn managed_jdtls_imports_java27_preview_source_level() {
        let project_jdk =
            env::var("IDE_JDTLS_PROJECT_JDK_27").expect("JDK 27 qualification path required");
        let server_jdk = env::var("IDE_JDTLS_SERVER_JDK")
            .expect("JDT LS server JDK qualification path required");
        assert_eq!(
            probe_project_jdk(&project_jdk).unwrap().major,
            27,
            "qualification JDK path must be JDK 27"
        );
        assert!(
            probe_project_jdk(&server_jdk).unwrap().major >= 25,
            "JDT LS 1.63 requires JDK 25 or newer to run"
        );
        let jdtls = discover_jdtls().expect("managed JDT LS installation required");
        assert_eq!(jdtls.version.as_deref(), Some("1.63.0-202610191322"));

        let root = temp_dir("java27-source-workspace");
        let ide_home = temp_dir("java27-source-state");
        let path = root.join("src/main/java/example/PreviewFixture.java");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-java27-source"}"#,
        )
        .unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>java27-preview-fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>27</maven.compiler.release></properties>
  <build><plugins><plugin>
    <groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version>
    <configuration><release>27</release><enablePreview>true</enablePreview></configuration>
  </plugin></plugins></build>
</project>"#,
        )
        .unwrap();
        let source = concat!(
            "package example;\n",
            "public final class PreviewFixture {\n",
            "  static int classify(int value) {\n",
            "    return switch (value) {\n",
            "      case int matched -> matched;\n",
            "    };\n",
            "  }\n",
            "}\n",
        );
        fs::write(&path, source).unwrap();
        fs::create_dir_all(root.join("target/preview-validation")).unwrap();

        let compiler_output = Command::new(
            Path::new(&project_jdk)
                .join("bin")
                .join(executable_name("javac")),
        )
        .arg("--enable-preview")
        .arg("--release")
        .arg("27")
        .arg("-d")
        .arg(root.join("target/preview-validation"))
        .arg(&path)
        .output()
        .expect("run the selected JDK 27 compiler");
        assert!(
            compiler_output.status.success(),
            "JDK 27 must accept the preview fixture; stdout={} stderr={}",
            String::from_utf8_lossy(&compiler_output.stdout),
            String::from_utf8_lossy(&compiler_output.stderr)
        );

        let previous = [
            crate::workspace::WORKSPACE_ROOT_ENV,
            crate::app_config::IDE_HOME_ENV,
            "IDE_JAVA_HOME",
        ]
        .into_iter()
        .map(|name| (name, env::var_os(name)))
        .collect();
        struct Cleanup {
            state: JavaLanguageServiceState,
            root: PathBuf,
            ide_home: PathBuf,
            previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.state.shutdown_all();
                for (name, value) in &self.previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.ide_home);
            }
        }
        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        env::set_var("IDE_JAVA_HOME", &server_jdk);
        let guard = Cleanup {
            state: JavaLanguageServiceState::default(),
            root: root.clone(),
            ide_home,
            previous,
        };
        let initialized = guard
            .state
            .start(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-java27-source".to_string(),
                generation: None,
                project_jdk_home: Some(project_jdk.clone()),
                server_jdk_home: None,
                gradle_import_enabled: Some(false),
                project_path: Some(String::new()),
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: None,
                java_formatter_profile: None,
            }))
            .unwrap();
        assert_eq!(
            initialized.project_jdk_home.as_deref(),
            Some(project_jdk.as_str())
        );
        assert!(initialized
            .project_jdk_version
            .as_deref()
            .is_some_and(|version| version.contains("27")));
        assert_eq!(
            initialized.jdtls_version.as_deref(),
            Some("1.63.0-202610191322"),
            "qualify the pinned JDT LS build"
        );
        let ready = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, 0, Duration::from_secs(90), |event| {
                event.generation == initialized.generation
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            })
        };
        let project_settings = wait_for_imported_java_project_settings(
            &guard.state,
            &root,
            MAVEN_NATURE_ID,
            Duration::from_secs(90),
        );
        assert_eq!(
            project_settings
                .get("org.eclipse.jdt.core.compiler.source")
                .and_then(Value::as_str),
            Some("27"),
            "Maven import must select Java 27 source level: {project_settings}"
        );
        assert_eq!(
            project_settings
                .get("org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures")
                .and_then(Value::as_str),
            Some("enabled"),
            "Maven import must enable Java 27 preview features: {project_settings}"
        );
        guard
            .state
            .open_document(JavaLanguageDocument {
                workspace_id: "jdtls-java27-source".to_string(),
                generation: initialized.generation,
                path: "src/main/java/example/PreviewFixture.java".to_string(),
                uri: file_uri(&path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            })
            .unwrap();
        let diagnostic = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, ready.sequence, Duration::from_secs(90), |event| {
                event.generation == initialized.generation
                    && event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(file_uri(&path).as_str())
                    && matches!(
                        event
                            .payload
                            .pointer("/params/version")
                            .and_then(Value::as_u64),
                        None | Some(1)
                    )
            })
        };
        let errors: Vec<_> = diagnostic
            .payload
            .pointer("/params/diagnostics")
            .and_then(Value::as_array)
            .expect("JDT LS diagnostics must be an array")
            .iter()
            .filter(|item| item.get("severity").and_then(Value::as_u64) == Some(1))
            .collect();
        assert!(
            errors.is_empty(),
            "Java 27 preview source errors: {errors:?}"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
        #[cfg(target_os = "linux")]
        let pid = {
            let manager = guard.state.manager.lock().unwrap();
            let pid = manager.session.as_ref().unwrap().child.lock().unwrap().id();
            pid
        };
        guard
            .state
            .stop(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-java27-source".to_string(),
                generation: Some(initialized.generation),
                project_jdk_home: None,
                server_jdk_home: None,
                gradle_import_enabled: None,
                project_path: None,
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: None,
                java_formatter_profile: None,
            }))
            .unwrap();
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
        println!(
            "REAL_JDTLS_JAVA27_SOURCE_EVIDENCE={}",
            json!({
                "serverJdk": probe_project_jdk(&server_jdk).unwrap().major,
                "projectJdk": 27,
                "mavenRelease": 27,
                "previewSyntax": "primitive type pattern in switch",
                "importedMavenSettings": project_settings,
                "compileErrors": errors.len(),
                "sourcePreserved": true,
                "serverProcessStopped": cfg!(target_os = "linux")
            })
        );
    }

    #[test]
    #[ignore = "opt-in characterization of the current Gradle/JDT LS preview mismatch"]
    fn managed_jdtls_reports_gradle_java27_preview_import_mismatch() {
        let project_jdk =
            env::var("IDE_JDTLS_PROJECT_JDK_27").expect("JDK 27 qualification path required");
        let server_jdk = env::var("IDE_JDTLS_SERVER_JDK")
            .expect("JDT LS server JDK qualification path required");
        let gradle_executable = env::var("IDE_JDTLS_GRADLE_EXECUTABLE")
            .expect("Gradle 9.8.1 qualification executable required");
        let gradle_version = env::var("IDE_JDTLS_GRADLE_VERSION")
            .expect("Gradle version qualification value required");
        assert_eq!(probe_project_jdk(&project_jdk).unwrap().major, 27);
        assert!(probe_project_jdk(&server_jdk).unwrap().major >= 25);
        assert_eq!(gradle_version, "9.8.1");
        let jdtls = discover_jdtls().expect("managed JDT LS installation required");
        assert_eq!(jdtls.version.as_deref(), Some("1.63.0-202610191322"));

        let root = temp_dir("gradle-java27-source-workspace");
        let ide_home = temp_dir("gradle-java27-source-state");
        let gradle_user_home = temp_dir("gradle-java27-user-home");
        let previous = [
            crate::workspace::WORKSPACE_ROOT_ENV,
            crate::app_config::IDE_HOME_ENV,
            "IDE_JAVA_HOME",
            "GRADLE_USER_HOME",
        ]
        .into_iter()
        .map(|name| (name, env::var_os(name)))
        .collect();
        struct Cleanup {
            state: JavaLanguageServiceState,
            root: PathBuf,
            ide_home: PathBuf,
            gradle_user_home: PathBuf,
            previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                self.state.shutdown_all();
                for (name, value) in &self.previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.ide_home);
                let _ = fs::remove_dir_all(&self.gradle_user_home);
            }
        }
        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        env::set_var("IDE_JAVA_HOME", &server_jdk);
        env::set_var("GRADLE_USER_HOME", &gradle_user_home);
        let guard = Cleanup {
            state: JavaLanguageServiceState::default(),
            root: root.clone(),
            ide_home: ide_home.clone(),
            gradle_user_home: gradle_user_home.clone(),
            previous,
        };
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-gradle-java27-source"}"#,
        )
        .unwrap();
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name = 'gradle-java27-preview-fixture'\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
        fs::write(
            root.join("build.gradle"),
            "plugins { id 'java' }\n\
java { sourceCompatibility = JavaVersion.toVersion(27); targetCompatibility = JavaVersion.toVersion(27) }\n\
tasks.withType(JavaCompile).configureEach { options.release = 27; options.compilerArgs.add('--enable-preview') }\n",
        )
        .unwrap();
        let source = concat!(
            "package example;\n",
            "public final class PreviewFixture {\n",
            "  static int classify(int value) {\n",
            "    return switch (value) {\n",
            "      case int matched -> matched;\n",
            "    };\n",
            "  }\n",
            "}\n",
        );
        let path = root.join("src/main/java/example/PreviewFixture.java");
        fs::write(&path, source).unwrap();
        fs::create_dir_all(root.join("build/classes/java/main")).unwrap();
        let compiler_output = Command::new(
            Path::new(&project_jdk)
                .join("bin")
                .join(executable_name("javac")),
        )
        .arg("--enable-preview")
        .arg("--release")
        .arg("27")
        .arg("-d")
        .arg(root.join("build/classes/java/main"))
        .arg(&path)
        .output()
        .expect("run the selected JDK 27 compiler");
        assert!(
            compiler_output.status.success(),
            "JDK 27 must accept the preview fixture; stdout={} stderr={}",
            String::from_utf8_lossy(&compiler_output.stdout),
            String::from_utf8_lossy(&compiler_output.stderr)
        );

        let version_output = Command::new(&gradle_executable)
            .arg("--version")
            .env("JAVA_HOME", &project_jdk)
            .env("GRADLE_USER_HOME", &gradle_user_home)
            .output()
            .expect("run the selected Gradle installation");
        assert!(
            version_output.status.success(),
            "Gradle 9.8.1 must run on JDK 27: {}",
            String::from_utf8_lossy(&version_output.stderr)
        );
        let version_text = String::from_utf8_lossy(&version_output.stdout);
        assert!(version_text.contains("Gradle 9.8.1"), "{version_text}");
        assert!(version_text.contains("Launcher JVM:  27"), "{version_text}");

        let build_output = Command::new(&gradle_executable)
            .args(["--offline", "--no-daemon", "clean", "compileJava"])
            .current_dir(&root)
            .env("JAVA_HOME", &project_jdk)
            .env("GRADLE_USER_HOME", &gradle_user_home)
            .output()
            .expect("compile the Java 27 Gradle fixture");
        assert!(
            build_output.status.success(),
            "Gradle must compile the Java 27 preview fixture: stdout={} stderr={}",
            String::from_utf8_lossy(&build_output.stdout),
            String::from_utf8_lossy(&build_output.stderr)
        );

        let gradle = JavaLanguageGradleSettings {
            executable: gradle_executable,
            user_home: guard.gradle_user_home.to_string_lossy().into_owned(),
            gradle_runtime_home: None,
            project_properties: BTreeMap::new(),
        };
        let initialized = guard
            .state
            .start(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-gradle-java27-source".to_string(),
                generation: None,
                project_jdk_home: Some(project_jdk.clone()),
                server_jdk_home: None,
                gradle_import_enabled: Some(true),
                project_path: None,
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: Some(gradle),
                java_formatter_profile: None,
            }))
            .unwrap();
        assert!(initialized.gradle_import_enabled);
        assert!(initialized.gradle_settings_configured);
        assert_eq!(
            initialized.project_jdk_home.as_deref(),
            Some(project_jdk.as_str())
        );
        assert_eq!(
            initialized.jdtls_version.as_deref(),
            Some("1.63.0-202610191322")
        );
        let ready = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, 0, Duration::from_secs(90), |event| {
                event.generation == initialized.generation
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            })
        };
        let project_settings = wait_for_imported_java_project_settings(
            &guard.state,
            &root,
            GRADLE_NATURE_ID,
            Duration::from_secs(90),
        );
        assert_eq!(
            project_settings
                .get("org.eclipse.jdt.core.compiler.source")
                .and_then(Value::as_str),
            Some("27"),
            "Gradle import must select Java 27 source level: {project_settings}"
        );
        assert_eq!(
            project_settings
                .get("org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures")
                .and_then(Value::as_str),
            Some("disabled"),
            "characterize the Buildship preview setting: {project_settings}"
        );
        guard
            .state
            .open_document(JavaLanguageDocument {
                workspace_id: "jdtls-gradle-java27-source".to_string(),
                generation: initialized.generation,
                path: "src/main/java/example/PreviewFixture.java".to_string(),
                uri: file_uri(&path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(source.to_string()),
            })
            .unwrap();
        let diagnostic = {
            let manager = guard.state.manager.lock().unwrap();
            wait_for_matching_event(&manager, ready.sequence, Duration::from_secs(90), |event| {
                event.generation == initialized.generation
                    && event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(file_uri(&path).as_str())
                    && matches!(
                        event
                            .payload
                            .pointer("/params/version")
                            .and_then(Value::as_u64),
                        None | Some(1)
                    )
            })
        };
        let errors: Vec<_> = diagnostic
            .payload
            .pointer("/params/diagnostics")
            .and_then(Value::as_array)
            .expect("JDT LS diagnostics must be an array")
            .iter()
            .filter(|item| item.get("severity").and_then(Value::as_u64) == Some(1))
            .collect();
        assert!(
            !errors.is_empty(),
            "JDT LS should surface the mismatch while Gradle preview is disabled"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
        #[cfg(target_os = "linux")]
        let pid = {
            let manager = guard.state.manager.lock().unwrap();
            let pid = manager.session.as_ref().unwrap().child.lock().unwrap().id();
            pid
        };
        guard
            .state
            .stop(Some(JavaLanguageSessionRequest {
                workspace_id: "jdtls-gradle-java27-source".to_string(),
                generation: Some(initialized.generation),
                project_jdk_home: None,
                server_jdk_home: None,
                gradle_import_enabled: None,
                project_path: None,
                maven_repository: None,
                active_maven_profiles: None,
                inactive_maven_profiles: None,
                gradle: None,
                java_formatter_profile: None,
            }))
            .unwrap();
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
        println!(
            "REAL_JDTLS_GRADLE_JAVA27_SOURCE_EVIDENCE={}",
            json!({
                "gradleVersion": gradle_version,
                "projectJdk": 27,
                "serverJdk": probe_project_jdk(&server_jdk).unwrap().major,
                "importedGradleSettings": project_settings,
                "previewFixtureBuilds": true,
                "compileErrors": errors.len(),
                "previewImportMismatch": true,
                "serverProcessStopped": cfg!(target_os = "linux"),
                "sourcePreserved": true
            })
        );
    }

    #[test]
    #[ignore = "requires the checksum-verified managed JDT LS installation and a full JDK"]
    fn managed_jdtls_real_semantic_completion_hover_and_signature_smoke() {
        let root = temp_dir("real-semantic-workspace");
        let ide_home = temp_dir("real-semantic-state");
        let java_path = root.join("src/main/java/example/SemanticFixture.java");
        let companion_path = root.join("src/main/java/example/SemanticUse.java");
        fs::create_dir_all(java_path.parent().unwrap()).unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>semantic-fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release></properties>
</project>"#,
        )
        .unwrap();
        fs::create_dir_all(root.join(".settings")).unwrap();
        fs::write(
            root.join(".settings/org.eclipse.jdt.core.prefs"),
            concat!(
                "eclipse.preferences.version=1\n",
                "org.eclipse.jdt.core.formatter.brace_position_for_type_declaration=next_line\n",
                "org.eclipse.jdt.core.formatter.brace_position_for_method_declaration=next_line\n",
                "org.eclipse.jdt.core.formatter.tabulation.char=space\n",
                "org.eclipse.jdt.core.formatter.tabulation.size=3\n",
                "org.eclipse.jdt.core.formatter.indentation.size=3\n",
            ),
        )
        .unwrap();
        let source = concat!(
            "package example;\n",
            "public final class SemanticFixture {\n",
            "  private String displayName;\n",
            "  List<String> values; private TextDelegate textDelegate = new TextDelegate();\n",
            "  static String helper(String value, int count) { return value.repeat(count); }\n",
            "  void run() {\n",
            "    String text = \"hello\";\n",
            "    text.substring(0);\n",
            "    helper(text, 2);\n",
            "    Object candidate = text;\n",
            "    if (candidate instanceof String) {\n",
            "      String duplicate = (String) candidate;\n",
            "    }\n",
            "  }\n",
            "}\n",
            "abstract class LabelContract { abstract String label(); }\n",
            "class Incomplete extends LabelContract {} class TextDelegate { public String format(String value) { return value; } }\n",
        );
        let companion_source = concat!(
            "package example;\n",
            "final class SemanticUse {\n",
            "  String value() { return SemanticFixture.helper(\"world\", 2); }\n",
            "}\n",
        );
        fs::write(&java_path, source).unwrap();
        fs::write(&companion_path, companion_source).unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-real-semantic"}"#,
        )
        .unwrap();

        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        let mut manager = Manager::default();
        let discovery = status(&manager).unwrap();
        if !discovery.available {
            eprintln!("skipping real semantic smoke: managed JDT LS unavailable");
            env::remove_var(crate::workspace::WORKSPACE_ROOT_ENV);
            env::remove_var(crate::app_config::IDE_HOME_ENV);
            fs::remove_dir_all(&root).unwrap();
            fs::remove_dir_all(&ide_home).unwrap();
            return;
        }

        start_session(
            &mut manager,
            Duration::from_secs(60),
            None,
            None,
            false,
            "",
            "",
            &[],
            &[],
            None,
            None,
            &[],
            false,
        )
        .unwrap();
        let initialized = status(&manager).unwrap();
        assert!(initialized
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| {
                capabilities.document_sync
                    && capabilities.completion
                    && capabilities.hover
                    && capabilities.document_symbols
                    && capabilities.document_highlights
                    && capabilities.workspace_symbols
                    && capabilities.call_hierarchy
                    && capabilities.semantic_tokens
                    && capabilities.inlay_hints
                    && capabilities.code_actions
                    && capabilities.formatting
                    && capabilities.range_formatting
                    && capabilities.rename
                    && capabilities.signature_help
            }));
        wait_for_matching_event(&manager, 0, Duration::from_secs(60), |event| {
            event.payload.get("method").and_then(Value::as_str) == Some("language/status")
                && event
                    .payload
                    .pointer("/params/type")
                    .and_then(Value::as_str)
                    == Some("ServiceReady")
        });

        let uri = file_uri(&java_path);
        let pid = lock(
            &manager.session.as_ref().unwrap().child,
            "real semantic JDT LS process",
        )
        .unwrap()
        .id();
        let open_document = JavaLanguageDocument {
            workspace_id: "jdtls-real-semantic".to_string(),
            generation: initialized.generation,
            path: "src/main/java/example/SemanticFixture.java".to_string(),
            uri: uri.clone(),
            version: 1,
            language_id: Some("java".to_string()),
            text: Some(source.to_string()),
        };
        sync_document(&mut manager, SyncAction::Open, open_document.clone()).unwrap();
        sync_document(&mut manager, SyncAction::Open, open_document.clone()).unwrap();
        for conflicting in [
            JavaLanguageDocument {
                version: 2,
                ..open_document.clone()
            },
            JavaLanguageDocument {
                text: Some("class Different {}".to_string()),
                ..open_document
            },
        ] {
            assert_eq!(
                sync_document(&mut manager, SyncAction::Open, conflicting).unwrap_err(),
                "Document is already open in the current session"
            );
        }
        sync_document(
            &mut manager,
            SyncAction::Open,
            JavaLanguageDocument {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                path: "src/main/java/example/SemanticUse.java".to_string(),
                uri: file_uri(&companion_path),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(companion_source.to_string()),
            },
        )
        .unwrap();
        let state = JavaLanguageServiceState::new(manager);

        let request =
            |position: JavaSemanticPosition,
             request_id: String,
             cancellation_id: String,
             trigger: Option<JavaCompletionTriggerContext>| JavaSemanticRequest {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                document: JavaSemanticDocumentTarget {
                    path: "src/main/java/example/SemanticFixture.java".to_string(),
                    uri: uri.clone(),
                    version: 1,
                },
                position,
                request_id,
                cancellation_id,
                trigger,
                range: None,
                diagnostics: None,
                new_name: None,
                formatting_options: None,
                formatting_character: None,
                generation_selection: None,
                include_declaration: None,
            };
        let assert_metadata = |response: &JavaSemanticNativeResponse, request_id: &str| {
            assert_eq!(response.provider, "jdtls");
            assert_eq!(response.provider_version, initialized.jdtls_version);
            assert_eq!(response.workspace_id, "jdtls-real-semantic");
            assert_eq!(response.generation, initialized.generation);
            assert_eq!(response.path, "src/main/java/example/SemanticFixture.java");
            assert_eq!(response.uri, uri);
            assert_eq!(response.version, 1);
            assert_eq!(response.request_id, request_id);
            assert!(!response.cancelled && !response.timeout, "{response:?}");
        };

        let call_hierarchy = |position: JavaSemanticPosition,
                              request_id: &str,
                              direction: JavaCallHierarchyDirection| {
            state
                .request_call_hierarchy(JavaCallHierarchyRequest {
                    workspace_id: "jdtls-real-semantic".to_string(),
                    generation: initialized.generation,
                    document: JavaSemanticDocumentTarget {
                        path: "src/main/java/example/SemanticFixture.java".to_string(),
                        uri: uri.clone(),
                        version: 1,
                    },
                    position,
                    request_id: request_id.to_string(),
                    cancellation_id: format!("{request_id}-cancel"),
                    direction,
                })
                .unwrap()
        };
        let incoming_calls = call_hierarchy(
            JavaSemanticPosition {
                line: 4,
                character: 18,
            },
            "real-call-hierarchy-incoming",
            JavaCallHierarchyDirection::Incoming,
        );
        assert_metadata(&incoming_calls, "real-call-hierarchy-incoming");
        let incoming_entries = incoming_calls
            .result
            .as_ref()
            .and_then(|result| result.get("entries"))
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("incoming call hierarchy missing: {incoming_calls:?}"));
        assert!(
            incoming_entries.iter().any(|entry| {
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.starts_with("value("))
                    && entry.pointer("/location/path").and_then(Value::as_str)
                        == Some("src/main/java/example/SemanticUse.java")
                    && entry.pointer("/callSites/0/path").and_then(Value::as_str)
                        == Some("src/main/java/example/SemanticUse.java")
            }),
            "JDT LS should find the workspace caller and its call site: {incoming_entries:?}"
        );
        let outgoing_calls = call_hierarchy(
            JavaSemanticPosition {
                line: 5,
                character: 8,
            },
            "real-call-hierarchy-outgoing",
            JavaCallHierarchyDirection::Outgoing,
        );
        assert_metadata(&outgoing_calls, "real-call-hierarchy-outgoing");
        assert!(
            outgoing_calls
                .result
                .as_ref()
                .and_then(|result| result.get("entries"))
                .and_then(Value::as_array)
                .is_some_and(|entries| entries.iter().any(|entry| entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.starts_with("helper(")))),
            "JDT LS should find the helper callee in the current method: {outgoing_calls:?}"
        );

        let mut formatting_request = request(
            JavaSemanticPosition {
                line: 0,
                character: 0,
            },
            "real-document-formatting".to_string(),
            "real-document-formatting-cancel".to_string(),
            None,
        );
        formatting_request.formatting_options = Some(JavaFormattingOptions {
            tab_size: 4,
            insert_spaces: true,
        });
        let formatting = state.request_formatting(formatting_request).unwrap();
        assert_metadata(&formatting, "real-document-formatting");
        assert!(
            formatting
                .result
                .as_ref()
                .and_then(|result| result.get("edits"))
                .and_then(Value::as_array)
                .is_some_and(|edits| !edits.is_empty()),
            "JDT LS returned no formatting edits for the intentionally unformatted fixture: {formatting:?}"
        );
        let class_brace_space = source.lines().nth(1).unwrap().find(" {").unwrap();
        assert!(
            formatting
                .result
                .as_ref()
                .and_then(|result| result.get("edits"))
                .and_then(Value::as_array)
                .is_some_and(|edits| edits.iter().any(|edit| {
                    edit.pointer("/range/start/line") == Some(&json!(1))
                        && edit.pointer("/range/start/character") == Some(&json!(class_brace_space))
                        && edit.pointer("/range/end/character")
                            == Some(&json!(class_brace_space + 1))
                        && edit.get("newText").and_then(Value::as_str) == Some("\n")
                })),
            "JDT LS did not apply the project formatter's next-line type-brace preference: {formatting:?}"
        );
        assert!(
            formatting
                .result
                .as_ref()
                .and_then(|result| result.get("edits"))
                .and_then(Value::as_array)
                .is_some_and(|edits| edits.iter().any(|edit| {
                    edit.pointer("/range/start/line") == Some(&json!(1))
                        && edit.pointer("/range/end/line") == Some(&json!(2))
                        && edit.get("newText").and_then(Value::as_str) == Some("\n    ")
                })),
            "JDT LS did not use the editor's four-space indentation over the project's three-space preference: {formatting:?}"
        );

        let helper_line = source.lines().nth(4).unwrap();
        let mut range_formatting_request = request(
            JavaSemanticPosition {
                line: 4,
                character: 0,
            },
            "real-range-formatting".to_string(),
            "real-range-formatting-cancel".to_string(),
            None,
        );
        range_formatting_request.formatting_options = Some(JavaFormattingOptions {
            tab_size: 4,
            insert_spaces: true,
        });
        range_formatting_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 4,
                character: 0,
            },
            end: JavaSemanticPosition {
                line: 4,
                character: helper_line.encode_utf16().count() as u32,
            },
        });
        let range_formatting = state.request_formatting(range_formatting_request).unwrap();
        assert_metadata(&range_formatting, "real-range-formatting");
        assert!(
            range_formatting
                .result
                .as_ref()
                .and_then(|result| result.get("edits"))
                .and_then(Value::as_array)
                .is_some_and(|edits| !edits.is_empty()),
            "JDT LS returned no range-formatting edits for the intentionally unformatted helper: {range_formatting:?}"
        );

        let advertised = status(&lock(&state.manager, "on-type formatting capability").unwrap()).unwrap();
        let triggers = &advertised.capabilities.as_ref().unwrap().on_type_formatting_triggers;
        eprintln!("JDT LS on-type formatting triggers: {triggers:?}");
        let typed_line = source.lines().nth(6).unwrap();
        let mut typed_request = request(JavaSemanticPosition { line: 6,
            character: typed_line.encode_utf16().count() as u32 },
            "real-on-type-formatting".into(), "real-on-type-formatting-cancel".into(), None);
        typed_request.formatting_options = Some(JavaFormattingOptions { tab_size: 4, insert_spaces: true });
        typed_request.formatting_character = Some(";".into());
        let typed_formatting = state.request_formatting(typed_request).unwrap();
        assert_metadata(&typed_formatting, "real-on-type-formatting");
        // The surrounding method keeps its existing two-space indentation. The
        // current statement adds the requested four spaces without editing it.
        assert_eq!(typed_formatting.result.as_ref().unwrap()["edits"], json!([{
            "range":{"start":{"line":6,"character":0},"end":{"line":6,"character":4}},
            "newText":"      "
        }]));
        let mut two_space_request = request(JavaSemanticPosition { line: 6,
            character: typed_line.encode_utf16().count() as u32 },
            "real-on-type-two-spaces".into(), "real-on-type-two-spaces-cancel".into(), None);
        two_space_request.formatting_options = Some(JavaFormattingOptions { tab_size: 2, insert_spaces: true });
        two_space_request.formatting_character = Some(";".into());
        let two_space_formatting = state.request_formatting(two_space_request).unwrap();
        assert_metadata(&two_space_formatting, "real-on-type-two-spaces");
        assert_eq!(fs::read_to_string(&java_path).unwrap(), source);
        assert_eq!(fs::read_to_string(&companion_path).unwrap(), companion_source);
        if let Some(path) = env::var_os("IDE_JAVA_ON_TYPE_EVIDENCE") {
            fs::write(path, serde_json::to_vec_pretty(&json!({"triggers":triggers,
                "response":typed_formatting,"twoSpaceResponse":two_space_formatting})).unwrap()).unwrap();
        }
        assert_eq!(two_space_formatting.result.as_ref().unwrap()["edits"], json!([]));

        let invocation_line = source.lines().nth(8).unwrap();
        let mut inlay_request = request(
            JavaSemanticPosition {
                line: 8,
                character: 0,
            },
            "real-inlay-hints".to_string(),
            "real-inlay-hints-cancel".to_string(),
            None,
        );
        inlay_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 8,
                character: 0,
            },
            end: JavaSemanticPosition {
                line: 8,
                character: invocation_line.encode_utf16().count() as u32,
            },
        });
        let inlay_hints = state.request_inlay_hints(inlay_request).unwrap();
        assert_metadata(&inlay_hints, "real-inlay-hints");
        assert!(
            inlay_hints
                .result
                .as_ref()
                .and_then(|result| result.get("hints"))
                .and_then(Value::as_array)
                .is_some_and(|hints| hints.iter().any(|hint| {
                    hint.get("label")
                        .and_then(Value::as_str)
                        .is_some_and(|label| label.contains("count"))
                })),
            "JDT LS returned no parameter-name hint for the literal argument: {inlay_hints:?}"
        );

        // Reconciliation and Maven indexing can trail ServiceReady briefly. Poll with unique
        // correlation IDs, bounded by one outer deadline and each native request timeout.
        let completion_deadline = Instant::now() + Duration::from_secs(30);
        let mut completion_attempt = 0;
        let completion = loop {
            completion_attempt += 1;
            let request_id = format!("real-completion-{completion_attempt}");
            let response = semantic_request(
                &state,
                request(
                    JavaSemanticPosition {
                        line: 7,
                        character: 9,
                    },
                    request_id.clone(),
                    format!("real-completion-cancel-{completion_attempt}"),
                    Some(JavaCompletionTriggerContext {
                        kind: "invoked".to_string(),
                        character: None,
                    }),
                ),
                SemanticKind::Completion,
                COMPLETION_TIMEOUT,
            )
            .unwrap();
            assert_metadata(&response, &request_id);
            let found = response
                .result
                .as_ref()
                .and_then(|result| result.get("items"))
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items.iter().any(|item| {
                        item.get("label")
                            .and_then(Value::as_str)
                            .is_some_and(|label| label.contains("repeat"))
                    })
                });
            if found {
                break response;
            }
            assert!(
                Instant::now() < completion_deadline,
                "completion did not contain repeat: {response:?}"
            );
            thread::sleep(Duration::from_millis(200));
        };

        let mut rename_request = request(
            JavaSemanticPosition {
                line: 6,
                character: 12,
            },
            "real-semantic-rename".to_string(),
            "real-semantic-rename-cancel".to_string(),
            None,
        );
        rename_request.new_name = Some("message".to_string());
        let rename = semantic_request(
            &state,
            rename_request,
            SemanticKind::Rename,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&rename, "real-semantic-rename");
        let rename_edits = rename
            .result
            .as_ref()
            .and_then(|result| result.get("documentEdits"))
            .and_then(Value::as_array)
            .expect("rename edits");
        assert_eq!(rename_edits.len(), 1, "{rename:?}");
        let replacement = rename_edits[0]
            .get("edits")
            .and_then(Value::as_array)
            .and_then(|edits| edits.first())
            .and_then(|edit| edit.get("newText"))
            .and_then(Value::as_str)
            .expect("rename replacement");
        for expected in [
            "message = \"hello\";",
            "message.substring(0)",
            "helper(message, 2)",
            "Object candidate = message",
        ] {
            assert!(replacement.contains(expected), "{rename:?}");
        }

        let mut cross_file_rename_request = request(
            JavaSemanticPosition {
                line: 4,
                character: 19,
            },
            "real-cross-file-rename".to_string(),
            "real-cross-file-rename-cancel".to_string(),
            None,
        );
        cross_file_rename_request.new_name = Some("renamedHelper".to_string());
        let cross_file_rename = semantic_request(
            &state,
            cross_file_rename_request,
            SemanticKind::Rename,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&cross_file_rename, "real-cross-file-rename");
        let document_edits = cross_file_rename
            .result
            .as_ref()
            .and_then(|result| result.get("documentEdits"))
            .and_then(Value::as_array)
            .expect("cross-file rename document edits");
        let paths = document_edits
            .iter()
            .filter_map(|entry| entry.pointer("/document/path").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(
            paths.contains(&"src/main/java/example/SemanticFixture.java"),
            "{cross_file_rename:?}"
        );
        assert!(
            paths.contains(&"src/main/java/example/SemanticUse.java"),
            "{cross_file_rename:?}"
        );
        assert!(
            document_edits.iter().all(|entry| {
                entry.pointer("/document/version") == Some(&json!(1))
                    && entry
                        .pointer("/edits")
                        .and_then(Value::as_array)
                        .is_some_and(|edits| {
                            edits.iter().all(|edit| {
                                edit.get("newText")
                                    .and_then(Value::as_str)
                                    .is_some_and(|text| text.contains("renamedHelper"))
                            })
                        })
            }),
            "{cross_file_rename:?}"
        );

        let hover = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 8,
                    character: 6,
                },
                "real-hover".to_string(),
                "real-hover-cancel".to_string(),
                None,
            ),
            SemanticKind::Hover,
            HOVER_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&hover, "real-hover");
        let hover_text = hover
            .result
            .as_ref()
            .and_then(|result| result.get("contents"))
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(|content| content.get("value").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !hover_text.is_empty() && hover_text.contains("helper"),
            "{hover:?}"
        );

        let signature = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 7,
                    character: 19,
                },
                "real-signature".to_string(),
                "real-signature-cancel".to_string(),
                None,
            ),
            SemanticKind::SignatureHelp,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&signature, "real-signature");
        let signatures = signature
            .result
            .as_ref()
            .and_then(|result| result.get("signatures"))
            .and_then(Value::as_array)
            .unwrap();
        assert!(
            signatures.iter().any(|item| {
                item.get("label")
                    .and_then(Value::as_str)
                    .is_some_and(|label| label.contains("substring") && label.contains("int"))
                    && item
                        .get("parameters")
                        .and_then(Value::as_array)
                        .is_some_and(|parameters| !parameters.is_empty())
            }),
            "{signature:?}"
        );

        let outline = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 0,
                    character: 0,
                },
                "real-document-symbols".to_string(),
                "real-document-symbols-cancel".to_string(),
                None,
            ),
            SemanticKind::DocumentSymbols,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&outline, "real-document-symbols");
        let symbols = outline
            .result
            .as_ref()
            .and_then(|result| result.get("symbols"))
            .and_then(Value::as_array)
            .unwrap();
        let fixture = symbols
            .iter()
            .find(|symbol| symbol.get("name").and_then(Value::as_str) == Some("SemanticFixture"))
            .unwrap_or_else(|| panic!("fixture type missing from outline: {outline:?}"));
        assert!(
            fixture
                .get("children")
                .and_then(Value::as_array)
                .is_some_and(|children| children.iter().any(|symbol| symbol
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.starts_with("run(")))),
            "{fixture:?}"
        );

        let workspace_symbols = state
            .request_workspace_symbols(JavaWorkspaceSymbolsRequest {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                query: "SemanticFixture".to_string(),
                request_id: "real-workspace-symbols".to_string(),
                cancellation_id: "real-workspace-symbols-cancel".to_string(),
            })
            .unwrap();
        assert_eq!(workspace_symbols.provider, "jdtls");
        assert_eq!(workspace_symbols.workspace_id, "jdtls-real-semantic");
        assert_eq!(workspace_symbols.generation, initialized.generation);
        assert_eq!(workspace_symbols.request_id, "real-workspace-symbols");
        let workspace_matches = workspace_symbols
            .result
            .as_ref()
            .and_then(|result| result.get("symbols"))
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("workspace symbols missing: {workspace_symbols:?}"));
        assert!(
            workspace_matches.iter().any(|symbol| {
                symbol.get("name").and_then(Value::as_str) == Some("SemanticFixture")
                    && symbol.get("path").and_then(Value::as_str)
                        == Some("src/main/java/example/SemanticFixture.java")
            }),
            "{workspace_symbols:?}"
        );

        let additional_top_level_symbols = state
            .request_workspace_symbols(JavaWorkspaceSymbolsRequest {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                query: "LabelContract".to_string(),
                request_id: "real-additional-top-level-symbols".to_string(),
                cancellation_id: "real-additional-top-level-symbols-cancel".to_string(),
            })
            .unwrap();
        assert!(
            additional_top_level_symbols
                .result
                .as_ref()
                .and_then(|result| result.get("symbols"))
                .and_then(Value::as_array)
                .is_some_and(|symbols| symbols.iter().any(|symbol| symbol
                    .get("name")
                    .and_then(Value::as_str)
                    == Some("LabelContract")
                    && symbol.get("containerName").and_then(Value::as_str) == Some("example")
                    && symbol.get("path").and_then(Value::as_str)
                        == Some("src/main/java/example/SemanticFixture.java"))),
            "{additional_top_level_symbols:?}"
        );

        let document_highlights = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 7,
                    character: 5,
                },
                "real-document-highlights".to_string(),
                "real-document-highlights-cancel".to_string(),
                None,
            ),
            SemanticKind::DocumentHighlights,
            HOVER_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&document_highlights, "real-document-highlights");
        let highlighted_ranges = document_highlights
            .result
            .as_ref()
            .and_then(|result| result.get("highlights"))
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("document highlights missing: {document_highlights:?}"));
        assert!(
            highlighted_ranges.len() >= 3
                && highlighted_ranges.iter().any(|highlight| {
                    highlight
                        .pointer("/range/start/line")
                        .and_then(Value::as_u64)
                        == Some(6)
                })
                && highlighted_ranges.iter().any(|highlight| {
                    highlight
                        .pointer("/range/start/line")
                        .and_then(Value::as_u64)
                        == Some(8)
                }),
            "{document_highlights:?}"
        );

        let diagnostics_event = {
            let manager = lock(&state.manager, "real semantic diagnostics").unwrap();
            wait_for_matching_event(&manager, 0, Duration::from_secs(30), |event| {
                event.kind == "diagnostics"
                    && event.payload.get("workspaceId").and_then(Value::as_str)
                        == Some("jdtls-real-semantic")
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(uri.as_str())
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(|diagnostics| {
                            diagnostics.iter().any(|diagnostic| {
                                diagnostic
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .is_some_and(|message| message.contains("List"))
                            })
                        })
            })
        };
        let raw_diagnostic = diagnostics_event
            .payload
            .pointer("/params/diagnostics")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .find(|diagnostic| {
                diagnostic
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("List"))
            })
            .unwrap();
        let range: JavaSemanticRange =
            serde_json::from_value(raw_diagnostic.get("range").unwrap().clone()).unwrap();
        let diagnostic = JavaCodeActionDiagnostic {
            range: JavaSemanticRange {
                start: JavaSemanticPosition {
                    line: range.start.line,
                    character: range.start.character,
                },
                end: JavaSemanticPosition {
                    line: range.end.line,
                    character: range.end.character,
                },
            },
            severity: raw_diagnostic
                .get("severity")
                .and_then(Value::as_u64)
                .unwrap_or(1) as u8,
            message: raw_diagnostic
                .get("message")
                .and_then(Value::as_str)
                .unwrap()
                .to_string(),
            source: raw_diagnostic
                .get("source")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            code: raw_diagnostic.get("code").cloned(),
        };
        let mut code_action_request = request(
            JavaSemanticPosition {
                line: diagnostic.range.start.line,
                character: diagnostic.range.start.character,
            },
            "real-code-actions".to_string(),
            "real-code-actions-cancel".to_string(),
            None,
        );
        code_action_request.range = Some(diagnostic.range.clone());
        code_action_request.diagnostics = Some(vec![diagnostic]);
        let code_actions = semantic_request(
            &state,
            code_action_request,
            SemanticKind::CodeActions,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&code_actions, "real-code-actions");
        assert!(
            code_actions
                .result
                .as_ref()
                .and_then(|result| result.get("actions"))
                .and_then(Value::as_array)
                .is_some_and(|actions| actions.iter().any(|action| {
                    action
                        .get("edits")
                        .and_then(Value::as_array)
                        .is_some_and(|edits| {
                            edits.iter().any(|edit| {
                                edit.get("newText")
                                    .and_then(Value::as_str)
                                    .is_some_and(|text| text.contains("import java.util.List;"))
                            })
                        })
                })),
            "{code_actions:?}"
        );

        let mut quick_assist_request = request(
            JavaSemanticPosition {
                line: 11,
                character: 4,
            },
            "real-quick-assist".to_string(),
            "real-quick-assist-cancel".to_string(),
            None,
        );
        quick_assist_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 11,
                character: 4,
            },
            end: JavaSemanticPosition {
                line: 11,
                character: 42,
            },
        });
        quick_assist_request.diagnostics = Some(vec![]);
        let quick_assists = semantic_request(
            &state,
            quick_assist_request,
            SemanticKind::CodeActions,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&quick_assists, "real-quick-assist");
        assert!(
            quick_assists
                .result
                .as_ref()
                .and_then(|result| result.get("actions"))
                .and_then(Value::as_array)
                .is_some_and(|actions| actions.iter().any(|action| {
                    action.get("kind").and_then(Value::as_str) == Some("quickassist")
                        && action
                            .get("edits")
                            .and_then(Value::as_array)
                            .is_some_and(|edits| !edits.is_empty())
                })),
            "{quick_assists:?}"
        );

        let mut accessor_request = request(
            JavaSemanticPosition {
                line: 1,
                character: 21,
            },
            "real-source-accessors".to_string(),
            "real-source-accessors-cancel".to_string(),
            None,
        );
        accessor_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 1,
                character: 21,
            },
            end: JavaSemanticPosition {
                line: 1,
                character: 22,
            },
        });
        accessor_request.diagnostics = Some(vec![]);
        let accessors = semantic_request(
            &state,
            accessor_request,
            SemanticKind::CodeActions,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&accessors, "real-source-accessors");
        assert!(
            accessors
                .result
                .as_ref()
                .and_then(|result| result.get("actions"))
                .and_then(Value::as_array)
                .is_some_and(|actions| actions.iter().any(|action| {
                    action.get("kind").and_then(Value::as_str) == Some("source.generate.accessors")
                        && action
                            .get("edits")
                            .and_then(Value::as_array)
                            .is_some_and(|edits| {
                                edits.iter().any(|edit| {
                                    edit.get("newText")
                                        .and_then(Value::as_str)
                                        .is_some_and(|text| text.contains("getDisplayName"))
                                })
                            })
                })),
            "{accessors:?}"
        );

        let mut generation_request = request(
            JavaSemanticPosition {
                line: 1,
                character: 0,
            },
            "real-code-generation".to_string(),
            "real-code-generation-cancel".to_string(),
            None,
        );
        generation_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 1,
                character: 0,
            },
            end: JavaSemanticPosition {
                line: 1,
                character: 36,
            },
        });
        generation_request.diagnostics = Some(vec![]);
        let available_actions = state
            .request_code_actions(generation_request.clone())
            .unwrap();
        assert_metadata(&available_actions, "real-code-generation");
        let available_actions = available_actions
            .result
            .as_ref()
            .and_then(|result| result.get("actions"))
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("generator choices missing: {available_actions:?}"));
        let mut override_request = request(
            JavaSemanticPosition {
                line: 16,
                character: 8,
            },
            "real-code-generation-override".to_string(),
            "real-code-generation-override-cancel".to_string(),
            None,
        );
        override_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 16,
                character: 8,
            },
            end: JavaSemanticPosition {
                line: 16,
                character: 18,
            },
        });
        override_request.diagnostics = Some(vec![]);
        let override_choices = state
            .request_code_actions(override_request.clone())
            .unwrap();
        assert_metadata(&override_choices, "real-code-generation-override");
        let override_action = override_choices
            .result
            .as_ref()
            .and_then(|result| result.get("actions"))
            .and_then(Value::as_array)
            .and_then(|actions| {
                actions.iter().find(|action| {
                    action.get("title").and_then(Value::as_str)
                        == Some("Generate Override/Implement Methods")
                })
            })
            .unwrap_or_else(|| panic!("override-method choice missing: {override_choices:?}"));
        let override_selection = override_action
            .get("memberSelection")
            .unwrap_or_else(|| panic!("override-method selection missing: {override_action:?}"));
        let override_method_key = override_selection
            .pointer("/groups/0/members")
            .and_then(Value::as_array)
            .and_then(|members| {
                members
                    .iter()
                    .find(|member| member.get("name").and_then(Value::as_str) == Some("label"))
            })
            .and_then(|member| member.get("selectionKey"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("overridable label method missing: {override_selection:?}"))
            .to_string();
        let mut selected_override_request = override_request;
        selected_override_request.request_id = "real-code-generation-selected-override".to_string();
        selected_override_request.cancellation_id =
            "real-code-generation-selected-override-cancel".to_string();
        selected_override_request.generation_selection = Some(JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::OverrideMethods,
            selected_field_binding_keys: vec![],
            selected_constructor_binding_keys: vec![],
            selected_overridable_method_keys: vec![override_method_key],
            selected_delegate_method_keys: vec![],
        });
        let selected_override = state
            .request_code_actions(selected_override_request)
            .unwrap();
        assert_metadata(&selected_override, "real-code-generation-selected-override");
        assert!(
            selected_override
                .result
                .as_ref()
                .and_then(|result| result.get("actions"))
                .and_then(Value::as_array)
                .is_some_and(|actions| actions.iter().any(|action| {
                    action.get("title").and_then(Value::as_str)
                        == Some("Generate Override/Implement Methods")
                        && action.get("memberSelection").is_none()
                        && action
                            .get("edits")
                            .and_then(Value::as_array)
                            .is_some_and(|edits| {
                                edits.iter().any(|edit| {
                                    edit.get("newText")
                                        .and_then(Value::as_str)
                                        .is_some_and(|text| text.contains("String label()"))
                                })
                            })
                })),
            "{selected_override:?}"
        );

        let constructor_choice = available_actions
            .iter()
            .find(|action| {
                action.get("title").and_then(Value::as_str) == Some("Generate constructors")
            })
            .unwrap_or_else(|| panic!("constructor choice missing: {available_actions:?}"));
        let constructor_selection = constructor_choice
            .get("memberSelection")
            .unwrap_or_else(|| panic!("constructor selection missing: {constructor_choice:?}"));
        let selection_members = |selection: &Value, group_id: &str| -> Vec<Value> {
            selection
                .get("groups")
                .and_then(Value::as_array)
                .and_then(|groups| {
                    groups
                        .iter()
                        .find(|group| group.get("id").and_then(Value::as_str) == Some(group_id))
                })
                .and_then(|group| group.get("members"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(|| panic!("selection group {group_id} missing: {selection:?}"))
        };
        let delegate_choice = available_actions
            .iter()
            .find(|action| {
                action.get("title").and_then(Value::as_str) == Some("Generate Delegate Methods")
            })
            .unwrap_or_else(|| panic!("delegate-method choice missing: {available_actions:?}"));
        let delegate_selection = delegate_choice
            .get("memberSelection")
            .unwrap_or_else(|| panic!("delegate-method selection missing: {delegate_choice:?}"));
        assert!(
            delegate_selection
                .pointer("/groups/0/selectedKeys")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty),
            "delegate methods must require explicit selection: {delegate_selection:?}"
        );
        let format_delegate_key = selection_members(delegate_selection, "delegateMethods")
            .iter()
            .find(|member| {
                member.get("name").and_then(Value::as_str) == Some("textDelegate.format")
            })
            .and_then(|member| member.get("selectionKey"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("textDelegate.format choice missing: {delegate_selection:?}"))
            .to_string();
        let mut selected_delegate_request = generation_request.clone();
        selected_delegate_request.request_id = "real-code-generation-selected-delegate".to_string();
        selected_delegate_request.cancellation_id =
            "real-code-generation-selected-delegate-cancel".to_string();
        selected_delegate_request.generation_selection = Some(JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::DelegateMethods,
            selected_field_binding_keys: vec![],
            selected_constructor_binding_keys: vec![],
            selected_overridable_method_keys: vec![],
            selected_delegate_method_keys: vec![format_delegate_key],
        });
        let selected_delegate = state
            .request_code_actions(selected_delegate_request)
            .unwrap();
        assert_metadata(&selected_delegate, "real-code-generation-selected-delegate");
        let delegate_text = selected_delegate
            .result
            .as_ref()
            .and_then(|result| result.get("actions"))
            .and_then(Value::as_array)
            .and_then(|actions| {
                actions.iter().find(|action| {
                    action.get("title").and_then(Value::as_str) == Some("Generate Delegate Methods")
                        && action.get("memberSelection").is_none()
                })
            })
            .and_then(|action| action.get("edits"))
            .and_then(Value::as_array)
            .map(|edits| {
                edits
                    .iter()
                    .filter_map(|edit| edit.get("newText").and_then(Value::as_str))
                    .collect::<String>()
            })
            .unwrap_or_else(|| {
                panic!("selected delegate-method edit missing: {selected_delegate:?}")
            });
        assert!(
            delegate_text.contains("String format(String value)"),
            "{delegate_text}"
        );
        assert!(
            delegate_text.contains("textDelegate.format(value)"),
            "{delegate_text}"
        );
        let display_name_key = selection_members(constructor_selection, "fields")
            .iter()
            .find(|member| member.get("name").and_then(Value::as_str) == Some("displayName"))
            .and_then(|member| member.get("selectionKey"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("displayName field missing: {constructor_selection:?}"))
            .to_string();
        let constructor_key = selection_members(constructor_selection, "constructors")
            .first()
            .and_then(|constructor| constructor.get("selectionKey"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("super constructor missing: {constructor_selection:?}"))
            .to_string();

        let mut selected_constructor_request = generation_request.clone();
        selected_constructor_request.request_id =
            "real-code-generation-selected-constructor".to_string();
        selected_constructor_request.cancellation_id =
            "real-code-generation-selected-constructor-cancel".to_string();
        selected_constructor_request.generation_selection =
            Some(JavaCodeActionGenerationSelection {
                kind: JavaCodeActionGenerationKind::Constructors,
                selected_field_binding_keys: vec![display_name_key.clone()],
                selected_constructor_binding_keys: vec![constructor_key],
                selected_overridable_method_keys: vec![],
                selected_delegate_method_keys: vec![],
            });
        let selected_constructor = state
            .request_code_actions(selected_constructor_request)
            .unwrap();
        assert_metadata(
            &selected_constructor,
            "real-code-generation-selected-constructor",
        );
        let constructor_text = selected_constructor
            .result
            .as_ref()
            .and_then(|result| result.get("actions"))
            .and_then(Value::as_array)
            .and_then(|actions| {
                actions.iter().find(|action| {
                    action.get("title").and_then(Value::as_str) == Some("Generate constructors")
                        && action.get("memberSelection").is_none()
                })
            })
            .and_then(|action| action.get("edits"))
            .and_then(Value::as_array)
            .and_then(|edits| edits.first())
            .and_then(|edit| edit.get("newText"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| {
                panic!("selected constructor edit missing: {selected_constructor:?}")
            });
        assert!(
            constructor_text.contains("SemanticFixture("),
            "{constructor_text}"
        );
        assert!(
            constructor_text.contains("displayName"),
            "{constructor_text}"
        );
        assert!(!constructor_text.contains("values"), "{constructor_text}");

        let hash_choice = available_actions
            .iter()
            .find(|action| {
                action.get("title").and_then(Value::as_str)
                    == Some("Generate hashCode() and equals()")
            })
            .unwrap_or_else(|| panic!("hashCode/equals choice missing: {available_actions:?}"));
        let hash_selection = hash_choice
            .get("memberSelection")
            .unwrap_or_else(|| panic!("hashCode/equals selection missing: {hash_choice:?}"));
        let display_name_hash_key = selection_members(hash_selection, "fields")
            .iter()
            .find(|member| member.get("name").and_then(Value::as_str) == Some("displayName"))
            .and_then(|member| member.get("selectionKey"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("displayName hash field missing: {hash_selection:?}"))
            .to_string();
        let mut selected_hash_request = generation_request;
        selected_hash_request.request_id = "real-code-generation-selected-hash".to_string();
        selected_hash_request.cancellation_id =
            "real-code-generation-selected-hash-cancel".to_string();
        selected_hash_request.generation_selection = Some(JavaCodeActionGenerationSelection {
            kind: JavaCodeActionGenerationKind::HashCodeEquals,
            selected_field_binding_keys: vec![display_name_hash_key],
            selected_constructor_binding_keys: vec![],
            selected_overridable_method_keys: vec![],
            selected_delegate_method_keys: vec![],
        });
        let selected_hash = state.request_code_actions(selected_hash_request).unwrap();
        assert_metadata(&selected_hash, "real-code-generation-selected-hash");
        let hash_text = selected_hash
            .result
            .as_ref()
            .and_then(|result| result.get("actions"))
            .and_then(Value::as_array)
            .and_then(|actions| {
                actions.iter().find(|action| {
                    action.get("title").and_then(Value::as_str)
                        == Some("Generate hashCode() and equals()")
                        && action.get("memberSelection").is_none()
                })
            })
            .and_then(|action| action.get("edits"))
            .and_then(Value::as_array)
            .map(|edits| {
                edits
                    .iter()
                    .filter_map(|edit| edit.get("newText").and_then(Value::as_str))
                    .collect::<String>()
            })
            .unwrap_or_else(|| panic!("selected hashCode/equals edit missing: {selected_hash:?}"));
        assert!(hash_text.contains("hashCode()"), "{hash_text}");
        assert!(hash_text.contains("equals(Object obj)"), "{hash_text}");
        assert!(hash_text.contains("displayName"), "{hash_text}");
        assert!(!hash_text.contains("values"), "{hash_text}");

        let missing_method = diagnostics_event
            .payload
            .pointer("/params/diagnostics")
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .find(|diagnostic| {
                let message = diagnostic
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                message.contains("Incomplete") && message.contains("abstract method")
            })
            .expect("JDT LS should diagnose the missing inherited abstract method");
        let missing_method_range: JavaSemanticRange =
            serde_json::from_value(missing_method.get("range").unwrap().clone()).unwrap();
        let mut implementation_request = request(
            JavaSemanticPosition {
                line: missing_method_range.start.line,
                character: missing_method_range.start.character,
            },
            "real-implement-abstract-method".to_string(),
            "real-implement-abstract-method-cancel".to_string(),
            None,
        );
        implementation_request.range = Some(missing_method_range.clone());
        implementation_request.diagnostics = Some(vec![JavaCodeActionDiagnostic {
            range: missing_method_range,
            severity: missing_method
                .get("severity")
                .and_then(Value::as_u64)
                .unwrap_or(1) as u8,
            message: missing_method
                .get("message")
                .and_then(Value::as_str)
                .unwrap()
                .to_string(),
            source: missing_method
                .get("source")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            code: missing_method.get("code").cloned(),
        }]);
        let abstract_method_actions = semantic_request(
            &state,
            implementation_request,
            SemanticKind::CodeActions,
            SIGNATURE_HELP_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&abstract_method_actions, "real-implement-abstract-method");
        assert!(
            abstract_method_actions
                .result
                .as_ref()
                .and_then(|result| result.get("actions"))
                .and_then(Value::as_array)
                .is_some_and(|actions| actions.iter().any(|action| {
                    action
                        .get("title")
                        .and_then(Value::as_str)
                        .is_some_and(|title| title.to_lowercase().contains("unimplemented method"))
                        && action
                            .get("edits")
                            .and_then(Value::as_array)
                            .is_some_and(|edits| !edits.is_empty())
                })),
            "{abstract_method_actions:?}"
        );
        let generated_method_actions = abstract_method_actions
            .result
            .as_ref()
            .and_then(|result| result.get("actions"))
            .and_then(Value::as_array)
            .unwrap();
        assert!(generated_method_actions.iter().any(|action| {
            action.get("title").and_then(Value::as_str) == Some("Generate toString()")
                && action
                    .get("edits")
                    .and_then(Value::as_array)
                    .is_some_and(|edits| !edits.is_empty())
        }));
        assert!(generated_method_actions.iter().any(|action| {
            action.get("kind").and_then(Value::as_str) == Some("source.sortMembers")
                && action
                    .get("edits")
                    .and_then(Value::as_array)
                    .is_some_and(|edits| !edits.is_empty())
        }));

        let javadoc_source = concat!(
            "package example;\n\nimport java.util.List;\n\npublic class Main {\n",
            "  public List<String> names() { return java.util.Collections.emptyList(); }\n",
            "  public String format(String value, int count) throws IllegalArgumentException {\n",
            "    if (count < 0) throw new IllegalArgumentException(\"count\");\n",
            "    return value + ':' + count;\n  }\n}\n",
        );
        let javadoc_path = root.join("src/main/java/example/Main.java");
        fs::write(&javadoc_path, javadoc_source).unwrap();
        let javadoc_uri = file_uri(&javadoc_path);
        sync_document(
            &mut state.manager.lock().unwrap(),
            SyncAction::Open,
            JavaLanguageDocument {
                workspace_id: "jdtls-real-semantic".to_string(),
                generation: initialized.generation,
                path: "src/main/java/example/Main.java".to_string(),
                uri: javadoc_uri.clone(),
                version: 1,
                language_id: Some("java".to_string()),
                text: Some(javadoc_source.to_string()),
            },
        )
        .unwrap();
        let (doc_line, doc_column) = javadoc_source
            .lines()
            .enumerate()
            .find_map(|(line, text)| {
                text.find("format(String value")
                    .map(|column| (line as u32, column as u32))
            })
            .unwrap();
        let mut javadoc_request = request(
            JavaSemanticPosition {
                line: doc_line,
                character: doc_column,
            },
            "real-javadoc-method".to_string(),
            "real-javadoc-method-cancel".to_string(),
            None,
        );
        javadoc_request.document.path = "src/main/java/example/Main.java".to_string();
        javadoc_request.document.uri = javadoc_uri.clone();
        javadoc_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: doc_line,
                character: doc_column,
            },
            end: JavaSemanticPosition {
                line: doc_line,
                character: doc_column + 6,
            },
        });
        javadoc_request.diagnostics = Some(vec![]);
        let javadoc_response = state.request_code_actions(javadoc_request).unwrap();
        if let Some(output) = env::var_os("IDE_JAVA_JAVADOC_EVIDENCE") {
            fs::write(
                output,
                serde_json::to_vec_pretty(&json!({
                    "source": javadoc_source, "response": javadoc_response
                }))
                .unwrap(),
            )
            .unwrap();
        }
        assert_eq!(javadoc_response.request_id, "real-javadoc-method");
        assert_eq!(javadoc_response.uri, javadoc_uri);
        assert_eq!(javadoc_response.version, 1);
        assert!(
            !javadoc_response.cancelled
                && !javadoc_response.timeout
                && javadoc_response.error.is_none(),
            "{javadoc_response:?}"
        );
        let doc_actions = javadoc_response
            .result
            .as_ref()
            .unwrap()
            .get("actions")
            .unwrap()
            .as_array()
            .unwrap();
        let doc_edits = doc_actions
            .iter()
            .find(|action| action.get("title").and_then(Value::as_str) == Some("Add Javadoc comment"))
            .unwrap()
            .get("edits")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(doc_edits.len(), 1, "{javadoc_response:?}");
        let doc_edit = &doc_edits[0];
        assert_eq!(
            doc_edit.pointer("/range/start"),
            doc_edit.pointer("/range/end")
        );
        let doc_text = doc_edit
            .get("newText")
            .and_then(Value::as_str)
            .unwrap()
            .trim();
        assert!(
            doc_text.starts_with("/**") && doc_text.ends_with("*/"),
            "{doc_text}"
        );
        for tag in [
            "@param value",
            "@param count",
            "@return",
            "@throws IllegalArgumentException",
        ] {
            assert!(doc_text.contains(tag), "{doc_text}");
        }
        assert_eq!(fs::read_to_string(&javadoc_path).unwrap(), javadoc_source);
        assert_eq!(fs::read_to_string(&java_path).unwrap(), source);
        assert_eq!(
            fs::read_to_string(&companion_path).unwrap(),
            companion_source
        );

        let semantic_tokens = semantic_request(
            &state,
            request(
                JavaSemanticPosition {
                    line: 1,
                    character: 10,
                },
                "real-semantic-tokens".to_string(),
                "real-semantic-tokens-cancel".to_string(),
                None,
            ),
            SemanticKind::SemanticTokens,
            HOVER_TIMEOUT,
        )
        .unwrap();
        assert_metadata(&semantic_tokens, "real-semantic-tokens");
        assert!(
            semantic_tokens
                .result
                .as_ref()
                .and_then(|result| result.get("tokens"))
                .and_then(Value::as_array)
                .is_some_and(|tokens| tokens.iter().any(|token| {
                    matches!(
                        token.get("tokenType").and_then(Value::as_str),
                        Some("class" | "method")
                    )
                })),
            "{semantic_tokens:?}"
        );

        let (cancel_tx, cancel_rx) = mpsc::sync_channel(1);
        let (pending, writer) = {
            let manager = state.manager.lock().unwrap();
            let session = manager.session.as_ref().unwrap();
            (
                Arc::clone(&session.pending_semantic),
                Arc::clone(&session.writer),
            )
        };
        assert!(pending.lock().unwrap().is_empty());
        assert_eq!(
            reserve_pending_request(
                &pending,
                9_999_999,
                "real-cleanup-cancel".to_string(),
                cancel_tx
            )
            .unwrap(),
            Ok(())
        );
        cancel_by_cancellation_id(&pending, &writer, "real-cleanup-cancel");
        assert_eq!(
            cancel_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            json!({"__cancelled":true})
        );
        assert!(pending.lock().unwrap().is_empty());

        let mut manager = state.manager.lock().unwrap();
        let close = JavaLanguageDocument {
            workspace_id: "jdtls-real-semantic".to_string(),
            generation: initialized.generation,
            path: "src/main/java/example/SemanticFixture.java".to_string(),
            uri: uri.clone(),
            version: 1,
            language_id: None,
            text: None,
        };
        sync_document(&mut manager, SyncAction::Close, close).unwrap();
        stop_session(
            &mut manager,
            Duration::from_secs(10),
            Duration::from_secs(10),
        )
        .unwrap();
        drop(manager);
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());

        let evidence = json!({"completion":completion,"hover":hover,"signature":signature,"documentSymbols":outline,"workspaceSymbols":workspace_symbols,"additionalTopLevelSymbols":additional_top_level_symbols,"documentHighlights":document_highlights,"semanticTokens":semantic_tokens,"inlayHints":inlay_hints,"codeActions":code_actions,"quickAssists":quick_assists,"abstractMethodActions":abstract_method_actions,"processLeak":false});
        assert!(!serde_json::to_string(&evidence).unwrap().contains(source));
        assert!(!root.join(".metadata").exists());
        assert!(!root.join(".jdtls").exists());
        println!("REAL_JDTLS_SEMANTIC_EVIDENCE={evidence}");

        env::remove_var(crate::workspace::WORKSPACE_ROOT_ENV);
        env::remove_var(crate::app_config::IDE_HOME_ENV);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&ide_home).unwrap();
        assert!(!root.exists() && !ide_home.exists());
    }

    #[test]
    #[ignore = "requires an unmanifested JDT LS 1.63, IDE_JDTLS_PROJECT_JDK_21 and IDE_JDTLS_JAVA_HOME=JDK25"]
    fn real_jdtls_bundle_runtime_floor_and_restarts() {
        let old_jdk = env::var("IDE_JDTLS_PROJECT_JDK_21").expect("select the incompatible JDK 21");
        let server_jdk = env::var("IDE_JDTLS_JAVA_HOME").expect("select the compatible JDK 25");
        let install = discover_jdtls().unwrap();
        assert!(!install.home.join("install-manifest.json").exists());
        assert_eq!(install.minimum_runtime_java, Some(25));
        let root = temp_dir("runtime-protocol-workspace");
        let ide_home = temp_dir("runtime-protocol-state");
        let previous = [
            crate::workspace::WORKSPACE_ROOT_ENV,
            crate::app_config::IDE_HOME_ENV,
        ]
        .map(|name| (name, env::var_os(name)));
        struct Cleanup {
            manager: Manager,
            root: PathBuf,
            ide_home: PathBuf,
            previous: [(&'static str, Option<std::ffi::OsString>); 2],
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = stop_session(
                    &mut self.manager,
                    Duration::from_secs(5),
                    Duration::from_secs(5),
                );
                for (name, value) in &self.previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.ide_home);
            }
        }
        let mut cleanup = Cleanup {
            manager: Manager::default(),
            root: root.clone(),
            ide_home: ide_home.clone(),
            previous,
        };
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"runtime-protocol"}"#,
        )
        .unwrap();
        fs::write(root.join("Main.java"), "class Main {}\n").unwrap();
        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);

        let failure = start_session(
            &mut cleanup.manager,
            Duration::from_secs(30),
            None,
            Some(&old_jdk),
            false,
            "",
            "",
            &[],
            &[],
            None,
            None,
            &[],
            false,
        )
        .unwrap_err();
        println!("INCOMPATIBLE_JDTLS_STARTUP={failure}");
        assert!(failure.contains("requires JDK 25 or newer"), "{failure}");
        assert!(
            !ide_home.join("language-services").exists(),
            "incompatible runtime must be refused before creating server state"
        );
        assert!(cleanup.manager.session.is_none());

        for cycle in 0..3 {
            start_session(
                &mut cleanup.manager,
                Duration::from_secs(60),
                None,
                Some(&server_jdk),
                false,
                "",
                "",
                &[],
                &[],
                None,
                None,
                &[],
                false,
            )
            .unwrap();
            let current = status(&cleanup.manager).unwrap();
            assert_eq!(current.lifecycle, "initialized");
            assert_eq!(current.provider, "jdtls");
            assert!(current.capabilities.as_ref().unwrap().document_sync);
            let pid = lock(
                &cleanup.manager.session.as_ref().unwrap().child,
                "restart child",
            )
            .unwrap()
            .id();
            stop_session(
                &mut cleanup.manager,
                Duration::from_secs(10),
                Duration::from_secs(10),
            )
            .unwrap();
            assert!(cleanup.manager.session.is_none());
            #[cfg(target_os = "linux")]
            assert!(!Path::new(&format!("/proc/{pid}")).exists());
            println!("JDTLS_RESTART_PROTOCOL cycle={cycle} initialized=true child_exited=true");
        }
    }

    #[test]
    #[ignore = "requires the checksum-verified managed JDT LS installation and a full JDK"]
    fn managed_jdtls_real_initialize_poll_and_graceful_stop() {
        let root = temp_dir("real-workspace");
        let ide_home = temp_dir("real-state");
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::write(
            root.join("pom.xml"),
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example</groupId><artifactId>fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release></properties>
</project>"#,
        )
        .unwrap();
        fs::write(
            root.join("src/main/java/example/App.java"),
            "package example; public final class App { public static void main(String[] args) { System.out.println(\"ready\"); } }\n",
        )
        .unwrap();
        fs::create_dir_all(root.join(".ide")).unwrap();
        fs::write(
            root.join(".ide/workspace.json"),
            r#"{"id":"jdtls-real-integration"}"#,
        )
        .unwrap();

        env::set_var(crate::workspace::WORKSPACE_ROOT_ENV, &root);
        env::set_var(crate::app_config::IDE_HOME_ENV, &ide_home);
        let mut manager = Manager::default();

        let initial = status(&manager).unwrap();
        assert!(initial.available, "discovery failed: {:?}", initial.detail);
        assert_eq!(
            initial.jdtls_version.as_deref(),
            Some("1.63.0-202610191322-idecompact1")
        );
        assert!(initial
            .jdtls_home
            .as_deref()
            .is_some_and(|home| home.ends_with("1.63.0-202610191322-idecompact1")));
        assert!(initial
            .java_executable
            .as_deref()
            .is_some_and(|java| java.ends_with("/java")));

        let forced_timeout = start_session(
            &mut manager,
            Duration::ZERO,
            None,
            None,
            false,
            "",
            "",
            &[],
            &[],
            None,
            None,
            &[],
            false,
        )
        .unwrap_err();
        assert_eq!(forced_timeout, "Timed out waiting for JDT LS initialize response");
        assert!(manager.session.is_none());
        for _ in 0..2 {
            let failed = status(&manager).unwrap();
            assert!(failed.available);
            assert_eq!(failed.lifecycle, "failed");
            assert_eq!(failed.detail.as_deref(), Some(forced_timeout.as_str()));
            assert_eq!(failed.generation, manager.generation);
        }

        start_session(
            &mut manager,
            Duration::from_secs(60),
            None,
            None,
            false,
            "",
            "",
            &[],
            &[],
            None,
            None,
            &[],
            false,
        )
        .unwrap();
        let initialized = status(&manager).unwrap();
        assert_eq!(initialized.lifecycle, "initialized");
        assert!(initialized.detail.is_none());
        let capabilities = initialized.capabilities.as_ref().unwrap();
        assert!(capabilities.completion);
        assert!(capabilities.hover);
        assert!(capabilities.definition);
        assert!(capabilities.references);
        assert!(capabilities.document_symbols);
        assert!(capabilities.document_highlights);
        assert!(capabilities.workspace_symbols);
        assert!(capabilities.workspace_symbols);
        assert!(capabilities.rename);
        assert!(capabilities.code_actions);
        assert!(capabilities.formatting);
        assert!(capabilities.range_formatting);
        assert!(capabilities.signature_help);
        assert!(capabilities.document_sync);
        assert!(capabilities.diagnostics);

        let session = manager.session.as_ref().unwrap();
        let pid = lock(&session.child, "real JDT LS process").unwrap().id();
        let data_dir = ide_home
            .join("language-services/java")
            .join(&session.workspace_id);
        assert!(data_dir.is_dir());
        assert!(!data_dir.starts_with(&root));

        let ready_started = Instant::now();
        let ready = wait_for_matching_event(&manager, 0, Duration::from_secs(60), |event| {
            event.payload.get("method").and_then(Value::as_str) == Some("language/status")
                && event
                    .payload
                    .pointer("/params/type")
                    .and_then(Value::as_str)
                    == Some("ServiceReady")
        });
        let ready_elapsed = ready_started.elapsed();

        let document_uri = file_uri(&root.join("src/main/java/example/App.java"));
        let synchronized = |version, text: &str| JavaLanguageDocument {
            workspace_id: "jdtls-real-integration".to_string(),
            generation: initialized.generation,
            path: "src/main/java/example/App.java".to_string(),
            uri: document_uri.clone(),
            version,
            language_id: Some("java".to_string()),
            text: Some(text.to_string()),
        };
        let valid_open = "package example;\npublic final class App {\n  String value;\n}\n";
        let invalid_change =
            "package example;\npublic final class App {\n  MissingType value;\n}\n";
        let fixed_change =
            "package example;\npublic final class App {\n  String value = \"fixed\";\n}\n";

        sync_document(&mut manager, SyncAction::Open, synchronized(1, valid_open)).unwrap();
        // JDT LS registers its reconciler asynchronously after didOpen.
        thread::sleep(Duration::from_secs(1));
        let change_started = Instant::now();
        sync_document(
            &mut manager,
            SyncAction::Change,
            synchronized(2, invalid_change),
        )
        .unwrap();
        let diagnostic =
            wait_for_matching_event(&manager, ready.sequence, Duration::from_secs(30), |event| {
                event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(document_uri.as_str())
                    && matches!(
                        event
                            .payload
                            .pointer("/params/version")
                            .and_then(Value::as_i64),
                        None | Some(2)
                    )
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(|items| !items.is_empty())
            });
        let diagnostic_elapsed = change_started.elapsed();
        let diagnostics = diagnostic
            .payload
            .pointer("/params/diagnostics")
            .and_then(Value::as_array)
            .unwrap();
        assert!(diagnostics.len() <= MAX_DIAGNOSTICS);
        assert_eq!(diagnostic.generation, initialized.generation);
        assert_eq!(diagnostic.payload["generation"], initialized.generation);
        assert_eq!(diagnostic.payload["workspaceId"], "jdtls-real-integration");
        assert_eq!(initialized.provider, "jdtls");
        assert!(diagnostics.iter().all(|item| {
            let start = item.pointer("/range/start");
            let end = item.pointer("/range/end");
            start
                .and_then(|value| value.get("line"))
                .and_then(Value::as_u64)
                .is_some()
                && start
                    .and_then(|value| value.get("character"))
                    .and_then(Value::as_u64)
                    .is_some()
                && end
                    .and_then(|value| value.get("line"))
                    .and_then(Value::as_u64)
                    .is_some()
                && end
                    .and_then(|value| value.get("character"))
                    .and_then(Value::as_u64)
                    .is_some()
        }));
        assert!(diagnostics.iter().any(|item| {
            item.get("source").and_then(Value::as_str) == Some("Java")
                && item
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("MissingType"))
        }));

        let fix_started = Instant::now();
        sync_document(
            &mut manager,
            SyncAction::Change,
            synchronized(3, fixed_change),
        )
        .unwrap();
        let cleared = wait_for_matching_event(
            &manager,
            diagnostic.sequence,
            Duration::from_secs(30),
            |event| {
                event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(document_uri.as_str())
                    && matches!(
                        event
                            .payload
                            .pointer("/params/version")
                            .and_then(Value::as_i64),
                        None | Some(3)
                    )
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty)
            },
        );
        let clear_elapsed = fix_started.elapsed();
        sync_document(
            &mut manager,
            SyncAction::Save,
            synchronized(3, fixed_change),
        )
        .unwrap();
        let mut close = synchronized(3, "");
        close.language_id = None;
        close.text = None;
        sync_document(&mut manager, SyncAction::Close, close).unwrap();
        let close_clear = wait_for_matching_event(
            &manager,
            cleared.sequence,
            Duration::from_secs(2),
            |event| {
                event.kind == "diagnostics"
                    && event.payload.pointer("/params/uri").and_then(Value::as_str)
                        == Some(document_uri.as_str())
                    && event
                        .payload
                        .pointer("/params/version")
                        .and_then(Value::as_i64)
                        == Some(3)
                    && event
                        .payload
                        .pointer("/params/diagnostics")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty)
            },
        );
        let serialized_evidence = serde_json::to_string(&diagnostic.payload).unwrap();
        assert!(!serialized_evidence.contains(valid_open));
        assert!(!serialized_evidence.contains(invalid_change));
        assert!(!serialized_evidence.contains(fixed_change));

        println!(
            "REAL_JDTLS_PHASE_1B_EVIDENCE={}",
            json!({
                "status": initialized,
                "pid": pid,
                "dataDir": data_dir,
                "serviceReadyMs": ready_elapsed.as_millis(),
                "diagnosticLatencyMs": diagnostic_elapsed.as_millis(),
                "diagnosticCount": diagnostics.len(),
                "diagnosticVersion": diagnostic.payload.pointer("/params/version"),
                "diagnostics": diagnostics,
                "clearLatencyMs": clear_elapsed.as_millis(),
                "clearVersion": cleared.payload.pointer("/params/version"),
                "closeClearSequence": close_clear.sequence,
                "latestSequence": close_clear.sequence,
            })
        );

        thread::sleep(Duration::from_secs(1));
        let stop_started = Instant::now();
        stop_session(
            &mut manager,
            Duration::from_secs(10),
            Duration::from_secs(10),
        )
        .unwrap();
        let stop_elapsed = stop_started.elapsed();
        assert!(
            stop_elapsed < Duration::from_secs(9),
            "JDT LS did not acknowledge graceful shutdown: {stop_elapsed:?}"
        );
        assert_eq!(status(&manager).unwrap().lifecycle, "stopped");
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());

        start_session(
            &mut manager,
            Duration::from_secs(60),
            None,
            None,
            false,
            "",
            "",
            &[],
            &[],
            None,
            None,
            &[],
            false,
        )
        .unwrap();
        let restarted = status(&manager).unwrap();
        assert!(restarted.generation > initialized.generation);
        let restarted_pid = lock(
            &manager.session.as_ref().unwrap().child,
            "restarted real JDT LS process",
        )
        .unwrap()
        .id();
        assert_ne!(restarted_pid, pid);
        wait_for_matching_event(
            &manager,
            close_clear.sequence,
            Duration::from_secs(60),
            |event| {
                event.generation == restarted.generation
                    && event.payload.get("method").and_then(Value::as_str)
                        == Some("language/status")
                    && event
                        .payload
                        .pointer("/params/type")
                        .and_then(Value::as_str)
                        == Some("ServiceReady")
            },
        );
        let state = JavaLanguageServiceState::new(manager);
        let source_path = root.join("src/main/java/example/App.java");
        let saved_source = fs::read(&source_path).unwrap();
        let mut retained = synchronized(7, valid_open);
        retained.generation = restarted.generation;
        state.open_document(retained.clone()).unwrap();

        let restart_stop_started = Instant::now();
        state.main_document_changed();
        retained.version += 1;
        assert_eq!(
            state.change_document(retained).unwrap_err(),
            "Java language service has no active session"
        );
        let after_navigation = state.service_status().unwrap();
        assert_eq!(after_navigation.lifecycle, "stopped");
        assert!(after_navigation.generation > restarted.generation);
        assert_eq!(fs::read(source_path).unwrap(), saved_source);
        let restart_stop_elapsed = restart_stop_started.elapsed();
        assert!(restart_stop_elapsed < Duration::from_secs(9));
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{restarted_pid}")).exists());
        assert!(!root.join(".metadata").exists());
        assert!(!root.join(".jdtls").exists());

        println!(
            "REAL_JDTLS_GRACEFUL_STOP_EVIDENCE={}",
            json!({
                "firstStopMs": stop_elapsed.as_millis(),
                "restartGeneration": restarted.generation,
                "restartedPid": restarted_pid,
                "restartStopMs": restart_stop_elapsed.as_millis(),
                "processLeak": false,
            })
        );

        env::remove_var(crate::workspace::WORKSPACE_ROOT_ENV);
        env::remove_var(crate::app_config::IDE_HOME_ENV);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&ide_home).unwrap();
        assert!(!root.exists());
        assert!(!ide_home.exists());
    }

    #[cfg(unix)]
    #[test]
    fn fake_lsp_process_initializes_shuts_down_crashes_and_is_killed() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("fake-lsp");
        let script = root.join("fake-lsp.sh");
        fs::write(
            &script,
            r#"#!/bin/sh
mode="$1"
[ "$mode" = crash ] && exit 9
[ "$mode" = hang ] && { sleep 30; exit 0; }
read_message() {
  length=""
  while IFS= read -r line; do
    line=$(printf '%s' "$line" | tr -d '\r')
    [ -z "$line" ] && break
    case "$line" in Content-Length:*) length=${line#Content-Length: };; esac
  done
  [ -n "$length" ] || exit 10
  dd bs=1 count="$length" of=/dev/null 2>/dev/null
}
send_message() {
  body="$1"
  printf 'Content-Length: %s\r\n\r\n%s' "${#body}" "$body"
}
read_message
send_message '{"jsonrpc":"2.0","id":71,"result":{"capabilities":{"hoverProvider":true}}}'
read_message
read_message
send_message '{"jsonrpc":"2.0","id":72,"result":null}'
read_message
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).unwrap();

        let mut child = Command::new("/bin/sh")
            .arg(&script)
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let writer = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let mut reader = BufReader::new(child.stdout.take().unwrap());
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","id":71,"method":"initialize","params":{}}),
        )
        .unwrap();
        let response = read_frame(&mut reader, MAX_MESSAGE_BYTES).unwrap().unwrap();
        assert_eq!(response_id(&response), Some(71));
        assert!(normalize_capabilities(response.get("result").unwrap()).hover);
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
        )
        .unwrap();
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","id":72,"method":"shutdown","params":null}),
        )
        .unwrap();
        assert_eq!(
            response_id(&read_frame(&mut reader, MAX_MESSAGE_BYTES).unwrap().unwrap()),
            Some(72)
        );
        write_message(
            &writer,
            &json!({"jsonrpc":"2.0","method":"exit","params":null}),
        )
        .unwrap();
        drop(writer);
        assert!(child.wait().unwrap().success());

        let status = Command::new("/bin/sh")
            .arg(&script)
            .arg("crash")
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(9));

        let child = Arc::new(Mutex::new(
            Command::new("/bin/sh")
                .arg(&script)
                .arg("hang")
                .spawn()
                .unwrap(),
        ));
        assert!(!wait_for_exit(&child, Duration::from_millis(30)).unwrap());
        kill_child(&child);
        assert!(wait_for_exit(&child, Duration::from_millis(30)).unwrap());
        let _ = fs::remove_dir_all(root);
    }
}
