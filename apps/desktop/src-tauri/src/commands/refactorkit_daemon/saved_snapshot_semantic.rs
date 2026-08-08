//! Generation-bound RefactorKit 0.7.0-SNAPSHOT saved-snapshot semantic navigation.
//!
//! This boundary deliberately uses only the immutable v0.7.0-SNAPSHOT daemon protocol. It never
//! invokes the legacy CLI, discovers a TypeScript toolchain, or promotes structural results.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::commands::workspace_registry::workspace_id_for_path;

use super::capability_policy::{
    normalize_server_capabilities, LanguageAdapterResourceLimits, LanguageAdapterRuntime,
    LanguageKernelSchema, ManagedCapabilityMetadata, API_VERSION,
};
use super::path_policy::canonical_workspace;
use super::transport::{
    session_call_detailed, spawn_session, terminate, Session, SessionCallError,
    SessionCallErrorKind, REQUEST_TIMEOUT, START_TIMEOUT,
};

const PROVIDER: &str = "refactorkit";
const PROVIDER_NAME: &str = "RefactorKit";
const PROVIDER_VERSION: &str = "0.7.0-SNAPSHOT";
const BACKEND: &str = "typescript-lsp-explicit-v1";
const ADAPTER_BACKEND: &str = "tree-sitter-jni-0.25.3+typescript-lsp-explicit-v1";
const MAX_QUERY_BYTES: usize = 1_024;
const MAX_IDENTITY_BYTES: usize = 512;
const MAX_METADATA_BYTES: usize = 256;
const MAX_SYMBOLS: usize = 200;
const MAX_SOURCE_BYTES: u64 = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MILLIS: u64 = 10_000;
const MAX_INPUT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PROCESSES: u64 = 8;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSnapshotSemanticError {
    code: &'static str,
    stage: &'static str,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    rpc_code: Option<i64>,
}

impl SavedSnapshotSemanticError {
    fn request(code: &'static str, stage: &'static str) -> Self {
        Self {
            code,
            stage,
            message: "The saved-snapshot semantic request was rejected.",
            rpc_code: None,
        }
    }

    fn response(code: &'static str, stage: &'static str) -> Self {
        Self {
            code,
            stage,
            message: "RefactorKit returned invalid saved-snapshot semantic evidence.",
            rpc_code: None,
        }
    }

    fn transport(code: &'static str, stage: &'static str, error: SessionCallError) -> Self {
        let message = match error.kind {
            SessionCallErrorKind::Rejected => "RefactorKit refused the semantic operation.",
            SessionCallErrorKind::Protocol => {
                "RefactorKit returned invalid saved-snapshot semantic evidence."
            }
            SessionCallErrorKind::Session | SessionCallErrorKind::RequestTooLarge => {
                "The RefactorKit semantic session ended safely."
            }
        };
        Self {
            code,
            stage,
            message,
            rpc_code: error.rpc_code,
        }
    }
}

type SemanticResult<T> = Result<T, SavedSnapshotSemanticError>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticRuntimeLimitsRequest {
    request_timeout_millis: u64,
    max_input_bytes: u64,
    max_output_bytes: u64,
    max_processes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticRuntimeRequest {
    execution_mode: String,
    supports_timeout: bool,
    supports_cancellation: bool,
    uses_workspace_overlay: bool,
    records_process_provenance: bool,
    limits: SemanticRuntimeLimitsRequest,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalToolchainRequest {
    node_executable: String,
    language_server_package_root: String,
    type_script_package_root: String,
    allow_path_node_discovery: bool,
    allow_workspace_local_toolchain: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartSavedSnapshotSemanticSessionRequest {
    language_id: String,
    workspace_root: String,
    workspace_id: String,
    workspace_generation: u64,
    provider: String,
    provider_version: String,
    backend: String,
    runtime: SemanticRuntimeRequest,
    extensions: Vec<String>,
    toolchain: ExternalToolchainRequest,
    accepted_semantic_completeness: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopSavedSnapshotSemanticSessionRequest {
    language_id: String,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchSavedSnapshotSymbolsRequest {
    language_id: String,
    query: String,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
    semantic_lease: String,
    snapshot_identity: String,
    provider_version: String,
    backend: String,
    toolchain: ExternalToolchainRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveSavedSnapshotDefinitionRequest {
    language_id: String,
    symbol_id: String,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
    semantic_lease: String,
    snapshot_identity: String,
    provider_version: String,
    backend: String,
}

#[derive(Clone)]
struct AuthorizedToolchain {
    node_executable: String,
    language_server_package_root: String,
    type_script_package_root: String,
}

#[derive(Clone)]
struct SemanticAuthority {
    language_id: String,
    workspace_root: PathBuf,
    workspace_root_text: String,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
    snapshot_identity: String,
    semantic_lease: String,
    start_snapshot_hash: String,
    provider_version: String,
    backend: String,
    toolchain: AuthorizedToolchain,
    semantic_completeness: String,
}

#[derive(Clone)]
struct RetainedSymbol {
    name: String,
    kind: String,
}

struct RetainedSearch {
    language_id: String,
    query: String,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
    semantic_lease: String,
    snapshot_identity: String,
    provider_version: String,
    backend: String,
    symbols: HashMap<String, RetainedSymbol>,
}

#[derive(Default)]
struct SemanticManager {
    session: Option<Session>,
    authority: Option<SemanticAuthority>,
    search: Option<RetainedSearch>,
}

pub struct SavedSnapshotSemanticState(Mutex<SemanticManager>);

impl Default for SavedSnapshotSemanticState {
    fn default() -> Self {
        Self(Mutex::new(SemanticManager::default()))
    }
}

impl SavedSnapshotSemanticState {
    pub fn shutdown_all(&self) {
        if let Ok(mut manager) = self.0.lock() {
            reset(&mut manager, true);
        }
    }
}

impl Drop for SavedSnapshotSemanticState {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

pub fn start(
    request: StartSavedSnapshotSemanticSessionRequest,
    state: &SavedSnapshotSemanticState,
) -> SemanticResult<Value> {
    let root = authorize_start_workspace(&request)?;
    let toolchain = authorize_external_toolchain(&request.toolchain, &root)?;
    validate_start_contract(&request)?;

    let mut manager = lock(state, "semantic-session-start")?;
    reset(&mut manager, true);

    let mut session = spawn_session(&request.workspace_id, request.workspace_generation, &root)
        .map_err(|_| {
            SavedSnapshotSemanticError::request(
                "REFACTORKIT_SEMANTIC_SESSION_START_FAILED",
                "daemon-start",
            )
        })?;

    let initialized = (|| {
        let raw_capabilities = call_start(
            &mut session,
            "server.capabilities",
            json!({}),
            "server-capabilities",
        )?;
        let capabilities = normalize_server_capabilities(&raw_capabilities).map_err(|_| {
            SavedSnapshotSemanticError::response(
                "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
                "server-capabilities",
            )
        })?;
        verify_v070_capabilities(&raw_capabilities, &capabilities, &request)?;

        let opened = call_start(
            &mut session,
            "project.open",
            json!({"root": request.workspace_root}),
            "project-open",
        )?;
        #[cfg(test)]
        record_checkpoint("after-project-open", &root);
        let snapshot_identity = normalize_project_open(&opened, &root)?;
        let snapshot_digest = snapshot_identity
            .strip_prefix("sha256:")
            .unwrap_or_default()
            .to_string();

        let started = call_start(
            &mut session,
            "typescript.semantic.start",
            semantic_start_params(&request.language_id, &toolchain),
            "typescript-semantic-start",
        )?;
        #[cfg(test)]
        record_checkpoint("after-semantic-start", &root);
        let upstream = normalize_semantic_start(&started, &request, &snapshot_digest)?;
        let session_id = mint_session_id().map_err(|_| {
            SavedSnapshotSemanticError::request(
                "REFACTORKIT_SEMANTIC_SESSION_START_FAILED",
                "session-identity",
            )
        })?;

        let authority = SemanticAuthority {
            language_id: request.language_id.clone(),
            workspace_root: root.clone(),
            workspace_root_text: request.workspace_root.clone(),
            workspace_id: request.workspace_id.clone(),
            workspace_generation: request.workspace_generation,
            session_id: session_id.clone(),
            snapshot_identity: snapshot_identity.clone(),
            semantic_lease: upstream.semantic_lease.clone(),
            start_snapshot_hash: upstream.snapshot_hash.clone(),
            provider_version: request.provider_version.clone(),
            backend: request.backend.clone(),
            toolchain: toolchain.clone(),
            semantic_completeness: upstream.completeness.clone(),
        };
        let result = assemble_start_result(
            &request.language_id,
            &request.workspace_root,
            &request.workspace_id,
            request.workspace_generation,
            &session_id,
            &snapshot_identity,
            &upstream.semantic_lease,
            &upstream.snapshot_hash,
            &request.runtime,
            &request.extensions,
            &toolchain,
            &upstream.completeness,
            &upstream,
        );
        Ok((authority, result))
    })();

    match initialized {
        Ok((authority, result)) => {
            manager.session = Some(session);
            manager.authority = Some(authority);
            manager.search = None;
            Ok(result)
        }
        Err(error) => {
            terminate(&mut session.child);
            Err(error)
        }
    }
}

pub fn stop(
    request: StopSavedSnapshotSemanticSessionRequest,
    state: &SavedSnapshotSemanticState,
) -> SemanticResult<Value> {
    validate_language(&request.language_id, "semantic-session-stop")?;
    validate_identity(&request.workspace_id, "semantic-session-stop")?;
    validate_generation(request.workspace_generation, "semantic-session-stop")?;
    validate_session_id(&request.session_id, "semantic-session-stop")?;

    let mut manager = lock(state, "semantic-session-stop")?;
    ensure_live(&mut manager, "semantic-session-stop")?;
    let authority = manager.authority.as_ref().ok_or_else(|| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED",
            "semantic-session-stop",
        )
    })?;
    authorize_current_workspace(authority, "semantic-session-stop")?;
    if request.language_id != authority.language_id
        || request.workspace_id != authority.workspace_id
        || request.workspace_generation != authority.workspace_generation
        || request.session_id != authority.session_id
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_STOP_REQUEST_REJECTED",
            "semantic-session-stop",
        ));
    }

    let response = call_active(
        &mut manager,
        "typescript.semantic.stop",
        json!({"languageId": request.language_id}),
        "REFACTORKIT_SEMANTIC_SESSION_STOP_FAILED",
        "typescript-semantic-stop",
    )?;
    let stopped = match normalize_semantic_stop(&response, &request.language_id) {
        Ok(stopped) => stopped,
        Err(error) => {
            reset(&mut manager, false);
            return Err(error);
        }
    };
    let result = json!({
        "languageId": request.language_id,
        "workspaceId": request.workspace_id,
        "workspaceGeneration": request.workspace_generation,
        "sessionId": request.session_id,
        "stopped": stopped
    });
    reset(&mut manager, false);
    Ok(result)
}

pub fn search(
    request: SearchSavedSnapshotSymbolsRequest,
    state: &SavedSnapshotSemanticState,
) -> SemanticResult<Value> {
    validate_search_request(&request)?;
    let mut manager = lock(state, "symbol-search")?;
    ensure_live(&mut manager, "symbol-search")?;
    manager.search = None;
    let authority = manager.authority.as_ref().ok_or_else(|| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_SYMBOL_SEARCH_REQUEST_REJECTED",
            "symbol-search-authority",
        )
    })?;
    authorize_current_workspace(authority, "symbol-search-authority")?;
    authorize_search(&request, authority)?;
    let root = authority.workspace_root.clone();
    let semantic_completeness = authority.semantic_completeness.clone();

    let raw = call_active(
        &mut manager,
        "symbol.search",
        symbol_search_params(&request.language_id, &request.query),
        "REFACTORKIT_SYMBOL_SEARCH_FAILED",
        "symbol-search",
    )?;
    let symbols = match normalize_symbol_search(&raw, &root) {
        Ok(symbols) => symbols,
        Err(error) => {
            reset(&mut manager, false);
            return Err(error);
        }
    };
    let retained_symbols = symbols
        .iter()
        .map(|symbol| {
            (
                symbol.id.clone(),
                RetainedSymbol {
                    name: symbol.name.clone(),
                    kind: symbol.kind.clone(),
                },
            )
        })
        .collect();
    manager.search = Some(RetainedSearch {
        language_id: request.language_id.clone(),
        query: request.query.clone(),
        workspace_id: request.workspace_id.clone(),
        workspace_generation: request.workspace_generation,
        session_id: request.session_id.clone(),
        semantic_lease: request.semantic_lease.clone(),
        snapshot_identity: request.snapshot_identity.clone(),
        provider_version: request.provider_version.clone(),
        backend: request.backend.clone(),
        symbols: retained_symbols,
    });

    Ok(json!({
        "languageId": request.language_id,
        "query": request.query,
        "workspaceId": request.workspace_id,
        "workspaceGeneration": request.workspace_generation,
        "sessionId": request.session_id,
        "snapshotIdentity": request.snapshot_identity,
        "providerVersion": request.provider_version,
        "backend": request.backend,
        "completeness": {
            "resultCompleteness": "unknown",
            "truncation": "unknown",
            "semanticCompleteness": semantic_completeness,
            "experimentalDisclosure": "shown"
        },
        "symbols": symbols.into_iter().map(|symbol| json!({
            "id": symbol.id, "name": symbol.name, "kind": symbol.kind
        })).collect::<Vec<_>>()
    }))
}

