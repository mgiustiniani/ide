//! Strict diagnostics.v2 bridge over the retained saved-snapshot semantic session.
//!
//! This module never discovers a daemon or toolchain. It authorizes one request against the
//! authority retained by `SavedSnapshotSemanticState`, delegates to that exact daemon session,
//! validates the provider envelope, and emits the schema-v2 IDE correlation fields.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::saved_snapshot_semantic::{
    diagnostics_authorize_current_workspace, diagnostics_call_active, diagnostics_ensure_live,
    diagnostics_lock, diagnostics_reset, AuthorizedToolchain, SavedSnapshotSemanticState,
    SemanticAuthority,
};

const SCHEMA_VERSION: u8 = 2;
const OPERATION: &str = "diagnostics.v2";
const LANGUAGE_ID: &str = "typescript";
const PROVIDER_NAME: &str = "RefactorKit";
const PROVIDER_WIRE_NAME: &str = "refactorkit";
const PROVIDER_VERSION: &str = "0.7.0-SNAPSHOT";
const API_VERSION: &str = "0.2";
const BACKEND: &str = "typescript-compiler-exact-v1";
const TOOLCHAIN_PROVIDER: &str = "typescript-lsp-explicit-v1";
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_IDENTITY_BYTES: usize = 512;
const MAX_PATH_BYTES: usize = 4096;
const MAX_OVERLAY_DOCUMENTS: usize = 128;
const MAX_OVERLAY_BYTES: usize = 768 * 1024;
const MAX_PACKAGE_JSON_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT_MILLIS: u64 = 30_000;
const MAX_INPUT_BYTES: u64 = 536_870_912;
const MAX_OUTPUT_BYTES: u64 = 8_388_608;
const MAX_PROCESSES: u64 = 1;
const MAX_STDERR_BYTES: u64 = 65_536;
const COMPILER_HEAP_MIB: u64 = 512;
const MAX_DIAGNOSTICS: usize = 500;
const MAX_DIAGNOSTIC_MESSAGE_CHARS: usize = 4_096;
const MAX_RESPONSE_BYTES: usize = 2_097_152;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeScriptDiagnosticsError {
    code: &'static str,
    stage: &'static str,
    message: &'static str,
}

impl TypeScriptDiagnosticsError {
    fn request(stage: &'static str) -> Self {
        Self {
            code: "REFACTORKIT_TYPESCRIPT_DIAGNOSTICS_REQUEST_REJECTED",
            stage,
            message: "The RefactorKit TypeScript diagnostics request was rejected.",
        }
    }

    fn response(stage: &'static str) -> Self {
        Self {
            code: "REFACTORKIT_TYPESCRIPT_DIAGNOSTICS_RESPONSE_REJECTED",
            stage,
            message: "RefactorKit returned invalid TypeScript diagnostics evidence.",
        }
    }

    fn transport(stage: &'static str) -> Self {
        Self {
            code: "REFACTORKIT_TYPESCRIPT_DIAGNOSTICS_FAILED",
            stage,
            message: "The RefactorKit TypeScript diagnostics session ended safely.",
        }
    }
}

