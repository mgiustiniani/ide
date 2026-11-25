//! Saved-source and immutable-editor Java position navigation through RefactorKit's bounded JSON-RPC transport.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, CurrentWorkspaceBinding,
};
use crate::workspace::{ensure_within_root, workspace_root};

use super::java_project_context::trace_snapshot;
use super::transport::{
    session_call_detailed_cancellable, spawn_session, terminate, Session, REQUEST_TIMEOUT,
};

const MAX_SOURCE_BYTES: u64 = 1024 * 1024;
const MAX_PREVIEW_BYTES: usize = 8 * 1024 * 1024;
const MAX_NAVIGATION_LOCATIONS: usize = 10_000;
const MAX_TYPE_HIERARCHY_ITEMS: u64 = 200;
const MAX_CALL_HIERARCHY_ITEMS: u64 = 500;
const MAX_IMPLEMENTATION_ITEMS: u64 = 200;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const BACKEND: &str = "eclipse-jdt-3.44-bindings-v1";
const JSON_RPC_INTERNAL_ERROR: i64 = -32603;
const KOTLIN_DEFINITION_COMPILER_JAR: &str = "IDE_KOTLIN_DEFINITION_COMPILER_JAR";
const KOTLIN_DEFINITION_COMPILER_CLASSPATH: &str = "IDE_KOTLIN_DEFINITION_COMPILER_CLASSPATH";

fn supports_kotlin_definition(request: &JavaNavigationRequest, capabilities: &Value) -> bool {
    request.kind == "definition"
        && request.editor_overlay.is_none()
        && request
            .project_context
            .as_ref()
            .is_some_and(|context| context.gradle.is_some())
        && capabilities["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|method| {
                method["name"] == "intelligence.query"
                    && method["features"]["kotlinDefinitionToolchain"] == true
            })
        })
}

fn kotlin_definition_toolchain(
    sdk: &Path,
    compiler: Option<&OsStr>,
    classpath: Option<&OsStr>,
) -> Result<Option<Value>, &'static str> {
    let (compiler, classpath) = match (compiler, classpath) {
        (None, None) => return Ok(None),
        (Some(compiler), Some(classpath)) => (compiler, classpath),
        _ => return Err("Set both Kotlin definition compiler variables before starting the IDE."),
    };
    let classpath = std::env::split_paths(classpath).take(65).collect::<Vec<_>>();
    let usable_jar = |path: &Path| {
        path.is_absolute()
            && path.extension() == Some(OsStr::new("jar"))
            && path.to_str().is_some_and(|path| path.len() <= 4096)
            && path.is_file()
    };
    if !usable_jar(Path::new(compiler))
        || !(1..=64).contains(&classpath.len())
        || !classpath.iter().all(|path| usable_jar(path))
    {
        return Err("Configure the Kotlin definition compiler and its classpath with absolute JAR paths.");
    }
    Ok(Some(json!({"jdkHome":sdk,"compilerJar":Path::new(compiler),"compilerClasspath":classpath})))
}

fn rpc_failure_message(
    error_kind: super::transport::SessionCallErrorKind,
    has_project_context: bool,
) -> &'static str {
    use super::transport::SessionCallErrorKind;

    match (error_kind, has_project_context) {
        (SessionCallErrorKind::Session, true) => {
            "RefactorKit could not complete Java navigation. The project session was retired; synchronize the Java project and retry."
        }
        (SessionCallErrorKind::Session, false) => {
            "RefactorKit could not complete Java navigation. Its session was retired; retry the query."
        }
        (SessionCallErrorKind::Protocol, true) => {
            "RefactorKit returned an invalid Java navigation response. The project session was retired; synchronize the Java project and retry."
        }
        (SessionCallErrorKind::Protocol, false) => {
            "RefactorKit returned an invalid Java navigation response. Its session was retired; retry the query."
        }
        (SessionCallErrorKind::RequestTooLarge, true) => {
            "The Java navigation request exceeds RefactorKit's size limit. Reduce the unsaved Java overlay, synchronize the project, and retry."
        }
        (SessionCallErrorKind::RequestTooLarge, false) => {
            "The Java navigation request exceeds RefactorKit's size limit."
        }
        (SessionCallErrorKind::Rejected, true) => {
            "RefactorKit refused Java navigation. The project session was retired; synchronize the Java project and retry."
        }
        (SessionCallErrorKind::Rejected, false) => "RefactorKit refused Java navigation.",
    }
}

fn recoverable_internal_query_error(
    request: &JavaNavigationRequest,
    error: &super::transport::SessionCallError,
) -> Option<Value> {
    use super::transport::SessionCallErrorKind;

    // A complete JSON-RPC INTERNAL_ERROR response proves the transport is
    // still synchronized. Keep the selected project session so a later query
    // can retry; transport failures still retire it through the normal path.
    (error.kind == SessionCallErrorKind::Rejected
        && error.rpc_code == Some(JSON_RPC_INTERNAL_ERROR))
    .then(|| {
        result(
            request,
            "refused",
            "RefactorKit returned an internal error for this Java query. The project context remains selected; retry the query.",
        )
    })
}

fn trace_navigation_phase(request_id: &str, phase: &str, started: Instant, succeeded: bool) {
    trace_snapshot(
        "navigation.phase",
        json!({
            "requestId": request_id,
            "phase": phase,
            "elapsedMs": started.elapsed().as_millis(),
            "outcome": if succeeded { "success" } else { "failure" },
        }),
    );
}