pub fn resolve_definition(
    request: ResolveSavedSnapshotDefinitionRequest,
    state: &SavedSnapshotSemanticState,
) -> SemanticResult<Value> {
    validate_definition_request(&request)?;
    let mut manager = lock(state, "symbol-definition")?;
    ensure_live(&mut manager, "symbol-definition")?;
    let authority = manager.authority.as_ref().ok_or_else(|| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_DEFINITION_REQUEST_REJECTED",
            "definition-authority",
        )
    })?;
    authorize_current_workspace(authority, "definition-authority")?;
    authorize_definition(&request, authority)?;
    let root = authority.workspace_root.clone();
    let retained = manager.search.as_ref().ok_or_else(|| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_DEFINITION_REQUEST_REJECTED",
            "definition-search-authority",
        )
    })?;
    if !definition_search_matches(&request, retained) {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_DEFINITION_REQUEST_REJECTED",
            "definition-search-authority",
        ));
    }
    let selected = retained
        .symbols
        .get(&request.symbol_id)
        .cloned()
        .ok_or_else(|| {
            SavedSnapshotSemanticError::request(
                "REFACTORKIT_DEFINITION_REQUEST_REJECTED",
                "definition-symbol-authority",
            )
        })?;

    let raw = call_active(
        &mut manager,
        "symbol.definition",
        symbol_definition_params(&request.language_id, &request.symbol_id),
        "REFACTORKIT_DEFINITION_FAILED",
        "symbol-definition",
    )?;
    let definition = match normalize_definition(&raw, &root, &request.symbol_id, &selected) {
        Ok(definition) => definition,
        Err(error) => {
            reset(&mut manager, false);
            return Err(error);
        }
    };

    Ok(json!({
        "languageId": request.language_id,
        "workspaceId": request.workspace_id,
        "workspaceGeneration": request.workspace_generation,
        "sessionId": request.session_id,
        "snapshotIdentity": request.snapshot_identity,
        "providerVersion": request.provider_version,
        "backend": request.backend,
        "selectedSymbol": {
            "id": request.symbol_id,
            "name": selected.name,
            "kind": selected.kind
        },
        "file": definition.file,
        "point": {
            "line": definition.one_based_line - 1,
            "character": definition.character
        }
    }))
}

fn lock<'a>(
    state: &'a SavedSnapshotSemanticState,
    stage: &'static str,
) -> SemanticResult<std::sync::MutexGuard<'a, SemanticManager>> {
    state.0.lock().map_err(|_| {
        SavedSnapshotSemanticError::request("REFACTORKIT_SEMANTIC_STATE_UNAVAILABLE", stage)
    })
}

fn reset(manager: &mut SemanticManager, request_upstream_stop: bool) {
    if let Some(mut session) = manager.session.take() {
        if request_upstream_stop && manager.authority.is_some() {
            let language_id = manager
                .authority
                .as_ref()
                .map(|authority| authority.language_id.as_str())
                .unwrap_or("typescript");
            let _ = session_call_detailed(
                &mut session,
                "typescript.semantic.stop",
                json!({"languageId": language_id}),
                REQUEST_TIMEOUT,
            );
        }
        terminate(&mut session.child);
    }
    manager.authority = None;
    manager.search = None;
}

fn ensure_live(manager: &mut SemanticManager, stage: &'static str) -> SemanticResult<()> {
    let live = manager
        .session
        .as_mut()
        .is_some_and(|session| session.child.try_wait().ok().flatten().is_none());
    if live && manager.authority.is_some() {
        return Ok(());
    }
    reset(manager, false);
    Err(SavedSnapshotSemanticError::request(
        "REFACTORKIT_SEMANTIC_SESSION_INACTIVE",
        stage,
    ))
}

fn call_start(
    session: &mut Session,
    method: &str,
    params: Value,
    stage: &'static str,
) -> SemanticResult<Value> {
    session_call_detailed(session, method, params, START_TIMEOUT).map_err(|error| {
        SavedSnapshotSemanticError::transport(
            "REFACTORKIT_SEMANTIC_SESSION_START_FAILED",
            stage,
            error,
        )
    })
}

fn call_active(
    manager: &mut SemanticManager,
    method: &str,
    params: Value,
    code: &'static str,
    stage: &'static str,
) -> SemanticResult<Value> {
    let result = manager
        .session
        .as_mut()
        .ok_or_else(|| SavedSnapshotSemanticError::request(code, stage))
        .and_then(|session| {
            session_call_detailed(session, method, params, REQUEST_TIMEOUT)
                .map_err(|error| SavedSnapshotSemanticError::transport(code, stage, error))
        });
    if result.as_ref().is_err_and(|error| {
        error.rpc_code.is_none()
            && matches!(
                error.message,
                "The RefactorKit semantic session ended safely."
                    | "RefactorKit returned invalid saved-snapshot semantic evidence."
            )
    }) {
        reset(manager, false);
    }
    result
}

fn semantic_start_params(language_id: &str, toolchain: &AuthorizedToolchain) -> Value {
    json!({
        "languageId": language_id,
        "nodeExecutable": toolchain.node_executable,
        "languageServerPackageRoot": toolchain.language_server_package_root,
        "typeScriptPackageRoot": toolchain.type_script_package_root,
        "allowPathNodeDiscovery": false,
        "allowWorkspaceLocalToolchain": false
    })
}

fn symbol_search_params(language_id: &str, query: &str) -> Value {
    json!({"languageId": language_id, "query": query})
}

fn symbol_definition_params(language_id: &str, symbol: &str) -> Value {
    json!({"languageId": language_id, "symbol": symbol})
}

fn authorize_start_workspace(
    request: &StartSavedSnapshotSemanticSessionRequest,
) -> SemanticResult<PathBuf> {
    validate_generation(request.workspace_generation, "workspace-authorization")?;
    validate_identity(&request.workspace_id, "workspace-authorization")?;
    let root = canonical_workspace().map_err(|_| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "workspace-authorization",
        )
    })?;
    let requested = Path::new(&request.workspace_root)
        .canonicalize()
        .map_err(|_| {
            SavedSnapshotSemanticError::request(
                "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
                "workspace-authorization",
            )
        })?;
    if requested != root
        || Path::new(&request.workspace_root) != root
        || workspace_id_for_path(&root) != request.workspace_id
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "workspace-authorization",
        ));
    }
    Ok(root)
}

fn authorize_current_workspace(
    authority: &SemanticAuthority,
    stage: &'static str,
) -> SemanticResult<()> {
    let current = canonical_workspace().map_err(|_| {
        SavedSnapshotSemanticError::request("REFACTORKIT_WORKSPACE_AUTHORITY_STALE", stage)
    })?;
    if current != authority.workspace_root
        || workspace_id_for_path(&current) != authority.workspace_id
        || current.to_str() != Some(authority.workspace_root_text.as_str())
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_WORKSPACE_AUTHORITY_STALE",
            stage,
        ));
    }
    Ok(())
}

fn authorize_external_toolchain(
    request: &ExternalToolchainRequest,
    root: &Path,
) -> SemanticResult<AuthorizedToolchain> {
    if request.allow_path_node_discovery || request.allow_workspace_local_toolchain {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "toolchain-authorization",
        ));
    }
    let node = canonical_toolchain_path(&request.node_executable, root, true)?;
    let language_server =
        canonical_toolchain_path(&request.language_server_package_root, root, false)?;
    let typescript = canonical_toolchain_path(&request.type_script_package_root, root, false)?;
    Ok(AuthorizedToolchain {
        node_executable: node,
        language_server_package_root: language_server,
        type_script_package_root: typescript,
    })
}

fn canonical_toolchain_path(raw: &str, root: &Path, require_file: bool) -> SemanticResult<String> {
    if raw.is_empty()
        || raw.len() > 4096
        || raw.trim() != raw
        || raw.chars().any(char::is_control)
        || !Path::new(raw).is_absolute()
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "toolchain-authorization",
        ));
    }
    let path = Path::new(raw).canonicalize().map_err(|_| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "toolchain-authorization",
        )
    })?;
    let text = path.to_str().ok_or_else(|| {
        SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "toolchain-authorization",
        )
    })?;
    if text != raw || path.starts_with(root) || (require_file && !path.is_file()) {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "toolchain-authorization",
        ));
    }
    if !require_file && !path.is_dir() {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "toolchain-authorization",
        ));
    }
    #[cfg(unix)]
    if require_file {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(&path)
            .map(|metadata| metadata.permissions().mode() & 0o111 == 0)
            .unwrap_or(true)
        {
            return Err(SavedSnapshotSemanticError::request(
                "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
                "toolchain-authorization",
            ));
        }
    }
    Ok(text.to_string())
}

fn validate_start_contract(
    request: &StartSavedSnapshotSemanticSessionRequest,
) -> SemanticResult<()> {
    validate_language(&request.language_id, "start-contract")?;
    if request.provider != PROVIDER
        || request.provider_version != PROVIDER_VERSION
        || request.backend != BACKEND
        || !runtime_request_is_v062(&request.runtime)
        || request.extensions != expected_extensions(&request.language_id)
        || !accepted_completeness_is_valid(
            &request.language_id,
            &request.accepted_semantic_completeness,
        )
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_SESSION_START_REQUEST_REJECTED",
            "start-contract",
        ));
    }
    Ok(())
}

fn verify_v070_capabilities(
    raw: &Value,
    capabilities: &ManagedCapabilityMetadata,
    request: &StartSavedSnapshotSemanticSessionRequest,
) -> SemanticResult<()> {
    let object = exact_object(
        raw,
        &[
            "name",
            "version",
            "apiVersion",
            "protocol",
            "transport",
            "methods",
            "languageKernel",
            "safety",
        ],
        "server-capabilities",
    )?;
    if object.get("name").and_then(Value::as_str) != Some(PROVIDER_NAME)
        || object.get("version").and_then(Value::as_str) != Some(PROVIDER_VERSION)
        || object.get("apiVersion").and_then(Value::as_str) != Some(API_VERSION)
        || capabilities.provider_version != PROVIDER_VERSION
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "server-capabilities",
        ));
    }
    verify_method(
        object,
        "typescript.semantic.start",
        "experimental",
        true,
        false,
        Some(&[
            "explicitToolchain",
            "hashBoundProvenance",
            "noPackageScripts",
        ]),
    )?;
    verify_method(
        object,
        "typescript.semantic.stop",
        "experimental",
        true,
        false,
        None,
    )?;
    verify_method(object, "symbol.search", "beta-contract", true, false, None)?;
    verify_method(
        object,
        "symbol.definition",
        "beta-contract",
        true,
        false,
        None,
    )?;
    verify_language_capabilities(&capabilities.language_kernel.schema, request)
}

fn verify_method(
    capabilities: &Map<String, Value>,
    name: &str,
    stability: &str,
    requires_project: bool,
    writes_workspace: bool,
    required_features: Option<&[&str]>,
) -> SemanticResult<()> {
    let methods = capabilities
        .get("methods")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            SavedSnapshotSemanticError::response(
                "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
                "server-capabilities",
            )
        })?;
    let matches: Vec<_> = methods
        .iter()
        .filter(|method| method.get("name").and_then(Value::as_str) == Some(name))
        .collect();
    if matches.len() != 1 {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "server-capabilities",
        ));
    }
    let method = matches[0].as_object().ok_or_else(|| {
        SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "server-capabilities",
        )
    })?;
    if method.get("stability").and_then(Value::as_str) != Some(stability)
        || method.get("requiresProject").and_then(Value::as_bool) != Some(requires_project)
        || method.get("writesWorkspace").and_then(Value::as_bool) != Some(writes_workspace)
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "server-capabilities",
        ));
    }
    if let Some(required_features) = required_features {
        let features = method
            .get("features")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                SavedSnapshotSemanticError::response(
                    "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
                    "server-capabilities",
                )
            })?;
        if required_features
            .iter()
            .any(|feature| features.get(*feature).and_then(Value::as_bool) != Some(true))
        {
            return Err(SavedSnapshotSemanticError::response(
                "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
                "server-capabilities",
            ));
        }
    }
    Ok(())
}

fn verify_language_capabilities(
    schema: &Option<LanguageKernelSchema>,
    request: &StartSavedSnapshotSemanticSessionRequest,
) -> SemanticResult<()> {
    let schema = schema.as_ref().ok_or_else(|| {
        SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "language-capabilities",
        )
    })?;
    let adapters: Vec<_> = schema
        .adapters
        .iter()
        .filter(|adapter| adapter.language_id == request.language_id)
        .collect();
    if adapters.len() != 1 {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "language-capabilities",
        ));
    }
    let adapter = adapters[0];
    if adapter.backend != ADAPTER_BACKEND
        || adapter.extensions != request.extensions
        || !runtime_capability_is_v062(&adapter.runtime)
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "language-capabilities",
        ));
    }
    for operation in ["workspaceSymbols", "definition"] {
        let matches: Vec<_> = adapter
            .capabilities
            .iter()
            .filter(|capability| capability.operation == operation)
            .collect();
        if matches.len() != 1 {
            return Err(SavedSnapshotSemanticError::response(
                "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
                "language-capabilities",
            ));
        }
        let capability = matches[0];
        if capability.stability != "experimental"
            || capability.evidence != "language-server"
            || capability.mutation_authority != "none"
            || capability.backend != BACKEND
            || capability.extensions != request.extensions
            || !runtime_capability_is_v062(&capability.runtime)
        {
            return Err(SavedSnapshotSemanticError::response(
                "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
                "language-capabilities",
            ));
        }
    }
    Ok(())
}

fn normalize_project_open(value: &Value, root: &Path) -> SemanticResult<String> {
    let object = exact_object(
        value,
        &[
            "root",
            "fileCount",
            "moduleCount",
            "snapshotHash",
            "indexGeneration",
            "indexedSourceCount",
            "indexedSymbolCount",
            "watcherState",
        ],
        "project-open",
    )?;
    let returned_root = object
        .get("root")
        .and_then(Value::as_str)
        .and_then(|value| Path::new(value).canonicalize().ok());
    let snapshot = object
        .get("snapshotHash")
        .and_then(Value::as_str)
        .filter(|value| sha256_digest(value));
    if returned_root.as_deref() != Some(root)
        || object.get("fileCount").and_then(Value::as_u64).is_none()
        || object.get("moduleCount").and_then(Value::as_u64).is_none()
        || snapshot.is_none()
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "project-open",
        ));
    }
    Ok(format!("sha256:{}", snapshot.unwrap()))
}

struct UpstreamStart {
    completeness: String,
    semantic_lease: String,
    snapshot_hash: String,
    server_name: Option<String>,
    server_version: Option<String>,
    capabilities_sha256: String,
    executable_sha256: String,
    arguments_sha256: String,
    process_id: u64,
}