type DiagnosticsResult<T> = Result<T, TypeScriptDiagnosticsError>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TypeScriptDiagnosticsRequest {
    schema_version: u8,
    operation: String,
    request_id: String,
    language_id: String,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
    expected_snapshot_hash: String,
    semantic_lease: String,
    source_authority: OverlaySourceAuthorityRequest,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OverlaySourceAuthorityRequest {
    kind: String,
    documents: Vec<OverlayDocumentRequest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OverlayDocumentRequest {
    path: String,
    version: u64,
    content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeScriptDiagnosticsResponse {
    schema_version: u8,
    operation: &'static str,
    request_id: String,
    language_id: &'static str,
    status: DiagnosticsStatus,
    workspace_id: String,
    workspace_generation: u64,
    session_id: String,
    provider: IdeProvider,
    backend: &'static str,
    semantic_lease: String,
    project_snapshot_hash: String,
    provider_snapshot_hash: String,
    source_authority: OverlaySourceAuthorityResponse,
    range_encoding: &'static str,
    range_capability: &'static str,
    runtime: DiagnosticsRuntime,
    compiler_attestation: Option<CompilerAttestation>,
    failure: Option<DiagnosticsFailure>,
    diagnostics: Vec<CompilerDiagnostic>,
    diagnostics_total: usize,
    diagnostics_returned: usize,
    truncated: bool,
    response_bytes: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum DiagnosticsStatus {
    Ready,
    Refused,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderIdentity {
    name: String,
    version: String,
    api_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdeProvider {
    name: &'static str,
    version: &'static str,
    api_version: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticsRuntime {
    execution_mode: String,
    supports_timeout: bool,
    supports_cancellation: bool,
    uses_workspace_overlay: bool,
    records_process_provenance: bool,
    limits: DiagnosticsRuntimeLimits,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticsRuntimeLimits {
    request_timeout_millis: u64,
    max_input_bytes: u64,
    max_output_bytes: u64,
    max_stderr_bytes: u64,
    max_processes: u64,
    compiler_heap_mi_b: u64,
    max_diagnostics: u64,
    max_diagnostic_message_chars: u64,
    max_response_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerAttestation {
    toolchain_provider: String,
    node_version: String,
    type_script_version: String,
    compiler_sha256: String,
    toolchain_evidence_sha256: String,
    #[serde(deserialize_with = "required_nullable")]
    process: Option<CompilerProcessIdentity>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompilerProcessIdentity {
    executable_sha256: String,
    arguments_sha256: String,
    process_id: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticsFailure {
    code: String,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderOverlaySourceAuthorityResponse {
    kind: String,
    base_snapshot_hash: String,
    overlay_hash: String,
    provider_snapshot_hash: String,
    documents: Vec<OverlayDocumentResponse>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlaySourceAuthorityResponse {
    kind: &'static str,
    base_snapshot_hash: String,
    overlay_hash: String,
    provider_snapshot_hash: String,
    documents: Vec<OverlayDocumentResponse>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OverlayDocumentResponse {
    path: String,
    version: u64,
    content_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderDiagnostic {
    severity: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    evidence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    location: ProviderDiagnosticLocation,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum ProviderDiagnosticLocation {
    Range {
        path: String,
        encoding: String,
        range: DiagnosticRange,
    },
    Line {
        path: String,
        line: u64,
    },
    None,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompilerDiagnostic {
    severity: String,
    message: String,
    code: String,
    evidence: &'static str,
    category: String,
    location: CompilerDiagnosticLocation,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompilerDiagnosticLocation {
    kind: &'static str,
    path: String,
    encoding: &'static str,
    range: DiagnosticRange,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticRange {
    start: DiagnosticPoint,
    end: DiagnosticPoint,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticPoint {
    line: u64,
    character: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderDiagnosticsResponse {
    schema_version: u8,
    request_id: String,
    language_id: String,
    status: DiagnosticsStatus,
    provider: ProviderIdentity,
    backend: String,
    #[serde(deserialize_with = "required_nullable")]
    semantic_lease: Option<String>,
    project_snapshot_hash: String,
    provider_snapshot_hash: String,
    source_authority: ProviderOverlaySourceAuthorityResponse,
    range_encoding: String,
    range_capability: String,
    runtime: DiagnosticsRuntime,
    #[serde(deserialize_with = "required_nullable")]
    compiler_attestation: Option<CompilerAttestation>,
    #[serde(deserialize_with = "required_nullable")]
    failure: Option<DiagnosticsFailure>,
    diagnostics: Vec<ProviderDiagnostic>,
    diagnostics_total: usize,
    diagnostics_returned: usize,
    truncated: bool,
    response_bytes: usize,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub fn run_saved_snapshot_diagnostics(
    request: TypeScriptDiagnosticsRequest,
    state: &SavedSnapshotSemanticState,
) -> DiagnosticsResult<TypeScriptDiagnosticsResponse> {
    validate_request(&request)?;

    let mut manager = diagnostics_lock(state, "diagnostics-authority")
        .map_err(|_| TypeScriptDiagnosticsError::request("diagnostics-authority"))?;
    diagnostics_ensure_live(&mut manager, "diagnostics-authority")
        .map_err(|_| TypeScriptDiagnosticsError::request("diagnostics-authority"))?;
    let authority = manager
        .authority
        .as_ref()
        .cloned()
        .ok_or_else(|| TypeScriptDiagnosticsError::request("diagnostics-authority"))?;
    diagnostics_authorize_current_workspace(&authority, "diagnostics-authority")
        .map_err(|_| TypeScriptDiagnosticsError::request("diagnostics-authority"))?;
    authorize_request(&request, &authority)?;
    validate_overlay_files(&request, &authority.workspace_root)?;

    let params = json!({
        "requestId": request.request_id,
        "languageId": request.language_id,
        "expectedSnapshotHash": request.expected_snapshot_hash,
        "semanticLease": request.semantic_lease,
        "sourceAuthority": {
            "kind": request.source_authority.kind,
            "documents": request.source_authority.documents.iter().map(|document| json!({
                "path": document.path,
                "version": document.version,
                "content": document.content
            })).collect::<Vec<_>>()
        }
    });
    let raw = match diagnostics_call_active(
        &mut manager,
        OPERATION,
        params,
        "REFACTORKIT_TYPESCRIPT_DIAGNOSTICS_FAILED",
        "diagnostics-delegate",
    ) {
        Ok(raw) => raw,
        Err(_) => {
            return Err(TypeScriptDiagnosticsError::transport(
                "diagnostics-delegate",
            ))
        }
    };

    match normalize_response(raw, &request, &authority.toolchain) {
        Ok(response) => Ok(response),
        Err(error) => {
            diagnostics_reset(&mut manager);
            Err(error)
        }
    }
}

fn validate_request(request: &TypeScriptDiagnosticsRequest) -> DiagnosticsResult<()> {
    if request.schema_version != SCHEMA_VERSION
        || request.operation != OPERATION
        || request.language_id != LANGUAGE_ID
        || !valid_request_id(&request.request_id)
        || !valid_identity(&request.workspace_id)
        || request.workspace_generation == 0
        || !valid_identity(&request.session_id)
        || !sha256_digest(&request.expected_snapshot_hash)
        || !valid_semantic_lease(&request.semantic_lease)
        || request.source_authority.kind != "immutable-editor-overlay"
        || request.source_authority.documents.is_empty()
        || request.source_authority.documents.len() > MAX_OVERLAY_DOCUMENTS
    {
        return Err(TypeScriptDiagnosticsError::request("diagnostics-extract"));
    }

    let mut paths = HashSet::with_capacity(request.source_authority.documents.len());
    let mut bytes = 0usize;
    for document in &request.source_authority.documents {
        bytes = bytes
            .checked_add(document.content.len())
            .ok_or_else(|| TypeScriptDiagnosticsError::request("diagnostics-extract"))?;
        if bytes > MAX_OVERLAY_BYTES
            || !valid_relative_path(&document.path)
            || !matches!(
                Path::new(&document.path)
                    .extension()
                    .and_then(|value| value.to_str()),
                Some("ts" | "tsx")
            )
            || !paths.insert(document.path.as_str())
        {
            return Err(TypeScriptDiagnosticsError::request("diagnostics-extract"));
        }
    }
    Ok(())
}

fn authorize_request(
    request: &TypeScriptDiagnosticsRequest,
    authority: &SemanticAuthority,
) -> DiagnosticsResult<()> {
    if request.language_id != authority.language_id
        || request.workspace_id != authority.workspace_id
        || request.workspace_generation != authority.workspace_generation
        || request.session_id != authority.session_id
        || request.expected_snapshot_hash != authority.start_snapshot_hash
        || request.semantic_lease != authority.semantic_lease
        || authority.provider_version != PROVIDER_VERSION
        || authority.backend != "typescript-lsp-explicit-v1"
    {
        return Err(TypeScriptDiagnosticsError::request("diagnostics-authority"));
    }
    Ok(())
}

fn validate_overlay_files(
    request: &TypeScriptDiagnosticsRequest,
    root: &Path,
) -> DiagnosticsResult<()> {
    for document in &request.source_authority.documents {
        let candidate = root.join(&document.path);
        let metadata = fs::symlink_metadata(&candidate)
            .map_err(|_| TypeScriptDiagnosticsError::request("diagnostics-source-authority"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(TypeScriptDiagnosticsError::request(
                "diagnostics-source-authority",
            ));
        }
        let parent = candidate
            .parent()
            .and_then(|path| path.canonicalize().ok())
            .ok_or_else(|| TypeScriptDiagnosticsError::request("diagnostics-source-authority"))?;
        if !parent.starts_with(root) {
            return Err(TypeScriptDiagnosticsError::request(
                "diagnostics-source-authority",
            ));
        }
    }
    Ok(())
}

fn normalize_response(
    raw: Value,
    request: &TypeScriptDiagnosticsRequest,
    toolchain: &AuthorizedToolchain,
) -> DiagnosticsResult<TypeScriptDiagnosticsResponse> {
    let provider: ProviderDiagnosticsResponse = serde_json::from_value(raw)
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-response-schema"))?;
    validate_provider_byte_count(&provider)?;

    let semantic_lease = provider
        .semantic_lease
        .as_deref()
        .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-correlation"))?;
    if provider.schema_version != SCHEMA_VERSION
        || provider.request_id != request.request_id
        || provider.language_id != request.language_id
        || provider.provider.name != PROVIDER_NAME
        || provider.provider.version != PROVIDER_VERSION
        || provider.provider.api_version != API_VERSION
        || provider.backend != BACKEND
        || semantic_lease != request.semantic_lease
        || provider.project_snapshot_hash != request.expected_snapshot_hash
        || !sha256_digest(&provider.provider_snapshot_hash)
        || provider.range_encoding != "utf-16"
        || provider.range_capability != "exact-utf16-or-explicit-partial"
        || provider.runtime != expected_runtime()
        || provider.truncated
        || provider.diagnostics_total != provider.diagnostics.len()
        || provider.diagnostics_returned != provider.diagnostics.len()
        || provider.diagnostics.len() > MAX_DIAGNOSTICS
    {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-correlation",
        ));
    }

    let source_authority = normalize_source_authority(
        provider.source_authority,
        &provider.provider_snapshot_hash,
        request,
    )?;
    let diagnostics = normalize_diagnostics(provider.diagnostics, request)?;

    match provider.status {
        DiagnosticsStatus::Ready => {
            if provider.failure.is_some() || provider.compiler_attestation.is_none() {
                return Err(TypeScriptDiagnosticsError::response("diagnostics-status"));
            }
        }
        DiagnosticsStatus::Refused => {
            if provider.failure.is_none()
                || provider.compiler_attestation.is_some()
                || !diagnostics.is_empty()
            {
                return Err(TypeScriptDiagnosticsError::response("diagnostics-status"));
            }
        }
        DiagnosticsStatus::Error => {
            if provider.failure.is_none()
                || provider.compiler_attestation.is_none()
                || !diagnostics.is_empty()
            {
                return Err(TypeScriptDiagnosticsError::response("diagnostics-status"));
            }
        }
    }
    if provider.status != DiagnosticsStatus::Ready && provider.diagnostics_total != 0 {
        return Err(TypeScriptDiagnosticsError::response("diagnostics-status"));
    }
    if let Some(failure) = provider.failure.as_ref() {
        if !valid_metadata(&failure.code) || !valid_message(&failure.message, 4096) {
            return Err(TypeScriptDiagnosticsError::response("diagnostics-failure"));
        }
    }
    if let Some(attestation) = provider.compiler_attestation.as_ref() {
        validate_attestation(attestation, toolchain)?;
    }

    let mut response = TypeScriptDiagnosticsResponse {
        schema_version: SCHEMA_VERSION,
        operation: OPERATION,
        request_id: request.request_id.clone(),
        language_id: LANGUAGE_ID,
        status: provider.status,
        workspace_id: request.workspace_id.clone(),
        workspace_generation: request.workspace_generation,
        session_id: request.session_id.clone(),
        provider: IdeProvider {
            name: PROVIDER_WIRE_NAME,
            version: PROVIDER_VERSION,
            api_version: API_VERSION,
        },
        backend: BACKEND,
        semantic_lease: request.semantic_lease.clone(),
        project_snapshot_hash: request.expected_snapshot_hash.clone(),
        provider_snapshot_hash: provider.provider_snapshot_hash,
        source_authority,
        range_encoding: "utf-16",
        range_capability: "exact-utf16-or-explicit-partial",
        runtime: provider.runtime,
        compiler_attestation: provider.compiler_attestation,
        failure: provider.failure,
        diagnostics,
        diagnostics_total: provider.diagnostics_total,
        diagnostics_returned: provider.diagnostics_returned,
        truncated: false,
        response_bytes: 0,
    };
    set_exact_response_bytes(&mut response)?;
    Ok(response)
}

fn validate_provider_byte_count(provider: &ProviderDiagnosticsResponse) -> DiagnosticsResult<()> {
    if provider.response_bytes == 0 || provider.response_bytes > MAX_RESPONSE_BYTES {
        return Err(TypeScriptDiagnosticsError::response("diagnostics-bounds"));
    }
    let encoded = serde_json::to_vec(provider)
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-response-schema"))?;
    if encoded.len() != provider.response_bytes {
        return Err(TypeScriptDiagnosticsError::response("diagnostics-bounds"));
    }
    Ok(())
}

fn normalize_source_authority(
    provider: ProviderOverlaySourceAuthorityResponse,
    provider_snapshot_hash: &str,
    request: &TypeScriptDiagnosticsRequest,
) -> DiagnosticsResult<OverlaySourceAuthorityResponse> {
    if provider.kind != "immutable-editor-overlay"
        || provider.base_snapshot_hash != request.expected_snapshot_hash
        || provider.provider_snapshot_hash != provider_snapshot_hash
        || !sha256_digest(&provider.overlay_hash)
        || provider.documents.len() != request.source_authority.documents.len()
    {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-source-authority",
        ));
    }

    let by_path: HashMap<_, _> = provider
        .documents
        .into_iter()
        .map(|document| (document.path.clone(), document))
        .collect();
    if by_path.len() != request.source_authority.documents.len() {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-source-authority",
        ));
    }
    let mut documents = Vec::with_capacity(request.source_authority.documents.len());
    for expected in &request.source_authority.documents {
        let actual = by_path
            .get(&expected.path)
            .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-source-authority"))?;
        if actual.version != expected.version
            || !sha256_digest(&actual.content_sha256)
            || actual.content_sha256 != sha256_bytes(expected.content.as_bytes())
        {
            return Err(TypeScriptDiagnosticsError::response(
                "diagnostics-source-authority",
            ));
        }
        documents.push(OverlayDocumentResponse {
            path: actual.path.clone(),
            version: actual.version,
            content_sha256: actual.content_sha256.clone(),
        });
    }

    Ok(OverlaySourceAuthorityResponse {
        kind: "immutable-editor-overlay",
        base_snapshot_hash: provider.base_snapshot_hash,
        overlay_hash: provider.overlay_hash,
        provider_snapshot_hash: provider.provider_snapshot_hash,
        documents,
    })
}

fn normalize_diagnostics(
    diagnostics: Vec<ProviderDiagnostic>,
    request: &TypeScriptDiagnosticsRequest,
) -> DiagnosticsResult<Vec<CompilerDiagnostic>> {
    let documents: HashMap<_, _> = request
        .source_authority
        .documents
        .iter()
        .map(|document| (document.path.as_str(), document.content.as_str()))
        .collect();
    diagnostics
        .into_iter()
        .map(|diagnostic| {
            let severity = match diagnostic.severity.as_str() {
                "error" => "error",
                "warning" => "warning",
                "info" => "information",
                _ => {
                    return Err(TypeScriptDiagnosticsError::response(
                        "diagnostics-diagnostic",
                    ))
                }
            };
            let code = diagnostic
                .code
                .filter(|value| valid_typescript_code(value))
                .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-diagnostic"))?;
            let evidence = diagnostic
                .evidence
                .filter(|value| value == "compiler")
                .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-diagnostic"))?;
            let category = diagnostic
                .category
                .filter(|value| valid_metadata(value))
                .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-diagnostic"))?;
            if evidence != "compiler"
                || !valid_message(&diagnostic.message, MAX_DIAGNOSTIC_MESSAGE_CHARS)
            {
                return Err(TypeScriptDiagnosticsError::response(
                    "diagnostics-diagnostic",
                ));
            }
            let (path, range) = match diagnostic.location {
                ProviderDiagnosticLocation::Range {
                    path,
                    encoding,
                    range,
                } if encoding == "utf-16" => (path, range),
                _ => {
                    return Err(TypeScriptDiagnosticsError::response(
                        "diagnostics-diagnostic",
                    ))
                }
            };
            let content = documents
                .get(path.as_str())
                .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-diagnostic"))?;
            if !valid_range(content, &range) {
                return Err(TypeScriptDiagnosticsError::response(
                    "diagnostics-diagnostic",
                ));
            }
            Ok(CompilerDiagnostic {
                severity: severity.to_string(),
                message: diagnostic.message,
                code,
                evidence: "compiler",
                category,
                location: CompilerDiagnosticLocation {
                    kind: "range",
                    path,
                    encoding: "utf-16",
                    range,
                },
            })
        })
        .collect()
}

fn validate_attestation(
    attestation: &CompilerAttestation,
    toolchain: &AuthorizedToolchain,
) -> DiagnosticsResult<()> {
    let process = attestation
        .process
        .as_ref()
        .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    if attestation.toolchain_provider != TOOLCHAIN_PROVIDER
        || !valid_metadata(&attestation.node_version)
        || !valid_metadata(&attestation.type_script_version)
        || !sha256_digest(&attestation.compiler_sha256)
        || !sha256_digest(&attestation.toolchain_evidence_sha256)
        || !sha256_digest(&process.executable_sha256)
        || !sha256_digest(&process.arguments_sha256)
        || process.process_id == 0
    {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }

    let evidence = load_toolchain_evidence(toolchain, &attestation.node_version)?;
    if attestation.type_script_version != evidence.type_script_version
        || attestation.compiler_sha256 != evidence.compiler_sha256
        || attestation.toolchain_evidence_sha256 != evidence.toolchain_evidence_sha256
        || process.executable_sha256 != evidence.node_executable_sha256
    {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }
    Ok(())
}

struct ToolchainEvidence {
    type_script_version: String,
    compiler_sha256: String,
    toolchain_evidence_sha256: String,
    node_executable_sha256: String,
}

fn load_toolchain_evidence(
    toolchain: &AuthorizedToolchain,
    node_version: &str,
) -> DiagnosticsResult<ToolchainEvidence> {
    let node = canonical_regular_file(&toolchain.node_executable)?;
    let language_root = canonical_directory(&toolchain.language_server_package_root)?;
    let type_script_root = canonical_directory(&toolchain.type_script_package_root)?;
    let language_manifest = canonical_regular_file(language_root.join("package.json"))?;
    let type_script_manifest = canonical_regular_file(type_script_root.join("package.json"))?;
    let language_package = read_package(&language_manifest, "typescript-language-server")?;
    let type_script_package = read_package(&type_script_manifest, "typescript")?;
    let language_entrypoint = canonical_regular_file(language_root.join(language_package.bin))?;
    let server_entrypoint = canonical_regular_file(type_script_root.join("lib/tsserver.js"))?;
    let compiler_entrypoint = canonical_regular_file(type_script_root.join("lib/typescript.js"))?;

    let mut files = vec![
        file_evidence("node-executable", node.clone())?,
        file_evidence("language-server-package", language_manifest)?,
        file_evidence("language-server-entrypoint", language_entrypoint)?,
        file_evidence("typescript-package", type_script_manifest)?,
        file_evidence("typescript-server-entrypoint", server_entrypoint)?,
        file_evidence("typescript-compiler-entrypoint", compiler_entrypoint)?,
    ];
    files.sort_unstable_by(|left, right| left.role.cmp(right.role));

    let mut digest = Sha256::new();
    for value in [
        TOOLCHAIN_PROVIDER,
        node_version,
        language_package.version.as_str(),
        type_script_package.version.as_str(),
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    for file in &files {
        for value in [
            file.role,
            file.path
                .to_str()
                .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?,
            file.sha256.as_str(),
            file.size.to_string().as_str(),
        ] {
            digest.update(value.as_bytes());
            digest.update([0]);
        }
    }
    let compiler_sha256 = files
        .iter()
        .find(|file| file.role == "typescript-compiler-entrypoint")
        .map(|file| file.sha256.clone())
        .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    let node_executable_sha256 = files
        .iter()
        .find(|file| file.role == "node-executable")
        .map(|file| file.sha256.clone())
        .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    Ok(ToolchainEvidence {
        type_script_version: type_script_package.version,
        compiler_sha256,
        toolchain_evidence_sha256: hex_digest(digest.finalize()),
        node_executable_sha256,
    })
}

struct PackageEvidence {
    version: String,
    bin: PathBuf,
}

fn read_package(path: &Path, expected_name: &str) -> DiagnosticsResult<PackageEvidence> {
    let bytes = fs::read(path)
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    if bytes.is_empty() || bytes.len() > MAX_PACKAGE_JSON_BYTES {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    if value.get("name").and_then(Value::as_str) != Some(expected_name) {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| valid_metadata(value))
        .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?
        .to_string();
    let bin = match value.get("bin") {
        Some(Value::String(value)) if expected_name == "typescript-language-server" => value,
        Some(Value::Object(values)) if expected_name == "typescript-language-server" => values
            .get("typescript-language-server")
            .and_then(Value::as_str)
            .ok_or_else(|| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?,
        _ if expected_name == "typescript" => "bin/tsc",
        _ => {
            return Err(TypeScriptDiagnosticsError::response(
                "diagnostics-attestation",
            ))
        }
    };
    let bin = bin.strip_prefix("./").unwrap_or(bin);
    if !valid_relative_path(bin) {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }
    Ok(PackageEvidence {
        version,
        bin: PathBuf::from(bin),
    })
}

struct FileEvidence {
    role: &'static str,
    path: PathBuf,
    sha256: String,
    size: u64,
}

fn file_evidence(role: &'static str, path: PathBuf) -> DiagnosticsResult<FileEvidence> {
    let bytes = fs::read(&path)
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    Ok(FileEvidence {
        role,
        path,
        sha256: sha256_bytes(&bytes),
        size: bytes.len() as u64,
    })
}

fn canonical_regular_file(path: impl AsRef<Path>) -> DiagnosticsResult<PathBuf> {
    let path = path
        .as_ref()
        .canonicalize()
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    if !path.is_file() {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }
    Ok(path)
}

fn canonical_directory(path: impl AsRef<Path>) -> DiagnosticsResult<PathBuf> {
    let path = path
        .as_ref()
        .canonicalize()
        .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-attestation"))?;
    if !path.is_dir() {
        return Err(TypeScriptDiagnosticsError::response(
            "diagnostics-attestation",
        ));
    }
    Ok(path)
}

fn set_exact_response_bytes(response: &mut TypeScriptDiagnosticsResponse) -> DiagnosticsResult<()> {
    for _ in 0..8 {
        let bytes = serde_json::to_vec(response)
            .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-response-schema"))?
            .len();
        response.response_bytes = bytes;
        let exact = serde_json::to_vec(response)
            .map_err(|_| TypeScriptDiagnosticsError::response("diagnostics-response-schema"))?
            .len();
        if exact == bytes && exact <= MAX_RESPONSE_BYTES && exact <= MAX_OUTPUT_BYTES as usize {
            return Ok(());
        }
    }
    Err(TypeScriptDiagnosticsError::response("diagnostics-bounds"))
}

fn expected_runtime() -> DiagnosticsRuntime {
    DiagnosticsRuntime {
        execution_mode: "external-process".to_string(),
        supports_timeout: true,
        supports_cancellation: true,
        uses_workspace_overlay: true,
        records_process_provenance: true,
        limits: DiagnosticsRuntimeLimits {
            request_timeout_millis: REQUEST_TIMEOUT_MILLIS,
            max_input_bytes: MAX_INPUT_BYTES,
            max_output_bytes: MAX_OUTPUT_BYTES,
            max_stderr_bytes: MAX_STDERR_BYTES,
            max_processes: MAX_PROCESSES,
            compiler_heap_mi_b: COMPILER_HEAP_MIB,
            max_diagnostics: MAX_DIAGNOSTICS as u64,
            max_diagnostic_message_chars: MAX_DIAGNOSTIC_MESSAGE_CHARS as u64,
            max_response_bytes: MAX_RESPONSE_BYTES as u64,
        },
    }
}

fn valid_range(content: &str, range: &DiagnosticRange) -> bool {
    if range.end.line < range.start.line
        || (range.end.line == range.start.line && range.end.character < range.start.character)
    {
        return false;
    }
    valid_utf16_point(content, &range.start) && valid_utf16_point(content, &range.end)
}

fn valid_utf16_point(content: &str, point: &DiagnosticPoint) -> bool {
    let Ok(line_index) = usize::try_from(point.line) else {
        return false;
    };
    let Some(line) = content.split('\n').nth(line_index) else {
        return false;
    };
    let line = line.strip_suffix('\r').unwrap_or(line);
    u64::try_from(line.encode_utf16().count()).is_ok_and(|length| point.character <= length)
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_BYTES
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTITY_BYTES
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_metadata(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_message(value: &str, maximum_chars: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= maximum_chars
        && !value.chars().any(char::is_control)
}

fn valid_typescript_code(value: &str) -> bool {
    let Some(digits) = value.strip_prefix("TS") else {
        return false;
    };
    (1..=7).contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_relative_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PATH_BYTES
        && value.trim() == value
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn valid_semantic_lease(value: &str) -> bool {
    value.strip_prefix("semantic-").is_some_and(|suffix| {
        suffix.len() == 36
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-')
    })
}

fn sha256_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    hex_digest(Sha256::digest(bytes))
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_dto_rejects_missing_and_extra_authority_fields() {
        let valid = json!({
            "schemaVersion": 2,
            "operation": "diagnostics.v2",
            "requestId": "diagnostics-1",
            "languageId": "typescript",
            "workspaceId": "workspace:one",
            "workspaceGeneration": 7,
            "sessionId": "session:one",
            "expectedSnapshotHash": "a".repeat(64),
            "semanticLease": "semantic-00000000-0000-4000-8000-000000000001",
            "sourceAuthority": {
                "kind": "immutable-editor-overlay",
                "documents": [{"path": "src/main.ts", "version": 3, "content": "const value = 1;\n"}]
            }
        });
        let request: TypeScriptDiagnosticsRequest = serde_json::from_value(valid.clone()).unwrap();
        assert!(validate_request(&request).is_ok());

        let mut extra = valid.clone();
        extra["sourceAuthority"]["documents"][0]["fallback"] = json!(true);
        assert!(serde_json::from_value::<TypeScriptDiagnosticsRequest>(extra).is_err());

        let mut missing = valid;
        missing["sourceAuthority"]["documents"][0]
            .as_object_mut()
            .unwrap()
            .remove("version");
        assert!(serde_json::from_value::<TypeScriptDiagnosticsRequest>(missing).is_err());
    }

    #[test]
    fn request_validation_is_bounded_and_requires_canonical_typescript_overlays() {
        let document = OverlayDocumentRequest {
            path: "src/main.ts".to_string(),
            version: 0,
            content: "const value = 1;".to_string(),
        };
        let request = TypeScriptDiagnosticsRequest {
            schema_version: 2,
            operation: OPERATION.to_string(),
            request_id: "diagnostics-1".to_string(),
            language_id: LANGUAGE_ID.to_string(),
            workspace_id: "workspace:one".to_string(),
            workspace_generation: 1,
            session_id: "session:one".to_string(),
            expected_snapshot_hash: "a".repeat(64),
            semantic_lease: "semantic-00000000-0000-4000-8000-000000000001".to_string(),
            source_authority: OverlaySourceAuthorityRequest {
                kind: "immutable-editor-overlay".to_string(),
                documents: vec![document.clone()],
            },
        };
        assert!(validate_request(&request).is_ok());

        for path in ["../main.ts", "/tmp/main.ts", "src\\main.ts", "src/main.js"] {
            let mut invalid = request.clone();
            invalid.source_authority.documents[0].path = path.to_string();
            assert!(validate_request(&invalid).is_err(), "accepted {path}");
        }
        let mut duplicate = request;
        duplicate.source_authority.documents.push(document);
        assert!(validate_request(&duplicate).is_err());
    }

    fn request_fixture() -> TypeScriptDiagnosticsRequest {
        TypeScriptDiagnosticsRequest {
            schema_version: 2,
            operation: OPERATION.to_string(),
            request_id: "diagnostics-1".to_string(),
            language_id: LANGUAGE_ID.to_string(),
            workspace_id: "workspace:one".to_string(),
            workspace_generation: 1,
            session_id: "session:one".to_string(),
            expected_snapshot_hash: "a".repeat(64),
            semantic_lease: "semantic-00000000-0000-4000-8000-000000000001".to_string(),
            source_authority: OverlaySourceAuthorityRequest {
                kind: "immutable-editor-overlay".to_string(),
                documents: vec![OverlayDocumentRequest {
                    path: "src/main.ts".to_string(),
                    version: 3,
                    content: "const value = 1;\n".to_string(),
                }],
            },
        }
    }

    fn refused_provider_fixture(request: &TypeScriptDiagnosticsRequest) -> Value {
        let mut response = ProviderDiagnosticsResponse {
            schema_version: 2,
            request_id: request.request_id.clone(),
            language_id: request.language_id.clone(),
            status: DiagnosticsStatus::Refused,
            provider: ProviderIdentity {
                name: PROVIDER_NAME.to_string(),
                version: PROVIDER_VERSION.to_string(),
                api_version: API_VERSION.to_string(),
            },
            backend: BACKEND.to_string(),
            semantic_lease: Some(request.semantic_lease.clone()),
            project_snapshot_hash: request.expected_snapshot_hash.clone(),
            provider_snapshot_hash: "b".repeat(64),
            source_authority: ProviderOverlaySourceAuthorityResponse {
                kind: "immutable-editor-overlay".to_string(),
                base_snapshot_hash: request.expected_snapshot_hash.clone(),
                overlay_hash: "c".repeat(64),
                provider_snapshot_hash: "b".repeat(64),
                documents: vec![OverlayDocumentResponse {
                    path: "src/main.ts".to_string(),
                    version: 3,
                    content_sha256: sha256_bytes(b"const value = 1;\n"),
                }],
            },
            range_encoding: "utf-16".to_string(),
            range_capability: "exact-utf16-or-explicit-partial".to_string(),
            runtime: expected_runtime(),
            compiler_attestation: None,
            failure: Some(DiagnosticsFailure {
                code: "diagnostics.overlayInvalid".to_string(),
                message: "Editor overlay is invalid".to_string(),
            }),
            diagnostics: Vec::new(),
            diagnostics_total: 0,
            diagnostics_returned: 0,
            truncated: false,
            response_bytes: 0,
        };
        for _ in 0..8 {
            let bytes = serde_json::to_vec(&response).unwrap().len();
            response.response_bytes = bytes;
            if serde_json::to_vec(&response).unwrap().len() == bytes {
                return serde_json::to_value(response).unwrap();
            }
        }
        panic!("provider response byte count did not converge")
    }

    fn unused_toolchain() -> AuthorizedToolchain {
        AuthorizedToolchain {
            node_executable: "/unused/node".to_string(),
            language_server_package_root: "/unused/language-server".to_string(),
            type_script_package_root: "/unused/typescript".to_string(),
        }
    }

    #[test]
    fn structured_refusal_is_correlated_complete_and_reencoded_exactly() {
        let request = request_fixture();
        let response = normalize_response(
            refused_provider_fixture(&request),
            &request,
            &unused_toolchain(),
        )
        .unwrap();
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["operation"], OPERATION);
        assert_eq!(value["workspaceId"], request.workspace_id);
        assert_eq!(value["sessionId"], request.session_id);
        assert_eq!(value["provider"]["name"], PROVIDER_WIRE_NAME);
        assert_eq!(value["status"], "refused");
        assert_eq!(value["compilerAttestation"], Value::Null);
        assert_eq!(value["diagnostics"], json!([]));
        assert_eq!(
            value["responseBytes"].as_u64().unwrap() as usize,
            serde_json::to_vec(&response).unwrap().len()
        );
    }

    #[test]
    fn malformed_extra_stale_and_truncated_provider_responses_fail_closed() {
        let request = request_fixture();
        let toolchain = unused_toolchain();

        let mut extra = refused_provider_fixture(&request);
        extra["stdout"] = json!("legacy fallback");
        assert!(normalize_response(extra, &request, &toolchain).is_err());

        let mut stale = refused_provider_fixture(&request);
        stale["projectSnapshotHash"] = json!("d".repeat(64));
        assert!(normalize_response(stale, &request, &toolchain).is_err());

        let mut truncated = refused_provider_fixture(&request);
        truncated["truncated"] = json!(true);
        assert!(normalize_response(truncated, &request, &toolchain).is_err());
    }

    #[test]
    fn utf16_ranges_are_zero_based_bounded_and_ordered() {
        let content = "const emoji = \"😀\";\n";
        assert!(valid_range(
            content,
            &DiagnosticRange {
                start: DiagnosticPoint {
                    line: 0,
                    character: 15,
                },
                end: DiagnosticPoint {
                    line: 0,
                    character: 17,
                },
            }
        ));
        assert!(!valid_range(
            content,
            &DiagnosticRange {
                start: DiagnosticPoint {
                    line: 0,
                    character: 18,
                },
                end: DiagnosticPoint {
                    line: 0,
                    character: 17,
                },
            }
        ));
        assert!(!valid_utf16_point(
            content,
            &DiagnosticPoint {
                line: 2,
                character: 0,
            }
        ));
    }
}