#[cfg(test)]
#[path = "java_navigation_tests.rs"]
mod tests;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Position {
    pub(super) line: u64,
    pub(super) character: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub(super) path: String,
    pub(super) text: String,
    pub(super) version: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaNavigationRequest {
    pub(super) editor_refactoring: Option<super::java_editor_refactoring::Request>,
    pub(super) project_context: Option<ProjectContext>,
    pub(super) editor_overlay: Option<EditorOverlay>,
    pub(super) workspace_id: String,
    pub(super) generation: u64,
    pub(super) request_id: String,
    pub(super) kind: String,
    direction: Option<String>,
    pub(super) document: Document,
    pub(super) position: Position,
    include_declaration: bool,
    pub(super) limit: u64,
}

impl JavaNavigationRequest {
    pub(super) fn editor_diagnostics(request: super::java_editor_diagnostics::Request) -> Self {
        Self {
            editor_refactoring: None,
            project_context: Some(request.project_context),
            editor_overlay: Some(request.editor_overlay),
            workspace_id: request.workspace_id,
            generation: request.generation,
            request_id: request.request_id,
            kind: "diagnostics".into(),
            direction: None,
            document: request.document,
            position: Position { line: 0, character: 0 },
            include_declaration: false,
            limit: request.limit,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditorOverlay {
    pub(super) documents: Vec<Document>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectContext {
    pub(super) project_path: String,
    pub(super) sdk_home: String,
    pub(super) maven_repository: String,
    pub(super) active_maven_profiles: Vec<String>,
    pub(super) inactive_maven_profiles: Vec<String>,
    pub(super) snapshot_hash: String,
    pub(super) context_hash: String,
    #[serde(default = "java_project_context_v1")]
    pub(super) context_schema_version: String,
    pub(super) platform_identities: Vec<String>,
    gradle: Option<super::java_project_context::GradleSettings>,
}

fn java_project_context_v1() -> String {
    "java-project-context-v1".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaNavigationContext {
    workspace_id: String,
    generation: u64,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct NavigationRequestKey {
    workspace_id: String,
    generation: u64,
    request_id: String,
}

#[derive(Default)]
struct NavigationCancellationRegistry(Mutex<HashMap<NavigationRequestKey, Arc<AtomicBool>>>);

struct NavigationCancellationRegistration {
    registry: Arc<NavigationCancellationRegistry>,
    key: NavigationRequestKey,
    cancelled: Arc<AtomicBool>,
}

impl Drop for NavigationCancellationRegistration {
    fn drop(&mut self) {
        if let Ok(mut active) = self.registry.0.lock() {
            if active
                .get(&self.key)
                .is_some_and(|current| Arc::ptr_eq(current, &self.cancelled))
            {
                active.remove(&self.key);
            }
        }
    }
}

impl NavigationCancellationRegistry {
    fn register(
        self: &Arc<Self>,
        request: &JavaNavigationRequest,
    ) -> Result<(Arc<AtomicBool>, NavigationCancellationRegistration), String> {
        let key = NavigationRequestKey {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            request_id: request.request_id.clone(),
        };
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut active = self
            .0
            .lock()
            .map_err(|_| "Java navigation is unavailable.")?;
        if active.contains_key(&key) {
            return Err("Duplicate active Java navigation request.".into());
        }
        active.insert(key.clone(), cancelled.clone());
        Ok((
            cancelled.clone(),
            NavigationCancellationRegistration {
                registry: self.clone(),
                key,
                cancelled,
            },
        ))
    }

    fn cancel(&self, workspace_id: &str, generation: u64, request_id: &str) -> bool {
        let key = NavigationRequestKey {
            workspace_id: workspace_id.to_string(),
            generation,
            request_id: request_id.to_string(),
        };
        let Ok(active) = self.0.lock() else {
            return false;
        };
        let Some(cancelled) = active.get(&key) else {
            return false;
        };
        cancelled.store(true, Ordering::SeqCst);
        true
    }

    fn cancel_context(&self, workspace_id: &str, generation: u64) {
        if let Ok(active) = self.0.lock() {
            for (key, cancelled) in active.iter() {
                if key.workspace_id == workspace_id && key.generation == generation {
                    cancelled.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    fn cancel_all(&self) {
        if let Ok(active) = self.0.lock() {
            for cancelled in active.values() {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
}

pub(super) fn prepare_stop(
    context: JavaNavigationContext,
    state: &JavaNavigationState,
) -> Result<impl FnOnce() -> Result<(), String> + Send + 'static, String> {
    if context.generation == 0 || context.generation > MAX_SAFE_INTEGER {
        return Err("Invalid Java navigation stop authority.".into());
    }
    state
        .2
        .cancel_context(&context.workspace_id, context.generation);
    let owned = state.0.clone();
    Ok(move || {
        let mut active = owned
            .lock()
            .map_err(|_| "Java navigation is unavailable.")?;
        if active.as_ref().is_some_and(|session| {
            session.binding.workspace_id == context.workspace_id
                && session.generation == context.generation
        }) {
            reset(&mut active);
        }
        Ok::<(), String>(())
    })
}

pub(super) fn cancel_request(
    context: JavaNavigationContext,
    request_id: String,
    state: &JavaNavigationState,
) -> Result<(), String> {
    if context.generation == 0
        || context.generation > MAX_SAFE_INTEGER
        || context.workspace_id.is_empty()
        || context.workspace_id.len() > 128
        || context.workspace_id.chars().any(char::is_control)
        || request_id.is_empty()
        || request_id.len() > 128
        || request_id.chars().any(char::is_control)
    {
        return Err("Invalid Java navigation cancellation authority.".into());
    }
    state
        .2
        .cancel(&context.workspace_id, context.generation, &request_id);
    Ok(())
}

struct ActiveSession {
    binding: CurrentWorkspaceBinding,
    generation: u64,
    session: Session,
    capabilities: Value,
    project_context: Option<ProjectContext>,
    opened: Option<(String, u64)>,
}

#[derive(Default)]
pub struct JavaNavigationState(
    Arc<Mutex<Option<ActiveSession>>>,
    Option<Arc<super::java_project_context::Manager>>,
    Arc<NavigationCancellationRegistry>,
);

impl JavaNavigationState {
    pub fn new(context: &super::JavaProjectContextState) -> Self {
        Self(
            Default::default(),
            Some(context.shared()),
            Default::default(),
        )
    }
    pub fn shutdown_all(&self) {
        self.2.cancel_all();
        if let Ok(mut session) = self.0.lock() {
            reset(&mut session);
        }
    }
}

impl Drop for JavaNavigationState {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

fn reset(active: &mut Option<ActiveSession>) {
    if let Some(mut active) = active.take() {
        terminate(&mut active.session.child);
    }
}

fn result(request: &JavaNavigationRequest, status: &str, message: &str) -> Value {
    json!({
        "workspaceId": request.workspace_id, "generation": request.generation,
        "requestId": request.request_id, "kind": request.kind,
        "documentPath": request.document.path, "documentVersion": request.document.version,
        "status": status, "message": message
    })
}

fn selected_context_refusal(
    request: &JavaNavigationRequest,
    message: &str,
    context_retired: bool,
) -> Value {
    let mut response = result(request, "refused", message);
    let context_retired = context_retired
        || message == super::java_project_context::SESSION_RETIRED_MESSAGE
        || message == super::java_project_context::MAVEN_RUNTIME_CHANGED_MESSAGE;
    if context_retired && request.project_context.is_some() {
        response["projectContextRetired"] = json!(true);
    }
    response
}

// Saved-input changes invalidate semantic authority. Only read-only SDK queries
// can retain the live session; refactoring and unclassified failures still reset it.
fn saved_inputs_refusal(request: &JavaNavigationRequest, message: &str) -> Result<Value, String> {
    if request.project_context.is_some() && request.editor_refactoring.is_none() {
        Ok(selected_context_refusal(request, message, true))
    } else {
        Err(message.into())
    }
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn sha256(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|value| {
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
fn integer(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(Value::as_u64)
        .filter(|number| *number <= MAX_SAFE_INTEGER)
}

pub(super) fn source(root: &Path, path: &str) -> Result<String, String> {
    if path.is_empty()
        || path.len() > 4096
        || path.contains('\\')
        || path.contains(':')
        || path.contains('\0')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("Java navigation requires a workspace-relative source path.".into());
    }
    let resolved = root
        .join(path)
        .canonicalize()
        .map_err(|_| "The Java source file is unavailable.")?;
    ensure_within_root(root, &resolved)
        .map_err(|_| "The Java source file escapes the workspace.")?;
    let metadata = fs::metadata(&resolved).map_err(|_| "The Java source file is unavailable.")?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
        return Err(
            "The Java source file exceeds the navigation limit or is not a regular file.".into(),
        );
    }
    let bytes = fs::read(resolved).map_err(|_| "The Java source file is unreadable.")?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("The Java source file exceeds the navigation limit.".into());
    }
    String::from_utf8(bytes).map_err(|_| "Java navigation requires UTF-8 source files.".into())
}

pub(super) fn valid_position(text: &str, point: &Position) -> bool {
    if point.line > MAX_SAFE_INTEGER || point.character > MAX_SAFE_INTEGER {
        return false;
    }
    let Some(line) = text.split('\n').nth(point.line as usize) else {
        return false;
    };
    let line = line.strip_suffix('\r').unwrap_or(line);
    let mut offset = 0;
    for character in line.chars() {
        if offset == point.character {
            return true;
        }
        offset += character.len_utf16() as u64;
        if offset > point.character {
            return false;
        }
    }
    offset == point.character
}

fn validate_request(request: &JavaNavigationRequest, root: &Path) -> Result<String, String> {
    let valid_direction = match request.kind.as_str() {
        "typeHierarchy" => matches!(
            request.direction.as_deref(),
            Some("supertypes" | "subtypes" | "both")
        ),
        "callHierarchy" => matches!(request.direction.as_deref(), Some("incoming" | "outgoing")),
        _ => request.direction.is_none(),
    };
    if !matches!(
        request.kind.as_str(),
        "definition"
            | "references"
            | "typeDefinition"
            | "typeHierarchy"
            | "callHierarchy"
            | "implementations"
            | "mutationSelection"
            | "diagnostics"
    ) || (request.kind == "mutationSelection") != request.editor_refactoring.is_some()
        || request.editor_refactoring.is_some()
            && (request.project_context.is_none() || request.editor_overlay.is_none())
        || request.kind == "diagnostics"
            && (request.project_context.is_none() || request.editor_overlay.is_none() || request.limit > 500)
        || request.limit == 0
        || request.limit > 1000
        || matches!(request.kind.as_str(), "definition" | "typeDefinition") && request.limit != 1
        || request.kind == "typeHierarchy" && request.limit > MAX_TYPE_HIERARCHY_ITEMS
        || request.kind == "callHierarchy" && request.limit > MAX_CALL_HIERARCHY_ITEMS
        || request.kind == "implementations" && request.limit > MAX_IMPLEMENTATION_ITEMS
        || !valid_direction
        || request.generation == 0
        || request.generation > MAX_SAFE_INTEGER
        || request.document.version == 0
        || request.document.version > MAX_SAFE_INTEGER
        || request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.request_id.chars().any(char::is_control)
        || !request.document.path.ends_with(".java")
        || request.document.text.len() as u64 > MAX_SOURCE_BYTES
    {
        return Err("Invalid or oversized Java navigation request.".into());
    }
    let text = source(root, &request.document.path)?;
    if let Some(overlay) = &request.editor_overlay {
        let mut paths = std::collections::HashSet::new();
        if request.project_context.is_none()
            || overlay.documents.is_empty()
            || overlay.documents.len() > 128
            || overlay.documents.iter().any(|document| {
                !paths.insert(&document.path)
                    || document.version == 0
                    || document.version > i32::MAX as u64
                    || !document.path.ends_with(".java")
                    || document.text.len() as u64 > MAX_SOURCE_BYTES
                    || source(root, &document.path).is_err()
            })
            || overlay
                .documents
                .iter()
                .map(|document| document.text.len())
                .sum::<usize>()
                > MAX_PREVIEW_BYTES
            || !overlay.documents.iter().any(|document| {
                document.path == request.document.path && document.text == request.document.text
                    // Position navigation also correlates a Monaco model version, which can
                    // differ from the editor-buffer inventory's independent version counter.
                    && (request.kind != "diagnostics" || document.version == request.document.version)
            })
        {
            return Err("Invalid immutable Java editor overlay.".into());
        }
    } else if text != request.document.text {
        return Err(
            "Save this Java file before binding navigation; editor overlays are unavailable."
                .into(),
        );
    }
    if !valid_position(&request.document.text, &request.position) {
        return Err("The Java editor position is stale or outside the source file.".into());
    }
    Ok(text)
}

fn advertised(capabilities: &Value, kind: &str) -> bool {
    if capabilities["name"] != "RefactorKit"
        || capabilities["apiVersion"] != "0.2"
        || capabilities["protocol"] != "json-rpc-2.0"
        || capabilities["transport"] != "stdio"
        || capabilities["version"]
            .as_str()
            .is_none_or(|version| version.is_empty() || version.len() > 128)
    {
        return false;
    }
    let Some(methods) = capabilities["methods"].as_array() else {
        return false;
    };
    let query: Vec<_> = methods
        .iter()
        .filter(|method| method["name"] == "intelligence.query")
        .collect();
    let open: Vec<_> = methods
        .iter()
        .filter(|method| method["name"] == "project.open")
        .collect();
    if query.len() != 1 || open.len() != 1 {
        return false;
    }
    let method = query[0];
    if kind == "diagnostics" {
        return method["requiresProject"] == true
            && method["writesWorkspace"] == false
            && open[0]["writesWorkspace"] == false
            && matches!(method["stability"].as_str(), Some("experimental" | "beta-contract" | "stable"))
            && ["javaImmutableEditorOverlayDiagnostics", "snapshotBound", "typedRefusal", "bounded"]
                .iter().all(|feature| method["features"][*feature] == true);
    }
    if kind == "mutationSelection" {
        return method["requiresProject"] == true
            && method["writesWorkspace"] == false
            && capabilities["javaContextRefactoring"]["editorSelectionSchemaVersion"]
                == "java-editor-mutation-selection-v1"
            && capabilities["javaContextRefactoring"]["dirtyEditorPreview"] == true
            && capabilities["javaContextRefactoring"]["editorPreviewMethod"]
                == "refactor.editor.preview"
            && capabilities["javaContextRefactoring"]["editorPreviewSchemaVersion"]
                == "java-editor-refactoring-v1"
            && methods.iter().any(|m| {
                m["name"] == "refactor.editor.preview"
                    && m["requiresProject"] == true
                    && m["writesWorkspace"] == false
            });
    }
    let (specific, position) = match kind {
        "definition" => ("javaSavedSnapshotDefinition", "definitionAtPosition"),
        "references" => ("javaSavedSnapshotReferences", "referencesAtPosition"),
        "typeDefinition" => (
            "javaSavedSnapshotTypeDefinition",
            "typeDefinitionAtPosition",
        ),
        "typeHierarchy" => ("javaSavedSnapshotTypeHierarchy", "typeHierarchyAtPosition"),
        "callHierarchy" => ("javaSavedSnapshotCallHierarchy", "callHierarchyAtPosition"),
        "implementations" => (
            "javaSavedSnapshotImplementations",
            "implementationsAtPosition",
        ),
        _ => return false,
    };
    method["requiresProject"] == true
        && method["writesWorkspace"] == false
        && matches!(
            method["stability"].as_str(),
            Some("experimental" | "beta-contract" | "stable")
        )
        && [
            specific,
            position,
            "snapshotBound",
            "typedRefusal",
            "bounded",
        ]
        .iter()
        .all(|name| method["features"][*name] == true)
        && open[0]["writesWorkspace"] == false
}

fn open(
    session: &mut Session,
    root: &Path,
    context: Option<&ProjectContext>,
    request_id: &str,
    phase: &str,
    cancelled: &AtomicBool,
) -> Result<(String, u64), String> {
    let mut params = json!({"root": root, "resolveDependencies": false});
    if let Some(context) = context {
        params["activeMavenProfiles"] = json!(context.active_maven_profiles);
        params["inactiveMavenProfiles"] = json!(context.inactive_maven_profiles);
        if !context.maven_repository.is_empty() {
            params["mavenRepository"] = json!(context.maven_repository);
        }
    }
    let started = Instant::now();
    let response = session_call_detailed_cancellable(
        session,
        "project.open",
        params,
        REQUEST_TIMEOUT,
        cancelled,
    );
    trace_navigation_phase(request_id, phase, started, response.is_ok());
    let value = response.map_err(|_| "RefactorKit could not open the saved Java project.")?;
    let returned_root = value["root"]
        .as_str()
        .and_then(|path| Path::new(path).canonicalize().ok());
    let hash = sha256(value.get("snapshotHash")).ok_or("Invalid RefactorKit project snapshot.")?;
    let generation = integer(value.get("indexGeneration"))
        .filter(|number| *number > 0)
        .ok_or("Invalid RefactorKit index generation.")?;
    if returned_root.as_deref() != Some(root) {
        return Err("RefactorKit opened another workspace.".into());
    }
    Ok((hash.to_string(), generation))
}

pub(super) fn point(value: &Value) -> Result<Position, String> {
    Ok(Position {
        line: integer(value.get("line")).ok_or("Invalid Java location line.")?,
        character: integer(value.get("character")).ok_or("Invalid Java location column.")?,
    })
}

pub(super) fn normalize_editor_overlay_authority(
    raw: &Value,
    expected: &[Document],
    base_hash: &str,
    expected_overlay_hash: Option<&str>,
) -> Result<Value, String> {
    let authority = &raw["sourceAuthority"];
    let documents = authority["documents"]
        .as_array()
        .ok_or("Missing immutable Java document authority.")?;
    if authority["kind"] != "immutable-editor-overlay"
        || authority["baseSnapshotHash"] != base_hash
        || sha256(authority.get("overlayHash")).is_none()
        || sha256(raw.get("providerSnapshotHash")).is_none()
        || expected_overlay_hash.is_some_and(|hash| authority["overlayHash"] != hash)
        || documents.len() != expected.len()
        || expected.iter().any(|original| {
            documents
                .iter()
                .filter(|actual| {
                    actual["path"] == original.path
                        && actual["version"] == original.version
                        && actual["contentSha256"] == digest(original.text.as_bytes())
                })
                .count()
                != 1
        })
    {
        return Err("RefactorKit did not attest the immutable Java editor buffers.".into());
    }
    Ok(
        json!({"baseSnapshotHash":base_hash,"providerSnapshotHash":raw["providerSnapshotHash"],
        "overlayHash":authority["overlayHash"],"documents":documents}),
    )
}

pub(super) fn normalize_location(
    location: &Value,
    root: &Path,
    overlay: Option<&EditorOverlay>,
    contents: &mut HashMap<String, String>,
    preview_bytes: &mut usize,
) -> Result<Value, String> {
    let path = location["path"]
        .as_str()
        .ok_or("Invalid Java source location.")?;
    if !contents.contains_key(path) {
        let text = if let Some(document) = overlay.and_then(|overlay| {
            overlay
                .documents
                .iter()
                .find(|document| document.path == path)
        }) {
            document.text.clone()
        } else {
            source(root, path)?
        };
        *preview_bytes += text.len();
        if *preview_bytes > MAX_PREVIEW_BYTES {
            return Err(
                "Java navigation previews exceed the 8 MiB source limit; request fewer results."
                    .into(),
            );
        }
        contents.insert(path.to_string(), text);
    }
    let text = &contents[path];
    let start = point(&location["range"]["start"])?;
    let end = point(&location["range"]["end"])?;
    if !valid_position(text, &start)
        || !valid_position(text, &end)
        || (end.line, end.character) < (start.line, start.character)
    {
        return Err("RefactorKit returned an invalid UTF-16 Java source range.".into());
    }
    Ok(
        json!({"path": path, "range": {"start": {"line": start.line, "character": start.character}, "end": {"line": end.line, "character": end.character}}}),
    )
}

fn bounded_string_field<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty() && text.len() <= max)
        .ok_or_else(|| format!("Invalid Java method identity field `{key}`."))
}

fn normalize_method_identity(value: &Value) -> Result<Value, String> {
    if value["schemaVersion"] != "java-method-binding-identity-v1" {
        return Err("Unsupported Java method binding identity schema.".into());
    }
    let name = bounded_string_field(value, "name", 1024)?;
    let qualified_name = bounded_string_field(value, "qualifiedName", 4096)?;
    let binding_key = bounded_string_field(value, "bindingKey", 8192)?;
    let jvm_identity = match value.get("jvmIdentity") {
        Some(Value::Null) => Value::Null,
        Some(identity) => {
            let kind = bounded_string_field(identity, "kind", 16)?;
            if !matches!(kind, "type" | "callable" | "field") {
                return Err("Invalid Java JVM method identity kind.".into());
            }
            json!({
                "kind": kind,
                "ownerBinaryName": bounded_string_field(identity, "ownerBinaryName", 1024)?,
                "memberName": bounded_string_field(identity, "memberName", 1024)?,
                "descriptor": bounded_string_field(identity, "descriptor", 4096)?,
            })
        }
        None => return Err("Java method identity omitted its JVM identity field.".into()),
    };
    Ok(json!({
        "schemaVersion": "java-method-binding-identity-v1",
        "name": name,
        "qualifiedName": qualified_name,
        "bindingKey": binding_key,
        "jvmIdentity": jvm_identity,
    }))
}

fn normalize(
    raw: Value,
    request: &JavaNavigationRequest,
    root: &Path,
    hash: &str,
    generation: u64,
    source_hash: &str,
    version: &str,
) -> Result<Value, String> {
    if raw["schemaVersion"] != 1
        || raw["requestId"] != request.request_id
        || raw["kind"] != request.kind
        || raw["snapshotHash"] != hash
        || integer(raw.get("indexGeneration")).is_none_or(|number| number < generation)
    {
        return Err("RefactorKit returned stale or uncorrelated Java navigation evidence.".into());
    }
    if raw["status"] == "refused" {
        let message = raw["error"]["message"]
            .as_str()
            .filter(|message| !message.is_empty() && message.len() <= 1024)
            .ok_or("Invalid RefactorKit refusal.")?;
        let mut response = result(request, "refused", message);
        if let Some(code) = raw["error"]["code"].as_str().filter(|code| {
            !code.is_empty()
                && code.len() <= 128
                && code
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
                && code
                    .chars()
                    .next()
                    .is_some_and(|character| character.is_ascii_alphanumeric())
        }) {
            response["refusalCode"] = json!(code);
        }
        return Ok(response);
    }
    if request.kind == "diagnostics" {
        return super::java_editor_diagnostics::normalize(raw, request, root, hash, version);
    }
    if raw["status"] != "ready"
        || raw["providerId"] != "java-jdt-bindings-v1"
        || raw["backend"] != BACKEND
        || raw["evidence"] != "compiler"
        || !matches!(raw["completeness"].as_str(), Some("semantic" | "partial"))
        || matches!(request.kind.as_str(), "definition" | "references")
            && raw["completeness"] != "semantic"
        || sha256(raw.get("provenanceHash")).is_none()
    {
        return Err(
            "RefactorKit did not attest the requested Java source and compiler bindings.".into(),
        );
    }
    if request.kind != "callHierarchy" && raw.get("targetScope").is_some() {
        return Err(
            "RefactorKit returned call-hierarchy target scope for another query kind.".into(),
        );
    }
    let overlay_receipt = if let Some(overlay) = &request.editor_overlay {
        Some(normalize_editor_overlay_authority(
            &raw,
            &overlay.documents,
            hash,
            None,
        )?)
    } else {
        if raw["sourceAuthority"]["kind"] != "saved-snapshot"
            || raw["sourceAuthority"]["path"] != request.document.path
            || raw["sourceAuthority"]["contentSha256"] != source_hash
        {
            return Err("RefactorKit did not attest the requested saved Java source.".into());
        }
        None
    };
    if let Some(context) = &request.project_context {
        if raw["contextSchemaVersion"].as_str() != Some(context.context_schema_version.as_str())
            || raw["contextHash"] != context.context_hash
            || raw["platformIdentities"] != json!(context.platform_identities)
        {
            return Err(
                "RefactorKit did not attest the selected Java SDK and effective project context."
                    .into(),
            );
        }
    }
    if request.kind == "mutationSelection" {
        super::java_editor_refactoring::validate_selection(&raw, request)?;
        return Ok(raw);
    }
    let mut contents = HashMap::new();
    let mut preview_bytes = 0;
    let mut locations = Vec::new();
    let mut items = Vec::new();
    let mut root_name = None;
    let mut target_kind = None;
    let mut scope = None;
    let mut target_scope = None;
    let mut direction = None;
    match request.kind.as_str() {
        "definition" | "references" => {
            let values = raw[if request.kind == "definition" {
                "locations"
            } else {
                "references"
            }]
            .as_array()
            .ok_or("Invalid Java locations.")?;
            if values.len() > request.limit as usize
                || request.kind == "definition" && values.len() > 1
            {
                return Err("Java navigation exceeds the requested result limit.".into());
            }
            for location in values {
                if locations.len() >= MAX_NAVIGATION_LOCATIONS {
                    return Err(
                        "Java navigation result exceeds the supported location limit.".into(),
                    );
                }
                locations.push(normalize_location(
                    location,
                    root,
                    request.editor_overlay.as_ref(),
                    &mut contents,
                    &mut preview_bytes,
                )?);
            }
        }
        "typeDefinition" => {
            let values = raw["locations"]
                .as_array()
                .ok_or("Invalid Java type definition locations.")?;
            if values.len() > 1
                || raw["target"]["name"].as_str().is_none()
                || raw["scope"] != "workspace-source"
            {
                return Err("Java type definition exceeds its result limit.".into());
            }
            root_name = raw["target"]["name"].as_str().map(str::to_string);
            scope = raw["scope"].as_str().map(str::to_string);
            for location in values {
                if locations.len() >= MAX_NAVIGATION_LOCATIONS {
                    return Err(
                        "Java navigation result exceeds the supported location limit.".into(),
                    );
                }
                locations.push(normalize_location(
                    location,
                    root,
                    request.editor_overlay.as_ref(),
                    &mut contents,
                    &mut preview_bytes,
                )?);
            }
        }
        "typeHierarchy" => {
            let raw_items = raw["items"]
                .as_array()
                .ok_or("Invalid Java type hierarchy items.")?;
            if raw_items.len() > request.limit as usize {
                return Err("Java type hierarchy exceeds the requested result limit.".into());
            }
            root_name = raw["root"]["name"].as_str().map(str::to_string);
            scope = raw["scope"].as_str().map(str::to_string);
            direction = raw["direction"].as_str().map(str::to_string);
            if root_name.is_none()
                || scope.as_deref() != Some("workspace-source")
                || direction != request.direction
            {
                return Err("Invalid Java type hierarchy authority or direction.".into());
            }
            for item in raw_items {
                let relation = item["relation"]
                    .as_str()
                    .ok_or("Missing Java hierarchy relation.")?;
                if !matches!(relation, "supertype" | "subtype") {
                    return Err("Invalid Java hierarchy relation.".into());
                }
                let symbol = &item["symbol"];
                let label = symbol["name"]
                    .as_str()
                    .filter(|name| !name.is_empty() && name.len() <= 1024)
                    .ok_or("Invalid Java hierarchy symbol.")?;
                let location = normalize_location(
                    &symbol["location"],
                    root,
                    request.editor_overlay.as_ref(),
                    &mut contents,
                    &mut preview_bytes,
                )?;
                locations.push(location.clone());
                items.push(json!({"label": label, "relation": relation, "location": location}));
            }
        }
        "callHierarchy" => {
            let raw_items = raw["items"]
                .as_array()
                .ok_or("Invalid Java call hierarchy items.")?;
            if raw_items.len() > request.limit as usize {
                return Err("Java call hierarchy exceeds the requested result limit.".into());
            }
            root_name = raw["root"]["name"].as_str().map(str::to_string);
            scope = raw["scope"].as_str().map(str::to_string);
            direction = raw["direction"].as_str().map(str::to_string);
            target_scope = raw
                .get("targetScope")
                .and_then(Value::as_str)
                .map(str::to_string);
            if root_name.is_none()
                || scope.as_deref() != Some("workspace-direct-invocations")
                || direction != request.direction
                || raw.get("targetScope").is_some()
                    && target_scope.as_deref() != Some("workspace-source+resolved-classpath")
            {
                return Err("Invalid Java call hierarchy authority or direction.".into());
            }
            for item in raw_items {
                let method = item.get("method").filter(|method| !method.is_null());
                let identity = item
                    .get("methodIdentity")
                    .map(normalize_method_identity)
                    .transpose()?;
                let source_navigation = item.get("sourceNavigation");
                if target_scope.is_some() && (identity.is_none() || source_navigation.is_none()) {
                    return Err("Classpath call hierarchy omitted a method identity or source-navigation status.".into());
                }
                let location = if let Some(method) = method {
                    let method_name = bounded_string_field(method, "name", 1024)?;
                    let method_location = normalize_location(
                        &method["location"],
                        root,
                        request.editor_overlay.as_ref(),
                        &mut contents,
                        &mut preview_bytes,
                    )?;
                    if let Some(source) = source_navigation {
                        if source["status"] != "available" || source.get("reason").is_some() {
                            return Err("Workspace call hierarchy target has invalid source-navigation status.".into());
                        }
                        let source_location = normalize_location(
                            &source["location"],
                            root,
                            request.editor_overlay.as_ref(),
                            &mut contents,
                            &mut preview_bytes,
                        )?;
                        if source_location != method_location {
                            return Err("Call hierarchy source navigation disagrees with its method location.".into());
                        }
                    }
                    let label = identity
                        .as_ref()
                        .and_then(|identity| identity["qualifiedName"].as_str())
                        .unwrap_or(method_name);
                    locations.push(method_location.clone());
                    Some((label.to_string(), method_location))
                } else {
                    if target_scope.is_none()
                        || identity.is_none()
                        || source_navigation.is_none_or(|source| {
                            source["status"] != "unavailable"
                                || source["reason"] != "classpathSourceUnavailable"
                                || source.get("location") != Some(&Value::Null)
                        })
                    {
                        return Err("Binary call hierarchy target lacks an explicit unavailable source-navigation status.".into());
                    }
                    let identity = identity.as_ref().unwrap();
                    let label = identity["qualifiedName"]
                        .as_str()
                        .ok_or("Invalid Java call hierarchy method identity.")?;
                    Some((label.to_string(), Value::Null))
                };
                let call_sites = item["callSites"]
                    .as_array()
                    .ok_or("Invalid Java call sites.")?;
                if call_sites.len() > 1000
                    || locations.len().saturating_add(call_sites.len() + 1)
                        > MAX_NAVIGATION_LOCATIONS
                {
                    return Err("Java call hierarchy exceeds the supported location limit.".into());
                }
                let mut normalized_call_sites = Vec::with_capacity(call_sites.len());
                for call_site in call_sites {
                    let call_site = normalize_location(
                        call_site,
                        root,
                        request.editor_overlay.as_ref(),
                        &mut contents,
                        &mut preview_bytes,
                    )?;
                    locations.push(call_site.clone());
                    normalized_call_sites.push(call_site);
                }
                let (label, method_location) =
                    location.ok_or("Invalid Java call hierarchy method.")?;
                let mut normalized_item =
                    json!({"label": label, "callSites": normalized_call_sites});
                if !method_location.is_null() {
                    normalized_item["location"] = method_location.clone();
                    if source_navigation.is_some() {
                        normalized_item["sourceNavigation"] =
                            json!({"status":"available","location":method_location});
                    }
                } else if source_navigation.is_some() {
                    normalized_item["sourceNavigation"] = json!({
                        "status":"unavailable",
                        "reason":"classpathSourceUnavailable",
                        "location":null
                    });
                }
                if let Some(identity) = identity {
                    normalized_item["methodIdentity"] = identity;
                }
                items.push(normalized_item);
            }
        }
        "implementations" => {
            let raw_items = raw["items"]
                .as_array()
                .ok_or("Invalid Java implementation items.")?;
            if raw_items.len() > request.limit as usize {
                return Err("Java implementations exceed the requested result limit.".into());
            }
            root_name = raw["root"]["name"].as_str().map(str::to_string);
            target_kind = raw["targetKind"].as_str().map(str::to_string);
            scope = raw["scope"].as_str().map(str::to_string);
            if root_name
                .as_ref()
                .is_none_or(|name| name.is_empty() || name.len() > 1024)
                || !matches!(target_kind.as_deref(), Some("type" | "method"))
                || scope.as_deref() != Some("workspace-source")
            {
                return Err("Invalid Java implementation target or scope.".into());
            }
            for item in raw_items {
                let relation = item["relation"]
                    .as_str()
                    .ok_or("Missing Java implementation relation.")?;
                let expected_relation = if target_kind.as_deref() == Some("type") {
                    "concreteType"
                } else {
                    "concreteMethod"
                };
                if relation != expected_relation {
                    return Err(
                        "Java implementation relation disagrees with its target kind.".into(),
                    );
                }
                let symbol = &item["symbol"];
                let label = symbol["name"]
                    .as_str()
                    .filter(|name| !name.is_empty() && name.len() <= 1024)
                    .ok_or("Invalid Java implementation symbol.")?;
                let location = normalize_location(
                    &symbol["location"],
                    root,
                    request.editor_overlay.as_ref(),
                    &mut contents,
                    &mut preview_bytes,
                )?;
                locations.push(location.clone());
                items.push(json!({"label": label, "relation": relation, "location": location}));
            }
        }
        _ => return Err("Unsupported Java navigation result kind.".into()),
    }
    let (total, returned, truncated, complete, warning_count) =
        if matches!(request.kind.as_str(), "definition" | "typeDefinition") {
            let returned = locations.len() as u64;
            (
                returned,
                returned,
                false,
                request.kind == "definition" || raw["completeness"] == "semantic",
                0,
            )
        } else {
            let total = integer(raw.get("total")).ok_or("Invalid Java reference total.")?;
            let returned = integer(raw.get("returned")).ok_or("Invalid Java result count.")?;
            let truncated = raw["truncated"]
                .as_bool()
                .ok_or("Missing Java result truncation.")?;
            let complete = raw["complete"]
                .as_bool()
                .ok_or("Missing Java result completeness.")?;
            let warnings = integer(raw.get("warningCount")).ok_or("Invalid Java warning count.")?;
            let expected_returned = if matches!(
                request.kind.as_str(),
                "typeHierarchy" | "callHierarchy" | "implementations"
            ) {
                items.len() as u64
            } else {
                locations.len() as u64
            };
            if returned != expected_returned || total < returned || truncated != (total > returned)
            {
                return Err("Inconsistent Java navigation coverage.".into());
            }
            if request.kind == "typeHierarchy" && complete != (raw["completeness"] == "semantic")
                || request.kind == "implementations"
                    && complete != (raw["completeness"] == "semantic")
                || request.kind == "callHierarchy" && (complete || raw["completeness"] != "partial")
            {
                return Err("Java hierarchy completeness disagrees with its evidence.".into());
            }
            (total, returned, truncated, complete, warnings)
        };
    let mut files: Vec<_> = contents.into_iter().collect();
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let files: Vec<_> = files
        .into_iter()
        .map(|(path, text)| json!({"path": path, "text": text}))
        .collect();
    let mut normalized = json!({
        "workspaceId": request.workspace_id, "generation": request.generation, "requestId": request.request_id,
        "kind": request.kind, "documentPath": request.document.path, "documentVersion": request.document.version,
        "status": "ready", "locations": locations, "sourceFiles": files, "items": items, "returned": returned,
        "total": total, "truncated": truncated, "complete": complete,
        "warningCount": warning_count, "snapshotHash": hash, "indexGeneration": raw["indexGeneration"], "sourceHash": source_hash,
        "provider": {"name": "RefactorKit", "version": version, "backend": BACKEND, "evidence": "compiler"}
    });
    if let Some(direction) = direction {
        normalized["direction"] = json!(direction);
    }
    if let Some(root_name) = root_name {
        normalized["rootName"] = json!(root_name);
    }
    if let Some(target_kind) = target_kind {
        normalized["targetKind"] = json!(target_kind);
    }
    if let Some(scope) = scope {
        normalized["scope"] = json!(scope);
    }
    if let Some(target_scope) = target_scope {
        normalized["targetScope"] = json!(target_scope);
    }
    if let Some(context) = &request.project_context {
        normalized["projectContext"] = json!({"projectPath":context.project_path,"contextHash":raw["contextHash"],
            "contextSchemaVersion":raw["contextSchemaVersion"],"platformIdentities":raw["platformIdentities"]});
    }
    if let Some(receipt) = overlay_receipt {
        normalized["editorOverlay"] = receipt;
    }
    Ok(normalized)
}

fn prefix_project_paths(value: &mut Value, project_path: &str) {
    fn prefix_path(value: &mut Value, project_path: &str) {
        if let Some(path) = value.get("path").and_then(Value::as_str) {
            value["path"] = json!(format!("{project_path}/{path}"));
        }
    }

    for key in ["locations", "sourceFiles"] {
        if let Some(items) = value.get_mut(key).and_then(Value::as_array_mut) {
            for item in items {
                prefix_path(item, project_path);
            }
        }
    }
    if let Some(items) = value.get_mut("items").and_then(Value::as_array_mut) {
        for item in items {
            if let Some(location) = item.get_mut("location") {
                prefix_path(location, project_path);
            }
            if let Some(location) = item
                .get_mut("sourceNavigation")
                .and_then(|navigation| navigation.get_mut("location"))
            {
                prefix_path(location, project_path);
            }
            if let Some(call_sites) = item.get_mut("callSites").and_then(Value::as_array_mut) {
                for call_site in call_sites {
                    prefix_path(call_site, project_path);
                }
            }
        }
    }
    if let Some(documents) = value
        .get_mut("editorOverlay")
        .and_then(|authority| authority.get_mut("documents"))
        .and_then(Value::as_array_mut)
    {
        for item in documents {
            prefix_path(item, project_path);
        }
    }
}

fn qualify_project_paths(value: &mut Value, context: &ProjectContext) {
    if !context.project_path.is_empty() {
        prefix_project_paths(value, &context.project_path);
    }
}

pub(super) fn java_context_authority(context: &ProjectContext, sdk: &Path) -> Value {
    json!({"sdkHome":sdk,"expectedContextHash":context.context_hash,
        "contextSchemaVersion":context.context_schema_version})
}

fn navigation_context_verification_request(
    context: &ProjectContext,
    sdk: &Path,
    selected: Option<&(String, Value)>,
) -> Result<(String, Value), String> {
    let method = match context.context_schema_version.as_str() {
        "java-project-context-v1" | "java-project-context-v2" => "project.context",
        "java-project-context-v3" => "project.context.aggregate",
        "java-project-context-v4" => "project.context.v4",
        "java-project-context-v5" => "project.context.v5",
        "java-project-context-v6" => "project.context.v6",
        "java-project-context-v7" => "project.context.v7",
        _ => return Err("Unsupported Java context verification schema.".into()),
    };
    let mut params = match selected {
        Some((selected_method, params)) if selected_method == method && params.is_object() => {
            params.clone()
        }
        None if method == "project.context" => json!({}),
        _ => {
            return Err(
                "Synchronize the Java project to restore its exact context selection.".into(),
            )
        }
    };
    params["sdkHome"] = json!(sdk);
    params["expectedSnapshotHash"] = json!(context.snapshot_hash);
    // The aggregate route accepts only snapshot, SDK and required-fact fields.
    // verify_context still compares the returned context hash with our authority.
    if method != "project.context.aggregate" {
        params["expectedContextHash"] = json!(context.context_hash);
    }
    Ok((method.into(), params))
}

#[allow(clippy::too_many_arguments)]
#[derive(Debug, PartialEq)]
enum ContextVerification {
    Current,
    SnapshotStale,
}
const CONTEXT_CHANGED_MESSAGE: &str =
    "The selected Java SDK or project inputs changed during navigation.";

fn navigation_reports_stale_snapshot(
    raw: &Value,
    request: &JavaNavigationRequest,
    snapshot_hash: &str,
    generation: u64,
) -> bool {
    request.project_context.is_some()
        && raw["schemaVersion"] == 1
        && raw["requestId"] == request.request_id
        && raw["kind"] == request.kind
        && raw["status"] == "refused"
        && raw["error"]["code"] == "java.context.snapshotStale"
        && raw["error"]["message"]
            .as_str()
            .is_some_and(|message| !message.is_empty() && message.len() <= 1024 && !message.contains('\0'))
        && sha256(raw.get("snapshotHash")).is_some_and(|hash| hash != snapshot_hash)
        && integer(raw.get("indexGeneration")).is_some_and(|value| value >= generation)
        && ["locations", "sourceFiles", "selection", "sourceAuthority", "contextHash"]
            .iter()
            .all(|field| raw[*field].is_null())
}

fn context_verification_result(
    raw: &Value,
    context: &ProjectContext,
) -> Result<ContextVerification, String> {
    // A complete typed snapshot refusal is an expected saved-input change, not
    // evidence of a broken transport. No compiler authority may accompany it.
    if raw["schemaVersion"] == context.context_schema_version
        && raw["status"] == "refused"
        && raw["refusal"]["code"] == "java.context.snapshotStale"
        && sha256(raw.get("snapshotHash")).is_some()
        && raw["snapshotHash"] != context.snapshot_hash
        && raw["contextHash"].is_null()
        && raw["analysis"].is_null()
        && raw["selectedSource"].is_null()
        && ["sdk", "modules", "providers", "buildEvidence"]
            .iter()
            .all(|field| raw[*field].as_array().is_some_and(Vec::is_empty))
        && raw["refusal"]["message"].as_str().is_some_and(|message| {
            !message.is_empty() && message.len() <= 4096 && !message.contains('\0')
        })
    {
        return Ok(ContextVerification::SnapshotStale);
    }
    let identities = raw["sdk"].as_array().map(|items| {
        items
            .iter()
            .map(|item| item["identitySha256"].clone())
            .collect::<Vec<_>>()
    });
    let expected = context
        .platform_identities
        .iter()
        .map(|identity| json!(identity))
        .collect::<Vec<_>>();
    if raw["status"] != "available"
        || raw["schemaVersion"] != context.context_schema_version
        || raw["snapshotHash"] != context.snapshot_hash
        || raw["contextHash"] != context.context_hash
        || identities.as_ref() != Some(&expected)
    {
        return Err(CONTEXT_CHANGED_MESSAGE.into());
    }
    Ok(ContextVerification::Current)
}

fn verify_context(
    session: &mut Session,
    context: &ProjectContext,
    sdk: &Path,
    selected: Option<&(String, Value)>,
    request_id: &str,
    phase: &str,
    cancelled: &AtomicBool,
) -> Result<ContextVerification, String> {
    let started = Instant::now();
    let (method, params) = navigation_context_verification_request(context, sdk, selected)?;
    let response =
        session_call_detailed_cancellable(session, &method, params, REQUEST_TIMEOUT, cancelled);
    trace_navigation_phase(request_id, phase, started, response.is_ok());
    let raw = response.map_err(|_| "Java project inputs changed during navigation.")?;
    let identities = raw["sdk"].as_array().map(|items| {
        items
            .iter()
            .map(|item| item["identitySha256"].clone())
            .collect::<Vec<_>>()
    });
    let expected_identities = context
        .platform_identities
        .iter()
        .map(|identity| json!(identity))
        .collect::<Vec<_>>();
    trace_snapshot(
        "navigation.projectContext.verify",
        json!({
            "requestId": request_id,
            "method": method,
            "expectedSchemaVersion": context.context_schema_version,
            "status": raw["status"],
            "schemaVersion": raw["schemaVersion"],
            "snapshotHashMatches": raw["snapshotHash"] == context.snapshot_hash,
            "observedSnapshotHash": raw["snapshotHash"],
            "contextHashMatches": raw["contextHash"] == context.context_hash,
            "observedContextHash": raw["contextHash"],
            "platformIdentitiesMatch": identities.as_ref() == Some(&expected_identities),
            "observedPlatformIdentities": identities,
            "expectedPlatformIdentities": expected_identities,
        }),
    );
    context_verification_result(&raw, context)
}

fn query_owned_cancellable(
    binding: CurrentWorkspaceBinding,
    original_request: JavaNavigationRequest,
    state: Arc<Mutex<Option<ActiveSession>>>,
    sdk_state: Option<Arc<super::java_project_context::Manager>>,
    cancelled: Arc<AtomicBool>,
) -> Result<Value, String> {
    let request_started = Instant::now();
    if cancelled.load(Ordering::SeqCst) {
        return Ok(result(
            &original_request,
            "refused",
            "The Java navigation request was canceled.",
        ));
    }
    let (project, sdk) = if let Some(context) = &original_request.project_context {
        if [&context.snapshot_hash, &context.context_hash]
            .iter()
            .any(|value| sha256(Some(&json!(value))).is_none())
            || context.gradle.as_ref().is_some_and(|s| !s.valid())
            || !super::java_project_context::valid_context_schema_version(
                &context.context_schema_version,
            )
            || context.platform_identities.is_empty()
            || context.platform_identities.len() > 256
            || context
                .platform_identities
                .iter()
                .any(|value| sha256(Some(&json!(value))).is_none())
        {
            return Ok(result(
                &original_request,
                "refused",
                "Invalid Java project context identity.",
            ));
        }
        match super::java_project_context::validate_operation_settings(
            &binding,
            original_request.generation,
            &context.context_schema_version,
            &context.project_path,
            &context.sdk_home,
            &context.maven_repository,
            &context.active_maven_profiles,
            &context.inactive_maven_profiles,
        ) {
            Ok((root, sdk)) => (root, Some(sdk)),
            Err(message) => return Ok(result(&original_request, "refused", &message)),
        }
    } else {
        (binding.canonical_root.clone(), None)
    };
    let root = &project;
    let mut request = original_request.clone();
    if let Some(context) = &request.project_context {
        if !context.project_path.is_empty() {
            let Some(relative) = request
                .document
                .path
                .strip_prefix(&format!("{}/", context.project_path))
            else {
                return Ok(result(
                    &original_request,
                    "refused",
                    "The Java source is outside the selected project.",
                ));
            };
            request.document.path = relative.into();
            if let Some(overlay) = &mut request.editor_overlay {
                for document in &mut overlay.documents {
                    let Some(relative) = document
                        .path
                        .strip_prefix(&format!("{}/", context.project_path))
                    else {
                        return Ok(result(
                            &original_request,
                            "refused",
                            "A Java editor buffer is outside the selected project.",
                        ));
                    };
                    document.path = relative.into();
                }
            }
        }
    }
    let text = match validate_request(&request, root) {
        Ok(text) => text,
        Err(message) => return Ok(result(&original_request, "refused", &message)),
    };
    let overlay_saved = request
        .editor_overlay
        .as_ref()
        .map(|overlay| {
            overlay
                .documents
                .iter()
                .map(|document| {
                    source(root, &document.path)
                        .map(|text| (document.path.clone(), digest(text.as_bytes())))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    if !current_workspace_binding_is_current(&binding) {
        return Ok(result(
            &original_request,
            "refused",
            "The Java workspace changed.",
        ));
    }
    if let Some(context) = &request.project_context {
        let Some(shared) = sdk_state else {
            return Ok(result(
                &original_request,
                "refused",
                "Synchronize the Java project in the shared SDK session before navigating.",
            ));
        };
        let expected =
            serde_json::to_value(context).map_err(|_| "Invalid Java project settings.")?;
        let mut selected_context_retired = false;
        let response = super::java_project_context::with_selected_session(
            &shared,
            &binding,
            request.generation,
            &expected,
            |active| {
                let operation = (|| -> Result<Value, String> {
                    let mutating = request.editor_refactoring.as_ref().is_some_and(|spec| {
                        spec.mutation_mode.as_deref() == Some("durable-editor-owned")
                    });
                    if mutating && active.editor_reviews.len() >= 16 {
                        return Err("Editor plan retention limit reached; synchronize after resolving pending transactions.".into());
                    }
                    let response = query_session(
                        &binding,
                        &original_request,
                        &request,
                        root,
                        sdk.as_deref(),
                        &text,
                        overlay_saved.as_deref(),
                        &mut active.session,
                        &active.capabilities,
                        &mut active.opened,
                        active.context_verification.as_ref(),
                        &cancelled,
                    )?;
                    if mutating
                        && response["editorPreview"]["mutationMode"] == "durable-editor-owned"
                    {
                        let id = response["planId"]
                            .as_str()
                            .ok_or("Missing retained editor plan.")?;
                        active.editor_reviews.insert(id.into(), json!({"context":expected,"planHash":response["editorPreview"]["planHash"]}));
                    }
                    Ok(response)
                })();
                selected_context_retired = operation.is_err();
                if request.editor_refactoring.is_none()
                    && operation.as_ref().is_ok_and(|response| {
                        response["status"] == "refused" && response["projectContextRetired"] == true
                    })
                {
                    active.retire_context();
                    trace_snapshot(
                        "navigation.projectContext.retired",
                        json!({
                            "requestId": request.request_id, "reason": "savedInputsChanged", "sessionId": active.session_id,
                        }),
                    );
                }
                operation
            },
        );
        let response = response.unwrap_or_else(|message| {
            selected_context_refusal(&original_request, &message, selected_context_retired)
        });
        trace_snapshot(
            "navigation.request.complete",
            json!({
                "requestId": original_request.request_id,
                "elapsedMs": request_started.elapsed().as_millis(),
                "status": response["status"],
            }),
        );
        return Ok(response);
    }
    let mut manager = state
        .lock()
        .map_err(|_| "Java navigation is unavailable.")?;
    if manager.as_mut().is_some_and(|active| {
        active.binding != binding
            || active.generation != request.generation
            || active.session.root != project
            || active.project_context != request.project_context
            || active.session.child.try_wait().ok().flatten().is_some()
    }) {
        reset(&mut manager);
    }
    if manager.is_none() {
        let mut session = match spawn_session(&request.workspace_id, request.generation, root) {
            Ok(session) => session,
            Err(_) => return Ok(result(
                &original_request,
                "unavailable",
                "Install a RefactorKit daemon that supports saved-source Java position navigation.",
            )),
        };
        let capabilities = match session_call_detailed_cancellable(
            &mut session,
            "server.capabilities",
            json!({}),
            REQUEST_TIMEOUT,
            &cancelled,
        ) {
            Ok(value) => value,
            Err(_) => {
                terminate(&mut session.child);
                return Ok(result(
                    &original_request,
                    "unavailable",
                    "RefactorKit capability discovery failed.",
                ));
            }
        };
        *manager = Some(ActiveSession {
            binding: binding.clone(),
            generation: request.generation,
            session,
            capabilities,
            project_context: request.project_context.clone(),
            opened: None,
        });
    }
    let active = manager.as_mut().unwrap();
    let response = query_session(
        &binding,
        &original_request,
        &request,
        root,
        sdk.as_deref(),
        &text,
        overlay_saved.as_deref(),
        &mut active.session,
        &active.capabilities,
        &mut active.opened,
        None,
        &cancelled,
    );
    match response {
        Ok(value) => {
            trace_snapshot(
                "navigation.request.complete",
                json!({
                    "requestId": original_request.request_id,
                    "elapsedMs": request_started.elapsed().as_millis(),
                    "status": value["status"],
                }),
            );
            Ok(value)
        }
        Err(message) => {
            trace_snapshot(
                "navigation.request.complete",
                json!({
                    "requestId": original_request.request_id,
                    "elapsedMs": request_started.elapsed().as_millis(),
                    "status": "refused",
                }),
            );
            reset(&mut manager);
            Ok(result(&original_request, "refused", &message))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn query_session(
    binding: &CurrentWorkspaceBinding,
    original_request: &JavaNavigationRequest,
    request: &JavaNavigationRequest,
    root: &Path,
    sdk: Option<&Path>,
    text: &str,
    overlay_saved: Option<&[(String, String)]>,
    session: &mut Session,
    capabilities: &Value,
    opened: &mut Option<(String, u64)>,
    context_verification: Option<&(String, Value)>,
    cancelled: &AtomicBool,
) -> Result<Value, String> {
    if cancelled.load(Ordering::SeqCst) {
        return Ok(result(
            original_request,
            "refused",
            "The Java navigation request was canceled.",
        ));
    }
    if !advertised(capabilities, &request.kind) {
        return Ok(result(
            &original_request,
            "unavailable",
            if request.kind == "diagnostics" {
                "RefactorKit does not advertise compiler errors for captured Java buffers."
            } else {
                "RefactorKit does not advertise the required Java position and snapshot capabilities."
            },
        ));
    }
    if request.editor_overlay.is_some()
        && !capabilities["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|method| {
                method["name"] == "project.context"
                    && method["features"]["immutableJavaEditorOverlays"] == true
            })
        })
    {
        return Ok(result(
            &original_request,
            "unavailable",
            "RefactorKit does not advertise immutable Java editor queries.",
        ));
    }
    let overlay_feature = match request.kind.as_str() {
        "diagnostics" => Some("javaImmutableEditorOverlayDiagnostics"),
        "typeDefinition" => Some("javaImmutableEditorOverlayTypeDefinition"),
        "typeHierarchy" => Some("javaImmutableEditorOverlayTypeHierarchy"),
        "callHierarchy" => Some("javaImmutableEditorOverlayCallHierarchy"),
        "implementations" => Some("javaImmutableEditorOverlayImplementations"),
        _ => None,
    };
    if request.editor_overlay.is_some()
        && overlay_feature.is_some_and(|feature| {
            !capabilities["methods"].as_array().is_some_and(|methods| {
                methods.iter().any(|method| {
                    method["name"] == "intelligence.query" && method["features"][feature] == true
                })
            })
        })
    {
        return Ok(result(
            &original_request,
            "unavailable",
            "RefactorKit does not advertise this Java query for immutable editor overlays.",
        ));
    }
    let version = capabilities["version"].as_str().unwrap().to_string();
    let resolved = (|| {
        let (hash, generation) = if request.project_context.is_some() {
            if opened.is_none() {
                *opened = Some(open(
                    session,
                    root,
                    request.project_context.as_ref(),
                    &request.request_id,
                    "project.open.beforeQuery",
                    cancelled,
                )?);
            }
            opened.clone().unwrap()
        } else {
            open(
                session,
                root,
                None,
                &request.request_id,
                "project.open.beforeQuery",
                cancelled,
            )?
        };
        if cancelled.load(Ordering::SeqCst) {
            return Ok(result(
                original_request,
                "refused",
                "The Java navigation request was canceled.",
            ));
        }
        if request
            .project_context
            .as_ref()
            .is_some_and(|context| context.snapshot_hash != hash)
        {
            return saved_inputs_refusal(
                original_request,
                "Project inputs changed; synchronize the Java project before navigating.",
            );
        }
        if !current_workspace_binding_is_current(&binding) {
            return Err("The Java workspace changed.".into());
        }
        let mut params = json!({
            "requestId": request.request_id, "kind": request.kind, "languageId": "java", "path": request.document.path,
            "position": {"line": request.position.line, "character": request.position.character},
            "expectedSnapshotHash": hash, "expectedIndexGeneration": generation,
            "sourceAuthority": {"kind": "saved-snapshot"}, "includeDeclaration": request.include_declaration,
            "limit": request.limit, "priority": "interactive"
        });
        if let Some(direction) = &request.direction {
            params["direction"] = json!(direction);
        }
        if let Some(context) = &request.project_context {
            // SDK-bound queries own their index provenance; the saved project
            // index generation cannot substitute for S0 and context authority.
            params
                .as_object_mut()
                .unwrap()
                .remove("expectedIndexGeneration");
            let verification = verify_context(
                session,
                context,
                sdk.as_deref().unwrap(),
                context_verification,
                &request.request_id,
                "project.context.beforeQuery",
                cancelled,
            )?;
            if verification == ContextVerification::SnapshotStale {
                return saved_inputs_refusal(original_request, CONTEXT_CHANGED_MESSAGE);
            }
            if cancelled.load(Ordering::SeqCst) {
                return Ok(result(
                    original_request,
                    "refused",
                    "The Java navigation request was canceled.",
                ));
            }
            params["javaContext"] = java_context_authority(context, sdk.as_deref().unwrap());
            if supports_kotlin_definition(request, capabilities) {
                let compiler = std::env::var_os(KOTLIN_DEFINITION_COMPILER_JAR);
                let classpath = std::env::var_os(KOTLIN_DEFINITION_COMPILER_CLASSPATH);
                match kotlin_definition_toolchain(sdk.as_deref().unwrap(), compiler.as_deref(), classpath.as_deref()) {
                    Ok(Some(toolchain)) => params["kotlinDefinitionToolchain"] = toolchain,
                    Ok(None) => {}
                    Err(message) => return Ok(result(original_request, "refused", message)),
                }
            }
        }
        if let Some(overlay) = &request.editor_overlay {
            params["sourceAuthority"] = json!({"kind":"immutable-editor-overlay","documents":overlay.documents.iter()
                .map(|document|json!({"path":document.path,"version":document.version,"content":document.text})).collect::<Vec<_>>()});
        }
        let normalized = if request.editor_refactoring.as_ref().is_some_and(|spec| {
            matches!(
                spec.operation,
                super::contract::RefactoringOperation::FormatFile
                    | super::contract::RefactoringOperation::OrganizeImports
            )
        }) {
            super::java_editor_refactoring::preview(
                session, &request, None, root, &version, generation,
            )?
        } else {
            let started = Instant::now();
            let response = session_call_detailed_cancellable(
                session,
                "intelligence.query",
                params,
                REQUEST_TIMEOUT,
                cancelled,
            );
            trace_navigation_phase(
                &request.request_id,
                "intelligence.query",
                started,
                response.is_ok(),
            );
            let raw = match response {
                Ok(raw) => raw,
                Err(error)
                    if error.kind == super::transport::SessionCallErrorKind::Rejected
                        && error.rpc_code == Some(-32800) =>
                {
                    return Ok(result(
                        original_request,
                        "refused",
                        "The Java navigation request was canceled.",
                    ));
                }
                Err(error) => {
                    let error_kind = match error.kind {
                        super::transport::SessionCallErrorKind::Session => "session",
                        super::transport::SessionCallErrorKind::Protocol => "protocol",
                        super::transport::SessionCallErrorKind::RequestTooLarge => {
                            "request-too-large"
                        }
                        super::transport::SessionCallErrorKind::Rejected => "rejected",
                    };
                    trace_snapshot(
                        "navigation.provider.rpcFailure",
                        json!({
                            "requestId": request.request_id,
                            "method": "intelligence.query",
                            "errorKind": error_kind,
                            "rpcCode": error.rpc_code,
                        }),
                    );
                    if let Some(response) =
                        recoverable_internal_query_error(&original_request, &error)
                    {
                        return Ok(response);
                    }
                    return Err(
                        rpc_failure_message(error.kind, request.project_context.is_some()).into(),
                    );
                }
            };
            if navigation_reports_stale_snapshot(&raw, request, &hash, generation) {
                return saved_inputs_refusal(original_request, CONTEXT_CHANGED_MESSAGE);
            }
            let normalized = normalize(
                raw,
                &request,
                root,
                &hash,
                generation,
                &digest(request.document.text.as_bytes()),
                &version,
            )?;
            if request.editor_refactoring.is_some() && normalized["status"] == "ready" {
                super::java_editor_refactoring::preview(
                    session,
                    &request,
                    Some(&normalized),
                    root,
                    &version,
                    generation,
                )?
            } else {
                normalized
            }
        };
        if cancelled.load(Ordering::SeqCst) {
            return Ok(result(
                original_request,
                "refused",
                "The Java navigation request was canceled.",
            ));
        }
        if request.project_context.is_some() && normalized["status"] == "ready" {
            *opened = Some((
                hash.clone(),
                integer(normalized.get("indexGeneration")).unwrap(),
            ));
        }
        let current_hash = if let Some(context) = &request.project_context {
            let verification = verify_context(
                session,
                context,
                sdk.as_deref().unwrap(),
                context_verification,
                &request.request_id,
                "project.context.afterQuery",
                cancelled,
            )?;
            if verification == ContextVerification::SnapshotStale {
                return saved_inputs_refusal(original_request, CONTEXT_CHANGED_MESSAGE);
            }
            hash.clone()
        } else {
            open(
                session,
                root,
                None,
                &request.request_id,
                "project.open.afterQuery",
                cancelled,
            )?
            .0
        };
        if cancelled.load(Ordering::SeqCst) {
            return Ok(result(
                original_request,
                "refused",
                "The Java navigation request was canceled.",
            ));
        }
        if !current_workspace_binding_is_current(&binding) {
            return Err("The Java workspace changed during navigation.".into());
        }
        if current_hash != hash
            || source(root, &request.document.path)? != text
            || overlay_saved.as_ref().is_some_and(|documents| {
                documents.iter().any(|(path, hash)| {
                    source(root, path)
                        .map(|text| digest(text.as_bytes()))
                        .as_ref()
                        != Ok(hash)
                })
            })
        {
            return saved_inputs_refusal(
                original_request,
                "Java sources changed during navigation; retry after saving.",
            );
        }
        Ok::<Value, String>(normalized)
    })();
    match resolved {
        Ok(mut value) => {
            value["documentPath"] = json!(original_request.document.path);
            if let Some(context) = &request.project_context {
                if value["status"] == "ready" && request.editor_refactoring.is_none() {
                    qualify_project_paths(&mut value, context);
                }
            }
            Ok(value)
        }
        Err(message) => Err(message),
    }
}

#[cfg(test)]
fn query_owned(
    binding: CurrentWorkspaceBinding,
    request: JavaNavigationRequest,
    state: Arc<Mutex<Option<ActiveSession>>>,
    sdk_state: Option<Arc<super::java_project_context::Manager>>,
) -> Result<Value, String> {
    query_owned_cancellable(
        binding,
        request,
        state,
        sdk_state,
        Arc::new(AtomicBool::new(false)),
    )
}

#[cfg(test)]
pub(super) fn capabilities_at(state: &JavaNavigationState) -> Value {
    if let Some(shared) = &state.1 {
        return super::java_project_context::capabilities_at(shared);
    }
    state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .capabilities
        .clone()
}

#[cfg(test)]
pub(super) fn query_at(
    binding: CurrentWorkspaceBinding,
    request: JavaNavigationRequest,
    state: &JavaNavigationState,
) -> Result<Value, String> {
    let (cancelled, registration) = state.2.register(&request)?;
    let result = query_owned_cancellable(
        binding,
        request,
        state.0.clone(),
        state.1.clone(),
        cancelled,
    );
    drop(registration);
    result
}

pub(super) fn prepare_query(
    request: JavaNavigationRequest,
    state: &JavaNavigationState,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id {
        return Err("The Java workspace changed.".into());
    }
    let (cancelled, registration) = state.2.register(&request)?;
    let owned = state.0.clone();
    let sdk_state = state.1.clone();
    Ok(move || {
        let _registration = registration;
        query_owned_cancellable(binding, request, owned, sdk_state, cancelled)
    })
}