fn normalize_semantic_start(
    value: &Value,
    request: &StartSavedSnapshotSemanticSessionRequest,
    expected_snapshot_digest: &str,
) -> SemanticResult<UpstreamStart> {
    // The source-built 0.7.0-SNAPSHOT daemon returns a richer start response that
    // also carries semanticLease, snapshotHash, and index. All three are validated:
    //   (a) snapshotHash must be the 64-hex sha256 digest equal to the project.open
    //       snapshot_identity digest (same value) — a same-value binding, not just a
    //       shape check;
    //   (b) semanticLease must match the provider's exact `semantic-[0-9a-f-]{36}` contract;
    //   (c) index must be present and structurally valid (status == "ready" or a
    //       structurally valid index descriptor).
    // The validated semanticLease and start snapshotHash are retained on
    // SemanticAuthority and correlated on search/definition requests.
    let object = exact_object(
        value,
        &[
            "languageId",
            "status",
            "semanticLease",
            "snapshotHash",
            "completeness",
            "serverName",
            "serverVersion",
            "capabilitiesSha256",
            "executableSha256",
            "argumentsSha256",
            "processId",
            "index",
        ],
        "typescript-semantic-start",
    )?;
    let completeness = object
        .get("completeness")
        .and_then(Value::as_str)
        .filter(|value| {
            request
                .accepted_semantic_completeness
                .iter()
                .any(|item| item == *value)
        });
    let metadata = |field: &str| -> Option<Option<String>> {
        object.get(field).and_then(Value::as_str).and_then(|value| {
            if value.is_empty() {
                Some(None)
            } else if valid_metadata(value) {
                Some(Some(value.to_string()))
            } else {
                None
            }
        })
    };
    let capabilities_sha256 = digest_field(object, "capabilitiesSha256");
    let executable_sha256 = digest_field(object, "executableSha256");
    let arguments_sha256 = digest_field(object, "argumentsSha256");
    let process_id = object
        .get("processId")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0);
    let semantic_lease = object
        .get("semanticLease")
        .and_then(Value::as_str)
        .filter(|value| valid_semantic_lease(value));
    let snapshot_hash = object
        .get("snapshotHash")
        .and_then(Value::as_str)
        .filter(|value| sha256_digest(value) && *value == expected_snapshot_digest);
    if object.get("languageId").and_then(Value::as_str) != Some(request.language_id.as_str())
        || object.get("status").and_then(Value::as_str) != Some("started")
        || completeness.is_none()
        || semantic_lease.is_none()
        || snapshot_hash.is_none()
        || !index_is_ready_or_valid(object.get("index"))
        || metadata("serverName").is_none()
        || metadata("serverVersion").is_none()
        || capabilities_sha256.is_none()
        || executable_sha256.is_none()
        || arguments_sha256.is_none()
        || process_id.is_none()
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_START_RESPONSE_REJECTED",
            "typescript-semantic-start",
        ));
    }
    Ok(UpstreamStart {
        completeness: completeness.unwrap().to_string(),
        semantic_lease: semantic_lease.unwrap().to_string(),
        snapshot_hash: snapshot_hash.unwrap().to_string(),
        server_name: metadata("serverName").unwrap(),
        server_version: metadata("serverVersion").unwrap(),
        capabilities_sha256: capabilities_sha256.unwrap(),
        executable_sha256: executable_sha256.unwrap(),
        arguments_sha256: arguments_sha256.unwrap(),
        process_id: process_id.unwrap(),
    })
}

/// Match RefactorKit's exact TypeScript semantic-lease wire contract from
/// `TypeScriptDiagnosticsProtocol.LEASE`: `semantic-` followed by exactly 36 lowercase
/// hexadecimal-or-hyphen ASCII bytes. The provider currently mints UUID text in that suffix, but
/// its declared validator intentionally does not impose UUID hyphen positions or version bits.
fn valid_semantic_lease(value: &str) -> bool {
    value.strip_prefix("semantic-").is_some_and(|suffix| {
        suffix.len() == 36
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-')
    })
}

/// The semantic index descriptor is accepted when status is `ready` or when it is present and
/// structurally valid (carries a status string and/or numeric source/symbol counts).
fn index_is_ready_or_valid(index: Option<&Value>) -> bool {
    let Some(object) = index.and_then(Value::as_object) else {
        return false;
    };
    if object.get("status").and_then(Value::as_str) == Some("ready") {
        return true;
    }
    if object.get("sources").and_then(Value::as_u64).is_some()
        || object.get("symbols").and_then(Value::as_u64).is_some()
    {
        return true;
    }
    object.get("status").and_then(Value::as_str).is_some()
}

/// Assemble the `start()` result JSON that the Tauri adapter's
/// `parseSemanticSessionStartCandidate` consumes. The adapter validates every field through an
/// exact-field shape and, critically, requires `startSnapshotHash` to be a PREFIXED sha256
/// identity (`sha256:<64hex>`) matching `validSha256Identity` / `SHA256_IDENTITY`. The bare
/// 64-hex digest is therefore emitted with the `sha256:` prefix alongside the prefixed
/// `providerProjectSnapshotIdentity` (both identity fields are kept). Internal correlation keeps
/// the bare digest on `SemanticAuthority.start_snapshot_hash`, so search/definition binding is
/// unchanged; only the wire shape is prefixed.
fn assemble_start_result(
    language_id: &str,
    workspace_root: &str,
    workspace_id: &str,
    workspace_generation: u64,
    session_id: &str,
    snapshot_identity: &str,
    semantic_lease: &str,
    start_snapshot_hash: &str,
    runtime: &SemanticRuntimeRequest,
    extensions: &[String],
    toolchain: &AuthorizedToolchain,
    completeness: &str,
    upstream: &UpstreamStart,
) -> Value {
    json!({
        "languageId": language_id,
        "workspaceRoot": workspace_root,
        "workspaceId": workspace_id,
        "workspaceGeneration": workspace_generation,
        "sessionId": session_id,
        "providerProjectSnapshotIdentity": snapshot_identity,
        "semanticLease": semantic_lease,
        "startSnapshotHash": format!("sha256:{start_snapshot_hash}"),
        "provider": PROVIDER,
        "providerVersion": PROVIDER_VERSION,
        "backend": BACKEND,
        "toolchain": {
            "backend": BACKEND,
            "runtime": runtime_json(runtime),
            "extensions": extensions,
            "nodeExecutable": toolchain.node_executable,
            "languageServerPackageRoot": toolchain.language_server_package_root,
            "typeScriptPackageRoot": toolchain.type_script_package_root
        },
        "semanticCompleteness": completeness,
        "processProvenance": {
            "serverName": upstream.server_name,
            "serverVersion": upstream.server_version,
            "capabilitiesSha256": upstream.capabilities_sha256,
            "executableSha256": upstream.executable_sha256,
            "argumentsSha256": upstream.arguments_sha256,
            "processId": upstream.process_id
        }
    })
}

fn normalize_semantic_stop(value: &Value, language_id: &str) -> SemanticResult<bool> {
    let object = exact_object(
        value,
        &["languageId", "stopped"],
        "typescript-semantic-stop",
    )?;
    if object.get("languageId").and_then(Value::as_str) != Some(language_id)
        || object.get("stopped").and_then(Value::as_bool) != Some(true)
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_SESSION_STOP_RESPONSE_REJECTED",
            "typescript-semantic-stop",
        ));
    }
    Ok(true)
}

#[derive(Clone)]
struct NormalizedSymbol {
    id: String,
    name: String,
    kind: String,
}

fn normalize_symbol_search(value: &Value, root: &Path) -> SemanticResult<Vec<NormalizedSymbol>> {
    let values = value
        .as_array()
        .filter(|items| items.len() <= MAX_SYMBOLS)
        .ok_or_else(|| {
            SavedSnapshotSemanticError::response(
                "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED",
                "symbol-search",
            )
        })?;
    let mut ids = HashSet::with_capacity(values.len());
    let mut symbols = Vec::with_capacity(values.len());
    for value in values {
        let object = exact_object(
            value,
            &["id", "name", "kind", "file", "line"],
            "symbol-search",
        )?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| symbol_id(value));
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| valid_metadata(value));
        let kind = object
            .get("kind")
            .and_then(Value::as_str)
            .filter(|value| valid_metadata(value));
        let file = object.get("file").and_then(Value::as_str);
        let line = object
            .get("line")
            .and_then(Value::as_u64)
            .filter(|line| *line > 0);
        if id.is_none() || name.is_none() || kind.is_none() || file.is_none() || line.is_none() {
            return Err(SavedSnapshotSemanticError::response(
                "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED",
                "symbol-search",
            ));
        }
        let id = id.unwrap();
        if !ids.insert(id.to_string()) {
            return Err(SavedSnapshotSemanticError::response(
                "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED",
                "symbol-search",
            ));
        }
        let authorized = authorize_workspace_file(root, file.unwrap(), "symbol-search")?;
        validate_source_point(root, &authorized, line.unwrap(), None, "symbol-search")?;
        symbols.push(NormalizedSymbol {
            id: id.to_string(),
            name: name.unwrap().to_string(),
            kind: kind.unwrap().to_string(),
        });
    }
    Ok(symbols)
}

struct NormalizedDefinition {
    file: String,
    one_based_line: u64,
    character: u64,
}

fn normalize_definition(
    value: &Value,
    root: &Path,
    expected_id: &str,
    expected: &RetainedSymbol,
) -> SemanticResult<NormalizedDefinition> {
    let object = exact_object(
        value,
        &["id", "name", "kind", "file", "line", "character"],
        "symbol-definition",
    )?;
    let file = object.get("file").and_then(Value::as_str);
    let line = object
        .get("line")
        .and_then(Value::as_u64)
        .filter(|line| *line > 0);
    let character = object.get("character").and_then(Value::as_u64);
    if object.get("id").and_then(Value::as_str) != Some(expected_id)
        || object.get("name").and_then(Value::as_str) != Some(expected.name.as_str())
        || object.get("kind").and_then(Value::as_str) != Some(expected.kind.as_str())
        || file.is_none()
        || line.is_none()
        || character.is_none()
    {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_DEFINITION_RESPONSE_REJECTED",
            "symbol-definition",
        ));
    }
    let file = authorize_workspace_file(root, file.unwrap(), "symbol-definition")?;
    validate_source_point(root, &file, line.unwrap(), character, "symbol-definition")?;
    Ok(NormalizedDefinition {
        file,
        one_based_line: line.unwrap(),
        character: character.unwrap(),
    })
}

fn authorize_workspace_file(
    root: &Path,
    reported: &str,
    stage: &'static str,
) -> SemanticResult<String> {
    let invalid = || {
        SavedSnapshotSemanticError::response(
            if stage == "symbol-search" {
                "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED"
            } else {
                "REFACTORKIT_DEFINITION_RESPONSE_REJECTED"
            },
            stage,
        )
    };
    if reported.is_empty()
        || reported.len() > 4096
        || reported.trim() != reported
        || reported.contains(['\\', ':'])
        || reported.chars().any(char::is_control)
        || Path::new(reported).is_absolute()
        || Path::new(reported)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(invalid());
    }
    let candidate = root.join(reported);
    let canonical = candidate.canonicalize().map_err(|_| invalid())?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err(invalid());
    }
    let relative = canonical.strip_prefix(root).map_err(|_| invalid())?;
    let normalized = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if normalized != reported {
        return Err(invalid());
    }
    Ok(normalized)
}

fn validate_source_point(
    root: &Path,
    relative: &str,
    one_based_line: u64,
    character: Option<u64>,
    stage: &'static str,
) -> SemanticResult<()> {
    let invalid = || {
        SavedSnapshotSemanticError::response(
            if stage == "symbol-search" {
                "REFACTORKIT_SYMBOL_SEARCH_RESPONSE_REJECTED"
            } else {
                "REFACTORKIT_DEFINITION_RESPONSE_REJECTED"
            },
            stage,
        )
    };
    let path = root.join(relative);
    let metadata = fs::metadata(&path).map_err(|_| invalid())?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
        return Err(invalid());
    }
    let source = fs::read_to_string(path).map_err(|_| invalid())?;
    let index = usize::try_from(one_based_line - 1).map_err(|_| invalid())?;
    let mut lines = source.split('\n');
    let line = lines.nth(index).ok_or_else(invalid)?;
    if let Some(character) = character {
        let character = usize::try_from(character).map_err(|_| invalid())?;
        let line = line.strip_suffix('\r').unwrap_or(line);
        let mut boundary = 0usize;
        let mut valid = character == 0;
        for scalar in line.chars() {
            boundary = boundary
                .checked_add(scalar.len_utf16())
                .ok_or_else(invalid)?;
            if boundary == character {
                valid = true;
                break;
            }
            if boundary > character {
                break;
            }
        }
        if !valid {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_search_request(request: &SearchSavedSnapshotSymbolsRequest) -> SemanticResult<()> {
    validate_language(&request.language_id, "symbol-search-request")?;
    validate_identity(&request.workspace_id, "symbol-search-request")?;
    validate_generation(request.workspace_generation, "symbol-search-request")?;
    validate_session_id(&request.session_id, "symbol-search-request")?;
    validate_snapshot_identity(&request.snapshot_identity, "symbol-search-request")?;
    if !valid_semantic_lease(&request.semantic_lease)
        || request.query.is_empty()
        || request.query.len() > MAX_QUERY_BYTES
        || request.query.trim() != request.query
        || request.query.chars().any(char::is_control)
        || request.provider_version != PROVIDER_VERSION
        || request.backend != BACKEND
        || request.toolchain.allow_path_node_discovery
        || request.toolchain.allow_workspace_local_toolchain
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SYMBOL_SEARCH_REQUEST_REJECTED",
            "symbol-search-request",
        ));
    }
    Ok(())
}

fn validate_definition_request(
    request: &ResolveSavedSnapshotDefinitionRequest,
) -> SemanticResult<()> {
    validate_language(&request.language_id, "definition-request")?;
    validate_identity(&request.workspace_id, "definition-request")?;
    validate_generation(request.workspace_generation, "definition-request")?;
    validate_session_id(&request.session_id, "definition-request")?;
    validate_snapshot_identity(&request.snapshot_identity, "definition-request")?;
    if !valid_semantic_lease(&request.semantic_lease)
        || !symbol_id(&request.symbol_id)
        || request.provider_version != PROVIDER_VERSION
        || request.backend != BACKEND
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_DEFINITION_REQUEST_REJECTED",
            "definition-request",
        ));
    }
    Ok(())
}

fn authorize_search(
    request: &SearchSavedSnapshotSymbolsRequest,
    authority: &SemanticAuthority,
) -> SemanticResult<()> {
    if request.language_id != authority.language_id
        || request.workspace_id != authority.workspace_id
        || request.workspace_generation != authority.workspace_generation
        || request.session_id != authority.session_id
        || request.semantic_lease != authority.semantic_lease
        || request.snapshot_identity != authority.snapshot_identity
        || request.snapshot_identity.strip_prefix("sha256:")
            != Some(authority.start_snapshot_hash.as_str())
        || request.provider_version != authority.provider_version
        || request.backend != authority.backend
        || request.toolchain.node_executable != authority.toolchain.node_executable
        || request.toolchain.language_server_package_root
            != authority.toolchain.language_server_package_root
        || request.toolchain.type_script_package_root
            != authority.toolchain.type_script_package_root
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SYMBOL_SEARCH_REQUEST_REJECTED",
            "symbol-search-authority",
        ));
    }
    Ok(())
}

fn authorize_definition(
    request: &ResolveSavedSnapshotDefinitionRequest,
    authority: &SemanticAuthority,
) -> SemanticResult<()> {
    if request.language_id != authority.language_id
        || request.workspace_id != authority.workspace_id
        || request.workspace_generation != authority.workspace_generation
        || request.session_id != authority.session_id
        || request.semantic_lease != authority.semantic_lease
        || request.snapshot_identity != authority.snapshot_identity
        || request.snapshot_identity.strip_prefix("sha256:")
            != Some(authority.start_snapshot_hash.as_str())
        || request.provider_version != authority.provider_version
        || request.backend != authority.backend
    {
        return Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_DEFINITION_REQUEST_REJECTED",
            "definition-authority",
        ));
    }
    Ok(())
}

fn definition_search_matches(
    request: &ResolveSavedSnapshotDefinitionRequest,
    search: &RetainedSearch,
) -> bool {
    request.language_id == search.language_id
        && request.workspace_id == search.workspace_id
        && request.workspace_generation == search.workspace_generation
        && request.session_id == search.session_id
        && request.semantic_lease == search.semantic_lease
        && request.snapshot_identity == search.snapshot_identity
        && request.provider_version == search.provider_version
        && request.backend == search.backend
        && !search.query.is_empty()
}

fn validate_language(language_id: &str, stage: &'static str) -> SemanticResult<()> {
    if matches!(language_id, "typescript" | "javascript") {
        Ok(())
    } else {
        Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_REQUEST_REJECTED",
            stage,
        ))
    }
}

fn validate_generation(generation: u64, stage: &'static str) -> SemanticResult<()> {
    if generation > 0 {
        Ok(())
    } else {
        Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_REQUEST_REJECTED",
            stage,
        ))
    }
}

fn validate_identity(identity: &str, stage: &'static str) -> SemanticResult<()> {
    if !identity.is_empty()
        && identity.len() <= MAX_IDENTITY_BYTES
        && identity.trim() == identity
        && !identity.chars().any(char::is_control)
    {
        Ok(())
    } else {
        Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_REQUEST_REJECTED",
            stage,
        ))
    }
}

fn validate_session_id(session_id: &str, stage: &'static str) -> SemanticResult<()> {
    if session_id
        .strip_prefix("refactorkit-semantic-session-v1:")
        .is_some_and(sha256_digest)
    {
        Ok(())
    } else {
        Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_REQUEST_REJECTED",
            stage,
        ))
    }
}

fn validate_snapshot_identity(identity: &str, stage: &'static str) -> SemanticResult<()> {
    if identity.strip_prefix("sha256:").is_some_and(sha256_digest) {
        Ok(())
    } else {
        Err(SavedSnapshotSemanticError::request(
            "REFACTORKIT_SEMANTIC_REQUEST_REJECTED",
            stage,
        ))
    }
}

fn mint_session_id() -> Result<String, getrandom::Error> {
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random)?;
    let digest = Sha256::digest(random);
    Ok(format!(
        "refactorkit-semantic-session-v1:{}",
        hex_lower(&digest)
    ))
}

fn expected_extensions(language_id: &str) -> Vec<String> {
    match language_id {
        "typescript" => vec!["ts".to_string(), "tsx".to_string()],
        "javascript" => vec!["js".to_string(), "jsx".to_string()],
        _ => Vec::new(),
    }
}

fn accepted_completeness_is_valid(language_id: &str, accepted: &[String]) -> bool {
    match language_id {
        "typescript" => accepted == ["full-typescript"],
        "javascript" => {
            accepted == ["checked-javascript"]
                || accepted == ["dynamic-javascript", "mixed-javascript"]
        }
        _ => false,
    }
}

fn runtime_request_is_v062(runtime: &SemanticRuntimeRequest) -> bool {
    runtime.execution_mode == "external-process"
        && runtime.supports_timeout
        && runtime.supports_cancellation
        && runtime.uses_workspace_overlay
        && runtime.records_process_provenance
        && runtime.limits.request_timeout_millis == REQUEST_TIMEOUT_MILLIS
        && runtime.limits.max_input_bytes == MAX_INPUT_BYTES
        && runtime.limits.max_output_bytes == MAX_OUTPUT_BYTES
        && runtime.limits.max_processes == MAX_PROCESSES
}

fn runtime_capability_is_v062(runtime: &LanguageAdapterRuntime) -> bool {
    runtime.execution_mode == "external-process"
        && runtime.supports_timeout
        && runtime.supports_cancellation
        && runtime.uses_workspace_overlay
        && runtime.records_process_provenance
        && limits_are_v062(&runtime.limits)
}

fn limits_are_v062(limits: &LanguageAdapterResourceLimits) -> bool {
    limits.request_timeout_millis == Some(REQUEST_TIMEOUT_MILLIS)
        && limits.max_input_bytes == Some(MAX_INPUT_BYTES)
        && limits.max_output_bytes == Some(MAX_OUTPUT_BYTES)
        && limits.max_processes == Some(MAX_PROCESSES)
}

fn runtime_json(runtime: &SemanticRuntimeRequest) -> Value {
    json!({
        "executionMode": runtime.execution_mode,
        "supportsTimeout": runtime.supports_timeout,
        "supportsCancellation": runtime.supports_cancellation,
        "usesWorkspaceOverlay": runtime.uses_workspace_overlay,
        "recordsProcessProvenance": runtime.records_process_provenance,
        "limits": {
            "requestTimeoutMillis": runtime.limits.request_timeout_millis,
            "maxInputBytes": runtime.limits.max_input_bytes,
            "maxOutputBytes": runtime.limits.max_output_bytes,
            "maxProcesses": runtime.limits.max_processes
        }
    })
}

fn exact_object<'a>(
    value: &'a Value,
    fields: &[&str],
    stage: &'static str,
) -> SemanticResult<&'a Map<String, Value>> {
    let object = value.as_object().ok_or_else(|| {
        SavedSnapshotSemanticError::response("REFACTORKIT_SEMANTIC_RESPONSE_REJECTED", stage)
    })?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
        return Err(SavedSnapshotSemanticError::response(
            "REFACTORKIT_SEMANTIC_RESPONSE_REJECTED",
            stage,
        ));
    }
    Ok(object)
}

fn digest_field(object: &Map<String, Value>, field: &str) -> Option<String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| sha256_digest(value))
        .map(ToString::to_string)
}

fn valid_metadata(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_METADATA_BYTES
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn symbol_id(value: &str) -> bool {
    value
        .strip_prefix("lsp-symbol-v1:")
        .is_some_and(sha256_digest)
}

fn sha256_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
static AUDIT_CHECKPOINTS: std::sync::OnceLock<Mutex<Vec<(String, String)>>> =
    std::sync::OnceLock::new();

/// Snapshot the workspace byte tree: every non-directory entry's path plus its content sha256
/// under `root`, walked recursively. Directories are traversed but never hashed themselves, so
/// empty-directory-only changes are not represented. Symlinks are recorded as files (content
/// follows the target) so no non-directory entry type is silently dropped from the audit.
#[cfg(test)]
fn snapshot_workspace_tree(root: &Path) -> Vec<(PathBuf, [u8; 32])> {
    let mut entries = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let file_type = entry.file_type().unwrap();
            if file_type.is_dir() {
                stack.push(path);
            } else {
                let digest: [u8; 32] = Sha256::digest(&fs::read(&path).unwrap()).into();
                entries.push((path, digest));
            }
        }
    }
    entries
}

/// Compute a deterministic content-based tree fingerprint: sha256 over the sorted
/// `relative-path content-sha256` lines. The fingerprint covers only non-directory file
/// path/content pairs sampled at discrete operation boundaries. It does NOT detect metadata-only
/// changes, empty-directory-only changes, or transient create/delete changes that do not persist
/// at a sampled boundary. It proves the workspace file byte-tree (non-directory path + content)
/// is unchanged across the sampled boundaries.
#[cfg(test)]
fn tree_fingerprint(root: &Path) -> String {
    let mut entries = snapshot_workspace_tree(root);
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut canonical = String::new();
    for (path, digest) in entries {
        let rel = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        canonical.push_str(&format!("{rel} {}\n", hex_lower(&digest)));
    }
    hex_lower(&Sha256::digest(canonical.as_bytes()))
}

/// Test-only audit checkpoint registry: production `start()` records the workspace tree
/// fingerprint after each internal operation boundary (project.open, semantic.start) so the smoke
/// audit can prove no write persists through any checkpoint. These hooks are compiled out of
/// production builds (`#[cfg(test)]`), so the production daemon path is unaffected.
#[cfg(test)]
fn record_checkpoint(label: &str, root: &Path) {
    let fingerprint = tree_fingerprint(root);
    AUDIT_CHECKPOINTS
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap()
        .push((label.to_string(), fingerprint));
}

/// Drain the recorded audit checkpoints.
#[cfg(test)]
fn take_checkpoints() -> Vec<(String, String)> {
    let mut registry = AUDIT_CHECKPOINTS
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap();
    std::mem::take(&mut *registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("ide-rk-semantic-{label}-{unique}"));
        fs::create_dir_all(root.join("src")).unwrap();
        root.canonicalize().unwrap()
    }

    /// IDE revision: the current HEAD commit of the IDE repository, discovered from the crate
    /// manifest directory (git2 is a crate dependency). Used for durable audit provenance.
    fn ide_revision() -> String {
        use git2::Repository;
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        Repository::discover(manifest)
            .and_then(|repo| {
                repo.revparse_single("HEAD")
                    .map(|object| object.id().to_string())
            })
            .unwrap_or_else(|_| "not-provided".into())
    }

    /// Stable source fingerprint algorithm recorded in every receipt. This is Git's exact tree
    /// object identity, not an IDE-defined traversal or a hash of working-tree bytes.
    const PROVIDER_SOURCE_FINGERPRINT_ALGORITHM: &str = "git-tree-oid-sha1-v1";

    fn provider_source_tree_identity_at(root: &Path, commit: &str) -> Option<String> {
        use git2::Repository;
        Repository::discover(root)
            .ok()?
            .revparse_single(commit)
            .ok()?
            .peel_to_tree()
            .ok()
            .map(|tree| tree.id().to_string())
    }

    /// Exact committed-source identity. Reads `IDE_REFORKIT_SOURCE_ROOT` and
    /// `IDE_REFORKIT_SOURCE_COMMIT`, resolves `<commit>^{tree}`, and returns the Git tree object ID.
    /// The receipt always pairs this value with `git-tree-oid-sha1-v1`, making the contract
    /// independently reproducible with `git rev-parse '<commit>^{tree}'`. Dirty working-tree state
    /// cannot alter this identity. Invalid or missing input returns `not-provided`.
    fn provider_source_tree_hash() -> String {
        let root = match env::var("IDE_REFORKIT_SOURCE_ROOT") {
            Ok(root) => PathBuf::from(root),
            Err(_) => return "not-provided".into(),
        };
        let commit = match env::var("IDE_REFORKIT_SOURCE_COMMIT") {
            Ok(commit) => commit,
            Err(_) => return "not-provided".into(),
        };
        provider_source_tree_identity_at(&root, &commit).unwrap_or_else(|| "not-provided".into())
    }

    /// Provider source git HEAD: the current commit of the RefactorKit provider source tree from
    /// `IDE_REFORKIT_SOURCE_ROOT`, discovered via git2. When the env var is unset or git discovery
    /// fails, returns "not-provided" and NO git source revision is claimed.
    fn provider_source_git_head() -> String {
        let root = match env::var("IDE_REFORKIT_SOURCE_ROOT") {
            Ok(root) => PathBuf::from(root),
            Err(_) => return "not-provided".into(),
        };
        use git2::Repository;
        Repository::discover(&root)
            .and_then(|repo| {
                repo.revparse_single("HEAD")
                    .map(|object| object.id().to_string())
            })
            .unwrap_or_else(|_| "not-provided".into())
    }

    /// Provider source git cleanliness: true only when the independent Git CLI reports an empty
    /// `status --porcelain=v1 --untracked-files=all`. Ignored Gradle build outputs are intentionally
    /// outside Git cleanliness, while modified, staged, and untracked source files fail closed.
    fn provider_source_git_clean() -> bool {
        let root = match env::var("IDE_REFORKIT_SOURCE_ROOT") {
            Ok(root) => PathBuf::from(root),
            Err(_) => return false,
        };
        std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["status", "--porcelain=v1", "--untracked-files=all"])
            .output()
            .map(|output| output.status.success() && output.stdout.is_empty())
            .unwrap_or(false)
    }

    /// Build-to-source containment: whether the built daemon binary (`IDE_REFORKIT_DAEMON`) lives
    /// within the provider source tree (`IDE_REFORKIT_SOURCE_ROOT`) after canonicalization. This
    /// helper only confirms path containment. The separate create-new build attestation validates
    /// the clean detached source identity, exact Gradle/JDK invocation, build log, and resulting
    /// daemon hash without claiming a signed or hermetic compiler chain. When either env var is
    /// unset or canonicalization fails, returns false and NO containment claim is made.
    fn daemon_binary_inside_source_tree() -> bool {
        let root = match env::var("IDE_REFORKIT_SOURCE_ROOT") {
            Ok(root) => PathBuf::from(root),
            Err(_) => return false,
        };
        let Ok(root) = fs::canonicalize(&root) else {
            return false;
        };
        let daemon = match env::var("IDE_REFORKIT_DAEMON") {
            Ok(daemon) => PathBuf::from(daemon),
            Err(_) => return false,
        };
        let Ok(daemon) = fs::canonicalize(&daemon) else {
            return false;
        };
        daemon.starts_with(&root)
    }

    /// Build-to-source layout verification (RQR-TS002-PROVENANCE-002): whether the built daemon
    /// binary (`IDE_REFORKIT_DAEMON`) is a build artifact located at the expected source-built Gradle
    /// install path inside the provider source root. Requires BOTH:
    ///   (1) path containment — the canonical daemon binary lives inside the canonical
    ///       `IDE_REFORKIT_SOURCE_ROOT` tree; AND
    ///   (2) the expected source-built Gradle install layout — the daemon's relative path from the
    ///       source root matches `<root>/modules/refactorkit-daemon/build/install/<app>/bin/
    ///       refactorkit-daemon` (install application directory followed by `bin/refactorkit-daemon`
    ///       launcher).
    ///
    /// This helper only confirms the expected path layout. Final evidence additionally requires a
    /// validated create-new build attestation from a clean detached worktree, including exact source
    /// HEAD/tree, Gradle command, JDK 21 versions, build-log hash, and daemon hash. That observed
    /// build chain is explicitly not a signed or hermetic compiler attestation. When either env var
    /// is unset or verification fails, returns false and NO layout claim is made.
    fn daemon_binary_build_layout_verified() -> bool {
        let root = match env::var("IDE_REFORKIT_SOURCE_ROOT") {
            Ok(root) => PathBuf::from(root),
            Err(_) => return false,
        };
        let Ok(root) = fs::canonicalize(&root) else {
            return false;
        };
        let daemon = match env::var("IDE_REFORKIT_DAEMON") {
            Ok(daemon) => PathBuf::from(daemon),
            Err(_) => return false,
        };
        let Ok(daemon) = fs::canonicalize(&daemon) else {
            return false;
        };
        // (1) path containment within the hashed source tree.
        if !daemon.starts_with(&root) {
            return false;
        }
        // (2) expected build layout: modules/refactorkit-daemon/build/install/<app>/bin/refactorkit-daemon.
        let Ok(relative) = daemon.strip_prefix(&root) else {
            return false;
        };
        let Ok(relative) =
            relative.strip_prefix(Path::new("modules/refactorkit-daemon/build/install"))
        else {
            return false;
        };
        let mut components = relative.components();
        // First component is the install application directory (e.g. `refactorkit-daemon`); the
        // remaining two must be exactly `bin` and `refactorkit-daemon`.
        let Some(Component::Normal(_app)) = components.next() else {
            return false;
        };
        let rest: Vec<_> = components.collect();
        rest.len() == 2
            && rest[0].as_os_str() == "bin"
            && rest[1].as_os_str() == "refactorkit-daemon"
    }

    struct ValidatedBuildAttestation {
        path: String,
        sha256: String,
        build_log_path: String,
        build_log_sha256: String,
        java_home: String,
        java_version: String,
        javac_version: String,
        gradle_version: String,
        build_command: Value,
        build_started_epoch_seconds: u64,
        build_finished_epoch_seconds: u64,
    }

    fn attest_string<'a>(object: &'a Map<String, Value>, field: &str) -> Result<&'a str, String> {
        object
            .get(field)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("build attestation field {field} must be a non-empty string"))
    }

    /// Validate the create-new artifact emitted immediately by the clean detached-worktree build.
    /// This does not claim a signed or hermetic compiler chain; it binds the observed clean Git
    /// identity, exact Gradle command/JDK, build log, and resulting daemon launcher bytes.
    fn validate_build_attestation(
        attestation_path: &Path,
        expected_source_root: &Path,
        expected_commit: &str,
        expected_tree: &str,
        expected_daemon: &Path,
    ) -> Result<ValidatedBuildAttestation, String> {
        let metadata = fs::symlink_metadata(attestation_path)
            .map_err(|error| format!("cannot stat build attestation: {error}"))?;
        if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > 64 * 1024 {
            return Err("build attestation must be a non-empty regular file <= 64 KiB".into());
        }
        let bytes = fs::read(attestation_path)
            .map_err(|error| format!("cannot read build attestation: {error}"))?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("cannot parse build attestation JSON: {error}"))?;
        let object = value
            .as_object()
            .ok_or_else(|| "build attestation must be a JSON object".to_string())?;
        let fields = [
            "schemaVersion",
            "sourceRoot",
            "sourceGitHead",
            "sourceGitTree",
            "sourceGitDetached",
            "sourceGitCleanBefore",
            "sourceGitCleanAfter",
            "buildCommand",
            "javaHome",
            "jdkMajor",
            "javaVersion",
            "javacVersion",
            "gradleVersion",
            "buildLogPath",
            "buildLogSha256",
            "daemonPath",
            "daemonSha256",
            "buildStartedEpochSeconds",
            "buildFinishedEpochSeconds",
            "createdAtUtc",
        ];
        if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
            return Err("build attestation fields do not match schema v1 exactly".into());
        }
        if attest_string(object, "schemaVersion")? != "refactorkit-daemon-build-attestation-v1" {
            return Err("unsupported build attestation schema".into());
        }
        let source_root = fs::canonicalize(attest_string(object, "sourceRoot")?)
            .map_err(|error| format!("cannot canonicalize attested source root: {error}"))?;
        let expected_source_root = fs::canonicalize(expected_source_root)
            .map_err(|error| format!("cannot canonicalize expected source root: {error}"))?;
        if source_root != expected_source_root {
            return Err("attested source root does not match audited source root".into());
        }
        if attest_string(object, "sourceGitHead")? != expected_commit
            || attest_string(object, "sourceGitTree")? != expected_tree
            || object.get("sourceGitDetached").and_then(Value::as_bool) != Some(true)
            || object.get("sourceGitCleanBefore").and_then(Value::as_bool) != Some(true)
            || object.get("sourceGitCleanAfter").and_then(Value::as_bool) != Some(true)
        {
            return Err(
                "attested source Git identity/cleanliness does not match audit input".into(),
            );
        }
        let git_output = |arguments: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&source_root)
                .args(arguments)
                .output()
                .map_err(|error| format!("cannot execute Git for build attestation: {error}"))
        };
        let actual_head_output = git_output(&["rev-parse", "HEAD"])?;
        let actual_head = String::from_utf8(actual_head_output.stdout)
            .map_err(|_| "attested source HEAD is not UTF-8".to_string())?
            .trim()
            .to_string();
        let status = git_output(&["status", "--porcelain=v1", "--untracked-files=all"])?;
        let symbolic = git_output(&["symbolic-ref", "-q", "HEAD"])?;
        if !actual_head_output.status.success()
            || actual_head != expected_commit
            || !status.status.success()
            || !status.stdout.is_empty()
            || symbolic.status.success()
        {
            return Err("audited source is not currently clean, detached, and commit-exact".into());
        }
        let expected_command = json!([
            "./gradlew",
            "--no-daemon",
            "clean",
            ":modules:refactorkit-daemon:installDist"
        ]);
        if object.get("buildCommand") != Some(&expected_command) {
            return Err("attested Gradle build command is not the required exact command".into());
        }
        if object.get("jdkMajor").and_then(Value::as_u64) != Some(21) {
            return Err("attested build did not use JDK 21".into());
        }
        let java_home = fs::canonicalize(attest_string(object, "javaHome")?)
            .map_err(|error| format!("cannot canonicalize attested JAVA_HOME: {error}"))?;
        if !java_home.join("bin/java").is_file() || !java_home.join("bin/javac").is_file() {
            return Err("attested JAVA_HOME lacks java or javac".into());
        }
        let daemon = fs::canonicalize(attest_string(object, "daemonPath")?)
            .map_err(|error| format!("cannot canonicalize attested daemon: {error}"))?;
        let expected_daemon = fs::canonicalize(expected_daemon)
            .map_err(|error| format!("cannot canonicalize expected daemon: {error}"))?;
        if daemon != expected_daemon {
            return Err("attested daemon path does not match audited daemon".into());
        }
        let daemon_bytes =
            fs::read(&daemon).map_err(|error| format!("cannot read attested daemon: {error}"))?;
        if attest_string(object, "daemonSha256")? != hex_lower(&Sha256::digest(&daemon_bytes)) {
            return Err("attested daemon SHA-256 does not match audited daemon bytes".into());
        }
        let build_log = fs::canonicalize(attest_string(object, "buildLogPath")?)
            .map_err(|error| format!("cannot canonicalize attested build log: {error}"))?;
        if !fs::symlink_metadata(&build_log)
            .map(|metadata| metadata.file_type().is_file())
            .unwrap_or(false)
        {
            return Err("attested build log is not a regular file".into());
        }
        let build_log_sha256 = hex_lower(&Sha256::digest(
            fs::read(&build_log).map_err(|error| format!("cannot read build log: {error}"))?,
        ));
        if attest_string(object, "buildLogSha256")? != build_log_sha256 {
            return Err("attested build-log SHA-256 does not match build-log bytes".into());
        }
        let started = object
            .get("buildStartedEpochSeconds")
            .and_then(Value::as_u64)
            .ok_or_else(|| "buildStartedEpochSeconds must be an unsigned integer".to_string())?;
        let finished = object
            .get("buildFinishedEpochSeconds")
            .and_then(Value::as_u64)
            .filter(|finished| *finished >= started)
            .ok_or_else(|| "buildFinishedEpochSeconds must be >= build start".to_string())?;
        let daemon_modified = fs::metadata(&daemon)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .ok_or_else(|| "daemon modification time is unavailable".to_string())?;
        if daemon_modified < started {
            return Err("daemon launcher predates the clean build start".into());
        }
        let java_version = attest_string(object, "javaVersion")?.to_string();
        let javac_version = attest_string(object, "javacVersion")?.to_string();
        let gradle_version = attest_string(object, "gradleVersion")?.to_string();
        if !java_version.contains("version \"21") || !javac_version.starts_with("javac 21") {
            return Err("attested Java tool versions are not JDK 21".into());
        }
        Ok(ValidatedBuildAttestation {
            path: fs::canonicalize(attestation_path)
                .map_err(|error| format!("cannot canonicalize build attestation: {error}"))?
                .to_string_lossy()
                .into_owned(),
            sha256: hex_lower(&Sha256::digest(&bytes)),
            build_log_path: build_log.to_string_lossy().into_owned(),
            build_log_sha256,
            java_home: java_home.to_string_lossy().into_owned(),
            java_version,
            javac_version,
            gradle_version,
            build_command: expected_command,
            build_started_epoch_seconds: started,
            build_finished_epoch_seconds: finished,
        })
    }

    #[cfg(unix)]
    struct NodeAuditControls {
        root: PathBuf,
        wrapper: PathBuf,
        trace: PathBuf,
        guard_path: PathBuf,
        real_node: PathBuf,
    }

    #[cfg(unix)]
    fn shell_quote_path(path: &Path) -> String {
        format!("'{}'", path.to_string_lossy().replace('\'', "'\"'\"'"))
    }

    /// Install a controlled Node wrapper and inherited preload. The wrapper records each Node
    /// process, the preload records language-server/TypeScript module resolution and child-process
    /// attempts, and PATH guards fail package-manager launches. This is process evidence, not a
    /// system-call-complete sandbox: an absolute package-manager executable launched directly by
    /// JVM code would not pass through the PATH guards.
    #[cfg(unix)]
    fn create_node_audit_controls(
        real_node: &Path,
        language_server: &Path,
        typescript: &Path,
        workspace: &Path,
    ) -> NodeAuditControls {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/rk-semantic-process-traces")
            .join(format!("trace-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let trace = root.join("node-process-trace.jsonl");
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&trace)
            .unwrap();
        let preload = fs::canonicalize(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/node-process-audit-preload.cjs"),
        )
        .unwrap();
        let wrapper = root.join("controlled-node");
        let wrapper_text = format!(
            "#!/bin/sh\nset -eu\nprintf '%s\\n' '{{\"event\":\"wrapper-invocation\"}}' >> {}\nexport IDE_NODE_AUDIT_TRACE={}\nexport IDE_NODE_AUDIT_LANGUAGE_SERVER_ROOT={}\nexport IDE_NODE_AUDIT_TYPESCRIPT_ROOT={}\nexport IDE_NODE_AUDIT_WORKSPACE_ROOT={}\nexport NODE_OPTIONS={}\nexec {} \"$@\"\n",
            shell_quote_path(&trace),
            shell_quote_path(&trace),
            shell_quote_path(language_server),
            shell_quote_path(typescript),
            shell_quote_path(workspace),
            shell_quote_path(Path::new(&format!("--require={}", preload.display()))),
            shell_quote_path(real_node),
        );
        fs::write(&wrapper, wrapper_text).unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();

        let guard_path = root.join("path-guards");
        fs::create_dir(&guard_path).unwrap();
        for command in ["npm", "npx", "pnpm", "yarn", "bun", "bunx", "corepack"] {
            let guard = guard_path.join(command);
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&guard)
                .unwrap();
            file.write_all(
                b"#!/bin/sh\nprintf '{\"event\":\"prohibited-path-command\",\"command\":\"%s\"}\\n' \"$(basename \"$0\")\" >> \"$IDE_NODE_AUDIT_TRACE\"\nexit 97\n",
            )
            .unwrap();
            fs::set_permissions(&guard, fs::Permissions::from_mode(0o700)).unwrap();
        }
        NodeAuditControls {
            root,
            wrapper: fs::canonicalize(wrapper).unwrap(),
            trace: fs::canonicalize(trace).unwrap(),
            guard_path: fs::canonicalize(guard_path).unwrap(),
            real_node: fs::canonicalize(real_node).unwrap(),
        }
    }

    #[cfg(unix)]
    fn validate_node_process_trace(
        controls: &NodeAuditControls,
        language_server: &Path,
        typescript: &Path,
    ) -> (String, Value) {
        let bytes = fs::read(&controls.trace).unwrap();
        assert!(!bytes.is_empty() && bytes.len() <= 8 * 1024 * 1024);
        let mut wrapper_invocations = 0u64;
        let mut process_starts = 0u64;
        let mut language_server_observations = 0u64;
        let mut typescript_observations = 0u64;
        let mut child_process_attempts = 0u64;
        for line in bytes
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
        {
            let event: Value = serde_json::from_slice(line).unwrap();
            let object = event.as_object().unwrap();
            let event_name = object.get("event").and_then(Value::as_str).unwrap();
            assert!(
                !event_name.starts_with("prohibited-"),
                "prohibited package-manager/project execution observed: {event}"
            );
            if event_name == "wrapper-invocation" {
                wrapper_invocations += 1;
            }
            if event_name == "process-start" {
                process_starts += 1;
                assert_eq!(
                    object.get("execPath").and_then(Value::as_str),
                    Some(controls.real_node.to_str().unwrap()),
                    "every traced process must execute the explicitly supplied real Node binary"
                );
            }
            if event_name == "child-process-attempt" {
                child_process_attempts += 1;
            }
            let serialized = event.to_string();
            if serialized.contains(language_server.to_str().unwrap()) {
                language_server_observations += 1;
            }
            if serialized.contains(typescript.to_str().unwrap()) {
                typescript_observations += 1;
            }
        }
        assert!(
            wrapper_invocations >= 2,
            "expected controlled-wrapper invocations for the Node probe and language server"
        );
        assert!(
            process_starts >= 2,
            "expected traced language-server and TypeScript child processes"
        );
        assert!(
            language_server_observations > 0,
            "trace must bind execution to the supplied language-server package root"
        );
        assert!(
            typescript_observations > 0,
            "trace must bind execution/module resolution to the supplied TypeScript package root"
        );
        (
            hex_lower(&Sha256::digest(&bytes)),
            json!({
                "wrapperInvocationCount": wrapper_invocations,
                "processStartCount": process_starts,
                "languageServerPathObservationCount": language_server_observations,
                "typeScriptPathObservationCount": typescript_observations,
                "childProcessAttemptCount": child_process_attempts,
                "prohibitedInvocationCount": 0,
                "pathGuardedPackageManagers": ["npm", "npx", "pnpm", "yarn", "bun", "bunx", "corepack"]
            }),
        )
    }

    fn runtime() -> SemanticRuntimeRequest {
        SemanticRuntimeRequest {
            execution_mode: "external-process".into(),
            supports_timeout: true,
            supports_cancellation: true,
            uses_workspace_overlay: true,
            records_process_provenance: true,
            limits: SemanticRuntimeLimitsRequest {
                request_timeout_millis: REQUEST_TIMEOUT_MILLIS,
                max_input_bytes: MAX_INPUT_BYTES,
                max_output_bytes: MAX_OUTPUT_BYTES,
                max_processes: MAX_PROCESSES,
            },
        }
    }

    fn runtime_value() -> Value {
        runtime_json(&runtime())
    }

    fn start_request() -> StartSavedSnapshotSemanticSessionRequest {
        StartSavedSnapshotSemanticSessionRequest {
            language_id: "typescript".into(),
            workspace_root: "/workspace".into(),
            workspace_id: "workspace".into(),
            workspace_generation: 1,
            provider: PROVIDER.into(),
            provider_version: PROVIDER_VERSION.into(),
            backend: BACKEND.into(),
            runtime: runtime(),
            extensions: vec!["ts".into(), "tsx".into()],
            toolchain: ExternalToolchainRequest {
                node_executable: "/tools/node".into(),
                language_server_package_root: "/tools/typescript-language-server".into(),
                type_script_package_root: "/tools/typescript".into(),
                allow_path_node_discovery: false,
                allow_workspace_local_toolchain: false,
            },
            accepted_semantic_completeness: vec!["full-typescript".into()],
        }
    }

    fn v070_capabilities() -> Value {
        let runtime = runtime_value();
        json!({
            "name": PROVIDER_NAME,
            "version": PROVIDER_VERSION,
            "apiVersion": API_VERSION,
            "protocol": "json-rpc-2.0",
            "transport": "stdio",
            "methods": [
                {"name": "refactor.apply", "stability": "beta-contract", "requiresProject": true, "writesWorkspace": true},
                {"name": "refactor.discard", "stability": "beta-contract", "requiresProject": false, "writesWorkspace": false},
                {"name": "patch.rollback", "stability": "beta-contract", "requiresProject": true, "writesWorkspace": true},
                {"name": "java.importExternalClass", "stability": "experimental", "requiresProject": true, "writesWorkspace": false,
                    "features": {"targetDirectory": true, "preview": true, "apply": true, "discard": true, "rollback": true}},
                {"name": "typescript.semantic.start", "stability": "experimental", "requiresProject": true, "writesWorkspace": false,
                    "features": {"explicitToolchain": true, "hashBoundProvenance": true, "noPackageScripts": true}},
                {"name": "typescript.semantic.stop", "stability": "experimental", "requiresProject": true, "writesWorkspace": false},
                {"name": "symbol.search", "stability": "beta-contract", "requiresProject": true, "writesWorkspace": false},
                {"name": "symbol.definition", "stability": "beta-contract", "requiresProject": true, "writesWorkspace": false}
            ],
            "languageKernel": {
                "schemaVersion": 1,
                "adapters": [{
                    "languageId": "typescript",
                    "extensions": ["ts", "tsx"],
                    "backend": ADAPTER_BACKEND,
                    "runtime": runtime,
                    "capabilities": [
                        {"operation": "definition", "stability": "experimental", "evidence": "language-server", "mutationAuthority": "none",
                            "backend": BACKEND, "runtime": runtime_value(), "extensions": ["ts", "tsx"]},
                        {"operation": "workspaceSymbols", "stability": "experimental", "evidence": "language-server", "mutationAuthority": "none",
                            "backend": BACKEND, "runtime": runtime_value(), "extensions": ["ts", "tsx"]}
                    ]
                }],
                "vocabulary": {
                    "stability": ["stable", "experimental", "structural", "refused", "not-applicable"],
                    "evidence": ["compiler", "language-server", "native-ast", "structural-parse", "lexical", "none"],
                    "mutationAuthority": ["managed-stable", "proposal-only", "none"],
                    "executionMode": ["in-process", "external-process"]
                }
            },
            "safety": {"previewBeforeApply": true, "snapshotValidation": true, "transactionRollback": true, "workspaceScopedWrites": true}
        })
    }

    #[test]
    fn upstream_params_are_minimal_and_disable_both_discovery_paths() {
        let request = start_request();
        let toolchain = AuthorizedToolchain {
            node_executable: request.toolchain.node_executable.clone(),
            language_server_package_root: request.toolchain.language_server_package_root.clone(),
            type_script_package_root: request.toolchain.type_script_package_root.clone(),
        };
        assert_eq!(
            semantic_start_params("typescript", &toolchain),
            json!({
                "languageId": "typescript",
                "nodeExecutable": "/tools/node",
                "languageServerPackageRoot": "/tools/typescript-language-server",
                "typeScriptPackageRoot": "/tools/typescript",
                "allowPathNodeDiscovery": false,
                "allowWorkspaceLocalToolchain": false
            })
        );
        assert_eq!(
            symbol_search_params("typescript", "Service"),
            json!({"languageId": "typescript", "query": "Service"})
        );
        assert_eq!(
            symbol_definition_params("typescript", &format!("lsp-symbol-v1:{}", "a".repeat(64))),
            json!({
                "languageId": "typescript",
                "symbol": format!("lsp-symbol-v1:{}", "a".repeat(64))
            })
        );
    }

    #[test]
    fn immutable_v070_capability_evidence_is_required_exactly() {
        let raw = v070_capabilities();
        let normalized = normalize_server_capabilities(&raw).unwrap();
        verify_v070_capabilities(&raw, &normalized, &start_request()).unwrap();

        for wrong_version in ["0.6.2", "0.6.3"] {
            let mut wrong_provider = raw.clone();
            wrong_provider["version"] = json!(wrong_version);
            let normalized = normalize_server_capabilities(&wrong_provider).unwrap();
            assert!(
                verify_v070_capabilities(&wrong_provider, &normalized, &start_request()).is_err(),
                "v{wrong_version} capability evidence must be rejected"
            );
        }

        let mut structural = raw;
        structural["languageKernel"]["adapters"][0]["capabilities"][1]["evidence"] =
            json!("native-ast");
        let normalized = normalize_server_capabilities(&structural).unwrap();
        assert!(verify_v070_capabilities(&structural, &normalized, &start_request()).is_err());
    }

    #[test]
    fn javascript_completeness_accepts_only_the_two_qualified_policy_shapes() {
        assert!(accepted_completeness_is_valid(
            "javascript",
            &["checked-javascript".into()]
        ));
        assert!(accepted_completeness_is_valid(
            "javascript",
            &["dynamic-javascript".into(), "mixed-javascript".into()]
        ));
        assert!(!accepted_completeness_is_valid(
            "javascript",
            &["mixed-javascript".into()]
        ));
    }

    #[test]
    fn semantic_start_rejects_added_compiler_attestation() {
        let request = start_request();
        let digest = "d".repeat(64);
        let mut upstream = json!({
            "languageId": "typescript",
            "status": "started",
            "semanticLease": "semantic-00000000-0000-4000-8000-000000000001",
            "snapshotHash": digest,
            "completeness": "full-typescript",
            "serverName": "typescript-language-server",
            "serverVersion": "5.1.3",
            "capabilitiesSha256": "a".repeat(64),
            "executableSha256": "b".repeat(64),
            "argumentsSha256": "c".repeat(64),
            "processId": 42,
            "index": {"sources": 1}
        });
        assert!(normalize_semantic_start(&upstream, &request, &digest).is_ok());
        upstream["compilerAttestation"] = json!({"compiler": "invented"});
        assert!(normalize_semantic_start(&upstream, &request, &digest).is_err());
    }

    #[test]
    fn semantic_start_validates_lease_snapshot_binding_and_index() {
        let request = start_request();
        let digest = "e".repeat(64);
        let base = json!({
            "languageId": "typescript",
            "status": "started",
            "semanticLease": "semantic-00000000-0000-4000-8000-000000000009",
            "snapshotHash": digest,
            "completeness": "full-typescript",
            "serverName": "typescript-language-server",
            "serverVersion": "5.1.3",
            "capabilitiesSha256": "a".repeat(64),
            "executableSha256": "b".repeat(64),
            "argumentsSha256": "c".repeat(64),
            "processId": 42,
            "index": {"status": "ready"}
        });
        assert!(normalize_semantic_start(&base, &request, &digest).is_ok());

        // (b) semanticLease must match the exact provider contract:
        // `semantic-` followed by exactly 36 lowercase hexadecimal/hyphen bytes.
        for lease in [
            "lease-1",
            "",
            "semantic-",
            "semantic-lease-1",
            "semantic-00000000-0000-4000-8000-00000000000",
            "semantic-00000000-0000-4000-8000-0000000000000",
            "semantic-00000000-0000-4000-8000-00000000000g",
            "semantic-00000000-0000-4000-8000-00000000000A",
            "semantic-00000000_0000-4000-8000-000000000000",
            "semantic-00000000-0000-4000-8000-00000000000\u{0000}",
            " semantic-00000000-0000-4000-8000-000000000000",
        ] {
            let mut bad = base.clone();
            bad["semanticLease"] = json!(lease);
            assert!(
                normalize_semantic_start(&bad, &request, &digest).is_err(),
                "lease {lease}"
            );
        }

        // (a) snapshotHash must equal the project.open snapshot digest (same value).
        let mut mismatched = base.clone();
        mismatched["snapshotHash"] = json!("f".repeat(64));
        assert!(normalize_semantic_start(&mismatched, &request, &digest).is_err());
        let mut short = base.clone();
        short["snapshotHash"] = json!("deadbeef");
        assert!(normalize_semantic_start(&short, &request, &digest).is_err());

        // (c) index must be present and structurally valid (ready or a valid descriptor).
        let mut absent = base.clone();
        absent["index"] = Value::Null;
        assert!(normalize_semantic_start(&absent, &request, &digest).is_err());
        let mut invalid = base.clone();
        invalid["index"] = json!({});
        assert!(normalize_semantic_start(&invalid, &request, &digest).is_err());
        let mut statused = base.clone();
        statused["index"] = json!({"status": "building"});
        assert!(normalize_semantic_start(&statused, &request, &digest).is_ok());
    }

    #[test]
    fn native_session_ids_are_opaque_and_distinct() {
        let first = mint_session_id().unwrap();
        let second = mint_session_id().unwrap();
        assert!(first
            .strip_prefix("refactorkit-semantic-session-v1:")
            .is_some_and(sha256_digest));
        assert_ne!(first, second);
    }

    #[test]
    fn start_result_emits_prefixed_sha256_start_snapshot_hash_for_adapter() {
        // Builds the adapter's parseSemanticSessionStartCandidate-style shape via the same
        // assemble_start_result used by production start(). The Tauri adapter requires
        // startSnapshotHash to be a PREFIXED sha256 identity (sha256:<64hex>), matching
        // validSha256Identity / SHA256_IDENTITY, and rejects an unprefixed digest. Both identity
        // fields (providerProjectSnapshotIdentity and startSnapshotHash) must be present and the
        // prefixed startSnapshotHash must equal the prefixed snapshot identity.
        let digest = "a".repeat(64);
        let snapshot_identity = format!("sha256:{digest}");
        let upstream = UpstreamStart {
            completeness: "full-typescript".into(),
            semantic_lease: "semantic-00000000-0000-4000-8000-000000000001".into(),
            snapshot_hash: digest.clone(),
            server_name: Some("typescript-language-server".into()),
            server_version: Some("5.1.3".into()),
            capabilities_sha256: "b".repeat(64),
            executable_sha256: "c".repeat(64),
            arguments_sha256: "d".repeat(64),
            process_id: 42,
        };
        let toolchain = AuthorizedToolchain {
            node_executable: "/tools/node".into(),
            language_server_package_root: "/tools/typescript-language-server".into(),
            type_script_package_root: "/tools/typescript".into(),
        };
        let request = start_request();
        let result = assemble_start_result(
            &request.language_id,
            &request.workspace_root,
            &request.workspace_id,
            request.workspace_generation,
            &format!("refactorkit-semantic-session-v1:{}", "e".repeat(64)),
            &snapshot_identity,
            &upstream.semantic_lease,
            &upstream.snapshot_hash,
            &request.runtime,
            &request.extensions,
            &toolchain,
            &upstream.completeness,
            &upstream,
        );

        // Adapter contract: startSnapshotHash must be a PREFIXED sha256 identity.
        let start_hash = result["startSnapshotHash"].as_str().unwrap();
        assert!(
            start_hash
                .strip_prefix("sha256:")
                .is_some_and(sha256_digest),
            "startSnapshotHash must be sha256:<64hex>, got: {start_hash}"
        );
        assert!(result.get("providerProjectSnapshotIdentity").is_some());
        assert_eq!(
            result["providerProjectSnapshotIdentity"].as_str().unwrap(),
            snapshot_identity
        );
        // Prefixed startSnapshotHash must equal the prefixed providerProjectSnapshotIdentity.
        assert_eq!(start_hash, snapshot_identity);
    }

    #[test]
    fn v062_runtime_is_exact_not_merely_bounded() {
        let mut value = runtime();
        assert!(runtime_request_is_v062(&value));
        value.limits.max_output_bytes -= 1;
        assert!(!runtime_request_is_v062(&value));
    }

    #[test]
    fn search_strips_locations_only_after_strict_upstream_validation() {
        let root = temp_root("search");
        fs::write(root.join("src/service.ts"), "export class Service {}\n").unwrap();
        let id = format!("lsp-symbol-v1:{}", "a".repeat(64));
        let normalized = normalize_symbol_search(
            &json!([{
                "id": id, "name": "Service", "kind": "CLASS",
                "file": "src/service.ts", "line": 1
            }]),
            &root,
        )
        .unwrap();
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].name, "Service");

        let mut malformed = json!([{
            "id": format!("lsp-symbol-v1:{}", "b".repeat(64)),
            "name": "Other", "kind": "CLASS", "file": "src/service.ts", "line": 1
        }]);
        malformed[0]["absolutePath"] = json!("/private/source.ts");
        assert!(normalize_symbol_search(&malformed, &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn definition_requires_matching_opaque_id_metadata_and_utf16_boundary() {
        let root = temp_root("definition");
        fs::write(root.join("src/service.ts"), "😀Service\n").unwrap();
        let id = format!("lsp-symbol-v1:{}", "c".repeat(64));
        let retained = RetainedSymbol {
            name: "Service".into(),
            kind: "CLASS".into(),
        };
        let definition = normalize_definition(
            &json!({
                "id": id, "name": "Service", "kind": "CLASS",
                "file": "src/service.ts", "line": 1, "character": 2
            }),
            &root,
            &id,
            &retained,
        )
        .unwrap();
        assert_eq!(definition.one_based_line, 1);
        assert_eq!(definition.character, 2);

        let split_surrogate = json!({
            "id": id, "name": "Service", "kind": "CLASS",
            "file": "src/service.ts", "line": 1, "character": 1
        });
        assert!(normalize_definition(&split_surrogate, &root, &id, &retained).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn definition_rejects_missing_non_file_and_symlink_escape() {
        let root = temp_root("path");
        let outside = temp_root("outside").join("outside.ts");
        fs::write(&outside, "class Outside {}\n").unwrap();
        fs::create_dir(root.join("src/directory.ts")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("src/linked.ts")).unwrap();
        for path in ["src/missing.ts", "src/directory.ts", "src/linked.ts"] {
            assert!(authorize_workspace_file(&root, path, "symbol-definition").is_err());
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside.parent().unwrap()).unwrap();
    }

    #[test]
    fn definition_authority_is_bound_to_current_retained_search() {
        let id = format!("lsp-symbol-v1:{}", "d".repeat(64));
        let request = ResolveSavedSnapshotDefinitionRequest {
            language_id: "typescript".into(),
            symbol_id: id.clone(),
            workspace_id: "workspace".into(),
            workspace_generation: 3,
            session_id: format!("refactorkit-semantic-session-v1:{}", "e".repeat(64)),
            semantic_lease: "semantic-00000000-0000-4000-8000-000000000001".into(),
            snapshot_identity: format!("sha256:{}", "f".repeat(64)),
            provider_version: PROVIDER_VERSION.into(),
            backend: BACKEND.into(),
        };
        let search = RetainedSearch {
            language_id: request.language_id.clone(),
            query: "Service".into(),
            workspace_id: request.workspace_id.clone(),
            workspace_generation: request.workspace_generation,
            session_id: request.session_id.clone(),
            semantic_lease: request.semantic_lease.clone(),
            snapshot_identity: request.snapshot_identity.clone(),
            provider_version: request.provider_version.clone(),
            backend: request.backend.clone(),
            symbols: HashMap::from([(
                id,
                RetainedSymbol {
                    name: "Service".into(),
                    kind: "CLASS".into(),
                },
            )]),
        };
        assert!(definition_search_matches(&request, &search));
        let mut stale = request;
        stale.workspace_generation += 1;
        assert!(!definition_search_matches(&stale, &search));
    }

    #[test]
    fn project_open_retains_only_a_qualified_sha256_snapshot() {
        let root = temp_root("project-open");
        let result = normalize_project_open(
            &json!({
                "root": root, "fileCount": 1, "moduleCount": 1,
                "snapshotHash": "a".repeat(64),
                "indexGeneration": 1, "indexedSourceCount": 1,
                "indexedSymbolCount": 1, "watcherState": "idle"
            }),
            &root,
        )
        .unwrap();
        assert_eq!(result, format!("sha256:{}", "a".repeat(64)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn provider_source_fingerprint_is_exact_git_tree_object_identity() {
        let root = temp_root("provider-tree-identity");
        fs::write(root.join("src/provider.txt"), "committed provider bytes\n").unwrap();
        for arguments in [
            vec!["init", "--quiet"],
            vec!["add", "src/provider.txt"],
            vec![
                "-c",
                "user.name=Fingerprint Test",
                "-c",
                "user.email=fingerprint@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ],
        ] {
            let status = std::process::Command::new("git")
                .args(arguments)
                .current_dir(&root)
                .status()
                .unwrap();
            assert!(status.success());
        }
        let git_text = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .args(arguments)
                .current_dir(&root)
                .output()
                .unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout).unwrap().trim().to_string()
        };
        let commit = git_text(&["rev-parse", "HEAD"]);
        let independently_resolved = git_text(&["rev-parse", "HEAD^{tree}"]);
        assert_eq!(
            provider_source_tree_identity_at(&root, &commit).as_deref(),
            Some(independently_resolved.as_str())
        );
        assert_eq!(
            PROVIDER_SOURCE_FINGERPRINT_ALGORITHM,
            "git-tree-oid-sha1-v1"
        );

        // The contract identifies the committed tree, so later dirty bytes cannot change it.
        fs::write(root.join("src/provider.txt"), "dirty provider bytes\n").unwrap();
        assert_eq!(
            provider_source_tree_identity_at(&root, &commit).as_deref(),
            Some(independently_resolved.as_str())
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn build_layout_verification_requires_expected_gradle_install_path() {
        // Build-to-source layout (RQR-TS002-PROVENANCE-002): a daemon binary that is merely
        // co-located in the source tree but NOT at the expected
        // modules/refactorkit-daemon/build/install/<app>/bin/refactorkit-daemon layout must NOT be
        // accepted as a build artifact of the hashed source tree.
        let root = temp_root("build-layout");
        env::set_var("IDE_REFORKIT_SOURCE_ROOT", root.to_str().unwrap());
        let bin_dir = root.join("modules/refactorkit-daemon/build/install/refactorkit-daemon/bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let launcher = bin_dir.join("refactorkit-daemon");
        fs::write(&launcher, "#!/bin/sh\n").unwrap();
        env::set_var("IDE_REFORKIT_DAEMON", launcher.to_str().unwrap());
        assert!(
            daemon_binary_build_layout_verified(),
            "expected Gradle install layout must verify as a build artifact"
        );

        // Contained in the source tree but NOT the expected build layout: rejected.
        let stray = root.join("modules/refactorkit-daemon/build/scripts/refactorkit-daemon");
        fs::create_dir_all(stray.parent().unwrap()).unwrap();
        fs::write(&stray, "#!/bin/sh\n").unwrap();
        env::set_var("IDE_REFORKIT_DAEMON", stray.to_str().unwrap());
        assert!(
            !daemon_binary_build_layout_verified(),
            "non-install-layout path must not verify as a build artifact"
        );

        // Missing trailing launcher component: rejected.
        let partial = bin_dir.join("other-daemon");
        fs::write(&partial, "#!/bin/sh\n").unwrap();
        env::set_var("IDE_REFORKIT_DAEMON", partial.to_str().unwrap());
        assert!(!daemon_binary_build_layout_verified());

        // Outside the source tree entirely: rejected.
        let outside_root = temp_root("outside-layout");
        let outside = outside_root.join(
            "modules/refactorkit-daemon/build/install/refactorkit-daemon/bin/refactorkit-daemon",
        );
        fs::create_dir_all(outside.parent().unwrap()).unwrap();
        fs::write(&outside, "#!/bin/sh\n").unwrap();
        env::set_var("IDE_REFORKIT_DAEMON", outside.to_str().unwrap());
        assert!(!daemon_binary_build_layout_verified());

        env::remove_var("IDE_REFORKIT_DAEMON");
        env::remove_var("IDE_REFORKIT_SOURCE_ROOT");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside_root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "requires a create-new clean-build attestation, its exact RefactorKit 0.7.0-SNAPSHOT daemon, and an explicit external TypeScript toolchain"]
    fn packaged_v070_saved_snapshot_start_search_definition_stop_smoke() {
        let daemon = fs::canonicalize(env::var("IDE_REFORKIT_DAEMON").unwrap()).unwrap();
        let real_node = fs::canonicalize(env::var("IDE_REFORKIT_NODE").unwrap()).unwrap();
        let language_server =
            fs::canonicalize(env::var("IDE_REFORKIT_LANGUAGE_SERVER_ROOT").unwrap()).unwrap();
        let typescript =
            fs::canonicalize(env::var("IDE_REFORKIT_TYPESCRIPT_ROOT").unwrap()).unwrap();
        let source_root = fs::canonicalize(env::var("IDE_REFORKIT_SOURCE_ROOT").unwrap()).unwrap();
        let source_commit = env::var("IDE_REFORKIT_SOURCE_COMMIT").unwrap();
        let source_tree_hash = provider_source_tree_identity_at(&source_root, &source_commit)
            .expect("provider commit must resolve to an exact Git tree object");
        let build_attestation = validate_build_attestation(
            Path::new(&env::var("IDE_REFORKIT_BUILD_ATTESTATION").unwrap()),
            &source_root,
            &source_commit,
            &source_tree_hash,
            &daemon,
        )
        .unwrap();
        let prior_path = env::var_os("PATH");
        let prior_java_home = env::var_os("JAVA_HOME");
        env::set_var("JAVA_HOME", &build_attestation.java_home);

        let root = temp_root("packaged-v070");
        fs::write(
            root.join("tsconfig.json"),
            r#"{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}"#,
        )
        .unwrap();
        fs::write(root.join("src/service.ts"), "export class Service {}\n").unwrap();
        // PROJECT-SCRIPT CANARY (RQR-TS002-002): a package.json carrying a `scripts` field whose
        // canary script would write CANARY_RAN if the daemon ever executed a project script. It is
        // created BEFORE the baseline fingerprint so it is part of the audited byte-tree. If a
        // project script runs, CANARY_RAN appears as a non-directory file and the per-boundary tree
        // fingerprints catch it; we additionally assert the marker file does NOT exist after stop.
        fs::write(
            root.join("package.json"),
            r#"{"scripts":{"canary":"node -e \"require('fs').writeFileSync('CANARY_RAN','yes')\""}}"#,
        )
        .unwrap();
        crate::workspace::set_workspace_root_override(root.clone()).unwrap();
        let node_audit =
            create_node_audit_controls(&real_node, &language_server, &typescript, &root);
        let node = node_audit.wrapper.clone();
        env::set_var("IDE_NODE_AUDIT_TRACE", &node_audit.trace);
        env::set_var("IDE_NODE_AUDIT_LANGUAGE_SERVER_ROOT", &language_server);
        env::set_var("IDE_NODE_AUDIT_TYPESCRIPT_ROOT", &typescript);
        env::set_var("IDE_NODE_AUDIT_WORKSPACE_ROOT", &root);
        let guarded_path = format!(
            "{}:{}",
            node_audit.guard_path.display(),
            prior_path.as_deref().unwrap_or_default().to_string_lossy()
        );
        env::set_var("PATH", guarded_path);
        env::set_var("IDE_REFORKIT_DAEMON", &daemon);

        // Byte-tree audit: snapshot every non-directory workspace file path + content sha256 before
        // project.open and at each operation boundary through semantic.stop. The audit proves the
        // workspace file byte-tree (non-directory path + content) is unchanged at the sampled
        // boundaries; it does NOT detect metadata-only, empty-directory-only, or transient
        // create/delete changes. Prove the .refactorkit/workspace.lock path NEVER exists before AND
        // after project.open.
        assert!(
            !root.join(".refactorkit/workspace.lock").exists(),
            "workspace.lock must never be created by a read-only semantic session (pre-open)"
        );
        let before_tree_fingerprint = tree_fingerprint(&root);
        let audit_command = "packaged_v070_saved_snapshot_start_search_definition_stop_smoke";
        // Drain any checkpoints left by prior runs so this run's open/start boundaries are isolated.
        let _ = take_checkpoints();

        let workspace_id = workspace_id_for_path(&root);
        let state = SavedSnapshotSemanticState::default();
        let started = start(
            StartSavedSnapshotSemanticSessionRequest {
                language_id: "typescript".into(),
                workspace_root: root.to_str().unwrap().into(),
                workspace_id: workspace_id.clone(),
                workspace_generation: 1,
                provider: PROVIDER.into(),
                provider_version: PROVIDER_VERSION.into(),
                backend: BACKEND.into(),
                runtime: runtime(),
                extensions: vec!["ts".into(), "tsx".into()],
                toolchain: ExternalToolchainRequest {
                    node_executable: node.to_str().unwrap().into(),
                    language_server_package_root: language_server.to_str().unwrap().into(),
                    type_script_package_root: typescript.to_str().unwrap().into(),
                    allow_path_node_discovery: false,
                    allow_workspace_local_toolchain: false,
                },
                accepted_semantic_completeness: vec!["full-typescript".into()],
            },
            &state,
        )
        .unwrap();
        let session_id = started["sessionId"].as_str().unwrap().to_string();
        let snapshot_identity = started["providerProjectSnapshotIdentity"]
            .as_str()
            .unwrap()
            .to_string();
        let semantic_lease = started["semanticLease"].as_str().unwrap().to_string();
        let start_snapshot_hash = started["startSnapshotHash"].as_str().unwrap().to_string();
        assert!(session_id
            .strip_prefix("refactorkit-semantic-session-v1:")
            .is_some_and(sha256_digest));
        assert!(valid_semantic_lease(&semantic_lease));
        // The Tauri adapter requires startSnapshotHash to be a PREFIXED sha256 identity
        // (sha256:<64hex>) matching validSha256Identity, so it must equal the prefixed
        // providerProjectSnapshotIdentity rather than the bare digest.
        assert!(start_snapshot_hash
            .strip_prefix("sha256:")
            .is_some_and(sha256_digest));
        assert_eq!(start_snapshot_hash, snapshot_identity);
        assert_eq!(started["semanticCompleteness"], "full-typescript");
        assert!(started.get("compilerAttestation").is_none());

        // Assert the internal operation boundaries recorded by production (after project.open,
        // after semantic.start) each equal the baseline tree fingerprint. This proves no write
        // persists through any start-phase boundary.
        let open_start_checkpoints = take_checkpoints();
        assert!(
            open_start_checkpoints.len() == 2,
            "start() must record after-project-open and after-semantic-start checkpoints, got: {:?}",
            open_start_checkpoints
        );
        for (label, checkpoint_fingerprint) in &open_start_checkpoints {
            assert_eq!(
                checkpoint_fingerprint,
                &before_tree_fingerprint,
                "checkpoint {label} must equal baseline: {label} {checkpoint_fingerprint} vs baseline {before_tree_fingerprint}"
            );
        }

        let searched = search(
            SearchSavedSnapshotSymbolsRequest {
                language_id: "typescript".into(),
                query: "Service".into(),
                workspace_id: workspace_id.clone(),
                workspace_generation: 1,
                session_id: session_id.clone(),
                semantic_lease: semantic_lease.clone(),
                snapshot_identity: snapshot_identity.clone(),
                provider_version: PROVIDER_VERSION.into(),
                backend: BACKEND.into(),
                toolchain: ExternalToolchainRequest {
                    node_executable: node.to_str().unwrap().into(),
                    language_server_package_root: language_server.to_str().unwrap().into(),
                    type_script_package_root: typescript.to_str().unwrap().into(),
                    allow_path_node_discovery: false,
                    allow_workspace_local_toolchain: false,
                },
            },
            &state,
        )
        .unwrap();
        let symbol = searched["symbols"]
            .as_array()
            .unwrap()
            .iter()
            .find(|symbol| symbol["name"] == "Service")
            .unwrap();
        let symbol_id = symbol["id"].as_str().unwrap().to_string();
        // Checkpoint after symbol.search: the workspace tree must still equal baseline.
        let search_fingerprint = tree_fingerprint(&root);
        assert_eq!(
            search_fingerprint, before_tree_fingerprint,
            "after symbol.search the workspace byte tree must equal baseline"
        );

        let definition = resolve_definition(
            ResolveSavedSnapshotDefinitionRequest {
                language_id: "typescript".into(),
                symbol_id,
                workspace_id: workspace_id.clone(),
                workspace_generation: 1,
                session_id: session_id.clone(),
                semantic_lease: semantic_lease.clone(),
                snapshot_identity,
                provider_version: PROVIDER_VERSION.into(),
                backend: BACKEND.into(),
            },
            &state,
        )
        .unwrap();
        assert_eq!(definition["file"], "src/service.ts");
        assert_eq!(definition["point"], json!({"line": 0, "character": 13}));
        // Checkpoint after symbol.definition: the workspace tree must still equal baseline.
        let definition_fingerprint = tree_fingerprint(&root);
        assert_eq!(
            definition_fingerprint, before_tree_fingerprint,
            "after symbol.definition the workspace byte tree must equal baseline"
        );

        let stopped = stop(
            StopSavedSnapshotSemanticSessionRequest {
                language_id: "typescript".into(),
                workspace_id,
                workspace_generation: 1,
                session_id,
            },
            &state,
        )
        .unwrap();
        assert_eq!(stopped["stopped"], true);

        // PROJECT-SCRIPT CANARY (RQR-TS002-002): no project script may execute. The canary script
        // would create CANARY_RAN in the workspace root; assert it does NOT exist after the full
        // flow + stop. (If it were created, it would also be a non-directory file and the tree
        // fingerprints below would already fail trees_equal.)
        assert!(
            !root.join("CANARY_RAN").exists(),
            "project scripts must never execute; canary marker must not exist"
        );
        let (node_process_trace_sha256, node_process_trace_summary) =
            validate_node_process_trace(&node_audit, &language_server, &typescript);

        // Final checkpoint after semantic.stop: the workspace tree must still equal baseline. The
        // five per-boundary checkpoints (after project.open, semantic.start, symbol.search,
        // symbol.definition, semantic.stop) prove the workspace file byte-tree (non-directory path +
        // content) is unchanged at each sampled operation boundary. This does NOT claim detection of
        // metadata-only, empty-directory-only, or transient create/delete changes.
        let after_tree_fingerprint = tree_fingerprint(&root);
        let trees_equal = before_tree_fingerprint == after_tree_fingerprint;

        let daemon_binary_sha256 = hex_lower(&Sha256::digest(&fs::read(&daemon).unwrap()));
        // Exact committed source identity: `sourceTreeHash` is the provider commit's Git tree
        // object ID and is always paired with an explicit algorithm/version. The independent unit
        // test compares this implementation to `git rev-parse HEAD^{tree}` and dirties the fixture
        // afterward to prove working-tree bytes cannot affect the result.
        assert_eq!(provider_source_tree_hash(), source_tree_hash);
        let source_git_head = provider_source_git_head();
        let source_git_clean = provider_source_git_clean();
        let daemon_inside = daemon_binary_inside_source_tree();
        let build_layout_verified = daemon_binary_build_layout_verified();
        assert_eq!(
            source_git_head, source_commit,
            "clean-build source HEAD must be exact"
        );
        assert!(
            source_git_clean,
            "final audit refuses dirty provider source"
        );
        assert!(daemon_inside && build_layout_verified);
        let audit_test_executable = fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
        let audit_test_executable_sha256 =
            hex_lower(&Sha256::digest(&fs::read(&audit_test_executable).unwrap()));
        let audit_rust_source = Path::new(file!());
        let audit_rust_source = if audit_rust_source.is_absolute() {
            audit_rust_source.to_path_buf()
        } else {
            Path::new(env!("CARGO_MANIFEST_DIR")).join(audit_rust_source)
        };
        let audit_rust_source = fs::canonicalize(audit_rust_source).unwrap();
        let audit_rust_source_sha256 =
            hex_lower(&Sha256::digest(&fs::read(&audit_rust_source).unwrap()));
        let build_attestation_script = fs::canonicalize(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("scripts/build-refactorkit-daemon-attested.sh"),
        )
        .unwrap();
        let build_attestation_script_sha256 = hex_lower(&Sha256::digest(
            &fs::read(&build_attestation_script).unwrap(),
        ));
        let node_audit_preload = fs::canonicalize(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/node-process-audit-preload.cjs"),
        )
        .unwrap();
        let node_audit_preload_sha256 =
            hex_lower(&Sha256::digest(&fs::read(&node_audit_preload).unwrap()));
        let ide_repository = git2::Repository::discover(env!("CARGO_MANIFEST_DIR")).unwrap();
        let ide_repository_root = ide_repository.workdir().unwrap();
        let ide_source_git_clean = std::process::Command::new("git")
            .arg("-C")
            .arg(ide_repository_root)
            .args(["status", "--porcelain=v1", "--untracked-files=all"])
            .output()
            .map(|output| output.status.success() && output.stdout.is_empty())
            .unwrap_or(false);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // IDE revision: the IDE repository HEAD at audit time (independent of the provider commit).
        let ide_revision = ide_revision();
        let mut checkpoint_list: Vec<(String, String)> = open_start_checkpoints;
        checkpoint_list.push(("after-symbol-search".to_string(), search_fingerprint));
        checkpoint_list.push((
            "after-symbol-definition".to_string(),
            definition_fingerprint,
        ));
        checkpoint_list.push((
            "after-semantic-stop".to_string(),
            after_tree_fingerprint.clone(),
        ));
        let checkpoint_fingerprints = checkpoint_list
            .into_iter()
            .map(|(label, fingerprint)| json!({"label": label, "fingerprint": fingerprint}))
            .collect::<Vec<_>>();

        let receipt = serde_json::to_string_pretty(&json!({
            "receiptSchemaVersion": "refactorkit-saved-snapshot-audit-v2",
            "auditHarness": {
                "auditCommand": audit_command,
                "testExecutablePath": audit_test_executable,
                "testExecutableSha256": audit_test_executable_sha256,
                "rustSourcePath": audit_rust_source,
                "rustSourceSha256": audit_rust_source_sha256,
                "buildAttestationScriptPath": build_attestation_script,
                "buildAttestationScriptSha256": build_attestation_script_sha256,
                "nodeAuditPreloadPath": node_audit_preload,
                "nodeAuditPreloadSha256": node_audit_preload_sha256,
                "ideRevision": ide_revision,
                "ideSourceGitClean": ide_source_git_clean
            },
            "providerBuild": {
                "daemonBinarySha256": daemon_binary_sha256,
                "sourceCommit": source_commit,
                "sourceTreeHash": source_tree_hash,
                "sourceTreeFingerprintAlgorithm": PROVIDER_SOURCE_FINGERPRINT_ALGORITHM,
                "sourceTreeGitObjectType": "tree",
                "sourceGitHead": source_git_head,
                "sourceGitClean": source_git_clean,
                "sourceGitDetached": true,
                "daemonBinaryInsideSourceTree": daemon_inside,
                "buildLayoutVerified": build_layout_verified,
                "attestationPath": build_attestation.path,
                "attestationSha256": build_attestation.sha256,
                "buildLogPath": build_attestation.build_log_path,
                "buildLogSha256": build_attestation.build_log_sha256,
                "buildCommand": build_attestation.build_command,
                "javaHome": build_attestation.java_home,
                "javaVersion": build_attestation.java_version,
                "javacVersion": build_attestation.javac_version,
                "gradleVersion": build_attestation.gradle_version,
                "buildStartedEpochSeconds": build_attestation.build_started_epoch_seconds,
                "buildFinishedEpochSeconds": build_attestation.build_finished_epoch_seconds,
                "provenanceScope": "observed-clean-detached-gradle-build-v1; not signed or hermetic"
            },
            "processExecution": {
                "controlledNodeWrapperPath": node_audit.wrapper,
                "controlledRealNodePath": node_audit.real_node,
                "suppliedLanguageServerPackageRoot": language_server,
                "suppliedTypeScriptPackageRoot": typescript,
                "tracePath": node_audit.trace,
                "traceSha256": node_process_trace_sha256,
                "traceSummary": node_process_trace_summary,
                "packageScriptCanaryMarkerAbsent": !root.join("CANARY_RAN").exists(),
                "scope": "controlled Node preload plus inherited child-process hooks and PATH package-manager guards; not system-call complete"
            },
            "workspaceAudit": {
                "checkpoints": checkpoint_fingerprints,
                "baselineTreeFingerprint": before_tree_fingerprint,
                "afterTreeFingerprint": after_tree_fingerprint,
                "treesEqual": trees_equal,
                "scope": "sampled non-directory path/content bytes; excludes metadata, empty directories, and transient between-checkpoint writes"
            },
            "timestamp": timestamp
        }))
        .unwrap();
        // Durable receipt persisted OUTSIDE the audited workspace (temp_root is deleted with
        // remove_dir_all below), under a fixed crate-level target path, so the artifact survives the
        // audit. A write-exclusive create-new guard refuses any accidental overwrite of an already
        // existing receipt (overwrite is never silently accepted).
        let receipt_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/rk-semantic-receipts");
        fs::create_dir_all(&receipt_dir).unwrap();
        let receipt_name = format!("receipt-{before_tree_fingerprint}-{timestamp}.json");
        let receipt_path = receipt_dir.join(&receipt_name);
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&receipt_path)
            .unwrap_or_else(|error| {
                panic!(
                    "durable receipt write must be create-new (no silent overwrite); {}: {}",
                    receipt_path.display(),
                    error
                )
            });
        file.write_all(format!("{receipt}\n").as_bytes()).unwrap();
        println!("{receipt}");
        assert!(
            trees_equal,
            "read-only symbol search/definition must not mutate the workspace byte tree:\n{receipt}"
        );
        assert!(
            !root.join(".refactorkit/workspace.lock").exists(),
            "read-only symbol ops must not create a .refactorkit/workspace.lock:\n{receipt}"
        );
        assert!(
            receipt_path.is_file()
                && receipt_path.file_name().is_some_and(|name| {
                    name.to_string_lossy() == receipt_name.as_str()
                }),
            "durable receipt must exist under the crate target dir with the expected fingerprint: {}",
            receipt_path.display()
        );

        env::remove_var("IDE_REFORKIT_DAEMON");
        env::remove_var("IDE_NODE_AUDIT_TRACE");
        env::remove_var("IDE_NODE_AUDIT_LANGUAGE_SERVER_ROOT");
        env::remove_var("IDE_NODE_AUDIT_TYPESCRIPT_ROOT");
        env::remove_var("IDE_NODE_AUDIT_WORKSPACE_ROOT");
        match prior_path {
            Some(value) => env::set_var("PATH", value),
            None => env::remove_var("PATH"),
        }
        match prior_java_home {
            Some(value) => env::set_var("JAVA_HOME", value),
            None => env::remove_var("JAVA_HOME"),
        }
        assert!(
            node_audit.root.is_dir(),
            "process trace controls must remain durable"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
